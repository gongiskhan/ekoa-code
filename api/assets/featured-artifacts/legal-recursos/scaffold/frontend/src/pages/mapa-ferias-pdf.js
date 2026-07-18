/*
 * Mapa de férias da equipa em HTML autónomo para window.__ekoa.exportPdf.
 * Determinístico: gerado exclusivamente do snapshot já calculado na página
 * (pessoas + fatias de férias do mês, com estado aprovada/pedida). Sem recursos
 * externos e sem relógio interno - a data de geração entra explícita. PT-PT.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const ESTADO_LABEL = { aprovada: 'Aprovada', pedida: 'Pedida' };

/**
 * @param {object} opts
 *  - mesLabel: rótulo do mês, ex. "Julho de 2026" (string)
 *  - dias: número de dias do mês (int, para a régua)
 *  - linhas: Array<{ nome: string, barras: Array<{ startDay, endDay, estado, dataInicio, dataFim }> }>
 *  - geradoEm: 'YYYY-MM-DD' (data de geração, explícita)
 * @returns {{ html: string, filename: string }}
 */
export function mapaFeriasHtml({ mesLabel, dias, linhas, geradoEm }) {
  const linhasList = Array.isArray(linhas) ? linhas : [];
  const totalBarras = linhasList.reduce((acc, l) => acc + (Array.isArray(l.barras) ? l.barras.length : 0), 0);

  const linhasRows = linhasList.map((l) => {
    const cells = [];
    for (let d = 1; d <= dias; d += 1) {
      const barra = (l.barras || []).find((b) => d >= b.startDay && d <= b.endDay);
      if (!barra) {
        cells.push('<td class="cel"></td>');
      } else {
        const cls = barra.estado === 'aprovada' ? 'cel aprovada' : 'cel pedida';
        cells.push(`<td class="${cls}" title="${esc(ESTADO_LABEL[barra.estado] || barra.estado)}"></td>`);
      }
    }
    return `<tr><th class="pessoa">${esc(l.nome)}</th>${cells.join('')}</tr>`;
  }).join('\n');

  const legendaLista = linhasList
    .filter((l) => (l.barras || []).length > 0)
    .map((l) => {
      const periodos = (l.barras || [])
        .map((b) => `${esc(b.dataInicio)} a ${esc(b.dataFim)} (${esc(ESTADO_LABEL[b.estado] || b.estado)})`)
        .join('; ');
      return `<tr><td>${esc(l.nome)}</td><td>${periodos}</td></tr>`;
    })
    .join('\n');

  const cabecalhoDias = Array.from({ length: dias }, (_, i) => `<th class="dia">${i + 1}</th>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<title>Mapa de férias - ${esc(mesLabel)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 28px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #555; margin: 0 0 16px; }
  table.mapa { border-collapse: collapse; width: 100%; margin: 8px 0 20px; table-layout: fixed; }
  table.mapa th, table.mapa td { border: 1px solid #ccc; }
  table.mapa th.dia { font-size: 9px; text-align: center; padding: 2px 0; width: 2.4%; background: #f3f3f3; }
  table.mapa th.pessoa { text-align: left; padding: 4px 8px; width: 22%; background: #fafafa; font-size: 11px; }
  table.mapa td.cel { height: 16px; }
  table.mapa td.cel.aprovada { background: #1a3d5c; }
  table.mapa td.cel.pedida { background: repeating-linear-gradient(45deg, #ffffff, #ffffff 3px, #9db6cc 3px, #9db6cc 6px); }
  .legenda-tabela { border-collapse: collapse; width: 100%; }
  .legenda-tabela th, .legenda-tabela td { border: 1px solid #bbb; padding: 4px 8px; text-align: left; vertical-align: top; }
  .legenda-tabela th { background: #f0f0f0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .chaves { margin: 12px 0; font-size: 11px; color: #444; }
  .chaves span { display: inline-block; margin-right: 16px; }
  .amostra { display: inline-block; width: 18px; height: 10px; vertical-align: middle; margin-right: 4px; border: 1px solid #ccc; }
  .amostra.aprovada { background: #1a3d5c; }
  .amostra.pedida { background: repeating-linear-gradient(45deg, #ffffff, #ffffff 3px, #9db6cc 3px, #9db6cc 6px); }
  .rodape { margin-top: 20px; border-top: 1px solid #bbb; padding-top: 10px; color: #666; font-size: 10px; }
</style>
</head>
<body>
<h1>Mapa de férias da equipa</h1>
<p class="sub">${esc(mesLabel)} - gerado em ${esc(geradoEm)}. Uma linha por pessoa; cada dia do mês marcado quando há férias.</p>

<div class="chaves">
  <span><span class="amostra aprovada"></span> Férias aprovadas</span>
  <span><span class="amostra pedida"></span> Férias pedidas (por aprovar)</span>
</div>

<table class="mapa">
  <thead><tr><th class="pessoa">Pessoa</th>${cabecalhoDias}</tr></thead>
  <tbody>
${linhasRows}
  </tbody>
</table>

<h2 style="font-size:13px;margin:0 0 6px;">Períodos, em texto</h2>
${totalBarras > 0
    ? `<table class="legenda-tabela"><thead><tr><th>Pessoa</th><th>Períodos no mês</th></tr></thead><tbody>${legendaLista}</tbody></table>`
    : '<p class="sub">Sem férias marcadas neste mês.</p>'}

<div class="rodape">
  Documento interno de gestão de equipa. As férias regem-se pelo Código do Trabalho (art. 237.º e seguintes);
  o direito e o saldo de cada pessoa são calculados na respetiva ficha.
</div>
</body>
</html>`;

  const filename = `mapa-ferias-${esc(geradoEm)}`;
  return { html, filename };
}
