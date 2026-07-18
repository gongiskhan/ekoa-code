'use client';
import type React from 'react';
import { Check } from 'lucide-react';

interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'onClick'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, disabled, className, ...rest }: CheckboxProps) {
  return (
    <label className={`inline-flex items-center gap-2.5 cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className || ''}`}>
      <button
        type="button"
        {...rest}
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`
          relative flex h-5 w-5 items-center justify-center rounded-md border pressable focus-ring
          ${checked
            ? 'border-teal-600 bg-teal-600 shadow-card'
            : 'border-neutral-300 bg-surface shadow-card hover:border-teal-400'
          }
        `}
      >
        {checked && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
      </button>
      {label && <span className="text-sm text-neutral-700">{label}</span>}
    </label>
  );
}
