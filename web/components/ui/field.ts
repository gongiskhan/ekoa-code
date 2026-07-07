import React from 'react';

/**
 * Shared field styles + id helper for the input/textarea/select/search family.
 * Keeping these in one place guarantees the four field primitives stay visually
 * identical and never diverge on focus ring, border, or error styling.
 */

export const labelClasses = 'mb-1.5 block text-xs font-medium text-neutral-600';
export const hintClasses = 'mt-1 text-xs text-neutral-400';
export const errorTextClasses = 'mt-1 text-xs text-red-600';

/** Base control classes; pass the field's error state to switch the border tone. */
export function fieldClasses(error?: boolean): string {
  return `w-full rounded-lg border bg-surface px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus-ring focus:border-teal-500 ${
    error ? 'border-red-300' : 'border-line'
  }`;
}

/**
 * Stable, collision-proof field id. An explicit id always wins; otherwise a
 * React.useId()-backed id is used so duplicate labels can never share an id.
 */
export function useFieldId(_label?: string, explicitId?: string): string {
  const generated = React.useId();
  return explicitId ?? `field-${generated}`;
}
