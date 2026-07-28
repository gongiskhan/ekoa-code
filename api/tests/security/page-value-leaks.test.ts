import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { memories } from '../../src/data/stores.js';
import { createMemory, resolveMemoryInjectionDetailed } from '../../src/memory/index.js';
import { writeActionCache } from '../../src/automation/cache.js';
import { SECRET_SHAPED_INPUT_NAME } from '../../src/automation/engine.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { PageFingerprint, PlaywrightAction } from '../../src/automation/types.js';

/**
 * SECURITY SUITE — page-derived values must not reach the model (Cofre R-5; invariants I1, I3).
 *
 * The automation action cache writes rows derived from LIVE PAGE interactions through the ordinary
 * organizational-memory surface. `isInjectable` excluded only `tier:'archive'`, so those rows were
 * term-scored against the user's ordinary chat prompt and injected under `# Memória` — a magic-link
 * or SSO-callback URL captured by a `navigate` was replayed verbatim to the chat model.
 */
const deps = { now: () => 1_700_000_000_000, genId: () => `m-${Math.floor(Math.random() * 1e9)}` };
const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' } as Actor;

const fingerprint = (): PageFingerprint => ({
  origin: 'https://portal.example',
  pathname: '/login',
  pathSuffix: 'login',
  titleHash: 'h-title',
  headingHash: 'h-heading',
  domShapeHash: 'h-shape',
  viewport: { w: 1440, h: 900 },
});

describe('nonMemorable excludes page-derived rows from model injection (I3)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_sec_pagevalues'));
  afterAll(shutdownAgentTestDb);
  beforeEach(() => resetAgentState());
  afterEach(async () => {
    restoreTransport();
    await memories.deleteMany({});
  });

  it('injects an ordinary memory on term overlap', async () => {
    await createMemory(actor, { title: 'fee tier', content: 'the client fee tier is premium', type: 'fact' }, deps);
    const out = await resolveMemoryInjectionDetailed(actor, 'what is the client fee tier', deps);
    expect(out.memoriesUsed).toBe(1);
    expect(out.text).toContain('premium');
  });

  it('does NOT inject a nonMemorable row even on a perfect term match', async () => {
    await createMemory(
      actor,
      { title: 'portal login', content: 'portal login magic token abcxyz', type: 'fact', nonMemorable: true },
      deps,
    );
    const out = await resolveMemoryInjectionDetailed(actor, 'portal login magic token', deps);
    expect(out.memoriesUsed).toBe(0);
    expect(out.text).toBe('');
  });

  it('excludes a nonMemorable row even at core tier (which is otherwise always injected)', async () => {
    await createMemory(
      actor,
      { title: 'x', content: 'core secret material', type: 'fact', tier: 'core', nonMemorable: true },
      deps,
    );
    const out = await resolveMemoryInjectionDetailed(actor, 'anything at all', deps);
    expect(out.memoriesUsed).toBe(0);
  });

  it('injects the ordinary row and withholds the cache row from the same query', async () => {
    await createMemory(actor, { title: 'portal', content: 'the portal login page is at OA', type: 'fact' }, deps);
    await createMemory(
      actor,
      { title: 'cache', content: 'portal login callback code SUPERSECRET', type: 'fact', nonMemorable: true },
      deps,
    );
    const out = await resolveMemoryInjectionDetailed(actor, 'portal login', deps);
    expect(out.memoriesUsed).toBe(1);
    expect(out.text).not.toContain('SUPERSECRET');
  });

  it('an ordinary memory is unaffected — the flag can only ever REMOVE a row', async () => {
    await createMemory(actor, { title: 'a', content: 'ordinary content here', type: 'fact' }, deps);
    const rows = (await memories.find({ orgId: 'o1' })) as unknown as Array<{ nonMemorable?: boolean }>;
    expect(rows[0]!.nonMemorable).toBeUndefined();
  });
});

describe('the action cache writes no page VALUES into its injectable content (R-5)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_sec_cachecontent'));
  afterAll(shutdownAgentTestDb);
  beforeEach(() => resetAgentState());
  afterEach(async () => {
    restoreTransport();
    await memories.deleteMany({});
  });

  const writeAndRead = async (action: PlaywrightAction) => {
    await writeActionCache({
      automationId: 'a1',
      stepId: 'step-1',
      fingerprint: fingerprint(),
      action,
      actor,
      confidence: 'high',
    });
    const rows = (await memories.find({ orgId: 'o1' })) as unknown as Array<{
      content?: string;
      nonMemorable?: boolean;
    }>;
    return rows[0]!;
  };

  it('marks the row nonMemorable', async () => {
    const row = await writeAndRead({ kind: 'click', locator: { strategy: 'css', selector: '#go' } } as PlaywrightAction);
    expect(row.nonMemorable).toBe(true);
  });

  it('does not persist a fill VALUE (it persisted the first 40 chars)', async () => {
    const row = await writeAndRead({
      kind: 'fill',
      locator: { strategy: 'css', selector: '#pw' },
      value: 'hunter2-SUPER-SECRET-PASSWORD',
    } as PlaywrightAction);
    expect(row.content).not.toContain('hunter2');
    expect(row.content).not.toContain('SUPER-SECRET');
    expect(row.content).toContain('chars'); // length only
    expect(row.content).toContain('#pw'); // the SELECTOR is shape, and is kept — only the value goes
  });

  it('strips the query string from a navigate URL (it persisted the FULL url)', async () => {
    const row = await writeAndRead({
      kind: 'navigate',
      url: 'https://portal.example/callback?code=MAGIC-LINK-TOKEN&state=xyz',
    } as PlaywrightAction);
    expect(row.content).not.toContain('MAGIC-LINK-TOKEN');
    expect(row.content).not.toContain('code=');
    expect(row.content).toContain('https://portal.example/callback');
  });

  it('does not persist a select VALUE (it persisted it in full)', async () => {
    const row = await writeAndRead({
      kind: 'select',
      locator: { strategy: 'css', selector: '#acct' },
      value: 'ACCOUNT-1234-5678',
    } as PlaywrightAction);
    expect(row.content).not.toContain('ACCOUNT-1234-5678');
  });

  it('an unparseable navigate URL degrades to a placeholder, never the raw string', async () => {
    const row = await writeAndRead({ kind: 'navigate', url: 'not a url ?tok=SECRET' } as PlaywrightAction);
    expect(row.content).not.toContain('SECRET');
  });
});

describe('verifier extraction refuses secret-shaped input names (R-4, I2)', () => {
  it.each([
    'otp', 'otpCode', 'mfa_code', 'totp', 'authToken', 'access_token', 'password', 'passwd',
    'senha', 'palavra_passe', 'clientSecret', 'apiKey', 'api_key', 'bearer', 'cookie',
    'sessionId', 'sessao', 'sessão', 'credential', 'credencial', 'pin', 'cvv',
  ])('refuses %s', (name) => {
    expect(SECRET_SHAPED_INPUT_NAME.test(name)).toBe(true);
  });

  // A false positive silently refuses an ordinary input, so the vocabulary is pinned in BOTH
  // directions. `author` is the motivating case: a bare /auth/ matched it.
  it.each([
    'nif', 'processo', 'clientName', 'valor', 'dataNascimento', 'morada', 'email', 'numero',
    'author', 'authorName', 'pinturaRef', 'sessionsCount'.replace('session', 'reuniao'),
  ])(
    'still allows the ordinary business input %s',
    (name) => {
      expect(SECRET_SHAPED_INPUT_NAME.test(name)).toBe(false);
    },
  );
});
