/*
 * PLANOS DE PRESTAÇÕES + ALOCAÇÃO DE PAGAMENTOS - puro, sem I/O.
 *
 * Quando uma dívida tem plano, TODA a funcionalidade (lembretes, matching,
 * estados, promessas) opera POR PRESTAÇÃO; sem plano, opera pela dívida
 * inteira (brief). Este módulo produz a visão plana "itens em aberto" que os
 * outros motores consomem, gera planos e aloca pagamentos sem alvo.
 */
import { round2, eurosParaCentavos, centavosParaEuros } from './dinheiro.mjs';
import { addDias, parseDia, diaISO } from './datas.mjs';

/** Estados que contam como "em aberto" (por receber). */
export function emAberto(estado) {
  return estado === 'aberta' || estado === 'parcial' || estado === 'promessa';
}

/** Estados que suspendem a cobrança ativa do item. */
export function cobrancaSuspensa(estado) {
  return estado === 'disputada' || estado === 'litigio' || estado === 'incobravel' || estado === 'pausada';
}

/**
 * Gera um plano de N prestações iguais a partir da data da primeira, com
 * intervalo em dias OU mensal. A divisão é justa ao cêntimo: o resto vai para
 * a PRIMEIRA prestação (o credor recebe o acerto mais cedo).
 */
export function gerarPlano({ valorTotal, numPrestacoes, primeiraData, intervaloDias = null, mensal = true }) {
  const n = Math.floor(Number(numPrestacoes));
  const totalC = eurosParaCentavos(valorTotal);
  if (!Number.isFinite(n) || n < 2) throw new Error('O plano precisa de pelo menos 2 prestações.');
  if (!Number.isFinite(totalC) || totalC <= 0) throw new Error('Valor total do plano inválido.');
  const base = parseDia(primeiraData);
  if (!base) throw new Error('Data da primeira prestação inválida.');

  const quota = Math.floor(totalC / n);
  const resto = totalC - quota * n;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    let dataVencimento;
    if (mensal && intervaloDias == null) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, base.getDate());
      // Meses curtos: 31 de janeiro + 1 mês -> 28/29 de fevereiro, nunca 2/3 de março.
      if (d.getDate() !== base.getDate()) d.setDate(0);
      dataVencimento = diaISO(d);
    } else {
      dataVencimento = addDias(diaISO(base), i * Number(intervaloDias || 30));
    }
    out.push({
      id: `p${i + 1}`,
      valor: centavosParaEuros(quota + (i === 0 ? resto : 0)),
      dataVencimento,
      estado: 'aberta',
    });
  }
  return out;
}

/** Valida um plano personalizado: datas válidas e soma igual ao total. */
export function validarPlanoPersonalizado(prestacoes, valorTotal) {
  const erros = [];
  const lista = Array.isArray(prestacoes) ? prestacoes : [];
  if (lista.length < 1) erros.push('O plano tem de ter pelo menos uma prestação.');
  let somaC = 0;
  lista.forEach((p, i) => {
    if (!parseDia(p.dataVencimento)) erros.push(`Prestação ${i + 1}: data inválida.`);
    const c = eurosParaCentavos(p.valor);
    if (!Number.isFinite(c) || c <= 0) erros.push(`Prestação ${i + 1}: valor inválido.`);
    else somaC += c;
  });
  const totalC = eurosParaCentavos(valorTotal);
  if (erros.length === 0 && somaC !== totalC) {
    erros.push(`A soma das prestações (${centavosParaEuros(somaC).toFixed(2)}) difere do total da dívida (${centavosParaEuros(totalC).toFixed(2)}).`);
  }
  return erros;
}

/**
 * Visão plana dos ITENS EM ABERTO de um conjunto de dívidas, já com o valor em
 * dívida derivado dos pagamentos. Um item = dívida sem plano OU prestação.
 * `clientesById` mapeia clienteId -> { nome } (espinha partilhada).
 */
export function itensEmAberto(dividas, pagamentos, clientesById = new Map()) {
  const pagos = new Map(); // chave dividaId|prestacaoId -> soma paga
  for (const p of Array.isArray(pagamentos) ? pagamentos : []) {
    const chave = `${p.dividaId}|${p.prestacaoId || ''}`;
    pagos.set(chave, round2((pagos.get(chave) || 0) + Number(p.valor || 0)));
  }
  const nomeDe = (clienteId) => {
    const c = clientesById.get ? clientesById.get(clienteId) : null;
    return (c && c.nome) || '';
  };

  const out = [];
  for (const d of Array.isArray(dividas) ? dividas : []) {
    if (!d || cobrancaSuspensa(d.estado) || d.estado === 'paga') continue;
    const plano = Array.isArray(d.prestacoes) && d.prestacoes.length > 0 ? d.prestacoes : null;
    if (!plano) {
      const pago = round2((pagos.get(`${d.id}|`) || 0));
      const saldo = round2(Number(d.valor || 0) - pago);
      if (saldo <= 0) continue;
      out.push({
        dividaId: d.id,
        prestacaoId: null,
        clienteId: d.clienteId,
        clienteNome: nomeDe(d.clienteId),
        descricao: d.descricao || '',
        valorEmDivida: saldo,
        dataVencimento: d.dataVencimento,
        estado: d.estado,
        promessaData: d.promessaData || null,
      });
      continue;
    }
    for (const p of plano) {
      if (cobrancaSuspensa(p.estado) || p.estado === 'paga') continue;
      const pago = round2((pagos.get(`${d.id}|${p.id}`) || 0));
      const saldo = round2(Number(p.valor || 0) - pago);
      if (saldo <= 0) continue;
      out.push({
        dividaId: d.id,
        prestacaoId: p.id,
        clienteId: d.clienteId,
        clienteNome: nomeDe(d.clienteId),
        descricao: `${d.descricao || ''} — prestação ${p.id.replace(/^p/, '')}/${plano.length}`,
        valorEmDivida: saldo,
        dataVencimento: p.dataVencimento,
        estado: p.estado,
        promessaData: p.promessaData || null,
      });
    }
  }
  return out;
}

/**
 * Estado derivado de uma dívida a partir dos pagamentos registados. Estados
 * "manuais" (disputada, litigio, incobravel, pausada, promessa) prevalecem
 * enquanto houver saldo; 'paga'/'parcial'/'aberta' derivam do dinheiro.
 */
export function estadoDerivado(divida, pagamentos) {
  const doItem = (Array.isArray(pagamentos) ? pagamentos : []).filter((p) => p.dividaId === divida.id);
  const pago = round2(doItem.reduce((s, p) => s + Number(p.valor || 0), 0));
  const total = round2(Number(divida.valor || 0));
  if (pago >= total - 0.01) return 'paga';
  if (cobrancaSuspensa(divida.estado) || divida.estado === 'promessa') return divida.estado;
  if (pago > 0) return 'parcial';
  return 'aberta';
}

/**
 * ALOCAÇÃO de um pagamento sem alvo: distribui `valor` pelos itens em aberto
 * do cliente segundo a regra ('antiga-primeiro' por omissão | 'recente-primeiro').
 * Devolve { alocacoes: [{dividaId, prestacaoId, valor}], excedente } - a UI
 * mostra e deixa editar ANTES de gravar (brief). O excedente (overpayment)
 * fica explícito, nunca desaparece.
 */
export function alocarPagamento({ valor, itens, regra = 'antiga-primeiro' }) {
  const ordenados = [...(Array.isArray(itens) ? itens : [])].sort((a, b) => {
    const cmp = String(a.dataVencimento || '').localeCompare(String(b.dataVencimento || ''));
    return regra === 'recente-primeiro' ? -cmp : cmp;
  });
  let restanteC = eurosParaCentavos(valor);
  const alocacoes = [];
  for (const item of ordenados) {
    if (restanteC <= 0) break;
    const devidoC = eurosParaCentavos(item.valorEmDivida);
    const usado = Math.min(restanteC, devidoC);
    if (usado <= 0) continue;
    alocacoes.push({
      dividaId: item.dividaId,
      prestacaoId: item.prestacaoId,
      valor: centavosParaEuros(usado),
    });
    restanteC -= usado;
  }
  return { alocacoes, excedente: centavosParaEuros(Math.max(0, restanteC)) };
}
