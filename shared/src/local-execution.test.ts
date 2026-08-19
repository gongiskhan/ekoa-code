import { describe, it, expect } from 'vitest';
import {
  BridgeFrame,
  LocalBrowserAction,
  LocalBrowserObservation,
  LocalBrowserStepInput,
  LocalToolInvokeInput,
} from './ekoa-local.js';

/**
 * CONTRACT - the local EXECUTION plane (P1.2/P1.4).
 *
 * Two ends compute this contract independently: Cortex's `DaemonBrowserSession` PRODUCES the
 * invocation (`toDaemonInput` flattens `{kind,...rest}` to `{action:kind,...rest}`) and CONSUMES
 * the observation (`ingest` reads `observation.screenshotB64` plus
 * `observation.data.{url,title,heading,domShapeSketch,accessibilitySnapshot,viewport,assertionPassed}`);
 * the daemon's `tool-executor` does the mirror. Before this schema existed the two agreed only by
 * coincidence, and a field either side dropped was invisible - `ingest` silently ignores anything
 * it does not recognise. These assertions are the pin.
 *
 * RULE 7. Everything here is ADDITIVE: new exports, plus one new OPTIONAL field on an existing
 * member of the frame union. The "old parsers still parse" assertions below are the proof.
 */
// Exactly the PlaywrightAction kinds api/src/automation/types.ts declares, in the FLATTENED
// form toDaemonInput produces. A kind missing here is a step that dies at the daemon boundary.
// The lease lifecycle verbs are absent because they are not page actions at all - they live on
// `LocalBrowserStepInput.leaseOp`, and the describe block below asserts the union REFUSES them
// rather than asserting that this hand-written list happens not to mention them.
const ACTIONS: Array<Record<string, unknown>> = [
  { action: 'navigate', url: 'https://example.test/a' },
  { action: 'click', locator: { strategy: 'role', role: 'button', name: 'Entrar' } },
  { action: 'dblclick', locator: { strategy: 'testid', value: 'row-3' } },
  { action: 'fill', locator: { strategy: 'label', value: 'Email' }, value: 'a@b.test' },
  { action: 'press', key: 'Enter' },
  { action: 'press', key: 'Enter', locator: { strategy: 'css', selector: '#q' } },
  { action: 'select', locator: { strategy: 'label', value: 'País' }, value: 'PT' },
  { action: 'check', locator: { strategy: 'label', value: 'Aceito' } },
  { action: 'uncheck', locator: { strategy: 'label', value: 'Aceito' } },
  { action: 'hover', locator: { strategy: 'text', value: 'Menu' } },
  { action: 'wait', durationMs: 500 },
  { action: 'wait_for', locator: { strategy: 'testid', value: 'grid' }, state: 'visible' },
  { action: 'scroll', direction: 'down' },
  { action: 'scroll', direction: 'up', pixels: 300, locator: { strategy: 'css', selector: 'main' } },
  { action: 'screenshot' },
  { action: 'noop', reason: 'already satisfied' },
  { action: 'expect_visible', locator: { strategy: 'role', role: 'heading' } },
  { action: 'expect_hidden', locator: { strategy: 'testid', value: 'spinner' } },
  { action: 'expect_text', locator: { strategy: 'testid', value: 'total' }, contains: '12' },
  { action: 'expect_url', pattern: '/inbox' },
  { action: 'expect_title', contains: 'Ekoa' },
];

describe('LocalBrowserAction - the vocabulary Cortex sends and the daemon runs', () => {
  it.each(ACTIONS.map((a) => [String(a.action), a] as const))('parses %s', (_name, action) => {
    const r = LocalBrowserAction.safeParse(action);
    expect(r.success, JSON.stringify(r.success ? {} : r.error.issues)).toBe(true);
  });

  it('covers EVERY kind the Cortex executor can resolve - a gap here is a dead step', () => {
    // The list is duplicated deliberately: it is copied from api/src/automation/types.ts, and
    // the point of this assertion is that the copy and the schema cannot drift apart silently.
    const kinds = new Set(ACTIONS.map((a) => a.action));
    for (const kind of [
      'navigate', 'click', 'dblclick', 'fill', 'press', 'select', 'check', 'uncheck', 'hover',
      'wait', 'wait_for', 'scroll', 'screenshot', 'noop',
      'expect_visible', 'expect_hidden', 'expect_text', 'expect_url', 'expect_title',
    ]) {
      expect(kinds.has(kind), `missing action kind: ${kind}`).toBe(true);
      expect(LocalBrowserAction.safeParse({ ...blankFor(kind) }).success, kind).toBe(true);
    }
  });

  it('REFUSES an invented verb - the vocabulary is closed at the trust boundary', () => {
    expect(LocalBrowserAction.safeParse({ action: 'exfiltrate', url: 'x' }).success).toBe(false);
  });

  it('REFUSES an invented locator strategy', () => {
    expect(
      LocalBrowserAction.safeParse({ action: 'click', locator: { strategy: 'xpath', value: '//a' } }).success,
    ).toBe(false);
  });

  it('REFUSES a navigate with no url (the daemon must not guess a destination)', () => {
    expect(LocalBrowserAction.safeParse({ action: 'navigate' }).success).toBe(false);
  });
});

/**
 * CONTRACT - the LEASE LIFECYCLE arm of the browser step payload.
 *
 * The daemon keeps ONE page and ONE cookie jar per lease across every invoke that names it, so two
 * things have to exist on the wire that are not page actions: `release`, which says the run is over
 * (that is where the page is dropped and the injected Cofre session is wiped out of a jar the next
 * run will share), and `keepalive`, which says a live run is still there while it is blocked on a
 * sub-automation, a slow API call, or a human at a CAPTCHA.
 *
 * THEY ARE A SEPARATE ARM OF `LocalBrowserStepInput`, NOT MEMBERS OF `LocalBrowserAction`, and the
 * assertions below are about that separation rather than about taste. Everything in the action
 * union is something a resolver, a planner or the vision tier can emit for a step. A lifecycle verb
 * living there would be one bad model completion away from a step that ends its own run, and the
 * daemon's page runner would need a case for a verb that must never reach a page. Here, that a step
 * cannot end its own run is a property of the SHAPE - and the first test is what fails the moment
 * somebody adds one back to the action union.
 */
describe('the lease lifecycle - release and keepalive', () => {
  it('is NOT part of the page-action vocabulary - a resolver cannot emit one', () => {
    // THE PIN. This replaces an assertion that read `ACTIONS.some(a => a.action === 'release')` -
    // ACTIONS being a literal array declared thirty lines above it, so no change to any source
    // file could ever have turned it red. This one is against the schema itself.
    expect(LocalBrowserAction.safeParse({ action: 'release' }).success).toBe(false);
    expect(LocalBrowserAction.safeParse({ action: 'keepalive' }).success).toBe(false);
    // The other half of the invariant - that Cortex's OWN `PlaywrightAction` union and the two
    // runtime allowlists a resolver's output passes through do not contain them either - cannot be
    // asserted from `shared/`, which may not import `api/` (FIXED-1). It is pinned where it lives:
    // api/tests/automation/lease-verbs-are-not-resolvable.test.ts.
  });

  it('parses on the lifecycle arm, carrying nothing but the op and the lease it names', () => {
    for (const leaseOp of ['release', 'keepalive']) {
      const r = LocalBrowserStepInput.safeParse({ owner: 'u1', leaseId: 'l1', leaseOp });
      expect(r.success, JSON.stringify(r.success ? {} : r.error.issues)).toBe(true);
      if (r.success) expect(r.data).toEqual({ owner: 'u1', leaseId: 'l1', leaseOp });
    }
  });

  it('REFUSES an invented lease op - the lifecycle vocabulary is closed too', () => {
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', leaseOp: 'wipe-everything' }).success).toBe(false);
  });

  it('names an OWNER, like every other frame - it is what scopes the lease to a profile', () => {
    expect(LocalBrowserStepInput.safeParse({ leaseOp: 'release', leaseId: 'l1' }).success).toBe(false);
  });

  it('RULE 7 - the payload GREW: every pre-existing member still parses unchanged', () => {
    for (const action of ACTIONS) {
      expect(LocalBrowserAction.safeParse(action).success, String(action.action)).toBe(true);
      // The step arm as an older Cortex sends it: owner + action, no leaseId at all.
      expect(LocalBrowserStepInput.safeParse({ owner: 'u1', action }).success, String(action.action)).toBe(true);
    }
  });

  it('rides the ordinary browser envelope - same capability, same gates, same ledger row', () => {
    const r = LocalToolInvokeInput.safeParse({
      capability: 'browser',
      input: { owner: 'u1', leaseId: 'l1', leaseOp: 'release' },
      runId: 'r1',
    });
    expect(r.success).toBe(true);
  });

  it('needs the runId - the envelope always says which RUN the frame belongs to', () => {
    expect(
      LocalToolInvokeInput.safeParse({ capability: 'browser', input: { owner: 'u1', leaseOp: 'release' } }).success,
    ).toBe(false);
  });

  it('the two arms are exclusive in practice: a payload with neither is refused', () => {
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', leaseId: 'l1' }).success).toBe(false);
  });
});

/**
 * THE LEASE ID.
 *
 * It is not the runId, and both reasons are load-bearing. A SUB-AUTOMATION is a separate run on the
 * same owner, hence the same daemon and the same profile: keyed by runId it queues behind a lease
 * its parent holds for the whole parent run, while the parent is blocked waiting for it. A RESUMED
 * run (needs_credentials -> unlock -> continue) re-enters under the SAME runId, and the daemon
 * tombstones a lease id when its lease ends, so a per-run key would refuse every resumed pass.
 */
describe('LocalBrowserStepInput.leaseId', () => {
  it('is OPTIONAL, so a Cortex that predates it still parses (the daemon falls back to the runId)', () => {
    const r = LocalBrowserStepInput.safeParse({ owner: 'u1', action: { action: 'screenshot' } });
    expect(r.success).toBe(true);
    if (r.success) expect('leaseId' in r.data).toBe(false);
  });

  it('rides on BOTH arms - a page step and a lifecycle op name the same lease', () => {
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', leaseId: 'l1', action: { action: 'screenshot' } }).success).toBe(true);
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', leaseId: 'l1', leaseOp: 'keepalive' }).success).toBe(true);
  });

  it('is a STRING, not an object the daemon would have to interpret', () => {
    expect(LocalBrowserStepInput.safeParse({ owner: 'u1', leaseId: { id: 'l1' }, action: { action: 'screenshot' } }).success).toBe(false);
  });
});

/** Minimal valid payload per kind, so the coverage assertion above exercises the schema itself. */
function blankFor(kind: string): Record<string, unknown> {
  const loc = { strategy: 'testid', value: 'x' };
  switch (kind) {
    case 'navigate': return { action: kind, url: 'https://x.test' };
    case 'fill': return { action: kind, locator: loc, value: 'v' };
    case 'press': return { action: kind, key: 'Enter' };
    case 'select': return { action: kind, locator: loc, value: 'v' };
    case 'wait': return { action: kind, durationMs: 1 };
    case 'wait_for': return { action: kind, locator: loc, state: 'visible' };
    case 'scroll': return { action: kind, direction: 'down' };
    case 'screenshot': return { action: kind };
    case 'noop': return { action: kind, reason: 'r' };
    case 'expect_text': return { action: kind, locator: loc, contains: 'c' };
    case 'expect_url': return { action: kind, pattern: 'p' };
    case 'expect_title': return { action: kind, contains: 'c' };
    default: return { action: kind, locator: loc };
  }
}

describe('LocalToolInvokeInput - the envelope server.ts puts on the wire', () => {
  it('parses the browser envelope the daemon-connection resolver builds', () => {
    const r = LocalToolInvokeInput.safeParse({
      capability: 'browser',
      input: { owner: 'u1', action: { action: 'navigate', url: 'https://x.test' } },
      stepId: 's1',
      runId: 'r1',
    });
    expect(r.success).toBe(true);
  });

  it('parses the bash envelope local-command.ts builds (argv, not a command string)', () => {
    const r = LocalToolInvokeInput.safeParse({
      capability: 'bash',
      input: { argv: ['echo', 'hi'], cwd: '/tmp', stdin: undefined, timeoutMs: 1000 },
      runId: 'r1',
    });
    expect(r.success).toBe(true);
  });

  it('REFUSES a capability outside the two the executor implements', () => {
    expect(LocalToolInvokeInput.safeParse({ capability: 'ssh', input: {}, runId: 'r' }).success).toBe(false);
  });
});

describe('LocalBrowserObservation - exactly what DaemonBrowserSession.ingest reads', () => {
  it('accepts the full envelope', () => {
    const r = LocalBrowserObservation.safeParse({
      url: 'https://x.test/a',
      title: 'T',
      heading: 'h',
      domShapeSketch: 'tags:div=2|roles:|landmarks:0',
      accessibilitySnapshot: 'button "Entrar"',
      viewport: { w: 1280, h: 800 },
      assertionPassed: true,
    });
    expect(r.success).toBe(true);
  });

  it('names every field ingest reads - an omitted field is silently DROPPED hosted-side', () => {
    // api/src/automation/browser-session.ts `ingest` reads exactly these keys off observation.data.
    const shape = Object.keys(LocalBrowserObservation.shape).sort();
    expect(shape).toEqual(
      ['accessibilitySnapshot', 'assertionPassed', 'domShapeSketch', 'heading', 'title', 'url', 'viewport'].sort(),
    );
  });
});

describe('tool.result.screenshotB64 - the evidence channel (P1.4), additive', () => {
  it('carries a screenshot when the step produced one', () => {
    const r = BridgeFrame.safeParse({
      type: 'tool.result',
      invocationId: 'i1',
      ok: true,
      output: { url: 'https://x.test' },
      screenshotB64: 'aGk=',
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'tool.result') expect(r.data.screenshotB64).toBe('aGk=');
  });

  it('STAYS OPTIONAL - a daemon that sends none still parses (Rule 7: no field narrowed)', () => {
    const r = BridgeFrame.safeParse({ type: 'tool.result', invocationId: 'i1', ok: true });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'tool.result') expect(r.data.screenshotB64).toBeUndefined();
  });
});
