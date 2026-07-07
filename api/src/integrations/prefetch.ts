/**
 * Live integration pre-fetch (ch05 §5.5.2 layer 3; carryover: reference/llm-usage-map.md §5,
 * must-preserve). On a CHAT turn, keyword hits on email / calendar / files pre-fetch live
 * Google Workspace / Microsoft 365 data into the system prompt, with a 60s cache that also
 * serves keyword-less follow-ups ("sim") from the still-warm cache.
 *
 * Ported from cortex/src/adapters/external.ts, re-pointed at the G8 platform API caller and
 * hardened for multi-tenancy: the old cache was keyed GLOBALLY (`provider:action`), which would
 * serve one org's inbox to another. Here the connection is org custody (Amendment 2) and the
 * cache is keyed per ORG (`orgId:provider:action`). The seam only passes `userId`, so the org is
 * resolved from the user record.
 *
 * This is the implementation behind the `IntegrationPrefetchFn` seam (agents/seams.ts); the
 * composition root wires it via `setIntegrationPrefetch`. Any failure returns '' — the pre-fetch
 * is advisory context and must never break a chat turn.
 */

import { randomUUID } from 'node:crypto';
import { users } from '../data/stores.js';
import { callPlatformIntegration } from './platform-call.js';
import { listPlatform, type PlatformProvider, type OAuthDeps } from './platform-oauth.js';

const CACHE_TTL_MS = 60_000;

/** Pre-fetched data cache — keyed `orgId:provider:action`, 60s TTL. */
const cache = new Map<string, { data: string; expiresAt: number }>();

/** Test hook: clear the pre-fetch cache between cases. */
export function __resetPrefetchCacheForTests(): void {
  cache.clear();
}

interface Keywords {
  email: boolean;
  calendar: boolean;
  files: boolean;
}

/** PT-PT + EN keyword table (ported verbatim from cortex external.ts). */
function detectKeywords(message: string): Keywords {
  const lower = message.toLowerCase();
  return {
    email: /\b(email|emails|inbox|correio|caixa|e-mail|mail|mensagem|mensagens)\b/.test(lower),
    calendar: /\b(calendar|calend[aá]rio|meeting|reuni[aã]o|evento|event|agenda|schedule)\b/.test(lower),
    files: /\b(drive|file|files|ficheiro|documento|document|folder|pasta)\b/.test(lower),
  };
}

export interface PrefetchDeps {
  /** OAuth/platform-call deps (clock + provider transport). Default: real clock + guarded fetch. */
  oauth?: OAuthDeps;
}

function defaultOAuthDeps(): OAuthDeps {
  return { now: () => Date.now(), genId: () => randomUUID() };
}

function cacheKey(orgId: string, provider: PlatformProvider, action: string): string {
  return `${orgId}:${provider}:${action}`;
}
function cachedFresh(orgId: string, provider: PlatformProvider, action: string, now: number): boolean {
  const e = cache.get(cacheKey(orgId, provider, action));
  return !!e && now < e.expiresAt;
}

/**
 * The seam implementation. Resolves the caller's org, checks which connected platforms exist,
 * and — for any keyword that fired OR whose cache is still warm — pre-fetches (or replays) the
 * live data block. Returns '' when nothing pre-fetches or on any failure.
 */
export async function integrationPrefetch(input: { userId: string; message: string }, deps: PrefetchDeps = {}): Promise<string> {
  try {
    const oauthDeps = deps.oauth ?? defaultOAuthDeps();
    const user = (await users.get(input.userId)) as { orgId?: string } | null;
    if (!user?.orgId) return '';
    const orgId = user.orgId;

    const connected = (await listPlatform({ userId: input.userId, orgId, role: 'builder' }))
      .filter((p) => p.connected)
      .map((p) => p.provider);
    if (connected.length === 0) return '';

    const now = oauthDeps.now();
    const kw = detectKeywords(input.message);
    // A keyword-less follow-up ("sim") still injects data while any relevant cache is warm.
    const eff: Keywords = {
      email: kw.email || connected.some((p) => cachedFresh(orgId, p, 'email', now)),
      calendar: kw.calendar || connected.some((p) => cachedFresh(orgId, p, 'calendar', now)),
      files: kw.files || connected.some((p) => cachedFresh(orgId, p, 'files', now)),
    };
    if (!eff.email && !eff.calendar && !eff.files) return '';

    const sections: string[] = [];
    for (const provider of connected) {
      const block = await prefetchProvider(orgId, provider, eff, oauthDeps);
      if (block) sections.push(block);
    }
    if (sections.length === 0) return '';
    return `## Live Integration Data\n\nThe following data was pre-fetched from your connected integrations:\n\n${sections.join('\n\n')}`;
  } catch {
    return ''; // advisory — never break a chat turn
  }
}

async function prefetchProvider(orgId: string, provider: PlatformProvider, kw: Keywords, oauthDeps: OAuthDeps): Promise<string> {
  const integrationKey = provider === 'google' ? 'google-workspace' : 'microsoft-365';
  const providerName = provider === 'google' ? 'Google Workspace' : 'Microsoft 365';
  const sections: string[] = [`### ${providerName} Data`];
  const now = oauthDeps.now();

  /** Fetch-or-replay one action, appending a labelled JSON block. Errors are non-fatal. */
  const fetchCached = async (action: string, actionName: string, args: Record<string, unknown>, label: string): Promise<void> => {
    const key = cacheKey(orgId, provider, action);
    const hit = cache.get(key);
    if (hit && now < hit.expiresAt) {
      sections.push(hit.data);
      return;
    }
    try {
      const result = await callPlatformIntegration({ orgId, integrationKey, actionName, args }, oauthDeps);
      const text = `**${label}**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
      cache.set(key, { data: text, expiresAt: now + CACHE_TTL_MS });
      sections.push(text);
    } catch {
      /* pre-fetch errors are non-fatal */
    }
  };

  if (kw.email) {
    const oneDayAgo = new Date(now - 86_400_000).toISOString();
    await fetchCached(
      'email',
      'list_emails',
      provider === 'google'
        ? { q: 'newer_than:1d', maxResults: 50 }
        : { $top: 50, $orderby: 'receivedDateTime desc', $filter: `receivedDateTime ge ${oneDayAgo}` },
      'Emails received in the last 24 hours (count = messages array length)',
    );

    if (provider === 'microsoft') {
      await fetchCached(
        'email:recent',
        'list_emails',
        { $top: 5, $orderby: 'receivedDateTime desc', $select: 'id,subject,from,receivedDateTime,isRead' },
        'Most recent 5 emails with metadata',
      );
    }

    if (provider === 'google') {
      // list_emails returns ids only; read_email(format:metadata) gives subject/from/date.
      const metaKey = cacheKey(orgId, provider, 'email:recent');
      const metaHit = cache.get(metaKey);
      if (metaHit && now < metaHit.expiresAt) {
        sections.push(metaHit.data);
      } else {
        try {
          const list = (await callPlatformIntegration({ orgId, integrationKey, actionName: 'list_emails', args: { maxResults: 5 } }, oauthDeps)) as {
            success: boolean;
            data?: { messages?: Array<{ id: string }> };
          };
          if (list.success && Array.isArray(list.data?.messages) && list.data.messages.length > 0) {
            const metas: unknown[] = [];
            for (const msg of list.data.messages.slice(0, 5)) {
              metas.push(await callPlatformIntegration({ orgId, integrationKey, actionName: 'read_email', args: { messageId: msg.id, format: 'metadata' } }, oauthDeps));
            }
            const text = `**Most recent 5 emails (headers: subject, from, date)**\n\`\`\`json\n${JSON.stringify(metas, null, 2)}\n\`\`\``;
            cache.set(metaKey, { data: text, expiresAt: now + CACHE_TTL_MS });
            sections.push(text);
          }
        } catch {
          /* non-fatal */
        }
      }
      await fetchCached('labels', 'list_labels', {}, 'Gmail Labels (available for modify_email / batch_modify_emails)');
    }
  }

  if (kw.calendar) {
    const timeMin = new Date(now).toISOString();
    await fetchCached(
      'calendar',
      'list_events',
      provider === 'google' ? { timeMin, maxResults: 5, singleEvents: true } : { startDateTime: timeMin, $top: 5 },
      'Upcoming Calendar Events (up to 5)',
    );
  }

  if (kw.files) {
    await fetchCached(
      'files',
      'list_files',
      provider === 'google' ? { pageSize: 5, orderBy: 'modifiedTime desc' } : { $top: 5, $orderby: 'lastModifiedDateTime desc' },
      'Recent Files (up to 5)',
    );
  }

  return sections.length > 1 ? sections.join('\n\n') : '';
}
