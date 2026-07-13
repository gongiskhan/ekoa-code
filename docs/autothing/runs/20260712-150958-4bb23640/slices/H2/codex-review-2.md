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
session id: 019f5d39-4200-7be2-8748-5e42694a9b33
--------
user
Adversarial SECURITY re-review in /Users/ggomes/dev/ekoa-code. You earlier flagged 2 issues on H2 whoami (Medium: not fail-closed when the app owner record is missing/has no orgId - super-admin still got admin:true; Low: org-admin owner-org membership oracle). The fix is in commit 61c0372 (git show 61c0372). The fix redefines whoami 'admin' to MIRROR the H1 follow-up-build edit gate EXACTLY: admin = can(caller,'canEditApps') AND loadWritable(caller, appId).verdict==='ok' (own always; org-shared in-org ok; other-user-private forbidden; missing/cross-org notfound), instead of the old role+owner-org check. Verify BOTH findings are CLOSED and no NEW defect was introduced: (1) Medium - an orphaned/no-orgId/cross-org artifact now yields loadWritable notfound -> admin:false even for super-admin? trace isAppEditor + detectAppEditor + the whoami handler in api/src/apps/app-assistant-route.ts; (2) Low - is the oracle gone? admin:true now only for apps loadWritable grants (own + org-shared in the caller's org), which the caller already enumerates via GET /artifacts listVisible - confirm a same-org OTHER-user PRIVATE app now reads admin:false (no in-org private-app existence oracle) and cross-org reads false; (3) NEW - did the loadWritable import into app-assistant-route create a cycle or change POST's visitor-blind path; is detectAppEditor still fail-closed 200 on every token failure (no throw/4xx); is the verify chain still the full verifySseToken; does the panel still only read the boolean; any dead code left (isOwnerOrgAdmin removed?). Also assess: is 'app edit is org-scoped (super-admin cannot cross-org edit)' a defensible policy or a regression - note it but it is a documented decision, not necessarily a defect. Read slices/H2/impl-notes.md (the Codex-fix round section) + slices/H2/codex-review.md (your prior findings). Read-only cmds OK. Concise: a bullet per finding (CLOSED/NOT-CLOSED + file:line) then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing the fix in `61c0372` against the prior H2 findings. I’m gathering the repo guidance files, the prior review notes, and the relevant auth/edit-path code before I trace the whoami behavior end to end.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -1 && test -d .codegraph && echo CODEGRAPH_PRESENT || echo CODEGRAPH_MISSING && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'AGENTS.md' -g 'slices/H2/impl-notes.md' -g 'slices/H2/codex-review.md'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
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

exec
/bin/zsh -lc 'git show --stat --oneline 61c0372 && git show --no-ext-diff --unified=80 61c0372 -- api/src/apps/app-assistant-route.ts api/src/artifacts/app-access.ts api/src/apps/app-route-shared.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-MFOchZLI' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-WyfpxvmO' (errno=Operation not permitted)
61c0372 fix(operator-run/h2): codex findings - whoami admin now MIRRORS the H1 edit gate exactly (can(canEditApps) + loadWritable), not the weaker owner-org-admin check. Closes the Medium (orphaned/empty owner org -> notfound -> false, fail-closed) + the Low (admin:true only for own+org-shared apps the caller already sees via listArtifacts, so no in-org private-app existence oracle) + a false-offer bug (detection now == what the follow-up build will actually allow). App edit is org-scoped; super-admin cross-org edit would be a deliberate H1+H2 policy change
 api/src/apps/app-assistant-route.ts                | 73 +++++++++++++---------
 api/tests/apps/app-assistant.test.ts               | 73 ++++++++++++++--------
 .../slices/H2/impl-notes.md                        | 32 ++++++++++
 3 files changed, 122 insertions(+), 56 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-UDdum0Ml' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-50IWQpCR' (errno=Operation not permitted)
commit 61c037297c6f749a9a3aacb34550d35a13ecd667
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 21:43:38 2026 +0100

    fix(operator-run/h2): codex findings - whoami admin now MIRRORS the H1 edit gate exactly (can(canEditApps) + loadWritable), not the weaker owner-org-admin check. Closes the Medium (orphaned/empty owner org -> notfound -> false, fail-closed) + the Low (admin:true only for own+org-shared apps the caller already sees via listArtifacts, so no in-org private-app existence oracle) + a false-offer bug (detection now == what the follow-up build will actually allow). App edit is org-scoped; super-admin cross-org edit would be a deliberate H1+H2 policy change

diff --git a/api/src/apps/app-assistant-route.ts b/api/src/apps/app-assistant-route.ts
index 1ad6a9d..156835c 100644
--- a/api/src/apps/app-assistant-route.ts
+++ b/api/src/apps/app-assistant-route.ts
@@ -1,271 +1,286 @@
 /**
  * Served-app assistant plane (operator-run D1) — `POST /api/app-assistant`.
  *
  * The header-scoped (no platform JWT) endpoint the served app's assistant panel calls. It reuses
  * the served-data admission plane: the `X-Ekoa-App-Id` header (charset-checked; the reserved `usr.`
  * shared-namespace prefix rejected) resolves to the artifact, whose OWNER's activation gates the
  * plane (fail-closed). Unlike the byte-compatible key-value app-data plane, the assistant REQUIRES
  * a resolved artifact-backed owner — it has to run under that owner's org and bill that owner — so
  * an unresolved / registry-only (dev-serve) id is a 404 here rather than an anonymous scope.
  *
  * Errors speak the CONV-2 envelope (a new endpoint, not the old app-data string envelope). This
  * module may not import routes/ (ch02 §2.7 lint zone), so it emits the envelope directly off the
  * shared ERROR_STATUS table — the same shape routes/helpers.sendError produces.
  *
  * The org the assistant grounds under and the user it bills come ONLY from the server-resolved
  * owner — never from the anonymous visitor's body. The billing allowance gate is billed to that
  * same owner (the served-app assistant is a named synchronous entry in billing/allowance.ts).
  */
 import { Router, type Request, type Response, type RequestHandler, type NextFunction } from 'express';
 import {
   AssistantChatRequest,
   AppActionManifest,
   ERROR_STATUS,
   type ErrorCode,
   type AssistantChatResponse,
   type AppAssistantWhoamiResponse,
 } from '@ekoa/shared';
 import { collectionName } from '../data/collections-engine.js';
 import { getActivation } from '../data/activation.js';
 import { users, artifacts } from '../data/stores.js';
 import { allowanceMiddleware } from '../billing/index.js';
 import { runOneShot, decideForTask } from '../llm/index.js';
 import { buildGroundingBlock } from '../knowledge/index.js';
 import { verifySseToken } from '../auth/middleware.js';
 import { can } from '../auth/capabilities.js';
 import type { JwtClaims } from '../auth/jwt.js';
 import { resolveApp, type ResolvedApp } from './registry.js';
+import { loadWritable } from './app-paths.js';
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
- * Is this verified caller an admin of the app OWNER's org WITH the app-edit capability? PURE role
- * decision (the token is already verified by the caller). Gated by H1's `can()` so the role→
- * capability grid is the single source of truth — a `user` fails the capability gate, so only
- * `org-admin`/`super-admin` reach the org check. A super-admin spans every org; an org-admin must
- * belong to the owner's exact org. Fail-closed for any other shape. Exported for the unit matrix.
+ * Can this verified caller EDIT this specific app? Detection MIRRORS the H1 follow-up-build gate
+ * EXACTLY (routes/jobs.ts): `can(canEditApps)` AND the artifact is writable by this actor
+ * (loadWritable: own always; org-shared within the org ok; another user's private → not-ok;
+ * missing/cross-org → not-ok). Making detection identical to the actual edit authority is what
+ * closes BOTH codex-h2 findings and a false-offer bug at once:
+ *   - Medium (fail-closed on a missing owner org): an orphaned/cross-org/unresolvable artifact is
+ *     never writable, so admin is false even for a super-admin — no false positive.
+ *   - Low (org-admin membership oracle): admin:true only for apps loadWritable already grants, i.e.
+ *     the caller's OWN + org-shared apps — exactly what they already enumerate via GET /artifacts
+ *     (listVisible). It reveals nothing new; a same-org OTHER user's PRIVATE app reads not-writable
+ *     → admin:false, so it is not an existence oracle for private in-org apps.
+ *   - No false offer: admin:true ⟺ H3's edit mode / the follow-up build will actually succeed for
+ *     this caller on this app. The panel never promises an edit the gate would then refuse.
+ * NOTE: like the H1 gate, loadWritable is org-scoped, so a super-admin is NOT granted cross-org app
+ * edit here (a super-admin only edits apps in their own org). If platform-wide cross-org app editing
+ * is ever wanted, that is a deliberate policy change to loadWritable/the H1 gate AND this detection
+ * together — not a silent divergence. Exported for the unit matrix.
  */
-export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
+export function isAppEditor(claims: Pick<JwtClaims, 'role' | 'orgId'>, writableVerdict: 'ok' | 'forbidden' | 'notfound'): boolean {
   if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
-  if (claims.role === 'super-admin') return true; // super-admin edits apps in any org
-  if (claims.role === 'org-admin') return claims.orgId === ownerOrgId; // org-admin scoped to owner org
-  return false; // unreachable given the capability gate, but fail-closed by construction
+  return writableVerdict === 'ok'; // ...and the actor must actually be able to write THIS artifact
 }
 
 /**
- * Detect whether the OPTIONAL platform Bearer on this request belongs to an admin of `ownerOrgId`.
- * FAIL-CLOSED and oracle-free: any deviation — no token, a non-Bearer header, or a token that does
- * not clear the standard verification chain — returns false, never throws, never distinguishes a
- * bad token from a wrong-org one. The verification is the EXACT chain requireAuth/verifySseToken
- * run (verifyToken + jti + isRevoked + activation-active + tokenEpoch); this endpoint does NOT
- * hand-roll a weaker check and adds NO second identity path.
+ * Detect whether the OPTIONAL platform Bearer on this request can EDIT app `appId`. FAIL-CLOSED and
+ * oracle-free: any deviation — no token, a non-Bearer header, or a token that does not clear the
+ * standard verification chain — returns false, never throws, never distinguishes a bad token from a
+ * not-writable one. The verification is the EXACT chain requireAuth/verifySseToken run (verifyToken
+ * + jti + isRevoked + activation-active + tokenEpoch); the edit decision is the EXACT H1 gate
+ * (can(canEditApps) + loadWritable). This endpoint does NOT hand-roll a weaker check and adds NO
+ * second identity path.
  */
-function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
+async function detectAppEditor(authHeader: string | undefined, appId: string): Promise<boolean> {
   const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
   if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
   const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
   if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
-  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
+  const actor = { userId: verified.claims.sub, orgId: verified.claims.orgId, role: verified.claims.role };
+  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
+  return isAppEditor(verified.claims, verdict);
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
 
   r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
     const admission = req.ekoaAssistant;
     if (!admission) {
       sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
       return;
     }
 
     const parsed = AssistantChatRequest.safeParse(req.body ?? {});
     if (!parsed.success) {
       sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
       return;
     }
     const body = parsed.data;
 
     try {
       const result = await runAppAssistant(
         {
           message: body.message,
           history: body.history,
           mode: body.mode,
           context: body.context,
           owner: admission.owner,
           artifactId: admission.artifactId,
           actionManifest: admission.actionManifest,
         },
         deps,
       );
       const response: AssistantChatResponse = {
         reply: result.reply,
         mode: result.mode,
         ...(result.citations.length > 0 ? { citations: result.citations } : {}),
         ...(result.actions.length > 0 ? { actions: result.actions } : {}),
       };
       res.json(response);
     } catch (err) {
       console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
       sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
     }
   });
 
   /**
    * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
    *
    * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
-   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "is the
-   * current viewer an admin of this app's owner org?". It NEVER grounds, NEVER bills, NEVER widens
-   * admission, and issues NO model call (the zero-token GET) — the POST grounding/billing path
-   * above stays byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged
-   * action remains gated server-side by the H1 admission plane with this same JWT; `admin: true`
-   * here is only a HINT the panel may surface (edit mode is H3).
+   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "can the
+   * current viewer EDIT this app?" — the SAME decision the H1 follow-up-build gate makes
+   * (can(canEditApps) + loadWritable). It NEVER grounds, NEVER bills, NEVER widens admission, and
+   * issues NO model call (the zero-token GET) — the POST grounding/billing path above stays
+   * byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged action
+   * remains gated server-side by the H1 admission plane with this same JWT; `admin: true` here is
+   * only a HINT the panel may surface (edit mode is H3), and it exactly matches what that edit will
+   * actually be allowed to do — never a false offer.
    *
    * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
    * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
    * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
    * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
    * app existence).
    */
   const whoami = async (req: Request, res: Response): Promise<void> => {
     const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
     if (resolution.status === 'invalid-id') {
       sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
       return;
     }
     if (resolution.status === 'not-found') {
       sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
       return;
     }
 
-    // Owner org — resolved server-side from the owner user record (same source admit() uses),
-    // NEVER from anything the caller supplied.
-    const owner = (await users.get(resolution.app.ownerUserId)) as { orgId?: string } | null;
-    const ownerOrgId = owner?.orgId ?? '';
-
+    // "admin" == can this caller edit THIS app, decided by the SAME rule the H1 edit gate uses
+    // (can(canEditApps) + loadWritable on the resolved artifact id). Ownership/org is resolved
+    // server-side inside loadWritable from the artifact record, NEVER from anything the caller
+    // supplied. Fail-closed + no oracle: see detectAppEditor / isAppEditor above.
     const response: AppAssistantWhoamiResponse = {
-      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
+      admin: await detectAppEditor(req.header('authorization'), resolution.app.appId),
     };
     res.json(response); // always 200 — the boolean IS the answer
   };
 
   /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
    *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
   r.get('/app-assistant/whoami', (req, res) => {
     void whoami(req, res).catch((err) => {
       console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
       sendError(res, 'INTERNAL', 'Erro interno.');
     });
   });
 
   return r;
 }

codex
The commit touches only `app-assistant-route.ts` and tests, but I still need the surrounding edit-gate code to confirm the new `whoami` check is truly identical to the H1 authority path and that POST stayed visitor-blind. Next I’m reading the repo notes plus the exact symbols involved.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'for f in AGENTS.md PRD.md PLANING.md TASKS.md slices/H2/impl-notes.md slices/H2/codex-review.md; do if [ -f "$f" ]; then echo "FILE:$f"; sed -n '"'1,260p' \""'$f"; fi; done' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
exec
/bin/zsh -lc 'codegraph explore "isAppEditor detectAppEditor appAssistantRouter whoami loadWritable verifySseToken"' in /Users/ggomes/dev/ekoa-code
 succeeded in 492ms:
## Flow (call path among the symbols you queried)

1. appAssistantRouter (api/src/apps/app-assistant-route.ts:139)
   ↓ calls
2. detectAppEditor (api/src/apps/app-assistant-route.ts:110)
   ↓ calls
3. verifySseToken (api/src/auth/middleware.ts:59)

> Full source for these symbols is below — the call flow among them, followed by their bodies.
## Exploration: isAppEditor detectAppEditor appAssistantRouter whoami loadWritable verifySseToken

Found 212 symbols across 82 files.

### Blast radius — what depends on these (update/verify before editing)

- `isAppEditor` (api/src/apps/app-assistant-route.ts:96) — 2 callers in `api/src/apps/app-assistant-route.ts`; tests: `api/tests/apps/app-assistant.test.ts`
- `detectAppEditor` (api/src/apps/app-assistant-route.ts:110) — 1 caller in `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `appAssistantRouter` (api/src/apps/app-assistant-route.ts:139) — 1 caller; tests: `api/tests/apps/app-assistant.test.ts`
- `verifySseToken` (api/src/auth/middleware.ts:59) — 8 callers in `api/src/routes/automations.ts`, `api/src/routes/chat.ts`, `api/src/routes/jobs.ts`, `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- isAppEditor → can
- detectAppEditor → isAppEditor
- denyAppEdit → can
- artifactsRouter → can
- detectAppEditor → verifySseToken
- detectAppEditor → loadWritable
- appAssistantRouter → detectAppEditor
- appAssistantRouter → Router
- verifySseToken → isRevoked
- verifySseToken → getActivation
- ... and 338 more

**references:**
- isAppEditor → JwtClaims
- detect → DetectionResult
- getCurrentUser → CurrentUser
- whoami → WhoAmI
- cached → CurrentUser
- verifySseToken → ErrorCode
- sendError → ErrorCode
- appAssistantRouter → AppAssistantWhoamiResponse
- can → Capability
- appFilesRouter → Router
- ... and 95 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/app-assistant-route.ts — isAppEditor, detectAppEditor, appAssistantRouter, resolveAssistantApp, sendError, app-assistant-route.ts · focused (the methods you named in full, the rest as signatures — codegraph_explore a signature by name for its body; do NOT Read)

```typescript
1	/**
44	function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
60	async function resolveAssistantApp(header: unknown): Promise<AssistantAppResolution> {
96	export function isAppEditor(claims: Pick<JwtClaims, 'role' | 'orgId'>, writableVerdict: 'ok' | 'forbidden' | 'notfound'): boolean {
97	  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
98	  return writableVerdict === 'ok'; // ...and the actor must actually be able to write THIS artifact
99	}
110	async function detectAppEditor(authHeader: string | undefined, appId: string): Promise<boolean> {
111	  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
112	  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
113	  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
114	  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
115	  const actor = { userId: verified.claims.sub, orgId: verified.claims.orgId, role: verified.claims.role };
116	  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
117	  return isAppEditor(verified.claims, verdict);
118	}
139	export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
140	  const r = Router();
141	
142	  /**
143	   * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
144	   * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
145	   * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
146	   */
147	  const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
148	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
149	    if (resolution.status === 'invalid-id') {
150	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
151	      return;
152	    }
153	    if (resolution.status === 'not-found') {
154	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
155	      return;
156	    }
157	    const app = resolution.app;
158	
159	    // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
160	    const activation = getActivation(app.ownerUserId);
161	    if (!activation || activation.active === false) {
162	      sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
163	      return;
164	    }
165	    if (activation.billingLocked) {
166	      sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
167	      return;
168	    }
169	
170	    // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
171	    const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
172	    const orgId = owner?.orgId ?? '';
173	
174	    // The app's declared action manifest (persisted at activation on the artifact data bag).
175	    // Validate it against the shared contract; absent/invalid → no operate surface (null).
176	    const art = await artifacts.get(app.appId);
177	    const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
178	    const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
179	    const actionManifest = parsedManifest?.success ? parsedManifest.data : null;
180	
181	    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
182	    next();
183	  };
184	
185	  /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
186	  const admitGuarded: RequestHandler = (req, res, next) => {
187	    void admit(req, res, next).catch((err) => {
188	      console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
189	      sendError(res, 'INTERNAL', 'Erro interno.');
190	    });
191	  };
192	
193	  // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
194	  const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
195	
196	  r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
197	    const admission = req.ekoaAssistant;
198	    if (!admission) {
199	      sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
200	      return;
201	    }
202	
203	    const parsed = AssistantChatRequest.safeParse(req.body ?? {});
204	    if (!parsed.success) {
205	      sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
206	      return;
207	    }
208	    const body = parsed.data;
209	
210	    try {
211	      const result = await runAppAssistant(
212	        {
213	          message: body.message,
214	          history: body.history,
215	          mode: body.mode,
216	          context: body.context,
217	          owner: admission.owner,
218	          artifactId: admission.artifactId,
219	          actionManifest: admission.actionManifest,
220	        },
221	        deps,
222	      );
223	      const response: AssistantChatResponse = {
224	        reply: result.reply,
225	        mode: result.mode,
226	        ...(result.citations.length > 0 ? { citations: result.citations } : {}),
227	        ...(result.actions.length > 0 ? { actions: result.actions } : {}),
228	      };
229	      res.json(response);
230	    } catch (err) {
231	      console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
232	      sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
233	    }
234	  });
235	
236	  /**
237	   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
238	   *
239	   * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
240	   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "can the
241	   * current viewer EDIT this app?" — the SAME decision the H1 follow-up-build gate makes
242	   * (can(canEditApps) + loadWritable). It NEVER grounds, NEVER bills, NEVER widens admission, and
243	   * issues NO model call (the zero-token GET) — the POST grounding/billing path above stays
244	   * byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged action
245	   * remains gated server-side by the H1 admission plane with this same JWT; `admin: true` here is
246	   * only a HINT the panel may surface (edit mode is H3), and it exactly matches what that edit will
247	   * actually be allowed to do — never a false offer.
248	   *
249	   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
250	   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
251	   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
252	   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
253	   * app existence).
254	   */
255	  const whoami = async (req: Request, res: Response): Promise<void> => {
256	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
257	    if (resolution.status === 'invalid-id') {
258	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
259	      return;
260	    }
261	    if (resolution.status === 'not-found') {
262	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
263	      return;
264	    }
265	
266	    // "admin" == can this caller edit THIS app, decided by the SAME rule the H1 edit gate uses
267	    // (can(canEditApps) + loadWritable on the resolved artifact id). Ownership/org is resolved
268	    // server-side inside loadWritable from the artifact record, NEVER from anything the caller
269	    // supplied. Fail-closed + no oracle: see detectAppEditor / isAppEditor above.
270	    const response: AppAssistantWhoamiResponse = {
271	      admin: await detectAppEditor(req.header('authorization'), resolution.app.appId),
272	    };
273	    res.json(response); // always 200 — the boolean IS the answer
274	  };
275	
276	  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
277	   *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
278	  r.get('/app-assistant/whoami', (req, res) => {
279	    void whoami(req, res).catch((err) => {
280	      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
281	      sendError(res, 'INTERNAL', 'Erro interno.');
282	    });
283	  });
284	
285	  return r;
286	}
```

#### api/assets/featured-artifacts/legal-portal/scaffold/frontend/src/portal.js — whoami(function), calls(calls)

```javascript
112	 * Sessão de app (via a plataforma). Fina camada sobre window.__ekoa.
113	 * ------------------------------------------------------------------------- */
114	
115	export async function whoami() {
116	  const api = ekoa();
117	  if (!api || typeof api.whoami !== 'function') return null;
118	  try {
119	    return await api.whoami();
120	  } catch {
121	    return null;
122	  }
123	}
124	
125	export async function passwordSignIn(email, password) {
126	  const api = ekoa();
```

#### api/assets/bases/app/wiring/protocol-client.ts — whoami(function), getRuntime(function), WhoAmI(interface)

```typescript
1	/**
2	 * Protocol client for the `app` base.
3	 *
4	 * The typed surface over the platform's INJECTED served-app runtime
5	 * (`window.__ekoa`, stamped into every served document - see the served-app
6	 * byte-compat plane, api-contract 3.9). It wraps the sanctioned client calls:
7	 * end-user SSO identity (whoami / signIn / signOut), the visitor's Microsoft 365
8	 * Graph proxy (graphFetch), server-side PDF export (exportPdf), and workspace
9	 * cloud files (cloudFiles).
10	 *
11	 * Persistence is NOT here - use `./jsonStore` (the /api/app-data plane).
12	 *
13	 * There is NO client-side generic action envelope and NO direct integration
14	 * calls: an app never reaches an external API itself. Cross-service work is done
15	 * by platform-executed `integration.call` capabilities declared in MANIFEST.md;
16	 * the only in-app integration path is the authenticated visitor's own Microsoft
17	 * 365 via `graphFetch`.
18	 *
19	 * Every wrapper degrades cleanly when the runtime is absent (standalone preview,
20	 * file://, the screenshot pipeline): `whoami()` resolves `null`; the action
21	 * wrappers throw `RuntimeUnavailable`, which callers can catch to render a
22	 * fallback. The shell must render fully with no runtime present.
23	 */
24	
25	export interface WhoAmI {
26	  email: string;
27	  name: string | null;
28	  oid: string | null;
29	  tid: string | null;
30	  /** Whether the visitor granted the delegated Graph scopes (Mail.Send, Calendars). */
31	  canSendMail: boolean;
32	}
33	
34	export interface PdfExportOptions {
35	  filename?: string;
36	  format?: 'A4' | 'Letter' | 'Legal';
37	  landscape?: boolean;
38	  /** Explicit HTML to render; defaults to the live document (scripts/.no-print stripped). */
39	  html?: string;
40	  /** Set false to receive the result without triggering a browser download. */
41	  download?: boolean;
42	}
43	
44	export interface PdfExportResult {
45	  url: string;
46	  [key: string]: unknown;
47	}
48	
49	export interface CloudFileRef {
50	  id: string;
51	  name: string;
52	  [key: string]: unknown;
53	}
54	
55	export interface CloudFileDownload {
56	  name: string;
57	  type: string;
58	  blob: Blob;
59	}
60	
61	export interface CloudFilesClient {
62	  status(): Promise<unknown>;
63	  upload(file: Blob, opts: { provider?: string; name?: string; type?: string }): Promise<unknown>;
64	  list(provider: string, query?: string): Promise<CloudFileRef[]>;
65	  download(provider: string, id: string): Promise<CloudFileDownload>;
66	}
67	
68	/** The subset of the injected `window.__ekoa` surface this client wraps. */
69	export interface EkoaRuntime {
70	  fetch(path: string, options?: RequestInit): Promise<Response>;
71	  whoami(): Promise<WhoAmI | null>;
72	  signIn(returnPath?: string): void;
73	  signOut(): Promise<boolean>;
74	  graphFetch(path: string, options?: RequestInit): Promise<Response>;
75	  exportPdf(opts?: PdfExportOptions): Promise<PdfExportResult>;
76	  cloudFiles: CloudFilesClient;
77	}
78	
79	declare global {
80	  interface Window {
81	    __EKOA_APP_ID?: string;
82	    __ekoa?: EkoaRuntime;
83	  }
84	}
85	
86	/** Thrown by the action wrappers when the served-app runtime is not present. */
87	export class RuntimeUnavailable extends Error {
88	  readonly feature: string;
89	  constructor(feature: string) {
90	    super(`Ekoa runtime unavailable - ${feature} needs the served-app context (open at /apps/<id>/).`);
91	    this.name = 'RuntimeUnavailable';
92	    this.feature = feature;
93	  }
94	}
95	
96	/** The injected runtime, or undefined outside a served-app document. */
97	export function getRuntime(): EkoaRuntime | undefined {
98	  return typeof window !== 'undefined' ? window.__ekoa : undefined;
99	}
100	
101	function requireRuntime(feature: string): EkoaRuntime {
102	  const rt = getRuntime();
103	  if (!rt) throw new RuntimeUnavailable(feature);
104	  return rt;
105	}
106	
107	/**
108	 * The signed-in visitor, or null when logged out or the runtime is absent.
109	 * NON-THROWING - safe to call unconditionally on mount.
110	 */
111	export async function whoami(): Promise<WhoAmI | null> {
112	  const rt = getRuntime();
113	  if (!rt) return null;
114	  try {
115	    return await rt.whoami();
116	  } catch {
117	    return null;
118	  }
119	}
120	
121	/** Start the full-page Microsoft sign-in. Throws RuntimeUnavailable with no runtime. */
122	export function signIn(returnPath?: string): void {
123	  requireRuntime('signIn').signIn(returnPath);
124	}
125	
126	/** End the visitor session. Throws RuntimeUnavailable with no runtime. */
127	export function signOut(): Promise<boolean> {
128	  return requireRuntime('signOut').signOut();
129	}
130	
131	/**
132	 * Proxy a Microsoft Graph request AS THE VISITOR (their delegated SSO session).
133	 * `path` is relative to the Graph proxy root (e.g. `me`, `me/messages`).
134	 * Throws RuntimeUnavailable with no runtime; the caller catches to render an
135	 * IntegrationNeededBoundary when the visitor has not connected Microsoft 365.
136	 */
137	export function graphFetch(path: string, options?: RequestInit): Promise<Response> {
138	  return requireRuntime('graphFetch').graphFetch(path, options);
139	}
140	
141	/** Server-rendered PDF of the live document (or `opts.html`). Throws RuntimeUnavailable with no runtime. */
142	export function exportPdf(opts?: PdfExportOptions): Promise<PdfExportResult> {
143	  return requireRuntime('exportPdf').exportPdf(opts);
144	}
145	
146	/**
147	 * Workspace cloud files (Google Drive / OneDrive) for save-to-cloud flows.
148	 * Each method throws RuntimeUnavailable with no runtime.
149	 */
150	export const cloudFiles: CloudFilesClient = {
151	  status: () => requireRuntime('cloudFiles.status').cloudFiles.status(),
152	  upload: (file, opts) => requireRuntime('cloudFiles.upload').cloudFiles.upload(file, opts),
153	  list: (provider, query) => requireRuntime('cloudFiles.list').cloudFiles.list(provider, query),
154	  download: (provider, id) => requireRuntime('cloudFiles.download').cloudFiles.download(provider, id),
155	};
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
`AGENTS.md` references `PRD.md`/`PLANING.md`/`TASKS.md`, but from the root listing they do not appear to exist here. I’m confirming the H2 notes directly and then comparing `whoami` against the actual edit gate implementation in the H1 path.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n --hidden --glob '"'!node_modules'"' --glob '"'!test-results'"' \"\" slices/H2/impl-notes.md slices/H2/codex-review.md" in /Users/ggomes/dev/ekoa-code
 exited 2 in 0ms:
rg: slices/H2/impl-notes.md: No such file or directory (os error 2)
rg: slices/H2/codex-review.md: No such file or directory (os error 2)

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph explore "loadWritable denyAppEdit canEditApps verifySseToken routes/jobs app edit gate"' in /Users/ggomes/dev/ekoa-code
 succeeded in 411ms:
## Exploration: loadWritable denyAppEdit canEditApps verifySseToken routes/jobs app edit gate

Found 211 symbols across 55 files.

### Blast radius — what depends on these (update/verify before editing)

- `denyAppEdit` (api/src/routes/artifacts.ts:81) — 1 caller in `api/src/routes/artifacts.ts`; ⚠️ no covering tests found
- `AppDataDeps` (api/src/apps/app-data-access.ts:22) — 10 callers in `api/src/apps/artifact-bundle.ts`, `api/src/apps/backups.ts`, `api/src/apps/artifact-featured-update.ts`, `api/src/routes/artifacts.ts` +1 more; ⚠️ no covering tests found
- `AppDataDump` (api/src/apps/app-data-access.ts:27) — 7 callers in `api/src/apps/backups.ts`, `api/src/apps/app-data-access.ts`; tests: `api/tests/contract/artifact-family.test.ts`
- `AppSsoDeps` (api/src/integrations/app-sso.ts:344) — 1 caller in `api/src/integrations/app-sso.ts`; ⚠️ no covering tests found

### Relationships

**references:**
- constructor → AppDataDeps
- updateArtifactFromBundle → AppDataDeps
- constructor → AppDataDeps
- applyFeaturedUpdate → AppDataDeps
- exportAll → AppDataDump
- importDump → AppDataDump
- exportAll → AppDataDump
- readLocalSnapshot → AppDataDump
- previewAsOf → AppDataDump
- AppSsoDeps → ResolveAppScope
- ... and 65 more

**calls:**
- exportAll → listCollections
- exportAll → list
- runAppAssistant → map
- buildApp → map
- artifactsRouter → map
- createBuildMechanics → map
- register → set
- startWatcher → set
- proxyToGraph → set
- invoke → set
- ... and 286 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/app-paths.ts — isAppArtifact(function), getArtifactById(function), setFeaturedFlag(function), projectDirFor(function), defaultProjectDir(function), recordedProjectDir(function), newProjectDir(function), loadWritable(function)

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

#### api/src/auth/middleware.ts — AuthedRequest(interface), requireRole(function), requireAuth(function), verifySseToken(function)

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


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The security-relevant pieces line up so far: `detectAppEditor` now uses `verifySseToken` plus `loadWritable`, and `loadWritable` is clearly org-scoped with `notfound` on missing or cross-org rows. I’m locating the H2 notes/tests next to confirm the intended cases were covered and to check for any route-level regressions around `whoami` and POST.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files | rg 'impl-notes\\.md|codex-review\\.md|PRD\\.md|PLANING\\.md|TASKS\\.md|app-assistant\\.test\\.ts|app-assistant-route\\.ts|jobs\\.ts|artifacts\\.ts'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/routes/jobs.ts
api/src/routes/artifacts.ts
api/src/apps/app-assistant-route.ts
api/src/agents/jobs.ts
docs/autothing/runs/20260712-150958-4bb23640/slices/F1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C5/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D3/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
api/tests/apps/app-assistant.test.ts
docs/autothing/runs/20260712-150958-4bb23640/slices/G2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/F2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/F2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/B2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D1/impl-notes.md
shared/src/jobs.ts
shared/src/artifacts.ts

exec
/bin/zsh -lc 'codegraph explore "app assistant test whoami admin loadWritable detectAppEditor"' in /Users/ggomes/dev/ekoa-code
 succeeded in 388ms:
## Flow (call path among the symbols you queried)

1. App (api/assets/bases/app/scaffold/frontend/src/App.jsx:53)
   ↓ calls
2. getCurrentUser (api/assets/bases/app/wiring/auth.ts:30)
   ↓ calls
3. whoami (api/assets/bases/app/wiring/protocol-client.ts:111)

> Full source for these symbols is below — the call flow among them, followed by their bodies.
## Exploration: app assistant test whoami admin loadWritable detectAppEditor

Found 217 symbols across 102 files.

### Blast radius — what depends on these (update/verify before editing)

- `AppAssistantDeps` (api/src/apps/app-assistant.ts:57) — 6 callers in `api/src/apps/app-assistant-route.ts`, `api/src/apps/app-assistant.ts`; tests: `api/tests/apps/app-assistant.test.ts`
- `AppAssistantOwner` (api/src/apps/app-assistant.ts:37) — 1 caller in `api/src/apps/app-assistant.ts`; ⚠️ no covering tests found
- `AppAssistantInput` (api/src/apps/app-assistant.ts:44) — 2 callers in `api/src/apps/app-assistant.ts`; ⚠️ no covering tests found
- `AppAssistantResult` (api/src/apps/app-assistant.ts:66) — 1 caller in `api/src/apps/app-assistant.ts`; ⚠️ no covering tests found

### Relationships

**references:**
- AppAssistantDeps → OneShotOptions
- AppAssistantDeps → LlmAttribution
- AppAssistantInput → AppAssistantOwner
- AppAssistantInput → AppActionManifest
- buildSystemPrompt → AppAssistantInput
- runAppAssistant → AppAssistantInput
- UiActionsResult → AppActionManifest
- assistantToolsFromManifest → AppActionManifest
- manifest → AppActionManifest
- AssistantAdmission → AppActionManifest
- ... and 69 more

**calls:**
- runAppAssistant → inferMode
- runAppAssistant → map
- runAppAssistant → renderPrompt
- runAppAssistant → extractActions
- appAssistantRouter → runAppAssistant
- runAppAssistant → assistantToolsFromManifest
- appAssistantRouter → resolveAssistantApp
- resolveMemoryInjection → map
- memoriesRouter → map
- sessionsRouter → map
- ... and 250 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/app-assistant-route.ts — imports(imports), Router(imports), AppActionManifest(imports), AssistantChatResponse(imports), AppAssistantWhoamiResponse(imports), getActivation(imports), allowanceMiddleware(imports), runOneShot(imports), resolveApp(imports), ResolvedApp(imports), +11 more

```typescript
16	 * owner — never from the anonymous visitor's body. The billing allowance gate is billed to that
17	 * same owner (the served-app assistant is a named synchronous entry in billing/allowance.ts).
18	 */
19	import { Router, type Request, type Response, type RequestHandler, type NextFunction } from 'express';
20	import {
21	  AssistantChatRequest,
22	  AppActionManifest,
23	  ERROR_STATUS,
24	  type ErrorCode,
25	  type AssistantChatResponse,
26	  type AppAssistantWhoamiResponse,
27	} from '@ekoa/shared';
28	import { collectionName } from '../data/collections-engine.js';
29	import { getActivation } from '../data/activation.js';
30	import { users, artifacts } from '../data/stores.js';
31	import { allowanceMiddleware } from '../billing/index.js';
32	import { runOneShot, decideForTask } from '../llm/index.js';
33	import { buildGroundingBlock } from '../knowledge/index.js';
34	import { verifySseToken } from '../auth/middleware.js';
35	import { can } from '../auth/capabilities.js';
36	import type { JwtClaims } from '../auth/jwt.js';
37	import { resolveApp, type ResolvedApp } from './registry.js';
38	import { loadWritable } from './app-paths.js';
39	import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';
40	
41	const SHARED_SCOPE_PREFIX = 'usr.';
42	
43	/** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
44	function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
45	  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
46	}
47	
48	/**
49	 * Resolve the `X-Ekoa-App-Id` header to an artifact-backed owner — the SHARED front half of every
50	 * app-assistant plane entry (POST admission AND the H2 whoami detection), so both apply the exact
51	 * same charset/collision checks and expose the exact same existence surface (no plane is a
52	 * different oracle than the other). A discriminated result the callers turn into the CONV-2
53	 * envelope: `invalid-id` → 400 VALIDATION_FAILED, `not-found` → 404 NOT_FOUND, `ok` → the app.
54	 */
55	type AssistantAppResolution =
56	  | { status: 'invalid-id' }
57	  | { status: 'not-found' }
58	  | { status: 'ok'; app: ResolvedApp };
59	
60	async function resolveAssistantApp(header: unknown): Promise<AssistantAppResolution> {
61	  // Same header contract admit() has always applied: a string, a valid collection-name charset,
62	  // and NOT the reserved `usr.` shared-namespace prefix.
63	  if (
64	    typeof header !== 'string' ||
65	    !collectionName.safeParse(header).success ||
66	    header.startsWith(SHARED_SCOPE_PREFIX)
67	  ) {
68	    return { status: 'invalid-id' };
69	  }
70	  const app = await resolveApp(header);
71	  // The assistant plane needs a real artifact-backed owner (org to scope by, user to attribute).
72	  // A dev-serve / registry-only or unresolved id has none — the same 404 admit() gives.
73	  if (!app || !app.artifactBacked || !app.ownerUserId) return { status: 'not-found' };
74	  return { status: 'ok', app };
75	}
76	
77	/**
78	 * Can this verified caller EDIT this specific app? Detection MIRRORS the H1 follow-up-build gate
```

#### api/src/apps/app-paths.ts — loadWritable(function)

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

#### api/assets/featured-artifacts/legal-portal/scaffold/frontend/src/portal.js — whoami(function), calls(calls)

```javascript
112	 * Sessão de app (via a plataforma). Fina camada sobre window.__ekoa.
113	 * ------------------------------------------------------------------------- */
114	
115	export async function whoami() {
116	  const api = ekoa();
117	  if (!api || typeof api.whoami !== 'function') return null;
118	  try {
119	    return await api.whoami();
120	  } catch {
121	    return null;
122	  }
123	}
124	
125	export async function passwordSignIn(email, password) {
126	  const api = ekoa();
```

#### api/assets/bases/app/wiring/protocol-client.ts — whoami(function)

```typescript
1	/**
2	 * Protocol client for the `app` base.
3	 *
4	 * The typed surface over the platform's INJECTED served-app runtime
5	 * (`window.__ekoa`, stamped into every served document - see the served-app
6	 * byte-compat plane, api-contract 3.9). It wraps the sanctioned client calls:
7	 * end-user SSO identity (whoami / signIn / signOut), the visitor's Microsoft 365
8	 * Graph proxy (graphFetch), server-side PDF export (exportPdf), and workspace
9	 * cloud files (cloudFiles).
10	 *
11	 * Persistence is NOT here - use `./jsonStore` (the /api/app-data plane).
12	 *
13	 * There is NO client-side generic action envelope and NO direct integration
14	 * calls: an app never reaches an external API itself. Cross-service work is done
15	 * by platform-executed `integration.call` capabilities declared in MANIFEST.md;
16	 * the only in-app integration path is the authenticated visitor's own Microsoft
17	 * 365 via `graphFetch`.
18	 *
19	 * Every wrapper degrades cleanly when the runtime is absent (standalone preview,
20	 * file://, the screenshot pipeline): `whoami()` resolves `null`; the action
21	 * wrappers throw `RuntimeUnavailable`, which callers can catch to render a
22	 * fallback. The shell must render fully with no runtime present.
23	 */
24	
25	export interface WhoAmI {
26	  email: string;
27	  name: string | null;
28	  oid: string | null;
29	  tid: string | null;
30	  /** Whether the visitor granted the delegated Graph scopes (Mail.Send, Calendars). */
31	  canSendMail: boolean;
32	}
33	
34	export interface PdfExportOptions {
35	  filename?: string;
36	  format?: 'A4' | 'Letter' | 'Legal';
37	  landscape?: boolean;
38	  /** Explicit HTML to render; defaults to the live document (scripts/.no-print stripped). */
39	  html?: string;
40	  /** Set false to receive the result without triggering a browser download. */
41	  download?: boolean;
42	}
43	
44	export interface PdfExportResult {
45	  url: string;
46	  [key: string]: unknown;
47	}
48	
49	export interface CloudFileRef {
50	  id: string;
51	  name: string;
52	  [key: string]: unknown;
53	}
54	
55	export interface CloudFileDownload {
56	  name: string;
57	  type: string;
58	  blob: Blob;
59	}
60	
61	export interface CloudFilesClient {
62	  status(): Promise<unknown>;
63	  upload(file: Blob, opts: { provider?: string; name?: string; type?: string }): Promise<unknown>;
64	  list(provider: string, query?: string): Promise<CloudFileRef[]>;
65	  download(provider: string, id: string): Promise<CloudFileDownload>;
66	}
67	
68	/** The subset of the injected `window.__ekoa` surface this client wraps. */
69	export interface EkoaRuntime {
70	  fetch(path: string, options?: RequestInit): Promise<Response>;
71	  whoami(): Promise<WhoAmI | null>;
72	  signIn(returnPath?: string): void;
73	  signOut(): Promise<boolean>;
74	  graphFetch(path: string, options?: RequestInit): Promise<Response>;
75	  exportPdf(opts?: PdfExportOptions): Promise<PdfExportResult>;
76	  cloudFiles: CloudFilesClient;
77	}
78	
79	declare global {
80	  interface Window {
81	    __EKOA_APP_ID?: string;
82	    __ekoa?: EkoaRuntime;
83	  }
84	}
85	
86	/** Thrown by the action wrappers when the served-app runtime is not present. */
87	export class RuntimeUnavailable extends Error {
88	  readonly feature: string;
89	  constructor(feature: string) {
90	    super(`Ekoa runtime unavailable - ${feature} needs the served-app context (open at /apps/<id>/).`);
91	    this.name = 'RuntimeUnavailable';
92	    this.feature = feature;
93	  }
94	}
95	
96	/** The injected runtime, or undefined outside a served-app document. */
97	export function getRuntime(): EkoaRuntime | undefined {
98	  return typeof window !== 'undefined' ? window.__ekoa : undefined;
99	}
100	
101	function requireRuntime(feature: string): EkoaRuntime {
102	  const rt = getRuntime();
103	  if (!rt) throw new RuntimeUnavailable(feature);
104	  return rt;
105	}
106	
107	/**
108	 * The signed-in visitor, or null when logged out or the runtime is absent.
109	 * NON-THROWING - safe to call unconditionally on mount.
110	 */
111	export async function whoami(): Promise<WhoAmI | null> {
112	  const rt = getRuntime();
113	  if (!rt) return null;
114	  try {
115	    return await rt.whoami();
116	  } catch {
117	    return null;
118	  }
119	}
120	
121	/** Start the full-page Microsoft sign-in. Throws RuntimeUnavailable with no runtime. */
122	export function signIn(returnPath?: string): void {
123	  requireRuntime('signIn').signIn(returnPath);
124	}
125	
126	/** End the visitor session. Throws RuntimeUnavailable with no runtime. */
127	export function signOut(): Promise<boolean> {
128	  return requireRuntime('signOut').signOut();
129	}
130	
131	/**
132	 * Proxy a Microsoft Graph request AS THE VISITOR (their delegated SSO session).
133	 * `path` is relative to the Graph proxy root (e.g. `me`, `me/messages`).
134	 * Throws RuntimeUnavailable with no runtime; the caller catches to render an
135	 * IntegrationNeededBoundary when the visitor has not connected Microsoft 365.
136	 */
137	export function graphFetch(path: string, options?: RequestInit): Promise<Response> {
138	  return requireRuntime('graphFetch').graphFetch(path, options);
139	}
140	
141	/** Server-rendered PDF of the live document (or `opts.html`). Throws RuntimeUnavailable with no runtime. */
142	export function exportPdf(opts?: PdfExportOptions): Promise<PdfExportResult> {
143	  return requireRuntime('exportPdf').exportPdf(opts);
144	}
145	
146	/**
147	 * Workspace cloud files (Google Drive / OneDrive) for save-to-cloud flows.
148	 * Each method throws RuntimeUnavailable with no runtime.
149	 */
150	export const cloudFiles: CloudFilesClient = {
151	  status: () => requireRuntime('cloudFiles.status').cloudFiles.status(),
152	  upload: (file, opts) => requireRuntime('cloudFiles.upload').cloudFiles.upload(file, opts),
153	  list: (provider, query) => requireRuntime('cloudFiles.list').cloudFiles.list(provider, query),
154	  download: (provider, id) => requireRuntime('cloudFiles.download').cloudFiles.download(provider, id),
155	};
```

#### api/src/apps/app-assistant.ts — AppAssistantOwner(interface), AppAssistantInput(interface), AppAssistantOwner(references), AppActionManifest(references), AppAssistantDeps(interface), OneShotOptions(references), LlmAttribution(references), OneShotResult(references), GroundingInput(references), GroundingResult(references), +3 more

```typescript
34	import type { OneShotOptions, OneShotResult, LlmAttribution, RouterDecision } from '../llm/index.js';
35	import type { GroundingInput, GroundingResult } from '../knowledge/index.js';
36	
37	export interface AppAssistantOwner {
38	  /** The artifact owner — who the assistant runs as and who is billed. */
39	  userId: string;
40	  /** The owner's org — the ONLY org the assistant ever grounds under (server-resolved). */
41	  orgId: string;
42	}
43	
44	export interface AppAssistantInput {
45	  message: string;
46	  history?: AssistantChatMessage[];
47	  /** Client-pinned mode; when absent it is inferred from the message and echoed back. */
48	  mode?: AssistantChatMode;
49	  /** The panel's current screen state (route + prior action results). Never carries an org. */
50	  context?: { route?: string; actionResults?: unknown[] };
51	  owner: AppAssistantOwner;
52	  artifactId: string;
53	  /** The app's validated UI action manifest, or null for an app with no operate surface. */
54	  actionManifest: AppActionManifest | null;
55	}
56	
57	export interface AppAssistantDeps {
58	  /** The chokepoint one-shot (llm/ `runOneShot` in prod) — the assistant's ONLY model egress. */
59	  oneShot: (opts: OneShotOptions, attribution: LlmAttribution) => Promise<OneShotResult>;
60	  /** The org-partitioned knowledge grounding builder (`buildGroundingBlock` in prod). Pure. */
61	  ground: (input: GroundingInput) => GroundingResult;
62	  /** The routing decision for a message (`decideForTask` floored at WORKHORSE in prod). */
63	  decide: (message: string) => RouterDecision;
64	}
65	
66	export interface AppAssistantResult {
67	  reply: string;
68	  mode: AssistantChatMode;
69	  citations: AssistantCitation[];
70	  actions: AssistantAction[];
71	}
72	
73	/** Fold to a lowercase, accent-stripped form for keyword matching (matches grounding.ts's fold so
74	 *  PT-PT accents never hide a keyword). */
75	function fold(s: string): string {
76	  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
77	}
78	
79	/** Teach-mode cues (folded, accent-insensitive): the visitor wants to be taught / walked through. */
80	const TEACH_KEYWORDS = [
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I’ve confirmed the core semantic shift. The remaining risk surface is whether the new helper changed any route behavior indirectly: import graph, POST auth path, and the exact error behavior on token failures. I’m checking those now along with the targeted tests added in the fix.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,240p' api/src/routes/jobs.ts" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,260p' api/tests/apps/app-assistant.test.ts" in /Users/ggomes/dev/ekoa-code
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

 succeeded in 0ms:
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AppAction, AppActionManifest } from '@ekoa/shared';
import { AppAssistantWhoamiResponse } from '@ekoa/shared';
import type { SearchHit } from '../../src/knowledge/index.js';
import type { OneShotOptions, LlmAttribution, RouterDecision } from '../../src/llm/index.js';
import { assistantToolsFromManifest } from '../../src/apps/assistant-tools.js';
import {
  runAppAssistant,
  inferMode,
  extractActions,
  type AppAssistantDeps,
} from '../../src/apps/app-assistant.js';
import { appAssistantRouter, isAppEditor } from '../../src/apps/app-assistant-route.js';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, artifacts } from '../../src/data/stores.js';
import { setActivation, bumpTokenEpoch, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * operator-run D1 — the served-app assistant pure logic, over an INJECTED one-shot (no real model),
 * an injected grounding builder, and an injected routing decision. Asserts: mode inference; grounding
 * hits become citations; the ```ekoa-actions``` block is parsed, validated against the manifest, and
 * stripped from the reply; unknown tool names are dropped; and the grounding org comes from the
 * resolved OWNER, never a caller-supplied value.
 */

const manifest: AppActionManifest = {
  version: 1,
  actions: [
    { id: 'ir-clientes', kind: 'navigate', labelPt: 'Ver clientes', description: 'Abre a lista de clientes', route: '/clientes', params: [], destructive: false },
    {
      id: 'criar-cliente', kind: 'custom', labelPt: 'Criar cliente', description: 'Cria um novo cliente',
      params: [{ name: 'nome', type: 'string', required: true }], destructive: false,
    },
  ],
};

const DECISION: RouterDecision = { tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 };
const OWNER = { userId: 'owner-1', orgId: 'org-owner' };

/** The server-resolved manifest AppAction D1 attaches to each proposed action. */
const actionById = (id: string): AppAction => manifest.actions.find((a) => a.id === id)!;
/** toolName -> manifest AppAction, as runAppAssistant / extractActions consume it. */
const toolMap = new Map(assistantToolsFromManifest(manifest).map((t) => [t.name, t.action] as const));

interface Captured {
  opts?: OneShotOptions;
  attribution?: LlmAttribution;
  groundInput?: { orgId: string; query: string; kind: string };
}

/** Deps whose one-shot returns `oneShotText` verbatim and whose grounding returns `hits`. */
function makeDeps(oneShotText: string, hits: SearchHit[] = [], captured: Captured = {}): AppAssistantDeps {
  return {
    oneShot: async (opts, attribution) => {
      captured.opts = opts;
      captured.attribution = attribution;
      return { text: oneShotText, usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
    },
    ground: (input) => {
      captured.groundInput = input;
      return { block: hits.length ? 'CONHECIMENTO (excertos):\n[1] col / titulo (doc d1)' : '', hits };
    },
    decide: () => DECISION,
  };
}

function hit(over: Partial<SearchHit> = {}): SearchHit {
  return { docId: 'd1', collection: 'faq', title: 'Como criar cliente', snippet: 'passo 1...', score: 1, scope: 'org', ...over };
}

describe('inferMode (D1 deterministic PT-PT classifier)', () => {
  it('teach cues -> teach', () => {
    expect(inferMode('Faz um tutorial da aplicação')).toBe('teach');
    expect(inferMode('Explica como funciona o registo')).toBe('teach');
    expect(inferMode('Ensina-me a usar isto passo a passo')).toBe('teach');
  });
  it('show cues -> show (accent-insensitive)', () => {
    expect(inferMode('Mostra-me o painel')).toBe('show');
    expect(inferMode('Dá-me uma visão geral')).toBe('show');
    expect(inferMode('Faz um resumo geral')).toBe('show');
  });
  it('teach wins over show ("mostra-me como criar")', () => {
    expect(inferMode('Mostra-me como criar um cliente')).toBe('teach');
  });
  it('imperative task verbs and anything else default to do', () => {
    expect(inferMode('Cria um cliente chamado Ana')).toBe('do');
    expect(inferMode('Adiciona uma nota ao processo')).toBe('do');
    expect(inferMode('Olá')).toBe('do');
  });
});

describe('extractActions (D1 fenced-block parser)', () => {
  it('parses an actions block, attaches the resolved AppAction, and strips it from the prose', () => {
    const reply = [
      'Vou criar o cliente para si.',
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}}]',
      '```',
      'Feito.',
    ].join('\n');
    const { text, actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([
      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
    ]);
    expect(text).toContain('Vou criar o cliente');
    expect(text).toContain('Feito.');
    expect(text).not.toContain('ekoa-actions');
    expect(text).not.toContain('app_action__');
  });

  it('drops unknown tool names but keeps + resolves known ones', () => {
    const reply = [
      '```ekoa-actions',
      '[{"toolName":"app_action__inexistente","input":{}},{"toolName":"app_action__ir_clientes","input":{}}]',
      '```',
    ].join('\n');
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
  });

  it('drops UNDECLARED param keys from the model input (fenced path honours the tool schema)', () => {
    // codex-d2 #1: `custom` action params reach app code verbatim, so the fenced path
    // must enforce the same additionalProperties:false contract the SDK tool schema does.
    const reply = [
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana","__proto__x":"pwn","cmd":"rm -rf"}}]',
      '```',
    ].join('\n');
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.input).toEqual({ nome: 'Ana' }); // declared param kept, undeclared dropped
  });

  it('a malformed block yields no actions and is still stripped', () => {
    const reply = 'Olá\n```ekoa-actions\nnão é json\n```\ntchau';
    const { text, actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([]);
    expect(text).not.toContain('ekoa-actions');
    expect(text).toContain('Olá');
    expect(text).toContain('tchau');
  });

  it('non-object input defaults to {}', () => {
    const reply = '```ekoa-actions\n[{"toolName":"app_action__ir_clientes","input":"oops"}]\n```';
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
  });
});

describe('runAppAssistant (D1)', () => {
  it('infers the mode when not pinned and echoes it back', async () => {
    const deps = makeDeps('Aqui está uma visão geral.');
    const res = await runAppAssistant(
      { message: 'Mostra-me a aplicação', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.mode).toBe('show');
  });

  it('honours a client-pinned mode over inference', async () => {
    const deps = makeDeps('ok');
    const res = await runAppAssistant(
      { message: 'Mostra-me a aplicação', mode: 'do', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.mode).toBe('do');
  });

  it('turns grounding hits into citations (collection/docId/title)', async () => {
    const hits = [hit(), hit({ docId: 'd2', collection: 'guias', title: 'Guia', scope: 'shared' })];
    const deps = makeDeps('Resposta com fonte.', hits);
    const res = await runAppAssistant(
      { message: 'Como crio um cliente?', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.citations).toEqual([
      { collection: 'faq', docId: 'd1', title: 'Como criar cliente' },
      { collection: 'guias', docId: 'd2', title: 'Guia' },
    ]);
  });

  it('parses + validates the actions block and strips it from the reply', async () => {
    const oneShotText = [
      'Vou tratar disso.',
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}},{"toolName":"app_action__desconhecida","input":{}}]',
      '```',
    ].join('\n');
    const deps = makeDeps(oneShotText);
    const res = await runAppAssistant(
      { message: 'Cria a cliente Ana', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.actions).toEqual([
      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
    ]); // unknown dropped, resolved AppAction attached
    expect(res.reply).toBe('Vou tratar disso.');
    expect(res.reply).not.toContain('ekoa-actions');
  });

  it('an app with no manifest has no operate surface (all requested actions dropped)', async () => {
    const oneShotText = '```ekoa-actions\n[{"toolName":"app_action__criar_cliente","input":{}}]\n```texto';
    const deps = makeDeps(oneShotText);
    const res = await runAppAssistant(
      { message: 'Cria algo', owner: OWNER, artifactId: 'art-1', actionManifest: null },
      deps,
    );
    expect(res.actions).toEqual([]);
    expect(res.reply).toBe('texto');
  });

  it('grounds under the OWNER org and bills the OWNER — never a caller-supplied value', async () => {
    const captured: Captured = {};
    const deps = makeDeps('ok', [], captured);
    await runAppAssistant(
      {
        message: 'Olá',
        // A caller trying to steer the org via context must be ignored — the org comes from owner.
        context: { route: '/x', actionResults: [{ orgId: 'attacker-org' }] },
        owner: OWNER,
        artifactId: 'art-99',
        actionManifest: manifest,
      },
      deps,
    );
    expect(captured.groundInput).toEqual({ orgId: 'org-owner', query: 'Olá', kind: 'chat' });
    expect(captured.attribution).toEqual({
      kind: 'user_work',
      agentType: 'assistant-chat',
      billeeUserId: 'owner-1',
      artifactId: 'art-99',
    });
  });
});

/**
 * operator-run H2 — the admin-detection DECISION (`isAppEditor`), the PURE core of
 * `GET /api/app-assistant/whoami`. Detection MIRRORS the H1 follow-up-build edit gate exactly
 * (codex-h2): H1's `can('canEditApps')` capability gate AND the artifact-writability verdict
 * loadWritable produces (own always; org-shared within the org ok; another user's private / a
 * cross-org / missing artifact → not-ok). So `admin:true` ⟺ this caller can ACTUALLY edit this app
 * (no false offer, no owner-org membership oracle). The verdict is computed by loadWritable in the
 * route (exercised by the matrix below); this unit pins the pure combine.
 */
describe('isAppEditor (H2 detection decision — mirrors the H1 edit gate)', () => {
  it('an app-edit-capable caller with a WRITABLE artifact is an editor', () => {
    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'ok')).toBe(true);
    expect(isAppEditor({ role: 'super-admin', orgId: 'org-any' }, 'ok')).toBe(true);
  });
  it('a NOT-writable artifact (forbidden/notfound) is never editable, even for an admin (fail-closed: closes the empty-owner-org + oracle findings)', () => {
    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'forbidden')).toBe(false);
    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'notfound')).toBe(false);

exec
/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md && printf '\\n---\\n' && sed -n '1,260p' docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md" in /Users/ggomes/dev/ekoa-code
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
session id: 019f5d17-9488-7ac0-a381-3ce59d2e0397
--------
user
Adversarial SECURITY review in /Users/ggomes/dev/ekoa-code of commit 8b6116a (git show 8b6116a): slice H2 of a security block - a GET /api/app-assistant/whoami admin-DETECTION endpoint + panel detect-then-ask. The served-app assistant plane is deliberately visitor-blind (POST /api/app-assistant is header-scoped X-Ekoa-App-Id, never reads the caller JWT, grounds+bills the OWNER). whoami adds a detection-only exception: X-Ekoa-App-Id + OPTIONAL Bearer platform-JWT -> {admin:boolean} true iff the verified caller is org-admin/super-admin of the app OWNER's org AND can(caller,'canEditApps'); fail-closed 200 {admin:false} on ANY token failure (never 4xx = oracle); shares resolveAssistantApp with POST so it is no new existence oracle; never grounds/bills/widens admission. Panel reads localStorage ekoa_token defensively, calls whoami once, admin:true only lights an inert badge. Hunt for REAL security defects with file:line + attack scenario: (1) any token-failure path that is NOT 200 {admin:false} (throw->distinguishing 500, 401/403 leak); does an expired/revoked/epoch-stale token ever yield admin:true; is the verify chain the SAME as requireAuth (verifyToken+jti+isRevoked+activation+tokenEpoch) or weaker; (2) does whoami leak more than POST (app-id/owner-org enumeration; admin true/false as an org-membership oracle for an arbitrary app); (3) did the resolveAssistantApp refactor change POST's visitor-blind org/billee resolution AT ALL; (4) capability correctness - user-role admin-of-nothing gets false, super-admin cross-org right, org-admin strictly the OWNER org (not caller's own), ownerOrgId server-resolved never caller-supplied; (5) panel - localStorage read crashing mount, token logged/persisted/sent elsewhere, admin:true triggering any privileged call (detect-then-ask violation), badge XSS; (6) test honesty - real verify chain not a pass-through mock, asserts 200-not-4xx, contract validates the real schema. Read slices/H2/{impl-notes.md,decision-memo.md} + slices/H1/exploration-auth-surface.md. Read-only cmds OK (grep/git/tsc), no networked tests. Concise: a bullet per finding classified High/Medium/Low with file:line, then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `8b6116a` as a security audit. I’m first loading the project context files plus the referenced slice docs, then I’ll inspect the exact diff and trace the auth/assistant code paths against the stated invariants.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' slices/H2/impl-notes.md; printf '\\n---DECISION---\\n'; sed -n '1,220p' slices/H2/decision-memo.md; printf '\\n---H1---\\n'; sed -n '1,260p' slices/H1/exploration-auth-surface.md" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,220p' PRD.md; printf '\\n---PLANING---\\n'; sed -n '1,220p' PLANING.md; printf '\\n---TASKS---\\n'; sed -n '1,220p' TASKS.md" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
sed: PRD.md: No such file or directory

---PLANING---
sed: PLANING.md: No such file or directory

---TASKS---
sed: TASKS.md: No such file or directory

 exited 1 in 0ms:
sed: slices/H2/impl-notes.md: No such file or directory

---DECISION---
sed: slices/H2/decision-memo.md: No such file or directory

---H1---
sed: slices/H1/exploration-auth-surface.md: No such file or directory

exec
/bin/zsh -lc "pwd && ls -la && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'slices/**' | sort && test -d .codegraph && echo CODEGRAPH_PRESENT || echo CODEGRAPH_ABSENT && git show --stat --oneline 8b6116a" in /Users/ggomes/dev/ekoa-code
 succeeded in 109ms:
8b6116a feat(operator-run/h2): SECURITY - whoami admin-detection endpoint (identity handoff). GET /api/app-assistant/whoami returns {admin} true iff a verified platform JWT is org-admin/super-admin of the OWNER org AND canEditApps; fail-closed 200 {admin:false} on any token failure (never 4xx - no oracle), shares resolveAssistantApp with POST so it is no new existence oracle, never grounds/bills/widens admission; POST path byte-for-byte visitor-blind. Panel reads localStorage token defensively + calls whoami once + renders only a discreet inert admin badge (detect-then-ask; edit UX is H3). Diagram 10 updated
 api/assets/panel-runtime/src/AssistantPanel.jsx    | 100 +++++++++-
 api/src/apps/app-assistant-route.ts                | 128 +++++++++++--
 api/tests/apps/app-assistant.test.ts               | 210 ++++++++++++++++++++-
 api/tests/apps/assistant-panel.test.ts             |  67 +++++++
 api/tests/contract/app-assistant.contract.test.ts  |  33 ++++
 api/tests/contract/schema-coverage.test.ts         |   4 +
 .../slices/H2/impl-notes.md                        | 109 +++++++++++
 .../slices/H2/worker-status.txt                    |   3 +
 docs/diagrams/10-privacy-boundaries.excalidraw     |   8 +-
 shared/src/app-assistant.ts                        |  20 ++
 10 files changed, 664 insertions(+), 18 deletions(-)

codex
The root doesn’t contain the context files at the paths named in the instructions, so I’m locating them in-repo and then tracing the touched server, client, and test code from the commit against the existing auth stack.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files | rg '("'^|/)(PRD|PLANING|TASKS)'"\\.md"'$|slices/.*/(impl-notes|decision-memo|exploration-auth-surface)'"\\.md"'$|app-assistant-route'"\\.ts"'$|AssistantPanel'"\\.jsx"'$|app-assistant'"\\.test\\.ts"'$|assistant-panel'"\\.test\\.ts"'$|app-assistant'"\\.contract\\.test\\.ts"'$|schema-coverage'"\\.test\\.ts"'$|app-assistant'"\\.ts"'$'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/apps/app-assistant.ts
api/src/apps/app-assistant-route.ts
shared/src/app-assistant.ts
api/tests/apps/app-assistant.test.ts
api/tests/apps/assistant-panel.test.ts
api/tests/contract/schema-coverage.test.ts
api/tests/contract/app-assistant.contract.test.ts
api/assets/panel-runtime/src/AssistantPanel.jsx
docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C5/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/F2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/decision-memo.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/B2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/exploration-auth-surface.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D3/impl-notes.md

exec
/bin/zsh -lc 'git show --unified=80 8b6116a -- api/src/apps/app-assistant-route.ts api/assets/panel-runtime/src/AssistantPanel.jsx shared/src/app-assistant.ts api/tests/apps/app-assistant.test.ts api/tests/apps/assistant-panel.test.ts api/tests/contract/app-assistant.contract.test.ts api/tests/contract/schema-coverage.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-pJ1hDGcd' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-XMKoX6q0' (errno=Operation not permitted)
commit 8b6116a547ad649131c6916b8faf190938e00e72
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 20:58:35 2026 +0100

    feat(operator-run/h2): SECURITY - whoami admin-detection endpoint (identity handoff). GET /api/app-assistant/whoami returns {admin} true iff a verified platform JWT is org-admin/super-admin of the OWNER org AND canEditApps; fail-closed 200 {admin:false} on any token failure (never 4xx - no oracle), shares resolveAssistantApp with POST so it is no new existence oracle, never grounds/bills/widens admission; POST path byte-for-byte visitor-blind. Panel reads localStorage token defensively + calls whoami once + renders only a discreet inert admin badge (detect-then-ask; edit UX is H3). Diagram 10 updated

diff --git a/api/assets/panel-runtime/src/AssistantPanel.jsx b/api/assets/panel-runtime/src/AssistantPanel.jsx
index e2919b0..7b64084 100644
--- a/api/assets/panel-runtime/src/AssistantPanel.jsx
+++ b/api/assets/panel-runtime/src/AssistantPanel.jsx
@@ -1,144 +1,168 @@
 /*
  * Operator Assistant Panel - platform-shipped for the `app` base (operator-run D2;
  * lazy-loaded as a platform runtime asset since operator-run G2).
  *
  * The in-app assistant every generated app carries. It is compiled into the
  * platform panel-runtime asset (api/assets/panel-runtime) and mounts INTO the
  * shell's <div id="ekoa-assistant-root"> (see index.jsx, the asset entry) and
  * speaks ONLY two things:
  *
  *   1. POST /api/app-assistant (D1) - the served-app assistant endpoint. It carries
  *      the visitor's message, the running history, the pinned/echoed mode, the
  *      current screen context, and the X-Ekoa-App-Id header. The reply, its
  *      knowledge citations ("Fontes"), and the app-actions the assistant proposes
  *      come back on the response.
  *   2. window.__ekoaActions.execute(action) (C3 same-document runtime) - for EACH
  *      action the assistant proposes. The runtime owns the VISIBLE driving badge,
  *      the target highlight, the destructive confirmation card, and the
  *      pause-on-real-user-input; the panel only calls execute() and shows a subtle
  *      "a executar..." state until it resolves. The panel NEVER dispatches an
  *      action the assistant did not return.
  *
  * Three capabilities / three modes: OPERAR (do) operates the app, MOSTRAR (show)
  * gives an overview, ENSINAR (teach) walks through a tutorial. The server infers
  * the mode from the phrasing; the toggle lets the visitor pin it, and the server's
  * echoed response.mode is reflected back.
  *
  * The panel is PLATFORM code: brand-neutral via the CSS-var contract, PT-PT
  * throughout (lawyer-facing), no emoji, and non-blocking - it never steals focus
  * from the app and every failure renders a calm message instead of crashing.
  */
 import { useCallback, useEffect, useRef, useState } from 'react';
 import { createTourPlayer } from './tour-player';
 import './AssistantPanel.css';
 
 const ENDPOINT = '/api/app-assistant';
+// H2 admin DETECTION (detect-then-ask). A cheap, non-LLM GET that answers ONLY "is the current
+// viewer an admin of this app's owner org?". It NEVER issues an assistant turn (the zero-token
+// invariant holds) and its result NEVER auto-enables anything - it only lights a discreet
+// indicator. The edit-mode switch + its opt-in UX are H3; this panel does not build them.
+const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
+// The platform session token key web/lib/api/token.ts uses. Read best-effort for detection only:
+// a served app on the SAME origin as the dashboard can read it; a CROSS-origin / sandboxed iframe
+// (the dev preview) throws on access, so detection simply falls back to "not admin".
+const TOKEN_STORAGE_KEY = 'ekoa_token';
 // Bounds (codex-d2): the transcript kept in memory, the history slice sent per turn,
 // and a hard timeout on the assistant fetch so a hung turn can never lock the composer.
 const MAX_MESSAGES = 200;
 const MAX_HISTORY_TURNS = 16;
 const FETCH_TIMEOUT_MS = 120000;
 
 /** The three modes, in toggle order, with their PT-PT labels. */
 const MODES = [
   { id: 'do', label: 'Operar' },
   { id: 'show', label: 'Mostrar' },
   { id: 'teach', label: 'Ensinar' },
 ];
 
 /** The first-open capability prompts (PT-PT), one per capability. Clicking one
  *  pins its mode and drops the example into the composer. */
 const EXAMPLES = [
   { mode: 'do', kind: 'Operar', prompt: 'Adicione um novo registo' },
   { mode: 'show', kind: 'Mostrar', prompt: 'Dê-me uma visão geral da aplicação' },
   { mode: 'teach', kind: 'Ensinar', prompt: 'Mostre-me um tutorial' },
 ];
 
 const ERROR_REPLY = 'O assistente está indisponível de momento.';
 const MAX_ACTION_RESULTS = 8;
 
 /** The served-app id stamped by injectAppContext(); absent in a standalone preview. */
 function appId() {
   return typeof window !== 'undefined' && window.__EKOA_APP_ID ? window.__EKOA_APP_ID : undefined;
 }
 
+/** Best-effort read of the platform session token for admin DETECTION only (H2). Same-origin
+ *  served pages can read the dashboard's localStorage; a cross-origin or sandboxed iframe throws
+ *  a SecurityError on `localStorage` access - swallow it to null so detection just degrades to
+ *  "not admin" (no affordance) instead of crashing the panel. Reads nothing else and stores
+ *  nothing - the token is attached to the one whoami GET and never kept. */
+function readPlatformToken() {
+  try {
+    if (typeof window === 'undefined' || !window.localStorage) return null;
+    const t = window.localStorage.getItem(TOKEN_STORAGE_KEY);
+    return typeof t === 'string' && t ? t : null;
+  } catch {
+    return null;
+  }
+}
+
 /** The app's current route/page, best-effort: the shell may expose it on
  *  window.__ekoaApp; otherwise fall back to the location. Undefined when unknown. */
 function currentRoute() {
   if (typeof window === 'undefined') return undefined;
   const app = window.__ekoaApp;
   if (app && typeof app.route === 'string' && app.route) return app.route;
   if (app && typeof app.currentRoute === 'string' && app.currentRoute) return app.currentRoute;
   const loc = window.location;
   const r = (loc && (loc.hash || loc.pathname)) || '';
   return r ? String(r) : undefined;
 }
 
 /**
  * Map a proposed action to the manifest form window.__ekoaActions.execute expects
  * (kind/target/route/destructive/labelPt + a VALUES object on params). D1 sends
  * `{ toolName, input }`; when the response is enriched with the resolved manifest

---
# H2 impl-notes - identity/session handoff (whoami detection, detect-then-ask)

Slice H2 of the atomic security block. Built on H1 (commit 49dc5f6): the real `can()` capability
layer + the durable verify chain. DONE-GREEN.

## What was built

### 1. Shared contract (additive) - `shared/src/app-assistant.ts`
- `AppAssistantWhoamiResponse = z.object({ admin: z.boolean() }).strict()`. `.strict()` is
  load-bearing: the answer is a single boolean and NOTHING else - no identity/org/role/reason may
  ride the wire (fail-closed + oracle-free).
- Descriptor entry `appAssistantEndpoints.whoami` (`GET /api/app-assistant/whoami`, `header-scoped`,
  response-only). Additive - `assistantChat` is untouched.

### 2. Detection endpoint - `api/src/apps/app-assistant-route.ts`
- New `GET /app-assistant/whoami` on the existing router, a sibling of `POST /app-assistant`.
- Refactor: the app-id charset/collision check + `resolveApp` + artifact-backed-owner check were
  factored out of `admit()` into a shared `resolveAssistantApp(header)` (a discriminated
  `invalid-id | not-found | ok`). BOTH the POST admission and whoami now go through it, so they
  apply the EXACT same 400 (`VALIDATION_FAILED`, incl. the reserved `usr.` prefix) and 404
  (`NOT_FOUND`) - whoami is provably not a different existence oracle than POST already is.
- Identity: `detectOwnerOrgAdmin(authHeader, ownerOrgId)` extracts the OPTIONAL `Bearer` (same
  regex idiom as `requireAuth`) and verifies it through `verifySseToken` - the EXACT chain
  requireAuth/verifySseToken run (`verifyToken` + `jti` + `isRevoked` + activation-active +
  `tokenEpoch`). No hand-rolled weaker check, no second identity path, no per-app login.
- Decision: pure exported `isOwnerOrgAdmin(claims, ownerOrgId)` - gated by H1's
  `can(claims, 'canEditApps')` (so a `user` role stops at the capability gate), then super-admin
  spans any org and org-admin must match the owner org. Owner org is resolved server-side from the
  owner user record (`users.get`), never from anything the caller supplied.
- The ONLY non-200s are the two app-id header failures above. A missing/invalid/expired/revoked/
  epoch-stale/wrong-org/user token is ALWAYS `200 { admin: false }`. A whoami internal error (store
  blow-up) is a 500, never a 4xx (a 4xx would be an oracle).
- It NEVER grounds, bills, routes, or widens admission: it does not mount the allowance middleware
  and never touches the injected llm deps. `POST /app-assistant` is byte-for-byte unchanged - still
  header-scoped, still never reads the caller JWT for grounding/billing.

### 3. Panel detection - `api/assets/panel-runtime/src/AssistantPanel.jsx`
- `readPlatformToken()` reads `localStorage['ekoa_token']` (the key `web/lib/api/token.ts` uses)
  inside try/catch, swallowing the cross-origin/sandboxed-iframe `SecurityError` to `null`.
- A mount-only, once-guarded (`whoamiDoneRef`) effect calls `GET whoami` ONCE with `X-Ekoa-App-Id`
  and the token as an OPTIONAL `Bearer`, and stores `admin` (default false) in state. It is a cheap
  non-LLM GET - it never issues an assistant turn (zero-token invariant holds).
- DETECT-THEN-ASK: `admin: true` NEVER auto-enables anything. The only surface is a DISCREET,
  inert "Administrador" badge in the header (no onClick, no mode change, no privileged call),
  gated on `admin` so a false result renders nothing. `admin` is SET once (detection) and READ only
  to render the badge. The edit-mode switch + opt-in UX are H3 - not built here. (The badge is
  styled inline via the panel's CSS vars so it needs no edit to the non-reserved AssistantPanel.css.)

## whoami fail-closed matrix (asserted in `tests/apps/app-assistant.test.ts`)

| caller                                   | result            |
|------------------------------------------|-------------------|
| org-admin of the OWNER org               | 200 { admin:true} |
| the artifact owner (org-admin, owner org)| 200 { admin:true} |
| super-admin (any org)                    | 200 { admin:true} |
| org-admin of ANOTHER org                 | 200 { admin:false}|
| plain user of the owner org              | 200 { admin:false}|
| NO token                                 | 200 { admin:false}|
| INVALID token                            | 200 { admin:false}|
| EXPIRED token (would-be admin)           | 200 { admin:false}|
| EPOCH-STALE token (would-be admin)       | 200 { admin:false}|
| malformed X-Ekoa-App-Id                  | 400 (same as POST)|
| reserved `usr.` prefix app-id            | 400               |
| unknown app id                           | 404 NOT_FOUND     |

Route matrix runs over the REAL router (wired with THROWING llm deps - so any accidental
ground/route/bill blows the request up; none does, every case is 200/400/404), the REAL verify
chain (real `login`-minted tokens, in-memory activation, `bumpTokenEpoch` for the stale case,
a directly-signed past-exp token for the expired case) and REAL owner resolution over
mongodb-memory-server. Plus a fast pure `isOwnerOrgAdmin` grid (no I/O).

## Visitor-blindness exception justification

The served-app assistant plane is visitor-blind: `POST /app-assistant` derives org + billee ONLY
from the server-resolved OWNER, never from the anonymous visitor's JWT. whoami is a DECLARED,
DOCUMENTED exception to that blindness, for DETECTION ONLY: it is the one place the plane reads the
caller's platform JWT, and it does so solely to answer "is this viewer an admin of the owner org?".
It never grounds, never bills, never widens admission, and issues no model call. Every privileged
action remains gated server-side by the H1 admission plane with this same JWT; `admin: true` is a
HINT the panel surfaces, not a grant. Exposure honesty (per the decision memo): any same-origin
page can already read `localStorage['ekoa_token']`, so the panel reading it in-page widens nothing;
the mitigations are the pre-existing epoch/revocation machinery + H1 server-side gating. Recorded
so H6's codex pass sees it stated.

## Reserved-path compliance

All changes are within the reserved set EXCEPT two necessary, flagged touches:
- `api/tests/contract/schema-coverage.test.ts`: adding the `whoami` descriptor grows
  `allEndpointsFlat()` by one, and this gate is DESIGNED to fail unless the endpoint is accounted
  for. Added `'appAssistant.whoami'` to COVERED (keeps `EXPECTED_PENDING_COUNT` at 49 -
  `assistantChat` stays PENDING exactly as before). Flagged to the lead before editing.
- FIXED-12 diagram flag (NOT edited - out of reserved set, shared file): the whoami detection
  exception affects `docs/diagrams/10-privacy-boundaries.excalidraw` node `d1-text` (which states
  the assistant plane derives org/billee "NEVER from the anonymous visitor"). A one-line note that
  `GET .../whoami` is a detection-only exception (reads the JWT, never grounds/bills/widens) should
  be added there. Flagged to the lead with the exact node + proposed text rather than hand-editing
  a shared .excalidraw.

No commits, no stack ops - working tree only.

## Verification (all green, locally)

- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0
- `npx tsc --noEmit -p tsconfig.test.json` -> 0
- `npx tsc --noEmit -p shared/tsconfig.json` -> 0; `web` tsc -> 0 (additive shared change)
- eslint touched .ts files -> 0 errors, 0 warnings
- `npx vitest run tests/apps tests/contract` -> 56 files, 536 tests, all pass
- `node assets/panel-runtime/build.mjs` -> built (panel compiles)
- repo root `npm run gate:chokepoint` -> clean

## Codex-fix round (2026-07-13) — mirror the H1 edit gate exactly

Codex H2 review returned NEEDS-WORK with a Medium + a Low; the fresh review returned APPROVE.
Both codex findings are closed by ONE principled change: whoami's `admin` is now defined as
"can this caller EDIT this app", computed by the SAME rule the H1 follow-up-build gate uses -
`can(caller,'canEditApps')` AND `loadWritable(caller, appId).verdict === 'ok'` - instead of the
weaker "admin of the owner org" (role + org).

- **Medium (fail-closed on a missing/empty owner org): CLOSED.** An orphaned/corrupt or cross-org
  artifact is never writable (loadWritable → notfound), so `admin:false` even for a super-admin.
  There is no `ownerOrgId ?? ''` path that a super-admin can satisfy anymore.
- **Low (org-admin owner-org membership oracle): CLOSED.** `admin:true` now fires ONLY for apps
  loadWritable already grants the caller - their OWN apps + ORG-SHARED apps in their org - which are
  exactly the apps they already enumerate via `GET /artifacts` (listVisible). A same-org OTHER
  member's PRIVATE draft reads not-writable → `admin:false`, so whoami is not an existence oracle
  for in-org private apps. A cross-org app → notfound → false. No new information over listArtifacts.
- **Bonus (no false offer): CLOSED.** `admin:true` ⟺ H3's edit mode / the follow-up build will
  ACTUALLY succeed for this caller on this app. The panel never surfaces an edit the H1 gate would
  then refuse. Previously an org-admin of the owner org (or a super-admin of another org) could get
  `admin:true` yet be 404'd by the follow-up gate.

Semantics note (flagged for the operator / H5): app-edit authority is ORG-SCOPED (H1's loadWritable)
- an org-admin edits their OWN + ORG-SHARED apps in their org; a super-admin edits apps in their own
org, NOT cross-org. This is the coherent reading of "org-admin edits apps" = the org's shared apps;
private drafts stay with their owner. If platform-wide cross-org app editing is ever desired, that is
a deliberate policy change to loadWritable / the H1 gate AND this detection together - never a silent
divergence. `isOwnerOrgAdmin` was replaced by `isAppEditor(claims, writableVerdict)`; the route now
calls `detectAppEditor(authHeader, appId)` → verify chain → loadWritable. Tests updated: the unit
`isAppEditor` grid (capability × verdict) + the route matrix now seeds an ORG-SHARED app (own-org
admins/super-admin true) AND a PRIVATE draft (only the owner true; a same-org admin false - the
oracle-closure case). 47 whoami+contract tests green; full lane re-run by the lead.

codex
The slice notes explicitly claim the two fixes and also document the org-scoped edit policy. I’m checking the current test matrix and the import graph now to make sure the implementation matches that note and didn’t quietly introduce a dependency cycle or a changed POST path.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'rg -n "isAppEditor|whoami|admin:false|admin:true|loadWritable|private|org-shared|super-admin|same-org" api/tests/apps/app-assistant.test.ts api/tests/contract/app-assistant.contract.test.ts api/tests/apps/assistant-panel.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/tests/apps/assistant-panel.test.ts:129:  it('calls GET /api/app-assistant/whoami exactly ONCE, on mount, with X-Ekoa-App-Id + an OPTIONAL Bearer', () => {
api/tests/apps/assistant-panel.test.ts:131:    expect(PANEL).toContain('/api/app-assistant/whoami');
api/tests/apps/assistant-panel.test.ts:132:    expect((PANEL.match(/\/api\/app-assistant\/whoami/g) || []).length).toBe(1);
api/tests/apps/assistant-panel.test.ts:135:    expect(PANEL).toContain('whoamiDoneRef');
api/tests/apps/assistant-panel.test.ts:136:    expect(PANEL).toContain('whoamiDoneRef.current = true');
api/tests/apps/assistant-panel.test.ts:158:  it('DETECT-THEN-ASK: admin:true never auto-enables anything (no edit mode, no privileged call)', () => {
api/tests/apps/assistant-panel.test.ts:173:  it('detection is zero-token: whoami is a non-LLM GET, never an assistant turn', () => {
api/tests/contract/app-assistant.contract.test.ts:103:  it('validates BOTH branches: { admin:true } and { admin:false }', () => {
api/tests/contract/app-assistant.contract.test.ts:119:describe('appAssistant whoami descriptor (H2)', () => {
api/tests/contract/app-assistant.contract.test.ts:121:    const d = appAssistantEndpoints.whoami;
api/tests/contract/app-assistant.contract.test.ts:123:    expect(d.path).toBe('/api/app-assistant/whoami');
api/tests/contract/app-assistant.contract.test.ts:130:    expect(ALL_ENDPOINTS.appAssistant?.whoami).toBeTruthy();
api/tests/apps/app-assistant.test.ts:16:import { appAssistantRouter, isAppEditor } from '../../src/apps/app-assistant-route.js';
api/tests/apps/app-assistant.test.ts:245: * operator-run H2 — the admin-detection DECISION (`isAppEditor`), the PURE core of
api/tests/apps/app-assistant.test.ts:246: * `GET /api/app-assistant/whoami`. Detection MIRRORS the H1 follow-up-build edit gate exactly
api/tests/apps/app-assistant.test.ts:248: * loadWritable produces (own always; org-shared within the org ok; another user's private / a
api/tests/apps/app-assistant.test.ts:249: * cross-org / missing artifact → not-ok). So `admin:true` ⟺ this caller can ACTUALLY edit this app
api/tests/apps/app-assistant.test.ts:250: * (no false offer, no owner-org membership oracle). The verdict is computed by loadWritable in the
api/tests/apps/app-assistant.test.ts:253:describe('isAppEditor (H2 detection decision — mirrors the H1 edit gate)', () => {
api/tests/apps/app-assistant.test.ts:255:    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'ok')).toBe(true);
api/tests/apps/app-assistant.test.ts:256:    expect(isAppEditor({ role: 'super-admin', orgId: 'org-any' }, 'ok')).toBe(true);
api/tests/apps/app-assistant.test.ts:259:    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'forbidden')).toBe(false);
api/tests/apps/app-assistant.test.ts:260:    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'notfound')).toBe(false);
api/tests/apps/app-assistant.test.ts:261:    expect(isAppEditor({ role: 'super-admin', orgId: 'org-any' }, 'notfound')).toBe(false);
api/tests/apps/app-assistant.test.ts:264:    expect(isAppEditor({ role: 'user', orgId: 'org-owner' }, 'ok')).toBe(false);
api/tests/apps/app-assistant.test.ts:269: * operator-run H2 — the `GET /api/app-assistant/whoami` FAIL-CLOSED matrix over the REAL router,
api/tests/apps/app-assistant.test.ts:271: * verifySseToken) and REAL owner resolution. The router is wired with THROWING llm deps: whoami
api/tests/apps/app-assistant.test.ts:274: *   - admin:true ONLY for an org-admin/super-admin of the OWNER org WITH canEditApps.
api/tests/apps/app-assistant.test.ts:275: *   - EVERYTHING else -> 200 { admin:false }: no token, invalid, expired, epoch-stale, user role,
api/tests/apps/app-assistant.test.ts:279:describe('GET /api/app-assistant/whoami (H2 fail-closed detection)', () => {
api/tests/apps/app-assistant.test.ts:286:  // whoami must NEVER reach these — it neither grounds, routes, nor bills.
api/tests/apps/app-assistant.test.ts:288:    oneShot: async () => { throw new Error('whoami must not call the model (visitor-blindness exception is detection-only)'); },
api/tests/apps/app-assistant.test.ts:289:    ground: () => { throw new Error('whoami must not ground'); },
api/tests/apps/app-assistant.test.ts:290:    decide: () => { throw new Error('whoami must not route'); },
api/tests/apps/app-assistant.test.ts:297:  async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
api/tests/apps/app-assistant.test.ts:301:  const whoami = (headers: Record<string, string>) =>
api/tests/apps/app-assistant.test.ts:302:    fetch(`http://127.0.0.1:${port}/api/app-assistant/whoami`, { headers });
api/tests/apps/app-assistant.test.ts:318:    await connectMongo(mem.getUri(), 'ekoa_h2_whoami');
api/tests/apps/app-assistant.test.ts:321:    // app that org-admins manage; loadWritable grants own-org admins write on it. PRIV_ID is a
api/tests/apps/app-assistant.test.ts:322:    // PRIVATE draft of the same owner - only the owner can edit it (loadWritable forbids even a
api/tests/apps/app-assistant.test.ts:323:    // same-org admin), which proves detection mirrors the H1 gate and is not an existence oracle.
api/tests/apps/app-assistant.test.ts:326:    await artifacts.insert({ _id: PRIV_ID, name: 'H2priv', userId: 'owner-1', orgId: 'org-owner', visibility: 'private' } as never);
api/tests/apps/app-assistant.test.ts:330:    await mkUser('super-1', 'org-other', 'super-admin'); // super-admin in a DIFFERENT org (org-scoped edit → not this app)
api/tests/apps/app-assistant.test.ts:331:    await mkUser('super-owner', 'org-owner', 'super-admin'); // super-admin IN the owner org
api/tests/apps/app-assistant.test.ts:360:  it('an org-admin of the OWNER org, on the ORG-SHARED app -> 200 { admin:true } (loadWritable ok)', async () => {
api/tests/apps/app-assistant.test.ts:361:    const res = await whoami(bearer('admin-owner'));
api/tests/apps/app-assistant.test.ts:368:  it('the artifact owner -> 200 { admin:true } (own artifact, any visibility)', async () => {
api/tests/apps/app-assistant.test.ts:369:    expect(await (await whoami(bearer('owner-1'))).json()).toEqual({ admin: true }); // org-shared
api/tests/apps/app-assistant.test.ts:370:    expect(await (await whoami(bearer('owner-1', PRIV_ID))).json()).toEqual({ admin: true }); // own private draft
api/tests/apps/app-assistant.test.ts:373:  it('a super-admin IN the owner org, on the org-shared app -> 200 { admin:true }', async () => {
api/tests/apps/app-assistant.test.ts:374:    const res = await whoami(bearer('super-owner'));
api/tests/apps/app-assistant.test.ts:379:  it('a super-admin in ANOTHER org -> 200 { admin:false } (app-edit is org-scoped, mirrors the H1 gate; cross-org loadWritable is notfound)', async () => {
api/tests/apps/app-assistant.test.ts:380:    const res = await whoami(bearer('super-1'));
api/tests/apps/app-assistant.test.ts:385:  it('an org-admin of the owner org, on another member PRIVATE draft -> 200 { admin:false } (loadWritable forbids; closes the in-org private-app existence oracle)', async () => {
api/tests/apps/app-assistant.test.ts:386:    const res = await whoami(bearer('admin-owner', PRIV_ID));
api/tests/apps/app-assistant.test.ts:391:  it('an org-admin of ANOTHER org -> 200 { admin:false } (never 403 — no cross-org oracle)', async () => {
api/tests/apps/app-assistant.test.ts:392:    const res = await whoami(bearer('admin-other'));
api/tests/apps/app-assistant.test.ts:397:  it('a plain user of the owner org -> 200 { admin:false } (H1 capability gate)', async () => {
api/tests/apps/app-assistant.test.ts:398:    const res = await whoami(bearer('user-owner'));
api/tests/apps/app-assistant.test.ts:403:  it('NO token -> 200 { admin:false } (never a 401 — token absence is not an oracle)', async () => {
api/tests/apps/app-assistant.test.ts:404:    const res = await whoami({ 'x-ekoa-app-id': APP_ID });
api/tests/apps/app-assistant.test.ts:409:  it('an INVALID token -> 200 { admin:false } (never a 401)', async () => {
api/tests/apps/app-assistant.test.ts:410:    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
api/tests/apps/app-assistant.test.ts:415:  it('an EXPIRED token (would-be admin) -> 200 { admin:false }', async () => {
api/tests/apps/app-assistant.test.ts:423:    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${expired}` });
api/tests/apps/app-assistant.test.ts:428:  it('an EPOCH-STALE token (would-be admin) -> 200 { admin:false }', async () => {
api/tests/apps/app-assistant.test.ts:431:    const res = await whoami(bearer('stale-admin'));
api/tests/apps/app-assistant.test.ts:438:    const wRes = await whoami(bad);
api/tests/apps/app-assistant.test.ts:447:    const res = await whoami({ 'x-ekoa-app-id': 'usr.owner-1', authorization: `Bearer ${tokens['admin-owner']}` });
api/tests/apps/app-assistant.test.ts:452:    const res = await whoami({ 'x-ekoa-app-id': 'no-such-app', authorization: `Bearer ${tokens['admin-owner']}` });

exec
/bin/zsh -lc "rg -n \"app-assistant-route|app-paths|loadWritable|verifySseToken|whoami|ekoa_token|Administrador|admin\" api/src api/assets/panel-runtime/src shared/src | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
shared/src/credentials.ts:3: * model credential can be set by a super-admin but never read back — no GET descriptor
shared/src/credentials.ts:51:    auth: 'super-admin',
shared/src/billing.ts:1:/** Billing domain contract (ch03 §3.8.21): usage, history, credits, overage, and platform admin. */
shared/src/billing.ts:34:    // Identity + gauge surface the admin usage pages render (left-joined from the
shared/src/billing.ts:118:    auth: 'super-admin',
shared/src/billing.ts:135:  adminGlobalOverage: {
shared/src/billing.ts:137:    path: '/api/v1/billing/admin/overage',
shared/src/billing.ts:138:    auth: 'super-admin',
shared/src/billing.ts:142:  adminListUsage: {
shared/src/billing.ts:144:    path: '/api/v1/billing/admin/usage',
shared/src/billing.ts:145:    auth: 'super-admin',
shared/src/billing.ts:148:  adminResetUsage: {
shared/src/billing.ts:150:    path: '/api/v1/billing/admin/usage/:userId/reset',
shared/src/billing.ts:151:    auth: 'super-admin',
shared/src/billing.ts:154:  adminSetLimit: {
shared/src/billing.ts:156:    path: '/api/v1/billing/admin/limits/:userId',
shared/src/billing.ts:157:    auth: 'super-admin',
shared/src/org.ts:214:    auth: 'org-admin',
shared/src/org.ts:221:    auth: 'org-admin',
shared/src/org.ts:228:    auth: 'org-admin',
shared/src/org.ts:235:    auth: 'super-admin',
shared/src/org.ts:242:    auth: 'super-admin',
shared/src/org.ts:248:    auth: 'super-admin',
shared/src/org.ts:255:    auth: 'org-admin',
shared/src/org.ts:261:    auth: 'org-admin',
shared/src/org.ts:268:    auth: 'org-admin',
shared/src/contract.test.ts:147:  it('no auth cell carries a bare "admin" class (ch03 acceptance 11)', () => {
shared/src/contract.test.ts:149:      expect(['public', 'user', 'org-admin', 'super-admin', 'token-query', 'hmac', 'header-scoped', 'optional-jwt', 'app-id-gated', 'bridge']).toContain(e.auth);
shared/src/descriptor.ts:11:  | 'org-admin'
shared/src/descriptor.ts:12:  | 'super-admin'
api/src/billing/service.ts:5: * history) and the account/admin mutations (credits, overage, per-user limits + reset).
api/src/billing/service.ts:96: * GET /billing/breakdown (§3.8.21, super-admin): group the ledger by `agentType` (§6.3 rule 4).
api/src/billing/service.ts:97: * Platform-wide across all billees, matching the super-admin usage page the endpoint mounts on.
api/src/billing/service.ts:132:/** PUT /billing/admin/overage: the admin global overage kill-switch (§6.6.2). */
api/src/billing/service.ts:139: * GET /billing/admin/usage: per-user rows (§6.6.2). Reset-aware display (does not persist).
api/src/billing/service.ts:141: * still appear zeroed; carries the identity + gauge fields the admin pages render.
api/src/billing/service.ts:143:export async function adminListUsage(now: number = Date.now()) {
api/src/billing/service.ts:170:/** POST /billing/admin/usage/:userId/reset: zero the meter + advance the period (§6.6.2). */
api/src/billing/service.ts:171:export async function adminResetUsage(userId: string, now: number = Date.now()) {
api/src/billing/service.ts:181:/** PUT /billing/admin/limits/:userId: set (or clear → null = platform default) the base (§6.6.2). */
api/src/billing/service.ts:182:export async function adminSetLimit(userId: string, tokenLimit: number | null, now: number = Date.now()) {
shared/src/platform-integrations.ts:52:    auth: 'org-admin',
shared/src/platform-integrations.ts:58:    auth: 'org-admin',
api/assets/panel-runtime/src/AssistantPanel.jsx:36:// H2 admin DETECTION (detect-then-ask). A cheap, non-LLM GET that answers ONLY "is the current
api/assets/panel-runtime/src/AssistantPanel.jsx:37:// viewer an admin of this app's owner org?". It NEVER issues an assistant turn (the zero-token
api/assets/panel-runtime/src/AssistantPanel.jsx:40:const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
api/assets/panel-runtime/src/AssistantPanel.jsx:43:// (the dev preview) throws on access, so detection simply falls back to "not admin".
api/assets/panel-runtime/src/AssistantPanel.jsx:44:const TOKEN_STORAGE_KEY = 'ekoa_token';
api/assets/panel-runtime/src/AssistantPanel.jsx:74:/** Best-effort read of the platform session token for admin DETECTION only (H2). Same-origin
api/assets/panel-runtime/src/AssistantPanel.jsx:77: *  "not admin" (no affordance) instead of crashing the panel. Reads nothing else and stores
api/assets/panel-runtime/src/AssistantPanel.jsx:78: *  nothing - the token is attached to the one whoami GET and never kept. */
api/assets/panel-runtime/src/AssistantPanel.jsx:258:  // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
api/assets/panel-runtime/src/AssistantPanel.jsx:262:  const [admin, setAdmin] = useState(false);
api/assets/panel-runtime/src/AssistantPanel.jsx:270:  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)
api/assets/panel-runtime/src/AssistantPanel.jsx:287:  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
api/assets/panel-runtime/src/AssistantPanel.jsx:288:  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
api/assets/panel-runtime/src/AssistantPanel.jsx:298:    if (!id || whoamiDoneRef.current) return;
api/assets/panel-runtime/src/AssistantPanel.jsx:299:    whoamiDoneRef.current = true;
api/assets/panel-runtime/src/AssistantPanel.jsx:311:            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
api/assets/panel-runtime/src/AssistantPanel.jsx:315:        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
api/assets/panel-runtime/src/AssistantPanel.jsx:317:        setAdmin(!!(data && data.admin === true));
api/assets/panel-runtime/src/AssistantPanel.jsx:319:        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
api/assets/panel-runtime/src/AssistantPanel.jsx:566:          {/* H2 detect-then-ask: a DISCREET, non-intrusive indicator that an admin capability
api/assets/panel-runtime/src/AssistantPanel.jsx:570:          {admin ? (
api/assets/panel-runtime/src/AssistantPanel.jsx:572:              className="ekoa-assistant-admin-badge"
api/assets/panel-runtime/src/AssistantPanel.jsx:573:              data-admin="true"
api/assets/panel-runtime/src/AssistantPanel.jsx:574:              title="Tem permissões de administrador nesta aplicação."
api/assets/panel-runtime/src/AssistantPanel.jsx:587:              Administrador
shared/src/users.ts:33:    auth: 'org-admin',
shared/src/users.ts:39:    auth: 'super-admin',
shared/src/users.ts:46:    auth: 'org-admin',
shared/src/users.ts:53:    auth: 'super-admin',
shared/src/users.ts:59:    auth: 'super-admin',
shared/src/app-assistant.ts:88: *  The panel asks `GET /api/app-assistant/whoami` (X-Ekoa-App-Id + an OPTIONAL platform Bearer)
shared/src/app-assistant.ts:89: *  whether the current viewer is an admin of the app OWNER's org WITH the `canEditApps` capability.
shared/src/app-assistant.ts:92: *  `admin: true` is a capability HINT only; every privileged action stays gated server-side by the
shared/src/app-assistant.ts:94:export const AppAssistantWhoamiResponse = z.object({ admin: z.boolean() }).strict();
shared/src/app-assistant.ts:105:  // H2 admin detection. Header-scoped like its sibling (X-Ekoa-App-Id resolves the app); the
shared/src/app-assistant.ts:107:  // oracle (a missing/invalid token is always a 200 { admin: false }, never a 401/403).
shared/src/app-assistant.ts:108:  whoami: {
shared/src/app-assistant.ts:110:    path: '/api/app-assistant/whoami',
shared/src/pipedream.ts:65:    auth: 'org-admin',
shared/src/pipedream.ts:72:    auth: 'org-admin',
shared/src/registo.ts:46:    auth: 'org-admin',
shared/src/jobs.ts:31:  // exclusively via POST /branding/research (§3.8.4, org-admin) and merely reuse the
shared/src/auth.ts:140:    // `user` first). The `{ userId }` admin variant requires elevation — super-admin
shared/src/auth.ts:141:    // anywhere, org-admin scoped to its own org — which the G2 handler MUST enforce
shared/src/auth.ts:142:    // (a static auth class cannot express "user for self, admin for others").
api/src/routes/branding.ts:23:  r.put('/', requireRole('org-admin', 'super-admin'), saveBrandingHandler);
api/src/routes/branding.ts:25:  r.post('/research', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/billing/index.ts:4: * and the derived REST views + admin ops (service). `llm/` consumes `recordTokenEvent`,
api/src/billing/index.ts:40:  adminListUsage,
api/src/billing/index.ts:41:  adminResetUsage,
api/src/billing/index.ts:42:  adminSetLimit,
api/src/routes/chat.ts:9:import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
api/src/routes/chat.ts:21:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/chat.ts:42:      return sendError(res, 'FORBIDDEN', 'Não tem permissão para usar o assistente; pode pedir ao administrador da organização.', { capability: 'canUseChat' });
api/src/routes/chat.ts:63:    if (!entry || (entry.ownerUserId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
api/src/routes/pipedream.ts:7: *   PUT    /pipedream/config          configure       (org-admin) -> { id, configured }
api/src/routes/pipedream.ts:8: *   DELETE /pipedream/config          remove-config   (org-admin) -> { ok }
api/src/routes/pipedream.ts:55:  r.put('/config', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/pipedream.ts:61:  r.delete('/config', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/automations.ts:19:import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
api/src/routes/automations.ts:73:  // Visibility = the run's owner or an org admin (the service's canSeeRun via getRunRecord).
api/src/routes/automations.ts:75:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/automations.ts:159:    // Creation is org-admin-only by default; the flippable org setting enables builder authoring.
shared/src/automations.ts:251:    auth: 'org-admin',
api/src/billing/tracker.ts:18: * Injected in tests; the default resolves + caches the founder super-admin id from the users
api/src/billing/tracker.ts:19: * store. Returns '' only when no super-admin exists (pre-seed) - the write still lands, on ''.
api/src/billing/tracker.ts:24:  const admins = await users.find({ role: 'super-admin' });
api/src/billing/tracker.ts:25:  cachedPlatformBillee = admins[0]?._id ?? '';
api/src/billing/tracker.ts:35:/** Public accessor for the platform-admin billee id, used by the chokepoint to key the rate
api/src/billing/tracker.ts:36: *  cap for platform / gateway-key traffic (empty user billee) against the admin account. */
api/src/billing/tracker.ts:155:/** The admin global overage kill-switch (§6.6.2), stored on the platform `settings` singleton
api/src/billing/tracker.ts:167:/** Write the admin global overage kill-switch onto the platform settings singleton. */
api/src/billing/tracker.ts:185:  // Platform / gateway-key usage (empty billee) ledgers against the platform admin, never ''
api/src/routes/auth.ts:48:  // F1: logout. Self: revoke the CALLER's jti. Admin variant { userId }: super-admin anywhere,
api/src/routes/auth.ts:49:  // org-admin scoped to its own org — enforced in the service (the static auth class cannot
api/src/routes/auth.ts:50:  // express "user for self, admin for others"; shared/src/auth.ts logout note).
shared/src/common.ts:33: *  — the builder persona is retired, `user` is the base non-admin role). */
shared/src/common.ts:34:export const Role = z.enum(['super-admin', 'org-admin', 'user']);
shared/src/artifacts.ts:266:    auth: 'super-admin',
api/src/billing/constants.ts:93:  'Limite de utilização atingido. Fale com o administrador ou aguarde o início do próximo período.';
api/src/routes/users.ts:3: * super-admin platform-wide; org-admin scoped to its own org. Persistence goes through the
api/src/routes/users.ts:17:  r.get('/', requireRole('super-admin', 'org-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/users.ts:21:  r.post('/', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/users.ts:29:  r.patch('/:id', requireRole('super-admin', 'org-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/users.ts:35:    if (a.role === 'org-admin' && target.orgId !== a.orgId) return notFound(res); // cross-org → uniform 404
api/src/routes/users.ts:36:    if (a.role === 'org-admin' && body.role === 'super-admin') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
api/src/routes/users.ts:40:  r.delete('/:id', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/users.ts:46:  // F1: admin password reset (shared users.resetPassword) — super-admin sets a new password
api/src/routes/users.ts:48:  r.post('/:id/password', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/company-space.ts:13:import { loadReadable, loadWritable, projectDirFor } from '../apps/app-paths.js';
api/src/routes/company-space.ts:46:    const { verdict, art } = await loadWritable(actorOf(req), req.params.artifactId as string);
api/src/routes/company-space.ts:58:    const { verdict, art } = await loadWritable(actorOf(req), req.params.artifactId as string);
api/src/routes/settings.ts:19:  r.patch('/', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
shared/src/settings.ts:56:    auth: 'org-admin',
api/src/routes/notifications.ts:7:import { verifySseToken } from '../auth/middleware.js';
api/src/routes/notifications.ts:14:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/credentials.ts:2: * Credentials router (F2; ch06 §6.2). ONE write-only, super-admin, audit-logged surface
api/src/routes/credentials.ts:17:  r.post('/', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/registo.ts:3: * the platform-crud service (ch02 §2.7). org-admin reads own org; super-admin across orgs.
api/src/routes/registo.ts:15:  // settings privacy page), so it registers BEFORE the org-admin gate below with its own
api/src/routes/registo.ts:22:  r.use(requireAuth, requireRole('org-admin', 'super-admin'));
api/src/server.ts:51:import { appAssistantRouter } from './apps/app-assistant-route.js';
api/src/server.ts:129:import { getArtifactById, projectDirFor } from './apps/app-paths.js';
api/src/server.ts:568:  // F2 — model-credential provisioning (super-admin, write-only, audit-logged; ch06 §6.2).
api/src/server.ts:673: *  activation map + revocation set, seed the founder super-admin. Then the apps/
api/src/server.ts:681:  // at boot (a demoted admin's old JWT re-admits, a locked account re-opens). loadActivation defaults
api/src/routes/memories.ts:74:    if (!m) return notFound(res); // includes another user's private memory (invisible to org admin)
shared/src/integrations.ts:179:    auth: 'org-admin',
shared/src/knowledge.ts:233:    auth: 'org-admin',
shared/src/knowledge.ts:239:    auth: 'org-admin',
api/src/routes/org.ts:27:  r.patch('/', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/org.ts:37:  r.put('/branding', requireRole('org-admin', 'super-admin'), saveBrandingHandler);
api/src/routes/org.ts:41:  r.get('/deny-list', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/org.ts:45:  r.post('/deny-list', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/org.ts:52:  r.delete('/deny-list/:id', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/org.ts:80:  r.use(requireAuth, requireRole('super-admin'));
api/src/routes/platform-integrations.ts:7: *     POST   /:provider/connect      connect     (org-admin)-> { authUrl, state }
api/src/routes/platform-integrations.ts:8: *     DELETE /:provider              disconnect  (org-admin)-> { ok }
api/src/routes/platform-integrations.ts:66:  r.post('/:provider/connect', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/platform-integrations.ts:76:  r.delete('/:provider', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/artifacts.ts:33:import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag, isAppArtifact } from '../apps/app-paths.js';
api/src/routes/artifacts.ts:67:    const { verdict, art } = await loadWritable(actorOf(req), req.params.id as string);
api/src/routes/artifacts.ts:78:   * (admin-only). NON-app artifacts stay user-manageable (the check is app-type-aware). Returns
api/src/routes/artifacts.ts:83:      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/artifacts.ts:99:    // org-admin + super-admin — this is the base "artifacts area" capability, distinct from the
api/src/routes/artifacts.ts:102:      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: 'canCreateArtifacts' });
api/src/routes/artifacts.ts:114:      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
api/src/routes/artifacts.ts:164:        ? 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.'
api/src/routes/artifacts.ts:165:        : 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: forkCap });
api/src/routes/artifacts.ts:173:  r.put('/:id/featured', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/agents/registry.ts:20:  /** Owner's org — org-admins may cancel build jobs in their own org (§5.3.1). */
api/src/agents/registry.ts:135: * error. Authorization: owner, an org-admin over a build job in its own org, or a super-admin.
api/src/agents/registry.ts:148:  if (actor.role === 'super-admin') return true;
api/src/agents/registry.ts:149:  if (actor.role === 'org-admin' && entry.kind === 'build' && entry.orgId && entry.orgId === actor.orgId) return true;
api/src/apps/backend-runtime/index.ts:8:import { projectDirFor } from '../app-paths.js';
api/src/routes/integrations.ts:4: *    org-admin refresh that reloads the versioned packages from disk (ch03 §3.8.13 rows).
api/src/routes/integrations.ts:54:  // POST /api/v1/integrations/refresh -> { count, keys } (auth: org-admin, 'refresh-registry').
api/src/routes/integrations.ts:55:  r.post('/refresh', requireRole('org-admin', 'super-admin'), (_req: AuthedRequest, res: Response) => {
api/src/agents/seams.ts:327:   * close). The create-time gate on `POST /jobs` (loadWritable in routes/) can go stale before a
api/src/agents/seams.ts:332:   * (loadWritable) and agents/ reaches apps/ only through this seam (tier direction, ch02 §2.7).
api/src/agents/seams.ts:333:   * Verdict mirrors loadWritable: 'ok' | 'notfound' | 'forbidden'.
api/src/automation/service.ts:9: * by their creator or an org-admin/super-admin). Runs are visible to the owner and org-admins.
api/src/automation/service.ts:10: * Creation is org-admin-only by default with a flippable org setting for builder authoring
api/src/automation/service.ts:127:const isAdmin = (actor: Actor): boolean => actor.role === 'super-admin' || actor.role === 'org-admin';
api/src/automation/service.ts:131:  return actor.role === 'super-admin' || doc.orgId === actor.orgId;
api/src/automation/service.ts:133:/** Write scope: the creator, or an org-admin in the same org, or a super-admin. */
api/src/automation/service.ts:135:  if (actor.role === 'super-admin') return true;
api/src/automation/service.ts:137:  return doc.ownerUserId === actor.userId || actor.role === 'org-admin';
api/src/automation/service.ts:139:/** Run visibility: the owner, an org-admin in the run's org, or a super-admin. */
api/src/automation/service.ts:141:  if (actor.role === 'super-admin') return true;
api/src/automation/service.ts:143:  return run.ownerUserId === actor.userId || actor.role === 'org-admin';
api/src/automation/service.ts:147: *  super-admin for platform ops) may mutate a run or touch the owner's consent/cache/memory. An
api/src/automation/service.ts:148: *  org-admin has READ visibility (canSeeRun) but must NOT be able to inject a standing command
api/src/automation/service.ts:151:  if (actor.role === 'super-admin') return true;
api/src/automation/service.ts:192:    actor.role === 'super-admin' ? {} : { orgId: actor.orgId },
api/src/automation/service.ts:202:/** Creation authority: org-admin/super-admin, or a plain user when the org enables member authoring.
api/src/automation/service.ts:280:  const catalog = await buildAutomationCatalog(actor.userId, actor.role === 'super-admin');
api/src/automation/service.ts:399:  // A user run must be owned by the actor (the engine's ownership guard); a super-admin runs it as
api/src/automation/service.ts:403:  else if (actor.role === 'super-admin') owner = { userId: automation.ownerUserId, orgId: automation.orgId };
api/src/automation/service.ts:412:  if (actor.role !== 'super-admin') filter.orgId = actor.orgId;
api/src/automation/service.ts:414:  // Builders see only their own runs; org-admins/super-admins see the org's.
api/src/automation/service.ts:490:  // into the owner's memory (§5.6.7, §11.6), so an org-admin must not drive another member's memory.
api/src/automation/service.ts:536:  const catalog = await buildAutomationCatalog(actor.userId, actor.role === 'super-admin');
api/src/routes/jobs.ts:9:import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
api/src/routes/jobs.ts:11:import { loadWritable } from '../apps/app-paths.js';
api/src/routes/jobs.ts:21:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/jobs.ts:43:    // request-to-admin flow consumes); object-ownership denials carry no capability field.
api/src/routes/jobs.ts:52:        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/jobs.ts:59:      const { verdict } = await loadWritable(actor, body.artifactId);
api/src/routes/jobs.ts:63:      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
api/src/routes/jobs.ts:89:    if (!job || (job.userId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
api/src/routes/knowledge.ts:3: * org-admin heal operations. No human search endpoint by design — agents consume search/read via
api/src/routes/knowledge.ts:158:  // --- Org-admin heal operations (backend-only, kept for ops — ch03 §3.8.20 C3) ---
api/src/routes/knowledge.ts:159:  r.post('/reindex', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/routes/knowledge.ts:169:  r.get('/index-status', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
api/src/agents/integration-builder-parser.ts:10: * knowledge doc) and ```config-json (the structured config the admin UI + action executor read).
api/src/routes/triggers.ts:10:import { loadReadable } from '../apps/app-paths.js';
api/src/routes/triggers.ts:36:    // validated to the same org (same-org read or super-admin); a foreign/unknown target is a 404.
api/src/routes/billing.ts:5: * super-admin gated (§6.6.2).
api/src/routes/billing.ts:22:  adminListUsage,
api/src/routes/billing.ts:23:  adminResetUsage,
api/src/routes/billing.ts:24:  adminSetLimit,
api/src/routes/billing.ts:31:  const superAdmin = requireRole('super-admin');
api/src/routes/billing.ts:59:  // ---- Super-admin surfaces (§6.6.2) ----
api/src/routes/billing.ts:64:  r.put('/admin/overage', superAdmin, async (req: AuthedRequest, res: Response) => {
api/src/routes/billing.ts:70:  r.get('/admin/usage', superAdmin, async (_req: AuthedRequest, res: Response) => {
api/src/routes/billing.ts:71:    res.json(await adminListUsage(deps.now()));
api/src/routes/billing.ts:74:  r.post('/admin/usage/:userId/reset', superAdmin, async (req: AuthedRequest, res: Response) => {
api/src/routes/billing.ts:75:    res.json(await adminResetUsage(req.params.userId as string, deps.now()));
api/src/routes/billing.ts:78:  r.put('/admin/limits/:userId', superAdmin, async (req: AuthedRequest, res: Response) => {
api/src/routes/billing.ts:81:    res.json(await adminSetLimit(req.params.userId as string, body.tokenLimit, deps.now()));
api/src/apps/backend-runtime/runtime.ts:534:        const { projectDirFor } = await import('../app-paths.js');
api/src/apps/backend-runtime/runtime.ts:543:      const { backendBundlePath } = await import('../app-paths.js');
api/src/services/platform-crud.ts:47:// `settings` singleton holds platform defaults only and is never mutated by org-admins. ----
api/src/services/platform-crud.ts:181:  let rows = actor.role === 'super-admin' ? await activityLogs.find(q.orgId ? { orgId: q.orgId } : {}) : await activityLogs.find({ orgId: actor.orgId });
api/src/services/platform-crud.ts:207: *  org-wide views stay on the admin Registo). Counts by entity class, never values. */
api/src/automation/engine.ts:302:  // returns `inputs` to the owner AND org admins, so a persisted credential is a cross-actor leak.
api/src/automation/engine.ts:1218:            { userId: ctx.ownerUserId, userRole: 'admin', userScopes: ['agent:execute'], traceId: ctx.traceId },
api/src/knowledge/service.ts:8: *    org-admin heal operations (reindex, index-status) and the startup backfill.
api/src/knowledge/service.ts:324:// --- Heal operations (org-admin) + startup backfill ----------------------------------------
api/src/knowledge/service.ts:326:/** Rebuild one org's index from its vault (admin heal). Synchronous + deterministic in v1;
api/src/auth/service.ts:2: * Auth domain services (ch03 §3.8.1/§3.8.2, ch09 §9.7.1). Login, refresh, admin seeding,
api/src/auth/service.ts:47: * second as a bump (password change, admin reset, admin logout) would be born invalid. Pinning a
api/src/auth/service.ts:60: * at boot and EVERY revocation — role change, password change/reset, admin logout, deactivation,
api/src/auth/service.ts:63: * that write instead of calling this; this helper is for the standalone bumps (e.g. admin logout).
api/src/auth/service.ts:70:/** First-boot super-admin seeding: creates the founder's org + super-admin account if absent. */
api/src/auth/service.ts:72:  const existing = await users.find({ role: 'super-admin' });
api/src/auth/service.ts:81:    role: 'super-admin',
api/src/auth/service.ts:123: * every request, so the token dies immediately). Admin variant: super-admin anywhere, org-admin
api/src/auth/service.ts:126: * mechanism as deactivation, ch09 §9.6). Cross-org for an org-admin reads as 'not-found' — no
api/src/auth/service.ts:137:  if (caller.role !== 'super-admin' && caller.role !== 'org-admin') return 'forbidden';
api/src/auth/service.ts:140:  if (caller.role === 'org-admin' && target.orgId !== caller.orgId) return 'not-found';
api/src/auth/service.ts:143:  // an admin logout that reset to 0 on the next boot would re-admit the very tokens it revoked.
api/src/auth/service.ts:171: * Admin password reset (F1, shared users.resetPassword): super-admin sets a new password and
api/src/auth/service.ts:178:  // An admin reset is the offboarding / compromised-account lever: the target's outstanding
api/src/apps/artifact-bundle.ts:32:import { projectDirFor, newProjectDir } from './app-paths.js';
api/src/knowledge/index.ts:4: *  - routes/knowledge.ts uses the service (vault CRUD, uploads, org-admin heal ops).

exec
/bin/zsh -lc "node -e \"const fs=require('fs');const path=require('path');const root=process.cwd();const files=['api/src/apps/app-assistant-route.ts','api/src/apps/app-paths.ts'];for(const f of files){const src=fs.readFileSync(f,'utf8');const imports=[...src.matchAll(/from ['\\\"](.+?)['\\\"]/g)].map(m=>m[1]);console.log('FILE',f);for(const i of imports) console.log(' ',i);} \"" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
FILE api/src/apps/app-assistant-route.ts
  express
  @ekoa/shared
  ../data/collections-engine.js
  ../data/activation.js
  ../data/stores.js
  ../billing/index.js
  ../llm/index.js
  ../knowledge/index.js
  ../auth/middleware.js
  ../auth/capabilities.js
  ../auth/jwt.js
  ./registry.js
  ./app-paths.js
  ./app-assistant.js
FILE api/src/apps/app-paths.ts
  node:fs
  node:path
  ../data/stores.js
  ./artifacts-service.js
  ../data/scoped.js
  ../services/safe-path.js
  ./featured-seeder.js

codex
No import cycle is evident in the direct graph: `app-assistant-route.ts -> app-paths.ts`, while `app-paths.ts` does not point back. I’m doing one last pass on the specific test cases and the client contract/comments so I can close this out strictly against the three checks you listed.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '245,470p' api/tests/apps/app-assistant.test.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
 * operator-run H2 — the admin-detection DECISION (`isAppEditor`), the PURE core of
 * `GET /api/app-assistant/whoami`. Detection MIRRORS the H1 follow-up-build edit gate exactly
 * (codex-h2): H1's `can('canEditApps')` capability gate AND the artifact-writability verdict
 * loadWritable produces (own always; org-shared within the org ok; another user's private / a
 * cross-org / missing artifact → not-ok). So `admin:true` ⟺ this caller can ACTUALLY edit this app
 * (no false offer, no owner-org membership oracle). The verdict is computed by loadWritable in the
 * route (exercised by the matrix below); this unit pins the pure combine.
 */
describe('isAppEditor (H2 detection decision — mirrors the H1 edit gate)', () => {
  it('an app-edit-capable caller with a WRITABLE artifact is an editor', () => {
    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'ok')).toBe(true);
    expect(isAppEditor({ role: 'super-admin', orgId: 'org-any' }, 'ok')).toBe(true);
  });
  it('a NOT-writable artifact (forbidden/notfound) is never editable, even for an admin (fail-closed: closes the empty-owner-org + oracle findings)', () => {
    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'forbidden')).toBe(false);
    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'notfound')).toBe(false);
    expect(isAppEditor({ role: 'super-admin', orgId: 'org-any' }, 'notfound')).toBe(false);
  });
  it('a plain user is never an editor (H1 capability gate denies canEditApps), even on a writable artifact', () => {
    expect(isAppEditor({ role: 'user', orgId: 'org-owner' }, 'ok')).toBe(false);
  });
});

/**
 * operator-run H2 — the `GET /api/app-assistant/whoami` FAIL-CLOSED matrix over the REAL router,
 * the REAL verification chain (verifyToken + jti + isRevoked + activation-active + tokenEpoch, via
 * verifySseToken) and REAL owner resolution. The router is wired with THROWING llm deps: whoami
 * must never ground/route/bill, so any accidental model touch would blow the request up (it does
 * not — every case returns 200). Binding invariants asserted here:
 *   - admin:true ONLY for an org-admin/super-admin of the OWNER org WITH canEditApps.
 *   - EVERYTHING else -> 200 { admin:false }: no token, invalid, expired, epoch-stale, user role,
 *     wrong-org admin. NEVER a 4xx on a bad/missing token (a 401/403 would be an oracle).
 *   - the ONLY non-200 is a malformed X-Ekoa-App-Id (the SAME 400 POST gives) / unknown app (404).
 */
describe('GET /api/app-assistant/whoami (H2 fail-closed detection)', () => {
  let mem: MongoMemoryServer;
  let server: Server;
  let port: number;
  let seq = 0;
  const loginDeps = { now: () => 1_700_000_000_000 + seq++, genId: () => `jti_${seq++}` };

  // whoami must NEVER reach these — it neither grounds, routes, nor bills.
  const throwingDeps: AppAssistantDeps = {
    oneShot: async () => { throw new Error('whoami must not call the model (visitor-blindness exception is detection-only)'); },
    ground: () => { throw new Error('whoami must not ground'); },
    decide: () => { throw new Error('whoami must not route'); },
  };

  const APP_ID = 'app-h2'; // ORG-SHARED, owned by owner-1 (org-owner)
  const PRIV_ID = 'app-h2-priv'; // PRIVATE draft, owned by owner-1 (org-owner)
  const tokens: Record<string, string> = {};

  async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
    setActivation(id, { active: true, billingLocked: false });
  }
  const whoami = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/api/app-assistant/whoami`, { headers });
  const postAssistant = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/api/app-assistant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ message: 'olá' }),
    });

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = 'k';
    process.env.JWT_SECRET = 's';
    __resetConfigForTests();
    loadConfig();
    __resetActivationForTests();
    __resetRevocationsForTests();
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_h2_whoami');

    // The app + its owner (org-owner). APP_ID is ORG-SHARED (visibility:'org') - the org's real
    // app that org-admins manage; loadWritable grants own-org admins write on it. PRIV_ID is a
    // PRIVATE draft of the same owner - only the owner can edit it (loadWritable forbids even a
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

hook: PreToolUse
exec
/bin/zsh -lc "sed -n '80,150p' shared/src/app-assistant.ts && printf '\\n---\\n' && sed -n '250,340p' api/assets/panel-runtime/src/AssistantPanel.jsx" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
  actions: z.array(AssistantAction).optional(),
  /** The mode the assistant operated in — the client's pin, or the server's inference (D1). */
  mode: AssistantChatMode.optional(),
});
export type AssistantChatResponse = z.infer<typeof AssistantChatResponse>;

/** Admin-detection response for the served-app assistant (operator-run H2; detect-then-ask).
 *
 *  The panel asks `GET /api/app-assistant/whoami` (X-Ekoa-App-Id + an OPTIONAL platform Bearer)
 *  whether the current viewer is an admin of the app OWNER's org WITH the `canEditApps` capability.
 *  The answer is a single boolean and NOTHING else: `.strict()` so no identity, org, role, or
 *  reason ever leaks onto the wire (the endpoint is fail-closed and oracle-free — see the route).
 *  `admin: true` is a capability HINT only; every privileged action stays gated server-side by the
 *  H1 admission plane, and the panel never auto-enables anything from it (edit mode is H3). */
export const AppAssistantWhoamiResponse = z.object({ admin: z.boolean() }).strict();
export type AppAssistantWhoamiResponse = z.infer<typeof AppAssistantWhoamiResponse>;

export const appAssistantEndpoints = {
  assistantChat: {
    method: 'POST',
    path: '/api/app-assistant',
    auth: 'header-scoped',
    request: AssistantChatRequest,
    response: AssistantChatResponse,
  },
  // H2 admin detection. Header-scoped like its sibling (X-Ekoa-App-Id resolves the app); the
  // platform Bearer is OPTIONAL and read only to detect the viewer — never required, never an
  // oracle (a missing/invalid token is always a 200 { admin: false }, never a 401/403).
  whoami: {
    method: 'GET',
    path: '/api/app-assistant/whoami',
    auth: 'header-scoped',
    response: AppAssistantWhoamiResponse,
  },
} as const satisfies DomainDescriptorMap;

---
  const [pinnedMode, setPinnedMode] = useState(null);
  const [messages, setMessages] = useState([]); // { id, role, content, citations?, runs? }
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // E2 same-document tour playback state (null when no tour is active). The player
  // is 100% client-side and issues ZERO model calls: it fetches the pre-generated
  // tour from GET /api/demos/:appId and drives it in the page.
  const [tour, setTour] = useState(null);
  // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
  // Default false (fail-closed). Set ONCE by the mount detection below. This flag NEVER
  // auto-enables anything - it only lights the discreet indicator in the header (the actual
  // edit-mode switch is H3). Every privileged action stays gated server-side by H1.
  const [admin, setAdmin] = useState(false);

  const idRef = useRef(0);
  const messagesRef = useRef(messages);
  const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const playerRef = useRef(null);
  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)

  useEffect(() => {
    messagesRef.current = messages;
    // keep the newest turn in view
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    // Auto-open handoff (G2): the visitor clicked the launcher, so the panel mounts
    // already open - focus the composer once, matching an explicit open. Never runs
    // on an idle-preloaded (collapsed) mount, so it never steals focus from the app.
    if (defaultOpen && textareaRef.current) textareaRef.current.focus();
    // Mount-only: the handoff intent is fixed at mount time.
  }, [defaultOpen]);

  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
  // cross-origin/sandboxed iframe throws) and attaches it as an OPTIONAL Bearer alongside the
  // X-Ekoa-App-Id header the POST path already sends. This is a cheap non-LLM GET - it does NOT
  // count as an assistant turn (zero-token invariant). The result only lights the discreet
  // indicator; it NEVER auto-enables anything and issues no privileged call (edit mode is H3).
  useEffect(() => {
    const id = appId();
    // No app id (standalone preview) or already detected once -> nothing to do. Empty deps make
    // this a mount-only effect; the ref keeps detection to exactly ONE request per mounted panel
    // even if the effect is ever re-entered. The panel-runtime entry mounts WITHOUT StrictMode.
    if (!id || whoamiDoneRef.current) return;
    whoamiDoneRef.current = true;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const token = readPlatformToken();
    void (async () => {
      try {
        const res = await fetch(WHOAMI_ENDPOINT, {
          method: 'GET',
          ...(controller ? { signal: controller.signal } : {}),
          headers: {
            'X-Ekoa-App-Id': id,
            // OPTIONAL: sent only when a same-origin token was readable. Absent -> the server
            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
        const data = await res.json();
        setAdmin(!!(data && data.admin === true));
      } catch {
        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
      }
    })();

    return () => {
      if (controller) controller.abort();
    };
    // Mount-only: detection is a one-shot for the panel's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextId = () => {
    idRef.current += 1;
    return idRef.current;
  };

  const patchTurn = useCallback((turnId, patch) => {
    setMessages((prev) => prev.map((m) => (m.id === turnId ? { ...m, ...patch(m) } : m)));
  }, []);

  const recordResult = useCallback((result) => {
    const buf = actionResultsRef.current;

hook: PreToolUse Completed
exec
/bin/zsh -lc 'rg -n "isOwnerOrgAdmin|detectOwnerOrgAdmin" api/src api/tests shared/src docs/autothing/runs/20260712-150958-4bb23640/slices/H2' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md:22:- Identity: `detectOwnerOrgAdmin(authHeader, ownerOrgId)` extracts the OPTIONAL `Bearer` (same
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md:26:- Decision: pure exported `isOwnerOrgAdmin(claims, ownerOrgId)` - gated by H1's
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md:70:mongodb-memory-server. Plus a fast pure `isOwnerOrgAdmin` grid (no I/O).
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md:137:divergence. `isOwnerOrgAdmin` was replaced by `isAppEditor(claims, writableVerdict)`; the route now
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/review-verdict.md:10:  `isOwnerOrgAdmin` grid, the strict-contract branch tests, and the panel detect-then-ask pins.
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/review-verdict.md:21:**1. Genuinely fail-closed? YES.** `detectOwnerOrgAdmin` (`app-assistant-route.ts:98-104`): no/
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/review-verdict.md:51:**4. Capability correctness. SOUND.** `isOwnerOrgAdmin` (`:83-88`) gates on H1's
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/worker-status.txt:1:DONE-GREEN | vitest: 56 files, 536 tests, all pass (npx vitest run tests/apps tests/contract). Whoami H2 tests: tests/apps/app-assistant.test.ts (isOwnerOrgAdmin grid + the fail-closed route matrix over the real verify chain + mongodb-memory-server), tests/contract/app-assistant.contract.test.ts (whoami both branches + strict + descriptor), tests/apps/assistant-panel.test.ts (defensive token read + once-only whoami + no-affordance-on-false + detect-then-ask pinned). tsc app+test+shared+web all 0; eslint touched files 0/0; panel build.mjs OK; gate:chokepoint clean.
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:794:+export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:809:+function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:814:+  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:978:+      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:1015:+import { appAssistantRouter, isOwnerOrgAdmin } from '../../src/apps/app-assistant-route.js';
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:1187:+ * operator-run H2 — the admin-detection DECISION (`isOwnerOrgAdmin`), the PURE role/org/capability
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:1192:+describe('isOwnerOrgAdmin (H2 detection decision)', () => {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:1194:+    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:1197:+    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-other' }, 'org-owner')).toBe(false);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:1200:+    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-other' }, 'org-owner')).toBe(true);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:1201:+    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:1204:+    expect(isOwnerOrgAdmin({ role: 'user', orgId: 'org-owner' }, 'org-owner')).toBe(false);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:2056:    83	export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:2071:    98	function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:2076:   103	  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:2229:   256	      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:2858:83	export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:2873:98	function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:2878:103	  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3031:256	      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3731:    16	import { appAssistantRouter, isOwnerOrgAdmin } from '../../src/apps/app-assistant-route.js';
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3960:   245	 * operator-run H2 — the admin-detection DECISION (`isOwnerOrgAdmin`), the PURE role/org/capability
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3965:   250	describe('isOwnerOrgAdmin (H2 detection decision)', () => {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3967:   252	    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3970:   255	    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-other' }, 'org-owner')).toBe(false);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3973:   258	    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-other' }, 'org-owner')).toBe(true);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3974:   259	    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:3977:   262	    expect(isOwnerOrgAdmin({ role: 'user', orgId: 'org-owner' }, 'org-owner')).toBe(false);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:4548:- Identity: `detectOwnerOrgAdmin(authHeader, ownerOrgId)` extracts the OPTIONAL `Bearer` (same
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:4552:- Decision: pure exported `isOwnerOrgAdmin(claims, ownerOrgId)` - gated by H1's
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:4596:mongodb-memory-server. Plus a fast pure `isOwnerOrgAdmin` grid (no I/O).
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:5433:- `Medium` [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:252) and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:83): `whoami` does not fail closed when the app owner record is missing or lacks `orgId`. It resolves `ownerOrgId` to `''`, then `isOwnerOrgAdmin()` still returns `true` for any `super-admin`. Attack scenario: an orphaned/corrupt artifact record lets a super-admin get `200 {admin:true}` for an app with no resolvable owner org, violating the stated “owner-org server-resolved or false” contract and creating a false-positive privileged signal that H3 is likely to trust later.
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md:5442:- `Medium` [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:252) and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:83): `whoami` does not fail closed when the app owner record is missing or lacks `orgId`. It resolves `ownerOrgId` to `''`, then `isOwnerOrgAdmin()` still returns `true` for any `super-admin`. Attack scenario: an orphaned/corrupt artifact record lets a super-admin get `200 {admin:true}` for an app with no resolvable owner org, violating the stated “owner-org server-resolved or false” contract and creating a false-positive privileged signal that H3 is likely to trust later.
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:14:Adversarial SECURITY re-review in /Users/ggomes/dev/ekoa-code. You earlier flagged 2 issues on H2 whoami (Medium: not fail-closed when the app owner record is missing/has no orgId - super-admin still got admin:true; Low: org-admin owner-org membership oracle). The fix is in commit 61c0372 (git show 61c0372). The fix redefines whoami 'admin' to MIRROR the H1 follow-up-build edit gate EXACTLY: admin = can(caller,'canEditApps') AND loadWritable(caller, appId).verdict==='ok' (own always; org-shared in-org ok; other-user-private forbidden; missing/cross-org notfound), instead of the old role+owner-org check. Verify BOTH findings are CLOSED and no NEW defect was introduced: (1) Medium - an orphaned/no-orgId/cross-org artifact now yields loadWritable notfound -> admin:false even for super-admin? trace isAppEditor + detectAppEditor + the whoami handler in api/src/apps/app-assistant-route.ts; (2) Low - is the oracle gone? admin:true now only for apps loadWritable grants (own + org-shared in the caller's org), which the caller already enumerates via GET /artifacts listVisible - confirm a same-org OTHER-user PRIVATE app now reads admin:false (no in-org private-app existence oracle) and cross-org reads false; (3) NEW - did the loadWritable import into app-assistant-route create a cycle or change POST's visitor-blind path; is detectAppEditor still fail-closed 200 on every token failure (no throw/4xx); is the verify chain still the full verifySseToken; does the panel still only read the boolean; any dead code left (isOwnerOrgAdmin removed?). Also assess: is 'app edit is org-scoped (super-admin cannot cross-org edit)' a defensible policy or a regression - note it but it is a documented decision, not necessarily a defect. Read slices/H2/impl-notes.md (the Codex-fix round section) + slices/H2/codex-review.md (your prior findings). Read-only cmds OK. Concise: a bullet per finding (CLOSED/NOT-CLOSED + file:line) then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:176:-export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:200:-function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:206:-  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:374:-      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:2268:- Identity: `detectOwnerOrgAdmin(authHeader, ownerOrgId)` extracts the OPTIONAL `Bearer` (same
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:2272:- Decision: pure exported `isOwnerOrgAdmin(claims, ownerOrgId)` - gated by H1's
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:2316:mongodb-memory-server. Plus a fast pure `isOwnerOrgAdmin` grid (no I/O).
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md:2383:divergence. `isOwnerOrgAdmin` was replaced by `isAppEditor(claims, writableVerdict)`; the route now

codex
I have enough to conclude the security behavior. I’m pulling exact line numbers for the closeout so the verdict is pinned to the current code, not the commit message.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/apps/app-assistant-route.ts | sed -n '90,280p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    90	 *     this caller on this app. The panel never promises an edit the gate would then refuse.
    91	 * NOTE: like the H1 gate, loadWritable is org-scoped, so a super-admin is NOT granted cross-org app
    92	 * edit here (a super-admin only edits apps in their own org). If platform-wide cross-org app editing
    93	 * is ever wanted, that is a deliberate policy change to loadWritable/the H1 gate AND this detection
    94	 * together — not a silent divergence. Exported for the unit matrix.
    95	 */
    96	export function isAppEditor(claims: Pick<JwtClaims, 'role' | 'orgId'>, writableVerdict: 'ok' | 'forbidden' | 'notfound'): boolean {
    97	  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
    98	  return writableVerdict === 'ok'; // ...and the actor must actually be able to write THIS artifact
    99	}
   100	
   101	/**
   102	 * Detect whether the OPTIONAL platform Bearer on this request can EDIT app `appId`. FAIL-CLOSED and
   103	 * oracle-free: any deviation — no token, a non-Bearer header, or a token that does not clear the
   104	 * standard verification chain — returns false, never throws, never distinguishes a bad token from a
   105	 * not-writable one. The verification is the EXACT chain requireAuth/verifySseToken run (verifyToken
   106	 * + jti + isRevoked + activation-active + tokenEpoch); the edit decision is the EXACT H1 gate
   107	 * (can(canEditApps) + loadWritable). This endpoint does NOT hand-roll a weaker check and adds NO
   108	 * second identity path.
   109	 */
   110	async function detectAppEditor(authHeader: string | undefined, appId: string): Promise<boolean> {
   111	  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
   112	  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
   113	  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
   114	  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
   115	  const actor = { userId: verified.claims.sub, orgId: verified.claims.orgId, role: verified.claims.role };
   116	  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
   117	  return isAppEditor(verified.claims, verdict);
   118	}
   119	
   120	/** What the admission middleware resolves and stashes for the handler + allowance gate. */
   121	interface AssistantAdmission {
   122	  owner: { userId: string; orgId: string };
   123	  artifactId: string;
   124	  actionManifest: AppActionManifest | null;
   125	}
   126	interface AssistantRequest extends Request {
   127	  ekoaAssistant?: AssistantAdmission;
   128	}
   129	
   130	/** The production deps: the assistant's only model egress is the llm/ chokepoint one-shot; grounding
   131	 *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
   132	 *  is passed in by the admission middleware, not here). */
   133	const prodDeps: AppAssistantDeps = {
   134	  oneShot: runOneShot,
   135	  ground: buildGroundingBlock,
   136	  decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
   137	};
   138	
   139	export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
   140	  const r = Router();
   141	
   142	  /**
   143	   * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
   144	   * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
   145	   * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
   146	   */
   147	  const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
   148	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
   149	    if (resolution.status === 'invalid-id') {
   150	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
   151	      return;
   152	    }
   153	    if (resolution.status === 'not-found') {
   154	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
   155	      return;
   156	    }
   157	    const app = resolution.app;
   158	
   159	    // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
   160	    const activation = getActivation(app.ownerUserId);
   161	    if (!activation || activation.active === false) {
   162	      sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
   163	      return;
   164	    }
   165	    if (activation.billingLocked) {
   166	      sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
   167	      return;
   168	    }
   169	
   170	    // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
   171	    const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
   172	    const orgId = owner?.orgId ?? '';
   173	
   174	    // The app's declared action manifest (persisted at activation on the artifact data bag).
   175	    // Validate it against the shared contract; absent/invalid → no operate surface (null).
   176	    const art = await artifacts.get(app.appId);
   177	    const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
   178	    const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
   179	    const actionManifest = parsedManifest?.success ? parsedManifest.data : null;
   180	
   181	    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
   182	    next();
   183	  };
   184	
   185	  /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
   186	  const admitGuarded: RequestHandler = (req, res, next) => {
   187	    void admit(req, res, next).catch((err) => {
   188	      console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
   189	      sendError(res, 'INTERNAL', 'Erro interno.');
   190	    });
   191	  };
   192	
   193	  // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
   194	  const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
   195	
   196	  r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
   197	    const admission = req.ekoaAssistant;
   198	    if (!admission) {
   199	      sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
   200	      return;
   201	    }
   202	
   203	    const parsed = AssistantChatRequest.safeParse(req.body ?? {});
   204	    if (!parsed.success) {
   205	      sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
   206	      return;
   207	    }
   208	    const body = parsed.data;
   209	
   210	    try {
   211	      const result = await runAppAssistant(
   212	        {
   213	          message: body.message,
   214	          history: body.history,
   215	          mode: body.mode,
   216	          context: body.context,
   217	          owner: admission.owner,
   218	          artifactId: admission.artifactId,
   219	          actionManifest: admission.actionManifest,
   220	        },
   221	        deps,
   222	      );
   223	      const response: AssistantChatResponse = {
   224	        reply: result.reply,
   225	        mode: result.mode,
   226	        ...(result.citations.length > 0 ? { citations: result.citations } : {}),
   227	        ...(result.actions.length > 0 ? { actions: result.actions } : {}),
   228	      };
   229	      res.json(response);
   230	    } catch (err) {
   231	      console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
   232	      sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
   233	    }
   234	  });
   235	
   236	  /**
   237	   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
   238	   *
   239	   * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
   240	   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "can the
   241	   * current viewer EDIT this app?" — the SAME decision the H1 follow-up-build gate makes
   242	   * (can(canEditApps) + loadWritable). It NEVER grounds, NEVER bills, NEVER widens admission, and
   243	   * issues NO model call (the zero-token GET) — the POST grounding/billing path above stays
   244	   * byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged action
   245	   * remains gated server-side by the H1 admission plane with this same JWT; `admin: true` here is
   246	   * only a HINT the panel may surface (edit mode is H3), and it exactly matches what that edit will
   247	   * actually be allowed to do — never a false offer.
   248	   *
   249	   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
   250	   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
   251	   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
   252	   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
   253	   * app existence).
   254	   */
   255	  const whoami = async (req: Request, res: Response): Promise<void> => {
   256	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
   257	    if (resolution.status === 'invalid-id') {
   258	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
   259	      return;
   260	    }
   261	    if (resolution.status === 'not-found') {
   262	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
   263	      return;
   264	    }
   265	
   266	    // "admin" == can this caller edit THIS app, decided by the SAME rule the H1 edit gate uses
   267	    // (can(canEditApps) + loadWritable on the resolved artifact id). Ownership/org is resolved
   268	    // server-side inside loadWritable from the artifact record, NEVER from anything the caller
   269	    // supplied. Fail-closed + no oracle: see detectAppEditor / isAppEditor above.
   270	    const response: AppAssistantWhoamiResponse = {
   271	      admin: await detectAppEditor(req.header('authorization'), resolution.app.appId),
   272	    };
   273	    res.json(response); // always 200 — the boolean IS the answer
   274	  };
   275	
   276	  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
   277	   *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
   278	  r.get('/app-assistant/whoami', (req, res) => {
   279	    void whoami(req, res).catch((err) => {
   280	      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);

exec
/bin/zsh -lc "nl -ba api/src/apps/app-paths.ts | sed -n '98,112p' && printf '\\n---\\n' && nl -ba api/src/routes/jobs.ts | sed -n '40,62p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '258,322p' && printf '\\n---\\n' && nl -ba shared/src/app-assistant.ts | sed -n '84,110p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   258	  // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
   259	  // Default false (fail-closed). Set ONCE by the mount detection below. This flag NEVER
   260	  // auto-enables anything - it only lights the discreet indicator in the header (the actual
   261	  // edit-mode switch is H3). Every privileged action stays gated server-side by H1.
   262	  const [admin, setAdmin] = useState(false);
   263	
   264	  const idRef = useRef(0);
   265	  const messagesRef = useRef(messages);
   266	  const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
   267	  const listRef = useRef(null);
   268	  const textareaRef = useRef(null);
   269	  const playerRef = useRef(null);
   270	  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)
   271	
   272	  useEffect(() => {
   273	    messagesRef.current = messages;
   274	    // keep the newest turn in view
   275	    const el = listRef.current;
   276	    if (el) el.scrollTop = el.scrollHeight;
   277	  }, [messages]);
   278	
   279	  useEffect(() => {
   280	    // Auto-open handoff (G2): the visitor clicked the launcher, so the panel mounts
   281	    // already open - focus the composer once, matching an explicit open. Never runs
   282	    // on an idle-preloaded (collapsed) mount, so it never steals focus from the app.
   283	    if (defaultOpen && textareaRef.current) textareaRef.current.focus();
   284	    // Mount-only: the handoff intent is fixed at mount time.
   285	  }, [defaultOpen]);
   286	
   287	  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
   288	  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
   289	  // cross-origin/sandboxed iframe throws) and attaches it as an OPTIONAL Bearer alongside the
   290	  // X-Ekoa-App-Id header the POST path already sends. This is a cheap non-LLM GET - it does NOT
   291	  // count as an assistant turn (zero-token invariant). The result only lights the discreet
   292	  // indicator; it NEVER auto-enables anything and issues no privileged call (edit mode is H3).
   293	  useEffect(() => {
   294	    const id = appId();
   295	    // No app id (standalone preview) or already detected once -> nothing to do. Empty deps make
   296	    // this a mount-only effect; the ref keeps detection to exactly ONE request per mounted panel
   297	    // even if the effect is ever re-entered. The panel-runtime entry mounts WITHOUT StrictMode.
   298	    if (!id || whoamiDoneRef.current) return;
   299	    whoamiDoneRef.current = true;
   300	
   301	    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
   302	    const token = readPlatformToken();
   303	    void (async () => {
   304	      try {
   305	        const res = await fetch(WHOAMI_ENDPOINT, {
   306	          method: 'GET',
   307	          ...(controller ? { signal: controller.signal } : {}),
   308	          headers: {
   309	            'X-Ekoa-App-Id': id,
   310	            // OPTIONAL: sent only when a same-origin token was readable. Absent -> the server
   311	            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
   312	            ...(token ? { Authorization: `Bearer ${token}` } : {}),
   313	          },
   314	        });
   315	        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
   316	        const data = await res.json();
   317	        setAdmin(!!(data && data.admin === true));
   318	      } catch {
   319	        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
   320	      }
   321	    })();
   322	

---
    84	export type AssistantChatResponse = z.infer<typeof AssistantChatResponse>;
    85	
    86	/** Admin-detection response for the served-app assistant (operator-run H2; detect-then-ask).
    87	 *
    88	 *  The panel asks `GET /api/app-assistant/whoami` (X-Ekoa-App-Id + an OPTIONAL platform Bearer)
    89	 *  whether the current viewer is an admin of the app OWNER's org WITH the `canEditApps` capability.
    90	 *  The answer is a single boolean and NOTHING else: `.strict()` so no identity, org, role, or
    91	 *  reason ever leaks onto the wire (the endpoint is fail-closed and oracle-free — see the route).
    92	 *  `admin: true` is a capability HINT only; every privileged action stays gated server-side by the
    93	 *  H1 admission plane, and the panel never auto-enables anything from it (edit mode is H3). */
    94	export const AppAssistantWhoamiResponse = z.object({ admin: z.boolean() }).strict();
    95	export type AppAssistantWhoamiResponse = z.infer<typeof AppAssistantWhoamiResponse>;
    96	
    97	export const appAssistantEndpoints = {
    98	  assistantChat: {
    99	    method: 'POST',
   100	    path: '/api/app-assistant',
   101	    auth: 'header-scoped',
   102	    request: AssistantChatRequest,
   103	    response: AssistantChatResponse,
   104	  },
   105	  // H2 admin detection. Header-scoped like its sibling (X-Ekoa-App-Id resolves the app); the
   106	  // platform Bearer is OPTIONAL and read only to detect the viewer — never required, never an
   107	  // oracle (a missing/invalid token is always a 200 { admin: false }, never a 401/403).
   108	  whoami: {
   109	    method: 'GET',
   110	    path: '/api/app-assistant/whoami',

codex
- `CLOSED` Medium: [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:110) now computes `admin` via `verifySseToken` plus `loadWritable`, and [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:103) returns `notfound` for missing/cross-org artifacts. That makes orphaned/no-`orgId`/cross-org cases fail closed to `admin:false`, including for `super-admin`; [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:270) only returns that boolean.

- `CLOSED` Low: [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:108) yields `forbidden` for a same-org other-user private app and `notfound` for cross-org, and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:116) feeds that verdict directly into `isAppEditor`. This now mirrors the H1 edit gate at [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:59): `admin:true` only for writable apps the caller can already reach via normal visibility semantics, so the owner-org membership oracle is gone.

- `CLOSED` New-defect check: no cycle is introduced by the one-way import from [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:38) to [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:14); POST remains visitor-blind and owner-resolved at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:147) and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:196); token failures still fail closed through the full `verifySseToken` chain at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:113); the wire contract is still strict boolean-only at [shared/src/app-assistant.ts](/Users/ggomes/dev/ekoa-code/shared/src/app-assistant.ts:94); and the panel still only consumes that boolean at [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:317). `isOwnerOrgAdmin`/`detectOwnerOrgAdmin` are removed from live code. The org-scoped “super-admin cannot cross-org edit” behavior is documented at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:91) and is a coherent policy match with H1, not a new defect.

VERDICT: APPROVE
hook: Stop
hook: Stop Completed
tokens used
76,078
- `CLOSED` Medium: [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:110) now computes `admin` via `verifySseToken` plus `loadWritable`, and [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:103) returns `notfound` for missing/cross-org artifacts. That makes orphaned/no-`orgId`/cross-org cases fail closed to `admin:false`, including for `super-admin`; [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:270) only returns that boolean.

- `CLOSED` Low: [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:108) yields `forbidden` for a same-org other-user private app and `notfound` for cross-org, and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:116) feeds that verdict directly into `isAppEditor`. This now mirrors the H1 edit gate at [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:59): `admin:true` only for writable apps the caller can already reach via normal visibility semantics, so the owner-org membership oracle is gone.

- `CLOSED` New-defect check: no cycle is introduced by the one-way import from [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:38) to [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:14); POST remains visitor-blind and owner-resolved at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:147) and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:196); token failures still fail closed through the full `verifySseToken` chain at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:113); the wire contract is still strict boolean-only at [shared/src/app-assistant.ts](/Users/ggomes/dev/ekoa-code/shared/src/app-assistant.ts:94); and the panel still only consumes that boolean at [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:317). `isOwnerOrgAdmin`/`detectOwnerOrgAdmin` are removed from live code. The org-scoped “super-admin cannot cross-org edit” behavior is documented at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:91) and is a coherent policy match with H1, not a new defect.

VERDICT: APPROVE
