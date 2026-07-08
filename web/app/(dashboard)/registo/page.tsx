"use client";

/**
 * Registo admin page (Amendment 2, FC-502).
 *
 * A filtered table over `GET /api/v1/registo` (ch03 §3.8.24): who built / ran /
 * logged what, when, and usage per user. Metadata and artifacts only - never
 * chat or message bodies (content-level oversight is an explicit future
 * decision). An org-admin sees its own org; a super-admin gets an org filter
 * (`?orgId=`) across orgs. PT-PT strings.
 *
 * Admin-gated (org-admin + super-admin); reachable from the sidebar.
 */

import { useEffect, useMemo } from "react";
import { ScrollText, AlertTriangle, X } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useUsersStore } from "@/stores/users";
import { useOrgsStore } from "@/stores/orgs";
import { useRegistoStore } from "@/stores/registo";
import { AdminGate } from "@/components/admin-gate";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-PT");
  } catch {
    return iso;
  }
}

function formatUsage(usageCounts?: Record<string, number>): string {
  if (!usageCounts) return "-";
  const entries = Object.entries(usageCounts);
  if (entries.length === 0) return "-";
  return entries.map(([key, value]) => `${key}: ${value.toLocaleString("pt-PT")}`).join(", ");
}

export default function RegistoPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isSuperAdmin = role === "super-admin";

  const entries = useRegistoStore((s) => s.entries);
  const total = useRegistoStore((s) => s.total);
  const filters = useRegistoStore((s) => s.filters);
  const isLoading = useRegistoStore((s) => s.isLoading);
  const error = useRegistoStore((s) => s.error);
  const fetchRegisto = useRegistoStore((s) => s.fetchRegisto);
  const setFilter = useRegistoStore((s) => s.setFilter);
  const clearFilters = useRegistoStore((s) => s.clearFilters);
  const clearError = useRegistoStore((s) => s.clearError);

  const users = useUsersStore((s) => s.users);
  const fetchUsers = useUsersStore((s) => s.fetchUsers);
  const orgs = useOrgsStore((s) => s.orgs);
  const fetchOrgs = useOrgsStore((s) => s.fetchOrgs);

  useEffect(() => {
    fetchRegisto();
    fetchUsers();
  }, [fetchRegisto, fetchUsers]);

  useEffect(() => {
    if (isSuperAdmin) fetchOrgs();
  }, [isSuperAdmin, fetchOrgs]);

  const usernameById = useMemo(
    () => new Map(users.map((u) => [u.id, u.username])),
    [users],
  );
  const orgNameById = useMemo(
    () => new Map(orgs.map((o) => [o.id, o.displayName ?? o.name])),
    [orgs],
  );

  const hasActiveFilters =
    filters.userId || filters.type || filters.from || filters.to || filters.orgId;

  return (
    <AdminGate allowOrgAdmin>
      <PageShell width="wide" testId="registo-page">
        <PageHeader
          icon={ScrollText}
          title="Registo"
          description="Quem construiu, executou ou registou o quê, quando, e o consumo por utilizador. Apenas metadados e artefactos - nunca conversas."
        />

        {error && (
          <Card className="flex items-center justify-between border-red-200 bg-red-50">
            <div className="flex items-center space-x-2 text-red-600">
              <AlertTriangle size={16} aria-hidden />
              <span className="text-sm">{error}</span>
            </div>
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={() => {
                clearError();
                fetchRegisto();
              }}
            >
              Tentar novamente
            </Button>
          </Card>
        )}

        {/* Filters */}
        <Card padding="sm">
          <div className="flex flex-wrap items-end gap-3">
            {isSuperAdmin && (
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">Escritório</label>
                <Select
                  value={filters.orgId}
                  onChange={(e) => setFilter("orgId", e.target.value)}
                  wrapperClassName="w-auto"
                  className="py-1.5"
                  data-testid="registo-filter-org"
                >
                  <option value="">Todos os escritórios</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.displayName ?? org.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Utilizador</label>
              <Select
                value={filters.userId}
                onChange={(e) => setFilter("userId", e.target.value)}
                wrapperClassName="w-auto"
                className="py-1.5"
                data-testid="registo-filter-user"
              >
                <option value="">Todos os utilizadores</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Tipo de ação</label>
              <Input
                value={filters.type}
                onChange={(e) => setFilter("type", e.target.value)}
                placeholder="ex.: build"
                wrapperClassName="w-40"
                data-testid="registo-filter-type"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">De</label>
              <Input
                type="date"
                value={filters.from}
                onChange={(e) => setFilter("from", e.target.value)}
                wrapperClassName="w-auto"
                data-testid="registo-filter-from"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Até</label>
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => setFilter("to", e.target.value)}
                wrapperClassName="w-auto"
                data-testid="registo-filter-to"
              />
            </div>

            <Button variant="primary" size="sm" onClick={() => fetchRegisto()}>
              Aplicar
            </Button>
            {hasActiveFilters && (
              <Button variant="secondary" size="sm" icon={X} onClick={clearFilters}>
                Limpar filtros
              </Button>
            )}
          </div>
        </Card>

        {/* Table */}
        {isLoading && entries.length === 0 ? (
          <LoadingState label="A carregar registo..." />
        ) : entries.length === 0 ? (
          <EmptyState icon={ScrollText} title="Sem entradas no registo." />
        ) : (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold tracking-wider text-neutral-400">ATIVIDADE</h2>
              <span className="text-xs text-neutral-500">{total} entradas</span>
            </div>
            <div className="overflow-x-auto">
              <Table data-testid="registo-table">
                <THead>
                  <TR>
                    <TH>Utilizador</TH>
                    <TH>Ação</TH>
                    {isSuperAdmin && <TH>Escritório</TH>}
                    <TH>Data e hora</TH>
                    <TH>Artefactos</TH>
                    <TH>Consumo</TH>
                  </TR>
                </THead>
                <TBody>
                  {entries.map((entry, i) => {
                    const orgId = (entry as { orgId?: string }).orgId;
                    return (
                      <TR key={`${entry.actor}-${entry.timestamp}-${i}`} hover>
                        <TD className="text-sm font-medium text-neutral-800">
                          {usernameById.get(entry.actor) ?? entry.actor}
                        </TD>
                        <TD>
                          <Badge tone="neutral">{entry.actionType}</Badge>
                        </TD>
                        {isSuperAdmin && (
                          <TD className="text-xs text-neutral-500">
                            {orgId ? orgNameById.get(orgId) ?? orgId : "-"}
                          </TD>
                        )}
                        <TD className="text-xs text-neutral-500">{formatTimestamp(entry.timestamp)}</TD>
                        <TD className="text-xs text-neutral-500">
                          {entry.targetIds && entry.targetIds.length > 0
                            ? entry.targetIds.join(", ")
                            : "-"}
                        </TD>
                        <TD className="text-xs tabular-nums text-neutral-500">
                          {formatUsage(entry.usageCounts)}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          </section>
        )}
      </PageShell>
    </AdminGate>
  );
}
