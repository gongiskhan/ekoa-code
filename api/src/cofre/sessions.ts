/**
 * cofre/sessions.ts — session items (Cofre WS-G).
 *
 * A captured Playwright `storageState` is CREDENTIAL-EQUIVALENT: it walks past the password AND the
 * MFA prompt. So I1-I4 apply to a session blob exactly as they do to a password — it is stored as a
 * Cofre item of type `session`, encrypted through the same org-bound envelope, read only through
 * `unwrap()`, and subject to the same grants, lock-now and lock-all.
 *
 * That is the whole point of putting sessions here rather than in a parallel store: before this,
 * `routes/integrations.ts` answered `available:false` while a shipped CITIUS integration asset
 * promised the user "O Ekoa captura a sessão autenticada (cookies) e guarda-a cifrada". Both were
 * true, and the combination was the finding: the product advertised a capability that did not
 * exist, and the encryption promise was false in either direction.
 *
 * SESSION METADATA (resolves former exploration task E5). An item records WHERE it was established
 * and what egress it was bound to, because a session is only reusable from a compatible vantage
 * point: replaying a residential-established session from a datacenter IP is exactly the pattern
 * portals flag. The router reads this at checkout (WS-I).
 */
import type { Actor, GrantDuration, SessionMetadata } from '@ekoa/shared';
import { hostMatchesOrigin } from '../security/origin-binding.js';
import { issueGrant, mintCofreItem, type CofreDeps } from './items.js';
import { cofreItems } from './store.js';
import type { CofreGrantDoc, CofreItemDoc } from './types.js';

/** How long a captured session is assumed good before it must be re-established or re-checked. */
export const DEFAULT_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * THE GRANT AN AD-HOC CAPTURED SESSION GETS (docs/decisions.md 2026-08-24, D-ADHOC-2).
 *
 * A session captured for an origin the user reached ad-hoc is bounded rather than standing. The
 * declared rail's `until_locked` is right for a portal someone deliberately connected: it is part of
 * their setup and ends when they revoke it. An UNDECLARED origin was reached once, from one goal,
 * and giving that a session that never expires by itself would quietly accumulate standing access to
 * every site a free-text run ever walked into.
 *
 * `2_weeks` and not `this_run`: `this_run` dies with the run that asked, and the run that asks is the
 * one that HALTED - it is re-dispatched as a NEW pass, so the grant would already be gone by the time
 * the session is needed, which reinstates the pause loop this whole lifecycle exists to end. It is
 * pinned to `DEFAULT_SESSION_TTL_MS` below so the grant and the item expire together; a grant
 * outliving its item is a live permission over nothing, and an item outliving its grant is a stored
 * credential nothing can use.
 */
export const ADHOC_SESSION_GRANT: GrantDuration = '2_weeks';

export interface CaptureSessionInput {
  /** The integration or portal this session belongs to — becomes the item label. */
  label: string;
  /** Hosts the session may be replayed against (I6). Derived from the captured cookies' domains. */
  boundOrigins: string[];
  /** The raw Playwright storageState. Encrypted immediately; never logged or returned. */
  storageState: unknown;
  metadata: SessionMetadata;
  ttlMs?: number;
}

/**
 * Store a captured session as a Cofre item.
 *
 * The blob is stringified and handed to `mintCofreItem`, which encrypts it through the org-bound
 * envelope — there is deliberately no separate session-encryption path, because a second path is a
 * second thing to get wrong and a second thing to audit.
 */
export async function captureSessionToCofre(
  actor: Actor,
  input: CaptureSessionInput,
  deps: { now?: () => number } = {},
): Promise<CofreItemDoc> {
  const now = deps.now?.() ?? Date.now();
  if (input.boundOrigins.length === 0) {
    // A session with no origin is unusable AND dangerous: it would be replayable anywhere the
    // caller chose. Fail at capture, where the reason is obvious.
    throw new Error('a captured session must declare the origins it may be replayed against (I6)');
  }
  const item = await mintCofreItem(
    actor,
    {
      type: 'session',
      label: input.label,
      value: JSON.stringify(input.storageState),
      boundOrigins: input.boundOrigins,
      expiresAt: new Date(now + (input.ttlMs ?? DEFAULT_SESSION_TTL_MS)).toISOString(),
    },
    deps,
  );
  await cofreItems.raw.update(item._id, (cur) => ({
    ...(cur as CofreItemDoc),
    sessionMetadata: input.metadata as unknown as Record<string, unknown>,
  }));
  return { ...item, sessionMetadata: input.metadata as unknown as Record<string, unknown> };
}

/**
 * Capture a session AND arm it for reuse, in one step. THE round-trip helper (Cofre G-4/G-5).
 *
 * WHY THIS EXISTS AS A SEPARATE FUNCTION. `mintCofreItem` issues no grant — deliberately, and the
 * security suite pins it ("a capture does not grant use"): a credential the USER hands over is
 * locked until the user unlocks it, and that is the whole consent model. A session this platform
 * ESTABLISHED is the one case where that would be circular: nobody typed the storageState in, it
 * exists only because the user already consented to the login that produced it, and leaving it
 * locked means the reuse path — the overwhelmingly common one, the one that must cost nothing —
 * fails closed on every run and re-logs-in instead. Re-logging-in against a portal with an unknown
 * lock-out policy is precisely the risk the at-most-once rule exists to avoid.
 *
 * SO: ESTABLISHING A SESSION IS THE CONSENT CEREMONY, and this is where that is written down. The
 * grant DEFAULTS to `until_locked` - the narrowest scope the model has that survives the run that
 * made it (`this_run` would expire before the next run and reinstate the re-login loop). Lock-now /
 * lock-all remain the kill switch, unchanged: the user revoking it is what ends the session's
 * usability, exactly as for a password.
 *
 * `options.grant` NARROWS that, and exists for exactly one caller: the ad-hoc adversarial ceremony,
 * which passes `ADHOC_SESSION_GRANT` (D-ADHOC-2). It is an OPTION rather than a second function
 * because both directions here are grants issued through the one grant API - `lockItem` / `lockAll`
 * revoke either identically - so a second function would duplicate the round trip to express a
 * duration. The default is the standing one, so a caller that says nothing gets the behaviour that
 * predates this parameter.
 *
 * It is a DISTINCT function rather than a flag on `captureSessionToCofre` so that the plain capture
 * stays locked-by-default and the security suite keeps testing that; a boolean would make the
 * dangerous direction one character away from the safe one.
 */
export async function captureSessionWithGrant(
  actor: Actor,
  input: CaptureSessionInput,
  deps: CofreDeps = {},
  options: { grant?: GrantDuration } = {},
): Promise<{ item: CofreItemDoc; grant: CofreGrantDoc }> {
  const item = await captureSessionToCofre(actor, input, deps);
  // The ordinary grant API - no new grant kind, no second code path that `lockItem`/`lockAll` would
  // have to learn about to be able to revoke.
  const grant = await issueGrant(actor, item._id, options.grant ?? 'until_locked', {}, deps);
  // A run halted in `needs_credentials` for this origin is woken from inside `mintCofreItem` and
  // `issueGrant` (`items.ts`, P3.1). Nothing to add here: announcing again would only re-dispatch
  // the same run a second time.
  return { item, grant };
}

/**
 * The origins a session captured while establishing `host` may be bound to: `[host]`, or nothing.
 *
 * WHY NARROW, AND WHY HERE. `originsFromStorageState` reports every domain in the jar, which after
 * a real login includes the analytics and CDN domains the page happened to touch and whatever
 * parent domain the portal scopes its own cookies to. Binding the captured session to all of them
 * makes it findable — and unwrappable — under `google-analytics.com` and under every sibling host
 * of the portal's parent domain. A session is credential-equivalent, so its binding must be the
 * narrowest one that still works, not the widest one the jar can justify.
 *
 * The narrowest one that still works is the single host we actually established against:
 * `unwrap()` matches with `hostMatchesOrigin`, and a host always matches itself. The jar is used
 * only as EVIDENCE — at least one cookie domain must cover `host`, or the login left nothing for
 * this portal and there is no session to store. It lives beside `originsFromStorageState` (and uses
 * the same matcher `unwrap` uses) so the derivation and the check can never drift apart.
 */
export function boundOriginsForEstablishedHost(storageState: unknown, host: string): string[] {
  const h = hostOf(host);
  if (!h) return [];
  const covered = originsFromStorageState(storageState).some((origin) => hostMatchesOrigin(h, origin));
  return covered ? [h] : [];
}

/**
 * Origins a storageState may be replayed against, derived from its own cookies.
 *
 * Derived rather than caller-supplied on purpose: a caller that guesses wrong either breaks the
 * session or over-binds it, and the cookies are the authoritative statement of where the session is
 * valid. Leading dots are stripped (`.oa.pt` -> `oa.pt`) because the binding matcher already treats
 * a parent domain as covering its subdomains.
 */
export function originsFromStorageState(storageState: unknown): string[] {
  const out = new Set<string>();
  const cookies = (storageState as { cookies?: unknown })?.cookies;
  if (Array.isArray(cookies)) {
    for (const c of cookies) {
      const domain = (c as { domain?: unknown })?.domain;
      if (typeof domain === 'string' && domain) out.add(domain.replace(/^\./, '').toLowerCase());
    }
  }
  const origins = (storageState as { origins?: unknown })?.origins;
  if (Array.isArray(origins)) {
    for (const o of origins) {
      const url = (o as { origin?: unknown })?.origin;
      if (typeof url === 'string') {
        try {
          out.add(new URL(url).hostname.toLowerCase());
        } catch {
          /* not a URL — skip rather than binding to something unparseable */
        }
      }
    }
  }
  return [...out];
}

/** The bare host of an origin written either as a host or as a full URL. */
function hostOf(origin: string): string {
  const trimmed = origin.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      /* not a URL after all — fall through to the authority split */
    }
  }
  return (trimmed.split('/')[0] ?? '').split(':')[0] ?? '';
}

/**
 * The actor's `session` items replayable against `origin`, most recently created first.
 *
 * WHY THIS LIVES HERE rather than at the call site. `cofre/store.ts` is lint-fenced (the
 * `COFRE_STORE_BAN` rule): nothing outside this module may reach the raw handles, precisely so the
 * owner-scoping predicate is written once. A caller that wants "the session for this portal" would
 * otherwise re-derive both the scoping and the origin match, which is the drift the fence exists to
 * prevent — so the query belongs on the module's own surface.
 *
 * Matching uses `hostMatchesOrigin`, the SAME rule `unwrap()` enforces at use time. Two different
 * "is this the same site" rules that can disagree would mean a session this function hands back is
 * one `unwrap()` then refuses, which reads as an unexplained failure rather than a binding problem.
 *
 * Newest first is deliberate: when several captures exist for one portal the freshest is the one
 * most likely still healthy, and checkout stops at the first that passes.
 */
export async function findSessionItemsForOrigin(actor: Actor, origin: string): Promise<CofreItemDoc[]> {
  const host = hostOf(origin);
  if (!host) return [];
  const items = await cofreItems.listVisible(actor, { type: 'session' });
  return items
    .filter((item) => item.boundOrigins.some((allowed) => hostMatchesOrigin(host, allowed)))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * Persist "this session is no longer good" (G-4 health-on-use).
 *
 * `session-checkout.ts` has a PURE `markUnhealthy(item)` that returns an edited doc; this is the
 * write. They are deliberately separate: checkout stays a pure decision the tests can drive
 * exhaustively, and only a caller that actually observed a rejection persists the verdict.
 *
 * Returns false when the item is not the actor's (uniform not-found, never an existence oracle).
 */
export async function markSessionUnhealthy(actor: Actor, itemId: string): Promise<boolean> {
  const item = await cofreItems.getVisible(actor, itemId);
  if (!item) return false;
  await cofreItems.raw.update(itemId, (cur) => {
    const doc = cur as CofreItemDoc;
    return { ...doc, sessionMetadata: { ...(doc.sessionMetadata ?? {}), healthy: false } };
  });
  return true;
}

/** Is this session item past its expiry? Health drives re-establishment (G-4). */
export function sessionIsExpired(item: Pick<CofreItemDoc, 'expiresAt'>, now = Date.now()): boolean {
  if (!item.expiresAt) return false;
  const at = Date.parse(item.expiresAt);
  return Number.isFinite(at) && at <= now;
}
