import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import {
  refreshDefinitions,
  resolveBackingType,
  IntegrationActionBackingTypeError,
  type IntegrationAction,
} from '../../src/integrations/definitions.js';
import { createConfig } from '../../src/integrations/service.js';
import {
  executeUserIntegrationAction,
  type AutomationBackedHandler,
  type FetchLike,
} from '../../src/integrations/action-executor.js';

/**
 * Slice C1 — the unified Action model's BACKING discriminator, both halves:
 *
 *  1. `resolveBackingType` (definitions.ts) is the ONE derivation of "how does this action run".
 *     An ABSENT `backingType` must reproduce today's behaviour byte for byte (a binding beats an
 *     httpConfig), which is what makes the field additive and migration-free; an EXPLICIT value
 *     that contradicts the action's shape is a package defect and must be a coded refusal, never
 *     a silent guess in either direction.
 *  2. `executeUserIntegrationAction` dispatches on it: `api-call` takes the unchanged HTTP path,
 *     `browser-steps` the unchanged automation seam, and `bash-cli` is refused
 *     (`unsupported_backing_type`) UNLESS it has been materialised as an automation — bash runs on
 *     the user's PAIRED MACHINE through the engine, never on the Cortex host, so there is no
 *     server-side CLI runner to fall back to.
 *
 * Both refusals land BEFORE any credential is decrypted, the same posture as the transport gate.
 */
let mem: MongoMemoryServer;
let fixtureRoot: string;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = (userId: string) => ({ userId, orgId: 'orgA', role: 'user' } as const);

const KEY = 'backingco';
// Composed at runtime: never a credential-shaped literal in the tree (gitleaks).
const API_KEY = ['tk', 'backing', Math.random().toString(36).slice(2, 10)].join('-');

const HTTP = { method: 'GET', baseUrl: 'https://api.backing.example', path: '/things' } as const;
const BINDING = { automationId: 'auto-1', argMap: {} } as const;

/** The fixture package: one action per cell of the backing table, including the malformed ones. */
const ACTIONS: Array<Record<string, unknown>> = [
  { actionName: 'derived_api', description: 'http, no backingType', mutates: false, httpConfig: HTTP },
  { actionName: 'derived_browser', description: 'bound, no backingType', mutates: false, automationBinding: BINDING },
  { actionName: 'derived_both', description: 'bound AND http, no backingType', mutates: false, httpConfig: HTTP, automationBinding: BINDING },
  { actionName: 'no_shape', description: 'neither shape', mutates: false },
  { actionName: 'explicit_api', description: 'explicit api-call', mutates: false, backingType: 'api-call', httpConfig: HTTP },
  { actionName: 'explicit_browser', description: 'explicit browser-steps', mutates: false, backingType: 'browser-steps', automationBinding: BINDING },
  { actionName: 'bash_unbound', description: 'explicit bash-cli, no binding', mutates: false, backingType: 'bash-cli' },
  { actionName: 'bash_bound', description: 'explicit bash-cli, materialised', mutates: false, backingType: 'bash-cli', automationBinding: BINDING },
  { actionName: 'bad_api', description: 'api-call without httpConfig', mutates: false, backingType: 'api-call' },
  { actionName: 'bad_browser', description: 'browser-steps without a binding', mutates: false, backingType: 'browser-steps', httpConfig: HTTP },
  { actionName: 'bad_bash', description: 'bash-cli carrying an httpConfig', mutates: false, backingType: 'bash-cli', httpConfig: HTTP },
  { actionName: 'bad_unknown', description: 'a backing this version does not implement', mutates: false, backingType: 'mcp-call', httpConfig: HTTP },
];

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { forEach: (cb: (v: string, k: string) => void) => void };
  text: () => Promise<string>;
}
function okResponse(body: string): FakeResponse {
  return { ok: true, status: 200, statusText: '', headers: { forEach: () => undefined }, text: async () => body };
}
/** A transport that records every call — so "no HTTP happened" is assertable, not assumed. */
function recordingFetch(): { fn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    return okResponse(JSON.stringify({ ok: true })) as unknown as Response;
  };
  return { fn, calls };
}
/** The automation seam, recording — so "reached the seam" is assertable too. */
function recordingSeam(): { fn: AutomationBackedHandler; calls: Array<{ binding: unknown; args: Record<string, unknown> }> } {
  const calls: Array<{ binding: unknown; args: Record<string, unknown> }> = [];
  const fn: AutomationBackedHandler = async ({ binding, args }) => {
    calls.push({ binding, args });
    return { success: true, data: { viaSeam: true } };
  };
  return { fn, calls };
}

/** A minimal action literal for the pure-resolver table. */
const act = (over: Partial<IntegrationAction>): IntegrationAction =>
  ({ actionName: 'a', description: 'd', mutates: false, ...over }) as IntegrationAction;

const run = (actionName: string, d: Parameters<typeof executeUserIntegrationAction>[1] = {}, userId = 'u1') =>
  executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: userId, integrationKey: KEY, actionName, args: {} }, d);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = ['test', 'encryption', 'key', '32', 'characters'].join('-');
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ekoa-backing-'));
  mkdirSync(join(fixtureRoot, KEY), { recursive: true });
  writeFileSync(
    join(fixtureRoot, KEY, 'config.json'),
    JSON.stringify({
      version: '1.0',
      integrationKey: KEY,
      displayName: 'Backing Co',
      authType: 'api_key',
      configSchema: [],
      actions: ACTIONS,
    }),
    'utf-8',
  );
  process.env.EKOA_INTEGRATIONS_DIR = fixtureRoot;
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_backing_type');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await integrationConfigs.deleteMany({});
  await createConfig(actor('u1'), { integrationKey: KEY, configValues: { api_key: API_KEY } }, deps);
});

describe('resolveBackingType: derivation when `backingType` is ABSENT', () => {
  it('an automationBinding derives browser-steps — including when an httpConfig is also present', () => {
    expect(resolveBackingType(act({ automationBinding: BINDING }))).toBe('browser-steps');
    // The historical precedence: a binding has always beaten an httpConfig on the same action.
    expect(resolveBackingType(act({ automationBinding: BINDING, httpConfig: HTTP }))).toBe('browser-steps');
  });

  it('an httpConfig alone derives api-call', () => {
    expect(resolveBackingType(act({ httpConfig: HTTP }))).toBe('api-call');
  });

  it('NEITHER shape derives api-call — the branch that has always refused it, unchanged', () => {
    expect(resolveBackingType(act({}))).toBe('api-call');
  });
});

describe('resolveBackingType: an EXPLICIT backingType', () => {
  it('is honoured when the shape supports it', () => {
    expect(resolveBackingType(act({ backingType: 'api-call', httpConfig: HTTP }))).toBe('api-call');
    expect(resolveBackingType(act({ backingType: 'browser-steps', automationBinding: BINDING }))).toBe('browser-steps');
    expect(resolveBackingType(act({ backingType: 'bash-cli' }))).toBe('bash-cli');
    expect(resolveBackingType(act({ backingType: 'bash-cli', automationBinding: BINDING }))).toBe('bash-cli');
  });

  it('OVERRIDES the derivation: an explicit api-call is not re-read as automation-backed', () => {
    expect(resolveBackingType(act({ backingType: 'api-call', httpConfig: HTTP, automationBinding: BINDING }))).toBe('api-call');
  });

  it('REFUSES a value that contradicts the shape, rather than guessing around it', () => {
    const cases: Array<[string, Partial<IntegrationAction>]> = [
      ['api-call', { backingType: 'api-call' }],
      ['browser-steps', { backingType: 'browser-steps', httpConfig: HTTP }],
      ['bash-cli', { backingType: 'bash-cli', httpConfig: HTTP }],
    ];
    for (const [declared, shape] of cases) {
      let thrown: unknown;
      try {
        resolveBackingType(act({ actionName: 'x', ...shape }));
      } catch (err) {
        thrown = err;
      }
      expect(thrown, declared).toBeInstanceOf(IntegrationActionBackingTypeError);
      expect((thrown as IntegrationActionBackingTypeError).declaredBackingType, declared).toBe(declared);
      expect((thrown as IntegrationActionBackingTypeError).actionName, declared).toBe('x');
    }
  });

  it('REFUSES a backing outside the union (an unvalidated config.json can carry one)', () => {
    // `config.json` is parsed, not schema-validated, so the field can hold anything on disk.
    const rogue = act({ httpConfig: HTTP });
    (rogue as { backingType?: string }).backingType = 'mcp-call';
    expect(() => resolveBackingType(rogue)).toThrow(IntegrationActionBackingTypeError);
  });
});

describe('executeUserIntegrationAction: dispatch on the resolved backing', () => {
  it('an api-call action still executes HTTP — derived and explicit alike', async () => {
    for (const name of ['derived_api', 'explicit_api']) {
      const http = recordingFetch();
      const seam = recordingSeam();
      const res = await run(name, { fetchImpl: http.fn, runAutomationBackedAction: seam.fn });
      expect(res.success, name).toBe(true);
      expect(res.status, name).toBe(200);
      expect(http.calls, name).toEqual(['https://api.backing.example/things']);
      expect(seam.calls, name).toHaveLength(0);
    }
  });

  it('a browser-steps action still reaches the automation seam — derived and explicit alike', async () => {
    for (const name of ['derived_browser', 'derived_both', 'explicit_browser']) {
      const http = recordingFetch();
      const seam = recordingSeam();
      const res = await run(name, { fetchImpl: http.fn, runAutomationBackedAction: seam.fn });
      expect(res.success, name).toBe(true);
      expect(res.data, name).toEqual({ viaSeam: true });
      expect(seam.calls, name).toHaveLength(1);
      expect(seam.calls[0]?.binding, name).toMatchObject({ automationId: 'auto-1' });
      expect(http.calls, name).toHaveLength(0); // `derived_both` carries an httpConfig; it is NOT called
    }
  });

  it('a browser-steps action without the seam still fails with the unchanged automation_required', async () => {
    const res = await run('derived_browser');
    expect(res.success).toBe(false);
    expect(res.code).toBe('automation_required');
  });

  it('a bash-cli action WITHOUT a binding is refused with unsupported_backing_type', async () => {
    const http = recordingFetch();
    const seam = recordingSeam();
    const res = await run('bash_unbound', { fetchImpl: http.fn, runAutomationBackedAction: seam.fn });
    expect(res.success).toBe(false);
    expect(res.code).toBe('unsupported_backing_type');
    expect(res.error).toMatch(/paired machine/);
    // Nothing ran: no HTTP call, and no attempt to smuggle it through the automation seam.
    expect(http.calls).toHaveLength(0);
    expect(seam.calls).toHaveLength(0);
  });

  it('…and is refused BEFORE credentials are involved (an unconnected owner gets the same code)', async () => {
    // The owner has no config row at all: without the gate this would be `not_connected`, i.e. the
    // refusal would have been decided after the credential lookup.
    const res = await run('bash_unbound', {}, 'u-nao-ligado');
    expect(res.code).toBe('unsupported_backing_type');
  });

  it('a bash-cli action WITH a binding runs through the same automation seam', async () => {
    const seam = recordingSeam();
    const res = await run('bash_bound', { runAutomationBackedAction: seam.fn });
    expect(res.success).toBe(true);
    expect(seam.calls).toHaveLength(1);
    expect(seam.calls[0]?.binding).toMatchObject({ automationId: 'auto-1' });
  });

  it('a backingType contradicting the action shape is refused with invalid_backing_type', async () => {
    for (const name of ['bad_api', 'bad_browser', 'bad_bash', 'bad_unknown']) {
      const http = recordingFetch();
      const seam = recordingSeam();
      const res = await run(name, { fetchImpl: http.fn, runAutomationBackedAction: seam.fn });
      expect(res.success, name).toBe(false);
      expect(res.code, name).toBe('invalid_backing_type');
      expect(res.error, name).toContain(name);
      expect(http.calls, name).toHaveLength(0);
      expect(seam.calls, name).toHaveLength(0);
    }
  });

  it('an action with NEITHER shape keeps its existing code and message, byte for byte', async () => {
    const res = await run('no_shape');
    expect(res.success).toBe(false);
    expect(res.code).toBe('unsupported_auth_type');
    expect(res.error).toBe('action "no_shape" has no httpConfig — only HTTP-backed actions are executable');
  });
});
