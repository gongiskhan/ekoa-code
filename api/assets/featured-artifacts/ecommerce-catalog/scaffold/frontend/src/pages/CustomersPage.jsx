import { useEffect, useMemo, useState } from 'react';
import { useCollection, createItem, updateItem, deleteItem, formatCurrency } from '../components/data.js';
import { IconClose, IconEdit, IconMail, IconPhone, IconPlus, IconSearch, IconTrash, IconUserCircle, IconUsers } from '../components/Icons.jsx';

const EMPTY_FORM = { name: '', email: '', phone: '', city: '', notes: '' };

export default function CustomersPage() {
  const { items: customers, loading, refresh } = useCollection('customers');
  const { items: orders } = useCollection('orders');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const enriched = useMemo(() => {
    return customers
      .map((c) => {
        const customerOrders = orders.filter((o) => (o.customerName || '').toLowerCase() === (c.name || '').toLowerCase() && o.status !== 'Cancelado');
        const totalSpent = customerOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
        return { ...c, ordersCount: customerOrders.length, totalSpent };
      })
      .filter((c) => {
        const term = query.trim().toLowerCase();
        if (!term) return true;
        return (
          (c.name || '').toLowerCase().includes(term) ||
          (c.email || '').toLowerCase().includes(term) ||
          (c.city || '').toLowerCase().includes(term)
        );
      });
  }, [customers, orders, query]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">Tenha o histórico de cada cliente sempre à mão.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY_FORM }); setFormError(null); }}>
          <IconPlus /> Novo cliente
        </button>
      </div>

      <div className="filters">
        <label className="search-input">
          <IconSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquise por nome, email ou cidade."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar clientes.</span></div>
      ) : enriched.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true"><IconUsers /></span>
          <p className="empty-title">{customers.length === 0 ? 'Ainda não tem clientes registados' : 'Sem resultados'}</p>
          <p className="empty-text">{customers.length === 0 ? 'Comece por adicionar o seu primeiro cliente para guardar o histórico de encomendas.' : 'Tente uma pesquisa diferente.'}</p>
          {customers.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_FORM })}>
              <IconPlus /> Adicionar cliente
            </button>
          ) : null}
        </div>
      ) : (
        <div className="stack stack-3">
          {enriched.map((customer) => (
            <article key={customer.id} className="card row row-space-between" style={{ flexWrap: 'wrap', gap: 'var(--space-4, 1rem)' }}>
              <div className="row row-4" style={{ alignItems: 'flex-start' }}>
                <span className="empty-icon" aria-hidden="true" style={{ width: 42, height: 42, color: 'var(--color-primary, #0F766E)', background: 'var(--color-surface-muted, #F1F5F9)' }}>
                  <IconUserCircle />
                </span>
                <div className="stack stack-2">
                  <div>
                    <h3 style={{ margin: 0, fontSize: 'var(--text-base, 0.9375rem)', fontWeight: 600 }}>{customer.name || 'Sem nome'}</h3>
                    <p className="text-xs text-subtle" style={{ margin: 0 }}>{customer.city || 'Sem cidade'}</p>
                  </div>
                  <div className="row row-3 text-small text-muted" style={{ flexWrap: 'wrap' }}>
                    {customer.email ? <span className="row row-2"><IconMail /> {customer.email}</span> : null}
                    {customer.phone ? <span className="row row-2"><IconPhone /> {customer.phone}</span> : null}
                  </div>
                  {customer.notes ? <p className="text-small text-muted" style={{ margin: 0 }}>{customer.notes}</p> : null}
                </div>
              </div>
              <div className="stack stack-2" style={{ alignItems: 'flex-end' }}>
                <div className="row row-3">
                  <Tally label="Encomendas" value={customer.ordersCount} />
                  <Tally label="Total facturado" value={formatCurrency(customer.totalSpent)} mono />
                </div>
                <div className="row row-2">
                  <button type="button" className="btn btn-secondary" onClick={() => { setEditing(toFormState(customer)); setFormError(null); }}>
                    <IconEdit /> Editar
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-icon"
                    aria-label={`Remover ${customer.name}`}
                    onClick={async () => {
                      if (typeof window === 'undefined' || window.confirm(`Remover "${customer.name}" dos clientes?`)) {
                        await deleteItem('customers', customer.id);
                        await refresh();
                      }
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <CustomerForm
          state={editing}
          submitting={submitting}
          error={formError}
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            setSubmitting(true);
            setFormError(null);
            try {
              const payload = {
                name: form.name.trim(),
                email: form.email.trim() || null,
                phone: form.phone.trim() || null,
                city: form.city.trim() || null,
                notes: form.notes.trim() || null,
              };
              if (!payload.name) throw new Error('O nome do cliente é obrigatório.');
              if (form.id) {
                await updateItem('customers', form.id, payload);
              } else {
                await createItem('customers', payload);
              }
              await refresh();
              setEditing(null);
            } catch (err) {
              setFormError(err.message || 'Não foi possível guardar o cliente.');
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function Tally({ label, value, mono }) {
  return (
    <div className="stack stack-2" style={{ alignItems: 'flex-end' }}>
      <span className="text-xs text-subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span className={mono ? 'numeric text-strong' : 'text-strong'} style={{ fontSize: 'var(--text-base, 0.9375rem)' }}>{value}</span>
    </div>
  );
}

function toFormState(customer) {
  return {
    id: customer.id,
    name: customer.name || '',
    email: customer.email || '',
    phone: customer.phone || '',
    city: customer.city || '',
    notes: customer.notes || '',
  };
}

function CustomerForm({ state, onClose, onSubmit, submitting, error }) {
  const [form, setForm] = useState(state);
  useEffect(() => setForm(state), [state]);

  const isEditing = Boolean(state.id);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
      <div className="modal">
        <header className="modal-header row row-space-between">
          <h2 id="customer-form-title" className="modal-title">{isEditing ? 'Editar cliente' : 'Novo cliente'}</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}><IconClose /></button>
        </header>
        <form
          className="modal-body form"
          onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
        >
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Nome</span>
              <input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" className="field-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Telefone</span>
              <input className="field-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Cidade</span>
              <input className="field-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Notas</span>
            <textarea className="field-textarea" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          {error ? <p className="text-small" style={{ color: 'var(--color-danger, #DC2626)', margin: 0 }}>{error}</p> : null}
          <footer className="modal-footer" style={{ marginLeft: 'calc(-1 * var(--space-6, 1.5rem))', marginRight: 'calc(-1 * var(--space-6, 1.5rem))', marginBottom: 'calc(-1 * var(--space-6, 1.5rem))', marginTop: 'var(--space-6, 1.5rem)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'A guardar.' : isEditing ? 'Guardar alterações' : 'Adicionar cliente'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
