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
session id: 019f5d96-ede7-77b1-9c64-59957a70979d
--------
user
Adversarial SECURITY review in /Users/ggomes/dev/ekoa-code of commit 791c7e3 (git show 791c7e3): slice H4 of a security block - a request-changes QUEUE (users file change requests from a served app; org-admins see them in a /pedidos dashboard queue; convert -> a patch run via POST /jobs) + a refused-build feed. THE CRUX IS CROSS-ORG ISOLATION. Hunt for REAL defects with file:line + attack scenario: (1) can an org-admin read ANOTHER org's requests - trace readChangeRequests in api/src/services/change-requests.ts: is orgId FORCED to actor.orgId for org-admin, or can a ?orgId=other-org query bypass it (only super-admin may pass orgId)? (2) IDOR on convert/dismiss - do convertChangeRequest/dismissChangeRequest guard row.orgId===actor.orgId and 404 (not 403 = oracle) for a cross-org id? (3) is orgId EVER from the caller body at file time (spoofable) or always server-stamped from the app owner (served-app filing) / requester (refused-build)? can a user file INTO another org's queue? (4) FILE auth - can an anonymous visitor file? is requesterUserId from the verified token not the body? (5) convert POSTs /api/v1/jobs {artifactId} - is that H1-gated (org-admin needs canEditApps+loadWritable) and is artifactId the request's server-side app not caller-supplied - could convert drive a build on an app the admin cannot edit? (6) new endpoints return the shared error envelope; contract tests validate the real schema; descriptor/schema-coverage updated? (7) /pedidos data server-gated not just nav-hidden; PT-PT no emoji/dash? (8) test honesty - integration seeds TWO orgs and asserts org-admin A cannot see/convert/dismiss org B's request (not a tautology), user 403 on the queue read, file->owner-org stamping. Read slices/H4/impl-notes.md + routes/registo.ts (the precedent). Read-only cmds OK. Concise: a bullet per finding classified High/Medium/Low with file:line, then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `791c7e3` with the cross-org isolation questions as the primary lens. I’m first checking repo context files and whether CodeGraph is available, then I’ll trace the H4 slice paths and tests from the commit itself.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'git show --stat --oneline 791c7e3' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-2TlSAqRN' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-0nkY6M5w' (errno=Operation not permitted)
791c7e3 feat(operator-run/h4): SECURITY - request-changes queue + refused-build feed. Users file change requests from inside a served app (route+screen captured, requires login); org-admins see them in a new /pedidos dashboard queue (adminOnly nav, registo-mirrored org scoping) and one-click CONVERT starts a patch run (POST /jobs, H1-gated) or dismiss. Cross-org isolation is server-stamped: orgId always from the app owner (filing) or requester (refused-build), never the caller body; read/convert/dismiss force actor.orgId for org-admins (super-admin across orgs); cross-org convert/dismiss -> 404. Greenfield store+contract+service+route+panel button+web queue; diagram 03 updated
 api/assets/panel-runtime/src/AssistantPanel.css    | 105 +++++++++
 api/assets/panel-runtime/src/AssistantPanel.jsx    | 127 +++++++++++
 api/assets/panel-runtime/src/change-request.js     |  82 +++++++
 api/src/agents/streaming.ts                        |   8 +
 api/src/data/stores.ts                             |  18 ++
 api/src/routes/change-requests.ts                  |  88 ++++++++
 api/src/server.ts                                  |   2 +
 api/src/services/change-requests.ts                | 130 +++++++++++
 api/tests/apps/change-request.test.ts              | 123 +++++++++++
 api/tests/contract/change-requests.test.ts         |  95 ++++++++
 api/tests/contract/schema-coverage.test.ts         |   4 +
 api/tests/routes/change-requests.test.ts           | 166 ++++++++++++++
 .../slices/H4/impl-notes.md                        | 144 ++++++++++++
 .../slices/H4/worker-status.txt                    |  27 +++
 docs/diagrams/03-request-crud.excalidraw           |  70 ++++--
 shared/src/change-request.ts                       | 115 ++++++++++
 shared/src/contract.test.ts                        |   6 +-
 shared/src/events.ts                               |   4 +
 shared/src/index.ts                                |   3 +
 web/__tests__/navigation.test.ts                   |   9 +
 web/app/(dashboard)/pedidos/page.tsx               | 244 +++++++++++++++++++++
 web/lib/api/index.ts                               |   7 +-
 web/lib/navigation.ts                              |   3 +
 web/stores/change-requests.ts                      | 135 ++++++++++++
 24 files changed, 1691 insertions(+), 24 deletions(-)

exec
/bin/zsh -lc "pwd && ls -la && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g '.codegraph' -g 'slices/H4/impl-notes.md' -g 'routes/registo.ts'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
/Users/ggomes/dev/ekoa-code
total 1280
drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 13 23:26 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 13 23:26 .git
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
-rw-r--r--@   1 ggomes  staff    1000 Jul 13 15:43 .gitignore
-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
-rw-r--r--@   1 ggomes  staff    2351 Jul 13 16:54 Dockerfile.api
-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
-rw-r--r--@   1 ggomes  staff   49503 Jul 13 22:42 RUN_LOG.md
drwxr-xr-x@  18 ggomes  staff     576 Jul 13 15:42 api
-rw-r--r--@   1 ggomes  staff       5 Jul  6 22:50 backend.port
drwxr-xr-x@   6 ggomes  staff     192 Jul  8 10:26 deploy
drwxr-xr-x@  17 ggomes  staff     544 Jul 13 17:57 docs
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

codex
The repo is CodeGraph-indexed, so I’m using that path instead of grep-first. Next I’m reading the H4 notes, the filing precedent in `registo.ts`, and the service/routes/tests touched by `791c7e3`.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,240p' docs/operational/epics/epic-003/slices/H4/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
sed: docs/operational/epics/epic-003/slices/H4/impl-notes.md: No such file or directory

exec
/bin/zsh -lc "sed -n '1,240p' api/src/routes/registo.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/**
 * Registo router (ch03 §3.8.24). Org-scoped activity READ, metadata-only. Persistence via
 * the platform-crud service (ch02 §2.7). org-admin reads own org; super-admin across orgs.
 */
import { Router, type Response } from 'express';
import type { MaskingSummaryResponse } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { readRegisto, maskingSummary } from '../services/platform-crud.js';
import { actorOf } from './helpers.js';

export function registoRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  // FC-408 (run s5): the caller's OWN masking-activity aggregate — a per-user surface (the
  // settings privacy page), so it registers BEFORE the org-admin gate below with its own
  // requireAuth. Metadata only: classes and counts, never bodies, never the vault (§17.6).
  r.get('/masking-summary', requireAuth, async (req: AuthedRequest, res: Response) => {
    const payload: MaskingSummaryResponse = await maskingSummary(actorOf(req));
    res.json(payload);
  });

  r.use(requireAuth, requireRole('org-admin', 'super-admin'));

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const a = actorOf(req);
    const q = req.query as { userId?: string; type?: string; orgId?: string; limit?: string; offset?: string };
    const result = await readRegisto(a, req.user!.username, {
      userId: q.userId,
      type: q.type,
      orgId: q.orgId,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      offset: q.offset ? parseInt(q.offset, 10) : undefined,
    }, deps);
    res.json(result);
  });

  return r;
}

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "printf 'PRD/PLANING/TASKS\\n'; find . -name PRD.md -o -name PLANING.md -o -name TASKS.md | sort" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "codegraph explore 'readChangeRequests convertChangeRequest dismissChangeRequest file change request refused build change requests routes auth orgId actor.orgId'" in /Users/ggomes/dev/ekoa-code
 succeeded in 899ms:
## Exploration: readChangeRequests convertChangeRequest dismissChangeRequest file change request refused build change requests routes auth orgId actor.orgId

Found 217 symbols across 112 files.

### Blast radius — what depends on these (update/verify before editing)

- `dismissChangeRequest` (api/src/services/change-requests.ts:122) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found
- `readChangeRequests` (api/src/services/change-requests.ts:84) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found
- `AuthedRequest` (api/src/auth/middleware.ts:13) — 24 callers in `api/src/routes/auth.ts`, `api/src/routes/memories.ts`, `api/src/routes/users.ts`, `api/src/routes/sessions.ts` +14 more; ⚠️ no covering tests found
- `convertChangeRequest` (api/src/services/change-requests.ts:110) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- dismissChangeRequest → loadOwnOrg
- dismissChangeRequest → changeRequestView
- changeRequestsRouter → dismissChangeRequest
- readChangeRequests → find
- convertChangeRequest → loadOwnOrg
- convertChangeRequest → changeRequestView
- changeRequestsRouter → convertChangeRequest
- build → buildFrontend
- build → buildBackend
- createBuildMechanics → build
- ... and 277 more

**references:**
- dismissChangeRequest → Actor
- requireAuth → AuthedRequest
- convertChangeRequest → Actor
- readChangeRequests → ChangeRequestStatus
- buildLinkRouter → Router
- authRouter → Router
- memoriesRouter → Router
- usersRouter → Router
- sessionsRouter → Router
- automationsRouter → Router
- ... and 78 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/services/change-requests.ts — dismissChangeRequest(function), readChangeRequests(function), convertChangeRequest(function), loadOwnOrg(function), changeRequestView(function), fileChangeRequest(function)

```typescript
1	/**
2	 * Change-requests service (operator-run H4; BRIEF Phase 9d). Owns the store access for the
3	 * request-changes queue so routes/ never touches data/ directly (ch02 §2.7; `services/` may
4	 * import `data/`). GREENFIELD — mirrors the registo read's org scoping EXACTLY.
5	 *
6	 * CROSS-ORG ISOLATION is the security crux: `orgId` is stamped SERVER-SIDE here (the app OWNER's
7	 * org for a served-app filing, the requester's OWN org for a dashboard refused-build filing) and
8	 * every read/convert/dismiss is org-scoped — an org-admin sees ONLY its own org, a super-admin
9	 * across orgs (registo.ts's exact rule). The org-admin/super-admin ROLE gate lives on the route
10	 * (requireRole, like registo); this module enforces the org SCOPE.
11	 */
12	import type { Actor, ChangeRequest, ChangeRequestStatus } from '@ekoa/shared';
13	import { changeRequests, users, type ChangeRequestDoc } from '../data/stores.js';
14	
15	export interface Deps { now: () => number; genId: () => string }
16	
17	/** Store doc -> wire shape. The wire schema is `.strict()`, so optional fields are spread only
18	 *  when present (never emit a key the contract does not allow). */
19	export function changeRequestView(d: ChangeRequestDoc): ChangeRequest {
20	  return {
21	    id: d._id,
22	    orgId: d.orgId,
23	    requesterUserId: d.requesterUserId,
24	    requesterName: d.requesterName,
25	    text: d.text,
26	    status: d.status,
27	    createdAt: d.createdAt,
28	    ...(d.appId ? { appId: d.appId } : {}),
29	    ...(d.route ? { route: d.route } : {}),
30	    ...(d.screenState ? { screenState: d.screenState } : {}),
31	    ...(d.jobId ? { jobId: d.jobId } : {}),
32	  };
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
96	  return { items: page.map(changeRequestView), total };
97	}
98	
99	/** org-scope guard shared by convert + dismiss: a missing row OR a cross-org row reads as the
100	 *  SAME not-found (no existence oracle across orgs — an org-admin cannot probe another org's ids). */
101	async function loadOwnOrg(actor: Actor, id: string): Promise<ChangeRequestDoc | null> {
102	  const row = await changeRequests.get(id);
103	  if (!row) return null;
104	  if (actor.role !== 'super-admin' && row.orgId !== actor.orgId) return null;
105	  return row;
106	}
107	
108	/** Mark a request converted, linking the follow-up-build job the dashboard already started
109	 *  (H1-gated at POST /jobs). org-scoped: an org-admin converts only its own org's requests. */
110	export async function convertChangeRequest(
111	  actor: Actor,
112	  id: string,
113	  jobId: string,
114	): Promise<{ status: 'ok'; request: ChangeRequest } | { status: 'not-found' }> {
115	  if (!(await loadOwnOrg(actor, id))) return { status: 'not-found' };
116	  const updated = await changeRequests.update(id, (r) => ({ ...r, status: 'converted', jobId }));
117	  if (!updated) return { status: 'not-found' };
118	  return { status: 'ok', request: changeRequestView(updated) };
119	}
120	
121	/** Decline a request (status -> dismissed). org-scoped, like convert. */
122	export async function dismissChangeRequest(
123	  actor: Actor,
124	  id: string,
125	): Promise<{ status: 'ok'; request: ChangeRequest } | { status: 'not-found' }> {
126	  if (!(await loadOwnOrg(actor, id))) return { status: 'not-found' };
127	  const updated = await changeRequests.update(id, (r) => ({ ...r, status: 'dismissed' }));
128	  if (!updated) return { status: 'not-found' };
129	  return { status: 'ok', request: changeRequestView(updated) };
130	}
```

#### web/lib/api/core.ts — calls(calls), instantiates(instantiates), references(references), request(function)

```typescript
195	
196	// -- The request core -------------------------------------------------------------------
197	
198	export async function request(descriptor: EndpointDescriptor, args?: RequestArgs, opts?: RequestOptions): Promise<unknown> {
199	  const { params, query, body } = splitArgs(descriptor, args);
200	  const url = buildUrl(descriptor, params, query);
201	
202	  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
203	  const token = getToken();
204	  if (token && descriptor.auth !== 'public') {
205	    headers['Authorization'] = `Bearer ${token}`;
206	  }
207	
208	  // Language interceptor (§12.2.3): inject the single-source language into the body.
209	  let jsonBody = body;
210	  if (descriptor.language) {
211	    const language = currentLanguage();
212	    if (language) jsonBody = { ...(jsonBody ?? {}), language };
213	  }
214	
215	  // Body encoding.
216	  let fetchBody: BodyInit | undefined;
217	  if (descriptor.kind === 'binary') {
218	    fetchBody = opts?.rawBody;
219	  } else if (jsonBody !== undefined && (descriptor.request !== undefined || Object.keys(jsonBody).length > 0)) {
220	    headers['Content-Type'] = 'application/json';
221	    fetchBody = JSON.stringify(jsonBody);
222	  }
223	
224	  // Per-descriptor timeout + caller abort, merged into one controller.
225	  const timeoutMs = descriptor.timeoutMs ?? DEFAULT_TIMEOUT_MS;
226	  const controller = new AbortController();
227	  let timedOut = false;
228	  let abortedByCaller = false;
229	  const timer = setTimeout(() => {
230	    timedOut = true;
231	    controller.abort();
232	  }, timeoutMs);
233	  const onCallerAbort = () => {
234	    abortedByCaller = true;
235	    controller.abort();
236	  };
237	  if (opts?.signal) {
238	    if (opts.signal.aborted) onCallerAbort();
239	    else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
240	  }
241	
242	  let res: Response;
243	  try {
244	    res = await fetch(url, { method: descriptor.method, headers, body: fetchBody, signal: controller.signal });
245	  } catch (error) {
246	    if (timedOut) throw new ApiError(0, 'TIMEOUT', `Request timed out after ${timeoutMs}ms`);
247	    if (abortedByCaller) throw new ApiError(0, 'ABORTED', 'Request aborted');
248	    throw new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Network request failed');
249	  } finally {
250	    clearTimeout(timer);
251	    opts?.signal?.removeEventListener('abort', onCallerAbort);
252	  }
253	
254	  if (!res.ok) {
255	    if (res.status === 401 && descriptor.auth !== 'public') handleUnauthorized();
256	    throw await toApiError(res);
257	  }
258	
259	  if (opts?.responseType === 'response') return res;
260	  if (opts?.responseType === 'blob') return res.blob();
261	
262	  if (res.status === 204) return undefined;
263	  const text = await res.text();
264	  let data: unknown;
265	  try {
266	    data = text ? JSON.parse(text) : undefined;
267	  } catch {
268	    throw new ApiError(0, 'CONTRACT_MISMATCH', `Response for ${descriptor.method} ${descriptor.path} was not valid JSON`);
269	  }
270	
271	  // Contract validation in dev/test (ch13 contract tests). Off in production for cost.
272	  if (process.env.NODE_ENV !== 'production' && descriptor.response && data !== undefined) {
273	    const check = descriptor.response.safeParse(data);
274	    if (!check.success) {
275	      throw new ApiError(
276	        0,
277	        'CONTRACT_MISMATCH',
278	        `Response for ${descriptor.method} ${descriptor.path} failed contract validation`,
279	        check.error.issues,
280	      );
281	    }
282	  }
283	
284	  return data;
285	}
286	
```

#### api/src/apps/builder.ts — calls(calls), BuildResult(references), build(calls), build(method), buildFrontend(calls), buildBackend(calls), buildBackend(method), buildFrontend(method)

```typescript
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
```

#### shared/src/change-request.ts — ChangeRequestStatus(constant), ChangeRequest(constant), ChangeRequestFileRequest(type_alias)

```typescript
16	
17	/** The lifecycle of a queued request: open (awaiting an admin), converted (an admin started a
18	 *  patch run — carries the resulting jobId), dismissed (an admin declined it). */
19	export const ChangeRequestStatus = z.enum(['open', 'converted', 'dismissed']);
20	export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatus>;
21	
22	/**
23	 * A single change request. `appId`/`route`/`screenState` are OPTIONAL because the refused-build
24	 * feed (a dashboard first-build refusal) has no served app or screen yet — the panel filing
25	 * always carries them. `orgId`/`requesterUserId`/`requesterName` are server-stamped. `jobId` is
26	 * set only once an admin converts it (the follow-up build the convert started).
27	 */
28	export const ChangeRequest = z
29	  .object({
30	    id: Id,
31	    /** The served app the request is about (absent for a dashboard first-build refusal). */
32	    appId: Id.optional(),
33	    /** The OWNER org (served-app filing) or the requester's own org (refused-build filing).
34	     *  Always server-resolved — this is the cross-org isolation boundary. */
35	    orgId: Id,
36	    requesterUserId: Id,
37	    requesterName: z.string(),
38	    /** The served-app route/screen the request was filed from (best-effort, panel-captured). */
39	    route: z.string().optional(),
40	    /** A short captured screen-context descriptor (panel-captured; org-internal, never egressed). */
41	    screenState: z.string().optional(),
42	    text: z.string(),
43	    status: ChangeRequestStatus,
44	    createdAt: IsoTimestamp,
45	    /** The patch-run job an admin's convert produced (present only when status === 'converted'). */
46	    jobId: Id.optional(),
47	  })
48	  .strict();
49	export type ChangeRequest = z.infer<typeof ChangeRequest>;
50	
51	/**

... (gap) ...

60	  screenState: z.string().max(8000).optional(),
61	  appId: Id.optional(),
62	});
63	export type ChangeRequestFileRequest = z.infer<typeof ChangeRequestFileRequest>;
64	
65	/** Convert body: the jobId of the follow-up build the dashboard already started (H1-gated). */
66	export const ChangeRequestConvertRequest = z.object({ jobId: Id });
```

#### api/src/bridge/server.ts — refuse(function)

```typescript
78	
79	/** Refuse an Upgrade with a raw HTTP response carrying a CONV-2 error envelope, then destroy the
80	 *  socket. Used for every connect-auth rejection (§18.3.2). */
81	function refuse(socket: Duplex, status: number, code: string, message: string, reason?: string): void {
82	  const payload = JSON.stringify({ error: { code, message, ...(reason ? { details: { reason } } : {}) } });
83	  socket.write(
84	    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n` +
85	      'Content-Type: application/json\r\n' +
86	      `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
87	      'Connection: close\r\n\r\n' +
88	      payload,
89	  );
90	  socket.destroy();
91	}
92	
93	function extractToken(req: IncomingMessage, url: URL): string | undefined {
94	  const header = req.headers['authorization'];
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

 succeeded in 1364ms:
codex
I have the core service logic: org-admin reads are forced to `actor.orgId`, and cross-org convert/dismiss collapse to not-found in the service. I’m now checking the route layer, filing paths, H1 job gating, `/pedidos` server gating, and whether the tests actually prove two-org isolation instead of restating the implementation.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "find docs -path '*H4*impl-notes.md' -o -path '*slices/H4/impl-notes.md' | sort" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md

exec
/bin/zsh -lc "git show 791c7e3 -- api/src/routes/change-requests.ts api/tests/routes/change-requests.test.ts api/tests/apps/change-request.test.ts api/tests/contract/change-requests.test.ts api/tests/contract/schema-coverage.test.ts web/app/'(dashboard)'/pedidos/page.tsx web/__tests__/navigation.test.ts web/lib/navigation.ts web/lib/api/index.ts shared/src/change-request.ts shared/src/index.ts api/src/agents/streaming.ts api/src/server.ts api/src/data/stores.ts shared/src/events.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-55Sgmii3' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-2e1DxduZ' (errno=Operation not permitted)
commit 791c7e3b5922b1d8c757aee1933db7d287105160
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 23:26:00 2026 +0100

    feat(operator-run/h4): SECURITY - request-changes queue + refused-build feed. Users file change requests from inside a served app (route+screen captured, requires login); org-admins see them in a new /pedidos dashboard queue (adminOnly nav, registo-mirrored org scoping) and one-click CONVERT starts a patch run (POST /jobs, H1-gated) or dismiss. Cross-org isolation is server-stamped: orgId always from the app owner (filing) or requester (refused-build), never the caller body; read/convert/dismiss force actor.orgId for org-admins (super-admin across orgs); cross-org convert/dismiss -> 404. Greenfield store+contract+service+route+panel button+web queue; diagram 03 updated

diff --git a/api/src/agents/streaming.ts b/api/src/agents/streaming.ts
index b0e025c..74ebf66 100644
--- a/api/src/agents/streaming.ts
+++ b/api/src/agents/streaming.ts
@@ -145,6 +145,14 @@ export function emitChatAnswer(userId: string, ev: { sessionId: string; sourceRu
   sseManager.emit('notifications', userId, 'chat_answer', payload);
 }
 
+/** A user filed a change request into an org-admin's queue (operator-run H4): push a live
+ *  refetch signal onto that admin's per-user notifications channel. Fired once per org-admin of
+ *  the target org — the queue is org-scoped, so only that org's admins are notified. */
+export function emitChangeRequest(userId: string, ev: { appId?: string }): void {
+  const payload: NotificationEvent = { type: 'change_request', ...(ev.appId ? { appId: ev.appId } : {}) };
+  sseManager.emit('notifications', userId, 'change_request', payload);
+}
+
 /** Org branding changed (brand research applied): tell the user's clients to refetch the
  *  company config so the header logo + theme update live (no page reload). Per-user channel -
  *  other org members pick the change up on their next company fetch. */
diff --git a/api/src/data/stores.ts b/api/src/data/stores.ts
index 1f4ce54..df0c49b 100644
--- a/api/src/data/stores.ts
+++ b/api/src/data/stores.ts
@@ -67,6 +67,23 @@ export interface ActivityLogDoc extends Doc {
   timestamp: string;
   metadata?: Record<string, unknown>;
 }
+/** Change-requests queue (operator-run H4). A user's request to change a served app; the app
+ *  OWNER's org-admins read + convert it. `orgId` is the isolation boundary (owner org for a
+ *  served-app filing, the requester's own org for a dashboard refused-build filing) — always
+ *  stamped server-side, never from the caller's body. `appId`/`route`/`screenState` are absent
+ *  for a refused first-build filing. `jobId` is set when an admin converts it into a patch run. */
+export interface ChangeRequestDoc extends Doc {
+  appId?: string;
+  orgId: string;
+  requesterUserId: string;
+  requesterName: string;
+  route?: string;
+  screenState?: string;
+  text: string;
+  status: 'open' | 'converted' | 'dismissed';
+  createdAt: string;
+  jobId?: string;
+}
 export interface SettingsDoc extends Doc {
   [k: string]: unknown;
 }
@@ -92,6 +109,7 @@ export const integrationConfigs = new Store<Doc>('integration_configs');
  *  transcript + the last generated package/skill so a session can be reloaded and edited. */
 export const integrationBuilderSessions = new Store<Doc>('integration_builder_sessions');
 export const activityLogs = new Store<ActivityLogDoc>('activity_logs');
+export const changeRequests = new Store<ChangeRequestDoc>('change_requests');
 export const jobs = new Store<Doc>('jobs');
 export const settings = new Store<SettingsDoc>('settings');
 export const userSettings = new Store<UserSettingsDoc>('user_settings');
diff --git a/api/src/routes/change-requests.ts b/api/src/routes/change-requests.ts
new file mode 100644
index 0000000..cfa6ed3
--- /dev/null
+++ b/api/src/routes/change-requests.ts
@@ -0,0 +1,88 @@
+/**
+ * Change-requests router (operator-run H4; BRIEF Phase 9d). The request-changes queue.
+ *
+ * TWO planes on one resource:
+ *  - FILE (POST /) — ANY logged-in platform user (auth 'user'), registered BEFORE the org-admin
+ *    gate so a plain user can file (filing needs no capability; the queue READ is admin-gated).
+ *    Scoped by the OPTIONAL `X-Ekoa-App-Id` header: present => a served-app filing (lands in the
+ *    app OWNER's org queue); absent => a dashboard refused-build filing (lands in the requester's
+ *    OWN org). requesterUserId + org come from the verified JWT / resolved owner, never the body.
+ *  - QUEUE (GET /, POST /:id/convert, POST /:id/dismiss) — org-admin reads/acts on its OWN org,
+ *    super-admin across orgs: the EXACT `requireRole('org-admin','super-admin')` gate registo.ts
+ *    uses. Org SCOPE (the cross-org isolation crux) is enforced in the service.
+ *
+ * Routes stay thin (validate, call one domain module, shape) — like jobs.ts this one additionally
+ * resolves the app (apps/registry) and fires the live SSE (agents/streaming); it never touches
+ * data/ (the service owns store access, ch02 §2.7).
+ */
+import { Router, type Response } from 'express';
+import { ChangeRequestFileRequest, ChangeRequestConvertRequest, type ChangeRequestStatus } from '@ekoa/shared';
+import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
+import { resolveApp } from '../apps/registry.js';
+import { emitChangeRequest } from '../agents/streaming.js';
+import {
+  fileChangeRequest,
+  readChangeRequests,
+  convertChangeRequest,
+  dismissChangeRequest,
+} from '../services/change-requests.js';
+import { actorOf, notFound, parseBody, sendError } from './helpers.js';
+
+export function changeRequestsRouter(deps: { now: () => number; genId: () => string }): Router {
+  const r = Router();
+
+  // FILE a change request (any authenticated user). Registered BEFORE the org-admin gate below.
+  r.post('/', requireAuth, async (req: AuthedRequest, res: Response) => {
+    const body = parseBody(res, ChangeRequestFileRequest, req.body);
+    if (!body) return;
+    const requester = { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId };
+
+    // The OPTIONAL served-app header decides the target org. Present => resolve the app + its OWNER
+    // (fail-closed: unknown / registry-only / ownerless id is a 404, exactly like the app-assistant
+    // plane). Absent => the dashboard refused-build filing to the requester's own org (target null).
+    let target: { ownerUserId: string; appId: string } | null = null;
+    const header = req.header('x-ekoa-app-id');
+    if (header !== undefined && header !== '') {
+      const app = await resolveApp(header);
+      if (!app || !app.artifactBacked || !app.ownerUserId) {
+        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
+      }
+      target = { ownerUserId: app.ownerUserId, appId: app.appId };
+    }
+
+    const { request, notifyUserIds } = await fileChangeRequest(requester, target, body, deps);
+    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
+    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
+    res.json(request);
+  });
+
+  // The org-admin queue (read + convert + dismiss). org-admin own org; super-admin across orgs.
+  r.use(requireAuth, requireRole('org-admin', 'super-admin'));
+
+  r.get('/', async (req: AuthedRequest, res: Response) => {
+    const q = req.query as { status?: string; orgId?: string; limit?: string; offset?: string };
+    const result = await readChangeRequests(actorOf(req), {
+      status: q.status as ChangeRequestStatus | undefined,
+      orgId: q.orgId,
+      limit: q.limit ? parseInt(q.limit, 10) : undefined,
+      offset: q.offset ? parseInt(q.offset, 10) : undefined,
+    });
+    res.json(result);
+  });
+
+  r.post('/:id/convert', async (req: AuthedRequest, res: Response) => {
+    const body = parseBody(res, ChangeRequestConvertRequest, req.body);
+    if (!body) return;
+    const result = await convertChangeRequest(actorOf(req), req.params.id as string, body.jobId);
+    if (result.status === 'not-found') return notFound(res);
+    res.json(result.request);
+  });
+
+  r.post('/:id/dismiss', async (req: AuthedRequest, res: Response) => {
+    const result = await dismissChangeRequest(actorOf(req), req.params.id as string);
+    if (result.status === 'not-found') return notFound(res);
+    res.json(result.request);
+  });
+
+  return r;
+}
diff --git a/api/src/server.ts b/api/src/server.ts
index 456afa1..6ed3627 100644
--- a/api/src/server.ts
+++ b/api/src/server.ts
@@ -31,6 +31,7 @@ import { settingsRouter } from './routes/settings.js';
 import { sessionsRouter } from './routes/sessions.js';
 import { memoriesRouter } from './routes/memories.js';
 import { registoRouter } from './routes/registo.js';
+import { changeRequestsRouter } from './routes/change-requests.js';
 import { billingRouter } from './routes/billing.js';
 import { credentialsRouter } from './routes/credentials.js';
 import { llmHealth, registerGateway, loadCredential, setRulesetResolver } from './llm/index.js';
@@ -564,6 +565,7 @@ export function buildApp(config: Config, deps: RuntimeDeps = defaultDeps): Expre
   app.use('/api/v1/sessions', sessionsRouter(deps));
   app.use('/api/v1/memories', memoriesRouter(deps));
   app.use('/api/v1/registo', registoRouter(deps));
+  app.use('/api/v1/change-requests', changeRequestsRouter(deps));
   app.use('/api/v1/billing', billingRouter(deps));
   // F2 — model-credential provisioning (super-admin, write-only, audit-logged; ch06 §6.2).
   app.use('/api/v1/credentials', credentialsRouter(deps));
diff --git a/api/tests/apps/change-request.test.ts b/api/tests/apps/change-request.test.ts
new file mode 100644
index 0000000..e621654
--- /dev/null
+++ b/api/tests/apps/change-request.test.ts
@@ -0,0 +1,123 @@
+import { describe, it, expect, beforeAll } from 'vitest';
+import { readFileSync } from 'node:fs';
+import { fileURLToPath } from 'node:url';
+
+/**
+ * H4 change request (non-admins) - BEHAVIOURAL unit tests of the panel's file-request controller
+ * (api/assets/panel-runtime/src/change-request.js) + SOURCE-contract pins on AssistantPanel.jsx.
+ *
+ * The controller is a browser ASSET compiled by esbuild (outside the tsc program), so it is
+ * imported at RUNTIME via its file URL and driven with a FAKE fetch - proving the real network
+ * flow: the filing POSTs the thin platform endpoint `/api/v1/change-requests` with the served-app
+ * `X-Ekoa-App-Id` header + the platform Bearer, and REQUIRES a logged-in user (no token / a 401
+ * both resolve to the calm `needs-login` outcome the panel renders as "inicie sessão"). This is a
+ * SEPARATE plane from the visitor-blind POST /api/app-assistant, which stays untouched.
+ */
+
+type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };
+type FetchImpl = (url: string, init?: FetchInit) => Promise<unknown>;
+interface ChangeRequestApi {
+  CHANGE_REQUESTS_ENDPOINT: string;
+  REQUEST_COPY: Record<string, string>;
+  fileChangeRequest(a: { fetchImpl: FetchImpl; appId?: string; token?: string; text: string; route?: string; screenState?: string }): Promise<{ outcome: string; status?: number; request?: unknown }>;
+}
+
+const MODULE_URL = new URL('../../assets/panel-runtime/src/change-request.js', import.meta.url);
+const MODULE_SRC = readFileSync(fileURLToPath(MODULE_URL), 'utf-8');
+const PANEL_URL = new URL('../../assets/panel-runtime/src/AssistantPanel.jsx', import.meta.url);
+const PANEL_SRC = readFileSync(fileURLToPath(PANEL_URL), 'utf-8');
+
+let cr: ChangeRequestApi;
+beforeAll(async () => {
+  cr = (await import(/* @vite-ignore */ MODULE_URL.href)) as unknown as ChangeRequestApi;
+});
+
+interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
+function jsonRes(status: number, data: unknown) {
+  return { ok: status >= 200 && status < 300, status, json: async () => data };
+}
+/** A fetch that records every call and answers the change-requests endpoint per the scenario. */
+function scenario(opts: { status?: number; data?: unknown; throwErr?: boolean }) {
+  const calls: Recorded[] = [];
+  const fetchImpl: FetchImpl = async (url, init = {}) => {
+    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
+    if (opts.throwErr) throw new Error('network down');
+    return jsonRes(opts.status ?? 200, opts.data ?? { id: 'c1', orgId: 'orgB', requesterUserId: 'u', requesterName: 'u', text: 't', status: 'open', createdAt: '2026-07-13T00:00:00.000Z' });
+  };
+  return { fetchImpl, calls };
+}
+
+describe('H4 change-request controller: fileChangeRequest (fake fetch)', () => {
+  it('files with the served-app header + Bearer, capturing route + screen; 2xx -> filed', async () => {
+    const s = scenario({ status: 200 });
+    const res = await cr.fileChangeRequest({ fetchImpl: s.fetchImpl, appId: 'appX', token: 'tok', text: '  Adicione um botão  ', route: '/faturas', screenState: 'Tabela de honorários' });
+    expect(res.outcome).toBe('filed');
+    expect(s.calls.length).toBe(1);
+    const call = s.calls[0]!;
+    expect(call.url).toBe(cr.CHANGE_REQUESTS_ENDPOINT);
+    expect(call.url).toBe('/api/v1/change-requests');
+    expect(call.method).toBe('POST');
+    expect(call.headers['X-Ekoa-App-Id']).toBe('appX');
+    expect(call.headers.Authorization).toBe('Bearer tok');
+    const body = JSON.parse(call.body || '{}') as { text: string; route?: string; screenState?: string };
+    expect(body.text).toBe('Adicione um botão'); // trimmed
+    expect(body.route).toBe('/faturas');
+    expect(body.screenState).toBe('Tabela de honorários');
+  });
+
+  it('no token -> needs-login BEFORE any call (filing requires a session)', async () => {
+    const s = scenario({ status: 200 });
+    const res = await cr.fileChangeRequest({ fetchImpl: s.fetchImpl, appId: 'appX', token: '', text: 'olá' });
+    expect(res.outcome).toBe('needs-login');
+    expect(s.calls.length).toBe(0);
+  });
+
+  it('a 401 -> needs-login (the calm "inicie sessão" note)', async () => {
+    const s = scenario({ status: 401, data: { error: { code: 'UNAUTHENTICATED', message: 'x' } } });
+    const res = await cr.fileChangeRequest({ fetchImpl: s.fetchImpl, appId: 'appX', token: 'expired', text: 'olá' });
+    expect(res.outcome).toBe('needs-login');
+  });
+
+  it('no app id -> failed (nothing to scope to); empty text -> failed; a network throw -> failed', async () => {
+    const s1 = scenario({ status: 200 });
+    expect((await cr.fileChangeRequest({ fetchImpl: s1.fetchImpl, appId: '', token: 'tok', text: 'olá' })).outcome).toBe('failed');
+    expect(s1.calls.length).toBe(0);
+    const s2 = scenario({ status: 200 });
+    expect((await cr.fileChangeRequest({ fetchImpl: s2.fetchImpl, appId: 'appX', token: 'tok', text: '   ' })).outcome).toBe('failed');
+    const s3 = scenario({ throwErr: true });
+    expect((await cr.fileChangeRequest({ fetchImpl: s3.fetchImpl, appId: 'appX', token: 'tok', text: 'olá' })).outcome).toBe('failed');
+  });
+
+  it('a 403/500 -> failed carrying the status', async () => {
+    const s = scenario({ status: 403, data: { error: { code: 'FORBIDDEN', message: 'x' } } });
+    const res = await cr.fileChangeRequest({ fetchImpl: s.fetchImpl, appId: 'appX', token: 'tok', text: 'olá' });
+    expect(res.outcome).toBe('failed');
+    expect(res.status).toBe(403);
+  });
+
+  it('the needs-login copy is the calm PT-PT login line; the controller carries no emoji', () => {
+    expect((cr.REQUEST_COPY.needsLogin ?? '').toLowerCase()).toContain('inicie sessão');
+    expect(MODULE_SRC.match(/\p{Extended_Pictographic}/u)).toBeNull();
+    // A separate plane: the controller targets the platform queue endpoint, never the visitor assistant.
+    expect(MODULE_SRC).toContain('/api/v1/change-requests');
+    expect(MODULE_SRC).not.toContain('/api/app-assistant');
+  });
+});
+
+describe('H4 change-request panel: source-contract pins (AssistantPanel.jsx)', () => {
+  it('the "Pedir alteração" affordance is gated by admin === false (non-admins only)', () => {
+    // The request section renders only when !admin (an admin uses edit mode instead).
+    expect(PANEL_SRC).toMatch(/\{!admin \?[\s\S]*ekoa-assistant-request/);
+    // The button is present in the idle phase.
+    expect(PANEL_SRC).toContain('ekoa-assistant-request-open');
+  });
+
+  it('submit captures the current route + screen and files via the change-request controller', () => {
+    expect(PANEL_SRC).toMatch(/from '\.\/change-request'/);
+    // submitRequest passes the captured route + screen context to the controller.
+    expect(PANEL_SRC).toMatch(/fileChangeRequest\(\{[\s\S]*route: currentRoute\(\)[\s\S]*screenState: captureScreenState\(\)/);
+    // The three outcomes map to the calm notes (filed / needs-login / failed).
+    expect(PANEL_SRC).toContain("result.outcome === 'filed'");
+    expect(PANEL_SRC).toContain("result.outcome === 'needs-login'");
+  });
+});
diff --git a/api/tests/contract/change-requests.test.ts b/api/tests/contract/change-requests.test.ts
new file mode 100644
index 0000000..3e358c5
--- /dev/null
+++ b/api/tests/contract/change-requests.test.ts
@@ -0,0 +1,95 @@
+import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
+import type { Server } from 'node:http';
+import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
+import { connectMongo, closeMongo } from '../../src/data/mongo.js';
+import { users, userSettings, changeRequests, artifacts } from '../../src/data/stores.js';
+import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
+import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
+import { login } from '../../src/auth/service.js';
+import { hashPassword } from '../../src/auth/password.js';
+import { buildApp } from '../../src/server.js';
+import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
+import {
+  ChangeRequest,
+  ChangeRequestFileRequest,
+  ChangeRequestConvertRequest,
+  ChangeRequestListResponse,
+  changeRequestsEndpoints,
+} from '@ekoa/shared';
+
+/**
+ * H4 change-requests CONTRACT test: the wire SHAPES + descriptor declarations, and that the real
+ * file/list/convert responses validate against the shared schemas (a new endpoint => a new
+ * contract test, same slice). Behaviour/isolation lives in tests/routes/change-requests.test.ts.
+ */
+let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
+const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
+const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
+const authed = (p: string, t: string, init: RequestInit = {}) =>
+  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
+const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
+const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
+
+beforeAll(async () => {
+  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
+  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests_contract');
+  const app = buildApp(cfg, deps);
+  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
+  port = (server.address() as { port: number }).port;
+}, 60_000);
+afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
+beforeEach(async () => {
+  __resetActivationForTests(); __resetRevocationsForTests();
+  await users.deleteMany({}); await changeRequests.deleteMany({}); await artifacts.deleteMany({}); await userSettings.deleteMany({});
+  for (const [id, role, org] of [['usr', 'user', 'orgA'], ['adm', 'org-admin', 'orgA']] as const) {
+    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
+    setActivation(id, { active: true, billingLocked: false });
+    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
+  }
+  await artifacts.insert({ _id: 'appA', name: 'App A', userId: 'adm', orgId: 'orgA', visibility: 'org', status: 'active', data: { projectDir: '/sbx/user-adm/appA' } } as never);
+});
+
+describe('H4 change-requests contract: schema shapes', () => {
+  it('ChangeRequest parses a full doc AND a minimal doc; rejects extra keys and a bad status', () => {
+    const full = { id: 'c1', appId: 'appA', orgId: 'orgA', requesterUserId: 'usr', requesterName: 'usr', route: '/x', screenState: 's', text: 't', status: 'converted', createdAt: '2026-07-13T00:00:00.000Z', jobId: 'j1' };
+    expect(ChangeRequest.safeParse(full).success).toBe(true);
+    const minimal = { id: 'c2', orgId: 'orgA', requesterUserId: 'usr', requesterName: 'usr', text: 't', status: 'open', createdAt: '2026-07-13T00:00:00.000Z' };
+    expect(ChangeRequest.safeParse(minimal).success).toBe(true);
+    expect(ChangeRequest.safeParse({ ...minimal, bogus: 1 }).success).toBe(false); // .strict()
+    expect(ChangeRequest.safeParse({ ...minimal, status: 'weird' }).success).toBe(false);
+  });
+
+  it('the file body requires non-empty bounded text; convert requires a jobId', () => {
+    expect(ChangeRequestFileRequest.safeParse({ text: 'olá', route: '/x' }).success).toBe(true);
+    expect(ChangeRequestFileRequest.safeParse({ text: '' }).success).toBe(false);
+    expect(ChangeRequestFileRequest.safeParse({ text: 'x'.repeat(4001) }).success).toBe(false);
+    expect(ChangeRequestConvertRequest.safeParse({ jobId: 'j' }).success).toBe(true);
+    expect(ChangeRequestConvertRequest.safeParse({}).success).toBe(false);
+  });
+
+  it('the descriptors declare the right auth classes (file user; queue org-admin)', () => {
+    expect(changeRequestsEndpoints.file.auth).toBe('user');
+    expect(changeRequestsEndpoints.file.path).toBe('/api/v1/change-requests');
+    expect(changeRequestsEndpoints.list.auth).toBe('org-admin');
+    expect(changeRequestsEndpoints.convert.auth).toBe('org-admin');
+    expect(changeRequestsEndpoints.dismiss.auth).toBe('org-admin');
+  });
+});
+
+describe('H4 change-requests contract: live responses validate against the shared schemas', () => {
+  it('file -> ChangeRequest; list -> ChangeRequestListResponse; convert -> ChangeRequest', async () => {
+    const filed = await readJson(
+      await authed('/api/v1/change-requests', await tokenFor('usr'), { method: 'POST', headers: { 'x-ekoa-app-id': 'appA' }, body: JSON.stringify({ text: 'Mude o título', route: '/inicio' }) }),
+    );
+    expect(ChangeRequest.safeParse(filed).success, JSON.stringify(ChangeRequest.safeParse(filed))).toBe(true);
+
+    const list = await readJson(await authed('/api/v1/change-requests', await tokenFor('adm')));
+    expect(ChangeRequestListResponse.safeParse(list).success, JSON.stringify(ChangeRequestListResponse.safeParse(list))).toBe(true);
+
+    const conv = await readJson(
+      await authed(`/api/v1/change-requests/${filed.id as string}/convert`, await tokenFor('adm'), { method: 'POST', body: JSON.stringify({ jobId: 'job-1' }) }),
+    );
+    expect(ChangeRequest.safeParse(conv).success).toBe(true);
+    expect(conv.status).toBe('converted');
+  });
+});
diff --git a/api/tests/contract/schema-coverage.test.ts b/api/tests/contract/schema-coverage.test.ts
index d075972..8b19c58 100644
--- a/api/tests/contract/schema-coverage.test.ts
+++ b/api/tests/contract/schema-coverage.test.ts
@@ -90,6 +90,10 @@ const COVERED = new Set<string>([
   // the whoami route matrix in tests/apps/app-assistant.test.ts). Additive endpoint: covering it
   // keeps EXPECTED_PENDING_COUNT unchanged (assistantChat stays PENDING as before).
   'appAssistant.whoami',
+  // operator-run H4 — the request-changes queue (change-requests.test.ts contract +
+  // tests/routes/change-requests.test.ts integration). A NEW domain: covering all four keeps
+  // EXPECTED_PENDING_COUNT unchanged.
+  'changeRequests.file', 'changeRequests.list', 'changeRequests.convert', 'changeRequests.dismiss',
 ]);
 
 // Not-yet-landed endpoints (committed allowlist; SHRINKS each gate, EMPTY at G9). Computed as
diff --git a/api/tests/routes/change-requests.test.ts b/api/tests/routes/change-requests.test.ts
new file mode 100644
index 0000000..38771ae
--- /dev/null
+++ b/api/tests/routes/change-requests.test.ts
@@ -0,0 +1,166 @@
+import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
+import type { Server } from 'node:http';
+import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
+import { connectMongo, closeMongo } from '../../src/data/mongo.js';
+import { users, userSettings, changeRequests, artifacts } from '../../src/data/stores.js';
+import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
+import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
+import { login } from '../../src/auth/service.js';
+import { hashPassword } from '../../src/auth/password.js';
+import { buildApp } from '../../src/server.js';
+import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
+import { ChangeRequest, ChangeRequestListResponse, ErrorEnvelope } from '@ekoa/shared';
+
+/**
+ * Operator-run H4 — the request-changes queue, driven through the REAL router (mongo-mem).
+ *
+ * The security crux is CROSS-ORG ISOLATION: a served-app filing lands in the app OWNER's org
+ * queue (never the requester's), an org-admin reads/acts on ONLY its own org, and a plain user
+ * cannot read the queue at all. requesterUserId + orgId are always server-stamped, never trusted
+ * from the caller body. The refused-build feed files to the requester's OWN org (no served app).
+ *
+ * Topology: reqU (plain user, orgA) is the filer; appX is an ORG app OWNED by admB in orgB. So a
+ * filing about appX must surface to admB (orgB), NOT to admA (orgA) — proving both the owner-org
+ * routing and the isolation boundary in one shape.
+ */
+let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
+const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
+const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
+
+const authed = (p: string, t: string, init: RequestInit = {}) =>
+  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
+const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
+const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
+const fileWithApp = (t: string, appId: string, body: Record<string, unknown>) =>
+  authed('/api/v1/change-requests', t, { method: 'POST', headers: { 'x-ekoa-app-id': appId }, body: JSON.stringify(body) });
+
+beforeAll(async () => {
+  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
+  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
+  const app = buildApp(cfg, deps);
+  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
+  port = (server.address() as { port: number }).port;
+}, 60_000);
+afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
+
+beforeEach(async () => {
+  __resetActivationForTests(); __resetRevocationsForTests();
+  await users.deleteMany({}); await changeRequests.deleteMany({}); await artifacts.deleteMany({}); await userSettings.deleteMany({});
+  for (const [id, role, org] of [['reqU', 'user', 'orgA'], ['admA', 'org-admin', 'orgA'], ['admB', 'org-admin', 'orgB']] as const) {
+    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
+    setActivation(id, { active: true, billingLocked: false });
+    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
+  }
+  // An ORG app owned by admB in orgB (org-shared so an org-admin can loadWritable it later).
+  await artifacts.insert({ _id: 'appX', name: 'App X', slug: 'app-x', userId: 'admB', orgId: 'orgB', visibility: 'org', status: 'active', data: { projectDir: '/sbx/user-admB/appX' } } as never);
+});
+
+describe('H4 change-requests: file (served-app) lands in the OWNER org queue', () => {
+  it('a plain user files via X-Ekoa-App-Id -> the request lands in the app owner org, server-stamped', async () => {
+    const res = await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'Adicione um botão de exportação na tabela', route: '/faturas' });
+    expect(res.status).toBe(200);
+    const body = await readJson(res);
+    expect(ChangeRequest.safeParse(body).success, JSON.stringify(ChangeRequest.safeParse(body))).toBe(true);
+    expect(body.orgId).toBe('orgB');           // the OWNER org, NOT the requester's orgA
+    expect(body.requesterUserId).toBe('reqU'); // from the verified JWT, never the body
+    expect(body.requesterName).toBe('reqU');
+    expect(body.appId).toBe('appX');
+    expect(body.status).toBe('open');
+    expect(body.route).toBe('/faturas');
+  });
+
+  it('an unknown app id is a 404 (shared error envelope), never a silent misfile', async () => {
+    const res = await fileWithApp(await tokenFor('reqU'), 'no-such-app', { text: 'Olá' });
+    expect(res.status).toBe(404);
+    const body = await readJson(res);
+    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
+    expect((body.error as { code: string }).code).toBe('NOT_FOUND');
+  });
+});
+
+describe('H4 change-requests: the org-admin queue read is org-scoped (cross-org isolation)', () => {
+  it('an org-admin sees its OWN org only; another org-admin never sees it', async () => {
+    await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido 1' }); // -> orgB
+
+    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
+    expect(ChangeRequestListResponse.safeParse(admBList).success).toBe(true);
+    const bItems = admBList.items as Array<Record<string, unknown>>;
+    expect(bItems.length).toBe(1);
+    expect(bItems.every((r) => r.orgId === 'orgB')).toBe(true);
+
+    // admA is in orgA — the crux: it MUST NOT see orgB's request.
+    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
+    const aItems = admAList.items as Array<Record<string, unknown>>;
+    expect(admAList.total).toBe(0);
+    expect(aItems.some((r) => r.requesterUserId === 'reqU')).toBe(false);
+    expect(aItems.every((r) => r.orgId === 'orgA')).toBe(true);
+  });
+
+  it('a plain user cannot read the queue -> 403 FORBIDDEN (shared envelope)', async () => {
+    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'));
+    expect(res.status).toBe(403);
+    const body = await readJson(res);
+    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
+    expect((body.error as { code: string }).code).toBe('FORBIDDEN');
+  });
+
+  it('a super-admin can narrow across orgs with ?orgId=', async () => {
+    await users.insert({ _id: 'root', username: 'root', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'orgRoot', active: true });
+    setActivation('root', { active: true, billingLocked: false });
+    await userSettings.put({ _id: 'root', memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
+    await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido super' }); // -> orgB
+
+    const all = await readJson(await authed('/api/v1/change-requests', await tokenFor('root')));
+    expect((all.items as unknown[]).length).toBe(1);
+    const scoped = await readJson(await authed('/api/v1/change-requests?orgId=orgA', await tokenFor('root')));
+    expect((scoped.items as unknown[]).length).toBe(0); // no orgA requests exist
+  });
+});
+
+describe('H4 change-requests: convert / dismiss are org-scoped', () => {
+  it('convert flips status to converted + links the jobId; a cross-org convert is a uniform 404', async () => {
+    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'Adicione um campo de data' }));
+    const id = filed.id as string;
+
+    // admA (orgA) must NOT be able to convert orgB's request — uniform 404, no cross-org oracle.
+    const cross = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admA'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
+    expect(cross.status).toBe(404);
+    expect((await readJson(cross)).error).toBeTruthy();
+
+    // admB (owner org) converts, linking the follow-up-build job the dashboard already started.
+    const conv = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admB'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
+    expect(conv.status).toBe(200);
+    const cbody = await readJson(conv);
+    expect(ChangeRequest.safeParse(cbody).success).toBe(true);
+    expect(cbody.status).toBe('converted');
+    expect(cbody.jobId).toBe('job-xyz');
+  });
+
+  it('dismiss flips status to dismissed (own org)', async () => {
+    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido a dispensar' }));
+    const id = filed.id as string;
+    const res = await authed(`/api/v1/change-requests/${id}/dismiss`, await tokenFor('admB'), { method: 'POST' });
+    expect(res.status).toBe(200);
+    expect((await readJson(res)).status).toBe('dismissed');
+  });
+});
+
+describe('H4 change-requests: the refused-build feed files to the requester OWN org', () => {
+  it('filing WITHOUT the served-app header lands in the requester own org (never a dead end)', async () => {
+    // No X-Ekoa-App-Id header: the dashboard refused-build path. orgId is the requester's OWN org
+    // (orgA), the body appId is kept only as an informational label.
+    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'), { method: 'POST', body: JSON.stringify({ text: 'Não consegui construir; peço ao administrador.', appId: 'appX' }) });
+    expect(res.status).toBe(200);
+    const body = await readJson(res);
+    expect(ChangeRequest.safeParse(body).success).toBe(true);
+    expect(body.orgId).toBe('orgA');           // the REQUESTER's own org
+    expect(body.requesterUserId).toBe('reqU');
+    expect(body.appId).toBe('appX');           // informational label; convert re-gates via H1
+
+    // It surfaces to admA (orgA), and NOT to admB (orgB) — isolation holds on this path too.
+    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
+    expect((admAList.items as Array<Record<string, unknown>>).some((r) => r.requesterUserId === 'reqU')).toBe(true);
+    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
+    expect((admBList.items as Array<Record<string, unknown>>).some((r) => r.text === 'Não consegui construir; peço ao administrador.')).toBe(false);
+  });
+});
diff --git a/shared/src/change-request.ts b/shared/src/change-request.ts
new file mode 100644
index 0000000..08016fe
--- /dev/null
+++ b/shared/src/change-request.ts
@@ -0,0 +1,115 @@
+/**
+ * Change-requests domain contract (operator-run H4; BRIEF Phase 9d). GREENFIELD — the
+ * request-changes queue: a user files a change request from INSIDE a served app; the app
+ * OWNER's org-admins see it in a dashboard queue and convert one into a patch run (a
+ * follow-up build). Additive only.
+ *
+ * The security crux is CROSS-ORG ISOLATION: a `ChangeRequest.orgId` is stamped SERVER-SIDE
+ * (never from the caller's body) — the app OWNER's org for a served-app filing, the
+ * requester's OWN org for a dashboard refused-build filing. `GET /api/v1/change-requests`
+ * returns ONLY the caller-org's requests for an org-admin (super-admin across orgs), mirroring
+ * registo.ts exactly. An org-admin MUST NEVER see another org's requests.
+ */
+import { z } from 'zod';
+import { Id, IsoTimestamp, listResponse } from './common.js';
+import type { DomainDescriptorMap } from './descriptor.js';
+
+/** The lifecycle of a queued request: open (awaiting an admin), converted (an admin started a
+ *  patch run — carries the resulting jobId), dismissed (an admin declined it). */
+export const ChangeRequestStatus = z.enum(['open', 'converted', 'dismissed']);
+export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatus>;
+
+/**
+ * A single change request. `appId`/`route`/`screenState` are OPTIONAL because the refused-build
+ * feed (a dashboard first-build refusal) has no served app or screen yet — the panel filing
+ * always carries them. `orgId`/`requesterUserId`/`requesterName` are server-stamped. `jobId` is
+ * set only once an admin converts it (the follow-up build the convert started).
+ */
+export const ChangeRequest = z
+  .object({
+    id: Id,
+    /** The served app the request is about (absent for a dashboard first-build refusal). */
+    appId: Id.optional(),
+    /** The OWNER org (served-app filing) or the requester's own org (refused-build filing).
+     *  Always server-resolved — this is the cross-org isolation boundary. */
+    orgId: Id,
+    requesterUserId: Id,
+    requesterName: z.string(),
+    /** The served-app route/screen the request was filed from (best-effort, panel-captured). */
+    route: z.string().optional(),
+    /** A short captured screen-context descriptor (panel-captured; org-internal, never egressed). */
+    screenState: z.string().optional(),
+    text: z.string(),
+    status: ChangeRequestStatus,
+    createdAt: IsoTimestamp,
+    /** The patch-run job an admin's convert produced (present only when status === 'converted'). */
+    jobId: Id.optional(),
+  })
+  .strict();
+export type ChangeRequest = z.infer<typeof ChangeRequest>;
+
+/**
+ * The file-a-request body (`POST /api/v1/change-requests`). `text` is the only required field;
+ * `route`/`screenState` are the panel-captured context. `appId` is honoured ONLY on the
+ * dashboard (no `X-Ekoa-App-Id` header) path — for a served-app filing the header resolves the
+ * app + owner org server-side and any body `appId` is ignored (never trusted for org routing).
+ */
+export const ChangeRequestFileRequest = z.object({
+  text: z.string().min(1).max(4000),
+  route: z.string().max(1000).optional(),
+  screenState: z.string().max(8000).optional(),
+  appId: Id.optional(),
+});
+export type ChangeRequestFileRequest = z.infer<typeof ChangeRequestFileRequest>;
+
+/** Convert body: the jobId of the follow-up build the dashboard already started (H1-gated). */
+export const ChangeRequestConvertRequest = z.object({ jobId: Id });
+export type ChangeRequestConvertRequest = z.infer<typeof ChangeRequestConvertRequest>;
+
+/** Queue read query. `status` narrows the list; `orgId` is honoured only for a super-admin
+ *  (an org-admin is always pinned to its own org server-side — the isolation boundary). */
+export const ChangeRequestQuery = z.object({
+  status: ChangeRequestStatus.optional(),
+  orgId: Id.optional(),
+  limit: z.coerce.number().int().positive().max(500).optional(),
+  offset: z.coerce.number().int().nonnegative().optional(),
+});
+export type ChangeRequestQuery = z.infer<typeof ChangeRequestQuery>;
+
+export const ChangeRequestListResponse = listResponse(ChangeRequest);
+export type ChangeRequestListResponse = z.infer<typeof ChangeRequestListResponse>;
+
+export const changeRequestsEndpoints = {
+  // File a request from inside a served app (X-Ekoa-App-Id resolves app+owner org) OR from the
+  // dashboard refused-build feed (own org). Requires a logged-in platform user (auth 'user').
+  file: {
+    method: 'POST',
+    path: '/api/v1/change-requests',
+    auth: 'user',
+    request: ChangeRequestFileRequest,
+    response: ChangeRequest,
+  },
+  // The org-admin queue read. org-admin sees own org; super-admin across orgs (mirrors registo).
+  list: {
+    method: 'GET',
+    path: '/api/v1/change-requests',
+    auth: 'org-admin',
+    query: ChangeRequestQuery,
+    response: ChangeRequestListResponse,
+  },
+  // Mark a request converted (the dashboard already POSTed /jobs; this links the resulting jobId).
+  convert: {
+    method: 'POST',
+    path: '/api/v1/change-requests/:id/convert',
+    auth: 'org-admin',
+    request: ChangeRequestConvertRequest,
+    response: ChangeRequest,
+  },
+  // Decline a request (status -> dismissed). org-admin own org; super-admin across orgs.
+  dismiss: {
+    method: 'POST',
+    path: '/api/v1/change-requests/:id/dismiss',
+    auth: 'org-admin',
+    response: ChangeRequest,
+  },
+} as const satisfies DomainDescriptorMap;
diff --git a/shared/src/events.ts b/shared/src/events.ts
index 79e8f2d..f47f4bf 100644
--- a/shared/src/events.ts
+++ b/shared/src/events.ts
@@ -188,6 +188,10 @@ export const NotificationEvent = z.discriminatedUnion('type', [
   z.object({ type: z.literal('integration_build_intent'), sessionId: z.string(), hint: z.string().optional() }),
   z.object({ type: z.literal('integration_ready'), integrationKey: z.string() }),
   z.object({ type: z.literal('usage_updated') }),
+  // A user filed a change request against an app this org-admin oversees (operator-run H4):
+  // the live push into the org-admin's per-user notifications channel telling the dashboard
+  // queue to refetch. `appId` is the served app it concerns (absent for a refused-build filing).
+  z.object({ type: z.literal('change_request'), appId: z.string().optional() }),
   // Org branding changed (brand research applied) - clients refetch the company/branding
   // config so the header logo + theme update live instead of waiting for a page reload.
   z.object({ type: z.literal('branding_updated') }),
diff --git a/shared/src/index.ts b/shared/src/index.ts
index 7ecbc55..f02558d 100644
--- a/shared/src/index.ts
+++ b/shared/src/index.ts
@@ -25,6 +25,7 @@ import { billingEndpoints } from './billing.js';
 import { credentialsEndpoints } from './credentials.js';
 import { uploadsEndpoints } from './uploads.js';
 import { registoEndpoints } from './registo.js';
+import { changeRequestsEndpoints } from './change-request.js';
 import { appAssistantEndpoints } from './app-assistant.js';
 import { servedAppEndpoints } from './served-app.js';
 import { ekoaLocalEndpoints } from './ekoa-local.js';
@@ -55,6 +56,7 @@ export * from './billing.js';
 export * from './credentials.js';
 export * from './uploads.js';
 export * from './registo.js';
+export * from './change-request.js';
 export * from './capabilities.js';
 export * from './action-manifest.js';
 export * from './artifact-type.js';
@@ -87,6 +89,7 @@ export const ALL_ENDPOINTS: Record<string, DomainDescriptorMap> = {
   credentials: credentialsEndpoints,
   uploads: uploadsEndpoints,
   registo: registoEndpoints,
+  changeRequests: changeRequestsEndpoints,
   appAssistant: appAssistantEndpoints,
   servedApp: servedAppEndpoints,
   ekoaLocal: ekoaLocalEndpoints,
diff --git a/web/__tests__/navigation.test.ts b/web/__tests__/navigation.test.ts
index eec8da6..943e3e8 100644
--- a/web/__tests__/navigation.test.ts
+++ b/web/__tests__/navigation.test.ts
@@ -28,4 +28,13 @@ describe('lib/navigation NAV_ITEMS', () => {
     const users = NAV_ITEMS.find((i) => i.href === '/users');
     expect(users?.adminOnly).toBe(true);
   });
+
+  it('exposes the H4 change-requests queue as an admin-only surface (raw PT label, like registo)', () => {
+    const pedidos = NAV_ITEMS.find((i) => i.href === '/pedidos');
+    expect(pedidos).toBeTruthy();
+    expect(pedidos?.adminOnly).toBe(true);
+    expect(pedidos?.superAdminOnly).toBeFalsy(); // org-admin AND super-admin, like registo
+    expect(pedidos?.label).toBe('Pedidos');
+    expect(pedidos?.icon).toBeTruthy();
+  });
 });
diff --git a/web/app/(dashboard)/pedidos/page.tsx b/web/app/(dashboard)/pedidos/page.tsx
new file mode 100644
index 0000000..10ed06d
--- /dev/null
+++ b/web/app/(dashboard)/pedidos/page.tsx
@@ -0,0 +1,244 @@
+"use client";
+
+/**
+ * Pedidos (change-requests queue) admin page (operator-run H4).
+ *
+ * The org-admin's queue over `GET /api/v1/change-requests`: change requests users filed from
+ * inside a served app (or from a refused build). An org-admin sees its OWN org; a super-admin
+ * gets an org filter (`?orgId=`) across orgs - the EXACT registo scoping. "Converter" starts a
+ * patch run (an H1-gated follow-up build) and marks the request converted; "Dispensar" declines
+ * it. A live `change_request` notification refetches the queue so a new request appears without a
+ * reload. PT-PT strings.
+ *
+ * Admin-gated (org-admin + super-admin); reachable from the sidebar.
+ */
+
+import { useEffect } from "react";
+import { Inbox, AlertTriangle } from "lucide-react";
+import { useAuthStore } from "@/stores/auth";
+import { useOrgsStore } from "@/stores/orgs";
+import { useChangeRequestsStore } from "@/stores/change-requests";
+import { openNotificationsStream } from "@/lib/api";
+import { AdminGate } from "@/components/admin-gate";
+import { PageShell } from "@/components/ui/page-shell";
+import { PageHeader } from "@/components/ui/page-header";
+import { Card } from "@/components/ui/card";
+import { Button } from "@/components/ui/button";
+import { Badge, type BadgeTone } from "@/components/ui/badge";
+import { Select } from "@/components/ui/select";
+import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
+import { LoadingState } from "@/components/ui/spinner";
+import { EmptyState } from "@/components/ui/empty-state";
+import type { ChangeRequestStatus } from "@ekoa/shared";
+
+function formatTimestamp(iso: string): string {
+  try {
+    return new Date(iso).toLocaleString("pt-PT");
+  } catch {
+    return iso;
+  }
+}
+
+const STATUS_LABEL: Record<ChangeRequestStatus, string> = {
+  open: "Aberto",
+  converted: "Convertido",
+  dismissed: "Dispensado",
+};
+const STATUS_TONE: Record<ChangeRequestStatus, BadgeTone> = {
+  open: "warning",
+  converted: "success",
+  dismissed: "neutral",
+};
+
+export default function PedidosPage() {
+  const role = useAuthStore((s) => s.user?.role ?? null);
+  const isSuperAdmin = role === "super-admin";
+
+  const requests = useChangeRequestsStore((s) => s.requests);
+  const total = useChangeRequestsStore((s) => s.total);
+  const statusFilter = useChangeRequestsStore((s) => s.statusFilter);
+  const orgId = useChangeRequestsStore((s) => s.orgId);
+  const isLoading = useChangeRequestsStore((s) => s.isLoading);
+  const actingId = useChangeRequestsStore((s) => s.actingId);
+  const error = useChangeRequestsStore((s) => s.error);
+  const fetchRequests = useChangeRequestsStore((s) => s.fetchRequests);
+  const setStatusFilter = useChangeRequestsStore((s) => s.setStatusFilter);
+  const setOrgId = useChangeRequestsStore((s) => s.setOrgId);
+  const convert = useChangeRequestsStore((s) => s.convert);
+  const dismiss = useChangeRequestsStore((s) => s.dismiss);
+  const clearError = useChangeRequestsStore((s) => s.clearError);
+
+  const orgs = useOrgsStore((s) => s.orgs);
+  const fetchOrgs = useOrgsStore((s) => s.fetchOrgs);
+
+  useEffect(() => {
+    fetchRequests();
+  }, [fetchRequests]);
+
+  useEffect(() => {
+    if (isSuperAdmin) fetchOrgs();
+  }, [isSuperAdmin, fetchOrgs]);
+
+  // Live queue: a filed request pushes a `change_request` notification to this admin's channel;
+  // refetch so it appears without a reload (mirrors the header's usage/branding subscriptions).
+  useEffect(() => {
+    const stream = openNotificationsStream();
+    const off = stream.on("change_request", () => {
+      void useChangeRequestsStore.getState().fetchRequests();
+    });
+    return () => {
+      off();
+      stream.close();
+    };
+  }, []);
+
+  const orgNameById = new Map(orgs.map((o) => [o.id, o.displayName ?? o.name]));
+
+  return (
+    <AdminGate allowOrgAdmin>
+      <PageShell width="wide" testId="pedidos-page">
+        <PageHeader
+          icon={Inbox}
+          title="Pedidos"
+          description="Pedidos de alteração enviados pelos utilizadores a partir das aplicações. Converta um pedido numa revisão ou dispense-o."
+        />
+
+        {error && (
+          <Card className="flex items-center justify-between border-red-200 bg-red-50">
+            <div className="flex items-center space-x-2 text-red-600">
+              <AlertTriangle size={16} aria-hidden />
+              <span className="text-sm">{error}</span>
+            </div>
+            <Button
+              variant="danger-ghost"
+              size="sm"
+              onClick={() => {
+                clearError();
+                fetchRequests();
+              }}
+            >
+              Tentar novamente
+            </Button>
+          </Card>
+        )}
+
+        {/* Filters */}
+        <Card padding="sm">
+          <div className="flex flex-wrap items-end gap-3">
+            {isSuperAdmin && (
+              <div>
+                <label className="mb-1 block text-xs font-medium text-neutral-600">Escritório</label>
+                <Select
+                  value={orgId}
+                  onChange={(e) => setOrgId(e.target.value)}
+                  wrapperClassName="w-auto"
+                  className="py-1.5"
+                  data-testid="pedidos-filter-org"
+                >
+                  <option value="">Todos os escritórios</option>
+                  {orgs.map((org) => (
+                    <option key={org.id} value={org.id}>
+                      {org.displayName ?? org.name}
+                    </option>
+                  ))}
+                </Select>
+              </div>
+            )}
+
+            <div>
+              <label className="mb-1 block text-xs font-medium text-neutral-600">Estado</label>
+              <Select
+                value={statusFilter}
+                onChange={(e) => setStatusFilter(e.target.value as ChangeRequestStatus | "")}
+                wrapperClassName="w-auto"
+                className="py-1.5"
+                data-testid="pedidos-filter-status"
+              >
+                <option value="open">Abertos</option>
+                <option value="converted">Convertidos</option>
+                <option value="dismissed">Dispensados</option>
+                <option value="">Todos</option>
+              </Select>
+            </div>
+          </div>
+        </Card>
+
+        {/* Table */}
+        {isLoading && requests.length === 0 ? (
+          <LoadingState label="A carregar pedidos..." />
+        ) : requests.length === 0 ? (
+          <EmptyState icon={Inbox} title="Sem pedidos de alteração." />
+        ) : (
+          <section>
+            <div className="mb-3 flex items-center justify-between">
+              <h2 className="text-xs font-bold tracking-wider text-neutral-400">PEDIDOS</h2>
+              <span className="text-xs text-neutral-500">{total} pedidos</span>
+            </div>
+            <div className="overflow-x-auto">
+              <Table data-testid="pedidos-table">
+                <THead>
+                  <TR>
+                    <TH>Utilizador</TH>
+                    <TH>Pedido</TH>
+                    <TH>Aplicação</TH>
+                    {isSuperAdmin && <TH>Escritório</TH>}
+                    <TH>Data e hora</TH>
+                    <TH>Estado</TH>
+                    <TH>Ações</TH>
+                  </TR>
+                </THead>
+                <TBody>
+                  {requests.map((req) => (
+                    <TR key={req.id} hover>
+                      <TD className="text-sm font-medium text-neutral-800">{req.requesterName}</TD>
+                      <TD className="max-w-md text-sm text-neutral-700">
+                        <span className="line-clamp-3 whitespace-pre-wrap">{req.text}</span>
+                        {req.route ? (
+                          <span className="mt-1 block text-xs text-neutral-400">{req.route}</span>
+                        ) : null}
+                      </TD>
+                      <TD className="text-xs text-neutral-500">{req.appId ?? "-"}</TD>
+                      {isSuperAdmin && (
+                        <TD className="text-xs text-neutral-500">
+                          {orgNameById.get(req.orgId) ?? req.orgId}
+                        </TD>
+                      )}
+                      <TD className="text-xs text-neutral-500">{formatTimestamp(req.createdAt)}</TD>
+                      <TD>
+                        <Badge tone={STATUS_TONE[req.status]}>{STATUS_LABEL[req.status]}</Badge>
+                      </TD>
+                      <TD>
+                        {req.status === "open" ? (
+                          <div className="flex items-center gap-2">
+                            <Button
+                              variant="primary"
+                              size="sm"
+                              disabled={actingId === req.id}
+                              onClick={() => convert(req.id)}
+                            >
+                              Converter
+                            </Button>
+                            <Button
+                              variant="danger-ghost"
+                              size="sm"
+                              disabled={actingId === req.id}
+                              onClick={() => dismiss(req.id)}
+                            >
+                              Dispensar
+                            </Button>
+                          </div>
+                        ) : (
+                          <span className="text-xs text-neutral-400">-</span>
+                        )}
+                      </TD>
+                    </TR>
+                  ))}
+                </TBody>
+              </Table>
+            </div>
+          </section>
+        )}
+      </PageShell>
+    </AdminGate>
+  );
+}
diff --git a/web/lib/api/index.ts b/web/lib/api/index.ts
index cd9541a..6167072 100644
--- a/web/lib/api/index.ts
+++ b/web/lib/api/index.ts
@@ -44,6 +44,7 @@ import {
   billingEndpoints,
   uploadsEndpoints,
   registoEndpoints,
+  changeRequestsEndpoints,
   appAssistantEndpoints,
   servedAppEndpoints,
   ekoaLocalEndpoints,
@@ -100,8 +101,9 @@ export function createClient<T extends Record<string, DomainDescriptorMap>>(maps
 
 // -- The bound client -------------------------------------------------------------------
 //
-// Domain keys mirror ch03 / `shared` ALL_ENDPOINTS one to one (24 domains; no `teams` -
-// removed end to end, Amendment 2; `company` -> `org`, renamed resource). Written as an
+// Domain keys mirror ch03 / `shared` ALL_ENDPOINTS one to one (25 domains incl. H4
+// changeRequests; no `teams` - removed end to end, Amendment 2; `company` -> `org`, renamed
+// resource; `credentials` is api-only, not surfaced here). Written as an
 // object literal (not `ALL_ENDPOINTS`) so the DOMAIN keys stay literal and autocomplete.
 
 const domainMaps = {
@@ -125,6 +127,7 @@ const domainMaps = {
   billing: billingEndpoints,
   uploads: uploadsEndpoints,
   registo: registoEndpoints,
+  changeRequests: changeRequestsEndpoints,
   appAssistant: appAssistantEndpoints,
   servedApp: servedAppEndpoints,
   ekoaLocal: ekoaLocalEndpoints,
diff --git a/web/lib/navigation.ts b/web/lib/navigation.ts
index 7b4a739..aac390f 100644
--- a/web/lib/navigation.ts
+++ b/web/lib/navigation.ts
@@ -8,6 +8,7 @@ import {
   Palette,
   Users,
   ScrollText,
+  Inbox,
   Building2,
   ShieldCheck,
   Settings as SettingsIcon,
@@ -56,6 +57,8 @@ export const NAV_ITEMS: NavItem[] = [
   { href: "/users", icon: Users, labelKey: "users", adminOnly: true },
   // FC-502: the Registo admin read surface (metadata + artifacts only).
   { href: "/registo", icon: ScrollText, label: "Registo", adminOnly: true },
+  // H4: the request-changes queue (users' change requests; org-admin converts one to a patch run).
+  { href: "/pedidos", icon: Inbox, label: "Pedidos", adminOnly: true },
   // FC-501: super-admin org management.
   { href: "/orgs", icon: Building2, label: "Escritórios", superAdminOnly: true },
   // FC-404 (RESOLVED Q-07): the "Privacidade e ponte local" surface, absorbing the

exec
/bin/zsh -lc "codegraph explore 'changeRequestsRouter POST /api/v1/jobs loadWritable canEditApps actorOf requireRole /pedidos page contract schema coverage change-request tests two orgs'" in /Users/ggomes/dev/ekoa-code
 succeeded in 1006ms:
## Exploration: changeRequestsRouter POST /api/v1/jobs loadWritable canEditApps actorOf requireRole /pedidos page contract schema coverage change-request tests two orgs

Found 229 symbols across 85 files.

### Blast radius — what depends on these (update/verify before editing)

- `loadWritable` (api/src/apps/app-paths.ts:103) — 8 callers in `api/src/routes/artifacts.ts`, `api/src/apps/build-mechanics.ts`, `api/src/routes/jobs.ts`, `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `changeRequestsRouter` (api/src/routes/change-requests.ts:31) — 2 callers in `api/src/server.ts`; ⚠️ no covering tests found
- `requireRole` (api/src/auth/middleware.ts:76) — 19 callers in `api/src/routes/users.ts`, `api/src/routes/branding.ts`, `api/src/routes/credentials.ts`, `api/src/routes/integrations.ts` +5 more; ⚠️ no covering tests found
- `writable` (api/src/routes/artifacts.ts:66) — 1 caller in `api/src/routes/artifacts.ts`; ⚠️ no covering tests found
- `actorOf` (api/src/routes/helpers.ts:11) — 48 callers in `api/src/routes/settings.ts`, `api/src/routes/company-space.ts`, `api/src/routes/billing.ts`, `api/src/routes/pipedream.ts` +17 more; ⚠️ no covering tests found

### Relationships

**calls:**
- writable → loadWritable
- createBuildMechanics → loadWritable
- changeRequestsRouter → Router
- requireRole → fail
- requireRole → next
- finish → post
- fail → post
- startItem → post
- perform → post
- cancelById → post
- ... and 402 more

**references:**
- startObserver → scheduleTargetsScan
- fail → ErrorCode
- appFilesRouter → Router
- buildLinkRouter → Router
- devServeRouter → Router
- servedDataRouter → Router
- adobeSignRouter → Router
- appCloudFilesRouter → Router
- appSsoRouter → Router
- m365ProxyRouter → Router
- ... and 86 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/routes/helpers.ts — actorOf(function), notFound(function), sendError(function), parseBody(function)

```typescript
1	/**
2	 * Thin-route helpers (ch02 §2.6): actor extraction from the verified JWT, uniform error
3	 * shaping (CONV-2), and zod request validation. Routers do exactly three things: validate,
4	 * call one domain module, shape the response.
5	 */
6	import type { Response } from 'express';
7	import type { ZodTypeAny, infer as zInfer } from 'zod';
8	import { ERROR_STATUS, type ErrorCode, type Actor } from '@ekoa/shared';
9	import type { AuthedRequest } from '../auth/middleware.js';
10	
11	export function actorOf(req: AuthedRequest): Actor {
12	  const u = req.user!;
13	  return { userId: u.sub, orgId: u.orgId, role: u.role };
14	}
15	
16	export function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
17	  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
18	}
19	
20	export function notFound(res: Response): void {
21	  sendError(res, 'NOT_FOUND', 'Não encontrado.');
22	}
23	
24	/** Validate req.body against a schema; on failure send 400 and return undefined. */
25	export function parseBody<S extends ZodTypeAny>(res: Response, schema: S, body: unknown): zInfer<S> | undefined {
26	  const parsed = schema.safeParse(body);
27	  if (!parsed.success) {
28	    sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
29	    return undefined;
30	  }
31	  return parsed.data as zInfer<S>;
32	}
```

#### api/src/auth/middleware.ts — requireRole(function), AuthedRequest(interface), requireAuth(function), fail(function)

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

#### api/src/apps/app-paths.ts — loadWritable(function), OwnershipVerdict(type_alias), newProjectDir(function), projectDirFor(function), patchArtifactData(function), isAppArtifact(function), getArtifactById(function), setFeaturedFlag(function)

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

#### api/src/routes/change-requests.ts — changeRequestsRouter(function), change-requests.ts(file)

```typescript
1	/**
2	 * Change-requests router (operator-run H4; BRIEF Phase 9d). The request-changes queue.
3	 *
4	 * TWO planes on one resource:
5	 *  - FILE (POST /) — ANY logged-in platform user (auth 'user'), registered BEFORE the org-admin
6	 *    gate so a plain user can file (filing needs no capability; the queue READ is admin-gated).
7	 *    Scoped by the OPTIONAL `X-Ekoa-App-Id` header: present => a served-app filing (lands in the
8	 *    app OWNER's org queue); absent => a dashboard refused-build filing (lands in the requester's
9	 *    OWN org). requesterUserId + org come from the verified JWT / resolved owner, never the body.
10	 *  - QUEUE (GET /, POST /:id/convert, POST /:id/dismiss) — org-admin reads/acts on its OWN org,
11	 *    super-admin across orgs: the EXACT `requireRole('org-admin','super-admin')` gate registo.ts
12	 *    uses. Org SCOPE (the cross-org isolation crux) is enforced in the service.
13	 *
14	 * Routes stay thin (validate, call one domain module, shape) — like jobs.ts this one additionally
15	 * resolves the app (apps/registry) and fires the live SSE (agents/streaming); it never touches
16	 * data/ (the service owns store access, ch02 §2.7).
17	 */
18	import { Router, type Response } from 'express';
19	import { ChangeRequestFileRequest, ChangeRequestConvertRequest, type ChangeRequestStatus } from '@ekoa/shared';
20	import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
21	import { resolveApp } from '../apps/registry.js';
22	import { emitChangeRequest } from '../agents/streaming.js';
23	import {
24	  fileChangeRequest,
25	  readChangeRequests,
26	  convertChangeRequest,
27	  dismissChangeRequest,
28	} from '../services/change-requests.js';
29	import { actorOf, notFound, parseBody, sendError } from './helpers.js';
30	
31	export function changeRequestsRouter(deps: { now: () => number; genId: () => string }): Router {
32	  const r = Router();
33	
34	  // FILE a change request (any authenticated user). Registered BEFORE the org-admin gate below.
35	  r.post('/', requireAuth, async (req: AuthedRequest, res: Response) => {
36	    const body = parseBody(res, ChangeRequestFileRequest, req.body);
37	    if (!body) return;
38	    const requester = { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId };
39	
40	    // The OPTIONAL served-app header decides the target org. Present => resolve the app + its OWNER
41	    // (fail-closed: unknown / registry-only / ownerless id is a 404, exactly like the app-assistant
42	    // plane). Absent => the dashboard refused-build filing to the requester's own org (target null).
43	    let target: { ownerUserId: string; appId: string } | null = null;
44	    const header = req.header('x-ekoa-app-id');
45	    if (header !== undefined && header !== '') {
46	      const app = await resolveApp(header);
47	      if (!app || !app.artifactBacked || !app.ownerUserId) {
48	        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
49	      }
50	      target = { ownerUserId: app.ownerUserId, appId: app.appId };
51	    }
52	
53	    const { request, notifyUserIds } = await fileChangeRequest(requester, target, body, deps);
54	    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
55	    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
56	    res.json(request);
57	  });
58	
59	  // The org-admin queue (read + convert + dismiss). org-admin own org; super-admin across orgs.
60	  r.use(requireAuth, requireRole('org-admin', 'super-admin'));
61	
62	  r.get('/', async (req: AuthedRequest, res: Response) => {
63	    const q = req.query as { status?: string; orgId?: string; limit?: string; offset?: string };
64	    const result = await readChangeRequests(actorOf(req), {
65	      status: q.status as ChangeRequestStatus | undefined,
66	      orgId: q.orgId,
67	      limit: q.limit ? parseInt(q.limit, 10) : undefined,
68	      offset: q.offset ? parseInt(q.offset, 10) : undefined,
69	    });
70	    res.json(result);
71	  });
72	
73	  r.post('/:id/convert', async (req: AuthedRequest, res: Response) => {
74	    const body = parseBody(res, ChangeRequestConvertRequest, req.body);
75	    if (!body) return;
76	    const result = await convertChangeRequest(actorOf(req), req.params.id as string, body.jobId);
77	    if (result.status === 'not-found') return notFound(res);
78	    res.json(result.request);
79	  });
80	
81	  r.post('/:id/dismiss', async (req: AuthedRequest, res: Response) => {
82	    const result = await dismissChangeRequest(actorOf(req), req.params.id as string);
83	    if (result.status === 'not-found') return notFound(res);
84	    res.json(result.request);
85	  });
86	
87	  return r;
88	}
```

#### api/assets/demo-bridge-client.js — post(function), currentTargets(function), findTarget(function)

```javascript
54	
55	  // ---- messaging -------------------------------------------------------------
56	
57	  function post(type, payload) {
58	    if (!hostOrigin || typeof window.parent === 'undefined' || window.parent === window) return;
59	    var msg = { __ekoaDemo: 1, type: type };
60	    if (payload) {
61	      for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
62	    }
63	    try { window.parent.postMessage(msg, hostOrigin); } catch (_) { /* host gone */ }
64	  }
65	
66	  function currentTargets() {
67	    var out = [];
68	    var seen = Object.create(null);
69	    var nodes = document.querySelectorAll('[data-demo-target]');
70	    for (var i = 0; i < nodes.length; i++) {
71	      var name = nodes[i].getAttribute('data-demo-target');
72	      if (name && !seen[name]) { seen[name] = true; out.push(name); }
73	    }
74	    return out;
75	  }
76	
77	  function findTarget(name) {
78	    if (!name) return null;
79	    // A CSS-safe attribute selector; names are simple kebab identifiers.
80	    try {
81	      return document.querySelector('[data-demo-target="' + String(name).replace(/"/g, '\\"') + '"]');
82	    } catch (_) { return null; }
83	  }
84	
85	  // ---- spotlight / annotate overlay -----------------------------------------
86	
```

#### api/assets/action-runtime-client.js — post(function), clearHighlight(function), highlightTarget(function), clearHighlight(calls), calls(calls), clearHighlight(references)

```javascript
62	
63	  // ---- messaging -------------------------------------------------------------
64	
65	  function post(type, payload) {
66	    if (!hostOrigin || typeof window.parent === 'undefined' || window.parent === window) return;
67	    var msg = { __ekoaActions: 1, type: type };
68	    if (payload) {
69	      for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
70	    }
71	    try { window.parent.postMessage(msg, hostOrigin); } catch (_) { /* host gone */ }
72	  }
73	
74	  function currentTargets() {
75	    var out = [];

... (gap) ...

240	  var hlOverlay = null;
241	  var hlTimer = null;
242	
243	  function clearHighlight() {
244	    if (hlTimer) { window.clearTimeout(hlTimer); hlTimer = null; }
245	    if (hlOverlay) { hlOverlay.clear(); hlOverlay = null; }
246	  }
247	
248	  // Transient driving highlight around the element an action is driving.
249	  // Auto-clears after ~2.5s or on the next call.
250	  function highlightTarget(el) {
251	    clearHighlight();
252	    if (!el || !document.body) return;
253	    hlOverlay = buildRingOverlay(el, { uiKind: 'highlight' });
254	    hlTimer = window.setTimeout(clearHighlight, HIGHLIGHT_MS);
255	  }
256	
257	  // ---- same-document tour spotlight (E2) -------------------------------------
258	  // A PERSISTENT ring + copy tooltip the in-app tour player (assistant panel,
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The service and router look structurally aligned with the intended model. The remaining risk is whether the convert flow can be abused through a caller-chosen `jobId` or weak route/UI integration, and whether the tests genuinely cover two-org behavior.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,260p' web/stores/change-requests.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
'use client';

/**
 * Change-requests store (operator-run H4). The org-admin queue read + the two admin actions
 * (convert / dismiss), plus the refused-build feed's file action.
 *
 * `GET /api/v1/change-requests`: an org-admin sees its OWN org, a super-admin may pass `orgId`
 * to cross orgs (the exact registo scoping). "Converter" starts a patch run the way the panel's
 * edit mode does — a follow-up build via `POST /api/v1/jobs` (H1-gated: the org-admin has
 * canEditApps + loadWritable on an org app) — then marks the request converted with the job id.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
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
      set({ actingId: null, error: job.error.message || 'Não foi possível iniciar a alteração.' });
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

exec
/bin/zsh -lc "sed -n '1,260p' api/tests/routes/change-requests.test.ts" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,220p' api/tests/contract/change-requests.test.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, changeRequests, artifacts } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { ChangeRequest, ChangeRequestListResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * Operator-run H4 — the request-changes queue, driven through the REAL router (mongo-mem).
 *
 * The security crux is CROSS-ORG ISOLATION: a served-app filing lands in the app OWNER's org
 * queue (never the requester's), an org-admin reads/acts on ONLY its own org, and a plain user
 * cannot read the queue at all. requesterUserId + orgId are always server-stamped, never trusted
 * from the caller body. The refused-build feed files to the requester's OWN org (no served app).
 *
 * Topology: reqU (plain user, orgA) is the filer; appX is an ORG app OWNED by admB in orgB. So a
 * filing about appX must surface to admB (orgB), NOT to admA (orgA) — proving both the owner-org
 * routing and the isolation boundary in one shape.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const fileWithApp = (t: string, appId: string, body: Record<string, unknown>) =>
  authed('/api/v1/change-requests', t, { method: 'POST', headers: { 'x-ekoa-app-id': appId }, body: JSON.stringify(body) });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await changeRequests.deleteMany({}); await artifacts.deleteMany({}); await userSettings.deleteMany({});
  for (const [id, role, org] of [['reqU', 'user', 'orgA'], ['admA', 'org-admin', 'orgA'], ['admB', 'org-admin', 'orgB']] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
  // An ORG app owned by admB in orgB (org-shared so an org-admin can loadWritable it later).
  await artifacts.insert({ _id: 'appX', name: 'App X', slug: 'app-x', userId: 'admB', orgId: 'orgB', visibility: 'org', status: 'active', data: { projectDir: '/sbx/user-admB/appX' } } as never);
});

describe('H4 change-requests: file (served-app) lands in the OWNER org queue', () => {
  it('a plain user files via X-Ekoa-App-Id -> the request lands in the app owner org, server-stamped', async () => {
    const res = await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'Adicione um botão de exportação na tabela', route: '/faturas' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ChangeRequest.safeParse(body).success, JSON.stringify(ChangeRequest.safeParse(body))).toBe(true);
    expect(body.orgId).toBe('orgB');           // the OWNER org, NOT the requester's orgA
    expect(body.requesterUserId).toBe('reqU'); // from the verified JWT, never the body
    expect(body.requesterName).toBe('reqU');
    expect(body.appId).toBe('appX');
    expect(body.status).toBe('open');
    expect(body.route).toBe('/faturas');
  });

  it('an unknown app id is a 404 (shared error envelope), never a silent misfile', async () => {
    const res = await fileWithApp(await tokenFor('reqU'), 'no-such-app', { text: 'Olá' });
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('NOT_FOUND');
  });
});

describe('H4 change-requests: the org-admin queue read is org-scoped (cross-org isolation)', () => {
  it('an org-admin sees its OWN org only; another org-admin never sees it', async () => {
    await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido 1' }); // -> orgB

    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
    expect(ChangeRequestListResponse.safeParse(admBList).success).toBe(true);
    const bItems = admBList.items as Array<Record<string, unknown>>;
    expect(bItems.length).toBe(1);
    expect(bItems.every((r) => r.orgId === 'orgB')).toBe(true);

    // admA is in orgA — the crux: it MUST NOT see orgB's request.
    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
    const aItems = admAList.items as Array<Record<string, unknown>>;
    expect(admAList.total).toBe(0);
    expect(aItems.some((r) => r.requesterUserId === 'reqU')).toBe(false);
    expect(aItems.every((r) => r.orgId === 'orgA')).toBe(true);
  });

  it('a plain user cannot read the queue -> 403 FORBIDDEN (shared envelope)', async () => {
    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'));
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a super-admin can narrow across orgs with ?orgId=', async () => {
    await users.insert({ _id: 'root', username: 'root', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'orgRoot', active: true });
    setActivation('root', { active: true, billingLocked: false });
    await userSettings.put({ _id: 'root', memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
    await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido super' }); // -> orgB

    const all = await readJson(await authed('/api/v1/change-requests', await tokenFor('root')));
    expect((all.items as unknown[]).length).toBe(1);
    const scoped = await readJson(await authed('/api/v1/change-requests?orgId=orgA', await tokenFor('root')));
    expect((scoped.items as unknown[]).length).toBe(0); // no orgA requests exist
  });
});

describe('H4 change-requests: convert / dismiss are org-scoped', () => {
  it('convert flips status to converted + links the jobId; a cross-org convert is a uniform 404', async () => {
    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'Adicione um campo de data' }));
    const id = filed.id as string;

    // admA (orgA) must NOT be able to convert orgB's request — uniform 404, no cross-org oracle.
    const cross = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admA'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
    expect(cross.status).toBe(404);
    expect((await readJson(cross)).error).toBeTruthy();

    // admB (owner org) converts, linking the follow-up-build job the dashboard already started.
    const conv = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admB'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
    expect(conv.status).toBe(200);
    const cbody = await readJson(conv);
    expect(ChangeRequest.safeParse(cbody).success).toBe(true);
    expect(cbody.status).toBe('converted');
    expect(cbody.jobId).toBe('job-xyz');
  });

  it('dismiss flips status to dismissed (own org)', async () => {
    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido a dispensar' }));
    const id = filed.id as string;
    const res = await authed(`/api/v1/change-requests/${id}/dismiss`, await tokenFor('admB'), { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await readJson(res)).status).toBe('dismissed');
  });
});

describe('H4 change-requests: the refused-build feed files to the requester OWN org', () => {
  it('filing WITHOUT the served-app header lands in the requester own org (never a dead end)', async () => {
    // No X-Ekoa-App-Id header: the dashboard refused-build path. orgId is the requester's OWN org
    // (orgA), the body appId is kept only as an informational label.
    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'), { method: 'POST', body: JSON.stringify({ text: 'Não consegui construir; peço ao administrador.', appId: 'appX' }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ChangeRequest.safeParse(body).success).toBe(true);
    expect(body.orgId).toBe('orgA');           // the REQUESTER's own org
    expect(body.requesterUserId).toBe('reqU');
    expect(body.appId).toBe('appX');           // informational label; convert re-gates via H1

    // It surfaces to admA (orgA), and NOT to admB (orgB) — isolation holds on this path too.
    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
    expect((admAList.items as Array<Record<string, unknown>>).some((r) => r.requesterUserId === 'reqU')).toBe(true);
    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
    expect((admBList.items as Array<Record<string, unknown>>).some((r) => r.text === 'Não consegui construir; peço ao administrador.')).toBe(false);
  });
});

 succeeded in 0ms:
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, changeRequests, artifacts } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  ChangeRequest,
  ChangeRequestFileRequest,
  ChangeRequestConvertRequest,
  ChangeRequestListResponse,
  changeRequestsEndpoints,
} from '@ekoa/shared';

/**
 * H4 change-requests CONTRACT test: the wire SHAPES + descriptor declarations, and that the real
 * file/list/convert responses validate against the shared schemas (a new endpoint => a new
 * contract test, same slice). Behaviour/isolation lives in tests/routes/change-requests.test.ts.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await changeRequests.deleteMany({}); await artifacts.deleteMany({}); await userSettings.deleteMany({});
  for (const [id, role, org] of [['usr', 'user', 'orgA'], ['adm', 'org-admin', 'orgA']] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
  await artifacts.insert({ _id: 'appA', name: 'App A', userId: 'adm', orgId: 'orgA', visibility: 'org', status: 'active', data: { projectDir: '/sbx/user-adm/appA' } } as never);
});

describe('H4 change-requests contract: schema shapes', () => {
  it('ChangeRequest parses a full doc AND a minimal doc; rejects extra keys and a bad status', () => {
    const full = { id: 'c1', appId: 'appA', orgId: 'orgA', requesterUserId: 'usr', requesterName: 'usr', route: '/x', screenState: 's', text: 't', status: 'converted', createdAt: '2026-07-13T00:00:00.000Z', jobId: 'j1' };
    expect(ChangeRequest.safeParse(full).success).toBe(true);
    const minimal = { id: 'c2', orgId: 'orgA', requesterUserId: 'usr', requesterName: 'usr', text: 't', status: 'open', createdAt: '2026-07-13T00:00:00.000Z' };
    expect(ChangeRequest.safeParse(minimal).success).toBe(true);
    expect(ChangeRequest.safeParse({ ...minimal, bogus: 1 }).success).toBe(false); // .strict()
    expect(ChangeRequest.safeParse({ ...minimal, status: 'weird' }).success).toBe(false);
  });

  it('the file body requires non-empty bounded text; convert requires a jobId', () => {
    expect(ChangeRequestFileRequest.safeParse({ text: 'olá', route: '/x' }).success).toBe(true);
    expect(ChangeRequestFileRequest.safeParse({ text: '' }).success).toBe(false);
    expect(ChangeRequestFileRequest.safeParse({ text: 'x'.repeat(4001) }).success).toBe(false);
    expect(ChangeRequestConvertRequest.safeParse({ jobId: 'j' }).success).toBe(true);
    expect(ChangeRequestConvertRequest.safeParse({}).success).toBe(false);
  });

  it('the descriptors declare the right auth classes (file user; queue org-admin)', () => {
    expect(changeRequestsEndpoints.file.auth).toBe('user');
    expect(changeRequestsEndpoints.file.path).toBe('/api/v1/change-requests');
    expect(changeRequestsEndpoints.list.auth).toBe('org-admin');
    expect(changeRequestsEndpoints.convert.auth).toBe('org-admin');
    expect(changeRequestsEndpoints.dismiss.auth).toBe('org-admin');
  });
});

describe('H4 change-requests contract: live responses validate against the shared schemas', () => {
  it('file -> ChangeRequest; list -> ChangeRequestListResponse; convert -> ChangeRequest', async () => {
    const filed = await readJson(
      await authed('/api/v1/change-requests', await tokenFor('usr'), { method: 'POST', headers: { 'x-ekoa-app-id': 'appA' }, body: JSON.stringify({ text: 'Mude o título', route: '/inicio' }) }),
    );
    expect(ChangeRequest.safeParse(filed).success, JSON.stringify(ChangeRequest.safeParse(filed))).toBe(true);

    const list = await readJson(await authed('/api/v1/change-requests', await tokenFor('adm')));
    expect(ChangeRequestListResponse.safeParse(list).success, JSON.stringify(ChangeRequestListResponse.safeParse(list))).toBe(true);

    const conv = await readJson(
      await authed(`/api/v1/change-requests/${filed.id as string}/convert`, await tokenFor('adm'), { method: 'POST', body: JSON.stringify({ jobId: 'job-1' }) }),
    );
    expect(ChangeRequest.safeParse(conv).success).toBe(true);
    expect(conv.status).toBe('converted');
  });
});

exec
/bin/zsh -lc "codegraph explore 'jobs router POST /jobs canEditApps loadWritable artifactId body artifactId request app owner org-admin app edit gate'" in /Users/ggomes/dev/ekoa-code
 succeeded in 844ms:
## Exploration: jobs router POST /jobs canEditApps loadWritable artifactId body artifactId request app owner org-admin app edit gate

Found 154 symbols across 61 files.

### Blast radius — what depends on these (update/verify before editing)

- `RegisteredApp` (api/src/apps/app-registry.ts:19) — 3 callers in `api/src/apps/app-registry.ts`; ⚠️ no covering tests found
- `AppAssistantOwner` (api/src/apps/app-assistant.ts:37) — 1 caller in `api/src/apps/app-assistant.ts`; ⚠️ no covering tests found
- `AssistantAppResolution` (api/src/apps/app-assistant-route.ts:55) — 1 caller in `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found

### Relationships

**references:**
- register → RegisteredApp
- getApp → RegisteredApp
- AppAssistantInput → AppAssistantOwner
- AppAssistantInput → AppActionManifest
- buildSystemPrompt → AppAssistantInput
- runAppAssistant → AppAssistantInput
- UiActionsResult → AppActionManifest
- assistantToolsFromManifest → AppActionManifest
- manifest → AppActionManifest
- AssistantAdmission → AppActionManifest
- ... and 31 more

**calls:**
- runAppAssistant → inferMode
- runAppAssistant → map
- runAppAssistant → renderPrompt
- runAppAssistant → extractActions
- appAssistantRouter → runAppAssistant
- appAssistantRouter → resolveAssistantApp
- GoalEditor → onChange
- assistantToolsFromManifest → map
- describeTool → map
- extractActions → map
- ... and 140 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

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

#### web/lib/api/core.ts — calls(calls), instantiates(instantiates), references(references), request(function)

```typescript
195	
196	// -- The request core -------------------------------------------------------------------
197	
198	export async function request(descriptor: EndpointDescriptor, args?: RequestArgs, opts?: RequestOptions): Promise<unknown> {
199	  const { params, query, body } = splitArgs(descriptor, args);
200	  const url = buildUrl(descriptor, params, query);
201	
202	  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
203	  const token = getToken();
204	  if (token && descriptor.auth !== 'public') {
205	    headers['Authorization'] = `Bearer ${token}`;
206	  }
207	
208	  // Language interceptor (§12.2.3): inject the single-source language into the body.
209	  let jsonBody = body;
210	  if (descriptor.language) {
211	    const language = currentLanguage();
212	    if (language) jsonBody = { ...(jsonBody ?? {}), language };
213	  }
214	
215	  // Body encoding.
216	  let fetchBody: BodyInit | undefined;
217	  if (descriptor.kind === 'binary') {
218	    fetchBody = opts?.rawBody;
219	  } else if (jsonBody !== undefined && (descriptor.request !== undefined || Object.keys(jsonBody).length > 0)) {
220	    headers['Content-Type'] = 'application/json';
221	    fetchBody = JSON.stringify(jsonBody);
222	  }
223	
224	  // Per-descriptor timeout + caller abort, merged into one controller.
225	  const timeoutMs = descriptor.timeoutMs ?? DEFAULT_TIMEOUT_MS;
226	  const controller = new AbortController();
227	  let timedOut = false;
228	  let abortedByCaller = false;
229	  const timer = setTimeout(() => {
230	    timedOut = true;
231	    controller.abort();
232	  }, timeoutMs);
233	  const onCallerAbort = () => {
234	    abortedByCaller = true;
235	    controller.abort();
236	  };
237	  if (opts?.signal) {
238	    if (opts.signal.aborted) onCallerAbort();
239	    else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
240	  }
241	
242	  let res: Response;
243	  try {
244	    res = await fetch(url, { method: descriptor.method, headers, body: fetchBody, signal: controller.signal });
245	  } catch (error) {
246	    if (timedOut) throw new ApiError(0, 'TIMEOUT', `Request timed out after ${timeoutMs}ms`);
247	    if (abortedByCaller) throw new ApiError(0, 'ABORTED', 'Request aborted');
248	    throw new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Network request failed');
249	  } finally {
250	    clearTimeout(timer);
251	    opts?.signal?.removeEventListener('abort', onCallerAbort);
252	  }
253	
254	  if (!res.ok) {
255	    if (res.status === 401 && descriptor.auth !== 'public') handleUnauthorized();
256	    throw await toApiError(res);
257	  }
258	
259	  if (opts?.responseType === 'response') return res;
260	  if (opts?.responseType === 'blob') return res.blob();
261	
262	  if (res.status === 204) return undefined;
263	  const text = await res.text();
264	  let data: unknown;
265	  try {
266	    data = text ? JSON.parse(text) : undefined;
267	  } catch {
268	    throw new ApiError(0, 'CONTRACT_MISMATCH', `Response for ${descriptor.method} ${descriptor.path} was not valid JSON`);
269	  }
270	
271	  // Contract validation in dev/test (ch13 contract tests). Off in production for cost.
272	  if (process.env.NODE_ENV !== 'production' && descriptor.response && data !== undefined) {
273	    const check = descriptor.response.safeParse(data);
274	    if (!check.success) {
275	      throw new ApiError(
276	        0,
277	        'CONTRACT_MISMATCH',
278	        `Response for ${descriptor.method} ${descriptor.path} failed contract validation`,
279	        check.error.issues,
280	      );
281	    }
282	  }
283	
284	  return data;
285	}
286	
```

#### shared/src/org.ts — OrgUpdateRequest(type_alias), OrgCreateRequest(type_alias)

```typescript
1	/** Org and branding contract — ch03 §3.8.4 (`/api/v1/org`, `/orgs`, `/branding`),
2	 *  plus the org anonymisation deny-list (ch17 §17.4 (b), ch04 §4.3; F10). */
3	import { z } from 'zod';
4	import { Id, itemsResponse, OkResponse } from './common.js';
5	import type { DomainDescriptorMap } from './descriptor.js';
6	
7	/** Persisted design-system tokens (ch05 §5.6.4 brand research). Mirrors the extractor output
8	 *  (dembrandt, trimmed) and the web `StoredDesignSystem` shape rendered on the Design System tab.
9	 *  Every field optional so an older org record — or a partial research run — still validates. */
10	export const StoredDesignSystem = z
11	  .object({
12	    // Extractor output round-trips through the store, where an absent optional leaf comes back as
13	    // `null` (never `undefined`), so every optional leaf is `.nullish()` (accepts null | undefined).
14	    logo: z
15	      .object({
16	        url: z.string().nullish(),
17	        background: z.string().nullish(),
18	        width: z.number().nullish(),
19	        height: z.number().nullish(),
20	      })
21	      .nullish(),
22	    palette: z
23	      .array(
24	        z.object({
25	          hex: z.string(),
26	          count: z.number(),
27	          confidence: z.enum(['high', 'medium', 'low']),
28	          sources: z.array(z.string()),
29	        }),
30	      )
31	      .optional(),
32	    cssVariables: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
33	    typography: z
34	      .object({
35	        families: z.array(z.string()),
36	        styles: z.array(
37	          z.object({
38	            role: z.string().nullish(),
39	            fontFamily: z.string().nullish(),
40	            fontSize: z.string().nullish(),
41	            fontWeight: z.string().nullish(),
42	            lineHeight: z.string().nullish(),
43	          }),
44	        ),
45	      })
46	      .optional(),
47	    spacing: z
48	      .object({
49	        scaleType: z.string().nullish(),
50	        values: z.array(z.object({ px: z.string(), count: z.number() })),
51	      })
52	      .optional(),
53	    borderRadius: z
54	      .object({
55	        values: z.array(z.object({ value: z.string(), count: z.number() })),
56	        shapeLanguage: z.string(),
57	      })
58	      .optional(),
59	    shadows: z.array(z.object({ shadow: z.string(), count: z.number() })).optional(),
60	    primaryButton: z.record(z.string()).nullish(),
61	    frameworks: z.array(z.string()).optional(),
62	  })
63	  .passthrough();
64	export type StoredDesignSystem = z.infer<typeof StoredDesignSystem>;
65	
66	/** Vision-model read of the site's overall feel (ch05 §5.6.4). Mirrors the web `VisualVibe`. */
67	export const VisualVibe = z
68	  .object({
69	    mood: z.string(),
70	    bullets: z.array(z.string()),
71	    shape: z.string(),
72	    density: z.string(),
73	    texture: z.string(),
74	    hero: z.string(),
75	  })
76	  .passthrough();
77	export type VisualVibe = z.infer<typeof VisualVibe>;
78	
79	export const OrgBranding = z
80	  .object({
81	    logo: z.string().optional(),
82	    primaryColor: z.string().optional(),
83	    secondaryColor: z.string().optional(),
84	    accentColor: z.string().optional(),
85	    fontFamily: z.string().optional(),
86	    fonts: z.array(z.string()).optional(),
87	    toneOfVoice: z.string().optional(),
88	    instructions: z.string().optional(),
89	    websiteUrl: z.string().optional(),
90	    /** Extractor outputs attached server-side by the brand-research pipeline (ch05 §5.6.4). */
91	    designSystem: StoredDesignSystem.optional(),
92	    visualVibe: VisualVibe.optional(),
93	  })
94	  .passthrough();
95	export type OrgBranding = z.infer<typeof OrgBranding>;
96	
97	/** Structured output of the TOOL-LESS brand-research agent (ch05 §5.6.4). Keys align with
98	 *  OrgBranding so a valid result merge-writes onto the org's branding; `summary`/`confidence`
99	 *  are research metadata (kept on the job record, never written to branding). Colors and fonts
100	 *  are PROPOSALS from brand knowledge — the agent cannot browse — flagged by `confidence`. */
101	export const BrandResearchResult = z
102	  .object({
103	    logo: z.string().optional(),
104	    primaryColor: z.string().optional(),
105	    accentColor: z.string().optional(),
106	    secondaryColor: z.string().optional(),
107	    /** Company display name read from the site (title / og:site_name / visible text). Applied
108	     *  to org.displayName, never merged into branding (the seeded bootstrap name is a
109	     *  placeholder research must be able to replace, as the old platform did). */
110	    companyName: z.string().optional(),
111	    websiteUrl: z.string().optional(),
112	    fonts: z.array(z.string()).optional(),
113	    fontFamily: z.string().optional(),
114	    toneOfVoice: z.string().optional(),
115	    /** Actionable visual-identity guidance the grounded synthesis writes (design notes). */
116	    instructions: z.string().optional(),
117	    summary: z.string().optional(),
118	    confidence: z.enum(['low', 'medium', 'high']).optional(),
119	  })
120	  .passthrough();
121	export type BrandResearchResult = z.infer<typeof BrandResearchResult>;
122	
123	export const OrgConfig = z
124	  .object({
125	    id: Id,
126	    name: z.string(),
127	    displayName: z.string().optional(),
128	    branding: OrgBranding.optional(),
129	    settings: z.record(z.unknown()).optional(),
130	    /** Stamped on every org patch. The web branding page re-syncs its local editor state only
131	     *  when this changes (its research-refresh fingerprint), so it must be on the wire. */
132	    updatedAt: z.string().optional(),
133	  })
134	  .passthrough();
135	export type OrgConfig = z.infer<typeof OrgConfig>;
136	
137	export const OrgUpdateRequest = z
138	  .object({
139	    name: z.string().optional(),
140	    displayName: z.string().optional(),
141	    branding: OrgBranding.optional(),
142	    settings: z.record(z.unknown()).optional(),
143	  })
144	  .passthrough();
145	export type OrgUpdateRequest = z.infer<typeof OrgUpdateRequest>;
146	
147	export const BrandingSaveRequest = z.object({
148	  branding: OrgBranding,
149	  displayName: z.string().optional(),
150	});
151	export type BrandingSaveRequest = z.infer<typeof BrandingSaveRequest>;
152	
153	export const BrandingResearchRequest = z.object({
154	  websiteUrl: z.string(),
155	});
156	export type BrandingResearchRequest = z.infer<typeof BrandingResearchRequest>;
157	
158	export const BrandingResearchResponse = z.object({ jobId: z.string() });
159	export type BrandingResearchResponse = z.infer<typeof BrandingResearchResponse>;
160	
161	export const OrgCreateRequest = z.object({
162	  name: z.string(),
163	  displayName: z.string().optional(),
164	});
165	export type OrgCreateRequest = z.infer<typeof OrgCreateRequest>;
166	
167	export const OrgPatch = z.object({
168	  name: z.string().optional(),
169	  displayName: z.string().optional(),
170	  settings: z.record(z.unknown()).optional(),
171	});
172	export type OrgPatch = z.infer<typeof OrgPatch>;
173	
174	export const OrgListResponse = itemsResponse(OrgConfig);
175	export type OrgListResponse = z.infer<typeof OrgListResponse>;
176	
177	/** One deny-list entry, METADATA ONLY — the cleartext party name is write-only and never
178	 *  returned by any endpoint (ch04 §4.3.4; it is org-scoped-encrypted at rest). */
179	export const DenyListEntry = z
180	  .object({
181	    id: Id,
182	    entityClass: z.string(),
183	    addedBy: z.string(),
184	    addedAt: z.string(),
185	  })
186	  .passthrough();
187	export type DenyListEntry = z.infer<typeof DenyListEntry>;
188	
189	/** The CLOSED set of entity classes (ch17 §17.5 token shapes). A free string here would let
190	 *  the secret literal itself be laundered into plaintext rest/audit/responses via this field. */
191	export const DenyListEntityClass = z.enum(['NIF', 'NIPC', 'NISS', 'IBAN', 'CC', 'UTENTE', 'PROCESSO', 'PARTY', 'PERSON']);
192	export type DenyListEntityClass = z.infer<typeof DenyListEntityClass>;
193	
194	export const DenyListCreateRequest = z.object({
195	  /** The literal to mask at egress (a firm client/matter/party name — §17.4 (b)). */
196	  value: z.string().min(1).max(500),
197	  entityClass: DenyListEntityClass.optional(),
198	});
199	export type DenyListCreateRequest = z.infer<typeof DenyListCreateRequest>;
200	
201	export const DenyListListResponse = itemsResponse(DenyListEntry);
202	export type DenyListListResponse = z.infer<typeof DenyListListResponse>;
203	
204	export const orgEndpoints = {
205	  getOrg: {
206	    method: 'GET',
207	    path: '/api/v1/org',
208	    auth: 'user',
209	    response: OrgConfig,
210	  },
211	  updateOrg: {
212	    method: 'PATCH',
213	    path: '/api/v1/org',
214	    auth: 'org-admin',
215	    request: OrgUpdateRequest,
216	    response: OrgConfig,
217	  },
218	  saveBranding: {
219	    method: 'PUT',
220	    path: '/api/v1/branding',
221	    auth: 'org-admin',
222	    request: BrandingSaveRequest,
223	    response: OrgConfig,
224	  },
225	  researchBranding: {
226	    method: 'POST',
227	    path: '/api/v1/branding/research',
228	    auth: 'org-admin',
229	    request: BrandingResearchRequest,
230	    response: BrandingResearchResponse,
231	  },
232	  createOrg: {
233	    method: 'POST',
234	    path: '/api/v1/orgs',
235	    auth: 'super-admin',
236	    request: OrgCreateRequest,
237	    response: OrgConfig,
238	  },
239	  listOrgs: {
240	    method: 'GET',
241	    path: '/api/v1/orgs',
242	    auth: 'super-admin',
243	    response: OrgListResponse,
244	  },
245	  patchOrg: {
246	    method: 'PATCH',
247	    path: '/api/v1/orgs/:id',
248	    auth: 'super-admin',
249	    request: OrgPatch,
250	    response: OrgConfig,
251	  },
252	  listDenyList: {
253	    method: 'GET',
254	    path: '/api/v1/org/deny-list',
255	    auth: 'org-admin',
256	    response: DenyListListResponse,
257	  },
258	  addDenyListEntry: {
259	    method: 'POST',
260	    path: '/api/v1/org/deny-list',
261	    auth: 'org-admin',
262	    request: DenyListCreateRequest,
263	    response: DenyListEntry,
264	  },
265	  removeDenyListEntry: {
266	    method: 'DELETE',
267	    path: '/api/v1/org/deny-list/:id',
268	    auth: 'org-admin',
269	    response: OkResponse,
270	  },
271	} as const satisfies DomainDescriptorMap;
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The queue service itself is not where I see the likely defect. The convert flow trusts a caller-provided `jobId`, so I’m tracing whether the server guarantees that `jobId` came from a build the same admin was allowed to start for the same app, or whether the route merely links arbitrary IDs.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,260p' shared/src/change-request.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/**
 * Change-requests domain contract (operator-run H4; BRIEF Phase 9d). GREENFIELD — the
 * request-changes queue: a user files a change request from INSIDE a served app; the app
 * OWNER's org-admins see it in a dashboard queue and convert one into a patch run (a
 * follow-up build). Additive only.
 *
 * The security crux is CROSS-ORG ISOLATION: a `ChangeRequest.orgId` is stamped SERVER-SIDE
 * (never from the caller's body) — the app OWNER's org for a served-app filing, the
 * requester's OWN org for a dashboard refused-build filing. `GET /api/v1/change-requests`
 * returns ONLY the caller-org's requests for an org-admin (super-admin across orgs), mirroring
 * registo.ts exactly. An org-admin MUST NEVER see another org's requests.
 */
import { z } from 'zod';
import { Id, IsoTimestamp, listResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

/** The lifecycle of a queued request: open (awaiting an admin), converted (an admin started a
 *  patch run — carries the resulting jobId), dismissed (an admin declined it). */
export const ChangeRequestStatus = z.enum(['open', 'converted', 'dismissed']);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatus>;

/**
 * A single change request. `appId`/`route`/`screenState` are OPTIONAL because the refused-build
 * feed (a dashboard first-build refusal) has no served app or screen yet — the panel filing
 * always carries them. `orgId`/`requesterUserId`/`requesterName` are server-stamped. `jobId` is
 * set only once an admin converts it (the follow-up build the convert started).
 */
export const ChangeRequest = z
  .object({
    id: Id,
    /** The served app the request is about (absent for a dashboard first-build refusal). */
    appId: Id.optional(),
    /** The OWNER org (served-app filing) or the requester's own org (refused-build filing).
     *  Always server-resolved — this is the cross-org isolation boundary. */
    orgId: Id,
    requesterUserId: Id,
    requesterName: z.string(),
    /** The served-app route/screen the request was filed from (best-effort, panel-captured). */
    route: z.string().optional(),
    /** A short captured screen-context descriptor (panel-captured; org-internal, never egressed). */
    screenState: z.string().optional(),
    text: z.string(),
    status: ChangeRequestStatus,
    createdAt: IsoTimestamp,
    /** The patch-run job an admin's convert produced (present only when status === 'converted'). */
    jobId: Id.optional(),
  })
  .strict();
export type ChangeRequest = z.infer<typeof ChangeRequest>;

/**
 * The file-a-request body (`POST /api/v1/change-requests`). `text` is the only required field;
 * `route`/`screenState` are the panel-captured context. `appId` is honoured ONLY on the
 * dashboard (no `X-Ekoa-App-Id` header) path — for a served-app filing the header resolves the
 * app + owner org server-side and any body `appId` is ignored (never trusted for org routing).
 */
export const ChangeRequestFileRequest = z.object({
  text: z.string().min(1).max(4000),
  route: z.string().max(1000).optional(),
  screenState: z.string().max(8000).optional(),
  appId: Id.optional(),
});
export type ChangeRequestFileRequest = z.infer<typeof ChangeRequestFileRequest>;

/** Convert body: the jobId of the follow-up build the dashboard already started (H1-gated). */
export const ChangeRequestConvertRequest = z.object({ jobId: Id });
export type ChangeRequestConvertRequest = z.infer<typeof ChangeRequestConvertRequest>;

/** Queue read query. `status` narrows the list; `orgId` is honoured only for a super-admin
 *  (an org-admin is always pinned to its own org server-side — the isolation boundary). */
export const ChangeRequestQuery = z.object({
  status: ChangeRequestStatus.optional(),
  orgId: Id.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type ChangeRequestQuery = z.infer<typeof ChangeRequestQuery>;

export const ChangeRequestListResponse = listResponse(ChangeRequest);
export type ChangeRequestListResponse = z.infer<typeof ChangeRequestListResponse>;

export const changeRequestsEndpoints = {
  // File a request from inside a served app (X-Ekoa-App-Id resolves app+owner org) OR from the
  // dashboard refused-build feed (own org). Requires a logged-in platform user (auth 'user').
  file: {
    method: 'POST',
    path: '/api/v1/change-requests',
    auth: 'user',
    request: ChangeRequestFileRequest,
    response: ChangeRequest,
  },
  // The org-admin queue read. org-admin sees own org; super-admin across orgs (mirrors registo).
  list: {
    method: 'GET',
    path: '/api/v1/change-requests',
    auth: 'org-admin',
    query: ChangeRequestQuery,
    response: ChangeRequestListResponse,
  },
  // Mark a request converted (the dashboard already POSTed /jobs; this links the resulting jobId).
  convert: {
    method: 'POST',
    path: '/api/v1/change-requests/:id/convert',
    auth: 'org-admin',
    request: ChangeRequestConvertRequest,
    response: ChangeRequest,
  },
  // Decline a request (status -> dismissed). org-admin own org; super-admin across orgs.
  dismiss: {
    method: 'POST',
    path: '/api/v1/change-requests/:id/dismiss',
    auth: 'org-admin',
    response: ChangeRequest,
  },
} as const satisfies DomainDescriptorMap;

exec
/bin/zsh -lc "sed -n '1,220p' api/tests/contract/schema-coverage.test.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
import { describe, it, expect } from 'vitest';
import { ALL_ENDPOINTS, allEndpointsFlat } from '@ekoa/shared';

/**
 * Schema-coverage gate (ch13 §13.5 item 3, §14.2.5). Every endpoint descriptor in `shared/`
 * is accounted for exactly once: either COVERED or PENDING (a committed allowlist of
 * not-yet-landed endpoints). The gate fails if any descriptor is in NEITHER list — so adding
 * an endpoint/schema to `shared/` without accounting for it is an automatic build failure
 * (the ch13 §13.11 item-5 deliberate-red mechanism). PENDING must SHRINK at every domain gate
 * and be EMPTY at G9.
 *
 * KNOWN LIMIT — this gate does NOT verify that a test exercises a COVERED endpoint. It asserts
 * only (a) every COVERED string names a real descriptor and (b) the PENDING count is the pinned
 * constant. COVERED is a hand-maintained CLAIM: adding a key with zero tests passes. ch13 §13.5
 * specifies a run-wide registry of actually-exercised schemas; that mechanism is not implemented.
 * This has already shipped real bugs twice — F22 (`memoryView` omitted required fields, /memory
 * rendered zero cards) and the sessions family (`sessionView` omitted createdAt/updatedAt and
 * emitted `title` for `name`; message bodies emitted `_id`/`timestamp` for `id`/`createdAt`) —
 * both while their keys sat in COVERED and no test ever requested the path. An audit on
 * 2026-07-10 found 27 of 154 COVERED keys unexercised (RUN_LOG). Do not read a green gate here
 * as evidence that an endpoint's body matches its schema.
 */

// Endpoints with a committed contract/e2e test now (G2 auth + G3 CRUD domains).
const COVERED = new Set<string>([
  'auth.login', 'auth.me',
  // batch1 F1 — auth lifecycle (auth.test.ts)
  'auth.refresh', 'auth.logout', 'auth.changePassword', 'auth.deviceStart', 'auth.devicePoll', 'auth.deviceApprove',
  'users.list', 'users.create', 'users.update', 'users.remove', 'users.resetPassword',
  'org.getOrg', 'org.updateOrg', 'org.saveBranding', 'org.createOrg', 'org.listOrgs', 'org.patchOrg',
  // batch1 F4 — brand research at the contract path (branding.test.ts)
  'org.researchBranding',
  // F10 deny-list CRUD (batch-final s1) — exercised by tests/contract/denylist.test.ts
  'org.listDenyList', 'org.addDenyListEntry', 'org.removeDenyListEntry',
  'settings.get', 'settings.update', 'settings.updateMe',
  'sessions.create', 'sessions.list', 'sessions.get', 'sessions.update', 'sessions.delete', 'sessions.getMessages', 'sessions.addMessage',
  'memories.list', 'memories.get', 'memories.create', 'memories.update', 'memories.delete',
  'registo.listRegisto',
  'billing.getUsage', 'billing.getHistory',
  // G7 — billing metering write + admin surfaces (billing.test.ts)
  'billing.getBreakdown', 'billing.purchaseCredits', 'billing.toggleOverage', 'billing.adminGlobalOverage',
  'billing.adminListUsage', 'billing.adminResetUsage', 'billing.adminSetLimit',
  // G4 — integrations + knowledge (partial: configs CRUD + sources CRUD + uploads list)
  'integrations.listConfigs', 'integrations.createConfig', 'integrations.updateConfig', 'integrations.deleteSkill',
  'knowledge.listSources', 'knowledge.createSource', 'knowledge.deleteSource', 'knowledge.listUploads',
  // G7B — knowledge vault + lexical index (knowledge.test.ts)
  'knowledge.listCollections', 'knowledge.listDocuments', 'knowledge.createDocument', 'knowledge.deleteDocument',
  'knowledge.createUpload', 'knowledge.deleteUpload', 'knowledge.reindex', 'knowledge.indexStatus',
  // G5 — triggers + webhook ingress + notifications SSE
  'triggers.list', 'triggers.create', 'triggers.delete', 'triggers.webhookIngressPost', 'triggers.webhookIngressGet',
  'notifications.events',
  // G6 (data-plane core) — artifacts CRUD + the byte-compatible served-app data plane
  'artifacts.list', 'artifacts.get', 'artifacts.patch', 'artifacts.remove',
  'servedApp.appDataList', 'servedApp.appDataGet', 'servedApp.appDataCreate', 'servedApp.appDataUpsert', 'servedApp.appDataDelete',
  'servedApp.appSharedList', 'servedApp.appSharedGet', 'servedApp.appSharedCreate', 'servedApp.appSharedUpsert', 'servedApp.appSharedDelete',
  // G6 (full) — artifact family, backups, backend runtime, company-space (artifact-family.test.ts)
  'artifacts.fork', 'artifacts.export', 'artifacts.import', 'artifacts.bundleUpdate', 'artifacts.setFeatured',
  'artifacts.featuredUpdateApply', 'artifacts.featuredUpdateIgnore', 'artifacts.versionsList', 'artifacts.versionsRestore',
  'artifacts.filesList', 'artifacts.readFile', 'artifacts.writeFile', 'artifacts.download', 'artifacts.pdf',
  'artifacts.backupStatus', 'artifacts.backupSnapshot', 'artifacts.backupExport', 'artifacts.backupPreview', 'artifacts.backupRestore',
  'artifacts.backendStatus', 'artifacts.backendLogs', 'artifacts.backendInvocations', 'artifacts.backendSetEnabled', 'artifacts.backendSampleRun',
  'companySpace.list', 'companySpace.get', 'companySpace.start', 'companySpace.stop',
  // G6 — served-app files/sso/cloud/m365 (app-files.test.ts, app-sso.test.ts)
  'servedApp.appFileUpload', 'servedApp.appFileGet', 'servedApp.appFileDelete',
  'servedApp.appSsoLogin', 'servedApp.appSsoSetPassword', 'servedApp.appSsoLogout', 'servedApp.appSsoMe',
  'servedApp.appSsoMicrosoftStart', 'servedApp.appSsoM365', 'servedApp.appCloudFilesStatus', 'servedApp.m365Proxy',
  // G6 — legal vertical services + e-sign (legal-plane.test.ts)
  'servedApp.legalCalculos', 'servedApp.legalTranscricao', 'servedApp.legalResearch', 'servedApp.trackingConsulta',
  'servedApp.citiusConsulta', 'servedApp.signatureSend', 'servedApp.adobeSignWebhookGet', 'servedApp.adobeSignWebhookPost',
  // G6 — serving plane + health + demos (served-app.test.ts)
  'servedApp.appHealth', 'servedApp.serveApp', 'servedApp.demoBridge',
  // G6 — integration definitions registry (integration-definitions.test.ts)
  'integrations.list', 'integrations.listActive', 'integrations.refresh',
  // G7B — agent execution: chat runs + build jobs (chat.test.ts, jobs.test.ts)
  'chat.createRun', 'chat.getRun', 'chat.runEvents', 'chat.cancelRun',
  'jobs.create', 'jobs.get', 'jobs.cancel', 'jobs.events',
  // batch1 F2 — model-credential provisioning (credentials.test.ts)
  'credentials.set',
  // batch1 F5 subset — the UI-called endpoints (memories.test.ts, f5-ui-endpoints.test.ts)
  'memories.bulkDelete', 'memories.submitSignal', 'memories.listTags', 'memories.stats',
  'knowledge.updateSource', 'knowledge.crawlSource', 'knowledge.crawlStatus', 'knowledge.refreshSchedule',
  'integrations.sessionStatus', 'integrations.connectSession', 'integrations.provisionAutomations',
  // PR4 — the AI integration builder (integration-builder.test.ts): chat/load/save/test.
  'integrationBuilder.chat', 'integrationBuilder.load', 'integrationBuilder.save', 'integrationBuilder.test',
  // Local-bridge consumer run s1 — hosted presence (bridge-status.test.ts)
  'ekoaLocal.bridgeStatus',
  // Local-bridge consumer run s5 — FC-408 masking summary (masking-summary.test.ts)
  'registo.maskingSummary',
  // operator-run H2 — served-app assistant admin detection (app-assistant.contract.test.ts +
  // the whoami route matrix in tests/apps/app-assistant.test.ts). Additive endpoint: covering it
  // keeps EXPECTED_PENDING_COUNT unchanged (assistantChat stays PENDING as before).
  'appAssistant.whoami',
  // operator-run H4 — the request-changes queue (change-requests.test.ts contract +
  // tests/routes/change-requests.test.ts integration). A NEW domain: covering all four keeps
  // EXPECTED_PENDING_COUNT unchanged.
  'changeRequests.file', 'changeRequests.list', 'changeRequests.convert', 'changeRequests.dismiss',
]);

// Not-yet-landed endpoints (committed allowlist; SHRINKS each gate, EMPTY at G9). Computed as
// "every descriptor endpoint not in COVERED" here, but pinned by an expected-count assertion so
// a NEW endpoint added to shared/ without being COVERED bumps the count and fails the gate.
// G5->G6: 148->95; G6->G7: 95->88 (7 billing write/admin endpoints) as the full served-app plane, artifact family, legal vertical, and
// integration-definitions surfaces landed with their contract tests (53 endpoints newly covered).
// G7->G7B: 88->80 as the knowledge vault + lexical index surface landed (8 endpoints: collections,
// documents list/ingest/delete, uploads create/delete, reindex, index-status). Knowledge crawl
// endpoints (updateSource, crawlSource, crawlStatus, refreshSchedule) remain PENDING for the crawl gate.
// G7B agent-execution: 80->72 as chat runs (4) + build jobs (4) landed with their contract tests.
const EXPECTED_PENDING_COUNT = 49; // F1 -7 (72->65); F4 -1 (->64); F5 subset -11 (->53); PR4 integration-builder -4 (->49)

describe('schema-coverage gate (ch13 §13.5 item 3)', () => {
  it('every descriptor endpoint is COVERED or PENDING (no unaccounted schema)', () => {
    const all = allEndpointsFlat().map((e) => `${e.domain}.${e.name}`);
    // Every COVERED name must be a real descriptor (no drift / stale coverage claim).
    for (const c of COVERED) {
      expect(all, `COVERED names a real descriptor: ${c}`).toContain(c);
    }
    const pending = all.filter((k) => !COVERED.has(k));
    // The deliberate-red bite: a new endpoint added to shared/ that is neither COVERED nor
    // expected in PENDING changes this count, failing the gate. (Verified by a temporary
    // shared/ addition during the build — logged in RUN_LOG per ch13 §13.11 item 5.)
    expect(pending.length, 'PENDING allowlist count (shrinks each gate, 0 at G9)').toBe(EXPECTED_PENDING_COUNT);
  });

  it('landed domains at G3 are present and covered', () => {
    for (const d of ['auth', 'users', 'org', 'settings', 'sessions', 'memories', 'registo', 'billing']) {
      expect(ALL_ENDPOINTS[d as keyof typeof ALL_ENDPOINTS]).toBeTruthy();
    }
    // A representative endpoint from each landed domain is covered.
    for (const c of ['users.list', 'memories.get', 'registo.listRegisto', 'org.getOrg']) {
      expect(COVERED.has(c)).toBe(true);
    }
  });
});

exec
/bin/zsh -lc "sed -n '1,220p' web/components/admin-gate.tsx" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
"use client";

import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

/**
 * AdminGate wraps pages that require elevated access. By default only a
 * super-admin passes. Amendment 2 (FC-500/FC-502): pass `allowOrgAdmin` for the
 * surfaces an org-admin also manages (scoped server-side to its own org) - the
 * users page and the Registo admin page.
 */
export function AdminGate({
  children,
  allowOrgAdmin = false,
}: {
  children: React.ReactNode;
  allowOrgAdmin?: boolean;
}) {
  const user = useAuthStore((s) => s.user);

  const allowed =
    user?.role === "super-admin" || (allowOrgAdmin && user?.role === "org-admin");

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center text-center max-w-md space-y-4">
        <div className="w-12 h-12 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-center">
          <ShieldAlert size={24} className="text-neutral-400" />
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">Acesso restrito</h2>
        <p className="text-sm text-neutral-500 leading-relaxed">
          Esta página está disponível apenas para administradores. Contacte o administrador da sua
          organização se precisar de acesso.
        </p>
      </div>
    </div>
  );
}

exec
/bin/zsh -lc "codegraph explore 'jobsRouter create job route artifactId canEditApps performBuild prepareFirstBuild loadWritable build job create response schema'" in /Users/ggomes/dev/ekoa-code
 succeeded in 689ms:
## Exploration: jobsRouter create job route artifactId canEditApps performBuild prepareFirstBuild loadWritable build job create response schema

Found 156 symbols across 73 files.

### Blast radius — what depends on these (update/verify before editing)

- `build` (api/src/apps/builder.ts:359) — 3 callers in `api/src/apps/builder.ts`, `api/src/apps/build-mechanics.ts`; ⚠️ no covering tests found
- `loadWritable` (api/src/apps/app-paths.ts:103) — 8 callers in `api/src/routes/artifacts.ts`, `api/src/apps/build-mechanics.ts`, `api/src/routes/jobs.ts`, `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `BuildResult` (api/src/apps/builder.ts:33) — 4 callers in `api/src/apps/builder.ts`; ⚠️ no covering tests found
- `BuildLinkDeps` (api/src/apps/build-link.ts:23) — 1 caller in `api/src/apps/build-link.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- build → buildFrontend
- build → buildBackend
- createBuildMechanics → build
- writable → loadWritable
- createBuildMechanics → loadWritable
- buildLinkRouter → Router
- memoriesRouter → map
- sessionsRouter → map
- buildBackend → map
- buildFrontend → map
- ... and 279 more

**references:**
- build → BuildResult
- buildBackend → BuildResult
- buildFrontend → BuildResult
- tryPlainHtmlBuild → BuildResult
- buildLinkRouter → BuildLinkDeps
- BuildCreateInput → Actor
- appFilesRouter → Router
- buildLinkRouter → Router
- devServeRouter → Router
- servedDataRouter → Router
- ... and 94 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/builder.ts — calls(calls), BuildResult(interface), generateIndexHtml(function), sharedBuildOptions(function)

```typescript
30	// Types
31	// ============================================
32	
33	export interface BuildResult {
34	  success: boolean;
35	  errors: string[];
36	  warnings: string[];
37	  durationMs: number;
38	  outputFiles: string[];
39	}
40	
41	// ============================================
42	// Workspace node_modules resolution

... (gap) ...

70	  return htmlTemplateCache;
71	}
72	
73	async function generateIndexHtml(appName: string, _manifest: AppManifest | null, hasCss: boolean): Promise<string> {
74	  const template = await loadHtmlTemplate();
75	  const cssLink = hasCss
76	    ? '\n  <link rel="stylesheet" href="./bundle.css">'
77	    : '';
78	
79	  return template
80	    .replace('{{APP_NAME}}', escapeHtml(appName))
81	    .replace('{{CSS_LINK}}', cssLink);
82	}
83	
84	function escapeHtml(str: string): string {
85	  return str

... (gap) ...

282	// Shared esbuild options
283	// ============================================
284	
285	function sharedBuildOptions(entryPath: string, outDir: string): esbuild.BuildOptions {
286	  return {
287	    entryPoints: [entryPath],
288	    bundle: true,
289	    outdir: outDir,
290	    entryNames: 'bundle',
291	    format: 'iife',
292	    platform: 'browser',
293	    target: ['es2020'],
294	    // JSX automatic transform - no need for `import React` in every file
295	    jsx: 'automatic',
296	    // Resolve React from the workspace node_modules (not each sandbox)
297	    nodePaths: WORKSPACE_NODE_MODULES,
298	    plugins: [cdnResolverPlugin()],
299	    // Loaders
300	    loader: {
301	      '.js': 'jsx',
302	      '.jsx': 'jsx',
303	      '.tsx': 'tsx',
304	      '.ts': 'ts',
305	      '.css': 'css',
306	      '.png': 'file',
307	      '.jpg': 'file',
308	      '.jpeg': 'file',
309	      '.gif': 'file',
310	      '.svg': 'file',
311	      '.woff': 'file',
312	      '.woff2': 'file',
313	      '.ttf': 'file',
314	      '.eot': 'file',
315	    },
316	    assetNames: 'assets/[name]-[hash]',
317	    // Dev-friendly defaults
318	    minify: false,
319	    sourcemap: true,
320	    metafile: true,
321	    logLevel: 'silent',
322	    define: {
323	      'process.env.NODE_ENV': '"development"',
324	    },
325	  };
326	}
327	
328	// ============================================
329	// AppBuilder
```

#### api/src/data/collections-engine.ts — calls(calls), create(method), references(references), instantiates(instantiates)

```typescript
134	    return d ? d.item : null;
135	  }
136	
137	  async create(
138	    scope: Scope,
139	    collection: string,
140	    body: Record<string, unknown>,
141	    rule?: z.infer<typeof collectionRule>,
142	  ): Promise<Record<string, unknown>> {
143	    guardCollectionName(collection);
144	    const id = typeof body.id === 'string' && body.id ? body.id : this.deps.genId();
145	    const now = nowIso(this.deps.now());
146	    const { id: _drop, createdAt: _c, updatedAt: _u, ...fields } = body;
147	    const item = { id, createdAt: now, updatedAt: now, ...fields };
148	    this.checkSize(rule, item);
149	    validateItem(rule, item);
150	    try {
151	      await col().insertOne({ _id: docId(scope, collection, id), appId: scope.scopeKey, collection, item, _rev: 0 });
152	    } catch (e) {
153	      if ((e as { code?: number }).code === 11000) {
154	        // id collision → treat as update-through-create is not allowed; surface conflict
155	        throw new EngineError('SLUG_TAKEN', 409, `Item id already exists: ${id}`);
156	      }
157	      throw e;
158	    }
159	    return item;
160	  }
161	
162	  /** PUT upsert (§4.2.8 #6): update-merge if present, create with the given id if absent. */
163	  async upsert(
```

#### api/src/apps/app-paths.ts — loadWritable(function), newProjectDir(function), projectDirFor(function), patchArtifactData(function), OwnershipVerdict(type_alias), loadReadable(function)

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

#### api/src/routes/jobs.ts — jobsRouter(function), jobs.ts(file)

```typescript
1	/**
2	 * Build/brand-research jobs router (ch03 §3.8.8, §3.6.2). `POST /jobs` creates BUILD jobs; the
3	 * response is `created` (with the job) or `answered` (in-build classifier resolved it, no job) or
4	 * 409 DUPLICATE_BUILD (a concurrent follow-up on the same artifact). `GET /jobs/:id` serves the
5	 * persisted record (P-10); events stream over `events/` via ?token=. Routes never touch `data/`.
6	 */
7	import { Router, type Request, type Response } from 'express';
8	import { JobCreateRequest } from '@ekoa/shared';
9	import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
10	import { can } from '../auth/capabilities.js';
11	import { loadWritable } from '../apps/app-paths.js';
12	import { sseManager } from '../events/sse-manager.js';
13	import { handleBuildCreate, cancelRun } from '../agents/index.js';
14	import { getJob, jobView } from '../agents/jobs.js';
15	import { actorOf, notFound, parseBody, sendError } from './helpers.js';
16	
17	export function jobsRouter(deps: { now: () => number; genId: () => string }): Router {
18	  const r = Router();
19	
20	  r.get('/:id/events', async (req: Request, res: Response) => {
21	    const auth = verifySseToken(req.query.token as string | undefined);
22	    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
23	    const id = req.params.id as string;
24	    // Ownership check BEFORE attach (Codex checkpoint): a valid SSE token must NOT subscribe to
25	    // another user's job stream (cross-user event/output leak). Mirrors the guarded GET /:id + the
26	    // chat SSE route. A missing job attaches (nothing streams); only a foreign OWNED job is refused.
27	    const job = await getJob(id);
28	    if (job && job.userId !== auth.claims.sub) {
29	      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } });
30	    }
31	    const lastEventId = req.header('last-event-id');
32	    sseManager.attach(res, auth.claims.sub, 'job', id, lastEventId ? Number(lastEventId) : undefined);
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
67	      username: req.user!.username,
68	      sessionId: body.sessionId,
69	      description: body.description,
70	      language: body.language,
71	      ...(body.templateId ? { templateId: body.templateId } : {}),
72	      ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
73	      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
74	      ...(body.attachments ? { attachments: body.attachments } : {}),
75	      ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
76	      ...(body.configValues ? { configValues: body.configValues } : {}),
77	      ...(body.knowledgeDocs ? { knowledgeDocs: body.knowledgeDocs } : {}),
78	      deps,
79	    });
80	    if (result.status === 'conflict') return sendError(res, 'DUPLICATE_BUILD', 'Já existe uma construção em curso para esta aplicação.');
81	    if (result.status === 'answered') return res.status(200).json({ status: 'answered', reason: result.reason });
82	    res.status(202).json({ status: 'created', job: result.job });
83	    result.fire();
84	  });
85	
86	  r.get('/:id', async (req: AuthedRequest, res: Response) => {
87	    const job = await getJob(req.params.id as string);
88	    const actor = actorOf(req);
89	    if (!job || (job.userId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
90	    res.json(jobView(job));
91	  });
92	
93	  r.post('/:id/cancel', (req: AuthedRequest, res: Response) => {
94	    res.json(cancelRun(req.params.id as string, actorOf(req)));
95	  });
96	
97	  return r;
98	}
```

#### shared/src/jobs.ts — JobCreateResponse(type_alias), JobCreateRequest(type_alias), JobCancelResponse(type_alias)

```typescript
1	// Build jobs domain contract (ch03 §3.8.8, §3.6.2): job resource, create, cancel, event stream.
2	import { z } from 'zod';
3	import { UploadRef } from './common.js';
4	import { JobEvent } from './events.js';
5	import type { DomainDescriptorMap } from './descriptor.js';
6	
7	export const Job = z
8	  .object({
9	    id: z.string(),
10	    status: z.string(),
11	    artifactId: z.string().optional(),
12	    slug: z.string().optional(),
13	    createdAt: z.string(),
14	    /** brand-research: whether the merge wrote anything onto org.branding. */
15	    brandingApplied: z.boolean().optional(),
16	    /** brand-research: whether usable brand COLORS were applied. `false` means the site yielded
17	     *  no non-neutral color the research could trust — the fail-loud signal the old platform
18	     *  raised as NO_PRIMARY_COLOR; the client tells the user to set colors manually. */
19	    colorsApplied: z.boolean().optional(),
20	    /** brand-research: non-fatal degradation codes (e.g. NO_PRIMARY_COLOR). */
21	    warnings: z.array(z.string()).optional(),
22	    /** The terminal failure cause (F7): the record has always persisted it, but jobView omitted
23	     *  it, so a failed job looked cause-less to clients. Present only on a failed job. */
24	    error: z.object({ code: z.string(), message: z.string() }).optional(),
25	  })
26	  .passthrough();
27	export type Job = z.infer<typeof Job>;
28	
29	export const JobCreateRequest = z.object({
30	  // POST /jobs creates BUILD jobs only (ch03 §3.8.8). Brand-research jobs are created
31	  // exclusively via POST /branding/research (§3.8.4, org-admin) and merely reuse the
32	  // jobs RESOURCE for state/events — they are not creatable through this endpoint.
33	  kind: z.literal('build'),
34	  description: z.string(),
35	  sessionId: z.string(),
36	  language: z.enum(['pt', 'en']).default('pt'),
37	  templateId: z.string().optional(),
38	  integrationKeys: z.array(z.string()).optional(),
39	  artifactId: z.string().optional(),
40	  attachments: z.array(UploadRef).optional(),
41	  fieldValues: z.record(z.unknown()).optional(),
42	  configValues: z.record(z.unknown()).optional(),
43	  // F1 knowledge-during-build: scoping-provided reference documents a domain-heavy FIRST build
44	  // ingests into the org knowledge area (org-scoped server-side by the run's actor). Additive +
45	  // optional. Bounded at the boundary: max 20 docs, 256 KiB of text each.
46	  knowledgeDocs: z
47	    .array(
48	      z.object({
49	        title: z.string().min(1).max(300),
50	        text: z.string().min(1).max(262144),
51	        collection: z.string().min(1).max(100).optional(),
52	      }),
53	    )
54	    .max(20)
55	    .optional(),
56	});
57	export type JobCreateRequest = z.infer<typeof JobCreateRequest>;
58	
59	export const JobCreateResponse = z.discriminatedUnion('status', [
60	  z.object({ status: z.literal('created'), job: Job }),
61	  z.object({ status: z.literal('answered'), reason: z.string() }),
62	]);
63	export type JobCreateResponse = z.infer<typeof JobCreateResponse>;
64	
65	export const JobCancelResponse = z.object({ cancelled: z.boolean() });
66	export type JobCancelResponse = z.infer<typeof JobCancelResponse>;
67	
68	export const jobsEndpoints = {
69	  create: {
70	    method: 'POST',
71	    path: '/api/v1/jobs',
72	    auth: 'user',
73	    request: JobCreateRequest,
74	    response: JobCreateResponse,
75	    language: true,
76	  },
77	  get: {
78	    method: 'GET',
79	    path: '/api/v1/jobs/:id',
80	    auth: 'user',
81	    response: Job,
82	  },
83	  cancel: {
84	    method: 'POST',
85	    path: '/api/v1/jobs/:id/cancel',
86	    auth: 'user',
87	    response: JobCancelResponse,
88	  },
89	  events: {
90	    method: 'GET',
91	    path: '/api/v1/jobs/:id/events',
92	    auth: 'token-query',
93	    kind: 'sse',
94	    response: JobEvent,
95	  },
96	} as const satisfies DomainDescriptorMap;
```

#### api/src/agents/build.ts — auditBuild(function), BuildCreateInput(references), calls(calls), BuildCreateInput(interface), Actor(references)

```typescript
46	/** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
47	 *  or any prompt text). The single audit write path (FIXED-8); best-effort so bookkeeping never
48	 *  fails a build. `type` is created | completed | failed | cancelled. */
49	function auditBuild(input: BuildCreateInput, type: string, metadata: Record<string, unknown>): void {
50	  void logActivity(
51	    { userId: input.actor.userId, username: input.username, orgId: input.actor.orgId },
52	    'build',
53	    type,
54	    input.deps,
55	    metadata,
56	  ).catch(() => undefined);
57	}
58	
59	export interface BuildCreateInput {
60	  actor: Actor;
61	  username: string;
62	  sessionId: string;
63	  description: string;
64	  language: string;
65	  templateId?: string;
66	  integrationKeys?: string[];
67	  artifactId?: string;
68	  attachments?: unknown[];
69	  fieldValues?: Record<string, unknown>;
70	  configValues?: Record<string, unknown>;
71	  /** F1 knowledge-during-build: scoping-provided reference documents to ingest into the org
72	   *  knowledge area DURING a domain-heavy first build (org-scoped by the run's actor, immediately
73	   *  searchable to the run's knowledge tools). Additive + optional; carried by JobCreateRequest
74	   *  (shared/src/jobs.ts, size/count-capped there) and forwarded by the jobs route. */
75	  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
76	  deps: { now: () => number; genId: () => string };
77	}
78	
79	export type BuildCreateResult =
80	  | { status: 'created'; job: ReturnType<typeof jobView>; fire: () => void }
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The explicit cross-org checks are holding up. I’m looking for the remaining gap the slice might have missed: whether non-admin filing can be abused without a verified session, and whether convert can be falsely marked “converted” by linking an unrelated or fabricated job id.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,260p' api/src/apps/registry.ts" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,220p' api/assets/panel-runtime/src/change-request.js" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/*
 * Operator Assistant Panel - CHANGE-REQUEST controller (operator-run H4; NON-admins).
 *
 * The network side of the "Pedir alteração" affordance shown to a viewer who CANNOT edit this
 * app (admin === false from H2). It files a change request into the app OWNER's org-admin queue
 * so a user is never a dead end. Factored out of AssistantPanel.jsx so it is unit-provable
 * against a fake fetch (tests/apps/change-request.test.ts).
 *
 * It targets ONE thin platform endpoint - `POST /api/v1/change-requests` - scoped by the served
 * app's `X-Ekoa-App-Id` header (the server resolves the app + OWNER org) and REQUIRING a
 * logged-in platform user (an OPTIONAL Bearer read best-effort, same as H2/H3). This is a
 * SEPARATE plane from the visitor-blind served-app assistant plane, which stays byte-for-byte
 * untouched (it never reads the caller JWT). Nothing here grounds, bills, or issues a model turn.
 *
 * Filing REQUIRES a session: no readable token (not logged in / cross-origin / sandboxed iframe)
 * or a 401 both resolve to the calm `needs-login` outcome the panel renders as
 * "Inicie sessão no Ekoa para pedir alterações." - never a throw, never a crash. PT-PT
 * throughout, no emoji, no em/en-dash.
 */

/** The thin platform endpoint that files a change request (X-Ekoa-App-Id scoped, auth 'user'). */
export const CHANGE_REQUESTS_ENDPOINT = '/api/v1/change-requests';

/** The shared PT-PT copy for the request affordance (kept here so the flow's wording is one place). */
export const REQUEST_COPY = {
  open: 'Pedir alteração',
  intro: 'Não pode editar esta aplicação, mas pode pedir uma alteração ao administrador.',
  placeholder: 'Descreva a alteração que gostaria de ver nesta aplicação.',
  submit: 'Enviar pedido',
  cancel: 'Cancelar',
  close: 'Fechar',
  filed: 'Pedido enviado ao administrador. Obrigado.',
  needsLogin: 'Inicie sessão no Ekoa para pedir alterações.',
  failed: 'Não foi possível enviar o pedido. Tente novamente.',
};

/**
 * File a change request for `appId`. POSTs the platform endpoint with the served-app header + the
 * OPTIONAL admin/user Bearer. Returns a discriminated outcome the panel maps to a calm PT-PT note:
 *   - `{ outcome:'filed', request }`      the queue accepted it (2xx).
 *   - `{ outcome:'needs-login' }`         no readable token OR a 401 - "inicie sessão" message.
 *   - `{ outcome:'failed', status }`      any other non-2xx / missing app id / network error.
 * Fail-soft: a missing app id / unreadable token / network throw never rejects; it degrades.
 */
export async function fileChangeRequest({ fetchImpl, appId, token, text, route, screenState }) {
  const body = (text || '').trim();
  if (!body) return { outcome: 'failed', status: 0 };
  // No session token (not logged in / cross-origin) -> the calm login message BEFORE a doomed call.
  if (!token) return { outcome: 'needs-login' };
  // No served-app id (a standalone preview) -> nothing to scope the request to.
  if (!appId) return { outcome: 'failed', status: 0 };

  let res;
  try {
    res = await fetchImpl(CHANGE_REQUESTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ekoa-App-Id': appId,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: body,
        ...(route ? { route: String(route).slice(0, 1000) } : {}),
        ...(screenState ? { screenState: String(screenState).slice(0, 8000) } : {}),
      }),
    });
  } catch {
    return { outcome: 'failed', status: 0 };
  }

  if (res && res.status === 401) return { outcome: 'needs-login' }; // session expired -> inicie sessão
  if (!res || !res.ok) return { outcome: 'failed', status: res ? res.status : 0 };

  let request = null;
  try {
    request = await res.json();
  } catch {
    request = null; // a filed request with an unreadable body is still filed
  }
  return { outcome: 'filed', request };
}

 succeeded in 0ms:
/**
 * App registry (ch07, ch04 §4.2.6). Resolves a served-app scope from the `X-Ekoa-App-Id`
 * header (slug OR canonical id; slug resolved server-side to the canonical id). Holds the
 * per-app compiled collection rules (from the manifest). In-memory (FIXED-8) + backed by the
 * `artifacts`/`slugs` stores. A client-supplied id starting with `usr.` is rejected upstream.
 */
import { artifacts, slugs } from '../data/stores.js';
import type { CollectionsBlock } from '../data/collections-engine.js';
import { appRegistry } from './app-registry.js';

export interface ResolvedApp {
  appId: string; // canonical artifact id (or the registry id for registry-only apps)
  ownerUserId: string;
  sharedData: boolean;
  /** True when a persisted artifact record backs the app. False for REGISTRY-ONLY
   *  apps (the dev-serve surface, hard-off in production): they have no artifact
   *  owner, so the Amendment 2 owner-activation admission has no subject and the
   *  callers skip it - carried old-plane behavior for that dev-only surface. */
  artifactBacked: boolean;
  collections?: CollectionsBlock;
}

/** Resolve a slug-or-id header to a canonical app. Returns null if unknown. */
export async function resolveApp(idOrSlug: string): Promise<ResolvedApp | null> {
  // Try slug first (the slugs reservation collection maps slug → artifactId).
  const slugRow = await slugs.get(idOrSlug);
  const artifactId = slugRow ? (slugRow.artifactId as string) : idOrSlug;
  const art = await artifacts.get(artifactId);
  if (art) {
    return {
      appId: art._id,
      ownerUserId: (art.userId as string) ?? '',
      sharedData: Boolean(art.sharedData),
      artifactBacked: true,
      collections: art.collections as CollectionsBlock | undefined,
    };
  }
  // Registry-only fallback (dev-serve, ch07 §7.4 trigger 6): a running app with no
  // artifact record. The old plane keyed data on the raw header with no artifact
  // requirement; this keeps that surface working without weakening the artifact-
  // backed admission (the flag tells callers which world they are in).
  const reg = appRegistry.getApp(idOrSlug);
  if (!reg) return null;
  return {
    appId: reg.id,
    ownerUserId: reg.userId,
    sharedData: (reg.manifest as { sharedData?: boolean } | null)?.sharedData === true,
    artifactBacked: false,
  };
}

exec
/bin/zsh -lc "sed -n '1,260p' api/src/agents/jobs.ts" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/**
 * Persistent job registry (ch05 §5.2.1, P-10) over the `jobs` collection (ch04 §4.3.1), plus
 * the boot orphan sweep and the in-process zombie net. Build and brand-research jobs persist at
 * creation and on every status change; the persisted `JobRecord` outlives the in-memory
 * `LiveRunEntry` and serves `GET /jobs/:id` after completion.
 *
 * There is still NO queue (FIXED-8): jobs run immediately in-process. What P-10 adds is
 * cross-restart crash accountability — a Cortex restart used to orphan on-disk `running` jobs
 * forever (reference/invisible-behaviors.md §7.2, Conflicts #14).
 */
import { jobs, artifacts, automationRuns } from '../data/stores.js';
import type { Doc } from '../data/store.js';

export type JobStatus = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobKind = 'build' | 'brand-research';

/** Automation-run pause states are non-terminal too (§5.2). */
const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

export interface JobRecord extends Doc {
  kind: JobKind;
  status: JobStatus;
  userId: string;
  sessionId?: string;
  artifactId?: string;
  request: {
    description: string;
    language: string;
    templateId?: string;
    integrationKeys?: string[];
    attachments?: unknown[];
    fieldValues?: Record<string, unknown>;
    configValues?: Record<string, unknown>;
  };
  routing?: { tier: string; reason: string };
  result?: {
    text?: string;
    slug?: string;
    appUrl?: string;
    /** brand-research: the parsed structured result + whether it was merged onto org branding. */
    branding?: Record<string, unknown>;
    brandingApplied?: boolean;
    /** brand-research: whether a usable primaryColor was applied (the fail-loud color outcome). */
    colorsApplied?: boolean;
    /** brand-research: non-fatal degradation codes (e.g. NO_PRIMARY_COLOR). */
    warnings?: string[];
    /** brand-research: whether the target site was reachable (false = honest knowledge fallback). */
    siteReachable?: boolean;
  };
  error?: { code: string; message: string };
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

/** Persist a job record at creation (P-10). */
export async function persistJob(record: JobRecord): Promise<void> {
  await jobs.put(record);
}

/** Patch a job's status/fields and re-persist (P-10: on every status change). */
export async function patchJob(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
  return (await jobs.update(id, (cur) => ({ ...cur, ...patch }) as JobRecord)) as JobRecord | null;
}

export async function getJob(id: string): Promise<JobRecord | null> {
  return (await jobs.get(id)) as JobRecord | null;
}

/**
 * Safe, fixed user-facing message per terminal error CODE. jobView NEVER returns the persisted
 * `error.message` on the wire: a VERIFY_FAILED message embeds the verifier's model-derived note,
 * which can contain app-data PII (a NIF/IBAN the verifier quoted). The client gets the honest
 * cause via the structured `code` + a generic PT message; the raw note stays server-side.
 */
const SAFE_ERROR_MESSAGE: Record<string, string> = {
  BUILD_UNFULFILLED: 'A construção não produziu a aplicação pedida.',
  VERIFY_FAILED: 'A verificação da aplicação falhou.',
  BILLING_BLOCKED: 'A faturação está bloqueada.',
  ADAPTER_ERROR: 'Ocorreu um erro ao contactar o modelo.',
  PIPELINE_STUCK: 'A construção terminou num estado inconsistente.',
  ORPHANED: 'A construção foi interrompida por um reinício do processo.',
};

/** Wire-facing projection (`shared/jobs.ts` Job) of a persisted record. */
export function jobView(j: JobRecord): {
  id: string;
  status: string;
  artifactId?: string;
  slug?: string;
  createdAt: string;
  brandingApplied?: boolean;
  colorsApplied?: boolean;
  warnings?: string[];
  error?: { code: string; message: string };
} {
  return {
    id: j._id,
    status: j.status,
    ...(j.artifactId ? { artifactId: j.artifactId } : {}),
    ...(j.result?.slug ? { slug: j.result.slug } : {}),
    createdAt: j.createdAt,
    // brand-research fail-loud outcome: a client that missed the stream's complete event (page
    // reload, reconnect) still learns whether colors were applied from GET /jobs/:id.
    ...(j.result?.brandingApplied !== undefined ? { brandingApplied: j.result.brandingApplied } : {}),
    ...(j.result?.colorsApplied !== undefined ? { colorsApplied: j.result.colorsApplied } : {}),
    ...(j.result?.warnings && j.result.warnings.length > 0 ? { warnings: j.result.warnings } : {}),
    // F7: surface the CAUSE (structured code + a safe generic message) so a failed job is not
    // cause-less — NEVER the raw persisted message, which can carry model-derived PII (Codex
    // checkpoint finding). The detailed message stays server-side on the JobRecord.
    ...(j.error ? { error: { code: j.error.code, message: SAFE_ERROR_MESSAGE[j.error.code] ?? 'A construção falhou.' } } : {}),
  };
}

/** True when a NON-terminal build/brand-research job already targets this artifact (§5.3.5 the
 *  persisted complement of the in-memory live query). */
export async function nonTerminalJobForArtifact(artifactId: string): Promise<JobRecord | null> {
  const rows = (await jobs.find({ artifactId })) as JobRecord[];
  return rows.find((j) => !TERMINAL.has(j.status)) ?? null;
}

/**
 * Boot orphan sweep (§5.2.1): every `jobs` and `automation_runs` document still non-terminal is
 * marked `failed { code: 'ORPHANED' }`, and the associated artifact (if any) is reset to
 * `draft`. Idempotent — a second call finds nothing left to sweep. Returns the counts. Called
 * once at boot by the composition root.
 */
export async function sweepOrphans(now: () => number): Promise<{ jobs: number; runs: number; artifacts: number }> {
  const endedAt = new Date(now()).toISOString();
  let sweptJobs = 0;
  let sweptRuns = 0;
  const resetArtifacts = new Set<string>();

  for (const raw of await jobs.find({})) {
    const j = raw as JobRecord;
    if (TERMINAL.has(j.status)) continue;
    await jobs.update(j._id, (cur) => ({
      ...cur,
      status: 'failed',
      error: { code: 'ORPHANED', message: 'Job orphaned by a process restart (ch05 §5.2.1).' },
      endedAt,
    }) as JobRecord);
    sweptJobs++;
    if (j.artifactId) resetArtifacts.add(j.artifactId);
  }

  for (const raw of await automationRuns.find({})) {
    const r = raw as Doc & { status?: string; artifactId?: string };
    if (r.status && TERMINAL.has(r.status)) continue;
    await automationRuns.update(r._id, (cur) => ({
      ...cur,
      status: 'failed',
      error: { code: 'ORPHANED', message: 'Automation run orphaned by a process restart (ch05 §5.2.1).' },
      endedAt,
    }));
    sweptRuns++;
    if (r.artifactId) resetArtifacts.add(r.artifactId);
  }

  let artifactsReset = 0;
  for (const artifactId of resetArtifacts) {
    const updated = await artifacts.update(artifactId, (cur) => ({ ...cur, status: 'draft' }));
    if (updated) artifactsReset++;
  }

  return { jobs: sweptJobs, runs: sweptRuns, artifacts: artifactsReset };
}

/** Reset an artifact to `draft` (zombie net + build error path). */
export async function resetArtifactToDraft(artifactId: string): Promise<void> {
  await artifacts.update(artifactId, (cur) => ({ ...cur, status: 'draft' }));
}

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

 succeeded in 0ms:
# H4 impl-notes - request-changes QUEUE (users file; org-admin converts) + refused-build feed

Slice H4 (mixed, size 5, dep H1). GREENFIELD: no existing queue. Built on the `Store<T>` +
notifications-SSE + registo org-admin-read primitives (H1 map §6). DONE-GREEN.

## What was built

A user files a change request from INSIDE a served app; the app OWNER's org-admins see it in a
dashboard queue and convert one into a patch run (an H1-gated follow-up build). Additive contract
only; no new capability/permission logic.

### 1. Shared contract - new `changeRequests` domain (additive)
- `shared/src/change-request.ts` (new): `ChangeRequestStatus` (`open|converted|dismissed`),
  `ChangeRequest` (`.strict()`), `ChangeRequestFileRequest`, `ChangeRequestConvertRequest`,
  `ChangeRequestQuery`, `ChangeRequestListResponse`, and `changeRequestsEndpoints` (file/list/
  convert/dismiss).
  - `appId`/`route`/`screenState`/`jobId` are OPTIONAL. `appId` is optional because the
    refused-build feed (a dashboard first-build refusal) has no served app yet; the panel filing
    always carries it. `orgId`/`requesterUserId`/`requesterName` are required and server-stamped.
- `shared/src/index.ts`: import + `export *` + `ALL_ENDPOINTS.changeRequests` (25 -> 26 domains).
- `shared/src/events.ts`: additive `change_request` `NotificationEvent` member (`{ type, appId? }`)
  - the live queue-refetch push. Additive union member; existing parses unaffected.
- `shared/src/contract.test.ts`: the "loads all N domain descriptor maps" count 25 -> 26.

### 2. File a request (any logged-in user)
- `POST /api/v1/change-requests` (auth `user`), registered BEFORE the org-admin gate so a plain
  `user` can file (filing needs NO capability; the queue READ is admin-gated). Scoped by the
  OPTIONAL `X-Ekoa-App-Id` header:
  - present -> `resolveApp` resolves the app + its OWNER; the request lands in the OWNER org queue
    (fail-closed: unknown / registry-only / ownerless id -> 404, like the app-assistant plane).
  - absent -> the dashboard refused-build filing: lands in the requester's OWN org (body `appId`
    kept only as an informational label; convert re-gates it).
- `requesterUserId`/`requesterName`/`orgId` come from the verified JWT / resolved owner - NEVER the
  caller body. Lands `status:'open'` + fires a `change_request` SSE to the OWNER org's org-admins.
- Panel side (`api/assets/panel-runtime/`): a `change-request.js` fetch-injectable controller
  (`fileChangeRequest` -> `filed | needs-login | failed`) + a NON-admin "Pedir alteração"
  affordance in `AssistantPanel.jsx` (gated by `admin === false`), OFF by default, opened only by
  an explicit click; submit captures `currentRoute()` + `captureScreenState()`. No token / a 401
  both land on the calm "Inicie sessão no Ekoa para pedir alterações." A SEPARATE plane from the
  visitor-blind `POST /api/app-assistant` (which is byte-for-byte untouched - it still never reads
  the caller JWT).

### 3. Org-admin queue (read + convert + dismiss)
- `GET /api/v1/change-requests` (auth `org-admin`): mirrors `registo.ts` EXACTLY -
  `requireRole('org-admin','super-admin')` for the ROLE gate; the org SCOPE is enforced in the
  service (org-admin OWN org only; super-admin across orgs, optional `?orgId=`). Optional `status`
  filter. Newest first.
- `POST /:id/convert` (`{ jobId }`) / `POST /:id/dismiss`: org-scoped via a shared `loadOwnOrg`
  guard - a missing row OR a cross-org row reads as the SAME 404 (no cross-org existence oracle).
- Web dashboard: `web/app/(dashboard)/pedidos/page.tsx` (mirrors `registo/page.tsx`), a new
  `adminOnly` nav item in `web/lib/navigation.ts` (`/pedidos`, raw PT label "Pedidos", like
  registo/orgs), `web/stores/change-requests.ts`, and the `changeRequests` domain wired into the
  typed client `web/lib/api/index.ts`. "Converter" POSTs `/api/v1/jobs {kind:'build', description,
  sessionId, artifactId?}` directly (H1-gated: the org-admin has canBuildApps+canEditApps and
  loadWritable on an org app) then POSTs `/:id/convert {jobId}`. The page subscribes to the
  notifications stream and refetches on `change_request` (live queue).

### 4. Refused-build feed (thin wire)
- Server: the file endpoint's own-org path (no `X-Ekoa-App-Id`) IS the durable wire - a refusal
  (`FORBIDDEN` + `details.capability`, already emitted by jobs/chat/artifacts routes) can file a
  pre-drafted request to the requester's OWN org queue, so a refusal is never a dead end.
- Client: `web/stores/change-requests.ts` exposes `fileFromRefusal({ text, appId?, route? })`.
- DELIBERATELY NOT wired into the shared chat execution hook (`web/hooks/useAgentExecution.ts`) /
  chat message renderer: those are OUTSIDE H4's reserved set and concurrently owned; the brief
  scopes this piece as a "THIN wire (client OR a small server helper)" with NO required test. The
  durable mechanism (own-org endpoint + store action) is in place and integration-tested; dropping
  the offer button into the chat error path is a one-call hook the chat owner adds without touching
  H4's contract. Adding capability logic was explicitly forbidden and none was added.

## Cross-org isolation guarantee (the security crux) + how it is tested

A `ChangeRequest.orgId` is ALWAYS stamped server-side (the app OWNER's org for a served-app
filing - resolved from the owner user record; the requester's OWN org for a refused-build filing -
from the JWT) and is NEVER read from the caller body. Every read/convert/dismiss is org-scoped in
`services/change-requests.ts` exactly as `readRegisto` scopes: org-admin -> OWN org only;
super-admin -> across orgs. Cross-org convert/dismiss collapse to a uniform 404 (no existence
oracle). Tested (`api/tests/routes/change-requests.test.ts`, real router + mongo-mem):
- topology: `reqU` (plain user, orgA) files about `appX` which is OWNED by `admB` in orgB -> the
  request lands in orgB (the OWNER org, NOT reqU's orgA);
- `admB` (orgB) sees it; `admA` (orgA) sees NONE of it (`total===0`, no reqU row, all rows orgB);
- a plain `user` GET the queue -> 403 FORBIDDEN (shared envelope);
- `admA` converting orgB's request -> uniform 404; `admB` converting -> `converted` + `jobId`;
- the refused-build own-org filing lands in reqU's orgA and surfaces to admA, not admB.

## Flows

- File (panel): non-admin clicks "Pedir alteração" -> compose -> submit -> `change-request.js`
  POSTs `/api/v1/change-requests` with `X-Ekoa-App-Id` + Bearer + `{text, route, screenState}` ->
  200 -> "Pedido enviado"; 401/no token -> "Inicie sessão".
- Convert (dashboard): org-admin clicks "Converter" -> POST `/jobs {artifactId?, description}`
  (H1-gated follow-up/first build) -> POST `/:id/convert {jobId}` -> row flips to `converted` +
  `jobId`.
- Refused-build feed: an H1 `FORBIDDEN`+`capability` refusal -> `fileFromRefusal` POSTs the file
  endpoint with NO app header -> lands in the requester OWN org queue.

## Contract / coverage gate updates
- `api/tests/contract/schema-coverage.test.ts`: added the 4 `changeRequests.*` keys to COVERED so
  `EXPECTED_PENDING_COUNT` stays 49 (a new endpoint => a new contract test, same slice).
- `api/tests/contract/mount-coverage.test.ts`: unchanged - all 4 endpoints mount under `/api/v1`
  behind `requireAuth`, so the unauthenticated probe sees 401 (mounted), never the terminal 404.
- New contract test `api/tests/contract/change-requests.test.ts` (shapes + live-response schema
  validation); new integration test `api/tests/routes/change-requests.test.ts` (a NEW `tests/routes/`
  dir); new panel test `api/tests/apps/change-request.test.ts` (controller fake-fetch + source pins).

## Reserved-path compliance
In-set: `shared/src/change-request.ts` (+ `index.ts`, `events.ts`, `contract.test.ts`),
`api/src/data/stores.ts`, `api/src/routes/change-requests.ts` (+ `server.ts` mount),
`api/src/services/change-requests.ts`, `api/src/agents/streaming.ts` (emit helper),
`api/assets/panel-runtime/src/{change-request.js, AssistantPanel.jsx, AssistantPanel.css}`,
`web/app/(dashboard)/pedidos/page.tsx`, `web/stores/change-requests.ts`, `web/lib/navigation.ts`,
`web/lib/api/index.ts`, `web/__tests__/navigation.test.ts`, `api/tests/**`,
`docs/diagrams/03-request-crud.excalidraw`.

Out-of-declared-set (justified):
- `web/lib/navigation.ts` (the nav item; the actual `NAV_ITEMS` source, not `sidebar.tsx`) and
  `web/lib/api/index.ts` (typed-client domain map) - both required to surface the queue and were
  named in the lead's expanded web set.
- `api/src/agents/streaming.ts` - the emit helpers for the notifications channel live here (route
  imports it; a route may import `agents/`, precedent `jobs.ts`). No `data/` access from the route.
- `web/__tests__/navigation.test.ts` - pinned the new admin nav item (the web-test analog; the
  sibling registo page has no dedicated web page/store test, so no page-render test was added).
- Locale copy: followed the registo precedent (inline PT-PT strings + a raw nav `label`), NOT the
  locale files - registo/orgs (the named closest precedents) keep Amendment-2 admin surfaces out of
  `web/locales/*`. Documented so a reviewer sees the deliberate parity choice.

Import boundaries respected: the route imports `apps/registry` (resolveApp) + `agents/streaming`
(emit) + the service; the service imports only `data/stores` (+ shared). No route touches `data/`.
Chokepoint clean (nothing outside `api/src/llm` touches the provider).

## Diagram (FIXED-12)
`docs/diagrams/03-request-crud.excalidraw` - one free-standing note (`h4_change_requests`, indigo
`#4338CA`, monospace, x=70 y=1430, below all existing elements, no overlap) documenting the
file -> owner-org queue -> convert flow, the registo-mirrored org scoping + CROSS-ORG ISOLATION, and
the refused-build own-org path. +1 element, valid JSON.

## Verification (all green)
- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0; `-p tsconfig.test.json` -> 0
- `npx eslint <touched api+shared .ts>` -> 0 errors (panel `.js/.jsx/.css` are config-ignored;
  esbuild `build.mjs` is their gate)
- `npx vitest run tests/` (FULL api lane) -> 177 files, 1601 passed, 1 skipped, 0 failed
- `node assets/panel-runtime/build.mjs` -> built (248463 bytes)
- repo-root `npm run gate:chokepoint` -> clean
- `cd shared && npx vitest run` -> 2 files, 36 passed
- `cd web && npx tsc --noEmit` -> 0; `npx eslint <touched>` -> 0; `npm test` -> 30 files, 168 passed

codex
I found one concrete isolation break: filing into another org’s queue is currently possible for any authenticated user who knows a target app id or slug. I’m pulling exact line numbers now and checking whether there’s a second real issue or whether the rest of the slice is sound enough to approve.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/routes/change-requests.ts | sed -n '30,80p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    30	
    31	export function changeRequestsRouter(deps: { now: () => number; genId: () => string }): Router {
    32	  const r = Router();
    33	
    34	  // FILE a change request (any authenticated user). Registered BEFORE the org-admin gate below.
    35	  r.post('/', requireAuth, async (req: AuthedRequest, res: Response) => {
    36	    const body = parseBody(res, ChangeRequestFileRequest, req.body);
    37	    if (!body) return;
    38	    const requester = { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId };
    39	
    40	    // The OPTIONAL served-app header decides the target org. Present => resolve the app + its OWNER
    41	    // (fail-closed: unknown / registry-only / ownerless id is a 404, exactly like the app-assistant
    42	    // plane). Absent => the dashboard refused-build filing to the requester's own org (target null).
    43	    let target: { ownerUserId: string; appId: string } | null = null;
    44	    const header = req.header('x-ekoa-app-id');
    45	    if (header !== undefined && header !== '') {
    46	      const app = await resolveApp(header);
    47	      if (!app || !app.artifactBacked || !app.ownerUserId) {
    48	        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
    49	      }
    50	      target = { ownerUserId: app.ownerUserId, appId: app.appId };
    51	    }
    52	
    53	    const { request, notifyUserIds } = await fileChangeRequest(requester, target, body, deps);
    54	    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
    55	    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
    56	    res.json(request);
    57	  });
    58	
    59	  // The org-admin queue (read + convert + dismiss). org-admin own org; super-admin across orgs.
    60	  r.use(requireAuth, requireRole('org-admin', 'super-admin'));
    61	
    62	  r.get('/', async (req: AuthedRequest, res: Response) => {
    63	    const q = req.query as { status?: string; orgId?: string; limit?: string; offset?: string };
    64	    const result = await readChangeRequests(actorOf(req), {
    65	      status: q.status as ChangeRequestStatus | undefined,
    66	      orgId: q.orgId,
    67	      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    68	      offset: q.offset ? parseInt(q.offset, 10) : undefined,
    69	    });
    70	    res.json(result);
    71	  });
    72	
    73	  r.post('/:id/convert', async (req: AuthedRequest, res: Response) => {
    74	    const body = parseBody(res, ChangeRequestConvertRequest, req.body);
    75	    if (!body) return;
    76	    const result = await convertChangeRequest(actorOf(req), req.params.id as string, body.jobId);
    77	    if (result.status === 'not-found') return notFound(res);
    78	    res.json(result.request);
    79	  });
    80	

exec
/bin/zsh -lc "nl -ba api/src/services/change-requests.ts | sed -n '46,80p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

exec
/bin/zsh -lc "nl -ba api/src/apps/registry.ts | sed -n '20,45p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    20	  collections?: CollectionsBlock;
    21	}
    22	
    23	/** Resolve a slug-or-id header to a canonical app. Returns null if unknown. */
    24	export async function resolveApp(idOrSlug: string): Promise<ResolvedApp | null> {
    25	  // Try slug first (the slugs reservation collection maps slug → artifactId).
    26	  const slugRow = await slugs.get(idOrSlug);
    27	  const artifactId = slugRow ? (slugRow.artifactId as string) : idOrSlug;
    28	  const art = await artifacts.get(artifactId);
    29	  if (art) {
    30	    return {
    31	      appId: art._id,
    32	      ownerUserId: (art.userId as string) ?? '',
    33	      sharedData: Boolean(art.sharedData),
    34	      artifactBacked: true,
    35	      collections: art.collections as CollectionsBlock | undefined,
    36	    };
    37	  }
    38	  // Registry-only fallback (dev-serve, ch07 §7.4 trigger 6): a running app with no
    39	  // artifact record. The old plane keyed data on the raw header with no artifact
    40	  // requirement; this keeps that surface working without weakening the artifact-
    41	  // backed admission (the flag tells callers which world they are in).
    42	  const reg = appRegistry.getApp(idOrSlug);
    43	  if (!reg) return null;
    44	  return {
    45	    appId: reg.id,

exec
/bin/zsh -lc "nl -ba api/tests/routes/change-requests.test.ts | sed -n '15,95p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    15	 * Operator-run H4 — the request-changes queue, driven through the REAL router (mongo-mem).
    16	 *
    17	 * The security crux is CROSS-ORG ISOLATION: a served-app filing lands in the app OWNER's org
    18	 * queue (never the requester's), an org-admin reads/acts on ONLY its own org, and a plain user
    19	 * cannot read the queue at all. requesterUserId + orgId are always server-stamped, never trusted
    20	 * from the caller body. The refused-build feed files to the requester's OWN org (no served app).
    21	 *
    22	 * Topology: reqU (plain user, orgA) is the filer; appX is an ORG app OWNED by admB in orgB. So a
    23	 * filing about appX must surface to admB (orgB), NOT to admA (orgA) — proving both the owner-org
    24	 * routing and the isolation boundary in one shape.
    25	 */
    26	let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
    27	const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
    28	const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
    29	
    30	const authed = (p: string, t: string, init: RequestInit = {}) =>
    31	  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
    32	const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
    33	const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
    34	const fileWithApp = (t: string, appId: string, body: Record<string, unknown>) =>
    35	  authed('/api/v1/change-requests', t, { method: 'POST', headers: { 'x-ekoa-app-id': appId }, body: JSON.stringify(body) });
    36	
    37	beforeAll(async () => {
    38	  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
    39	  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
    40	  const app = buildApp(cfg, deps);
    41	  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    42	  port = (server.address() as { port: number }).port;
    43	}, 60_000);
    44	afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
    45	
    46	beforeEach(async () => {
    47	  __resetActivationForTests(); __resetRevocationsForTests();
    48	  await users.deleteMany({}); await changeRequests.deleteMany({}); await artifacts.deleteMany({}); await userSettings.deleteMany({});
    49	  for (const [id, role, org] of [['reqU', 'user', 'orgA'], ['admA', 'org-admin', 'orgA'], ['admB', 'org-admin', 'orgB']] as const) {
    50	    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
    51	    setActivation(id, { active: true, billingLocked: false });
    52	    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
    53	  }
    54	  // An ORG app owned by admB in orgB (org-shared so an org-admin can loadWritable it later).
    55	  await artifacts.insert({ _id: 'appX', name: 'App X', slug: 'app-x', userId: 'admB', orgId: 'orgB', visibility: 'org', status: 'active', data: { projectDir: '/sbx/user-admB/appX' } } as never);
    56	});
    57	
    58	describe('H4 change-requests: file (served-app) lands in the OWNER org queue', () => {
    59	  it('a plain user files via X-Ekoa-App-Id -> the request lands in the app owner org, server-stamped', async () => {
    60	    const res = await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'Adicione um botão de exportação na tabela', route: '/faturas' });
    61	    expect(res.status).toBe(200);
    62	    const body = await readJson(res);
    63	    expect(ChangeRequest.safeParse(body).success, JSON.stringify(ChangeRequest.safeParse(body))).toBe(true);
    64	    expect(body.orgId).toBe('orgB');           // the OWNER org, NOT the requester's orgA
    65	    expect(body.requesterUserId).toBe('reqU'); // from the verified JWT, never the body
    66	    expect(body.requesterName).toBe('reqU');
    67	    expect(body.appId).toBe('appX');
    68	    expect(body.status).toBe('open');
    69	    expect(body.route).toBe('/faturas');
    70	  });
    71	
    72	  it('an unknown app id is a 404 (shared error envelope), never a silent misfile', async () => {
    73	    const res = await fileWithApp(await tokenFor('reqU'), 'no-such-app', { text: 'Olá' });
    74	    expect(res.status).toBe(404);
    75	    const body = await readJson(res);
    76	    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    77	    expect((body.error as { code: string }).code).toBe('NOT_FOUND');
    78	  });
    79	});
    80	
    81	describe('H4 change-requests: the org-admin queue read is org-scoped (cross-org isolation)', () => {
    82	  it('an org-admin sees its OWN org only; another org-admin never sees it', async () => {
    83	    await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido 1' }); // -> orgB
    84	
    85	    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
    86	    expect(ChangeRequestListResponse.safeParse(admBList).success).toBe(true);
    87	    const bItems = admBList.items as Array<Record<string, unknown>>;
    88	    expect(bItems.length).toBe(1);
    89	    expect(bItems.every((r) => r.orgId === 'orgB')).toBe(true);
    90	
    91	    // admA is in orgA — the crux: it MUST NOT see orgB's request.
    92	    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
    93	    const aItems = admAList.items as Array<Record<string, unknown>>;
    94	    expect(admAList.total).toBe(0);
    95	    expect(aItems.some((r) => r.requesterUserId === 'reqU')).toBe(false);

hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/routes/change-requests.ts | sed -n '72,84p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    72	
    73	  r.post('/:id/convert', async (req: AuthedRequest, res: Response) => {
    74	    const body = parseBody(res, ChangeRequestConvertRequest, req.body);
    75	    if (!body) return;
    76	    const result = await convertChangeRequest(actorOf(req), req.params.id as string, body.jobId);
    77	    if (result.status === 'not-found') return notFound(res);
    78	    res.json(result.request);
    79	  });
    80	
    81	  r.post('/:id/dismiss', async (req: AuthedRequest, res: Response) => {
    82	    const result = await dismissChangeRequest(actorOf(req), req.params.id as string);
    83	    if (result.status === 'not-found') return notFound(res);
    84	    res.json(result.request);

exec
/bin/zsh -lc "nl -ba api/src/services/change-requests.ts | sed -n '108,130p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   108	/** Mark a request converted, linking the follow-up-build job the dashboard already started
   109	 *  (H1-gated at POST /jobs). org-scoped: an org-admin converts only its own org's requests. */
   110	export async function convertChangeRequest(
   111	  actor: Actor,
   112	  id: string,
   113	  jobId: string,
   114	): Promise<{ status: 'ok'; request: ChangeRequest } | { status: 'not-found' }> {
   115	  if (!(await loadOwnOrg(actor, id))) return { status: 'not-found' };
   116	  const updated = await changeRequests.update(id, (r) => ({ ...r, status: 'converted', jobId }));
   117	  if (!updated) return { status: 'not-found' };
   118	  return { status: 'ok', request: changeRequestView(updated) };
   119	}
   120	
   121	/** Decline a request (status -> dismissed). org-scoped, like convert. */
   122	export async function dismissChangeRequest(
   123	  actor: Actor,
   124	  id: string,
   125	): Promise<{ status: 'ok'; request: ChangeRequest } | { status: 'not-found' }> {
   126	  if (!(await loadOwnOrg(actor, id))) return { status: 'not-found' };
   127	  const updated = await changeRequests.update(id, (r) => ({ ...r, status: 'dismissed' }));
   128	  if (!updated) return { status: 'not-found' };
   129	  return { status: 'ok', request: changeRequestView(updated) };
   130	}

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba web/stores/change-requests.ts | sed -n '72,110p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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
    95	      set({ actingId: null, error: job.error.message || 'Não foi possível iniciar a alteração.' });
    96	      return;
    97	    }
    98	    if (job.data.status !== 'created') {
    99	      // The in-build classifier answered without starting a job: nothing to link. Leave the
   100	      // request open and tell the admin to reformulate.
   101	      set({ actingId: null, error: 'O pedido foi respondido sem criar uma revisão. Reformule o pedido.' });
   102	      return;
   103	    }
   104	    // 2) Link the resulting job and flip the request to converted. Read the id out here, where the
   105	    //    union is narrowed to the 'created' variant (the narrowing does not survive into a closure).
   106	    const jobId = job.data.job.id;
   107	    const converted = await tryCall(() => api.changeRequests.convert({ id: request.id, jobId }));
   108	    set({ actingId: null });
   109	    if (!converted.ok) {
   110	      set({ error: converted.error.message || 'A revisão foi iniciada mas o pedido não foi marcado.' });

codex
- High — Cross-org queue injection is possible for any authenticated user. [api/src/routes/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:35) accepts `POST /api/v1/change-requests` from any logged-in user and, when `X-Ekoa-App-Id` is present, blindly resolves that app via [api/src/apps/registry.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/registry.ts:24) with no actor/org/access check. [api/src/services/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:54) then stamps the request into the resolved app owner’s `orgId`, not the requester’s. Attack scenario: a user in org A who learns or guesses an app slug/id from org B can send `POST /api/v1/change-requests` with `X-Ekoa-App-Id: <orgB-app>` and create a request in org B’s `/pedidos` queue, triggering live notifications to org B admins. That is a real cross-org write/isolation break. The test suite currently bakes this in as expected behavior instead of rejecting it: [api/tests/routes/change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:58).

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
83,572
- High — Cross-org queue injection is possible for any authenticated user. [api/src/routes/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:35) accepts `POST /api/v1/change-requests` from any logged-in user and, when `X-Ekoa-App-Id` is present, blindly resolves that app via [api/src/apps/registry.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/registry.ts:24) with no actor/org/access check. [api/src/services/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:54) then stamps the request into the resolved app owner’s `orgId`, not the requester’s. Attack scenario: a user in org A who learns or guesses an app slug/id from org B can send `POST /api/v1/change-requests` with `X-Ekoa-App-Id: <orgB-app>` and create a request in org B’s `/pedidos` queue, triggering live notifications to org B admins. That is a real cross-org write/isolation break. The test suite currently bakes this in as expected behavior instead of rejecting it: [api/tests/routes/change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:58).

VERDICT: NEEDS-WORK
