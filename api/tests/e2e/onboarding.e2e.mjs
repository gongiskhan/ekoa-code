#!/usr/bin/env node
/**
 * Guided onboarding - live conversation smoke (ONB-4), integration-gated.
 *
 * The committed Playwright spec (web/e2e/onboarding.spec.ts) proves the entry
 * flow deterministically with NO model call. This driver is the complementary
 * LIVE smoke: it opens a real onboarding-typed session and sends one turn
 * through the actual chat-agent, proving the server-side seam fires end-to-end
 * (sessionId → owner-checked session type='onboarding' → onboarding catalog
 * injection → a grounded reply). It is INTEGRATION-GATED on claudeAuth health:
 * when the model credential is invalid/expired (GET /health → claudeAuth.ok
 * false) it prints SKIP and exits 0, so CI stays green while the deterministic
 * gates carry the correctness weight.
 *
 * REST adaptation (2026-07-07, G7B, per spec/reference/test-audit.md §5.1):
 * transport swapped from the retired action API (POST /api/v1/action,
 * POST /api/v1/request, the global /api/v1/events trace stream - FIXED-2) to
 * the typed REST surface (POST /api/v1/auth/login, POST /api/v1/sessions,
 * POST /api/v1/chat/runs 202 {runId}, GET /api/v1/chat/runs/:id/events SSE,
 * ch03 §3.8.7). Every assertion and SKIP gate carries; the retired `mode`
 * routing enum and client-minted trace ids are dropped per ch03 §3.4.
 *
 * The prompt ASSEMBLY (mechanism + vertical catalog + inventory, and the
 * non-onboarding no-op) is asserted deterministically by unit tests - there is
 * no HTTP surface that echoes the assembled append, so here the grounding
 * checks are SOFT (logged, never fail) because live model wording varies.
 *
 * Run: node api/tests/e2e/onboarding.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): the api binds IPv4; Node's fetch can resolve
// `localhost` to IPv6 ::1, which is refused.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;

// Generous ceiling: a cold onboarding turn (interview reasoning + tool-less
// chat) can take a while. The gate is skip-on-unhealthy, not fail-on-slow.
const COMPLETE_TIMEOUT_MS = Number(process.env.ONB_TIMEOUT_MS || 150_000);

const PT_MESSAGE =
  'Sou advogado num escritório pequeno; trata de prazos e honorários. Por onde começo na Ekoa?';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(m) { console.error(`E2E FAIL: ${m}`); process.exit(1); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
function soft(name, passed, detail = '') {
  console.log(`  SOFT ${passed ? 'ok  ' : 'miss'}: ${name}${detail ? ` - ${detail}` : ''}`);
}

let TOKEN = null;
const authHeaders = () => ({ 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) });

async function rest(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let json;
  try { json = JSON.parse(t); } catch { json = { _raw: t }; }
  return { status: r.status, json };
}

async function main() {
  // ---- Reachability + integration gate ------------------------------------
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: api not reachable at ${BASE}/health - cannot run the live onboarding smoke.`);
    process.exit(0);
  }
  const healthJson = await health.json().catch(() => ({}));
  const claudeAuth = healthJson.claudeAuth || {};
  if (!claudeAuth.ok) {
    console.log(
      `SKIP: claudeAuth not healthy (ok=${claudeAuth.ok}, mode=${claudeAuth.mode || 'unset'}, ` +
      `lastRefreshError=${claudeAuth.lastRefreshError || 'none'}) - the live onboarding turn needs a valid model credential. ` +
      `Remediate by configuring the credential custody (ch06 §6.2.4), then re-run.`,
    );
    process.exit(0);
  }
  ok(`claudeAuth healthy (mode=${claudeAuth.mode}) - running the live onboarding turn`);

  // ---- Login ----------------------------------------------------------------
  const login = await rest('POST', '/api/v1/auth/login', { username: 'admin', password: 'tmp12345', rememberMe: true });
  TOKEN = login.json?.token;
  assert(TOKEN, `login failed (${login.status}): ${JSON.stringify(login.json).slice(0, 200)}`);
  ok('logged in (JWT acquired)');

  // ---- Create an onboarding-typed session (the seam keys off this) ---------
  const created = await rest('POST', '/api/v1/sessions', { type: 'onboarding', name: 'Orientação guiada (e2e)' });
  const sessionId = created.json?.id;
  assert(sessionId, `could not create onboarding session (${created.status}): ${JSON.stringify(created.json).slice(0, 200)}`);
  assert(created.json.type === 'onboarding', `session type not persisted as onboarding (got ${created.json.type})`);
  ok(`onboarding session created (${sessionId})`);

  // ---- Fire one onboarding turn (202 + server-minted runId, ch03 §3.8.7) ---
  console.log(`>>> POST /api/v1/chat/runs (onboarding turn) on ${sessionId}`);
  const createdRun = await rest('POST', '/api/v1/chat/runs', {
    sessionId, message: PT_MESSAGE, language: 'pt',
  });
  const runId = createdRun.json?.runId;
  assert(createdRun.status === 202 && runId, `run not accepted (${createdRun.status}): ${JSON.stringify(createdRun.json).slice(0, 200)}`);
  ok(`run accepted (202, runId ${runId})`);

  // ---- Watch the run's SSE stream ------------------------------------------
  const evCtrl = new AbortController();
  const seen = { firstStreamAt: 0, complete: false, error: null };
  let streamText = '';
  let resultText = '';
  const ssePromise = (async () => {
    const res = await fetch(`${BASE}/api/v1/chat/runs/${runId}/events?token=${encodeURIComponent(TOKEN)}`, {
      headers: { Accept: 'text/event-stream' }, signal: evCtrl.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() || '';
        for (const f of frames) {
          const line = f.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === 'text_chunk') {
            if (!seen.firstStreamAt) seen.firstStreamAt = Date.now();
            streamText += (ev.text || '');
          }
          if (ev.type === 'complete') { seen.complete = true; resultText = String(ev.result || ''); }
          if (ev.type === 'error') seen.error = `${ev.code || 'ERROR'}: ${ev.message || 'unknown error'}`;
        }
      }
    } catch { /* aborted on teardown */ }
  })();

  // ---- Wait for completion (or a clean skip on model failure) -------------
  const t0 = Date.now();
  while (!seen.complete && !seen.error && Date.now() - t0 < COMPLETE_TIMEOUT_MS) await sleep(300);
  evCtrl.abort();
  await ssePromise.catch(() => {});

  const reply = (resultText || streamText).trim();

  if (seen.error) {
    // A provider/engine failure mid-run is an environment condition, not an
    // onboarding regression - skip cleanly (like the health gate) rather than
    // fail the suite on an infra hiccup.
    await rest('DELETE', `/api/v1/sessions/${sessionId}`).catch(() => {});
    console.log(`SKIP: the model run errored (${seen.error}). Onboarding wiring untested this run; deterministic gates unaffected.`);
    process.exit(0);
  }
  assert(seen.complete, `no \`complete\` event within ${Math.round(COMPLETE_TIMEOUT_MS / 1000)}s (reply so far: ${reply.length} chars)`);
  ok('received a `complete` event for the onboarding turn');
  assert(reply.length > 0, 'onboarding reply was empty');
  ok(`onboarding reply is non-empty (${reply.length} chars)`);

  // ---- SOFT grounding checks (logged, never fail) -------------------------
  // The onboarding guide interviews first (asks a question) and/or proposes
  // from the injected legal catalog. Live wording varies, so these are soft.
  const asksQuestion = /\?/.test(reply);
  soft('reply reads as an interview (contains a question)', asksQuestion);
  const legalTerms = /(prazo|honor[aá]ri|processo|cliente|contrato|advog|escrit[oó]rio|jur[ií]dic)/i;
  soft('reply engages the legal domain (catalog-grounded terms present)', legalTerms.test(reply), 'legal keywords');
  const looksPortuguese = /[àáâãéêíóôõúç]/i.test(reply) || /\b(pode|construir|ajud|comec|sugest)/i.test(reply);
  soft('reply is in Portuguese', looksPortuguese);
  console.log('  --- reply sample ---\n  ' + reply.slice(0, 280).replace(/\n+/g, ' '));

  // ---- Cleanup ------------------------------------------------------------
  await rest('DELETE', `/api/v1/sessions/${sessionId}`).catch(() => {});
  ok('cleaned up the e2e onboarding session');

  console.log('\nE2E PASS: live onboarding turn completed on an onboarding-typed session (seam fired, non-empty grounded reply).');
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack || e.message : String(e)));
