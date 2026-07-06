import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSharedCollection, formatEur, formatDate } from '../shared.js';
import { Badge, EmptyState, Skeleton } from '../components/ui.jsx';
import { IconReceipt } from '../components/Icons.jsx';
import { AGING_BUCKETS, computeAging, emAberto } from '../engine/cobrancas.mjs';
import {
  ESTADO_LABEL, ESTADO_TONE, METODO_LABEL,
  atrasoLabel, atrasoTone, ordenarCobrancas,
} from './cobrancas-logic.js';

// Testids estáveis por escalão (o id '61+' não é amigável para data-testid).
const BUCKET_TESTID = { '0-30': 'aging-0-30', '31-60': 'aging-31-60', '61+': 'aging-61-mais' };

export default function CobrancasPage() {
  const navigate = useNavigate();
  const { items: cobrancas, loading } = useSharedCollection('cobrancas');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: sequencias } = useSharedCollection('sequencias_lembrete');

  const hoje = new Date();

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '—';
  }, [clientes]);

  const sequenciaNome = useMemo(() => {
    const map = new Map();
    sequencias.forEach((s) => map.set(s.id, s.nome));
    return (id) => (id ? map.get(id) || '—' : '—');
  }, [sequencias]);

  const aging = useMemo(() => computeAging(cobrancas, hoje), [cobrancas, hoje]);
  const ordenadas = useMemo(() => ordenarCobrancas(cobrancas, hoje), [cobrancas, hoje]);

  const totalEmAberto = useMemo(
    () => AGING_BUCKETS.reduce((acc, b) => acc + (aging[b.id]?.total || 0), 0),
    [aging],
  );

  return (
    <div data-testid="cobrancas-page" data-demo-page="cobrancas/lista">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cobranças</h1>
          <p className="page-subtitle">
            A carteira por receber, envelhecida por escalões de atraso, com a sequência de lembretes
            e o método de pagamento de cada cobrança.
          </p>
        </div>
      </div>

      <div className="kpi-grid" data-demo-target="cobrancas-aging" data-testid="cobrancas-aging">
        {AGING_BUCKETS.map((b) => {
          const cell = aging[b.id] || { count: 0, total: 0 };
          const tid = BUCKET_TESTID[b.id];
          return (
            <div className="kpi-card" key={b.id} data-testid={tid}>
              <span className="kpi-label">{b.label} de atraso</span>
              <span className="kpi-value" data-testid={`${tid}-total`}>{formatEur(cell.total)}</span>
              <span className="field-hint">
                <span data-testid={`${tid}-count`}>{cell.count}</span>
                {' '}cobrança(s) em aberto
              </span>
            </div>
          );
        })}
      </div>

      <section className="card" aria-label="Carteira de cobranças" style={{ marginTop: 'var(--sp-7, 2rem)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="card-title">Carteira</h2>
          <span className="field-hint">Total em aberto: <strong>{formatEur(totalEmAberto)}</strong></span>
        </div>

        {loading ? (
          <Skeleton lines={6} />
        ) : ordenadas.length === 0 ? (
          <EmptyState
            icon={<IconReceipt />}
            title="Sem cobranças"
            hint="As cobranças vivem sobre a espinha partilhada do escritório."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="cobrancas-tabela">
              <thead>
                <tr>
                  <th>Cliente / Descrição</th>
                  <th className="numeric">Valor</th>
                  <th>Vencimento</th>
                  <th>Atraso</th>
                  <th>Estado</th>
                  <th>Método</th>
                  <th>Sequência</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((c, idx) => {
                  const anchorProps = idx === 0 ? { 'data-demo-target': 'cobrancas-linha' } : {};
                  return (
                    <tr
                      key={c.id}
                      className="is-clickable"
                      data-testid="cobranca-row"
                      data-cobranca-descricao={c.descricao || ''}
                      onClick={() => navigate(`/cobranca/${c.id}`)}
                    >
                      <td>
                        <div className="stack stack-1">
                          <Link
                            className="text-strong"
                            to={`/cobranca/${c.id}`}
                            data-testid="cobrancas-linha"
                            onClick={(e) => e.stopPropagation()}
                            {...anchorProps}
                          >
                            {clienteNome(c.clienteId)}
                          </Link>
                          <span className="text-subtle text-xs">{c.descricao || '(sem descrição)'}</span>
                        </div>
                      </td>
                      <td className="numeric"><span className="text-strong">{formatEur(c.valor)}</span></td>
                      <td>{formatDate(c.dataVencimento)}</td>
                      <td>
                        {emAberto(c)
                          ? <Badge tone={atrasoTone(c.dataVencimento, hoje)}>{atrasoLabel(c.dataVencimento, hoje)}</Badge>
                          : <span className="text-subtle text-xs">—</span>}
                      </td>
                      <td><Badge tone={ESTADO_TONE[c.estado] || 'neutral'}>{ESTADO_LABEL[c.estado] || c.estado}</Badge></td>
                      <td><span className="text-xs">{METODO_LABEL[c.metodo] || c.metodo || '—'}</span></td>
                      <td><span className="text-xs text-subtle">{sequenciaNome(c.sequenciaId)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
