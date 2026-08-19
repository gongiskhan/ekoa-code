/**
 * The DAEMON WIRE additions of the discovery spine (slices P2.2 / P2.3), as a contract.
 *
 * `shared/src/ekoa-local.ts` is a wire: Cortex builds these frames and a separate process, compiled
 * separately, parses them. Neither side's unit tests can catch a divergence, which is exactly why
 * the schemas live in `shared/` at all - so this suite pins the two things a wire has to promise.
 *
 * RULE 7 (ADDITIVE). Every pre-existing frame must still parse unchanged: a Cortex that predates
 * this slice sends no `captures`, and a daemon that predates it sends no `injectedCall`. Both are
 * asserted below, because "additive" is a claim about the OLD shapes, not the new ones.
 *
 * THE SAFETY PROPERTY IS STRUCTURAL. `LocalBrowserCapture` has no field a header VALUE could
 * occupy - not "must not carry one", CANNOT. The suite proves the schema strips an attempt rather
 * than trusting the two implementations to agree about it.
 *
 * NO HTTP ENDPOINT is added by this slice, so there is no descriptor to add to the schema-coverage
 * allowlist and no OpenAPI regeneration: a recipe never reaches the public wire by design
 * (`actionsWithoutRecipes` strips it at all three read boundaries), and discovery is an internal
 * service entry, not a route. The gate that would catch an accidental endpoint - `schema-coverage`
 * with its pinned PENDING count - is unchanged and still green, which is the evidence for that.
 */
import { describe, it, expect } from 'vitest';
import {
  LocalBrowserCapture,
  LocalBrowserCaptureOp,
  LocalBrowserInjectedCall,
  LocalBrowserInjectedCallResult,
  LocalBrowserObservation,
  LocalBrowserStepInput,
} from '@ekoa/shared';

describe('LocalBrowserStepInput stays a union of mutually exclusive arms', () => {
  it('accepts the two pre-existing arms unchanged (Rule 7: additive)', () => {
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', leaseId: 'l1', action: { action: 'screenshot' } }).success).toBe(true);
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', leaseId: 'l1', leaseOp: 'release' }).success).toBe(true);
    // A Cortex that predates `leaseId` entirely - the daemon falls back to the runId.
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', action: { action: 'screenshot' } }).success).toBe(true);
  });

  it('accepts the two new arms', () => {
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', leaseId: 'l1', captureOp: 'start' }).success).toBe(true);
    expect(LocalBrowserStepInput.safeParse({
      owner: 'u1',
      leaseId: 'l1',
      injectedCall: { method: 'GET', url: 'https://portal.example/api/cases', headerNames: ['x-csrf-token'] },
    }).success).toBe(true);
  });

  it('refuses a capture op it does not know, rather than approximating it', () => {
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', captureOp: 'drain' }).success).toBe(false);
    expect(LocalBrowserCaptureOp.safeParse('pause').success).toBe(false);
  });

  it('keeps the capture ops OFF the page vocabulary - no resolver can emit one', () => {
    // Everything in `LocalBrowserAction` is something a model may return for a step. "Record every
    // request this authenticated page makes" must never be one bad completion away.
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', action: { action: 'capture' } }).success).toBe(false);
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', action: { action: 'start_capture' } }).success).toBe(false);
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', action: { action: 'inject' } }).success).toBe(false);
  });
});

describe('LocalBrowserCapture cannot express a header value', () => {
  it('parses names and bodies and STRIPS an attempt to smuggle a header map through', () => {
    const parsed = LocalBrowserCapture.parse({
      method: 'GET',
      url: 'https://portal.example/api/cases',
      requestHeaderNames: ['x-csrf-token'],
      responseHeaderNames: ['content-type'],
      status: 200,
      responseBody: '{"items":[]}',
      // Not fields of the schema. zod's default object mode drops unknown keys, so a daemon that
      // added them would find them gone at the boundary rather than persisted.
      requestHeaders: { 'x-csrf-token': 'LIVE-VALUE' },
      cookies: 'sid=deadbeef',
    });
    expect(JSON.stringify(parsed)).not.toContain('LIVE-VALUE');
    expect(JSON.stringify(parsed)).not.toContain('deadbeef');
    expect(parsed.requestHeaderNames).toEqual(['x-csrf-token']);
  });

  it('requires both name arrays - a capture with no names taught nothing and is malformed', () => {
    expect(LocalBrowserCapture.safeParse({ method: 'GET', url: 'https://x.example/' }).success).toBe(false);
  });
});

describe('LocalBrowserObservation carries the new payloads additively', () => {
  it('still parses an observation from a daemon that predates both fields', () => {
    const parsed = LocalBrowserObservation.parse({
      url: 'https://portal.example/',
      title: 'Cases',
      domShapeSketch: 'tags:div=3|roles:|landmarks:1',
      viewport: { w: 1280, h: 800 },
    });
    expect(parsed.captures).toBeUndefined();
    expect(parsed.injectedCall).toBeUndefined();
  });

  it('parses captures and an injected-call verdict when they are present', () => {
    const parsed = LocalBrowserObservation.parse({
      url: 'https://portal.example/',
      captures: [{ method: 'GET', url: 'https://portal.example/api/cases', requestHeaderNames: [], responseHeaderNames: [] }],
      injectedCall: { status: 200, ok: true, bodyText: '{}', responseHeaderNames: ['content-type'] },
    });
    expect(parsed.captures).toHaveLength(1);
    expect(parsed.injectedCall?.status).toBe(200);
  });
});

describe('LocalBrowserInjectedCall / Result', () => {
  it('asks for header NAMES and has no slot for their values', () => {
    const parsed = LocalBrowserInjectedCall.parse({
      method: 'POST',
      url: 'https://portal.example/api/cases',
      headerNames: ['x-csrf-token'],
      headers: { 'x-csrf-token': 'LIVE-VALUE' },
      body: '{"ref":"2024-1"}',
      contentType: 'application/json',
    });
    expect(JSON.stringify(parsed)).not.toContain('LIVE-VALUE');
  });

  it('answers response header NAMES only', () => {
    const parsed = LocalBrowserInjectedCallResult.parse({
      status: 200,
      ok: true,
      bodyText: '{}',
      responseHeaderNames: ['set-cookie'],
      responseHeaders: { 'set-cookie': 'sid=deadbeef' },
    });
    expect(JSON.stringify(parsed)).not.toContain('deadbeef');
    expect(parsed.responseHeaderNames).toEqual(['set-cookie']);
  });

  it('refuses a non-positive timeout rather than treating it as "no timeout"', () => {
    expect(LocalBrowserInjectedCall.safeParse({ method: 'GET', url: 'https://x.example/', headerNames: [], timeoutMs: 0 }).success).toBe(false);
    expect(LocalBrowserInjectedCall.safeParse({ method: 'GET', url: 'https://x.example/', headerNames: [], timeoutMs: -1 }).success).toBe(false);
  });
});
