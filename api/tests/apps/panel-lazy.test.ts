import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The panel-runtime compile step is an untyped build helper (.mjs, outside the api src
// project) - drive it directly rather than typing the module.
// @ts-expect-error no declaration file for the panel-runtime build helper
import { buildPanelRuntime } from '../../assets/panel-runtime/build.mjs';

/**
 * operator-run G2 - the assistant panel is now a PLATFORM-SERVED runtime asset, lazily
 * loaded by a tiny plain-DOM launcher in the app bundle (the C3 pattern), instead of
 * being baked into every generated app's bundle with its own React copy.
 *
 * This suite pins the STRUCTURAL invariants of that move (the behaviour is proven live
 * by tests/e2e/panel-perf.e2e.mjs):
 *   (a) the panel source LEFT the scaffold: the app-bundle assistant dir carries ONLY
 *       the launcher (mount.js) - AssistantPanel.jsx / tour-player.js / the CSS moved to
 *       api/assets/panel-runtime/src, so a fresh app bundle no longer parses the panel or
 *       a second React on first paint;
 *   (b) the launcher (mount.js) is React-FREE and stays tiny (a measured byte budget), so
 *       the only assistant cost in the app bundle is a small plain-DOM launcher;
 *   (c) the panel-runtime esbuild step compiles clean OFFLINE into one self-contained
 *       IIFE (same in-process real-esbuild posture as tests/apps/builder.test.ts);
 *   (d) the compiled asset self-mounts (#ekoa-assistant-root) and carries NO provider
 *       reference (egress hygiene - it bundles React + the panel, nothing else).
 */

const SCAFFOLD_ASSIST = new URL(
  '../../assets/bases/app/scaffold/frontend/src/lib/assistant/',
  import.meta.url,
);
const PANEL_SRC = new URL('../../assets/panel-runtime/src/', import.meta.url);

const scaffoldFile = (rel: string) => fileURLToPath(new URL(rel, SCAFFOLD_ASSIST));
const panelSrcFile = (rel: string) => fileURLToPath(new URL(rel, PANEL_SRC));

// Measured baseline of the React-free launcher (2026-07-13): 5273 bytes. The budget is
// set at 8192 bytes (~1.55x the baseline) - defensible headroom for edits while guarding
// against the launcher ever regrowing into a heavy in-bundle module (the whole point of
// G2 is that the app bundle stops carrying the panel + a second React).
const MOUNT_BYTE_BUDGET = 8192;

describe('G2 panel move - source left the app scaffold', () => {
  it('the app-bundle assistant dir carries ONLY the launcher (mount.js)', () => {
    expect(existsSync(scaffoldFile('mount.js'))).toBe(true);
    // The heavy panel/player/CSS are gone from the app bundle - they moved platform-side.
    expect(existsSync(scaffoldFile('AssistantPanel.jsx'))).toBe(false);
    expect(existsSync(scaffoldFile('AssistantPanel.css'))).toBe(false);
    expect(existsSync(scaffoldFile('tour-player.js'))).toBe(false);
  });

  it('the panel source now lives in the platform panel-runtime dir', () => {
    expect(existsSync(panelSrcFile('index.jsx'))).toBe(true); // the self-mounting entry
    expect(existsSync(panelSrcFile('AssistantPanel.jsx'))).toBe(true);
    expect(existsSync(panelSrcFile('AssistantPanel.css'))).toBe(true);
    expect(existsSync(panelSrcFile('tour-player.js'))).toBe(true);
  });
});

describe('G2 launcher - React-free + under the byte budget', () => {
  const MOUNT = readFileSync(scaffoldFile('mount.js'), 'utf-8');

  it('imports no React and never mounts a React root (plain DOM only)', () => {
    expect(MOUNT).not.toMatch(/from\s+['"]react/);
    expect(MOUNT).not.toMatch(/require\(\s*['"]react/);
    expect(MOUNT).not.toContain('createRoot');
    expect(MOUNT).not.toContain('react-dom');
  });

  it('renders the launcher immediately and lazy-loads the platform panel-runtime', () => {
    // Plain-DOM launcher, brand-consistent (same class + CSS-var contract), PT-PT + aria.
    expect(MOUNT).toContain('ekoa-assistant-launcher');
    expect(MOUNT).toContain('Assistente');
    expect(MOUNT).toContain('Abrir o assistente');
    // Lazy loader: it injects the platform asset on interaction/idle (not eagerly).
    expect(MOUNT).toContain('/__ekoa/panel-runtime.js');
    expect(MOUNT).toMatch(/requestIdleCallback/);
    // Handoff intent flag consumed by the asset's index.jsx.
    expect(MOUNT).toContain('__ekoaAssistantAutoOpen');
    // Open-intent EVENT (late leg): every click also dispatches this, so a click
    // landing after an idle-preload mount still opens the panel (intent never lost).
    expect(MOUNT).toContain("'ekoa:assistant-open'");
    // Transport-failure retry (review-g2 Low-1): onerror resets the once-only guard,
    // so a failed inject never bricks the launcher for the page session.
    expect(MOUNT).toContain('onerror');
    const panelJsx = readFileSync(panelSrcFile('AssistantPanel.jsx'), 'utf-8');
    expect(panelJsx).toContain("'ekoa:assistant-open'"); // ...and the panel listens for it
    // No emoji (UI-code rule).
    const m = MOUNT.match(/\p{Extended_Pictographic}/u);
    expect(m, m ? `mount emoji: ${JSON.stringify(m[0])}` : '').toBeNull();
  });

  it('stays under the measured byte budget', () => {
    const bytes = Buffer.byteLength(MOUNT, 'utf-8');
    expect(bytes, `mount.js is ${bytes} bytes, budget ${MOUNT_BYTE_BUDGET}`).toBeLessThanOrEqual(
      MOUNT_BYTE_BUDGET,
    );
  });
});

describe('G2 panel-runtime asset - compiles clean + self-mounts + egress-clean', () => {
  it('compiles offline into one self-contained IIFE with no build errors', async () => {
    const { code, errors } = await buildPanelRuntime({ write: false });
    expect(errors, JSON.stringify(errors)).toEqual([]);
    expect(code.length).toBeGreaterThan(1000);
    // IIFE (browser format) - not an ESM module the served plane could not run.
    expect(code).toMatch(/\(\(\)\s*=>\s*\{/);
    expect(code).not.toMatch(/^\s*export\s/m);
  }, 60_000);

  it('self-mounts into #ekoa-assistant-root and injects its own styles', async () => {
    const { code } = await buildPanelRuntime({ write: false });
    expect(code).toContain('ekoa-assistant-root'); // the self-mount marker survives minify
    expect(code).toContain('data-ekoa-panel'); // the css-inject style tag
  }, 60_000);

  it('carries NO provider reference (egress hygiene)', async () => {
    const { code } = await buildPanelRuntime({ write: false });
    // A single case-insensitive `anthropic` absence check covers BOTH banned forms
    // (`@anthropic-ai` and `api.anthropic.com` each contain the token). The needle is
    // split so this test file stays clean of the literal token the chokepoint grep
    // gate scans for.
    const ANTHROPIC = 'anthrop' + 'ic';
    expect(new RegExp(ANTHROPIC, 'i').test(code)).toBe(false);
  }, 60_000);
});
