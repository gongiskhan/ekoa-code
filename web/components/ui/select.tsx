'use client';
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { fieldClasses, labelClasses, hintClasses, errorTextClasses, useFieldId } from './field';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}

export function Select({
  label,
  hint,
  error,
  className,
  wrapperClassName,
  id,
  children,
  ...rest
}: SelectProps) {
  const selectId = useFieldId(label, id);
  return (
    <div className={wrapperClassName}>
      {label && (
        <label htmlFor={selectId} className={labelClasses}>
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${selectId}-desc` : undefined}
          className={`${fieldClasses(!!error)} appearance-none pr-9 ${className ?? ''}`}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          aria-hidden
        />
      </div>
      {error && (
        <p id={`${selectId}-desc`} className={errorTextClasses}>
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${selectId}-desc`} className={hintClasses}>
          {hint}
        </p>
      )}
    </div>
  );
}
