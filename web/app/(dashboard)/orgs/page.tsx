"use client";

/**
 * Org management (Amendment 2, FC-501). Super-admin only.
 *
 * Create an org (`POST /orgs`), list orgs (`GET /orgs`), and rename an org
 * (`PATCH /orgs/:id`) - ch03 §3.8.4. Distinct from the branding page, which
 * edits the caller's OWN org ("Escritório"). PT-PT strings.
 */

import { useEffect, useState } from "react";
import { Building2, Plus, Pencil, AlertTriangle } from "lucide-react";
import { useOrgsStore } from "@/stores/orgs";
import { AdminGate } from "@/components/admin-gate";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import type { OrgConfig } from "@ekoa/shared";

type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "rename"; org: OrgConfig };

function CreateOrgDialog({
  isBusy,
  onClose,
  onCreate,
}: {
  isBusy: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; displayName?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), displayName: displayName.trim() || undefined });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Criar escritório"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancelar
          </Button>
          <Button type="submit" form="create-org-form" variant="primary" loading={isBusy}>
            Criar
          </Button>
        </>
      }
    >
      <form id="create-org-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex.: escritorio-lisboa"
          required
        />
        <Input
          label="Nome de apresentação"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="ex.: Escritório de Lisboa"
          hint="Mostrado aos utilizadores. Se ficar vazio, é usado o nome."
        />
      </form>
    </Dialog>
  );
}

function RenameOrgDialog({
  org,
  isBusy,
  onClose,
  onRename,
}: {
  org: OrgConfig;
  isBusy: boolean;
  onClose: () => void;
  onRename: (data: { name?: string; displayName?: string }) => void;
}) {
  // Initialised from `org`; the parent remounts via `key={org.id}` so no reset
  // effect is needed.
  const [name, setName] = useState(org.name ?? "");
  const [displayName, setDisplayName] = useState(org.displayName ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onRename({ name: name.trim(), displayName: displayName.trim() || undefined });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Renomear escritório"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancelar
          </Button>
          <Button type="submit" form="rename-org-form" variant="primary" loading={isBusy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="rename-org-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Nome de apresentação"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </form>
    </Dialog>
  );
}

export default function OrgsPage() {
  const orgs = useOrgsStore((s) => s.orgs);
  const isLoading = useOrgsStore((s) => s.isLoading);
  const error = useOrgsStore((s) => s.error);
  const fetchOrgs = useOrgsStore((s) => s.fetchOrgs);
  const createOrg = useOrgsStore((s) => s.createOrg);
  const renameOrg = useOrgsStore((s) => s.renameOrg);
  const clearError = useOrgsStore((s) => s.clearError);

  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  async function handleCreate(data: { name: string; displayName?: string }) {
    setActionLoading(true);
    const result = await createOrg(data);
    setActionLoading(false);
    if (result.success) setDialog({ kind: "none" });
  }

  async function handleRename(data: { name?: string; displayName?: string }) {
    if (dialog.kind !== "rename") return;
    setActionLoading(true);
    const result = await renameOrg(dialog.org.id, data);
    setActionLoading(false);
    if (result.success) setDialog({ kind: "none" });
  }

  return (
    <AdminGate>
      <PageShell width="wide" testId="orgs-page">
        <PageHeader
          icon={Building2}
          title="Escritórios"
          description="Criar, listar e renomear escritórios da plataforma."
          actions={
            <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "create" })}>
              Criar escritório
            </Button>
          }
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
                fetchOrgs();
              }}
            >
              Tentar novamente
            </Button>
          </Card>
        )}

        {isLoading && orgs.length === 0 ? (
          <LoadingState label="A carregar escritórios..." />
        ) : orgs.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Ainda não há escritórios."
            action={
              <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "create" })}>
                Criar escritório
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="orgs-table">
              <THead>
                <TR>
                  <TH>Nome de apresentação</TH>
                  <TH>Nome</TH>
                  <TH>ID</TH>
                  <TH className="text-right">Ação</TH>
                </TR>
              </THead>
              <TBody>
                {orgs.map((org) => (
                  <TR key={org.id} hover data-testid={`org-row-${org.id}`}>
                    <TD className="text-sm font-medium text-neutral-800">
                      {org.displayName ?? org.name}
                    </TD>
                    <TD className="text-sm text-neutral-600">{org.name}</TD>
                    <TD className="font-mono text-xs text-neutral-400">{org.id}</TD>
                    <TD>
                      <div className="flex items-center justify-end">
                        <IconButton
                          icon={Pencil}
                          label="Renomear"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: "rename", org })}
                          data-testid={`rename-org-${org.id}`}
                        />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </PageShell>

      {dialog.kind === "create" && (
        <CreateOrgDialog
          isBusy={actionLoading}
          onClose={() => setDialog({ kind: "none" })}
          onCreate={handleCreate}
        />
      )}
      {dialog.kind === "rename" && (
        <RenameOrgDialog
          key={dialog.org.id}
          org={dialog.org}
          isBusy={actionLoading}
          onClose={() => setDialog({ kind: "none" })}
          onRename={handleRename}
        />
      )}
    </AdminGate>
  );
}
