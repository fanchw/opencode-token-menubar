import { describe, expect, test } from "vitest";

import { toMetricEvent } from "./pluginMetric.js";

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
      inputTokens: 100,
      outputTokens: 57,
      totalTokens: 157,
      durationMs: 1000,
      tokensPerSecond: 157,
    });
  });

  test("reads model identity from message part events", () => {
    const previous = {
      updatedAt: 1781248819000,
      provider: "zhipuai-coding-plan",
      model: "glm-5.1",
      inputTokens: 100,
      outputTokens: 57,
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
});
