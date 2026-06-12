import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

interface MessageSnapshot {
  updatedAt: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
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
const snapshotTtlMs = 10 * 60 * 1000;
const maxSnapshots = 500;
const metricEvents = new Set(["message.updated", "message.part.updated"]);
const snapshots = new Map<string, MessageSnapshot>();

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function requestId(event: Record<string, unknown>): string | undefined {
  return readString(event.id)
    ?? readString(event.messageID)
    ?? readString(event.messageId)
    ?? readString(event.requestID)
    ?? readString(event.requestId)
    ?? readString(event.sessionID)
    ?? readString(event.sessionId);
}

function providerAndModel(event: Record<string, unknown>, fallback?: { provider: string; model: string }): { provider: string; model: string } {
  const nested = typeof event.model === "object" && event.model !== null ? event.model as Record<string, unknown> : undefined;
  const properties = readRecord(event.properties);
  const message = readRecord(event.message);

  return {
    provider: readString(event.provider) ?? readString(properties?.provider) ?? readString(message?.provider) ?? readString(nested?.provider) ?? fallback?.provider ?? "unknown",
    model: readString(event.model) ?? readString(properties?.model) ?? readString(message?.model) ?? readString(nested?.id) ?? readString(nested?.model) ?? fallback?.model ?? "unknown",
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function tokenCounts(event: Record<string, unknown>): { inputTokens: number; outputTokens: number } {
  const usageSources = [
    event,
    readRecord(event.usage),
    readRecord(readRecord(event.properties)?.usage),
    readRecord(readRecord(event.message)?.usage),
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

function pruneSnapshots(now: number): void {
  for (const [id, request] of snapshots) {
    if (now - request.updatedAt <= snapshotTtlMs) {
      continue;
    }

    snapshots.delete(id);
  }

  while (snapshots.size > maxSnapshots) {
    const oldest = snapshots.keys().next().value;
    if (!oldest) {
      return;
    }

    snapshots.delete(oldest);
  }
}

type Shell = Parameters<Parameters<Plugin>[0]>[0]["$"];

async function appendJsonl($: Shell, metric: MetricEvent): Promise<void> {
  const script = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const target = process.argv[1];",
    "const line = Buffer.from(process.argv[2], 'base64').toString('utf8');",
    "fs.mkdirSync(path.dirname(target), { recursive: true });",
    "fs.appendFileSync(target, line + '\\n');",
  ].join("\n");

  await $`node -e ${script} ${outputPath} ${Buffer.from(JSON.stringify(metric)).toString("base64")}`;
}

const plugin: Plugin = async ({ $ }) => {
  return {
    event: async (event: unknown) => {
      if (typeof event !== "object" || event === null) {
        return;
      }

      const payload = event as Record<string, unknown>;
      const now = Date.now();
      pruneSnapshots(now);

      const type = readString(payload.type) ?? readString(payload.event);
      const id = requestId(payload);

      if (!id || !metricEvents.has(type ?? "")) {
        return;
      }

      const { inputTokens, outputTokens } = tokenCounts(payload);
      const previous = snapshots.get(id);
      const metadata = providerAndModel(payload, previous);
      const deltaInputTokens = Math.max(0, inputTokens - (previous?.inputTokens ?? 0));
      const deltaOutputTokens = Math.max(0, outputTokens - (previous?.outputTokens ?? 0));
      const totalTokens = deltaInputTokens + deltaOutputTokens;
      const durationMs = previous ? Math.max(0, now - previous.updatedAt) : 0;

      snapshots.set(id, {
        updatedAt: now,
        provider: metadata.provider,
        model: metadata.model,
        inputTokens,
        outputTokens,
      });
      pruneSnapshots(now);

      if (totalTokens <= 0) {
        return;
      }

      await appendJsonl($, {
        id: `${id}-${now}`,
        timestamp: new Date().toISOString(),
        provider: metadata.provider,
        model: metadata.model,
        inputTokens: deltaInputTokens,
        outputTokens: deltaOutputTokens,
        totalTokens,
        durationMs,
        tokensPerSecond: durationMs > 0 ? totalTokens / (durationMs / 1000) : 0,
      });
    },
  };
};

export default plugin;
