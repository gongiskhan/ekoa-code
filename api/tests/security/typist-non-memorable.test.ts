import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { memories, activityLogs } from '../../src/data/stores.js';
import { mintCofreItem, issueGrant } from '../../src/cofre/index.js';
import { typistLogin, type TypistDeps } from '../../src/automation/typist.js';
import { __resetRecipeRegistryForTests } from '../../src/automation/login-recipes.js';

/**
 * SECURITY SUITE — a typist login is NON-MEMORABLE (Cofre F-5), and its recipe comes from the
 * registry (F-3 wiring).
 *
 * WHY PIN THIS NOW. `typistLogin` has no engine call site yet, so "writes zero memory rows" is
 * currently true by accident of not being wired. That is exactly when it is worth nailing down:
 * the moment the typist is reachable, whatever caches browser actions will be a step away from
 * recording the login sequence — and R-5 already showed what that costs, with `summariseAction`
 * putting the first 40 chars of a fill into a memory row that was then term-scored against the
 * user's ordinary chat prompt.
 *
 * The assertion is deliberately blunt: after a successful login, `memories` is EMPTY. Not "contains
 * no secret" — empty. A row that merely omits the value still records that this user logs into this
 * portal, and organisational memory is the wrong place for that.
 */
let mem: MongoMemoryServer;
const actor: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;
const SECRET = 'pw-F5-NONMEMORABLE-0001';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_f5');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  await memories.deleteMany({});
  await activityLogs.deleteMany({});
  __resetRecipeRegistryForTests();
});

/** A page on a host the SHIPPED registry covers, so the recipe path is the one under test. */
function makePage(url: string) {
  const seen = { selectors: [] as string[], cdpKeys: [] as string[] };
  let passwordPresent = true;
  const locator = (sel: string) => {
    seen.selectors.push(sel);
    return {
      first: () => ({
        isVisible: async () => (/pwd|password/i.test(sel) ? passwordPresent : true),
        focus: async () => undefined,
        fill: async () => undefined,
        click: async () => {
          passwordPresent = false;
        },
        press: async () => {
          passwordPresent = false;
        },
      }),
      isVisible: async () => true,
    };
  };
  const cdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Input.dispatchKeyEvent' && params?.type === 'keyDown') seen.cdpKeys.push(String(params.text ?? ''));
      return {};
    }),
    detach: vi.fn(async () => undefined),
  };
  const page = {
    url: () => url,
    locator,
    waitForLoadState: async () => undefined,
    context: () => ({ newCDPSession: async () => cdpSession }),
  };
  return { page: page as never, seen };
}

const deps = (): TypistDeps => ({
  beginCredentialWindow: async () => async () => undefined,
  isSuppressed: () => true,
  withCaptureSuppressed: async (fn) => fn(),
});

async function grantedFor(host: string) {
  const item = await mintCofreItem(actor, { type: 'password', label: 'Portal', value: SECRET, boundOrigins: [host] });
  await issueGrant(actor, item._id, '10_minutes');
  return item;
}

describe('F-5: a typist login writes ZERO memory rows', () => {
  it('the login succeeds and organisational memory stays empty', async () => {
    const item = await grantedFor('webmail.oa.pt');
    const { page } = makePage('https://webmail.oa.pt/login');

    const res = await typistLogin(
      { page, actor, traceId: 't1', runId: 'r1', credentialRef: `cofre:${item._id}` },
      deps(),
    );
    expect(res.itemId).toBe(item._id);

    // Blunt on purpose: EMPTY, not "contains no secret". A row that omits the value still records
    // that this user logs into this portal.
    expect(await memories.find({})).toHaveLength(0);
  });

  it('the USE is still recorded on the item — auditability is not what F-5 removes', async () => {
    // The distinction worth keeping: use tracking is required, a term-scored memory row injected
    // into a chat prompt is not. The typist records the use on the ITEM (lastUsedAt/lastUsedBy),
    // metadata only.
    const item = await grantedFor('webmail.oa.pt');
    const { page } = makePage('https://webmail.oa.pt/login');
    await typistLogin({ page, actor, traceId: 't1', runId: 'r1', credentialRef: `cofre:${item._id}` }, deps());

    const { cofreItems } = await import('../../src/cofre/store.js');
    const stored = (await cofreItems.raw.get(item._id)) as unknown as Record<string, unknown>;
    expect(stored.lastUsedAt).toBeTruthy();
    expect(String(stored.lastUsedBy)).toContain('typist:');
    // …and neither the item row nor anything else carries the value in cleartext.
    expect(JSON.stringify(stored)).not.toContain(SECRET);

    // GAP, asserted so it is visible rather than assumed: the typist does NOT emit a
    // `cofre_item_used` Registo row, though the A-6 vocabulary defines one. Recorded in
    // docs/findings.md as `typist-emits-no-registo-row`; flip this to a positive assertion when it
    // does.
    expect(await activityLogs.find({})).toHaveLength(0);
  });
});

describe('F-3 wiring: the typist takes its selectors from the registry', () => {
  it('uses the SHIPPED recipe for a covered host', async () => {
    const item = await grantedFor('webmail.oa.pt');
    const { page, seen } = makePage('https://webmail.oa.pt/login');
    await typistLogin({ page, actor, traceId: 't1', runId: 'r1', credentialRef: `cofre:${item._id}` }, deps());

    // The Roundcube id from api/assets/login-recipes/recipes.json — proof the registry was
    // consulted rather than the generic selector list.
    expect(seen.selectors.join(' ')).toContain('#rcmloginpwd');
  });

  it('falls back to the generic selectors on an UNKNOWN host — no recipe, no improvisation', async () => {
    const item = await grantedFor('unknown-portal.example');
    const { page, seen } = makePage('https://unknown-portal.example/login');
    await typistLogin({ page, actor, traceId: 't1', runId: 'r1', credentialRef: `cofre:${item._id}` }, deps());

    expect(seen.selectors.join(' ')).not.toContain('#rcmloginpwd');
    expect(seen.selectors.join(' ')).toMatch(/password/i);
    expect(await memories.find({})).toHaveLength(0);
  });
});
