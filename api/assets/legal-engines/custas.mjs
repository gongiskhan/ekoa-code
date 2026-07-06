/**
 * Motor determinístico de TAXA DE JUSTIÇA (Portugal). Zero retrieval, mostra o
 * seu trabalho, cita a fonte. Converte o valor da acção no número de UC (unidades
 * de conta) do escalão da Tabela I anexa ao Regulamento das Custas Processuais
 * (art. 6.º do RCP, aprovado pelo Decreto-Lei n.º 34/2008, de 26 de fevereiro) e
 * multiplica pelo valor da UC do ano.
 *
 * PUREZA: o motor NÃO lê ficheiros. Recebe as linhas de UC como ARGUMENTO
 * (`input.uc`, de tabelas-taxas.json) - o valor da UC é fixado anualmente pela
 * Lei do Orçamento do Estado e o serviço da plataforma injecta a linha do ano.
 *
 * GROUNDING (brief §3.2): a estrutura de escalões da Tabela I NÃO foi possível
 * confirmar contra o corpus de conhecimento (o RCP consolidado com a tabela não
 * está indexado - só referências em jurisprudência/portais). Codifica-se aqui a
 * ESTRUTURA PUBLICADA padrão da Tabela I e marca-se cada escalão com
 * `nota: 'confirmar'`, para o crawler/sessão de configuração validar contra o DRE.
 * Todo o cálculo cita a base legal; nenhum valor é apresentado como certo sem
 * fonte confirmada.
 *
 * Aritmética em CÊNTIMOS (inteiros). O escalão "+ € 275 000" acresce, a final,
 * 3 UC por cada € 25 000 ou fracção acima de € 275 000 (art. 6.º, n.º 7 do RCP).
 */

const MAX_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 100);

/** Colunas da Tabela I. I-A: generalidade das acções; I-B: art. 7.º, n.º 4 do RCP;
 *  I-C: processos de especial complexidade (art. 530.º, n.º 7 do CPC). */
const TABELAS = ['I-A', 'I-B', 'I-C'];

/**
 * Estrutura publicada da Tabela I do RCP: escalões por valor da acção (€) e o
 * número de UC de cada coluna. `ate: null` = escalão aberto (acresce por fracção).
 * TODAS as linhas `nota: 'confirmar'` - a confirmar contra o DRE (ver cabeçalho).
 */
const TABELA_I = [
  { de: 0, ate: 2000, uc: { 'I-A': 1, 'I-B': 1, 'I-C': 1.5 } },
  { de: 2000, ate: 8000, uc: { 'I-A': 2, 'I-B': 3, 'I-C': 3 } },
  { de: 8000, ate: 16000, uc: { 'I-A': 3, 'I-B': 6, 'I-C': 4.5 } },
  { de: 16000, ate: 24000, uc: { 'I-A': 4, 'I-B': 9, 'I-C': 6 } },
  { de: 24000, ate: 30000, uc: { 'I-A': 5, 'I-B': 12, 'I-C': 7.5 } },
  { de: 30000, ate: 40000, uc: { 'I-A': 6, 'I-B': 15, 'I-C': 9 } },
  { de: 40000, ate: 60000, uc: { 'I-A': 7, 'I-B': 18, 'I-C': 10.5 } },
  { de: 60000, ate: 80000, uc: { 'I-A': 9, 'I-B': 21, 'I-C': 13.5 } },
  { de: 80000, ate: 100000, uc: { 'I-A': 11, 'I-B': 24, 'I-C': 16.5 } },
  { de: 100000, ate: 150000, uc: { 'I-A': 13, 'I-B': 27, 'I-C': 19.5 } },
  { de: 150000, ate: 200000, uc: { 'I-A': 16, 'I-B': 30, 'I-C': 24 } },
  { de: 200000, ate: 250000, uc: { 'I-A': 20, 'I-B': 33, 'I-C': 30 } },
  { de: 250000, ate: 275000, uc: { 'I-A': 24, 'I-B': 36, 'I-C': 36 } },
  { de: 275000, ate: null, uc: { 'I-A': 24, 'I-B': 36, 'I-C': 36 } },
];

/** Acréscimo por cada € 25 000 (ou fracção) acima de € 275 000 (art. 6.º, n.º 7). */
const ACRESCIMO_UC = 3;
const ACRESCIMO_FAIXA = 25000;
const CITACAO = 'Art. 6.º e Tabela I anexa ao Regulamento das Custas Processuais (Decreto-Lei n.º 34/2008, de 26 de fevereiro).';

/** Valor em euros VÁLIDO com precisão ao cêntimo (>= 0). Devolve cêntimos inteiros. */
function assertEuros(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${label} inválido (tem de ser um número finito): ${JSON.stringify(v)}`);
  }
  if (v < 0) throw new Error(`${label} não pode ser negativo: ${v}`);
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) {
    throw new Error(`${label} tem mais de 2 casas decimais (precisão ao cêntimo): ${v}`);
  }
  const cents = Math.round(v * 100);
  if (cents > MAX_CENTS) throw new Error(`${label} excede o limite seguro: ${v}`);
  return cents;
}

function centsToEuros(c) {
  return Math.round(c) / 100;
}

function eur(cents) {
  const v = (Math.round(cents) / 100).toFixed(2).replace('.', ',');
  return `${v} €`;
}

/** Rótulo PT-PT de um escalão. */
function escalaoLabel(row) {
  if (row.ate == null) return `Superior a ${eur(row.de * 100)}`;
  if (row.de === 0) return `Até ${eur(row.ate * 100)}`;
  return `De ${eur(row.de * 100)} a ${eur(row.ate * 100)}`;
}

/** Encontra a linha de UC do ano pedido, ou a mais recente com ano <= pedido. */
function ucDoAno(ucRows, ano) {
  if (!Array.isArray(ucRows) || ucRows.length === 0) {
    throw new Error('Linhas de UC em falta (o motor recebe-as como argumento).');
  }
  const exact = ucRows.find((r) => r && Number(r.ano) === ano);
  if (exact) return exact;
  const anteriores = ucRows
    .filter((r) => r && Number.isFinite(Number(r.ano)) && Number(r.ano) <= ano)
    .sort((a, b) => Number(b.ano) - Number(a.ano));
  if (anteriores.length) return anteriores[0];
  throw new Error(`Sem valor de UC conhecido para o ano ${ano} ou anterior.`);
}

/**
 * @param {{ valorAcao: number, tabela?: 'I-A'|'I-B'|'I-C', uc: Array, ano?: number }} input
 * @returns {{ moeda:'EUR', valorAcao:number, tabela:string, ano:number, uc:number,
 *   ucBase:string, ucNota:(string|null), escalao:object, ucCount:number,
 *   valor:number, valorCentavos:number, citacao:string, nota:string,
 *   showWork:{passos:string[]} }}
 */
export function computeCustas(input = {}) {
  const tabela = input.tabela == null ? 'I-A' : String(input.tabela).toUpperCase();
  if (!TABELAS.includes(tabela)) {
    throw new Error(`Tabela inválida (I-A|I-B|I-C): ${JSON.stringify(input.tabela)}`);
  }
  const valorCents = assertEuros(typeof input.valorAcao === 'number' ? input.valorAcao : NaN, 'valorAcao');
  const valorEuros = centsToEuros(valorCents);
  const ano = input.ano == null ? new Date().getUTCFullYear() : Number(input.ano);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    throw new Error(`Ano inválido: ${JSON.stringify(input.ano)}`);
  }

  const ucRow = ucDoAno(input.uc, ano);
  const ucValorCents = assertEuros(typeof ucRow.valor === 'number' ? ucRow.valor : NaN, 'valor da UC');

  // Escalão: a primeira linha cujo tecto (ate) cobre o valor, ou o escalão aberto.
  const row = TABELA_I.find((r) => r.ate != null && valorEuros <= r.ate) || TABELA_I[TABELA_I.length - 1];
  const baseUc = row.uc[tabela];

  let ucCount = baseUc;
  let acrescimo = 0;
  if (row.ate == null && valorEuros > row.de) {
    acrescimo = ACRESCIMO_UC * Math.ceil((valorEuros - row.de) / ACRESCIMO_FAIXA);
    ucCount = baseUc + acrescimo;
  }

  // valor = UC × valor da UC, arredondado ao cêntimo (ucCount pode ser fraccionário: I-C).
  const totalCents = Math.round(ucCount * ucValorCents);

  const escalao = {
    de: row.de,
    ate: row.ate,
    label: escalaoLabel(row),
    ucBase: baseUc,
    acrescimoUc: acrescimo,
    nota: 'confirmar',
  };

  const passos = [
    `Valor da acção: ${eur(valorCents)}`,
    `Tabela aplicável: ${tabela} (Tabela I anexa ao RCP).`,
    `Escalão: ${escalao.label} -> ${baseUc} UC${acrescimo ? ` + ${acrescimo} UC (acréscimo por cada ${eur(ACRESCIMO_FAIXA * 100)} acima de ${eur(row.de * 100)})` : ''}.`,
    `Valor da UC em ${ucRow.ano}: ${eur(ucValorCents)} (${ucRow.base || 'Lei do Orçamento do Estado'}).`,
    `Taxa de justiça: ${ucCount} UC × ${eur(ucValorCents)} = ${eur(totalCents)}.`,
    `Base legal: ${CITACAO}`,
    'Escalão por confirmar contra o DRE (a estrutura da Tabela I não foi confirmada no corpus).',
  ];

  return {
    moeda: 'EUR',
    valorAcao: valorEuros,
    tabela,
    ano: Number(ucRow.ano),
    uc: centsToEuros(ucValorCents),
    ucBase: ucRow.base ? String(ucRow.base) : 'Lei do Orçamento do Estado',
    ucNota: ucRow.nota ? String(ucRow.nota) : null,
    escalao,
    ucCount,
    valorCentavos: totalCents,
    valor: centsToEuros(totalCents),
    citacao: CITACAO,
    nota: 'confirmar',
    showWork: { passos },
  };
}
