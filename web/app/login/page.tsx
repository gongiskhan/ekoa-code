"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff, User, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/stores/auth";
import { resolveBaseUrl } from "@/lib/api/base-url";
import { useTranslation } from "@/stores/i18n";
import { useVerticalProfile } from "@/lib/verticals";

// Petrol backdrop shared by the auth screens (login + change-password): a deep
// teal-950 field, one oversized hexagon outline watermark (echoing the Ekoa
// logo geometry, off-canvas right) and a single soft amber radial glow. No
// grid, no orbs, no glassmorphism — the document card carries the light UI.
function AuthBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-teal-950 p-4">
      <svg
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/2 h-[820px] w-[820px] -translate-y-1/2 text-white/[0.04]"
        viewBox="0 0 100 100"
        fill="none"
      >
        <polygon
          points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5"
          stroke="currentColor"
          strokeWidth="0.7"
        />
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[140px]"
        style={{ background: "var(--color-brand-amber)", opacity: 0.03 }}
      />
      {children}
    </div>
  );
}

// Validate `next`: allow either a relative path, or an absolute URL whose
// origin matches the cortex API. Anything else is treated as an open-redirect
// attempt and discarded.
function safeNextUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw);
    // Resolve the API origin through the single base-URL resolver (crit 5), never a raw env read.
    let apiOrigin: string | null = null;
    try {
      const base = resolveBaseUrl();
      apiOrigin = base ? new URL(base).origin : (typeof window !== "undefined" ? window.location.origin : null);
    } catch {
      apiOrigin = null;
    }
    if (apiOrigin && parsed.origin === apiOrigin) return parsed.toString();
  } catch {
    /* fall through */
  }
  return null;
}

function navigateToNext(router: ReturnType<typeof useRouter>, next: string, token: string | null) {
  // Relative path: stay in the SPA.
  if (next.startsWith("/")) {
    router.push(next);
    return;
  }
  // Absolute, validated cross-origin URL (cortex). Cortex auth on /build/:slug
  // accepts ?token=, so append it — the SPA token doesn't carry across origins.
  const url = new URL(next);
  if (token) url.searchParams.set("token", token);
  window.location.href = url.toString();
}

// Next 16's prerenderer requires a Suspense boundary around any client
// component that calls useSearchParams(); without it the build errors out
// with "useSearchParams() should be wrapped in a suspense boundary at page".
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    login,
    isAuthenticated,
    isLoading,
    error,
    errorCode,
    clearError,
    passwordChangeRequired,
    hasHydrated,
    token,
  } = useAuthStore();

  const { pages } = useTranslation();
  const profile = useVerticalProfile();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const nextParam = safeNextUrl(searchParams.get("next"));

  // FC-508: the CONV-2 activation codes render their dedicated PT-PT copy on
  // login; any other failure shows the server-provided (already PT-aware) message.
  const ACTIVATION_COPY: Record<string, string> = {
    ACCOUNT_DISABLED: "A sua conta está bloqueada. Contacte o suporte.",
    BILLING_LOCKED: "A sua conta tem um problema de faturação. Contacte o suporte.",
  };
  const displayError = error
    ? (errorCode ? ACTIVATION_COPY[errorCode] : undefined) ?? error
    : null;

  const redirectAfterAuth = useCallback(
    (latestToken: string | null) => {
      if (passwordChangeRequired) {
        // Carry `next` through the forced password change so flows that login
        // *into* a destination (e.g. the TUI device /activate page) resume after
        // the change instead of being stranded on the dashboard.
        router.push(nextParam ? `/change-password?next=${encodeURIComponent(nextParam)}` : "/change-password");
        return;
      }
      if (nextParam) {
        navigateToNext(router, nextParam, latestToken);
        return;
      }
      router.push("/");
    },
    [router, passwordChangeRequired, nextParam],
  );

  // Redirect if already authenticated
  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      redirectAfterAuth(token);
    }
  }, [hasHydrated, isAuthenticated, token, redirectAfterAuth]);

  // Clear error on input change
  useEffect(() => {
    if (error) {
      clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;

    const success = await login(username, password, rememberMe);
    if (success) {
      // The login action sets `token` in the auth store synchronously, so
      // read it back to attach to cross-origin redirects below.
      redirectAfterAuth(useAuthStore.getState().token);
    }
  }

  return (
    <AuthBackdrop>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[400px] relative z-10"
      >
        {/* White document card */}
        <div
          data-testid="login-card"
          className="bg-surface rounded-2xl shadow-overlay p-8"
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <Image
              src="/ekoa_logo.png"
              alt="Ekoa"
              width={48}
              height={48}
              className="object-contain"
              priority
            />
            <h1
              className="mt-4 font-display text-2xl font-semibold tracking-tight text-neutral-900"
              style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
            >
              {pages.login.title}
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              {pages.login.subtitle}
            </p>
          </div>

          {/* Error */}
          {displayError && (
            <div
              data-testid="login-error"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-600"
            >
              {displayError}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={pages.login.username}
              leftIcon={User}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={pages.login.usernamePlaceholder}
              required
              disabled={isLoading}
              autoComplete="username"
              autoFocus
            />

            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-neutral-600">
                {pages.login.password}
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                  aria-hidden
                />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={pages.login.passwordPlaceholder}
                  className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-10 text-sm text-neutral-900 placeholder-neutral-400 focus-ring focus:border-teal-500"
                  required
                  disabled={isLoading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer p-0.5 text-neutral-400 transition-colors hover:text-neutral-600"
                  aria-label={showPassword ? pages.login.hidePassword : pages.login.showPassword}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember me + Forgot password row */}
            <div className="flex items-center justify-between pt-1">
              <Checkbox
                checked={rememberMe}
                onChange={setRememberMe}
                disabled={isLoading}
                label={pages.login.rememberMe}
              />
              <Link
                href="/change-password"
                className="text-xs text-neutral-500 transition-colors hover:text-teal-700"
              >
                {pages.login.forgotPassword}
              </Link>
            </div>

            {/* Sign In button */}
            <Button
              type="submit"
              variant="primary"
              loading={isLoading}
              disabled={isLoading || !username || !password}
              className="mt-2 w-full justify-center"
            >
              {pages.login.signIn}
            </Button>
          </form>
        </div>

        {/* Version / tagline — vertical skin overrides the generic positioning line */}
        <p className="mt-6 text-center text-[11px] text-teal-200/50">
          {profile.loginTagline}
        </p>
      </motion.div>
    </AuthBackdrop>
  );
}
