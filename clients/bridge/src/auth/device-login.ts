/**
 * auth/device-login.ts — OAuth 2.0 Device Authorization Grant (RFC 8628-style) against ekoa-code's
 * auth routes, to obtain the daemon's durable platform credential during `pair`.
 *
 * Provenance: PORTED (copy-with-review) from the archived Bun-era `ekoa-local/src/auth/device-login.ts`
 * (`runDeviceLogin` poll loop, `decodeJwtExpiryMs`, injectable fetch/clock/sleep). Rewritten for Node
 * and for ekoa-code's REST device routes (the archive spoke the `ekoa.auth` app/intent envelope; these
 * are the plain routes read from `ekoa-code/api/src/routes/auth.ts` + `.../auth/device.ts`):
 *   POST /api/v1/auth/device        -> { deviceCode, userCode, verificationUri, interval, expiresIn }
 *   POST /api/v1/auth/device/poll   { deviceCode } -> { status: pending | slow_down | denied | expired }
 *                                                    | { status: approved, token, user, expiresIn }
 * `verificationUri` is a PATH relative to the Cortex base (e.g. `/settings/devices`); we join it.
 *
 * Pure + injectable: HTTP is an injectable `fetch`; the clock and sleep are injectable so the poll
 * loop is testable without real waits. Every user-facing message routes through src/i18n/pt.ts.
 */
import { pt } from '../i18n/pt.js';
import type { PlatformCredentials } from './credentials.js';

/** Fallback credential lifetime if the server sends no `expiresIn` and the JWT has no `exp`. */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

/** The injectable HTTP surface (defaults to the global fetch). */
export type FetchLike = typeof fetch;

/** Machine-stable reasons for a login failure (the `.message` carries the PT-PT copy). */
export type DeviceLoginReason = 'start-failed' | 'poll-failed' | 'denied' | 'expired' | 'timeout' | 'aborted';

export class DeviceLoginError extends Error {
  constructor(
    readonly reason: DeviceLoginReason,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceLoginError';
  }
}

export interface DeviceLoginOptions {
  /** Cortex base URL (http/https). */
  cortexBaseUrl: string;
  /** Injectable HTTP; defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Surface the code + verification URL to the user (the CLI prints the PT-PT prompt). */
  onPrompt?: (userCode: string, verificationUrl: string) => void;
  /** Injectable for tests (defaults: real setTimeout / Date.now). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

type DevicePollResponse =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'approved'; token: string; user?: PlatformCredentials['user']; expiresIn?: number };

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Decode a JWT's `exp` (seconds) into epoch ms, or null when undecodable (port of the archive). */
export function decodeJwtExpiryMs(jwt: string): number | null {
  const parts = jwt.split('.');
  const payloadPart = parts.length === 3 ? parts[1] : undefined;
  if (!payloadPart) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Join a (possibly relative) verificationUri onto the Cortex base. Absolute URIs pass through. */
function verificationUrl(cortexBaseUrl: string, verificationUri: string): string {
  if (/^https?:\/\//i.test(verificationUri)) return verificationUri;
  return `${cortexBaseUrl.replace(/\/+$/, '')}${verificationUri.startsWith('/') ? '' : '/'}${verificationUri}`;
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  let json: unknown = undefined;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body — caller decides based on res.ok/status */
  }
  return { ok: res.ok, status: res.status, json };
}

function credFromToken(token: string, expiresInSec: number | undefined, now: number, user?: PlatformCredentials['user']): PlatformCredentials {
  const expires =
    typeof expiresInSec === 'number' && expiresInSec > 0
      ? now + expiresInSec * 1000
      : (decodeJwtExpiryMs(token) ?? now + DEFAULT_TTL_MS);
  return { access: token, refresh: token, expires, ...(user ? { user } : {}) };
}

/**
 * Run the device-login flow end to end. Resolves with the platform credential once the user approves
 * in the browser; rejects with a DeviceLoginError (PT-PT message) on denial, code expiry, timeout, or
 * abort. Transient poll failures (network blips) are tolerated and retried until the deadline.
 */
export async function runDeviceLogin(opts: DeviceLoginOptions): Promise<PlatformCredentials> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const { signal } = opts;
  const base = opts.cortexBaseUrl.replace(/\/+$/, '');

  if (signal?.aborted) throw new DeviceLoginError('aborted', pt.deviceAborted);

  // The device-start POST is guarded like every other call: a network-level failure (DNS/ECONNREFUSED)
  // or an abort mid-flight must surface as a typed DeviceLoginError with PT-PT copy — NOT a raw
  // TypeError/AbortError, which pair.ts rethrows and main() has no handler for (English stack trace
  // instead of the PT-PT message + exit 1). Status 0 marks "no HTTP response" (a transport failure).
  let startRes: { ok: boolean; status: number; json: unknown };
  try {
    startRes = await postJson(fetchImpl, `${base}/api/v1/auth/device`, {}, signal);
  } catch {
    if (signal?.aborted) throw new DeviceLoginError('aborted', pt.deviceAborted);
    throw new DeviceLoginError('start-failed', pt.deviceStartFailed(0));
  }
  if (!startRes.ok || !isStart(startRes.json)) {
    throw new DeviceLoginError('start-failed', pt.deviceStartFailed(startRes.status));
  }
  const start = startRes.json;

  opts.onPrompt?.(start.userCode, verificationUrl(base, start.verificationUri));

  let intervalMs = Math.max(1, start.interval || 5) * 1000;
  const deadline = now() + Math.max(30, start.expiresIn || 600) * 1000;

  while (now() < deadline) {
    if (signal?.aborted) throw new DeviceLoginError('aborted', pt.deviceAborted);
    await sleep(intervalMs);
    if (signal?.aborted) throw new DeviceLoginError('aborted', pt.deviceAborted);

    let poll: { ok: boolean; status: number; json: unknown };
    try {
      poll = await postJson(fetchImpl, `${base}/api/v1/auth/device/poll`, { deviceCode: start.deviceCode }, signal);
    } catch {
      if (signal?.aborted) throw new DeviceLoginError('aborted', pt.deviceAborted);
      continue; // transient network error — keep polling until the deadline
    }
    if (!poll.ok || !isPoll(poll.json)) continue; // treat a bad response as transient

    switch (poll.json.status) {
      case 'approved':
        if (poll.json.token) return credFromToken(poll.json.token, poll.json.expiresIn, now(), poll.json.user);
        break; // approved but tokenless (shouldn't happen) — keep polling
      case 'slow_down':
        intervalMs += 5_000; // RFC 8628: back off by the poll interval on slow_down
        break;
      case 'denied':
        throw new DeviceLoginError('denied', pt.deviceDenied);
      case 'expired':
        throw new DeviceLoginError('expired', pt.deviceExpired);
      default:
        break; // 'pending' — keep polling
    }
  }
  throw new DeviceLoginError('timeout', pt.deviceTimeout);
}

function isStart(v: unknown): v is DeviceStartResponse {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.deviceCode === 'string' && typeof o.userCode === 'string' && typeof o.verificationUri === 'string';
}

function isPoll(v: unknown): v is DevicePollResponse {
  if (typeof v !== 'object' || v === null) return false;
  return typeof (v as Record<string, unknown>).status === 'string';
}
