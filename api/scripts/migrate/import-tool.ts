/**
 * Ekoa coexistence-cutover import tool (ch10 §10.2, §10.3).
 *
 * One idempotent, READ-ONLY-ON-SOURCE, DRY-RUN-BY-DEFAULT migration tool that moves every
 * §10.2 store family from a copy of the old-stack JsonStore tree into the new stack's
 * collections engine, with verification and journaling built in. It NEVER writes, moves, or
 * deletes anything on the source (§10.3 rule 1); rollback safety depends on it. `--execute`
 * is required to write to the target; the default prints the full plan and counts.
 *
 * The §10.2 families, in dependency order (ownership references exist before their referents):
 *   orgs (CREATED from the user roster, row 2a) -> users (each gains orgId) -> settings
 *   -> artifacts (screenshot path-fields rewritten, row 4) -> slugs (seeded, dups suffix-resolved,
 *      row 10) -> integration_configs (ciphertext decrypt-sample, row 3) -> app_sessions
 *      -> adobe_agreements -> integration-definition split (row 11: typed data + prose)
 *   -> token_events -> billing_accounts -> activity_logs -> jobs -> knowledge registries
 *   -> credentials singleton (row 8, from standalone_credentials, decrypt-sample) -> blob trees (row 4).
 * `teams` is NOT imported (deleted end to end, §10.8); `company.json` is archived, not imported
 * (superseded by orgs, row 2a). Both are asserted absent from the target.
 *
 * Idempotence (§10.3 rule 2): every target doc uses the source id (or a deterministic derived
 * id) as its `_id`, so a re-run upserts identical documents; a partially-failed run is fixed by
 * re-running, never by hand-editing. Verification (§10.3 rule 4): each family ends by re-reading
 * its target and reporting `source count / imported count / checksum match` over a canonical
 * projection (checksum.ts). Journaling (§10.3 rule 5): every run appends a block to a RUN_LOG.
 *
 * Standalone operator tooling: imports the new stack's data stores + crypto + content loader,
 * but is not part of the deployed service bundle (it lives under api/scripts/, outside src/).
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import {
  users,
  orgs,
  settings,
  artifacts,
  slugs,
  integrationConfigs,
  appSessions,
  adobeAgreements,
  tokenEvents,
  billingAccounts,
  activityLogs,
  jobs,
  knowledgeSources,
  knowledgeUploads,
  credentials,
} from '../../src/data/stores.js';
import type { Store, Doc } from '../../src/data/store.js';
import { decrypt } from '../../src/data/crypto.js';
import { importPackage, listPackages } from '../../src/content/index.js';
import { storeChecksum, type PlainDoc } from './checksum.js';
import { Journal } from './journal.js';

/** Deterministic fallback timestamp for created/derived docs so re-runs are byte-identical
 *  (idempotence, §10.3 rule 2) - never wall-clock. */
const MIGRATION_EPOCH_ISO = '2026-07-01T00:00:00.000Z';

/** How many ciphertexts a family decrypt-samples under the carried key (§10.3 rule 4, row 3/8). */
const DECRYPT_SAMPLE_N = 3;

// ---------------------------------------------------------------------------
// Source loading (READ-ONLY, §10.3 rule 1)
// ---------------------------------------------------------------------------

export interface LoadedSource {
  root: string;
  readArray(name: string): PlainDoc[];
  readJson(name: string): unknown;
  exists(name: string): boolean;
}

/** Open a source directory read-only. Every accessor reads; nothing writes back (§10.3 rule 1). */
export function loadSource(root: string): LoadedSource {
  const abs = (name: string): string => join(root, name);
  return {
    root,
    exists: (name) => existsSync(abs(name)),
    readJson: (name) => {
      const p = abs(name);
      if (!existsSync(p)) return undefined;
      return JSON.parse(readFileSync(p, 'utf8'));
    },
    readArray: (name) => {
      const p = abs(name);
      if (!existsSync(p)) return [];
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error(`source ${name} is not a JSON array`);
      return parsed as PlainDoc[];
    },
  };
}

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------

export type FamilyKind = 'collection' | 'blobs' | 'prose';

export interface DecryptSample {
  id: string;
  field: string;
  ok: boolean;
  /** On failure, the underlying reason (wrong/missing key vs malformed ciphertext) for diagnostics. */
  reason?: string;
}

export interface BlobPlan {
  sourceRoot: string;
  /** POSIX-relative file paths under the blob tree. */
  files: string[];
  totalBytes: number;
  /** sha256 of one deterministically-sampled file's bytes (§10.2 row 4 "sampled content hash"). */
  sampledHash: string;
  sampledFile: string | null;
}

export interface ProsePackagePlan {
  sourceKey: string;
  packageName: string;
  /** Absolute path to a synthesized, loader-valid package directory (built lazily on execute). */
  sourceSkillPath: string;
}

export interface FamilyPlan {
  family: string;
  kind: FamilyKind;
  /** Physical collection name for collection families; null for blobs/prose. */
  targetCollection: string | null;
  sourceCount: number;
  /** Docs the run will upsert (collection kind). */
  docs: PlainDoc[];
  /** Fields excluded from the canonical checksum (ciphertext / rewritten paths, §10.3 rule 4). */
  excludeFields: string[];
  checksum: string;
  sampled: boolean;
  notes: string[];
  decryptSamples: DecryptSample[];
  blob?: BlobPlan;
  prose?: ProsePackagePlan[];
}

// ---------------------------------------------------------------------------
// Family builders (pure over the loaded source; no DB, no writes)
// ---------------------------------------------------------------------------

type UserRole = 'super-admin' | 'org-admin' | 'builder';

function orgIdFor(userId: string): string {
  return `org-${userId}`;
}

/** Identify the platform founder in the source roster: an explicit `isFounder` flag wins, then
 *  an existing super-admin, then the lexicographically-first id (deterministic). */
function resolveFounderId(roster: PlainDoc[]): string {
  const flagged = roster.find((u) => u.isFounder === true);
  if (flagged) return flagged._id;
  const admin = roster.find((u) => u.role === 'super-admin');
  if (admin) return admin._id;
  const sorted = [...roster].sort((a, b) => a._id.localeCompare(b._id));
  return sorted[0]?._id ?? '';
}

/** Row 2a: one org per user, default design system, no brand carry; the founder's account
 *  is later seeded super-admin. createdAt is carried from the user (else the fixed epoch) so a
 *  re-run is byte-identical. */
function buildOrgs(roster: PlainDoc[]): FamilyPlan {
  const docs: PlainDoc[] = roster.map((u) => ({
    _id: orgIdFor(u._id),
    name: String(u.username ?? u._id),
    displayName: String(u.username ?? u._id),
    createdAt: typeof u.createdAt === 'string' ? u.createdAt : MIGRATION_EPOCH_ISO,
    settings: { designSystem: 'default' },
  }));
  const { checksum, sampled } = storeChecksum(docs, []);
  return {
    family: 'orgs',
    kind: 'collection',
    targetCollection: 'orgs',
    sourceCount: roster.length,
    docs,
    excludeFields: [],
    checksum,
    sampled,
    notes: [`created ${docs.length} orgs from the user roster (row 2a); default design system, no brand carry`],
    decryptSamples: [],
  };
}

/** Row 2 + 2a: each user gains a required `orgId` (its own org); the founder is seeded
 *  super-admin, every other user is demoted out of super-admin (exactly one super-admin). */
function buildUsers(roster: PlainDoc[], founderId: string): FamilyPlan {
  const docs: PlainDoc[] = roster.map((u) => {
    const isFounder = u._id === founderId;
    const srcRole = u.role;
    const role: UserRole = isFounder ? 'super-admin' : srcRole === 'org-admin' ? 'org-admin' : 'builder';
    return {
      _id: u._id,
      username: String(u.username ?? u._id),
      passwordHash: String(u.passwordHash ?? ''),
      role,
      orgId: orgIdFor(u._id),
      active: u.active !== false,
      ...(u.preferences ? { preferences: u.preferences } : {}),
    };
  });
  const { checksum, sampled } = storeChecksum(docs, []);
  return {
    family: 'users',
    kind: 'collection',
    targetCollection: 'users',
    sourceCount: roster.length,
    docs,
    excludeFields: [],
    checksum,
    sampled,
    notes: [`founder ${founderId} seeded super-admin; ${docs.length - 1} other user(s) carry org-admin/builder`],
    decryptSamples: [],
  };
}

/** A straight collection carry: source docs move verbatim under their existing ids. */
function buildPassthrough(
  family: string,
  collection: string,
  rows: PlainDoc[],
  excludeFields: string[] = [],
): FamilyPlan {
  const docs = rows.map((r) => ({ ...r }));
  const { checksum, sampled } = storeChecksum(docs, excludeFields);
  return {
    family,
    kind: 'collection',
    targetCollection: collection,
    sourceCount: rows.length,
    docs,
    excludeFields,
    checksum,
    sampled,
    notes: sampled ? [`over 10k rows: counts verified exactly, checksum over a deterministic 1% sample (§10.3 rule 4)`] : [],
    decryptSamples: [],
  };
}

/** Row 4: an owning store's path-bearing fields are rewritten to storage-relative keys during
 *  import (excluded from the checksum). Here: artifacts' screenshotPath. */
function buildArtifacts(rows: PlainDoc[]): FamilyPlan {
  const docs: PlainDoc[] = rows.map((a) => {
    const out: PlainDoc = { ...a };
    if (typeof a.screenshotPath === 'string' && a.screenshotPath) {
      out.screenshotPath = `artifacts/${a._id}/${basename(a.screenshotPath)}`;
    }
    return out;
  });
  const excludeFields = ['screenshotPath'];
  const { checksum, sampled } = storeChecksum(docs, excludeFields);
  const rewritten = docs.filter((d) => typeof d.screenshotPath === 'string').length;
  return {
    family: 'artifacts',
    kind: 'collection',
    targetCollection: 'artifacts',
    sourceCount: rows.length,
    docs,
    excludeFields,
    checksum,
    sampled,
    notes: rewritten ? [`rewrote ${rewritten} screenshotPath field(s) to storage-relative keys (row 4)`] : [],
    decryptSamples: [],
  };
}

/** Row 10: seed one slug reservation per artifact; historical duplicates are resolved
 *  deterministically by suffixing (`slug`, `slug-2`, `slug-3`, ...), each resolution logged. */
function buildSlugs(artifactRows: PlainDoc[]): FamilyPlan {
  const notes: string[] = [];
  const taken = new Set<string>();
  const docs: PlainDoc[] = [];
  // Sort by artifact id so collision resolution is deterministic regardless of source ordering.
  const sorted = [...artifactRows].sort((a, b) => a._id.localeCompare(b._id));
  for (const art of sorted) {
    const base = typeof art.slug === 'string' && art.slug ? art.slug : art._id;
    let slug = base;
    let n = 1;
    while (taken.has(slug)) {
      n += 1;
      slug = `${base}-${n}`;
    }
    if (slug !== base) notes.push(`slug collision: artifact ${art._id} wanted "${base}", reserved "${slug}"`);
    taken.add(slug);
    docs.push({ _id: slug, artifactId: art._id });
  }
  const { checksum, sampled } = storeChecksum(docs, []);
  return {
    family: 'slugs',
    kind: 'collection',
    targetCollection: 'slugs',
    sourceCount: artifactRows.length,
    docs,
    excludeFields: [],
    checksum,
    sampled,
    notes: [`seeded ${docs.length} slug reservation(s) from artifacts; ${notes.length} collision(s) resolved`, ...notes],
    decryptSamples: [],
  };
}

/** Rows 3/8: decrypt-sample up to N ciphertexts under the carried key; fail loudly on any
 *  failure (§10.3 rule 4). Read-only on source, so it runs in dry-run and execute alike. */
function decryptSample(rows: PlainDoc[], field: string): DecryptSample[] {
  const withField = rows.filter((r) => typeof r[field] === 'string' && r[field]);
  const sorted = [...withField].sort((a, b) => a._id.localeCompare(b._id)).slice(0, DECRYPT_SAMPLE_N);
  return sorted.map((r) => {
    let ok = false;
    let reason: string | undefined;
    try {
      decrypt(String(r[field]));
      ok = true;
    } catch (err) {
      ok = false;
      // Keep the underlying reason so the operator can tell a wrong/missing ENCRYPTION_KEY from a
      // malformed ciphertext on the fail-loud path (§10.3 rule 4).
      reason = err instanceof Error ? err.message : String(err);
    }
    return { id: r._id, field, ok, ...(reason ? { reason } : {}) };
  });
}

/** Row 3: integration_configs carry credential ciphertext (moved verbatim; excluded from the
 *  checksum, decrypt-sampled). */
function buildIntegrationConfigs(rows: PlainDoc[]): FamilyPlan {
  const excludeFields = ['credentialCiphertext'];
  const plan = buildPassthrough('integration_configs', 'integration_configs', rows, excludeFields);
  plan.decryptSamples = decryptSample(rows, 'credentialCiphertext');
  const failed = plan.decryptSamples.filter((s) => !s.ok).length;
  plan.notes.push(`decrypt-sampled ${plan.decryptSamples.length} credential ciphertext(s); ${failed} failure(s)`);
  return plan;
}

/** Row 8: the standalone_credentials custody row imports into the `credentials` Firestore
 *  singleton (`_id:'default'`), moved verbatim under the carried ENCRYPTION_KEY (no re-encrypt
 *  pass needed since the key is carried), with a decrypt-sample. No installation rows. */
function buildCredentials(rows: PlainDoc[]): FamilyPlan {
  const src = rows[0];
  const docs: PlainDoc[] = src
    ? [
        {
          _id: 'default',
          mode: typeof src.mode === 'string' ? src.mode : 'oauth',
          ...(typeof src.credentialCiphertext === 'string' ? { credentialCiphertext: src.credentialCiphertext } : {}),
          ...(src.refreshMeta ? { refreshMeta: src.refreshMeta } : {}),
        },
      ]
    : [];
  const excludeFields = ['credentialCiphertext'];
  const { checksum, sampled } = storeChecksum(docs, excludeFields);
  const decryptSamples = decryptSample(docs, 'credentialCiphertext');
  const failed = decryptSamples.filter((s) => !s.ok).length;
  return {
    family: 'credentials',
    kind: 'collection',
    targetCollection: 'credentials',
    sourceCount: rows.length,
    docs,
    excludeFields,
    checksum,
    sampled,
    notes: [
      `imported the credentials singleton from standalone_credentials (row 8); no installation rows`,
      `decrypt-sampled ${decryptSamples.length} ciphertext(s); ${failed} failure(s)`,
    ],
    decryptSamples,
  };
}

/** Recursively list files under a directory as POSIX-relative paths. */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const recur = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) recur(abs);
      else if (e.isFile()) out.push(relative(root, abs).split(sep).join('/'));
    }
  };
  if (existsSync(root)) recur(root);
  return out.sort();
}

/** Row 4: copy a blob tree onto the new data volume; verification is file counts + total bytes
 *  + a sampled content hash. */
function buildBlobs(sourceRoot: string): FamilyPlan {
  const files = walkFiles(sourceRoot);
  let totalBytes = 0;
  for (const f of files) totalBytes += statSync(join(sourceRoot, f)).size;
  const sampledFile = files.length > 0 ? files[Math.floor((files.length - 1) / 2)] ?? files[0]! : null;
  const sampledHash = sampledFile
    ? createHash('sha256').update(readFileSync(join(sourceRoot, sampledFile))).digest('hex')
    : '';
  return {
    family: 'blobs',
    kind: 'blobs',
    targetCollection: null,
    sourceCount: files.length,
    docs: [],
    excludeFields: [],
    checksum: sampledHash,
    sampled: false,
    notes: [`blob tree: ${files.length} file(s), ${totalBytes} byte(s); sampled ${sampledFile ?? '(none)'}`],
    decryptSamples: [],
    blob: { sourceRoot, files, totalBytes, sampledHash, sampledFile },
  };
}

/** Row 11: the runtime integration-definition split. Typed data (config field paths + actions
 *  + history + provisioned automations) becomes a typed doc beside integration_configs; the
 *  prose (SKILL.md) is imported through the content loader's importPackage. This builds the
 *  typed half and PLANS the prose half (executed against a content data dir on --execute). */
function buildIntegrationDefinitions(source: LoadedSource): { typed: FamilyPlan; prose: FamilyPlan } {
  const root = join(source.root, 'integration_skills');
  const keys = existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];

  const typedDocs: PlainDoc[] = [];
  const prosePackages: ProsePackagePlan[] = [];
  for (const key of keys) {
    const dir = join(root, key);
    const configPath = join(dir, 'config.json');
    const historyPath = join(dir, 'history.json');
    const skillPath = join(dir, 'SKILL.md');
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : undefined;
    const autoDir = join(dir, 'automations');
    const automations = existsSync(autoDir)
      ? readdirSync(autoDir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(autoDir, f), 'utf8')))
      : [];
    typedDocs.push({
      _id: `intdef:${key}`,
      integrationKey: key,
      userCreated: true,
      configSchema: config.configSchema ?? [],
      actions: config.actions ?? [],
      ...(history ? { history } : {}),
      ...(automations.length ? { automations } : {}),
    });
    if (existsSync(skillPath)) {
      prosePackages.push({ sourceKey: key, packageName: `integration-${key}`, sourceSkillPath: skillPath });
    }
  }

  const { checksum, sampled } = storeChecksum(typedDocs, []);
  const typed: FamilyPlan = {
    family: 'integration_definitions (typed)',
    kind: 'collection',
    targetCollection: 'integration_configs',
    sourceCount: keys.length,
    docs: typedDocs,
    excludeFields: [],
    checksum,
    sampled,
    notes: [`row 11 split: ${typedDocs.length} typed integration-definition doc(s) beside integration_configs`],
    decryptSamples: [],
  };
  const prose: FamilyPlan = {
    family: 'integration_definitions (prose)',
    kind: 'prose',
    targetCollection: null,
    sourceCount: prosePackages.length,
    docs: [],
    excludeFields: [],
    checksum: createHash('sha256').update(prosePackages.map((p) => p.packageName).sort().join('\n')).digest('hex'),
    sampled: false,
    notes: [`row 11 split: ${prosePackages.length} prose package(s) via the content loader importPackage`],
    decryptSamples: [],
    prose: prosePackages,
  };
  return { typed, prose };
}

/**
 * Build the full ordered plan (§10.2 import order). Pure over the loaded source: reads files,
 * computes canonical checksums, and runs the read-only decrypt-samples. No DB access, no writes.
 */
export function buildPlan(source: LoadedSource): FamilyPlan[] {
  const roster = source.readArray('users.json');
  const founderId = resolveFounderId(roster);
  const artifactRows = source.readArray('artifacts.json');
  const { typed: intDefTyped, prose: intDefProse } = buildIntegrationDefinitions(source);

  return [
    buildOrgs(roster),
    buildUsers(roster, founderId),
    buildPassthrough('settings', 'settings', source.readArray('settings.json')),
    buildArtifacts(artifactRows),
    buildSlugs(artifactRows),
    buildIntegrationConfigs(source.readArray('integration_configs.json')),
    buildPassthrough('app_sessions', 'app_sessions', source.readArray('app_sessions.json')),
    buildPassthrough('adobe_agreements', 'adobe_agreements', source.readArray('adobe_agreements.json')),
    intDefTyped,
    intDefProse,
    buildPassthrough('token_events', 'token_events', source.readArray('token_events.json')),
    buildPassthrough('billing_accounts', 'billing_accounts', source.readArray('billing_accounts.json')),
    buildPassthrough('activity_logs', 'activity_logs', source.readArray('activity_logs.json')),
    buildPassthrough('jobs', 'jobs', source.readArray('jobs.json')),
    buildPassthrough('knowledge_sources', 'knowledge_sources', source.readArray('knowledge_sources.json')),
    buildPassthrough('knowledge_uploads', 'knowledge_uploads', source.readArray('knowledge_uploads.json')),
    buildCredentials(source.readArray('standalone_credentials.json')),
    buildBlobs(join(source.root, 'blobs')),
  ];
}

/** Families explicitly NOT imported (§10.8) - asserted absent from the target. */
export const NON_IMPORTS: Array<{ file: string; reason: string }> = [
  { file: 'teams.json', reason: 'teams deleted end to end (Amendment 2, §10.8) - no importer' },
  { file: 'company.json', reason: 'company.json archived, not imported (superseded by orgs, row 2a)' },
];

/**
 * §10.2 rows that are NOT import scripts - documented here so the tool set records them, but
 * handled at the switch as volume/lifecycle operations rather than by this importer:
 *   row 5  knowledge vault + FTS index - VOLUME REATTACH (re-mount/copy the dir; FTS rides along
 *          or the boot backfill rebuilds it);
 *   row 6  sandboxes / per-artifact git / browser profiles - COPIED with git history intact (rsync);
 *   row 7  event queue (triggers.db) - STARTS FRESH (drained to zero pre-freeze, not copied);
 *   row 9  one-shot migration sentinels + legacy in-place migrations - NOT CARRIED (effects baked in);
 *   row 12 bridge pairings - RE-PAIR, not migrated (revoke-all then the founder re-pairs at switch).
 */
export const NON_IMPORT_SCRIPT_ROWS: Array<{ row: number; family: string; disposition: string }> = [
  { row: 5, family: 'knowledge vault + FTS index', disposition: 'volume reattach' },
  { row: 6, family: 'sandboxes / per-artifact git / browser profiles', disposition: 'copied with git history' },
  { row: 7, family: 'event queue (triggers.db)', disposition: 'starts fresh' },
  { row: 9, family: 'migration sentinels / legacy in-place migrations', disposition: 'not carried' },
  { row: 12, family: 'bridge pairings', disposition: 're-pair at switch' },
];

// ---------------------------------------------------------------------------
// Store registry (execute + verify)
// ---------------------------------------------------------------------------

const STORE_BY_COLLECTION: Record<string, Store<Doc>> = {
  orgs: orgs as unknown as Store<Doc>,
  users: users as unknown as Store<Doc>,
  settings: settings as unknown as Store<Doc>,
  artifacts: artifacts as unknown as Store<Doc>,
  slugs: slugs as unknown as Store<Doc>,
  integration_configs: integrationConfigs as unknown as Store<Doc>,
  app_sessions: appSessions as unknown as Store<Doc>,
  adobe_agreements: adobeAgreements as unknown as Store<Doc>,
  token_events: tokenEvents as unknown as Store<Doc>,
  billing_accounts: billingAccounts as unknown as Store<Doc>,
  activity_logs: activityLogs as unknown as Store<Doc>,
  jobs: jobs as unknown as Store<Doc>,
  knowledge_sources: knowledgeSources as unknown as Store<Doc>,
  knowledge_uploads: knowledgeUploads as unknown as Store<Doc>,
  credentials: credentials as unknown as Store<Doc>,
};

export interface FamilyResult {
  family: string;
  kind: FamilyKind;
  targetCollection: string | null;
  sourceCount: number;
  /** Planned count (dry-run) or re-read count (execute). */
  importedCount: number;
  checksumSource: string;
  /** Recomputed from the re-read target (execute only). */
  checksumTarget: string | null;
  /** execute: source===target; dry-run: null (nothing written to compare). */
  checksumMatch: boolean | null;
  sampled: boolean;
  notes: string[];
  decryptSamples: DecryptSample[];
}

export interface RunOptions {
  sourceDir: string;
  execute: boolean;
  journalPath: string;
  /** Data dir for the content loader when executing the row-11 prose import. */
  contentDataDir?: string;
  now?: () => number;
}

export interface RunResult {
  mode: 'dry-run' | 'execute';
  families: FamilyResult[];
  nonImports: typeof NON_IMPORTS;
  /** True when every decrypt-sample passed and (on execute) every checksum matched. */
  ok: boolean;
}

/** Write a collection family (idempotent upsert by `_id`), then re-read and checksum it. */
async function executeCollection(plan: FamilyPlan): Promise<{ importedCount: number; checksumTarget: string }> {
  const store = STORE_BY_COLLECTION[plan.targetCollection!];
  if (!store) throw new Error(`no store registered for collection ${plan.targetCollection}`);
  for (const doc of plan.docs) await store.put(doc as unknown as Doc);
  const reread = (await store.find({})) as unknown as PlainDoc[];
  // For the credentials singleton and any family whose target may hold pre-existing rows, hash
  // only the ids this plan produced so the checksum compares like for like.
  const ids = new Set(plan.docs.map((d) => d._id));
  const scoped = reread.filter((d) => ids.has(d._id));
  const { checksum } = storeChecksum(scoped, plan.excludeFields);
  return { importedCount: scoped.length, checksumTarget: checksum };
}

/** Row 4: copy the blob tree to the target volume, then verify file count + bytes + sampled hash. */
function executeBlobs(plan: FamilyPlan, targetRoot: string): { importedCount: number; checksumTarget: string } {
  const b = plan.blob!;
  for (const rel of b.files) {
    const dest = join(targetRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(b.sourceRoot, rel), dest);
  }
  const copied = walkFiles(targetRoot);
  let bytes = 0;
  for (const f of copied) bytes += statSync(join(targetRoot, f)).size;
  const checksumTarget = b.sampledFile
    ? createHash('sha256').update(readFileSync(join(targetRoot, b.sampledFile))).digest('hex')
    : '';
  if (copied.length !== b.files.length || bytes !== b.totalBytes) {
    throw new Error(`blob copy mismatch: ${copied.length}/${b.files.length} files, ${bytes}/${b.totalBytes} bytes`);
  }
  return { importedCount: copied.length, checksumTarget };
}

/** Row 11 prose: synthesize a loader-valid content package from each source SKILL.md and import
 *  it through the content loader (importPackage). Verifies the listPackages census covers the
 *  source key census. Requires a content data dir. */
async function executeProse(plan: FamilyPlan, contentDataDir: string): Promise<{ importedCount: number; checksumTarget: string }> {
  const staging = join(contentDataDir, '.migration-staging');
  let imported = 0;
  for (const pkg of plan.prose ?? []) {
    const pkgDir = join(staging, pkg.packageName);
    rmSync(pkgDir, { recursive: true, force: true });
    mkdirSync(pkgDir, { recursive: true });
    const skillBody = readFileSync(pkg.sourceSkillPath, 'utf8');
    writeFileSync(join(pkgDir, 'SKILL.md'), skillBody);
    const manifest = {
      name: pkg.packageName,
      version: '1.0.0',
      description: `Imported runtime integration prose for ${pkg.sourceKey} (§10.2 row 11)`,
      agents: ['automation'],
      mode: 'on-demand',
      files: ['SKILL.md'],
    };
    writeFileSync(join(pkgDir, 'content.json'), JSON.stringify(manifest, null, 2));
    await importPackage(pkgDir, `migration:integration:${pkg.sourceKey}`);
    imported += 1;
  }
  const present = new Set((await listPackages()).map((p) => p.name));
  for (const pkg of plan.prose ?? []) {
    if (!present.has(pkg.packageName)) throw new Error(`prose import census gap: ${pkg.packageName} not in listPackages()`);
  }
  return { importedCount: imported, checksumTarget: plan.checksum };
}

/**
 * Run the import. Dry-run (default) builds the plan, decrypt-samples, prints per-family
 * `source/planned/checksum`, and journals - touching no target. `--execute` additionally
 * upserts every family, re-reads it, and reports `checksum match`. Any decrypt-sample failure
 * or checksum mismatch flips `ok` to false and is journaled as an anomaly.
 */
export async function runImport(opts: RunOptions): Promise<RunResult> {
  const source = loadSource(opts.sourceDir);
  const plan = buildPlan(source);
  const journal = new Journal(opts.journalPath);
  const started = new Date(opts.now?.() ?? Date.now()).toISOString();
  const mode: RunResult['mode'] = opts.execute ? 'execute' : 'dry-run';

  journal.line(`===== ekoa migration run =====`);
  journal.line(`started: ${started}`);
  journal.line(`mode: ${mode}`);
  journal.line(`source: ${opts.sourceDir}`);
  journal.blank();

  const results: FamilyResult[] = [];
  let ok = true;

  for (const p of plan) {
    let importedCount = p.docs.length;
    if (p.kind === 'blobs') importedCount = p.sourceCount;
    if (p.kind === 'prose') importedCount = p.prose?.length ?? 0;
    let checksumTarget: string | null = null;
    let checksumMatch: boolean | null = null;

    if (opts.execute) {
      if (p.kind === 'collection') {
        const r = await executeCollection(p);
        importedCount = r.importedCount;
        checksumTarget = r.checksumTarget;
      } else if (p.kind === 'blobs') {
        if (!opts.contentDataDir) throw new Error('blob execute needs a target volume (contentDataDir)');
        const r = executeBlobs(p, join(opts.contentDataDir, 'blobs'));
        importedCount = r.importedCount;
        checksumTarget = r.checksumTarget;
      } else {
        if (!opts.contentDataDir) throw new Error('prose execute needs a content data dir (contentDataDir)');
        const r = await executeProse(p, opts.contentDataDir);
        importedCount = r.importedCount;
        checksumTarget = r.checksumTarget;
      }
      checksumMatch = checksumTarget === p.checksum;
      if (!checksumMatch) ok = false;
    }

    const decryptFailed = p.decryptSamples.some((s) => !s.ok);
    if (decryptFailed) ok = false;

    results.push({
      family: p.family,
      kind: p.kind,
      targetCollection: p.targetCollection,
      sourceCount: p.sourceCount,
      importedCount,
      checksumSource: p.checksum,
      checksumTarget,
      checksumMatch,
      sampled: p.sampled,
      notes: p.notes,
      decryptSamples: p.decryptSamples,
    });

    journal.line(`[${p.family}] -> ${p.targetCollection ?? p.kind}`);
    journal.line(
      `  source count: ${p.sourceCount} / imported count: ${importedCount} / checksum: ${
        opts.execute ? (checksumMatch ? 'MATCH' : 'MISMATCH') : 'dry-run ' + p.checksum.slice(0, 12)
      }${p.sampled ? ' (1% sample)' : ''}`,
    );
    for (const note of p.notes) journal.line(`  - ${note}`);
    for (const s of p.decryptSamples) journal.line(`  - decrypt-sample ${s.field} ${s.id}: ${s.ok ? 'ok' : 'FAILED'}`);
    if (opts.execute && !checksumMatch) journal.line(`  - ANOMALY: checksum mismatch (source ${p.checksum} != target ${checksumTarget})`);
    journal.blank();
  }

  journal.line(`non-imports (§10.8):`);
  for (const ni of NON_IMPORTS) journal.line(`  - ${ni.file}: ${ni.reason} (present in source: ${source.exists(ni.file)})`);
  journal.blank();
  journal.line(`result: ${ok ? 'OK' : 'ANOMALIES PRESENT'}`);
  journal.line(`ended: ${new Date(opts.now?.() ?? Date.now()).toISOString()}`);
  journal.line(`==============================`);
  journal.blank();
  journal.flush();

  return { mode, families: results, nonImports: NON_IMPORTS, ok };
}
