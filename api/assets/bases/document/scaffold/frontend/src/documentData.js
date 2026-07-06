/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DOCUMENT CONTENT — this file is where the document lives.
 *
 *  AGENT: put the user's document here. This is normally the ONLY file you
 *  need to edit. Do NOT rebuild or restyle the shell (App.jsx / index.css):
 *  the toolbar, tabs, Word/PDF exports, cloud-save buttons and print layout
 *  are already implemented and print-tested.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Block types rendered by the shell (and mirrored 1:1 into the .docx):
 *   { type: 'heading',    text }                          — centered uppercase section header
 *   { type: 'clause',     title, paragraphs: [] }         — bold title + justified paragraphs
 *   { type: 'paragraph',  text, align?: 'justify'|'center'|'left' }
 *   { type: 'list',       items: [] }                     — bulleted list
 *   { type: 'pagebreak' }                                 — force a new page (print + docx)
 *   { type: 'signatures', parties: [{ label, detail? }] } — signature lines side by side
 *
 * `notes` is the companion "Nota de alterações" (what changed and why) shown
 * in its own tab with its own separate download. It is NEVER included in the
 * document's Word/PDF exports.
 */
const documentData = {
  fileName: 'documento',
  title: 'TÍTULO DO DOCUMENTO',
  subtitle: '',
  blocks: [
    { type: 'paragraph', text: 'Substitua este conteúdo pelo documento do utilizador (contrato, parecer, relatório, carta).' },
  ],
  notes: [],
};

export default documentData;
