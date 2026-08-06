/*
 * RECONCILIAÇÃO BANCÁRIA (rota /reconciliacao)
 *
 * Fluxo: importar extrato (CSV ou PDF) -> deduplicar por fingerprint ->
 * correspondência em três níveis:
 *   1. REGRAS guardadas (aplicarRegras): conciliação AUTOMÁTICA apenas sem
 *      qualquer ambiguidade;
 *   2. SUGESTÕES pontuadas (gerarCandidatos): confirmação humana obrigatória
 *      na primeira vez - confirmar cria a regra para a próxima;
 *   3. Sem sinal: o movimento fica 'nova' (ou é ignorado manualmente).
 *
 * Toda a atividade de negócio fica registada na linha do tempo IMUTÁVEL
 * (registarEvento) - nunca se editam nem apagam linhas dessa coleção.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tr, useLang, currentLang } from '../i18n.js';
import { useColecao, useClientes, useDefinicoes } from '../hooks.js';
import {
  listar, criar, atualizar, apagar, listarPartilhada, registarEvento,
  extrairDocumento, ficheiroParaBase64, disponivel,
} from '../ekoa.js';
import {
  Button, Badge, DataTable, Input, Modal, ConfirmDialog, toast,
  EmptyState, Skeleton, Tabs, Stat,
} from '../components/ui.jsx';
import { formatData, eur, indexarClientes } from '../components/dominio.jsx';
import { IconBanco, IconSincronizar, IconCerto } from '../components/Icons.jsx';
import { parseCsvExtrato } from '../engine/csv.mjs';
import { normalizarDescricao, fingerprintTransacao } from '../engine/normalizacao.mjs';
import { gerarCandidatos, aplicarRegras } from '../engine/matching.mjs';
import { itensEmAberto, estadoDerivado, cobrancaSuspensa } from '../engine/prestacoes.mjs';
import { parseDataFlex } from '../engine/datas.mjs';
import { round2, parseMontante } from '../engine/dinheiro.mjs';

/* ------------------------- helpers puros da página ------------------------ */

/** Tolerância de cêntimos partilhada com o motor de matching. */
const EPS = 0.011;

/** Estado agregado da dívida a partir das prestações recalculadas. */
function rolloutEstadoDivida(divida, prestacoes) {
  if (prestacoes.length && prestacoes.every((p) => p.estado === 'paga')) return 'paga';
  if (cobrancaSuspensa(divida.estado) || divida.estado === 'promessa') return divida.estado;
  if (prestacoes.some((p) => p.estado === 'paga' || p.estado === 'parcial')) return 'parcial';
  return 'aberta';
}

/** Abate um pagamento à visão local de itens em aberto (lote de auto-match). */
function ajustarItensAposPagamento(itens, alvo, valorPago) {
  return itens
    .map((i) => (
      i.dividaId === alvo.dividaId && (i.prestacaoId || null) === (alvo.prestacaoId || null)
        ? { ...i, valorEmDivida: round2(Number(i.valorEmDivida) - Number(valorPago)) }
        : i
    ))
    .filter((i) => i.valorEmDivida > EPS);
}

/**
 * Rotina PARTILHADA de confirmação de correspondência (auto e manual).
 * `ctx` = { dividas, pagamentos, regras, fila, tarefas } - listas atuais.
 * Devolve { pagamento, divida } para o chamador manter o contexto coerente.
 */
async function confirmarCorrespondencia(tx, item, { auto = false, regra = null, motivo = null } = {}, ctx) {
  // (1) Pagamento por transferência ligado à transação.
  const dadosPagamento = {
    clienteId: item.clienteId,
    dividaId: item.dividaId,
    prestacaoId: item.prestacaoId || null,
    valor: round2(Number(tx.valor)),
    data: tx.data,
    metodo: 'transferencia',
    transacaoId: tx.id,
    notas: tx.descricao || '',
  };
  const criado = await criar('pagamentos', dadosPagamento);
  const pagamento = criado && criado.id ? criado : { ...dadosPagamento, id: null };
  const pagamentosTodos = [...ctx.pagamentos, pagamento];

  // (2) Estado da dívida: por prestação quando há plano, senão derivado.
  const divida = ctx.dividas.find((d) => d.id === item.dividaId) || null;
  let dividaNova = null;
  if (divida) {
    if (item.prestacaoId && Array.isArray(divida.prestacoes) && divida.prestacoes.length) {
      const prestacoes = divida.prestacoes.map((p) => {
        if (p.id !== item.prestacaoId) return p;
        const pago = round2(pagamentosTodos
          .filter((x) => x.dividaId === divida.id && x.prestacaoId === p.id)
          .reduce((s, x) => s + Number(x.valor || 0), 0));
        const estadoP = pago >= round2(Number(p.valor || 0)) - EPS ? 'paga' : (pago > 0 ? 'parcial' : p.estado);
        return { ...p, estado: estadoP };
      });
      dividaNova = { ...divida, prestacoes, estado: rolloutEstadoDivida(divida, prestacoes) };
      await atualizar('dividas', divida.id, { prestacoes, estado: dividaNova.estado });
    } else {
      const estadoD = estadoDerivado(divida, pagamentosTodos);
      dividaNova = { ...divida, estado: estadoD };
      await atualizar('dividas', divida.id, { estado: estadoD });
    }
  }

  // (3) Transação passa a conciliada.
  await atualizar('extratos_transacoes', tx.id, {
    estado: 'conciliada',
    matchDividaId: item.dividaId,
    matchPrestacaoId: item.prestacaoId || null,
    pagamentoId: pagamento.id,
    matchAuto: !!auto,
    sugestoes: null,
  });

  // (4) Item liquidado por inteiro -> cancela a cobrança pendente desse item.
  const liquidado = round2(Number(item.valorEmDivida) - Number(tx.valor)) <= EPS;
  if (liquidado) {
    for (const envio of ctx.fila) {
      if (envio.estado !== 'rascunho') continue;
      const inclui = (envio.itens || []).some(
        (it) => it.dividaId === item.dividaId && (it.prestacaoId || null) === (item.prestacaoId || null),
      );
      if (!inclui) continue;
      await atualizar('fila_envios', envio.id, { estado: 'ignorada' });
      await registarEvento({
        clienteId: envio.clienteId,
        dividaId: item.dividaId,
        prestacaoId: item.prestacaoId || null,
        tipo: 'ignorado',
        titulo: tr('Envio cancelado: item liquidado', 'Send cancelled: item settled'),
        detalhe: envio.assunto || '',
        meta: Array.isArray(envio.lembreteChaves) && envio.lembreteChaves.length
          ? { chaves: envio.lembreteChaves }
          : null,
      });
    }
    for (const tarefa of ctx.tarefas) {
      if (tarefa.estado !== 'pendente') continue;
      if (tarefa.dividaId !== item.dividaId) continue;
      if ((tarefa.prestacaoId || null) !== (item.prestacaoId || null)) continue;
      await atualizar('tarefas_cobranca', tarefa.id, { estado: 'ignorada' });
    }
  }

  // (5) Linha do tempo imutável: match + pagamento.
  await registarEvento({
    clienteId: item.clienteId,
    dividaId: item.dividaId,
    prestacaoId: item.prestacaoId || null,
    tipo: 'match',
    titulo: auto ? tr('Correspondência automática', 'Automatic match') : tr('Correspondência confirmada', 'Match confirmed'),
    detalhe: [tx.descricao || '', eur(tx.valor)].filter(Boolean).join(' - '),
    meta: {
      transacaoId: tx.id,
      ...(regra && regra.id ? { regraId: regra.id } : {}),
      ...(motivo ? { motivo } : {}),
    },
  });
  await registarEvento({
    clienteId: item.clienteId,
    dividaId: item.dividaId,
    prestacaoId: item.prestacaoId || null,
    tipo: 'pagamento',
    titulo: tr('Pagamento por transferência', 'Payment by bank transfer'),
    detalhe: `${eur(tx.valor)} - ${formatData(tx.data)}`,
    meta: { pagamentoId: pagamento.id, transacaoId: tx.id },
  });

  // (6) Confirmação manual cria a regra para as próximas transferências.
  if (!auto) {
    const padrao = tx.descricaoNormalizada || normalizarDescricao(tx.descricao || '');
    if (padrao) {
      const existe = ctx.regras.some((r) => r.padrao === padrao && r.clienteId === item.clienteId);
      if (!existe) {
        await criar('regras_correspondencia', {
          clienteId: item.clienteId,
          padrao,
          ativa: true,
          criadaDeTransacaoId: tx.id,
        });
      }
    }
  }

  return { pagamento, divida: dividaNova };
}

/* --------------------------------- página -------------------------------- */

export default function ReconciliacaoPage() {
  useLang();
  useDefinicoes();
  const hookTxs = useColecao('extratos_transacoes');
  const hookRegras = useColecao('regras_correspondencia');
  const hookDividas = useColecao('dividas');
  const hookPagamentos = useColecao('pagamentos');
  const hookFila = useColecao('fila_envios');
  const hookTarefas = useColecao('tarefas_cobranca');
  const hookClientes = useClientes();

  const [tab, setTab] = useState('por-conciliar');
  const [aImportar, setAImportar] = useState(false);
  const [aCorresponder, setACorresponder] = useState(false);
  const [aAgir, setAAgir] = useState(false);
  const [errosImport, setErrosImport] = useState([]);
  const [reverterTx, setReverterTx] = useState(null);
  const [regraAposReverter, setRegraAposReverter] = useState(null);
  const ocupadoRef = useRef(false);

  const clientesById = useMemo(() => indexarClientes(hookClientes.items), [hookClientes.items]);

  const porDataDesc = (a, b) => String(b.data || '').localeCompare(String(a.data || ''));
  const creditosPendentes = useMemo(
    () => hookTxs.items
      .filter((t) => t.tipo === 'credito' && (t.estado === 'nova' || t.estado === 'sugerida'))
      .sort(porDataDesc),
    [hookTxs.items],
  );
  const debitos = useMemo(
    () => hookTxs.items.filter((t) => t.tipo === 'debito').sort(porDataDesc),
    [hookTxs.items],
  );
  const conciliadas = useMemo(
    () => hookTxs.items.filter((t) => t.estado === 'conciliada').sort(porDataDesc),
    [hookTxs.items],
  );
  const ignoradas = useMemo(
    () => hookTxs.items.filter((t) => t.estado === 'ignorada').sort(porDataDesc),
    [hookTxs.items],
  );
  const somaPendentes = useMemo(
    () => round2(creditosPendentes.reduce((s, t) => s + Number(t.valor || 0), 0)),
    [creditosPendentes],
  );
  const nAutomaticas = useMemo(() => conciliadas.filter((t) => t.matchAuto).length, [conciliadas]);
  const regrasOrdenadas = useMemo(
    () => [...hookRegras.items].sort((a, b) => String(a.padrao || '').localeCompare(String(b.padrao || ''))),
    [hookRegras.items],
  );
  const regrasAtivasN = useMemo(
    () => hookRegras.items.filter((r) => r.ativa !== false).length,
    [hookRegras.items],
  );

  const refreshTudo = useCallback(async () => {
    await Promise.all([
      hookTxs.refresh(), hookRegras.refresh(), hookDividas.refresh(),
      hookPagamentos.refresh(), hookFila.refresh(), hookTarefas.refresh(),
    ]);
  }, [hookTxs.refresh, hookRegras.refresh, hookDividas.refresh, hookPagamentos.refresh, hookFila.refresh, hookTarefas.refresh]);

  /* ----------------------------- correspondência ----------------------------- */

  const executarCorrespondencia = useCallback(async ({ silencioso = false } = {}) => {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setACorresponder(true);
    try {
      // Estado FRESCO do servidor - o lote pode correr logo a seguir ao upload.
      const [txsAtuais, regrasAtuais, dividasAtuais, pagamentosAtuais, filaAtual, tarefasAtuais, clientesAtuais] = await Promise.all([
        listar('extratos_transacoes'),
        listar('regras_correspondencia'),
        listar('dividas'),
        listar('pagamentos'),
        listar('fila_envios'),
        listar('tarefas_cobranca'),
        listarPartilhada('clientes'),
      ]);
      const porId = indexarClientes(clientesAtuais);
      let itens = itensEmAberto(dividasAtuais, pagamentosAtuais, porId);
      const ctx = {
        dividas: dividasAtuais,
        pagamentos: pagamentosAtuais,
        regras: regrasAtuais,
        fila: filaAtual,
        tarefas: tarefasAtuais,
      };
      const pendentes = txsAtuais
        .filter((t) => t.tipo === 'credito' && (t.estado === 'nova' || t.estado === 'sugerida'))
        .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));

      let autoN = 0;
      let sugeridasN = 0;
      for (const tx of pendentes) {
        const r = aplicarRegras(tx, ctx.regras, itens);
        if (r.auto) {
          const res = await confirmarCorrespondencia(tx, r.auto, { auto: true, regra: r.regra, motivo: r.motivo }, ctx);
          ctx.pagamentos = [...ctx.pagamentos, res.pagamento];
          if (res.divida) ctx.dividas = ctx.dividas.map((d) => (d.id === res.divida.id ? res.divida : d));
          itens = ajustarItensAposPagamento(itens, r.auto, tx.valor);
          autoN += 1;
        } else {
          const cands = gerarCandidatos(tx, itens);
          await atualizar('extratos_transacoes', tx.id, {
            estado: cands.length ? 'sugerida' : 'nova',
            sugestoes: cands.slice(0, 3).map((c) => ({
              dividaId: c.item.dividaId,
              prestacaoId: c.item.prestacaoId,
              clienteId: c.item.clienteId,
              clienteNome: c.item.clienteNome,
              descricao: c.item.descricao,
              valorEmDivida: c.item.valorEmDivida,
              dataVencimento: c.item.dataVencimento,
              pontuacao: c.pontuacao,
              nivel: c.nivel,
              motivos: c.motivos,
            })),
            matchInfo: r.motivo,
          });
          if (cands.length) sugeridasN += 1;
        }
      }
      if (!silencioso || pendentes.length > 0) {
        toast(
          tr(
            `${autoN} conciliados automaticamente, ${sugeridasN} com sugestões.`,
            `${autoN} auto-matched, ${sugeridasN} with suggestions.`,
          ),
          { tone: 'ok' },
        );
      }
      await refreshTudo();
    } catch (err) {
      console.error('[cobrancas] falha na correspondência:', err);
      toast(tr('Falha ao executar a correspondência.', 'Matching run failed.'), { tone: 'error' });
    } finally {
      ocupadoRef.current = false;
      setACorresponder(false);
    }
  }, [refreshTudo]);

  // Intenção pendente do assistente: 'corresponder' dispara o lote ao montar.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__cobrancasAcaoPendente === 'corresponder') {
      window.__cobrancasAcaoPendente = null;
      executarCorrespondencia();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------------- upload --------------------------------- */

  const onFicheiro = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!disponivel()) {
      toast(tr('Plataforma indisponível nesta pré-visualização.', 'Platform unavailable in this preview.'), { tone: 'error' });
      return;
    }
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setAImportar(true);
    setErrosImport([]);
    try {
      const nome = file.name || '';
      const ehPdf = file.type === 'application/pdf' || /\.pdf$/i.test(nome);
      const linhas = [];
      const errosParse = [];

      if (ehPdf) {
        const pdfBase64 = await ficheiroParaBase64(file);
        const r = await extrairDocumento({ kind: 'bank-statement', pdfBase64, language: currentLang() });
        if (!r.success) {
          toast(r.error || tr('Falha na extração do PDF.', 'PDF extraction failed.'), { tone: 'error' });
          return;
        }
        const brutas = r.data && Array.isArray(r.data.transacoes) ? r.data.transacoes : [];
        for (const t of brutas) {
          const dataIso = parseDataFlex(String(t.data || ''));
          const v = typeof t.valor === 'number' ? t.valor : parseMontante(String(t.valor == null ? '' : t.valor));
          if (!dataIso || v == null || !Number.isFinite(Number(v))) {
            errosParse.push(tr(
              `Movimento ilegível no PDF (data "${t.data ?? ''}", valor "${t.valor ?? ''}").`,
              `Unreadable transaction in the PDF (date "${t.data ?? ''}", amount "${t.valor ?? ''}").`,
            ));
            continue;
          }
          const tipo = t.tipo === 'debito' || t.tipo === 'credito' ? t.tipo : (Number(v) < 0 ? 'debito' : 'credito');
          linhas.push({
            data: dataIso,
            descricao: String(t.descricao || ''),
            valor: round2(Math.abs(Number(v))),
            tipo,
            saldo: t.saldo == null ? null : Number(t.saldo),
          });
        }
      } else {
        const texto = await file.text();
        const r = parseCsvExtrato(texto);
        linhas.push(...r.transacoes);
        errosParse.push(...r.erros);
      }

      // DEDUPLICAÇÃO por fingerprint (data|valor|descritivo normalizado):
      // reimportar o mesmo período nunca duplica movimentos.
      const existentes = await listar('extratos_transacoes');
      const fingerprints = new Set(existentes.map((t) => t.fingerprint).filter(Boolean));
      let novos = 0;
      let duplicados = 0;
      for (const t of linhas) {
        const fp = fingerprintTransacao({ data: t.data, valor: t.valor, descricao: t.descricao });
        if (fingerprints.has(fp)) {
          duplicados += 1;
          continue;
        }
        fingerprints.add(fp);
        await criar('extratos_transacoes', {
          fingerprint: fp,
          data: t.data,
          descricao: t.descricao || '',
          descricaoNormalizada: normalizarDescricao(t.descricao || ''),
          valor: round2(Number(t.valor)),
          tipo: t.tipo === 'debito' ? 'debito' : 'credito',
          saldo: t.saldo == null ? null : t.saldo,
          origemFicheiro: nome,
          estado: 'nova',
        });
        novos += 1;
      }
      setErrosImport(errosParse);
      toast(
        tr(
          `${novos} movimentos novos, ${duplicados} duplicados ignorados, ${errosParse.length} erros.`,
          `${novos} new transactions, ${duplicados} duplicates skipped, ${errosParse.length} errors.`,
        ),
        { tone: novos > 0 ? 'ok' : 'info' },
      );
      await refreshTudo();
      ocupadoRef.current = false;
      // Após a importação, a correspondência corre automaticamente.
      await executarCorrespondencia({ silencioso: true });
    } catch (err) {
      console.error('[cobrancas] falha na importação do extrato:', err);
      toast(tr('Falha ao importar o extrato.', 'Failed to import the statement.'), { tone: 'error' });
    } finally {
      ocupadoRef.current = false;
      setAImportar(false);
    }
  };

  /* ------------------------- ações sobre movimentos ------------------------- */

  const confirmarSugestao = async (tx, sug) => {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setAAgir(true);
    try {
      const item = {
        dividaId: sug.dividaId,
        prestacaoId: sug.prestacaoId || null,
        clienteId: sug.clienteId,
        clienteNome: sug.clienteNome,
        descricao: sug.descricao,
        valorEmDivida: sug.valorEmDivida,
        dataVencimento: sug.dataVencimento,
      };
      const ctx = {
        dividas: hookDividas.items,
        pagamentos: hookPagamentos.items,
        regras: hookRegras.items,
        fila: hookFila.items,
        tarefas: hookTarefas.items,
      };
      await confirmarCorrespondencia(tx, item, { auto: false }, ctx);
      toast(tr('Correspondência confirmada.', 'Match confirmed.'), { tone: 'ok' });
      await refreshTudo();
    } catch (err) {
      console.error('[cobrancas] falha ao confirmar correspondência:', err);
      toast(tr('Falha ao confirmar a correspondência.', 'Failed to confirm the match.'), { tone: 'error' });
    } finally {
      ocupadoRef.current = false;
      setAAgir(false);
    }
  };

  const rejeitarSugestao = async (tx, sug) => {
    try {
      const restantes = (tx.sugestoes || []).filter(
        (s) => !(s.dividaId === sug.dividaId && (s.prestacaoId || null) === (sug.prestacaoId || null)),
      );
      await atualizar('extratos_transacoes', tx.id, {
        sugestoes: restantes,
        estado: restantes.length ? 'sugerida' : 'nova',
      });
      await hookTxs.refresh();
    } catch {
      toast(tr('Falha ao rejeitar a sugestão.', 'Failed to reject the suggestion.'), { tone: 'error' });
    }
  };

  const ignorarMovimento = async (tx) => {
    try {
      await atualizar('extratos_transacoes', tx.id, { estado: 'ignorada' });
      toast(tr('Movimento ignorado.', 'Transaction ignored.'), { tone: 'info' });
      await hookTxs.refresh();
    } catch {
      toast(tr('Falha ao ignorar o movimento.', 'Failed to ignore the transaction.'), { tone: 'error' });
    }
  };

  const restaurarMovimento = async (tx) => {
    try {
      await atualizar('extratos_transacoes', tx.id, { estado: 'nova' });
      toast(tr('Movimento reposto para conciliação.', 'Transaction restored for reconciliation.'), { tone: 'ok' });
      await hookTxs.refresh();
    } catch {
      toast(tr('Falha ao repor o movimento.', 'Failed to restore the transaction.'), { tone: 'error' });
    }
  };

  const reverterConfirmado = async () => {
    const tx = reverterTx;
    setReverterTx(null);
    if (!tx || ocupadoRef.current) return;
    ocupadoRef.current = true;
    setAAgir(true);
    try {
      const [pagamentosAtuais, dividasAtuais] = await Promise.all([listar('pagamentos'), listar('dividas')]);
      const pagamento = pagamentosAtuais.find((p) => p.id === tx.pagamentoId) || null;
      if (tx.pagamentoId) {
        await apagar('pagamentos', tx.pagamentoId);
      }
      const restantes = pagamentosAtuais.filter((p) => p.id !== tx.pagamentoId);
      const divida = dividasAtuais.find((d) => d.id === tx.matchDividaId) || null;
      if (divida) {
        if (tx.matchPrestacaoId && Array.isArray(divida.prestacoes) && divida.prestacoes.length) {
          const prestacoes = divida.prestacoes.map((p) => {
            if (p.id !== tx.matchPrestacaoId) return p;
            const pago = round2(restantes
              .filter((x) => x.dividaId === divida.id && x.prestacaoId === p.id)
              .reduce((s, x) => s + Number(x.valor || 0), 0));
            const estadoP = pago >= round2(Number(p.valor || 0)) - EPS ? 'paga' : (pago > 0 ? 'parcial' : 'aberta');
            return { ...p, estado: estadoP };
          });
          await atualizar('dividas', divida.id, { prestacoes, estado: rolloutEstadoDivida(divida, prestacoes) });
        } else {
          await atualizar('dividas', divida.id, { estado: estadoDerivado(divida, restantes) });
        }
      }
      await atualizar('extratos_transacoes', tx.id, {
        estado: 'nova',
        matchDividaId: null,
        matchPrestacaoId: null,
        pagamentoId: null,
        matchAuto: null,
      });
      await registarEvento({
        clienteId: (divida && divida.clienteId) || (pagamento && pagamento.clienteId) || null,
        dividaId: tx.matchDividaId || null,
        prestacaoId: tx.matchPrestacaoId || null,
        tipo: 'match-revertido',
        titulo: tr('Correspondência revertida', 'Match reversed'),
        detalhe: [tx.descricao || '', eur(tx.valor)].filter(Boolean).join(' - '),
        meta: { transacaoId: tx.id },
      });
      toast(tr('Correspondência revertida.', 'Match reversed.'), { tone: 'ok' });

      // Regra associada ao descritivo? Deixar a decisão ao utilizador.
      const padrao = tx.descricaoNormalizada || normalizarDescricao(tx.descricao || '');
      if (padrao) {
        const regrasAtuais = await listar('regras_correspondencia');
        const associada = regrasAtuais.find((r) => r.padrao === padrao) || null;
        if (associada) setRegraAposReverter(associada);
      }
      await refreshTudo();
    } catch (err) {
      console.error('[cobrancas] falha ao reverter correspondência:', err);
      toast(tr('Falha ao reverter a correspondência.', 'Failed to reverse the match.'), { tone: 'error' });
    } finally {
      ocupadoRef.current = false;
      setAAgir(false);
    }
  };

  /* --------------------------------- regras --------------------------------- */

  const alternarRegra = async (regra) => {
    try {
      await atualizar('regras_correspondencia', regra.id, { ativa: regra.ativa === false });
      await hookRegras.refresh();
    } catch {
      toast(tr('Falha ao atualizar a regra.', 'Failed to update the rule.'), { tone: 'error' });
    }
  };

  const apagarRegra = async (regra) => {
    try {
      await apagar('regras_correspondencia', regra.id);
      toast(tr('Regra apagada.', 'Rule deleted.'), { tone: 'ok' });
      await hookRegras.refresh();
    } catch {
      toast(tr('Falha ao apagar a regra.', 'Failed to delete the rule.'), { tone: 'error' });
    }
  };

  const manterRegraAssociada = () => setRegraAposReverter(null);

  const desativarRegraAssociada = async () => {
    const regra = regraAposReverter;
    setRegraAposReverter(null);
    if (!regra) return;
    try {
      await atualizar('regras_correspondencia', regra.id, { ativa: false });
      toast(tr('Regra desativada.', 'Rule deactivated.'), { tone: 'ok' });
      await hookRegras.refresh();
    } catch {
      toast(tr('Falha ao desativar a regra.', 'Failed to deactivate the rule.'), { tone: 'error' });
    }
  };

  const apagarRegraAssociada = async () => {
    const regra = regraAposReverter;
    setRegraAposReverter(null);
    if (!regra) return;
    await apagarRegra(regra);
  };

  /* -------------------------------- render --------------------------------- */

  const carregando = hookTxs.loading && hookTxs.items.length === 0;
  const ocupado = aImportar || aCorresponder || aAgir;

  const motivoTexto = (m) => {
    switch (m && m.tipo) {
      case 'valor-exato': return tr('valor exato', 'exact amount');
      case 'valor-parcial': return tr('valor parcial', 'partial amount');
      case 'nome-contido': return tr('nome no descritivo', 'name in the description');
      case 'nome-semelhante': return tr('nome semelhante', 'similar name');
      case 'data-proxima': return tr('data próxima', 'close due date');
      default: return (m && m.tipo) || '';
    }
  };

  const nomeClienteDaTransacao = (t) => {
    const divida = hookDividas.items.find((d) => d.id === t.matchDividaId) || null;
    const pagamento = divida ? null : hookPagamentos.items.find((p) => p.id === t.pagamentoId) || null;
    const clienteId = (divida && divida.clienteId) || (pagamento && pagamento.clienteId) || null;
    const cliente = clienteId ? clientesById.get(clienteId) : null;
    return (cliente && cliente.nome) || '-';
  };

  const colunasDebitos = [
    { key: 'data', label: tr('Data', 'Date'), render: (t) => formatData(t.data) },
    { key: 'descricao', label: tr('Descritivo', 'Description') },
    { key: 'valor', label: tr('Valor', 'Amount'), alinhar: 'direita', render: (t) => eur(t.valor) },
  ];

  const colunasConciliadas = [
    { key: 'data', label: tr('Data', 'Date'), render: (t) => formatData(t.data) },
    { key: 'descricao', label: tr('Descritivo', 'Description') },
    { key: 'valor', label: tr('Valor', 'Amount'), alinhar: 'direita', render: (t) => eur(t.valor) },
    { key: 'cliente', label: tr('Cliente', 'Customer'), render: (t) => nomeClienteDaTransacao(t) },
    {
      key: 'modo',
      label: tr('Modo', 'Mode'),
      render: (t) => (t.matchAuto
        ? <Badge tone="accent">{tr('Automática', 'Automatic')}</Badge>
        : <Badge tone="neutral">{tr('Manual', 'Manual')}</Badge>),
    },
    {
      key: 'acoes',
      label: '',
      render: (t) => (
        <Button
          variant="ghost"
          size="sm"
          data-testid="btn-reverter-match"
          onClick={() => setReverterTx(t)}
          disabled={ocupado}
        >
          {tr('Reverter', 'Reverse')}
        </Button>
      ),
    },
  ];

  const colunasIgnoradas = [
    { key: 'data', label: tr('Data', 'Date'), render: (t) => formatData(t.data) },
    { key: 'descricao', label: tr('Descritivo', 'Description') },
    { key: 'valor', label: tr('Valor', 'Amount'), alinhar: 'direita', render: (t) => eur(t.valor) },
    {
      key: 'tipo',
      label: tr('Tipo', 'Type'),
      render: (t) => (t.tipo === 'debito' ? tr('Débito', 'Debit') : tr('Crédito', 'Credit')),
    },
    {
      key: 'acoes',
      label: '',
      render: (t) => (
        <Button
          variant="ghost"
          size="sm"
          data-testid="btn-restaurar-movimento"
          onClick={() => restaurarMovimento(t)}
          disabled={ocupado}
        >
          {tr('Repor', 'Restore')}
        </Button>
      ),
    },
  ];

  const colunasRegras = [
    {
      key: 'padrao',
      label: tr('Padrão normalizado', 'Normalised pattern'),
      render: (r) => <code>{r.padrao}</code>,
    },
    {
      key: 'cliente',
      label: tr('Cliente', 'Customer'),
      render: (r) => {
        const c = clientesById.get(r.clienteId);
        return (c && c.nome) || tr('(cliente desconhecido)', '(unknown customer)');
      },
    },
    {
      key: 'ativa',
      label: tr('Ativa', 'Active'),
      render: (r) => (
        <input
          type="checkbox"
          checked={r.ativa !== false}
          onChange={() => alternarRegra(r)}
          data-testid="toggle-regra-ativa"
          aria-label={tr('Regra ativa', 'Rule active')}
        />
      ),
    },
    {
      key: 'origem',
      label: tr('Origem', 'Origin'),
      render: (r) => {
        const txOrigem = hookTxs.items.find((t) => t.id === r.criadaDeTransacaoId) || null;
        return txOrigem ? (txOrigem.descricao || formatData(txOrigem.data)) : '-';
      },
    },
    {
      key: 'acoes',
      label: '',
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          data-testid="btn-apagar-regra"
          onClick={() => apagarRegra(r)}
          disabled={ocupado}
        >
          {tr('Apagar', 'Delete')}
        </Button>
      ),
    },
  ];

  const renderPorConciliar = () => {
    if (!creditosPendentes.length && !debitos.length) {
      return (
        <EmptyState
          icon={<IconBanco size={28} />}
          title={tr('Sem movimentos por conciliar', 'No transactions to reconcile')}
          hint={tr('Importe um extrato bancário (CSV ou PDF) para começar.', 'Import a bank statement (CSV or PDF) to get started.')}
        />
      );
    }
    return (
      <div data-testid="lista-por-conciliar" data-demo-target="reconciliacao-por-conciliar">
        {creditosPendentes.map((tx) => (
          <div key={tx.id} className="cartao" data-testid="movimento-pendente">
            <div className="linha-acoes" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <p style={{ fontWeight: 600, margin: 0 }}>
                  {tx.descricao || tr('(sem descritivo)', '(no description)')}
                </p>
                <p className="campo__dica" style={{ margin: 0 }}>
                  {formatData(tx.data)}
                  {tx.origemFicheiro ? ` · ${tx.origemFicheiro}` : ''}
                </p>
              </div>
              <div className="linha-acoes" style={{ flexWrap: 'wrap', gap: 8 }}>
                <strong>{eur(tx.valor)}</strong>
                {tx.estado === 'sugerida'
                  ? <Badge tone="info">{tr('Com sugestões', 'Has suggestions')}</Badge>
                  : <Badge tone="neutral">{tr('Sem correspondência', 'No match')}</Badge>}
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="btn-ignorar-movimento"
                  onClick={() => ignorarMovimento(tx)}
                  disabled={ocupado}
                >
                  {tr('Ignorar movimento', 'Ignore transaction')}
                </Button>
              </div>
            </div>
            {(tx.sugestoes || []).map((sug) => (
              <div
                key={`${sug.dividaId}|${sug.prestacaoId || ''}`}
                className="linha-acoes"
                data-testid="sugestao-match"
                style={{
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 8,
                  borderTop: '1px solid rgba(127,127,127,0.25)',
                  paddingTop: 10,
                  marginTop: 10,
                }}
              >
                <div>
                  <p style={{ margin: 0 }}>
                    <strong>{sug.clienteNome || tr('(cliente desconhecido)', '(unknown customer)')}</strong>
                    {sug.descricao ? ` - ${sug.descricao}` : ''}
                  </p>
                  <p className="campo__dica" style={{ margin: 0 }}>
                    {tr('Em dívida', 'Outstanding')}: {eur(sug.valorEmDivida)}
                    {' · '}
                    {tr('vence a', 'due on')} {formatData(sug.dataVencimento)}
                  </p>
                  <p style={{ margin: '4px 0 0' }}>
                    <Badge tone={sug.nivel === 'alta' ? 'ok' : sug.nivel === 'media' ? 'warn' : 'neutral'}>
                      {sug.nivel === 'alta'
                        ? tr('Confiança alta', 'High confidence')
                        : sug.nivel === 'media'
                          ? tr('Confiança média', 'Medium confidence')
                          : tr('Confiança baixa', 'Low confidence')}
                    </Badge>
                    {' '}
                    <span className="campo__dica">
                      {(sug.motivos || []).map(motivoTexto).filter(Boolean).join(', ')}
                    </span>
                  </p>
                </div>
                <div className="linha-acoes" style={{ gap: 8 }}>
                  <Button
                    size="sm"
                    data-testid="btn-confirmar-match"
                    onClick={() => confirmarSugestao(tx, sug)}
                    disabled={ocupado}
                  >
                    <IconCerto size={14} /> {tr('Confirmar', 'Confirm')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="btn-rejeitar-match"
                    onClick={() => rejeitarSugestao(tx, sug)}
                    disabled={ocupado}
                  >
                    {tr('Rejeitar', 'Reject')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))}
        {debitos.length > 0 ? (
          <details className="espacador" data-testid="debitos-informativos">
            <summary style={{ cursor: 'pointer' }}>
              {tr(`Débitos (${debitos.length}) - apenas informativos`, `Debits (${debitos.length}) - informational only`)}
            </summary>
            <DataTable
              columns={colunasDebitos}
              rows={debitos}
              empty={null}
            />
          </details>
        ) : null}
      </div>
    );
  };

  const renderConciliadas = () => (
    <DataTable
      columns={colunasConciliadas}
      rows={conciliadas}
      data-testid="tabela-conciliadas"
      empty={(
        <EmptyState
          icon={<IconBanco size={28} />}
          title={tr('Ainda sem movimentos conciliados', 'No matched transactions yet')}
          hint={tr('Confirme sugestões no separador "Por conciliar".', 'Confirm suggestions in the "To reconcile" tab.')}
        />
      )}
    />
  );

  const renderIgnoradas = () => (
    <DataTable
      columns={colunasIgnoradas}
      rows={ignoradas}
      data-testid="tabela-ignoradas"
      empty={(
        <EmptyState
          icon={<IconBanco size={28} />}
          title={tr('Sem movimentos ignorados', 'No ignored transactions')}
          hint={tr('Movimentos que não pertencem a clientes podem ser ignorados no separador "Por conciliar".', 'Transactions that do not belong to customers can be ignored in the "To reconcile" tab.')}
        />
      )}
    />
  );

  return (
    <div>
      <div className="grelha-stats">
        <Stat
          label={tr('Créditos por conciliar', 'Credits to reconcile')}
          value={String(creditosPendentes.length)}
          sub={eur(somaPendentes)}
          tone={creditosPendentes.length > 0 ? 'alerta' : undefined}
          demoTarget="reconciliacao-stat-pendentes"
        />
        <Stat
          label={tr('Conciliadas', 'Matched')}
          value={String(conciliadas.length)}
          sub={tr(`${nAutomaticas} automáticas`, `${nAutomaticas} automatic`)}
          tone={conciliadas.length > 0 ? 'ok' : undefined}
        />
        <Stat
          label={tr('Regras ativas', 'Active rules')}
          value={String(regrasAtivasN)}
          sub={tr('criadas ao confirmar sugestões', 'created when confirming suggestions')}
        />
      </div>

      <section className="cartao" data-demo-target="reconciliacao-upload">
        <h2 className="cartao__titulo">{tr('Importar extrato bancário', 'Import bank statement')}</h2>
        <p className="campo__dica">
          {tr(
            'CSV exportado do banco ou extrato em PDF. Reimportar o mesmo período nunca duplica movimentos.',
            'Bank CSV export or PDF statement. Re-importing the same period never duplicates transactions.',
          )}
        </p>
        <div className="linha-acoes" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Input
            type="file"
            accept=".csv,text/csv,application/pdf"
            data-testid="input-extrato"
            onChange={onFicheiro}
            disabled={ocupado}
            style={{ maxWidth: 360 }}
          />
          <Button
            data-testid="btn-corresponder"
            data-demo-target="reconciliacao-corresponder"
            onClick={() => executarCorrespondencia()}
            disabled={ocupado}
          >
            <IconSincronizar size={16} />
            {' '}
            {aCorresponder ? tr('A corresponder...', 'Matching...') : tr('Executar correspondência', 'Run matching')}
          </Button>
        </div>
        {aImportar ? (
          <p className="campo__dica">{tr('A importar o extrato...', 'Importing the statement...')}</p>
        ) : null}
        {errosImport.length > 0 ? (
          <div className="cartao cartao--aviso" data-testid="erros-importacao">
            <h3 className="cartao__titulo">{tr('Linhas com problemas', 'Problem lines')}</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errosImport.map((erro, i) => (
                <li key={i}>{erro}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="cartao" data-demo-target="reconciliacao-resultados">
        <Tabs
          tabs={[
            { id: 'por-conciliar', label: tr('Por conciliar', 'To reconcile'), badge: creditosPendentes.length, demoTarget: 'tab-por-conciliar' },
            { id: 'conciliadas', label: tr('Conciliadas', 'Matched'), badge: conciliadas.length, demoTarget: 'tab-conciliadas' },
            { id: 'ignoradas', label: tr('Ignoradas', 'Ignored'), badge: ignoradas.length, demoTarget: 'tab-ignoradas' },
          ]}
          active={tab}
          onChange={setTab}
        />
        {carregando
          ? <Skeleton lines={5} />
          : tab === 'por-conciliar'
            ? renderPorConciliar()
            : tab === 'conciliadas'
              ? renderConciliadas()
              : renderIgnoradas()}
      </section>

      <section className="cartao" data-demo-target="reconciliacao-regras">
        <h2 className="cartao__titulo">{tr('Regras de correspondência', 'Matching rules')}</h2>
        <p className="campo__dica">
          {tr(
            'Um movimento novo cujo descritivo normalizado case com uma regra e cujo valor corresponda a exatamente um item em aberto desse cliente é conciliado automaticamente; qualquer ambiguidade volta a sugestão.',
            'A new transaction whose normalised description matches a rule and whose amount corresponds to exactly one open item of that customer is matched automatically; any ambiguity falls back to a suggestion.',
          )}
        </p>
        <DataTable
          columns={colunasRegras}
          rows={regrasOrdenadas}
          data-testid="tabela-regras"
          empty={(
            <EmptyState
              icon={<IconCerto size={28} />}
              title={tr('Ainda sem regras', 'No rules yet')}
              hint={tr('Ao confirmar uma sugestão, a app guarda o descritivo normalizado como regra para conciliar as próximas transferências desse cliente automaticamente.', "When a suggestion is confirmed, the app stores the normalised description as a rule to match that customer's next transfers automatically.")}
            />
          )}
        />
      </section>

      <ConfirmDialog
        open={!!reverterTx}
        title={tr('Reverter correspondência', 'Reverse match')}
        message={reverterTx
          ? tr(
            `Apagar o pagamento de ${eur(reverterTx.valor)} e repor o movimento por conciliar? A dívida volta ao estado anterior.`,
            `Delete the ${eur(reverterTx.valor)} payment and put the transaction back as unreconciled? The debt returns to its previous state.`,
          )
          : ''}
        confirmLabel={tr('Reverter', 'Reverse')}
        cancelLabel={tr('Cancelar', 'Cancel')}
        danger
        onConfirm={reverterConfirmado}
        onCancel={() => setReverterTx(null)}
      />

      <Modal
        open={!!regraAposReverter}
        title={tr('Regra associada', 'Associated rule')}
        onClose={manterRegraAssociada}
        actions={(
          <>
            <Button variant="ghost" data-testid="btn-regra-manter" onClick={manterRegraAssociada}>
              {tr('Manter', 'Keep')}
            </Button>
            <Button variant="secondary" data-testid="btn-regra-desativar" onClick={desativarRegraAssociada}>
              {tr('Desativar', 'Deactivate')}
            </Button>
            <Button variant="danger" data-testid="btn-regra-apagar" onClick={apagarRegraAssociada}>
              {tr('Apagar', 'Delete')}
            </Button>
          </>
        )}
      >
        <p>
          {tr(
            'Existe uma regra de correspondência automática criada a partir deste descritivo. O que pretende fazer com ela?',
            'There is an automatic matching rule created from this description. What would you like to do with it?',
          )}
        </p>
        {regraAposReverter ? <p><code>{regraAposReverter.padrao}</code></p> : null}
      </Modal>
    </div>
  );
}
