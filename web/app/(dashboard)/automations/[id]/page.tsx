"use client";

/**
 * S8: the automation EDITOR is gone, and this address resolves INTO the integration that owns the
 * work rather than dumping every visitor on the list.
 *
 * WHY THIS ONE IS NOT A FOUR-LINE SERVER REDIRECT like `/automations` beside it. The destination
 * depends on the row: an automation provisioned from an integration template carries
 * `source.integrationKey` and belongs on `/integrations/<key>`, where S2's detail page shows its
 * steps, its evidence and its runs. A server component cannot resolve that - the caller's bearer
 * lives in the browser - so the lookup happens here, once, and the answer is a `router.replace`.
 *
 * REPLACE, NEVER PUSH. `redirect()` in a server component replaces, and this page must behave the
 * same way or the back button walks straight back into a route that immediately redirects again.
 *
 * EVERY FAILURE LANDS SOMEWHERE REAL. A row that does not resolve, one the caller may not see, a
 * network error, or an automation with no integration provenance: all of them go to `/integrations`.
 * There is no not-found state here, because "this automation is gone" is not an answer this address
 * can usefully give any more - the page that could act on it no longer exists.
 *
 * AND A FOREIGN ORG IS ONE OF THOSE FAILURES (review round F14). `canReadAutomation` grants a
 * super-admin any org's row, so a super-admin following another tenant's link used to be replaced,
 * silently, onto `/integrations/<key>` rendered in their OWN org - a page where that automation, its
 * sessions and its runs do not live, looking for all the world like the right one. The destination
 * page's unit is the viewer's org, so a row from outside it has no destination here and falls back
 * to the list rather than to a convincing wrong answer.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAutomationsStore } from '@/stores/automations';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from '@/stores/i18n';
import { PageShell } from '@/components/ui/page-shell';
import { LoadingState } from '@/components/ui/spinner';

export default function AutomationDetailRedirect() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const router = useRouter();
  const fetchOne = useAutomationsStore((s) => s.fetchOne);
  const viewerOrgId = useAuthStore((s) => s.user?.orgId);
  const { common } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    if (id === '') {
      router.replace('/integrations');
      return;
    }
    void (async () => {
      const automation = await fetchOne(id).catch(() => null);
      if (cancelled) return;
      // A row from another org has no destination on this viewer's integrations page, whatever key
      // it names. Only compared when BOTH sides name a real org: an absent orgId on either side is
      // not evidence of a mismatch, and must not turn an ordinary same-org resolve into a fallback.
      const rowOrgId = automation?.orgId;
      const foreign = rowOrgId !== undefined && viewerOrgId !== undefined && rowOrgId !== viewerOrgId;
      const key = foreign ? undefined : automation?.source?.integrationKey;
      router.replace(key ? `/integrations/${encodeURIComponent(key)}` : '/integrations');
    })();
    return () => {
      cancelled = true;
    };
  }, [id, fetchOne, router, viewerOrgId]);

  return (
    <PageShell testId="automation-detail-redirect">
      <LoadingState label={common.loading} />
    </PageShell>
  );
}
