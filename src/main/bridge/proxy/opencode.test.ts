import { describe, it, expect, vi } from "vitest";
import { OpenCodeProxy } from "./opencode.js";

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
