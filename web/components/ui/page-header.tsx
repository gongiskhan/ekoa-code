'use client';
import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, icon: Icon, actions, children }: PageHeaderProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          {Icon && (
            <span
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal-600/10 bg-accent-soft text-accent"
              aria-hidden
            >
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-neutral-900">{title}</h1>
            {description && <p className="mt-1.5 max-w-2xl text-sm text-neutral-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
