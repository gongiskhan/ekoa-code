/**
 * Motor determinístico de PRÉ-FATURAS de honorários (Portugal). Zero retrieval,
 * mostra o seu trabalho. Calcula a partir dos lançamentos: base -> IVA ->
 * retenção na fonte (IRS) -> total e valor a receber.
 *
 * IMPORTANTE: gera apenas PRÉ-FATURAS (rascunhos internos) — NUNCA emite uma
 * fatura oficial nem comunica à AT. A emissão fiscal fica para uma fase futura.
 *
 * Regras (valores por omissão, ajustáveis por argumento):
 *  - IVA à taxa normal: 23% sobre a base.
 *  - Retenção na fonte de IRS (serviços profissionais, categoria B): 23% sobre a
 *    base (Lei n.º 45-A/2024, desde 2025; espelha retencaoIrs em
 *    legal-engines/tabelas-taxas.json - teste garante que não divergem), retida
 *    pelo cliente quando aplicável (empresas / contabilidade organizada). Para
 *    clientes sem retenção, taxa 0.
 *  - Total da fatura = base + IVA. Valor a receber = total − retenção.
 *
 * Toda a aritmética é feita em CÊNTIMOS (inteiros) para não acumular erro de
 * vírgula flutuante; os valores devolvidos são em euros (2 casas).
 */

/**
 * Valor monetário VÁLIDO: tem de ser um number (não string/null/bool), finito,
 * >= 0 e com precisão ao cêntimo (no máximo 2 casas decimais). Recusa em vez de
 * produzir um total silenciosamente errado — e ao exigir precisão ao cêntimo
 * elimina a ambiguidade de arredondar floats sub-cêntimo (1.005, 0.004999…): o
 * chamador arredonda ao cêntimo ANTES (um lançamento é dinheiro, não uma fração).
 */
/** Limite acima do qual a aritmética em cêntimos deixaria de ser exacta: garante
 * que base*100 e base*taxa cabem em inteiros seguros (IEEE-754). ~900 mil milhões
 * de euros — folgadíssimo para honorários, mas torna o cálculo exacto por
 * construção em vez de "exacto na prática". */
const MAX_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 100);

function assertValor(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${label} inválido (tem de ser um número finito): ${JSON.stringify(v)}`);
  }
  if (v < 0) throw new Error(`${label} não pode ser negativo: ${v}`);
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) {
    throw new Error(`${label} tem mais de 2 casas decimais (precisão ao cêntimo): ${v}`);
  }
  if (Math.round(v * 100) > MAX_CENTS) throw new Error(`${label} excede o limite seguro: ${v}`);
  return v;
}

/** Taxa VÁLIDA: number finito no intervalo 0–100 (pode ter decimais, ex.: 11.5). */
function assertTaxa(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
    throw new Error(`${label} fora do intervalo 0–100: ${JSON.stringify(v)}`);
  }
  return v;
}

/** Euros -> cêntimos (inteiro). Exacto para um valor com precisão ao cêntimo
 * (validado a montante por assertValor); Math.round absorve o resíduo de float
 * de um produto como 150.5*100 = 15050.000000000002. */
function eurosToCents(v) {
  return Math.round(v * 100);
}

/** Cêntimos -> euros (number com 2 casas). */
function centsToEuros(c) {
  return Math.round(c) / 100;
}

/** Formata cêntimos como "1 230,00 €" (pt-PT) para os passos. */
function eur(cents) {
  const v = (Math.round(cents) / 100).toFixed(2).replace('.', ',');
  return `${v} €`;
}

/**
 * @param {{ lancamentos?: Array<{descricao?: string, valor: number}>,
 *   taxaIva?: number, taxaRetencao?: number, retencaoAplica?: boolean }} input
 * @returns {{ moeda:'EUR', base:number, taxaIva:number, iva:number, total:number,
 *   taxaRetencao:number, retencao:number, aReceber:number,
 *   linhas: Array<{descricao:string, valor:number}>, showWork: {passos:string[]} }}
 */
export function computePrefatura(input = {}) {
  const taxaIva = assertTaxa(input.taxaIva == null ? 23 : input.taxaIva, 'taxaIva');
  const aplicaRetencao = input.retencaoAplica !== false; // por omissão, aplica
  // 23% desde 2025 (Lei n.º 45-A/2024 - alteração ao art. 101.º do CIRS);
  // a taxa histórica de 25% passa por `taxaRetencao` explícita quando preciso.
  const taxaRetencao = aplicaRetencao
    ? assertTaxa(input.taxaRetencao == null ? 23 : input.taxaRetencao, 'taxaRetencao')
    : 0;

  if (input.lancamentos != null && !Array.isArray(input.lancamentos)) {
    throw new Error('lancamentos tem de ser uma lista.');
  }

  const linhas = [];
  let baseC = 0;
  for (const l of Array.isArray(input.lancamentos) ? input.lancamentos : []) {
    const valor = assertValor(l && l.valor, 'valor do lançamento');
    const valorC = eurosToCents(valor);
    baseC += valorC;
    linhas.push({ descricao: (l && l.descricao) || '', valor: centsToEuros(valorC) });
  }
  if (baseC > MAX_CENTS) throw new Error('A pré-fatura excede o limite seguro de cêntimos.');

  const ivaC = Math.round((baseC * taxaIva) / 100);
  const retencaoC = Math.round((baseC * taxaRetencao) / 100);
  const totalC = baseC + ivaC;
  const aReceberC = totalC - retencaoC;

  const passos = [
    `Base (soma de ${linhas.length} lançamento(s)): ${eur(baseC)}`,
    `IVA ${taxaIva}% sobre a base: ${eur(ivaC)}`,
    `Total da pré-fatura (base + IVA): ${eur(totalC)}`,
    aplicaRetencao
      ? `Retenção na fonte de IRS ${taxaRetencao}% sobre a base: −${eur(retencaoC)}`
      : 'Sem retenção na fonte (cliente sem retenção).',
    `Valor a receber (total − retenção): ${eur(aReceberC)}`,
  ];

  return {
    moeda: 'EUR',
    base: centsToEuros(baseC),
    taxaIva,
    iva: centsToEuros(ivaC),
    total: centsToEuros(totalC),
    taxaRetencao,
    retencao: centsToEuros(retencaoC),
    aReceber: centsToEuros(aReceberC),
    linhas,
    showWork: { passos },
  };
}
