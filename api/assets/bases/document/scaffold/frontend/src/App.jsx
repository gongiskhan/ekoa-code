/**
 * Document shell — platform-provided, print-tested.
 *
 * AGENT: the document's CONTENT lives in ./documentData.js — edit that file.
 * Only touch this shell for user-requested EXTRAS (e.g. fill-in form fields,
 * an additional tab). Never remove or restyle the toolbar, exports, or the
 * print layout; the Word/PDF output depends on them.
 *
 * Two modes, switched by documentData.sourceDocument:
 *   - authored (default): `blocks` render the document and the .docx is
 *     generated client-side from them.
 *   - source-linked: the app works over an EXISTING Word file registered on
 *     the platform (docx tools). The shell fetches the CriticMarkup
 *     projection from /api/app-docx/projection and renders it as a redline
 *     preview (tracked changes + comments); downloads serve the real file.
 */
import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
} from 'docx';
import documentData from './documentData';

// ---------------------------------------------------------------------------
// .docx generation — mirrors the on-screen blocks 1:1. Notes are NOT included.
// ---------------------------------------------------------------------------

const DOCX_FONT = 'Times New Roman';
const PT = (n) => n * 2; // docx sizes are half-points

function runsFor(text, opts = {}) {
  return [new TextRun({ text: String(text ?? ''), font: DOCX_FONT, size: PT(11), ...opts })];
}

function blockToDocxParagraphs(block) {
  switch (block.type) {
    case 'heading':
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 360, after: 240 },
        children: runsFor(block.text, { bold: true, size: PT(12) }),
      })];
    case 'clause': {
      const out = [new Paragraph({
        spacing: { before: 300, after: 160 },
        children: runsFor(block.title, { bold: true }),
      })];
      for (const p of block.paragraphs || []) {
        out.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 140 },
          children: runsFor(p),
        }));
      }
      return out;
    }
    case 'list':
      return (block.items || []).map((item) => new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 100 },
        children: runsFor(item),
      }));
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'signatures': {
      const out = [new Paragraph({ spacing: { before: 600 }, children: runsFor('') })];
      for (const party of block.parties || []) {
        out.push(
          new Paragraph({ spacing: { before: 480 }, children: runsFor('_________________________________________') }),
          new Paragraph({ spacing: { before: 80 }, children: runsFor(party.label, { bold: true }) }),
        );
        if (party.detail) {
          out.push(new Paragraph({ children: runsFor(party.detail, { size: PT(10) }) }));
        }
      }
      return out;
    }
    case 'paragraph':
    default:
      return [new Paragraph({
        alignment: block.align === 'center' ? AlignmentType.CENTER
          : block.align === 'left' ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
        spacing: { after: 140 },
        children: runsFor(block.text),
      })];
  }
}

function buildDocumentDocx() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: documentData.subtitle ? 100 : 360 },
      children: runsFor(documentData.title, { bold: true, size: PT(14) }),
    }),
  ];
  if (documentData.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: runsFor(documentData.subtitle, { italics: true }),
    }));
  }
  for (const block of documentData.blocks || []) children.push(...blockToDocxParagraphs(block));
  return new Document({
    sections: [{
      properties: { page: { margin: { top: 1247, bottom: 1247, left: 1134, right: 1134 } } }, // 22mm / 20mm in twips
      children,
    }],
  });
}

function buildNotesDocx() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: runsFor(`Nota de alterações — ${documentData.title}`, { bold: true, size: PT(13) }),
    }),
  ];
  for (const note of documentData.notes || []) {
    children.push(
      new Paragraph({ spacing: { before: 280, after: 120 }, children: runsFor(note.heading, { bold: true }) }),
      new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 140 }, children: runsFor(note.body) }),
    );
  }
  return new Document({ sections: [{ children }] });
}

async function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ---------------------------------------------------------------------------
// Source-linked mode - CriticMarkup redline preview
//
// The platform projection (/api/app-docx/projection) is markdown with
// CriticMarkup spans: {++ins++}, {--del--}, {~~old~>new~~}, {==text==},
// {>>[Chg:n kind] author<<} / {>>[Com:n] author @ date: text<<}. Meta spans
// may contain newlines, so tokenize the whole string first and only split
// blocks on newlines inside plain-text tokens.
// ---------------------------------------------------------------------------

const CRITIC_SPANS = [
  { open: '{++', close: '++}', kind: 'ins' },
  { open: '{--', close: '--}', kind: 'del' },
  { open: '{~~', close: '~~}', kind: 'subst' },
  { open: '{==', close: '==}', kind: 'mark' },
  { open: '{>>', close: '<<}', kind: 'meta' },
];

function tokenizeCritic(src) {
  const tokens = [];
  let plain = '';
  let i = 0;
  while (i < src.length) {
    let span = null;
    if (src[i] === '{') {
      for (const s of CRITIC_SPANS) {
        if (src.startsWith(s.open, i)) {
          const end = src.indexOf(s.close, i + s.open.length);
          if (end !== -1) span = { kind: s.kind, text: src.slice(i + s.open.length, end), next: end + s.close.length };
          break;
        }
      }
    }
    if (span) {
      if (plain) { tokens.push({ kind: 'text', text: plain }); plain = ''; }
      tokens.push({ kind: span.kind, text: span.text });
      i = span.next;
    } else {
      plain += src[i];
      i += 1;
    }
  }
  if (plain) tokens.push({ kind: 'text', text: plain });
  return tokens;
}

function splitCriticBlocks(tokens) {
  const blocks = [[]];
  for (const tok of tokens) {
    if (tok.kind !== 'text' || !tok.text.includes('\n')) {
      blocks[blocks.length - 1].push(tok);
      continue;
    }
    tok.text.split('\n').forEach((part, idx) => {
      if (idx > 0) blocks.push([]);
      if (part) blocks[blocks.length - 1].push({ kind: 'text', text: part });
    });
  }
  return blocks.filter((b) => b.some((t) => t.kind !== 'text' || t.text.trim() !== ''));
}

function stripLeadMarker(tokens, marker) {
  const [first, ...rest] = tokens;
  const remainder = first.text.slice(marker.length);
  return remainder ? [{ kind: 'text', text: remainder }, ...rest] : rest;
}

function hasContent(tokens) {
  return tokens.some((t) => t.kind !== 'text' || t.text.trim() !== '');
}

function classifyCriticBlock(tokens) {
  const first = tokens[0];
  if (first && first.kind === 'text') {
    const heading = first.text.match(/^(#{1,6})\s+/);
    if (heading) return { type: 'heading', level: heading[1].length, tokens: stripLeadMarker(tokens, heading[0]) };
    if (tokens.length === 1 && /^-{3,}\s*$/.test(first.text)) return { type: 'hr', tokens: [] };
    const ol = first.text.match(/^\d+[.)]\s+/);
    if (ol) return { type: 'olitem', tokens: stripLeadMarker(tokens, ol[0]) };
    const ul = first.text.match(/^[-*]\s+/);
    if (ul) return { type: 'ulitem', tokens: stripLeadMarker(tokens, ul[0]) };
  }
  return { type: 'paragraph', tokens };
}

// Trailing empty "## Footnotes" / "## Endnotes" scaffolding the projection
// always appends - drop it only when the sections carry no content.
function stripEmptyTrailingSections(md) {
  let out = md.replace(/\s+$/, '');
  for (const name of ['Endnotes', 'Footnotes']) {
    out = out.replace(new RegExp('\\n-{3,}\\s*\\n+#{1,6}\\s+' + name + '\\s*$'), '').replace(/\s+$/, '');
  }
  return out;
}

const INLINE_MD = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function renderInlineMd(text, keyBase) {
  return text.split(INLINE_MD).map((part, i) => {
    if (!part) return null;
    const key = `${keyBase}-${i}`;
    if (/^\*\*[\s\S]*\*\*$/.test(part) || /^__[\s\S]*__$/.test(part)) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.length > 2 && (/^\*[\s\S]*\*$/.test(part) || /^_[\s\S]*_$/.test(part))) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <span key={key}>{part}</span>;
  });
}

const CHG_KIND_LABEL = { insert: 'inserção', delete: 'eliminação', format: 'formatação', move: 'movimentação' };

// ---------------------------------------------------------------------------
// Review failures, in the user's language.
//
// /api/app-docx/edits forwards the redline engine's per-op failures VERBATIM, and
// the engine speaks English with internal ids ("Action 1 Failed: Target ID 9999 not
// found."). That text must never reach the page: this is a PT-PT product and the
// numbers refer to nothing the reader can see. Each known failure family maps to
// one sentence that says what happened AND what to do; anything unrecognised falls
// back to the generic sentence rather than leaking the raw message.
// ---------------------------------------------------------------------------

const REVIEW_FAILURE_RULES = [
  [/duplicate action/i,
    'Esta ação foi pedida duas vezes ao mesmo tempo. Tente novamente.'],
  [/\b(?:target id|change id|comment id)\b[^.]*\bnot found\b|\balready (?:accepted|rejected|resolved|applied)\b/i,
    'Esta alteração já não está pendente no documento. Atualize a página para ver a versão mais recente e tente novamente.'],
  [/ambiguous|occurrence|match_mode|found \d+ times/i,
    'O texto selecionado aparece mais do que uma vez no documento. Selecione um trecho maior, que seja único, e tente novamente.'],
  [/not found|no match/i,
    'Não foi possível localizar o texto selecionado no documento. Selecione novamente o trecho e tente outra vez.'],
];

const REVIEW_FAILURE_FALLBACK = 'Não foi possível aplicar a alteração ao documento. Tente novamente.';
const REVIEW_FAILURE_OFFLINE = 'Não foi possível contactar o servidor. Verifique a ligação e tente novamente.';
const REVIEW_FAILURE_NO_SOURCE = 'O documento original já não está associado a esta aplicação. Atualize a página.';

/** One PT-PT sentence per DISTINCT failure family; never the backend's own text. */
function reviewFailureMessage(data, status) {
  if (status === 404) return REVIEW_FAILURE_NO_SOURCE;
  const raw = [];
  if (data && Array.isArray(data.failures)) {
    for (const failure of data.failures) {
      if (failure && typeof failure.error === 'string') raw.push(failure.error);
    }
  }
  if (raw.length === 0 && data && typeof data.error === 'string') raw.push(data.error);
  const messages = [];
  for (const text of raw) {
    const rule = REVIEW_FAILURE_RULES.find(([pattern]) => pattern.test(text));
    const message = rule ? rule[1] : REVIEW_FAILURE_FALLBACK;
    if (messages.indexOf(message) === -1) messages.push(message);
  }
  return messages.length > 0 ? messages.join(' ') : REVIEW_FAILURE_FALLBACK;
}

// ---------------------------------------------------------------------------
// Interactive human review (source-linked mode only).
//
// The meta chips carry the numeric ids the backend keys on: `[Chg:n]` for a
// tracked change (target of accept/reject), `[Com:n]` for a comment thread
// (target of reply and of resolve/unresolve - Word's "Resolve" is a THREAD
// flag, reported by the projection as a "(RESOLVED)" suffix after the date).
// Accept/reject/reply/resolve/add-comment POST to /api/app-docx/edits; the
// returned markdown re-renders the preview. The
// ReviewContext is only provided in source-linked mode, so authored mode never
// activates any of this - the chips render read-only (review == null).
// ---------------------------------------------------------------------------

const ReviewContext = createContext(null);

// "[Chg:6 delete] Author (pairs with Chg:7)" -> { id, kindLabel, author, ids }.
// `ids` is the full set to act on: this change plus every paired change, so
// accepting/rejecting one half of a del/ins replacement resolves the pair.
function parseChgLine(line) {
  const chg = line.match(/^\[Chg:(\d+)(?:\s+(\w+))?\]\s*(.*)$/);
  if (!chg) return null;
  const id = chg[1];
  const kind = chg[2] || '';
  const rest = chg[3] || '';
  const pairs = [];
  const re = /pairs with Chg:(\d+)/g;
  let m;
  while ((m = re.exec(rest))) pairs.push(m[1]);
  const author = rest.replace(/\s*\(pairs with[^)]*\)\s*$/, '').trim();
  return {
    id,
    kindLabel: kind ? CHG_KIND_LABEL[kind] || kind : '',
    author,
    ids: Array.from(new Set([id, ...pairs])),
  };
}

function ChgReviewChip({ meta }) {
  const review = useContext(ReviewContext);
  const [open, setOpen] = useState(false);
  const label = `Alt. ${meta.id}${meta.kindLabel ? ` (${meta.kindLabel})` : ''}${meta.author ? ` - ${meta.author}` : ''}`;
  if (!review || !review.enabled) {
    return <span className="redline-chip">{label}</span>;
  }
  const pendingKey = `chg:${meta.id}`;
  const isPending = review.pendingKey === pendingKey;
  const toggle = () => { if (!review.busy) setOpen((v) => !v); };
  const act = (type) => {
    const ops = meta.ids.map((tid) => ({ type, target_id: tid }));
    review.submitOps(ops, pendingKey).then((ok) => { if (ok) setOpen(false); });
  };
  return (
    <span className={`redline-chip redline-chip-action${open ? ' open' : ''}`}>
      <span
        className="redline-chip-label"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        {label}
        {isPending ? <span className="redline-spinner no-print" data-no-pdf="true" aria-label="A aplicar" /> : null}
      </span>
      {open && !isPending && (
        <span className="redline-actions no-print" data-no-pdf="true">
          <button type="button" className="redline-act redline-act-accept" disabled={review.busy} onClick={() => act('accept')}>Aceitar</button>
          <button type="button" className="redline-act redline-act-reject" disabled={review.busy} onClick={() => act('reject')}>Rejeitar</button>
        </span>
      )}
    </span>
  );
}

// One {>>...<<} span carries SEVERAL entries, one per line, and mixes kinds:
// the projection emits every [Chg:n] line for the anchor followed by every
// [Com:n] line of the thread(s) anchored there. A comment body may itself span
// lines, so a line that does not open a new marker continues the entry before
// it.
const META_ENTRY_START = /^\[(?:Chg|Com):\d+/;

function splitMetaEntries(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (entries.length === 0 || META_ENTRY_START.test(line.trim())) entries.push(line);
    else entries[entries.length - 1] += `\n${line}`;
  }
  return entries.map((e) => e.trim()).filter(Boolean);
}

// "[Com:n] Author @ ISO-date(RESOLVED): body" -> { id, author, date, resolved, body }.
// The projection joins header and body with exactly ": " and an ISO date never
// has a space after its colons, so the FIRST ": " is the split. "(RESOLVED)" is
// appended straight after the date when the thread is marked done in Word.
function parseComEntry(entry) {
  const head = /^\[Com:(\d+)\]\s*([\s\S]*)$/.exec(entry);
  if (!head) return null;
  const rest = head[2];
  const split = rest.indexOf(': ');
  const meta = split === -1 ? rest : rest.slice(0, split);
  const body = split === -1 ? '' : rest.slice(split + 2);
  const resolved = /\(RESOLVED\)$/.test(meta);
  const bare = resolved ? meta.slice(0, -'(RESOLVED)'.length) : meta;
  const at = bare.lastIndexOf(' @ ');
  return {
    id: head[1],
    author: (at === -1 ? bare : bare.slice(0, at)).trim(),
    date: at === -1 ? '' : bare.slice(at + 3).trim(),
    resolved,
    body,
  };
}

// A comment thread rendered as one card: the root plus its replies, with the
// thread-level actions. Word treats resolution as a property of the THREAD, so
// "Resolver" sends one op for the root id and the backend marks every member
// (the projection then comes back with (RESOLVED) on each line).
function ComThreadChip({ comments }) {
  const review = useContext(ReviewContext);
  const [replying, setReplying] = useState(false);
  const [value, setValue] = useState('');

  const root = comments[0];
  const resolved = comments.every((c) => c.resolved);
  const enabled = Boolean(review && review.enabled);
  const replyKey = `com:${root.id}`;
  const resolveKey = `resolve:${root.id}`;
  const isReplying = enabled && review.pendingKey === replyKey;
  const isResolving = enabled && review.pendingKey === resolveKey;

  const submitReply = () => {
    const text = value.trim();
    if (!text || review.busy) return;
    review.submitOps([{ type: 'reply', target_id: root.id, text }], replyKey).then((ok) => {
      if (ok) { setValue(''); setReplying(false); }
    });
  };

  const toggleResolved = () => {
    if (review.busy) return;
    review.submitOps(
      [{ type: resolved ? 'unresolve' : 'resolve', target_id: root.id }],
      resolveKey,
    );
  };

  return (
    <span className={`redline-chip redline-chip-comment${resolved ? ' resolved' : ''}`}>
      {resolved && <span className="redline-comment-flag">Resolvido</span>}
      {comments.map((c) => (
        <span key={c.id} className="redline-comment" title={c.date}>
          <span className="redline-chip-author">{c.author}</span>
          <span className="redline-comment-body">{c.body}</span>
        </span>
      ))}
      {enabled && (
        <span className="redline-comment-actions no-print" data-no-pdf="true">
          <button
            type="button"
            className="redline-reply-trigger"
            disabled={review.busy && !isReplying}
            onClick={() => setReplying((v) => !v)}
          >
            {isReplying ? 'A responder…' : 'Responder'}
          </button>
          <button
            type="button"
            className="redline-reply-trigger"
            disabled={review.busy && !isResolving}
            onClick={toggleResolved}
          >
            {isResolving
              ? (resolved ? 'A reabrir…' : 'A resolver…')
              : (resolved ? 'Reabrir' : 'Resolver')}
          </button>
        </span>
      )}
      {enabled && replying && !isReplying && (
        <span className="redline-composer no-print" data-no-pdf="true">
          <textarea
            className="redline-textarea"
            rows={2}
            value={value}
            placeholder="Escreva a sua resposta…"
            onChange={(e) => setValue(e.target.value)}
          />
          <span className="redline-composer-actions">
            <button type="button" className="redline-act redline-act-accept" disabled={review.busy || !value.trim()} onClick={submitReply}>Enviar</button>
            <button type="button" className="redline-act" disabled={review.busy} onClick={() => { setReplying(false); setValue(''); }}>Cancelar</button>
          </span>
        </span>
      )}
    </span>
  );
}

function MetaChips({ text }) {
  const { changes, comments, unknown } = useMemo(() => {
    const acc = { changes: [], comments: [], unknown: [] };
    for (const entry of splitMetaEntries(text)) {
      if (entry.startsWith('[Chg:')) {
        // Change metadata: one "[Chg:n kind] Author (pairs with Chg:m)" per line
        const meta = parseChgLine(entry.split('\n')[0].trim());
        if (meta) acc.changes.push(meta);
        else acc.unknown.push(entry);
      } else if (entry.startsWith('[Com:')) {
        const com = parseComEntry(entry);
        if (com) acc.comments.push(com);
        else acc.unknown.push(entry);
      } else {
        acc.unknown.push(entry);
      }
    }
    return acc;
  }, [text]);

  if (!changes.length && !comments.length && !unknown.length) return null;
  return (
    <span className="redline-meta">
      {changes.map((meta, i) => <ChgReviewChip key={`chg-${meta.id}-${i}`} meta={meta} />)}
      {comments.length > 0 && <ComThreadChip key={`com-${comments[0].id}`} comments={comments} />}
      {unknown.map((line, i) => <span key={`x-${i}`} className="redline-chip">{line}</span>)}
    </span>
  );
}

function splitSubst(inner) {
  const idx = inner.indexOf('~>');
  return idx === -1 ? [inner, ''] : [inner.slice(0, idx), inner.slice(idx + 2)];
}

function CriticInline({ tokens, keyBase }) {
  return tokens.map((tok, i) => {
    const key = `${keyBase}-${i}`;
    switch (tok.kind) {
      case 'ins':
        return <ins key={key} className="redline-ins">{renderInlineMd(tok.text, key)}</ins>;
      case 'del':
        return <del key={key} className="redline-del">{renderInlineMd(tok.text, key)}</del>;
      case 'subst': {
        const [oldText, newText] = splitSubst(tok.text);
        return (
          <span key={key}>
            <del className="redline-del">{renderInlineMd(oldText, `${key}o`)}</del>
            <ins className="redline-ins">{renderInlineMd(newText, `${key}n`)}</ins>
          </span>
        );
      }
      case 'mark':
        return <mark key={key} className="redline-mark">{renderInlineMd(tok.text, key)}</mark>;
      case 'meta':
        return <MetaChips key={key} text={tok.text} />;
      default:
        return <span key={key}>{renderInlineMd(tok.text, key)}</span>;
    }
  });
}

function RedlinePreview({ markdown }) {
  const groups = useMemo(() => {
    const blocks = splitCriticBlocks(tokenizeCritic(stripEmptyTrailingSections(markdown)))
      .map(classifyCriticBlock)
      // A marker-only line ("1. " / "# ") is an empty numbered paragraph or
      // heading in the source docx. Keeping it would render a bare list bullet
      // or a blank heading band on the sheet (and in the PDF).
      .filter((block) => block.type === 'hr' || hasContent(block.tokens));
    const grouped = [];
    for (const block of blocks) {
      const last = grouped[grouped.length - 1];
      if ((block.type === 'olitem' || block.type === 'ulitem') && last && last.type === block.type) {
        last.items.push(block.tokens);
      } else if (block.type === 'olitem' || block.type === 'ulitem') {
        grouped.push({ type: block.type, items: [block.tokens] });
      } else {
        grouped.push(block);
      }
    }
    return grouped;
  }, [markdown]);

  return groups.map((group, i) => {
    switch (group.type) {
      case 'heading': {
        const Tag = group.level === 1 ? 'h2' : 'h3';
        return (
          <Tag key={i} className={`redline-heading redline-h${Math.min(group.level, 3)}`}>
            <CriticInline tokens={group.tokens} keyBase={`h${i}`} />
          </Tag>
        );
      }
      case 'olitem':
      case 'ulitem': {
        const ListTag = group.type === 'olitem' ? 'ol' : 'ul';
        return (
          <ListTag key={i} className="redline-list">
            {group.items.map((item, j) => (
              <li key={j}><CriticInline tokens={item} keyBase={`b${i}-${j}`} /></li>
            ))}
          </ListTag>
        );
      }
      case 'hr':
        return <hr key={i} className="redline-hr" />;
      default:
        return <p key={i} className="doc-p"><CriticInline tokens={group.tokens} keyBase={`b${i}`} /></p>;
    }
  });
}

// Floating "add comment on selection" surface (source-linked mode only). When
// the user selects text inside the document sheet, a small button appears near
// the selection; it opens an inline composer that POSTs a `modify` op wrapping
// the exact selected plain text (new_text == target_text) with the comment.
function SelectionCommenter({ sheetRef, review }) {
  const [anchor, setAnchor] = useState(null); // { top, left, text } - viewport coords
  const [composing, setComposing] = useState(false);
  const [value, setValue] = useState('');
  // The live Range the anchor was measured from. Kept so the surface can be
  // RE-measured later: it is position:fixed, so viewport coordinates captured once
  // go stale the moment anything scrolls and the box would then point at a
  // different clause than the one it is about to comment.
  const rangeRef = useRef(null);
  const enabled = Boolean(review && review.enabled);

  const close = useCallback(() => {
    rangeRef.current = null;
    setComposing(false);
    setValue('');
    setAnchor(null);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onSelect = (ev) => {
      if (composing) return;
      if (ev.target && ev.target.closest && ev.target.closest('[data-ekoa-commenter]')) return;
      const selection = window.getSelection ? window.getSelection() : null;
      const sheet = sheetRef.current;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !sheet) { setAnchor(null); return; }
      const text = selection.toString();
      if (!text || !text.trim()) { setAnchor(null); return; }
      const range = selection.getRangeAt(0);
      if (!sheet.contains(range.commonAncestorContainer)) { setAnchor(null); return; }
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { setAnchor(null); return; }
      // Same invariant the scroll handler enforces: the surface never points at text
      // outside the viewport, where it would sit over an unrelated clause.
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      if (rect.bottom < 0 || rect.top > viewportHeight) { setAnchor(null); return; }
      rangeRef.current = range.cloneRange();
      setAnchor({ top: rect.top, left: rect.left + rect.width / 2, text });
    };
    document.addEventListener('mouseup', onSelect);
    document.addEventListener('keyup', onSelect);
    return () => {
      document.removeEventListener('mouseup', onSelect);
      document.removeEventListener('keyup', onSelect);
    };
  }, [enabled, composing, sheetRef]);

  // Track the selection. Scroll (including the page shift the mobile keyboard causes
  // when the composer autofocuses), resize and visualViewport changes all move the
  // anchor under a fixed-position box, so re-measure the SAME range and follow it;
  // when the range is gone (the preview re-rendered) or has scrolled out of sight,
  // close instead of leaving the surface pointing at the wrong text.
  const anchored = anchor !== null;
  useEffect(() => {
    if (!enabled || !anchored) return undefined;
    const reposition = () => {
      const range = rangeRef.current;
      if (!range) { close(); return; }
      const rect = range.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      if (!rect || (rect.width === 0 && rect.height === 0) || rect.bottom < 0 || rect.top > viewportHeight) {
        close();
        return;
      }
      const top = rect.top;
      const left = rect.left + rect.width / 2;
      setAnchor((prev) => {
        if (!prev) return prev;
        if (Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5) return prev;
        return { ...prev, top, left };
      });
    };
    window.addEventListener('scroll', reposition, true); // capture: the sheet may scroll, not the window
    window.addEventListener('resize', reposition);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', reposition);
      vv.addEventListener('scroll', reposition);
    }
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      if (vv) {
        vv.removeEventListener('resize', reposition);
        vv.removeEventListener('scroll', reposition);
      }
    };
  }, [enabled, anchored, close]);

  if (!enabled || !anchor) return null;

  const isPending = review.pendingKey === 'add-comment';
  const submit = () => {
    const comment = value.trim();
    if (!comment || review.busy) return;
    review.submitOps(
      [{ type: 'modify', target_text: anchor.text, new_text: anchor.text, comment }],
      'add-comment',
    ).then((ok) => { if (ok) close(); });
  };

  const style = { top: `${anchor.top}px`, left: `${anchor.left}px` };
  return (
    <div className="redline-commenter no-print" data-no-pdf="true" data-ekoa-commenter="true" style={style}>
      {!composing ? (
        <button
          type="button"
          className="redline-add-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setComposing(true)}
        >
          Adicionar comentário
        </button>
      ) : (
        <div className="redline-composer redline-composer-float" onMouseDown={(e) => { if (e.target.tagName !== 'TEXTAREA') e.preventDefault(); }}>
          <textarea
            className="redline-textarea"
            rows={3}
            autoFocus
            value={value}
            placeholder="Escreva o seu comentário…"
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="redline-composer-actions">
            <button type="button" className="redline-act redline-act-accept" disabled={review.busy || !value.trim()} onClick={submit}>
              {isPending ? 'A adicionar…' : 'Comentar'}
            </button>
            <button type="button" className="redline-act" disabled={review.busy} onClick={close}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function DocumentBlock({ block }) {
  switch (block.type) {
    case 'heading':
      return <h2 className="doc-heading">{block.text}</h2>;
    case 'clause':
      return (
        <section className="doc-clause">
          <h3 className="doc-clause-title">{block.title}</h3>
          {(block.paragraphs || []).map((p, i) => <p key={i} className="doc-p">{p}</p>)}
        </section>
      );
    case 'list':
      return <ul className="doc-list">{(block.items || []).map((item, i) => <li key={i}>{item}</li>)}</ul>;
    case 'pagebreak':
      return <div className="page-break" />;
    case 'signatures':
      return (
        <div className="doc-signatures">
          {(block.parties || []).map((party, i) => (
            <div key={i} className="doc-signature">
              <div className="doc-signature-line" />
              <div className="doc-signature-label">{party.label}</div>
              {party.detail ? <div className="doc-signature-detail">{party.detail}</div> : null}
            </div>
          ))}
        </div>
      );
    case 'paragraph':
    default:
      return <p className="doc-p" style={block.align ? { textAlign: block.align } : undefined}>{block.text}</p>;
  }
}

const ensureDocx = (name) => (/\.docx$/i.test(name) ? name : `${name}.docx`);

async function fetchDocxBytes(path, options) {
  const res = await window.__ekoa.fetch(path, options);
  if (!res.ok) throw new Error(`Pedido falhou (${res.status})`);
  return res.blob();
}

export default function App() {
  const sourceDocument = documentData.sourceDocument;
  const isSourceLinked = Boolean(sourceDocument && sourceDocument.fileName);
  const sourceFileName = isSourceLinked ? ensureDocx(sourceDocument.fileName) : null;
  const sourceBaseName = sourceFileName ? sourceFileName.replace(/\.docx$/i, '') : null;
  const pdfFileName = isSourceLinked ? sourceBaseName : documentData.fileName;

  const hasNotes = (documentData.notes || []).length > 0;
  const [tab, setTab] = useState('documento');
  const [cloud, setCloud] = useState(null);
  const [cloudState, setCloudState] = useState({ status: 'idle' }); // idle | saving | saved | error
  const [projection, setProjection] = useState({ status: 'loading' }); // loading | ready | error
  const [sourceError, setSourceError] = useState(null);

  // Human review (source-linked only): single in-flight guard + which target is
  // pending (for the per-chip spinner) + a quiet PT-PT error surface.
  const [reviewBusy, setReviewBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState(null);
  const [reviewError, setReviewError] = useState(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const reviewInFlight = useRef(false);
  const sheetRef = useRef(null);

  // Serializes every mutation of the document: rejects a second concurrent submit
  // (the backend serializes per app too, but the UI must reflect it). Both routes
  // answer with the fresh projection, so a 200 re-renders the preview; a failure is
  // translated to PT-PT by reviewFailureMessage and never shown raw. `key` scopes
  // the pending/spinner to one control.
  const postReview = useCallback(async (path, payload, key) => {
    if (reviewInFlight.current) return false;
    if (!window.__ekoa?.fetch) {
      setReviewError(REVIEW_FAILURE_OFFLINE);
      return false;
    }
    reviewInFlight.current = true;
    setReviewBusy(true);
    setPendingKey(key || null);
    setReviewError(null);
    try {
      const res = await window.__ekoa.fetch(path, {
        method: 'POST',
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res.ok) {
        setReviewError(reviewFailureMessage(data, res.status));
        return false;
      }
      if (data && typeof data.markdown === 'string') {
        setProjection({ status: 'ready', markdown: data.markdown });
      }
      return true;
    } catch (_) {
      setReviewError(REVIEW_FAILURE_OFFLINE);
      return false;
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(false);
      setPendingKey(null);
    }
  }, []);

  const submitOps = useCallback((ops, key) => postReview('/api/app-docx/edits', { ops }, key), [postReview]);

  // The recourse for accept/reject: they rewrite the real .docx in place and Word has
  // no undo once a revision is resolved, so the pristine source blob the platform kept
  // is the only way back. Destructive in its own right (it drops every applied
  // decision), so the toolbar asks before calling it.
  const restoreOriginal = useCallback(async () => {
    const ok = await postReview('/api/app-docx/restore', null, 'restore');
    if (ok) setConfirmRestore(false);
    return ok;
  }, [postReview]);

  const reviewCtx = useMemo(
    () => (isSourceLinked ? { enabled: true, busy: reviewBusy, pendingKey, submitOps } : null),
    [isSourceLinked, reviewBusy, pendingKey, submitOps],
  );

  // Source-linked: no PDF while the projection is loading/errored (it would
  // capture a blank sheet). Authored mode is never gated.
  const pdfUnavailable = isSourceLinked && projection.status !== 'ready';
  const projectionEmpty = projection.status === 'ready' && !(projection.markdown || '').trim();

  useEffect(() => {
    if (window.__ekoa?.cloudFiles) {
      window.__ekoa.cloudFiles.status().then(setCloud).catch(() => setCloud(null));
    }
  }, []);

  useEffect(() => {
    if (!isSourceLinked) return undefined;
    if (!window.__ekoa?.fetch) {
      setProjection({ status: 'error' });
      return undefined;
    }
    let cancelled = false;
    window.__ekoa.fetch('/api/app-docx/projection')
      .then((res) => {
        if (!res.ok) throw new Error(`Pedido falhou (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setProjection({ status: 'ready', markdown: data.markdown || '' });
      })
      .catch(() => {
        if (!cancelled) setProjection({ status: 'error' });
      });
    return () => { cancelled = true; };
  }, [isSourceLinked]);

  const downloadWord = useCallback(async () => {
    const blob = await Packer.toBlob(buildDocumentDocx());
    await downloadBlob(blob, `${documentData.fileName}.docx`);
  }, []);

  const downloadTracked = useCallback(async () => {
    setSourceError(null);
    try {
      const blob = await fetchDocxBytes('/api/app-docx/current');
      await downloadBlob(blob, sourceFileName);
    } catch (err) {
      setSourceError(String(err && err.message ? err.message : err));
    }
  }, [sourceFileName]);

  const downloadClean = useCallback(async () => {
    setSourceError(null);
    try {
      const blob = await fetchDocxBytes('/api/app-docx/clean', { method: 'POST' });
      await downloadBlob(blob, `${sourceBaseName}-final.docx`);
    } catch (err) {
      setSourceError(String(err && err.message ? err.message : err));
    }
  }, [sourceBaseName]);

  const downloadPdf = useCallback(async () => {
    setTab('documento'); // the export captures the live DOM - only the document may be visible
    await new Promise((resolve) => setTimeout(resolve, 200));
    await window.__ekoa.exportPdf({ filename: pdfFileName });
  }, [pdfFileName]);

  const downloadNotes = useCallback(async () => {
    const blob = await Packer.toBlob(buildNotesDocx());
    await downloadBlob(blob, `${documentData.fileName}-nota-de-alteracoes.docx`);
  }, []);

  const saveToCloud = useCallback(async (provider) => {
    setCloudState({ status: 'saving', provider });
    try {
      // Source-linked: upload the REAL file (with its tracked changes), never
      // a blocks-generated docx.
      const blob = isSourceLinked
        ? await fetchDocxBytes('/api/app-docx/current')
        : await Packer.toBlob(buildDocumentDocx());
      const meta = await window.__ekoa.cloudFiles.upload(blob, {
        provider,
        name: isSourceLinked ? sourceFileName : `${documentData.fileName}.docx`,
        type: DOCX_MIME,
      });
      setCloudState({ status: 'saved', provider, webUrl: meta.webUrl });
    } catch (err) {
      setCloudState({ status: 'error', provider, message: String(err && err.message ? err.message : err) });
    }
  }, [isSourceLinked, sourceFileName]);

  const providerLabel = { google: 'Google Drive', microsoft: 'OneDrive' };

  return (
    <div className="doc-app">
      <header className="doc-toolbar no-print" data-no-pdf="true">
        <div className="doc-toolbar-title">
          <span className="doc-toolbar-name">{documentData.title}</span>
        </div>
        <div className="doc-toolbar-actions">
          {isSourceLinked ? (
            <>
              <button className="btn btn-primary" onClick={downloadTracked}>Descarregar Word (alterações registadas)</button>
              <button className="btn btn-outline" onClick={downloadClean}>Descarregar versão limpa</button>
              <button
                className="btn btn-outline"
                disabled={reviewBusy || projection.status !== 'ready'}
                onClick={() => setConfirmRestore(true)}
              >
                Repor original
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={downloadWord}>Descarregar Word</button>
          )}
          <button className="btn btn-outline" disabled={pdfUnavailable} onClick={downloadPdf}>Descarregar PDF</button>
          {cloud?.google?.connected && (
            <button className="btn btn-outline" disabled={cloudState.status === 'saving'} onClick={() => saveToCloud('google')}>
              {cloudState.status === 'saving' && cloudState.provider === 'google' ? 'A guardar…' : 'Guardar no Google Drive'}
            </button>
          )}
          {cloud?.microsoft?.connected && (
            <button className="btn btn-outline" disabled={cloudState.status === 'saving'} onClick={() => saveToCloud('microsoft')}>
              {cloudState.status === 'saving' && cloudState.provider === 'microsoft' ? 'A guardar…' : 'Guardar no OneDrive'}
            </button>
          )}
        </div>
        {cloudState.status === 'saved' && (
          <div className="doc-cloud-status ok">
            Guardado no {providerLabel[cloudState.provider]}.{' '}
            {cloudState.webUrl ? <a href={cloudState.webUrl} target="_blank" rel="noreferrer">Abrir</a> : null}
            <button className="doc-cloud-dismiss" onClick={() => setCloudState({ status: 'idle' })}>×</button>
          </div>
        )}
        {cloudState.status === 'error' && (
          <div className="doc-cloud-status err">
            Não foi possível guardar. {cloudState.message}
            <button className="doc-cloud-dismiss" onClick={() => setCloudState({ status: 'idle' })}>×</button>
          </div>
        )}
        {sourceError && (
          <div className="doc-cloud-status err">
            Não foi possível descarregar o documento. {sourceError}
            <button className="doc-cloud-dismiss" onClick={() => setSourceError(null)}>×</button>
          </div>
        )}
        {/* Aceitar/Rejeitar rewrite the real .docx and Word keeps no undo for a resolved
            revision, so this is the way back. It discards the whole review in one step,
            which is exactly why it asks first. */}
        {confirmRestore && (
          <div className="doc-restore-confirm" role="alertdialog" aria-label="Repor o documento original">
            <span className="doc-restore-text">
              Repor o documento original? Todas as alterações aceites, rejeitadas ou comentadas nesta
              revisão são descartadas. O ficheiro original mantém-se intacto.
            </span>
            <span className="doc-restore-actions">
              <button className="btn btn-primary" disabled={reviewBusy} onClick={restoreOriginal}>
                {pendingKey === 'restore' ? 'A repor…' : 'Repor original'}
              </button>
              <button className="btn btn-outline" disabled={reviewBusy} onClick={() => setConfirmRestore(false)}>
                Cancelar
              </button>
            </span>
          </div>
        )}
      </header>

      {isSourceLinked && (
        <div className="doc-source-banner no-print" data-no-pdf="true">
          Documento original: {sourceFileName} - as alterações são registadas (registo de alterações do Word)
        </div>
      )}

      {hasNotes && (
        <nav className="doc-tabs no-print" data-no-pdf="true">
          <button className={tab === 'documento' ? 'doc-tab active' : 'doc-tab'} onClick={() => setTab('documento')}>Documento</button>
          <button className={tab === 'notas' ? 'doc-tab active' : 'doc-tab'} onClick={() => setTab('notas')}>Nota de alterações</button>
        </nav>
      )}

      {tab === 'documento' ? (
        isSourceLinked ? (
          <ReviewContext.Provider value={reviewCtx}>
            <main className="sheet" ref={sheetRef}>
              {projection.status === 'loading' && (
                <p className="redline-status no-print" data-no-pdf="true">A carregar o documento original…</p>
              )}
              {projection.status === 'error' && (
                <p className="redline-status no-print" data-no-pdf="true">
                  Não foi possível apresentar a pré-visualização do documento original. Continua a poder descarregar o documento.
                </p>
              )}
              {projection.status === 'ready' && (projectionEmpty ? (
                <p className="redline-status no-print" data-no-pdf="true">
                  Este documento ainda não tem conteúdo visível.
                </p>
              ) : (
                <RedlinePreview markdown={projection.markdown} />
              ))}
            </main>
            {projection.status === 'ready' && !projectionEmpty && (
              <SelectionCommenter sheetRef={sheetRef} review={reviewCtx} />
            )}
          </ReviewContext.Provider>
        ) : (
          <main className="sheet">
            <h1 className="doc-title">{documentData.title}</h1>
            {documentData.subtitle ? <p className="doc-subtitle">{documentData.subtitle}</p> : null}
            {(documentData.blocks || []).map((block, i) => <DocumentBlock key={i} block={block} />)}
          </main>
        )
      ) : (
        <main className="sheet notes-sheet no-print" data-no-pdf="true">
          <div className="notes-header">
            <h1 className="doc-title">Nota de alterações</h1>
            <button className="btn btn-outline" onClick={downloadNotes}>Descarregar nota (Word)</button>
          </div>
          {(documentData.notes || []).map((note, i) => (
            <section key={i} className="note">
              <h3 className="note-heading">{note.heading}</h3>
              <p className="doc-p">{note.body}</p>
            </section>
          ))}
        </main>
      )}

      {isSourceLinked && reviewError && (
        <div className="redline-toast no-print" data-no-pdf="true" role="alert">
          <span className="redline-toast-text">{reviewError}</span>
          <button type="button" className="redline-toast-dismiss" aria-label="Dispensar" onClick={() => setReviewError(null)}>×</button>
        </div>
      )}
    </div>
  );
}
