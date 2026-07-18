/*
 * HTML de impressão da agenda (dia e semana) para o exportPdf da plataforma.
 * Determinista: o mesmo estado da espinha gera sempre o mesmo HTML. Sem
 * scripts, sem rede - só marcação com estilos embutidos, pensada para A4.
 */

import { eventoTipoLabel, horaDe, rotuloDia } from './agenda-logic.js';

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  body { font-family: Georgia, 'Times New Roman', serif; color: #1f2937; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #6b7280; margin: 0 0 16px; }
  .dia { margin: 0 0 14px; page-break-inside: avoid; }
  .dia h2 { font-size: 14px; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; margin: 0 0 6px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { font-size: 12px; padding: 2px 0; }
  .hora { display: inline-block; min-width: 84px; font-variant-numeric: tabular-nums; }
  .tipo { color: #6b7280; }
  .vazio { font-size: 12px; color: #9ca3af; }
`;

/* Um dia da agenda como secção; cell = { eventos, reservas } (já ordenadas). */
function seccaoDia(dia, cell, tipoNome) {
  const eventos = (cell && cell.eventos) || [];
  const reservas = (cell && cell.reservas) || [];
  const linhas = [];
  for (const e of eventos) {
    linhas.push(
      `<li><span class="hora">dia inteiro</span> ${escapeHtml(e.titulo || 'Evento')} <span class="tipo">(${escapeHtml(eventoTipoLabel(e.tipo))})</span></li>`,
    );
  }
  for (const r of reservas) {
    linhas.push(
      `<li><span class="hora">${escapeHtml(horaDe(r.inicio))}-${escapeHtml(horaDe(r.fim))}</span> ${escapeHtml(r.nome || 'Cliente')} <span class="tipo">(${escapeHtml(tipoNome(r.sessaoTipoId))})</span></li>`,
    );
  }
  const corpo = linhas.length === 0 ? '<p class="vazio">Sem marcações.</p>' : `<ul>${linhas.join('')}</ul>`;
  return `<section class="dia"><h2>${escapeHtml(rotuloDia(dia))} · ${escapeHtml(dia)}</h2>${corpo}</section>`;
}

/*
 * HTML completo. `dias` são 'YYYY-MM-DD' pela ordem a imprimir; `porDia` é um
 * Map dia -> { eventos, reservas }; `tipoNome(id)` resolve o nome do tipo de
 * sessão. Serve o dia (1 dia) e a semana (7 dias).
 */
export function htmlAgendaPrint({ titulo, subtitulo, dias, porDia, tipoNome }) {
  const seccoes = (dias || [])
    .map((dia) => seccaoDia(dia, porDia.get(dia), tipoNome))
    .join('');
  return [
    '<!doctype html><html lang="pt-PT"><head><meta charset="utf-8">',
    `<title>${escapeHtml(titulo)}</title><style>${CSS}</style></head><body>`,
    `<h1>${escapeHtml(titulo)}</h1>`,
    `<p class="sub">${escapeHtml(subtitulo || '')}</p>`,
    seccoes,
    '</body></html>',
  ].join('');
}
