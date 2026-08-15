import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { users, orgs, slugs, artifacts, credentials } from '../../src/data/stores.js';
import { listPackages } from '../../src/content/index.js';
import { loadSource, buildPlan, runImport, NON_IMPORTS } from '../../scripts/migrate/import-tool.js';
import { storeChecksum, type PlainDoc } from '../../scripts/migrate/checksum.js';
import { decrypt } from '../../src/data/crypto.js';

/**
 * ch10 §10.2/§10.3 import tool. The synthetic source fixture + committed manifest are the
 * oracle: the dry-run's per-family counts + canonical checksums must match the manifest, and an
 * `--execute` into an ephemeral memory-mongo must round-trip (re-read counts + checksum MATCH),
 * satisfy the row-2a org-creation invariant, resolve slug collisions deterministically, pass the
 * decrypt-sample under the carried key, and never write the non-imported families.
 */
const FIXTURE_KEY = 'ekoa-fixture-key-please';
const SOURCE = join(__dirname, '..', '..', 'scripts', 'migrate', 'fixtures', 'source');
const MANIFEST = join(__dirname, '..', '..', 'scripts', 'migrate', 'fixtures', 'manifest.json');

interface ManifestFamily {
  family: string;
  targetCollection: string | null;
  kind: string;
  sourceCount: number;
  plannedCount: number;
  checksum: string;
  sampled: boolean;
}
interface Manifest {
  nonImports: string[];
  families: ManifestFamily[];
}

let mem: MongoMemoryServer;
let manifest: Manifest;
let tmpRoot: string;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = FIXTURE_KEY;
  process.env.JWT_SECRET = 's';
  tmpRoot = mkdtempSync(join(tmpdir(), 'ekoa-migrate-'));
  process.env.EKOA_DATA_DIR = join(tmpRoot, 'data');
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_migrate_test');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

async function wipeTarget(): Promise<void> {
  const db = getDb();
  const cols = await db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
}

beforeEach(async () => {
  await wipeTarget();
});

describe('dry-run vs the committed manifest (§10.3)', () => {
  it('every family plans the manifest counts + canonical checksums, and is read-only on source', async () => {
    const journalPath = join(tmpRoot, 'dryrun.log');
    const result = await runImport({ sourceDir: SOURCE, execute: false, journalPath });

    expect(result.mode).toBe('dry-run');
    expect(result.ok).toBe(true);
    expect(result.families.map((f) => f.family)).toEqual(manifest.families.map((f) => f.family));

    for (const mf of manifest.families) {
      const got = result.families.find((f) => f.family === mf.family)!;
      expect(got.sourceCount, `${mf.family} source count`).toBe(mf.sourceCount);
      expect(got.importedCount, `${mf.family} planned count`).toBe(mf.plannedCount);
      expect(got.checksumSource, `${mf.family} checksum`).toBe(mf.checksum);
      expect(got.sampled).toBe(mf.sampled);
      // dry-run writes nothing to compare a target against
      expect(got.checksumMatch).toBeNull();
    }

    // Read-only guarantee: a dry-run touches no collection.
    const db = getDb();
    for (const name of ['orgs', 'users', 'artifacts', 'slugs', 'token_events']) {
      expect(await db.collection(name).countDocuments()).toBe(0);
    }
  });

  it('resolves slug collisions deterministically (row 10)', () => {
    const plan = buildPlan(loadSource(SOURCE));
    const slugPlan = plan.find((p) => p.family === 'slugs')!;
    const reservations = Object.fromEntries(slugPlan.docs.map((d) => [d._id, d.artifactId]));
    expect(reservations).toEqual({ contract: 'art-1', 'contract-2': 'art-2', invoice: 'art-3' });
    expect(slugPlan.notes.some((n) => n.includes('art-2') && n.includes('contract-2'))).toBe(true);
  });

  it('decrypt-samples the ciphertext families under the carried key (rows 3 + 8)', () => {
    const plan = buildPlan(loadSource(SOURCE));
    const samples = plan.flatMap((p) => p.decryptSamples);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(samples.every((s) => s.ok)).toBe(true);
    // Row 3 samples the field the RUNTIME reads: `credentialsCiphertext` (plural - service.ts
    // IntegrationConfigDoc / platform-oauth.ts / zoho-sign.ts). The singular name belongs only
    // to the credentials singleton (row 8, CredentialsDoc.credentialCiphertext).
    const intcfg = plan.find((p) => p.family === 'integration_configs')!;
    expect(intcfg.decryptSamples.length).toBeGreaterThan(0);
    expect(intcfg.decryptSamples.every((s) => s.field === 'credentialsCiphertext')).toBe(true);
  });

  it('the carried platform + zoho-sign fixture rows decrypt and satisfy the runtime reader shapes', () => {
    const rows = JSON.parse(readFileSync(join(SOURCE, 'integration_configs.json'), 'utf8')) as PlainDoc[];

    // platform-oauth.ts getOrgRow (rowId + stored-field re-check): _id must be EXACTLY
    // `platform-<orgId>-<provider>` AND the row must carry that orgId + platformProvider.
    const m365 = rows.find((r) => r.platformProvider === 'microsoft')!;
    expect(m365._id).toBe(`platform-${String(m365.orgId)}-microsoft`);
    expect(m365.integrationKey).toBe('platform-microsoft');
    expect(m365.enabled).toBe(true);
    const m365Bundle = JSON.parse(decrypt(String(m365.credentialsCiphertext))) as Record<string, unknown>;
    expect(m365Bundle.refresh_token).toBe('test-m365-refresh-token-not-real');
    expect(m365Bundle.provider).toBe('microsoft');

    // service.ts findConfigForOwner queries { orgId, integrationKey } - the zoho row must be
    // org-scoped under the exact key, and its bundle must keep `dc`.
    const zoho = rows.find((r) => r.integrationKey === 'zoho-sign')!;
    expect(typeof zoho.orgId).toBe('string');
    expect(zoho.enabled).toBe(true);
    const zohoBundle = JSON.parse(decrypt(String(zoho.credentialsCiphertext))) as Record<string, unknown>;
    expect(zohoBundle.refresh_token).toBe('test-zoho-refresh-token-not-real');
    expect(zohoBundle.dc).toBe('eu');
  });
});

describe('--execute round-trip into memory-mongo (§10.3 rule 4)', () => {
  it('re-reads match source counts and every checksum MATCHes', async () => {
    const journalPath = join(tmpRoot, 'execute.log');
    const result = await runImport({
      sourceDir: SOURCE,
      execute: true,
      journalPath,
      contentDataDir: process.env.EKOA_DATA_DIR!,
    });

    expect(result.mode).toBe('execute');
    expect(result.ok).toBe(true);
    for (const mf of manifest.families) {
      const got = result.families.find((f) => f.family === mf.family)!;
      expect(got.importedCount, `${mf.family} imported count`).toBe(mf.plannedCount);
      expect(got.checksumMatch, `${mf.family} checksum match`).toBe(true);
      expect(got.checksumTarget).toBe(mf.checksum);
    }
  });

  it('is idempotent: a second execute upserts identical docs (counts unchanged)', async () => {
    const journalPath = join(tmpRoot, 'idem.log');
    const opts = { sourceDir: SOURCE, execute: true, journalPath, contentDataDir: process.env.EKOA_DATA_DIR! };
    await runImport(opts);
    const second = await runImport(opts);
    expect(second.ok).toBe(true);
    for (const mf of manifest.families) {
      const got = second.families.find((f) => f.family === mf.family)!;
      expect(got.importedCount, `${mf.family} still ${mf.plannedCount}`).toBe(mf.plannedCount);
      expect(got.checksumMatch).toBe(true);
    }
    // No duplicate rows: users still 3, not 6.
    expect(await users.find({})).toHaveLength(3);
  });

  it('org-creation invariant (row 2a): N orgs for N users, every user has orgId, founder super-admin', async () => {
    await runImport({ sourceDir: SOURCE, execute: true, journalPath: join(tmpRoot, 'org.log'), contentDataDir: process.env.EKOA_DATA_DIR! });
    const allUsers = await users.find({});
    const allOrgs = await orgs.find({});
    expect(allUsers).toHaveLength(3);
    expect(allOrgs).toHaveLength(3);
    expect(allUsers.every((u) => typeof u.orgId === 'string' && u.orgId.length > 0)).toBe(true);

    const admins = allUsers.filter((u) => u.role === 'super-admin');
    expect(admins).toHaveLength(1);
    expect(admins[0]!._id).toBe('u-founder');

    // Every org on the default design system, no brand carry.
    for (const o of allOrgs) {
      expect((o.settings as { designSystem?: string } | undefined)?.designSystem).toBe('default');
      expect(o.branding).toBeUndefined();
    }
  });

  it('seeds one slug reservation per artifact (row 10)', async () => {
    await runImport({ sourceDir: SOURCE, execute: true, journalPath: join(tmpRoot, 'slug.log'), contentDataDir: process.env.EKOA_DATA_DIR! });
    const arts = await artifacts.find({});
    const slugRows = await slugs.find({});
    expect(slugRows).toHaveLength(arts.length);
    const byArtifact = new Set(slugRows.map((s) => s.artifactId));
    expect(byArtifact).toEqual(new Set(arts.map((a) => a._id)));
  });

  it('row 11 prose split imports each integration package through the content loader', async () => {
    await runImport({ sourceDir: SOURCE, execute: true, journalPath: join(tmpRoot, 'prose.log'), contentDataDir: process.env.EKOA_DATA_DIR! });
    const names = new Set((await listPackages()).map((p) => p.name));
    expect(names.has('integration-github')).toBe(true);
    expect(names.has('integration-acme')).toBe(true);
  });

  it('the credentials singleton lands under _id=default and decrypt-samples clean (row 8)', async () => {
    const result = await runImport({ sourceDir: SOURCE, execute: true, journalPath: join(tmpRoot, 'cred.log'), contentDataDir: process.env.EKOA_DATA_DIR! });
    const cred = await credentials.get('default');
    expect(cred).not.toBeNull();
    const credFamily = result.families.find((f) => f.family === 'credentials')!;
    expect(credFamily.decryptSamples.every((s) => s.ok)).toBe(true);
  });

  it('never writes the non-imported families (§10.8): teams + company', async () => {
    await runImport({ sourceDir: SOURCE, execute: true, journalPath: join(tmpRoot, 'nonimp.log'), contentDataDir: process.env.EKOA_DATA_DIR! });
    const db = getDb();
    expect(await db.collection('teams').countDocuments()).toBe(0);
    expect(await db.collection('company').countDocuments()).toBe(0);
    expect(NON_IMPORTS.map((n) => n.file)).toEqual(['teams.json', 'company.json']);
  });
});

describe('journaling (§10.3 rule 5)', () => {
  it('appends a block with per-store lines, the slug resolution, decrypt-samples, and the result', async () => {
    const journalPath = join(tmpRoot, 'journal.log');
    await runImport({ sourceDir: SOURCE, execute: true, journalPath, contentDataDir: process.env.EKOA_DATA_DIR! });
    const log = readFileSync(journalPath, 'utf8');
    expect(log).toContain('ekoa migration run');
    expect(log).toContain('[orgs] -> orgs');
    expect(log).toContain('reserved "contract-2"');
    // Row 3 (integration_configs) samples the runtime's plural field; row 8 (the credentials
    // singleton) keeps the singular CredentialsDoc field. Both must appear.
    expect(log).toContain('decrypt-sample credentialsCiphertext');
    expect(log).toContain('decrypt-sample credentialCiphertext default');
    expect(log).toContain('result: OK');
  });

  it('is append-only: a second run adds a second block', async () => {
    const journalPath = join(tmpRoot, 'append.log');
    await runImport({ sourceDir: SOURCE, execute: false, journalPath });
    await runImport({ sourceDir: SOURCE, execute: false, journalPath });
    const blocks = readFileSync(journalPath, 'utf8').match(/ekoa migration run/g) ?? [];
    expect(blocks).toHaveLength(2);
  });
});

describe('the zero-tolerance checks bite', () => {
  it('a corrupted ciphertext makes the decrypt-sample fail and the run report anomalies', async () => {
    const badRoot = join(tmpRoot, 'corrupt-source');
    cpSync(SOURCE, badRoot, { recursive: true });
    const cfgPath = join(badRoot, 'integration_configs.json');
    const cfgs = JSON.parse(readFileSync(cfgPath, 'utf8')) as PlainDoc[];
    cfgs[0]!.credentialsCiphertext = 'not.valid.ciphertext';
    writeFileSync(cfgPath, JSON.stringify(cfgs));

    const result = await runImport({ sourceDir: badRoot, execute: false, journalPath: join(tmpRoot, 'corrupt.log') });
    expect(result.ok).toBe(false);
    const intcfg = result.families.find((f) => f.family === 'integration_configs')!;
    expect(intcfg.decryptSamples.some((s) => !s.ok)).toBe(true);
  });

  it('an OLD-scheme (colon-joined ekoa-dev) ciphertext fails the decrypt-sample loudly - the run reports anomalies, never a clean import', async () => {
    const badRoot = join(tmpRoot, 'oldscheme-source');
    cpSync(SOURCE, badRoot, { recursive: true });
    const cfgPath = join(badRoot, 'integration_configs.json');
    const cfgs = JSON.parse(readFileSync(cfgPath, 'utf8')) as PlainDoc[];
    // Shape of cortex tools/crypto.ts output: base64(iv):base64(tag):base64(ct). Undecryptable
    // by the new stack's dot-splitting v1 decrypt regardless of key value.
    cfgs[0]!.credentialsCiphertext = 'FhGm2QU3mNo5Vm2aaaaaaa==:15R7caUb6/WsVQfJK1GdbQ==:trnGp06muLlukqMpXgq+';
    writeFileSync(cfgPath, JSON.stringify(cfgs));

    const result = await runImport({ sourceDir: badRoot, execute: false, journalPath: join(tmpRoot, 'oldscheme.log') });
    expect(result.ok).toBe(false);
    const intcfg = result.families.find((f) => f.family === 'integration_configs')!;
    expect(intcfg.decryptSamples.some((s) => !s.ok && s.id === 'cfg-1')).toBe(true);
  });

  it('the 1% sampling path is deterministic for a large store (§10.3 rule 4)', () => {
    const docs: PlainDoc[] = Array.from({ length: 25_000 }, (_, i) => ({ _id: `d-${String(i).padStart(6, '0')}`, v: i }));
    const a = storeChecksum(docs, []);
    const b = storeChecksum([...docs].reverse(), []);
    expect(a.sampled).toBe(true);
    expect(a.hashedCount).toBe(250); // every 100th of 25k
    expect(a.checksum).toBe(b.checksum); // order-independent
  });
});

describe('hostile-source hardening (G12 security phase)', () => {
  let n = 0;
  const journalOutside = (): string => join(tmpRoot, `hostile-${n++}.log`);

  /** Copy the clean fixture and mutate one file - the hostile export under test. */
  function hostileCopy(name: string, mutate: (dir: string) => void): string {
    const dir = join(tmpRoot, `hostile-src-${name}`);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    cpSync(SOURCE, dir, { recursive: true });
    mutate(dir);
    return dir;
  }

  it('rejects a journal path inside the source export (read-only-on-source, §10.3 rule 1)', async () => {
    const journalInSource = join(SOURCE, 'RUN_LOG.migration.txt');
    await expect(
      runImport({ sourceDir: SOURCE, execute: false, journalPath: journalInSource }),
    ).rejects.toThrow(/read-only on the source/);
    expect(existsSync(journalInSource)).toBe(false); // nothing was written into the source
  });

  it('rejects a content data dir inside (or equal to) the source export on execute', async () => {
    await expect(
      runImport({ sourceDir: SOURCE, execute: true, journalPath: journalOutside(), contentDataDir: join(SOURCE, 'out') }),
    ).rejects.toThrow(/read-only on the source/);
    await expect(
      runImport({ sourceDir: SOURCE, execute: true, journalPath: journalOutside(), contentDataDir: SOURCE }),
    ).rejects.toThrow(/read-only on the source/);
  });

  it('rejects a row whose _id is not a plain string (an object _id would become a Mongo operator filter)', async () => {
    const dir = hostileCopy('objid', (d) => {
      const p = join(d, 'settings.json');
      const rows = JSON.parse(readFileSync(p, 'utf8')) as PlainDoc[];
      rows.push({ _id: { $gt: '' } as unknown as string, theme: 'evil' });
      writeFileSync(p, JSON.stringify(rows));
    });
    await expect(
      runImport({ sourceDir: dir, execute: false, journalPath: journalOutside() }),
    ).rejects.toThrow(/_id is not a plain non-empty string/);
  });

  it("rejects a row carrying a top-level '$'-prefixed key (operator smuggling)", async () => {
    const dir = hostileCopy('dollarkey', (d) => {
      const p = join(d, 'settings.json');
      const rows = JSON.parse(readFileSync(p, 'utf8')) as PlainDoc[];
      rows.push({ _id: 'evil-1', $set: { role: 'super-admin' } } as unknown as PlainDoc);
      writeFileSync(p, JSON.stringify(rows));
    });
    await expect(
      runImport({ sourceDir: dir, execute: false, journalPath: journalOutside() }),
    ).rejects.toThrow(/'\$'-prefixed key/);
  });

  it('rejects a cross-family _id collision instead of silently overwriting (intdef forgery)', async () => {
    const dir = hostileCopy('collision', (d) => {
      const p = join(d, 'integration_configs.json');
      const rows = JSON.parse(readFileSync(p, 'utf8')) as PlainDoc[];
      rows.push({ _id: 'intdef:github', provider: 'forged' });
      writeFileSync(p, JSON.stringify(rows));
    });
    await expect(
      runImport({ sourceDir: dir, execute: false, journalPath: journalOutside() }),
    ).rejects.toThrow(/plan collision/);
  });

  it("refuses a dev-shaped source LOUDLY: a hyphenated old-stack file (integration-configs.json) must never import as zero rows", async () => {
    const dir = hostileCopy('devshape', (d) => {
      // The raw ekoa-dev data dir carries hyphenated JsonStore files with rows keyed 'id' and
      // old colon-joined ciphertext. The underscore reader would silently see nothing.
      writeFileSync(
        join(d, 'integration-configs.json'),
        JSON.stringify([{ id: 'old-uuid-1', type: 'platform-microsoft', platformProvider: 'microsoft', credentials: 'aXY=:dGFn:Y3Q=' }]),
      );
    });
    await expect(
      runImport({ sourceDir: dir, execute: false, journalPath: journalOutside() }),
    ).rejects.toThrow(/dev-shaped source.*convert-dev-state\.mjs/s);
  });

  it("refuses a dev-shaped zoho-agreements.json (the webhook reverse index) the same way", async () => {
    const dir = hostileCopy('devshape-zoho', (d) => {
      writeFileSync(
        join(d, 'zoho-agreements.json'),
        JSON.stringify([{ id: 'zoho-req-old', appId: 'prod-app-1', propostaId: 'p1', ownerUserId: 'u1', clientEmail: 'c@example.test', createdAt: '2026-07-01T00:00:00.000Z' }]),
      );
    });
    await expect(
      runImport({ sourceDir: dir, execute: false, journalPath: journalOutside() }),
    ).rejects.toThrow(/dev-shaped source/);
  });

  it("rejects rows keyed 'id' instead of '_id' in an underscore-named file (dev-shaped rows, not silently zero)", async () => {
    const dir = hostileCopy('idkey', (d) => {
      const p = join(d, 'integration_configs.json');
      writeFileSync(
        p,
        JSON.stringify([{ id: 'old-uuid-2', type: 'zoho-sign', credentials: 'aXY=:dGFn:Y3Q=' }]),
      );
    });
    await expect(
      runImport({ sourceDir: dir, execute: false, journalPath: journalOutside() }),
    ).rejects.toThrow(/_id is not a plain non-empty string/);
  });

  it('rejects an artifact _id that is not a safe path segment (screenshotPath rewrite containment)', async () => {
    const dir = hostileCopy('traversal', (d) => {
      const p = join(d, 'artifacts.json');
      const rows = JSON.parse(readFileSync(p, 'utf8')) as PlainDoc[];
      rows.push({ _id: '../../etc', title: 'evil', screenshotPath: '/tmp/x/shot.png' });
      writeFileSync(p, JSON.stringify(rows));
    });
    await expect(
      runImport({ sourceDir: dir, execute: false, journalPath: journalOutside() }),
    ).rejects.toThrow(/not a safe path segment/);
  });
});
