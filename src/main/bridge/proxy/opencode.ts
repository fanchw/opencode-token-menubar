import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { OutgoingEvent } from "../adapter/types.js";

export interface SessionSummary {
  id: string;
  title?: string;
}

// OpenCode SSE 事件的宽松类型（实际结构以源码核实为准）
interface RawOpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

// 把单个 OpenCode 事件映射成 OutgoingEvent；无法识别的返回 null
// 事件 type 值基于 OpenCode 源码核实
export function mapOpenCodeEvent(raw: RawOpenCodeEvent, chatId: string): OutgoingEvent | null {
  const props = (raw.properties ?? {}) as Record<string, unknown>;
  const sessionId = typeof props.sessionID === "string" ? props.sessionID : undefined;

  switch (raw.type) {
    // 会话状态：busy=开始思考，idle=完成
    // 源码核实：status 是对象 { type: "busy" | "idle" | "retry" }，不是字符串
    case "session.status": {
      const status = props.status as Record<string, unknown> | undefined;
      if (status?.type === "busy") {
        return { chatId, kind: "thinking", text: "", sessionId };
      }
      if (status?.type === "idle") {
        return { chatId, kind: "done", text: "", sessionId };
      }
      return null;
    }

    // 流式增量：delta 是字段增量字符串
    case "message.part.delta": {
      const delta = typeof props.delta === "string" ? props.delta : "";
      return { chatId, kind: "delta", text: delta, sessionId };
    }

    // 消息部分更新：根据 part.type 分流（text / tool）
    case "message.part.updated":
    case "message.updated": {
      const part = props.part as Record<string, unknown> | undefined;
      if (!part) return null;

      if (part.type === "text") {
        const text = typeof part.text === "string" ? part.text : "";
        return { chatId, kind: "delta", text, sessionId };
      }

      if (part.type === "tool") {
        // 源码核实：input/output/error 都在 part.state.*，工具名在 part.tool（顶层）
        const toolName = typeof part.tool === "string" ? part.tool : "tool";
        const state = part.state as Record<string, unknown> | undefined;
        const stateStatus = state?.status;
        const input = state?.input as Record<string, unknown> | undefined;
        const detail = input && typeof input.command === "string" ? input.command : "";

        if (stateStatus === "completed") {
          const output = typeof state?.output === "string" ? state.output : "";
          return { chatId, kind: "tool_result", text: output, sessionId, toolName, toolStatus: "success" };
        }
        if (stateStatus === "error") {
          const errorMsg = typeof state?.error === "string" ? state.error : "";
          return { chatId, kind: "tool_result", text: errorMsg, sessionId, toolName, toolStatus: "error" };
        }
        // pending / running → tool(start)
        return { chatId, kind: "tool", text: detail, sessionId, toolName, toolStatus: "start" };
      }

      return null;
    }

    // 权限请求
    case "permission.asked": {
      const permissionId = typeof props.id === "string" ? props.id : "";
      const toolName = typeof props.permission === "string" ? props.permission : "unknown";
      const meta = props.metadata as Record<string, unknown> | undefined;
      const detail = meta && typeof meta.command === "string" ? meta.command : "";
      const text = `🔐 ${toolName}${detail ? `: ${detail}` : ""}`;
      return { chatId, kind: "permission", text, sessionId, permissionId, permissionSessionId: sessionId };
    }

    default:
      return null;
  }
}

export class OpenCodeProxy {
  constructor(private client: OpencodeClient) {}

  static fromBaseUrl(baseUrl: string, password?: string): OpenCodeProxy {
    const headers: Record<string, string> = {};
    if (password) {
      // OpenCode 用 HTTP Basic Auth，username 默认 "opencode"
      headers.Authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    }
    return new OpenCodeProxy(createOpencodeClient({ baseUrl, throwOnError: true, headers }));
  }

  async createSession(): Promise<string> {
    const res = await this.client.session.create({ throwOnError: true });
    return res.data.id;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const res = await this.client.session.list();
    return (res.data ?? []) as SessionSummary[];
  }

  async getSession(id: string) {
    const res = await this.client.session.get({ path: { id } });
    return res.data;
  }

  async abort(id: string): Promise<void> {
    await this.client.session.abort({ path: { id } });
  }

  async promptAsync(id: string, text: string): Promise<void> {
    await this.client.session.promptAsync({
      path: { id },
      body: { parts: [{ type: "text" as const, text }] },
    });
  }

  // 权限响应：三态（once=本次允许 / always=永久允许 / reject=拒绝）
  async respondPermission(
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    await this.client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response },
    });
  }

  // 订阅全局 SSE 事件流；onEvent 接收映射后的 OutgoingEvent
  // getChatId: 实时查询 sessionId → chatId（用函数而非 Map 快照，确保 /new /switch 新绑定后事件不丢）
  // 返回停止函数
  subscribe(
    getChatId: (sessionId: string) => string | undefined,
    onEvent: (event: OutgoingEvent) => void,
  ): () => void {
    let stopped = false;
    let reconnectDelay = 1000;

    const loop = async () => {
      while (!stopped) {
        try {
          // 源码核实：client.global.event() 返回 { stream: AsyncGenerator }
          // /global/event 流每个 yield 是 { directory, payload: { id, type, properties } }
          const sse = await this.client.global.event();
          const stream = (sse as unknown as {
            stream: AsyncIterable<{ payload?: { type: string; properties: Record<string, unknown> } }>;
          }).stream;
          if (!stream || typeof (stream as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function") {
            throw new Error("SSE stream 不可迭代");
          }
          for await (const entry of stream) {
            if (stopped) break;
            const payload = entry.payload;
            if (!payload) continue;
            const sessionId = payload.properties?.sessionID;
            if (typeof sessionId !== "string") continue;
            const chatId = getChatId(sessionId);
            if (!chatId) continue;
            const mapped = mapOpenCodeEvent(
              { type: payload.type, properties: payload.properties },
              chatId,
            );
            if (mapped) onEvent(mapped);
          }
          // 流正常结束，重置退避
          reconnectDelay = 1000;
        } catch {
          // 连接失败或断线，指数退避重连
        }
        if (stopped) break;
        await new Promise((r) => setTimeout(r, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      }
    };

    void loop();
    return () => {
      stopped = true;
    };
  }
}
