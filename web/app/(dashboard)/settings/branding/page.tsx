"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Upload,
  Palette,
  Type,
  BookOpen,
  Globe,
  X,
  RotateCcw,
  Save,
  Eye,
  ImageIcon,
  Check,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { useCompanyStore } from "@/stores/company";
import { useTranslation } from "@/stores/i18n";
import { api, tryCall, openJobStream } from "@/lib/api";
import { useApi } from "@/components/providers/api-provider";
import { useI18nStore } from "@/stores/i18n";
import { toast } from "@/stores/toast";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs } from "@/components/ui/tabs";
import { LoadingState } from "@/components/ui/spinner";
import {
  DesignSystemTab,
  type StoredDesignSystem,
  type VisualVibe,
} from "@/components/branding/design-system-tab";

/* ---------- Types ---------- */

type TabName = "Research" | "Branding" | "DesignSystem";

/**
 * Resolve a logo URL. Relative paths like /brand-assets/... are
 * served by the cortex backend, so prepend the API base URL.
 * External HTTP URLs are NOT supported (CORS issues) -- return null
 * so the UI shows a placeholder instead of a broken image.
 */
function resolveLogoUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("/brand-assets/")) return api.resolveUrl(url);
  // External URLs cause broken images due to CORS -- treat as missing
  if (url.startsWith("http")) return null;
  return url;
}

/* ---------- Research progress phases ---------- */

interface ResearchPhase {
  label: string;
  icon: React.ReactNode;
  messages: string[];
}

function useResearchPhases(): ResearchPhase[] {
  const lang = useI18nStore((s) => s.language);
  const pt = lang === "pt";
  return [
    {
      label: pt ? "A aceder ao website" : "Accessing website",
      icon: <Globe size={14} />,
      messages: pt
        ? ["A navegar para o website...", "A carregar a pagina inicial..."]
        : ["Navigating to the website...", "Loading the homepage..."],
    },
    {
      label: pt ? "A extrair identidade visual" : "Extracting visual identity",
      icon: <Palette size={14} />,
      messages: pt
        ? ["A identificar as cores da marca...", "A procurar o logotipo...", "A analisar a tipografia..."]
        : ["Identifying brand colors...", "Looking for the logo...", "Analyzing typography..."],
    },
    {
      label: pt ? "A recolher informacao" : "Gathering information",
      icon: <BookOpen size={14} />,
      messages: pt
        ? ["A ler informacao da empresa...", "A verificar a pagina Sobre...", "A explorar paginas adicionais..."]
        : ["Reading company information...", "Checking the About page...", "Exploring additional pages..."],
    },
    {
      label: pt ? "A compilar perfil" : "Compiling profile",
      icon: <Sparkles size={14} />,
      messages: pt
        ? ["A compilar o perfil da marca...", "A organizar os resultados..."]
        : ["Compiling brand profile...", "Organizing results..."],
    },
  ];
}

function useResearchProgress(isActive: boolean) {
  const phases = useResearchPhases();
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setPhaseIndex(0);
      setMessageIndex(0);
      setElapsed(0);
      return;
    }
    // Advance phase every ~15s, message every ~4s
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
      setMessageIndex((prev) => prev + 1);
    }, 4000);

    const phaseInterval = setInterval(() => {
      setPhaseIndex((prev) => Math.min(prev + 1, phases.length - 1));
      setMessageIndex(0);
    }, 15000);

    return () => {
      clearInterval(interval);
      clearInterval(phaseInterval);
    };
  }, [isActive, phases.length]);

  const phase = phases[phaseIndex];
  const message = phase.messages[messageIndex % phase.messages.length];
  const progress = Math.min(((phaseIndex * 25) + (elapsed * 2)), 95);

  return { phases, phaseIndex, message, progress };
}

/* ---------- Research progress UI ---------- */

function ResearchProgress({
  message,
  phases,
  phaseIndex,
  progress,
}: {
  message: string;
  phases: ResearchPhase[];
  phaseIndex: number;
  progress: number;
}) {
  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="h-1 w-full bg-neutral-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-teal-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Phase indicators */}
      <div className="grid grid-cols-4 gap-3">
        {phases.map((phase, i) => {
          const isActive = i === phaseIndex;
          const isDone = i < phaseIndex;
          return (
            <div
              key={i}
              className={`flex flex-col items-center text-center px-2 py-3 rounded-lg transition-colors duration-200 ${
                isActive
                  ? "bg-teal-50 border border-teal-200"
                  : isDone
                  ? "bg-neutral-50 border border-neutral-100"
                  : "border border-transparent"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 transition-colors duration-200 ${
                  isActive
                    ? "bg-teal-100 text-teal-700"
                    : isDone
                    ? "bg-teal-600 text-white"
                    : "bg-neutral-100 text-neutral-400"
                }`}
              >
                {isDone ? <Check size={14} /> : isActive ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  >
                    {phase.icon}
                  </motion.div>
                ) : phase.icon}
              </div>
              <span
                className={`text-xs font-medium leading-tight transition-colors duration-200 ${
                  isActive
                    ? "text-teal-700"
                    : isDone
                    ? "text-neutral-700"
                    : "text-neutral-400"
                }`}
              >
                {phase.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current activity message */}
      <div className="flex items-center justify-center space-x-2 py-2">
        <div className="flex space-x-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-teal-500"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" }}
            />
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.span
            key={message}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="text-sm text-neutral-500"
          >
            {message}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function UploadArea({
  label,
  preview,
  onFileSelect,
  onClear,
  uploadHint,
  formatHint,
}: {
  label: string;
  preview: string | null;
  onFileSelect: (file: File) => void;
  onClear: () => void;
  uploadHint: string;
  formatHint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      onFileSelect(file);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-2">
        {label}
      </label>
      {preview ? (
        // Split-background preview: a light logo disappears on bg-neutral-50,
        // a dark logo disappears on bg-neutral-900. Rendering on BOTH at once
        // guarantees the user sees the logo at least on one half, and spots
        // contrast problems instantly instead of staring at apparent emptiness.
        <div className="relative w-full h-32 border border-neutral-200 rounded-lg overflow-hidden group flex">
          <div className="flex-1 bg-neutral-50 flex items-center justify-center p-3 min-w-0">
            <img
              src={preview}
              alt={label}
              className="max-h-24 max-w-full object-contain"
            />
          </div>
          <div className="flex-1 bg-neutral-900 flex items-center justify-center p-3 min-w-0 border-l border-neutral-200">
            <img
              src={preview}
              alt={label}
              className="max-h-24 max-w-full object-contain"
            />
          </div>
          <button
            onClick={onClear}
            className="absolute top-2 right-2 p-1 bg-white border border-neutral-200 rounded-md text-neutral-400 hover:text-neutral-700 hover:border-neutral-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer z-10"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="w-full h-32 border-2 border-dashed border-neutral-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-teal-600 hover:bg-neutral-50 transition-colors"
        >
          <Upload size={20} className="text-neutral-400 mb-2" />
          <span className="text-sm text-neutral-500">
            {uploadHint}
          </span>
          <span className="text-xs text-neutral-400 mt-1">
            {formatHint}
          </span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
  notSetLabel,
}: {
  label: string;
  /** null = no color set. Rendered as an explicit empty state - NEVER a fabricated default
   *  (a hardcoded teal fallback here read as a successful research result; live 2026-07-12). */
  value: string | null;
  onChange: (color: string) => void;
  notSetLabel: string;
}) {
  const colorInputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500 mb-1.5">
        {label}
      </label>
      <div className="flex items-center space-x-2">
        {value ? (
          <div
            className="w-10 h-10 rounded-lg border border-neutral-200 cursor-pointer"
            style={{ backgroundColor: value }}
            onClick={() => colorInputRef.current?.click()}
          />
        ) : (
          <div
            className="w-10 h-10 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 cursor-pointer flex items-center justify-center"
            onClick={() => colorInputRef.current?.click()}
          >
            <X size={12} className="text-neutral-300" />
          </div>
        )}
        <Input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={notSetLabel}
          wrapperClassName="flex-1"
          className="font-mono"
        />
        <input
          ref={colorInputRef}
          type="color"
          value={value ?? "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className="sr-only"
        />
      </div>
    </div>
  );
}

function BrandPreview({
  primaryColor: primaryProp,
  accentColor: accentProp,
  fontFamily,
  logoPreview,
  labels,
}: {
  primaryColor: string | null;
  accentColor: string | null;
  fontFamily: string;
  logoPreview: string | null;
  labels: {
    preview: string;
    brandName: string;
    primaryColor: string;
    accentColor: string;
  };
}) {
  // Unset colors preview as plain neutrals - visibly "no brand yet", never a plausible brand
  // default that could be mistaken for (and saved as) a research result.
  const primaryColor = primaryProp ?? "#d4d4d4";
  const secondaryColor = accentProp ?? "#737373";
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center space-x-2 px-4 py-2.5 border-b border-line">
        <Eye size={14} className="text-neutral-400" />
        <span className="text-xs font-medium text-neutral-500">
          {labels.preview}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Mini header preview */}
        <div
          className="rounded-lg p-4 flex items-center justify-between"
          style={{ backgroundColor: primaryColor }}
        >
          <div className="flex items-center space-x-3">
            {logoPreview ? (
              <img
                src={logoPreview}
                alt={labels.brandName}
                className="h-6 w-auto object-contain brightness-0 invert"
              />
            ) : (
              <div className="w-6 h-6 rounded bg-white/30" />
            )}
            <span
              className="text-white text-sm font-semibold"
              style={{ fontFamily: fontFamily || "inherit" }}
            >
              {labels.brandName}
            </span>
          </div>
          <div className="flex space-x-2">
            <div className="w-12 h-2 rounded bg-white/30" />
            <div className="w-12 h-2 rounded bg-white/30" />
          </div>
        </div>

        {/* Content preview */}
        <div className="space-y-3">
          <div
            className="text-base font-bold"
            style={{
              color: secondaryColor,
              fontFamily: fontFamily || "inherit",
            }}
          >
            {labels.brandName}
          </div>
          <div className="h-2 w-3/4 rounded bg-neutral-200" />
          <div className="h-2 w-1/2 rounded bg-neutral-200" />
        </div>

        {/* Button previews */}
        <div className="flex items-center space-x-3 pt-2">
          <button
            className="px-4 py-1.5 rounded-md text-white text-xs font-medium"
            style={{
              backgroundColor: primaryColor,
              fontFamily: fontFamily || "inherit",
            }}
          >
            {labels.primaryColor}
          </button>
          <button
            className="px-4 py-1.5 rounded-md text-xs font-medium border-2"
            style={{
              borderColor: secondaryColor,
              color: secondaryColor,
              fontFamily: fontFamily || "inherit",
            }}
          >
            {labels.accentColor}
          </button>
        </div>

        {/* Color swatches */}
        <div className="flex items-center space-x-3 pt-2 border-t border-line">
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded-full border border-neutral-200"
              style={{ backgroundColor: primaryColor }}
            />
            <span className="text-xs text-neutral-400">{labels.primaryColor}</span>
          </div>
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded-full border border-neutral-200"
              style={{ backgroundColor: secondaryColor }}
            />
            <span className="text-xs text-neutral-400">{labels.accentColor}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------- Main Component ---------- */

export default function BrandingSettingsPage() {
  const { pages, common } = useTranslation();
  const b = pages.branding;

  const { company, isLoading, error, fetchCompany, updateBranding } =
    useCompanyStore();
  // Connection status derives from the long-lived notifications stream (may be
  // null before the session is authenticated).
  const { notifications } = useApi();

  const [activeTab, setActiveTab] = useState<TabName>("Research");

  const tabItems = [
    { key: "Research", label: b.research, icon: Search },
    { key: "Branding", label: b.branding, icon: Palette },
    { key: "DesignSystem", label: b.designSystem, icon: Sparkles },
  ];

  // Research state
  const [researchUrl, setResearchUrl] = useState("");
  const [isResearching, setIsResearching] = useState(false);
  const [researchJobId, setResearchJobId] = useState<string | null>(null);
  const [researchStatus, setResearchStatus] = useState<"idle" | "running" | "complete" | "failed">("idle");
  // Non-fatal degradation codes from the research result (NO_PRIMARY_COLOR = the site yielded
  // no usable brand color; the user must set colors manually - fail-loud, never silent success).
  const [researchWarnings, setResearchWarnings] = useState<string[]>([]);
  const researchProgress = useResearchProgress(isResearching);

  // Branding local state. Colors are null until the org actually has them - the previous
  // hardcoded #0d9488/#1e293b fallbacks displayed the OLD platform defaults as if research
  // had picked them, and Save persisted them (live defect 2026-07-12).
  const [localPrimaryColor, setLocalPrimaryColor] = useState<string | null>(null);
  const [localAccentColor, setLocalAccentColor] = useState<string | null>(null);
  const [localFontFamily, setLocalFontFamily] = useState("Inter");
  const [localDisplayName, setLocalDisplayName] = useState("");
  const [localInstructions, setLocalInstructions] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  // Track synced company ID for render-time state adjustment (React 19 pattern)
  const [prevCompanyId, setPrevCompanyId] = useState<string | null>(null);

  // Fetch company on mount, and refetch whenever the stream reconnects.
  useEffect(() => {
    fetchCompany();
    if (!notifications) return;
    const unsub = notifications.onStatusChange((status) => {
      if (status === "connected") fetchCompany();
    });
    return unsub;
  }, [fetchCompany, notifications]);

  // Listen for research stream events.
  //
  // Watchdog: if no SSE event arrives for this trace for WATCHDOG_MS, we
  // assume the backend died mid-job (observed when cortex was restarted
  // while "A compilar perfil" was streaming). Without this, the spinner
  // hangs forever because there's no event to flip isResearching=false.
  // Any event for the matching trace re-arms the timer — so a slow-but-
  // progressing job never trips it, only true silence.
  useEffect(() => {
    if (!researchJobId) return;
    // Brand research is a job; its dedicated stream reports progress/completion.
    const stream = openJobStream(researchJobId);
    const WATCHDOG_MS = 3 * 60 * 1000;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    const arm = () => {
      clear();
      watchdog = setTimeout(() => {
        setIsResearching(false);
        setResearchStatus("failed");
        toast.error(b.researchFailed);
      }, WATCHDOG_MS);
    };
    arm();
    // Any progress event re-arms the watchdog, so a slow-but-progressing job never
    // trips it - only true silence does.
    const offProgress = (["ready", "routing", "text_chunk", "tool_event", "plan_step"] as const).map(
      (type) => stream.on(type, arm),
    );
    const offComplete = stream.on("complete", (ev) => {
      clear();
      setIsResearching(false);
      setResearchStatus("complete");
      // The fail-loud color outcome rides the complete payload: research can succeed for
      // logo/design-system while finding no usable brand color (colorsApplied: false).
      const r = (ev.result ?? {}) as { colorsApplied?: boolean; warnings?: string[] };
      const warns = Array.isArray(r.warnings) ? r.warnings : [];
      setResearchWarnings(warns);
      if (r.colorsApplied === false || warns.includes("NO_PRIMARY_COLOR")) {
        toast.info(b.researchNoColors);
      } else {
        toast.success(b.researchComplete);
      }
      fetchCompany();
    });
    const offError = stream.on("error", () => {
      clear();
      setIsResearching(false);
      setResearchStatus("failed");
      toast.error(b.researchFailed);
    });
    return () => {
      clear();
      offProgress.forEach((off) => off());
      offComplete();
      offError();
      stream.close();
    };
  }, [researchJobId, b.researchComplete, b.researchFailed, b.researchNoColors, fetchCompany]);

  // Sync local state from company data (render-time adjustment)
  // Use updatedAt as fingerprint so re-sync triggers after research updates the same company
  const companyFingerprint = company ? `${company.id}_${(company as unknown as Record<string, unknown>).updatedAt || ''}` : null;
  if (company && companyFingerprint && companyFingerprint !== prevCompanyId) {
    const branding = (company.branding ?? {}) as {
      primaryColor?: string;
      accentColor?: string;
      logo?: string;
      [key: string]: unknown;
    };
    setPrevCompanyId(companyFingerprint);
    setLocalPrimaryColor(branding.primaryColor || null);
    setLocalAccentColor(branding.accentColor || null);
    setLocalFontFamily(
      (branding as Record<string, unknown>).fontFamily as string || "Inter"
    );
    setLocalDisplayName(company.displayName || "");
    const rawInstructions = (branding as Record<string, unknown>).instructions;
    setLocalInstructions(typeof rawInstructions === "string" ? rawInstructions : "");
    if (branding.logo) {
      setLogoPreview(branding.logo);
    }
  }

  /* ---------- Handlers ---------- */

  function handleFileSelect(file: File) {
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoFile(file);
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  function handleClearLogo() {
    setLogoFile(null);
    setLogoPreview(null);
  }

  async function handleSaveBranding() {
    setIsSaving(true);
    const brandingData: Record<string, unknown> = {
      fontFamily: localFontFamily,
      instructions: localInstructions,
    };
    // Unset colors are OMITTED, never sent: Save must not be able to persist a color the
    // user never chose (the server merge leaves omitted keys untouched).
    if (localPrimaryColor) brandingData.primaryColor = localPrimaryColor;
    if (localAccentColor) brandingData.accentColor = localAccentColor;
    if (logoPreview) {
      brandingData.logo = logoPreview;
    }

    const result = await updateBranding(brandingData, localDisplayName);
    setIsSaving(false);
    if (result.success) {
      toast.success(b.saved);
    } else {
      // Surface the real save error; the store's generic error state may hold
      // stale research-flow text.
      toast.error(result.error || error || b.researchFailed);
    }
  }

  function handleReset() {
    if (company) {
      const branding = (company.branding ?? {}) as {
      primaryColor?: string;
      accentColor?: string;
      logo?: string;
      [key: string]: unknown;
    };
      setLocalPrimaryColor(branding.primaryColor || null);
      setLocalAccentColor(branding.accentColor || null);
      setLocalFontFamily(
        (branding as Record<string, unknown>).fontFamily as string || "Inter"
      );
      setLocalDisplayName(company.displayName || "");
      const rawInstructions = (branding as Record<string, unknown>).instructions;
      setLocalInstructions(typeof rawInstructions === "string" ? rawInstructions : "");
      if (branding.logo) {
        setLogoPreview(branding.logo);
      } else {
        setLogoPreview(null);
      }
      setLogoFile(null);
    }
  }

  async function handleStartResearch() {
    if (!researchUrl.trim()) return;
    setIsResearching(true);
    setResearchStatus("running");
    setResearchWarnings([]);
    const result = await tryCall(() => api.org.researchBranding({ websiteUrl: researchUrl.trim() }));
    if (result.ok) {
      setResearchJobId(result.data.jobId);
    } else {
      setIsResearching(false);
      setResearchStatus("failed");
      toast.error(b.researchFailed);
    }
  }

  /* ---------- Tab Content ---------- */

  function renderResearchTab() {
    return (
      <motion.div
        key="research"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="space-y-5"
      >
        {/* Header */}
        <div>
          <h3 className="text-sm font-semibold text-neutral-800 mb-0.5">
            {b.research}
          </h3>
          <p className="text-xs text-neutral-500 max-w-md">
            {b.researchDescription}
          </p>
        </div>

        {/* URL input card */}
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <Input
              label={b.websiteUrl}
              value={researchUrl}
              onChange={(e) => setResearchUrl(e.target.value)}
              placeholder={b.websiteUrlPlaceholder}
              disabled={isResearching}
              onKeyDown={(e) => { if (e.key === "Enter") handleStartResearch(); }}
              leftIcon={Globe}
              wrapperClassName="flex-1 min-w-0"
            />
            <Button
              onClick={handleStartResearch}
              disabled={isResearching || !researchUrl.trim()}
              loading={isResearching}
              icon={isResearching ? undefined : Search}
              variant="primary"
            >
              {isResearching ? b.researching : b.researchBrand}
            </Button>
          </div>
        </Card>

        {/* Warning banners */}
        <div className="space-y-2">
          <div className="flex items-start space-x-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">{b.researchWarningTitle}</p>
              <p className="text-xs text-amber-600 mt-0.5">{b.researchWarningDesc}</p>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">{b.memoryWarningTitle}</p>
              <p className="text-xs text-amber-600 mt-0.5">{b.memoryWarningDesc}</p>
            </div>
          </div>
        </div>

        {/* Research in progress */}
        {researchStatus === "running" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card>
              <ResearchProgress
                message={researchProgress.message}
                phases={researchProgress.phases}
                phaseIndex={researchProgress.phaseIndex}
                progress={researchProgress.progress}
              />
            </Card>
          </motion.div>
        )}

        {/* Research complete - amber when no usable brand color was found (fail-loud: the user
            must know to set colors manually, not read absence as a successful teal). */}
        {researchStatus === "complete" && researchWarnings.includes("NO_PRIMARY_COLOR") && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center space-x-3"
          >
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">{b.researchNoColors}</p>
              <p className="text-xs text-amber-600 mt-0.5">
                {researchUrl}
              </p>
            </div>
          </motion.div>
        )}
        {researchStatus === "complete" && !researchWarnings.includes("NO_PRIMARY_COLOR") && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center space-x-3"
          >
            <Check size={18} className="text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">{b.researchComplete}</p>
              <p className="text-xs text-green-600 mt-0.5">
                {researchUrl}
              </p>
            </div>
          </motion.div>
        )}

        {/* Research failed */}
        {researchStatus === "failed" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between"
          >
            <div className="flex items-center space-x-3">
              <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">{b.researchFailed}</p>
                <p className="text-xs text-red-500 mt-0.5">{researchUrl}</p>
              </div>
            </div>
            <Button variant="danger-ghost" size="sm" onClick={handleStartResearch}>
              {common.retry}
            </Button>
          </motion.div>
        )}

        {/* Idle: empty state hint */}
        {researchStatus === "idle" && (
          <div className="border border-dashed border-neutral-200 rounded-xl py-12 flex flex-col items-center justify-center text-center">
            <Globe size={24} className="text-neutral-400 mb-3" />
            <p className="text-sm text-neutral-500 mb-1">
              {b.researchDescription}
            </p>
          </div>
        )}
      </motion.div>
    );
  }

  function renderBrandingTab() {
    return (
      <motion.div
        key="branding"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="space-y-6"
      >
        {/* Loading */}
        {isLoading && !company && <LoadingState />}

        {company && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left column */}
            <div className="space-y-6">
              {/* Company name */}
              <Card>
                <h3 className="text-sm font-semibold text-neutral-800 mb-4">
                  {b.companyName}
                </h3>
                <Input
                  value={localDisplayName}
                  onChange={(e) => setLocalDisplayName(e.target.value)}
                  placeholder={b.companyName}
                />
              </Card>

              {/* Logo */}
              <Card>
                <h3 className="text-sm font-semibold text-neutral-800 mb-4 flex items-center">
                  <ImageIcon size={16} className="mr-2 text-neutral-500" />
                  {b.companyLogo}
                </h3>
                <UploadArea
                  label={b.companyLogo}
                  preview={resolveLogoUrl(logoPreview)}
                  onFileSelect={handleFileSelect}
                  onClear={handleClearLogo}
                  uploadHint={b.uploadLogo}
                  formatHint="PNG, SVG, JPG"
                />
              </Card>

              {/* Colors */}
              <Card>
                <h3 className="text-sm font-semibold text-neutral-800 mb-4 flex items-center">
                  <Palette size={16} className="mr-2 text-neutral-500" />
                  {b.colorScheme}
                </h3>
                <div className="space-y-4">
                  <ColorPicker
                    label={b.primaryColor}
                    value={localPrimaryColor}
                    onChange={setLocalPrimaryColor}
                    notSetLabel={b.colorNotSet}
                  />
                  <ColorPicker
                    label={b.accentColor}
                    value={localAccentColor}
                    onChange={setLocalAccentColor}
                    notSetLabel={b.colorNotSet}
                  />
                </div>
              </Card>

              {/* Font */}
              <Card>
                <h3 className="text-sm font-semibold text-neutral-800 mb-4 flex items-center">
                  <Type size={16} className="mr-2 text-neutral-500" />
                  {b.typography}
                </h3>
                <Input
                  label={b.fontFamily}
                  value={localFontFamily}
                  onChange={(e) => setLocalFontFamily(e.target.value)}
                  placeholder="Inter, Roboto, Open Sans"
                />
              </Card>

              {/* Design Notes (editable; persisted to memory on save) */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <label
                  htmlFor="branding-design-notes"
                  className="block text-xs font-semibold text-amber-800 mb-1.5 uppercase tracking-wide"
                >
                  {b.designNotes}
                </label>
                <Textarea
                  id="branding-design-notes"
                  value={localInstructions}
                  onChange={(e) => setLocalInstructions(e.target.value)}
                  rows={6}
                  placeholder={b.designNotesPlaceholder}
                  className="bg-white border-amber-200 text-amber-900 placeholder-amber-400 focus:border-amber-500 focus:ring-amber-500/30 resize-y"
                />
              </div>
            </div>

            {/* Right column - Preview */}
            <div>
              <BrandPreview
                primaryColor={localPrimaryColor}
                accentColor={localAccentColor}
                fontFamily={localFontFamily}
                logoPreview={resolveLogoUrl(logoPreview)}
                labels={{
                  preview: common.preview,
                  brandName: b.branding,
                  primaryColor: b.primaryColor,
                  accentColor: b.accentColor,
                }}
              />
            </div>
          </div>
        )}
      </motion.div>
    );
  }

  /* ---------- Render ---------- */

  return (
    <PageShell testId="settings-branding-page">
      <PageHeader
        icon={Palette}
        title={b.title}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={handleReset}>
              {common.reset}
            </Button>
            {activeTab === "Branding" && (
              <Button
                variant="primary"
                size="sm"
                icon={isSaving ? undefined : Save}
                loading={isSaving}
                onClick={handleSaveBranding}
              >
                {common.save}
              </Button>
            )}
          </>
        }
      >
        <Tabs
          items={tabItems}
          value={activeTab}
          onChange={(key) => setActiveTab(key as TabName)}
        />
      </PageHeader>

      {/* Error banner */}
      {error && (
        <div className="flex items-center space-x-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle size={16} className="text-red-500" />
          <span className="text-sm text-red-600">{error}</span>
        </div>
      )}

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {activeTab === "Research" && renderResearchTab()}
        {activeTab === "Branding" && renderBrandingTab()}
        {activeTab === "DesignSystem" && (
          <motion.div
            key="design-system"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <DesignSystemTab
              designSystem={
                ((company?.branding as Record<string, unknown> | undefined)?.designSystem as
                  | StoredDesignSystem
                  | null) ?? null
              }
              visualVibe={
                ((company?.branding as Record<string, unknown> | undefined)?.visualVibe as
                  | VisualVibe
                  | null) ?? null
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </PageShell>
  );
}
