import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useSharedCollection,
  createShared,
  deleteShared,
  formatDate,
} from '../shared.js';
import {
  Button,
  Badge,
  SearchInput,
  EmptyState,
  ConfirmDialog,
  toast,
} from '../components/ui.jsx';
import { IconFileText, IconPlus } from '../components/Icons.jsx';

/* Esqueleto de um modelo novo - corpo e variáveis vazios, preenchidos no editor. */
const NOVO_MODELO = { nome: 'Novo modelo', area: '', descricao: '', corpo: '', variaveis: [] };

export default function GaleriaPage() {
  const navigate = useNavigate();
  const { items: modelos, loading, refresh } = useSharedCollection('modelos');

  const [query, setQuery] = useState('');
  const [area, setArea] = useState('');
  const [criando, setCriando] = useState(false);
  const [duplicando, setDuplicando] = useState(false);
  const [aEliminar, setAEliminar] = useState(null);

  // Áreas distintas presentes nos modelos, para os chips de filtro.
  const areas = useMemo(() => {
    const set = new Set();
    for (const m of modelos) if (m.area) set.add(m.area);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt'));
  }, [modelos]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return modelos
      .filter((m) => (area ? m.area === area : true))
      .filter((m) => {
        if (!q) return true;
        return [m.nome, m.area, m.descricao]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }, [modelos, area, query]);

  async function onNovo() {
    setCriando(true);
    try {
      const created = await createShared('modelos', NOVO_MODELO);
      if (created && created.id) {
        navigate(`/modelos/${created.id}`);
        return;
      }
      toast('Não foi possível criar o modelo.', { tone: 'error' });
    } catch {
      toast('Não foi possível criar o modelo.', { tone: 'error' });
    } finally {
      setCriando(false);
    }
  }

  async function onDuplicar(m) {
    if (duplicando) return;
    setDuplicando(true);
    try {
      const copia = {
        nome: `${m.nome || 'Modelo'} (cópia)`,
        area: m.area || '',
        descricao: m.descricao || '',
        corpo: m.corpo || '',
        variaveis: Array.isArray(m.variaveis) ? m.variaveis.map((v) => ({ ...v })) : [],
      };
      const created = await createShared('modelos', copia);
      await refresh();
      if (created && created.id) toast('Modelo duplicado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível duplicar o modelo.', { tone: 'error' });
    } finally {
      setDuplicando(false);
    }
  }

  async function onEliminarConfirmado() {
    const alvo = aEliminar;
    setAEliminar(null);
    if (!alvo) return;
    try {
      await deleteShared('modelos', alvo.id);
      await refresh();
      toast('Modelo eliminado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível eliminar o modelo.', { tone: 'error' });
    }
  }

  return (
    <div data-testid="galeria-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Modelos de contrato</h1>
          <p className="page-subtitle">
            Minutas reutilizáveis com variáveis mapeadas ao cliente e ao processo. Escolha um modelo
            para gerar um contrato pré-preenchido, guardado no dossiê.
          </p>
        </div>
        <div className="page-actions">
          <Button data-testid="novo-modelo" onClick={onNovo} disabled={criando}>
            <IconPlus /> Novo modelo
          </Button>
        </div>
      </div>

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquisar por nome, área ou descrição…"
          data-testid="galeria-pesquisa" data-demo-target="contratos-pesquisa"
        />
        {areas.length > 0 && (
          <div className="chip-row">
            <button
              type="button"
              className={`chip as-button${area === '' ? ' is-active' : ''}`}
              onClick={() => setArea('')}
            >
              Todas
            </button>
            {areas.map((a) => (
              <button
                key={a}
                type="button"
                className={`chip as-button${area === a ? ' is-active' : ''}`}
                onClick={() => setArea((prev) => (prev === a ? '' : a))}
              >
                {a}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar modelos.</span></div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={<IconFileText />}
          title={modelos.length === 0 ? 'Ainda não há modelos' : 'Sem resultados'}
          hint={
            modelos.length === 0
              ? 'Crie o seu primeiro modelo de contrato para começar a gerar documentos.'
              : 'Nenhum modelo corresponde à pesquisa. Ajuste os filtros.'
          }
          action={
            modelos.length === 0 ? (
              <Button data-testid="novo-modelo-vazio" onClick={onNovo} disabled={criando}>
                <IconPlus /> Novo modelo
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="launcher-grid">
          {filtrados.map((m) => {
            const nVars = Array.isArray(m.variaveis) ? m.variaveis.length : 0;
            return (
              <article
                key={m.id}
                className="card card-hover"
                data-testid={`modelo-card-${m.id}`}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/modelos/${m.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/modelos/${m.id}`); } }}
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 'var(--space-3, 0.75rem)' }}
              >
                <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--space-3, 0.75rem)' }}>
                  <span className="launcher-title">{m.nome || '(sem nome)'}</span>
                  {m.area ? <Badge tone="info">{m.area}</Badge> : null}
                </div>
                {m.descricao ? <p className="card-subtitle">{m.descricao}</p> : null}
                <div className="row-space-between" style={{ marginTop: 'auto' }}>
                  <span className="text-small text-subtle">
                    {nVars} {nVars === 1 ? 'variável' : 'variáveis'}
                  </span>
                  <span className="text-small text-subtle">Atualizado {formatDate(m.updatedAt || m.createdAt)}</span>
                </div>
                <div className="row row-wrap" onClick={(e) => e.stopPropagation()} style={{ gap: 'var(--space-2, 0.5rem)' }}>
                  <Button size="sm" data-testid={`modelo-gerar-${m.id}`} data-demo-target="contratos-gerar" onClick={() => navigate(`/gerar/${m.id}`)}>
                    Gerar
                  </Button>
                  <Button size="sm" variant="ghost" data-testid={`modelo-editar-${m.id}`} onClick={() => navigate(`/modelos/${m.id}`)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDuplicar(m)} disabled={duplicando}>
                    Duplicar
                  </Button>
                  <Button size="sm" variant="ghost" data-testid={`modelo-eliminar-${m.id}`} onClick={() => setAEliminar(m)}>
                    Eliminar
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!aEliminar}
        title="Eliminar modelo"
        message={aEliminar ? `Eliminar o modelo "${aEliminar.nome || '(sem nome)'}"? Esta ação não pode ser anulada.` : ''}
        confirmLabel="Eliminar"
        danger
        onConfirm={onEliminarConfirmado}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
