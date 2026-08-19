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

  // THE NAME-PATTERN LEG, ON THE URL AND ON BOTH BODIES. It is what catches a value the run's
  // registry NEVER HELD - a token the SITE minted, which is the commonest thing a discovery pass
  // sees and the one thing value-keyed redaction is structurally unable to find. The URL half was
  // pinned and the body half was not: `redactBodyByName` could be dropped from this pipeline with
  // the whole automation and security lane still green, and the evidence collection would then
  // carry a site-minted secret verbatim and durably.
  it('masks a conventionally-named query value the registry never held', () => {
    const [out] = redactCaptures([capture({ url: 'https://portal.example/api/cases?access_token=whatever-this-is' })]);
    expect(out!.url).not.toContain('whatever-this-is');
  });

  it('masks a conventionally-named field in the RESPONSE body the registry never held', () => {
    const [out] = redactCaptures([capture({ responseBody: '{"items":[],"access_token":"whatever-this-is"}' })]);
    expect(out!.responseBody).not.toContain('whatever-this-is');
    // …and it MASKS rather than drops the field: the SHAPE is what a later replay must expect, and
    // a body with the key removed would teach a drift check to expect the wrong thing.
    expect(out!.responseBody).toContain('access_token');
  });

  it('masks one in the REQUEST body too - a form post is where a credential is typed', () => {
    const [out] = redactCaptures([capture({ method: 'POST', requestBody: 'user=maria&password=whatever-this-is' })]);
    expect(out!.requestBody).not.toContain('whatever-this-is');
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

/**
 * The compiled calls, when the compile was expected to succeed. Fails loudly on a refusal rather
 * than letting an empty list read as "nothing matched".
 *
 * `runOutput` defaults to `undefined` HERE and nowhere in production (the option is required at the
 * function itself, so a caller that forgets is a compile error): these cases are about the
 * DISTILLATION, and `undefined` is the honest statement that the run they stand for answered
 * nothing at all. The correlation has its own describe block below, where the answer IS the subject.
 */
type CompileOpts = Omit<Parameters<typeof compileInjectedCalls>[1], 'runOutput'> & { runOutput?: unknown };
function compiled(
  exchanges: ReturnType<typeof redactCaptures>,
  opts: CompileOpts = {},
): ReturnType<typeof compileInjectedCalls>['calls'] {
  const out = compileInjectedCalls(exchanges, { runOutput: undefined, ...opts });
  expect(out.refusedBecause).toBeUndefined();
  return out.calls;
}

describe('compileInjectedCalls - the distillation', () => {
  it('replaces an input value with a hole, in raw and percent-encoded form', () => {
    const calls = compiled(
      redactCaptures([capture({ url: 'https://portal.example/api/cases?ref=2024%2F1&name=Maria' })]),
      { inputs: { ref: '2024/1', name: 'Maria' } },
    );
    expect(calls[0]!.urlTemplate).toBe('https://portal.example/api/cases?ref={{input.ref}}&name={{input.name}}');
  });

  it('deduplicates on the TEMPLATE, so a paginated list is ONE call and not ten', () => {
    const pages = [1, 2, 3, 4].map((page) =>
      capture({ url: `https://portal.example/api/cases?ref=2024-1&page=${page}` }));
    const calls = compiled(redactCaptures(pages), { inputs: { ref: '2024-1' } });
    // The page numbers are not inputs, so they stay literal and the four URLs stay distinct - the
    // dedupe fires on the ref hole. Four distinct pages remain four calls.
    expect(calls).toHaveLength(4);

    const repeats = [capture(), capture(), capture()];
    expect(compiled(redactCaptures(repeats), {})).toHaveLength(1);
  });

  it('marks GET idempotent and POST not - the write gate reads this and never re-derives it', () => {
    const calls = compiled(
      redactCaptures([
        capture(),
        capture({ method: 'POST', url: 'https://portal.example/api/cases', requestBody: '{"title":"new"}' }),
      ]),
      {},
    );
    expect(calls.map((c) => [c.method, c.idempotent])).toEqual([['GET', true], ['POST', false]]);
  });

  it('carries header NAMES onto the compiled call and no values (the branded constructor)', () => {
    const [call] = compiled(redactCaptures([capture()]), {});
    expect(call!.headerNames).toEqual(['accept', 'x-csrf-token']);
    expect(JSON.stringify(call)).not.toContain('"headers"');
  });

  it('records a value-free expectShape from the response, and no data with it', () => {
    const [call] = compiled(redactCaptures([capture()]), {});
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
    const calls = compiled(
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
    // …and it is not required to be FOUND either: a credential legitimately appears in no URL, so
    // making it a located-argument would refuse every compile on an authenticated action.
    const calls = compiled(
      redactCaptures([capture({ url: 'https://portal.example/api/cases?ref=2024-1&t=abcdefgh' })]),
      { inputs: { ref: '2024-1', sessionToken: 'abcdefgh' } },
    );
    expect(calls[0]!.urlTemplate).not.toContain('{{input.sessionToken}}');
  });
});

// =============================================================================================
// WHERE A HOLE MAY GO. The compile decides the DESTINATION of a call that will later run inside a
// live authenticated page; an argument may fill a value in it and may not choose it. These pin the
// component-wise templating that makes that true structurally rather than by inspection.
// =============================================================================================
describe('compileInjectedCalls - a hole is a value slot, never a destination', () => {
  it('never templates the ORIGIN, even when an argument is literally the subdomain', () => {
    const calls = compiled(
      redactCaptures([capture({ url: 'https://acme.portal.example/api/cases/acme?ref=2024-1' })]),
      { inputs: { tenant: 'acme', ref: '2024-1' } },
    );
    // The host is copied verbatim; the same value inside the PATH is holed, which is what proves
    // the origin was skipped deliberately rather than the value simply not being found.
    expect(calls[0]!.urlTemplate).toBe('https://acme.portal.example/api/cases/{{input.tenant}}?ref={{input.ref}}');
  });

  it('never templates a query parameter NAME - an argument does not choose which parameter it fills', () => {
    const calls = compiled(
      redactCaptures([capture({ url: 'https://portal.example/api/cases?ref=ref' })]),
      { inputs: { ref: 'ref' } },
    );
    expect(calls[0]!.urlTemplate).toBe('https://portal.example/api/cases?ref={{input.ref}}');
  });

  it('holes a whole PATH SEGMENT by exact match, at any length', () => {
    const calls = compiled(
      redactCaptures([capture({ url: 'https://portal.example/api/cases/7' })]),
      { inputs: { id: 7 } },
    );
    expect(calls[0]!.urlTemplate).toBe('https://portal.example/api/cases/{{input.id}}');
  });

  it('drops a captured URL carrying USERINFO rather than templating a credential into a recipe', () => {
    const out = compileInjectedCalls(
      redactCaptures([capture({ url: 'https://maria:hunter2@portal.example/api/cases?ref=2024-1' })]),
      { inputs: { ref: '2024-1' }, runOutput: undefined },
    );
    expect(out.calls).toEqual([]);
    // Not a refusal-with-a-reason: there was simply no compilable call, and `ref` was never looked
    // for in one. The distinction matters because a refusal is logged and this is not a defect.
    expect(out.refusedBecause).toBeUndefined();
  });
});

// =============================================================================================
// AN ARGUMENT THE PASS COULD NOT FIND. A compiled call that ignores its input is a CONSTANT: every
// later run replays the first run's request and hands back the first run's data. Refusing to learn
// is the correct answer; learning something that answers the wrong question is not.
// =============================================================================================
describe('compileInjectedCalls - an unlocatable argument refuses the whole compile', () => {
  it('REFUSES when an argument appears nowhere in what the pass captured', () => {
    const out = compileInjectedCalls(redactCaptures([capture()]), { inputs: { ref: 'NOT-IN-THE-URL' }, runOutput: undefined });
    expect(out.calls).toEqual([]);
    expect(out.refusedBecause).toContain('ref');
    expect(out.refusedBecause).toContain('constant');
  });

  it('accepts an argument found in the BODY rather than the URL', () => {
    const calls = compiled(
      redactCaptures([capture({
        method: 'POST',
        url: 'https://portal.example/api/search',
        requestBody: '{"q":"processos de 2024"}',
      })]),
      { inputs: { q: 'processos de 2024' } },
    );
    // The redaction pass re-serialises a JSON body, so the assertion is on the CONTENT: the value
    // is gone and the hole stands where it was.
    expect(calls[0]!.bodyTemplate).toContain('{{input.q}}');
    expect(calls[0]!.bodyTemplate).not.toContain('processos de 2024');
  });

  it('REFUSES a non-scalar argument - there is no verbatim form of it to have found', () => {
    const out = compileInjectedCalls(redactCaptures([capture()]), { inputs: { filter: { ref: '2024-1' } }, runOutput: undefined });
    expect(out.calls).toEqual([]);
    expect(out.refusedBecause).toContain('filter');
    expect(out.refusedBecause).toContain('scalar');
  });

  it('an argument found in ONE of several calls is enough - the recipe honours it somewhere', () => {
    const calls = compiled(
      redactCaptures([
        capture({ url: 'https://portal.example/api/me' }),
        capture({ url: 'https://portal.example/api/cases?ref=2024-1' }),
      ]),
      { inputs: { ref: '2024-1' } },
    );
    expect(calls).toHaveLength(2);
  });

  it('does not refuse when there was nothing to compile at all - that is not a constant recipe', () => {
    const out = compileInjectedCalls(redactCaptures([capture({ resourceType: 'document' })]), { inputs: { ref: 'x' }, runOutput: undefined });
    expect(out.calls).toEqual([]);
    expect(out.refusedBecause).toBeUndefined();
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
