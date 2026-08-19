/**
 * In-page replay of one learned call (slice P2.3, trap T3).
 *
 * Two properties, and they pull in opposite directions, which is why both are pinned here:
 *   - the call must carry the LIVE header values the site expects, so a replay of a private API
 *     actually authenticates;
 *   - the values must come from the machine's own live map at the moment of the call, and the
 *     browser-owned headers (`cookie` above all) must NOT be forged from it - forging `cookie`
 *     would replace the live jar with a remembered one, which is the exact inheritance this path
 *     exists for.
 */
import { describe, it, expect } from 'vitest';
import { forwardableHeaderNames, runInjectedCall, InjectedCallError, MAX_INJECTED_BODY_CHARS } from '../../src/browser/inject.js';
import type { ProfilePage } from '../../src/browser/types.js';

/** A page that records the script it was handed and answers a canned envelope. */
function fakePage(answer: unknown | ((script: string) => unknown)): ProfilePage & { scripts: string[] } {
  const scripts: string[] = [];
  const page = {
    scripts,
    evaluate: async (script: string) => {
      scripts.push(script);
      return typeof answer === 'function' ? (answer as (s: string) => unknown)(script) : answer;
    },
    url: () => 'https://portal.example/cases',
  } as unknown as ProfilePage & { scripts: string[] };
  return page;
}

const okEnvelope = JSON.stringify({
  status: 200,
  ok: true,
  bodyText: '{"items":[{"id":1}]}',
  truncated: false,
  contentType: 'application/json; charset=utf-8',
  responseHeaderNames: ['Content-Type', 'X-Request-Id'],
});

describe('runInjectedCall', () => {
  it('forwards the requested header values from the LIVE map, keyed on the call\'s origin', async () => {
    const page = fakePage(okEnvelope);
    const asked: Array<{ origin: string; names: readonly string[] }> = [];
    await runInjectedCall(
      page,
      { method: 'GET', url: 'https://portal.example/api/cases', headerNames: ['x-csrf-token'] },
      (origin, names) => {
        asked.push({ origin, names });
        return { 'x-csrf-token': 'live-token-value' };
      },
    );

    expect(asked).toEqual([{ origin: 'https://portal.example', names: ['x-csrf-token'] }]);
    // The value reaches the PAGE (which is where it came from), and nowhere else.
    expect(page.scripts[0]).toContain('live-token-value');
    expect(page.scripts[0]).toContain("credentials: 'include'");
  });

  it('never forges a browser-owned header, cookie above all', () => {
    expect(forwardableHeaderNames(['Cookie', 'x-csrf-token', 'HOST', 'user-agent', 'authorization']))
      .toEqual(['x-csrf-token', 'authorization']);
  });

  it('answers the verdict with response header NAMES, lower-cased and sorted', async () => {
    const page = fakePage(okEnvelope);
    const result = await runInjectedCall(page, { method: 'GET', url: 'https://portal.example/api/cases', headerNames: [] }, () => ({}));
    expect(result).toEqual({
      status: 200,
      ok: true,
      bodyText: '{"items":[{"id":1}]}',
      contentType: 'application/json',
      responseHeaderNames: ['content-type', 'x-request-id'],
    });
  });

  it('surfaces a failure INSIDE the page as an InjectedCallError rather than a fake 200', async () => {
    const page = fakePage(JSON.stringify({ failed: 'NetworkError when attempting to fetch resource' }));
    await expect(
      runInjectedCall(page, { method: 'GET', url: 'https://portal.example/api/cases', headerNames: [] }, () => ({})),
    ).rejects.toBeInstanceOf(InjectedCallError);
  });

  it('refuses a relative URL rather than resolving it against whatever page is open', async () => {
    const page = fakePage(okEnvelope);
    await expect(
      runInjectedCall(page, { method: 'GET', url: '/api/cases', headerNames: [] }, () => ({})),
    ).rejects.toBeInstanceOf(InjectedCallError);
    expect(page.scripts).toHaveLength(0);
  });

  it('sends a body only for a method that has one', async () => {
    const page = fakePage(okEnvelope);
    await runInjectedCall(
      page,
      { method: 'POST', url: 'https://portal.example/api/cases', headerNames: [], body: '{"q":1}', contentType: 'application/json' },
      () => ({}),
    );
    expect(page.scripts[0]).toContain('"body":"{\\"q\\":1}"');
    expect(page.scripts[0]).toContain("req.method !== 'GET'");
  });

  it('states the body cap in the script it runs, so a huge answer is bounded IN the page', async () => {
    const page = fakePage(okEnvelope);
    await runInjectedCall(page, { method: 'GET', url: 'https://portal.example/api/cases', headerNames: [] }, () => ({}));
    expect(page.scripts[0]).toContain(`"cap":${MAX_INJECTED_BODY_CHARS}`);
  });
});
