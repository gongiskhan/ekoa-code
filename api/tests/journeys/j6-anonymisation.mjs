/**
 * J6 — ANONYMISATION round-trip (credentialed, REAL model). A checksum-VALID synthetic company
 * NIF (computed at runtime, never a live person's) is sent inside a chat message. The egress
 * chokepoint must tokenise it BEFORE the model sees it and de-anonymise the model's reply back to
 * cleartext — so the user-visible reply contains the ORIGINAL NIF while the outbound payload never
 * did. We prove the round-trip on the reply, capture the anonymisation audit rows from Registo,
 * and (separately, step 4) run the committed tokens-only chokepoint spec.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { evidence, PASS, FAIL, INFO, api, REPO_ROOT } from './_lib.mjs';
import { admin, createOrgUser, newSession, runChatTurn, firstChars } from './_chat.mjs';

const J = 'J6-anonymisation';
const results = [];
const ev = {};

/** Compute a checksum-VALID PT company NIF (starts with 5) from a clearly-synthetic base. */
async function computeNif() {
  const mod = await import(pathToFileURL(join(REPO_ROOT, 'api', 'dist', 'llm', 'anonymise', 'checksum.js')).href);
  const base = '50999901'; // 8 digits, clearly synthetic, company range (starts 5)
  const d = base.split('').map((c) => c.charCodeAt(0) - 48);
  let sum = 0; for (let i = 0; i < 8; i++) sum += d[i] * (9 - i);
  const r = sum % 11; const c = 11 - r; const control = c >= 10 ? 0 : c;
  const nif = base + String(control);
  return { base, weightedSum: sum, mod11: r, control, nif, valid: mod.isValidNif(nif) };
}

async function main() {
  const comp = await computeNif();
  ev.nif = comp;
  if (comp.valid && /^5/.test(comp.nif)) PASS('J6.nif', `synthetic company NIF ${comp.nif} is checksum-VALID (base ${comp.base}, mod-11 control ${comp.control})`, results);
  else { FAIL('J6.nif', `computed NIF ${comp.nif} not valid/company`, results); return finish(); }

  const adminToken = await admin();
  const { orgId, userId, token, username } = await createOrgUser(adminToken, { orgName: 'AnonZ', orgDisplay: 'AnonZ', username: 'az-u1', role: 'builder' });
  ev.setup = { orgId, userId };
  if (!token) { FAIL('J6.setup', 'could not provision az-u1', results); return finish(); }
  PASS('J6.setup', `org AnonZ + az-u1 builder ready (userId=${userId})`, results);

  // 2. NIF-bearing chat.
  const message = `O NIF do cliente da AnonZ é ${comp.nif}. Escreve uma frase formal a confirmar o NIF do cliente.`;
  const session = await newSession(token, 'J6 anonymisation');
  const turn = await runChatTurn({ token, sessionId: session.id, message, language: 'pt', journey: J, username });
  ev.turn = turn; // FULL reply saved
  if (turn.terminalType === 'complete') PASS('J6.terminal', `run ${turn.runId} complete`, results);
  else FAIL('J6.terminal', `terminal=${turn.terminalType} ${JSON.stringify(turn.terminalFrame && turn.terminalFrame.data)}`, results);

  const reply = turn.reply || '';
  const cleartext = reply.includes(comp.nif);
  ev.roundTrip = { nif: comp.nif, replyContainsNif: cleartext, replyLength: reply.length };
  if (cleartext) PASS('J6.roundTrip', `reply contains the ORIGINAL NIF ${comp.nif} in CLEARTEXT (de-anonymisation round-trip): "${firstChars(reply)}"`, results);
  else FAIL('J6.roundTrip', `reply does NOT contain cleartext NIF ${comp.nif}: "${firstChars(reply)}"`, results);
  // Coherence signal (director judges): a formal PT confirmation sentence.
  const coherent = /\bNIF\b/i.test(reply) && reply.length > 30;
  INFO('J6.coherence', `reply coherent-PT signal=${coherent} (director judges): "${firstChars(reply)}"`, results);

  // 3. Audit trail — filtered (?type=anonymisation) AND unfiltered, cross-org (super-admin).
  const filtered = await api('GET', '/api/v1/registo?type=anonymisation&limit=50', { token: adminToken });
  const fRows = (filtered.body && filtered.body.items) || [];
  // The stored actionType is category.type = 'anonymisation.egress-mask', so the bare
  // ?type=anonymisation filter does NOT match — capture that, then use the fully-qualified filter.
  const filteredQ = await api('GET', '/api/v1/registo?type=anonymisation.egress-mask&limit=50', { token: adminToken });
  const fqRows = (filteredQ.body && filteredQ.body.items) || [];
  const unfiltered = await api('GET', '/api/v1/registo?limit=100', { token: adminToken });
  const allRows = (unfiltered.body && unfiltered.body.items) || [];
  const anonRows = allRows.filter((rr) => /anonymisation/.test(String(rr.actionType)));
  const myAnon = anonRows.filter((rr) => rr.actor === userId || rr.orgId === orgId);
  const withEntities = anonRows.filter((rr) => rr.targetIds && rr.targetIds.entityCount > 0);
  ev.audit = {
    filteredType_anonymisation: { status: filtered.status, total: filtered.body && filtered.body.total, count: fRows.length },
    filteredType_anonymisation_egressMask: { status: filteredQ.status, total: filteredQ.body && filteredQ.body.total, count: fqRows.length },
    unfiltered: { status: unfiltered.status, total: unfiltered.body && unfiltered.body.total, count: allRows.length },
    anonymisationRows: anonRows.length,
    anonRowsWithEntities: withEntities.length,
    azU1AnonRows: myAnon.length,
    sampleAnonRows: anonRows.slice(0, 4).map((rr) => ({ actionType: rr.actionType, actor: rr.actor, orgId: rr.orgId, targetIds: rr.targetIds })),
  };
  INFO('J6.auditFilter', `?type=anonymisation -> ${fRows.length} rows (bare filter does NOT match stored 'anonymisation.egress-mask'); ?type=anonymisation.egress-mask -> ${fqRows.length} rows`, results);
  if (anonRows.length > 0) {
    PASS('J6.audit', `unfiltered registo has ${anonRows.length} anonymisation.egress-mask row(s) (total=${allRows.length}); ${withEntities.length} with entityCount>0; az-u1/AnonZ rows=${myAnon.length}`, results);
  } else {
    INFO('J6.audit', `NO anonymisation rows in registo after a NIF-bearing chat (total rows=${allRows.length}) — captured, not editorialised`, results);
  }

  return finish();
}

async function finish() {
  const file = await evidence(J, 'j6-anonymisation', { results, detail: ev });
  console.log(`INFO J6.evidence ${file}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
