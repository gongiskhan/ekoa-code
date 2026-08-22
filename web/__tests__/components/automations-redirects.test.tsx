/**
 * S8 - the three `/automations` addresses, pinned at the layer that can run in CI.
 *
 * WHY THIS EXISTS BESIDE `web/e2e/automations-hidden.spec.ts` RATHER THAN INSTEAD OF IT. The e2e
 * spec proves the routes are MOUNTED and that the browser really lands where it should; it needs a
 * live boot, and until one runs it is registered UNVERIFIED. This suite proves the DESTINATIONS -
 * which are the part a later edit gets wrong silently - hermetically, on every `npm test`.
 *
 * THE STORE IS REAL HERE, AND THAT IS THE REVIEW ROUND'S CORRECTION (F23). The first cut mocked
 * `@/stores/automations` wholesale, so the `[id]` resolver was only ever exercised against a
 * hand-written object: patching the real `fetchOne` to always return null left all 613 web tests
 * green, and the one live e2e case used an unknown id whose expected answer IS the failure fallback,
 * so nothing anywhere could tell working resolution from total failure. Now only the typed client is
 * mocked and the real store runs against it, so the wire shape, `normalizeWireAutomation` (which is
 * what carries `source` and `orgId` through) and the store's own error handling are all in the path.
 *
 * The distinction between the three addresses is the fragile part: "make them all redirect to
 * /integrations" is the obvious wrong simplification, and it would pass a suite that only asserted
 * "does not 404".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { redirectMock, replaceMock, pushMock, getMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ replace: replaceMock, push: pushMock, prefetch: vi.fn() }),
  useParams: () => ({ id: 'auto-1' }),
}));

// Only the transport is mocked. `tryCall` keeps its real contract so the store's ok/error branches
// are the ones under test.
vi.mock('@/lib/api', () => ({
  api: { automations: { get: getMock } },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (error) {
      return { ok: false as const, error: error as { message?: string } };
    }
  },
}));

import AutomationsListRedirect from '@/app/(dashboard)/automations/page';
import AutomationDetailRedirect from '@/app/(dashboard)/automations/[id]/page';
import { GET as automationsNewGone } from '@/app/(dashboard)/automations/new/route';
import { useAuthStore } from '@/stores/auth';
import type { AuthUser } from '@ekoa/shared';

const VIEWER_ORG = 'orgA';

/** The wire shape the API really answers with, not the domain shape the page consumes. */
function wireAutomation(over: Record<string, unknown> = {}) {
  return {
    id: 'auto-1',
    name: 'Uma rotina',
    ownerId: 'ownerA',
    orgId: VIEWER_ORG,
    plan: { steps: [{ stepId: 's1', description: 'click', tool: 'browser' }] },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  redirectMock.mockReset();
  replaceMock.mockReset();
  pushMock.mockReset();
  getMock.mockReset();
  useAuthStore.setState({ user: { id: 'ownerA', orgId: VIEWER_ORG } as unknown as AuthUser });
});

describe('S8 - /automations lands on the surface that replaced it', () => {
  it('redirects to /integrations, through the SERVER redirect', () => {
    AutomationsListRedirect();
    expect(redirectMock).toHaveBeenCalledWith('/integrations');
  });
});

describe('S8 - /automations/<id> resolves into the integration that owns the steps', () => {
  it('an integration-provisioned row lands on that integration detail page, through the real store', async () => {
    getMock.mockResolvedValue(wireAutomation({ source: { integrationKey: 'citius', templateKey: 'notificacoes' } }));
    render(<AutomationDetailRedirect />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/integrations/citius'));
    // The read really went through the typed client, with the id off the route.
    expect(getMock).toHaveBeenCalledWith({ id: 'auto-1' });
  });

  it('encodes a key that needs it, rather than pasting it into the path', async () => {
    getMock.mockResolvedValue(wireAutomation({ source: { integrationKey: 'a b/c', templateKey: 't' } }));
    render(<AutomationDetailRedirect />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/integrations/a%20b%2Fc'));
  });

  it('a row with NO integration provenance falls back to the list', async () => {
    getMock.mockResolvedValue(wireAutomation());
    render(<AutomationDetailRedirect />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/integrations'));
  });

  it('a REFUSED read - absent, cross-tenant, one uniform 404 - falls back to the list', async () => {
    getMock.mockRejectedValue({ status: 404, message: 'not found' });
    render(<AutomationDetailRedirect />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/integrations'));
  });

  it('a transport failure falls back too: the page never leaves a person on a spinner', async () => {
    getMock.mockRejectedValue(new Error('network'));
    render(<AutomationDetailRedirect />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/integrations'));
  });

  // REVIEW ROUND F14. A super-admin may read another org's automation, and the destination page
  // renders in the VIEWER's org - so following a foreign link used to land them, with no signal, on
  // their own org's page for that key. A wrong answer that looks right is worse than the list.
  it('a row from ANOTHER org falls back to the list rather than a convincing wrong page', async () => {
    getMock.mockResolvedValue(
      wireAutomation({ orgId: 'orgB', source: { integrationKey: 'citius', templateKey: 'notificacoes' } }),
    );
    render(<AutomationDetailRedirect />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/integrations'));
    expect(replaceMock).not.toHaveBeenCalledWith('/integrations/citius');
  });

  it('the org check does not fire on a row that omits orgId: absence is not a mismatch', async () => {
    const row = wireAutomation({ source: { integrationKey: 'citius', templateKey: 'n' } }) as Record<string, unknown>;
    delete row.orgId;
    getMock.mockResolvedValue(row);
    render(<AutomationDetailRedirect />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/integrations/citius'));
  });

  it('REPLACES and never PUSHES, so the back button does not walk into the redirect again', async () => {
    getMock.mockResolvedValue(wireAutomation({ source: { integrationKey: 'citius', templateKey: 't' } }));
    render(<AutomationDetailRedirect />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a loading state while the one read is outstanding, not a blank frame', () => {
    getMock.mockReturnValue(new Promise(() => undefined));
    render(<AutomationDetailRedirect />);
    expect(screen.getByTestId('automation-detail-redirect')).toBeTruthy();
  });
});

describe('S8 - /automations/new is GONE and says so with a status', () => {
  it('answers 410, not 404 and not a redirect', async () => {
    const res = automationsNewGone();
    expect(res.status).toBe(410);
    // A redirect would carry a Location header; this route deliberately does not send one.
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('/integrations');
  });
});
