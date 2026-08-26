import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantTable, NonceCache, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger } from '../../src/ledger/index.js';
import { DaemonRuntime } from '../../src/runtime/index.js';
import type { CeremonyBrowser } from '../../src/attended/index.js';
import type { BridgeFrame } from '../../src/wire/index.js';
import { harness, FakeCdp } from './fake-browser.js';

/**
 * THE LIVE CEREMONY STREAM, ROUTED FROM THE FRAME DOWN (D-CEREMONY-STREAM).
 *
 * A `ceremony.stream{on:true}` for the ceremony this daemon is holding starts the screencast on ITS
 * window; a `ceremony.input` dispatches the human's mouse/keyboard into it; `{on:false}` and the
 * ceremony ending both tear it down. And the two ways it could reach the WRONG window are no-ops:
 * a frame naming any other requestId never starts a stream of, or dispatches input into, the window
 * this daemon holds for a different errand — the same requestId guard `ceremony.capture` uses.
 *
 * It drives the REAL `runAttendedCeremony` + `CeremonyStreamController` (only the CDP session and the
 * browser are faked), because the property under test is that a frame reaches the ceremony's own
 * stream and produces the ordinary CDP calls — a mocked controller would prove only that a method was
 * called.
 */
const PAIRING = 'p-stream';
const ORG = 'orgA';
const REQUEST_ID = 'ceremony-stream-1';

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

function openCeremony(runtime: DaemonRuntime, requestId = REQUEST_ID): void {
  runtime.onFrame({
    type: 'attended.request',
    requestId,
    kind: 'login',
    origin: 'portal.tribunais.org.pt',
    reason: 'Iniciar sessão para continuar a automação',
  });
}

const ceremonyFrames = (): Array<Extract<BridgeFrame, { type: 'ceremony.frame' }>> =>
  sent.filter((f): f is Extract<BridgeFrame, { type: 'ceremony.frame' }> => f.type === 'ceremony.frame');

beforeEach(() => {
  ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-stream-'));
  sent = [];
  logs = [];
});

afterEach(() => {
  rmSync(ledgerDir, { recursive: true, force: true });
});

describe('ceremony.stream / ceremony.input — the daemon side of the live stream', () => {
  it('attaches NO screencast until a viewer connects, then starts it and relays frames up', async () => {
    const cdp = new FakeCdp();
    const h = harness({ cdp });
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime);
    await settle();
    // A ceremony nobody is watching costs no frames: the screencast is lazy.
    expect(cdp.callsTo('Page.startScreencast')).toHaveLength(0);

    runtime.onFrame({ type: 'ceremony.stream', requestId: REQUEST_ID, on: true });
    await settle();
    expect(cdp.callsTo('Page.startScreencast')).toHaveLength(1);

    cdp.fireFrame({ data: 'BASE64_FRAME', sessionId: 3 });
    const up = ceremonyFrames();
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ type: 'ceremony.frame', requestId: REQUEST_ID, seq: 1, jpegBase64: 'BASE64_FRAME' });

    h.page.fire('close');
    await settle();
  });

  it('dispatches a ceremony.input mouse-down into the in-flight ceremony window', async () => {
    const cdp = new FakeCdp();
    const h = harness({ cdp });
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime);
    await settle();
    runtime.onFrame({ type: 'ceremony.stream', requestId: REQUEST_ID, on: true });
    await settle();

    runtime.onFrame({
      type: 'ceremony.input',
      requestId: REQUEST_ID,
      event: { type: 'mouse', x: 42, y: 24, action: 'down', button: 'left' },
    });
    await settle();

    const calls = cdp.callsTo('Input.dispatchMouseEvent');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toMatchObject({ type: 'mousePressed', x: 42, y: 24, button: 'left' });

    h.page.fire('close');
    await settle();
  });

  it('is a NO-OP for a ceremony.stream / ceremony.input naming a requestId that is not in flight', async () => {
    const cdp = new FakeCdp();
    const h = harness({ cdp });
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime); // holds REQUEST_ID
    await settle();

    // A frame for another ceremony must never start a stream of, or type into, this window.
    runtime.onFrame({ type: 'ceremony.stream', requestId: 'some-other-ceremony', on: true });
    runtime.onFrame({
      type: 'ceremony.input',
      requestId: 'some-other-ceremony',
      event: { type: 'key', code: 'KeyA', key: 'a', action: 'down' },
    });
    await settle();

    expect(cdp.callsTo('Page.startScreencast')).toHaveLength(0);
    expect(cdp.callsTo('Input.dispatchKeyEvent')).toHaveLength(0);
    expect(cdp.callsTo('Input.dispatchMouseEvent')).toHaveLength(0);

    h.page.fire('close');
    await settle();
  });

  it('stops the screencast when the viewer drops (on:false), keeping the window for a re-attach', async () => {
    const cdp = new FakeCdp();
    const h = harness({ cdp });
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime);
    await settle();
    runtime.onFrame({ type: 'ceremony.stream', requestId: REQUEST_ID, on: true });
    await settle();

    runtime.onFrame({ type: 'ceremony.stream', requestId: REQUEST_ID, on: false });
    await settle();
    expect(cdp.callsTo('Page.stopScreencast')).toHaveLength(1);
    // The window is still held: the human is still logging in, and a later viewer can re-attach.
    expect(h.browser.closed).toBe(false);

    h.page.fire('close');
    await settle();
  });

  it('tears the stream down in the ceremony finally when the window ends', async () => {
    const cdp = new FakeCdp();
    const h = harness({ cdp });
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime);
    await settle();
    runtime.onFrame({ type: 'ceremony.stream', requestId: REQUEST_ID, on: true });
    await settle();

    h.page.fire('close'); // the human closed the window
    await settle();

    expect(cdp.callsTo('Page.stopScreencast')).toHaveLength(1);
    // The ordinary capture still happens — streaming is additive to session.push.
    expect(sent.some((f) => f.type === 'session.push')).toBe(true);
  });

  it('ignores an inbound ceremony.frame — it is the daemon OWN outbound frame, never received', async () => {
    const runtime = runtimeWith(() => Promise.reject(new Error('no ceremony should launch here')));
    expect(() =>
      runtime.onFrame({ type: 'ceremony.frame', requestId: REQUEST_ID, seq: 1, jpegBase64: 'x' }),
    ).not.toThrow();
    await settle();
    expect(ceremonyFrames()).toHaveLength(0);
  });

  it('never logs the human input it dispatches', async () => {
    const cdp = new FakeCdp();
    const h = harness({ cdp });
    const runtime = runtimeWith(h.deps.launchBrowser);
    openCeremony(runtime);
    await settle();
    runtime.onFrame({ type: 'ceremony.stream', requestId: REQUEST_ID, on: true });
    await settle();

    const SECRET = 'PASSWORDCHAR_SECRET';
    runtime.onFrame({
      type: 'ceremony.input',
      requestId: REQUEST_ID,
      event: { type: 'key', code: 'KeyS_SECRET', key: SECRET, action: 'down' },
    });
    await settle();

    expect(logs.join('\n')).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain('KeyS_SECRET');

    h.page.fire('close');
    await settle();
  });
});
