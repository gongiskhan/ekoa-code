/*
 * Cronologia do cliente + extrato de partilhas em PDF - app-local (vive só no
 * Portal). Sem estado, sem I/O; testável isoladamente.
 *
 * INVARIANTE INEGOCIÁVEL (o mesmo do portal.js resolveVisibility): tudo o que
 * estas funções produzem parte EXCLUSIVAMENTE do objecto de visibilidade `vis`
 * (estados/docs/eventos EXPLICITAMENTE partilhados). Nunca lêem processos,
 * documentos ou eventos crus - por construção, um item não partilhado não pode
 * entrar na cronologia nem no extrato. A prova em e2e assenta nisto: um item
 * semeado na espinha mas NÃO partilhado nunca aparece.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/* Data ISO/parcial -> AAAA-MM-DD (para ordenação e apresentação estáveis). Vazio
 * quando não há data reconhecível. */
export function diaDe(valor) {
  const s = String(valor || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return '';
}

/*
 * Constrói a cronologia do cliente a partir SÓ da visibilidade resolvida.
 * Entradas: eventos partilhados (tipo 'evento'), documentos partilhados
 * (marco de partilha do documento) e a fotografia do estado de cada processo
 * partilhado. Devolve entradas ordenadas do mais recente para o mais antigo:
 *   { tipo: 'evento'|'documento'|'estado', dia, titulo, detalhe, refId }
 */
export function construirCronologia(vis) {
  const v = vis || {};
  const entradas = [];

  for (const { evento } of v.evs || []) {
    if (!evento) continue;
    entradas.push({
      tipo: 'evento',
      dia: diaDe(evento.data || evento.createdAt),
      titulo: evento.titulo || '(evento)',
      detalhe: evento.descricao || '',
      refId: evento.id,
    });
  }
  for (const { documento } of v.docs || []) {
    if (!documento) continue;
    entradas.push({
      tipo: 'documento',
      dia: diaDe(documento.data || documento.createdAt),
      titulo: documento.nome || '(documento)',
      detalhe: 'Documento partilhado consigo',
      refId: documento.id,
    });
  }
  for (const { processo } of v.estados || []) {
    if (!processo) continue;
    entradas.push({
      tipo: 'estado',
      dia: diaDe(processo.updatedAt || processo.createdAt),
      titulo: `Processo ${processo.numeroProcesso || ''}`.trim(),
      detalhe: `Situação atual: ${processo.estado || 'ativo'}`,
      refId: processo.id,
    });
  }

  return entradas.sort((a, b) => String(b.dia).localeCompare(String(a.dia)));
}

const TIPO_LABEL = { evento: 'Evento', documento: 'Documento', estado: 'Estado do processo' };

/*
 * HTML autónomo do EXTRATO de partilhas, com marca do escritório (white-label).
 * Determinístico: gerado só de `vis` + identidade do cliente/escritório. Lista
 * exactamente o que está partilhado - nada mais. Pronto para window.__ekoa.exportPdf.
 *
 * @param {object} opts
 *   - vis: visibilidade resolvida (estados/docs/eventos partilhados)
 *   - clienteNome, clienteEmail: identidade do cliente autenticado
 *   - escritorio: nome do escritório (marca), com valor por omissão honesto
 *   - geradoEm: ISO da geração (injectado para determinismo em teste)
 * @returns {{ html: string, filename: string }}
 */
export function extratoHtml({ vis, clienteNome, clienteEmail, escritorio, geradoEm }) {
  const v = vis || {};
  const marca = String(escritorio || 'Escritório').trim() || 'Escritório';
  const data = diaDe(geradoEm || new Date().toISOString());
  const cronologia = construirCronologia(v);

  const nEstados = (v.estados || []).length;
  const nDocs = (v.docs || []).length;
  const nEvs = (v.evs || []).length;
  const total = nEstados + nDocs + nEvs;

  const linhasCronologia = cronologia.length
    ? cronologia.map((e) => `
        <tr>
          <td class="dia">${esc(e.dia || '-')}</td>
          <td>${esc(TIPO_LABEL[e.tipo] || e.tipo)}</td>
          <td>${esc(e.titulo)}${e.detalhe ? `<div class="detalhe">${esc(e.detalhe)}</div>` : ''}</td>
        </tr>`).join('\n')
    : '<tr><td colspan="3" class="vazio">Nada partilhado consigo ainda.</td></tr>';

  const html = `<!DOCTYPE html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<title>Extrato de partilhas - ${esc(marca)}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; margin: 36px; font-size: 12px; }
  .marca { display: flex; align-items: center; gap: 10px; border-bottom: 3px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 8px; }
  .marca .nome { font-size: 18px; font-weight: 700; letter-spacing: 0.01em; }
  .marca .selo { width: 34px; height: 34px; border-radius: 8px; background: #1a1a1a; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
  h1 { font-size: 15px; margin: 16px 0 2px; }
  .sub { color: #555; margin: 0 0 16px; }
  .meta { color: #333; margin: 0 0 16px; font-size: 11px; }
  .meta strong { display: inline-block; min-width: 130px; }
  .resumo { display: flex; gap: 10px; margin: 0 0 16px; }
  .resumo .caixa { border: 1px solid #ccc; border-radius: 6px; padding: 8px 12px; }
  .resumo .n { font-size: 18px; font-weight: 700; }
  .resumo .r { color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.dia { white-space: nowrap; width: 96px; }
  td.vazio { color: #777; text-align: center; font-style: italic; }
  .detalhe { color: #666; font-size: 11px; margin-top: 2px; }
  .rodape { margin-top: 24px; border-top: 1px solid #ccc; padding-top: 10px; color: #555; font-size: 10px; }
</style>
</head>
<body>
  <div class="marca">
    <span class="selo">${esc(marca.slice(0, 1).toUpperCase())}</span>
    <span class="nome">${esc(marca)}</span>
  </div>
  <h1>Extrato de partilhas do portal do cliente</h1>
  <p class="sub">Documento gerado para o cliente, listando exclusivamente o que o escritório partilhou consigo.</p>

  <p class="meta">
    <strong>Cliente:</strong> ${esc(clienteNome || clienteEmail || '-')}<br>
    ${clienteEmail ? `<strong>Email:</strong> ${esc(clienteEmail)}<br>` : ''}
    <strong>Data do extrato:</strong> ${esc(data)}<br>
    <strong>Itens partilhados:</strong> ${total}
  </p>

  <div class="resumo">
    <div class="caixa"><div class="n">${nEstados}</div><div class="r">Estados</div></div>
    <div class="caixa"><div class="n">${nDocs}</div><div class="r">Documentos</div></div>
    <div class="caixa"><div class="n">${nEvs}</div><div class="r">Eventos</div></div>
  </div>

  <h1>Cronologia</h1>
  <table>
    <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th></tr></thead>
    <tbody>
${linhasCronologia}
    </tbody>
  </table>

  <div class="rodape">
    Este extrato reflecte apenas os itens explicitamente partilhados com o cliente no portal, à data indicada.
    Não substitui a consulta do processo nem constitui certidão. Emitido por ${esc(marca)}.
  </div>
</body>
</html>`;

  const filename = `extrato-portal-${data}`;
  return { html, filename };
}
