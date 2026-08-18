import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../../src/cli/commands/serve.js';
import { configPath, loadConfig, saveConfig, saveGrants } from '../../src/auth/index.js';
import { EXIT, type CliContext } from '../../src/cli/context.js';
import { pt } from '../../src/i18n/pt.js';
import type { TaskProgram } from '../../src/engine/index.js';
import { bootCortex, ekoaCodeAvailable, type Cortex } from './helpers/boot.js';

/**
 * THE P0.1 DONE-CRITERION: a file delegation succeeds through the FULL `serve()` path, against a
 * really-booted Cortex, with a daemon that starts knowing NEITHER its signing secret NOR its org.
 *
 * Why this suite exists rather than trusting the other two. `round-trip` and `evidence` construct
 * their DaemonRuntime directly, handing it the org and (now) the pairing's real secret. That skips
 * the handshake entirely: they would stay green even if the token response never carried `org` at
 * all. And the verifier checks the SIGNATURE before it checks cross-org addressing, so the org gap
 * hides behind a signature gap - the exact reason a two-part break read as one for weeks.
 *
 * So this suite starts from a config.json with no `org` and no `signingSecret`, boots the real
 * daemon, and lets it LEARN both from `POST /api/v1/bridge/token` on its own pre-dial mint. The
 * assertions are the two that matter: the values are persisted, and a real delegated file read
 * comes back `ok` instead of `denied`.
 *
 * Skips cleanly when the sibling ekoa-code checkout / built dist is absent.
 */
const ORG = 'orgA';
const OWNER = 'u1';
const SESSION = 'sess-fs';
const GRANT = 'g-fs';
const PAIRING = 'pFS';
const PARTY = 'Petrova Holdings';

const maybe = ekoaCodeAvailable ? describe : describe.skip;

maybe('full-serve file delegation (the signing-secret + org handshake)', () => {
  let cortex: Cortex;
  let home: string;
  let fixtureRoot: string;
  let grantRoot: string;

  beforeAll(async () => {
    cortex = await bootCortex({ pairingId: PAIRING, org: ORG, ownerUserId: OWNER, party: PARTY });
  }, 90_000);
  afterAll(async () => { await cortex.teardown(); });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ekoa-fs-home-'));
    fixtureRoot = mkdtempSync(join(tmpdir(), 'ekoa-fs-'));
    grantRoot = join(fixtureRoot, 'granted');
    mkdirSync(grantRoot, { recursive: true });
    writeFileSync(join(grantRoot, 'contrato.txt'), 'Secção 3.1: indemnizações limitadas a 12 meses.');
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  /**
   * A paired daemon home exactly as `pair` leaves it: a platform credential and a pairing id, and
   * NOTHING about the task binding. Nothing but the mint can supply that.
   */
  function writePairedHome(): void {
    saveConfig(home, {
      cortexBaseUrl: `http://127.0.0.1:${cortex.port}`,
      pairingId: PAIRING,
      credentials: {
        access: cortex.platformToken(OWNER, ORG),
        expires: Date.now() + 86_400_000,
        user: { id: OWNER, username: OWNER, role: 'user' },
      },
    });
    saveGrants(home, [{ grantRef: GRANT, root: grantRoot, session: SESSION, createdAt: new Date().toISOString() }]);
  }

  function startDaemon(): { code: Promise<number>; out: string[]; stop: () => void } {
    const out: string[] = [];
    const ctx: CliContext = {
      home,
      io: { out: (l) => out.push(l), err: (l) => out.push(l) },
      fetchImpl: fetch, // the REAL mint over HTTP against the booted Cortex
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      env: {},
      pickFolder: async () => ({ ok: false, reason: 'unavailable' }),
      randomSuffix: () => 'sfx',
    };
    const code = serve(['--port', String(38_500 + (process.pid % 400))], ctx);
    return { code, out, stop: () => { process.emit('SIGINT'); } };
  }

  async function waitFor(check: () => boolean, label: string, ms = 15_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  it('a daemon that knows neither secret nor org LEARNS both from the mint and reads a granted file', async () => {
    cortex.setActivation(OWNER, { active: true, billingLocked: false });
    await cortex.registerPairing({ pairingId: PAIRING, org: ORG, ownerUserId: OWNER });
    writePairedHome();

    // Precondition, stated so a future refactor cannot quietly seed the binding and pass by luck.
    const before = loadConfig(home)!;
    expect(before.org).toBeUndefined();
    expect(before.signingSecret).toBeUndefined();

    const daemon = startDaemon();
    try {
      await waitFor(() => daemon.out.includes(pt.serveState('open')), 'the daemon socket to open');

      // 1. THE HANDSHAKE. Both halves arrived on the mint and were persisted, and the secret is the
      //    pairing's own registry secret - not the platform jwtSecret, not an empty string.
      await waitFor(() => loadConfig(home)?.signingSecret !== undefined, 'the binding to persist');
      const learned = loadConfig(home)!;
      expect(learned.org).toBe(ORG);
      expect(learned.signingSecret).toBe(await cortex.getPairingSigningSecret(PAIRING, ORG));
      expect(daemon.out).toContain(pt.serveBindingUpdated);

      // 2. THE FIX. A real signed task now verifies: signature (step 1) AND org (step 3). Before
      //    this slice this line returned 'denied' with a ledgered 'bad signature'.
      const program: TaskProgram = {
        v: 1,
        steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c', cite: true }],
        answer: 'li o contrato',
      };
      const result = await cortex.delegateToLocal(
        { userId: OWNER, orgId: ORG, sessionId: SESSION },
        { task: JSON.stringify(program), grantRefs: [GRANT], budget: { egressBytes: 10_000, modelSpend: { userId: OWNER } } },
      );
      expect(result.status).toBe('ok');
      expect(result.citations).toEqual([{ path: 'contrato.txt', range: expect.stringMatching(/^0-\d+$/) }]);
      // Derived output only holds on this path too: no raw bytes ride the result home.
      expect(JSON.stringify(result)).not.toContain('indemnizações limitadas a 12 meses');
    } finally {
      daemon.stop();
      await expect(daemon.code).resolves.toBe(EXIT.OK);
    }
  }, 60_000);

  it('a REVOKED pairing is handed no binding, so an un-bound daemon stays fail-closed', async () => {
    cortex.setActivation(OWNER, { active: true, billingLocked: false });
    await cortex.registerPairing({ pairingId: PAIRING, org: ORG, ownerUserId: OWNER });
    await cortex.revokePairing(PAIRING);
    writePairedHome();

    const daemon = startDaemon();
    try {
      // The dial itself is refused for a revoked pairing; what this pins is the MINT's discretion:
      // it hands back a token but neither half of the binding, so nothing is written to disk and
      // the verifier still has an empty secret to refuse with.
      await waitFor(() => daemon.out.some((l) => l.startsWith('Estado da ligação')), 'the first dial attempt');
      await new Promise((r) => setTimeout(r, 200));
      const after = loadConfig(home)!;
      expect(after.org).toBeUndefined();
      expect(after.signingSecret).toBeUndefined();
      expect(daemon.out).not.toContain(pt.serveBindingUpdated);
      // And the secret never reached the disk by some other route.
      expect(readFileSync(configPath(home), 'utf-8')).not.toContain('signingSecret');
    } finally {
      daemon.stop();
      await expect(daemon.code).resolves.toBe(EXIT.OK);
    }
  }, 60_000);
});
