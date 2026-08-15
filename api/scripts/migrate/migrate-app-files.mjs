#!/usr/bin/env node
/**
 * migrate-app-files (salomao migration S5) - operator tooling, not product code.
 *
 * Moves one app's uploaded-file store from the OLD stack (ekoa-dev / cortex) layout
 * to the REBUILT stack (ekoa-code) layout. The blob layout is identical; the
 * METADATA plane is not:
 *
 *   OLD (ekoa-dev cortex/src/persistence/app-files.ts:48-54,66-79): blobs at
 *     <dataDir>/app-data/<appId>/files/<uuid>; metadata rows in the reserved
 *     '__files' collection of the app-data store (FILES_COLLECTION, :21) - on the
 *     fs backend that is <dataDir>/app-data/<appId>/__files.json, a JSON ARRAY of
 *     items (cortex/src/persistence/app-data-fs.ts:41-43,72). Each row carries
 *     { id, name, size, type } (save(), app-files.ts:72-77) plus
 *     createdAt/updatedAt stamped by buildNewItem
 *     (cortex/src/persistence/app-data-backend.ts:54-61).
 *
 *   NEW (ekoa-code api/src/apps/app-files.ts:52-60,64-84): blobs at the SAME
 *     path, but each blob's metadata lives in a per-file {uuid}.json SIDECAR next
 *     to it, shaped exactly AppFileMeta { id, name, size, type, createdAt }
 *     (:31,:68-69). The reader (get(), :72-84) requires BOTH the sidecar and the
 *     blob - a raw blob copy without sidecars serves 404.
 *
 * So this tool copies the blobs and SYNTHESIZES each {uuid}.json sidecar from the
 * matching '__files' row. Field mapping, old row -> new sidecar (written in the
 * exact key order and serialization save() uses, app-files.ts:68-69, so a migrated
 * file and a later live upload are indistinguishable on disk):
 *
 *   id        <- row.id (must equal the blob filename; uuid-validated like
 *                isValidFileId, api/src/apps/app-files.ts:33-36 - a non-uuid id
 *                can never be served)
 *   name      <- sanitizeFilename(row.name ?? 'unnamed'). Both stacks share the
 *                IDENTICAL sanitize rule (old app-files.ts:43-46, new
 *                app-files.ts:41-44); re-applying it here is idempotent for
 *                fs-backend rows and guarantees the invariant for rows arriving
 *                via a mongo-backend dump. The ?? 'unnamed' default mirrors old
 *                toMeta (cortex app-files.ts:59).
 *   size      <- the ACTUAL blob byte length, NOT row.size. Both stacks serve
 *                Content-Length from meta.size (old cortex/src/routes/
 *                app-files.ts:100, new api/src/apps/app-files.ts:187); a row.size
 *                that disagrees with the pulled blob means the blob is truncated
 *                or corrupt relative to what prod served - refused as an
 *                integrity error unless --force (which writes the actual size,
 *                since Content-Length must match the bytes on disk).
 *   type      <- row.type ?? 'application/octet-stream' (old toMeta default,
 *                cortex app-files.ts:61)
 *   createdAt <- row.createdAt ?? '' (old toMeta default, cortex app-files.ts:62).
 *                updatedAt and every other row field are DROPPED - not part of
 *                AppFileMeta (api/src/apps/app-files.ts:31).
 *
 * Inputs (--src is READ-ONLY; no DB, no network, no product imports):
 *   --src <dir>       the old app's app-data dir. Metadata is found either as
 *                     <src>/__files.json (fs-backend collection file; a missing
 *                     main with a __files.json.tmp present is READ from the .tmp
 *                     in place, mirroring app-data-fs.ts:60-70 crash recovery
 *                     without the rename - src stays untouched), or as exactly one
 *                     top-level *.json dump OBJECT carrying the __files collection
 *                     ({ collections: { __files: [...] } } or { __files: [...] }).
 *                     Bare-array *.json files other than __files.json are ordinary
 *                     app-data collections and are NEVER treated as file metadata.
 *   --app-id <id>     target app id - becomes a path component and the serve-URL
 *                     segment, so it is charset-checked like the serving admission
 *                     (api/src/data/collections-engine.ts:26-29 via
 *                     api/src/apps/app-files.ts:110): [a-zA-Z0-9._-]{1,100}, not
 *                     starting with '__' or 'usr.'.
 *   --data-dir <dir>  new-stack data root; default resolved exactly the way
 *                     api/src/config.ts:342 (and app-files.ts:50) resolves it:
 *                     EKOA_DATA_DIR || ~/.ekoa/data.
 *   --dry-run         plan + report + refuse exactly like a real run; write nothing.
 *   --allow-orphans   proceed past orphan blobs/rows/unexpected entries,
 *                     reporting and skipping them.
 *   --force           overwrite differing target content and accept row/blob size
 *                     mismatches (actual blob size wins in the sidecar).
 *
 * The plan is computed IN FULL before the first write: any refusal writes nothing
 * (all-or-nothing, so a half-migrated file store cannot exist). Re-running over an
 * already-migrated target is a no-op ("unchanged"). Exit codes: 0 ok, 1
 * refusal/error, 2 usage.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Same uuid rule as api/src/apps/app-files.ts:33 (and cortex app-files.ts:31). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same charset rule as collectionName (api/src/data/collections-engine.ts:26-29). */
const APP_ID_RE = /^[a-zA-Z0-9._-]{1,100}$/;

/** Identical display-name sanitize rule both file stores share
 *  (ekoa-code api/src/apps/app-files.ts:41-44; cortex app-files.ts:43-46). */
export function sanitizeFilename(raw) {
  const safe = String(raw).replace(/[^\p{L}\p{N}._\-() ]/gu, '_').substring(0, 200).trim();
  return safe || 'unnamed';
}

/** Default data root, resolved the way api/src/config.ts:342 resolves it. */
export function defaultDataDir() {
  return process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Pull a __files row array out of a parsed top-level *.json dump OBJECT, or null. */
function rowsFromDumpObject(parsed) {
  if (!isPlainObject(parsed)) return null;
  if (isPlainObject(parsed.collections) && Array.isArray(parsed.collections.__files)) {
    return parsed.collections.__files;
  }
  if (Array.isArray(parsed.__files)) return parsed.__files;
  return null;
}

/**
 * Locate + parse the '__files' metadata rows inside --src. Returns
 * { rows, source, notes }. Throws (refusal) when no metadata source is found or
 * more than one dump file carries __files rows. Read-only.
 */
export function loadFileRows(srcDir) {
  const notes = [];
  const direct = join(srcDir, '__files.json');
  const directTmp = `${direct}.tmp`;

  let rows = null;
  let source = null;
  if (existsSync(direct)) {
    rows = JSON.parse(readFileSync(direct, 'utf8'));
    source = '__files.json';
  } else if (existsSync(directTmp)) {
    // fs-backend crash recovery reads the .tmp when the main file is missing
    // (cortex/src/persistence/app-data-fs.ts:60-70); src is read-only here, so we
    // read the .tmp in place instead of renaming it.
    rows = JSON.parse(readFileSync(directTmp, 'utf8'));
    source = '__files.json.tmp (crash-recovery read; src untouched)';
    notes.push('__files.json missing; read __files.json.tmp in place (app-data-fs.ts crash recovery, without the rename)');
  }

  // Dump-JSON fallback: exactly one top-level *.json OBJECT carrying __files.
  const dumpCandidates = [];
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('.tmp')) continue;
    if (entry.name === '__files.json') continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(srcDir, entry.name), 'utf8'));
    } catch {
      continue; // not this tool's problem; ordinary collections may be anything
    }
    const dumpRows = rowsFromDumpObject(parsed);
    if (dumpRows) dumpCandidates.push({ name: entry.name, rows: dumpRows });
  }

  if (rows !== null) {
    if (dumpCandidates.length > 0) {
      notes.push(`ignored dump file(s) also carrying __files (${dumpCandidates.map((c) => c.name).join(', ')}): __files.json is the live store and wins`);
    }
  } else if (dumpCandidates.length === 1) {
    rows = dumpCandidates[0].rows;
    source = `${dumpCandidates[0].name} (dump, collections.__files)`;
  } else if (dumpCandidates.length > 1) {
    throw new Error(`ambiguous metadata: no __files.json and ${dumpCandidates.length} dump files carry a __files collection (${dumpCandidates.map((c) => c.name).join(', ')}) - remove all but one`);
  } else {
    throw new Error(`no '__files' metadata found in ${srcDir} (expected __files.json, __files.json.tmp, or one *.json dump carrying collections.__files)`);
  }

  if (!Array.isArray(rows)) {
    throw new Error(`metadata source ${source} is not a JSON array of rows`);
  }
  return { rows, source, notes };
}

/**
 * Plan + (unless dryRun / refused) execute the migration. Pure fs, all-or-nothing:
 * the full plan (including every refusal) is computed before the first write.
 */
export function migrateAppFiles(opts) {
  const srcDir = resolve(opts.srcDir);
  const appId = String(opts.appId ?? '');
  const dryRun = Boolean(opts.dryRun);
  const allowOrphans = Boolean(opts.allowOrphans);
  const force = Boolean(opts.force);

  if (!APP_ID_RE.test(appId) || appId.startsWith('__') || appId.startsWith('usr.')) {
    throw new Error(`invalid --app-id "${appId}" (must match [a-zA-Z0-9._-]{1,100} and not start with '__' or 'usr.' - collections-engine.ts:26-29)`);
  }
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
    throw new Error(`--src ${srcDir} is not a directory`);
  }

  const dataDir = resolve(opts.dataDir || defaultDataDir());
  // Target layout: <dataDir>/app-data/<appId>/files/{uuid}[.json]
  // (api/src/apps/app-files.ts:52-60).
  const targetDir = join(dataDir, 'app-data', appId, 'files');
  const srcFilesDir = join(srcDir, 'files');
  if (resolve(srcFilesDir) === targetDir) {
    throw new Error('src and target resolve to the same files directory - refusing (src is read-only)');
  }

  const { rows, source: metaSource, notes } = loadFileRows(srcDir);

  // Row census: id-keyed map, refusing conflicting duplicates outright.
  const rowById = new Map();
  const invalidRows = [];
  for (const row of rows) {
    if (!isPlainObject(row) || typeof row.id !== 'string' || !UUID_RE.test(row.id)) {
      invalidRows.push(`row with missing/non-uuid id: ${JSON.stringify(row).slice(0, 120)}`);
      continue;
    }
    const prev = rowById.get(row.id);
    if (prev && JSON.stringify(prev) !== JSON.stringify(row)) {
      throw new Error(`conflicting duplicate '__files' rows for id ${row.id} - fix the source before migrating`);
    }
    rowById.set(row.id, row);
  }

  // Blob census. Old-layout files/ holds ONLY uuid-named blobs (verified pull:
  // 91 blobs, 0 *.json sidecars); {uuid}.json entries mean a new-shape source and
  // are ignored (the '__files' rows stay authoritative), anything else is
  // unmigratable and gates like an orphan.
  const blobIds = [];
  const unexpectedEntries = [];
  let sidecarLikeCount = 0;
  if (existsSync(srcFilesDir)) {
    for (const entry of readdirSync(srcFilesDir, { withFileTypes: true })) {
      if (entry.isFile() && UUID_RE.test(entry.name)) blobIds.push(entry.name);
      else if (entry.isFile() && entry.name.endsWith('.json') && UUID_RE.test(entry.name.slice(0, -'.json'.length))) sidecarLikeCount++;
      else unexpectedEntries.push(entry.name + (entry.isDirectory() ? '/' : ''));
    }
  }
  if (sidecarLikeCount > 0) notes.push(`${sidecarLikeCount} {uuid}.json entr(ies) in src files/ ignored (new-shape sidecars; '__files' rows stay authoritative)`);
  blobIds.sort();

  const blobIdSet = new Set(blobIds);
  const orphanBlobs = blobIds.filter((id) => !rowById.has(id));
  const orphanRows = [...rowById.keys()].filter((id) => !blobIdSet.has(id)).sort();

  // Per-pair plan: read the blob, synthesize the sidecar, diff against the target.
  const sizeMismatches = [];
  const conflicts = [];
  const pairs = [];
  for (const id of blobIds) {
    const row = rowById.get(id);
    if (!row) continue;
    const bytes = readFileSync(join(srcFilesDir, id));
    if (typeof row.size === 'number' && Number.isFinite(row.size) && row.size !== bytes.length) {
      sizeMismatches.push({ id, rowSize: row.size, blobSize: bytes.length });
    }
    // Sidecar in the exact shape + key order save() writes (app-files.ts:68-69).
    const meta = {
      id,
      name: sanitizeFilename(row.name ?? 'unnamed'),
      size: bytes.length,
      type: typeof row.type === 'string' && row.type ? row.type : 'application/octet-stream',
      createdAt: String(row.createdAt ?? ''),
    };
    const sidecarJson = JSON.stringify(meta);

    const targetBlob = join(targetDir, id);
    const targetSidecar = join(targetDir, `${id}.json`);
    let blobAction = 'copy';
    if (existsSync(targetBlob)) {
      if (readFileSync(targetBlob).equals(bytes)) blobAction = 'unchanged';
      else { blobAction = 'overwrite'; conflicts.push({ id, kind: 'blob' }); }
    }
    let sidecarAction = 'copy';
    if (existsSync(targetSidecar)) {
      if (readFileSync(targetSidecar, 'utf8') === sidecarJson) sidecarAction = 'unchanged';
      else { sidecarAction = 'overwrite'; conflicts.push({ id, kind: 'sidecar' }); }
    }
    pairs.push({ id, bytes, sidecarJson, blobAction, sidecarAction });
  }

  // Refusals - all computed before any write.
  const refusals = [];
  if (!allowOrphans) {
    for (const id of orphanBlobs) refusals.push(`orphan blob (no '__files' metadata row): ${id}`);
    for (const id of orphanRows) refusals.push(`orphan row (no blob in files/): ${id}`);
    for (const r of invalidRows) refusals.push(`invalid ${r}`);
    for (const e of unexpectedEntries) refusals.push(`unexpected entry in files/ (not a uuid blob): ${e}`);
  }
  if (!force) {
    for (const m of sizeMismatches) refusals.push(`size mismatch for ${m.id}: '__files' row says ${m.rowSize} byte(s), blob is ${m.blobSize} - blob may be truncated/corrupt (Content-Length is served from meta.size)`);
    for (const c of conflicts) refusals.push(`target ${c.kind} for ${c.id} already exists with DIFFERENT content`);
  }

  const result = {
    ok: refusals.length === 0,
    dryRun,
    metaSource,
    targetDir,
    notes,
    refusals,
    orphanBlobs,
    orphanRows,
    invalidRows,
    unexpectedEntries,
    sizeMismatches,
    conflicts,
    counts: {
      rows: rows.length,
      blobs: blobIds.length,
      pairs: pairs.length,
      copied: 0,
      overwritten: 0,
      unchanged: 0,
      bytesWritten: 0,
      orphanBlobs: orphanBlobs.length,
      orphanRows: orphanRows.length,
    },
  };
  if (!result.ok) return result;

  // Execute (or account, when dryRun). Writes are tmp+rename in the target dir so
  // a crash never leaves a half-written blob/sidecar under a servable name
  // (the write-atomic convention of app-data-fs.ts:75-81).
  const writeAtomic = (path, data) => {
    const tmp = `${path}.tmp-migrate`;
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  };
  let dirEnsured = false;
  for (const pair of pairs) {
    const writesBlob = pair.blobAction !== 'unchanged';
    const writesSidecar = pair.sidecarAction !== 'unchanged';
    if (!writesBlob && !writesSidecar) { result.counts.unchanged++; continue; }
    if (pair.blobAction === 'overwrite' || pair.sidecarAction === 'overwrite') result.counts.overwritten++;
    else result.counts.copied++;
    if (!dryRun) {
      if (!dirEnsured) { mkdirSync(targetDir, { recursive: true }); dirEnsured = true; }
      if (writesBlob) writeAtomic(join(targetDir, pair.id), pair.bytes);
      if (writesSidecar) writeAtomic(join(targetDir, `${pair.id}.json`), pair.sidecarJson);
    }
    if (writesBlob) result.counts.bytesWritten += pair.bytes.length;
    if (writesSidecar) result.counts.bytesWritten += Buffer.byteLength(pair.sidecarJson);
  }
  return result;
}

// ------------------------------ CLI ------------------------------

const USAGE = 'usage: migrate-app-files.mjs --src <old app-data dir> --app-id <target app id> [--data-dir <dir>] [--dry-run] [--allow-orphans] [--force]\n';

function parseArgs(argv) {
  const opts = { srcDir: undefined, appId: undefined, dataDir: undefined, dryRun: false, allowOrphans: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') opts.srcDir = argv[++i];
    else if (a === '--app-id') opts.appId = argv[++i];
    else if (a === '--data-dir') opts.dataDir = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--allow-orphans') opts.allowOrphans = true;
    else if (a === '--force') opts.force = true;
    else return null;
  }
  if (!opts.srcDir || !opts.appId) return null;
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (!opts) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const result = migrateAppFiles(opts);
  const tag = result.dryRun ? 'migrate-app-files (dry-run)' : 'migrate-app-files';
  const out = [];
  out.push(`${tag}: ${resolve(opts.srcDir)} -> ${result.targetDir} (app ${opts.appId})`);
  out.push(`  metadata: ${result.metaSource} (${result.counts.rows} row(s)); blobs: ${result.counts.blobs}`);
  for (const n of result.notes) out.push(`  note: ${n}`);
  const reportList = (label, items) => {
    if (items.length === 0) return;
    out.push(`  ${label}: ${items.length}`);
    for (const it of items) out.push(`    - ${typeof it === 'string' ? it : JSON.stringify(it)}`);
  };
  reportList("orphan blobs (no '__files' row)", result.orphanBlobs);
  reportList('orphan rows (no blob)', result.orphanRows);
  reportList('invalid rows', result.invalidRows);
  reportList('unexpected entries in files/', result.unexpectedEntries);

  if (!result.ok) {
    process.stdout.write(out.join('\n') + '\n');
    process.stderr.write(`${tag}: REFUSING - nothing written:\n`);
    for (const r of result.refusals) process.stderr.write(`  - ${r}\n`);
    process.stderr.write('  (--allow-orphans skips orphans; --force overwrites differing targets / accepts size mismatches)\n');
    process.exit(1);
  }

  const c = result.counts;
  out.push(`  ${result.dryRun ? 'would write' : 'written'}: ${c.copied} copied, ${c.overwritten} overwritten, ${c.unchanged} unchanged (${c.bytesWritten} byte(s))`);
  if (c.orphanBlobs || c.orphanRows || result.invalidRows.length || result.unexpectedEntries.length) {
    out.push(`  skipped as orphans (--allow-orphans): ${c.orphanBlobs} blob(s), ${c.orphanRows} row(s), ${result.invalidRows.length} invalid row(s), ${result.unexpectedEntries.length} unexpected entr(ies)`);
  }
  process.stdout.write(out.join('\n') + '\n');
}

// Run as CLI only when invoked directly (importable as a module for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`migrate-app-files: ERROR - ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
