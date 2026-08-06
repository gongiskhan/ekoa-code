import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, approvedIntegrationActions } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import {
  connectPlatform,
  completeCallback,
  type PlatformHttp,
  type PlatformOAuthEnv,
  type OAuthDeps,
} from '../../src/integrations/platform-oauth.js';
import {
  callPlatformIntegration,
  platformActionRequiresConsent,
  platformReadActions,
} from '../../src/integrations/platform-call.js';
import { resolveDefinition } from '../../src/integrations/definition-registry.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';

/**
 * SECURITY SUITE - THE PLATFORM WRITE RAIL (C2 follow-up).
 *
 * C2 gated `executeUserIntegrationAction` and explicitly named the rail it does NOT cover:
 * `google-workspace` / `microsoft-365` short-circuit to `callPlatformIntegration`, from the
 * automation `integration` step, the artifact `integration.call` primitive, the listener
 * supervisor's poll, chat prefetch and email hydration. Until this suite, "a mutating action needs
 * a human" was simply FALSE for the mailbox, calendar, Drive and OneDrive of every connected org:
 * 14 mutating Google actions and 3 mutating Microsoft ones auto-ran under the org's managed OAuth
 * connection for anyone who could drive an automation.
 *
 * Everything here is proved by REFUSAL plus the absence of a provider call - never by inspecting a
 * flag. The provider transport is a recording fake; nothing reaches a live host.
 *
 * FOUR CLASSES:
 *  A. The allowlist is the derivation, and it is checked against the SHIPPED packages in both
 *     directions - so a package bump that adds an action fails this suite instead of silently
 *     landing on one side or the other.
 *  B. Fail-closed: an unknown integration, an unknown action, and a `mutates` that is anything but
 *     a literal `false` all gate. The allowlist OVERRULES a definition that claims a write is a read.
 *  C. An approval is not transferable - one key component changed per case.
 *  D. The unattended rails (no acting user) cannot ride anyone's approval, and reads still auto-run
 *     everywhere (Rule 7: no existing non-mutating automation, poll or prefetch changes behaviour).
 */
let mem: MongoMemoryServer;
let seq = 0;
let clock = 1_700_000_000_000;

const ORG = 'orgPlat';
const OTHER_ORG = 'orgPlatB';
const OWNER = 'u-owner';
const PEER = 'u-peer';

const env: PlatformOAuthEnv = {
  google: { clientId: 'gid', clientSecret: 'gsecret', redirectBaseUrl: 'https://app.example' },
  microsoft: { clientId: 'mid', clientSecret: 'msecret', redirectBaseUrl: 'https://app.example', tenantId: 'common' },
};

interface FakeRes {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: { forEach: (cb: (v: string, k: string) => void) => void };
  statusText?: string;
}
function jsonRes(status: number, obj: unknown): FakeRes {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
    headers: { forEach: () => undefined },
    statusText: '',
  };
}

/** URL-routed fake provider transport that RECORDS every call - the leak detector for this suite. */
function makeHttp(): { http: PlatformHttp; calls: string[] } {
  const calls: string[] = [];
  const http: PlatformHttp = async (url) => {
    calls.push(url);
    if (url.includes('oauth2.googleapis.com/token') || url.includes('login.microsoftonline.com')) {
      return jsonRes(200, { access_token: 'atk-1', refresh_token: 'rtk-1', token_type: 'Bearer', expires_in: 3600, scope: 'openid email' }) as unknown as Response;
    }
    if (url.includes('googleapis.com/oauth2/v2/userinfo')) return jsonRes(200, { email: 'user@acme.pt' }) as unknown as Response;
    if (url.includes('graph.microsoft.com/v1.0/me') && url.endsWith('/me')) return jsonRes(200, { mail: 'user@acme.pt' }) as unknown as Response;
    return jsonRes(200, { ok: true }) as unknown as Response;
  };
  return { http, calls };
}
function depsWith(http: PlatformHttp): OAuthDeps {
  return { now: () => clock, genId: () => `id_${seq++}`, http, env };
}

/** Provider calls only - the token/userinfo hops of the OAuth dance are not the thing under test. */
const providerCalls = (calls: string[]): string[] =>
  calls.filter((u) => /gmail\.googleapis|www\.googleapis|graph\.microsoft|docs\.googleapis|sheets\.googleapis|tasks\.googleapis|calendar/.test(u) && !u.endsWith('/me') && !u.includes('oauth2/v2/userinfo'));

async function connectOrg(orgId: string, provider: 'google' | 'microsoft'): Promise<void> {
  const { http } = makeHttp();
  const connect = await connectPlatform({ userId: OWNER, orgId, username: OWNER }, provider, depsWith(http));
  if (!connect.ok) throw new Error('connect failed');
  await completeCallback(provider, { code: 'auth-code', state: connect.state }, depsWith(http));
}

async function actionOf(orgId: string, key: string, actionName: string): Promise<IntegrationAction> {
  const def = await resolveDefinition({ userId: OWNER, orgId, role: 'user' }, key);
  const action = def?.actions.find((a) => a.actionName === actionName);
  if (!action) throw new Error(`no action ${actionName} on ${key}`);
  return action;
}

/**
 * Grant the approval a human would grant on the integration's action-approvals surface.
 *
 * Deliberately on the REAL clock, not the OAuth fake one: the gate reads `Date.now()` (it takes no
 * injected clock), so an approval minted against 2023 would be expired before it was written and
 * every "the approved call runs" assertion would pass for the wrong reason.
 */
async function approve(orgId: string, userId: string, key: string, actionName: string, at: number = Date.now()): Promise<void> {
  const action = await actionOf(orgId, key, actionName);
  await approveAction({ orgId, userId }, describeAction(key, action), 'always', () => at);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions(); // the shipped google-workspace / microsoft-365 packages
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_platform_write_gate');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  clock = 1_700_000_000_000;
  await integrationConfigs.deleteMany({});
  await approvedIntegrationActions.deleteMany({});
});

// ---------------------------------------------------------------------------
// A. The allowlist IS the derivation, and it matches the shipped packages
// ---------------------------------------------------------------------------

describe('platform mutation derivation - allowlist vs the shipped packages', () => {
  // Resolved from THIS FILE, not from cwd: the suite runs from the repo root and from api/.
  const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), '../../assets/integrations');
  const shipped = (key: string): Array<{ actionName: string; mutates?: unknown }> =>
    (JSON.parse(readFileSync(join(assetsRoot, key, 'config.json'), 'utf8')) as { actions: Array<{ actionName: string; mutates?: unknown }> }).actions;

  for (const key of ['google-workspace', 'microsoft-365']) {
    it(`${key}: every shipped action is classified, and the two sources agree`, () => {
      const reads = platformReadActions(key);
      expect(reads).toBeDefined();
      const actions = shipped(key);
      expect(actions.length).toBeGreaterThan(0);
      for (const a of actions) {
        const onAllowlist = reads!.has(a.actionName);
        // The package's own `mutates` and the allowlist must say the same thing. A drift in either
        // direction is a failure here rather than a silent (and possibly ungated) landing.
        expect([a.actionName, onAllowlist]).toEqual([a.actionName, a.mutates === false]);
        expect([a.actionName, platformActionRequiresConsent(key, a as { actionName: string; mutates: boolean })])
          .toEqual([a.actionName, a.mutates !== false]);
      }
      // Nothing on the allowlist that the package does not ship (an allowlist entry for a deleted
      // action would silently un-gate a future action of the same name).
      const shippedNames = new Set(actions.map((a) => a.actionName));
      for (const name of reads!) expect([name, shippedNames.has(name)]).toEqual([name, true]);
    });
  }

  /**
   * The enumeration this suite was built on was 14 Google / 3 Microsoft mutating actions. It has
   * GROWN, on purpose, and the growth is pinned rather than the original count: the served-app email
   * plane (`apps/app-email.ts`) added `create_draft_simple` + `send_draft` to Google and
   * `create_draft` + `send_draft` to Microsoft. Both providers' drafts WRITE to the mailbox, so both
   * land in the gated set — parking a draft in someone's Drafts folder is a write, not a preview.
   * `get_profile` came with the same plane and is the counterexample: a pure read, so it goes on the
   * allowlist and auto-runs.
   */
  it('the mutating reach this gates, pinned in full (16 Google, 5 Microsoft)', () => {
    const mutating = (key: string): string[] =>
      shipped(key).filter((a) => a.mutates !== false).map((a) => a.actionName).sort();
    expect(mutating('google-workspace')).toEqual([
      'append_sheet', 'batch_modify_emails', 'complete_task', 'create_doc', 'create_draft_simple',
      'create_event', 'create_sheet', 'create_task', 'delete_event', 'modify_email', 'send_draft',
      'send_email', 'send_email_simple', 'trash_email', 'update_event', 'write_doc',
    ]);
    expect(mutating('microsoft-365')).toEqual([
      'create_draft', 'create_event', 'create_file', 'send_draft', 'send_email',
    ]);
  });
});

// ---------------------------------------------------------------------------
// B. Fail closed
// ---------------------------------------------------------------------------

describe('platform mutation derivation - fail closed', () => {
  it('the allowlist overrules a definition that calls a write a read', () => {
    // The whole point of not trusting the resolved `mutates`: `send_email` is not on the read
    // allowlist, so it is a write whatever the definition says.
    expect(platformActionRequiresConsent('google-workspace', { actionName: 'send_email', mutates: false })).toBe(true);
  });

  it('an UNKNOWN platform action is treated as mutating', () => {
    expect(platformActionRequiresConsent('google-workspace', { actionName: 'send_all_the_things', mutates: false })).toBe(true);
  });

  it('an UNKNOWN integration key is treated as mutating', () => {
    expect(platformActionRequiresConsent('some-other-platform', { actionName: 'list_emails', mutates: false })).toBe(true);
  });

  it('only a LITERAL false reads as a read, even on an allowlisted action', () => {
    for (const mutates of [undefined, null, 'false', 'no', 0, '', NaN, true]) {
      expect([mutates, platformActionRequiresConsent('google-workspace', { actionName: 'list_emails', mutates } as unknown as IntegrationAction)])
        .toEqual([mutates, true]);
    }
    expect(platformActionRequiresConsent('google-workspace', { actionName: 'list_emails', mutates: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C + D. The gate on the wire
// ---------------------------------------------------------------------------

describe('platform write gate - callPlatformIntegration', () => {
  it('REFUSES an unapproved send_email and never contacts the provider', async () => {
    await connectOrg(ORG, 'google');
    const { http, calls } = makeHttp();
    const res = await callPlatformIntegration(
      { orgId: ORG, integrationKey: 'google-workspace', actionName: 'send_email', args: { raw: 'x' }, actingUserId: OWNER },
      depsWith(http),
    );
    expect(res.success).toBe(false);
    expect(res.code).toBe('awaiting_consent');
    expect(providerCalls(calls)).toEqual([]);
    // The dialog has something to say: which integration, which action, and WHERE it writes.
    expect(res.consentRequest?.integrationKey).toBe('google-workspace');
    expect(res.consentRequest?.actionName).toBe('send_email');
    expect(res.consentRequest?.target).toMatch(/POST https:\/\/gmail\.googleapis\.com/);
    expect(res.consentRequest?.shape).toMatch(/^[0-9a-f]{32}$/);
  });

  it('runs the write once the owner has approved that exact action', async () => {
    await connectOrg(ORG, 'google');
    await approve(ORG, OWNER, 'google-workspace', 'send_email');
    const { http, calls } = makeHttp();
    const res = await callPlatformIntegration(
      { orgId: ORG, integrationKey: 'google-workspace', actionName: 'send_email', args: { raw: 'x' }, actingUserId: OWNER },
      depsWith(http),
    );
    expect(res.success).toBe(true);
    expect(providerCalls(calls).some((u) => u.includes('gmail.googleapis.com'))).toBe(true);
  });

  it('a READ still auto-runs with no approval anywhere (Rule 7 - existing automations untouched)', async () => {
    await connectOrg(ORG, 'google');
    const { http, calls } = makeHttp();
    const res = await callPlatformIntegration(
      { orgId: ORG, integrationKey: 'google-workspace', actionName: 'list_emails', args: {}, actingUserId: OWNER },
      depsWith(http),
    );
    expect(res.success).toBe(true);
    expect(providerCalls(calls).some((u) => u.includes('gmail.googleapis.com'))).toBe(true);
    expect(await approvedIntegrationActions.find({})).toEqual([]); // nothing was consulted or written
  });

  it('a READ auto-runs on the UNATTENDED rails too (listener poll / prefetch / hydration)', async () => {
    await connectOrg(ORG, 'google');
    const { http, calls } = makeHttp();
    const res = await callPlatformIntegration(
      { orgId: ORG, integrationKey: 'google-workspace', actionName: 'read_email', args: { messageId: 'm1' } },
      depsWith(http),
    );
    expect(res.success).toBe(true);
    expect(providerCalls(calls).length).toBe(1);
  });

  it('an UNATTENDED rail cannot ride a live approval - a listener pollAction naming send_email is refused', async () => {
    await connectOrg(ORG, 'google');
    await approve(ORG, OWNER, 'google-workspace', 'send_email'); // the owner DID approve, for themselves
    const { http, calls } = makeHttp();
    const res = await callPlatformIntegration(
      // No actingUserId: exactly what the listener supervisor's `callPlatform` binding passes.
      { orgId: ORG, integrationKey: 'google-workspace', actionName: 'send_email', args: { raw: 'x' } },
      depsWith(http),
    );
    expect(res.success).toBe(false);
    expect(res.code).toBe('awaiting_consent');
    expect(res.error).toMatch(/unattended/);
    expect(providerCalls(calls)).toEqual([]);
  });

  it('refuses BEFORE token custody: an unapproved write on an UNCONNECTED org answers awaiting_consent, not not_connected', async () => {
    const { http, calls } = makeHttp();
    const res = await callPlatformIntegration(
      { orgId: 'orgNeverConnected', integrationKey: 'google-workspace', actionName: 'create_event', args: {}, actingUserId: OWNER },
      depsWith(http),
    );
    expect(res.code).toBe('awaiting_consent');
    expect(calls).toEqual([]); // not even a token hop
  });

  it('microsoft-365: create_file is gated, list_sites is not', async () => {
    await connectOrg(ORG, 'microsoft');
    const { http, calls } = makeHttp();
    const write = await callPlatformIntegration(
      { orgId: ORG, integrationKey: 'microsoft-365', actionName: 'create_file', args: { filename: 'a.txt', content: 'x' }, actingUserId: OWNER },
      depsWith(http),
    );
    expect(write.code).toBe('awaiting_consent');
    expect(providerCalls(calls)).toEqual([]);

    const read = await callPlatformIntegration(
      { orgId: ORG, integrationKey: 'microsoft-365', actionName: 'list_sites', args: {}, actingUserId: OWNER },
      depsWith(http),
    );
    expect(read.success).toBe(true);
  });
});

describe('platform write gate - an approval is not transferable', () => {
  beforeEach(async () => {
    await connectOrg(ORG, 'google');
    await connectOrg(OTHER_ORG, 'google');
    await approve(ORG, OWNER, 'google-workspace', 'send_email');
  });

  const attempt = async (orgId: string, userId: string, actionName: string) => {
    const { http, calls } = makeHttp();
    const res = await callPlatformIntegration(
      { orgId, integrationKey: 'google-workspace', actionName, args: { raw: 'x' }, actingUserId: userId },
      depsWith(http),
    );
    return { res, provider: providerCalls(calls) };
  };

  it('control: the exact (org, user, action) it was granted for RUNS', async () => {
    const { res, provider } = await attempt(ORG, OWNER, 'send_email');
    expect(res.success).toBe(true);
    expect(provider.length).toBe(1);
  });

  it('CROSS-ORG: the same user in another tenant is refused', async () => {
    const { res, provider } = await attempt(OTHER_ORG, OWNER, 'send_email');
    expect(res.code).toBe('awaiting_consent');
    expect(provider).toEqual([]);
  });

  it('CROSS-USER: a colleague in the same org is refused', async () => {
    const { res, provider } = await attempt(ORG, PEER, 'send_email');
    expect(res.code).toBe('awaiting_consent');
    expect(provider).toEqual([]);
  });

  it('CROSS-ACTION: approving send_email says nothing about trash_email or delete_event', async () => {
    for (const other of ['trash_email', 'send_email_simple']) {
      const { res, provider } = await attempt(ORG, OWNER, other);
      expect([other, res.code]).toEqual([other, 'awaiting_consent']);
      expect(provider).toEqual([]);
    }
  });

  it('TTL: an approval granted more than 90 days ago re-prompts', async () => {
    await approvedIntegrationActions.deleteMany({});
    await approve(ORG, OWNER, 'google-workspace', 'send_email', Date.now() - 91 * 24 * 60 * 60 * 1000);
    const { res, provider } = await attempt(ORG, OWNER, 'send_email');
    expect(res.code).toBe('awaiting_consent');
    expect(provider).toEqual([]);
  });
});
