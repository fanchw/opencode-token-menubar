import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ApiResponse, MetricEvent } from "../shared/metrics.js";
import { normalizeMetricEvent } from "../shared/metrics.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

export class RequestBodyReadError extends Error {
  constructor() {
    super("failed to read request body");
  }
}

export interface StartIngestServerOptions {
  ingestPath: string;
  maxBodyBytes?: number;
  onListening?(url: string): void;
  onMetric(metric: MetricEvent): void | Promise<void>;
}

export interface IngestServerHandle {
  url: string;
  token: string;
  stop(): Promise<void>;
}

function sendJson<T>(response: ServerResponse, statusCode: number, body: ApiResponse<T>): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readRequestBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    request.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }

      totalBytes += chunk.byteLength;

      if (totalBytes > maxBodyBytes) {
        chunks.length = 0;
        request.resume();
        settle(() => reject(new RequestBodyTooLargeError()));
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      settle(() => resolve(Buffer.concat(chunks).toString("utf8")));
    });

    request.on("error", () => settle(() => reject(new RequestBodyReadError())));
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("failed to bind ingest server"));
        return;
      }

      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function startIngestServer(options: StartIngestServerOptions): Promise<IngestServerHandle> {
  const token = randomBytes(32).toString("hex");
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let stopped = false;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { code: 405, message: "method not allowed", data: null });
      return;
    }

    if (request.url !== "/metrics") {
      sendJson(response, 404, { code: 404, message: "not found", data: null });
      return;
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      sendJson(response, 401, { code: 401, message: "invalid token", data: null });
      return;
    }

    try {
      const body = await readRequestBody(request, maxBodyBytes);
      const rawMetric = JSON.parse(body);
      const metric = normalizeMetricEvent(rawMetric);

      if (!metric) {
        sendJson(response, 422, { code: 422, message: "invalid metric payload", data: null });
        return;
      }

      await options.onMetric(metric);
      sendJson(response, 200, { code: 0, message: "ok", data: { accepted: true } });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendJson(response, 413, { code: 413, message: "request body too large", data: null });
        return;
      }

      if (error instanceof RequestBodyReadError) {
        sendJson(response, 400, { code: 400, message: "failed to read request body", data: null });
        return;
      }

      if (error instanceof SyntaxError) {
        sendJson(response, 422, { code: 422, message: "invalid metric payload", data: null });
        return;
      }

      sendJson(response, 500, { code: 500, message: "failed to store metric", data: null });
    }
  });
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}/metrics`;
  options.onListening?.(url);

  try {
    await mkdir(dirname(options.ingestPath), { recursive: true });
    await writeFile(
      options.ingestPath,
      `${JSON.stringify({ url, token, updatedAt: new Date().toISOString() })}\n`,
    );
  } catch (error) {
    stopped = true;
    await close(server);
    throw error;
  }

  return {
    url,
    token,
    stop: async () => {
      if (!stopped) {
        stopped = true;
        await close(server);
      }

      await rm(options.ingestPath, { force: true });
    },
  };
}
