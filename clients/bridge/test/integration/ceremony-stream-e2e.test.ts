import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket as WsClient } from 'ws';
import { GrantTable, NonceCache, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger } from '../../src/ledger/index.js';
import { BridgeSocket } from '../../src/transport/index.js';
import { DaemonRuntime } from '../../src/runtime/index.js';
import type { CeremonyBrowser, CeremonyDeps } from '../../src/attended/index.js';
import type { BridgeCapability } from '../../src/wire/index.js';
import { harness, FakeCdp } from '../attended/fake-browser.js';
import { bootCortex, ekoaCodeAvailable, type Cortex } from './helpers/boot.js';

/**
 * THE ATTENDED-CEREMONY LIVE STREAM, END TO END OVER THE REAL WIRE (D-CEREMONY-STREAM).
 *
 * The whole Cortex<->bridge<->viewer path, headless: a REAL Cortex booted from `api/dist` (the cofre
 * REST surface, `attachCeremonyStreamServer`, and `attachBridgeServer` wired with the production
 * `onCeremonyFrame`/`onCeremonyEnded` injections), a REAL `DaemonRuntime` + `BridgeSocket` dialing in,
 * and a REAL `ws` viewer connecting to the media channel. The ONLY fakes are the injected browser
 * seam (`harness({ cdp })`) and its `FakeCdp` — so `runAttendedCeremony`, `CeremonyStreamController`,
 * `CeremonyScreencast`, the bridge WS server, `openCeremonyStream`/`pushCeremonyFrame`, the cofre
 * router and `acceptSessionPush` all run as shipped, with no real Chrome and no Playwright.
 *
 * Each scenario is a real bug a unit test missed:
 *   1. HAPPY PATH — establish -> viewer -> screencast -> frame down -> input up -> capture -> Cofre item.
 *   2. L1 RACE — the viewer connects BEFORE the ceremony window opens; the stream must still start once
 *      it does (the buffered `wantStream`, daemon-runtime.ts). Black-canvas-forever before the fix.
 *   3. B1 MULTI-DOMAIN — the window lands on a host DIFFERENT from the ceremony origin while the jar
 *      still covers the ceremony origin; capture must succeed and bind to the ceremony origin (the
 *      removed `sameOrigin` gate in acceptSessionPush).
 *   4. L2 RE-ATTACH — a second establish for an already-open ceremony re-mints against the SAME
 *      requestId (same wsUrl), opens no second ceremony, and a fresh viewer token works.
 *
 * Skips cleanly when the built `api/dist` (incl. the streaming + cofre entrypoints) is absent.
 */
const ORG = 'orgA';
const PARTY = 'Petrova Holdings';
const CEREMONY_WS_PREFIX = '/api/v1/ceremony-stream/';
const LIVESTREAM: BridgeCapability = 'attended.livestream';
const CAPS: BridgeCapability[] = ['attended.card_login', 'attended.livestream'];

const maybe = ekoaCodeAvailable ? describe : describe.skip;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `pred` (never sleep on a fixed guess) until it is truthy or the cap elapses. */
async function until(pred: () => boolean | Promise<boolean>, opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {}): Promise<void> {
  const { timeoutMs = 5_000, intervalMs = 25, label = 'condition' } = opts;
  const start = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(intervalMs);
  }
}

maybe('attended-ceremony live stream — end to end vs real ekoa-code (D-CEREMONY-STREAM)', () => {
  let cortex: Cortex;
  let ledgerDir: string;
  let daemonLogs: string[];
  const openDaemons: Array<{ socket: BridgeSocket }> = [];
  const openViewers: WsClient[] = [];

  beforeAll(async () => {
    cortex = await bootCortex({ pairingId: 'p-provider', org: ORG, ownerUserId: 'u-provider', party: PARTY, ceremony: true });
  }, 90_000);

  afterAll(async () => {
    await cortex.teardown();
  });

  beforeEach(() => {
    ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-e2e-'));
    daemonLogs = [];
  });

  afterEach(async () => {
    for (const v of openViewers) {
      try {
        v.terminate();
      } catch {
        /* already gone */
      }
    }
    for (const d of openDaemons) {
      try {
        d.socket.close();
      } catch {
        /* already gone */
      }
    }
    openViewers.length = 0;
    openDaemons.length = 0;
    cortex.resetCeremonyState?.();
    await sleep(20);
    rmSync(ledgerDir, { recursive: true, force: true });
  });

  interface Daemon {
    socket: BridgeSocket;
    runtime: DaemonRuntime;
    cdp: FakeCdp;
    h: ReturnType<typeof harness>;
  }

  /**
   * Dial a REAL DaemonRuntime + BridgeSocket into the booted Cortex, with the INJECTED fake browser
   * as its `launchBrowser` seam (round-trip's `dialDaemon`, plus the ceremony launcher). Advertises the
   * ceremony capabilities via `hello` and POLLS until the pairing row carries `attended.livestream`
   * (the hello handler awaits `registerPairing`, so it lands asynchronously — never a fixed sleep).
   */
  async function dialDaemon(input: {
    owner: string;
    pairingId: string;
    launchBrowser: CeremonyDeps['launchBrowser'];
    cdp: FakeCdp;
    h: ReturnType<typeof harness>;
  }): Promise<Daemon> {
    cortex.setActivation(input.owner, { active: true, billingLocked: false });
    await cortex.registerPairing({ pairingId: input.pairingId, org: ORG, ownerUserId: input.owner });
    const bridgeToken = cortex.mintBridgeToken(input.owner, input.pairingId);
    const signingSecret = await cortex.getPairingSigningSecret(input.pairingId, ORG);
    expect(signingSecret).toBeTruthy();
    const ledger = new EgressLedger(ledgerDir);

    // eslint-disable-next-line prefer-const
    let socket: BridgeSocket;
    const runtime = new DaemonRuntime({
      pairingId: input.pairingId,
      org: ORG,
      signingSecret: signingSecret!,
      grants: new GrantTable([]),
      nonces: new NonceCache(),
      egress: new EgressAccounting(),
      ledger,
      send: (frame) => socket.send(frame),
      getCredential: () => bridgeToken,
      log: (m) => daemonLogs.push(m),
      launchBrowser: input.launchBrowser,
    });
    socket = new BridgeSocket({
      wsBase: `ws://127.0.0.1:${cortex.port}`,
      pairingId: input.pairingId,
      getToken: async () => bridgeToken,
      onFrame: (frame) => runtime.onFrame(frame),
    });
    await socket.connect();
    // Advertise, then poll. The first hello can race the server's live-socket registration (dropped by
    // the liveness guard), so RE-SEND each iteration until the capability row appears — idempotent, the
    // advertisement replaces.
    await until(
      async () => {
        socket.send(DaemonRuntime.helloFrame({ machineName: 'ci', capabilities: CAPS, daemonVersion: '0.0.0-test' }));
        await sleep(25);
        return cortex.advertisesCapability!(input.pairingId, LIVESTREAM);
      },
      { label: 'attended.livestream advertised', timeoutMs: 8_000 },
    );

    const daemon: Daemon = { socket, runtime, cdp: input.cdp, h: input.h };
    openDaemons.push(daemon);
    return daemon;
  }

  interface EstablishBody {
    started: boolean;
    message: string;
    streaming?: { token: string; wsUrl: string; viewport: { width: number; height: number } };
  }

  async function establish(owner: string, origin: string): Promise<EstablishBody> {
    const res = await fetch(`http://127.0.0.1:${cortex.port}/api/v1/cofre/sessions/establish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cortex.platformToken(owner, ORG)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ origin }),
    });
    return (await res.json()) as EstablishBody;
  }

  async function capture(owner: string, origin: string): Promise<{ requested: boolean; message: string }> {
    const res = await fetch(`http://127.0.0.1:${cortex.port}/api/v1/cofre/sessions/capture`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cortex.platformToken(owner, ORG)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ origin }),
    });
    return (await res.json()) as { requested: boolean; message: string };
  }

  const requestIdOf = (wsUrl: string): string => wsUrl.slice(CEREMONY_WS_PREFIX.length);

  /** A real `ws` viewer on the ceremony media channel, recording every server message and its close. */
  interface Viewer {
    ws: WsClient;
    messages: Array<Record<string, unknown>>;
    opened: Promise<void>;
    closeEvent: Promise<{ code: number; reason: string }>;
    waitFor: (pred: (m: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
    send: (msg: Record<string, unknown>) => void;
  }

  function connectViewer(wsUrl: string, token: string): Viewer {
    const url = `ws://127.0.0.1:${cortex.port}${wsUrl}?token=${encodeURIComponent(token)}`;
    const ws = new WsClient(url);
    openViewers.push(ws);
    const messages: Array<Record<string, unknown>> = [];
    const waiters: Array<{ pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }> = [];
    ws.on('message', (data) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      messages.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.pred(m)) {
          waiters[i]!.resolve(m);
          waiters.splice(i, 1);
        }
      }
    });
    let resolveOpen!: () => void;
    let rejectOpen!: (e: Error) => void;
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });
    ws.on('open', () => resolveOpen());
    ws.on('error', (e) => rejectOpen(e instanceof Error ? e : new Error(String(e))));
    ws.on('unexpected-response', () => rejectOpen(new Error('unexpected-response (upgrade refused)')));
    let resolveClose!: (v: { code: number; reason: string }) => void;
    const closeEvent = new Promise<{ code: number; reason: string }>((r) => {
      resolveClose = r;
    });
    ws.on('close', (code, reasonBuf) => resolveClose({ code, reason: reasonBuf?.toString() ?? '' }));
    const waitFor = (pred: (m: Record<string, unknown>) => boolean, timeoutMs = 4_000): Promise<Record<string, unknown>> => {
      const found = messages.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a viewer message')), timeoutMs);
        waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    };
    return {
      ws,
      messages,
      opened,
      closeEvent,
      waitFor,
      send: (msg) => ws.send(JSON.stringify(msg)),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  // SCENARIO 1 — HAPPY PATH
  // ────────────────────────────────────────────────────────────────────────────────────────────────
  it('HAPPY PATH: establish -> viewer -> screencast -> frame down -> input up -> capture -> Cofre item', async () => {
    const OWNER = 'u-happy';
    const ORIGIN = 'portal.tribunais.org.pt';
    const cdp = new FakeCdp();
    const h = harness({ cdp });
    await dialDaemon({ owner: OWNER, pairingId: 'p-happy', launchBrowser: h.deps.launchBrowser, cdp, h });

    // establish -> the streaming triple.
    const body = await establish(OWNER, ORIGIN);
    expect(body.started).toBe(true);
    expect(body.streaming).toBeDefined();
    expect(body.streaming!.viewport).toEqual({ width: 1280, height: 800 });
    expect(body.streaming!.wsUrl.startsWith(CEREMONY_WS_PREFIX)).toBe(true);
    const requestId = requestIdOf(body.streaming!.wsUrl);
    expect(requestId.length).toBeGreaterThan(0);

    // Wait for the ceremony WINDOW before connecting the viewer: `goto` runs strictly after
    // `onStreamReady`, so `gotoCalls === 1` proves the controller is registered (kills the L1 race here).
    await until(() => h.page.gotoCalls.length === 1, { label: 'ceremony window opened (gotoCalls===1)' });

    // Viewer connects; first server message is the viewport.
    const viewer = connectViewer(body.streaming!.wsUrl, body.streaming!.token);
    await viewer.opened;
    await viewer.waitFor((m) => m.type === 'viewport');
    expect(viewer.messages[0]).toMatchObject({ type: 'viewport', width: 1280, height: 800 });

    // The viewer attach fired onViewerChange(true) -> ceremony.stream{on:true} -> controller.start().
    await until(
      () => cdp.callsTo('Page.enable').length === 1 && cdp.callsTo('Page.startScreencast').length === 1,
      { label: 'Page.enable + Page.startScreencast fired' },
    );
    expect(cdp.callsTo('Page.startScreencast')[0]!.params).toMatchObject({ format: 'jpeg' });

    // A frame travels daemon -> Cortex -> viewer.
    cdp.fireFrame({ data: 'RkFLRUpQRUc=', sessionId: 7 });
    const frame = await viewer.waitFor((m) => m.type === 'frame');
    expect(frame).toMatchObject({ type: 'frame', seq: 1, jpegBase64: 'RkFLRUpQRUc=' });
    expect(cdp.callsTo('Page.screencastFrameAck')[0]!.params).toMatchObject({ sessionId: 7 });

    // Input travels viewer -> Cortex -> daemon -> fake CDP.
    viewer.send({ type: 'mouse', x: 42, y: 24, action: 'down', button: 'left' });
    viewer.send({ type: 'key', code: 'KeyP', key: 'p', action: 'down' });
    await until(
      () => cdp.callsTo('Input.dispatchMouseEvent').length === 1 && cdp.callsTo('Input.dispatchKeyEvent').length === 1,
      { label: 'Input.dispatchMouseEvent + Input.dispatchKeyEvent dispatched' },
    );
    expect(cdp.callsTo('Input.dispatchMouseEvent')[0]!.params).toMatchObject({ type: 'mousePressed', x: 42, y: 24, button: 'left' });
    expect(cdp.callsTo('Input.dispatchKeyEvent')[0]!.params).toMatchObject({ type: 'keyDown', key: 'p', text: 'p' });

    // Finish via the Done rail -> session.push -> acceptSessionPush mints the Cofre item.
    const cap = await capture(OWNER, ORIGIN);
    expect(cap.requested).toBe(true);

    const closed = await viewer.closeEvent;
    expect(closed).toMatchObject({ code: 1000, reason: 'ceremony-ended' });

    // Exactly one session item for this owner, labelled for the ceremony origin.
    const items = await cortex.listCofreItems!({ userId: OWNER, orgId: ORG, role: 'user' }, Date.now());
    const sessionItems = items.filter((i) => i.type === 'session');
    expect(sessionItems).toHaveLength(1);
    expect(sessionItems[0]!.label).toBe(`${ORIGIN} session`);
    expect(sessionItems[0]!.boundOrigins).toEqual([ORIGIN]);

    // The screencast was stopped at least once (teardown; racing the on:false relay — hence >= 1).
    await until(() => cdp.callsTo('Page.stopScreencast').length >= 1, { label: 'Page.stopScreencast fired' });

    // CREDENTIAL PRIVACY: neither the jpeg base64 nor the typed key ever appears in any log line.
    const logs = [...daemonLogs, ...(cortex.ceremonyStreamLogs ?? [])].join('\n');
    expect(logs).not.toContain('RkFLRUpQRUc=');
    expect(logs).not.toContain('jpegBase64');
    expect(logs).not.toContain('KeyP');
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  // SCENARIO 2 — L1 RACE: viewer connects BEFORE the ceremony window opens
  // ────────────────────────────────────────────────────────────────────────────────────────────────
  it('L1 RACE: a viewer that connects BEFORE the window opens still gets the screencast once it does', async () => {
    const OWNER = 'u-l1';
    const ORIGIN = 'portal.tribunais.org.pt';
    const cdp = new FakeCdp();
    const h = harness({ cdp });

    // A DEFERRED launch: the ceremony's window does not open until we release the gate — the real
    // 1-3s `launchHeadedRealChrome` delay, during which the viewer connects and Cortex sends
    // ceremony.stream{on:true} to a daemon whose controller does not exist yet.
    let releaseLaunch!: () => void;
    const launchGate = new Promise<void>((r) => {
      releaseLaunch = r;
    });
    const deferredLaunch: CeremonyDeps['launchBrowser'] = async () => {
      await launchGate;
      return h.browser as CeremonyBrowser;
    };

    await dialDaemon({ owner: OWNER, pairingId: 'p-l1', launchBrowser: deferredLaunch, cdp, h });

    const body = await establish(OWNER, ORIGIN);
    expect(body.started).toBe(true);
    expect(body.streaming).toBeDefined();

    // The window is NOT open yet — launch is still pending.
    expect(h.page.gotoCalls.length).toBe(0);

    // The viewer connects into this gap. It gets the viewport (the stream session exists), and
    // ceremony.stream{on:true} is buffered as `wantStream` on the daemon (stream still null).
    const viewer = connectViewer(body.streaming!.wsUrl, body.streaming!.token);
    await viewer.opened;
    await viewer.waitFor((m) => m.type === 'viewport');
    await sleep(60); // let the on:true reach the daemon while the controller is still null
    expect(cdp.callsTo('Page.startScreencast').length).toBe(0);

    // Open the window. onStreamReady applies the buffered wantStream -> the screencast starts.
    // Before the L1 fix (buffered wantStream) this NEVER fired — black canvas forever.
    releaseLaunch();
    await until(() => h.page.gotoCalls.length === 1, { label: 'ceremony window opened' });
    await until(() => cdp.callsTo('Page.startScreencast').length === 1, { label: 'Page.startScreencast fired after the window opened' });

    // And it is a LIVE stream, not merely a started one: a frame reaches the viewer.
    cdp.fireFrame({ data: 'RkFLRUpQRUc=', sessionId: 9 });
    const frame = await viewer.waitFor((m) => m.type === 'frame');
    expect(frame).toMatchObject({ type: 'frame', seq: 1, jpegBase64: 'RkFLRUpQRUc=' });

    // Wind the ceremony down cleanly (the human closes the window).
    h.page.fire('close');
    await sleep(40);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  // SCENARIO 3 — B1 MULTI-DOMAIN: land on a DIFFERENT host than the ceremony origin
  // ────────────────────────────────────────────────────────────────────────────────────────────────
  it('B1 MULTI-DOMAIN: a login that lands on a different host still captures and binds to the ceremony origin', async () => {
    const OWNER = 'u-b1';
    const ORIGIN = 'www.ubereats.com';
    // The window lands on auth.uber.com (a DIFFERENT registrable domain), while the jar carries an app
    // cookie whose domain (.ubereats.com) covers the ceremony origin — the exact shape of a multi-domain
    // login that the removed `sameOrigin` landed-origin gate used to veto.
    const UBER_JAR = { cookies: [{ name: 'SESSION', value: 'x', domain: '.ubereats.com' }], origins: [] };
    const cdp = new FakeCdp();
    const h = harness({ cdp, url: 'https://auth.uber.com/oauth2/finish', state: UBER_JAR });
    await dialDaemon({ owner: OWNER, pairingId: 'p-b1', launchBrowser: h.deps.launchBrowser, cdp, h });

    const body = await establish(OWNER, ORIGIN);
    expect(body.started).toBe(true);

    await until(() => h.page.gotoCalls.length === 1, { label: 'ceremony window opened' });

    // Finish via the Done rail — the daemon pushes session.push{origin:'https://auth.uber.com', jar}.
    const cap = await capture(OWNER, ORIGIN);
    expect(cap.requested).toBe(true);

    // The capture SUCCEEDS (no landed-origin veto) and the item binds to the CEREMONY origin.
    await until(
      async () => (await cortex.listCofreItems!({ userId: OWNER, orgId: ORG, role: 'user' }, Date.now())).some((i) => i.type === 'session'),
      { label: 'Cofre session item minted' },
    );
    const items = await cortex.listCofreItems!({ userId: OWNER, orgId: ORG, role: 'user' }, Date.now());
    const sessionItems = items.filter((i) => i.type === 'session');
    expect(sessionItems).toHaveLength(1);
    expect(sessionItems[0]!.boundOrigins).toEqual([ORIGIN]);
    expect(sessionItems[0]!.label).toBe(`${ORIGIN} session`);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  // SCENARIO 4 — L2 RE-ATTACH: a second establish reuses the open ceremony's requestId
  // ────────────────────────────────────────────────────────────────────────────────────────────────
  it('L2 RE-ATTACH: a second establish re-mints against the SAME requestId, leaks no second ceremony, and a fresh viewer token works', async () => {
    const OWNER = 'u-l2';
    const ORIGIN = 'portal.tribunais.org.pt';
    const cdp = new FakeCdp();
    const h = harness({ cdp });
    await dialDaemon({ owner: OWNER, pairingId: 'p-l2', launchBrowser: h.deps.launchBrowser, cdp, h });

    const openBefore = cortex.openCeremonyCount!();

    const first = await establish(OWNER, ORIGIN);
    expect(first.started).toBe(true);
    expect(first.streaming).toBeDefined();
    const firstRequestId = requestIdOf(first.streaming!.wsUrl);

    await until(() => h.page.gotoCalls.length === 1, { label: 'ceremony window opened' });

    // A viewer drop (reload/sleep) then a re-click "Abrir janela" lands here again. establish must
    // RE-ATTACH to the ceremony the daemon is actually holding: same requestId, no second ceremony.
    const second = await establish(OWNER, ORIGIN);
    expect(second.started).toBe(true);
    expect(second.streaming).toBeDefined();
    const secondRequestId = requestIdOf(second.streaming!.wsUrl);

    // SAME requestId (same wsUrl) across both establishes.
    expect(secondRequestId).toBe(firstRequestId);
    expect(second.streaming!.wsUrl).toBe(first.streaming!.wsUrl);

    // No leaked second ceremony: exactly one was opened by this owner+origin+pairing.
    expect(cortex.openCeremonyCount!() - openBefore).toBe(1);

    // The ceremony window opened exactly ONCE (no second attended.request reached the daemon).
    expect(h.page.gotoCalls.length).toBe(1);

    // The freshly re-minted viewer token connects and streams (the daemon still holds requestId1, so
    // ceremony.stream/on:true routes to the controller it actually has).
    const viewer = connectViewer(second.streaming!.wsUrl, second.streaming!.token);
    await viewer.opened;
    await viewer.waitFor((m) => m.type === 'viewport');
    await until(() => cdp.callsTo('Page.startScreencast').length === 1, { label: 'screencast started for the re-attached viewer' });

    cdp.fireFrame({ data: 'RkFLRUpQRUc=', sessionId: 3 });
    const frame = await viewer.waitFor((m) => m.type === 'frame');
    expect(frame).toMatchObject({ type: 'frame', seq: 1, jpegBase64: 'RkFLRUpQRUc=' });

    // Wind the ceremony down cleanly.
    h.page.fire('close');
    await sleep(40);
  });
});
