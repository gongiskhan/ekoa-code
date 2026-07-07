"use client";

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/stores/i18n';

interface InlineEditProps {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  /** Aria label for screen readers. */
  label?: string;
}

/**
 * Click-to-edit text. No markdown, no syntax highlighting — automation
 * step descriptions are plain English. Single-line by default; opt-in
 * multiline switches to a textarea.
 */
export default function InlineEdit({
  value,
  onSave,
  placeholder,
  multiline = false,
  className = '',
  label,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const { automations } = useTranslation();
  const t = automations.steps;

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(draft.length, draft.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (!multiline || (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      commit();
    }
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={(el) => { inputRef.current = el; }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={label}
          className={`w-full min-h-[80px] resize-vertical bg-white border border-teal-300 rounded px-2 py-1.5 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-teal-500 ${className}`}
        />
      );
    }
    return (
      <input
        ref={(el) => { inputRef.current = el; }}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        placeholder={placeholder}
        aria-label={label}
        className={`w-full bg-white border border-teal-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 ${className}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={label ?? t.editAria}
      className={`w-full text-left rounded px-2 py-1 text-sm hover:bg-neutral-100 cursor-text whitespace-pre-wrap ${value ? 'text-neutral-900' : 'text-neutral-400 italic'} ${className}`}
    >
      {value || placeholder || t.clickToEdit}
    </button>
  );
}
