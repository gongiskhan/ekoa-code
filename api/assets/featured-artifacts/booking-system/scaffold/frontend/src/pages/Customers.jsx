import { useState } from 'react';
import { useData } from '../components/useData';
import { Loading, ErrorBlock, EmptyState } from '../components/States';
import { createItem, updateItem, deleteItem } from '../components/api';

export default function CustomersPage() {
  const { items, loading, error, reload } = useData('customers');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = items.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    );
  });

  async function handleSubmit(payload) {
    setBusy(true);
    try {
      if (modal.mode === 'edit') {
        await updateItem('customers', modal.initial.id, payload);
      } else {
        await createItem('customers', payload);
      }
      setModal(null);
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remover este cliente? As marcações existentes mantêm o nome registado.')) return;
    setBusy(true);
    try {
      await deleteItem('customers', id);
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <div className="page-subtitle">Diretório de clientes para acelerar a criação de marcações.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
          Adicionar cliente
        </button>
      </div>

      <div className="toolbar">
        <div className="field" style={{ flex: 1, maxWidth: 360 }}>
          <label className="field-label" htmlFor="c-search">Pesquisar</label>
          <input
            id="c-search"
            className="field-input"
            placeholder="Nome, email ou telemóvel"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading && <Loading />}
      {!loading && error && <ErrorBlock error={error} onRetry={reload} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState title="Sem clientes registados" text="Adicione clientes para os encontrar rapidamente nas marcações." />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="tile-grid">
          {filtered.map((c) => (
            <div key={c.id} className="tile">
              <div className="tile-title">{c.name}</div>
              <div className="tile-meta">
                {c.email && <div>{c.email}</div>}
                {c.phone && <div style={{ fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' }}>{c.phone}</div>}
              </div>
              {c.notes && (
                <div style={{ fontSize: 'var(--text-sm, 0.875rem)', color: 'var(--color-text-muted, #475569)' }}>
                  {c.notes}
                </div>
              )}
              <div className="tile-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setModal({ mode: 'edit', initial: c })}>
                  Editar
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => handleDelete(c.id)}>
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setModal(null)} role="dialog" aria-modal="true">
          <div className="modal">
            <h2 className="modal-title">{modal.mode === 'edit' ? 'Editar cliente' : 'Novo cliente'}</h2>
            <CustomerForm
              initial={modal.initial}
              onSubmit={handleSubmit}
              onCancel={() => setModal(null)}
              busy={busy}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerForm({ initial, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    notes: initial?.notes || '',
  }));

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handle(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <form className="form" onSubmit={handle}>
      <div className="field">
        <label className="field-label" htmlFor="c-name">Nome</label>
        <input
          id="c-name"
          className="field-input"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="form-row">
        <div className="field">
          <label className="field-label" htmlFor="c-email">Email</label>
          <input
            id="c-email"
            className="field-input"
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            placeholder="nome@exemplo.pt"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="c-phone">Telemóvel</label>
          <input
            id="c-phone"
            className="field-input"
            type="tel"
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="+351 9XX XXX XXX"
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="c-notes">Notas</label>
        <textarea
          id="c-notes"
          className="field-textarea"
          rows="2"
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          placeholder="Preferências, histórico relevante, etc."
        />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {initial ? 'Guardar alterações' : 'Adicionar cliente'}
        </button>
      </div>
    </form>
  );
}
