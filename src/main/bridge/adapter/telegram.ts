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

  // 以下方法在 Task 7/8/9 实现
  async start(_onMessage: (msg: IncomingMessage) => void): Promise<void> {
    throw new Error("not implemented");
  }

  async stop(): Promise<void> {
    throw new Error("not implemented");
  }

  async send(_event: OutgoingEvent): Promise<void> {
    throw new Error("not implemented");
  }
}
