import { Link } from 'react-router-dom';
import { useCollection, formatCurrency, formatDate } from '../components/data.js';
import {
  IconAlertCircle,
  IconCheckCircle,
  IconChevronRight,
  IconClock,
  IconFileText,
} from '../components/Icons.jsx';

function isOverdue(invoice) {
  if (invoice.status === 'Em atraso') return true;
  if (invoice.status === 'Paga') return false;
  if (!invoice.dueAt) return false;
  return new Date(invoice.dueAt).getTime() < Date.now();
}

export default function DashboardPage() {
  const invoices = useCollection('invoices');
  const clients = useCollection('clients');
  const payments = useCollection('payments');

  const loading = invoices.loading || clients.loading || payments.loading;

  if (loading) {
    return (
      <div className="loading">
        <span className="spinner" aria-hidden="true" />
        <span>A carregar o painel.</span>
      </div>
    );
  }

  const sumByStatus = (status) =>
    invoices.items.filter((i) => i.status === status).reduce((s, i) => s + (Number(i.total) || 0), 0);

  const paidTotal = sumByStatus('Paga');
  const pendingTotal = invoices.items
    .filter((i) => i.status === 'Pendente' && !isOverdue(i))
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  const overdueTotal = invoices.items
    .filter((i) => isOverdue(i) && i.status !== 'Paga')
    .reduce((s, i) => s + (Number(i.total) || 0), 0);

  const recent = [...invoices.items]
    .sort((a, b) => new Date(b.issuedAt || b.createdAt).getTime() - new Date(a.issuedAt || a.createdAt).getTime())
    .slice(0, 5);

  const overdueInvoices = invoices.items
    .filter((i) => isOverdue(i) && i.status !== 'Paga')
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Painel</h1>
          <p className="page-subtitle">Veja o estado da sua faturação num relance.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">Cobrança recebida</span>
          <span className="stat-value numeric">{formatCurrency(paidTotal)}</span>
          <span className="stat-foot is-positive">Total de faturas pagas.</span>
        </div>
        <div className="stat">
          <span className="stat-label">A aguardar pagamento</span>
          <span className="stat-value numeric">{formatCurrency(pendingTotal)}</span>
          <span className="stat-foot is-warning">Dentro do prazo definido.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Em atraso</span>
          <span className="stat-value numeric">{formatCurrency(overdueTotal)}</span>
          <span className="stat-foot is-danger">{overdueInvoices.length} factura(s) com pagamento em atraso.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Clientes activos</span>
          <span className="stat-value numeric">{clients.items.length}</span>
          <span className="stat-foot">Cadastro central de entidades faturáveis.</span>
        </div>
      </div>

      <div className="stack stack-6">
        <section className="card">
          <div className="row row-space-between" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
            <div>
              <h2 className="card-title">Últimas faturas emitidas</h2>
              <p className="card-subtitle">Acompanhe os últimos documentos emitidos.</p>
            </div>
            <Link to="/faturas" className="btn btn-ghost">
              Ver todas <IconChevronRight />
            </Link>
          </div>
          {recent.length === 0 ? (
            <Empty icon={<IconFileText />} title="Sem faturas emitidas" description="Assim que emitir a primeira fatura, irá aparecer aqui." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Cliente</th>
                    <th>Emissão</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((inv) => (
                    <tr key={inv.id}>
                      <td className="text-strong">{inv.number || inv.id.slice(0, 8)}</td>
                      <td>{inv.clientName || '—'}</td>
                      <td>{formatDate(inv.issuedAt || inv.createdAt)}</td>
                      <td>
                        <span className="status-pill" data-state={isOverdue(inv) && inv.status !== 'Paga' ? 'Em atraso' : inv.status}>
                          {iconForStatus(isOverdue(inv) && inv.status !== 'Paga' ? 'Em atraso' : inv.status)}
                          {isOverdue(inv) && inv.status !== 'Paga' ? 'Em atraso' : inv.status || 'Sem estado'}
                        </span>
                      </td>
                      <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency(inv.total)}</td>
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
              <h2 className="card-title">Faturas em atraso</h2>
              <p className="card-subtitle">Documentos que ultrapassaram o prazo de pagamento.</p>
            </div>
            <Link to="/faturas" className="btn btn-ghost">
              Gerir cobrança <IconChevronRight />
            </Link>
          </div>
          {overdueInvoices.length === 0 ? (
            <Empty icon={<IconCheckCircle />} title="Sem faturas em atraso" description="Todos os clientes estão dentro do prazo. Continue assim." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Cliente</th>
                    <th>Venceu</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="text-strong">{inv.number}</td>
                      <td>{inv.clientName || '—'}</td>
                      <td>{formatDate(inv.dueAt)}</td>
                      <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency(inv.total)}</td>
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

function iconForStatus(status) {
  if (status === 'Paga') return <IconCheckCircle />;
  if (status === 'Em atraso') return <IconAlertCircle />;
  if (status === 'Pendente') return <IconClock />;
  return null;
}

function Empty({ icon, title, description }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <p className="empty-title">{title}</p>
      <p className="empty-text">{description}</p>
    </div>
  );
}
