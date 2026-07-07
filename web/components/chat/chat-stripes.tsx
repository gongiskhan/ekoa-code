"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/lib/api/client";
import { forkFeaturedInto } from "@/lib/featured-fork";
import { useTranslation } from "@/stores/i18n";
import { useOrchestrationStore } from "@/stores/orchestration";
import {
  HorizontalCardStripe,
  type StripeCard,
  accentForKind,
} from "./horizontal-card-stripe";

interface ArtifactLike {
  id: string;
  name?: string;
  slug?: string;
  shareable?: boolean;
  featured?: boolean;
  featuredRank?: number;
  status?: string;
  updatedAt?: string;
  screenshotUrl?: string;
  data?: Record<string, unknown> | null;
}

function readData<T = unknown>(a: ArtifactLike, key: string): T | undefined {
  if (!a.data || typeof a.data !== "object") return undefined;
  return (a.data as Record<string, unknown>)[key] as T | undefined;
}

function formatRelativeTime(updatedAt: string | undefined, locale: string): string {
  if (!updatedAt) return "";
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (diffMs < minute) return locale === "pt" ? "agora" : "just now";
  if (diffMs < hour) {
    const mins = Math.floor(diffMs / minute);
    return locale === "pt" ? `há ${mins} min` : `${mins}m ago`;
  }
  if (diffMs < day) {
    const hrs = Math.floor(diffMs / hour);
    return locale === "pt" ? `há ${hrs} h` : `${hrs}h ago`;
  }
  if (diffMs < week) {
    const days = Math.floor(diffMs / day);
    if (days <= 1) return locale === "pt" ? "ontem" : "yesterday";
    return locale === "pt" ? `há ${days} dias` : `${days}d ago`;
  }
  const weeks = Math.floor(diffMs / week);
  return locale === "pt" ? `há ${weeks} sem` : `${weeks}w ago`;
}

type TranslationBag = ReturnType<typeof useTranslation>;

function kindLabel(kind: string | undefined, t: TranslationBag): string {
  const sp = t.pages_artifacts.startingPoints;
  if (!kind) return "";
  switch (kind) {
    case "web_app":
      return sp.filterWebApps;
    case "agent_app":
      return sp.filterAgents;
    case "landing_page":
      return sp.filterLandings;
    case "presentation_html":
      return sp.filterPresentations;
    default:
      return kind.replace(/_/g, " ");
  }
}

function useArtifactStripes() {
  const [instances, setInstances] = useState<ArtifactLike[]>([]);
  const [featured, setFeatured] = useState<ArtifactLike[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.listArtifactInstances();
        if (cancelled) return;
        if (resp.success && resp.data) {
          const data = resp.data as
            | ArtifactLike[]
            | { instances?: ArtifactLike[]; featured?: ArtifactLike[] };
          if (Array.isArray(data)) {
            setInstances(data.filter((i) => !i.featured));
            setFeatured(data.filter((i) => i.featured));
          } else {
            setInstances(Array.isArray(data.instances) ? data.instances : []);
            setFeatured(Array.isArray(data.featured) ? data.featured : []);
          }
        }
      } catch {
        // Soft-fail: empty state still renders the input and pills.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { instances, featured, loading };
}

export function ChatStripes() {
  const router = useRouter();
  const t = useTranslation();
  const sp = t.pages_artifacts.startingPoints;
  const cwy = t.pages_artifacts.continueWhereYouLeftOff;
  const locale = t.language;

  const { instances, featured } = useArtifactStripes();

  const featuredCards: StripeCard[] = useMemo(() => {
    const sorted = [...featured].sort(
      (a, b) => (a.featuredRank ?? Number.MAX_SAFE_INTEGER) - (b.featuredRank ?? Number.MAX_SAFE_INTEGER),
    );
    return sorted.map((a) => {
      const kind = readData<string>(a, "outputKind");
      return {
        id: a.id,
        name: a.name ?? sp.title,
        kind: kindLabel(kind, t),
        accent: accentForKind(kind),
        imageUrl: a.screenshotUrl,
        // "Usar" a Starting Point: fork it, open the running fork in a new tab
        // (use it) and land the current tab in the fork's chat (change it).
        // Mirrors the /artifacts Starting Points strip via the shared helper.
        // The app tab must open synchronously (popup blocker) before the fork.
        onClick: () => {
          const appTab =
            typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
          void (async () => {
            const fork = await forkFeaturedInto(a.id, appTab);
            if (!fork) return;
            router.push(`/chat?continue=${encodeURIComponent(fork.id)}`);
          })();
        },
      };
    });
  }, [featured, sp.title, t, router]);

  const ownCards: StripeCard[] = useMemo(() => {
    const sorted = [...instances].sort((a, b) => {
      const aTime = new Date(a.updatedAt ?? 0).getTime();
      const bTime = new Date(b.updatedAt ?? 0).getTime();
      return bTime - aTime;
    });
    return sorted.slice(0, 24).map((a) => {
      const kind = readData<string>(a, "outputKind") ?? readData<string>(a, "templateOutputKind");
      const sessionId = readData<string>(a, "sessionId");
      return {
        id: a.id,
        name: a.name ?? "—",
        kind: kindLabel(kind, t),
        meta: formatRelativeTime(a.updatedAt, locale),
        accent: accentForKind(kind),
        imageUrl: a.screenshotUrl,
        onClick: () => {
          if (!sessionId) {
            router.push(`/artifacts?focus=${encodeURIComponent(a.id)}`);
            return;
          }
          // Pin THIS artifact onto its session, then activate it, before
          // navigating. A session can be shared by several artifacts (legacy
          // forks/copies inherited the source sessionId), so navigating by
          // sessionId alone lets the chat page resolve a different sibling — the
          // "wrong artifact in preview" bug. Priming the job/preview makes
          // hydrateSessionFromArtifact pin the exact artifact the user clicked;
          // appUrl uses the id-based, slug-drift-immune canonical URL.
          // setActiveSession here (like the session list) makes the card
          // self-sufficient: the session shows even when the URL-activation
          // effect no-ops because the route already matches (re-tapping a card
          // after the active session moved on — the "nothing happens" symptom).
          const appUrl = (a.data?.appUrl as string | undefined) ?? `/apps/${a.id}/`;
          const store = useOrchestrationStore.getState();
          store.setSessionJob(sessionId, {
            artifactInstanceId: a.id,
            slug: a.slug ?? null,
            shareable: a.shareable === true,
            projectPath: (a.data?.projectDir as string | undefined) ?? null,
            status: "completed",
          });
          store.setSessionPreview(sessionId, {
            appUrl,
            previewId: null,
            status: "running",
          });
          store.setActiveSession(sessionId);
          router.push(`/chat/${sessionId}`);
        },
      };
    });
  }, [instances, locale, router, t]);

  // Both stripes when each has content; otherwise just the one that does.
  // Continue-where-you-left-off comes first since it's the user's own work.
  const hasOwn = ownCards.length > 0;
  const hasFeatured = featuredCards.length > 0;

  return (
    <div className="w-full flex flex-col gap-6">
      {hasOwn && (
        <HorizontalCardStripe
          label={cwy.title}
          cards={ownCards}
          scrollPrevLabel={cwy.scrollPrev}
          scrollNextLabel={cwy.scrollNext}
          rightAction={{
            label: cwy.viewAll,
            onClick: () => router.push("/artifacts"),
          }}
        />
      )}
      {hasFeatured && (
        <HorizontalCardStripe
          label={sp.title}
          cards={featuredCards}
          emptyMessage={sp.empty}
          scrollPrevLabel={cwy.scrollPrev}
          scrollNextLabel={cwy.scrollNext}
          rightAction={{
            label: cwy.viewAll,
            onClick: () => router.push("/artifacts"),
          }}
        />
      )}
    </div>
  );
}
