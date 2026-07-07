"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useTranslation } from '@/stores/i18n';
import StepCard from './step-card';
import type { Step, StepStatus } from '@/types/automation';
import type { StepPatchInfo } from '@/lib/automations/activity-state';

interface StepListProps {
  steps: Step[];
  selfAutomationId?: string;
  onChange: (next: Step[]) => void;
  /** Map of stepIndex → live status (from SSE events). */
  liveStatuses?: Record<number, StepStatus>;
  /** Map of stepIndex → which fixer patches have touched this step. */
  patchInfoByIndex?: Record<number, StepPatchInfo>;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

export default function StepList({
  steps,
  selfAutomationId,
  onChange,
  liveStatuses,
  patchInfoByIndex,
}: StepListProps) {
  const { automations } = useTranslation();
  const t = automations.stepList;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = steps.findIndex((s) => s.id === active.id);
    const newIndex = steps.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(steps, oldIndex, newIndex));
  };

  const updateStep = (idx: number, next: Step) => {
    const copy = [...steps];
    copy[idx] = next;
    onChange(copy);
  };

  const deleteStep = (idx: number) => {
    onChange(steps.filter((_, i) => i !== idx));
  };

  const insertAt = (idx: number) => {
    const copy = [...steps];
    copy.splice(idx, 0, {
      id: `s-${makeId()}`,
      description: '',
      type: 'browser',
    });
    onChange(copy);
  };

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {steps.length === 0 ? (
            <button
              type="button"
              onClick={() => insertAt(0)}
              className="w-full rounded-lg border-2 border-dashed border-neutral-300 px-4 py-8 text-sm text-neutral-500 hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
            >
              <Plus size={16} className="inline mr-1" />
              {t.addFirst}
            </button>
          ) : (
            steps.map((step, i) => (
              <div key={step.id}>
                <InsertSlot onClick={() => insertAt(i)} />
                <StepCard
                  step={step}
                  index={i}
                  selfAutomationId={selfAutomationId}
                  onChange={(next) => updateStep(i, next)}
                  onDelete={() => deleteStep(i)}
                  liveStatus={liveStatuses?.[i]}
                  patchInfo={patchInfoByIndex?.[i]}
                />
              </div>
            ))
          )}
          {steps.length > 0 && <InsertSlot onClick={() => insertAt(steps.length)} />}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function InsertSlot({ onClick }: { onClick: () => void }) {
  const { automations } = useTranslation();
  const t = automations.stepList;
  return (
    <div className="h-2 group relative -my-1">
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={t.insertHere}
      >
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-teal-600 text-white">
          <Plus size={12} />
          {t.addStep}
        </span>
      </button>
    </div>
  );
}
