// Exportação PDF pelo canal da plataforma (window.__ekoa.exportPdf ->
// POST /api/app-pdf). O documento é construído a partir da própria memória de
// cálculo (texto determinístico do motor + fundamentação citada); quando a
// ponte não existe (ex.: pré-visualização fora da plataforma) o chamador cai
// no window.print() - nunca se finge uma exportação que não aconteceu.

export function pdfDisponivel() {
  return Boolean(
    typeof window !== 'undefined' &&
    window.__ekoa &&
    typeof window.__ekoa.exportPdf === 'function',
  );
}

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ESTILOS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a202c; margin: 32px 40px; font-size: 12px; line-height: 1.55; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitulo { color: #4a5568; margin: 0 0 20px; font-size: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
  h2 { font-size: 13px; margin: 20px 0 6px; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #4a5568; }
  td.numeric, th.numeric { text-align: right; font-variant-numeric: tabular-nums; }
  tr.destaque td { font-weight: 600; }
  .aviso-legal { font-weight: 600; margin-top: 16px; }
  .rodape { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 10px; }
`;

export function documentoHtml({ titulo, subtitulo, corpoHtml, rodape }) {
  return [
    '<!DOCTYPE html>',
    '<html lang="pt"><head><meta charset="utf-8">',
    `<title>${escapeHtml(titulo || 'Documento')}</title>`,
    `<style>${ESTILOS}</style>`,
    '</head><body>',
    `<h1>${escapeHtml(titulo || 'Documento')}</h1>`,
    subtitulo ? `<p class="subtitulo">${escapeHtml(subtitulo)}</p>` : '',
    corpoHtml || '',
    rodape ? `<p class="rodape">${escapeHtml(rodape)}</p>` : '',
    '</body></html>',
  ].join('');
}

export async function exportarPdf({ titulo, subtitulo, corpoHtml, rodape, filename, landscape }) {
  if (!pdfDisponivel()) throw new Error('Exportação PDF indisponível fora da plataforma.');
  const html = documentoHtml({ titulo, subtitulo, corpoHtml, rodape });
  return window.__ekoa.exportPdf({
    html,
    filename: filename || titulo || 'documento',
    format: 'A4',
    landscape: Boolean(landscape),
  });
}
