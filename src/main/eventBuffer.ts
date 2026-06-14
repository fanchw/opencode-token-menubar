import type { MetricEvent } from "../shared/metrics.js";

export interface EventBufferOptions {
  flushMs: number;
  onFlush: (events: MetricEvent[]) => void;
}

export class EventBuffer {
  private pending: MetricEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: EventBufferOptions) {}

  push(event: MetricEvent): void {
    this.pending.push(event);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.options.flushMs);
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    const events = this.pending;
    this.pending = [];
    this.options.onFlush(events);
  }

  get size(): number {
    return this.pending.length;
  }
}
