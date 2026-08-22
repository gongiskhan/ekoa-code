/**
 * CS6 SECURITY — METADATA ONLY, in both of the forms RUN_SPEC criterion 10 demands: structurally
 * AND behaviourally. This is the suite that has to stay green for the operator lock ("no opening of
 * Caixa Citius notification DOCUMENTS; a future `abrir_documento` action is `mutates:true`, behind
 * the write rail, after a lawyer's decision") to mean anything.
 *
 * STRUCTURAL (source-level, no I/O). The assembled sync module performs NO network I/O of its own
 * at all — the single egress in the whole rail is CS4's connector, which has its own structural
 * proof that it requests nothing but its one configured inbox URL. This suite pins the property
 * that makes that airtight here: `citius-sync.ts` does not so much as NAME a document. The parsed
 * row is persisted by SPREADING the whole typed metadata record, so there is no `documentoRef`,
 * `docId` or `Documento` identifier anywhere in the file to dereference — a future edit that wanted
 * to open one would have to introduce the name, which is exactly the review moment this test
 * creates. An EXACT EXPORT ALLOWLIST rides alongside, so a new exported function cannot appear
 * without a reviewer seeing it.
 *
 * BEHAVIOURAL (a real portal, a real counter). Three full syncs against the CS2 mock — a COMPLETE,
 * an INCOMPLETE caught by reconciliation, and a COMPLETE — over notifications that really DO carry
 * document links, leave the mock's per-document hit counter at ZERO. The counter is driven to 1 and
 * reset INSIDE the same test first, so a counter that never worked cannot make this pass vacuously
 * (the non-vacuity discipline CS4 set).
 *
 * The landed rows are read back out of Mongo to show what the sync DID capture: the row records
 * that a document EXISTS (that is metadata a lawyer needs) and the inert reference to it — and the
 * reference was never followed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { decodeHtml, parseHiddenFields } from '../../src/legal/portal-html.js';
import * as syncModule from '../../src/legal/citius-sync.js';
import { syncCitiusNotifications, syncStateKeyFor, type CitiusSyncDeps } from '../../src/legal/citius-sync.js';
import type { CitiusTransport } from '../../src/legal/citius-mandatarios-http.js';
import type { EnsureSessionResult } from '../../src/automation/session-establishment.js';
import { Store, type Doc } from '../../src/data/store.js';
// @ts-expect-error - JS mock helper, no d.ts
import { startMockCitius } from '../helpers/mock-citius-webforms-server.mjs';

const MODULE_PATH = fileURLToPath(new URL('../../src/legal/citius-sync.ts', import.meta.url));
const MODULE_SRC = readFileSync(MODULE_PATH, 'utf-8');
/** Comments stripped: the docblock legitimately DISCUSSES documents and must be free to. */
const MODULE_CODE = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const ROUTE_PATH = fileURLToPath(new URL('../../src/routes/sync.ts', import.meta.url));
const ROUTE_CODE = readFileSync(ROUTE_PATH, 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

// ---------------------------------------------------------------------------
// 1. STRUCTURAL — the module cannot address a document, and cannot fetch anything
// ---------------------------------------------------------------------------

describe('citius-sync · METADATA ONLY, structurally', () => {
  it('the module never NAMES a document: no documentoRef, no docId, no Documento', () => {
    expect(MODULE_CODE).not.toMatch(/documentoRef/);
    expect(MODULE_CODE).not.toMatch(/\bdocId\b/i);
    expect(MODULE_CODE).not.toMatch(/Documento\.aspx/i);
    // …nor the row's document flag: the record is stored by SPREAD, so no per-field handling exists
    expect(MODULE_CODE).not.toMatch(/temDocumento/);
  });

  it('the module performs NO network I/O of its own — the connector is the single egress', () => {
    expect(MODULE_CODE).not.toMatch(/\bfetch\s*\(/);
    expect(MODULE_CODE).not.toMatch(/guardedFetch|credentialedFetch|XMLHttpRequest/);
    expect(MODULE_CODE).not.toMatch(/\bhttps?:\/\//); // no URL literal anywhere in the code
    expect(MODULE_CODE).not.toMatch(/from '(node:)?(http|https|net|dns)'/);
  });

  it('the ROUTE is equally inert: it validates, calls one domain module, and shapes the answer', () => {
    expect(ROUTE_CODE).not.toMatch(/\bfetch\s*\(/);
    expect(ROUTE_CODE).not.toMatch(/documentoRef|Documento\.aspx/i);
  });

  it('defines no function whose NAME suggests opening, downloading or fetching anything', () => {
    const declared = [...MODULE_CODE.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!);
    const suspicious = declared.filter((n) => /(fetch|download|abrir|open|descarreg|retrieve|documento)/i.test(n));
    expect(suspicious).toEqual([]);
  });

  it('the EXACT export surface — a new export cannot appear without a reviewer seeing it', () => {
    expect(Object.keys(syncModule).sort()).toEqual(
      [
        'CITIUS_INTEGRATION_KEY',
        'CITIUS_SYNC_ACTION_KEY',
        'CitiusSyncError',
        'citiusItemDate',
        // SLICE S9, and this list is exactly where that addition was meant to be argued rather than
        // absorbed. `listCitiusNotificationRows` is the SECOND READER of `citius_notifications` and
        // it lives in this module on purpose: the collection is keyed per MANDATÁRIO (hazard 4), so
        // a reader outside this file would have had to re-derive `syncStateKeyFor` and could have
        // re-derived it wrongly - silently, since one lawyer receiving another's caseload breaks
        // nothing. What it hands out is the LANDED ROW, which is metadata by construction: the
        // structural cases above still hold (this module names no document identifier at all), and
        // `tests/legal/citius-processos.test.ts` re-proves the absence one tier out, on the rows the
        // `processos` action actually returns.
        'listCitiusNotificationRows',
        'notificationRowId',
        'readCitiusSyncState',
        'syncCitiusNotifications',
        'syncStateKeyFor',
        'toEnumerateResult',
      ].sort(),
    );
  });

  it('NON-VACUITY of the source scan: the guard really can see an identifier when one is there', () => {
    // The same regexes, run against the SAME file's comments-included source, DO find the words —
    // so a green result above is the code being clean, not the scan being blind.
    expect(MODULE_SRC).toMatch(/documentoRef/);
    expect(MODULE_SRC).toMatch(/Documento/);
  });
});

// ---------------------------------------------------------------------------
// 2. BEHAVIOURAL — three full syncs, zero document hits, counter proven live
// ---------------------------------------------------------------------------

let mem: MongoMemoryServer;
let mock: Awaited<ReturnType<typeof startMockCitius>>;
const citiusNotifications = new Store<Doc>('citius_notifications');

const ACTOR = { userId: 'mandataria-9', orgId: 'firma-z', role: 'user' as const };

const liveTransport: CitiusTransport = async (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'manual' });

async function establishedSession(): Promise<EnsureSessionResult> {
  const loginRes = await fetch(`${mock.baseUrl}${mock.loginPath}`);
  const html = decodeHtml(Buffer.from(await loginRes.arrayBuffer()), loginRes.headers.get('content-type') ?? '');
  const hidden = parseHiddenFields(html);
  const res = await fetch(`${mock.baseUrl}${mock.loginPath}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      __VIEWSTATE: hidden.__VIEWSTATE!,
      __VIEWSTATEGENERATOR: hidden.__VIEWSTATEGENERATOR!,
      __EVENTVALIDATION: hidden.__EVENTVALIDATION!,
      'ctl00$cph$txtUserName': 'cedula-9999',
      'ctl00$cph$txtUserPass': ['segredo', 'de', 'teste'].join('-'),
    }).toString(),
  });
  const value = res.headers.getSetCookie().find((c) => c.startsWith('ASP.NET_SessionId'))!.split(';')[0]!.split('=')[1]!;
  return {
    status: 'reused',
    itemId: 'cofre-item-citius',
    storageState: { cookies: [{ name: 'ASP.NET_SessionId', value, domain: '127.0.0.1', path: '/', secure: false }] },
  };
}

async function runSync(until: string): Promise<Awaited<ReturnType<typeof syncCitiusNotifications>>> {
  const session = await establishedSession();
  const deps: CitiusSyncDeps = {
    establishSession: async () => session,
    markSessionUnhealthy: async () => true,
    enumerateDeps: { transport: liveTransport, sleep: async () => {} },
    clock: () => new Date('2026-06-01T12:00:00.000Z'),
  };
  return syncCitiusNotifications(
    { actor: ACTOR, runId: `run-${until}`, baseUrl: mock.baseUrl, inboxPath: mock.inboxPath, throttleMs: 0, until },
    deps,
  );
}

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_citius_metadata_only');
  mock = await startMockCitius({ pageSize: 2 });
}, 90_000);

afterAll(async () => {
  await mock.close();
  await closeMongo();
  await mem.stop();
});

describe('citius-sync · METADATA ONLY, behaviourally (zero document hits)', () => {
  it('a COMPLETE, an INCOMPLETE and a COMPLETE sync over rows WITH documents never open one', async () => {
    mock.scenario({ cmd: 'addItems', count: 5 }); // 2 seeded + 5 = 7 rows over 4 pages of 2

    // NON-VACUITY FIRST: prove the counter really moves, then reset it and run the real syncs.
    const probe = await fetch(`${mock.baseUrl}${mock.documentPath}?docId=abc123`);
    await probe.arrayBuffer();
    expect(mock.getDocumentHits()).toBe(1);
    mock.scenario({ cmd: 'reset' });
    expect(mock.getDocumentHits()).toBe(0);
    mock.scenario({ cmd: 'addItems', count: 5 });

    // run 1 — complete
    const first = await runSync('2026-06-01T00:00:01.000Z');
    expect(first.status).toBe('ran');
    if (first.status !== 'ran') return;
    expect(first.report.outcome).toBe('complete');
    expect(mock.getDocumentHits()).toBe(0);

    // run 2 — the withheld row makes it INCOMPLETE; the reconciliation pass is the extra traffic
    // most likely to reach for a document, so the counter is checked across it specifically
    mock.scenario({ cmd: 'addItems', count: 1 });
    mock.scenario({ cmd: 'hideUntilPass2' });
    const second = await runSync('2026-06-01T00:00:02.000Z');
    expect(second.status).toBe('ran');
    if (second.status !== 'ran') return;
    expect(second.report.outcome).toBe('incomplete');
    expect(mock.getDocumentHits()).toBe(0);

    // run 3 — complete again
    const third = await runSync('2026-06-01T00:00:03.000Z');
    expect(third.status).toBe('ran');
    if (third.status !== 'ran') return;
    expect(third.report.outcome).toBe('complete');
    expect(mock.getDocumentHits()).toBe(0);

    // …and documents WERE on offer the whole time: the landed metadata says so, and the inert
    // reference is sitting right there in Mongo, never dereferenced.
    const key = syncStateKeyFor({ actor: ACTOR });
    const landed = await citiusNotifications.find({ orgId: key.orgId, actionKey: key.actionKey });
    expect(landed.length).toBe(8);
    const withDocs = landed.filter((r) => (r.notificacao as { temDocumento?: boolean }).temDocumento);
    expect(withDocs.length).toBeGreaterThan(0);
    expect((withDocs[0]!.notificacao as { documentoRef?: string }).documentoRef).toMatch(/Documento\.aspx/);
    expect(mock.getDocumentHits()).toBe(0);
  }, 120_000);

  it('the landed row is METADATA: no document BYTES are ever stored', async () => {
    const key = syncStateKeyFor({ actor: ACTOR });
    const landed = await citiusNotifications.find({ orgId: key.orgId, actionKey: key.actionKey });
    expect(landed.length).toBeGreaterThan(0);
    for (const rowDoc of landed) {
      const serialized = JSON.stringify(rowDoc);
      expect(serialized).not.toContain('%PDF'); // the mock's document stub body
      expect(rowDoc.bytes).toBeUndefined();
      expect(rowDoc.content).toBeUndefined();
      // the row is scoped by the whole tuple — never a bare ref shared across tenants
      expect(rowDoc.orgId).toBe(key.orgId);
      expect(rowDoc.actionKey).toBe(key.actionKey);
    }
  }, 30_000);
});
