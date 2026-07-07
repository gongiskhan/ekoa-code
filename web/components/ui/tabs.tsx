'use client';
import React, { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from './badge';

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
  testId?: string;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  variant?: 'underline' | 'pills';
  className?: string;
}

export function Tabs({ items, value, onChange, variant = 'underline', className }: TabsProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = (index: number) => {
    const item = items[index];
    if (!item) return;
    onChange(item.key);
    buttonRefs.current[index]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    focusTab(next);
  };

  const isPills = variant === 'pills';
  const containerClass = isPills
    ? `inline-flex rounded-lg bg-neutral-100 p-0.5 ${className ?? ''}`
    : `flex gap-6 border-b border-line ${className ?? ''}`;

  return (
    <div className={containerClass} role="tablist">
      {items.map((item, index) => {
        const active = item.key === value;
        const Icon = item.icon;
        const buttonClass = isPills
          ? `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-ring ${
              active
                ? 'bg-surface text-neutral-900 shadow-card'
                : 'text-neutral-500 hover:text-neutral-700'
            }`
          : `inline-flex items-center gap-1.5 pb-2.5 text-sm transition-colors focus-ring ${
              active
                ? '-mb-px border-b-2 border-teal-600 font-medium text-teal-700'
                : 'text-neutral-500 hover:text-neutral-700'
            }`;
        return (
          <button
            key={item.key}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            data-testid={item.testId}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={buttonClass}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {item.label}
            {typeof item.count === 'number' && <Badge tone="neutral">{item.count}</Badge>}
          </button>
        );
      })}
    </div>
  );
}
