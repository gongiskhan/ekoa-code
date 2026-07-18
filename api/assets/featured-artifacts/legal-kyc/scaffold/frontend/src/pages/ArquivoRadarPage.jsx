import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, formatDate, diasRestantes } from '../shared.js';
import { Badge, DataTable, EmptyState } from '../components/ui.jsx';
import { IconShieldCheck, IconInbox } from '../components/Icons.jsx';

/*
 * Radar de conservação (art. 51.º da Lei n.º 83/2017): as fichas de diligência
 * conservam-se 7 anos após a aprovação. Este ecrã reúne as fichas aprovadas por
 * data de arquivo, das mais próximas do prazo para as mais distantes, para que
 * a conservação seja gerida ativamente e nenhuma ficha seja eliminada antes do
 * seu prazo. É só leitura - não há remoção aqui (nem em lado nenhum antes da
 * data de arquivo).
 */

/* Banda temporal de uma ficha face ao seu prazo de conservação. */
function bandaArquivo(dias) {
  if (!Number.isFinite(dias)) return { chave: 'sem-data', label: 'Sem data', tone: 'neutral' };
  if (dias < 0) return { chave: 'atingido', label: 'Prazo atingido', tone: 'alta' };
  if (dias <= 180) return { chave: 'proximo', label: `Faltam ${dias} dias`, tone: 'media' };
  return { chave: 'em-conservacao', label: 'Em conservação', tone: 'ok' };
}

export default function ArquivoRadarPage() {
  const navigate = useNavigate();
  const { items: fichas, loading } = useSharedCollection('kyc_fichas');
  const { items: clientes } = useSharedCollection('clientes');

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '(cliente removido)';
  }, [clientes]);

  // Só fichas aprovadas têm prazo de arquivo (arquivarAte carimbado na aprovação).
  const rows = useMemo(() => {
    return fichas
      .filter((f) => f.estado === 'aprovada' && f.arquivarAte)
      .map((f) => ({ ...f, _dias: diasRestantes(f.arquivarAte) }))
      .sort((a, b) => {
        const da = Number.isFinite(a._dias) ? a._dias : Number.POSITIVE_INFINITY;
        const db = Number.isFinite(b._dias) ? b._dias : Number.POSITIVE_INFINITY;
        return da - db;
      });
  }, [fichas]);

  const proximos = rows.filter((f) => Number.isFinite(f._dias) && f._dias <= 180).length;

  return (
    <div data-testid="arquivo-radar-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Radar de conservação</h1>
          <p className="page-subtitle">
            Fichas aprovadas por data de arquivo. A conservação é obrigatória durante 7 anos após
            a aprovação (art. 51.º da Lei n.º 83/2017); nenhuma ficha é eliminada antes do prazo.
          </p>
        </div>
      </div>

      <div className="citius-resultado is-review" data-testid="radar-resumo" role="note">
        <span className="citius-resultado-icon" aria-hidden="true"><IconShieldCheck /></span>
        <span className="citius-resultado-text">
          <span className="citius-resultado-strong">
            {rows.length} ficha(s) em conservação
          </span>
          <span className="citius-resultado-meta">
            {proximos > 0
              ? `${proximos} com prazo de arquivo dentro de 180 dias ou já atingido.`
              : 'Nenhuma com prazo de arquivo nos próximos 180 dias.'}
          </span>
        </span>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar fichas.</span></div>
      ) : (
        <div style={{ marginTop: 'var(--sp-4, 1rem)' }}>
          <DataTable
            data-testid="radar-tabela"
            columns={[
              { key: 'cliente', label: 'Cliente', render: (f) => <span className="text-strong">{clienteNome(f.clienteId)}</span> },
              { key: 'arquivo', label: 'Arquivo até', render: (f) => <span className="numeric">{formatDate(f.arquivarAte)}</span> },
              {
                key: 'estado',
                label: 'Conservação',
                render: (f) => {
                  const b = bandaArquivo(f._dias);
                  return <Badge tone={b.tone} data-testid={`radar-banda-${b.chave}`}>{b.label}</Badge>;
                },
              },
            ]}
            rows={rows}
            rowKey="id"
            onRowClick={(f) => navigate(`/ficha/${f.id}`)}
            empty={
              <EmptyState
                icon={<IconInbox />}
                title="Sem fichas em conservação"
                hint="As fichas aprovadas aparecem aqui, ordenadas pela data de arquivo."
              />
            }
          />
        </div>
      )}
    </div>
  );
}
