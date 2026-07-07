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
          relative flex items-center justify-center w-5 h-5 rounded-md border transition-all duration-150 focus-ring
          ${checked
            ? 'bg-teal-600 border-teal-600 shadow-sm'
            : 'bg-surface border-neutral-300 hover:border-teal-400'
          }
        `}
      >
        {checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </button>
      {label && <span className="text-sm text-neutral-700">{label}</span>}
    </label>
  );
}
