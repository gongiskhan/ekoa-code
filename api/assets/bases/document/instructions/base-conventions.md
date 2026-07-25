---
name: base-conventions
description: Conventions for document base — downloadable Word/PDF document (pre-built shell)
---

# Base Conventions — document

This base produces a **downloadable document**: a contract, legal opinion (parecer), report, proposal, minute, or formal letter. The deliverable is the FILE the user takes away.

## THE SHELL IS ALREADY BUILT — put the content in `documentData.js`

The project was scaffolded from the platform's print-tested document shell:

- `frontend/src/documentData.js` — **the document content. This is normally the ONLY file you edit.**
- `frontend/src/App.jsx` — the shell: toolbar (Descarregar Word / Descarregar PDF / Guardar no Google Drive / Guardar no OneDrive — cloud buttons appear automatically only when that integration is connected), Documento/Nota de alterações tabs, the .docx builder, and the PDF export wiring.
- `frontend/src/index.css` — screen + print styles, including the `@page` A4 margins the PDF depends on.

**Do NOT rebuild or restyle the shell.** Do not remove the toolbar, change the export functions, or alter the print rules — the Word/PDF quality is guaranteed by them. Touch `App.jsx`/`index.css` only for user-requested EXTRAS (e.g. fill-in fields for placeholders, an additional tab), keeping every existing export path intact.

The export APIs the shell already wires (only relevant if the user asks for an EXTRA export
control — never rebuild the shipped ones): PDF is server-rendered from the live DOM via
`window.__ekoa.exportPdf({ filename, format: 'A4' | 'Letter' | 'Legal', landscape })`; Word builds
the `.docx` from the SAME data with the `docx` library (`import { Document, Packer, Paragraph,
TextRun, HeadingLevel } from 'docx'`) and downloads via the anchor pattern
(`URL.createObjectURL` + click), no extra libraries; cloud save (when Google Workspace / Microsoft
365 is connected) is `window.__ekoa.cloudFiles`. A document is never delivered without working
download buttons — which is exactly why the shell ships them pre-built.

## Filling `documentData.js`

Block types (rendered on screen and mirrored 1:1 into the .docx):

| type | fields | use for |
|------|--------|---------|
| `heading` | `text` | centered uppercase section headers (PREÂMBULO, ANEXO I) |
| `clause` | `title`, `paragraphs[]` | numbered clauses — `title: 'CLÁUSULA 1.ª (DEFINIÇÕES)'` |
| `paragraph` | `text`, `align?` | plain prose |
| `list` | `items[]` | bulleted enumerations |
| `pagebreak` | — | force a new page (print + docx) |
| `signatures` | `parties: [{ label, detail? }]` | signature lines |

Also set `fileName` (download base name, no extension), `title`, optional `subtitle`, and `notes` (see below).

## Revision requests produce the FULL edited document

When the user asks to revise/amend an existing document ("reve este contrato", "faz as alterações"), `blocks` must contain the **complete document with the changes applied in place** — every clause present, revised where needed, unchanged where not. Do NOT produce an addendum/"aditamento" that only lists replacement clauses, unless the user explicitly asks for one.

## Documento de origem (registo de alterações nativo)

When the user supplies an **existing Word file** (upload attachment path, URL, or a Drive/OneDrive file), do **NOT** re-author it into `blocks` - that would destroy the original formatting and lose the revision history. Use the platform's docx tools instead, so every edit becomes a **native Word tracked change** (visible in Word's review pane, accept/reject per change):

1. **`docx_source_set`** - register the source file (path/url/cloud reference). This makes it the app's working document.
2. **`docx_read`** - read the CriticMarkup projection of the current document. Existing tracked changes and comments are visible as `{++ins++}`/`{--del--}` spans with `[Chg:n]` markers and `[Com:n]` comment markers - read them before editing.
3. **`docx_apply_edits`** - apply every edit as native tracked changes, with optional comments. Op vocabulary:
   - **modify**: `{ type: 'modify', target_text, new_text }` - `target_text` must be EXACT text copied from the projection; prefer whole-sentence targets (short fragments are often ambiguous and the batch fails with an occurrence list).
   - **delete**: modify with `new_text: ''`.
   - **comment only**: modify with `new_text` equal to `target_text` plus a `comment`.
   - **insert**: `new_text` = target followed by `\n` continuation lines. Plain continuation lines clone the anchor paragraph's formatting **including numbering** - the correct way to continue numbered clauses. `# ` prefix makes a heading. **Never use `1.` markdown markers in inserted lines** (they map to a list style and break the document's real numbering).
   - **accept / reject**: `{ type: 'accept' | 'reject', target_id }` - resolve a PENDING tracked change; `target_id` is the `n` from its `[Chg:n]` marker in the projection. When the user asks to accept or reject existing changes ("aceita/rejeita as alterações do advogado X"), use these ops - never re-modify the text to simulate the outcome.
   - **reply**: `{ type: 'reply', target_id, text }` - answer a comment thread; `target_id` is the `n` from its `[Com:n]` marker. Responding to a comment ("responde ao comentário") is a `reply`, not a new modify-with-comment.
   - **match_mode** (modify only): `'strict'` (default) fails with an occurrence list when `target_text` matches more than once; pass `'first'` or `'all'` only when the repetition is intentional (e.g. rename a defined term everywhere with `'all'`).
   - Batch all related edits in ONE call; the platform dry-runs the whole batch and only commits when every edit resolves.
4. Then set `documentData.sourceDocument = { fileName: 'nome-original.docx' }` and keep `blocks` **empty** - the shell switches to source-linked mode (redline preview + downloads of the real file). Still fill `notes[]` with the "Nota de alterações" summary.

**Comments vs tracked changes:** comments are for observations and questions ("Rever prazo: 30 dias pode ser insuficiente"); tracked changes are for the actual edits to the text. Never write an edit as a comment or an observation as an edit.

The authored-mode conventions below stay unchanged for documents written from scratch.

## Notes = the companion explanation, never part of the document

Put "what changed and why" (or any commentary) into `notes: [{ heading, body }]`. The shell shows them in their own tab with their own separate Word download, and guarantees they NEVER appear in the document's Word/PDF exports. Keep the document itself a clean, signable text.

## Formal register

Document text is formal, in the user's language (PT-PT by default), faithful to any source material the user provided — apply ONLY the requested changes. Cited-or-silent for legal content: statutes/articles/case references only when grounded (knowledge base or the user's own text). The shell already enforces the visual register (serif, black text, A4 margins, no UI chrome in exports) — content should not fight it.

## Fetching a source document from cloud storage

When the user asks to work on a file that lives in Drive/OneDrive: `window.__ekoa.cloudFiles.list(provider, query)` to find it, `window.__ekoa.cloudFiles.download(provider, id)` → `{ name, type, blob }` (Google-native Docs arrive converted to .docx). Extract what you need and fill `documentData.js`. Exception: when the deliverable is that Word file EDITED (revisions to an existing .docx), use the source-linked flow above (docx tools) instead of re-authoring it.

## Visual styling — runtime tokens

`index.html` links `/api/design-tokens.css`; the shell's toolbar uses `var(--color-primary, …)` and the CSS_VARS_CONTRACT vocabulary. The document sheet itself deliberately stays brand-neutral (formal print register).
