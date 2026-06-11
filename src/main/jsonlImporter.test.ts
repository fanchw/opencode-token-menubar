import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { readJsonlEvents } from "./jsonlImporter.js";
import { resolveAppPaths } from "./paths.js";

describe("resolveAppPaths", () => {
  test("resolves OpenCode metric and app paths", () => {
    expect(resolveAppPaths("/app/root", "/user/data")).toEqual({
      jsonlPath: join(homedir(), ".config", "opencode", "token-metrics", "events.jsonl"),
      sqlitePath: join("/user/data", "metrics.db"),
      pluginPath: join(homedir(), ".config", "opencode", "plugin", "token-metrics.ts"),
      bundledPluginPath: join("/app/root", "plugin", "token-metrics.ts"),
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
          totalTokens: 15,
          durationMs: 3000,
          tokensPerSecond: 5,
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
          totalTokens: 15,
          durationMs: 3000,
          tokensPerSecond: 5,
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
          totalTokens: 15,
          durationMs: 3000,
          tokensPerSecond: 5,
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
});
