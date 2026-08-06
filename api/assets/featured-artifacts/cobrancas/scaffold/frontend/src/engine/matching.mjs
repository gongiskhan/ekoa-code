/*
 * CORRESPONDÊNCIA (matching) entre créditos bancários e dívidas/prestações em
 * aberto - puro, sem I/O. Duas metades:
 *
 *  1. SUGESTÕES (gerarCandidatos): para um crédito por conciliar, pontua os
 *     itens em aberto por valor (exato > parcial), semelhança do nome do
 *     cliente no descritivo e proximidade da data de vencimento. Nada é
 *     conciliado sem confirmação humana na primeira vez (brief).
 *
 *  2. REGRAS (aplicarRegras): depois de o utilizador confirmar uma sugestão, a
 *     app guarda uma REGRA {padrão normalizado, clienteId}. Uma transação nova
 *     cujo descritivo normalizado case com a regra é conciliada AUTOMATICAMENTE
 *     apenas quando existe EXATAMENTE UM alvo plausível desse cliente; qualquer
 *     ambiguidade (duas regras de clientes distintos com o mesmo padrão, dois
 *     itens do mesmo valor) degrada para sugestão.
 *
 * Um "item em aberto" (OpenItem) é a visão plana de uma dívida sem plano de
 * prestações OU de uma prestação individual:
 *   { dividaId, prestacaoId|null, clienteId, clienteNome, descricao,
 *     valorEmDivida, dataVencimento }
 */
import { normalizarDescricao, semelhancaNomes, nomeContidoNoDescritivo } from './normalizacao.mjs';
import { round2 } from './dinheiro.mjs';
import { diasAtraso } from './datas.mjs';

/** Tolerância de cêntimos na comparação de valores. */
const EPS = 0.011;

/** Pesos da pontuação (somam 1.0 no melhor caso). */
const PESO_VALOR_EXATO = 0.5;
const PESO_VALOR_PARCIAL = 0.2;
const PESO_NOME = 0.35;
const PESO_DATA = 0.15;

/** Janela de proximidade de datas considerada relevante (dias). */
const JANELA_DIAS = 60;

function pontuarItem(transacao, item) {
  const motivos = [];
  let score = 0;

  const valorTx = round2(Number(transacao.valor));
  const emDivida = round2(Number(item.valorEmDivida));
  const exato = Math.abs(valorTx - emDivida) <= EPS;
  const parcial = !exato && valorTx > 0 && valorTx < emDivida - EPS;
  if (exato) {
    score += PESO_VALOR_EXATO;
    motivos.push({ tipo: 'valor-exato', detalhe: emDivida });
  } else if (parcial) {
    score += PESO_VALOR_PARCIAL;
    motivos.push({ tipo: 'valor-parcial', detalhe: emDivida });
  }

  const contido = nomeContidoNoDescritivo(item.clienteNome, transacao.descricao);
  const sem = contido ? 1 : semelhancaNomes(item.clienteNome, transacao.descricao);
  if (sem > 0.35) {
    score += PESO_NOME * Math.min(1, sem);
    motivos.push({ tipo: contido ? 'nome-contido' : 'nome-semelhante', detalhe: round2(sem) });
  }

  const dias = Math.abs(diasAtraso(item.dataVencimento, transacao.data));
  if (Number.isFinite(dias) && dias <= JANELA_DIAS) {
    score += PESO_DATA * (1 - dias / JANELA_DIAS);
    motivos.push({ tipo: 'data-proxima', detalhe: dias });
  }

  return { score: round2(score), motivos, exato, parcial };
}

function nivelConfianca(score) {
  if (score >= 0.75) return 'alta';
  if (score >= 0.45) return 'media';
  return 'baixa';
}

/**
 * Sugestões ordenadas para um crédito por conciliar. Só devolve candidatos com
 * algum sinal real (valor OU nome); um item sem qualquer relação não aparece.
 */
export function gerarCandidatos(transacao, itensAbertos) {
  const out = [];
  for (const item of Array.isArray(itensAbertos) ? itensAbertos : []) {
    const { score, motivos, exato, parcial } = pontuarItem(transacao, item);
    const temSinalValor = exato || parcial;
    const temSinalNome = motivos.some((m) => m.tipo === 'nome-contido' || m.tipo === 'nome-semelhante');
    if (!temSinalValor && !temSinalNome) continue;
    out.push({ item, pontuacao: score, motivos, nivel: nivelConfianca(score) });
  }
  out.sort((a, b) => b.pontuacao - a.pontuacao);
  return out;
}

/**
 * Aplica as regras guardadas a uma transação nova. Devolve:
 *   { auto: OpenItem|null, regra?: regra, motivo: string }
 *
 * `auto` só é não-nulo quando (a) exatamente UMA regra ativa casa com o padrão
 * normalizado, (b) essa regra aponta um único cliente, e (c) esse cliente tem
 * exatamente UM item plausível: um único item de valor EXATO, ou - não havendo
 * nenhum exato - um único item em aberto (pagamento parcial inequívoco).
 */
export function aplicarRegras(transacao, regras, itensAbertos) {
  const padrao = normalizarDescricao(transacao.descricao);
  if (!padrao) return { auto: null, motivo: 'descritivo-vazio' };

  const ativas = (Array.isArray(regras) ? regras : []).filter((r) => r && r.ativa !== false);
  const casadas = ativas.filter((r) => r.padrao === padrao);
  if (casadas.length === 0) return { auto: null, motivo: 'sem-regra' };

  const clientes = [...new Set(casadas.map((r) => r.clienteId))];
  if (clientes.length > 1) {
    return { auto: null, motivo: 'regras-ambiguas', regras: casadas };
  }
  const clienteId = clientes[0];
  const regra = casadas[0];

  const doCliente = (Array.isArray(itensAbertos) ? itensAbertos : []).filter(
    (i) => i.clienteId === clienteId,
  );
  if (doCliente.length === 0) return { auto: null, motivo: 'cliente-sem-itens', regra };

  const valorTx = round2(Number(transacao.valor));
  const exatos = doCliente.filter((i) => Math.abs(round2(Number(i.valorEmDivida)) - valorTx) <= EPS);
  if (exatos.length === 1) return { auto: exatos[0], regra, motivo: 'regra-valor-exato' };
  if (exatos.length > 1) return { auto: null, motivo: 'valores-ambiguos', regra, candidatos: exatos };

  if (doCliente.length === 1 && valorTx > 0 && valorTx < round2(Number(doCliente[0].valorEmDivida)) - EPS) {
    return { auto: doCliente[0], regra, motivo: 'regra-parcial-unico-item' };
  }
  return { auto: null, motivo: 'sem-alvo-plausivel', regra, candidatos: doCliente };
}
