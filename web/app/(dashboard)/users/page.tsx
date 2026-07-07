"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Trash2,
  Users2,
  Shield,
  AlertTriangle,
  FolderPlus,
  KeyRound,
  RotateCcw,
  Gauge,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useUsersStore } from "@/stores/users";
import { useTeamsStore } from "@/stores/teams";
import { useBillingStore, type AdminUsageRow } from "@/stores/billing";
import { useTranslation } from "@/stores/i18n";
import type { AuthUser, TeamWithMemberCount } from "@/lib/api/client";
import { AdminGate } from "@/components/admin-gate";
import { fmtTokens } from "@/lib/format/tokens";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchInput } from "@/components/ui/search-input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

/* ---------- Stable refs for selectors ---------- */

const EMPTY_USERS: AuthUser[] = [];
const EMPTY_TEAMS: TeamWithMemberCount[] = [];

/* ---------- Types ---------- */

type DialogState =
  | { kind: "none" }
  | { kind: "addUser" }
  | { kind: "addTeam" }
  | { kind: "resetPassword"; user: AuthUser }
  | { kind: "setLimit"; user: AuthUser; usage?: AdminUsageRow };

/* ---------- Helpers ---------- */

function getInitials(name: string) {
  return name
    .split(/[\s._@-]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/* ---------- Sub-components ---------- */

function RoleBadge({ role }: { role: string }) {
  const { pages } = useTranslation();
  const t = pages.users;
  if (role === "super-admin") {
    return <Badge tone="warning">{t.roleSuperAdmin}</Badge>;
  }
  if (role === "admin") {
    return <Badge tone="brand">{t.roleAdmin}</Badge>;
  }
  return <Badge tone="neutral">{t.roleBuilder}</Badge>;
}

function TeamCard({
  team,
  index,
  onDelete,
}: {
  team: TeamWithMemberCount;
  index: number;
  onDelete: () => void;
}) {
  const { pages } = useTranslation();
  const t = pages.users;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.04, duration: 0.2 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
    >
      <Card hover className="group">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center space-x-3">
            <Users2 size={20} className="text-neutral-900 flex-shrink-0" aria-hidden />
            <div>
              <CardTitle>{team.name}</CardTitle>
              {team.description && (
                <p className="text-xs text-neutral-500 mt-0.5">{team.description}</p>
              )}
            </div>
          </div>
          <IconButton
            icon={Trash2}
            label={t.deleteTeam}
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50"
          />
        </div>
        <div className="text-xs text-neutral-500">
          {team.memberCount} {t.members.toLowerCase()}
        </div>
      </Card>
    </motion.div>
  );
}

/* ---------- Dialogs ---------- */

function AddUserDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (data: {
    username: string;
    password: string;
    role: "admin" | "builder";
  }) => void;
}) {
  const { pages, common } = useTranslation();
  const t = pages.users;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "builder">("builder");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    onAdd({
      username: username.trim(),
      password: password.trim() || username.trim().padEnd(6, "0"),
      role,
    });
    setUsername("");
    setPassword("");
    setRole("builder");
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.addUser}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" form="add-user-form" variant="primary">
            {t.addUser}
          </Button>
        </>
      }
    >
      <form id="add-user-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t.username}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t.usernamePlaceholder}
          required
        />
        <Input
          label={pages.login.password}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t.leaveEmptyForDefault}
          hint={t.passwordDefaultHint}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-600">{t.role}</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={role === "builder" ? "primary" : "secondary"}
              className="flex-1 justify-center"
              onClick={() => setRole("builder")}
            >
              {t.roleBuilder}
            </Button>
            <Button
              type="button"
              variant={role === "admin" ? "primary" : "secondary"}
              className="flex-1 justify-center"
              onClick={() => setRole("admin")}
            >
              {t.roleAdmin}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function AddTeamDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (data: { name: string; description: string }) => void;
}) {
  const { pages, common } = useTranslation();
  const t = pages.users;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ name: name.trim(), description: description.trim() });
    setName("");
    setDescription("");
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.addTeam}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" form="add-team-form" variant="primary">
            {t.addTeam}
          </Button>
        </>
      }
    >
      <form id="add-team-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t.teamName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.teamNamePlaceholder}
          required
        />
        <Textarea
          label={t.teamDescription}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t.whatDoesTeamDo}
          rows={3}
        />
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({
  open,
  user,
  onClose,
  onReset,
}: {
  open: boolean;
  user: AuthUser | null;
  onClose: () => void;
  onReset: (userId: string, newPassword: string) => void;
}) {
  const { pages, common } = useTranslation();
  const t = pages.users;
  const [newPassword, setNewPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !newPassword.trim()) return;
    onReset(user.id, newPassword.trim());
    setNewPassword("");
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.resetPassword}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" form="reset-password-form" variant="primary">
            {t.resetPassword}
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-neutral-600">
          {t.resetPasswordFor}{" "}
          <span className="font-semibold text-neutral-800">{user?.username}</span>
        </p>
        <Input
          label={pages.changePassword.newPassword}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={pages.changePassword.newPasswordPlaceholder}
          required
          minLength={4}
        />
      </form>
    </Dialog>
  );
}

function SetLimitDialog({
  open,
  user,
  usage,
  isLoading,
  onClose,
  onSave,
}: {
  open: boolean;
  user: AuthUser | null;
  usage?: AdminUsageRow;
  isLoading: boolean;
  onClose: () => void;
  onSave: (tokenLimit: number | null) => void;
}) {
  const { pages, common } = useTranslation();
  const t = pages.users;
  // Default the input to the user's current effective limit, expressed in
  // millions for ergonomics. The platform default is 10M.
  const currentLimit = usage?.tokensBase ?? 10_000_000;
  const [valueMillions, setValueMillions] = useState<string>(
    (currentLimit / 1_000_000).toString(),
  );

  // Reset input when the dialog opens for a different user.
  useEffect(() => {
    if (open) {
      setValueMillions((currentLimit / 1_000_000).toString());
    }
  }, [open, currentLimit]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsed = parseFloat(valueMillions);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onSave(Math.floor(parsed * 1_000_000));
  }

  function handleResetDefault() {
    if (!user) return;
    onSave(null);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.setTokenLimit}
      size="sm"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetDefault}
            disabled={isLoading || !usage?.isCustomLimit}
          >
            {t.resetToDefault}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isLoading}>
              {common.cancel}
            </Button>
            <Button
              type="submit"
              form="set-limit-form"
              variant="primary"
              loading={isLoading}
            >
              {common.save}
            </Button>
          </div>
        </div>
      }
    >
      <form id="set-limit-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-neutral-600">
          {t.setTokenLimitFor}{" "}
          <span className="font-semibold text-neutral-800">{user?.username}</span>.
        </p>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-600">
            {t.limitInMillions}
          </label>
          <div className="flex items-center space-x-2">
            <Input
              type="number"
              step="0.1"
              min="0.1"
              value={valueMillions}
              onChange={(e) => setValueMillions(e.target.value)}
              wrapperClassName="flex-1"
              required
            />
            <span className="text-sm text-neutral-500">{t.mTokens}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[1, 5, 10, 25, 50, 100].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setValueMillions(m.toString())}
                className="px-2.5 py-1 text-xs border border-line rounded-md hover:border-teal-500 hover:text-teal-700 transition-colors cursor-pointer focus-ring"
              >
                {m}M
              </button>
            ))}
          </div>
          {usage?.isCustomLimit && (
            <p className="text-[11px] text-neutral-500 mt-2">{t.customLimitHint}</p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/* ---------- Main Component ---------- */

export default function UsersPage() {
  const { pages, common } = useTranslation();
  const t = pages.users;
  const confirm = useConfirm();

  const users = useUsersStore((s) => s.users) || EMPTY_USERS;
  const usersLoading = useUsersStore((s) => s.isLoading);
  const usersError = useUsersStore((s) => s.error);
  const fetchUsers = useUsersStore((s) => s.fetchUsers);
  const addUser = useUsersStore((s) => s.addUser);
  const removeUser = useUsersStore((s) => s.removeUser);
  const resetPassword = useUsersStore((s) => s.resetPassword);
  const clearUsersError = useUsersStore((s) => s.clearError);

  const teams = useTeamsStore((s) => s.teams) || EMPTY_TEAMS;
  const teamsLoading = useTeamsStore((s) => s.isLoading);
  const teamsError = useTeamsStore((s) => s.error);
  const fetchTeams = useTeamsStore((s) => s.fetchTeams);
  const addTeam = useTeamsStore((s) => s.addTeam);
  const removeTeam = useTeamsStore((s) => s.removeTeam);
  const clearTeamsError = useTeamsStore((s) => s.clearError);

  const allUsage = useBillingStore((s) => s.allUsage);
  const fetchAllUsage = useBillingStore((s) => s.fetchAllUsage);
  const resetUsageForUser = useBillingStore((s) => s.resetUsageForUser);
  const setLimitForUser = useBillingStore((s) => s.setLimitForUser);

  const currentUserRole = useAuthStore((s) => s.user?.role ?? null);
  const isSuperAdmin = currentUserRole === "super-admin";

  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [searchQuery, setSearchQuery] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch on mount
  useEffect(() => {
    fetchUsers();
    fetchTeams();
    fetchAllUsage();
  }, [fetchUsers, fetchTeams, fetchAllUsage]);

  const usageByUserId = new Map<string, AdminUsageRow>(
    (allUsage ?? []).map((row) => [row.userId, row]),
  );

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const isLoading = usersLoading || teamsLoading;
  const error = usersError || teamsError;

  const handleRetry = useCallback(() => {
    clearUsersError();
    clearTeamsError();
    fetchUsers();
    fetchTeams();
  }, [clearUsersError, clearTeamsError, fetchUsers, fetchTeams]);

  async function handleAddUser(data: {
    username: string;
    password: string;
    role: "admin" | "builder";
  }) {
    setActionLoading(true);
    const result = await addUser({
      username: data.username,
      password: data.password,
      role: data.role,
      passwordChangeRequired: true,
    });
    setActionLoading(false);
    if (result.success) {
      setDialog({ kind: "none" });
    }
  }

  async function handleAddTeam(data: { name: string; description: string }) {
    setActionLoading(true);
    const result = await addTeam({ name: data.name, description: data.description });
    setActionLoading(false);
    if (result.success) {
      setDialog({ kind: "none" });
    }
  }

  async function handleDeleteUser(user: AuthUser) {
    const ok = await confirm({
      title: t.deleteUser,
      description: t.deleteConfirmation,
      confirmLabel: common.delete,
      tone: "danger",
    });
    if (!ok) return;
    await removeUser(user.id);
  }

  async function handleDeleteTeam(team: TeamWithMemberCount) {
    const ok = await confirm({
      title: t.deleteTeam,
      description: t.deleteConfirmation,
      confirmLabel: common.delete,
      tone: "danger",
    });
    if (!ok) return;
    await removeTeam(team.id);
  }

  async function handleResetPassword(userId: string, newPassword: string) {
    setActionLoading(true);
    const result = await resetPassword(userId, newPassword);
    setActionLoading(false);
    if (result.success) {
      setDialog({ kind: "none" });
    }
  }

  async function handleResetUsage(user: AuthUser) {
    const ok = await confirm({
      title: t.resetUsageAction,
      description: `${t.resetUsageFor} ${user.username}? ${t.resetUsageHint}`,
    });
    if (!ok) return;
    await resetUsageForUser(user.id);
  }

  async function handleSetLimit(user: AuthUser, tokenLimit: number | null) {
    setActionLoading(true);
    await setLimitForUser(user.id, tokenLimit);
    setActionLoading(false);
    setDialog({ kind: "none" });
  }

  return (
    <AdminGate>
      <PageShell width="wide" testId="users-page">
        <PageHeader
          title={t.title}
          description={t.subtitle}
          icon={Users2}
          actions={
            <>
              <Button variant="secondary" icon={FolderPlus} onClick={() => setDialog({ kind: "addTeam" })}>
                {t.addTeam}
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "addUser" })}>
                {t.addUser}
              </Button>
            </>
          }
        />

        {/* Error state */}
        {error && (
          <Card className="flex items-center justify-between border-red-200 bg-red-50">
            <div className="flex items-center space-x-2 text-red-600">
              <AlertTriangle size={16} aria-hidden />
              <span className="text-sm">{error}</span>
            </div>
            <Button variant="danger-ghost" size="sm" onClick={handleRetry}>
              {common.retry}
            </Button>
          </Card>
        )}

        {/* Loading state */}
        {isLoading && users.length === 0 && teams.length === 0 ? (
          <LoadingState label={common.loading} />
        ) : (
          <>
            {/* Summary stats */}
            <Card>
              <div className="flex items-center justify-between">
                <CardTitle icon={Shield}>{t.overview}</CardTitle>
                <div className="flex items-center space-x-4 text-xs text-neutral-500">
                  <span>
                    {users.length} {t.users.toLowerCase()}
                  </span>
                  <span>
                    {users.filter((u) => u.role === "admin" || u.role === "super-admin").length}{" "}
                    {t.roleAdmin.toLowerCase()}
                  </span>
                  <span>
                    {users.filter((u) => u.isActive).length} {common.active.toLowerCase()}
                  </span>
                  <span>
                    {teams.length} {t.teams.toLowerCase()}
                  </span>
                </div>
              </div>
            </Card>

            {/* Teams Section */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-neutral-400 tracking-wider">
                  {t.teams.toUpperCase()}
                </h2>
              </div>
              {teams.length === 0 ? (
                <EmptyState icon={Users2} title={t.noTeamsYet} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <AnimatePresence mode="popLayout">
                    {teams.map((team, i) => (
                      <TeamCard
                        key={team.id}
                        team={team}
                        index={i}
                        onDelete={() => handleDeleteTeam(team)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </section>

            {/* Users Section */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-neutral-400 tracking-wider">
                  {t.users.toUpperCase()}
                </h2>
                <SearchInput
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder={`${common.search} ${t.users.toLowerCase()}...`}
                  className="w-56"
                />
              </div>

              {filteredUsers.length === 0 ? (
                <EmptyState
                  icon={Users2}
                  title={searchQuery ? t.noUsersMatch : t.noUsersYet}
                />
              ) : (
                <div className="overflow-x-auto">
                <Table data-testid="users-table">
                  <THead>
                    <TR>
                      <TH>{t.username}</TH>
                      <TH>{t.role}</TH>
                      <TH>{common.active}</TH>
                      <TH>{t.tokensUsed}</TH>
                      <TH>{t.created}</TH>
                      <TH>{t.lastLogin}</TH>
                      <TH className="text-right">{t.action}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filteredUsers.map((user) => {
                      const usage = usageByUserId.get(user.id);
                      const isUserSuperAdmin = user.role === "super-admin";
                      const tokensTone: BadgeTone = !usage
                        ? "neutral"
                        : usage.percentage >= 100
                          ? "danger"
                          : usage.percentage >= 85
                            ? "warning"
                            : "neutral";
                      return (
                        <TR key={user.id} hover data-testid={`user-row-${user.username}`}>
                          <TD>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-neutral-100 text-neutral-700 font-semibold text-xs flex items-center justify-center flex-shrink-0">
                                {getInitials(user.username)}
                              </div>
                              <span className="text-sm font-medium text-neutral-800">
                                {user.username}
                              </span>
                            </div>
                          </TD>
                          <TD>
                            <RoleBadge role={user.role} />
                          </TD>
                          <TD>
                            <Badge tone={user.isActive ? "success" : "neutral"} dot>
                              {user.isActive ? common.active : common.inactive}
                            </Badge>
                          </TD>
                          <TD>
                            <div className="flex items-center gap-1.5">
                              <Badge tone={tokensTone}>
                                {usage
                                  ? `${fmtTokens(usage.tokensUsed)} / ${fmtTokens(usage.tokensBase)} (${usage.percentage}%)`
                                  : "—"}
                              </Badge>
                              {usage?.isCustomLimit && (
                                <span className="text-[11px] text-teal-700">{t.customLimit}</span>
                              )}
                            </div>
                          </TD>
                          <TD className="text-xs text-neutral-500">
                            {new Date(user.createdAt).toLocaleDateString()}
                          </TD>
                          <TD className="text-xs text-neutral-500">
                            {user.lastLoginAt
                              ? new Date(user.lastLoginAt).toLocaleDateString()
                              : "—"}
                          </TD>
                          <TD>
                            <div className="flex items-center justify-end gap-1">
                              {isSuperAdmin && (
                                <IconButton
                                  icon={Gauge}
                                  label={t.setTokenLimit}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setDialog({ kind: "setLimit", user, usage })
                                  }
                                />
                              )}
                              {isSuperAdmin && (
                                <IconButton
                                  icon={RotateCcw}
                                  label={t.resetUsageAction}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleResetUsage(user)}
                                />
                              )}
                              <IconButton
                                icon={KeyRound}
                                label={t.resetPassword}
                                variant="ghost"
                                size="sm"
                                onClick={() => setDialog({ kind: "resetPassword", user })}
                              />
                              {!isUserSuperAdmin && (
                                <IconButton
                                  icon={Trash2}
                                  label={t.deleteUser}
                                  variant="ghost"
                                  size="sm"
                                  className="hover:text-red-600 hover:bg-red-50"
                                  onClick={() => handleDeleteUser(user)}
                                  data-testid="delete-user-button"
                                />
                              )}
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
                </div>
              )}
            </section>
          </>
        )}
      </PageShell>

      {/* Dialogs */}
      <AddUserDialog
        open={dialog.kind === "addUser"}
        onClose={() => setDialog({ kind: "none" })}
        onAdd={handleAddUser}
      />

      <AddTeamDialog
        open={dialog.kind === "addTeam"}
        onClose={() => setDialog({ kind: "none" })}
        onAdd={handleAddTeam}
      />

      <ResetPasswordDialog
        open={dialog.kind === "resetPassword"}
        user={dialog.kind === "resetPassword" ? dialog.user : null}
        onClose={() => setDialog({ kind: "none" })}
        onReset={handleResetPassword}
      />

      <SetLimitDialog
        open={dialog.kind === "setLimit"}
        user={dialog.kind === "setLimit" ? dialog.user : null}
        usage={dialog.kind === "setLimit" ? dialog.usage : undefined}
        isLoading={actionLoading}
        onClose={() => setDialog({ kind: "none" })}
        onSave={(limit) => dialog.kind === "setLimit" && handleSetLimit(dialog.user, limit)}
      />
    </AdminGate>
  );
}
