'use client';
import React, { useCallback, useEffect, useRef } from 'react';
import { fieldClasses, labelClasses, hintClasses, errorTextClasses, useFieldId } from './field';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  autoResize?: boolean;
  wrapperClassName?: string;
}

export function Textarea({
  label,
  hint,
  error,
  autoResize,
  className,
  wrapperClassName,
  id,
  value,
  onInput,
  ...rest
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const textareaId = useFieldId(label, id);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Controlled path: resize whenever the value prop changes.
  useEffect(() => {
    if (autoResize) resize();
  }, [autoResize, value, resize]);

  // Uncontrolled path: resize on every input event (no value prop to watch).
  const handleInput = useCallback(
    (e: React.InputEvent<HTMLTextAreaElement>) => {
      if (autoResize) resize();
      onInput?.(e);
    },
    [autoResize, resize, onInput],
  );

  return (
    <div className={wrapperClassName}>
      {label && (
        <label htmlFor={textareaId} className={labelClasses}>
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        value={value}
        onInput={handleInput}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${textareaId}-desc` : undefined}
        className={`${fieldClasses(!!error)} ${className ?? ''}`}
        {...rest}
      />
      {error && (
        <p id={`${textareaId}-desc`} className={errorTextClasses}>
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${textareaId}-desc`} className={hintClasses}>
          {hint}
        </p>
      )}
    </div>
  );
}
