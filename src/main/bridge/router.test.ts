import { describe, it, expect } from "vitest";
import { parseCommand } from "./router.js";

describe("parseCommand", () => {
  it("普通文本解析为 prompt", () => {
    expect(parseCommand("hello world")).toEqual({ kind: "prompt", text: "hello world" });
  });

  it("空文本解析为空 prompt", () => {
    expect(parseCommand("   ")).toEqual({ kind: "prompt", text: "" });
  });

  it("/new 解析为 new 命令", () => {
    expect(parseCommand("/new")).toEqual({ kind: "new" });
  });

  it("/abort 解析为 abort", () => {
    expect(parseCommand("/abort")).toEqual({ kind: "abort" });
  });

  it("/list 解析为 list", () => {
    expect(parseCommand("/list")).toEqual({ kind: "list" });
  });

  it("/status 解析为 status", () => {
    expect(parseCommand("/status")).toEqual({ kind: "status" });
  });

  it("/help 解析为 help", () => {
    expect(parseCommand("/help")).toEqual({ kind: "help" });
  });

  it("/switch 带参数解析 sessionId", () => {
    expect(parseCommand("/switch abc123")).toEqual({ kind: "switch", sessionId: "abc123" });
  });

  it("/switch 不带参数 sessionId 为空字符串", () => {
    expect(parseCommand("/switch")).toEqual({ kind: "switch", sessionId: "" });
  });

  it("命令大小写不敏感", () => {
    expect(parseCommand("/NEW")).toEqual({ kind: "new" });
  });

  it("未知 / 命令回退为 prompt", () => {
    expect(parseCommand("/unknown blah")).toEqual({ kind: "prompt", text: "/unknown blah" });
  });
});
