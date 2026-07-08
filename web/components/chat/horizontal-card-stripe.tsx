"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";

export interface StripeCard {
  id: string;
  name: string;
  meta?: string;
  kind?: string;
  // CSS background for the visual area. Falls back to a neutral gradient.
  accent?: string;
  // Optional thumbnail (e.g. an artifact screenshot). Takes precedence over `accent`.
  imageUrl?: string;
  href?: string;
  onClick?: () => void;
}

interface HorizontalCardStripeProps {
  label: string;
  cards: StripeCard[];
  rightAction?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  emptyMessage?: string;
  scrollPrevLabel?: string;
  scrollNextLabel?: string;
}

const KIND_ACCENTS: Record<string, string> = {
  web_app:
    "linear-gradient(135deg, rgba(20, 184, 166, 0.18) 0%, rgba(15, 118, 110, 0.32) 100%)",
  agent_app:
    "linear-gradient(135deg, rgba(99, 102, 241, 0.22) 0%, rgba(79, 70, 229, 0.36) 100%)",
  landing_page:
    "linear-gradient(135deg, rgba(251, 191, 36, 0.22) 0%, rgba(245, 158, 11, 0.36) 100%)",
  presentation_html:
    "linear-gradient(135deg, rgba(168, 85, 247, 0.22) 0%, rgba(126, 34, 206, 0.36) 100%)",
};

const DEFAULT_ACCENT =
  "linear-gradient(135deg, rgba(15, 118, 110, 0.16) 0%, rgba(20, 184, 166, 0.28) 100%)";

export function accentForKind(kind?: string): string {
  if (!kind) return DEFAULT_ACCENT;
  return KIND_ACCENTS[kind] ?? DEFAULT_ACCENT;
}

export function HorizontalCardStripe({
  label,
  cards,
  rightAction,
  emptyMessage,
  scrollPrevLabel = "Previous",
  scrollNextLabel = "Next",
}: HorizontalCardStripeProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const recomputeScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    recomputeScrollState();
    const el = trackRef.current;
    if (!el) return;
    const handler = () => recomputeScrollState();
    el.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    return () => {
      el.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, [recomputeScrollState, cards.length]);

  const scrollBy = useCallback((direction: "prev" | "next") => {
    const el = trackRef.current;
    if (!el) return;
    const firstCard = el.querySelector<HTMLElement>("[data-stripe-card]");
    const cardWidth = firstCard ? firstCard.offsetWidth + 16 : el.clientWidth * 0.8;
    const delta = direction === "next" ? cardWidth * 2 : -cardWidth * 2;
    el.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  return (
    <section className="w-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-neutral-500">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {rightAction && (
            <a
              href={rightAction.href ?? undefined}
              onClick={(e) => {
                if (rightAction.onClick) {
                  e.preventDefault();
                  rightAction.onClick();
                }
              }}
              className="text-xs text-neutral-600 hover:text-neutral-900 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{rightAction.label}</span>
              <span
                aria-hidden
                className="w-2.5 h-2.5 rounded-sm bg-teal-500 inline-block"
              />
            </a>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollBy("prev")}
              disabled={!canScrollLeft}
              aria-label={scrollPrevLabel}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => scrollBy("next")}
              disabled={!canScrollRight}
              aria-label={scrollNextLabel}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {cards.length === 0 ? (
        emptyMessage ? (
          <div className="text-xs text-neutral-400 italic py-4">{emptyMessage}</div>
        ) : null
      ) : (
        <div
          ref={trackRef}
          className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory"
          style={{ scrollbarWidth: "none" }}
        >
          {cards.map((card) => {
            const visual = card.imageUrl ? (
              <div className="h-32 w-full overflow-hidden bg-neutral-100">
                <img
                  src={api.resolveUrl(card.imageUrl)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div
                className="h-32 w-full"
                style={{
                  background: card.accent ?? DEFAULT_ACCENT,
                }}
                aria-hidden
              >
                <div className="flex items-center gap-1 px-4 pt-3">
                  <span className="w-2 h-2 rounded-full bg-white/70" />
                  <span className="w-2 h-2 rounded-full bg-white/70" />
                </div>
                <div className="mt-10 mx-4 h-1.5 rounded-full bg-white/55" />
              </div>
            );
            const body = (
              <div className="px-4 py-3">
                <div className="text-sm font-semibold text-neutral-900 truncate">
                  {card.name}
                </div>
                <div className="text-[11px] text-neutral-500 mt-1 truncate">
                  {card.kind ?? ""}
                  {card.kind && card.meta ? " · " : ""}
                  {card.meta ?? ""}
                </div>
              </div>
            );

            const cardInner = (
              <div className="flex flex-col h-full">
                {visual}
                {body}
              </div>
            );

            const sharedClass =
              "snap-start shrink-0 w-[260px] md:w-[280px] rounded-2xl border border-neutral-200 bg-white overflow-hidden text-left hover:border-neutral-300 hover:shadow-sm transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2";

            if (card.href && !card.onClick) {
              return (
                <a
                  key={card.id}
                  data-stripe-card
                  href={card.href}
                  className={sharedClass}
                >
                  {cardInner}
                </a>
              );
            }
            return (
              <button
                key={card.id}
                type="button"
                data-stripe-card
                onClick={card.onClick}
                className={sharedClass}
              >
                {cardInner}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
