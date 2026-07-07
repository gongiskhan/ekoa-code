"use client";

import { useEffect, useState } from "react";
import {
  X,
  Loader2,
  ExternalLink,
  Globe,
  Layout,
  Table2,
  Bot,
  Presentation,
  FileText,
  History,
  type LucideIcon,
} from "lucide-react";
import { VersionsPanel } from "@/components/artifacts/versions-panel";
import { useTranslation } from "@/stores/i18n";

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

interface ArtifactPreviewOverlayProps {
  artifactId?: string;
  title: string;
  summary?: string;
  templateId?: string;
  previewUrl: string;
  openUrl: string;
  onClose: () => void;
}

export function ArtifactPreviewOverlay({
  artifactId,
  title,
  summary,
  templateId,
  previewUrl,
  openUrl,
  onClose,
}: ArtifactPreviewOverlayProps) {
  const { versions: vt } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeSrc =
    reloadKey === 0
      ? previewUrl
      : `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}_v=${reloadKey}`;
  const [showVersions, setShowVersions] = useState(false);
  const Icon = typeIconMap[guessOutputKind(templateId)] || Globe;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleAfterRestore() {
    setReloadKey(Date.now());
    setLoaded(false);
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-preview-title"
        className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 w-[80vw] h-[80vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-neutral-100 flex-shrink-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-teal-50 text-teal-600 flex-shrink-0">
            <Icon size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="artifact-preview-title"
              className="text-sm font-semibold text-neutral-900 truncate"
            >
              {title}
            </h2>
            {summary && (
              <p className="text-xs text-neutral-500 truncate mt-0.5">{summary}</p>
            )}
          </div>
          {artifactId && (
            <button
              onClick={() => setShowVersions((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                showVersions
                  ? "text-teal-700 bg-teal-50 hover:bg-teal-100"
                  : "text-neutral-600 bg-neutral-50 hover:bg-neutral-100"
              }`}
              title={vt.showHistory}
              aria-label={vt.showHistory}
              aria-pressed={showVersions}
            >
              <History size={13} />
              {vt.tab}
            </button>
          )}
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors"
            title="Open in new tab"
            aria-label="Open in new tab"
          >
            <ExternalLink size={13} />
            Open in new tab
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
            title="Close"
            aria-label="Close preview"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 flex bg-neutral-100 overflow-hidden">
          <div className="flex-1 p-4 overflow-hidden">
            <div className="relative w-full h-full rounded-xl overflow-hidden bg-white ring-1 ring-neutral-200 shadow-inner">
              {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-neutral-400 bg-white">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Loading preview...</span>
                </div>
              )}
              <iframe
                src={iframeSrc}
                className="w-full h-full border-0"
                title={`Preview of ${title}`}
                onLoad={() => setLoaded(true)}
              />
            </div>
          </div>

          {showVersions && artifactId && (
            <aside className="w-80 flex-shrink-0 border-l border-neutral-200 bg-white">
              <VersionsPanel
                artifactId={artifactId}
                onAfterRestore={handleAfterRestore}
                className="h-full"
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
