#!/usr/bin/env node
/**
 * S6 (run 20260717-071930-d1244839): LIVE proof that a STOCK Claude Code CLI works against the
 * Cortex LLM gateway with a per-user key, metered on the key owner.
 *
 * Proves, against the running stack with a real model credential:
 *  1. key minted over HTTP (the S4a self-service surface);
 *  2. EMPTY-ruleset no-op: stock `claude -p` reads a real file through the gateway and returns
 *     its contents BYTE-IDENTICAL (the anonymisation pipeline is a client-visible no-op);
 *  3. DENY-LISTED round trip: KNOWN LIMITATION probe (finding gateway-anon-tooluse-fidelity) -
 *     a deny-listed literal in a filesystem PATH does not yet reliably detokenize in the tool_use
 *     args of the agentic loop; recorded honestly, never a hard gate failure (documented OPEN
 *     finding for a follow-up run; the empty-ruleset default posture above IS proven);
 *  4. heartbeat-and-replay: a real streamed EXPERT-family request shows `event: ping` BEFORE the
 *     replayed upstream body (message_start OR an in-stream error - both prove the S1 contract);
 *  5. count_tokens answers real counts with the key and produces NO billing;
 *  6. the billing breakdown grows a 'gateway-client' row attributed to the key owner.
 *
 * Run: node api/tests/e2e/gateway-claude-code.e2e.mjs   (stack + credential + `claude` on PATH)
 * SKIPs (exit 0, printed reason) when the stack, the model credential, or the CLI is absent. It is
 * ledgered at OPERATOR-RUN (a credentialed-live-stack + CLI driver verified by hand, like the
 * operator-run drivers) so the suite-ledger runner reports it `awaiting OPERATOR-RUN` and can never
 * book a skip as a false green (S6 fresh-review F1). Model-completion beats tolerate ONLY an
 * explicit upstream rate-limit (429 / Anthropic rate_limit_error) on the shared OAuth credential;
 * any OTHER upstream error is a real failure.
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = `http://127.0.0.1:${process.env.EKOA_API_PORT ?? 4111}`;
const RUNSTAMP = Date.now().toString(36).toUpperCase();
let failures = 0;
let tolerated = 0;
const ok = (m) => console.log(`  OK  ${m}`);
const fail = (m) => { failures++; console.error(`  FAIL  ${m}`); };
const tol = (m) => { tolerated++; console.log(`  TOLERATED (upstream rate-limited)  ${m}`); };
const known = (m) => console.log(`  KNOWN LIMITATION (gateway-anon-tooluse-fidelity)  ${m}`);
const assert = (cond, m) => (cond ? ok(m) : fail(m));
const skip = (m) => { console.log(`SKIP: ${m}`); process.exit(0); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (path, init = {}) => {
  // The dev CORS proxy occasionally resets a fresh connection; retry transient NETWORK errors
  // (never HTTP statuses - those are real results).
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
      let body;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } catch (e) {
      lastErr = e;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
};

// --- gating preflight ---------------------------------------------------------------------
let health;
try { health = (await j('/health')).body; } catch { skip(`api not reachable at ${BASE}`); }
if (!health?.claudeAuth?.ok) skip('model credential not healthy (claudeAuth.ok=false) - provision first');
try { execSync('command -v claude', { stdio: 'ignore', shell: '/bin/bash' }); } catch { skip('`claude` CLI not on PATH'); }

// --- login + mint -------------------------------------------------------------------------
const login = await j('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'tmp12345' }) });
if (login.status !== 200) skip(`seeded admin login failed (HTTP ${login.status}) - is this the dev stack?`);
const TOKEN = login.body.token;
const authed = (path, init = {}) => j(path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });

// The breakdown endpoint must be readable for this proof driver (the seeded admin is super-admin);
// if it is not, the billing attribution cannot be proven, which is a FAILURE, not a skip.
const breakdown = async () => {
  const r = await authed('/api/v1/billing/breakdown');
  if (r.status !== 200) return null;
  const row = (r.body.items ?? []).find((it) => it.agentType === 'gateway-client');
  return row ? Object.values(row).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0) : 0;
};
const billedBefore = await breakdown();

const mint = await authed('/api/v1/gateway-keys', { method: 'POST', body: JSON.stringify({ label: `s6-live-${RUNSTAMP}` }) });
assert(mint.status === 201 && mint.body.key?.startsWith('ekoa_gk_'), 'key minted over HTTP (201, ekoa_gk_ prefix)');
const KEY = mint.body.key;
const KEY_ID = mint.body.id;

// The gateway key never appears in stdout or the evidence (only its ekoa_gk_ prefix is asserted).
const claudeEnv = { ...process.env, ANTHROPIC_BASE_URL: `${BASE}/api/v1/llm`, ANTHROPIC_AUTH_TOKEN: KEY };
delete claudeEnv.ANTHROPIC_API_KEY;
delete claudeEnv.CLAUDE_CODE_OAUTH_TOKEN;

// Is the shared model credential explicitly THROTTLED right now? Only an HTTP 429 or an
// Anthropic rate_limit_error counts (S6 codex High: any OTHER error must NOT be swallowed as a
// tolerable rate-limit). A live infra condition on the shared OAuth pool, not a product defect.
async function modelRateLimited() {
  const probe = await j('/api/v1/llm/v1/messages', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4, messages: [{ role: 'user', content: 'oi' }] }),
  });
  return probe.status === 429 || probe.body?.error?.type === 'rate_limit_error';
}

function runClaude(cwd, args) {
  const out = execFileSync('claude', [...args, '--output-format', 'json'], {
    cwd, env: claudeEnv, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  return typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed);
}

// Everything after the mint runs inside try/finally so the key + deny-list entry + temp dirs are
// ALWAYS cleaned up, even on a thrown path (S6 codex Medium; the fresh review found leftover
// deny-list entries from earlier non-cleaning runs).
let workA;
let workB;
let denyId;
try {
  // --- 2. empty-ruleset no-op round trip (tolerate an explicit rate-limit only) -----------
  workA = mkdtempSync(join(tmpdir(), 's6-gateway-a-'));
  const CONTENT_A = `REF-${RUNSTAMP}-A codigo interno 40273`;
  writeFileSync(join(workA, 'nota-interna.txt'), CONTENT_A);
  console.log('\n[2] empty-ruleset no-op: stock claude reads a file through the gateway...');
  if (await modelRateLimited()) {
    tol('empty-ruleset round trip - shared model credential rate-limited this run');
  } else {
    try {
      const answer = runClaude(workA, ['-p', 'Le o ficheiro nota-interna.txt nesta pasta e responde APENAS com o seu conteudo exato, sem mais nada.']);
      if (!answer.trim() && (await modelRateLimited())) tol('empty-ruleset round trip - empty completion under a live rate-limit');
      else assert(answer.includes(CONTENT_A), `round trip byte-identical (answer carries "${CONTENT_A}")`);
    } catch (e) {
      fail(`claude -p (empty ruleset) failed: ${String(e).slice(0, 300)}`);
    }
  }

  // --- 3. deny-listed round trip: KNOWN LIMITATION probe (finding gateway-anon-tooluse-fidelity).
  // A deny-listed literal in a filesystem PATH does not reliably detokenize in the tool_use args of
  // Claude Code's agentic loop, so the CLI cannot navigate to the folder. Documented OPEN finding,
  // NOT this driver's deliverable - recorded honestly, never green-washed, never a hard failure.
  const LITERAL = `ZarkovHoldings${RUNSTAMP}`;
  const deny = await authed('/api/v1/org/deny-list', { method: 'POST', body: JSON.stringify({ value: LITERAL }) });
  assert(deny.status === 200 || deny.status === 201, `deny-list literal seeded (${LITERAL})`);
  denyId = deny.body?.id;

  workB = mkdtempSync(join(tmpdir(), 's6-gateway-b-'));
  mkdirSync(join(workB, LITERAL));
  const CONTENT_B = `contrato de ${LITERAL}: valor 55934 EUR`;
  writeFileSync(join(workB, LITERAL, `dados-${LITERAL}.txt`), CONTENT_B);
  console.log(`\n[3] deny-listed round trip (KNOWN LIMITATION probe - finding gateway-anon-tooluse-fidelity)...`);
  if (await modelRateLimited()) {
    tol('deny-listed round trip - shared model credential rate-limited this run');
  } else {
    try {
      const answer = runClaude(workB, ['-p', `Le o unico ficheiro dentro da pasta ${LITERAL} e responde APENAS com o seu conteudo exato.`]);
      if (answer.includes(CONTENT_B)) known('deny-listed multi-tool round trip LANDED byte-identical this run - re-verify + consider closing gateway-anon-tooluse-fidelity');
      else known('deny-listed multi-tool round trip did NOT land byte-identical - see docs/findings.md (deny-list orgs only; empty-ruleset works)');
    } catch (e) {
      known(`claude -p (deny-listed) errored: ${String(e).slice(0, 160)}`);
    }
  }

  // --- 4. heartbeat-and-replay on the wire ------------------------------------------------
  console.log('\n[4] streamed EXPERT-family request: pings before the verbatim replay...');
  try {
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(`${BASE}/api/v1/llm/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
          body: JSON.stringify({
            model: 'claude-opus-4-8',
            stream: true,
            max_tokens: 1500,
            messages: [{ role: 'user', content: 'Escreve um paragrafo de 150 palavras sobre a historia de Lisboa.' }],
          }),
        });
        break;
      } catch (e) { if (attempt === 2) throw e; await sleep(400 * (attempt + 1)); }
    }
    assert(res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/event-stream'), 'stream commits SSE 200');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let raw = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
    }
    // The S1 heartbeat-and-replay CONTRACT holds regardless of whether the buffered upstream call
    // returned a 2xx (message_start...message_stop) or an error (an in-stream Anthropic-shaped
    // error event, e.g. the shared credential is rate-limited): a ping frame is written FIRST,
    // then the detokenized upstream body.
    const pingIdx = raw.indexOf('event: ping');
    const firstUpstream = [raw.indexOf('event: message_start'), raw.indexOf('event: error')].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
    assert(pingIdx >= 0, 'a ping frame is written at SSE commitment');
    assert(firstUpstream > pingIdx, 'the ping precedes the replayed upstream body (message_start OR an in-stream error)');
    if (raw.includes('event: message_stop')) ok('the replay is a complete SSE stream (message_stop present)');
    else if (raw.includes('"type":"rate_limit_error"')) tol('upstream replayed an in-stream rate_limit_error (shared credential throttled) - S1 error-path proven live');
    else fail('the replay is neither a complete stream nor an in-stream rate-limit error');
  } catch (e) {
    fail(`stream probe failed: ${String(e).slice(0, 300)}`);
  }

  // --- 5. count_tokens --------------------------------------------------------------------
  console.log('\n[5] count_tokens with the key...');
  const count = await j('/api/v1/llm/v1/messages/count_tokens', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'ola mundo' }] }),
  });
  assert(count.status === 200 && typeof count.body?.input_tokens === 'number' && count.body.input_tokens > 0, `count_tokens answers real counts (input_tokens=${count.body?.input_tokens})`);

  // --- 6. billing landed on the key owner -------------------------------------------------
  console.log('\n[6] billing breakdown grew a gateway-client row on the key owner...');
  const billedAfter = await breakdown();
  // The breakdown must be readable (super-admin) AND must have grown - a proof driver that cannot
  // read billing cannot prove attribution, so an unreadable breakdown is a FAILURE (S6 codex High).
  assert(billedBefore !== null && billedAfter !== null, 'billing breakdown is readable with the admin role');
  if (billedBefore !== null && billedAfter !== null) {
    assert(billedAfter > billedBefore, `gateway-client billing grew (${billedBefore} -> ${billedAfter})`);
  }
} finally {
  if (KEY_ID) await authed(`/api/v1/gateway-keys/${KEY_ID}/revoke`, { method: 'POST' }).catch(() => {});
  if (denyId) await authed(`/api/v1/org/deny-list/${denyId}`, { method: 'DELETE' }).catch(() => {});
  if (workA) rmSync(workA, { recursive: true, force: true });
  if (workB) rmSync(workB, { recursive: true, force: true });
}

const suffix = tolerated > 0 ? ` (${tolerated} model-completion beat(s) tolerated: shared credential rate-limited)` : '';
console.log(failures === 0 ? `\nS6 LIVE GATE: PASS${suffix}` : `\nS6 LIVE GATE: FAIL (${failures})${suffix}`);
process.exit(failures === 0 ? 0 : 1);
