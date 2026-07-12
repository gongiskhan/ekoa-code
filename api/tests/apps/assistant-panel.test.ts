import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * operator-run D2 — the operator assistant PANEL that mounts into every app-base app.
 *
 * The panel + its mount are React/JSX browser assets bundled per-app from esm.sh at
 * real build time (like the C3 action runtime, they are not in the vitest module
 * stack), so this suite asserts their SOURCE contract: the three-capability PT-PT
 * first-open copy, the three mode labels, the /api/app-assistant fetch with the
 * X-Ekoa-App-Id header, the window.__ekoaActions.execute dispatch for the
 * assistant's proposed actions, the "Fontes" citations rendering, no emoji, and the
 * index.jsx + mount.js wiring (mount is node-guarded and mounts once). The full
 * behavioural loop (three modes + pause + cited answer) lands in D3's live gate.
 */

const SCAFFOLD = new URL('../../assets/bases/app/scaffold/frontend/src/', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, SCAFFOLD)), 'utf-8');

const PANEL_PATH = fileURLToPath(new URL('lib/assistant/AssistantPanel.jsx', SCAFFOLD));
const PANEL = readFileSync(PANEL_PATH, 'utf-8');
const CSS = read('lib/assistant/AssistantPanel.css');
const MOUNT = read('lib/assistant/mount.js');
const INDEX = read('index.jsx');
const SKILL = readFileSync(
  fileURLToPath(new URL('../../assets/bases/app/skills/using-the-assistant-panel.md', import.meta.url)),
  'utf-8',
);

describe('D2 assistant panel — files exist', () => {
  it('the panel, its css, and its mount all ship in the app base scaffold', () => {
    expect(existsSync(PANEL_PATH)).toBe(true);
    expect(PANEL.length).toBeGreaterThan(0);
    expect(CSS.length).toBeGreaterThan(0);
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
    expect(PANEL).toContain('context');
    expect(PANEL).toContain('actionResults');
  });

  it('dispatches each proposed action through window.__ekoaActions.execute (never on its own)', () => {
    expect(PANEL).toContain('window.__ekoaActions');
    expect(PANEL).toMatch(/\.execute\(/);
    expect(PANEL).toContain('data.actions'); // only ever the actions the assistant returned
    expect(PANEL).toContain('A executar...'); // the subtle in-flight state
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
    // focus happens only on an explicit user open / example click, never at render.
    expect(PANEL).toContain('user intent');
  });

  it('contains NO emoji (UI-code rule) — panel and css', () => {
    const inPanel = PANEL.match(/\p{Extended_Pictographic}/u);
    expect(inPanel, inPanel ? `panel emoji: ${JSON.stringify(inPanel[0])}` : '').toBeNull();
    const inCss = CSS.match(/\p{Extended_Pictographic}/u);
    expect(inCss, inCss ? `css emoji: ${JSON.stringify(inCss[0])}` : '').toBeNull();
  });
});

describe('D2 mount wiring', () => {
  it('mount.js guards on the node existing and mounts exactly once', () => {
    expect(MOUNT).toContain('ekoa-assistant-root');
    expect(MOUNT).toContain('getElementById');
    expect(MOUNT).toContain('if (node)'); // only mounts when the node is present
    expect(MOUNT).toContain('__ekoaAssistantMounted'); // once-guard flag
    expect(MOUNT).toMatch(/createRoot\(node\)\.render/);
  });

  it('mount.js waits for React to commit the node (async initial render) with a bounded retry', () => {
    // #ekoa-assistant-root is rendered BY App, and React 18 createRoot().render() is
    // async — the node is absent the instant index.jsx calls mountAssistant(). The
    // mounter must poll (bounded) rather than no-op immediately, else the panel never
    // mounts; past the cap it gives up quietly (standalone preview).
    expect(MOUNT).toContain('requestAnimationFrame');
    expect(MOUNT).toContain('MAX_FRAMES');
    expect(MOUNT).toMatch(/frames\s*>=\s*MAX_FRAMES/); // bounded give-up (no infinite spin)
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
