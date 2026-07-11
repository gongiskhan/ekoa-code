/**
 * Boot-B chat-journey helpers (layered on _lib.mjs). Adds the pieces the credentialed model
 * journeys need on top of the Boot-A HTTP/SSE kit:
 *   - org+user provisioning via the super-admin,
 *   - an externally-abortable notifications-SSE collector (opened BEFORE a run, closed AFTER the
 *     terminal — CONV-1 ?token= auth),
 *   - runChatTurn(): fire ONE chat run, follow its run-SSE to terminal, reconstruct the reply,
 *     and append the mandatory model-action rows to actions-log-chat.json.
 *
 * Every model-triggering call is logged to api/tests/evidence/J9-billing/actions-log-chat.json
 * so the director can reconcile the ledger against what the probes actually spent.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BASE, api, login, sleep, sseCollect, EVIDENCE_ROOT } from './_lib.mjs';

export { BASE, api, login, sleep, sseCollect };

export const ACTIONS_LOG = join(EVIDENCE_ROOT, 'J9-billing', 'actions-log-chat.json');

/** Append one model-action row to the mandatory actions log (read-modify-write; probes run
 *  sequentially so a plain RMW is safe). */
export async function appendAction(row) {
  await mkdir(dirname(ACTIONS_LOG), { recursive: true });
  let arr = [];
  if (existsSync(ACTIONS_LOG)) {
    try { arr = JSON.parse(await readFile(ACTIONS_LOG, 'utf8')) || []; } catch { arr = []; }
  }
  arr.push({ ts: new Date().toISOString(), ...row });
  await writeFile(ACTIONS_LOG, JSON.stringify(arr, null, 2) + '\n');
}

export async function admin() { return login('admin', 'tmp12345'); }

/** Create an org + one user (default role builder) and log the user in. Returns ids + token. */
export async function createOrgUser(adminToken, { orgName, orgDisplay, username, password = 'pw123456', role = 'builder' }) {
  const org = await api('POST', '/api/v1/orgs', { token: adminToken, body: { name: orgName, displayName: orgDisplay || orgName } });
  const orgId = org.body && org.body.id;
  const user = await api('POST', '/api/v1/users', { token: adminToken, body: { username, password, role, orgId } });
  const userId = user.body && user.body.id;
  // Log in even if creation returned a conflict (idempotent re-run within the same boot).
  let token = null;
  try { token = await login(username, password); } catch { token = null; }
  return { org, user, orgId, userId, token, username, password, role };
}

/** POST /sessions → sessionView (has .id). */
export async function newSession(token, name) {
  const r = await api('POST', '/api/v1/sessions', { token, body: { name } });
  return { status: r.status, id: r.body && r.body.id, body: r.body };
}

function parseChunk(chunk) {
  let event; let id; const dataLines = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('id:')) id = line.slice(3).trim();
  }
  const raw = dataLines.join('\n');
  let data = raw;
  if (raw) { try { data = JSON.parse(raw); } catch { /* keep raw */ } }
  return { event, id, data };
}

/**
 * Notifications-SSE collector with an EXTERNAL stop() (the _lib sseCollect only stops on
 * until/timeout, which we cannot use to keep a stream open exactly across a run). Frames land in
 * `.frames`; sawUsageUpdated()/sawChatAnswer() are the J-brief assertions.
 */
export class NotifCollector {
  constructor(token) {
    this.token = token;
    this.frames = [];
    this.ctrl = new AbortController();
    this.status = 0;
    this.errorBody = null;
    this._done = null;
  }
  start() {
    const url = new URL(BASE + '/api/v1/notifications/events');
    url.searchParams.set('token', this.token);
    this._done = (async () => {
      let res;
      try {
        res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: this.ctrl.signal });
      } catch (e) { this.errorBody = String(e && e.message ? e.message : e); return; }
      this.status = res.status;
      if (!res.ok) { try { this.errorBody = await res.text(); } catch { /* ignore */ } return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const frame = parseChunk(chunk);
            if (frame.event === undefined && (frame.data === undefined || frame.data === '')) continue;
            this.frames.push(frame);
          }
        }
      } catch { /* aborted or stream end */ }
    })();
    return this;
  }
  // Notifications carry their discriminator in the SSE `event:` line with an EMPTY `data:{}`
  // payload (the server emits e.g. `emit('notifications', uid, 'usage_updated', {})`), so match on
  // the event name first, then fall back to a data.type discriminator.
  _typeSeen(t) { return this.frames.some((f) => f.event === t || (f.data && typeof f.data === 'object' && f.data.type === t)); }
  sawUsageUpdated() { return this._typeSeen('usage_updated'); }
  sawChatAnswer() { return this._typeSeen('chat_answer'); }
  async waitFor(pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (pred()) return true; await sleep(300); }
    return false;
  }
  async stop() { try { this.ctrl.abort(); } catch { /* ignore */ } try { await this._done; } catch { /* ignore */ } }
}

/** Terminal (complete|error) predicate over a run-SSE frame (event name or data.type). */
export function isTerminal(frame) {
  if (!frame) return false;
  if (frame.event === 'complete' || frame.event === 'error') return true;
  return !!(frame.data && typeof frame.data === 'object' && (frame.data.type === 'complete' || frame.data.type === 'error'));
}

/**
 * Reconstruct the reply text from run-SSE frames. NOTE (Boot-B finding): the chat `complete`
 * frame's `result` is only the marker-processor tail of the answer, NOT the full text — the full
 * answer is the joined `text_chunk` stream. So we take the LONGER of the two, which is the joined
 * stream in practice. Both are returned so the director sees the discrepancy.
 */
export function replyFromFrames(frames) {
  const complete = frames.find((f) => (f.event === 'complete') || (f.data && f.data.type === 'complete'));
  const chunks = frames.filter((f) => (f.event === 'text_chunk') || (f.data && f.data.type === 'text_chunk')).map((f) => f.data.text).join('');
  const fromComplete = complete && typeof complete.data.result === 'string' ? complete.data.result : '';
  const reply = fromChunksWins(fromComplete, chunks);
  return { reply, fromComplete, fromChunks: chunks };
}
function fromChunksWins(fromComplete, chunks) {
  if (!chunks) return fromComplete;
  if (!fromComplete) return chunks;
  return chunks.length >= fromComplete.length ? chunks : fromComplete;
}

export const firstChars = (s, n = 120) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/**
 * Fire EXACTLY ONE chat run and follow it to terminal, with the notifications stream held open
 * across the whole run (opened before the POST, closed after the terminal). Logs the mandatory
 * model-action rows (one `chat`; one `memory-extract` iff the turn completed — auto-extraction is
 * scheduled off a SUCCESSFUL terminal only, §5.8).
 *
 * Returns everything the director needs: the 202 body, the full run-SSE frame list, the terminal
 * frame, the reconstructed reply, the notifications frames, and the grounding-relevant
 * context_event/tool_event slices.
 */
export async function runChatTurn({ token, sessionId, message, language = 'pt', journey, username, chatTimeoutMs = 180000, notifGraceMs = 15000 }) {
  const notif = new NotifCollector(token).start();
  await sleep(500); // let the notifications stream attach before the run can emit

  const create = await api('POST', '/api/v1/chat/runs', { token, body: { sessionId, message, language } });
  await appendAction({ journey, username, action: 'chat', expectedAgentTypes: ['chat', 'classifier:*'] });
  const runId = create.body && create.body.runId;

  let sse = { ok: false, frames: [], closedReason: 'no-runid', status: create.status };
  if (runId) {
    // lastEventId:'0' forces replay-ring delivery so a fast terminal cannot fire before we attach.
    sse = await sseCollect(`/api/v1/chat/runs/${runId}/events`, { token, lastEventId: '0', until: isTerminal, timeoutMs: chatTimeoutMs });
  }
  const frames = sse.frames || [];
  const terminalFrame = [...frames].reverse().find(isTerminal) || null;
  const terminalType = terminalFrame ? terminalFrame.data.type : null;
  const { reply, fromComplete, fromChunks } = replyFromFrames(frames);

  // Hold the notifications stream open until the post-terminal usage push arrives (metering fires
  // after the terminal), then close it.
  if (terminalType) await notif.waitFor(() => notif.sawUsageUpdated(), notifGraceMs);
  await notif.stop();

  // Auto-extraction is scheduled ONLY off a successful terminal (§5.8).
  if (terminalType === 'complete') {
    await appendAction({ journey, username, action: 'memory-extract', expectedAgentTypes: ['memory-extract'] });
  }

  const contextEvents = frames.filter((f) => f.data && f.data.type === 'context_event').map((f) => f.data);
  const toolEvents = frames.filter((f) => f.data && f.data.type === 'tool_event').map((f) => f.data);

  return {
    create: { status: create.status, body: create.body },
    runId,
    sseClosedReason: sse.closedReason,
    frames,
    terminalFrame,
    terminalType,
    reply,
    replyFromComplete: fromComplete,
    replyFromChunks: fromChunks,
    contextEvents,
    toolEvents,
    notif: {
      status: notif.status,
      errorBody: notif.errorBody,
      frames: notif.frames,
      sawUsageUpdated: notif.sawUsageUpdated(),
      sawChatAnswer: notif.sawChatAnswer(),
    },
  };
}
