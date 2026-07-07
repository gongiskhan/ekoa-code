'use client';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type TooltipSide = 'top' | 'bottom' | 'right';

interface TooltipProps {
  label: string;
  side?: TooltipSide;
  children: React.ReactNode;
}

export function Tooltip({ label, side = 'top', children }: TooltipProps) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const show = useCallback(
    (el: HTMLElement) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const gap = 8;
        let top = r.top;
        let left = r.left + r.width / 2;
        if (side === 'top') top = r.top - gap;
        else if (side === 'bottom') top = r.bottom + gap;
        else {
          top = r.top + r.height / 2;
          left = r.right + gap;
        }
        setCoords({ top, left });
      }, 300);
    },
    [side],
  );

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCoords(null);
  }, []);

  // Clear any pending show-timer if the tooltip unmounts before it fires.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // While visible, hide on scroll so the fixed-position tooltip never drifts
  // away from its anchor.
  useEffect(() => {
    if (!coords) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [coords, hide]);

  const transform =
    side === 'top'
      ? 'translate(-50%, -100%)'
      : side === 'bottom'
        ? 'translate(-50%, 0)'
        : 'translate(0, -50%)';

  // Attach handlers + aria-describedby to the actual trigger element when
  // children is a single element (focus lands there, so the description must
  // live there too); fall back to a wrapper span otherwise. The tooltip's
  // hover/focus handlers replace any the child defines (a tooltip trigger
  // owning its own hover handlers is not a supported combination).
  const triggerProps = {
    'aria-describedby': coords ? tooltipId : undefined,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e.currentTarget),
    onMouseLeave: () => hide(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget),
    onBlur: () => hide(),
  };

  const trigger = React.isValidElement(children)
    ? // eslint-disable-next-line react-hooks/refs -- cloneElement only injects
      // handlers/aria props; it does not read or forward the child's ref.
      React.cloneElement(children as React.ReactElement<Record<string, unknown>>, triggerProps)
    : (
        <span className="inline-flex" {...triggerProps}>
          {children}
        </span>
      );

  return (
    <>
      {trigger}
      {coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            id={tooltipId}
            className="pointer-events-none fixed z-[200] rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-raised"
            style={{
              top: coords.top,
              left: coords.left,
              transform,
              animation: 'tooltip-fade 150ms ease-out',
            }}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
