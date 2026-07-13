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
// Target resolution poll (a step's data-demo-target may not exist yet, e.g. right
// after a navigate). Mirrors the C3 runtime's own budget.
const TARGET_POLL_MS = 200;
const TARGET_TIMEOUT_MS = 8000;

/**
 * external-image-step images are served UNDER /api/demos/assets/. A path is allowed
 * ONLY if it stays inside that mount: no dot-segment (`..`), no leading slash
 * (absolute), no scheme (`:` — http:, javascript:, data:), no backslash. Defence in
 * depth alongside the demoSpecSchema pattern (api/src/services/demo-registry.ts): a
 * hostile/compromised tour spec must not be able to point the browser at an arbitrary
 * same-origin path (e.g. `../app-assistant`), so an unsafe image is SKIPPED, never
 * concatenated into a fetched URL.
 */
function isSafeImagePath(image) {
  return (
    typeof image === 'string' &&
    image.length > 0 &&
    image.indexOf('..') === -1 &&
    image.charAt(0) !== '/' &&
    image.indexOf('\\') === -1 &&
    image.indexOf(':') === -1
  );
}

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
  let injectedPrompt = null;
  let advanceResolve = null; // resolves the current manual-advance / await wait
  let cleanupAwait = null; // detaches an await-action listener/poller/timeout

  // Lifecycle token (single-flight + abort). Every start() and cancel() bumps
  // `generation`; a run is "current" only while its captured token matches. A
  // superseded/cancelled run's awaits (target poll, manual wait, await-action) all
  // resolve early and the run loop returns WITHOUT drawing or wedging — so cancel()
  // (incl. panel close), a double-start, or a late-appearing target can never leave a
  // stale ring, a leaked listener, or a Promise nobody resolves.
  let generation = 0;
  function isCurrent(gen) {
    return gen === generation;
  }
  // Resolve whatever wait the live run is parked on (manual Seguinte OR an
  // await-action) so a superseded/cancelled run resumes and returns. The target
  // pre-poll (waitForTarget) aborts itself on the generation change, so it needs no
  // resolver here.
  function abortPending() {
    const r = advanceResolve;
    advanceResolve = null;
    cleanupAwait = null;
    if (r) r();
  }

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
  function awaitUserAction(step, gen) {
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
      // Seguinte skips the wait; cancel()/start() drive this via abortPending().
      advanceResolve = finish;
      cleanupAwait = cleanup;

      if (step.event === 'click') {
        const sel = '[data-demo-target="' + cssAttr(step.target) + '"]';
        onClick = (e) => {
          if (!isCurrent(gen)) { finish(); return; } // superseded -> stop listening
          const t = e && e.target;
          if (t && t.closest && t.closest(sel)) finish();
        };
        document.addEventListener('click', onClick, true);
      } else {
        // result-ready: resolve once the target is present and laid out (non-zero box).
        poll = window.setInterval(() => {
          if (!isCurrent(gen)) { finish(); return; } // superseded -> abort the poll
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

  // Abortable poll for a step's data-demo-target element (it may not exist yet, e.g.
  // right after a navigate). Resolves the element, or null on timeout OR when this run
  // is superseded/cancelled (the generation moved). Because the PLAYER owns the wait,
  // cancel()/double-start abort it here — the runtime is never left polling in the
  // background, and a stale run never asks the runtime to draw.
  function waitForTarget(name, gen) {
    return new Promise((resolve) => {
      const find = () => document.querySelector('[data-demo-target="' + cssAttr(name) + '"]');
      const first = find();
      if (first) {
        resolve(first);
        return;
      }
      const deadline = Date.now() + TARGET_TIMEOUT_MS;
      const timer = window.setInterval(() => {
        if (!isCurrent(gen)) {
          window.clearInterval(timer);
          resolve(null);
          return;
        }
        const el = find();
        if (el) {
          window.clearInterval(timer);
          resolve(el);
          return;
        }
        if (Date.now() > deadline) {
          window.clearInterval(timer);
          resolve(null);
        }
      }, TARGET_POLL_MS);
    });
  }

  // Draw the C3 spotlight on the step's target. The player waits (abortably) for the
  // target here; the runtime only DRAWS (it owns the visible highlight). A
  // superseded/cancelled run resolves without asking the runtime to draw.
  async function spotlight(step, gen) {
    const el = await waitForTarget(step.target, gen);
    if (!isCurrent(gen) || !el) return;
    const rt = runtime();
    if (rt && typeof rt.spotlight === 'function') {
      await rt.spotlight(step.target, stepCopy(step));
    }
  }

  async function runStep(step, gen) {
    status = step.type === 'await-action' ? 'awaiting' : 'playing';

    switch (step.type) {
      case 'navigate': {
        await doNavigate(step.to);
        if (!isCurrent(gen)) return;
        emit();
        // A navigate WITH copy pauses for the reader; a bare navigate flows through.
        if (step.copy) await waitManual();
        break;
      }
      case 'spotlight':
      case 'annotate-result': {
        await spotlight(step, gen);
        if (!isCurrent(gen)) return; // superseded/cancelled during the target wait
        emit();
        await waitManual();
        if (!isCurrent(gen)) return; // superseded/cancelled while paused (cancel already cleared)
        clearSpotlight();
        break;
      }
      case 'await-action': {
        await spotlight(step, gen);
        if (!isCurrent(gen)) return;
        emit();
        await awaitUserAction(step, gen);
        if (!isCurrent(gen)) return;
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
        // Containment: render a demo-asset image ONLY if the path stays inside
        // /api/demos/assets/. A hostile `..`/absolute/scheme path is SKIPPED (never
        // concatenated into a fetched URL); the step still advances on Seguinte.
        if (isSafeImagePath(step.image)) {
          emit({ imageUrl: DEMOS_ENDPOINT.replace('/demos/', '/demos/assets/') + step.image });
        } else {
          emit({ imageBlocked: true });
        }
        await waitManual();
        break;
      }
      default: {
        emit();
        break;
      }
    }
  }

  async function run(gen) {
    status = 'playing';
    for (stepIndex = 0; stepIndex < spec.steps.length; stepIndex++) {
      if (!isCurrent(gen)) return;
      injectedPrompt = null;
      await runStep(spec.steps[stepIndex], gen);
      if (!isCurrent(gen)) return;
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
     * Start playback. SINGLE-FLIGHT: bumps the lifecycle token so any in-flight run is
     * superseded (its awaits resolve early and it returns without side effects) before
     * THIS run plays — so a double-start leaves exactly one live run. Pass a spec to
     * play it directly; otherwise the overview tour is fetched from GET /api/demos/:appId.
     * `tourId` is accepted for forward compatibility (multi-tour selection) — the route
     * currently serves the app's overview tour, which is what plays.
     */
    async start(preSpec, tourId) {
      void tourId;
      generation += 1;
      const gen = generation;
      abortPending(); // release any wait the superseded run was parked on
      clearSpotlight();
      spec = null;
      stepIndex = -1;
      injectedPrompt = null;
      try {
        const loaded = preSpec || (await load());
        if (!isCurrent(gen)) return; // superseded while loading
        spec = loaded;
        if (!spec || !Array.isArray(spec.steps) || spec.steps.length === 0) {
          throw new Error('empty-tour');
        }
        await run(gen);
      } catch (err) {
        if (!isCurrent(gen)) return;
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
    /** Stop the tour and clear all transient UI (Sair / panel close). Bumps the
     *  lifecycle token so the live run is superseded and its awaits (target poll,
     *  manual wait, await-action listener) all resolve early and abort. */
    cancel() {
      generation += 1;
      abortPending();
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
