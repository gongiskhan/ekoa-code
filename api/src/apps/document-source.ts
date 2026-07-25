/**
 * Document source service - the artifact document lifecycle for the
 * "edit an existing Word document" flow (document base v2).
 *
 * Each artifact can be linked to ONE source .docx. The service keeps two
 * blobs per app plus a metadata sidecar, colocated with the app's other
 * per-app data (the same `<EKOA_DATA_DIR>/app-data/{appId}` root app-files
 * uses):
 *
 *   <EKOA_DATA_DIR>/app-data/{appId}/docx/document-source.docx   (as ingested)
 *   <EKOA_DATA_DIR>/app-data/{appId}/docx/document-current.docx  (with redlines)
 *   <EKOA_DATA_DIR>/app-data/{appId}/docx/document-meta.json     ({fileName, origin, updatedAt})
 *
 * appFilesStore was deliberately NOT reused: it names blobs by server
 * UUID with an append-only metadata sidecar, so a stable "the document"
 * logical name would need an extra indirection and every re-link would
 * orphan a blob. Fixed well-known names under the same per-app dir are
 * simpler and restart-safe.
 *
 * Ported from ekoa-dev cortex/src/services/document-source.ts (2C-S2). The
 * appId path-safety guard is ekoa-code's app-files.ts ingress rule VERBATIM
 * (`collectionName.safeParse` + reject the reserved `usr.` scope), applied in
 * `docxDir()` - the SOLE place an app path is built, so it cannot be bypassed.
 * The pure track-changes engine lives in ../services/docx-redline.ts (2C-S1).
 * The ekoa-docx MCP tools (agent side) and the /api/app-docx routes
 * (served-app side) that drive this land in later 2C slices; both stay thin.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { collectionName } from '../data/collections-engine.js';
import { artifacts, users } from '../data/stores.js';
import { sanitizeFilename } from './app-files.js';
import {
  acceptAllRevisions,
  applyRedline,
  projectDocx,
  validateDocx,
  type RedlineOp,
  type RedlineReport,
} from '../services/docx-redline.js';

export interface DocumentSourceMeta {
  fileName: string;
  origin: string;
  updatedAt: string;
}

export interface DocumentSourceStatus {
  hasSource: boolean;
  fileName?: string;
  origin?: string;
  updatedAt?: string;
}

/** Thrown when an operation needs a linked document and the app has none. */
export class NoDocumentSourceError extends Error {
  constructor() {
    super('Nenhum documento Word está associado a esta aplicação.');
    this.name = 'NoDocumentSourceError';
  }
}

/**
 * 25 MB ceiling for a linked source document. Defined here (ekoa-code has not
 * ported dev's docx-fetch module) so the choke sits at the setSource ingress:
 * every ingest branch (path / url / provider) lands there, so an oversized
 * buffer can never be linked even when a fetch-side check was bypassed.
 */
export const DOCX_MAX_BYTES = 25 * 1024 * 1024;

/** The reserved shared-data scope prefix (app-files.ts). An id in this namespace
 *  is never a valid per-app path component. */
const SHARED_SCOPE_PREFIX = 'usr.';

const SOURCE_BLOB = 'document-source.docx';
const CURRENT_BLOB = 'document-current.docx';
const META_FILE = 'document-meta.json';

/** Operational data root (carried convention, mirrors app-files.ts): EKOA_DATA_DIR
 *  or ~/.ekoa/data, NEVER a path inside the repo. Read live so tests can point it
 *  at a temp dir. */
function dataDir(): string {
  return process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
}

/**
 * The SOLE builder of an app's docx directory: EVERY filesystem path in this
 * module goes through here, so the app-id path-safety guard cannot be bypassed.
 *
 * The rule is app-files.ts's ingress rule VERBATIM: the id must pass
 * `collectionName.safeParse` (charset `[a-zA-Z0-9._-]{1,100}`, no `__`/`usr.`
 * prefix) AND must not be in the reserved shared `usr.` namespace. The appId
 * becomes a path component, so an invalid or reserved id must never reach the
 * filesystem, whichever caller (MCP ctx or route header) supplied it. This
 * rejects traversal (`../…`, absolute paths - they carry `/` or `\`), `usr.<x>`,
 * and any out-of-charset id.
 */
export function docxDir(appId: string): string {
  if (!collectionName.safeParse(appId).success || appId.startsWith(SHARED_SCOPE_PREFIX)) {
    throw new Error(`invalid app id: ${appId}`);
  }
  return join(dataDir(), 'app-data', appId, 'docx');
}

/**
 * Per-app write serialization. setSource and applyEdits are read-modify-write
 * sequences over the same fixed blob names; two concurrent batches on one app
 * would both read the same "current" and the second save would silently drop
 * the first batch's tracked changes. Each app id gets an in-process promise
 * chain: a new operation tail-chains onto the previous one (running whether
 * it resolved or rejected) and the map entry is removed once the tail settles.
 */
const appWriteChains = new Map<string, Promise<void>>();

function withAppWriteLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const tail = appWriteChains.get(appId) ?? Promise.resolve();
  const run = tail.then(fn, fn);
  const settled = run.then(() => undefined, () => undefined);
  appWriteChains.set(appId, settled);
  void settled.then(() => {
    if (appWriteChains.get(appId) === settled) appWriteChains.delete(appId);
  });
  return run;
}

/** Crash-safe write: temp file in the same dir, then atomic rename. */
async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, data);
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function readMeta(appId: string): Promise<DocumentSourceMeta | null> {
  try {
    const raw = await readFile(join(docxDir(appId), META_FILE), 'utf8');
    const meta = JSON.parse(raw) as DocumentSourceMeta;
    if (typeof meta.fileName !== 'string') return null;
    return meta;
  } catch {
    return null;
  }
}

function ensureDocxName(raw: string): string {
  const name = sanitizeFilename(raw);
  return name.toLowerCase().endsWith('.docx') ? name : `${name}.docx`;
}

/**
 * Link a source document to the app. Validates the container first, then
 * stores source + current (identical initially) and the metadata sidecar.
 */
export async function setSource(
  appId: string,
  opts: { buffer: Buffer; fileName: string; origin: string },
): Promise<DocumentSourceStatus> {
  // Single choke point for the size cap: every ingest branch (path, url,
  // provider) lands here, so an oversized buffer can never be linked even
  // when the fetch-side checks were bypassed (e.g. a local attachment).
  if (opts.buffer.length > DOCX_MAX_BYTES) {
    throw new Error('O ficheiro excede o limite de 25 MB.');
  }
  const check = await validateDocx(opts.buffer);
  if (!check.ok) {
    throw new Error(
      `O ficheiro não é um documento Word (.docx) válido: ${check.issues.join('; ')}`,
    );
  }
  return withAppWriteLock(appId, async () => {
    const dir = docxDir(appId);
    await mkdir(dir, { recursive: true });
    const meta: DocumentSourceMeta = {
      fileName: ensureDocxName(opts.fileName),
      origin: opts.origin,
      updatedAt: new Date().toISOString(),
    };
    await writeAtomic(join(dir, SOURCE_BLOB), opts.buffer);
    await writeAtomic(join(dir, CURRENT_BLOB), opts.buffer);
    await writeAtomic(join(dir, META_FILE), JSON.stringify(meta, null, 2));
    return { hasSource: true, ...meta };
  });
}

export async function getStatus(appId: string): Promise<DocumentSourceStatus> {
  const meta = await readMeta(appId);
  if (!meta) return { hasSource: false };
  return { hasSource: true, ...meta };
}

/** The working document (source + applied redlines) as stored. */
export async function getCurrent(appId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const meta = await readMeta(appId);
  if (!meta) throw new NoDocumentSourceError();
  try {
    const buffer = await readFile(join(docxDir(appId), CURRENT_BLOB));
    return { buffer, fileName: meta.fileName };
  } catch {
    throw new NoDocumentSourceError();
  }
}

/** CriticMarkup markdown projection of the current document. */
export async function getProjection(appId: string): Promise<{ markdown: string; fileName: string }> {
  const { buffer, fileName } = await getCurrent(appId);
  return { markdown: await projectDocx(buffer), fileName };
}

/**
 * Clean version: every tracked change accepted (comments survive - they are
 * annotations, not revisions). Named `{base}-final.docx` for download.
 */
export async function getClean(appId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const { buffer, fileName } = await getCurrent(appId);
  const base = fileName.replace(/\.docx$/i, '');
  return { buffer: await acceptAllRevisions(buffer), fileName: `${base}-final.docx` };
}

/**
 * Attribution for edits made by a human through the served app. The served
 * app runs in an app-scoped context (X-Ekoa-App-Id, no JWT), so the author is
 * resolved SERVER-SIDE from the artifact owner - never trusted from the client,
 * which would let anyone forge who proposed a change or comment. Falls back to
 * "Ekoa" when the owner cannot be resolved.
 */
async function resolveOwnerAuthor(appId: string): Promise<string> {
  try {
    const art = await artifacts.get(appId);
    const ownerUserId = typeof art?.userId === 'string' ? art.userId : undefined;
    if (ownerUserId) {
      const user = await users.get(ownerUserId);
      if (user?.username) return user.username;
    }
  } catch {
    /* fall through to default */
  }
  return 'Ekoa';
}

/**
 * Apply a review batch made by a human in the served app's review surface
 * (accept/reject a tracked change, add a comment, reply to a comment thread).
 * Attribution is resolved from the artifact owner; the edit itself reuses the
 * same atomic, per-app-serialized pipeline as agent edits.
 */
export async function applyReview(
  appId: string,
  ops: RedlineOp[],
): Promise<{ report: RedlineReport; projection: string; fileName: string }> {
  const author = await resolveOwnerAuthor(appId);
  return applyEdits(appId, ops, { author });
}

/**
 * Discard every applied redline and re-derive the working document from the
 * PRISTINE source blob.
 *
 * This is the recourse behind the served app's "Repor original" action, and the
 * reason the source blob is kept untouched at all: accept/reject rewrite the
 * working copy in place and Word's own model has no undo once a revision is
 * resolved, so without this a single mis-click permanently discards a tracked
 * change from a contract. Runs under the same per-app write lock as every other
 * mutation, so it can never interleave with an in-flight batch.
 *
 * Destructive in the other direction (it drops accepted/rejected decisions and
 * comments added since the link), so the app confirms before calling it.
 */
export async function restoreSource(appId: string): Promise<{ projection: string; fileName: string }> {
  const meta = await readMeta(appId);
  if (!meta) throw new NoDocumentSourceError();
  return withAppWriteLock(appId, async () => {
    const dir = docxDir(appId);
    let source: Buffer;
    try {
      source = await readFile(join(dir, SOURCE_BLOB));
    } catch {
      throw new NoDocumentSourceError();
    }
    await writeAtomic(join(dir, CURRENT_BLOB), source);
    await writeAtomic(
      join(dir, META_FILE),
      JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2),
    );
    return { projection: await projectDocx(source), fileName: meta.fileName };
  });
}

/**
 * Apply an atomic redline batch to the current document and persist the
 * result. `dryRun` runs the exact same atomic pipeline but discards the
 * buffer, so a clean dry run guarantees the identical commit will apply.
 * Throws RedlineBatchError (per-op failures, adeu messages verbatim) when
 * any op fails - nothing is saved in that case.
 */
export async function applyEdits(
  appId: string,
  ops: RedlineOp[],
  opts: { author: string; dryRun?: boolean },
): Promise<{ report: RedlineReport; projection: string; fileName: string }> {
  return withAppWriteLock(appId, async () => {
    const { buffer, fileName } = await getCurrent(appId);
    const { buffer: edited, report } = await applyRedline(buffer, ops, { author: opts.author });
    if (!opts.dryRun) {
      await writeAtomic(join(docxDir(appId), CURRENT_BLOB), edited);
      const meta = await readMeta(appId);
      if (meta) {
        await writeAtomic(
          join(docxDir(appId), META_FILE),
          JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2),
        );
      }
    }
    return { report, projection: await projectDocx(edited), fileName };
  });
}
