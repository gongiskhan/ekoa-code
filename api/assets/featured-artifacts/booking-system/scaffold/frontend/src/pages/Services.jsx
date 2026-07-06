import { useState } from 'react';
import { useData } from '../components/useData';
import { Loading, ErrorBlock, EmptyState } from '../components/States';
import { createItem, updateItem, deleteItem } from '../components/api';
import { formatEUR, formatDuration } from '../components/format';

export default function ServicesPage() {
  const { items, loading, error, reload } = useData('services');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(payload) {
    setBusy(true);
    try {
      if (modal.mode === 'edit') {
        await updateItem('services', modal.initial.id, payload);
      } else {
        await createItem('services', payload);
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
    if (!confirm('Remover este serviço? As marcações existentes mantêm o nome registado.')) return;
    setBusy(true);
    try {
      await deleteItem('services', id);
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
          <h1 className="page-title">Serviços</h1>
          <div className="page-subtitle">Catálogo de serviços com preço e duração padrão.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
          Adicionar serviço
        </button>
      </div>

      {loading && <Loading />}
      {!loading && error && <ErrorBlock error={error} onRetry={reload} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="Sem serviços no catálogo"
          text="Crie o primeiro serviço (com preço e duração) para começar a receber marcações."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
              Criar primeiro serviço
            </button>
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="tile-grid">
          {items.map((s) => (
            <div key={s.id} className="tile">
              <div className="tile-title">{s.name}</div>
              <div className="tile-meta">{formatDuration(s.duration)} · {formatEUR(s.price)}</div>
              {s.description && (
                <div style={{ fontSize: 'var(--text-sm, 0.875rem)', color: 'var(--color-text-muted, #475569)' }}>
                  {s.description}
                </div>
              )}
              <div className="tile-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setModal({ mode: 'edit', initial: s })}>
                  Editar
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => handleDelete(s.id)} aria-label="Remover">
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
            <h2 className="modal-title">{modal.mode === 'edit' ? 'Editar serviço' : 'Novo serviço'}</h2>
            <ServiceForm
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

function ServiceForm({ initial, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    duration: String(initial?.duration ?? 60),
    price: String(initial?.price ?? '0'),
    description: initial?.description || '',
    active: initial?.active !== false,
  }));

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handle(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(),
      duration: parseInt(form.duration, 10) || 60,
      price: parseFloat(form.price) || 0,
      description: form.description.trim() || null,
      active: form.active,
    });
  }

  return (
    <form className="form" onSubmit={handle}>
      <div className="field">
        <label className="field-label" htmlFor="s-name">Nome do serviço</label>
        <input
          id="s-name"
          className="field-input"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="Ex.: Consulta inicial"
          required
          autoFocus
        />
      </div>
      <div className="form-row">
        <div className="field">
          <label className="field-label" htmlFor="s-dur">Duração (minutos)</label>
          <input
            id="s-dur"
            className="field-input"
            type="number"
            min="5"
            step="5"
            value={form.duration}
            onChange={(e) => update('duration', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="s-price">Preço (EUR)</label>
          <input
            id="s-price"
            className="field-input"
            type="number"
            step="0.01"
            min="0"
            value={form.price}
            onChange={(e) => update('price', e.target.value)}
            required
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="s-desc">Descrição</label>
        <textarea
          id="s-desc"
          className="field-textarea"
          rows="2"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="Descrição opcional para apresentar aos clientes"
        />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {initial ? 'Guardar alterações' : 'Adicionar serviço'}
        </button>
      </div>
    </form>
  );
}
