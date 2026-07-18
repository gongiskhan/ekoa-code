/**
 * Shared plumbing for the committed test harnesses (scripts/e2e-full.mjs,
 * scripts/e2e-with-server.mjs, scripts/journeys-run.mjs). Extracted 2026-07-18
 * (code review: three divergent copies of waitForLine/teardown/ensureDemosSpine,
 * two of which carried known-fixed bugs the third had already patched).
 *
 * Design notes baked in here so the callers stay honest:
 *  - Output watching is BUFFERED per child: a single persistent echo listener is
 *    attached once, and every waitForLine() scans the accumulated transcript
 *    before subscribing. This fixes two bugs the copy-pasted version had:
 *    (a) a gate line emitted in the same chunk as (or before) the previous
 *    gate's line was consumed and lost, hanging the next wait until timeout;
 *    (b) each waitForLine() re-attached a fresh permanent echo pair on resolve,
 *    doubling every subsequent log line per gate passed.
 *  - waitForLine takes an optional failPattern so a readiness gate can REJECT
 *    fast on the failure line (e.g. "[featured-builder] prebuild failed:")
 *    instead of burning the full timeout.
 *  - Teardown kills PROCESS GROUPS, not direct children: the harness children
 *    are npm/node wrappers whose grandchildren (next dev, mongod, playwright
 *    browsers) hold the ports and locks. Callers must spawn tracked children
 *    with `detached: true` so each leads its own group and `kill(-pid)` reaches
 *    the whole subtree. Escalation checks exitCode/signalCode - NOT `.killed`,
 *    which only records that a signal was SENT.
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';

/**
 * Zero-machine-setup provisioning: the demos.spec Tutorial-Bridge suite is
 * data-driven over `ekoa-data/demos` (a local runtime dir, not committed); the
 * canonical demo spine lives at `api/assets/demos`. Mirror it so a fresh
 * checkout runs the ported spec untouched. Idempotent: copies missing/newer only.
 */
export function ensureDemosSpine(root) {
  const src = join(root, 'api', 'assets', 'demos');
  const dst = join(root, 'ekoa-data', 'demos');
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    if (!statSync(s).isFile()) continue;
    const d = join(dst, name);
    if (!existsSync(d) || statSync(s).mtimeMs > statSync(d).mtimeMs) copyFileSync(s, d);
  }
}

/** Fail fast on a port collision instead of a late, misleading readiness timeout. */
export function assertPortFree(port, name, override) {
  return new Promise((resolvePromise, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      reject(new Error(
        `${name} port :${port} is already in use (${err.code}). A live dev stack likely owns it — ` +
        `set ${override} to a free port and re-run.`,
      ));
    });
    probe.once('listening', () => probe.close(() => resolvePromise()));
    probe.listen(Number(port), '127.0.0.1');
  });
}

export async function waitForHttp(url, { timeoutMs, okBelow = 500 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < okBelow) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Retain enough transcript that a gate line emitted early in the boot is still
// matchable by a later waitForLine, without unbounded growth on chatty servers.
const WATCH_BUFFER_MAX = 2 * 1024 * 1024;

/**
 * Attach the single persistent output watcher for a child. Returns
 *   { waitForLine(pattern, timeoutMs, label, opts?) }
 * where opts.failPattern rejects immediately when matched (with opts.failLabel
 * or the matched line in the error). Echoes all child output to this process.
 */
export function attachWatcher(child, { echoTo = process.stdout } = {}) {
  let buffer = '';
  const pending = new Set();

  const feed = (chunk) => {
    const text = chunk.toString();
    echoTo.write(text);
    buffer = (buffer + text).slice(-WATCH_BUFFER_MAX);
    for (const w of [...pending]) w.check();
  };
  child.stdout?.on('data', feed);
  child.stderr?.on('data', feed);
  child.on('exit', (code) => {
    for (const w of [...pending]) w.exited(code);
  });

  return {
    waitForLine(pattern, timeoutMs, label, { failPattern, failLabel } = {}) {
      return new Promise((resolvePromise, reject) => {
        const w = {
          check() {
            if (failPattern && failPattern.test(buffer)) {
              cleanup();
              reject(new Error(failLabel || `${label}: failure line matched (${failPattern})`));
              return;
            }
            if (pattern.test(buffer)) {
              cleanup();
              resolvePromise(undefined);
            }
          },
          exited(code) {
            cleanup();
            reject(new Error(`child exited (${code}) before ${label}`));
          },
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`timed out waiting for ${label}`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          pending.delete(w);
        };
        pending.add(w);
        w.check(); // the line may already be in the buffer
      });
    },
  };
}

/**
 * Signal a tracked child's whole process group (requires the child to have been
 * spawned with `detached: true`); falls back to the direct child when the group
 * is already gone.
 */
export function killTree(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

/**
 * Build the shared teardown: SIGTERM every tracked child's group, close extra
 * servers, then after a grace period SIGKILL the groups whose direct child has
 * not exited, and exit with the given code.
 */
export function makeTeardown({ children, closers = [], graceMs = 1500 }) {
  const teardown = function teardown(code) {
    if (teardown.started) return;
    teardown.started = true;
    for (const c of children) killTree(c, 'SIGTERM');
    for (const close of closers) { try { close(); } catch { /* ignore */ } }
    setTimeout(() => {
      for (const c of children) {
        if (c.exitCode === null && c.signalCode === null) killTree(c, 'SIGKILL');
      }
      process.exit(code);
    }, graceMs);
  };
  // Exposed so child exit handlers can tell "died on its own" (tear down, red)
  // from "we are killing it" (expected during teardown).
  teardown.started = false;
  return teardown;
}
