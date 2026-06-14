import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { compactJsonlFile, readJsonlEvents } from "./jsonlImporter.js";
import { resolveAppPaths } from "./paths.js";

describe("resolveAppPaths", () => {
  test("resolves OpenCode metric and app paths", () => {
    expect(resolveAppPaths("/app/root", "/user/data")).toEqual({
      configPath: join(homedir(), ".config", "opencode", "opencode.json"),
      jsonlPath: join(homedir(), ".config", "opencode", "token-metrics", "events.jsonl"),
      ingestPath: join(homedir(), ".config", "opencode", "token-metrics", "ingest.json"),
      sqlitePath: join("/user/data", "metrics.db"),
      pluginPath: join(homedir(), ".config", "opencode", "plugins", "token-metrics.ts"),
      pluginSharedPath: join(homedir(), ".config", "opencode", "shared", "pluginMetric.ts"),
      bundledPluginPath: join("/app/root", "plugin", "token-metrics.ts"),
      bundledPluginSharedPath: join("/app/root", "src", "shared", "pluginMetric.ts"),
    });
  });
});

describe("readJsonlEvents", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function tempFile(content: string): string {
    tempDir = mkdtempSync(join(tmpdir(), "jsonl-importer-"));
    const filePath = join(tempDir, "events.jsonl");
    writeFileSync(filePath, content);
    return filePath;
  }

  function metricLine(id: string): string {
    return JSON.stringify({
      id,
      timestamp: "2026-06-11T01:02:03.000Z",
      provider: "anthropic",
      model: "claude-sonnet-4",
      inputTokens: 10.8,
      outputTokens: 5,
      durationMs: 3000,
    });
  }

  test("returns normalized events with the next read offset", () => {
    const content = [
      metricLine("req-1"),
      "",
      "not json",
      JSON.stringify({ timestamp: "2026-06-11T01:02:03.000Z" }),
    ].join("\n") + "\n";
    const filePath = tempFile(content);
    const fileSize = Buffer.byteLength(content);

    expect(readJsonlEvents(filePath)).toEqual({
      events: [
        {
          id: "req-1",
          timestamp: "2026-06-11T01:02:03.000Z",
          provider: "anthropic",
          model: "claude-sonnet-4",
          inputTokens: 10,
          outputTokens: 5,
          cacheTokens: 0,
          totalTokens: 15,
          durationMs: 3000,
          tokensPerSecond: 5,
          firstTokenLatencyMs: null,
        },
      ],
      errors: 2,
      nextOffset: fileSize,
    });
  });

  test("reads only appended events after the previous offset", () => {
    const filePath = tempFile(`${metricLine("req-1")}\n`);
    const firstRead = readJsonlEvents(filePath);

    appendFileSync(filePath, `${metricLine("req-2")}\n`);

    expect(readJsonlEvents(filePath, firstRead.nextOffset)).toEqual({
      events: [
        {
          id: "req-2",
          timestamp: "2026-06-11T01:02:03.000Z",
          provider: "anthropic",
          model: "claude-sonnet-4",
          inputTokens: 10,
          outputTokens: 5,
          cacheTokens: 0,
          totalTokens: 15,
          durationMs: 3000,
          tokensPerSecond: 5,
          firstTokenLatencyMs: null,
        },
      ],
      errors: 0,
      nextOffset: firstRead.nextOffset + Buffer.byteLength(`${metricLine("req-2")}\n`),
    });
  });

  test("leaves a partial trailing line for the next read", () => {
    const firstLine = `${metricLine("req-1")}\n`;
    const partialLine = metricLine("多字节-req-2");
    const filePath = tempFile(firstLine + partialLine);

    const firstRead = readJsonlEvents(filePath);

    expect(firstRead.events.map((event) => event.id)).toEqual(["req-1"]);
    expect(firstRead.errors).toBe(0);
    expect(firstRead.nextOffset).toBe(Buffer.byteLength(firstLine));

    appendFileSync(filePath, "\n");

    expect(readJsonlEvents(filePath, firstRead.nextOffset)).toEqual({
      events: [
        {
          id: "多字节-req-2",
          timestamp: "2026-06-11T01:02:03.000Z",
          provider: "anthropic",
          model: "claude-sonnet-4",
          inputTokens: 10,
          outputTokens: 5,
          cacheTokens: 0,
          totalTokens: 15,
          durationMs: 3000,
          tokensPerSecond: 5,
          firstTokenLatencyMs: null,
        },
      ],
      errors: 0,
      nextOffset: Buffer.byteLength(firstLine + partialLine + "\n"),
    });
  });

  test("restarts from the beginning when the start offset is past the file size", () => {
    const filePath = tempFile(`${metricLine("req-1")}\n`);

    expect(readJsonlEvents(filePath, 999_999).events.map((event) => event.id)).toEqual(["req-1"]);
  });

  test("returns no events for a missing file", () => {
    tempDir = mkdtempSync(join(tmpdir(), "jsonl-importer-"));

    expect(readJsonlEvents(join(tempDir, "missing-events.jsonl"))).toEqual({
      events: [],
      errors: 0,
      nextOffset: 0,
    });
  });

  test("compacts imported complete lines and preserves a trailing partial line", () => {
    const firstLine = `${metricLine("req-1")}\n`;
    const partialLine = metricLine("多字节-req-2");
    const filePath = tempFile(firstLine + partialLine);
    const firstRead = readJsonlEvents(filePath);

    compactJsonlFile(filePath, firstRead.nextOffset);

    expect(readFileSync(filePath, "utf8")).toBe(partialLine);

    appendFileSync(filePath, "\n");

    expect(readJsonlEvents(filePath)).toEqual({
      events: [
        {
          id: "多字节-req-2",
          timestamp: "2026-06-11T01:02:03.000Z",
          provider: "anthropic",
          model: "claude-sonnet-4",
          inputTokens: 10,
          outputTokens: 5,
          cacheTokens: 0,
          totalTokens: 15,
          durationMs: 3000,
          tokensPerSecond: 5,
          firstTokenLatencyMs: null,
        },
      ],
      errors: 0,
      nextOffset: Buffer.byteLength(partialLine + "\n"),
    });
  });

  test("compacts using byte offsets when imported prefix contains multibyte characters", () => {
    const importedLine = `${metricLine("已导入-req-1")}\n`;
    const remainingLine = `${metricLine("req-2")}\n`;
    const filePath = tempFile(importedLine + remainingLine);

    compactJsonlFile(filePath, Buffer.byteLength(importedLine));

    expect(readFileSync(filePath, "utf8")).toBe(remainingLine);
    expect(readJsonlEvents(filePath).events.map((event) => event.id)).toEqual(["req-2"]);
  });

  test("compacts all imported content to an empty file", () => {
    const content = `${metricLine("req-1")}\n`;
    const filePath = tempFile(content);

    compactJsonlFile(filePath, Buffer.byteLength(content));

    expect(readFileSync(filePath, "utf8")).toBe("");
    expect(readJsonlEvents(filePath)).toEqual({
      events: [],
      errors: 0,
      nextOffset: 0,
    });
  });
});
