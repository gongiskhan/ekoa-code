import { useEffect } from 'react';

export function PageHeader({ title, subtitle, action }) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function Card({ title, hint, children, className }) {
  return (
    <section className={'card ' + (className || '')}>
      {title || hint ? (
        <header className="card-header">
          {title ? <h3 className="card-title">{title}</h3> : null}
          {hint ? <span className="card-hint">{hint}</span> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Skeleton({ count, height }) {
  const rows = Array.from({ length: count || 3 });
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {rows.map((_, i) => (
        <span key={i} className="skeleton-row" style={{ height: (height || 14) + 'px' }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon" aria-hidden="true">{icon}</div> : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Tag({ children, tone }) {
  return <span className={'tag ' + (tone || 'tone-default')}>{children}</span>;
}

export function Button({ variant, type, onClick, children, disabled }) {
  const cls = 'btn btn-' + (variant || 'primary');
  return (
    <button type={type || 'button'} className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer }) {
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
