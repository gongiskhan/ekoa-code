import { useEffect, useMemo, useState } from 'react';
import { useCollection, createItem, updateItem, deleteItem, formatCurrency } from '../components/data.js';
import { IconClose, IconEdit, IconMail, IconPhone, IconPlus, IconSearch, IconTrash, IconUserCircle, IconUsers } from '../components/Icons.jsx';

const EMPTY = {
  name: '',
  contactPerson: '',
  email: '',
  phone: '',
  address: '',
  nif: '',
  notes: '',
};

export default function ClientsPage() {
  const { items: clients, loading, refresh } = useCollection('clients');
  const { items: invoices } = useCollection('invoices');
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [query, setQuery] = useState('');

  const enriched = useMemo(() => {
    return clients
      .map((c) => {
        const inv = invoices.filter((i) => i.clientName === c.name);
        const billed = inv.reduce((s, i) => s + (Number(i.total) || 0), 0);
        const outstanding = inv
          .filter((i) => i.status !== 'Paga')
          .reduce((s, i) => s + (Number(i.total) || 0), 0);
        return { ...c, invoicesCount: inv.length, billed, outstanding };
      })
      .filter((c) => {
        const term = query.trim().toLowerCase();
        if (!term) return true;
        return (
          (c.name || '').toLowerCase().includes(term) ||
          (c.nif || '').toLowerCase().includes(term) ||
          (c.email || '').toLowerCase().includes(term)
        );
      });
  }, [clients, invoices, query]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">O cadastro central das entidades para as quais emite faturas.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY }); setFormError(null); }}>
          <IconPlus /> Novo cliente
        </button>
      </div>

      <div className="filters">
        <label className="search-input">
          <IconSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquise por nome, NIF ou email."
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
          <p className="empty-title">{clients.length === 0 ? 'Sem clientes registados' : 'Sem resultados'}</p>
          <p className="empty-text">{clients.length === 0 ? 'Cadastre o seu primeiro cliente para começar a emitir faturas.' : 'Ajuste a pesquisa para ver mais resultados.'}</p>
          {clients.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>
              <IconPlus /> Adicionar cliente
            </button>
          ) : null}
        </div>
      ) : (
        <div className="stack stack-3">
          {enriched.map((c) => (
            <article key={c.id} className="card row row-space-between" style={{ flexWrap: 'wrap', gap: 'var(--space-4, 1rem)' }}>
              <div className="row row-4" style={{ alignItems: 'flex-start' }}>
                <span className="empty-icon" aria-hidden="true" style={{ width: 42, height: 42, color: 'var(--color-primary, #0F766E)', background: 'var(--color-surface-muted, #F1F5F9)' }}>
                  <IconUserCircle />
                </span>
                <div className="stack stack-2">
                  <div>
                    <h3 style={{ margin: 0, fontSize: 'var(--text-base, 0.9375rem)', fontWeight: 600 }}>{c.name || 'Sem nome'}</h3>
                    {c.contactPerson ? <p className="text-xs text-subtle" style={{ margin: 0 }}>Contacto: {c.contactPerson}</p> : null}
                  </div>
                  <div className="row row-3 text-small text-muted" style={{ flexWrap: 'wrap' }}>
                    {c.nif ? <span>NIF {c.nif}</span> : null}
                    {c.email ? <span className="row row-2"><IconMail /> {c.email}</span> : null}
                    {c.phone ? <span className="row row-2"><IconPhone /> {c.phone}</span> : null}
                  </div>
                  {c.address ? <p className="text-small text-muted" style={{ margin: 0 }}>{c.address}</p> : null}
                  {c.notes ? <p className="text-small text-subtle" style={{ margin: 0 }}>{c.notes}</p> : null}
                </div>
              </div>
              <div className="stack stack-2" style={{ alignItems: 'flex-end' }}>
                <div className="row row-3">
                  <Tally label="Faturas" value={c.invoicesCount} />
                  <Tally label="Total facturado" value={formatCurrency(c.billed)} mono />
                  <Tally label="Em aberto" value={formatCurrency(c.outstanding)} mono warning={c.outstanding > 0} />
                </div>
                <div className="row row-2">
                  <button type="button" className="btn btn-secondary" onClick={() => { setEditing(toFormState(c)); setFormError(null); }}>
                    <IconEdit /> Editar
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-icon"
                    aria-label={`Remover ${c.name}`}
                    onClick={async () => {
                      if (typeof window === 'undefined' || window.confirm(`Remover "${c.name}" dos clientes?`)) {
                        await deleteItem('clients', c.id);
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
        <ClientForm
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
                contactPerson: form.contactPerson.trim() || null,
                email: form.email.trim() || null,
                phone: form.phone.trim() || null,
                address: form.address.trim() || null,
                nif: form.nif.trim() || null,
                notes: form.notes.trim() || null,
              };
              if (!payload.name) throw new Error('O nome do cliente é obrigatório.');
              if (form.id) await updateItem('clients', form.id, payload);
              else await createItem('clients', payload);
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

function Tally({ label, value, mono, warning }) {
  const valueStyle = mono ? { fontVariantNumeric: 'tabular-nums' } : {};
  if (warning) valueStyle.color = 'var(--color-danger, #DC2626)';
  return (
    <div className="stack stack-2" style={{ alignItems: 'flex-end' }}>
      <span className="text-xs text-subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span className="text-strong" style={{ fontSize: 'var(--text-base, 0.9375rem)', ...valueStyle }}>{value}</span>
    </div>
  );
}

function toFormState(c) {
  return {
    id: c.id,
    name: c.name || '',
    contactPerson: c.contactPerson || '',
    email: c.email || '',
    phone: c.phone || '',
    address: c.address || '',
    nif: c.nif || '',
    notes: c.notes || '',
  };
}

function ClientForm({ state, onClose, onSubmit, submitting, error }) {
  const [form, setForm] = useState(state);
  useEffect(() => setForm(state), [state]);

  const isEditing = Boolean(state.id);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="client-form-title">
      <div className="modal">
        <header className="modal-header row row-space-between">
          <h2 id="client-form-title" className="modal-title">{isEditing ? 'Editar cliente' : 'Novo cliente'}</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}><IconClose /></button>
        </header>
        <form className="modal-body form" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Razão social</span>
              <input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="field">
              <span className="field-label">Pessoa de contacto</span>
              <input className="field-input" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">NIF / VAT</span>
              <input className="field-input" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} placeholder="000 000 000" />
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
              <span className="field-label">Morada</span>
              <input className="field-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
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
