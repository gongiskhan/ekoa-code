import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSharedCollection, formatEur, formatDate, appHref } from '../shared.js';
import { DataTable, EmptyState, Badge } from '../components/ui.jsx';
import { IconCoins, IconAlertTriangle, IconFolder } from '../components/Icons.jsx';
import { somaEuros, DISCLAIMER } from './honorarios-logic.js';

/* Aviso de conferência - sempre visível, no topo de cada ecrã do módulo. */
export function DisclaimerBanner() {
  return (
    <div className="citius-resultado is-review" data-testid="hon-disclaimer" role="note">
      <span className="citius-resultado-icon" aria-hidden="true"><IconAlertTriangle /></span>
      <span className="citius-resultado-text">
        <span className="citius-resultado-strong">{DISCLAIMER}</span>
        <span className="citius-resultado-meta">
          Este módulo soma lançamentos e prepara rascunhos internos. A emissão fiscal (fatura
          certificada, comunicação à AT) fica fora do seu âmbito.
        </span>
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const { items: lancamentos, loading } = useSharedCollection('lancamentos');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');

  const processoLabel = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.numeroProcesso || '(sem número)'));
    return (id) => map.get(id) || '—';
  }, [processos]);

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '';
  }, [clientes]);

  const processoCliente = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.clienteId));
    return (id) => map.get(id) || null;
  }, [processos]);

  const porFaturar = useMemo(
    () => lancamentos.filter((l) => l && l.faturado !== true),
    [lancamentos],
  );

  const totalPorFaturar = useMemo(
    () => somaEuros(porFaturar.map((l) => l.valor)),
    [porFaturar],
  );

  const honorariosPorFaturar = useMemo(
    () => somaEuros(porFaturar.filter((l) => l.tipo !== 'despesa').map((l) => l.valor)),
    [porFaturar],
  );

  const despesasPorFaturar = useMemo(
    () => somaEuros(porFaturar.filter((l) => l.tipo === 'despesa').map((l) => l.valor)),
    [porFaturar],
  );

  // Número TOTAL de processos com dívida (distintos) - não a lista truncada.
  const processosComDivida = useMemo(() => {
    const set = new Set();
    for (const l of porFaturar) if (l.processoId) set.add(l.processoId);
    return set.size;
  }, [porFaturar]);

  // Top processos por valor em dívida (por faturar), maiores primeiro.
  const topProcessos = useMemo(() => {
    const acc = new Map();
    for (const l of porFaturar) {
      if (!l.processoId) continue;
      const prev = acc.get(l.processoId) || { processoId: l.processoId, total: 0, n: 0 };
      prev.total = Math.round((prev.total + Number(l.valor || 0)) * 100) / 100;
      prev.n += 1;
      acc.set(l.processoId, prev);
    }
    return [...acc.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [porFaturar]);

  // Últimos lançamentos (por data, depois createdAt), mais recentes primeiro.
  const ultimos = useMemo(() => {
    const key = (l) => String(l.data || '') + String(l.createdAt || '');
    return [...lancamentos].sort((a, b) => key(b).localeCompare(key(a))).slice(0, 6);
  }, [lancamentos]);

  return (
    <div data-testid="honorarios-dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">Resumo de honorários</h1>
          <p className="page-subtitle">
            O que está por faturar, por processo, e os últimos lançamentos registados na espinha
            partilhada.
          </p>
        </div>
      </div>

      <DisclaimerBanner />

      <div className="kpi-grid" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <div className="kpi-card">
          <span className="kpi-label">Por faturar (total)</span>
          <span className="kpi-value is-accent" data-testid="kpi-por-faturar">{formatEur(totalPorFaturar)}</span>
          <span className="field-hint">{porFaturar.length} lançamento(s) por faturar</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Honorários por faturar</span>
          <span className="kpi-value" data-testid="kpi-honorarios">{formatEur(honorariosPorFaturar)}</span>
          <span className="field-hint">Base tributável (IVA + retenção)</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Despesas por faturar</span>
          <span className="kpi-value" data-testid="kpi-despesas">{formatEur(despesasPorFaturar)}</span>
          <span className="field-hint">Reembolso de passagem (sem IVA)</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Processos com dívida</span>
          <span className="kpi-value" data-testid="kpi-processos">{processosComDivida}</span>
          <span className="field-hint">Com lançamentos por faturar</span>
        </div>
      </div>

      <div className="prazos-layout" style={{ marginTop: 'var(--sp-7, 2rem)' }}>
        <section className="card" aria-label="Processos por faturar">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="card-title">Processos por faturar</h2>
            <Link className="stat-link" to="/pre-faturas">Emitir pré-fatura</Link>
          </div>
          {loading ? (
            <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar.</span></div>
          ) : topProcessos.length === 0 ? (
            <EmptyState icon={<IconCoins />} title="Nada por faturar" hint="Todos os lançamentos estão faturados." />
          ) : (
            <DataTable
              data-testid="hon-top-processos"
              columns={[
                { key: 'processo', label: 'Processo', render: (r) => (
                  <div className="stack stack-1">
                    <Link className="text-strong" to={`/pre-faturas?processo=${encodeURIComponent(r.processoId)}`}>
                      {processoLabel(r.processoId)}
                    </Link>
                    <span className="text-subtle text-xs">{clienteNome(processoCliente(r.processoId)) || ''}</span>
                  </div>
                ) },
                { key: 'n', label: 'Lançs.', align: 'right', render: (r) => r.n },
                { key: 'total', label: 'Por faturar', align: 'right', render: (r) => (
                  <span className="text-strong">{formatEur(r.total)}</span>
                ) },
              ]}
              rows={topProcessos}
              rowKey={(r) => r.processoId}
            />
          )}
        </section>

        <section className="card" aria-label="Últimos lançamentos">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="card-title">Últimos lançamentos</h2>
            <Link className="stat-link" to="/lancamentos">Ver todos</Link>
          </div>
          {loading ? (
            <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar.</span></div>
          ) : ultimos.length === 0 ? (
            <EmptyState icon={<IconFolder />} title="Sem lançamentos" hint="Registe o primeiro lançamento." />
          ) : (
            <ul className="passos-list" data-testid="hon-ultimos">
              {ultimos.map((l) => (
                <li key={l.id} className="passo-item">
                  <span className="passo-nota" style={{ flex: 1 }}>
                    <span className="text-strong">{l.descricao || '(sem descrição)'}</span>
                    <span className="text-subtle text-xs" style={{ display: 'block' }}>
                      {processoLabel(l.processoId)} · {formatDate(l.data)}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center' }}>
                    <Badge tone={l.tipo === 'despesa' ? 'neutral' : 'info'}>
                      {l.tipo === 'despesa' ? 'Despesa' : 'Honorário'}
                    </Badge>
                    <span className="passo-data" style={{ minWidth: 'auto' }}>{formatEur(l.valor)}</span>
                    {l.faturado ? <Badge tone="ok">Faturado</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
