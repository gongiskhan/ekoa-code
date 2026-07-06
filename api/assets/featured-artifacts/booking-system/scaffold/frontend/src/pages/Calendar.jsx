import { useMemo, useState } from 'react';
import { useAllData } from '../components/useData';
import { Loading, ErrorBlock } from '../components/States';
import CalendarGrid from '../components/CalendarGrid';
import BookingForm from '../components/BookingForm';
import { createItem, updateItem, deleteItem } from '../components/api';
import { formatLongDate, formatEUR, formatDuration, parseYMD, toYMD } from '../components/format';

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

export default function CalendarPage() {
  const { data, loading, error, reload } = useAllData(['bookings', 'services', 'customers']);
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedYMD, setSelectedYMD] = useState(() => toYMD(new Date()));
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  const bookings = data.bookings || [];
  const services = data.services || [];
  const customers = data.customers || [];

  const bookingsByDate = useMemo(() => {
    const map = {};
    for (const b of bookings) {
      if (!b.date) continue;
      (map[b.date] = map[b.date] || []).push(b);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }
    return map;
  }, [bookings]);

  const selectedDayBookings = bookingsByDate[selectedYMD] || [];

  function shiftMonth(delta) {
    setCursor((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

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
    if (!confirm('Tem a certeza de que pretende remover esta marcação?')) return;
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

  async function quickCancel(b) {
    setBusy(true);
    try {
      await updateItem('bookings', b.id, { status: 'cancelled' });
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
          <h1 className="page-title">Calendário</h1>
          <div className="page-subtitle">Visualize as marcações da semana e do mês e crie novas reservas.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nova marcação
        </button>
      </div>

      {loading && <Loading />}
      {!loading && error && <ErrorBlock error={error} onRetry={reload} />}

      {!loading && !error && (
        <div className="calendar-layout">
          <div>
            <CalendarGrid
              cursor={cursor}
              selectedYMD={selectedYMD}
              bookingsByDate={bookingsByDate}
              onSelectDate={setSelectedYMD}
              onPrev={() => shiftMonth(-1)}
              onNext={() => shiftMonth(1)}
              onToday={() => {
                const t = new Date();
                setCursor(t);
                setSelectedYMD(toYMD(t));
              }}
            />
          </div>

          <aside className="day-panel" aria-label="Detalhes do dia seleccionado">
            <div className="day-panel-title">{formatLongDate(parseYMD(selectedYMD))}</div>

            {selectedDayBookings.length === 0 ? (
              <div className="day-panel-empty">Sem marcações neste dia.</div>
            ) : (
              selectedDayBookings.map((b) => (
                <div key={b.id} className={'booking-card ' + (b.status || 'confirmed')}>
                  <div className="booking-time">{(b.time || '').slice(0, 5)} · {formatDuration(b.duration)}</div>
                  <div className="booking-svc">{b.serviceName || 'Serviço não definido'}</div>
                  <div className="booking-customer">{b.customerName || 'Cliente não registado'}</div>
                  {b.notes && (
                    <div style={{ fontSize: 'var(--text-xs, 0.75rem)', color: 'var(--color-text-subtle, #64748B)', marginTop: 'var(--space-1, 0.25rem)' }}>
                      {b.notes}
                    </div>
                  )}
                  <div className="booking-meta">
                    <span className={'badge ' + (STATUS_BADGE[b.status] || 'badge-info')}>
                      {STATUS_LABEL[b.status] || 'Confirmada'}
                    </span>
                    <span>{b.price != null ? formatEUR(b.price) : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-1, 0.25rem)', marginTop: 'var(--space-2, 0.5rem)' }}>
                    <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModal({ mode: 'edit', initial: b })}>
                      Editar
                    </button>
                    {b.status !== 'cancelled' && (
                      <button type="button" className="btn btn-ghost" onClick={() => quickCancel(b)} disabled={busy}>
                        Cancelar
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost" onClick={() => handleDelete(b.id)} aria-label="Remover">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}

            <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
              Adicionar marcação a este dia
            </button>
          </aside>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setModal(null)} role="dialog" aria-modal="true">
          <div className="modal">
            <h2 className="modal-title">{modal.mode === 'edit' ? 'Editar marcação' : 'Nova marcação'}</h2>
            <BookingForm
              initial={modal.initial}
              defaultDate={selectedYMD}
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
