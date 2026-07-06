import { useMemo, useState } from 'react';
import {
  useSharedCollection, createShared, updateShared, deleteShared,
} from '../shared.js';
import {
  Button, Badge, Field, Input, Select, EmptyState, Skeleton, ConfirmDialog, useToast,
} from '../components/ui.jsx';
import { IconPlus, IconTrash, IconEdit, IconClose } from '../components/Icons.jsx';
import {
  DEFAULT_BOARD, COR_OPTIONS, ESTADO_MAP_OPTIONS, corToTone,
} from './kanban-logic.js';

/* Gera um id de coluna estável a partir do nome, único dentro do quadro. */
function slugId(nome, taken) {
  const base = String(nome || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'coluna';
  let id = base;
  let i = 2;
  while (taken.includes(id)) { id = `${base}_${i}`; i += 1; }
  return id;
}

function newColumn(taken) {
  const id = slugId('Nova coluna', taken);
  return { id, nome: 'Nova coluna', cor: 'neutral', estadoMap: null };
}

function draftFromBoard(board) {
  return {
    id: board.id,
    nome: board.nome || '',
    colunas: (board.colunas || []).map((c) => ({
      id: c.id,
      nome: c.nome || '',
      cor: c.cor || 'neutral',
      estadoMap: c.estadoMap ?? null,
    })),
  };
}

const EMPTY_DRAFT = {
  id: null,
  nome: '',
  colunas: [{ id: 'aberta', nome: 'Por fazer', cor: 'neutral', estadoMap: 'aberta' }],
};

export default function QuadrosPage() {
  const toast = useToast();
  const { items: boards, loading, refresh } = useSharedCollection('kanban_boards');

  const [draft, setDraft] = useState(null); // null = a listar; objecto = a editar/criar
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const takenIds = useMemo(() => (draft ? draft.colunas.map((c) => c.id) : []), [draft]);

  const startNew = () => { setError(null); setDraft({ ...EMPTY_DRAFT, colunas: EMPTY_DRAFT.colunas.map((c) => ({ ...c })) }); };
  const startEdit = (board) => { setError(null); setDraft(draftFromBoard(board)); };
  const cancel = () => { setDraft(null); setError(null); };

  const setCol = (idx, patch) => setDraft((d) => ({
    ...d,
    colunas: d.colunas.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
  }));
  const addCol = () => setDraft((d) => ({ ...d, colunas: [...d.colunas, newColumn(d.colunas.map((c) => c.id))] }));
  const removeCol = (idx) => setDraft((d) => (
    d.colunas.length <= 1 ? d : { ...d, colunas: d.colunas.filter((_, i) => i !== idx) }
  ));
  const moveCol = (idx, dir) => setDraft((d) => {
    const j = idx + dir;
    if (j < 0 || j >= d.colunas.length) return d;
    const next = [...d.colunas];
    [next[idx], next[j]] = [next[j], next[idx]];
    return { ...d, colunas: next };
  });

  const save = async () => {
    if (saving || !draft) return;
    setSaving(true);
    setError(null);
    try {
      if (!draft.nome.trim()) throw new Error('O nome do quadro é obrigatório.');
      if (draft.colunas.length === 0) throw new Error('O quadro tem de ter pelo menos uma coluna.');
      if (draft.colunas.some((c) => !c.nome.trim())) throw new Error('Todas as colunas precisam de nome.');

      // Reatribui ids a partir do nome, garantindo unicidade e estabilidade.
      const taken = [];
      const colunas = draft.colunas.map((c) => {
        const id = c.id && !taken.includes(c.id) ? c.id : slugId(c.nome, taken);
        taken.push(id);
        return { id, nome: c.nome.trim(), cor: c.cor || 'neutral', estadoMap: c.estadoMap || null };
      });
      const payload = { nome: draft.nome.trim(), colunas };

      if (draft.id) {
        await updateShared('kanban_boards', draft.id, payload);
        toast('Quadro actualizado.', { tone: 'ok' });
      } else {
        await createShared('kanban_boards', payload);
        toast('Quadro criado.', { tone: 'ok' });
      }
      await refresh();
      setDraft(null);
    } catch (err) {
      setError(err.message || 'Não foi possível guardar o quadro.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    const board = confirmDelete;
    setConfirmDelete(null);
    if (!board) return;
    try {
      await deleteShared('kanban_boards', board.id);
      await refresh();
      toast('Quadro eliminado.', { tone: 'info' });
      if (draft && draft.id === board.id) setDraft(null);
    } catch {
      toast('Não foi possível eliminar o quadro.', { tone: 'error' });
    }
  };

  const estadoLabel = (value) => (ESTADO_MAP_OPTIONS.find((o) => o.value === (value || ''))?.label || 'Sem estado');

  return (
    <div data-testid="quadros-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Quadros</h1>
          <p className="page-subtitle">
            Configure as colunas do quadro. Uma coluna pode mapear um estado da tarefa
            (sincroniza ao mover) ou ser apenas de apresentação.
          </p>
        </div>
        {!draft ? (
          <Button data-testid="novo-quadro" onClick={startNew}><IconPlus /> Novo quadro</Button>
        ) : null}
      </div>

      {draft ? (
        <section className="card" style={{ marginBottom: 'var(--sp-6, 1.5rem)' }} data-testid="quadro-editor">
          <div className="row row-2" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4, 1rem)' }}>
            <h2 className="card-title" style={{ margin: 0 }}>{draft.id ? 'Editar quadro' : 'Novo quadro'}</h2>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}><IconClose /> Cancelar</Button>
          </div>
          <div className="stack stack-4">
            <Field label="Nome do quadro" required htmlFor="quadro-nome">
              <Input id="quadro-nome" data-testid="quadro-nome" value={draft.nome} onChange={(e) => setDraft((d) => ({ ...d, nome: e.target.value }))} placeholder="Ex.: Quadro do contencioso." required autoFocus />
            </Field>

            <div className="stack stack-2">
              <span className="field-label">Colunas</span>
              <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {draft.colunas.map((c, idx) => (
                  <li
                    key={c.id}
                    data-testid="quadro-coluna"
                    className="row row-2"
                    style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', gap: 'var(--sp-2, 0.5rem)', alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--color-bg)' }}
                  >
                    <Field label="Nome" htmlFor={`col-nome-${idx}`}>
                      <Input id={`col-nome-${idx}`} data-testid="coluna-nome" value={c.nome} onChange={(e) => setCol(idx, { nome: e.target.value })} style={{ minWidth: 150 }} />
                    </Field>
                    <Field label="Cor" htmlFor={`col-cor-${idx}`}>
                      <Select id={`col-cor-${idx}`} value={c.cor} onChange={(e) => setCol(idx, { cor: e.target.value })} style={{ width: 'auto', minWidth: 130 }}>
                        {COR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="Estado mapeado" htmlFor={`col-estado-${idx}`}>
                      <Select id={`col-estado-${idx}`} data-testid="coluna-estado" value={c.estadoMap || ''} onChange={(e) => setCol(idx, { estadoMap: e.target.value || null })} style={{ width: 'auto', minWidth: 180 }}>
                        {ESTADO_MAP_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
                      </Select>
                    </Field>
                    <div className="row row-1" style={{ alignItems: 'center', gap: 4 }}>
                      <Button variant="ghost" size="sm" aria-label="Subir coluna" disabled={idx === 0} onClick={() => moveCol(idx, -1)}>Subir</Button>
                      <Button variant="ghost" size="sm" aria-label="Descer coluna" disabled={idx === draft.colunas.length - 1} onClick={() => moveCol(idx, 1)}>Descer</Button>
                      <Button variant="ghost" size="sm" data-testid="coluna-remover" aria-label="Remover coluna" disabled={draft.colunas.length <= 1} onClick={() => removeCol(idx)}><IconTrash /></Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div>
                <Button variant="secondary" size="sm" data-testid="adicionar-coluna" onClick={addCol}><IconPlus /> Adicionar coluna</Button>
              </div>
            </div>

            {error ? <p className="text-small" style={{ color: 'var(--danger, #DC2626)', margin: 0 }}>{error}</p> : null}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-3, 0.75rem)' }}>
              <Button variant="ghost" onClick={cancel} disabled={saving}>Cancelar</Button>
              <Button data-testid="guardar-quadro" onClick={save} disabled={saving}>{saving ? 'A guardar…' : 'Guardar quadro'}</Button>
            </div>
          </div>
        </section>
      ) : null}

      {loading ? (
        <Skeleton lines={4} />
      ) : boards.length === 0 && !draft ? (
        <EmptyState
          icon={<IconEdit />}
          title="Sem quadros configurados"
          hint={`Enquanto não criar um quadro, é usado o "${DEFAULT_BOARD.nome}" por omissão, com as colunas ${DEFAULT_BOARD.colunas.map((c) => c.nome).join(', ')}.`}
          action={<Button onClick={startNew}><IconPlus /> Novo quadro</Button>}
        />
      ) : (
        <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {boards.map((board) => (
            <li key={board.id} data-testid="quadro-item" className="card">
              <div className="row row-2" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--sp-3, 0.75rem)' }}>
                <div className="stack stack-2" style={{ minWidth: 0 }}>
                  <h2 className="card-title" style={{ margin: 0 }}>{board.nome}</h2>
                  <div className="row row-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    {(board.colunas || []).map((c) => (
                      <Badge key={c.id} tone={corToTone(c.cor)} title={`Estado: ${estadoLabel(c.estadoMap)}`}>{c.nome}</Badge>
                    ))}
                  </div>
                </div>
                <div className="row row-2" style={{ flexShrink: 0 }}>
                  <Button variant="secondary" size="sm" data-testid="editar-quadro" onClick={() => startEdit(board)}><IconEdit /> Editar</Button>
                  <Button variant="ghost" size="sm" data-testid="eliminar-quadro" onClick={() => setConfirmDelete(board)}><IconTrash /> Eliminar</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Eliminar quadro"
        message={confirmDelete ? `Eliminar o quadro "${confirmDelete.nome}"? As tarefas não são afectadas - apenas a configuração de colunas.` : ''}
        confirmLabel="Eliminar"
        danger
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
