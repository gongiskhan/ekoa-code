/**
 * Boot import of the FROZEN legacy disk runtime tier into the tenant-scoped definition store
 * (slice A3; RUN_SPEC 20260801 assumption 3 + Rule 10, review date 2026-08-15 in
 * docs/decisions.md).
 *
 * Before A3, builder saves landed in ONE process-wide directory
 * (`<dataDir>/integrations/runtime/<key>/`) whose packages every org could effectively read —
 * their exact effective visibility was GLOBAL. This importer preserves that reality with zero
 * regression while ending the tier: each legacy package becomes ONE Mongo row with
 * `visibility: 'global'`, `origin: {kind: 'legacy-runtime'}`, owned by the reserved
 * `__legacy_runtime__` sentinel org/user (no real actor can own or collide with it — real org and
 * user ids are generated, and `definitionIdFor` hashes the orgId, so no tenant row collides).
 * Closing the legacy leak later is a REVIEWED super-admin action through E1's existing
 * setVisibility surface (`global` → `org` confines a row to the sentinel org, i.e. retires it) —
 * never a silent break.
 *
 * RULE-10 SHAPE — shadow, compare, cutover-or-remove:
 *   - SHADOW: the Mongo row is the live resolution (the registry's global tier); the disk
 *     directory stays on the box, frozen (nothing writes or serves it).
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
 *   - a package with an invalid key or unreadable/keyless config.json (reported).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
} from './definition-store.js';

/** Sentinel tenant that owns imported legacy rows. Reserved: no real org/user id has this shape
 *  (real ids are generated), so the rows are manageable only by super-admins (the E1 gate). */
export const LEGACY_RUNTIME_ORG = '__legacy_runtime__';
export const LEGACY_RUNTIME_USER = '__legacy_runtime__';

/** The import runs as an explicit platform-level (super-admin) actor: minting a `global` row IS
 *  the reviewed platform action assumption 3 journals, and the store's global gate stays on. */
const importActor: Actor = { userId: LEGACY_RUNTIME_USER, orgId: LEGACY_RUNTIME_ORG, role: 'super-admin' };

export interface LegacyImportReport {
  imported: string[];
  skipped: string[];
  drift: Array<{ key: string; reason: 'disk-changed-after-import' | 'baseline-collision' }>;
  errors: Array<{ key: string; error: string }>;
}

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

function contentHash(configText: string, skillText: string): string {
  return createHash('sha256').update(configText).update('\0').update(skillText).digest('hex');
}

/**
 * Import every legacy runtime package exactly once. Idempotent per key via the hash comparator;
 * safe on a box with no runtime directory (fresh install → empty report). Never throws for a bad
 * package — a broken directory must not stop boot, so problems land in the report instead.
 */
export async function importLegacyRuntimePackages(
  store: IntegrationDefinitionStore = integrationDefinitionStore,
  now: () => Date = () => new Date(),
): Promise<LegacyImportReport> {
  const report: LegacyImportReport = { imported: [], skipped: [], drift: [], errors: [] };
  const root = legacyRuntimeDir();
  if (!existsSync(root)) return report;

  const reserved = reservedIntegrationKeys();

  for (const d of readdirSync(root, { withFileTypes: true })) {
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
      const iso = now().toISOString();
      await store.create(
        {
          ...fieldsFromPackageConfig(config, skillText),
          orgId: LEGACY_RUNTIME_ORG,
          userId: LEGACY_RUNTIME_USER,
          visibility: 'global', // the tier's exact effective visibility today — zero regression
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
  return report;
}
