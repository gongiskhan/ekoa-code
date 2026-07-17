/**
 * Session sheets - readers + writers over the SESSIONS store (Part B decision B.B): sheets
 * persist as subdocuments on the session record, no new collection. Legacy sessions carry no
 * `sheets` field; the READ path derives a one-sheet-per-assistant-message view at read time
 * (no backfill). A write (rename / new revision) against a derived sheet MATERIALISES it as a
 * subdocument first - the derived revision becomes the sheet's first, `editSource: 'agent'` -
 * so the deterministic derived ids stay stable across the transition.
 */
import { sessions, messages, type SessionDoc, type SessionSheetDoc, type SheetRevisionDoc } from './stores.js';
import type { Doc } from './store.js';

export interface SheetDeps {
  now: () => number;
  genId: () => string;
}

type MessageRow = Doc & { sessionId?: string; role?: string; content?: unknown; timestamp?: string };

const DERIVED_SHEET_PREFIX = 'sheet-';

/** Deterministic id of the read-time derived sheet for one assistant message. */
export const derivedSheetId = (messageId: string): string => `${DERIVED_SHEET_PREFIX}${messageId}`;

/** Derived sheet title: the first non-empty line of the markdown, heading markers stripped. */
function sheetTitleFrom(content: string): string {
  const firstLine = content
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0);
  return (firstLine ?? 'Folha').slice(0, 80);
}

/** The read-time derived view of one assistant message as a one-revision sheet, or null when
 *  the row is not a sheet-bearing message (non-assistant, or empty/non-string content). */
function deriveSheet(m: MessageRow): SessionSheetDoc | null {
  if (m.role !== 'assistant' || typeof m.content !== 'string' || !m.content.trim()) return null;
  return {
    sheetId: derivedSheetId(m._id),
    title: sheetTitleFrom(m.content),
    createdFromMessageId: m._id,
    revisions: [
      {
        revisionId: `rev-${m._id}`,
        content: m.content,
        createdAt: m.timestamp ?? new Date(0).toISOString(),
        editSource: 'agent',
      },
    ],
  };
}

/**
 * READ path: the session's sheets in transcript order. Stored subdocuments are canonical; any
 * assistant message NOT already covered by a stored sheet (matched on `createdFromMessageId`)
 * contributes a derived one-revision view at its transcript position. A legacy session (no
 * `sheets` field at all) therefore reads as one sheet per assistant message - decision B.B's
 * no-backfill rule. `preloaded` lets a caller that already holds the ordered transcript
 * (agents/context.ts loadHistory) skip the second messages read.
 */
export async function listSessionSheets(session: SessionDoc, preloaded?: MessageRow[]): Promise<SessionSheetDoc[]> {
  const rows = preloaded ?? ((await messages.find({ sessionId: session._id }, { timestamp: 1 })) as MessageRow[]);
  const stored = session.sheets ?? [];
  const storedByMessageId = new Map(stored.map((s) => [s.createdFromMessageId, s]));
  const out: SessionSheetDoc[] = [];
  const emitted = new Set<string>();
  for (const m of rows) {
    const canonical = storedByMessageId.get(m._id);
    if (canonical) {
      out.push(canonical);
      emitted.add(canonical.sheetId);
      continue;
    }
    const derived = deriveSheet(m);
    if (derived) out.push(derived);
  }
  // A stored sheet whose source message is not in the transcript (defensive) keeps stored order.
  for (const s of stored) if (!emitted.has(s.sheetId)) out.push(s);
  return out;
}

/** Resolve a sheet id to its derived view when it is not yet materialised. Only deterministic
 *  derived ids (`sheet-<messageId>`) are resolvable; anything else is unknown. */
async function deriveById(session: SessionDoc, sheetId: string): Promise<SessionSheetDoc | null> {
  if (!sheetId.startsWith(DERIVED_SHEET_PREFIX)) return null;
  const messageId = sheetId.slice(DERIVED_SHEET_PREFIX.length);
  const m = (await messages.get(messageId)) as MessageRow | null;
  if (!m || m.sessionId !== session._id) return null;
  return deriveSheet(m);
}

/**
 * WRITER core: mutate one sheet on the session record under the store's CAS. The derived-sheet
 * materialisation candidate is resolved BEFORE the CAS (the mutator must stay synchronous);
 * inside the CAS a stored sheet wins over the seed, so a concurrent materialisation is not
 * doubled. Returns the updated sheet, or null when the sheet (or session) does not exist.
 */
async function mutateSheet(
  sessionId: string,
  sheetId: string,
  deps: SheetDeps,
  mutate: (sheet: SessionSheetDoc) => SessionSheetDoc,
): Promise<SessionSheetDoc | null> {
  const session = await sessions.get(sessionId);
  if (!session) return null;
  const alreadyStored = (session.sheets ?? []).some((s) => s.sheetId === sheetId);
  const seed = alreadyStored ? null : await deriveById(session, sheetId);
  if (!alreadyStored && !seed) return null; // unknown sheet - uniform not-found upstream
  let result: SessionSheetDoc | null = null;
  await sessions.update(sessionId, (cur) => {
    const sheets = [...(cur.sheets ?? [])];
    let idx = sheets.findIndex((s) => s.sheetId === sheetId);
    if (idx < 0 && seed) {
      sheets.push(seed);
      idx = sheets.length - 1;
    }
    if (idx < 0) return cur; // lost a race with a delete - report not-found
    const next = mutate(sheets[idx]!);
    sheets[idx] = next;
    result = next;
    // A sheet write touches the session: the web sorts the session list by `updatedAt`.
    return { ...cur, sheets, updatedAt: new Date(deps.now()).toISOString() };
  });
  return result;
}

/** Append a revision (agent or user edit). Records who/when/what; the caller decides
 *  `editSource` (routes force 'user' - a client can never claim an agent revision). */
export async function appendSheetRevision(
  sessionId: string,
  sheetId: string,
  input: { content: string; instruction?: string; editedBy?: string; editSource: 'agent' | 'user' },
  deps: SheetDeps,
): Promise<SessionSheetDoc | null> {
  const revision: SheetRevisionDoc = {
    revisionId: deps.genId(),
    content: input.content,
    createdAt: new Date(deps.now()).toISOString(),
    editSource: input.editSource,
    ...(input.editedBy ? { editedBy: input.editedBy } : {}),
    ...(input.instruction ? { instruction: input.instruction } : {}),
  };
  return mutateSheet(sessionId, sheetId, deps, (s) => ({ ...s, revisions: [...s.revisions, revision] }));
}

/** Rename a sheet's title (materialising a derived sheet first, so the rename persists). */
export async function renameSheet(
  sessionId: string,
  sheetId: string,
  title: string,
  deps: SheetDeps,
): Promise<SessionSheetDoc | null> {
  return mutateSheet(sessionId, sheetId, deps, (s) => ({ ...s, title }));
}
