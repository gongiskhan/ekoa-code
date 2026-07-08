"use client";

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useOrchestrationStore } from "@/stores/orchestration";
import { useUserSettingsStore } from "@/stores/user-settings";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * First-build ask-once dialog (Amendment 2, FC-506). On the user's first-ever
 * build, one dialog asks whether to verify builds; the answer is stored as the
 * per-user setting `build.verifyBuilds` (`PATCH /settings/me`, FC-507). Asked
 * once only - a local flag records that the question was put, so it never
 * reappears. Agent questions stay reserved for app ambiguity, never process.
 *
 * Mounted once at the dashboard layout. It watches the orchestration store for
 * the first real build (a session job that reaches `running` with a job id) and
 * opens the dialog if the flag is unset.
 */

const ASKED_FLAG = "ekoa_verify_builds_asked";

export function FirstBuildDialog() {
  const setVerifyBuilds = useUserSettingsStore((s) => s.setVerifyBuilds);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Subscribe to the orchestration store rather than reading it as a hook: the
  // dialog opens from the store-change callback (not synchronously in the effect
  // body), which is the intended way to react to an external system's updates.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(ASKED_FLAG)) return;

    const maybePrompt = () => {
      if (localStorage.getItem(ASKED_FLAG)) return;
      const jobs = useOrchestrationStore.getState().sessionJobs;
      const buildStarted = Object.values(jobs).some(
        (job) => job.jobId !== null && job.status === "running",
      );
      if (buildStarted) setOpen(true);
    };

    return useOrchestrationStore.subscribe(maybePrompt);
  }, []);

  function markAsked() {
    try {
      localStorage.setItem(ASKED_FLAG, "1");
    } catch {
      /* ignore storage failures - worst case the dialog reappears next build */
    }
  }

  async function answer(verify: boolean) {
    setSaving(true);
    markAsked();
    await setVerifyBuilds(verify);
    setSaving(false);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        // Dismissing without choosing keeps the default (ON) and does not ask again.
        markAsked();
        setOpen(false);
      }}
      title="Verificar as construções?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => answer(false)} disabled={saving}>
            Não verificar
          </Button>
          <Button variant="primary" onClick={() => answer(true)} loading={saving}>
            Verificar (recomendado)
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3" data-testid="first-build-dialog">
        <FlaskConical size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
        <p className="text-sm leading-relaxed text-neutral-600">
          Podemos testar cada aplicação depois de a construir. Isto melhora a qualidade do
          resultado, mas torna a construção mais demorada e com maior custo. Pode mudar esta opção
          a qualquer momento nas definições da plataforma.
        </p>
      </div>
    </Dialog>
  );
}
