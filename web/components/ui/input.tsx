'use client';
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { fieldClasses, labelClasses, hintClasses, errorTextClasses, useFieldId } from './field';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: LucideIcon;
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leftIcon: LeftIcon, className, wrapperClassName, id, ...rest },
  ref,
) {
  const inputId = useFieldId(label, id);
  const describedById = `${inputId}-desc`;
  const hasDescription = Boolean(error || hint);
  return (
    <div className={wrapperClassName}>
      {label && (
        <label htmlFor={inputId} className={labelClasses}>
          {label}
        </label>
      )}
      <div className="relative">
        {LeftIcon && (
          <LeftIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasDescription ? describedById : undefined}
          className={`${fieldClasses(!!error)} ${LeftIcon ? 'pl-9' : ''} ${className ?? ''}`}
          {...rest}
        />
      </div>
      {error && (
        <p id={describedById} className={errorTextClasses}>
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={describedById} className={hintClasses}>
          {hint}
        </p>
      )}
    </div>
  );
});
