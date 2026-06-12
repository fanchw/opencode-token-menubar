import { closeSync, existsSync, fstatSync, ftruncateSync, openSync, readSync, writeSync } from "node:fs";

import { normalizeMetricEvent, type MetricEvent, type RawMetricEvent } from "../shared/metrics.js";

export interface JsonlImportResult {
  events: MetricEvent[];
  errors: number;
  nextOffset: number;
}

export function readJsonlEvents(filePath: string, startOffset = 0): JsonlImportResult {
  if (!existsSync(filePath)) {
    return { events: [], errors: 0, nextOffset: 0 };
  }

  const fileDescriptor = openSync(filePath, "r");
  const fileSize = fstatSync(fileDescriptor).size;
  const readOffset = startOffset > fileSize ? 0 : startOffset;
  const contentLength = fileSize - readOffset;
  const buffer = Buffer.alloc(contentLength);

  readSync(fileDescriptor, buffer, 0, contentLength, readOffset);
  closeSync(fileDescriptor);

  const lastNewlineIndex = buffer.lastIndexOf(0x0a);
  const completeLength = contentLength === 0 ? 0 : lastNewlineIndex + 1;
  const completeBuffer = buffer.subarray(0, completeLength);

  const events: MetricEvent[] = [];
  let errors = 0;

  for (const line of completeBuffer.toString("utf8").split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    try {
      const event = normalizeMetricEvent(JSON.parse(trimmedLine) as RawMetricEvent);

      if (event) {
        events.push(event);
      } else {
        errors += 1;
      }
    } catch {
      errors += 1;
    }
  }

  return { events, errors, nextOffset: readOffset + completeLength };
}

export function compactJsonlFile(filePath: string, importedOffset: number): void {
  if (!existsSync(filePath) || importedOffset <= 0) {
    return;
  }

  const fileDescriptor = openSync(filePath, "r+");

  try {
    const fileSize = fstatSync(fileDescriptor).size;

    if (importedOffset >= fileSize) {
      ftruncateSync(fileDescriptor, 0);
      return;
    }

    const remainingLength = fileSize - importedOffset;
    const remaining = Buffer.alloc(remainingLength);
    readSync(fileDescriptor, remaining, 0, remainingLength, importedOffset);
    ftruncateSync(fileDescriptor, 0);
    writeSync(fileDescriptor, remaining, 0, remainingLength, 0);
  } finally {
    closeSync(fileDescriptor);
  }
}
