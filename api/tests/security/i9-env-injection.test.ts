import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { mintCofreItem, issueGrant } from '../../src/cofre/index.js';
import { resolveEnvInjection, EnvInjectionError } from '../../src/cofre/process-injection.js';
import { CofreLockedError, CofreNotFoundError } from '../../src/cofre/service.js';

/**
 * SECURITY SUITE — the I9 environment-injection primitive (Cofre WS-J / J-4).
 *
 * I9: non-browser secret delivery goes only through a fixed Cortex primitive; command strings and
 * any model-authored step content may carry the reference NAME, never a value.
 *
 * The channel this replaces was the exact inverse: `envWhitelist` was a list of variable NAMES
 * accepted FROM THE PLANNER and resolved against the CORTEX SERVER's own `process.env` — so
 * `envWhitelist: ["JWT_SECRET"]` was a platform compromise expressed as an ordinary step field.
 */
let mem: MongoMemoryServer;
const actor: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;
const SECRET = 'db-token-I9-TEST-0001';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_i9');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
});

async function grantedItem(value = SECRET) {
  const item = await mintCofreItem(actor, {
    type: 'api_key',
    label: 'DB token',
    value,
    boundOrigins: ['db.internal.example'],
  });
  await issueGrant(actor, item._id, '1_day');
  return item;
}

describe('resolveEnvInjection — the value reaches the CHILD ENV and nothing else', () => {
  it('injects the resolved value under the declared name', async () => {
    const item = await grantedItem();
    const out = await resolveEnvInjection(actor, { DB_TOKEN: `cofre:${item._id}` }, { processLabel: 'bash' });
    expect(out.env.DB_TOKEN).toBe(SECRET);
    expect(out.itemIds).toEqual([item._id]);
  });

  it('hands back a registry pre-loaded with the injected values, so output can be filtered', async () => {
    const item = await grantedItem();
    const out = await resolveEnvInjection(actor, { DB_TOKEN: `cofre:${item._id}` }, { processLabel: 'bash' });
    // I9's second half: a secret-bearing process whose output is not filtered fails the invariant.
    expect(out.secrets.redact(`echoed ${SECRET} here`)).not.toContain(SECRET);
    expect(out.secrets.size).toBe(1);
  });

  it('REFUSES a raw value in place of a reference — the I9 line', async () => {
    await expect(
      resolveEnvInjection(actor, { DB_TOKEN: SECRET }, { processLabel: 'bash' }),
    ).rejects.toBeInstanceOf(EnvInjectionError);
  });

  it.each([
    ['a provider key', 'sk-live-abcdef'],
    ['a bare word', 'hunter2'],
    ['a near-miss prefix', 'cofre-itm_abc'],
    ['an empty string', ''],
  ])('REFUSES %s as a binding', async (_label, value) => {
    await expect(resolveEnvInjection(actor, { X: value }, { processLabel: 'bash' })).rejects.toBeInstanceOf(
      EnvInjectionError,
    );
  });
});

describe('the grant/lock applies exactly as it does to a browser fill', () => {
  it('REFUSES when the item has no active grant', async () => {
    const item = await mintCofreItem(actor, {
      type: 'api_key',
      label: 'ungranted',
      value: SECRET,
      boundOrigins: ['db.internal.example'],
    });
    await expect(
      resolveEnvInjection(actor, { DB_TOKEN: `cofre:${item._id}` }, { processLabel: 'bash' }),
    ).rejects.toBeInstanceOf(CofreLockedError);
  });

  it('REFUSES another user (tenancy runs through the same seam)', async () => {
    const item = await grantedItem();
    const bob: Actor = { userId: 'bob', orgId: 'orgA', role: 'user' } as Actor;
    await expect(
      resolveEnvInjection(bob, { DB_TOKEN: `cofre:${item._id}` }, { processLabel: 'bash' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
  });

  it('REFUSES a reference to an item that does not exist', async () => {
    await expect(
      resolveEnvInjection(actor, { DB_TOKEN: 'cofre:itm_nope' }, { processLabel: 'bash' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
  });
});

describe('the injection TARGET is constrained', () => {
  it.each([
    'PATH',
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'NODE_OPTIONS',
    'PYTHONPATH',
    'BASH_ENV',
    'IFS',
    'HTTPS_PROXY',
    'https_proxy',
  ])('REFUSES injecting into %s (it would become code execution or re-routing)', async (name) => {
    const item = await grantedItem();
    await expect(
      resolveEnvInjection(actor, { [name]: `cofre:${item._id}` }, { processLabel: 'bash' }),
    ).rejects.toThrow(/refusing to inject into/);
  });

  it.each(['', '1BAD', 'has-dash', 'has space', 'a;b', 'a=b', '../x'])(
    'REFUSES the malformed env name %j',
    async (name) => {
      const item = await grantedItem();
      await expect(
        resolveEnvInjection(actor, { [name]: `cofre:${item._id}` }, { processLabel: 'bash' }),
      ).rejects.toThrow(/invalid environment variable name/);
    },
  );

  it('ALLOWS ordinary names', async () => {
    const item = await grantedItem();
    const out = await resolveEnvInjection(actor, { _MY_TOKEN2: `cofre:${item._id}` }, { processLabel: 'bash' });
    expect(out.env._MY_TOKEN2).toBe(SECRET);
  });
});

describe('failure is never a PARTIAL environment', () => {
  it('a bad second binding refuses the whole injection', async () => {
    const ok = await grantedItem();
    await expect(
      resolveEnvInjection(
        actor,
        { GOOD: `cofre:${ok._id}`, BAD: 'a-raw-secret' },
        { processLabel: 'bash' },
      ),
    ).rejects.toBeInstanceOf(EnvInjectionError);
    // A child that starts with SOME of its credentials is a silent misauthentication.
  });
});

describe('envWhitelist is GONE (it read the Cortex server\'s own process.env)', () => {
  it('the step type no longer carries it, and the planner no longer accepts it', async () => {
    const [{ default: fs }] = await Promise.all([import('node:fs')]);
    const types = fs.readFileSync(new URL('../../src/automation/types.ts', import.meta.url), 'utf8');
    const planner = fs.readFileSync(new URL('../../src/automation/planner.ts', import.meta.url), 'utf8');
    const localCmd = fs.readFileSync(
      new URL('../../src/automation/executors/local-command.ts', import.meta.url),
      'utf8',
    );
    // Assert the DECLARATION and the USES are gone, not the word — the deletion is documented in
    // place, so the identifier still appears in a comment explaining why it must never come back.
    expect(types).not.toMatch(/^\s*envWhitelist\??:/m);
    expect(planner).not.toMatch(/^\s*envWhitelist:/m);
    expect(localCmd).not.toMatch(/buildEnv\s*\(/);
    // And nothing reads the Cortex server's own environment to build a child env.
    expect(localCmd).not.toMatch(/process\.env\[/);
  });
});
