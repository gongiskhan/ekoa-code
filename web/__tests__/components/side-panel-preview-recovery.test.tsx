/**
 * SidePanel preview recovery wiring (F-2026-07-12-preview-502): the iframe never
 * fires its error event for an HTTP error response, so the panel (a) gates the
 * first render on a document probe, (b) re-probes on every iframe load and
 * routes a transient 5xx into the bounded retry machinery, and (c) renders
 * deliberate server pages (410 revoked) as-is. Classification itself is
 * unit-tested in __tests__/lib/preview-probe.test.ts; this asserts the wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import SidePanel from '@/components/builder/side-panel';
import { useOrchestrationStore } from '@/stores/orchestration';
import { useI18nStore } from '@/stores/i18n';

vi.mock('@/lib/api', () => ({
  api: {
    resolveUrl: (p: string) => (/^https?:\/\//.test(p) ? p : `http://api.test${p}`),
    appUrl: (id: string) => `http://api.test/apps/${id}/`,
    withPreviewToken: (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=t`,
  },
}));

const SESSION = 's-preview-1';
const APP_URL = 'http://api.test/apps/app-1/';

/** fetch stub whose per-call HTTP statuses are scripted; the last one repeats. */
function scriptFetch(...statuses: number[]) {
  let call = 0;
  const spy = vi.fn(async () => {
    const status = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    return new Response(status === 204 ? null : 'x', { status });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function seedPreviewSession() {
  useOrchestrationStore.setState({
    sidePanelTab: 'preview',
    sidePanelState: 'build',
    sessionPreviews: {
      [SESSION]: { previewId: 'app-1', appUrl: '/apps/app-1/', status: 'running', error: null, reloadCount: 0 },
    },
    sessionJobs: {
      [SESSION]: {
        jobId: 'j1', status: 'completed', phase: null, progress: 100, progressMessage: null,
        output: [], artifactInstanceId: 'app-1', slug: null, shareable: true, projectPath: null,
        lastBuildAt: null,
      },
    },
    sessionFiles: {},
  });
}

beforeEach(() => {
  seedPreviewSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The iframe title and the loading-overlay copy come from the i18n store (the B6
// i18n sweep replaced the hard-coded "App Preview" title with sp.preview), so
// derive the expected strings from the store instead of pinning one language.
const SP = useI18nStore.getState().t('sidePanel');

function previewIframe(container: HTMLElement): HTMLIFrameElement | null {
  const iframe = container.querySelector('iframe');
  if (iframe && iframe.getAttribute('title') !== SP.preview) return null;
  return iframe;
}

describe('SidePanel preview recovery', () => {
  it('gates the first iframe render on the probe and renders once the plane heals', async () => {
    scriptFetch(502, 502, 200);
    const { container } = render(<SidePanel sessionId={SESSION} />);

    // While the probe answers 502 the iframe must NOT get a src (an error body
    // rendered into the iframe would stick — the error event never fires).
    const early = previewIframe(container);
    expect(early?.getAttribute('src') ?? '').toBe('');

    // Poll interval is 500ms; after two transients the third probe is 200.
    await waitFor(
      () => expect(previewIframe(container)?.getAttribute('src')).toBe(APP_URL),
      { timeout: 4000 },
    );
  }, 10_000);

  it('renders a deliberate non-5xx server page (410 revoked) as-is instead of retrying', async () => {
    scriptFetch(410);
    const { container } = render(<SidePanel sessionId={SESSION} />);
    await waitFor(
      () => expect(previewIframe(container)?.getAttribute('src')).toBe(APP_URL),
      { timeout: 4000 },
    );
  }, 10_000);

  it('routes a transient 5xx detected at iframe load into the retry machinery', async () => {
    const spy = scriptFetch(200);
    const { container } = render(<SidePanel sessionId={SESSION} />);
    await waitFor(
      () => expect(previewIframe(container)?.getAttribute('src')).toBe(APP_URL),
      { timeout: 4000 },
    );

    // The plane starts failing; the loaded document is an error body.
    spy.mockImplementation(async () => new Response('proxy error', { status: 502 }));
    fireEvent.load(previewIframe(container)!);

    // The on-load probe classifies transient -> handleIframeError schedules a
    // src reset (1.5s backoff) with the loading overlay up — not a stuck body.
    await waitFor(
      () => {
        const calls = spy.mock.calls.length;
        expect(calls).toBeGreaterThanOrEqual(2);
      },
      { timeout: 4000 },
    );
    // Heal the plane; the retry reload's on-load probe clears to a healthy state.
    spy.mockImplementation(async () => new Response(null, { status: 200 }));
    const iframe = previewIframe(container)!;
    await waitFor(
      () => expect(iframe.getAttribute('src')).toBe(APP_URL),
      { timeout: 6000 },
    );
    fireEvent.load(iframe);
    await waitFor(() => {
      const overlayText = container.textContent || '';
      expect(overlayText).not.toContain(SP.loadingPreview);
    }, { timeout: 4000 });
  }, 15_000);
});
