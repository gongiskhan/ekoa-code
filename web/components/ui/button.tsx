'use client';
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex items-center gap-2 rounded-lg font-medium transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-teal-600 hover:bg-teal-700 text-white',
  secondary: 'bg-surface border border-line hover:bg-neutral-50 text-neutral-700',
  ghost: 'hover:bg-neutral-100 text-neutral-600',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  'danger-ghost': 'text-red-600 hover:bg-red-50',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return `${base} ${variantClasses[variant]} ${sizeClasses[size]}`;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon: Icon,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <button
      className={`${buttonClasses(variant, size)} ${className ?? ''}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === 'sm' ? 'xs' : 'sm'} />
      ) : (
        Icon && <Icon className={iconSize} aria-hidden />
      )}
      {children}
    </button>
  );
}

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  label: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  variant = 'ghost',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const squareSize = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <button
      type={type}
      aria-label={label}
      className={`${base} ${variantClasses[variant]} ${squareSize} justify-center p-0 ${className ?? ''}`}
      {...rest}
    >
      <Icon className={iconSize} aria-hidden />
    </button>
  );
}
