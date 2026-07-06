import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

const ekoaFetch = (typeof window !== 'undefined' && window.__ekoa && window.__ekoa.fetch)
  ? window.__ekoa.fetch
  : (input, init) => fetch(input, init);

// The app-data REST endpoint wraps payloads in a { success, data } envelope.
// Unwrap so callers receive the bare array / record.
function unwrapList(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && Array.isArray(body.items)) return body.items;
  return [];
}
function unwrapItem(body) {
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return body;
}

const PRIORITIES = [
  { id: 'high', label: 'Alta', tone: 'tone-danger' },
  { id: 'medium', label: 'Média', tone: 'tone-warning' },
  { id: 'low', label: 'Baixa', tone: 'tone-info' },
];

function priorityMeta(id) {
  return PRIORITIES.find((p) => p.id === id) || PRIORITIES[1];
}

function formatDate(value) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
  } catch (err) {
    return String(value);
  }
}

function relativeDue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86_400_000);
  if (diff === 0) return { label: 'Vence hoje', tone: 'tone-warning' };
  if (diff === 1) return { label: 'Vence amanhã', tone: 'tone-warning' };
  if (diff > 1) return { label: 'Em ' + diff + ' dias', tone: 'tone-info' };
  if (diff === -1) return { label: 'Em atraso (1 dia)', tone: 'tone-danger' };
  return { label: 'Em atraso (' + Math.abs(diff) + ' dias)', tone: 'tone-danger' };
}

async function fetchCollection(collection) {
  try {
    const res = await ekoaFetch('/api/app-data/' + collection, { method: 'GET' });
    if (!res.ok) return [];
    return unwrapList(await res.json());
  } catch (err) {
    console.warn('Não foi possível obter ' + collection, err);
    return [];
  }
}

async function createItem(collection, payload) {
  const res = await ekoaFetch('/api/app-data/' + collection, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Falha ao criar registo.');
  return unwrapItem(await res.json());
}

async function patchItem(collection, id, patch) {
  const res = await ekoaFetch('/api/app-data/' + collection + '/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Falha ao atualizar registo.');
  return unwrapItem(await res.json());
}

async function deleteItem(collection, id) {
  const res = await ekoaFetch('/api/app-data/' + collection + '/' + id, { method: 'DELETE' });
  if (!res.ok) throw new Error('Falha ao remover registo.');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function NavIcon({ children }) {
  return <span className="nav-icon" aria-hidden="true">{children}</span>;
}

function Tag({ children, tone }) {
  return <span className={'tag ' + (tone || 'tone-default')}>{children}</span>;
}

function Skeleton({ count }) {
  const rows = Array.from({ length: count || 4 });
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {rows.map((_, i) => <span key={i} className="skeleton-row" />)}
    </div>
  );
}

function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

function TaskForm({ initial, lists, onSubmit, onCancel, submitting, onDelete }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    listSlug: (lists[0] && lists[0].slug) || 'a-fazer',
    priority: 'medium',
    dueDate: '',
    assignee: '',
    tagsInput: '',
    ...(initial ? {
      ...initial,
      tagsInput: Array.isArray(initial.tags) ? initial.tags.join(', ') : '',
    } : {}),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const tags = form.tagsInput
      ? form.tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    const { tagsInput, ...rest } = form;
    onSubmit({ ...rest, tags });
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field-label">Título</span>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Ex.: Preparar apresentação"
          required
        />
      </label>
      <label className="field">
        <span className="field-label">Descrição</span>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Acrescente detalhes úteis sobre esta tarefa."
        />
      </label>
      <div className="form-grid form-grid-3">
        <label className="field">
          <span className="field-label">Lista</span>
          <select value={form.listSlug} onChange={(e) => setForm({ ...form, listSlug: e.target.value })}>
            {lists.map((l) => <option key={l.id || l.slug} value={l.slug}>{l.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Prioridade</span>
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Vence em</span>
          <input
            type="date"
            value={form.dueDate || ''}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </label>
      </div>
      <div className="form-grid form-grid-2">
        <label className="field">
          <span className="field-label">Responsável</span>
          <input
            type="text"
            value={form.assignee}
            onChange={(e) => setForm({ ...form, assignee: e.target.value })}
            placeholder="Nome do responsável"
          />
        </label>
        <label className="field">
          <span className="field-label">Etiquetas</span>
          <input
            type="text"
            value={form.tagsInput}
            onChange={(e) => setForm({ ...form, tagsInput: e.target.value })}
            placeholder="Separe por vírgulas"
          />
        </label>
      </div>
      <div className="form-actions">
        {initial && onDelete ? (
          <button type="button" className="btn btn-danger-ghost btn-left" onClick={onDelete}>Remover</button>
        ) : null}
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'A guardar...' : initial ? 'Atualizar tarefa' : 'Criar tarefa'}
        </button>
      </div>
    </form>
  );
}

function ListForm({ onSubmit, onCancel, submitting }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('info');

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({ name: trimmed, color });
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field-label">Nome da lista</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: A planear" required />
      </label>
      <label className="field">
        <span className="field-label">Cor</span>
        <select value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="info">Azul</option>
          <option value="primary">Verde-azulado</option>
          <option value="accent">Turquesa</option>
          <option value="warning">Âmbar</option>
          <option value="success">Verde</option>
          <option value="danger">Vermelho</option>
        </select>
      </label>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'A guardar...' : 'Criar lista'}
        </button>
      </div>
    </form>
  );
}

function TaskCard({ task, list, onOpen, onMove, lists }) {
  const priority = priorityMeta(task.priority);
  const due = relativeDue(task.dueDate);
  return (
    <article className="task-card" onClick={() => onOpen(task)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task); } }}>
      <header className="task-card-header">
        <Tag tone={priority.tone}>Prioridade {priority.label.toLowerCase()}</Tag>
        {due ? <Tag tone={due.tone}>{due.label}</Tag> : null}
      </header>
      <h4 className="task-card-title">{task.title}</h4>
      {task.description ? <p className="task-card-desc">{task.description}</p> : null}
      <footer className="task-card-footer">
        <div className="task-meta">
          {task.assignee ? <span className="assignee">{task.assignee}</span> : <span className="muted">Sem responsável</span>}
          {task.dueDate ? <span className="muted">{formatDate(task.dueDate)}</span> : null}
        </div>
        {Array.isArray(task.tags) && task.tags.length > 0 ? (
          <div className="task-tags">
            {task.tags.slice(0, 3).map((t) => <span key={t} className="chip">{t}</span>)}
            {task.tags.length > 3 ? <span className="chip muted">+{task.tags.length - 3}</span> : null}
          </div>
        ) : null}
      </footer>
      <div className="task-card-actions" onClick={(e) => e.stopPropagation()}>
        <select
          aria-label="Mover para lista"
          value={task.listSlug}
          onChange={(e) => onMove(task, e.target.value)}
        >
          {lists.map((l) => <option key={l.id || l.slug} value={l.slug}>{l.name}</option>)}
        </select>
      </div>
    </article>
  );
}

function Board({ lists, tasks, search, priorityFilter, onOpenTask, onMoveTask, onCreateInList }) {
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (!q) return true;
      return (
        (t.title || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.assignee || '').toLowerCase().includes(q) ||
        (Array.isArray(t.tags) ? t.tags.join(' ').toLowerCase() : '').includes(q)
      );
    });
  }, [tasks, search, priorityFilter]);

  return (
    <div className="board">
      {lists.map((list) => {
        const items = filteredTasks.filter((t) => t.listSlug === list.slug);
        const tone = list.color || 'info';
        return (
          <section key={list.id || list.slug} className="board-column">
            <header className="board-column-header">
              <div className="board-column-title">
                <span className={'list-dot tone-' + tone} aria-hidden="true" />
                <span className="board-column-name">{list.name}</span>
                <span className="muted">{items.length}</span>
              </div>
              <button type="button" className="btn-icon" onClick={() => onCreateInList(list.slug)} aria-label={'Adicionar tarefa em ' + list.name}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </header>
            <div className="board-column-cards">
              {items.length === 0 ? (
                <div className="board-empty">Sem tarefas nesta lista.</div>
              ) : (
                items.map((task) => (
                  <TaskCard key={task.id} task={task} list={list} onOpen={onOpenTask} onMove={onMoveTask} lists={lists} />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function App() {
  const [lists, setLists] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [openTask, setOpenTask] = useState(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [openCreateList, setOpenCreateList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createInListSlug, setCreateInListSlug] = useState(null);

  const orderedLists = useMemo(() => {
    return [...lists].sort((a, b) => (a.position || 0) - (b.position || 0));
  }, [lists]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [l, t] = await Promise.all([fetchCollection('lists'), fetchCollection('tasks')]);
      setLists(l);
      setTasks(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.listSlug === 'concluido').length;
    const overdue = tasks.filter((t) => {
      if (!t.dueDate || t.listSlug === 'concluido') return false;
      return Date.parse(t.dueDate) < Date.now() - 86_400_000;
    }).length;
    const highPriority = tasks.filter((t) => t.priority === 'high' && t.listSlug !== 'concluido').length;
    return { total, done, overdue, highPriority };
  }, [tasks]);

  async function handleCreateTask(payload) {
    setSubmitting(true);
    try {
      const created = await createItem('tasks', payload);
      setTasks((prev) => [created, ...prev]);
      setOpenCreate(false);
      setCreateInListSlug(null);
    } catch (err) {
      alert('Não foi possível criar a tarefa.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateTask(id, payload) {
    setSubmitting(true);
    try {
      const updated = await patchItem('tasks', id, payload);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
      setOpenTask(null);
    } catch (err) {
      alert('Não foi possível atualizar a tarefa.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveTask(id) {
    if (!confirm('Tem a certeza de que pretende remover esta tarefa?')) return;
    try {
      await deleteItem('tasks', id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setOpenTask(null);
    } catch (err) {
      alert('Não foi possível remover a tarefa.');
    }
  }

  async function handleMoveTask(task, listSlug) {
    if (task.listSlug === listSlug) return;
    try {
      const updated = await patchItem('tasks', task.id, { listSlug });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...updated, listSlug } : t)));
    } catch (err) {
      alert('Não foi possível mover a tarefa.');
    }
  }

  async function handleCreateList({ name, color }) {
    setSubmitting(true);
    try {
      const slug = slugify(name) || ('lista-' + Date.now());
      const position = orderedLists.length;
      const created = await createItem('lists', { name, slug, position, color });
      setLists((prev) => [...prev, created]);
      setOpenCreateList(false);
    } catch (err) {
      alert('Não foi possível criar a lista.');
    } finally {
      setSubmitting(false);
    }
  }

  function openCreateForList(slug) {
    setCreateInListSlug(slug);
    setOpenCreate(true);
  }

  if (loading) {
    return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand"><div className="brand-mark" aria-hidden="true" /></div>
        </aside>
        <main className="app-main">
          <div className="app-content"><Skeleton count={6} /></div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-title">Gestor de Tarefas</span>
            <span className="brand-subtitle">Quadro de operações</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <a className="nav-link is-active" href="#board">
            <NavIcon>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" />
                <rect x="14" y="3" width="7" height="5" />
                <rect x="14" y="12" width="7" height="9" />
                <rect x="3" y="16" width="7" height="5" />
              </svg>
            </NavIcon>
            <span>Quadro</span>
          </a>
        </nav>

        <section className="sidebar-section">
          <h4 className="sidebar-section-title">As suas listas</h4>
          <ul className="sidebar-lists">
            {orderedLists.map((list) => {
              const count = tasks.filter((t) => t.listSlug === list.slug).length;
              return (
                <li key={list.id || list.slug}>
                  <span className={'list-dot tone-' + (list.color || 'info')} aria-hidden="true" />
                  <span className="sidebar-list-name">{list.name}</span>
                  <span className="muted">{count}</span>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setOpenCreateList(true)}>
            Adicionar lista
          </button>
        </section>

        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" />
          <span>Os seus dados estão guardados em segurança.</span>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <div className="topbar-stats">
            <div className="topbar-stat">
              <span className="stat-label">Total</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="topbar-stat">
              <span className="stat-label">Concluídas</span>
              <strong>{stats.done}</strong>
            </div>
            <div className="topbar-stat topbar-stat-warn">
              <span className="stat-label">Em atraso</span>
              <strong>{stats.overdue}</strong>
            </div>
            <div className="topbar-stat topbar-stat-alert">
              <span className="stat-label">Prioridade alta</span>
              <strong>{stats.highPriority}</strong>
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setOpenCreate(true)}>
            Nova tarefa
          </button>
        </header>

        <div className="app-content">
          <header className="page-header">
            <div>
              <h1 className="page-title">Quadro de tarefas</h1>
              <p className="page-subtitle">Acompanhe o seu trabalho de ponta a ponta. Arraste tarefas entre listas pelo menu de cada cartão.</p>
            </div>
          </header>

          <div className="toolbar">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquise por título, responsável ou etiqueta"
              className="search-input"
            />
            <div className="filter-row">
              <button type="button" className={'filter-chip' + (priorityFilter === 'all' ? ' is-active' : '')} onClick={() => setPriorityFilter('all')}>Todas</button>
              {PRIORITIES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={'filter-chip' + (priorityFilter === p.id ? ' is-active' : '')}
                  onClick={() => setPriorityFilter(p.id)}
                >
                  Prioridade {p.label.toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {orderedLists.length === 0 ? (
            <EmptyState
              title="Comece pelo seu quadro"
              description="Crie a primeira lista para organizar as suas tarefas."
              action={<button type="button" className="btn btn-primary" onClick={() => setOpenCreateList(true)}>Criar lista</button>}
            />
          ) : tasks.length === 0 ? (
            <EmptyState
              title="Sem tarefas registadas"
              description="Adicione a primeira tarefa para começar a movimentar o seu fluxo."
              action={<button type="button" className="btn btn-primary" onClick={() => setOpenCreate(true)}>Criar tarefa</button>}
            />
          ) : (
            <Board
              lists={orderedLists}
              tasks={tasks}
              search={search}
              priorityFilter={priorityFilter}
              onOpenTask={setOpenTask}
              onMoveTask={handleMoveTask}
              onCreateInList={openCreateForList}
            />
          )}
        </div>
      </main>

      <Modal
        open={openCreate}
        onClose={() => { setOpenCreate(false); setCreateInListSlug(null); }}
        title="Nova tarefa"
      >
        <TaskForm
          lists={orderedLists}
          initial={createInListSlug ? { listSlug: createInListSlug } : null}
          onSubmit={handleCreateTask}
          onCancel={() => { setOpenCreate(false); setCreateInListSlug(null); }}
          submitting={submitting}
        />
      </Modal>

      <Modal open={openCreateList} onClose={() => setOpenCreateList(false)} title="Nova lista">
        <ListForm
          onSubmit={handleCreateList}
          onCancel={() => setOpenCreateList(false)}
          submitting={submitting}
        />
      </Modal>

      <Modal
        open={!!openTask}
        onClose={() => setOpenTask(null)}
        title={openTask ? 'Editar tarefa' : ''}
      >
        {openTask ? (
          <TaskForm
            initial={openTask}
            lists={orderedLists}
            submitting={submitting}
            onSubmit={(payload) => handleUpdateTask(openTask.id, payload)}
            onCancel={() => setOpenTask(null)}
            onDelete={() => handleRemoveTask(openTask.id)}
          />
        ) : null}
      </Modal>
    </div>
  );
}
