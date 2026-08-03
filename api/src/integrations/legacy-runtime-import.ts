/**
 * Boot import of the FROZEN legacy disk runtime tier into the tenant-scoped definition store
 * (slice A3; RUN_SPEC 20260801 assumption 3 + Rule 10, review date 2026-08-15 in
 * docs/decisions.md; REPORT-ONLY default per the A3 fresh-context review F2 — the deviation from
 * assumption 3 is journaled in docs/decisions.md 2026-08-03).
 *
 * Before A3, builder saves landed in ONE process-wide directory
 * (`<dataDir>/integrations/runtime/<key>/`) whose packages every org could effectively read —
 * their exact effective visibility was GLOBAL. Each legacy package can become ONE Mongo row with
 * `visibility: 'global'`, `origin: {kind: 'legacy-runtime'}`, owned by the reserved
 * `__legacy_runtime__` sentinel org/user (no real actor can own or collide with it — real org and
 * user ids are generated, and `definitionIdFor` hashes the orgId, so no tenant row collides).
 *
 * REPORT-ONLY BY DEFAULT (A3 review F2). Importing at boot silently RE-WIDENS what A2 narrowed: a
 * package unreachable to org B post-A2 becomes globally resolvable the moment this runs —
 * including its action baseUrls, which the origin-resolver seam turns into org B's
 * credential-egress allow-list, and its webhook-verification policy, which steers other orgs'
 * ingress. A silent boot-time global publish of author-less rows is not a decision software gets
 * to take for an operator. So: every boot RUNS this and reports what WOULD be imported (nothing
 * is silent in either direction), but PERSISTS nothing unless the operator sets
 * `EKOA_IMPORT_LEGACY_RUNTIME=1` (documented in docs/operations-runbook.md). Until then the
 * legacy packages resolve for NOBODY — an availability regression accepted over the silent leak.
 *
 * Closing the inherited leak after an import is a REVIEWED super-admin action through E1's
 * existing setVisibility surface (`global` → `org` confines a row to the sentinel org, i.e.
 * retires it) — and it is EXACTLY REVERSIBLE: sentinel-org rows stay super-admin-addressable in
 * every state (`isDefinitionVisibleTo`), so `org` → `global` restores (A3 review F1; the E1
 * precedent that demotion must be reversible, docs/decisions.md 2026-08-02).
 *
 * RULE-10 SHAPE — shadow, compare, cutover-or-remove:
 *   - SHADOW: once imported, the Mongo row is the live resolution (the registry's global tier);
 *     the disk directory stays on the box, frozen (nothing writes or serves it).
 *   - COMPARE: `origin.importHash` records the disk package's content hash at import. Every boot
 *     re-hashes the disk: unchanged → skip (idempotent, at-most-once effect per key); changed →
 *     a DRIFT report (something wrote a frozen tier — worth an operator's eyes), and the Mongo
 *     row is NEVER overwritten (it may have been edited or republished since — Mongo wins).
 *   - CUTOVER-OR-REMOVE: at the journaled review date the directory and this importer are
 *     deleted, or the decision is re-taken explicitly.
 *
 * DELIBERATELY NOT IMPORTED:
 *   - a key colliding with a shipped BASELINE package or `pipedream` (reported as drift, never
 *     silent). Assumption 2 keeps baseline a disk-only global tier; and post-A2 the registry
 *     already refuses to let a runtime package masquerade as a shipped key (review F1's collision
 *     case) — importing one as `global` would re-arm exactly that hijack, durably;
 *   - a second directory declaring an already-seen integrationKey (reported as `duplicate-key`,
 *     first directory wins — a distinct reason, not a fake "disk changed" drift);
 *   - a package with an invalid key or unreadable/keyless config.json (reported).
 *
 * NEVER FAILS BOOT: every filesystem read, the top-level directory scan included, lands problems
 * in the report instead of throwing (and the boot call site is belt-and-braces guarded too).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import {
  legacyRuntimeDir,
  reservedIntegrationKeys,
  type IntegrationPackageConfig,
} from './definitions.js';
import { fieldsFromPackageConfig } from './definition-save.js';
import {
  integrationDefinitionStore,
  definitionIdFor,
  IntegrationDefinitionStore,
  LEGACY_RUNTIME_ORG,
  LEGACY_RUNTIME_USER,
} from './definition-store.js';

// The sentinel constants live with the visibility predicate that enforces their special-casing
// (definition-store.ts); re-exported here for the importer's existing consumers.
export { LEGACY_RUNTIME_ORG, LEGACY_RUNTIME_USER };

/** The import runs as an explicit platform-level (super-admin) actor: minting a `global` row IS
 *  the reviewed platform action the decisions entry journals — and since the F2 fix it only ever
 *  acts behind the operator's explicit `EKOA_IMPORT_LEGACY_RUNTIME=1`. Module-private, and the
 *  importer itself is NOT re-exported from the integrations barrel (A3 review L2), so no route
 *  code can reach this ambient authority. */
const importActor: Actor = { userId: LEGACY_RUNTIME_USER, orgId: LEGACY_RUNTIME_ORG, role: 'super-admin' };

/** The operator opt-in that turns the boot run from report-only into a persisting import. */
export const LEGACY_IMPORT_OPT_IN_ENV = 'EKOA_IMPORT_LEGACY_RUNTIME';

export interface LegacyImportReport {
  /** `report-only` (the default) persists NOTHING; `import` is the operator's explicit opt-in. */
  mode: 'report-only' | 'import';
  imported: string[];
  /** Report-only mode: the keys an opted-in boot WOULD import (logged so the operator can act). */
  wouldImport: string[];
  skipped: string[];
  drift: Array<{ key: string; reason: 'disk-changed-after-import' | 'baseline-collision' | 'duplicate-key' }>;
  errors: Array<{ key: string; error: string }>;
}

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

function contentHash(configText: string, skillText: string): string {
  return createHash('sha256').update(configText).update('\0').update(skillText).digest('hex');
}

/**
 * Scan the legacy runtime tier: report on every boot, PERSIST only behind the operator opt-in
 * (`EKOA_IMPORT_LEGACY_RUNTIME=1`). Idempotent per key via the hash comparator; safe on a box
 * with no runtime directory (fresh install → empty report). Never throws for a bad package OR a
 * broken directory — neither must stop boot, so problems land in the report instead.
 */
export async function importLegacyRuntimePackages(
  store: IntegrationDefinitionStore = integrationDefinitionStore,
  now: () => Date = () => new Date(),
): Promise<LegacyImportReport> {
  const persist = process.env[LEGACY_IMPORT_OPT_IN_ENV] === '1';
  const report: LegacyImportReport = {
    mode: persist ? 'import' : 'report-only',
    imported: [], wouldImport: [], skipped: [], drift: [], errors: [],
  };
  const root = legacyRuntimeDir();
  if (!existsSync(root)) return report;

  const reserved = reservedIntegrationKeys();

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    // L1: an unreadable runtime directory (permissions, a file squatting on the path, a dead
    // mount) is an operator problem to REPORT, never a reason the platform does not come up.
    report.errors.push({
      key: '<runtime-root>',
      error: `unreadable legacy runtime directory ${root}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return report;
  }

  /** integrationKeys already handled THIS run — a second directory declaring the same key is a
   *  duplicate (L3), not a fake "disk changed after import" drift against the first one's row. */
  const seenKeys = new Set<string>();

  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const dir = join(root, d.name);
    const configPath = join(dir, 'config.json');
    if (!existsSync(configPath)) continue;

    let configText: string;
    let config: IntegrationPackageConfig;
    try {
      configText = readFileSync(configPath, 'utf8');
      config = JSON.parse(configText) as IntegrationPackageConfig;
    } catch (err) {
      report.errors.push({ key: d.name, error: `unreadable config.json: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    const key = config.integrationKey;
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      report.errors.push({ key: d.name, error: `missing or invalid integrationKey: ${JSON.stringify(key)}` });
      continue;
    }
    if (reserved.has(key)) {
      // A legacy package shadowing a SHIPPED key: post-A2 the registry already answers the shipped
      // package for this key, and importing the shadow as `global` would durably re-arm the F1
      // hijack. Reported, never silent — an operator can fork it under a new key if it mattered.
      console.warn(`[legacy-runtime-import] '${key}' collides with a shipped baseline key — NOT imported (see the A3 decision entry)`);
      report.drift.push({ key, reason: 'baseline-collision' });
      continue;
    }
    if (seenKeys.has(key)) {
      console.warn(`[legacy-runtime-import] directory '${d.name}' declares integrationKey '${key}' already claimed by an earlier directory this boot — NOT imported (duplicate-key)`);
      report.drift.push({ key, reason: 'duplicate-key' });
      continue;
    }
    seenKeys.add(key);

    const skillPath = join(dir, 'SKILL.md');
    let skillText = '';
    try {
      if (existsSync(skillPath)) skillText = readFileSync(skillPath, 'utf8');
    } catch {
      /* an unreadable SKILL.md imports as an empty body rather than blocking the package */
    }
    const hash = contentHash(configText, skillText);

    try {
      const existing = await store.getById(definitionIdFor(LEGACY_RUNTIME_ORG, key));
      if (existing) {
        if (existing.origin?.importHash === hash) {
          report.skipped.push(key);
        } else {
          // The frozen tier changed after import (or predates the hash). MONGO WINS — the row may
          // have been edited/republished since the import; report, never overwrite.
          console.warn(`[legacy-runtime-import] '${key}': disk package changed after import — Mongo row kept, disk drift reported`);
          report.drift.push({ key, reason: 'disk-changed-after-import' });
        }
        continue;
      }
      if (!persist) {
        // REPORT-ONLY (the default): say precisely what an opted-in boot would do, do nothing.
        report.wouldImport.push(key);
        continue;
      }
      const iso = now().toISOString();
      await store.create(
        {
          ...fieldsFromPackageConfig(config, skillText),
          orgId: LEGACY_RUNTIME_ORG,
          userId: LEGACY_RUNTIME_USER,
          visibility: 'global', // the tier's pre-A3 effective visibility — the operator opted in
          origin: { kind: 'legacy-runtime', importHash: hash, importedAt: iso },
          createdAt: iso,
          updatedAt: iso,
        },
        { actor: importActor },
      );
      report.imported.push(key);
    } catch (err) {
      report.errors.push({ key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (report.wouldImport.length > 0) {
    // The operator must not be silently broken EITHER WAY: name each package the default refused.
    console.warn(
      `[legacy-runtime-import] REPORT-ONLY: ${report.wouldImport.length} legacy runtime package(s) NOT imported ` +
      `(${report.wouldImport.join(', ')}). They currently resolve for nobody. Set ${LEGACY_IMPORT_OPT_IN_ENV}=1 ` +
      'to import them as global rows, or retire the directory (docs/operations-runbook.md, docs/decisions.md 2026-08-03).',
    );
  }
  return report;
}
