import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSharedCollection, formatDateTime } from '../shared.js';
import { Badge } from '../components/ui.jsx';
import {
  IconClock,
  IconChevronRight,
  IconChevronDown,
  IconShieldAlert,
} from '../components/Icons.jsx';
import { DECISAO_META, TIPO_META } from './conflitos-search.js';

function DecisaoBadge({ decisao }) {
  const meta = DECISAO_META[decisao] || { label: decisao || '—', tone: 'neutral' };
  return <Badge tone={meta.tone} data-testid="conflitos-historico-decisao">{meta.label}</Badge>;
}

/* Detalhe expandido de uma verificação: correspondências registadas + notas. */
function DetalheRow({ check, colSpan }) {
  const resultado = Array.isArray(check.resultado) ? check.resultado : [];
  return (
    <tr className="conflitos-historico-detalhe-row" data-testid="conflitos-historico-detalhe">
      <td colSpan={colSpan} style={{ background: 'var(--surface-1, #f8fafc)' }}>
        <div className="stack stack-3" style={{ padding: 'var(--sp-2, 0.5rem) 0' }}>
          <div className="stack stack-2">
            <span className="nav-section-label" style={{ padding: 0 }}>Correspondências registadas</span>
            {resultado.length === 0 ? (
              <span className="text-subtle">Sem correspondências registadas.</span>
            ) : (
              <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {resultado.map((r, i) => {
                  const meta = TIPO_META[r.tipo] || TIPO_META.processo;
                  return (
                    <li key={`${r.tipo}-${r.refId}-${i}`} className="row row-2" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="text-subtle text-xs">{r.campo}:</span>
                      <span className="text-strong">{r.excerto || '—'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="stack stack-1">
            <span className="nav-section-label" style={{ padding: 0 }}>Notas</span>
            <span className="text-muted">{check.notas ? check.notas : 'Sem notas.'}</span>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function HistoricoPage() {
  const { items: checks, loading } = useSharedCollection('conflitos_check');
  const [expandedId, setExpandedId] = useState(null);

  const rows = useMemo(() => {
    return (Array.isArray(checks) ? checks : [])
      .slice()
      .sort((a, b) => new Date(b.executadoEm || b.createdAt || 0).getTime() - new Date(a.executadoEm || a.createdAt || 0).getTime());
  }, [checks]);

  const COLS = 5;

  return (
    <div data-demo-page="conflitos/historico" data-testid="historico-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Histórico de verificações</h1>
          <p className="page-subtitle">
            Todas as verificações de conflitos registadas, da mais recente para a mais antiga.
            Cada linha guarda a decisão do advogado e as correspondências encontradas.
          </p>
        </div>
        <Link to="/" className="btn btn-primary btn-sm" data-testid="conflitos-nova-verificacao">
          <IconShieldAlert /> Nova verificação
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state" data-testid="conflitos-historico-vazio">
          <span className="empty-icon" aria-hidden="true"><IconClock /></span>
          <p className="empty-title">{loading ? 'A carregar verificações.' : 'Sem verificações registadas'}</p>
          <p className="empty-text">
            As verificações de conflitos que registar aparecem aqui, com a decisão e o responsável.
          </p>
        </div>
      ) : (
        <div className="table-wrap" data-testid="conflitos-historico">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '2.5rem' }} aria-label="Expandir" />
                <th>Verificação</th>
                <th className="numeric">Resultados</th>
                <th>Decisão</th>
                <th>Decidido por</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((check) => {
                const isOpen = expandedId === check.id;
                const nResultados = Array.isArray(check.resultado) ? check.resultado.length : 0;
                return (
                  <Fragment key={check.id}>
                    <tr
                      data-testid="conflitos-historico-row"
                      data-check-id={check.id}
                      className="is-clickable"
                      onClick={() => setExpandedId(isOpen ? null : check.id)}
                    >
                      <td aria-hidden="true" style={{ color: 'var(--ink-3, #64748b)' }}>
                        {isOpen ? <IconChevronDown /> : <IconChevronRight />}
                      </td>
                      <td>
                        <div className="stack stack-1">
                          <span className="text-strong">{check.termo || '(sem termo)'}</span>
                          <span className="text-subtle text-xs">
                            {formatDateTime(check.executadoEm || check.createdAt)}
                            {check.nif ? ` · NIF ${check.nif}` : ''}
                          </span>
                        </div>
                      </td>
                      <td className="numeric">{nResultados}</td>
                      <td><DecisaoBadge decisao={check.decisao} /></td>
                      <td>{check.decididoPor || '—'}</td>
                    </tr>
                    {isOpen ? <DetalheRow check={check} colSpan={COLS} /> : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
