import { useMemo, useState } from 'react';
import { useCollection, updateItem, deleteItem, formatCurrency, formatDateTime } from '../components/data.js';
import { IconClose, IconSearch, IconShoppingBag, IconTrash } from '../components/Icons.jsx';

const STATUSES = ['Em preparação', 'Enviado', 'Entregue', 'Cancelado'];

function statusVariant(status) {
  switch (status) {
    case 'Entregue': return 'is-success';
    case 'Enviado': return 'is-info';
    case 'Em preparação': return 'is-warning';
    case 'Cancelado': return 'is-danger';
    default: return '';
  }
}

export default function OrdersPage() {
  const { items: orders, loading, refresh } = useCollection('orders');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return orders
      .filter((o) => {
        if (statusFilter !== 'all' && o.status !== statusFilter) return false;
        if (!term) return true;
        return (
          (o.reference || '').toLowerCase().includes(term) ||
          (o.customerName || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => new Date(b.placedAt || b.createdAt).getTime() - new Date(a.placedAt || a.createdAt).getTime());
  }, [orders, query, statusFilter]);

  const selected = selectedId ? orders.find((o) => o.id === selectedId) : null;

  async function changeStatus(order, status) {
    await updateItem('orders', order.id, { status });
    await refresh();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Encomendas</h1>
          <p className="page-subtitle">Acompanhe o estado de cada encomenda desde a preparação até à entrega.</p>
        </div>
      </div>

      <div className="filters">
        <label className="search-input">
          <IconSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquise por referência ou cliente."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="chip-row">
          <button type="button" className={`chip as-button${statusFilter === 'all' ? ' is-active' : ''}`} onClick={() => setStatusFilter('all')}>Todos os estados</button>
          {STATUSES.map((s) => (
            <button key={s} type="button" className={`chip as-button${statusFilter === s ? ' is-active' : ''}`} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar encomendas.</span></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true"><IconShoppingBag /></span>
          <p className="empty-title">Sem encomendas para mostrar</p>
          <p className="empty-text">{orders.length === 0 ? 'Aguarde pela primeira encomenda — assim que chegar, aparece nesta lista.' : 'Ajuste os filtros para ver mais resultados.'}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Referência</th>
                <th>Cliente</th>
                <th>Data</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Acções</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id}>
                  <td className="text-strong">{order.reference || order.id.slice(0, 8)}</td>
                  <td>{order.customerName || 'Sem cliente'}</td>
                  <td>{formatDateTime(order.placedAt || order.createdAt)}</td>
                  <td>
                    <span className={`badge ${statusVariant(order.status)}`}>
                      <span className="badge-dot" aria-hidden="true" />
                      {order.status || 'Sem estado'}
                    </span>
                  </td>
                  <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency(order.total)}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => setSelectedId(order.id)}>
                        Detalhes
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <OrderDrawer
          order={selected}
          onClose={() => setSelectedId(null)}
          onChangeStatus={(status) => changeStatus(selected, status)}
          onDelete={async () => {
            if (typeof window === 'undefined' || window.confirm(`Eliminar a encomenda ${selected.reference}?`)) {
              await deleteItem('orders', selected.id);
              setSelectedId(null);
              await refresh();
            }
          }}
        />
      ) : null}
    </>
  );
}

function OrderDrawer({ order, onClose, onChangeStatus, onDelete }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0);
  const shipping = Number(order.shippingCost) || 0;
  const total = Number(order.total) || subtotal + shipping;

  return (
    <aside className="detail-drawer" aria-label={`Detalhe da encomenda ${order.reference}`}>
      <header className="detail-header">
        <div>
          <p className="text-xs text-subtle" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Encomenda</p>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg, 1.125rem)' }}>{order.reference || 'Sem referência'}</h2>
          <p className="text-small text-muted" style={{ margin: 0, marginTop: 'var(--space-1, 0.25rem)' }}>{order.customerName || 'Sem cliente associado'}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}><IconClose /></button>
      </header>
      <div className="detail-body">
        <section className="stack stack-3">
          <span className="field-label">Estado</span>
          <div className="chip-row">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`chip as-button${order.status === s ? ' is-active' : ''}`}
                onClick={() => onChangeStatus(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="card-title" style={{ marginBottom: 'var(--space-2, 0.5rem)' }}>Detalhe da encomenda</h3>
          <dl className="stack" style={{ gap: 0 }}>
            <div className="detail-row"><dt>Cliente</dt><dd>{order.customerName || '—'}</dd></div>
            <div className="detail-row"><dt>Data</dt><dd>{formatDateTime(order.placedAt || order.createdAt)}</dd></div>
            <div className="detail-row"><dt>Notas</dt><dd>{order.notes || 'Sem notas.'}</dd></div>
          </dl>
        </section>

        <section>
          <h3 className="card-title" style={{ marginBottom: 'var(--space-2, 0.5rem)' }}>Linhas</h3>
          {items.length === 0 ? (
            <p className="text-small text-muted">Sem linhas registadas.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th style={{ textAlign: 'right' }}>Qtd.</th>
                    <th style={{ textAlign: 'right' }}>Preço</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={`${it.sku || it.name}-${idx}`}>
                      <td>{it.name || it.sku || 'Sem nome'}</td>
                      <td className="numeric" style={{ textAlign: 'right' }}>{it.quantity}</td>
                      <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency((Number(it.unitPrice) || 0) * (Number(it.quantity) || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="stack stack-2">
          <div className="row row-space-between"><span className="text-muted text-small">Subtotal</span><span className="numeric">{formatCurrency(subtotal)}</span></div>
          <div className="row row-space-between"><span className="text-muted text-small">Portes</span><span className="numeric">{formatCurrency(shipping)}</span></div>
          <div className="divider" style={{ margin: 0 }} />
          <div className="row row-space-between"><span className="text-strong">Total</span><span className="numeric text-strong">{formatCurrency(total)}</span></div>
        </section>

        <button type="button" className="btn btn-danger" onClick={onDelete}>
          <IconTrash /> Eliminar encomenda
        </button>
      </div>
    </aside>
  );
}
