import { useEffect, useMemo, useState } from 'react';
import { useData } from '../components/useData';
import { Loading, ErrorBlock } from '../components/States';
import { createItem, updateItem, deleteItem } from '../components/api';

const DAYS = [
  { value: 'mon', label: 'Segunda-feira' },
  { value: 'tue', label: 'Terça-feira' },
  { value: 'wed', label: 'Quarta-feira' },
  { value: 'thu', label: 'Quinta-feira' },
  { value: 'fri', label: 'Sexta-feira' },
  { value: 'sat', label: 'Sábado' },
  { value: 'sun', label: 'Domingo' },
];

const DEFAULT_OPEN = '09:00';
const DEFAULT_CLOSE = '18:00';

export default function AvailabilityPage() {
  const { items, loading, error, reload } = useData('availability');
  const [drafts, setDrafts] = useState({});
  const [savingDay, setSavingDay] = useState(null);

  const byDay = useMemo(() => {
    const map = {};
    for (const a of items) {
      if (a.day) map[a.day] = a;
    }
    return map;
  }, [items]);

  useEffect(() => {
    const next = {};
    for (const d of DAYS) {
      const row = byDay[d.value];
      next[d.value] = {
        open: row?.open || DEFAULT_OPEN,
        close: row?.close || DEFAULT_CLOSE,
        active: row?.active !== false && !!row,
      };
    }
    setDrafts(next);
  }, [byDay]);

  async function toggleDay(day, active) {
    setSavingDay(day);
    try {
      const existing = byDay[day];
      const draft = drafts[day] || {};
      if (existing) {
        await updateItem('availability', existing.id, {
          active,
          open: draft.open || DEFAULT_OPEN,
          close: draft.close || DEFAULT_CLOSE,
        });
      } else if (active) {
        await createItem('availability', {
          day,
          active: true,
          open: draft.open || DEFAULT_OPEN,
          close: draft.close || DEFAULT_CLOSE,
        });
      }
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingDay(null);
    }
  }

  async function saveDay(day) {
    setSavingDay(day);
    try {
      const draft = drafts[day];
      const existing = byDay[day];
      const payload = { day, active: draft.active, open: draft.open, close: draft.close };
      if (existing) {
        await updateItem('availability', existing.id, payload);
      } else {
        await createItem('availability', payload);
      }
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingDay(null);
    }
  }

  function updateDraft(day, patch) {
    setDrafts((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Disponibilidade</h1>
          <div className="page-subtitle">Defina os horários de atendimento para cada dia da semana.</div>
        </div>
      </div>

      {loading && <Loading />}
      {!loading && error && <ErrorBlock error={error} onRetry={reload} />}

      {!loading && !error && (
        <div className="avail-grid">
          {DAYS.map((d) => {
            const draft = drafts[d.value] || { open: DEFAULT_OPEN, close: DEFAULT_CLOSE, active: false };
            const existing = byDay[d.value];
            const dirty =
              existing &&
              (draft.open !== (existing.open || DEFAULT_OPEN) ||
                draft.close !== (existing.close || DEFAULT_CLOSE) ||
                draft.active !== (existing.active !== false));
            return (
              <div key={d.value} className="avail-row">
                <div className="avail-day-label">{d.label}</div>
                <div className="avail-times">
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2, 0.5rem)', fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}>
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => {
                        updateDraft(d.value, { active: e.target.checked });
                        toggleDay(d.value, e.target.checked);
                      }}
                      disabled={savingDay === d.value}
                    />
                    {draft.active ? 'Aberto' : 'Encerrado'}
                  </label>
                  {draft.active && (
                    <>
                      <input
                        className="field-input"
                        type="time"
                        value={draft.open}
                        onChange={(e) => updateDraft(d.value, { open: e.target.value })}
                        disabled={savingDay === d.value}
                      />
                      <span>—</span>
                      <input
                        className="field-input"
                        type="time"
                        value={draft.close}
                        onChange={(e) => updateDraft(d.value, { close: e.target.value })}
                        disabled={savingDay === d.value}
                      />
                    </>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {draft.active && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => saveDay(d.value)}
                      disabled={savingDay === d.value || !dirty}
                    >
                      {savingDay === d.value ? 'A guardar...' : 'Guardar'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
