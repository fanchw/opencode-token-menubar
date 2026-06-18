// IM 平台 → Bridge：收到的消息
export interface IncomingMessage {
  chatId: string;
  userId: number;
  text: string;
  // inline keyboard 按钮回调（如权限批准/拒绝）
  callbackData?: string;
}

// Bridge → IM 平台：要推送的事件
export interface OutgoingEvent {
  chatId: string;
  kind: "thinking" | "delta" | "tool" | "tool_result" | "done" | "error" | "permission";
  text: string;
  sessionId?: string;
  toolName?: string;
  toolStatus?: "start" | "success" | "error";
  // permission 事件携带的权限请求 id，用于回调响应
  permissionId?: string;
  // permission 事件携带的会话 id + 权限 id 组合，用于 inline keyboard 回调
  permissionSessionId?: string;
}

// 所有 IM 平台 adapter 实现的统一接口
export interface IMAdapter {
  start(onMessage: (msg: IncomingMessage) => void): Promise<void>;
  stop(): Promise<void>;
  send(event: OutgoingEvent): Promise<void>;
}
