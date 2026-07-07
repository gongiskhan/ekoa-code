"use client";

import { useEffect, useRef } from 'react';

/**
 * Prepend an alert prefix to `document.title` while `active` is true,
 * and restore the original title when it flips back to false (or on
 * unmount). Useful for grabbing the user's attention when they're on
 * another browser tab and the rehearsal pauses for them.
 *
 * Implementation notes:
 *
 * - Captures the original title LAZILY on first activation, not on
 *   every render. React 18 strict-mode double-invokes effects in dev,
 *   which would otherwise capture an already-alerted title and never
 *   restore correctly.
 * - Uses a ref (not state) for `originalRef` because the captured
 *   value is for cleanup only — we never want re-renders triggered by
 *   it.
 */
export function useDocumentTitleAlert(active: boolean, alertText: string): void {
  const originalRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (active) {
      if (originalRef.current === null) {
        originalRef.current = document.title;
      }
      document.title = `(${alertText}) ${originalRef.current}`;
    } else if (originalRef.current !== null) {
      document.title = originalRef.current;
      originalRef.current = null;
    }

    return () => {
      if (originalRef.current !== null) {
        document.title = originalRef.current;
        originalRef.current = null;
      }
    };
  }, [active, alertText]);
}
