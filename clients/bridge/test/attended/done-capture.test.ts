import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantTable, NonceCache, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger } from '../../src/ledger/index.js';
import { DaemonRuntime } from '../../src/runtime/index.js';
import type { CeremonyBrowser } from '../../src/attended/index.js';
import type { BridgeFrame } from '../../src/wire/index.js';
import { harness, LOGGED_IN } from './fake-browser.js';

/**
 * THE DONE SIGNAL, FROM THE FRAME DOWN (D-CEREMONY-DONE, 2026-08-25).
 *
 * WHAT BROKE, LIVE. The attended ceremony captured the session ONLY when the human closed the headed
 * browser it opened. That window is raised by the OS on every top-level navigation and a real login
 * redirects repeatedly, so during an OTP/2FA flow the person cannot stay in the app holding the code
 * - and nothing anywhere said that closing the window is what captures. The operator logged in, the
 * ceremony hit its TTL, and nothing was captured (findings,
 * `attended-ceremony-browser-steals-focus-and-hides-its-capture-signal`).
 *
 * WHAT THIS PINS. A `ceremony.capture` frame naming the ceremony this daemon is holding ends it and
 * pushes, with NO window close anywhere in the path - which is the whole feature. And the two ways
 * that could go wrong are no-ops rather than crashes or captures: a frame naming a DIFFERENT
 * ceremony, and a frame arriving when this machine is holding none.
 *
 * IT DRIVES THE REAL `runAttendedCeremony` rather than a mock, because the property under test is
 * that the frame reaches the ceremony's own loop and produces the ORDINARY push - same frame, same
 * requestId, same origin, same custody. A mocked ceremony would prove only that a resolver was
 * called.
 */
const PAIRING = 'p-ceremony';
const ORG = 'orgA';
const REQUEST_ID = 'ceremony-req-1';

/** Long enough for the ceremony's launch/context/snapshot microtasks to drain, short enough that the
 *  file stays fast. The ceremony's own tick is 2s, so nothing here is racing the interval. */
const SETTLE_MS = 20;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

let ledgerDir: string;
let sent: BridgeFrame[];
let logs: string[];

function runtimeWith(launchBrowser: (opts: { headless: boolean }) => Promise<CeremonyBrowser>): DaemonRuntime {
  return new DaemonRuntime({
    pairingId: PAIRING,
    org: ORG,
    signingSecret: 'secret',
    grants: new GrantTable([]),
    nonces: new NonceCache(),
    egress: new EgressAccounting(),
    ledger: new EgressLedger(ledgerDir),
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    getCredential: () => 'bridge-token',
    log: (m) => logs.push(m),
    launchBrowser,
  });
}

/** The ceremony opens a window and then holds it; nothing in this file ever closes one. */
function openCeremony(runtime: DaemonRuntime, requestId = REQUEST_ID): void {
  runtime.onFrame({
    type: 'attended.request',
    requestId,
    kind: 'login',
    origin: 'portal.tribunais.org.pt',
    reason: 'Iniciar sessão para continuar a automação',
  });
}

const pushes = (): BridgeFrame[] => sent.filter((f) => f.type === 'session.push');

beforeEach(() => {
  ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-done-'));
  sent = [];
  logs = [];
});

afterEach(() => {
  rmSync(ledgerDir, { recursive: true, force: true });
});

describe('ceremony.capture - the human presses Done in the dashboard', () => {
  it('finishes the in-flight ceremony and pushes the session, with no window close', async () => {
    const h = harness();
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime);
    await settle();
    expect(pushes()).toHaveLength(0);

    runtime.onFrame({ type: 'ceremony.capture', requestId: REQUEST_ID });
    await settle();

    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]).toMatchObject({
      type: 'session.push',
      requestId: REQUEST_ID,
      origin: 'https://portal.tribunais.org.pt',
      storageState: LOGGED_IN,
    });
    // The ceremony closed its own window afterwards; the human never did.
    expect(h.browser.closed).toBe(true);
  });

  it('is a NO-OP for a requestId that is not the ceremony in flight', async () => {
    // Cortex holds one ceremony per request and this daemon holds at most one at a time, so the two
    // can diverge - a second ceremony opened while the first window was still up. Ending the window
    // anyway would capture against a ceremony nobody asked to finish.
    const h = harness();
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime);
    await settle();

    runtime.onFrame({ type: 'ceremony.capture', requestId: 'some-other-ceremony' });
    await settle();

    expect(pushes()).toHaveLength(0);
    expect(h.browser.closed).toBe(false); // the window is still being held for the human
    // Stated at the machine rather than swallowed - but NOT as a failure, and with no recovery
    // prescribed: Cortex fans the capture out to every ceremony it holds for this caller and origin,
    // so a mismatch is the ordinary case for someone who opened a window twice, and a sibling frame
    // may be finishing the ceremony that is really up (review round 2026-08-25, F2/F3).
    expect(logs.join('\n')).toContain('Pedido de captura para outra autenticação');
    expect(logs.join('\n')).not.toContain('Feche a janela');

    // ...and the ceremony it did NOT end is still finishable the way it always was.
    h.page.fire('close');
    await settle();
    expect(pushes()).toHaveLength(1);
  });

  /**
   * THE FAN-OUT, SEEN FROM THIS SIDE (review round 2026-08-25, F3/F5). Cortex cannot know which of a
   * caller's open ceremonies this daemon is holding - it keeps one per REQUEST, this keeps one at a
   * TIME - so it relays the capture for all of them and lets the requestId decide here. That makes
   * the property below load-bearing: several capture frames arrive, exactly ONE matches, exactly ONE
   * session is pushed. A daemon that finished on any capture frame would turn the fan-out into a way
   * to end a window nobody asked about.
   */
  it('takes exactly one push from a fan-out of captures, wherever the held one sits in it', async () => {
    const h = harness();
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime);
    await settle();

    runtime.onFrame({ type: 'ceremony.capture', requestId: 'a-ceremony-this-daemon-never-held' });
    runtime.onFrame({ type: 'ceremony.capture', requestId: REQUEST_ID });
    runtime.onFrame({ type: 'ceremony.capture', requestId: 'another-one-it-never-held' });
    await settle();

    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]).toMatchObject({ requestId: REQUEST_ID, storageState: LOGGED_IN });
  });

  it('is a NO-OP, not a crash, when this machine holds no ceremony at all', async () => {
    const runtime = runtimeWith(() => Promise.reject(new Error('no ceremony should ever launch here')));

    expect(() => runtime.onFrame({ type: 'ceremony.capture', requestId: REQUEST_ID })).not.toThrow();
    await settle();

    expect(pushes()).toHaveLength(0);
    expect(logs.join('\n')).toContain('não há nenhuma autenticação a decorrer');
  });

  it('frees the machine for the next ceremony once Done has completed one', async () => {
    // `ceremonyInFlight` is a handle now rather than a boolean; a leak there would refuse every later
    // ceremony on this machine with "one is already running" until the daemon was restarted.
    const first = harness();
    const runtime = runtimeWith(first.deps.launchBrowser);
    openCeremony(runtime, 'first-ceremony');
    await settle();
    runtime.onFrame({ type: 'ceremony.capture', requestId: 'first-ceremony' });
    await settle();
    expect(pushes()).toHaveLength(1);

    openCeremony(runtime, 'second-ceremony');
    await settle();
    runtime.onFrame({ type: 'ceremony.capture', requestId: 'second-ceremony' });
    await settle();

    expect(pushes()).toHaveLength(2);
    expect(pushes()[1]).toMatchObject({ requestId: 'second-ceremony' });
    expect(logs.join('\n')).not.toContain('Já está uma autenticação a decorrer');
  });
});
