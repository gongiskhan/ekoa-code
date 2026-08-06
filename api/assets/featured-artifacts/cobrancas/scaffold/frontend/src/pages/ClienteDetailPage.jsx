/*
 * Detalhe de CLIENTE - rota /clientes/:id (id da base comum partilhada).
 *
 * Junta a identidade (só leitura, espinha do espaço de trabalho) com a camada
 * de cobrança da app: overlay editável (perfil, idioma, sinalizadores, notas),
 * score de comportamento com sugestão de perfil (a app sugere, o utilizador
 * confirma - NUNCA muda sozinha), dívidas e pagamentos do cliente, extrato de
 * conta corrente imprimível e a linha do tempo imutável.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { tr, useLang } from '../i18n.js';
import { useClientes, useColecao, useDefinicoes } from '../hooks.js';
import { criar, atualizar, registarEvento, exportarPdf } from '../ekoa.js';
import {
  Button, Badge, DataTable, Field, Select, Textarea, EmptyState, Skeleton, Stat, toast,
} from '../components/ui.jsx';
import {
  EstadoBadge, estaVencida, formatData, eur, LinhaTempo, resolverPerfil, indexarOverlay,
} from '../components/dominio.jsx';
import {
  IconVoltar, IconClientes, IconDividas, IconEuro, IconImprimir, IconDescarregar, IconAviso, IconRelogio,
} from '../components/Icons.jsx';
import { calcularScore, sugerirPerfil, LIMIARES_OMISSAO } from '../engine/comportamento.mjs';
import { estadoDerivado } from '../engine/prestacoes.mjs';
import { round2 } from '../engine/dinheiro.mjs';
import { hojeISO } from '../engine/datas.mjs';

/* Rótulos PT canónicos dos sinalizadores - usados nos registos imutáveis da
 * linha do tempo (auditoria; ficam gravados no idioma do escritório). */
const FLAGS = [
  { chave: 'naoContactar', registo: 'Não contactar' },
  { chave: 'chasingPausado', registo: 'Cobrança pausada' },
  { chave: 'emLitigio', registo: 'Em contencioso' },
  { chave: 'insolvente', registo: 'Insolvente' },
];

const FORM_OMISSAO = {
  perfilId: '',
  idioma: 'pt',
  naoContactar: false,
  chasingPausado: false,
  emLitigio: false,
  insolvente: false,
  notas: '',
};

function rotuloFlag(chave) {
  switch (chave) {
    case 'naoContactar': return tr('Não contactar', 'Do not contact');
    case 'chasingPausado': return tr('Cobrança pausada', 'Chasing paused');
    case 'emLitigio': return tr('Em contencioso', 'In litigation');
    case 'insolvente': return tr('Insolvente', 'Insolvent');
    default: return chave;
  }
}

function nomeFicheiroExtrato(nome) {
  const base = String(nome || 'cliente')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `extrato-${base || 'cliente'}`;
}

export default function ClienteDetailPage() {
  useLang();
  const { id } = useParams();
  const navigate = useNavigate();

  const { items: clientes, loading: clientesLoading } = useClientes();
  const overlayCol = useColecao('clientes_cobranca');
  const dividasCol = useColecao('dividas');
  const pagamentosCol = useColecao('pagamentos');
  const tempoCol = useColecao('linha_tempo');
  const perfisCol = useColecao('perfis');
  const { definicoes } = useDefinicoes();

  const cliente = useMemo(
    () => (clientes || []).find((c) => c.id === id) || null,
    [clientes, id],
  );
  const overlayRow = useMemo(
    () => (overlayCol.items || []).find((o) => o.clienteId === id) || null,
    [overlayCol.items, id],
  );
  const dividas = useMemo(
    () => (dividasCol.items || []).filter((d) => d.clienteId === id),
    [dividasCol.items, id],
  );
  const pagamentos = useMemo(
    () => (pagamentosCol.items || []).filter((p) => p.clienteId === id),
    [pagamentosCol.items, id],
  );
  const eventos = useMemo(
    () => (tempoCol.items || []).filter((e) => e.clienteId === id),
    [tempoCol.items, id],
  );
  const perfis = perfisCol.items || [];

  /* -------------------------- formulário overlay ------------------------- */
  const [form, setForm] = useState(FORM_OMISSAO);
  const [aGuardar, setAGuardar] = useState(false);
  useEffect(() => {
    if (overlayCol.loading) return;
    if (overlayRow) {
      setForm({
        perfilId: overlayRow.perfilId || '',
        idioma: overlayRow.idioma === 'en' ? 'en' : 'pt',
        naoContactar: !!overlayRow.naoContactar,
        chasingPausado: !!overlayRow.chasingPausado,
        emLitigio: !!overlayRow.emLitigio,
        insolvente: !!overlayRow.insolvente,
        notas: overlayRow.notas || '',
      });
    } else {
      setForm(FORM_OMISSAO);
    }
    // Reinicializa apenas quando a linha persistida muda (não a cada tecla).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayCol.loading, overlayRow && overlayRow.id]);

  async function upsertOverlay(patch) {
    const dados = { clienteId: id, ...patch };
    if (overlayRow && overlayRow.id) return atualizar('clientes_cobranca', overlayRow.id, dados);
    return criar('clientes_cobranca', { ...FORM_OMISSAO, perfilId: null, notas: '', ...dados });
  }

  async function guardarCobranca() {
    setAGuardar(true);
    try {
      const base = overlayRow || { ...FORM_OMISSAO, perfilId: null };
      await upsertOverlay({
        perfilId: form.perfilId || null,
        idioma: form.idioma === 'en' ? 'en' : 'pt',
        naoContactar: !!form.naoContactar,
        chasingPausado: !!form.chasingPausado,
        emLitigio: !!form.emLitigio,
        insolvente: !!form.insolvente,
        notas: form.notas || '',
      });
      // Linha do tempo: um registo por sinalizador alterado + mudança de perfil.
      for (const f of FLAGS) {
        const antes = !!base[f.chave];
        const depois = !!form[f.chave];
        if (antes !== depois) {
          await registarEvento({
            clienteId: id,
            tipo: 'estado',
            titulo: `Sinalizador "${f.registo}" ${depois ? 'ativado' : 'desativado'}`,
          });
        }
      }
      const perfilAntes = base.perfilId || null;
      const perfilDepois = form.perfilId || null;
      if (perfilAntes !== perfilDepois) {
        const nomeDe = (pid) => (perfis.find((p) => p.id === pid) || {}).nome || '(nenhum)';
        await registarEvento({
          clienteId: id,
          tipo: 'estado',
          titulo: 'Perfil de cobrança alterado',
          detalhe: `De "${nomeDe(perfilAntes)}" para "${nomeDe(perfilDepois)}"`,
        });
      }
      toast(tr('Definições de cobrança guardadas.', 'Collection settings saved.'), { tone: 'ok' });
      await Promise.all([overlayCol.refresh(), tempoCol.refresh()]);
    } catch (err) {
      toast(tr('Falha ao guardar as definições de cobrança.', 'Failed to save collection settings.'), { tone: 'error' });
      console.error('[cobrancas] guardar overlay:', err);
    } finally {
      setAGuardar(false);
    }
  }

  /* ------------------------------- score --------------------------------- */
  const promessasQuebradas = useMemo(
    () => eventos.filter((e) => e.tipo === 'promessa-quebrada').length,
    [eventos],
  );
  const { score, inputs } = useMemo(
    () => calcularScore({ dividas, pagamentos, promessasQuebradas }),
    [dividas, pagamentos, promessasQuebradas],
  );
  const perfilAtual = useMemo(
    () => resolverPerfil(indexarOverlay(overlayRow ? [overlayRow] : []), perfis, id),
    [overlayRow, perfis, id],
  );
  const limiares = (definicoes && definicoes.scoreLimiares) || LIMIARES_OMISSAO;
  const sugestao = useMemo(() => sugerirPerfil({
    score,
    perfilAtualTom: perfilAtual ? perfilAtual.tom : undefined,
    limiares,
    temHistorico: inputs.itensLiquidados > 0 || inputs.promessasQuebradas > 0,
  }), [score, perfilAtual, limiares, inputs]);
  const [sugestaoIgnorada, setSugestaoIgnorada] = useState(false);

  async function aplicarSugestao() {
    if (!sugestao) return;
    const alvo = perfis.find((p) => p.tom === sugestao.perfilSugerido);
    if (!alvo) {
      toast(tr('Não existe nenhum perfil com o tom sugerido.', 'No profile with the suggested tone exists.'), { tone: 'error' });
      return;
    }
    try {
      await upsertOverlay({ perfilId: alvo.id });
      await registarEvento({
        clienteId: id,
        tipo: 'estado',
        titulo: 'Perfil de cobrança alterado (sugestão aplicada)',
        detalhe: `Novo perfil: "${alvo.nome}". ${sugestao.motivo}`,
      });
      setForm((f) => ({ ...f, perfilId: alvo.id }));
      toast(tr('Sugestão aplicada: perfil atualizado.', 'Suggestion applied: profile updated.'), { tone: 'ok' });
      await Promise.all([overlayCol.refresh(), tempoCol.refresh()]);
    } catch (err) {
      toast(tr('Falha ao aplicar a sugestão.', 'Failed to apply the suggestion.'), { tone: 'error' });
      console.error('[cobrancas] aplicar sugestão:', err);
    }
  }

  /* ------------------------------ tabelas -------------------------------- */
  const pagoPorDivida = useMemo(() => {
    const m = new Map();
    for (const p of pagamentos) {
      m.set(p.dividaId, round2((m.get(p.dividaId) || 0) + Number(p.valor || 0)));
    }
    return m;
  }, [pagamentos]);

  const dividasOrdenadas = useMemo(
    () => [...dividas].sort((a, b) => String(a.dataVencimento || '').localeCompare(String(b.dataVencimento || ''))),
    [dividas],
  );
  const pagamentosOrdenados = useMemo(
    () => [...pagamentos].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))),
    [pagamentos],
  );
  const dividaPorId = useMemo(() => new Map(dividas.map((d) => [d.id, d])), [dividas]);

  const colunasDividas = [
    {
      key: 'descricao',
      label: tr('Descrição', 'Description'),
      render: (d) => (
        <div>
          <div>{d.descricao || '—'}</div>
          {d.numeroFatura ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle, #64748B)' }}>
              {tr('Fatura', 'Invoice')} {d.numeroFatura}
            </div>
          ) : null}
        </div>
      ),
    },
    { key: 'vencimento', label: tr('Vencimento', 'Due date'), render: (d) => formatData(d.dataVencimento) },
    { key: 'valor', label: tr('Valor', 'Amount'), alinhar: 'direita', render: (d) => eur(d.valor) },
    {
      key: 'emDivida',
      label: tr('Em dívida', 'Outstanding'),
      alinhar: 'direita',
      render: (d) => eur(Math.max(0, round2(Number(d.valor || 0) - (pagoPorDivida.get(d.id) || 0)))),
    },
    {
      key: 'estado',
      label: tr('Estado', 'Status'),
      render: (d) => {
        const derivado = estadoDerivado(d, pagamentos);
        return <EstadoBadge estado={derivado} vencida={estaVencida({ estado: derivado, dataVencimento: d.dataVencimento })} />;
      },
    },
  ];

  const colunasPagamentos = [
    { key: 'data', label: tr('Data', 'Date'), render: (p) => formatData(p.data) },
    {
      key: 'divida',
      label: tr('Dívida', 'Debt'),
      render: (p) => {
        const d = dividaPorId.get(p.dividaId);
        return d ? (d.descricao || d.numeroFatura || p.dividaId) : '—';
      },
    },
    { key: 'metodo', label: tr('Método', 'Method'), render: (p) => p.metodo || '—' },
    { key: 'valor', label: tr('Valor', 'Amount'), alinhar: 'direita', render: (p) => eur(p.valor) },
  ];

  /* ----------------------- extrato de conta corrente ---------------------- */
  const [mostrarExtrato, setMostrarExtrato] = useState(false);
  const [aExportar, setAExportar] = useState(false);

  const linhasExtrato = useMemo(() => {
    const movimentos = [];
    for (const d of dividas) {
      movimentos.push({
        data: d.dataVencimento || '',
        ordem: 0,
        descricao: `${d.descricao || tr('Dívida', 'Debt')}${d.numeroFatura ? ` (${tr('fatura', 'invoice')} ${d.numeroFatura})` : ''}`,
        debito: Number(d.valor || 0),
        credito: 0,
      });
    }
    for (const p of pagamentos) {
      movimentos.push({
        data: p.data || '',
        ordem: 1,
        descricao: `${tr('Pagamento', 'Payment')}${p.metodo ? ` — ${p.metodo}` : ''}`,
        debito: 0,
        credito: Number(p.valor || 0),
      });
    }
    movimentos.sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.ordem - b.ordem);
    let saldo = 0;
    return movimentos.map((m, i) => {
      saldo = round2(saldo + m.debito - m.credito);
      return { ...m, saldo, chave: `${m.data}-${i}` };
    });
  }, [dividas, pagamentos]);

  const saldoFinal = linhasExtrato.length ? linhasExtrato[linhasExtrato.length - 1].saldo : 0;

  async function exportarExtratoPdf() {
    setAExportar(true);
    try {
      const r = await exportarPdf({ filename: nomeFicheiroExtrato(cliente && cliente.nome) });
      if (r.ok) toast(tr('PDF exportado.', 'PDF exported.'), { tone: 'ok' });
      else toast(r.erro || tr('Falha na exportação PDF.', 'PDF export failed.'), { tone: 'error' });
    } finally {
      setAExportar(false);
    }
  }

  /* ------------------------------ renderização ---------------------------- */
  const aCarregar = clientesLoading || overlayCol.loading || dividasCol.loading
    || pagamentosCol.loading || perfisCol.loading;

  if (aCarregar && !cliente) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4, 1rem)' }}>
        <div className="cartao"><Skeleton lines={4} /></div>
        <div className="cartao"><Skeleton lines={6} /></div>
        <div className="cartao"><Skeleton lines={4} /></div>
      </div>
    );
  }

  if (!cliente) {
    return (
      <EmptyState
        icon={<IconClientes size={32} />}
        title={tr('Cliente não encontrado.', 'Customer not found.')}
        hint={tr('O cliente pode ter sido removido da base comum do espaço de trabalho.', 'The customer may have been removed from the common workspace database.')}
        action={(
          <Button variant="secondary" data-testid="voltar-clientes" onClick={() => navigate('/clientes')}>
            <IconVoltar size={16} /> {tr('Voltar aos clientes', 'Back to customers')}
          </Button>
        )}
      />
    );
  }

  const tomScore = score >= limiares.sugerirSuave ? 'ok' : (score < limiares.sugerirAssertivo ? 'alerta' : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4, 1rem)' }}>
      <div className="linha-acoes no-print">
        <Button variant="ghost" size="sm" data-testid="voltar-clientes" onClick={() => navigate('/clientes')}>
          <IconVoltar size={16} /> {tr('Voltar aos clientes', 'Back to customers')}
        </Button>
        <span className="espacador" />
        <Button
          variant="secondary"
          data-testid="gerar-extrato"
          data-demo-target="gerar-extrato"
          onClick={() => setMostrarExtrato((v) => !v)}
        >
          {mostrarExtrato ? tr('Ocultar extrato', 'Hide statement') : tr('Gerar extrato', 'Generate statement')}
        </Button>
      </div>

      {/* 1) Identidade (só leitura - espinha partilhada) */}
      <section className="cartao no-print" data-testid="cartao-identidade">
        <h2 className="cartao__titulo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {cliente.nome}
          <Badge tone={cliente.tipo === 'empresa' ? 'info' : 'neutral'}>
            {cliente.tipo === 'empresa' ? tr('Empresa', 'Company') : tr('Particular', 'Individual')}
          </Badge>
        </h2>
        <div className="form-grelha">
          <Field label={tr('NIF', 'Tax ID')}><p>{cliente.nif || '—'}</p></Field>
          <Field label={tr('Email', 'Email')}><p>{cliente.email || '—'}</p></Field>
          <Field label={tr('Telefone', 'Phone')}><p>{cliente.telefone || '—'}</p></Field>
          <Field label={tr('Morada', 'Address')}>
            <p>{typeof cliente.morada === 'string' && cliente.morada ? cliente.morada : '—'}</p>
          </Field>
        </div>
        <p className="campo__dica" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
          {tr('Dados geridos na base comum do espaço de trabalho.', 'Managed in the common workspace database.')}
        </p>
      </section>

      {/* 2) Cobrança (overlay editável) */}
      <section className="cartao no-print" data-testid="cartao-cobranca">
        <h2 className="cartao__titulo">{tr('Cobrança', 'Collections')}</h2>
        <div className="form-grelha">
          <Field label={tr('Perfil de cobrança', 'Collection profile')}>
            <Select
              data-testid="perfil-select"
              value={form.perfilId}
              onChange={(e) => setForm((f) => ({ ...f, perfilId: e.target.value }))}
            >
              <option value="">{tr('Por omissão (primeiro perfil)', 'Default (first profile)')}</option>
              {perfis.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </Select>
          </Field>
          <Field
            label={tr('Idioma de comunicação', 'Communication language')}
            hint={tr('Determina os modelos usados nos emails e cartas.', 'Determines the templates used in emails and letters.')}
          >
            <Select
              data-testid="idioma-select"
              value={form.idioma}
              onChange={(e) => setForm((f) => ({ ...f, idioma: e.target.value }))}
            >
              <option value="pt">{tr('Português', 'Portuguese')}</option>
              <option value="en">{tr('Inglês', 'English')}</option>
            </Select>
          </Field>
        </div>
        <div className="form-grelha" style={{ marginTop: 'var(--space-4, 1rem)' }}>
          {FLAGS.map((f) => (
            <label
              key={f.chave}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm, 0.875rem)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                data-testid={`flag-${f.chave.replace(/([A-Z])/g, '-$1').toLowerCase()}`}
                checked={!!form[f.chave]}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.chave]: e.target.checked }))}
              />
              {rotuloFlag(f.chave)}
            </label>
          ))}
        </div>
        <div style={{ marginTop: 'var(--space-4, 1rem)' }}>
          <Field label={tr('Notas internas', 'Internal notes')}>
            <Textarea
              data-testid="notas-cobranca"
              value={form.notas}
              onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              placeholder={tr('Contexto de cobrança deste cliente (só visível ao escritório).', 'Collection context for this customer (office-only).')}
            />
          </Field>
        </div>
        <div className="linha-acoes" style={{ marginTop: 'var(--space-4, 1rem)' }}>
          <span className="espacador" />
          <Button
            data-testid="guardar-cobranca"
            data-demo-target="guardar-cobranca"
            onClick={guardarCobranca}
            disabled={aGuardar}
          >
            {aGuardar ? tr('A guardar…', 'Saving…') : tr('Guardar', 'Save')}
          </Button>
        </div>
      </section>

      {/* 3) Score de comportamento */}
      <section className="cartao no-print" data-testid="cartao-score" data-demo-target="score-cliente">
        <h2 className="cartao__titulo">{tr('Comportamento de pagamento', 'Payment behaviour')}</h2>
        <div className="grelha-stats">
          <Stat
            label={tr('Score', 'Score')}
            value={score}
            sub={tr('0 (fraco) a 100 (exemplar)', '0 (poor) to 100 (exemplary)')}
            tone={tomScore}
            demoTarget="score-valor"
          />
          <Stat label={tr('Média de dias de atraso', 'Average days late')} value={inputs.mediaDiasAtraso} />
          <Stat
            label={tr('Pagos dentro do prazo', 'Paid on time')}
            value={inputs.pctDentroPrazo == null ? '—' : `${inputs.pctDentroPrazo}%`}
            sub={inputs.pctDentroPrazo == null ? tr('Sem histórico de liquidação.', 'No settlement history.') : undefined}
          />
          <Stat label={tr('Itens liquidados', 'Settled items')} value={inputs.itensLiquidados} />
          <Stat
            label={tr('Promessas quebradas', 'Broken promises')}
            value={inputs.promessasQuebradas}
            tone={inputs.promessasQuebradas > 0 ? 'alerta' : undefined}
          />
          <Stat
            label={tr('Valor incobrável', 'Written-off amount')}
            value={eur(inputs.valorIncobravel)}
            tone={inputs.valorIncobravel > 0 ? 'alerta' : undefined}
          />
        </div>
        {sugestao && !sugestaoIgnorada ? (
          <div className="cartao cartao--aviso" style={{ marginTop: 'var(--space-4, 1rem)' }} data-testid="sugestao-perfil">
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <IconAviso size={16} />
              {sugestao.perfilSugerido === 'suave'
                ? tr('Sugestão: mudar para um perfil suave.', 'Suggestion: switch to a gentle profile.')
                : tr('Sugestão: mudar para um perfil assertivo.', 'Suggestion: switch to an assertive profile.')}
            </p>
            <p style={{ marginTop: 4, fontSize: 'var(--text-sm, 0.875rem)', color: 'var(--color-text-muted, #475569)' }}>
              {sugestao.motivo}
            </p>
            <div className="linha-acoes" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
              <Button size="sm" data-testid="aplicar-sugestao" onClick={aplicarSugestao}>
                {tr('Aplicar sugestão', 'Apply suggestion')}
              </Button>
              <Button size="sm" variant="ghost" data-testid="ignorar-sugestao" onClick={() => setSugestaoIgnorada(true)}>
                {tr('Ignorar', 'Dismiss')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {/* 4) Dívidas + pagamentos */}
      <section className="cartao no-print" data-testid="cartao-dividas">
        <h2 className="cartao__titulo">{tr('Dívidas', 'Debts')}</h2>
        {dividasCol.loading ? <Skeleton lines={3} /> : (
          <DataTable
            data-testid="tabela-dividas"
            data-demo-target="tabela-dividas"
            columns={colunasDividas}
            rows={dividasOrdenadas}
            onRowClick={(d) => navigate(`/dividas/${d.id}`)}
            empty={(
              <EmptyState
                icon={<IconDividas size={28} />}
                title={tr('Sem dívidas para este cliente.', 'No debts for this customer.')}
                hint={tr('As dívidas surgem aqui quando forem criadas ou sincronizadas do Honorários.', 'Debts appear here once created or synced from the Fees app.')}
              />
            )}
          />
        )}
      </section>

      <section className="cartao no-print" data-testid="cartao-pagamentos">
        <h2 className="cartao__titulo">{tr('Pagamentos', 'Payments')}</h2>
        {pagamentosCol.loading ? <Skeleton lines={3} /> : (
          <DataTable
            data-testid="tabela-pagamentos"
            columns={colunasPagamentos}
            rows={pagamentosOrdenados}
            empty={(
              <EmptyState
                icon={<IconEuro size={28} />}
                title={tr('Sem pagamentos registados.', 'No payments recorded.')}
                hint={tr('Os pagamentos registados nas dívidas ou na reconciliação bancária aparecem aqui.', 'Payments recorded on debts or via bank reconciliation appear here.')}
              />
            )}
          />
        )}
      </section>

      {/* 5) Extrato de conta corrente (imprimível) */}
      {mostrarExtrato ? (
        <section data-testid="seccao-extrato">
          <div className="linha-acoes no-print" style={{ marginBottom: 'var(--space-3, 0.75rem)' }}>
            <span className="espacador" />
            <Button variant="secondary" size="sm" data-testid="imprimir-extrato" onClick={() => window.print()}>
              <IconImprimir size={16} /> {tr('Imprimir', 'Print')}
            </Button>
            <Button variant="secondary" size="sm" data-testid="exportar-extrato-pdf" onClick={exportarExtratoPdf} disabled={aExportar}>
              <IconDescarregar size={16} /> {aExportar ? tr('A exportar…', 'Exporting…') : tr('PDF', 'PDF')}
            </Button>
          </div>
          <div className="documento" data-testid="extrato-documento" data-demo-target="extrato-documento">
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <p style={{ fontWeight: 700, fontSize: '1.1rem' }}>{tr('Extrato de conta corrente', 'Statement of account')}</p>
              <p>{tr('Escritório de advogados', 'Law office')}</p>
            </div>
            <p>
              <strong>{tr('Cliente', 'Customer')}:</strong> {cliente.nome}
              {cliente.nif ? ` · ${tr('NIF', 'Tax ID')} ${cliente.nif}` : ''}
            </p>
            {typeof cliente.morada === 'string' && cliente.morada ? <p>{cliente.morada}</p> : null}
            <p><strong>{tr('Data de emissão', 'Issue date')}:</strong> {formatData(hojeISO())}</p>
            {definicoes && definicoes.iban ? <p><strong>IBAN:</strong> {definicoes.iban}</p> : null}
            {linhasExtrato.length === 0 ? (
              <p style={{ marginTop: '1rem' }}>
                {tr('Sem movimentos registados para este cliente.', 'No movements recorded for this customer.')}
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #111', padding: '4px 6px' }}>{tr('Data', 'Date')}</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #111', padding: '4px 6px' }}>{tr('Descrição', 'Description')}</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #111', padding: '4px 6px' }}>{tr('Débito', 'Debit')}</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #111', padding: '4px 6px' }}>{tr('Crédito', 'Credit')}</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #111', padding: '4px 6px' }}>{tr('Saldo', 'Balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasExtrato.map((l) => (
                    <tr key={l.chave}>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', whiteSpace: 'nowrap' }}>{formatData(l.data)}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd' }}>{l.descricao}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', textAlign: 'right' }}>{l.debito ? eur(l.debito) : ''}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', textAlign: 'right' }}>{l.credito ? eur(l.credito) : ''}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #ddd', textAlign: 'right' }}>{eur(l.saldo)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} style={{ padding: '6px', textAlign: 'right', fontWeight: 700 }}>
                      {tr('Saldo final', 'Final balance')}
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700 }} data-testid="saldo-final">
                      {eur(saldoFinal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : null}

      {/* 6) Linha do tempo */}
      <section className="cartao no-print" data-testid="cartao-tempo">
        <h2 className="cartao__titulo">{tr('Linha do tempo', 'Timeline')}</h2>
        {tempoCol.loading ? <Skeleton lines={3} /> : (
          <LinhaTempo
            eventos={eventos}
            vazio={(
              <EmptyState
                icon={<IconRelogio size={28} />}
                title={tr('Ainda sem eventos.', 'No events yet.')}
                hint={tr('Cada ação de cobrança fica registada aqui de forma imutável.', 'Every collection action is recorded here immutably.')}
              />
            )}
          />
        )}
      </section>
    </div>
  );
}
