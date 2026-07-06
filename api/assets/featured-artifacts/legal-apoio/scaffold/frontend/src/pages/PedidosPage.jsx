import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, formatDate, appHref } from '../shared.js';
import { Badge, Button, Skeleton, EmptyState } from '../components/ui.jsx';
import { IconLifeBuoy, IconPlus, IconCalendar, IconExternalLink } from '../components/Icons.jsx';
import {
  TIPO_PEDIDO_LABEL,
  TIPO_PEDIDO_TONE,
  ESTADO_LABEL,
  ESTADO_TONE,
} from './apoio-logic.js';

/*
 * Aviso PERMANENTE e honesto: o SinOA não tem API. Esta aplicação prepara e
 * organiza o pedido; a submissão é sempre feita pelo advogado no portal SinOA.
 * A cópia é fixa (ancorada pelos testes).
 */
export function SinoaDisclaimer() {
  return (
    <div className="citius-resultado is-review" data-testid="apoio-disclaimer" data-demo-target="apoio-disclaimer" role="note">
      <span className="citius-resultado-icon" aria-hidden="true"><IconLifeBuoy /></span>
      <span className="citius-resultado-text">
        <span className="citius-resultado-strong">A submissão é feita no SinOA</span>
        <span className="citius-resultado-meta">
          A submissão é feita pelo advogado no SinOA - esta aplicação prepara e organiza o pedido.
        </span>
      </span>
    </div>
  );
}

export default function PedidosPage() {
  const navigate = useNavigate();
  const { items: pedidos, loading } = useSharedCollection('apoio_judiciario');
  const { items: clientes } = useSharedCollection('clientes');

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '(cliente removido)';
  }, [clientes]);

  const rows = useMemo(
    () => pedidos.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [pedidos],
  );

  return (
    <div data-testid="pedidos-page" data-demo-page="apoio/">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pedidos de apoio judiciário</h1>
          <p className="page-subtitle">
            Protecção jurídica, nomeações e escusas (SADT). Organize e prepare o pedido, gere os
            prazos SinOA e reúna os honorários - a submissão é feita pelo advogado no SinOA.
          </p>
        </div>
        <Button data-testid="apoio-novo" onClick={() => navigate('/novo')}>
          <IconPlus /> Novo pedido
        </Button>
      </div>

      <SinoaDisclaimer />

      {loading ? (
        <Skeleton lines={6} />
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
          <EmptyState
            icon={<IconLifeBuoy />}
            title="Sem pedidos de apoio judiciário"
            hint="Crie o primeiro pedido para um cliente. Os clientes e processos vêm do Núcleo partilhado."
            action={<Button data-testid="apoio-novo-vazio" onClick={() => navigate('/novo')}><IconPlus /> Novo pedido</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap" data-testid="apoio-pedidos-tabela" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Data do pedido</th>
                <th>Prazos gerados</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, idx) => {
                const nPrazos = Array.isArray(p.prazosGerados) ? p.prazosGerados.length : 0;
                return (
                  <tr
                    key={p.id}
                    className="is-clickable"
                    data-testid={`apoio-pedido-row-${p.id}`}
                    {...(idx === 0 ? { 'data-demo-target': 'apoio-pedido' } : {})}
                    onClick={() => navigate(`/pedido/${p.id}`)}
                  >
                    <td><span className="text-strong">{clienteNome(p.clienteId)}</span></td>
                    <td>
                      <Badge tone={TIPO_PEDIDO_TONE[p.tipoPedido] || 'neutral'}>
                        {TIPO_PEDIDO_LABEL[p.tipoPedido] || p.tipoPedido || '—'}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={ESTADO_TONE[p.estado] || 'neutral'} data-testid={`apoio-estado-${p.id}`}>
                        {ESTADO_LABEL[p.estado] || p.estado || '—'}
                      </Badge>
                    </td>
                    <td>{p.datas && p.datas.pedido ? formatDate(p.datas.pedido) : '—'}</td>
                    <td>
                      {nPrazos > 0 ? (
                        <a
                          href={appHref('legal-prazos')}
                          className="stat-link row row-1"
                          data-testid={`apoio-prazos-link-${p.id}`}
                          style={{ alignItems: 'center', gap: '4px', color: 'var(--accent)', fontWeight: 600 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconCalendar size={14} /> {nPrazos} no radar <IconExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-subtle text-xs">—</span>
                      )}
                    </td>
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
