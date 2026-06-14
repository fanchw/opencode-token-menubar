import type { MetricEvent } from "./metrics.js";

export interface MessageSnapshot {
  updatedAt: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  firstSeenAt: number;
  stepStartedAt: number | undefined;
  firstTokenAt: number | undefined;
}

const listenedEvents = new Set(["message.updated", "message.part.updated", "message.part.delta"]);

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
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

  return (
    readString(info?.id) ??
    readString(part?.messageID) ??
    readString(part?.messageId) ??
    readString(event.messageID) ??
    readString(event.messageId) ??
    readString(properties?.messageID) ??
    readString(properties?.messageId) ??
    readString(event.id)
  );
}

function providerAndModel(
  event: Record<string, unknown>,
  fallback?: { provider: string; model: string },
): { provider: string; model: string } {
  const properties = readRecord(event.properties);
  const info = readRecord(properties?.info);
  const nested = readRecord(event.model) ?? readRecord(info?.model);
  const message = readRecord(event.message);

  return {
    provider:
      readString(event.provider) ??
      readString(properties?.provider) ??
      readString(info?.providerID) ??
      readString(message?.provider) ??
      readString(nested?.providerID) ??
      readString(nested?.provider) ??
      fallback?.provider ??
      "unknown",
    model:
      readString(event.model) ??
      readString(properties?.model) ??
      readString(info?.modelID) ??
      readString(message?.model) ??
      readString(nested?.modelID) ??
      readString(nested?.id) ??
      readString(nested?.model) ??
      fallback?.model ??
      "unknown",
  };
}

function tokenCounts(event: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
} {
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
  const outputTokens = readUsageNumber([
    "outputTokens",
    "completionTokens",
    "completion_tokens",
    "output_tokens",
    "output",
  ]);
  const totalTokens = readUsageNumber(["totalTokens", "total_tokens"]);
  const reasoningTokens = readNumber(tokens?.reasoning) ?? 0;
  const cacheReadTokens = readNumber(cache?.read) ?? 0;
  const cacheWriteTokens = readNumber(cache?.write) ?? 0;

  return {
    inputTokens:
      (inputTokens ?? Math.max(0, (totalTokens ?? 0) - (outputTokens ?? 0))) + cacheReadTokens + cacheWriteTokens,
    outputTokens:
      (outputTokens ?? Math.max(0, (totalTokens ?? 0) - (inputTokens ?? 0))) + reasoningTokens,
    cacheTokens: cacheReadTokens + cacheWriteTokens,
  };
}

export function toMetricEvent(
  event: unknown,
  previous: MessageSnapshot | undefined,
  now: number,
): { event?: MetricEvent; snapshot?: MessageSnapshot; id?: string } | undefined {
  const payload = unwrapEvent(event);
  if (!payload) return undefined;

  const type = readString(payload.type) ?? readString(payload.event);
  const id = requestId(payload);
  if (!id || !listenedEvents.has(type ?? "")) return undefined;

  const properties = readRecord(payload.properties);
  const part = readRecord(properties?.part);
  const partType = readString(part?.type);

  let stepStartedAt = previous?.stepStartedAt;
  let firstTokenAt = previous?.firstTokenAt;

  // step-start 事件标记请求真正开始的时间
  if (type === "message.part.updated" && partType === "step-start") {
    stepStartedAt = now;
  }

  // 仅 message.part.delta（实际文本内容到达）才标记首字时间
  // 不用 message.part.updated type=text，那是 text-start（文本块开始），与 step-start 几乎同时
  if (firstTokenAt === undefined && type === "message.part.delta") {
    firstTokenAt = now;
  }

  const firstSeenAt = previous?.firstSeenAt ?? now;
  const metadata = providerAndModel(payload, previous);
  const { inputTokens, outputTokens, cacheTokens } = tokenCounts(payload);

  const snapshot: MessageSnapshot = {
    updatedAt: now,
    provider: metadata.provider,
    model: metadata.model,
    inputTokens,
    outputTokens,
    cacheTokens,
    firstSeenAt,
    stepStartedAt,
    firstTokenAt,
  };

  // message.part.delta 和 step-start 不携带 token 数据，仅更新 snapshot
  if (type === "message.part.delta") return { id, snapshot };
  if (partType === "step-start") return { id, snapshot };

  const deltaInputTokens = Math.max(0, inputTokens - (previous?.inputTokens ?? 0));
  const deltaOutputTokens = Math.max(0, outputTokens - (previous?.outputTokens ?? 0));
  const deltaCacheTokens = Math.max(0, cacheTokens - (previous?.cacheTokens ?? 0));
  const totalTokens = deltaInputTokens + deltaOutputTokens;

  if (totalTokens <= 0) return { id, snapshot };

  // Duration 和 TTFT 以 stepStartedAt 为基准（step-start 事件时间），
  // 若未捕获则回退到 firstSeenAt（首次见到该 message 的时间）
  const referenceTime = stepStartedAt ?? firstSeenAt;
  const durationMs = previous ? Math.max(0, now - referenceTime) : 0;
  const firstTokenLatencyMs = firstTokenAt !== undefined ? Math.max(0, firstTokenAt - referenceTime) : null;

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
      cacheTokens: deltaCacheTokens,
      totalTokens,
      durationMs,
      tokensPerSecond: durationMs > 0 ? totalTokens / (durationMs / 1000) : 0,
      firstTokenLatencyMs,
    },
  };
}
