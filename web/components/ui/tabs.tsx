'use client';
import React, { useId, useRef } from 'react';
import { motion } from 'framer-motion';
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

// Spring shared by both active-indicator variants: fast, minimal overshoot.
const indicatorSpring = { type: 'spring', stiffness: 500, damping: 40 } as const;

export function Tabs({ items, value, onChange, variant = 'underline', className }: TabsProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Per-instance layoutId so two Tabs on one page never swap indicators.
  const instanceId = useId();

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
          ? `relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-ring ${
              active ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'
            }`
          : `relative inline-flex items-center gap-1.5 pb-2.5 text-sm transition-colors focus-ring ${
              active
                ? 'font-medium text-teal-700'
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
            {active && isPills && (
              <motion.span
                layoutId={`tabs-pill-${instanceId}`}
                transition={indicatorSpring}
                className="absolute inset-0 rounded-md bg-surface shadow-card"
                aria-hidden
              />
            )}
            {active && !isPills && (
              <motion.span
                layoutId={`tabs-underline-${instanceId}`}
                transition={indicatorSpring}
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-600"
                aria-hidden
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon && <Icon className="h-4 w-4" aria-hidden />}
              {item.label}
              {typeof item.count === 'number' && <Badge tone="neutral">{item.count}</Badge>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
