// Dossiê completo do processo em HTML autónomo para window.__ekoa.exportPdf.
// Determinístico: gerado exclusivamente das fatias da espinha já filtradas pelo
// processo (cliente, processo, cronologia ordenada, prazos, documentos,
// comunicações). Sem recursos externos - tudo inline, XSS-seguro via esc().
//
// Estrutura do documento (a "impressão de um clique"):
//   1. CAPA - número do processo, tribunal, cliente, data de compilação, contagens.
//   2. CRONOLOGIA - eventos por ordem ASCENDENTE (a mesma do separador Dossiê).
//   3. ÍNDICE DE DOCUMENTOS - tabela numerada (nome, tipo, origem, data).
// Prazos e comunicações entram como secções de apoio depois do índice.

function esc(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/* dd/mm/aaaa determinístico; entradas inválidas caem para travessão. */
function fmtData(value) {
  if (!value) return '-';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return '-';
  const d = new Date(t);
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

const ORIGEM_LABEL = {
  upload: 'Carregado',
  'legal-correio': 'Correio',
  'legal-assinatura': 'Assinatura',
  'legal-forms': 'Formulário',
  'legal-contratos': 'Contrato',
  'legal-pecas': 'Peça',
  citius: 'Citius',
};

function origemTexto(origem) {
  if (!origem) return '-';
  return ORIGEM_LABEL[origem] || origem;
}

/*
 * Ordena a cronologia por ordem ascendente (mais antigo primeiro), com o mesmo
 * critério de desempate do separador Dossiê: datas válidas primeiro, depois
 * createdAt. É a ordem em que a história do processo se lê.
 */
function cronologiaAscendente(eventos) {
  return (Array.isArray(eventos) ? eventos.slice() : []).sort((a, b) => {
    const ta = Date.parse(a && a.data);
    const tb = Date.parse(b && b.data);
    const va = !Number.isNaN(ta);
    const vb = !Number.isNaN(tb);
    if (va && vb) return ta - tb;
    if (va) return -1;
    if (vb) return 1;
    return String((a && a.createdAt) || '').localeCompare(String((b && b.createdAt) || ''));
  });
}

/**
 * @param {object} opts
 *  - processo, cliente: linhas da espinha (cliente pode ser null)
 *  - eventos, prazos, documentos, comunicacoes: fatias já filtradas pelo processo
 * @returns {{ html: string, filename: string }}
 */
export function dossiePdfHtml({ processo, cliente, eventos, prazos, documentos, comunicacoes }) {
  const numero = (processo && processo.numeroProcesso) || '(sem número)';
  const hoje = fmtData(new Date().toISOString());

  const evs = cronologiaAscendente(eventos);
  const docs = Array.isArray(documentos) ? documentos.slice() : [];
  const prz = Array.isArray(prazos) ? prazos.slice() : [];
  const coms = (Array.isArray(comunicacoes) ? comunicacoes.slice() : []).sort(
    (a, b) => String((b && (b.receivedAt || b.createdAt)) || '').localeCompare(String((a && (a.receivedAt || a.createdAt)) || '')),
  );

  const cronologiaRows = evs.length === 0
    ? '<tr><td colspan="3" class="vazio">Sem eventos registados neste processo.</td></tr>'
    : evs.map((e) => `<tr>
        <td class="data">${esc(fmtData(e.data))}</td>
        <td class="titulo">${esc(e.titulo || '(sem título)')}${e.tipo ? ` <span class="tag">${esc(e.tipo)}</span>` : ''}</td>
        <td>${esc(e.descricao || '')}</td>
      </tr>`).join('\n');

  const documentoRows = docs.length === 0
    ? '<tr><td colspan="5" class="vazio">Sem documentos registados neste processo.</td></tr>'
    : docs.map((d, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td class="titulo">${esc(d.nome || '(sem nome)')}</td>
        <td>${esc(d.tipo || '-')}</td>
        <td>${esc(origemTexto(d.origem))}</td>
        <td class="data">${esc(fmtData(d.data || d.createdAt))}</td>
      </tr>`).join('\n');

  const prazoRows = prz.length === 0
    ? '<tr><td colspan="3" class="vazio">Sem prazos registados neste processo.</td></tr>'
    : prz.map((p) => `<tr>
        <td class="titulo">${esc(p.titulo || p.descricao || '(sem título)')}</td>
        <td class="data">${esc(fmtData(p.dataLimite))}</td>
        <td>${esc(p.estado || '-')}</td>
      </tr>`).join('\n');

  const comunicacaoRows = coms.length === 0
    ? '<tr><td colspan="4" class="vazio">Sem comunicações associadas a este processo.</td></tr>'
    : coms.map((c) => `<tr>
        <td>${c.canal === 'whatsapp' ? 'WhatsApp' : 'Email'}</td>
        <td class="titulo">${esc(c.fromName || c.fromAddr || '-')}</td>
        <td>${esc(c.subject || (c.body ? `${String(c.body).slice(0, 80)}…` : '-'))}</td>
        <td class="data">${esc(fmtData(c.receivedAt || c.createdAt))}</td>
      </tr>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<title>Dossiê do processo ${esc(numero)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 0; font-size: 12px; }
  .capa { padding: 64px 40px; border-bottom: 3px solid #16304c; }
  .capa .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px; color: #16304c; margin: 0 0 8px; }
  .capa h1 { font-size: 26px; margin: 0 0 6px; font-variant-numeric: tabular-nums; }
  .capa .sub { color: #444; margin: 0 0 24px; font-size: 14px; }
  .capa .ident { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; font-size: 12.5px; }
  .capa .ident dt { font-weight: bold; color: #333; }
  .capa .ident dd { margin: 0; }
  .capa .contagens { margin-top: 24px; display: flex; gap: 28px; flex-wrap: wrap; }
  .capa .contagens .tile { border: 1px solid #ccc; border-radius: 6px; padding: 8px 16px; text-align: center; }
  .capa .contagens .n { font-size: 20px; font-weight: bold; display: block; }
  .capa .contagens .l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #666; }
  main { padding: 32px 40px; }
  section { margin: 0 0 28px; break-inside: avoid; }
  h2 { font-size: 15px; margin: 0 0 10px; padding-bottom: 4px; border-bottom: 1px solid #16304c; color: #16304c; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f2f5; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num { width: 32px; text-align: right; color: #666; }
  td.data { white-space: nowrap; font-variant-numeric: tabular-nums; width: 96px; }
  td.titulo { font-weight: bold; }
  td.vazio { color: #777; font-style: italic; text-align: center; }
  .tag { font-weight: normal; font-size: 10px; color: #16304c; border: 1px solid #cbd5e1; border-radius: 3px; padding: 0 4px; }
  footer { padding: 16px 40px 32px; color: #777; font-size: 10px; border-top: 1px solid #ddd; }
</style>
</head>
<body>
<div class="capa">
  <p class="eyebrow">Dossiê do processo</p>
  <h1>${esc(numero)}</h1>
  <p class="sub">${esc((processo && processo.tribunal) || 'Tribunal por indicar')}${processo && processo.comarca ? ` · ${esc(processo.comarca)}` : ''}</p>
  <dl class="ident">
    <dt>Cliente</dt><dd>${esc((cliente && cliente.nome) || 'Sem cliente associado')}</dd>
    <dt>NIF</dt><dd>${esc((cliente && cliente.nif) || '-')}</dd>
    <dt>Área</dt><dd>${esc((processo && processo.area) || '-')}</dd>
    <dt>Estado</dt><dd>${esc((processo && processo.estado) || '-')}</dd>
    <dt>Advogado responsável</dt><dd>${esc((processo && processo.advogadoResponsavel) || '-')}</dd>
    <dt>Compilado em</dt><dd>${esc(hoje)}</dd>
  </dl>
  <div class="contagens">
    <div class="tile"><span class="n">${evs.length}</span><span class="l">Eventos</span></div>
    <div class="tile"><span class="n">${docs.length}</span><span class="l">Documentos</span></div>
    <div class="tile"><span class="n">${prz.length}</span><span class="l">Prazos</span></div>
    <div class="tile"><span class="n">${coms.length}</span><span class="l">Comunicações</span></div>
  </div>
</div>

<main>
  <section>
    <h2>Cronologia do processo</h2>
    <table>
      <thead><tr><th>Data</th><th>Evento</th><th>Descrição</th></tr></thead>
      <tbody>
${cronologiaRows}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Índice de documentos</h2>
    <table>
      <thead><tr><th class="num">N.º</th><th>Nome</th><th>Tipo</th><th>Origem</th><th>Data</th></tr></thead>
      <tbody>
${documentoRows}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Prazos</h2>
    <table>
      <thead><tr><th>Prazo</th><th>Data-limite</th><th>Estado</th></tr></thead>
      <tbody>
${prazoRows}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Comunicações</h2>
    <table>
      <thead><tr><th>Canal</th><th>Remetente</th><th>Assunto</th><th>Data</th></tr></thead>
      <tbody>
${comunicacaoRows}
      </tbody>
    </table>
  </section>
</main>

<footer>
  Dossiê compilado deterministicamente pelo Ekoa Legal a partir da espinha partilhada do escritório.
  Documento de trabalho interno - não substitui as certidões e peças originais do processo.
</footer>
</body>
</html>`;

  const safeNumero = String(numero).replace(/[^0-9A-Za-z.-]+/g, '-').replace(/^-+|-+$/g, '') || 'processo';
  const filename = `dossie-${safeNumero}`;
  return { html, filename };
}
