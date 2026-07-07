"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  X,
  AlertTriangle,
  RefreshCw,
  Brain,
  Lock,
  Globe,
  CheckCircle2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Filter,
  Tag,
  Star,
  Zap,
  Archive,
  Clock,
  LayoutGrid,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useMemoryStore } from "@/stores/memory";
import { useTranslation } from "@/stores/i18n";
import { MemoryExplainer } from "@/components/memory/memory-explainer";
import { CoreTier } from "@/components/memory/core-tier";
import { MemorySettings } from "@/components/memory/memory-settings";
import GuardrailsSection from "@/components/memory/guardrails";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/spinner";

/* ---------- Animation Variants ---------- */

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.04, duration: 0.3, ease: "easeOut" as const },
  }),
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } },
};

/* ---------- Constants ---------- */

const TYPE_TONE: Record<string, BadgeTone> = {
  lesson: "info",
  workflow: "brand",
  fact: "success",
  preference: "warning",
  context: "info",
  pattern: "brand",
};

const SCOPE_TONE: Record<string, BadgeTone> = {
  company: "info",
  individual: "neutral",
  operational: "warning",
  marketing: "danger",
  technical: "neutral",
  branding: "brand",
};

const TIER_ICONS: Record<string, typeof Star> = {
  core: Star,
  active: Zap,
  archive: Archive,
};

const MEMORY_TYPES = ["lesson", "workflow", "fact", "preference", "context", "pattern"] as const;
const MEMORY_SCOPES = ["company", "individual", "operational", "marketing", "technical", "branding"] as const;

type TabKey = "overview" | "core" | "guardrails" | "recent" | "settings";

const TAB_ICONS: Record<TabKey, typeof LayoutGrid> = {
  overview: LayoutGrid,
  core: Star,
  guardrails: ShieldCheck,
  recent: Clock,
  settings: Settings,
};

const TAB_I18N_KEYS: Record<TabKey, "overview" | "alwaysActive" | "guardrails" | "recentPatterns" | "settings"> = {
  overview: "overview",
  core: "alwaysActive",
  guardrails: "guardrails",
  recent: "recentPatterns",
  settings: "settings",
};

/* ---------- Dialog Types ---------- */

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; memory: any };

/* ---------- Helpers ---------- */

function getOriginKey(origin?: string): string {
  switch (origin) {
    case "manual":
      return "manual";
    case "agent-block":
      return "agentBlock";
    case "auto-extraction":
      return "autoExtraction";
    case "signal-aggregation":
      return "signalAggregation";
    case "consolidation":
      return "consolidation";
    default:
      return "manual";
  }
}

function relativeTime(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/* ---------- Sub-components ---------- */

function TypeBadge({ type, t }: { type: string; t: any }) {
  const typeLabels = t.types as Record<string, string>;
  return (
    <Badge tone={TYPE_TONE[type] || "neutral"}>{typeLabels[type] || type}</Badge>
  );
}

function ScopeBadge({ scope, t }: { scope: string; t: any }) {
  const scopeLabels = t.scopes as Record<string, string>;
  return (
    <Badge tone={SCOPE_TONE[scope] || "neutral"}>{scopeLabels[scope] || scope}</Badge>
  );
}

function TierBadge({ tier, t }: { tier: string; t: any }) {
  const effectiveTier = tier || "active";
  const TierIcon = TIER_ICONS[effectiveTier] || Zap;
  const tierLabels = t.tiers as Record<string, string>;
  const tone: BadgeTone = effectiveTier === "core" ? "brand" : effectiveTier === "archive" ? "neutral" : "info";
  return (
    <Badge tone={tone}>
      <TierIcon size={10} />
      {tierLabels[effectiveTier] || effectiveTier}
    </Badge>
  );
}

function OriginBadge({ origin, t }: { origin?: string; t: any }) {
  const key = getOriginKey(origin);
  const label = (t.origins as Record<string, string>)[key];
  if (!label) return null;
  return <Badge tone="neutral">{label}</Badge>;
}

function VisibilityIcon({ visibility }: { visibility: string }) {
  if (visibility === "private") {
    return <Lock size={13} className="text-neutral-400" />;
  }
  return <Globe size={13} className="text-teal-500" />;
}

function TierDropdown({
  memory,
  onChangeTier,
  t,
}: {
  memory: any;
  onChangeTier: (id: string, tier: "core" | "active" | "archive") => void;
  t: any;
}) {
  const [open, setOpen] = useState(false);
  const currentTier = memory.tier || "active";
  const tiers: Array<"core" | "active" | "archive"> = ["core", "active", "archive"];
  const CurrentIcon = TIER_ICONS[currentTier] || Zap;

  return (
    <div className="relative">
      <IconButton
        icon={CurrentIcon}
        label={t.tiers.promote}
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="text-neutral-400 hover:text-teal-700"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-line bg-surface py-1 shadow-overlay">
            {tiers.map((tier) => {
              const TIcon = TIER_ICONS[tier];
              const isActive = tier === currentTier;
              return (
                <button
                  key={tier}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isActive) onChangeTier(memory.id, tier);
                    setOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center space-x-2 px-3 py-1.5 text-xs transition-colors ${
                    isActive
                      ? "bg-teal-50 font-medium text-teal-700"
                      : "text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  <TIcon size={12} />
                  <span>{(t.tiers as Record<string, string>)[tier]}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MemoryCard({
  memory,
  index,
  isSelected,
  onToggleSelect,
  onEdit,
  onDelete,
  onToggleVerify,
  onChangeTier,
  t,
}: {
  memory: any;
  index: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVerify: () => void;
  onChangeTier: (id: string, tier: "core" | "active" | "archive") => void;
  t: any;
}) {
  const usageCount = memory.metadata?.usageCount || memory.usageCount || 0;
  const lastUsedAt = memory.lastUsedAt || memory.metadata?.lastUsedAt;

  return (
    <motion.div
      layout
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <Card
        hover
        className={`group ${isSelected ? "border-teal-600 ring-1 ring-teal-500/30" : ""}`}
      >
        {/* Header row */}
        <div className="mb-2 flex items-start justify-between">
          <div className="flex min-w-0 flex-1 items-start space-x-2">
            <div className="mt-0.5 shrink-0">
              <Checkbox checked={isSelected} onChange={() => onToggleSelect()} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-neutral-800">
                  {memory.title}
                </span>
                {memory.metadata?.verified && (
                  <CheckCircle2 size={14} className="shrink-0 text-teal-500" />
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <TypeBadge type={memory.type} t={t} />
                <ScopeBadge scope={memory.scope} t={t} />
                <TierBadge tier={memory.tier} t={t} />
                <VisibilityIcon visibility={memory.visibility} />
              </div>
            </div>
          </div>
          <div className="ml-2 flex shrink-0 items-center space-x-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <TierDropdown memory={memory} onChangeTier={onChangeTier} t={t} />
            <IconButton
              icon={CheckCircle2}
              label={memory.metadata?.verified ? t.actions.unverify : t.actions.verify}
              size="sm"
              onClick={onToggleVerify}
              className="text-neutral-400 hover:text-teal-700"
            />
            <IconButton
              icon={Pencil}
              label={t.actions.edit}
              size="sm"
              onClick={onEdit}
              className="text-neutral-400 hover:text-teal-700"
            />
            <IconButton
              icon={Trash2}
              label={t.actions.delete}
              size="sm"
              onClick={onDelete}
              className="text-neutral-400 hover:text-red-500"
            />
          </div>
        </div>

        {/* Origin badge */}
        <div className="mb-2">
          <OriginBadge origin={memory.origin} t={t} />
        </div>

        {/* Content preview */}
        <p className="mb-2 line-clamp-2 text-xs text-neutral-500">{memory.content}</p>

        {/* Tags */}
        {memory.tags && memory.tags.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {[...new Set<string>(memory.tags)].slice(0, 4).map((tag: string) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
            {memory.tags.length > 4 && (
              <Badge tone="neutral">+{memory.tags.length - 4}</Badge>
            )}
          </div>
        )}

        {/* Footer with usage info */}
        <div className="flex items-center justify-between text-[11px] text-neutral-400">
          <span>
            {memory.source?.agentType
              ? `${t.source.agent}: ${memory.source.agentType}`
              : t.source.manual}
          </span>
          <div className="flex items-center gap-2">
            {usageCount > 0 && (
              <span className="flex items-center gap-0.5">
                <Clock size={10} />
                {t.usage.usedTimes(usageCount)}
              </span>
            )}
            {lastUsedAt ? (
              <span>{relativeTime(lastUsedAt)}</span>
            ) : (
              <span>{new Date(memory.createdAt).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

/* ---------- Form dialog ---------- */

function MemoryFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
  titleLabel,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  initialData?: any;
  titleLabel: string;
  t: any;
}) {
  const [title, setTitle] = useState(initialData?.title || "");
  const [type, setType] = useState(initialData?.type || "lesson");
  const [content, setContent] = useState(initialData?.content || "");
  const [tagsStr, setTagsStr] = useState(initialData?.tags?.join(", ") || "");
  const [visibility, setVisibility] = useState(initialData?.visibility || "shared");
  const [scope, setScope] = useState(initialData?.scope || "company");

  useEffect(() => {
    if (open) {
      setTitle(initialData?.title || "");
      setType(initialData?.type || "lesson");
      setContent(initialData?.content || "");
      setTagsStr(initialData?.tags?.join(", ") || "");
      setVisibility(initialData?.visibility || "shared");
      setScope(initialData?.scope || "company");
    }
  }, [open, initialData]);

  function submitForm() {
    if (!title.trim() || !content.trim()) return;
    const tags = tagsStr
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    onSubmit({ title: title.trim(), type, content: content.trim(), tags, visibility, scope });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitForm();
  }

  const typeLabels = t.types as Record<string, string>;
  const scopeLabels = t.scopes as Record<string, string>;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={titleLabel}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.form.cancel}
          </Button>
          <Button variant="primary" onClick={submitForm}>
            {t.form.save}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t.form.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Always use Tailwind for styling"
          required
        />

        <Select label={t.form.type} value={type} onChange={(e) => setType(e.target.value)}>
          {MEMORY_TYPES.map((mt) => (
            <option key={mt} value={mt}>
              {typeLabels[mt] || mt}
            </option>
          ))}
        </Select>

        <Textarea
          label={t.form.content}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          required
        />

        <Input
          label={t.form.tags}
          value={tagsStr}
          onChange={(e) => setTagsStr(e.target.value)}
          placeholder="css, tailwind, best-practice"
          hint={t.form.tagsHint}
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t.form.visibility}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="shared">{t.visibility.shared}</option>
            <option value="private">{t.visibility.private}</option>
          </Select>
          <Select label={t.form.scope} value={scope} onChange={(e) => setScope(e.target.value)}>
            {MEMORY_SCOPES.map((ms) => (
              <option key={ms} value={ms}>
                {scopeLabels[ms] || ms}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------- Recent Patterns Tab ---------- */

type RecentFilter = "week" | "month" | "all";

function RecentPatternsTab({ memories, t }: { memories: any[]; t: any }) {
  const [timeFilter, setTimeFilter] = useState<RecentFilter>("all");

  const filteredMemories = useMemo(() => {
    const now = new Date();
    let cutoff: Date | null = null;
    if (timeFilter === "week") {
      cutoff = new Date(now.getTime() - 7 * 86400000);
    } else if (timeFilter === "month") {
      cutoff = new Date(now.getTime() - 30 * 86400000);
    }

    const sorted = [...memories].sort((a, b) => {
      const aDate = a.lastUsedAt || a.metadata?.lastUsedAt || a.createdAt;
      const bDate = b.lastUsedAt || b.metadata?.lastUsedAt || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });

    if (!cutoff) return sorted;

    return sorted.filter((m) => {
      const date = m.lastUsedAt || m.metadata?.lastUsedAt || m.createdAt;
      return new Date(date).getTime() >= cutoff!.getTime();
    });
  }, [memories, timeFilter]);

  const typeLabels = t.types as Record<string, string>;

  return (
    <div className="space-y-4">
      {/* Time filter */}
      <div className="flex items-center gap-2">
        <Clock size={14} className="text-neutral-400" />
        {(["week", "month", "all"] as RecentFilter[]).map((f) => (
          <Button
            key={f}
            variant={timeFilter === f ? "primary" : "secondary"}
            size="sm"
            onClick={() => setTimeFilter(f)}
          >
            {t.recent.timeFilter[f]}
          </Button>
        ))}
      </div>

      {/* Memory list */}
      {filteredMemories.length > 0 ? (
        <div className="space-y-2">
          {filteredMemories.map((memory: any, i: number) => {
            const usageCount = memory.metadata?.usageCount || memory.usageCount || 0;
            const lastUsedAt = memory.lastUsedAt || memory.metadata?.lastUsedAt;
            const effectiveTier = memory.tier || "active";
            const TIcon = TIER_ICONS[effectiveTier] || Zap;

            return (
              <motion.div
                key={memory.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
              >
                <Card padding="sm" hover className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <TIcon
                        size={13}
                        className={
                          effectiveTier === "core"
                            ? "shrink-0 text-teal-500"
                            : effectiveTier === "archive"
                            ? "shrink-0 text-neutral-400"
                            : "shrink-0 text-blue-500"
                        }
                      />
                      <span className="truncate text-sm font-medium text-neutral-800">
                        {memory.title}
                      </span>
                      <Badge tone={TYPE_TONE[memory.type] || "neutral"}>
                        {typeLabels[memory.type] || memory.type}
                      </Badge>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-3 text-[11px] text-neutral-400">
                      {usageCount > 0 && <span>{t.usage.usedTimes(usageCount)}</span>}
                      <span>
                        {lastUsedAt
                          ? `${t.recent.lastUsed}: ${relativeTime(lastUsedAt)}`
                          : t.recent.neverUsed}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-1 pl-5 text-xs text-neutral-500">
                    {memory.content}
                  </p>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Clock} title={t.noMemories} />
      )}
    </div>
  );
}

/* ---------- Main Component ---------- */

export default function MemoryPage() {
  const { common, pages_memory: t } = useTranslation();
  const confirm = useConfirm();

  const memories = useMemoryStore((s) => s.memories);
  const stats = useMemoryStore((s) => s.stats);
  const tags = useMemoryStore((s) => s.tags);
  const activeTab = useMemoryStore((s) => s.activeTab);
  const selectedIds = useMemoryStore((s) => s.selectedIds);
  const filters = useMemoryStore((s) => s.filters);
  const page = useMemoryStore((s) => s.page);
  const totalPages = useMemoryStore((s) => s.totalPages);
  const total = useMemoryStore((s) => s.total);
  const isLoading = useMemoryStore((s) => s.isLoading);
  const error = useMemoryStore((s) => s.error);

  const fetchMemories = useMemoryStore((s) => s.fetchMemories);
  const fetchStats = useMemoryStore((s) => s.fetchStats);
  const fetchTags = useMemoryStore((s) => s.fetchTags);
  const storeCreateMemory = useMemoryStore((s) => s.createMemory);
  const storeUpdateMemory = useMemoryStore((s) => s.updateMemory);
  const storeDeleteMemory = useMemoryStore((s) => s.deleteMemory);
  const storeBulkDelete = useMemoryStore((s) => s.bulkDeleteMemories);
  const updateMemoryTier = useMemoryStore((s) => s.updateMemoryTier);
  const setActiveTab = useMemoryStore((s) => s.setActiveTab);
  const setFilter = useMemoryStore((s) => s.setFilter);
  const clearFilters = useMemoryStore((s) => s.clearFilters);
  const setPage = useMemoryStore((s) => s.setPage);
  const toggleSelect = useMemoryStore((s) => s.toggleSelect);
  const selectAll = useMemoryStore((s) => s.selectAll);
  const clearSelection = useMemoryStore((s) => s.clearSelection);
  const clearError = useMemoryStore((s) => s.clearError);

  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  // Fetch on mount
  useEffect(() => {
    fetchMemories();
    fetchStats();
    fetchTags();
  }, [fetchMemories, fetchStats, fetchTags]);

  const hasActiveFilters =
    filters.type || filters.scope || filters.visibility || filters.tags.length > 0 || filters.search;

  const handleRetry = useCallback(() => {
    clearError();
    fetchMemories();
    fetchStats();
    fetchTags();
  }, [clearError, fetchMemories, fetchStats, fetchTags]);

  async function handleCreateMemory(data: any) {
    const result = await storeCreateMemory(data);
    if (result.success) {
      setDialog({ kind: "none" });
    }
  }

  async function handleUpdateMemory(data: any) {
    if (dialog.kind !== "edit") return;
    const result = await storeUpdateMemory(dialog.memory.id, data);
    if (result.success) {
      setDialog({ kind: "none" });
    }
  }

  async function handleDeleteOne(memory: any) {
    const ok = await confirm({
      title: t.deleteMemory,
      description: t.deleteConfirm,
      confirmLabel: common.delete,
      tone: "danger",
    });
    if (!ok) return;
    await storeDeleteMemory(memory.id);
  }

  async function handleBulkDelete() {
    const ok = await confirm({
      title: t.actions.deleteSelected,
      description: t.deleteConfirmBulk,
      confirmLabel: common.delete,
      tone: "danger",
    });
    if (!ok) return;
    await storeBulkDelete();
  }

  async function handleToggleVerify(memory: any) {
    await storeUpdateMemory(memory.id, { verified: !memory.metadata?.verified });
  }

  function handleChangeTier(id: string, tier: "core" | "active" | "archive") {
    updateMemoryTier(id, tier);
  }

  function handleTagFilterClick(tag: string) {
    const current = filters.tags;
    if (current.includes(tag)) {
      setFilter("tags", current.filter((t) => t !== tag));
    } else {
      setFilter("tags", [...current, tag]);
    }
  }

  const typeLabels = t.types as Record<string, string>;

  const tabKeys: TabKey[] = ["overview", "core", "guardrails", "recent", "settings"];
  const tabItems = tabKeys.map((key) => ({
    key,
    label: t.tabs[TAB_I18N_KEYS[key]],
    icon: TAB_ICONS[key],
  }));

  return (
    <PageShell width="wide" testId="memory-page">
      <PageHeader
        icon={Brain}
        title={t.title}
        description={t.subtitle}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "add" })}>
            {t.addMemory}
          </Button>
        }
      />

      {/* Explainer */}
      <MemoryExplainer />

      {/* Error state */}
      {error && (
        <Card className="flex items-center justify-between border-red-200 bg-red-50">
          <div className="flex items-center space-x-2 text-red-600">
            <AlertTriangle size={16} />
            <span className="text-sm">{error}</span>
          </div>
          <Button variant="danger-ghost" size="sm" icon={RefreshCw} onClick={handleRetry}>
            {common.retry}
          </Button>
        </Card>
      )}

      {/* Tab bar */}
      <Tabs items={tabItems} value={activeTab} onChange={(key) => setActiveTab(key as TabKey)} />

      {/* Tab content */}
      {activeTab === "overview" && (
        <>
          {/* Stats bar */}
          {stats && (
            <Card>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Brain size={15} className="text-teal-600" />
                  <span className="text-sm font-medium text-neutral-700">{t.stats.total}</span>
                </div>
                <div className="flex items-center space-x-4 text-xs text-neutral-500">
                  <span>{stats.total} {t.stats.total.toLowerCase()}</span>
                  <span>{stats.verified} {t.stats.verified.toLowerCase()}</span>
                  <span>{stats.recentCount} {t.stats.recent.toLowerCase()}</span>
                  {stats.topTags && stats.topTags.length > 0 && (
                    <span>
                      {t.stats.topTags}: {stats.topTags.slice(0, 3).map((tt: any) => tt.tag).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Filter bar */}
          <Card padding="sm">
            <div className="flex flex-wrap items-center gap-2">
              <Filter size={14} className="shrink-0 text-neutral-400" />
              {/* Type filter */}
              <Select
                value={filters.type}
                onChange={(e) => setFilter("type", e.target.value)}
                wrapperClassName="w-auto"
                className="py-1.5"
              >
                <option value="">{t.filters.allTypes}</option>
                {MEMORY_TYPES.map((mt) => (
                  <option key={mt} value={mt}>
                    {typeLabels[mt] || mt}
                  </option>
                ))}
              </Select>

              {/* Scope filter */}
              <Select
                value={filters.scope}
                onChange={(e) => setFilter("scope", e.target.value)}
                wrapperClassName="w-auto"
                className="py-1.5"
              >
                <option value="">{t.filters.allScopes}</option>
                {MEMORY_SCOPES.map((ms) => (
                  <option key={ms} value={ms}>
                    {(t.scopes as Record<string, string>)[ms] || ms}
                  </option>
                ))}
              </Select>

              {/* Visibility filter */}
              <Select
                value={filters.visibility}
                onChange={(e) => setFilter("visibility", e.target.value)}
                wrapperClassName="w-auto"
                className="py-1.5"
              >
                <option value="">{t.filters.allVisibility}</option>
                <option value="shared">{t.visibility.shared}</option>
                <option value="private">{t.visibility.private}</option>
              </Select>

              {/* Search */}
              <SearchInput
                value={filters.search}
                onValueChange={(v) => setFilter("search", v)}
                placeholder={t.filters.search}
                className="min-w-[200px] flex-1"
              />

              {/* Clear filters */}
              {hasActiveFilters && (
                <Button variant="secondary" size="sm" icon={X} onClick={clearFilters}>
                  {t.filters.clearFilters}
                </Button>
              )}
            </div>

            {/* Tag chips */}
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Tag size={12} className="shrink-0 text-neutral-400" />
                {tags.slice(0, 15).map((tagItem) => (
                  <button
                    key={tagItem.tag}
                    onClick={() => handleTagFilterClick(tagItem.tag)}
                    className={`cursor-pointer rounded-full px-2 py-0.5 text-xs transition-colors ${
                      filters.tags.includes(tagItem.tag)
                        ? "bg-teal-800 font-medium text-white"
                        : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                    }`}
                  >
                    {tagItem.tag} ({tagItem.count})
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* Bulk actions bar */}
          <AnimatePresence>
            {selectedIds.size > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between rounded-lg border border-teal-800 bg-teal-900 p-3">
                  <span className="text-sm font-medium text-white">
                    {selectedIds.size} {t.actions.selected}
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={selectAll}
                      className="cursor-pointer text-xs text-teal-300 transition-colors hover:text-white"
                    >
                      {common.select}
                    </button>
                    <button
                      onClick={clearSelection}
                      className="cursor-pointer text-xs text-neutral-300 transition-colors hover:text-white"
                    >
                      {common.clear}
                    </button>
                    <Button variant="danger" size="sm" icon={Trash2} onClick={handleBulkDelete}>
                      {t.actions.deleteSelected}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Loading state */}
          {isLoading && memories.length === 0 && <LoadingState label={common.loading} />}

          {/* Memory cards grid */}
          {(!isLoading || memories.length > 0) && memories.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {memories.map((memory: any, i: number) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    index={i}
                    isSelected={selectedIds.has(memory.id)}
                    onToggleSelect={() => toggleSelect(memory.id)}
                    onEdit={() => setDialog({ kind: "edit", memory })}
                    onDelete={() => handleDeleteOne(memory)}
                    onToggleVerify={() => handleToggleVerify(memory)}
                    onChangeTier={handleChangeTier}
                    t={t}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && memories.length === 0 && (
            <EmptyState
              icon={Brain}
              title={t.noMemories}
              description={t.noMemoriesDesc}
              action={
                <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "add" })}>
                  {t.addMemory}
                </Button>
              }
            />
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-neutral-500">
                {total} {t.stats.total.toLowerCase()}
              </span>
              <div className="flex items-center space-x-1">
                <IconButton
                  icon={ChevronLeft}
                  label={t.pagination.previous}
                  size="sm"
                  variant="secondary"
                  onClick={() => setPage(page - 1)}
                  disabled={page <= 1}
                />
                {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`h-8 w-8 cursor-pointer rounded-lg text-xs font-medium transition-colors ${
                        pageNum === page
                          ? "bg-teal-600 text-white"
                          : "text-neutral-500 hover:bg-neutral-100"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <IconButton
                  icon={ChevronRight}
                  label={t.pagination.next}
                  size="sm"
                  variant="secondary"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages}
                />
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "core" && <CoreTier />}

      {activeTab === "guardrails" && <GuardrailsSection />}

      {activeTab === "recent" && <RecentPatternsTab memories={memories} t={t} />}

      {activeTab === "settings" && <MemorySettings />}

      {/* Dialogs */}
      <MemoryFormDialog
        open={dialog.kind === "add"}
        onClose={() => setDialog({ kind: "none" })}
        onSubmit={handleCreateMemory}
        titleLabel={t.addMemory}
        t={t}
      />

      <MemoryFormDialog
        open={dialog.kind === "edit"}
        onClose={() => setDialog({ kind: "none" })}
        onSubmit={handleUpdateMemory}
        initialData={dialog.kind === "edit" ? dialog.memory : undefined}
        titleLabel={t.editMemory}
        t={t}
      />
    </PageShell>
  );
}
