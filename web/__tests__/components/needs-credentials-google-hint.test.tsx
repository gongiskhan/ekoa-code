/**
 * The ceremony banner warns about Google sign-in (findings,
 * `google-sso-refuses-the-automated-ceremony-browser`).
 *
 * WHY IT IS WORTH A TEST. Google refuses OAuth from the headed browser the ceremony runs in, and
 * nothing in this codebase can change that. What CAN change is whether the person is told before
 * they walk into it: the banner is the last screen they read before leaving for the Cofre and their
 * local Ekoa window, and on most targets "Continue with Google" sits right next to an email/phone
 * form that works. Said too late, this sentence is a post-mortem; said here, the failure never
 * happens. So the copy has to survive edits to this banner, in both languages.
 *
 * CEREMONY ONLY, asserted as hard as the copy itself. In `typist` mode the platform replays a
 * stored password and the user makes no sign-in choice at all, so the same sentence there is
 * advice about a decision they are not being asked to make.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { storeState } = vi.hoisted(() => ({
  storeState: { current: {} as Record<string, unknown> },
}));

vi.mock('@/stores/automations', () => ({
  useAutomationsStore: (selector: (s: unknown) => unknown) => selector(storeState.current),
}));

vi.mock('@/lib/api', () => ({
  api: {
    resolveUrl: (u: string) => u,
    withPreviewToken: (u: string) => u,
  },
  tryCall: async (fn: () => Promise<unknown>) => ({ ok: true, data: await fn() }),
}));

import RunViewer from '@/components/automations/run-viewer';
import { useI18nStore } from '@/stores/i18n';
import { en } from '@/locales/en';
import { pt } from '@/locales/pt';

function halted(mode: 'typist' | 'ceremony') {
  storeState.current = {
    activeRun: {
      status: 'needs_credentials',
      runId: 'run-1',
      automationId: 'auto-1',
      // The store's INITIAL_RUN shape, plus the halt: the viewer reads both on first render.
      liveSteps: {},
      timeline: [],
      credentialsRequest: {
        stepIndex: 2,
        origin: 'portal.acme.example',
        integrationKey: 'acme',
        portalDeepLink: '/cofre?origin=portal.acme.example',
        mode,
        reason: 'portal.acme.example needs a session only you can establish',
      },
    },
    current: null,
    start: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    submitFeedback: vi.fn(),
    resetActiveRun: vi.fn(),
  };
}

beforeEach(() => {
  useI18nStore.setState({ language: 'en' });
  halted('ceremony');
});

describe('the credential ceremony banner', () => {
  it('tells the user to sign in by email or phone, not with Google', () => {
    render(<RunViewer automationId="auto-1" steps={[]} />);
    expect(screen.getByTestId('ceremony-google-hint')).toHaveTextContent(
      en.automations.runViewer.credentialsGoogleHint,
    );
  });

  it('says it in Portuguese too - the copy moves with the code in both languages', () => {
    useI18nStore.setState({ language: 'pt' });
    render(<RunViewer automationId="auto-1" steps={[]} />);
    expect(screen.getByTestId('ceremony-google-hint')).toHaveTextContent(
      pt.automations.runViewer.credentialsGoogleHint,
    );
  });

  it('names Google and the alternative, in both languages', () => {
    for (const text of [en.automations.runViewer.credentialsGoogleHint, pt.automations.runViewer.credentialsGoogleHint]) {
      expect(text).toContain('Google');
      expect(text).toMatch(/email/i);
      expect(text).toMatch(/phone|telemóvel/i);
    }
    // Two languages, two strings: one shared string would satisfy the assertions above while
    // showing a Portuguese user English, or the reverse.
    expect(en.automations.runViewer.credentialsGoogleHint).not.toBe(
      pt.automations.runViewer.credentialsGoogleHint,
    );
  });

  it('does NOT appear in typist mode, where the user makes no sign-in choice', () => {
    halted('typist');
    render(<RunViewer automationId="auto-1" steps={[]} />);
    expect(screen.queryByTestId('ceremony-google-hint')).toBeNull();
  });
});
