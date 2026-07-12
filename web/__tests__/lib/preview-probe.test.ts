/**
 * preview-probe unit tests (F-2026-07-12-preview-502): the probe classifies the
 * served-app document plane so the preview panel can retry transient serving
 * failures (an iframe renders an HTTP error body without ever firing its error
 * event) while still rendering deliberate server pages (410 revoked-share).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { probePreviewDocument } from '@/lib/preview-probe';

const APP_URL = 'http://localhost:4111/apps/abc123/?token=t';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probePreviewDocument', () => {
  it('classifies a 2xx answer as ok', async () => {
    mockFetch(async () => new Response(null, { status: 200 }));
    await expect(probePreviewDocument(APP_URL)).resolves.toBe('ok');
  });

  it('classifies a 502 (the proxy-error case) as transient', async () => {
    mockFetch(async () => new Response('proxy error', { status: 502 }));
    await expect(probePreviewDocument(APP_URL)).resolves.toBe('transient');
  });

  it('classifies a 503 (mid-build asset window) as transient', async () => {
    mockFetch(async () => new Response(null, { status: 503 }));
    await expect(probePreviewDocument(APP_URL)).resolves.toBe('transient');
  });

  it('classifies a network failure as transient', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(probePreviewDocument(APP_URL)).resolves.toBe('transient');
  });

  it('classifies a 410 (revoked share page) as hard so the page renders as-is', async () => {
    mockFetch(async () => new Response(null, { status: 410 }));
    await expect(probePreviewDocument(APP_URL)).resolves.toBe('hard');
  });

  it('classifies a 404 as hard', async () => {
    mockFetch(async () => new Response(null, { status: 404 }));
    await expect(probePreviewDocument(APP_URL)).resolves.toBe('hard');
  });

  it('probes with an uncached HEAD request against the exact document URL', async () => {
    const spy = mockFetch(async () => new Response(null, { status: 200 }));
    await probePreviewDocument(APP_URL);
    expect(spy).toHaveBeenCalledWith(APP_URL, expect.objectContaining({ method: 'HEAD', cache: 'no-store' }));
  });

  it('reports transient (not a throw) when aborted mid-flight', async () => {
    const controller = new AbortController();
    mockFetch((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const probe = probePreviewDocument(APP_URL, controller.signal);
    controller.abort();
    await expect(probe).resolves.toBe('transient');
  });
});
