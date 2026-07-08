/**
 * J2 — GROUNDED CHAT (credentialed, REAL model). Seeds one org-private knowledge document, then
 * asks a question whose answer lives ONLY in that document, and proves the hosted chat grounds on
 * it: the run reaches a `complete` terminal, the reply carries the two seeded facts (11 dias úteis
 * + código RX-417), the notifications channel pushes usage_updated, the turn persists, and a
 * billing row lands. The context_event / knowledge tool_event frames are captured as grounding
 * evidence (the director judges answer quality — the FULL reply is saved untruncated).
 */
import { evidence, PASS, FAIL, INFO } from './_lib.mjs';
import { admin, createOrgUser, newSession, runChatTurn, api, firstChars } from './_chat.mjs';

const J = 'J2-grounding';
const results = [];
const ev = {};

const DOC_TEXT = 'O prazo de reembolso da GroundCo é de 11 dias úteis e o código interno do processo é RX-417.';
const QUESTION = 'Qual é o prazo de reembolso da GroundCo e qual é o código interno do processo?';

async function main() {
  const adminToken = await admin();
  const { orgId, userId, token, username } = await createOrgUser(adminToken, {
    orgName: 'GroundCo', orgDisplay: 'GroundCo', username: 'gc-u1', role: 'builder',
  });
  ev.setup = { orgId, userId, hasToken: !!token };
  if (!token) { FAIL('J2.setup', 'could not provision/login gc-u1', results); return finish(); }
  PASS('J2.setup', `org GroundCo + gc-u1 builder ready (userId=${userId})`, results);

  // 1. Seed the org-private knowledge document (model-free ingestion).
  const doc = await api('POST', '/api/v1/knowledge/documents', {
    token,
    body: { collection: 'politica-interna', title: 'Política de reembolsos GroundCo', text: DOC_TEXT, language: 'pt' },
  });
  ev.document = { status: doc.status, body: doc.body };
  if (doc.status === 201) PASS('J2.doc', `knowledge doc ingested id=${doc.body && doc.body.id}`, results);
  else FAIL('J2.doc', `expected 201, got ${doc.status} ${firstChars(doc.text)}`, results);

  // 2-3. Session + grounded chat turn (notifications collector opens before the run).
  const session = await newSession(token, 'J2 grounding');
  ev.session = { status: session.status, id: session.id };
  if (session.status !== 201 || !session.id) { FAIL('J2.session', `session create -> ${session.status}`, results); return finish(); }

  const turn = await runChatTurn({ token, sessionId: session.id, message: QUESTION, language: 'pt', journey: J, username });
  ev.turn = turn; // FULL frames + reply saved (untruncated) for the director

  if (turn.terminalType === 'complete') PASS('J2.terminal', `run ${turn.runId} reached complete terminal`, results);
  else FAIL('J2.terminal', `terminal=${turn.terminalType} closedReason=${turn.sseClosedReason} err=${JSON.stringify(turn.terminalFrame && turn.terminalFrame.data)}`, results);

  const reply = turn.reply || '';
  if (reply.trim()) PASS('J2.reply', `reply captured (${reply.length} chars): "${firstChars(reply)}"`, results);
  else FAIL('J2.reply', 'no reply text reconstructed from frames', results);

  // Boot-B finding: the `complete.result` frame is a truncated tail vs the joined text_chunk stream.
  const cLen = (turn.replyFromComplete || '').length;
  const kLen = (turn.replyFromChunks || '').length;
  if (cLen && kLen && cLen < kLen) INFO('J2.completeTail', `complete.result is a ${cLen}-char TAIL; full answer (${kLen} chars) only via text_chunk stream`, results);

  // Grounding quality signals (director judges; recorded either way).
  const has11 = /\b11\b/.test(reply) && /dias\s+úteis/i.test(reply);
  const hasCode = /RX-?417/i.test(reply);
  if (has11 && hasCode) PASS('J2.grounded', 'reply contains BOTH seeded facts (11 dias úteis + RX-417)', results);
  else INFO('J2.grounded', `reply grounding: 11-dias-úteis=${has11} RX-417=${hasCode} (director judges)`, results);

  // context_event + knowledge tool_event frames = grounding evidence.
  const knowledgeTools = turn.toolEvents.filter((t) => /knowledge|search|read|grep|glob/i.test(String(t.tool)));
  ev.grounding = { contextEvents: turn.contextEvents, knowledgeToolEvents: knowledgeTools };
  INFO('J2.contextEvents', `context_event frames=${turn.contextEvents.length}; knowledge tool_event frames=${knowledgeTools.length}`, results);

  // Notifications assertions.
  if (turn.notif.sawUsageUpdated) PASS('J2.usageUpdated', 'notifications channel pushed usage_updated', results);
  else FAIL('J2.usageUpdated', `usage_updated NOT seen (notif status=${turn.notif.status}, frames=${turn.notif.frames.length})`, results);
  INFO('J2.chatAnswer', `chat_answer notification ${turn.notif.sawChatAnswer ? 'EMITTED' : 'not emitted (expected for plain chat — answer rides run-SSE)'}`, results);

  // Persisted turn.
  const msgs = await api('GET', `/api/v1/sessions/${session.id}/messages`, { token });
  const items = (msgs.body && msgs.body.items) || [];
  ev.messages = { status: msgs.status, count: items.length, roles: items.map((m) => m.role) };
  const hasUser = items.some((m) => m.role === 'user');
  const hasAssistant = items.some((m) => m.role === 'assistant');
  if (msgs.status === 200 && hasUser && hasAssistant) PASS('J2.persisted', `session has persisted turn (user+assistant, ${items.length} msgs)`, results);
  else INFO('J2.persisted', `messages status=${msgs.status} count=${items.length} roles=${JSON.stringify(ev.messages.roles)}`, results);

  // Billing row after the call.
  const history = await api('GET', '/api/v1/billing/history', { token });
  const rows = (history.body && history.body.items) || [];
  ev.billing = { status: history.status, count: rows.length, rows };
  const chatRow = rows.find((r) => /chat/i.test(String(r.type)) || /chat/i.test(String(r.description || '')));
  if (rows.length > 0) PASS('J2.billing', `billing history has ${rows.length} row(s) after chat; chat-ish row=${!!chatRow}`, results);
  else FAIL('J2.billing', 'billing history empty after a real metered chat', results);

  return finish();
}

async function finish() {
  const file = await evidence(J, 'j2-grounding', { results, detail: ev });
  console.log(`INFO J2.evidence ${file}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
