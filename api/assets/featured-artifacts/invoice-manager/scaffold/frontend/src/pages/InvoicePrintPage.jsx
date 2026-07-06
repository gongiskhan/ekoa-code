import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCollection, formatCurrency, formatDate } from '../components/data.js';
import { IconChevronRight, IconClose, IconPrinter } from '../components/Icons.jsx';

export default function InvoicePrintPage() {
  const { invoiceId } = useParams();
  const { items: invoices, loading } = useCollection('invoices');
  const { items: clients } = useCollection('clients');

  useEffect(() => {
    // Permite imprimir directamente quando a página abre com ?auto.
    if (typeof window !== 'undefined' && window.location.search.includes('auto')) {
      const timer = setTimeout(() => window.print(), 600);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <span className="spinner" aria-hidden="true" />
        <span>A carregar fatura.</span>
      </div>
    );
  }

  const invoice = invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) {
    return (
      <div className="invoice-print">
        <div className="invoice-sheet" style={{ textAlign: 'center' }}>
          <h1 style={{ marginTop: 0 }}>Fatura não encontrada</h1>
          <p className="text-muted">A fatura que pretende imprimir já não está disponível.</p>
          <Link to="/faturas" className="btn btn-secondary">
            Voltar à lista <IconChevronRight />
          </Link>
        </div>
      </div>
    );
  }

  const client = clients.find((c) => c.name === invoice.clientName);
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const subtotal = items.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0);
  const taxRate = Number(invoice.taxRate) || 0;
  const taxAmount = Number(invoice.taxAmount) || (subtotal * taxRate) / 100;
  const total = Number(invoice.total) || subtotal + taxAmount;

  return (
    <div className="invoice-print">
      <div className="invoice-print-toolbar">
        <Link to="/faturas" className="btn btn-secondary">
          <IconClose /> Fechar pré-visualização
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <IconPrinter /> Imprimir / Guardar PDF
        </button>
      </div>

      <article className="invoice-sheet">
        <header className="invoice-sheet-header">
          <div>
            <p className="invoice-sheet-eyebrow">Fatura</p>
            <h1 className="invoice-sheet-number">{invoice.number || '—'}</h1>
            <p className="text-small text-muted" style={{ margin: 0, marginTop: 'var(--space-2, 0.5rem)' }}>
              Emitida a {formatDate(invoice.issuedAt)} · Vencimento a {formatDate(invoice.dueAt)}
            </p>
          </div>
          <div className="stack stack-2" style={{ alignItems: 'flex-end' }}>
            <span className="status-pill" data-state={invoice.status}>{invoice.status || 'Sem estado'}</span>
            {invoice.paidAt ? <span className="text-small text-muted">Pago a {formatDate(invoice.paidAt)}</span> : null}
          </div>
        </header>

        <section className="invoice-sheet-section">
          <div>
            <p className="invoice-block-label">De</p>
            <div className="invoice-block-body">
              <strong>A sua empresa, Lda.</strong>
              <div>Rua de exemplo, n.º 1</div>
              <div>1000-000 Lisboa</div>
              <div>NIF 500 000 000</div>
              <div>contacto@aexemplo.pt</div>
            </div>
          </div>
          <div>
            <p className="invoice-block-label">Para</p>
            <div className="invoice-block-body">
              <strong>{invoice.clientName || '—'}</strong>
              {client?.address ? <div>{client.address}</div> : null}
              {invoice.clientNif ? <div>NIF {invoice.clientNif}</div> : null}
              {client?.email ? <div>{client.email}</div> : null}
              {client?.phone ? <div>{client.phone}</div> : null}
            </div>
          </div>
        </section>

        <section>
          <table className="invoice-line-table">
            <thead>
              <tr>
                <th>Descrição</th>
                <th style={{ width: 80, textAlign: 'right' }}>Qtd.</th>
                <th style={{ width: 140, textAlign: 'right' }}>Preço unitário</th>
                <th style={{ width: 140, textAlign: 'right' }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} className="text-muted">Sem linhas registadas.</td></tr>
              ) : items.map((it, idx) => (
                <tr key={idx}>
                  <td>{it.description || '—'}</td>
                  <td className="numeric">{it.quantity}</td>
                  <td className="numeric">{formatCurrency(it.unitPrice)}</td>
                  <td className="numeric">{formatCurrency((Number(it.unitPrice) || 0) * (Number(it.quantity) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="invoice-totals">
          <div className="row"><span className="text-muted">Subtotal</span><span className="numeric">{formatCurrency(subtotal)}</span></div>
          <div className="row"><span className="text-muted">IVA ({taxRate}%)</span><span className="numeric">{formatCurrency(taxAmount)}</span></div>
          <div className="row is-grand"><span>Total a pagar</span><span className="numeric">{formatCurrency(total)}</span></div>
        </section>

        {invoice.notes ? (
          <section className="invoice-footer">
            <p className="invoice-block-label">Notas</p>
            <p style={{ margin: 0 }}>{invoice.notes}</p>
          </section>
        ) : (
          <section className="invoice-footer">
            <p style={{ margin: 0 }}>Obrigado pela sua preferência. Para qualquer questão sobre esta fatura, contacte-nos por email.</p>
          </section>
        )}
      </article>
    </div>
  );
}
