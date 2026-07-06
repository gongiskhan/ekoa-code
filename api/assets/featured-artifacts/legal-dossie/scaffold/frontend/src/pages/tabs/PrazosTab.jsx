import { useMemo } from 'react';
import { formatDate, diasRestantes, appHref } from '../../shared.js';
import { Badge, EmptyState } from '../../components/ui.jsx';
import { IconCalendar, IconExternalLink } from '../../components/Icons.jsx';
import { urgenciaDeDias } from '../doc-helpers.jsx';

function estadoTone(estado) {
  if (estado === 'cumprido') return 'ok';
  if (estado === 'pendente') return 'media';
  return 'neutral';
}

function diasLabel(dias, estado) {
  if (estado === 'cumprido') return 'Cumprido';
  if (!Number.isFinite(dias)) return '—';
  if (dias < 0) return `Vencido há ${Math.abs(dias)}d`;
  if (dias === 0) return 'Hoje';
  return `${dias} dias`;
}

/*
 * Separador Prazos: os prazos deste processo, com dias restantes e urgência. O
 * cálculo e a gestão vivem no radar de Prazos - aqui é uma vista de leitura com
 * atalho para lá.
 */
export default function PrazosTab({ prazos }) {
  const rows = useMemo(() => {
    return prazos
      .slice()
      .sort((a, b) => String(a.dataLimite || '').localeCompare(String(b.dataLimite || '')));
  }, [prazos]);

  return (
    <div className="stack stack-4" data-testid="prazos-tab">
      <div className="row row-space-between" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <p className="text-muted text-small" style={{ margin: 0 }}>
          Prazos processuais ligados a este processo.
        </p>
        <a className="btn btn-secondary btn-sm" href={appHref('legal-prazos')}>
          <IconCalendar size={14} /> Abrir radar de prazos <IconExternalLink size={12} />
        </a>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconCalendar />}
          title="Sem prazos"
          hint="Este processo ainda não tem prazos registados. Calcule-os no radar de prazos."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Prazo</th>
                <th>Data-limite</th>
                <th>Dias restantes</th>
                <th>Estado</th>
                <th>Origem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const dias = diasRestantes(p.dataLimite);
                return (
                  <tr key={p.id} data-testid="prazo-row">
                    <td className="text-strong">{p.titulo || p.descricao || '(sem título)'}</td>
                    <td className="numeric">{formatDate(p.dataLimite)}</td>
                    <td>
                      <Badge tone={p.estado === 'cumprido' ? 'ok' : urgenciaDeDias(dias)}>
                        {diasLabel(dias, p.estado)}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={estadoTone(p.estado)}>{p.estado || '—'}</Badge>
                    </td>
                    <td className="text-muted">{p.origem || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
