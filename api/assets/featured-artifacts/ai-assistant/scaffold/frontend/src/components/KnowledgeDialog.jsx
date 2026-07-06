import { useState, useEffect } from 'react';
import { Icon } from './Icon.jsx';

const EMPTY = { id: null, title: '', body: '' };

export function KnowledgeDialog({ documents, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(documents[0] ? documents[0].id : null);

  useEffect(() => {
    const doc = documents.find((d) => d.id === selectedId);
    if (doc) setDraft({ id: doc.id, title: doc.title || '', body: doc.body || '' });
    else setDraft(EMPTY);
  }, [selectedId, documents]);

  function newDocument() {
    setSelectedId(null);
    setDraft(EMPTY);
  }

  function save() {
    if (!draft.title.trim()) return;
    onSave({
      id: draft.id || undefined,
      title: draft.title.trim(),
      body: draft.body,
    });
    if (!draft.id) {
      setDraft(EMPTY);
    }
  }

  function destroy(id) {
    onDelete(id);
    if (selectedId === id) {
      const remaining = documents.filter((d) => d.id !== id);
      setSelectedId(remaining[0] ? remaining[0].id : null);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlay-scrim" onClick={onClose} aria-hidden="true" />
      <div className="overlay-card overlay-card-wide">
        <header className="overlay-header">
          <div>
            <h2 className="overlay-title">Base de conhecimento</h2>
            <p className="overlay-subtitle">
              Documentos consultados pelo assistente em cada resposta.
            </p>
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
            <button type="button" className="new-button" onClick={newDocument}>
              <Icon name="plus" />
              <span>Novo documento</span>
            </button>
            <ul className="document-list">
              {documents.length === 0 && (
                <li className="document-empty">
                  Ainda não existem documentos.
                </li>
              )}
              {documents.map((d) => (
                <li
                  key={d.id}
                  className={`document-item ${
                    d.id === selectedId ? 'active' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="document-button"
                    onClick={() => setSelectedId(d.id)}
                  >
                    <div className="document-title">{d.title || 'Sem título'}</div>
                    <div className="document-snippet">
                      {(d.body || '').slice(0, 80) || 'Sem conteúdo.'}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-button-soft danger"
                    onClick={() => destroy(d.id)}
                    aria-label="Eliminar"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="two-pane-main">
            <label className="field">
              <span className="field-label">Título</span>
              <input
                type="text"
                value={draft.title}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Por exemplo: Política de devoluções"
              />
            </label>
            <label className="field field-grow">
              <span className="field-label">Conteúdo</span>
              <textarea
                value={draft.body}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, body: e.target.value }))
                }
                placeholder="Texto que o assistente irá considerar como referência."
              />
            </label>
            <div className="field-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={save}
                disabled={!draft.title.trim()}
              >
                <Icon name="check" />
                <span>{draft.id ? 'Guardar alterações' : 'Adicionar documento'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
