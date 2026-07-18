/*
 * Declaração RCBE pré-preenchida + checklist de submissão assistida, em HTML
 * autónomo para window.__ekoa.exportPdf. Determinístico: gerado do mesmo snapshot
 * já mostrado no ecrã (entidade, beneficiários deduplicados, obrigações, passos do
 * portal). Sem recursos externos e sem relógio interno - a data de geração entra
 * explícita. O RCBE não tem API: o documento é um auxiliar da submissão MANUAL no
 * Portal da Justiça, não uma submissão. PT-PT, sem emoji. Base: Lei n.º 89/2017
 * (RJRCBE) e Portaria n.º 233/2018.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * @param {object} opts
 *  - entidade: { nome, nipc, formaJuridica }
 *  - beneficiarios: Array<{ nome, nif, natureza, percentagem }> (JÁ deduplicados)
 *  - obrigacoes: Array<{ tipoLabel, dataLimite, estado }> (linhas do calendário)
 *  - passos: Array<{ texto, feito }> (checklist do portal, com estado atual)
 *  - portalUrl: deep-link do Portal da Justiça (string) - LINK apenas
 *  - geradoEm: 'YYYY-MM-DD'
 * @returns {{ html: string, filename: string }}
 */
export function declaracaoRcbeHtml({ entidade = {}, beneficiarios = [], obrigacoes = [], passos = [], portalUrl = '', geradoEm = '' }) {
  const bos = Array.isArray(beneficiarios) ? beneficiarios : [];
  const obr = Array.isArray(obrigacoes) ? obrigacoes : [];
  const chk = Array.isArray(passos) ? passos : [];

  const bosRows = bos.length > 0
    ? bos.map((b) => `<tr>
        <td>${esc(b.nome)}</td>
        <td class="mono">${esc(b.nif || '-')}</td>
        <td>${esc(b.natureza || 'capital')}</td>
        <td class="num">${esc(b.percentagem)}%</td>
      </tr>`).join('\n')
    : '<tr><td colspan="4" class="vazio">Sem beneficiários a 25% ou mais: declara-se a direção de topo (art. 30.º da Lei n.º 83/2017).</td></tr>';

  const obrRows = obr.length > 0
    ? obr.map((o) => `<tr>
        <td>${esc(o.tipoLabel)}</td>
        <td class="mono">${esc(o.dataLimite)}</td>
        <td>${esc(o.estado)}</td>
      </tr>`).join('\n')
    : '<tr><td colspan="3" class="vazio">Sem obrigações devidas com os dados atuais.</td></tr>';

  const chkItems = chk.map((p) => {
    const marca = p.feito ? '[X]' : '[ ]';
    return `<li class="${p.feito ? 'feito' : ''}"><span class="caixa">${marca}</span> ${esc(p.texto)}</li>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<title>Declaração RCBE - ${esc(entidade.nome)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 32px; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 22px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  .sub { color: #555; margin: 0 0 4px; }
  .meta { color: #555; font-size: 11px; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0; }
  th, td { border: 1px solid #bbb; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num { text-align: right; }
  td.mono, .mono { font-family: 'Courier New', monospace; }
  td.vazio { color: #666; font-style: italic; }
  ul.checklist { list-style: none; margin: 6px 0; padding: 0; }
  ul.checklist li { margin: 4px 0; }
  ul.checklist li.feito { color: #1a5c2e; }
  .caixa { font-family: 'Courier New', monospace; font-weight: bold; margin-right: 6px; }
  .portal { font-size: 11px; word-break: break-all; }
  .rodape { margin-top: 22px; border-top: 1px solid #bbb; padding-top: 10px; color: #666; font-size: 10px; }
</style>
</head>
<body>
<h1>Declaração RCBE - pré-preenchida</h1>
<p class="sub">${esc(entidade.nome)} - NIPC ${esc(entidade.nipc || '-')} - ${esc(entidade.formaJuridica || 'sociedade')}</p>
<p class="meta">Documento de apoio à submissão assistida. Gerado em ${esc(geradoEm)}. O RCBE não tem API: a submissão faz-se manualmente no Portal da Justiça.</p>

<h2>Beneficiários efetivos (25% ou mais do capital ou dos direitos de voto)</h2>
<table>
  <thead><tr><th>Nome</th><th>NIF/NIPC</th><th>Natureza</th><th>Participação</th></tr></thead>
  <tbody>
${bosRows}
  </tbody>
</table>

<h2>Calendário de obrigações</h2>
<table>
  <thead><tr><th>Obrigação</th><th>Limite</th><th>Estado</th></tr></thead>
  <tbody>
${obrRows}
  </tbody>
</table>

<h2>Checklist de submissão no Portal da Justiça</h2>
<ul class="checklist">
${chkItems}
</ul>
<p class="portal">Portal: ${esc(portalUrl)}</p>

<div class="rodape">
  Base legal: Regime Jurídico do Registo Central do Beneficiário Efetivo (Lei n.º 89/2017, de 21 de agosto)
  e Portaria n.º 233/2018, de 21 de agosto. Este documento não substitui a submissão oficial nem
  a consulta às bases da Justiça - a validade da declaração depende da sua submissão no portal RCBE.
</div>
</body>
</html>`;

  const nipc = esc(entidade.nipc || 'sem-nipc');
  const filename = `declaracao-rcbe-${nipc}-${esc(geradoEm)}`;
  return { html, filename };
}
