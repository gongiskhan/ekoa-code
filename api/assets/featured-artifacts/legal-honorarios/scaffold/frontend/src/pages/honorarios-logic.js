/*
 * Lógica determinística do módulo de Honorários (pura, sem React nem I/O).
 *
 * O cálculo fiscal assenta INTEIRAMENTE no motor partilhado
 * `../engine/honorarios.mjs` (computePrefatura) - este ficheiro nunca reimplementa
 * as regras de IVA/retenção; apenas separa honorários de despesas, alimenta o
 * motor com os honorários (a base tributável) e junta as despesas como
 * reembolso de passagem (sem IVA, sem retenção na fonte). Assim as regras de ouro
 * do motor mantêm-se EXACTAS: IVA 23% sobre a base, retenção 25% sobre a base
 * quando aplicável, total = base + IVA, a receber = total − retenção.
 *
 * PRÉ-FATURAS de conferência - nunca substituem uma fatura certificada.
 */

import { computePrefatura } from '../engine/honorarios.mjs';
import { formatEur } from '../shared.js';

/* Arredonda ao cêntimo ANTES de qualquer aritmética monetária - um lançamento é
 * dinheiro, não uma fracção. O motor recusa valores sub-cêntimo. */
export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/* Soma de valores em cêntimos (inteiros) para não acumular erro de vírgula
 * flutuante; devolve euros com 2 casas. */
export function somaEuros(valores) {
  let cents = 0;
  for (const v of valores) {
    const n = Number(v);
    if (Number.isFinite(n)) cents += Math.round(n * 100);
  }
  return cents / 100;
}

/* Data de hoje como 'AAAA-MM-DD' local - calculada dentro do handler, nunca no
 * topo do módulo. */
export function hojeISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/*
 * Resolve o acordo de honorários aplicável, com a regra do MAIS ESPECÍFICO
 * VENCE: um acordo ao nível do processo (mesmo processoId) sobrepõe-se a um
 * acordo ao nível do cliente (mesmo clienteId, sem processoId). Devolve o acordo
 * ou null.
 */
export function resolveAcordo(acordos, { clienteId, processoId } = {}) {
  const list = Array.isArray(acordos) ? acordos : [];
  if (processoId) {
    const noProcesso = list.find((a) => a && a.processoId === processoId);
    if (noProcesso) return noProcesso;
  }
  if (clienteId) {
    const noCliente = list.find((a) => a && a.clienteId === clienteId && !a.processoId);
    if (noCliente) return noCliente;
  }
  return null;
}

/* Tarifa/hora sugerida a partir do acordo resolvido (só quando o acordo é à
 * hora). Devolve number ou null. */
export function tarifaDoAcordo(acordo) {
  if (acordo && acordo.tipo === 'hora' && Number.isFinite(Number(acordo.tarifaHora))) {
    return Number(acordo.tarifaHora);
  }
  return null;
}

/* Valor mensal sugerido a partir de um acordo de avença. number ou null. */
export function avencaDoAcordo(acordo) {
  if (acordo && acordo.tipo === 'avenca' && Number.isFinite(Number(acordo.avencaMensal))) {
    return Number(acordo.avencaMensal);
  }
  return null;
}

/* Valor fixo sugerido a partir de um acordo de valor fixo. number ou null. */
export function valorFixoDoAcordo(acordo) {
  if (acordo && acordo.tipo === 'fixo' && Number.isFinite(Number(acordo.valorFixo))) {
    return Number(acordo.valorFixo);
  }
  return null;
}

/* Um lançamento pertence ao período? 'todos' aceita tudo; 'mes' compara o prefixo
 * AAAA-MM; 'intervalo' compara AAAA-MM-DD (ordenação lexicográfica segura). */
export function noPeriodo(lanc, periodo) {
  if (!periodo || periodo.modo === 'todos') return true;
  const data = String((lanc && lanc.data) || '');
  if (periodo.modo === 'mes') {
    return periodo.mes ? data.startsWith(periodo.mes) : true;
  }
  if (periodo.modo === 'intervalo') {
    const dia = data.slice(0, 10);
    if (periodo.de && dia < periodo.de) return false;
    if (periodo.ate && dia > periodo.ate) return false;
    return true;
  }
  return true;
}

/* Rótulo humano do período, para o nome/cabeçalho da pré-fatura. */
export function periodoLabel(periodo) {
  if (!periodo || periodo.modo === 'todos') return 'até à data';
  if (periodo.modo === 'mes' && periodo.mes) {
    const [y, m] = periodo.mes.split('-');
    return `${m}/${y}`;
  }
  if (periodo.modo === 'intervalo' && (periodo.de || periodo.ate)) {
    return `${periodo.de || '…'} a ${periodo.ate || '…'}`;
  }
  return 'até à data';
}

/*
 * Calcula a PRÉ-FATURA a partir de um conjunto de lançamentos por faturar e do
 * tipo de cliente. Delega a parte tributável (honorários) ao motor e trata as
 * despesas como reembolso de passagem.
 *
 * Devolve um objecto com os subtotais, os valores do motor e as linhas
 * "mostra o seu trabalho" já formatadas. Lança se algum honorário for inválido
 * (o motor valida ao cêntimo) - o chamador arredonda a montante e apanha o erro.
 */
export function computeHonorariosPrefatura({ lancamentos = [], clienteTipo, clienteDesconhecido = false } = {}) {
  const honorarios = lancamentos.filter((l) => l && l.tipo !== 'despesa');
  const despesas = lancamentos.filter((l) => l && l.tipo === 'despesa');
  // Se o cliente do processo não resolveu, NUNCA se aplica retenção às cegas - em
  // vez disso mostra-se um aviso explícito na fatura (ver linhas abaixo).
  const aplicaRetencao = !clienteDesconhecido && clienteTipo === 'empresa';

  const eng = computePrefatura({
    lancamentos: honorarios.map((l) => ({ descricao: l.descricao, valor: round2(l.valor) })),
    retencaoAplica: aplicaRetencao,
  });

  const despesasTotal = somaEuros(despesas.map((l) => l.valor));
  const total = round2(eng.total + despesasTotal);
  const aReceber = round2(eng.aReceber + despesasTotal);

  let linhaRetencao;
  if (clienteDesconhecido) {
    linhaRetencao = { chave: 'retencao', rotulo: 'Cliente não encontrado - retenção não aplicada', valor: 0, nota: 'Sem retenção', aviso: true };
  } else if (aplicaRetencao) {
    linhaRetencao = { chave: 'retencao', rotulo: `Retenção IRS ${eng.taxaRetencao}% sobre honorários`, valor: eng.retencao, negativo: true };
  } else {
    linhaRetencao = { chave: 'retencao', rotulo: 'Retenção na fonte (cliente particular)', valor: 0, nota: 'Sem retenção' };
  }

  const linhas = [
    { chave: 'honorarios', rotulo: `Honorários (${honorarios.length} lançamento(s))`, valor: eng.base },
    { chave: 'iva', rotulo: `IVA ${eng.taxaIva}% sobre honorários`, valor: eng.iva },
    { chave: 'despesas', rotulo: `Despesas (${despesas.length} lançamento(s))`, valor: despesasTotal },
    linhaRetencao,
    { chave: 'total', rotulo: 'Total (honorários + IVA + despesas)', valor: total, destaque: true },
    { chave: 'areceber', rotulo: 'Valor a receber (total − retenção)', valor: aReceber, destaque: true },
  ];

  return {
    moeda: 'EUR',
    honorariosBase: eng.base,
    taxaIva: eng.taxaIva,
    iva: eng.iva,
    despesas: despesasTotal,
    taxaRetencao: eng.taxaRetencao,
    retencao: eng.retencao,
    aplicaRetencao,
    total,
    aReceber,
    honorariosCount: honorarios.length,
    despesasCount: despesas.length,
    linhas,
  };
}

/*
 * Compõe o texto da pré-fatura (rascunho) que fica gravado no documento do
 * Dossiê. Determinístico e legível - repete o cálculo linha a linha e termina
 * sempre com o aviso de conferência.
 */
export function renderPrefaturaTexto({ numeroProcesso, clienteNome, periodo, pf }) {
  const linhas = [
    `PRÉ-FATURA DE HONORÁRIOS (rascunho de conferência)`,
    ``,
    `Processo: ${numeroProcesso || '—'}`,
    `Cliente: ${clienteNome || '—'}`,
    `Período: ${periodoLabel(periodo)}`,
    ``,
    `Cálculo:`,
    ...pf.linhas.map((l) => {
      if (l.nota) return `  - ${l.rotulo}: ${l.nota}`;
      const val = formatEur(l.valor);
      return `  - ${l.rotulo}: ${l.negativo ? '−' : ''}${val}`;
    }),
    ``,
    `Pré-fatura de conferência - não substitui fatura certificada.`,
  ];
  return linhas.join('\n');
}

/* Texto do aviso legal, numa só constante para não divergir entre ecrãs. */
export const DISCLAIMER = 'Pré-faturas de conferência - não substituem fatura certificada.';
