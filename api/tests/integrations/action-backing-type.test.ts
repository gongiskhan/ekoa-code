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
  type TenantReadHandler,
} from '../../src/integrations/action-executor.js';
import { actionShape } from '../../src/integrations/action-consent.js';

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
const DATASET = 'backing.rows';
const FL = {
  loginUrl: 'https://portal.example/login',
  usernameField: 'ctl00$u',
  passwordField: 'ctl00$p',
  usernameConfigKey: 'login_username',
  passwordConfigKey: 'login_password',
  targetUrl: 'https://portal.example/inbox',
} as const;

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
  // ── SLICE S9: the `tenant-read` backing ────────────────────────────────────────────────────
  { actionName: 'derived_tenant', description: 'tenantRead, no backingType', mutates: false, tenantRead: { dataset: DATASET } },
  { actionName: 'explicit_tenant', description: 'explicit tenant-read', mutates: false, backingType: 'tenant-read', tenantRead: { dataset: DATASET } },
  { actionName: 'tenant_bound', description: 'tenantRead AND a binding, no backingType', mutates: false, tenantRead: { dataset: DATASET }, automationBinding: BINDING },
  { actionName: 'tenant_unknown_dataset', description: 'a dataset nothing binds', mutates: false, tenantRead: { dataset: 'nobody.binds.this' } },
  { actionName: 'tenant_write', description: 'a MUTATING tenant read', mutates: true, tenantRead: { dataset: DATASET } },
  { actionName: 'bad_tenant_no_dataset', description: 'tenant-read naming no dataset', mutates: false, backingType: 'tenant-read' },
  { actionName: 'bad_tenant_http', description: 'tenant-read carrying an httpConfig', mutates: false, backingType: 'tenant-read', tenantRead: { dataset: DATASET }, httpConfig: HTTP },
  { actionName: 'bad_tenant_binding', description: 'tenant-read carrying a binding', mutates: false, backingType: 'tenant-read', tenantRead: { dataset: DATASET }, automationBinding: BINDING },
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

/** The tenant-read seam, recording - so "reached the reader" and "with which scope" are both
 *  assertable. It answers for `DATASET` only, exactly as the real handler answers for its own. */
function recordingReader(): {
  fn: TenantReadHandler;
  calls: Array<{ dataset: string; orgId: string; ownerUserId: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ dataset: string; orgId: string; ownerUserId: string; args: Record<string, unknown> }> = [];
  const fn: TenantReadHandler = async ({ dataset, orgId, ownerUserId, args }) => {
    calls.push({ dataset, orgId, ownerUserId, args });
    if (dataset !== DATASET) return { success: false, code: 'unknown_dataset', error: `no reader for "${dataset}"` };
    return { success: true, data: { rows: [{ id: 1 }] } };
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

describe('resolveBackingType: the form-login backing (D-FORM-LOGIN)', () => {
  it('resolves when the action carries a complete formLogin descriptor', () => {
    expect(resolveBackingType(act({ backingType: 'form-login', formLogin: FL }))).toBe('form-login');
  });
  it('refuses an incomplete descriptor or a shape it contradicts', () => {
    const cases: Array<Partial<IntegrationAction>> = [
      { backingType: 'form-login' }, // no descriptor at all
      { backingType: 'form-login', formLogin: { ...FL, usernameField: '' } }, // a field missing
      { backingType: 'form-login', formLogin: FL, httpConfig: HTTP }, // a form-login has no single request
      { backingType: 'form-login', formLogin: FL, automationBinding: BINDING }, // no browser steps
      { backingType: 'form-login', formLogin: FL, tenantRead: { dataset: DATASET } }, // contacts the portal
    ];
    for (const shape of cases) {
      expect(() => resolveBackingType(act({ actionName: 'x', ...shape }))).toThrow(IntegrationActionBackingTypeError);
    }
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
/**
 * C1 REVIEW RESPONSE — the contradiction rule is applied SYMMETRICALLY.
 * bash-cli + httpConfig was refused while browser-steps + httpConfig passed silently, leaving dead
 * request config on an action nothing would ever dial. A shape the backing cannot use is a package
 * defect whichever backing declares it.
 */
describe('C1 review — a browser-steps action may not carry dead httpConfig', () => {
  it('refuses an explicit browser-steps action that also declares an httpConfig', () => {
    expect(() =>
      resolveBackingType({
        actionName: 'contradictory',
        description: 'x',
        mutates: false,
        backingType: 'browser-steps',
        automationBinding: { automationId: 'a1' },
        httpConfig: { method: 'GET', baseUrl: 'https://example.test', path: '/' },
      }),
    ).toThrow(/also carries an httpConfig/);
  });

  it('still accepts a browser-steps action with only its binding, and DERIVES the same for both shapes', () => {
    const bindingOnly = { actionName: 'ok', description: 'x', mutates: false, backingType: 'browser-steps' as const, automationBinding: { automationId: 'a1' } };
    expect(resolveBackingType(bindingOnly)).toBe('browser-steps');
    // Derivation (no explicit backingType) is UNCHANGED for the both-shapes action — the binding
    // still wins, exactly as before C1. Only an EXPLICIT declaration is held to the stricter rule.
    const both = { actionName: 'both', description: 'x', mutates: false, automationBinding: { automationId: 'a1' }, httpConfig: { method: 'GET' as const, baseUrl: 'https://example.test', path: '/' } };
    expect(resolveBackingType(both)).toBe('browser-steps');
  });
});

/**
 * SLICE S9 - THE `tenant-read` BACKING.
 *
 * The fourth backing, and the only one that contacts nothing: the answer is read out of data this
 * platform already holds for the asking tenant. Three properties are load-bearing and each has its
 * own case below.
 *
 *  1. IT IS ADDITIVE. Every action shipped before S9 derives the backing it derived before, and -
 *     the half that is easy to miss - keeps the same `actionShape` fingerprint, because that string
 *     is durable state: it is stored on every standing approval and on every authored action's
 *     `authoring.shape`. Re-hashing it would silently unmatch approvals people had already given
 *     and demote every `trusted` action to `provisional`.
 *  2. IT NEVER CAUSES A CREDENTIAL TO BE DECRYPTED. Proved BEHAVIOURALLY rather than by reading the
 *     source: the owner's stored ciphertext is corrupted, so any path that decrypts answers
 *     `credential_decrypt_failed`. The tenant read succeeds anyway; the api-call action on the same
 *     corrupted config does not. Move the dispatch below the decrypt and this reddens.
 *  3. IT IS NOT ABOVE THE WRITE GATE. A read costs no secret; that is not a reason to skip a gate.
 *     A MUTATING tenant-read action still answers `awaiting_consent`, and the reader is never
 *     called.
 */
describe('S9 - resolveBackingType and the tenant-read backing', () => {
  it('a tenantRead alone DERIVES tenant-read; a binding still wins over it', () => {
    expect(resolveBackingType(act({ tenantRead: { dataset: DATASET } }))).toBe('tenant-read');
    // The historical precedence is untouched: the binding is the more specific shape and still wins,
    // so no action that already carried one changes meaning by a tenantRead appearing beside it.
    expect(resolveBackingType(act({ tenantRead: { dataset: DATASET }, automationBinding: BINDING }))).toBe('browser-steps');
    // And an action with none of the three shapes still derives api-call, byte for byte as before.
    expect(resolveBackingType(act({}))).toBe('api-call');
  });

  it('an EXPLICIT tenant-read is honoured, and refuses every shape it cannot use', () => {
    expect(resolveBackingType(act({ backingType: 'tenant-read', tenantRead: { dataset: DATASET } }))).toBe('tenant-read');
    const cases: Array<[string, Partial<IntegrationAction>]> = [
      ['no dataset', { backingType: 'tenant-read' }],
      ['empty dataset', { backingType: 'tenant-read', tenantRead: { dataset: '' } }],
      ['dead httpConfig', { backingType: 'tenant-read', tenantRead: { dataset: DATASET }, httpConfig: HTTP }],
      ['dead binding', { backingType: 'tenant-read', tenantRead: { dataset: DATASET }, automationBinding: BINDING }],
    ];
    for (const [label, shape] of cases) {
      expect(() => resolveBackingType(act({ actionName: 'x', ...shape })), label).toThrow(IntegrationActionBackingTypeError);
    }
  });

  it('actionShape is UNCHANGED for every action that declares no tenantRead', () => {
    // The additive promise, as a LITERAL rather than a sentence. This hex was computed against the
    // pre-S9 six-element tuple; it is what a standing approval row and an `authoring.shape` written
    // before this slice actually contain. An unconditional seventh term in the tuple moves it - and
    // would silently unmatch every approval a person had already given and demote every `trusted`
    // action to `provisional`, because `authoringStateOf` compares stored against recomputed.
    const httpOnly = act({ actionName: 'n', httpConfig: HTTP });
    expect(actionShape('k', httpOnly)).toBe('0870edaba87bb0152447b773d83cc7bf');
    const withUndefined = act({ actionName: 'n', httpConfig: HTTP, tenantRead: undefined });
    expect(actionShape('k', withUndefined)).toBe(actionShape('k', httpOnly));
    // …and a tenant-read action's fingerprint DOES move with its dataset: repointing an action at
    // different data is a different action, and a standing approval must not carry over.
    const a = act({ actionName: 'n', tenantRead: { dataset: 'one' } });
    const b = act({ actionName: 'n', tenantRead: { dataset: 'two' } });
    expect(actionShape('k', a)).not.toBe(actionShape('k', b));
    expect(actionShape('k', a)).not.toBe(actionShape('k', httpOnly));
  });
});

describe('S9 - executeUserIntegrationAction dispatches a tenant read', () => {
  it('reaches the reader with the EXECUTOR\'s own tenancy terms, and nothing else', async () => {
    for (const name of ['derived_tenant', 'explicit_tenant']) {
      const http = recordingFetch();
      const seam = recordingSeam();
      const reader = recordingReader();
      const res = await executeUserIntegrationAction(
        { orgId: 'orgA', ownerUserId: 'u1', integrationKey: KEY, actionName: name, args: { desde: '2026-01-01' } },
        { fetchImpl: http.fn, runAutomationBackedAction: seam.fn, readTenantDataset: reader.fn },
      );
      expect(res.success, name).toBe(true);
      expect(res.data, name).toEqual({ rows: [{ id: 1 }] });
      expect(reader.calls, name).toHaveLength(1);
      // Rule 5: the scope is the pair the executor resolved and gated, handed down verbatim.
      expect(reader.calls[0], name).toMatchObject({ dataset: DATASET, orgId: 'orgA', ownerUserId: 'u1' });
      // `args` is the caller's request shape and reaches the reader; it is never a scope.
      expect(reader.calls[0]?.args, name).toEqual({ desde: '2026-01-01' });
      // Nothing was contacted, by either of the two rails that can contact something.
      expect(http.calls, name).toHaveLength(0);
      expect(seam.calls, name).toHaveLength(0);
    }
  });

  it('a tenantRead beside a BINDING still runs the automation, not the reader', async () => {
    const reader = recordingReader();
    const seam = recordingSeam();
    const res = await run('tenant_bound', { runAutomationBackedAction: seam.fn, readTenantDataset: reader.fn });
    expect(res.success).toBe(true);
    expect(seam.calls).toHaveLength(1);
    expect(reader.calls).toHaveLength(0);
  });

  it('NEVER decrypts a credential - proved against a corrupted one', async () => {
    // Corrupt the owner's stored bundle. Everything above the decrypt is unaffected; everything at
    // or below it now fails with a distinctive code.
    const rows = await integrationConfigs.find({ ownerUserId: 'u1' });
    for (const row of rows) {
      await integrationConfigs.update(row._id as string, (cur) => ({ ...cur, credentialsCiphertext: 'not-a-ciphertext' }));
    }

    // The CONTROL: an ordinary api-call action on the very same config row cannot run.
    const control = await run('derived_api', { fetchImpl: recordingFetch().fn });
    expect(control.success).toBe(false);
    expect(control.code).toBe('credential_decrypt_failed');

    // The tenant read answers anyway, because the decrypt is not merely unused - it is unreached.
    const reader = recordingReader();
    const res = await run('derived_tenant', { readTenantDataset: reader.fn });
    expect(res.success).toBe(true);
    expect(reader.calls).toHaveLength(1);
  });

  it('is REFUSED when the deployment binds no readers at all', async () => {
    const http = recordingFetch();
    const seam = recordingSeam();
    const res = await run('derived_tenant', { fetchImpl: http.fn, runAutomationBackedAction: seam.fn });
    expect(res.success).toBe(false);
    expect(res.code).toBe('unsupported_backing_type');
    expect(res.error).toMatch(/binds no dataset readers/);
    // It does NOT fall through to the api-call branch's message, which would tell a reader to add
    // an httpConfig to an action that must never have one.
    expect(res.error).not.toMatch(/httpConfig/);
    expect(http.calls).toHaveLength(0);
    expect(seam.calls).toHaveLength(0);
  });

  it('…and that refusal lands BEFORE any credential is involved', async () => {
    // No config row for this owner: without the gate's position this would be `not_connected`.
    const res = await executeUserIntegrationAction(
      { orgId: 'orgA', ownerUserId: 'u-sem-ligacao', integrationKey: KEY, actionName: 'derived_tenant', args: {} },
      {},
    );
    expect(res.code).toBe('unsupported_backing_type');
  });

  it('surfaces the reader\'s own unknown_dataset rather than inventing an answer', async () => {
    const reader = recordingReader();
    const res = await run('tenant_unknown_dataset', { readTenantDataset: reader.fn });
    expect(res.success).toBe(false);
    expect(res.code).toBe('unknown_dataset');
    // The refusal is the READER's: it was asked, and it said no. An executor that silently answered
    // an empty list here would read, to a lawyer, as "you have no processes".
    expect(reader.calls).toHaveLength(1);
    expect(res.data).toBeUndefined();
  });

  it('a MUTATING tenant-read action still meets the write gate, and the reader is never called', async () => {
    const reader = recordingReader();
    const res = await run('tenant_write', { readTenantDataset: reader.fn });
    expect(res.success).toBe(false);
    expect(res.code).toBe('awaiting_consent');
    expect(res.consentRequest).toBeTruthy();
    expect(reader.calls).toHaveLength(0);
  });

  it('a malformed tenant-read package is refused with invalid_backing_type, reader untouched', async () => {
    for (const name of ['bad_tenant_no_dataset', 'bad_tenant_http', 'bad_tenant_binding']) {
      const reader = recordingReader();
      const res = await run(name, { readTenantDataset: reader.fn });
      expect(res.success, name).toBe(false);
      expect(res.code, name).toBe('invalid_backing_type');
      expect(reader.calls, name).toHaveLength(0);
    }
  });
});
