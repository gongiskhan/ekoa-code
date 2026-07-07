"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getApiBaseUrl, getAppUrl } from "@/lib/api/client";
import { useDemosStore } from "@/stores/demos";
import { createTourController, type TourController } from "@/lib/demo/tour-machine";
import type { DemoSpec } from "@/lib/demo/types";
import { DemoOverlay } from "./DemoOverlay";

/**
 * Mounts the Tutorial Bridge demo experience. Activated by the `?demo=<appId>`
 * search param: it fetches the spec, opens a self-contained full-screen iframe
 * of the served app, and drives the tour machine over postMessage. Renders
 * nothing (zero impact) when no demo is active. Suspense-wrapped because it
 * reads useSearchParams.
 */
export function DemoTourProvider() {
  return (
    <Suspense fallback={null}>
      <DemoTourProviderInner />
    </Suspense>
  );
}

function DemoTourProviderInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const demoAppId = searchParams.get("demo");

  const spec = useDemosStore((s) => s.spec);
  const tour = useDemosStore((s) => s.tour);
  const injectedPrompt = useDemosStore((s) => s.injectedPrompt);
  const startTour = useDemosStore((s) => s.startTour);
  const setTour = useDemosStore((s) => s.setTour);
  const setInjectedPrompt = useDemosStore((s) => s.setInjectedPrompt);
  const endTour = useDemosStore((s) => s.endTour);
  const setCards = useDemosStore((s) => s.setCards);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const controllerRef = useRef<TourController | null>(null);
  const [iframeSrc, setIframeSrc] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const apiBase = getApiBaseUrl();

  // Populate the gallery cards once (used by the future landing panel).
  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/api/demos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json && Array.isArray(json.demos)) setCards(json.demos);
      })
      .catch(() => {
        /* non-fatal: the panel simply shows nothing */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, setCards]);

  const close = useCallback(() => {
    controllerRef.current?.cancel();
    controllerRef.current?.dispose();
    controllerRef.current = null;
    endTour();
    setIframeSrc("");
    setLoadError(null);
    // Strip only the ?demo param, preserving anything else.
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete("demo");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [endTour, pathname, router, searchParams]);

  // Activate / tear down the tour as the ?demo param changes.
  useEffect(() => {
    if (!demoAppId) return;

    let cancelled = false;
    setLoadError(null);
    fetch(`${apiBase}/api/demos/${encodeURIComponent(demoAppId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`spec ${r.status}`);
        return r.json();
      })
      .then((loaded: DemoSpec) => {
        if (cancelled) return;
        startTour(demoAppId, loaded);
        setIframeSrc(getAppUrl(demoAppId));

        const appOrigin = new URL(getAppUrl(demoAppId), window.location.href).origin;
        const controller = createTourController({
          spec: loaded,
          appOrigin,
          getIframe: () => iframeRef.current,
          navigateApp: (path: string) => {
            const clean = String(path || "").replace(/^\/+/, "");
            setIframeSrc(getAppUrl(demoAppId) + clean);
          },
          injectPrompt: (prompt: string) => setInjectedPrompt(prompt),
          onState: (state) => setTour(state),
        });
        controllerRef.current = controller;
        // Resume from the persisted step if this is a refresh of the same tour.
        controller.start(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Não foi possível carregar a demonstração.");
      });

    return () => {
      cancelled = true;
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoAppId, apiBase]);

  if (!demoAppId) return null;

  return (
    <div
      data-demo-root
      role="dialog"
      aria-modal="true"
      aria-label="Demonstração guiada"
      className="fixed inset-0 z-[60] flex flex-col bg-neutral-100"
    >
      <header className="flex items-center gap-3 px-5 py-3 border-b border-neutral-200 bg-white flex-shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-teal-600">Demonstração guiada</p>
          <h2 className="text-sm font-semibold text-neutral-900 truncate">{spec?.card.titlePt ?? demoAppId}</h2>
        </div>
        <button
          type="button"
          onClick={close}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-neutral-600
                     hover:text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer"
        >
          Sair da demonstração
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {loadError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="text-sm text-neutral-500">{loadError}</p>
          </div>
        ) : (
          <>
            {iframeSrc && (
              <iframe
                ref={iframeRef}
                data-demo-frame
                src={iframeSrc}
                onLoad={() => controllerRef.current?.notifyIframeLoad()}
                className="w-full h-full border-0 bg-white"
                title="Demonstração da aplicação"
              />
            )}
            {spec && tour && (
              <DemoOverlay
                spec={spec}
                tour={tour}
                injectedPrompt={injectedPrompt}
                apiBase={apiBase}
                onNext={() => controllerRef.current?.next()}
                onCancel={close}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
