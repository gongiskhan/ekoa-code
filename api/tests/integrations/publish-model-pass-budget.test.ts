import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * THE PUBLISH MODEL PASS IS DEADLINED (slice S6 review round four, MINOR-3).
 *
 * `scrubForPublish` is documented as degrading to the deterministic floor whenever the chokepoint
 * model pass FAILS, and every other suite in this slice exercises that by booting without a model
 * credential, so the call throws. A throw was never the dangerous case. The dangerous case is a
 * provider that ACCEPTS the connection and then never answers: not a throw, not a rejection, nothing
 * for `scrubForPublish`'s catch to catch - the publish simply waits for as long as the socket stays
 * open, with a super-admin's HTTP request held behind it.
 *
 * That exposure predates this slice on `POST …/publish`. What made it worth arming is that S6 folded
 * `POST …/global` `{global:true}` into the same path, so a door that used to be a single store write
 * came to sit behind an un-deadlined network call.
 *
 * WHY THIS FILE MOCKS `llm/index.js` WHEN THE REST OF THE SLICE REFUSES TO STUB ANYTHING. The
 * property under test is a TIMEOUT around a call that never returns, and there is no way to make the
 * real chokepoint hang on demand: without a credential it fails fast, and with one it answers. The
 * mock is the narrowest thing that can express "the provider is reachable and silent" - it records
 * the options it was handed and returns a promise that settles ONLY when the signal aborts. Nothing
 * about the scrub, the floor or the failure posture is stubbed; those are the real implementations
 * and the assertions below run through them.
 *
 * The `modelPass` seam the other suites use (`opts.modelPass`) cannot be used here: it REPLACES
 * `chokepointModelPass`, and `chokepointModelPass` is exactly what carries the deadline.
 */
const h = vi.hoisted(() => ({ calls: [] as Array<{ signal?: AbortSignal; maxTokens?: number }> }));

vi.mock('../../src/llm/index.js', () => ({
  /** A provider that accepts the connection and never answers. Settles only on abort. */
  completeFast: (opts: { signal?: AbortSignal; maxTokens?: number }) =>
    new Promise((_resolve, reject) => {
      h.calls.push({ signal: opts.signal, maxTokens: opts.maxTokens });
      opts.signal?.addEventListener('abort', () => reject(new Error('LLM call aborted')));
    }),
}));

const { chokepointModelPass, scrubForPublish, MODEL_PASS_BUDGET_MS } =
  await import('../../src/integrations/publish-scrub.js');

const FIELDS = [{ path: 'skillMd', text: 'the api key is written out as an English sentence here' }];

afterEach(() => {
  vi.useRealTimers();
  h.calls.length = 0;
});

/** `'pending'` unless `settled` has already resolved - `Promise.race` subscribes in array order, so
 *  an already-settled first entry always wins against an already-resolved sentinel. Used instead of
 *  awaiting the call directly so that a MISSING deadline fails on an assertion rather than by
 *  exhausting the test timeout. */
const stateOf = (settled: Promise<string>) => Promise.race([settled, Promise.resolve('pending')]);

describe('the chokepoint model pass abandons a provider that never answers', () => {
  it('hands `completeFast` an abort signal, which is the only thing that can ever cancel it', async () => {
    vi.useFakeTimers();
    const settled = chokepointModelPass({ fields: FIELDS, billeeUserId: 'u1' })
      .then(() => 'resolved', () => 'rejected');

    expect(h.calls, 'the pass really did reach the chokepoint').toHaveLength(1);
    expect(
      h.calls[0]!.signal,
      'without a signal on the wire the timer below has nothing to cancel',
    ).toBeInstanceOf(AbortSignal);
    expect(h.calls[0]!.signal!.aborted, 'and it is live, not a pre-aborted placeholder').toBe(false);

    await vi.advanceTimersByTimeAsync(MODEL_PASS_BUDGET_MS + 1);
    expect(await stateOf(settled), 'and the signal is the one the timer fires').toBe('rejected');
  });

  it('rejects AT the budget - not before it, and not never', async () => {
    vi.useFakeTimers();
    const settled = chokepointModelPass({ fields: FIELDS, billeeUserId: 'u1' })
      .then(() => 'resolved', () => 'rejected');

    // NOT BEFORE: a deadline that fires early would turn every slow-but-working publish into a
    // degraded one, which is the opposite failure and just as silent.
    await vi.advanceTimersByTimeAsync(MODEL_PASS_BUDGET_MS - 1);
    expect(await stateOf(settled), 'still waiting one tick short of the budget').toBe('pending');

    // AND NOT NEVER.
    await vi.advanceTimersByTimeAsync(2);
    expect(await stateOf(settled), 'abandoned at the budget').toBe('rejected');
  });

  it('the timeout DEGRADES to the floor and records it - it never refuses, and never publishes raw', async () => {
    // The posture the module header states: the floor is the control and the model is the second
    // net, so losing the net costs the artifact its second pass and nothing else. Asserted end to
    // end through the real `scrubForPublish`, because "the deadline fires" and "the deadline leaves
    // the publish in the documented state" are two different claims.
    vi.useFakeTimers();
    const planted = ['sk', '_live_', '4kQw8ErT2yU6iO0pA3sD7fG1hJ5kL9zX'].join('');
    const scrubbing = scrubForPublish(
      {
        config: { integrationKey: 'k', displayName: 'Probe', description: 'd', configSchema: [], actions: [] },
        skillMd: `# probe\n\napi_key: ${planted}\n`,
      },
      { billeeUserId: 'u1' },
    );
    await vi.advanceTimersByTimeAsync(MODEL_PASS_BUDGET_MS + 1);
    // Raced against an already-resolved sentinel rather than awaited, for the same reason `stateOf`
    // exists above: with no deadline this promise never settles, and a missing one should fail on an
    // assertion that names the property rather than by exhausting the test timeout.
    const res = await Promise.race([scrubbing, Promise.resolve(null)]);
    expect(res, 'the scrub must SETTLE at the budget rather than wait on the provider').not.toBeNull();

    expect(res!.modelPass.status, 'the degradation is RECORDED on the artifact').toBe('failed');
    expect(res!.modelPass.reason, 'and it says the call was aborted, not that it returned nothing').toMatch(/abort/i);
    // THE CONTROL: the floor still ran, so the timeout cost the second net and not the first.
    expect(res!.content.skillMd).not.toContain(planted);
    expect(res!.content.skillMd).toContain('[REDACTED]');
  });
});
