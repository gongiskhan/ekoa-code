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
import type { Actor, SessionMetadata } from '@ekoa/shared';
import { hostMatchesOrigin } from '../security/origin-binding.js';
import { mintCofreItem } from './items.js';
import { cofreItems } from './store.js';
import type { CofreItemDoc } from './types.js';

/** How long a captured session is assumed good before it must be re-established or re-checked. */
export const DEFAULT_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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
