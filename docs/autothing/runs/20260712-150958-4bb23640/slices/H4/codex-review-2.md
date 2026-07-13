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
session id: 019f5da8-f9e8-7413-81cd-3a6078d7c178
--------
user
Adversarial SECURITY re-review in /Users/ggomes/dev/ekoa-code. You flagged a HIGH on H4: cross-org queue INJECTION - any logged-in user could POST /api/v1/change-requests with X-Ekoa-App-Id of another org's app and inject a request into that org's queue (orgId stamped from the resolved app owner, no requester access check). The fix is in commit 67ad136 (git show HEAD). VERIFY the High is CLOSED + no new defect: the served-app file path in api/src/routes/change-requests.ts now calls loadReadable(actorOf(req), app.appId) and rejects with a UNIFORM 404 when the requester cannot read the app (cross-org, another-user-private, unknown id) BEFORE resolving the owner org / stamping / notifying - so a user can no longer inject into another org's queue; a same-org user filing about their own or an org-shared app still succeeds. Confirm: (1) is the loadReadable gate BEFORE any stamp/notify and is the 404 uniform (no cross-org existence oracle)? (2) does the refused-build filing path (no X-Ekoa-App-Id, requester's own org) remain correct and NOT newly broken? (3) is orgId still server-stamped (never body)? (4) do the tests now assert cross-org file -> 404 + NO row + NO notification (not a tautology), and same-org success? (5) any NEW bypass - e.g. a slug vs id path, a registry-only app, an ownerless app, or loadReadable returning ok for something it shouldn't? Also re-confirm the READ/convert/dismiss cross-org isolation you did NOT flag is still intact. Read slices/H4/impl-notes.md (Codex-fix round). Read-only cmds OK. Concise: a bullet per point (CLOSED/OK/NOT + file:line) then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing the H4 fix in `67ad136` and the surrounding change-request paths. I’ll first load the project context files the repo requires, confirm whether CodeGraph is available, then inspect the exact route and tests before I assess each point.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "git show --stat --oneline 67ad136 && printf '\\n---\\n' && git show --stat --oneline HEAD" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-VDDUMXyj' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-XGu0FjqT' (errno=Operation not permitted)
67ad136 fix(operator-run/h4): codex High - close cross-org queue INJECTION. Served-app filing (X-Ekoa-App-Id) now requires loadReadable(requester, appId) ok (own or org-shared within the requester's own org) before resolving/stamping/notifying; a cross-org or another-user-private or unknown app id is a uniform 404 (no existence oracle). A user can no longer inject a request into another org's queue. Tests flipped (cross-org file -> 404 + no row/notification) + added (same-org org-shared/own -> ok)
 api/src/routes/change-requests.ts                  |  10 ++
 api/tests/routes/change-requests.test.ts           | 117 +++++++++++++--------
 .../slices/H4/impl-notes.md                        |  33 ++++++
 .../slices/H4/worker-status.txt                    |   7 ++
 4 files changed, 122 insertions(+), 45 deletions(-)

---
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-hBwru4Ma' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-IQaAMar2' (errno=Operation not permitted)
67ad136 fix(operator-run/h4): codex High - close cross-org queue INJECTION. Served-app filing (X-Ekoa-App-Id) now requires loadReadable(requester, appId) ok (own or org-shared within the requester's own org) before resolving/stamping/notifying; a cross-org or another-user-private or unknown app id is a uniform 404 (no existence oracle). A user can no longer inject a request into another org's queue. Tests flipped (cross-org file -> 404 + no row/notification) + added (same-org org-shared/own -> ok)
 api/src/routes/change-requests.ts                  |  10 ++
 api/tests/routes/change-requests.test.ts           | 117 +++++++++++++--------
 .../slices/H4/impl-notes.md                        |  33 ++++++
 .../slices/H4/worker-status.txt                    |   7 ++
 4 files changed, 122 insertions(+), 45 deletions(-)

exec
/bin/zsh -lc "pwd && ls -1 && [ -d .codegraph ] && echo CODEGRAPH_PRESENT || echo CODEGRAPH_ABSENT && find .. -maxdepth 2 \\( -name PRD.md -o -name PLANING.md -o -name TASKS.md \\) | sed 's#"'^#FILE #'"'" in /Users/ggomes/dev/ekoa-code
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
FILE ../pnmui-mon/TASKS.md

codex
The repo has `.codegraph/`, so I’m using CodeGraph first for the route and access-control flow. I did not find `PRD.md`, `PLANING.md`, or `TASKS.md` in this repo root; only an unrelated `../pnmui-mon/TASKS.md` exists outside the workspace, so there’s no project-local planning file to use or update for this review.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' docs/security/slices/H4/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
sed: docs/security/slices/H4/impl-notes.md: No such file or directory

exec
/bin/zsh -lc 'codegraph explore "change requests route loadReadable actorOf req X-Ekoa-App-Id loadReadable app.appId"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph explore "change-requests tests cross-org 404 no row notification same-org success"' in /Users/ggomes/dev/ekoa-code
 succeeded in 351ms:
## Exploration: change-requests tests cross-org 404 no row notification same-org success

Found 205 symbols across 109 files.

### Blast radius — what depends on these (update/verify before editing)

- `row` (api/tests/bridge/activity-buffer.test.ts:11) — 1 caller; tests: `api/tests/bridge/activity-buffer.test.ts`
- `Row` (api/tests/apps/backend-runtime.test.ts:22) — 2 callers; tests: `api/tests/apps/backend-runtime.test.ts`
- `request` (web/lib/api/core.ts:198) — 5 callers in `web/lib/api/index.ts`, `api/src/auth/middleware.ts`, `api/src/security-headers.ts`; ⚠️ no covering tests found

### Relationships

**references:**
- row → EgressLedgerRow
- Buffered → EgressLedgerRow
- bufferLedgerRow → EgressLedgerRow
- rowsForSession → EgressLedgerRow
- BridgeServerDeps → EgressLedgerRow
- boot → bufferLedgerRow
- BridgeServerDeps → ProviderHandler
- attachBridgeServer → BridgeServerDeps
- store → Row
- rowsOf → Row
- ... and 17 more

**calls:**
- bufferLedgerRow → now
- bufferLedgerRow → sweep
- rowsForSession → map
- buildApp → rowsForSession
- rowsOf → get
- request → splitArgs
- request → buildUrl
- request → getToken
- request → currentLanguage
- request → handleUnauthorized
- ... and 250 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### web/stores/toast.ts — success(function)

```typescript
1	'use client';
2	
3	import { create } from 'zustand';
4	
5	export type ToastTone = 'success' | 'error' | 'info';
6	
7	export interface ToastAction {
8	  label: string;
9	  onClick: () => void;
10	}
11	
12	export interface ToastItem {
13	  id: string;
14	  tone: ToastTone;
15	  message: string;
16	  duration: number;
17	  action?: ToastAction;
18	  testId?: string;
19	}
20	
21	interface ToastState {
22	  toasts: ToastItem[];
23	  add: (toast: Omit<ToastItem, 'id'>) => string;
24	  dismiss: (id: string) => void;
25	  clear: () => void;
26	}
27	
28	export const useToastStore = create<ToastState>((set) => ({
29	  toasts: [],
30	  add: (toast) => {
31	    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
32	    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
33	    return id;
34	  },
35	  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
36	  clear: () => set({ toasts: [] }),
37	}));
38	
39	export interface ToastOptions {
40	  duration?: number;
41	  action?: ToastAction;
42	  /** Optional stable test hook rendered as data-testid on the toast element. */
43	  testId?: string;
44	}
45	
46	function push(tone: ToastTone, message: string, defaultDuration: number, opts?: ToastOptions): string {
47	  const duration = opts?.duration ?? defaultDuration;
48	  const id = useToastStore.getState().add({ tone, message, duration, action: opts?.action, testId: opts?.testId });
49	  if (duration > 0 && typeof globalThis.setTimeout === 'function') {
50	    setTimeout(() => useToastStore.getState().dismiss(id), duration);
51	  }
52	  return id;
53	}
54	
55	/**
56	 * Fire a toast from anywhere (React or not). Durations: success 2.5s,
57	 * info 4s, error 6s - override via opts.duration (0 = sticky).
58	 */
59	export const toast = {
60	  success: (message: string, opts?: ToastOptions) => push('success', message, 2500, opts),
61	  error: (message: string, opts?: ToastOptions) => push('error', message, 6000, opts),
62	  info: (message: string, opts?: ToastOptions) => push('info', message, 4000, opts),
63	};
```

#### shared/src/org.ts — OrgUpdateRequest(type_alias), OrgCreateRequest(type_alias)

```typescript
142	    settings: z.record(z.unknown()).optional(),
143	  })
144	  .passthrough();
145	export type OrgUpdateRequest = z.infer<typeof OrgUpdateRequest>;
146	
147	export const BrandingSaveRequest = z.object({
148	  branding: OrgBranding,

... (gap) ...

162	  name: z.string(),
163	  displayName: z.string().optional(),
164	});
165	export type OrgCreateRequest = z.infer<typeof OrgCreateRequest>;
166	
167	export const OrgPatch = z.object({
168	  name: z.string().optional(),
```

#### shared/src/notifications.ts — notificationsEndpoints(constant)

```typescript
1	// notifications — the per-user push channel (ch03 §3.6.4). The fourth sanctioned SSE
2	// stream (CONV-4). Defined in §3.6.4 rather than a §3.8 resource table, so it lives here.
3	import type { DomainDescriptorMap } from './descriptor.js';
4	import { NotificationEvent } from './events.js';
5	
6	export { NotificationEvent };
7	
8	export const notificationsEndpoints = {
9	  events: {
10	    method: 'GET',
11	    path: '/api/v1/notifications/events',
12	    auth: 'token-query',
13	    response: NotificationEvent,
14	    kind: 'sse',
15	  },
16	} as const satisfies DomainDescriptorMap;
```

#### api/tests/apps/backend-runtime.test.ts — Row(references), Row(type_alias), store(variable), rowsOf(function), get(calls)

```typescript
19	let bundlePath: string;
20	
21	// -- injected app-data stub (records + persists in-memory) --------------------
22	type Row = Record<string, unknown>;
23	let store: Map<string, Row[]>;
24	let seq = 0;
25	function rowsOf(scopeKey: string, collection: string): Row[] {
26	  const k = `${scopeKey}::${collection}`;
27	  if (!store.has(k)) store.set(k, []);
28	  return store.get(k)!;
29	}
30	const appData: RuntimeDeps['appData'] = {
31	  list: async (s, c) => rowsOf(s, c),
32	  get: async (s, c, id) => rowsOf(s, c).find((r) => r.id === id) ?? null,
```

#### web/lib/api/core.ts — ApiError(instantiates), EndpointDescriptor(references), RequestArgs(references), RequestOptions(interface), RequestArgs(type_alias), languageSource(variable), currentLanguage(function), languageSource(calls), pathParamNames(function), queryShapeKeys(function), +21 more

```typescript
21	/** Persisted auth-store key cleared alongside the token on a 401 (ch12 §12.2.3). */
22	const AUTH_STATE_KEY = 'ekoa_auth';
23	
24	export interface RequestOptions {
25	  /** Caller abort signal, merged with the per-descriptor timeout. */
26	  signal?: AbortSignal;
27	  /** Extra request headers (binary uploads set `X-Filename` etc. here). */
28	  headers?: Record<string, string>;
29	  /** Raw body for `kind: 'binary'` endpoints (Blob / ArrayBuffer / FormData / ...). */
30	  rawBody?: BodyInit;
31	  /** How to read a 2xx body. `json` (default) parses + validates; `blob`/`response` for downloads. */
32	  responseType?: 'json' | 'blob' | 'response';
33	}
34	
35	export type RequestArgs = Record<string, unknown>;
36	
37	// -- Language source seam (§12.2.3, FC-009/FC-069) --------------------------------------
38	//
39	// The `language: true` descriptors (chat run create, job create, integration-builder chat,
40	// automation plan) inject an explicit `language` body field from the SINGLE language
41	// source: the i18n store's persisted value. The transport never reads localStorage for
42	// this. To keep this egress core store-agnostic (no import cycle, SSR-safe, unit-testable)
43	// the source is INJECTED: the ApiProvider wires it on mount via `setLanguageSource`. Until
44	// wired (SSR / tests) no field is injected and the server-side schema default ('pt') applies.
45	let languageSource: (() => string | undefined) | null = null;
46	
47	export function setLanguageSource(source: () => string | undefined): void {
48	  languageSource = source;
49	}
50	
51	function currentLanguage(): string | undefined {
52	  try {
53	    return languageSource?.();
54	  } catch {
55	    return undefined;
56	  }
57	}
58	
59	// -- Argument splitting -----------------------------------------------------------------
60	
61	function pathParamNames(path: string): string[] {
62	  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
63	}
64	
65	function queryShapeKeys(schema: unknown): Set<string> {
66	  // zod ZodObject exposes `.shape`; guard for other schema kinds.
67	  const shape = (schema as { shape?: Record<string, unknown> } | null)?.shape;
68	  return shape && typeof shape === 'object' ? new Set(Object.keys(shape)) : new Set();
69	}
70	
71	interface SplitArgs {
72	  params: Record<string, string>;
73	  query: Record<string, unknown>;
74	  body: Record<string, unknown> | undefined;
75	}
76	
77	function splitArgs(descriptor: EndpointDescriptor, args?: RequestArgs): SplitArgs {
78	  const src: Record<string, unknown> = { ...(args ?? {}) };
79	  const params: Record<string, string> = {};
80	
81	  for (const name of pathParamNames(descriptor.path)) {
82	    const value = src[name];
83	    if (value === undefined || value === null) {
84	      throw new ApiError(0, 'VALIDATION_FAILED', `Missing path parameter '${name}' for ${descriptor.path}`);
85	    }
86	    params[name] = String(value);
87	    delete src[name];
88	  }
89	
90	  const hasBody = descriptor.method === 'POST' || descriptor.method === 'PUT' || descriptor.method === 'PATCH';
91	  const query: Record<string, unknown> = {};
92	  let body: Record<string, unknown> | undefined;
93	
94	  if (!hasBody) {
95	    // GET / DELETE carry no body: every remaining key is a query param.
96	    Object.assign(query, src);
97	  } else if (descriptor.query) {
98	    // A body method that also declares query params: split by the query schema's keys.
99	    const keys = queryShapeKeys(descriptor.query);
100	    for (const key of Object.keys(src)) {
101	      if (keys.has(key)) {
102	        query[key] = src[key];
103	        delete src[key];
104	      }
105	    }
106	    body = src;
107	  } else {
108	    body = src;
109	  }
110	
111	  return { params, query, body };
112	}
113	
114	function buildUrl(descriptor: EndpointDescriptor, params: Record<string, string>, query: Record<string, unknown>): string {
115	  let path = descriptor.path;
116	  for (const [name, value] of Object.entries(params)) {
117	    path = path.replace(`:${name}`, encodeURIComponent(value));
118	  }
119	  const url = new URL(`${resolveBaseUrl()}${path}`);
120	  for (const [key, value] of Object.entries(query)) {
121	    if (value === undefined || value === null) continue;
122	    if (Array.isArray(value)) {
123	      for (const item of value) if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
124	    } else {
125	      url.searchParams.append(key, String(value));
126	    }
127	  }
128	  return url.toString();
129	}
130	
131	// -- Interceptors -----------------------------------------------------------------------
132	
133	/**
134	 * Auth-failure interceptor (§12.2.3, replaces FC-021's string matching). Status-based,
135	 * never message-string-based. A rejected token is already invalid, so this only clears
136	 * local state - it never calls `POST /auth/logout` (that is the explicit sign-out path).
137	 */
138	function handleUnauthorized(): void {
139	  clearToken();
140	  if (typeof window === 'undefined') return;
141	  try {
142	    window.localStorage.removeItem(AUTH_STATE_KEY);
143	  } catch {
144	    /* ignore storage errors */
145	  }
146	  if (!window.location.pathname.startsWith('/login')) {
147	    window.location.href = '/login';
148	  }
149	}
150	
151	async function toApiError(res: Response): Promise<ApiError> {
152	  let payload: unknown;
153	  try {
154	    payload = await res.json();
155	  } catch {
156	    payload = undefined;
157	  }
158	  const parsed = ErrorEnvelope.safeParse(payload);
159	  if (parsed.success) {
160	    const { code, message, details } = parsed.data.error;
161	    return new ApiError(res.status, code, message, details);
162	  }
163	  const message =
164	    payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message: unknown }).message === 'string'
165	      ? (payload as { message: string }).message
166	      : res.statusText || `HTTP ${res.status}`;
167	  return new ApiError(res.status, statusToCode(res.status), message, payload);
168	}
169	
170	/** Best-effort code for a non-enveloped error body (the API always envelopes; this is a fallback). */
171	function statusToCode(status: number): string {
172	  switch (status) {
173	    case 400:
174	      return 'VALIDATION_FAILED';
175	    case 401:
176	      return 'UNAUTHENTICATED';
177	    case 402:
178	      return 'BILLING_BLOCKED';
179	    case 403:
180	      return 'FORBIDDEN';
181	    case 404:
182	      return 'NOT_FOUND';
183	    case 409:
184	      return 'CONFLICT';
185	    case 413:
186	      return 'PAYLOAD_TOO_LARGE';
187	    case 422:
188	      return 'SECRET_GUARD_BLOCKED';
189	    case 429:
190	      return 'RATE_LIMITED';
191	    default:
192	      return status >= 500 ? 'INTERNAL' : 'REQUEST_FAILED';
193	  }
194	}
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

#### api/assets/featured-artifacts/legal-agenda-reservas/scaffold/frontend/src/components/Layout.jsx — markLida(calls), resolveAppId(function), calls(calls), relativeTime(function), NotificationsBell(function), useSharedCollection(calls), relativeTime(calls)

```jsx
454	 *   4. document.title match against a known brand
455	 *   5. legal-nucleo, as a last resort only.
456	 */
457	function resolveAppId(appKey) {
458	  const explicit = normalizeKey(appKey);
459	  if (explicit) return explicit;
460	  if (typeof window !== 'undefined') {
461	    const injected = window.__EKOA_APP_ID;
462	    if (injected && APPS[injected]) return injected;
463	    const path = (window.location && window.location.pathname) || '';
464	    const m = path.match(/\/apps\/(legal-[a-z-]+)(?:\/|$)/);
465	    if (m && APPS[m[1]]) return m[1];
466	    const title = (typeof document !== 'undefined' && document.title ? document.title : '').toLowerCase();
467	    if (title) {
468	      const hit = APP_ORDER.find((id) => title.includes(APPS[id].brand.toLowerCase()));
469	      if (hit) return hit;
470	    }
471	  }
472	  return 'legal-nucleo';
473	}
474	
475	/* Normalização para pesquisa: minúsculas e sem diacríticos. */
476	function foldText(s) {
477	  return String(s || '')
478	    .toLowerCase()
479	    .normalize('NFD')
480	    .replace(/[̀-ͯ]/g, '');
481	}
482	
483	/* Data relativa, curta e em PT-PT: "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias". */
484	function relativeTime(value) {
485	  if (!value) return '';
486	  const then = new Date(value).getTime();
487	  if (Number.isNaN(then)) return '';
488	  const diff = Math.max(0, Date.now() - then);
489	  const min = Math.floor(diff / 60000);
490	  if (min < 1) return 'agora';
491	  if (min < 60) return `há ${min} min`;
492	  const h = Math.floor(min / 60);
493	  if (h < 24) return `há ${h} h`;
494	  const d = Math.floor(h / 24);
495	  if (d === 1) return 'ontem';
496	  return `há ${d} dias`;
497	}
498	
499	/*
500	 * Sino de notificações - lê a colecção partilhada `notificacoes`, mostra o
501	 * número de não-lidas e um menu com as 8 mais recentes. Clicar num item marca-o
502	 * como lido e, se tiver `href`, navega (seguro entre apps via location.href).
503	 */
504	function NotificationsBell() {
505	  const { items, refresh } = useSharedCollection('notificacoes');
506	  const [open, setOpen] = useState(false);
507	  const wrapRef = useRef(null);
508	
509	  useEffect(() => {
510	    if (!open) return undefined;
511	    const onDocClick = (e) => {
512	      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
513	    };
514	    const onKey = (e) => {
515	      if (e.key === 'Escape') setOpen(false);
516	    };
517	    document.addEventListener('mousedown', onDocClick);
518	    document.addEventListener('keydown', onKey);
519	    return () => {
520	      document.removeEventListener('mousedown', onDocClick);
521	      document.removeEventListener('keydown', onKey);
522	    };
523	  }, [open]);
524	
525	  const list = Array.isArray(items) ? items : [];
526	  const unread = list.filter((n) => !n.lida).length;
527	  const latest = [...list]
528	    .sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime())
529	    .slice(0, 8);
530	
531	  const onItem = async (n) => {
532	    try {
533	      if (n && !n.lida && n.id != null) await markLida(n.id);
534	    } catch { /* não fatal */ }
535	    if (n && n.href) {
536	      window.location.href = n.href;
537	      return;
538	    }
539	    await refresh();
540	    setOpen(false);
541	  };
542	
543	  const onMarkAll = async () => {
544	    try {
545	      await Promise.all(list.filter((n) => !n.lida && n.id != null).map((n) => markLida(n.id)));
546	    } catch { /* não fatal */ }
547	    await refresh();
548	  };
549	
550	  return (
551	    <div className="bell-wrap" ref={wrapRef}>
552	      <button
553	        type="button"
554	        className="bell-button"
555	        data-testid="bell"
556	        aria-label={`Notificações${unread > 0 ? ` (${unread} por ler)` : ''}`}
557	        aria-haspopup="true"
558	        aria-expanded={open}
559	        onClick={() => setOpen((v) => !v)}
560	      >
561	        <IconBell />
562	        {unread > 0 && (
563	          <span className="bell-badge" data-testid="bell-badge">{unread > 99 ? '99+' : unread}</span>
564	        )}
565	      </button>
566	
567	      {open && (
568	        <div className="bell-menu" data-testid="bell-menu" role="menu">
569	          <div className="bell-menu-head">
570	            <span className="bell-menu-title">Notificações</span>
571	            {unread > 0 && (
572	              <button type="button" className="btn btn-ghost btn-sm" onClick={onMarkAll}>
573	                Marcar todas como lidas
574	              </button>
575	            )}
576	          </div>
577	          {latest.length === 0 ? (
578	            <div className="bell-empty">Sem notificações.</div>
579	          ) : (
580	            <ul className="bell-list">
581	              {latest.map((n) => (
582	                <li key={n.id}>
583	                  <button
584	                    type="button"
585	                    className={`bell-item${n.lida ? '' : ' is-unread'}`}
586	                    data-testid="bell-item"
587	                    role="menuitem"
588	                    onClick={() => onItem(n)}
589	                  >
590	                    <span className="bell-item-title">{n.titulo || 'Notificação'}</span>
591	                    {n.corpo && <span className="bell-item-body">{n.corpo}</span>}
592	                    <span className="bell-item-date">{relativeTime(n.data)}</span>
593	                  </button>
594	                </li>
595	              ))}
596	            </ul>
597	          )}
598	        </div>
599	      )}
600	    </div>
601	  );
602	}
603	
604	/*
605	 * Painel "Todas as aplicações" - o lançador completo, à escala de 21 apps.
```

#### api/src/routes/notifications.ts — notificationsRouter(function)

```typescript
1	/**
2	 * Notifications SSE endpoint (ch03 §3.6.4). The per-user push channel — one of the four
3	 * sanctioned SSE streams. Authenticates via ?token= (EventSource cannot set headers, CONV-1).
4	 * Persistence/state access goes through auth/ + events/ modules, never data/ (ch02 §2.7).
5	 */
6	import { Router, type Request, type Response } from 'express';
7	import { verifySseToken } from '../auth/middleware.js';
8	import { sseManager } from '../events/sse-manager.js';
9	
10	export function notificationsRouter(): Router {
11	  const r = Router();
12	
13	  r.get('/events', (req: Request, res: Response) => {
14	    const auth = verifySseToken(req.query.token as string | undefined);
15	    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
16	    const lastEventId = req.header('last-event-id');
17	    sseManager.attach(res, auth.claims.sub, 'notifications', auth.claims.sub, lastEventId ? Number(lastEventId) : undefined);
18	  });
19	
20	  return r;
21	}
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

 succeeded in 436ms:
## Exploration: change requests route loadReadable actorOf req X-Ekoa-App-Id loadReadable app.appId

Found 206 symbols across 68 files.

### Blast radius — what depends on these (update/verify before editing)

- `AssistantAppResolution` (api/src/apps/app-assistant-route.ts:55) — 1 caller in `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `RegisteredApp` (api/src/apps/app-registry.ts:19) — 3 callers in `api/src/apps/app-registry.ts`; ⚠️ no covering tests found

### Relationships

**references:**
- AssistantRequest → AssistantAdmission
- AssistantAdmission → AppActionManifest
- UiActionsResult → AppActionManifest
- assistantToolsFromManifest → AppActionManifest
- manifest → AppActionManifest
- AppAssistantInput → AppActionManifest
- manifest → AppActionManifest
- AssistantAppResolution → ResolvedApp
- resolveAssistantApp → AssistantAppResolution
- ResolvedApp → CollectionsBlock
- ... and 57 more

**calls:**
- appAssistantRouter → resolveAssistantApp
- fileChangeRequest → now
- fileChangeRequest → insert
- fileChangeRequest → find
- changeRequestsRouter → fileChangeRequest
- convertChangeRequest → loadOwnOrg
- appSsoRouter → readAppAuthBody
- rowsForSession → map
- assistantToolsFromManifest → map
- runAppAssistant → map
- ... and 219 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/app-assistant-route.ts — sendError(function), references(references), calls(calls), AssistantAppResolution(type_alias), ResolvedApp(references), resolveAssistantApp(function), AssistantAppResolution(references), resolveApp(calls)

```typescript
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

#### api/src/routes/helpers.ts — actorOf(function)

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

#### api/src/apps/app-paths.ts — loadReadable(function)

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

#### shared/src/change-request.ts — ChangeRequest(type_alias), ChangeRequest(constant), ChangeRequestStatus(constant)

```typescript
1	/**
2	 * Change-requests domain contract (operator-run H4; BRIEF Phase 9d). GREENFIELD — the
3	 * request-changes queue: a user files a change request from INSIDE a served app; the app
4	 * OWNER's org-admins see it in a dashboard queue and convert one into a patch run (a
5	 * follow-up build). Additive only.
6	 *
7	 * The security crux is CROSS-ORG ISOLATION: a `ChangeRequest.orgId` is stamped SERVER-SIDE
8	 * (never from the caller's body) — the app OWNER's org for a served-app filing, the
9	 * requester's OWN org for a dashboard refused-build filing. `GET /api/v1/change-requests`
10	 * returns ONLY the caller-org's requests for an org-admin (super-admin across orgs), mirroring
11	 * registo.ts exactly. An org-admin MUST NEVER see another org's requests.
12	 */
13	import { z } from 'zod';
14	import { Id, IsoTimestamp, listResponse } from './common.js';
15	import type { DomainDescriptorMap } from './descriptor.js';
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
52	 * The file-a-request body (`POST /api/v1/change-requests`). `text` is the only required field;
53	 * `route`/`screenState` are the panel-captured context. `appId` is honoured ONLY on the
54	 * dashboard (no `X-Ekoa-App-Id` header) path — for a served-app filing the header resolves the
55	 * app + owner org server-side and any body `appId` is ignored (never trusted for org routing).
56	 */
57	export const ChangeRequestFileRequest = z.object({
58	  text: z.string().min(1).max(4000),
59	  route: z.string().max(1000).optional(),
60	  screenState: z.string().max(8000).optional(),
61	  appId: Id.optional(),
62	});
63	export type ChangeRequestFileRequest = z.infer<typeof ChangeRequestFileRequest>;
64	
65	/** Convert body: the jobId of the follow-up build the dashboard already started (H1-gated). */
66	export const ChangeRequestConvertRequest = z.object({ jobId: Id });
67	export type ChangeRequestConvertRequest = z.infer<typeof ChangeRequestConvertRequest>;
68	
69	/** Queue read query. `status` narrows the list; `orgId` is honoured only for a super-admin
70	 *  (an org-admin is always pinned to its own org server-side — the isolation boundary). */
71	export const ChangeRequestQuery = z.object({
72	  status: ChangeRequestStatus.optional(),
73	  orgId: Id.optional(),
74	  limit: z.coerce.number().int().positive().max(500).optional(),
75	  offset: z.coerce.number().int().nonnegative().optional(),
76	});
77	export type ChangeRequestQuery = z.infer<typeof ChangeRequestQuery>;
78	
79	export const ChangeRequestListResponse = listResponse(ChangeRequest);
80	export type ChangeRequestListResponse = z.infer<typeof ChangeRequestListResponse>;
81	
82	export const changeRequestsEndpoints = {
83	  // File a request from inside a served app (X-Ekoa-App-Id resolves app+owner org) OR from the
84	  // dashboard refused-build feed (own org). Requires a logged-in platform user (auth 'user').
85	  file: {
86	    method: 'POST',
87	    path: '/api/v1/change-requests',
88	    auth: 'user',
89	    request: ChangeRequestFileRequest,
90	    response: ChangeRequest,
91	  },
92	  // The org-admin queue read. org-admin sees own org; super-admin across orgs (mirrors registo).
93	  list: {
94	    method: 'GET',
95	    path: '/api/v1/change-requests',
96	    auth: 'org-admin',
97	    query: ChangeRequestQuery,
98	    response: ChangeRequestListResponse,
99	  },
100	  // Mark a request converted (the dashboard already POSTed /jobs; this links the resulting jobId).
101	  convert: {
102	    method: 'POST',
103	    path: '/api/v1/change-requests/:id/convert',
104	    auth: 'org-admin',
105	    request: ChangeRequestConvertRequest,
106	    response: ChangeRequest,
107	  },
108	  // Decline a request (status -> dismissed). org-admin own org; super-admin across orgs.
109	  dismiss: {
110	    method: 'POST',
111	    path: '/api/v1/change-requests/:id/dismiss',
112	    auth: 'org-admin',
113	    response: ChangeRequest,
114	  },
115	} as const satisfies DomainDescriptorMap;
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I’ve confirmed the core access helper semantics. Next I’m reading the exact route and test file with line numbers, plus the H4 implementation notes, to verify sequencing, failure shape, and the negative assertions around rows and notifications.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --line-number --hidden --glob 'impl-notes.md' 'H4|change-requests|loadReadable' ." in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
./docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md:75:build/edit/capability logic (H1 owns gating). No queue (that is H4).
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:1:# H4 impl-notes - request-changes QUEUE (users file; org-admin converts) + refused-build feed
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:3:Slice H4 (mixed, size 5, dep H1). GREENFIELD: no existing queue. Built on the `Store<T>` +
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:26:- `POST /api/v1/change-requests` (auth `user`), registered BEFORE the org-admin gate so a plain
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:44:- `GET /api/v1/change-requests` (auth `org-admin`): mirrors `registo.ts` EXACTLY -
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:52:  registo/orgs), `web/stores/change-requests.ts`, and the `changeRequests` domain wired into the
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:62:- Client: `web/stores/change-requests.ts` exposes `fileFromRefusal({ text, appId?, route? })`.
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:64:  chat message renderer: those are OUTSIDE H4's reserved set and concurrently owned; the brief
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:68:  H4's contract. Adding capability logic was explicitly forbidden and none was added.
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:75:`services/change-requests.ts` exactly as `readRegisto` scopes: org-admin -> OWN org only;
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:77:oracle). Tested (`api/tests/routes/change-requests.test.ts`, real router + mongo-mem):
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:88:  POSTs `/api/v1/change-requests` with `X-Ekoa-App-Id` + Bearer + `{text, route, screenState}` ->
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:101:- New contract test `api/tests/contract/change-requests.test.ts` (shapes + live-response schema
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:102:  validation); new integration test `api/tests/routes/change-requests.test.ts` (a NEW `tests/routes/`
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:107:`api/src/data/stores.ts`, `api/src/routes/change-requests.ts` (+ `server.ts` mount),
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:108:`api/src/services/change-requests.ts`, `api/src/agents/streaming.ts` (emit helper),
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:110:`web/app/(dashboard)/pedidos/page.tsx`, `web/stores/change-requests.ts`, `web/lib/navigation.ts`,
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:148:Codex review of H4 found a real HIGH: `POST /api/v1/change-requests` with an `X-Ekoa-App-Id`
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:154:FIX (`api/src/routes/change-requests.ts`): the served-app filing path now gates on
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:155:`loadReadable(actorOf(req), app.appId)` (apps/app-paths.ts) BEFORE resolving/stamping. `loadReadable`
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:164:TESTS (`api/tests/routes/change-requests.test.ts`, retopologised): all filers are `reqU` (plain
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:176:assets/panel-runtime/build.mjs` OK. (H4 subset: 3 files, 23 passed - up from 20, +3 access-gate

exec
/bin/zsh -lc 'codegraph node api/src/routes/change-requests.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/tests/routes/change-requests.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 144ms:
**api/src/routes/change-requests.ts** — 99 lines, 1 symbol · no other indexed file depends on it

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
22	import { loadReadable } from '../apps/app-paths.js';
23	import { emitChangeRequest } from '../agents/streaming.js';
24	import {
25	  fileChangeRequest,
26	  readChangeRequests,
27	  convertChangeRequest,
28	  dismissChangeRequest,
29	} from '../services/change-requests.js';
30	import { actorOf, notFound, parseBody, sendError } from './helpers.js';
31	
32	export function changeRequestsRouter(deps: { now: () => number; genId: () => string }): Router {
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
76	      orgId: q.orgId,
77	      limit: q.limit ? parseInt(q.limit, 10) : undefined,
78	      offset: q.offset ? parseInt(q.offset, 10) : undefined,
79	    });
80	    res.json(result);
81	  });
82	
83	  r.post('/:id/convert', async (req: AuthedRequest, res: Response) => {
84	    const body = parseBody(res, ChangeRequestConvertRequest, req.body);
85	    if (!body) return;
86	    const result = await convertChangeRequest(actorOf(req), req.params.id as string, body.jobId);
87	    if (result.status === 'not-found') return notFound(res);
88	    res.json(result.request);
89	  });
90	
91	  r.post('/:id/dismiss', async (req: AuthedRequest, res: Response) => {
92	    const result = await dismissChangeRequest(actorOf(req), req.params.id as string);
93	    if (result.status === 'not-found') return notFound(res);
94	    res.json(result.request);
95	  });
96	
97	  return r;
98	}
99	

 succeeded in 140ms:
**api/tests/routes/change-requests.test.ts** — 194 lines, 11 symbols · no other indexed file depends on it

1	import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
2	import type { Server } from 'node:http';
3	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
4	import { connectMongo, closeMongo } from '../../src/data/mongo.js';
5	import { users, userSettings, changeRequests, artifacts } from '../../src/data/stores.js';
6	import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
7	import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
8	import { login } from '../../src/auth/service.js';
9	import { hashPassword } from '../../src/auth/password.js';
10	import { buildApp } from '../../src/server.js';
11	import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
12	import { ChangeRequest, ChangeRequestListResponse, ErrorEnvelope } from '@ekoa/shared';
13	
14	/**
15	 * Operator-run H4 — the request-changes queue, driven through the REAL router (mongo-mem).
16	 *
17	 * The security crux is CROSS-ORG ISOLATION on BOTH directions:
18	 *  - WRITE (codex HIGH - queue injection): filing about a served app requires the REQUESTER to be
19	 *    able to READ that app (own, or org-shared WITHIN THEIR org). A user cannot inject a request
20	 *    into another org's queue by naming that org's app id/slug - loadReadable rejects it as a
21	 *    uniform 404. Because a readable app is always in the requester's org, the request always lands
22	 *    in the requester's OWN org.
23	 *  - READ: an org-admin reads/acts on ONLY its own org; a plain user cannot read the queue at all.
24	 * requesterUserId + orgId are always server-stamped, never trusted from the caller body.
25	 *
26	 * Topology (all filers are `reqU`, a plain user in orgA):
27	 *   appA     - orgA, OWNED by admA, visibility 'org'    -> reqU CAN read (org-shared, same org)
28	 *   appOwn   - orgA, OWNED by reqU, visibility 'private' -> reqU CAN read (own)
29	 *   appApriv - orgA, OWNED by admA, visibility 'private' -> reqU CANNOT read (another user's private)
30	 *   appB     - orgB, OWNED by admB, visibility 'org'     -> reqU CANNOT read (cross-org)
31	 */
32	let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
33	const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
34	const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
35	
36	const authed = (p: string, t: string, init: RequestInit = {}) =>
37	  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
38	const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
39	const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
40	const fileWithApp = (t: string, appId: string, body: Record<string, unknown>) =>
41	  authed('/api/v1/change-requests', t, { method: 'POST', headers: { 'x-ekoa-app-id': appId }, body: JSON.stringify(body) });
42	const queueOf = async (u: string) => (await readJson(await authed('/api/v1/change-requests', await tokenFor(u)))).items as Array<Record<string, unknown>>;
43	
44	beforeAll(async () => {
45	  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
46	  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
47	  const app = buildApp(cfg, deps);
48	  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
49	  port = (server.address() as { port: number }).port;
50	}, 60_000);
51	afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
52	
53	beforeEach(async () => {
54	  __resetActivationForTests(); __resetRevocationsForTests();
55	  await users.deleteMany({}); await changeRequests.deleteMany({}); await artifacts.deleteMany({}); await userSettings.deleteMany({});
56	  for (const [id, role, org] of [['reqU', 'user', 'orgA'], ['admA', 'org-admin', 'orgA'], ['admB', 'org-admin', 'orgB']] as const) {
57	    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
58	    setActivation(id, { active: true, billingLocked: false });
59	    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
60	  }
61	  const seedApp = (id: string, userId: string, orgId: string, visibility: 'org' | 'private') =>
62	    artifacts.insert({ _id: id, name: id, slug: id, userId, orgId, visibility, status: 'active', data: { projectDir: `/sbx/user-${userId}/${id}` } } as never);
63	  await seedApp('appA', 'admA', 'orgA', 'org');        // reqU can read (org-shared, same org)
64	  await seedApp('appOwn', 'reqU', 'orgA', 'private');   // reqU can read (own)
65	  await seedApp('appApriv', 'admA', 'orgA', 'private'); // reqU cannot read (another user's private)
66	  await seedApp('appB', 'admB', 'orgB', 'org');         // reqU cannot read (cross-org)
67	});
68	
69	describe('H4 change-requests: filing requires the requester can READ the app; lands in own org', () => {
70	  it('a user files about an org-shared app in their org -> 200, stamped to their org', async () => {
71	    const res = await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'Adicione um botão de exportação', route: '/faturas' });
72	    expect(res.status).toBe(200);
73	    const body = await readJson(res);
74	    expect(ChangeRequest.safeParse(body).success, JSON.stringify(ChangeRequest.safeParse(body))).toBe(true);
75	    expect(body.orgId).toBe('orgA');           // the requester's own org (== the app owner org)
76	    expect(body.requesterUserId).toBe('reqU'); // from the verified JWT, never the body
77	    expect(body.requesterName).toBe('reqU');
78	    expect(body.appId).toBe('appA');
79	    expect(body.status).toBe('open');
80	    expect(body.route).toBe('/faturas');
81	  });
82	
83	  it('a user files about their OWN (private) app -> 200', async () => {
84	    const res = await fileWithApp(await tokenFor('reqU'), 'appOwn', { text: 'Mude a cor do cabeçalho' });
85	    expect(res.status).toBe(200);
86	    expect((await readJson(res)).orgId).toBe('orgA');
87	  });
88	
89	  it('CROSS-ORG INJECTION is blocked: filing about another org app -> 404, NO row, NO notification', async () => {
90	    const res = await fileWithApp(await tokenFor('reqU'), 'appB', { text: 'inject into org B' });
91	    expect(res.status).toBe(404);
92	    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
93	    // The injection would have landed a row in org B's queue (and fired an SSE to org B admins).
94	    // Neither happened: org B's admin sees nothing, and no row exists anywhere.
95	    expect((await queueOf('admB')).length).toBe(0);
96	    expect(await changeRequests.find({})).toHaveLength(0);
97	  });
98	
99	  it('filing about another user PRIVATE app the requester cannot read -> 404 (uniform, no oracle)', async () => {
100	    const res = await fileWithApp(await tokenFor('reqU'), 'appApriv', { text: 'peek' });
101	    expect(res.status).toBe(404);
102	    expect(await changeRequests.find({})).toHaveLength(0);
103	  });
104	
105	  it('an unknown app id is a 404 (shared error envelope), never a silent misfile', async () => {
106	    const res = await fileWithApp(await tokenFor('reqU'), 'no-such-app', { text: 'Olá' });
107	    expect(res.status).toBe(404);
108	    expect(((await readJson(res)).error as { code: string }).code).toBe('NOT_FOUND');
109	  });
110	});
111	
112	describe('H4 change-requests: the org-admin queue read is org-scoped (cross-org isolation)', () => {
113	  it('an org-admin sees its OWN org only; another org-admin never sees it', async () => {
114	    await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'pedido 1' }); // -> orgA
115	
116	    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
117	    expect(ChangeRequestListResponse.safeParse(admAList).success).toBe(true);
118	    const aItems = admAList.items as Array<Record<string, unknown>>;
119	    expect(aItems.length).toBe(1);
120	    expect(aItems.every((r) => r.orgId === 'orgA')).toBe(true);
121	
122	    // admB is in orgB — the crux: it MUST NOT see orgA's request.
123	    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
124	    expect(admBList.total).toBe(0);
125	    expect((admBList.items as Array<Record<string, unknown>>).some((r) => r.requesterUserId === 'reqU')).toBe(false);
126	  });
127	
128	  it('a plain user cannot read the queue -> 403 FORBIDDEN (shared envelope)', async () => {
129	    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'));
130	    expect(res.status).toBe(403);
131	    const body = await readJson(res);
132	    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
133	    expect((body.error as { code: string }).code).toBe('FORBIDDEN');
134	  });
135	
136	  it('a super-admin can narrow across orgs with ?orgId=', async () => {
137	    await users.insert({ _id: 'root', username: 'root', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'orgRoot', active: true });
138	    setActivation('root', { active: true, billingLocked: false });
139	    await userSettings.put({ _id: 'root', memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
140	    await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'pedido super' }); // -> orgA
141	
142	    const all = await readJson(await authed('/api/v1/change-requests', await tokenFor('root')));
143	    expect((all.items as unknown[]).length).toBe(1);
144	    const scoped = await readJson(await authed('/api/v1/change-requests?orgId=orgB', await tokenFor('root')));
145	    expect((scoped.items as unknown[]).length).toBe(0); // no orgB requests exist
146	  });
147	});
148	
149	describe('H4 change-requests: convert / dismiss are org-scoped', () => {
150	  it('convert flips status to converted + links the jobId; a cross-org convert is a uniform 404', async () => {
151	    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'Adicione um campo de data' })); // -> orgA
152	    const id = filed.id as string;
153	
154	    // admB (orgB) must NOT be able to convert orgA's request — uniform 404, no cross-org oracle.
155	    const cross = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admB'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
156	    expect(cross.status).toBe(404);
157	    expect((await readJson(cross)).error).toBeTruthy();
158	
159	    // admA (own org) converts, linking the follow-up-build job the dashboard already started.
160	    const conv = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admA'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
161	    expect(conv.status).toBe(200);
162	    const cbody = await readJson(conv);
163	    expect(ChangeRequest.safeParse(cbody).success).toBe(true);
164	    expect(cbody.status).toBe('converted');
165	    expect(cbody.jobId).toBe('job-xyz');
166	  });
167	
168	  it('dismiss flips status to dismissed (own org)', async () => {
169	    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'pedido a dispensar' })); // -> orgA
170	    const id = filed.id as string;
171	    const res = await authed(`/api/v1/change-requests/${id}/dismiss`, await tokenFor('admA'), { method: 'POST' });
172	    expect(res.status).toBe(200);
173	    expect((await readJson(res)).status).toBe('dismissed');
174	  });
175	});
176	
177	describe('H4 change-requests: the refused-build feed files to the requester OWN org', () => {
178	  it('filing WITHOUT the served-app header lands in the requester own org (never a dead end)', async () => {
179	    // No X-Ekoa-App-Id header: the dashboard refused-build path. orgId is the requester's OWN org
180	    // (orgA), the body appId is kept only as an informational label (no loadReadable gate applies -
181	    // there is no served app to read; the request is confined to the requester's own org anyway).
182	    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'), { method: 'POST', body: JSON.stringify({ text: 'Não consegui construir; peço ao administrador.', appId: 'appB' }) });
183	    expect(res.status).toBe(200);
184	    const body = await readJson(res);
185	    expect(ChangeRequest.safeParse(body).success).toBe(true);
186	    expect(body.orgId).toBe('orgA');           // the REQUESTER's own org, NOT appB's orgB
187	    expect(body.requesterUserId).toBe('reqU');
188	
189	    // It surfaces to admA (orgA), and NOT to admB (orgB) — isolation holds on this path too.
190	    expect((await queueOf('admA')).some((r) => r.requesterUserId === 'reqU')).toBe(true);
191	    expect((await queueOf('admB')).some((r) => r.text === 'Não consegui construir; peço ao administrador.')).toBe(false);
192	  });
193	});
194	

codex
The route now clearly gates on `loadReadable` before `fileChangeRequest`. I’m checking the remaining bypass surfaces now: how `resolveApp` accepts ids/slugs, whether `fileChangeRequest` still stamps `orgId` server-side, and whether read/convert/dismiss scoping still matches the original isolation model.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '148,180p' docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
Codex review of H4 found a real HIGH: `POST /api/v1/change-requests` with an `X-Ekoa-App-Id`
resolved ANY app by id/slug and stamped the request into that RESOLVED APP OWNER's org with NO
check that the requester could access the app - so an org-A user who knew/guessed an org-B app
id/slug could inject a request into org-B's `/pedidos` queue and fire a live notification to org-B's
admins (a cross-org write / isolation break). The original test baked this in as expected.

FIX (`api/src/routes/change-requests.ts`): the served-app filing path now gates on
`loadReadable(actorOf(req), app.appId)` (apps/app-paths.ts) BEFORE resolving/stamping. `loadReadable`
returns the artifact only when it is the requester's OWN app or an org-shared app WITHIN THE
REQUESTER's OWN org (it rejects any cross-org row, another user's private row, or an unknown id).
A `null` verdict -> a UNIFORM 404 (indistinguishable from an unknown app, so it is NOT a cross-org
existence oracle). Because a readable app is ALWAYS in the requester's own org, the owner-org stamp
(kept unchanged, resolved from the owner user record) is now reachable ONLY for apps the requester
can see - so a request can never land in, or notify, another org. The refused-build path (no
`X-Ekoa-App-Id`) is unchanged: it already stamps the requester's OWN org and needs no app gate.

TESTS (`api/tests/routes/change-requests.test.ts`, retopologised): all filers are `reqU` (plain
user, orgA); seeded apps `appA` (orgA org-shared, owned by admA), `appOwn` (orgA private, owned by
reqU), `appApriv` (orgA private, owned by admA), `appB` (orgB org-shared, owned by admB).
- FLIPPED: the old "files about an org-B app -> lands in org-B" now asserts 404 + NO row created
  anywhere + org-B's admin queue empty (no injection, no notification).
- ADDED: files about `appA` (org-shared, own org) -> 200 stamped to orgA; files about `appOwn`
  (own) -> 200; files about `appApriv` (another user's private, same org) -> 404.
- Read-isolation + convert/dismiss cross-org tests kept, retargeted to the orgA request (admA acts;
  admB cross-org -> 404). Refused-build own-org test kept (files with no header -> orgA).

VERIFY (all green): api tsc src 0 / test 0; eslint touched 0; `vitest run tests/routes tests/contract
tests/apps` -> 60 files, 593 passed; `npm run gate:chokepoint` clean; `node
assets/panel-runtime/build.mjs` OK. (H4 subset: 3 files, 23 passed - up from 20, +3 access-gate
cases.)

exec
/bin/zsh -lc 'codegraph explore "resolveApp function registry app id slug artifactBacked ownerUserId"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph explore "fileChangeRequest readChangeRequests convertChangeRequest dismissChangeRequest orgId requester body emitChangeRequest"' in /Users/ggomes/dev/ekoa-code
 succeeded in 378ms:
## Exploration: fileChangeRequest readChangeRequests convertChangeRequest dismissChangeRequest orgId requester body emitChangeRequest

Found 202 symbols across 99 files.

### Blast radius — what depends on these (update/verify before editing)

- `fileChangeRequest` (api/src/services/change-requests.ts:46) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found
- `dismissChangeRequest` (api/src/services/change-requests.ts:122) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found
- `readChangeRequests` (api/src/services/change-requests.ts:84) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found
- `emitChangeRequest` (api/src/agents/streaming.ts:151) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- fileChangeRequest → now
- dismissChangeRequest → loadOwnOrg
- dismissChangeRequest → changeRequestView
- changeRequestsRouter → dismissChangeRequest
- readChangeRequests → find
- emitChangeRequest → emit
- changeRequestsRouter → emitChangeRequest
- convertChangeRequest → loadOwnOrg
- convertChangeRequest → changeRequestView
- changeRequestsRouter → convertChangeRequest
- ... and 239 more

**references:**
- dismissChangeRequest → Actor
- convertChangeRequest → Actor
- openNotificationsStream → EventStream
- readChangeRequests → ChangeRequestStatus
- buildLinkRouter → Router
- gatewayRouter → Router
- servingRouter → Router
- changeRequestsRouter → Router
- changeRequestView → ChangeRequest
- fileChangeRequest → ChangeRequest
- ... and 52 more

**instantiates:**
- openNotificationsStream → SseStream

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/services/change-requests.ts — fileChangeRequest(function), dismissChangeRequest(function), readChangeRequests(function), convertChangeRequest(function), loadOwnOrg(function), changeRequestView(function), Deps(interface)

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

#### api/assets/panel-runtime/src/change-request.js — fileChangeRequest(function)

```javascript
1	/*
2	 * Operator Assistant Panel - CHANGE-REQUEST controller (operator-run H4; NON-admins).
3	 *
4	 * The network side of the "Pedir alteração" affordance shown to a viewer who CANNOT edit this
5	 * app (admin === false from H2). It files a change request into the app OWNER's org-admin queue
6	 * so a user is never a dead end. Factored out of AssistantPanel.jsx so it is unit-provable
7	 * against a fake fetch (tests/apps/change-request.test.ts).
8	 *
9	 * It targets ONE thin platform endpoint - `POST /api/v1/change-requests` - scoped by the served
10	 * app's `X-Ekoa-App-Id` header (the server resolves the app + OWNER org) and REQUIRING a
11	 * logged-in platform user (an OPTIONAL Bearer read best-effort, same as H2/H3). This is a
12	 * SEPARATE plane from the visitor-blind served-app assistant plane, which stays byte-for-byte
13	 * untouched (it never reads the caller JWT). Nothing here grounds, bills, or issues a model turn.
14	 *
15	 * Filing REQUIRES a session: no readable token (not logged in / cross-origin / sandboxed iframe)
16	 * or a 401 both resolve to the calm `needs-login` outcome the panel renders as
17	 * "Inicie sessão no Ekoa para pedir alterações." - never a throw, never a crash. PT-PT
18	 * throughout, no emoji, no em/en-dash.
19	 */
20	
21	/** The thin platform endpoint that files a change request (X-Ekoa-App-Id scoped, auth 'user'). */
22	export const CHANGE_REQUESTS_ENDPOINT = '/api/v1/change-requests';
23	
24	/** The shared PT-PT copy for the request affordance (kept here so the flow's wording is one place). */
25	export const REQUEST_COPY = {
26	  open: 'Pedir alteração',
27	  intro: 'Não pode editar esta aplicação, mas pode pedir uma alteração ao administrador.',
28	  placeholder: 'Descreva a alteração que gostaria de ver nesta aplicação.',
29	  submit: 'Enviar pedido',
30	  cancel: 'Cancelar',
31	  close: 'Fechar',
32	  filed: 'Pedido enviado ao administrador. Obrigado.',
33	  needsLogin: 'Inicie sessão no Ekoa para pedir alterações.',
34	  failed: 'Não foi possível enviar o pedido. Tente novamente.',
35	};
36	
37	/**
38	 * File a change request for `appId`. POSTs the platform endpoint with the served-app header + the
39	 * OPTIONAL admin/user Bearer. Returns a discriminated outcome the panel maps to a calm PT-PT note:
40	 *   - `{ outcome:'filed', request }`      the queue accepted it (2xx).
41	 *   - `{ outcome:'needs-login' }`         no readable token OR a 401 - "inicie sessão" message.
42	 *   - `{ outcome:'failed', status }`      any other non-2xx / missing app id / network error.
43	 * Fail-soft: a missing app id / unreadable token / network throw never rejects; it degrades.
44	 */
45	export async function fileChangeRequest({ fetchImpl, appId, token, text, route, screenState }) {
46	  const body = (text || '').trim();
47	  if (!body) return { outcome: 'failed', status: 0 };
48	  // No session token (not logged in / cross-origin) -> the calm login message BEFORE a doomed call.
49	  if (!token) return { outcome: 'needs-login' };
50	  // No served-app id (a standalone preview) -> nothing to scope the request to.
51	  if (!appId) return { outcome: 'failed', status: 0 };
52	
53	  let res;
54	  try {
55	    res = await fetchImpl(CHANGE_REQUESTS_ENDPOINT, {
56	      method: 'POST',
57	      headers: {
58	        'Content-Type': 'application/json',
59	        'X-Ekoa-App-Id': appId,
60	        Authorization: `Bearer ${token}`,
61	      },
62	      body: JSON.stringify({
63	        text: body,
64	        ...(route ? { route: String(route).slice(0, 1000) } : {}),
65	        ...(screenState ? { screenState: String(screenState).slice(0, 8000) } : {}),
66	      }),
67	    });
68	  } catch {
69	    return { outcome: 'failed', status: 0 };
70	  }
71	
72	  if (res && res.status === 401) return { outcome: 'needs-login' }; // session expired -> inicie sessão
73	  if (!res || !res.ok) return { outcome: 'failed', status: res ? res.status : 0 };
74	
75	  let request = null;
76	  try {
77	    request = await res.json();
78	  } catch {
79	    request = null; // a filed request with an unreadable body is still filed
80	  }
81	  return { outcome: 'filed', request };
82	}
```

#### api/src/agents/streaming.ts — emitChangeRequest(function)

```typescript
1	/**
2	 * The streaming pipeline (ch05 §5.7.1): the one internal sink `agents/` writes to, which maps
3	 * run activity to the typed `shared/events.ts` union members and hands them to `events/` for
4	 * SSE delivery. Every payload emitted here is a valid member of its per-stream union (the ch13
5	 * streaming-contract gate). `subagent_event`, `phase_changed`, and `usage_progress` are NEVER
6	 * emitted (§5.7.3, P-11): plan/subtask notifications are consumed internally (they reset the
7	 * inactivity timer) and usage deltas feed billing capture only.
8	 *
9	 * Terminal events (`complete`/`error`) go through the dual-fire guard at the call site
10	 * (registry.finalizeOnce, §5.3.4), never here.
11	 */
12	import { sseManager } from '../events/sse-manager.js';
13	import { loadAgentsConfig } from '../config.js';
14	import type { ChatRunEvent, JobEvent, NotificationEvent } from '@ekoa/shared';
15	
16	/** Truncate a tool arg/result value's string form to the configured cap (§5.7.1). */
17	function truncate(value: unknown): unknown {
18	  if (value === undefined) return undefined;
19	  const cap = loadAgentsConfig().toolResultTruncateChars;
20	  const s = typeof value === 'string' ? value : JSON.stringify(value);
21	  if (s === undefined) return value;
22	  return s.length > cap ? s.slice(0, cap) : s;
23	}
24	
25	/** A tool_event payload (shared by chat + job streams). */
26	export interface ToolEventInput {
27	  phase: 'started' | 'finished' | 'failed';
28	  tool: string;
29	  args?: Record<string, unknown>;
30	  result?: unknown;
31	  isError?: boolean;
32	  durationMs?: number;
33	}
34	
35	function toolEventPayload(e: ToolEventInput): Record<string, unknown> {
36	  return {
37	    type: 'tool_event',
38	    phase: e.phase,
39	    tool: e.tool,
40	    ...(e.args !== undefined ? { args: e.args } : {}),
41	    ...(e.result !== undefined ? { result: truncate(e.result) } : {}),
42	    ...(e.isError !== undefined ? { isError: e.isError } : {}),
43	    ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
44	  };
45	}
46	
47	/** Chat-run stream sink (§3.6.1 `ChatRunEvent`). */
48	export class ChatStreamSink {
49	  constructor(private runId: string) {}
50	  private emit(ev: ChatRunEvent): void {
51	    sseManager.emit('chat', this.runId, ev.type, ev);
52	  }
53	  text(text: string): void {
54	    if (text) this.emit({ type: 'text_chunk', text });
55	  }
56	  /** Working-commentary channel (§3.6.1 `thinking_chunk`). Callers pass text already
57	   *  marker-filtered AND engine-identity-redacted (branding.ts) — never raw model output. */
58	  thinking(text: string): void {
59	    if (text) this.emit({ type: 'thinking_chunk', text });
60	  }
61	  toolEvent(e: ToolEventInput): void {
62	    this.emit(toolEventPayload(e) as ChatRunEvent);
63	  }
64	  contextEvent(name: string, action: 'loaded' | 'used'): void {
65	    this.emit({ type: 'context_event', name, action });
66	  }
67	  /** FC-402 per-turn local-file activity (run s5): transient display metadata for the trust
68	   *  chip — files+bytes from the daemon ledger buffer, mask counts from the anon-audit join. */
69	  localActivity(a: {
70	    files: Array<{ path: string; range?: string }>;
71	    bytesOut?: number;
72	    maskedCounts?: Record<string, number>;
73	    correlationId?: string;
74	  }): void {
75	    if (a.files.length === 0) return;
76	    this.emit({ type: 'local_activity', ...a });
77	  }
78	  complete(result: unknown, durationMs: number, delegate?: { kind: 'build' | 'integration'; request: Record<string, unknown> }): void {
79	    this.emit({ type: 'complete', result, durationMs, ...(delegate ? { delegate } : {}) });
80	  }
81	  error(code: string, message: string): void {
82	    this.emit({ type: 'error', code, message });
83	  }
84	}
85	
86	/** Job stream sink (§3.6.2 `JobEvent`). */
87	export class JobStreamSink {
88	  constructor(private jobId: string) {}
89	  private emit(ev: JobEvent): void {
90	    sseManager.emit('job', this.jobId, ev.type, ev);
91	  }
92	  routing(tier: string, reason: string): void {
93	    this.emit({ type: 'routing', tier, reason });
94	  }
95	  text(text: string): void {
96	    if (text) this.emit({ type: 'text_chunk', text });
97	  }
98	  /** Working-commentary channel (mirrors ChatStreamSink.thinking). Callers pass text already
99	   *  marker-filtered AND engine-identity-redacted (branding.ts) — never raw model output. */
100	  thinking(text: string): void {
101	    if (text) this.emit({ type: 'thinking_chunk', text });
102	  }
103	  toolEvent(e: ToolEventInput): void {
104	    this.emit(toolEventPayload(e) as JobEvent);
105	  }
106	  contextEvent(name: string, action: 'loaded' | 'used'): void {
107	    this.emit({ type: 'context_event', name, action });
108	  }
109	  planStep(status: string, description?: string, detail?: string): void {
110	    this.emit({ type: 'plan_step', status, ...(description ? { description } : {}), ...(detail ? { detail } : {}) });
111	  }
112	  previewReload(): void {
113	    this.emit({ type: 'preview_reload' });
114	  }
115	  /** The build's artifact is scaffolded + served — fired BEFORE the agent runs so the client
116	   *  shows the live preview and the real file tree from second zero. */
117	  artifact(payload: { artifactId: string; appUrl: string; slug?: string }): void {
118	    this.emit({ type: 'artifact', ...payload });
119	  }
120	  complete(payload: { result?: unknown; artifactId?: string; slug?: string; appUrl?: string }, durationMs: number): void {
121	    this.emit({ type: 'complete', durationMs, ...payload });
122	  }
123	  error(code: string, message: string): void {
124	    this.emit({ type: 'error', code, message });
125	  }
126	}
127	
128	// --- Notifications channel (§3.6.4 `NotificationEvent`) -----------------------------------
129	
130	/** Fire a `build_intent` on the target user's notifications channel (§5.7.2). */
131	export function emitBuildIntent(userId: string, ev: { sessionId: string; sourceRunId: string; request: { description: string; artifactId?: string } }): void {
132	  const payload: NotificationEvent = { type: 'build_intent', ...ev };
133	  sseManager.emit('notifications', userId, 'build_intent', payload);
134	}
135	
136	/** Fire an `integration_build_intent` on the target user's notifications channel (§5.7.2). */
137	export function emitIntegrationBuildIntent(userId: string, ev: { sessionId: string; hint?: string }): void {
138	  const payload: NotificationEvent = { type: 'integration_build_intent', ...ev };
139	  sseManager.emit('notifications', userId, 'integration_build_intent', payload);
140	}
141	
142	/** Deliver a `chat_answer` on the notifications channel (§5.6.2 in-build answer flow). */
143	export function emitChatAnswer(userId: string, ev: { sessionId: string; sourceRunId: string; text: string }): void {
144	  const payload: NotificationEvent = { type: 'chat_answer', ...ev };
145	  sseManager.emit('notifications', userId, 'chat_answer', payload);
146	}
147	
148	/** A user filed a change request into an org-admin's queue (operator-run H4): push a live
149	 *  refetch signal onto that admin's per-user notifications channel. Fired once per org-admin of
150	 *  the target org — the queue is org-scoped, so only that org's admins are notified. */
151	export function emitChangeRequest(userId: string, ev: { appId?: string }): void {
152	  const payload: NotificationEvent = { type: 'change_request', ...(ev.appId ? { appId: ev.appId } : {}) };
153	  sseManager.emit('notifications', userId, 'change_request', payload);
154	}
155	
156	/** Org branding changed (brand research applied): tell the user's clients to refetch the
157	 *  company config so the header logo + theme update live (no page reload). Per-user channel -
158	 *  other org members pick the change up on their next company fetch. */
159	export function emitBrandingUpdated(userId: string): void {
160	  const payload: NotificationEvent = { type: 'branding_updated' };
161	  sseManager.emit('notifications', userId, 'branding_updated', payload);
162	}
```

#### web/stores/toast.ts — dismiss(function), add(function), push(function)

```typescript
1	'use client';
2	
3	import { create } from 'zustand';
4	
5	export type ToastTone = 'success' | 'error' | 'info';
6	
7	export interface ToastAction {
8	  label: string;
9	  onClick: () => void;
10	}
11	
12	export interface ToastItem {
13	  id: string;
14	  tone: ToastTone;
15	  message: string;
16	  duration: number;
17	  action?: ToastAction;
18	  testId?: string;
19	}
20	
21	interface ToastState {
22	  toasts: ToastItem[];
23	  add: (toast: Omit<ToastItem, 'id'>) => string;
24	  dismiss: (id: string) => void;
25	  clear: () => void;
26	}
27	
28	export const useToastStore = create<ToastState>((set) => ({
29	  toasts: [],
30	  add: (toast) => {
31	    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
32	    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
33	    return id;
34	  },
35	  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
36	  clear: () => set({ toasts: [] }),
37	}));
38	
39	export interface ToastOptions {
40	  duration?: number;
41	  action?: ToastAction;
42	  /** Optional stable test hook rendered as data-testid on the toast element. */
43	  testId?: string;
44	}
45	
46	function push(tone: ToastTone, message: string, defaultDuration: number, opts?: ToastOptions): string {
47	  const duration = opts?.duration ?? defaultDuration;
48	  const id = useToastStore.getState().add({ tone, message, duration, action: opts?.action, testId: opts?.testId });
49	  if (duration > 0 && typeof globalThis.setTimeout === 'function') {
50	    setTimeout(() => useToastStore.getState().dismiss(id), duration);
51	  }
52	  return id;
53	}
54	
55	/**
56	 * Fire a toast from anywhere (React or not). Durations: success 2.5s,
57	 * info 4s, error 6s - override via opts.duration (0 = sticky).
58	 */
59	export const toast = {
60	  success: (message: string, opts?: ToastOptions) => push('success', message, 2500, opts),
61	  error: (message: string, opts?: ToastOptions) => push('error', message, 6000, opts),
62	  info: (message: string, opts?: ToastOptions) => push('info', message, 4000, opts),
63	};
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

 succeeded in 417ms:
## Exploration: resolveApp function registry app id slug artifactBacked ownerUserId

Found 205 symbols across 71 files.

### Blast radius — what depends on these (update/verify before editing)

- `AppRegistry` (api/src/apps/app-registry.ts:35) — 1 caller in `api/src/apps/app-registry.ts`; ⚠️ no covering tests found
- `RegisteredApp` (api/src/apps/app-registry.ts:19) — 3 callers in `api/src/apps/app-registry.ts`; ⚠️ no covering tests found
- `AssistantAppResolution` (api/src/apps/app-assistant-route.ts:55) — 1 caller in `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `ResolvedAppScope` (api/src/integrations/app-scope.ts:17) — 4 callers in `api/src/integrations/app-scope.ts`; tests: `api/tests/contract/app-sso.test.ts`

### Relationships

**references:**
- register → RegisteredApp
- getApp → RegisteredApp
- AssistantAppResolution → ResolvedApp
- resolveAssistantApp → AssistantAppResolution
- ResolvedApp → CollectionsBlock
- resolveApp → ResolvedApp
- admitOwner → ResolvedApp
- ResolveAppScope → ResolvedAppScope
- APPS → ResolvedAppScope
- resolveAppScope → ResolvedAppScope
- ... and 34 more

**calls:**
- appAssistantRouter → resolveAssistantApp
- consumePendingAppAuth → consume
- appSsoRouter → consumePendingAppAuth
- resolveApp → getApp
- admitApp → resolveApp
- appFilesRouter → resolveApp
- App → getCurrentUser
- getCurrentUser → whoami
- whoami → getRuntime
- appAssistantRouter → whoami
- ... and 221 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/registry.ts — ResolvedApp(interface), resolveApp(function)

```typescript
1	/**
2	 * App registry (ch07, ch04 §4.2.6). Resolves a served-app scope from the `X-Ekoa-App-Id`
3	 * header (slug OR canonical id; slug resolved server-side to the canonical id). Holds the
4	 * per-app compiled collection rules (from the manifest). In-memory (FIXED-8) + backed by the
5	 * `artifacts`/`slugs` stores. A client-supplied id starting with `usr.` is rejected upstream.
6	 */
7	import { artifacts, slugs } from '../data/stores.js';
8	import type { CollectionsBlock } from '../data/collections-engine.js';
9	import { appRegistry } from './app-registry.js';
10	
11	export interface ResolvedApp {
12	  appId: string; // canonical artifact id (or the registry id for registry-only apps)
13	  ownerUserId: string;
14	  sharedData: boolean;
15	  /** True when a persisted artifact record backs the app. False for REGISTRY-ONLY
16	   *  apps (the dev-serve surface, hard-off in production): they have no artifact
17	   *  owner, so the Amendment 2 owner-activation admission has no subject and the
18	   *  callers skip it - carried old-plane behavior for that dev-only surface. */
19	  artifactBacked: boolean;
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
46	    ownerUserId: reg.userId,
47	    sharedData: (reg.manifest as { sharedData?: boolean } | null)?.sharedData === true,
48	    artifactBacked: false,
49	  };
50	}
```

#### web/components/privacy/reference-token-chips.tsx — slug(function)

```tsx
1	'use client';
2	
3	import { FolderKey, X } from 'lucide-react';
4	import { PRIVACY_COPY } from '@/lib/privacy-claims';
5	import type { PendingReference } from '@/lib/bridge-local';
6	
7	/**
8	 * FC-400: the composer's visible reference tokens — files/folders the OUTGOING message will
9	 * reference. These are PENDING references (path/label/kind, owner decision D3): the daemon
10	 * grant is minted at send time, when the chat session id exists. Display-only labels (never
11	 * full paths); removing a chip just drops it from the message.
12	 */
13	export function ReferenceTokenChips({
14	  tokens,
15	  onRemove,
16	}: {
17	  tokens: PendingReference[];
18	  /** Remove by path — the pending reference's stable identity before a grantRef exists. */
19	  onRemove: (path: string) => void;
20	}) {
21	  if (tokens.length === 0) return null;
22	  return (
23	    <div className="flex flex-wrap gap-1.5 mb-2" aria-label={PRIVACY_COPY.referenceTokensLabel} data-testid="reference-token-chips">
24	      {tokens.map((t) => (
25	        <div
26	          key={t.path}
27	          className="flex items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs text-teal-800"
28	          data-testid={`reference-token-${slug(t.path)}`}
29	        >
30	          <FolderKey size={12} className="mr-1 text-teal-600" aria-hidden />
31	          <span className="max-w-[160px] truncate">{t.label}</span>
32	          <button
33	            type="button"
34	            onClick={() => onRemove(t.path)}
35	            aria-label={PRIVACY_COPY.referenceTokenRemove}
36	            className="ml-1 text-teal-500 hover:text-teal-800"
37	          >
38	            <X size={12} aria-hidden />
39	          </button>
40	        </div>
41	      ))}
42	    </div>
43	  );
44	}
45	
46	/** A test-friendly slug of a path for the chip's data-testid (labels can repeat; paths are unique). */
47	function slug(path: string): string {
48	  return path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
49	}
```

#### api/src/apps/app-registry.ts — AppRegistry(class), RegisteredApp(interface), sandboxRoot(method), register(method), getApp(method), unregister(method), listApps(method), size(method), onDistChange(method), start(method), +7 more

```typescript
1	/**
2	 * App registry (ch07 §7.3; carryover B2 - adapted). Tracks REGISTERED (served) apps
3	 * and the metadata static serving needs: distDir, projectDir, userId, name, manifest.
4	 * Each registered app's manifest.json and dist directory are watched via chokidar
5	 * (100 ms per-file debounce); dist changes notify listeners (cache busting / reload).
6	 * Boot scans the sandbox root's user-* project directories and registers only
7	 * projects with a valid manifest.json. Unregister keeps static files on disk.
8	 *
9	 * The B2 verdict drops the old per-app content maps (skills/recipes/instructions
10	 * hot-reloading) - dead weight in the new architecture; agent-facing content is
11	 * ch08's concern and never lives inside user app trees.
12	 */
13	import { readdir } from 'node:fs/promises';
14	import { join, resolve } from 'node:path';
15	import { homedir } from 'node:os';
16	import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
17	import { readManifest, type AppManifest } from './manifest.js';
18	
19	export interface RegisteredApp {
20	  /** Unique app id (matches the artifact id or manifest.id). */
21	  id: string;
22	  name: string;
23	  /** Absolute path to the build output directory (<projectDir>/<outputDir>). */
24	  distDir: string;
25	  /** Absolute path to the project root. */
26	  projectDir: string;
27	  /** Owner user id (extracted from the sandbox path when not provided). */
28	  userId: string;
29	  registeredAt: Date;
30	  manifest: AppManifest | null;
31	}
32	
33	export type DistChangeListener = (appId: string) => void;
34	
35	class AppRegistry {
36	  private apps = new Map<string, RegisteredApp>();
37	  private watchers = new Map<string, FSWatcher>();
38	  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
39	  private distChangeListeners: DistChangeListener[] = [];
40	  private _sandboxRoot: string | null = null;
41	
42	  get sandboxRoot(): string {
43	    return this._sandboxRoot || process.env.SANDBOX_ROOT || join(homedir(), '.ekoa', 'sandboxes');
44	  }
45	
46	  /** Register an app and start watching its manifest + dist. Idempotent (re-register replaces). */
47	  async register(appId: string, projectDir: string, userId?: string, name?: string): Promise<void> {
48	    if (this.apps.has(appId)) await this.unregister(appId);
49	
50	    let manifest: AppManifest | null = null;
51	    try {
52	      manifest = await readManifest(projectDir);
53	    } catch {
54	      /* invalid manifest tolerated - serving still works from the default dist */
55	    }
56	
57	    const outputDir = manifest?.outputDir || 'dist/';
58	    const distDir = resolve(projectDir, outputDir);
59	    const resolvedUserId = userId || extractUserIdFromPath(projectDir);
60	    const resolvedName = name || manifest?.name || appId;
61	
62	    const app: RegisteredApp = {
63	      id: appId,
64	      name: resolvedName,
65	      distDir,
66	      projectDir,
67	      userId: resolvedUserId,
68	      registeredAt: new Date(),
69	      manifest,
70	    };
71	    this.apps.set(appId, app);
72	    this.startWatcher(appId, projectDir, distDir);
73	    console.log(`[app-registry] registered "${appId}" (${resolvedName}) - dist: ${distDir}`);
74	  }
75	
76	  /** Unregister an app and stop its watcher. Static files remain on disk. */
77	  async unregister(appId: string): Promise<void> {
78	    const watcher = this.watchers.get(appId);
79	    if (watcher) {
80	      await watcher.close();
81	      this.watchers.delete(appId);
82	    }
83	    for (const [key, timer] of this.debounceTimers.entries()) {
84	      if (key.startsWith(`${appId}:`)) {
85	        clearTimeout(timer);
86	        this.debounceTimers.delete(key);
87	      }
88	    }
89	    this.apps.delete(appId);
90	  }
91	
92	  getApp(appId: string): RegisteredApp | undefined {
93	    return this.apps.get(appId);
94	  }
95	
96	  listApps(): RegisteredApp[] {
97	    return [...this.apps.values()];
98	  }
99	
100	  get size(): number {
101	    return this.apps.size;
102	  }
103	
104	  /** Fires whenever a registered app's dist directory changes. */
105	  onDistChange(listener: DistChangeListener): void {
106	    this.distChangeListeners.push(listener);
107	  }
108	
109	  /** Boot scan (ch07 §7.16): register every user-* project with a valid manifest. */
110	  async start(sandboxRoot: string): Promise<void> {
111	    this._sandboxRoot = sandboxRoot;
112	    let userDirs: string[];
113	    try {
114	      userDirs = await readdir(sandboxRoot);
115	    } catch {
116	      console.log('[app-registry] no sandboxes directory found, starting empty');
117	      return;
118	    }
119	    for (const userDir of userDirs) {
120	      if (!userDir.startsWith('user-')) continue;
121	      const userPath = join(sandboxRoot, userDir);
122	      const userId = userDir.replace('user-', '');
123	      let projects: string[];
124	      try {
125	        projects = await readdir(userPath);
126	      } catch {
127	        continue;
128	      }
129	      for (const project of projects) {
130	        const projectPath = join(userPath, project);
131	        try {
132	          const manifest = await readManifest(projectPath);
133	          if (manifest) await this.register(manifest.id, projectPath, userId, manifest.name);
134	        } catch {
135	          /* skip projects with invalid manifests */
136	        }
137	      }
138	    }
139	    console.log(`[app-registry] started - ${this.apps.size} app(s) loaded`);
140	  }
141	
142	  /** Stop all watchers and clear the registry (shutdown obligation, ch07 §7.16). */
143	  async stop(): Promise<void> {
144	    for (const id of [...this.apps.keys()]) await this.unregister(id);
145	    this.distChangeListeners = [];
146	  }
147	
148	  private startWatcher(appId: string, projectDir: string, distDir: string): void {
149	    const watcher = chokidarWatch([join(projectDir, 'manifest.json'), distDir], {
150	      ignoreInitial: true,
151	      persistent: true,
152	      ignored: /(^|[/\\])\.|node_modules/,
153	    });
154	
155	    const debouncedChange = (filePath: string) => {
156	      const key = `${appId}:${filePath}`;
157	      const existing = this.debounceTimers.get(key);
158	      if (existing) clearTimeout(existing);
159	      this.debounceTimers.set(
160	        key,
161	        setTimeout(() => {
162	          this.debounceTimers.delete(key);
163	          void this.handleFileChange(appId, filePath);
164	        }, 100),
165	      );
166	    };
167	
168	    watcher.on('add', debouncedChange);
169	    watcher.on('change', debouncedChange);
170	    watcher.on('unlink', (filePath) => this.handleFileRemove(appId, filePath));
171	    this.watchers.set(appId, watcher);
172	  }
173	
174	  private async handleFileChange(appId: string, filePath: string): Promise<void> {
175	    const app = this.apps.get(appId);
176	    if (!app) return;
177	
178	    if (filePath.endsWith('manifest.json')) {
179	      try {
180	        app.manifest = await readManifest(app.projectDir);
181	        if (app.manifest) {
182	          app.name = app.manifest.name;
183	          app.distDir = resolve(app.projectDir, app.manifest.outputDir);
184	        }
185	      } catch {
186	        app.manifest = null;
187	      }
188	      return;
189	    }
190	    if (filePath.startsWith(app.distDir)) this.notifyDistChange(appId);
191	  }
192	
193	  private handleFileRemove(appId: string, filePath: string): void {
194	    const app = this.apps.get(appId);
195	    if (!app) return;
196	    if (filePath.endsWith('manifest.json')) {
197	      app.manifest = null;
198	      return;
199	    }
200	    if (filePath.startsWith(app.distDir)) this.notifyDistChange(appId);
201	  }
202	
203	  private notifyDistChange(appId: string): void {
204	    for (const listener of this.distChangeListeners) {
205	      try {
206	        listener(appId);
207	      } catch (err) {
208	        console.warn('[app-registry] dist change listener error:', err);
209	      }
210	    }
211	  }
212	}
213	
214	/** Extract the owner id from a sandbox path like .../sandboxes/user-abc123/project. */
215	function extractUserIdFromPath(projectDir: string): string {
216	  for (const part of projectDir.split('/')) {
217	    if (part.startsWith('user-')) return part.replace('user-', '');
218	  }
219	  return 'unknown';
220	}
221	
222	export const appRegistry = new AppRegistry();
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The service layer confirms `orgId` is still stamped server-side and `read`/`convert`/`dismiss` remain org-scoped. I’m doing one last pass for any direct notification assertion in tests and for edge cases around missing owner rows, because those are the only remaining places a “closed but regressed elsewhere” verdict could hide.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --line-number \"owner\\?\\.orgId|orgId = owner\\?\\.orgId|ownerUserId|artifactBacked\" api/src/routes/change-requests.ts api/src/services/change-requests.ts api/src/apps/registry.ts api/src/apps/app-paths.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/apps/registry.ts:13:  ownerUserId: string;
api/src/apps/registry.ts:19:  artifactBacked: boolean;
api/src/apps/registry.ts:32:      ownerUserId: (art.userId as string) ?? '',
api/src/apps/registry.ts:34:      artifactBacked: true,
api/src/apps/registry.ts:46:    ownerUserId: reg.userId,
api/src/apps/registry.ts:48:    artifactBacked: false,
api/src/apps/app-paths.ts:57:export function newProjectDir(ownerUserId: string, appId: string): string {
api/src/apps/app-paths.ts:58:  return join(sandboxRoot(), `user-${ownerUserId}`, appId);
api/src/services/change-requests.ts:48:  target: { ownerUserId: string; appId: string } | null,
api/src/services/change-requests.ts:55:    const owner = await users.get(target.ownerUserId);
api/src/services/change-requests.ts:56:    orgId = owner?.orgId ?? '';
api/src/routes/change-requests.ts:44:    let target: { ownerUserId: string; appId: string } | null = null;
api/src/routes/change-requests.ts:48:      if (!app || !app.artifactBacked || !app.ownerUserId) {
api/src/routes/change-requests.ts:60:      target = { ownerUserId: app.ownerUserId, appId: app.appId };

exec
/bin/zsh -lc "rg --line-number \"emitChangeRequest|change_request|sseManager\\.emit|notifications channel|NO notification\" api/tests api/src/tests web/tests ." in /Users/ggomes/dev/ekoa-code
 exited 2 in 0ms:
rg: api/src/tests: No such file or directory (os error 2)
rg: web/tests: No such file or directory (os error 2)
api/tests/billing/usage-push.test.ts:12: * notifications channel (ch03 §3.6.4). Before the fix setUsageNotifier was never called, so the
api/tests/billing/usage-push.test.ts:65:  it('emits a bare usage_updated poke on the billee notifications channel', () => {
./api/tests/billing/usage-push.test.ts:12: * notifications channel (ch03 §3.6.4). Before the fix setUsageNotifier was never called, so the
./api/tests/billing/usage-push.test.ts:65:  it('emits a bare usage_updated poke on the billee notifications channel', () => {
api/tests/journeys/j2-grounding.mjs:5: * + código RX-417), the notifications channel pushes usage_updated, the turn persists, and a
api/tests/journeys/j2-grounding.mjs:69:  if (turn.notif.sawUsageUpdated) PASS('J2.usageUpdated', 'notifications channel pushed usage_updated', results);
api/tests/automation/run-events.test.ts:8: * `sseManager.emit('step', automationStepEventPayload(record, id))`, so this unit test pins the
./api/src/agents/streaming.ts:51:    sseManager.emit('chat', this.runId, ev.type, ev);
./api/src/agents/streaming.ts:90:    sseManager.emit('job', this.jobId, ev.type, ev);
./api/src/agents/streaming.ts:130:/** Fire a `build_intent` on the target user's notifications channel (§5.7.2). */
./api/src/agents/streaming.ts:133:  sseManager.emit('notifications', userId, 'build_intent', payload);
./api/src/agents/streaming.ts:136:/** Fire an `integration_build_intent` on the target user's notifications channel (§5.7.2). */
./api/src/agents/streaming.ts:139:  sseManager.emit('notifications', userId, 'integration_build_intent', payload);
./api/src/agents/streaming.ts:142:/** Deliver a `chat_answer` on the notifications channel (§5.6.2 in-build answer flow). */
./api/src/agents/streaming.ts:145:  sseManager.emit('notifications', userId, 'chat_answer', payload);
./api/src/agents/streaming.ts:149: *  refetch signal onto that admin's per-user notifications channel. Fired once per org-admin of
./api/src/agents/streaming.ts:151:export function emitChangeRequest(userId: string, ev: { appId?: string }): void {
./api/src/agents/streaming.ts:152:  const payload: NotificationEvent = { type: 'change_request', ...(ev.appId ? { appId: ev.appId } : {}) };
./api/src/agents/streaming.ts:153:  sseManager.emit('notifications', userId, 'change_request', payload);
./api/src/agents/streaming.ts:161:  sseManager.emit('notifications', userId, 'branding_updated', payload);
./api/tests/routes/change-requests.test.ts:46:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
./api/tests/routes/change-requests.test.ts:89:  it('CROSS-ORG INJECTION is blocked: filing about another org app -> 404, NO row, NO notification', async () => {
api/tests/routes/change-requests.test.ts:46:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
api/tests/routes/change-requests.test.ts:89:  it('CROSS-ORG INJECTION is blocked: filing about another org app -> 404, NO row, NO notification', async () => {
./api/src/routes/change-requests.ts:23:import { emitChangeRequest } from '../agents/streaming.js';
./api/src/routes/change-requests.ts:64:    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
./api/src/routes/change-requests.ts:65:    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
./api/src/server.ts:153:      sseManager.emit('automation', runId, type, data);
./api/src/server.ts:184:/** The usage push (§6.7): a bare `usage_updated` poke on the billee's notifications channel,
./api/src/server.ts:190:    sseManager.emit('notifications', userId, 'usage_updated', {});
./api/src/server.ts:207:  // root injects the notifier that pushes `usage_updated` on the billee's notifications channel.
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5200:51	    sseManager.emit('chat', this.runId, ev.type, ev);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5239:90	    sseManager.emit('job', this.jobId, ev.type, ev);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5279:130	/** Fire a `build_intent` on the target user's notifications channel (§5.7.2). */
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5282:133	  sseManager.emit('notifications', userId, 'build_intent', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5285:136	/** Fire an `integration_build_intent` on the target user's notifications channel (§5.7.2). */
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5288:139	  sseManager.emit('notifications', userId, 'integration_build_intent', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5291:142	/** Deliver a `chat_answer` on the notifications channel (§5.6.2 in-build answer flow). */
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5294:145	  sseManager.emit('notifications', userId, 'chat_answer', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md:5302:153	  sseManager.emit('notifications', userId, 'branding_updated', payload);
./api/src/automation/run-events.ts:4: * manager: the composition root's emitter stays a thin `sseManager.emit(...)` wrapper around this.
api/tests/contract/change-requests.test.ts:35:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests_contract');
./api/src/data/stores.ts:112:export const changeRequests = new Store<ChangeRequestDoc>('change_requests');
./api/tests/journeys/j2-grounding.mjs:5: * + código RX-417), the notifications channel pushes usage_updated, the turn persists, and a
./api/tests/journeys/j2-grounding.mjs:69:  if (turn.notif.sawUsageUpdated) PASS('J2.usageUpdated', 'notifications channel pushed usage_updated', results);
./api/tests/automation/run-events.test.ts:8: * `sseManager.emit('step', automationStepEventPayload(record, id))`, so this unit test pins the
./api/tests/contract/change-requests.test.ts:35:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests_contract');
./web/app/(dashboard)/pedidos/page.tsx:10: * it. A live `change_request` notification refetches the queue so a new request appears without a
./web/app/(dashboard)/pedidos/page.tsx:82:  // Live queue: a filed request pushes a `change_request` notification to this admin's channel;
./web/app/(dashboard)/pedidos/page.tsx:86:    const off = stream.on("change_request", () => {
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:733:   sseManager.emit('notifications', userId, 'chat_answer', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:737:+ *  refetch signal onto that admin's per-user notifications channel. Fired once per org-admin of
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:739:+export function emitChangeRequest(userId: string, ev: { appId?: string }): void {
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:740:+  const payload: NotificationEvent = { type: 'change_request', ...(ev.appId ? { appId: ev.appId } : {}) };
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:741:+  sseManager.emit('notifications', userId, 'change_request', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:779:+export const changeRequests = new Store<ChangeRequestDoc>('change_requests');
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:810:+import { emitChangeRequest } from '../agents/streaming.js';
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:842:+    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:843:+    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:1066:+  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests_contract');
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:1186:+  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:1444:+  // the live push into the org-admin's per-user notifications channel telling the dashboard
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:1446:+  z.object({ type: z.literal('change_request'), appId: z.string().optional() }),
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:1511:+ * it. A live `change_request` notification refetches the queue so a new request appears without a
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:1583:+  // Live queue: a filed request pushes a `change_request` notification to this admin's channel;
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:1587:+    const off = stream.on("change_request", () => {
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:2142:22	import { emitChangeRequest } from '../agents/streaming.js';
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:2174:54	    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:2175:55	    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:2485:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:2649:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests_contract');
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:4505:- `shared/src/events.ts`: additive `change_request` `NotificationEvent` member (`{ type, appId? }`)
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:4518:  caller body. Lands `status:'open'` + fires a `change_request` SSE to the OWNER org's org-admins.
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:4540:  notifications stream and refetches on `change_request` (live queue).
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:4602:- `api/src/agents/streaming.ts` - the emit helpers for the notifications channel live here (route
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:4615:`docs/diagrams/03-request-crud.excalidraw` - one free-standing note (`h4_change_requests`, indigo
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:4667:    54	    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:4668:    55	    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md:4791:    39	  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/brief.md:10:   `changeRequests = new Store<ChangeRequestDoc>('change_requests')` (stores.ts). Additive shared
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:21:- `shared/src/events.ts`: additive `change_request` `NotificationEvent` member (`{ type, appId? }`)
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:34:  caller body. Lands `status:'open'` + fires a `change_request` SSE to the OWNER org's org-admins.
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:56:  notifications stream and refetches on `change_request` (live queue).
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:118:- `api/src/agents/streaming.ts` - the emit helpers for the notifications channel live here (route
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md:131:`docs/diagrams/03-request-crud.excalidraw` - one free-standing note (`h4_change_requests`, indigo
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:14:Adversarial SECURITY re-review in /Users/ggomes/dev/ekoa-code. You flagged a HIGH on H4: cross-org queue INJECTION - any logged-in user could POST /api/v1/change-requests with X-Ekoa-App-Id of another org's app and inject a request into that org's queue (orgId stamped from the resolved app owner, no requester access check). The fix is in commit 67ad136 (git show HEAD). VERIFY the High is CLOSED + no new defect: the served-app file path in api/src/routes/change-requests.ts now calls loadReadable(actorOf(req), app.appId) and rejects with a UNIFORM 404 when the requester cannot read the app (cross-org, another-user-private, unknown id) BEFORE resolving the owner org / stamping / notifying - so a user can no longer inject into another org's queue; a same-org user filing about their own or an org-shared app still succeeds. Confirm: (1) is the loadReadable gate BEFORE any stamp/notify and is the 404 uniform (no cross-org existence oracle)? (2) does the refused-build filing path (no X-Ekoa-App-Id, requester's own org) remain correct and NOT newly broken? (3) is orgId still server-stamped (never body)? (4) do the tests now assert cross-org file -> 404 + NO row + NO notification (not a tautology), and same-org success? (5) any NEW bypass - e.g. a slug vs id path, a registry-only app, an ownerless app, or loadReadable returning ok for something it shouldn't? Also re-confirm the READ/convert/dismiss cross-org isolation you did NOT flag is still intact. Read slices/H4/impl-notes.md (Codex-fix round). Read-only cmds OK. Concise: a bullet per point (CLOSED/OK/NOT + file:line) then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1177:23	import { emitChangeRequest } from '../agents/streaming.js';
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1218:64	    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1219:65	    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1303:46	  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1346:89	  it('CROSS-ORG INJECTION is blocked: filing about another org app -> 404, NO row, NO notification', async () => {
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1498:/bin/zsh -lc 'codegraph explore "fileChangeRequest readChangeRequests convertChangeRequest dismissChangeRequest orgId requester body emitChangeRequest"' in /Users/ggomes/dev/ekoa-code
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1500:## Exploration: fileChangeRequest readChangeRequests convertChangeRequest dismissChangeRequest orgId requester body emitChangeRequest
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1509:- `emitChangeRequest` (api/src/agents/streaming.ts:151) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1519:- emitChangeRequest → emit
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1520:- changeRequestsRouter → emitChangeRequest
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1768:#### api/src/agents/streaming.ts — emitChangeRequest(function)
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1821:51	    sseManager.emit('chat', this.runId, ev.type, ev);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1860:90	    sseManager.emit('job', this.jobId, ev.type, ev);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1900:130	/** Fire a `build_intent` on the target user's notifications channel (§5.7.2). */
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1903:133	  sseManager.emit('notifications', userId, 'build_intent', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1906:136	/** Fire an `integration_build_intent` on the target user's notifications channel (§5.7.2). */
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1909:139	  sseManager.emit('notifications', userId, 'integration_build_intent', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1912:142	/** Deliver a `chat_answer` on the notifications channel (§5.6.2 in-build answer flow). */
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1915:145	  sseManager.emit('notifications', userId, 'chat_answer', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1919:149	 *  refetch signal onto that admin's per-user notifications channel. Fired once per org-admin of
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1921:151	export function emitChangeRequest(userId: string, ev: { appId?: string }): void {
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1922:152	  const payload: NotificationEvent = { type: 'change_request', ...(ev.appId ? { appId: ev.appId } : {}) };
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1923:153	  sseManager.emit('notifications', userId, 'change_request', payload);
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md:1931:161	  sseManager.emit('notifications', userId, 'branding_updated', payload);
./docs/diagrams/03-request-crud.excalidraw:2521:      "id": "h4_change_requests",
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/brief-draft.md:10:   `changeRequests = new Store<ChangeRequestDoc>('change_requests')` (stores.ts). Additive shared
./shared/src/events.ts:192:  // the live push into the org-admin's per-user notifications channel telling the dashboard
./shared/src/events.ts:194:  z.object({ type: z.literal('change_request'), appId: z.string().optional() }),

codex
- `CLOSED` The served-app path now gates on `loadReadable(actorOf(req), app.appId)` before any `target` stamp, `fileChangeRequest(...)`, or `emitChangeRequest(...)`; the failure is a uniform `404 NOT_FOUND` for cross-org, another-user-private, and unknown app ids, so there is no existence oracle. Refs: [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:46), [app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:89), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:89), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:99), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:105)

- `OK` The refused-build filing path (`no X-Ekoa-App-Id`) is unchanged and still lands in the requester’s own org; body `appId` is only carried as a label and does not affect org routing. Refs: [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:44), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:63), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:58), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:177)

- `OK` `orgId` is still server-stamped, never read from the body: served-app filings stamp from the resolved owner user’s org, refused-build filings stamp from `requester.orgId`; the request body schema has no `orgId`. Refs: [change-request.ts](/Users/ggomes/dev/ekoa-code/shared/src/change-request.ts:57), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:52)

- `NOT` The tests do cover cross-org `404`, `NO row`, and same-org success, but they do not directly assert `NO notification`; the “NO notification” case is only inferred from `admB`’s queue staying empty and `changeRequests.find({})` staying empty, with no spy/assertion on `emitChangeRequest`/`sseManager.emit`. Refs: [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:70), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:89), [streaming.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/streaming.ts:151)

- `OK` I do not see a new bypass in the requested classes: slug-vs-id still collapses to canonical `app.appId` before the read gate, registry-only and ownerless apps are rejected before filing, and `loadReadable` only returns own or same-org `visibility:'org'` artifacts. The previously unflagged read/convert/dismiss cross-org isolation also remains intact via org-scoped service guards and tests. Refs: [registry.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/registry.ts:24), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:47), [app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:89), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:84), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:101), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:112), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:149)

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
84,275
- `CLOSED` The served-app path now gates on `loadReadable(actorOf(req), app.appId)` before any `target` stamp, `fileChangeRequest(...)`, or `emitChangeRequest(...)`; the failure is a uniform `404 NOT_FOUND` for cross-org, another-user-private, and unknown app ids, so there is no existence oracle. Refs: [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:46), [app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:89), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:89), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:99), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:105)

- `OK` The refused-build filing path (`no X-Ekoa-App-Id`) is unchanged and still lands in the requester’s own org; body `appId` is only carried as a label and does not affect org routing. Refs: [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:44), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:63), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:58), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:177)

- `OK` `orgId` is still server-stamped, never read from the body: served-app filings stamp from the resolved owner user’s org, refused-build filings stamp from `requester.orgId`; the request body schema has no `orgId`. Refs: [change-request.ts](/Users/ggomes/dev/ekoa-code/shared/src/change-request.ts:57), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:52)

- `NOT` The tests do cover cross-org `404`, `NO row`, and same-org success, but they do not directly assert `NO notification`; the “NO notification” case is only inferred from `admB`’s queue staying empty and `changeRequests.find({})` staying empty, with no spy/assertion on `emitChangeRequest`/`sseManager.emit`. Refs: [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:70), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:89), [streaming.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/streaming.ts:151)

- `OK` I do not see a new bypass in the requested classes: slug-vs-id still collapses to canonical `app.appId` before the read gate, registry-only and ownerless apps are rejected before filing, and `loadReadable` only returns own or same-org `visibility:'org'` artifacts. The previously unflagged read/convert/dismiss cross-org isolation also remains intact via org-scoped service guards and tests. Refs: [registry.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/registry.ts:24), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:47), [app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:89), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:84), [change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:101), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:112), [change-requests.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/routes/change-requests.test.ts:149)

VERDICT: NEEDS-WORK
