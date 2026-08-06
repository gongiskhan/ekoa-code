/*
 * ESCALONAMENTO de lembretes - puro, sem I/O. Decide, para um dia de
 * referência, que AÇÕES do plano de escalonamento de cada perfil estão devidas
 * para cada item em aberto, respeitando:
 *   - flags do cliente (não contactar, pausado, litígio, insolvência);
 *   - estados suspensos do item (disputada, litígio, incobrável, pausada);
 *   - promessa de pagamento: suspende até à data prometida; passada essa data
 *     sem pagamento, retoma no passo SEGUINTE ao último executado (escalada);
 *   - deduplicação: um passo já executado (registado na linha do tempo/fila/
 *     tarefas) nunca dispara segunda vez para o mesmo item;
 *   - tetos de frequência do perfil (máx. emails por semana ao mesmo cliente);
 *   - COALESCÊNCIA: várias ações de email do MESMO cliente no mesmo dia
 *     fundem-se num único digest (configurável por perfil).
 *
 * Passos com data agendada ANTERIOR ao dia de referência e nunca executados
 * disparam na mesma (marcados `atrasado: true`) - um lembrete falhado não
 * desaparece silenciosamente.
 */
import { addDias, diasAtraso } from './datas.mjs';
import { round2, formatEur } from './dinheiro.mjs';

/** Chave estável de execução de um passo sobre um item. */
export function chavePasso(item, lembreteId) {
  return `${item.dividaId}|${item.prestacaoId || ''}|${lembreteId}`;
}

function clienteContactavel(flags) {
  if (!flags) return true;
  return !flags.naoContactar && !flags.chasingPausado && !flags.emLitigio && !flags.insolvente;
}

/**
 * Passos devidos para UM item segundo o plano do perfil.
 * `executados` é um Set de chaves (chavePasso) já executadas/agendadas.
 */
function passosDevidosDoItem({ item, perfil, executados, hoje }) {
  const plano = (perfil.lembretes || [])
    .filter((l) => l && l.ativo !== false)
    .slice()
    .sort((a, b) => Number(a.offsetDias || 0) - Number(b.offsetDias || 0));
  if (plano.length === 0) return [];

  const out = [];
  // Promessa ativa: nada dispara até à data prometida (inclusive).
  const promessaAtiva = item.promessaData && diasAtraso(item.promessaData, hoje) <= 0;
  if (promessaAtiva) return [];

  // Promessa quebrada: retoma no passo seguinte ao último executado.
  let aPartirDe = 0;
  if (item.promessaData) {
    let ultimoExecutado = -1;
    plano.forEach((l, i) => {
      if (executados.has(chavePasso(item, l.id))) ultimoExecutado = i;
    });
    aPartirDe = ultimoExecutado + 1;
  }

  for (let i = aPartirDe; i < plano.length; i += 1) {
    const l = plano[i];
    if (executados.has(chavePasso(item, l.id))) continue;
    const dataAgendada = addDias(item.dataVencimento, Number(l.offsetDias || 0));
    if (!dataAgendada) continue;
    const diasDesdeAgendada = diasAtraso(dataAgendada, hoje); // >0 = já passou
    if (diasDesdeAgendada < 0) break; // este e os seguintes são futuros
    out.push({
      item,
      lembrete: l,
      dataAgendada,
      atrasado: diasDesdeAgendada > 0,
      quebraPromessa: !!item.promessaData,
    });
    break; // um passo devido de cada vez por item - nunca rajadas de passos
  }
  return out;
}

/**
 * Calcula as ações devidas para todos os itens.
 *
 * @param {{
 *   hoje: string|Date,
 *   itens: Array,                    // itensEmAberto() de prestacoes.mjs
 *   perfilDoCliente: (clienteId) => object|null,   // perfil resolvido
 *   flagsDoCliente: (clienteId) => object|null,    // flags do overlay
 *   executados: Set<string>,         // chaves de passos já executados
 *   emailsRecentesPorCliente: Map<string, number>, // envios nos últimos 7 dias
 * }} input
 * @returns {Array<{item, lembrete, dataAgendada, atrasado, bloqueadoPorTeto}>}
 */
export function calcularAcoesDevidas({
  hoje,
  itens,
  perfilDoCliente,
  flagsDoCliente,
  executados = new Set(),
  emailsRecentesPorCliente = new Map(),
}) {
  const out = [];
  for (const item of Array.isArray(itens) ? itens : []) {
    const perfil = perfilDoCliente(item.clienteId);
    if (!perfil) continue;
    const flags = flagsDoCliente(item.clienteId);
    if (!clienteContactavel(flags)) continue;

    for (const acao of passosDevidosDoItem({ item, perfil, executados, hoje })) {
      const tipo = acao.lembrete.tipoAcao;
      let bloqueadoPorTeto = false;
      if (tipo === 'email') {
        const teto = Number(perfil.limites?.maxEmailsPorSemana ?? 0);
        const recentes = Number(emailsRecentesPorCliente.get(item.clienteId) || 0);
        if (teto > 0 && recentes >= teto) bloqueadoPorTeto = true;
      }
      out.push({ ...acao, bloqueadoPorTeto });
    }
  }
  return out;
}

/**
 * COALESCÊNCIA: funde as ações de email devidas do mesmo cliente numa única
 * comunicação-digest (quando o perfil o pede). Ações de outros tipos passam
 * intactas. Devolve { emails: [...], tarefas: [...] } onde cada email é
 * { clienteId, acoes: [...], digest: bool }.
 */
export function coalescerAcoes(acoes, perfilDoCliente) {
  const emailsPorCliente = new Map();
  const tarefas = [];
  for (const a of Array.isArray(acoes) ? acoes : []) {
    if (a.lembrete.tipoAcao === 'email' && !a.bloqueadoPorTeto) {
      const lista = emailsPorCliente.get(a.item.clienteId) || [];
      lista.push(a);
      emailsPorCliente.set(a.item.clienteId, lista);
    } else if (!a.bloqueadoPorTeto) {
      tarefas.push(a);
    }
  }
  const emails = [];
  for (const [clienteId, lista] of emailsPorCliente) {
    const perfil = perfilDoCliente(clienteId);
    const coalescer = perfil?.coalescerEmails !== false;
    if (coalescer && lista.length > 1) {
      emails.push({ clienteId, acoes: lista, digest: true });
    } else {
      for (const a of lista) emails.push({ clienteId, acoes: [a], digest: false });
    }
  }
  return { emails, tarefas };
}

/**
 * Substitui as variáveis {{...}} de um template. Vocabulário (documentado no
 * editor de templates): nome, valor, descricao, dataVencimento, diasAtraso,
 * numeroFatura, prestacaoDetalhe, iban, listaDividas, saldoTotal.
 * Variáveis desconhecidas ficam vazias (nunca aparecem chavetas ao cliente).
 */
export function renderTemplate(template, vars = {}) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave) => {
    const v = vars[chave];
    return v == null ? '' : String(v);
  });
}

/**
 * Variáveis de template para um conjunto de itens do mesmo cliente (1 item =
 * lembrete simples; vários = digest com lista).
 */
export function variaveisTemplate({ cliente, itens, hoje, lang = 'pt', iban = '' }) {
  const lista = Array.isArray(itens) ? itens : [];
  const total = round2(lista.reduce((s, i) => s + Number(i.valorEmDivida || 0), 0));
  const linhas = lista.map((i) => {
    const atraso = diasAtraso(i.dataVencimento, hoje);
    const sufixo = Number.isFinite(atraso) && atraso > 0
      ? (lang === 'en' ? `, ${atraso} day(s) overdue` : `, vencida há ${atraso} dia(s)`)
      : '';
    return `- ${i.descricao}: ${formatEur(i.valorEmDivida, lang)} (${i.dataVencimento}${sufixo})`;
  });
  const primeiro = lista[0] || {};
  const atrasoPrimeiro = diasAtraso(primeiro.dataVencimento, hoje);
  return {
    nome: cliente?.nome || '',
    valor: formatEur(lista.length === 1 ? primeiro.valorEmDivida : total, lang),
    descricao: primeiro.descricao || '',
    dataVencimento: primeiro.dataVencimento || '',
    diasAtraso: Number.isFinite(atrasoPrimeiro) && atrasoPrimeiro > 0 ? String(atrasoPrimeiro) : '0',
    numeroFatura: primeiro.numeroFatura || '',
    prestacaoDetalhe: primeiro.prestacaoId ? primeiro.descricao : '',
    iban: iban || '',
    listaDividas: linhas.join('\n'),
    saldoTotal: formatEur(total, lang),
  };
}
