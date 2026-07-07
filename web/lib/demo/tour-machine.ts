/**
 * Host-side tour machine for the Tutorial Bridge - framework-free and
 * unit-testable. It drives a single demo spec by talking to the injected bridge
 * client (cortex/src/services/demo-bridge-client.js) inside the served-app
 * iframe over postMessage, and reports state transitions to the host UI.
 *
 * It never touches React or the DOM tree of the app: navigation is delegated to
 * the host via `navigateApp`, and every message is origin-validated against the
 * app's origin before it is trusted.
 */
import { DEMO_ENVELOPE, type DemoSpec, type DemoStep, type TourState, type TourStatus } from "./types";

export interface TourControllerOptions {
  spec: DemoSpec;
  /** Origin of the served-app iframe (e.g. http://localhost:7747). */
  appOrigin: string;
  /** Returns the live iframe element (its contentWindow is the message target). */
  getIframe: () => HTMLIFrameElement | null;
  /** Point the iframe at an app-relative path (a full reload of the app). */
  navigateApp: (path: string) => void;
  /** Surface an inject-prompt step's text on the host (chat composer/store). */
  injectPrompt: (prompt: string) => void;
  /** Called on every state transition. */
  onState: (state: TourState) => void;
  /** Overridable for tests; defaults to window. */
  win?: Window;
}

export interface TourController {
  start: (resume?: boolean) => void;
  next: () => void;
  cancel: () => void;
  dispose: () => void;
  /** The host must call this from the iframe's onLoad so re-init targets the new document. */
  notifyIframeLoad: () => void;
}

const STORAGE_KEY = "ekoa-demo-tour";
const INIT_RETRY_MS = 400;
const CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_STEP_TIMEOUT_MS = 20_000;

interface Persisted {
  appId: string;
  stepIndex: number;
}

export function createTourController(options: TourControllerOptions): TourController {
  const { spec, appOrigin, getIframe, navigateApp, injectPrompt, onState } = options;
  const win: Window = options.win || (typeof window !== "undefined" ? window : (undefined as unknown as Window));

  let status: TourStatus = "idle";
  let stepIndex = 0;
  let awaitingManual = false;
  let resultReady = false;
  let errorMessage: string | undefined;
  let disposed = false;

  let connectResolve: (() => void) | null = null;
  let initTimer: ReturnType<typeof setInterval> | null = null;
  let connectDeadline: ReturnType<typeof setTimeout> | null = null;
  let stepTimer: ReturnType<typeof setTimeout> | null = null;
  let loadWaiters: Array<() => void> = [];

  const steps: DemoStep[] = spec.steps;

  // ---- state emission -------------------------------------------------------

  function emit(): void {
    onState({
      status,
      stepIndex,
      totalSteps: steps.length,
      step: steps[stepIndex] ?? null,
      awaitingManual,
      resultReady,
      error: errorMessage,
    });
  }

  // ---- persistence (refresh-resume) ----------------------------------------

  function persist(): void {
    try {
      win?.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify({ appId: spec.appId, stepIndex } satisfies Persisted));
    } catch {
      /* private mode / disabled storage */
    }
  }

  function clearPersist(): void {
    try {
      win?.sessionStorage?.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function readPersist(): Persisted | null {
    try {
      const raw = win?.sessionStorage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed && parsed.appId === spec.appId && Number.isInteger(parsed.stepIndex)) return parsed;
    } catch {
      /* ignore */
    }
    return null;
  }

  // ---- messaging ------------------------------------------------------------

  function postToApp(type: string, payload: Record<string, unknown>): void {
    const frame = getIframe();
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ __ekoaDemo: DEMO_ENVELOPE, type, ...payload }, appOrigin);
    } catch {
      /* frame torn down */
    }
  }

  function clearInitTimers(): void {
    if (initTimer) { clearInterval(initTimer); initTimer = null; }
    if (connectDeadline) { clearTimeout(connectDeadline); connectDeadline = null; }
  }

  // Resolve on the NEXT iframe load (or after `timeoutMs`, so a same-URL navigate
  // that fires no load event still proceeds). Register the waiter BEFORE calling
  // navigateApp so the load is never missed.
  function waitForNextLoad(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finishOnce = () => {
        if (done) return;
        done = true;
        loadWaiters = loadWaiters.filter((w) => w !== finishOnce);
        resolve();
      };
      loadWaiters.push(finishOnce);
      setTimeout(finishOnce, timeoutMs);
    });
  }

  // Re-establish the bridge handshake (initial load AND after each navigate,
  // which reloads the iframe and spawns a fresh bridge). Resolves on demo.ready.
  function ensureConnected(): Promise<void> {
    clearInitTimers();
    return new Promise<void>((resolve, reject) => {
      connectResolve = resolve;
      const send = () => postToApp("demo.init", { hostOrigin: win?.location?.origin });
      send();
      initTimer = setInterval(send, INIT_RETRY_MS);
      connectDeadline = setTimeout(() => {
        clearInitTimers();
        reject(new Error("connect-timeout"));
      }, CONNECT_TIMEOUT_MS);
    });
  }

  // ---- step timeout guard ---------------------------------------------------

  function armStepTimeout(step: DemoStep): void {
    clearStepTimeout();
    const ms =
      "timeoutMs" in step && typeof step.timeoutMs === "number" ? step.timeoutMs + 5_000 : DEFAULT_STEP_TIMEOUT_MS;
    stepTimer = setTimeout(() => finish("error", "step-timeout"), ms);
  }

  function clearStepTimeout(): void {
    if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
  }

  // ---- step execution -------------------------------------------------------

  function runStep(index: number): void {
    if (disposed) return;
    clearStepTimeout();
    if (index >= steps.length) {
      finish("done");
      return;
    }
    stepIndex = index;
    awaitingManual = false;
    resultReady = false;
    errorMessage = undefined;
    persist();

    const step = steps[index];
    switch (step.type) {
      case "navigate": {
        status = "running";
        emit();
        // Register the load waiter BEFORE navigating so we re-init the NEW
        // document's bridge (not the old one, which would answer demo.init while
        // still alive and leave the reloaded bridge un-initialised).
        const loaded = waitForNextLoad(CONNECT_TIMEOUT_MS);
        navigateApp(step.to);
        loaded
          .then(() => ensureConnected())
          .then(() => {
            // A navigate with copy pauses for the user to read (manual advance);
            // a bare navigate flows straight through.
            if (step.copy) {
              awaitingManual = true;
              emit();
            } else {
              advance();
            }
          })
          .catch(() => finish("error", "connect-timeout"));
        break;
      }
      case "spotlight": {
        status = "running";
        awaitingManual = true;
        postToApp("demo.spotlight", { id: step.id, target: step.target, copy: step.copy, timeoutMs: step.timeoutMs });
        armStepTimeout(step);
        emit();
        break;
      }
      case "await-action": {
        status = "awaiting";
        postToApp("demo.await", { id: step.id, target: step.target, event: step.event, timeoutMs: step.timeoutMs });
        armStepTimeout(step);
        emit();
        break;
      }
      case "annotate-result": {
        status = "running";
        awaitingManual = false;
        // Wait for the app to signal the result is on screen, then annotate it
        // and let the user advance manually.
        postToApp("demo.await", {
          id: `${step.id}:result`,
          target: step.target,
          event: "result-ready",
          timeoutMs: step.timeoutMs,
        });
        armStepTimeout(step);
        emit();
        break;
      }
      case "inject-prompt": {
        status = "running";
        awaitingManual = true;
        injectPrompt(step.prompt);
        emit();
        break;
      }
      case "external-image-step": {
        status = "running";
        awaitingManual = true;
        emit();
        break;
      }
      default: {
        // Exhaustiveness guard.
        advance();
      }
    }
  }

  function advance(): void {
    runStep(stepIndex + 1);
  }

  function finish(next: TourStatus, reason?: string): void {
    clearStepTimeout();
    clearInitTimers();
    status = next;
    errorMessage = reason;
    if (next === "done" || next === "cancelled") clearPersist();
    if (next === "cancelled" || next === "done" || next === "error") {
      postToApp("demo.end", { id: "tour" });
    }
    emit();
  }

  // ---- message handler ------------------------------------------------------

  function onMessage(event: MessageEvent): void {
    if (disposed) return;
    if (event.origin !== appOrigin) return;
    const data = event.data as { __ekoaDemo?: number; type?: string; id?: string; targets?: string[]; reason?: string };
    if (!data || data.__ekoaDemo !== DEMO_ENVELOPE || typeof data.type !== "string") return;

    switch (data.type) {
      case "demo.ready": {
        clearInitTimers();
        if (connectResolve) { const r = connectResolve; connectResolve = null; r(); }
        // Re-arma o passo pendente num documento NOVO: um clique de
        // await-action que navega dentro da app mata a ponte que tinha o
        // await armado - o passo seguinte (await/annotate) ficaria à espera
        // para sempre. Quando a ponte fresca faz o handshake a meio de um
        // passo, o await desse passo é reenviado à nova ponte.
        {
          const step = steps[stepIndex];
          if (step && (status === "running" || status === "awaiting")) {
            if (step.type === "await-action") {
              postToApp("demo.await", { id: step.id, target: step.target, event: step.event, timeoutMs: step.timeoutMs });
            } else if (step.type === "annotate-result") {
              postToApp("demo.await", { id: `${step.id}:result`, target: step.target, event: "result-ready", timeoutMs: step.timeoutMs });
            }
          }
        }
        break;
      }
      case "demo.action": {
        const step = steps[stepIndex];
        if (!step) break;
        if (step.type === "await-action" && data.id === step.id) {
          clearStepTimeout();
          postToApp("demo.clear", { id: step.id });
          advance();
        } else if (step.type === "annotate-result" && data.id === `${step.id}:result`) {
          clearStepTimeout();
          postToApp("demo.annotate", { id: step.id, target: step.target, copy: step.copy });
          resultReady = true;
          awaitingManual = true;
          emit();
        }
        break;
      }
      case "demo.error": {
        const step = steps[stepIndex];
        if (!step) break;
        const expectedId =
          step.type === "annotate-result" ? `${step.id}:result` : "id" in step ? (step as { id: string }).id : undefined;
        if (data.id === expectedId) {
          finish("error", data.reason || "app-error");
        }
        break;
      }
      case "demo.targets-changed":
      case "demo.result-ready":
      case "demo.ack":
      default:
        break;
    }
  }

  // ---- public API -----------------------------------------------------------

  function start(resume?: boolean): void {
    if (disposed) return;
    if (win?.addEventListener) win.addEventListener("message", onMessage);
    let startAt = 0;
    if (resume) {
      const p = readPersist();
      if (p) startAt = Math.min(Math.max(0, p.stepIndex), Math.max(0, steps.length - 1));
    }
    status = "running";
    stepIndex = startAt;
    emit();
    // Connect at the current iframe location, then run. A navigate step will
    // re-connect after it reloads the frame.
    ensureConnected()
      .then(() => runStep(startAt))
      .catch(() => finish("error", "connect-timeout"));
  }

  function next(): void {
    if (disposed) return;
    if (status !== "running" || !awaitingManual) return;
    const step = steps[stepIndex];
    if (step && "id" in step) postToApp("demo.clear", { id: (step as { id: string }).id });
    advance();
  }

  function cancel(): void {
    if (disposed) return;
    finish("cancelled");
  }

  function notifyIframeLoad(): void {
    const waiters = loadWaiters.slice();
    loadWaiters = [];
    waiters.forEach((w) => w());
    // Documento novo a meio de um passo (navegação SPA/reload provocada por um
    // await-action): a ponte fresca só fala depois de um demo.init - reenviá-lo
    // aqui faz o handshake, e o handler de demo.ready re-arma o await pendente.
    if (waiters.length === 0 && (status === "running" || status === "awaiting")) {
      postToApp("demo.init", { hostOrigin: win?.location?.origin });
    }
  }

  function dispose(): void {
    disposed = true;
    clearStepTimeout();
    clearInitTimers();
    loadWaiters = [];
    if (win?.removeEventListener) win.removeEventListener("message", onMessage);
  }

  return { start, next, cancel, dispose, notifyIframeLoad };
}
