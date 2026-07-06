import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useData, STAGES, stageMeta, formatCurrency, formatDate, formatDateTime } from '../components/DataContext.jsx';
import { PageHeader, Card, Button, Tag, EmptyState, Field, Modal } from '../components/UIBits.jsx';

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { deals, contacts, activities, updateDeal, removeDeal, addActivity } = useData();
  const deal = deals.find((d) => d.id === id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(deal || {});
  const [saving, setSaving] = useState(false);
  const [openActivity, setOpenActivity] = useState(false);
  const [submittingActivity, setSubmittingActivity] = useState(false);

  const linkedContact = useMemo(() => {
    if (!deal) return null;
    return contacts.find((c) => c.name === deal.contactName) || null;
  }, [contacts, deal]);

  const relatedActivities = useMemo(() => {
    if (!deal) return [];
    return activities
      .filter((a) => a.contactName === deal.contactName || a.company === deal.company)
      .sort((a, b) => Date.parse(b.occurredAt || 0) - Date.parse(a.occurredAt || 0));
  }, [activities, deal]);

  if (!deal) {
    return (
      <div className="page-stack">
        <EmptyState
          title="Negócio não encontrado"
          description="Este negócio pode ter sido removido."
          action={<Link to="/negocios" className="btn btn-primary">Voltar aos negócios</Link>}
        />
      </div>
    );
  }

  const meta = stageMeta(deal.stage);

  function startEdit() {
    setForm({
      ...deal,
      value: typeof deal.value === 'number' ? deal.value : Number(deal.value) || 0,
      probability: typeof deal.probability === 'number' ? deal.probability : Number(deal.probability) || 0,
      expectedClose: deal.expectedClose ? String(deal.expectedClose).slice(0, 10) : '',
    });
    setEditing(true);
  }

  async function changeStage(stageId) {
    try {
      await updateDeal(deal.id, { stage: stageId });
    } catch (err) {
      alert('Não foi possível atualizar a etapa.');
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateDeal(deal.id, {
        ...form,
        value: Number(form.value) || 0,
        probability: Number(form.probability) || 0,
        expectedClose: form.expectedClose || null,
      });
      setEditing(false);
    } catch (err) {
      alert('Não foi possível atualizar o negócio.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Tem a certeza de que pretende remover este negócio?')) return;
    try {
      await removeDeal(deal.id);
      navigate('/negocios');
    } catch (err) {
      alert('Não foi possível remover o negócio.');
    }
  }

  async function handleAddActivity(payload) {
    setSubmittingActivity(true);
    try {
      await addActivity({ ...payload, dealTitle: deal.title });
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
        title={deal.title}
        subtitle={(deal.company || 'Sem empresa') + (deal.contactName ? ' · ' + deal.contactName : '')}
        action={(
          <div className="action-row">
            <Button variant="ghost" onClick={startEdit}>Editar</Button>
            <Button variant="danger-ghost" onClick={handleRemove}>Remover</Button>
            <Button onClick={() => setOpenActivity(true)}>Registar atividade</Button>
          </div>
        )}
      />

      <div className="detail-grid">
        <Card title="Resumo do negócio" hint="Os números essenciais.">
          <div className="deal-summary">
            <div className="summary-row">
              <span>Etapa atual</span>
              <Tag tone={meta.tone}>{meta.label}</Tag>
            </div>
            <div className="summary-row">
              <span>Valor estimado</span>
              <strong>{formatCurrency(deal.value, deal.currency)}</strong>
            </div>
            <div className="summary-row">
              <span>Probabilidade</span>
              <strong>{deal.probability || 0}%</strong>
            </div>
            <div className="summary-row">
              <span>Fecho previsto</span>
              <strong>{formatDate(deal.expectedClose)}</strong>
            </div>
            {deal.notes ? (
              <p className="notes-block">{deal.notes}</p>
            ) : null}
          </div>

          <div className="stage-flow" role="group" aria-label="Mudar etapa">
            {STAGES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={'stage-pill ' + s.tone + (deal.stage === s.id ? ' is-current' : '')}
                onClick={() => changeStage(s.id)}
                aria-pressed={deal.stage === s.id}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Card>

        <Card title="Contacto" hint="A pessoa associada a este negócio.">
          {linkedContact ? (
            <div className="contact-summary">
              <strong>{linkedContact.name}</strong>
              <span className="muted">{linkedContact.role || 'Sem função registada'}</span>
              <span>{linkedContact.email || '—'}</span>
              <span className="muted">{linkedContact.phone || '—'}</span>
              <Link to={'/contactos/' + linkedContact.id} className="btn btn-ghost btn-small">Ver contacto</Link>
            </div>
          ) : (
            <EmptyState
              title="Sem contacto associado"
              description="Edite este negócio para escolher um contacto da sua lista."
              action={<Button variant="ghost" onClick={startEdit}>Editar negócio</Button>}
            />
          )}
        </Card>
      </div>

      <Card title="Histórico de atividade" hint="Interações relacionadas com este negócio.">
        {relatedActivities.length === 0 ? (
          <EmptyState
            title="Sem atividade"
            description="Registe interações para construir o histórico deste negócio."
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

      <Modal open={editing} onClose={() => setEditing(false)} title="Editar negócio">
        <form className="form-stack" onSubmit={saveEdit}>
          <Field label="Título"><input type="text" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
          <div className="form-grid form-grid-2">
            <Field label="Empresa"><input type="text" value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label="Contacto">
              <input list="contact-suggestions-edit" type="text" value={form.contactName || ''} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              <datalist id="contact-suggestions-edit">
                {contacts.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </Field>
            <Field label="Valor"><input type="number" value={form.value || 0} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
            <Field label="Moeda">
              <select value={form.currency || 'EUR'} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option>EUR</option><option>USD</option><option>GBP</option><option>BRL</option>
              </select>
            </Field>
            <Field label="Etapa">
              <select value={form.stage || 'lead'} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Probabilidade (%)"><input type="number" min="0" max="100" value={form.probability || 0} onChange={(e) => setForm({ ...form, probability: e.target.value })} /></Field>
            <Field label="Fecho previsto"><input type="date" value={form.expectedClose || ''} onChange={(e) => setForm({ ...form, expectedClose: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><textarea rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'A guardar...' : 'Guardar alterações'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={openActivity} onClose={() => setOpenActivity(false)} title={'Registar atividade · ' + deal.title}>
        <form className="form-stack" onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const type = data.get('type');
          const summary = String(data.get('summary') || '').trim();
          const occurredAt = data.get('occurredAt');
          if (!summary) return;
          handleAddActivity({
            type: String(type || 'Nota'),
            summary,
            occurredAt: occurredAt ? new Date(String(occurredAt)).toISOString() : new Date().toISOString(),
            contactName: deal.contactName,
            company: deal.company,
          });
        }}>
          <div className="form-grid form-grid-2">
            <Field label="Tipo">
              <select name="type" defaultValue="Chamada">
                <option>Chamada</option>
                <option>E-mail enviado</option>
                <option>Reunião</option>
                <option>Demonstração</option>
                <option>Nota interna</option>
              </select>
            </Field>
            <Field label="Quando">
              <input name="occurredAt" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} />
            </Field>
          </div>
          <Field label="Descrição">
            <textarea name="summary" rows={3} placeholder="Descreva brevemente o que aconteceu." />
          </Field>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setOpenActivity(false)}>Cancelar</Button>
            <Button type="submit" disabled={submittingActivity}>{submittingActivity ? 'A guardar...' : 'Registar atividade'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
