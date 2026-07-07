"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useTranslation } from "@/stores/i18n";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const { emptyState } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const rows: Array<[string, string]> = [
    ["Enter", emptyState.shortcutsModal.send],
    ["Shift + Enter", emptyState.shortcutsModal.newLine],
    ["Esc", emptyState.shortcuts.close],
    ["⌘K", emptyState.shortcuts.history],
    ["⌘/", emptyState.shortcuts.shortcuts],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="shortcuts-modal-title" className="text-base font-semibold text-neutral-900">
            {emptyState.shortcutsModal.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={emptyState.shortcutsModal.closeButton}
            className="p-1 text-neutral-400 hover:text-neutral-700 rounded transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <ul className="space-y-2.5">
          {rows.map(([key, label]) => (
            <li key={key} className="flex items-center justify-between gap-4">
              <span className="text-sm text-neutral-700">{label}</span>
              <kbd className="text-[11px] font-mono bg-neutral-100 text-neutral-700 px-2 py-1 rounded border border-neutral-200 whitespace-nowrap">
                {key}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ShortcutsModal;
