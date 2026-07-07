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
      <div className="rounded-full bg-neutral-100 p-3">
        <Icon size={28} className="text-neutral-300" aria-hidden />
      </div>
      <p className="mt-4 text-sm font-medium text-neutral-600">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-neutral-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
