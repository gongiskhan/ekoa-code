/*
 * Formulários modais reutilizados pelas páginas do Núcleo (listas E detalhes):
 * criar/editar cliente e criar/editar processo. Assentam nos primitivos da
 * suite (Modal/Field/Input/Select/Textarea/Button) e preservam os data-testid
 * herdados dos ecrãs originais.
 */

import { useEffect, useState } from 'react';
import { Modal, Field, Input, Select, Textarea, Button } from '../components/ui.jsx';
import { createShared, updateShared } from '../shared.js';
import { TIPOS, ESTADOS } from './widgets.jsx';

const CLIENTE_EMPTY = { nome: '', nif: '', email: '', telefone: '', morada: '', tipo: 'particular', notas: '' };

function clienteFormState(c) {
  if (!c) return { ...CLIENTE_EMPTY };
  return {
    id: c.id,
    nome: c.nome || '',
    nif: c.nif || '',
    email: c.email || '',
    telefone: c.telefone || '',
    morada: c.morada || '',
    tipo: c.tipo || 'particular',
    notas: c.notas || '',
  };
}

export function ClienteFormModal({ open, cliente, onClose, onSaved }) {
  const [form, setForm] = useState(() => clienteFormState(cliente));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setForm(clienteFormState(cliente)); setError(null); } }, [open, cliente]);

  const isEditing = Boolean(form.id);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        nome: form.nome.trim(),
        nif: form.nif.trim() || null,
        email: form.email.trim() || null,
        telefone: form.telefone.trim() || null,
        morada: form.morada.trim() || null,
        tipo: form.tipo || 'particular',
        notas: form.notas.trim() || null,
      };
      if (!payload.nome) throw new Error('O nome do cliente é obrigatório.');
      const saved = form.id
        ? await updateShared('clientes', form.id, payload)
        : await createShared('clientes', payload);
      if (onSaved) await onSaved(saved);
    } catch (err) {
      setError(err.message || 'Não foi possível guardar o cliente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEditing ? 'Editar cliente' : 'Novo cliente'}
      onClose={onClose}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button type="submit" form="cliente-form" data-testid="guardar-cliente" disabled={submitting}>
            {submitting ? 'A guardar…' : isEditing ? 'Guardar alterações' : 'Adicionar cliente'}
          </Button>
        </>
      )}
    >
      <form id="cliente-form" className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="form-grid">
          <Field label="Nome" required htmlFor="cliente-nome">
            <Input id="cliente-nome" data-testid="cliente-nome" value={form.nome} onChange={(e) => set({ nome: e.target.value })} required autoFocus />
          </Field>
          <Field label="Tipo" htmlFor="cliente-tipo">
            <Select id="cliente-tipo" data-testid="cliente-tipo" value={form.tipo} onChange={(e) => set({ tipo: e.target.value })}>
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="NIF" htmlFor="cliente-nif">
            <Input id="cliente-nif" data-testid="cliente-nif" value={form.nif} onChange={(e) => set({ nif: e.target.value })} placeholder="000 000 000" />
          </Field>
          <Field label="Email" htmlFor="cliente-email">
            <Input id="cliente-email" type="email" data-testid="cliente-email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Telefone" htmlFor="cliente-telefone">
            <Input id="cliente-telefone" data-testid="cliente-telefone" value={form.telefone} onChange={(e) => set({ telefone: e.target.value })} />
          </Field>
          <Field label="Morada" htmlFor="cliente-morada">
            <Input id="cliente-morada" data-testid="cliente-morada" value={form.morada} onChange={(e) => set({ morada: e.target.value })} />
          </Field>
        </div>
        <Field label="Notas" htmlFor="cliente-notas">
          <Textarea id="cliente-notas" data-testid="cliente-notas" rows={3} value={form.notas} onChange={(e) => set({ notas: e.target.value })} />
        </Field>
        {error ? <p className="text-small" style={{ color: 'var(--danger, #DC2626)', margin: 0 }}>{error}</p> : null}
      </form>
    </Modal>
  );
}

const PROCESSO_EMPTY = {
  clienteId: '', numeroProcesso: '', tribunal: '', comarca: '', area: '', estado: 'ativo', advogadoResponsavel: '', descricao: '',
};

function processoFormState(p, fallbackClienteId) {
  if (!p) return { ...PROCESSO_EMPTY, clienteId: fallbackClienteId || '' };
  return {
    id: p.id,
    clienteId: p.clienteId || fallbackClienteId || '',
    numeroProcesso: p.numeroProcesso || '',
    tribunal: p.tribunal || '',
    comarca: p.comarca || '',
    area: p.area || '',
    estado: p.estado || 'ativo',
    advogadoResponsavel: p.advogadoResponsavel || '',
    descricao: p.descricao || '',
  };
}

export function ProcessoFormModal({ open, processo, clientes = [], fixedClienteId, onClose, onSaved }) {
  const [form, setForm] = useState(() => processoFormState(processo, fixedClienteId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setForm(processoFormState(processo, fixedClienteId)); setError(null); } }, [open, processo, fixedClienteId]);

  const isEditing = Boolean(form.id);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        clienteId: form.clienteId || null,
        numeroProcesso: form.numeroProcesso.trim() || null,
        tribunal: form.tribunal.trim() || null,
        comarca: form.comarca.trim() || null,
        area: form.area.trim() || null,
        estado: form.estado || 'ativo',
        advogadoResponsavel: form.advogadoResponsavel.trim() || null,
        descricao: form.descricao.trim() || null,
      };
      if (!payload.clienteId) throw new Error('Seleccione o cliente do processo.');
      const saved = form.id
        ? await updateShared('processos', form.id, payload)
        : await createShared('processos', payload);
      if (onSaved) await onSaved(saved);
    } catch (err) {
      setError(err.message || 'Não foi possível guardar o processo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEditing ? 'Editar processo' : 'Novo processo'}
      onClose={onClose}
      style={{ maxWidth: 640 }}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button type="submit" form="processo-form" data-testid="guardar-processo" disabled={submitting}>
            {submitting ? 'A guardar…' : isEditing ? 'Guardar alterações' : 'Abrir processo'}
          </Button>
        </>
      )}
    >
      <form id="processo-form" className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Cliente" required htmlFor="processo-cliente">
          <Select
            id="processo-cliente"
            data-testid="processo-cliente"
            value={form.clienteId}
            onChange={(e) => set({ clienteId: e.target.value })}
            disabled={Boolean(fixedClienteId)}
            required
          >
            <option value="">Seleccione o cliente.</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}{c.nif ? ` · NIF ${c.nif}` : ''}</option>
            ))}
          </Select>
        </Field>
        <div className="form-grid">
          <Field label="Número do processo" htmlFor="processo-numero">
            <Input id="processo-numero" data-testid="processo-numero" value={form.numeroProcesso} onChange={(e) => set({ numeroProcesso: e.target.value })} placeholder="0000/26.0T8LSB" />
          </Field>
          <Field label="Estado" htmlFor="processo-estado">
            <Select id="processo-estado" data-testid="processo-estado" value={form.estado} onChange={(e) => set({ estado: e.target.value })}>
              {ESTADOS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Tribunal" htmlFor="processo-tribunal">
            <Input id="processo-tribunal" data-testid="processo-tribunal" value={form.tribunal} onChange={(e) => set({ tribunal: e.target.value })} />
          </Field>
          <Field label="Comarca" htmlFor="processo-comarca">
            <Input id="processo-comarca" data-testid="processo-comarca" value={form.comarca} onChange={(e) => set({ comarca: e.target.value })} />
          </Field>
          <Field label="Área" htmlFor="processo-area">
            <Input id="processo-area" data-testid="processo-area" value={form.area} onChange={(e) => set({ area: e.target.value })} placeholder="Cível, Laboral, Penal…" />
          </Field>
          <Field label="Advogado responsável" htmlFor="processo-advogado">
            <Input id="processo-advogado" data-testid="processo-advogado" value={form.advogadoResponsavel} onChange={(e) => set({ advogadoResponsavel: e.target.value })} />
          </Field>
        </div>
        <Field label="Descrição" htmlFor="processo-descricao">
          <Textarea id="processo-descricao" data-testid="processo-descricao" rows={3} value={form.descricao} onChange={(e) => set({ descricao: e.target.value })} />
        </Field>
        {error ? <p className="text-small" style={{ color: 'var(--danger, #DC2626)', margin: 0 }}>{error}</p> : null}
      </form>
    </Modal>
  );
}
