import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramAdapter } from "./telegram.js";

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
