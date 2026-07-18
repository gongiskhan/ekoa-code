'use client';

/**
 * The OS-mode shell (surface contract 4.5): desktop with items, dock,
 * workspace switcher, window layer, and (phase 7) the docked chat panel.
 * Owns the artifact list the desktop items resolve against, the SurfaceHost
 * seam every surface/action receives, and the shared rename/delete dialogs
 * the item menus target.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api, tryCall } from '@/lib/api';
import { toast } from '@/stores/toast';
import { useTranslation } from '@/stores/i18n';
import { getSurface, SURFACES } from '@/lib/os/registry';
import { OS_STRINGS } from '@/lib/os/strings';
import type { DesktopItemRef, Rect, SurfaceHost } from '@/lib/os/types';
import { useOsStore, useActiveWorkspace, sameRef } from '@/stores/os';
import { RenameArtifactDialog } from '@/components/artifacts/rename-artifact-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ArtifactLike } from '@/components/artifacts/artifact-actions';
import { Desktop } from './desktop';
import { Dock } from './dock';
import { WorkspaceSwitcher } from './workspace-switcher';
import { WindowLayer } from './window-layer';
import { NarrowSurfaceHost } from './narrow-surface-host';
import { GlobalChatDock } from '@/components/chat/global-chat-dock';
import { useIsMobile } from '@/hooks/useIsMobile';

/** Artifact enriched with what the shell needs to render/open it. */
export interface OsArtifact extends ArtifactLike {
  appUrl: string | null;
  shareable?: boolean;
  templateId?: string;
}

function isRunnable(status: string): boolean {
  return status === 'running' || status === 'ready' || status === 'active' || status === 'healthy';
}

export function OsShell() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { pages_artifacts: a, common } = useTranslation();
  const workspace = useActiveWorkspace();
  const seedDesktop = useOsStore((s) => s.seedDesktop);
  const openWindowStore = useOsStore((s) => s.openWindow);

  // Shared item-menu dialogs (scenario 3: rename/clone must work from OS mode).
  const [renaming, setRenaming] = useState<OsArtifact | null>(null);
  const [deleting, setDeleting] = useState<OsArtifact | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ---- Artifact list (desktop items resolve against this) ----
  const [artifacts, setArtifacts] = useState<OsArtifact[]>([]);
  const refreshArtifacts = useCallback(async () => {
    const res = await tryCall(() => api.artifacts.list());
    if (!res.ok) return;
    const items = (res.data.items as unknown as Array<Record<string, unknown>>).map((raw) => {
      const status = String(raw.status ?? '');
      const slug = raw.slug as string | undefined;
      const id = String(raw.id);
      return {
        id,
        status,
        slug,
        name: (raw.name as string) || (raw.title as string) || 'Artefacto',
        title: (raw.title as string) || (raw.name as string) || 'Artefacto',
        templateId: (raw.templateId as string) || (raw.typeId as string),
        shareable: raw.shareable === true,
        appUrl: isRunnable(status) ? api.appUrl(slug || id) : null,
      } satisfies OsArtifact;
    });
    setArtifacts(items);
  }, []);

  useEffect(() => {
    void refreshArtifacts();
  }, [refreshArtifacts]);

  // Seed/refresh the desktop membership once the artifact list is known:
  // registered surfaces first, then the user's artifacts (contract 4.3).
  useEffect(() => {
    if (artifacts.length === 0) return;
    seedDesktop([
      ...SURFACES.map((s) => ({ kind: 'surface', id: s.id }) as DesktopItemRef),
      ...artifacts.map((ar) => ({ kind: 'artifact', id: ar.id }) as DesktopItemRef),
    ]);
  }, [artifacts, seedDesktop]);

  // ---- The SurfaceHost seam ----
  const openSurfaceWindow = useCallback(
    (surfaceId: string, props: Record<string, unknown> = {}) => {
      const manifest = getSurface(surfaceId);
      if (!manifest) {
        // Surface not registered yet (artifact-app lands in a later slice):
        // honest fallback = the served app in a new tab, same as classic.
        const url = props.appUrl;
        if (typeof url === 'string' && url) window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      const count = workspace?.windows.length ?? 0;
      const step = (count % 6) * 32;
      const rect: Rect = {
        x: 96 + step,
        y: 64 + step,
        w: manifest.preferredSize.w,
        h: manifest.preferredSize.h,
      };
      openWindowStore({
        surfaceId,
        props,
        title: typeof props.title === 'string' ? props.title : manifest.title,
        dedupeKey: manifest.singleton
          ? surfaceId
          : `${surfaceId}:${String(props.artifactId ?? props.appUrl ?? Math.random())}`,
        rect,
      });
    },
    [openWindowStore, workspace?.windows.length],
  );

  const host = useMemo<SurfaceHost>(
    () => ({ mode: 'os', openSurface: openSurfaceWindow }),
    [openSurfaceWindow],
  );

  async function confirmDelete() {
    if (!deleting || isDeleting) return;
    setIsDeleting(true);
    const res = await tryCall(() => api.artifacts.remove({ id: deleting.id }));
    setIsDeleting(false);
    if (res.ok) {
      setDeleting(null);
      void refreshArtifacts();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="os-shell">
      {/* Top strip: identity + workspaces + way back. */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface/80 px-3 glass">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-semibold tracking-tight text-neutral-900">
            {OS_STRINGS.shell.title}
          </span>
          <span className="rounded-full border border-teal-600/30 bg-teal-600/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
            {OS_STRINGS.shell.beta}
          </span>
        </div>
        <WorkspaceSwitcher />
        <Link
          href="/chat"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-ring"
        >
          <ArrowLeft size={13} aria-hidden />
          {OS_STRINGS.shell.backToClassic}
        </Link>
      </div>

      {/* Main row: desktop (+ windows or the narrow full-screen host) with the
          docked chat panel beside any window arrangement (contract 5). */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-hidden bg-dots" data-testid="os-desktop-area">
          <Desktop
            artifacts={artifacts}
            host={host}
            onStartRename={setRenaming}
            onRequestDelete={setDeleting}
            onRefresh={() => void refreshArtifacts()}
          />
          {isMobile ? <NarrowSurfaceHost host={host} /> : <WindowLayer host={host} />}
        </div>
        {!isMobile && <GlobalChatDock mode="os" host={host} />}
      </div>

      <Dock host={host} artifacts={artifacts} />

      {renaming && (
        <RenameArtifactDialog
          artifactId={renaming.id}
          initialName={renaming.title || renaming.name || ''}
          onClose={() => setRenaming(null)}
          onRenamed={() => void refreshArtifacts()}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          title={a.deleteArtifact}
          description={deleting.title || deleting.name}
          confirmLabel={common.delete}
          cancelLabel={common.cancel}
          tone="danger"
          loading={isDeleting}
        />
      )}
    </div>
  );
}

/** Resolve a desktop/pin ref against the registry + artifact list. */
export function resolveRef(
  ref: DesktopItemRef,
  artifacts: OsArtifact[],
): { kind: 'surface'; id: string } | { kind: 'artifact'; artifact: OsArtifact } | null {
  if (ref.kind === 'surface') {
    return getSurface(ref.id) ? { kind: 'surface', id: ref.id } : null;
  }
  const artifact = artifacts.find((ar) => ar.id === ref.id);
  return artifact ? { kind: 'artifact', artifact } : null;
}

export { sameRef };
