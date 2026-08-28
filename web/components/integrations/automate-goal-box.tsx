"use client";

/**
 * The free-text door (cornerstone K5, D-CORNERSTONE-DOORS): a goal box on the Integrations
 * surface. Submitting plans the step sequence (POST /automations/plan), which - mint-on-plan,
 * K1 - creates or extends the per-site "Minha Integração" carrying the wrapper action, then
 * navigates to that integration's detail page with the action deep-linked, where the run history,
 * evidence and run-now already live. The rehearsal the plan kicks off keeps running server-side;
 * its pause/consent overlays surface through the existing run plumbing.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";
import { useAutomationsStore } from "@/stores/automations";
import { useTranslation } from "@/stores/i18n";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";

export function AutomateGoalBox() {
  const router = useRouter();
  const { pages } = useTranslation();
  const t = pages.integrations;
  const planFromGoal = useAutomationsStore((s) => s.planFromGoal);
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);

  const submit = async () => {
    const trimmed = goal.trim();
    if (trimmed === "" || planning) return;
    setPlanning(true);
    try {
      const result = await planFromGoal(trimmed);
      if (!result.ok) {
        if (result.awaiting) {
          // The plan may omit the service name; an empty quoted "" reads broken, so fall back to
          // the planner's own reason (or the generic sentence) instead.
          toast.error(
            result.awaiting.service !== ''
              ? t.goalBoxAwaitingIntegration(result.awaiting.service)
              : result.awaiting.reason || t.goalBoxPlannedNoMint,
          );
        } else {
          toast.error(result.error ?? t.goalBoxPlannedNoMint);
        }
        return;
      }
      setGoal("");
      if (result.integration) {
        toast.success(t.goalBoxMinted(result.integration.key));
        router.push(`/integrations/${encodeURIComponent(result.integration.key)}?action=${encodeURIComponent(result.integration.actionName)}`);
      } else {
        // Planned but not minted (no outside origin, or the mint refused): the sequence still
        // exists and rehearses; there is just no integration card to land on.
        toast.success(t.goalBoxPlannedNoMint);
      }
    } finally {
      setPlanning(false);
    }
  };

  return (
    <div
      data-testid="automate-goal-box"
      className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-neutral-800">{t.goalBoxTitle}</h3>
        <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">{t.goalBoxSubtitle}</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <textarea
          data-testid="automate-goal-input"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={t.goalBoxPlaceholder}
          rows={2}
          disabled={planning}
          className="flex-1 resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:bg-neutral-50"
        />
        <div className="flex items-end">
          <Button
            variant="primary"
            icon={Wand2}
            loading={planning}
            disabled={goal.trim() === ""}
            onClick={() => void submit()}
            data-testid="automate-goal-submit"
          >
            {planning ? t.goalBoxPlanning : t.goalBoxSubmit}
          </Button>
        </div>
      </div>
    </div>
  );
}
