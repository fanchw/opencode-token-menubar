import { describe, it, expect, vi } from "vitest";
import type { IMAdapter, IncomingMessage, OutgoingEvent } from "./adapter/types.js";
import type { OpenCodeProxy } from "./proxy/opencode.js";
import { BridgeState, Bridge } from "./bridge.js";

describe("BridgeState 会话映射与排队", () => {
  it("bindSession / getSession 基本映射", () => {
    const st = new BridgeState();
    st.bindSession("chat-1", "sess-1");
    expect(st.getSession("chat-1")).toBe("sess-1");
    expect(st.getChatId("sess-1")).toBe("chat-1");
  });

  it("rebind 切换会话后反向映射更新", () => {
    const st = new BridgeState();
    st.bindSession("chat-1", "sess-1");
    st.bindSession("chat-1", "sess-2");
    expect(st.getSession("chat-1")).toBe("sess-2");
    expect(st.getChatId("sess-1")).toBeUndefined();
    expect(st.getChatId("sess-2")).toBe("chat-1");
  });

  it("isAllowed 无白名单时全部放行", () => {
    const st = new BridgeState();
    expect(st.isAllowed(123)).toBe(true);
  });

  it("isAllowed 有白名单时只放行名单内", () => {
    const st = new BridgeState({ allowlist: [123] });
    expect(st.isAllowed(123)).toBe(true);
    expect(st.isAllowed(456)).toBe(false);
  });

  it("enqueue 在空闲时返回 null（无需排队）", () => {
    const st = new BridgeState();
    st.bindSession("chat-1", "sess-1");
    expect(st.enqueue("chat-1")).toBeNull();
    expect(st.isBusy("chat-1")).toBe(true);
  });

  it("enqueue 在忙碌时返回排队位置", () => {
    const st = new BridgeState();
    st.bindSession("chat-1", "sess-1");
    st.enqueue("chat-1");
    expect(st.enqueue("chat-1")).toBe(2);
  });

  it("enqueue 超过上限返回 -1", () => {
    const st = new BridgeState({ maxQueue: 2 });
    st.bindSession("chat-1", "sess-1");
    st.enqueue("chat-1");
    st.enqueue("chat-1");
    expect(st.enqueue("chat-1")).toBe(-1);
  });

  it("release 取出队列下一个并返回是否有后续", () => {
    const st = new BridgeState();
    st.bindSession("chat-1", "sess-1");
    st.enqueue("chat-1");
    st.enqueue("chat-1");
    const next = st.release("chat-1");
    expect(next).toBe(true);
  });

  it("release 无后续时释放 busy 状态", () => {
    const st = new BridgeState();
    st.bindSession("chat-1", "sess-1");
    st.enqueue("chat-1");
    const next = st.release("chat-1");
    expect(next).toBe(false);
    expect(st.isBusy("chat-1")).toBe(false);
  });
});

function makeMocks() {
  const sent: OutgoingEvent[] = [];
  const adapter: IMAdapter = {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(async (e: OutgoingEvent) => {
      sent.push(e);
    }),
  };
  const proxy: OpenCodeProxy = {
    createSession: vi.fn().mockResolvedValue("sess-new"),
    listSessions: vi.fn().mockResolvedValue([{ id: "s1", title: "T1" }]),
    getSession: vi.fn().mockResolvedValue({ id: "s1", model: { id: "claude" } }),
    abort: vi.fn().mockResolvedValue(undefined),
    promptAsync: vi.fn().mockResolvedValue(undefined),
    respondPermission: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  } as unknown as OpenCodeProxy;
  return { adapter, proxy, sent };
}

describe("Bridge 路由", () => {
  it("/new 创建会话并绑定，回复确认", async () => {
    const { adapter, proxy, sent } = makeMocks();
    const bridge = new Bridge(adapter, proxy, { autoApprove: false });
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "/new" });
    expect(proxy.createSession).toHaveBeenCalled();
    expect(sent.some((e) => e.kind === "done" && e.text.includes("sess-new"))).toBe(true);
  });

  it("普通文本作为 prompt 发送", async () => {
    const { adapter, proxy } = makeMocks();
    const bridge = new Bridge(adapter, proxy, {});
    bridge.bindSession("c1", "s1");
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "写测试" });
    expect(proxy.promptAsync).toHaveBeenCalledWith("s1", "写测试");
  });

  it("未绑定时发文本自动 /new", async () => {
    const { adapter, proxy } = makeMocks();
    const bridge = new Bridge(adapter, proxy, {});
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "hello" });
    expect(proxy.createSession).toHaveBeenCalled();
  });

  it("/abort 中止当前会话", async () => {
    const { adapter, proxy } = makeMocks();
    const bridge = new Bridge(adapter, proxy, {});
    bridge.bindSession("c1", "s1");
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "/abort" });
    expect(proxy.abort).toHaveBeenCalledWith("s1");
  });

  it("callback once 调用 respondPermission(once)", async () => {
    const { adapter, proxy } = makeMocks();
    const bridge = new Bridge(adapter, proxy, { autoApprove: false });
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "", callbackData: "once:s1:p1" });
    expect(proxy.respondPermission).toHaveBeenCalledWith("s1", "p1", "once");
  });

  it("autoApprove=true 时自动通过权限(always)", async () => {
    const { adapter, proxy } = makeMocks();
    const bridge = new Bridge(adapter, proxy, { autoApprove: true });
    bridge.bindSession("c1", "s1");
    bridge.handleProxyEvent({ chatId: "c1", kind: "permission", text: "🔐 bash", permissionId: "p1", permissionSessionId: "s1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(proxy.respondPermission).toHaveBeenCalledWith("s1", "p1", "always");
  });
});
