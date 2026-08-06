/*
 * NORMALIZAÇÃO do descritivo de transações bancárias - o núcleo da
 * reconciliação (brief: "Specify and test this normalization explicitly; it is
 * the core of the feature").
 *
 * Objetivo: reduzir um descritivo bancário à sua ASSINATURA ESTÁVEL do pagador,
 * removendo os tokens VARIÁVEIS entre pagamentos do mesmo ordenante (números de
 * referência, ids de transação, datas), de modo a que dois pagamentos do mesmo
 * cliente em meses diferentes produzam a MESMA cadeia normalizada.
 *
 * REGRAS (por esta ordem, deterministas, documentadas uma a uma):
 *  1. Maiúsculas + remoção de acentos (fold NFD): 'Padaria Sant'Ana' e
 *     'PADARIA SANTANA' têm de convergir.
 *  2. Remoção de tokens de DATA: 'DD/MM/YYYY', 'DD-MM-YY', 'YYYY-MM-DD',
 *     'DD.MM' e variantes - a data nunca identifica o pagador.
 *  3. Remoção de tokens de REFERÊNCIA: qualquer token com >= 3 dígitos
 *     (ex.: 'MB12345', 'TRF0001123', '2026001827', 'P2026/18') - são ids de
 *     transação/fatura, variam por pagamento. Tokens com 1-2 dígitos e letras
 *     (ex.: 'LDA2') perdem apenas os dígitos.
 *  3b. Remoção de PALAVRAS-MARCADOR de referência em qualquer posição ('REF',
 *     'REFERENCIA', 'NR', 'NUM', 'DOC', 'ID') - anunciam o número que a regra 3
 *     removeu; nunca identificam o pagador.
 *  4. Colapso de tudo o que não é [A-Z0-9] num único espaço + trim: pontuação,
 *     asteriscos de mascaramento ('***'), separadores.
 *  5. Remoção de PREFIXOS de canal bancário no início ('TRF', 'TRANSF',
 *     'TRANSFERENCIA', 'CRED', 'CREDITO', 'DD', 'SEPA', 'P2P', 'MBWAY', 'MB',
 *     'DEP', 'DEPOSITO', 'CH', 'CHEQUE', 'DE') - descrevem o canal, não o
 *     pagador; removem-se em cadeia enquanto o token seguinte existir.
 *
 * O que NÃO se remove: palavras do nome do ordenante, mesmo curtas ('LDA',
 * 'SA', 'UNIP') - fazem parte da assinatura.
 */

const PREFIXOS_CANAL = new Set([
  'TRF', 'TRANSF', 'TRANSFERENCIA', 'CRED', 'CREDITO', 'CR',
  'DD', 'SEPA', 'P2P', 'PP', 'MBWAY', 'MB', 'DEP', 'DEPOSITO',
  'CH', 'CHEQUE', 'DE', 'PARA',
]);

/** Regra 3b - marcadores de referência, removidos em QUALQUER posição. */
const MARCADORES_REF = new Set(['REF', 'REFERENCIA', 'NR', 'NUM', 'DOC', 'ID']);

/** Regra 2 - padrões de data reconhecidos como token isolado. */
const TOKEN_DATA = /^(\d{1,2}[\/.\-]\d{1,2}([\/.\-]\d{2,4})?|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})$/;

function contarDigitos(token) {
  let n = 0;
  for (const ch of token) if (ch >= '0' && ch <= '9') n += 1;
  return n;
}

/**
 * Normaliza um descritivo bancário para a assinatura estável do pagador.
 * Devolve '' quando nada resta (descritivo só com referências/datas).
 */
export function normalizarDescricao(raw) {
  if (raw == null) return '';
  // Regra 1: maiúsculas + fold de acentos.
  let s = String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  // Pré-separação: pontuação vira espaço para os tokens ficarem limpos,
  // MAS preserva '/', '.', '-' DENTRO de potenciais datas para a regra 2 -
  // primeiro tokeniza por espaço, depois limpa token a token.
  const rough = s.split(/\s+/).filter(Boolean);
  const tokens = [];
  for (const t of rough) {
    if (TOKEN_DATA.test(t)) continue; // regra 2: data isolada cai
    // limpa pontuação envolvente e separa subtokens (regra 4)
    for (const sub of t.split(/[^A-Z0-9]+/).filter(Boolean)) {
      tokens.push(sub);
    }
  }

  // Regra 3: tokens com >= 3 dígitos caem; 1-2 dígitos misturados perdem os
  // dígitos. Regra 3b: marcadores de referência caem em qualquer posição.
  const semRefs = [];
  for (const t of tokens) {
    const digitos = contarDigitos(t);
    if (digitos >= 3) continue;
    let palavra = t;
    if (digitos > 0) {
      palavra = t.replace(/\d+/g, '');
      if (!palavra) continue;
    }
    if (MARCADORES_REF.has(palavra)) continue;
    semRefs.push(palavra);
  }

  // Regra 5: prefixos de canal no início, em cadeia (nunca esvazia por completo).
  let inicio = 0;
  while (inicio < semRefs.length - 1 && PREFIXOS_CANAL.has(semRefs[inicio])) inicio += 1;

  return semRefs.slice(inicio).join(' ');
}

/**
 * Impressão digital de uma transação para DEDUPLICAÇÃO entre extratos
 * sobrepostos (brief: "fingerprint on date, amount, and normalized
 * description"). Reimportar o mesmo mês nunca duplica movimentos.
 */
export function fingerprintTransacao({ data, valor, descricao }) {
  const v = Number(valor);
  const val = Number.isFinite(v) ? v.toFixed(2) : 'NaN';
  return `${data || ''}|${val}|${normalizarDescricao(descricao)}`;
}

/**
 * Semelhança entre dois nomes (0..1) - coeficiente de Dice sobre bigramas da
 * forma normalizada. Usada para ligar o descritivo ao nome do cliente.
 */
export function semelhancaNomes(a, b) {
  const na = normalizarDescricao(a);
  const nb = normalizarDescricao(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigramas = (s) => {
    const out = new Map();
    const chars = s.replace(/\s+/g, ' ');
    for (let i = 0; i < chars.length - 1; i += 1) {
      const bg = chars.slice(i, i + 2);
      out.set(bg, (out.get(bg) || 0) + 1);
    }
    return out;
  };
  const ba = bigramas(na);
  const bb = bigramas(nb);
  let inter = 0;
  let totalA = 0;
  let totalB = 0;
  for (const [, n] of ba) totalA += n;
  for (const [, n] of bb) totalB += n;
  for (const [bg, n] of ba) {
    if (bb.has(bg)) inter += Math.min(n, bb.get(bg));
  }
  if (totalA + totalB === 0) return 0;
  return (2 * inter) / (totalA + totalB);
}

/**
 * True quando o nome (normalizado) do cliente aparece por inteiro no descritivo
 * normalizado - sinal forte, independente do rácio de Dice.
 */
export function nomeContidoNoDescritivo(nomeCliente, descricao) {
  const nome = normalizarDescricao(nomeCliente);
  const desc = normalizarDescricao(descricao);
  if (!nome || !desc) return false;
  return desc.includes(nome);
}
