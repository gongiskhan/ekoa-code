import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useSharedCollection, createShared, updateShared, diasRestantes,
} from '../shared.js';
import {
  Button, Badge, UrgencyBadge, Field, Input, Select, EmptyState, Skeleton, useToast,
} from '../components/ui.jsx';
import { IconPlus, IconCheckSquare, IconClose } from '../components/Icons.jsx';
import { URGENCIAS, DeadlineBadge } from './widgets.jsx';

const GRUPOS = [
  { key: 'vencidas', label: 'Vencidas', testid: 'grupo-vencidas' },
  { key: 'hoje', label: 'Hoje', testid: 'grupo-hoje' },
  { key: 'semana', label: 'Esta semana', testid: 'grupo-semana' },
  { key: 'tarde', label: 'Mais tarde', testid: 'grupo-tarde' },
];

function bucketOf(t) {
  const d = diasRestantes(t.prazo);
  if (Number.isNaN(d)) return 'tarde';
  if (d < 0) return 'vencidas';
  if (d === 0) return 'hoje';
  if (d <= 7) return 'semana';
  return 'tarde';
}

const FORM_EMPTY = { titulo: '', clienteId: '', processoId: '', responsavel: '', prazo: '', urgencia: 'media' };

export default function TarefasPage() {
  const toast = useToast();
  const { items: tarefas, loading, refresh } = useSharedCollection('tarefas');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(FORM_EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [estadoFiltro, setEstadoFiltro] = useState('ativas');
  const [urgenciaFiltro, setUrgenciaFiltro] = useState('all');
  const [responsavelFiltro, setResponsavelFiltro] = useState('all');

  const responsaveis = useMemo(() => Array.from(new Set(tarefas.map((t) => t.responsavel).filter(Boolean))).sort(), [tarefas]);
  const processosDoForm = useMemo(() => (
    form.clienteId ? processos.filter((p) => p.clienteId === form.clienteId) : processos
  ), [processos, form.clienteId]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => tarefas.filter((t) => {
    if (urgenciaFiltro !== 'all' && (t.urgencia || 'media') !== urgenciaFiltro) return false;
    if (responsavelFiltro !== 'all' && t.responsavel !== responsavelFiltro) return false;
    return true;
  }), [tarefas, urgenciaFiltro, responsavelFiltro]);

  const ativas = useMemo(() => filtered.filter((t) => t.estado !== 'concluida'), [filtered]);
  const concluidas = useMemo(() => (
    filtered.filter((t) => t.estado === 'concluida')
      .slice()
      .sort((a, b) => String(b.concluidaEm || '').localeCompare(String(a.concluidaEm || '')))
  ), [filtered]);

  const grupos = useMemo(() => {
    const by = { vencidas: [], hoje: [], semana: [], tarde: [] };
    ativas.forEach((t) => { by[bucketOf(t)].push(t); });
    Object.values(by).forEach((arr) => arr.sort((a, b) => diasRestantes(a.prazo) - diasRestantes(b.prazo)));
    return by;
  }, [ativas]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      if (!form.titulo.trim()) throw new Error('O título da tarefa é obrigatório.');
      // A tarefa ligada a um processo herda o cliente desse processo, mesmo que
      // o utilizador não o tenha escolhido - assim aparece sempre na ficha do
      // cliente (a lista de tarefas do cliente filtra por clienteId).
      const selProc = form.processoId ? processos.find((p) => p.id === form.processoId) : null;
      const clienteId = form.clienteId || (selProc ? selProc.clienteId : null);
      const payload = {
        titulo: form.titulo.trim(),
        clienteId: clienteId || null,
        processoId: form.processoId || null,
        responsavel: form.responsavel.trim() || null,
        prazo: form.prazo || null,
        urgencia: form.urgencia || 'media',
        estado: 'aberta',
        origem: 'manual',
      };
      await createShared('tarefas', payload);
      await refresh();
      toast('Tarefa criada.', { tone: 'ok' });
      setForm(FORM_EMPTY);
      setShowForm(false);
    } catch (err) {
      setFormError(err.message || 'Não foi possível criar a tarefa.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t) => {
    try {
      if (t.estado === 'concluida') {
        await updateShared('tarefas', t.id, { estado: 'aberta', concluidaEm: null });
        toast('Tarefa reaberta.', { tone: 'info' });
      } else {
        await updateShared('tarefas', t.id, { estado: 'concluida', concluidaEm: new Date().toISOString() });
        toast('Tarefa concluída.', { tone: 'ok' });
      }
      await refresh();
    } catch {
      toast('Não foi possível actualizar a tarefa.', { tone: 'error' });
    }
  };

  const clienteNome = useMemo(() => {
    const map = new Map(clientes.map((c) => [c.id, c.nome]));
    return (id) => map.get(id) || null;
  }, [clientes]);
  const processoNumero = useMemo(() => {
    const map = new Map(processos.map((p) => [p.id, p.numeroProcesso]));
    return (id) => map.get(id) || null;
  }, [processos]);

  const renderCard = (t) => {
    const done = t.estado === 'concluida';
    const proc = processoNumero(t.processoId);
    const cli = clienteNome(t.clienteId);
    return (
      <li
        key={t.id}
        data-testid="tarefa-card"
        className="row row-3"
        style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', gap: 'var(--sp-3, 0.75rem)', alignItems: 'flex-start', background: 'var(--color-bg)' }}
      >
        <input
          type="checkbox"
          checked={done}
          aria-label={`${done ? 'Reabrir' : 'Concluir'} tarefa: ${t.titulo}`}
          data-testid="tarefa-concluir"
          onChange={() => toggle(t)}
          style={{ width: 18, height: 18, accentColor: 'var(--accent)', flexShrink: 0, marginTop: 2 }}
        />
        <span className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
          <span className="text-strong" style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--color-text-subtle)' : 'var(--color-text)' }}>{t.titulo}</span>
          <span className="row row-2 text-xs text-subtle" style={{ flexWrap: 'wrap' }}>
            {t.responsavel ? <span>{t.responsavel}</span> : null}
            {proc ? <Link to={`/processos/${t.processoId}`} className="text-muted numeric">{proc}</Link> : null}
            {cli && !proc ? <Link to={`/clientes/${t.clienteId}`} className="text-muted">{cli}</Link> : null}
          </span>
        </span>
        <span className="row row-2" style={{ flexShrink: 0 }}>
          <UrgencyBadge urgencia={t.urgencia} />
          {done ? <Badge tone="ok">Concluída</Badge> : <DeadlineBadge date={t.prazo} />}
        </span>
      </li>
    );
  };

  const showConcluidas = estadoFiltro === 'concluidas' || estadoFiltro === 'todas';
  const showAtivas = estadoFiltro === 'ativas' || estadoFiltro === 'todas';
  const totalVisiveis = (showAtivas ? ativas.length : 0) + (showConcluidas ? concluidas.length : 0);

  return (
    <div data-testid="tarefas-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tarefas</h1>
          <p className="page-subtitle">Agrupadas por urgência de prazo. Conclua com um clique.</p>
        </div>
        <Button data-testid="nova-tarefa" onClick={() => setShowForm((v) => !v)}>
          {showForm ? <><IconClose /> Fechar</> : <><IconPlus /> Nova tarefa</>}
        </Button>
      </div>

      {showForm ? (
        <section className="card" style={{ marginBottom: 'var(--sp-6, 1.5rem)' }} data-testid="tarefa-form">
          <h2 className="card-title" style={{ marginBottom: 'var(--sp-4, 1rem)' }}>Nova tarefa</h2>
          <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Field label="Título" required htmlFor="tarefa-titulo">
              <Input id="tarefa-titulo" data-testid="tarefa-titulo" value={form.titulo} onChange={(e) => set({ titulo: e.target.value })} placeholder="Descreva a tarefa." required autoFocus />
            </Field>
            <div className="form-grid">
              <Field label="Cliente" htmlFor="tarefa-cliente">
                <Select id="tarefa-cliente" data-testid="tarefa-cliente" value={form.clienteId} onChange={(e) => set({ clienteId: e.target.value, processoId: '' })}>
                  <option value="">Sem cliente.</option>
                  {clientes.filter((c) => !c.arquivado).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </Select>
              </Field>
              <Field label="Processo" htmlFor="tarefa-processo">
                <Select
                  id="tarefa-processo"
                  data-testid="tarefa-processo"
                  value={form.processoId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const proc = processos.find((p) => p.id === pid);
                    // Escolher o processo pré-preenche o cliente (se ainda não estiver definido).
                    set({ processoId: pid, clienteId: form.clienteId || (proc ? proc.clienteId : '') });
                  }}
                >
                  <option value="">Sem processo.</option>
                  {processosDoForm.map((p) => <option key={p.id} value={p.id}>{p.numeroProcesso || 'Sem número'}</option>)}
                </Select>
              </Field>
              <Field label="Responsável" htmlFor="tarefa-responsavel">
                <Input id="tarefa-responsavel" data-testid="tarefa-responsavel" value={form.responsavel} onChange={(e) => set({ responsavel: e.target.value })} placeholder="Nome do responsável." />
              </Field>
              <Field label="Prazo" htmlFor="tarefa-prazo">
                <Input id="tarefa-prazo" type="date" data-testid="tarefa-prazo" value={form.prazo} onChange={(e) => set({ prazo: e.target.value })} />
              </Field>
              <Field label="Urgência" htmlFor="tarefa-urgencia">
                <Select id="tarefa-urgencia" data-testid="tarefa-urgencia" value={form.urgencia} onChange={(e) => set({ urgencia: e.target.value })}>
                  {URGENCIAS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </Select>
              </Field>
            </div>
            {formError ? <p className="text-small" style={{ color: 'var(--danger, #DC2626)', margin: 0 }}>{formError}</p> : null}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-3, 0.75rem)' }}>
              <Button variant="ghost" onClick={() => { setShowForm(false); setForm(FORM_EMPTY); setFormError(null); }} disabled={saving}>Cancelar</Button>
              <Button type="submit" data-testid="guardar-tarefa" disabled={saving}>{saving ? 'A guardar…' : 'Criar tarefa'}</Button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="filters">
        <div className="chip-row">
          {[{ v: 'ativas', l: 'Ativas' }, { v: 'concluidas', l: 'Concluídas' }, { v: 'todas', l: 'Todas' }].map((o) => (
            <button key={o.v} type="button" className={`chip as-button${estadoFiltro === o.v ? ' is-active' : ''}`} onClick={() => setEstadoFiltro(o.v)}>{o.l}</button>
          ))}
        </div>
        <Select value={urgenciaFiltro} onChange={(e) => setUrgenciaFiltro(e.target.value)} aria-label="Filtrar por urgência" style={{ width: 'auto', minWidth: 150 }}>
          <option value="all">Todas as urgências</option>
          {URGENCIAS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
        </Select>
        {responsaveis.length > 0 ? (
          <Select value={responsavelFiltro} onChange={(e) => setResponsavelFiltro(e.target.value)} aria-label="Filtrar por responsável" style={{ width: 'auto', minWidth: 170 }}>
            <option value="all">Todos os responsáveis</option>
            {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        ) : null}
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : totalVisiveis === 0 ? (
        <EmptyState
          icon={<IconCheckSquare />}
          title="Sem tarefas"
          hint="Crie a primeira tarefa ou ajuste os filtros."
          action={<Button onClick={() => setShowForm(true)}><IconPlus /> Nova tarefa</Button>}
        />
      ) : (
        <div className="stack stack-6">
          {showAtivas ? GRUPOS.map((g) => {
            const rows = grupos[g.key];
            if (!rows || rows.length === 0) return null;
            return (
              <section key={g.key} data-testid={g.testid}>
                <div className="row row-2" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
                  <h2 className="card-title" style={{ margin: 0 }}>{g.label}</h2>
                  <Badge tone={g.key === 'vencidas' ? 'alta' : g.key === 'hoje' ? 'media' : 'neutral'}>{rows.length}</Badge>
                </div>
                <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{rows.map(renderCard)}</ul>
              </section>
            );
          }) : null}

          {showConcluidas && concluidas.length > 0 ? (
            <section data-testid="grupo-concluidas">
              <div className="row row-2" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
                <h2 className="card-title" style={{ margin: 0 }}>Concluídas</h2>
                <Badge tone="ok">{concluidas.length}</Badge>
              </div>
              <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{concluidas.map(renderCard)}</ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
