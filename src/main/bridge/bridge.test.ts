import { describe, it, expect } from "vitest";
import { BridgeState } from "./bridge.js";

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
