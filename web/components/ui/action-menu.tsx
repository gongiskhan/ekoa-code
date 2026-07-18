'use client';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ActionDef } from '@/lib/os/types';
import { IconButton } from './button';

/**
 * The one menu primitive of the actions model (surface contract 3.1/3.2): a
 * surface/item declares its ActionDef list ONCE and this popover renders it
 * for all three triggers - the always-visible "..." button, right-click, and
 * long-press. Portaled to body and anchored to the trigger coords; a transient
 * popover is not a window-containment violation (it is visually attached to
 * its trigger and dismissed on any outside interaction).
 */

export interface ActionMenuPosition {
  x: number;
  y: number;
}

interface ActionMenuProps<Ctx> {
  items: ActionDef<Ctx>[];
  ctx: Ctx;
  position: ActionMenuPosition | null;
  onClose: () => void;
}

const MENU_MARGIN = 8;

export function ActionMenu<Ctx>({ items, ctx, position, onClose }: ActionMenuProps<Ctx>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<ActionMenuPosition | null>(null);

  // Availability only runs while the menu is open - a closed menu may have a
  // null/absent ctx (the caller builds it per target on open).
  const visible = position !== null
    ? items.filter((a) => (a.available ? a.available(ctx) : true))
    : [];
  const ordered = [...visible.filter((a) => !a.destructive), ...visible.filter((a) => a.destructive)];
  const open = position !== null && ordered.length > 0;

  // Clamp into the viewport once the panel has a size.
  useLayoutEffect(() => {
    if (!position) {
      setPlaced(null);
      return;
    }
    const el = panelRef.current;
    if (!el) {
      setPlaced(position);
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - width - MENU_MARGIN);
    const y = Math.min(position.y, window.innerHeight - height - MENU_MARGIN);
    setPlaced({ x: Math.max(MENU_MARGIN, x), y: Math.max(MENU_MARGIN, y) });
  }, [position]);

  // Outside interaction + Escape close; arrow-key focus cycling.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const panel = panelRef.current;
      if (!panel) return;
      e.preventDefault();
      const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      if (buttons.length === 0) return;
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'ArrowDown'
          ? buttons[(idx + 1) % buttons.length]
          : buttons[(idx - 1 + buttons.length) % buttons.length];
      next.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && position && (
        <motion.div
          ref={panelRef}
          role="menu"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.12, ease: [0.25, 1, 0.5, 1] }}
          className="fixed z-[95] min-w-[180px] rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
          style={{ left: (placed ?? position).x, top: (placed ?? position).y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ordered.map((action, i) => {
            const Icon = action.icon;
            const firstDestructive = action.destructive && i > 0 && !ordered[i - 1].destructive;
            return (
              <React.Fragment key={action.id}>
                {firstDestructive && <div className="my-1 border-t border-neutral-100" />}
                <button
                  role="menuitem"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:bg-neutral-100 ${
                    action.destructive
                      ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                  onClick={() => {
                    onClose();
                    void action.run(ctx);
                  }}
                >
                  {Icon && <Icon size={13} aria-hidden className="shrink-0" />}
                  {action.label}
                </button>
              </React.Fragment>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface ActionMenuButtonProps {
  onOpen: (position: ActionMenuPosition) => void;
  label: string;
  className?: string;
}

/**
 * The standardized always-visible "..." trigger (never hover-gated - touch has
 * no hover). Opens the menu anchored under the button.
 */
export function ActionMenuButton({ onOpen, label, className }: ActionMenuButtonProps) {
  return (
    <IconButton
      icon={MoreHorizontal}
      label={label}
      size="sm"
      variant="ghost"
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onOpen({ x: rect.left, y: rect.bottom + 4 });
      }}
    />
  );
}
