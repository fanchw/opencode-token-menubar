import { describe, it, expect, vi } from "vitest";
import { OpenCodeProxy, mapOpenCodeEvent } from "./opencode.js";

// 构造 mock client
function makeMockClient(overrides: Record<string, unknown> = {}) {
  const session = {
    create: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
    list: vi.fn().mockResolvedValue({ data: [{ id: "sess-1", title: "t" }] }),
    get: vi.fn().mockResolvedValue({ data: { id: "sess-1", model: { id: "claude" } } }),
    abort: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
    promptAsync: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
    ...overrides,
  };
  const postSessionIdPermissionsPermissionId = vi.fn().mockResolvedValue({ data: {} });
  return { session, postSessionIdPermissionsPermissionId };
}

describe("OpenCodeProxy 控制方法", () => {
  it("createSession 返回 session id", async () => {
    const mock = makeMockClient();
    const proxy = new OpenCodeProxy(mock as never);
    expect(await proxy.createSession()).toBe("sess-1");
    expect(mock.session.create).toHaveBeenCalled();
  });

  it("listSessions 返回会话数组", async () => {
    const mock = makeMockClient();
    const proxy = new OpenCodeProxy(mock as never);
    const list = await proxy.listSessions();
    expect(list).toEqual([{ id: "sess-1", title: "t" }]);
  });

  it("getSession 调用 get 并返回 data", async () => {
    const mock = makeMockClient();
    const proxy = new OpenCodeProxy(mock as never);
    const s = await proxy.getSession("sess-1");
    expect(s).toEqual({ id: "sess-1", model: { id: "claude" } });
    expect(mock.session.get).toHaveBeenCalledWith({ path: { id: "sess-1" } });
  });

  it("abort 调用 session.abort", async () => {
    const mock = makeMockClient();
    const proxy = new OpenCodeProxy(mock as never);
    await proxy.abort("sess-1");
    expect(mock.session.abort).toHaveBeenCalledWith({ path: { id: "sess-1" } });
  });

  it("promptAsync 用正确的 parts 结构调用", async () => {
    const mock = makeMockClient();
    const proxy = new OpenCodeProxy(mock as never);
    await proxy.promptAsync("sess-1", "写测试");
    expect(mock.session.promptAsync).toHaveBeenCalledWith({
      path: { id: "sess-1" },
      body: { parts: [{ type: "text", text: "写测试" }] },
    });
  });

  it("respondPermission 调用权限响应端点", async () => {
    const mock = makeMockClient();
    const proxy = new OpenCodeProxy(mock as never);
    await proxy.respondPermission("sess-1", "perm-9", "once");
    expect(mock.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({
      path: { id: "sess-1", permissionID: "perm-9" },
      body: { response: "once" },
    });
  });
});

describe("mapOpenCodeEvent 事件映射", () => {
  const sessionId = "sess-1";

  it("session.status busy 映射为 thinking", () => {
    const out = mapOpenCodeEvent(
      { type: "session.status", properties: { sessionID: sessionId, status: "busy" } },
      "chat-1",
    );
    expect(out).toEqual({ chatId: "chat-1", kind: "thinking", text: "", sessionId });
  });

  it("session.status idle 映射为 done", () => {
    const out = mapOpenCodeEvent(
      { type: "session.status", properties: { sessionID: sessionId, status: "idle" } },
      "chat-1",
    );
    expect(out).toEqual({ chatId: "chat-1", kind: "done", text: "", sessionId });
  });

  it("message.part.delta 映射为 delta", () => {
    const out = mapOpenCodeEvent(
      { type: "message.part.delta", properties: { sessionID: sessionId, delta: "你好" } },
      "chat-1",
    );
    expect(out).toEqual({ chatId: "chat-1", kind: "delta", text: "你好", sessionId });
  });

  it("message.part.updated 带 text part 映射为 delta", () => {
    const out = mapOpenCodeEvent(
      { type: "message.part.updated", properties: { sessionID: sessionId, part: { type: "text", text: "完整文本" } } },
      "chat-1",
    );
    expect(out).toEqual({ chatId: "chat-1", kind: "delta", text: "完整文本", sessionId });
  });

  it("message.part.updated 带 tool part 无 output 时映射为 tool(start)", () => {
    const out = mapOpenCodeEvent(
      { type: "message.part.updated", properties: { sessionID: sessionId, part: { type: "tool", tool: "bash", input: { command: "ls" } } } },
      "chat-1",
    );
    expect(out?.kind).toBe("tool");
    expect(out?.toolName).toBe("bash");
    expect(out?.text).toBe("ls");
    expect(out?.toolStatus).toBe("start");
  });

  it("message.part.updated 带 tool part 有 output 时映射为 tool_result", () => {
    const out = mapOpenCodeEvent(
      { type: "message.part.updated", properties: { sessionID: sessionId, part: { type: "tool", tool: "bash", output: "file1\nfile2" } } },
      "chat-1",
    );
    expect(out?.kind).toBe("tool_result");
    expect(out?.toolName).toBe("bash");
    expect(out?.text).toBe("file1\nfile2");
    expect(out?.toolStatus).toBe("success");
  });

  it("permission.asked 映射为 permission 事件", () => {
    const out = mapOpenCodeEvent(
      { type: "permission.asked", properties: { sessionID: sessionId, id: "perm-1", permission: "bash", metadata: { command: "ls" } } },
      "chat-1",
    );
    expect(out?.kind).toBe("permission");
    expect(out?.permissionId).toBe("perm-1");
    expect(out?.permissionSessionId).toBe(sessionId);
    expect(out?.text).toContain("bash");
  });

  it("未知 type 返回 null（丢弃）", () => {
    const out = mapOpenCodeEvent({ type: "unknown.thing", properties: {} }, "chat-1");
    expect(out).toBeNull();
  });
});
