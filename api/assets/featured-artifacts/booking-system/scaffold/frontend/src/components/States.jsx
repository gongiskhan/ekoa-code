export function EmptyState({ title, text, action, icon }) {
  return (
    <div className="empty">
      {icon || (
        <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )}
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action || null}
    </div>
  );
}

export function Loading({ label }) {
  return (
    <div className="loading">
      <span className="spinner" aria-hidden="true" />
      <span>{label || 'A carregar...'}</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }) {
  return (
    <div className="empty" role="alert">
      <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div className="empty-title">Ocorreu um erro</div>
      <div className="empty-text">{error?.message || 'Não foi possível concluir a operação. Tente novamente.'}</div>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}
