/**
 * Design System tab content — renders the extractor output stored at
 * `company.branding.designSystem` plus `branding.visualVibe`.
 *
 * Each sub-section is a self-contained card that degrades silently when
 * its slice of the data is missing (older company records, research
 * that failed partway). Styles are inline / Tailwind; the goal is to
 * SHOW the tokens, not re-theme the Ekoa UI with them.
 */
"use client";

import { useTranslation } from "@/stores/i18n";
import { Card as UiCard } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Sparkles } from "lucide-react";

// ============================================
// Types mirroring the cortex StoredDesignSystem + VisualVibe shapes.
// Kept inline here (not in /types) because they're only used by this
// view — if more pages grow to consume them, promote to /types.
// ============================================

export interface StoredDesignSystem {
  logo: {
    url?: string;
    background?: string;
    width?: number | null;
    height?: number | null;
  } | null;
  palette: Array<{
    hex: string;
    count: number;
    confidence: "high" | "medium" | "low";
    sources: string[];
  }>;
  cssVariables: Array<{ name: string; value: string }>;
  typography: {
    families: string[];
    styles: Array<{
      role?: string;
      fontFamily?: string;
      fontSize?: string;
      fontWeight?: string;
      lineHeight?: string;
    }>;
  };
  spacing: {
    scaleType?: string;
    values: Array<{ px: string; count: number }>;
  };
  borderRadius: {
    values: Array<{ value: string; count: number }>;
    shapeLanguage: string;
  };
  shadows: Array<{ shadow: string; count: number }>;
  primaryButton: Record<string, string> | null;
  frameworks: string[];
}

export interface VisualVibe {
  mood: string;
  bullets: string[];
  shape: string;
  density: string;
  texture: string;
  hero: string;
}

// ============================================
// Top-level tab
// ============================================

export function DesignSystemTab({
  designSystem,
  visualVibe,
}: {
  designSystem: StoredDesignSystem | null;
  visualVibe: VisualVibe | null;
}) {
  const { pages } = useTranslation();
  const b = pages.branding;

  if (!designSystem && !visualVibe) {
    return <EmptyState icon={Sparkles} title={b.noDesignSystem} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500 leading-relaxed max-w-3xl">
        {b.designSystemDescription}
      </p>

      {visualVibe && <VisualVibeCard vibe={visualVibe} labels={b} />}

      {designSystem && (
        <>
          {designSystem.palette.length > 0 && <PaletteCard items={designSystem.palette} label={b.palette} />}
          {designSystem.cssVariables.length > 0 && (
            <CssVariablesCard items={designSystem.cssVariables} label={b.cssVariables} />
          )}
          {designSystem.typography.families.length > 0 && (
            <TypographyCard typography={designSystem.typography} label={b.typography} fontFamilyLabel={b.fontFamily} />
          )}
          {designSystem.spacing.values.length > 0 && (
            <SpacingCard spacing={designSystem.spacing} label={b.spacing} />
          )}
          {designSystem.borderRadius.values.length > 0 && (
            <RadiusCard
              radius={designSystem.borderRadius}
              label={b.borderRadius}
              shapeLabel={b.shapeLanguage}
            />
          )}
          {designSystem.shadows.length > 0 && (
            <ShadowsCard shadows={designSystem.shadows} label={b.shadows} />
          )}
          {designSystem.primaryButton && (
            <PrimaryButtonCard button={designSystem.primaryButton} label={b.primaryButton} />
          )}
          {designSystem.frameworks.length > 0 && (
            <FrameworksCard frameworks={designSystem.frameworks} label={b.frameworks} />
          )}
        </>
      )}
    </div>
  );
}

// ============================================
// Individual cards
// ============================================

function SectionHeader({ title }: { title: string }) {
  return <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">{title}</h3>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <UiCard>{children}</UiCard>;
}

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const tone: BadgeTone = confidence === "high" ? "success" : confidence === "medium" ? "warning" : "neutral";
  return <Badge tone={tone}>{confidence}</Badge>;
}

function PaletteCard({
  items,
  label,
}: {
  items: StoredDesignSystem["palette"];
  label: string;
}) {
  return (
    <Card>
      <SectionHeader title={label} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((c) => (
          <div key={c.hex} className="flex items-center gap-3 min-w-0">
            <div
              className="w-11 h-11 rounded-md border border-neutral-200 shrink-0"
              style={{ backgroundColor: c.hex }}
              aria-label={c.hex}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <code className="text-xs font-mono text-neutral-800">{c.hex}</code>
                <ConfidenceBadge confidence={c.confidence} />
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                {c.count}× · {c.sources.slice(0, 2).join(", ") || "—"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CssVariablesCard({
  items,
  label,
}: {
  items: StoredDesignSystem["cssVariables"];
  label: string;
}) {
  return (
    <Card>
      <SectionHeader title={label} />
      <div className="space-y-2">
        {items.map((v) => (
          <div key={v.name} className="flex items-center gap-3">
            {v.value.startsWith("#") || v.value.startsWith("rgb") ? (
              <div
                className="w-5 h-5 rounded border border-neutral-200 shrink-0"
                style={{ backgroundColor: v.value }}
              />
            ) : (
              <div className="w-5 h-5 shrink-0" />
            )}
            <code className="text-xs font-mono text-neutral-700 truncate flex-1">{v.name}</code>
            <code className="text-xs font-mono text-neutral-500 shrink-0">{v.value}</code>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TypographyCard({
  typography,
  label,
  fontFamilyLabel,
}: {
  typography: StoredDesignSystem["typography"];
  label: string;
  fontFamilyLabel: string;
}) {
  return (
    <Card>
      <SectionHeader title={label} />
      <div className="mb-4">
        <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1.5">{fontFamilyLabel}</p>
        <div className="flex flex-wrap gap-2">
          {typography.families.map((f) => (
            <span
              key={f}
              className="inline-block text-xs px-2 py-1 bg-neutral-100 border border-neutral-200 rounded text-neutral-700"
              style={{ fontFamily: `"${f}", system-ui, sans-serif` }}
            >
              {f}
            </span>
          ))}
        </div>
      </div>
      {typography.styles.length > 0 && (
        <div className="space-y-2 border-t border-neutral-100 pt-3">
          {typography.styles.slice(0, 5).map((s, i) => (
            <div key={i} className="flex items-baseline gap-3 text-xs text-neutral-600">
              <span className="text-neutral-400 shrink-0 min-w-[60px]">{s.role || `style ${i + 1}`}</span>
              <span className="text-neutral-500 font-mono">
                {s.fontSize || "—"} / {s.fontWeight || "—"}
                {s.lineHeight ? ` · ${s.lineHeight}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SpacingCard({
  spacing,
  label,
}: {
  spacing: StoredDesignSystem["spacing"];
  label: string;
}) {
  // Cap the visual bar at 64px so a 120px value doesn't break the layout.
  const maxPx = 64;
  return (
    <Card>
      <SectionHeader title={label} />
      {spacing.scaleType && (
        <p className="text-[11px] text-neutral-500 mb-3">
          Base unit: <code className="font-mono text-neutral-700">{spacing.scaleType}</code>
        </p>
      )}
      <div className="space-y-1.5">
        {spacing.values.map((s) => {
          const num = parseFloat(s.px);
          const width = Math.max(4, Math.min(maxPx, Number.isFinite(num) ? num : 4));
          return (
            <div key={s.px} className="flex items-center gap-3 text-xs">
              <code className="font-mono text-neutral-700 w-14 shrink-0">{s.px}</code>
              <div
                className="h-2.5 bg-teal-500 rounded-sm"
                style={{ width: `${width}px` }}
                aria-hidden
              />
              {s.count > 0 && <span className="text-neutral-400">{s.count}×</span>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RadiusCard({
  radius,
  label,
  shapeLabel,
}: {
  radius: StoredDesignSystem["borderRadius"];
  label: string;
  shapeLabel: string;
}) {
  return (
    <Card>
      <SectionHeader title={label} />
      <p className="text-[11px] text-neutral-500 mb-3">
        {shapeLabel}:{" "}
        <span className="text-neutral-700 font-medium">{radius.shapeLanguage}</span>
      </p>
      <div className="flex flex-wrap gap-3">
        {radius.values.map((r) => {
          // Sanitize the radius so wonky values like "3.35e+07px" don't blow
          // the layout. Cap at 32px visually while preserving the label.
          const parsed = parseFloat(r.value);
          const visualRadius = Number.isFinite(parsed) ? Math.min(32, Math.max(0, parsed)) : 0;
          return (
            <div key={r.value} className="flex flex-col items-center gap-1">
              <div
                className="w-14 h-14 bg-teal-500 border border-teal-600"
                style={{ borderRadius: `${visualRadius}px` }}
                aria-hidden
              />
              <code className="text-[11px] font-mono text-neutral-600">{r.value}</code>
              <span className="text-[10px] text-neutral-400">{r.count}×</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ShadowsCard({
  shadows,
  label,
}: {
  shadows: StoredDesignSystem["shadows"];
  label: string;
}) {
  return (
    <Card>
      <SectionHeader title={label} />
      <div className="flex flex-wrap gap-4">
        {shadows.map((s, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div
              className="w-16 h-16 bg-white rounded-md border border-neutral-100"
              style={{ boxShadow: s.shadow }}
              aria-hidden
            />
            <span className="text-[10px] text-neutral-400">{s.count}×</span>
          </div>
        ))}
      </div>
      {shadows[0] && (
        <code className="block mt-3 text-[10px] font-mono text-neutral-400 truncate">
          {shadows[0].shadow}
        </code>
      )}
    </Card>
  );
}

function PrimaryButtonCard({
  button,
  label,
}: {
  button: Record<string, string>;
  label: string;
}) {
  const style: React.CSSProperties = {
    backgroundColor: button.backgroundColor || "transparent",
    color: button.color || "inherit",
    borderRadius: button.borderRadius || "0",
    padding: button.padding || "8px 16px",
    border: button.border || "none",
    boxShadow: button.boxShadow && button.boxShadow !== "none" ? button.boxShadow : undefined,
  };
  return (
    <Card>
      <SectionHeader title={label} />
      <div className="flex flex-col md:flex-row items-start gap-5">
        <div className="bg-neutral-50 border border-neutral-200 rounded-md p-6 flex items-center justify-center min-w-[180px]">
          <span style={style} className="font-medium text-sm">
            Call to action
          </span>
        </div>
        <div className="flex-1 min-w-0 space-y-1 text-xs font-mono text-neutral-500 break-all">
          {Object.entries(button).map(([k, v]) => (
            <div key={k}>
              <span className="text-neutral-400">{k}:</span> <span className="text-neutral-700">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function FrameworksCard({ frameworks, label }: { frameworks: string[]; label: string }) {
  return (
    <Card>
      <SectionHeader title={label} />
      <div className="flex flex-wrap gap-2">
        {frameworks.map((f) => (
          <Badge key={f} tone="info">
            {f}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

function VisualVibeCard({
  vibe,
  labels,
}: {
  vibe: VisualVibe;
  labels: {
    visualVibe: string;
    mood: string;
    shape: string;
    density: string;
    texture: string;
    hero: string;
  };
}) {
  return (
    <Card>
      <SectionHeader title={labels.visualVibe} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <VibeStat label={labels.mood} value={vibe.mood} highlight />
        <VibeStat label={labels.shape} value={vibe.shape} />
        <VibeStat label={labels.density} value={vibe.density} />
        <VibeStat label={labels.texture} value={vibe.texture} />
      </div>
      <div className="text-xs text-neutral-600 mb-3">
        <span className="text-neutral-400 mr-1.5">{labels.hero}:</span>
        <span className="text-neutral-700">{vibe.hero}</span>
      </div>
      {vibe.bullets.length > 0 && (
        <ul className="space-y-1 text-xs text-neutral-600 list-disc pl-5">
          {vibe.bullets.slice(0, 5).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function VibeStat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-md border p-2.5 ${
        highlight ? "bg-teal-50 border-teal-200" : "bg-neutral-50 border-neutral-200"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${highlight ? "text-teal-800" : "text-neutral-800"}`}>
        {value}
      </div>
    </div>
  );
}
