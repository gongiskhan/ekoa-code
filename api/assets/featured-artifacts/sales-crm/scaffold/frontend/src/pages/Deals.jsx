import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, STAGES, stageMeta, formatCurrency, formatDate } from '../components/DataContext.jsx';
import { PageHeader, Card, Skeleton, EmptyState, Button, Field, Modal, Tag } from '../components/UIBits.jsx';

const ACTIVE_STAGES = STAGES.filter((s) => s.id !== 'lost');

function DealForm({ contacts, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState({
    title: '',
    company: '',
    contactName: '',
    value: '',
    currency: 'EUR',
    stage: 'lead',
    probability: 25,
    expectedClose: '',
    notes: '',
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSubmit({
      ...form,
      value: Number(form.value) || 0,
      probability: Number(form.probability) || 0,
      expectedClose: form.expectedClose || null,
    });
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <Field label="Título do negócio">
        <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Ex.: Implementação de plataforma" />
      </Field>
      <div className="form-grid form-grid-2">
        <Field label="Empresa">
          <input type="text" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Empresa cliente" />
        </Field>
        <Field label="Contacto">
          <input list="contact-suggestions" type="text" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Nome do contacto" />
          <datalist id="contact-suggestions">
            {contacts.map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
        </Field>
        <Field label="Valor">
          <input type="number" min="0" step="100" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Moeda">
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option>EUR</option>
            <option>USD</option>
            <option>GBP</option>
            <option>BRL</option>
          </select>
        </Field>
        <Field label="Etapa">
          <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Probabilidade (%)">
          <input type="number" min="0" max="100" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} />
        </Field>
        <Field label="Fecho previsto">
          <input type="date" value={form.expectedClose} onChange={(e) => setForm({ ...form, expectedClose: e.target.value })} />
        </Field>
      </div>
      <Field label="Notas">
        <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Acrescente contexto importante." />
      </Field>
      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'A guardar...' : 'Guardar negócio'}</Button>
      </div>
    </form>
  );
}

function DealCard({ deal }) {
  const meta = stageMeta(deal.stage);
  return (
    <Link to={'/negocios/' + deal.id} className="deal-card">
      <header className="deal-card-header">
        <Tag tone={meta.tone}>{meta.label}</Tag>
        <span className="deal-card-probability">{deal.probability || 0}%</span>
      </header>
      <h4 className="deal-card-title">{deal.title}</h4>
      <p className="deal-card-company">{deal.company || 'Sem empresa'}</p>
      <footer className="deal-card-footer">
        <strong>{formatCurrency(deal.value, deal.currency)}</strong>
        <span className="muted">{formatDate(deal.expectedClose)}</span>
      </footer>
    </Link>
  );
}

export default function Deals() {
  const { deals, contacts, loading, addDeal } = useData();
  const [openForm, setOpenForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const stage of STAGES) map.set(stage.id, []);
    for (const deal of deals) {
      if (!map.has(deal.stage)) map.set('lead', []);
      const target = map.get(deal.stage) || map.get('lead');
      target.push(deal);
    }
    return map;
  }, [deals]);

  async function handleCreate(values) {
    setSubmitting(true);
    try {
      await addDeal(values);
      setOpenForm(false);
    } catch (err) {
      alert('Não foi possível guardar o negócio.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader title="Negócios" subtitle="A carregar o seu pipeline." />
        <Card><Skeleton count={8} height={42} /></Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Negócios"
        subtitle="Veja os seus negócios distribuídos por etapa do pipeline."
        action={<Button onClick={() => setOpenForm(true)}>Adicionar negócio</Button>}
      />

      {deals.length === 0 ? (
        <Card>
          <EmptyState
            title="O seu pipeline está vazio"
            description="Adicione o primeiro negócio para começar a acompanhar a evolução comercial."
            action={<Button onClick={() => setOpenForm(true)}>Adicionar negócio</Button>}
          />
        </Card>
      ) : (
        <div className="kanban">
          {ACTIVE_STAGES.map((stage) => {
            const items = grouped.get(stage.id) || [];
            const total = items.reduce((s, d) => s + (Number(d.value) || 0), 0);
            return (
              <section key={stage.id} className="kanban-column">
                <header className="kanban-header">
                  <div className="kanban-title">
                    <Tag tone={stage.tone}>{stage.label}</Tag>
                    <span className="muted">{items.length}</span>
                  </div>
                  <span className="kanban-total">{formatCurrency(total)}</span>
                </header>
                <div className="kanban-cards">
                  {items.length === 0 ? (
                    <div className="kanban-empty">Sem negócios.</div>
                  ) : (
                    items.map((d) => <DealCard key={d.id} deal={d} />)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Modal open={openForm} onClose={() => setOpenForm(false)} title="Novo negócio">
        <DealForm contacts={contacts} onSubmit={handleCreate} onCancel={() => setOpenForm(false)} submitting={submitting} />
      </Modal>
    </div>
  );
}
