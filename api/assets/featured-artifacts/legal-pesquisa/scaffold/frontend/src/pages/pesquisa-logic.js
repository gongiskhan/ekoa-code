/*
 * Lógica pura do módulo de Pesquisa Jurídica - rótulos de fonte, tons de
 * distintivo, estado de verificação, e as transformações entre os `hits` da rota
 * de plataforma (/api/legal-research) e as linhas guardadas na espinha. Sem
 * estado, sem I/O; testável isoladamente e partilhada pelas duas páginas.
 *
 * PRINCÍPIO NUNCA-INVENTAR: uma citação só existe se tiver um URL. As funções que
 * mapeiam hits/citações preservam apenas as entradas COM url - preferimos o
 * silêncio a uma citação que o utilizador não consegue abrir. A síntese por LLM
 * está DESLIGADA nesta máquina (índice local vazio): guardamos os hits/citações
 * tal como a rota os devolve, nunca uma resposta redigida.
 */

/* Aviso fixo mostrado em TODAS as superfícies de resultado (Pesquisar e Histórico). */
export const DISCLAIMER = 'Apoio à investigação jurídica - o advogado revê sempre as fontes.';

/*
 * Fontes suportadas pela rota /api/legal-research:
 *   dgsi -> jurisprudência (tribunais superiores)
 *   dre  -> legislação (Diário da República)
 */
export const FONTES = [
  { id: 'dgsi', label: 'DGSI', descricao: 'Jurisprudência' },
  { id: 'dre', label: 'DRE', descricao: 'Legislação' },
];

const FONTE_LABEL = { dgsi: 'DGSI', dre: 'DRE' };
const FONTE_TONE = { dgsi: 'info', dre: 'media' };

/* Rótulo curto da fonte em maiúsculas (DGSI / DRE), a partir do id da rota
 * ('dgsi'/'dre') ou de uma etiqueta já guardada ('DGSI'/'DRE'). */
export function fonteLabel(source) {
  const key = String(source || '').toLowerCase();
  return FONTE_LABEL[key] || String(source || '').toUpperCase() || '—';
}

export function fonteTone(source) {
  return FONTE_TONE[String(source || '').toLowerCase()] || 'neutral';
}

/*
 * Estado de verificação de uma ligação, tal como a rota o devolve nos resultados
 * ao vivo ({ checked, ok, status? }). As linhas GUARDADAS não retêm este estado
 * (uma ligação pode morrer depois de guardada), por isso o Histórico mostra
 * apenas o distintivo da fonte, nunca "verificada".
 */
export function verificacaoOk(verification) {
  return !!(verification && verification.checked && verification.ok);
}

export function verificacaoLabel(verification) {
  return verificacaoOk(verification) ? 'verificada' : 'não verificada';
}

export function verificacaoTone(verification) {
  return verificacaoOk(verification) ? 'ok' : 'media';
}

/* Carimbo ISO completo do momento - calculado na chamada, nunca no topo do módulo. */
export function agoraISO() {
  return new Date().toISOString();
}

/* Trunca a pergunta para o nome do documento-nota (máx. `max` caracteres). */
export function truncarPergunta(pergunta, max = 80) {
  const p = String(pergunta || '').trim();
  if (p.length <= max) return p;
  return `${p.slice(0, max - 1).trimEnd()}…`;
}

/*
 * Converte os `hits` da rota de plataforma nas citações guardadas na linha
 * `pesquisas`. Descarta silenciosamente qualquer hit sem url (nunca-inventar).
 * Forma guardada: { fonte (MAIÚSCULAS), titulo, url, excerto }.
 */
export function hitsParaCitacoes(hits) {
  return (Array.isArray(hits) ? hits : [])
    .filter((h) => h && h.url)
    .map((h) => ({
      fonte: fonteLabel(h.source),
      titulo: String(h.title || '').trim() || String(h.url),
      url: h.url,
      excerto: String(h.snippet || '').trim(),
    }));
}

/* Citações (guardadas ou ao vivo) que têm um url - as únicas mostráveis. */
export function citacoesComUrl(citacoes) {
  return (Array.isArray(citacoes) ? citacoes : []).filter((c) => c && c.url);
}

/*
 * Renderiza as citações como TEXTO simples para o corpo do documento-nota
 * arquivado no dossiê. Sem url não há linha (nunca-inventar). Devolve uma nota
 * honesta quando não há citações (pesquisa manual sobre índice vazio).
 */
export function citacoesParaTexto(pergunta, citacoes) {
  const linhas = [`Pesquisa jurídica: ${String(pergunta || '').trim()}`, ''];
  const validas = citacoesComUrl(citacoes);
  if (validas.length === 0) {
    linhas.push(
      'Sem citações verificáveis (base de conhecimento local vazia). Pesquisa registada manualmente para revisão.',
    );
    return linhas.join('\n');
  }
  linhas.push('Fontes citadas:');
  validas.forEach((c) => {
    linhas.push(`- [${fonteLabel(c.fonte)}] ${c.titulo}`);
    linhas.push(`  ${c.url}`);
    if (c.excerto) linhas.push(`  "${c.excerto}"`);
  });
  return linhas.join('\n');
}
