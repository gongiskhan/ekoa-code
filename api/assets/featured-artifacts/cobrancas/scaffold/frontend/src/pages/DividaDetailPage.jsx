/*
 * Detalhe de uma dívida - rota /dividas/:id.
 *
 * Tudo o que acontece a uma dívida passa por aqui: pagamentos, promessas,
 * alterações de estado, plano de prestações e juros de mora sugeridos (nunca
 * aplicados automaticamente). Cada ação de negócio deixa um registo IMUTÁVEL
 * na linha do tempo (registarEvento) - auditoria que pode acabar em tribunal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { tr, useLang } from '../i18n.js';
import { useClientes, useColecao, useDefinicoes } from '../hooks.js';
import { obter, listar, criar, atualizar, registarEvento } from '../ekoa.js';
import {
  Button, Badge, DataTable, Field, Input, Select, Textarea, Modal, ConfirmDialog,
  toast, EmptyState, Skeleton, Tabs, Stat,
} from '../components/ui.jsx';
import {
  EstadoBadge, estaVencida, formatData, formatDataHora, eur, rotuloEstado,
  resolverPerfil, indexarOverlay, LinhaTempo,
} from '../components/dominio.jsx';
import {
  IconVoltar, IconEuro, IconRelogio, IconAviso, IconBalanca, IconMais, IconFechar, IconDividas,
} from '../components/Icons.jsx';
import { round2, somaEuros, parseMontante } from '../engine/dinheiro.mjs';
import { hojeISO, addDias } from '../engine/datas.mjs';
import {
  gerarPlano, validarPlanoPersonalizado, estadoDerivado, cobrancaSuspensa,
} from '../engine/prestacoes.mjs';
import { computeJuros } from '../engine/juros.mjs';
import { TABELA_TAXAS, CUSTO_RECUPERACAO_EUR, CUSTO_RECUPERACAO_BASE } from '../engine/taxas.mjs';

const METODOS = [
  { id: 'transferencia', pt: 'Transferência', en: 'Bank transfer' },
  { id: 'multibanco', pt: 'Multibanco', en: 'Multibanco' },
  { id: 'numerario', pt: 'Numerário', en: 'Cash' },
  { id: 'outro', pt: 'Outro', en: 'Other' },
];

function rotuloMetodo(id) {
  const m = METODOS.find((x) => x.id === id);
  return m ? tr(m.pt, m.en) : id || '—';
}

function numeroPrestacao(prestacaoId) {
  return String(prestacaoId || '').replace(/^p/, '') || '—';
}

const PAG_INICIAL = { aberto: false, prestacaoId: '', valor: '', data: '', metodo: 'transferencia', notas: '' };
const PROM_INICIAL = { aberto: false, prestacaoId: '', data: '' };
const EST_INICIAL = { aberto: false, estado: '' };
const PLANO_INICIAL = {
  aberto: false, tab: 'gerado', num: '3', primeira: '', mensal: true, intervalo: '30',
  linhas: [{ valor: '', data: '' }, { valor: '', data: '' }],
};

export default function DividaDetailPage() {
  useLang();
  const { id } = useParams();

  // Contrato de carregamento da página (as definições singleton acompanham
  // todas as páginas; aqui nenhuma chave é usada diretamente).
  useDefinicoes();

  const clientes = useClientes();
  const overlays = useColecao('clientes_cobranca');
  const perfis = useColecao('perfis');

  const [divida, setDivida] = useState(null);
  const [pagamentos, setPagamentos] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aGravar, setAGravar] = useState(false);

  const [mPag, setMPag] = useState(PAG_INICIAL);
  const [mProm, setMProm] = useState(PROM_INICIAL);
  const [mEst, setMEst] = useState(EST_INICIAL);
  const [mPlano, setMPlano] = useState(PLANO_INICIAL);
  const [confRemoverJuros, setConfRemoverJuros] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, pags, evts, avs] = await Promise.all([
        obter('dividas', id).catch(() => null),
        listar('pagamentos'),
        listar('linha_tempo'),
        listar('sync_avisos'),
      ]);
      setDivida(d || null);
      setPagamentos((pags || []).filter((p) => p.dividaId === id));
      setEventos((evts || []).filter((e) => e.dividaId === id));
      setAvisos((avs || []).filter((a) => a.dividaId === id && a.estado === 'aberto'));
    } catch {
      toast(tr('Falha ao carregar a dívida.', 'Failed to load the debt.'), { tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);

  /* ------------------------------ derivados ------------------------------ */

  const cliente = useMemo(
    () => (divida ? (clientes.items || []).find((c) => c.id === divida.clienteId) || null : null),
    [clientes.items, divida],
  );
  const overlayMap = useMemo(() => indexarOverlay(overlays.items), [overlays.items]);
  const perfil = useMemo(
    () => (divida ? resolverPerfil(overlayMap, perfis.items || [], divida.clienteId) : null),
    [overlayMap, perfis.items, divida],
  );

  const pago = useMemo(() => round2(somaEuros(pagamentos.map((p) => p.valor))), [pagamentos]);
  const saldo = divida ? round2(Number(divida.valor || 0) - pago) : 0;
  const temPlano = !!(divida && Array.isArray(divida.prestacoes) && divida.prestacoes.length > 0);

  const pagoPorPrestacao = useMemo(() => {
    const m = new Map();
    for (const p of pagamentos) {
      if (!p.prestacaoId) continue;
      m.set(p.prestacaoId, round2((m.get(p.prestacaoId) || 0) + Number(p.valor || 0)));
    }
    return m;
  }, [pagamentos]);

  const restanteDe = useCallback((prestacaoId) => {
    if (!divida) return 0;
    if (!prestacaoId) return saldo;
    const p = (divida.prestacoes || []).find((x) => x.id === prestacaoId);
    if (!p) return saldo;
    return round2(Number(p.valor || 0) - (pagoPorPrestacao.get(prestacaoId) || 0));
  }, [divida, saldo, pagoPorPrestacao]);

  const jurosAtivos = !!(perfil && perfil.juros && perfil.juros.ativo);
  const custoFixo = perfil && perfil.juros && perfil.juros.custoFixoRecuperacao != null
    ? round2(Number(perfil.juros.custoFixoRecuperacao))
    : CUSTO_RECUPERACAO_EUR;

  const jurosCalc = useMemo(() => {
    if (!divida || !jurosAtivos || !(saldo > 0)) return null;
    try {
      return computeJuros({
        valor: saldo,
        dataVencimento: divida.dataVencimento,
        dataFim: hojeISO(),
        tipo: (perfil.juros && perfil.juros.tipo) || 'comercial',
        tabela: TABELA_TAXAS,
      });
    } catch {
      return null; // por vencer, data inválida ou capital fora de precisão
    }
  }, [divida, jurosAtivos, saldo, perfil]);

  const planoGerado = useMemo(() => {
    if (!mPlano.aberto || mPlano.tab !== 'gerado' || !divida) return null;
    try {
      return {
        plano: gerarPlano({
          valorTotal: divida.valor,
          numPrestacoes: Number(mPlano.num),
          primeiraData: mPlano.primeira,
          intervaloDias: mPlano.mensal ? null : (Number(mPlano.intervalo) || 30),
          mensal: mPlano.mensal,
        }),
      };
    } catch (err) {
      return { erro: err instanceof Error ? err.message : String(err) };
    }
  }, [mPlano, divida]);

  const errosPersonalizado = useMemo(() => {
    if (!mPlano.aberto || mPlano.tab !== 'personalizado' || !divida) return [];
    const parsed = mPlano.linhas.map((l) => ({ valor: parseMontante(l.valor), dataVencimento: l.data }));
    return validarPlanoPersonalizado(parsed, divida.valor);
  }, [mPlano, divida]);

  /* ------------------------------- ações --------------------------------- */

  const abrirPagamento = (prestacaoId = '') => {
    const restante = restanteDe(prestacaoId || null);
    setMPag({
      aberto: true,
      prestacaoId,
      valor: restante > 0 ? restante.toFixed(2) : '',
      data: hojeISO(),
      metodo: 'transferencia',
      notas: '',
    });
  };

  const guardarPagamento = async () => {
    if (!divida) return;
    const v = parseMontante(mPag.valor);
    if (v == null || v <= 0) {
      toast(tr('Indique um valor válido.', 'Enter a valid amount.'), { tone: 'error' });
      return;
    }
    if (!mPag.data) {
      toast(tr('Indique a data do pagamento.', 'Enter the payment date.'), { tone: 'error' });
      return;
    }
    setAGravar(true);
    try {
      const prestacaoId = mPag.prestacaoId || null;
      await criar('pagamentos', {
        clienteId: divida.clienteId,
        dividaId: divida.id,
        prestacaoId,
        valor: v,
        data: mPag.data,
        metodo: mPag.metodo,
        notas: mPag.notas.trim() || null,
      });

      // Recalcula estados com o pagamento acabado de registar incluído.
      const todos = [...pagamentos, { dividaId: divida.id, prestacaoId, valor: v }];
      let patch;
      if (temPlano) {
        const somaDe = (pid) => round2(
          todos.filter((p) => (p.prestacaoId || null) === pid).reduce((s, p) => s + Number(p.valor || 0), 0),
        );
        const novasPrestacoes = divida.prestacoes.map((p) => {
          const pagoP = somaDe(p.id);
          if (pagoP >= Number(p.valor || 0) - 0.01) return { ...p, estado: 'paga' };
          if (pagoP > 0) return { ...p, estado: 'parcial' };
          return p;
        });
        const todasPagas = novasPrestacoes.every((p) => p.estado === 'paga');
        let novoEstado = divida.estado;
        if (todasPagas) novoEstado = 'paga';
        else if (!cobrancaSuspensa(divida.estado) && divida.estado !== 'promessa') {
          novoEstado = novasPrestacoes.some((p) => p.estado === 'paga' || p.estado === 'parcial') ? 'parcial' : 'aberta';
        }
        patch = { prestacoes: novasPrestacoes, estado: novoEstado };
      } else {
        patch = { estado: estadoDerivado(divida, todos) };
      }
      await atualizar('dividas', divida.id, patch);
      await registarEvento({
        clienteId: divida.clienteId,
        dividaId: divida.id,
        prestacaoId,
        tipo: 'pagamento',
        titulo: tr('Pagamento registado', 'Payment recorded'),
        detalhe: `${eur(v)} · ${formatData(mPag.data)} · ${rotuloMetodo(mPag.metodo)}`,
      });
      toast(tr('Pagamento registado.', 'Payment recorded.'), { tone: 'ok' });
      setMPag(PAG_INICIAL);
      await carregar();
    } catch {
      toast(tr('Falha ao registar o pagamento.', 'Failed to record the payment.'), { tone: 'error' });
    } finally {
      setAGravar(false);
    }
  };

  const abrirPromessa = (prestacaoId = '') => {
    setMProm({ aberto: true, prestacaoId, data: addDias(hojeISO(), 7) || '' });
  };

  const guardarPromessa = async () => {
    if (!divida) return;
    if (!mProm.data) {
      toast(tr('Indique a data prometida.', 'Enter the promised date.'), { tone: 'error' });
      return;
    }
    setAGravar(true);
    try {
      const prestacaoId = mProm.prestacaoId || null;
      if (temPlano && prestacaoId) {
        const novas = divida.prestacoes.map((p) => (
          p.id === prestacaoId ? { ...p, promessaData: mProm.data, estado: 'promessa' } : p
        ));
        await atualizar('dividas', divida.id, { prestacoes: novas });
      } else {
        await atualizar('dividas', divida.id, { promessaData: mProm.data, estado: 'promessa' });
      }
      await registarEvento({
        clienteId: divida.clienteId,
        dividaId: divida.id,
        prestacaoId,
        tipo: 'promessa',
        titulo: tr('Promessa de pagamento', 'Promise to pay'),
        detalhe: tr(`Pagamento prometido até ${formatData(mProm.data)}`, `Payment promised by ${formatData(mProm.data)}`),
      });
      toast(tr('Promessa registada.', 'Promise recorded.'), { tone: 'ok' });
      setMProm(PROM_INICIAL);
      await carregar();
    } catch {
      toast(tr('Falha ao registar a promessa.', 'Failed to record the promise.'), { tone: 'error' });
    } finally {
      setAGravar(false);
    }
  };

  const guardarEstado = async () => {
    if (!divida || !mEst.estado) {
      toast(tr('Escolha o novo estado.', 'Choose the new status.'), { tone: 'error' });
      return;
    }
    setAGravar(true);
    try {
      const anterior = divida.estado;
      await atualizar('dividas', divida.id, { estado: mEst.estado });
      await registarEvento({
        clienteId: divida.clienteId,
        dividaId: divida.id,
        tipo: 'estado',
        titulo: tr('Estado alterado', 'Status changed'),
        detalhe: `${rotuloEstado(anterior)} → ${rotuloEstado(mEst.estado)}`,
      });
      toast(tr('Estado atualizado.', 'Status updated.'), { tone: 'ok' });
      setMEst(EST_INICIAL);
      await carregar();
    } catch {
      toast(tr('Falha ao alterar o estado.', 'Failed to change the status.'), { tone: 'error' });
    } finally {
      setAGravar(false);
    }
  };

  const guardarPlano = async () => {
    if (!divida) return;
    let plano;
    if (mPlano.tab === 'gerado') {
      if (!planoGerado || planoGerado.erro || !planoGerado.plano) {
        toast((planoGerado && planoGerado.erro) || tr('Plano inválido.', 'Invalid plan.'), { tone: 'error' });
        return;
      }
      plano = planoGerado.plano;
    } else {
      if (errosPersonalizado.length) {
        toast(errosPersonalizado[0], { tone: 'error' });
        return;
      }
      plano = mPlano.linhas.map((l, i) => ({
        id: `p${i + 1}`,
        valor: parseMontante(l.valor),
        dataVencimento: l.data,
        estado: 'aberta',
      }));
    }
    setAGravar(true);
    try {
      await atualizar('dividas', divida.id, { prestacoes: plano });
      await registarEvento({
        clienteId: divida.clienteId,
        dividaId: divida.id,
        tipo: 'estado',
        titulo: tr('Plano de prestações criado', 'Instalment plan created'),
        detalhe: tr(
          `${plano.length} prestações, total ${eur(divida.valor)}`,
          `${plano.length} instalments, total ${eur(divida.valor)}`,
        ),
      });
      toast(tr('Plano de prestações criado.', 'Instalment plan created.'), { tone: 'ok' });
      setMPlano(PLANO_INICIAL);
      await carregar();
    } catch {
      toast(tr('Falha ao guardar o plano.', 'Failed to save the plan.'), { tone: 'error' });
    } finally {
      setAGravar(false);
    }
  };

  const aplicarJuros = async () => {
    if (!divida || !jurosCalc) return;
    setAGravar(true);
    try {
      const passos = (jurosCalc.showWork && jurosCalc.showWork.passos) || [];
      await atualizar('dividas', divida.id, {
        jurosAplicados: {
          valor: jurosCalc.totalJuros,
          custoFixo,
          ate: hojeISO(),
          aplicadoEm: new Date().toISOString(),
          passos,
        },
      });
      await registarEvento({
        clienteId: divida.clienteId,
        dividaId: divida.id,
        tipo: 'juros',
        titulo: tr('Juros aplicados', 'Interest applied'),
        detalhe: tr(
          `Juros de mora ${eur(jurosCalc.totalJuros)} + custo fixo ${eur(custoFixo)} (até ${formatData(hojeISO())})`,
          `Default interest ${eur(jurosCalc.totalJuros)} + fixed cost ${eur(custoFixo)} (up to ${formatData(hojeISO())})`,
        ),
        conteudo: passos.join('\n'),
      });
      toast(tr('Juros adicionados à dívida.', 'Interest added to the debt.'), { tone: 'ok' });
      await carregar();
    } catch {
      toast(tr('Falha ao aplicar juros.', 'Failed to apply interest.'), { tone: 'error' });
    } finally {
      setAGravar(false);
    }
  };

  const removerJuros = async () => {
    if (!divida || !divida.jurosAplicados) return;
    setAGravar(true);
    try {
      const ja = divida.jurosAplicados;
      await atualizar('dividas', divida.id, { jurosAplicados: null });
      await registarEvento({
        clienteId: divida.clienteId,
        dividaId: divida.id,
        tipo: 'juros',
        titulo: tr('Juros removidos', 'Interest removed'),
        detalhe: tr(
          `Removidos ${eur(ja.valor)} + ${eur(ja.custoFixo)} aplicados em ${formatData(ja.aplicadoEm)}`,
          `Removed ${eur(ja.valor)} + ${eur(ja.custoFixo)} applied on ${formatData(ja.aplicadoEm)}`,
        ),
      });
      toast(tr('Juros removidos da dívida.', 'Interest removed from the debt.'), { tone: 'ok' });
      setConfRemoverJuros(false);
      await carregar();
    } catch {
      toast(tr('Falha ao remover os juros.', 'Failed to remove interest.'), { tone: 'error' });
    } finally {
      setAGravar(false);
    }
  };

  /* ------------------------------- render -------------------------------- */

  if (loading) {
    return (
      <div className="cartao">
        <Skeleton lines={8} />
      </div>
    );
  }

  if (!divida) {
    return (
      <EmptyState
        icon={<IconDividas size={28} />}
        title={tr('Dívida não encontrada', 'Debt not found')}
        hint={tr('A dívida pode ter sido removida ou o endereço está incorreto.', 'The debt may have been removed or the address is wrong.')}
        action={(
          <Link to="/dividas" className="btn btn--secondary" data-testid="voltar-dividas">
            <IconVoltar size={16} />
            {tr('Voltar às dívidas', 'Back to debts')}
          </Link>
        )}
      />
    );
  }

  const vencida = estaVencida(divida);
  const podeCriarPlano = !temPlano && (divida.estado === 'aberta' || divida.estado === 'parcial');
  const ja = divida.jurosAplicados || null;
  const saldoComJuros = ja ? round2(saldo + Number(ja.valor || 0) + Number(ja.custoFixo || 0)) : null;
  const estadosAlvo = ['disputada', 'litigio', 'pausada', 'incobravel', 'aberta'].filter((e) => e !== divida.estado);

  const pagamentosOrdenados = [...pagamentos].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  return (
    <>
      <div className="linha-acoes no-print">
        <Link to="/dividas" className="btn btn--ghost" data-testid="voltar-dividas">
          <IconVoltar size={16} />
          {tr('Dívidas', 'Debts')}
        </Link>
      </div>

      {avisos.length > 0 ? (
        <section className="cartao cartao--aviso" data-testid="avisos-sync">
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <IconAviso size={20} />
            <div>
              <p style={{ fontWeight: 700 }}>{tr('Aviso de sincronização com o Honorários', 'Fees sync warning')}</p>
              {avisos.map((a) => (
                <p key={a.id} style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>
                  {a.tipo === 'removido'
                    ? tr('O documento de origem foi removido no Honorários.', 'The source document was removed in the Fees app.')
                    : tr('O documento de origem foi alterado no Honorários.', 'The source document was changed in the Fees app.')}
                  {a.detalhe ? ` ${a.detalhe}` : ''}
                </p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="cartao" data-testid="divida-cabecalho">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{divida.descricao || tr('Dívida', 'Debt')}</h2>
              <EstadoBadge estado={divida.estado} vencida={vencida} />
              {divida.origem === 'honorarios' ? (
                <Badge tone="info">{tr('Honorários', 'Fees')}</Badge>
              ) : divida.origem === 'fatura' ? (
                <Badge tone="info">{tr('Fatura digitalizada', 'Scanned invoice')}</Badge>
              ) : null}
            </div>
            <p style={{ marginTop: '0.375rem', color: 'var(--color-text-muted, #475569)', fontSize: '0.875rem' }}>
              {cliente ? (
                <Link to={`/clientes/${divida.clienteId}`} data-testid="link-cliente" style={{ color: 'var(--color-primary, #0F766E)', fontWeight: 600 }}>
                  {cliente.nome}
                </Link>
              ) : (
                <span>{tr('Cliente desconhecido', 'Unknown customer')}</span>
              )}
              {divida.numeroFatura ? ` · ${tr('Fatura', 'Invoice')} ${divida.numeroFatura}` : ''}
              {` · ${tr('Vencimento', 'Due date')}: ${formatData(divida.dataVencimento)}`}
              {divida.promessaData ? ` · ${tr('Promessa até', 'Promised by')} ${formatData(divida.promessaData)}` : ''}
            </p>
            {divida.origem === 'honorarios' ? (
              <p style={{ marginTop: '0.25rem', color: 'var(--color-text-subtle, #64748B)', fontSize: '0.8125rem' }} data-testid="origem-honorarios">
                {tr('Importada do Honorários', 'Imported from the Fees app')}
                {divida.origemId ? ` · ${tr('documento', 'document')} ${divida.origemId}` : ''}
                {divida.origemRunRef ? ` · ${tr('sincronização', 'sync run')} ${divida.origemRunRef}` : ''}
              </p>
            ) : null}
          </div>
          <div className="linha-acoes no-print">
            <Button data-testid="btn-registar-pagamento" data-demo-target="registar-pagamento" onClick={() => abrirPagamento('')}>
              <IconEuro size={16} />
              {tr('Registar pagamento', 'Record payment')}
            </Button>
            <Button variant="secondary" data-testid="btn-promessa" onClick={() => abrirPromessa('')}>
              <IconRelogio size={16} />
              {tr('Promessa de pagamento', 'Promise to pay')}
            </Button>
            <Button variant="secondary" data-testid="btn-alterar-estado" onClick={() => setMEst({ aberto: true, estado: '' })}>
              {tr('Alterar estado', 'Change status')}
            </Button>
            {podeCriarPlano ? (
              <Button variant="secondary" data-testid="btn-plano-prestacoes" onClick={() => setMPlano({ ...PLANO_INICIAL, aberto: true, primeira: addDias(hojeISO(), 30) || hojeISO() })}>
                {tr('Plano de prestações', 'Instalment plan')}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grelha-stats" style={{ marginTop: '1.25rem' }} data-demo-target="divida-resumo">
          <Stat label={tr('Valor da dívida', 'Debt amount')} value={eur(divida.valor)} />
          <Stat label={tr('Pago', 'Paid')} value={eur(pago)} tone={pago > 0 ? 'ok' : undefined} />
          <Stat
            label={tr('Saldo em dívida', 'Outstanding balance')}
            value={eur(saldo)}
            tone={saldo > 0 && vencida ? 'alerta' : undefined}
            sub={vencida ? tr('Vencida', 'Overdue') : undefined}
            demoTarget="saldo-divida"
          />
          {ja ? (
            <Stat
              label={tr('Saldo com juros', 'Balance with interest')}
              value={eur(saldoComJuros)}
              sub={tr(`Juros até ${formatData(ja.ate)}`, `Interest up to ${formatData(ja.ate)}`)}
            />
          ) : null}
        </div>
      </section>

      {temPlano ? (
        <section className="cartao" data-testid="cartao-prestacoes" data-demo-target="tabela-prestacoes">
          <h3 className="cartao__titulo">{tr('Plano de prestações', 'Instalment plan')}</h3>
          <DataTable
            columns={[
              { key: 'n', label: tr('N.º', 'No.'), render: (p) => numeroPrestacao(p.id) },
              { key: 'valor', label: tr('Valor', 'Amount'), alinhar: 'direita', render: (p) => eur(p.valor) },
              { key: 'pago', label: tr('Pago', 'Paid'), alinhar: 'direita', render: (p) => eur(pagoPorPrestacao.get(p.id) || 0) },
              { key: 'dataVencimento', label: tr('Vencimento', 'Due date'), render: (p) => formatData(p.dataVencimento) },
              { key: 'estado', label: tr('Estado', 'Status'), render: (p) => <EstadoBadge estado={p.estado} vencida={estaVencida(p)} /> },
              { key: 'promessa', label: tr('Promessa', 'Promise'), render: (p) => (p.promessaData ? formatData(p.promessaData) : '—') },
              {
                key: 'acoes',
                label: '',
                render: (p) => (p.estado === 'paga' ? null : (
                  <span className="linha-acoes no-print" style={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="secondary" data-testid={`btn-pagamento-${p.id}`} onClick={() => abrirPagamento(p.id)}>
                      {tr('Pagamento', 'Payment')}
                    </Button>
                    <Button size="sm" variant="ghost" data-testid={`btn-promessa-${p.id}`} onClick={() => abrirPromessa(p.id)}>
                      {tr('Promessa', 'Promise')}
                    </Button>
                  </span>
                )),
              },
            ]}
            rows={divida.prestacoes}
            rowKey={(p) => p.id}
          />
        </section>
      ) : null}

      {jurosAtivos || ja ? (
        <section className="cartao" data-testid="cartao-juros" data-demo-target="cartao-juros">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <IconBalanca size={18} />
            <h3 className="cartao__titulo" style={{ marginBottom: 0 }}>{tr('Juros de mora', 'Default interest')}</h3>
            {jurosCalc && jurosCalc.incompleto ? <Badge tone="warn">{tr('a confirmar', 'to confirm')}</Badge> : null}
          </div>

          {ja ? (
            <div data-testid="juros-aplicados">
              <p style={{ fontSize: '0.9375rem' }}>
                {tr('Juros aplicados à dívida', 'Interest applied to the debt')}
                {': '}
                <strong>{eur(ja.valor)}</strong>
                {' + '}
                {tr('custo fixo', 'fixed cost')}
                {' '}
                <strong>{eur(ja.custoFixo)}</strong>
                {' '}
                {tr(`até ${formatData(ja.ate)}`, `up to ${formatData(ja.ate)}`)}
                {' · '}
                {tr(`aplicados em ${formatDataHora(ja.aplicadoEm)}`, `applied on ${formatDataHora(ja.aplicadoEm)}`)}
              </p>
              <p style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: 'var(--color-text-muted, #475569)' }}>
                {tr('Saldo com juros', 'Balance with interest')}: <strong>{eur(saldoComJuros)}</strong>
              </p>
              {Array.isArray(ja.passos) && ja.passos.length ? (
                <details style={{ marginTop: '0.75rem' }} data-testid="juros-passos-aplicados">
                  <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
                    {tr('Memória de cálculo', 'Calculation steps')}
                  </summary>
                  <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8125rem', color: 'var(--color-text-muted, #475569)' }}>
                    {ja.passos.map((p, i) => <li key={i}>{p}</li>)}
                  </ol>
                </details>
              ) : null}
              <div className="linha-acoes no-print" style={{ marginTop: '1rem' }}>
                <Button variant="danger" size="sm" data-testid="btn-remover-juros" onClick={() => setConfRemoverJuros(true)}>
                  {tr('Remover juros', 'Remove interest')}
                </Button>
              </div>
            </div>
          ) : jurosCalc ? (
            <div data-testid="juros-sugestao">
              <p style={{ fontSize: '0.9375rem' }}>
                {tr('Juros de mora vencidos', 'Accrued default interest')}
                {': '}
                <strong>{eur(jurosCalc.totalJuros)}</strong>
                {' '}
                {tr(`(${jurosCalc.diasTotais} dias, até ${formatData(jurosCalc.dataFim)})`, `(${jurosCalc.diasTotais} days, up to ${formatData(jurosCalc.dataFim)})`)}
              </p>
              <p style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>
                {tr('Custo fixo de recuperação', 'Fixed recovery cost')}: <strong>{eur(custoFixo)}</strong>
              </p>
              <p style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--color-text-subtle, #64748B)' }}>
                {CUSTO_RECUPERACAO_BASE}
              </p>
              <details style={{ marginTop: '0.75rem' }} data-testid="juros-passos">
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
                  {tr('Memória de cálculo', 'Calculation steps')}
                </summary>
                <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8125rem', color: 'var(--color-text-muted, #475569)' }}>
                  {jurosCalc.showWork.passos.map((p, i) => <li key={i}>{p}</li>)}
                </ol>
              </details>
              <div className="linha-acoes no-print" style={{ marginTop: '1rem', alignItems: 'center' }}>
                <Button data-testid="btn-aplicar-juros" data-demo-target="aplicar-juros" onClick={aplicarJuros} disabled={aGravar}>
                  {tr('Adicionar juros à dívida', 'Add interest to the debt')}
                </Button>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle, #64748B)' }}>
                  {tr('Sugestão — só é adicionada por ação sua.', 'Suggestion — only added by your explicit action.')}
                </span>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted, #475569)' }}>
              {tr('Sem juros de mora a sugerir neste momento.', 'No default interest to suggest right now.')}
            </p>
          )}
        </section>
      ) : null}

      <section className="cartao" data-testid="cartao-pagamentos">
        <h3 className="cartao__titulo">{tr('Pagamentos', 'Payments')}</h3>
        <DataTable
          columns={[
            { key: 'data', label: tr('Data', 'Date'), render: (p) => formatData(p.data) },
            { key: 'valor', label: tr('Valor', 'Amount'), alinhar: 'direita', render: (p) => eur(p.valor) },
            { key: 'metodo', label: tr('Método', 'Method'), render: (p) => rotuloMetodo(p.metodo) },
            {
              key: 'prestacao',
              label: tr('Aplicado a', 'Applied to'),
              render: (p) => (p.prestacaoId
                ? tr(`Prestação ${numeroPrestacao(p.prestacaoId)}`, `Instalment ${numeroPrestacao(p.prestacaoId)}`)
                : tr('Dívida inteira', 'Whole debt')),
            },
            { key: 'notas', label: tr('Notas', 'Notes'), render: (p) => p.notas || '—' },
          ]}
          rows={pagamentosOrdenados}
          empty={(
            <EmptyState
              icon={<IconEuro size={24} />}
              title={tr('Sem pagamentos registados', 'No payments recorded')}
              hint={tr('Quando registar um pagamento, fica listado aqui.', 'Once you record a payment it will be listed here.')}
            />
          )}
        />
      </section>

      <section className="cartao" data-testid="cartao-linha-tempo">
        <h3 className="cartao__titulo">{tr('Linha do tempo', 'Timeline')}</h3>
        <LinhaTempo
          eventos={eventos}
          vazio={(
            <EmptyState
              icon={<IconRelogio size={24} />}
              title={tr('Ainda sem eventos', 'No events yet')}
              hint={tr('Todas as ações sobre esta dívida ficam registadas aqui, de forma imutável.', 'Every action on this debt is recorded here, immutably.')}
            />
          )}
        />
      </section>

      {/* ------------------------- modal: pagamento ------------------------- */}
      <Modal
        open={mPag.aberto}
        title={tr('Registar pagamento', 'Record payment')}
        onClose={() => setMPag(PAG_INICIAL)}
        actions={(
          <>
            <Button variant="ghost" onClick={() => setMPag(PAG_INICIAL)}>{tr('Cancelar', 'Cancel')}</Button>
            <Button data-testid="btn-guardar-pagamento" onClick={guardarPagamento} disabled={aGravar}>
              {tr('Guardar pagamento', 'Save payment')}
            </Button>
          </>
        )}
      >
        <div className="form-grelha">
          <Field label={tr('Valor', 'Amount')} required>
            <Input
              data-testid="input-valor-pagamento"
              value={mPag.valor}
              onChange={(e) => setMPag({ ...mPag, valor: e.target.value })}
              placeholder={tr('0,00', '0.00')}
              inputMode="decimal"
            />
          </Field>
          <Field label={tr('Data', 'Date')} required>
            <Input
              type="date"
              data-testid="input-data-pagamento"
              value={mPag.data}
              onChange={(e) => setMPag({ ...mPag, data: e.target.value })}
            />
          </Field>
          <Field label={tr('Método', 'Method')}>
            <Select
              data-testid="select-metodo-pagamento"
              value={mPag.metodo}
              onChange={(e) => setMPag({ ...mPag, metodo: e.target.value })}
            >
              {METODOS.map((m) => <option key={m.id} value={m.id}>{tr(m.pt, m.en)}</option>)}
            </Select>
          </Field>
          {temPlano ? (
            <Field label={tr('Aplicar a', 'Apply to')}>
              <Select
                data-testid="select-prestacao-pagamento"
                value={mPag.prestacaoId}
                onChange={(e) => {
                  const pid = e.target.value;
                  const restante = restanteDe(pid || null);
                  setMPag({ ...mPag, prestacaoId: pid, valor: restante > 0 ? restante.toFixed(2) : mPag.valor });
                }}
              >
                <option value="">{tr('Dívida inteira', 'Whole debt')}</option>
                {divida.prestacoes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {tr(
                      `Prestação ${numeroPrestacao(p.id)} · ${eur(p.valor)} · ${formatData(p.dataVencimento)}`,
                      `Instalment ${numeroPrestacao(p.id)} · ${eur(p.valor)} · ${formatData(p.dataVencimento)}`,
                    )}
                    {p.estado === 'paga' ? ` (${rotuloEstado('paga')})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        <div style={{ marginTop: '1rem' }}>
          <Field label={tr('Notas', 'Notes')}>
            <Textarea
              rows={2}
              data-testid="input-notas-pagamento"
              value={mPag.notas}
              onChange={(e) => setMPag({ ...mPag, notas: e.target.value })}
              placeholder={tr('Referência da transferência, observações…', 'Transfer reference, remarks…')}
            />
          </Field>
        </div>
      </Modal>

      {/* ------------------------- modal: promessa -------------------------- */}
      <Modal
        open={mProm.aberto}
        title={tr('Promessa de pagamento', 'Promise to pay')}
        onClose={() => setMProm(PROM_INICIAL)}
        actions={(
          <>
            <Button variant="ghost" onClick={() => setMProm(PROM_INICIAL)}>{tr('Cancelar', 'Cancel')}</Button>
            <Button data-testid="btn-guardar-promessa" onClick={guardarPromessa} disabled={aGravar}>
              {tr('Registar promessa', 'Record promise')}
            </Button>
          </>
        )}
      >
        <div className="form-grelha">
          <Field
            label={tr('Pagamento prometido até', 'Payment promised by')}
            required
            hint={tr('Se a data passar sem pagamento, a quebra fica registada e pesa no comportamento do cliente.', 'If the date passes unpaid, the broken promise is recorded and affects the customer score.')}
          >
            <Input
              type="date"
              data-testid="input-data-promessa"
              value={mProm.data}
              onChange={(e) => setMProm({ ...mProm, data: e.target.value })}
            />
          </Field>
          {temPlano ? (
            <Field label={tr('Aplicar a', 'Apply to')}>
              <Select
                data-testid="select-prestacao-promessa"
                value={mProm.prestacaoId}
                onChange={(e) => setMProm({ ...mProm, prestacaoId: e.target.value })}
              >
                <option value="">{tr('Dívida inteira', 'Whole debt')}</option>
                {divida.prestacoes.filter((p) => p.estado !== 'paga').map((p) => (
                  <option key={p.id} value={p.id}>
                    {tr(
                      `Prestação ${numeroPrestacao(p.id)} · ${eur(p.valor)} · ${formatData(p.dataVencimento)}`,
                      `Instalment ${numeroPrestacao(p.id)} · ${eur(p.valor)} · ${formatData(p.dataVencimento)}`,
                    )}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </Modal>

      {/* ----------------------- modal: alterar estado ---------------------- */}
      <Modal
        open={mEst.aberto}
        title={tr('Alterar estado', 'Change status')}
        onClose={() => setMEst(EST_INICIAL)}
        actions={(
          <>
            <Button variant="ghost" onClick={() => setMEst(EST_INICIAL)}>{tr('Cancelar', 'Cancel')}</Button>
            <Button
              data-testid="btn-guardar-estado"
              variant={mEst.estado === 'litigio' ? 'danger' : 'primary'}
              onClick={guardarEstado}
              disabled={aGravar || !mEst.estado}
            >
              {tr('Alterar estado', 'Change status')}
            </Button>
          </>
        )}
      >
        <Field label={tr('Novo estado', 'New status')} required>
          <Select
            data-testid="select-novo-estado"
            value={mEst.estado}
            onChange={(e) => setMEst({ ...mEst, estado: e.target.value })}
          >
            <option value="">{tr('Escolher…', 'Choose…')}</option>
            {estadosAlvo.map((e) => (
              <option key={e} value={e}>
                {e === 'aberta' ? tr('Em aberto (reabrir)', 'Open (reopen)') : rotuloEstado(e)}
              </option>
            ))}
          </Select>
        </Field>
        {mEst.estado === 'litigio' ? (
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--color-danger, #DC2626)', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }} data-testid="aviso-litigio">
            <IconAviso size={16} />
            {tr('Passar a contencioso suspende toda a cobrança automática desta dívida.', 'Moving to litigation pauses all automated chasing for this debt.')}
          </p>
        ) : null}
      </Modal>

      {/* ------------------------ modal: plano prestações ------------------- */}
      <Modal
        open={mPlano.aberto}
        wide
        title={tr('Plano de prestações', 'Instalment plan')}
        onClose={() => setMPlano(PLANO_INICIAL)}
        actions={(
          <>
            <Button variant="ghost" onClick={() => setMPlano(PLANO_INICIAL)}>{tr('Cancelar', 'Cancel')}</Button>
            <Button data-testid="btn-guardar-plano" onClick={guardarPlano} disabled={aGravar}>
              {tr('Criar plano', 'Create plan')}
            </Button>
          </>
        )}
      >
        <p style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--color-text-muted, #475569)' }}>
          {tr(`Total da dívida: ${eur(divida.valor)}. A cobrança passa a funcionar por prestação.`, `Debt total: ${eur(divida.valor)}. Chasing then operates per instalment.`)}
        </p>
        <Tabs
          tabs={[
            { id: 'gerado', label: tr('Gerar automaticamente', 'Generate automatically') },
            { id: 'personalizado', label: tr('Personalizado', 'Custom') },
          ]}
          active={mPlano.tab}
          onChange={(t) => setMPlano({ ...mPlano, tab: t })}
        />

        {mPlano.tab === 'gerado' ? (
          <div style={{ marginTop: '1rem' }}>
            <div className="form-grelha">
              <Field label={tr('Número de prestações', 'Number of instalments')} required>
                <Input
                  type="number"
                  min={2}
                  data-testid="input-num-prestacoes"
                  value={mPlano.num}
                  onChange={(e) => setMPlano({ ...mPlano, num: e.target.value })}
                />
              </Field>
              <Field label={tr('Primeira prestação', 'First instalment')} required>
                <Input
                  type="date"
                  data-testid="input-primeira-data"
                  value={mPlano.primeira}
                  onChange={(e) => setMPlano({ ...mPlano, primeira: e.target.value })}
                />
              </Field>
              <Field label={tr('Periodicidade', 'Frequency')}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', minHeight: '2.25rem' }}>
                  <input
                    type="checkbox"
                    data-testid="check-mensal"
                    checked={mPlano.mensal}
                    onChange={(e) => setMPlano({ ...mPlano, mensal: e.target.checked })}
                  />
                  {tr('Mensal', 'Monthly')}
                </label>
              </Field>
              {!mPlano.mensal ? (
                <Field label={tr('Intervalo (dias)', 'Interval (days)')}>
                  <Input
                    type="number"
                    min={1}
                    data-testid="input-intervalo-dias"
                    value={mPlano.intervalo}
                    onChange={(e) => setMPlano({ ...mPlano, intervalo: e.target.value })}
                  />
                </Field>
              ) : null}
            </div>
            {planoGerado && planoGerado.erro ? (
              <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--color-danger, #DC2626)' }} data-testid="erro-plano-gerado">
                {planoGerado.erro}
              </p>
            ) : null}
            {planoGerado && planoGerado.plano ? (
              <div style={{ marginTop: '1rem' }} data-testid="preview-plano">
                <DataTable
                  columns={[
                    { key: 'n', label: tr('N.º', 'No.'), render: (p) => numeroPrestacao(p.id) },
                    { key: 'valor', label: tr('Valor', 'Amount'), alinhar: 'direita', render: (p) => eur(p.valor) },
                    { key: 'dataVencimento', label: tr('Vencimento', 'Due date'), render: (p) => formatData(p.dataVencimento) },
                  ]}
                  rows={planoGerado.plano}
                  rowKey={(p) => p.id}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ marginTop: '1rem' }}>
            {mPlano.linhas.map((l, i) => (
              <div key={i} className="linha-acoes" style={{ marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle, #64748B)', width: '2rem' }}>{i + 1}.</span>
                <Input
                  style={{ maxWidth: '10rem' }}
                  data-testid={`input-plano-valor-${i}`}
                  value={l.valor}
                  onChange={(e) => {
                    const linhas = mPlano.linhas.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x));
                    setMPlano({ ...mPlano, linhas });
                  }}
                  placeholder={tr('Valor (0,00)', 'Amount (0.00)')}
                  inputMode="decimal"
                />
                <Input
                  type="date"
                  style={{ maxWidth: '11rem' }}
                  data-testid={`input-plano-data-${i}`}
                  value={l.data}
                  onChange={(e) => {
                    const linhas = mPlano.linhas.map((x, j) => (j === i ? { ...x, data: e.target.value } : x));
                    setMPlano({ ...mPlano, linhas });
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={tr('Remover prestação', 'Remove instalment')}
                  data-testid={`btn-remover-linha-${i}`}
                  onClick={() => setMPlano({ ...mPlano, linhas: mPlano.linhas.filter((_, j) => j !== i) })}
                  disabled={mPlano.linhas.length <= 1}
                >
                  <IconFechar size={14} />
                </Button>
              </div>
            ))}
            <div className="linha-acoes" style={{ marginTop: '0.75rem' }}>
              <Button
                variant="secondary"
                size="sm"
                data-testid="btn-adicionar-linha"
                onClick={() => setMPlano({ ...mPlano, linhas: [...mPlano.linhas, { valor: '', data: '' }] })}
              >
                <IconMais size={14} />
                {tr('Adicionar prestação', 'Add instalment')}
              </Button>
              <span className="espacador" />
              <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted, #475569)' }}>
                {tr('Soma', 'Sum')}: {eur(round2(mPlano.linhas.reduce((s, l) => s + (parseMontante(l.valor) || 0), 0)))}
                {' / '}
                {eur(divida.valor)}
              </span>
            </div>
            {errosPersonalizado.length ? (
              <ul style={{ marginTop: '0.75rem', paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--color-danger, #DC2626)' }} data-testid="erros-plano-personalizado">
                {errosPersonalizado.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            ) : null}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confRemoverJuros}
        title={tr('Remover juros', 'Remove interest')}
        message={tr('Remover os juros aplicados a esta dívida? O saldo volta ao capital em dívida e a remoção fica registada na linha do tempo.', 'Remove the interest applied to this debt? The balance reverts to the outstanding principal and the removal is recorded in the timeline.')}
        confirmLabel={tr('Remover', 'Remove')}
        cancelLabel={tr('Cancelar', 'Cancel')}
        danger
        onConfirm={removerJuros}
        onCancel={() => setConfRemoverJuros(false)}
      />
    </>
  );
}
