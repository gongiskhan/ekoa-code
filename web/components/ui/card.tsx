'use client';
import React from 'react';
import type { LucideIcon } from 'lucide-react';

type CardPadding = 'none' | 'sm' | 'md';

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
};

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  padding?: CardPadding;
  hover?: boolean;
  as?: 'div' | 'section';
}

export function Card({
  padding = 'md',
  hover = false,
  as = 'div',
  className,
  children,
  ...rest
}: CardProps) {
  const Comp: React.ElementType = as;
  return (
    <Comp
      className={`rounded-2xl border border-line bg-surface shadow-card ${paddingClasses[padding]} ${
        hover ? 'transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-raised' : ''
      } ${className ?? ''}`}
      {...rest}
    >
      {children}
    </Comp>
  );
}

interface CardTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
}

export function CardTitle({ icon: Icon, children, className, ...rest }: CardTitleProps) {
  return (
    <div
      className={`flex items-center gap-2 text-sm font-semibold text-neutral-900 ${className ?? ''}`}
      {...rest}
    >
      {Icon && <Icon className="h-4 w-4 text-teal-600" aria-hidden />}
      {children}
    </div>
  );
}

export function CardDescription({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`mt-1 text-xs text-neutral-500 ${className ?? ''}`} {...rest}>
      {children}
    </p>
  );
}
