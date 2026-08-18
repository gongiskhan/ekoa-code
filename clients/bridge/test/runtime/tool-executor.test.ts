import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantTable, NonceCache, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger, type AutomationLedgerRow } from '../../src/ledger/index.js';
import { DaemonRuntime } from '../../src/runtime/index.js';
import { AutomationEnablement } from '../../src/tools/tier2/index.js';
import { ProfileManager, type ProfileContext, type ProfileLocator, type ProfilePage } from '../../src/browser/index.js';
import type { BridgeCapability, BridgeFrame } from '../../src/wire/index.js';

/**
 * P1.2 - the `tool.invoke` step executor, driven through the REAL `DaemonRuntime.onFrame` so the
 * gates, the ledger, the observation envelope and the outbound send wrapper are all in the path.
 *
 * THE ENVELOPE ASSERTION IS THE POINT OF THIS FILE. `DaemonBrowserSession.ingest` reads a fixed set
 * of keys and SILENTLY IGNORES everything else, so a daemon that spelled one of them differently
 * would produce a run that looks like it works while every page fingerprint is wrong and the action
 * cache never hits again. The shape is asserted exactly, not loosely.
 */
const PAIRING = 'p1';
const ORG = 'orgA';
const SESSION = `bridge:${PAIRING}`;
const GRANT = 'g1';

let home: string;
let grantRoot: string;
let ledgerDir: string;
let ledger: EgressLedger;
let sent: BridgeFrame[];
let pages: FakePage[];
/** Applied to every page the fake context opens. A lease opens a FRESH page per run, so a
 *  per-page mutation made during one run cannot reach the next one - the defaults can. */
let pageDefaults: { visible: boolean; screenshotFails: boolean };
/** Makes the fake page return an oversized accessibility outline (the H-1 cap assertion). */
let hugeA11y: boolean;

interface FakePage extends ProfilePage {
  actions: string[];
  currentUrl: string;
  visible: boolean;
  text: string;
  screenshotFails: boolean;
}

function fakeLocator(page: FakePage, label: string): ProfileLocator {
  const loc: ProfileLocator = {
    first: () => loc,
    click: async () => void page.actions.push(`click:${label}`),
    dblclick: async () => void page.actions.push(`dblclick:${label}`),
    fill: async (v) => void page.actions.push(`fill:${label}:${v}`),
    pressSequentially: async (v) => void page.actions.push(`type:${label}:${v}`),
    press: async (k) => void page.actions.push(`press:${label}:${k}`),
    selectOption: async (v) => {
      page.actions.push(`select:${label}:${v}`);
      return [v];
    },
    check: async () => void page.actions.push(`check:${label}`),
    uncheck: async () => void page.actions.push(`uncheck:${label}`),
    hover: async () => void page.actions.push(`hover:${label}`),
    waitFor: async (o) => {
      page.actions.push(`waitFor:${label}:${o?.state ?? 'visible'}`);
      if (!page.visible) throw new Error('not visible');
    },
    scrollIntoViewIfNeeded: async () => void page.actions.push(`scrollTo:${label}`),
    isVisible: async () => page.visible,
    innerText: async () => page.text,
  };
  return loc;
}

function makePage(): FakePage {
  const page = {
    actions: [] as string[],
    currentUrl: 'about:blank',
    visible: pageDefaults.visible,
    text: 'total 12 euros',
    screenshotFails: pageDefaults.screenshotFails,
    url: () => page.currentUrl,
    title: async () => 'Portal',
    goto: async (u: string) => {
      page.actions.push(`goto:${u}`);
      page.currentUrl = u;
      return null;
    },
    screenshot: async () => {
      if (page.screenshotFails) throw new Error('page is navigating');
      return Buffer.from('PNGBYTES');
    },
    evaluate: async (script: string) => {
      if (script.includes('landmarks')) return 'tags:div=3|roles:button=1|landmarks:2';
      if (script.includes('h1, h2')) return 'Caixa de entrada';
      if (script.includes('aria-label')) return hugeA11y ? 'button "Entrar"'.repeat(2000) : 'button "Entrar"';
      return '';
    },
    viewportSize: () => ({ width: 1280, height: 800 }),
    waitForTimeout: async () => undefined,
    waitForLoadState: async () => undefined,
    keyboard: { press: async (k: string) => void page.actions.push(`kbd:${k}`) },
    mouse: { wheel: async (_x: number, y: number) => void page.actions.push(`wheel:${y}`) },
    getByRole: (r: string) => fakeLocator(page, `role:${r}`),
    getByText: (v: string) => fakeLocator(page, `text:${v}`),
    getByLabel: (v: string) => fakeLocator(page, `label:${v}`),
    getByPlaceholder: (v: string) => fakeLocator(page, `ph:${v}`),
    getByTestId: (v: string) => fakeLocator(page, `tid:${v}`),
    getByAltText: (v: string) => fakeLocator(page, `alt:${v}`),
    getByTitle: (v: string) => fakeLocator(page, `title:${v}`),
    locator: (s: string) => fakeLocator(page, `css:${s}`),
    isClosed: () => false,
    close: async () => undefined,
  } as unknown as FakePage;
  return page;
}

function fakeContext(): ProfileContext {
  return {
    newPage: async () => {
      const p = makePage();
      pages.push(p);
      return p;
    },
    pages: () => pages,
    addCookies: async () => undefined,
    clearCookies: async () => undefined,
    addInitScript: async () => undefined,
    close: async () => undefined,
  };
}

function buildRuntime(opts: { capabilities?: BridgeCapability[]; enabled?: boolean } = {}): DaemonRuntime {
  const enablement = new AutomationEnablement();
  if (opts.enabled !== false) enablement.enable(SESSION);
  return new DaemonRuntime({
    pairingId: PAIRING,
    org: ORG,
    signingSecret: 's',
    grants: new GrantTable([{ grantRef: GRANT, root: grantRoot, session: SESSION }]),
    nonces: new NonceCache(),
    egress: new EgressAccounting(),
    ledger,
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    getCredential: () => 'tok',
    capabilities: opts.capabilities ?? ['local.filesystem', 'local.bash', 'desktop.automation'],
    enablement,
    profiles: new ProfileManager({ home, idleCloseMs: 0, launch: async () => fakeContext() }),
    toolSession: SESSION,
    profileIdFor: () => 'test-profile',
  });
}

async function invoke(runtime: DaemonRuntime, frame: Omit<Extract<BridgeFrame, { type: 'tool.invoke' }>, 'type'>): Promise<Extract<BridgeFrame, { type: 'tool.result' }>> {
  runtime.onFrame({ type: 'tool.invoke', ...frame } as BridgeFrame);
  // The handler is async; drain the microtask queue until the result lands.
  for (let i = 0; i < 200 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  const result = sent.find((f) => f.type === 'tool.result');
  if (!result || result.type !== 'tool.result') throw new Error(`no tool.result was sent (got ${sent.map((f) => f.type).join(',')})`);
  return result;
}

const browserStep = (action: Record<string, unknown>, runId = 'r1'): Record<string, unknown> => ({
  capability: 'browser',
  input: { owner: 'u1', action },
  runId,
});

const automationRows = (): AutomationLedgerRow[] =>
  ledger.readAll(SESSION).rows.filter((r): r is AutomationLedgerRow => r.kind === 'automation');

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ekoa-exec-'));
  grantRoot = join(home, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  writeFileSync(join(grantRoot, 'marker.txt'), 'in-grant');
  ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-exec-ledger-'));
  ledger = new EgressLedger(ledgerDir);
  sent = [];
  pages = [];
  pageDefaults = { visible: true, screenshotFails: false };
  hugeA11y = false;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(ledgerDir, { recursive: true, force: true });
});

describe('GATE 1 - advertisement (the operator switch)', () => {
  it('REFUSES a browser step on a machine that does not advertise desktop.automation', async () => {
    const runtime = buildRuntime({ capabilities: ['local.filesystem'] });
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('desktop.automation');
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied', reason: 'capability not advertised' });
  });

  it('REFUSES a bash step on a machine that does not advertise local.bash', async () => {
    const runtime = buildRuntime({ capabilities: ['local.filesystem', 'desktop.automation'] });
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: { capability: 'bash', input: { argv: ['echo', 'hi'] }, runId: 'r1' },
    });
    expect(res.ok).toBe(false);
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied', reason: 'capability not advertised' });
  });

  it('REFUSES a step whose body does not match the capability it was routed under', async () => {
    // The capability is what the ORG granted. Honouring the body over the grant would make the
    // grant advisory rather than authoritative.
    const runtime = buildRuntime();
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'local.bash', input: browserStep({ action: 'screenshot' }) });
    expect(res.ok).toBe(false);
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied', reason: 'capability mismatch' });
  });
});

describe('GATE 2 - tier-2 enablement', () => {
  it('REFUSES (and ledgers) a bash step when the automation tier is not enabled', async () => {
    const runtime = buildRuntime({ enabled: false });
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: { capability: 'bash', input: { argv: ['echo', 'hi'] }, runId: 'r1' },
    });
    expect(res.ok).toBe(false);
    expect(automationRows().at(-1)).toMatchObject({
      outcome: 'denied',
      reason: 'automation tier not enabled for this session',
    });
  });

  it('REFUSES a browser step too - both tiers are exfiltration-capable', async () => {
    const runtime = buildRuntime({ enabled: false });
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    expect(res.ok).toBe(false);
    expect(automationRows().at(-1)!.outcome).toBe('denied');
  });
});

describe('a daemon with NO execution plane still answers by name', () => {
  it('refuses rather than staying silent - silence makes Cortex wait out a two-minute timeout', async () => {
    const runtime = new DaemonRuntime({
      pairingId: PAIRING,
      org: ORG,
      signingSecret: 's',
      grants: new GrantTable(),
      nonces: new NonceCache(),
      egress: new EgressAccounting(),
      ledger,
      send: (f) => {
        sent.push(f);
        return true;
      },
      getCredential: () => 'tok',
    });
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('não executa');
  });
});

describe('THE OBSERVATION ENVELOPE - exactly what DaemonBrowserSession.ingest reads', () => {
  it('emits url/title/heading/domShapeSketch/accessibilitySnapshot/viewport plus the screenshot', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }),
    });
    expect(res.ok).toBe(true);
    expect(res.output).toEqual({
      url: 'https://portal.test/inbox',
      title: 'Portal',
      heading: 'Caixa de entrada',
      domShapeSketch: 'tags:div=3|roles:button=1|landmarks:2',
      accessibilitySnapshot: 'button "Entrar"',
      viewport: { w: 1280, h: 800 },
    });
    expect(res.screenshotB64).toBe(Buffer.from('PNGBYTES').toString('base64'));
  });

  it('BOUNDS the accessibility outline - it reaches a model prompt and the run record (Cofre H-1)', async () => {
    const runtime = buildRuntime();
    hugeA11y = true;
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    const a11y = (res.output as { accessibilitySnapshot?: string }).accessibilitySnapshot ?? '';
    // Unbounded page text from an AUTHENTICATED session, shipped to a model on every step, is the
    // disclosure H-1 exists to stop. The exact cap is an implementation choice; that there IS one,
    // and that it is well under the page's size, is the property.
    expect(a11y.length).toBeLessThanOrEqual(4_000);
    expect(a11y.length).toBeGreaterThan(0);
  });

  it('the domShapeSketch keeps the exact form Cortex hashes into the page fingerprint', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    expect((res.output as { domShapeSketch: string }).domShapeSketch).toMatch(/^tags:.*\|roles:.*\|landmarks:\d+$/);
  });

  it('OMITS screenshotB64 rather than sending an empty string when the capture fails twice', async () => {
    const runtime = buildRuntime();
    // Prime a page, break its screenshot, then act again on the same warm profile.
    await invoke(runtime, { invocationId: 'i0', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    pageDefaults.screenshotFails = true;
    sent = [];
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    expect(res.screenshotB64).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it('reports an assertion VERDICT on assertionPassed rather than throwing', async () => {
    const runtime = buildRuntime();
    const pass = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'expect_text', locator: { strategy: 'testid', value: 'total' }, contains: '12' }),
    });
    expect((pass.output as { assertionPassed?: boolean }).assertionPassed).toBe(true);
    expect(pass.ok).toBe(true);

    sent = [];
    const fail = await invoke(runtime, {
      invocationId: 'i2',
      capability: 'desktop.automation',
      input: browserStep({ action: 'expect_text', locator: { strategy: 'testid', value: 'total' }, contains: 'nao-existe' }),
    });
    expect((fail.output as { assertionPassed?: boolean }).assertionPassed).toBe(false);
    expect(fail.ok).toBe(false);
  });

  it('OBSERVES EVEN ON FAILURE - the vision fallback resolves the next attempt from the page as it is', async () => {
    const runtime = buildRuntime();
    pages.length = 0;
    // A wait_for against a hidden element throws in the runner.
    const first = await invoke(runtime, { invocationId: 'i0', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    expect(first.ok).toBe(true);
    pageDefaults.visible = false;
    sent = [];
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'wait_for', locator: { strategy: 'testid', value: 'grid' }, state: 'visible' }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('wait_for');
    expect((res.output as { url?: string }).url).toBeDefined();
    expect(res.screenshotB64).toBeTruthy();
  });
});

describe('THE RECONCILED VERBS - the six the daemon could not run before', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['dblclick', { action: 'dblclick', locator: { strategy: 'testid', value: 'row' } }, 'dblclick:tid:row'],
    ['select', { action: 'select', locator: { strategy: 'testid', value: 'pais' }, value: 'PT' }, 'select:tid:pais:PT'],
    ['check', { action: 'check', locator: { strategy: 'testid', value: 'aceito' } }, 'check:tid:aceito'],
    ['uncheck', { action: 'uncheck', locator: { strategy: 'testid', value: 'aceito' } }, 'uncheck:tid:aceito'],
    ['wait_for', { action: 'wait_for', locator: { strategy: 'testid', value: 'grid' }, state: 'visible' }, 'waitFor:tid:grid:visible'],
    ['scroll', { action: 'scroll', direction: 'down', pixels: 300 }, 'wheel:300'],
  ];

  it.each(cases)('runs %s (browser-session.ts listed it as unsupported)', async (_name, action, expected) => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep(action) });
    expect(res.ok).toBe(true);
    expect(pages[0]!.actions).toContain(expected);
  });
});

describe('BASH - the cwd path jail (the gap this closes)', () => {
  const bashStep = (input: Record<string, unknown>): Record<string, unknown> => ({ capability: 'bash', input, runId: 'r1' });

  it('runs an in-grant command and reports stdout/stderr/exitCode', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: bashStep({ argv: ['pwd'], cwd: '.', grantRef: GRANT }),
    });
    expect(res.ok).toBe(true);
    const out = res.output as { stdout: string; exitCode: number };
    expect(out.exitCode).toBe(0);
    expect(out.stdout.trim()).toContain('granted');
  });

  it('REFUSES a cwd that escapes the grant - a bash step cannot cd out of its grant', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: bashStep({ argv: ['pwd'], cwd: '../..', grantRef: GRANT }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('escapes the granted root');
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied' });
  });

  it('REFUSES a cwd when there is no grant to bound it by - unbounded is not a fallback', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: bashStep({ argv: ['pwd'], cwd: '/etc', grantRef: 'nao-existe' }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('grant');
  });

  it('REFUSES a grantRef held for ANOTHER session (S2 - a forged ref is not a grant)', async () => {
    const runtime = new DaemonRuntime({
      pairingId: PAIRING,
      org: ORG,
      signingSecret: 's',
      grants: new GrantTable([{ grantRef: GRANT, root: grantRoot, session: 'someone-else' }]),
      nonces: new NonceCache(),
      egress: new EgressAccounting(),
      ledger,
      send: (f) => {
        sent.push(f);
        return true;
      },
      getCredential: () => 'tok',
      capabilities: ['local.bash'],
      enablement: (() => {
        const e = new AutomationEnablement();
        e.enable(SESSION);
        return e;
      })(),
      profiles: new ProfileManager({ home, idleCloseMs: 0, launch: async () => fakeContext() }),
      toolSession: SESSION,
    });
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: bashStep({ argv: ['pwd'], cwd: '.', grantRef: GRANT }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('grant');
  });

  it('a step with NO grant runs in the daemon work root, not the daemon PROCESS cwd', async () => {
    // Cortex's `local-command.ts` sends no grantRef today, so without a default root the jail would
    // be vacuous for exactly the traffic that exists: the child would inherit whatever directory the
    // LaunchAgent or systemd unit started the daemon in.
    const workRoot = join(home, 'work');
    mkdirSync(workRoot, { recursive: true });
    const runtime = new DaemonRuntime({
      pairingId: PAIRING,
      org: ORG,
      signingSecret: 's',
      grants: new GrantTable(), // no grants at all
      nonces: new NonceCache(),
      egress: new EgressAccounting(),
      ledger,
      send: (f) => {
        sent.push(f);
        return true;
      },
      getCredential: () => 'tok',
      capabilities: ['local.bash'],
      enablement: (() => {
        const e = new AutomationEnablement();
        e.enable(SESSION);
        return e;
      })(),
      profiles: new ProfileManager({ home, idleCloseMs: 0, launch: async () => fakeContext() }),
      toolSession: SESSION,
      defaultWorkRoot: workRoot,
    });
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'local.bash', input: bashStep({ argv: ['pwd'] }) });
    expect(res.ok).toBe(true);
    expect((res.output as { stdout: string }).stdout.trim()).toBe(realpathSync(workRoot));
    expect((res.output as { stdout: string }).stdout.trim()).not.toBe(process.cwd());
  });

  it('a cwd is JAILED to the work root too when no grant is named', async () => {
    const workRoot = join(home, 'work');
    mkdirSync(workRoot, { recursive: true });
    const runtime = new DaemonRuntime({
      pairingId: PAIRING,
      org: ORG,
      signingSecret: 's',
      grants: new GrantTable(),
      nonces: new NonceCache(),
      egress: new EgressAccounting(),
      ledger,
      send: (f) => {
        sent.push(f);
        return true;
      },
      getCredential: () => 'tok',
      capabilities: ['local.bash'],
      enablement: (() => {
        const e = new AutomationEnablement();
        e.enable(SESSION);
        return e;
      })(),
      profiles: new ProfileManager({ home, idleCloseMs: 0, launch: async () => fakeContext() }),
      toolSession: SESSION,
      defaultWorkRoot: workRoot,
    });
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'local.bash', input: bashStep({ argv: ['pwd'], cwd: '../../..' }) });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('escapes the granted root');
  });

  it('a FORGED grantRef is not quietly widened to the work root', async () => {
    // Falling back to the default when a named ref does not resolve would turn "this grant" into
    // "any root the daemon happens to have", which is the opposite of what naming one means.
    const workRoot = join(home, 'work');
    mkdirSync(workRoot, { recursive: true });
    const runtime = buildRuntime();
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: bashStep({ argv: ['pwd'], cwd: '.', grantRef: 'forged' }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('grant');
  });

  it('runs with NO SHELL - an argument can never become shell syntax', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: bashStep({ argv: ['echo', '$(touch /tmp/ekoa-should-not-exist); ok'], grantRef: GRANT }),
    });
    expect(res.ok).toBe(true);
    // The metacharacters came back as literal text: nothing was interpreted.
    expect((res.output as { stdout: string }).stdout).toContain('$(touch');
  });
});

describe('a malformed envelope is refused, not guessed at', () => {
  it('refuses an unparseable step without echoing the payload', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: { nonsense: true } });
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('nonsense');
  });

  it('refuses an invented browser verb - the vocabulary is closed at the trust boundary', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep({ action: 'exfiltrate' }) });
    expect(res.ok).toBe(false);
  });
});
