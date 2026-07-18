"use client";
import React from "react";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  ArrowLeft,
  Lock,
  Check,
  X,
  ShieldCheck,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { useTranslation } from "@/stores/i18n";

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

function getPasswordStrength(password: string, levels: { label: string; barColor: string; textColor: string }[]) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const idx = Math.min(Math.max(Math.ceil(score / 1.5) - 1, 0), 3);
  return { score, ...levels[idx] };
}

function PasswordInput({
  label,
  value,
  onChange,
  show,
  onToggleShow,
  placeholder,
  error,
  disabled,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder: string;
  error?: string;
  disabled?: boolean;
  autoComplete?: string;
}) {
  const { pages } = useTranslation();
  const fieldId = React.useId();
  const errorId = `${fieldId}-error`;
  return (
    <div>
      <label htmlFor={fieldId} className="mb-1.5 block text-xs font-medium text-neutral-600">
        {label}
      </label>
      <div className="relative">
        <Lock
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          aria-hidden
        />
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-lg border bg-surface py-2 pl-9 pr-10 text-sm text-neutral-900 placeholder-neutral-400 focus-ring focus:border-teal-500 ${
            error ? "border-red-300" : "border-line"
          }`}
          required
          disabled={disabled}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer p-0.5 text-neutral-400 transition-colors hover:text-neutral-600"
          aria-label={show ? pages.login.hidePassword : pages.login.showPassword}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const {
    isAuthenticated,
    passwordChangeRequired,
    changePassword,
    isLoading,
    error,
    clearError,
    logout,
    hasHydrated,
  } = useAuthStore();
  const { pages } = useTranslation();
  const cp = pages.changePassword;

  const strengthLevels = [
    { label: cp.strengthWeak, barColor: "bg-red-500", textColor: "text-red-600" },
    { label: cp.strengthFair, barColor: "bg-amber-500", textColor: "text-amber-700" },
    { label: cp.strengthGood, barColor: "bg-teal-500", textColor: "text-teal-700" },
    { label: cp.strengthStrong, barColor: "bg-green-500", textColor: "text-green-600" },
  ];

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push("/login");
    }
  }, [hasHydrated, isAuthenticated, router]);

  // Clear errors on input change
  useEffect(() => {
    if (error || localError) {
      clearError();
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPassword, newPassword, confirmPassword]);

  const strength = useMemo(
    () => getPasswordStrength(newPassword, strengthLevels),
    [newPassword, strengthLevels],
  );

  const requirements = [
    { met: newPassword.length >= 8, label: cp.atLeast8Chars },
    { met: /[A-Z]/.test(newPassword), label: cp.oneUppercase },
    { met: /[a-z]/.test(newPassword), label: cp.oneLowercase },
    { met: /\d/.test(newPassword), label: cp.oneNumber },
  ];

  const passwordsMatch =
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    newPassword === confirmPassword;
  const showMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    requirements.every((r) => r.met) &&
    passwordsMatch &&
    currentPassword.length > 0 &&
    !success;

  const displayError = localError || error;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLocalError(null);
    setSuccess(false);

    // Validate: new password must differ from old
    if (currentPassword === newPassword) {
      setLocalError(cp.passwordMustDiffer);
      return;
    }

    const result = await changePassword(currentPassword, newPassword);

    if (result.success) {
      setSuccess(true);
      // Resume a `next` destination if login forwarded one here (e.g. the TUI
      // device /activate page). Only relative in-app paths are honored, to avoid
      // an open redirect. Read from the URL directly (client-only) so we don't
      // need a Suspense boundary for useSearchParams.
      const raw = new URLSearchParams(window.location.search).get("next");
      const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
      setTimeout(() => {
        router.push(next);
      }, 2000);
    }
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <AuthBackdrop>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[420px] relative z-10"
      >
        {/* White document card */}
        <div
          data-testid="change-password-card"
          className="bg-surface rounded-2xl shadow-overlay p-8"
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <ShieldCheck size={32} className="text-teal-600" />
            <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-neutral-900">
              {cp.title}
            </h1>
            {passwordChangeRequired ? (
              <p className="mt-1.5 text-sm text-amber-700">
                {cp.requiredSubtitle}
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-neutral-500">
                {cp.subtitle}
              </p>
            )}
          </div>

          {/* Success Message */}
          {success && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-600">
              <CheckCircle size={14} className="flex-shrink-0" />
              <span>{cp.passwordChanged}</span>
            </div>
          )}

          {/* Error */}
          {displayError && !success && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
              {displayError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <PasswordInput
              label={cp.currentPassword}
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrent}
              onToggleShow={() => setShowCurrent(!showCurrent)}
              placeholder={cp.currentPasswordPlaceholder}
              disabled={isLoading || success}
              autoComplete="current-password"
            />

            <div className="border-t border-line" />

            <div>
              <PasswordInput
                label={cp.newPassword}
                value={newPassword}
                onChange={setNewPassword}
                show={showNew}
                onToggleShow={() => setShowNew(!showNew)}
                placeholder={cp.newPasswordPlaceholder}
                disabled={isLoading || success}
                autoComplete="new-password"
              />

              {/* Strength meter */}
              {newPassword.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex space-x-1 flex-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                            i <= strength.score ? strength.barColor : "bg-neutral-200"
                          }`}
                        />
                      ))}
                    </div>
                    <span
                      className={`text-[11px] ml-3 font-medium ${strength.textColor}`}
                    >
                      {strength.label}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <PasswordInput
              label={cp.confirmPassword}
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirm}
              onToggleShow={() => setShowConfirm(!showConfirm)}
              placeholder={cp.confirmPasswordPlaceholder}
              error={showMismatch ? cp.passwordsMismatch : undefined}
              disabled={isLoading || success}
              autoComplete="new-password"
            />

            {/* Requirements */}
            {newPassword.length > 0 && (
              <div className="rounded-lg bg-neutral-50 p-3 space-y-2">
                {requirements.map((req) => (
                  <div
                    key={req.label}
                    className="flex items-center space-x-2 text-xs"
                  >
                    {req.met ? (
                      <Check size={13} className="text-teal-600 flex-shrink-0" />
                    ) : (
                      <X size={13} className="text-neutral-400 flex-shrink-0" />
                    )}
                    <span className={req.met ? "text-neutral-700" : "text-neutral-500"}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              variant="primary"
              loading={isLoading}
              disabled={!canSubmit || isLoading}
              className="w-full justify-center"
            >
              {cp.updatePassword}
            </Button>
          </form>

          {/* Bottom links */}
          <div className="text-center mt-6">
            {passwordChangeRequired ? (
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs text-neutral-500 transition-colors hover:text-red-600 cursor-pointer"
              >
                {cp.logOutInstead}
              </button>
            ) : (
              <Link
                href="/"
                className="text-xs text-neutral-500 transition-colors hover:text-teal-700 inline-flex items-center space-x-1"
              >
                <ArrowLeft size={12} />
                <span>{cp.backToDashboard}</span>
              </Link>
            )}
          </div>
        </div>

        {/* Version / tagline */}
        <p className="mt-6 text-center text-[11px] text-teal-200/50">
          {pages.login.version}
        </p>
      </motion.div>
    </AuthBackdrop>
  );
}
