import { useMemo, useRef, useState } from 'react';
import {
  useSharedCollection,
  createShared,
  updateShared,
  deleteShared,
  formatDate,
} from '../shared.js';
import {
  Button,
  Badge,
  Field,
  Input,
  Select,
  Textarea,
  Modal,
  SearchInput,
  ConfirmDialog,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import { IconBook, IconPlus, IconEdit, IconTrash } from '../components/Icons.jsx';
import { TIPOS, tipoLabel } from './pecas-logic.js';

const VAZIO = { tipo: 'requerimento', area: '', titulo: '', corpo: '', notas: '' };

export default function PrecedentesPage() {
  const { items: precedentes, loading, refresh } = useSharedCollection('precedentes');

  const [query, setQuery] = useState('');
  const [areaFiltro, setAreaFiltro] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');

  const [modal, setModal] = useState(null); // { id?, tipo, area, titulo, corpo, notas }
  const [erro, setErro] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const guardandoRef = useRef(false);
  const [guardando, setGuardando] = useState(false);

  const areas = useMemo(() => {
    const set = new Set();
    for (const p of precedentes) if (p.area) set.add(p.area);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt'));
  }, [precedentes]);

  const tipos = useMemo(() => {
    const set = new Set();
    for (const p of precedentes) if (p.tipo) set.add(p.tipo);
    return Array.from(set);
  }, [precedentes]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return precedentes
      .filter((p) => (areaFiltro ? p.area === areaFiltro : true))
      .filter((p) => (tipoFiltro ? p.tipo === tipoFiltro : true))
      .filter((p) => {
        if (!q) return true;
        return [p.titulo, p.area, tipoLabel(p.tipo), p.notas]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }, [precedentes, areaFiltro, tipoFiltro, query]);

  function abrirNovo() {
    setErro(null);
    setModal({ ...VAZIO });
  }

  function abrirEdicao(p) {
    setErro(null);
    setModal({ id: p.id, tipo: p.tipo || 'requerimento', area: p.area || '', titulo: p.titulo || '', corpo: p.corpo || '', notas: p.notas || '' });
  }

  async function guardar() {
    if (guardandoRef.current || !modal) return;
    if (!String(modal.titulo || '').trim()) { setErro('Indique um título.'); return; }
    if (!String(modal.corpo || '').trim()) { setErro('O corpo do precedente não pode ficar vazio.'); return; }
    guardandoRef.current = true;
    setGuardando(true);
    try {
      const data = {
        tipo: modal.tipo,
        area: String(modal.area || '').trim(),
        titulo: String(modal.titulo).trim(),
        corpo: modal.corpo,
        notas: String(modal.notas || '').trim(),
      };
      if (modal.id) {
        await updateShared('precedentes', modal.id, data);
      } else {
        await createShared('precedentes', data);
      }
      await refresh();
      setModal(null);
      toast(modal.id ? 'Precedente atualizado.' : 'Precedente criado.', { tone: 'ok' });
    } catch {
      setErro('Não foi possível guardar o precedente.');
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  async function eliminarConfirmado() {
    const alvo = aEliminar;
    setAEliminar(null);
    if (!alvo) return;
    try {
      await deleteShared('precedentes', alvo.id);
      await refresh();
      toast('Precedente eliminado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível eliminar o precedente.', { tone: 'error' });
    }
  }

  return (
    <div data-testid="precedentes-page" data-demo-page="pecas/precedentes">
      <div className="page-header">
        <div>
          <h1 className="page-title">Precedentes da firma</h1>
          <p className="page-subtitle">
            Peças-tipo validadas, reutilizáveis como base de novas peças. O corpo entra na peça com as
            chaves resolvidas do processo.
          </p>
        </div>
        <div className="page-actions">
          <Button data-testid="precedente-novo" onClick={abrirNovo}>
            <IconPlus /> Novo precedente
          </Button>
        </div>
      </div>

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquisar por título, área ou tipo…"
          data-testid="precedentes-pesquisa"
        />
        <div className="chip-row">
          <button type="button" className={`chip as-button${tipoFiltro === '' ? ' is-active' : ''}`} onClick={() => setTipoFiltro('')}>
            Todos os tipos
          </button>
          {tipos.map((t) => (
            <button key={t} type="button" className={`chip as-button${tipoFiltro === t ? ' is-active' : ''}`} onClick={() => setTipoFiltro((prev) => (prev === t ? '' : t))}>
              {tipoLabel(t)}
            </button>
          ))}
        </div>
        {areas.length > 0 && (
          <div className="chip-row">
            <button type="button" className={`chip as-button${areaFiltro === '' ? ' is-active' : ''}`} onClick={() => setAreaFiltro('')}>
              Todas as áreas
            </button>
            {areas.map((a) => (
              <button key={a} type="button" className={`chip as-button${areaFiltro === a ? ' is-active' : ''}`} onClick={() => setAreaFiltro((prev) => (prev === a ? '' : a))}>
                {a}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar precedentes.</span></div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={<IconBook />}
          title={precedentes.length === 0 ? 'Ainda não há precedentes' : 'Sem resultados'}
          hint={
            precedentes.length === 0
              ? 'Crie um precedente ou guarde uma peça como precedente a partir do editor.'
              : 'Nenhum precedente corresponde à pesquisa. Ajuste os filtros.'
          }
          action={precedentes.length === 0 ? (
            <Button data-testid="precedente-novo-vazio" onClick={abrirNovo}><IconPlus /> Novo precedente</Button>
          ) : null}
        />
      ) : (
        <div className="launcher-grid" data-testid="precedentes-lista">
          {filtrados.map((p) => (
            <article key={p.id} className="card" data-testid={`precedente-card-${p.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3, 0.75rem)' }}>
              <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--space-3, 0.75rem)' }}>
                <span className="launcher-title">{p.titulo || '(sem título)'}</span>
                <Badge tone="info">{tipoLabel(p.tipo)}</Badge>
              </div>
              {p.area ? <Badge tone="neutral">{p.area}</Badge> : null}
              <p className="card-subtitle" style={{ whiteSpace: 'pre-wrap', maxHeight: '6.5rem', overflow: 'hidden' }}>
                {String(p.corpo || '').slice(0, 240)}{String(p.corpo || '').length > 240 ? '…' : ''}
              </p>
              {p.notas ? <p className="text-small text-subtle">{p.notas}</p> : null}
              <div className="row-space-between" style={{ marginTop: 'auto', alignItems: 'center' }}>
                <span className="text-small text-subtle">Atualizado {formatDate(p.updatedAt || p.createdAt)}</span>
                <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)' }}>
                  <Button size="sm" variant="ghost" data-testid={`precedente-editar-${p.id}`} onClick={() => abrirEdicao(p)}>
                    <IconEdit /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" data-testid={`precedente-eliminar-${p.id}`} onClick={() => setAEliminar(p)}>
                    <IconTrash /> Eliminar
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={!!modal}
        title={modal && modal.id ? 'Editar precedente' : 'Novo precedente'}
        onClose={() => setModal(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button>
            <Button data-testid="precedente-guardar" onClick={guardar} disabled={guardando}>Guardar</Button>
          </>
        }
      >
        {modal ? (
          <div className="form-grid">
            <Field label="Tipo" required>
              <Select value={modal.tipo} onChange={(e) => setModal((m) => ({ ...m, tipo: e.target.value }))} data-testid="precedente-tipo">
                {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Área">
              <Input value={modal.area} onChange={(e) => setModal((m) => ({ ...m, area: e.target.value }))} data-testid="precedente-area" placeholder="Ex.: Cível" />
            </Field>
            <Field label="Título" required>
              <Input value={modal.titulo} onChange={(e) => setModal((m) => ({ ...m, titulo: e.target.value }))} data-testid="precedente-titulo" placeholder="Ex.: Contestação-tipo em responsabilidade civil" />
            </Field>
            <Field label="Corpo" required>
              <Textarea value={modal.corpo} onChange={(e) => setModal((m) => ({ ...m, corpo: e.target.value }))} data-testid="precedente-corpo" rows={10} placeholder={'Estrutura e cláusulas-base. Use {{cliente_nome}}, {{processo_numero}}, … para chaves resolvidas na peça.'} />
            </Field>
            <Field label="Notas">
              <Input value={modal.notas} onChange={(e) => setModal((m) => ({ ...m, notas: e.target.value }))} data-testid="precedente-notas" placeholder="Uma nota interna sobre o precedente." />
            </Field>
            {erro ? <p className="resultado-erro" data-testid="precedente-erro">{erro}</p> : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!aEliminar}
        title="Eliminar precedente"
        message={aEliminar ? `Eliminar o precedente "${aEliminar.titulo || '(sem título)'}"? Esta ação não pode ser anulada.` : ''}
        confirmLabel="Eliminar"
        danger
        onConfirm={eliminarConfirmado}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
