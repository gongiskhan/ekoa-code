/**
 * The hosted half of the capture layer (slice P2.2): the SECOND redaction boundary, and the
 * pure-function learner that turns captured exchanges into a replayable recipe.
 *
 * The learner is deliberately model-free, and that is what these tests are really pinning: if
 * compiling a recipe needed a model, the "second run costs zero model calls" property would be a
 * claim about caching rather than a property of the design.
 */
import { describe, it, expect } from 'vitest';
import type { LocalBrowserCapture } from '@ekoa/shared';
import {
  compileInjectedCalls,
  deriveLessons,
  internalApiCalls,
  redactCaptures,
} from '../../src/automation/network-capture.js';
import { secretRegistryFromValues } from '../../src/security/redaction.js';

function capture(over: Partial<LocalBrowserCapture> = {}): LocalBrowserCapture {
  return {
    method: 'GET',
    url: 'https://portal.example/api/cases?ref=2024-1',
    requestHeaderNames: ['accept', 'x-csrf-token'],
    responseHeaderNames: ['content-type'],
    status: 200,
    contentType: 'application/json',
    resourceType: 'xhr',
    responseBody: '{"items":[{"id":1,"ref":"2024-1"}],"total":1}',
    ...over,
  };
}

describe('redactCaptures - the second boundary (trap T8)', () => {
  it('substitutes a live credential out of a URL and a body', () => {
    const secrets = secretRegistryFromValues(['s3cret-session-token']);
    const [out] = redactCaptures(
      [capture({
        url: 'https://portal.example/api/cases?auth=s3cret-session-token',
        responseBody: '{"echo":"s3cret-session-token"}',
      })],
      secrets,
    );
    expect(JSON.stringify(out)).not.toContain('s3cret-session-token');
  });

  it('masks a conventionally-named query value the registry never held', () => {
    const [out] = redactCaptures([capture({ url: 'https://portal.example/api/cases?access_token=whatever-this-is' })]);
    expect(out!.url).not.toContain('whatever-this-is');
  });

  it('keeps header NAMES, lower-cased, sorted and de-duplicated', () => {
    const [out] = redactCaptures([capture({ requestHeaderNames: ['X-Csrf-Token', 'accept', 'x-csrf-token', ':authority'] })]);
    expect(out!.requestHeaderNames).toEqual(['accept', 'x-csrf-token']);
  });
});

describe('internalApiCalls - what a recipe may be built from', () => {
  it('takes script-issued 2xx JSON and nothing else', () => {
    const kept = internalApiCalls(redactCaptures([
      capture(),
      capture({ resourceType: 'document' }),                        // a page load, not an API call
      capture({ status: 404 }),                                     // replaying a failure is not learning
      capture({ status: 302 }),
      capture({ contentType: 'text/html' }),                        // an HTML error page answering 200
    ]));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.resourceType).toBe('xhr');
  });
});

describe('compileInjectedCalls - the distillation', () => {
  it('replaces an input value with a hole, in raw and percent-encoded form', () => {
    const calls = compileInjectedCalls(
      redactCaptures([capture({ url: 'https://portal.example/api/cases?ref=2024%2F1&name=Maria' })]),
      { inputs: { ref: '2024/1', name: 'Maria' } },
    );
    expect(calls[0]!.urlTemplate).toBe('https://portal.example/api/cases?ref={{input.ref}}&name={{input.name}}');
  });

  it('deduplicates on the TEMPLATE, so a paginated list is ONE call and not ten', () => {
    const pages = [1, 2, 3, 4].map((page) =>
      capture({ url: `https://portal.example/api/cases?ref=2024-1&page=${page}` }));
    const calls = compileInjectedCalls(redactCaptures(pages), { inputs: { ref: '2024-1' } });
    // The page numbers are not inputs, so they stay literal and the four URLs stay distinct - the
    // dedupe fires on the ref hole. Four distinct pages remain four calls.
    expect(calls).toHaveLength(4);

    const repeats = [capture(), capture(), capture()];
    expect(compileInjectedCalls(redactCaptures(repeats), {})).toHaveLength(1);
  });

  it('marks GET idempotent and POST not - the write gate reads this and never re-derives it', () => {
    const calls = compileInjectedCalls(
      redactCaptures([
        capture(),
        capture({ method: 'POST', url: 'https://portal.example/api/cases', requestBody: '{"title":"new"}' }),
      ]),
      {},
    );
    expect(calls.map((c) => [c.method, c.idempotent])).toEqual([['GET', true], ['POST', false]]);
  });

  it('carries header NAMES onto the compiled call and no values (the branded constructor)', () => {
    const [call] = compileInjectedCalls(redactCaptures([capture()]), {});
    expect(call!.headerNames).toEqual(['accept', 'x-csrf-token']);
    expect(JSON.stringify(call)).not.toContain('"headers"');
  });

  it('records a value-free expectShape from the response, and no data with it', () => {
    const [call] = compileInjectedCalls(redactCaptures([capture()]), {});
    expect(call!.expectShape).toEqual({
      kind: 'object',
      keys: {
        items: { kind: 'array', of: { kind: 'object', keys: { id: { kind: 'number' }, ref: { kind: 'string' } } } },
        total: { kind: 'number' },
      },
    });
    expect(JSON.stringify(call!.expectShape)).not.toContain('2024-1');
  });

  it('DROPS a login-shaped call rather than storing it with a blanked body (trap T8)', () => {
    const calls = compileInjectedCalls(
      redactCaptures([
        capture({ method: 'POST', url: 'https://portal.example/api/login', requestBody: '{"user":"maria","password":"hunter2"}' }),
        capture({ method: 'POST', url: 'https://portal.example/api/search', requestBody: 'q=cases&password=hunter2' }),
        capture(),
      ]),
      {},
    );
    expect(calls.map((c) => c.urlTemplate)).toEqual(['https://portal.example/api/cases?ref=2024-1']);
  });

  it('refuses to hole a secret-shaped INPUT name - a recipe must not say "put the password here"', () => {
    const calls = compileInjectedCalls(
      redactCaptures([capture({ url: 'https://portal.example/api/cases?t=abcdefgh' })]),
      { inputs: { sessionToken: 'abcdefgh' } },
    );
    expect(calls[0]!.urlTemplate).not.toContain('{{input.sessionToken}}');
  });
});

describe('deriveLessons - what a later reader would otherwise have to re-derive', () => {
  it('names the header the session travels on, by NAME', () => {
    const lessons = deriveLessons(redactCaptures([capture()]));
    expect(lessons.some((l) => l.includes('x-csrf-token'))).toBe(true);
    expect(lessons.join(' ')).not.toContain('=');
  });

  it('reports pagination parameters and a metered origin', () => {
    const lessons = deriveLessons(redactCaptures([
      capture({ url: 'https://portal.example/api/cases?page=2&per_page=50' }),
      capture({ responseHeaderNames: ['content-type', 'x-ratelimit-remaining'] }),
    ]));
    expect(lessons.some((l) => l.includes('page') && l.includes('per_page'))).toBe(true);
    expect(lessons.some((l) => l.includes('meters callers'))).toBe(true);
  });

  it('says so out loud when the origin actually threw a 429 during the pass', () => {
    const lessons = deriveLessons(redactCaptures([capture(), capture({ status: 429 })]));
    expect(lessons.some((l) => l.includes('429') && l.includes('must not fan out'))).toBe(true);
  });
});
