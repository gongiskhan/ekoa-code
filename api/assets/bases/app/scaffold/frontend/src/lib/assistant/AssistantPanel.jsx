/*
 * Operator Assistant Panel - platform-shipped for the `app` base (operator-run D2).
 *
 * The in-app assistant every generated app carries. It mounts INTO the shell's
 * <div id="ekoa-assistant-root"> (see mount.js) and speaks ONLY two things:
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
import './AssistantPanel.css';

const ENDPOINT = '/api/app-assistant';
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

export function AssistantPanel() {
  const [collapsed, setCollapsed] = useState(true);
  // `mode` is the mode CURRENTLY shown on the toggle - the server's inference (echoed
  // on each response) unless the visitor pins one. `pinnedMode` is non-null only when
  // the visitor explicitly picked a mode: only then do we send it, so by default the
  // server infers the mode from the phrasing (do/show/teach) and we reflect it back.
  const [mode, setMode] = useState('do');
  const [pinnedMode, setPinnedMode] = useState(null);
  const [messages, setMessages] = useState([]); // { id, role, content, citations?, runs? }
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const idRef = useRef(0);
  const messagesRef = useRef(messages);
  const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
  const listRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesRef.current = messages;
    // keep the newest turn in view
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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

        if (!runtime || typeof runtime.execute !== 'function') {
          setStatus('unavailable');
          recordResult({ toolName: a && a.toolName, status: 'unavailable' });
          continue;
        }
        try {
          const result = await runtime.execute(toRuntimeAction(a));
          const status = (result && result.status) || 'done';
          setStatus(status, result && result.detail);
          recordResult({ toolName: a && a.toolName, status, detail: result && result.detail });
        } catch (err) {
          setStatus('failed', err && err.reason);
          recordResult({ toolName: a && a.toolName, status: 'failed', detail: err && err.reason });
        }
      }
    },
    [patchTurn, recordResult],
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

  if (collapsed) {
    return (
      <button type="button" className="ekoa-assistant-launcher" onClick={open} aria-label="Abrir o assistente">
        <ChatIcon />
        <span>Assistente</span>
      </button>
    );
  }

  return (
    <aside className="ekoa-assistant" data-collapsed="false" role="complementary" aria-label="Assistente">
      <header className="ekoa-assistant-header">
        <span className="ekoa-assistant-title">Assistente</span>
        <button type="button" className="ekoa-assistant-close" onClick={() => setCollapsed(true)} aria-label="Fechar o assistente">
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
