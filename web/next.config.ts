import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Resolve the cortex API URL at config-load time.
//
// Single source of truth: `../backend.port` written by garrison. We do
// NOT honor an inherited shell NEXT_PUBLIC_API_URL — past port drift
// came from stale env vars overriding the port files.
//
// In production builds the file isn't present; deployments are expected
// to set NEXT_PUBLIC_API_URL explicitly at build time, so we only enforce
// the file's presence in dev.
function resolveApiUrl(): string {
  const portFile = join(process.cwd(), "..", "backend.port");
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, "utf8").trim();
    if (/^\d+$/.test(port)) return `http://localhost:${port}`;
    throw new Error(`next.config.ts: ${portFile} contents invalid: '${port}'`);
  }
  // Production / CI path: an explicit env var is required.
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  throw new Error(
    `next.config.ts: ${portFile} not found and NEXT_PUBLIC_API_URL not set. ` +
      "Garrison should write backend.port for local dev; production builds " +
      "must pass NEXT_PUBLIC_API_URL via the build environment."
  );
}

// The vertical presentation profile for pre-auth surfaces. Declared here (not
// only in .env.local) because Turbopack compiles bare process.env.NEXT_PUBLIC_*
// reads in client modules to a runtime polyfill lookup, which is empty in the
// browser — config `env` entries are inlined reliably (same mechanism as
// NEXT_PUBLIC_API_URL above). Falls back to parsing .env.local so dev and
// explicit build envs behave identically.
function resolveVertical(): string {
  if (process.env.NEXT_PUBLIC_EKOA_VERTICAL) return process.env.NEXT_PUBLIC_EKOA_VERTICAL;
  const envFile = join(process.cwd(), ".env.local");
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8").match(/^NEXT_PUBLIC_EKOA_VERTICAL=(.*)$/m);
    if (match) return match[1].trim();
  }
  return "generic";
}

const nextConfig: NextConfig = {
  devIndicators: false,
  // Standalone output for the container image (Dockerfile.web sets NEXT_OUTPUT_STANDALONE=1):
  // emits `.next/standalone` with the traced server + minimal node_modules, so the runtime
  // image ships only what it needs. Off by default so dev/CI builds are unchanged.
  ...(process.env.NEXT_OUTPUT_STANDALONE ? { output: "standalone" as const } : {}),
  // Gate/CI builds can use an isolated dist dir so a `next build` never
  // corrupts a live dev server's .next incremental state.
  distDir: process.env.NEXT_BUILD_DIST_DIR || ".next",
  env: {
    NEXT_PUBLIC_API_URL: resolveApiUrl(),
    NEXT_PUBLIC_EKOA_VERTICAL: resolveVertical(),
  },
  // The single carried redirect (FC-100): `/settings` is a natural URL users
  // type. The other eight deleted stub routes had zero inbound links and get
  // no redirect.
  async redirects() {
    return [
      { source: "/settings", destination: "/settings/platform", permanent: false },
    ];
  },

  // Security-headers baseline for the dashboard (ch09 §9.8 D1, FIXED-14) — the web half of
  // D1; the api sets its own via composition-root middleware. A dashboard-scoped CSP (self +
  // the inline styles/scripts Next emits; connect to the API origin; frame-ancestors 'none'
  // so the authenticated dashboard cannot be framed by a served app or hostile origin), plus
  // HSTS / nosniff / referrer / X-Frame-Options.
  async headers() {
    const apiOrigin = process.env.NEXT_PUBLIC_API_URL || "";
    const connectSrc = ["'self'", apiOrigin].filter(Boolean).join(" ");
    // Artifact thumbnails are served by the API (/artifact-screenshots, ch07 §7.11); in dev
    // that origin is http so the blanket `https:` does not cover it — allow it explicitly.
    const imgSrc = ["'self'", "data:", "blob:", "https:", apiOrigin].filter(Boolean).join(" ");
    // The artifact preview overlay frames the API's /apps/* plane (cross-origin). Framing is
    // two-sided: the api allowlists the dashboard via frame-ancestors, and the dashboard must
    // allow the api as a frame SOURCE here (no frame-src = default-src 'self' = blocked).
    const frameSrc = ["'self'", apiOrigin].filter(Boolean).join(" ");
    // Next's dev server (fast-refresh/HMR) and the webpack runtime evaluate code via eval, so
    // 'unsafe-eval' is required for the app to run; 'unsafe-inline' covers Next's inline
    // bootstrap. Websocket dev-HMR needs ws: in connect-src. The security-load-bearing directives
    // here are frame-ancestors 'none' (anti-clickjacking, the D1 requirement) + base-uri 'none';
    // script tightening to nonces is a certification-phase hardening (§9.9), not this run.
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    const connect = isDev ? `connect-src ${connectSrc} ws: wss:` : `connect-src ${connectSrc}`;
    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      `img-src ${imgSrc}`,
      `frame-src ${frameSrc}`,
      "font-src 'self' data:",
      connect,
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
