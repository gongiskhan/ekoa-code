import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDemoSpec } from '../../src/services/demo-registry.js';

/**
 * operator-run E2 — the SAME-DOCUMENT tour player that plays a pre-generated
 * declarative tour inside the served app, driven from the assistant panel.
 *
 * The player + its panel wiring + the runtime spotlight hook are browser assets
 * bundled per-app from esm.sh at real build time (like the C3 runtime and the D2
 * panel, they are not in the vitest module stack), so this suite asserts their
 * SOURCE contract; the behavioural loop (playback + zero-token + rebuild
 * selector-stability) lands in the live gate api/tests/e2e/tour-playback.e2e.mjs.
 *
 * The load-bearing invariants:
 *  - the player fetches the tour from GET /api/demos/:appId and NOTHING ELSE over
 *    the network — it NEVER calls /api/app-assistant, so no model turn (no token)
 *    is issued while a tour plays (the zero-token guarantee);
 *  - it handles all six declarative step types;
 *  - inject-prompt only surfaces a suggested prompt, never auto-sends;
 *  - it REUSES the C3 runtime spotlight (window.__ekoaActions.spotlight /
 *    clearSpotlight) rather than redrawing the highlight;
 *  - the panel routes a startTour action + a teach-mode launcher into the player;
 *  - no emoji anywhere (UI-code rule).
 */

const ASSIST = new URL('../../assets/bases/app/scaffold/frontend/src/lib/assistant/', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, ASSIST)), 'utf-8');

const PLAYER_PATH = fileURLToPath(new URL('tour-player.js', ASSIST));
const PLAYER = readFileSync(PLAYER_PATH, 'utf-8');
const PANEL = read('AssistantPanel.jsx');
const CSS = read('AssistantPanel.css');
const RUNTIME = readFileSync(
  fileURLToPath(new URL('../../assets/action-runtime-client.js', import.meta.url)),
  'utf-8',
);

describe('E2 tour player — files exist', () => {
  it('the same-document tour player ships in the app base scaffold', () => {
    expect(existsSync(PLAYER_PATH)).toBe(true);
    expect(PLAYER.length).toBeGreaterThan(0);
  });
});

describe('E2 tour player source contract', () => {
  it('fetches the pre-generated tour from GET /api/demos/:appId, keyed by window.__EKOA_APP_ID', () => {
    expect(PLAYER).toContain('/api/demos/');
    expect(PLAYER).toContain('window.__EKOA_APP_ID');
    // it reads the app id and appends it to the demos endpoint
    expect(PLAYER).toMatch(/DEMOS_ENDPOINT\s*\+\s*encodeURIComponent/);
  });

  it('makes ZERO model calls during playback — it never touches /api/app-assistant', () => {
    // The only network read the player performs is the static tour spec. If this
    // ever references the assistant endpoint, a tour would cost tokens — forbidden.
    expect(PLAYER).not.toContain('/api/app-assistant');
    // Belt-and-braces: the module documents the zero-token invariant explicitly.
    expect(PLAYER).toContain('ZERO TOKENS');
  });

  it('handles all six declarative step types', () => {
    for (const type of [
      "case 'navigate'",
      "case 'spotlight'",
      "case 'annotate-result'",
      "case 'await-action'",
      "case 'inject-prompt'",
      "case 'external-image-step'",
    ]) {
      expect(PLAYER).toContain(type);
    }
  });

  it('inject-prompt surfaces the suggested prompt but NEVER auto-sends', () => {
    expect(PLAYER).toContain('injectedPrompt = step.prompt');
    expect(PLAYER).toContain('NEVER auto-send');
    // there is no send/POST path in the player at all
    expect(PLAYER).not.toMatch(/method:\s*'POST'/);
  });

  it('REUSES the C3 runtime spotlight instead of redrawing the highlight', () => {
    expect(PLAYER).toContain('window.__ekoaActions');
    expect(PLAYER).toMatch(/rt\.spotlight\(/);
    expect(PLAYER).toMatch(/clearSpotlight/);
    // it does NOT build its own overlay/ring DOM — the runtime owns visible UI
    expect(PLAYER).not.toContain('box-shadow: 0 0 0 9999px');
    expect(PLAYER).not.toContain('createElement');
  });

  it('await-action waits for a real user action on the target (or a manual skip)', () => {
    expect(PLAYER).toContain('await-action');
    expect(PLAYER).toContain('data-demo-target="');
    expect(PLAYER).toMatch(/addEventListener\('click'/);
    expect(PLAYER).toContain('result-ready');
    // a safety timeout so an unattended await never hangs the tour forever
    expect(PLAYER).toContain('DEFAULT_AWAIT_TIMEOUT_MS');
  });

  it('navigate reuses the runtime navigate action (no duplicated navigation logic)', () => {
    expect(PLAYER).toMatch(/kind:\s*'navigate'/);
    expect(PLAYER).toMatch(/rt\.execute\(/);
  });

  it('emits a state object the panel reflects (status/stepIndex/total/copy)', () => {
    expect(PLAYER).toContain('onState');
    expect(PLAYER).toContain('status');
    expect(PLAYER).toContain('stepIndex');
    expect(PLAYER).toContain('injectedPrompt');
  });

  it('contains NO emoji (UI-code rule)', () => {
    const m = PLAYER.match(/\p{Extended_Pictographic}/u);
    expect(m, m ? `player emoji: ${JSON.stringify(m[0])}` : '').toBeNull();
  });
});

describe('E2 runtime spotlight hook', () => {
  it('exposes window.__ekoaActions.spotlight + clearSpotlight for same-document tours', () => {
    expect(RUNTIME).toMatch(/spotlight:\s*function/);
    expect(RUNTIME).toMatch(/clearSpotlight:\s*function/);
    expect(RUNTIME).toContain('drawSpotlight');
  });

  it('reuses ONE ring-drawing primitive for the transient highlight and the tour spotlight', () => {
    expect(RUNTIME).toContain('buildRingOverlay');
    // both the transient highlight and the persistent spotlight build on it
    expect(RUNTIME).toMatch(/hlOverlay\s*=\s*buildRingOverlay/);
    expect(RUNTIME).toMatch(/spotlightOverlay\s*=\s*buildRingOverlay/);
  });

  it('the tour spotlight is persistent (not the ~2.5s auto-clear) and separate state', () => {
    expect(RUNTIME).toContain('spotlightOverlay');
    // the spotlight is NOT wired to the HIGHLIGHT_MS auto-clear timer (that is the
    // transient driving highlight only)
    expect(RUNTIME).toMatch(/hlTimer\s*=\s*window\.setTimeout\(clearHighlight, HIGHLIGHT_MS\)/);
    expect(RUNTIME).not.toMatch(/spotlightOverlay[\s\S]{0,80}HIGHLIGHT_MS/);
  });

  it('contains NO emoji (UI-code rule)', () => {
    const m = RUNTIME.match(/\p{Extended_Pictographic}/u);
    expect(m, m ? `runtime emoji: ${JSON.stringify(m[0])}` : '').toBeNull();
  });
});

describe('E2 panel wiring', () => {
  it('imports and builds the same-document tour player', () => {
    expect(PANEL).toContain("import { createTourPlayer } from './tour-player'");
    expect(PANEL).toContain('createTourPlayer(');
    expect(PANEL).toContain('startTourPlayback');
  });

  it('routes a startTour action into the player (not the runtime executor)', () => {
    expect(PANEL).toMatch(/runtimeAction\.kind === 'startTour'/);
    expect(PANEL).toContain('startTourPlayback(runtimeAction.tourId)');
  });

  it('offers a teach-mode launcher that starts playback without a model call', () => {
    expect(PANEL).toContain('Iniciar tutorial guiado');
    expect(PANEL).toMatch(/mode === 'teach'/);
    expect(PANEL).toContain('onClick={() => startTourPlayback()}');
  });

  it('drops an inject-prompt suggestion into the composer but never sends it', () => {
    // onState mirror: a surfaced prompt lands in the draft; there is no auto-send.
    expect(PANEL).toContain('if (state && state.injectedPrompt) setDraft(state.injectedPrompt)');
  });

  it('renders the tour block with the deterministic gate landmarks', () => {
    expect(PANEL).toContain('data-tour-status');
    expect(PANEL).toContain('data-tour-step-index');
    expect(PANEL).toContain('Passo ');
    expect(PANEL).toContain('Seguinte');
  });

  it('contains NO emoji (UI-code rule) — panel and css', () => {
    const inPanel = PANEL.match(/\p{Extended_Pictographic}/u);
    expect(inPanel, inPanel ? `panel emoji: ${JSON.stringify(inPanel[0])}` : '').toBeNull();
    const inCss = CSS.match(/\p{Extended_Pictographic}/u);
    expect(inCss, inCss ? `css emoji: ${JSON.stringify(inCss[0])}` : '').toBeNull();
  });
});

describe('E2 live-gate tour fixture', () => {
  // The live gate (tests/e2e/tour-playback.e2e.mjs) serves this exact fixture to the
  // panel via a browser-boundary route-fulfill. It is a schema-VALIDATED stub only
  // if it validates against the real demo-spec schema — assert that here.
  const FIXTURE = JSON.parse(
    readFileSync(fileURLToPath(new URL('../e2e/fixtures/e2-overview-tour.json', import.meta.url)), 'utf-8'),
  );

  it('validates against the authoritative demo-spec schema (a schema-validated stub)', () => {
    const { valid, errors } = validateDemoSpec(FIXTURE);
    expect(valid, errors.join('; ')).toBe(true);
  });

  it('exercises the step types the gate drives, targeting rebuild-stable shell landmarks', () => {
    const types = FIXTURE.steps.map((s: { type: string }) => s.type);
    for (const t of ['navigate', 'spotlight', 'await-action', 'inject-prompt']) {
      expect(types).toContain(t);
    }
    const targets = FIXTURE.steps.flatMap((s: { target?: string }) => (s.target ? [s.target] : []));
    // SHELL-CHROME landmarks (App.jsx shell, present on every route + re-emitted on every
    // build → rebuild-stable). NB: NOT home-empty, which lives in the default HomePage
    // placeholder a generated app replaces — it is absent in a real built app.
    expect(targets).toContain('app-nav');
    expect(targets).toContain('app-content');
    expect(targets).not.toContain('home-empty');
  });

  it('never auto-sends the inject-prompt (sendInHarness: false)', () => {
    const inject = FIXTURE.steps.find((s: { type: string }) => s.type === 'inject-prompt');
    expect(inject.sendInHarness).toBe(false);
  });
});

describe('E2 tour player — lifecycle source contract (findings 1 + 2)', () => {
  it('is single-flight + abortable via a generation token checked after every await', () => {
    expect(PLAYER).toContain('generation');
    expect(PLAYER).toMatch(/function isCurrent/);
    expect(PLAYER).toContain('abortPending');
    expect(PLAYER).toMatch(/generation \+= 1/); // start() and cancel() bump the token
    expect(PLAYER).toMatch(/if \(!isCurrent\(gen\)\) return/); // guards after awaits
    // the target wait lives in the PLAYER (abortable), not the runtime's internal poll
    expect(PLAYER).toContain('waitForTarget');
  });

  it('validates external-image-step paths before building a URL (finding 3)', () => {
    expect(PLAYER).toContain('isSafeImagePath');
    expect(PLAYER).toContain('imageBlocked');
  });

  it('the panel cancels the active tour when the panel is collapsed (finding 2)', () => {
    expect(PANEL).toContain('collapsePanel');
    // collapsePanel cancels the player then collapses
    expect(PANEL).toMatch(/collapsePanel[\s\S]{0,160}\.cancel\(\)/);
    expect(PANEL).toContain('onClick={collapsePanel}');
  });
});

describe('demoSpecSchema — external-image-step path containment (finding 3)', () => {
  const specWithImage = (image: string) => ({
    version: 1,
    appId: 'art-img',
    tourId: 'demo',
    kind: 'overview',
    card: { titlePt: 'c', descriptionPt: 'd', durationSec: 10 },
    steps: [{ id: 'img', type: 'external-image-step', image, copy: { titlePt: 't', bodyPt: 'b' } }],
  });

  it('accepts the shipped filename form + safe subpaths (the compat bar)', () => {
    expect(validateDemoSpec(specWithImage('citius-portal.svg')).valid).toBe(true);
    expect(validateDemoSpec(specWithImage('sub/dir/frame.svg')).valid).toBe(true);
  });

  it('rejects traversal / absolute / scheme / backslash image paths', () => {
    for (const bad of ['../../app-assistant', '../frame.svg', '/api/app-assistant', 'http://evil/x', 'a\\b', '..']) {
      expect(validateDemoSpec(specWithImage(bad)).valid, bad).toBe(false);
    }
  });
});
