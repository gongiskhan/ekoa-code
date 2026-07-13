"use client";

/**
 * Pedidos (change-requests queue) admin page (operator-run H4).
 *
 * The org-admin's queue over `GET /api/v1/change-requests`: change requests users filed from
 * inside a served app (or from a refused build). An org-admin sees its OWN org; a super-admin
 * gets an org filter (`?orgId=`) across orgs - the EXACT registo scoping. "Converter" starts a
 * patch run (an H1-gated follow-up build) and marks the request converted; "Dispensar" declines
 * it. A live `change_request` notification refetches the queue so a new request appears without a
 * reload. PT-PT strings.
 *
 * Admin-gated (org-admin + super-admin); reachable from the sidebar.
 */

import { useEffect } from "react";
import { Inbox, AlertTriangle } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useOrgsStore } from "@/stores/orgs";
import { useChangeRequestsStore } from "@/stores/change-requests";
import { openNotificationsStream } from "@/lib/api";
import { AdminGate } from "@/components/admin-gate";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import type { ChangeRequestStatus } from "@ekoa/shared";

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-PT");
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<ChangeRequestStatus, string> = {
  open: "Aberto",
  converted: "Convertido",
  dismissed: "Dispensado",
};
const STATUS_TONE: Record<ChangeRequestStatus, BadgeTone> = {
  open: "warning",
  converted: "success",
  dismissed: "neutral",
};

export default function PedidosPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isSuperAdmin = role === "super-admin";

  const requests = useChangeRequestsStore((s) => s.requests);
  const total = useChangeRequestsStore((s) => s.total);
  const statusFilter = useChangeRequestsStore((s) => s.statusFilter);
  const orgId = useChangeRequestsStore((s) => s.orgId);
  const isLoading = useChangeRequestsStore((s) => s.isLoading);
  const actingId = useChangeRequestsStore((s) => s.actingId);
  const error = useChangeRequestsStore((s) => s.error);
  const fetchRequests = useChangeRequestsStore((s) => s.fetchRequests);
  const setStatusFilter = useChangeRequestsStore((s) => s.setStatusFilter);
  const setOrgId = useChangeRequestsStore((s) => s.setOrgId);
  const convert = useChangeRequestsStore((s) => s.convert);
  const dismiss = useChangeRequestsStore((s) => s.dismiss);
  const clearError = useChangeRequestsStore((s) => s.clearError);

  const orgs = useOrgsStore((s) => s.orgs);
  const fetchOrgs = useOrgsStore((s) => s.fetchOrgs);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    if (isSuperAdmin) fetchOrgs();
  }, [isSuperAdmin, fetchOrgs]);

  // Live queue: a filed request pushes a `change_request` notification to this admin's channel;
  // refetch so it appears without a reload (mirrors the header's usage/branding subscriptions).
  useEffect(() => {
    const stream = openNotificationsStream();
    const off = stream.on("change_request", () => {
      void useChangeRequestsStore.getState().fetchRequests();
    });
    return () => {
      off();
      stream.close();
    };
  }, []);

  const orgNameById = new Map(orgs.map((o) => [o.id, o.displayName ?? o.name]));

  return (
    <AdminGate allowOrgAdmin>
      <PageShell width="wide" testId="pedidos-page">
        <PageHeader
          icon={Inbox}
          title="Pedidos"
          description="Pedidos de alteração enviados pelos utilizadores a partir das aplicações. Converta um pedido numa revisão ou dispense-o."
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
                fetchRequests();
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
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  wrapperClassName="w-auto"
                  className="py-1.5"
                  data-testid="pedidos-filter-org"
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
              <label className="mb-1 block text-xs font-medium text-neutral-600">Estado</label>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ChangeRequestStatus | "")}
                wrapperClassName="w-auto"
                className="py-1.5"
                data-testid="pedidos-filter-status"
              >
                <option value="open">Abertos</option>
                <option value="converted">Convertidos</option>
                <option value="dismissed">Dispensados</option>
                <option value="">Todos</option>
              </Select>
            </div>
          </div>
        </Card>

        {/* Table */}
        {isLoading && requests.length === 0 ? (
          <LoadingState label="A carregar pedidos..." />
        ) : requests.length === 0 ? (
          <EmptyState icon={Inbox} title="Sem pedidos de alteração." />
        ) : (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold tracking-wider text-neutral-400">PEDIDOS</h2>
              <span className="text-xs text-neutral-500">{total} pedidos</span>
            </div>
            <div className="overflow-x-auto">
              <Table data-testid="pedidos-table">
                <THead>
                  <TR>
                    <TH>Utilizador</TH>
                    <TH>Pedido</TH>
                    <TH>Aplicação</TH>
                    {isSuperAdmin && <TH>Escritório</TH>}
                    <TH>Data e hora</TH>
                    <TH>Estado</TH>
                    <TH>Ações</TH>
                  </TR>
                </THead>
                <TBody>
                  {requests.map((req) => (
                    <TR key={req.id} hover>
                      <TD className="text-sm font-medium text-neutral-800">{req.requesterName}</TD>
                      <TD className="max-w-md text-sm text-neutral-700">
                        <span className="line-clamp-3 whitespace-pre-wrap">{req.text}</span>
                        {req.route ? (
                          <span className="mt-1 block text-xs text-neutral-400">{req.route}</span>
                        ) : null}
                      </TD>
                      <TD className="text-xs text-neutral-500">{req.appId ?? "-"}</TD>
                      {isSuperAdmin && (
                        <TD className="text-xs text-neutral-500">
                          {orgNameById.get(req.orgId) ?? req.orgId}
                        </TD>
                      )}
                      <TD className="text-xs text-neutral-500">{formatTimestamp(req.createdAt)}</TD>
                      <TD>
                        <Badge tone={STATUS_TONE[req.status]}>{STATUS_LABEL[req.status]}</Badge>
                      </TD>
                      <TD>
                        {req.status === "open" ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={actingId === req.id}
                              onClick={() => convert(req.id)}
                            >
                              Converter
                            </Button>
                            <Button
                              variant="danger-ghost"
                              size="sm"
                              disabled={actingId === req.id}
                              onClick={() => dismiss(req.id)}
                            >
                              Dispensar
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-400">-</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
        )}
      </PageShell>
    </AdminGate>
  );
}
