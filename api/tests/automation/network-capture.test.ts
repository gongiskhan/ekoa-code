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
  it('substitutes a live credential out of a URL and a body - the REGISTRY leg, on each', () => {
    // THE PARAMETER AND FIELD NAMES ARE THE POINT, and they were wrong. `redactCaptures` composes
    // the two legs (`redactUrlByName(secrets.redact(url))` on the URL; `redactStream` on the
    // bodies), and this case used to put the value under `?auth=` - a name `SECRET_KEY_PATTERN`
    // matches - so the NAME leg masked it and the case stayed green with the URL's registry leg
    // deleted entirely. `sid` and `echo`/`seen` match no pattern, so the only thing that can find
    // this value is the run's own registry, and each leg is asserted on its own field.
    const secrets = secretRegistryFromValues(['s3cret-session-token']);
    const [out] = redactCaptures(
      [capture({
        url: 'https://portal.example/api/cases?sid=s3cret-session-token',
        requestBody: '{"echo":"s3cret-session-token"}',
        responseBody: '{"seen":"s3cret-session-token"}',
      })],
      secrets,
    );
    expect(out!.url).not.toContain('s3cret-session-token');
    expect(out!.requestBody).not.toContain('s3cret-session-token');
    expect(out!.responseBody).not.toContain('s3cret-session-token');
    // …and the blanket restatement over the whole exchange, which catches a field a later slice
    // adds and forgets to pass through a leg.
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

describe('compileInjectedCalls - the DECLARED answer, for a run that answered nothing', () => {
  /**
   * WHY THIS MATCHER EXISTS. `extractActionRunOutput` reads the last api_call/ekoa_action step, and
   * a browser-driven automation has neither - so `runOutput` is undefined for EVERY shipped
   * browser-only package, `answerCallIndex` was always absent, and `ReplayResult.data` was always
   * undefined. That was documented as a property ("its replay answers nothing either"), and it is
   * true, but it also means `listar_documentos_processo` can never answer ANYTHING, learned or not:
   * a lawyer asks the assistant which documents a process holds, the run completes, the reply is
   * empty. Identity is not merely absent here, it is unreachable.
   *
   * WHAT KEEPS IT FROM BEING THE GUESS THIS MODULE REFUSES: it never ranks and never takes a
   * last-wins. It asks whether a captured body carries every property the ACTION'S OWN
   * `returnSchema` declares, and two candidates is a refusal rather than a tie-break.
   */
  const documentos = () => capture({
    url: 'https://portal.example/api/processo/1234/documentos?pagina=1',
    responseBody: '{"processo":"1234","documentos":[{"nome":"Contestacao.pdf"}],"total":1}',
  });
  /** The ordinary internal call underneath the flow - a notification badge, a session ping. It is
   *  the call "the last JSON body" would wrongly hand back. */
  const noise = () => capture({
    url: 'https://portal.example/api/badge?processo=1234',
    responseBody: '{"unread":3}',
  });

  it('names the call whose body carries every DECLARED property', () => {
    const out = compileInjectedCalls(redactCaptures([documentos()]), {
      inputs: { processo: '1234' },
      runOutput: undefined,
      declaredAnswerKeys: ['processo', 'documentos', 'total'],
    });
    expect(out.refusedBecause).toBeUndefined();
    expect(out.answerCallIndex).toBe(0);
    expect(out.answerMatchedBy).toBe('declared-return-shape');
  });

  it('is not "the last JSON call" - the noise underneath the flow does not become the answer', () => {
    const out = compileInjectedCalls(redactCaptures([documentos(), noise()]), {
      inputs: { processo: '1234' },
      runOutput: undefined,
      declaredAnswerKeys: ['processo', 'documentos', 'total'],
    });
    // The badge call is captured and compiled, and is emphatically NOT the answer.
    expect(out.calls.length).toBe(2);
    expect(out.answerCallIndex).toBe(0);
  });

  it('REFUSES to choose when two captured bodies both satisfy the declaration', () => {
    const otherEndpoint = capture({
      url: 'https://portal.example/api/anexos?processo=1234',
      responseBody: '{"processo":"1234","documentos":[{"nome":"Outro.pdf"}],"total":1}',
    });
    const ambiguous = compileInjectedCalls(redactCaptures([documentos(), otherEndpoint]), {
      inputs: { processo: '1234' },
      runOutput: undefined,
      declaredAnswerKeys: ['processo', 'documentos', 'total'],
    });
    expect(ambiguous.calls.length).toBe(2);
    // Answering nothing is strictly better than answering the wrong body under success:true.
    expect(ambiguous.answerCallIndex).toBeUndefined();
    expect(ambiguous.answerMatchedBy).toBeUndefined();
  });

  it('A PAGINATED LIST REFUSES, and that is the honest answer rather than a shortfall', () => {
    // THE LIMIT OF THIS MATCHER, pinned so nobody discovers it in production. `pagina` is the
    // automation's own paging, not a caller argument, so it is never holed and the two pages do NOT
    // dedupe to one template: they are two compiled calls, both satisfying the declaration, so the
    // matcher refuses.
    //
    // AND REFUSING IS RIGHT. The authored run's answer for a paginated action is the AGGREGATE the
    // vision pass walked, which no single captured body equals - so naming page 1 as "the answer"
    // would silently drop every later page under `success: true`, which is exactly the quiet
    // wrongness the identity matcher was written to prevent. Serving these actions needs a replay
    // that can follow pagination, which is a feature and not a matcher.
    //
    // CONSEQUENCE, stated plainly: the shipped `listar_documentos_processo` and
    // `consultar_notificacoes` are both paginated, so they still answer nothing. The single-resource
    // actions (`consultar_processo`, `obter_documento`) are the ones this closes.
    const page2 = capture({
      url: 'https://portal.example/api/processo/1234/documentos?pagina=2',
      responseBody: '{"processo":"1234","documentos":[{"nome":"Sentenca.pdf"}],"total":1}',
    });
    const out = compileInjectedCalls(redactCaptures([documentos(), page2]), {
      inputs: { processo: '1234' },
      runOutput: undefined,
      declaredAnswerKeys: ['processo', 'documentos', 'total'],
    });
    expect(out.calls.length).toBe(2);               // two pages, two templates, two calls
    expect(out.answerCallIndex).toBeUndefined();    // and no answer, deliberately
  });

  it('a body missing ONE declared property is not the answer', () => {
    const partial = capture({ responseBody: '{"processo":"1234","documentos":[]}' }); // no `total`
    const out = compileInjectedCalls(redactCaptures([partial]), {
      inputs: { processo: '1234' },
      runOutput: undefined,
      declaredAnswerKeys: ['processo', 'documentos', 'total'],
    });
    expect(out.answerCallIndex).toBeUndefined();
  });

  it('an ARRAY or scalar body cannot satisfy a declaration of named properties', () => {
    for (const body of ['[{"processo":"1234"}]', '"just a string"', 'null', '42']) {
      const out = compileInjectedCalls(redactCaptures([capture({ responseBody: body })]), {
        inputs: { processo: '1234' },
        runOutput: undefined,
        declaredAnswerKeys: ['processo'],
      });
      expect(out.answerCallIndex, body).toBeUndefined();
    }
  });

  it('NEVER overrides or stands in for an identity match', () => {
    // With a real runOutput the strong matcher decides, and the declared one must not speak at all.
    const ANSWER = { unread: 3 };
    const out = compileInjectedCalls(redactCaptures([documentos(), noise()]), {
      inputs: { processo: '1234' },
      runOutput: ANSWER,
      declaredAnswerKeys: ['processo', 'documentos', 'total'],
    });
    expect(out.answerCallIndex).toBe(1);              // the badge - because the RUN said so
    expect(out.answerMatchedBy).toBe('run-output-identity');
  });

  it('declares nothing => answers nothing, exactly as before this matcher existed', () => {
    const out = compileInjectedCalls(redactCaptures([documentos()]), {
      inputs: { processo: '1234' },
      runOutput: undefined,
    });
    expect(out.answerCallIndex).toBeUndefined();
    expect(out.answerMatchedBy).toBeUndefined();
  });

  it('still REFUSES a declared answer whose call cannot carry the caller\'s argument', () => {
    // The guard that stops every later caller being handed THIS run's process. The declared matcher
    // does not bypass it: the argument reaches the wire via the badge call but not via the answer.
    const answerWithoutTheArg = capture({
      url: 'https://portal.example/api/documentos/recentes',
      responseBody: '{"processo":"1234","documentos":[],"total":0}',
    });
    const carriesTheArg = capture({ url: 'https://portal.example/api/badge?processo=1234', responseBody: '{"unread":1}' });
    const out = compileInjectedCalls(redactCaptures([answerWithoutTheArg, carriesTheArg]), {
      inputs: { processo: '1234' },
      runOutput: undefined,
      declaredAnswerKeys: ['processo', 'documentos', 'total'],
    });
    expect(out.calls).toEqual([]);
    expect(out.refusedBecause).toMatch(/reach the wire but not the call that produced/);
  });
});

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

// =============================================================================================
// …AND THE UNION IS NOT THE UNIT FOR THE ANSWER.
//
// The rule above is satisfied by an argument placed in ANY compiled call. `answerCallIndex` names
// ONE, `answerOf` hands back THAT call's body, and nothing chains one replayed call into the next -
// so an argument absent from the answer-bearing call cannot change what the action RETURNS however
// faithfully the other calls carry it. The two were never compared, and the gap is reachable by an
// ordinary page: a filtered search plus a constant "summary" endpoint serving the same document.
// =============================================================================================
describe('compileInjectedCalls - the ANSWER-BEARING call must carry the arguments too', () => {
  /** The filtered search: carries `ref`, and its body IS the run's answer. */
  const SEARCH = capture({ url: 'https://portal.example/api/cases?ref=2024-1' });
  /** A constant endpoint serving the SAME document - a default view, a dashboard, a one-off page
   *  state. Same body, so `isTheRunsAnswer` matches it too and LAST MATCH WINS names this one. */
  const CONSTANT_SUMMARY = capture({ url: 'https://portal.example/api/summary' });
  const ANSWER = { items: [{ id: 1, ref: '2024-1' }], total: 1 };

  it('REFUSES when the answer-bearing call has no hole for an argument another call carries', () => {
    const out = compileInjectedCalls(
      redactCaptures([SEARCH, CONSTANT_SUMMARY]),
      { inputs: { ref: '2024-1' }, runOutput: ANSWER },
    );
    // Nothing is stored. Without this rule the recipe stored `answersWith.callIndex = 1` - the
    // summary - and every later caller was handed the 2024-1 document under `success: true`.
    expect(out.calls).toEqual([]);
    expect(out.answerCallIndex).toBeUndefined();
    expect(out.refusedBecause).toContain('ref');
    // Anchored on the phrase this rule owns, so it cannot be satisfied by the RECIPE-wide refusal
    // above ("appear nowhere in what this pass captured"), which is a different fact.
    expect(out.refusedBecause).toContain('not the call that produced this run\'s answer');
  });

  it('…and ACCEPTS the same two calls when the ANSWER is the one that carries the argument', () => {
    // THE CONTROL. Same two endpoints, same argument, same hole-free summary - and the ONLY
    // difference is which captured body the run's answer is identical to. Give the summary a body
    // of its own and the last-match tie disappears: the answer is the SEARCH, which carries `ref`,
    // so the recipe is sound and is stored. Without this case "nothing was compiled" above would
    // also hold for a fixture these exchanges simply cannot be compiled from.
    const distinctSummary = capture({ url: 'https://portal.example/api/summary', responseBody: '{"open":3}' });
    const out = compileInjectedCalls(
      redactCaptures([SEARCH, distinctSummary]),
      { inputs: { ref: '2024-1' }, runOutput: ANSWER },
    );
    expect(out.refusedBecause).toBeUndefined();
    expect(out.calls.map((c) => c.urlTemplate)).toEqual([
      'https://portal.example/api/cases?ref={{input.ref}}',
      'https://portal.example/api/summary',
    ]);
    // The hole-free summary is still IN the recipe - this rule is about the answer, not a filter.
    expect(out.answerCallIndex).toBe(0);
  });

  it('leaves a run that answered NOTHING alone - there is no answer to be constant about', () => {
    // Every browser-only automation this repo ships. No pointer, so the replay answers nothing
    // either, and the recipe-wide rule is the only one there is.
    const out = compileInjectedCalls(
      redactCaptures([SEARCH, CONSTANT_SUMMARY]),
      { inputs: { ref: '2024-1' }, runOutput: undefined },
    );
    expect(out.refusedBecause).toBeUndefined();
    expect(out.calls).toHaveLength(2);
    expect(out.answerCallIndex).toBeUndefined();
  });

  it('does not demand a hole the compile never writes - a SECRET-SHAPED argument name', () => {
    // `inputHoles` skips these on both counts, so demanding one here would refuse every recipe
    // learned by a run that resolved a credential. Read through the compile's own vocabulary.
    const out = compileInjectedCalls(
      redactCaptures([SEARCH, CONSTANT_SUMMARY]),
      { inputs: { ref: '2024-1', api_key: 'never-in-a-url' }, runOutput: ANSWER },
    );
    expect(out.refusedBecause).toContain('ref');
    expect(out.refusedBecause).not.toContain('api_key');
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
