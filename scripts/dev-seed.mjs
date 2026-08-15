#!/usr/bin/env node
/**
 * Dev seed data - state a human operator needs on every boot that the ephemeral dev Mongo
 * cannot keep (scripts/dev-api.mjs starts from an empty database each run). First (and so
 * far only) seed: the admin org's BRANDING - the brand research against ekoa.io/info is
 * multi-minute, model-driven work, and losing it on every restart made every dev session
 * start off-brand (operator report, 2026-08-13).
 *
 * Two directions, one fixture (scripts/seed/):
 *
 *   node scripts/dev-seed.mjs             seed the running stack (skips if already branded)
 *   node scripts/dev-seed.mjs --force     seed even over an existing brand
 *   node scripts/dev-seed.mjs --capture   re-snapshot the RUNNING stack's branding into the
 *                                         fixture (run after a fresh brand research you like)
 *
 * `npm run dev` runs the seed automatically after the credential provision (--no-seed skips).
 *
 * The fixture is two parts because the platform stores them apart: `seed/branding.json` is
 * the org document's branding (+ displayName) restored via the public contract
 * (PUT /api/v1/branding, merge-write - see routes/org.ts saveBrandingHandler); logo files
 * under `seed/brand-assets/` are content-hash-named files the api serves at /brand-assets/*,
 * copied straight into `<dataDir>/brand-assets` (default ~/.ekoa/data - survives restarts on
 * one machine; the copy makes a fresh checkout/machine work too).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = join(ROOT, 'scripts', 'seed');
const BRANDING_FIXTURE = join(SEED_DIR, 'branding.json');
const SEED_ASSETS_DIR = join(SEED_DIR, 'brand-assets');

const USER = process.env.EKOA_ADMIN_USERNAME || 'admin';
const PASS = process.env.EKOA_ADMIN_PASSWORD || 'tmp12345';

const log = (m) => process.stdout.write(`[dev-seed] ${m}\n`);

// Same resolution api/src/config.ts uses for its asset stores.
const dataDir = () => process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');

const readBackendPort = () => {
  try {
    const p = readFileSync(join(ROOT, 'backend.port'), 'utf8').trim();
    if (/^\d+$/.test(p)) return p;
  } catch { /* fall through */ }
  return '4111';
};
const defaultBase = () => `http://localhost:${readBackendPort()}`;

async function adminFetch(base, path, init = {}, token) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  return res;
}

async function loginAdmin(base) {
  const res = await adminFetch(base, '/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`login failed as ${USER}: ${res.status}`);
  const body = await res.json();
  const token = body.token || body.accessToken;
  if (!token) throw new Error('login answered without a token');
  return token;
}

/** A brand worth not clobbering: anything beyond an empty object. */
const hasBrand = (branding) => branding && typeof branding === 'object' && Object.keys(branding).length > 0;

/** Copy seed logo files into the api's brand-assets store (idempotent, never overwrites). */
function ensureBrandAssets() {
  if (!existsSync(SEED_ASSETS_DIR)) return 0;
  const dest = join(dataDir(), 'brand-assets');
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const f of readdirSync(SEED_ASSETS_DIR)) {
    const target = join(dest, f);
    if (!existsSync(target)) {
      copyFileSync(join(SEED_ASSETS_DIR, f), target);
      copied++;
    }
  }
  return copied;
}

/**
 * Seed the branding fixture into the running stack. Returns 'seeded' | 'kept' | 'no-fixture'.
 * Never throws for the boot path - dev.mjs treats a failure as a warning, not a fatal.
 */
export async function seedBranding({ base = defaultBase(), force = false } = {}) {
  if (!existsSync(BRANDING_FIXTURE)) return 'no-fixture';
  const fixture = JSON.parse(readFileSync(BRANDING_FIXTURE, 'utf8'));
  const token = await loginAdmin(base);
  const orgRes = await adminFetch(base, '/api/v1/org', {}, token);
  if (!orgRes.ok) throw new Error(`GET /api/v1/org failed: ${orgRes.status}`);
  const org = await orgRes.json();
  if (hasBrand(org.branding) && !force) return 'kept';
  const assetsCopied = ensureBrandAssets();
  if (assetsCopied) log(`copied ${assetsCopied} brand asset(s) into ${join(dataDir(), 'brand-assets')}`);
  const putRes = await adminFetch(base, '/api/v1/branding', {
    method: 'PUT',
    body: JSON.stringify({
      branding: fixture.branding,
      ...(fixture.displayName ? { displayName: fixture.displayName } : {}),
    }),
  }, token);
  if (!putRes.ok) throw new Error(`PUT /api/v1/branding failed: ${putRes.status} ${await putRes.text()}`);
  return 'seeded';
}

// ---- Salomao ERP seed (migration task #9, 2026-08-15) -------------------------
//
// The imported legal-case-manager-3 instance lives in the ephemeral dev Mongo, so every
// reboot loses it while its 91 uploaded file blobs + sidecars persist on disk under
// <dataDir>/app-data/<id>/. This step re-imports the CONVERTED bundle (files + app-data +
// canonical id + slug) and re-arms the email.received listener trigger, both idempotent.
//
// The fixture is NOT committed (scripts/seed/erp/.gitignore): it carries the customer's real
// app-data. Build it with the migration converter (docs/operations-runbook.md, salomao
// section):
//   node api/scripts/migrate/convert-dev-bundle.mjs <envelope> --data <dump> \
//     --slug legal-case-manager-3 --id <prod-canonical-id> --m365-proxy \
//     --out scripts/seed/erp/salomao-bundle.json
const ERP_FIXTURE = join(SEED_DIR, 'erp', 'salomao-bundle.json');

/** Seed the converted ERP bundle. Returns 'seeded' | 'kept' | 'no-fixture'. */
export async function seedErp({ base = defaultBase(), force = false } = {}) {
  if (!existsSync(ERP_FIXTURE)) return 'no-fixture';
  const bundle = JSON.parse(readFileSync(ERP_FIXTURE, 'utf8'));
  const slug = bundle.slug;
  if (!slug) throw new Error('erp fixture carries no slug - rebuild it with --slug');
  const probe = await fetch(`${base}/apps/${slug}/`, { redirect: 'manual' }).catch(() => null);
  if (probe && probe.status < 400 && !force) {
    await ensureErpListener(base, bundle.id);
    return 'kept';
  }
  const token = await loginAdmin(base);
  // preserveId keeps the prod canonical id, so the persisted blob dir and every embedded
  // /api/app-files/<id>/ URL in the seeded rows keep resolving. Admin is super-admin in dev,
  // which the route requires for preserveId.
  const res = await adminFetch(base, '/api/v1/artifacts/import', {
    method: 'POST',
    body: JSON.stringify({ bundle, preserveId: Boolean(bundle.id) }),
  }, token);
  if (!res.ok) throw new Error(`ERP import failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const created = await res.json();
  const applied = created.importReport?.id?.applied || created.id;
  const seeded = created.importReport?.appData;
  log(`ERP imported: ${created.slug} (id ${applied})${seeded ? ` - app-data ${seeded.imported} item(s), ${seeded.skipped} skipped` : ''}`);
  const filesDir = join(dataDir(), 'app-data', applied, 'files');
  if (!existsSync(filesDir) || readdirSync(filesDir).length === 0) {
    log(`WARNING: no file blobs at ${filesDir} - uploads will 404; run api/scripts/migrate/migrate-app-files.mjs`);
  }
  await ensureErpListener(base, applied);
  return 'seeded';
}

/** Re-arm the email.received mailbox listener for the ERP if absent (idempotent). */
async function ensureErpListener(base, artifactId) {
  if (!artifactId) return;
  const token = await loginAdmin(base);
  const listRes = await adminFetch(base, '/api/v1/triggers', {}, token);
  if (!listRes.ok) { log(`WARNING: trigger list failed (${listRes.status}) - listener not checked`); return; }
  const { items = [] } = await listRes.json();
  const existing = items.find((t) => t.artifactId === artifactId && t.eventName === 'email.received');
  if (existing) return;
  const res = await adminFetch(base, '/api/v1/triggers', {
    method: 'POST',
    body: JSON.stringify({
      integrationKey: 'microsoft-365',
      eventName: 'email.received',
      target: { kind: 'artifact-backend', artifactId, entrypoint: 'onEmail' },
    }),
  }, token);
  if (res.ok) {
    const { trigger } = await res.json();
    log(`ERP mailbox listener armed (kind ${trigger.kind}, ${trigger.pollConfig ? trigger.pollConfig.intervalMs + 'ms poll' : 'no pollConfig'})`);
  } else {
    log(`WARNING: listener create failed (${res.status}) - arm it by hand via the Ligacoes card`);
  }
}

/** Snapshot the running stack's branding (+ its referenced logo files) into the fixture. */
async function captureBranding({ base = defaultBase() } = {}) {
  const token = await loginAdmin(base);
  const orgRes = await adminFetch(base, '/api/v1/org', {}, token);
  if (!orgRes.ok) throw new Error(`GET /api/v1/org failed: ${orgRes.status}`);
  const org = await orgRes.json();
  if (!hasBrand(org.branding)) throw new Error('the running stack has no branding to capture');
  mkdirSync(SEED_ASSETS_DIR, { recursive: true });
  writeFileSync(
    BRANDING_FIXTURE,
    `${JSON.stringify({ branding: org.branding, displayName: org.displayName }, null, 2)}\n`,
  );
  // Pull every /brand-assets/<file> the branding references out of the live store.
  const refs = JSON.stringify(org.branding).match(/\/brand-assets\/[a-z0-9]+\.[a-z0-9]+/gi) || [];
  for (const ref of new Set(refs)) {
    const file = ref.split('/').pop();
    const src = join(dataDir(), 'brand-assets', file);
    if (existsSync(src)) copyFileSync(src, join(SEED_ASSETS_DIR, file));
    else log(`WARNING: referenced asset missing on disk: ${src}`);
  }
  log(`captured branding (${Object.keys(org.branding).length} keys, ${new Set(refs).size} asset ref(s)) -> ${BRANDING_FIXTURE}`);
}

// ---- CLI ---------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--capture')) {
      await captureBranding({});
    } else {
      const result = await seedBranding({ force: args.includes('--force') });
      if (result === 'kept') log('stack already branded - not touching it (use --force to overwrite)');
      else if (result === 'no-fixture') log(`no fixture at ${BRANDING_FIXTURE} - run --capture against a branded stack first`);
      else log('branding seeded');
      // The ERP seed never fails the boot path: branding landed, and a missing/failed ERP
      // fixture is a WARNING the operator acts on, not a broken dev stack.
      try {
        const erp = await seedErp({ force: args.includes('--force-erp') });
        if (erp === 'kept') log('ERP already served - listener checked, nothing else touched (use --force-erp to reimport)');
        else if (erp === 'no-fixture') log(`no ERP fixture at ${ERP_FIXTURE} - see its build command in scripts/dev-seed.mjs`);
      } catch (err) {
        log(`ERP seed FAILED (non-fatal): ${err.message}`);
      }
    }
  } catch (err) {
    log(`FAILED: ${err.message}`);
    process.exit(1);
  }
}
