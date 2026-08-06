import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, approvedIntegrationActions, activityLogs } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import {
  connectPlatform,
  completeCallback,
  type PlatformHttp,
  type PlatformOAuthEnv,
  type OAuthDeps,
} from '../../src/integrations/platform-oauth.js';
import { resolveDefinition } from '../../src/integrations/definition-registry.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';
import { createWorkspaceCredentials } from '../../src/integrations/workspace-credential.js';
import {
  listEmailIntegrations,
  sendAppEmail,
  createAppEmailDraft,
  sendAppEmailDraft,
  getWorkspaceInboxAddress,
  type AppEmailDeps,
  type AppEmailContext,
} from '../../src/integrations/app-email.js';

/**
 * THE SERVED-APP EMAIL PLANE.
 *
 * A served page has no identity, no token and no way to name a user. What it has is an app id, and
 * this plane turns that into "send mail as the app owner, if a human has approved it". The four
 * things worth proving are therefore:
 *
 *  A. DISCOVERY IS BY CAPABILITY. An action is a sender because it declares `email-send`, not
 *     because of how it is spelled. An action without the declaration is invisible AND unusable —
 *     including when the caller names it directly, which is the confused-deputy case.
 *  B. THE WRITE GATE STILL BINDS. This is where ekoa-dev's version and this one diverge: upstream
 *     dispatched with a synthesised admin actor and no gate, so a page could send mail as the
 *     workspace unconditionally. Here an unapproved send is REFUSED, no provider call happens, and
 *     the app is told `awaiting_consent` rather than a lie.
 *  C. IT IS THE OWNER'S MAILBOX, RESOLVED SERVER-SIDE. Nothing the page sends can change whose
 *     connection is spent; a different org's app reads that org's connection or nothing.
 *  D. HONEST DEGRADE. Not connected says not connected; a provider refusal is reported as a
 *     provider refusal. Never a fabricated success.
 *
 * The provider transport is a recording fake — nothing reaches a live host.
 */
let mem: MongoMemoryServer;
let seq = 0;
let clock = 1_700_000_000_000;

const ORG = 'orgA';
const OTHER_ORG = 'orgB';
const OWNER = 'ownerA';
const OTHER_OWNER = 'ownerB';

const ORGS: Record<string, string> = { [OWNER]: ORG, [OTHER_OWNER]: OTHER_ORG };

const env: PlatformOAuthEnv = {
  google: { clientId: 'gid', clientSecret: 'gsecret', redirectBaseUrl: 'https://app.example' },
  microsoft: { clientId: 'mid', clientSecret: 'msecret', redirectBaseUrl: 'https://app.example', tenantId: 'common' },
};

interface Call { url: string; method?: string; body?: string }

function jsonRes(status: number, obj: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => obj,
    text: async () => JSON.stringify(obj),
    headers: { forEach: () => undefined },
  } as unknown as Response;
}

/** Records every provider request. `providerRefuses` drives the honest-degrade case. */
function makeHttp(opts: { providerRefuses?: boolean } = {}): { http: PlatformHttp; calls: Call[] } {
  const calls: Call[] = [];
  const http: PlatformHttp = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body });
    if (url.includes('login.microsoftonline.com') || url.includes('oauth2.googleapis.com/token')) {
      return jsonRes(200, {
        access_token: 'atk-1', refresh_token: 'rtk-1', token_type: 'Bearer', expires_in: 3600, scope: 'openid email',
      });
    }
    if (url.includes('googleapis.com/oauth2/v2/userinfo')) return jsonRes(200, { email: 'owner@acme.pt' });
    if (url.endsWith('graph.microsoft.com/v1.0/me')) return jsonRes(200, { mail: 'owner@acme.pt', userPrincipalName: 'owner@acme.pt' });
    if (url.includes('gmail/v1/users/me/profile')) return jsonRes(200, { emailAddress: 'owner@acme.pt' });
    if (opts.providerRefuses) return jsonRes(403, { error: { message: 'mailbox is read-only' } });
    if (url.includes('/me/messages') && !url.endsWith('/send')) {
      return jsonRes(201, { id: 'msg-1', webLink: 'https://outlook.office.com/mail/deeplink/msg-1' });
    }
    if (url.includes('gmail/v1/users/me/drafts') && !url.endsWith('/send')) return jsonRes(200, { id: 'draft-1' });
    return jsonRes(202, {});
  };
  return { http, calls };
}

function oauthDeps(http: PlatformHttp): OAuthDeps {
  return { now: () => clock, genId: () => `id_${seq++}`, http, env };
}

function depsWith(http: PlatformHttp): AppEmailDeps {
  const oauth = oauthDeps(http);
  return {
    // Not exercised by the service-level tests (the router owns admission); present so the deps
    // object is the real shape the composition root builds.
    resolveAppScope: async (id) => ({ appId: id, ownerUserId: OWNER, isServed: true, m365Proxy: false }),
    resolveOwnerOrgId: async (userId) => ORGS[userId] ?? null,
    workspaceStatus: createWorkspaceCredentials({ resolveOwnerOrgId: async (u) => ORGS[u] ?? null, oauth }).status,
    oauth,
  };
}

const ctxFor = (ownerUserId = OWNER, orgId = ORG): AppEmailContext => ({ appId: 'app-1', ownerUserId, orgId });

/** Complete a real connect→callback so the row under test is the one production reads. */
async function connect(orgId: string, provider: 'google' | 'microsoft', http: PlatformHttp): Promise<void> {
  const actor = { userId: `admin-${orgId}`, orgId, username: `admin-${orgId}` };
  const started = await connectPlatform(actor, provider, oauthDeps(http));
  if (!started.ok) throw new Error(`connect failed: ${started.code}`);
  const outcome = await completeCallback(provider, { code: 'auth-code', state: started.state }, oauthDeps(http));
  if (!outcome.ok) throw new Error(`callback failed: ${outcome.reason}`);
}

/** Grant the owner's standing approval for one action, the way the approval route does. */
async function approve(orgId: string, userId: string, integrationKey: string, actionName: string): Promise<void> {
  const def = await resolveDefinition({ userId, orgId, role: 'user' }, integrationKey);
  const action = def?.actions.find((a) => a.actionName === actionName);
  if (!action) throw new Error(`no action ${integrationKey}/${actionName}`);
  // `mutates: true` forced exactly as the write gate forces it, so the approved SHAPE is the one
  // the gate will look up (the shape hash never includes `mutates`). The approval deliberately
  // uses the REAL clock, not this file's frozen `clock`: consent TTLs are checked against
  // Date.now(), so an approval stamped in 2023 would read as expired the moment it was written.
  await approveAction({ orgId, userId }, describeAction(integrationKey, { ...action, mutates: true }), 'always');
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_app_email');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 1_700_000_000_000;
  await integrationConfigs.deleteMany({});
  await approvedIntegrationActions.deleteMany({});
  await activityLogs.deleteMany({});
});

// ---------------------------------------------------------------------------
// A. Discovery is by capability
// ---------------------------------------------------------------------------

describe('app-email discovery — the declaration is what makes a sender', () => {
  it('lists exactly the actions that declare email-send, with the shipped packages present', async () => {
    const { http } = makeHttp();
    const list = await listEmailIntegrations(ctxFor(), depsWith(http));
    const names = list.map((i) => `${i.integrationKey}/${i.actionName}`).sort();
    expect(names).toEqual([
      'google-workspace/send_email',
      'google-workspace/send_email_simple',
      'microsoft-365/send_email',
    ]);
  });

  it('never lists a NON-sender, however suggestive its name', async () => {
    const { http } = makeHttp();
    const list = await listEmailIntegrations(ctxFor(), depsWith(http));
    const listed = new Set(list.map((i) => i.actionName));
    // These exist on the shipped packages and are all about email. None declares `email-send`.
    for (const name of ['list_emails', 'read_email', 'modify_email', 'trash_email', 'create_draft', 'send_draft']) {
      expect([name, listed.has(name)]).toEqual([name, false]);
    }
  });

  it('reports NOT connected until the org connects, and connected afterwards', async () => {
    const { http } = makeHttp();
    const before = await listEmailIntegrations(ctxFor(), depsWith(http));
    expect(before.every((i) => !i.connected)).toBe(true);

    await connect(ORG, 'microsoft', http);
    const after = await listEmailIntegrations(ctxFor(), depsWith(http));
    expect(after.find((i) => i.integrationKey === 'microsoft-365')?.connected).toBe(true);
    // Google was never connected — the two providers are reported independently.
    expect(after.find((i) => i.integrationKey === 'google-workspace')?.connected).toBe(false);
  });

  it('advertises draft support only where an email-draft action exists', async () => {
    const { http } = makeHttp();
    const list = await listEmailIntegrations(ctxFor(), depsWith(http));
    expect(list.every((i) => i.supportsDrafts)).toBe(true); // both shipped packages gained drafts
  });

  it('another org’s owner sees THEIR connection state, never this one’s', async () => {
    const { http } = makeHttp();
    await connect(ORG, 'microsoft', http);
    const theirs = await listEmailIntegrations(ctxFor(OTHER_OWNER, OTHER_ORG), depsWith(http));
    expect(theirs.find((i) => i.integrationKey === 'microsoft-365')?.connected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. The write gate binds — the divergence from upstream
// ---------------------------------------------------------------------------

describe('app-email send — an unapproved send is refused, not performed', () => {
  it('refuses with awaiting_consent and makes NO provider call', async () => {
    const { http, calls } = makeHttp();
    await connect(ORG, 'microsoft', http);
    const before = calls.length;

    const res = await sendAppEmail(
      { integrationKey: 'microsoft-365', actionName: 'send_email', to: ['cliente@acme.pt'], subject: 'Fatura', body: 'Segue em anexo.' },
      ctxFor(),
      depsWith(http),
    );

    expect(res).toMatchObject({ success: false, code: 'awaiting_consent' });
    // The proof is the absence of traffic: nothing was sent, and no token was even spent.
    expect(calls.length).toBe(before);
  });

  it('sends once the OWNER has approved that exact action', async () => {
    const { http, calls } = makeHttp();
    await connect(ORG, 'microsoft', http);
    await approve(ORG, OWNER, 'microsoft-365', 'send_email');

    const res = await sendAppEmail(
      { integrationKey: 'microsoft-365', actionName: 'send_email', to: ['cliente@acme.pt'], subject: 'Fatura', body: 'Segue em anexo.' },
      ctxFor(),
      depsWith(http),
    );

    expect(res).toEqual({ success: true });
    const sendCall = calls.find((c) => c.url.endsWith('/v1.0/me/sendMail'));
    expect(sendCall).toBeDefined();
    // Recipients reach Graph in ITS shape, not as a comma-joined string.
    expect(JSON.parse(sendCall!.body ?? '{}')).toMatchObject({
      message: { toRecipients: [{ emailAddress: { address: 'cliente@acme.pt' } }] },
    });
  });

  it('an approval on ONE action does not authorise another', async () => {
    const { http } = makeHttp();
    await connect(ORG, 'google', http);
    await approve(ORG, OWNER, 'google-workspace', 'send_email');

    const res = await sendAppEmail(
      { integrationKey: 'google-workspace', actionName: 'send_email_simple', to: ['c@acme.pt'], subject: 'Olá', body: 'Corpo' },
      ctxFor(),
      depsWith(http),
    );
    expect(res).toMatchObject({ success: false, code: 'awaiting_consent' });
  });

  it('an approval in ANOTHER org does not authorise this one', async () => {
    const { http } = makeHttp();
    await connect(ORG, 'microsoft', http);
    await approve(OTHER_ORG, OTHER_OWNER, 'microsoft-365', 'send_email');

    const res = await sendAppEmail(
      { integrationKey: 'microsoft-365', actionName: 'send_email', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      ctxFor(),
      depsWith(http),
    );
    expect(res).toMatchObject({ success: false, code: 'awaiting_consent' });
  });
});

// ---------------------------------------------------------------------------
// A (continued). The caller's word is never taken
// ---------------------------------------------------------------------------

describe('app-email send — the page cannot borrow the plane to run something else', () => {
  it('refuses a real, approved, MUTATING action that is not an email sender', async () => {
    const { http, calls } = makeHttp();
    await connect(ORG, 'google', http);
    // Approve it, so the ONLY thing standing between the page and the call is the capability check.
    await approve(ORG, OWNER, 'google-workspace', 'trash_email');
    const before = calls.length;

    const res = await sendAppEmail(
      { integrationKey: 'google-workspace', actionName: 'trash_email', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      ctxFor(),
      depsWith(http),
    );

    expect(res).toMatchObject({ success: false, code: 'not_email_capable' });
    expect(calls.length).toBe(before);
  });

  it('refuses an action that does not exist at all', async () => {
    const { http } = makeHttp();
    await connect(ORG, 'microsoft', http);
    const res = await sendAppEmail(
      { integrationKey: 'microsoft-365', actionName: 'exfiltrate', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      ctxFor(),
      depsWith(http),
    );
    expect(res).toMatchObject({ success: false, code: 'unknown_action' });
  });

  it.each([
    ['empty', []],
    ['not an address', ['nobody']],
    ['header injection', ['ok@acme.pt\r\nBcc: everyone@acme.pt']],
  ])('refuses invalid recipients (%s) before anything is resolved', async (_label, to) => {
    const { http, calls } = makeHttp();
    await connect(ORG, 'microsoft', http);
    await approve(ORG, OWNER, 'microsoft-365', 'send_email');
    const before = calls.length;

    const res = await sendAppEmail(
      { integrationKey: 'microsoft-365', actionName: 'send_email', to: to as string[], subject: 'S', body: 'B' },
      ctxFor(),
      depsWith(http),
    );
    expect(res).toMatchObject({ success: false, code: 'invalid_recipients' });
    expect(calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// C + D. Drafts, inbox, and honest degrade
// ---------------------------------------------------------------------------

describe('app-email drafts — parked for a human, not sent', () => {
  it('creates an Outlook draft and returns its id + deep link', async () => {
    const { http, calls } = makeHttp();
    await connect(ORG, 'microsoft', http);
    await approve(ORG, OWNER, 'microsoft-365', 'create_draft');

    const res = await createAppEmailDraft(
      { integrationKey: 'microsoft-365', to: ['cliente@acme.pt'], subject: 'Lembrete', body: 'Fatura em atraso.' },
      ctxFor(),
      depsWith(http),
    );

    expect(res).toMatchObject({ success: true, draftId: 'msg-1', webLink: 'https://outlook.office.com/mail/deeplink/msg-1' });
    // A draft is a POST to /messages — NOT to /sendMail. Nothing was sent to the recipient.
    expect(calls.some((c) => c.url.endsWith('/v1.0/me/messages'))).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/sendMail'))).toBe(false);
  });

  it('creating a draft is a WRITE and is gated like one', async () => {
    const { http, calls } = makeHttp();
    await connect(ORG, 'microsoft', http);
    const before = calls.length;
    const res = await createAppEmailDraft(
      { integrationKey: 'microsoft-365', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      ctxFor(),
      depsWith(http),
    );
    expect(res).toMatchObject({ success: false, code: 'awaiting_consent' });
    expect(calls.length).toBe(before);
  });

  it('a Gmail draft gets the Drafts-folder link, since Gmail returns no per-draft one', async () => {
    const { http } = makeHttp();
    await connect(ORG, 'google', http);
    await approve(ORG, OWNER, 'google-workspace', 'create_draft_simple');

    const res = await createAppEmailDraft(
      { integrationKey: 'google-workspace', to: ['cliente@acme.pt'], subject: 'Lembrete', body: 'Corpo' },
      ctxFor(),
      depsWith(http),
    );
    expect(res).toMatchObject({ success: true, draftId: 'draft-1', webLink: 'https://mail.google.com/mail/u/0/#drafts' });
  });

  it('sends an existing draft through the provider’s own draft-send action', async () => {
    const { http, calls } = makeHttp();
    await connect(ORG, 'microsoft', http);
    await approve(ORG, OWNER, 'microsoft-365', 'send_draft');

    const res = await sendAppEmailDraft({ integrationKey: 'microsoft-365', draftId: 'msg-1' }, ctxFor(), depsWith(http));
    expect(res).toEqual({ success: true });
    expect(calls.some((c) => c.url.endsWith('/v1.0/me/messages/msg-1/send'))).toBe(true);
  });

  it('an integration with no draft action says so, rather than guessing one', async () => {
    const { http } = makeHttp();
    const res = await createAppEmailDraft(
      { integrationKey: 'slack', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      ctxFor(),
      depsWith(http),
    );
    expect(res).toMatchObject({ success: false, code: 'unsupported_integration' });
  });
});

describe('app-email — honest degrade', () => {
  it('an unconnected provider reports not_connected, never a fake success', async () => {
    const { http } = makeHttp();
    await approve(ORG, OWNER, 'microsoft-365', 'send_email'); // approved, but nothing is connected
    const res = await sendAppEmail(
      { integrationKey: 'microsoft-365', actionName: 'send_email', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      ctxFor(),
      depsWith(http),
    );
    expect(res).toMatchObject({ success: false, code: 'not_connected' });
  });

  it('a provider refusal is reported as a provider error', async () => {
    const { http } = makeHttp({ providerRefuses: true });
    await connect(ORG, 'microsoft', http);
    await approve(ORG, OWNER, 'microsoft-365', 'send_email');
    const res = await sendAppEmail(
      { integrationKey: 'microsoft-365', actionName: 'send_email', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      ctxFor(),
      depsWith(http),
    );
    expect(res.success).toBe(false);
    expect(res.code).toBe('provider_error');
  });

  it('the inbox address is a READ — it needs no approval', async () => {
    const { http } = makeHttp();
    await connect(ORG, 'microsoft', http);
    const res = await getWorkspaceInboxAddress('microsoft-365', ctxFor(), depsWith(http));
    expect(res).toMatchObject({ success: true, address: 'owner@acme.pt' });
  });

  it('the inbox of a non-platform integration is refused, not invented', async () => {
    const { http } = makeHttp();
    const res = await getWorkspaceInboxAddress('slack', ctxFor(), depsWith(http));
    expect(res).toMatchObject({ success: false, code: 'unsupported_integration' });
  });
});
