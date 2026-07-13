import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * operator-run D2 — the operator assistant PANEL that mounts into every app-base app
 * (lazy-loaded as a platform runtime asset since operator-run G2).
 *
 * The panel is a React/JSX browser asset compiled platform-side into the panel-runtime
 * (api/assets/panel-runtime, served at /__ekoa/panel-runtime.js) - not in the vitest
 * module stack - so this suite asserts its SOURCE contract: the three-capability PT-PT
 * first-open copy, the three mode labels, the /api/app-assistant fetch with the
 * X-Ekoa-App-Id header, the window.__ekoaActions.execute dispatch for the assistant's
 * proposed actions, the "Fontes" citations rendering, no emoji, and the lazy-load
 * wiring: the app bundle's plain-DOM launcher (mount.js) loads the asset, whose entry
 * (index.jsx) self-mounts into #ekoa-assistant-root, node-guarded and once-only. The
 * full behavioural loop lands in D3's live gate; the lazy-load perf invariants live in
 * tests/e2e/panel-perf.e2e.mjs + tests/apps/panel-lazy.test.ts.
 */

const SCAFFOLD = new URL('../../assets/bases/app/scaffold/frontend/src/', import.meta.url);
const PANEL_SRC = new URL('../../assets/panel-runtime/src/', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, SCAFFOLD)), 'utf-8');
const readPanel = (rel: string) => readFileSync(fileURLToPath(new URL(rel, PANEL_SRC)), 'utf-8');

const PANEL_PATH = fileURLToPath(new URL('AssistantPanel.jsx', PANEL_SRC));
const PANEL = readFileSync(PANEL_PATH, 'utf-8');
const CSS = readPanel('AssistantPanel.css');
const ENTRY = readPanel('index.jsx'); // the panel-runtime self-mounting entry
const MOUNT = read('lib/assistant/mount.js'); // the app-bundle plain-DOM launcher
const INDEX = read('index.jsx');
const SKILL = readFileSync(
  fileURLToPath(new URL('../../assets/bases/app/skills/using-the-assistant-panel.md', import.meta.url)),
  'utf-8',
);

describe('D2 assistant panel — files exist', () => {
  it('the panel + css + entry ship in the platform panel-runtime; the launcher ships in the app scaffold', () => {
    expect(existsSync(PANEL_PATH)).toBe(true);
    expect(PANEL.length).toBeGreaterThan(0);
    expect(CSS.length).toBeGreaterThan(0);
    expect(ENTRY.length).toBeGreaterThan(0);
    expect(MOUNT.length).toBeGreaterThan(0);
  });
});

describe('D2 panel source contract', () => {
  it('states the three capabilities with PT-PT example prompts on first open', () => {
    expect(PANEL).toContain('Dê-me uma visão geral da aplicação'); // Mostrar / show
    expect(PANEL).toContain('Mostre-me um tutorial'); // Ensinar / teach
    expect(PANEL).toContain('Adicione um novo registo'); // Operar / do (operate)
  });

  it('offers the three mode labels (Operar / Mostrar / Ensinar) mapped to do/show/teach', () => {
    expect(PANEL).toContain('Operar');
    expect(PANEL).toContain('Mostrar');
    expect(PANEL).toContain('Ensinar');
    expect(PANEL).toMatch(/id:\s*'do'/);
    expect(PANEL).toMatch(/id:\s*'show'/);
    expect(PANEL).toMatch(/id:\s*'teach'/);
  });

  it('POSTs to /api/app-assistant with the X-Ekoa-App-Id header read from window.__EKOA_APP_ID', () => {
    expect(PANEL).toContain('/api/app-assistant');
    expect(PANEL).toContain('X-Ekoa-App-Id');
    expect(PANEL).toContain('window.__EKOA_APP_ID');
    expect(PANEL).toMatch(/method:\s*'POST'/);
    // the request carries message + history + mode + context (route + recent action results)
    expect(PANEL).toContain('history');
    // bounded turn cost + a hung turn can never lock the composer (codex-d2 #2/#3)
    expect(PANEL).toMatch(/MAX_HISTORY_TURNS/);
    expect(PANEL).toMatch(/AbortController/);
    expect(PANEL).toMatch(/FETCH_TIMEOUT_MS/);
    expect(PANEL).toContain('context');
    expect(PANEL).toContain('actionResults');
  });

  it('dispatches each proposed action through window.__ekoaActions.execute (never on its own)', () => {
    expect(PANEL).toContain('window.__ekoaActions');
    expect(PANEL).toMatch(/\.execute\(/);
    expect(PANEL).toContain('data.actions'); // only ever the actions the assistant returned
    expect(PANEL).toContain('A executar...'); // the subtle in-flight state
    // the D1 enrichment drives the SERVER-resolved manifest action with the model's
    // input as VALUES - the exact transform, not a client-side reconstruction
    expect(PANEL).toContain('{ ...a.action, params: values }');
  });

  it('renders a "Fontes" citation list from response.citations', () => {
    expect(PANEL).toContain('Fontes');
    expect(PANEL).toContain('citations');
    expect(PANEL).toContain('collection');
    expect(PANEL).toContain('title');
  });

  it('renders a calm PT-PT message on an endpoint error / missing runtime (never a crash)', () => {
    expect(PANEL).toContain('O assistente está indisponível de momento.');
    // execute() is guarded when the runtime is absent (standalone preview)
    expect(PANEL).toMatch(/typeof runtime\.execute !== 'function'/);
  });

  it('does not autofocus on mount (never steals focus from the app)', () => {
    // No JSX autoFocus attribute anywhere; imperative .focus() exists but only behind
    // explicit user intent (open / example click), never at render.
    expect(PANEL).not.toMatch(/autoFocus/);
    expect(PANEL).toContain('user intent');
  });

  it('contains NO emoji (UI-code rule) — panel and css', () => {
    const inPanel = PANEL.match(/\p{Extended_Pictographic}/u);
    expect(inPanel, inPanel ? `panel emoji: ${JSON.stringify(inPanel[0])}` : '').toBeNull();
    const inCss = CSS.match(/\p{Extended_Pictographic}/u);
    expect(inCss, inCss ? `css emoji: ${JSON.stringify(inCss[0])}` : '').toBeNull();
  });
});

describe('D2/G2 lazy-load wiring', () => {
  it('the app bundle carries only a plain-DOM launcher (no React) that lazy-loads the platform panel-runtime', () => {
    // Since G2 the panel is NOT baked into the app bundle: mount.js renders a launcher
    // with plain DOM and injects the platform asset on interaction/idle. No React here.
    expect(MOUNT).not.toMatch(/from\s+['"]react/);
    expect(MOUNT).not.toContain('createRoot');
    expect(MOUNT).toContain('ekoa-assistant-launcher'); // the launcher it renders
    expect(MOUNT).toContain('/__ekoa/panel-runtime.js'); // the asset it lazy-loads
    expect(MOUNT).toContain('__ekoaAssistantAutoOpen'); // open-intent handoff to the asset
  });

  it('the panel-runtime entry self-mounts into #ekoa-assistant-root, once, waiting for the node', () => {
    // The three mount guards moved from the old in-bundle mount.js to the ASSET entry:
    // #ekoa-assistant-root is rendered BY App and createRoot().render() commits async,
    // so the node is absent the instant the asset runs. The entry polls (bounded) then
    // gives up quietly (standalone preview), and mounts exactly once per document.
    expect(ENTRY).toContain('ekoa-assistant-root');
    expect(ENTRY).toContain('getElementById');
    expect(ENTRY).toContain('__ekoaAssistantMounted'); // once-guard flag
    expect(ENTRY).toMatch(/createRoot\(node\)\.render/);
    expect(ENTRY).toContain('requestAnimationFrame');
    expect(ENTRY).toContain('MAX_FRAMES');
    expect(ENTRY).toMatch(/frames\s*>=\s*MAX_FRAMES/); // bounded give-up (no infinite spin)
  });

  it('index.jsx mounts the panel after rendering App (without changing the App render)', () => {
    expect(INDEX).toContain('mountAssistant');
    expect(INDEX).toContain("from './lib/assistant/mount'");
    expect(INDEX).toContain('root.render(<App />)'); // the App render is untouched
    // the mount call comes after the App render
    expect(INDEX.indexOf('mountAssistant()')).toBeGreaterThan(INDEX.indexOf('root.render(<App />)'));
  });
});

describe('D2 base skill', () => {
  it('teaches that the panel is platform-shipped, not to be rebuilt, and to declare ui_actions', () => {
    expect(SKILL).toContain('platform');
    expect(SKILL).toContain('ui_actions');
    expect(SKILL).toContain('declaring-ui-actions.md'); // cross-reference
    expect(SKILL.match(/\p{Extended_Pictographic}/u)).toBeNull();
  });
});
