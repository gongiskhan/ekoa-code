import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantTable, NonceCache, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger } from '../../src/ledger/index.js';
import { DaemonRuntime } from '../../src/runtime/index.js';
import { AutomationEnablement } from '../../src/tools/tier2/index.js';
import { ProfileManager, type ProfileContext, type ProfileLocator, type ProfilePage } from '../../src/browser/index.js';
import type { BridgeFrame } from '../../src/wire/index.js';

/**
 * Shared rig for the I9 security suites - a real `DaemonRuntime` with a real ledger on a real
 * temporary home, a fake headed browser, and a `send` spy that captures the frames as they LEAVE.
 *
 * The send spy sits where the socket would: the runtime wraps `deps.send` in its outbound redactor
 * in its constructor, so anything the spy records is what would have gone on the wire.
 */
export const PAIRING = 'p-sec';
export const ORG = 'org-sec';
export const SESSION = `bridge:${PAIRING}`;
export const GRANT = 'g-sec';

export interface SecurityRig {
  home: string;
  grantRoot: string;
  ledgerDir: string;
  ledger: EgressLedger;
  runtime: DaemonRuntime;
  /** Frames as they left `send` - i.e. AFTER the outbound redactor. */
  sent: BridgeFrame[];
  /** Everything the daemon wrote to its log channel during the run. */
  logs: string[];
  pageText: { value: string };
}

export function makeRig(): SecurityRig {
  const home = mkdtempSync(join(tmpdir(), 'ekoa-sec-'));
  const grantRoot = join(home, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  writeFileSync(join(grantRoot, 'marker.txt'), 'in-grant');
  const ledgerDir = join(home, 'ledger');
  const ledger = new EgressLedger(ledgerDir);
  const sent: BridgeFrame[] = [];
  const logs: string[] = [];
  const pageText = { value: '' };

  const enablement = new AutomationEnablement();
  enablement.enable(SESSION);

  const runtime = new DaemonRuntime({
    pairingId: PAIRING,
    org: ORG,
    signingSecret: 'sec',
    grants: new GrantTable([{ grantRef: GRANT, root: grantRoot, session: SESSION }]),
    nonces: new NonceCache(),
    egress: new EgressAccounting(),
    ledger,
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    getCredential: () => 'tok',
    log: (m) => logs.push(m),
    capabilities: ['local.bash', 'desktop.automation'],
    enablement,
    profiles: new ProfileManager({ home, idleCloseMs: 0, launch: async () => fakeContext(pageText) }),
    toolSession: SESSION,
    profileIdFor: () => 'sec-profile',
  });

  return { home, grantRoot, ledgerDir, ledger, runtime, sent, logs, pageText };
}

/** Drive one frame and wait for the `tool.result` to leave. */
export async function invokeAndWait(rig: SecurityRig, frame: BridgeFrame): Promise<Extract<BridgeFrame, { type: 'tool.result' }>> {
  const before = rig.sent.length;
  rig.runtime.onFrame(frame);
  for (let i = 0; i < 400; i++) {
    const found = rig.sent.slice(before).find((f) => f.type === 'tool.result');
    if (found && found.type === 'tool.result') return found;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('no tool.result was sent');
}

export const bashInvoke = (invocationId: string, argv: string[]): BridgeFrame =>
  ({
    type: 'tool.invoke',
    invocationId,
    capability: 'local.bash',
    input: { capability: 'bash', input: { argv, cwd: '.', grantRef: GRANT }, runId: 'r1' },
  }) as BridgeFrame;

export const browserInvoke = (invocationId: string): BridgeFrame =>
  ({
    type: 'tool.invoke',
    invocationId,
    capability: 'desktop.automation',
    input: { capability: 'browser', input: { owner: 'u1', action: { action: 'screenshot' } }, runId: 'r1' },
  }) as BridgeFrame;

export const deliverFrame = (invocationId: string, env: Record<string, string>): BridgeFrame =>
  ({ type: 'secret.deliver', invocationId, nonce: 'n1', env }) as BridgeFrame;

/** Every regular file under a directory tree, as [path, contents]. */
export function readTree(root: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        try {
          out.push([full, readFileSync(full, 'utf8')]);
        } catch {
          out.push([full, '']);
        }
      }
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// The fake headed browser. Its page TEXT is settable so a suite can make the page
// echo a delivered credential - the browser half of the outbound-redaction proof.
// ---------------------------------------------------------------------------

function fakeLocator(): ProfileLocator {
  const loc: ProfileLocator = {
    first: () => loc,
    click: async () => undefined,
    dblclick: async () => undefined,
    fill: async () => undefined,
    pressSequentially: async () => undefined,
    press: async () => undefined,
    selectOption: async () => [],
    check: async () => undefined,
    uncheck: async () => undefined,
    hover: async () => undefined,
    waitFor: async () => undefined,
    scrollIntoViewIfNeeded: async () => undefined,
    isVisible: async () => true,
    innerText: async () => '',
  };
  return loc;
}

function fakePage(pageText: { value: string }): ProfilePage {
  const page = {
    url: () => `https://portal.test/?trace=${encodeURIComponent(pageText.value)}`,
    title: async () => `Portal ${pageText.value}`,
    goto: async () => null,
    screenshot: async () => Buffer.from('PNG'),
    evaluate: async (script: string) => {
      if (script.includes('landmarks')) return 'tags:div=1|roles:|landmarks:0';
      if (script.includes('h1, h2')) return `Bem-vindo ${pageText.value}`;
      if (script.includes('aria-label')) return `button "${pageText.value}"`;
      return '';
    },
    viewportSize: () => ({ width: 1280, height: 800 }),
    waitForTimeout: async () => undefined,
    waitForLoadState: async () => undefined,
    keyboard: { press: async () => undefined },
    mouse: { wheel: async () => undefined },
    getByRole: fakeLocator,
    getByText: fakeLocator,
    getByLabel: fakeLocator,
    getByPlaceholder: fakeLocator,
    getByTestId: fakeLocator,
    getByAltText: fakeLocator,
    getByTitle: fakeLocator,
    locator: fakeLocator,
    isClosed: () => false,
    close: async () => undefined,
  } as unknown as ProfilePage;
  return page;
}

function fakeContext(pageText: { value: string }): ProfileContext {
  const open: ProfilePage[] = [];
  return {
    newPage: async () => {
      const p = fakePage(pageText);
      open.push(p);
      return p;
    },
    pages: () => open,
    addCookies: async () => undefined,
    clearCookies: async () => undefined,
    addInitScript: async () => undefined,
    close: async () => undefined,
  };
}
