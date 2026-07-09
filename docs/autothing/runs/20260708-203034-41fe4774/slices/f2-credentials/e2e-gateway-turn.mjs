#!/usr/bin/env node
/**
 * F2 acceptance (b) probe: with LLM_CHOKEPOINT_BASE_URL UNSET (default local-gateway
 * topology, boot-b direct=0) and a credential configured, ONE chat turn completes
 * end-to-end (no 401), and /health gatewayUnmeteredCalls stays 0.
 * Run against a live boot-b stack: node e2e-gateway-turn.mjs
 */
import { admin, createOrgUser, newSession, runChatTurn, api } from '../../../../../release/probes/_chat.mjs';

const t0 = Date.now();
const adminToken = await admin();
const u = await createOrgUser(adminToken, { orgName: `f2org${Date.now() % 100000}`, username: `f2user${Date.now() % 100000}` });
if (!u.token) throw new Error('user provisioning failed');
const session = await newSession(u.token, 'F2 gateway-topology turn');

const turn = await runChatTurn({
  token: u.token,
  sessionId: session.id,
  message: 'Responde só com a palavra: funciona',
  journey: 'batch1-f2',
  username: u.username,
  chatTimeoutMs: 240000,
});

const health = (await api('GET', '/health', {})).body;
const terminal = turn.terminalFrame ?? turn.frames?.at?.(-1) ?? null;
const result = {
  at: new Date().toISOString(),
  durationMs: Date.now() - t0,
  runCreated: !!turn.runId || turn.frames.length > 0,
  frameCount: turn.frames.length,
  terminalType: turn.terminalType ?? (terminal && terminal.type) ?? null,
  replyPreview: (turn.reply || '').slice(0, 120),
  had401: JSON.stringify(turn.frames).includes('Invalid or missing API key'),
  gatewayUnmeteredCalls: health.gatewayUnmeteredCalls,
  claudeAuth: health.claudeAuth,
};
console.log(JSON.stringify(result, null, 2));
const pass = result.replyPreview.length > 0 && !result.had401 && result.gatewayUnmeteredCalls === 0 && result.terminalType === 'complete';
console.log(pass ? 'F2-E2E: PASS' : 'F2-E2E: FAIL');
process.exit(pass ? 0 : 1);
