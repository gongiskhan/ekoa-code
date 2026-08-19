/**
 * In-page replay of one learned call (slice P2.3, trap T3) - THE ENVELOPE AND THE SCRIPT TEXT.
 *
 * ══ WHAT THIS FILE IS AND IS NOT EVIDENCE OF ═════════════════════════════════════════════════
 *
 * Every case here drives a FAKE page whose `evaluate` records the script it was handed and returns
 * a canned envelope. NO FETCH EVER HAPPENS. So this suite pins exactly two things - the shape of
 * the script `runInjectedCall` composes, and how it parses what comes back - and it is evidence
 * about NOTHING ELSE. In particular it cannot say whether the request inherits the page's cookie
 * jar, because on this page there is no jar, no origin and no request.
 *
 * That distinction is not pedantry: the first cut of this module ran the replay from `about:blank`
 * in a freshly-wiped profile - inheriting nothing, which is the entire premise of the path - and
 * every case below stayed green, because a canned envelope is returned whatever the page is.
 *
 * THE INHERITANCE ITSELF IS PROVED IN `inject-inheritance.test.ts`, against a real Chromium and a
 * real server, by reading the headers the server actually received. Anything asserting what the
 * replay CARRIES belongs there. What belongs here is what can be decided by reading a string.
 *
 * The two properties pinned below pull in opposite directions, which is why both are here:
 *   - the script must carry the LIVE header values the site expects, so a replay of a private API
 *     can authenticate at all;
 *   - the values must come from the machine's own live map at the moment of the call, and the
 *     browser-owned headers (`cookie` above all) must NOT be forged from it - forging `cookie`
 *     would replace the live jar with a remembered one, which is the exact inheritance this path
 *     exists for.
 */
import { describe, it, expect } from 'vitest';
import { forwardableHeaderNames, runInjectedCall, InjectedCallError, MAX_INJECTED_BODY_CHARS } from '../../src/browser/inject.js';
import type { ProfilePage } from '../../src/browser/types.js';

/**
 * A page that records the script it was handed and answers a canned envelope.
 *
 * It STARTS on the call's own origin, so the navigation is a no-op for most cases below and they
 * stay about the script. `startAt` is how the navigation cases move it somewhere else.
 */
function fakePage(
  answer: unknown | ((script: string) => unknown),
  startAt = 'https://portal.example/cases',
): ProfilePage & { scripts: string[]; gotos: string[] } {
  const scripts: string[] = [];
  const gotos: string[] = [];
  let current = startAt;
  const page = {
    scripts,
    gotos,
    evaluate: async (script: string) => {
      scripts.push(script);
      return typeof answer === 'function' ? (answer as (s: string) => unknown)(script) : answer;
    },
    goto: async (url: string) => { gotos.push(url); current = `${url}/`; return null; },
    waitForLoadState: async () => undefined,
    url: () => current,
  } as unknown as ProfilePage & { scripts: string[]; gotos: string[] };
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

  // ── THE DECISION TO NAVIGATE. What the request then inherits is proved with a real browser in
  //    `inject-inheritance.test.ts`; what is decidable here is WHETHER the page is moved, and
  //    whether the values are read after that move rather than before it.
  it('puts the page on the call\'s origin before sending, when it is somewhere else', async () => {
    const page = fakePage(okEnvelope, 'about:blank');
    await runInjectedCall(page, { method: 'GET', url: 'https://portal.example/api/cases', headerNames: [] }, () => ({}));
    expect(page.gotos).toEqual(['https://portal.example']);
    // The ORIGIN ROOT, never the call's own URL: navigating to the URL would issue the call as a
    // document navigation - an uncontrolled GET, and wrong outright for a POST recipe.
    expect(page.gotos[0]).not.toContain('/api/cases');
  });

  it('does NOT navigate a page already on the origin - a live run\'s page is not moved underneath it', async () => {
    const page = fakePage(okEnvelope, 'https://portal.example/cases');
    await runInjectedCall(page, { method: 'GET', url: 'https://portal.example/api/cases', headerNames: [] }, () => ({}));
    expect(page.gotos).toEqual([]);
  });

  it('reads the live header values AFTER the navigation, not before it', async () => {
    // The navigation is what provokes the site's own traffic, and therefore what makes the live map
    // current. Resolving first would forward whatever the previous page happened to leave behind.
    const page = fakePage(okEnvelope, 'about:blank');
    const order: string[] = [];
    const spy = {
      ...page,
      goto: async (url: string) => { order.push('goto'); return page.goto(url); },
    } as unknown as ProfilePage;
    await runInjectedCall(spy, { method: 'GET', url: 'https://portal.example/api/cases', headerNames: ['x-csrf-token'] }, () => {
      order.push('resolve');
      return {};
    });
    expect(order).toEqual(['goto', 'resolve']);
  });

  it('refuses when the page could not be put on the origin, rather than sending from where it is', async () => {
    const page = fakePage(okEnvelope, 'about:blank');
    const failing = { ...page, goto: async () => { throw new Error('net::ERR_CONNECTION_REFUSED'); } } as unknown as ProfilePage & { scripts: string[] };
    await expect(
      runInjectedCall(failing, { method: 'GET', url: 'https://portal.example/api/cases', headerNames: [] }, () => ({})),
    ).rejects.toBeInstanceOf(InjectedCallError);
    // NOTHING WAS SENT. A replay from a page that never reached the origin inherits nothing, which
    // is the failure this whole path exists to remove.
    expect(page.scripts).toHaveLength(0);
  });

  it('refuses when loading the origin REDIRECTED the page off it (an identity-provider bounce)', async () => {
    const page = fakePage(okEnvelope, 'about:blank');
    const bounced = {
      ...page,
      goto: async () => null,
      url: () => 'https://login.idp.example/authorize',
    } as unknown as ProfilePage & { scripts: string[] };
    await expect(
      runInjectedCall(bounced, { method: 'GET', url: 'https://portal.example/api/cases', headerNames: [] }, () => ({})),
    ).rejects.toThrow(/login\.idp\.example/);
    expect(page.scripts).toHaveLength(0);
  });
});
