import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { IMAdapter, IncomingMessage, OutgoingEvent } from "./types.js";

export interface TelegramConfig {
  botToken: string;
  throttleMs: number;
  proxy?: string;
}

const API_BASE = "https://api.telegram.org/bot";

interface TelegramApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface BotInfo {
  id: number;
  username: string;
}

// 命令菜单定义
export const BOT_COMMANDS = [
  { command: "new", description: "新建 OpenCode 会话" },
  { command: "list", description: "列出会话" },
  { command: "switch", description: "切换会话 (用法: /switch <id>)" },
  { command: "abort", description: "中止当前任务" },
  { command: "status", description: "查看当前状态" },
  { command: "help", description: "帮助" },
];

const TELEGRAM_MSG_LIMIT = 4096;
const TOOL_RESULT_LIMIT = 500;

export class TelegramAdapter implements IMAdapter {
  private baseUrl: string;
  private throttleMs: number;
  private dispatcher: ProxyAgent | undefined;
  private offset = 0;
  private polling = false;
  private onMessage: ((msg: IncomingMessage) => void) | null = null;

  constructor(config: TelegramConfig) {
    // 注意：bot 和 token 之间没有斜杠，格式为 https://api.telegram.org/bot<token>/METHOD
    this.baseUrl = `${API_BASE}${config.botToken.trim()}`;
    this.throttleMs = config.throttleMs;
    if (config.proxy) {
      this.dispatcher = new ProxyAgent(config.proxy);
    }
  }

  private async api<T>(method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const init: Record<string, unknown> = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    };
    // 有代理时用 undici fetch（和 ProxyAgent 版本匹配），无代理用全局 fetch（测试 mock 生效）
    const fetchFn = this.dispatcher ? undiciFetch : globalThis.fetch;
    if (this.dispatcher) {
      init.dispatcher = this.dispatcher;
    }
    const res = await fetchFn(`${this.baseUrl}/${method}`, init as never);
    const data = (await res.json()) as TelegramApiResult<T>;
    if (!data.ok) {
      throw new Error(`telegram ${method} failed: ${data.description ?? "unknown"}`);
    }
    return data.result as T;
  }

  // 校验 token 有效性
  async verifyToken(): Promise<BotInfo> {
    return this.api<BotInfo>("getMe");
  }

  // 注册命令菜单
  async registerCommands(): Promise<void> {
    await this.api("setMyCommands", { commands: BOT_COMMANDS });
  }

  // 单轮长轮询（测试可单独调用）
  async pollOnce(cb: (msg: IncomingMessage) => void): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 35000);
    let updates;
    try {
      updates = await this.api<
        Array<{
          update_id: number;
          message?: { chat: { id: number }; from: { id: number }; text?: string };
          callback_query?: { id: string; from: { id: number }; data?: string; message: { chat: { id: number } } };
        }>
      >("getUpdates", { offset: this.offset, timeout: 30 }, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }

    for (const u of updates) {
      this.offset = u.update_id + 1;
      if (u.message) {
        cb({
          chatId: String(u.message.chat.id),
          userId: u.message.from.id,
          text: u.message.text ?? "",
        });
      } else if (u.callback_query) {
        // 应答 callback 避免 loading 转圈
        await this.api("answerCallbackQuery", { callback_query_id: u.callback_query.id }).catch(() => {});
        cb({
          chatId: String(u.callback_query.message.chat.id),
          userId: u.callback_query.from.id,
          text: "",
          callbackData: u.callback_query.data,
        });
      }
    }
  }

  async start(onMessage: (msg: IncomingMessage) => void): Promise<void> {
    this.onMessage = onMessage;
    this.polling = true;
    const loop = async () => {
      while (this.polling && this.onMessage) {
        try {
          await this.pollOnce(this.onMessage);
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.polling = false;
    this.onMessage = null;
    for (const state of this.streamState.values()) {
      if (state.editTimer) clearTimeout(state.editTimer);
    }
    this.streamState.clear();
  }

  // 每个 chatId 的流式状态
  private streamState = new Map<string, { messageId?: number; buffer: string; editTimer?: ReturnType<typeof setTimeout> }>();

  private async sendText(chatId: string, text: string): Promise<number> {
    const res = await this.api<{ message_id: number }>("sendMessage", { chat_id: chatId, text });
    return res.message_id;
  }

  private async editText(chatId: string, messageId: number, text: string): Promise<void> {
    await this.api("editMessageText", { chat_id: chatId, message_id: messageId, text }).catch(() => {});
  }

  private async sendSegmented(chatId: string, text: string): Promise<void> {
    if (text.length <= TELEGRAM_MSG_LIMIT) {
      await this.sendText(chatId, text);
      return;
    }
    for (let i = 0; i < text.length; i += TELEGRAM_MSG_LIMIT) {
      await this.sendText(chatId, text.slice(i, i + TELEGRAM_MSG_LIMIT));
    }
  }

  private flushEdit(chatId: string): void {
    const state = this.streamState.get(chatId);
    if (!state || state.editTimer == null || state.messageId == null) return;
    const text = state.buffer || "…";
    state.editTimer = undefined;
    void this.editText(chatId, state.messageId, text);
  }

  async send(event: OutgoingEvent): Promise<void> {
    const { chatId, kind } = event;

    if (kind === "thinking") {
      const messageId = await this.sendText(chatId, "🤔 思考中...");
      this.streamState.set(chatId, { messageId, buffer: "" });
      return;
    }

    if (kind === "delta") {
      const state = this.streamState.get(chatId) ?? { buffer: "" };
      state.buffer += event.text;
      this.streamState.set(chatId, state);
      if (state.messageId != null && state.editTimer == null) {
        state.editTimer = setTimeout(() => this.flushEdit(chatId), this.throttleMs);
      }
      return;
    }

    if (kind === "tool") {
      const icon = "🔧";
      await this.sendText(chatId, `${icon} ${event.toolName ?? ""}${event.text ? `: ${event.text}` : ""}`);
      return;
    }

    if (kind === "tool_result") {
      const ok = event.toolStatus === "error" ? "❌" : "✅";
      const detail = event.text.length > TOOL_RESULT_LIMIT ? event.text.slice(0, TOOL_RESULT_LIMIT) + "…" : event.text;
      await this.sendText(chatId, `${ok} ${event.toolName ?? ""}${detail ? `\n${detail}` : ""}`);
      return;
    }

    if (kind === "done") {
      this.flushEdit(chatId);
      const state = this.streamState.get(chatId);
      if (state?.editTimer) clearTimeout(state.editTimer);
      // 兜底：如果 buffer 非空但从未发过占位消息（messageId 为 null），直接 sendText
      if (state && state.buffer && state.messageId == null) {
        await this.sendSegmented(chatId, state.buffer);
      }
      this.streamState.delete(chatId);
      if (event.text) {
        await this.sendSegmented(chatId, event.text);
      }
      return;
    }

    if (kind === "permission") {
      const sid = event.permissionSessionId ?? "";
      const pid = event.permissionId ?? "";
      await this.api("sendMessage", {
        chat_id: chatId,
        text: event.text,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ 本次", callback_data: `once:${sid}:${pid}` },
              { text: "🔁 永久", callback_data: `always:${sid}:${pid}` },
              { text: "❌ 拒绝", callback_data: `reject:${sid}:${pid}` },
            ],
          ],
        },
      });
      return;
    }

    if (kind === "error") {
      const state = this.streamState.get(chatId);
      if (state?.editTimer) clearTimeout(state.editTimer);
      this.streamState.delete(chatId);
      await this.sendText(chatId, `❌ ${event.text}`);
      return;
    }
  }
}
