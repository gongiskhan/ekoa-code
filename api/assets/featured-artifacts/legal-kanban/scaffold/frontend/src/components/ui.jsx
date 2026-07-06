/*
 * Primitivos de UI partilhados pela suite jurídica - CANÓNICO.
 *
 * Estilados pelas classes de `styles.css` (sem estilos inline, salvo pormenores
 * mínimos). Todos exportados por nome; aceitam `data-testid` por passagem. Sem
 * emoji; textos de UI em PT-PT.
 */

import { forwardRef, useCallback, useEffect, useState } from 'react';
import { IconSearch, IconClose } from './Icons.jsx';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Botão ---------- */

export function Button({ variant = 'primary', size, className, type = 'button', children, ...rest }) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------- Distintivos ---------- */

export function Badge({ tone = 'neutral', className, children, ...rest }) {
  return (
    <span className={cx('badge', `badge-${tone}`, className)} {...rest}>
      {children}
    </span>
  );
}

const URGENCIA_TONE = { alta: 'alta', media: 'media', baixa: 'baixa' };
const URGENCIA_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

export function UrgencyBadge({ urgencia, ...rest }) {
  const tone = URGENCIA_TONE[urgencia] || 'neutral';
  const label = URGENCIA_LABEL[urgencia] || urgencia || '—';
  return <Badge tone={tone} {...rest}>{label}</Badge>;
}

/* ---------- Tabela de dados ---------- */

export function DataTable({ columns = [], rows = [], rowKey, empty, onRowClick, className, ...rest }) {
  const keyOf = (row, i) => {
    if (typeof rowKey === 'function') return rowKey(row, i);
    if (typeof rowKey === 'string') return row[rowKey];
    return row.id ?? i;
  };

  if (!rows || rows.length === 0) {
    return (
      <div className="table-empty" {...rest}>
        {empty || 'Sem registos.'}
      </div>
    );
  }

  return (
    <div className={cx('table-wrap', className)} {...rest}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined} className={col.align === 'right' ? 'numeric' : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={keyOf(row, i)}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              className={onRowClick ? 'is-clickable' : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={col.align === 'right' ? 'numeric' : undefined}>
                  {col.render ? col.render(row, i) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Campos de formulário ---------- */

export function Field({ label, children, hint, required, htmlFor }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      {label && (
        <span className="field-label">
          {label}
          {required && <span className="field-required" aria-hidden="true"> *</span>}
        </span>
      )}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('input', 'field-input', className)} {...rest} />;
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('select', 'field-select', className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('textarea', 'field-textarea', className)} {...rest} />;
});

/* ---------- Modal ---------- */

export function Modal({ open, title, children, actions, onClose, className, ...rest }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={cx('modal', className)} role="dialog" aria-modal="true" {...rest}>
        {(title || onClose) && (
          <div className="modal-header">
            {title && <h2 className="modal-title">{title}</h2>}
            {onClose && (
              <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}>
                <IconClose />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-footer modal-actions">{actions}</div>}
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
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      {message && <p className="text-muted" style={{ margin: 0 }}>{message}</p>}
    </Modal>
  );
}

/* ---------- Toasts (barramento de eventos ao nível do módulo) ---------- */

let toastSeq = 0;
const toastListeners = new Set();

export function toast(message, options = {}) {
  const entry = { id: ++toastSeq, message, tone: options.tone || 'info' };
  toastListeners.forEach((fn) => fn(entry));
  return entry.id;
}

export function useToast() {
  return toast;
}

export function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    // Track pending auto-dismiss timers so we can clear them on unmount and
    // never setState after the host is gone.
    const timers = new Set();
    const onToast = (entry) => {
      setToasts((prev) => [...prev, entry]);
      const handle = setTimeout(() => {
        timers.delete(handle);
        setToasts((prev) => prev.filter((t) => t.id !== entry.id));
      }, 4000);
      timers.add(handle);
    };
    toastListeners.add(onToast);
    return () => {
      toastListeners.delete(onToast);
      for (const handle of timers) clearTimeout(handle);
      timers.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.tone === 'error' && 'toast-error', t.tone === 'ok' && 'toast-ok')}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ---------- Estado vazio ---------- */

export function EmptyState({ icon, title, hint, action }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      {title && <p className="empty-title">{title}</p>}
      {hint && <p className="empty-text">{hint}</p>}
      {action}
    </div>
  );
}

/* ---------- Esqueleto de carregamento ---------- */

export function Skeleton({ lines = 3 }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: Math.max(1, lines) }).map((_, i) => (
        <div key={i} className="skeleton skeleton-line" />
      ))}
    </div>
  );
}

/* ---------- Separadores (tabs) ---------- */

export function Tabs({ tabs = [], active, onChange, className, ...rest }) {
  return (
    <div className={cx('tabs', className)} role="tablist" {...rest}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={cx('tab', active === tab.id && 'is-active')}
          onClick={() => onChange && onChange(tab.id)}
        >
          <span>{tab.label}</span>
          {tab.badge != null && <span className="tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Caixa de pesquisa ---------- */

export function SearchInput({ value, onChange, placeholder = 'Pesquisar…', className, ...rest }) {
  const handle = useCallback((e) => { if (onChange) onChange(e.target.value); }, [onChange]);
  return (
    <div className={cx('search-input', className)}>
      <IconSearch />
      <input
        type="search"
        value={value}
        onChange={handle}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}
