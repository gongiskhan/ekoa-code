import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useData, STAGES, stageMeta, formatCurrency, formatDateTime } from '../components/DataContext.jsx';
import { PageHeader, Card, Skeleton, EmptyState, Tag } from '../components/UIBits.jsx';

function StatCard({ label, value, hint, accent }) {
  return (
    <div className={'stat-card' + (accent ? ' stat-accent' : '')}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export default function Dashboard() {
  const { contacts, deals, activities, loading } = useData();

  const stats = useMemo(() => {
    const openDeals = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
    const wonDeals = deals.filter((d) => d.stage === 'won');
    const pipelineValue = openDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const wonValue = wonDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    return { openCount: openDeals.length, wonCount: wonDeals.length, pipelineValue, wonValue };
  }, [deals]);

  const stageBuckets = useMemo(() => {
    return STAGES.map((stage) => ({
      ...stage,
      items: deals.filter((d) => d.stage === stage.id),
    })).filter((bucket) => bucket.items.length > 0 || bucket.id !== 'lost');
  }, [deals]);

  const recentActivities = useMemo(() => {
    return [...activities]
      .sort((a, b) => {
        const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
        const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
        return tb - ta;
      })
      .slice(0, 5);
  }, [activities]);

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader title="Resumo" subtitle="Acompanhe o pulso da sua operação comercial." />
        <Card><Skeleton count={5} /></Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Resumo"
        subtitle="Veja o pulso da sua operação comercial num só olhar."
      />

      <div className="stat-grid">
        <StatCard label="Contactos ativos" value={contacts.length} hint="Pessoas com quem se relaciona." />
        <StatCard label="Negócios em curso" value={stats.openCount} hint={formatCurrency(stats.pipelineValue) + ' em pipeline'} accent />
        <StatCard label="Negócios ganhos" value={stats.wonCount} hint={formatCurrency(stats.wonValue) + ' fechados'} />
        <StatCard label="Atividade registada" value={activities.length} hint="Interações documentadas." />
      </div>

      <div className="dashboard-grid">
        <Card title="Pipeline por etapa" hint="Distribuição dos negócios ativos.">
          {deals.length === 0 ? (
            <EmptyState
              title="Ainda não há negócios"
              description="Adicione o primeiro negócio para começar a acompanhar o seu pipeline."
              action={<Link to="/negocios" className="btn btn-primary">Adicionar negócio</Link>}
            />
          ) : (
            <div className="pipeline-summary">
              {stageBuckets.map((bucket) => {
                const total = bucket.items.reduce((s, d) => s + (Number(d.value) || 0), 0);
                return (
                  <div key={bucket.id} className="pipeline-row">
                    <Tag tone={bucket.tone}>{bucket.label}</Tag>
                    <div className="pipeline-meta">
                      <strong>{bucket.items.length}</strong>
                      <span>{formatCurrency(total)}</span>
                    </div>
                    <div className="pipeline-bar">
                      <div className={'pipeline-bar-fill ' + bucket.tone} style={{ width: Math.min(100, bucket.items.length * 14) + '%' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Atividade recente" hint="Últimas cinco interações.">
          {recentActivities.length === 0 ? (
            <EmptyState
              title="Sem atividade registada"
              description="Registe chamadas, e-mails e reuniões para criar o seu histórico."
            />
          ) : (
            <ul className="activity-list">
              {recentActivities.map((a) => (
                <li key={a.id} className="activity-item">
                  <div className="activity-meta">
                    <Tag tone="tone-accent">{a.type || 'Nota'}</Tag>
                    <span className="activity-time">{formatDateTime(a.occurredAt)}</span>
                  </div>
                  <p className="activity-summary">{a.summary || 'Sem descrição.'}</p>
                  <span className="activity-contact">{a.contactName} · {a.company}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
