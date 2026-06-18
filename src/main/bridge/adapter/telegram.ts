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

  async send(_event: OutgoingEvent): Promise<void> {
    throw new Error("not implemented");
  }
}
