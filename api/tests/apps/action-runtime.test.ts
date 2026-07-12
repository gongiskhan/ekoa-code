import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { servingRouter } from '../../src/apps/serving.js';
import { injectAppContext } from '../../src/apps/injected-context.js';

/**
 * operator-run C3 — the in-page action runtime asset + its serve/inject wiring.
 *
 * Two cheap, honest layers:
 *  (a) SERVE + INJECT — the real servingRouter mounted on a bare Express app (no
 *      mongo needed: /__ekoa/* are pure byte-serves) proves the new
 *      /__ekoa/action-runtime.js route serves JS, and injectAppContext() stamps
 *      BOTH the demo-bridge and the action-runtime script tags into every doc.
 *  (b) SOURCE — invariants of the runtime IIFE itself (envelope, user-input
 *      pause hook, native-setter dispatch, the PT-PT confirmation card, origin
 *      pinning, no emoji). The runtime is a plain browser IIFE not in the test
 *      stack, so we assert its source contract here; the full behavioural
 *      round-trip (host drives a sample app action visibly) lands in C5's
 *      Playwright gate.
 */

const RUNTIME_SRC = readFileSync(
  fileURLToPath(new URL('../../assets/action-runtime-client.js', import.meta.url)),
  'utf-8',
);

describe('C3 serve + inject wiring', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use(servingRouter({ verifyToken: () => ({ sub: 'test' }) }));
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => { server.close(); });

  const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);

  it('GET /__ekoa/action-runtime.js -> 200 JS, non-empty, the real runtime source', async () => {
    const res = await get('/__ekoa/action-runtime.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('javascript');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('__ekoaActions');
    expect(body).toContain('Ekoa In-Page Action Runtime');
  });

  it('the demo bridge still serves alongside it (no regression)', async () => {
    const res = await get('/__ekoa/demo-bridge.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('javascript');
    expect(await res.text()).toContain('Ekoa Tutorial Bridge');
  });

  it('injectAppContext stamps BOTH the demo-bridge and action-runtime script tags', () => {
    const html = injectAppContext('<!DOCTYPE html><html><head></head><body></body></html>', 'appx');
    expect(html).toContain('<script src="/__ekoa/demo-bridge.js"></script>');
    expect(html).toContain('<script src="/__ekoa/action-runtime.js"></script>');
    // both live inside the injected head, before </head>
    expect(html.indexOf('/__ekoa/action-runtime.js')).toBeLessThan(html.indexOf('</head>'));
  });
});

describe('C3 runtime source contract', () => {
  it('carries the postMessage envelope discriminator', () => {
    expect(RUNTIME_SRC).toContain('__ekoaActions: 1');
    expect(RUNTIME_SRC).toContain('actions.init');
    expect(RUNTIME_SRC).toContain('actions.execute');
    expect(RUNTIME_SRC).toContain('actions.ready');
    expect(RUNTIME_SRC).toContain("post('actions.result'");
    expect(RUNTIME_SRC).toContain("post('actions.error'");
    expect(RUNTIME_SRC).toContain('actions.tour-request');
  });

  it('reports the confirm-pending status for destructive actions', () => {
    expect(RUNTIME_SRC).toContain("status: 'confirm-pending'");
  });

  it('pauses on real (isTrusted) user input and cancels with detail user-input', () => {
    expect(RUNTIME_SRC).toContain('isTrusted');
    expect(RUNTIME_SRC).toContain('cancelAllForUserInput');
    expect(RUNTIME_SRC).toContain("detail: 'user-input'");
    // arms real pointer/keyboard listeners in capture phase
    expect(RUNTIME_SRC).toContain("addEventListener('pointerdown', onUserInput, true)");
    expect(RUNTIME_SRC).toContain("addEventListener('keydown', onUserInput, true)");
  });

  it('drives fields through the native setter + bubbling input/change (React-compatible)', () => {
    expect(RUNTIME_SRC).toContain("Object.getOwnPropertyDescriptor(proto, 'value')");
    expect(RUNTIME_SRC).toContain("fireEvent(field, 'input')");
    expect(RUNTIME_SRC).toContain("fireEvent(field, 'change')");
    expect(RUNTIME_SRC).toContain('bubbles: true');
  });

  it('renders the PT-PT confirmation card with the reserved landmark ids', () => {
    expect(RUNTIME_SRC).toContain('Confirmar ação: ');
    expect(RUNTIME_SRC).toContain("setAttribute('data-demo-target', 'ekoa-confirm-acao')");
    expect(RUNTIME_SRC).toContain("setAttribute('data-demo-target', 'ekoa-cancelar-acao')");
    expect(RUNTIME_SRC).toContain("textContent = 'Confirmar'");
    expect(RUNTIME_SRC).toContain("textContent = 'Cancelar'");
    expect(RUNTIME_SRC).toContain('Assistente a executar...');
  });

  it('prefers the app navigate hook and the custom-action registry', () => {
    expect(RUNTIME_SRC).toContain('window.__ekoaApp.navigate');
    expect(RUNTIME_SRC).toContain('window.__ekoaApp.actions');
    expect(RUNTIME_SRC).toContain('unregistered-custom-action');
  });

  it('pins the host origin from the referrer (demo-bridge discipline)', () => {
    expect(RUNTIME_SRC).toContain('document.referrer');
    expect(RUNTIME_SRC).toContain('refererOrigin');
    expect(RUNTIME_SRC).toContain('hostOrigin');
  });

  it('contains NO emoji (UI-code rule)', () => {
    const pictographic = RUNTIME_SRC.match(/\p{Extended_Pictographic}/u);
    expect(pictographic, pictographic ? `found emoji: ${JSON.stringify(pictographic[0])}` : '').toBeNull();
  });

  // operator-run D2-prep: the same-document API the assistant panel uses.
  it('exposes window.__ekoaActions.execute/cancel routing through the SAME executor', () => {
    expect(RUNTIME_SRC).toContain('window.__ekoaActions = {');
    expect(RUNTIME_SRC).toMatch(/execute:\s*function/);
    expect(RUNTIME_SRC).toMatch(/cancel:\s*function/);
    // execute enqueues + drains through the shared queue/runNext (not a separate path).
    expect(RUNTIME_SRC).toMatch(/queue\.push\(\{ id: id, action: action, resolve: resolve, reject: reject \}\)/);
    expect(RUNTIME_SRC).toContain('same-document drive needs no init handshake');
  });

  it('same-document items resolve their Promise on every terminal path (done/failed/cancelled)', () => {
    // finish/fail/cancelById/cancelAllForUserInput all settle activeItem.resolve when present.
    expect(RUNTIME_SRC).toMatch(/var settle = activeItem\.resolve/);
    expect(RUNTIME_SRC).toMatch(/var settle = activeItem\.reject/);
    expect(RUNTIME_SRC).toMatch(/settlers\[j\]\.resolve/); // user-input cancel settles too
  });
});
