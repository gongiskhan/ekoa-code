/*
 * RCBE (Registo Central do Beneficiário Efetivo) - apoio manual, CANÓNICO.
 *
 * O RCBE NÃO tem API pública. Este módulo dá apenas o fluxo assistido:
 * ligações profundas para o portal e um parser tolerante do texto colado
 * pelo advogado a partir da consulta. A app (legal-kyc) guarda o resultado
 * nas suas colecções; aqui não há qualquer persistência nem rede.
 *
 * Sincronizado por scripts/sync-legal-shared.mjs - editar AQUI, nunca as cópias.
 */

/* Ligações profundas do portal RCBE (consulta por NIPC/NIF). */
export function buildRcbeDeepLink({ nipc } = {}) {
  const base = 'https://rcbe.justica.gov.pt';
  if (!nipc) return base;
  return `${base}/consulta?nipc=${encodeURIComponent(String(nipc).replace(/\s+/g, ''))}`;
}

/*
 * Parser tolerante do extrato RCBE colado (texto livre do portal).
 * Devolve { entidade, nipc, beneficiarios: [{ nome, nif?, natureza? }] }.
 * Nunca lança: entrada irreconhecível devolve campos nulos/lista vazia.
 */
/*
 * Identificador fiscal numa ÚNICA linha: 9 a 12 dígitos, com espaços simples
 * permitidos entre grupos (nunca quebra de linha - o \s de antes fundia a
 * linha seguinte no número).
 */
const ID_FISCAL = /(\d(?:[ ]?\d){7,11})/;

function matchIdFiscal(text, label) {
  const re = new RegExp(`${label}\\s*[:\\-]?[ ]*${ID_FISCAL.source}`, 'i');
  const m = text.match(re);
  return m ? m[1].replace(/[ ]+/g, '') : null;
}

export function parseRcbeExtract(pastedText) {
  const out = { entidade: null, nipc: null, beneficiarios: [] };
  const text = String(pastedText || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return out;

  /*
   * Blocos de beneficiário: singular "Beneficiário [efetivo] [n.º N] :" -
   * o (?!s) impede que o cabeçalho PLURAL "Beneficiários efetivos:" abra um
   * bloco fantasma. O cabeçalho da entidade é APENAS o texto antes do
   * primeiro bloco, para que o NIF de um beneficiário nunca seja lido como
   * NIPC da entidade.
   */
  const blockRe = /Benefici[aá]rio(?!s)(?:\s+efetivo)?\s*(?:n\.?[ºo]?\s*\d+)?\s*[:\-]?/gi;
  const firstBlock = text.search(blockRe);
  const header = firstBlock === -1 ? text : text.slice(0, firstBlock);

  const entMatch = header.match(/(?:Entidade|Denomina[cç][aã]o)\s*[:\-][ ]*(.+)/i);
  if (entMatch) out.entidade = entMatch[1].trim();
  out.nipc = matchIdFiscal(header, '(?:NIPC|NIF)');

  const body = firstBlock === -1 ? '' : text.slice(firstBlock);
  const benefBlocks = body.split(blockRe).filter((b) => b != null && b.trim() !== '');
  for (const block of benefBlocks) {
    const nome = (block.match(/(?:Nome)\s*[:\-][ ]*(.+)/i) || [])[1]
      || block.split('\n').map((l) => l.trim()).filter(Boolean)[0]
      || null;
    if (!nome) continue;
    const nif = matchIdFiscal(block, 'NIF');
    const natureza = (block.match(/(?:Natureza|Qualidade)\s*[:\-][ ]*(.+)/i) || [])[1] || null;
    out.beneficiarios.push({
      nome: String(nome).replace(/[ ]*NIF.*$/i, '').trim(),
      ...(nif ? { nif } : {}),
      ...(natureza ? { natureza: String(natureza).trim() } : {}),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Calendário de obrigações RCBE (fase 2, legal-rcbe) - PURO, sem persistência.
 *
 * Regras (Lei n.º 89/2017, RJRCBE + Portaria n.º 233/2018):
 *  - Declaração INICIAL: 30 dias após a constituição/facto sujeito a registo.
 *  - ATUALIZAÇÃO: 30 dias após o facto que altere o beneficiário efetivo.
 *  - CONFIRMAÇÃO ANUAL: até 31 de dezembro de cada ano (dispensada no ano em
 *    que exista declaração inicial/atualização nesse mesmo ano).
 * ------------------------------------------------------------------------- */

function addDias30(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`data inválida: ${iso}`);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

/**
 * Deriva as obrigações devidas de uma entidade.
 * @param {{ constituidaEm?:string, ultimaDeclaracaoEm?:string, alteracaoEm?:string }} entidade
 * @param {string} hojeIso 'YYYY-MM-DD'
 * @returns {Array<{tipo:string, dataLimite:string, base:string, emAtraso:boolean}>}
 */
export function calendarioObrigacoes(entidade = {}, hojeIso) {
  if (!hojeIso || !/^\d{4}-\d{2}-\d{2}$/.test(hojeIso)) throw new Error(`hoje inválido: ${hojeIso}`);
  const hoje = hojeIso;
  const ano = Number(hoje.slice(0, 4));
  const out = [];

  if (entidade.constituidaEm && !entidade.ultimaDeclaracaoEm) {
    const limite = addDias30(entidade.constituidaEm);
    out.push({ tipo: 'inicial', dataLimite: limite, base: 'Declaração inicial - 30 dias (RJRCBE, Lei n.º 89/2017)', emAtraso: limite < hoje });
  }
  if (entidade.alteracaoEm && (!entidade.ultimaDeclaracaoEm || entidade.ultimaDeclaracaoEm < entidade.alteracaoEm)) {
    const limite = addDias30(entidade.alteracaoEm);
    out.push({ tipo: 'atualizacao', dataLimite: limite, base: 'Atualização - 30 dias após o facto (RJRCBE)', emAtraso: limite < hoje });
  }
  const declaradaEsteAno = Boolean(entidade.ultimaDeclaracaoEm && entidade.ultimaDeclaracaoEm.slice(0, 4) === String(ano));
  if (!declaradaEsteAno && (entidade.ultimaDeclaracaoEm || entidade.constituidaEm)) {
    const limite = `${ano}-12-31`;
    out.push({ tipo: 'confirmacao_anual', dataLimite: limite, base: 'Confirmação anual até 31 de dezembro (RJRCBE)', emAtraso: limite < hoje });
  }
  return out;
}
