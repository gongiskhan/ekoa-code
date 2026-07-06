import { useEffect, useMemo, useState } from 'react';
import { useCollection, createItem, deleteItem, updateItem, formatCurrency, formatDate } from '../components/data.js';
import { IconClose, IconCoins, IconPlus, IconSearch, IconTrash } from '../components/Icons.jsx';

const METHODS = ['Transferência bancária', 'MB WAY', 'Multibanco', 'Dinheiro', 'Cheque'];

function emptyForm() {
  return {
    invoiceNumber: '',
    receivedAt: new Date().toISOString().slice(0, 10),
    amount: '',
    method: METHODS[0],
    reference: '',
  };
}

export default function PaymentsPage() {
  const { items: payments, loading, refresh } = useCollection('payments');
  const { items: invoices } = useCollection('invoices');
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const enriched = useMemo(() => {
    return payments
      .map((p) => {
        const inv = invoices.find((i) => i.number === p.invoiceNumber);
        return { ...p, clientName: inv?.clientName, invoiceTotal: inv?.total };
      })
      .filter((p) => {
        const term = query.trim().toLowerCase();
        if (!term) return true;
        return (
          (p.invoiceNumber || '').toLowerCase().includes(term) ||
          (p.method || '').toLowerCase().includes(term) ||
          (p.reference || '').toLowerCase().includes(term) ||
          (p.clientName || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => new Date(b.receivedAt || b.createdAt).getTime() - new Date(a.receivedAt || a.createdAt).getTime());
  }, [payments, invoices, query]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pagamentos</h1>
          <p className="page-subtitle">Registe os pagamentos recebidos e reconcilie com as faturas emitidas.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing(emptyForm()); setFormError(null); }}>
          <IconPlus /> Registar pagamento
        </button>
      </div>

      <div className="filters">
        <label className="search-input">
          <IconSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquise por número de fatura, método ou cliente."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar pagamentos.</span></div>
      ) : enriched.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true"><IconCoins /></span>
          <p className="empty-title">{payments.length === 0 ? 'Sem pagamentos registados' : 'Sem resultados'}</p>
          <p className="empty-text">{payments.length === 0 ? 'Logo que receba o primeiro pagamento, registe-o aqui para manter o histórico organizado.' : 'Ajuste a pesquisa para ver mais resultados.'}</p>
          {payments.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => setEditing(emptyForm())}>
              <IconPlus /> Registar pagamento
            </button>
          ) : null}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fatura</th>
                <th>Cliente</th>
                <th>Data</th>
                <th>Método</th>
                <th>Referência</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th style={{ textAlign: 'right' }}>Acções</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((p) => (
                <tr key={p.id}>
                  <td className="text-strong">{p.invoiceNumber || '—'}</td>
                  <td>{p.clientName || 'Sem associação'}</td>
                  <td>{formatDate(p.receivedAt || p.createdAt)}</td>
                  <td>{p.method || '—'}</td>
                  <td className="text-muted text-small">{p.reference || '—'}</td>
                  <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency(p.amount)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn btn-danger btn-icon"
                        aria-label="Eliminar pagamento"
                        onClick={async () => {
                          if (typeof window === 'undefined' || window.confirm('Eliminar este pagamento?')) {
                            await deleteItem('payments', p.id);
                            await refresh();
                          }
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <PaymentForm
          state={editing}
          invoices={invoices}
          submitting={submitting}
          error={formError}
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            setSubmitting(true);
            setFormError(null);
            try {
              const payload = {
                invoiceNumber: form.invoiceNumber.trim() || null,
                receivedAt: form.receivedAt || null,
                amount: parseFloat(form.amount) || 0,
                method: form.method || null,
                reference: form.reference.trim() || null,
              };
              if (!payload.invoiceNumber) throw new Error('Indique o número da fatura associada.');
              if (payload.amount <= 0) throw new Error('O valor do pagamento deve ser superior a zero.');
              await createItem('payments', payload);
              // Marcar a fatura correspondente como paga, se existir.
              const invoice = invoices.find((i) => i.number === payload.invoiceNumber);
              if (invoice && invoice.status !== 'Paga') {
                await updateItem('invoices', invoice.id, { status: 'Paga', paidAt: payload.receivedAt });
              }
              await refresh();
              setEditing(null);
            } catch (err) {
              setFormError(err.message || 'Não foi possível registar o pagamento.');
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function PaymentForm({ state, invoices, onClose, onSubmit, submitting, error }) {
  const [form, setForm] = useState(state);
  useEffect(() => setForm(state), [state]);

  const matched = invoices.find((i) => i.number === form.invoiceNumber);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="payment-form-title">
      <div className="modal">
        <header className="modal-header row row-space-between">
          <h2 id="payment-form-title" className="modal-title">Registar pagamento</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}><IconClose /></button>
        </header>
        <form className="modal-body form" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Fatura associada</span>
              <input
                className="field-input"
                list="invoices-list"
                value={form.invoiceNumber}
                onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
                required
                placeholder="FT 2026/001"
              />
              <datalist id="invoices-list">
                {invoices.filter((i) => i.status !== 'Paga').map((i) => (
                  <option key={i.id} value={i.number}>{i.clientName ? `${i.clientName}` : ''} · {formatCurrency(i.total)}</option>
                ))}
              </datalist>
              {matched ? (
                <span className="field-hint">{matched.clientName} · total {formatCurrency(matched.total)} · estado {matched.status}</span>
              ) : null}
            </label>
            <label className="field">
              <span className="field-label">Data do pagamento</span>
              <input type="date" className="field-input" value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Método</span>
              <select className="field-select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Valor</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="field-input numeric"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span className="field-label">Referência</span>
              <input className="field-input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="TRF 20260518-001" />
            </label>
          </div>
          {error ? <p className="text-small" style={{ color: 'var(--color-danger, #DC2626)', margin: 0 }}>{error}</p> : null}
          <footer className="modal-footer" style={{ marginLeft: 'calc(-1 * var(--space-6, 1.5rem))', marginRight: 'calc(-1 * var(--space-6, 1.5rem))', marginBottom: 'calc(-1 * var(--space-6, 1.5rem))', marginTop: 'var(--space-6, 1.5rem)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'A guardar.' : 'Registar pagamento'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
