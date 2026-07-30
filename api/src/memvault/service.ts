/**
 * memvault service (slice E2): the four capability ops — writeNote/readNote/listNotes/
 * deleteNote — over the jailed file store, with a per-call audit trail. Every call writes
 * ONE activity row (the single audit path, data/activity.ts) AND emits one structured
 * console line {ts, userId, keyId?, xClient?, op, permalink?, verdict, ms}.
 *
 * Verdicts: ok | denied (any contract refusal — a derived permalink that overflows, AND the
 * router-level schema rejections, which is where traversal payloads die and which used to leave
 * no trace at all: E2 review F3) | jail_violation (charset or symlink escape caught by the jail)
 * | not_found | index_failed (best-effort index maintenance) | error (an unexpected store
 * failure). Tenancy discipline: a jail violation and a cross-tenant/missing note are BOTH
 * answered as the uniform NOT_FOUND by the router — the wire never distinguishes "escaped",
 * "someone else's" and "absent" (scoped.ts philosophy); the audit trail is where the difference
 * lands. NOTHING reaches the caller unaudited: every op funnels its failure through `guard`.
 *
 * Slice E3 adds the two remaining ops over the same on-disk format:
 *   - searchNotes, backed by the PER-TENANT FTS index (fts.ts, one db file per user). Writes
 *     and deletes now maintain that index, but ONLY AFTER the markdown has landed and only on
 *     a best-effort basis: an index failure can never fail a write, it emits its own
 *     `index_failed` audit line, and the next search's rebuild-from-markdown recovers.
 *   - exportVault, which streams the caller's markdown as a tar. The derived `.index/` is not
 *     filtered out of it — it is invisible to the walk the export is built on.
 */
import { NOTE_PERMALINK_SEGMENT_MAX, NotePermalink, type NoteListQuery, type NoteSearchRequest, type WriteNoteRequest } from '@ekoa/shared';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';
import * as fts from './fts.js';
import { JailViolationError } from './jail.js';
import * as store from './store.js';

export type { StoredNote, StoredNoteMeta } from './store.js';

/** Key principal marker (res.locals.apiKeyPrincipal) — present only on key-admitted calls. */
export interface MemvaultPrincipal {
  keyId: string;
  xClient?: string;
}

export type MemvaultVerdict = 'ok' | 'denied' | 'jail_violation' | 'not_found' | 'index_failed' | 'error';

export type MemvaultRefusal = 'NOT_FOUND' | 'VALIDATION_FAILED' | 'INTERNAL';

export type MemvaultResult<T> = { ok: true; value: T } | { ok: false; code: MemvaultRefusal };

interface CallContext {
  actor: ActivityActor;
  deps: LogActivityDeps;
  principal?: MemvaultPrincipal | undefined;
}

async function audit(ctx: CallContext, op: string, permalink: string | undefined, verdict: MemvaultVerdict, t0: number): Promise<void> {
  const ms = Date.now() - t0;
  const key = ctx.principal ? { keyId: ctx.principal.keyId, ...(ctx.principal.xClient ? { xClient: ctx.principal.xClient } : {}) } : {};
  await logActivity(ctx.actor, 'memvault', `memvault_${op}`, ctx.deps, {
    op,
    verdict,
    ms,
    ...(permalink ? { permalink } : {}),
    ...key,
  });
  // One structured line per call (operational trace beside the durable activity row).
  console.log(
    JSON.stringify({ ts: new Date(ctx.deps.now()).toISOString(), userId: ctx.actor.userId, ...key, op, ...(permalink ? { permalink } : {}), verdict, ms }),
  );
}

/**
 * The ONE failure funnel for every op. A jail violation becomes the uniform NOT_FOUND; ANY
 * other throw (ENAMETOOLONG, ENOSPC, EACCES, a bug) becomes an audited `error` + an INTERNAL
 * envelope. Before this existed, a non-jail store failure was re-thrown out of the service,
 * past a router with no try/catch, into an Express stack with no terminal error middleware —
 * so a contract-VALID write answered HTTP 500 as an HTML stack trace carrying absolute server
 * paths, and left NO audit row at all (E2 review F1).
 */
async function guard(ctx: CallContext, op: string, permalink: string | undefined, e: unknown, t0: number): Promise<{ ok: false; code: MemvaultRefusal }> {
  if (e instanceof JailViolationError) {
    await audit(ctx, op, permalink, 'jail_violation', t0);
    return { ok: false, code: 'NOT_FOUND' };
  }
  await audit(ctx, op, permalink, 'error', t0);
  // Server-side only: the message may name absolute paths, so it never reaches the wire.
  console.error('[memvault]', op, e instanceof Error ? e.message : e);
  return { ok: false, code: 'INTERNAL' };
}

/**
 * Audit a refusal that never reached an op — a router-level schema rejection. Traversal
 * payloads (`../../etc/passwd`, `folder=../fora`, …) are refused by zod BEFORE any service call,
 * so without this the highest-signal security events on this surface produced a 400 and total
 * silence in the audit trail (E2 review F3). `attempt` is attacker-controlled text: it is
 * length-capped and only ever recorded, never resolved.
 */
export async function auditDenied(ctx: CallContext, op: string, attempt: string | undefined): Promise<void> {
  await audit(ctx, op, attempt ? attempt.slice(0, 128) : undefined, 'denied', Date.now());
}

/**
 * Best-effort index maintenance. The markdown is already durable at this point, so a failure
 * here is NOT a failed call: it gets its own audit row + console line, and the op stays ok.
 *
 * But "best effort" is only honest if the drift actually heals, and simply swallowing the error
 * did NOT heal it (E3 review): a valid-but-stale index opens cleanly and probes non-empty, so
 * every later search under-reported the user's OWN vault, forever, across restarts. So a failed
 * maintain now DISCARDS the index (fts.invalidate deletes the file); the next search rebuilds
 * from the markdown. Trading one rebuild for a permanently wrong answer is the right side of
 * that deal for a derived cache.
 *
 * A jail refusal is audited as `jail_violation`, not `index_failed` — a database symlinked at
 * another tenant's index is a security event, not an index hiccup — and nothing is deleted,
 * because the file it names is not ours.
 */
async function maintainIndex(ctx: CallContext, op: 'index' | 'unindex', permalink: string, run: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await run();
  } catch (e) {
    if (e instanceof JailViolationError) {
      await audit(ctx, op, permalink, 'jail_violation', t0);
      return;
    }
    await audit(ctx, op, permalink, 'index_failed', t0);
    try {
      await fts.invalidate(ctx.actor.userId);
    } catch {
      // Even the discard failed (or was refused by the jail). The index file is then whatever
      // it was; the ONLY promise still standing is the one that matters — the markdown is
      // correct — and fts.acquire re-checks corruption/emptiness on every cache miss.
    }
  }
}

/**
 * `Reunião do cliente!` -> `reuniao-do-cliente` (permalink-grammar-safe, never empty).
 * The slug is capped at NOTE_PERMALINK_SEGMENT_MAX: a title may be 300 chars, one path
 * component may not (E2 review F1 — the uncapped derivation reached the store and blew up with
 * ENAMETOOLONG). Truncation happens BEFORE the trailing-separator strip so a cut mid-word never
 * leaves a '-' at the end.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, NOTE_PERMALINK_SEGMENT_MAX)
    .replace(/[-_]+$/, '');
  return slug || 'note';
}

export async function writeNote(
  ctx: CallContext,
  input: WriteNoteRequest,
): Promise<MemvaultResult<store.StoredNote>> {
  const t0 = Date.now();
  const permalink = input.permalink ?? (input.folder ? `${input.folder}/${slugifyTitle(input.title)}` : slugifyTitle(input.title));
  // The DERIVED permalink re-validates against the contract grammar (a valid folder + a
  // slugified title can still overflow the 512-char total, and a caller-supplied folder may
  // itself carry an over-long segment).
  if (!NotePermalink.safeParse(permalink).success) {
    await audit(ctx, 'write', permalink.slice(0, 128), 'denied', t0);
    return { ok: false, code: 'VALIDATION_FAILED' };
  }
  try {
    const note = await store.writeNote(
      ctx.actor.userId,
      { permalink, title: input.title, tags: input.tags ?? [], type: input.type ?? 'note', contentMd: input.contentMd },
      new Date(ctx.deps.now()).toISOString(),
    );
    await audit(ctx, 'write', permalink, 'ok', t0);
    // Markdown first, index after: the write is already committed and answered as ok.
    await maintainIndex(ctx, 'index', permalink, () => fts.indexNote(ctx.actor.userId, note));
    return { ok: true, value: note };
  } catch (e) {
    return guard(ctx, 'write', permalink, e, t0);
  }
}

export async function readNote(ctx: CallContext, permalink: string): Promise<MemvaultResult<store.StoredNote>> {
  const t0 = Date.now();
  try {
    const note = await store.readNote(ctx.actor.userId, permalink);
    if (!note) {
      await audit(ctx, 'read', permalink, 'not_found', t0);
      return { ok: false, code: 'NOT_FOUND' };
    }
    await audit(ctx, 'read', permalink, 'ok', t0);
    return { ok: true, value: note };
  } catch (e) {
    return guard(ctx, 'read', permalink, e, t0);
  }
}

export async function listNotes(
  ctx: CallContext,
  query: NoteListQuery,
): Promise<MemvaultResult<{ items: store.StoredNoteMeta[]; nextCursor?: string }>> {
  const t0 = Date.now();
  try {
    const page = await store.listNotes(ctx.actor.userId, query);
    await audit(ctx, 'list', undefined, 'ok', t0);
    return { ok: true, value: page };
  } catch (e) {
    return guard(ctx, 'list', undefined, e, t0);
  }
}

export async function deleteNote(ctx: CallContext, permalink: string): Promise<MemvaultResult<{ ok: true }>> {
  const t0 = Date.now();
  try {
    const deleted = await store.deleteNote(ctx.actor.userId, permalink);
    if (!deleted) {
      await audit(ctx, 'delete', permalink, 'not_found', t0);
      return { ok: false, code: 'NOT_FOUND' };
    }
    await audit(ctx, 'delete', permalink, 'ok', t0);
    await maintainIndex(ctx, 'unindex', permalink, () => fts.removeNote(ctx.actor.userId, permalink));
    return { ok: true, value: { ok: true } };
  } catch (e) {
    return guard(ctx, 'delete', permalink, e, t0);
  }
}

/**
 * Search THIS caller's notes (slice E3). The index is per-user by construction (fts.ts), so
 * there is no tenant predicate to get wrong here. A missing or corrupt index is not an error:
 * fts.ts rebuilds it from the markdown and answers. A failure that even the rebuild could not
 * recover is audited (`index_failed`) and answered as a 500 envelope — NEVER as an empty
 * result, which would lie to the caller about their own vault.
 */
export async function searchNotes(ctx: CallContext, input: NoteSearchRequest): Promise<MemvaultResult<{ hits: fts.NoteHit[] }>> {
  const t0 = Date.now();
  try {
    const hits = await fts.search(ctx.actor.userId, input.query, input.limit ?? 20);
    await audit(ctx, 'search', undefined, 'ok', t0);
    return { ok: true, value: { hits } };
  } catch (e) {
    if (e instanceof JailViolationError) {
      await audit(ctx, 'search', undefined, 'jail_violation', t0);
      return { ok: false, code: 'NOT_FOUND' };
    }
    await audit(ctx, 'search', undefined, 'index_failed', t0);
    return { ok: false, code: 'INTERNAL' };
  }
}

/**
 * Export THIS caller's vault as a tar of markdown (slice E3). Two phases on purpose: the files
 * are collected first (so a refusal is still a clean envelope), and only then does `openSink`
 * run — the route uses it to set the binary headers at the last possible moment. The `.index/`
 * database is absent because the walk never sees it, not because anything filtered it.
 */
export async function exportVault(
  ctx: CallContext,
  openSink: () => NodeJS.WritableStream,
): Promise<MemvaultResult<store.TarResult>> {
  const t0 = Date.now();
  let files: store.VaultFile[];
  try {
    files = await store.collectVaultFiles(ctx.actor.userId);
  } catch (e) {
    return guard(ctx, 'export', undefined, e, t0);
  }
  const result = await store.streamTar(files, openSink());
  await audit(ctx, 'export', undefined, 'ok', t0);
  return { ok: true, value: result };
}
