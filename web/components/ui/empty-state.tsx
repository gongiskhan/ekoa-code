'use client';
import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center py-16 text-center ${className ?? ''}`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface shadow-card">
        <Icon size={24} className="text-neutral-400" aria-hidden />
      </div>
      <p className="mt-5 font-display text-lg font-medium text-neutral-800">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-neutral-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
