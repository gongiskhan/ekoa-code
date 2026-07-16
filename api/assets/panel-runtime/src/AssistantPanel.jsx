/*
 * Operator Assistant Panel - platform-shipped for the `app` base (operator-run D2;
 * lazy-loaded as a platform runtime asset since operator-run G2).
 *
 * The in-app assistant every generated app carries. It is compiled into the
 * platform panel-runtime asset (api/assets/panel-runtime) and mounts INTO the
 * shell's <div id="ekoa-assistant-root"> (see index.jsx, the asset entry) and
 * speaks ONLY two things:
 *
 *   1. POST /api/app-assistant (D1) - the served-app assistant endpoint. It carries
 *      the visitor's message, the running history, the pinned/echoed mode, the
 *      current screen context, and the X-Ekoa-App-Id header. The reply, its
 *      knowledge citations ("Fontes"), and the app-actions the assistant proposes
 *      come back on the response.
 *   2. window.__ekoaActions.execute(action) (C3 same-document runtime) - for EACH
 *      action the assistant proposes. The runtime owns the VISIBLE driving badge,
 *      the target highlight, the destructive confirmation card, and the
 *      pause-on-real-user-input; the panel only calls execute() and shows a subtle
 *      "a executar..." state until it resolves. The panel NEVER dispatches an
 *      action the assistant did not return.
 *
 * Three capabilities / three modes: OPERAR (do) operates the app, MOSTRAR (show)
 * gives an overview, ENSINAR (teach) walks through a tutorial. The server infers
 * the mode from the phrasing; the toggle lets the visitor pin it, and the server's
 * echoed response.mode is reflected back.
 *
 * The panel is PLATFORM code: brand-neutral via the CSS-var contract, PT-PT
 * throughout (lawyer-facing), no emoji, and non-blocking - it never steals focus
 * from the app and every failure renders a calm message instead of crashing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createTourPlayer } from './tour-player';
// H3 EDIT MODE (admins only): the network side of the admin patch-run flow, factored out
// so it is unit-provable against a fake fetch. It targets the PLATFORM /api/v1/* API with
// the admin's platform Bearer - a SEPARATE plane from the visitor-blind POST
// /api/app-assistant. Every action it calls is H1-gated server-side; this panel only SHOWS
// the affordance when detection said admin, and only after the admin OPTS IN (detect-then-ask).
import { runEditPatch, guardedRollback, degradeMessage, progressLine, EDIT_COPY } from './edit-mode';
// H4 CHANGE REQUESTS (non-admins): a viewer who cannot edit this app can file a change request
// into the app OWNER's org-admin queue (a SEPARATE thin platform endpoint; the visitor-blind
// POST /api/app-assistant plane is untouched). Filing requires a logged-in platform user.
import { fileChangeRequest, REQUEST_COPY } from './change-request';
import './AssistantPanel.css';

const ENDPOINT = '/api/app-assistant';
// H2 admin DETECTION (detect-then-ask). A cheap, non-LLM GET that answers ONLY "is the current
// viewer an admin of this app's owner org?". It NEVER issues an assistant turn (the zero-token
// invariant holds) and its result NEVER auto-enables anything - it only lights a discreet
// indicator. The edit-mode switch + its opt-in UX are H3; this panel does not build them.
const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
// Tour AVAILABILITY probe base (E1/E2) - the probe hits /:appId/availability, an
// always-200 { available } endpoint (a tourless app is a by-design state, and the
// browser logs every non-2xx to the console); the PLAYER still fetches /:appId for
// the spec itself. Probed ONCE per mounted panel (cheap, non-LLM, zero-token) so
// the teach-mode launcher is only offered when this app actually stores a tour:
// "an app with no tours simply has no teach path" (authoring-tours skill). A dead
// launcher that can only error is a bug.
const DEMOS_PROBE_ENDPOINT = '/api/demos/';
// The platform session token key web/lib/api/token.ts uses. Read best-effort for detection only:
// a served app on the SAME origin as the dashboard can read it; a CROSS-origin / sandboxed iframe
// (the dev preview) throws on access, so detection simply falls back to "not admin".
const TOKEN_STORAGE_KEY = 'ekoa_token';
// Bounds (codex-d2): the transcript kept in memory, the history slice sent per turn,
// and a hard timeout on the assistant fetch so a hung turn can never lock the composer.
const MAX_MESSAGES = 200;
const MAX_HISTORY_TURNS = 16;
const FETCH_TIMEOUT_MS = 120000;

/** The three modes, in toggle order, with their PT-PT labels. */
const MODES = [
  { id: 'do', label: 'Operar' },
  { id: 'show', label: 'Mostrar' },
  { id: 'teach', label: 'Ensinar' },
];

/** The first-open capability prompts (PT-PT), one per capability. Clicking one
 *  pins its mode and drops the example into the composer. */
const EXAMPLES = [
  { mode: 'do', kind: 'Operar', prompt: 'Adicione um novo registo' },
  { mode: 'show', kind: 'Mostrar', prompt: 'Dê-me uma visão geral da aplicação' },
  { mode: 'teach', kind: 'Ensinar', prompt: 'Mostre-me um tutorial' },
];

const ERROR_REPLY = 'O assistente está indisponível de momento.';
const MAX_ACTION_RESULTS = 8;

/** The served-app id stamped by injectAppContext(); absent in a standalone preview. */
function appId() {
  return typeof window !== 'undefined' && window.__EKOA_APP_ID ? window.__EKOA_APP_ID : undefined;
}

/** Best-effort read of the platform session token for admin DETECTION only (H2). Same-origin
 *  served pages can read the dashboard's localStorage; a cross-origin or sandboxed iframe throws
 *  a SecurityError on `localStorage` access - swallow it to null so detection just degrades to
 *  "not admin" (no affordance) instead of crashing the panel. Reads nothing else and stores
 *  nothing - the token is attached to the one whoami GET and never kept. */
function readPlatformToken() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const t = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return typeof t === 'string' && t ? t : null;
  } catch {
    return null;
  }
}

/** A short display sha for the edit-mode preview (7 chars, like git). Undefined -> a dash. */
function shortSha(sha) {
  return typeof sha === 'string' && sha ? sha.slice(0, 7) : '-';
}

/** The app's current route/page, best-effort: the shell may expose it on
 *  window.__ekoaApp; otherwise fall back to the location. Undefined when unknown. */
function currentRoute() {
  if (typeof window === 'undefined') return undefined;
  const app = window.__ekoaApp;
  if (app && typeof app.route === 'string' && app.route) return app.route;
  if (app && typeof app.currentRoute === 'string' && app.currentRoute) return app.currentRoute;
  const loc = window.location;
  const r = (loc && (loc.hash || loc.pathname)) || '';
  return r ? String(r) : undefined;
}

/** Best-effort short screen-context descriptor for a filed change request (H4): the shell may
 *  expose a `screenState` string on window.__ekoaApp; otherwise fall back to the document title so
 *  the org-admin has a hint of WHERE the request came from. Bounded; undefined when nothing known.
 *  Never throws (a cross-origin access is swallowed). Org-internal - never egressed to a model. */
function captureScreenState() {
  if (typeof window === 'undefined') return undefined;
  try {
    const app = window.__ekoaApp;
    if (app && typeof app.screenState === 'string' && app.screenState) return app.screenState.slice(0, 8000);
    const title = typeof document !== 'undefined' && document.title ? String(document.title) : '';
    return title ? title.slice(0, 8000) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Map a proposed action to the manifest form window.__ekoaActions.execute expects
 * (kind/target/route/destructive/labelPt + a VALUES object on params). D1 sends
 * `{ toolName, input }`; when the response is enriched with the resolved manifest
 * `action` we drive it directly, otherwise we forward what we have (the runtime
 * reports a clean failure for an action it cannot resolve - never a crash).
 */
function toRuntimeAction(a) {
  const values = (a && (a.input || a.params)) || {};
  if (a && a.action && typeof a.action === 'object') {
    return { ...a.action, params: values };
  }
  const id =
    a && typeof a.toolName === 'string'
      ? a.toolName.replace(/^app_action__/, '').replace(/_/g, '-')
      : undefined;
  return { id, toolName: a && a.toolName, params: values };
}

/** A short PT-PT status line for one action run. */
function runLabel(status) {
  switch (status) {
    case 'running':
      return 'A executar...';
    case 'done':
      return 'Ação executada.';
    case 'cancelled':
      return 'Ação cancelada.';
    case 'unavailable':
      return 'Ação indisponível nesta pré-visualização.';
    default:
      return 'Não foi possível executar a ação.';
  }
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

/** PT-PT status line for a non-stepping tour phase (playing/awaiting show the copy). */
function tourStatusText(status) {
  switch (status) {
    case 'loading':
      return 'A carregar o tutorial...';
    case 'awaiting':
      return 'Aguardando a sua ação na aplicação...';
    case 'done':
      return 'Tutorial concluído.';
    case 'error':
      return 'Não foi possível carregar o tutorial guiado.';
    default:
      return '';
  }
}

/**
 * The tour block rendered in the panel while a same-document tour plays. The
 * on-page highlight/tooltip is drawn by the C3 runtime (window.__ekoaActions
 * spotlight); this block carries the step counter, the narration, and the
 * Seguinte / Sair controls. It exposes data-tour-status + data-tour-step-index for
 * the deterministic live gate. No emoji; brand-neutral via the panel CSS vars.
 */
function TourView({ tour, onNext, onClose }) {
  const { status, stepIndex, total, copy, imageUrl, imageBlocked, injectedPrompt } = tour;
  const stepping = status === 'playing' || status === 'awaiting';
  const stepNo = total > 0 ? Math.min(stepIndex + 1, total) : 0;
  const statusLine = tourStatusText(status);
  return (
    <section
      className="ekoa-assistant-tour"
      data-tour-status={status}
      data-tour-step-index={stepIndex}
      aria-label="Tutorial guiado"
    >
      <div className="ekoa-assistant-tour-head">
        <span className="ekoa-assistant-tour-title">Tutorial guiado</span>
        {stepping && total > 0 ? (
          <span className="ekoa-assistant-tour-progress">{`Passo ${stepNo} de ${total}`}</span>
        ) : null}
      </div>

      {copy ? (
        <div className="ekoa-assistant-tour-copy">
          {copy.titlePt ? <div className="ekoa-assistant-tour-copy-title">{copy.titlePt}</div> : null}
          {copy.bodyPt ? <div className="ekoa-assistant-tour-copy-body">{copy.bodyPt}</div> : null}
        </div>
      ) : null}

      {injectedPrompt ? (
        <div className="ekoa-assistant-tour-note">
          Sugestão colocada na caixa de mensagem, para rever antes de enviar.
        </div>
      ) : null}

      {imageUrl ? <img className="ekoa-assistant-tour-image" src={imageUrl} alt="" /> : null}

      {imageBlocked ? (
        <div className="ekoa-assistant-tour-note">Imagem ignorada (caminho não permitido).</div>
      ) : null}

      {statusLine ? <div className="ekoa-assistant-tour-status">{statusLine}</div> : null}

      <div className="ekoa-assistant-tour-controls">
        {stepping ? (
          <button type="button" className="ekoa-assistant-tour-next" onClick={onNext}>
            Seguinte
          </button>
        ) : null}
        <button type="button" className="ekoa-assistant-tour-close" onClick={onClose}>
          {status === 'done' || status === 'error' ? 'Fechar' : 'Sair'}
        </button>
      </div>
    </section>
  );
}

export function AssistantPanel({ defaultOpen = false } = {}) {
  // Collapsed on mount UNLESS the launcher handed off an explicit open intent. Since
  // G2 the panel is lazy-loaded: the app-bundle launcher (scaffold mount.js) injects
  // this asset and passes `defaultOpen` true when the VISITOR clicked it (open now),
  // false when the asset was idle-preloaded (mount collapsed, show only the launcher).
  const [collapsed, setCollapsed] = useState(!defaultOpen);
  // `mode` is the mode CURRENTLY shown on the toggle - the server's inference (echoed
  // on each response) unless the visitor pins one. `pinnedMode` is non-null only when
  // the visitor explicitly picked a mode: only then do we send it, so by default the
  // server infers the mode from the phrasing (do/show/teach) and we reflect it back.
  const [mode, setMode] = useState('do');
  const [pinnedMode, setPinnedMode] = useState(null);
  const [messages, setMessages] = useState([]); // { id, role, content, citations?, runs? }
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // E2 same-document tour playback state (null when no tour is active). The player
  // is 100% client-side and issues ZERO model calls: it fetches the pre-generated
  // tour from GET /api/demos/:appId and drives it in the page.
  const [tour, setTour] = useState(null);
  // Tour availability: null until the mount probe answers; the teach launcher renders
  // ONLY on true, so the panel never offers a tutorial the app does not have.
  const [tourAvailable, setTourAvailable] = useState(null);
  // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
  // Default false (fail-closed). Set ONCE by the mount detection below. This flag NEVER
  // auto-enables anything - it only decides whether the H3 edit-mode SWITCH is shown (and
  // lights the discreet header indicator). Every privileged action stays gated server-side by H1.
  const [admin, setAdmin] = useState(false);

  // H3 EDIT MODE (admins only) - detect-then-ask is BINDING. `editMode` is the OPT-IN switch:
  // it starts OFF and is flipped ONLY by an explicit admin click (the switch, or the discovery
  // banner's CTA). Detection (setAdmin above) NEVER touches it - being an admin shows the switch,
  // it does not enter edit mode. The rest is the edit flow's UI state, inert until editMode is on.
  const [editMode, setEditMode] = useState(false);
  // The edit flow phase: compose (typing) -> confirm (confirm intent) -> running (patch run) ->
  // preview (approve/rollback) | note (a terminal calm message: answered/approved/reverted/degraded).
  const [editPhase, setEditPhase] = useState('compose');
  const [editDraft, setEditDraft] = useState(''); // the admin's edit request text
  const [editProgress, setEditProgress] = useState(''); // latest plan_step narration line (PT-PT)
  const [editPreview, setEditPreview] = useState(null); // { preRunSha, newHeadSha } after a run
  const [editMessage, setEditMessage] = useState(''); // calm PT-PT copy for the 'note' phase
  const [editBusy, setEditBusy] = useState(false); // guards double-submit during a run / rollback
  // Admin discovery (proactive teaching, shown ONCE, dismissible). Suppressed after the admin
  // dismisses it OR opts into edit mode. It never auto-enables edit - its CTA is an explicit click.
  const [discoveryDismissed, setDiscoveryDismissed] = useState(false);

  // H4 CHANGE REQUEST (non-admins only): the "Pedir alteração" flow. idle (a discreet button) ->
  // compose (type the request) -> note (a calm terminal message: filed / needs-login / failed).
  // Shown ONLY when admin === false; an admin uses edit mode instead. Filing requires a logged-in
  // platform user - no readable token / a 401 lands on the calm "inicie sessão" note.
  const [requestPhase, setRequestPhase] = useState('idle');
  const [requestDraft, setRequestDraft] = useState('');
  const [requestMessage, setRequestMessage] = useState(''); // calm PT-PT copy for the 'note' phase
  const [requestBusy, setRequestBusy] = useState(false); // guards double-submit during a file call

  const idRef = useRef(0);
  const messagesRef = useRef(messages);
  const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const playerRef = useRef(null);
  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)
  const tourProbeDoneRef = useRef(false); // guards the once-only tour-availability probe

  useEffect(() => {
    messagesRef.current = messages;
    // keep the newest turn in view
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    // Auto-open handoff (G2): the visitor clicked the launcher, so the panel mounts
    // already open - focus the composer once, matching an explicit open. Never runs
    // on an idle-preloaded (collapsed) mount, so it never steals focus from the app.
    if (defaultOpen && textareaRef.current) textareaRef.current.focus();
    // Mount-only: the handoff intent is fixed at mount time.
  }, [defaultOpen]);

  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
  // cross-origin/sandboxed iframe throws) and attaches it as an OPTIONAL Bearer alongside the
  // X-Ekoa-App-Id header the POST path already sends. This is a cheap non-LLM GET - it does NOT
  // count as an assistant turn (zero-token invariant). The result only lights the discreet
  // indicator; it NEVER auto-enables anything and issues no privileged call (edit mode is H3).
  useEffect(() => {
    const id = appId();
    // No app id (standalone preview) or already detected once -> nothing to do. Empty deps make
    // this a mount-only effect; the ref keeps detection to exactly ONE request per mounted panel
    // even if the effect is ever re-entered. The panel-runtime entry mounts WITHOUT StrictMode.
    if (!id || whoamiDoneRef.current) return;
    whoamiDoneRef.current = true;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const token = readPlatformToken();
    void (async () => {
      try {
        const res = await fetch(WHOAMI_ENDPOINT, {
          method: 'GET',
          ...(controller ? { signal: controller.signal } : {}),
          headers: {
            'X-Ekoa-App-Id': id,
            // OPTIONAL: sent only when a same-origin token was readable. Absent -> the server
            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
        const data = await res.json();
        setAdmin(!!(data && data.admin === true));
      } catch {
        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
      }
    })();

    return () => {
      if (controller) controller.abort();
    };
    // Mount-only: detection is a one-shot for the panel's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tour-availability probe: ONE cheap non-LLM GET on mount (the same route the player
  // fetches), so teach mode only offers "Iniciar tutorial guiado" when a stored tour
  // actually exists. Zero-token invariant holds (no assistant turn). A startTour ACTION
  // from the assistant is unaffected - the player fetches for itself and renders its own
  // error state; this probe only gates the STANDING launcher affordance.
  useEffect(() => {
    const id = appId();
    if (!id || tourProbeDoneRef.current) return;
    tourProbeDoneRef.current = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    void (async () => {
      try {
        const res = await fetch(`${DEMOS_PROBE_ENDPOINT}${encodeURIComponent(id)}/availability`, {
          method: 'GET',
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!res.ok) {
          setTourAvailable(false); // unexpected (the probe is always-200) - no launcher
          return;
        }
        const body = await res.json().catch(() => null);
        setTourAvailable(!!(body && body.available === true));
      } catch {
        // network error / aborted unmount -> stay null (no launcher; best-effort).
      }
    })();
    return () => {
      if (controller) controller.abort();
    };
    // Mount-only: availability is a one-shot for the panel's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextId = () => {
    idRef.current += 1;
    return idRef.current;
  };

  const patchTurn = useCallback((turnId, patch) => {
    setMessages((prev) => prev.map((m) => (m.id === turnId ? { ...m, ...patch(m) } : m)));
  }, []);

  const recordResult = useCallback((result) => {
    const buf = actionResultsRef.current;
    buf.push(result);
    if (buf.length > MAX_ACTION_RESULTS) buf.splice(0, buf.length - MAX_ACTION_RESULTS);
  }, []);

  // ---- E2 tour playback (same-document, zero-token) ------------------------
  // Lazily build ONE client-side tour player. Its state drives the tour block in
  // the panel; when a step surfaces a suggested prompt (inject-prompt) it lands in
  // the composer - never auto-sent. No path here calls /api/app-assistant.
  const ensurePlayer = useCallback(() => {
    if (!playerRef.current) {
      playerRef.current = createTourPlayer({
        onState: (state) => {
          setTour(state);
          if (state && state.injectedPrompt) setDraft(state.injectedPrompt);
        },
      });
    }
    return playerRef.current;
  }, []);

  /** Start playing the app's guided tour in the page. Triggered by teach mode or a
   *  startTour action. Fetches GET /api/demos/:appId inside the player - no model
   *  turn is issued. `tourId` is forwarded for forward-compat (the route serves the
   *  app's overview tour today). */
  const startTourPlayback = useCallback(
    (tourId) => {
      const player = ensurePlayer();
      setCollapsed(false);
      void player.start(undefined, tourId);
    },
    [ensurePlayer],
  );

  const tourNext = useCallback(() => {
    if (playerRef.current) playerRef.current.next();
  }, []);

  const tourClose = useCallback(() => {
    if (playerRef.current) playerRef.current.cancel();
    setTour(null);
  }, []);

  /** Collapse the panel. A tour is bound to the visible panel, so collapsing it
   *  CANCELS any active tour (clears the on-page spotlight + aborts the run) rather
   *  than leaving a ring on screen with no reachable controls. */
  const collapsePanel = useCallback(() => {
    if (playerRef.current) playerRef.current.cancel();
    setTour(null);
    setCollapsed(true);
  }, []);

  /** Run the assistant's proposed actions in order through the C3 runtime. The
   *  runtime draws the driving badge / highlight / destructive confirm and pauses
   *  on real user input - the panel only reflects each run's state. */
  const runActions = useCallback(
    async (actions, turnId) => {
      const runtime = typeof window !== 'undefined' ? window.__ekoaActions : undefined;
      for (const a of actions) {
        const runId = nextId();
        patchTurn(turnId, (m) => ({ runs: [...(m.runs || []), { id: runId, status: 'running' }] }));

        const setStatus = (status, detail) =>
          patchTurn(turnId, (m) => ({
            runs: (m.runs || []).map((r) => (r.id === runId ? { ...r, status, detail } : r)),
          }));

        // A startTour action is played by the SAME-DOCUMENT tour player, not the
        // runtime executor: the runtime's cross-frame startTour only posts a
        // tour-request (a no-op in-page) and drops the tourId. The panel owns the
        // player, so it starts playback here. Client-side + zero-token.
        const runtimeAction = toRuntimeAction(a);
        if (runtimeAction && runtimeAction.kind === 'startTour') {
          startTourPlayback(runtimeAction.tourId);
          setStatus('done');
          recordResult({ toolName: a && a.toolName, status: 'done' });
          continue;
        }

        if (!runtime || typeof runtime.execute !== 'function') {
          setStatus('unavailable');
          recordResult({ toolName: a && a.toolName, status: 'unavailable' });
          continue;
        }
        try {
          const result = await runtime.execute(runtimeAction);
          const status = (result && result.status) || 'done';
          setStatus(status, result && result.detail);
          recordResult({ toolName: a && a.toolName, status, detail: result && result.detail });
        } catch (err) {
          setStatus('failed', err && err.reason);
          recordResult({ toolName: a && a.toolName, status: 'failed', detail: err && err.reason });
        }
      }
    },
    [patchTurn, recordResult, startTourPlayback],
  );

  const send = useCallback(
    async (rawText) => {
      const text = (rawText != null ? rawText : draft).trim();
      if (!text || busy) return;

      // History is the conversation BEFORE this message (role/content pairs only),
      // capped to the most recent turns so request size, latency and model cost stay
      // bounded on a long-lived panel.
      const history = messagesRef.current
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error)
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));

      setDraft('');
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: text }].slice(-MAX_MESSAGES));
      setBusy(true);

      const route = currentRoute();
      const recent = actionResultsRef.current.slice();
      const context = {};
      if (route) context.route = route;
      if (recent.length) context.actionResults = recent;

      const id = appId();
      // A hung network/model turn must never lock the composer: abort after the
      // timeout and fall through to the calm PT-PT error turn.
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          ...(controller ? { signal: controller.signal } : {}),
          headers: {
            'Content-Type': 'application/json',
            ...(id ? { 'X-Ekoa-App-Id': id } : {}),
          },
          body: JSON.stringify({
            message: text,
            history,
            // Send the mode only when the visitor pinned it; otherwise let the server
            // infer it from the phrasing and echo it back on response.mode.
            ...(pinnedMode ? { mode: pinnedMode } : {}),
            ...(Object.keys(context).length ? { context } : {}),
          }),
        });
        if (!res.ok) {
          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
          return;
        }
        const data = await res.json();
        if (data && typeof data.mode === 'string') setMode(data.mode);
        const turnId = nextId();
        setMessages((prev) => [
          ...prev,
          {
            id: turnId,
            role: 'assistant',
            content: (data && data.reply) || '',
            citations: data && Array.isArray(data.citations) ? data.citations : undefined,
            runs: [],
          },
        ].slice(-MAX_MESSAGES));
        if (data && Array.isArray(data.actions) && data.actions.length) {
          await runActions(data.actions, turnId);
        }
      } catch {
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
      } finally {
        if (timer) clearTimeout(timer);
        setBusy(false);
      }
    },
    [draft, busy, pinnedMode, runActions],
  );

  const open = useCallback(() => {
    setCollapsed(false);
    // Focus only on an explicit open (user intent); never on mount, so the panel
    // never steals focus from the app while it loads.
    window.setTimeout(() => {
      if (textareaRef.current) textareaRef.current.focus();
    }, 0);
  }, []);

  // Open-intent handoff, late leg (G2): the boot launcher dispatches
  // 'ekoa:assistant-open' on every click. The defaultOpen flag covers a click BEFORE
  // this panel mounts; this listener covers a click AFTER it mounted collapsed (an
  // idle preload racing the visitor's click) - intent is never lost between the two.
  useEffect(() => {
    const onOpenIntent = () => open();
    window.addEventListener('ekoa:assistant-open', onOpenIntent);
    return () => window.removeEventListener('ekoa:assistant-open', onOpenIntent);
  }, [open]);

  const onExample = useCallback((example) => {
    setMode(example.mode);
    setDraft(example.prompt);
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  const onKeyDown = useCallback(
    (e) => {
      // Enter sends; Shift+Enter is a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    },
    [send],
  );

  // ---- H3 edit mode (admins only) -----------------------------------------
  // A thin front-end over the H1-gated follow-up-build machinery. The SERVER is the
  // authority (can(canEditApps) + loadWritable on every call); the panel only decides
  // whether to SHOW the affordance (admin) and drives the confirmed flow. Every mid-flow
  // 401/403/404 lands on a calm PT-PT message via degradeMessage - never a crash.

  /** Turn edit mode ON. An EXPLICIT admin action (switch or discovery CTA) - the only way
   *  edit mode is ever entered. Detection never calls this (detect-then-ask). */
  const openEditMode = useCallback(() => {
    setEditMode(true);
    setDiscoveryDismissed(true); // opting in dismisses the discovery banner
    setEditPhase('compose');
  }, []);

  /** Turn edit mode OFF and clear the whole edit flow (back to a clean compose state). */
  const closeEditMode = useCallback(() => {
    setEditMode(false);
    setEditPhase('compose');
    setEditDraft('');
    setEditPreview(null);
    setEditMessage('');
    setEditProgress('');
    setEditBusy(false);
  }, []);

  /** Dismiss the discovery banner without entering edit mode. */
  const dismissDiscovery = useCallback(() => setDiscoveryDismissed(true), []);

  /** compose -> confirm: the panel asks the admin to confirm the intent before any build. */
  const askEditConfirm = useCallback(() => {
    if (editDraft.trim()) setEditPhase('confirm');
  }, [editDraft]);

  /** confirm -> compose: step back without running anything. */
  const cancelEditConfirm = useCallback(() => setEditPhase('compose'), []);

  /** note -> compose: start a fresh edit after a terminal message. */
  const resetEdit = useCallback(() => {
    setEditPhase('compose');
    setEditDraft('');
    setEditPreview(null);
    setEditMessage('');
    setEditProgress('');
  }, []);

  /** confirm -> running -> preview | note: run the CONFIRMED patch over the existing build
   *  machinery. Reads the platform token best-effort (a cross-origin/sandboxed iframe has
   *  none); with no app id / no token it degrades calmly rather than firing a doomed call. */
  const confirmEdit = useCallback(async () => {
    const id = appId();
    const token = readPlatformToken();
    const description = editDraft.trim();
    if (!id || !token || !description) {
      // No token readable (cross-origin) reads as an expired session; otherwise a generic note.
      setEditMessage(degradeMessage(token ? 0 : 401));
      setEditPhase('note');
      return;
    }
    setEditBusy(true);
    setEditProgress('');
    setEditPhase('running');
    const result = await runEditPatch({
      fetchImpl: (url, opts) => fetch(url, opts),
      appId: id,
      token,
      description,
      onProgress: (ev) => {
        const line = progressLine(ev);
        if (line) setEditProgress(line);
      },
    });
    setEditBusy(false);
    if (result.outcome === 'ready') {
      // The JOB was CONFIRMED completed (poll), so newHeadSha reflects the finished build - never a
      // mid-build snapshot. preRunSha is the diff point; newHeadSha is the head THIS edit produced.
      setEditPreview({ preRunSha: result.preRunSha, newHeadSha: result.newHeadSha });
      setEditPhase('preview');
    } else if (result.outcome === 'answered') {
      // The in-build classifier resolved the request without a build (no revision was created).
      setEditMessage('Não foi criada nenhuma revisão para este pedido. Reformule a alteração pretendida.');
      setEditPhase('note');
    } else if (result.outcome === 'pending') {
      // The stream dropped and the build did not reach a terminal status within the deadline. NOT a
      // failure and NOT a false "no change" (M1): tell the admin it is still running.
      setEditMessage(EDIT_COPY.stillRunning);
      setEditPhase('note');
    } else if (result.outcome === 'failed') {
      setEditMessage('A revisão não foi concluída. Tente reformular o pedido.');
      setEditPhase('note');
    } else {
      // degraded (401/403/404/network) -> a calm, specific PT-PT message.
      setEditMessage(degradeMessage(result.status));
      setEditPhase('note');
    }
  }, [editDraft]);

  /** APPROVE = keep the new head. The build already activated it, so there is nothing to
   *  call - just clear the preview and confirm. */
  const approveEdit = useCallback(() => {
    setEditMessage(EDIT_COPY.approved);
    setEditPreview(null);
    setEditPhase('note');
  }, []);

  /** ROLLBACK (one click) = forward-restore to the pre-run head. H1-gated server-side, and GUARDED
   *  against a stale target (M2): guardedRollback re-reads the versions and REFUSES if HEAD is no
   *  longer the head THIS edit produced (a concurrent change moved it) rather than blind-restoring
   *  to preRunSha and wiping that unrelated change. A refusal shows a calm "refresh" message. */
  const rollbackEdit = useCallback(async () => {
    const id = appId();
    const token = readPlatformToken();
    const preRunSha = editPreview && editPreview.preRunSha;
    const expectedHeadSha = editPreview && editPreview.newHeadSha;
    if (!id || !token || !preRunSha || !expectedHeadSha) {
      setEditMessage(degradeMessage(token ? 0 : 401));
      setEditPhase('note');
      return;
    }
    setEditBusy(true);
    const result = await guardedRollback({ fetchImpl: (url, opts) => fetch(url, opts), appId: id, token, preRunSha, expectedHeadSha });
    setEditBusy(false);
    if (result.ok) {
      setEditMessage(EDIT_COPY.rolledBack);
      setEditPreview(null);
      setEditPhase('note');
    } else if (result.reason === 'head-advanced' || result.reason === 'target-missing') {
      // HEAD moved (or the target is gone) between preview and click - refuse, never blind-restore.
      setEditMessage(EDIT_COPY.headAdvanced);
      setEditPreview(null);
      setEditPhase('note');
    } else {
      setEditMessage(degradeMessage(result.status));
      setEditPhase('note');
    }
  }, [editPreview]);

  // ---- H4 change request (non-admins only) --------------------------------
  // A viewer who cannot edit this app (admin === false) can file a change request to the app
  // OWNER's org-admin queue. A THIN wire over POST /api/v1/change-requests - a SEPARATE plane
  // from the visitor-blind POST /api/app-assistant. The SERVER authorises (requires a logged-in
  // platform user + resolves the owner org from X-Ekoa-App-Id); this only drives the flow.

  /** Open the compose box (an explicit non-admin click). */
  const openRequest = useCallback(() => {
    setRequestPhase('compose');
    setRequestMessage('');
  }, []);

  /** Cancel back to idle without sending. */
  const cancelRequest = useCallback(() => {
    setRequestPhase('idle');
    setRequestDraft('');
  }, []);

  /** Close a terminal note back to a clean idle state. */
  const resetRequest = useCallback(() => {
    setRequestPhase('idle');
    setRequestDraft('');
    setRequestMessage('');
  }, []);

  /** Submit the request. Reads the served-app id + the platform token best-effort and captures the
   *  current route + screen context so the request arrives contextualised. No readable token / a
   *  401 -> the calm "inicie sessão" note (filing requires a session); any other failure -> a calm
   *  retry note. Never throws. */
  const submitRequest = useCallback(async () => {
    const text = requestDraft.trim();
    if (!text) return;
    setRequestBusy(true);
    const result = await fileChangeRequest({
      fetchImpl: (url, opts) => fetch(url, opts),
      appId: appId(),
      token: readPlatformToken(),
      text,
      route: currentRoute(),
      screenState: captureScreenState(),
    });
    setRequestBusy(false);
    if (result.outcome === 'filed') setRequestMessage(REQUEST_COPY.filed);
    else if (result.outcome === 'needs-login') setRequestMessage(REQUEST_COPY.needsLogin);
    else setRequestMessage(REQUEST_COPY.failed);
    setRequestPhase('note');
  }, [requestDraft]);

  if (collapsed) {
    return (
      <button type="button" className="ekoa-assistant-launcher" onClick={open} aria-label="Abrir o assistente">
        <ChatIcon />
        <span>Assistente</span>
      </button>
    );
  }

  // A tour is on-screen for every phase except idle/cancelled (both mean "no tour").
  const tourActive = !!(tour && tour.status && tour.status !== 'idle' && tour.status !== 'cancelled');

  return (
    <aside className="ekoa-assistant" data-collapsed="false" role="complementary" aria-label="Assistente">
      <header className="ekoa-assistant-header">
        <span className="ekoa-assistant-titlegroup" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2, 0.5rem)' }}>
          <span className="ekoa-assistant-title">Assistente</span>
          {/* H2 detect-then-ask: a DISCREET, non-intrusive indicator that an admin capability
              exists. It does NOTHING - no click handler, no mode change, no privileged call. The
              opt-in edit-mode switch is H3. Styled inline (brand-neutral via the panel CSS vars)
              so it inherits the app's theme without a bespoke stylesheet rule. */}
          {admin ? (
            <span
              className="ekoa-assistant-admin-badge"
              data-admin="true"
              title="Tem permissões de administrador nesta aplicação."
              style={{
                fontSize: 'var(--text-sm, 0.8125rem)',
                fontWeight: 600,
                color: 'var(--color-text-muted, #475569)',
                border: '1px solid var(--color-border, #E2E8F0)',
                borderRadius: 'var(--radius-sm, 0.375rem)',
                padding: '0.05rem 0.4rem',
                lineHeight: 1.4,
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
              }}
            >
              Administrador
            </span>
          ) : null}
        </span>
        <button type="button" className="ekoa-assistant-close" onClick={collapsePanel} aria-label="Fechar o assistente">
          <CloseIcon />
        </button>
      </header>

      <div className="ekoa-assistant-modes" role="group" aria-label="Modo do assistente">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="ekoa-assistant-mode"
            aria-pressed={mode === m.id}
            onClick={() => {
              // Pin the picked mode (click the pinned one again to unpin, back to inference).
              setPinnedMode((prev) => (prev === m.id ? null : m.id));
              setMode(m.id);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* H3 admin bar - the OPT-IN edit-mode switch. Shown ONLY when detection said admin
          (detect-then-ask); OFF by default; flipped only by this explicit click. It is a
          distinct control from the visitor mode toggle above, so an admin always knows they
          are entering a different plane (editing the app, not chatting as a visitor). */}
      {admin ? (
        <div className="ekoa-assistant-adminbar">
          <span className="ekoa-assistant-adminbar-label">Modo de edição</span>
          <button
            type="button"
            role="switch"
            aria-checked={editMode}
            className="ekoa-assistant-editswitch"
            data-on={editMode ? 'true' : 'false'}
            onClick={editMode ? closeEditMode : openEditMode}
          >
            <span className="ekoa-assistant-editswitch-track" aria-hidden="true">
              <span className="ekoa-assistant-editswitch-thumb" />
            </span>
            <span className="ekoa-assistant-editswitch-state">{editMode ? 'Ativado' : 'Desativado'}</span>
          </button>
        </div>
      ) : null}

      {/* H3 admin discovery (proactive teaching): surfaced ONCE, discreetly, dismissibly, to a
          detected admin who has not yet opted in. It suggests the app is changeable and offers
          an explicit CTA - it NEVER auto-enables edit mode (detect-then-ask). */}
      {admin && !editMode && !discoveryDismissed ? (
        <div className="ekoa-assistant-discovery" role="note">
          <p className="ekoa-assistant-discovery-text">
            Pode pedir alterações a esta aplicação - por exemplo, adicionar um campo ou um botão.
            Ative o modo de edição para preparar uma revisão.
          </p>
          <div className="ekoa-assistant-discovery-actions">
            <button type="button" className="ekoa-assistant-discovery-cta" onClick={openEditMode}>
              Ativar modo de edição
            </button>
            <button type="button" className="ekoa-assistant-discovery-dismiss" onClick={dismissDiscovery}>
              Agora não
            </button>
          </div>
        </div>
      ) : null}

      {/* H3 edit affordance - a dedicated, visually distinct section (only when editMode is on).
          The whole patch flow lives here: compose -> confirm -> running -> preview -> note. */}
      {admin && editMode ? (
        <section className="ekoa-assistant-edit" data-edit-phase={editPhase} aria-label="Modo de edição (administrador)">
          <div className="ekoa-assistant-edit-head">
            <span className="ekoa-assistant-edit-title">Modo de edição</span>
            <span className="ekoa-assistant-edit-hint">Alterações à aplicação (administrador)</span>
          </div>

          {editPhase === 'compose' ? (
            <div className="ekoa-assistant-edit-compose">
              <textarea
                className="ekoa-assistant-edit-textarea"
                placeholder="Descreva a alteração. Por exemplo: adicione um botão de exportação na tabela de honorários."
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={2}
                aria-label="Pedido de alteração"
              />
              <button
                type="button"
                className="ekoa-assistant-edit-primary"
                onClick={askEditConfirm}
                disabled={!editDraft.trim()}
              >
                Preparar alteração
              </button>
            </div>
          ) : null}

          {editPhase === 'confirm' ? (
            <div className="ekoa-assistant-edit-confirm">
              <p className="ekoa-assistant-edit-confirm-text">{EDIT_COPY.confirm}</p>
              <div className="ekoa-assistant-edit-actions">
                <button type="button" className="ekoa-assistant-edit-primary" onClick={confirmEdit}>
                  Confirmar
                </button>
                <button type="button" className="ekoa-assistant-edit-secondary" onClick={cancelEditConfirm}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}

          {editPhase === 'running' ? (
            <div className="ekoa-assistant-edit-running" role="status">
              <span className="ekoa-assistant-edit-spinner" aria-hidden="true" />
              <span className="ekoa-assistant-edit-progress">{editProgress || EDIT_COPY.preparing}</span>
            </div>
          ) : null}

          {editPhase === 'preview' && editPreview ? (
            <div className="ekoa-assistant-edit-preview">
              {editPreview.newHeadSha && editPreview.newHeadSha !== editPreview.preRunSha ? (
                <>
                  <p className="ekoa-assistant-edit-preview-text">{EDIT_COPY.applied}</p>
                  <dl className="ekoa-assistant-edit-diff">
                    <div>
                      <dt>Versão anterior</dt>
                      <dd>{shortSha(editPreview.preRunSha)}</dd>
                    </div>
                    <div>
                      <dt>Nova versão</dt>
                      <dd>{shortSha(editPreview.newHeadSha)}</dd>
                    </div>
                  </dl>
                  <div className="ekoa-assistant-edit-actions">
                    <button type="button" className="ekoa-assistant-edit-primary" onClick={approveEdit}>
                      Aprovar
                    </button>
                    {/* Reverter only when there is a pre-run head to restore to (a follow-up build on
                        an existing app always has one; guarded defensively). The click re-checks HEAD
                        (M2) before restoring, so a concurrent change refuses rather than gets wiped. */}
                    {editPreview.preRunSha ? (
                      <button
                        type="button"
                        className="ekoa-assistant-edit-secondary"
                        onClick={rollbackEdit}
                        disabled={editBusy}
                      >
                        Reverter
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <p className="ekoa-assistant-edit-preview-text">{EDIT_COPY.noChange}</p>
                  <div className="ekoa-assistant-edit-actions">
                    <button type="button" className="ekoa-assistant-edit-secondary" onClick={resetEdit}>
                      Nova alteração
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {editPhase === 'note' ? (
            <div className="ekoa-assistant-edit-note" role="status">
              <p className="ekoa-assistant-edit-note-text">{editMessage}</p>
              <div className="ekoa-assistant-edit-actions">
                <button type="button" className="ekoa-assistant-edit-secondary" onClick={resetEdit}>
                  Nova alteração
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* H4 change request (non-admins): a discreet "Pedir alteração" affordance for a viewer who
          cannot edit this app. It NEVER auto-sends - an explicit click opens the composer; submit
          files to the owner's org-admin queue (requires a logged-in platform user; a 401 / no token
          shows the calm "inicie sessão" note). Distinct from the admin edit switch (admin only). */}
      {!admin ? (
        <section className="ekoa-assistant-request" data-request-phase={requestPhase} aria-label="Pedir alteração">
          {requestPhase === 'idle' ? (
            <button type="button" className="ekoa-assistant-request-open" onClick={openRequest}>
              {REQUEST_COPY.open}
            </button>
          ) : null}

          {requestPhase === 'compose' ? (
            <div className="ekoa-assistant-request-compose">
              <p className="ekoa-assistant-request-intro">{REQUEST_COPY.intro}</p>
              <textarea
                className="ekoa-assistant-request-textarea"
                placeholder={REQUEST_COPY.placeholder}
                value={requestDraft}
                onChange={(e) => setRequestDraft(e.target.value)}
                rows={2}
                aria-label="Pedido de alteração"
              />
              <div className="ekoa-assistant-request-actions">
                <button
                  type="button"
                  className="ekoa-assistant-request-primary"
                  onClick={submitRequest}
                  disabled={!requestDraft.trim() || requestBusy}
                >
                  {REQUEST_COPY.submit}
                </button>
                <button type="button" className="ekoa-assistant-request-secondary" onClick={cancelRequest}>
                  {REQUEST_COPY.cancel}
                </button>
              </div>
            </div>
          ) : null}

          {requestPhase === 'note' ? (
            <div className="ekoa-assistant-request-note" role="status">
              <p className="ekoa-assistant-request-note-text">{requestMessage}</p>
              <button type="button" className="ekoa-assistant-request-secondary" onClick={resetRequest}>
                {REQUEST_COPY.close}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="ekoa-assistant-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="ekoa-assistant-intro">
            <p className="ekoa-assistant-intro-lead">
              Olá. Posso ajudar de três formas: mostrar uma visão geral da aplicação, ensinar como
              a usar passo a passo, ou operá-la por si. Experimente:
            </p>
            <div className="ekoa-assistant-examples">
              {EXAMPLES.map((ex) => (
                <button key={ex.prompt} type="button" className="ekoa-assistant-example" onClick={() => onExample(ex)}>
                  <span className="ekoa-assistant-example-kind">{ex.kind}</span>
                  {ex.prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="ekoa-assistant-turn" data-role={m.role}>
              {m.content ? <div className="ekoa-assistant-bubble">{m.content}</div> : null}

              {m.citations && m.citations.length ? (
                <div className="ekoa-assistant-citations">
                  <div className="ekoa-assistant-citations-title">Fontes</div>
                  <ul>
                    {m.citations.map((c, i) => (
                      <li key={`${c.collection}/${c.docId}/${i}`}>
                        <span className="ekoa-assistant-citation-collection">{c.collection}</span>
                        {' - '}
                        <span className="ekoa-assistant-citation-title">{c.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {m.runs && m.runs.length ? (
                <div className="ekoa-assistant-runs">
                  {m.runs.map((r) => (
                    <div key={r.id} className="ekoa-assistant-run" data-status={r.status}>
                      <span className="ekoa-assistant-run-dot" aria-hidden="true" />
                      <span>{runLabel(r.status)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {tourActive ? (
        <TourView tour={tour} onNext={tourNext} onClose={tourClose} />
      ) : mode === 'teach' && tourAvailable === true ? (
        <div className="ekoa-assistant-tour-launch">
          <button
            type="button"
            className="ekoa-assistant-tour-start"
            onClick={() => startTourPlayback()}
          >
            Iniciar tutorial guiado
          </button>
        </div>
      ) : null}

      <div className="ekoa-assistant-composer">
        <textarea
          ref={textareaRef}
          className="ekoa-assistant-textarea"
          placeholder="Escreva a sua mensagem..."
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          aria-label="Mensagem para o assistente"
        />
        <button
          type="button"
          className="ekoa-assistant-send"
          onClick={() => send()}
          disabled={busy || !draft.trim()}
          aria-label="Enviar mensagem"
        >
          <SendIcon />
        </button>
      </div>
    </aside>
  );
}

export default AssistantPanel;
