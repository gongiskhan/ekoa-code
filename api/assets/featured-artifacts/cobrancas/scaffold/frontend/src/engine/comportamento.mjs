/*
 * CLASSIFICAÇÃO DO COMPORTAMENTO DE PAGAMENTO - puro, sem I/O (brief:
 * "compute a score per customer from history ... Show the score and its
 * inputs ... the app suggests; the user confirms").
 *
 * Score 0-100, começa em 100 e desce com os sinais negativos; os INPUTS são
 * devolvidos por extenso para a UI mostrar o porquê:
 *   - média de dias de atraso nos pagamentos (liquidação vs vencimento);
 *   - percentagem de itens pagos DENTRO do prazo;
 *   - promessas de pagamento quebradas;
 *   - valor anulado como incobrável.
 *
 * A sugestão de mudança de perfil usa limiares CONFIGURÁVEIS; por omissão:
 * score >= 70 sugere o perfil suave ('Cliente recorrente'), score < 40 sugere
 * o assertivo ('Cliente pontual'). A app NUNCA muda o perfil sozinha.
 */
import { round2 } from './dinheiro.mjs';
import { diasAtraso } from './datas.mjs';

export const LIMIARES_OMISSAO = { sugerirSuave: 70, sugerirAssertivo: 40 };

/**
 * @param {{ dividas: Array, pagamentos: Array, promessasQuebradas?: number }} input
 *   `dividas` são as dívidas do cliente (com prestacoes quando existam);
 *   `pagamentos` os pagamentos do cliente. Promessas quebradas contam-se na
 *   linha do tempo (a app passa o total).
 * @returns {{ score: number, inputs: object }}
 */
export function calcularScore({ dividas = [], pagamentos = [], promessasQuebradas = 0 } = {}) {
  // Itens liquidados: para cada dívida/prestação paga, o atraso = data do
  // ÚLTIMO pagamento que a liquidou face ao vencimento.
  const pagamentosPor = new Map();
  for (const p of pagamentos) {
    const chave = `${p.dividaId}|${p.prestacaoId || ''}`;
    const lista = pagamentosPor.get(chave) || [];
    lista.push(p);
    pagamentosPor.set(chave, lista);
  }

  const atrasos = [];
  let liquidadosDentroPrazo = 0;
  let liquidadosTotal = 0;
  let valorIncobravel = 0;

  const analisarItem = (dividaId, prestacaoId, valor, dataVencimento, estado) => {
    if (estado === 'incobravel') {
      valorIncobravel = round2(valorIncobravel + Number(valor || 0));
      return;
    }
    const chave = `${dividaId}|${prestacaoId || ''}`;
    const doItem = (pagamentosPor.get(chave) || []).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const pago = round2(doItem.reduce((s, p) => s + Number(p.valor || 0), 0));
    if (pago < Number(valor || 0) - 0.01) return; // ainda em aberto - não conta
    liquidadosTotal += 1;
    const ultimo = doItem[doItem.length - 1];
    const atraso = diasAtraso(dataVencimento, ultimo ? ultimo.data : undefined);
    if (Number.isFinite(atraso)) {
      atrasos.push(Math.max(0, atraso));
      if (atraso <= 0) liquidadosDentroPrazo += 1;
    }
  };

  for (const d of dividas) {
    const plano = Array.isArray(d.prestacoes) && d.prestacoes.length > 0 ? d.prestacoes : null;
    if (!plano) {
      analisarItem(d.id, null, d.valor, d.dataVencimento, d.estado);
    } else {
      for (const p of plano) analisarItem(d.id, p.id, p.valor, p.dataVencimento, p.estado);
      if (d.estado === 'incobravel' && plano.every((p) => p.estado !== 'incobravel')) {
        valorIncobravel = round2(valorIncobravel + Number(d.valor || 0));
      }
    }
  }

  const mediaDiasAtraso = atrasos.length
    ? round2(atrasos.reduce((s, a) => s + a, 0) / atrasos.length)
    : 0;
  const pctDentroPrazo = liquidadosTotal
    ? round2((liquidadosDentroPrazo / liquidadosTotal) * 100)
    : null; // sem histórico -> sem percentagem (não inventa 100%)

  // Penalizações (documentadas): cada dia médio de atraso -1 (cap 40);
  // cada promessa quebrada -12 (cap 36); incobrável -1/50 EUR (cap 20);
  // pagar fora do prazo em mais de metade dos itens -10.
  let score = 100;
  score -= Math.min(40, mediaDiasAtraso);
  score -= Math.min(36, Number(promessasQuebradas || 0) * 12);
  score -= Math.min(20, Math.floor(valorIncobravel / 50));
  if (pctDentroPrazo != null && pctDentroPrazo < 50) score -= 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    inputs: {
      mediaDiasAtraso,
      pctDentroPrazo,
      itensLiquidados: liquidadosTotal,
      promessasQuebradas: Number(promessasQuebradas || 0),
      valorIncobravel,
    },
  };
}

/**
 * Sugestão de perfil face ao score e ao perfil atual. Devolve
 * { perfilSugerido: 'suave'|'assertivo', motivo } ou null quando não há nada a
 * sugerir. `perfilAtualTom` marca o tom do perfil atribuído hoje.
 */
export function sugerirPerfil({ score, perfilAtualTom, limiares = LIMIARES_OMISSAO, temHistorico = true }) {
  if (!temHistorico) return null; // sem dados não se sugere nada
  if (score >= limiares.sugerirSuave && perfilAtualTom !== 'suave') {
    return {
      perfilSugerido: 'suave',
      motivo: `Score ${score} >= ${limiares.sugerirSuave}: histórico de bom pagador, cadência suave é suficiente.`,
    };
  }
  if (score < limiares.sugerirAssertivo && perfilAtualTom !== 'assertivo') {
    return {
      perfilSugerido: 'assertivo',
      motivo: `Score ${score} < ${limiares.sugerirAssertivo}: histórico fraco, recomenda-se cadência assertiva.`,
    };
  }
  return null;
}
