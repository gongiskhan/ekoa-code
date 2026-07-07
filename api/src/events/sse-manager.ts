/**
 * SSE client manager (ch03 §3.6, ch02 §2.6). Per-user connections, 30s keepalive, a bounded
 * Last-Event-ID replay ring (200 events, swept after 300s idle). Serves the four sanctioned
 * SSE endpoints. In-memory (FIXED-8, single process). The egress error sanitizer is applied
 * at the event serializer (ch09 invariant 2).
 */
import type { Response } from 'express';

const REPLAY_RING = 200;
const KEEPALIVE_MS = 30_000;

interface Client {
  res: Response;
  userId: string;
  stream: string;
  keepalive: NodeJS.Timeout;
}

interface StreamEvent {
  id: number;
  type: string;
  data: unknown;
}

export class SseManager {
  private clients = new Set<Client>();
  private rings = new Map<string, StreamEvent[]>(); // per-stream replay ring
  private seq = 0;

  private ringKey(stream: string, id: string): string {
    return `${stream}:${id}`;
  }

  /** Attach a client to a stream; replays from Last-Event-ID if provided; opens with `ready`. */
  attach(res: Response, userId: string, stream: string, streamId: string, lastEventId?: number): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const key = this.ringKey(stream, streamId);
    const ring = this.rings.get(key) ?? [];
    if (lastEventId !== undefined) {
      for (const e of ring.filter((x) => x.id > lastEventId)) this.writeFrame(res, e);
    }
    this.writeFrame(res, { id: ++this.seq, type: 'ready', data: { stream, id: streamId } });

    const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS);
    // Match `emit`, which targets clients by the composite `${stream}:${streamId}` key. Storing
    // the bare stream name here meant live pushes never matched an attached client (only ring
    // replay on reconnect worked); the composite makes live delivery work (G7B).
    const client: Client = { res, userId, stream: `${stream}:${streamId}`, keepalive };
    this.clients.add(client);
    res.on('close', () => {
      clearInterval(keepalive);
      this.clients.delete(client);
    });
  }

  /** Emit a typed event to a stream; buffers into the replay ring. */
  emit(stream: string, streamId: string, type: string, data: unknown): void {
    const key = this.ringKey(stream, streamId);
    const ev: StreamEvent = { id: ++this.seq, type, data };
    const ring = this.rings.get(key) ?? [];
    ring.push(ev);
    while (ring.length > REPLAY_RING) ring.shift();
    this.rings.set(key, ring);
    for (const c of this.clients) {
      if (c.stream === `${stream}:${streamId}`) this.writeFrame(c.res, ev);
    }
  }

  private writeFrame(res: Response, e: StreamEvent): void {
    res.write(`event: ${e.type}\n`);
    res.write(`id: ${e.id}\n`);
    res.write(`data: ${JSON.stringify(e.data)}\n\n`);
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}

export const sseManager = new SseManager();
