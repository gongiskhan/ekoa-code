import { useMemo, useState } from 'react';
import { useSharedCollection, createShared, updateShared, deleteShared, formatEur } from '../shared.js';
import {
  Badge, Button, Skeleton, EmptyState, Modal, Field, Input, Select, Textarea, toast, ConfirmDialog,
} from '../components/ui.jsx';
import { IconFileText, IconPlus, IconLink, IconEdit, IconTrash } from '../components/Icons.jsx';

/*
 * Tipos de sessão: o catálogo de marcações do escritório (duração, preço,
 * pagamento obrigatório, participantes necessários, buffer, visibilidade
 * pública). Cada tipo público expõe uma ligação de reserva para o cliente — a
 * face do artefacto público `legal-agenda-reservas`.
 */
const LOCAIS = [
  { value: 'online', label: 'Online' },
  { value: 'escritorio', label: 'No escritório' },
  { value: 'tribunal', label: 'No tribunal' },
];

function vazio() {
  return {
    nome: '', duracaoMin: 30, preco: '', pagamentoObrigatorio: false,
    participantesNecessarios: [], bufferMin: 10, publico: true, local: 'online', descricao: '',
  };
}

function linkPublico(id) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  return `${origin}/apps/legal-agenda-reservas/?tipo=${encodeURIComponent(id)}`;
}

export default function SessaoTiposPage() {
  const { items: tipos, loading, refresh } = useSharedCollection('sessao_tipos');
  const { items: pessoas } = useSharedCollection('pessoas');

  const [form, setForm] = useState(null); // null = fechado; {} = novo/editar
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [aRemover, setARemover] = useState(null);

  const pessoaNome = useMemo(() => {
    const map = new Map();
    (pessoas || []).forEach((p) => map.set(p.id, p.nome));
    return (id) => map.get(id) || '—';
  }, [pessoas]);

  function abrirNovo() { setEditId(null); setForm(vazio()); }
  function abrirEditar(t) {
    setEditId(t.id);
    setForm({
      nome: t.nome || '', duracaoMin: t.duracaoMin || 30,
      preco: t.preco == null ? '' : String(t.preco), pagamentoObrigatorio: !!t.pagamentoObrigatorio,
      participantesNecessarios: Array.isArray(t.participantesNecessarios) ? t.participantesNecessarios : [],
      bufferMin: t.bufferMin == null ? 0 : t.bufferMin, publico: !!t.publico,
      local: t.local || 'online', descricao: t.descricao || '',
    });
  }
  function fechar() { setForm(null); setEditId(null); }

  function toggleParticipante(id) {
    setForm((f) => {
      const has = f.participantesNecessarios.includes(id);
      return { ...f, participantesNecessarios: has ? f.participantesNecessarios.filter((x) => x !== id) : [...f.participantesNecessarios, id] };
    });
  }

  async function submeter() {
    if (!form.nome.trim()) { toast('Indique um nome para o tipo de sessão.', { tone: 'error' }); return; }
    const duracao = Number(form.duracaoMin);
    if (!Number.isInteger(duracao) || duracao <= 0) { toast('A duração tem de ser um número de minutos positivo.', { tone: 'error' }); return; }
    if (form.participantesNecessarios.length === 0) { toast('Escolha pelo menos um participante necessário.', { tone: 'error' }); return; }

    const precoNum = form.preco === '' ? null : Number(form.preco);
    if (precoNum != null && (!Number.isFinite(precoNum) || precoNum < 0)) { toast('Preço inválido.', { tone: 'error' }); return; }

    const payload = {
      nome: form.nome.trim(),
      duracaoMin: duracao,
      preco: precoNum,
      pagamentoObrigatorio: precoNum != null && form.pagamentoObrigatorio,
      participantesNecessarios: form.participantesNecessarios,
      bufferMin: Number(form.bufferMin) || 0,
      publico: !!form.publico,
      local: form.local,
      descricao: form.descricao.trim(),
    };

    setSaving(true);
    try {
      if (editId) await updateShared('sessao_tipos', editId, payload);
      else await createShared('sessao_tipos', payload);
      await refresh();
      toast(editId ? 'Tipo de sessão actualizado.' : 'Tipo de sessão criado.', { tone: 'ok' });
      fechar();
    } catch {
      toast('Não foi possível guardar. Tente novamente.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function remover() {
    const id = aRemover && aRemover.id;
    setARemover(null);
    if (!id) return;
    try { await deleteShared('sessao_tipos', id); await refresh(); toast('Tipo de sessão removido.', { tone: 'ok' }); }
    catch { toast('Não foi possível remover.', { tone: 'error' }); }
  }

  async function copiarLink(id) {
    const url = linkPublico(id);
    try { await navigator.clipboard.writeText(url); toast('Ligação copiada.', { tone: 'ok' }); }
    catch { toast('Copie manualmente a ligação.', { tone: 'error' }); }
  }

  const precoLabel = (t) => (t.preco == null ? 'Grátis' : formatEur(t.preco));

  return (
    <div data-testid="tipos-page" data-demo-page="agenda/tipos">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tipos de sessão</h1>
          <p className="page-subtitle">
            O catálogo de marcações. Os tipos públicos geram uma ligação de reserva para o cliente; o motor calcula os horários livres a partir das disponibilidades dos participantes.
          </p>
        </div>
        <div className="page-actions">
          <Button data-testid="tipo-novo" onClick={abrirNovo}><IconPlus /> Novo tipo</Button>
        </div>
      </div>

      {loading ? (
        <Skeleton lines={4} />
      ) : (tipos || []).length === 0 ? (
        <EmptyState icon={<IconFileText />} title="Sem tipos de sessão" hint="Crie o primeiro tipo para começar a receber marcações." action={<Button onClick={abrirNovo}><IconPlus /> Novo tipo</Button>} />
      ) : (
        <div className="stack stack-3" data-testid="tipos-lista">
          {(tipos || []).map((t) => (
            <section key={t.id} className="card" data-testid="tipo-row" data-tipo-id={t.id} style={{ padding: 'var(--sp-4, 1rem)' }}>
              <div className="row row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3, 0.75rem)', flexWrap: 'wrap' }}>
                <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                  <div className="row row-2" style={{ alignItems: 'center', gap: 'var(--sp-2, 0.5rem)', flexWrap: 'wrap' }}>
                    <span className="text-strong text-lg">{t.nome}</span>
                    {t.publico ? <Badge tone="ok">Público</Badge> : <Badge tone="neutral">Interno</Badge>}
                    {t.pagamentoObrigatorio && <Badge tone="media">Pagamento obrigatório</Badge>}
                  </div>
                  {t.descricao && <span className="text-small text-muted">{t.descricao}</span>}
                  <span className="text-small text-subtle">
                    {t.duracaoMin} min · buffer {t.bufferMin || 0} min · {precoLabel(t)} · {(LOCAIS.find((l) => l.value === t.local) || {}).label || t.local || '—'}
                  </span>
                  <span className="text-xs text-subtle">
                    Participantes: {(t.participantesNecessarios || []).map(pessoaNome).join(', ') || '—'}
                  </span>
                </div>
                <div className="row row-2" style={{ gap: 'var(--sp-2, 0.5rem)' }}>
                  <Button variant="ghost" size="sm" data-testid="tipo-editar" onClick={() => abrirEditar(t)}><IconEdit /> Editar</Button>
                  <Button variant="ghost" size="sm" data-testid="tipo-remover" onClick={() => setARemover(t)}><IconTrash /> Remover</Button>
                </div>
              </div>

              {t.publico && (
                <div
                  data-testid="tipo-link-publico"
                  data-demo-target="agenda-link-publico"
                  className="row row-2"
                  style={{ marginTop: 'var(--sp-3, 0.75rem)', gap: 'var(--sp-2, 0.5rem)', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <IconLink aria-hidden="true" />
                  <code
                    className="text-xs"
                    data-testid="tipo-link-url"
                    style={{ background: 'var(--color-surface-muted, #f1f5f9)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-1, 0.375rem)', padding: '2px 6px', overflowX: 'auto', maxWidth: '100%' }}
                  >
                    {linkPublico(t.id)}
                  </code>
                  <Button variant="secondary" size="sm" data-testid="tipo-copiar-link" data-demo-target="agenda-copiar-link" onClick={() => copiarLink(t.id)}>Copiar ligação</Button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <Modal
        open={form != null}
        title={editId ? 'Editar tipo de sessão' : 'Novo tipo de sessão'}
        onClose={fechar}
        actions={
          <>
            <Button variant="ghost" onClick={fechar} disabled={saving}>Cancelar</Button>
            <Button data-testid="tipo-submit" onClick={submeter} disabled={saving}>{saving ? 'A guardar…' : 'Guardar'}</Button>
          </>
        }
      >
        {form && (
          <div className="stack stack-3">
            <Field label="Nome" required htmlFor="tipo-nome">
              <Input id="tipo-nome" data-testid="tipo-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Consulta inicial" />
            </Field>
            <div className="row row-2" style={{ gap: 'var(--sp-3, 0.75rem)' }}>
              <Field label="Duração (min)" required htmlFor="tipo-duracao">
                <Input id="tipo-duracao" data-testid="tipo-duracao" type="number" min="5" step="5" value={form.duracaoMin} onChange={(e) => setForm({ ...form, duracaoMin: e.target.value })} />
              </Field>
              <Field label="Buffer (min)" htmlFor="tipo-buffer" hint="Intervalo antes da marcação seguinte.">
                <Input id="tipo-buffer" data-testid="tipo-buffer" type="number" min="0" step="5" value={form.bufferMin} onChange={(e) => setForm({ ...form, bufferMin: e.target.value })} />
              </Field>
            </div>
            <div className="row row-2" style={{ gap: 'var(--sp-3, 0.75rem)' }}>
              <Field label="Preço (€)" htmlFor="tipo-preco" hint="Deixe vazio para gratuito.">
                <Input id="tipo-preco" data-testid="tipo-preco" type="number" min="0" step="0.01" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} placeholder="—" />
              </Field>
              <Field label="Local" htmlFor="tipo-local">
                <Select id="tipo-local" data-testid="tipo-local" value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })}>
                  {LOCAIS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </Select>
              </Field>
            </div>

            <label className="row row-2" style={{ alignItems: 'center', gap: 'var(--sp-2, 0.5rem)', cursor: form.preco === '' ? 'not-allowed' : 'pointer', opacity: form.preco === '' ? 0.5 : 1 }}>
              <input type="checkbox" data-testid="tipo-pagamento" disabled={form.preco === ''} checked={form.pagamentoObrigatorio} onChange={(e) => setForm({ ...form, pagamentoObrigatorio: e.target.checked })} />
              <span className="text-small">Pagamento obrigatório para confirmar</span>
            </label>
            <label className="row row-2" style={{ alignItems: 'center', gap: 'var(--sp-2, 0.5rem)', cursor: 'pointer' }}>
              <input type="checkbox" data-testid="tipo-publico" checked={form.publico} onChange={(e) => setForm({ ...form, publico: e.target.checked })} />
              <span className="text-small">Visível na página pública de reservas</span>
            </label>

            <Field label="Participantes necessários" required hint="Um horário só é oferecido quando TODOS estão livres.">
              <div className="stack" data-testid="tipo-participantes" style={{ gap: 'var(--sp-1, 0.25rem)', maxHeight: '10rem', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--r-1, 0.375rem)', padding: 'var(--sp-2, 0.5rem)' }}>
                {(pessoas || []).length === 0 ? (
                  <span className="text-xs text-subtle">As pessoas vêm do Núcleo partilhado.</span>
                ) : (pessoas || []).map((p) => (
                  <label key={p.id} className="row row-2" style={{ alignItems: 'center', gap: 'var(--sp-2, 0.5rem)', cursor: 'pointer' }}>
                    <input type="checkbox" data-testid="tipo-participante" data-pessoa-id={p.id} checked={form.participantesNecessarios.includes(p.id)} onChange={() => toggleParticipante(p.id)} />
                    <span className="text-small">{p.nome}</span>
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Descrição" htmlFor="tipo-descricao">
              <Textarea id="tipo-descricao" data-testid="tipo-descricao" rows={2} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Breve descrição visível ao cliente." />
            </Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={aRemover != null}
        title="Remover tipo de sessão"
        message={aRemover ? `Remover “${aRemover.nome}”? As reservas já feitas não são afectadas.` : ''}
        confirmLabel="Remover"
        danger
        onConfirm={remover}
        onCancel={() => setARemover(null)}
      />
    </div>
  );
}
