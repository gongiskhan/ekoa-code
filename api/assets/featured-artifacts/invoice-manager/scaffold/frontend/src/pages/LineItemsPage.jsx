import { useEffect, useMemo, useState } from 'react';
import { useCollection, createItem, updateItem, deleteItem, formatCurrency } from '../components/data.js';
import { IconClose, IconEdit, IconList, IconPlus, IconSearch, IconTrash } from '../components/Icons.jsx';

const EMPTY = { code: '', description: '', unitPrice: '', category: '' };

export default function LineItemsPage() {
  const { items, loading, refresh } = useCollection('lineItems');
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items
      .filter((it) => {
        if (!term) return true;
        return (
          (it.description || '').toLowerCase().includes(term) ||
          (it.code || '').toLowerCase().includes(term) ||
          (it.category || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => (a.description || '').localeCompare(b.description || '', 'pt-PT'));
  }, [items, query]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Artigos faturáveis</h1>
          <p className="page-subtitle">Mantenha uma biblioteca de artigos e serviços para reutilizar nas suas faturas.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY }); setFormError(null); }}>
          <IconPlus /> Novo artigo
        </button>
      </div>

      <div className="filters">
        <label className="search-input">
          <IconSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquise por código, descrição ou categoria."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar artigos.</span></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true"><IconList /></span>
          <p className="empty-title">{items.length === 0 ? 'Sem artigos guardados' : 'Sem resultados'}</p>
          <p className="empty-text">{items.length === 0 ? 'Crie modelos para os serviços que costuma faturar — depois bastam dois cliques para os adicionar a uma fatura.' : 'Ajuste a pesquisa para ver mais resultados.'}</p>
          {items.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>
              <IconPlus /> Adicionar artigo
            </button>
          ) : null}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th style={{ textAlign: 'right' }}>Preço unitário</th>
                <th style={{ textAlign: 'right' }}>Acções</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id}>
                  <td className="text-strong">{it.code || '—'}</td>
                  <td>{it.description || '—'}</td>
                  <td>{it.category || 'Sem categoria'}</td>
                  <td className="numeric" style={{ textAlign: 'right' }}>{formatCurrency(it.unitPrice)}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => { setEditing(toFormState(it)); setFormError(null); }}>
                        <IconEdit /> Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-icon"
                        aria-label="Eliminar artigo"
                        onClick={async () => {
                          if (typeof window === 'undefined' || window.confirm('Eliminar este artigo?')) {
                            await deleteItem('lineItems', it.id);
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
        <LineItemForm
          state={editing}
          submitting={submitting}
          error={formError}
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            setSubmitting(true);
            setFormError(null);
            try {
              const payload = {
                code: form.code.trim() || null,
                description: form.description.trim(),
                unitPrice: parseFloat(form.unitPrice) || 0,
                category: form.category.trim() || null,
              };
              if (!payload.description) throw new Error('A descrição é obrigatória.');
              if (form.id) await updateItem('lineItems', form.id, payload);
              else await createItem('lineItems', payload);
              await refresh();
              setEditing(null);
            } catch (err) {
              setFormError(err.message || 'Não foi possível guardar o artigo.');
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function toFormState(it) {
  return {
    id: it.id,
    code: it.code || '',
    description: it.description || '',
    unitPrice: it.unitPrice === null || it.unitPrice === undefined ? '' : String(it.unitPrice),
    category: it.category || '',
  };
}

function LineItemForm({ state, onClose, onSubmit, submitting, error }) {
  const [form, setForm] = useState(state);
  useEffect(() => setForm(state), [state]);

  const isEditing = Boolean(state.id);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="line-form-title">
      <div className="modal">
        <header className="modal-header row row-space-between">
          <h2 id="line-form-title" className="modal-title">{isEditing ? 'Editar artigo' : 'Novo artigo'}</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}><IconClose /></button>
        </header>
        <form className="modal-body form" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Código</span>
              <input className="field-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CONS-MARCA-1" />
            </label>
            <label className="field">
              <span className="field-label">Categoria</span>
              <input className="field-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Consultoria" />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span className="field-label">Descrição</span>
              <input className="field-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            </label>
            <label className="field">
              <span className="field-label">Preço unitário (EUR)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="field-input numeric"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
              />
            </label>
          </div>
          {error ? <p className="text-small" style={{ color: 'var(--color-danger, #DC2626)', margin: 0 }}>{error}</p> : null}
          <footer className="modal-footer" style={{ marginLeft: 'calc(-1 * var(--space-6, 1.5rem))', marginRight: 'calc(-1 * var(--space-6, 1.5rem))', marginBottom: 'calc(-1 * var(--space-6, 1.5rem))', marginTop: 'var(--space-6, 1.5rem)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'A guardar.' : isEditing ? 'Guardar alterações' : 'Adicionar artigo'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
