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

describe('H2 admin detection (detect-then-ask)', () => {
  it('reads the platform token DEFENSIVELY from localStorage (try/catch, swallow to null)', () => {
    // The panel reads the SAME key web/lib/api/token.ts uses; a cross-origin / sandboxed iframe
    // throws a SecurityError on localStorage access, so the read is wrapped and degrades to null.
    expect(PANEL).toContain('ekoa_token');
    expect(PANEL).toContain('readPlatformToken');
    expect(PANEL).toContain('getItem(TOKEN_STORAGE_KEY)');
    // The defensive read has a try/catch that returns null (no crash on a cross-origin iframe).
    const helper = PANEL.slice(PANEL.indexOf('function readPlatformToken'), PANEL.indexOf('function readPlatformToken') + 500);
    expect(helper).toMatch(/try\s*\{/);
    expect(helper).toMatch(/catch\s*\{[\s\S]*return null/);
  });

  it('calls GET /api/app-assistant/whoami exactly ONCE, on mount, with X-Ekoa-App-Id + an OPTIONAL Bearer', () => {
    // The endpoint literal lives once (in the WHOAMI_ENDPOINT constant); the fetch uses the const.
    expect(PANEL).toContain('/api/app-assistant/whoami');
    expect((PANEL.match(/\/api\/app-assistant\/whoami/g) || []).length).toBe(1);
    expect(PANEL).toContain('WHOAMI_ENDPOINT');
    // A mount-only, once-guarded detection (no per-render loop; idempotent under StrictMode).
    expect(PANEL).toContain('whoamiDoneRef');
    expect(PANEL).toContain('whoamiDoneRef.current = true');
    // It is a GET carrying the app id; the platform Bearer is attached only when readable.
    const effect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
    expect(effect).toContain('WHOAMI_ENDPOINT');
    expect(effect).toMatch(/method:\s*'GET'/);
    expect(effect).toContain("'X-Ekoa-App-Id': id");
    expect(effect).toMatch(/token \? \{ Authorization: `Bearer \$\{token\}` \}/);
    // The mount effect closes with an empty dependency array (runs once for the panel's lifetime).
    expect(effect).toMatch(/\},\s*\[\]\);/);
  });

  it('a false detection renders NO admin affordance (the indicator is gated on admin)', () => {
    // admin defaults false (fail-closed) and the discreet indicator is conditionally rendered:
    // false -> null (nothing on screen), true -> the quiet "Administrador" badge.
    expect(PANEL).toMatch(/const \[admin, setAdmin\] = useState\(false\)/);
    expect(PANEL).toContain('Administrador');
    expect(PANEL).toMatch(/\{admin \? \(/);
    // The whole badge block is guarded by `admin ? (...) : null`, so nothing renders when false.
    const header = PANEL.slice(PANEL.indexOf('ekoa-assistant-titlegroup'), PANEL.indexOf('ekoa-assistant-close'));
    expect(header).toMatch(/admin \? \([\s\S]*\) : null/);
  });

  it('DETECT-THEN-ASK: admin:true never auto-enables anything (no edit mode, no privileged call)', () => {
    // The indicator is inert: no click handler, no mode change, no fetch driven by `admin`.
    const badge = PANEL.slice(PANEL.indexOf('ekoa-assistant-admin-badge'), PANEL.indexOf('Administrador') + 20);
    expect(badge).not.toContain('onClick');
    // `admin` is SET once (the detection) and READ only to render the badge — it drives no action.
    expect((PANEL.match(/setAdmin\(/g) || []).length).toBe(1);
    // H3 now introduces the edit-mode switch (setEditMode), but detect-then-ask still binds: the
    // DETECTION effect never enables edit mode — it only sets `admin`. (The full H3 opt-in invariants
    // are pinned in the "H3 edit mode" block below.)
    const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
    expect(whoamiEffect).toContain('setAdmin');
    expect(whoamiEffect).not.toContain('setEditMode');
    // The invariant is stated in the source so review can pin it.
    expect(PANEL).toContain('detect-then-ask');
    expect(PANEL).toContain('H3');
  });

  it('detection is zero-token: whoami is a non-LLM GET, never an assistant turn', () => {
    // The detection path must not post to the assistant endpoint or dispatch actions.
    const effect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
    expect(effect).not.toContain('runActions');
    expect(effect).not.toMatch(/method:\s*'POST'/);
    // The zero-token invariant is stated on the detection effect so review can pin it.
    expect(PANEL).toContain('zero-token');
  });
});

describe('H3 edit mode (admins only) — opt-in switch + detect-then-ask wiring', () => {
  it('the edit-mode switch is ABSENT unless admin, and starts OFF (opt-in, fail-closed)', () => {
    // editMode starts false: entering edit mode is never the default — it is an explicit opt-in.
    expect(PANEL).toMatch(/const \[editMode, setEditMode\] = useState\(false\)/);
    // The admin bar (which holds the switch) is rendered only when detection said admin.
    expect(PANEL).toContain('ekoa-assistant-adminbar');
    expect(PANEL).toMatch(/\{admin \? \(/); // admin-gated block
    // The switch is a real accessible toggle reflecting editMode.
    expect(PANEL).toContain('ekoa-assistant-editswitch');
    expect(PANEL).toMatch(/role="switch"/);
    expect(PANEL).toMatch(/aria-checked=\{editMode\}/);
  });

  it('enabling the switch reveals the edit affordance (gated on admin && editMode)', () => {
    // The edit section renders only for an admin who has opted in — not from detection alone.
    expect(PANEL).toMatch(/admin && editMode \? \(/);
    expect(PANEL).toContain('ekoa-assistant-edit'); // the distinct edit section
    expect(PANEL).toContain('data-edit-phase'); // its phase machine (compose→confirm→running→preview→note)
    // Kept visually distinct from the visitor OPERAR/MOSTRAR/ENSINAR modes so an admin always knows.
    expect(PANEL).toContain('Modo de edição');
  });

  it('DETECT-THEN-ASK is binding: edit mode is entered ONLY by an explicit click, never by detection', () => {
    // setEditMode(true) is reachable through exactly one path: openEditMode (the explicit opt-in).
    expect(PANEL).toContain('const openEditMode');
    expect(PANEL).toMatch(/openEditMode[\s\S]{0,120}setEditMode\(true\)/);
    // The only setEditMode(true) in the file is inside that explicit handler — detection cannot flip it.
    expect((PANEL.match(/setEditMode\(true\)/g) || []).length).toBe(1);
    // openEditMode is wired to click handlers (the switch + the discovery CTA), never to an effect.
    expect((PANEL.match(/onClick=\{[^}]*openEditMode/g) || []).length).toBeGreaterThanOrEqual(1);
    // The whoami DETECTION effect touches neither the switch nor the discovery state.
    const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
    expect(whoamiEffect).not.toContain('setEditMode');
    expect(whoamiEffect).not.toContain('openEditMode');
  });

  it('admin discovery is surfaced once, dismissibly, and NEVER auto-enables edit', () => {
    // Shown only to a detected admin who has not opted in and not dismissed it.
    expect(PANEL).toContain('ekoa-assistant-discovery');
    expect(PANEL).toMatch(/admin && !editMode && !discoveryDismissed \? \(/);
    // A concrete PT-PT suggestion (the conversion moment), plus a dismiss — non-blocking.
    expect(PANEL).toContain('Pode pedir alterações a esta aplicação');
    expect(PANEL).toContain('dismissDiscovery');
    // The banner's CTA is the same explicit opt-in (a click), so it never auto-enables edit.
    expect(PANEL).toMatch(/discovery-cta[\s\S]{0,80}onClick=\{openEditMode\}/);
  });

  it('the edit flow uses the PLATFORM /api/v1/* plane (via edit-mode), NOT the visitor assistant endpoint', () => {
    // The edit machinery is the separate module (a follow-up build + versions/restore), imported here.
    expect(PANEL).toContain("from './edit-mode'");
    expect(PANEL).toContain('runEditPatch'); // POST /api/v1/jobs (the H1-gated follow-up build)
    expect(PANEL).toContain('rollbackToVersion'); // POST /api/v1/artifacts/:id/versions/:sha/restore
    // The confirm step gates the patch run behind an explicit confirmation (PT-PT).
    expect(PANEL).toContain('EDIT_COPY.confirm');
    expect(PANEL).toMatch(/const confirmEdit[\s\S]{0,600}runEditPatch/);
    // The served-app POST /api/app-assistant plane stays visitor-blind: the edit handlers never
    // route through ENDPOINT. runEditPatch/rollbackToVersion drive the /api/v1/* plane instead.
    const confirmEdit = PANEL.slice(PANEL.indexOf('const confirmEdit'), PANEL.indexOf('const approveEdit'));
    expect(confirmEdit).not.toContain('ENDPOINT');
    expect(confirmEdit).not.toContain('/api/app-assistant');
  });

  it('degrades gracefully on a mid-flow 401/403/404 (a calm PT-PT message, never a crash)', () => {
    // The panel maps a degraded outcome onto degradeMessage and a terminal 'note' phase.
    expect(PANEL).toContain('degradeMessage');
    expect(PANEL).toMatch(/outcome === 'ready'/);
    expect(PANEL).toMatch(/setEditPhase\('note'\)/);
    // Rollback is one click and also degrades on a refusal rather than throwing.
    expect(PANEL).toMatch(/const rollbackEdit[\s\S]{0,600}rollbackToVersion/);
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
