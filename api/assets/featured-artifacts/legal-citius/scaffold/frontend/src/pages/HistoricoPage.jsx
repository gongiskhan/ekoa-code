import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, formatDate, appHref } from '../shared.js';
import { DataTable, Badge, EmptyState } from '../components/ui.jsx';
import { IconClock, IconExternalLink } from '../components/Icons.jsx';
import { estadoMeta, isNeedsReview, byRecent } from './triage.js';

/*
 * Histórico - o registo das notificações já triadas (tudo o que já não está em
 * revisão): prazo criado, processada ou rejeitada. Cada linha liga ao detalhe;
 * as que geraram prazo(s) ligam também à app Prazos.
 */
export default function HistoricoPage() {
  const navigate = useNavigate();
  const { items, loading } = useSharedCollection('citius_notificacoes');

  const rows = useMemo(
    () => [...(items || [])].filter((n) => !isNeedsReview(n)).sort(byRecent),
    [items],
  );

  const columns = [
    {
      key: 'numeroProcesso',
      label: 'Processo',
      render: (n) => <span className="numeric text-strong">{n.numeroProcesso || '(sem número)'}</span>,
    },
    { key: 'ato', label: 'Ato', render: (n) => n.ato || 'Não reconhecido' },
    {
      key: 'estado',
      label: 'Estado',
      render: (n) => {
        const meta = estadoMeta(n.estado);
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
    {
      key: 'dataLimite',
      label: 'Data-limite',
      render: (n) => (n.dataLimite ? <span className="numeric">{formatDate(n.dataLimite)}</span> : '—'),
    },
    {
      key: 'prazo',
      label: 'Prazo',
      render: (n) => {
        const has = Array.isArray(n.prazoIds) ? n.prazoIds.length > 0 : !!n.prazoId;
        if (!has) return '—';
        return (
          <a
            href={appHref('legal-prazos')}
            data-testid="historico-prazo-link"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-primary, #0F766E)' }}
          >
            Ver no Prazos <IconExternalLink size={13} />
          </a>
        );
      },
    },
  ];

  return (
    <div data-testid="historico-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Histórico</h1>
          <p className="page-subtitle">As notificações já triadas - prazo criado, processadas ou rejeitadas.</p>
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar o histórico.</span></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconClock />}
          title="Sem histórico"
          hint="Assim que confirmar ou rejeitar uma notificação na caixa de entrada, ela aparece aqui."
        />
      ) : (
        <DataTable
          data-testid="historico-tabela"
          columns={columns}
          rows={rows}
          rowKey="id"
          onRowClick={(n) => navigate(`/notificacao/${n.id}`)}
        />
      )}
    </div>
  );
}
