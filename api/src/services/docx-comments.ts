/**
 * Word comment RESOLUTION - the "Resolve" action in Word's review pane.
 *
 * @adeu/core 1.28.0 creates, replies to and deletes comments, and its
 * projection REPORTS a resolved thread ("[Com:n] author @ date(RESOLVED): ..."),
 * but its `DocumentChange` union has no action that SETS the flag - there is no
 * `resolve` op (see `@adeu/core/src/models.ts`). This service adds one on top of
 * the handles adeu does expose at the package boundary (`DocumentObject.pkg`),
 * writing exactly the OOXML Word itself writes.
 *
 * Word keeps the flag in `word/commentsExtended.xml`: one `<w15:commentEx>` per
 * comment, keyed by a `w14:paraId` of a paragraph inside that `<w:comment>`, and
 * threaded through `w15:paraIdParent`:
 *
 *   <w15:commentEx w15:paraId="9D5593F0" w15:done="1"/>
 *   <w15:commentEx w15:paraId="3A741BA2" w15:paraIdParent="9D5593F0" w15:done="1"/>
 *
 * Resolution is a property of the THREAD, not of a single comment: Word marks
 * the root and every reply done together, and adeu's reader
 * (extract_comments_data) reports each comment's own `w15:done`. So resolving
 * any member resolves the whole thread - the caller may pass whichever
 * `[Com:n]` id the user clicked.
 *
 * The `w:comment` elements themselves are NOT touched: adeu's reader tolerates
 * a `w15:done` there, but Word neither writes nor reads it, so setting it would
 * make our own projection disagree with Word.
 */

import type { DocumentObject } from '@adeu/core';

/** Structural view of the xmldom nodes adeu hands out (cortex compiles without the DOM lib). */
interface XmlElement {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: { length: number; [index: number]: XmlElement };
  parentNode:
    | {
        removeChild(child: XmlElement): XmlElement;
        insertBefore(node: XmlElement, ref: XmlElement | null): XmlElement;
      }
    | null;
  nextSibling: XmlElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: XmlElement): XmlElement;
  ownerDocument: { createElement(name: string): XmlElement } | null;
}

interface XmlAttr {
  name: string;
  localName?: string;
  value: string;
}

interface XmlPart {
  partname: string;
  contentType: string;
  _element: XmlElement;
}

const ELEMENT_NODE = 1;

const CT_COMMENTS =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const CT_EXTENDED =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
const RT_EXTENDED = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const NS_W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const NS_W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

/**
 * A resolve/unresolve op that could not be applied. Carries a user-facing
 * PT-PT message; `docx-redline` folds it into the same `RedlineBatchError`
 * the adeu-side failures use, so the review surface renders one error shape.
 */
export class CommentResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommentResolutionError';
  }
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/** Local name of a prefixed node/attribute name ("w15:done" -> "done"). */
function localNameOf(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * Read an attribute by LOCAL name. adeu addresses these attributes by literal
 * prefix (`getAttribute('w15:paraId')`), which is correct for Word's and adeu's
 * own output but breaks on a producer that binds the 2012 wordml namespace to a
 * different prefix. The literal lookup stays the fast path; the scan is a
 * fallback that costs nothing on the common case.
 */
function getAttr(el: XmlElement, prefixed: string): string | null {
  const direct = el.getAttribute(prefixed);
  if (direct !== null && direct !== '') return direct;
  const attrs = (el as unknown as { attributes?: { length: number; [i: number]: XmlAttr } }).attributes;
  if (!attrs) return direct;
  const wanted = localNameOf(prefixed);
  for (let i = 0; i < attrs.length; i += 1) {
    const attr = attrs[i];
    if (attr && (attr.localName ?? localNameOf(attr.name)) === wanted) return attr.value;
  }
  return direct;
}

function elementChildren(el: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const child = el.childNodes[i];
    if (child && child.nodeType === ELEMENT_NODE) out.push(child);
  }
  return out;
}

function descendants(el: XmlElement, tagLocalName: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    for (const child of elementChildren(node)) {
      if (localNameOf(child.nodeName) === tagLocalName) out.push(child);
      walk(child);
    }
  };
  walk(el);
  return out;
}

function findPart(doc: DocumentObject, contentType: string): XmlPart | undefined {
  return (doc.pkg.parts as unknown as XmlPart[]).find((p) => p.contentType === contentType);
}

/** Word's 8-hex-digit paraId form (same shape adeu generates). */
function generateParaId(): string {
  // 0 and 0xFFFFFFFF are reserved by the w14:paraId schema.
  const n = 1 + Math.floor(Math.random() * 0xfffffffe);
  return n.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Get (or create + relate) `word/commentsExtended.xml`. Mirrors adeu's own
 * `_getOrCreateExtendedPart` + `_linkPart`, both private on the un-exported
 * `CommentsManager`. A document whose comments were authored by a non-Word tool
 * can legitimately lack the part; without it there is nowhere to record the
 * resolved state, so we add it rather than fail.
 *
 * Two traps this guards against, both of which corrupt the package silently:
 *  - `DocumentObject.relateTo` does NOT dedupe. It allocates a fresh rId and
 *    appends a <Relationship> on every call, so relating an already-linked part
 *    once per resolve piles up duplicate rels pointing at the same target.
 *  - `contentType` is populated from the [Content_Types].xml Override at load,
 *    so a package shipping commentsExtended.xml WITHOUT an Override looks
 *    partless by content type; creating a second part would leave Word reading
 *    the original and ignoring ours. Hence the path fallback.
 */
function getOrCreateExtendedPart(doc: DocumentObject): XmlPart {
  const existing =
    findPart(doc, CT_EXTENDED) ??
    (doc.pkg.getPartByPath('/word/commentsExtended.xml') as unknown as XmlPart | undefined);

  if (existing) {
    const file = existing.partname.split('/').pop();
    const linked = [...doc.part.rels.values()].some((rel) => !rel.isExternal && rel.target === file);
    if (!linked) {
      doc.relateTo(existing as unknown as Parameters<DocumentObject['relateTo']>[0], RT_EXTENDED);
    } else {
      dropDuplicateExtendedRels(doc, file);
    }
    if (!existing._element.getAttribute('xmlns:w15')) {
      existing._element.setAttribute('xmlns:w15', NS_W15);
    }
    return existing;
  }

  const partname = doc.pkg.nextPartname('/word/commentsExtended%d.xml');
  const xml = `<w15:commentsEx xmlns:w15="${NS_W15}"></w15:commentsEx>`;
  const part = doc.pkg.addPart(partname, CT_EXTENDED, xml);
  doc.relateTo(part, RT_EXTENDED);
  return part as unknown as XmlPart;
}

/**
 * Heal a package that already carries more than one commentsExtended
 * relationship, keeping the first. Word can flag duplicate relationships to the
 * same target as a repairable inconsistency, and `save()` re-serializes the
 * rels part from its DOM, so a document that picked them up stays broken until
 * the elements are removed. The part is referenced implicitly (never by r:id
 * from document.xml), so dropping the extras is safe.
 */
function dropDuplicateExtendedRels(doc: DocumentObject, target: string | undefined): void {
  if (!target) return;
  const relsPart = doc.pkg.getPartByPath('/word/_rels/document.xml.rels') as unknown as
    | XmlPart
    | undefined;
  if (!relsPart) return;

  let kept = false;
  for (const rel of elementChildren(relsPart._element)) {
    if (localNameOf(rel.nodeName) !== 'Relationship') continue;
    if (rel.getAttribute('Type') !== RT_EXTENDED || rel.getAttribute('Target') !== target) continue;
    if (!kept) {
      kept = true;
      continue;
    }
    const id = rel.getAttribute('Id');
    rel.parentNode?.removeChild(rel);
    if (id) doc.part.rels.delete(id);
  }
}

/**
 * Ensure the comments part declares the namespaces we may write with. A legacy
 * or pandoc-produced `word/comments.xml` can omit `w14`, which would make a
 * minted `w14:paraId` serialise as invalid XML. Same defence as adeu's
 * `_ensureNamespaces`, narrowed to the prefixes this service uses.
 */
function ensureCommentNamespaces(commentsPart: XmlPart): void {
  const root = commentsPart._element;
  if (!root.getAttribute('xmlns:w14')) root.setAttribute('xmlns:w14', NS_W14);
  if (!root.getAttribute('xmlns:w15')) root.setAttribute('xmlns:w15', NS_W15);
}

// ---------------------------------------------------------------------------
// Comment / thread index
// ---------------------------------------------------------------------------

interface CommentRecord {
  /** `w:id` - the `n` in the projection's `[Com:n]`. */
  id: string;
  /** The comment's paragraphs, in document order (for minting a paraId if needed). */
  paragraphs: XmlElement[];
  /** Existing `w14:paraId` values of those paragraphs, in document order. */
  paraIds: string[];
  /**
   * adeu's fallback parent link: it stamps `w15:p` (the PARENT COMMENT id) on
   * `<w:comment>` when it adds a reply to a document that has no
   * commentsExtended part - the only thread information such a file carries.
   */
  parentCommentId: string | null;
}

function indexComments(commentsPart: XmlPart): Map<string, CommentRecord> {
  const byId = new Map<string, CommentRecord>();
  for (const comment of descendants(commentsPart._element, 'comment')) {
    const id = getAttr(comment, 'w:id');
    if (!id) continue;
    const paragraphs = descendants(comment, 'p');
    const paraIds: string[] = [];
    for (const paragraph of paragraphs) {
      const paraId = getAttr(paragraph, 'w14:paraId');
      if (paraId) paraIds.push(paraId);
    }
    byId.set(id, {
      id,
      paragraphs,
      paraIds,
      parentCommentId: getAttr(comment, 'w15:p'),
    });
  }
  return byId;
}

/** The `<w15:commentEx>` elements of the extended part, keyed by `w15:paraId`. */
function indexCommentEx(extendedPart: XmlPart): Map<string, XmlElement> {
  const byParaId = new Map<string, XmlElement>();
  for (const el of elementChildren(extendedPart._element)) {
    if (localNameOf(el.nodeName) !== 'commentEx') continue;
    const paraId = getAttr(el, 'w15:paraId');
    if (paraId) byParaId.set(paraId, el);
  }
  return byParaId;
}

export interface CommentResolutionResult {
  /** Comment ids whose thread membership was marked - the target plus its thread. */
  commentIds: string[];
  /** False when every comment of the thread already carried the requested state. */
  changed: boolean;
}

/**
 * Mark the comment thread containing `targetId` resolved (`done: true`) or
 * reopened (`done: false`), in place on a loaded document.
 *
 * `targetId` is the `n` of a `[Com:n]` marker in the projection (adeu's
 * `w:id`), optionally in the `Com:n` form the MCP ops also accept.
 *
 * Throws `CommentResolutionError` when the id names no comment, so callers can
 * fail the batch before committing anything.
 */
export function setCommentThreadResolved(
  doc: DocumentObject,
  targetId: string,
  done: boolean,
): CommentResolutionResult {
  const normalizedId = String(targetId).trim().replace(/^Com:/i, '');
  const commentsPart = findPart(doc, CT_COMMENTS);
  if (!commentsPart) {
    throw new CommentResolutionError('O documento não tem comentários.');
  }

  const comments = indexComments(commentsPart);
  if (!comments.has(normalizedId)) {
    throw new CommentResolutionError(
      `Não existe nenhum comentário com o id ${normalizedId} neste documento.`,
    );
  }

  const extendedPart = getOrCreateExtendedPart(doc);
  const byParaId = indexCommentEx(extendedPart);
  const exDoc = extendedPart._element.ownerDocument;

  // Each comment gets exactly ONE key paraId - the commentEx entry that carries
  // its resolved flag. Word keys the entry on the comment's LAST paragraph while
  // adeu keys it on the FIRST, and both are legal, so the existing entry is
  // located by trying EVERY paragraph of the comment (which is also how adeu's
  // reader maps paraIds back to comment ids).
  const keyParaId = new Map<string, string>();
  for (const record of comments.values()) {
    const existing = record.paraIds.find((paraId) => byParaId.has(paraId));
    if (existing) {
      keyParaId.set(record.id, existing);
      continue;
    }
    // No entry at all: mint one so the flag has somewhere to live. Word's
    // convention is the LAST paragraph's paraId.
    if (!exDoc) continue;
    let paraId = record.paraIds.length > 0 ? record.paraIds[record.paraIds.length - 1] : null;
    if (!paraId) {
      const paragraph = record.paragraphs[record.paragraphs.length - 1];
      if (!paragraph) continue;
      ensureCommentNamespaces(commentsPart);
      paraId = generateParaId();
      paragraph.setAttribute('w14:paraId', paraId);
    }
    const el = exDoc.createElement('w15:commentEx');
    el.setAttribute('w15:paraId', paraId);
    el.setAttribute('w15:done', '0');
    extendedPart._element.appendChild(el);
    byParaId.set(paraId, el);
    keyParaId.set(record.id, paraId);
  }

  // Thread graph over key paraIds. w15:paraIdParent is authoritative; adeu's
  // w15:p (parent COMMENT id) is the fallback for documents written without a
  // commentsExtended part, which carry no paraIdParent at all.
  const parentOf = new Map<string, string>();
  for (const record of comments.values()) {
    const self = keyParaId.get(record.id);
    if (!self) continue;
    const selfEx = byParaId.get(self);
    const viaExtended = selfEx ? getAttr(selfEx, 'w15:paraIdParent') : null;
    if (viaExtended && byParaId.has(viaExtended)) {
      parentOf.set(self, viaExtended);
      continue;
    }
    const viaComment = record.parentCommentId ? keyParaId.get(record.parentCommentId) : undefined;
    if (viaComment && viaComment !== self) parentOf.set(self, viaComment);
  }

  const rootOf = (paraId: string): string => {
    let current = paraId;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const parent = parentOf.get(current);
      if (!parent || parent === current) return current;
      current = parent;
    }
    return current;
  };

  const targetKey = keyParaId.get(normalizedId);
  if (!targetKey) {
    throw new CommentResolutionError(
      `Não foi possível marcar o comentário ${normalizedId}: o documento não regista o estado dos comentários.`,
    );
  }

  const root = rootOf(targetKey);
  const value = done ? '1' : '0';
  const touched: string[] = [];
  let changed = false;

  for (const [commentId, paraId] of keyParaId) {
    if (rootOf(paraId) !== root) continue;
    const el = byParaId.get(paraId);
    if (!el) continue;
    if (getAttr(el, 'w15:done') !== value) {
      el.setAttribute('w15:done', value);
      changed = true;
    }
    touched.push(commentId);
  }

  return { commentIds: touched, changed };
}

// ---------------------------------------------------------------------------
// Comment anchor repair
//
// A comment lives in TWO places: the record in word/comments.xml and the anchor
// in word/document.xml (w:commentRangeStart / w:commentRangeEnd plus a run
// holding w:commentReference). @adeu/core 1.28.0 drops all three markers when it
// ACCEPTS a tracked change whose region carried a comment, while leaving the
// record behind - an orphan. Word and Google Docs both need the anchor, so such
// a comment silently disappears from the review pane even though it is still in
// the file. (Reproduced: accept the changes of a batch that attached comments,
// and the comments' markers go to zero while their anchored TEXT survives.)
//
// applyRedline therefore snapshots every comment's anchored text before the
// batch and restores any anchor the engine dropped afterwards, re-attaching to
// the same text - which keeps the original author, date and thread. A comment
// whose text genuinely went away (an accepted deletion) is removed outright,
// because a record with nothing to point at is invisible in every editor and
// would otherwise accumulate forever.
// ---------------------------------------------------------------------------

/** Depth-first list of element nodes, in document order. */
function flatten(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    for (const child of elementChildren(node)) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function mainDocumentElement(doc: DocumentObject): XmlElement {
  return (doc.part as unknown as XmlPart)._element;
}

function runText(run: XmlElement): string {
  let text = '';
  for (const t of descendants(run, 't')) text += t.textContent ?? '';
  return text;
}

/** Whitespace-normalised form used to match an anchor's text after an edit. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The plain text each comment currently spans, keyed by comment id. Comments
 * with no anchor (already orphaned) are absent, so a pre-existing orphan is
 * never "repaired" onto unrelated text.
 */
export function captureCommentAnchors(doc: DocumentObject): Map<string, string> {
  const nodes = flatten(mainDocumentElement(doc));
  const open = new Map<string, number>();
  const anchors = new Map<string, string>();

  nodes.forEach((node, index) => {
    const name = localNameOf(node.nodeName);
    if (name === 'commentRangeStart') {
      const id = getAttr(node, 'w:id');
      if (id) open.set(id, index);
    } else if (name === 'commentRangeEnd') {
      const id = getAttr(node, 'w:id');
      const from = id ? open.get(id) : undefined;
      if (!id || from === undefined) return;
      let text = '';
      for (let i = from + 1; i < index; i += 1) {
        const between = nodes[i];
        if (between && localNameOf(between.nodeName) === 't') text += between.textContent ?? '';
      }
      open.delete(id);
      const normalized = normalize(text);
      if (normalized) anchors.set(id, normalized);
    }
  });

  return anchors;
}

/** The child of `w:p` that contains `run` - markers must sit at that level. */
function topLevelAncestor(run: XmlElement, paragraph: XmlElement): XmlElement | null {
  let node: XmlElement | null = run;
  while (node) {
    const parent = node.parentNode as unknown as XmlElement | null;
    if (!parent) return null;
    if (parent === paragraph) return node;
    node = parent;
  }
  return null;
}

/** Re-attach comment `id` around `text`, returning false when the text is gone. */
function reanchor(doc: DocumentObject, id: string, text: string): boolean {
  const root = mainDocumentElement(doc);
  const factory = root.ownerDocument;
  if (!factory) return false;
  const wanted = normalize(text);
  if (!wanted) return false;

  for (const paragraph of descendants(root, 'p')) {
    const runs = descendants(paragraph, 'r').filter((run) => descendants(run, 't').length > 0);
    if (runs.length === 0) continue;

    // Paragraph text plus the run each character came from, so a match that
    // starts mid-run still resolves to the right first/last run.
    let joined = '';
    const owner: XmlElement[] = [];
    for (const run of runs) {
      const value = runText(run);
      joined += value;
      for (let i = 0; i < value.length; i += 1) owner.push(run);
    }

    // Match on normalised text but map back to raw offsets: build an index of
    // the raw positions that survive normalisation.
    const rawIndex: number[] = [];
    let normalized = '';
    let pendingSpace = false;
    for (let i = 0; i < joined.length; i += 1) {
      const ch = joined[i]!;
      if (/\s/.test(ch)) {
        pendingSpace = normalized.length > 0;
        continue;
      }
      if (pendingSpace) {
        normalized += ' ';
        rawIndex.push(i);
        pendingSpace = false;
      }
      normalized += ch;
      rawIndex.push(i);
    }

    const at = normalized.indexOf(wanted);
    if (at === -1) continue;

    const firstIndex = rawIndex[at];
    const lastIndex = rawIndex[Math.min(at + wanted.length - 1, rawIndex.length - 1)];
    if (firstIndex === undefined || lastIndex === undefined) continue;
    const firstRun = owner[firstIndex];
    const lastRun = owner[lastIndex];
    if (!firstRun || !lastRun) continue;
    const startAt = topLevelAncestor(firstRun, paragraph);
    const endAt = topLevelAncestor(lastRun, paragraph);
    if (!startAt || !endAt) continue;

    // w:commentRangeStart/End and the reference run are all children of w:p.
    const insertInto = paragraph as unknown as {
      insertBefore(node: XmlElement, ref: XmlElement | null): XmlElement;
    };

    const rangeStart = factory.createElement('w:commentRangeStart');
    rangeStart.setAttribute('w:id', id);
    insertInto.insertBefore(rangeStart, startAt);

    const rangeEnd = factory.createElement('w:commentRangeEnd');
    rangeEnd.setAttribute('w:id', id);
    const reference = factory.createElement('w:r');
    const rPr = factory.createElement('w:rPr');
    const rStyle = factory.createElement('w:rStyle');
    rStyle.setAttribute('w:val', 'CommentReference');
    rPr.appendChild(rStyle);
    reference.appendChild(rPr);
    const ref = factory.createElement('w:commentReference');
    ref.setAttribute('w:id', id);
    reference.appendChild(ref);

    insertInto.insertBefore(rangeEnd, endAt.nextSibling);
    insertInto.insertBefore(reference, rangeEnd.nextSibling);
    return true;
  }

  return false;
}

/** Remove a comment record and every sidecar entry that referenced it. */
function deleteCommentRecord(doc: DocumentObject, id: string): void {
  const commentsPart = findPart(doc, CT_COMMENTS);
  if (!commentsPart) return;

  const paraIds = new Set<string>();
  for (const comment of descendants(commentsPart._element, 'comment')) {
    if (getAttr(comment, 'w:id') !== id) continue;
    for (const paragraph of descendants(comment, 'p')) {
      const paraId = getAttr(paragraph, 'w14:paraId');
      if (paraId) paraIds.add(paraId);
    }
    comment.parentNode?.removeChild(comment);
  }
  if (paraIds.size === 0) return;

  const extended = findPart(doc, CT_EXTENDED);
  if (extended) {
    for (const el of elementChildren(extended._element)) {
      if (localNameOf(el.nodeName) !== 'commentEx') continue;
      const paraId = getAttr(el, 'w15:paraId');
      if (paraId && paraIds.has(paraId)) el.parentNode?.removeChild(el);
    }
  }
}

export interface CommentAnchorRepair {
  /** Comment ids whose dropped anchor was restored on the same text. */
  reanchored: string[];
  /** Comment ids removed because the text they pointed at is gone. */
  dropped: string[];
}

/**
 * Restore anchors the engine dropped during a batch. `before` is the snapshot
 * from `captureCommentAnchors` taken on the pre-edit document.
 */
export function repairCommentAnchors(
  doc: DocumentObject,
  before: Map<string, string>,
): CommentAnchorRepair {
  const result: CommentAnchorRepair = { reanchored: [], dropped: [] };
  const commentsPart = findPart(doc, CT_COMMENTS);
  if (!commentsPart) return result;

  const anchored = new Set<string>();
  for (const node of flatten(mainDocumentElement(doc))) {
    if (localNameOf(node.nodeName) !== 'commentReference') continue;
    const id = getAttr(node, 'w:id');
    if (id) anchored.add(id);
  }

  for (const comment of descendants(commentsPart._element, 'comment')) {
    const id = getAttr(comment, 'w:id');
    if (!id || anchored.has(id)) continue;
    const text = before.get(id);
    // No snapshot means the comment was already unanchored before this batch -
    // leave it exactly as found rather than guessing a new home for it.
    if (!text) continue;
    if (reanchor(doc, id, text)) result.reanchored.push(id);
    else result.dropped.push(id);
  }

  for (const id of result.dropped) deleteCommentRecord(doc, id);
  return result;
}
