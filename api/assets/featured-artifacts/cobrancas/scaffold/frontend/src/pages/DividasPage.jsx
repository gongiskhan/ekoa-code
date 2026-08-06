/* Lista de dívidas: pesquisa, filtros, sincronização com o Honorários,
 * avisos de discrepância e exportação CSV das dívidas em aberto. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tr, useLang } from '../i18n.js';
import { useColecao, useClientes, useDefinicoes, useDebounced } from '../hooks.js';
import { listar, listarPartilhada, criar, atualizar, registarEvento, descarregarCsv } from '../ekoa.js';
import {
  Button, Badge, DataTable, Select, toast, EmptyState, Skeleton, SearchInput,
} from '../components/ui.jsx';
import {
  ESTADOS, rotuloEstado, EstadoBadge, estaVencida, formatData, eur, indexarClientes,
} from '../components/dominio.jsx';
import { IconDividas, IconSincronizar, IconDescarregar, IconMais, IconAviso, IconLigacao } from '../components/Icons.jsx';
import { round2 } from '../engine/dinheiro.mjs';
import { diasAtraso, hojeISO } from '../engine/datas.mjs';
import { sincronizarHonorarios } from '../engine/honorarios-mapper.mjs';

const ORIGENS = {
  manual: { pt: 'Manual', en: 'Manual', tone: 'neutral' },
  fatura: { pt: 'Fatura', en: 'Invoice', tone: 'info' },
  honorarios: { pt: 'Honorários', en: 'Fees', tone: 'accent' },
};

/** Normaliza texto para pesquisa (minúsculas, sem acentos). */
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function OrigemBadge({ origem }) {
  const o = ORIGENS[origem] || { pt: origem || '—', en: origem || '—', tone: 'neutral' };
  return <Badge tone={o.tone}>{tr(o.pt, o.en)}</Badge>;
}

export default function DividasPage() {
  useLang();
  const navigate = useNavigate();
  const { definicoes } = useDefinicoes();
  const { items: dividas, loading: aCarregarDividas, error: erroDividas, refresh: refreshDividas } = useColecao('dividas');
  const { items: pagamentos, loading: aCarregarPagamentos, refresh: refreshPagamentos } = useColecao('pagamentos');
  const { items: avisos, refresh: refreshAvisos } = useColecao('sync_avisos');
  const { items: clientes, loading: aCarregarClientes } = useClientes();

  const [pesquisa, setPesquisa] = useState('');
  const pesquisaDeb = useDebounced(pesquisa, 250);
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [filtroOrigem, setFiltroOrigem] = useState('todas');
  const [aSincronizar, setASincronizar] = useState(false);

  useEffect(() => {
    if (erroDividas) toast(tr('Não foi possível carregar as dívidas.', 'Could not load the debts.'), { tone: 'error' });
  }, [erroDividas]);

  const clientesById = useMemo(() => indexarClientes(clientes), [clientes]);
  const dividasById = useMemo(() => new Map((dividas || []).map((d) => [d.id, d])), [dividas]);

  const pagoPorDivida = useMemo(() => {
    const m = new Map();
    for (const p of pagamentos || []) {
      if (!p.dividaId) continue;
      m.set(p.dividaId, round2((m.get(p.dividaId) || 0) + (Number(p.valor) || 0)));
    }
    return m;
  }, [pagamentos]);

  const saldoDe = useCallback(
    (d) => round2((Number(d.valor) || 0) - (pagoPorDivida.get(d.id) || 0)),
    [pagoPorDivida],
  );

  const avisosAbertos = useMemo(
    () => (avisos || []).filter((a) => a.estado === 'aberto'),
    [avisos],
  );

  const linhas = useMemo(() => {
    const q = norm(pesquisaDeb);
    let lista = [...(dividas || [])];
    if (q) {
      lista = lista.filter((d) => {
        const nomeCliente = clientesById.get(d.clienteId)?.nome || '';
        return norm(d.descricao).includes(q) || norm(d.numeroFatura).includes(q) || norm(nomeCliente).includes(q);
      });
    }
    if (filtroEstado === 'vencidas') lista = lista.filter((d) => estaVencida(d));
    else if (filtroEstado !== 'todos') lista = lista.filter((d) => d.estado === filtroEstado);
    if (filtroOrigem !== 'todas') lista = lista.filter((d) => (d.origem || 'manual') === filtroOrigem);
    lista.sort((a, b) => String(a.dataVencimento || '9999-12-31').localeCompare(String(b.dataVencimento || '9999-12-31')));
    return lista;
  }, [dividas, pesquisaDeb, filtroEstado, filtroOrigem, clientesById]);

  /* ---- Sincronização com o Honorários (fluxo de aceitação) ---- */

  const executarSincronizacao = useCallback(async () => {
    setASincronizar(true);
    try {
      const documentos = await listarPartilhada('documentos');
      const dividasAtuais = await listar('dividas');
      const resultado = sincronizarHonorarios({
        documentos,
        dividas: dividasAtuais,
        prazoPagamentoDias: definicoes?.prazoPagamentoHonorarios ?? 30,
      });
      const { novas, avisos: novosAvisos, falhas } = resultado;

      for (const nova of novas) {
        const criada = await criar('dividas', nova);
        await registarEvento({
          clienteId: nova.clienteId ?? null,
          dividaId: criada.id,
          tipo: 'sync',
          titulo: tr('Dívida importada do Honorários', 'Debt imported from Fees'),
          detalhe: nova.descricao,
        });
      }

      const avisosAtuais = await listar('sync_avisos');
      for (const aviso of novosAvisos) {
        const jaExiste = avisosAtuais.some(
          (a) => a.estado === 'aberto'
            && a.dividaId === aviso.dividaId
            && a.documentoId === aviso.documentoId
            && a.tipo === aviso.tipo,
        );
        if (!jaExiste) await criar('sync_avisos', { ...aviso, estado: 'aberto' });
      }

      toast(
        tr(
          `Sincronização concluída: ${novas.length} novas, ${novosAvisos.length} avisos, ${falhas.length} falhas.`,
          `Sync complete: ${novas.length} new, ${novosAvisos.length} warnings, ${falhas.length} failures.`,
        ),
        { tone: falhas.length ? 'info' : 'ok' },
      );
      await Promise.all([refreshDividas(), refreshAvisos(), refreshPagamentos()]);
    } catch {
      toast(tr('Falha na sincronização com o Honorários.', 'Fees sync failed.'), { tone: 'error' });
    } finally {
      setASincronizar(false);
    }
  }, [definicoes, refreshDividas, refreshAvisos, refreshPagamentos]);

  // Intenção pendente vinda do assistente: 'sincronizar' pertence a esta página.
  const sincRef = useRef(executarSincronizacao);
  sincRef.current = executarSincronizacao;
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__cobrancasAcaoPendente === 'sincronizar') {
      window.__cobrancasAcaoPendente = null;
      sincRef.current();
    }
  }, []);

  /* ---- Avisos de sincronização ---- */

  async function resolverAviso(aviso) {
    try {
      await atualizar('sync_avisos', aviso.id, { estado: 'resolvido' });
      const divida = dividasById.get(aviso.dividaId);
      await registarEvento({
        clienteId: divida?.clienteId ?? null,
        dividaId: aviso.dividaId,
        tipo: 'sync',
        titulo: tr('Aviso de sincronização resolvido', 'Sync warning resolved'),
        detalhe: aviso.detalhe || '',
      });
      toast(tr('Aviso marcado como resolvido.', 'Warning marked as resolved.'), { tone: 'ok' });
      refreshAvisos();
    } catch {
      toast(tr('Não foi possível atualizar o aviso.', 'Could not update the warning.'), { tone: 'error' });
    }
  }

  /* ---- Exportação CSV (só dívidas em aberto) ---- */

  function exportarCsv() {
    const emAberto = (dividas || []).filter((d) => d.estado !== 'paga' && d.estado !== 'incobravel');
    if (!emAberto.length) {
      toast(tr('Sem dívidas em aberto para exportar.', 'No outstanding debts to export.'), { tone: 'info' });
      return;
    }
    const cabecalho = [
      tr('Cliente', 'Customer'),
      tr('Descrição', 'Description'),
      tr('Número de fatura', 'Invoice number'),
      tr('Valor', 'Amount'),
      tr('Saldo', 'Balance'),
      tr('Vencimento', 'Due date'),
      tr('Dias de atraso', 'Days overdue'),
      tr('Estado', 'Status'),
    ];
    const linhasCsv = emAberto.map((d) => {
      const atraso = estaVencida(d) ? diasAtraso(d.dataVencimento) : 0;
      return [
        clientesById.get(d.clienteId)?.nome || '—',
        d.descricao || '',
        d.numeroFatura || '',
        (Number(d.valor) || 0).toFixed(2),
        saldoDe(d).toFixed(2),
        d.dataVencimento || '',
        atraso,
        rotuloEstado(d.estado),
      ];
    });
    descarregarCsv(`dividas-em-aberto-${hojeISO()}.csv`, cabecalho, linhasCsv);
    toast(tr('CSV exportado.', 'CSV exported.'), { tone: 'ok' });
  }

  /* ---- Colunas da tabela ---- */

  const colunas = [
    {
      key: 'descricao',
      label: tr('Descrição', 'Description'),
      render: (d) => (
        <div>
          <div>{d.descricao || '—'}</div>
          {d.numeroFatura ? (
            <div style={{ fontSize: '0.8em', color: 'var(--color-text-muted, #475569)' }}>{d.numeroFatura}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'cliente',
      label: tr('Cliente', 'Customer'),
      render: (d) => clientesById.get(d.clienteId)?.nome || '—',
    },
    {
      key: 'valor',
      label: tr('Valor', 'Amount'),
      alinhar: 'direita',
      render: (d) => eur(d.valor),
    },
    {
      key: 'saldo',
      label: tr('Saldo', 'Balance'),
      alinhar: 'direita',
      render: (d) => eur(saldoDe(d)),
    },
    {
      key: 'dataVencimento',
      label: tr('Vencimento', 'Due date'),
      render: (d) => {
        const vencida = estaVencida(d);
        const atraso = vencida ? diasAtraso(d.dataVencimento) : 0;
        return (
          <div>
            <div>{formatData(d.dataVencimento)}</div>
            {vencida ? (
              <div style={{ fontSize: '0.8em', color: 'var(--color-danger, #DC2626)' }}>
                {atraso === 1
                  ? tr('1 dia de atraso', '1 day overdue')
                  : tr(`${atraso} dias de atraso`, `${atraso} days overdue`)}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'estado',
      label: tr('Estado', 'Status'),
      render: (d) => <EstadoBadge estado={d.estado} vencida={estaVencida(d)} />,
    },
    {
      key: 'origem',
      label: tr('Origem', 'Source'),
      render: (d) => <OrigemBadge origem={d.origem || 'manual'} />,
    },
  ];

  const aCarregar = aCarregarDividas || aCarregarPagamentos || aCarregarClientes;
  const semDividas = !aCarregar && !(dividas || []).length;
  const semResultados = !aCarregar && (dividas || []).length > 0 && !linhas.length;

  return (
    <div>
      {avisosAbertos.length > 0 && (
        <div className="cartao cartao--aviso" data-testid="avisos-sync" style={{ marginBottom: '1rem' }}>
          <div className="cartao__titulo" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <IconAviso size={18} />
            {tr('Avisos de sincronização com o Honorários', 'Fees sync warnings')}
          </div>
          <div data-demo-target="dividas-avisos">
            {avisosAbertos.map((aviso) => {
              const divida = dividasById.get(aviso.dividaId);
              return (
                <div
                  key={aviso.id}
                  className="linha-acoes"
                  style={{ alignItems: 'center', padding: '0.35rem 0' }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{aviso.detalhe || tr('Discrepância detetada.', 'Discrepancy detected.')}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`aviso-abrir-${aviso.id}`}
                    onClick={() => navigate(`/dividas/${aviso.dividaId}`)}
                  >
                    <IconLigacao size={14} />
                    {divida?.descricao || tr('Ver dívida', 'View debt')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid={`aviso-resolver-${aviso.id}`}
                    onClick={() => resolverAviso(aviso)}
                  >
                    {tr('Marcar como resolvido', 'Mark as resolved')}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="cartao">
        <div className="linha-acoes" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
          <SearchInput
            value={pesquisa}
            onChange={setPesquisa}
            placeholder={tr('Pesquisar por descrição, fatura ou cliente…', 'Search by description, invoice or customer…')}
            data-testid="pesquisa-dividas"
          />
          <Select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            data-testid="filtro-estado"
            aria-label={tr('Filtrar por estado', 'Filter by status')}
          >
            <option value="todos">{tr('Todos os estados', 'All statuses')}</option>
            <option value="vencidas">{tr('Vencidas', 'Overdue')}</option>
            {Object.keys(ESTADOS).map((chave) => (
              <option key={chave} value={chave}>{rotuloEstado(chave)}</option>
            ))}
          </Select>
          <Select
            value={filtroOrigem}
            onChange={(e) => setFiltroOrigem(e.target.value)}
            data-testid="filtro-origem"
            aria-label={tr('Filtrar por origem', 'Filter by source')}
          >
            <option value="todas">{tr('Todas as origens', 'All sources')}</option>
            {Object.keys(ORIGENS).map((chave) => (
              <option key={chave} value={chave}>{tr(ORIGENS[chave].pt, ORIGENS[chave].en)}</option>
            ))}
          </Select>
          <span className="espacador" />
          <Button
            variant="secondary"
            data-testid="btn-sincronizar"
            data-demo-target="dividas-sincronizar"
            disabled={aSincronizar}
            onClick={executarSincronizacao}
          >
            <IconSincronizar size={16} />
            {aSincronizar
              ? tr('A sincronizar…', 'Syncing…')
              : tr('Sincronizar Honorários', 'Sync Fees')}
          </Button>
          <Button variant="secondary" data-testid="btn-exportar-csv" onClick={exportarCsv}>
            <IconDescarregar size={16} />
            {tr('Exportar CSV', 'Export CSV')}
          </Button>
          <Button
            variant="primary"
            data-testid="btn-nova-divida"
            data-demo-target="dividas-nova"
            onClick={() => navigate('/nova')}
          >
            <IconMais size={16} />
            {tr('Nova dívida', 'New debt')}
          </Button>
        </div>

        {aCarregar ? (
          <Skeleton lines={6} />
        ) : (
          <DataTable
            columns={colunas}
            rows={linhas}
            rowKey={(d) => d.id}
            onRowClick={(d) => navigate(`/dividas/${d.id}`)}
            data-testid="tabela-dividas"
            data-demo-target="dividas-tabela"
            empty={
              semDividas ? (
                <EmptyState
                  icon={<IconDividas size={28} />}
                  title={tr('Ainda não há dívidas', 'No debts yet')}
                  hint={tr(
                    'Registe a primeira dívida manualmente ou sincronize as pré-faturas do Honorários.',
                    'Record the first debt manually or sync the Fees pre-invoices.',
                  )}
                  action={(
                    <Button variant="primary" data-testid="btn-nova-divida-vazio" onClick={() => navigate('/nova')}>
                      <IconMais size={16} />
                      {tr('Nova dívida', 'New debt')}
                    </Button>
                  )}
                />
              ) : (
                <EmptyState
                  icon={<IconDividas size={28} />}
                  title={tr('Sem resultados', 'No results')}
                  hint={tr(
                    'Nenhuma dívida corresponde aos filtros atuais. Ajuste a pesquisa ou os filtros.',
                    'No debt matches the current filters. Adjust the search or the filters.',
                  )}
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
