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
});
