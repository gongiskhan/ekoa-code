import { useMemo } from 'react';
import { useSharedCollection, formatDate } from '../shared.js';
import { Badge, EmptyState } from '../components/ui.jsx';
import { IconCalendar } from '../components/Icons.jsx';
import { agruparSemana, formatDuracao, ESTADO_TONE, ESTADO_LABEL } from './tempos-logic.js';

export default function SemanaPage() {
  const { items: registos, loading } = useSharedCollection('registos_tempo');
  const { items: processos } = useSharedCollection('processos');

  const processoNumero = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.numeroProcesso || '(sem número)'));
    return (id) => map.get(id) || '—';
  }, [processos]);

  const semana = useMemo(() => agruparSemana(registos), [registos]);
  const temAlgum = semana.total > 0;

  return (
    <div data-testid="semana-page" data-demo-page="tempos/semana">
      <div className="page-header">
        <div>
          <h1 className="page-title">Semana</h1>
          <p className="page-subtitle">
            Tempo registado de {formatDate(semana.inicioISO)} a {formatDate(semana.fimISO)}, por dia,
            faturável e não faturável.
          </p>
        </div>
      </div>

      <div className="kpi-grid" data-testid="semana-totais" style={{ marginBottom: 'var(--sp-6, 1.5rem)' }}>
        <div className="kpi-card">
          <span className="kpi-label">Total da semana</span>
          <span className="kpi-value" data-testid="semana-total">{formatDuracao(semana.total)}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Faturável</span>
          <span className="kpi-value is-accent" data-testid="semana-faturavel">{formatDuracao(semana.totalFaturavel)}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Não faturável</span>
          <span className="kpi-value" data-testid="semana-nao">{formatDuracao(semana.totalNao)}</span>
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar a semana.</span></div>
      ) : (
        <div
          data-testid="semana-grelha"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 'var(--sp-4, 1rem)',
          }}
        >
          {semana.dias.map((dia) => (
            <section
              key={dia.iso}
              className="card"
              data-testid="semana-dia"
              aria-label={`${dia.label} ${formatDate(dia.iso)}`}
              style={{ padding: 'var(--sp-4, 1rem)' }}
            >
              <div className="row row-space-between" style={{ marginBottom: 'var(--sp-2, 0.5rem)' }}>
                <span className="text-strong">{dia.label}</span>
                <span className="text-subtle text-xs">{formatDate(dia.iso)}</span>
              </div>
              <div className="stack stack-1" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
                <span className="numeric text-strong" style={{ fontSize: 'var(--text-lg, 1.125rem)' }}>
                  {formatDuracao(dia.minutos)}
                </span>
                {dia.minutos > 0 ? (
                  <span className="text-subtle text-xs">
                    {formatDuracao(dia.minutosFaturavel)} faturável · {formatDuracao(dia.minutosNao)} não
                  </span>
                ) : (
                  <span className="text-subtle text-xs">Sem registos</span>
                )}
              </div>
              {dia.registos.length > 0 && (
                <div className="stack stack-2">
                  {dia.registos.map((r) => (
                    <div key={r.id} className="stack stack-1" style={{ borderTop: '1px solid var(--line-1)', paddingTop: 'var(--sp-2, 0.5rem)' }}>
                      <div className="row row-space-between row-2">
                        <span className="text-small">{r.descricao || '(sem descrição)'}</span>
                        <span className="numeric text-subtle text-xs">{formatDuracao(r.minutos)}</span>
                      </div>
                      <div className="row row-2 row-wrap">
                        <span className="text-subtle text-xs">{r.processoId ? processoNumero(r.processoId) : 'Sem processo'}</span>
                        <Badge tone={ESTADO_TONE[r.estado] || 'neutral'}>{ESTADO_LABEL[r.estado] || r.estado}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {!loading && !temAlgum && (
        <div style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
          <EmptyState
            icon={<IconCalendar />}
            title="Sem tempo registado esta semana"
            hint="Os registos de tempo desta semana aparecem aqui, dia a dia."
          />
        </div>
      )}
    </div>
  );
}
