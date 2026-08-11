"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, tryCall } from "@/lib/api";
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
  // Narrow top-level lifts off the server-owned `data` bag (`shared/src/artifacts.ts` Artifact) -
  // `data` itself is never on the wire, so these replace the old (always-`undefined`) `a.data?.x`
  // reads that made every card's kind label, session link, and app URL permanently dead.
  outputKind?: string;
  sessionId?: string;
  appUrl?: string;
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
        const res = await tryCall(() => api.artifacts.list());
        if (cancelled) return;
        if (res.ok) {
          const items = res.data.items as unknown as ArtifactLike[];
          const featuredItems = res.data.featured as unknown as ArtifactLike[];
          setInstances(items.filter((i) => !i.featured));
          setFeatured(featuredItems);
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
      const kind = a.outputKind;
      return {
        id: a.id,
        name: a.name ?? sp.title,
        kind: kindLabel(kind, t),
        accent: accentForKind(kind),
        imageUrl: a.screenshotUrl,
        // A featured app IS the app — forking here produced a second copy the
        // user then saw twice in the gallery, with no way to tell which one
        // their changes had gone into. Mirror what /artifacts already does
        // (handleCustomizeFeatured): open the running featured app in a new tab
        // (use it) and land the current tab in ITS chat via ?continue= (change
        // it in place). The backend materialises a working copy on the first
        // real modification, keeping the id, slug and data.
        //
        // The app tab still opens synchronously inside the handler, before any
        // navigation, or the popup blocker eats it.
        onClick: () => {
          const appTab =
            typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
          if (appTab) {
            // Sever the opener link before navigating (reverse-tabnabbing),
            // matching the noopener posture of the regular "Run" action.
            try {
              appTab.opener = null;
            } catch {
              /* cross-origin after navigation — nothing to sever */
            }
            appTab.location.replace(api.appUrl(a.slug || a.id));
          }
          router.push(`/chat?continue=${encodeURIComponent(a.id)}`);
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
      const kind = a.outputKind;
      const sessionId = a.sessionId;
      return {
        id: a.id,
        name: a.name ?? "—",
        kind: kindLabel(kind, t),
        meta: formatRelativeTime(a.updatedAt, locale),
        accent: accentForKind(kind),
        imageUrl: a.screenshotUrl,
        onClick: () => {
          if (!sessionId) {
            // No session was ever linked to this artifact (e.g. a bare create/import/fork that
            // never went through a chat build) - route through the SAME ?continue= handler the
            // chat page uses everywhere else, which creates a session and links it server-side,
            // rather than the old dead-end `/artifacts?focus=` (that query param was never read
            // by anything - clicking just dumped the user on the unfiltered gallery).
            router.push(`/chat?continue=${encodeURIComponent(a.id)}`);
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
          const appUrl = a.appUrl ?? `/apps/${a.id}/`;
          const store = useOrchestrationStore.getState();
          store.setSessionJob(sessionId, {
            artifactInstanceId: a.id,
            slug: a.slug ?? null,
            shareable: a.shareable === true,
            // projectDir is server-owned and never on the wire (ch09) - null is fine here, a
            // server round-trip (loadSessionFiles / hydrateSessionFromArtifact) fills it in.
            projectPath: null,
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
