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
};

export default nextConfig;
