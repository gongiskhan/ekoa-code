import { z } from 'zod';

/**
 * Terminal run-error vocabulary (ch12 white-label; closes finding `run-error-text-leak`).
 *
 * THE INVARIANT: user-facing error text is DERIVED FROM A CODE, never carried as prose from
 * the server. A run stream's `error` event has always been `{code, message}`, but `message`
 * was a free string and several producers filled it with `err.message` — so on 2026-08-10 a
 * user asking for a website got, as the agent's reply:
 *
 *   "credential expired and refresh failed: OAuth refresh not configured
 *    (LLM_OAUTH_REFRESH_URL + stored refresh token required)"
 *
 * The client-side guard (`web/lib/sanitize-error.ts`) is a DENYLIST of provider-leak
 * substrings; that string matches none of them, so it rendered verbatim. A denylist fails
 * OPEN for every internal string nobody thought of — which is every future one.
 *
 * This module is the fail-CLOSED replacement, and it lives in `shared/` so that the one
 * definition serves both sides without either importing the other (FIXED-1):
 *   - `api/` emits `{code, params?}`; the wire `message` is filled from THIS table, so a
 *     non-web API client still gets honest, safe text and never an exception string.
 *   - `web/` renders from `code` ALONE and never prints the server's `message`. An
 *     unrecognised code degrades to `UNKNOWN`'s text rather than to whatever the server said.
 *
 * Operators lose nothing: the real cause is logged server-side with the run id, latched onto
 * `GET /health` (`claudeAuth.lastRefreshError`, `lastProviderError`), and persisted on the
 * JobRecord. Honest inside, white-labelled outside (ch09 invariant 2).
 *
 * ADDING A CODE (Rule 7 — additive): add it to the enum and to BOTH text tables and
 * `RUN_ERROR_RETRYABLE`. The `satisfies Record<RunErrorCode, ...>` annotations make an
 * omission a compile error, and `shared/src/contract.test.ts` pins exhaustiveness.
 */
export const RunErrorCode = z.enum([
  /** Allowance exhausted or billing locked. Carries a `billingUrl` param. */
  'BILLING_BLOCKED',
  /** The platform's model credential is missing/expired/unrefreshable. Operator must act. */
  'AUTH_ERROR',
  /** The model provider refused or was unreachable for a non-auth reason. */
  'PROVIDER_UNAVAILABLE',
  /** A rate cap tripped (ours or upstream). */
  'RATE_LIMITED',
  /** The run exceeded its wall-clock budget. */
  'TIMEOUT',
  /** Catch-all adapter/transport failure. The default for an unclassified throw. */
  'ADAPTER_ERROR',
  /** The build ran but never reached the served app (F16 honest-completion gate). */
  'BUILD_UNFULFILLED',
  /** Post-build verification ran and failed. */
  'VERIFY_FAILED',
  /** The build ended in an inconsistent state with no terminal event of its own. */
  'PIPELINE_STUCK',
  /** A process restart abandoned an in-flight run (boot orphan sweep, ch05 §5.2.1). */
  'ORPHANED',
  /** Write permission on the target artifact was revoked between queue and execution. */
  'EDIT_FORBIDDEN',
  /** An automation run failed. */
  'RUN_FAILED',
  /** The client's event stream broke or stalled. Client-originated. */
  'STREAM_ERROR',
  /**
   * The fail-closed default. Any code this table does not know — an older server, a new
   * producer, a corrupted event — renders as this rather than as server-supplied prose.
   */
  'UNKNOWN',
]);
export type RunErrorCode = z.infer<typeof RunErrorCode>;

const CODES = new Set<string>(RunErrorCode.options);

/**
 * Whether re-running the SAME request could plausibly succeed. Drives the retry affordance:
 * `true` gets a "try again" button, `false` gets text only (retrying a revoked permission or
 * an exhausted allowance just fails again and reads as the product being broken).
 *
 * AUTH_ERROR is retryable=false ON PURPOSE: only an operator re-arming the credential fixes
 * it, and a retry button that always fails is worse than none.
 */
export const RUN_ERROR_RETRYABLE = {
  BILLING_BLOCKED: false,
  AUTH_ERROR: false,
  PROVIDER_UNAVAILABLE: true,
  RATE_LIMITED: true,
  TIMEOUT: true,
  ADAPTER_ERROR: true,
  BUILD_UNFULFILLED: true,
  VERIFY_FAILED: true,
  PIPELINE_STUCK: true,
  ORPHANED: true,
  EDIT_FORBIDDEN: false,
  RUN_FAILED: true,
  STREAM_ERROR: true,
  UNKNOWN: true,
} satisfies Record<RunErrorCode, boolean>;

/** The locales the product ships. PT is the default and the server's wire language. */
export type RunErrorLocale = 'pt' | 'en';

/**
 * The ONLY user-facing text for a failed run. Constraints every string here must satisfy:
 *   - no engine identity (never Claude/Anthropic/Sonnet/Opus — ch12 white-label);
 *   - no internal vocabulary (no env var names, no "credential"/"OAuth"/"token", no §refs,
 *     no file paths, no HTTP status codes);
 *   - no model-derived text (a verifier note can quote app data — ch09 invariant 2);
 *   - says what happened and what the user can do, in the product's voice.
 * `{placeholder}` slots are filled from the event's `params`.
 */
export const RUN_ERROR_TEXT = {
  pt: {
    BILLING_BLOCKED: 'Não há saldo disponível para continuar. Consulte a faturação em {billingUrl}.',
    AUTH_ERROR:
      'O Agente EKOA está indisponível de momento por um problema de configuração do serviço. A equipa já foi alertada. Tente novamente mais tarde.',
    PROVIDER_UNAVAILABLE: 'O Agente EKOA está temporariamente indisponível. Tente novamente dentro de momentos.',
    RATE_LIMITED: 'Foram feitos demasiados pedidos em pouco tempo. Aguarde um momento e tente novamente.',
    TIMEOUT: 'O pedido demorou mais do que o esperado e foi interrompido. Tente novamente.',
    ADAPTER_ERROR: 'Não foi possível concluir o pedido. Tente novamente.',
    BUILD_UNFULFILLED: 'A construção não chegou a produzir a aplicação pedida. Tente de novo, descrevendo o que pretende com mais detalhe.',
    VERIFY_FAILED: 'A aplicação foi construída mas não passou na verificação. Tente novamente ou ajuste o pedido.',
    PIPELINE_STUCK: 'A construção terminou num estado inconsistente. Tente novamente.',
    ORPHANED: 'O pedido foi interrompido por uma reinicialização do serviço. Tente novamente.',
    EDIT_FORBIDDEN: 'Já não tem permissão para alterar esta aplicação.',
    RUN_FAILED: 'A execução não foi concluída. Tente novamente.',
    STREAM_ERROR: 'A ligação ao Agente EKOA foi interrompida. Tente novamente.',
    UNKNOWN: 'Algo correu mal. Tente novamente dentro de momentos.',
  },
  en: {
    BILLING_BLOCKED: 'There is no available balance to continue. Check billing at {billingUrl}.',
    AUTH_ERROR:
      'The EKOA Agent is unavailable right now due to a service configuration problem. The team has been alerted. Please try again later.',
    PROVIDER_UNAVAILABLE: 'The EKOA Agent is temporarily unavailable. Please try again in a moment.',
    RATE_LIMITED: 'Too many requests in a short time. Please wait a moment and try again.',
    TIMEOUT: 'The request took longer than expected and was interrupted. Please try again.',
    ADAPTER_ERROR: 'The request could not be completed. Please try again.',
    BUILD_UNFULFILLED: 'The build did not produce the app you asked for. Try again, describing what you want in more detail.',
    VERIFY_FAILED: 'The app was built but did not pass verification. Try again or adjust your request.',
    PIPELINE_STUCK: 'The build ended in an inconsistent state. Please try again.',
    ORPHANED: 'The request was interrupted by a service restart. Please try again.',
    EDIT_FORBIDDEN: 'You no longer have permission to change this app.',
    RUN_FAILED: 'The run did not complete. Please try again.',
    STREAM_ERROR: 'The connection to the EKOA Agent was interrupted. Please try again.',
    UNKNOWN: 'Something went wrong. Please try again in a moment.',
  },
} satisfies Record<RunErrorLocale, Record<RunErrorCode, string>>;

/**
 * Map ANY incoming code onto the known vocabulary. Unknown -> `UNKNOWN`: this is the hinge
 * the fail-closed property turns on, so it must never fall back to echoing its input.
 */
export function normalizeRunErrorCode(code: string | null | undefined): RunErrorCode {
  return code && CODES.has(code) ? (code as RunErrorCode) : 'UNKNOWN';
}

/** Locale resolution: anything that is not explicitly English gets PT (the product default). */
function resolveLocale(locale: string | null | undefined): RunErrorLocale {
  return (locale ?? 'pt').toLowerCase().startsWith('en') ? 'en' : 'pt';
}

/**
 * The user-facing sentence for a terminal run error.
 *
 * `params` fills `{placeholder}` slots. A slot with no matching param is REMOVED along with
 * any doubled spacing it leaves behind — a BILLING_BLOCKED event that arrives without a
 * `billingUrl` must read as a clean sentence, never as "…faturação em {billingUrl}.".
 */
export function runErrorText(
  code: string | null | undefined,
  locale?: string | null,
  params?: Record<string, string>,
): string {
  const template = RUN_ERROR_TEXT[resolveLocale(locale)][normalizeRunErrorCode(code)];
  return template
    .replace(/\{(\w+)\}/g, (_m, key: string) => params?.[key] ?? '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/** Whether the UI should offer a retry affordance for this code. Unknown codes are retryable. */
export function isRetryableRunError(code: string | null | undefined): boolean {
  return RUN_ERROR_RETRYABLE[normalizeRunErrorCode(code)];
}
