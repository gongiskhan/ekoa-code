import { useState } from 'react';
import { Icon } from './Icon.jsx';

function formatRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const day = 86400000;
  if (diffMs < day) return 'Hoje';
  if (diffMs < day * 2) return 'Ontem';
  if (diffMs < day * 7) return `${Math.floor(diffMs / day)} dias`;
  return d.toLocaleDateString('pt-PT');
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const filtered = conversations.filter((c) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (c.title || '').toLowerCase().includes(q) ||
      (c.summary || '').toLowerCase().includes(q)
    );
  });

  function startRename(c) {
    setRenaming(c.id);
    setRenameValue(c.title || '');
  }

  function commitRename() {
    if (renaming) {
      onRename(renaming, renameValue);
      setRenaming(null);
      setRenameValue('');
    }
  }

  return (
    <div className="sidebar-inner">
      <div className="sidebar-header">
        <span className="sidebar-title">Conversas</span>
        <button
          type="button"
          className="icon-button mobile-only"
          onClick={onClose}
          aria-label="Fechar"
        >
          <Icon name="close" />
        </button>
      </div>

      <button type="button" className="new-button" onClick={onNew}>
        <Icon name="plus" />
        <span>Nova conversa</span>
      </button>

      <div className="search-field">
        <Icon name="search" size={16} />
        <input
          type="text"
          placeholder="Procurar"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <nav className="conversation-list">
        {filtered.length === 0 && (
          <div className="conversation-empty">Sem resultados.</div>
        )}
        {filtered.map((c) => {
          const isActive = c.id === activeId;
          const isRenaming = renaming === c.id;
          return (
            <div
              key={c.id}
              className={`conversation-item ${isActive ? 'active' : ''}`}
            >
              {isRenaming ? (
                <input
                  type="text"
                  className="rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="conversation-button"
                  onClick={() => onSelect(c.id)}
                >
                  <div className="conversation-title">
                    {c.title || 'Sem título'}
                  </div>
                  <div className="conversation-meta">
                    {formatRelative(c.updatedAt || c.createdAt)}
                  </div>
                  {c.summary && (
                    <div className="conversation-summary">{c.summary}</div>
                  )}
                </button>
              )}
              <div className="conversation-actions">
                <button
                  type="button"
                  className="icon-button-soft"
                  onClick={() => startRename(c)}
                  aria-label="Mudar nome"
                >
                  <Icon name="edit" size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button-soft danger"
                  onClick={() => onDelete(c.id)}
                  aria-label="Eliminar"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
