"use client";

/**
 * PER-INTEGRATION LESSONS (slice C3) — the dashboard surface for the operational knowledge an
 * integration accumulates ("this portal rejects requests without a Referer", "the sandbox key
 * expires weekly"). What is typed here is concatenated onto the integration's SKILL.md and reaches
 * the agent that uses it, so the copy says that plainly rather than leaving it to be discovered.
 *
 * THE TWO WAYS A TEXTAREA LOSES SOMEONE'S WORK, and what this one does instead:
 *
 *  1. TRUNCATION. The server refuses an over-length body; it never trims. So the counter is always
 *     visible (not only near the limit), it turns into a refusal above the ceiling, and Save is
 *     disabled with the reason stated — the limit is never discovered by having text disappear.
 *
 *  2. LOST UPDATES. Every save echoes the `updatedAt` this editor loaded. If the row moved in the
 *     meantime the server refuses (`stale`) and returns what is actually stored. The panel then
 *     shows BOTH versions and asks: keep typing, take theirs, or overwrite. The draft is never
 *     replaced without the human saying so, and "overwrite" is a second, deliberate click.
 *
 * READ-ONLY IS A FIRST-CLASS STATE, not a disabled button. `editable: false` means the api handed
 * back the SCRUBBED view (the raw bytes belong to the people who may save the definition), so the
 * textarea is genuinely read-only and says why. Offering an edit that the server would refuse is
 * the same class of lie as truncating.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Lock } from "lucide-react";
import type { IntegrationLessonsView } from "@ekoa/shared";
import { INTEGRATION_LESSONS_MAX_CHARS } from "@ekoa/shared";
import { useTranslation } from "@/stores/i18n";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/stores/toast";
import { defaultLessonsTransport, type LessonsTransport } from "@/lib/integrations/lessons";

interface LessonsPanelProps {
  integrationKey: string;
  /** Injected in tests; production uses the typed-client transport. */
  transport?: LessonsTransport;
}

/** The conflict a `stale` save produced: the text the server holds, alongside the untouched draft. */
interface LessonsConflict {
  theirs: IntegrationLessonsView;
}

type PanelState =
  | { phase: "loading" }
  /** No lessons row for this key (a shipped package, or one this user cannot see): render nothing. */
  | { phase: "absent" }
  | { phase: "error"; message: string }
  | { phase: "ready"; view: IntegrationLessonsView };

export function LessonsPanel({ integrationKey, transport = defaultLessonsTransport }: LessonsPanelProps) {
  const { pages, common } = useTranslation();
  const t = pages.integrations;

  const [state, setState] = useState<PanelState>({ phase: "loading" });
  const [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState<LessonsConflict | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  /** The stamp the CURRENT draft was based on — the concurrency token echoed on every save. */
  const baseUpdatedAt = useRef<string | undefined>(undefined);

  const adopt = useCallback((view: IntegrationLessonsView) => {
    setState({ phase: "ready", view });
    setDraft(view.lessons);
    baseUpdatedAt.current = view.updatedAt;
    setConflict(null);
  }, []);

  // The initial state IS `loading`, and the call site remounts on a key change (`key={editKey}`),
  // so this effect never has to reset state synchronously — it only ever fills it in.
  useEffect(() => {
    let cancelled = false;
    void transport.load(integrationKey).then((res) => {
      if (cancelled) return;
      if (res.kind === "ready") adopt(res.view);
      else if (res.kind === "absent") setState({ phase: "absent" });
      else setState({ phase: "error", message: res.message });
    });
    return () => { cancelled = true; };
  }, [integrationKey, transport, adopt]);

  const overLimit = draft.length > INTEGRATION_LESSONS_MAX_CHARS;
  const editable = state.phase === "ready" && state.view.editable;
  const dirty = state.phase === "ready" && draft !== state.view.lessons;

  /** `force` drops the concurrency token: the explicit "overwrite theirs" the conflict box offers. */
  const save = useCallback(async (force: boolean) => {
    if (state.phase !== "ready") return;
    setIsSaving(true);
    const res = await transport.save(
      integrationKey,
      draft,
      force ? undefined : baseUpdatedAt.current,
    );
    setIsSaving(false);
    if (res.kind === "saved") {
      adopt(res.view);
      toast.success(t.lessonsSaved);
      return;
    }
    if (res.kind === "stale") {
      // The draft stays exactly as typed. Only the token moves, so a subsequent ordinary Save is
      // still guarded — the human must choose take-theirs or overwrite.
      setConflict({ theirs: res.view });
      return;
    }
    toast.error(res.message);
  }, [state.phase, transport, integrationKey, draft, adopt, t.lessonsSaved]);

  if (state.phase === "absent") return null;

  if (state.phase === "loading") {
    return (
      <div className="flex items-center gap-2 py-3">
        <Spinner size="sm" className="text-teal-600" />
        <span className="text-xs text-neutral-400">{common.loading}</span>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg" role="alert">
        <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-red-700">{state.message}</p>
      </div>
    );
  }

  return (
    <div data-testid="lessons-panel">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-50 to-teal-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <BookOpen size={15} className="text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-neutral-800">{t.lessons}</h3>
            {!editable && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded-full">
                <Lock size={10} />
                {t.lessonsReadOnly}
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">{t.lessonsHint}</p>
        </div>
      </div>

      {!editable && (
        <p className="text-[11px] text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 mb-2">
          {t.lessonsReadOnlyHint}
        </p>
      )}

      <textarea
        aria-label={t.lessons}
        value={draft}
        readOnly={!editable}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={8}
        placeholder={t.lessonsPlaceholder}
        className={`w-full bg-neutral-50 border rounded-lg py-3 px-4 text-xs font-mono text-neutral-700 leading-relaxed focus:outline-none focus:ring-1 transition-colors resize-y min-h-[140px] placeholder:text-neutral-300 ${
          overLimit
            ? "border-red-300 focus:border-red-400 focus:ring-red-500/20"
            : "border-neutral-200 focus:border-teal-400 focus:ring-teal-500/20"
        } ${editable ? "" : "opacity-70 cursor-default"}`}
        style={{ tabSize: 2 }}
      />

      <div className="flex items-center justify-between mt-2 gap-3">
        <p
          data-testid="lessons-counter"
          className={`text-[11px] tabular-nums ${overLimit ? "text-red-600 font-medium" : "text-neutral-400"}`}
        >
          {t.lessonsCounter(draft.length, INTEGRATION_LESSONS_MAX_CHARS)}
          {overLimit && <span className="ml-2">{t.lessonsTooLong}</span>}
        </p>
        {editable && (
          <Button
            variant="secondary"
            size="sm"
            loading={isSaving}
            disabled={!dirty || overLimit}
            onClick={() => void save(false)}
          >
            {t.lessonsSave}
          </Button>
        )}
      </div>

      {conflict && (
        <div
          data-testid="lessons-conflict"
          role="alert"
          className="mt-3 border border-amber-300 bg-amber-50 rounded-lg p-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-amber-900">{t.lessonsConflictTitle}</p>
              <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">{t.lessonsConflictHint}</p>
              <pre
                data-testid="lessons-conflict-theirs"
                className="mt-2 bg-white/70 rounded p-2 text-[11px] font-mono text-neutral-600 overflow-x-auto max-h-40 border border-amber-200/60 whitespace-pre-wrap"
              >
                {conflict.theirs.lessons}
              </pre>
              <div className="flex items-center gap-2 mt-2">
                <Button variant="secondary" size="sm" onClick={() => adopt(conflict.theirs)}>
                  {t.lessonsTakeTheirs}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={isSaving}
                  disabled={overLimit}
                  onClick={() => void save(true)}
                >
                  {t.lessonsOverwrite}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
