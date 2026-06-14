import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import type { RawMetricEvent } from "../shared/metrics.js";
import { startIngestServer } from "./ingestServer.js";

async function createIngestPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "opencode-ingest-server-"));
  const ingestPath = join(root, "state", "ingest.json");

  await mkdir(join(root, "state"), { recursive: true });

  return ingestPath;
}

async function postMetric(url: string, token: string, body: RawMetricEvent | string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("startIngestServer", () => {
  test("accepts a valid metric", async () => {
    const ingestPath = await createIngestPath();
    const accepted: unknown[] = [];
    const server = await startIngestServer({
      ingestPath,
      onMetric: (metric) => {
        accepted.push(metric);
      },
    });

    try {
      const response = await postMetric(server.url, server.token, {
        id: "req-1",
        timestamp: "2026-06-11T10:00:00.000Z",
        provider: "anthropic",
        model: "claude-sonnet-4",
        inputTokens: 120,
        outputTokens: 80,
        durationMs: 5000,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ code: 0, message: "ok", data: { accepted: true } });
      expect(accepted).toEqual([
        {
          id: "req-1",
          timestamp: "2026-06-11T10:00:00.000Z",
          provider: "anthropic",
          model: "claude-sonnet-4",
          inputTokens: 120,
          outputTokens: 80,
          cacheTokens: 0,
          totalTokens: 200,
          durationMs: 5000,
          tokensPerSecond: 40,
          firstTokenLatencyMs: null,
        },
      ]);
    } finally {
      await server.stop();
    }
  });

  test("writes server metadata", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    try {
      const metadata = JSON.parse(await readFile(ingestPath, "utf8"));

      expect(metadata.url).toBe(server.url);
      expect(metadata.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/metrics$/);
      expect(metadata.token).toBe(server.token);
      expect(new Date(metadata.updatedAt).toISOString()).toBe(metadata.updatedAt);
    } finally {
      await server.stop();
    }
  });

  test("rejects missing bearer token", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "req-1" }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: 401, message: "invalid token", data: null });
    } finally {
      await server.stop();
    }
  });

  test("rejects invalid bearer token", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { authorization: "Bearer wrong", "content-type": "application/json" },
        body: JSON.stringify({ id: "req-1" }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: 401, message: "invalid token", data: null });
    } finally {
      await server.stop();
    }
  });

  test("rejects non-POST requests", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    try {
      const response = await fetch(server.url, {
        method: "GET",
        headers: { authorization: `Bearer ${server.token}` },
      });

      expect(response.status).toBe(405);
      expect(await response.json()).toEqual({ code: 405, message: "method not allowed", data: null });
    } finally {
      await server.stop();
    }
  });

  test("rejects non-POST requests before route matching", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    try {
      const unknownUrl = server.url.replace("/metrics", "/unknown");
      const response = await fetch(unknownUrl, {
        method: "GET",
        headers: { authorization: `Bearer ${server.token}` },
      });

      expect(response.status).toBe(405);
      expect(await response.json()).toEqual({ code: 405, message: "method not allowed", data: null });
    } finally {
      await server.stop();
    }
  });

  test("rejects unknown routes", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    try {
      const unknownUrl = server.url.replace("/metrics", "/unknown");
      const response = await fetch(unknownUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${server.token}` },
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: 404, message: "not found", data: null });
    } finally {
      await server.stop();
    }
  });

  test("rejects invalid metric payloads", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    try {
      const response = await postMetric(server.url, server.token, { provider: "anthropic" });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ code: 422, message: "invalid metric payload", data: null });
    } finally {
      await server.stop();
    }
  });

  test("rejects oversized request bodies", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({
      ingestPath,
      maxBodyBytes: 8,
      onMetric: () => undefined,
    });

    try {
      const response = await postMetric(server.url, server.token, { id: "request-body-too-large" });
      const envelope = await response.json();

      expect(response.status).toBe(413);
      expect(envelope).toEqual({ code: 413, message: "request body too large", data: null });
      expect(Object.keys(envelope)).toEqual(["code", "message", "data"]);
    } finally {
      await server.stop();
    }
  });

  test("removes metadata on stop", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    await server.stop();

    await expect(readFile(ingestPath, "utf8")).rejects.toThrow();
  });

  test("allows stop to be called repeatedly", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({ ingestPath, onMetric: () => undefined });

    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
    await expect(readFile(ingestPath, "utf8")).rejects.toThrow();
  });

  test("closes server when metadata cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-ingest-server-"));
    const blockedParent = join(root, "blocked-parent");
    const ingestPath = join(blockedParent, "ingest.json");
    let listeningUrl = "";

    await writeFile(blockedParent, "not a directory");

    await expect(
      startIngestServer({
        ingestPath,
        onListening: (url) => {
          listeningUrl = url;
        },
        onMetric: () => undefined,
      }),
    ).rejects.toThrow();

    expect(listeningUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/metrics$/);
    await expect(
      fetch(listeningUrl, {
        method: "POST",
        headers: { authorization: "Bearer unused", "content-type": "application/json" },
        body: JSON.stringify({ id: "req-1" }),
      }),
    ).rejects.toThrow();
  });

  test("returns 500 when storing a metric fails", async () => {
    const ingestPath = await createIngestPath();
    const server = await startIngestServer({
      ingestPath,
      onMetric: () => {
        throw new Error("store failed");
      },
    });

    try {
      const response = await postMetric(server.url, server.token, { id: "req-1" });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: 500, message: "failed to store metric", data: null });
    } finally {
      await server.stop();
    }
  });

});
