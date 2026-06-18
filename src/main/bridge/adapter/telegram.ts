import type { IMAdapter, IncomingMessage, OutgoingEvent } from "./types.js";

export interface TelegramConfig {
  botToken: string;
  throttleMs: number;
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
  private offset = 0;
  private polling = false;
  private onMessage: ((msg: IncomingMessage) => void) | null = null;

  constructor(config: TelegramConfig) {
    this.baseUrl = `${API_BASE}/${config.botToken}`;
    this.throttleMs = config.throttleMs;
  }

  private async api<T>(method: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
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
    const updates = await this.api<
      Array<{
        update_id: number;
        message?: { chat: { id: number }; from: { id: number }; text?: string };
        callback_query?: { from: { id: number }; data?: string; message: { chat: { id: number } } };
      }>
    >("getUpdates", { offset: this.offset, timeout: 30 });

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
        await this.api("answerCallbackQuery", { callback_query_id: u.callback_query.from.id }).catch(() => {});
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
      this.streamState.delete(chatId);
      await this.sendText(chatId, `❌ ${event.text}`);
      return;
    }
  }
}
