"use client";

/**
 * Super-admin usage page — hidden route (not in the sidebar).
 *
 * Shows per-user token usage and lets the super-admin reset a user's cap.
 * Non-super callers are redirected to /chat.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Gauge, RotateCcw } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBillingStore } from "@/stores/billing";
import { fmtTokens } from "@/lib/format/tokens";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/stores/toast";

function fmtDate(iso: string | null): string {
  if (!iso) return "nunca";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Human label for a usage "origin" (agentType). Pipedream Connect runs are
 * metered as `pipedream:<app>:<action>` — collapse them to a single "Pipedream"
 * origin; everything else shows its agentType verbatim.
 */
function originLabel(agentType: string): string {
  if (agentType.startsWith("pipedream:")) return "Pipedream";
  return agentType;
}

export default function UsagePage() {
  const router = useRouter();
  const confirm = useConfirm();
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const allUsage = useBillingStore((s) => s.allUsage);
  const isLoading = useBillingStore((s) => s.isAllUsageLoading);
  const fetchAllUsage = useBillingStore((s) => s.fetchAllUsage);
  const resetUsageForUser = useBillingStore((s) => s.resetUsageForUser);
  const breakdown = useBillingStore((s) => s.breakdown);
  const fetchBreakdown = useBillingStore((s) => s.fetchBreakdown);

  const isSuperAdmin = user?.role === "super-admin";

  // Gate: redirect non-super callers to /chat once auth has hydrated.
  useEffect(() => {
    if (!hasHydrated) return;
    if (!user || !isSuperAdmin) {
      router.replace("/chat");
    }
  }, [hasHydrated, user, isSuperAdmin, router]);

  useEffect(() => {
    if (hasHydrated && isSuperAdmin) {
      fetchAllUsage();
      fetchBreakdown();
    }
  }, [hasHydrated, isSuperAdmin, fetchAllUsage, fetchBreakdown]);

  if (!hasHydrated || !user || !isSuperAdmin) {
    return (
      <PageShell testId="usage-page">
        <LoadingState />
      </PageShell>
    );
  }

  async function handleReset(userId: string, username: string) {
    const ok = await confirm({
      title: `Repor consumo de ${username}?`,
      description: "O contador de tokens deste utilizador volta a zero.",
      confirmLabel: "Repor",
      tone: "danger",
    });
    if (!ok) return;
    const res = await resetUsageForUser(userId);
    if (res.success) {
      toast.success(`Consumo reposto para ${username}.`);
    } else {
      toast.error(res.error || "Falha ao repor.");
    }
  }

  return (
    <PageShell width="wide" testId="usage-page">
      <PageHeader
        icon={Gauge}
        title="Utilização"
        description="Consumo de tokens por utilizador e gestão de limites."
      />

      {isLoading && !allUsage ? (
        <LoadingState />
      ) : !allUsage || allUsage.length === 0 ? (
        <EmptyState icon={Gauge} title="Nenhum utilizador encontrado." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Utilizador</TH>
              <TH>Função</TH>
              <TH className="text-right">Usado</TH>
              <TH className="text-right">Restante</TH>
              <TH className="text-right">%</TH>
              <TH>Último início de sessão</TH>
              <TH className="text-right">Repor</TH>
            </TR>
          </THead>
          <TBody>
            {allUsage.map((row) => {
              const over = row.percentage >= 100;
              const warn = row.percentage >= 85 && row.percentage < 100;
              return (
                <TR key={row.userId} hover data-username={row.username}>
                  <TD className="font-medium text-neutral-800">{row.username}</TD>
                  <TD className="text-neutral-600">{row.role}</TD>
                  <TD
                    data-column="used"
                    className={`text-right tabular-nums ${over ? "font-semibold text-red-600" : warn ? "text-amber-700" : "text-neutral-800"}`}
                  >
                    {fmtTokens(row.tokensUsed)}
                  </TD>
                  <TD className="text-right tabular-nums text-neutral-600">
                    {fmtTokens(row.tokensRemaining)}
                  </TD>
                  <TD className="text-right">
                    <Badge tone={over ? "danger" : warn ? "warning" : "neutral"}>
                      {row.percentage}%
                    </Badge>
                  </TD>
                  <TD className="text-neutral-500">{fmtDate(row.lastLoginAt)}</TD>
                  <TD className="text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={RotateCcw}
                      data-action="reset"
                      onClick={() => handleReset(row.userId, row.username)}
                    >
                      Repor
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {breakdown.length > 0 && (
        <section className="mt-10" data-testid="usage-breakdown">
          <h2 className="font-display text-lg font-semibold tracking-tight text-neutral-900 mb-1">
            Consumo por origem
          </h2>
          <p className="text-sm text-neutral-500 mb-4">
            Repartição do consumo do período atual por origem.
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Origem</TH>
                <TH className="text-right">Tokens</TH>
                <TH className="text-right">%</TH>
              </TR>
            </THead>
            <TBody>
              {breakdown.map((row) => (
                <TR key={row.agentType} hover data-origin={originLabel(row.agentType)}>
                  <TD className="font-medium text-neutral-800">{originLabel(row.agentType)}</TD>
                  <TD className="text-right tabular-nums text-neutral-600">{fmtTokens(row.tokens)}</TD>
                  <TD className="text-right tabular-nums text-neutral-500">{Math.round(row.percentage)}%</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}
    </PageShell>
  );
}
