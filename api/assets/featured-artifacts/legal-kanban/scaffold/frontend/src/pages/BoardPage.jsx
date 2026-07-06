import { useMemo, useState } from 'react';
import {
  useSharedCollection, createShared, updateShared, appHref, formatDate, diasRestantes,
} from '../shared.js';
import {
  Button, Badge, UrgencyBadge, Field, Input, Select, EmptyState, Skeleton, useToast,
} from '../components/ui.jsx';
import { IconColumns, IconPlus, IconClose, IconExternalLink } from '../components/Icons.jsx';
import { useDemoResult } from '../demo.js';
import {
  DEFAULT_BOARD, columnCards, columnIdFor, corToTone, planDrop,
} from './kanban-logic.js';

const URGENCIAS = [
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

const FORM_EMPTY = { titulo: '', processoId: '', responsavel: '', prazo: '', urgencia: 'media' };

/* Distintivo de prazo - realça os cartões vencidos (dias restantes < 0). */
function PrazoBadge({ prazo }) {
  const dias = diasRestantes(prazo);
  if (Number.isNaN(dias)) return null;
  if (dias < 0) {
    const n = Math.abs(dias);
    return <Badge tone="alta" title={formatDate(prazo)}>{`Vencido há ${n} ${n === 1 ? 'dia' : 'dias'}`}</Badge>;
  }
  const tone = dias === 0 ? 'media' : dias <= 3 ? 'info' : 'neutral';
  const label = dias === 0 ? 'Termina hoje' : `${formatDate(prazo)}`;
  return <Badge tone={tone} title={formatDate(prazo)}>{label}</Badge>;
}

export default function BoardPage() {
  const toast = useToast();
  const { items: tarefas, loading, refresh } = useSharedCollection('tarefas');
  const { items: boards } = useSharedCollection('kanban_boards');
  const { items: processos } = useSharedCollection('processos');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(FORM_EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const [responsavelFiltro, setResponsavelFiltro] = useState('all');
  const [processoFiltro, setProcessoFiltro] = useState('all');
  const [texto, setTexto] = useState('');

  const [draggingId, setDraggingId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  // O quadro por omissão vive em memória enquanto ninguém criar um em kanban_boards.
  const board = boards && boards.length > 0 ? boards[0] : DEFAULT_BOARD;
  const colunas = Array.isArray(board.colunas) && board.colunas.length > 0 ? board.colunas : DEFAULT_BOARD.colunas;

  const processoNumero = useMemo(() => {
    const map = new Map(processos.map((p) => [p.id, p.numeroProcesso]));
    return (id) => map.get(id) || null;
  }, [processos]);
  const processoCliente = useMemo(() => {
    const map = new Map(processos.map((p) => [p.id, p.clienteId]));
    return (id) => map.get(id) || null;
  }, [processos]);

  const responsaveis = useMemo(
    () => Array.from(new Set(tarefas.map((t) => t.responsavel).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt')),
    [tarefas],
  );
  const processosComTarefa = useMemo(() => {
    const ids = Array.from(new Set(tarefas.map((t) => t.processoId).filter(Boolean)));
    return ids
      .map((id) => ({ id, numero: processoNumero(id) || 'Sem número' }))
      .sort((a, b) => a.numero.localeCompare(b.numero, 'pt'));
  }, [tarefas, processoNumero]);

  const termo = texto.trim().toLowerCase();
  const visible = useMemo(() => tarefas.filter((t) => {
    if (responsavelFiltro !== 'all' && t.responsavel !== responsavelFiltro) return false;
    if (processoFiltro !== 'all' && t.processoId !== processoFiltro) return false;
    if (termo) {
      const num = processoNumero(t.processoId) || '';
      const hay = `${t.titulo || ''} ${t.descricao || ''} ${t.responsavel || ''} ${num}`.toLowerCase();
      if (!hay.includes(termo)) return false;
    }
    return true;
  }), [tarefas, responsavelFiltro, processoFiltro, termo, processoNumero]);

  useDemoResult('kanban-board', tarefas.length > 0);

  const persist = async (writes) => {
    if (!writes.length) return;
    await Promise.all(writes.map((w) => updateShared('tarefas', w.id, w.patch)));
    await refresh();
  };

  const moveTo = async (tarefa, col, beforeId = null) => {
    if (!tarefa || !col) return;
    try {
      await persist(planDrop(tarefa, col, tarefas, beforeId));
    } catch {
      toast('Não foi possível mover o cartão.', { tone: 'error' });
    }
  };

  const onLaneDrop = (col) => (e) => {
    e.preventDefault();
    setDragOverCol(null);
    const id = draggingId || e.dataTransfer.getData('text/plain');
    setDraggingId(null);
    const tarefa = tarefas.find((t) => t.id === id);
    if (tarefa) moveTo(tarefa, col, null);
  };

  const onCardDrop = (col, beforeId) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCol(null);
    const id = draggingId || e.dataTransfer.getData('text/plain');
    setDraggingId(null);
    if (id === beforeId) return;
    const tarefa = tarefas.find((t) => t.id === id);
    if (tarefa) moveTo(tarefa, col, beforeId);
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      if (!form.titulo.trim()) throw new Error('O título do cartão é obrigatório.');
      const payload = {
        titulo: form.titulo.trim(),
        processoId: form.processoId || null,
        clienteId: form.processoId ? processoCliente(form.processoId) : null,
        responsavel: form.responsavel.trim() || null,
        prazo: form.prazo || null,
        urgencia: form.urgencia || 'media',
        estado: 'aberta',
        origem: 'kanban',
      };
      await createShared('tarefas', payload);
      await refresh();
      toast('Cartão criado.', { tone: 'ok' });
      setForm(FORM_EMPTY);
      setShowForm(false);
    } catch (err) {
      setFormError(err.message || 'Não foi possível criar o cartão.');
    } finally {
      setSaving(false);
    }
  };

  const renderCard = (t, col) => {
    const numero = processoNumero(t.processoId);
    return (
      <li
        key={t.id}
        data-testid="kanban-card"
        data-card-id={t.id}
        draggable
        onDragStart={(e) => { setDraggingId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); }}
        onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={onCardDrop(col, t.id)}
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--sp-3, 0.75rem)',
          gap: 'var(--sp-2, 0.5rem)',
          cursor: 'grab',
          boxShadow: 'var(--shadow-1)',
          opacity: draggingId === t.id ? 0.5 : 1,
        }}
      >
        <div className="stack stack-1">
          <span className="text-strong" style={{ lineHeight: 1.3 }}>{t.titulo}</span>
          <div className="row row-2 text-xs text-subtle" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            {t.responsavel ? <span>{t.responsavel}</span> : null}
            {numero ? (
              <a
                href={appHref('legal-dossie', `processo/${t.processoId}`)}
                data-testid="kanban-card-dossie"
                className="row row-1 numeric"
                style={{ alignItems: 'center', gap: 4 }}
                title="Abrir o dossiê do processo"
              >
                <span>{numero}</span>
                <IconExternalLink size={12} />
              </a>
            ) : null}
          </div>
        </div>
        <div className="row row-2" style={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="row row-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <UrgencyBadge urgencia={t.urgencia} />
            {t.estado === 'concluida' ? <Badge tone="ok">Concluída</Badge> : <PrazoBadge prazo={t.prazo} />}
          </div>
          <label className="row row-1" style={{ alignItems: 'center', gap: 4 }}>
            <span className="text-xs text-subtle">Mover para</span>
            <Select
              data-testid="kanban-mover"
              data-demo-target="kanban-mover"
              aria-label={`Mover o cartão "${t.titulo}" para outra coluna`}
              value={col.id}
              onChange={(e) => {
                const target = colunas.find((c) => c.id === e.target.value);
                if (target && target.id !== col.id) moveTo(t, target, null);
              }}
              style={{ width: 'auto', minWidth: 130, fontSize: 'var(--text-xs, 0.75rem)' }}
            >
              {colunas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </label>
        </div>
      </li>
    );
  };

  return (
    <div data-testid="kanban-board" data-demo-target="kanban-board" data-demo-page="kanban/board">
      <div className="page-header">
        <div>
          <h1 className="page-title">Quadro de Tarefas</h1>
          <p className="page-subtitle">
            Arraste ou use "Mover para" para reorganizar. O estado da tarefa é canónico:
            as colunas mapeadas a um estado sincronizam-no; "Em revisão" reposiciona sem o alterar.
          </p>
        </div>
        <Button data-testid="kanban-novo" data-demo-target="kanban-novo" onClick={() => setShowForm((v) => !v)}>
          {showForm ? <><IconClose /> Fechar</> : <><IconPlus /> Novo cartão</>}
        </Button>
      </div>

      {showForm ? (
        <section className="card" style={{ marginBottom: 'var(--sp-6, 1.5rem)' }} data-testid="kanban-form">
          <h2 className="card-title" style={{ marginBottom: 'var(--sp-4, 1rem)' }}>Novo cartão</h2>
          <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Field label="Título" required htmlFor="kanban-titulo">
              <Input id="kanban-titulo" data-testid="kanban-titulo" data-demo-target="kanban-titulo" value={form.titulo} onChange={(e) => set({ titulo: e.target.value })} placeholder="Descreva a tarefa." required autoFocus />
            </Field>
            <div className="form-grid">
              <Field label="Processo" htmlFor="kanban-processo">
                <Select id="kanban-processo" data-testid="kanban-processo" value={form.processoId} onChange={(e) => set({ processoId: e.target.value })}>
                  <option value="">Sem processo.</option>
                  {processos.map((p) => <option key={p.id} value={p.id}>{p.numeroProcesso || 'Sem número'}</option>)}
                </Select>
              </Field>
              <Field label="Responsável" htmlFor="kanban-responsavel">
                <Input id="kanban-responsavel" data-testid="kanban-responsavel" value={form.responsavel} onChange={(e) => set({ responsavel: e.target.value })} placeholder="Nome do responsável." />
              </Field>
              <Field label="Prazo" htmlFor="kanban-prazo">
                <Input id="kanban-prazo" type="date" data-testid="kanban-prazo" value={form.prazo} onChange={(e) => set({ prazo: e.target.value })} />
              </Field>
              <Field label="Urgência" htmlFor="kanban-urgencia">
                <Select id="kanban-urgencia" data-testid="kanban-urgencia" value={form.urgencia} onChange={(e) => set({ urgencia: e.target.value })}>
                  {URGENCIAS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </Select>
              </Field>
            </div>
            {formError ? <p className="text-small" style={{ color: 'var(--danger, #DC2626)', margin: 0 }}>{formError}</p> : null}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-3, 0.75rem)' }}>
              <Button variant="ghost" onClick={() => { setShowForm(false); setForm(FORM_EMPTY); setFormError(null); }} disabled={saving}>Cancelar</Button>
              <Button type="submit" data-testid="kanban-guardar" data-demo-target="kanban-guardar" disabled={saving}>{saving ? 'A guardar…' : 'Criar cartão'}</Button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="filters">
        <Select value={responsavelFiltro} onChange={(e) => setResponsavelFiltro(e.target.value)} aria-label="Filtrar por responsável" style={{ width: 'auto', minWidth: 170 }}>
          <option value="all">Todos os responsáveis</option>
          {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Select value={processoFiltro} onChange={(e) => setProcessoFiltro(e.target.value)} aria-label="Filtrar por processo" style={{ width: 'auto', minWidth: 160 }}>
          <option value="all">Todos os processos</option>
          {processosComTarefa.map((p) => <option key={p.id} value={p.id}>{p.numero}</option>)}
        </Select>
        <Input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pesquisar cartões…"
          aria-label="Pesquisar cartões"
          style={{ width: 'auto', minWidth: 200, flex: '1 1 200px' }}
        />
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : tarefas.length === 0 ? (
        <EmptyState
          icon={<IconColumns />}
          title="Sem tarefas"
          hint="Crie o primeiro cartão para começar a organizar o quadro."
          action={<Button onClick={() => setShowForm(true)}><IconPlus /> Novo cartão</Button>}
        />
      ) : (
        <div
          className="row"
          style={{ alignItems: 'flex-start', gap: 'var(--sp-4, 1rem)', overflowX: 'auto', paddingBottom: 'var(--sp-2, 0.5rem)' }}
        >
          {colunas.map((col) => {
            const cards = columnCards(col.id, visible, colunas);
            const isOver = dragOverCol === col.id;
            return (
              <section
                key={col.id}
                data-testid={`kanban-lane-${col.id}`}
                data-demo-target={`kanban-col-${col.id}`}
                className="card"
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOverCol(null); }}
                onDrop={onLaneDrop(col)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: '1 0 260px',
                  minWidth: 260,
                  maxWidth: 340,
                  gap: 'var(--sp-3, 0.75rem)',
                  background: isOver ? 'var(--accent-weak, #eaeff4)' : 'var(--color-surface, #f8fafc)',
                  outline: isOver ? '2px dashed var(--accent, #1e3a5f)' : 'none',
                  transition: 'background 120ms ease',
                }}
              >
                <div className="row row-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="row row-2" style={{ alignItems: 'center' }}>
                    <h2 className="card-title" style={{ margin: 0 }}>{col.nome}</h2>
                    <Badge tone={corToTone(col.cor)}>{cards.length}</Badge>
                  </div>
                </div>
                {cards.length === 0 ? (
                  <p className="text-xs text-subtle" style={{ margin: 0, padding: 'var(--sp-4, 1rem) 0', textAlign: 'center' }}>
                    Sem cartões.
                  </p>
                ) : (
                  <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {cards.map((t) => renderCard(t, col))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
