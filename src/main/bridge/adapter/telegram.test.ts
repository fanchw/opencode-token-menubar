import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramAdapter } from "./telegram.js";
import type { IncomingMessage, OutgoingEvent } from "./types.js";

// mock global fetch
function mockFetch(responses: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const matcher = Object.keys(responses).find((k) => url.includes(k));
    const body = matcher ? responses[matcher] : { ok: true };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  return { fn, calls };
}

describe("TelegramAdapter 初始化", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch as never;
  });

  it("verifyToken 调用 getMe 并返回 bot 信息", async () => {
    const { fn } = mockFetch({ "/getMe": { ok: true, result: { id: 42, username: "mybot" } } });
    globalThis.fetch = fn as never;
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 1500 });
    const info = await adapter.verifyToken();
    expect(info).toEqual({ id: 42, username: "mybot" });
  });

  it("verifyToken 失败时抛错", async () => {
    const { fn } = mockFetch({ "/getMe": { ok: false, description: "bad token" } });
    globalThis.fetch = fn as never;
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 1500 });
    await expect(adapter.verifyToken()).rejects.toThrow();
  });

  it("registerCommands 调用 setMyCommands", async () => {
    const { fn, calls } = mockFetch({ "/setMyCommands": { ok: true } });
    globalThis.fetch = fn as never;
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 1500 });
    await adapter.registerCommands();
    const call = calls.find((c) => c.url.includes("/setMyCommands"));
    expect(call).toBeDefined();
    const body = JSON.parse(call!.init!.body as string);
    expect(body.commands).toContainEqual({ command: "new", description: expect.any(String) });
  });
});

describe("TelegramAdapter 长轮询收消息", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch as never;
  });

  it("getUpdates 返回消息并回调 onMessage，offset 递增", async () => {
    const updates = {
      ok: true,
      result: [
        { update_id: 100, message: { chat: { id: 555 }, from: { id: 1 }, text: "hi" } },
        {
          update_id: 101,
          callback_query: { from: { id: 2 }, data: "once:sess-1:perm-1", message: { chat: { id: 555 } } },
        },
      ],
    };
    const { fn } = mockFetch({ "/getUpdates": updates, "/answerCallbackQuery": { ok: true } });
    globalThis.fetch = fn as never;

    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 1500 });
    const received: IncomingMessage[] = [];
    // 直接调用 pollOnce（测试用）
    const poll = adapter as unknown as { pollOnce: (cb: (m: IncomingMessage) => void) => Promise<void> };
    await poll.pollOnce((m) => received.push(m));

    expect(received).toEqual([
      { chatId: "555", userId: 1, text: "hi" },
      { chatId: "555", userId: 2, text: "", callbackData: "once:sess-1:perm-1" },
    ]);
  });
});

describe("TelegramAdapter send 节流与分段", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch as never;
  });

  it("thinking 事件发占位消息", async () => {
    const { fn, calls } = mockFetch({ "/sendMessage": { ok: true, result: { message_id: 77 } } });
    globalThis.fetch = fn as never;
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 });
    await adapter.send({ chatId: "9", kind: "thinking", text: "" });
    const sm = calls.find((c) => c.url.includes("/sendMessage"));
    expect(sm).toBeDefined();
    expect(JSON.parse(sm!.init!.body as string).text).toContain("思考中");
  });

  it("delta 事件防抖后 editMessageText 同一条消息", async () => {
    const { fn, calls } = mockFetch({
      "/sendMessage": { ok: true, result: { message_id: 88 } },
      "/editMessageText": { ok: true },
    });
    globalThis.fetch = fn as never;
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 });
    await adapter.send({ chatId: "9", kind: "thinking", text: "" });
    await adapter.send({ chatId: "9", kind: "delta", text: "部分1" });
    await new Promise((r) => setTimeout(r, 80));
    const edits = calls.filter((c) => c.url.includes("/editMessageText"));
    expect(edits.length).toBe(1);
    expect(JSON.parse(edits[0].init!.body as string).message_id).toBe(88);
  });

  it("done 事件发送最终回复，超 4096 字符自动分段", async () => {
    const long = "x".repeat(5000);
    const { fn, calls } = mockFetch({ "/sendMessage": { ok: true, result: { message_id: 1 } } });
    globalThis.fetch = fn as never;
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 });
    await adapter.send({ chatId: "9", kind: "done", text: long });
    const msgs = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(msgs.length).toBe(2);
  });

  it("error 事件发送错误摘要", async () => {
    const { fn, calls } = mockFetch({ "/sendMessage": { ok: true, result: { message_id: 1 } } });
    globalThis.fetch = fn as never;
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 });
    await adapter.send({ chatId: "9", kind: "error", text: "连不上" });
    const sm = calls.find((c) => c.url.includes("/sendMessage"));
    expect(JSON.parse(sm!.init!.body as string).text).toContain("连不上");
  });
});
