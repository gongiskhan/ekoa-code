"use client";

import type { StepType } from '@/types/automation';
import { useTranslation } from '@/stores/i18n';

interface StepTypeSelectorProps {
  value: StepType;
  onChange: (next: StepType) => void;
}

const TYPES: Array<{ value: StepType; accent: string }> = [
  { value: 'browser',        accent: 'teal'    },
  { value: 'verify',         accent: 'indigo'  },
  { value: 'integration',    accent: 'amber'   },
  { value: 'sub_automation', accent: 'violet'  },
  { value: 'navigate',       accent: 'slate'   },
  { value: 'wait',           accent: 'slate'   },
  { value: 'local_command',  accent: 'orange'  },
  { value: 'api_call',       accent: 'blue'    },
  { value: 'ekoa_action',    accent: 'emerald' },
];

const ACCENT_ACTIVE: Record<string, string> = {
  teal: 'bg-teal-600 text-white border-teal-600',
  indigo: 'bg-indigo-600 text-white border-indigo-600',
  amber: 'bg-amber-600 text-white border-amber-600',
  violet: 'bg-violet-600 text-white border-violet-600',
  slate: 'bg-slate-600 text-white border-slate-600',
  orange: 'bg-orange-600 text-white border-orange-600',
  blue: 'bg-blue-600 text-white border-blue-600',
  emerald: 'bg-emerald-600 text-white border-emerald-600',
};

export default function StepTypeSelector({ value, onChange }: StepTypeSelectorProps) {
  const { automations } = useTranslation();
  const labels = automations.stepTypes;
  return (
    <div className="flex flex-wrap gap-1.5">
      {TYPES.map((t) => {
        const active = t.value === value;
        const copy = labels[t.value];
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            title={copy.hint}
            className={[
              'text-xs px-2.5 py-1 rounded-full border transition-colors',
              active
                ? ACCENT_ACTIVE[t.accent] ?? 'bg-teal-600 text-white border-teal-600'
                : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50',
            ].join(' ')}
          >
            {copy.label}
          </button>
        );
      })}
    </div>
  );
}
