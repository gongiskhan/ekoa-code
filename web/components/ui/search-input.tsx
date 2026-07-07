'use client';
import type React from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from '@/stores/i18n';
import { fieldClasses } from './field';

interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function SearchInput({ value, onValueChange, className, ...rest }: SearchInputProps) {
  const { common } = useTranslation();
  const clearLabel = common?.clear ?? 'Limpar';
  return (
    <div className={`relative ${className ?? ''}`}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
        aria-hidden
      />
      <input
        type="text"
        {...rest}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={`${fieldClasses(false)} pl-9 pr-9`}
      />
      {value && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onValueChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md text-neutral-400 hover:text-neutral-600 focus-ring"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
