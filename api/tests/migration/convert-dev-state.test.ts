import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import {
  convertDevState,
  convertIntegrationConfigs,
  convertZohoAgreements,
  decryptOldCredential,
  encryptNewCredential,
  ADOBE_REFUSAL,
  type OldRow,
} from '../../scripts/migrate/convert-dev-state.mjs';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, zohoAgreements } from '../../src/data/stores.js';
import { decrypt } from '../../src/data/crypto.js';
import {
  getValidPlatformTokens,
  PlatformNotConnectedError,
  type OAuthDeps,
  type OAuthTokens,
} from '../../src/integrations/platform-oauth.js';
import { findConfigForOwner } from '../../src/integrations/service.js';
import { findZohoAgreement } from '../../src/integrations/sign-agreements.js';
import type { Doc } from '../../src/data/store.js';

/**
 * S4 carry-over converter (api/scripts/migrate/convert-dev-state.mjs). Proves the old stack's
 * (ekoa-dev / cortex) credential rows and Zoho webhook reverse index convert into rows the NEW
 * stack's REAL readers accept - the whole point being that the customer never re-authenticates
 * M365 or Zoho:
 *
 *   - the OLD encryption scheme (AES-256-GCM, colon-joined iv:tag:ct, utf8-pad-32 key; cortex
 *     tools/crypto.ts) is implemented HERE IN THE TEST over synthetic values only, so the
 *     converter's decrypt half is exercised against real old-scheme bytes;
 *   - the emitted ciphertext decrypts with the REAL api/src/data/crypto.ts `decrypt` (v1 wire);
 *   - the emitted rows round-trip through the REAL runtime readers over mongodb-memory-server:
 *     platform-oauth.ts getValidPlatformTokens (which re-checks _id = 'platform-<orgId>-
 *     <provider>' AND stored orgId AND platformProvider, platform-oauth.ts getOrgRow) and
 *     service.ts findConfigForOwner ({ orgId, integrationKey } query), plus
 *     sign-agreements.ts findZohoAgreement for the reverse index.
 *
 * Synthetic secrets only ("-not-real" style); neither key nor any plaintext may appear in
 * errors or CLI output (redaction assertions below).
 */

const OLD_KEY = 'old-stack-test-key-not-real';
const NEW_KEY = 'new-stack-test-key-not-real';
const ORG = 'org-u-admin';

/** The OLD scheme's encrypt, test-side only (mirrors cortex tools/crypto.ts encryptCredential:
 *  utf8 key truncated/zero-padded to 32 bytes, 16-byte IV, colon-joined base64). */
function oldEncrypt(plaintext: string, rawKey: string): string {
  const buf = Buffer.from(rawKey, 'utf8');
  const key = buf.length >= 32 ? buf.subarray(0, 32) : Buffer.concat([buf, Buffer.alloc(32 - buf.length)]);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted].join(':');
}

/** Synthetic old-stack M365 token bundle (shape of cortex platform-oauth.ts OAuthTokens,
 *  including the `tid` nit the new stack drops at first refresh). */
const M365_BUNDLE = {
  access_token: 'test-old-m365-access-token-not-real',
  refresh_token: 'test-old-m365-refresh-token-not-real',
  token_type: 'Bearer',
  expires_at: '2027-01-01T00:00:00.000Z',
  scope: 'offline_access Mail.Read Mail.Send',
  email: 'advogado@example.test',
  tid: '11111111-1111-1111-1111-111111111111',
  provider: 'microsoft',
};

/** Synthetic old-stack Zoho OAuth bundle (cortex ZohoOAuthBundle: client pair omitted on
 *  purpose - the env client backs refreshes; `dc` must survive the carry). */
const ZOHO_BUNDLE = { refresh_token: 'test-old-zoho-refresh-token-not-real', dc: 'eu', auth_type: 'oauth2' };

function oldM365Row(overrides: Record<string, unknown> = {}): OldRow {
  return {
    id: 'old-uuid-m365-1',
    name: 'Microsoft 365',
    type: 'platform-microsoft',
    platformProvider: 'microsoft',
    config: {},
    credentials: oldEncrypt(JSON.stringify(M365_BUNDLE), OLD_KEY),
    enabled: true,
    needsReauth: true, // stale dead-token flag: the carry must clear it
    oauthState: 'stale-csrf-state', // stale pending-connect state: never carried
    createdAt: '2025-11-05T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function oldZohoRow(overrides: Record<string, unknown> = {}): OldRow {
  return {
    id: 'old-uuid-zoho-1',
    name: 'Zoho Sign',
    type: 'zoho-sign',
    config: { authType: 'oauth2' },
    credentials: oldEncrypt(JSON.stringify(ZOHO_BUNDLE), OLD_KEY),
    enabled: false, // old rows start disabled until the callback lands; the carry enables
    createdAt: '2026-02-02T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

const OPTS = { orgId: ORG, oldKey: OLD_KEY, newKey: NEW_KEY };

beforeAll(() => {
  // The real api/src/data/crypto.ts derives its key from the mandatory ENCRYPTION_KEY
  // (memoized loadConfig) - set it BEFORE the first decrypt call in this file.
  process.env.ENCRYPTION_KEY = NEW_KEY;
  process.env.JWT_SECRET = 's';
});

describe('crypto scheme bridging', () => {
  it('decryptOldCredential reads real old-scheme (colon-joined, utf8-pad-32) ciphertext', () => {
    const ct = oldEncrypt('segredo-sintetico-not-real', OLD_KEY);
    expect(ct.split(':')).toHaveLength(3);
    expect(decryptOldCredential(ct, OLD_KEY)).toBe('segredo-sintetico-not-real');
  });

  it('encryptNewCredential emits v1 wire the REAL api/src/data/crypto.ts decrypt reads', () => {
    const ct = encryptNewCredential('valor-sintetico-not-real', NEW_KEY);
    expect(ct.split('.')).toHaveLength(3);
    expect(decrypt(ct)).toBe('valor-sintetico-not-real');
  });

  it('a wrong old key fails with a redacted error: no key material, no plaintext', () => {
    const ct = oldEncrypt(JSON.stringify(M365_BUNDLE), OLD_KEY);
    let message = '';
    try {
      decryptOldCredential(ct, 'wrong-key-value-abc');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('EKOA_OLD_ENCRYPTION_KEY'); // names the env VAR for the operator
    expect(message).not.toContain('wrong-key-value-abc'); // never the VALUE
    expect(message).not.toContain(OLD_KEY);
    expect(message).not.toContain('not-real'); // no plaintext fragment
  });
});

describe('platform (M365) row conversion', () => {
  it('re-keys the global singleton to the exact org row getValidPlatformTokens requires', () => {
    const { rows } = convertIntegrationConfigs([oldM365Row()], OPTS);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // platform-oauth.ts rowId()/getOrgRow(): _id EXACTLY 'platform-<orgId>-<provider>' plus the
    // stored orgId + platformProvider re-check - any other shape is invisible to the reader.
    expect(row._id).toBe(`platform-${ORG}-microsoft`);
    expect(row.orgId).toBe(ORG);
    expect(row.platformProvider).toBe('microsoft');
    expect(row.integrationKey).toBe('platform-microsoft');
    // Carried credential = live credential: enabled on, stale flags gone.
    expect(row.enabled).toBe(true);
    expect(row.needsReauth).toBe(false);
    expect(row.oauthState).toBeUndefined();
    expect(row.email).toBe('advogado@example.test');
    // The bundle survives byte-for-byte through old-decrypt -> new-encrypt (tid included).
    expect(JSON.parse(decrypt(String(row.credentialsCiphertext)))).toEqual(M365_BUNDLE);
  });

  it('refuses a second row for the same provider (would collide on the new _id)', () => {
    expect(() =>
      convertIntegrationConfigs([oldM365Row(), oldM365Row({ id: 'old-uuid-m365-2' })], OPTS),
    ).toThrow(/second 'microsoft' platform row/);
  });

  it('skips a never-connected platform row (no credentials) with a note, not an output row', () => {
    const { rows, notes } = convertIntegrationConfigs([oldM365Row({ credentials: undefined })], OPTS);
    expect(rows).toHaveLength(0);
    expect(notes.some((n) => n.includes('old-uuid-m365-1') && n.includes('no credential bundle'))).toBe(true);
  });
});

describe('zoho-sign row conversion', () => {
  it('produces the org-scoped row findConfigForOwner queries, dc preserved, enabled on', () => {
    const { rows } = convertIntegrationConfigs([oldZohoRow()], OPTS);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // service.ts findConfigForOwner: find({ orgId, integrationKey }) then ownerUserId pick.
    expect(row._id).toBe('old-uuid-zoho-1'); // canonical id preserved (S3 convention)
    expect(row.orgId).toBe(ORG);
    expect(row.integrationKey).toBe('zoho-sign');
    expect(row.ownerUserId).toBeUndefined(); // old global row -> org-shared
    expect(row.enabled).toBe(true);
    expect(row.needsReauth).toBe(false);
    const fields = JSON.parse(decrypt(String(row.credentialsCiphertext))) as Record<string, unknown>;
    expect(fields.dc).toBe('eu'); // the bundle must keep its dc
    expect(fields.refresh_token).toBe(ZOHO_BUNDLE.refresh_token);
    expect(fields.authType).toBe('oauth2'); // plaintext config values fold into the one bundle
  });

  it('keeps an owner-scoped row owner-scoped (ownerUserId carried)', () => {
    const { rows } = convertIntegrationConfigs([oldZohoRow({ ownerUserId: 'u-admin' })], OPTS);
    expect(rows[0]!.ownerUserId).toBe('u-admin');
  });

  it('notes a bundle without dc (new stack falls back to ZOHO_DC; old name ZOHO_OAUTH_DC)', () => {
    const noDc = oldZohoRow({
      credentials: oldEncrypt(JSON.stringify({ refresh_token: 'test-r-not-real', auth_type: 'oauth2' }), OLD_KEY),
    });
    const { notes } = convertIntegrationConfigs([noDc], OPTS);
    expect(notes.some((n) => n.includes('ZOHO_DC') && n.includes('ZOHO_OAUTH_DC'))).toBe(true);
  });
});

describe('adobe refusal + non-carries', () => {
  it('refuses adobe-sign credential rows with the V13 note (never converted, never silent)', () => {
    const adobe = oldZohoRow({ id: 'old-uuid-adobe-1', name: 'Adobe Sign', type: 'adobe-sign' });
    const { rows, notes } = convertIntegrationConfigs([adobe], OPTS);
    expect(rows).toHaveLength(0);
    expect(notes.some((n) => n.includes('old-uuid-adobe-1') && n.includes(ADOBE_REFUSAL))).toBe(true);
  });

  it('refuses adobe-agreements rows with the V13 note in convertDevState', () => {
    const result = convertDevState(
      { adobeAgreements: [{ id: 'adobe-agr-1', appId: 'a', propostaId: 'p', ownerUserId: 'u', clientEmail: 'c@example.test' }] },
      OPTS,
    );
    expect(result.integrationConfigs).toHaveLength(0);
    expect(result.zohoAgreements).toHaveLength(0);
    expect(result.notes.some((n) => n.includes('1 adobe-agreements row(s) REFUSED') && n.includes(ADOBE_REFUSAL))).toBe(true);
  });

  it('never carries a captured browser session (no home on the new stack)', () => {
    const browserRow = oldZohoRow({
      id: 'old-uuid-browser-1',
      type: 'citius',
      credentials: undefined,
      sessionState: oldEncrypt('{"cookies":[]}', OLD_KEY),
    });
    const { rows, notes } = convertIntegrationConfigs([browserRow], OPTS);
    expect(rows).toHaveLength(0);
    expect(notes.some((n) => n.includes('old-uuid-browser-1') && n.includes('browser session'))).toBe(true);
  });

  it("refuses rows already keyed '_id' (double conversion) loudly", () => {
    expect(() =>
      convertIntegrationConfigs([{ _id: 'platform-org-x-microsoft', orgId: 'org-x' } as unknown as OldRow], OPTS),
    ).toThrow(/already new-shaped/);
  });
});

describe('zoho_agreements reverse index conversion', () => {
  const OLD_AGREEMENT: OldRow = {
    id: 'zoho-request-77',
    appId: 'prod-app-08dd',
    propostaId: 'prop-9',
    ownerUserId: 'u-admin',
    clientEmail: 'cliente@example.test',
    createdAt: '2026-08-01T12:00:00.000Z',
  };

  it("renames the key ('id' -> '_id') and keeps the prod appId verbatim by default", () => {
    const { rows, notes } = convertZohoAgreements([OLD_AGREEMENT]);
    expect(rows).toEqual([
      {
        _id: 'zoho-request-77',
        appId: 'prod-app-08dd',
        propostaId: 'prop-9',
        ownerUserId: 'u-admin',
        clientEmail: 'cliente@example.test',
        createdAt: '2026-08-01T12:00:00.000Z',
      },
    ]);
    expect(notes).toHaveLength(0);
  });

  it('applies an explicit --rewrite-app-id mapping and notes each rewrite', () => {
    const { rows, notes } = convertZohoAgreements([OLD_AGREEMENT], {
      rewriteAppIds: { 'prod-app-08dd': 'new-app-42' },
    });
    expect(rows[0]!.appId).toBe('new-app-42');
    expect(notes.some((n) => n.includes('prod-app-08dd -> new-app-42'))).toBe(true);
  });
});

describe('round-trip through the REAL runtime readers (memory-mongo)', () => {
  let mem: MongoMemoryServer;

  beforeAll(async () => {
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_convert_dev_state_test');
    const converted = convertDevState(
      {
        integrationConfigs: [oldM365Row(), oldZohoRow({ ownerUserId: 'u-admin' })],
        zohoAgreements: [
          { id: 'zoho-request-77', appId: 'prod-app-08dd', propostaId: 'prop-9', ownerUserId: 'u-admin', clientEmail: 'cliente@example.test', createdAt: '2026-08-01T12:00:00.000Z' },
        ],
      },
      OPTS,
    );
    for (const row of converted.integrationConfigs) await integrationConfigs.put(row as unknown as Doc);
    for (const row of converted.zohoAgreements) await zohoAgreements.put(row as unknown as Doc);
  }, 60_000);

  afterAll(async () => {
    await closeMongo();
    await mem.stop();
  });

  /** Deps for a non-expired token read: any network call = test failure (no refresh needed). */
  const deps: OAuthDeps = {
    now: () => Date.parse('2026-08-14T00:00:00.000Z'), // well before the bundle's 2027 expiry
    genId: () => 'test-id',
    http: () => {
      throw new Error('no network call expected for a non-expired carried token');
    },
    env: {
      google: { clientId: '', clientSecret: '', redirectBaseUrl: '' },
      microsoft: { clientId: 'test-client-id-not-real', clientSecret: 'test-client-secret-not-real', redirectBaseUrl: 'http://localhost' },
    },
  };

  it('getValidPlatformTokens returns the carried M365 tokens without any re-auth or refresh', async () => {
    const tokens: OAuthTokens = await getValidPlatformTokens(ORG, 'microsoft', deps);
    expect(tokens.access_token).toBe(M365_BUNDLE.access_token);
    expect(tokens.refresh_token).toBe(M365_BUNDLE.refresh_token);
    expect(tokens.email).toBe(M365_BUNDLE.email);
  });

  it('the carried row stays org-confined: another org sees not-connected', async () => {
    await expect(getValidPlatformTokens('org-u-outro', 'microsoft', deps)).rejects.toThrow(PlatformNotConnectedError);
  });

  it('findConfigForOwner resolves the carried zoho-sign row for its owner', async () => {
    const cfg = await findConfigForOwner(ORG, 'u-admin', 'zoho-sign');
    expect(cfg).not.toBeNull();
    expect(cfg!._id).toBe('old-uuid-zoho-1');
    expect(cfg!.enabled).toBe(true);
    expect(cfg!.needsReauth).toBe(false);
    const fields = JSON.parse(decrypt(cfg!.credentialsCiphertext!)) as Record<string, unknown>;
    expect(fields.dc).toBe('eu');
    expect(fields.refresh_token).toBe(ZOHO_BUNDLE.refresh_token);
  });

  it('an owner-scoped zoho row is NOT visible to a different owner (no org-shared fallback row)', async () => {
    expect(await findConfigForOwner(ORG, 'u-outro', 'zoho-sign')).toBeNull();
  });

  it('findZohoAgreement routes the carried webhook reverse-index row by requestId', async () => {
    const ref = await findZohoAgreement('zoho-request-77');
    expect(ref).not.toBeNull();
    expect(ref!.appId).toBe('prod-app-08dd');
    expect(ref!.propostaId).toBe('prop-9');
    expect(ref!.ownerUserId).toBe('u-admin');
  });
});

describe('CLI (file in, file out; read-only on source; redacted output)', () => {
  const TOOL = join(__dirname, '..', '..', 'scripts', 'migrate', 'convert-dev-state.mjs');
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'convert-dev-state-'));
  });
  afterAll(() => {
    if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  function writeOldDataDir(name: string): string {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'integration-configs.json'), JSON.stringify([oldM365Row(), oldZohoRow()]));
    writeFileSync(
      join(dir, 'zoho-agreements.json'),
      JSON.stringify([{ id: 'zoho-request-1', appId: 'prod-app-1', propostaId: 'p1', ownerUserId: 'u-admin', clientEmail: 'c@example.test', createdAt: '2026-08-01T00:00:00.000Z' }]),
    );
    writeFileSync(join(dir, 'adobe-agreements.json'), JSON.stringify([{ id: 'adobe-agr-1', appId: 'prod-app-1' }]));
    return dir;
  }

  function runTool(args: string[], envOverrides: Record<string, string> = {}) {
    return spawnSync('node', [TOOL, ...args], {
      env: { ...process.env, EKOA_OLD_ENCRYPTION_KEY: OLD_KEY, ENCRYPTION_KEY: NEW_KEY, ...envOverrides },
      encoding: 'utf8',
    });
  }

  it('writes underscore-named _id-keyed files the import-tool reads', () => {
    const src = writeOldDataDir('cli-src');
    const out = join(tmp, 'cli-out');
    const res = runTool([src, '--user', 'u-admin', '--out', out]);
    expect(res.status, res.stderr).toBe(0);

    const configs = JSON.parse(readFileSync(join(out, 'integration_configs.json'), 'utf8')) as Array<Record<string, unknown>>;
    expect(configs.map((r) => r._id)).toEqual(['platform-org-u-admin-microsoft', 'old-uuid-zoho-1']);
    expect(configs.every((r) => typeof r.credentialsCiphertext === 'string')).toBe(true);
    const agreements = JSON.parse(readFileSync(join(out, 'zoho_agreements.json'), 'utf8')) as Array<Record<string, unknown>>;
    expect(agreements[0]!._id).toBe('zoho-request-1');
    // The emitted ciphertext is new-scheme v1 and decrypts under the NEW key.
    expect(JSON.parse(decrypt(String(configs[0]!.credentialsCiphertext)))).toEqual(M365_BUNDLE);
    // Read-only on source: nothing new appeared in the old data dir.
    expect(existsSync(join(src, 'integration_configs.json'))).toBe(false);
    expect(existsSync(join(src, 'zoho_agreements.json'))).toBe(false);
  });

  it('reports the Adobe refusal + the env-name drift on stderr, and never echoes a key or secret', () => {
    const src = writeOldDataDir('cli-src-2');
    const out = join(tmp, 'cli-out-2');
    const res = runTool([src, '--user', 'u-admin', '--out', out]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toContain('REFUSED');
    expect(res.stderr).toContain('V13');
    expect(res.stderr).toContain('OAUTH_REDIRECT_BASE_URL (was EKOA_OAUTH_REDIRECT_BASE_URL)');
    expect(res.stderr).toContain('ZOHO_DC (was ZOHO_OAUTH_DC)');
    const combined = res.stdout + res.stderr;
    expect(combined).not.toContain(OLD_KEY);
    expect(combined).not.toContain(NEW_KEY);
    expect(combined).not.toContain('not-real'); // no decrypted fragment ever printed
  });

  it('refuses --out inside the old data dir (read-only on source)', () => {
    const src = writeOldDataDir('cli-src-3');
    const res = runTool([src, '--user', 'u-admin', '--out', join(src, 'out')]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('read-only');
    expect(existsSync(join(src, 'out'))).toBe(false);
  });

  it('fails with a clean, redacted error when EKOA_OLD_ENCRYPTION_KEY is wrong', () => {
    const src = writeOldDataDir('cli-src-4');
    const out = join(tmp, 'cli-out-4');
    const res = runTool([src, '--user', 'u-admin', '--out', out], { EKOA_OLD_ENCRYPTION_KEY: 'another-wrong-key-value' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('EKOA_OLD_ENCRYPTION_KEY'); // the env NAME, for the operator
    expect(res.stderr).not.toContain('another-wrong-key-value'); // never a key VALUE
    expect(res.stderr).not.toContain(OLD_KEY);
    expect(res.stderr).not.toContain('not-real'); // never plaintext
  });
});
