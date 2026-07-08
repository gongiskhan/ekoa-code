/**
 * Canonical-projection checksums for the migration verification step (ch10 §10.3 rule 4).
 *
 * Each store's importer ends by re-reading its target and printing
 * `source count / imported count / checksum match`. The checksum is a sha256 over a
 * CANONICAL JSON projection of the produced docs: keys sorted recursively, and the
 * ciphertext + rewritten-path fields EXCLUDED (they are transformed by design - re-encrypted
 * under the carried key, or rewritten to storage-relative keys - so hashing them would make a
 * faithful import look like a mismatch). The `_rev` bookkeeping field the collections engine
 * stamps on write is likewise excluded so the source-side plan and the re-read target hash to
 * the same value. Stores above the 10k threshold checksum a deterministic 1% sample (every
 * 100th doc by sorted `_id`) and verify counts exactly (§10.3 rule 4).
 *
 * No api/src import: this is standalone operator tooling run via node/ts-node, not part of the
 * deployed service bundle.
 */
import { createHash } from 'node:crypto';

/** A produced target document (the migration writes `{ _id, ... }` shapes). */
export type PlainDoc = Record<string, unknown> & { _id: string };

/** Bookkeeping field the collections engine stamps on write; never part of the identity hash. */
const REV_FIELD = '_rev';

/** Stores above this record count checksum a deterministic 1% sample (§10.3 rule 4). */
export const SAMPLE_THRESHOLD = 10_000;

/** Recursively sort object keys so equal documents serialize to identical strings. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonicalize(src[k]);
    return out;
  }
  return value;
}

/** Project one doc for hashing: drop `_rev` and the excluded (ciphertext/path) fields, then
 *  canonicalize the remainder. */
export function projectDoc(doc: PlainDoc, excludeFields: readonly string[]): unknown {
  const out: Record<string, unknown> = {};
  const exclude = new Set([REV_FIELD, ...excludeFields]);
  for (const [k, v] of Object.entries(doc)) {
    if (exclude.has(k)) continue;
    out[k] = v;
  }
  return canonicalize(out);
}

/** sha256 of one doc's canonical projection. */
export function hashDoc(doc: PlainDoc, excludeFields: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(projectDoc(doc, excludeFields))).digest('hex');
}

export interface StoreChecksum {
  checksum: string;
  /** Whether the store exceeded the threshold and only a 1% sample was hashed. */
  sampled: boolean;
  /** How many docs actually entered the hash (all, or the 1% sample). */
  hashedCount: number;
}

/**
 * Deterministic store-level checksum. Docs are sorted by `_id` first (so ordering in the
 * source file never affects the hash), then either all are hashed or - above SAMPLE_THRESHOLD -
 * every 100th (~1%). The per-doc hashes are folded in order into one sha256.
 */
export function storeChecksum(docs: readonly PlainDoc[], excludeFields: readonly string[]): StoreChecksum {
  const sorted = [...docs].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const sampled = sorted.length > SAMPLE_THRESHOLD;
  const selected = sampled ? sorted.filter((_, i) => i % 100 === 0) : sorted;
  const h = createHash('sha256');
  for (const d of selected) h.update(hashDoc(d, excludeFields));
  return { checksum: h.digest('hex'), sampled, hashedCount: selected.length };
}
