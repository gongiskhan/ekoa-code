/**
 * ad-broker/service.ts — the Meta Ad Library search data source behind POST /api/v1/ad-broker/search.
 *
 * ============================ DETERMINISTIC STUB (no real Meta call) ============================
 * This is a STUB, on purpose (FLOW_PLAN assumption D1): this repo holds no Meta Graph credentials,
 * and the actor that consumes this endpoint must be correct independently of the data source. The
 * stub synthesises a fixed, query-derived result set from a seeded PRNG so that:
 *   - the SAME (query, cursor) always yields a BYTE-IDENTICAL page  (retry idempotency), and
 *   - a cursor is BOUND to the query that minted it (a foreign cursor is rejected, not silently
 *     re-based against a different result set).
 *
 * -------------------------------- FUTURE SWAP (real Meta Graph) --------------------------------
 * Replace ONLY the body of `searchAds()` with a call to the Meta Graph Ad Library
 * (`graph.facebook.com/.../ads_archive`) via `guardedFetch` (api/src/services/url-fetcher.ts — the
 * sanctioned SSRF-guarded outbound path; graph.facebook.com is public and passes the guard). Keep
 * the SAME `searchAds(req): AdSearchResponse` signature and the SAME opaque-cursor contract: map
 * Meta's `paging.cursors.after` INTO our base64url cursor on the way out and back on the way in,
 * and translate upstream failures to `UPSTREAM_FAILED` (502) / `UPSTREAM_UNAVAILABLE` (503) via
 * `AdBrokerError`. Nothing else in the slice (router, contract, tests, cursor codec shape) changes.
 * ================================================================================================
 */
import type { AdRecord, AdSearchRequest, AdSearchResponse, ErrorCode } from '@ekoa/shared';

/** Domain error translated to the shared envelope by the router (mirrors KnowledgeError). */
export class AdBrokerError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'AdBrokerError';
  }
}

// --- Deterministic primitives ------------------------------------------------------------

/** FNV-1a over a string → unsigned 32-bit. Cheap, stable, no crypto strength needed (this is a
 *  result-set seed + a cursor↔query binding tag, not a security control). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: pure function of its seed → deterministic 0..1 sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The query's identity: everything that shapes the result set (NOT pageSize/cursor). Used both as
 *  the PRNG seed and as the cursor↔query binding tag. */
function queryHash(req: AdSearchRequest): number {
  const canonical = [
    req.searchTerms ?? '',
    req.advertiserName ?? '',
    req.countryCode,
    req.dateFrom ?? '',
    req.dateTo ?? '',
    req.activeStatus,
  ].join('');
  return fnv1a(canonical);
}

// --- Opaque cursor codec (base64url of {v,off,h}) ----------------------------------------

interface CursorState {
  v: 1;
  off: number;
  h: number;
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

/** Decode a caller-supplied cursor and verify it belongs to THIS query. A malformed token
 *  (not base64url/JSON, wrong version, bad offset) OR a foreign token (minted for a different
 *  query, so `h` mismatches) is a 400 VALIDATION_FAILED — never a silent re-base. */
function decodeCursor(cursor: string, expectedHash: number): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new AdBrokerError('VALIDATION_FAILED', 'Cursor inválido.');
  }
  const c = parsed as Partial<CursorState> | null;
  if (
    !c || typeof c !== 'object' ||
    c.v !== 1 ||
    typeof c.off !== 'number' || !Number.isInteger(c.off) || c.off < 0 ||
    c.h !== expectedHash
  ) {
    throw new AdBrokerError('VALIDATION_FAILED', 'Cursor inválido ou não corresponde à pesquisa.');
  }
  return c.off;
}

// --- Record synthesis --------------------------------------------------------------------

const ADVERTISERS = ['Nova Media Lda', 'Atlas Retail', 'Costa & Filhos', 'Brilho Cosméticos', 'Verde Energia', 'Porto Digital', 'Marca Azul', 'Onda Studios'];
const PLATFORMS = ['facebook', 'instagram', 'audience_network', 'messenger'];
const WORDS = ['promoção', 'desconto', 'novo', 'edição', 'limitada', 'grátis', 'agora', 'exclusivo', 'campanha', 'oferta'];
const DAY_MS = 86_400_000;

/** One record, a pure function of (query, hash, absolute index). Independent of page boundaries,
 *  so a page is byte-identical regardless of how the caller paginated to it. */
function makeRecord(req: AdSearchRequest, hash: number, index: number): AdRecord {
  const rnd = mulberry32((hash ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;

  // Advertiser lookups return that advertiser; keyword searches spread across a synthetic pool.
  const advertiserName = req.advertiserName ?? pick(ADVERTISERS);

  // startDate lands inside [dateFrom, dateTo] when both are given; otherwise a stable default window.
  let fromMs = req.dateFrom ? Date.parse(`${req.dateFrom}T00:00:00Z`) : Date.parse('2023-01-01T00:00:00Z');
  let toMs = req.dateTo ? Date.parse(`${req.dateTo}T00:00:00Z`) : Date.parse('2024-12-31T00:00:00Z');
  if (req.dateFrom && !req.dateTo) toMs = fromMs + 180 * DAY_MS;
  if (!req.dateFrom && req.dateTo) fromMs = toMs - 180 * DAY_MS;
  if (toMs < fromMs) toMs = fromMs;
  const startMs = fromMs + Math.floor(rnd() * (toMs - fromMs + 1));
  const startDate = new Date(startMs).toISOString().slice(0, 10);

  const isActive = req.activeStatus === 'active' ? true : req.activeStatus === 'inactive' ? false : rnd() < 0.5;
  // A still-running ad may have no endDate; otherwise it ends on/after startDate.
  const endDate = isActive && rnd() < 0.5 ? null : new Date(startMs + Math.floor(rnd() * 90) * DAY_MS).toISOString().slice(0, 10);

  const platformCount = 1 + Math.floor(rnd() * PLATFORMS.length);
  const publisherPlatforms = PLATFORMS.slice(0, platformCount);
  const creativeBody = `${pick(WORDS)} ${pick(WORDS)} ${req.searchTerms ?? advertiserName}`.trim();
  const adId = `${hash.toString(36)}-${index}`;

  return {
    id: adId,
    advertiserName,
    pageId: String(100_000_000 + (fnv1a(advertiserName) % 900_000_000)),
    snapshotUrl: `https://www.facebook.com/ads/library/?id=${adId}`,
    creativeBody,
    countryCode: req.countryCode,
    isActive,
    startDate,
    endDate,
    publisherPlatforms,
  };
}

// --- Public entry point ------------------------------------------------------------------

/**
 * Search the (stubbed) Ad Library. Deterministic in (query, cursor): identical inputs yield an
 * identical page and cursor. Throws `AdBrokerError('VALIDATION_FAILED')` on a malformed/foreign
 * cursor. Total result count is a stable function of the query (20..250 records).
 */
export function searchAds(req: AdSearchRequest): AdSearchResponse {
  const hash = queryHash(req);
  const total = 20 + (hash % 231); // deterministic per query, 20..250
  const off = req.cursor ? decodeCursor(req.cursor, hash) : 0;
  const end = Math.min(off + req.pageSize, total);

  const records: AdRecord[] = [];
  for (let i = off; i < end; i++) records.push(makeRecord(req, hash, i));

  const nextCursor = end < total ? encodeCursor({ v: 1, off: end, h: hash }) : null;
  return { records, nextCursor };
}
