/**
 * Shared scaffolding for the voice relay suites (mega-run C1). Real HTTP upgrade + real ws
 * client against attachVoiceServer with the STUB providers - no vendor keys, no network.
 * Auth uses REAL platform session JWTs (signToken) with the activation cache seeded, so the
 * verifySseToken chokepoint runs for real (fail-closed included).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket as WsClient } from 'ws';
import { attachVoiceServer } from '../../src/voice/index.js';
import { signToken } from '../../src/auth/jwt.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetVoiceSessionsForTests } from '../../src/voice/session.js';
import { loadConfig, __resetConfigForTests, __resetVoiceConfigForTests } from '../../src/config.js';

export type LogEntry = [string, Record<string, unknown>];

export function initVoiceTestEnv(): void {
  process.env.ENCRYPTION_KEY = 'test-key';
  process.env.JWT_SECRET = 'test-secret';
  __resetConfigForTests();
  __resetVoiceConfigForTests();
  loadConfig();
}

export function resetVoiceTestState(): void {
  __resetActivationForTests();
  __resetVoiceSessionsForTests();
  __resetVoiceConfigForTests();
}

export interface VoiceTestServer {
  server: Server;
  port: number;
  logs: LogEntry[];
}

export async function startVoiceServer(): Promise<VoiceTestServer> {
  const logs: LogEntry[] = [];
  const server = createServer();
  attachVoiceServer(server, { log: (event, fields) => logs.push([event, fields]) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return { server, port: (server.address() as AddressInfo).port, logs };
}

export async function stopVoiceServer(t: VoiceTestServer): Promise<void> {
  await new Promise<void>((resolve) => t.server.close(() => resolve()));
}

/** Seed an ACTIVE user in the activation cache and mint a real session JWT for them. */
export function seedUserToken(userId: string, orgId: string, username: string): string {
  setActivation(userId, { active: true, billingLocked: false });
  return signToken({ sub: userId, role: 'user', scope: 'user', orgId, username }).token;
}

export interface CollectedMessage {
  json?: unknown;
  binary?: Buffer;
  at: number;
}

/** A ws client that records every message (JSON + binary) in arrival order. */
export class VoiceClient {
  readonly messages: CollectedMessage[] = [];
  readonly client: WsClient;
  closed = false;
  private opened = false;

  constructor(url: string) {
    this.client = new WsClient(url);
    this.client.on('open', () => { this.opened = true; });
    this.client.on('close', () => { this.closed = true; });
    this.client.on('error', () => { /* rejection paths assert via waitOpen(false) */ });
    this.client.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) this.messages.push({ binary: data, at: Date.now() });
      else this.messages.push({ json: JSON.parse(data.toString('utf8')), at: Date.now() });
    });
  }

  /** Resolve true when the socket opens, false when it is rejected/errored/timed out. */
  waitOpen(timeoutMs = 4000): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.opened) return resolve(true);
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.client.on('open', () => { clearTimeout(timer); resolve(true); });
      this.client.on('error', () => { clearTimeout(timer); resolve(false); });
      this.client.on('close', () => { clearTimeout(timer); resolve(false); });
    });
  }

  jsonMessages(): unknown[] {
    return this.messages.filter((m) => m.json !== undefined).map((m) => m.json);
  }

  binaryFrames(): Buffer[] {
    return this.messages.filter((m) => m.binary !== undefined).map((m) => m.binary as Buffer);
  }

  /** Wait until a JSON message satisfying `pred` has arrived (polling; deterministic order). */
  async waitForJson(pred: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.jsonMessages().find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`timed out waiting for message; got ${JSON.stringify(this.jsonMessages())}`);
      await sleep(10);
    }
  }

  async waitClosed(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('timed out waiting for close');
      await sleep(10);
    }
  }

  terminate(): void {
    try { this.client.terminate(); } catch { /* already closed */ }
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
