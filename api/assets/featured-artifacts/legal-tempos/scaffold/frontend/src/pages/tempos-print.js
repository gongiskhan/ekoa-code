/*
 * HTML da folha de tempos semanal para o exportPdf da plataforma.
 * Determinista: a mesma semana agrupada (agruparSemana) gera sempre o mesmo
 * HTML. Sem scripts, sem rede - marcação com estilos embutidos, pensada para A4.
 */

import { formatDuracao, ESTADO_LABEL } from './tempos-logic.js';

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
  .sub { font-size: 12px; color: #6b7280; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 14px; }
  th, td { font-size: 12px; text-align: left; padding: 4px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { border-bottom: 1px solid #9ca3af; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dia-row td { background: #f3f4f6; font-weight: 600; }
  .muted { color: #6b7280; }
  tfoot td { border-top: 1px solid #9ca3af; border-bottom: 0; font-weight: 600; }
`;

/*
 * Folha semanal: uma linha de cabeçalho por dia com o total do dia, seguida dos
 * registos desse dia. `semana` vem de agruparSemana; `processoNumero(id)`
 * resolve o número do processo.
 */
export function htmlFolhaSemana({ semana, processoNumero }) {
  const corpo = [];
  for (const dia of semana.dias) {
    corpo.push(
      `<tr class="dia-row"><td colspan="3">${escapeHtml(dia.label)} · ${escapeHtml(dia.iso)}</td>` +
      `<td class="num">${escapeHtml(dia.minutos > 0 ? formatDuracao(dia.minutos) : '-')}</td></tr>`,
    );
    for (const r of dia.registos) {
      const proc = r.processoId ? processoNumero(r.processoId) : 'Sem processo';
      const estado = ESTADO_LABEL[r.estado] || r.estado || '';
      const fat = r.faturavel ? 'Faturável' : 'Não faturável';
      corpo.push(
        `<tr><td>${escapeHtml(r.descricao || '(sem descrição)')}</td>` +
        `<td class="muted">${escapeHtml(proc)}</td>` +
        `<td class="muted">${escapeHtml(fat)} · ${escapeHtml(estado)}</td>` +
        `<td class="num">${escapeHtml(formatDuracao(r.minutos))}</td></tr>`,
      );
    }
  }
  return [
    '<!doctype html><html lang="pt-PT"><head><meta charset="utf-8">',
    `<title>Folha de tempos ${escapeHtml(semana.inicioISO)}</title><style>${CSS}</style></head><body>`,
    `<h1>Folha de tempos semanal</h1>`,
    `<p class="sub">${escapeHtml(semana.inicioISO)} a ${escapeHtml(semana.fimISO)} · registos da espinha partilhada do escritório</p>`,
    '<table><thead><tr><th>Descrição</th><th>Processo</th><th>Faturação · Estado</th><th class="num">Duração</th></tr></thead>',
    `<tbody>${corpo.join('')}</tbody>`,
    '<tfoot>',
    `<tr><td colspan="3">Total da semana</td><td class="num">${escapeHtml(semana.total > 0 ? formatDuracao(semana.total) : '-')}</td></tr>`,
    `<tr><td colspan="3">Faturável</td><td class="num">${escapeHtml(semana.totalFaturavel > 0 ? formatDuracao(semana.totalFaturavel) : '-')}</td></tr>`,
    `<tr><td colspan="3">Não faturável</td><td class="num">${escapeHtml(semana.totalNao > 0 ? formatDuracao(semana.totalNao) : '-')}</td></tr>`,
    '</tfoot></table>',
    '</body></html>',
  ].join('');
}
