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
/** Applied to every page the fake context opens. The lease opens ONE page per RUN and keeps it for
 *  every step of that run, so a mid-run change of page behaviour is made on the live page
 *  (`pages[0]`); these defaults only decide what the NEXT run's page starts as. */
let pageDefaults: { visible: boolean; screenshotFails: boolean };
/** Makes the fake page return an oversized accessibility outline (the H-1 cap assertion). */
let hugeA11y: boolean;
/** The profile manager `buildRuntime` wired, so the run-lease assertions can see its state. */
let profiles: ProfileManager;
/** The one cookie jar every fake context shares, so a wipe is visible to the assertions.
 *  `clearFails` makes the wipe fail the way a wedged browser does. */
let jar: { cleared: number; cookiesAdded: number[]; clearFails: boolean };

interface FakePage extends ProfilePage {
  actions: string[];
  currentUrl: string;
  visible: boolean;
  text: string;
  screenshotFails: boolean;
  /** Honest, because the run-lease assertions turn on WHEN a page closes. */
  closed: boolean;
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
    closed: false,
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
    isClosed: () => page.closed,
    close: async () => void (page.closed = true),
  } as unknown as FakePage;
  return page;
}

function fakeContext(): ProfileContext {
  // Bound to the jar that exists NOW, not to whatever the module-level `jar` points at when the
  // call happens: a manager from an earlier test can still fire its idle backstop after that test
  // ended, and a late wipe must land on its own test's jar rather than on the running one's.
  const myJar = jar;
  const myPages = pages;
  return {
    newPage: async () => {
      const p = makePage();
      myPages.push(p);
      return p;
    },
    pages: () => myPages,
    addCookies: async (c) => void myJar.cookiesAdded.push(c.length),
    clearCookies: async () => {
      if (myJar.clearFails) throw new Error('browser context is closed');
      myJar.cleared += 1;
    },
    addInitScript: async () => undefined,
    close: async () => undefined,
  };
}

function buildRuntime(
  opts: {
    capabilities?: BridgeCapability[];
    enabled?: boolean;
    runIdleMs?: number;
    sessionStateFor?: (runId: string) => unknown;
  } = {},
): DaemonRuntime {
  const enablement = new AutomationEnablement();
  if (opts.enabled !== false) enablement.enable(SESSION);
  profiles = new ProfileManager({
    home,
    idleCloseMs: 0,
    runIdleMs: opts.runIdleMs ?? 0,
    launch: async () => fakeContext(),
  });
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
    profiles,
    toolSession: SESSION,
    // Mirrors serve.ts: one profile per OWNER. Owner-dependent on purpose - a constant here would
    // make every frame land on one profile and hide the scoping the lifecycle verbs depend on.
    profileIdFor: ({ owner }) => owner ?? 'test-profile',
    ...(opts.sessionStateFor ? { sessionStateFor: opts.sessionStateFor } : {}),
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

const browserStep = (
  action: Record<string, unknown>,
  runId = 'r1',
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  capability: 'browser',
  input: { owner: 'u1', action, ...extra },
  runId,
});

/** A LIFECYCLE frame - `release` or `keepalive`. A different arm of the step payload from a page
 *  action, which is what keeps a resolver structurally unable to emit one. */
const leaseStep = (
  leaseOp: 'release' | 'keepalive',
  runId = 'r1',
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  capability: 'browser',
  input: { owner: 'u1', leaseOp, ...extra },
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
  jar = { cleared: 0, cookiesAdded: [], clearFails: false };
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
    // Prime a page, break ITS screenshot, then act again in the same run. The break is applied to
    // the live page rather than to the defaults because the run keeps one page across its steps.
    await invoke(runtime, { invocationId: 'i0', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    pages[0]!.screenshotFails = true;
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
    pages[0]!.visible = false;
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
    // Asserted on the LEDGER reason, not the user-facing prose: the prose is PT-PT product copy and
    // may be reworded, while the reason is the machine fact this test exists to pin. The previous
    // assertion (`error` contains 'grant') passed only because bashArgv happened to say the English
    // word, which made it survive rewording of the very refusal it guarded.
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied', reason: 'unresolvable grantRef' });
  });

  it('REFUSES an unresolvable grantRef even with NO cwd - naming a grant you do not hold cannot be better than naming none', async () => {
    // THE HOLE THIS SUITE MISSED. Every other case here passes a `cwd`, so the refusal came from
    // bashArgv (cwd present + no root). With no cwd there was nothing for it to refuse, the
    // undefined grantRoot was dropped by the options spread, and the child ran in the DAEMON'S OWN
    // process cwd - unjailed, on the exact path the jail exists to bound.
    const runtime = buildRuntime();
    const res = await invoke(runtime, {
      invocationId: 'i1',
      capability: 'local.bash',
      input: bashStep({ argv: ['pwd'], grantRef: 'nao-existe' }),
    });
    expect(res.ok).toBe(false);
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied', reason: 'unresolvable grantRef' });
    // And nothing ran: no stdout came back from a child that should never have been spawned.
    expect(res.output).toBeUndefined();
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
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied', reason: 'unresolvable grantRef' });
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
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied', reason: 'unresolvable grantRef' });
    // The point of the test: it did not silently become the work root that exists right here.
    expect(res.output).toBeUndefined();
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

/**
 * THE MULTI-STEP FLOW, driven through the real frame handler.
 *
 * These are the assertions the per-action unit tests structurally could not make. Every other suite
 * in this file sends ONE invoke; the defect lived entirely in what happens between two of them.
 * Cortex dispatches one `tool.invoke` per act/assert/observe, and the executor used to acquire a
 * lease per FRAME and release it in a `finally` - closing the page and clearing the whole cookie
 * jar - so a navigate landed and then every step after it ran on a fresh about:blank, signed out.
 */
describe('THE RUN-SCOPED LEASE - a run is a sequence of steps, not a sequence of runs', () => {
  it('lands a navigate and then acts on THAT page, not on a fresh about:blank', async () => {
    const runtime = buildRuntime();
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }),
    });
    sent = [];
    const second = await invoke(runtime, {
      invocationId: 'i2',
      capability: 'desktop.automation',
      input: browserStep({ action: 'click', locator: { strategy: 'testid', value: 'linha' } }),
    });

    expect(second.ok).toBe(true);
    // ONE page for the whole run, still on the URL the navigate reached.
    expect(pages).toHaveLength(1);
    expect((second.output as { url: string }).url).toBe('https://portal.test/inbox');
    // `waitFor` is the locator ladder probing the primary before clicking it.
    expect(pages[0]!.actions).toEqual([
      'goto:https://portal.test/inbox',
      'waitFor:tid:linha:visible',
      'click:tid:linha',
    ]);
  });

  it('does NOT wipe the cookie jar between steps of one run', async () => {
    const runtime = buildRuntime({
      sessionStateFor: () => ({ cookies: [{ name: 'sid', value: 'v', domain: 'portal.test' }] }),
    });
    for (const [i, action] of [
      { action: 'navigate', url: 'https://portal.test/inbox' },
      { action: 'click', locator: { strategy: 'testid', value: 'a' } },
      { action: 'screenshot' },
    ].entries()) {
      sent = [];
      const res = await invoke(runtime, { invocationId: `i${i}`, capability: 'desktop.automation', input: browserStep(action) });
      expect(res.ok, JSON.stringify(action)).toBe(true);
    }
    // Injected once, at the start of the run; never cleared while the run is still going.
    expect(jar.cookiesAdded).toEqual([1]);
    expect(jar.cleared).toBe(0);
  });

  it('gives a DIFFERENT runId its own page - the scope is the run, not the daemon', async () => {
    const runtime = buildRuntime();
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }, 'r1'),
    });
    sent = [];
    await invoke(runtime, { invocationId: 'i2', capability: 'desktop.automation', input: leaseStep('release', 'r1') });
    sent = [];
    const other = await invoke(runtime, {
      invocationId: 'i3',
      capability: 'desktop.automation',
      input: browserStep({ action: 'screenshot' }, 'r2'),
    });
    expect(pages).toHaveLength(2);
    expect((other.output as { url: string }).url).toBe('about:blank');
  });
});

describe('THE RELEASE VERB - the run-end signal DaemonBrowserSession.dispose sends', () => {
  it('ends the run: the page closes and the jar is WIPED', async () => {
    const runtime = buildRuntime({
      sessionStateFor: () => ({ cookies: [{ name: 'sid', value: 'v', domain: 'portal.test' }] }),
    });
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }),
    });
    expect(jar.cleared).toBe(0);
    expect(profiles.openRuns()).toEqual(['r1']);

    sent = [];
    const res = await invoke(runtime, { invocationId: 'i2', capability: 'desktop.automation', input: leaseStep('release') });

    expect(res.ok).toBe(true);
    expect(jar.cleared).toBe(1);
    expect(profiles.openRuns()).toEqual([]);
  });

  it('carries no observation and takes no screenshot - there is no page left to photograph', async () => {
    const runtime = buildRuntime();
    await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: browserStep({ action: 'screenshot' }) });
    sent = [];
    const res = await invoke(runtime, { invocationId: 'i2', capability: 'desktop.automation', input: leaseStep('release') });
    expect(res.output).toBeUndefined();
    expect(res.screenshotB64).toBeUndefined();
  });

  it('is LEDGERED - it is still a remote instruction to act on this machine', async () => {
    const runtime = buildRuntime();
    await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: leaseStep('release') });
    expect(automationRows().at(-1)).toMatchObject({ tool: 'browser', detail: 'release', outcome: 'ran' });
  });

  it('passes the SAME gates as any other step - an unadvertised machine refuses it', async () => {
    const runtime = buildRuntime({ capabilities: ['local.filesystem'] });
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: leaseStep('release') });
    expect(res.ok).toBe(false);
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'denied', reason: 'capability not advertised' });
  });

  it('opens NO browser for a run that never took one (dispose after a run with no browser step)', async () => {
    const runtime = buildRuntime();
    const res = await invoke(runtime, { invocationId: 'i1', capability: 'desktop.automation', input: leaseStep('release') });
    expect(res.ok).toBe(true);
    expect(pages).toHaveLength(0);
  });

  it('REFUSES a step that arrives after the run ended, by name', async () => {
    // Serving it would silently hand the step a brand-new blank page and an empty jar, and report
    // it to Cortex as a step that ran - which is the original defect wearing a different hat.
    const runtime = buildRuntime();
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }),
    });
    sent = [];
    await invoke(runtime, { invocationId: 'i2', capability: 'desktop.automation', input: leaseStep('release') });
    sent = [];
    const late = await invoke(runtime, {
      invocationId: 'i3',
      capability: 'desktop.automation',
      input: browserStep({ action: 'click', locator: { strategy: 'testid', value: 'a' } }),
    });
    expect(late.ok).toBe(false);
    expect(late.error).toContain('encerrada');
    expect(pages).toHaveLength(1); // no second page was ever opened
    expect(automationRows().at(-1)).toMatchObject({ outcome: 'error' });
  });

  it('is SCOPED TO THE OWNER: another owner naming this lease does not end this run', async () => {
    // `runs` is one process-wide map and the lease id is an opaque string on the wire. The release
    // used to be answered before a profile was ever resolved, so a frame carrying owner B and a
    // lease id belonging to owner A dropped A's page, wiped A's jar, and left A's next step refused
    // by name. Every page verb was already scoped this way; the lifecycle verbs were not.
    const runtime = buildRuntime({
      sessionStateFor: () => ({ cookies: [{ name: 'sid', value: 'v', domain: 'portal.test' }] }),
    });
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }, 'r1', { leaseId: 'lease-a' }),
    });
    sent = [];

    const stolen = await invoke(runtime, {
      invocationId: 'i2',
      capability: 'desktop.automation',
      // Owner B, run of B's own - naming A's lease.
      input: { capability: 'browser', input: { owner: 'u2', leaseId: 'lease-a', leaseOp: 'release' }, runId: 'r9' },
    });

    expect(stolen.ok).toBe(false);
    expect(profiles.openRuns()).toEqual(['lease-a']);
    expect(jar.cleared).toBe(0);
    expect(pages[0]!.closed).toBe(false);

    // ... and the owner still ends their own run normally.
    sent = [];
    const own = await invoke(runtime, {
      invocationId: 'i3',
      capability: 'desktop.automation',
      input: leaseStep('release', 'r1', { leaseId: 'lease-a' }),
    });
    expect(own.ok).toBe(true);
    expect(jar.cleared).toBe(1);
  });

  it('REPORTS A FAILED WIPE as a failed step instead of a clean run end', async () => {
    // Three `catch(() => undefined)`s used to swallow this and answer ok:true with a ledger row
    // saying `ran`, while the injected Cofre session stayed resident in a profile the user's next
    // automation shares. The wire and the ledger both have to say what happened.
    const runtime = buildRuntime({
      sessionStateFor: () => ({ cookies: [{ name: 'sid', value: 'v', domain: 'portal.test' }] }),
    });
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }),
    });
    jar.clearFails = true;
    sent = [];

    const res = await invoke(runtime, { invocationId: 'i2', capability: 'desktop.automation', input: leaseStep('release') });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('browser context is closed');
    expect(automationRows().at(-1)).toMatchObject({ tool: 'browser', detail: 'release', outcome: 'error' });
  });
});

/**
 * A SUB-AUTOMATION, through the frame handler.
 *
 * A `sub_automation` step runs a second run inside the first - its own runId, the same owner, so
 * the same profile - while the parent sits blocked on it. Keyed by runId the child's first browser
 * step queued behind the lease the parent could not release until the child returned; the two
 * deadlocked, and the idle backstop then reaped the waiting parent. Cortex threads ONE lease id
 * down the call tree, and these are the frames that come out of that.
 */
describe('THE NESTED RUN - one lease, two runIds', () => {
  it('gives the child the page its parent left open, without waiting for the parent to finish', async () => {
    const runtime = buildRuntime();
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }, 'run-parent', { leaseId: 'lease-1' }),
    });
    sent = [];

    // The child's frame: DIFFERENT runId, SAME lease. The parent has not released - it cannot, it
    // is blocked waiting for this.
    const child = await invoke(runtime, {
      invocationId: 'i2',
      capability: 'desktop.automation',
      input: browserStep({ action: 'click', locator: { strategy: 'testid', value: 'linha' } }, 'run-child', {
        leaseId: 'lease-1',
      }),
    });

    expect(child.ok).toBe(true);
    expect(pages).toHaveLength(1); // ONE page, ONE browser, for the whole tree
    expect((child.output as { url: string }).url).toBe('https://portal.test/inbox');
    expect(profiles.openRuns()).toEqual(['lease-1']);

    // And the parent carries on afterwards, on the same page, because the child did not release it.
    sent = [];
    const parentAgain = await invoke(runtime, {
      invocationId: 'i3',
      capability: 'desktop.automation',
      input: browserStep({ action: 'screenshot' }, 'run-parent', { leaseId: 'lease-1' }),
    });
    expect((parentAgain.output as { url: string }).url).toBe('https://portal.test/inbox');
    expect(pages).toHaveLength(1);
  });
});

/**
 * THE KEEPALIVE.
 *
 * The idle backstop cannot tell an abandoned lease from a live run that is not touching the browser
 * at this instant - blocked on a sub-automation, on a slow API call, or on a human at a CAPTCHA in
 * that very window. Without this signal the window is either uselessly long or wrong.
 */
describe('THE KEEPALIVE VERB', () => {
  it('holds the lease open across a gap many times the idle window', async () => {
    const runtime = buildRuntime({
      runIdleMs: 60,
      sessionStateFor: () => ({ cookies: [{ name: 'sid', value: 'v', domain: 'portal.test' }] }),
    });
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }),
    });

    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 25));
      sent = [];
      const beat = await invoke(runtime, {
        invocationId: `k${i}`,
        capability: 'desktop.automation',
        input: leaseStep('keepalive'),
      });
      expect(beat.ok, `heartbeat ${i}`).toBe(true);
      expect(beat.output).toEqual({ held: true });
    }

    expect(profiles.openRuns()).toEqual(['r1']);
    expect(jar.cleared).toBe(0);
    expect(pages[0]!.closed).toBe(false);
  });

  it('answers held:false for a lease this machine no longer has, and opens no browser', async () => {
    const runtime = buildRuntime();
    const beat = await invoke(runtime, { invocationId: 'k1', capability: 'desktop.automation', input: leaseStep('keepalive') });
    expect(beat.ok).toBe(true);
    expect(beat.output).toEqual({ held: false });
    expect(pages).toHaveLength(0);
    expect(profiles.openRuns()).toEqual([]);
  });

  it('is ledgered, and is REFUSED when it names a lease on another owner profile', async () => {
    const runtime = buildRuntime();
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'screenshot' }, 'r1', { leaseId: 'lease-a' }),
    });
    sent = [];
    const beat = await invoke(runtime, {
      invocationId: 'k1',
      capability: 'desktop.automation',
      input: { capability: 'browser', input: { owner: 'u2', leaseId: 'lease-a', leaseOp: 'keepalive' }, runId: 'r9' },
    });
    expect(beat.ok).toBe(false);
    expect(automationRows().at(-1)).toMatchObject({ tool: 'browser', detail: 'keepalive', outcome: 'denied' });
  });
});

describe('RULE 7 - a Cortex that predates the lease id still works', () => {
  it('falls back to the runId, so its steps still share one page and its release still ends them', async () => {
    const runtime = buildRuntime();
    // No `leaseId` anywhere: exactly the frames the previous Cortex sends.
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }),
    });
    sent = [];
    const second = await invoke(runtime, {
      invocationId: 'i2',
      capability: 'desktop.automation',
      input: browserStep({ action: 'screenshot' }),
    });
    expect(pages).toHaveLength(1);
    expect((second.output as { url: string }).url).toBe('https://portal.test/inbox');
    expect(profiles.openRuns()).toEqual(['r1']); // keyed by the runId
    sent = [];
    const rel = await invoke(runtime, { invocationId: 'i3', capability: 'desktop.automation', input: leaseStep('release') });
    expect(rel.ok).toBe(true);
    expect(profiles.openRuns()).toEqual([]);
  });
});

describe('THE IDLE BACKSTOP through the executor - a Cortex that dies leaves nothing resident', () => {
  it('wipes the jar without ever receiving a release', async () => {
    const runtime = buildRuntime({
      runIdleMs: 20,
      sessionStateFor: () => ({ cookies: [{ name: 'sid', value: 'v', domain: 'portal.test' }] }),
    });
    await invoke(runtime, {
      invocationId: 'i1',
      capability: 'desktop.automation',
      input: browserStep({ action: 'navigate', url: 'https://portal.test/inbox' }),
    });
    expect(jar.cleared).toBe(0);

    // Nothing else is sent. This is the socket dropping mid-run.
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline && profiles.openRuns().length > 0) await new Promise((r) => setTimeout(r, 5));

    expect(profiles.openRuns()).toEqual([]);
    expect(jar.cleared).toBe(1);
    expect(pages[0]!.closed).toBe(true);
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
