import { useState, useEffect } from 'react';
import { Icon } from './Icon.jsx';

const EMPTY = { id: null, name: '', body: '' };

export function InstructionsDialog({
  instructions,
  onSave,
  onDelete,
  onClose,
}) {
  const [draft, setDraft] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(
    instructions[0] ? instructions[0].id : null,
  );

  useEffect(() => {
    const ins = instructions.find((i) => i.id === selectedId);
    if (ins) setDraft({ id: ins.id, name: ins.name || '', body: ins.body || '' });
    else setDraft(EMPTY);
  }, [selectedId, instructions]);

  function newInstruction() {
    setSelectedId(null);
    setDraft(EMPTY);
  }

  function save() {
    if (!draft.name.trim()) return;
    onSave({
      id: draft.id || undefined,
      name: draft.name.trim(),
      body: draft.body,
    });
    if (!draft.id) setDraft(EMPTY);
  }

  function destroy(id) {
    onDelete(id);
    if (selectedId === id) {
      const remaining = instructions.filter((i) => i.id !== id);
      setSelectedId(remaining[0] ? remaining[0].id : null);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlay-scrim" onClick={onClose} aria-hidden="true" />
      <div className="overlay-card overlay-card-wide">
        <header className="overlay-header">
          <div>
            <h2 className="overlay-title">Instruções do assistente</h2>
            <p className="overlay-subtitle">
              Tom, formato e regras a aplicar em cada resposta.
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
            <button
              type="button"
              className="new-button"
              onClick={newInstruction}
            >
              <Icon name="plus" />
              <span>Nova instrução</span>
            </button>
            <ul className="document-list">
              {instructions.length === 0 && (
                <li className="document-empty">Sem instruções guardadas.</li>
              )}
              {instructions.map((i) => (
                <li
                  key={i.id}
                  className={`document-item ${
                    i.id === selectedId ? 'active' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="document-button"
                    onClick={() => setSelectedId(i.id)}
                  >
                    <div className="document-title">
                      {i.name || 'Sem nome'}
                    </div>
                    <div className="document-snippet">
                      {(i.body || '').slice(0, 80) || 'Sem conteúdo.'}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-button-soft danger"
                    onClick={() => destroy(i.id)}
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
              <span className="field-label">Nome</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Por exemplo: Atendimento formal"
              />
            </label>
            <label className="field field-grow">
              <span className="field-label">Instrução</span>
              <textarea
                value={draft.body}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, body: e.target.value }))
                }
                placeholder="Descreva o comportamento esperado. Por exemplo: responda sempre em PT-PT, formal."
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
                disabled={!draft.name.trim()}
              >
                <Icon name="check" />
                <span>
                  {draft.id ? 'Guardar alterações' : 'Adicionar instrução'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
