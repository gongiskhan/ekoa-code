'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, File as FileIcon, Folder, FolderCheck } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { browseDaemon, type BrowseEntry, type DaemonBrowse, type PendingReference } from '@/lib/bridge-local';

/**
 * FC-401 connected state — the in-app file browser (owner directive 2026-07-11: connected = trusted,
 * users pick files/folders VISUALLY, never a typed path or grantRef). Reads the daemon's /browse
 * surface (loopback), lets the user navigate, and returns a PENDING reference (path/label/kind);
 * the grant is minted at send time (D3), so this dialog authorizes nothing by itself — it selects.
 *
 * Selection is the grant gesture (D2): "Autorizar esta pasta" picks the current directory;
 * a file row's "Autorizar" picks that file (its parent folder is what the daemon grants, stated in
 * the FC-411 consent that follows). Never uploads.
 */
export function FileBrowserDialog({
  open,
  onCancel,
  onPick,
}: {
  open: boolean;
  onCancel: () => void;
  /** A pending reference the composer holds until send (path/label/kind), NOT a minted grant. */
  onPick: (ref: PendingReference) => void;
}) {
  const [browse, setBrowse] = useState<DaemonBrowse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (path?: string) => {
    setLoading(true);
    setError(false);
    try {
      setBrowse(await browseDaemon(path));
    } catch {
      setError(true);
      setBrowse(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Open at the daemon's default root each time the dialog is shown.
  useEffect(() => {
    if (open) void load(undefined);
    else setBrowse(null);
  }, [open, load]);

  const currentName = browse ? baseName(browse.path) : '';

  function pickFolder() {
    if (!browse) return;
    onPick({ path: browse.path, label: currentName || browse.path, kind: 'dir' });
  }

  function pickFile(entry: BrowseEntry) {
    if (!browse) return;
    onPick({ path: joinPath(browse.path, entry.name), label: entry.name, kind: 'file' });
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={PRIVACY_COPY.browserTitle}
      description={PRIVACY_COPY.browserIntro}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {PRIVACY_COPY.browserCancel}
          </Button>
          <Button
            variant="primary"
            onClick={pickFolder}
            disabled={!browse}
            data-testid="file-browser-choose-folder"
          >
            <FolderCheck size={14} className="mr-1.5" aria-hidden />
            {PRIVACY_COPY.browserChooseFolder}
          </Button>
        </>
      }
    >
      <div data-testid="file-browser">
        {/* Current path + up-one-level. */}
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => browse?.parent && void load(browse.parent)}
            disabled={!browse?.parent}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={PRIVACY_COPY.browserParent}
            data-testid="file-browser-parent"
          >
            <ArrowUp size={12} aria-hidden />
            {PRIVACY_COPY.browserParent}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-neutral-500" data-testid="file-browser-path" title={browse?.path}>
            {browse?.path ?? ''}
          </span>
        </div>

        <p className="mb-2 text-[11px] text-neutral-400">{PRIVACY_COPY.browserChooseHint}</p>

        <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-100">
          {loading && <p className="px-3 py-6 text-center text-xs text-neutral-400">{PRIVACY_COPY.browserLoading}</p>}
          {!loading && error && (
            <p className="px-3 py-6 text-center text-xs text-neutral-500" data-testid="file-browser-unavailable">
              {PRIVACY_COPY.browserUnavailable}
            </p>
          )}
          {!loading && !error && browse && browse.entries.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-neutral-400" data-testid="file-browser-empty">
              {PRIVACY_COPY.browserEmpty}
            </p>
          )}
          {!loading && !error && browse &&
            browse.entries.map((entry) =>
              entry.kind === 'dir' ? (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => void load(joinPath(browse.path, entry.name))}
                  className="flex w-full items-center gap-2 border-b border-neutral-50 px-3 py-2 text-left text-xs text-neutral-700 transition-colors last:border-b-0 hover:bg-neutral-50"
                  data-testid={`file-browser-dir-${entry.name}`}
                >
                  <Folder size={14} className="shrink-0 text-teal-600" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
              ) : (
                <div
                  key={entry.name}
                  className="flex items-center gap-2 border-b border-neutral-50 px-3 py-2 text-xs text-neutral-600 last:border-b-0"
                >
                  <FileIcon size={14} className="shrink-0 text-neutral-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {entry.size !== undefined && (
                    <span className="shrink-0 text-[10px] text-neutral-400">{formatSize(entry.size)}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => pickFile(entry)}
                    className="shrink-0 rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 transition-colors hover:bg-teal-100"
                    data-testid={`file-browser-pick-file-${entry.name}`}
                  >
                    {PRIVACY_COPY.browserPickFile}
                  </button>
                </div>
              ),
            )}
        </div>

        {browse?.truncated && <p className="mt-2 text-[10px] text-neutral-400">{PRIVACY_COPY.browserTruncated}</p>}
        <p className="mt-2 text-[10px] text-neutral-400">{PRIVACY_COPY.browserFilePickNote}</p>
      </div>
    </Dialog>
  );
}

function baseName(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
