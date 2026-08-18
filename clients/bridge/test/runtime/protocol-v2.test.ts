import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantTable, NonceCache, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger } from '../../src/ledger/index.js';
import { DaemonRuntime } from '../../src/runtime/index.js';
import type { BridgeFrame } from '../../src/wire/index.js';
import type { CeremonyBrowser } from '../../src/attended/index.js';
import { resolveCapabilities } from '../../src/cli/commands/serve.js';

/**
 * PROTOCOL v2 at the runtime level (Cofre WS-J): `hello`, `attended.request`, `tool.invoke`,
 * `secret.deliver`.
 *
 * The regression these pin: none of these six frames were in the daemon's vendored wire union, so
 * `BridgeSocket.onRaw`'s `safeParse` dropped every one before any handler ran. An `attended.request`
 * reached a live socket and vanished with no log line, while Cortex reported `started: true` and held
 * a ceremony that could only expire.
 */
let sent: BridgeFrame[];
let logs: string[];
let ledgerDir: string;

function makeRuntime(over: Partial<ConstructorParameters<typeof DaemonRuntime>[0]> = {}): DaemonRuntime {
  return new DaemonRuntime({
    pairingId: 'p1',
    org: 'orgA',
    signingSecret: 's',
    grants: new GrantTable([]),
    nonces: new NonceCache(),
    egress: new EgressAccounting(),
    ledger: new EgressLedger(ledgerDir),
    send: (f) => {
      sent.push(f);
      return true;
    },
    getCredential: () => 'tok',
    log: (m) => logs.push(m),
    ...over,
  });
}

beforeEach(() => {
  sent = [];
  logs = [];
  ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-v2-'));
  return () => rmSync(ledgerDir, { recursive: true, force: true });
});

describe('hello — the advertisement (I-1)', () => {
  it('carries the machine name, capabilities and version, truncated to the wire caps', () => {
    const frame = DaemonRuntime.helloFrame({
      machineName: 'x'.repeat(200),
      capabilities: ['attended.card_login', 'local.filesystem'],
      daemonVersion: 'v'.repeat(60),
    });
    expect(frame).toMatchObject({ type: 'hello' });
    const hello = frame as Extract<BridgeFrame, { type: 'hello' }>;
    expect(hello.machineName).toHaveLength(120);
    expect(hello.daemonVersion).toHaveLength(40);
    expect(hello.capabilities).toEqual(['attended.card_login', 'local.filesystem']);
    expect(hello.egressEndpoint).toBeUndefined();
  });

  it('omits egressEndpoint entirely when the machine offers no egress', () => {
    const hello = DaemonRuntime.helloFrame({ machineName: 'm', capabilities: [], daemonVersion: '0.2.0' });
    expect('egressEndpoint' in hello).toBe(false);
  });
});

describe('resolveCapabilities — what this machine honestly claims', () => {
  it('always claims the two it implements, and never the exfiltration-capable ones by default', () => {
    expect(resolveCapabilities(undefined, undefined)).toEqual(['attended.card_login', 'local.filesystem']);
  });

  it('claims residential egress ONLY when an endpoint is actually configured', () => {
    // Claiming egress with nowhere to send it would route a tenant's traffic into a black hole.
    expect(resolveCapabilities(['egress.residential'], undefined)).not.toContain('egress.residential');
    expect(resolveCapabilities(undefined, '100.64.0.1:7777')).toContain('egress.residential');
  });

  it('lets an operator opt in to a tier-2 surface deliberately', () => {
    expect(resolveCapabilities(['local.bash'], undefined)).toContain('local.bash');
  });

  it('DROPS an unknown capability rather than passing it through', () => {
    // The vocabulary is closed upstream: one bad entry would fail the whole `hello` at Cortex's
    // boundary and leave the machine advertising nothing at all.
    const caps = resolveCapabilities(['local.everything', 'local.bash'], undefined);
    expect(caps).not.toContain('local.everything');
    expect(caps).toContain('local.bash');
  });
});

describe('attended.request — the frame that used to vanish', () => {
  const LOGGED_IN = { cookies: [{ name: 'S', value: '1' }], origins: [] };

  /** A fake browser whose close handler is published on `holder` once the ceremony registers it —
   *  the registration happens inside an async launch, so a test that fires before then fires into
   *  nothing and the ceremony hangs until its TTL. */
  function fakeBrowser(state: unknown, holder: { fire?: () => void }): CeremonyBrowser {
    const page = {
      goto: () => Promise.resolve(null),
      url: () => 'https://portal.tribunais.org.pt/area',
      on: (e: string, h: () => void) => {
        if (e === 'close') holder.fire = h;
      },
    };
    const context = {
      newPage: () => Promise.resolve(page),
      storageState: () => Promise.resolve(state),
      close: () => Promise.resolve(),
      on: () => undefined,
    };
    return {
      newContext: () => Promise.resolve(context),
      close: () => Promise.resolve(),
      on: () => undefined,
    } as unknown as CeremonyBrowser;
  }

  it('runs the ceremony and pushes the session', async () => {
    const holder: { fire?: () => void } = {};
    const runtime = makeRuntime({ launchBrowser: () => Promise.resolve(fakeBrowser(LOGGED_IN, holder)) });
    runtime.onFrame({
      type: 'attended.request',
      requestId: 'r-1',
      kind: 'card_login',
      origin: 'https://portal.tribunais.org.pt',
      reason: 'Autenticação para Citius',
    });
    expect(logs.join('\n')).toContain('AUTENTICAÇÃO NECESSÁRIA');
    await vi.waitFor(() => expect(holder.fire).toBeTypeOf('function'));
    holder.fire!();
    await vi.waitFor(() => expect(sent.some((f) => f.type === 'session.push')).toBe(true));
    expect(sent.find((f) => f.type === 'session.push')).toMatchObject({ requestId: 'r-1' });
  });

  it('refuses a SECOND concurrent ceremony instead of opening two windows for one pair of eyes', async () => {
    const holder: { fire?: () => void } = {};
    const runtime = makeRuntime({ launchBrowser: () => Promise.resolve(fakeBrowser(LOGGED_IN, holder)) });
    const req = { type: 'attended.request' as const, kind: 'card_login' as const, origin: 'https://a.pt', reason: 'r' };
    runtime.onFrame({ ...req, requestId: 'r-1' });
    await vi.waitFor(() => expect(holder.fire).toBeTypeOf('function'));
    runtime.onFrame({ ...req, requestId: 'r-2' });
    expect(logs.join('\n')).toContain('Já está uma autenticação a decorrer');
    holder.fire!();
    await vi.waitFor(() => expect(sent.filter((f) => f.type === 'session.push')).toHaveLength(1));
  });
});

describe('tool.invoke / secret.deliver', () => {
  it('answers an unimplemented invocation IMMEDIATELY instead of letting Cortex time out', () => {
    // Before the v2 frames were vendored this frame failed the union, was dropped by the transport,
    // and Cortex waited out its full invocation timeout to report "the machine did not answer in
    // time" — a silent hang dressed as a network problem. A named refusal is the honest failure.
    const runtime = makeRuntime();
    runtime.onFrame({ type: 'tool.invoke', invocationId: 'i-1', capability: 'local.bash', input: { cmd: 'ls' } });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'tool.result', invocationId: 'i-1', ok: false });
    expect((sent[0] as { error: string }).error).toContain('local.bash');
  });

  it('drops a delivered secret without echoing, storing or LOGGING it — not even its env-var names', () => {
    const runtime = makeRuntime();
    runtime.onFrame({
      type: 'secret.deliver',
      invocationId: 'i-1',
      nonce: 'n-1',
      env: { CITIUS_PASSWORD: 'hunter2', API_TOKEN: 'sk-live-abc' },
    });

    const everything = JSON.stringify(sent) + logs.join('\n');
    expect(everything).not.toContain('hunter2');
    expect(everything).not.toContain('sk-live-abc');
    // The NAMES are a map of what this tenant holds, so they must not leak either.
    expect(everything).not.toContain('CITIUS_PASSWORD');
    expect(everything).not.toContain('API_TOKEN');
    expect(sent).toHaveLength(0);
  });
});
