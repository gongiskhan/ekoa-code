import { useMemo, useState } from 'react';
import { useData, formatDateTime } from '../components/DataContext.jsx';
import { PageHeader, Card, Skeleton, EmptyState, Button, Field, Modal, Tag } from '../components/UIBits.jsx';

const TYPE_FILTERS = ['Todas', 'Chamada', 'E-mail enviado', 'Reunião', 'Demonstração', 'Nota interna'];

function StandaloneActivityForm({ contacts, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState({
    type: 'Chamada',
    contactName: '',
    company: '',
    summary: '',
    occurredAt: new Date().toISOString().slice(0, 16),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.summary.trim()) return;
    onSubmit({
      ...form,
      occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : new Date().toISOString(),
    });
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="form-grid form-grid-2">
        <Field label="Tipo">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option>Chamada</option>
            <option>E-mail enviado</option>
            <option>Reunião</option>
            <option>Demonstração</option>
            <option>Nota interna</option>
          </select>
        </Field>
        <Field label="Quando">
          <input type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} />
        </Field>
        <Field label="Contacto">
          <input list="activity-contacts" type="text" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Nome do contacto" />
          <datalist id="activity-contacts">
            {contacts.map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
        </Field>
        <Field label="Empresa">
          <input type="text" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Empresa" />
        </Field>
      </div>
      <Field label="Descrição">
        <textarea rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Descreva o que aconteceu." />
      </Field>
      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'A guardar...' : 'Registar atividade'}</Button>
      </div>
    </form>
  );
}

export default function Activities() {
  const { activities, contacts, loading, addActivity } = useData();
  const [filter, setFilter] = useState('Todas');
  const [openForm, setOpenForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const list = filter === 'Todas' ? activities : activities.filter((a) => a.type === filter);
    return [...list].sort((a, b) => Date.parse(b.occurredAt || 0) - Date.parse(a.occurredAt || 0));
  }, [activities, filter]);

  async function handleCreate(values) {
    setSubmitting(true);
    try {
      await addActivity(values);
      setOpenForm(false);
    } catch (err) {
      alert('Não foi possível registar a atividade.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader title="Atividade" subtitle="A carregar o histórico." />
        <Card><Skeleton count={6} height={48} /></Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Atividade"
        subtitle="Acompanhe todas as interações registadas com a sua rede comercial."
        action={<Button onClick={() => setOpenForm(true)}>Registar atividade</Button>}
      />

      <Card>
        <div className="filter-row">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              className={'filter-chip' + (filter === t ? ' is-active' : '')}
              onClick={() => setFilter(t)}
            >
              {t}
            </button>
          ))}
          <span className="toolbar-meta">{filtered.length} interações</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="Sem atividade registada"
            description={filter === 'Todas'
              ? 'Registe a primeira interação para começar a construir o histórico.'
              : 'Nenhuma interação corresponde ao filtro selecionado.'}
            action={<Button onClick={() => setOpenForm(true)}>Registar atividade</Button>}
          />
        ) : (
          <ul className="activity-list">
            {filtered.map((a) => (
              <li key={a.id} className="activity-item">
                <div className="activity-meta">
                  <Tag tone="tone-accent">{a.type || 'Nota'}</Tag>
                  <span className="activity-time">{formatDateTime(a.occurredAt)}</span>
                </div>
                <p className="activity-summary">{a.summary || 'Sem descrição.'}</p>
                <span className="activity-contact">{(a.contactName || '—') + (a.company ? ' · ' + a.company : '')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={openForm} onClose={() => setOpenForm(false)} title="Registar nova atividade">
        <StandaloneActivityForm
          contacts={contacts}
          onSubmit={handleCreate}
          onCancel={() => setOpenForm(false)}
          submitting={submitting}
        />
      </Modal>
    </div>
  );
}
