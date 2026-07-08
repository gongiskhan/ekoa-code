"use client";

import { Lock, Building2 } from "lucide-react";

/**
 * Ownership x visibility control (Amendment 2, FC-503). Surfaces the shared
 * `visibility` field ('private' | 'org') on artifacts and memories with the
 * binding PT-PT labels. Promotion to 'org' and demotion to 'private' are manual
 * owner actions; org-shared artifacts are editable by org members. The
 * git-snapshot safety note (every mutation is versioned, restorable, and in the
 * Registo) is carried inline so sharing reads as safe.
 */

export type Visibility = "private" | "org";

const OPTIONS: { value: Visibility; label: string; icon: typeof Lock }[] = [
  { value: "private", label: "Privado", icon: Lock },
  { value: "org", label: "Partilhado com o escritório", icon: Building2 },
];

export function VisibilityControl({
  value,
  onChange,
  disabled = false,
  showSafetyNote = false,
  className = "",
}: {
  value: Visibility;
  onChange: (value: Visibility) => void;
  disabled?: boolean;
  showSafetyNote?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        className="inline-flex rounded-lg border border-line overflow-hidden"
        role="group"
        aria-label="Visibilidade"
        data-testid="visibility-control"
      >
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && !selected && onChange(opt.value)}
              aria-pressed={selected}
              data-testid={`visibility-${opt.value}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors focus-ring ${
                selected
                  ? "bg-teal-600 text-white"
                  : "bg-surface text-neutral-500 hover:text-neutral-900"
              } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <Icon size={13} aria-hidden />
              {opt.label}
            </button>
          );
        })}
      </div>
      {showSafetyNote && (
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          Partilhar é seguro: cada alteração fica versionada e reponível, e é registada no
          Registo. Um artefacto partilhado com o escritório pode ser editado pelos membros da
          organização.
        </p>
      )}
    </div>
  );
}
