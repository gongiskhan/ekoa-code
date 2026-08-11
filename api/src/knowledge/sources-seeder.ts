/**
 * Knowledge sources seeder (WS8b, extended WS8c). Ports the default Portuguese legal crawl
 * sources into ekoa-code's `knowledge_sources` collection so the Sources tab is not empty on a
 * fresh boot, and so the crawler (WS8c) has something to run against.
 *
 * ID CONTINUITY (WS8c, decided deliberately — see `docs/dev-parity.md`): each entry's `id` is the
 * REAL id ekoa-dev's own runtime state (`~/.ekoa/data/knowledge/sources.json`) already assigns
 * that source, not a freshly-minted one. The crawl ledger (`crawl/ledger.ts`) is keyed by source
 * id and lives at `<dataDir>/knowledge/ledger/<sourceId>.json` — matching the id means a
 * pre-existing ledger file (199MB / 14 files on the machine this was verified against, backing
 * the real 262k-document `_shared` corpus) is picked up automatically: the crawler sees hundreds
 * of thousands of pages already `ok` with validators and does an incremental refresh, never a
 * fresh crawl of the whole corpus from a cold ledger. A different id would silently orphan that
 * history and make the FIRST "Atualizar" click attempt to re-fetch every page live. On a machine
 * with no such history (CI, a fresh deploy) this is simply an empty ledger, identical to any new
 * source — the id choice costs nothing there.
 *
 * This seeds SOURCE METADATA + crawl POLICY (levels/maxPages/scope/render/userAgent/seeds/domino)
 * — WS8c's `api/src/knowledge/crawl/` modules are what actually execute it. The 262k-document
 * `_shared` corpus these sources describe was imported offline (ch04 §4.4.1) and already lives in
 * the vault; seeding these rows does not touch it.
 *
 * Mirrors `api/src/apps/featured-seeder.ts`'s shape (read a versioned JSON asset, own the
 * bootstrap super-admin, deterministic-id idempotent insert) and ekoa-dev's
 * `cortex/src/services/knowledge-seed.ts` (per-entry `seedId` idempotency, safe re-run every
 * boot). Unlike featured-seeder's *artifacts* (org-agnostic, one global catalog), a knowledge
 * source is `orgId`-scoped in this multi-tenant build (`listSources` filters by `actor.orgId`),
 * so the rows are seeded under ONE org - the bootstrap super-admin's - the same "owner of
 * global/system-ish rows" convention featured-seeder already uses (`superAdmin?.orgId ?? 'system'`).
 * That is also the org the operator logs in as, so the Sources tab is populated for exactly the
 * account that reported it empty.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeSources, users } from '../data/stores.js';
import type { KnowledgeSourceDoc, DominoSourceConfig, SeedTemplate } from './service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The seed file is untrusted JSON on disk, so `kind` is narrowed to the doc's own union here
 *  rather than trusted as a bare string: a typo in the seed would otherwise persist a source kind
 *  no crawler will ever recognise, and it would only surface much later as a source that silently
 *  never runs. An unrecognised value is dropped to undefined (the anchor-crawl default). */
type SeedSourceKind = NonNullable<KnowledgeSourceDoc['kind']>;
const SEED_SOURCE_KINDS: readonly SeedSourceKind[] = ['crawl', 'api', 'domino'];
function narrowSeedKind(value: string | undefined): SeedSourceKind | undefined {
  return SEED_SOURCE_KINDS.includes(value as SeedSourceKind) ? (value as SeedSourceKind) : undefined;
}

interface SeedSourceEntry {
  /** Stable id (WS8c) — see the module doc's "ID CONTINUITY" note. Falls back to a deterministic
   *  `knowledge-seed:<orgId>:<seedId>` id when absent (a hand-added seed entry with no known
   *  upstream id). */
  id?: string;
  seedId: string;
  label?: string;
  url: string;
  collection?: string;
  kind?: string;
  levels?: number;
  maxPages?: number;
  scope?: 'same-domain' | 'any';
  enabled?: boolean;
  render?: boolean;
  userAgent?: string;
  seeds?: string[];
  seedTemplate?: SeedTemplate | null;
  domino?: DominoSourceConfig;
  /** An honest reason this entry seeds `enabled: false` (e.g. a wholesale failure on its last
   *  live run this build could not diagnose offline) — never fabricated, present only when true. */
  disabledReason?: string;
  /** Legacy WS8b free-form escape hatch — still accepted so an older seed file keeps working, but
   *  superseded by the typed fields above and no longer written by `sources.seed.json`. */
  crawlConfig?: Record<string, unknown>;
}

interface SeedFile {
  version: number;
  description?: string;
  sources: SeedSourceEntry[];
}

export interface SeedSourcesResult {
  inserted: number;
  skipped: number;
  total: number;
  orgId: string | null;
}

/** Resolves from BOTH api/src/knowledge and api/dist/knowledge - assets/ sits at the api package
 *  root (identical climb to featuredArtifactsDir in apps/featured-seeder.ts). */
export function knowledgeSourcesSeedPath(): string {
  return process.env.EKOA_KNOWLEDGE_SOURCES_SEED_FILE || join(__dirname, '..', '..', 'assets', 'knowledge', 'sources.seed.json');
}

/** The bootstrap super-admin's org - the same fallback featured-seeder.ts uses for org-agnostic
 *  seeded rows that this multi-tenant build still requires an `orgId` for. */
async function getSuperAdminOrgId(): Promise<string | null> {
  const rows = await users.find({ role: 'super-admin', active: true });
  const sa = rows[0];
  return sa ? ((sa.orgId as string) ?? 'system') : null;
}

/** @param overridePath test hook only - production callers must not pass it. */
export async function seedKnowledgeSources(overridePath?: string): Promise<SeedSourcesResult> {
  const path = overridePath ?? knowledgeSourcesSeedPath();
  const result: SeedSourcesResult = { inserted: 0, skipped: 0, total: 0, orgId: null };
  if (!existsSync(path)) return result;

  let seed: SeedFile;
  try {
    seed = JSON.parse(await readFile(path, 'utf-8')) as SeedFile;
  } catch (err) {
    console.error('[knowledge-sources-seeder] failed to read seed file:', err instanceof Error ? err.message : err);
    return result;
  }
  if (!seed || !Array.isArray(seed.sources)) {
    console.error('[knowledge-sources-seeder] invalid seed file (missing sources array)');
    return result;
  }
  result.total = seed.sources.length;

  const orgId = await getSuperAdminOrgId();
  if (!orgId) return result; // no super-admin yet (e.g. a boot before EKOA_ADMIN_* is set) - next boot retries
  result.orgId = orgId;

  for (const entry of seed.sources) {
    if (!entry.seedId) {
      result.skipped++;
      continue;
    }
    // Prefer the REAL upstream id (ledger/vault continuity — module doc); fall back to a
    // deterministic namespaced id for a seed entry with no known upstream id, which still can
    // never collide with an organically-created source's generated id.
    const id = entry.id || `knowledge-seed:${orgId}:${entry.seedId}`;
    const kind = narrowSeedKind(entry.kind);
    const doc: KnowledgeSourceDoc = {
      _id: id,
      orgId,
      url: entry.url,
      seedId: entry.seedId,
      enabled: entry.enabled ?? true,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.collection ? { collection: entry.collection } : {}),
      ...(entry.levels !== undefined ? { levels: entry.levels } : {}),
      ...(entry.maxPages !== undefined ? { maxPages: entry.maxPages } : {}),
      ...(entry.scope ? { scope: entry.scope } : {}),
      ...(entry.render !== undefined ? { render: entry.render } : {}),
      ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
      ...(entry.seeds && entry.seeds.length ? { seeds: entry.seeds } : {}),
      ...(entry.seedTemplate ? { seedTemplate: entry.seedTemplate } : {}),
      ...(entry.domino ? { domino: entry.domino } : {}),
      ...(entry.disabledReason ? { disabledReason: entry.disabledReason } : {}),
      ...(kind ? { kind } : {}),
      ...(entry.crawlConfig ? { crawlConfig: entry.crawlConfig } : {}),
    };
    const created = await knowledgeSources.insert(doc as never);
    if (created) result.inserted++;
    else result.skipped++;
  }

  return result;
}
