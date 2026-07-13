/*
 * Operator assistant LAUNCHER + lazy loader - platform-shipped for the `app` base
 * (operator-run D2; lazy-load rework operator-run G2).
 *
 * Since G2 the assistant panel is NOT baked into the app bundle. This is the only
 * assistant code the app bundle carries: a tiny plain-DOM launcher (NO React) plus a
 * lazy loader. It does two things and nothing else:
 *
 *   1. Render the launcher immediately - a fixed bottom-right "Assistente" button,
 *      visually identical to the panel's own launcher (same CSS-var contract, so it
 *      inherits the org brand from /api/design-tokens.css), with zero parse cost from
 *      the panel/React on the app's first paint. No blocking work on the main thread.
 *   2. Lazy-load the platform panel-runtime asset (/__ekoa/panel-runtime.js) on the
 *      FIRST launcher interaction OR an idle preload, whichever comes first. The
 *      loaded asset bundles its own React, self-mounts <AssistantPanel/> into the
 *      shell's #ekoa-assistant-root, and takes over the launcher (see the asset's
 *      index.jsx - it keeps the three mount guards: bounded wait-for-node, once-only,
 *      quiet give-up). The C3 action runtime stays EAGERLY injected (injected-context),
 *      so declared actions still work even if the panel is never opened.
 *
 * The handoff: a CLICK sets window.__ekoaAssistantAutoOpen so the panel opens on
 * mount (explicit visitor intent); an idle preload does not, so the panel mounts
 * collapsed (warmed, but never steals the screen). Loading/mounting the panel issues
 * ZERO calls to /api/app-assistant - opening the assistant never costs a token.
 *
 * index.jsx calls mountAssistant() once after the app renders. The coding agent never
 * calls this itself and never renders into #ekoa-assistant-root.
 */

const LAUNCHER_MARKER = 'data-ekoa-boot-launcher';
const PANEL_RUNTIME_SRC = '/__ekoa/panel-runtime.js';
// Open-intent event: the flag below covers a click BEFORE the panel mounts (read at
// mount), this event covers a click AFTER it mounts (the mounted panel listens). Both
// fire on every click, so visitor intent survives ANY race with the idle preload -
// without the event, a click landing between the idle inject and the boot-launcher
// removal would be silently lost (ensurePanelLoaded no-ops, the flag is never re-read).
const OPEN_EVENT = 'ekoa:assistant-open';
// Floor the idle preload so a promptly-interacting visitor (and the perf gate) always
// trigger the load via their CLICK, not an eager idle fetch; after the floor we defer
// to real idle (requestIdleCallback), or a plain timeout where it is absent.
const IDLE_PRELOAD_MS = 2000;

// The launcher's chat glyph - the SAME inline SVG as the panel's ChatIcon. No emoji.
const CHAT_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto">' +
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>';

// Inline launcher styles mirroring .ekoa-assistant-launcher (AssistantPanel.css) via
// the same CSS-var contract with fallbacks - the panel CSS is not loaded yet, so the
// launcher must carry its own look until the asset takes over.
const LAUNCHER_STYLE =
  'position:fixed;right:var(--space-4,1rem);bottom:var(--space-4,1rem);z-index:2147482000;' +
  'display:inline-flex;align-items:center;gap:var(--space-2,0.5rem);' +
  'padding:var(--space-3,0.75rem) var(--space-4,1rem);' +
  'border:1px solid var(--color-primary,#0F766E);border-radius:var(--radius-lg,0.75rem);' +
  'background:var(--color-primary,#0F766E);color:var(--color-bg,#FFFFFF);' +
  "font-family:var(--font-sans,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);" +
  'font-size:var(--text-sm,0.875rem);font-weight:600;line-height:1;cursor:pointer;' +
  'box-shadow:var(--shadow-md,0 8px 24px rgba(15,23,42,0.18));';

let injected = false;

/** Inject the platform panel-runtime asset exactly once. The asset self-mounts and
 *  removes the launcher; a second call (idle after click, or vice versa) is a no-op. */
function ensurePanelLoaded() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('script');
  s.src = PANEL_RUNTIME_SRC;
  s.async = true;
  (document.head || document.documentElement).appendChild(s);
}

/** Preload the asset when the page goes idle (after a floor delay), so a returning
 *  visitor's first click opens an already-warm panel. No auto-open: mount collapsed. */
function scheduleIdlePreload() {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => ensurePanelLoaded(), { timeout: 2000 });
    } else {
      ensurePanelLoaded();
    }
  }, IDLE_PRELOAD_MS);
}

export function mountAssistant() {
  if (typeof document === 'undefined') return;
  // Once-only: never render two launchers (a repeat call / hot reload).
  if (document.querySelector('[' + LAUNCHER_MARKER + ']')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ekoa-assistant-launcher';
  btn.setAttribute(LAUNCHER_MARKER, '');
  btn.setAttribute('aria-label', 'Abrir o assistente');
  btn.style.cssText = LAUNCHER_STYLE;
  btn.innerHTML = CHAT_ICON + '<span>Assistente</span>';
  btn.addEventListener('click', () => {
    // Explicit visitor intent: open the panel on mount (handoff via the window flag)
    // AND right now if it already mounted collapsed (handoff via the event).
    window.__ekoaAssistantAutoOpen = true;
    ensurePanelLoaded();
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  });

  (document.body || document.documentElement).appendChild(btn);
  scheduleIdlePreload();
}

export default mountAssistant;
