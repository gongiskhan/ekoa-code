import { Link } from 'react-router-dom';
import { useCollection, formatCurrency, formatDateTime } from '../components/data.js';
import { IconChevronRight, IconPackage, IconShoppingBag, IconUsers } from '../components/Icons.jsx';

function statusVariant(status) {
  switch (status) {
    case 'Entregue': return 'is-success';
    case 'Enviado': return 'is-info';
    case 'Em preparação': return 'is-warning';
    case 'Cancelado': return 'is-danger';
    default: return '';
  }
}

export default function DashboardPage() {
  const products = useCollection('products');
  const orders = useCollection('orders');
  const customers = useCollection('customers');

  const isLoading = products.loading || orders.loading || customers.loading;

  if (isLoading) {
    return (
      <div className="loading">
        <span className="spinner" aria-hidden="true" />
        <span>A carregar o painel.</span>
      </div>
    );
  }

  const totalRevenue = orders.items
    .filter((o) => o.status !== 'Cancelado')
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  const pendingOrders = orders.items.filter((o) => o.status === 'Em preparação' || o.status === 'Enviado');
  const lowStock = products.items
    .filter((p) => (Number(p.stock) || 0) > 0 && (Number(p.stock) || 0) <= 15)
    .sort((a, b) => (a.stock || 0) - (b.stock || 0));

  const recentOrders = [...orders.items]
    .sort((a, b) => new Date(b.placedAt || b.createdAt).getTime() - new Date(a.placedAt || a.createdAt).getTime())
    .slice(0, 5);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Painel</h1>
          <p className="page-subtitle">Veja um resumo das encomendas, do stock e dos clientes.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">Receita acumulada</span>
          <span className="stat-value numeric">{formatCurrency(totalRevenue)}</span>
          <span className="stat-foot is-positive">Inclui apenas encomendas confirmadas.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Encomendas activas</span>
          <span className="stat-value numeric">{pendingOrders.length}</span>
          <span className="stat-foot">Em preparação ou já enviadas.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Produtos no catálogo</span>
          <span className="stat-value numeric">{products.items.length}</span>
          <span className="stat-foot">{lowStock.length > 0 ? `${lowStock.length} com stock reduzido` : 'Stock em níveis saudáveis.'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Clientes registados</span>
          <span className="stat-value numeric">{customers.items.length}</span>
          <span className="stat-foot">Tenha sempre o histórico à mão.</span>
        </div>
      </div>

      <div className="stack stack-6">
        <section className="card">
          <div className="row row-space-between" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
            <div>
              <h2 className="card-title">Encomendas recentes</h2>
              <p className="card-subtitle">As cinco mais recentes ordenadas por data.</p>
            </div>
            <Link to="/encomendas" className="btn btn-ghost">
              Ver todas <IconChevronRight />
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <EmptyTable icon={<IconShoppingBag />} title="Sem encomendas" description="Assim que houver registos, eles aparecem aqui." />
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
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="row row-space-between" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
            <div>
              <h2 className="card-title">Stock a vigiar</h2>
              <p className="card-subtitle">Produtos com 15 ou menos unidades disponíveis.</p>
            </div>
            <Link to="/produtos" className="btn btn-ghost">
              Gerir produtos <IconChevronRight />
            </Link>
          </div>
          {lowStock.length === 0 ? (
            <EmptyTable icon={<IconPackage />} title="Stock controlado" description="Nenhum produto requer reposição imediata." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Referência</th>
                    <th style={{ textAlign: 'right' }}>Stock</th>
                    <th style={{ textAlign: 'right' }}>Preço</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((p) => (
                    <tr key={p.id}>
                      <td className="text-strong">{p.name}</td>
                      <td className="text-muted">{p.sku || '—'}</td>
                      <td className="numeric" style={{ textAlign: 'right' }}>{p.stock}</td>
                      <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency(p.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function EmptyTable({ icon, title, description }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <p className="empty-title">{title}</p>
      <p className="empty-text">{description}</p>
    </div>
  );
}
