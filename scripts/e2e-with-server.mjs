#!/usr/bin/env node
/**
 * Server-backed ledger run (ch14 §14.2.5 + the gate suites from G6 on).
 *
 * From G6 the due estate needs a LIVE api (the 37 served-app specs drive
 * /apps/* on backend.port; the node drivers preflight /health). This harness
 * makes `npm run e2e` reproducible with zero machine setup:
 *
 *   1. boots the FULL stack through the committed driver
 *      (.claude/skills/run-ekoa-code/driver.mjs): the real API on an internal
 *      port, a CORS proxy on the port `backend.port` names, and the web app —
 *      the CSP/CORS bring-up a bare api boot cannot substitute for (see the
 *      block above the spawn for what booting only the api actually cost);
 *   2. POLLS both planes until /health and /login answer;
 *   3. runs `node scripts/suite-ledger-run.mjs --run`;
 *   4. tears the whole process GROUP down and exits with the runner's code.
 *
 * Screenshots stay enabled unless EKOA_SCREENSHOTS_DISABLED is set by the
 * caller (CI sets it: capture adds minutes and the gate does not assert PNGs).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREBUILD_TIMEOUT_MS = 10 * 60_000;

/**
 * Zero-machine-setup provisioning (this harness's contract): the demos.spec Tutorial-Bridge
 * suite is data-driven over `ekoa-data/demos`, but in the rebuild the canonical demo spine
 * lives at `api/assets/demos` (demo-registry.ts: "the Fonseca spine the demo-spine spec drives").
 * `ekoa-data/` is a local runtime working dir, not committed, so a fresh checkout has no
 * `ekoa-data/demos` and the ported spec ENOENTs. Mirror the canonical specs into it here so the
 * e2e is reproducible on any checkout without touching the ported spec. Idempotent: copies only
 * missing/newer files.
 */
function ensureDemosSpine() {
  const src = join(ROOT, 'api', 'assets', 'demos');
  const dst = join(ROOT, 'ekoa-data', 'demos');
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    if (!statSync(s).isFile()) continue;
    const d = join(dst, name);
    if (!existsSync(d) || statSync(s).mtimeMs > statSync(d).mtimeMs) copyFileSync(s, d);
  }
}
ensureDemosSpine();

/**
 * THE BRING-UP IS THE COMMITTED DRIVER, not a second copy of it.
 *
 * This harness used to boot `dev-api.mjs` alone, and the dashboard specs then failed en masse. The
 * first fix here — adding a `next start` on :3000 — moved the failure but did not fix it: 97 of 242
 * specs still failed, 85 of them timing out in `page.waitForURL` because LOGIN NEVER COMPLETED.
 *
 * The cause is documented in `.claude/skills/run-ekoa-code` and is not obvious from this file:
 *   1. `next.config.ts` reads `../backend.port` (committed 4111) and inlines it as the browser's
 *      API origin, IGNORING the shell env. The browser will call :4111 whatever we set.
 *   2. The API ships NO CORS, deliberately — in production the web and API are same-origin behind
 *      an edge proxy. So a browser on :3000 calling the API on :4111 fails preflight, and the
 *      login fetch dies before it reaches the server.
 *
 * `driver.mjs` is the single committed implementation of that bring-up: the real API on an internal
 * port (4211), a zero-dependency CORS reverse proxy occupying 4111 so the inlined origin resolves,
 * and the web app on 3000. `scripts/dev.mjs` (the operator's `npm run dev`) already delegates to it
 * for exactly this reason — this harness now does the same instead of maintaining a second,
 * subtly-broken copy of the same bring-up.
 */
const server = spawn('node', [join(ROOT, '.claude', 'skills', 'run-ekoa-code', 'driver.mjs'), 'up'], {
  cwd: ROOT,
  env: { ...process.env, EKOA_API_MODE: process.env.EKOA_API_MODE || 'built' },
  // Its own child processes must die with it, so run it as a process GROUP leader and signal the
  // group at teardown. Killing only the driver would orphan dev-api and next, and the next CI job
  // (or the next local run) would then hit EADDRINUSE on 3000/4111/4211.
  detached: true,
  stdio: ['ignore', 'inherit', 'inherit'],
});

/**
 * Readiness is POLLED, never grepped. The driver prints a READY line, but its stdio is inherited
 * (so the operator sees the real boot), and a readiness check that greps a child's stdout breaks
 * silently whenever that banner changes shape — it reports ready and every spec then fails on a
 * refused connection, which is precisely the failure mode this file has already produced once.
 *
 * Both planes are checked because the estate needs both: the node drivers preflight the API's
 * /health, and the dashboard specs navigate to the web app's /login.
 */
async function waitForStack(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const api = `http://127.0.0.1:${process.env.EKOA_PROXY_PORT || '4111'}/health`;
  const web = `http://127.0.0.1:${process.env.EKOA_WEB_PORT || '3000'}/login`;
  let lastErr = 'never attempted';
  while (Date.now() < deadline) {
    try {
      const [a, w] = await Promise.all([fetch(api), fetch(web, { redirect: 'manual' })]);
      if (a.ok && w.status > 0) return;
      lastErr = `api ${a.status}, web ${w.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`stack not ready within ${timeoutMs}ms (last: ${lastErr})`);
}

let exitCode = 1;
try {
  // Generous: a cold boot registers ~200 featured apps before /health answers (~90s observed),
  // and `next dev` cold-compiles /login on first hit (10-30s).
  await waitForStack(PREBUILD_TIMEOUT_MS);
  console.log('[e2e-with-server] stack ready (api proxy + web)');

  exitCode = await new Promise((resolvePromise) => {
    const runner = spawn('node', [join(ROOT, 'scripts', 'suite-ledger-run.mjs'), '--run'], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: 'inherit',
    });
    runner.on('exit', (code) => resolvePromise(code ?? 1));
  });
} catch (err) {
  console.error(`[e2e-with-server] ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  // Signal the whole process GROUP (negative pid): the driver's dev-api, proxy and next children
  // must go with it, or the ports stay held.
  const killGroup = (sig) => { try { process.kill(-server.pid, sig); } catch { /* already gone */ } };
  killGroup('SIGTERM');
  await new Promise((r) => setTimeout(r, 2500));
  killGroup('SIGKILL');
}

process.exit(exitCode);
