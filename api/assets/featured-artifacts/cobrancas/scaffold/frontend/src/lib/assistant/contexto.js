/*
 * Instantâneo de dados para o assistente - calculado NA APP (que tem os dados
 * e os motores deterministas) e enviado ao endpoint /api/app-assistant, que o
 * usa como única base factual. Mantido COMPACTO: totais, itens vencidos,
 * fila de trabalho e reconciliação pendente - nunca coleções inteiras.
 */
import { listar, listarPartilhada } from '../../ekoa.js';
import { itensEmAberto } from '../../engine/prestacoes.mjs';
import { diasAtraso, hojeISO } from '../../engine/datas.mjs';
import { round2 } from '../../engine/dinheiro.mjs';
import { currentLang } from '../../i18n.js';

export async function construirContextoAssistente() {
  const [dividas, pagamentos, clientes, fila, tarefas, transacoes, avisos, perfis, overlays] = await Promise.all([
    listar('dividas'),
    listar('pagamentos'),
    listarPartilhada('clientes'),
    listar('fila_envios'),
    listar('tarefas_cobranca'),
    listar('extratos_transacoes'),
    listar('sync_avisos'),
    listar('perfis'),
    listar('clientes_cobranca'),
  ]);

  const clientesById = new Map(clientes.map((c) => [c.id, c]));
  const itens = itensEmAberto(dividas, pagamentos, clientesById);
  const hoje = hojeISO();

  const vencidos = itens
    .map((i) => ({ ...i, atraso: diasAtraso(i.dataVencimento, hoje) }))
    .filter((i) => Number.isFinite(i.atraso) && i.atraso > 0)
    .sort((a, b) => b.atraso - a.atraso)
    .slice(0, 15)
    .map((i) => ({
      cliente: i.clienteNome || '(sem cliente)',
      descricao: i.descricao,
      valorEmDivida: i.valorEmDivida,
      vencimento: i.dataVencimento,
      diasAtraso: i.atraso,
      prestacao: i.prestacaoId || null,
      promessa: i.promessaData || null,
    }));

  const overlayPorCliente = new Map(overlays.map((o) => [o.clienteId, o]));
  const perfilNome = (clienteId) => {
    const ov = overlayPorCliente.get(clienteId);
    const p = (ov && perfis.find((x) => x.id === ov.perfilId)) || perfis[0];
    return p ? p.nome : null;
  };

  return {
    hoje,
    lang: currentLang(),
    totais: {
      dividasEmAberto: itens.length,
      totalEmDivida: round2(itens.reduce((s, i) => s + i.valorEmDivida, 0)),
      totalVencido: round2(
        itens
          .filter((i) => { const a = diasAtraso(i.dataVencimento, hoje); return Number.isFinite(a) && a > 0; })
          .reduce((s, i) => s + i.valorEmDivida, 0),
      ),
      clientesNaBase: clientes.length,
    },
    itensVencidos: vencidos.map((v) => ({ ...v, perfil: perfilNome(
      (itens.find((i) => i.descricao === v.descricao) || {}).clienteId,
    ) })),
    filaDeTrabalho: {
      emailsPorAprovar: fila.filter((f) => f.estado === 'rascunho').length,
      emailsComErro: fila.filter((f) => f.estado === 'erro').length,
      rascunhosNoEmail: fila.filter((f) => f.estado === 'rascunho' && f.draftId).length,
      tarefasPendentes: tarefas.filter((t) => t.estado === 'pendente').length,
    },
    reconciliacao: {
      creditosPorConciliar: transacoes.filter((t) => t.tipo === 'credito' && (t.estado === 'nova' || t.estado === 'sugerida')).length,
      sugestoesAbertas: transacoes.filter((t) => t.estado === 'sugerida').length,
    },
    avisosSincronizacao: avisos.filter((a) => a.estado === 'aberto').length,
    perfisDisponiveis: perfis.map((p) => ({ nome: p.nome, tom: p.tom })),
  };
}

export const DESCRICAO_APP =
  'Aplicação de contas a receber e recuperação de créditos de um escritório de advogados: dívidas (com prestações), lembretes por perfil com aprovação prévia, reconciliação de extratos bancários e linha do tempo auditável. Ecrãs: / (painel), /dividas, /nova, /clientes, /fila (aprovações e tarefas), /reconciliacao, /perfis, /definicoes.';
