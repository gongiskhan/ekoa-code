/**
 * DOCX redline service.
 *
 * Edits existing Word documents with NATIVE Word Track Changes (w:ins/w:del,
 * attributed author + date) and NATIVE Word comments (word/comments.xml),
 * preserving original formatting. Backed by @adeu/core's RedlineEngine.
 *
 * Batch semantics are ATOMIC: applyRedline dry-runs the whole batch first and
 * commits only when every op resolves. A failed batch throws RedlineBatchError
 * carrying adeu's per-op failure messages verbatim (including the occurrence
 * lists and match_mode guidance for ambiguous strict targets) so callers can
 * surface them to the lawyer or the agent unchanged.
 */

import {
  BatchValidationError,
  DocumentObject,
  RedlineEngine,
  extractTextFromBuffer,
} from '@adeu/core';
import JSZip from 'jszip';
import {
  CommentResolutionError,
  captureCommentAnchors,
  repairCommentAnchors,
  setCommentThreadResolved,
} from './docx-comments.js';

// ---------------------------------------------------------------------------
// Types (field names aligned with adeu's process_batch DocumentChange union)
// ---------------------------------------------------------------------------

/**
 * Tracked text change. Delete = new_text: ''. Comment-only = new_text equal to
 * target_text plus a comment. Insertion of new paragraphs = new_text with \n
 * continuation lines after the (unchanged) anchor text: plain lines clone the
 * anchor paragraph pPr including numbering, a '# ' prefix maps to Heading1.
 * Never use '1.' markdown markers in inserted lines (maps to pStyle
 * ListNumber and breaks real numbering).
 */
export interface RedlineModifyOp {
  type: 'modify';
  target_text: string;
  new_text: string;
  comment?: string | null;
  match_mode?: 'strict' | 'first' | 'all';
}

/** Accept a pending tracked change by its Chg id from the projection. */
export interface RedlineAcceptOp {
  type: 'accept';
  target_id: string;
  comment?: string | null;
}

/** Reject a pending tracked change by its Chg id from the projection. */
export interface RedlineRejectOp {
  type: 'reject';
  target_id: string;
  comment?: string | null;
}

/** Reply in an existing comment thread by its Com id from the projection. */
export interface RedlineReplyOp {
  type: 'reply';
  target_id: string;
  text: string;
}

/**
 * Mark a comment thread resolved / reopened by its Com id from the projection.
 * NOT an adeu op - the engine has no such action; applied by docx-comments over
 * word/commentsExtended.xml inside the same atomic batch (see applyRedline).
 */
export interface RedlineResolveOp {
  type: 'resolve' | 'unresolve';
  target_id: string;
}

export type RedlineOp =
  | RedlineModifyOp
  | RedlineAcceptOp
  | RedlineRejectOp
  | RedlineReplyOp
  | RedlineResolveOp;

/** The subset adeu's process_batch understands - everything except resolve/unresolve. */
export type RedlineEngineOp =
  | RedlineModifyOp
  | RedlineAcceptOp
  | RedlineRejectOp
  | RedlineReplyOp;

/** Ops this wrapper applies itself; everything else goes to adeu's process_batch. */
function isResolveOp(op: RedlineOp): op is RedlineResolveOp {
  return op.type === 'resolve' || op.type === 'unresolve';
}

/** Per-edit entry of the adeu batch report. */
export interface RedlineEditReport {
  status: 'applied' | 'failed';
  target_text: string;
  new_text: string;
  warning: string | null;
  error: string | null;
  critic_markup: string | null;
  clean_text: string | null;
  pages?: number[];
  heading_path?: string;
  occurrences_modified?: number;
  match_mode?: string;
}

/** Shape of the report returned by RedlineEngine.process_batch. */
export interface RedlineReport {
  actions_applied: number;
  actions_skipped: number;
  actions_already_resolved: number;
  edits_applied: number;
  edits_skipped: number;
  occurrences_modified: number;
  skipped_details: string[];
  edits: RedlineEditReport[];
  engine: string;
  version: string;
  /** Added by this wrapper: comment threads whose resolved flag actually flipped. */
  resolutions_applied?: number;
  /** Added by this wrapper: resolve ops that were already in the requested state. */
  resolutions_unchanged?: number;
  /** Added by this wrapper: comment anchors the engine dropped and we restored. */
  comment_anchors_repaired?: number;
  /** Added by this wrapper: comments removed because the text they marked is gone. */
  comments_dropped?: number;
}

/** One failed op of a rejected batch. `error` is adeu's message verbatim. */
export interface RedlineOpFailure {
  /** 0-based index into the input ops array, or -1 when not attributable. */
  index: number;
  op?: RedlineOp;
  error: string;
}

export class RedlineBatchError extends Error {
  readonly failures: RedlineOpFailure[];

  constructor(failures: RedlineOpFailure[]) {
    const count = failures.length;
    super(
      `Redline batch rejected: ${count} op(s) failed; nothing was applied.\n` +
        failures.map((f) => f.error).join('\n'),
    );
    this.name = 'RedlineBatchError';
    this.failures = failures;
  }
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * CriticMarkup markdown projection of a DOCX buffer. Existing tracked changes
 * appear as {++...++}/{--...--} with {>>[Chg:n] author<<} annotations and
 * comments as {>>[Com:n] author @ date: text<<} - the ids are the target_id
 * values accept/reject/reply ops take.
 */
export async function projectDocx(buffer: Buffer): Promise<string> {
  return extractTextFromBuffer(buffer, false);
}

// ---------------------------------------------------------------------------
// Redline application (atomic batch)
// ---------------------------------------------------------------------------

/**
 * Map a BatchValidationError's error strings to per-op failures. Messages
 * look like "- Edit 3 Failed: ..." / "- Action 2 Failed: ..." with 1-based
 * positions into the ops array of the same kind.
 */
function failuresFromValidation(errors: string[], ops: RedlineEngineOp[]): RedlineOpFailure[] {
  const editIndexes = ops
    .map((op, i) => (op.type === 'modify' ? i : -1))
    .filter((i) => i >= 0);
  const actionIndexes = ops
    .map((op, i) => (op.type !== 'modify' ? i : -1))
    .filter((i) => i >= 0);
  return errors.map((error) => {
    const match = /^-?\s*(Edit|Action)\s+(\d+)\s/.exec(error);
    let index = -1;
    if (match) {
      const pos = Number(match[2]) - 1;
      const pool = match[1] === 'Edit' ? editIndexes : actionIndexes;
      if (pos >= 0 && pos < pool.length) {
        const mapped = pool[pos];
        if (mapped !== undefined) index = mapped;
      }
    }
    return { index, op: index >= 0 ? ops[index] : undefined, error };
  });
}

/**
 * Collect failures from a process_batch report. report.edits entries are in
 * input order of the modify ops; skipped actions surface via skipped_details.
 */
function failuresFromReport(report: RedlineReport, ops: RedlineEngineOp[]): RedlineOpFailure[] {
  const editIndexes = ops
    .map((op, i) => (op.type === 'modify' ? i : -1))
    .filter((i) => i >= 0);
  const failures: RedlineOpFailure[] = [];
  report.edits.forEach((edit, i) => {
    if (edit.status !== 'applied') {
      const index = i < editIndexes.length ? (editIndexes[i] ?? -1) : -1;
      failures.push({
        index,
        op: index >= 0 ? ops[index] : undefined,
        error: edit.error ?? `Edit failed without detail (target: ${edit.target_text})`,
      });
    }
  });
  if (report.actions_skipped > 0) {
    for (const detail of report.skipped_details) {
      failures.push({ index: -1, error: detail });
    }
  }
  return failures;
}

/**
 * Fresh plain copies of the ops for one process_batch pass. The engine
 * MUTATES the op objects it processes - it stashes _match_start_index and an
 * _active_mapper_ref (with live DOM nodes) on them and consumes those
 * positionally on the next pass. Feeding the dry-run's mutated ops to the
 * commit pass misplaces every edit, so each pass gets its own copies and the
 * caller's array is never touched. Underscore-prefixed keys are dropped for
 * the same reason: they are engine-internal, never caller input.
 */
function cleanOps(ops: RedlineEngineOp[]): RedlineEngineOp[] {
  return ops.map((op) => {
    const copy: Record<string, unknown> = { ...op };
    for (const key of Object.keys(copy)) {
      if (key.startsWith('_')) delete copy[key];
    }
    return copy as unknown as RedlineEngineOp;
  });
}

function runBatch(
  engine: RedlineEngine,
  ops: RedlineEngineOp[],
  dryRun: boolean,
): { report?: RedlineReport; failures: RedlineOpFailure[] } {
  let report: RedlineReport;
  try {
    report = engine.process_batch(cleanOps(ops), dryRun) as RedlineReport;
  } catch (err) {
    if (err instanceof BatchValidationError) {
      return { failures: failuresFromValidation(err.errors, ops) };
    }
    throw err;
  }
  return { report, failures: failuresFromReport(report, ops) };
}

/**
 * Apply a batch of redline ops to a DOCX buffer as native tracked changes and
 * comments attributed to `opts.author` (falls back to 'Ekoa' only when the
 * caller passes an empty author). When `opts.timestamp` is given it pins the
 * w:date of every revision.
 *
 * The whole batch is dry-run first on its own document instance; if ANY op
 * fails, RedlineBatchError is thrown with per-op failures (adeu's occurrence
 * guidance verbatim) and nothing is modified. Only a fully clean dry run is
 * committed, on a fresh load of the original buffer.
 */
export async function applyRedline(
  buffer: Buffer,
  ops: RedlineOp[],
  opts: { author: string; timestamp?: string },
): Promise<{ buffer: Buffer; report: RedlineReport }> {
  if (ops.length === 0) {
    throw new RedlineBatchError([{ index: -1, error: 'Empty batch: no ops to apply.' }]);
  }
  const author = opts.author.trim() || 'Ekoa';

  // Split the batch by owner. adeu's process_batch would reject an unknown op
  // type outright, and its Edit/Action failure positions count only the ops it
  // was given - so the engine sees ONLY its own ops and failure indexes are
  // mapped back to positions in the caller's array.
  const adeuEntries = ops
    .map((op, index) => ({ op, index }))
    .filter((e): e is { op: RedlineEngineOp; index: number } => !isResolveOp(e.op));
  const resolveEntries = ops
    .map((op, index) => ({ op, index }))
    .filter((e): e is { op: RedlineResolveOp; index: number } => isResolveOp(e.op));
  const adeuOps = adeuEntries.map((e) => e.op);
  const toCallerIndex = (failure: RedlineOpFailure): RedlineOpFailure => {
    if (failure.index >= 0 && failure.index < adeuEntries.length) {
      const entry = adeuEntries[failure.index];
      if (entry) return { ...failure, index: entry.index };
    }
    return { ...failure, index: -1 };
  };

  const makeEngine = async (): Promise<{ doc: DocumentObject; engine: RedlineEngine }> => {
    const doc = await DocumentObject.load(buffer);
    const engine = new RedlineEngine(doc, author);
    if (opts.timestamp) engine.timestamp = opts.timestamp;
    return { doc, engine };
  };

  /**
   * Resolve/unresolve pass. Runs AFTER the adeu ops on the same document so a
   * "reply then resolve" batch marks the reply done too, and so a missing
   * commentsExtended part is created on the already-edited document.
   */
  const runResolves = (doc: DocumentObject): { applied: number; unchanged: number; failures: RedlineOpFailure[] } => {
    let applied = 0;
    let unchanged = 0;
    const failures: RedlineOpFailure[] = [];
    for (const { op, index } of resolveEntries) {
      try {
        const result = setCommentThreadResolved(doc, op.target_id, op.type === 'resolve');
        if (result.changed) applied += 1;
        else unchanged += 1;
      } catch (err) {
        if (err instanceof CommentResolutionError) {
          failures.push({ index, op, error: err.message });
        } else {
          throw err;
        }
      }
    }
    return { applied, unchanged, failures };
  };

  // Dry run on a throwaway instance: a rejected batch must leave no trace.
  const dry = await makeEngine();
  const dryFailures: RedlineOpFailure[] = [];
  if (adeuOps.length > 0) {
    dryFailures.push(...runBatch(dry.engine, adeuOps, true).failures.map(toCallerIndex));
  }
  // The adeu dry run mutated nothing, so a resolve targeting a comment this
  // same batch would CREATE cannot validate here - callers never do that (the
  // new comment's id is unknown until it is written).
  dryFailures.push(...runResolves(dry.doc).failures);
  if (dryFailures.length > 0) {
    throw new RedlineBatchError(dryFailures);
  }

  // Commit on a fresh load so dry-run engine state cannot leak into the save.
  const commit = await makeEngine();
  const anchorsBefore = captureCommentAnchors(commit.doc);
  let report: RedlineReport | undefined;
  const commitFailures: RedlineOpFailure[] = [];
  if (adeuOps.length > 0) {
    const commitResult = runBatch(commit.engine, adeuOps, false);
    report = commitResult.report;
    commitFailures.push(...commitResult.failures.map(toCallerIndex));
    if (commitFailures.length === 0 && !report) {
      commitFailures.push({ index: -1, error: 'Batch produced no report on commit.' });
    }
  } else {
    report = emptyReport();
  }
  if (commitFailures.length > 0 || !report) {
    // A clean dry run makes this unreachable in practice; guard anyway so a
    // partially-mutated document is never returned.
    throw new RedlineBatchError(
      commitFailures.length > 0
        ? commitFailures
        : [{ index: -1, error: 'Batch produced no report on commit.' }],
    );
  }

  const resolved = runResolves(commit.doc);
  if (resolved.failures.length > 0) {
    throw new RedlineBatchError(resolved.failures);
  }
  report.resolutions_applied = resolved.applied;
  report.resolutions_unchanged = resolved.unchanged;

  // Accepting a tracked change drops the w:commentRangeStart/End + reference of
  // any comment anchored in that region, leaving an orphan record that no editor
  // can display. Restore the anchors the engine lost (see docx-comments).
  const repair = repairCommentAnchors(commit.doc, anchorsBefore);
  report.comment_anchors_repaired = repair.reanchored.length;
  report.comments_dropped = repair.dropped.length;

  const out = await commit.doc.save();
  return { buffer: out, report };
}

/** Report shape for a batch adeu never saw (resolve/unresolve ops only). */
function emptyReport(): RedlineReport {
  return {
    actions_applied: 0,
    actions_skipped: 0,
    actions_already_resolved: 0,
    edits_applied: 0,
    edits_skipped: 0,
    occurrences_modified: 0,
    skipped_details: [],
    edits: [],
    engine: 'ekoa-docx-comments',
    version: '1',
  };
}

// ---------------------------------------------------------------------------
// Accept all revisions (clean version)
// ---------------------------------------------------------------------------

/**
 * Accept every tracked change, returning the clean document a counterparty
 * would see. Comments are annotations, not revisions - they survive.
 */
export async function acceptAllRevisions(buffer: Buffer): Promise<Buffer> {
  const doc = await DocumentObject.load(buffer);
  const engine = new RedlineEngine(doc, 'Ekoa');
  engine.accept_all_revisions();
  return doc.save();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Basic DOCX integrity check: the ZIP container opens, the required parts
 * exist, and word/document.xml parses as XML (via the same loader the redline
 * engine uses, so "valid" here means "editable here").
 */
export async function validateDocx(buffer: Buffer): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  if (buffer.length === 0) {
    return { ok: false, issues: ['empty buffer'] };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    issues.push(`invalid ZIP container: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, issues };
  }

  if (!zip.file('[Content_Types].xml')) {
    issues.push('missing [Content_Types].xml part');
  }
  if (!zip.file('word/document.xml')) {
    issues.push('missing word/document.xml part');
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  try {
    await DocumentObject.load(buffer);
  } catch (err) {
    issues.push(
      `word/document.xml failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { ok: issues.length === 0, issues };
}
