"use client";

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Wand2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/stores/i18n';
import InlineEdit from './inline-edit';
import StepTypeSelector from './step-type-selector';
import IntegrationActionPicker from './integration-action-picker';
import SubAutomationPicker from './sub-automation-picker';
import { ApiCallForm, EkoaActionForm, LocalCommandForm } from './step-forms';
import type {
  ApiCallBodyKind,
  ApiCallMethod,
  ApiCallSpec,
  EkoaActionSpec,
  LocalCommandSpec,
  Step,
  StepType,
} from '@/types/automation';
import type { StepPatchInfo } from '@/lib/automations/activity-state';

interface StepCardProps {
  step: Step;
  index: number;
  /** Excluded automation id (so the sub-automation picker can hide it). */
  selfAutomationId?: string;
  onChange: (next: Step) => void;
  onDelete: () => void;
  /** Live status from the run viewer; undefined when no live run. */
  liveStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** Whether the rehearsal fixer has touched this step. */
  patchInfo?: StepPatchInfo;
}

const STATUS_BADGE: Record<NonNullable<StepCardProps['liveStatus']>, string> = {
  pending: 'bg-neutral-200 text-neutral-700',
  running: 'bg-amber-200 text-amber-900',
  completed: 'bg-emerald-200 text-emerald-900',
  failed: 'bg-red-200 text-red-900',
  skipped: 'bg-neutral-200 text-neutral-500',
};

export default function StepCard({
  step,
  index,
  selfAutomationId,
  onChange,
  onDelete,
  liveStatus,
  patchInfo,
}: StepCardProps) {
  const { automations } = useTranslation();
  const t = automations.steps;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const setType = (next: StepType) => {
    const cleared: Step = { id: step.id, description: step.description, type: next };
    if (step.expectedOutcome) cleared.expectedOutcome = step.expectedOutcome;
    onChange(cleared);
  };

  const update = (patch: Partial<Step>) => onChange({ ...step, ...patch });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group rounded-lg border border-neutral-200 bg-white shadow-sm hover:shadow transition-shadow"
    >
      <div className="flex items-start gap-2 p-3">
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t.dragStep}
          className="text-neutral-400 hover:text-neutral-700 cursor-grab active:cursor-grabbing pt-1"
        >
          <GripVertical size={16} />
        </button>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-neutral-500">{t.stepLabel(index + 1)}</span>
            <div className="flex items-center gap-1.5">
              {patchInfo?.proposing && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-800"
                  title={t.fixingTitle}
                >
                  <Spinner size="xs" />
                  {t.fixingBadge}
                </span>
              )}
              {patchInfo?.insertedByFixer && !patchInfo.proposing && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-800"
                  title={t.insertedTitle}
                >
                  <Wand2 size={11} />
                  {t.insertedBadge}
                </span>
              )}
              {patchInfo?.rewritten && !patchInfo.proposing && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-800"
                  title={t.rewrittenTitle}
                >
                  <Wand2 size={11} />
                  {t.rewrittenBadge}
                </span>
              )}
              {liveStatus && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_BADGE[liveStatus]}`}>
                  {t.status[liveStatus]}
                </span>
              )}
            </div>
          </div>

          <StepTypeSelector value={step.type} onChange={setType} />

          <InlineEdit
            value={step.description}
            onSave={(v) => update({ description: v })}
            placeholder={t.descriptionPlaceholder}
            multiline
            label={t.descriptionLabel}
          />

          {/* Type-specific inputs */}
          {step.type === 'navigate' && (
            <input
              type="url"
              value={step.url ?? ''}
              onChange={(e) => update({ url: e.target.value })}
              placeholder={t.urlPlaceholder}
              className="w-full text-sm rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          )}

          {step.type === 'wait' && (
            <div className="flex items-center gap-2 text-sm">
              <label className="text-neutral-600">{t.durationLabel}</label>
              <input
                type="number"
                value={step.durationMs ?? 1000}
                onChange={(e) => update({ durationMs: Number(e.target.value) })}
                min={0}
                step={100}
                className="w-28 rounded border border-neutral-300 bg-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          )}

          {step.type === 'integration' && (
            <IntegrationActionPicker
              integrationKey={step.integrationKey}
              actionName={step.integrationAction}
              onChange={(k, a) => update({ integrationKey: k, integrationAction: a })}
            />
          )}

          {step.type === 'sub_automation' && (
            <SubAutomationPicker
              automationId={step.subAutomationId}
              excludeId={selfAutomationId}
              onChange={(id) => update({ subAutomationId: id })}
            />
          )}

          {step.type === 'local_command' && (
            <LocalCommandForm
              value={step.commandTemplate}
              onChange={(spec) => update({ commandTemplate: spec })}
            />
          )}

          {step.type === 'api_call' && (
            <ApiCallForm
              value={step.apiRequest}
              onChange={(spec) => update({ apiRequest: spec })}
            />
          )}

          {step.type === 'ekoa_action' && (
            <EkoaActionForm
              value={step.ekoaAction}
              onChange={(spec) => update({ ekoaAction: spec })}
            />
          )}

          {/* Expected outcome (used by browser + verify; optional elsewhere) */}
          {(step.type === 'browser' || step.type === 'verify' || step.type === 'local_command' || step.type === 'api_call' || step.type === 'ekoa_action') && (
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                {t.expectedOutcome} {step.type === 'verify' ? t.requiredParen : t.optionalParen}
              </div>
              <InlineEdit
                value={step.expectedOutcome ?? ''}
                onSave={(v) => update({ expectedOutcome: v || undefined })}
                placeholder={t.expectedOutcomePlaceholder}
                multiline
                label={t.expectedOutcomeLabel}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onDelete}
          aria-label={t.deleteStep}
          className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-600 transition-opacity pt-1"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
