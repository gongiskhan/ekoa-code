Reading additional input from stdin...
OpenAI Codex v0.142.5
--------
workdir: /Users/ggomes/dev/ekoa-code
model: gpt-5.4
provider: openai
approval: never
sandbox: read-only
reasoning effort: medium
reasoning summaries: none
session id: 019f5e14-939d-7181-bd35-1eadf1cb3258
--------
user
BLOCK-LEVEL security re-confirm in /Users/ggomes/dev/ekoa-code (operator-run H6). Your prior block review of the H1-H5 security block found 2 cross-slice issues; both are fixed in commit 03073c6 (git show 03073c6). Confirm both CLOSED + no new defect: (Med) whoami/H2 admin detection did not mirror the FULL H1 gate for billingLocked - detectAppEditor in api/src/apps/app-assistant-route.ts now calls getActivation(sub) and returns false if !active || billingLocked (so a billing-locked admin reads admin:false and H3 no longer offers an edit that /jobs would refuse BILLING_LOCKED); a unit test pins it (api/tests/apps/app-assistant.test.ts billing-locked case). Verify it now mirrors requireAuth's full admission (active + not-billing-locked + epoch + capability + writability) and stays fail-closed/oracle-free. (Low) H4 convert of a request about a same-org private draft always 404'd (org-scoped edit policy) with a bare error - web/stores/change-requests.ts now shows an actionable PT-PT reason on a 404 with an appId. Verify the fix is correct and introduces no new issue (the 404 is still the correct server behavior; only the client message improved). Also re-confirm the whole block is coherent (no gate bypass, migration/revocation/cross-org isolation consistent) - you already verified that; just confirm the 2 fixes didn't disturb it. Read slices/H6/block-review.md (your prior findings). Read-only cmds OK. Concise: a bullet per finding (CLOSED + file:line) then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
I’m reviewing the H6 security block exactly as requested: first I’ll load the project context files and the prior H6 findings, then inspect commit `03073c6` and the affected slices to verify both fixes and check for regressions.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'pwd && ls -1 && test -d .codegraph && echo CODEGRAPH_PRESENT || echo CODEGRAPH_ABSENT && for f in PRD.md PLANING.md TASKS.md slices/H6/block-review.md; do echo "---FILE:$f"; if [ -f "$f" ]; then sed -n '"'1,220p' \""'$f"; else echo MISSING; fi; done' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/Users/ggomes/dev/ekoa-code
CLAUDE.md
Dockerfile.api
Dockerfile.web
RUN_LOG.md
api
backend.port
deploy
docs
ekoa-data
node_modules
package-lock.json
package.json
playwright.config.ts
scripts
shared
test-results
tsconfig.base.json
web
CODEGRAPH_PRESENT
---FILE:PRD.md
MISSING
---FILE:PLANING.md
MISSING
---FILE:TASKS.md
MISSING
---FILE:slices/H6/block-review.md
MISSING

exec
/bin/zsh -lc 'git show --stat --patch --unified=80 03073c6 -- api/src/apps/app-assistant-route.ts api/tests/apps/app-assistant.test.ts web/stores/change-requests.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-sgoymC9m' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-mmU9lrKQ' (errno=Operation not permitted)
commit 03073c6bf1e1c7370a2f34036e83ab0fdecae308
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Tue Jul 14 01:37:01 2026 +0100

    fix(operator-run/h6): block-review cross-slice findings - (Med) whoami now mirrors the FULL H1 admission gate: detectAppEditor also fails on billingLocked/inactive (verifySseToken checks active+epoch but NOT billingLocked, so a billing-locked admin was offered edit mode then refused BILLING_LOCKED at /jobs - a false offer, now closed); (Low) the /pedidos convert gives an actionable PT-PT reason when the H1 gate 404s a request about a same-org private draft (org-scoped edit policy) instead of a bare 'could not start' dead-end
---
 api/src/apps/app-assistant-route.ts  |  7 +++++++
 api/tests/apps/app-assistant.test.ts | 13 +++++++++++++
 web/stores/change-requests.ts        | 13 ++++++++++++-
 3 files changed, 32 insertions(+), 1 deletion(-)

diff --git a/api/src/apps/app-assistant-route.ts b/api/src/apps/app-assistant-route.ts
index 156835c..3c1beba 100644
--- a/api/src/apps/app-assistant-route.ts
+++ b/api/src/apps/app-assistant-route.ts
@@ -35,160 +35,167 @@ import { verifySseToken } from '../auth/middleware.js';
 import { can } from '../auth/capabilities.js';
 import type { JwtClaims } from '../auth/jwt.js';
 import { resolveApp, type ResolvedApp } from './registry.js';
 import { loadWritable } from './app-paths.js';
 import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';
 
 const SHARED_SCOPE_PREFIX = 'usr.';
 
 /** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
 function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
   res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
 }
 
 /**
  * Resolve the `X-Ekoa-App-Id` header to an artifact-backed owner — the SHARED front half of every
  * app-assistant plane entry (POST admission AND the H2 whoami detection), so both apply the exact
  * same charset/collision checks and expose the exact same existence surface (no plane is a
  * different oracle than the other). A discriminated result the callers turn into the CONV-2
  * envelope: `invalid-id` → 400 VALIDATION_FAILED, `not-found` → 404 NOT_FOUND, `ok` → the app.
  */
 type AssistantAppResolution =
   | { status: 'invalid-id' }
   | { status: 'not-found' }
   | { status: 'ok'; app: ResolvedApp };
 
 async function resolveAssistantApp(header: unknown): Promise<AssistantAppResolution> {
   // Same header contract admit() has always applied: a string, a valid collection-name charset,
   // and NOT the reserved `usr.` shared-namespace prefix.
   if (
     typeof header !== 'string' ||
     !collectionName.safeParse(header).success ||
     header.startsWith(SHARED_SCOPE_PREFIX)
   ) {
     return { status: 'invalid-id' };
   }
   const app = await resolveApp(header);
   // The assistant plane needs a real artifact-backed owner (org to scope by, user to attribute).
   // A dev-serve / registry-only or unresolved id has none — the same 404 admit() gives.
   if (!app || !app.artifactBacked || !app.ownerUserId) return { status: 'not-found' };
   return { status: 'ok', app };
 }
 
 /**
  * Can this verified caller EDIT this specific app? Detection MIRRORS the H1 follow-up-build gate
  * EXACTLY (routes/jobs.ts): `can(canEditApps)` AND the artifact is writable by this actor
  * (loadWritable: own always; org-shared within the org ok; another user's private → not-ok;
  * missing/cross-org → not-ok). Making detection identical to the actual edit authority is what
  * closes BOTH codex-h2 findings and a false-offer bug at once:
  *   - Medium (fail-closed on a missing owner org): an orphaned/cross-org/unresolvable artifact is
  *     never writable, so admin is false even for a super-admin — no false positive.
  *   - Low (org-admin membership oracle): admin:true only for apps loadWritable already grants, i.e.
  *     the caller's OWN + org-shared apps — exactly what they already enumerate via GET /artifacts
  *     (listVisible). It reveals nothing new; a same-org OTHER user's PRIVATE app reads not-writable
  *     → admin:false, so it is not an existence oracle for private in-org apps.
  *   - No false offer: admin:true ⟺ H3's edit mode / the follow-up build will actually succeed for
  *     this caller on this app. The panel never promises an edit the gate would then refuse.
  * NOTE: like the H1 gate, loadWritable is org-scoped, so a super-admin is NOT granted cross-org app
  * edit here (a super-admin only edits apps in their own org). If platform-wide cross-org app editing
  * is ever wanted, that is a deliberate policy change to loadWritable/the H1 gate AND this detection
  * together — not a silent divergence. Exported for the unit matrix.
  */
 export function isAppEditor(claims: Pick<JwtClaims, 'role' | 'orgId'>, writableVerdict: 'ok' | 'forbidden' | 'notfound'): boolean {
   if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
   return writableVerdict === 'ok'; // ...and the actor must actually be able to write THIS artifact
 }
 
 /**
  * Detect whether the OPTIONAL platform Bearer on this request can EDIT app `appId`. FAIL-CLOSED and
  * oracle-free: any deviation — no token, a non-Bearer header, or a token that does not clear the
  * standard verification chain — returns false, never throws, never distinguishes a bad token from a
  * not-writable one. The verification is the EXACT chain requireAuth/verifySseToken run (verifyToken
  * + jti + isRevoked + activation-active + tokenEpoch); the edit decision is the EXACT H1 gate
  * (can(canEditApps) + loadWritable). This endpoint does NOT hand-roll a weaker check and adds NO
  * second identity path.
  */
 async function detectAppEditor(authHeader: string | undefined, appId: string): Promise<boolean> {
   const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
   if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
   const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
   if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
+  // Mirror the FULL H1 admission gate, not just its verify+capability+writability legs (codex-h6
+  // Medium): the real edit path is requireAuth (active + NOT billing-locked + epoch) THEN can() +
+  // loadWritable. verifySseToken checks active/epoch but NOT billingLocked, so without this a
+  // billing-locked admin would read admin:true and be OFFERED edit mode (H3) only to be refused
+  // BILLING_LOCKED at POST /jobs - a false offer. A locked/absent activation ⇒ not an editor.
+  const act = getActivation(verified.claims.sub);
+  if (!act || !act.active || act.billingLocked) return false;
   const actor = { userId: verified.claims.sub, orgId: verified.claims.orgId, role: verified.claims.role };
   const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
   return isAppEditor(verified.claims, verdict);
 }
 
 /** What the admission middleware resolves and stashes for the handler + allowance gate. */
 interface AssistantAdmission {
   owner: { userId: string; orgId: string };
   artifactId: string;
   actionManifest: AppActionManifest | null;
 }
 interface AssistantRequest extends Request {
   ekoaAssistant?: AssistantAdmission;
 }
 
 /** The production deps: the assistant's only model egress is the llm/ chokepoint one-shot; grounding
  *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
  *  is passed in by the admission middleware, not here). */
 const prodDeps: AppAssistantDeps = {
   oneShot: runOneShot,
   ground: buildGroundingBlock,
   decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
 };
 
 export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
   const r = Router();
 
   /**
    * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
    * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
    * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
    */
   const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
     const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
     if (resolution.status === 'invalid-id') {
       sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
       return;
     }
     if (resolution.status === 'not-found') {
       sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
       return;
     }
     const app = resolution.app;
 
     // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
     const activation = getActivation(app.ownerUserId);
     if (!activation || activation.active === false) {
       sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
       return;
     }
     if (activation.billingLocked) {
       sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
       return;
     }
 
     // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
     const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
     const orgId = owner?.orgId ?? '';
 
     // The app's declared action manifest (persisted at activation on the artifact data bag).
     // Validate it against the shared contract; absent/invalid → no operate surface (null).
     const art = await artifacts.get(app.appId);
     const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
     const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
     const actionManifest = parsedManifest?.success ? parsedManifest.data : null;
 
     req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
     next();
   };
 
   /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
   const admitGuarded: RequestHandler = (req, res, next) => {
     void admit(req, res, next).catch((err) => {
       console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
       sendError(res, 'INTERNAL', 'Erro interno.');
     });
   };
 
   // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
   const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
diff --git a/api/tests/apps/app-assistant.test.ts b/api/tests/apps/app-assistant.test.ts
index 1fe0e5b..84c1419 100644
--- a/api/tests/apps/app-assistant.test.ts
+++ b/api/tests/apps/app-assistant.test.ts
@@ -323,134 +323,147 @@ describe('GET /api/app-assistant/whoami (H2 fail-closed detection)', () => {
     // same-org admin), which proves detection mirrors the H1 gate and is not an existence oracle.
     await mkUser('owner-1', 'org-owner', 'org-admin');
     await artifacts.insert({ _id: APP_ID, name: 'H2', userId: 'owner-1', orgId: 'org-owner', visibility: 'org' } as never);
     await artifacts.insert({ _id: PRIV_ID, name: 'H2priv', userId: 'owner-1', orgId: 'org-owner', visibility: 'private' } as never);
 
     // Callers.
     await mkUser('admin-owner', 'org-owner', 'org-admin'); // a DIFFERENT admin in the owner org
     await mkUser('super-1', 'org-other', 'super-admin'); // super-admin in a DIFFERENT org (org-scoped edit → not this app)
     await mkUser('super-owner', 'org-owner', 'super-admin'); // super-admin IN the owner org
     await mkUser('admin-other', 'org-other', 'org-admin'); // org-admin of the WRONG org
     await mkUser('user-owner', 'org-owner', 'user'); // owner-org member without canEditApps
     await mkUser('stale-admin', 'org-owner', 'org-admin'); // owner-org admin, token then epoch-staled
 
     for (const u of ['owner-1', 'admin-owner', 'super-1', 'super-owner', 'admin-other', 'user-owner', 'stale-admin']) {
       tokens[u] = (await login(u, 'pw123456', false, loginDeps)).token;
     }
     // Epoch-stale: bump stale-admin's epoch far past its freshly-minted token's iat, so the SAME
     // (otherwise-admin) token is now stale — proving the tokenEpoch leg of the chain rejects it.
     bumpTokenEpoch('stale-admin', Math.floor(Date.now() / 1000) + 100_000);
 
     const app = express();
     app.use(express.json());
     app.use('/api', appAssistantRouter(throwingDeps));
     await new Promise<void>((r) => { server = app.listen(0, () => r()); });
     port = (server.address() as { port: number }).port;
   }, 60_000);
 
   afterAll(async () => {
     server?.close();
     await closeMongo();
     await mem?.stop();
     __resetActivationForTests();
     __resetRevocationsForTests();
   });
 
   const bearer = (u: string, appId: string = APP_ID) => ({ 'x-ekoa-app-id': appId, authorization: `Bearer ${tokens[u]}` });
 
   it('an org-admin of the OWNER org, on the ORG-SHARED app -> 200 { admin:true } (loadWritable ok)', async () => {
     const res = await whoami(bearer('admin-owner'));
     expect(res.status).toBe(200);
     const body = await res.json();
     expect(AppAssistantWhoamiResponse.safeParse(body).success).toBe(true);
     expect(body).toEqual({ admin: true });
   });
 
   it('the artifact owner -> 200 { admin:true } (own artifact, any visibility)', async () => {
     expect(await (await whoami(bearer('owner-1'))).json()).toEqual({ admin: true }); // org-shared
     expect(await (await whoami(bearer('owner-1', PRIV_ID))).json()).toEqual({ admin: true }); // own private draft
   });
 
   it('a super-admin IN the owner org, on the org-shared app -> 200 { admin:true }', async () => {
     const res = await whoami(bearer('super-owner'));
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: true });
   });
 
   it('a super-admin in ANOTHER org -> 200 { admin:false } (app-edit is org-scoped, mirrors the H1 gate; cross-org loadWritable is notfound)', async () => {
     const res = await whoami(bearer('super-1'));
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: false });
   });
 
   it('an org-admin of the owner org, on another member PRIVATE draft -> 200 { admin:false } (loadWritable forbids; closes the in-org private-app existence oracle)', async () => {
     const res = await whoami(bearer('admin-owner', PRIV_ID));
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: false });
   });
 
   it('an org-admin of ANOTHER org -> 200 { admin:false } (never 403 — no cross-org oracle)', async () => {
     const res = await whoami(bearer('admin-other'));
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: false });
   });
 
   it('a plain user of the owner org -> 200 { admin:false } (H1 capability gate)', async () => {
     const res = await whoami(bearer('user-owner'));
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: false });
   });
 
+  it('a BILLING-LOCKED admin -> 200 { admin:false } (codex-h6: mirror the FULL H1 gate; no edit false-offer)', async () => {
+    // owner-1 is an org-admin of the owner org (admin:true normally). Lock their billing: the real
+    // edit path (requireAuth at POST /jobs) would refuse BILLING_LOCKED, so whoami must NOT offer edit.
+    setActivation('owner-1', { active: true, billingLocked: true });
+    try {
+      const res = await whoami(bearer('owner-1'));
+      expect(res.status).toBe(200);
+      expect(await res.json()).toEqual({ admin: false });
+    } finally {
+      setActivation('owner-1', { active: true, billingLocked: false }); // restore for other cases
+    }
+  });
+
   it('NO token -> 200 { admin:false } (never a 401 — token absence is not an oracle)', async () => {
     const res = await whoami({ 'x-ekoa-app-id': APP_ID });
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: false });
   });
 
   it('an INVALID token -> 200 { admin:false } (never a 401)', async () => {
     const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: false });
   });
 
   it('an EXPIRED token (would-be admin) -> 200 { admin:false }', async () => {
     // A structurally-admin token (org-admin of the owner org) but already expired: the verify
     // chain rejects it at verifyToken, so detection is false — expiry alone denies.
     const expired = jwt.sign(
       { sub: 'owner-1', role: 'org-admin', scope: 'user', orgId: 'org-owner', username: 'owner-1', jti: 'expired.1' },
       's',
       { expiresIn: -10 },
     );
     const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${expired}` });
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: false });
   });
 
   it('an EPOCH-STALE token (would-be admin) -> 200 { admin:false }', async () => {
     // stale-admin is an org-admin of the owner org; its token predates the epoch bump, so the
     // tokenEpoch leg of the chain rejects it — a demoted/rotated session cannot detect as admin.
     const res = await whoami(bearer('stale-admin'));
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ admin: false });
   });
 
   it('a malformed X-Ekoa-App-Id -> 400 — the SAME status POST gives (charset check reused)', async () => {
     const bad = { 'x-ekoa-app-id': 'bad app!', authorization: `Bearer ${tokens['admin-owner']}` };
     const wRes = await whoami(bad);
     const pRes = await postAssistant(bad);
     expect(wRes.status).toBe(400);
     expect(pRes.status).toBe(400); // POST rejects the same header identically
     const wBody = (await wRes.json()) as { error: { code: string } };
     expect(wBody.error.code).toBe('VALIDATION_FAILED');
   });
 
   it('the reserved usr. prefix on X-Ekoa-App-Id -> 400 (same as POST)', async () => {
     const res = await whoami({ 'x-ekoa-app-id': 'usr.owner-1', authorization: `Bearer ${tokens['admin-owner']}` });
     expect(res.status).toBe(400);
   });
 
   it('an unknown app id -> 404 { NOT_FOUND } (the SAME existence surface POST already exposes)', async () => {
     const res = await whoami({ 'x-ekoa-app-id': 'no-such-app', authorization: `Bearer ${tokens['admin-owner']}` });
     expect(res.status).toBe(404);
     expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
   });
 });
diff --git a/web/stores/change-requests.ts b/web/stores/change-requests.ts
index 8b60aeb..b424ff8 100644
--- a/web/stores/change-requests.ts
+++ b/web/stores/change-requests.ts
@@ -15,121 +15,132 @@ import { api, tryCall } from '@/lib/api';
 import type { ChangeRequest, ChangeRequestStatus, ChangeRequestQuery } from '@ekoa/shared';
 
 const PAGE_SIZE = 100;
 
 interface ChangeRequestsState {
   requests: ChangeRequest[];
   total: number;
   /** '' = all statuses; otherwise a single status filter (defaults to 'open' at first load). */
   statusFilter: ChangeRequestStatus | '';
   /** super-admin cross-org filter ('' = all orgs). */
   orgId: string;
   isLoading: boolean;
   /** id currently being converted/dismissed (guards double-click + drives the row spinner). */
   actingId: string | null;
   error: string | null;
 
   fetchRequests: () => Promise<void>;
   setStatusFilter: (value: ChangeRequestStatus | '') => void;
   setOrgId: (value: string) => void;
   convert: (id: string) => Promise<void>;
   dismiss: (id: string) => Promise<void>;
   /** Refused-build feed (BRIEF 9a): file a pre-drafted request to the requester's OWN org queue
    *  (no served-app header) so an H1 refusal is never a dead end. `appId` is the edit-refusal
    *  artifact when present (informational; convert re-gates it). */
   fileFromRefusal: (input: { text: string; appId?: string; route?: string }) => Promise<boolean>;
   clearError: () => void;
 }
 
 export const useChangeRequestsStore = create<ChangeRequestsState>()((set, get) => ({
   requests: [],
   total: 0,
   statusFilter: 'open',
   orgId: '',
   isLoading: false,
   actingId: null,
   error: null,
 
   fetchRequests: async () => {
     const { statusFilter, orgId } = get();
     set({ isLoading: true, error: null });
     const query: ChangeRequestQuery = { limit: PAGE_SIZE };
     if (statusFilter) query.status = statusFilter;
     if (orgId) query.orgId = orgId;
     const response = await tryCall(() =>
       api.changeRequests.list(query as unknown as Record<string, unknown>),
     );
     if (response.ok) {
       set({ requests: response.data.items, total: response.data.total, isLoading: false });
     } else {
       set({ error: response.error.message || 'Falha ao carregar os pedidos.', isLoading: false });
     }
   },
 
   setStatusFilter: (value) => {
     set({ statusFilter: value });
     void get().fetchRequests();
   },
 
   setOrgId: (value) => {
     set({ orgId: value });
     void get().fetchRequests();
   },
 
   convert: async (id) => {
     const request = get().requests.find((r) => r.id === id);
     if (!request || get().actingId) return;
     set({ actingId: id, error: null });
     // 1) Start the patch run — the SAME H1-gated follow-up build the dashboard/panel drive. A
     //    request that names an app is a follow-up (artifactId); a refused-build request without
     //    one is a first build. Both are re-gated server-side (canBuildApps/canEditApps).
     const job = await tryCall(() =>
       api.jobs.create({
         kind: 'build',
         description: request.text,
         sessionId: `pedido-${request.id}`,
         language: 'pt',
         ...(request.appId ? { artifactId: request.appId } : {}),
       }),
     );
     if (!job.ok) {
-      set({ actingId: null, error: job.error.message || 'Não foi possível iniciar a alteração.' });
+      // A NOT_FOUND on a request that names an app is the H1 edit gate (loadWritable) refusing the
+      // conversion because the app is not editable by this admin - under the org-scoped edit policy,
+      // a same-org OTHER user's PRIVATE draft is not admin-editable (codex-h6 Low: give an actionable
+      // reason instead of a bare "could not start", so the queue's Converter is never a silent
+      // dead-end). The author must share the app to the organization before it can be edited.
+      const notEditable = Boolean(request.appId) && job.error.status === 404;
+      set({
+        actingId: null,
+        error: notEditable
+          ? 'Esta aplicação é um rascunho privado do autor e não pode ser alterada por si. Peça ao autor para a partilhar com a organização antes de converter o pedido.'
+          : job.error.message || 'Não foi possível iniciar a alteração.',
+      });
       return;
     }
     if (job.data.status !== 'created') {
       // The in-build classifier answered without starting a job: nothing to link. Leave the
       // request open and tell the admin to reformulate.
       set({ actingId: null, error: 'O pedido foi respondido sem criar uma revisão. Reformule o pedido.' });
       return;
     }
     // 2) Link the resulting job and flip the request to converted. Read the id out here, where the
     //    union is narrowed to the 'created' variant (the narrowing does not survive into a closure).
     const jobId = job.data.job.id;
     const converted = await tryCall(() => api.changeRequests.convert({ id: request.id, jobId }));
     set({ actingId: null });
     if (!converted.ok) {
       set({ error: converted.error.message || 'A revisão foi iniciada mas o pedido não foi marcado.' });
     }
     await get().fetchRequests();
   },
 
   dismiss: async (id) => {
     if (get().actingId) return;
     set({ actingId: id, error: null });
     const response = await tryCall(() => api.changeRequests.dismiss({ id }));
     set({ actingId: null });
     if (!response.ok) {
       set({ error: response.error.message || 'Não foi possível dispensar o pedido.' });
       return;
     }
     await get().fetchRequests();
   },
 
   fileFromRefusal: async ({ text, appId, route }) => {
     const response = await tryCall(() =>
       api.changeRequests.file({ text, ...(appId ? { appId } : {}), ...(route ? { route } : {}) }),
     );
     return response.ok;
   },
 
   clearError: () => set({ error: null }),
 }));

codex
The target files are in place and the commit is narrowly scoped. I’m now tracing the actual gate path against `requireAuth`/`/jobs` and checking the client-side 404 handling against the server behavior to ensure the two fixes are complete and didn’t open anything else.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files | rg '("'^|/)(PRD|PLANING|TASKS)'"\\.md"'$|block-review'"\\.md"'$|app-assistant-route'"\\.ts"'$|middleware'"\\.js"'$|middleware'"\\.ts"'$|jobs'"\\.ts"'$|change-requests'"\\.ts"'$|app-assistant'"\\.test\\.ts"'$|activation|loadWritable|verifySseToken'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/services/change-requests.ts
api/src/routes/jobs.ts
api/src/routes/change-requests.ts
api/src/apps/app-assistant-route.ts
api/src/data/activation.ts
api/src/agents/jobs.ts
api/src/auth/middleware.ts
shared/src/jobs.ts
api/tests/auth/activation-auth.test.ts
api/tests/apps/app-assistant.test.ts
docs/autothing/runs/20260712-150958-4bb23640/slices/H6/block-review.md
web/stores/change-requests.ts

exec
/bin/zsh -lc 'codegraph explore "detectAppEditor requireAuth verifySseToken getActivation loadWritable jobs create build app-assistant whoami change request convert 404"' in /Users/ggomes/dev/ekoa-code
 succeeded in 500ms:
## Exploration: detectAppEditor requireAuth verifySseToken getActivation loadWritable jobs create build app-assistant whoami change request convert 404

Found 213 symbols across 94 files.

### Blast radius — what depends on these (update/verify before editing)

- `verifySseToken` (api/src/auth/middleware.ts:59) — 8 callers in `api/src/routes/automations.ts`, `api/src/routes/chat.ts`, `api/src/routes/jobs.ts`, `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `BuildCreateInput` (api/src/agents/build.ts:59) — 7 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/build.test.ts`
- `AppAssistantDeps` (api/src/apps/app-assistant.ts:57) — 8 callers in `api/src/apps/app-assistant-route.ts`, `api/src/apps/app-assistant.ts`; tests: `api/tests/security/assistant-cross-org-isolation.test.ts`, `api/tests/apps/app-assistant.test.ts`

### Relationships

**calls:**
- verifySseToken → isRevoked
- verifySseToken → getActivation
- automationsRouter → verifySseToken
- chatRouter → verifySseToken
- runAppAssistant → inferMode
- runAppAssistant → map
- runAppAssistant → renderPrompt
- runAppAssistant → extractActions
- ask → runAppAssistant
- appAssistantRouter → runAppAssistant
- ... and 236 more

**references:**
- AssistantRequest → AssistantAdmission
- AssistantAdmission → AppActionManifest
- UiActionsResult → AppActionManifest
- assistantToolsFromManifest → AppActionManifest
- manifest → AppActionManifest
- AppAssistantInput → AppActionManifest
- manifest → AppActionManifest
- BuildCreateInput → Actor
- AppAssistantDeps → OneShotOptions
- AppAssistantDeps → LlmAttribution
- ... and 118 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/app-assistant-route.ts — calls(calls), references(references), getActivation(calls), AppAssistantDeps(references), detectAppEditor(function), verifySseToken(calls), loadWritable(calls), AssistantAdmission(interface), AppActionManifest(references), AssistantRequest(interface), +9 more

```typescript
107	 * (can(canEditApps) + loadWritable). This endpoint does NOT hand-roll a weaker check and adds NO
108	 * second identity path.
109	 */
110	async function detectAppEditor(authHeader: string | undefined, appId: string): Promise<boolean> {
111	  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
112	  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
113	  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
114	  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
115	  // Mirror the FULL H1 admission gate, not just its verify+capability+writability legs (codex-h6
116	  // Medium): the real edit path is requireAuth (active + NOT billing-locked + epoch) THEN can() +
117	  // loadWritable. verifySseToken checks active/epoch but NOT billingLocked, so without this a
118	  // billing-locked admin would read admin:true and be OFFERED edit mode (H3) only to be refused
119	  // BILLING_LOCKED at POST /jobs - a false offer. A locked/absent activation ⇒ not an editor.
120	  const act = getActivation(verified.claims.sub);
121	  if (!act || !act.active || act.billingLocked) return false;
122	  const actor = { userId: verified.claims.sub, orgId: verified.claims.orgId, role: verified.claims.role };
123	  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
124	  return isAppEditor(verified.claims, verdict);
125	}
126	
127	/** What the admission middleware resolves and stashes for the handler + allowance gate. */
128	interface AssistantAdmission {
129	  owner: { userId: string; orgId: string };
130	  artifactId: string;
131	  actionManifest: AppActionManifest | null;
132	}
133	interface AssistantRequest extends Request {
134	  ekoaAssistant?: AssistantAdmission;
135	}
136	
137	/** The production deps: the assistant's only model egress is the llm/ chokepoint one-shot; grounding
138	 *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
139	 *  is passed in by the admission middleware, not here). */
140	const prodDeps: AppAssistantDeps = {
141	  oneShot: runOneShot,
142	  ground: buildGroundingBlock,
143	  decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
144	};
145	
146	export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
147	  const r = Router();
148	
149	  /**
150	   * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
151	   * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
152	   * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
153	   */
154	  const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
155	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
156	    if (resolution.status === 'invalid-id') {
157	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
158	      return;
159	    }
160	    if (resolution.status === 'not-found') {
161	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
162	      return;
163	    }
164	    const app = resolution.app;
165	
166	    // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
167	    const activation = getActivation(app.ownerUserId);
168	    if (!activation || activation.active === false) {
169	      sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
170	      return;
171	    }
172	    if (activation.billingLocked) {
173	      sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
174	      return;
175	    }
176	
177	    // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
178	    const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
179	    const orgId = owner?.orgId ?? '';
180	
181	    // The app's declared action manifest (persisted at activation on the artifact data bag).
182	    // Validate it against the shared contract; absent/invalid → no operate surface (null).
183	    const art = await artifacts.get(app.appId);
184	    const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
185	    const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
186	    const actionManifest = parsedManifest?.success ? parsedManifest.data : null;
187	
188	    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
189	    next();
190	  };
191	
192	  /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
193	  const admitGuarded: RequestHandler = (req, res, next) => {
194	    void admit(req, res, next).catch((err) => {
195	      console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
196	      sendError(res, 'INTERNAL', 'Erro interno.');
197	    });
198	  };
199	
200	  // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
201	  const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
202	
203	  r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
204	    const admission = req.ekoaAssistant;
205	    if (!admission) {
206	      sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
207	      return;
208	    }
209	
210	    const parsed = AssistantChatRequest.safeParse(req.body ?? {});
211	    if (!parsed.success) {
212	      sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
213	      return;
214	    }
215	    const body = parsed.data;
216	
217	    try {
218	      const result = await runAppAssistant(
219	        {
220	          message: body.message,
221	          history: body.history,
222	          mode: body.mode,
223	          context: body.context,
224	          owner: admission.owner,
225	          artifactId: admission.artifactId,
226	          actionManifest: admission.actionManifest,
227	        },
228	        deps,
229	      );
230	      const response: AssistantChatResponse = {
231	        reply: result.reply,
232	        mode: result.mode,
233	        ...(result.citations.length > 0 ? { citations: result.citations } : {}),
234	        ...(result.actions.length > 0 ? { actions: result.actions } : {}),
235	      };
236	      res.json(response);
237	    } catch (err) {
238	      console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
239	      sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
240	    }
241	  });
242	
243	  /**
244	   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
245	   *
246	   * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
247	   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "can the
248	   * current viewer EDIT this app?" — the SAME decision the H1 follow-up-build gate makes
249	   * (can(canEditApps) + loadWritable). It NEVER grounds, NEVER bills, NEVER widens admission, and
250	   * issues NO model call (the zero-token GET) — the POST grounding/billing path above stays
251	   * byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged action
252	   * remains gated server-side by the H1 admission plane with this same JWT; `admin: true` here is
253	   * only a HINT the panel may surface (edit mode is H3), and it exactly matches what that edit will
254	   * actually be allowed to do — never a false offer.
255	   *
256	   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
257	   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
258	   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
259	   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
260	   * app existence).
261	   */
262	  const whoami = async (req: Request, res: Response): Promise<void> => {
263	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
264	    if (resolution.status === 'invalid-id') {
265	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
266	      return;
267	    }
268	    if (resolution.status === 'not-found') {
269	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
270	      return;
271	    }
272	
273	    // "admin" == can this caller edit THIS app, decided by the SAME rule the H1 edit gate uses
274	    // (can(canEditApps) + loadWritable on the resolved artifact id). Ownership/org is resolved
275	    // server-side inside loadWritable from the artifact record, NEVER from anything the caller
276	    // supplied. Fail-closed + no oracle: see detectAppEditor / isAppEditor above.
277	    const response: AppAssistantWhoamiResponse = {
278	      admin: await detectAppEditor(req.header('authorization'), resolution.app.appId),
279	    };
280	    res.json(response); // always 200 — the boolean IS the answer
281	  };
282	
283	  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
284	   *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
285	  r.get('/app-assistant/whoami', (req, res) => {
286	    void whoami(req, res).catch((err) => {
287	      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
288	      sendError(res, 'INTERNAL', 'Erro interno.');
289	    });
290	  });
291	
292	  return r;
293	}
294	
```

#### web/stores/change-requests.ts — convert(function)

```typescript
1	'use client';
2	
3	/**
4	 * Change-requests store (operator-run H4). The org-admin queue read + the two admin actions
5	 * (convert / dismiss), plus the refused-build feed's file action.
6	 *
7	 * `GET /api/v1/change-requests`: an org-admin sees its OWN org, a super-admin may pass `orgId`
8	 * to cross orgs (the exact registo scoping). "Converter" starts a patch run the way the panel's
9	 * edit mode does — a follow-up build via `POST /api/v1/jobs` (H1-gated: the org-admin has
10	 * canEditApps + loadWritable on an org app) — then marks the request converted with the job id.
11	 */
12	
13	import { create } from 'zustand';
14	import { api, tryCall } from '@/lib/api';
15	import type { ChangeRequest, ChangeRequestStatus, ChangeRequestQuery } from '@ekoa/shared';
16	
17	const PAGE_SIZE = 100;
18	
19	interface ChangeRequestsState {
20	  requests: ChangeRequest[];
21	  total: number;
22	  /** '' = all statuses; otherwise a single status filter (defaults to 'open' at first load). */
23	  statusFilter: ChangeRequestStatus | '';
24	  /** super-admin cross-org filter ('' = all orgs). */
25	  orgId: string;
26	  isLoading: boolean;
27	  /** id currently being converted/dismissed (guards double-click + drives the row spinner). */
28	  actingId: string | null;
29	  error: string | null;
30	
31	  fetchRequests: () => Promise<void>;
32	  setStatusFilter: (value: ChangeRequestStatus | '') => void;
33	  setOrgId: (value: string) => void;
34	  convert: (id: string) => Promise<void>;
35	  dismiss: (id: string) => Promise<void>;
36	  /** Refused-build feed (BRIEF 9a): file a pre-drafted request to the requester's OWN org queue
37	   *  (no served-app header) so an H1 refusal is never a dead end. `appId` is the edit-refusal
38	   *  artifact when present (informational; convert re-gates it). */
39	  fileFromRefusal: (input: { text: string; appId?: string; route?: string }) => Promise<boolean>;
40	  clearError: () => void;
41	}
42	
43	export const useChangeRequestsStore = create<ChangeRequestsState>()((set, get) => ({
44	  requests: [],
45	  total: 0,
46	  statusFilter: 'open',
47	  orgId: '',
48	  isLoading: false,
49	  actingId: null,
50	  error: null,
51	
52	  fetchRequests: async () => {
53	    const { statusFilter, orgId } = get();
54	    set({ isLoading: true, error: null });
55	    const query: ChangeRequestQuery = { limit: PAGE_SIZE };
56	    if (statusFilter) query.status = statusFilter;
57	    if (orgId) query.orgId = orgId;
58	    const response = await tryCall(() =>
59	      api.changeRequests.list(query as unknown as Record<string, unknown>),
60	    );
61	    if (response.ok) {
62	      set({ requests: response.data.items, total: response.data.total, isLoading: false });
63	    } else {
64	      set({ error: response.error.message || 'Falha ao carregar os pedidos.', isLoading: false });
65	    }
66	  },
67	
68	  setStatusFilter: (value) => {
69	    set({ statusFilter: value });
70	    void get().fetchRequests();
71	  },
72	
73	  setOrgId: (value) => {
74	    set({ orgId: value });
75	    void get().fetchRequests();
76	  },
77	
78	  convert: async (id) => {
79	    const request = get().requests.find((r) => r.id === id);
80	    if (!request || get().actingId) return;
81	    set({ actingId: id, error: null });
82	    // 1) Start the patch run — the SAME H1-gated follow-up build the dashboard/panel drive. A
83	    //    request that names an app is a follow-up (artifactId); a refused-build request without
84	    //    one is a first build. Both are re-gated server-side (canBuildApps/canEditApps).
85	    const job = await tryCall(() =>
86	      api.jobs.create({
87	        kind: 'build',
88	        description: request.text,
89	        sessionId: `pedido-${request.id}`,
90	        language: 'pt',
91	        ...(request.appId ? { artifactId: request.appId } : {}),
92	      }),
93	    );
94	    if (!job.ok) {
95	      // A NOT_FOUND on a request that names an app is the H1 edit gate (loadWritable) refusing the
96	      // conversion because the app is not editable by this admin - under the org-scoped edit policy,
97	      // a same-org OTHER user's PRIVATE draft is not admin-editable (codex-h6 Low: give an actionable
98	      // reason instead of a bare "could not start", so the queue's Converter is never a silent
99	      // dead-end). The author must share the app to the organization before it can be edited.
100	      const notEditable = Boolean(request.appId) && job.error.status === 404;
101	      set({
102	        actingId: null,
103	        error: notEditable
104	          ? 'Esta aplicação é um rascunho privado do autor e não pode ser alterada por si. Peça ao autor para a partilhar com a organização antes de converter o pedido.'
105	          : job.error.message || 'Não foi possível iniciar a alteração.',
106	      });
107	      return;
108	    }
109	    if (job.data.status !== 'created') {
110	      // The in-build classifier answered without starting a job: nothing to link. Leave the
111	      // request open and tell the admin to reformulate.
112	      set({ actingId: null, error: 'O pedido foi respondido sem criar uma revisão. Reformule o pedido.' });
113	      return;
114	    }
115	    // 2) Link the resulting job and flip the request to converted. Read the id out here, where the
116	    //    union is narrowed to the 'created' variant (the narrowing does not survive into a closure).
117	    const jobId = job.data.job.id;
118	    const converted = await tryCall(() => api.changeRequests.convert({ id: request.id, jobId }));
119	    set({ actingId: null });
120	    if (!converted.ok) {
121	      set({ error: converted.error.message || 'A revisão foi iniciada mas o pedido não foi marcado.' });
122	    }
123	    await get().fetchRequests();
124	  },
125	
126	  dismiss: async (id) => {
127	    if (get().actingId) return;
128	    set({ actingId: id, error: null });
129	    const response = await tryCall(() => api.changeRequests.dismiss({ id }));
130	    set({ actingId: null });
131	    if (!response.ok) {
132	      set({ error: response.error.message || 'Não foi possível dispensar o pedido.' });
133	      return;
134	    }
135	    await get().fetchRequests();
136	  },
137	
138	  fileFromRefusal: async ({ text, appId, route }) => {
139	    const response = await tryCall(() =>
140	      api.changeRequests.file({ text, ...(appId ? { appId } : {}), ...(route ? { route } : {}) }),
141	    );
142	    return response.ok;
143	  },
144	
145	  clearError: () => set({ error: null }),
146	}));
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I found the prior block review under `docs/autothing/.../slices/H6/block-review.md`, not at the shorter path from the prompt. I’m reading that plus the auth/jobs slices now so I can compare the fixed behavior against the original findings rather than just the commit message.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,260p' docs/autothing/runs/20260712-150958-4bb23640/slices/H6/block-review.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
Reading additional input from stdin...
OpenAI Codex v0.142.5
--------
workdir: /Users/ggomes/dev/ekoa-code
model: gpt-5.4
provider: openai
approval: never
sandbox: read-only
reasoning effort: medium
reasoning summaries: none
session id: 019f5e06-d9b7-7201-a912-fc84002e73a4
--------
user
BLOCK-LEVEL adversarial SECURITY review in /Users/ggomes/dev/ekoa-code (operator-run H6): review the ENTIRE security block H1-H5 as ONE unit for EMERGENT / CROSS-SLICE defects a per-slice review could not see. Block = commit range e2c165e~1..HEAD (git diff e2c165e~1 HEAD -- api/src shared/src web api/assets; git log --oneline e2c165e~1..HEAD). End to end: H1 replaced a permissive can() stub with a real role->capability matrix (super-admin/org-admin all; user chat+artifacts only; null/unknown nothing), renamed builder->user (idempotent boot migration + a legacy-JWT shim in verifyToken), wired capability gates on ALL app build/edit vectors (POST /jobs first-build canBuildApps / follow-up canEditApps+loadWritable closing a cross-tenant IDOR; artifacts import/fork/bundle-update/file/versions-restore/backend; chat canUseChat; artifact-create canCreateArtifacts), made tokenEpoch+billingLocked durable (survive restart), re-validates writability at follow-up EXECUTION (TOCTOU). H2 GET /api/app-assistant/whoami mirrors the H1 edit gate exactly (can(canEditApps)+loadWritable), fail-closed, oracle-free. H3 served-app edit mode (detect-then-ask opt-in; patch run via /api/v1/jobs with the admin JWT; job-status-poll to terminal; guardedRollback). H4 request-changes queue (users file; org-admins convert to a patch run) with cross-org isolation both directions (filing requires loadReadable; read/convert/dismiss force actor.orgId). H5 the assertion layer. ALREADY-FLAGGED (confirm honestly documented, do not re-litigate): served-app-data-unauthenticated-writes (HIGH, pre-existing, docs/findings.md + docs/security.md, tripwired). HUNT EMERGENT/CROSS-SLICE issues: (a) any slice INTERACTION opening a hole - the H3 edit flow or H4 convert driving /api/v1/jobs bypassing an H1 gate; H2 whoami vs the H1 gate diverging (panel offers an edit the server refuses or vice versa); H4 convert POSTing /jobs for an app the admin cannot edit; (b) role/capability coherence - can ANY role reach a build/edit/queue action the matrix denies via ANY path (chat markers, automation, integration, internal callers)? (c) the builder->user migration + shim: any consumer persisting/trusting a normalized/legacy role wrong across slices? (d) revocation durability across the whole session lifecycle; (e) cross-org isolation consistent across assistant grounding (H5), queue (H4), edit gate (H1/H2/H3) - any plane leaking what another closes? (f) anything the per-slice fixes introduced visible only at block level. CONFIRM the journey suite is coherent. Read docs/security.md, docs/findings.md, slices/H1..H5/impl-notes.md. Read-only cmds OK. Classify High/Medium/Low with file:line + a concrete cross-slice scenario; rebut what you verified coherent. End with exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing the full H1-H5 block as one security unit. I’m starting by loading the repo context files and the block history, then I’ll trace the auth/edit/queue/job paths end to end for cross-slice defects.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -la && printf '\\n---\\n' && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'docs/security.md' -g 'docs/findings.md' -g 'slices/**/impl-notes.md' -g '.codegraph'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/Users/ggomes/dev/ekoa-code
total 1288
drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 14 01:24 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 14 01:27 .git
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
-rw-r--r--@   1 ggomes  staff    1000 Jul 13 15:43 .gitignore
-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
-rw-r--r--@   1 ggomes  staff    2351 Jul 13 16:54 Dockerfile.api
-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
-rw-r--r--@   1 ggomes  staff   54139 Jul 14 01:27 RUN_LOG.md
drwxr-xr-x@  18 ggomes  staff     576 Jul 13 15:42 api
-rw-r--r--@   1 ggomes  staff       5 Jul  6 22:50 backend.port
drwxr-xr-x@   6 ggomes  staff     192 Jul  8 10:26 deploy
drwxr-xr-x@  17 ggomes  staff     544 Jul 14 01:23 docs
drwxr-xr-x@   3 ggomes  staff      96 Jul  8 09:40 ekoa-data
drwxr-xr-x@ 715 ggomes  staff   22880 Jul 11 15:53 node_modules
-rw-r--r--@   1 ggomes  staff  545459 Jul 11 22:20 package-lock.json
-rw-r--r--@   1 ggomes  staff    1751 Jul  8 04:36 package.json
-rw-r--r--@   1 ggomes  staff    1070 Jul  7 01:01 playwright.config.ts
drwxr-xr-x@  11 ggomes  staff     352 Jul 11 22:20 scripts
drwxr-xr-x@   8 ggomes  staff     256 Jul  6 19:06 shared
drwxr-xr-x@   3 ggomes  staff      96 Jul 12 06:09 test-results
-rw-r--r--@   1 ggomes  staff     429 Jul  6 18:55 tsconfig.base.json
drwxr-xr-x@  24 ggomes  staff     768 Jul 13 02:47 web

---
docs/security.md
docs/findings.md

exec
/bin/zsh -lc "git log --oneline e2c165e~1..HEAD && printf '\\n---DIFF NAMES---\\n' && git diff --name-only e2c165e~1 HEAD -- api/src shared/src web api/assets" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-tPtG75ph' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-NtWynb5a' (errno=Operation not permitted)
7d4c089 gate(operator-run/h5): PASSED all gates incl. codex re-review APPROVE - assertion layer + both live journeys PASS; codex High (documented-away app-data gap) re-disposed honestly as a flagged operator decision; ledger 29/31, H block 5/6, only H6 remains
8a21354 fix(operator-run/h5): codex re-review honesty nits - sweep ALL residual 'documented boundary/decision' language (security.md:135 + the test header) to the honest KNOWN-HIGH-GAP framing; canUseChat behavioral pointer now names the concrete tests/contract/chat.test.ts + states honestly it is held by all roles (no deny-path to test)
1515c2e fix(operator-run/h5): codex findings - (HIGH) reframe the served-app /api/app-data unauthenticated-write gap HONESTLY: it is a real pre-existing HIGH gap (any caller knowing an app id can write/delete that app's data cross-tenant; collection write-mode unenforced; app-sso cookie not sent to the data path), NOT a 'documented boundary' - docs/security.md reworded, HIGH findings entry, a TRIPWIRE pinning the current state, flagged as the top operator decision (not silently fixed - it is an architecture change across the app estate, a separate axis from the complete H1-H4 platform layer); (MED) wiring inventory now requires the whoami route to actually call detectAppEditor + names the authoritative behavioral suites (structural check is only a smoke); (LOW) grep gate scans ALL live web source roots. 30/30 security+capabilities; live journeys both PASS
3ad6fb3 feat(operator-run/h5): SECURITY assertion layer - capability matrix + gate-wiring inventory, self-proving grep gates (no PERMISSIVE-STUB marker / no orphan builder ROLE literal survives), cross-org assistant-retrieval isolation (deterministic over the real grounding seam), destructive-action authz asserted server-side (app-sso), + committed live journey drivers (edit + request-changes). Lead fixes folded: assistant-billing.e2e.mjs invalid role builder->user (H1 rename miss); stale capabilities.ts comment; ledgered the unenforced collection-rule write-mode (data-plane, outside H). No production auth code touched
6664569 docs(operator-run/h5): security-assertions delegation brief (capability matrix + grep gates + assistant-retrieval isolation + destructive-action server-authz + live journeys; ASSERTS not fixes - gaps get flagged)
6691d92 gate(operator-run/h4): PASSED all gates incl. codex re-review APPROVE - request-changes queue; codex High (cross-org injection) fixed via loadReadable filing gate + reverified; cross-org isolation both directions; ledger 28/31, H block 4/6
9045e08 test(operator-run/h4): codex re-review nit - assert NO notification fires on a blocked cross-org file via a direct sseManager.emit spy (not only inferred from an empty queue)
67ad136 fix(operator-run/h4): codex High - close cross-org queue INJECTION. Served-app filing (X-Ekoa-App-Id) now requires loadReadable(requester, appId) ok (own or org-shared within the requester's own org) before resolving/stamping/notifying; a cross-org or another-user-private or unknown app id is a uniform 404 (no existence oracle). A user can no longer inject a request into another org's queue. Tests flipped (cross-org file -> 404 + no row/notification) + added (same-org org-shared/own -> ok)
46459de docs(operator-run/h4): reviews - fresh APPROVE (read isolation), codex NEEDS-WORK (High: cross-org queue INJECTION on the write side - filing an org-B app id lands in org-B's queue) - dispatched to the worker
791c7e3 feat(operator-run/h4): SECURITY - request-changes queue + refused-build feed. Users file change requests from inside a served app (route+screen captured, requires login); org-admins see them in a new /pedidos dashboard queue (adminOnly nav, registo-mirrored org scoping) and one-click CONVERT starts a patch run (POST /jobs, H1-gated) or dismiss. Cross-org isolation is server-stamped: orgId always from the app owner (filing) or requester (refused-build), never the caller body; read/convert/dismiss force actor.orgId for org-admins (super-admin across orgs); cross-org convert/dismiss -> 404. Greenfield store+contract+service+route+panel button+web queue; diagram 03 updated
9c16c37 docs(operator-run/h4): finalized request-changes-queue brief (convert=dashboard POSTs /jobs; filing requires login; cross-org isolation is the crux)
53907c9 gate(operator-run/h3): PASSED all gates incl. codex re-review APPROVE - edit mode (detect-then-ask, patch-run preview/approve/guarded-rollback); codex 2 Mediums (SSE-close, stale-sha) fixed+reverified; ledger 27/31, H block 3/6
1901055 fix(operator-run/h3): codex Mediums 2/2 - (M1) an early SSE close no longer reads as 'no change': the flow now POLLS GET /jobs/:id to a terminal status (authoritative, transient-tolerant) before previewing, so a build completing after a stream blip still surfaces its new head; (M2) guardedRollback re-reads versions and restores to the pre-run head ONLY if HEAD is still exactly the head this edit produced (and the target still exists), else refuses with a calm PT-PT message - a concurrent change can never be wiped as collateral
c3ede43 docs(operator-run/h3): reviews - fresh APPROVE, codex NEEDS-WORK (2 Med: SSE-early-close false no-change + stale-sha rollback wipes concurrent changes) - both dispatched to the worker
28a6e12 feat(operator-run/h3): SECURITY - served-app edit mode (admins only). Opt-in edit switch shown ONLY when H2 admin===true (detect-then-ask binding: detection never auto-enables); an edit request becomes a SCOPED FOLLOW-UP BUILD (patch run) over the platform /api/v1/jobs API with the admin JWT (H1-gated server-side), streamed, then preview (new head vs pre-run head) -> APPROVE or one-click ROLLBACK via versions/restore; admin-discovery discreet dismissible banner. Thin front-end, NO new capability/endpoint; visitor-blind POST /api/app-assistant untouched. edit-mode.js fetch-injectable controller + panel phase machine; diagram 04 updated
ba6837f docs(operator-run/h4): confirmed the web nav slot (adminOnly sidebar item + registo-style queue page)
301790a docs(operator-run/h3,h4): edit-mode delegation brief + request-changes-queue draft brief
2059d47 gate(operator-run/h2): PASSED all gates incl. codex re-review APPROVE - whoami admin detection mirrors the H1 edit gate (fail-closed, oracle-free, no false offer); app-edit org-scoped policy documented; ledger 26/31, H block 2/6
e33aa9e test(operator-run/h2): codex-fix re-probe + fresh review APPROVE - mirror-the-gate whoami behaves correctly live (super-admin true only for own-org writable apps, cross-org false)
61c0372 fix(operator-run/h2): codex findings - whoami admin now MIRRORS the H1 edit gate exactly (can(canEditApps) + loadWritable), not the weaker owner-org-admin check. Closes the Medium (orphaned/empty owner org -> notfound -> false, fail-closed) + the Low (admin:true only for own+org-shared apps the caller already sees via listArtifacts, so no in-org private-app existence oracle) + a false-offer bug (detection now == what the follow-up build will actually allow). App edit is org-scoped; super-admin cross-org edit would be a deliberate H1+H2 policy change
b302904 test(operator-run/h2): live whoami fail-closed matrix - no/invalid/cross-org token all 200 {admin:false} (no 401 oracle), super-admin true, malformed app-id 400 == POST (no new existence oracle)
8b6116a feat(operator-run/h2): SECURITY - whoami admin-detection endpoint (identity handoff). GET /api/app-assistant/whoami returns {admin} true iff a verified platform JWT is org-admin/super-admin of the OWNER org AND canEditApps; fail-closed 200 {admin:false} on any token failure (never 4xx - no oracle), shares resolveAssistantApp with POST so it is no new existence oracle, never grounds/bills/widens admission; POST path byte-for-byte visitor-blind. Panel reads localStorage token defensively + calls whoami once + renders only a discreet inert admin badge (detect-then-ask; edit UX is H3). Diagram 10 updated
8637586 docs(operator-run/h2): identity-handoff delegation brief (whoami fail-closed detection + detect-then-ask)
37450a9 gate(operator-run/h1): PASSED all gates incl. codex re-review APPROVE - real capability layer, builder->user, cross-tenant IDOR closed, durable revocation (closes carried billingLocked finding), all app-edit vectors gated; ledger 25/31, H block 1/6
4f1ef4c test(operator-run/h1): codex-fix re-probe - non-app create 201 (canCreateArtifacts retained), import 403 canBuildApps live, app-edit vectors denied on the running stack
49dc5f6 fix(operator-run/h1): codex security findings 4/4 - (High) durable tokenEpoch+billingLocked persisted on UserDoc and loaded at boot so revocation/lock survive restart (also closes the carried LANDING billingLocked-at-boot finding); (High) isAppArtifact-gated the app build/edit vectors beyond /jobs (import/fork->canBuildApps, bundle-update/file/restore/backend/backups->canEditApps), users keep non-app artifacts; (Med) revalidateWritable seam re-checks ownership at follow-up execution (TOCTOU); (Low) follow-up forbidden collapses to 404 (existence-oracle) local to the gate
5fd5a3d docs(operator-run/h1): reviews landed - fresh APPROVE, codex NEEDS-WORK (2 High: non-durable epoch/billingLock revocation + ungated app-edit vectors beyond /jobs; 1 Med TOCTOU; 1 Low existence oracle) + the codex-fix brief
b5e8be6 test(operator-run/h1): live gate probe - user-role first-build 403 canBuildApps, follow-up 403 canEditApps (capability before ownership, no existence leak), chat 202; machine-readable PT-PT refusal envelope proven on the running stack
e2c165e feat(operator-run/h1): SECURITY - real capability layer replaces the permissive stub; builder->user role migration (idempotent boot step + legacy-JWT shim at the verify chokepoint); four gates wired (canBuildApps on first builds, canEditApps+loadWritable on follow-ups CLOSING the cross-tenant follow-up-build IDOR, canUseChat, canCreateArtifacts); machine-readable PT-PT refusals (FORBIDDEN + details.capability); stub test replaced by the real matrix; security.md + diagrams 12/04 updated

---DIFF NAMES---
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-667Jh0zg' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-UqeqRufK' (errno=Operation not permitted)
api/assets/panel-runtime/src/AssistantPanel.css
api/assets/panel-runtime/src/AssistantPanel.jsx
api/assets/panel-runtime/src/change-request.js
api/assets/panel-runtime/src/edit-mode.js
api/src/agents/build.ts
api/src/agents/seams.ts
api/src/agents/streaming.ts
api/src/apps/app-assistant-route.ts
api/src/apps/app-paths.ts
api/src/apps/build-mechanics.ts
api/src/auth/capabilities.ts
api/src/auth/jwt.ts
api/src/auth/service.ts
api/src/auth/users-service.ts
api/src/automation/engine.ts
api/src/automation/service.ts
api/src/data/stores.ts
api/src/integrations/prefetch.ts
api/src/routes/artifacts.ts
api/src/routes/change-requests.ts
api/src/routes/chat.ts
api/src/routes/jobs.ts
api/src/server.ts
api/src/services/change-requests.ts
shared/src/app-assistant.ts
shared/src/capabilities.ts
shared/src/change-request.ts
shared/src/common.ts
shared/src/contract.test.ts
shared/src/events.ts
shared/src/index.ts
web/__tests__/components/usage-page.test.tsx
web/__tests__/components/users-page.test.tsx
web/__tests__/navigation.test.ts
web/app/(dashboard)/pedidos/page.tsx
web/app/(dashboard)/users/page.tsx
web/lib/api/index.ts
web/lib/navigation.ts
web/locales/en.ts
web/locales/pt.ts
web/locales/types.ts
web/next-env.d.ts
web/stores/billing.ts
web/stores/change-requests.ts
web/stores/users.ts

codex
The block history is loaded. Next I’m reading the security docs and H1-H5 implementation notes, then I’ll trace the concrete server paths that join those slices: token verification, capability checks, assistant `whoami`, change-request convert, and `/jobs` execution.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "printf 'PRD/PLANING/TASKS\\n' && for f in PRD.md PLANING.md TASKS.md; do if [ -f \""'$f" ]; then echo "--- $f ---"; sed -n '"'1,220p' \""'$f"; fi; done' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
PRD/PLANING/TASKS

exec
/bin/zsh -lc "printf '%s\\n' '--- docs/security.md ---' && sed -n '1,260p' docs/security.md && printf '%s\\n' '\\n--- docs/findings.md ---' && sed -n '1,260p' docs/findings.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
--- docs/security.md ---
# Security

The binding security invariants, the anonymisation pipeline, the access-control model, and the
incident-response + secure-development posture. Every invariant names its enforcement home.

## The numbered invariants (ch09)

Eleven carried invariants; each has a mechanical enforcement home (lint, grep gate, boot gate, or a
named test suite).

1. **No Anthropic access outside `llm/`.** Every Anthropic byte flows through `api/src/llm/`; no
   model call exists in runtime platform paths. Enforced by ESLint `no-restricted-imports` +
   the `api.anthropic.com`/`@anthropic-ai/` grep gate + the attribution-tag test gate.
2. **Egress controls.** (a) Model-bound anonymisation before Anthropic (below); (b) client-bound
   error sanitisation - `services/sanitizeOutbound` runs at exactly two egress points (the SSE event
   serializer and the Express error middleware), replacing any provider-identifying or provider-auth
   text wholesale. No provider identity ("Anthropic"/"Claude"/auth markers) ever reaches a user, on
   SSE or REST. Test gate injects a provider-auth error and asserts neither leaks.
3. **Single audit write path.** All audit logging flows through one `logActivity(user, category,
   type, description, metadata?)` in `data/`; direct writes to the activity collection are grep-
   banned. Writes are best-effort (a persistence failure is swallowed, never fails the domain action)
   and carry `orgId` for the org-scoped Registo read surface.
4. **Centrally managed model credentials.** One AES-encrypted `credentials` singleton per environment
   (`_id: 'default'`), two auth modes as config (`oauth` / `api-key`), no per-user ad hoc keys, no
   `~/.claude` fallback. The SDK subprocess env builder deletes any inherited provider env
   (`SCRUBBED_PROVIDER_ENV`: `ANTHROPIC_API_KEY`/`ANTH_API_KEY`/`ANTHROPIC_BASE_URL`) and injects
   exactly one credential + the chokepoint base URL. Grep gate: no provider-credential env name
   appears outside the `api/src/llm/` custody code.
5. **Org + user scoping on every data access; single multi-org process.** Scope resolution in `data/`
   is the only query constructor and requires org + user context; an unscoped query is inexpressible
   and routes never import `data/`. Ownership mismatch returns uniform not-found (never leaks
   existence). Enforced by the cross-org adversarial suite and in-org sharing tests.
6. **Credential encryption at rest; key mandatory; single crypto module.** One AES-256-GCM
   implementation in `data/`; `ENCRYPTION_KEY` absent = refuse to boot in every environment; no
   default key constant anywhere (grep gate).
7. **Secret guard on code egress.** User-app code leaves through exactly three doors (version
   snapshot commit, GitHub mirror push, download zip); each runs the secret scanner. A hit blocks:
   `commit-blocked` audit row on snapshot, `422 SECRET_GUARD_BLOCKED` on download.
8. **SSRF guard on platform fetches of user-supplied URLs** (brand research, knowledge crawl/seed,
   uploaded links) via the guarded fetcher in `services/`. Scope boundary stated honestly: user-
   defined integration actions call arbitrary user endpoints by design and are not SSRF-gated.
9. **Webhook HMAC + dedup + audit.** Raw-body HMAC (verifier sees unmodified bytes - boot self-test),
   disabled-check AFTER signature (410 signed / 401 unsigned), dedup on `UNIQUE(trigger_id,
   dedup_key)` returning `{duplicate:true}`, and a `webhook_audit` row per outcome.
10. **Sandbox path confinement.** Every user-derived filesystem path resolves through the symlink-
    hardened `resolveWithinJail`/safe-path helper in `services/`, jailing it to the owner sandbox;
    traversal/absolute/symlink fixtures all fail with uniform not-found. Covers artifact files AND the
    automation `file.read`/`file.write` operations (P-15).
11. **Production guard on default secrets.** JWT secret fails closed on default/unset in a
    production-like environment; `ENCRYPTION_KEY` is stricter - mandatory everywhere.

Fail-closed boot gates (`config.ts` boot): config secrets (fatal), App-SSO redirect URI (fatal),
storage backend (fatal), Claude credential init (non-fatal - agent calls fail until healed), webhook
raw-body self-test (non-fatal), port collision EADDRINUSE (fatal).

## Tool-less anti-injection agents (§5.6.4)

Agents whose only input is untrusted external/brand content run **tool-less** by design so a prompt-
injection attempt has no tool to reach: `brand-research` and the served-app assistant produce
proposals only. All model output and user content is untrusted input - nothing model-generated is
interpolated into queries, shell commands, or privileged calls without validation; generated apps are
static client bundles under a strict CSP with no server-side eval ever.

## Anonymisation pipeline (ch17)

The pipeline is a submodule of the chokepoint (`llm/anonymise/`), invoked by `llm/client.ts` after
the payload is assembled and before any Anthropic request, and again on every response and streamed
delta. Because the chokepoint is the only transport, a caller cannot skip it.

Per request: **collect** all model-bound text; **detect** sensitive spans on the delta only (never
the tokenized prefix - preserves prompt caching); **tokenize** each span into a deterministic,
format-preserving fake recorded in the session vault; **forward** tagged with a per-request
correlation id; **de-tokenize** the response, including `tool_use` argument blocks, streaming with
straddle buffering.

Detection layers, all behind one interface: (a) PT structured-ID recognizers (regex + checksum:
NIF/NIPC/NISS/utente/CC/IBAN-PT/CITIUS) - near-certain; (b) the **per-org deny-list** (the firm's
client/matter/party names, matched literally) - itself secret material, so it is AES-encrypted with
an org-scoped key, access-logged, and never sent to Anthropic; (c) a recall-biased PT-PT NER head
(in-process ONNX). Fail-closed: if (a) or (b) is unavailable the request is refused, not forwarded
un-tokenized; (c) is best-effort and degrades without failing the request. Structured-ID fakes are
minted with a **deliberately invalid checksum** so a fake can never collide with a real identifier.

The vault (value->token map) is per-session, **in-memory, TTL, never persisted, cleared on session
end** - a re-identification key that does not exist cannot be produced. It is keyed by the hosted
conversation id so tokens stay consistent across delegated local turns. Audit is **metadata only**
(entity classes, counts, correlation id, payload hash - never bodies, never the vault), async, hash-
chained and tamper-evident, folded into the single Registo write path. The payload-capture harness
asserts every planted synthetic value appears tokenized (never cleartext) in every captured outbound

exec
/bin/zsh -lc 'codegraph explore "requireAuth verifySseToken loadWritable getActivation POST /api/v1/jobs artifactId change requests NOT_FOUND org-scoped edit policy"' in /Users/ggomes/dev/ekoa-code
 succeeded in 468ms:
## Exploration: requireAuth verifySseToken loadWritable getActivation POST /api/v1/jobs artifactId change requests NOT_FOUND org-scoped edit policy

Found 183 symbols across 68 files.

### Blast radius — what depends on these (update/verify before editing)

- `verifySseToken` (api/src/auth/middleware.ts:59) — 8 callers in `api/src/routes/automations.ts`, `api/src/routes/chat.ts`, `api/src/routes/jobs.ts`, `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `Scope` (api/src/data/collections-engine.ts:65) — 10 callers in `api/src/apps/app-data-access.ts`, `api/src/data/collections-engine.ts`; ⚠️ no covering tests found
- `getActivation` (api/src/data/activation.ts:54) — 12 callers in `api/src/auth/middleware.ts`, `api/src/bridge/server.ts`, `api/src/auth/service.ts`, `api/src/apps/app-assistant-route.ts`; tests: `api/tests/auth/role-migration.test.ts`
- `requireAuth` (api/src/auth/middleware.ts:22) — 35 callers in `api/src/routes/auth.ts`, `api/src/routes/memories.ts`, `api/src/routes/users.ts`, `api/src/routes/sessions.ts` +13 more; ⚠️ no covering tests found
- `writable` (api/src/routes/artifacts.ts:66) — 1 caller in `api/src/routes/artifacts.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- verifySseToken → isRevoked
- verifySseToken → getActivation
- automationsRouter → verifySseToken
- chatRouter → verifySseToken
- requireAuth → getActivation
- requireAuth → fail
- writable → loadWritable
- createBuildMechanics → loadWritable
- memoriesRouter → map
- sessionsRouter → map
- ... and 338 more

**references:**
- scopeFor → Scope
- docId → Scope
- list → Scope
- get → Scope
- create → Scope
- fail → ErrorCode
- verifySseToken → ErrorCode
- authRouter → Router
- memoriesRouter → Router
- usersRouter → Router
- ... and 70 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/auth/middleware.ts — verifySseToken(function), requireAuth(function), fail(function), AuthedRequest(interface), requireRole(function), middleware.ts(file)

```typescript
1	/**
2	 * The auth middleware (ch03 §3.2, CONV-1) — the first of the three admission planes
3	 * (ch09 §9.7.1). Order: verify JWT → revocation check → activation check. A deactivated
4	 * account fails 403 ACCOUNT_DISABLED; a billing-locked account fails 402 BILLING_LOCKED;
5	 * these run on EVERY authenticated /api/v1 request (no route opts out).
6	 */
7	import type { Request, Response, NextFunction } from 'express';
8	import { ERROR_STATUS, type ErrorCode } from '@ekoa/shared';
9	import { verifyToken, type JwtClaims } from './jwt.js';
10	import { isRevoked } from './revocation.js';
11	import { getActivation } from '../data/activation.js';
12	
13	export interface AuthedRequest extends Request {
14	  user?: JwtClaims;
15	}
16	
17	function fail(res: Response, code: ErrorCode, message: string): void {
18	  res.status(ERROR_STATUS[code]).json({ error: { code, message } });
19	}
20	
21	/** Bearer-JWT middleware for /api/v1 (except the closed exemption list). */
22	export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
23	  const header = req.header('authorization') ?? '';
24	  const m = /^Bearer\s+(.+)$/i.exec(header);
25	  if (!m) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
26	  let claims: JwtClaims;
27	  try {
28	    claims = verifyToken(m[1] as string);
29	  } catch (e) {
30	    const expired = e instanceof Error && e.name === 'TokenExpiredError';
31	    return fail(res, expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
32	  }
33	  // A minted token ALWAYS carries a jti (jwt.ts). A token without one cannot be revoked,
34	  // so it is treated as invalid (a revocation bypass otherwise — ch09 §9.6, P-03).
35	  if (!claims.jti) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
36	  if (isRevoked(claims.jti)) {
37	    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
38	  }
39	  // Activation admission (write-through map; immediate, no TTL wait). Fail CLOSED on a
40	  // cache miss, but as UNAUTHENTICATED: an unknown subject is a stale/forged token
41	  // (deleted user, reset store), not a deactivated account. §3.3 reserves ACCOUNT_DISABLED
42	  // for active=false; a 401 lets clients end the dead session instead of showing the
43	  // blocked-account state for a user that no longer exists.
44	  const act = getActivation(claims.sub);
45	  if (!act) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
46	  if (!act.active) return fail(res, 'ACCOUNT_DISABLED', 'A sua conta está bloqueada. Contacte o suporte.');
47	  // Token-epoch check: a token issued before the user's current epoch is invalid (its role/
48	  // active state is stale — e.g. an admin demoted after this token was minted). ch09 §9.6.
49	  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) {
50	    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
51	  }
52	  if (act.billingLocked) return fail(res, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');
53	  req.user = claims;
54	  next();
55	}
56	
57	/** Token-query auth for the four SSE endpoints (CONV-1: EventSource cannot set headers).
58	 *  Verifies the ?token=, revocation, and activation. Returns the claims or an error code. */
59	export function verifySseToken(token: string | undefined): { ok: true; claims: JwtClaims } | { ok: false; status: number; code: ErrorCode } {
60	  if (!token) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
61	  let claims: JwtClaims;
62	  try {
63	    claims = verifyToken(token);
64	  } catch {
65	    return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
66	  }
67	  if (!claims.jti || isRevoked(claims.jti)) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
68	  const act = getActivation(claims.sub);
69	  if (!act) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
70	  if (!act.active) return { ok: false, status: 403, code: 'ACCOUNT_DISABLED' };
71	  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
72	  return { ok: true, claims };
73	}
74	
75	/** Role gate — use after requireAuth for org-admin / super-admin endpoints. */
76	export function requireRole(...roles: JwtClaims['role'][]) {
77	  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
78	    if (!req.user || !roles.includes(req.user.role)) {
79	      return fail(res, 'FORBIDDEN', 'Sem permissão.');
80	    }
81	    next();
82	  };
83	}
```

#### api/src/data/activation.ts — getActivation(function), ActivationState(interface), map(constant)

```typescript
1	/**
2	 * The activation cache (ch09 §9.7.1, Amendment 2). An in-memory map with write-through
3	 * invalidation: a `PATCH /users/:id { active }` write updates this map synchronously in
4	 * the same operation, so deactivation is effective immediately with NO TTL wait. Sound
5	 * under FIXED-8 (single process): the in-memory map is authoritative for the running process.
6	 * The three admission planes (auth middleware, served-app plane, bridge plane) all consult
7	 * this one map. Two gated facts: `active` and an account-level billing lock.
8	 */
9	export interface ActivationState {
10	  active: boolean;
11	  billingLocked: boolean;
12	  /** Tokens issued before this epoch (unix seconds) are invalid. Bumped on deactivation and
13	   *  on role change, so those changes revoke ALL of the user's outstanding tokens at once —
14	   *  a demoted admin cannot keep a stale privileged JWT (ch09 §9.6, no per-user jti index). */
15	  tokenEpoch: number;
16	}
17	
18	const map = new Map<string, ActivationState>();
19	
20	/** Boot-load the map from the users store (called at boot; TTL refresh is a safety net only). */
21	export function loadActivation(entries: Array<{ userId: string; active: boolean; billingLocked?: boolean; tokenEpoch?: number }>): void {
22	  map.clear();
23	  for (const e of entries) map.set(e.userId, { active: e.active, billingLocked: e.billingLocked ?? false, tokenEpoch: e.tokenEpoch ?? 0 });
24	}
25	
26	/** Drop a user from the map entirely (account DELETION). `getActivation` then returns undefined
27	 *  and every admission plane fails CLOSED (an unknown subject is never active), so a deleted
28	 *  user's outstanding tokens die at once instead of surviving to their JWT expiry — and, with
29	 *  /auth/refresh mounted (F1), instead of being re-signable indefinitely. */
30	export function clearActivation(userId: string): void {
31	  map.delete(userId);
32	}
33	
34	/** Bump the user's token epoch to `epochSec`, invalidating every token issued earlier. */
35	export function bumpTokenEpoch(userId: string, epochSec: number): void {
36	  const cur = map.get(userId) ?? { active: true, billingLocked: false, tokenEpoch: 0 };
37	  map.set(userId, { ...cur, tokenEpoch: epochSec });
38	}
39	
40	/** Write-through: called in the SAME operation as the store write for `active`/billing lock.
41	 *  `tokenEpoch` is preserved from the existing entry unless explicitly provided. */
42	export function setActivation(userId: string, state: { active: boolean; billingLocked: boolean; tokenEpoch?: number }): void {
43	  const prev = map.get(userId);
44	  map.set(userId, { active: state.active, billingLocked: state.billingLocked, tokenEpoch: state.tokenEpoch ?? prev?.tokenEpoch ?? 0 });
45	}
46	
47	/**
48	 * Consult the cache. Returns `undefined` for an unknown user — the map is boot-loaded with
49	 * EVERY user and every creation is write-through, so a miss means the subject is not a
50	 * current user (a stale or forged token). Callers fail CLOSED on a miss (never fail-open:
51	 * an unknown subject must not be treated as active, or a deactivation lost from the cache
52	 * would reopen access — ch09 §9.7.1, the map is authoritative for the running process).
53	 */
54	export function getActivation(userId: string): ActivationState | undefined {
55	  return map.get(userId);
56	}
57	
58	export function __resetActivationForTests(): void {
59	  map.clear();
60	}
```

#### api/src/apps/app-paths.ts — loadWritable(function), isAppArtifact(function), getArtifactById(function), setFeaturedFlag(function), projectDirFor(function), OwnershipVerdict(type_alias), newProjectDir(function), patchArtifactData(function)

```typescript
1	/**
2	 * Shared project-directory resolution + artifact ownership helpers for the
3	 * artifact FAMILY (ch07 §7.9-7.13). Ported from the old `resolveSourceProjectDir`
4	 * / `projectDirFor` logic (services/artifact-fork.ts, services/artifact-bundle.ts),
5	 * adapted to the ekoa-code `artifacts` store (ArtifactDoc) and the injected-seam
6	 * boundaries.
7	 *
8	 * A registered app lives at `<sandboxRoot>/user-<userId>/<appId>` unless the row
9	 * records its own `data.projectDir` (the common case for chat-session builds).
10	 * A seeded featured artifact serves from `<featuredArtifactDir(id)>/scaffold`.
11	 */
12	import { existsSync } from 'node:fs';
13	import { join } from 'node:path';
14	import { artifacts } from '../data/stores.js';
15	import type { ArtifactDoc } from './artifacts-service.js';
16	import type { Actor } from '../data/scoped.js';
17	import { resolveWithinJail, sandboxRoot, UnsafePathError } from '../services/safe-path.js';
18	import { featuredArtifactDir } from './featured-seeder.js';
19	
20	const SEEDED_FROM = 'assets/featured-artifacts';
21	
22	/** The deterministic sandbox layout the registry boot-scan expects — always inside the jail. */
23	function defaultProjectDir(art: ArtifactDoc): string {
24	  return join(sandboxRoot(), `user-${art.userId}`, art._id);
25	}
26	
27	/**
28	 * The jail-resolved `data.projectDir` a row records, or undefined when absent or escaping.
29	 * `data` is a client-influenced bag, so NO consumer may read `data.projectDir` raw: resolve it
30	 * through the owner sandbox jail (ch09 invariant 10, FIXED-8) and drop it if it escapes — never
31	 * hand back the attacker path. This closes the follow-up build sandbox-escape vector where a
32	 * PATCHed `data.projectDir` would otherwise become an agent run's cwd/HOME or a build source.
33	 */
34	export function recordedProjectDir(data: Record<string, unknown>): string | undefined {
35	  const recorded = data.projectDir;
36	  if (typeof recorded !== 'string' || recorded.length === 0) return undefined;
37	  try {
38	    return resolveWithinJail(sandboxRoot(), recorded);
39	  } catch (err) {
40	    if (!(err instanceof UnsafePathError)) throw err;
41	    return undefined;
42	  }
43	}
44	
45	/** The on-disk working copy for an artifact's source tree (see file header). */
46	export function projectDirFor(art: ArtifactDoc): string {
47	  const data = (art.data ?? {}) as Record<string, unknown>;
48	  // Seeded featured artifacts serve from the versioned scaffold dir (server-derived, already safe).
49	  if (art.featured === true && data.seededFrom === SEEDED_FROM) {
50	    return join(featuredArtifactDir(art._id), 'scaffold');
51	  }
52	  // A recorded projectDir wins (session-keyed builds record it explicitly), jail-resolved.
53	  return recordedProjectDir(data) ?? defaultProjectDir(art);
54	}
55	
56	/** The fresh working-copy dir a NEW artifact (fork/import) owns. */
57	export function newProjectDir(ownerUserId: string, appId: string): string {
58	  return join(sandboxRoot(), `user-${ownerUserId}`, appId);
59	}
60	
61	/** Absolute path to an artifact's built backend bundle, or null when absent. */
62	export function backendBundlePath(art: ArtifactDoc): string | null {
63	  const bundle = join(projectDirFor(art), 'dist-backend', 'backend.mjs');
64	  return existsSync(bundle) ? bundle : null;
65	}
66	
67	/**
68	 * Is this artifact a BUILT app — a code sandbox the app build/edit capabilities govern (H1 HIGH-2)?
69	 * The primary, reliable signal is a recorded `data.projectDir`: ONLY an artifact produced by the
70	 * build pipeline (`prepareFirstBuild`) carries one — a bare `POST /artifacts` record does not, and
71	 * that projectDir is what feeds every code-editing route (`projectDirFor`). The secondary signal is
72	 * a stored `data.artifactType === 'app'` (a pre-build row that named its type before a sandbox
73	 * existed). An artifact matching NEITHER is a non-app artifact a plain `user` may still manage
74	 * (canCreateArtifacts) — the gates below only tighten APP build/edit, never generic artifact CRUD.
75	 */
76	export function isAppArtifact(art: ArtifactDoc): boolean {
77	  const data = (art.data ?? {}) as Record<string, unknown>;
78	  if (typeof data.projectDir === 'string' && data.projectDir.length > 0) return true;
79	  return data.artifactType === 'app';
80	}
81	
82	export type OwnershipVerdict = 'ok' | 'notfound' | 'forbidden';
83	
84	/**
85	 * Load an artifact the actor may READ: own (any visibility) or org-shared. A
86	 * private row of another user (and any cross-org row) is a uniform not-found
87	 * (ownership-mismatch parity, ch04). Mirrors OwnerVisibilityScoped.getVisible.
88	 */
89	export async function loadReadable(actor: Actor, id: string): Promise<ArtifactDoc | null> {
90	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
91	  if (!art) return null;
92	  if (art.orgId !== actor.orgId) return null;
93	  if (art.userId === actor.userId) return art;
94	  if (art.visibility === 'org') return art;
95	  return null;
96	}
97	
98	/**
99	 * Load an artifact the actor may WRITE: own always, org-shared by any org member.
100	 * A private row of another user → forbidden; a missing/cross-org row → notfound.
101	 * Mirrors OwnerVisibilityScoped.writeGuard.
102	 */
103	export async function loadWritable(
104	  actor: Actor,
105	  id: string,
106	): Promise<{ verdict: OwnershipVerdict; art?: ArtifactDoc }> {
107	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
108	  if (!art || art.orgId !== actor.orgId) return { verdict: 'notfound' };
109	  if (art.userId === actor.userId) return { verdict: 'ok', art };
110	  if (art.visibility === 'org') return { verdict: 'ok', art };
111	  return { verdict: 'forbidden', art };
112	}
113	
114	/** Merge a patch into an artifact's `data` bag and persist. */
115	export async function patchArtifactData(
116	  id: string,
117	  patch: Record<string, unknown>,
118	): Promise<ArtifactDoc | null> {
119	  return (await artifacts.update(id, (a) => {
120	    const data = { ...((a.data as Record<string, unknown>) ?? {}), ...patch };
121	    return { ...a, data };
122	  })) as ArtifactDoc | null;
123	}
124	
125	/** Cross-org fetch by id (super-admin platform paths only; the route enforces the role). */
126	export async function getArtifactById(id: string): Promise<ArtifactDoc | null> {
127	  return (await artifacts.get(id)) as ArtifactDoc | null;
128	}
129	
130	/** Platform-wide featured toggle + rank (ch07 §7.13; super-admin only, route-enforced). */
131	export async function setFeaturedFlag(
132	  id: string,
133	  featured: boolean,
134	  featuredRank?: number,
135	): Promise<ArtifactDoc | null> {
136	  return (await artifacts.update(id, (a) => ({
137	    ...a,
138	    featured,
139	    ...(featuredRank !== undefined ? { featuredRank } : {}),
140	  }))) as ArtifactDoc | null;
141	}
```

#### api/src/apps/artifacts-service.ts — scoped(constant), ArtifactDoc(interface), listArtifacts(function), artifactView(function), createArtifact(function), getVisibleArtifact(function), stripReservedDataKeys(function), patchArtifact(function), deleteArtifact(function), generateSlug(function)

```typescript
1	/**
2	 * Artifacts service (ch03 §3.8.9). Owner+visibility scoped (private|org). Slug uniqueness via
3	 * the `slugs` reservation collection (deterministic-_id insert). Featured surfaces regardless
4	 * of owner. Deterministic slug generation (no model call — FIXED-3, ch07 §7.8).
5	 */
6	import { artifacts, slugs } from '../data/stores.js';
7	import { OwnerVisibilityScoped, type Actor } from '../data/scoped.js';
8	import type { Doc } from '../data/store.js';
9	import { indexSlug } from './slug-index.js';
10	import { getArtifactScreenshotUrl } from '../services/artifact-screenshot.js';
11	
12	export interface ArtifactDoc extends Doc {
13	  name: string;
14	  slug?: string;
15	  userId: string;
16	  orgId: string;
17	  visibility: 'private' | 'org';
18	  featured?: boolean;
19	  shareable?: boolean;
20	  status?: string;
21	  data?: Record<string, unknown>;
22	  sharedData?: boolean;
23	}
24	
25	export interface Deps { now: () => number; genId: () => string }
26	
27	/**
28	 * Keys inside an artifact's `data` bag that ONLY server build/fork/bundle/featured machinery may
29	 * write. A client PATCH must never set these: `data.projectDir` in particular feeds
30	 * `projectDirFor()` and thus the follow-up build sandbox cwd/HOME (a path-injection →
31	 * sandbox-escape vector, ch09). The route strips them at the boundary and `patchArtifact` strips
32	 * them again before merging onto the existing bag (defense in depth), so a client can neither
33	 * overwrite nor wipe them.
34	 */
35	export const RESERVED_ARTIFACT_DATA_KEYS: readonly string[] = [
36	  'projectDir', 'appUrl', 'sessionId', 'sdkSessionId',
37	  'seededFrom', 'seededVersion', 'updateAvailable',
38	  'importedFrom', 'forkedFrom', 'lastBundleUpdateAt', 'customized',
39	  // Server-owned build outputs, set ONLY at activation from the app's own project
40	  // (never client-writable via the artifact patch route): the C2 action registry
41	  // and its classification, and the E1 tour capture. `tours` is served publicly at
42	  // GET /api/demos/:appId, so a client-writable `tours` would be a stored-content
43	  // injection into that surface — reserve it (and its sibling error/manifest keys).
44	  'actionManifest', 'artifactType', 'tours', 'toursError',
45	];
46	
47	/** Drop every server-owned reserved key from a client-supplied `data` bag (see the constant). */
48	export function stripReservedDataKeys(data: Record<string, unknown>): Record<string, unknown> {
49	  const out: Record<string, unknown> = {};
50	  for (const [k, v] of Object.entries(data)) {
51	    if (!RESERVED_ARTIFACT_DATA_KEYS.includes(k)) out[k] = v;
52	  }
53	  return out;
54	}
55	
56	const scoped = new OwnerVisibilityScoped<ArtifactDoc>(artifacts as never);
57	
58	export function artifactView(a: ArtifactDoc) {
59	  return { id: a._id, name: a.name, slug: a.slug, userId: a.userId, orgId: a.orgId, visibility: a.visibility, featured: !!a.featured, shareable: !!a.shareable, status: a.status, screenshotUrl: getArtifactScreenshotUrl(a._id) };
60	}
61	
62	const STOPWORDS = new Set(['a', 'o', 'de', 'da', 'do', 'the', 'and', 'e']);
63	
64	/** Deterministic slug (ch07 §7.8): 2-4 lowercase hyphenated words, strip stop-words,
65	 *  numeric suffix on collision. No model call. */
66	export async function generateSlug(name: string, deps: Deps): Promise<string> {
67	  const words = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter((w) => w && !STOPWORDS.has(w)).slice(0, 4);
68	  const base = words.join('-') || 'app';
69	  if (await slugs.insert({ _id: base, artifactId: '' })) return base;
70	  for (let n = 2; n <= 99; n++) {
71	    if (await slugs.insert({ _id: `${base}-${n}`, artifactId: '' })) return `${base}-${n}`;
72	  }
73	  return `${base}-${deps.now().toString(36)}`;
74	}
75	
76	export async function listArtifacts(actor: Actor): Promise<{ items: ArtifactDoc[]; featured: ArtifactDoc[] }> {
77	  const visible = await scoped.listVisible(actor);
78	  const featured = ((await artifacts.find({ featured: true })) as ArtifactDoc[]);
79	  return { items: visible, featured };
80	}
81	
82	export async function createArtifact(actor: Actor, input: { name: string; visibility?: 'private' | 'org' }, deps: Deps): Promise<ArtifactDoc> {
83	  const id = deps.genId();
84	  const slug = await generateSlug(input.name, deps);
85	  await slugs.put({ _id: slug, artifactId: id }); // point the reservation at the new artifact
86	  indexSlug(slug, id); // keep the in-memory serving index current (ch07 §7.8)
87	  const doc: ArtifactDoc = { _id: id, name: input.name, slug, userId: actor.userId, orgId: actor.orgId, visibility: input.visibility ?? 'private', status: 'draft' };
88	  await artifacts.insert(doc as never);
89	  return doc;
90	}
91	
92	export async function getVisibleArtifact(actor: Actor, id: string): Promise<ArtifactDoc | null> {
93	  return scoped.getVisible(actor, id);
94	}
95	
96	export async function patchArtifact(actor: Actor, id: string, patch: Record<string, unknown>): Promise<{ verdict: 'ok' | 'notfound' | 'forbidden'; artifact?: ArtifactDoc }> {
97	  const guard = await scoped.writeGuard(actor, id);
98	  if (guard.verdict !== 'ok') return { verdict: guard.verdict };
99	  // slug change checks uniqueness via the reservation collection.
100	  if (typeof patch.slug === 'string' && patch.slug !== guard.row!.slug) {
101	    const ok = await slugs.insert({ _id: patch.slug, artifactId: id });
102	    if (!ok) return { verdict: 'forbidden' }; // slug taken — surfaced as SLUG_TAKEN at the route
103	    indexSlug(patch.slug, id); // serving resolves the new slug immediately (edits never orphan data)
104	  }
105	  const updated = (await artifacts.update(id, (a) => {
106	    const next = { ...a, ...patch } as ArtifactDoc;
107	    // A client `data` patch MERGES onto the existing bag (never a wholesale replace) with the
108	    // server-owned reserved keys stripped, so the client can neither overwrite nor wipe them.
109	    if (patch.data && typeof patch.data === 'object' && !Array.isArray(patch.data)) {
110	      const existing = (a.data as Record<string, unknown> | undefined) ?? {};
111	      next.data = { ...existing, ...stripReservedDataKeys(patch.data as Record<string, unknown>) };
112	    }
113	    return next;
114	  })) as ArtifactDoc;
115	  return { verdict: 'ok', artifact: updated };
116	}
117	
118	export async function deleteArtifact(actor: Actor, id: string): Promise<'ok' | 'notfound' | 'forbidden'> {
119	  const guard = await scoped.writeGuard(actor, id);
120	  if (guard.verdict !== 'ok') return guard.verdict;
121	  await artifacts.delete(id);
122	  return 'ok';
123	}
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The auth and ownership primitives line up with the claimed model so far. I’m checking the exact `/jobs` follow-up path and the change-request service next, because those are the only places where a hidden divergence would still matter for this re-confirmation.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,260p' api/src/routes/jobs.ts && printf '\\n---CHANGE-REQUESTS ROUTE---\\n' && sed -n '1,260p' api/src/routes/change-requests.ts && printf '\\n---CHANGE-REQUESTS SERVICE---\\n' && sed -n '1,260p' api/src/services/change-requests.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/**
 * Build/brand-research jobs router (ch03 §3.8.8, §3.6.2). `POST /jobs` creates BUILD jobs; the
 * response is `created` (with the job) or `answered` (in-build classifier resolved it, no job) or
 * 409 DUPLICATE_BUILD (a concurrent follow-up on the same artifact). `GET /jobs/:id` serves the
 * persisted record (P-10); events stream over `events/` via ?token=. Routes never touch `data/`.
 */
import { Router, type Request, type Response } from 'express';
import { JobCreateRequest } from '@ekoa/shared';
import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
import { can } from '../auth/capabilities.js';
import { loadWritable } from '../apps/app-paths.js';
import { sseManager } from '../events/sse-manager.js';
import { handleBuildCreate, cancelRun } from '../agents/index.js';
import { getJob, jobView } from '../agents/jobs.js';
import { actorOf, notFound, parseBody, sendError } from './helpers.js';

export function jobsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  r.get('/:id/events', async (req: Request, res: Response) => {
    const auth = verifySseToken(req.query.token as string | undefined);
    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
    const id = req.params.id as string;
    // Ownership check BEFORE attach (Codex checkpoint): a valid SSE token must NOT subscribe to
    // another user's job stream (cross-user event/output leak). Mirrors the guarded GET /:id + the
    // chat SSE route. A missing job attaches (nothing streams); only a foreign OWNED job is refused.
    const job = await getJob(id);
    if (job && job.userId !== auth.claims.sub) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } });
    }
    const lastEventId = req.header('last-event-id');
    sseManager.attach(res, auth.claims.sub, 'job', id, lastEventId ? Number(lastEventId) : undefined);
  });

  r.use(requireAuth);

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, JobCreateRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);
    // Capability + ownership gates BEFORE any job is created or agent spawned (H1). Refusals carry
    // the FORBIDDEN envelope with `details.capability` (the machine-readable hook the H4
    // request-to-admin flow consumes); object-ownership denials carry no capability field.
    if (body.artifactId) {
      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
      // target artifact. The writability check (own always; org-shared within org ok; another
      // user's private → 403; missing/cross-org → 404) closes the follow-up-build IDOR (map §5.1),
      // where any authenticated user could drive a code-writing agent against ANY artifact by id.
      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
      // never leaks whether the target exists.
      if (!can(actor, 'canEditApps')) {
        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
      }
      // LOW oracle fix: collapse 'forbidden' (another user's PRIVATE artifact in the same org) into
      // the SAME 404 as missing/cross-org, LOCAL to the follow-up build gate. A distinct 403 here
      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
      // by id. Security over the H1 brief's 403/404 split (that split stays on the artifact routes,
      // which may legitimately distinguish); here writability failing for ANY reason reads as 404.
      const { verdict } = await loadWritable(actor, body.artifactId);
      if (verdict !== 'ok') return notFound(res);
    } else if (!can(actor, 'canBuildApps')) {
      // A first build CREATES an app.
      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
    }
    const result = await handleBuildCreate({
      actor,
      username: req.user!.username,
      sessionId: body.sessionId,
      description: body.description,
      language: body.language,
      ...(body.templateId ? { templateId: body.templateId } : {}),
      ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
      ...(body.attachments ? { attachments: body.attachments } : {}),
      ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
      ...(body.configValues ? { configValues: body.configValues } : {}),
      ...(body.knowledgeDocs ? { knowledgeDocs: body.knowledgeDocs } : {}),
      deps,
    });
    if (result.status === 'conflict') return sendError(res, 'DUPLICATE_BUILD', 'Já existe uma construção em curso para esta aplicação.');
    if (result.status === 'answered') return res.status(200).json({ status: 'answered', reason: result.reason });
    res.status(202).json({ status: 'created', job: result.job });
    result.fire();
  });

  r.get('/:id', async (req: AuthedRequest, res: Response) => {
    const job = await getJob(req.params.id as string);
    const actor = actorOf(req);
    if (!job || (job.userId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
    res.json(jobView(job));
  });

  r.post('/:id/cancel', (req: AuthedRequest, res: Response) => {
    res.json(cancelRun(req.params.id as string, actorOf(req)));
  });

  return r;
}

---CHANGE-REQUESTS ROUTE---
/**
 * Change-requests router (operator-run H4; BRIEF Phase 9d). The request-changes queue.
 *
 * TWO planes on one resource:
 *  - FILE (POST /) — ANY logged-in platform user (auth 'user'), registered BEFORE the org-admin
 *    gate so a plain user can file (filing needs no capability; the queue READ is admin-gated).
 *    Scoped by the OPTIONAL `X-Ekoa-App-Id` header: present => a served-app filing (lands in the
 *    app OWNER's org queue); absent => a dashboard refused-build filing (lands in the requester's
 *    OWN org). requesterUserId + org come from the verified JWT / resolved owner, never the body.
 *  - QUEUE (GET /, POST /:id/convert, POST /:id/dismiss) — org-admin reads/acts on its OWN org,
 *    super-admin across orgs: the EXACT `requireRole('org-admin','super-admin')` gate registo.ts
 *    uses. Org SCOPE (the cross-org isolation crux) is enforced in the service.
 *
 * Routes stay thin (validate, call one domain module, shape) — like jobs.ts this one additionally
 * resolves the app (apps/registry) and fires the live SSE (agents/streaming); it never touches
 * data/ (the service owns store access, ch02 §2.7).
 */
import { Router, type Response } from 'express';
import { ChangeRequestFileRequest, ChangeRequestConvertRequest, type ChangeRequestStatus } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { resolveApp } from '../apps/registry.js';
import { loadReadable } from '../apps/app-paths.js';
import { emitChangeRequest } from '../agents/streaming.js';
import {
  fileChangeRequest,
  readChangeRequests,
  convertChangeRequest,
  dismissChangeRequest,
} from '../services/change-requests.js';
import { actorOf, notFound, parseBody, sendError } from './helpers.js';

export function changeRequestsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  // FILE a change request (any authenticated user). Registered BEFORE the org-admin gate below.
  r.post('/', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ChangeRequestFileRequest, req.body);
    if (!body) return;
    const requester = { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId };

    // The OPTIONAL served-app header decides the target org. Present => resolve the app + its OWNER
    // (fail-closed: unknown / registry-only / ownerless id is a 404, exactly like the app-assistant
    // plane). Absent => the dashboard refused-build filing to the requester's own org (target null).
    let target: { ownerUserId: string; appId: string } | null = null;
    const header = req.header('x-ekoa-app-id');
    if (header !== undefined && header !== '') {
      const app = await resolveApp(header);
      if (!app || !app.artifactBacked || !app.ownerUserId) {
        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      }
      // CROSS-ORG INJECTION GUARD (codex HIGH): filing about a served app requires the REQUESTER to
      // be able to READ it - own, or org-shared WITHIN THEIR OWN org. loadReadable returns null for a
      // cross-org row, another user's private row, or an unknown id -> a UNIFORM 404 (indistinguishable
      // from an unknown app, so it is NOT a cross-org existence oracle). Because a readable app is
      // always in the requester's own org, the owner-org stamp is reachable ONLY for apps the requester
      // can see - a request can NEVER be injected into another org's queue (nor its admins notified).
      if (!(await loadReadable(actorOf(req), app.appId))) {
        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      }
      target = { ownerUserId: app.ownerUserId, appId: app.appId };
    }

    const { request, notifyUserIds } = await fileChangeRequest(requester, target, body, deps);
    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
    res.json(request);
  });

  // The org-admin queue (read + convert + dismiss). org-admin own org; super-admin across orgs.
  r.use(requireAuth, requireRole('org-admin', 'super-admin'));

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const q = req.query as { status?: string; orgId?: string; limit?: string; offset?: string };
    const result = await readChangeRequests(actorOf(req), {
      status: q.status as ChangeRequestStatus | undefined,
      orgId: q.orgId,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      offset: q.offset ? parseInt(q.offset, 10) : undefined,
    });
    res.json(result);
  });

  r.post('/:id/convert', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ChangeRequestConvertRequest, req.body);
    if (!body) return;
    const result = await convertChangeRequest(actorOf(req), req.params.id as string, body.jobId);
    if (result.status === 'not-found') return notFound(res);
    res.json(result.request);
  });

  r.post('/:id/dismiss', async (req: AuthedRequest, res: Response) => {
    const result = await dismissChangeRequest(actorOf(req), req.params.id as string);
    if (result.status === 'not-found') return notFound(res);
    res.json(result.request);
  });

  return r;
}

---CHANGE-REQUESTS SERVICE---
/**
 * Change-requests service (operator-run H4; BRIEF Phase 9d). Owns the store access for the
 * request-changes queue so routes/ never touches data/ directly (ch02 §2.7; `services/` may
 * import `data/`). GREENFIELD — mirrors the registo read's org scoping EXACTLY.
 *
 * CROSS-ORG ISOLATION is the security crux: `orgId` is stamped SERVER-SIDE here (the app OWNER's
 * org for a served-app filing, the requester's OWN org for a dashboard refused-build filing) and
 * every read/convert/dismiss is org-scoped — an org-admin sees ONLY its own org, a super-admin
 * across orgs (registo.ts's exact rule). The org-admin/super-admin ROLE gate lives on the route
 * (requireRole, like registo); this module enforces the org SCOPE.
 */
import type { Actor, ChangeRequest, ChangeRequestStatus } from '@ekoa/shared';
import { changeRequests, users, type ChangeRequestDoc } from '../data/stores.js';

export interface Deps { now: () => number; genId: () => string }

/** Store doc -> wire shape. The wire schema is `.strict()`, so optional fields are spread only
 *  when present (never emit a key the contract does not allow). */
export function changeRequestView(d: ChangeRequestDoc): ChangeRequest {
  return {
    id: d._id,
    orgId: d.orgId,
    requesterUserId: d.requesterUserId,
    requesterName: d.requesterName,
    text: d.text,
    status: d.status,
    createdAt: d.createdAt,
    ...(d.appId ? { appId: d.appId } : {}),
    ...(d.route ? { route: d.route } : {}),
    ...(d.screenState ? { screenState: d.screenState } : {}),
    ...(d.jobId ? { jobId: d.jobId } : {}),
  };
}

/**
 * File a change request. Two documented modes, distinguished by `target`:
 *  - served-app filing (`target` set): the app OWNER's org is the queue owner (isolation
 *    boundary) — resolved from the owner user record, NEVER the requester's org or the body.
 *  - dashboard refused-build filing (`target` null): no served app; the request lands in the
 *    REQUESTER's OWN org, with the body `appId` kept only as an informational label (an
 *    edit-refusal artifactId) — convert re-gates it via H1 (loadWritable), so a planted id leaks
 *    nothing.
 * Returns the created request plus the org-admin userIds to live-notify (the caller — the route,
 * which may import agents/streaming — fires the SSE; this module only reads data/).
 */
export async function fileChangeRequest(
  requester: { userId: string; username: string; orgId: string },
  target: { ownerUserId: string; appId: string } | null,
  body: { text: string; route?: string; screenState?: string; appId?: string },
  deps: Deps,
): Promise<{ request: ChangeRequest; notifyUserIds: string[] }> {
  let orgId: string;
  let appId: string | undefined;
  if (target) {
    const owner = await users.get(target.ownerUserId);
    orgId = owner?.orgId ?? '';
    appId = target.appId;
  } else {
    orgId = requester.orgId;
    appId = body.appId;
  }
  const doc: ChangeRequestDoc = {
    _id: deps.genId(),
    orgId,
    requesterUserId: requester.userId,
    requesterName: requester.username,
    text: body.text,
    status: 'open',
    createdAt: new Date(deps.now()).toISOString(),
    ...(appId ? { appId } : {}),
    ...(body.route ? { route: body.route } : {}),
    ...(body.screenState ? { screenState: body.screenState } : {}),
  };
  await changeRequests.insert(doc);
  // Live push to the OWNER org's admins only (org-scoped fan-in — never another org's admins).
  const admins = orgId ? await users.find({ orgId, role: 'org-admin' }) : [];
  return { request: changeRequestView(doc), notifyUserIds: admins.map((a) => a._id) };
}

/**
 * Queue read. org-admin: OWN org ONLY (the isolation crux). super-admin: across orgs, optionally
 * narrowed by `orgId`. Mirrors registo.ts's readRegisto scoping exactly. Newest first.
 */
export async function readChangeRequests(
  actor: Actor,
  query: { status?: ChangeRequestStatus; orgId?: string; limit?: number; offset?: number },
): Promise<{ items: ChangeRequest[]; total: number }> {
  const filter =
    actor.role === 'super-admin'
      ? (query.orgId ? { orgId: query.orgId } : {})
      : { orgId: actor.orgId };
  let rows = await changeRequests.find(filter, { createdAt: -1 });
  if (query.status) rows = rows.filter((r) => r.status === query.status);
  const total = rows.length;
  const page = rows.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100));
  return { items: page.map(changeRequestView), total };
}

/** org-scope guard shared by convert + dismiss: a missing row OR a cross-org row reads as the
 *  SAME not-found (no existence oracle across orgs — an org-admin cannot probe another org's ids). */
async function loadOwnOrg(actor: Actor, id: string): Promise<ChangeRequestDoc | null> {
  const row = await changeRequests.get(id);
  if (!row) return null;
  if (actor.role !== 'super-admin' && row.orgId !== actor.orgId) return null;
  return row;
}

/** Mark a request converted, linking the follow-up-build job the dashboard already started
 *  (H1-gated at POST /jobs). org-scoped: an org-admin converts only its own org's requests. */
export async function convertChangeRequest(
  actor: Actor,
  id: string,
  jobId: string,
): Promise<{ status: 'ok'; request: ChangeRequest } | { status: 'not-found' }> {
  if (!(await loadOwnOrg(actor, id))) return { status: 'not-found' };
  const updated = await changeRequests.update(id, (r) => ({ ...r, status: 'converted', jobId }));
  if (!updated) return { status: 'not-found' };
  return { status: 'ok', request: changeRequestView(updated) };
}

/** Decline a request (status -> dismissed). org-scoped, like convert. */
export async function dismissChangeRequest(
  actor: Actor,
  id: string,
): Promise<{ status: 'ok'; request: ChangeRequest } | { status: 'not-found' }> {
  if (!(await loadOwnOrg(actor, id))) return { status: 'not-found' };
  const updated = await changeRequests.update(id, (r) => ({ ...r, status: 'dismissed' }));
  if (!updated) return { status: 'not-found' };
  return { status: 'ok', request: changeRequestView(updated) };
}

exec
/bin/zsh -lc 'codegraph explore "jobsRouter build create artifactId canEditApps canBuildApps loadWritable revalidateWritable follow-up forbidden notfound change requests convert dismiss file orgId"' in /Users/ggomes/dev/ekoa-code
 succeeded in 536ms:
## Exploration: jobsRouter build create artifactId canEditApps canBuildApps loadWritable revalidateWritable follow-up forbidden notfound change requests convert dismiss file orgId

Found 218 symbols across 91 files.

### Blast radius — what depends on these (update/verify before editing)

- `loadWritable` (api/src/apps/app-paths.ts:103) — 8 callers in `api/src/routes/artifacts.ts`, `api/src/apps/build-mechanics.ts`, `api/src/routes/jobs.ts`, `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `BuildCreateInput` (api/src/agents/build.ts:59) — 7 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/build.test.ts`
- `jobsRouter` (api/src/routes/jobs.ts:17) — 3 callers in `api/src/server.ts`; tests: `api/tests/contract/jobs-capability.test.ts`
- `AppBuilder` (api/src/apps/builder.ts:332) — 1 caller in `api/src/apps/builder.ts`; ⚠️ no covering tests found
- `FeaturedBuildResult` (api/src/apps/featured-builder.ts:223) — 1 caller in `api/src/apps/featured-builder.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- writable → loadWritable
- createBuildMechanics → loadWritable
- jobsRouter → Router
- createBuildMechanics → build
- buildAndRegisterFeaturedArtifacts → featuredArtifactsDir
- buildAndRegisterFeaturedArtifacts → featuredArtifactDir
- buildAndRegisterFeaturedArtifacts → readManifestLite
- buildAndRegisterFeaturedArtifacts → collectBareImports
- buildAndRegisterFeaturedArtifacts → unresolvableImports
- buildAndRegisterFeaturedArtifacts → buildAndRegisterOne
- ... and 362 more

**references:**
- BuildCreateInput → Actor
- buildAndRegisterFeaturedArtifacts → FeaturedBuildResult
- IntegrationBuildPanel → IntegrationBuildPanelProps
- extractLogoCandidates → SiteBuilder
- ResolveBrandLogoInput → SiteBuilder
- filterDesignSystemChrome → SiteBuilder
- classifyInBuildIntent → InBuildIntent
- handleFollowUp → BuildCreateInput
- handleFollowUp → BuildCreateResult
- handleFollowUp → JobRecord
- ... and 129 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### web/stores/change-requests.ts — convert(function), dismiss(function)

```typescript
1	'use client';
2	
3	/**
4	 * Change-requests store (operator-run H4). The org-admin queue read + the two admin actions
5	 * (convert / dismiss), plus the refused-build feed's file action.
6	 *
7	 * `GET /api/v1/change-requests`: an org-admin sees its OWN org, a super-admin may pass `orgId`
8	 * to cross orgs (the exact registo scoping). "Converter" starts a patch run the way the panel's
9	 * edit mode does — a follow-up build via `POST /api/v1/jobs` (H1-gated: the org-admin has
10	 * canEditApps + loadWritable on an org app) — then marks the request converted with the job id.
11	 */
12	
13	import { create } from 'zustand';
14	import { api, tryCall } from '@/lib/api';
15	import type { ChangeRequest, ChangeRequestStatus, ChangeRequestQuery } from '@ekoa/shared';
16	
17	const PAGE_SIZE = 100;
18	
19	interface ChangeRequestsState {
20	  requests: ChangeRequest[];
21	  total: number;
22	  /** '' = all statuses; otherwise a single status filter (defaults to 'open' at first load). */
23	  statusFilter: ChangeRequestStatus | '';
24	  /** super-admin cross-org filter ('' = all orgs). */
25	  orgId: string;
26	  isLoading: boolean;
27	  /** id currently being converted/dismissed (guards double-click + drives the row spinner). */
28	  actingId: string | null;
29	  error: string | null;
30	
31	  fetchRequests: () => Promise<void>;
32	  setStatusFilter: (value: ChangeRequestStatus | '') => void;
33	  setOrgId: (value: string) => void;
34	  convert: (id: string) => Promise<void>;
35	  dismiss: (id: string) => Promise<void>;
36	  /** Refused-build feed (BRIEF 9a): file a pre-drafted request to the requester's OWN org queue
37	   *  (no served-app header) so an H1 refusal is never a dead end. `appId` is the edit-refusal
38	   *  artifact when present (informational; convert re-gates it). */
39	  fileFromRefusal: (input: { text: string; appId?: string; route?: string }) => Promise<boolean>;
40	  clearError: () => void;
41	}
42	
43	export const useChangeRequestsStore = create<ChangeRequestsState>()((set, get) => ({
44	  requests: [],
45	  total: 0,
46	  statusFilter: 'open',
47	  orgId: '',
48	  isLoading: false,
49	  actingId: null,
50	  error: null,
51	
52	  fetchRequests: async () => {
53	    const { statusFilter, orgId } = get();
54	    set({ isLoading: true, error: null });
55	    const query: ChangeRequestQuery = { limit: PAGE_SIZE };
56	    if (statusFilter) query.status = statusFilter;
57	    if (orgId) query.orgId = orgId;
58	    const response = await tryCall(() =>
59	      api.changeRequests.list(query as unknown as Record<string, unknown>),
60	    );
61	    if (response.ok) {
62	      set({ requests: response.data.items, total: response.data.total, isLoading: false });
63	    } else {
64	      set({ error: response.error.message || 'Falha ao carregar os pedidos.', isLoading: false });
65	    }
66	  },
67	
68	  setStatusFilter: (value) => {
69	    set({ statusFilter: value });
70	    void get().fetchRequests();
71	  },
72	
73	  setOrgId: (value) => {
74	    set({ orgId: value });
75	    void get().fetchRequests();
76	  },
77	
78	  convert: async (id) => {
79	    const request = get().requests.find((r) => r.id === id);
80	    if (!request || get().actingId) return;
81	    set({ actingId: id, error: null });
82	    // 1) Start the patch run — the SAME H1-gated follow-up build the dashboard/panel drive. A
83	    //    request that names an app is a follow-up (artifactId); a refused-build request without
84	    //    one is a first build. Both are re-gated server-side (canBuildApps/canEditApps).
85	    const job = await tryCall(() =>
86	      api.jobs.create({
87	        kind: 'build',
88	        description: request.text,
89	        sessionId: `pedido-${request.id}`,
90	        language: 'pt',
91	        ...(request.appId ? { artifactId: request.appId } : {}),
92	      }),
93	    );
94	    if (!job.ok) {
95	      // A NOT_FOUND on a request that names an app is the H1 edit gate (loadWritable) refusing the
96	      // conversion because the app is not editable by this admin - under the org-scoped edit policy,
97	      // a same-org OTHER user's PRIVATE draft is not admin-editable (codex-h6 Low: give an actionable
98	      // reason instead of a bare "could not start", so the queue's Converter is never a silent
99	      // dead-end). The author must share the app to the organization before it can be edited.
100	      const notEditable = Boolean(request.appId) && job.error.status === 404;
101	      set({
102	        actingId: null,
103	        error: notEditable
104	          ? 'Esta aplicação é um rascunho privado do autor e não pode ser alterada por si. Peça ao autor para a partilhar com a organização antes de converter o pedido.'
105	          : job.error.message || 'Não foi possível iniciar a alteração.',
106	      });
107	      return;
108	    }
109	    if (job.data.status !== 'created') {
110	      // The in-build classifier answered without starting a job: nothing to link. Leave the
111	      // request open and tell the admin to reformulate.
112	      set({ actingId: null, error: 'O pedido foi respondido sem criar uma revisão. Reformule o pedido.' });
113	      return;
114	    }
115	    // 2) Link the resulting job and flip the request to converted. Read the id out here, where the
116	    //    union is narrowed to the 'created' variant (the narrowing does not survive into a closure).
117	    const jobId = job.data.job.id;
118	    const converted = await tryCall(() => api.changeRequests.convert({ id: request.id, jobId }));
119	    set({ actingId: null });
120	    if (!converted.ok) {
121	      set({ error: converted.error.message || 'A revisão foi iniciada mas o pedido não foi marcado.' });
122	    }
123	    await get().fetchRequests();
124	  },
125	
126	  dismiss: async (id) => {
127	    if (get().actingId) return;
128	    set({ actingId: id, error: null });
129	    const response = await tryCall(() => api.changeRequests.dismiss({ id }));
130	    set({ actingId: null });
131	    if (!response.ok) {
132	      set({ error: response.error.message || 'Não foi possível dispensar o pedido.' });
133	      return;
134	    }
135	    await get().fetchRequests();
136	  },
137	
138	  fileFromRefusal: async ({ text, appId, route }) => {
139	    const response = await tryCall(() =>
140	      api.changeRequests.file({ text, ...(appId ? { appId } : {}), ...(route ? { route } : {}) }),
141	    );
142	    return response.ok;
143	  },
144	
145	  clearError: () => set({ error: null }),
146	}));
```

#### api/src/apps/builder.ts — now(calls), calls(calls), BuildResult(references), map(calls), clearArtifactHealth(calls), build(calls), writeErrorHtml(calls), sharedBuildOptions(calls), generateIndexHtml(calls), unwatch(calls), +18 more

```typescript
339	   * Uses the `artifacts` store directly; data/ never imports back into apps/, so the static
340	   * import carries no circular-dependency risk.
341	   */
342	  private async clearArtifactHealth(appId: string): Promise<void> {
343	    try {
344	      const existing = await artifacts.get(appId);
345	      if (!existing || existing.health === undefined) return;
346	      await artifacts.update(appId, (cur) => {
347	        const next = { ...cur };
348	        delete next.health;
349	        return next;
350	      });
351	    } catch { /* non-fatal: health is observational */ }
352	  }
353	
354	  /**
355	   * Build an app: the frontend bundle plus, when the manifest declares one, the
356	   * server-side backend bundle (Layer 2). Backend build errors are merged into
357	   * the result so a backend that doesn't compile fails the build loudly.
358	   */
359	  async build(appId: string, sandboxPath: string): Promise<BuildResult> {
360	    const frontend = await this.buildFrontend(appId, sandboxPath);
361	
362	    let manifest: AppManifest | null = null;
363	    try { manifest = await readManifest(sandboxPath); } catch { /* invalid - no backend */ }
364	    if (!manifest?.backend) return frontend;
365	
366	    const backend = await this.buildBackend(appId, sandboxPath, manifest.backend);
367	    return {
368	      success: frontend.success && backend.success,
369	      errors: [...frontend.errors, ...backend.errors],
370	      warnings: [...frontend.warnings, ...backend.warnings],
371	      durationMs: frontend.durationMs + backend.durationMs,
372	      outputFiles: [...frontend.outputFiles, ...backend.outputFiles],
373	    };
374	  }
375	
376	  /**
377	   * Bundle an artifact's backend entry with esbuild for Node (esm, bundled) to
378	   * `dist-backend/backend.mjs`. The worker imports that bundle; the `ekoa`
379	   * capability handle arrives at call time and is never imported here.
380	   */
381	  private async buildBackend(
382	    appId: string,
383	    sandboxPath: string,
384	    backend: NonNullable<AppManifest['backend']>,
385	  ): Promise<BuildResult> {
386	    const start = performance.now();
387	    const entryPath = join(sandboxPath, backend.entryPoint);
388	    const outDir = join(sandboxPath, 'dist-backend');
389	
390	    try {
391	      await access(entryPath);
392	    } catch {
393	      return {
394	        success: false,
395	        errors: [`Backend entry point not found: ${backend.entryPoint}`],
396	        warnings: [],
397	        durationMs: performance.now() - start,
398	        outputFiles: [],
399	      };
400	    }
401	
402	    await mkdir(outDir, { recursive: true });
403	    try {
404	      const result = await esbuild.build({
405	        entryPoints: [entryPath],
406	        bundle: true,
407	        outfile: join(outDir, 'backend.mjs'),
408	        platform: 'node',
409	        format: 'esm',
410	        target: ['node20'],
411	        // Resolve any npm deps the handler imports from the workspace node_modules,
412	        // mirroring the frontend bundle (sandboxes don't run npm install).
413	        nodePaths: WORKSPACE_NODE_MODULES,
414	        loader: { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.json': 'json' },
415	        logLevel: 'silent',
416	        metafile: true,
417	        sourcemap: false,
418	        minify: false,
419	      });
420	      const errors = result.errors.map((e) => e.text);
421	      const outputFiles = Object.keys(result.metafile?.outputs ?? {});
422	      if (errors.length === 0) {
423	        console.log(`[app-builder] ${appId}: backend bundled -> dist-backend/backend.mjs (handlers: ${backend.handlers.join(', ')})`);
424	      }
425	      return {
426	        success: errors.length === 0,
427	        errors,
428	        warnings: result.warnings.map((w) => w.text),
429	        durationMs: performance.now() - start,
430	        outputFiles,
431	      };
432	    } catch (err) {
433	      const message = err instanceof Error ? err.message : String(err);
434	      console.error(`[app-builder] ${appId}: backend build failed: ${message}`);
435	      return { success: false, errors: [message], warnings: [], durationMs: performance.now() - start, outputFiles: [] };
436	    }
437	  }
438	
439	  /**
440	   * Build an app's frontend. Reads manifest.json to determine
441	   * entry point and output directory.
442	   */
443	  private async buildFrontend(appId: string, sandboxPath: string): Promise<BuildResult> {
444	    const start = performance.now();
445	
446	    // Read manifest for entry point and output dir.
447	    // Tolerate invalid manifests (e.g. agent writes an unrecognised type)
448	    // so the build can still proceed with defaults.
449	    let manifest: AppManifest | null = null;
450	    try {
451	      manifest = await readManifest(sandboxPath);
452	    } catch {
453	      // Invalid or missing manifest - proceed with defaults
454	    }
455	    const outputDir = manifest?.outputDir ?? 'dist/';
456	    const outDir = join(sandboxPath, outputDir);
457	    await mkdir(outDir, { recursive: true });
458	
459	    // Check if the agent wrote a plain HTML file at the project root.
460	    // Plain HTML apps don't need esbuild - just copy the HTML (and any
461	    // co-located CSS/JS) to dist/.
462	    const plainHtmlResult = await this.tryPlainHtmlBuild(appId, sandboxPath, outDir, start);
463	    if (plainHtmlResult) {
464	      if (plainHtmlResult.success) await this.clearArtifactHealth(appId);
465	      return plainHtmlResult;
466	    }
467	
468	    // JSX app: build with esbuild
469	    const entryPoint = manifest?.entryPoint ?? 'frontend/src/index.jsx';
470	    const appName = manifest?.name ?? 'App';
471	    const entryPath = join(sandboxPath, entryPoint);
472	
473	    // Ensure entry point exists
474	    try {
475	      await access(entryPath);
476	    } catch {
477	      // Generate index.html even on failure so the preview shows
478	      // something instead of a raw 404.
479	      await this.writeErrorHtml(outDir, appName, `Entry point not found: ${entryPoint}`);
480	      return {
481	        success: false,
482	        errors: [`Entry point not found: ${entryPoint}`],
483	        warnings: [],
484	        durationMs: performance.now() - start,
485	        outputFiles: ['index.html'],
486	      };
487	    }
488	
489	    try {
490	      const result = await esbuild.build(sharedBuildOptions(entryPath, outDir));
491	
492	      const errors = result.errors.map((e) => e.text);
493	      const warnings = result.warnings.map((w) => w.text);
494	      const outputFiles = Object.keys(result.metafile?.outputs ?? {});
495	
496	      // Check if CSS was produced
497	      let dirFiles: string[];
498	      try {
499	        dirFiles = await readdir(outDir);
500	      } catch {
501	        dirFiles = [];
502	      }
503	      const hasCss = dirFiles.some((f) => f === 'bundle.css');
504	
505	      // Generate index.html with importmap
506	      const htmlPath = join(outDir, 'index.html');
507	      await writeFile(htmlPath, await generateIndexHtml(appName, manifest, hasCss), 'utf-8');
508	      outputFiles.push('index.html');
509	
510	      const durationMs = performance.now() - start;
511	      console.log(`[app-builder] ${appId}: built in ${durationMs.toFixed(0)}ms (${outputFiles.length} files)`);
512	
513	      if (errors.length === 0) await this.clearArtifactHealth(appId);
514	
515	      return {
516	        success: errors.length === 0,
517	        errors,
518	        warnings,
519	        durationMs,
520	        outputFiles,
521	      };
522	    } catch (err) {
523	      const durationMs = performance.now() - start;
524	      const message = err instanceof Error ? err.message : String(err);
525	      console.error(`[app-builder] ${appId}: build failed: ${message}`);
526	
527	      // Generate index.html even on failure
528	      await this.writeErrorHtml(outDir, appName, message);
529	
530	      return {
531	        success: false,
532	        errors: [message],
533	        warnings: [],
534	        durationMs,
535	        outputFiles: ['index.html'],
536	      };
537	    }
538	  }
539	
540	  /**
541	   * Check if the agent wrote a plain HTML file at the project root.
542	   * The scaffold never creates root-level index.html (only frontend/src/),
543	   * so any index.html at the root is the agent's intended output.
544	   * Copies it + co-located assets to dist/ instead of running esbuild.
545	   * Returns a BuildResult if handled, or null to fall through to esbuild.
546	   */
547	  private async tryPlainHtmlBuild(
548	    appId: string,
549	    sandboxPath: string,
550	    outDir: string,
551	    start: number,
552	  ): Promise<BuildResult | null> {
553	    const htmlPath = join(sandboxPath, 'index.html');
554	    try {
555	      await access(htmlPath);
556	    } catch {
557	      return null; // No root-level index.html - use esbuild
558	    }
559	
560	    // Copy all web-relevant files from the project root to dist/
561	    const outputFiles: string[] = [];
562	    const WEB_EXTENSIONS = new Set(['.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf']);
563	
564	    try {
565	      const files = await readdir(sandboxPath);
566	      for (const file of files) {
567	        const ext = extname(file).toLowerCase();
568	        if (!WEB_EXTENSIONS.has(ext)) continue;
569	        const src = join(sandboxPath, file);
570	        try {
571	          const s = await stat(src);
572	          if (s.isFile()) {
573	            await copyFile(src, join(outDir, file));
574	            outputFiles.push(file);
575	          }
576	        } catch { /* skip unreadable files */ }
577	      }
578	
579	      const durationMs = performance.now() - start;
580	      console.log(`[app-builder] ${appId}: plain HTML copied in ${durationMs.toFixed(0)}ms (${outputFiles.length} files)`);
581	
582	      return {
583	        success: true,
584	        errors: [],
585	        warnings: [],
586	        durationMs,
587	        outputFiles,
588	      };
589	    } catch (err) {
590	      const message = err instanceof Error ? err.message : String(err);
591	      console.error(`[app-builder] ${appId}: plain HTML copy failed: ${message}`);
592	      return null; // Fall through to esbuild
593	    }
594	  }
595	
596	  /**
597	   * Start watching an app's frontend source for changes and rebuild
598	   * incrementally. Uses esbuild's context API for fast rebuilds.
599	   */
600	  async watch(appId: string, sandboxPath: string, onRebuild?: () => void): Promise<void> {
601	    // Always dispose existing esbuild context first (e.g. the scaffold watcher
602	    // started before the agent converted the app to plain HTML).
603	    await this.unwatch(appId);
604	
605	    // Plain HTML apps don't need esbuild watching - the dist/ already
606	    // has the agent's HTML file copied by build().
607	    const rootHtml = join(sandboxPath, 'index.html');
608	    try {
609	      await access(rootHtml);
610	      console.log(`[app-builder] ${appId}: plain HTML app - skipping esbuild watch`);
611	      return;
612	    } catch { /* not a plain HTML app, continue to esbuild */ }
613	
614	    let manifest: AppManifest | null = null;
615	    try {
616	      manifest = await readManifest(sandboxPath);
617	    } catch {
618	      // Invalid manifest - proceed with defaults
619	    }
620	    const entryPoint = manifest?.entryPoint ?? 'frontend/src/index.jsx';
621	    const outputDir = manifest?.outputDir ?? 'dist/';
622	    const appName = manifest?.name ?? 'App';
623	
624	    const entryPath = join(sandboxPath, entryPoint);
625	    const outDir = join(sandboxPath, outputDir);
626	
627	    // Ensure entry point exists before starting watch
628	    try {
629	      await access(entryPath);
630	    } catch {
631	      console.warn(`[app-builder] ${appId}: skipping watch - entry point not found: ${entryPoint}`);
632	      return;
633	    }
634	
635	    await mkdir(outDir, { recursive: true });
636	
637	    const sharedOpts = sharedBuildOptions(entryPath, outDir);
638	    // Captured for the esbuild plugin closure below (object-literal `setup`
639	    // would otherwise lose `this`).
640	    const self = this;
641	
642	    let ctx: esbuild.BuildContext;
643	    try {
644	      ctx = await esbuild.context({
645	        ...sharedOpts,
646	        plugins: [
647	          // Keep CDN-to-local plugin from shared options
648	          ...(sharedOpts.plugins ?? []),
649	          // Plugin to regenerate index.html after each rebuild
650	          {
651	            name: 'html-generator',
652	            setup(build) {
653	              build.onEnd(async (result) => {
654	                if (result.errors.length === 0) {
655	                  try {
656	                    // Re-check for CSS each rebuild
657	                    let dirFiles: string[];
658	                    try {
659	                      dirFiles = await readdir(outDir);
660	                    } catch {
661	                      dirFiles = [];
662	                    }
663	                    const hasCss = dirFiles.some((f) => f === 'bundle.css');
664	                    await writeFile(
665	                      join(outDir, 'index.html'),
666	                      await generateIndexHtml(appName, manifest, hasCss),
667	                      'utf-8',
668	                    );
669	                    await self.clearArtifactHealth(appId);
670	                    // Notify caller of successful rebuild
671	                    if (onRebuild) onRebuild();
672	                  } catch {
673	                    // Non-fatal: HTML generation failure shouldn't block builds
674	                  }
675	                }
676	              });
677	            },
678	          },
679	        ],
680	      });
681	    } catch (err) {
682	      console.error(`[app-builder] ${appId}: esbuild context creation failed:`, err instanceof Error ? err.message : err);
683	      return;
684	    }
685	
686	    this.contexts.set(appId, ctx);
687	
688	    // Start watching (esbuild watches the source files automatically)
689	    try {
690	      await ctx.watch();
691	    } catch (err) {
692	      console.error(`[app-builder] ${appId}: esbuild watch failed:`, err instanceof Error ? err.message : err);
693	      this.contexts.delete(appId);
694	      return;
695	    }
696	
697	    // Do an initial build
698	    try {
699	      await ctx.rebuild();
700	      console.log(`[app-builder] ${appId}: watching for changes`);
701	    } catch (err) {
702	      const msg = err instanceof Error ? err.message : String(err);
703	      console.warn(`[app-builder] ${appId}: initial build failed: ${msg}`);
704	    }
705	  }
706	
707	  /** Stop watching a specific app. */
708	  async unwatch(appId: string): Promise<void> {
709	    const ctx = this.contexts.get(appId);
710	    if (ctx) {
711	      try {
712	        await ctx.dispose();
713	      } catch (err) {
714	        console.error(`[app-builder] ${appId}: esbuild dispose failed:`, err instanceof Error ? err.message : err);
715	      }
716	      this.contexts.delete(appId);
717	      console.log(`[app-builder] ${appId}: stopped watching`);
718	    }
719	  }
720	
721	  /** Stop all watchers and dispose all contexts. */
722	  async dispose(): Promise<void> {
723	    const ids = [...this.contexts.keys()];
724	    for (const id of ids) {
725	      await this.unwatch(id);
726	    }
727	    console.log('[app-builder] disposed');
728	  }
729	
730	  /** Write an index.html with a build error message so the preview never 404s. */
731	  private async writeErrorHtml(outDir: string, appName: string, errorMsg: string): Promise<void> {
732	    const safeError = escapeHtml(errorMsg);
733	    const html = `<!DOCTYPE html>

... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The server side still returns `404` for non-writable follow-up edits, including same-org private drafts, which is the correct non-oracle behavior. I’m doing one last pass on the updated line ranges and the new test so the closeout can point to exact file:line references.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/apps/app-assistant-route.ts | sed -n '108,126p'; printf '\\n---\\n'; nl -ba api/tests/apps/app-assistant.test.ts | sed -n '390,425p'; printf '\\n---\\n'; nl -ba web/stores/change-requests.ts | sed -n '78,108p'; printf '\\n---\\n'; nl -ba api/src/auth/middleware.ts | sed -n '22,55p'; printf '\\n---\\n'; nl -ba api/src/routes/jobs.ts | sed -n '33,66p'; printf '\\n---\\n'; nl -ba api/src/apps/app-paths.ts | sed -n '98,112p'; printf '\\n---\\n'; nl -ba api/src/routes/change-requests.ts | sed -n '33,75p'; printf '\\n---\\n'; nl -ba api/src/services/change-requests.ts | sed -n '33,95p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   108	 * second identity path.
   109	 */
   110	async function detectAppEditor(authHeader: string | undefined, appId: string): Promise<boolean> {
   111	  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
   112	  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
   113	  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
   114	  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
   115	  // Mirror the FULL H1 admission gate, not just its verify+capability+writability legs (codex-h6
   116	  // Medium): the real edit path is requireAuth (active + NOT billing-locked + epoch) THEN can() +
   117	  // loadWritable. verifySseToken checks active/epoch but NOT billingLocked, so without this a
   118	  // billing-locked admin would read admin:true and be OFFERED edit mode (H3) only to be refused
   119	  // BILLING_LOCKED at POST /jobs - a false offer. A locked/absent activation ⇒ not an editor.
   120	  const act = getActivation(verified.claims.sub);
   121	  if (!act || !act.active || act.billingLocked) return false;
   122	  const actor = { userId: verified.claims.sub, orgId: verified.claims.orgId, role: verified.claims.role };
   123	  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
   124	  return isAppEditor(verified.claims, verdict);
   125	}
   126	

---
   390	
   391	  it('an org-admin of ANOTHER org -> 200 { admin:false } (never 403 — no cross-org oracle)', async () => {
   392	    const res = await whoami(bearer('admin-other'));
   393	    expect(res.status).toBe(200);
   394	    expect(await res.json()).toEqual({ admin: false });
   395	  });
   396	
   397	  it('a plain user of the owner org -> 200 { admin:false } (H1 capability gate)', async () => {
   398	    const res = await whoami(bearer('user-owner'));
   399	    expect(res.status).toBe(200);
   400	    expect(await res.json()).toEqual({ admin: false });
   401	  });
   402	
   403	  it('a BILLING-LOCKED admin -> 200 { admin:false } (codex-h6: mirror the FULL H1 gate; no edit false-offer)', async () => {
   404	    // owner-1 is an org-admin of the owner org (admin:true normally). Lock their billing: the real
   405	    // edit path (requireAuth at POST /jobs) would refuse BILLING_LOCKED, so whoami must NOT offer edit.
   406	    setActivation('owner-1', { active: true, billingLocked: true });
   407	    try {
   408	      const res = await whoami(bearer('owner-1'));
   409	      expect(res.status).toBe(200);
   410	      expect(await res.json()).toEqual({ admin: false });
   411	    } finally {
   412	      setActivation('owner-1', { active: true, billingLocked: false }); // restore for other cases
   413	    }
   414	  });
   415	
   416	  it('NO token -> 200 { admin:false } (never a 401 — token absence is not an oracle)', async () => {
   417	    const res = await whoami({ 'x-ekoa-app-id': APP_ID });
   418	    expect(res.status).toBe(200);
   419	    expect(await res.json()).toEqual({ admin: false });
   420	  });
   421	
   422	  it('an INVALID token -> 200 { admin:false } (never a 401)', async () => {
   423	    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
   424	    expect(res.status).toBe(200);
   425	    expect(await res.json()).toEqual({ admin: false });

---
    78	  convert: async (id) => {
    79	    const request = get().requests.find((r) => r.id === id);
    80	    if (!request || get().actingId) return;
    81	    set({ actingId: id, error: null });
    82	    // 1) Start the patch run — the SAME H1-gated follow-up build the dashboard/panel drive. A
    83	    //    request that names an app is a follow-up (artifactId); a refused-build request without
    84	    //    one is a first build. Both are re-gated server-side (canBuildApps/canEditApps).
    85	    const job = await tryCall(() =>
    86	      api.jobs.create({
    87	        kind: 'build',
    88	        description: request.text,
    89	        sessionId: `pedido-${request.id}`,
    90	        language: 'pt',
    91	        ...(request.appId ? { artifactId: request.appId } : {}),
    92	      }),
    93	    );
    94	    if (!job.ok) {
    95	      // A NOT_FOUND on a request that names an app is the H1 edit gate (loadWritable) refusing the
    96	      // conversion because the app is not editable by this admin - under the org-scoped edit policy,
    97	      // a same-org OTHER user's PRIVATE draft is not admin-editable (codex-h6 Low: give an actionable
    98	      // reason instead of a bare "could not start", so the queue's Converter is never a silent
    99	      // dead-end). The author must share the app to the organization before it can be edited.
   100	      const notEditable = Boolean(request.appId) && job.error.status === 404;
   101	      set({
   102	        actingId: null,
   103	        error: notEditable
   104	          ? 'Esta aplicação é um rascunho privado do autor e não pode ser alterada por si. Peça ao autor para a partilhar com a organização antes de converter o pedido.'
   105	          : job.error.message || 'Não foi possível iniciar a alteração.',
   106	      });
   107	      return;
   108	    }

---
    22	export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
    23	  const header = req.header('authorization') ?? '';
    24	  const m = /^Bearer\s+(.+)$/i.exec(header);
    25	  if (!m) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
    26	  let claims: JwtClaims;
    27	  try {
    28	    claims = verifyToken(m[1] as string);
    29	  } catch (e) {
    30	    const expired = e instanceof Error && e.name === 'TokenExpiredError';
    31	    return fail(res, expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
    32	  }
    33	  // A minted token ALWAYS carries a jti (jwt.ts). A token without one cannot be revoked,
    34	  // so it is treated as invalid (a revocation bypass otherwise — ch09 §9.6, P-03).
    35	  if (!claims.jti) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
    36	  if (isRevoked(claims.jti)) {
    37	    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
    38	  }
    39	  // Activation admission (write-through map; immediate, no TTL wait). Fail CLOSED on a
    40	  // cache miss, but as UNAUTHENTICATED: an unknown subject is a stale/forged token
    41	  // (deleted user, reset store), not a deactivated account. §3.3 reserves ACCOUNT_DISABLED
    42	  // for active=false; a 401 lets clients end the dead session instead of showing the
    43	  // blocked-account state for a user that no longer exists.
    44	  const act = getActivation(claims.sub);
    45	  if (!act) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
    46	  if (!act.active) return fail(res, 'ACCOUNT_DISABLED', 'A sua conta está bloqueada. Contacte o suporte.');
    47	  // Token-epoch check: a token issued before the user's current epoch is invalid (its role/
    48	  // active state is stale — e.g. an admin demoted after this token was minted). ch09 §9.6.
    49	  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) {
    50	    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
    51	  }
    52	  if (act.billingLocked) return fail(res, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');
    53	  req.user = claims;
    54	  next();
    55	}

---
    33	  });
    34	
    35	  r.use(requireAuth);
    36	
    37	  r.post('/', async (req: AuthedRequest, res: Response) => {
    38	    const body = parseBody(res, JobCreateRequest, req.body);
    39	    if (!body) return;
    40	    const actor = actorOf(req);
    41	    // Capability + ownership gates BEFORE any job is created or agent spawned (H1). Refusals carry
    42	    // the FORBIDDEN envelope with `details.capability` (the machine-readable hook the H4
    43	    // request-to-admin flow consumes); object-ownership denials carry no capability field.
    44	    if (body.artifactId) {
    45	      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
    46	      // target artifact. The writability check (own always; org-shared within org ok; another
    47	      // user's private → 403; missing/cross-org → 404) closes the follow-up-build IDOR (map §5.1),
    48	      // where any authenticated user could drive a code-writing agent against ANY artifact by id.
    49	      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
    50	      // never leaks whether the target exists.
    51	      if (!can(actor, 'canEditApps')) {
    52	        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
    53	      }
    54	      // LOW oracle fix: collapse 'forbidden' (another user's PRIVATE artifact in the same org) into
    55	      // the SAME 404 as missing/cross-org, LOCAL to the follow-up build gate. A distinct 403 here
    56	      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
    57	      // by id. Security over the H1 brief's 403/404 split (that split stays on the artifact routes,
    58	      // which may legitimately distinguish); here writability failing for ANY reason reads as 404.
    59	      const { verdict } = await loadWritable(actor, body.artifactId);
    60	      if (verdict !== 'ok') return notFound(res);
    61	    } else if (!can(actor, 'canBuildApps')) {
    62	      // A first build CREATES an app.
    63	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
    64	    }
    65	    const result = await handleBuildCreate({
    66	      actor,

---
    98	/**
    99	 * Load an artifact the actor may WRITE: own always, org-shared by any org member.
   100	 * A private row of another user → forbidden; a missing/cross-org row → notfound.
   101	 * Mirrors OwnerVisibilityScoped.writeGuard.
   102	 */
   103	export async function loadWritable(
   104	  actor: Actor,
   105	  id: string,
   106	): Promise<{ verdict: OwnershipVerdict; art?: ArtifactDoc }> {
   107	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
   108	  if (!art || art.orgId !== actor.orgId) return { verdict: 'notfound' };
   109	  if (art.userId === actor.userId) return { verdict: 'ok', art };
   110	  if (art.visibility === 'org') return { verdict: 'ok', art };
   111	  return { verdict: 'forbidden', art };
   112	}

---
    33	  const r = Router();
    34	
    35	  // FILE a change request (any authenticated user). Registered BEFORE the org-admin gate below.
    36	  r.post('/', requireAuth, async (req: AuthedRequest, res: Response) => {
    37	    const body = parseBody(res, ChangeRequestFileRequest, req.body);
    38	    if (!body) return;
    39	    const requester = { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId };
    40	
    41	    // The OPTIONAL served-app header decides the target org. Present => resolve the app + its OWNER
    42	    // (fail-closed: unknown / registry-only / ownerless id is a 404, exactly like the app-assistant
    43	    // plane). Absent => the dashboard refused-build filing to the requester's own org (target null).
    44	    let target: { ownerUserId: string; appId: string } | null = null;
    45	    const header = req.header('x-ekoa-app-id');
    46	    if (header !== undefined && header !== '') {
    47	      const app = await resolveApp(header);
    48	      if (!app || !app.artifactBacked || !app.ownerUserId) {
    49	        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
    50	      }
    51	      // CROSS-ORG INJECTION GUARD (codex HIGH): filing about a served app requires the REQUESTER to
    52	      // be able to READ it - own, or org-shared WITHIN THEIR OWN org. loadReadable returns null for a
    53	      // cross-org row, another user's private row, or an unknown id -> a UNIFORM 404 (indistinguishable
    54	      // from an unknown app, so it is NOT a cross-org existence oracle). Because a readable app is
    55	      // always in the requester's own org, the owner-org stamp is reachable ONLY for apps the requester
    56	      // can see - a request can NEVER be injected into another org's queue (nor its admins notified).
    57	      if (!(await loadReadable(actorOf(req), app.appId))) {
    58	        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
    59	      }
    60	      target = { ownerUserId: app.ownerUserId, appId: app.appId };
    61	    }
    62	
    63	    const { request, notifyUserIds } = await fileChangeRequest(requester, target, body, deps);
    64	    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
    65	    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
    66	    res.json(request);
    67	  });
    68	
    69	  // The org-admin queue (read + convert + dismiss). org-admin own org; super-admin across orgs.
    70	  r.use(requireAuth, requireRole('org-admin', 'super-admin'));
    71	
    72	  r.get('/', async (req: AuthedRequest, res: Response) => {
    73	    const q = req.query as { status?: string; orgId?: string; limit?: string; offset?: string };
    74	    const result = await readChangeRequests(actorOf(req), {
    75	      status: q.status as ChangeRequestStatus | undefined,

---
    33	}
    34	
    35	/**
    36	 * File a change request. Two documented modes, distinguished by `target`:
    37	 *  - served-app filing (`target` set): the app OWNER's org is the queue owner (isolation
    38	 *    boundary) — resolved from the owner user record, NEVER the requester's org or the body.
    39	 *  - dashboard refused-build filing (`target` null): no served app; the request lands in the
    40	 *    REQUESTER's OWN org, with the body `appId` kept only as an informational label (an
    41	 *    edit-refusal artifactId) — convert re-gates it via H1 (loadWritable), so a planted id leaks
    42	 *    nothing.
    43	 * Returns the created request plus the org-admin userIds to live-notify (the caller — the route,
    44	 * which may import agents/streaming — fires the SSE; this module only reads data/).
    45	 */
    46	export async function fileChangeRequest(
    47	  requester: { userId: string; username: string; orgId: string },
    48	  target: { ownerUserId: string; appId: string } | null,
    49	  body: { text: string; route?: string; screenState?: string; appId?: string },
    50	  deps: Deps,
    51	): Promise<{ request: ChangeRequest; notifyUserIds: string[] }> {
    52	  let orgId: string;
    53	  let appId: string | undefined;
    54	  if (target) {
    55	    const owner = await users.get(target.ownerUserId);
    56	    orgId = owner?.orgId ?? '';
    57	    appId = target.appId;
    58	  } else {
    59	    orgId = requester.orgId;
    60	    appId = body.appId;
    61	  }
    62	  const doc: ChangeRequestDoc = {
    63	    _id: deps.genId(),
    64	    orgId,
    65	    requesterUserId: requester.userId,
    66	    requesterName: requester.username,
    67	    text: body.text,
    68	    status: 'open',
    69	    createdAt: new Date(deps.now()).toISOString(),
    70	    ...(appId ? { appId } : {}),
    71	    ...(body.route ? { route: body.route } : {}),
    72	    ...(body.screenState ? { screenState: body.screenState } : {}),
    73	  };
    74	  await changeRequests.insert(doc);
    75	  // Live push to the OWNER org's admins only (org-scoped fan-in — never another org's admins).
    76	  const admins = orgId ? await users.find({ orgId, role: 'org-admin' }) : [];
    77	  return { request: changeRequestView(doc), notifyUserIds: admins.map((a) => a._id) };
    78	}
    79	
    80	/**
    81	 * Queue read. org-admin: OWN org ONLY (the isolation crux). super-admin: across orgs, optionally
    82	 * narrowed by `orgId`. Mirrors registo.ts's readRegisto scoping exactly. Newest first.
    83	 */
    84	export async function readChangeRequests(
    85	  actor: Actor,
    86	  query: { status?: ChangeRequestStatus; orgId?: string; limit?: number; offset?: number },
    87	): Promise<{ items: ChangeRequest[]; total: number }> {
    88	  const filter =
    89	    actor.role === 'super-admin'
    90	      ? (query.orgId ? { orgId: query.orgId } : {})
    91	      : { orgId: actor.orgId };
    92	  let rows = await changeRequests.find(filter, { createdAt: -1 });
    93	  if (query.status) rows = rows.filter((r) => r.status === query.status);
    94	  const total = rows.length;
    95	  const page = rows.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100));

codex
- CLOSED (Med): `whoami` now mirrors the full H1 admission path fail-closed, including `billingLocked`, before capability + writability, so H2/H3 can no longer offer edit mode that `POST /jobs` would reject. Verified in [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:110), matching [api/src/auth/middleware.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/middleware.ts:44), [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:44), and [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:103). The new billing-locked pin in [api/tests/apps/app-assistant.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/apps/app-assistant.test.ts:403) covers the prior divergence. No new oracle/bypass introduced: bad/missing/stale tokens still collapse to `admin:false`, and ownership remains resolved only through `loadWritable`.
- CLOSED (Low): the H4 convert path still correctly relies on the server’s `404` for non-writable follow-up edits and only improves the client message when the queued request names an app, which preserves the non-oracle server behavior while removing the dead-end UX. Verified in [web/stores/change-requests.ts](/Users/ggomes/dev/ekoa-code/web/stores/change-requests.ts:94), with the unchanged server-side gate and org/cross-org isolation still enforced in [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:44), [api/src/routes/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:36), and [api/src/services/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:46). I found no new defect and no disturbance to the previously verified block coherence around migration, revocation durability, gate revalidation, or cross-org isolation.

VERDICT: APPROVE
hook: Stop
hook: Stop Completed
tokens used
57,875
- CLOSED (Med): `whoami` now mirrors the full H1 admission path fail-closed, including `billingLocked`, before capability + writability, so H2/H3 can no longer offer edit mode that `POST /jobs` would reject. Verified in [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:110), matching [api/src/auth/middleware.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/middleware.ts:44), [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:44), and [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:103). The new billing-locked pin in [api/tests/apps/app-assistant.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/apps/app-assistant.test.ts:403) covers the prior divergence. No new oracle/bypass introduced: bad/missing/stale tokens still collapse to `admin:false`, and ownership remains resolved only through `loadWritable`.
- CLOSED (Low): the H4 convert path still correctly relies on the server’s `404` for non-writable follow-up edits and only improves the client message when the queued request names an app, which preserves the non-oracle server behavior while removing the dead-end UX. Verified in [web/stores/change-requests.ts](/Users/ggomes/dev/ekoa-code/web/stores/change-requests.ts:94), with the unchanged server-side gate and org/cross-org isolation still enforced in [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:44), [api/src/routes/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:36), and [api/src/services/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:46). I found no new defect and no disturbance to the previously verified block coherence around migration, revocation durability, gate revalidation, or cross-org isolation.

VERDICT: APPROVE
