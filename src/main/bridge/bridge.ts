import type { IMAdapter, IncomingMessage, OutgoingEvent } from "./adapter/types.js";
import type { OpenCodeProxy } from "./proxy/opencode.js";
import { parseCommand, type Command } from "./router.js";

export interface BridgeOptions {
  allowlist?: number[];
  autoApprove?: boolean;
  maxQueue?: number;
}

// Bridge 的纯状态管理（可独立测试）
export class BridgeState {
  private chatToSession = new Map<string, string>();
  private sessionToChat = new Map<string, string>();
  private allowlist?: number[];
  private maxQueue: number;
  private promptQueue = new Map<string, string[]>();
  private busy = new Set<string>();

  constructor(options: BridgeOptions = {}) {
    this.allowlist = options.allowlist;
    this.maxQueue = options.maxQueue ?? 5;
  }

  bindSession(chatId: string, sessionId: string): void {
    const old = this.chatToSession.get(chatId);
    if (old) this.sessionToChat.delete(old);
    this.chatToSession.set(chatId, sessionId);
    this.sessionToChat.set(sessionId, chatId);
  }

  getSession(chatId: string): string | undefined {
    return this.chatToSession.get(chatId);
  }

  getChatId(sessionId: string): string | undefined {
    return this.sessionToChat.get(sessionId);
  }

  isAllowed(userId: number): boolean {
    if (!this.allowlist || this.allowlist.length === 0) return true;
    return this.allowlist.includes(userId);
  }

  // 返回 null=直接执行（调用方负责发 prompt），数字=排队位置，-1=队列满
  // maxQueue 语义：最大并发总数（busy + 排队），position 即任务总数序号
  enqueue(chatId: string, text: string): number | null {
    if (!this.busy.has(chatId)) {
      this.busy.add(chatId);
      return null;
    }
    const queue = this.promptQueue.get(chatId) ?? [];
    const position = queue.length + 2;
    if (position > this.maxQueue) return -1;
    queue.push(text);
    this.promptQueue.set(chatId, queue);
    return position;
  }

  isBusy(chatId: string): boolean {
    return this.busy.has(chatId);
  }

  // 释放当前任务，返回下一条 prompt 文本（null=队列空，释放 busy）
  release(chatId: string): string | null {
    const queue = this.promptQueue.get(chatId);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) this.promptQueue.delete(chatId);
      return next;
    }
    this.promptQueue.delete(chatId);
    this.busy.delete(chatId);
    return null;
  }
}

// Bridge 中枢：串联 adapter/proxy，处理路由
export class Bridge {
  private state: BridgeState;
  private autoApprove: boolean;
  private stopProxy: (() => void) | null = null;

  constructor(
    private adapter: IMAdapter,
    private proxy: OpenCodeProxy,
    options: BridgeOptions = {},
  ) {
    this.state = new BridgeState(options);
    this.autoApprove = options.autoApprove ?? false;
  }

  // 暴露给测试的便捷方法
  bindSession(chatId: string, sessionId: string): void {
    this.state.bindSession(chatId, sessionId);
  }

  // 启动：连接 adapter 收消息 + proxy 订阅事件
  async start(): Promise<void> {
    await this.adapter.start((msg) => {
      void this.handleMessage(msg).catch((e) => console.warn("[bridge] handleMessage", e));
    });
    // 用 getter 函数实时查询，确保 /new /switch 新绑定后事件不丢
    this.stopProxy = this.proxy.subscribe(
      (sessionId) => this.state.getChatId(sessionId),
      (event) => this.handleProxyEvent(event),
    );
  }

  async stop(): Promise<void> {
    await this.adapter.stop();
    this.stopProxy?.();
  }

  // 处理 IM 来的消息
  async handleMessage(msg: IncomingMessage): Promise<void> {
    if (!this.state.isAllowed(msg.userId)) return;

    // callback query（权限按钮）
    if (msg.callbackData) {
      await this.handleCallback(msg.callbackData);
      return;
    }

    const cmd = parseCommand(msg.text);
    await this.dispatch(msg.chatId, cmd);
  }

  private async dispatch(chatId: string, cmd: Command): Promise<void> {
    switch (cmd.kind) {
      case "new": {
        const sid = await this.proxy.createSession();
        this.state.bindSession(chatId, sid);
        await this.adapter.send({ chatId, kind: "done", text: `✅ 新会话已创建: ${sid}` });
        return;
      }
      case "list": {
        const list = await this.proxy.listSessions();
        const text = list.map((s) => `- ${s.id}${s.title ? ` (${s.title})` : ""}`).join("\n") || "（无会话）";
        await this.adapter.send({ chatId, kind: "done", text });
        return;
      }
      case "switch": {
        if (!cmd.sessionId) {
          await this.adapter.send({ chatId, kind: "error", text: "用法: /switch <id>" });
          return;
        }
        this.state.bindSession(chatId, cmd.sessionId);
        await this.adapter.send({ chatId, kind: "done", text: `✅ 已切换到: ${cmd.sessionId}` });
        return;
      }
      case "abort": {
        const sid = this.state.getSession(chatId);
        if (!sid) {
          await this.adapter.send({ chatId, kind: "error", text: "当前无绑定会话" });
          return;
        }
        await this.proxy.abort(sid);
        await this.adapter.send({ chatId, kind: "done", text: "⏹ 已中止" });
        return;
      }
      case "status": {
        const sid = this.state.getSession(chatId);
        if (!sid) {
          await this.adapter.send({ chatId, kind: "done", text: "未绑定会话，发 /new 创建" });
          return;
        }
        const info = await this.proxy.getSession(sid);
        const model = (info as { model?: { id?: string } }).model?.id ?? "unknown";
        await this.adapter.send({ chatId, kind: "done", text: `会话: ${sid}\n模型: ${model}` });
        return;
      }
      case "help": {
        await this.adapter.send({
          chatId,
          kind: "done",
          text: "命令: /new /list /switch <id> /abort /status\n普通文本=发 prompt",
        });
        return;
      }
      case "prompt": {
        await this.handlePrompt(chatId, cmd.text);
        return;
      }
    }
  }

  private async handlePrompt(chatId: string, text: string): Promise<void> {
    let sid = this.state.getSession(chatId);
    if (!sid) {
      sid = await this.proxy.createSession();
      this.state.bindSession(chatId, sid);
    }

    const pos = this.state.enqueue(chatId, text);
    if (pos === -1) {
      await this.adapter.send({ chatId, kind: "error", text: "⚠️ 队列已满，请稍后" });
      return;
    }
    if (pos !== null) {
      await this.adapter.send({ chatId, kind: "done", text: `⏳ 已排队（第 ${pos} 位）` });
      return;
    }
    await this.proxy.promptAsync(sid, text);
  }

  private async handleCallback(data: string): Promise<void> {
    // 格式: once:sessionId:permissionId / always:... / reject:...
    const [response, sessionId, permissionId] = data.split(":");
    if (response !== "once" && response !== "always" && response !== "reject") return;
    await this.proxy.respondPermission(sessionId, permissionId, response);
  }

  // 处理 proxy 回流的事件 → 推给 adapter
  handleProxyEvent(event: OutgoingEvent): void {
    // autoApprove：权限自动通过（用 always=永久允许，避免同一会话反复弹窗）
    if (event.kind === "permission" && this.autoApprove) {
      const sid = event.permissionSessionId;
      const pid = event.permissionId;
      if (sid && pid) {
        void this.proxy.respondPermission(sid, pid, "always").catch((e) =>
          console.warn("[bridge] respondPermission", e),
        );
        return;
      }
    }

    // done 事件：释放排队，若有下一条则自动提交
    if (event.kind === "done") {
      const chatId = event.chatId;
      const nextPrompt = this.state.release(chatId);
      if (nextPrompt !== null) {
        const sid = this.state.getSession(chatId);
        if (sid) {
          void this.proxy.promptAsync(sid, nextPrompt).catch((e) =>
            console.warn("[bridge] queue prompt failed", e),
          );
        }
      }
    }

    void this.adapter.send(event).catch((e) => console.warn("[bridge] send", e));
  }
}
