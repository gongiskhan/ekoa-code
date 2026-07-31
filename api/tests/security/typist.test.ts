import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { mintCofreItem, issueGrant, CofreLockedError, CredentialOriginError } from '../../src/cofre/index.js';
import {
  typistLogin,
  TypistUnknownPattern,
  TypistNotSuppressed,
  TYPIST_SELECTORS,
  type TypistDeps,
} from '../../src/automation/typist.js';

/**
 * SECURITY SUITE — the typist, the ONE credential-touching browser capability (Cofre F-2).
 *
 * The properties that matter, each asserted separately: origin is checked BEFORE any unwrap; the
 * observation channels are suppressed and the fill is REFUSED if suppression cannot be confirmed;
 * the value goes in through out-of-band CDP key events and never through `fill()`; fill-and-submit
 * are one unit so read-back is impossible; an unknown form pauses for the relay rather than being
 * handed to the fixer to guess at.
 */
let mem: MongoMemoryServer;
const actor: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;
const SECRET = 'pw-TYPIST-TEST-0001';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_typist');
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

/** A page whose form shape is configurable, recording every interaction. */
function makePage(opts: { url?: string; hasPassword?: boolean; passwordAfterSubmit?: boolean } = {}) {
  const state = {
    typed: [] as string[],
    filled: [] as string[],
    clicked: [] as string[],
    pressed: [] as string[],
    cdpKeys: [] as string[],
    submitted: false,
  };
  let passwordPresent = opts.hasPassword !== false;

  const locator = (sel: string) => ({
    first: () => ({
      isVisible: async () => {
        if (TYPIST_SELECTORS.password.includes(sel as never)) return passwordPresent;
        return true;
      },
      focus: async () => undefined,
      fill: async (v: string) => {
        state.filled.push(v);
      },
      click: async () => {
        state.clicked.push(sel);
        state.submitted = true;
        if (!opts.passwordAfterSubmit) passwordPresent = false;
      },
      press: async (k: string) => {
        state.pressed.push(k);
        state.submitted = true;
        if (!opts.passwordAfterSubmit) passwordPresent = false;
      },
    }),
    isVisible: async () => true,
  });

  const cdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Input.dispatchKeyEvent' && params?.type === 'keyDown') {
        state.cdpKeys.push(String(params.text ?? ''));
      }
      return {};
    }),
    detach: vi.fn(async () => undefined),
  };

  const page = {
    url: () => opts.url ?? 'https://portal.example/login',
    locator,
    waitForLoadState: async () => undefined,
    context: () => ({ newCDPSession: async () => cdpSession }),
  };
  return { page: page as never, state };
}

function makeDeps(over: Partial<TypistDeps> = {}): TypistDeps & { began: number; resumed: number } {
  const rec = { began: 0, resumed: 0 };
  const deps: TypistDeps = {
    beginCredentialWindow: async () => {
      rec.began++;
      return async () => {
        rec.resumed++;
      };
    },
    isSuppressed: () => true,
    withCaptureSuppressed: async (fn) => fn(),
    ...over,
  };
  // Counters exposed as getters so a test can assert the window was opened AND resumed.
  return Object.defineProperties(deps, {
    began: { get: () => rec.began },
    resumed: { get: () => rec.resumed },
  }) as TypistDeps & { began: number; resumed: number };
}

async function grantedPassword() {
  const item = await mintCofreItem(actor, {
    type: 'password',
    label: 'Portal',
    value: SECRET,
    boundOrigins: ['portal.example'],
  });
  await issueGrant(actor, item._id, '10_minutes');
  return item;
}

const run = (page: unknown, item: { _id: string }, deps: TypistDeps, over: Record<string, unknown> = {}) =>
  typistLogin(
    {
      page: page as never,
      actor,
      traceId: 't1',
      runId: 'r1',
      credentialRef: `cofre:${item._id}`,
      ...over,
    },
    deps,
  );

describe('the typist fills through out-of-band input, never fill()', () => {
  it('types the value as CDP key events and never calls locator.fill()', async () => {
    const item = await grantedPassword();
    const { page, state } = makePage();
    const res = await run(page, item, makeDeps());
    expect(state.cdpKeys.join('')).toBe(SECRET);
    // fill() sets the DOM value directly, which is observable to any page script.
    expect(state.filled).toEqual([]);
    expect(res.itemId).toBe(item._id);
  });

  it('returns a registry pre-loaded with the value so the run can filter its streams', async () => {
    const item = await grantedPassword();
    const { page } = makePage();
    const res = await run(page, item, makeDeps());
    expect(res.secrets.redact(`echo ${SECRET}`)).not.toContain(SECRET);
  });

  it('submits in the SAME unit as the fill', async () => {
    const item = await grantedPassword();
    const { page, state } = makePage();
    const res = await run(page, item, makeDeps());
    expect(state.submitted).toBe(true);
    expect(res.submittedVia).toBe('button');
  });
});

describe('suppression is a precondition, not a courtesy', () => {
  it('opens a credential window and resumes it', async () => {
    const item = await grantedPassword();
    const { page } = makePage();
    const deps = makeDeps();
    await run(page, item, deps);
    expect(deps.began).toBe(1);
    expect(deps.resumed).toBe(1);
  });

  it('REFUSES to fill when suppression cannot be confirmed', async () => {
    const item = await grantedPassword();
    const { page, state } = makePage();
    await expect(run(page, item, makeDeps({ isSuppressed: () => false }))).rejects.toBeInstanceOf(
      TypistNotSuppressed,
    );
    // The decisive assertion: nothing was typed.
    expect(state.cdpKeys).toEqual([]);
  });

  it('resumes the stream even when the fill throws', async () => {
    const item = await grantedPassword();
    const { page } = makePage({ hasPassword: false });
    const deps = makeDeps();
    await expect(run(page, item, deps)).rejects.toBeInstanceOf(TypistUnknownPattern);
    expect(deps.resumed).toBe(1);
  });
});

describe('origin is checked BEFORE the unwrap (I6)', () => {
  it('REFUSES on a page outside the item bound origins', async () => {
    const item = await grantedPassword();
    const { page, state } = makePage({ url: 'https://attacker.example/login' });
    await expect(run(page, item, makeDeps())).rejects.toBeInstanceOf(CredentialOriginError);
    expect(state.cdpKeys).toEqual([]);
  });

  it('ALLOWS a subdomain of the bound origin', async () => {
    const item = await grantedPassword();
    const { page, state } = makePage({ url: 'https://login.portal.example/x' });
    await run(page, item, makeDeps());
    expect(state.cdpKeys.join('')).toBe(SECRET);
  });
});

describe('the Cofre lock applies to the typist like any other consumer', () => {
  it('REFUSES when the item has no active grant', async () => {
    const item = await mintCofreItem(actor, {
      type: 'password',
      label: 'ungranted',
      value: SECRET,
      boundOrigins: ['portal.example'],
    });
    const { page, state } = makePage();
    await expect(run(page, item, makeDeps())).rejects.toBeInstanceOf(CofreLockedError);
    expect(state.cdpKeys).toEqual([]);
  });
});

describe('unknown patterns fail to the relay, never to improvisation', () => {
  it('pauses when there is no password field', async () => {
    const item = await grantedPassword();
    const { page } = makePage({ hasPassword: false });
    await expect(run(page, item, makeDeps())).rejects.toBeInstanceOf(TypistUnknownPattern);
  });

  it('pauses when a password field REMAINS after submit (login did not take)', async () => {
    const item = await grantedPassword();
    const { page } = makePage({ passwordAfterSubmit: true });
    await expect(run(page, item, makeDeps())).rejects.toThrow(/still present after submit/);
  });

  it('REFUSES a raw value in place of a reference', async () => {
    const { page } = makePage();
    await expect(
      typistLogin(
        { page: page as never, actor, traceId: 't1', runId: 'r1', credentialRef: SECRET },
        makeDeps(),
      ),
    ).rejects.toBeInstanceOf(TypistUnknownPattern);
  });
});

describe('the selector vocabulary is fixed DATA (I5)', () => {
  it('carries selectors only — nothing that could be executable', () => {
    const all = [...TYPIST_SELECTORS.username, ...TYPIST_SELECTORS.password, ...TYPIST_SELECTORS.submit];
    for (const sel of all) {
      expect(sel).not.toMatch(/javascript:|function|=>|\beval\b/);
    }
    expect(TYPIST_SELECTORS.password).toContain('input[type="password"]');
  });
});
