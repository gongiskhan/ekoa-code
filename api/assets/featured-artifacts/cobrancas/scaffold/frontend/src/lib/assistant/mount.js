/*
 * Assistente da app - LAUNCHER + carregador diferido (padrão das apps Ekoa
 * mais recentes). O painel do assistente NÃO vem no bundle da app: este
 * ficheiro é o único código de assistente que a app transporta - um botão
 * plain-DOM (sem React) e um lazy-loader do asset da plataforma
 * /__ekoa/panel-runtime.js, que se auto-monta no #ekoa-assistant-root do
 * shell. Em plataformas sem o asset (404), o onerror repõe o guard e o botão
 * continua inofensivo - degradação silenciosa, nunca um erro no ecrã.
 *
 * index.jsx chama mountAssistant() uma vez depois de renderizar a app; nada
 * na app renderiza para dentro de #ekoa-assistant-root.
 */

const LAUNCHER_MARKER = 'data-ekoa-boot-launcher';
const PANEL_RUNTIME_SRC = '/__ekoa/panel-runtime.js';
// Um clique ANTES de o painel montar é entregue pela flag (lida na montagem);
// um clique DEPOIS é entregue pelo evento (o painel montado escuta ambos).
const OPEN_EVENT = 'ekoa:assistant-open';
// O preload em idle espera este mínimo para o clique de um visitante rápido
// disparar o carregamento por intenção explícita, não por fetch antecipado.
const IDLE_PRELOAD_MS = 2000;

// Glifo de conversa igual ao do painel - SVG inline, nunca emoji.
const CHAT_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto">' +
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>';

// Estilo inline com o contrato de CSS vars da marca (com fallbacks) - o CSS do
// painel ainda não está carregado, o launcher carrega o seu próprio aspeto.
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

/** Injeta o asset do painel exatamente uma vez; o asset auto-monta e remove o
 *  launcher. Se a plataforma NÃO serve o asset (404 - caso do cortex sem o
 *  plano de assistente), o onerror monta o painel EMBUTIDO da app no mesmo nó
 *  #ekoa-assistant-root - o assistente abre em qualquer plataforma. */
function ensurePanelLoaded() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('script');
  s.src = PANEL_RUNTIME_SRC;
  s.async = true;
  s.onerror = () => {
    if (s.parentNode) s.parentNode.removeChild(s);
    import('./FallbackPanel.jsx')
      .then((m) => m.mountFallbackPanel())
      .catch(() => {
        injected = false;
        window.__ekoaAssistantAutoOpen = false;
      });
  };
  (document.head || document.documentElement).appendChild(s);
}

/** Pré-carrega o asset quando a página fica em idle (montagem colapsada). */
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
  if (document.querySelector('[' + LAUNCHER_MARKER + ']')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ekoa-assistant-launcher';
  btn.setAttribute(LAUNCHER_MARKER, '');
  btn.setAttribute('aria-label', 'Abrir o assistente');
  btn.style.cssText = LAUNCHER_STYLE;
  btn.innerHTML = CHAT_ICON + '<span>Assistente</span>';
  btn.addEventListener('click', () => {
    window.__ekoaAssistantAutoOpen = true;
    ensurePanelLoaded();
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  });

  (document.body || document.documentElement).appendChild(btn);
  scheduleIdlePreload();
}

export default mountAssistant;
