#!/usr/bin/env node
/**
 * convert-dev-state (ch10 migrate tooling, salomao carry-over S4) - build-tooling, not
 * product code. Sibling of convert-dev-bundle.mjs: read-only on its inputs, no DB, no
 * network, no product imports.
 *
 * Converts the old stack's (ekoa-dev / cortex) INTEGRATION STATE - the credential rows in
 * integration-configs.json and the Zoho webhook reverse index in zoho-agreements.json -
 * into import-tool-ready files, so the customer never re-authenticates M365 or Zoho.
 * The two stacks cannot exchange ciphertext even under the same key value:
 *
 *   OLD scheme (cortex tools/crypto.ts):   AES-256-GCM, colon-joined iv:tag:ct (base64),
 *                                          key = utf8 ENCRYPTION_KEY truncated/padded to 32 bytes,
 *                                          16-byte IV
 *   NEW v1 scheme (api/src/data/crypto.ts): AES-256-GCM, dot-joined iv.tag.ct (base64),
 *                                          key = sha256(ENCRYPTION_KEY), 12-byte IV
 *
 * so every credential bundle is DECRYPTED under EKOA_OLD_ENCRYPTION_KEY (old scheme) and
 * RE-ENCRYPTED under ENCRYPTION_KEY (new v1 scheme; `envelopeDecrypt` reads v1 rows
 * transparently). Row shapes are rewritten to what the new stack's readers actually require:
 *
 *   platform rows  old: global singleton { id: uuid, type: 'platform-<provider>',
 *                       platformProvider, credentials } (cortex persistence/integrations.ts)
 *                  new: { _id: 'platform-<orgId>-<provider>', orgId, integrationKey:
 *                       'platform-<provider>', platformProvider, enabled: true,
 *                       credentialsCiphertext } - getValidPlatformTokens
 *                       (api/src/integrations/platform-oauth.ts rowId/getOrgRow) re-checks
 *                       BOTH the exact _id and the stored orgId/platformProvider, so anything
 *                       else is invisible.
 *   zoho-sign rows old: { id, type: 'zoho-sign', ownerUserId?, credentials }
 *                  new: { _id, orgId, integrationKey: 'zoho-sign', ownerUserId?, enabled: true,
 *                       credentialsCiphertext } - findConfigForOwner
 *                       (api/src/integrations/service.ts) queries { orgId, integrationKey }.
 *   zoho index     old: <dataDir>/zoho-agreements.json rows keyed `id` (the Zoho requestId)
 *                  new: zoho_agreements.json rows keyed `_id` (sign-agreements.ts reads
 *                       zohoAgreements.get(requestId)); appId carries verbatim (canonical-id
 *                       preserving import) unless --rewrite-app-id maps it.
 *
 * Carried credential rows land enabled:true with needsReauth/oauthState cleared (a carried
 * credential is a live credential; stale flags would report it disconnected). The zoho bundle
 * keeps its `dc`; carried M365 bundles may hold `tid` (harmless - dropped at first refresh).
 *
 * ADOBE IS REFUSED BY DESIGN: adobe-agreements.json rows and `adobe-sign` credential rows are
 * NOT converted - Adobe was replaced by Zoho in the ERP's V13, and an in-flight Adobe
 * agreement cannot complete on the new stack (the Adobe backend is a fail-closed facade).
 * Their presence is reported loudly, never silently dropped.
 *
 * SECRET HANDLING: decrypted values and both keys are NEVER printed, logged, or embedded in
 * errors - failures name the row id and field only.
 *
 * Usage:
 *   EKOA_OLD_ENCRYPTION_KEY=... ENCRYPTION_KEY=... \
 *   node api/scripts/migrate/convert-dev-state.mjs <old-data-dir> \
 *     (--org <orgId> | --user <userId>) --out <dir> [--rewrite-app-id old=new]...
 *
 *   <old-data-dir>    the old stack's data dir (holds integration-configs.json,
 *                     zoho-agreements.json; typically ~/.ekoa/data)
 *   --org             target orgId on the new stack
 *   --user            derive the orgId via the import-tool convention: org-<userId>
 *   --out             output directory (must be OUTSIDE <old-data-dir>); receives
 *                     underscore-named, _id-keyed files ready for the import-tool source dir
 *   --rewrite-app-id  optional old=new appId rewrite for zoho_agreements rows (repeatable);
 *                     normally unneeded - the canonical-id-preserving import keeps prod appIds
 *
 * Env the OPERATOR must map when moving the deployment (names drifted between stacks):
 *   old EKOA_OAUTH_REDIRECT_BASE_URL  ->  new OAUTH_REDIRECT_BASE_URL
 *   old ZOHO_OAUTH_DC                 ->  new ZOHO_DC
 * (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET keep their names; carried Zoho bundles omit the client
 * pair on purpose, so the new stack's env client backs their refreshes.)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// The two wire schemes. The OLD side mirrors ekoa-dev cortex/src/tools/crypto.ts
// (getEncryptionKey + decryptCredential); the NEW side mirrors the v1 wire of
// api/src/data/crypto.ts `encrypt` byte-for-byte (the round-trip test decrypts the
// output with the REAL api/src/data/crypto.ts to pin that equivalence).
// ---------------------------------------------------------------------------

const ALGO = 'aes-256-gcm';
const NEW_IV_BYTES = 12;

/** OLD key derivation: utf8 bytes truncated/zero-padded to exactly 32. */
function oldKeyOf(raw) {
  const buf = Buffer.from(raw, 'utf8');
  if (buf.length >= 32) return buf.subarray(0, 32);
  const padded = Buffer.alloc(32);
  buf.copy(padded);
  return padded;
}

/** NEW key derivation: sha256 of the utf8 secret (any length). */
function newKeyOf(raw) {
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** Decrypt an OLD-scheme ciphertext (colon-joined iv:tag:ct). Errors carry NO key or
 *  plaintext material - only a reason class. */
export function decryptOldCredential(ciphertext, oldKey) {
  const parts = String(ciphertext).split(':');
  if (parts.length !== 3) {
    throw new Error('malformed old-scheme ciphertext (expected colon-joined iv:tag:ct)');
  }
  try {
    const decipher = createDecipheriv(ALGO, oldKeyOf(oldKey), Buffer.from(parts[0], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
    let plaintext = decipher.update(parts[2], 'base64', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch {
    // GCM auth failure = wrong EKOA_OLD_ENCRYPTION_KEY or corrupt bytes; never echo either.
    throw new Error('old-scheme decrypt failed (wrong EKOA_OLD_ENCRYPTION_KEY or corrupt ciphertext)');
  }
}

/** Encrypt under the NEW v1 scheme (dot-joined iv.tag.ct; api/src/data/crypto.ts wire). */
export function encryptNewCredential(plaintext, newKey) {
  const iv = randomBytes(NEW_IV_BYTES);
  const cipher = createCipheriv(ALGO, newKeyOf(newKey), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Row conversion (pure; exported for the round-trip test)
// ---------------------------------------------------------------------------

const PLATFORM_PROVIDERS = new Set(['google', 'microsoft']);
const PLATFORM_ROW_NAMES = { google: 'Google Workspace', microsoft: 'Microsoft 365' };

/** The Adobe refusal, stated once. */
export const ADOBE_REFUSAL =
  'Adobe is not carried BY DESIGN: the ERP replaced Adobe Sign with Zoho Sign in V13, and ' +
  'in-flight Adobe agreements cannot complete on the new stack (its Adobe backend is a ' +
  'fail-closed facade). Complete or void them on the old stack before cutover.';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Old-stack rows are keyed `id`; refuse anything else loudly (a `_id`-keyed file is
 *  already new-shaped and must not be double-converted). */
function requireOldRowId(row, file) {
  if (!isPlainObject(row) || typeof row.id !== 'string' || row.id === '') {
    throw new Error(
      `convert-dev-state: ${file} has a row without a non-empty string 'id' - not an old-stack export` +
      (isPlainObject(row) && typeof row._id === 'string' ? " (rows keyed '_id' are already new-shaped; do not convert twice)" : ''),
    );
  }
  return row.id;
}

/** Decrypt one old row's credential bundle to a JSON object, merged over the row's plaintext
 *  `config` values (the new stack keeps ALL values in the one encrypted bundle; decrypted
 *  fields win on key conflicts). */
function decryptedFieldsOf(row, id, keys, notes) {
  const plaintext = (() => {
    try {
      return decryptOldCredential(row.credentials, keys.oldKey);
    } catch (err) {
      throw new Error(`convert-dev-state: row ${id} ('${row.type}'): ${err.message}`);
    }
  })();
  let bundle;
  try {
    bundle = JSON.parse(plaintext);
  } catch {
    throw new Error(`convert-dev-state: row ${id} ('${row.type}'): decrypted bundle is not JSON`);
  }
  if (!isPlainObject(bundle)) {
    throw new Error(`convert-dev-state: row ${id} ('${row.type}'): decrypted bundle is not an object`);
  }
  const config = isPlainObject(row.config) ? row.config : {};
  const droppedConfigKeys = Object.keys(config).filter((k) => k in bundle);
  if (droppedConfigKeys.length > 0) {
    notes.push(`row ${id}: plaintext config key(s) ${droppedConfigKeys.join(', ')} superseded by the encrypted bundle`);
  }
  return { ...config, ...bundle };
}

/**
 * Convert the old integration-configs rows to new-stack integration_configs docs.
 * Returns { rows, notes }; throws on anything that must stop the operator (duplicate
 * platform singletons, undecryptable bundles, non-old-shaped input).
 */
export function convertIntegrationConfigs(oldRows, opts) {
  const { orgId, oldKey, newKey } = opts;
  const rows = [];
  const notes = [];
  const seenPlatform = new Set();

  for (const row of oldRows) {
    const id = requireOldRowId(row, 'integration-configs.json');
    const type = String(row.type ?? '');

    // Adobe: refused by design (see ADOBE_REFUSAL). Matches the old 'adobe-sign' config type.
    if (type === 'adobe-sign' || type === 'platform-adobe') {
      notes.push(`row ${id} ('${type}') SKIPPED: ${ADOBE_REFUSAL}`);
      continue;
    }
    // Captured browser sessions are machine/session-bound and have no field on the new
    // stack's IntegrationConfigDoc - never carried; recapture after cutover.
    if (typeof row.sessionState === 'string' && row.sessionState) {
      notes.push(`row ${id} ('${type}'): captured browser session NOT carried (recapture on the new stack)`);
      if (typeof row.credentials !== 'string' || !row.credentials) continue;
    }
    if (typeof row.credentials !== 'string' || !row.credentials) {
      notes.push(`row ${id} ('${type}') SKIPPED: no credential bundle to carry (reconnect on the new stack if still needed)`);
      continue;
    }

    const provider =
      typeof row.platformProvider === 'string' && PLATFORM_PROVIDERS.has(row.platformProvider)
        ? row.platformProvider
        : type.startsWith('platform-') && PLATFORM_PROVIDERS.has(type.slice('platform-'.length))
          ? type.slice('platform-'.length)
          : null;

    const fields = decryptedFieldsOf(row, id, { oldKey }, notes);
    const credentialsCiphertext = encryptNewCredential(JSON.stringify(fields), newKey);

    if (provider) {
      // The old stack held ONE global row per provider; two would collide on the new _id.
      if (seenPlatform.has(provider)) {
        throw new Error(
          `convert-dev-state: second '${provider}' platform row (${id}) - the new stack holds one ` +
          `org row per provider ('platform-${orgId}-${provider}'); remove the stale duplicate from the export`,
        );
      }
      seenPlatform.add(provider);
      // Exact reader shape: platform-oauth.ts getOrgRow re-checks _id AND orgId AND platformProvider.
      rows.push({
        _id: `platform-${orgId}-${provider}`,
        orgId,
        integrationKey: `platform-${provider}`,
        name: PLATFORM_ROW_NAMES[provider],
        platformProvider: provider,
        enabled: true,
        needsReauth: false,
        ...(typeof fields.email === 'string' && fields.email ? { email: fields.email } : {}),
        ...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}),
        credentialsCiphertext,
      });
      if (typeof fields.tid === 'string') {
        notes.push(`row ${id}: bundle carries 'tid' - harmless, dropped at the first token refresh`);
      }
      continue;
    }

    if (type === 'zoho-sign' && typeof fields.dc !== 'string') {
      notes.push(`row ${id} ('zoho-sign'): bundle has no 'dc' - the new stack falls back to ZOHO_DC (old name: ZOHO_OAUTH_DC)`);
    }

    // Ordinary org-scoped config (zoho-sign included): findConfigForOwner queries
    // { orgId, integrationKey } and prefers the ownerUserId match over the org-shared row.
    rows.push({
      _id: id,
      orgId,
      integrationKey: type,
      ...(typeof row.name === 'string' && row.name ? { name: row.name } : {}),
      ...(typeof row.ownerUserId === 'string' && row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
      enabled: true,
      needsReauth: false,
      ...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}),
      credentialsCiphertext,
    });
  }
  return { rows, notes };
}

/** Convert the old zoho-agreements reverse index: `id` -> `_id`, optional appId rewrite. */
export function convertZohoAgreements(oldRows, opts = {}) {
  const appIdMap = opts.rewriteAppIds ?? {};
  const rows = [];
  const notes = [];
  for (const row of oldRows) {
    const id = requireOldRowId(row, 'zoho-agreements.json');
    const { id: _dropped, ...rest } = row;
    const appId = typeof row.appId === 'string' && appIdMap[row.appId] !== undefined ? appIdMap[row.appId] : row.appId;
    if (appId !== row.appId) notes.push(`agreement ${id}: appId rewritten ${row.appId} -> ${appId}`);
    rows.push({ _id: id, ...rest, appId });
  }
  return { rows, notes };
}

/**
 * Whole-state conversion. `input` carries the parsed old files (or undefined when absent);
 * returns { integrationConfigs, zohoAgreements, notes }. Adobe agreements are counted and
 * refused, never converted.
 */
export function convertDevState(input, opts) {
  if (!opts || typeof opts.orgId !== 'string' || opts.orgId === '') {
    throw new Error('convert-dev-state: an orgId is required (--org, or --user for org-<userId>)');
  }
  if (typeof opts.oldKey !== 'string' || opts.oldKey === '') {
    throw new Error('convert-dev-state: EKOA_OLD_ENCRYPTION_KEY is required (the OLD stack key; never printed)');
  }
  if (typeof opts.newKey !== 'string' || opts.newKey === '') {
    throw new Error('convert-dev-state: ENCRYPTION_KEY is required (the NEW stack key; never printed)');
  }
  const notes = [];
  const configs = input.integrationConfigs
    ? convertIntegrationConfigs(assertArray(input.integrationConfigs, 'integration-configs.json'), opts)
    : { rows: [], notes: [] };
  const agreements = input.zohoAgreements
    ? convertZohoAgreements(assertArray(input.zohoAgreements, 'zoho-agreements.json'), opts)
    : { rows: [], notes: [] };
  notes.push(...configs.notes, ...agreements.notes);
  const adobeCount = Array.isArray(input.adobeAgreements) ? input.adobeAgreements.length : 0;
  if (adobeCount > 0) {
    notes.push(`${adobeCount} adobe-agreements row(s) REFUSED: ${ADOBE_REFUSAL}`);
  }
  return { integrationConfigs: configs.rows, zohoAgreements: agreements.rows, notes };
}

function assertArray(v, name) {
  if (!Array.isArray(v)) throw new Error(`convert-dev-state: ${name} is not a JSON array`);
  return v;
}

// ------------------------------ CLI ------------------------------

const USAGE = `usage: EKOA_OLD_ENCRYPTION_KEY=... ENCRYPTION_KEY=... \\
  node api/scripts/migrate/convert-dev-state.mjs <old-data-dir> \\
    (--org <orgId> | --user <userId>) --out <dir> [--rewrite-app-id old=new]...

Reads the OLD stack's integration-configs.json + zoho-agreements.json (read-only), decrypts
each credential bundle under EKOA_OLD_ENCRYPTION_KEY (old colon-joined scheme), re-shapes the
rows to the new stack's reader shapes, re-encrypts under ENCRYPTION_KEY (new v1 dot-joined
scheme), and writes import-tool-ready integration_configs.json + zoho_agreements.json into
--out. Adobe state is refused by design (Zoho replaced Adobe in the ERP's V13).

Operator env mapping on the NEW stack (names drifted):
  EKOA_OAUTH_REDIRECT_BASE_URL (old)  ->  OAUTH_REDIRECT_BASE_URL (new)
  ZOHO_OAUTH_DC (old)                 ->  ZOHO_DC (new)
Neither encryption key is ever printed; keep both out of shell history where possible.
`;

function parseArgs(argv) {
  const rewriteAppIds = {};
  let org, user, out;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--org') org = argv[++i];
    else if (a === '--user') user = argv[++i];
    else if (a === '--out') out = argv[++i];
    else if (a === '--rewrite-app-id') {
      const pair = String(argv[++i] ?? '');
      const eq = pair.indexOf('=');
      if (eq <= 0 || eq === pair.length - 1) throw new Error('convert-dev-state: --rewrite-app-id expects old=new');
      rewriteAppIds[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (a === '--help' || a === '-h') return { help: true };
    else if (a.startsWith('--')) throw new Error(`convert-dev-state: unknown flag ${a}`);
    else positional.push(a);
  }
  return { sourceDir: positional[0], org, user, out, rewriteAppIds };
}

/** The tool is read-only on the old data dir: refuse an --out inside (or equal to) it. */
function assertOutsideSource(sourceDir, outDir) {
  const rel = relative(resolve(sourceDir), resolve(outDir));
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (rel !== '' && outside) return;
  throw new Error(`convert-dev-state: --out ${resolve(outDir)} is inside the old data dir - the tool is read-only on its source; pass a path outside it`);
}

function readJsonIfPresent(dir, name) {
  const p = join(dir, name);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.sourceDir || !args.out || (!args.org && !args.user)) {
    process.stderr.write(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  if (args.org && args.user) throw new Error('convert-dev-state: pass --org OR --user, not both');
  const orgId = args.org ?? `org-${args.user}`;
  const oldKey = process.env.EKOA_OLD_ENCRYPTION_KEY ?? '';
  const newKey = process.env.ENCRYPTION_KEY ?? '';
  assertOutsideSource(args.sourceDir, args.out);

  const input = {
    integrationConfigs: readJsonIfPresent(args.sourceDir, 'integration-configs.json'),
    zohoAgreements: readJsonIfPresent(args.sourceDir, 'zoho-agreements.json'),
    adobeAgreements: readJsonIfPresent(args.sourceDir, 'adobe-agreements.json'),
  };
  if (input.integrationConfigs === undefined && input.zohoAgreements === undefined) {
    throw new Error(`convert-dev-state: neither integration-configs.json nor zoho-agreements.json found under ${resolve(args.sourceDir)}`);
  }

  const result = convertDevState(input, { orgId, oldKey, newKey, rewriteAppIds: args.rewriteAppIds });

  mkdirSync(args.out, { recursive: true });
  const written = [];
  if (input.integrationConfigs !== undefined) {
    writeFileSync(join(args.out, 'integration_configs.json'), JSON.stringify(result.integrationConfigs, null, 2) + '\n');
    written.push(`integration_configs.json (${result.integrationConfigs.length} row(s))`);
  }
  if (input.zohoAgreements !== undefined) {
    writeFileSync(join(args.out, 'zoho_agreements.json'), JSON.stringify(result.zohoAgreements, null, 2) + '\n');
    written.push(`zoho_agreements.json (${result.zohoAgreements.length} row(s))`);
  }

  for (const note of result.notes) process.stderr.write(`convert-dev-state: NOTE - ${note}\n`);
  process.stderr.write(`convert-dev-state: wrote ${written.join(', ')} -> ${resolve(args.out)}\n`);
  process.stderr.write(
    'convert-dev-state: REMEMBER the env-name drift on the new stack: ' +
    'OAUTH_REDIRECT_BASE_URL (was EKOA_OAUTH_REDIRECT_BASE_URL), ZOHO_DC (was ZOHO_OAUTH_DC)\n',
  );
}

// Run as CLI only when invoked directly (importable as a module for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    // Error paths never echo key material or plaintext (redaction rule above).
    process.stderr.write(`convert-dev-state: ERROR - ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
