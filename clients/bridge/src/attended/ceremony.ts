/**
 * attended/ceremony.ts — the machine half of the attended ceremony rail (Cofre J-5).
 *
 * WHY THIS EXISTS AT ALL. Portuguese legal portals authenticate with a smartcard in a physical
 * reader. Cortex deliberately owns no PKCS#11, no driver matrix and no `.pfx` custody: instead it
 * asks the machine that ALREADY HAS the reader to open a browser and hold it while the human
 * completes the ceremony in front of it. The card, its PIN and every certificate stay here. What
 * travels back is only the resulting `storageState`, stored as a Cofre session item.
 *
 * The Cortex half of that rail (`api/src/bridge/attended.ts`) was complete and tested. This half
 * did not exist: `attended.request` was not even in the vendored wire union, so the transport's
 * `safeParse` dropped it before any handler could see it, and Cortex sat on an open ceremony that
 * could only expire. `started: true` was truthful about Cortex ("the frame reached a live socket")
 * and meaningless to the user ("a browser will open"), because nothing here was listening.
 *
 * WHAT THIS REFUSES TO DECIDE. The origin is DECLARED BY CORTEX and never chosen here. The whole
 * security value of the rail is that the session which comes back is the session for the portal
 * that was asked about — Cortex re-checks it on arrival, and a daemon that picked its own origin
 * would be exactly the confused-deputy that check exists to catch. So the browser opens where it
 * is told, and the push reports where it actually landed.
 *
 * HOW "DONE" IS DETECTED. There is no portal-independent signal for "the human finished logging
 * in": every portal lands somewhere different, and sniffing for one would be per-portal knowledge
 * this daemon must not carry. So the human SAYS SO, and there are two ways to say it:
 *
 *   - `finishSignal` - "done, capture now", pressed in the dashboard (D-CEREMONY-DONE, 2026-08-25).
 *     THE PRIMARY ONE. The window is now a NORMAL, persistent Chrome window (D-CEREMONY-REALCHROME,
 *     2026-08-26): real installed Chrome on a dedicated profile, the automation infobar suppressed,
 *     navigated ONCE and then left alone — no re-goto, no second tab. That removes the tab-flap and
 *     the "controlled by automated software" banner, but it does NOT remove the OS raising the window
 *     on each redirect of the login itself (inherent to a headed browser on macOS). So a human
 *     reaching another app for an OTP can still be interrupted, and the dashboard Done button is what
 *     lets them finish on their own terms rather than racing the window closed.
 *   - the window CLOSING - the original signal, kept as the fallback that needs no dashboard and no
 *     live socket, and still the natural end of a card ceremony someone runs at their own desk.
 *
 * Because `storageState()` cannot be read from a context that is already gone, the state is
 * snapshotted on a short interval while the window lives and the LAST snapshot is what gets pushed.
 * The cost is bounded and stated: cookies set in the final instant before a CLOSE may miss the last
 * tick. The Done path does not pay it - the window is still open when it fires, so it snapshots
 * fresh state at the moment the human says they are finished.
 */
import { join } from 'node:path';
import type { BridgeFrame } from '../wire/index.js';
import { ekoaBridgeHome } from '../auth/home.js';
import { sanitizeProfileId } from '../browser/profile.js';
import { launchHeadedRealChrome, type BridgeCdpSession, type HeadedChromeContext } from '../browser/chrome-launch.js';
import { CeremonyStreamController } from './screencast.js';

/** Matches Cortex's CEREMONY_TTL_MS: a human is walking to a card reader, not making a round trip.
 *  Held slightly SHORTER so the window closes before the server-side ceremony expires — pushing
 *  into an expired ceremony would be refused and the user's ceremony silently lost. */
const CEREMONY_TTL_MS = 9 * 60_000;

/** How often the live storageState is snapshotted. Cheap (a CDP round trip), and it bounds how much
 *  of the final moment can be lost when the human closes the window. */
const SNAPSHOT_INTERVAL_MS = 2_000;

export interface CeremonyRequest {
  requestId: string;
  /**
   * WHICH ERRAND, and nothing this function branches on. A card in a reader, a relay code and a
   * plain sign-in are the same ceremony from here: a headed window at a declared origin, held until
   * the human closes it. `login` is the ad-hoc adversarial capture (docs/decisions.md 2026-08-24,
   * D-ADHOC-1) and travels only so Cortex's Registo row can name the errand.
   */
  kind: 'card_login' | 'relay_code' | 'login';
  origin: string;
  reason: string;
}

export interface CeremonyDeps {
  /** Send a frame up the bridge (BridgeSocket.send). */
  send: (frame: BridgeFrame) => boolean;
  /** User-visible progress, in Portuguese — this runs where the human is sitting. */
  log: (message: string) => void;
  /**
   * "THE HUMAN PRESSED DONE" - resolves when Cortex relays the dashboard's capture request for THIS
   * ceremony (`ceremony.capture`, matched on requestId by the runtime that owns this promise).
   *
   * A PROMISE RATHER THAN A CALLBACK because that is what the loop below already races: the ceremony
   * ends on whichever of close / done / TTL happens first, and a third arm is the whole change.
   * Optional, so a daemon or a test that supplies none keeps the close-only behaviour exactly.
   *
   * It never rejects. A signal that could reject would mean a ceremony ending on an error nobody
   * can act on, when the window is still open and the human can still close it.
   */
  finishSignal?: Promise<void>;
  /** Injected for tests; defaults to a HEADED, persistent real-Chrome window (`launchHeadedRealChrome`)
   *  opened on a dedicated per-origin profile under `profilesRoot`. */
  launchBrowser?: (opts: { headless: boolean }) => Promise<CeremonyBrowser>;
  /**
   * Where the ceremony's persistent per-origin profiles live. Defaults to
   * `<EKOA_BRIDGE_HOME>/ceremony-profiles`. A SIBLING of the run-lease profiles (`ProfileManager`),
   * never the same dir: a ceremony and a run lease share nothing, so neither Chrome SingletonLock nor
   * a wipe-on-release can collide. Persistent so a human who logged in once stays logged in for the
   * next ceremony on the same origin.
   */
  profilesRoot?: string;
  /** Re-fetch the browser after a repairable launch failure; defaults to `playwright install --force`. */
  repairBrowser?: () => Promise<void>;
  now?: () => number;
  /**
   * THE LIVE-STREAM HANDOFF (D-CEREMONY-STREAM). Called ONCE, as soon as the ceremony's window is
   * open, with the controller the daemon runtime drives to start/stop the live stream and dispatch
   * the human's mouse/keyboard — or `null` when this window cannot stream (the context produced no
   * CDP seam, or none was wired). ADDITIVE and orthogonal to the capture path: the controller only
   * attaches a screencast when a viewer connects, so a ceremony nobody watches costs no frames, and
   * the ceremony's `session.push` behaviour is unchanged whether anyone streams or not.
   *
   * The ceremony tears the controller down in its own `finally`, so the runtime never has to.
   */
  onStreamReady?: (controller: CeremonyStreamController | null) => void;
}

/** The slice of Playwright this module needs, named so tests can substitute it without Playwright. */
export interface CeremonyBrowser {
  newContext(): Promise<CeremonyContext>;
  close(): Promise<void>;
  on(event: 'disconnected', handler: () => void): void;
}
export interface CeremonyContext {
  newPage(): Promise<CeremonyPage>;
  storageState(): Promise<unknown>;
  close(): Promise<void>;
  on(event: 'close', handler: () => void): void;
  /**
   * The live-stream seam (D-CEREMONY-STREAM): a minimal CDP session over the window's live page, or
   * absent when this context cannot produce one. OPTIONAL and additive — a context without it (every
   * unit-test fake) simply never streams, so the ceremony holds its window exactly as before.
   */
  newCDPSession?(): Promise<BridgeCdpSession>;
  /** Minimize the window so it cannot take over the desktop; re-called on each navigation. Optional
   *  and best-effort — absent on a fake context, which just holds a visible window as before. */
  minimizeWindow?(): Promise<void>;
}
export interface CeremonyPage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' }): Promise<unknown>;
  url(): string;
  on(event: 'close' | 'framenavigated', handler: () => void): void;
}

export class CeremonyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CeremonyError';
  }
}

/**
 * Run one ceremony to completion and push the captured session.
 *
 * Never throws at the caller: a ceremony that fails is reported to the human here and simply never
 * pushes. Cortex's ceremony then expires on its own TTL, which is the correct end state — there is
 * no "ceremony failed" frame in the wire, and inventing one would be a contract change made from
 * the wrong side.
 */
export async function runAttendedCeremony(req: CeremonyRequest, deps: CeremonyDeps): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const target = normaliseOrigin(req.origin);
  // A dedicated, persistent profile PER ORIGIN. Persistent so the login is remembered for next time;
  // per-origin so two adversarial targets never share a cookie jar (the same rule the run executor
  // follows). It is a normal Chrome profile the daemon owns — never the user's own Chrome directory.
  const profilesRoot = deps.profilesRoot ?? join(ekoaBridgeHome(), 'ceremony-profiles');
  const userDataDir = join(profilesRoot, sanitizeProfileId(hostKeyOf(target)));
  const launch =
    deps.launchBrowser ??
    (async (o: { headless: boolean }): Promise<CeremonyBrowser> =>
      ceremonyBrowserOverContext(await launchHeadedRealChrome(userDataDir, { log: deps.log, headless: o.headless })));
  const repair = deps.repairBrowser ?? installChromium;

  // Tell Cortex the ceremony ended WITHOUT a capture (D-CEREMONY-STREAM lifecycle L2). Every path that
  // leaves this function without a `session.push` - a launch failure, an abandoned login, a TTL expiry
  // - calls this, so Cortex drops the ceremony (and any live stream) at once instead of leaving it
  // lingering in its map for the full TTL, where a re-establish would re-attach to the dead entry and
  // open no window. A no-op if the socket is already down (`send` returns false and Cortex will TTL it
  // anyway). NOT called after a successful push - the push itself consumes the ceremony.
  const signalCeremonyEnded = (): void => {
    deps.send({ type: 'ceremony.ended', requestId: req.requestId });
  };

  deps.log('');
  deps.log('==============================================================');
  deps.log('  AUTENTICAÇÃO NECESSÁRIA NESTE COMPUTADOR');
  deps.log('==============================================================');
  deps.log(`  ${req.reason}`);
  deps.log(`  Endereço: ${target}`);
  deps.log('');
  deps.log('  Abre-se uma janela normal do Chrome (a sua sessão fica guardada,');
  deps.log('  por isso só precisa de fazer isto uma vez por site).');
  deps.log('  1) Inicie sessão como faria normalmente (palavra-passe, 2FA, cartão).');
  //   Said HERE as well as on the card, because this is the text in front of the person at the moment
  //   it matters. Closing the window still captures, and is named as the fallback — but "Concluir e
  //   capturar" in the dashboard is the primary signal, so the human can take their time (fetch an
  //   OTP from another app) without racing a window that will close on them.
  deps.log('  2) Quando terminar, volte à Ekoa e clique em "Concluir e capturar".');
  deps.log('     (Fechar a janela também captura a sessão.)');
  deps.log('');

  // Launch, and give a repairable failure exactly one re-fetch. This policy lives HERE rather than
  // inside the default launcher so it applies to whatever launcher is in use and can be asserted
  // through the public API — while it sat in `defaultLaunch`, the retry was unreachable from a test
  // and the corrupt-install case below went unnoticed until a real laptop slept mid-download.
  // Headless only when the operator asks (EKOA_CEREMONY_HEADLESS=1): on a machine where the bridge and
  // the dashboard are the SAME, a headed window's macOS app-activation steals keyboard focus from the
  // panel the human types into, so headless (no window) is the typable mode there. Headed stays the
  // default (lower bot-detection; a separate bridge machine steals no focus). Read once so both the
  // launch and the retry agree.
  const headless = process.env.EKOA_CEREMONY_HEADLESS === '1';
  if (headless) deps.log('  (Modo sem janela: conduza tudo no visor da Ekoa.)');
  let browser: CeremonyBrowser;
  try {
    browser = await launch({ headless });
  } catch (first) {
    if (!isRepairableBrowser(first)) {
      deps.log(`ERRO: não foi possível abrir o navegador — ${first instanceof Error ? first.message : String(first)}`);
      signalCeremonyEnded();
      return false;
    }
    // Say so before the pause. A human is waiting at the machine, and a silent two-minute gap
    // between "a window will open" and anything happening reads as a hang.
    deps.log('A preparar o navegador da automação (uma só vez, pode demorar 1-2 minutos)...');
    try {
      await repair();
      browser = await launch({ headless });
    } catch (second) {
      deps.log(`ERRO: não foi possível abrir o navegador — ${second instanceof Error ? second.message : String(second)}`);
      // `--force`: without it playwright SKIPS a version already on disk, so the advice printed
      // here used to be a no-op against the truncated download that most often causes this.
      deps.log('Sugestão: reinstale o navegador da automação com  npx playwright install --force chromium');
      signalCeremonyEnded();
      return false;
    }
  }

  let lastSnapshot: unknown = null;
  let landedOn = target;
  // The live-stream controller for THIS window (D-CEREMONY-STREAM), or null when the context cannot
  // produce a CDP session. Declared out here so the `finally` can tear it down whichever way the
  // ceremony ends. It attaches no screencast until a viewer connects, so building it costs nothing.
  let stream: CeremonyStreamController | null = null;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Hand the runtime a controller as soon as the window exists, so a viewer who connects the
    // instant the ceremony opens is not racing a handle that does not exist yet. A context with no
    // `newCDPSession` never streams — the ceremony is unchanged, local-window-only.
    if (deps.onStreamReady) {
      const newCdp = context.newCDPSession?.bind(context);
      stream = newCdp ? new CeremonyStreamController(newCdp, deps.send, req.requestId) : null;
      deps.onStreamReady(stream);
    }

    // A navigation failure is NOT fatal: the human can still type the address in the window that is
    // already open, and the portal may redirect through hosts that time out our waitUntil. Report
    // and keep holding the ceremony rather than tearing down a window someone is looking at.
    try {
      await page.goto(target, { timeout: 60_000, waitUntil: 'domcontentloaded' });
    } catch (err) {
      deps.log(`Aviso: a página não abriu automaticamente (${err instanceof Error ? err.message : String(err)}).`);
      deps.log(`Escreva o endereço na janela: ${target}`);
    }
    // Re-minimize after the initial load: the goto can raise the window back onto the desktop, and the
    // stream (not the local window) is the control surface. Best-effort; the launch already minimized.
    void context.minimizeWindow?.();

    const closed = waitForClose(browser, context, page);
    const deadline = now() + CEREMONY_TTL_MS;

    // `storageState()` is unreadable once the context is gone, so the last good snapshot before the
    // close is what gets pushed — which makes WHEN we snapshot the whole of whether this works.
    //
    // Snapshotting only on an interval loses any login completed and closed inside one tick, and a
    // fast human (password manager, card already in the reader) is well inside 2s. So snapshot on
    // all three of: open, every navigation, and the tick. The navigation hook is the one that
    // matters — a completed login always ends in a redirect, so the state is captured at the moment
    // it becomes real rather than up to a tick later.
    let inFlight: Promise<void> | null = null;
    const snapshot = (): Promise<void> => {
      // Overlapping `storageState()` reads would race for the same CDP session, so a caller arriving
      // mid-read JOINS that read rather than skipping it. Skipping was harmless while every caller
      // was a tick that would come round again; the Done path gets no second chance, and its whole
      // value is that what it pushes is the state as of the moment the human said "finished".
      if (inFlight) return inFlight;
      const read = (async (): Promise<void> => {
        try {
          const state = await context.storageState();
          lastSnapshot = state;
          landedOn = page.url() || target;
        } catch {
          /* the context is gone; whatever we already hold is what we push */
        }
      })();
      inFlight = read.finally(() => {
        inFlight = null;
      });
      return inFlight;
    };
    // On every navigation: snapshot the (possibly now-authenticated) state AND re-minimize - a login
    // redirects through several pages and macOS can restore a minimized window on some of them, which
    // is exactly the "takes over the machine" flap. Keeping it minimized holds the desktop.
    page.on?.('framenavigated', () => {
      void snapshot();
      void context.minimizeWindow?.();
    });
    await snapshot();

    // Both non-TTL arms are built ONCE, outside the loop. Re-deriving them per iteration would hang
    // a fresh `.then` off the same promises on every tick - 270 of them over a full ceremony - for
    // no gain, since a settled promise stays settled.
    const closedArm = closed.promise.then(() => 'closed' as const);
    const doneArm = deps.finishSignal?.then(() => 'done' as const);

    for (;;) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        // The human walked away. Discard rather than push: nobody signalled that the ceremony
        // finished, so whatever is in the browser may be a half-completed login, and a
        // mid-flow session stored as a working one fails later, silently, somewhere else.
        deps.log('A janela ficou aberta demasiado tempo; a autenticação foi cancelada.');
        lastSnapshot = null;
        break;
      }
      const finished = await Promise.race([
        closedArm,
        ...(doneArm ? [doneArm] : []),
        sleep(Math.min(SNAPSHOT_INTERVAL_MS, remaining)).then(() => 'tick' as const),
      ]);
      if (finished === 'done') {
        // THE ONE COMPLETION SIGNAL THAT ARRIVES WITH THE CONTEXT STILL ALIVE, so it takes a fresh
        // snapshot instead of pushing whatever the last tick happened to hold. That is not an
        // optimisation: the human presses Done at the instant the login completes, which is exactly
        // when the state that matters is newest.
        await snapshot();
        deps.log('Recebido: a concluir e a capturar a sessão...');
        break;
      }
      if (finished === 'closed') break;
      await snapshot();
    }
  } catch (err) {
    deps.log(`ERRO durante a autenticação: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Tear the live stream down BEFORE closing the window: stop the screencast so no frame is
    // encoded off a window mid-close, and after this the controller never re-attaches even if a
    // late `ceremony.stream{on:true}` arrives. Swallows its own errors — the CDP session dies with
    // the window regardless.
    try {
      await stream?.teardown();
    } catch {
      /* the stream/page is already gone */
    }
    try {
      await browser.close();
    } catch {
      /* already gone */
    }
  }

  if (!lastSnapshot || !hasCookies(lastSnapshot)) {
    // An empty storageState means the human closed the window without completing the login. Pushing
    // it would mint a perfectly valid, correctly-encrypted, USELESS Cofre item that later looks like
    // a working session — a silent failure that only surfaces when an automation runs on it.
    deps.log('Nenhuma sessão foi capturada (a autenticação não chegou a ser concluída).');
    signalCeremonyEnded();
    return false;
  }

  const sent = deps.send({
    type: 'session.push',
    requestId: req.requestId,
    // What we actually landed on, not what we were asked for. Cortex binds the captured session to the
    // CEREMONY origin (it no longer gates on this landed origin - a multi-domain login lands elsewhere,
    // D-CEREMONY-STREAM-LIFECYCLE); this is reported as an advisory only.
    origin: originOf(landedOn) ?? target,
    storageState: lastSnapshot,
  });
  if (!sent) {
    deps.log('A sessão foi capturada mas a ligação ao Cortex caiu; repita a autenticação.');
    signalCeremonyEnded();
    return false;
  }
  deps.log('Sessão capturada e enviada para o cofre. Pode continuar na Ekoa.');
  return true;
}

/** Resolves as soon as ANY of the three closes — a human may close the tab, the window, or quit. */
function waitForClose(browser: CeremonyBrowser, context: CeremonyContext, page: CeremonyPage): { promise: Promise<void> } {
  let done: () => void;
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  page.on('close', () => done());
  context.on('close', () => done());
  browser.on('disconnected', () => done());
  return { promise };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/** A storageState with no cookies AND no origin entries carries no session. */
function hasCookies(state: unknown): boolean {
  const s = state as { cookies?: unknown[]; origins?: unknown[] } | null;
  if (!s || typeof s !== 'object') return false;
  return (Array.isArray(s.cookies) && s.cookies.length > 0) || (Array.isArray(s.origins) && s.origins.length > 0);
}

function normaliseOrigin(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
}

function originOf(value: string): string | null {
  try {
    return new URL(normaliseOrigin(value)).origin;
  } catch {
    return null;
  }
}

/** The host of an origin, folded for use as a profile-directory name. `orders.ubereats.com`, not the
 *  whole URL — so every ceremony for a portal reuses the one persistent profile. */
export function hostKeyOf(target: string): string {
  return sanitizeProfileId(originOf(target)?.replace(/^https?:\/\//, '') ?? target);
}

/**
 * Present a persistent real-Chrome context (from `launchHeadedRealChrome`) as the `CeremonyBrowser`
 * seam the loop above drives. A persistent context IS its own browser — there is no separate
 * `newContext` — so `newContext()` hands back an adapter over the same context, and `newPage()`
 * reuses the window's DEFAULT page rather than opening a second tab (opening one would be the very
 * tab-flap this rebuild removes). The context's own `close` event stands in for a browser
 * `disconnected`: for a persistent context, the window going away IS the disconnect.
 */
export function ceremonyBrowserOverContext(ctx: HeadedChromeContext): CeremonyBrowser {
  const context: CeremonyContext = {
    async newPage(): Promise<CeremonyPage> {
      const existing = ctx.pages();
      return (existing[0] ?? (await ctx.newPage())) as unknown as CeremonyPage;
    },
    storageState: () => ctx.storageState(),
    close: () => ctx.close(),
    on: (_event: 'close', handler: () => void) => ctx.on('close', handler),
    // Pass the live-stream seam through when the real launch attached one. Absent on a fake/injected
    // context, so its ceremony simply never streams.
    ...(ctx.newCDPSession ? { newCDPSession: (): Promise<BridgeCdpSession> => ctx.newCDPSession!() } : {}),
    // Pass the window-minimize seam through likewise (absent on a fake context).
    ...(ctx.minimizeWindow ? { minimizeWindow: (): Promise<void> => ctx.minimizeWindow!() } : {}),
  };
  return {
    newContext: async () => context,
    close: () => ctx.close(),
    on: (_event: 'disconnected', handler: () => void) => ctx.on('close', handler),
  };
}

/**
 * Launch failures a re-download can plausibly fix: the browser is absent, or it is present and
 * broken. Deliberately NOT a catch-all — a failure this does not recognise is re-thrown and
 * reported, because re-fetching 150 MB in front of a waiting human on the off-chance is worse than
 * telling them what actually went wrong.
 */
function isRepairableBrowser(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Executable doesn't exist|playwright install|Failed to launch|Target page, context or browser has been closed|SIGABRT|SIGTRAP|SIGSEGV/i.test(
    msg,
  );
}

async function installChromium(): Promise<void> {
  const { execa } = await import('execa');
  // `--force` because playwright SKIPS a version whose directory already exists, which makes the
  // plain form a no-op against a truncated download — the one case that most needs re-fetching.
  //
  // `--with-deps` is deliberately NOT used: it needs sudo on Linux and would turn a first ceremony
  // into a password prompt the user did not ask for. A missing system library surfaces as a launch
  // failure with Playwright's own remediation text, which is the honest outcome.
  await execa('npx', ['--yes', 'playwright', 'install', '--force', 'chromium'], {
    stdio: 'inherit',
    timeout: 10 * 60_000,
  });
}
