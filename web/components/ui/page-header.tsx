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
        <div className="flex items-start gap-3">
          {Icon && <Icon className="mt-1.5 h-5 w-5 shrink-0 text-teal-600" aria-hidden />}
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
            {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
