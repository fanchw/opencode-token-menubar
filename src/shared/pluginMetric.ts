import type { MetricEvent } from "./metrics.js";

export interface MessageSnapshot {
  updatedAt: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const metricEvents = new Set(["message.updated", "message.part.updated"]);

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function unwrapEvent(value: unknown): Record<string, unknown> | undefined {
  const event = readRecord(value);
  if (!event) return undefined;

  return readRecord(event.event) ?? event;
}

function requestId(event: Record<string, unknown>): string | undefined {
  const properties = readRecord(event.properties);
  const info = readRecord(properties?.info);
  const part = readRecord(properties?.part);

  return readString(info?.id)
    ?? readString(part?.messageID)
    ?? readString(part?.messageId)
    ?? readString(event.messageID)
    ?? readString(event.messageId)
    ?? readString(properties?.messageID)
    ?? readString(properties?.messageId)
    ?? readString(event.id);
}

function providerAndModel(event: Record<string, unknown>, fallback?: { provider: string; model: string }): { provider: string; model: string } {
  const properties = readRecord(event.properties);
  const info = readRecord(properties?.info);
  const nested = readRecord(event.model) ?? readRecord(info?.model);
  const message = readRecord(event.message);

  return {
    provider: readString(event.provider) ?? readString(properties?.provider) ?? readString(message?.provider) ?? readString(nested?.providerID) ?? readString(nested?.provider) ?? fallback?.provider ?? "unknown",
    model: readString(event.model) ?? readString(properties?.model) ?? readString(message?.model) ?? readString(nested?.modelID) ?? readString(nested?.id) ?? readString(nested?.model) ?? fallback?.model ?? "unknown",
  };
}

function tokenCounts(event: Record<string, unknown>): { inputTokens: number; outputTokens: number } {
  const properties = readRecord(event.properties);
  const info = readRecord(properties?.info);
  const tokens = readRecord(info?.tokens);
  const cache = readRecord(tokens?.cache);
  const usageSources = [
    event,
    readRecord(event.usage),
    readRecord(properties?.usage),
    readRecord(readRecord(event.message)?.usage),
    readRecord(readRecord(event.response)?.usage),
    tokens,
  ];

  const readUsageNumber = (fields: string[]): number | undefined => {
    for (const source of usageSources) {
      if (!source) continue;

      for (const field of fields) {
        const value = readNumber(source[field]);
        if (value !== undefined) return value;
      }
    }

    return undefined;
  };

  const inputTokens = readUsageNumber(["inputTokens", "promptTokens", "prompt_tokens", "input_tokens", "input"]);
  const outputTokens = readUsageNumber(["outputTokens", "completionTokens", "completion_tokens", "output_tokens", "output"]);
  const totalTokens = readUsageNumber(["totalTokens", "total_tokens"]);
  const reasoningTokens = readNumber(tokens?.reasoning) ?? 0;
  const cacheReadTokens = readNumber(cache?.read) ?? 0;
  const cacheWriteTokens = readNumber(cache?.write) ?? 0;

  return {
    inputTokens: inputTokens ?? Math.max(0, (totalTokens ?? 0) - (outputTokens ?? 0)),
    outputTokens: (outputTokens ?? Math.max(0, (totalTokens ?? 0) - (inputTokens ?? 0))) + reasoningTokens + cacheReadTokens + cacheWriteTokens,
  };
}

function eventTime(event: Record<string, unknown>, now: number): number {
  const properties = readRecord(event.properties);
  const info = readRecord(properties?.info);
  const time = readRecord(info?.time);

  return readNumber(time?.updated) ?? readNumber(time?.created) ?? readNumber(properties?.time) ?? now;
}

export function toMetricEvent(event: unknown, previous: MessageSnapshot | undefined, now: number): { event?: MetricEvent; snapshot?: MessageSnapshot; id?: string } | undefined {
  const payload = unwrapEvent(event);
  if (!payload) return undefined;

  const type = readString(payload.type) ?? readString(payload.event);
  const id = requestId(payload);
  if (!id || !metricEvents.has(type ?? "")) return undefined;

  const { inputTokens, outputTokens } = tokenCounts(payload);
  const metadata = providerAndModel(payload, previous);
  const updatedAt = eventTime(payload, now);
  const deltaInputTokens = Math.max(0, inputTokens - (previous?.inputTokens ?? 0));
  const deltaOutputTokens = Math.max(0, outputTokens - (previous?.outputTokens ?? 0));
  const totalTokens = deltaInputTokens + deltaOutputTokens;
  const durationMs = previous ? Math.max(0, updatedAt - previous.updatedAt) : Math.max(0, now - updatedAt);
  const snapshot = {
    updatedAt,
    provider: metadata.provider,
    model: metadata.model,
    inputTokens,
    outputTokens,
  };

  if (totalTokens <= 0) return { id, snapshot };

  return {
    id,
    snapshot,
    event: {
      id,
      timestamp: new Date(now).toISOString(),
      provider: metadata.provider,
      model: metadata.model,
      inputTokens: deltaInputTokens,
      outputTokens: deltaOutputTokens,
      totalTokens,
      durationMs,
      tokensPerSecond: durationMs > 0 ? totalTokens / (durationMs / 1000) : 0,
    },
  };
}
