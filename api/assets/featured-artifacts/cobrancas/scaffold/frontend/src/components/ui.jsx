/* Primitivas de UI da app - alinhadas com o idioma visual da suite Ekoa
 * (design tokens com fallback, sem hex de marca fixo). */
import { forwardRef, useEffect, useState } from 'react';

export function Button({ variant = 'primary', size, className = '', type = 'button', children, ...rest }) {
  const cls = ['btn', `btn--${variant}`, size ? `btn--${size}` : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', className = '', children, ...rest }) {
  return (
    <span className={`badge badge--${tone} ${className}`} {...rest}>
      {children}
    </span>
  );
}

export function DataTable({ columns = [], rows = [], rowKey, empty, onRowClick, className = '', ...rest }) {
  if (!rows.length && empty) return empty;
  return (
    <div className={`tabela-wrap ${className}`} {...rest}>
      <table className="tabela">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.alinhar === 'direita' ? 'ta-right' : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row) : row.id || i}
              className={onRowClick ? 'tabela__linha--clicavel' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.alinhar === 'direita' ? 'ta-right' : undefined}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Field({ label, children, hint, required, htmlFor }) {
  return (
    <div className="campo">
      <label className="campo__rotulo" htmlFor={htmlFor}>
        {label}
        {required ? <span className="campo__req"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="campo__dica">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`input ${className}`} {...rest} />;
});

export const Select = forwardRef(function Select({ className = '', children, ...rest }, ref) {
  return <select ref={ref} className={`input input--select ${className}`} {...rest}>{children}</select>;
});

export const Textarea = forwardRef(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`input input--area ${className}`} {...rest} />;
});

export function Modal({ open, title, children, actions, onClose, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-fundo" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={`modal ${wide ? 'modal--largo' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="modal__cabeca">
          <h2>{title}</h2>
          {onClose ? (
            <button type="button" className="modal__fechar" aria-label="Fechar" onClick={onClose}>×</button>
          ) : null}
        </header>
        <div className="modal__corpo">{children}</div>
        {actions ? <footer className="modal__acoes">{actions}</footer> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      actions={(
        <>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      <p>{message}</p>
    </Modal>
  );
}

/* Toasts - módulo simples com subscrição do ToastHost. */
let toastListener = null;
let toastSeq = 0;

export function toast(message, options = {}) {
  if (toastListener) toastListener({ id: ++toastSeq, message, tone: options.tone || 'info' });
}

export function ToastHost() {
  const [itens, setItens] = useState([]);
  useEffect(() => {
    toastListener = (t) => {
      setItens((prev) => [...prev, t]);
      setTimeout(() => setItens((prev) => prev.filter((x) => x.id !== t.id)), 4200);
    };
    return () => { toastListener = null; };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {itens.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>{t.message}</div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }) {
  return (
    <div className="vazio">
      {icon ? <div className="vazio__icone">{icon}</div> : null}
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action || null}
    </div>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton__linha" />)}
    </div>
  );
}

export function Tabs({ tabs = [], active, onChange, className = '' }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`tabs__tab ${active === t.id ? 'tabs__tab--ativa' : ''}`}
          onClick={() => onChange(t.id)}
          data-demo-target={t.demoTarget}
        >
          {t.label}
          {t.badge != null && t.badge !== 0 ? <span className="tabs__badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, className = '', ...rest }) {
  return (
    <input
      type="search"
      className={`input input--pesquisa ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      {...rest}
    />
  );
}

export function Stat({ label, value, sub, tone, demoTarget }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`} data-demo-target={demoTarget}>
      <p className="stat__rotulo">{label}</p>
      <p className="stat__valor">{value}</p>
      {sub ? <p className="stat__sub">{sub}</p> : null}
    </div>
  );
}
