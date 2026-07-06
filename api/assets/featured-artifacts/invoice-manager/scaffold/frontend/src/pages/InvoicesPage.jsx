import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCollection, createItem, updateItem, deleteItem, formatCurrency, formatDate } from '../components/data.js';
import {
  IconAlertCircle,
  IconCheckCircle,
  IconClock,
  IconClose,
  IconEdit,
  IconFileText,
  IconPlus,
  IconPrinter,
  IconSearch,
  IconTrash,
} from '../components/Icons.jsx';

const STATUSES = ['Rascunho', 'Pendente', 'Paga', 'Em atraso'];

function nextInvoiceNumber(invoices) {
  const year = new Date().getFullYear();
  const prefix = `FT ${year}/`;
  const numbers = invoices
    .map((i) => i.number || '')
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

function computeIsOverdue(invoice) {
  if (invoice.status === 'Em atraso') return true;
  if (invoice.status === 'Paga') return false;
  if (!invoice.dueAt) return false;
  return new Date(invoice.dueAt).getTime() < Date.now();
}

function emptyLine() {
  return { description: '', quantity: '1', unitPrice: '' };
}

function emptyForm() {
  return {
    number: '',
    clientName: '',
    clientNif: '',
    issuedAt: new Date().toISOString().slice(0, 10),
    dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    status: 'Rascunho',
    taxRate: '23',
    notes: '',
    items: [emptyLine()],
  };
}

export default function InvoicesPage() {
  const { items: invoices, loading, refresh } = useCollection('invoices');
  const { items: clients } = useCollection('clients');
  const { items: lineItems } = useCollection('lineItems');
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return invoices
      .map((inv) => ({ ...inv, computedOverdue: computeIsOverdue(inv) }))
      .filter((inv) => {
        const displayStatus = inv.computedOverdue && inv.status !== 'Paga' ? 'Em atraso' : inv.status;
        if (statusFilter !== 'all' && displayStatus !== statusFilter) return false;
        if (!term) return true;
        return (
          (inv.number || '').toLowerCase().includes(term) ||
          (inv.clientName || '').toLowerCase().includes(term) ||
          (inv.clientNif || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => new Date(b.issuedAt || b.createdAt).getTime() - new Date(a.issuedAt || a.createdAt).getTime());
  }, [invoices, query, statusFilter]);

  function openNew() {
    const f = emptyForm();
    f.number = nextInvoiceNumber(invoices);
    setEditing(f);
    setFormError(null);
  }

  function openEdit(invoice) {
    setEditing(toFormState(invoice));
    setFormError(null);
  }

  async function markPaid(invoice) {
    await updateItem('invoices', invoice.id, {
      status: 'Paga',
      paidAt: new Date().toISOString().slice(0, 10),
    });
    await refresh();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Faturas</h1>
          <p className="page-subtitle">Emita, acompanhe e marque o pagamento das suas faturas.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          <IconPlus /> Nova fatura
        </button>
      </div>

      <div className="filters">
        <label className="search-input">
          <IconSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquise por número, cliente ou NIF."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="chip-row">
          <button type="button" className={`chip as-button${statusFilter === 'all' ? ' is-active' : ''}`} onClick={() => setStatusFilter('all')}>Todas</button>
          {STATUSES.map((s) => (
            <button key={s} type="button" className={`chip as-button${statusFilter === s ? ' is-active' : ''}`} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar faturas.</span></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true"><IconFileText /></span>
          <p className="empty-title">{invoices.length === 0 ? 'Ainda não existem faturas emitidas' : 'Sem resultados'}</p>
          <p className="empty-text">{invoices.length === 0 ? 'Comece por criar a primeira fatura para os seus clientes.' : 'Ajuste a pesquisa ou os filtros para ver mais resultados.'}</p>
          {invoices.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <IconPlus /> Emitir fatura
            </button>
          ) : null}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                <th>Emissão</th>
                <th>Vencimento</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Acções</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const display = inv.computedOverdue && inv.status !== 'Paga' ? 'Em atraso' : inv.status;
                return (
                  <tr key={inv.id}>
                    <td className="text-strong">{inv.number || inv.id.slice(0, 8)}</td>
                    <td>{inv.clientName || '—'}</td>
                    <td>{formatDate(inv.issuedAt || inv.createdAt)}</td>
                    <td>{formatDate(inv.dueAt)}</td>
                    <td>
                      <span className="status-pill" data-state={display}>
                        {iconForStatus(display)} {display || 'Sem estado'}
                      </span>
                    </td>
                    <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency(inv.total)}</td>
                    <td>
                      <div className="table-actions">
                        {inv.status !== 'Paga' ? (
                          <button type="button" className="btn btn-ghost" onClick={() => markPaid(inv)}>
                            <IconCheckCircle /> Marcar paga
                          </button>
                        ) : null}
                        <Link to={`/imprimir/${inv.id}`} className="btn btn-secondary">
                          <IconPrinter /> Imprimir
                        </Link>
                        <button type="button" className="btn btn-ghost" onClick={() => openEdit(inv)} aria-label={`Editar ${inv.number}`}>
                          <IconEdit />
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-icon"
                          aria-label={`Eliminar ${inv.number}`}
                          onClick={async () => {
                            if (typeof window === 'undefined' || window.confirm(`Eliminar a fatura ${inv.number}?`)) {
                              await deleteItem('invoices', inv.id);
                              await refresh();
                            }
                          }}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <InvoiceForm
          state={editing}
          clients={clients}
          lineItems={lineItems}
          submitting={submitting}
          error={formError}
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            setSubmitting(true);
            setFormError(null);
            try {
              const payload = buildPayload(form);
              if (!payload.clientName) throw new Error('O cliente é obrigatório.');
              if (payload.items.length === 0) throw new Error('Adicione pelo menos uma linha à fatura.');
              if (form.id) await updateItem('invoices', form.id, payload);
              else await createItem('invoices', payload);
              await refresh();
              setEditing(null);
            } catch (err) {
              setFormError(err.message || 'Não foi possível guardar a fatura.');
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function iconForStatus(status) {
  if (status === 'Paga') return <IconCheckCircle />;
  if (status === 'Em atraso') return <IconAlertCircle />;
  if (status === 'Pendente') return <IconClock />;
  return null;
}

function toFormState(invoice) {
  return {
    id: invoice.id,
    number: invoice.number || '',
    clientName: invoice.clientName || '',
    clientNif: invoice.clientNif || '',
    issuedAt: (invoice.issuedAt || '').slice(0, 10),
    dueAt: (invoice.dueAt || '').slice(0, 10),
    status: invoice.status || 'Rascunho',
    taxRate: invoice.taxRate === null || invoice.taxRate === undefined ? '23' : String(invoice.taxRate),
    notes: invoice.notes || '',
    items: Array.isArray(invoice.items) && invoice.items.length > 0
      ? invoice.items.map((it) => ({
          description: it.description || '',
          quantity: String(it.quantity ?? '1'),
          unitPrice: String(it.unitPrice ?? ''),
        }))
      : [emptyLine()],
  };
}

function buildPayload(form) {
  const items = form.items
    .map((it) => ({
      description: it.description.trim(),
      quantity: parseFloat(it.quantity) || 0,
      unitPrice: parseFloat(it.unitPrice) || 0,
    }))
    .filter((it) => it.description && it.quantity > 0);
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const taxRate = parseFloat(form.taxRate) || 0;
  const taxAmount = +((subtotal * taxRate) / 100).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);
  return {
    number: form.number.trim() || null,
    clientName: form.clientName.trim() || null,
    clientNif: form.clientNif.trim() || null,
    issuedAt: form.issuedAt || null,
    dueAt: form.dueAt || null,
    status: form.status,
    taxRate,
    taxAmount,
    subtotal: +subtotal.toFixed(2),
    total,
    currency: 'EUR',
    notes: form.notes.trim() || null,
    items,
  };
}

function InvoiceForm({ state, clients, lineItems, onClose, onSubmit, submitting, error }) {
  const [form, setForm] = useState(state);
  useEffect(() => setForm(state), [state]);

  const subtotal = form.items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0), 0);
  const taxRate = parseFloat(form.taxRate) || 0;
  const taxAmount = (subtotal * taxRate) / 100;
  const total = subtotal + taxAmount;

  function patch(line, key, value) {
    const items = form.items.map((it, idx) => (idx === line ? { ...it, [key]: value } : it));
    setForm({ ...form, items });
  }

  function addLine(template) {
    const items = [...form.items];
    if (template) {
      items.push({ description: template.description || '', quantity: '1', unitPrice: String(template.unitPrice ?? '') });
    } else {
      items.push(emptyLine());
    }
    setForm({ ...form, items });
  }

  function removeLine(idx) {
    const items = form.items.filter((_, i) => i !== idx);
    setForm({ ...form, items: items.length > 0 ? items : [emptyLine()] });
  }

  function applyClient(name) {
    const c = clients.find((cl) => cl.name === name);
    setForm({
      ...form,
      clientName: name,
      clientNif: c?.nif || form.clientNif,
    });
  }

  const isEditing = Boolean(state.id);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="invoice-form-title">
      <div className="modal" style={{ maxWidth: '720px' }}>
        <header className="modal-header row row-space-between">
          <h2 id="invoice-form-title" className="modal-title">{isEditing ? `Editar ${state.number || 'fatura'}` : 'Nova fatura'}</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}><IconClose /></button>
        </header>
        <form className="modal-body form" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Número da fatura</span>
              <input className="field-input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="FT 2026/001" />
            </label>
            <label className="field">
              <span className="field-label">Estado</span>
              <select className="field-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Cliente</span>
              <input
                className="field-input"
                value={form.clientName}
                list="clients-list"
                onChange={(e) => applyClient(e.target.value)}
                required
                placeholder="Nome do cliente"
              />
              <datalist id="clients-list">
                {clients.map((c) => <option key={c.id} value={c.name}>{c.nif ? `NIF ${c.nif}` : ''}</option>)}
              </datalist>
            </label>
            <label className="field">
              <span className="field-label">NIF</span>
              <input className="field-input" value={form.clientNif} onChange={(e) => setForm({ ...form, clientNif: e.target.value })} placeholder="000 000 000" />
            </label>
            <label className="field">
              <span className="field-label">Data de emissão</span>
              <input type="date" className="field-input" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Data de vencimento</span>
              <input type="date" className="field-input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Taxa de IVA (%)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="field-input numeric"
                value={form.taxRate}
                onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
              />
            </label>
          </div>

          <div className="stack stack-2">
            <span className="field-label">Linhas</span>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Qtd.</th>
                    <th style={{ width: 130, textAlign: 'right' }}>Preço unitário</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Total</th>
                    <th style={{ width: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((line, idx) => {
                    const lineTotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0);
                    return (
                      <tr key={idx}>
                        <td>
                          <input
                            className="field-input"
                            value={line.description}
                            onChange={(e) => patch(idx, 'description', e.target.value)}
                            placeholder="Descrição do artigo"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="field-input numeric"
                            value={line.quantity}
                            onChange={(e) => patch(idx, 'quantity', e.target.value)}
                            style={{ textAlign: 'right' }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="field-input numeric"
                            value={line.unitPrice}
                            onChange={(e) => patch(idx, 'unitPrice', e.target.value)}
                            style={{ textAlign: 'right' }}
                          />
                        </td>
                        <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency(lineTotal)}</td>
                        <td>
                          <button type="button" className="btn btn-ghost btn-icon" aria-label="Remover linha" onClick={() => removeLine(idx)}>
                            <IconClose />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row row-2" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => addLine()}>
                <IconPlus /> Adicionar linha em branco
              </button>
              {lineItems.length > 0 ? (
                <details className="card" style={{ padding: 'var(--space-3, 0.75rem) var(--space-4, 1rem)' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm, 0.875rem)' }}>Artigos guardados</summary>
                  <div className="chip-row" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
                    {lineItems.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        className="chip as-button"
                        onClick={() => addLine(tpl)}
                      >
                        {tpl.description || tpl.code}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </div>

          <div className="row row-space-between" style={{ borderTop: '1px solid var(--color-border, #E2E8F0)', paddingTop: 'var(--space-3, 0.75rem)' }}>
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">Notas</span>
              <textarea className="field-textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <div className="stack stack-2" style={{ minWidth: 220, alignItems: 'flex-end' }}>
              <div className="row row-space-between" style={{ width: '100%' }}><span className="text-muted text-small">Subtotal</span><span className="numeric">{formatCurrency(subtotal)}</span></div>
              <div className="row row-space-between" style={{ width: '100%' }}><span className="text-muted text-small">IVA ({taxRate}%)</span><span className="numeric">{formatCurrency(taxAmount)}</span></div>
              <div className="row row-space-between" style={{ width: '100%' }}><span className="text-strong">Total</span><span className="numeric text-strong">{formatCurrency(total)}</span></div>
            </div>
          </div>

          {error ? <p className="text-small" style={{ color: 'var(--color-danger, #DC2626)', margin: 0 }}>{error}</p> : null}

          <footer className="modal-footer" style={{ marginLeft: 'calc(-1 * var(--space-6, 1.5rem))', marginRight: 'calc(-1 * var(--space-6, 1.5rem))', marginBottom: 'calc(-1 * var(--space-6, 1.5rem))', marginTop: 'var(--space-6, 1.5rem)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'A guardar.' : isEditing ? 'Guardar alterações' : 'Emitir fatura'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
