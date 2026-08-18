import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantTable, NonceCache, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger } from '../../src/ledger/index.js';
import { BridgeSocket } from '../../src/transport/index.js';
import { DaemonRuntime } from '../../src/runtime/index.js';
import { resetFirstWriteState } from '../../src/tools/index.js';
import type { TaskProgram } from '../../src/engine/index.js';
import { bootCortex, ekoaCodeAvailable, type Cortex } from './helpers/boot.js';

/**
 * The delegation round trip end to end against the REAL ekoa-code bridge + chokepoint, with OUR
 * daemon (BridgeSocket + DaemonRuntime) dialing in. Proves S1–S9 wired together satisfy the wire
 * contract: derived-output-only results, the S6 correlation-id join, payload-capture (a planted
 * deny-listed value is tokenized in every outbound Anthropic payload while the answer stays
 * cleartext), the revoke kill switch, and honest offline.
 *
 * Skips cleanly when the sibling ekoa-code checkout / built dist is absent.
 */
const PARTY = 'Petrova Holdings'; // a deny-listed value the anonymiser must tokenize
const ORG = 'orgA';
const OWNER = 'u1';
const SESSION = 'sess-1';
const GRANT = 'g1';

const maybe = ekoaCodeAvailable ? describe : describe.skip;

maybe('delegation round trip vs real ekoa-code (§18.8)', () => {
  let cortex: Cortex;
  let fixtureRoot: string;
  let grantRoot: string;
  let ledgerDir: string;

  beforeAll(async () => {
    cortex = await bootCortex({ pairingId: 'p1', org: ORG, ownerUserId: OWNER, party: PARTY });
  }, 90_000);

  afterAll(async () => {
    await cortex.teardown();
  });

  beforeEach(() => {
    resetFirstWriteState();
    cortex.captured.outbound.length = 0;
    cortex.captured.auditIds.length = 0;
    cortex.captured.ledgerRows.length = 0;
    fixtureRoot = mkdtempSync(join(tmpdir(), 'ekoa-int-'));
    grantRoot = join(fixtureRoot, 'granted');
    mkdirSync(grantRoot, { recursive: true });
    ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-int-ledger-'));
    writeFileSync(join(grantRoot, 'contrato.txt'), `Parte: ${PARTY}. Secção 3.1: indemnizações limitadas a 12 meses. NIF 500000000.`);
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(ledgerDir, { recursive: true, force: true });
  });

  /** Dial our daemon (BridgeSocket + DaemonRuntime) into the running Cortex for pairing `pairingId`. */
  async function dialDaemon(pairingId: string): Promise<{ socket: BridgeSocket; close: () => void }> {
    cortex.setActivation(OWNER, { active: true, billingLocked: false });
    await cortex.registerPairing({ pairingId, org: ORG, ownerUserId: OWNER });
    const bridgeToken = cortex.mintBridgeToken(OWNER, pairingId);

    const grants = new GrantTable([{ grantRef: GRANT, root: grantRoot, session: SESSION }]);
    const ledger = new EgressLedger(ledgerDir);
    // The pairing's OWN secret (Cofre R-8) - what Cortex actually signs the binding with, and what
    // a real daemon learns from the token mint. Signing with anything else denies every task; this
    // suite used to be handed the platform-wide jwtSecret, which signs nothing here any more.
    const signingSecret = await cortex.getPairingSigningSecret(pairingId, ORG);
    expect(signingSecret).toBeTruthy();
    const runtime = new DaemonRuntime({
      pairingId,
      org: ORG,
      signingSecret: signingSecret!,
      grants,
      nonces: new NonceCache(),
      egress: new EgressAccounting(),
      ledger,
      send: (frame) => socket.send(frame),
      getCredential: () => bridgeToken,
    });
    const socket = new BridgeSocket({
      wsBase: `ws://127.0.0.1:${cortex.port}`,
      pairingId,
      getToken: async () => bridgeToken,
      onFrame: (frame) => runtime.onFrame(frame),
    });
    await socket.connect();
    await new Promise((r) => setTimeout(r, 50)); // let the server register the live socket
    return { socket, close: () => socket.close() };
  }

  it('reads within the grant, composes via the provider, and returns DERIVED OUTPUT ONLY', async () => {
    const daemon = await dialDaemon('p1');
    try {
      const program: TaskProgram = {
        v: 1,
        steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c', cite: true }],
        compose: { provider: true, instructions: 'Resuma a secção 3.1.' },
      };
      const result = await cortex.delegateToLocal(
        { userId: OWNER, orgId: ORG, sessionId: SESSION },
        { task: JSON.stringify(program), grantRefs: [GRANT], budget: { egressBytes: 10_000, modelSpend: { userId: OWNER } } },
      );
      expect(result.status).toBe('ok');
      expect(result.answer).toBeTruthy();
      // DERIVED OUTPUT ONLY (§18.2.2): no raw file content in the hosted result.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('NIF 500000000');
      expect(serialized).not.toContain('indemnizações limitadas a 12 meses');
      expect(result.citations).toEqual([{ path: 'contrato.txt', range: expect.stringMatching(/^0-\d+$/) }]);
      expect(result.telemetry.egressBytes).toBeGreaterThan(0);
    } finally {
      daemon.close();
    }
  });

  it('S6 JOIN + PAYLOAD CAPTURE: the daemon ledger row and hosted audit share one correlationId; the deny-listed value is tokenized in the outbound payload while the answer stays cleartext', async () => {
    const daemon = await dialDaemon('p1');
    try {
      const program: TaskProgram = {
        v: 1,
        steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c', cite: true }],
        compose: { provider: true, instructions: `Resuma o contrato da ${PARTY}.` },
      };
      const result = await cortex.delegateToLocal(
        { userId: OWNER, orgId: ORG, sessionId: SESSION },
        { task: JSON.stringify(program), grantRefs: [GRANT], budget: { egressBytes: 10_000, modelSpend: { userId: OWNER } } },
      );
      expect(result.status).toBe('ok');

      // S6 join: the hosted audit correlationId == the daemon ledger row's correlationId.
      expect(cortex.captured.auditIds.length).toBeGreaterThan(0);
      expect(cortex.captured.ledgerRows.length).toBeGreaterThan(0);
      const ledgerCorr = cortex.captured.ledgerRows[0]!.correlationId;
      expect(cortex.captured.auditIds).toContain(ledgerCorr);

      // Payload capture (§18.7.3): the planted deny-listed value is tokenized in EVERY outbound
      // Anthropic payload, while the user-visible derived answer is cleartext (never the party).
      expect(cortex.captured.outbound.length).toBeGreaterThan(0);
      for (const payload of cortex.captured.outbound) {
        expect(payload).not.toContain(PARTY);
      }
      expect(result.answer).not.toContain(PARTY);

      // The ledger row path is grant-relative, not an absolute local path.
      expect(cortex.captured.ledgerRows[0]!.path).toBe('contrato.txt');
    } finally {
      daemon.close();
    }
  });

  it('revoke-pairing mid-session disconnects the daemon and a later delegation is unreachable (S4)', async () => {
    const daemon = await dialDaemon('p2');
    try {
      const program: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c' }], answer: 'ok' };
      const ok = await cortex.delegateToLocal(
        { userId: OWNER, orgId: ORG, sessionId: SESSION },
        { task: JSON.stringify(program), grantRefs: [GRANT], budget: { egressBytes: 10_000, modelSpend: { userId: OWNER } } },
      );
      expect(ok.status).toBe('ok');

      await cortex.revokePairing('p2');
      await new Promise((r) => setTimeout(r, 80));
      expect(daemon.socket.currentState()).toBe('revoked');

      const after = await cortex.delegateToLocal(
        { userId: OWNER, orgId: ORG, sessionId: SESSION },
        { task: JSON.stringify(program), grantRefs: [GRANT], budget: { egressBytes: 10_000, modelSpend: { userId: OWNER } } },
      );
      expect(after.status).toBe('unreachable');
    } finally {
      daemon.close();
    }
  });

  it('a delegation to an owner with no paired daemon is unreachable (offline is honest, §18.2.3)', async () => {
    const result = await cortex.delegateToLocal(
      { userId: 'nobody', orgId: ORG, sessionId: SESSION },
      { task: JSON.stringify({ v: 1, steps: [] }), grantRefs: [], budget: { egressBytes: 10_000, modelSpend: { userId: 'nobody' } } },
    );
    expect(result.status).toBe('unreachable');
  });

  it('an out-of-grant read from inside a delegated task is denied (S1) — the result is denied, never leaks bytes', async () => {
    writeFileSync(join(fixtureRoot, 'secret.txt'), 'SECRET outside the grant');
    const daemon = await dialDaemon('p3');
    try {
      const program: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: '../secret.txt', as: 'x' }], answer: 'x' };
      const result = await cortex.delegateToLocal(
        { userId: OWNER, orgId: ORG, sessionId: SESSION },
        { task: JSON.stringify(program), grantRefs: [GRANT], budget: { egressBytes: 10_000, modelSpend: { userId: OWNER } } },
      );
      expect(result.status).toBe('denied');
      expect(JSON.stringify(result)).not.toContain('SECRET outside the grant');
    } finally {
      daemon.close();
    }
  });
});
