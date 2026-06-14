import { describe, expect, test } from "vitest";

import { toMetricEvent } from "./pluginMetric.js";
import type { MessageSnapshot } from "./pluginMetric.js";

describe("toMetricEvent", () => {
  test("reads nested OpenCode message update events", () => {
    const event = {
      event: {
        id: "evt-message",
        type: "message.updated",
        properties: {
          sessionID: "session-1",
          info: {
            id: "message-1",
            model: { providerID: "zhipuai-coding-plan", modelID: "glm-5.1" },
            tokens: { input: 100, output: 40, reasoning: 10, cache: { read: 5, write: 2 } },
            time: { updated: 1781248819000 },
          },
        },
      },
    };

    const metric = toMetricEvent(event, undefined, 1781248820000);

    expect(metric?.event).toEqual({
      id: "message-1",
      timestamp: "2026-06-12T07:20:20.000Z",
      provider: "zhipuai-coding-plan",
      model: "glm-5.1",
      inputTokens: 107,
      outputTokens: 50,
      cacheTokens: 7,
      totalTokens: 157,
      durationMs: 0,
      tokensPerSecond: 0,
      firstTokenLatencyMs: null,
    });
  });

  test("reads model identity from real OpenCode message info fields", () => {
    const event = {
      event: {
        id: "evt-message-real",
        type: "message.updated",
        properties: {
          sessionID: "session-1",
          info: {
            id: "message-1",
            modelID: "glm-5.1",
            providerID: "zhipuai-coding-plan",
            tokens: { total: 42475, input: 42136, output: 178, reasoning: 33, cache: { write: 0, read: 128 } },
            time: { created: 1781254021197 },
          },
        },
      },
    };

    const metric = toMetricEvent(event, undefined, 1781254022606);

    expect(metric?.event?.provider).toBe("zhipuai-coding-plan");
    expect(metric?.event?.model).toBe("glm-5.1");
  });

  test("reads model identity from message part events", () => {
    const previous: MessageSnapshot = {
      updatedAt: 1781248819000,
      provider: "zhipuai-coding-plan",
      model: "glm-5.1",
      inputTokens: 100,
      outputTokens: 57,
      cacheTokens: 0,
      firstSeenAt: 1781248819000,
      stepStartedAt: undefined,
      firstTokenAt: 1781248819000,
    };
    const event = {
      event: {
        id: "evt-part",
        type: "message.part.updated",
        properties: {
          part: { messageID: "message-1" },
          info: {
            model: { providerID: "zhipuai-coding-plan", modelID: "glm-5.1" },
            tokens: { input: 120, output: 80, reasoning: 5, cache: { read: 0, write: 0 } },
            time: { updated: 1781248821000 },
          },
        },
      },
    };

    const metric = toMetricEvent(event, previous, 1781248821000);

    expect(metric?.event?.provider).toBe("zhipuai-coding-plan");
    expect(metric?.event?.model).toBe("glm-5.1");
    expect(metric?.event?.inputTokens).toBe(20);
    expect(metric?.event?.outputTokens).toBe(28);
  });

  test("tracks TTFT via step-start + text delta events", () => {
    const msg = "msg-ttft";

    // step-start: 标记请求开始
    const stepStart = {
      event: {
        id: "evt-step-start",
        type: "message.part.updated",
        properties: {
          sessionID: "session-ttft",
          part: { messageID: msg, type: "step-start" },
        },
      },
    };

    // text delta: 标记首字到达
    const textDelta = {
      event: {
        id: "evt-delta",
        type: "message.part.delta",
        properties: {
          sessionID: "session-ttft",
          messageID: msg,
          partID: "part-1",
          field: "text",
          delta: "hello",
        },
      },
    };

    // message.updated: 携带 token 数据
    const tokenEvent = (input: number, output: number) => ({
      event: {
        id: "evt-tokens",
        type: "message.updated",
        properties: {
          sessionID: "session-ttft",
          info: {
            id: msg,
            model: { providerID: "zhipuai-coding-plan", modelID: "glm-5.1" },
            tokens: { input, output },
          },
        },
      },
    });

    // 1. step-start 事件 → 记录 stepStartedAt，不发 metric
    const r1 = toMetricEvent(stepStart, undefined, 1_000_000);
    expect(r1?.event).toBeUndefined();
    expect(r1?.snapshot?.stepStartedAt).toBe(1_000_000);
    expect(r1?.snapshot?.firstTokenAt).toBeUndefined();

    // 2. text delta 事件 → 记录 firstTokenAt，不发 metric
    const r2 = toMetricEvent(textDelta, r1?.snapshot, 1_005_000);
    expect(r2?.event).toBeUndefined();
    expect(r2?.snapshot?.stepStartedAt).toBe(1_000_000);
    expect(r2?.snapshot?.firstTokenAt).toBe(1_005_000);

    // 3. message.updated 携带 token → 发 metric，TTFT = 5000，Duration = 10000
    const r3 = toMetricEvent(tokenEvent(100, 50), r2?.snapshot, 1_010_000);
    expect(r3?.event?.firstTokenLatencyMs).toBe(5_000);
    expect(r3?.event?.durationMs).toBe(10_000);
    expect(r3?.snapshot?.firstTokenAt).toBe(1_005_000);
    expect(r3?.snapshot?.stepStartedAt).toBe(1_000_000);

    // 4. 后续 message.updated 不再改变 TTFT
    const r4 = toMetricEvent(tokenEvent(100, 80), r3?.snapshot, 1_015_000);
    expect(r4?.event?.firstTokenLatencyMs).toBe(5_000);
    expect(r4?.snapshot?.firstTokenAt).toBe(1_005_000);
  });

  test("falls back to firstSeenAt when step-start is missing", () => {
    const msg = "msg-fallback";

    const textDelta = {
      event: {
        id: "evt-delta",
        type: "message.part.delta",
        properties: {
          sessionID: "session-fallback",
          messageID: msg,
          partID: "part-1",
          field: "text",
          delta: "hi",
        },
      },
    };

    const tokenEvent = {
      event: {
        id: "evt-tokens",
        type: "message.updated",
        properties: {
          sessionID: "session-fallback",
          info: {
            id: msg,
            model: { providerID: "zhipuai-coding-plan", modelID: "glm-5.1" },
            tokens: { input: 100, output: 50 },
          },
        },
      },
    };

    // 没有 step-start，直接 text delta
    const r1 = toMetricEvent(textDelta, undefined, 1_000_000);
    expect(r1?.snapshot?.firstSeenAt).toBe(1_000_000);
    expect(r1?.snapshot?.firstTokenAt).toBe(1_000_000);

    // message.updated 发 metric，Duration 和 TTFT 都基于 firstSeenAt
    const r2 = toMetricEvent(tokenEvent, r1?.snapshot, 1_005_000);
    expect(r2?.event?.firstTokenLatencyMs).toBe(0);
    expect(r2?.event?.durationMs).toBe(5_000);
  });

  test("returns null TTFT when no text delta arrives", () => {
    const tokenEvent = {
      event: {
        id: "evt-tokens",
        type: "message.updated",
        properties: {
          sessionID: "session-no-ttft",
          info: {
            id: "msg-no-ttft",
            model: { providerID: "zhipuai-coding-plan", modelID: "glm-5.1" },
            tokens: { input: 100, output: 50 },
          },
        },
      },
    };

    const metric = toMetricEvent(tokenEvent, undefined, 1_000_000);
    expect(metric?.event?.firstTokenLatencyMs).toBe(null);
  });
});
