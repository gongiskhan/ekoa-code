"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Layout,
  Table2,
  Bot,
  Presentation,
  FileText,
  Search,
  Clock,
  Calendar,
  FolderKanban,
  Hammer,
  Filter,
  SortAsc,
  ChevronDown,
  Trash2,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Play,
  Link as LinkIcon,
  Pencil,
  Check,
  Share2,
  Square,
  Terminal,
  X,
  FileCode2,
  Eye,
  ExternalLink,
  History,
  Download,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { api, tryCall, ApiError } from "@/lib/api";
import type { ArtifactBundle, BundleUpdateResponse } from "@ekoa/shared";
import { readBundleFile } from "@/lib/artifact-bundle";
import { copyToClipboard } from "@/lib/clipboard";
import { useAuthStore } from "@/stores/auth";
import { useTranslation } from "@/stores/i18n";
import { useVerticalProfile, partitionStartingPoints } from "@/lib/verticals";
import { toast } from "@/stores/toast";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton, buttonClasses } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState as EmptyStateUi } from "@/components/ui/empty-state";
import { Dialog } from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import { ArtifactPreviewOverlay } from "@/components/artifacts/artifact-preview-overlay";
import { VersionsPanel } from "@/components/artifacts/versions-panel";
import { DataBackupsPanel } from "@/components/artifacts/data-backups-panel";
import { ArtifactBackendPanel } from "@/components/artifacts/artifact-backend-panel";
import { BackendTriggerCard } from "@/components/artifacts/backend-trigger-card";
import { VisibilityControl, type Visibility } from "@/components/sharing/visibility-control";

/* ---------- Types ---------- */

interface ArtifactInstance {
  id: string;
  title: string;
  name?: string;
  summary?: string;
  status: string;
  slug?: string;
  templateId?: string;
  typeId?: string;
  createdAt: string;
  updatedAt?: string;
  data?: Record<string, unknown>;
  shareable?: boolean;
  /** Org sharing visibility (Amendment 2, FC-503): 'private' | 'org'. */
  visibility?: Visibility;
  screenshotUrl?: string;
  /** Declared Layer-2 backend handler names (enriched by the artifacts handler). */
  backendHandlers?: string[];
  health?: {
    status: "healthy" | "broken";
    lastError?: string;
    lastReason?:
      | "uncaught-error"
      | "unhandled-rejection"
      | "empty-dom"
      | "missing-build";
    lastCheckedAt: string;
  };
  [key: string]: unknown;
}

type FilterKey = "all" | "draft" | "building" | "ready" | "running" | "failed" | "shared";
type SortKey = "recent" | "name" | "status";

/* ---------- Config ---------- */

const typeIconMap: Record<string, LucideIcon> = {
  web_app: Globe,
  landing_page: Layout,
  report_excel: Table2,
  agent_app: Bot,
  presentation_html: Presentation,
  document_pdf: FileText,
};

function guessOutputKind(templateId?: string): string {
  if (!templateId) return "web_app";
  if (templateId.includes("landing")) return "landing_page";
  if (templateId.includes("report")) return "report_excel";
  if (templateId.includes("agent")) return "agent_app";
  if (templateId.includes("presentation")) return "presentation_html";
  if (templateId.includes("document")) return "document_pdf";
  return "web_app";
}

function formatTypeName(templateId?: string): string {
  if (!templateId) return "Web App";
  // Convert snake_case/kebab-case IDs to Title Case
  return templateId
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusTone: Record<string, BadgeTone> = {
  draft: "neutral",
  queued: "warning",
  installing: "warning",
  building: "warning",
  starting: "warning",
  running: "success",
  healthy: "success",
  active: "success",
  ready: "info",
  completed: "neutral",
  failed: "danger",
  stopped: "neutral",
  archived: "neutral",
};

const statusLabelKey: Record<string, string> = {
  draft: "statusDraft",
  queued: "statusQueued",
  installing: "statusInstalling",
  building: "statusBuilding",
  starting: "statusStarting",
  running: "statusRunning",
  healthy: "statusHealthy",
  ready: "statusReady",
  completed: "statusCompleted",
  failed: "statusFailed",
  stopped: "statusStopped",
  active: "statusRunning",
  archived: "statusStopped",
};

const filterKeys: FilterKey[] = ["all", "running", "ready", "building", "draft", "failed", "shared"];
const sortKeys: SortKey[] = ["recent", "name", "status"];

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

/* ---------- Helpers ---------- */

function getArtifactTitle(artifact: ArtifactInstance): string {
  return artifact.title || artifact.name || "Untitled Artifact";
}

function getTemplateId(artifact: ArtifactInstance): string | undefined {
  return artifact.templateId || artifact.typeId;
}

function getArtifactAppUrl(artifact: ArtifactInstance): string | null {
  if (artifact.id && (artifact.status === "ready" || artifact.status === "running" || artifact.status === "active")) {
    // Prefer slug-based URL when available
    return api.appUrl(artifact.slug || artifact.id);
  }
  return null;
}

function formatDate(
  dateStr: string,
  labels?: { yesterday: string; daysAgo: (n: number) => string },
): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diffDays === 1) return labels?.yesterday ?? "Yesterday";
  if (diffDays < 7) return labels ? labels.daysAgo(diffDays) : `${diffDays} days ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/* ---------- Sub-components ---------- */

function StatusBadge({ status }: { status: string }) {
  const { pages_artifacts: a } = useTranslation();
  const tone = statusTone[status] || "neutral";
  const labelKey = statusLabelKey[status] || "statusDraft";
  const label = (a as Record<string, unknown>)[labelKey] as string;

  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

function TypeIcon({
  templateId,
  size = "md",
}: {
  templateId?: string;
  size?: "sm" | "md";
}) {
  const kind = guessOutputKind(templateId);
  const Icon = typeIconMap[kind] || Globe;
  const iconSize = size === "sm" ? 16 : 20;

  return <Icon size={iconSize} className="text-neutral-900 flex-shrink-0" />;
}

/* ---------- Action Button ---------- */

function ActionButton({
  icon: Icon,
  title,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      icon={Icon}
      label={title}
      title={title}
      size="sm"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick(e);
      }}
    />
  );
}

/* ---------- Log Viewer ---------- */

function LogViewer({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const { pages_artifacts: a } = useTranslation();
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const scrollRef = useCallback((node: HTMLPreElement | null) => {
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchInfo() {
      setIsLoadingLogs(true);
      try {
        const res = await tryCall(() => api.companySpace.get({ artifactId }));
        if (!cancelled && res.ok) {
          const data = res.data as unknown as { serving?: boolean; url?: string | null; status?: string; registeredAt?: string | null };
          const lines: string[] = [];
          lines.push(`Status: ${data.status ?? 'unknown'}`);
          lines.push(`Serving: ${data.serving ? 'yes' : 'no'}`);
          if (data.url) lines.push(`URL: ${data.url}`);
          if (data.registeredAt) lines.push(`Registered: ${data.registeredAt}`);
          lines.push('', 'Apps are served as static files. No runtime process logs.');
          setLogs(lines);
        } else if (!cancelled) {
          setLogs(['App info unavailable.']);
        }
      } catch {
        if (!cancelled) setLogs(['Failed to fetch app info.']);
      } finally {
        if (!cancelled) setIsLoadingLogs(false);
      }
    }
    fetchInfo();
    return () => { cancelled = true; };
  }, [artifactId]);

  return (
    <Dialog open onClose={onClose} size="lg" title={a.logsTitle}>
      <pre
        ref={scrollRef}
        className="max-h-[55vh] overflow-y-auto rounded-lg bg-neutral-900 p-4 text-xs font-mono text-teal-300 leading-relaxed scrollbar-light"
      >
        {isLoadingLogs ? (
          <span className="text-neutral-400 flex items-center gap-2">
            <Spinner size="xs" />
            {a.loadingLogs}
          </span>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">{line}</div>
          ))
        )}
      </pre>
    </Dialog>
  );
}

/* ---------- Artifact Card ---------- */

function ArtifactCard({
  artifact,
  onClick,
  onDelete,
  onRun,
  onCopyLink,
  onContinueWorking,
  onToggleShare,
  onStart,
  onStop,
  onViewLogs,
  onPreview,
  onOpenInNewTab,
  copiedId,
  startingId,
  stoppingId,
}: {
  artifact: ArtifactInstance;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onRun: (e: React.MouseEvent) => void;
  onCopyLink: (e: React.MouseEvent) => void;
  onContinueWorking: (e: React.MouseEvent) => void;
  onToggleShare: (e: React.MouseEvent) => void;
  onStart: (e: React.MouseEvent) => void;
  onStop: (e: React.MouseEvent) => void;
  onViewLogs: (e: React.MouseEvent) => void;
  onPreview: (e: React.MouseEvent) => void;
  onOpenInNewTab: (e: React.MouseEvent) => void;
  copiedId: string | null;
  startingId: string | null;
  stoppingId: string | null;
}) {
  const { pages_artifacts: a } = useTranslation();
  const typeId = getTemplateId(artifact);
  const appUrl = getArtifactAppUrl(artifact);
  const isRunnable =
    artifact.status === "running" ||
    artifact.status === "ready" ||
    artifact.status === "active" ||
    artifact.status === "healthy";
  const isRunning =
    artifact.status === "running" ||
    artifact.status === "active" ||
    artifact.status === "healthy";
  const isStartable =
    artifact.status === "ready" ||
    artifact.status === "stopped" ||
    artifact.status === "completed";
  const hasLink = !!appUrl;
  const port = artifact.data?.port as number | undefined;

  return (
    <motion.div
      variants={cardVariants}
      onClick={onClick}
      className="group flex cursor-pointer flex-col rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong"
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <TypeIcon templateId={typeId} size="sm" />
          <h3 className="text-sm font-semibold text-neutral-900 truncate">
            {getArtifactTitle(artifact)}
          </h3>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {artifact.health?.status === "broken" && (
            <span
              title={
                artifact.health.lastError
                  ? `${a.brokenTitle}: ${artifact.health.lastError}`
                  : a.brokenTitle
              }
              aria-label={a.brokenAria}
              className="flex-shrink-0"
            >
              <AlertTriangle size={14} className="text-red-600" />
            </span>
          )}
          <StatusBadge status={artifact.status} />
          <button
            onClick={onDelete}
            className="rounded-md p-1 text-neutral-300 opacity-0 transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus-ring cursor-pointer"
            title={a.deleteArtifact}
            aria-label={a.deleteArtifactAriaLabel}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Screenshot thumbnail */}
      {artifact.screenshotUrl && (
        <img
          src={api.resolveUrl(artifact.screenshotUrl)}
          alt={getArtifactTitle(artifact)}
          loading="lazy"
          className="mb-3 h-32 w-full rounded-lg border border-line object-cover"
        />
      )}

      {/* Template/type subtitle */}
      <p className="text-xs text-neutral-400 mb-1 truncate">
        {formatTypeName(typeId)}
      </p>

      {/* Description */}
      {artifact.summary && (
        <p className="text-xs text-neutral-500 line-clamp-2 leading-relaxed mb-2">
          {artifact.summary}
        </p>
      )}

      {/* Live status: port + URL for running apps */}
      {isRunning && port && (
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 text-xs text-green-700 font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
            :{port}
          </span>
          {appUrl && (
            <a
              href={appUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-teal-700 hover:text-teal-800 font-mono truncate max-w-[160px] hover:underline"
            >
              {appUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
      )}

      {/* Spacer to push footer to bottom */}
      <div className="flex-1" />

      {/* Footer with date and actions */}
      <div className="pt-3 mt-2 border-t border-line">
        {/* Created date */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-neutral-400 flex items-center gap-1">
            <Calendar size={11} />
            {formatDate(artifact.createdAt, a)}
          </span>
          {artifact.updatedAt && artifact.updatedAt !== artifact.createdAt && (
            <span className="text-xs text-neutral-400 flex items-center gap-1">
              <Clock size={11} />
              {formatDate(artifact.updatedAt, a)}
            </span>
          )}
        </div>

        {/* Action buttons row */}
        <div className="flex items-center gap-0.5">
          {/* Primary "Usar" — open the served app. Disabled until it is built. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (isRunnable) onRun(e); }}
            disabled={!isRunnable}
            aria-label={a.use}
            data-testid={`artifact-use-${artifact.id}`}
            className={`${buttonClasses("primary", "sm")} mr-1 justify-center disabled:opacity-40`}
          >
            {a.use}
          </button>
          {/* Start / Stop controls */}
          {isRunning ? (
            <button
              onClick={(e) => { e.stopPropagation(); onStop(e); }}
              disabled={stoppingId === artifact.id}
              title={a.stopApp}
              aria-label={a.stopApp}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 focus-ring"
            >
              {stoppingId === artifact.id ? <Spinner size="xs" /> : <Square size={15} />}
            </button>
          ) : isStartable ? (
            <button
              onClick={(e) => { e.stopPropagation(); onStart(e); }}
              disabled={startingId === artifact.id}
              title={a.startApp}
              aria-label={a.startApp}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-40 focus-ring"
            >
              {startingId === artifact.id ? <Spinner size="xs" /> : <Play size={15} />}
            </button>
          ) : (
            <ActionButton
              icon={Play}
              title={isRunnable ? a.openApp : a.notRunning}
              onClick={onRun}
              disabled={!isRunnable}
            />
          )}
          <ActionButton
            icon={ExternalLink}
            title={isRunnable ? a.openInNewTab : a.notRunning}
            onClick={onOpenInNewTab}
            disabled={!isRunnable}
          />
          <ActionButton
            icon={Pencil}
            title={a.continueWorking}
            onClick={onContinueWorking}
          />
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- Delete Confirmation Dialog ---------- */

function DeleteDialog({
  artifactName,
  isDeleting,
  onClose,
  onConfirm,
}: {
  artifactName: string;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { pages_artifacts: a, common } = useTranslation();
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={a.deleteArtifact}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isDeleting}>
            {common.cancel}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={isDeleting}>
            {common.delete}
          </Button>
        </>
      }
    >
      <p className="text-sm text-neutral-600">
        {a.deleteConfirmation(artifactName)} {a.cannotBeUndone}
      </p>
    </Dialog>
  );
}

/* ---------- Update-or-create choice for a matching imported bundle ---------- */

function UpdateOrCreateDialog({
  artifactName,
  isBusy,
  onUpdate,
  onCreateNew,
  onClose,
}: {
  artifactName: string;
  isBusy: boolean;
  onUpdate: () => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={() => { if (!isBusy) onClose(); }}
      size="md"
      title="Este bundle corresponde a uma app existente"
      footer={
        <Button variant="ghost" onClick={onClose} disabled={isBusy}>
          Cancelar
        </Button>
      }
    >
      <div data-testid="update-or-create-dialog" className="space-y-3">
        <p className="text-sm text-neutral-600">
          O artefacto que está a importar é uma revisão de{" "}
          <span className="font-medium text-neutral-900">&quot;{artifactName}&quot;</span>.
          Pode atualizar a app existente sem perder os dados nem o endereço, ou criar uma
          instância nova separada.
        </p>
        <div className="flex flex-col space-y-2">
          <Button
            variant="primary"
            onClick={onUpdate}
            loading={isBusy}
            autoFocus
            aria-busy={isBusy}
            className="w-full justify-center"
            data-testid="update-existing-button"
          >
            Atualizar a app existente (mantém dados e URL)
          </Button>
          <Button
            variant="secondary"
            onClick={onCreateNew}
            disabled={isBusy}
            className="w-full justify-center"
            data-testid="create-new-instance-button"
          >
            Criar nova instância
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- Confirm forcing an upload-update that isn't a revision ---------- */

function ForceUpdateDialog({
  artifactName,
  isBusy,
  onConfirm,
  onClose,
}: {
  artifactName: string;
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={() => { if (!isBusy) onClose(); }}
      size="md"
      title="Este ficheiro não parece ser uma revisão desta app"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            loading={isBusy}
            data-testid="force-update-confirm"
          >
            Atualizar mesmo assim
          </Button>
        </>
      }
    >
      <p data-testid="force-update-dialog" className="text-sm text-neutral-600">
        O ficheiro que escolheu não corresponde a{" "}
        <span className="font-medium text-neutral-900">&quot;{artifactName}&quot;</span>.
        Pode atualizar mesmo assim — será guardada uma cópia de segurança dos dados e
        uma versão anterior, que pode repor em Versões e Dados e cópias de segurança.
      </p>
    </Dialog>
  );
}

/* ---------- Featured update consent dialog ---------- */

function FeaturedUpdateDialog({
  artifactName,
  version,
  isBusy,
  onUpdate,
  onKeepMine,
  onClose,
}: {
  artifactName: string;
  version: string;
  isBusy: boolean;
  onUpdate: () => void;
  onKeepMine: () => void;
  onClose: () => void;
}) {
  const { pages_artifacts: a, common } = useTranslation();
  const sp = a.startingPoints;
  return (
    <Dialog
      open
      onClose={() => { if (!isBusy) onClose(); }}
      size="md"
      title={sp.updateDialogTitle}
      footer={
        <Button variant="ghost" onClick={onClose} disabled={isBusy}>
          {common.cancel}
        </Button>
      }
    >
      <div data-testid="featured-update-dialog" className="space-y-3">
        <p className="text-sm text-neutral-600">
          <span className="font-medium text-neutral-900">&quot;{artifactName}&quot;</span> — {sp.updateDialogBody(version)}
        </p>
        <div className="flex flex-col space-y-2">
          <Button
            variant="primary"
            onClick={onUpdate}
            loading={isBusy}
            autoFocus
            aria-busy={isBusy}
            className="w-full justify-center"
            data-testid="featured-update-confirm"
          >
            {sp.updateNow}
          </Button>
          <Button
            variant="secondary"
            onClick={onKeepMine}
            disabled={isBusy}
            className="w-full justify-center"
            data-testid="featured-update-keep"
          >
            {sp.keepMine}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- Slug Inline Editor ---------- */

function SlugEditor({
  artifact,
  onSlugSaved,
}: {
  artifact: ArtifactInstance;
  onSlugSaved: (slug: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(artifact.slug || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const isActive = artifact.status === "active" || artifact.status === "ready" || artifact.status === "running";

  if (!isActive && !artifact.slug) return null;

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Slug cannot be empty");
      return;
    }
    if (!slugRe.test(trimmed) || trimmed.length > 60) {
      setError("Invalid format (lowercase, hyphenated, max 60 chars)");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await tryCall(() => api.artifacts.patch({ id: artifact.id, slug: trimmed }));
      if (result.ok) {
        onSlugSaved(trimmed);
        setEditing(false);
      } else {
        setError(result.error.message || "Failed to save slug");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save slug");
    } finally {
      setSaving(false);
    }
  }

  if (!artifact.slug && isActive) {
    return (
      <div className="flex items-center justify-between text-sm">
        <dt className="text-neutral-500">Slug</dt>
        <dd className="text-xs text-neutral-400 italic">Generating...</dd>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between text-sm">
      <dt className="text-neutral-500 pt-0.5">Slug</dt>
      <dd className="flex flex-col items-end gap-1">
        {editing ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={value}
                onChange={(e) => { setValue(e.target.value.toLowerCase()); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditing(false); setValue(artifact.slug || ""); setError(null); } }}
                className="px-2 py-1 text-xs font-mono border border-neutral-300 rounded-md focus:outline-none focus:border-teal-500 w-48"
                autoFocus
                disabled={saving}
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="p-1 text-teal-600 hover:text-teal-700 rounded hover:bg-teal-50 transition-colors cursor-pointer disabled:opacity-50"
                title="Save"
              >
                {saving ? <Spinner size="xs" /> : <Check size={13} />}
              </button>
              <button
                onClick={() => { setEditing(false); setValue(artifact.slug || ""); setError(null); }}
                className="p-1 text-neutral-400 hover:text-neutral-600 rounded hover:bg-neutral-100 transition-colors cursor-pointer"
                title="Cancel"
              >
                <X size={13} />
              </button>
            </div>
            {error && <span className="text-[10px] text-red-500">{error}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-neutral-700 text-xs">{artifact.slug}</span>
            <button
              onClick={() => { setValue(artifact.slug || ""); setEditing(true); }}
              className="p-0.5 text-neutral-300 hover:text-neutral-600 rounded hover:bg-neutral-100 transition-colors cursor-pointer"
              title="Edit slug"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => {
                const slugUrl = api.appUrl(artifact.slug || artifact.id);
                void copyToClipboard(slugUrl);
              }}
              className="p-0.5 text-neutral-300 hover:text-teal-600 rounded hover:bg-teal-50 transition-colors cursor-pointer"
              title="Copy slug URL"
            >
              <LinkIcon size={11} />
            </button>
          </div>
        )}
      </dd>
    </div>
  );
}

/* ---------- Title (Name) Inline Editor ---------- */

function TitleEditor({
  artifact,
  onNameSaved,
}: {
  artifact: ArtifactInstance;
  onNameSaved: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(getArtifactTitle(artifact));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("O nome não pode estar vazio");
      return;
    }
    if (trimmed.length > 120) {
      setError("Nome demasiado longo (máx. 120 caracteres)");
      return;
    }
    if (trimmed === getArtifactTitle(artifact)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await tryCall(() => api.artifacts.patch({ id: artifact.id, name: trimmed }));
      if (result.ok) {
        onNameSaved(trimmed);
        setEditing(false);
      } else {
        setError(result.error.message || "Não foi possível guardar o nome");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o nome");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") { setEditing(false); setValue(getArtifactTitle(artifact)); setError(null); }
            }}
            className="flex-1 min-w-0 px-2 py-1 text-lg font-semibold text-neutral-900 border border-neutral-300 rounded-md focus:outline-none focus:border-teal-500"
            autoFocus
            disabled={saving}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1 text-teal-600 hover:text-teal-700 rounded hover:bg-teal-50 transition-colors cursor-pointer disabled:opacity-50 flex-shrink-0"
            title="Guardar"
          >
            {saving ? <Spinner size="sm" /> : <Check size={15} />}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(getArtifactTitle(artifact)); setError(null); }}
            className="p-1 text-neutral-400 hover:text-neutral-600 rounded hover:bg-neutral-100 transition-colors cursor-pointer flex-shrink-0"
            title="Cancelar"
          >
            <X size={15} />
          </button>
        </div>
        {error && <span className="text-[11px] text-red-500">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <h2 className="text-lg font-semibold text-neutral-900 truncate">
        {getArtifactTitle(artifact)}
      </h2>
      <button
        onClick={() => { setValue(getArtifactTitle(artifact)); setEditing(true); }}
        className="p-0.5 text-neutral-300 hover:text-neutral-600 rounded hover:bg-neutral-100 transition-colors cursor-pointer flex-shrink-0"
        title="Editar nome"
      >
        <Pencil size={13} />
      </button>
    </div>
  );
}

/* ---------- Detail View ---------- */

function ArtifactDetail({
  artifact,
  onBack,
  onRun,
  onCopyLink,
  onContinueWorking,
  onToggleShare,
  onStart,
  onStop,
  onViewLogs,
  onPreview,
  onOpenInNewTab,
  onSlugSaved,
  onNameSaved,
  onVisibilitySaved,
  onCopyBuildLink,
  onUploadUpdate,
  onDelete,
  isUpdating,
  copiedId,
  copiedBuildId,
  startingId,
  stoppingId,
}: {
  artifact: ArtifactInstance;
  onBack: () => void;
  onRun: (e: React.MouseEvent) => void;
  onCopyLink: (e: React.MouseEvent) => void;
  onCopyBuildLink: (e: React.MouseEvent) => void;
  onContinueWorking: (e: React.MouseEvent) => void;
  onToggleShare: (e: React.MouseEvent) => void;
  onStart: (e: React.MouseEvent) => void;
  onStop: (e: React.MouseEvent) => void;
  onViewLogs: (e: React.MouseEvent) => void;
  onPreview: (e: React.MouseEvent) => void;
  onOpenInNewTab: (e: React.MouseEvent) => void;
  onSlugSaved: (artifactId: string, slug: string) => void;
  onNameSaved: (artifactId: string, name: string) => void;
  onVisibilitySaved: (artifactId: string, visibility: Visibility) => void;
  onUploadUpdate: (file: File) => void;
  onDelete: (e: React.MouseEvent) => void;
  isUpdating: boolean;
  copiedId: string | null;
  copiedBuildId: string | null;
  startingId: string | null;
  stoppingId: string | null;
}) {
  const { pages_artifacts: a } = useTranslation();
  const typeId = getTemplateId(artifact);
  const appUrl = getArtifactAppUrl(artifact);
  const isRunnable =
    artifact.status === "running" ||
    artifact.status === "ready" ||
    artifact.status === "active" ||
    artifact.status === "healthy";
  const isRunning =
    artifact.status === "running" ||
    artifact.status === "active" ||
    artifact.status === "healthy";
  const isStartable =
    artifact.status === "ready" ||
    artifact.status === "stopped" ||
    artifact.status === "completed";
  const hasLink = !!appUrl;
  const port = artifact.data?.port as number | undefined;

  // Code download — Cortex zips the app's working copy and streams it. No
  // github.com URL is ever exposed; the code is the user's, no lock-in.
  const [showDownloadInfo, setShowDownloadInfo] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Hidden picker for "Atualizar a partir de ficheiro" (per-artifact upload-update).
  const updateInputRef = useRef<HTMLInputElement | null>(null);

  // FC-503: manual owner promotion/demotion of org-visibility.
  const [savingVisibility, setSavingVisibility] = useState(false);
  const visibility: Visibility = artifact.visibility ?? "private";

  async function handleVisibilityChange(next: Visibility) {
    if (next === visibility || savingVisibility) return;
    setSavingVisibility(true);
    const result = await tryCall(() =>
      api.artifacts.patch({ id: artifact.id, visibility: next }),
    );
    setSavingVisibility(false);
    if (result.ok) {
      onVisibilitySaved(artifact.id, next);
    } else {
      toast.error(result.error.message || "Não foi possível alterar a visibilidade.");
    }
  }

  async function handleDownloadCode() {
    setDownloading(true);
    setDownloadError(null);
    try {
      // The request core attaches the token via the accessor and surfaces the
      // 422 secret-guard block as a typed ApiError (FC-062/FC-066).
      const blob = await api.artifacts.download<Blob>(
        { id: artifact.id },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${artifact.slug || artifact.id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setShowDownloadInfo(false);
    } catch (err) {
      const blocked = err instanceof ApiError && err.status === 422;
      setDownloadError(
        blocked
          ? "A transferência foi bloqueada: a aplicação contém uma credencial que deve ser removida primeiro."
          : "Não foi possível transferir o código. Tente novamente.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.25 } }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }}
      className="flex flex-col h-full"
    >
      <div className="px-6 py-4 border-b border-line bg-surface">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer focus-ring rounded"
          >
            <ArrowLeft size={16} />
            {a.backToArtifacts}
          </button>
        </div>

        <div className="flex items-start gap-4">
          <TypeIcon templateId={typeId} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 mb-1">
              <TitleEditor
                artifact={artifact}
                onNameSaved={(name) => onNameSaved(artifact.id, name)}
              />
              <StatusBadge status={artifact.status} />
              {artifact.shareable && (
                <Badge tone="brand">
                  <Share2 size={10} />
                  {a.shared}
                </Badge>
              )}
            </div>
            <p className="text-xs text-neutral-400 mb-1">
              {formatTypeName(typeId)}
            </p>
            {artifact.summary && (
              <p className="text-sm text-neutral-500 mb-2 line-clamp-2">
                {artifact.summary}
              </p>
            )}

            {/* Live status: port + URL for running apps */}
            {isRunning && port && (
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 text-xs text-green-700 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                  {a.port} {port}
                </span>
                {appUrl && (
                  <a
                    href={appUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-teal-600 hover:text-teal-700 font-mono truncate max-w-[300px] hover:underline"
                  >
                    {appUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            )}

            <div className="flex items-center gap-4 text-[11px] text-neutral-400 mb-3">
              <span className="flex items-center gap-1">
                <Calendar size={11} />
                {a.createdOn} {new Date(artifact.createdAt).toLocaleDateString()}
              </span>
              {artifact.updatedAt && (
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {a.updatedOn} {new Date(artifact.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Action buttons in detail view */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Start / Stop */}
              {isRunning ? (
                <Button
                  size="sm"
                  variant="danger-ghost"
                  icon={Square}
                  onClick={onStop}
                  loading={stoppingId === artifact.id}
                >
                  {a.stopApp}
                </Button>
              ) : isStartable ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={Play}
                  onClick={onStart}
                  loading={startingId === artifact.id}
                >
                  {a.startApp}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon={Play}
                  onClick={onRun}
                  disabled={!isRunnable}
                >
                  {a.openApp}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={Eye}
                onClick={onPreview}
                disabled={!isRunnable}
              >
                {a.preview}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={ExternalLink}
                onClick={onOpenInNewTab}
                disabled={!isRunnable}
              >
                {a.openInNewTab}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={copiedId === artifact.id ? Check : LinkIcon}
                onClick={onCopyLink}
                disabled={!hasLink}
                data-testid={`copy-run-link-${artifact.id}`}
              >
                {copiedId === artifact.id ? a.copied : a.copyRunLink}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={copiedBuildId === artifact.id ? Check : FileCode2}
                onClick={onCopyBuildLink}
                disabled={!artifact.shareable}
                title={
                  artifact.shareable
                    ? "Quem abrir este link recebe uma cópia nova"
                    : "Active a partilha para criar um link de construção"
                }
                data-testid={`copy-build-link-${artifact.id}`}
              >
                {copiedBuildId === artifact.id ? a.copied : a.copyBuildLink}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={Download}
                onClick={() => {
                  setDownloadError(null);
                  setShowDownloadInfo(true);
                }}
                title="Transferir o código da aplicação"
                data-testid={`download-code-${artifact.id}`}
              >
                {a.downloadCode}
              </Button>
              {/* Upload update — re-import a revision of THIS app in place. */}
              <input
                ref={updateInputRef}
                type="file"
                accept="application/json,.json,application/zip,.zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // allow re-selecting the same file
                  if (f) onUploadUpdate(f);
                }}
                data-testid={`upload-update-input-${artifact.id}`}
              />
              <Button
                size="sm"
                variant="secondary"
                icon={Upload}
                onClick={() => !isUpdating && updateInputRef.current?.click()}
                loading={isUpdating}
                title="Atualizar a app a partir de um ficheiro .json ou .zip (mantém id, URL e dados)"
                data-testid={`upload-update-${artifact.id}`}
              >
                {isUpdating ? a.updating : a.updateFromFile}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={Pencil}
                onClick={onContinueWorking}
              >
                {a.continueWorking}
              </Button>
              <Button
                size="sm"
                variant={artifact.shareable ? "primary" : "secondary"}
                icon={Share2}
                onClick={onToggleShare}
              >
                {artifact.shareable ? a.unshare : a.share}
              </Button>
              {isRunning && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Terminal}
                  onClick={onViewLogs}
                >
                  {a.viewLogs}
                </Button>
              )}
              <Button
                size="sm"
                variant="danger-ghost"
                icon={Trash2}
                onClick={onDelete}
                title={a.deleteArtifactAriaLabel}
                data-testid={`delete-artifact-${artifact.id}`}
              >
                {a.deleteArtifact}
              </Button>
            </div>

            {/* FC-503: org-visibility sharing (distinct from the public share
                link above). Promotion/demotion are manual owner actions. */}
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-neutral-600">Visibilidade</div>
              <VisibilityControl
                value={visibility}
                onChange={handleVisibilityChange}
                disabled={savingVisibility}
                showSafetyNote
              />
            </div>
          </div>
        </div>
      </div>

      {/* Details section */}
      <div className="flex-1 overflow-y-auto p-6 bg-canvas scrollbar-light">
        <div className="max-w-2xl space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {a.details}
            </h4>
            <dl className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <dt className="text-neutral-500">{a.detailId}</dt>
                <dd className="font-mono text-neutral-700 text-xs">
                  {artifact.id}
                </dd>
              </div>
              <SlugEditor
                artifact={artifact}
                onSlugSaved={(slug) => onSlugSaved(artifact.id, slug)}
              />
              <div className="flex items-center justify-between text-sm">
                <dt className="text-neutral-500">{a.detailStatus}</dt>
                <dd>
                  <StatusBadge status={artifact.status} />
                </dd>
              </div>
              <div className="flex items-center justify-between text-sm">
                <dt className="text-neutral-500">{a.detailType}</dt>
                <dd className="text-neutral-700">
                  {formatTypeName(typeId)}
                </dd>
              </div>
              <div className="flex items-center justify-between text-sm">
                <dt className="text-neutral-500">{a.shared}</dt>
                <dd className="text-neutral-700">
                  {artifact.shareable ? a.yes : a.no}
                </dd>
              </div>
              <div className="flex items-center justify-between text-sm">
                <dt className="text-neutral-500">{a.detailCreated}</dt>
                <dd className="text-neutral-700">
                  {new Date(artifact.createdAt).toLocaleString()}
                </dd>
              </div>
              {artifact.updatedAt && (
                <div className="flex items-center justify-between text-sm">
                  <dt className="text-neutral-500">{a.detailUpdated}</dt>
                  <dd className="text-neutral-700">
                    {new Date(artifact.updatedAt).toLocaleString()}
                  </dd>
                </div>
              )}
              {port && (
                <div className="flex items-center justify-between text-sm">
                  <dt className="text-neutral-500">{a.port}</dt>
                  <dd className="font-mono text-neutral-700 text-xs">
                    {port}
                  </dd>
                </div>
              )}
              {appUrl && (
                <div className="flex items-center justify-between text-sm">
                  <dt className="text-neutral-500">URL</dt>
                  <dd>
                    <a
                      href={appUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal-600 text-xs font-mono truncate max-w-[300px] hover:underline"
                    >
                      {appUrl.replace(/^https?:\/\//, '')}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="rounded-2xl border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <History size={14} className="text-neutral-500" />
              <h4 className="text-sm font-semibold text-neutral-900">
                {a.versionHistory}
              </h4>
            </div>
            <VersionsPanel artifactId={artifact.id} hideHeader />
          </div>

          <DataBackupsPanel appId={artifact.id} appName={artifact.name || artifact.title} />

          <ArtifactBackendPanel appId={artifact.id} />

          <BackendTriggerCard
            artifactId={artifact.id}
            handlers={Array.isArray(artifact.backendHandlers) ? artifact.backendHandlers : []}
          />
        </div>
      </div>

      <Dialog
        open={showDownloadInfo}
        onClose={() => { if (!downloading) setShowDownloadInfo(false); }}
        size="md"
        title={a.downloadCode}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowDownloadInfo(false)} disabled={downloading}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Download}
              onClick={handleDownloadCode}
              loading={downloading}
              data-testid="download-confirm"
            >
              {downloading ? "A preparar…" : "Transferir .zip"}
            </Button>
          </>
        }
      >
        <div data-testid="download-info-dialog">
          <p className="text-sm text-neutral-600 leading-relaxed">
            Pode transferir o código da sua aplicação a qualquer momento. O código é seu —
            não há qualquer dependência da Ekoa. O mesmo ficheiro .zip pode ser
            reimportado mais tarde através de &ldquo;Importar artefacto&rdquo;.
          </p>
          {downloadError && (
            <p className="mt-3 text-sm text-red-600" data-testid="download-error">
              {downloadError}
            </p>
          )}
        </div>
      </Dialog>
    </motion.div>
  );
}

/* ---------- Empty State ---------- */

function EmptyState() {
  const { pages_artifacts: a } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyStateUi
        icon={FolderKanban}
        title={a.noArtifactsTitle}
        description={a.noArtifactsDesc}
        action={
          <Link href="/chat" className={`${buttonClasses("primary", "md")} inline-flex`}>
            <Hammer size={15} />
            {a.goToBuilder}
          </Link>
        }
      />
    </div>
  );
}

/* ---------- Loading Skeleton ---------- */

function CardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-4 animate-pulse">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-5 h-5 rounded bg-neutral-200" />
          <div className="h-4 bg-neutral-200 rounded w-2/3" />
        </div>
        <div className="w-16 h-5 rounded-full bg-neutral-100" />
      </div>
      <div className="h-3 bg-neutral-100 rounded w-1/3 mb-2" />
      <div className="h-3 bg-neutral-100 rounded w-full mb-1" />
      <div className="h-3 bg-neutral-100 rounded w-2/3 mb-3" />
      <div className="flex-1" />
      <div className="pt-3 mt-2 border-t border-neutral-100">
        <div className="h-3 bg-neutral-100 rounded w-1/4 mb-2" />
        <div className="flex gap-1">
          <div className="w-8 h-8 rounded bg-neutral-100" />
          <div className="w-8 h-8 rounded bg-neutral-100" />
          <div className="w-8 h-8 rounded bg-neutral-100" />
          <div className="w-8 h-8 rounded bg-neutral-100" />
        </div>
      </div>
    </div>
  );
}

/* ---------- Main Component ---------- */

export default function ArtifactsPage() {
  const { pages_artifacts: a, common } = useTranslation();
  const router = useRouter();
  const authToken = useAuthStore((s) => s.token);

  const [instances, setInstances] = useState<ArtifactInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [search, setSearch] = useState("");
  const [selectedArtifact, setSelectedArtifact] =
    useState<ArtifactInstance | null>(null);
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Delete state
  const [deletingArtifact, setDeletingArtifact] =
    useState<ArtifactInstance | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Copy link toast state
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Copy build-link toast state (build link forks on every click).
  const [copiedBuildId, setCopiedBuildId] = useState<string | null>(null);
  // Import bundle file input ref.
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    bundle: unknown;
    match: ArtifactInstance;
  } | null>(null);

  // Per-artifact "Upload update" (Atualizar a partir de ficheiro): re-imports a
  // bundle IN PLACE onto a specific artifact, keeping id/URL/data. Unlike the
  // gallery import's auto-match, this is unambiguous — it targets exactly the
  // artifact the user opened. If the bundle isn't a revision of it
  // (ManifestIdMismatch), we ask for confirmation and retry with force.
  const [isUpdating, setIsUpdating] = useState(false);
  const [forceUpdate, setForceUpdate] = useState<{
    artifact: ArtifactInstance;
    bundle: unknown;
  } | null>(null);

  // Start/Stop loading state
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  // Log viewer state
  const [logViewerId, setLogViewerId] = useState<string | null>(null);

  // Save as Template state

  // Preview state
  const [previewArtifact, setPreviewArtifact] = useState<ArtifactInstance | null>(null);

  // Featured update-by-consent (U1): the featured app whose update badge was
  // clicked, and the in-flight state of the source-sync/keep-mine choice.
  const [updateDialogFeatured, setUpdateDialogFeatured] = useState<ArtifactInstance | null>(null);
  const [isUpdatingFeatured, setIsUpdatingFeatured] = useState(false);

  const filterLabels: Record<FilterKey, string> = {
    all: a.filterAll,
    running: a.filterRunning,
    ready: a.filterReady,
    building: a.filterBuilding,
    draft: a.filterDraft,
    failed: a.filterFailed,
    shared: a.filterShared,
  };

  const sortLabels: Record<SortKey, string> = {
    recent: a.sortRecent,
    name: a.sortName,
    status: a.sortStatus,
  };

  const [featuredArtifacts, setFeaturedArtifacts] = useState<ArtifactInstance[]>([]);

  // Vertical skin: keep the backend's featuredRank order, but stably float the
  // active vertical's own starting points (e.g. `legal-*`) ahead of the generic
  // ones. Generic vertical has no predicate, so order is unchanged.
  const vertical = useVerticalProfile();
  const orderedFeatured = useMemo(
    () => partitionStartingPoints(featuredArtifacts, vertical.startingPointsFirst),
    [featuredArtifacts, vertical.startingPointsFirst],
  );

  // Starting Points strip collapse state. Default expanded on first use;
  // the choice persists across visits via localStorage.
  const [featuredCollapsed, setFeaturedCollapsed] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("ekoa_starting_points_collapsed");
    if (stored !== null) setFeaturedCollapsed(stored === "true");
  }, []);
  const toggleFeatured = useCallback(() => {
    setFeaturedCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("ekoa_starting_points_collapsed", String(next));
      return next;
    });
  }, []);

  const fetchInstances = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await tryCall(() => api.artifacts.list());
      if (response.ok) {
        const raw = response.data.items as unknown as ArtifactInstance[];
        const featuredRaw = response.data.featured as unknown as ArtifactInstance[];
        // Normalize: backend uses `name` and `typeId`, frontend expects `title` and `templateId`
        const normalize = (item: ArtifactInstance) => ({
          ...item,
          title: item.title || item.name || "Untitled",
          templateId: item.templateId || item.typeId,
        });
        setInstances(raw.map(normalize));
        setFeaturedArtifacts(featuredRaw.map(normalize));
      } else {
        setError(response.error.message || a.failedToLoad);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : a.failedToLoad,
      );
    } finally {
      setIsLoading(false);
    }
  }, [a.failedToLoad]);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  // Detail-scoped action failures (delete, upload-update, update-from-bundle)
  // toast directly at their failure sites; the shared `error` state stays
  // reserved for list-scoped flows (fetch, import) whose banner needs it.

  // Filter and sort
  const filtered = useMemo(() => {
    return instances
      .filter((item) => {
        if (filter === "shared") {
          if (!item.shareable) return false;
        } else if (filter !== "all") {
          // Map backend statuses to filter groups
          const statusMap: Record<string, FilterKey> = {
            running: "running",
            active: "running",
            healthy: "running",
            ready: "ready",
            building: "building",
            installing: "building",
            queued: "building",
            starting: "building",
            draft: "draft",
            failed: "failed",
            stopped: "draft",
            archived: "draft",
            completed: "ready",
          };
          const mapped = statusMap[item.status] || "draft";
          if (mapped !== filter) return false;
        }
        if (
          search &&
          !(getArtifactTitle(item)).toLowerCase().includes(search.toLowerCase())
        )
          return false;
        return true;
      })
      .sort((x, y) => {
        if (sort === "name")
          return getArtifactTitle(x).localeCompare(getArtifactTitle(y));
        if (sort === "status") return x.status.localeCompare(y.status);
        return (
          new Date(y.updatedAt || y.createdAt).getTime() -
          new Date(x.updatedAt || x.createdAt).getTime()
        );
      });
  }, [instances, filter, sort, search]);

  // ---- Action handlers ----

  function handleRun(artifact: ArtifactInstance) {
    const appUrl = getArtifactAppUrl(artifact);
    if (appUrl) {
      window.open(appUrl, "_blank", "noopener,noreferrer");
    }
  }

  // "Personalizar no chat" (and a featured card click): edit the featured app
  // DIRECTLY via its chat — no fork. The build path materialises a working copy
  // on the first real change (see execute-handler); until then the served app is
  // the shared one, and the chat shows its preview so users see they can change it.
  function handleCustomizeFeatured(featured: ArtifactInstance) {
    router.push(`/chat?continue=${encodeURIComponent(featured.id)}`);
  }

  // Consent to sync a customized featured app with the latest ekoa-data source.
  async function handleUpdateFeatured() {
    if (!updateDialogFeatured || isUpdatingFeatured) return;
    setIsUpdatingFeatured(true);
    try {
      const result = await tryCall(() => api.artifacts.featuredUpdateApply({ id: updateDialogFeatured.id }));
      if (result.ok) {
        toast.success(a.startingPoints.updateApplied, { testId: "featured-update-toast", duration: 8000 });
        setUpdateDialogFeatured(null);
        await fetchInstances();
      } else {
        toast.error(result.error.message || a.startingPoints.updateFailed);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : a.startingPoints.updateFailed);
    } finally {
      setIsUpdatingFeatured(false);
    }
  }

  // "Manter a minha versão": stamp the offered version as ignored, drop the badge.
  async function handleIgnoreFeaturedUpdate() {
    if (!updateDialogFeatured || isUpdatingFeatured) return;
    setIsUpdatingFeatured(true);
    try {
      const result = await tryCall(() => api.artifacts.featuredUpdateIgnore({ id: updateDialogFeatured.id }));
      if (result.ok) {
        toast.info(a.startingPoints.keptVersion, { testId: "featured-update-toast", duration: 5000 });
        setUpdateDialogFeatured(null);
        await fetchInstances();
      } else {
        toast.error(result.error.message || a.startingPoints.updateFailed);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : a.startingPoints.updateFailed);
    } finally {
      setIsUpdatingFeatured(false);
    }
  }

  function handleCopyLink(artifact: ArtifactInstance) {
    const appUrl = getArtifactAppUrl(artifact);
    if (appUrl) {
      void copyToClipboard(appUrl).then(() => {
        setCopiedId(artifact.id);
        setTimeout(() => setCopiedId(null), 2000);
      });
    }
  }

  function handleCopyBuildLink(artifact: ArtifactInstance) {
    const slug = artifact.slug || artifact.id;
    const url = api.resolveUrl(`/build/${encodeURIComponent(slug)}`);
    void copyToClipboard(url).then(() => {
      setCopiedBuildId(artifact.id);
      setTimeout(() => setCopiedBuildId(null), 3000);
      // Soft warning toast.
      toast.info(
        "Quem abrir este link recebe uma cópia nova. Nenhuns dados ou credenciais transitam.",
        { testId: "build-link-toast", duration: 4500 },
      );
    });
  }

  async function handleImportBundle(file: File) {
    try {
      // Accepts the JSON bundle OR the downloaded app .zip — readBundleFile
      // reconstructs the same envelope from the zip, so the match-vs-create
      // decision below (and update-in-place) works identically for both.
      const bundle = (await readBundleFile(file)) as { manifest?: { id?: string } };
      // A bundle whose manifest id matches an app the user already imported (or
      // exported) is most likely a new REVISION of that app — offer to update it
      // in place (keeps id, URL and data) instead of always creating a copy.
      const manifestId = bundle?.manifest?.id;
      const match = manifestId
        ? instances
            .filter(
              (i) =>
                i.id === manifestId ||
                (i.data as Record<string, unknown> | undefined)?.importedFrom === manifestId,
            )
            .sort(
              (x, y) =>
                new Date(y.updatedAt || y.createdAt).getTime() -
                new Date(x.updatedAt || x.createdAt).getTime(),
            )[0]
        : undefined;
      if (match) {
        setPendingImport({ bundle, match });
        return;
      }
      await createInstanceFromBundle(bundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao importar.");
    }
  }

  async function createInstanceFromBundle(bundle: unknown) {
    if (isImporting) return;
    setIsImporting(true);
    try {
      const result = await tryCall(() => api.artifacts.import({ bundle: bundle as ArtifactBundle }));
      if (result.ok) {
        toast.success(
          `Artefacto importado: "${(result.data as { name?: string })?.name || "sem nome"}".`,
          { testId: "build-link-toast", duration: 4000 },
        );
        await fetchInstances();
      } else {
        setError(result.error.message || "Falha ao importar.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao importar.");
    } finally {
      setIsImporting(false);
      setPendingImport(null);
    }
  }

  async function handleUpdateFromBundle() {
    if (!pendingImport || isImporting) return;
    setIsImporting(true);
    try {
      const result = await tryCall(() => api.artifacts.bundleUpdate({
        id: pendingImport.match.id,
        bundle: pendingImport.bundle as ArtifactBundle,
      }));
      if (result.ok) {
        const name = result.data.artifact.name || getArtifactTitle(pendingImport.match);
        toast.success(
          `Aplicação "${name}" atualizada. Pode repor a versão anterior em Versões e os dados em Dados e cópias de segurança.`,
          { testId: "build-link-toast", duration: 8000 },
        );
        await fetchInstances();
      } else {
        toast.error(result.error.message || "Falha ao atualizar a partir do bundle.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar a partir do bundle.");
    } finally {
      setIsImporting(false);
      setPendingImport(null);
    }
  }

  // Shared success path for both the gallery match-update and the per-artifact
  // upload-update: toast pointing at the rollback surfaces, refresh, and keep
  // the open detail view's name in sync.
  function afterBundleUpdate(artifact: ArtifactInstance, data: BundleUpdateResponse) {
    const name = data.artifact.name || getArtifactTitle(artifact);
    toast.success(
      `Aplicação "${name}" atualizada. Pode repor a versão anterior em Versões e os dados em Dados e cópias de segurança.`,
      { testId: "build-link-toast", duration: 8000 },
    );
    void fetchInstances();
    setSelectedArtifact((prev) =>
      prev && prev.id === artifact.id ? { ...prev, name } : prev,
    );
  }

  // Per-artifact upload-update. Targets the opened artifact's id directly, so it
  // never guesses which app a bundle belongs to. Tries a normal (non-force)
  // update first; on a manifest-id mismatch it parks the bundle for an explicit
  // force confirmation rather than silently overwriting an unrelated app.
  async function handleUploadUpdate(artifact: ArtifactInstance, file: File) {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const bundle = await readBundleFile(file); // JSON bundle or downloaded .zip
      const result = await tryCall(() => api.artifacts.bundleUpdate({
        id: artifact.id,
        bundle: bundle as ArtifactBundle,
        force: false,
      }));
      if (result.ok) {
        afterBundleUpdate(artifact, result.data);
      } else {
        const msg = result.error.message || "";
        if (/ManifestIdMismatch/i.test(msg)) {
          setForceUpdate({ artifact, bundle });
        } else {
          toast.error(msg || "Falha ao atualizar a partir do ficheiro.");
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao atualizar a partir do ficheiro.",
      );
    } finally {
      setIsUpdating(false);
    }
  }

  // Confirmed force-update for a bundle that isn't a revision of the artifact.
  // The backend still snapshots data + commits a pre-update version, so this is
  // recoverable from Versões / Dados e cópias de segurança.
  async function handleForceUpdate() {
    if (!forceUpdate || isUpdating) return;
    const { artifact, bundle } = forceUpdate;
    setIsUpdating(true);
    try {
      const result = await tryCall(() => api.artifacts.bundleUpdate({
        id: artifact.id,
        bundle: bundle as ArtifactBundle,
        force: true,
      }));
      if (result.ok) {
        afterBundleUpdate(artifact, result.data);
        setForceUpdate(null);
      } else {
        toast.error(result.error.message || "Falha ao atualizar a partir do ficheiro.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao atualizar a partir do ficheiro.",
      );
    } finally {
      setIsUpdating(false);
    }
  }

  function handleContinueWorking(artifact: ArtifactInstance) {
    // Route through the chat page's ?continue= handler: it hydrates state
    // from the artifact AND recreates+relinks the backend session when the
    // artifact's recorded sessionId no longer exists (cascade-deleted by an
    // earlier cleanup). The previous in-place implementation would push to
    // /chat/<deletedId>, which the URL effect then bounces back to /chat.
    router.push(`/chat?continue=${artifact.id}`);
  }

  async function handleDelete() {
    if (!deletingArtifact) return;
    setIsDeleting(true);
    try {
      const result = await tryCall(() => api.artifacts.remove({ id: deletingArtifact.id }));
      if (result.ok) {
        setInstances((prev) =>
          prev.filter((i) => i.id !== deletingArtifact.id),
        );
        setDeletingArtifact(null);
        if (selectedArtifact?.id === deletingArtifact.id) {
          setSelectedArtifact(null);
        }
      } else {
        toast.error(result.error.message || a.failedToDelete);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : a.failedToDelete,
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleToggleShare(artifact: ArtifactInstance) {
    const newShareable = !artifact.shareable;
    // Optimistic update
    setInstances(prev => prev.map(i =>
      i.id === artifact.id ? { ...i, shareable: newShareable } : i
    ));
    if (selectedArtifact?.id === artifact.id) {
      setSelectedArtifact(prev => prev ? { ...prev, shareable: newShareable } : prev);
    }
    try {
      await api.artifacts.patch({ id: artifact.id, shareable: newShareable });
    } catch {
      // Revert on failure
      setInstances(prev => prev.map(i =>
        i.id === artifact.id ? { ...i, shareable: !newShareable } : i
      ));
      if (selectedArtifact?.id === artifact.id) {
        setSelectedArtifact(prev => prev ? { ...prev, shareable: !newShareable } : prev);
      }
    }
  }

  async function handleStart(artifact: ArtifactInstance) {
    setStartingId(artifact.id);
    try {
      const res = await tryCall(() => api.companySpace.start({ artifactId: artifact.id }));
      if (res.ok) {
        setInstances(prev => prev.map(i =>
          i.id === artifact.id ? { ...i, status: 'running' } : i
        ));
        if (selectedArtifact?.id === artifact.id) {
          setSelectedArtifact(prev => prev ? { ...prev, status: 'running' } : prev);
        }
      }
    } catch {
      // silently fail
    } finally {
      setStartingId(null);
    }
  }

  async function handleStop(artifact: ArtifactInstance) {
    setStoppingId(artifact.id);
    try {
      const res = await tryCall(() => api.companySpace.stop({ artifactId: artifact.id }));
      if (res.ok) {
        setInstances(prev => prev.map(i =>
          i.id === artifact.id ? { ...i, status: 'stopped' } : i
        ));
        if (selectedArtifact?.id === artifact.id) {
          setSelectedArtifact(prev => prev ? { ...prev, status: 'stopped' } : prev);
        }
      }
    } catch {
      // silently fail
    } finally {
      setStoppingId(null);
    }
  }


  // Only show the full-page empty state when there is truly nothing to
  // render. A new user with zero own artifacts must still see the Starting
  // Points strip, which lives in the list view.
  const showEmpty =
    !isLoading &&
    instances.length === 0 &&
    featuredArtifacts.length === 0 &&
    !error;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <AnimatePresence mode="wait">
        {selectedArtifact ? (
          <ArtifactDetail
            key="detail"
            artifact={selectedArtifact}
            onBack={() => setSelectedArtifact(null)}
            onRun={(e) => {
              e.stopPropagation();
              handleRun(selectedArtifact);
            }}
            onCopyLink={(e) => {
              e.stopPropagation();
              handleCopyLink(selectedArtifact);
            }}
            onCopyBuildLink={(e) => {
              e.stopPropagation();
              handleCopyBuildLink(selectedArtifact);
            }}
            onContinueWorking={(e) => {
              e.stopPropagation();
              handleContinueWorking(selectedArtifact);
            }}
            onToggleShare={(e) => {
              e.stopPropagation();
              handleToggleShare(selectedArtifact);
            }}
            onStart={(e) => {
              e.stopPropagation();
              handleStart(selectedArtifact);
            }}
            onStop={(e) => {
              e.stopPropagation();
              handleStop(selectedArtifact);
            }}
            onViewLogs={(e) => {
              e.stopPropagation();
              setLogViewerId(selectedArtifact.id);
            }}
            onPreview={(e) => {
              e.stopPropagation();
              setPreviewArtifact(selectedArtifact);
            }}
            onOpenInNewTab={(e) => {
              e.stopPropagation();
              handleRun(selectedArtifact);
            }}
            onSlugSaved={(artifactId, slug) => {
              setInstances(prev => prev.map(i =>
                i.id === artifactId ? { ...i, slug } : i
              ));
              setSelectedArtifact(prev => prev && prev.id === artifactId ? { ...prev, slug } : prev);
            }}
            onNameSaved={(artifactId, name) => {
              setInstances(prev => prev.map(i =>
                i.id === artifactId ? { ...i, name, title: name } : i
              ));
              setSelectedArtifact(prev => prev && prev.id === artifactId ? { ...prev, name, title: name } : prev);
            }}
            onVisibilitySaved={(artifactId, visibility) => {
              setInstances(prev => prev.map(i =>
                i.id === artifactId ? { ...i, visibility } : i
              ));
              setSelectedArtifact(prev => prev && prev.id === artifactId ? { ...prev, visibility } : prev);
            }}
            onUploadUpdate={(file) => void handleUploadUpdate(selectedArtifact, file)}
            onDelete={(e) => {
              e.stopPropagation();
              setDeletingArtifact(selectedArtifact);
            }}
            isUpdating={isUpdating}
            copiedId={copiedId}
            copiedBuildId={copiedBuildId}
            startingId={startingId}
            stoppingId={stoppingId}
          />
        ) : showEmpty ? (
          <EmptyState key="empty" />
        ) : (
          <PageShell key="list" width="wide" testId="artifacts-page">
            <PageHeader
              title={a.title}
              description={a.subtitle(instances.length)}
              icon={FolderKanban}
              actions={
                <>
                  {/* Import bundle action */}
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json,application/zip,.zip"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleImportBundle(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={FileCode2}
                    onClick={() => importInputRef.current?.click()}
                    // isLoading too: the update-vs-create match runs against the
                    // loaded gallery; importing before the list resolves would
                    // silently miss the match and always create a copy.
                    loading={isImporting}
                    disabled={isImporting || isLoading}
                    data-testid="import-artifact-button"
                  >
                    {isImporting ? a.importing : a.importArtifact}
                  </Button>
                  <IconButton
                    icon={RefreshCw}
                    label={a.refreshArtifacts}
                    title={common.refresh}
                    onClick={fetchInstances}
                    disabled={isLoading}
                    className={isLoading ? "[&_svg]:animate-spin" : ""}
                  />
                </>
              }
            >
              {/* Error */}
              {error && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertTriangle size={14} />
                    <span className="text-xs">{error}</span>
                  </div>
                  <button
                    onClick={() => {
                      setError(null);
                      fetchInstances();
                    }}
                    className="text-xs font-medium text-red-600 hover:text-red-800 cursor-pointer focus-ring rounded"
                  >
                    {common.retry}
                  </button>
                </div>
              )}

              {/* Filters + sort + search row */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Filter pills */}
                  <div className="flex items-center gap-1">
                    <Filter size={14} className="mr-1 text-neutral-400" />
                    {filterKeys.map((key) => (
                      <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer focus-ring ${
                          filter === key
                            ? "bg-neutral-900 text-white"
                            : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                        }`}
                      >
                        {filterLabels[key]}
                      </button>
                    ))}
                  </div>

                  {/* Sort */}
                  <div className="relative">
                    <button
                      onClick={() => setShowSortMenu(!showSortMenu)}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:border-line-strong cursor-pointer focus-ring"
                    >
                      <SortAsc size={13} />
                      {sortLabels[sort]}
                      <ChevronDown size={12} />
                    </button>
                    {showSortMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowSortMenu(false)}
                        />
                        <div className="absolute left-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-line bg-surface py-1 shadow-raised">
                          {sortKeys.map((key) => (
                            <button
                              key={key}
                              onClick={() => {
                                setSort(key);
                                setShowSortMenu(false);
                              }}
                              className={`w-full px-3 py-1.5 text-left text-xs cursor-pointer ${
                                sort === key
                                  ? "bg-neutral-100 font-medium text-neutral-900"
                                  : "text-neutral-600 hover:bg-neutral-50"
                              }`}
                            >
                              {sortLabels[key]}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Search */}
                <SearchInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder={a.searchPlaceholder}
                  className="w-56"
                />
              </div>
            </PageHeader>

            {/* Starting Points strip */}
            {featuredArtifacts.length > 0 && (
                <section data-testid="starting-points-strip">
                  <button
                    onClick={toggleFeatured}
                    aria-expanded={!featuredCollapsed}
                    className="group mb-3 flex w-full items-center justify-between gap-3 text-left cursor-pointer"
                    data-testid="starting-points-toggle"
                  >
                    <div>
                      <h2 className="text-sm font-semibold text-neutral-900">
                        {a.appsSection.title}
                      </h2>
                      <p className="mt-1 text-xs text-neutral-500">
                        {a.appsSection.subtitle}
                      </p>
                    </div>
                    {/* Visually a button, but the whole header is the real
                        <button>; nested buttons are invalid HTML. */}
                    <span
                      className="flex flex-shrink-0 select-none items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors group-hover:bg-neutral-50"
                      data-testid="starting-points-toggle-pill"
                    >
                      {featuredCollapsed
                        ? a.startingPoints.show(featuredArtifacts.length)
                        : a.startingPoints.hide}
                      <motion.span
                        animate={{ rotate: featuredCollapsed ? 0 : 180 }}
                        transition={{ duration: 0.2 }}
                        className="flex"
                      >
                        <ChevronDown size={16} />
                      </motion.span>
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {!featuredCollapsed && (
                      <motion.div
                        key="starting-points-grid"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="overflow-hidden"
                      >
                        <div className="grid grid-cols-1 gap-4 pb-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {orderedFeatured.map((f) => {
                            const fData = f.data as Record<string, unknown> | undefined;
                            const updateAvailable = (fData?.updateAvailable as { version?: string } | null | undefined) ?? null;
                            return (
                            <div
                              key={f.id}
                              onClick={() => handleCustomizeFeatured(f)}
                              className="group flex cursor-pointer flex-col rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong"
                              data-testid={`starting-point-card-${f.id}`}
                            >
                              {f.screenshotUrl ? (
                                <img
                                  src={api.resolveUrl(f.screenshotUrl)}
                                  alt={f.title || f.name}
                                  loading="lazy"
                                  className="mb-3 h-32 w-full rounded-lg border border-line object-cover"
                                />
                              ) : (
                                <div className="mb-3 h-32 w-full rounded-lg border border-line bg-neutral-50" />
                              )}
                              <div className="mb-1 flex items-start justify-between gap-2">
                                <h3 className="truncate font-semibold text-neutral-900">
                                  {f.title || f.name}
                                </h3>
                                {updateAvailable?.version && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setUpdateDialogFeatured(f); }}
                                    className="flex-shrink-0 rounded-md focus-ring cursor-pointer"
                                    data-testid={`featured-update-badge-${f.id}`}
                                    title={a.startingPoints.updateAvailable}
                                  >
                                    <Badge tone="warning" dot>
                                      {a.startingPoints.updateAvailable}
                                    </Badge>
                                  </button>
                                )}
                              </div>
                              <p className="mb-3 line-clamp-2 flex-1 text-xs text-neutral-500">
                                {(fData?.description as string) || ""}
                              </p>
                              <div className="flex gap-2">
                                {Array.isArray(f.backendHandlers) && f.backendHandlers.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSelectedArtifact(f); }}
                                    className={`${buttonClasses("secondary", "sm")} justify-center px-2`}
                                    data-testid={`starting-point-connections-${f.id}`}
                                    title="Ligações"
                                    aria-label="Ligações"
                                  >
                                    <LinkIcon size={15} />
                                  </button>
                                )}
                                <a
                                  href={api.appUrl(f.slug || f.id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className={`${buttonClasses("primary", "sm")} flex-1 justify-center`}
                                  data-testid={`starting-point-use-${f.id}`}
                                  aria-label={a.startingPoints.openAppAria}
                                >
                                  {a.use}
                                </a>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleCustomizeFeatured(f); }}
                                  className={`${buttonClasses("secondary", "sm")} flex-1 justify-center`}
                                  data-testid={`starting-point-customize-${f.id}`}
                                >
                                  {a.startingPoints.customizeInChat}
                                </button>
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              )}

              {/* Card grid + states */}
              {isLoading && instances.length === 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
                </div>
              ) : instances.length === 0 ? (
                /* New user: featured strip above, own-artifacts CTA here. */
                <EmptyStateUi
                  icon={FolderKanban}
                  title={a.noArtifactsTitle}
                  description={a.noArtifactsDesc}
                  action={
                    <Link href="/chat" className={`${buttonClasses("primary", "md")} inline-flex`}>
                      <Hammer size={15} />
                      {a.goToBuilder}
                    </Link>
                  }
                />
              ) : filtered.length === 0 ? (
                <EmptyStateUi
                  icon={Search}
                  title={a.noMatchingFilters}
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFilter("all");
                        setSearch("");
                      }}
                    >
                      {a.clearFilters}
                    </Button>
                  }
                />
              ) : (
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                >
                  {filtered.map((artifact) => (
                    <ArtifactCard
                      key={artifact.id}
                      artifact={artifact}
                      onClick={() => setSelectedArtifact(artifact)}
                      onDelete={(e) => {
                        e.stopPropagation();
                        setDeletingArtifact(artifact);
                      }}
                      onRun={(e) => {
                        e.stopPropagation();
                        handleRun(artifact);
                      }}
                      onCopyLink={(e) => {
                        e.stopPropagation();
                        handleCopyLink(artifact);
                      }}
                      onContinueWorking={(e) => {
                        e.stopPropagation();
                        handleContinueWorking(artifact);
                      }}
                      onToggleShare={(e) => {
                        e.stopPropagation();
                        handleToggleShare(artifact);
                      }}
                      onStart={(e) => {
                        e.stopPropagation();
                        handleStart(artifact);
                      }}
                      onStop={(e) => {
                        e.stopPropagation();
                        handleStop(artifact);
                      }}
                      onViewLogs={(e) => {
                        e.stopPropagation();
                        setLogViewerId(artifact.id);
                      }}
                      onPreview={(e) => {
                        e.stopPropagation();
                        setPreviewArtifact(artifact);
                      }}
                      onOpenInNewTab={(e) => {
                        e.stopPropagation();
                        handleRun(artifact);
                      }}
                      copiedId={copiedId}
                      startingId={startingId}
                      stoppingId={stoppingId}
                    />
                  ))}
                </motion.div>
              )}
          </PageShell>
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      {deletingArtifact && (
        <DeleteDialog
          artifactName={getArtifactTitle(deletingArtifact)}
          isDeleting={isDeleting}
          onClose={() => setDeletingArtifact(null)}
          onConfirm={handleDelete}
        />
      )}

      {/* Per-artifact upload-update of a bundle that isn't a revision: confirm force */}
      {forceUpdate && (
        <ForceUpdateDialog
          artifactName={getArtifactTitle(forceUpdate.artifact)}
          isBusy={isUpdating}
          onConfirm={() => void handleForceUpdate()}
          onClose={() => {
            if (!isUpdating) setForceUpdate(null);
          }}
        />
      )}

      {/* Imported bundle matches an existing app: update in place or create a copy */}
      {pendingImport && (
        <UpdateOrCreateDialog
          artifactName={getArtifactTitle(pendingImport.match)}
          isBusy={isImporting}
          onUpdate={() => void handleUpdateFromBundle()}
          onCreateNew={() => void createInstanceFromBundle(pendingImport.bundle)}
          onClose={() => {
            if (!isImporting) setPendingImport(null);
          }}
        />
      )}

      {/* Featured update-by-consent: sync from source or keep the user's version */}
      {updateDialogFeatured && (
        <FeaturedUpdateDialog
          artifactName={getArtifactTitle(updateDialogFeatured)}
          version={
            ((updateDialogFeatured.data as Record<string, unknown> | undefined)
              ?.updateAvailable as { version?: string } | null | undefined)?.version || ""
          }
          isBusy={isUpdatingFeatured}
          onUpdate={() => void handleUpdateFeatured()}
          onKeepMine={() => void handleIgnoreFeaturedUpdate()}
          onClose={() => { if (!isUpdatingFeatured) setUpdateDialogFeatured(null); }}
        />
      )}

      {/* Log Viewer */}
      <AnimatePresence>
        {logViewerId && (
          <LogViewer
            artifactId={logViewerId}
            onClose={() => setLogViewerId(null)}
          />
        )}
      </AnimatePresence>

      {/* Artifact Preview Overlay */}
      {previewArtifact && (() => {
        const previewBaseUrl = getArtifactAppUrl(previewArtifact);
        if (!previewBaseUrl) return null;
        // Shareable artifacts are served publicly — skip the ?token= append so
        // we don't leak the JWT into browser history / referrers. Non-shareable
        // artifacts still need the token for the owner-of-revoked edge case +
        // cross-origin dev (the session-token cookie can't cross the cortex port).
        const iframeUrl = previewArtifact.shareable === true || !authToken
          ? previewBaseUrl
          : api.withPreviewToken(previewBaseUrl);
        return (
          <ArtifactPreviewOverlay
            artifactId={previewArtifact.id}
            title={getArtifactTitle(previewArtifact)}
            summary={previewArtifact.summary}
            templateId={getTemplateId(previewArtifact)}
            previewUrl={iframeUrl}
            openUrl={previewBaseUrl}
            onClose={() => setPreviewArtifact(null)}
          />
        );
      })()}
    </div>
  );
}
