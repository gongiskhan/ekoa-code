'use client';
import type React from 'react';

interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'onClick'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Switch({ checked, onChange, disabled, label, ...rest }: SwitchProps) {
  const control = (
    <button
      type="button"
      {...rest}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-ring ${
        checked ? 'bg-teal-600' : 'bg-neutral-300'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );

  if (!label) return control;

  return (
    <label className={`inline-flex items-center gap-2.5 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      {control}
      <span className="text-sm text-neutral-700">{label}</span>
    </label>
  );
}
