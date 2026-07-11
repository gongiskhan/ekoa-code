/**
 * Browser -> daemon loopback client (run s4; D2). FC-406/FC-407 are explicit: grants and
 * the egress ledger are served LIVE by the ekoa-bridge daemon on 127.0.0.1 and rendered
 * straight from it — they NEVER transit or persist hosted-side (paths are sensitive;
 * ch18 §18.2). The browser therefore fetches the daemon's loopback surface directly.
 *
 * Counterpart contract (docs/bridge-counterpart-changes.md): C1 gives the surface a stable
 * default port (proposed 8791, overridable via NEXT_PUBLIC_BRIDGE_LOCAL_ORIGIN — the same
 * origin is added to the dashboard CSP connect-src in next.config.ts); C2 adds CORS for the
 * app origins (bind stays 127.0.0.1-only); C3 adds GET /grants + POST /grants/revoke.
 * GET /status and GET /ledger?session= exist in the daemon today. Against a daemon that
 * predates C1-C3 every call here fails fast and the sections render their honest
 * unavailable states — never fabricated data (§12.6).
 *
 * Responses are zod-parsed (tolerant: passthrough + row-level salvage) against the wire
 * shapes vendored from the daemon's ledger contract (ekoa-bridge src/ledger/ledger.ts,
 * §18.5.1). Rows this client cannot parse are dropped and counted, never invented.
 */
import { z } from 'zod';

/** Proposed C1 default port for the daemon loopback surface. Keep in sync with the literal
 *  in next.config.ts (the config cannot import app code at CSP-build time). */
export const BRIDGE_LOCAL_ORIGIN =
  process.env.NEXT_PUBLIC_BRIDGE_LOCAL_ORIGIN ?? 'http://127.0.0.1:8791';

const TIMEOUT_MS = 2_500;

// -- wire shapes (vendored, tolerant) ------------------------------------------------------

export const DaemonGrant = z
  .object({
    grantRef: z.string(),
    label: z.string().optional(),
    path: z.string().optional(),
    scope: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type DaemonGrant = z.infer<typeof DaemonGrant>;

const GrantsResponse = z.object({ grants: z.array(z.unknown()) }).passthrough();

/** The daemon ledger row union (read/denial/write/cap_consent/automation), discriminated
 *  on `kind`; unknown kinds survive as `unknown` rows rather than breaking the viewer. */
export const DaemonLedgerRow = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('read'),
      ts: z.string(),
      session: z.string(),
      path: z.string(),
      byteRange: z.string(),
      bytesOut: z.number(),
      tool: z.string(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal('denial'),
      ts: z.string(),
      reason: z.string(),
      principle: z.string(),
      tool: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal('write'),
      ts: z.string(),
      session: z.string(),
      path: z.string(),
      bytesWritten: z.number(),
      tool: z.string(),
    })
    .passthrough(),
  z.object({ kind: z.literal('cap_consent'), ts: z.string(), previousBudget: z.number(), newBudget: z.number() }).passthrough(),
  z
    .object({
      kind: z.literal('automation'),
      ts: z.string(),
      tool: z.string(),
      detail: z.string(),
      outcome: z.string(),
    })
    .passthrough(),
]);
export type DaemonLedgerRow = z.infer<typeof DaemonLedgerRow>;

const LedgerResponse = z.object({ session: z.string(), rows: z.array(z.unknown()), corrupt: z.unknown().optional() }).passthrough();

// -- transport -----------------------------------------------------------------------------

/** Thrown for every failure mode (unreachable, CORS-blocked, non-2xx, bad shape): the
 *  sections render ONE honest unavailable state; the cause stays in the error for logs. */
export class BridgeLocalUnavailable extends Error {
  constructor(cause: string) {
    super(`bridge local surface unavailable: ${cause}`);
    this.name = 'BridgeLocalUnavailable';
  }
}

async function daemonFetch(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRIDGE_LOCAL_ORIGIN}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new BridgeLocalUnavailable(`status ${res.status}`);
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof BridgeLocalUnavailable) throw err;
    throw new BridgeLocalUnavailable(err instanceof Error ? err.message : 'fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

/** GET /grants (C3). Unparseable grant entries are dropped, never invented. */
export async function fetchDaemonGrants(): Promise<DaemonGrant[]> {
  const body = GrantsResponse.safeParse(await daemonFetch('/grants'));
  if (!body.success) throw new BridgeLocalUnavailable('grants shape');
  return body.data.grants
    .map((g) => DaemonGrant.safeParse(g))
    .filter((r): r is { success: true; data: DaemonGrant } => r.success)
    .map((r) => r.data);
}

/** POST /grants/revoke (C3). Effective on the next tool call, not retroactive (§12.6.3). */
export async function revokeDaemonGrant(grantRef: string): Promise<void> {
  await daemonFetch('/grants/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantRef }),
  });
}

/** A picker/typed-input result: the daemon-minted session grant + its display label. */
export const ReferencePick = z.object({ grantRef: z.string().min(1), label: z.string().min(1) }).passthrough();
export type ReferencePick = z.infer<typeof ReferencePick>;

/**
 * POST /picker (C4, the largest counterpart item): the daemon opens its native OS dialog,
 * mints a session grant for the chosen path and returns `{grantRef, label}`. Returns
 * 'unavailable' when the daemon predates C4 (or the user is offline) — the composer then
 * falls back to the typed-reference input (the brief's pre-authorized fallback), and
 * 'cancelled' when the daemon reports the user dismissed the dialog.
 */
export async function openDaemonPicker(): Promise<ReferencePick | 'unavailable' | 'cancelled'> {
  try {
    // A native OS dialog stays open until the user decides — give it minutes, not the
    // read timeout.
    const body = await daemonFetch('/picker', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 5 * 60_000);
    if (typeof body === 'object' && body !== null && (body as { cancelled?: unknown }).cancelled === true) return 'cancelled';
    const parsed = ReferencePick.safeParse(body);
    return parsed.success ? parsed.data : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export interface DaemonLedger {
  rows: DaemonLedgerRow[];
  /** Rows served by the daemon that this client could not parse (shown as a count, honest). */
  unparseable: number;
}

/** GET /ledger?session= (exists in the daemon today; needs C1+C2 to be browser-reachable). */
export async function fetchDaemonLedger(session: string): Promise<DaemonLedger> {
  const body = LedgerResponse.safeParse(await daemonFetch(`/ledger?session=${encodeURIComponent(session)}`));
  if (!body.success) throw new BridgeLocalUnavailable('ledger shape');
  let unparseable = 0;
  const rows: DaemonLedgerRow[] = [];
  for (const raw of body.data.rows) {
    const parsed = DaemonLedgerRow.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
    else unparseable += 1;
  }
  return { rows, unparseable };
}
