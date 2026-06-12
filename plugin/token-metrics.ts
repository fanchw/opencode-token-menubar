import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { toMetricEvent, type MessageSnapshot } from "../shared/pluginMetric.ts";

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

interface IngestMetadata {
  url: string;
  token: string;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

const outputPath = join(homedir(), ".config", "opencode", "token-metrics", "events.jsonl");
const ingestPath = join(homedir(), ".config", "opencode", "token-metrics", "ingest.json");
const snapshotTtlMs = 10 * 60 * 1000;
const ingestMetadataCacheTtlMs = 1000;
const maxSnapshots = 500;
const snapshots = new Map<string, MessageSnapshot>();
let ingestMetadataCache: { expiresAt: number; metadata: IngestMetadata | undefined } | undefined;

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

async function readIngestMetadata($: Shell): Promise<IngestMetadata | undefined> {
  const now = Date.now();
  if (ingestMetadataCache && now < ingestMetadataCache.expiresAt) {
    return ingestMetadataCache.metadata;
  }

  const script = [
    "const fs = require('node:fs');",
    "const target = process.argv[1];",
    "try {",
    "  const raw = fs.readFileSync(target, 'utf8');",
    "  const parsed = JSON.parse(raw);",
    "  if (typeof parsed.url === 'string' && typeof parsed.token === 'string') {",
    "    process.stdout.write(JSON.stringify({ url: parsed.url, token: parsed.token }));",
    "  }",
    "} catch {}",
  ].join("\n");

  try {
    const result = await $`node -e ${script} ${ingestPath}`;
    const raw = String(result.stdout ?? "").trim();
    if (!raw) {
      ingestMetadataCache = { expiresAt: now + ingestMetadataCacheTtlMs, metadata: undefined };
      return undefined;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.url !== "string" || typeof parsed.token !== "string") {
      ingestMetadataCache = { expiresAt: now + ingestMetadataCacheTtlMs, metadata: undefined };
      return undefined;
    }

    const metadata = { url: parsed.url, token: parsed.token };
    ingestMetadataCache = { expiresAt: now + ingestMetadataCacheTtlMs, metadata };
    return metadata;
  } catch {
    ingestMetadataCache = { expiresAt: now + ingestMetadataCacheTtlMs, metadata: undefined };
    return undefined;
  }
}

async function postMetric(metadata: IngestMetadata, metric: MetricEvent): Promise<boolean> {
  try {
    const response = await fetch(metadata.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${metadata.token}`,
      },
      body: JSON.stringify(metric),
    });
    if (!response.ok) {
      return false;
    }

    try {
      const body = await response.json() as ApiResponse<{ accepted: boolean } | null>;

      return body.code === 0 && body.data?.accepted === true;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

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

async function deliverMetric($: Shell, metric: MetricEvent): Promise<void> {
  const metadata = await readIngestMetadata($);
  if (metadata && await postMetric(metadata, metric)) {
    return;
  }

  await appendJsonl($, metric);
}

const plugin: Plugin = async ({ $ }) => {
  return {
    event: async (event: unknown) => {
      const now = Date.now();
      pruneSnapshots(now);

      const metric = toMetricEvent(event, undefined, now);
      if (!metric?.id) return;

      const nextMetric = toMetricEvent(event, snapshots.get(metric.id), now);
      if (nextMetric?.snapshot) snapshots.set(metric.id, nextMetric.snapshot);
      pruneSnapshots(now);

      if (nextMetric?.event) await deliverMetric($, nextMetric.event);
    },
  };
};

export default plugin;
