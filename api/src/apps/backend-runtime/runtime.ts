/**
 * Artifact Backend Runtime - the load-bearing contract (Layer 2, B19). Ported from
 * the old services/artifact-backend/runtime.ts, with the model + notify capability
 * seams injected (handle-rpc.ts) and the store/bundle resolution re-homed on the
 * ekoa-code artifacts store.
 *
 * An artifact backend is server-side code an artifact owns (versioned with it,
 * deleted with it) that core invokes in response to events, through a
 * capability-scoped `ekoa` handle that holds no credentials. The contract is tiny
 * so the substrate (worker_threads today; child_process / Cloud Run later) can
 * change with ZERO artifact-code change.
 *
 * The four named lifecycle invariants (C05-20..23) live in `WorkerThreadRuntime`:
 *   - post-DELETE refusal: `revoke()` tombstones so a queued invoke never runs;
 *   - post-settle rejection: a capability call after the handler settled is refused;
 *   - hung-handler timeout: the worker is recycled and the next invoke cold-starts;
 *   - dry-run: persistent effects are captured (dryRunEffects), never persisted.
 */
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { statSync } from 'node:fs';
import { WORKER_BOOTSTRAP_SOURCE } from './worker-bootstrap.js';
import {
  executeCapability,
  mintCapabilityToken,
  verifyCapabilityToken,
  unavailableModelCapability,
  type CapabilityContext,
  type CapabilityDeps,
  type DryRunEffect,
} from './handle-rpc.js';

export interface BackendLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  meta?: Record<string, unknown>;
  at: string;
}

export interface InvokeResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  logs: BackendLogEntry[];
  dryRunEffects?: DryRunEffect[];
}

export interface InvokeOptions {
  dryRun?: boolean;
  timeoutMs?: number;
  invokedBy?: 'listener' | 'webhook' | 'manual' | 'sample';
}

export interface InvocationRecord {
  invokeId: string;
  entrypoint: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  dryRun: boolean;
  invokedBy: string;
  logs: BackendLogEntry[];
  dryRunEffects?: DryRunEffect[];
}

export type BackendState = 'idle' | 'running' | 'crashed' | 'stopped' | 'disabled';

export interface BackendRuntimeStatus {
  artifactId: string;
  state: BackendState;
  live: boolean;
  enabled: boolean;
  pending: number;
  lastInvocationAt?: string;
  lastError?: string;
}

export interface ArtifactBackendRuntime {
  invoke(artifactId: string, entrypoint: string, input: unknown, opts?: InvokeOptions): Promise<InvokeResult>;
  shutdown(artifactId: string): Promise<void>;
  revoke(artifactId: string): Promise<{ fullyDrained: boolean }>;
  dispose(): Promise<void>;
  getStatus(artifactId: string): BackendRuntimeStatus;
  getInvocations(artifactId: string, limit?: number): InvocationRecord[];
  getRecentLogs(artifactId: string, limit?: number): BackendLogEntry[];
  setEnabled(artifactId: string, enabled: boolean): void;
  isEnabled(artifactId: string): boolean;
}

export const DEFAULT_INVOKE_TIMEOUT_MS = 60_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

/** Null runtime - the default before a WorkerThreadRuntime is registered. */
export class NullArtifactBackendRuntime implements ArtifactBackendRuntime {
  async invoke(): Promise<InvokeResult> {
    return { ok: false, error: 'artifact backend runtime is not initialised', logs: [] };
  }
  async shutdown(): Promise<void> { /* nothing */ }
  async revoke(): Promise<{ fullyDrained: boolean }> { return { fullyDrained: true }; }
  async dispose(): Promise<void> { /* nothing */ }
  getStatus(artifactId: string): BackendRuntimeStatus {
    return { artifactId, state: 'stopped', live: false, enabled: true, pending: 0 };
  }
  getInvocations(): InvocationRecord[] { return []; }
  getRecentLogs(): BackendLogEntry[] { return []; }
  setEnabled(): void { /* no-op */ }
  isEnabled(): boolean { return true; }
}

let singleton: ArtifactBackendRuntime = new NullArtifactBackendRuntime();
export function getArtifactBackendRuntime(): ArtifactBackendRuntime {
  return singleton;
}
export function setArtifactBackendRuntime(rt: ArtifactBackendRuntime): void {
  singleton = rt;
}

/** Everything the runtime needs from core (extends the capability surface). */
export interface RuntimeDeps extends CapabilityDeps {
  resolveOwner(artifactId: string): Promise<{ ownerUserId: string; sharedData?: boolean } | null>;
  resolveBundlePath(artifactId: string): Promise<string | null>;
}

interface PendingInvoke {
  resolve(r: InvokeResult): void;
  dryRun: boolean;
  dryRunEffects: DryRunEffect[];
  logs: BackendLogEntry[];
  timer: NodeJS.Timeout;
  settled: boolean;
}

interface WorkerEntry {
  worker: Worker;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (err: Error) => void;
  readySettled: boolean;
  pending: Map<string, PendingInvoke>;
  idleTimer: NodeJS.Timeout | null;
  crashed: boolean;
}

const MAX_INVOCATION_HISTORY = 50;
const MAX_LOGS_PER_INVOKE = 200;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DRAIN_BACKSTOP_MS = 60_000;

function isMutatingCapability(method: string): boolean {
  return (
    method === 'appData.create' || method === 'appData.update' || method === 'appData.delete' ||
    method === 'appData.shared.create' || method === 'appData.shared.update' || method === 'appData.shared.delete' ||
    method === 'notify.inApp' || method === 'notify.email'
  );
}

/**
 * Worker-thread runtime. ONE worker per artifact; invocations to a single artifact
 * are SERIALIZED (per-artifact lane) with a per-invoke timeout; different artifacts
 * run concurrently. v1 isolation is JS-fault isolation (worker_threads share the
 * host); the contract is swappable to child_process / Cloud Run with no
 * artifact-code change.
 */
export class WorkerThreadRuntime implements ArtifactBackendRuntime {
  private readonly deps: RuntimeDeps;
  private readonly idleTimeoutMs: number;
  private readonly invokeTimeoutMs: number;
  private readonly startupTimeoutMs: number;

  private readonly workers = new Map<string, WorkerEntry>();
  private readonly liveArtifacts = new Set<string>();
  private readonly lanes = new Map<string, Promise<unknown>>();
  private readonly disabled = new Set<string>();
  private readonly revoked = new Set<string>();
  private readonly activeRpcs = new Map<string, Set<Promise<void>>>();
  private readonly invocations = new Map<string, InvocationRecord[]>();
  private invokeSeq = 0;

  constructor(deps?: Partial<RuntimeDeps>, opts: { idleTimeoutMs?: number; invokeTimeoutMs?: number; startupTimeoutMs?: number } = {}) {
    this.deps = { ...defaultRuntimeDeps(), ...deps };
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.invokeTimeoutMs = opts.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
    this.startupTimeoutMs = opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  }

  async invoke(artifactId: string, entrypoint: string, input: unknown, opts: InvokeOptions = {}): Promise<InvokeResult> {
    const prev = this.lanes.get(artifactId) ?? Promise.resolve();
    const run = prev.then(
      () => this.runOne(artifactId, entrypoint, input, opts),
      () => this.runOne(artifactId, entrypoint, input, opts),
    );
    this.lanes.set(artifactId, run.then(() => undefined, () => undefined));
    return run;
  }

  private async runOne(artifactId: string, entrypoint: string, input: unknown, opts: InvokeOptions): Promise<InvokeResult> {
    if (this.revoked.has(artifactId)) return revokedResult();
    if (this.disabled.has(artifactId)) return { ok: false, error: 'artifact backend is disabled', logs: [] };
    const owner = await this.deps.resolveOwner(artifactId);
    if (this.revoked.has(artifactId)) return revokedResult();
    if (!owner) return { ok: false, error: `artifact no longer exists: ${artifactId}`, logs: [] };
    const bundlePath = await this.deps.resolveBundlePath(artifactId);
    if (this.revoked.has(artifactId)) return revokedResult();
    if (!bundlePath) return { ok: false, error: 'no backend bundle for this artifact (build the backend first)', logs: [] };
    const ownerUserId = owner.ownerUserId;

    const entry = this.ensureEntry(artifactId);
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
    try {
      await this.awaitReady(entry);
    } catch (err) {
      void this.shutdown(artifactId);
      return { ok: false, error: `artifact backend worker failed to start: ${errMsg(err)}`, logs: [] };
    }
    if (this.revoked.has(artifactId)) {
      void this.shutdown(artifactId);
      return revokedResult();
    }

    const invokeId = `inv-${++this.invokeSeq}`;
    const dryRun = Boolean(opts.dryRun);
    const timeoutMs = opts.timeoutMs ?? this.invokeTimeoutMs;
    const ttlSec = Math.ceil(timeoutMs / 1000) + 30;
    const token = mintCapabilityToken(
      { artifactId, ownerUserId, sharedData: Boolean(owner.sharedData), scopes: ['appData', 'llm', 'notify'], entrypoint, dryRun },
      ttlSec,
    );
    let bundleVersion = 0;
    try { bundleVersion = statSync(bundlePath).mtimeMs; } catch { /* keep 0 */ }
    const bundleUrl = `${pathToFileURL(bundlePath).href}?v=${bundleVersion}`;
    const startedAt = new Date(this.deps.now()).toISOString();
    const start = this.deps.now();

    const result = await new Promise<InvokeResult>((resolve) => {
      const timer = setTimeout(() => this.settleByTimeout(artifactId, entry, invokeId, timeoutMs), timeoutMs);
      timer.unref?.();
      entry.pending.set(invokeId, { resolve, dryRun, dryRunEffects: [], logs: [], timer, settled: false });
      try {
        entry.worker.postMessage({ type: 'invoke', invokeId, entrypoint, input, token, bundleUrl });
      } catch (err) {
        this.settlePending(entry, invokeId, { ok: false, error: `failed to dispatch to worker: ${errMsg(err)}` });
      }
    });

    this.recordInvocation(artifactId, {
      invokeId, entrypoint, startedAt, durationMs: this.deps.now() - start,
      ok: result.ok, error: result.error, dryRun, invokedBy: opts.invokedBy ?? 'listener',
      logs: result.logs, dryRunEffects: result.dryRunEffects,
    });
    const live = this.workers.get(artifactId);
    if (live && !live.crashed) this.scheduleIdle(artifactId, live);
    return result;
  }

  private ensureEntry(artifactId: string): WorkerEntry {
    const existing = this.workers.get(artifactId);
    if (existing && !existing.crashed) return existing;
    if (existing) this.workers.delete(artifactId);
    const entry = this.spawn(artifactId);
    this.workers.set(artifactId, entry);
    this.liveArtifacts.add(artifactId);
    return entry;
  }

  private spawn(artifactId: string): WorkerEntry {
    const worker = new Worker(WORKER_BOOTSTRAP_SOURCE, {
      eval: true,
      workerData: { artifactId },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    const ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });
    ready.catch(() => { /* observed by awaitReady when an invoke waits */ });
    const entry: WorkerEntry = { worker, ready, resolveReady, rejectReady, readySettled: false, pending: new Map(), idleTimer: null, crashed: false };
    worker.on('message', (m) => this.onMessage(artifactId, entry, m));
    worker.on('error', (err) => this.onWorkerDown(artifactId, entry, `worker error: ${errMsg(err)}`));
    worker.on('exit', (code) => {
      if (!entry.crashed && code !== 0) this.onWorkerDown(artifactId, entry, `worker exited unexpectedly (code ${code})`);
    });
    return entry;
  }

  private awaitReady(entry: WorkerEntry): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`worker startup timed out after ${this.startupTimeoutMs}ms`)), this.startupTimeoutMs);
      t.unref?.();
      entry.ready.then(
        () => { clearTimeout(t); resolve(); },
        (err) => { clearTimeout(t); reject(err instanceof Error ? err : new Error(String(err))); },
      );
    });
  }

  private onMessage(artifactId: string, entry: WorkerEntry, m: unknown): void {
    if (!m || typeof m !== 'object') return;
    const msg = m as { type?: string; invokeId?: string; entry?: BackendLogEntry; [k: string]: unknown };
    switch (msg.type) {
      case 'ready':
        if (!entry.readySettled) { entry.readySettled = true; entry.resolveReady(); }
        break;
      case 'log': {
        const p = msg.invokeId ? entry.pending.get(msg.invokeId) : undefined;
        if (p && msg.entry && p.logs.length < MAX_LOGS_PER_INVOKE) p.logs.push(msg.entry);
        break;
      }
      case 'rpc':
        void this.onRpc(artifactId, entry, msg as unknown as RpcMessage);
        break;
      case 'invoke-result':
        this.settlePending(entry, String(msg.invokeId), { ok: Boolean(msg.ok), result: msg.result, error: typeof msg.error === 'string' ? msg.error : undefined });
        break;
    }
  }

  private async onRpc(artifactId: string, entry: WorkerEntry, m: RpcMessage): Promise<void> {
    const reply = (ok: boolean, value?: unknown, error?: string): void => {
      try { entry.worker.postMessage({ type: 'rpc-result', rpcId: m.rpcId, ok, value: ok ? safeClone(value) : undefined, error }); }
      catch { /* worker may be gone */ }
    };
    const claims = verifyCapabilityToken(m.token);
    if (!claims) return reply(false, undefined, 'invalid capability token');
    if (claims.artifactId !== artifactId) return reply(false, undefined, 'capability token artifact mismatch');

    // The capability is scoped to the IN-FLIGHT invocation. A post-settle RPC (a
    // dangling promise / background timer) is refused - the pending entry is deleted
    // on settle / timeout / shutdown (C05-21).
    const p = entry.pending.get(m.invokeId);
    if (!p) return reply(false, undefined, 'capability is no longer valid (invocation already settled)');
    const dryRunEffects = p.dryRunEffects;
    const ctx: CapabilityContext = {
      claims, deps: this.deps, dryRun: claims.dryRun, dryRunEffects,
      isLive: (id) => this.liveArtifacts.has(id),
    };
    const exec = (async () => {
      try {
        reply(true, await executeCapability(m.method, m.args ?? {}, ctx));
      } catch (err) {
        reply(false, undefined, errMsg(err));
      }
    })();
    if (isMutatingCapability(m.method)) this.trackRpc(artifactId, exec);
    await exec;
  }

  private trackRpc(artifactId: string, p: Promise<void>): void {
    let set = this.activeRpcs.get(artifactId);
    if (!set) { set = new Set(); this.activeRpcs.set(artifactId, set); }
    set.add(p);
    void p.then(() => {
      set!.delete(p);
      if (set!.size === 0 && this.activeRpcs.get(artifactId) === set) this.activeRpcs.delete(artifactId);
    });
  }

  private async drainActiveRpcs(artifactId: string, timeoutMs = DRAIN_BACKSTOP_MS): Promise<boolean> {
    const set = this.activeRpcs.get(artifactId);
    if (!set || set.size === 0) return true;
    let to: NodeJS.Timeout | undefined;
    let timedOut = false;
    const timeout = new Promise<void>((res) => { to = setTimeout(() => { timedOut = true; res(); }, timeoutMs); to.unref?.(); });
    await Promise.race([Promise.allSettled([...set]), timeout]);
    if (to) clearTimeout(to);
    return !timedOut;
  }

  private settlePending(entry: WorkerEntry, invokeId: string, payload: { ok: boolean; result?: unknown; error?: string }): void {
    const p = entry.pending.get(invokeId);
    if (!p || p.settled) return;
    p.settled = true;
    clearTimeout(p.timer);
    entry.pending.delete(invokeId);
    p.resolve({ ok: payload.ok, result: payload.result, error: payload.error, logs: p.logs, ...(p.dryRun ? { dryRunEffects: p.dryRunEffects } : {}) });
  }

  private settleByTimeout(artifactId: string, entry: WorkerEntry, invokeId: string, timeoutMs: number): void {
    const p = entry.pending.get(invokeId);
    if (!p || p.settled) return;
    p.settled = true;
    entry.pending.delete(invokeId);
    p.resolve({ ok: false, error: `invocation timed out after ${timeoutMs}ms`, logs: p.logs, ...(p.dryRun ? { dryRunEffects: p.dryRunEffects } : {}) });
    // A hung handler must not block the artifact's lane - recycle the worker (C05-22).
    void this.shutdown(artifactId);
  }

  private onWorkerDown(artifactId: string, entry: WorkerEntry, reason: string): void {
    if (entry.crashed) return;
    entry.crashed = true;
    this.liveArtifacts.delete(artifactId);
    if (this.workers.get(artifactId) === entry) this.workers.delete(artifactId);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (!entry.readySettled) { entry.readySettled = true; entry.rejectReady(new Error(reason)); }
    for (const p of entry.pending.values()) {
      if (!p.settled) { p.settled = true; clearTimeout(p.timer); p.resolve({ ok: false, error: reason, logs: p.logs }); }
    }
    entry.pending.clear();
  }

  private scheduleIdle(artifactId: string, entry: WorkerEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => { void this.shutdown(artifactId); }, this.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  private recordInvocation(artifactId: string, rec: InvocationRecord): void {
    const list = this.invocations.get(artifactId) ?? [];
    list.unshift(rec);
    if (list.length > MAX_INVOCATION_HISTORY) list.length = MAX_INVOCATION_HISTORY;
    this.invocations.set(artifactId, list);
  }

  async shutdown(artifactId: string): Promise<void> {
    this.liveArtifacts.delete(artifactId);
    const entry = this.workers.get(artifactId);
    if (!entry) return;
    this.workers.delete(artifactId);
    entry.crashed = true; // suppress onWorkerDown
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    for (const p of entry.pending.values()) {
      if (!p.settled) { p.settled = true; clearTimeout(p.timer); p.resolve({ ok: false, error: 'artifact backend shut down', logs: p.logs }); }
    }
    entry.pending.clear();
    try { await entry.worker.terminate(); } catch { /* ignore */ }
  }

  async revoke(artifactId: string): Promise<{ fullyDrained: boolean }> {
    // 1. Tombstone synchronously so any QUEUED lane turn is refused (C05-20).
    this.revoked.add(artifactId);
    // 2. Drop liveness so NEW capability RPCs are rejected by the isLive gate.
    this.liveArtifacts.delete(artifactId);
    // 3. Drain in-flight MUTATING commits that already passed isLive.
    const fullyDrained = await this.drainActiveRpcs(artifactId);
    if (!fullyDrained) {
      console.warn(`[artifact-backend] revoke(${artifactId}): a mutating capability call did not settle within ${DRAIN_BACKSTOP_MS}ms; a late commit could land in (now-orphaned) app-data`);
    }
    // 4. Tear the worker down.
    await this.shutdown(artifactId);
    return { fullyDrained };
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.workers.keys()].map((id) => this.shutdown(id)));
  }

  setEnabled(artifactId: string, enabled: boolean): void {
    if (enabled) {
      this.disabled.delete(artifactId);
    } else {
      this.disabled.add(artifactId);
      void this.shutdown(artifactId);
    }
  }

  isEnabled(artifactId: string): boolean {
    return !this.disabled.has(artifactId);
  }

  getStatus(artifactId: string): BackendRuntimeStatus {
    const entry = this.workers.get(artifactId);
    const history = this.invocations.get(artifactId) ?? [];
    const last = history[0];
    const enabled = !this.disabled.has(artifactId);
    let state: BackendState;
    if (!enabled) state = 'disabled';
    else if (entry && !entry.crashed) state = entry.pending.size > 0 ? 'running' : 'idle';
    else if (last && !last.ok && last.error?.includes('crash')) state = 'crashed';
    else state = history.length > 0 ? 'stopped' : 'idle';
    return {
      artifactId, state, live: !!entry && !entry.crashed, enabled,
      pending: entry?.pending.size ?? 0, lastInvocationAt: last?.startedAt,
      lastError: history.find((h) => !h.ok)?.error,
    };
  }

  getInvocations(artifactId: string, limit = 20): InvocationRecord[] {
    return (this.invocations.get(artifactId) ?? []).slice(0, limit);
  }

  getRecentLogs(artifactId: string, limit = 100): BackendLogEntry[] {
    const out: BackendLogEntry[] = [];
    for (const inv of this.invocations.get(artifactId) ?? []) {
      out.push(...inv.logs);
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  }
}

interface RpcMessage {
  type: 'rpc';
  rpcId: string;
  invokeId: string;
  token: string;
  method: string;
  args?: Record<string, unknown>;
}

/**
 * Production defaults, resolved lazily so importing runtime.ts stays cheap. The
 * MODEL seam is the G7 stub; notify defaults are inert (the composition root wires
 * the real notify callbacks). Tests inject partial deps and never touch these.
 */
function defaultRuntimeDeps(): RuntimeDeps {
  return {
    now: () => Date.now(),
    callModel: unavailableModelCapability,
    sendToUser: () => { /* inert until the composition root wires the notify seam */ },
    sendEmail: async () => ({ success: false, error: 'notify.email seam not wired' }),
    appData: {
      list: async (scopeKey, c) => (await appDataAccess()).list(scopeKey, c),
      get: async (scopeKey, c, id) => (await appDataAccess()).get(scopeKey, c, id),
      create: async (scopeKey, c, data) => (await appDataAccess()).create(scopeKey, c, data),
      update: async (scopeKey, c, id, patch) => (await appDataAccess()).update(scopeKey, c, id, patch),
      delete: async (scopeKey, c, id) => (await appDataAccess()).delete(scopeKey, c, id),
    },
    resolveOwner: async (artifactId) => {
      const { artifacts } = await import('../../data/stores.js');
      const art = await artifacts.get(artifactId);
      if (!art) return null;
      // Read manifest.sharedData authoritatively from disk (fail-closed to false).
      let sharedData = false;
      try {
        const { projectDirFor } = await import('../app-paths.js');
        const { readManifest } = await import('../manifest.js');
        const m = await readManifest(projectDirFor(art as never));
        sharedData = m?.sharedData === true;
      } catch { /* fail-closed */ }
      return { ownerUserId: (art.userId as string) ?? '', sharedData };
    },
    resolveBundlePath: async (artifactId) => {
      const { artifacts } = await import('../../data/stores.js');
      const { backendBundlePath } = await import('../app-paths.js');
      const art = await artifacts.get(artifactId);
      return art ? backendBundlePath(art as never) : null;
    },
  };
}

let _access: import('../app-data-access.js').AppDataAccess | undefined;
async function appDataAccess() {
  if (!_access) {
    const { AppDataAccess } = await import('../app-data-access.js');
    _access = new AppDataAccess({ now: () => Date.now(), genId: () => randomUUID() });
  }
  return _access;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
function revokedResult(): InvokeResult {
  return { ok: false, error: 'artifact backend has been revoked (deleted)', logs: [] };
}
function safeClone(v: unknown): unknown {
  try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
  catch { return null; }
}
