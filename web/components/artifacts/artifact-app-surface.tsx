'use client';

/**
 * The artifact-app surface (contract 2.5): a served app in a window - the
 * multi-instance counterpart of the artifacts manager. Reuses the served-app
 * URL rules the side panel established: non-shareable artifacts carry the
 * ?token= ownership check; shareable ones stay token-less (no JWT leakage on
 * a public URL). A single document probe before pointing the iframe avoids
 * wedging on a transient 5xx (F-2026-07-12-preview-502): an iframe never
 * fires its error event for HTTP failures.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { probePreviewDocument } from '@/lib/preview-probe';
import { useAuthStore } from '@/stores/auth';
import type { SurfaceProps } from '@/lib/os/types';
import { OS_STRINGS } from '@/lib/os/strings';
import { Button } from '@/components/ui/button';

export function ArtifactAppSurface({ props }: SurfaceProps) {
  const appUrl = typeof props.appUrl === 'string' && props.appUrl ? props.appUrl : null;
  const shareable = props.shareable === true;
  const token = useAuthStore((s) => s.token);

  const src = appUrl
    ? shareable || !token
      ? appUrl
      : api.withPreviewToken(appUrl)
    : null;

  const [state, setState] = useState<'probing' | 'ready' | 'error'>('probing');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setState('probing');
    void probePreviewDocument(src).then((verdict) => {
      if (!cancelled) setState(verdict === 'transient' ? 'error' : 'ready');
    });
    return () => {
      cancelled = true;
    };
  }, [src, attempt]);

  if (!src) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-neutral-400">
        {OS_STRINGS.artifactApp.notReady}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 bg-white">
      {state === 'ready' && (
        <iframe src={src} title={String(props.title ?? 'app')} className="h-full w-full flex-1 border-0" />
      )}
      {state === 'probing' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white">
          <Loader2 size={22} className="animate-spin text-teal-600" aria-hidden />
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white p-6 text-center">
          <p className="text-sm text-neutral-500">{OS_STRINGS.artifactApp.loadFailed}</p>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => setAttempt((n) => n + 1)}>
            {OS_STRINGS.artifactApp.retry}
          </Button>
        </div>
      )}
    </div>
  );
}
