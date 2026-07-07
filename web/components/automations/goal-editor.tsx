"use client";

import { RotateCcw } from 'lucide-react';
import { useTranslation } from '@/stores/i18n';

interface GoalEditorProps {
  /** Current draft value of the goal — controlled by the parent. */
  goal: string;
  /** Notify parent of every keystroke so the goal gets persisted on Save. */
  onChange: (next: string) => void;
  /** Called when the user wants to regenerate from the current draft text. */
  onRegenerate: (goal: string) => Promise<void> | void;
  /** The saved value so we can disable Regenerate when nothing changed. */
  savedGoal?: string;
  loading?: boolean;
}

export default function GoalEditor({
  goal,
  onChange,
  onRegenerate,
  savedGoal,
  loading,
}: GoalEditorProps) {
  const trimmed = goal.trim();
  const dirty = savedGoal == null ? true : trimmed !== savedGoal.trim();
  const { automations } = useTranslation();
  const t = automations.goalEditor;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">{t.label}</label>
      <textarea
        value={goal}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.placeholder}
        className="w-full min-h-[80px] resize-vertical bg-white border border-neutral-300 rounded px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-teal-500"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">
          {t.hint}
        </p>
        <button
          type="button"
          disabled={loading || trimmed.length < 5 || !dirty}
          onClick={() => onRegenerate(trimmed)}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw size={14} />
          {loading ? t.regenerating : t.regenerate}
        </button>
      </div>
    </div>
  );
}
