/**
 * @vitest-environment jsdom
 *
 * operator-run E2 — BEHAVIOURAL tests for the same-document tour player.
 *
 * The player is a framework-free browser ES module; here we import and DRIVE it in
 * jsdom (stubbing window.__ekoaActions + the fetch) to pin the lifecycle invariants
 * the Codex review flagged — cancel()/double-start must abort an in-flight run so a
 * late-appearing target never redraws or wedges (finding 1) — and the
 * external-image-step path containment (finding 3). The source-contract assertions
 * live in tour-player.test.ts; these prove the RUNTIME behaviour.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';

// jsdom provides window/document at runtime; the test project compiles WITHOUT the DOM lib
// (adding it globally breaks Node fetch typings in src), so declare the two globals locally.
declare const window: any;
declare const document: any;
// The player is an untyped browser asset (compiled into the platform panel-runtime, outside
// the api src project) - declare the one import this suite drives rather than typing the module.
// @ts-expect-error no declaration file for the panel-runtime browser asset
import { createTourPlayer } from '../../assets/panel-runtime/src/tour-player.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stub the C3 runtime and record every draw so a test can assert what was (not) drawn. */
function stubRuntime() {
  const calls = { spotlight: [] as Array<{ target: string }>, clearSpotlight: 0, execute: [] as unknown[] };
  (window as any).__ekoaActions = {
    spotlight: (target: string) => {
      calls.spotlight.push({ target });
      return Promise.resolve(true);
    },
    clearSpotlight: () => {
      calls.clearSpotlight += 1;
    },
    execute: (action: unknown) => {
      calls.execute.push(action);
      return Promise.resolve({ status: 'done' });
    },
  };
  return calls;
}

/** Plant a data-demo-target element (jsdom has no layout, so give it a non-zero box). */
function present(name: string) {
  const el = document.createElement('div');
  el.setAttribute('data-demo-target', name);
  el.getBoundingClientRect = () =>
    ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0, toJSON() {} }) as any;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  (window as any).__EKOA_APP_ID = 'app-test';
});

describe('E2 tour player — abort + single-flight (jsdom)', () => {
  it('cancel() during a spotlight target-poll never draws and never wedges', async () => {
    const calls = stubRuntime();
    const states: any[] = [];
    const player = createTourPlayer({ onState: (s: any) => states.push(s) });
    // target "late" is ABSENT -> the spotlight step parks in the abortable target poll
    void player.start({
      version: 1,
      appId: 'app-test',
      steps: [{ id: 's', type: 'spotlight', target: 'late', copy: { titlePt: 't', bodyPt: 'b' } }],
    });
    await tick(60); // reach the poll
    expect(calls.spotlight.length).toBe(0); // nothing drawn yet (target absent)

    player.cancel();
    present('late'); // a LEAKED runtime poll would now draw + the run would resume/wedge
    await tick(400);

    expect(calls.spotlight.length).toBe(0); // the cancelled run never drew
    expect(states[states.length - 1].status).toBe('cancelled');
    expect(states.some((s) => s.status === 'done')).toBe(false); // no wedge-through to done
  });

  it('happy path: draws the spotlight, advances on next(), reaches done and clears', async () => {
    const calls = stubRuntime();
    present('t1');
    const states: any[] = [];
    const player = createTourPlayer({ onState: (s: any) => states.push(s) });
    void player.start({
      version: 1,
      appId: 'app-test',
      steps: [{ id: 's1', type: 'spotlight', target: 't1', copy: { titlePt: 'T', bodyPt: 'b' } }],
    });
    await tick(60);
    expect(calls.spotlight.map((c) => c.target)).toEqual(['t1']); // drawn on the real target
    expect(states.some((s) => s.status === 'playing' && s.stepIndex === 0)).toBe(true); // parked at step 0

    player.next(); // Seguinte
    await tick(40);
    expect(states[states.length - 1].status).toBe('done'); // advanced to completion
    expect(calls.clearSpotlight).toBeGreaterThanOrEqual(1); // spotlight cleared on advance/done
  });

  it('a second start() supersedes the first — exactly one live run draws', async () => {
    const calls = stubRuntime();
    present('present-b');
    const player = createTourPlayer({ onState: () => {} });

    void player.start({
      version: 1,
      appId: 'app-test',
      steps: [{ id: 'a1', type: 'spotlight', target: 'late-a', copy: { titlePt: 'A', bodyPt: 'a' } }],
    });
    await tick(60); // run A parks polling for the absent "late-a"
    void player.start({
      version: 1,
      appId: 'app-test',
      steps: [{ id: 'b1', type: 'spotlight', target: 'present-b', copy: { titlePt: 'B', bodyPt: 'b' } }],
    });
    await tick(80);

    // only run B drew (its target exists); run A was superseded before drawing
    expect(calls.spotlight.map((c) => c.target)).toEqual(['present-b']);

    present('late-a'); // run A's target appears LATE -> the superseded run must NOT draw
    await tick(400);
    expect(calls.spotlight.map((c) => c.target)).toEqual(['present-b']);
  });
});

describe('E2 tour player — external-image containment (jsdom)', () => {
  it('skips a traversal image path (never builds a fetched URL for it)', async () => {
    stubRuntime();
    const states: any[] = [];
    const player = createTourPlayer({ onState: (s: any) => states.push(s) });
    void player.start({
      version: 1,
      appId: 'app-test',
      steps: [{ id: 'img', type: 'external-image-step', image: '../../app-assistant', copy: { titlePt: 't', bodyPt: 'b' } }],
    });
    await tick(60);
    const last = states[states.length - 1];
    expect(last.imageBlocked).toBe(true);
    expect(last.imageUrl).toBeUndefined();
  });

  it('renders a safe demo-asset image at the URL the serving route actually mounts', async () => {
    stubRuntime();
    const states: any[] = [];
    const player = createTourPlayer({ onState: (s: any) => states.push(s) });
    void player.start({
      version: 1,
      appId: 'app-test',
      // citius-portal.svg is the image the 28 shipped platform specs use; serving.ts
      // mounts expressStatic(demoAssetsDir()) at "/api/demos/assets" and the file lives
      // at api/assets/demos/assets/citius-portal.svg — so this exact URL resolves.
      steps: [{ id: 'img', type: 'external-image-step', image: 'citius-portal.svg', copy: { titlePt: 't', bodyPt: 'b' } }],
    });
    await tick(60);
    const last = states[states.length - 1];
    expect(last.imageUrl).toBe('/api/demos/assets/citius-portal.svg');
    expect(last.imageBlocked).toBeFalsy();
  });
});

describe('E2 tour player — annotate-result step (jsdom)', () => {
  it('draws the spotlight on the present result element and advances on next()', async () => {
    const calls = stubRuntime();
    present('resultado'); // the result element the prior await-action produced
    const states: any[] = [];
    const player = createTourPlayer({ onState: (s: any) => states.push(s) });
    void player.start({
      version: 1,
      appId: 'app-test',
      steps: [{ id: 'r', type: 'annotate-result', target: 'resultado', copy: { titlePt: 'Resultado', bodyPt: 'aqui' } }],
    });
    await tick(60);
    expect(calls.spotlight.map((c) => c.target)).toEqual(['resultado']); // annotated the result element
    const parked = states[states.length - 1];
    expect(parked.status).toBe('playing');
    expect(parked.copy.titlePt).toBe('Resultado');

    player.next();
    await tick(40);
    expect(states[states.length - 1].status).toBe('done');
    expect(calls.clearSpotlight).toBeGreaterThanOrEqual(1);
  });
});

describe('E2 tour player — fetch + zero-token (jsdom)', () => {
  it('fetches ONLY GET /api/demos/:appId (never the assistant endpoint); inject-prompt never sends', async () => {
    stubRuntime();
    const fetched: string[] = [];
    const spec = {
      version: 1,
      appId: 'app-test',
      steps: [{ id: 'p', type: 'inject-prompt', surface: 'chat', sendInHarness: false, prompt: 'Olá?', copy: { titlePt: 't', bodyPt: 'b' } }],
    };
    const fetchImpl = (url: string) => {
      fetched.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(spec) } as any);
    };
    const states: any[] = [];
    const player = createTourPlayer({ onState: (s: any) => states.push(s), fetch: fetchImpl });
    void player.start(); // no preSpec -> fetches the tour
    await tick(60);

    expect(fetched).toEqual(['/api/demos/app-test']);
    expect(fetched.some((u) => u.includes('/api/app-assistant'))).toBe(false);
    expect(states.some((s) => s.injectedPrompt === 'Olá?')).toBe(true);
  });
});
