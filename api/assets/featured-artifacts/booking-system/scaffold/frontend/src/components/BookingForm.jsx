import { useState } from 'react';

const STATUSES = [
  { value: 'confirmed', label: 'Confirmada' },
  { value: 'pending', label: 'Pendente' },
  { value: 'completed', label: 'Concluída' },
  { value: 'cancelled', label: 'Cancelada' },
];

function today() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function BookingForm({ initial, services, customers, defaultDate, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(() => ({
    date: initial?.date || defaultDate || today(),
    time: initial?.time || '09:00',
    serviceId: initial?.serviceId || (services[0]?.id || ''),
    customerId: initial?.customerId || (customers[0]?.id || ''),
    customerName: initial?.customerName || '',
    status: initial?.status || 'confirmed',
    notes: initial?.notes || '',
  }));

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.date || !form.time) return;
    const customer = customers.find((c) => c.id === form.customerId);
    const service = services.find((s) => s.id === form.serviceId);
    onSubmit({
      date: form.date,
      time: form.time,
      serviceId: form.serviceId || null,
      serviceName: service?.name || null,
      duration: service?.duration || 60,
      price: service?.price ?? null,
      customerId: form.customerId || null,
      customerName: customer?.name || form.customerName.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-row">
        <div className="field">
          <label className="field-label" htmlFor="b-date">Data</label>
          <input
            id="b-date"
            className="field-input"
            type="date"
            value={form.date}
            onChange={(e) => update('date', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="b-time">Hora</label>
          <input
            id="b-time"
            className="field-input"
            type="time"
            value={form.time}
            onChange={(e) => update('time', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="b-status">Estado</label>
          <select id="b-status" className="field-select" value={form.status} onChange={(e) => update('status', e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label className="field-label" htmlFor="b-svc">Serviço</label>
          <select id="b-svc" className="field-select" value={form.serviceId} onChange={(e) => update('serviceId', e.target.value)} required>
            <option value="">— selecione —</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.duration || 60} min)</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="b-cust">Cliente</label>
          <select id="b-cust" className="field-select" value={form.customerId} onChange={(e) => update('customerId', e.target.value)}>
            <option value="">— novo / sem registo —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {!form.customerId && (
        <div className="field">
          <label className="field-label" htmlFor="b-cust-name">Nome do cliente (sem registo)</label>
          <input
            id="b-cust-name"
            className="field-input"
            value={form.customerName}
            onChange={(e) => update('customerName', e.target.value)}
            placeholder="Ex.: João Pereira"
          />
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="b-notes">Notas internas</label>
        <textarea
          id="b-notes"
          className="field-textarea"
          rows="2"
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          placeholder="Detalhes adicionais sobre a marcação (opcional)"
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {initial ? 'Guardar alterações' : 'Criar marcação'}
        </button>
      </div>
    </form>
  );
}
