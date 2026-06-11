import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { Plugin } from "@opencode-ai/plugin";

interface PendingRequest {
  startedAt: number;
  provider: string;
  model: string;
}

interface MetricEvent {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  tokensPerSecond: number;
}

const outputPath = join(homedir(), ".config", "opencode", "token-metrics", "events.jsonl");
const pendingTtlMs = 10 * 60 * 1000;
const maxPendingRequests = 500;
const startEvents = new Set(["llm.start", "message.start"]);
const stopEvents = new Set(["llm.stop", "message.stop"]);
const pending = new Map<string, PendingRequest>();

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function requestId(event: Record<string, unknown>): string | undefined {
  return readString(event.id) ?? readString(event.requestID) ?? readString(event.requestId);
}

function providerAndModel(event: Record<string, unknown>, fallback?: { provider: string; model: string }): { provider: string; model: string } {
  const nested = typeof event.model === "object" && event.model !== null ? event.model as Record<string, unknown> : undefined;

  return {
    provider: readString(event.provider) ?? readString(nested?.provider) ?? fallback?.provider ?? "unknown",
    model: readString(event.model) ?? readString(nested?.id) ?? readString(nested?.model) ?? fallback?.model ?? "unknown",
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function tokenCounts(event: Record<string, unknown>): { inputTokens: number; outputTokens: number } {
  const usageSources = [
    event,
    readRecord(event.usage),
    readRecord(readRecord(event.response)?.usage),
  ];

  const readUsageNumber = (fields: string[]): number | undefined => {
    for (const source of usageSources) {
      if (!source) {
        continue;
      }

      for (const field of fields) {
        const value = source[field];
        if (typeof value === "number" && Number.isFinite(value)) {
          return Math.trunc(value);
        }
      }
    }

    return undefined;
  };

  const inputTokens = readUsageNumber(["inputTokens", "promptTokens", "prompt_tokens", "input_tokens"]);
  const outputTokens = readUsageNumber(["outputTokens", "completionTokens", "completion_tokens", "output_tokens"]);
  const totalTokens = readUsageNumber(["totalTokens", "total_tokens"]);

  return {
    inputTokens: inputTokens ?? Math.max(0, (totalTokens ?? 0) - (outputTokens ?? 0)),
    outputTokens: outputTokens ?? Math.max(0, (totalTokens ?? 0) - (inputTokens ?? 0)),
  };
}

function prunePending(now: number): void {
  for (const [id, request] of pending) {
    if (now - request.startedAt <= pendingTtlMs) {
      continue;
    }

    pending.delete(id);
  }

  while (pending.size > maxPendingRequests) {
    const oldest = pending.keys().next().value;
    if (!oldest) {
      return;
    }

    pending.delete(oldest);
  }
}

function appendJsonl(metric: MetricEvent): void {
  const script = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const target = process.argv[1];",
    "const line = Buffer.from(process.argv[2], 'base64').toString('utf8');",
    "fs.mkdirSync(path.dirname(target), { recursive: true });",
    "fs.appendFileSync(target, line + '\\n');",
  ].join("\n");

  spawn(process.execPath, ["-e", script, outputPath, Buffer.from(JSON.stringify(metric)).toString("base64")], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

const plugin: Plugin = async ({ client, $ }) => {
  $.on("event", async (event: unknown) => {
    if (typeof event !== "object" || event === null) {
      return;
    }

    const payload = event as Record<string, unknown>;
    const now = Date.now();
    prunePending(now);

    const type = readString(payload.type) ?? readString(payload.event);
    const id = requestId(payload);

    if (!id) {
      return;
    }

    if (startEvents.has(type ?? "")) {
      pending.set(id, { startedAt: now, ...providerAndModel(payload) });
      prunePending(now);
      return;
    }

    if (!stopEvents.has(type ?? "")) {
      return;
    }

    const started = pending.get(id);
    pending.delete(id);

    if (!started) {
      return;
    }

    const { inputTokens, outputTokens } = tokenCounts(payload);
    const totalTokens = inputTokens + outputTokens;
    const durationMs = Math.max(0, Date.now() - started.startedAt);
    const metadata = providerAndModel(payload, started);

    appendJsonl({
      id,
      timestamp: new Date().toISOString(),
      provider: metadata.provider,
      model: metadata.model,
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs,
      tokensPerSecond: durationMs > 0 ? totalTokens / (durationMs / 1000) : 0,
    });
  });
};

export default plugin;
