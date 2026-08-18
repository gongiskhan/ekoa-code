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
 * this daemon must not carry. So the human closes the window, and that is the signal. Because
 * `storageState()` cannot be read from a context that is already gone, the state is snapshotted on
 * a short interval while the window lives and the LAST snapshot is what gets pushed. The cost is
 * bounded and stated: cookies set in the final instant before the close may miss the last tick.
 */
import type { BridgeFrame } from '../wire/index.js';

/** Matches Cortex's CEREMONY_TTL_MS: a human is walking to a card reader, not making a round trip.
 *  Held slightly SHORTER so the window closes before the server-side ceremony expires — pushing
 *  into an expired ceremony would be refused and the user's ceremony silently lost. */
const CEREMONY_TTL_MS = 9 * 60_000;

/** How often the live storageState is snapshotted. Cheap (a CDP round trip), and it bounds how much
 *  of the final moment can be lost when the human closes the window. */
const SNAPSHOT_INTERVAL_MS = 2_000;

const LAUNCH_TIMEOUT_MS = 60_000;

export interface CeremonyRequest {
  requestId: string;
  kind: 'card_login' | 'relay_code';
  origin: string;
  reason: string;
}

export interface CeremonyDeps {
  /** Send a frame up the bridge (BridgeSocket.send). */
  send: (frame: BridgeFrame) => boolean;
  /** User-visible progress, in Portuguese — this runs where the human is sitting. */
  log: (message: string) => void;
  /** Injected for tests; defaults to Playwright chromium. */
  launchBrowser?: (opts: { headless: boolean }) => Promise<CeremonyBrowser>;
  /** Re-fetch the browser after a repairable launch failure; defaults to `playwright install --force`. */
  repairBrowser?: () => Promise<void>;
  now?: () => number;
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
  const launch = deps.launchBrowser ?? ((o: { headless: boolean }) => defaultLaunch(o));
  const repair = deps.repairBrowser ?? installChromium;
  const target = normaliseOrigin(req.origin);

  deps.log('');
  deps.log('==============================================================');
  deps.log('  AUTENTICAÇÃO NECESSÁRIA NESTE COMPUTADOR');
  deps.log('==============================================================');
  deps.log(`  ${req.reason}`);
  deps.log(`  Endereço: ${target}`);
  deps.log('');
  deps.log('  Vai abrir-se uma janela do navegador.');
  deps.log('  1) Complete a autenticação (cartão, PIN, credenciais).');
  deps.log('  2) FECHE a janela quando terminar.');
  deps.log('');

  // Launch, and give a repairable failure exactly one re-fetch. This policy lives HERE rather than
  // inside the default launcher so it applies to whatever launcher is in use and can be asserted
  // through the public API — while it sat in `defaultLaunch`, the retry was unreachable from a test
  // and the corrupt-install case below went unnoticed until a real laptop slept mid-download.
  let browser: CeremonyBrowser;
  try {
    browser = await launch({ headless: false });
  } catch (first) {
    if (!isRepairableBrowser(first)) {
      deps.log(`ERRO: não foi possível abrir o navegador — ${first instanceof Error ? first.message : String(first)}`);
      return false;
    }
    // Say so before the pause. A human is waiting at the machine, and a silent two-minute gap
    // between "a window will open" and anything happening reads as a hang.
    deps.log('A preparar o navegador da automação (uma só vez, pode demorar 1-2 minutos)...');
    try {
      await repair();
      browser = await launch({ headless: false });
    } catch (second) {
      deps.log(`ERRO: não foi possível abrir o navegador — ${second instanceof Error ? second.message : String(second)}`);
      // `--force`: without it playwright SKIPS a version already on disk, so the advice printed
      // here used to be a no-op against the truncated download that most often causes this.
      deps.log('Sugestão: reinstale o navegador da automação com  npx playwright install --force chromium');
      return false;
    }
  }

  let lastSnapshot: unknown = null;
  let landedOn = target;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // A navigation failure is NOT fatal: the human can still type the address in the window that is
    // already open, and the portal may redirect through hosts that time out our waitUntil. Report
    // and keep holding the ceremony rather than tearing down a window someone is looking at.
    try {
      await page.goto(target, { timeout: 60_000, waitUntil: 'domcontentloaded' });
    } catch (err) {
      deps.log(`Aviso: a página não abriu automaticamente (${err instanceof Error ? err.message : String(err)}).`);
      deps.log(`Escreva o endereço na janela: ${target}`);
    }

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
    let capturing = false;
    const snapshot = async (): Promise<void> => {
      if (capturing) return; // overlapping storageState() reads would race for the same CDP session
      capturing = true;
      try {
        const state = await context.storageState();
        lastSnapshot = state;
        landedOn = page.url() || target;
      } catch {
        /* the context is gone; whatever we already hold is what we push */
      } finally {
        capturing = false;
      }
    };
    page.on?.('framenavigated', () => void snapshot());
    await snapshot();

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
        closed.promise.then(() => 'closed' as const),
        sleep(Math.min(SNAPSHOT_INTERVAL_MS, remaining)).then(() => 'tick' as const),
      ]);
      if (finished === 'closed') break;
      await snapshot();
    }
  } catch (err) {
    deps.log(`ERRO durante a autenticação: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
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
    return false;
  }

  const sent = deps.send({
    type: 'session.push',
    requestId: req.requestId,
    // What we actually landed on, not what we were asked for. Cortex compares the two and refuses a
    // mismatch (J-5) — reporting the REQUESTED origin here would defeat that check by construction.
    origin: originOf(landedOn) ?? target,
    storageState: lastSnapshot,
  });
  if (!sent) {
    deps.log('A sessão foi capturada mas a ligação ao Cortex caiu; repita a autenticação.');
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

/**
 * Playwright chromium, HEADED — a human has to see it. The installer skips the browser download to
 * keep the base install light, so the binary is usually absent on first use; rather than fail with
 * Playwright's raw "Executable doesn't exist" (which reads as a broken install), fetch it once here
 * and retry. This is the only place the daemon downloads anything at run time.
 *
 * A HALF-DOWNLOADED BROWSER IS NOT A MISSING ONE, and the difference is not academic: a laptop that
 * sleeps mid-download leaves a directory that exists, so `Executable doesn't exist` never fires,
 * while the binary inside is truncated and dies on launch (observed on a MacBook Air: 153 MB where
 * a healthy build is 344 MB, SIGABRT, surfaced as "Target page, context or browser has been
 * closed"). The trap underneath is that `playwright install chromium` SKIPS a version whose
 * directory is already present — so the obvious remediation, and the one this code used to print
 * for the user to run by hand, silently does nothing for exactly the case that needs it. Hence
 * `--force`, and hence treating a launch crash as a reason to re-fetch rather than only an absence.
 */
async function defaultLaunch(opts: { headless: boolean }): Promise<CeremonyBrowser> {
  const { chromium } = await import('playwright');
  return (await chromium.launch({ headless: opts.headless, timeout: LAUNCH_TIMEOUT_MS })) as unknown as CeremonyBrowser;
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
