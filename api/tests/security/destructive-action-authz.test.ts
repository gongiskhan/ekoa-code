/**
 * H5 destructive-action authorization asserted SERVER-SIDE (BRIEF Phase 10 deliverable 4).
 *
 * The claim under proof: a mutating/destructive operation that reaches an app's SERVER surface and is
 * meant to be end-user-gated is authorized SERVER-SIDE by the per-app SSO identity - the client
 * confirmation (the Phase 4 destructive-action confirm dialog) is UX, NOT the boundary. Where that
 * boundary LIVES is the per-app SSO session (api/src/integrations/app-sso.ts), which mints and checks
 * an HttpOnly cookie bound to ONE app by `session.appId` (findValidAppSession). We drive the
 * canonical session-gated mutating op - `POST /api/app-sso/set-password`, which writes a bcrypt hash
 * onto the app's own app-data row - and prove the SERVER rejects it WITHOUT a valid app-sso session
 * and with a WRONG-APP session, independent of any client-side confirmation (there is no confirmation
 * parameter - the server decides on identity alone). The visitor-acting Microsoft Graph proxy
 * (`/api/app-sso/m365/*`) is asserted the same way.
 *
 * DOCUMENTED BOUNDARY (the destructive-action-authz finding - see docs/security.md + the H5
 * impl-notes): the GENERAL served-app data plane (`/api/app-data/*`, served-data.ts) that a C3
 * action's submit/delete lands on is deliberately app-id-SCOPED and byte-compatible with the legacy
 * key-value plane ("No platform JWT anywhere on this plane") - its per-app server boundary is the
 * `X-Ekoa-App-Id` scope + the owner-activation admission gate, NOT an app-sso session. The app-sso
 * IDENTITY plane asserted here gates the PRIVILEGED end-user ops (set-password, the Graph proxy). No
 * new auth code is added by H5; this suite ASSERTS the authz that H1-H4 and the served-app plane
 * already own.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { CollectionsEngine, appScope } from '../../src/data/collections-engine.js';
import { appSsoRouter } from '../../src/integrations/app-sso.js';
import type { ResolvedAppScope } from '../../src/integrations/app-scope.js';

let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => Date.now(), genId: () => `id_${seq++}` };

// Two apps, two owners, two disjoint per-app SSO namespaces. A session minted for app2 must NEVER
// authorize a mutation against app1.
const APPS: Record<string, ResolvedAppScope> = {
  app1: { appId: 'app1', ownerUserId: 'owner1', isServed: true, m365Proxy: true },
  app2: { appId: 'app2', ownerUserId: 'owner2', isServed: true, m365Proxy: true },
};
const resolveAppScope = async (idOrSlug: string): Promise<ResolvedAppScope | null> => APPS[idOrSlug] ?? null;

const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_destructive_authz');
  const app = express();
  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope, crossSite: false }));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  setActivation('owner1', { active: true, billingLocked: false });
  setActivation('owner2', { active: true, billingLocked: false });
  await getDb().collection('app_data').deleteMany({});
  await getDb().collection('app_sessions').deleteMany({});
  // Seed one end-user into each app's own user collection (the password-auth surface).
  const engine = new CollectionsEngine(deps);
  await engine.create(appScope('app1'), 'utilizadores', { email: 'ana@app1.pt', passwordHash: await bcrypt.hash('segredo123', 12), name: 'Ana', role: 'user' });
  await engine.create(appScope('app2'), 'utilizadores', { email: 'rui@app2.pt', passwordHash: await bcrypt.hash('segredo456', 12), name: 'Rui', role: 'user' });
});

const cookieFrom = (res: Response) => (res.headers.get('set-cookie') || '').split(';')[0] as string;
const loginApp = (appId: string, identity: string, password: string) =>
  api('/api/app-sso/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId },
    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
  });
const setPassword = (appId: string, identity: string, password: string, cookie?: string) =>
  api('/api/app-sso/set-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
  });

describe('set-password (a mutating app op) is authorized server-side by the app-sso identity, not client confirmation', () => {
  it('WITHOUT a valid app-sso session -> 401 not_authenticated (the server rejects the mutation on identity alone; no confirmation param can substitute)', async () => {
    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01'); // no cookie
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('not_authenticated');
    // And the mutation did NOT happen: the old password still logs in, the new one does not.
    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(401);
    expect((await loginApp('app1', 'ana@app1.pt', 'segredo123')).status).toBe(200);
  });

  it('with a WRONG-APP session (an app2 session presented to app1) -> 401 (session.appId isolation; the cross-app mutation is refused)', async () => {
    const app2Cookie = cookieFrom(await loginApp('app2', 'rui@app2.pt', 'segredo456'));
    expect(app2Cookie).toContain('ekoa_app_sso_app2=');
    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01', app2Cookie);
    expect(res.status).toBe(401); // findValidAppSession(token, 'app1') is null: the session is bound to app2
    // The app1 row is untouched - the wrong-app session authorized nothing.
    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(401);
    expect((await loginApp('app1', 'ana@app1.pt', 'segredo123')).status).toBe(200);
  });

  it('with the CORRECT same-app session (self) -> 200: the app-sso identity - and only it - authorizes the mutation', async () => {
    const app1Cookie = cookieFrom(await loginApp('app1', 'ana@app1.pt', 'segredo123'));
    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01', app1Cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // The server-side mutation took effect: the new password now logs in. There was no client
    // confirmation in the request - the app-sso session identity is the whole boundary.
    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(200);
  });
});

describe('KNOWN GAP (codex-h5 High): the GENERAL /api/app-data mutation plane authenticates NO caller', () => {
  // This is a TRIPWIRE, not a proof of safety. The served-app data plane (served-data.ts) lets ANY
  // caller who knows an app id POST/PUT/DELETE that app's data - `scopeFor()` checks only the
  // X-Ekoa-App-Id header + the app OWNER's activation (admitOwner), never the CALLER. Phase 10's
  // "destructive-action authorization asserted server-side" is therefore NOT met for this surface.
  // It is PRE-EXISTING and an architecture-level operator decision (see docs/security.md + findings).
  // We PIN the current state so a future fix (a caller/session check on the data-plane writes) FLIPS
  // this test and forces docs/findings/this-assertion to be updated - the gap can never be quietly
  // "fixed" or quietly regress unnoticed. served-app.test.ts additionally proves BEHAVIORALLY that an
  // unauthenticated /api/app-data POST currently returns 201.
  const servedDataSrc = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/apps/served-data.ts'),
    'utf8',
  );

  it('the data-plane write routes exist and are scoped ONLY by scopeFor (no caller auth) - CLOSING THIS FLIPS THE TRIPWIRE', () => {
    expect(/r\.post\(`\$\{prefix\}\/:collection`/.test(servedDataSrc)).toBe(true);
    expect(/r\.put\(`\$\{prefix\}\/:collection\/:id`/.test(servedDataSrc)).toBe(true);
    expect(/r\.delete\(`\$\{prefix\}\/:collection\/:id`/.test(servedDataSrc)).toBe(true);
    // The writes gate ONLY through scopeFor, which today performs NO caller-session / app-sso check.
    // If session/caller auth is ever added to the data-plane writes (the fix), one of these tokens
    // appears and this fails ON PURPOSE - update the KNOWN GAP (docs/security.md + findings.md) and
    // rewrite this suite to assert the new server-side authorization.
    expect(
      /findValidAppSession|requireAppSession|ekoa_app_sso/i.test(servedDataSrc),
      'served-data.ts now references an app-sso session on the data plane - the KNOWN GAP may be closed; update docs/findings + this tripwire',
    ).toBe(false);
  });
});

describe('the visitor-acting Microsoft Graph proxy is gated by the app-sso session too', () => {
  it('WITHOUT a session -> 401 not_authenticated (a mutating /m365/* forward never runs unauthenticated)', async () => {
    const res = await api('/api/app-sso/m365/v1.0/me', { method: 'POST', headers: { 'x-ekoa-app-id': 'app1' } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('not_authenticated');
  });

  it('with a WRONG-APP session -> 401 (a session bound to app2 cannot act on app1)', async () => {
    const app2Cookie = cookieFrom(await loginApp('app2', 'rui@app2.pt', 'segredo456'));
    const res = await api('/api/app-sso/m365/v1.0/me', {
      method: 'POST',
      headers: { 'x-ekoa-app-id': 'app1', cookie: app2Cookie },
    });
    expect(res.status).toBe(401);
  });
});
