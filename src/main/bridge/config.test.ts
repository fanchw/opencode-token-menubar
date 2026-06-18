import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBridgeConfig } from "./config.js";

describe("readBridgeConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `bridge-cfg-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("返回 undefined 当文件不存在", () => {
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined();
  });

  it("解析完整配置并填充默认值", () => {
    writeFileSync(
      join(dir, "bridge.json"),
      JSON.stringify({ telegram: { botToken: "abc:123" } }),
    );
    const cfg = readBridgeConfig(join(dir, "bridge.json"));
    expect(cfg).toBeDefined();
    expect(cfg!.telegram.botToken).toBe("abc:123");
    expect(cfg!.opencode.baseUrl).toBeUndefined();
    expect(cfg!.throttleMs).toBe(1500);
    expect(cfg!.autoApprove).toBe(false);
    expect(cfg!.allowlist).toBeUndefined();
  });

  it("缺 botToken 时返回 undefined", () => {
    writeFileSync(join(dir, "bridge.json"), JSON.stringify({ telegram: {} }));
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined();
  });

  it("尊重自定义 baseUrl / throttleMs / autoApprove / allowlist", () => {
    writeFileSync(
      join(dir, "bridge.json"),
      JSON.stringify({
        telegram: { botToken: "t" },
        opencode: { baseUrl: "http://host:1234" },
        throttleMs: 3000,
        autoApprove: true,
        allowlist: [111, 222],
      }),
    );
    const cfg = readBridgeConfig(join(dir, "bridge.json"))!;
    expect(cfg.opencode.baseUrl).toBe("http://host:1234");
    expect(cfg.throttleMs).toBe(3000);
    expect(cfg.autoApprove).toBe(true);
    expect(cfg.allowlist).toEqual([111, 222]);
  });

  it("损坏的 JSON 返回 undefined", () => {
    writeFileSync(join(dir, "bridge.json"), "{not json");
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined();
  });

  it("根值为非对象（null/数字/字符串）时返回 undefined", () => {
    writeFileSync(join(dir, "bridge.json"), "null");
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined();
    writeFileSync(join(dir, "bridge.json"), "42");
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined();
    writeFileSync(join(dir, "bridge.json"), '"a string"');
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined();
  });

  it("throttleMs 为 NaN 或非数字时用默认值 1500", () => {
    writeFileSync(
      join(dir, "bridge.json"),
      JSON.stringify({ telegram: { botToken: "t" }, throttleMs: "fast" }),
    );
    const cfg = readBridgeConfig(join(dir, "bridge.json"))!;
    expect(cfg.throttleMs).toBe(1500);
  });

  it("allowlist 混合类型时只保留数字，空数组返回 undefined", () => {
    writeFileSync(
      join(dir, "bridge.json"),
      JSON.stringify({ telegram: { botToken: "t" }, allowlist: [1, "x", 2] }),
    );
    const cfg = readBridgeConfig(join(dir, "bridge.json"))!;
    expect(cfg.allowlist).toEqual([1, 2]);

    writeFileSync(
      join(dir, "bridge.json"),
      JSON.stringify({ telegram: { botToken: "t" }, allowlist: [] }),
    );
    const cfg2 = readBridgeConfig(join(dir, "bridge.json"))!;
    expect(cfg2.allowlist).toBeUndefined();
  });
});
