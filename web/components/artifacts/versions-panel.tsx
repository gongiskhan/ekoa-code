"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import {
  listArtifactVersions,
  restoreArtifactVersion,
  type ArtifactVersion,
} from "@/lib/api/client";
import { useTranslation } from "@/stores/i18n";

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function firstLine(message: string): string {
  const idx = message.indexOf("\n");
  return idx === -1 ? message : message.slice(0, idx);
}

interface VersionsPanelProps {
  artifactId: string;
  /** Called after a successful restore so callers can reload the iframe / refetch state. */
  onAfterRestore?: () => void;
  /** Hides the heading + Refresh row (useful when the panel is embedded inside a tab that has its own header). */
  hideHeader?: boolean;
  className?: string;
}

export function VersionsPanel({
  artifactId,
  onAfterRestore,
  hideHeader,
  className,
}: VersionsPanelProps) {
  const { versions: t } = useTranslation();
  const [versions, setVersions] = useState<ArtifactVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoringSha, setRestoringSha] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<ArtifactVersion | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listArtifactVersions(artifactId);
      if (res.success && res.data) {
        setVersions(res.data.versions);
      } else {
        setError(res.error?.message || t.failedToLoad);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failedToLoad);
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRestoreConfirm() {
    if (!pendingRestore) return;
    const sha = pendingRestore.sha;
    setRestoringSha(sha);
    setPendingRestore(null);
    try {
      const res = await restoreArtifactVersion(artifactId, sha);
      if (!res.success) {
        setError(res.error?.message || t.failedToRestore);
        return;
      }
      await load();
      onAfterRestore?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failedToRestore);
    } finally {
      setRestoringSha(null);
    }
  }

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      {!hideHeader && (
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
            {t.historyTitle}
          </h3>
          <button
            onClick={() => void load()}
            className="text-xs text-neutral-500 hover:text-teal-700 cursor-pointer disabled:opacity-50"
            disabled={loading}
          >
            {t.refresh}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading && versions === null && (
          <div className="flex items-center justify-center gap-2 p-8 text-xs text-neutral-400">
            <Loader2 size={14} className="animate-spin" />
            {t.loading}
          </div>
        )}
        {error && (
          <div className="m-4 p-3 rounded-md bg-red-50 text-xs text-red-700 border border-red-100">
            {error}
          </div>
        )}
        {versions !== null && versions.length === 0 && !error && (
          <div className="p-6 text-xs text-neutral-500">
            {t.noVersionsYet}
          </div>
        )}
        {versions !== null && versions.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {versions.map((v, idx) => {
              const isLatest = idx === 0;
              const isRestoring = restoringSha === v.sha;
              return (
                <li key={v.sha} className="px-4 py-3 hover:bg-neutral-50">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-mono text-neutral-400">
                      {v.sha.slice(0, 7)}
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      {relativeTime(v.timestamp)}
                    </span>
                    {isLatest && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">
                        {t.current}
                      </span>
                    )}
                    {v.buildFailed && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700"
                        title={t.buildFailedTitle}
                      >
                        <AlertTriangle size={10} />
                        {t.buildFailed}
                      </span>
                    )}
                    {v.isRestore && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                        {t.restored}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-700 line-clamp-2">
                    {firstLine(v.message) || t.noMessage}
                  </p>
                  {!isLatest && (
                    <button
                      onClick={() => setPendingRestore(v)}
                      disabled={isRestoring || restoringSha !== null}
                      className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {isRestoring ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <RotateCcw size={11} />
                      )}
                      {t.restoreThisVersion}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pendingRestore && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
          onClick={() => setPendingRestore(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-xl ring-1 ring-black/5 w-[420px] p-5"
          >
            <h3 className="text-sm font-semibold text-neutral-900 mb-2">
              {t.restoreToTitle(pendingRestore.sha.slice(0, 7))}
            </h3>
            <p className="text-xs text-neutral-600 mb-3">
              {firstLine(pendingRestore.message) || t.noMessage}
            </p>
            <p className="text-xs text-neutral-500 mb-4">
              {t.restoreExplain}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingRestore(null)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                onClick={() => void handleRestoreConfirm()}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 cursor-pointer"
              >
                {t.restoreVersion}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
