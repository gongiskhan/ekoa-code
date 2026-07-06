import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../components/DataContext.jsx';
import { PageHeader, Card, Skeleton, EmptyState, Button, Field, Modal } from '../components/UIBits.jsx';

function ContactForm({ initial, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState({
    name: '',
    company: '',
    role: '',
    email: '',
    phone: '',
    city: '',
    notes: '',
    ...(initial || {}),
  });

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.name.trim()) return;
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="form-stack">
      <div className="form-grid form-grid-2">
        <Field label="Nome">
          <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)} required placeholder="Ex.: Maria Santos" />
        </Field>
        <Field label="Empresa">
          <input type="text" value={form.company} onChange={(e) => update('company', e.target.value)} placeholder="Ex.: Atlântico Consultores" />
        </Field>
        <Field label="Função">
          <input type="text" value={form.role} onChange={(e) => update('role', e.target.value)} placeholder="Ex.: Diretora de Operações" />
        </Field>
        <Field label="Cidade">
          <input type="text" value={form.city} onChange={(e) => update('city', e.target.value)} placeholder="Ex.: Lisboa" />
        </Field>
        <Field label="Correio electrónico">
          <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="nome@empresa.pt" />
        </Field>
        <Field label="Telefone">
          <input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="+351 ..." />
        </Field>
      </div>
      <Field label="Notas">
        <textarea rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Acrescente contexto útil sobre este contacto." />
      </Field>
      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'A guardar...' : 'Guardar contacto'}</Button>
      </div>
    </form>
  );
}

function Avatar({ name }) {
  const initials = (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  return <span className="avatar" aria-hidden="true">{initials || '?'}</span>;
}

export default function Contacts() {
  const { contacts, loading, addContact } = useData();
  const [search, setSearch] = useState('');
  const [openForm, setOpenForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, search]);

  async function handleCreate(values) {
    setSubmitting(true);
    try {
      await addContact(values);
      setOpenForm(false);
    } catch (err) {
      console.warn(err);
      alert('Não foi possível guardar o contacto.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Contactos"
        subtitle="Gira as pessoas com quem se relaciona ao longo do ciclo de vendas."
        action={<Button onClick={() => setOpenForm(true)}>Adicionar contacto</Button>}
      />

      <Card>
        <div className="toolbar">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquise por nome, empresa, e-mail ou cidade"
            className="search-input"
          />
          <span className="toolbar-meta">{filtered.length} de {contacts.length}</span>
        </div>

        {loading ? (
          <Skeleton count={6} height={48} />
        ) : filtered.length === 0 ? (
          contacts.length === 0 ? (
            <EmptyState
              title="Ainda não tem contactos"
              description="Adicione o primeiro contacto para começar a registar as suas interações."
              action={<Button onClick={() => setOpenForm(true)}>Adicionar contacto</Button>}
            />
          ) : (
            <EmptyState
              title="Sem resultados"
              description="Ajuste a pesquisa ou limpe o filtro para ver todos os contactos."
            />
          )
        ) : (
          <ul className="contact-list">
            {filtered.map((c) => (
              <li key={c.id} className="contact-row">
                <Link to={'/contactos/' + c.id} className="contact-link">
                  <Avatar name={c.name} />
                  <div className="contact-main">
                    <strong className="contact-name">{c.name}</strong>
                    <span className="contact-role">{c.role || 'Sem função registada'}</span>
                  </div>
                  <div className="contact-company">
                    <span>{c.company || '—'}</span>
                    <span className="muted">{c.city || ''}</span>
                  </div>
                  <div className="contact-channels">
                    {c.email ? <span title="Correio electrónico">{c.email}</span> : null}
                    {c.phone ? <span title="Telefone" className="muted">{c.phone}</span> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={openForm} onClose={() => setOpenForm(false)} title="Novo contacto">
        <ContactForm onSubmit={handleCreate} onCancel={() => setOpenForm(false)} submitting={submitting} />
      </Modal>
    </div>
  );
}
