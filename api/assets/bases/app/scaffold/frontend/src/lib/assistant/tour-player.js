/*
 * Ekoa in-app TOUR PLAYER - SAME-DOCUMENT guided-tour playback for the operator
 * assistant panel (operator-run E2).
 *
 * The surviving Tutorial Bridge player (web/lib/demo/tour-machine.ts) drives a
 * tour across a CROSS-ORIGIN iframe over postMessage. Inside a served app there is
 * no host<->frame split, so THIS player drives the SAME document directly: it
 * reuses the C3 action runtime's spotlight primitive (window.__ekoaActions.
 * spotlight / clearSpotlight - the runtime OWNS the visible highlight) and
 * sequences the declarative steps itself. It replaces only the transport; the
 * drawing / await primitives are reused, not rebuilt.
 *
 * ZERO TOKENS. Playback is 100% client-side. The ONLY network read is
 * GET /api/demos/:appId for the pre-generated tour (a static declarative spec).
 * The player NEVER calls the app-assistant model endpoint - no model turn is
 * issued while a tour plays. That is the zero-token guarantee (asserted in
 * tests/apps/tour-player.test.ts and the live gate tests/e2e/tour-playback.e2e.mjs).
 *
 * Step types (authoritative validator: api/src/services/demo-registry.ts):
 *   navigate | spotlight | await-action | annotate-result | inject-prompt |
 *   external-image-step.
 * Every step `target` is a data-demo-target NAME - the action-registry id
 * namespace - resolved by ATTRIBUTE selector inside the C3 runtime, so a rebuilt
 * app's tour still points at real elements (selector stability, the E2 rebuild
 * gate). inject-prompt only surfaces a suggested prompt in the composer; it NEVER
 * auto-sends (the LLM may be unavailable, and sending would break the zero-token
 * invariant).
 *
 * Brand-neutral + PT-PT throughout; no emoji. The panel renders the narration +
 * controls; this module holds no view.
 */

const DEMOS_ENDPOINT = '/api/demos/';
// A safety ceiling so an unattended await-action step can never hang the tour
// forever; a spec may override it per step (timeoutMs). The user can always
// advance manually (Seguinte) before this fires.
const DEFAULT_AWAIT_TIMEOUT_MS = 60000;

/** The served-app id stamped by injectAppContext(); absent in a standalone preview. */
function currentAppId() {
  return typeof window !== 'undefined' && window.__EKOA_APP_ID ? window.__EKOA_APP_ID : undefined;
}

/** The C3 same-document action runtime, when installed (absent in a bare preview). */
function runtime() {
  return typeof window !== 'undefined' ? window.__ekoaActions : undefined;
}

function cssAttr(name) {
  return String(name).replace(/"/g, '\\"');
}

/** The narration for a step. await-action carries no `copy`, so give it a calm
 *  PT-PT instruction; every other pausing step uses its authored copy. */
function stepCopy(step) {
  if (!step) return null;
  if (step.copy) return step.copy;
  if (step.type === 'await-action') {
    return {
      titlePt: 'A sua vez',
      bodyPt: 'Faça esta ação na aplicação para continuar. Também pode usar Seguinte para avançar.',
    };
  }
  return null;
}

/**
 * Create a same-document tour player. `onState(state)` is called on every
 * transition with `{ status, stepIndex, total, step, copy, injectedPrompt,
 * imageUrl?, tourId, error? }`. The panel reflects it (step counter, copy,
 * controls) and, when `injectedPrompt` is set, drops it into the composer.
 *
 * `status`: idle | loading | playing | awaiting | done | error | cancelled.
 */
export function createTourPlayer(opts) {
  opts = opts || {};
  const onState = typeof opts.onState === 'function' ? opts.onState : function () {};
  const fetchImpl =
    opts.fetch || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null);

  let spec = null;
  let stepIndex = -1;
  let status = 'idle';
  let cancelled = false;
  let injectedPrompt = null;
  let advanceResolve = null; // resolves the current manual-advance / await wait
  let cleanupAwait = null; // detaches an await-action listener/poller/timeout

  function emit(extra) {
    const step = spec && stepIndex >= 0 && stepIndex < spec.steps.length ? spec.steps[stepIndex] : null;
    const base = {
      status,
      stepIndex,
      total: spec ? spec.steps.length : 0,
      step,
      copy: stepCopy(step),
      injectedPrompt,
      tourId: spec ? spec.tourId || null : null,
    };
    onState(extra ? Object.assign(base, extra) : base);
  }

  function clearSpotlight() {
    const rt = runtime();
    if (rt && typeof rt.clearSpotlight === 'function') rt.clearSpotlight();
  }

  // Pause until the panel calls next() (Seguinte).
  function waitManual() {
    return new Promise((resolve) => {
      advanceResolve = resolve;
    });
  }

  // Wait for the user to perform the awaited action on the step's target, OR for a
  // manual Seguinte (skip), OR the safety timeout - whichever comes first. Reuses
  // the C3 runtime's spotlight to keep the target highlighted while waiting.
  function awaitUserAction(step) {
    return new Promise((resolve) => {
      let settled = false;
      let onClick = null;
      let poll = null;
      let timer = null;
      const cleanup = () => {
        advanceResolve = null;
        cleanupAwait = null;
        if (onClick) document.removeEventListener('click', onClick, true);
        if (poll) window.clearInterval(poll);
        if (timer) window.clearTimeout(timer);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      // Seguinte skips the wait; cancel() also drives this.
      advanceResolve = finish;
      cleanupAwait = cleanup;

      if (step.event === 'click') {
        const sel = '[data-demo-target="' + cssAttr(step.target) + '"]';
        onClick = (e) => {
          const t = e && e.target;
          if (t && t.closest && t.closest(sel)) finish();
        };
        document.addEventListener('click', onClick, true);
      } else {
        // result-ready: resolve once the target is present and laid out (non-zero box).
        poll = window.setInterval(() => {
          const el = document.querySelector('[data-demo-target="' + cssAttr(step.target) + '"]');
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) finish();
          }
        }, 200);
      }
      const to = step.timeoutMs && step.timeoutMs > 0 ? step.timeoutMs : DEFAULT_AWAIT_TIMEOUT_MS;
      timer = window.setTimeout(finish, to);
    });
  }

  // Navigate the app to `to` by REUSING the runtime's navigate action (app hook +
  // history fallback) - no duplicated navigation logic, still zero-token.
  async function doNavigate(to) {
    const rt = runtime();
    if (rt && typeof rt.execute === 'function') {
      try {
        await rt.execute({ id: 'tour-navigate', kind: 'navigate', route: to || '' });
        return;
      } catch (_) {
        /* fall through to a best-effort direct navigation */
      }
    }
    try {
      if (typeof window !== 'undefined' && window.__ekoaApp && typeof window.__ekoaApp.navigate === 'function') {
        window.__ekoaApp.navigate(to || '');
      }
    } catch (_) {
      /* best-effort */
    }
  }

  async function spotlight(step) {
    const rt = runtime();
    if (rt && typeof rt.spotlight === 'function') {
      await rt.spotlight(step.target, stepCopy(step));
    }
  }

  async function runStep(step) {
    status = step.type === 'await-action' ? 'awaiting' : 'playing';

    switch (step.type) {
      case 'navigate': {
        await doNavigate(step.to);
        emit();
        // A navigate WITH copy pauses for the reader; a bare navigate flows through.
        if (step.copy) await waitManual();
        break;
      }
      case 'spotlight':
      case 'annotate-result': {
        await spotlight(step);
        emit();
        await waitManual();
        clearSpotlight();
        break;
      }
      case 'await-action': {
        await spotlight(step);
        emit();
        await awaitUserAction(step);
        clearSpotlight();
        break;
      }
      case 'inject-prompt': {
        // Surface the suggested prompt in the composer; NEVER auto-send.
        injectedPrompt = step.prompt;
        emit();
        await waitManual();
        break;
      }
      case 'external-image-step': {
        emit({ imageUrl: DEMOS_ENDPOINT.replace('/demos/', '/demos/assets/') + step.image });
        await waitManual();
        break;
      }
      default: {
        emit();
        break;
      }
    }
  }

  async function run() {
    status = 'playing';
    for (stepIndex = 0; stepIndex < spec.steps.length; stepIndex++) {
      if (cancelled) return;
      injectedPrompt = null;
      await runStep(spec.steps[stepIndex]);
      if (cancelled) return;
    }
    clearSpotlight();
    status = 'done';
    stepIndex = spec.steps.length;
    injectedPrompt = null;
    emit();
  }

  async function load() {
    status = 'loading';
    emit();
    const id = currentAppId();
    if (!id) throw new Error('no-app-id');
    if (!fetchImpl) throw new Error('no-fetch');
    const res = await fetchImpl(DEMOS_ENDPOINT + encodeURIComponent(id), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('tour-fetch-' + res.status);
    return res.json();
  }

  return {
    /**
     * Start playback. Pass a spec to play it directly; otherwise the overview tour
     * is fetched from GET /api/demos/:appId. `tourId` is accepted for forward
     * compatibility (multi-tour selection) - the route currently serves the app's
     * overview tour, which is what plays.
     */
    async start(preSpec /*, tourId */) {
      cancelled = false;
      injectedPrompt = null;
      try {
        spec = preSpec || (await load());
        if (!spec || !Array.isArray(spec.steps) || spec.steps.length === 0) {
          throw new Error('empty-tour');
        }
        await run();
      } catch (err) {
        clearSpotlight();
        status = 'error';
        emit({ error: (err && err.message) || 'tour-error' });
      }
    },
    /** Advance the current step (Seguinte), or skip an await-action wait. */
    next() {
      if (advanceResolve) {
        const r = advanceResolve;
        advanceResolve = null;
        r();
      }
    },
    /** Stop the tour and clear all transient UI (Sair). */
    cancel() {
      cancelled = true;
      if (cleanupAwait) cleanupAwait();
      if (advanceResolve) {
        const r = advanceResolve;
        advanceResolve = null;
        r();
      }
      clearSpotlight();
      status = 'cancelled';
      stepIndex = -1;
      injectedPrompt = null;
      emit();
    },
    /** The current status (idle | loading | playing | awaiting | done | error | cancelled). */
    get status() {
      return status;
    },
  };
}

export default createTourPlayer;
