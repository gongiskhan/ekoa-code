/**
 * Browser -> daemon loopback client (runs s4 + 20260711-111952 s4; D2). FC-406/FC-407 are
 * explicit: grants and the egress ledger are served LIVE by the ekoa-bridge daemon on
 * 127.0.0.1 and rendered straight from it — they NEVER transit or persist hosted-side
 * (paths are sensitive; ch18 §18.2). The browser therefore fetches the daemon's loopback
 * surface directly.
 *
 * The counterpart contract (docs/bridge-counterpart-changes.md C1–C3) is IMPLEMENTED in
 * the daemon since its 2026-07-11 run: stable port 8791 (overridable via
 * NEXT_PUBLIC_BRIDGE_LOCAL_ORIGIN — the same origin sits in the dashboard CSP connect-src,
 * next.config.ts), CORS for the app origins (bind stays 127.0.0.1-only), GET /grants +
 * POST /grants + POST /grants/revoke, GET /browse (the in-app picker read that replaced the
 * C4 native picker), and the all-sessions GET /ledger. Against an older daemon every call
 * here fails fast and the sections render their honest unavailable states — never
 * fabricated data (§12.6).
 *
 * Responses are zod-parsed (tolerant: passthrough + row-level salvage) against the wire
 * shapes vendored from the daemon's contract (ekoa-bridge src/surface/, src/ledger/).
 * Rows this client cannot parse are dropped and counted, never invented.
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
    session: z.string().optional(),
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

/** `session` is present on per-session reads and absent on the all-sessions merge. */
const LedgerResponse = z.object({ session: z.string().optional(), rows: z.array(z.unknown()), corrupt: z.unknown().optional() }).passthrough();

export const BrowseEntry = z
  .object({ name: z.string(), kind: z.enum(['dir', 'file']), size: z.number().optional() })
  .passthrough();
export type BrowseEntry = z.infer<typeof BrowseEntry>;

export const BrowseResult = z
  .object({ path: z.string(), parent: z.string().optional(), entries: z.array(z.unknown()), truncated: z.boolean().optional() })
  .passthrough();
export interface DaemonBrowse {
  path: string;
  parent?: string;
  entries: BrowseEntry[];
  truncated: boolean;
}

const CreatedGrant = z
  .object({
    grantRef: z.string(),
    path: z.string(),
    session: z.string(),
    label: z.string().optional(),
    requested: z.enum(['dir', 'file']).optional(),
  })
  .passthrough();
export type CreatedGrant = z.infer<typeof CreatedGrant>;

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

/** A minted reference the outgoing message carries: the daemon grant + its display label. */
export const ReferencePick = z.object({ grantRef: z.string().min(1), label: z.string().min(1) }).passthrough();
export type ReferencePick = z.infer<typeof ReferencePick>;

/**
 * A browser-dialog selection BEFORE minting (owner decision D3, 2026-07-11): picks are held
 * as pending tokens and minted into session grants only at SEND time, when the chat session
 * id actually exists — a brand-new chat has none until the first message. No grantRef is
 * typed or shown to the user at any point.
 */
export interface PendingReference {
  path: string;
  label: string;
  kind: 'dir' | 'file';
}

/** GET /browse — the in-app picker read (supersedes the C4 native picker). */
export async function browseDaemon(path?: string): Promise<DaemonBrowse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const body = BrowseResult.safeParse(await daemonFetch(`/browse${query}`));
  if (!body.success) throw new BridgeLocalUnavailable('browse shape');
  const entries = body.data.entries
    .map((e) => BrowseEntry.safeParse(e))
    .filter((r): r is { success: true; data: BrowseEntry } => r.success)
    .map((r) => r.data);
  return {
    path: body.data.path,
    ...(body.data.parent !== undefined ? { parent: body.data.parent } : {}),
    entries,
    truncated: body.data.truncated === true,
  };
}

/**
 * POST /grants — mint a session grant for a picked path (selection IS authorization, D2).
 * The daemon grants a FILE pick's parent folder and says so (`path` is the granted root).
 */
export async function createDaemonGrant(input: { path: string; session: string; label?: string }): Promise<CreatedGrant> {
  const body = CreatedGrant.safeParse(
    await daemonFetch('/grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  if (!body.success) throw new BridgeLocalUnavailable('grant shape');
  return body.data;
}

export interface DaemonLedger {
  rows: DaemonLedgerRow[];
  /** Rows served by the daemon that this client could not parse (shown as a count, honest). */
  unparseable: number;
}

/** GET /ledger — all sessions merged when `session` is omitted (the registo default view),
 *  or one session's rows with `?session=`. */
export async function fetchDaemonLedger(session?: string): Promise<DaemonLedger> {
  const query = session ? `?session=${encodeURIComponent(session)}` : '';
  const body = LedgerResponse.safeParse(await daemonFetch(`/ledger${query}`));
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
