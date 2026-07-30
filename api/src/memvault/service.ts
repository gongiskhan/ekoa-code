/**
 * memvault service (slice E2): the four capability ops — writeNote/readNote/listNotes/
 * deleteNote — over the jailed file store, with a per-call audit trail. Every call writes
 * ONE activity row (the single audit path, data/activity.ts) AND emits one structured
 * console line {ts, userId, keyId?, xClient?, op, permalink?, verdict, ms}.
 *
 * Verdicts: ok | denied (contract-invalid derived permalink) | jail_violation (charset or
 * symlink escape caught by the jail) | not_found. Tenancy discipline: a jail violation and
 * a cross-tenant/missing note are BOTH answered as the uniform NOT_FOUND by the router —
 * the wire never distinguishes "escaped", "someone else's" and "absent" (scoped.ts
 * philosophy); the audit trail is where the difference lands.
 *
 * E3 seams (search/export): both are read-only consumers of store.listNotes/readNote over
 * the stock basic-memory on-disk format — no service state to migrate.
 */
import { NotePermalink, type NoteListQuery, type WriteNoteRequest } from '@ekoa/shared';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';
import { JailViolationError } from './jail.js';
import * as store from './store.js';

export type { StoredNote, StoredNoteMeta } from './store.js';

/** Key principal marker (res.locals.apiKeyPrincipal) — present only on key-admitted calls. */
export interface MemvaultPrincipal {
  keyId: string;
  xClient?: string;
}

export type MemvaultVerdict = 'ok' | 'denied' | 'jail_violation' | 'not_found';

export type MemvaultResult<T> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'VALIDATION_FAILED' };

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

/** `Reunião do cliente!` -> `reuniao-do-cliente` (permalink-grammar-safe, never empty). */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-_]+/, '')
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
  // slugified title can still overflow the 512-char ceiling).
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
    return { ok: true, value: note };
  } catch (e) {
    if (e instanceof JailViolationError) {
      await audit(ctx, 'write', permalink, 'jail_violation', t0);
      return { ok: false, code: 'NOT_FOUND' };
    }
    throw e;
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
    if (e instanceof JailViolationError) {
      await audit(ctx, 'read', permalink, 'jail_violation', t0);
      return { ok: false, code: 'NOT_FOUND' };
    }
    throw e;
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
    if (e instanceof JailViolationError) {
      await audit(ctx, 'list', undefined, 'jail_violation', t0);
      return { ok: false, code: 'NOT_FOUND' };
    }
    throw e;
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
    return { ok: true, value: { ok: true } };
  } catch (e) {
    if (e instanceof JailViolationError) {
      await audit(ctx, 'delete', permalink, 'jail_violation', t0);
      return { ok: false, code: 'NOT_FOUND' };
    }
    throw e;
  }
}
