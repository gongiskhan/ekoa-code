import { useMemo, useState } from 'react';
import { useAllData } from '../components/useData';
import { Loading, ErrorBlock, EmptyState } from '../components/States';
import { createItem, updateItem, deleteItem } from '../components/api';
import BookingForm from '../components/BookingForm';
import { formatShortDate, formatEUR, formatDuration } from '../components/format';

const STATUS_LABEL = {
  confirmed: 'Confirmada',
  pending: 'Pendente',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

const STATUS_BADGE = {
  confirmed: 'badge-info',
  pending: 'badge-warning',
  completed: 'badge-success',
  cancelled: 'badge-danger',
};

export default function BookingsPage() {
  const { data, loading, error, reload } = useAllData(['bookings', 'services', 'customers']);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');

  const bookings = data.bookings || [];
  const services = data.services || [];
  const customers = data.customers || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings
      .filter((b) => filterStatus === 'all' || b.status === filterStatus)
      .filter((b) =>
        !q ||
        (b.customerName || '').toLowerCase().includes(q) ||
        (b.serviceName || '').toLowerCase().includes(q) ||
        (b.notes || '').toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
        if (dateCmp !== 0) return dateCmp;
        return String(b.time || '').localeCompare(String(a.time || ''));
      });
  }, [bookings, filterStatus, search]);

  async function handleCreate(payload) {
    setBusy(true);
    try {
      await createItem('bookings', payload);
      setModal(null);
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(payload) {
    setBusy(true);
    try {
      await updateItem('bookings', modal.initial.id, payload);
      setModal(null);
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remover esta marcação definitivamente?')) return;
    setBusy(true);
    try {
      await deleteItem('bookings', id);
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(b, next) {
    setBusy(true);
    try {
      await updateItem('bookings', b.id, { status: next });
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
          <h1 className="page-title">Marcações</h1>
          <div className="page-subtitle">Lista completa de reservas com filtros e gestão rápida de estado.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nova marcação
        </button>
      </div>

      <div className="toolbar">
        <div className="field">
          <label className="field-label" htmlFor="m-search">Pesquisar</label>
          <input
            id="m-search"
            className="field-input"
            placeholder="Cliente, serviço ou notas"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="m-status">Estado</label>
          <select id="m-status" className="field-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">Todos</option>
            <option value="confirmed">Confirmadas</option>
            <option value="pending">Pendentes</option>
            <option value="completed">Concluídas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </div>
      </div>

      {loading && <Loading />}
      {!loading && error && <ErrorBlock error={error} onRetry={reload} />}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          title={bookings.length === 0 ? 'Sem marcações' : 'Nenhuma marcação corresponde aos filtros'}
          text={bookings.length === 0
            ? 'Crie a primeira marcação para começar a gerir a agenda.'
            : 'Ajuste o filtro ou a pesquisa para ver outras marcações.'}
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Hora</th>
                <th>Cliente</th>
                <th>Serviço</th>
                <th>Duração</th>
                <th className="num" style={{ textAlign: 'right' }}>Preço</th>
                <th>Estado</th>
                <th aria-label="Ações" style={{ width: 200, textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatShortDate(b.date)}</td>
                  <td style={{ fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' }}>{(b.time || '').slice(0, 5)}</td>
                  <td style={{ fontWeight: 500 }}>{b.customerName || '—'}</td>
                  <td>{b.serviceName || '—'}</td>
                  <td>{formatDuration(b.duration)}</td>
                  <td className="num">{b.price != null ? formatEUR(b.price) : '—'}</td>
                  <td>
                    <span className={'badge ' + (STATUS_BADGE[b.status] || 'badge-info')}>
                      {STATUS_LABEL[b.status] || 'Confirmada'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {b.status === 'pending' && (
                      <button className="btn btn-ghost" onClick={() => changeStatus(b, 'confirmed')} aria-label="Confirmar">
                        Confirmar
                      </button>
                    )}
                    {(b.status === 'confirmed' || b.status === 'pending') && (
                      <button className="btn btn-ghost" onClick={() => changeStatus(b, 'completed')} aria-label="Concluir">
                        Concluir
                      </button>
                    )}
                    <button className="btn btn-ghost" onClick={() => setModal({ mode: 'edit', initial: b })} aria-label="Editar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button className="btn btn-ghost" onClick={() => handleDelete(b.id)} aria-label="Remover">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setModal(null)} role="dialog" aria-modal="true">
          <div className="modal">
            <h2 className="modal-title">{modal.mode === 'edit' ? 'Editar marcação' : 'Nova marcação'}</h2>
            <BookingForm
              initial={modal.initial}
              services={services}
              customers={customers}
              onSubmit={modal.mode === 'edit' ? handleUpdate : handleCreate}
              onCancel={() => setModal(null)}
              busy={busy}
            />
          </div>
        </div>
      )}
    </div>
  );
}
