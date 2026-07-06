import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';

const TITLES = {
  categories: { title: 'Categorias', subtitle: 'Organize os tickets por tema.' },
  agents: { title: 'Agentes', subtitle: 'Gerir a equipa que responde aos pedidos.' },
  responses: { title: 'Respostas guardadas', subtitle: 'Modelos para acelerar a resposta.' },
};

function emptyValue(mode) {
  if (mode === 'categories') return { id: null, name: '', description: '' };
  if (mode === 'agents') return { id: null, name: '', email: '', role: 'Agente' };
  return { id: null, title: '', body: '' };
}

export function ManageDialog({
  mode,
  categories,
  agents,
  responses,
  onSaveCategory,
  onDeleteCategory,
  onSaveAgent,
  onDeleteAgent,
  onSaveResponse,
  onDeleteResponse,
  onClose,
}) {
  const items = mode === 'categories' ? categories : mode === 'agents' ? agents : responses;
  const [selectedId, setSelectedId] = useState(items[0] ? items[0].id : null);
  const [draft, setDraft] = useState(emptyValue(mode));

  useEffect(() => {
    setSelectedId(items[0] ? items[0].id : null);
    setDraft(emptyValue(mode));
  }, [mode]);

  useEffect(() => {
    const item = items.find((i) => i.id === selectedId);
    if (item) setDraft({ ...emptyValue(mode), ...item });
    else setDraft(emptyValue(mode));
  }, [selectedId, items, mode]);

  function newItem() {
    setSelectedId(null);
    setDraft(emptyValue(mode));
  }

  function save() {
    if (mode === 'categories') {
      if (!draft.name.trim()) return;
      onSaveCategory({ id: draft.id || undefined, name: draft.name.trim(), description: draft.description });
    } else if (mode === 'agents') {
      if (!draft.name.trim()) return;
      onSaveAgent({
        id: draft.id || undefined,
        name: draft.name.trim(),
        email: draft.email.trim(),
        role: draft.role.trim() || 'Agente',
      });
    } else {
      if (!draft.title.trim()) return;
      onSaveResponse({ id: draft.id || undefined, title: draft.title.trim(), body: draft.body });
    }
    if (!draft.id) setDraft(emptyValue(mode));
  }

  function destroy(id) {
    if (mode === 'categories') onDeleteCategory(id);
    else if (mode === 'agents') onDeleteAgent(id);
    else onDeleteResponse(id);
    if (selectedId === id) {
      const remaining = items.filter((i) => i.id !== id);
      setSelectedId(remaining[0] ? remaining[0].id : null);
    }
  }

  const labels = TITLES[mode];

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlay-scrim" onClick={onClose} aria-hidden="true" />
      <div className="overlay-card overlay-card-wide">
        <header className="overlay-header">
          <div>
            <h2 className="overlay-title">{labels.title}</h2>
            <p className="overlay-subtitle">{labels.subtitle}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="overlay-body two-pane">
          <div className="two-pane-side">
            <button type="button" className="new-button" onClick={newItem}>
              <Icon name="plus" />
              <span>Novo</span>
            </button>
            <ul className="document-list">
              {items.length === 0 && (
                <li className="document-empty">Lista vazia.</li>
              )}
              {items.map((it) => (
                <li
                  key={it.id}
                  className={`document-item ${it.id === selectedId ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="document-button"
                    onClick={() => setSelectedId(it.id)}
                  >
                    <div className="document-title">
                      {it.name || it.title || 'Sem nome'}
                    </div>
                    <div className="document-snippet">
                      {(it.description || it.email || it.body || '').slice(0, 80) || ' '}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-button-soft danger"
                    onClick={() => destroy(it.id)}
                    aria-label="Eliminar"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="two-pane-main">
            {mode === 'categories' && (
              <>
                <label className="field">
                  <span className="field-label">Nome</span>
                  <input
                    type="text"
                    value={draft.name || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Por exemplo: Faturação"
                  />
                </label>
                <label className="field field-grow">
                  <span className="field-label">Descrição</span>
                  <textarea
                    value={draft.description || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder="Quando usar esta categoria."
                  />
                </label>
              </>
            )}

            {mode === 'agents' && (
              <>
                <label className="field">
                  <span className="field-label">Nome</span>
                  <input
                    type="text"
                    value={draft.name || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Nome do agente"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Correio electrónico</span>
                  <input
                    type="email"
                    value={draft.email || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, email: e.target.value }))
                    }
                    placeholder="agente@exemplo.pt"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Função</span>
                  <input
                    type="text"
                    value={draft.role || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, role: e.target.value }))
                    }
                    placeholder="Por exemplo: Coordenadora"
                  />
                </label>
              </>
            )}

            {mode === 'responses' && (
              <>
                <label className="field">
                  <span className="field-label">Título</span>
                  <input
                    type="text"
                    value={draft.title || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, title: e.target.value }))
                    }
                    placeholder="Por exemplo: Confirmação de receção"
                  />
                </label>
                <label className="field field-grow">
                  <span className="field-label">Resposta</span>
                  <textarea
                    value={draft.body || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, body: e.target.value }))
                    }
                    placeholder="Texto que será inserido na resposta."
                  />
                </label>
              </>
            )}

            <div className="field-actions">
              <button type="button" className="secondary-button" onClick={onClose}>
                Cancelar
              </button>
              <button type="button" className="primary-button" onClick={save}>
                <Icon name="check" />
                <span>{draft.id ? 'Guardar alterações' : 'Adicionar'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
