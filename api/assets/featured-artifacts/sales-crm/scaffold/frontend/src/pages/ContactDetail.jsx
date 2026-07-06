import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useData, stageMeta, formatCurrency, formatDateTime } from '../components/DataContext.jsx';
import { PageHeader, Card, Button, Tag, EmptyState, Field, Modal } from '../components/UIBits.jsx';

function ActivityForm({ contactName, company, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState({
    type: 'Chamada',
    summary: '',
    occurredAt: new Date().toISOString().slice(0, 16),
    contactName,
    company,
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
      </div>
      <Field label="Descrição">
        <textarea rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Descreva brevemente o que aconteceu." />
      </Field>
      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'A guardar...' : 'Registar atividade'}</Button>
      </div>
    </form>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { contacts, deals, activities, updateContact, removeContact, addActivity } = useData();
  const contact = contacts.find((c) => c.id === id);
  const [openActivity, setOpenActivity] = useState(false);
  const [submittingActivity, setSubmittingActivity] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(contact || {});
  const [savingEdit, setSavingEdit] = useState(false);

  const relatedDeals = useMemo(() => {
    if (!contact) return [];
    return deals.filter((d) => d.contactName === contact.name || d.company === contact.company);
  }, [deals, contact]);

  const relatedActivities = useMemo(() => {
    if (!contact) return [];
    return activities
      .filter((a) => a.contactName === contact.name || a.company === contact.company)
      .sort((a, b) => Date.parse(b.occurredAt || 0) - Date.parse(a.occurredAt || 0));
  }, [activities, contact]);

  if (!contact) {
    return (
      <div className="page-stack">
        <EmptyState
          title="Contacto não encontrado"
          description="Este contacto pode ter sido removido."
          action={<Link to="/contactos" className="btn btn-primary">Voltar aos contactos</Link>}
        />
      </div>
    );
  }

  function startEdit() {
    setForm(contact);
    setEditing(true);
  }

  async function saveEdit(e) {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await updateContact(contact.id, form);
      setEditing(false);
    } catch (err) {
      alert('Não foi possível atualizar o contacto.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Tem a certeza de que pretende remover este contacto?')) return;
    try {
      await removeContact(contact.id);
      navigate('/contactos');
    } catch (err) {
      alert('Não foi possível remover o contacto.');
    }
  }

  async function handleAddActivity(payload) {
    setSubmittingActivity(true);
    try {
      await addActivity(payload);
      setOpenActivity(false);
    } catch (err) {
      alert('Não foi possível registar a atividade.');
    } finally {
      setSubmittingActivity(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={contact.name}
        subtitle={(contact.role || 'Sem função registada') + ' · ' + (contact.company || 'Sem empresa')}
        action={(
          <div className="action-row">
            <Button variant="ghost" onClick={startEdit}>Editar</Button>
            <Button variant="danger-ghost" onClick={handleRemove}>Remover</Button>
            <Button onClick={() => setOpenActivity(true)}>Registar atividade</Button>
          </div>
        )}
      />

      <div className="detail-grid">
        <Card title="Contacto" hint="Os seus canais de comunicação.">
          <dl className="detail-list">
            <div><dt>Correio electrónico</dt><dd>{contact.email || '—'}</dd></div>
            <div><dt>Telefone</dt><dd>{contact.phone || '—'}</dd></div>
            <div><dt>Cidade</dt><dd>{contact.city || '—'}</dd></div>
            <div><dt>Empresa</dt><dd>{contact.company || '—'}</dd></div>
            <div><dt>Função</dt><dd>{contact.role || '—'}</dd></div>
          </dl>
          {contact.notes ? <p className="notes-block">{contact.notes}</p> : null}
        </Card>

        <Card title="Negócios" hint="Oportunidades associadas a este contacto.">
          {relatedDeals.length === 0 ? (
            <EmptyState
              title="Sem negócios associados"
              description="Quando criar um negócio com este contacto, surge aqui."
              action={<Link to="/negocios" className="btn btn-primary">Ir para negócios</Link>}
            />
          ) : (
            <ul className="deal-list compact">
              {relatedDeals.map((d) => {
                const meta = stageMeta(d.stage);
                return (
                  <li key={d.id}>
                    <Link to={'/negocios/' + d.id} className="deal-row">
                      <div className="deal-main">
                        <strong>{d.title}</strong>
                        <Tag tone={meta.tone}>{meta.label}</Tag>
                      </div>
                      <span className="deal-value">{formatCurrency(d.value, d.currency)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Histórico de atividade" hint="Todas as interações registadas.">
        {relatedActivities.length === 0 ? (
          <EmptyState
            title="Sem atividade"
            description="Registe a primeira interação para começar a construir o histórico."
            action={<Button onClick={() => setOpenActivity(true)}>Registar atividade</Button>}
          />
        ) : (
          <ul className="activity-list">
            {relatedActivities.map((a) => (
              <li key={a.id} className="activity-item">
                <div className="activity-meta">
                  <Tag tone="tone-accent">{a.type || 'Nota'}</Tag>
                  <span className="activity-time">{formatDateTime(a.occurredAt)}</span>
                </div>
                <p className="activity-summary">{a.summary || 'Sem descrição.'}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={editing} onClose={() => setEditing(false)} title="Editar contacto">
        <form onSubmit={saveEdit} className="form-stack">
          <div className="form-grid form-grid-2">
            <Field label="Nome"><input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Empresa"><input type="text" value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label="Função"><input type="text" value={form.role || ''} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
            <Field label="Cidade"><input type="text" value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="Correio electrónico"><input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Telefone"><input type="tel" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Field label="Notas">
            <textarea rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button type="submit" disabled={savingEdit}>{savingEdit ? 'A guardar...' : 'Guardar alterações'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={openActivity} onClose={() => setOpenActivity(false)} title={'Registar atividade · ' + contact.name}>
        <ActivityForm
          contactName={contact.name}
          company={contact.company}
          onSubmit={handleAddActivity}
          onCancel={() => setOpenActivity(false)}
          submitting={submittingActivity}
        />
      </Modal>
    </div>
  );
}
