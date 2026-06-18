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
  private queueCount = new Map<string, number>();
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

  // 返回 null=直接执行，数字=排队位置（即总并发序号），-1=队列满
  // maxQueue 语义：最大并发总数（busy + 排队），position 即任务总数序号
  enqueue(chatId: string): number | null {
    if (!this.busy.has(chatId)) {
      this.busy.add(chatId);
      return null;
    }
    const count = this.queueCount.get(chatId) ?? 0;
    const position = count + 2;
    if (position > this.maxQueue) return -1;
    this.queueCount.set(chatId, count + 1);
    return position;
  }

  isBusy(chatId: string): boolean {
    return this.busy.has(chatId);
  }

  // 释放当前任务，返回 true=队列里还有下一个要执行
  release(chatId: string): boolean {
    const count = this.queueCount.get(chatId) ?? 0;
    if (count > 0) {
      this.queueCount.set(chatId, count - 1);
      return true;
    }
    this.queueCount.delete(chatId);
    this.busy.delete(chatId);
    return false;
  }
}
