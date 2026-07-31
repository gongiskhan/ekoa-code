import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor, BridgeFrame } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import * as registry from '../../src/bridge/registry.js';
import {
  requestAttendedCeremony,
  acceptSessionPush,
  AttendedError,
  __resetCeremoniesForTests,
  __openCeremonyCount,
} from '../../src/bridge/attended.js';
import { unwrap, issueGrant } from '../../src/cofre/index.js';

/**
 * SECURITY SUITE — the attended ceremony rail (Cofre WS-J / J-5).
 *
 * WHAT THIS RAIL AVOIDS BUILDING. Portuguese legal portals authenticate with a smartcard read by a
 * physical reader on a physical machine. The general solution is a card stack in Cortex — PKCS#11,
 * driver matrices, `.pfx` custody — a large surface holding the most sensitive credential a lawyer
 * owns, on a server that has no business seeing it. Instead the machine that already HAS the reader
 * opens the browser and holds it while the human completes the ceremony; what comes back is the
 * resulting session. The card, its PIN and every certificate stay on that machine.
 *
 * So the load-bearing assertion here is a NEGATIVE one: no certificate material transits, and
 * Cortex holds no code that could handle it if it did. The rest of the suite pins the three ways a
 * push could be dishonest — a ceremony nobody opened, a machine answering for another, and a
 * session for an origin nobody asked about — the last being the dangerous one, because it would
 * produce a perfectly valid, correctly-encrypted Cofre item for the WRONG SITE.
 */
let mem: MongoMemoryServer;
const actor: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;
const PAIRING = 'pair-1';
const ORIGIN = 'citius.tribunaisnet.mj.pt';

/** A storageState as Playwright produces it, with a session cookie for the portal. */
const storageState = (domain = ORIGIN) => ({
  cookies: [{ name: 'JSESSIONID', value: 'abc123', domain, path: '/' }],
  origins: [],
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_j5');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  __resetCeremoniesForTests();
  vi.restoreAllMocks();
});

function captureWire(reachable = true): BridgeFrame[] {
  const sent: BridgeFrame[] = [];
  vi.spyOn(registry, 'sendToPairing').mockImplementation((_p: string, frame: BridgeFrame) => {
    if (!reachable) return false;
    sent.push(frame);
    return true;
  });
  return sent;
}

const open = () =>
  requestAttendedCeremony(actor, {
    pairingId: PAIRING,
    kind: 'card_login',
    origin: ORIGIN,
    reason: 'Iniciar sessão no Citius com o cartão',
    label: 'Citius',
  });

describe('the ceremony happens where the card is', () => {
  it('asks the named machine, declaring the origin', async () => {
    const sent = captureWire();
    const requestId = await open();

    expect(sent).toHaveLength(1);
    const frame = sent[0] as Extract<BridgeFrame, { type: 'attended.request' }>;
    expect(frame.type).toBe('attended.request');
    expect(frame.kind).toBe('card_login');
    expect(frame.origin).toBe(ORIGIN);
    expect(requestId).toBeTruthy();
  });

  it('an offline machine REFUSES rather than queueing — a ceremony needs a human standing there', async () => {
    captureWire(false);
    await expect(open()).rejects.toBeInstanceOf(AttendedError);
    expect(__openCeremonyCount()).toBe(0);
  });

  it('the pushed session becomes a Cofre item, readable only through unwrap()', async () => {
    captureWire();
    const requestId = await open();
    const item = await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });

    expect(item.type).toBe('session');
    // Locked by default: arriving from a ceremony is not a grant to use it.
    await expect(unwrap(item._id, actor, { kind: 'browser', origin: `https://${ORIGIN}` })).rejects.toThrow();

    await issueGrant(actor, item._id, '1_day');
    const { value } = await unwrap(item._id, actor, { kind: 'browser', origin: `https://${ORIGIN}` });
    expect(JSON.parse(value).cookies[0].name).toBe('JSESSIONID');
  });

  it('the session records that it was established ON THE MACHINE, which the router needs later', async () => {
    captureWire();
    const requestId = await open();
    const item = await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });

    const meta = (item as unknown as { sessionMetadata?: Record<string, unknown> }).sessionMetadata;
    expect(meta?.establishedBy).toEqual({ kind: 'machine', pairingId: PAIRING });
    // A card-established session replayed from a datacenter IP is exactly the pattern portals
    // flag, so the egress binding travels with the item (WS-I reads it at checkout).
    expect(meta?.boundEgress).toEqual({ kind: 'residential', pairingId: PAIRING });
  });
});

describe('a push is only accepted for the ceremony that was actually opened', () => {
  it('an unknown requestId is refused', async () => {
    await expect(
      acceptSessionPush({ requestId: 'never-opened', pairingId: PAIRING, origin: ORIGIN, storageState: storageState() }),
    ).rejects.toBeInstanceOf(AttendedError);
  });

  it('a different machine cannot answer for the one that was asked', async () => {
    captureWire();
    const requestId = await open();
    await expect(
      acceptSessionPush({ requestId, pairingId: 'other-machine', origin: ORIGIN, storageState: storageState() }),
    ).rejects.toBeInstanceOf(AttendedError);
  });

  it('THE DANGEROUS ONE: a session for a different origin is refused', async () => {
    // Without this the push would mint a perfectly valid, correctly-encrypted, correctly
    // origin-bound Cofre item for the WRONG SITE — quietly usable later by anything that looks a
    // session up by label.
    captureWire();
    const requestId = await open();
    await expect(
      acceptSessionPush({
        requestId,
        pairingId: PAIRING,
        origin: 'attacker.example',
        storageState: storageState('attacker.example'),
      }),
    ).rejects.toBeInstanceOf(AttendedError);

    const { cofreItems } = await import('../../src/cofre/store.js');
    expect(await cofreItems.raw.find({})).toHaveLength(0);
  });

  it('one ceremony yields one session — a duplicate push is refused', async () => {
    captureWire();
    const requestId = await open();
    await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });
    await expect(
      acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() }),
    ).rejects.toBeInstanceOf(AttendedError);
  });

  it('a scheme on one side and a bare host on the other is the same origin', async () => {
    captureWire();
    const requestId = await open();
    // The daemon reports what the browser landed on; the request carried a bare host.
    const item = await acceptSessionPush({
      requestId,
      pairingId: PAIRING,
      origin: `https://${ORIGIN}/consultas`,
      storageState: storageState(),
    });
    expect(item.type).toBe('session');
  });
});

describe('no certificate material transits, and Cortex could not handle it if it did', () => {
  it('the request frame carries no certificate, key or PIN field', async () => {
    const sent = captureWire();
    await open();
    const serialized = JSON.stringify(sent[0]);
    for (const forbidden of ['pfx', 'p12', 'pkcs', 'privateKey', 'certificate', 'pin']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('what comes back is a SESSION, not a credential to re-authenticate with', async () => {
    captureWire();
    const requestId = await open();
    const item = await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });
    await issueGrant(actor, item._id, '1_day');
    const { value } = await unwrap(item._id, actor, { kind: 'browser', origin: `https://${ORIGIN}` });
    // Cookies only. A card session cannot be re-minted from this, which is the point: if it leaks,
    // it expires; a certificate would not.
    const parsed = JSON.parse(value);
    expect(Object.keys(parsed).sort()).toEqual(['cookies', 'origins']);
  });

  it('Cortex holds NO card-handling code — the invariant that keeps the surface absent', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const abs = join(dir, e);
        return statSync(abs).isDirectory() ? walk(abs) : abs.endsWith('.ts') ? [abs] : [];
      });

    // Matched on IMPORTS, not on prose. `attended.ts` NAMES pkcs11 and .pfx in its docblock
    // precisely to explain what the rail avoids building, and a gate that punished the explanation
    // would push the reasoning out of the file where it belongs. What actually signals "the card
    // stack got built after all" is a DEPENDENCY arriving — so that is what this matches.
    const CARD_LIBS = /(pkcs11|graphene-pk11|node-webcrypto-p11|softhsm|node-forge|node-pfx)/i;
    const importOf = /^\s*(?:import\b[^;]*?from\s*|.*\brequire\s*\(\s*)['"]([^'"]+)['"]/gm;

    const offenders: string[] = [];
    for (const file of walk(root)) {
      for (const m of readFileSync(file, 'utf8').matchAll(importOf)) {
        if (CARD_LIBS.test(m[1]!)) offenders.push(`${file} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);

    // Non-vacuity: the matcher DOES catch a card-library import, so the empty result above means
    // "none present" rather than "the regex never fires".
    const planted = [...`import { Module } from 'pkcs11js';`.matchAll(importOf)].map((m) => m[1]!);
    expect(planted.some((p) => CARD_LIBS.test(p))).toBe(true);
  });
});
