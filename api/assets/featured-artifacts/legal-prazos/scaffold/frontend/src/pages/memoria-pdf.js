// Memória de cálculo do prazo em HTML autónomo para window.__ekoa.exportPdf.
// Determinística: gerada exclusivamente do snapshot `resultado` do motor
// (todos os passos, SEM condensar - o documento é a prova da contagem),
// com as citações legais de cada regra aplicada. Sem recursos externos.

function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const CONTAGEM_LABEL = { uteis: 'Dias úteis', corridos: 'Dias corridos' };

/**
 * @param {object} opts
 *  - resultado: snapshot do computePrazo + { titulo, processoId, responsavel }
 *  - processoLabel: número do processo (string, opcional)
 * @returns {{ html: string, filename: string }}
 */
export function memoriaCalculoHtml({ resultado, processoLabel }) {
  const r = resultado;
  const contagem = CONTAGEM_LABEL[r.contagem] || r.contagem;
  const passosRows = r.passos.map((p) => {
    if (p.nota !== undefined) {
      return `<tr><td class="num"></td><td>${esc(p.data)}</td><td>${esc(p.nota)}</td></tr>`;
    }
    if (p.util) {
      return `<tr class="util"><td class="num">${p.dia}</td><td>${esc(p.data)}</td><td>dia útil contado</td></tr>`;
    }
    return `<tr class="skip"><td class="num">-</td><td>${esc(p.data)}</td><td>não conta: ${esc(p.motivo)}</td></tr>`;
  }).join('\n');

  const multaLista = (r.multaDias || []).map((d) => esc(d)).join(', ');

  const html = `<!DOCTYPE html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<title>Memória de cálculo do prazo</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 32px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #555; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
  th, td { border: 1px solid #bbb; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .meta td:first-child { width: 220px; font-weight: bold; background: #fafafa; }
  .num { width: 36px; text-align: right; }
  tr.util td { background: #f6fbf6; }
  tr.skip td { color: #666; }
  .destaque { border: 2px solid #1a1a1a; padding: 12px 16px; margin: 16px 0; }
  .destaque .valor { font-size: 16px; font-weight: bold; }
  .fontes { margin-top: 24px; border-top: 1px solid #bbb; padding-top: 12px; color: #444; font-size: 11px; }
  .fontes h2 { font-size: 12px; margin: 0 0 6px; }
  .fontes ul { margin: 0; padding-left: 18px; }
</style>
</head>
<body>
<h1>Memória de cálculo do prazo</h1>
<p class="sub">Gerada deterministicamente pelo motor de prazos do Ekoa Legal - cada dia da contagem está listado para validação pelo advogado.</p>

<table class="meta">
  <tr><td>Título do prazo</td><td>${esc(r.titulo || '-')}</td></tr>
  <tr><td>Processo</td><td>${esc(processoLabel || '-')}</td></tr>
  <tr><td>Data da notificação</td><td>${esc(r.dataNotificacao)} (não conta - o prazo corre a partir do dia seguinte, CPC art. 138.º)</td></tr>
  <tr><td>Prazo</td><td>${r.dias} dias (${esc(contagem.toLowerCase())})</td></tr>
  <tr><td>Suspende em férias judiciais</td><td>${r.suspendeFerias ? 'Sim (LOSJ art. 28.º; CPC art. 138.º n.º 1)' : 'Não'}</td></tr>
  <tr><td>Regime</td><td>${r.regime === 'cire' ? 'CIRE - prazos contínuos, correm em férias (art. 9.º n.º 1)' : 'CPC (regime geral)'}</td></tr>
  ${r.responsavel ? `<tr><td>Responsável</td><td>${esc(r.responsavel)}</td></tr>` : ''}
</table>

<div class="destaque">
  <div>Data-limite: <span class="valor">${esc(r.dataLimite)}</span></div>
  <div>Prática do acto com multa até: ${esc(r.multaAte)} (CPC art. 139.º n.º 5${multaLista ? ` - dias: ${multaLista}` : ''})</div>
</div>

<h2>Contagem, dia a dia</h2>
<table>
  <thead><tr><th class="num">N.º</th><th>Data</th><th>Nota</th></tr></thead>
  <tbody>
${passosRows}
  </tbody>
</table>

<div class="fontes">
  <h2>Fontes legais aplicadas</h2>
  <ul>
    <li>CPC art. 138.º - início da contagem no dia seguinte à notificação; suspensão em férias judiciais (n.º 1).</li>
    <li>LOSJ (Lei n.º 62/2013, de 26 de agosto) art. 28.º - períodos das férias judiciais.</li>
    <li>Código Civil art. 279.º al. e) - termo em dia não útil transfere para o 1.º dia útil seguinte.</li>
    <li>CPC art. 139.º n.º 5 - prática do acto nos 3 primeiros dias úteis após o termo, com multa.</li>
    ${r.regime === 'cire' ? '<li>CIRE art. 9.º n.º 1 - o processo de insolvência é urgente; os prazos correm em férias judiciais.</li>' : ''}
  </ul>
</div>
</body>
</html>`;

  const filename = `memoria-prazo-${r.dataNotificacao}-${r.dias}${r.contagem}`;
  return { html, filename };
}
