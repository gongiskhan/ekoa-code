"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Settings2,
  Trash2,
  Zap,
  ChevronDown,
  RefreshCw,
  Key,
  Plug,
  HelpCircle,
  Plus,
  Pencil,
  Calendar,
  Upload,
  Download,
  MessageSquare,
  Workflow,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIntegrationsStore, isUserScopedSkill } from "@/stores/integrations";
import { useTranslation } from "@/stores/i18n";
import { IntegrationDialog, type IntegrationDialogMode } from "@/components/integrations/integration-dialog";
import { InlineCredentialForm } from "@/components/integrations/InlineCredentialForm";
import { SessionConnectPanel } from "@/components/integrations/SessionConnectPanel";
import { PlatformIntegrationCard } from "@/components/integrations/PlatformIntegrationCard";
import { PipedreamSection } from "@/components/integrations/PipedreamSection";
import { WebhooksSection } from "@/components/integrations/WebhooksSection";
import type {
  IntegrationSkill,
  IntegrationBuilderOutput,
} from "@/lib/api/client";
import { toast } from "@/stores/toast";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/confirm-dialog";

/* ---------- Animation Variants ---------- */

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

const expandVariants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: "auto",
    opacity: 1,
    transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.2, ease: [0.42, 0, 1, 1] as const },
  },
};

// Stable module-level object prevents ReactMarkdown from re-rendering on every parent render
const GUIDE_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-neutral-700">{children}</strong>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 mb-2 space-y-1.5">{children}</ol>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mb-2 space-y-1.5">{children}</ul>,
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-700 underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="px-1 py-0.5 bg-neutral-100 rounded text-[11px] font-mono text-neutral-700">{children}</code>
  ),
};

/* ---------- Helpers ---------- */

function getAuthLabel(
  authType: string,
  t: ReturnType<typeof useTranslation>["pages"]["integrations"]
): string {
  switch (authType) {
    case "api_key": return t.authTypeApiKey;
    case "oauth2": return t.authTypeOAuth;
    case "service_account": return t.authTypeServiceAccount;
    case "none": return t.authTypeNoAuth;
    case "browser_session": return t.authTypeBrowserSession;
    default: return authType;
  }
}

/* ---------- Integration Card ---------- */

function IntegrationCard({
  skill,
  isConfigured,
  isEnabled,
  onEdit,
  onDelete,
  onToggle,
  onUseInChat,
  onSaveCredentials,
  isSavingCredentials,
  t,
  common,
}: {
  skill: IntegrationSkill;
  isConfigured: boolean;
  isEnabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onUseInChat: () => void;
  onSaveCredentials: (values: Record<string, string>) => Promise<{ success: boolean; error?: string }>;
  isSavingCredentials: boolean;
  t: ReturnType<typeof useTranslation>["pages"]["integrations"];
  common: ReturnType<typeof useTranslation>["common"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Session-status rows drive the automation extensions in the actions block
  // (and the SessionConnectPanel, when the skill has sessionConnect).
  const sessionEntry = useIntegrationsStore((s) => s.sessionStatuses[skill.integrationKey]);
  const isSessionBusy = useIntegrationsStore((s) => Boolean(s.sessionBusy[skill.integrationKey]));
  const refreshSessionStatus = useIntegrationsStore((s) => s.refreshSessionStatus);
  const provisionAutomations = useIntegrationsStore((s) => s.provisionAutomations);

  // Lazy fetch: only when the actions block is expanded and some action is
  // automation-bound (the SessionConnectPanel already fetches for
  // session-connect skills; the in-flight guard dedupes overlaps).
  const hasAutomationBoundActions = skill.actions.some((a) => a.automationBinding);
  useEffect(() => {
    if (!expanded || !hasAutomationBoundActions || sessionEntry) return;
    void refreshSessionStatus(skill.integrationKey);
  }, [expanded, hasAutomationBoundActions, sessionEntry, refreshSessionStatus, skill.integrationKey]);

  const hasUnprovisionedAutomations =
    sessionEntry?.actions.some((row) => row.automationTemplate && !row.provisioned) ?? false;

  async function handleProvisionAutomations(e: React.MouseEvent) {
    e.stopPropagation();
    const result = await provisionAutomations(skill.integrationKey);
    if (!result.success && result.error) toast.error(result.error);
  }

  function handleShowGuide(e: React.MouseEvent) {
    e.stopPropagation();
    setShowGuide(true);
  }

  return (
    <>
    <motion.div
      variants={cardVariants}
      className="w-full text-left bg-white border border-neutral-200 rounded-xl overflow-hidden hover:border-neutral-300 hover:shadow-sm transition-all group cursor-pointer flex flex-col"
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      onClick={onEdit}
    >
      {/* Top accent line */}
      <div
        className={`h-[2px] transition-all duration-300 ${
          isEnabled
            ? "bg-gradient-to-r from-teal-400 via-teal-500 to-emerald-400"
            : "bg-neutral-200"
        }`}
      />

      <div className="p-4 flex flex-col flex-1">
        {/* Header row */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors duration-200 ${
                isEnabled
                  ? "bg-teal-50 text-teal-600"
                  : "bg-neutral-100 text-neutral-400"
              }`}
            >
              <Plug size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-neutral-800 truncate">
                {skill.displayName}
              </h3>
              <p className="text-[11px] text-neutral-400 mt-0.5 truncate">
                {skill.category}
              </p>
            </div>
          </div>

          {/* Status dot + hover delete */}
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                isEnabled ? "bg-teal-500" : isConfigured ? "bg-amber-400" : "bg-neutral-300"
              }`}
            />
            <IconButton
              icon={Trash2}
              label={common.delete}
              size="sm"
              variant="danger-ghost"
              className="opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            />
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-neutral-500 leading-relaxed mb-2 line-clamp-2">
          {skill.description}
        </p>

        {/* Metadata badges */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <Badge tone="neutral">
            <Key size={10} className="text-neutral-400" />
            {getAuthLabel(skill.authType, t)}
          </Badge>
          <Badge tone="neutral">{skill.provider}</Badge>
          {skill.actions.length > 0 && (
            <Badge tone="neutral">
              <Zap size={10} className="text-neutral-400" />
              {skill.actions.length} {t.actionsCount}
            </Badge>
          )}
          {skill.configSchema.length > 0 && (
            <Badge tone="neutral">
              <Settings2 size={10} className="text-neutral-400" />
              {skill.configSchema.length} {t.configFieldsCount}
            </Badge>
          )}
        </div>

        {/* Browser-session connect flow (authType 'browser_session') */}
        {skill.sessionConnect && <SessionConnectPanel skill={skill} />}

        {/* Inline credential form */}
        <InlineCredentialForm
          skill={skill}
          isConfigured={isConfigured}
          onSave={onSaveCredentials}
          isSaving={isSavingCredentials}
        />

        {/* Expandable details (actions only) */}
        {skill.actions.length > 0 && (
          <>
            <AnimatePresence>
              {expanded && (
                <motion.div
                  variants={expandVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="overflow-hidden"
                >
                  <div className="space-y-2.5 pb-2">
                    <div className="bg-neutral-50 rounded-lg p-2.5">
                      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                        {t.actions}
                      </p>
                      <div className="space-y-1">
                        {skill.actions.map((action) => {
                          const row = sessionEntry?.actions.find(
                            (r) => r.actionName === action.actionName
                          );
                          const hasAutomation = Boolean(
                            action.automationBinding || row?.automationTemplate || row?.automationId
                          );
                          return (
                            <div key={action.actionName} className="space-y-0.5">
                              <div className="flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <Zap size={10} className="text-neutral-400" />
                                  <span className="font-mono text-neutral-600">{action.actionName}</span>
                                </div>
                                {action.mutates && (
                                  <Badge tone="warning">{t.mutates}</Badge>
                                )}
                              </div>
                              {hasAutomation && (
                                <div className="flex min-w-0 items-center gap-1.5 pl-4 text-[10px]">
                                  <span className="inline-flex flex-shrink-0 items-center gap-1 rounded bg-teal-50 px-1 py-px font-medium text-teal-600">
                                    <Workflow size={9} />
                                    {t.actionAutomationTag}
                                  </span>
                                  {row?.provisioned && row.automationId ? (
                                    <>
                                      <span className="truncate text-neutral-500">
                                        {row.automationName || row.automationId}
                                      </span>
                                      <Link
                                        href={`/automations/${row.automationId}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex-shrink-0 whitespace-nowrap text-teal-600 underline-offset-2 hover:text-teal-700 hover:underline"
                                      >
                                        {t.actionRefineSteps}
                                      </Link>
                                    </>
                                  ) : (
                                    <span className="text-neutral-400">{t.actionAutomationPending}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {hasUnprovisionedAutomations && (
                        <div className="pt-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Workflow}
                            loading={isSessionBusy}
                            onClick={handleProvisionAutomations}
                          >
                            {t.createAutomations}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-teal-600 transition-colors cursor-pointer mb-2 focus-ring rounded"
            >
              <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown size={12} />
              </motion.div>
              <span>{expanded ? t.showLess : t.showMore}</span>
            </button>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Footer */}
        <div className="pt-3 mt-2 border-t border-neutral-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
              {skill.createdAt && (
                <>
                  <Calendar size={11} />
                  <span>{new Date(skill.createdAt).toLocaleDateString()}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={isEnabled ? "success" : isConfigured ? "warning" : "neutral"} dot>
                {isEnabled ? common.enabled : isConfigured ? t.configured : t.available}
              </Badge>
              {isConfigured && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Switch checked={isEnabled} onChange={onToggle} />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            {skill.credentialGuide && (isConfigured ? (
              <IconButton
                icon={HelpCircle}
                label={t.viewCredentialGuide}
                size="sm"
                variant="ghost"
                onClick={handleShowGuide}
              />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={HelpCircle}
                className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                onClick={handleShowGuide}
              >
                {t.howToConnect}
              </Button>
            ))}
            <IconButton
              icon={MessageSquare}
              label={t.useInChat}
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onUseInChat();
              }}
            />
            <IconButton
              icon={Pencil}
              label={common.edit}
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            />
          </div>
        </div>
      </div>
    </motion.div>
    {skill.credentialGuide && (
      <CredentialGuideDialog
        open={showGuide}
        name={skill.displayName}
        guide={skill.credentialGuide}
        onClose={() => setShowGuide(false)}
      />
    )}
    </>
  );
}

/* ---------- Credential Guide Dialog ---------- */

function CredentialGuideDialog({
  open,
  name,
  guide,
  onClose,
}: {
  open: boolean;
  name: string;
  guide: string;
  onClose: () => void;
}) {
  const { common, pages } = useTranslation();
  const t = pages.integrations;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.credentialGuideTitle(name)}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {common.close}
        </Button>
      }
    >
      <div className="text-sm text-neutral-600">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={GUIDE_MARKDOWN_COMPONENTS}>
          {guide}
        </ReactMarkdown>
      </div>
    </Dialog>
  );
}

/* ---------- Loading Skeleton ---------- */

function IntegrationSkeleton() {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden animate-pulse flex flex-col">
      <div className="h-[2px] bg-neutral-100" />
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-1">
            <div className="w-8 h-8 rounded-lg bg-neutral-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 bg-neutral-200 rounded w-2/3" />
              <div className="h-3 bg-neutral-100 rounded w-1/3" />
            </div>
          </div>
          <div className="w-2 h-2 rounded-full bg-neutral-200" />
        </div>
        <div className="space-y-1.5 mb-2">
          <div className="h-3 bg-neutral-100 rounded w-full" />
          <div className="h-3 bg-neutral-100 rounded w-2/3" />
        </div>
        <div className="flex gap-1.5 mb-3">
          <div className="h-5 bg-neutral-50 rounded-md w-16" />
          <div className="h-5 bg-neutral-50 rounded-md w-14" />
        </div>
        <div className="pt-3 mt-2 border-t border-neutral-100">
          <div className="h-3 bg-neutral-100 rounded w-1/4 mb-2" />
          <div className="flex gap-1">
            <div className="w-8 h-8 rounded bg-neutral-100" />
            <div className="w-8 h-8 rounded bg-neutral-100" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Tabs ---------- */

type TabKey = "plataforma" | "minhas" | "webhooks";

function parseTab(value: string | null): TabKey {
  return value === "minhas" || value === "webhooks" ? value : "plataforma";
}

/* ---------- Filter ---------- */

type StatusFilter = "all" | "enabled" | "configured" | "available";

// Google Workspace and Microsoft 365 are already represented by the OAuth
// PlatformIntegrationCard section above the general grid; their skill-based
// counterparts (configSchema: []) can never be configured through this grid,
// so hide them here rather than showing a second, permanently-inert card.
const PLATFORM_DUPLICATE_KEYS = new Set(["google-workspace", "microsoft-365"]);

/* ---------- Main Page ---------- */

export default function IntegrationsPage() {
  const router = useRouter();
  const { pages, common } = useTranslation();
  const t = pages.integrations;
  const confirm = useConfirm();

  const {
    skills,
    isLoading,
    error,
    fetchAll,
    configureIntegration,
    setEnabled,
    deleteSkill,
    clearError,
    isConfigured,
    isEnabled,
    loadIntegrationPackage,
    fetchAllPlatformStatuses,
  } = useIntegrationsStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Dialog state
  const [dialogMode, setDialogMode] = useState<IntegrationDialogMode | null>(null);
  const [dialogKey, setDialogKey] = useState<string | undefined>(undefined);
  const [importedData, setImportedData] = useState<IntegrationBuilderOutput | undefined>(undefined);

  // Per-card credential saving state
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());

  // Import/Export
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Active top-level tab (plataforma | minhas | webhooks), persisted in the URL
  // (?tab=...) so refresh and deep-links keep their place. We read/write the URL
  // via window.history to avoid a Suspense boundary requirement on the dashboard
  // route (useSearchParams would force one).
  const [activeTab, setActiveTab] = useState<TabKey>("plataforma");

  useEffect(() => {
    const initial = parseTab(new URLSearchParams(window.location.search).get("tab"));
    setActiveTab(initial);
    const onPop = () => {
      setActiveTab(parseTab(new URLSearchParams(window.location.search).get("tab")));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const changeTab = useCallback((key: string) => {
    const tab = parseTab(key);
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchAll();
    fetchAllPlatformStatuses();
  }, [fetchAll, fetchAllPlatformStatuses]);

  // Surface store errors as toasts (with a retry action) instead of a
  // hand-rolled persistent banner.
  useEffect(() => {
    if (!error) return;
    toast.error(error, { action: { label: common.retry, onClick: () => { clearError(); fetchAll(); } } });
    clearError();
  }, [error, clearError, fetchAll, common.retry]);

  // Skills shown in the grids, excluding the platform-integration duplicates
  const visibleSkills = useMemo(
    () => skills.filter((s) => !PLATFORM_DUPLICATE_KEYS.has(s.integrationKey)),
    [skills]
  );

  // Shared search + status filter, reused by both the system grid and the
  // "my integrations" grid.
  const applyFilter = useCallback(
    (list: typeof visibleSkills) => {
      let result = list;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        result = result.filter(
          (s) =>
            s.displayName.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q) ||
            s.provider.toLowerCase().includes(q)
        );
      }
      switch (statusFilter) {
        case "enabled":
          result = result.filter((s) => isEnabled(s.integrationKey));
          break;
        case "configured":
          result = result.filter((s) => isConfigured(s.integrationKey) && !isEnabled(s.integrationKey));
          break;
        case "available":
          result = result.filter((s) => !isConfigured(s.integrationKey));
          break;
      }
      return result;
    },
    [searchQuery, statusFilter, isConfigured, isEnabled]
  );

  // Partition by scope: shipped/versioned skills (scope 'global' or undefined)
  // are system integrations; sandbox skills (scope 'user:<id>') are the user's own.
  // A user-scoped skill that SHADOWS a platform skill (same integrationKey exists
  // globally) is a per-owner binding overlay written by automation provisioning,
  // not a user-created integration - it never renders as its own card.
  const systemSkills = useMemo(
    () => visibleSkills.filter((s) => !isUserScopedSkill(s)),
    [visibleSkills]
  );
  const mySkills = useMemo(() => {
    const platformKeys = new Set(systemSkills.map((s) => s.integrationKey));
    return visibleSkills.filter((s) => isUserScopedSkill(s) && !platformKeys.has(s.integrationKey));
  }, [visibleSkills, systemSkills]);
  const filteredSystem = useMemo(() => applyFilter(systemSkills), [applyFilter, systemSkills]);

  // Counts run over the rendered cards only (shadow overlays excluded).
  const countedSkills = useMemo(() => [...systemSkills, ...mySkills], [systemSkills, mySkills]);
  const enabledCount = countedSkills.filter((s) => isEnabled(s.integrationKey)).length;

  const tabItems = useMemo(() => {
    const configuredNotEnabled = countedSkills.filter(
      (s) => isConfigured(s.integrationKey) && !isEnabled(s.integrationKey)
    ).length;
    const availableCount = countedSkills.filter((s) => !isConfigured(s.integrationKey)).length;
    return [
      { key: "all", label: t.all, count: countedSkills.length },
      { key: "enabled", label: t.enabled, count: enabledCount },
      { key: "configured", label: t.configured, count: configuredNotEnabled },
      { key: "available", label: t.available, count: availableCount },
    ];
  }, [countedSkills, enabledCount, isConfigured, isEnabled, t]);

  const handleToggleEnabled = useCallback(
    async (skill: IntegrationSkill, enabled: boolean) => {
      await setEnabled(skill.integrationKey, enabled);
    },
    [setEnabled]
  );

  const handleSaveCredentials = useCallback(
    async (integrationKey: string, values: Record<string, string>): Promise<{ success: boolean; error?: string }> => {
      setSavingKeys((prev) => new Set(prev).add(integrationKey));
      try {
        const result = await configureIntegration(integrationKey, values);
        return result;
      } finally {
        setSavingKeys((prev) => {
          const next = new Set(prev);
          next.delete(integrationKey);
          return next;
        });
      }
    },
    [configureIntegration]
  );

  const handleDeleteSkill = useCallback(
    async (skill: IntegrationSkill) => {
      const ok = await confirm({
        title: t.deleteIntegration,
        description: `${t.deleteConfirmation(skill.displayName)} ${t.cannotBeUndone}`,
        confirmLabel: common.delete,
        tone: "danger",
      });
      if (ok) {
        await deleteSkill(skill.integrationKey);
      }
    },
    [confirm, deleteSkill, t, common]
  );

  function openCreateDialog() {
    setDialogMode("create");
    setDialogKey(undefined);
    setImportedData(undefined);
  }

  function openEditDialog(skill: IntegrationSkill) {
    setDialogMode("edit");
    setDialogKey(skill.integrationKey);
    setImportedData(undefined);
  }

  function closeDialog() {
    setDialogMode(null);
    setDialogKey(undefined);
    setImportedData(undefined);
  }

  function handleDialogSaved() {
    fetchAll();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as IntegrationBuilderOutput;
        if (data.skillMd && data.config && data.config.integrationKey) {
          setImportedData(data);
          setDialogMode("create");
          setDialogKey(undefined);
        } else {
          toast.error(t.invalidImportFile);
        }
      } catch {
        toast.error(t.invalidImportFile);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const handleExportAll = useCallback(async () => {
    if (skills.length === 0) return;
    setIsExporting(true);
    try {
      const packages: IntegrationBuilderOutput[] = [];
      for (const skill of skills) {
        const result = await loadIntegrationPackage(skill.integrationKey);
        if (result.success && result.data) {
          packages.push(result.data);
        }
      }
      if (packages.length === 0) return;
      const blob = new Blob([JSON.stringify(packages, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "integrations.export.json";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }, [skills, loadIntegrationPackage]);

  const activeSuffix = enabledCount > 0 ? ` · ${enabledCount} ${common.active?.toLowerCase() ?? "ativo"}` : "";
  const headerDescription =
    (visibleSkills.length > 0 ? `${visibleSkills.length} ${t.integrationsCount}` : t.subtitle) + activeSuffix;

  const renderSkillGrid = (list: typeof visibleSkills) => (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
    >
      {list.map((skill) => (
        <IntegrationCard
          key={skill.integrationKey}
          skill={skill}
          isConfigured={isConfigured(skill.integrationKey)}
          isEnabled={isEnabled(skill.integrationKey)}
          onEdit={() => openEditDialog(skill)}
          onDelete={() => handleDeleteSkill(skill)}
          onToggle={(enabled) => handleToggleEnabled(skill, enabled)}
          onUseInChat={() => router.push("/chat?mode=integrate")}
          onSaveCredentials={(values) => handleSaveCredentials(skill.integrationKey, values)}
          isSavingCredentials={savingKeys.has(skill.integrationKey)}
          t={t}
          common={common}
        />
      ))}
    </motion.div>
  );

  const clearFiltersEmpty = (
    <EmptyState
      icon={Search}
      title={t.noIntegrationsMatch}
      action={
        <Button variant="ghost" onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}>
          {t.clearFilters}
        </Button>
      }
    />
  );

  const pageTabItems = [
    { key: "plataforma", label: t.tabPlatform, testId: "integrations-tab-plataforma" },
    { key: "minhas", label: t.tabMine, testId: "integrations-tab-minhas" },
    { key: "webhooks", label: t.tabWebhooks, testId: "integrations-tab-webhooks" },
  ];

  return (
    <PageShell width="wide" testId="integrations-page">
      <PageHeader
        icon={Plug}
        title={t.title}
        description={headerDescription}
        actions={
          <IconButton
            icon={RefreshCw}
            label={common.refresh}
            variant="ghost"
            disabled={isLoading}
            onClick={() => { clearError(); fetchAll(); }}
          />
        }
      />

      {/* Top-level tab bar (Plataforma / Minhas / Webhooks), URL-persisted */}
      <Tabs
        variant="underline"
        items={pageTabItems}
        value={activeTab}
        onChange={changeTab}
      />

      {/* ===== Plataforma: OAuth + Pipedream + versioned skills in one grid ===== */}
      {activeTab === "plataforma" && (
        <div role="tabpanel" aria-label={t.tabPlatform} data-testid="platform-integrations-section" className="space-y-5">
          <p className="text-xs text-neutral-500 max-w-2xl">{t.systemSectionSubtitle}</p>

          {/* Status filter pills + search apply to the skill cards in this tab */}
          {visibleSkills.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs
                variant="pills"
                items={tabItems}
                value={statusFilter}
                onChange={(key) => setStatusFilter(key as StatusFilter)}
              />
              <SearchInput
                value={searchQuery}
                onValueChange={setSearchQuery}
                placeholder={t.searchPlaceholder}
                className="w-56"
              />
            </div>
          )}

          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {/* Platform OAuth accounts */}
            <PlatformIntegrationCard
              provider="google"
              name={pages.platformIntegrations.google}
              description={pages.platformIntegrations.googleDescription}
            />
            <PlatformIntegrationCard
              provider="microsoft"
              name={pages.platformIntegrations.microsoft}
              description={pages.platformIntegrations.microsoftDescription}
            />

            {/* Extended reach via Pipedream — a modest, collapsed card that
                expands full-width to reveal the catalog + network config */}
            <PipedreamSection />

            {/* Versioned integration skills */}
            {isLoading && skills.length === 0
              ? Array.from({ length: 8 }).map((_, i) => <IntegrationSkeleton key={`sk-${i}`} />)
              : filteredSystem.map((skill) => (
                  <IntegrationCard
                    key={skill.integrationKey}
                    skill={skill}
                    isConfigured={isConfigured(skill.integrationKey)}
                    isEnabled={isEnabled(skill.integrationKey)}
                    onEdit={() => openEditDialog(skill)}
                    onDelete={() => handleDeleteSkill(skill)}
                    onToggle={(enabled) => handleToggleEnabled(skill, enabled)}
                    onUseInChat={() => router.push("/chat?mode=integrate")}
                    onSaveCredentials={(values) => handleSaveCredentials(skill.integrationKey, values)}
                    isSavingCredentials={savingKeys.has(skill.integrationKey)}
                    t={t}
                    common={common}
                  />
                ))}
          </motion.div>

          {/* When a filter/search hides every skill card, offer a way back
              (the OAuth + Pipedream cards above stay visible regardless) */}
          {systemSkills.length > 0 && filteredSystem.length === 0 && clearFiltersEmpty}
        </div>
      )}

      {/* ===== Minhas Integrações: user-scoped skills + create/import/export ===== */}
      {activeTab === "minhas" && (
        <div role="tabpanel" aria-label={t.tabMine} data-testid="my-integrations-section" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-800">{t.mySectionTitle}</h2>
              <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">{t.mySectionSubtitle}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" icon={Upload} onClick={() => importInputRef.current?.click()}>
                <span className="hidden sm:inline">{t.importFile}</span>
              </Button>
              <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
              <Button
                variant="secondary"
                icon={Download}
                loading={isExporting}
                disabled={skills.length === 0}
                onClick={handleExportAll}
              >
                <span className="hidden sm:inline">{t.exportAll}</span>
              </Button>
              <Button variant="secondary" icon={MessageSquare} onClick={() => router.push("/chat?mode=integrate")}>
                <span className="hidden sm:inline">{t.buildInChat}</span>
              </Button>
              <Button variant="primary" icon={Plus} onClick={openCreateDialog} data-testid="my-integrations-add">
                <span className="hidden sm:inline">{t.addIntegration}</span>
              </Button>
            </div>
          </div>

          {mySkills.length === 0 ? (
            <div data-testid="my-integrations-empty" className="rounded-lg border border-dashed border-neutral-200">
              <EmptyState
                icon={Plug}
                title={t.noIntegrationsYet}
                action={
                  <Button variant="primary" icon={Plus} onClick={openCreateDialog}>
                    {t.addFirstIntegration}
                  </Button>
                }
              />
            </div>
          ) : (
            renderSkillGrid(mySkills)
          )}
        </div>
      )}

      {/* ===== Webhooks ===== */}
      {activeTab === "webhooks" && (
        <div role="tabpanel" aria-label={t.tabWebhooks}>
          <WebhooksSection />
        </div>
      )}

      {/* Integration Dialog */}
      <AnimatePresence>
        {dialogMode !== null && (
          <IntegrationDialog
            mode={dialogMode}
            integrationKey={dialogKey}
            importedData={importedData}
            onClose={closeDialog}
            onSaved={handleDialogSaved}
          />
        )}
      </AnimatePresence>
    </PageShell>
  );
}
