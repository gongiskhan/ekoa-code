'use client';
import React from 'react';
import type { LucideIcon } from 'lucide-react';

export function Table({ className, children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <table className={`w-full text-sm ${className ?? ''}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, children, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={`border-b border-line bg-neutral-50 ${className ?? ''}`} {...rest}>
      {children}
    </thead>
  );
}

export function TBody({ className, children, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={`divide-y divide-neutral-100 ${className ?? ''}`} {...rest}>
      {children}
    </tbody>
  );
}

interface TRProps extends React.HTMLAttributes<HTMLTableRowElement> {
  hover?: boolean;
}

export function TR({ hover = false, className, children, ...rest }: TRProps) {
  return (
    <tr className={`${hover ? 'hover:bg-neutral-50' : ''} ${className ?? ''}`} {...rest}>
      {children}
    </tr>
  );
}

export function TH({ className, children, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 ${className ?? ''}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ className, children, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3 tabular-nums ${className ?? ''}`} {...rest}>
      {children}
    </td>
  );
}

interface ListRowProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
}

export function ListRow({ icon: Icon, title, meta, badge, actions, onClick, href, className }: ListRowProps) {
  const content = (
    <>
      {Icon && <Icon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-neutral-800">{title}</div>
        {meta && <div className="mt-0.5 text-xs text-neutral-500">{meta}</div>}
      </div>
      {badge}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </>
  );
  const base = `flex items-center gap-3 px-4 py-3 transition-colors hover:bg-neutral-50 ${className ?? ''}`;
  const interactiveBase = `${base} focus-ring`;
  if (href) {
    return (
      <a href={href} className={interactiveBase}>
        {content}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`w-full text-left ${interactiveBase}`}>
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
}
