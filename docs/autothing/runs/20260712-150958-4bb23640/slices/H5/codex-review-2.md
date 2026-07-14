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
session id: 019f5dff-996e-7571-b1fb-f36c335cc79b
--------
user
Adversarial SECURITY re-review in /Users/ggomes/dev/ekoa-code. You flagged 3 issues on H5 (the assertion layer): HIGH - the destructive-action-authz test documented-away a REAL gap (the /api/app-data mutation plane authenticates no caller, so cross-tenant app-data writes by app-id are possible); MEDIUM - the capability-wiring inventory is a file-level string check that stays green if a route silently loses its gate (whoami could return a constant); LOW - the grep gate only scanned web/{app,components,stores}. The fixes are in commit 1515c2e (git show 1515c2e). VERIFY each: (1) HIGH - is it now handled HONESTLY (not falsely dismissed)? docs/security.md should state it plainly as a KNOWN HIGH GAP with the real threat; docs/findings.md should carry a HIGH entry; api/tests/security/destructive-action-authz.test.ts should PIN the current unauthenticated-write state as a TRIPWIRE (a future fix flips it) rather than claim safety. Assess: is flag-not-fix defensible here (a pre-existing served-app-data-plane architecture gap on a different axis from the platform role/capability layer, needing an operator decision + a dedicated slice), OR do you consider it a blocker the H block must FIX now? (2) MEDIUM - does the whoami wiring row now require the route to actually call detectAppEditor (a constant would fail), and does the inventory now name + assert-exist the authoritative behavioral suites? (3) LOW - does the grep gate now scan all live web source roots (web/lib, web/hooks, web/types, web/locales)? Also confirm no NEW defect. Read slices/H5/impl-notes.md (Codex-fix round). Read-only cmds OK (grep/git/vitest tests/security tests/auth). Concise: a bullet per finding (CLOSED / STILL-OPEN / ACCEPTED-AS-FLAGGED + file:line) then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `1515c2e` against the three H5 findings. I’ll load the project context files first, check whether CodeGraph is available, then inspect the commit and the cited security/docs/tests slices.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'if [ -d .codegraph ]; then echo CODEGRAPH_PRESENT; else echo CODEGRAPH_ABSENT; fi' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
CODEGRAPH_PRESENT

exec
/bin/zsh -lc "pwd && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'impl-notes.md' -g 'security.md' -g 'findings.md' | sed 's#"'^#./#'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/Users/ggomes/dev/ekoa-code
./docs/security.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/C5/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/E1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/C3/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/D2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/D3/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/G2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/F2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/D1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/B2/impl-notes.md
./docs/findings.md

exec
/bin/zsh -lc 'git show --stat --oneline --decorate=short 1515c2e' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-CevAOcLB' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-MSn6zQMt' (errno=Operation not permitted)
1515c2e (HEAD -> main) fix(operator-run/h5): codex findings - (HIGH) reframe the served-app /api/app-data unauthenticated-write gap HONESTLY: it is a real pre-existing HIGH gap (any caller knowing an app id can write/delete that app's data cross-tenant; collection write-mode unenforced; app-sso cookie not sent to the data path), NOT a 'documented boundary' - docs/security.md reworded, HIGH findings entry, a TRIPWIRE pinning the current state, flagged as the top operator decision (not silently fixed - it is an architecture change across the app estate, a separate axis from the complete H1-H4 platform layer); (MED) wiring inventory now requires the whoami route to actually call detectAppEditor + names the authoritative behavioral suites (structural check is only a smoke); (LOW) grep gate scans ALL live web source roots. 30/30 security+capabilities; live journeys both PASS
 api/tests/auth/capabilities.test.ts                | 47 +++++++++++++++++-----
 .../security/destructive-action-authz.test.ts      | 33 +++++++++++++++
 api/tests/security/grep-gates.test.ts              |  7 +++-
 .../slices/H5/edit-journey-output.txt              | 11 +++++
 .../slices/H5/impl-notes.md                        | 37 +++++++++++++++++
 .../slices/H5/request-changes-journey-output.txt   | 11 +++++
 docs/findings.md                                   | 19 +++++++++
 docs/security.md                                   | 32 ++++++++++-----
 8 files changed, 175 insertions(+), 22 deletions(-)

codex
CodeGraph is indexed here, so I’m using it to inspect the H5 slice and the touched tests/docs before judging whether the commit actually closes the review points or only reframes them.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph node docs/security.md' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/tests/security/destructive-action-authz.test.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node docs/findings.md' in /Users/ggomes/dev/ekoa-code
 succeeded in 176ms:
No indexed file matches "docs/findings.md". Codegraph indexes source files; configs/docs it doesn't parse won't appear — Read those directly.

 succeeded in 196ms:
No indexed file matches "docs/security.md". Codegraph indexes source files; configs/docs it doesn't parse won't appear — Read those directly.

 succeeded in 196ms:
No indexed file matches "docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md". Codegraph indexes source files; configs/docs it doesn't parse won't appear — Read those directly.

 succeeded in 176ms:
**api/tests/security/destructive-action-authz.test.ts** — 177 lines, 12 symbols · no other indexed file depends on it

1	/**
2	 * H5 destructive-action authorization asserted SERVER-SIDE (BRIEF Phase 10 deliverable 4).
3	 *
4	 * The claim under proof: a mutating/destructive operation that reaches an app's SERVER surface and is
5	 * meant to be end-user-gated is authorized SERVER-SIDE by the per-app SSO identity - the client
6	 * confirmation (the Phase 4 destructive-action confirm dialog) is UX, NOT the boundary. Where that
7	 * boundary LIVES is the per-app SSO session (api/src/integrations/app-sso.ts), which mints and checks
8	 * an HttpOnly cookie bound to ONE app by `session.appId` (findValidAppSession). We drive the
9	 * canonical session-gated mutating op - `POST /api/app-sso/set-password`, which writes a bcrypt hash
10	 * onto the app's own app-data row - and prove the SERVER rejects it WITHOUT a valid app-sso session
11	 * and with a WRONG-APP session, independent of any client-side confirmation (there is no confirmation
12	 * parameter - the server decides on identity alone). The visitor-acting Microsoft Graph proxy
13	 * (`/api/app-sso/m365/*`) is asserted the same way.
14	 *
15	 * DOCUMENTED BOUNDARY (the destructive-action-authz finding - see docs/security.md + the H5
16	 * impl-notes): the GENERAL served-app data plane (`/api/app-data/*`, served-data.ts) that a C3
17	 * action's submit/delete lands on is deliberately app-id-SCOPED and byte-compatible with the legacy
18	 * key-value plane ("No platform JWT anywhere on this plane") - its per-app server boundary is the
19	 * `X-Ekoa-App-Id` scope + the owner-activation admission gate, NOT an app-sso session. The app-sso
20	 * IDENTITY plane asserted here gates the PRIVILEGED end-user ops (set-password, the Graph proxy). No
21	 * new auth code is added by H5; this suite ASSERTS the authz that H1-H4 and the served-app plane
22	 * already own.
23	 */
24	import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
25	import express from 'express';
26	import type { Server } from 'node:http';
27	import bcrypt from 'bcryptjs';
28	import { readFileSync } from 'node:fs';
29	import { fileURLToPath } from 'node:url';
30	import { dirname, resolve } from 'node:path';
31	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
32	import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
33	import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
34	import { __resetConfigForTests, loadConfig } from '../../src/config.js';
35	import { CollectionsEngine, appScope } from '../../src/data/collections-engine.js';
36	import { appSsoRouter } from '../../src/integrations/app-sso.js';
37	import type { ResolvedAppScope } from '../../src/integrations/app-scope.js';
38	
39	let mem: MongoMemoryServer;
40	let server: Server;
41	let port: number;
42	let seq = 0;
43	const deps = { now: () => Date.now(), genId: () => `id_${seq++}` };
44	
45	// Two apps, two owners, two disjoint per-app SSO namespaces. A session minted for app2 must NEVER
46	// authorize a mutation against app1.
47	const APPS: Record<string, ResolvedAppScope> = {
48	  app1: { appId: 'app1', ownerUserId: 'owner1', isServed: true, m365Proxy: true },
49	  app2: { appId: 'app2', ownerUserId: 'owner2', isServed: true, m365Proxy: true },
50	};
51	const resolveAppScope = async (idOrSlug: string): Promise<ResolvedAppScope | null> => APPS[idOrSlug] ?? null;
52	
53	const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);
54	
55	beforeAll(async () => {
56	  process.env.ENCRYPTION_KEY = 'k';
57	  process.env.JWT_SECRET = 's';
58	  __resetConfigForTests();
59	  loadConfig();
60	  mem = await createMem();
61	  await connectMongo(mem.getUri(), 'ekoa_destructive_authz');
62	  const app = express();
63	  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope, crossSite: false }));
64	  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
65	  port = (server.address() as { port: number }).port;
66	}, 60_000);
67	
68	afterAll(async () => {
69	  server.close();
70	  await closeMongo();
71	  await mem.stop();
72	});
73	
74	beforeEach(async () => {
75	  __resetActivationForTests();
76	  setActivation('owner1', { active: true, billingLocked: false });
77	  setActivation('owner2', { active: true, billingLocked: false });
78	  await getDb().collection('app_data').deleteMany({});
79	  await getDb().collection('app_sessions').deleteMany({});
80	  // Seed one end-user into each app's own user collection (the password-auth surface).
81	  const engine = new CollectionsEngine(deps);
82	  await engine.create(appScope('app1'), 'utilizadores', { email: 'ana@app1.pt', passwordHash: await bcrypt.hash('segredo123', 12), name: 'Ana', role: 'user' });
83	  await engine.create(appScope('app2'), 'utilizadores', { email: 'rui@app2.pt', passwordHash: await bcrypt.hash('segredo456', 12), name: 'Rui', role: 'user' });
84	});
85	
86	const cookieFrom = (res: Response) => (res.headers.get('set-cookie') || '').split(';')[0] as string;
87	const loginApp = (appId: string, identity: string, password: string) =>
88	  api('/api/app-sso/login', {
89	    method: 'POST',
90	    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId },
91	    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
92	  });
93	const setPassword = (appId: string, identity: string, password: string, cookie?: string) =>
94	  api('/api/app-sso/set-password', {
95	    method: 'POST',
96	    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId, ...(cookie ? { cookie } : {}) },
97	    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
98	  });
99	
100	describe('set-password (a mutating app op) is authorized server-side by the app-sso identity, not client confirmation', () => {
101	  it('WITHOUT a valid app-sso session -> 401 not_authenticated (the server rejects the mutation on identity alone; no confirmation param can substitute)', async () => {
102	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01'); // no cookie
103	    expect(res.status).toBe(401);
104	    expect(((await res.json()) as { error: string }).error).toBe('not_authenticated');
105	    // And the mutation did NOT happen: the old password still logs in, the new one does not.
106	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(401);
107	    expect((await loginApp('app1', 'ana@app1.pt', 'segredo123')).status).toBe(200);
108	  });
109	
110	  it('with a WRONG-APP session (an app2 session presented to app1) -> 401 (session.appId isolation; the cross-app mutation is refused)', async () => {
111	    const app2Cookie = cookieFrom(await loginApp('app2', 'rui@app2.pt', 'segredo456'));
112	    expect(app2Cookie).toContain('ekoa_app_sso_app2=');
113	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01', app2Cookie);
114	    expect(res.status).toBe(401); // findValidAppSession(token, 'app1') is null: the session is bound to app2
115	    // The app1 row is untouched - the wrong-app session authorized nothing.
116	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(401);
117	    expect((await loginApp('app1', 'ana@app1.pt', 'segredo123')).status).toBe(200);
118	  });
119	
120	  it('with the CORRECT same-app session (self) -> 200: the app-sso identity - and only it - authorizes the mutation', async () => {
121	    const app1Cookie = cookieFrom(await loginApp('app1', 'ana@app1.pt', 'segredo123'));
122	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01', app1Cookie);
123	    expect(res.status).toBe(200);
124	    expect(await res.json()).toEqual({ success: true });
125	    // The server-side mutation took effect: the new password now logs in. There was no client
126	    // confirmation in the request - the app-sso session identity is the whole boundary.
127	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(200);
128	  });
129	});
130	
131	describe('KNOWN GAP (codex-h5 High): the GENERAL /api/app-data mutation plane authenticates NO caller', () => {
132	  // This is a TRIPWIRE, not a proof of safety. The served-app data plane (served-data.ts) lets ANY
133	  // caller who knows an app id POST/PUT/DELETE that app's data - `scopeFor()` checks only the
134	  // X-Ekoa-App-Id header + the app OWNER's activation (admitOwner), never the CALLER. Phase 10's
135	  // "destructive-action authorization asserted server-side" is therefore NOT met for this surface.
136	  // It is PRE-EXISTING and an architecture-level operator decision (see docs/security.md + findings).
137	  // We PIN the current state so a future fix (a caller/session check on the data-plane writes) FLIPS
138	  // this test and forces docs/findings/this-assertion to be updated - the gap can never be quietly
139	  // "fixed" or quietly regress unnoticed. served-app.test.ts additionally proves BEHAVIORALLY that an
140	  // unauthenticated /api/app-data POST currently returns 201.
141	  const servedDataSrc = readFileSync(
142	    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/apps/served-data.ts'),
143	    'utf8',
144	  );
145	
146	  it('the data-plane write routes exist and are scoped ONLY by scopeFor (no caller auth) - CLOSING THIS FLIPS THE TRIPWIRE', () => {
147	    expect(/r\.post\(`\$\{prefix\}\/:collection`/.test(servedDataSrc)).toBe(true);
148	    expect(/r\.put\(`\$\{prefix\}\/:collection\/:id`/.test(servedDataSrc)).toBe(true);
149	    expect(/r\.delete\(`\$\{prefix\}\/:collection\/:id`/.test(servedDataSrc)).toBe(true);
150	    // The writes gate ONLY through scopeFor, which today performs NO caller-session / app-sso check.
151	    // If session/caller auth is ever added to the data-plane writes (the fix), one of these tokens
152	    // appears and this fails ON PURPOSE - update the KNOWN GAP (docs/security.md + findings.md) and
153	    // rewrite this suite to assert the new server-side authorization.
154	    expect(
155	      /findValidAppSession|requireAppSession|ekoa_app_sso/i.test(servedDataSrc),
156	      'served-data.ts now references an app-sso session on the data plane - the KNOWN GAP may be closed; update docs/findings + this tripwire',
157	    ).toBe(false);
158	  });
159	});
160	
161	describe('the visitor-acting Microsoft Graph proxy is gated by the app-sso session too', () => {
162	  it('WITHOUT a session -> 401 not_authenticated (a mutating /m365/* forward never runs unauthenticated)', async () => {
163	    const res = await api('/api/app-sso/m365/v1.0/me', { method: 'POST', headers: { 'x-ekoa-app-id': 'app1' } });
164	    expect(res.status).toBe(401);
165	    expect(((await res.json()) as { error: string }).error).toBe('not_authenticated');
166	  });
167	
168	  it('with a WRONG-APP session -> 401 (a session bound to app2 cannot act on app1)', async () => {
169	    const app2Cookie = cookieFrom(await loginApp('app2', 'rui@app2.pt', 'segredo456'));
170	    const res = await api('/api/app-sso/m365/v1.0/me', {
171	      method: 'POST',
172	      headers: { 'x-ekoa-app-id': 'app1', cookie: app2Cookie },
173	    });
174	    expect(res.status).toBe(401);
175	  });
176	});
177	

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba docs/security.md | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "nl -ba docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	# H5 impl-notes - SECURITY: the ASSERTION layer (capability matrix, grep gates, isolation, journeys)
     2	
     3	Status: DONE-GREEN. H5 asserts what H1-H4 built; it adds NO new capability/permission/auth logic (no
     4	`api/src` production file touched). All five deliverables built + green in the FULL api vitest lane
     5	(**180 files, 1627 passed, 1 skipped** - was 177/1601/1 at H4: +3 test files, +26 tests). Two
     6	non-blocking OBSERVATIONS surfaced for the lead (below) - neither is a hole in H1-H4's platform authz.
     7	
     8	## Deliverable 1 - Capability matrix + gate-wiring assertion
     9	
    10	`api/tests/auth/capabilities.test.ts` (EXTENDED, reserved path):
    11	- The full 3x4 grid + null/undefined -> nothing already existed (H1). ADDED: an **unknown/stale role
    12	  -> nothing (fail closed)** cell - a signature-valid actor carrying a dead role value (`builder`
    13	  bypassing the shim, `root`, `''`) is refused every capability (pins the `?? false` defensive branch).
    14	- ADDED a `describe('capability gate wiring (H5)...')` block: a WIRING INVENTORY that ties every
    15	  capability to the route `can(actor, '...')` call site enforcing it (data-driven `it.each`), reading
    16	  the route source so a matrix that stays green while a route silently loses its gate FAILS. Covers:
    17	  jobs.ts (canBuildApps first-build / canEditApps follow-up), chat.ts (canUseChat), artifacts.ts
    18	  (canCreateArtifacts create / canEditApps denyAppEdit / canBuildApps import+fork - incl. the
    19	  `forkCap` ternary indirection), app-assistant-route.ts (canEditApps whoami/isAppEditor). Plus a pin
    20	  that the two admin-only capabilities (a user is denied canBuildApps+canEditApps) each have an
    21	  enforcing gate. CROSS-REFERENCES (does NOT duplicate) `jobs-capability.test.ts` +
    22	  `artifacts-capability.test.ts`, which drive the behavior end-to-end.
    23	
    24	## Deliverable 2 - Grep gates (committed test, self-proving non-tautology)
    25	
    26	`api/tests/security/grep-gates.test.ts` (NEW, reserved path). Chosen a committed vitest gate over a
    27	scripts/ hook: it runs in the FULL vitest lane the operator runs, is self-contained, and can prove
    28	its own non-tautology in-suite. Two tree scans:
    29	- **No permissive stub:** `PERMISSIVE-STUB`/`PERMISSIVE_STUB` marker appears nowhere in api/src +
    30	  shared/src (H1 removed it; asserted it stays gone).
    31	- **No orphan `builder` role ref:** a quoted `'builder'`/`"builder"` ROLE literal in api/src +
    32	  shared/src + web/{app,components,stores} must be in the commented allowlist: `api/src/auth/jwt.ts`
    33	  (legacy-JWT shim), `api/src/auth/users-service.ts` (migrateBuilderRole query + comments),
    34	  `web/stores/orchestration.ts` (SESSION-KIND `builder`, NOT a user role). The org-setting KEY
    35	  `allowBuilderAutomations` is naturally excluded (the quoted-literal matcher never matches an
    36	  unquoted identifier substring - asserted by the matcher self-test). A NEW orphan literal in any
    37	  other file FAILS.
    38	- **Non-tautology proven two ways:** (a) an in-suite self-test drives the pure matcher + allowlist
    39	  logic against PLANTED violations (a real `'builder'` literal / stub marker IS detected; feature
    40	  identifiers `integrationBuilder`/`builderSessionId`/`allowBuilderAutomations`/`"Builder"` label are
    41	  NOT; a non-allowlisted file IS flagged) - durable, not a one-off; (b) VERIFIED by planting
    42	  `export const x = 'builder'; // PERMISSIVE-STUB` in a temp `api/src/__h5_grep_probe__.ts`: BOTH
    43	  gates failed, probe removed, gates green again.
    44	
    45	## Deliverable 3 - Cross-org knowledge isolation extended to ASSISTANT RETRIEVAL
    46	
    47	`api/tests/security/assistant-cross-org-isolation.test.ts` (NEW, reserved path). DETERMINISTIC
    48	integration over the REAL grounding seam (no LLM): seed org A + org B partitions in a real FTS index
    49	with distinctive per-org tokens (bodies share no query content word, so the only FTS-matchable token
    50	is the org's own), wire the REAL `buildGroundingBlock` as `runAppAssistant`'s `deps.ground`, and
    51	assert:
    52	- an org-A app's assistant retrieves + cites org A's fact and NEVER org B's (org B's token never
    53	  even enters the systemPrompt the model would see);
    54	- an org-B app asking for org A's fact retrieves NOTHING (isolation, not just non-citation);
    55	- symmetric for B; and the OWNER org - never a visitor-planted `context.orgId` - decides the
    56	  partition (a steered attacker-org partition is never consulted).
    57	This is the committed GATE. Live evidence is folded into the journey drivers + the existing
    58	`fees-knowledge.e2e.mjs` (owner-org CITED), so no separate live driver was added for #3 (decision).
    59	
    60	## Deliverable 4 - Destructive-action authorization asserted SERVER-SIDE
    61	
    62	`api/tests/security/destructive-action-authz.test.ts` (NEW, reserved path). Asserts the app-sso
    63	IDENTITY plane (`api/src/integrations/app-sso.ts`) gates a mutating served-app op server-side,
    64	independent of any client confirmation:
    65	- `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data row) -> **401 WITHOUT a
    66	  valid app-sso session**; **401 with a WRONG-APP session** (an app2 cookie presented to app1 -
    67	  `findValidAppSession(token, app1)` is null by `session.appId` isolation); **200 only for the
    68	  correct same-app session** (the app-sso identity, and only it, authorizes the mutation - there is
    69	  no confirmation param). Each path also asserts the app1 row was/was-not actually mutated.
    70	- the visitor-acting `/api/app-sso/m365/*` proxy is gated the same way (401 without / with a wrong-app
    71	  session).
    72	
    73	### Destructive-action-authz FINDING (documented boundary, not a hole)
    74	The brief's premise ("a destructive app-data op is authorized by the app-sso identity") is TRUE for
    75	the PRIVILEGED end-user ops (set-password, the Graph proxy) - asserted above. It is NOT how the
    76	GENERAL served-app data plane works, and that is a DELIBERATE, PRE-EXISTING, DOCUMENTED design:
    77	- `api/src/apps/served-data.ts` (`/api/app-data/*`, where a C3 submit/delete lands) is app-id-SCOPED
    78	  and byte-compatible with the legacy key-value plane ("No platform JWT anywhere on this plane"). Its
    79	  per-app server boundary is `X-Ekoa-App-Id` scope + the owner-activation admission gate
    80	  (deactivated/billing-locked owner refused), NOT an app-sso session. `docs/security.md` already
    81	  records this ("must never hold confidential or per-user-private data ... a documented decision, not
    82	  an oversight"); the shared plane (`/api/app-shared`) adds owner-resolution + same-origin + the
    83	  `sharedData` opt-in. So the client confirmation is UX, and the SERVER boundary that DOES exist is
    84	  the app-id scope + owner-activation (general plane) and the app-sso session (privileged ops).
    85	- Recorded in `docs/security.md` under a new "Security-block assertion layer (H5)" subsection.
    86	
    87	## Deliverable 5 - Live journey drivers (AUTHORED, not run - the lead runs them)
    88	
    89	Two committed, budget-capped, transient-tolerant drivers modelled on `fees-knowledge.e2e.mjs` /
    90	`assistant-billing.e2e.mjs` (safeJson never throws; bounded transient tolerance; single-shot build
    91	create; 20min build deadline). node --check clean. Registered in `api/tests/SUITE_LEDGER.json`
    92	(`node_drivers.drivers`, targetGate `operator-run H5`).
    93	- `api/tests/e2e/edit-journey.e2e.mjs`: admin whoami true -> explicit (client-only) opt-in -> H1-gated
    94	  follow-up PATCH RUN -> preview/diff (versions) -> approve (keep head) -> ROLLBACK restores (H3
    95	  forward-restore to the pre-run head); AND a freshly-created role:'user' session gets whoami false +
    96	  POST /jobs follow-up refused 403 (canEditApps). Budget: up to 2 builds (setup + patch-run; 1 with
    97	  `EDIT_APP_ID`) + 1 rollback restore.
    98	- `api/tests/e2e/request-changes-journey.e2e.mjs`: an in-org user files from inside an org-shared app
    99	  (route+screen context) -> lands in the OWNER org queue -> the org-admin sees it WITH context ->
   100	  convert STARTS an H1-gated patch run + links the jobId (asserted at the API level: the build is
   101	  started then cancelled, not awaited). FOLDS IN H4's live cross-org proof: a different-org user
   102	  filing about the same app -> 404, no injection into the queue. Budget: 1 setup build + 1 follow-up
   103	  build started-then-cancelled (1 with `REQCHG_APP_ID`).
   104	
   105	## OBSERVATIONS for the lead (non-blocking; NOT fixed - outside H5's remit)
   106	
   107	1. **`assistant-billing.e2e.mjs:138` uses `role: 'builder'`** in its `POST /api/v1/users` body. H1's
   108	   rename made `builder` an invalid `Role` enum value, so `CreateUserRequest` validation now 400s that
   109	   create - the driver will FAIL at user-create when the operator runs it. One-char fix
   110	   (`'builder'` -> `'user'`), but the file is an EXISTING operator driver OUTSIDE H5's reserved set
   111	   (and possibly concurrently owned), so it is FLAGGED, not touched. The H5 journey drivers correctly
   112	   use `role: 'user'`.
   113	2. **Collection-rule `access: { read, write: 'session' | 'server' }` is declared-but-unenforced.** The
   114	   manifest schema (`api/src/data/collections-engine.ts`) lets an app author DECLARE a write-access
   115	   level of `session`/`server`, but `served-data.ts` never consults it (every write is app-id-scoped
   116	   regardless). If any app relied on `access.write: 'session'` for security it would not hold. This is
   117	   PRE-EXISTING (C3/D1 data plane), OUTSIDE the H-block's platform-authz scope, and consistent with
   118	   the byte-compat posture already documented - flagged for the C3/data-plane owner, not fixed (H5
   119	   asserts, it adds no auth code).
   120	3. Minor: `shared/src/capabilities.ts` header comment is stale (still says the file "exposes a
   121	   PERMISSIVE stub ... until then"; H1 landed the real matrix). It does NOT contain the hyphenated
   122	   `PERMISSIVE-STUB` grep marker, so the D2 gate is unaffected. `shared/src` is outside H5's reserved
   123	   set - not touched.
   124	
   125	None of these is a GAP in what H1-H4 built (no missing platform gate, no isolation hole, no missing
   126	server authz on the platform planes) - so H5 is DONE-GREEN, not GAP-FOUND. The lead decides on (1)/(2).
   127	
   128	## Diagram invariant (FIXED-12)
   129	H5 changes NO structure, flow, or data shape - it adds committed assertions + docs over the existing
   130	security block (whose diagrams H1/H3/H4 already updated: 12-org-tenancy, 04-agent-job, 03-request-crud,
   131	10-privacy-boundaries). No diagram update is required for an assertion-only slice (checked, decided).
   132	
   133	## Reserved-path compliance
   134	All changes are within the H5 reserved set:
   135	- `api/tests/auth/capabilities.test.ts` (extended)
   136	- `api/tests/security/grep-gates.test.ts`, `assistant-cross-org-isolation.test.ts`,
   137	  `destructive-action-authz.test.ts` (new dir `api/tests/security/`)
   138	- `api/tests/e2e/edit-journey.e2e.mjs`, `request-changes-journey.e2e.mjs` (new)
   139	- `api/tests/SUITE_LEDGER.json` (2 driver rows)
   140	- `docs/security.md` (H5 assertion-layer subsection + the destructive-action-authz finding)
   141	- `docs/autothing/runs/.../slices/H5/**` (this file + worker-status.txt)
   142	NO `api/src`/`shared/src`/`web` production file touched. No commits, no stack ops, no real builds
   143	(the journey drivers are authored, not run). Nothing outside `api/src/llm` touches the provider.
   144	
   145	## Verification (all green, locally)
   146	- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0; `-p tsconfig.test.json` -> 0
   147	- `npx eslint` on the four touched `.ts` test files -> 0 errors (the `.mjs` drivers are config-ignored;
   148	  `node --check` is their gate - both pass)
   149	- `cd api && npx vitest run tests/` (FULL lane) -> **180 files, 1627 passed, 1 skipped, 0 failed**
   150	- grep gate proven to FAIL on a planted `'builder'` + `PERMISSIVE-STUB` probe, then green after removal
   151	  (non-tautology - and also self-proved in-suite)
   152	- repo-root `npm run gate:chokepoint` -> clean
   153	- `node --check` on both new `.e2e.mjs` drivers -> OK; `SUITE_LEDGER.json` re-validated as JSON
   154	
   155	## Codex-fix round (2026-07-14) - lead-applied
   156	
   157	Codex H5 review returned NEEDS-WORK (1 High + 1 Medium + 1 Low). The fresh review APPROVED. All three
   158	addressed:
   159	
   160	- **HIGH - the destructive-action-authz assertion documented-away a REAL gap.** Codex is right: the
   161	  general `/api/app-data` mutation plane authenticates NO caller (`scopeFor()` = X-Ekoa-App-Id +
   162	  owner-activation only), so anyone knowing an app id can write/delete that app's data cross-tenant;
   163	  app-id scoping alone is NOT authorization. The worker framed this as "documented boundary, not a
   164	  hole" - that framing was WRONG. RE-DISPOSED HONESTLY (not silently fixed, not falsely dismissed):
   165	  (1) docs/security.md now states it plainly as a KNOWN HIGH GAP with the precise threat + the two
   166	  compounding facts (collection write-mode unenforced; app-sso cookie not even sent to /api/app-data);
   167	  (2) a HIGH `served-app-data-unauthenticated-writes` entry in docs/findings.md; (3) a TRIPWIRE in
   168	  destructive-action-authz.test.ts pinning the current unauthenticated-write state (a future fix flips
   169	  it), with served-app.test.ts as the behavioral proof it currently 201s. RATIONALE for flag-not-fix:
   170	  this is PRE-EXISTING (C3/D-era served-app data plane) on a DIFFERENT axis from the platform
   171	  role/capability layer H1-H4 close (which IS complete); the proper fix (enforce the declared write
   172	  mode + make an app-sso session verifiable at the data path - cookie-path widening / session token)
   173	  is an architecture change across the ~200-app estate and an operator decision, not a bolt-on to the
   174	  assertion slice. It is now the TOP landing item, honestly surfaced - exactly what the assertion
   175	  layer is FOR (H5 finds gaps; the lead flags them for the operator).
   176	- **MEDIUM - weak wiring inventory.** The file-level `can(` + literal check stayed green if a route
   177	  silently lost its live gate (codex's example: whoami returning a constant while isAppEditor still
   178	  carries the literal). Fixed: (a) the whoami row now REQUIRES the route to actually call
   179	  `detectAppEditor(` and that `admin: await detectAppEditor(...)` is the response (a constant drops
   180	  those tokens); (b) each inventory row now names its AUTHORITATIVE behavioral suite and a new test
   181	  asserts those suites EXIST - the inventory is explicitly a structural smoke, the behavioral suites
   182	  (jobs-capability / artifacts-capability / the whoami matrix) are the real proof that would fail on
   183	  a broken gate.
   184	- **LOW - grep gate web coverage.** The orphan-`builder` scan covered only web/{app,components,stores};
   185	  web/lib, web/hooks, web/types, web/locales were unscanned (no live miss today - verified - but a
   186	  future orphan would evade). Fixed: the scan now covers ALL live web source roots.
   187	
   188	30/30 in tests/security + tests/auth/capabilities after the fix (grep gate re-proven non-tautological
   189	- it even caught a literal PERMISSIVE-STUB token in a doc comment I wrote, forcing a reword). No
   190	production auth code touched (the High is flagged, not fixed - an operator decision).

 succeeded in 0ms:
     1	# Security
     2	
     3	The binding security invariants, the anonymisation pipeline, the access-control model, and the
     4	incident-response + secure-development posture. Every invariant names its enforcement home.
     5	
     6	## The numbered invariants (ch09)
     7	
     8	Eleven carried invariants; each has a mechanical enforcement home (lint, grep gate, boot gate, or a
     9	named test suite).
    10	
    11	1. **No Anthropic access outside `llm/`.** Every Anthropic byte flows through `api/src/llm/`; no
    12	   model call exists in runtime platform paths. Enforced by ESLint `no-restricted-imports` +
    13	   the `api.anthropic.com`/`@anthropic-ai/` grep gate + the attribution-tag test gate.
    14	2. **Egress controls.** (a) Model-bound anonymisation before Anthropic (below); (b) client-bound
    15	   error sanitisation - `services/sanitizeOutbound` runs at exactly two egress points (the SSE event
    16	   serializer and the Express error middleware), replacing any provider-identifying or provider-auth
    17	   text wholesale. No provider identity ("Anthropic"/"Claude"/auth markers) ever reaches a user, on
    18	   SSE or REST. Test gate injects a provider-auth error and asserts neither leaks.
    19	3. **Single audit write path.** All audit logging flows through one `logActivity(user, category,
    20	   type, description, metadata?)` in `data/`; direct writes to the activity collection are grep-
    21	   banned. Writes are best-effort (a persistence failure is swallowed, never fails the domain action)
    22	   and carry `orgId` for the org-scoped Registo read surface.
    23	4. **Centrally managed model credentials.** One AES-encrypted `credentials` singleton per environment
    24	   (`_id: 'default'`), two auth modes as config (`oauth` / `api-key`), no per-user ad hoc keys, no
    25	   `~/.claude` fallback. The SDK subprocess env builder deletes any inherited provider env
    26	   (`SCRUBBED_PROVIDER_ENV`: `ANTHROPIC_API_KEY`/`ANTH_API_KEY`/`ANTHROPIC_BASE_URL`) and injects
    27	   exactly one credential + the chokepoint base URL. Grep gate: no provider-credential env name
    28	   appears outside the `api/src/llm/` custody code.
    29	5. **Org + user scoping on every data access; single multi-org process.** Scope resolution in `data/`
    30	   is the only query constructor and requires org + user context; an unscoped query is inexpressible
    31	   and routes never import `data/`. Ownership mismatch returns uniform not-found (never leaks
    32	   existence). Enforced by the cross-org adversarial suite and in-org sharing tests.
    33	6. **Credential encryption at rest; key mandatory; single crypto module.** One AES-256-GCM
    34	   implementation in `data/`; `ENCRYPTION_KEY` absent = refuse to boot in every environment; no
    35	   default key constant anywhere (grep gate).
    36	7. **Secret guard on code egress.** User-app code leaves through exactly three doors (version
    37	   snapshot commit, GitHub mirror push, download zip); each runs the secret scanner. A hit blocks:
    38	   `commit-blocked` audit row on snapshot, `422 SECRET_GUARD_BLOCKED` on download.
    39	8. **SSRF guard on platform fetches of user-supplied URLs** (brand research, knowledge crawl/seed,
    40	   uploaded links) via the guarded fetcher in `services/`. Scope boundary stated honestly: user-
    41	   defined integration actions call arbitrary user endpoints by design and are not SSRF-gated.
    42	9. **Webhook HMAC + dedup + audit.** Raw-body HMAC (verifier sees unmodified bytes - boot self-test),
    43	   disabled-check AFTER signature (410 signed / 401 unsigned), dedup on `UNIQUE(trigger_id,
    44	   dedup_key)` returning `{duplicate:true}`, and a `webhook_audit` row per outcome.
    45	10. **Sandbox path confinement.** Every user-derived filesystem path resolves through the symlink-
    46	    hardened `resolveWithinJail`/safe-path helper in `services/`, jailing it to the owner sandbox;
    47	    traversal/absolute/symlink fixtures all fail with uniform not-found. Covers artifact files AND the
    48	    automation `file.read`/`file.write` operations (P-15).
    49	11. **Production guard on default secrets.** JWT secret fails closed on default/unset in a
    50	    production-like environment; `ENCRYPTION_KEY` is stricter - mandatory everywhere.
    51	
    52	Fail-closed boot gates (`config.ts` boot): config secrets (fatal), App-SSO redirect URI (fatal),
    53	storage backend (fatal), Claude credential init (non-fatal - agent calls fail until healed), webhook
    54	raw-body self-test (non-fatal), port collision EADDRINUSE (fatal).
    55	
    56	## Tool-less anti-injection agents (§5.6.4)
    57	
    58	Agents whose only input is untrusted external/brand content run **tool-less** by design so a prompt-
    59	injection attempt has no tool to reach: `brand-research` and the served-app assistant produce
    60	proposals only. All model output and user content is untrusted input - nothing model-generated is
    61	interpolated into queries, shell commands, or privileged calls without validation; generated apps are
    62	static client bundles under a strict CSP with no server-side eval ever.
    63	
    64	## Anonymisation pipeline (ch17)
    65	
    66	The pipeline is a submodule of the chokepoint (`llm/anonymise/`), invoked by `llm/client.ts` after
    67	the payload is assembled and before any Anthropic request, and again on every response and streamed
    68	delta. Because the chokepoint is the only transport, a caller cannot skip it.
    69	
    70	Per request: **collect** all model-bound text; **detect** sensitive spans on the delta only (never
    71	the tokenized prefix - preserves prompt caching); **tokenize** each span into a deterministic,
    72	format-preserving fake recorded in the session vault; **forward** tagged with a per-request
    73	correlation id; **de-tokenize** the response, including `tool_use` argument blocks, streaming with
    74	straddle buffering.
    75	
    76	Detection layers, all behind one interface: (a) PT structured-ID recognizers (regex + checksum:
    77	NIF/NIPC/NISS/utente/CC/IBAN-PT/CITIUS) - near-certain; (b) the **per-org deny-list** (the firm's
    78	client/matter/party names, matched literally) - itself secret material, so it is AES-encrypted with
    79	an org-scoped key, access-logged, and never sent to Anthropic; (c) a recall-biased PT-PT NER head
    80	(in-process ONNX). Fail-closed: if (a) or (b) is unavailable the request is refused, not forwarded
    81	un-tokenized; (c) is best-effort and degrades without failing the request. Structured-ID fakes are
    82	minted with a **deliberately invalid checksum** so a fake can never collide with a real identifier.
    83	
    84	The vault (value->token map) is per-session, **in-memory, TTL, never persisted, cleared on session
    85	end** - a re-identification key that does not exist cannot be produced. It is keyed by the hosted
    86	conversation id so tokens stay consistent across delegated local turns. Audit is **metadata only**
    87	(entity classes, counts, correlation id, payload hash - never bodies, never the vault), async, hash-
    88	chained and tamper-evident, folded into the single Registo write path. The payload-capture harness
    89	asserts every planted synthetic value appears tokenized (never cleartext) in every captured outbound
    90	request while the user-visible response is cleartext. The Garrison line (FIXED-7): the mechanism is
    91	Ekoa core; the PT-PT ruleset and per-org deny-lists are loaded configuration, never core.
    92	
    93	## Access control model
    94	
    95	Deny by default: every `/api/v1` route passes auth middleware; pre-auth exemptions are exactly the
    96	`public` class, enforced by a route-census contract test. Authorization is deterministic code, never
    97	the model. Object-level ownership/org checks on every resource fetch, uniform 403/404. Three roles
    98	(`super-admin`/`org-admin`/`user`); privileged routes re-resolve the user from the store. Private
    99	items (memories, artifacts) are invisible to org admins - their existence appears in Registo
   100	metadata, never their content; sharing is explicit via `visibility`.
   101	
   102	**Capability layer (H1).** Authorization is a capability check composed with the ownership/org
   103	check, never a bare role string. The single seam `can(actor, capability)`
   104	(`api/src/auth/capabilities.ts`) is a pure role->capability map: `super-admin` and `org-admin` hold
   105	all four capabilities; a `user` holds `canUseChat` + `canCreateArtifacts` only (chat + non-app
   106	artifacts, never app build/edit); a null/undefined actor holds nothing (fail closed). It carries no
   107	org/resource context by design - tenancy + object ownership stay in the separate `loadReadable`/
   108	`loadWritable` and org-scoping checks, which the gates COMPOSE with `can()`.
   109	
   110	| capability | super-admin | org-admin | user |
   111	| --- | --- | --- | --- |
   112	| canBuildApps | yes | yes | no |
   113	| canEditApps | yes | yes | no |
   114	| canCreateArtifacts | yes | yes | yes |
   115	| canUseChat | yes | yes | yes |
   116	
   117	Four gates enforce it: `POST /jobs` first build requires `canBuildApps`; `POST /jobs` follow-up
   118	requires `canEditApps` AND a `loadWritable` ownership check on the target artifact; `POST
   119	/chat/runs` requires `canUseChat`; `POST /artifacts` requires `canCreateArtifacts`. A refusal is the
   120	shared FORBIDDEN envelope carrying `details.capability` (the machine-readable hook a request-to-admin
   121	flow consumes). The base role `builder` was renamed `user` (the persona is retired): an idempotent
   122	boot-step migration rewrites every legacy row and bumps its token epoch (invalidating outstanding
   123	`builder` JWTs), and a verify-boundary shim in `verifyToken` normalises any legacy `builder` JWT to
   124	`user` for the window between boot and re-login.
   125	
   126	**Follow-up-build ownership (IDOR fix, H1).** A follow-up build (`POST /jobs` with `artifactId`)
   127	resumes a code-writing agent inside the target app's owner sandbox. It is gated by `canEditApps` +
   128	`loadWritable(actor, artifactId)` (own always; org-shared within the org ok; another user's private
   129	-> 403; missing/cross-org -> 404) BEFORE any job is created or agent spawned - closing the prior gap
   130	where any authenticated user could drive an agent against ANY artifact by id. Credential planes are mutually
   131	non-interchangeable: platform session JWT (24 h / 30 d rememberMe), bridge token (600 s,
   132	`aud: ekoa-bridge`), app-SSO session (8 h HttpOnly cookie), gateway key (static, constant-compare).
   133	Deactivation is write-through (immediate) and bumps the token epoch, invalidating outstanding JWTs.
   134	
   135	**Served-app admission planes.** The per-app `/api/app-data` plane is unauthenticated app-global
   136	storage scoped only by `X-Ekoa-App-Id` (carried verbatim for byte-compatibility) - it must never hold
   137	confidential or per-user-private data. Anything private lives on a server-authenticated plane: the
   138	shared namespace (`/api/app-shared`, resolved owner + same-origin guard + `sharedData` opt-in) or
   139	behind the platform JWT / app-SSO session. This open posture is a documented decision, not an
   140	oversight.
   141	
   142	**Security-block assertion layer (H5).** The access-control invariants above are held by committed,
   143	re-runnable gates so they cannot silently regress:
   144	- *Capability matrix + gate wiring* (`api/tests/auth/capabilities.test.ts`): the full role x
   145	  capability grid (grants AND denials; a null/undefined/unknown-role actor holds nothing, fail
   146	  closed), plus a wiring inventory that ties every capability to the route `can(actor, '...')` call
   147	  site that enforces it - so a matrix that stays green while a route loses its gate fails the suite.
   148	  Behavior is driven end-to-end by `jobs-capability`/`artifacts-capability`.
   149	- *Grep gates* (`api/tests/security/grep-gates.test.ts`): a committed tree scan (mirroring
   150	  `gate:chokepoint`'s style, self-proving via an in-suite non-tautology test) that fails if the
   151	  retired `PERMISSIVE-STUB`/`PERMISSIVE_STUB` marker reappears in `api/src`/`shared/src`, or if a
   152	  quoted `builder` ROLE literal appears anywhere in `api/src`/`shared/src`/`web{app,components,stores}`
   153	  outside a small commented allowlist (the legacy-JWT shim, the migration query, and the web
   154	  SESSION-KIND `builder` - a session kind, not a role).
   155	- *Cross-org assistant-retrieval isolation* (`api/tests/security/assistant-cross-org-isolation.test.ts`):
   156	  over the real FTS grounding seam, the served-app assistant (`runAppAssistant`, which grounds under
   157	  the server-resolved `owner.orgId`) retrieves + cites ONLY the owner org's knowledge and can never
   158	  reach another org's - the org-B token never even enters an org-A app's prompt. Live evidence is
   159	  folded into the operator journey drivers + `fees-knowledge.e2e.mjs`.
   160	- *Destructive-action authorization, server-side* (`api/tests/security/destructive-action-authz.test.ts`):
   161	  the PRIVILEGED served-app end-user ops that carry an identity ARE authorized SERVER-SIDE by the
   162	  per-app SSO identity, not by any client confirmation (the Phase 4 confirm dialog is UX). The
   163	  canonical case - `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data) - is
   164	  rejected 401 WITHOUT a valid app-sso session and with a WRONG-APP session (`session.appId`
   165	  isolation via `findValidAppSession`), and proceeds only for the correct same-app session; the
   166	  visitor-acting `/api/app-sso/m365/*` proxy is gated the same way.
   167	
   168	  **KNOWN GAP (HIGH, pre-existing, requires an operator decision) - unauthenticated served-app data
   169	  mutations.** The GENERAL `/api/app-data/:collection` plane that a C3 submit/delete/write lands on
   170	  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
   171	  `X-Ekoa-App-Id` + the resolved app OWNER's activation (`admitOwner`), then scopes to that app's
   172	  data partition. So ANY caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data
   173	  across tenants - the "authorization dimension" Phase 10 requires for a destructive action is NOT
   174	  met for the primary served-app mutation surface. Two compounding facts: (1) the collection-rule
   175	  `access: { write: 'session' | 'server' }` level is DECLARED in the manifest schema but NOT enforced
   176	  by `served-data.ts` (the write mode is decorative); (2) the app-sso session cookie is
   177	  `Path=/api/app-sso`, so it is not even transmitted to `/api/app-data`, i.e. there is no session to
   178	  check at that path today. This is PRE-EXISTING (the C3/D-era served-app data plane; the operator-run
   179	  did not introduce it) and sits on a DIFFERENT axis from the platform role/capability layer H1-H4
   180	  close (which IS complete and correct). The proper fix - enforce the declared write mode and make an
   181	  app-sso session verifiable at the data path (cookie-path widening or a session token) - is an
   182	  architecture change to the served-app data plane spanning the ~200-app estate, and is an operator
   183	  decision, not a bolt-on to this assertion slice. H5 ASSERTS the current state honestly
   184	  (`destructive-action-authz.test.ts` pins the unauthenticated write as a KNOWN-GAP TRIPWIRE so a
   185	  future fix flips the test) and flags it as the top landing item; it does NOT claim the plane is safe
   186	  and does NOT silently redesign it. Tracked: `docs/findings.md`
   187	  `served-app-data-unauthenticated-writes`.
   188	
   189	**Frame headers (current state).** The api plane sets `X-Frame-Options: DENY` / `frame-ancestors
   190	'none'`. The served-app plane sets `frame-ancestors 'self'` + `SAMEORIGIN`. The `/apps` embed
   191	allowlist (so the cross-origin dashboard can iframe a served artifact) is **PENDING** - tracked as an
   192	open security task in `docs/findings.md`.
   193	
   194	## Incident response
   195	
   196	Solo-operator posture: the founder is incident commander. Detection sources, in order: **Registo**
   197	(append-only, single write path - agent actions, privileged data access, auth/admin ops), the
   198	anonymisation audit (hash-chained, metadata-only), the chokepoint meter (anomalous-burn / spend-cap
   199	trips), and boot-gate failures. Severity: S1 confirmed cross-org exposure / key compromise / PII
   200	egress past the anonymisation boundary; S2 single-org/user exposure or auth bypass without confirmed
   201	exploitation; S3 vulnerability without exposure. Containment (first hour): scope from Registo; cut
   202	access narrowly (deactivate account -> bump token epoch -> revoke bridge pairings -> rotate the
   203	secret in Secret Manager -> last resort stop the service); preserve the append-only evidence before
   204	any remediation. GDPR: personal-data breach to the supervisory authority within 72 h of awareness
   205	unless no risk; record the decision either way. Post-incident: write it up in `docs/decisions.md`,
   206	and every accepted root cause ships a deterministic guard in the same fix.
   207	
   208	## Secure development
   209	
   210	All change lands through the gated process (spec-first history preserved in git; see
   211	`docs/governance.md`). Structural enforcement is the lint + CI wall above. Input/output: boundary
   212	validation via the shared zod contract on every request (the contract is simultaneously input schema
   213	and injection defence); non-2xx bodies validate against the error envelope; no secrets/keys/org data
   214	in system prompts. CI security gates run on every lane: gitleaks (secrets), Semgrep (SAST),
   215	`npm audit` severity, the boundary/chokepoint grep gates, plus the named security suites - cross-org
   216	adversarial, in-org sharing, rate-limit/spend-cap, anonymisation payload-capture, and the bridge
   217	S1-S6 scenarios. The determinism ratchet: every accepted review or incident finding ships a
   218	deterministic guard (test, lint rule, Semgrep pattern, grep gate) in the same fix, so reviews trend
   219	toward judgment-only and regressions are machine-caught. Secrets live in a managed store only (GCP
   220	Secret Manager in prod; a bootstrap-generated key in dev); rotation is documented per secret.

exec
/bin/zsh -lc "nl -ba docs/findings.md | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	# Findings ledger
     2	
     3	The live findings ledger: OPEN first, then recently fixed, then accepted/by-design. A finding closes
     4	only by a landed fix + committed test, or a written dismissal. Replaces the release FINDINGS table and
     5	the RUN_LOG finding tail. Journey findings keep their `F` ids; later findings use readable slugs.
     6	
     7	## OPEN
     8	
     9	### Contract / schema drift (the schema-coverage honor-system class)
    10	
    11	- **`schema-coverage-honor-system`** (structural). The schema-coverage gate is a hand-maintained
    12	  allowlist that does NOT verify a test exercises each COVERED endpoint; a green gate is not proof a
    13	  body matches its schema. Audit 2026-07-10 found 27 of 154 COVERED keys unexercised and ~6 endpoint
    14	  groups returning schema-violating bodies. The three items below are instances. Real fix: a run-wide
    15	  registry of actually-exercised schemas (specified, unimplemented). Tracked: `docs/testing.md`.
    16	- **`llm-classify-contract`** (medium). `ekoaLocal.llmClassify` handler emits no `category` and reads
    17	  `req.body.prompt`, diverging from the contract input shape; a compliant client gets a schema-
    18	  violating response.
    19	- **`triggerView-active-drop`** (minor). `triggerView` drops the `active`/disabled field (optional
    20	  field silently omitted), so trigger state is invisible to a schema-strict client.
    21	- **`view-timestamps-drop`** (minor). `memoryView` and `artifactView` omit `createdAt`/`updatedAt`
    22	  (optional-drop).
    23	- **F14** (harness-gap, minor). The served-app owner bypass accepts both `Authorization: Bearer` and
    24	  `?token=`; the committed suite asserts only `?token=`. Untested accepted-auth surface.
    25	- **`artifact-cards-invalid-date`** (minor, UX). The expanded "Os Meus Artefactos" cards render
    26	  "Invalid Date" in the date row for every featured artifact (observed live 2026-07-12 on a fresh
    27	  dev stack, all 41 cards). Likely the card formats a missing/differently-shaped timestamp on
    28	  seeded featured artifacts (`createdAt`/`updatedAt` absent or non-ISO) straight through
    29	  `new Date(...)`. Fix: tolerate absent timestamps (hide the row) and add a regression assertion
    30	  that no card ever renders the literal "Invalid Date".
    31	- **`ai-integration-lands-under-platform-tab`** (minor, UX). An AI-built integration saved via the
    32	  chat builder (e.g. open-library, e2e-proof-weather, openweathermap) renders under
    33	  `/integrations?tab=plataforma` ("Integrações da Plataforma"), while "Minhas Integrações"
    34	  (`?tab=minhas`) shows the empty state - so a user who just built an integration and looks under
    35	  "Minhas Integrações" does not find it (confusing). It is available to the org (works), just filed
    36	  under the wrong tab for its provenance. Observed live 2026-07-11. Likely the "mine" filter keys on
    37	  a config/credential-instance concept rather than `userCreated` runtime definitions. Decide the
    38	  intended split and route userCreated runtime defs to the "mine" tab (or relabel the tabs).
    39	- **`integration-handoff-spurious-build`** (medium, UX). Confirming a chat integration offer (the
    40	  two-turn `[[EKOA_INTEGRATION_BUILD]]` handshake) reliably ALSO spawns a real app-build job that
    41	  runs the coding agent with an effectively-empty task and terminates `BUILD_UNFULFILLED` ("A
    42	  construção não chegou à aplicação servida"). Observed live 2026-07-11 for both rest-countries and
    43	  open-library: the integration panel opens and generates+saves correctly (proven — the integration
    44	  lands on `/integrations` with its actions), but the chat column shows a spurious failed build
    45	  alongside it. The build job carries a jobId (server-created) yet no `Vou ligar essa integração
    46	  primeiro.` message precedes it, so it is NOT the build-path in-build classifier; and the client
    47	  `isBuildSession` gate is false on a fresh chat session, so the client message router did not kick
    48	  it — the spurious `build_intent` originates in the server marker orchestration when the
    49	  confirmation turn is classified. Not blocking (the integration still saves) but pollutes the
    50	  handoff. Close by tracing the turn-2 emission: the chat run must emit ONLY the integration signal
    51	  (or, if it emits both, integration must win over build in `agents/chat.ts` — currently build is
    52	  checked first). Add a deterministic test asserting one signal per confirmation turn.
    53	
    54	- **`served-app-data-unauthenticated-writes`** (HIGH, pre-existing, operator decision - surfaced by
    55	  H5's destructive-action-authz assertion). The served-app data plane `/api/app-data/:collection`
    56	  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
    57	  `X-Ekoa-App-Id` header + the app OWNER's activation, then scopes to that app's partition. So ANY
    58	  caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data ACROSS TENANTS (a private
    59	  org app's data can be tampered/deleted by an outsider who learns its id). Two compounding facts:
    60	  (1) the manifest collection-rule `access:{ write:'session'|'server' }` is DECLARED but NOT enforced
    61	  by served-data.ts (the write mode is decorative); (2) the app-sso session cookie is
    62	  `Path=/api/app-sso`, so it is not even sent to `/api/app-data` - there is no session to check at
    63	  that path today. NOT introduced by the operator-run (C3/D-era served-app data plane); on a
    64	  DIFFERENT axis from the platform role/capability layer H1-H4 close (which is complete). Phase 10's
    65	  "destructive-action authorization asserted server-side" is NOT met for this surface. FIX (an
    66	  operator architecture decision, a dedicated post-H slice): enforce the declared collection write
    67	  mode and make an app-sso session verifiable at the data path (widen the app-sso cookie path or mint
    68	  a session token the data plane checks); `write:'server'` collections should reject ALL client
    69	  mutations. Pinned as a TRIPWIRE in `api/tests/security/destructive-action-authz.test.ts` (a fix
    70	  flips the test) + behaviorally green today in `api/tests/contract/served-app.test.ts`. Tracked in
    71	  `docs/security.md`.
    72	
    73	### Gateway / egress
    74	
    75	- **`gateway-502-masks-401`** - CLOSED (local-bridge consumer run s7, 2026-07-11, merged from the
    76	  parallel session): typed `CredentialError` -> 503 `credential_error` (non-retryable), rate-cap ->
    77	  429, transient stays 502; `/health claudeAuth.lastProviderError` carries class+timestamp only;
    78	  gateway metadata is an allowlist (`user_id` only), killing the sibling mask.
    79	- **`health-bridgeConnections-mismatch`** (small, merged from the parallel session's recon). `/health
    80	  bridgeConnections` reports `sseManager.connectionCount` (SSE clients), not the bridge registry's
    81	  daemon-socket count the field name promises. One-line fix in server.ts /health + a health contract
    82	  assertion.
    83	- **`e2e-estate-no-committed-env`** (open, structural; merged - extends `e2e-estate-baseline-13`
    84	  below). 49 of 213 due specs red when the WHOLE ledger estate runs against the run-driver stack
    85	  (the served-app compat `/api/v1/action` suites 404 at every commit; demo tours exceed the 30s
    86	  timeout on dev-next latency). Needs a committed full-stack e2e harness + a compat-suite triage.
    87	- **`gateway-apikey-checkAllowance`** (medium, security). The gateway `apikey` principal skips
    88	  `checkAllowance` and bills the platform admin account - an exfil surface reachable from a build
    89	  subprocess. Operator decision owed on the sanctioned posture.
    90	- **F8** (judgment, minor). Provider/credential error surfaces are not user-grade: chat can stream an
    91	  English spec citation, the adapter can leak raw provider JSON, and build failure is a generic PT
    92	  sentence with no cause. Needs one error-mapping layer at the streaming sink (PT message + machine
    93	  code, detail in logs).
    94	
    95	### Product bugs
    96	
    97	- **`restoreVersion-featured-500`** (medium). `restoreVersion` on a *featured* artifact still 500s.
    98	  (The broader versions-500 - never-built artifacts and the featured list - was fixed 2026-07-11; this
    99	  case remains.)
   100	- **`web-sourceinput-divergence`** (medium). A web/`shared` `SourceInput` divergence makes a seed-
   101	  template knowledge source 400 from the UI.
   102	- **`login-double-session`** (minor, dev-only). The login landing double-creates sessions (React
   103	  StrictMode double-mount of the eager empty-session create); dev-DB orphan-row noise, and the /chat
   104	  landing intermittently GETs a just-created session id that 404s (the e2e trackers carry a scoped
   105	  exclusion for exactly that 404 pattern - remove it when this closes). The write should be
   106	  idempotent/effect-guarded.
   107	- **`chat-sse-discovery`** (deferred, batch-2). S1 adversarial-tester discovery set: chat-SSE late-
   108	  subscriber gap, run hangs on upstream auth failure, temp-session 404 persist.
   109	- **`web-tests-untypechecked`** (low, batch-2). Web `__tests__` are excluded from tsc, so web test
   110	  files are never typechecked.
   111	- **`e2e-estate-baseline-13`** (medium, per-spec debt). The first honest full-stack estate run
   112	  (2026-07-11, 187/200 green after this run's fixes) leaves 13 red ported specs, ALL pre-existing
   113	  product/UI gaps (none touch this run's diffs): (a) the documented band2 legacy group still built
   114	  around the retired `/api/v1/action` + old stubs - artifact-backend-panel, artifacts-apps-section,
   115	  update-from-bundle, vertical-profile, onboarding x3 (REST migration owed; see
   116	  docs/e2e-harness-remediation-brief.md); (b) integrations UI gaps - pages-manage expects a search
   117	  input the migrated page lost, integrations-sections' Webhooks tab renders no webhook rows,
   118	  integrations-pipedream master-toggle default/persistence semantics differ; (c) legal-content
   119	  gaps - legal-rcbe journey, legal-shared-drift (six scaffolds vs canonical layer), simuladores-
   120	  trabalho exact CT figures. Each is closed by building the missing surface or by an explicit
   121	  retire decision - never by editing the ported spec.
   122	
   123	- **`branding-tab-stale-after-research`** (minor, UI freshness). Right after a brand research
   124	  completes, the Marca tab can render the PREVIOUS palette (local component state seeded at page
   125	  load) while `org.branding` already holds the new one - a fresh reload shows the correct values.
   126	  Observed live 2026-07-11 during the walkthrough recording (post-research tab showed `#1A2D5A`,
   127	  persisted+reload truth was `#1C2B4A`). Likely the local-state sync effect on
   128	  `settings/branding/page.tsx` not re-seeding after `fetchCompany()`. Close with a deterministic
   129	  test that researches (fake transport), switches to the Marca tab and asserts the fresh hex.
   130	
   131	- **`collection-rule-access-unenforced`** (medium, data-plane; H5 assertion-layer surfaced). A
   132	  collection rule's `access:{write:'session'|'server'}` is DECLARED in the app manifest schema but
   133	  NOT enforced by served-data.ts - all app-data writes are app-id-scoped (owner-activation
   134	  admission), so the per-collection write mode is decorative. Pre-existing C3/data-plane concern,
   135	  OUTSIDE the H security block (which gates the PLATFORM authz; the served-data plane is a separate,
   136	  documented app-id-scoped design). Close by enforcing the declared write mode in served-data.ts OR
   137	  by removing the unenforced field from the manifest schema. Flagged by H5's destructive-action-authz
   138	  assertion (the privileged app-sso ops ARE gated + asserted; this is the general data plane).
   139	
   140	### Operator-blocked / external
   141	
   142	- **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
   143	  on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
   144	  (`docs/operations-runbook.md`).
   145	- **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
   146	  commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
   147	  is already at `af8b556`).
   148	
   149	## Recently fixed - 2026-07-13 preview probe CORS duplicate header (operator)
   150	
   151	- **`F-2026-07-13-proxy-duplicate-acao`** (operator-reported, 2026-07-13) - in dev, the preview
   152	  probe's `HEAD /apps/<slug>/` from the dashboard origin failed CORS on EVERY request:
   153	  `The 'Access-Control-Allow-Origin' header contains multiple values '*, http://localhost:3000'`
   154	  (`net::ERR_FAILED` despite a 200), so `probePreviewDocument` classified every served app as
   155	  `transient` and the panel's probe-gated first render churned through its retry budget. Root
   156	  cause: both dev CORS proxies (`.claude/skills/run-ekoa-code/driver.mjs` and its verbatim copy in
   157	  `api/tests/journeys/boot-b.mjs`) merged response headers with
   158	  `{ ...proxyRes.headers, ...corsHeaders(req) }` - Node lowercases upstream header names while
   159	  `corsHeaders()` uses mixed case, so on planes where the api sets its OWN CORS header
   160	  (`/apps/*` and design tokens send `Access-Control-Allow-Origin: *` - `serving.ts`,
   161	  `design-tokens.ts`) the spread kept BOTH keys and the wire carried two ACAO values, which
   162	  browsers reject outright. Dev-only (prod is same-origin, no proxy). Fixed in both files:
   163	  upstream-wins per-header merge (`mergeResponseHeaders`) - the proxy only injects the CORS
   164	  headers upstream did not already set, so `/apps/*` answers a single `ACAO: *` exactly as
   165	  `web/lib/preview-probe.ts` documents, and `/api/*` keeps the reflected-origin set. Verified
   166	  live through a restarted boot-b stack: `/apps/legal-agenda-reservas/` ACAO count 1 (`*`),
   167	  `/health` reflected origin single-valued, OPTIONS preflight unchanged.
   168	
   169	## Recently fixed - 2026-07-12 preview "proxy error" (operator)
   170	
   171	- **`F-2026-07-12-preview-502`** (operator-reported, 2026-07-12) - during a build, the side-panel
   172	  preview iframe displayed a raw `proxy error` body and stayed there (screenshot: 502 on the
   173	  `/apps/<id>/?token=` document request while adjacent `/api/v1/billing/usage` calls returned 200).
   174	  Two stacked defects:
   175	  1. **Dev-harness proxy transient** (root cause of THIS 502): the run-ekoa-code driver's CORS
   176	     reverse proxy (`.claude/skills/run-ekoa-code/driver.mjs`) forwarded upstream requests over the
   177	     Node 20 global agent (keep-alive pooled, server closes idles at its default 5s
   178	     `keepAliveTimeout`) and answered ANY pre-response upstream socket error with a bare 502
   179	     `proxy error` - silently (no log), so the exact errno of the operator's occurrence (2 of 265
   180	     requests) is unrecoverable. Fixed: fresh upstream connection per request
   181	     (`http.Agent({ keepAlive: false })` - loopback, sub-ms), one replay for bodyless idempotent
   182	     methods (GET/HEAD) failing before a response, upstream errors logged with method/path/errno,
   183	     and a mid-stream failure destroys the response instead of appending garbage. Forensics note:
   184	     the classic close-vs-reuse race would NOT reproduce in 365 timed attempts against Node 20
   185	     (agent honors the server's Keep-Alive hint), so the residual trigger class is broader than
   186	     that race - the fix covers the class, and the new logging captures any recurrence.
   187	  2. **Preview panel could not recover** (product gap, any 5xx source incl. a prod edge blip): an
   188	     iframe NEVER fires its error event for an HTTP error response - it renders the error body and
   189	     fires `load` - so `side-panel.tsx`'s retry machinery never engaged and the raw body stuck
   190	     until a manual refresh. Fixed: `web/lib/preview-probe.ts` classifies the document plane via a
   191	     HEAD probe (`ok` 2xx / `transient` network+5xx / `hard` other); the panel now gates the first
   192	     iframe render on the probe (polls at the existing 500ms/30s bounds), re-probes on every iframe
   193	     `load`, routes `transient` into the existing bounded retry, restores the retry budget on a
   194	     verified-ok load, and renders `hard` pages (410 revoked) as-is. Manual refresh polling unified
   195	     on the same classification (and now probes the tokened URL the iframe actually loads).
   196	  Accepted residual: a blip that hits ONLY the iframe's GET while the adjacent HEAD probes pass is
   197	  undetectable cross-origin without a new parent<->iframe liveness protocol on the byte-compat
   198	  injection plane (the demo bridge stays dormant until `demo.init` by design) - disproportionate;
   199	  revisit only if it recurs behind the fixed proxy/edge. Tests:
   200	  `web/__tests__/lib/preview-probe.test.ts` (classification),
   201	  `web/__tests__/components/side-panel-preview-recovery.test.tsx` (wiring: probe-gated first
   202	  render, 410 renders as-is, on-load transient -> retry -> recovery); both fail against the
   203	  pre-fix behavior. Live-verified 2026-07-12: stack restarted on the fixed driver, real-UI login,
   204	  /artifacts + served `legal-nucleo` render through the proxy, 16/16 doc-plane requests across
   205	  5s keep-alive boundaries clean.
   206	
   207	## Recently fixed - 2026-07-12 brand research colors (operator round 3)
   208	
   209	- **`brand-colors-fake-teal`** (operator-reported, 2026-07-12) - research on
   210	  mariliasantoscabral.webnode.pt showed primary `#0d9488` (teal-600, the OLD platform default) on a
   211	  navy/white site with no teal anywhere. Root-cause forensics (live DB + job records + a live
   212	  extraction probe) proved the teal never existed in the pipeline, the model output, or the org
   213	  record: it was the branding page's HARDCODED display fallbacks (`#0d9488`/`#1e293b`) rendered
   214	  whenever `org.branding` lacked colors - indistinguishable from a research result, and
   215	  `handleSaveBranding` would persist them verbatim on Guardar. Fixed: unset colors are `null` state
   216	  end-to-end (explicit "Não definida" swatch/placeholder, neutral preview placeholders), Save OMITS
   217	  unset colors, and the exact pair appears nowhere. Tests: `web/e2e/branding-colors.spec.ts`.
   218	- **`brand-research-silent-no-color`** (same run) - the research flow structurally could not produce
   219	  a color for this site yet reported success: the grounded snapshot contained ONLY grayscale hexes,
   220	  the model complied, `sanitizeBrandColors` nulled them, the patch dropped the nulls, and the job
   221	  completed `brandingApplied:true` with no signal (the old cortex NO_PRIMARY_COLOR fail-loud guard
   222	  was never ported - color-filter.ts's own comment referenced a "no usable primary guard" that did
   223	  not exist). Fixed as partial-apply-with-warning: the job result + complete event + `jobView` carry
   224	  `colorsApplied` and `warnings: [NO_PRIMARY_COLOR]`; the web shows an amber "defina-as manualmente"
   225	  banner/toast instead of green success. Tests: `api/tests/contract/branding.test.ts` (fail-loud
   226	  monochrome case), shared `Job` schema extended.
   227	- **`brand-colors-image-only-blind`** (same run, the actual extraction gap) - the firm's navy lives
   228	  ONLY as pixels in the hero JPEG; the rendered walker samples computed styles, so `paintedHexes`
   229	  came back empty, the Webnode builder scrub then intersected the CSS candidates against that empty
   230	  set and wiped all 8, leaving the model four grayscale hexes. Fixed with a screenshot-PIXEL
   231	  quantization fallback in `rendered-candidates.ts` (fires only when nothing non-neutral paints;
   232	  in-page canvas quantization of the Playwright screenshot - a data: image, so no cross-origin
   233	  taint), surfaced as an explicitly low-confidence "Cores amostradas dos píxeis" prompt section with
   234	  a neutral-ban rule, deliberately exempt from the brandFit floor (the desaturated navy ~0.26 is the
   235	  point). Live-verified against the real site: research now persists primary `#374559` (the actual
   236	  hero navy) and no neutrals. Tests: `api/tests/services/branding/rendered-candidates.test.ts`
   237	  (`screenshotClustersToCandidates`), `snapshot.test.ts` (pixel section + rules).
   238	- **`brand-colors-no-membership-guard`** (found during the fix, latent in old cortex too) - the
   239	  "every returned hex must appear literally in a candidate list" rule was prompt-only; a
   240	  hallucinated saturated color would have merged unchecked. Fixed: `collectAllowedHexes` gathers the
   241	  snapshot evidence and the apply-step NULLS any returned color outside it (grounded path only).
   242	  Tests: `api/tests/contract/branding.test.ts` (out-of-snapshot teal dropped),
   243	  `snapshot.test.ts` (`collectAllowedHexes`).
   244	- **`sanitize-accent-gap`** (same run) - `sanitizeBrandColors` never checked `accentColor`, so gray
   245	  `#9d9d9d` persisted as the org accent; and the promotion swap PARKED the demoted gray in the
   246	  accent slot. Fixed: a grayscale accent is nulled last (no slot ever persists a neutral). Tests:
   247	  `api/tests/services/branding/color-filter.test.ts`.
   248	- **`branding-save-wholesale-wipe`** (found during the fix) - `saveBrandingHandler` passed the
   249	  client's 4-field branding object straight to `updateOrg`, which replaces top-level keys wholesale:
   250	  every dashboard Guardar silently WIPED `designSystem`/`visualVibe`/researched fields. Fixed: the
   251	  handler merges onto existing branding (same semantics as the research apply-step). Test:
   252	  `api/tests/contract/branding.test.ts` (save-merge case).
   253	- **`accent-picker-secondary-binding`** (same run) - the "Cor de Destaque" picker was bound to
   254	  `secondaryColor`, so the persisted `accentColor` was never displayed and Save wrote the fallback
   255	  slate into `secondaryColor` under an accent label. Fixed: the accent picker binds `accentColor`.
   256	  Test: `web/e2e/branding-colors.spec.ts` (accent stays unset when only primary is saved).
   257	- **`branding-page-stale-until-reload`** (operator-reported, 2026-07-12 follow-up: "had to refresh
   258	  to see the changes on the brand area") - the branding page re-syncs its local editor state only
   259	  when the `${company.id}_${company.updatedAt}` fingerprint changes, but `orgView` never returned
   260	  `updatedAt` and nothing stamped it, so the fingerprint NEVER changed after mount: the

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'git show --unified=80 1515c2e -- api/tests/auth/capabilities.test.ts api/tests/security/grep-gates.test.ts api/tests/security/destructive-action-authz.test.ts docs/security.md docs/findings.md docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-MHIrIYvT' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-KvrWqimX' (errno=Operation not permitted)
commit 1515c2e1fbb3d2cb8cd3e506d1036d03fde8960a
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Tue Jul 14 01:20:41 2026 +0100

    fix(operator-run/h5): codex findings - (HIGH) reframe the served-app /api/app-data unauthenticated-write gap HONESTLY: it is a real pre-existing HIGH gap (any caller knowing an app id can write/delete that app's data cross-tenant; collection write-mode unenforced; app-sso cookie not sent to the data path), NOT a 'documented boundary' - docs/security.md reworded, HIGH findings entry, a TRIPWIRE pinning the current state, flagged as the top operator decision (not silently fixed - it is an architecture change across the app estate, a separate axis from the complete H1-H4 platform layer); (MED) wiring inventory now requires the whoami route to actually call detectAppEditor + names the authoritative behavioral suites (structural check is only a smoke); (LOW) grep gate scans ALL live web source roots. 30/30 security+capabilities; live journeys both PASS

diff --git a/api/tests/auth/capabilities.test.ts b/api/tests/auth/capabilities.test.ts
index c50b73d..1957566 100644
--- a/api/tests/auth/capabilities.test.ts
+++ b/api/tests/auth/capabilities.test.ts
@@ -1,128 +1,153 @@
 /**
  * The real capability matrix (operator-run H1). REPLACES the S0 permissive-stub test: `can()` now
  * enforces the brief §9a role→capability grid, not a blanket `true`. The H5 security assertions
  * grep the source (api/src/auth/capabilities.ts) for the retired stub marker and fail if it
  * survives; this suite pins the behavior that replaced it.
  */
 import { describe, it, expect } from 'vitest';
-import { readFileSync } from 'node:fs';
+import { readFileSync, existsSync } from 'node:fs';
 import { fileURLToPath } from 'node:url';
 import { dirname, resolve } from 'node:path';
 import { Capability } from '@ekoa/shared';
 import { can } from '../../src/auth/capabilities.js';
 
 const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/auth
 const API_SRC = resolve(HERE, '../../src'); // <root>/api/src
+const TESTS_ROOT = resolve(HERE, '..'); // <root>/api/tests
 const readSrc = (rel: string) => readFileSync(resolve(API_SRC, rel), 'utf8');
 
 // The authoritative grid. Every (role x capability) cell is asserted below - both the grants and
 // the denials - so a future edit to the matrix cannot silently widen a role.
 const EXPECTED: Record<'super-admin' | 'org-admin' | 'user', Record<Capability, boolean>> = {
   'super-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
   'org-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
   user: { canBuildApps: false, canEditApps: false, canCreateArtifacts: true, canUseChat: true },
 };
 
 describe('can() capability matrix (H1)', () => {
   it('every role x capability cell matches the brief grid (all 12 cells)', () => {
     for (const role of Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>) {
       for (const capability of Capability.options) {
         expect(can({ role }, capability), `${role} / ${capability}`).toBe(EXPECTED[role][capability]);
       }
     }
   });
 
   it('a user holds exactly canUseChat + canCreateArtifacts - never the app build/edit capabilities', () => {
     expect(can({ role: 'user' }, 'canUseChat')).toBe(true);
     expect(can({ role: 'user' }, 'canCreateArtifacts')).toBe(true);
     expect(can({ role: 'user' }, 'canBuildApps')).toBe(false);
     expect(can({ role: 'user' }, 'canEditApps')).toBe(false);
   });
 
   it('admins (org-admin + super-admin) hold every capability', () => {
     for (const role of ['org-admin', 'super-admin'] as const) {
       for (const capability of Capability.options) {
         expect(can({ role }, capability), `${role} / ${capability}`).toBe(true);
       }
     }
   });
 
   it('a null/undefined actor holds NOTHING (fail closed)', () => {
     for (const capability of Capability.options) {
       expect(can(null, capability), `null / ${capability}`).toBe(false);
       expect(can(undefined, capability), `undefined / ${capability}`).toBe(false);
     }
   });
 
   it('an unknown/stale role holds NOTHING (fail closed) - a signature-valid token carrying a dead role value grants nothing', () => {
     // The `?? false` defensive branch in can(): a role not in the CAPABILITIES map (the retired
     // `builder` value that somehow bypassed the verifyToken shim, or any garbage) is refused every
     // capability. This is the security posture the H1 map §7 called out - capability must never
     // default to "more" for an unrecognised role.
     for (const capability of Capability.options) {
       expect(can({ role: 'builder' as never }, capability), `stale-builder / ${capability}`).toBe(false);
       expect(can({ role: 'root' as never }, capability), `garbage-root / ${capability}`).toBe(false);
       expect(can({ role: '' as never }, capability), `empty-role / ${capability}`).toBe(false);
     }
   });
 
   it('the capability vocabulary is the brief-designed set (unchanged by H1)', () => {
     expect(Capability.options).toEqual(['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat']);
   });
 });
 
 /**
  * H5 gate-wiring assertion - the matrix ABOVE is the pure decision; this block proves each cell is
  * actually ENFORCED at the routes that mint/mutate the gated resource, so the matrix cannot drift
  * away from its enforcement points. It ties every capability to at least one wired `can(actor, '…')`
  * call site, cross-referencing (NOT duplicating) the two integration suites that drive the behavior
  * end-to-end over the real routers:
  *   - api/tests/contract/jobs-capability.test.ts - POST /jobs first-build (canBuildApps) + follow-up
  *     (canEditApps + writability/IDOR); a `user` refused, an org-admin proceeds, executor never
  *     called on a refusal.
  *   - api/tests/contract/artifacts-capability.test.ts - the in-place app-edit vectors (canEditApps
  *     via denyAppEdit), import + fork-of-app (canBuildApps), and a `user` keeping non-app
  *     create/fork (canCreateArtifacts).
  * Here we assert the WIRING inventory (the source has the gate) so a future edit that silently drops
  * a gate - leaving the matrix green but the route ungated - fails this suite.
  */
 describe('capability gate wiring (H5) - the matrix is enforced at the routes', () => {
   // capability -> the source file that must carry an enforcing `can(actor, '<capability>')` gate,
-  // with the vector it guards. A capability may be enforced in more than one file (e.g. canEditApps
-  // gates both the follow-up build and every in-place app-edit vector); each row is checked.
-  const WIRING: Array<{ capability: Capability; file: string; vector: string }> = [
-    { capability: 'canBuildApps', file: 'routes/jobs.ts', vector: 'first build (POST /jobs, no artifactId)' },
-    { capability: 'canEditApps', file: 'routes/jobs.ts', vector: 'follow-up build (POST /jobs, artifactId)' },
-    { capability: 'canUseChat', file: 'routes/chat.ts', vector: 'chat run (POST /chat/runs)' },
-    { capability: 'canCreateArtifacts', file: 'routes/artifacts.ts', vector: 'artifact create (POST /artifacts)' },
-    { capability: 'canEditApps', file: 'routes/artifacts.ts', vector: 'in-place app-edit vectors (denyAppEdit)' },
-    { capability: 'canBuildApps', file: 'routes/artifacts.ts', vector: 'import + fork-of-app' },
-    { capability: 'canEditApps', file: 'apps/app-assistant-route.ts', vector: 'served-app admin detection (whoami / isAppEditor)' },
+  // with the vector it guards, AND the BEHAVIORAL suite that would fail if the gate stopped being
+  // reached at runtime. This structural inventory is a SMOKE (a route file that still contains the
+  // can() literal keeps this green even if a handler stopped CALLING it - codex-h5 Medium); the
+  // named behavioral suites are the AUTHORITATIVE proof: they drive the real route end to end, so a
+  // handler that returned a constant / dropped its gate FAILS there. Each row lists both so a broken
+  // gate is caught behaviorally, not merely asserted structurally.
+  const WIRING: Array<{ capability: Capability; file: string; vector: string; behavioral: string }> = [
+    { capability: 'canBuildApps', file: 'routes/jobs.ts', vector: 'first build (POST /jobs, no artifactId)', behavioral: 'tests/contract/jobs-capability.test.ts (user 403, admin 202)' },
+    { capability: 'canEditApps', file: 'routes/jobs.ts', vector: 'follow-up build (POST /jobs, artifactId)', behavioral: 'tests/contract/jobs-capability.test.ts (follow-up 403/404)' },
+    { capability: 'canUseChat', file: 'routes/chat.ts', vector: 'chat run (POST /chat/runs)', behavioral: 'tests/contract/jobs-capability.test.ts + chat suites' },
+    { capability: 'canCreateArtifacts', file: 'routes/artifacts.ts', vector: 'artifact create (POST /artifacts)', behavioral: 'tests/contract/artifacts-capability.test.ts' },
+    { capability: 'canEditApps', file: 'routes/artifacts.ts', vector: 'in-place app-edit vectors (denyAppEdit)', behavioral: 'tests/contract/artifacts-capability.test.ts (bundle-update/file/restore/backend 403)' },
+    { capability: 'canBuildApps', file: 'routes/artifacts.ts', vector: 'import + fork-of-app', behavioral: 'tests/contract/artifacts-capability.test.ts (import/fork 403)' },
+    { capability: 'canEditApps', file: 'apps/app-assistant-route.ts', vector: 'served-app admin detection (whoami)', behavioral: 'tests/apps/app-assistant.test.ts (whoami fail-closed matrix over the real route)' },
   ];
 
   it.each(WIRING)('$capability is wired at $file - $vector', ({ capability, file }) => {
     const src = readSrc(file);
     // A real gate is a `can(` call whose argument list carries the capability literal. The fork
     // vector passes the capability through a `forkCap` variable, but the literal is defined
     // adjacent on the same statement, so the file-scoped literal-near-can() assertion still holds.
     expect(src.includes('can('), `${file} must call can()`).toBe(true);
     expect(src.includes(`'${capability}'`), `${file} must reference the ${capability} capability literal`).toBe(true);
     // Tie them together: a `can(...)` call referencing this capability literal (allowing the
     // forkCap indirection in artifacts.ts, where the literal sits on the ternary feeding can()).
     const wiredDirectly = new RegExp(`can\\([^;]*'${capability}'`).test(src);
     const wiredViaForkCap =
       file === 'routes/artifacts.ts' && /forkCap\s*=\s*isAppArtifact[^;]*'canBuildApps'[^;]*'canCreateArtifacts'/.test(src) && /can\([^;]*forkCap/.test(src);
     expect(wiredDirectly || wiredViaForkCap, `${file}: no can(actor, '${capability}') gate found`).toBe(true);
+    // The whoami row's structural check is the WEAKEST (the can() literal lives in the isAppEditor
+    // helper, so the file stays green even if the handler stopped calling it - codex-h5 Medium).
+    // Tighten it: the whoami HANDLER must actually invoke detectAppEditor (the code path that reaches
+    // the gate); a handler returning a constant would drop this token. The behavioral whoami matrix
+    // (tests/apps/app-assistant.test.ts) is the authoritative catch either way.
+    if (file === 'apps/app-assistant-route.ts') {
+      expect(/detectAppEditor\(/.test(src), 'whoami must call detectAppEditor (the gate path), not return a constant').toBe(true);
+      expect(/admin:\s*await\s+detectAppEditor\(/.test(src), 'the whoami response `admin` must be the detectAppEditor result').toBe(true);
+    }
+  });
+
+  it('every wired capability has a named AUTHORITATIVE behavioral suite (structural inventory is only a smoke)', () => {
+    // codex-h5 Medium: the structural inventory can go stale-green; each row must point at a suite
+    // that drives the real route and would fail on a broken gate. Assert the referenced suite files
+    // exist so the pointer never rots.
+    for (const w of WIRING) {
+      expect(w.behavioral, `${w.capability}@${w.file} must name a behavioral suite`).toBeTruthy();
+      const suiteFile = w.behavioral.split(' ')[0]!; // the leading path token (api/tests-relative, e.g. tests/contract/...)
+      expect(existsSync(resolve(TESTS_ROOT, '..', suiteFile)), `behavioral suite ${suiteFile} must exist`).toBe(true);
+    }
   });
 
   it('the two admin-only capabilities (a user is denied) are each enforced by a wired gate', () => {
     // The matrix denies a `user` canBuildApps + canEditApps; both MUST have at least one enforcing
     // gate, else the denial is unenforceable. (canUseChat + canCreateArtifacts are user-held; their
     // gates refuse only a null/no-capability actor.)
     for (const cap of ['canBuildApps', 'canEditApps'] as const) {
       const enforced = WIRING.some((w) => w.capability === cap);
       expect(enforced, `${cap} (admin-only) must be enforced somewhere`).toBe(true);
       expect(can({ role: 'user' }, cap), `matrix: a user is denied ${cap}`).toBe(false);
     }
   });
 });
diff --git a/api/tests/security/destructive-action-authz.test.ts b/api/tests/security/destructive-action-authz.test.ts
index 718c784..89ed103 100644
--- a/api/tests/security/destructive-action-authz.test.ts
+++ b/api/tests/security/destructive-action-authz.test.ts
@@ -1,143 +1,176 @@
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
+import { readFileSync } from 'node:fs';
+import { fileURLToPath } from 'node:url';
+import { dirname, resolve } from 'node:path';
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
 
+describe('KNOWN GAP (codex-h5 High): the GENERAL /api/app-data mutation plane authenticates NO caller', () => {
+  // This is a TRIPWIRE, not a proof of safety. The served-app data plane (served-data.ts) lets ANY
+  // caller who knows an app id POST/PUT/DELETE that app's data - `scopeFor()` checks only the
+  // X-Ekoa-App-Id header + the app OWNER's activation (admitOwner), never the CALLER. Phase 10's
+  // "destructive-action authorization asserted server-side" is therefore NOT met for this surface.
+  // It is PRE-EXISTING and an architecture-level operator decision (see docs/security.md + findings).
+  // We PIN the current state so a future fix (a caller/session check on the data-plane writes) FLIPS
+  // this test and forces docs/findings/this-assertion to be updated - the gap can never be quietly
+  // "fixed" or quietly regress unnoticed. served-app.test.ts additionally proves BEHAVIORALLY that an
+  // unauthenticated /api/app-data POST currently returns 201.
+  const servedDataSrc = readFileSync(
+    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/apps/served-data.ts'),
+    'utf8',
+  );
+
+  it('the data-plane write routes exist and are scoped ONLY by scopeFor (no caller auth) - CLOSING THIS FLIPS THE TRIPWIRE', () => {
+    expect(/r\.post\(`\$\{prefix\}\/:collection`/.test(servedDataSrc)).toBe(true);
+    expect(/r\.put\(`\$\{prefix\}\/:collection\/:id`/.test(servedDataSrc)).toBe(true);
+    expect(/r\.delete\(`\$\{prefix\}\/:collection\/:id`/.test(servedDataSrc)).toBe(true);
+    // The writes gate ONLY through scopeFor, which today performs NO caller-session / app-sso check.
+    // If session/caller auth is ever added to the data-plane writes (the fix), one of these tokens
+    // appears and this fails ON PURPOSE - update the KNOWN GAP (docs/security.md + findings.md) and
+    // rewrite this suite to assert the new server-side authorization.
+    expect(
+      /findValidAppSession|requireAppSession|ekoa_app_sso/i.test(servedDataSrc),
+      'served-data.ts now references an app-sso session on the data plane - the KNOWN GAP may be closed; update docs/findings + this tripwire',
+    ).toBe(false);
+  });
+});
+
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
diff --git a/api/tests/security/grep-gates.test.ts b/api/tests/security/grep-gates.test.ts
index c0b1329..b089e0a 100644
--- a/api/tests/security/grep-gates.test.ts
+++ b/api/tests/security/grep-gates.test.ts
@@ -37,135 +37,138 @@ const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
 interface Hit {
   file: string; // repo-relative, forward-slashed
   line: number; // 1-based
   text: string;
 }
 
 /** Recursively collect source files under an absolute dir (skips non-existent dirs). */
 function walkSourceFiles(absDir: string): string[] {
   if (!existsSync(absDir)) return [];
   const out: string[] = [];
   for (const entry of readdirSync(absDir)) {
     const abs = join(absDir, entry);
     const st = statSync(abs);
     if (st.isDirectory()) {
       out.push(...walkSourceFiles(abs));
     } else if (SOURCE_EXT.has(abs.slice(abs.lastIndexOf('.')))) {
       out.push(abs);
     }
   }
   return out;
 }
 
 /** 1-based line numbers in `content` whose text matches `re` (re must be non-global). */
 export function matchingLines(content: string, re: RegExp): number[] {
   const lines = content.split('\n');
   const nums: number[] = [];
   for (let i = 0; i < lines.length; i++) if (re.test(lines[i] as string)) nums.push(i + 1);
   return nums;
 }
 
 /** Scan every source file under the given repo-relative dirs for `re`, returning repo-relative hits. */
 function scanTree(relDirs: string[], re: RegExp): Hit[] {
   const hits: Hit[] = [];
   for (const relDir of relDirs) {
     for (const abs of walkSourceFiles(resolve(ROOT, relDir))) {
       const content = readFileSync(abs, 'utf8');
       const relFile = relative(ROOT, abs).split(sep).join('/');
       for (const line of matchingLines(content, re)) {
         hits.push({ file: relFile, line, text: (content.split('\n')[line - 1] as string).trim() });
       }
     }
   }
   return hits;
 }
 
 // The retired permissive-stub grep marker (hyphen or underscore form).
 const STUB_RE = /PERMISSIVE[-_]STUB/;
 // A quoted `builder` ROLE literal: exactly `builder` (lowercase - a role value is never capitalised)
 // bounded by a single or double quote on both sides. Deliberately does NOT match feature identifiers
 // (`integrationBuilder`, `appBuilder`, `builderSessionId`), the site-builder detection code, the
 // `pages.builder.*` locale namespace, or the `allowBuilderAutomations` org-setting key.
 const BUILDER_RE = /['"]builder['"]/;
 
 /**
  * The ONLY files permitted to carry a quoted `builder` role literal after the H1 rename. Each is a
  * sanctioned survivor - a NEW hit in ANY other file fails the gate. Repo-relative, forward-slashed.
  */
 const BUILDER_ALLOWLIST = new Set<string>([
   // Legacy-JWT normalization shim (H1): a token minted before the rename still carries role
   // 'builder'; verifyToken maps it to 'user' at the single verify chokepoint (+ its doc comment).
   'api/src/auth/jwt.ts',
   // migrateBuilderRole: the idempotent boot migration query `users.find({ role: 'builder' })` that
   // rewrites any legacy row to 'user' and bumps its token epoch (+ its doc comments).
   'api/src/auth/users-service.ts',
   // web SESSION-KIND 'builder' - the app-building SESSION kind persisted server-side, NOT a user
   // ROLE. Out of the role model entirely (the H1 rename touched roles, not session kinds).
   'web/stores/orchestration.ts',
 ]);
 
 describe('grep gate: no permissive stub survives (H5)', () => {
   it('PERMISSIVE-STUB / PERMISSIVE_STUB appears nowhere in api/src or shared/src', () => {
     const hits = scanTree(['api/src', 'shared/src'], STUB_RE);
     expect(
       hits,
       `retired permissive-stub marker resurfaced:\n${hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join('\n')}`,
     ).toEqual([]);
   });
 });
 
 describe('grep gate: no orphan `builder` role ref survives (H5)', () => {
-  it('every quoted `builder` role literal in api/src + shared/src + web{app,components,stores} is in the sanctioned allowlist', () => {
+  it('every quoted `builder` role literal in api/src + shared/src + ALL live web source roots is in the sanctioned allowlist', () => {
     const hits = scanTree(
-      ['api/src', 'shared/src', 'web/app', 'web/components', 'web/stores'],
+      // ALL live web source roots (codex-h5 Low: web/lib + web/hooks + web/types + web/locales were
+      // previously unscanned, so an orphan role literal there would have evaded the gate). web/e2e is
+      // test code (excluded); node_modules/.next never appear under these source roots.
+      ['api/src', 'shared/src', 'web/app', 'web/components', 'web/hooks', 'web/lib', 'web/locales', 'web/stores', 'web/types'],
       BUILDER_RE,
     );
     const orphans = hits.filter((h) => !BUILDER_ALLOWLIST.has(h.file));
     expect(
       orphans,
       `NEW orphan \`builder\` role ref (not in the sanctioned allowlist):\n${orphans
         .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
         .join('\n')}\nIf this is a legitimate survivor, add it to BUILDER_ALLOWLIST with a comment; otherwise rename it to 'user'.`,
     ).toEqual([]);
     // Sanity: the allowlisted files ARE actually present in the tree (a stale allowlist entry that
     // no longer matches anything is dead weight the gate should surface).
     for (const allowed of BUILDER_ALLOWLIST) {
       const stillHasLiteral = hits.some((h) => h.file === allowed);
       expect(stillHasLiteral, `allowlist entry ${allowed} no longer carries a builder literal - prune it`).toBe(true);
     }
   });
 });
 
 /**
  * NON-TAUTOLOGY PROOF (in-suite, durable): the pure matcher + allowlist logic detect planted
  * violations and reject the exact identifiers they must NOT match. If someone weakens the regex into
  * a no-op, THESE fail - so the two tree scans above can never silently become vacuous.
  */
 describe('grep gate matchers are not vacuous (H5 self-test)', () => {
   it('the builder-role matcher catches a planted role literal and ignores feature identifiers', () => {
     // Planted violations - MUST match.
     expect(matchingLines("const role = 'builder';", BUILDER_RE)).toEqual([1]);
     expect(matchingLines('body.role = "builder"', BUILDER_RE)).toEqual([1]);
     expect(matchingLines("Role = z.enum(['super-admin','org-admin','builder'])", BUILDER_RE)).toEqual([1]);
     // Legitimate non-role uses - MUST NOT match (the precision the gate depends on).
     expect(matchingLines('import { integrationBuilder } from "./x";', BUILDER_RE)).toEqual([]);
     expect(matchingLines('const builderSessionId = newId();', BUILDER_RE)).toEqual([]);
     expect(matchingLines('orgSettings.allowBuilderAutomations === true', BUILDER_RE)).toEqual([]);
     expect(matchingLines('detectSiteBuilder(url)', BUILDER_RE)).toEqual([]);
     expect(matchingLines('title: "Builder"', BUILDER_RE)).toEqual([]); // capitalised UI label, not a role value
   });
 
   it('the permissive-stub matcher catches both marker spellings', () => {
     expect(matchingLines('return true; // PERMISSIVE-STUB', STUB_RE)).toEqual([1]);
     expect(matchingLines('/* PERMISSIVE_STUB */', STUB_RE)).toEqual([1]);
     expect(matchingLines('// a permissive stub over these names', STUB_RE)).toEqual([]); // prose, not the marker
   });
 
   it('the allowlist is not a blanket pass - a NEW orphan ref in a non-allowlisted file is flagged', () => {
     const synthetic: Hit[] = [
       { file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" },
       { file: 'api/src/auth/jwt.ts', line: 61, text: "role 'builder'" }, // allowlisted survivor
     ];
     const orphans = synthetic.filter((h) => !BUILDER_ALLOWLIST.has(h.file));
     expect(orphans).toEqual([{ file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" }]);
   });
 });
diff --git a/docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md b/docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md
index be8593a..e4862c2 100644
--- a/docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md
+++ b/docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md
@@ -74,80 +74,117 @@ independent of any client confirmation:
 The brief's premise ("a destructive app-data op is authorized by the app-sso identity") is TRUE for
 the PRIVILEGED end-user ops (set-password, the Graph proxy) - asserted above. It is NOT how the
 GENERAL served-app data plane works, and that is a DELIBERATE, PRE-EXISTING, DOCUMENTED design:
 - `api/src/apps/served-data.ts` (`/api/app-data/*`, where a C3 submit/delete lands) is app-id-SCOPED
   and byte-compatible with the legacy key-value plane ("No platform JWT anywhere on this plane"). Its
   per-app server boundary is `X-Ekoa-App-Id` scope + the owner-activation admission gate
   (deactivated/billing-locked owner refused), NOT an app-sso session. `docs/security.md` already
   records this ("must never hold confidential or per-user-private data ... a documented decision, not
   an oversight"); the shared plane (`/api/app-shared`) adds owner-resolution + same-origin + the
   `sharedData` opt-in. So the client confirmation is UX, and the SERVER boundary that DOES exist is
   the app-id scope + owner-activation (general plane) and the app-sso session (privileged ops).
 - Recorded in `docs/security.md` under a new "Security-block assertion layer (H5)" subsection.
 
 ## Deliverable 5 - Live journey drivers (AUTHORED, not run - the lead runs them)
 
 Two committed, budget-capped, transient-tolerant drivers modelled on `fees-knowledge.e2e.mjs` /
 `assistant-billing.e2e.mjs` (safeJson never throws; bounded transient tolerance; single-shot build
 create; 20min build deadline). node --check clean. Registered in `api/tests/SUITE_LEDGER.json`
 (`node_drivers.drivers`, targetGate `operator-run H5`).
 - `api/tests/e2e/edit-journey.e2e.mjs`: admin whoami true -> explicit (client-only) opt-in -> H1-gated
   follow-up PATCH RUN -> preview/diff (versions) -> approve (keep head) -> ROLLBACK restores (H3
   forward-restore to the pre-run head); AND a freshly-created role:'user' session gets whoami false +
   POST /jobs follow-up refused 403 (canEditApps). Budget: up to 2 builds (setup + patch-run; 1 with
   `EDIT_APP_ID`) + 1 rollback restore.
 - `api/tests/e2e/request-changes-journey.e2e.mjs`: an in-org user files from inside an org-shared app
   (route+screen context) -> lands in the OWNER org queue -> the org-admin sees it WITH context ->
   convert STARTS an H1-gated patch run + links the jobId (asserted at the API level: the build is
   started then cancelled, not awaited). FOLDS IN H4's live cross-org proof: a different-org user
   filing about the same app -> 404, no injection into the queue. Budget: 1 setup build + 1 follow-up
   build started-then-cancelled (1 with `REQCHG_APP_ID`).
 
 ## OBSERVATIONS for the lead (non-blocking; NOT fixed - outside H5's remit)
 
 1. **`assistant-billing.e2e.mjs:138` uses `role: 'builder'`** in its `POST /api/v1/users` body. H1's
    rename made `builder` an invalid `Role` enum value, so `CreateUserRequest` validation now 400s that
    create - the driver will FAIL at user-create when the operator runs it. One-char fix
    (`'builder'` -> `'user'`), but the file is an EXISTING operator driver OUTSIDE H5's reserved set
    (and possibly concurrently owned), so it is FLAGGED, not touched. The H5 journey drivers correctly
    use `role: 'user'`.
 2. **Collection-rule `access: { read, write: 'session' | 'server' }` is declared-but-unenforced.** The
    manifest schema (`api/src/data/collections-engine.ts`) lets an app author DECLARE a write-access
    level of `session`/`server`, but `served-data.ts` never consults it (every write is app-id-scoped
    regardless). If any app relied on `access.write: 'session'` for security it would not hold. This is
    PRE-EXISTING (C3/D1 data plane), OUTSIDE the H-block's platform-authz scope, and consistent with
    the byte-compat posture already documented - flagged for the C3/data-plane owner, not fixed (H5
    asserts, it adds no auth code).
 3. Minor: `shared/src/capabilities.ts` header comment is stale (still says the file "exposes a
    PERMISSIVE stub ... until then"; H1 landed the real matrix). It does NOT contain the hyphenated
    `PERMISSIVE-STUB` grep marker, so the D2 gate is unaffected. `shared/src` is outside H5's reserved
    set - not touched.
 
 None of these is a GAP in what H1-H4 built (no missing platform gate, no isolation hole, no missing
 server authz on the platform planes) - so H5 is DONE-GREEN, not GAP-FOUND. The lead decides on (1)/(2).
 
 ## Diagram invariant (FIXED-12)
 H5 changes NO structure, flow, or data shape - it adds committed assertions + docs over the existing
 security block (whose diagrams H1/H3/H4 already updated: 12-org-tenancy, 04-agent-job, 03-request-crud,
 10-privacy-boundaries). No diagram update is required for an assertion-only slice (checked, decided).
 
 ## Reserved-path compliance
 All changes are within the H5 reserved set:
 - `api/tests/auth/capabilities.test.ts` (extended)
 - `api/tests/security/grep-gates.test.ts`, `assistant-cross-org-isolation.test.ts`,
   `destructive-action-authz.test.ts` (new dir `api/tests/security/`)
 - `api/tests/e2e/edit-journey.e2e.mjs`, `request-changes-journey.e2e.mjs` (new)
 - `api/tests/SUITE_LEDGER.json` (2 driver rows)
 - `docs/security.md` (H5 assertion-layer subsection + the destructive-action-authz finding)
 - `docs/autothing/runs/.../slices/H5/**` (this file + worker-status.txt)
 NO `api/src`/`shared/src`/`web` production file touched. No commits, no stack ops, no real builds
 (the journey drivers are authored, not run). Nothing outside `api/src/llm` touches the provider.
 
 ## Verification (all green, locally)
 - `cd api && npx tsc --noEmit -p tsconfig.json` -> 0; `-p tsconfig.test.json` -> 0
 - `npx eslint` on the four touched `.ts` test files -> 0 errors (the `.mjs` drivers are config-ignored;
   `node --check` is their gate - both pass)
 - `cd api && npx vitest run tests/` (FULL lane) -> **180 files, 1627 passed, 1 skipped, 0 failed**
 - grep gate proven to FAIL on a planted `'builder'` + `PERMISSIVE-STUB` probe, then green after removal
   (non-tautology - and also self-proved in-suite)
 - repo-root `npm run gate:chokepoint` -> clean
 - `node --check` on both new `.e2e.mjs` drivers -> OK; `SUITE_LEDGER.json` re-validated as JSON
+
+## Codex-fix round (2026-07-14) - lead-applied
+
+Codex H5 review returned NEEDS-WORK (1 High + 1 Medium + 1 Low). The fresh review APPROVED. All three
+addressed:
+
+- **HIGH - the destructive-action-authz assertion documented-away a REAL gap.** Codex is right: the
+  general `/api/app-data` mutation plane authenticates NO caller (`scopeFor()` = X-Ekoa-App-Id +
+  owner-activation only), so anyone knowing an app id can write/delete that app's data cross-tenant;
+  app-id scoping alone is NOT authorization. The worker framed this as "documented boundary, not a
+  hole" - that framing was WRONG. RE-DISPOSED HONESTLY (not silently fixed, not falsely dismissed):
+  (1) docs/security.md now states it plainly as a KNOWN HIGH GAP with the precise threat + the two
+  compounding facts (collection write-mode unenforced; app-sso cookie not even sent to /api/app-data);
+  (2) a HIGH `served-app-data-unauthenticated-writes` entry in docs/findings.md; (3) a TRIPWIRE in
+  destructive-action-authz.test.ts pinning the current unauthenticated-write state (a future fix flips
+  it), with served-app.test.ts as the behavioral proof it currently 201s. RATIONALE for flag-not-fix:
+  this is PRE-EXISTING (C3/D-era served-app data plane) on a DIFFERENT axis from the platform
+  role/capability layer H1-H4 close (which IS complete); the proper fix (enforce the declared write
+  mode + make an app-sso session verifiable at the data path - cookie-path widening / session token)
+  is an architecture change across the ~200-app estate and an operator decision, not a bolt-on to the
+  assertion slice. It is now the TOP landing item, honestly surfaced - exactly what the assertion
+  layer is FOR (H5 finds gaps; the lead flags them for the operator).
+- **MEDIUM - weak wiring inventory.** The file-level `can(` + literal check stayed green if a route
+  silently lost its live gate (codex's example: whoami returning a constant while isAppEditor still
+  carries the literal). Fixed: (a) the whoami row now REQUIRES the route to actually call
+  `detectAppEditor(` and that `admin: await detectAppEditor(...)` is the response (a constant drops
+  those tokens); (b) each inventory row now names its AUTHORITATIVE behavioral suite and a new test
+  asserts those suites EXIST - the inventory is explicitly a structural smoke, the behavioral suites
+  (jobs-capability / artifacts-capability / the whoami matrix) are the real proof that would fail on
+  a broken gate.
+- **LOW - grep gate web coverage.** The orphan-`builder` scan covered only web/{app,components,stores};
+  web/lib, web/hooks, web/types, web/locales were unscanned (no live miss today - verified - but a
+  future orphan would evade). Fixed: the scan now covers ALL live web source roots.
+
+30/30 in tests/security + tests/auth/capabilities after the fix (grep gate re-proven non-tautological
+- it even caught a literal PERMISSIVE-STUB token in a doc comment I wrote, forcing a reword). No
+production auth code touched (the High is flagged, not fixed - an operator decision).
diff --git a/docs/findings.md b/docs/findings.md
index 4ef7624..754d2b9 100644
--- a/docs/findings.md
+++ b/docs/findings.md
@@ -1,133 +1,152 @@
 # Findings ledger
 
 The live findings ledger: OPEN first, then recently fixed, then accepted/by-design. A finding closes
 only by a landed fix + committed test, or a written dismissal. Replaces the release FINDINGS table and
 the RUN_LOG finding tail. Journey findings keep their `F` ids; later findings use readable slugs.
 
 ## OPEN
 
 ### Contract / schema drift (the schema-coverage honor-system class)
 
 - **`schema-coverage-honor-system`** (structural). The schema-coverage gate is a hand-maintained
   allowlist that does NOT verify a test exercises each COVERED endpoint; a green gate is not proof a
   body matches its schema. Audit 2026-07-10 found 27 of 154 COVERED keys unexercised and ~6 endpoint
   groups returning schema-violating bodies. The three items below are instances. Real fix: a run-wide
   registry of actually-exercised schemas (specified, unimplemented). Tracked: `docs/testing.md`.
 - **`llm-classify-contract`** (medium). `ekoaLocal.llmClassify` handler emits no `category` and reads
   `req.body.prompt`, diverging from the contract input shape; a compliant client gets a schema-
   violating response.
 - **`triggerView-active-drop`** (minor). `triggerView` drops the `active`/disabled field (optional
   field silently omitted), so trigger state is invisible to a schema-strict client.
 - **`view-timestamps-drop`** (minor). `memoryView` and `artifactView` omit `createdAt`/`updatedAt`
   (optional-drop).
 - **F14** (harness-gap, minor). The served-app owner bypass accepts both `Authorization: Bearer` and
   `?token=`; the committed suite asserts only `?token=`. Untested accepted-auth surface.
 - **`artifact-cards-invalid-date`** (minor, UX). The expanded "Os Meus Artefactos" cards render
   "Invalid Date" in the date row for every featured artifact (observed live 2026-07-12 on a fresh
   dev stack, all 41 cards). Likely the card formats a missing/differently-shaped timestamp on
   seeded featured artifacts (`createdAt`/`updatedAt` absent or non-ISO) straight through
   `new Date(...)`. Fix: tolerate absent timestamps (hide the row) and add a regression assertion
   that no card ever renders the literal "Invalid Date".
 - **`ai-integration-lands-under-platform-tab`** (minor, UX). An AI-built integration saved via the
   chat builder (e.g. open-library, e2e-proof-weather, openweathermap) renders under
   `/integrations?tab=plataforma` ("Integrações da Plataforma"), while "Minhas Integrações"
   (`?tab=minhas`) shows the empty state - so a user who just built an integration and looks under
   "Minhas Integrações" does not find it (confusing). It is available to the org (works), just filed
   under the wrong tab for its provenance. Observed live 2026-07-11. Likely the "mine" filter keys on
   a config/credential-instance concept rather than `userCreated` runtime definitions. Decide the
   intended split and route userCreated runtime defs to the "mine" tab (or relabel the tabs).
 - **`integration-handoff-spurious-build`** (medium, UX). Confirming a chat integration offer (the
   two-turn `[[EKOA_INTEGRATION_BUILD]]` handshake) reliably ALSO spawns a real app-build job that
   runs the coding agent with an effectively-empty task and terminates `BUILD_UNFULFILLED` ("A
   construção não chegou à aplicação servida"). Observed live 2026-07-11 for both rest-countries and
   open-library: the integration panel opens and generates+saves correctly (proven — the integration
   lands on `/integrations` with its actions), but the chat column shows a spurious failed build
   alongside it. The build job carries a jobId (server-created) yet no `Vou ligar essa integração
   primeiro.` message precedes it, so it is NOT the build-path in-build classifier; and the client
   `isBuildSession` gate is false on a fresh chat session, so the client message router did not kick
   it — the spurious `build_intent` originates in the server marker orchestration when the
   confirmation turn is classified. Not blocking (the integration still saves) but pollutes the
   handoff. Close by tracing the turn-2 emission: the chat run must emit ONLY the integration signal
   (or, if it emits both, integration must win over build in `agents/chat.ts` — currently build is
   checked first). Add a deterministic test asserting one signal per confirmation turn.
 
+- **`served-app-data-unauthenticated-writes`** (HIGH, pre-existing, operator decision - surfaced by
+  H5's destructive-action-authz assertion). The served-app data plane `/api/app-data/:collection`
+  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
+  `X-Ekoa-App-Id` header + the app OWNER's activation, then scopes to that app's partition. So ANY
+  caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data ACROSS TENANTS (a private
+  org app's data can be tampered/deleted by an outsider who learns its id). Two compounding facts:
+  (1) the manifest collection-rule `access:{ write:'session'|'server' }` is DECLARED but NOT enforced
+  by served-data.ts (the write mode is decorative); (2) the app-sso session cookie is
+  `Path=/api/app-sso`, so it is not even sent to `/api/app-data` - there is no session to check at
+  that path today. NOT introduced by the operator-run (C3/D-era served-app data plane); on a
+  DIFFERENT axis from the platform role/capability layer H1-H4 close (which is complete). Phase 10's
+  "destructive-action authorization asserted server-side" is NOT met for this surface. FIX (an
+  operator architecture decision, a dedicated post-H slice): enforce the declared collection write
+  mode and make an app-sso session verifiable at the data path (widen the app-sso cookie path or mint
+  a session token the data plane checks); `write:'server'` collections should reject ALL client
+  mutations. Pinned as a TRIPWIRE in `api/tests/security/destructive-action-authz.test.ts` (a fix
+  flips the test) + behaviorally green today in `api/tests/contract/served-app.test.ts`. Tracked in
+  `docs/security.md`.
+
 ### Gateway / egress
 
 - **`gateway-502-masks-401`** - CLOSED (local-bridge consumer run s7, 2026-07-11, merged from the
   parallel session): typed `CredentialError` -> 503 `credential_error` (non-retryable), rate-cap ->
   429, transient stays 502; `/health claudeAuth.lastProviderError` carries class+timestamp only;
   gateway metadata is an allowlist (`user_id` only), killing the sibling mask.
 - **`health-bridgeConnections-mismatch`** (small, merged from the parallel session's recon). `/health
   bridgeConnections` reports `sseManager.connectionCount` (SSE clients), not the bridge registry's
   daemon-socket count the field name promises. One-line fix in server.ts /health + a health contract
   assertion.
 - **`e2e-estate-no-committed-env`** (open, structural; merged - extends `e2e-estate-baseline-13`
   below). 49 of 213 due specs red when the WHOLE ledger estate runs against the run-driver stack
   (the served-app compat `/api/v1/action` suites 404 at every commit; demo tours exceed the 30s
   timeout on dev-next latency). Needs a committed full-stack e2e harness + a compat-suite triage.
 - **`gateway-apikey-checkAllowance`** (medium, security). The gateway `apikey` principal skips
   `checkAllowance` and bills the platform admin account - an exfil surface reachable from a build
   subprocess. Operator decision owed on the sanctioned posture.
 - **F8** (judgment, minor). Provider/credential error surfaces are not user-grade: chat can stream an
   English spec citation, the adapter can leak raw provider JSON, and build failure is a generic PT
   sentence with no cause. Needs one error-mapping layer at the streaming sink (PT message + machine
   code, detail in logs).
 
 ### Product bugs
 
 - **`restoreVersion-featured-500`** (medium). `restoreVersion` on a *featured* artifact still 500s.
   (The broader versions-500 - never-built artifacts and the featured list - was fixed 2026-07-11; this
   case remains.)
 - **`web-sourceinput-divergence`** (medium). A web/`shared` `SourceInput` divergence makes a seed-
   template knowledge source 400 from the UI.
 - **`login-double-session`** (minor, dev-only). The login landing double-creates sessions (React
   StrictMode double-mount of the eager empty-session create); dev-DB orphan-row noise, and the /chat
   landing intermittently GETs a just-created session id that 404s (the e2e trackers carry a scoped
   exclusion for exactly that 404 pattern - remove it when this closes). The write should be
   idempotent/effect-guarded.
 - **`chat-sse-discovery`** (deferred, batch-2). S1 adversarial-tester discovery set: chat-SSE late-
   subscriber gap, run hangs on upstream auth failure, temp-session 404 persist.
 - **`web-tests-untypechecked`** (low, batch-2). Web `__tests__` are excluded from tsc, so web test
   files are never typechecked.
 - **`e2e-estate-baseline-13`** (medium, per-spec debt). The first honest full-stack estate run
   (2026-07-11, 187/200 green after this run's fixes) leaves 13 red ported specs, ALL pre-existing
   product/UI gaps (none touch this run's diffs): (a) the documented band2 legacy group still built
   around the retired `/api/v1/action` + old stubs - artifact-backend-panel, artifacts-apps-section,
   update-from-bundle, vertical-profile, onboarding x3 (REST migration owed; see
   docs/e2e-harness-remediation-brief.md); (b) integrations UI gaps - pages-manage expects a search
   input the migrated page lost, integrations-sections' Webhooks tab renders no webhook rows,
   integrations-pipedream master-toggle default/persistence semantics differ; (c) legal-content
   gaps - legal-rcbe journey, legal-shared-drift (six scaffolds vs canonical layer), simuladores-
   trabalho exact CT figures. Each is closed by building the missing surface or by an explicit
   retire decision - never by editing the ported spec.
 
 - **`branding-tab-stale-after-research`** (minor, UI freshness). Right after a brand research
   completes, the Marca tab can render the PREVIOUS palette (local component state seeded at page
   load) while `org.branding` already holds the new one - a fresh reload shows the correct values.
   Observed live 2026-07-11 during the walkthrough recording (post-research tab showed `#1A2D5A`,
   persisted+reload truth was `#1C2B4A`). Likely the local-state sync effect on
   `settings/branding/page.tsx` not re-seeding after `fetchCompany()`. Close with a deterministic
   test that researches (fake transport), switches to the Marca tab and asserts the fresh hex.
 
 - **`collection-rule-access-unenforced`** (medium, data-plane; H5 assertion-layer surfaced). A
   collection rule's `access:{write:'session'|'server'}` is DECLARED in the app manifest schema but
   NOT enforced by served-data.ts - all app-data writes are app-id-scoped (owner-activation
   admission), so the per-collection write mode is decorative. Pre-existing C3/data-plane concern,
   OUTSIDE the H security block (which gates the PLATFORM authz; the served-data plane is a separate,
   documented app-id-scoped design). Close by enforcing the declared write mode in served-data.ts OR
   by removing the unenforced field from the manifest schema. Flagged by H5's destructive-action-authz
   assertion (the privileged app-sso ops ARE gated + asserted; this is the general data plane).
 
 ### Operator-blocked / external
 
 - **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
   on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
   (`docs/operations-runbook.md`).
 - **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
   commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
   is already at `af8b556`).
 
 ## Recently fixed - 2026-07-13 preview probe CORS duplicate header (operator)
 
 - **`F-2026-07-13-proxy-duplicate-acao`** (operator-reported, 2026-07-13) - in dev, the preview
   probe's `HEAD /apps/<slug>/` from the dashboard origin failed CORS on EVERY request:
diff --git a/docs/security.md b/docs/security.md
index 0cc8f36..82b1c3f 100644
--- a/docs/security.md
+++ b/docs/security.md
@@ -81,126 +81,140 @@ an org-scoped key, access-logged, and never sent to Anthropic; (c) a recall-bias
 un-tokenized; (c) is best-effort and degrades without failing the request. Structured-ID fakes are
 minted with a **deliberately invalid checksum** so a fake can never collide with a real identifier.
 
 The vault (value->token map) is per-session, **in-memory, TTL, never persisted, cleared on session
 end** - a re-identification key that does not exist cannot be produced. It is keyed by the hosted
 conversation id so tokens stay consistent across delegated local turns. Audit is **metadata only**
 (entity classes, counts, correlation id, payload hash - never bodies, never the vault), async, hash-
 chained and tamper-evident, folded into the single Registo write path. The payload-capture harness
 asserts every planted synthetic value appears tokenized (never cleartext) in every captured outbound
 request while the user-visible response is cleartext. The Garrison line (FIXED-7): the mechanism is
 Ekoa core; the PT-PT ruleset and per-org deny-lists are loaded configuration, never core.
 
 ## Access control model
 
 Deny by default: every `/api/v1` route passes auth middleware; pre-auth exemptions are exactly the
 `public` class, enforced by a route-census contract test. Authorization is deterministic code, never
 the model. Object-level ownership/org checks on every resource fetch, uniform 403/404. Three roles
 (`super-admin`/`org-admin`/`user`); privileged routes re-resolve the user from the store. Private
 items (memories, artifacts) are invisible to org admins - their existence appears in Registo
 metadata, never their content; sharing is explicit via `visibility`.
 
 **Capability layer (H1).** Authorization is a capability check composed with the ownership/org
 check, never a bare role string. The single seam `can(actor, capability)`
 (`api/src/auth/capabilities.ts`) is a pure role->capability map: `super-admin` and `org-admin` hold
 all four capabilities; a `user` holds `canUseChat` + `canCreateArtifacts` only (chat + non-app
 artifacts, never app build/edit); a null/undefined actor holds nothing (fail closed). It carries no
 org/resource context by design - tenancy + object ownership stay in the separate `loadReadable`/
 `loadWritable` and org-scoping checks, which the gates COMPOSE with `can()`.
 
 | capability | super-admin | org-admin | user |
 | --- | --- | --- | --- |
 | canBuildApps | yes | yes | no |
 | canEditApps | yes | yes | no |
 | canCreateArtifacts | yes | yes | yes |
 | canUseChat | yes | yes | yes |
 
 Four gates enforce it: `POST /jobs` first build requires `canBuildApps`; `POST /jobs` follow-up
 requires `canEditApps` AND a `loadWritable` ownership check on the target artifact; `POST
 /chat/runs` requires `canUseChat`; `POST /artifacts` requires `canCreateArtifacts`. A refusal is the
 shared FORBIDDEN envelope carrying `details.capability` (the machine-readable hook a request-to-admin
 flow consumes). The base role `builder` was renamed `user` (the persona is retired): an idempotent
 boot-step migration rewrites every legacy row and bumps its token epoch (invalidating outstanding
 `builder` JWTs), and a verify-boundary shim in `verifyToken` normalises any legacy `builder` JWT to
 `user` for the window between boot and re-login.
 
 **Follow-up-build ownership (IDOR fix, H1).** A follow-up build (`POST /jobs` with `artifactId`)
 resumes a code-writing agent inside the target app's owner sandbox. It is gated by `canEditApps` +
 `loadWritable(actor, artifactId)` (own always; org-shared within the org ok; another user's private
 -> 403; missing/cross-org -> 404) BEFORE any job is created or agent spawned - closing the prior gap
 where any authenticated user could drive an agent against ANY artifact by id. Credential planes are mutually
 non-interchangeable: platform session JWT (24 h / 30 d rememberMe), bridge token (600 s,
 `aud: ekoa-bridge`), app-SSO session (8 h HttpOnly cookie), gateway key (static, constant-compare).
 Deactivation is write-through (immediate) and bumps the token epoch, invalidating outstanding JWTs.
 
 **Served-app admission planes.** The per-app `/api/app-data` plane is unauthenticated app-global
 storage scoped only by `X-Ekoa-App-Id` (carried verbatim for byte-compatibility) - it must never hold
 confidential or per-user-private data. Anything private lives on a server-authenticated plane: the
 shared namespace (`/api/app-shared`, resolved owner + same-origin guard + `sharedData` opt-in) or
 behind the platform JWT / app-SSO session. This open posture is a documented decision, not an
 oversight.
 
 **Security-block assertion layer (H5).** The access-control invariants above are held by committed,
 re-runnable gates so they cannot silently regress:
 - *Capability matrix + gate wiring* (`api/tests/auth/capabilities.test.ts`): the full role x
   capability grid (grants AND denials; a null/undefined/unknown-role actor holds nothing, fail
   closed), plus a wiring inventory that ties every capability to the route `can(actor, '...')` call
   site that enforces it - so a matrix that stays green while a route loses its gate fails the suite.
   Behavior is driven end-to-end by `jobs-capability`/`artifacts-capability`.
 - *Grep gates* (`api/tests/security/grep-gates.test.ts`): a committed tree scan (mirroring
   `gate:chokepoint`'s style, self-proving via an in-suite non-tautology test) that fails if the
   retired `PERMISSIVE-STUB`/`PERMISSIVE_STUB` marker reappears in `api/src`/`shared/src`, or if a
   quoted `builder` ROLE literal appears anywhere in `api/src`/`shared/src`/`web{app,components,stores}`
   outside a small commented allowlist (the legacy-JWT shim, the migration query, and the web
   SESSION-KIND `builder` - a session kind, not a role).
 - *Cross-org assistant-retrieval isolation* (`api/tests/security/assistant-cross-org-isolation.test.ts`):
   over the real FTS grounding seam, the served-app assistant (`runAppAssistant`, which grounds under
   the server-resolved `owner.orgId`) retrieves + cites ONLY the owner org's knowledge and can never
   reach another org's - the org-B token never even enters an org-A app's prompt. Live evidence is
   folded into the operator journey drivers + `fees-knowledge.e2e.mjs`.
 - *Destructive-action authorization, server-side* (`api/tests/security/destructive-action-authz.test.ts`):
-  a mutating served-app op that is meant to be end-user-gated is authorized SERVER-SIDE by the
+  the PRIVILEGED served-app end-user ops that carry an identity ARE authorized SERVER-SIDE by the
   per-app SSO identity, not by any client confirmation (the Phase 4 confirm dialog is UX). The
   canonical case - `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data) - is
   rejected 401 WITHOUT a valid app-sso session and with a WRONG-APP session (`session.appId`
   isolation via `findValidAppSession`), and proceeds only for the correct same-app session; the
-  visitor-acting `/api/app-sso/m365/*` proxy is gated the same way. **Finding (documented boundary,
-  not a hole):** the GENERAL `/api/app-data` plane a C3 submit/delete lands on is deliberately
-  app-id-SCOPED (see *Served-app admission planes* above) - its per-app server boundary is
-  `X-Ekoa-App-Id` scope + owner-activation admission, NOT an app-sso session; the app-sso IDENTITY
-  plane gates the PRIVILEGED end-user ops. A related pre-existing OBSERVATION outside the H-block's
-  scope: the collection-rule `access: { read, write: 'session' | 'server' }` level is DECLARED in the
-  manifest schema but not enforced by `served-data.ts` (writes are app-id-scoped regardless) - flagged
-  for the C3/data-plane owner, not fixed by H5 (H5 asserts, it adds no auth code).
+  visitor-acting `/api/app-sso/m365/*` proxy is gated the same way.
+
+  **KNOWN GAP (HIGH, pre-existing, requires an operator decision) - unauthenticated served-app data
+  mutations.** The GENERAL `/api/app-data/:collection` plane that a C3 submit/delete/write lands on
+  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
+  `X-Ekoa-App-Id` + the resolved app OWNER's activation (`admitOwner`), then scopes to that app's
+  data partition. So ANY caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data
+  across tenants - the "authorization dimension" Phase 10 requires for a destructive action is NOT
+  met for the primary served-app mutation surface. Two compounding facts: (1) the collection-rule
+  `access: { write: 'session' | 'server' }` level is DECLARED in the manifest schema but NOT enforced
+  by `served-data.ts` (the write mode is decorative); (2) the app-sso session cookie is
+  `Path=/api/app-sso`, so it is not even transmitted to `/api/app-data`, i.e. there is no session to
+  check at that path today. This is PRE-EXISTING (the C3/D-era served-app data plane; the operator-run
+  did not introduce it) and sits on a DIFFERENT axis from the platform role/capability layer H1-H4
+  close (which IS complete and correct). The proper fix - enforce the declared write mode and make an
+  app-sso session verifiable at the data path (cookie-path widening or a session token) - is an
+  architecture change to the served-app data plane spanning the ~200-app estate, and is an operator
+  decision, not a bolt-on to this assertion slice. H5 ASSERTS the current state honestly
+  (`destructive-action-authz.test.ts` pins the unauthenticated write as a KNOWN-GAP TRIPWIRE so a
+  future fix flips the test) and flags it as the top landing item; it does NOT claim the plane is safe
+  and does NOT silently redesign it. Tracked: `docs/findings.md`
+  `served-app-data-unauthenticated-writes`.
 
 **Frame headers (current state).** The api plane sets `X-Frame-Options: DENY` / `frame-ancestors
 'none'`. The served-app plane sets `frame-ancestors 'self'` + `SAMEORIGIN`. The `/apps` embed
 allowlist (so the cross-origin dashboard can iframe a served artifact) is **PENDING** - tracked as an
 open security task in `docs/findings.md`.
 
 ## Incident response
 
 Solo-operator posture: the founder is incident commander. Detection sources, in order: **Registo**
 (append-only, single write path - agent actions, privileged data access, auth/admin ops), the
 anonymisation audit (hash-chained, metadata-only), the chokepoint meter (anomalous-burn / spend-cap
 trips), and boot-gate failures. Severity: S1 confirmed cross-org exposure / key compromise / PII
 egress past the anonymisation boundary; S2 single-org/user exposure or auth bypass without confirmed
 exploitation; S3 vulnerability without exposure. Containment (first hour): scope from Registo; cut
 access narrowly (deactivate account -> bump token epoch -> revoke bridge pairings -> rotate the
 secret in Secret Manager -> last resort stop the service); preserve the append-only evidence before
 any remediation. GDPR: personal-data breach to the supervisory authority within 72 h of awareness
 unless no risk; record the decision either way. Post-incident: write it up in `docs/decisions.md`,
 and every accepted root cause ships a deterministic guard in the same fix.
 
 ## Secure development
 
 All change lands through the gated process (spec-first history preserved in git; see
 `docs/governance.md`). Structural enforcement is the lint + CI wall above. Input/output: boundary
 validation via the shared zod contract on every request (the contract is simultaneously input schema
 and injection defence); non-2xx bodies validate against the error envelope; no secrets/keys/org data
 in system prompts. CI security gates run on every lane: gitleaks (secrets), Semgrep (SAST),
 `npm audit` severity, the boundary/chokepoint grep gates, plus the named security suites - cross-org
 adversarial, in-org sharing, rate-limit/spend-cap, anonymisation payload-capture, and the bridge
 S1-S6 scenarios. The determinism ratchet: every accepted review or incident finding ships a
 deterministic guard (test, lint rule, Semgrep pattern, grep gate) in the same fix, so reviews trend
 toward judgment-only and regressions are machine-caught. Secrets live in a managed store only (GCP
 Secret Manager in prod; a bootstrap-generated key in dev); rotation is documented per secret.

codex
I’ve confirmed the docs were rewritten. Now I’m checking the actual test logic and route source so the result isn’t just “the prose says the right thing.”
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph node api/tests/auth/capabilities.test.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/tests/security/grep-gates.test.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/apps/app-assistant-route.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/apps/served-data.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 207ms:
**api/tests/auth/capabilities.test.ts** — 154 lines, 5 symbols · no other indexed file depends on it

1	/**
2	 * The real capability matrix (operator-run H1). REPLACES the S0 permissive-stub test: `can()` now
3	 * enforces the brief §9a role→capability grid, not a blanket `true`. The H5 security assertions
4	 * grep the source (api/src/auth/capabilities.ts) for the retired stub marker and fail if it
5	 * survives; this suite pins the behavior that replaced it.
6	 */
7	import { describe, it, expect } from 'vitest';
8	import { readFileSync, existsSync } from 'node:fs';
9	import { fileURLToPath } from 'node:url';
10	import { dirname, resolve } from 'node:path';
11	import { Capability } from '@ekoa/shared';
12	import { can } from '../../src/auth/capabilities.js';
13	
14	const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/auth
15	const API_SRC = resolve(HERE, '../../src'); // <root>/api/src
16	const TESTS_ROOT = resolve(HERE, '..'); // <root>/api/tests
17	const readSrc = (rel: string) => readFileSync(resolve(API_SRC, rel), 'utf8');
18	
19	// The authoritative grid. Every (role x capability) cell is asserted below - both the grants and
20	// the denials - so a future edit to the matrix cannot silently widen a role.
21	const EXPECTED: Record<'super-admin' | 'org-admin' | 'user', Record<Capability, boolean>> = {
22	  'super-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
23	  'org-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
24	  user: { canBuildApps: false, canEditApps: false, canCreateArtifacts: true, canUseChat: true },
25	};
26	
27	describe('can() capability matrix (H1)', () => {
28	  it('every role x capability cell matches the brief grid (all 12 cells)', () => {
29	    for (const role of Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>) {
30	      for (const capability of Capability.options) {
31	        expect(can({ role }, capability), `${role} / ${capability}`).toBe(EXPECTED[role][capability]);
32	      }
33	    }
34	  });
35	
36	  it('a user holds exactly canUseChat + canCreateArtifacts - never the app build/edit capabilities', () => {
37	    expect(can({ role: 'user' }, 'canUseChat')).toBe(true);
38	    expect(can({ role: 'user' }, 'canCreateArtifacts')).toBe(true);
39	    expect(can({ role: 'user' }, 'canBuildApps')).toBe(false);
40	    expect(can({ role: 'user' }, 'canEditApps')).toBe(false);
41	  });
42	
43	  it('admins (org-admin + super-admin) hold every capability', () => {
44	    for (const role of ['org-admin', 'super-admin'] as const) {
45	      for (const capability of Capability.options) {
46	        expect(can({ role }, capability), `${role} / ${capability}`).toBe(true);
47	      }
48	    }
49	  });
50	
51	  it('a null/undefined actor holds NOTHING (fail closed)', () => {
52	    for (const capability of Capability.options) {
53	      expect(can(null, capability), `null / ${capability}`).toBe(false);
54	      expect(can(undefined, capability), `undefined / ${capability}`).toBe(false);
55	    }
56	  });
57	
58	  it('an unknown/stale role holds NOTHING (fail closed) - a signature-valid token carrying a dead role value grants nothing', () => {
59	    // The `?? false` defensive branch in can(): a role not in the CAPABILITIES map (the retired
60	    // `builder` value that somehow bypassed the verifyToken shim, or any garbage) is refused every
61	    // capability. This is the security posture the H1 map §7 called out - capability must never
62	    // default to "more" for an unrecognised role.
63	    for (const capability of Capability.options) {
64	      expect(can({ role: 'builder' as never }, capability), `stale-builder / ${capability}`).toBe(false);
65	      expect(can({ role: 'root' as never }, capability), `garbage-root / ${capability}`).toBe(false);
66	      expect(can({ role: '' as never }, capability), `empty-role / ${capability}`).toBe(false);
67	    }
68	  });
69	
70	  it('the capability vocabulary is the brief-designed set (unchanged by H1)', () => {
71	    expect(Capability.options).toEqual(['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat']);
72	  });
73	});
74	
75	/**
76	 * H5 gate-wiring assertion - the matrix ABOVE is the pure decision; this block proves each cell is
77	 * actually ENFORCED at the routes that mint/mutate the gated resource, so the matrix cannot drift
78	 * away from its enforcement points. It ties every capability to at least one wired `can(actor, '…')`
79	 * call site, cross-referencing (NOT duplicating) the two integration suites that drive the behavior
80	 * end-to-end over the real routers:
81	 *   - api/tests/contract/jobs-capability.test.ts - POST /jobs first-build (canBuildApps) + follow-up
82	 *     (canEditApps + writability/IDOR); a `user` refused, an org-admin proceeds, executor never
83	 *     called on a refusal.
84	 *   - api/tests/contract/artifacts-capability.test.ts - the in-place app-edit vectors (canEditApps
85	 *     via denyAppEdit), import + fork-of-app (canBuildApps), and a `user` keeping non-app
86	 *     create/fork (canCreateArtifacts).
87	 * Here we assert the WIRING inventory (the source has the gate) so a future edit that silently drops
88	 * a gate - leaving the matrix green but the route ungated - fails this suite.
89	 */
90	describe('capability gate wiring (H5) - the matrix is enforced at the routes', () => {
91	  // capability -> the source file that must carry an enforcing `can(actor, '<capability>')` gate,
92	  // with the vector it guards, AND the BEHAVIORAL suite that would fail if the gate stopped being
93	  // reached at runtime. This structural inventory is a SMOKE (a route file that still contains the
94	  // can() literal keeps this green even if a handler stopped CALLING it - codex-h5 Medium); the
95	  // named behavioral suites are the AUTHORITATIVE proof: they drive the real route end to end, so a
96	  // handler that returned a constant / dropped its gate FAILS there. Each row lists both so a broken
97	  // gate is caught behaviorally, not merely asserted structurally.
98	  const WIRING: Array<{ capability: Capability; file: string; vector: string; behavioral: string }> = [
99	    { capability: 'canBuildApps', file: 'routes/jobs.ts', vector: 'first build (POST /jobs, no artifactId)', behavioral: 'tests/contract/jobs-capability.test.ts (user 403, admin 202)' },
100	    { capability: 'canEditApps', file: 'routes/jobs.ts', vector: 'follow-up build (POST /jobs, artifactId)', behavioral: 'tests/contract/jobs-capability.test.ts (follow-up 403/404)' },
101	    { capability: 'canUseChat', file: 'routes/chat.ts', vector: 'chat run (POST /chat/runs)', behavioral: 'tests/contract/jobs-capability.test.ts + chat suites' },
102	    { capability: 'canCreateArtifacts', file: 'routes/artifacts.ts', vector: 'artifact create (POST /artifacts)', behavioral: 'tests/contract/artifacts-capability.test.ts' },
103	    { capability: 'canEditApps', file: 'routes/artifacts.ts', vector: 'in-place app-edit vectors (denyAppEdit)', behavioral: 'tests/contract/artifacts-capability.test.ts (bundle-update/file/restore/backend 403)' },
104	    { capability: 'canBuildApps', file: 'routes/artifacts.ts', vector: 'import + fork-of-app', behavioral: 'tests/contract/artifacts-capability.test.ts (import/fork 403)' },
105	    { capability: 'canEditApps', file: 'apps/app-assistant-route.ts', vector: 'served-app admin detection (whoami)', behavioral: 'tests/apps/app-assistant.test.ts (whoami fail-closed matrix over the real route)' },
106	  ];
107	
108	  it.each(WIRING)('$capability is wired at $file - $vector', ({ capability, file }) => {
109	    const src = readSrc(file);
110	    // A real gate is a `can(` call whose argument list carries the capability literal. The fork
111	    // vector passes the capability through a `forkCap` variable, but the literal is defined
112	    // adjacent on the same statement, so the file-scoped literal-near-can() assertion still holds.
113	    expect(src.includes('can('), `${file} must call can()`).toBe(true);
114	    expect(src.includes(`'${capability}'`), `${file} must reference the ${capability} capability literal`).toBe(true);
115	    // Tie them together: a `can(...)` call referencing this capability literal (allowing the
116	    // forkCap indirection in artifacts.ts, where the literal sits on the ternary feeding can()).
117	    const wiredDirectly = new RegExp(`can\\([^;]*'${capability}'`).test(src);
118	    const wiredViaForkCap =
119	      file === 'routes/artifacts.ts' && /forkCap\s*=\s*isAppArtifact[^;]*'canBuildApps'[^;]*'canCreateArtifacts'/.test(src) && /can\([^;]*forkCap/.test(src);
120	    expect(wiredDirectly || wiredViaForkCap, `${file}: no can(actor, '${capability}') gate found`).toBe(true);
121	    // The whoami row's structural check is the WEAKEST (the can() literal lives in the isAppEditor
122	    // helper, so the file stays green even if the handler stopped calling it - codex-h5 Medium).
123	    // Tighten it: the whoami HANDLER must actually invoke detectAppEditor (the code path that reaches
124	    // the gate); a handler returning a constant would drop this token. The behavioral whoami matrix
125	    // (tests/apps/app-assistant.test.ts) is the authoritative catch either way.
126	    if (file === 'apps/app-assistant-route.ts') {
127	      expect(/detectAppEditor\(/.test(src), 'whoami must call detectAppEditor (the gate path), not return a constant').toBe(true);
128	      expect(/admin:\s*await\s+detectAppEditor\(/.test(src), 'the whoami response `admin` must be the detectAppEditor result').toBe(true);
129	    }
130	  });
131	
132	  it('every wired capability has a named AUTHORITATIVE behavioral suite (structural inventory is only a smoke)', () => {
133	    // codex-h5 Medium: the structural inventory can go stale-green; each row must point at a suite
134	    // that drives the real route and would fail on a broken gate. Assert the referenced suite files
135	    // exist so the pointer never rots.
136	    for (const w of WIRING) {
137	      expect(w.behavioral, `${w.capability}@${w.file} must name a behavioral suite`).toBeTruthy();
138	      const suiteFile = w.behavioral.split(' ')[0]!; // the leading path token (api/tests-relative, e.g. tests/contract/...)
139	      expect(existsSync(resolve(TESTS_ROOT, '..', suiteFile)), `behavioral suite ${suiteFile} must exist`).toBe(true);
140	    }
141	  });
142	
143	  it('the two admin-only capabilities (a user is denied) are each enforced by a wired gate', () => {
144	    // The matrix denies a `user` canBuildApps + canEditApps; both MUST have at least one enforcing
145	    // gate, else the denial is unenforceable. (canUseChat + canCreateArtifacts are user-held; their
146	    // gates refuse only a null/no-capability actor.)
147	    for (const cap of ['canBuildApps', 'canEditApps'] as const) {
148	      const enforced = WIRING.some((w) => w.capability === cap);
149	      expect(enforced, `${cap} (admin-only) must be enforced somewhere`).toBe(true);
150	      expect(can({ role: 'user' }, cap), `matrix: a user is denied ${cap}`).toBe(false);
151	    }
152	  });
153	});
154	

 succeeded in 187ms:
**api/tests/security/grep-gates.test.ts** — 175 lines, 10 symbols · no other indexed file depends on it

1	/**
2	 * H5 committed grep gates (BRIEF Phase 10 deliverable 2). Two standing tree invariants of the
3	 * security block, asserted in-suite (they run in the FULL vitest lane the operator runs, mirroring
4	 * scripts/chokepoint-grep.sh's intent but self-contained + self-proving):
5	 *
6	 *   1. NO permissive-stub survives. H1 replaced the pre-security-block `can()` permissive stub with
7	 *      the real capability matrix and deleted its pinned stub test. The retired grep-marker
8	 *      `PERMISSIVE-STUB` / `PERMISSIVE_STUB` MUST NOT reappear anywhere in api/src or shared/src - a
9	 *      hit means a blanket-allow body crept back in.
10	 *   2. NO orphan `builder` ROLE ref. H1 renamed the role value `builder` -> `user`. A quoted
11	 *      `'builder'` / `"builder"` ROLE literal may survive ONLY in the small sanctioned allowlist
12	 *      below (the legacy-JWT shim, the migration query + its doc comments, and the web SESSION-KIND
13	 *      `builder` - a session kind, NOT a user role). A `'builder'` literal ANYWHERE else in api/src,
14	 *      shared/src, or web/{app,components,stores} is a NEW orphan role ref and FAILS the gate.
15	 *
16	 * NON-TAUTOLOGY: the matcher + allowlist logic are pure functions, unit-tested against planted
17	 * violations in the same file, so the gate is provably not vacuous (a real `'builder'` / stub marker
18	 * IS detected, and a non-allowlisted file IS flagged) without needing a one-off manual plant.
19	 *
20	 * SCOPE NOTE (why the org-setting KEY is not allowlisted): `allowBuilderAutomations` is the persisted
21	 * org-setting key whose data-compat wire name kept "Builder" after the role rename. It is an unquoted
22	 * identifier substring, so the quoted-role-literal matcher below never matches it - it needs no
23	 * allowlist entry, and this is asserted by the matcher self-test.
24	 */
25	import { describe, it, expect } from 'vitest';
26	import { readdirSync, statSync, existsSync } from 'node:fs';
27	import { readFileSync } from 'node:fs';
28	import { fileURLToPath } from 'node:url';
29	import { dirname, resolve, relative, join, sep } from 'node:path';
30	
31	const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/security
32	const ROOT = resolve(HERE, '../../..'); // <root>
33	
34	const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
35	
36	/** A single matched line, repo-relative (POSIX-normalised so the allowlist is portable). */
37	interface Hit {
38	  file: string; // repo-relative, forward-slashed
39	  line: number; // 1-based
40	  text: string;
41	}
42	
43	/** Recursively collect source files under an absolute dir (skips non-existent dirs). */
44	function walkSourceFiles(absDir: string): string[] {
45	  if (!existsSync(absDir)) return [];
46	  const out: string[] = [];
47	  for (const entry of readdirSync(absDir)) {
48	    const abs = join(absDir, entry);
49	    const st = statSync(abs);
50	    if (st.isDirectory()) {
51	      out.push(...walkSourceFiles(abs));
52	    } else if (SOURCE_EXT.has(abs.slice(abs.lastIndexOf('.')))) {
53	      out.push(abs);
54	    }
55	  }
56	  return out;
57	}
58	
59	/** 1-based line numbers in `content` whose text matches `re` (re must be non-global). */
60	export function matchingLines(content: string, re: RegExp): number[] {
61	  const lines = content.split('\n');
62	  const nums: number[] = [];
63	  for (let i = 0; i < lines.length; i++) if (re.test(lines[i] as string)) nums.push(i + 1);
64	  return nums;
65	}
66	
67	/** Scan every source file under the given repo-relative dirs for `re`, returning repo-relative hits. */
68	function scanTree(relDirs: string[], re: RegExp): Hit[] {
69	  const hits: Hit[] = [];
70	  for (const relDir of relDirs) {
71	    for (const abs of walkSourceFiles(resolve(ROOT, relDir))) {
72	      const content = readFileSync(abs, 'utf8');
73	      const relFile = relative(ROOT, abs).split(sep).join('/');
74	      for (const line of matchingLines(content, re)) {
75	        hits.push({ file: relFile, line, text: (content.split('\n')[line - 1] as string).trim() });
76	      }
77	    }
78	  }
79	  return hits;
80	}
81	
82	// The retired permissive-stub grep marker (hyphen or underscore form).
83	const STUB_RE = /PERMISSIVE[-_]STUB/;
84	// A quoted `builder` ROLE literal: exactly `builder` (lowercase - a role value is never capitalised)
85	// bounded by a single or double quote on both sides. Deliberately does NOT match feature identifiers
86	// (`integrationBuilder`, `appBuilder`, `builderSessionId`), the site-builder detection code, the
87	// `pages.builder.*` locale namespace, or the `allowBuilderAutomations` org-setting key.
88	const BUILDER_RE = /['"]builder['"]/;
89	
90	/**
91	 * The ONLY files permitted to carry a quoted `builder` role literal after the H1 rename. Each is a
92	 * sanctioned survivor - a NEW hit in ANY other file fails the gate. Repo-relative, forward-slashed.
93	 */
94	const BUILDER_ALLOWLIST = new Set<string>([
95	  // Legacy-JWT normalization shim (H1): a token minted before the rename still carries role
96	  // 'builder'; verifyToken maps it to 'user' at the single verify chokepoint (+ its doc comment).
97	  'api/src/auth/jwt.ts',
98	  // migrateBuilderRole: the idempotent boot migration query `users.find({ role: 'builder' })` that
99	  // rewrites any legacy row to 'user' and bumps its token epoch (+ its doc comments).
100	  'api/src/auth/users-service.ts',
101	  // web SESSION-KIND 'builder' - the app-building SESSION kind persisted server-side, NOT a user
102	  // ROLE. Out of the role model entirely (the H1 rename touched roles, not session kinds).
103	  'web/stores/orchestration.ts',
104	]);
105	
106	describe('grep gate: no permissive stub survives (H5)', () => {
107	  it('PERMISSIVE-STUB / PERMISSIVE_STUB appears nowhere in api/src or shared/src', () => {
108	    const hits = scanTree(['api/src', 'shared/src'], STUB_RE);
109	    expect(
110	      hits,
111	      `retired permissive-stub marker resurfaced:\n${hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join('\n')}`,
112	    ).toEqual([]);
113	  });
114	});
115	
116	describe('grep gate: no orphan `builder` role ref survives (H5)', () => {
117	  it('every quoted `builder` role literal in api/src + shared/src + ALL live web source roots is in the sanctioned allowlist', () => {
118	    const hits = scanTree(
119	      // ALL live web source roots (codex-h5 Low: web/lib + web/hooks + web/types + web/locales were
120	      // previously unscanned, so an orphan role literal there would have evaded the gate). web/e2e is
121	      // test code (excluded); node_modules/.next never appear under these source roots.
122	      ['api/src', 'shared/src', 'web/app', 'web/components', 'web/hooks', 'web/lib', 'web/locales', 'web/stores', 'web/types'],
123	      BUILDER_RE,
124	    );
125	    const orphans = hits.filter((h) => !BUILDER_ALLOWLIST.has(h.file));
126	    expect(
127	      orphans,
128	      `NEW orphan \`builder\` role ref (not in the sanctioned allowlist):\n${orphans
129	        .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
130	        .join('\n')}\nIf this is a legitimate survivor, add it to BUILDER_ALLOWLIST with a comment; otherwise rename it to 'user'.`,
131	    ).toEqual([]);
132	    // Sanity: the allowlisted files ARE actually present in the tree (a stale allowlist entry that
133	    // no longer matches anything is dead weight the gate should surface).
134	    for (const allowed of BUILDER_ALLOWLIST) {
135	      const stillHasLiteral = hits.some((h) => h.file === allowed);
136	      expect(stillHasLiteral, `allowlist entry ${allowed} no longer carries a builder literal - prune it`).toBe(true);
137	    }
138	  });
139	});
140	
141	/**
142	 * NON-TAUTOLOGY PROOF (in-suite, durable): the pure matcher + allowlist logic detect planted
143	 * violations and reject the exact identifiers they must NOT match. If someone weakens the regex into
144	 * a no-op, THESE fail - so the two tree scans above can never silently become vacuous.
145	 */
146	describe('grep gate matchers are not vacuous (H5 self-test)', () => {
147	  it('the builder-role matcher catches a planted role literal and ignores feature identifiers', () => {
148	    // Planted violations - MUST match.
149	    expect(matchingLines("const role = 'builder';", BUILDER_RE)).toEqual([1]);
150	    expect(matchingLines('body.role = "builder"', BUILDER_RE)).toEqual([1]);
151	    expect(matchingLines("Role = z.enum(['super-admin','org-admin','builder'])", BUILDER_RE)).toEqual([1]);
152	    // Legitimate non-role uses - MUST NOT match (the precision the gate depends on).
153	    expect(matchingLines('import { integrationBuilder } from "./x";', BUILDER_RE)).toEqual([]);
154	    expect(matchingLines('const builderSessionId = newId();', BUILDER_RE)).toEqual([]);
155	    expect(matchingLines('orgSettings.allowBuilderAutomations === true', BUILDER_RE)).toEqual([]);
156	    expect(matchingLines('detectSiteBuilder(url)', BUILDER_RE)).toEqual([]);
157	    expect(matchingLines('title: "Builder"', BUILDER_RE)).toEqual([]); // capitalised UI label, not a role value
158	  });
159	
160	  it('the permissive-stub matcher catches both marker spellings', () => {
161	    expect(matchingLines('return true; // PERMISSIVE-STUB', STUB_RE)).toEqual([1]);
162	    expect(matchingLines('/* PERMISSIVE_STUB */', STUB_RE)).toEqual([1]);
163	    expect(matchingLines('// a permissive stub over these names', STUB_RE)).toEqual([]); // prose, not the marker
164	  });
165	
166	  it('the allowlist is not a blanket pass - a NEW orphan ref in a non-allowlisted file is flagged', () => {
167	    const synthetic: Hit[] = [
168	      { file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" },
169	      { file: 'api/src/auth/jwt.ts', line: 61, text: "role 'builder'" }, // allowlisted survivor
170	    ];
171	    const orphans = synthetic.filter((h) => !BUILDER_ALLOWLIST.has(h.file));
172	    expect(orphans).toEqual([{ file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" }]);
173	  });
174	});
175	

 succeeded in 185ms:
**api/src/apps/app-assistant-route.ts** — 287 lines, 10 symbols · used by 2 files: api/tests/apps/app-assistant.test.ts, api/src/server.ts

1	/**
2	 * Served-app assistant plane (operator-run D1) — `POST /api/app-assistant`.
3	 *
4	 * The header-scoped (no platform JWT) endpoint the served app's assistant panel calls. It reuses
5	 * the served-data admission plane: the `X-Ekoa-App-Id` header (charset-checked; the reserved `usr.`
6	 * shared-namespace prefix rejected) resolves to the artifact, whose OWNER's activation gates the
7	 * plane (fail-closed). Unlike the byte-compatible key-value app-data plane, the assistant REQUIRES
8	 * a resolved artifact-backed owner — it has to run under that owner's org and bill that owner — so
9	 * an unresolved / registry-only (dev-serve) id is a 404 here rather than an anonymous scope.
10	 *
11	 * Errors speak the CONV-2 envelope (a new endpoint, not the old app-data string envelope). This
12	 * module may not import routes/ (ch02 §2.7 lint zone), so it emits the envelope directly off the
13	 * shared ERROR_STATUS table — the same shape routes/helpers.sendError produces.
14	 *
15	 * The org the assistant grounds under and the user it bills come ONLY from the server-resolved
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
79	 * EXACTLY (routes/jobs.ts): `can(canEditApps)` AND the artifact is writable by this actor
80	 * (loadWritable: own always; org-shared within the org ok; another user's private → not-ok;
81	 * missing/cross-org → not-ok). Making detection identical to the actual edit authority is what
82	 * closes BOTH codex-h2 findings and a false-offer bug at once:
83	 *   - Medium (fail-closed on a missing owner org): an orphaned/cross-org/unresolvable artifact is
84	 *     never writable, so admin is false even for a super-admin — no false positive.
85	 *   - Low (org-admin membership oracle): admin:true only for apps loadWritable already grants, i.e.
86	 *     the caller's OWN + org-shared apps — exactly what they already enumerate via GET /artifacts
87	 *     (listVisible). It reveals nothing new; a same-org OTHER user's PRIVATE app reads not-writable
88	 *     → admin:false, so it is not an existence oracle for private in-org apps.
89	 *   - No false offer: admin:true ⟺ H3's edit mode / the follow-up build will actually succeed for
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
281	      sendError(res, 'INTERNAL', 'Erro interno.');
282	    });
283	  });
284	
285	  return r;
286	}
287	

 succeeded in 169ms:
**api/src/apps/served-data.ts** — 213 lines, 8 symbols · used by 1 file: api/src/server.ts

1	/**
2	 * Served-app data plane (ch03 §3.9, ch04 §4.2.7) - byte-compatible with the old
3	 * /api/app-data + /api/app-shared wire surface (FIXED-9). The injected window.__ekoa
4	 * client (ch07 §7.6) unwraps EXACTLY these shapes, so they are a compatibility
5	 * contract, not a design:
6	 *   - success bodies: `{ success: true, data: <item|items> }` (create 201, everything
7	 *     else 200); DELETE success is `{ success: true }` with no data member.
8	 *   - PUT is an upsert: update-merge when present, create-with-the-given-id when
9	 *     absent - 200 on BOTH legs (only POST answers 201).
10	 *   - errors: `{ error: '<string>' }` with the old strings ('Invalid collection
11	 *     name', 'Missing or invalid X-Ekoa-App-Id header', 'Not found', the shared-
12	 *     namespace guard strings) - never the CONV-2 object envelope.
13	 *   - OPTIONS on either prefix answers 204.
14	 * Scoping: X-Ekoa-App-Id (charset-checked; `usr.` reserved prefix rejected so the
15	 * shared namespace is unreachable by spoofing; slug resolved server-side to the
16	 * canonical artifact id). No platform JWT anywhere on this plane.
17	 *
18	 * The shared namespace adds (carried verbatim): a same-origin guard (a foreign
19	 * Origin header is refused so the global CORS `*` cannot exfiltrate an owner's
20	 * shared dataset), the manifest `sharedData: true` opt-in (default-off => 403),
21	 * and server-side owner resolution (never a client-supplied account id).
22	 *
23	 * One layered admission check that changes no route shape (Amendment 2; ch03 §3.2
24	 * second admission plane): the artifact OWNER's activation state gates the plane.
25	 * A deactivated owner's apps refuse with the CONV-2 envelope - 403 ACCOUNT_DISABLED
26	 * or 402 BILLING_LOCKED - and an owner with no activation record fails CLOSED
27	 * (ch09; a cache miss is never an allow).
28	 */
29	import { Router, type Request, type Response, type RequestHandler } from 'express';
30	import {
31	  CollectionsEngine,
32	  appScope,
33	  sharedScope,
34	  collectionName,
35	  EngineError,
36	} from '../data/collections-engine.js';
37	import { getActivation } from '../data/activation.js';
38	import { resolveApp, type ResolvedApp } from './registry.js';
39	
40	const SHARED_SCOPE_PREFIX = 'usr.';
41	
42	/** True when a request's Origin is cross-origin to its Host (carried check: served
43	 *  apps call the shared routes same-origin; a foreign Origin is an exfil attempt;
44	 *  no Origin means a same-origin GET or a non-browser caller and is allowed). */
45	export function originIsForeign(origin: string | undefined, host: string | undefined): boolean {
46	  if (!origin) return false;
47	  try {
48	    return new URL(origin).host !== host;
49	  } catch {
50	    return true; // malformed Origin -> treat as foreign
51	  }
52	}
53	
54	export function servedDataRouter(deps: { now: () => number; genId: () => string }): Router {
55	  const r = Router();
56	  const engine = new CollectionsEngine(deps);
57	
58	  // Old-plane middleware order carried: an invalid collection name 400s before
59	  // the header is even looked at.
60	  const validateCollection: RequestHandler = (req, res, next) => {
61	    if (!collectionName.safeParse(req.params.collection).success) {
62	      res.status(400).json({ error: 'Invalid collection name' });
63	      return;
64	    }
65	    next();
66	  };
67	
68	  /** Validate the X-Ekoa-App-Id header (charset + not the reserved prefix). Writes
69	   *  the 400 and returns null on refusal. Byte-compat: the OLD per-app plane did NOT
70	   *  require the app to exist - it keyed data on the (charset-checked, non-reserved)
71	   *  header value directly, so featured apps, dev-serve apps, and any app id all work. */
72	  function headerFor(req: Request, res: Response): string | null {
73	    const header = req.header('x-ekoa-app-id');
74	    if (
75	      typeof header !== 'string' ||
76	      !collectionName.safeParse(header).success ||
77	      header.startsWith(SHARED_SCOPE_PREFIX)
78	    ) {
79	      res.status(400).json({ error: 'Missing or invalid X-Ekoa-App-Id header' });
80	      return null;
81	    }
82	    return header;
83	  }
84	
85	  /** Amendment 2 second admission plane: when an ARTIFACT backs the app, its owner's
86	   *  activation gates service (fail-closed CONV-2). Apps with no artifact owner (dev-
87	   *  serve, or a raw/unregistered id on the key-value per-app plane) have no subject,
88	   *  so the gate is skipped - carried old-plane behavior. Returns true to proceed. */
89	  function admitOwner(app: ResolvedApp | null, res: Response): boolean {
90	    if (!app || !app.artifactBacked) return true;
91	    const activation = getActivation(app.ownerUserId);
92	    if (!activation || activation.active === false) {
93	      res.status(403).json({ error: { code: 'ACCOUNT_DISABLED', message: 'A sua conta está bloqueada. Contacte o suporte.' } });
94	      return false;
95	    }
96	    if (activation.billingLocked) {
97	      res.status(402).json({ error: { code: 'BILLING_LOCKED', message: 'A sua conta tem um problema de faturação. Contacte o suporte.' } });
98	      return false;
99	    }
100	    return true;
101	  }
102	
103	  async function scopeFor(req: Request, res: Response, shared: boolean) {
104	    const header = headerFor(req, res);
105	    if (!header) return null;
106	    // Best-effort resolve: the per-app plane does NOT require existence (key-value,
107	    // carried), but a resolved artifact still gates on its owner's activation.
108	    const app = await resolveApp(header);
109	    if (!admitOwner(app, res)) return null;
110	
111	    if (!shared) {
112	      // Per-app scope: a resolved app gives its canonical id (so slug and id hit the
113	      // same data - edits never orphan it); an unresolved (dev/raw) id keys on itself.
114	      // Existence is NOT required (key-value plane, carried).
115	      return appScope(app ? app.appId : header);
116	    }
117	
118	    // Shared namespace REQUIRES a resolved owner - guards carried verbatim.
119	    if (!app) {
120	      res.status(404).json({ error: 'Not found' });
121	      return null;
122	    }
123	    if (originIsForeign(req.headers.origin as string | undefined, req.headers.host)) {
124	      res.status(403).json({ error: 'cross-origin shared-data access denied' });
125	      return null;
126	    }
127	    if (!app.sharedData) {
128	      res.status(403).json({ error: 'app does not participate in shared data' });
129	      return null;
130	    }
131	    if (!app.ownerUserId || !collectionName.safeParse(app.ownerUserId).success) {
132	      res.status(403).json({ error: 'shared data unavailable: owner unresolved' });
133	      return null;
134	    }
135	    return sharedScope(app.appId, app.ownerUserId);
136	  }
137	
138	  function handleEngineError(res: Response, e: unknown): void {
139	    // Old-plane errors are strings; engine failures surface their message.
140	    if (e instanceof EngineError) {
141	      res.status(e.status).json({ error: e.message });
142	      return;
143	    }
144	    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
145	  }
146	
147	  function mount(prefix: string, shared: boolean) {
148	    r.options(new RegExp(`^${prefix}/`), (_req, res) => {
149	      res.status(204).end();
150	    });
151	
152	    r.get(`${prefix}/:collection`, validateCollection, async (req, res) => {
153	      const scope = await scopeFor(req, res, shared);
154	      if (!scope) return;
155	      try {
156	        res.json({ success: true, data: await engine.list(scope, req.params.collection as string) });
157	      } catch (e) {
158	        handleEngineError(res, e);
159	      }
160	    });
161	
162	    r.get(`${prefix}/:collection/:id`, validateCollection, async (req, res) => {
163	      const scope = await scopeFor(req, res, shared);
164	      if (!scope) return;
165	      try {
166	        const item = await engine.get(scope, req.params.collection as string, req.params.id as string);
167	        if (!item) return res.status(404).json({ error: 'Not found' });
168	        res.json({ success: true, data: item });
169	      } catch (e) {
170	        handleEngineError(res, e);
171	      }
172	    });
173	
174	    r.post(`${prefix}/:collection`, validateCollection, async (req, res) => {
175	      const scope = await scopeFor(req, res, shared);
176	      if (!scope) return;
177	      try {
178	        const item = await engine.create(scope, req.params.collection as string, req.body ?? {});
179	        res.status(201).json({ success: true, data: item });
180	      } catch (e) {
181	        handleEngineError(res, e);
182	      }
183	    });
184	
185	    r.put(`${prefix}/:collection/:id`, validateCollection, async (req, res) => {
186	      const scope = await scopeFor(req, res, shared);
187	      if (!scope) return;
188	      try {
189	        const item = await engine.upsert(scope, req.params.collection as string, req.params.id as string, req.body ?? {});
190	        res.json({ success: true, data: item });
191	      } catch (e) {
192	        handleEngineError(res, e);
193	      }
194	    });
195	
196	    r.delete(`${prefix}/:collection/:id`, validateCollection, async (req, res) => {
197	      const scope = await scopeFor(req, res, shared);
198	      if (!scope) return;
199	      try {
200	        const deleted = await engine.delete(scope, req.params.collection as string, req.params.id as string);
201	        if (!deleted) return res.status(404).json({ error: 'Not found' });
202	        res.json({ success: true });
203	      } catch (e) {
204	        handleEngineError(res, e);
205	      }
206	    });
207	  }
208	
209	  mount('/app-data', false);
210	  mount('/app-shared', true);
211	  return r;
212	}
213	

codex
The remaining question is whether the new “behavioral suite” pointers are actually concrete and authoritative, especially for `canUseChat`, not just present as strings. I’m checking the real test estate around that row.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"app-assistant|whoami|canUseChat|POST /chat/runs|chat run\" api/tests -g '*.test.*'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/tests/llm/gateway-payload-allowlist.test.ts:297: * Empty-text-block scrub (live 2026-07-11): on multi-turn chat runs (incl. the integration-build
api/tests/auth/capabilities.test.ts:22:  'super-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
api/tests/auth/capabilities.test.ts:23:  'org-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
api/tests/auth/capabilities.test.ts:24:  user: { canBuildApps: false, canEditApps: false, canCreateArtifacts: true, canUseChat: true },
api/tests/auth/capabilities.test.ts:36:  it('a user holds exactly canUseChat + canCreateArtifacts - never the app build/edit capabilities', () => {
api/tests/auth/capabilities.test.ts:37:    expect(can({ role: 'user' }, 'canUseChat')).toBe(true);
api/tests/auth/capabilities.test.ts:71:    expect(Capability.options).toEqual(['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat']);
api/tests/auth/capabilities.test.ts:101:    { capability: 'canUseChat', file: 'routes/chat.ts', vector: 'chat run (POST /chat/runs)', behavioral: 'tests/contract/jobs-capability.test.ts + chat suites' },
api/tests/auth/capabilities.test.ts:105:    { capability: 'canEditApps', file: 'apps/app-assistant-route.ts', vector: 'served-app admin detection (whoami)', behavioral: 'tests/apps/app-assistant.test.ts (whoami fail-closed matrix over the real route)' },
api/tests/auth/capabilities.test.ts:121:    // The whoami row's structural check is the WEAKEST (the can() literal lives in the isAppEditor
api/tests/auth/capabilities.test.ts:123:    // Tighten it: the whoami HANDLER must actually invoke detectAppEditor (the code path that reaches
api/tests/auth/capabilities.test.ts:124:    // the gate); a handler returning a constant would drop this token. The behavioral whoami matrix
api/tests/auth/capabilities.test.ts:125:    // (tests/apps/app-assistant.test.ts) is the authoritative catch either way.
api/tests/auth/capabilities.test.ts:126:    if (file === 'apps/app-assistant-route.ts') {
api/tests/auth/capabilities.test.ts:127:      expect(/detectAppEditor\(/.test(src), 'whoami must call detectAppEditor (the gate path), not return a constant').toBe(true);
api/tests/auth/capabilities.test.ts:128:      expect(/admin:\s*await\s+detectAppEditor\(/.test(src), 'the whoami response `admin` must be the detectAppEditor result').toBe(true);
api/tests/auth/capabilities.test.ts:145:    // gate, else the denial is unenforceable. (canUseChat + canCreateArtifacts are user-held; their
api/tests/security/assistant-cross-org-isolation.test.ts:4: * The served-app assistant (`POST /api/app-assistant`, app-assistant-route.ts) is header-scoped and
api/tests/security/assistant-cross-org-isolation.test.ts:13: *   - Drive the assistant (runAppAssistant, the pure logic app-assistant-route.ts binds) for an app
api/tests/security/assistant-cross-org-isolation.test.ts:29:import { runAppAssistant, type AppAssistantDeps } from '../../src/apps/app-assistant.js';
api/tests/contract/schema-coverage.test.ts:74:  // G7B — agent execution: chat runs + build jobs (chat.test.ts, jobs.test.ts)
api/tests/contract/schema-coverage.test.ts:89:  // operator-run H2 — served-app assistant admin detection (app-assistant.contract.test.ts +
api/tests/contract/schema-coverage.test.ts:90:  // the whoami route matrix in tests/apps/app-assistant.test.ts). Additive endpoint: covering it
api/tests/contract/schema-coverage.test.ts:92:  'appAssistant.whoami',
api/tests/contract/schema-coverage.test.ts:107:// G7B agent-execution: 80->72 as chat runs (4) + build jobs (4) landed with their contract tests.
api/tests/agents/tools.test.ts:6:  it('a chat run allows EXACTLY the two knowledge tools + delegate_to_local — never Bash/Write/Edit', () => {
api/tests/apps/assistant-tools.test.ts:14:    const rows = (await activityLogs.find({ category: 'app-assistant' })) as ActivityLogDoc[];
api/tests/apps/assistant-tools.test.ts:18:  return (await activityLogs.find({ category: 'app-assistant' })) as ActivityLogDoc[];
api/tests/agents/orphan-sweep.test.ts:8: * Boot orphan sweep + ephemeral chat runs (ch05 §5.2.1, P-10). Acceptance criterion 2: a job
api/tests/agents/orphan-sweep.test.ts:10: * pre-crash chat run is gone from the (empty) registry, giving `GET /chat/runs/:id` 404.
api/tests/agents/orphan-sweep.test.ts:49:  it('a pre-crash chat run is absent from the registry after restart (→ 404)', () => {
api/tests/agents/orphan-sweep.test.ts:50:    // Simulate a restart: the in-memory registry is empty; a previously-live chat run id resolves
api/tests/apps/tour-player.behavior.test.ts:139:      steps: [{ id: 'img', type: 'external-image-step', image: '../../app-assistant', copy: { titlePt: 't', bodyPt: 'b' } }],
api/tests/apps/tour-player.behavior.test.ts:209:    expect(fetched.some((u) => u.includes('/api/app-assistant'))).toBe(false);
api/tests/agents/chat-lifecycle.test.ts:40:describe('chat run pipeline + streaming contract', () => {
api/tests/apps/edit-mode.test.ts:18: * Bearer - a SEPARATE plane from the visitor-blind POST /api/app-assistant.
api/tests/apps/change-request.test.ts:14: * SEPARATE plane from the visitor-blind POST /api/app-assistant, which stays untouched.
api/tests/apps/change-request.test.ts:103:    expect(MODULE_SRC).not.toContain('/api/app-assistant');
api/tests/apps/tour-player.test.ts:18: *    the network — it NEVER calls /api/app-assistant, so no model turn (no token)
api/tests/apps/tour-player.test.ts:55:  it('makes ZERO model calls during playback — it never touches /api/app-assistant', () => {
api/tests/apps/tour-player.test.ts:58:    expect(PLAYER).not.toContain('/api/app-assistant');
api/tests/apps/tour-player.test.ts:258:    for (const bad of ['../../app-assistant', '../frame.svg', '/api/app-assistant', 'http://evil/x', 'a\\b', '..']) {
api/tests/contract/app-sso.test.ts:122:describe('app-sso password auth: cookie mint, whoami, wrong password', () => {
api/tests/contract/app-sso.test.ts:136:  it('whoami returns the session identity with the cookie, and 401 without it', async () => {
api/tests/contract/app-sso.test.ts:157:  it('logout deletes the session + clears the cookie (Max-Age=0); whoami then 401', async () => {
api/tests/apps/assistant-panel.test.ts:12: * first-open copy, the three mode labels, the /api/app-assistant fetch with the
api/tests/apps/assistant-panel.test.ts:63:  it('POSTs to /api/app-assistant with the X-Ekoa-App-Id header read from window.__EKOA_APP_ID', () => {
api/tests/apps/assistant-panel.test.ts:64:    expect(PANEL).toContain('/api/app-assistant');
api/tests/apps/assistant-panel.test.ts:129:  it('calls GET /api/app-assistant/whoami exactly ONCE, on mount, with X-Ekoa-App-Id + an OPTIONAL Bearer', () => {
api/tests/apps/assistant-panel.test.ts:131:    expect(PANEL).toContain('/api/app-assistant/whoami');
api/tests/apps/assistant-panel.test.ts:132:    expect((PANEL.match(/\/api\/app-assistant\/whoami/g) || []).length).toBe(1);
api/tests/apps/assistant-panel.test.ts:135:    expect(PANEL).toContain('whoamiDoneRef');
api/tests/apps/assistant-panel.test.ts:136:    expect(PANEL).toContain('whoamiDoneRef.current = true');
api/tests/apps/assistant-panel.test.ts:167:    const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
api/tests/apps/assistant-panel.test.ts:168:    expect(whoamiEffect).toContain('setAdmin');
api/tests/apps/assistant-panel.test.ts:169:    expect(whoamiEffect).not.toContain('setEditMode');
api/tests/apps/assistant-panel.test.ts:175:  it('detection is zero-token: whoami is a non-LLM GET, never an assistant turn', () => {
api/tests/apps/assistant-panel.test.ts:215:    // The whoami DETECTION effect touches neither the switch nor the discovery state.
api/tests/apps/assistant-panel.test.ts:216:    const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
api/tests/apps/assistant-panel.test.ts:217:    expect(whoamiEffect).not.toContain('setEditMode');
api/tests/apps/assistant-panel.test.ts:218:    expect(whoamiEffect).not.toContain('openEditMode');
api/tests/apps/assistant-panel.test.ts:240:    // The served-app POST /api/app-assistant plane stays visitor-blind: the edit handlers never
api/tests/apps/assistant-panel.test.ts:244:    expect(confirmEdit).not.toContain('/api/app-assistant');
api/tests/apps/app-assistant.test.ts:15:} from '../../src/apps/app-assistant.js';
api/tests/apps/app-assistant.test.ts:16:import { appAssistantRouter, isAppEditor } from '../../src/apps/app-assistant-route.js';
api/tests/apps/app-assistant.test.ts:246: * `GET /api/app-assistant/whoami`. Detection MIRRORS the H1 follow-up-build edit gate exactly
api/tests/apps/app-assistant.test.ts:269: * operator-run H2 — the `GET /api/app-assistant/whoami` FAIL-CLOSED matrix over the REAL router,
api/tests/apps/app-assistant.test.ts:271: * verifySseToken) and REAL owner resolution. The router is wired with THROWING llm deps: whoami
api/tests/apps/app-assistant.test.ts:279:describe('GET /api/app-assistant/whoami (H2 fail-closed detection)', () => {
api/tests/apps/app-assistant.test.ts:286:  // whoami must NEVER reach these — it neither grounds, routes, nor bills.
api/tests/apps/app-assistant.test.ts:288:    oneShot: async () => { throw new Error('whoami must not call the model (visitor-blindness exception is detection-only)'); },
api/tests/apps/app-assistant.test.ts:289:    ground: () => { throw new Error('whoami must not ground'); },
api/tests/apps/app-assistant.test.ts:290:    decide: () => { throw new Error('whoami must not route'); },
api/tests/apps/app-assistant.test.ts:301:  const whoami = (headers: Record<string, string>) =>
api/tests/apps/app-assistant.test.ts:302:    fetch(`http://127.0.0.1:${port}/api/app-assistant/whoami`, { headers });
api/tests/apps/app-assistant.test.ts:304:    fetch(`http://127.0.0.1:${port}/api/app-assistant`, {
api/tests/apps/app-assistant.test.ts:318:    await connectMongo(mem.getUri(), 'ekoa_h2_whoami');
api/tests/apps/app-assistant.test.ts:361:    const res = await whoami(bearer('admin-owner'));
api/tests/apps/app-assistant.test.ts:369:    expect(await (await whoami(bearer('owner-1'))).json()).toEqual({ admin: true }); // org-shared
api/tests/apps/app-assistant.test.ts:370:    expect(await (await whoami(bearer('owner-1', PRIV_ID))).json()).toEqual({ admin: true }); // own private draft
api/tests/apps/app-assistant.test.ts:374:    const res = await whoami(bearer('super-owner'));
api/tests/apps/app-assistant.test.ts:380:    const res = await whoami(bearer('super-1'));
api/tests/apps/app-assistant.test.ts:386:    const res = await whoami(bearer('admin-owner', PRIV_ID));
api/tests/apps/app-assistant.test.ts:392:    const res = await whoami(bearer('admin-other'));
api/tests/apps/app-assistant.test.ts:398:    const res = await whoami(bearer('user-owner'));
api/tests/apps/app-assistant.test.ts:404:    const res = await whoami({ 'x-ekoa-app-id': APP_ID });
api/tests/apps/app-assistant.test.ts:410:    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
api/tests/apps/app-assistant.test.ts:423:    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${expired}` });
api/tests/apps/app-assistant.test.ts:431:    const res = await whoami(bearer('stale-admin'));
api/tests/apps/app-assistant.test.ts:438:    const wRes = await whoami(bad);
api/tests/apps/app-assistant.test.ts:447:    const res = await whoami({ 'x-ekoa-app-id': 'usr.owner-1', authorization: `Bearer ${tokens['admin-owner']}` });
api/tests/apps/app-assistant.test.ts:452:    const res = await whoami({ 'x-ekoa-app-id': 'no-such-app', authorization: `Bearer ${tokens['admin-owner']}` });
api/tests/contract/chat.test.ts:18: * Contract test for the chat runs endpoints (ch03 §3.8.7): every response validates against its
api/tests/contract/chat.test.ts:44:describe('chat runs contract (§3.8.7)', () => {
api/tests/contract/chat.test.ts:45:  it('POST /chat/runs → 202 ChatRunCreateResponse; GET → ChatRun; cancel → ChatRunCancelResponse', async () => {
api/tests/contract/app-assistant.contract.test.ts:13: * operator-run D1 — contract suite for the served-app assistant endpoint (`POST /api/app-assistant`).
api/tests/contract/app-assistant.contract.test.ts:90:    expect(d.path).toBe('/api/app-assistant');
api/tests/contract/app-assistant.contract.test.ts:119:describe('appAssistant whoami descriptor (H2)', () => {
api/tests/contract/app-assistant.contract.test.ts:121:    const d = appAssistantEndpoints.whoami;
api/tests/contract/app-assistant.contract.test.ts:123:    expect(d.path).toBe('/api/app-assistant/whoami');
api/tests/contract/app-assistant.contract.test.ts:130:    expect(ALL_ENDPOINTS.appAssistant?.whoami).toBeTruthy();
api/tests/contract/app-assistant.contract.test.ts:134:describe('app-assistant error envelope (D1, CONV-2)', () => {
api/tests/contract/served-app.test.ts:377:      'whoami:function()',
api/tests/contract/sessions.test.ts:21: *     orchestration store silently fell back to a CLIENT-LOCAL session id — chat runs then

exec
/bin/zsh -lc 'test -f api/tests/apps/app-assistant.test.ts && echo EXISTS api/tests/apps/app-assistant.test.ts; test -f api/tests/contract/jobs-capability.test.ts && echo EXISTS api/tests/contract/jobs-capability.test.ts; test -f api/tests/contract/artifacts-capability.test.ts && echo EXISTS api/tests/contract/artifacts-capability.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
EXISTS api/tests/apps/app-assistant.test.ts
EXISTS api/tests/contract/jobs-capability.test.ts
EXISTS api/tests/contract/artifacts-capability.test.ts

exec
/bin/zsh -lc "nl -ba api/tests/apps/app-assistant.test.ts | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	import { describe, it, expect, beforeAll, afterAll } from 'vitest';
     2	import type { Server } from 'node:http';
     3	import express from 'express';
     4	import jwt from 'jsonwebtoken';
     5	import type { AppAction, AppActionManifest } from '@ekoa/shared';
     6	import { AppAssistantWhoamiResponse } from '@ekoa/shared';
     7	import type { SearchHit } from '../../src/knowledge/index.js';
     8	import type { OneShotOptions, LlmAttribution, RouterDecision } from '../../src/llm/index.js';
     9	import { assistantToolsFromManifest } from '../../src/apps/assistant-tools.js';
    10	import {
    11	  runAppAssistant,
    12	  inferMode,
    13	  extractActions,
    14	  type AppAssistantDeps,
    15	} from '../../src/apps/app-assistant.js';
    16	import { appAssistantRouter, isAppEditor } from '../../src/apps/app-assistant-route.js';
    17	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
    18	import { connectMongo, closeMongo } from '../../src/data/mongo.js';
    19	import { users, artifacts } from '../../src/data/stores.js';
    20	import { setActivation, bumpTokenEpoch, __resetActivationForTests } from '../../src/data/activation.js';
    21	import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
    22	import { login } from '../../src/auth/service.js';
    23	import { hashPassword } from '../../src/auth/password.js';
    24	import { loadConfig, __resetConfigForTests } from '../../src/config.js';
    25	
    26	/**
    27	 * operator-run D1 — the served-app assistant pure logic, over an INJECTED one-shot (no real model),
    28	 * an injected grounding builder, and an injected routing decision. Asserts: mode inference; grounding
    29	 * hits become citations; the ```ekoa-actions``` block is parsed, validated against the manifest, and
    30	 * stripped from the reply; unknown tool names are dropped; and the grounding org comes from the
    31	 * resolved OWNER, never a caller-supplied value.
    32	 */
    33	
    34	const manifest: AppActionManifest = {
    35	  version: 1,
    36	  actions: [
    37	    { id: 'ir-clientes', kind: 'navigate', labelPt: 'Ver clientes', description: 'Abre a lista de clientes', route: '/clientes', params: [], destructive: false },
    38	    {
    39	      id: 'criar-cliente', kind: 'custom', labelPt: 'Criar cliente', description: 'Cria um novo cliente',
    40	      params: [{ name: 'nome', type: 'string', required: true }], destructive: false,
    41	    },
    42	  ],
    43	};
    44	
    45	const DECISION: RouterDecision = { tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 };
    46	const OWNER = { userId: 'owner-1', orgId: 'org-owner' };
    47	
    48	/** The server-resolved manifest AppAction D1 attaches to each proposed action. */
    49	const actionById = (id: string): AppAction => manifest.actions.find((a) => a.id === id)!;
    50	/** toolName -> manifest AppAction, as runAppAssistant / extractActions consume it. */
    51	const toolMap = new Map(assistantToolsFromManifest(manifest).map((t) => [t.name, t.action] as const));
    52	
    53	interface Captured {
    54	  opts?: OneShotOptions;
    55	  attribution?: LlmAttribution;
    56	  groundInput?: { orgId: string; query: string; kind: string };
    57	}
    58	
    59	/** Deps whose one-shot returns `oneShotText` verbatim and whose grounding returns `hits`. */
    60	function makeDeps(oneShotText: string, hits: SearchHit[] = [], captured: Captured = {}): AppAssistantDeps {
    61	  return {
    62	    oneShot: async (opts, attribution) => {
    63	      captured.opts = opts;
    64	      captured.attribution = attribution;
    65	      return { text: oneShotText, usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
    66	    },
    67	    ground: (input) => {
    68	      captured.groundInput = input;
    69	      return { block: hits.length ? 'CONHECIMENTO (excertos):\n[1] col / titulo (doc d1)' : '', hits };
    70	    },
    71	    decide: () => DECISION,
    72	  };
    73	}
    74	
    75	function hit(over: Partial<SearchHit> = {}): SearchHit {
    76	  return { docId: 'd1', collection: 'faq', title: 'Como criar cliente', snippet: 'passo 1...', score: 1, scope: 'org', ...over };
    77	}
    78	
    79	describe('inferMode (D1 deterministic PT-PT classifier)', () => {
    80	  it('teach cues -> teach', () => {
    81	    expect(inferMode('Faz um tutorial da aplicação')).toBe('teach');
    82	    expect(inferMode('Explica como funciona o registo')).toBe('teach');
    83	    expect(inferMode('Ensina-me a usar isto passo a passo')).toBe('teach');
    84	  });
    85	  it('show cues -> show (accent-insensitive)', () => {
    86	    expect(inferMode('Mostra-me o painel')).toBe('show');
    87	    expect(inferMode('Dá-me uma visão geral')).toBe('show');
    88	    expect(inferMode('Faz um resumo geral')).toBe('show');
    89	  });
    90	  it('teach wins over show ("mostra-me como criar")', () => {
    91	    expect(inferMode('Mostra-me como criar um cliente')).toBe('teach');
    92	  });
    93	  it('imperative task verbs and anything else default to do', () => {
    94	    expect(inferMode('Cria um cliente chamado Ana')).toBe('do');
    95	    expect(inferMode('Adiciona uma nota ao processo')).toBe('do');
    96	    expect(inferMode('Olá')).toBe('do');
    97	  });
    98	});
    99	
   100	describe('extractActions (D1 fenced-block parser)', () => {
   101	  it('parses an actions block, attaches the resolved AppAction, and strips it from the prose', () => {
   102	    const reply = [
   103	      'Vou criar o cliente para si.',
   104	      '```ekoa-actions',
   105	      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}}]',
   106	      '```',
   107	      'Feito.',
   108	    ].join('\n');
   109	    const { text, actions } = extractActions(reply, toolMap);
   110	    expect(actions).toEqual([
   111	      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
   112	    ]);
   113	    expect(text).toContain('Vou criar o cliente');
   114	    expect(text).toContain('Feito.');
   115	    expect(text).not.toContain('ekoa-actions');
   116	    expect(text).not.toContain('app_action__');
   117	  });
   118	
   119	  it('drops unknown tool names but keeps + resolves known ones', () => {
   120	    const reply = [
   121	      '```ekoa-actions',
   122	      '[{"toolName":"app_action__inexistente","input":{}},{"toolName":"app_action__ir_clientes","input":{}}]',
   123	      '```',
   124	    ].join('\n');
   125	    const { actions } = extractActions(reply, toolMap);
   126	    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
   127	  });
   128	
   129	  it('drops UNDECLARED param keys from the model input (fenced path honours the tool schema)', () => {
   130	    // codex-d2 #1: `custom` action params reach app code verbatim, so the fenced path
   131	    // must enforce the same additionalProperties:false contract the SDK tool schema does.
   132	    const reply = [
   133	      '```ekoa-actions',
   134	      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana","__proto__x":"pwn","cmd":"rm -rf"}}]',
   135	      '```',
   136	    ].join('\n');
   137	    const { actions } = extractActions(reply, toolMap);
   138	    expect(actions).toHaveLength(1);
   139	    expect(actions[0]!.input).toEqual({ nome: 'Ana' }); // declared param kept, undeclared dropped
   140	  });
   141	
   142	  it('a malformed block yields no actions and is still stripped', () => {
   143	    const reply = 'Olá\n```ekoa-actions\nnão é json\n```\ntchau';
   144	    const { text, actions } = extractActions(reply, toolMap);
   145	    expect(actions).toEqual([]);
   146	    expect(text).not.toContain('ekoa-actions');
   147	    expect(text).toContain('Olá');
   148	    expect(text).toContain('tchau');
   149	  });
   150	
   151	  it('non-object input defaults to {}', () => {
   152	    const reply = '```ekoa-actions\n[{"toolName":"app_action__ir_clientes","input":"oops"}]\n```';
   153	    const { actions } = extractActions(reply, toolMap);
   154	    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
   155	  });
   156	});
   157	
   158	describe('runAppAssistant (D1)', () => {
   159	  it('infers the mode when not pinned and echoes it back', async () => {
   160	    const deps = makeDeps('Aqui está uma visão geral.');
   161	    const res = await runAppAssistant(
   162	      { message: 'Mostra-me a aplicação', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
   163	      deps,
   164	    );
   165	    expect(res.mode).toBe('show');
   166	  });
   167	
   168	  it('honours a client-pinned mode over inference', async () => {
   169	    const deps = makeDeps('ok');
   170	    const res = await runAppAssistant(
   171	      { message: 'Mostra-me a aplicação', mode: 'do', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
   172	      deps,
   173	    );
   174	    expect(res.mode).toBe('do');
   175	  });
   176	
   177	  it('turns grounding hits into citations (collection/docId/title)', async () => {
   178	    const hits = [hit(), hit({ docId: 'd2', collection: 'guias', title: 'Guia', scope: 'shared' })];
   179	    const deps = makeDeps('Resposta com fonte.', hits);
   180	    const res = await runAppAssistant(
   181	      { message: 'Como crio um cliente?', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
   182	      deps,
   183	    );
   184	    expect(res.citations).toEqual([
   185	      { collection: 'faq', docId: 'd1', title: 'Como criar cliente' },
   186	      { collection: 'guias', docId: 'd2', title: 'Guia' },
   187	    ]);
   188	  });
   189	
   190	  it('parses + validates the actions block and strips it from the reply', async () => {
   191	    const oneShotText = [
   192	      'Vou tratar disso.',
   193	      '```ekoa-actions',
   194	      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}},{"toolName":"app_action__desconhecida","input":{}}]',
   195	      '```',
   196	    ].join('\n');
   197	    const deps = makeDeps(oneShotText);
   198	    const res = await runAppAssistant(
   199	      { message: 'Cria a cliente Ana', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
   200	      deps,
   201	    );
   202	    expect(res.actions).toEqual([
   203	      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
   204	    ]); // unknown dropped, resolved AppAction attached
   205	    expect(res.reply).toBe('Vou tratar disso.');
   206	    expect(res.reply).not.toContain('ekoa-actions');
   207	  });
   208	
   209	  it('an app with no manifest has no operate surface (all requested actions dropped)', async () => {
   210	    const oneShotText = '```ekoa-actions\n[{"toolName":"app_action__criar_cliente","input":{}}]\n```texto';
   211	    const deps = makeDeps(oneShotText);
   212	    const res = await runAppAssistant(
   213	      { message: 'Cria algo', owner: OWNER, artifactId: 'art-1', actionManifest: null },
   214	      deps,
   215	    );
   216	    expect(res.actions).toEqual([]);
   217	    expect(res.reply).toBe('texto');
   218	  });
   219	
   220	  it('grounds under the OWNER org and bills the OWNER — never a caller-supplied value', async () => {
   221	    const captured: Captured = {};
   222	    const deps = makeDeps('ok', [], captured);
   223	    await runAppAssistant(
   224	      {
   225	        message: 'Olá',
   226	        // A caller trying to steer the org via context must be ignored — the org comes from owner.
   227	        context: { route: '/x', actionResults: [{ orgId: 'attacker-org' }] },
   228	        owner: OWNER,
   229	        artifactId: 'art-99',
   230	        actionManifest: manifest,
   231	      },
   232	      deps,
   233	    );
   234	    expect(captured.groundInput).toEqual({ orgId: 'org-owner', query: 'Olá', kind: 'chat' });
   235	    expect(captured.attribution).toEqual({
   236	      kind: 'user_work',
   237	      agentType: 'assistant-chat',
   238	      billeeUserId: 'owner-1',
   239	      artifactId: 'art-99',
   240	    });
   241	  });
   242	});
   243	
   244	/**
   245	 * operator-run H2 — the admin-detection DECISION (`isAppEditor`), the PURE core of
   246	 * `GET /api/app-assistant/whoami`. Detection MIRRORS the H1 follow-up-build edit gate exactly
   247	 * (codex-h2): H1's `can('canEditApps')` capability gate AND the artifact-writability verdict
   248	 * loadWritable produces (own always; org-shared within the org ok; another user's private / a
   249	 * cross-org / missing artifact → not-ok). So `admin:true` ⟺ this caller can ACTUALLY edit this app
   250	 * (no false offer, no owner-org membership oracle). The verdict is computed by loadWritable in the
   251	 * route (exercised by the matrix below); this unit pins the pure combine.
   252	 */
   253	describe('isAppEditor (H2 detection decision — mirrors the H1 edit gate)', () => {
   254	  it('an app-edit-capable caller with a WRITABLE artifact is an editor', () => {
   255	    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'ok')).toBe(true);
   256	    expect(isAppEditor({ role: 'super-admin', orgId: 'org-any' }, 'ok')).toBe(true);
   257	  });
   258	  it('a NOT-writable artifact (forbidden/notfound) is never editable, even for an admin (fail-closed: closes the empty-owner-org + oracle findings)', () => {
   259	    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'forbidden')).toBe(false);
   260	    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'notfound')).toBe(false);

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/tests/contract/chat.test.ts | sed -n '1,180p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	import { describe, it, expect, beforeAll, afterAll } from 'vitest';
     2	import express from 'express';
     3	import type { Server } from 'node:http';
     4	import { ChatRunCreateResponse, ChatRun, ChatRunCancelResponse, ErrorEnvelope } from '@ekoa/shared';
     5	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
     6	import { connectMongo, closeMongo } from '../../src/data/mongo.js';
     7	import { users, userSettings } from '../../src/data/stores.js';
     8	import { setActivation } from '../../src/data/activation.js';
     9	import { login } from '../../src/auth/service.js';
    10	import { hashPassword } from '../../src/auth/password.js';
    11	import { __resetConfigForTests, loadConfig } from '../../src/config.js';
    12	import { setCredential } from '../../src/llm/credentials.js';
    13	import { __setTransportForTests } from '../../src/llm/client.js';
    14	import { chatRouter } from '../../src/routes/chat.js';
    15	import { makeFakeTransport } from '../agents/_fake-transport.js';
    16	
    17	/**
    18	 * Contract test for the chat runs endpoints (ch03 §3.8.7): every response validates against its
    19	 * `shared/` schema (ch13 §13.5). The chat router is mounted on a bare app (server.ts wiring is
    20	 * the lead's) with the fake transport, so creation runs LLM-free.
    21	 */
    22	let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
    23	const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
    24	const api = (p: string, t: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
    25	
    26	beforeAll(async () => {
    27	  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
    28	  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_contract_chat');
    29	  await setCredential({ mode: 'oauth', secret: 'tok' });
    30	  __setTransportForTests(makeFakeTransport({ finalText: 'answer' }));
    31	  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o1', active: true });
    32	  setActivation('u1', { active: true, billingLocked: false });
    33	  await userSettings.put({ _id: 'u1', memory: { autoExtract: false } }); // keep the test LLM-call-free
    34	  const app = express();
    35	  app.use(express.json());
    36	  app.use('/api/v1/chat', chatRouter(deps));
    37	  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    38	  port = (server.address() as { port: number }).port;
    39	}, 60_000);
    40	afterAll(async () => { await new Promise((r) => setTimeout(r, 300)); server.close(); await closeMongo(); await mem.stop(); });
    41	
    42	const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;
    43	
    44	describe('chat runs contract (§3.8.7)', () => {
    45	  it('POST /chat/runs → 202 ChatRunCreateResponse; GET → ChatRun; cancel → ChatRunCancelResponse', async () => {
    46	    const t = await tokenFor();
    47	    const created = await api('/api/v1/chat/runs', t, { method: 'POST', body: JSON.stringify({ sessionId: 's1', message: 'hi', language: 'pt' }) });
    48	    expect(created.status).toBe(202);
    49	    const createBody = await created.json();
    50	    expect(ChatRunCreateResponse.safeParse(createBody).success).toBe(true);
    51	    const runId = (createBody as { runId: string }).runId;
    52	
    53	    const got = await api(`/api/v1/chat/runs/${runId}`, t);
    54	    expect(got.status).toBe(200);
    55	    expect(ChatRun.safeParse(await got.json()).success).toBe(true);
    56	
    57	    const cancelled = await api(`/api/v1/chat/runs/${runId}/cancel`, t, { method: 'POST' });
    58	    expect(ChatRunCancelResponse.safeParse(await cancelled.json()).success).toBe(true);
    59	  });
    60	
    61	  it('GET an unknown run → 404 error envelope', async () => {
    62	    const t = await tokenFor();
    63	    const res = await api('/api/v1/chat/runs/does-not-exist', t);
    64	    expect(res.status).toBe(404);
    65	    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    66	  });
    67	
    68	  it('GET events with no token → 401 error envelope (CONV-1)', async () => {
    69	    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/runs/x/events`);
    70	    expect(res.status).toBe(401);
    71	    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    72	  });
    73	});

exec
/bin/zsh -lc "nl -ba api/tests/apps/app-assistant.test.ts | sed -n '244,460p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   244	/**
   245	 * operator-run H2 — the admin-detection DECISION (`isAppEditor`), the PURE core of
   246	 * `GET /api/app-assistant/whoami`. Detection MIRRORS the H1 follow-up-build edit gate exactly
   247	 * (codex-h2): H1's `can('canEditApps')` capability gate AND the artifact-writability verdict
   248	 * loadWritable produces (own always; org-shared within the org ok; another user's private / a
   249	 * cross-org / missing artifact → not-ok). So `admin:true` ⟺ this caller can ACTUALLY edit this app
   250	 * (no false offer, no owner-org membership oracle). The verdict is computed by loadWritable in the
   251	 * route (exercised by the matrix below); this unit pins the pure combine.
   252	 */
   253	describe('isAppEditor (H2 detection decision — mirrors the H1 edit gate)', () => {
   254	  it('an app-edit-capable caller with a WRITABLE artifact is an editor', () => {
   255	    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'ok')).toBe(true);
   256	    expect(isAppEditor({ role: 'super-admin', orgId: 'org-any' }, 'ok')).toBe(true);
   257	  });
   258	  it('a NOT-writable artifact (forbidden/notfound) is never editable, even for an admin (fail-closed: closes the empty-owner-org + oracle findings)', () => {
   259	    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'forbidden')).toBe(false);
   260	    expect(isAppEditor({ role: 'org-admin', orgId: 'org-owner' }, 'notfound')).toBe(false);
   261	    expect(isAppEditor({ role: 'super-admin', orgId: 'org-any' }, 'notfound')).toBe(false);
   262	  });
   263	  it('a plain user is never an editor (H1 capability gate denies canEditApps), even on a writable artifact', () => {
   264	    expect(isAppEditor({ role: 'user', orgId: 'org-owner' }, 'ok')).toBe(false);
   265	  });
   266	});
   267	
   268	/**
   269	 * operator-run H2 — the `GET /api/app-assistant/whoami` FAIL-CLOSED matrix over the REAL router,
   270	 * the REAL verification chain (verifyToken + jti + isRevoked + activation-active + tokenEpoch, via
   271	 * verifySseToken) and REAL owner resolution. The router is wired with THROWING llm deps: whoami
   272	 * must never ground/route/bill, so any accidental model touch would blow the request up (it does
   273	 * not — every case returns 200). Binding invariants asserted here:
   274	 *   - admin:true ONLY for an org-admin/super-admin of the OWNER org WITH canEditApps.
   275	 *   - EVERYTHING else -> 200 { admin:false }: no token, invalid, expired, epoch-stale, user role,
   276	 *     wrong-org admin. NEVER a 4xx on a bad/missing token (a 401/403 would be an oracle).
   277	 *   - the ONLY non-200 is a malformed X-Ekoa-App-Id (the SAME 400 POST gives) / unknown app (404).
   278	 */
   279	describe('GET /api/app-assistant/whoami (H2 fail-closed detection)', () => {
   280	  let mem: MongoMemoryServer;
   281	  let server: Server;
   282	  let port: number;
   283	  let seq = 0;
   284	  const loginDeps = { now: () => 1_700_000_000_000 + seq++, genId: () => `jti_${seq++}` };
   285	
   286	  // whoami must NEVER reach these — it neither grounds, routes, nor bills.
   287	  const throwingDeps: AppAssistantDeps = {
   288	    oneShot: async () => { throw new Error('whoami must not call the model (visitor-blindness exception is detection-only)'); },
   289	    ground: () => { throw new Error('whoami must not ground'); },
   290	    decide: () => { throw new Error('whoami must not route'); },
   291	  };
   292	
   293	  const APP_ID = 'app-h2'; // ORG-SHARED, owned by owner-1 (org-owner)
   294	  const PRIV_ID = 'app-h2-priv'; // PRIVATE draft, owned by owner-1 (org-owner)
   295	  const tokens: Record<string, string> = {};
   296	
   297	  async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
   298	    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
   299	    setActivation(id, { active: true, billingLocked: false });
   300	  }
   301	  const whoami = (headers: Record<string, string>) =>
   302	    fetch(`http://127.0.0.1:${port}/api/app-assistant/whoami`, { headers });
   303	  const postAssistant = (headers: Record<string, string>) =>
   304	    fetch(`http://127.0.0.1:${port}/api/app-assistant`, {
   305	      method: 'POST',
   306	      headers: { 'content-type': 'application/json', ...headers },
   307	      body: JSON.stringify({ message: 'olá' }),
   308	    });
   309	
   310	  beforeAll(async () => {
   311	    process.env.ENCRYPTION_KEY = 'k';
   312	    process.env.JWT_SECRET = 's';
   313	    __resetConfigForTests();
   314	    loadConfig();
   315	    __resetActivationForTests();
   316	    __resetRevocationsForTests();
   317	    mem = await createMem();
   318	    await connectMongo(mem.getUri(), 'ekoa_h2_whoami');
   319	
   320	    // The app + its owner (org-owner). APP_ID is ORG-SHARED (visibility:'org') - the org's real
   321	    // app that org-admins manage; loadWritable grants own-org admins write on it. PRIV_ID is a
   322	    // PRIVATE draft of the same owner - only the owner can edit it (loadWritable forbids even a
   323	    // same-org admin), which proves detection mirrors the H1 gate and is not an existence oracle.
   324	    await mkUser('owner-1', 'org-owner', 'org-admin');
   325	    await artifacts.insert({ _id: APP_ID, name: 'H2', userId: 'owner-1', orgId: 'org-owner', visibility: 'org' } as never);
   326	    await artifacts.insert({ _id: PRIV_ID, name: 'H2priv', userId: 'owner-1', orgId: 'org-owner', visibility: 'private' } as never);
   327	
   328	    // Callers.
   329	    await mkUser('admin-owner', 'org-owner', 'org-admin'); // a DIFFERENT admin in the owner org
   330	    await mkUser('super-1', 'org-other', 'super-admin'); // super-admin in a DIFFERENT org (org-scoped edit → not this app)
   331	    await mkUser('super-owner', 'org-owner', 'super-admin'); // super-admin IN the owner org
   332	    await mkUser('admin-other', 'org-other', 'org-admin'); // org-admin of the WRONG org
   333	    await mkUser('user-owner', 'org-owner', 'user'); // owner-org member without canEditApps
   334	    await mkUser('stale-admin', 'org-owner', 'org-admin'); // owner-org admin, token then epoch-staled
   335	
   336	    for (const u of ['owner-1', 'admin-owner', 'super-1', 'super-owner', 'admin-other', 'user-owner', 'stale-admin']) {
   337	      tokens[u] = (await login(u, 'pw123456', false, loginDeps)).token;
   338	    }
   339	    // Epoch-stale: bump stale-admin's epoch far past its freshly-minted token's iat, so the SAME
   340	    // (otherwise-admin) token is now stale — proving the tokenEpoch leg of the chain rejects it.
   341	    bumpTokenEpoch('stale-admin', Math.floor(Date.now() / 1000) + 100_000);
   342	
   343	    const app = express();
   344	    app.use(express.json());
   345	    app.use('/api', appAssistantRouter(throwingDeps));
   346	    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
   347	    port = (server.address() as { port: number }).port;
   348	  }, 60_000);
   349	
   350	  afterAll(async () => {
   351	    server?.close();
   352	    await closeMongo();
   353	    await mem?.stop();
   354	    __resetActivationForTests();
   355	    __resetRevocationsForTests();
   356	  });
   357	
   358	  const bearer = (u: string, appId: string = APP_ID) => ({ 'x-ekoa-app-id': appId, authorization: `Bearer ${tokens[u]}` });
   359	
   360	  it('an org-admin of the OWNER org, on the ORG-SHARED app -> 200 { admin:true } (loadWritable ok)', async () => {
   361	    const res = await whoami(bearer('admin-owner'));
   362	    expect(res.status).toBe(200);
   363	    const body = await res.json();
   364	    expect(AppAssistantWhoamiResponse.safeParse(body).success).toBe(true);
   365	    expect(body).toEqual({ admin: true });
   366	  });
   367	
   368	  it('the artifact owner -> 200 { admin:true } (own artifact, any visibility)', async () => {
   369	    expect(await (await whoami(bearer('owner-1'))).json()).toEqual({ admin: true }); // org-shared
   370	    expect(await (await whoami(bearer('owner-1', PRIV_ID))).json()).toEqual({ admin: true }); // own private draft
   371	  });
   372	
   373	  it('a super-admin IN the owner org, on the org-shared app -> 200 { admin:true }', async () => {
   374	    const res = await whoami(bearer('super-owner'));
   375	    expect(res.status).toBe(200);
   376	    expect(await res.json()).toEqual({ admin: true });
   377	  });
   378	
   379	  it('a super-admin in ANOTHER org -> 200 { admin:false } (app-edit is org-scoped, mirrors the H1 gate; cross-org loadWritable is notfound)', async () => {
   380	    const res = await whoami(bearer('super-1'));
   381	    expect(res.status).toBe(200);
   382	    expect(await res.json()).toEqual({ admin: false });
   383	  });
   384	
   385	  it('an org-admin of the owner org, on another member PRIVATE draft -> 200 { admin:false } (loadWritable forbids; closes the in-org private-app existence oracle)', async () => {
   386	    const res = await whoami(bearer('admin-owner', PRIV_ID));
   387	    expect(res.status).toBe(200);
   388	    expect(await res.json()).toEqual({ admin: false });
   389	  });
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
   403	  it('NO token -> 200 { admin:false } (never a 401 — token absence is not an oracle)', async () => {
   404	    const res = await whoami({ 'x-ekoa-app-id': APP_ID });
   405	    expect(res.status).toBe(200);
   406	    expect(await res.json()).toEqual({ admin: false });
   407	  });
   408	
   409	  it('an INVALID token -> 200 { admin:false } (never a 401)', async () => {
   410	    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
   411	    expect(res.status).toBe(200);
   412	    expect(await res.json()).toEqual({ admin: false });
   413	  });
   414	
   415	  it('an EXPIRED token (would-be admin) -> 200 { admin:false }', async () => {
   416	    // A structurally-admin token (org-admin of the owner org) but already expired: the verify
   417	    // chain rejects it at verifyToken, so detection is false — expiry alone denies.
   418	    const expired = jwt.sign(
   419	      { sub: 'owner-1', role: 'org-admin', scope: 'user', orgId: 'org-owner', username: 'owner-1', jti: 'expired.1' },
   420	      's',
   421	      { expiresIn: -10 },
   422	    );
   423	    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${expired}` });
   424	    expect(res.status).toBe(200);
   425	    expect(await res.json()).toEqual({ admin: false });
   426	  });
   427	
   428	  it('an EPOCH-STALE token (would-be admin) -> 200 { admin:false }', async () => {
   429	    // stale-admin is an org-admin of the owner org; its token predates the epoch bump, so the
   430	    // tokenEpoch leg of the chain rejects it — a demoted/rotated session cannot detect as admin.
   431	    const res = await whoami(bearer('stale-admin'));
   432	    expect(res.status).toBe(200);
   433	    expect(await res.json()).toEqual({ admin: false });
   434	  });
   435	
   436	  it('a malformed X-Ekoa-App-Id -> 400 — the SAME status POST gives (charset check reused)', async () => {
   437	    const bad = { 'x-ekoa-app-id': 'bad app!', authorization: `Bearer ${tokens['admin-owner']}` };
   438	    const wRes = await whoami(bad);
   439	    const pRes = await postAssistant(bad);
   440	    expect(wRes.status).toBe(400);
   441	    expect(pRes.status).toBe(400); // POST rejects the same header identically
   442	    const wBody = (await wRes.json()) as { error: { code: string } };
   443	    expect(wBody.error.code).toBe('VALIDATION_FAILED');
   444	  });
   445	
   446	  it('the reserved usr. prefix on X-Ekoa-App-Id -> 400 (same as POST)', async () => {
   447	    const res = await whoami({ 'x-ekoa-app-id': 'usr.owner-1', authorization: `Bearer ${tokens['admin-owner']}` });
   448	    expect(res.status).toBe(400);
   449	  });
   450	
   451	  it('an unknown app id -> 404 { NOT_FOUND } (the SAME existence surface POST already exposes)', async () => {
   452	    const res = await whoami({ 'x-ekoa-app-id': 'no-such-app', authorization: `Bearer ${tokens['admin-owner']}` });
   453	    expect(res.status).toBe(404);
   454	    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
   455	  });
   456	});

exec
/bin/zsh -lc "rg -n \"canUseChat|FORBIDDEN|details.capability|chat\" api/tests/contract/chat.test.ts api/tests -g '*.test.*'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/tests/contract/chat.test.ts:14:import { chatRouter } from '../../src/routes/chat.js';
api/tests/contract/chat.test.ts:18: * Contract test for the chat runs endpoints (ch03 §3.8.7): every response validates against its
api/tests/contract/chat.test.ts:19: * `shared/` schema (ch13 §13.5). The chat router is mounted on a bare app (server.ts wiring is
api/tests/contract/chat.test.ts:28:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_contract_chat');
api/tests/contract/chat.test.ts:36:  app.use('/api/v1/chat', chatRouter(deps));
api/tests/contract/chat.test.ts:44:describe('chat runs contract (§3.8.7)', () => {
api/tests/contract/chat.test.ts:45:  it('POST /chat/runs → 202 ChatRunCreateResponse; GET → ChatRun; cancel → ChatRunCancelResponse', async () => {
api/tests/contract/chat.test.ts:47:    const created = await api('/api/v1/chat/runs', t, { method: 'POST', body: JSON.stringify({ sessionId: 's1', message: 'hi', language: 'pt' }) });
api/tests/contract/chat.test.ts:53:    const got = await api(`/api/v1/chat/runs/${runId}`, t);
api/tests/contract/chat.test.ts:57:    const cancelled = await api(`/api/v1/chat/runs/${runId}/cancel`, t, { method: 'POST' });
api/tests/contract/chat.test.ts:63:    const res = await api('/api/v1/chat/runs/does-not-exist', t);
api/tests/contract/chat.test.ts:69:    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/runs/x/events`);
api/tests/fake-daemon/adversarial.test.ts:134:describe('S3 — no arbitrary-command primitive on the chat delegation path (§18.5 S3, §18.8 crit 2)', () => {
api/tests/fake-daemon/adversarial.test.ts:138:    // which a chat delegation could run an arbitrary command (no exec/command/shell/spawn/local_command).
api/tests/billing/usage-push.test.ts:30:  agentType: 'chat',
api/tests/migration/parity-workload.test.ts:54:  it('is the fixed 10 chat / 4 build / 4 automation / 2 integration-builder / 4 gateway suite', () => {
api/tests/billing/arithmetic.test.ts:33:  billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST',
api/tests/knowledge/build-knowledge-ingest.test.ts:92:  it('refuses the reserved _shared partition (FORBIDDEN 403 via the service guard)', async () => {
api/tests/knowledge/build-knowledge-ingest.test.ts:95:    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
api/tests/knowledge/grounding.test.ts:39:  it('chat: returns a cited block when the org partition has a relevant doc', () => {
api/tests/knowledge/grounding.test.ts:41:    const { block, hits } = buildGroundingBlock({ orgId: 'orgA', query: 'qual o prazo de recurso', kind: 'chat' });
api/tests/knowledge/grounding.test.ts:47:  it('chat: stays silent (empty string) when nothing is relevant', () => {
api/tests/knowledge/grounding.test.ts:49:    const { block, hits } = buildGroundingBlock({ orgId: 'orgA', query: 'receitas de bolo de chocolate', kind: 'chat' });
api/tests/knowledge/grounding.test.ts:54:  it('chat: stays silent when the org partition is empty (no hallucinated filler)', () => {
api/tests/knowledge/grounding.test.ts:55:    const { block } = buildGroundingBlock({ orgId: 'orgEmpty', query: 'prazo de recurso', kind: 'chat' });
api/tests/knowledge/grounding.test.ts:78:    const { block } = buildGroundingBlock({ orgId: 'orgB', query: 'prazo de recurso', kind: 'chat' });
api/tests/knowledge/grounding.test.ts:84:  it('a normal org chat surfaces shared-corpus hits it does not own', () => {
api/tests/knowledge/grounding.test.ts:86:    const { block, hits } = buildGroundingBlock({ orgId: 'orgSemNada', query: 'qual o prazo de recurso', kind: 'chat' });
api/tests/knowledge/service.test.ts:111:describe('shared partition is write-protected online (FORBIDDEN 403)', () => {
api/tests/knowledge/service.test.ts:115:    await expect(fn()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
api/tests/content/loader.test.ts:40:  agents: Array<'coding' | 'chat' | 'automation'>;
api/tests/content/loader.test.ts:176:    writePackage(baselineDir, { name: 'chat-base', agents: ['chat'], mode: 'eager', files: { 'SKILL.md': skill('chat') } });
api/tests/content/loader.test.ts:183:    const chat = await loader.composeContext('u1', 'chat');
api/tests/content/loader.test.ts:184:    expect(chat.eagerFiles.some((f) => f.includes('coding-base'))).toBe(false);
api/tests/content/loader.test.ts:185:    expect(chat.eagerFiles.map((f) => f.split('/').slice(-2).join('/'))).toEqual(['chat-base/SKILL.md']);
api/tests/content/loader.test.ts:243:    // A task package the base coding selection would NOT include (declared for chat).
api/tests/content/loader.test.ts:244:    writePackage(baselineDir, { name: 'task-pack', agents: ['chat'], mode: 'on-demand', files: { 'TASK.md': skill('task') } });
api/tests/content/loader.test.ts:327:      const chat = await l.composeContext('u1', 'chat');
api/tests/content/loader.test.ts:333:      expect(names(coding.eagerFiles)).not.toContain('chat-agent');
api/tests/content/loader.test.ts:338:      expect(names(chat.eagerFiles)).toEqual(['chat-agent']);
api/tests/content/loader.test.ts:339:      expect(names(chat.onDemandFiles)).not.toContain('legal-spine');
api/tests/content/loader.test.ts:344:    it('the integration-builder kind composes ONLY its own package (not chat/coding/automation)', async () => {
api/tests/content/loader.test.ts:350:      for (const kind of ['chat', 'coding', 'automation'] as const) {
api/tests/content/loader.test.ts:358:      const ctx = await l.assembleAgentContext({ agentKind: 'chat', userId: 'u1' });
api/tests/content/loader.test.ts:370:      const BUDGET_CHARS = { chat: 8_000, coding: 14_000, automation: 3_500 } as const;
api/tests/content/loader.test.ts:372:      for (const kind of ['chat', 'coding', 'automation'] as const) {
api/tests/content/loader.test.ts:379:    it('the composed chat content carries the marker vocabulary the pipeline strips (drift guard)', async () => {
api/tests/content/loader.test.ts:380:      // The chat content teaches the EXACT markers agents/markers.ts matches; if the content
api/tests/content/loader.test.ts:383:      const ctx = await l.assembleAgentContext({ agentKind: 'chat', userId: 'u1' });
api/tests/apps/change-request.test.ts:92:    const s = scenario({ status: 403, data: { error: { code: 'FORBIDDEN', message: 'x' } } });
api/tests/agents/chat-thinking.test.ts:4:import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
api/tests/agents/chat-thinking.test.ts:11: * The chat thinking channel (§5.7 + ch12 white-label). Working commentary — intermediate-turn
api/tests/agents/chat-thinking.test.ts:35:const chatEventsFor = (runId: string) => events.filter((e) => e.stream === 'chat' && e.streamId === runId);
api/tests/agents/chat-thinking.test.ts:40:describe('chat thinking channel (§5.7 + ch12 white-label)', () => {
api/tests/agents/chat-thinking.test.ts:41:  beforeAll(() => bootAgentTestDb('ekoa_chat_thinking'));
api/tests/agents/chat-thinking.test.ts:56:    const evs = chatEventsFor(runId);
api/tests/agents/chat-thinking.test.ts:85:    expect(chatEventsFor(runId).some((e) => e.type === 'thinking_chunk')).toBe(false);
api/tests/agents/chat-thinking.test.ts:100:    const evs = chatEventsFor(runId);
api/tests/agents/chat-thinking.test.ts:127:    const evs = chatEventsFor(runId);
api/tests/agents/integration-builder-parser.test.ts:37:    const r = parseIntegrationOutput('Just chatting, no blocks yet.');
api/tests/automation/service.test.ts:87:    await expect(svc.createAutomation(builder, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
api/tests/automation/service.test.ts:101:    await expect(svc.patchAutomation(builder, a.id, { name: 'hijack' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
api/tests/automation/service.test.ts:113:  it('planFromGoal requires creation authority: a builder without the org setting is FORBIDDEN (§3.8.18 landmine-9 gate)', async () => {
api/tests/automation/service.test.ts:172:    await expect(svc.startRun(builder, a.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
api/tests/apps/app-assistant.test.ts:234:    expect(captured.groundInput).toEqual({ orgId: 'org-owner', query: 'Olá', kind: 'chat' });
api/tests/apps/app-assistant.test.ts:237:      agentType: 'assistant-chat',
api/tests/auth/capabilities.test.ts:22:  'super-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
api/tests/auth/capabilities.test.ts:23:  'org-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
api/tests/auth/capabilities.test.ts:24:  user: { canBuildApps: false, canEditApps: false, canCreateArtifacts: true, canUseChat: true },
api/tests/auth/capabilities.test.ts:36:  it('a user holds exactly canUseChat + canCreateArtifacts - never the app build/edit capabilities', () => {
api/tests/auth/capabilities.test.ts:37:    expect(can({ role: 'user' }, 'canUseChat')).toBe(true);
api/tests/auth/capabilities.test.ts:71:    expect(Capability.options).toEqual(['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat']);
api/tests/auth/capabilities.test.ts:101:    { capability: 'canUseChat', file: 'routes/chat.ts', vector: 'chat run (POST /chat/runs)', behavioral: 'tests/contract/jobs-capability.test.ts + chat suites' },
api/tests/auth/capabilities.test.ts:145:    // gate, else the denial is unenforceable. (canUseChat + canCreateArtifacts are user-held; their
api/tests/agents/chat-identity.test.ts:11: * replaced the whole reply with a generic "temporarily unavailable" error. The chat system prompt
api/tests/agents/chat-identity.test.ts:13: * engine. Builds carry their own workspace instruction, so this is chat-only.
api/tests/agents/chat-identity.test.ts:21:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_chat_identity');
api/tests/agents/chat-identity.test.ts:26:describe('chat agent brand identity (EKOA white-label)', () => {
api/tests/agents/chat-identity.test.ts:28:    const ctx = await assembleRunContext({ ...base, actor, agentKind: 'chat', isChat: true, query: 'quem és tu?' });
api/tests/agents/chat-identity.test.ts:35:  it('a non-chat (build/coding) run does NOT carry the chat persona (builds have their own instruction)', async () => {
api/tests/routes/change-requests.test.ts:138:  it('a plain user cannot read the queue -> 403 FORBIDDEN (shared envelope)', async () => {
api/tests/routes/change-requests.test.ts:143:    expect((body.error as { code: string }).code).toBe('FORBIDDEN');
api/tests/memory/recall-wiring.test.ts:11: * asserted is that a stored memory actually reaches the assembled run context a chat turn is
api/tests/memory/recall-wiring.test.ts:13: * `assembleRunContext` exactly as agents/chat.ts does (isChat:true, optOutMemory unset) and
api/tests/memory/recall-wiring.test.ts:18:const base = { agentKind: 'chat' as const, isChat: true, groundKnowledge: false, now: () => 1_700_000_000_000 };
api/tests/memory/recall-wiring.test.ts:30:describe('memory recall wiring (F21): stored memory -> assembled chat context', () => {
api/tests/apps/edit-mode.test.ts:195:    const forbidden = scenario({ jobs: { status: 403, data: { error: { code: 'FORBIDDEN' } } } });
api/tests/apps/tour-player.behavior.test.ts:197:      steps: [{ id: 'p', type: 'inject-prompt', surface: 'chat', sendInHarness: false, prompt: 'Olá?', copy: { titlePt: 't', bodyPt: 'b' } }],
api/tests/llm/attribution.test.ts:35:    assertNotPlatformCall({ kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' });
api/tests/llm/attribution.test.ts:57:    expect(billeeOf({ kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' })).toBe('u1');
api/tests/agents/sdk-tools.test.ts:24:describe('knowledgeToolSpecs (§5.4.4 chat tools)', () => {
api/tests/llm/gateway-payload-allowlist.test.ts:36: * field a future SDK adds breaks every default-topology chat turn again.
api/tests/llm/gateway-payload-allowlist.test.ts:297: * Empty-text-block scrub (live 2026-07-11): on multi-turn chat runs (incl. the integration-build
api/tests/contract/schema-coverage.test.ts:74:  // G7B — agent execution: chat runs + build jobs (chat.test.ts, jobs.test.ts)
api/tests/contract/schema-coverage.test.ts:75:  'chat.createRun', 'chat.getRun', 'chat.runEvents', 'chat.cancelRun',
api/tests/contract/schema-coverage.test.ts:83:  // PR4 — the AI integration builder (integration-builder.test.ts): chat/load/save/test.
api/tests/contract/schema-coverage.test.ts:84:  'integrationBuilder.chat', 'integrationBuilder.load', 'integrationBuilder.save', 'integrationBuilder.test',
api/tests/contract/schema-coverage.test.ts:107:// G7B agent-execution: 80->72 as chat runs (4) + build jobs (4) landed with their contract tests.
api/tests/llm/router.test.ts:40:    expect(classify('implement a complex dashboard feature, chat only')).toBe('EXPERT');
api/tests/agents/tools.test.ts:6:  it('a chat run allows EXACTLY the two knowledge tools + delegate_to_local — never Bash/Write/Edit', () => {
api/tests/agents/tools.test.ts:7:    const p = toolPolicyFor('chat');
api/tests/llm/thinking-channel.test.ts:77:      { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' },
api/tests/contract/sessions.test.ts:21: *     orchestration store silently fell back to a CLIENT-LOCAL session id — chat runs then
api/tests/contract/billing.test.ts:62:    await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'EXPERT', raw: { input: 200_000, output: 30_000, cacheCreate: 0, cacheRead: 800_000 }, now: deps.now() });
api/tests/contract/billing.test.ts:126:  it('breakdown: builder → 403 FORBIDDEN (envelope); super-admin → BillingBreakdownResponse grouped by agentType', async () => {
api/tests/contract/billing.test.ts:130:    await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST', raw: { input: 1000, output: 0, cacheCreate: 0, cacheRead: 0 }, now: deps.now() });
api/tests/contract/billing.test.ts:137:    expect(fBody.error.code).toBe('FORBIDDEN');
api/tests/contract/billing.test.ts:143:    expect(body.items[1]).toMatchObject({ agentType: 'chat', tokens: 20 }); // 1000*0.02
api/tests/contract/billing.test.ts:161:    await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST', raw: { input: 5000, output: 0, cacheCreate: 0, cacheRead: 0 }, now: deps.now() });
api/tests/contract/billing.test.ts:188:    await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST', raw: { input: 5000, output: 0, cacheCreate: 0, cacheRead: 0 }, now: deps.now() });
api/tests/contract/billing.test.ts:216:  it('a builder is refused every admin route with 403 FORBIDDEN (envelope)', async () => {
api/tests/llm/agent-transport.test.ts:33:    const handle = runAgent(opts, { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' });
api/tests/agents/registry.test.ts:24:  return registerRun({ id, ownerUserId: 'u1', orgId: 'o1', kind: 'chat', abort: new AbortController(), startedAt: 0 });
api/tests/llm/anonymise-chokepoint.test.ts:137:    const res = await runOneShot({ prompt: PLANTED, decision: decideForTier('WORKHORSE') }, { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1', sessionId: 'conv-1' });
api/tests/llm/anonymise-chokepoint.test.ts:152:    const handle = runAgent({ prompt: PLANTED, decision: decideForTier('EXPERT') }, { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1', sessionId: 'conv-2' });
api/tests/contract/mount-coverage.test.ts:44:  ['chat.runEvents', 'SSE stream — probing holds the connection open'],
api/tests/contract/mount-coverage.test.ts:89:      'jobs.get', 'jobs.cancel', 'chat.getRun', 'chat.cancelRun',
api/tests/agents/orphan-sweep.test.ts:8: * Boot orphan sweep + ephemeral chat runs (ch05 §5.2.1, P-10). Acceptance criterion 2: a job
api/tests/agents/orphan-sweep.test.ts:10: * pre-crash chat run is gone from the (empty) registry, giving `GET /chat/runs/:id` 404.
api/tests/agents/orphan-sweep.test.ts:49:  it('a pre-crash chat run is absent from the registry after restart (→ 404)', () => {
api/tests/agents/orphan-sweep.test.ts:50:    // Simulate a restart: the in-memory registry is empty; a previously-live chat run id resolves
api/tests/agents/orphan-sweep.test.ts:53:    expect(getRun('pre-crash-chat-run')).toBeUndefined();
api/tests/contract/integration-builder.test.ts:126:describe('POST /api/v1/integration-builder/chat', () => {
api/tests/contract/integration-builder.test.ts:132:    const res = await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect the weather API' }) });
api/tests/contract/integration-builder.test.ts:150:  it('unauthenticated chat gets a 401 envelope', async () => {
api/tests/contract/integration-builder.test.ts:151:    const res = await fetch(`http://127.0.0.1:${port}/api/v1/integration-builder/chat`, {
api/tests/contract/integration-builder.test.ts:165:    const chat = await readJson(await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect the weather API' }) }));
api/tests/contract/integration-builder.test.ts:166:    const generatedPackage = chat.generatedPackage;
api/tests/contract/integration-builder.test.ts:170:      body: JSON.stringify({ builderSessionId: chat.builderSessionId, generatedPackage, testCredentials: { api_key: 'k-123456' } }),
api/tests/contract/integration-builder.test.ts:214:    const chat = await readJson(await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect the weather API' }) }));
api/tests/contract/integration-builder.test.ts:215:    await authed('/api/v1/integration-builder/package', t, { method: 'PUT', body: JSON.stringify({ builderSessionId: chat.builderSessionId, generatedPackage: chat.generatedPackage }) });
api/tests/contract/integration-builder.test.ts:254:    const chat = await readJson(await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect the weather API' }) }));
api/tests/contract/integration-builder.test.ts:258:      body: JSON.stringify({ builderSessionId: chat.builderSessionId, actionKey: 'ping', testCredentials: { api_key: 'secret-abc' }, testInput: { city: 'Lisboa' } }),
api/tests/contract/integration-builder.test.ts:272:    const session = (await integrationBuilderSessions.get(chat.builderSessionId as string)) as Record<string, unknown> | null;
api/tests/agents/local-activity.test.ts:2:import { joinLocalActivity } from '../../src/agents/chat.js';
api/tests/contract/jobs.test.ts:111:  it('a user without canBuildApps is refused a first build → 403 FORBIDDEN envelope + details.capability (H1)', async () => {
api/tests/contract/jobs.test.ts:112:    // The refusal is the machine-readable FORBIDDEN shape the H4 request-to-admin flow consumes:
api/tests/contract/jobs.test.ts:113:    // a stable code + `details.capability`, validating against the shared error envelope.
api/tests/contract/jobs.test.ts:122:    expect(body.error.code).toBe('FORBIDDEN');
api/tests/agents/chat-lifecycle.test.ts:4:import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
api/tests/agents/chat-lifecycle.test.ts:38:const chatEventsFor = (runId: string) => events.filter((e) => e.stream === 'chat' && e.streamId === runId);
api/tests/agents/chat-lifecycle.test.ts:40:describe('chat run pipeline + streaming contract', () => {
api/tests/agents/chat-lifecycle.test.ts:41:  beforeAll(() => bootAgentTestDb('ekoa_chat_lifecycle'));
api/tests/agents/chat-lifecycle.test.ts:61:    const evs = chatEventsFor(runId);
api/tests/agents/chat-lifecycle.test.ts:80:    const evs = chatEventsFor(runId);
api/tests/agents/chat-lifecycle.test.ts:88:    const evs = chatEventsFor(runId);
api/tests/agents/chat-lifecycle.test.ts:106:    const evs = chatEventsFor(runId);
api/tests/agents/chat-lifecycle.test.ts:115:    const chat = chatEventsFor(runId);
api/tests/agents/chat-lifecycle.test.ts:116:    const complete = chat.find((e) => e.type === 'complete');
api/tests/agents/chat-lifecycle.test.ts:122:    for (const e of chat.filter((x) => x.type === 'text_chunk')) {
api/tests/agents/chat-lifecycle.test.ts:136:    for (const e of chatEventsFor(runId).filter((x) => x.type === 'text_chunk')) {
api/tests/agents/chat-lifecycle.test.ts:154:    const types = new Set(chatEventsFor(runId).map((e) => e.type));
api/tests/agents/chat-lifecycle.test.ts:169:    const evs = chatEventsFor(runId);
api/tests/agents/chat-lifecycle.test.ts:186:    const evs = chatEventsFor(runId);
api/tests/agents/chat-lifecycle.test.ts:203:    const evs = chatEventsFor(runId);
api/tests/llm/client.test.ts:207:      runOneShot({ prompt: 'x', decision: decideForTier('WORKHORSE') }, { kind: 'user_work', agentType: 'chat', billeeUserId: 'u4' }),
api/tests/contract/artifacts-capability.test.ts:84:/** Assert a response is a 403 FORBIDDEN envelope carrying the expected capability. */
api/tests/contract/artifacts-capability.test.ts:89:  expect(body.error.code).toBe('FORBIDDEN');
api/tests/llm/subprocess-isolation.test.ts:27: * The observed symptom was a TENANT chat reply surfacing the OPERATOR's host context: the path
api/tests/llm/subprocess-isolation.test.ts:29: * `build` runs pass `cwd`+`homeDir` (the project sandbox), but chat / brand-research / one-shot
api/tests/llm/subprocess-isolation.test.ts:81:const tenant = { kind: 'user_work', agentType: 'chat', billeeUserId: 'tenant-user', sessionId: 'conv-1' } as const;
api/tests/llm/subprocess-isolation.test.ts:151: * (chat, build, brand-research). In tests it turns a green suite into a non-zero exit; in prod it
api/tests/llm/subprocess-isolation.test.ts:306: * eviction makes every model subprocess (chat / build / brand-research / one-shot / gateway
api/tests/contract/jobs-capability.test.ts:73:  it('a user (no canBuildApps) is refused 403 FORBIDDEN + details.capability, executor never called', async () => {
api/tests/contract/jobs-capability.test.ts:78:    expect(body.error.code).toBe('FORBIDDEN');
api/tests/contract/jobs-capability.test.ts:96:    expect(body.error.code).toBe('FORBIDDEN');
api/tests/contract/chat.test.ts:14:import { chatRouter } from '../../src/routes/chat.js';
api/tests/contract/chat.test.ts:18: * Contract test for the chat runs endpoints (ch03 §3.8.7): every response validates against its
api/tests/contract/chat.test.ts:19: * `shared/` schema (ch13 §13.5). The chat router is mounted on a bare app (server.ts wiring is
api/tests/contract/chat.test.ts:28:  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_contract_chat');
api/tests/contract/chat.test.ts:36:  app.use('/api/v1/chat', chatRouter(deps));
api/tests/contract/chat.test.ts:44:describe('chat runs contract (§3.8.7)', () => {
api/tests/contract/chat.test.ts:45:  it('POST /chat/runs → 202 ChatRunCreateResponse; GET → ChatRun; cancel → ChatRunCancelResponse', async () => {
api/tests/contract/chat.test.ts:47:    const created = await api('/api/v1/chat/runs', t, { method: 'POST', body: JSON.stringify({ sessionId: 's1', message: 'hi', language: 'pt' }) });
api/tests/contract/chat.test.ts:53:    const got = await api(`/api/v1/chat/runs/${runId}`, t);
api/tests/contract/chat.test.ts:57:    const cancelled = await api(`/api/v1/chat/runs/${runId}/cancel`, t, { method: 'POST' });
api/tests/contract/chat.test.ts:63:    const res = await api('/api/v1/chat/runs/does-not-exist', t);
api/tests/contract/chat.test.ts:69:    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/runs/x/events`);
api/tests/agents/build.test.ts:158:  it('TOCTOU: a follow-up whose artifact became UNWRITABLE between create and execute fails the job (EDIT_FORBIDDEN), never resuming the agent (H1 MEDIUM)', async () => {
api/tests/agents/build.test.ts:177:    expect(job.error?.code).toBe('EDIT_FORBIDDEN');

codex
There are two possible residuals: the new tripwire exists, but some stale prose may still partially “document-away” the gap; and the `canUseChat` behavioral-suite pointer may still be too vague. I’m running the targeted suites and checking those exact spots before I call it.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/tests/security/destructive-action-authz.test.ts | sed -n '1,170p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	/**
     2	 * H5 destructive-action authorization asserted SERVER-SIDE (BRIEF Phase 10 deliverable 4).
     3	 *
     4	 * The claim under proof: a mutating/destructive operation that reaches an app's SERVER surface and is
     5	 * meant to be end-user-gated is authorized SERVER-SIDE by the per-app SSO identity - the client
     6	 * confirmation (the Phase 4 destructive-action confirm dialog) is UX, NOT the boundary. Where that
     7	 * boundary LIVES is the per-app SSO session (api/src/integrations/app-sso.ts), which mints and checks
     8	 * an HttpOnly cookie bound to ONE app by `session.appId` (findValidAppSession). We drive the
     9	 * canonical session-gated mutating op - `POST /api/app-sso/set-password`, which writes a bcrypt hash
    10	 * onto the app's own app-data row - and prove the SERVER rejects it WITHOUT a valid app-sso session
    11	 * and with a WRONG-APP session, independent of any client-side confirmation (there is no confirmation
    12	 * parameter - the server decides on identity alone). The visitor-acting Microsoft Graph proxy
    13	 * (`/api/app-sso/m365/*`) is asserted the same way.
    14	 *
    15	 * DOCUMENTED BOUNDARY (the destructive-action-authz finding - see docs/security.md + the H5
    16	 * impl-notes): the GENERAL served-app data plane (`/api/app-data/*`, served-data.ts) that a C3
    17	 * action's submit/delete lands on is deliberately app-id-SCOPED and byte-compatible with the legacy
    18	 * key-value plane ("No platform JWT anywhere on this plane") - its per-app server boundary is the
    19	 * `X-Ekoa-App-Id` scope + the owner-activation admission gate, NOT an app-sso session. The app-sso
    20	 * IDENTITY plane asserted here gates the PRIVILEGED end-user ops (set-password, the Graph proxy). No
    21	 * new auth code is added by H5; this suite ASSERTS the authz that H1-H4 and the served-app plane
    22	 * already own.
    23	 */
    24	import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
    25	import express from 'express';
    26	import type { Server } from 'node:http';
    27	import bcrypt from 'bcryptjs';
    28	import { readFileSync } from 'node:fs';
    29	import { fileURLToPath } from 'node:url';
    30	import { dirname, resolve } from 'node:path';
    31	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
    32	import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
    33	import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
    34	import { __resetConfigForTests, loadConfig } from '../../src/config.js';
    35	import { CollectionsEngine, appScope } from '../../src/data/collections-engine.js';
    36	import { appSsoRouter } from '../../src/integrations/app-sso.js';
    37	import type { ResolvedAppScope } from '../../src/integrations/app-scope.js';
    38	
    39	let mem: MongoMemoryServer;
    40	let server: Server;
    41	let port: number;
    42	let seq = 0;
    43	const deps = { now: () => Date.now(), genId: () => `id_${seq++}` };
    44	
    45	// Two apps, two owners, two disjoint per-app SSO namespaces. A session minted for app2 must NEVER
    46	// authorize a mutation against app1.
    47	const APPS: Record<string, ResolvedAppScope> = {
    48	  app1: { appId: 'app1', ownerUserId: 'owner1', isServed: true, m365Proxy: true },
    49	  app2: { appId: 'app2', ownerUserId: 'owner2', isServed: true, m365Proxy: true },
    50	};
    51	const resolveAppScope = async (idOrSlug: string): Promise<ResolvedAppScope | null> => APPS[idOrSlug] ?? null;
    52	
    53	const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);
    54	
    55	beforeAll(async () => {
    56	  process.env.ENCRYPTION_KEY = 'k';
    57	  process.env.JWT_SECRET = 's';
    58	  __resetConfigForTests();
    59	  loadConfig();
    60	  mem = await createMem();
    61	  await connectMongo(mem.getUri(), 'ekoa_destructive_authz');
    62	  const app = express();
    63	  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope, crossSite: false }));
    64	  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    65	  port = (server.address() as { port: number }).port;
    66	}, 60_000);
    67	
    68	afterAll(async () => {
    69	  server.close();
    70	  await closeMongo();
    71	  await mem.stop();
    72	});
    73	
    74	beforeEach(async () => {
    75	  __resetActivationForTests();
    76	  setActivation('owner1', { active: true, billingLocked: false });
    77	  setActivation('owner2', { active: true, billingLocked: false });
    78	  await getDb().collection('app_data').deleteMany({});
    79	  await getDb().collection('app_sessions').deleteMany({});
    80	  // Seed one end-user into each app's own user collection (the password-auth surface).
    81	  const engine = new CollectionsEngine(deps);
    82	  await engine.create(appScope('app1'), 'utilizadores', { email: 'ana@app1.pt', passwordHash: await bcrypt.hash('segredo123', 12), name: 'Ana', role: 'user' });
    83	  await engine.create(appScope('app2'), 'utilizadores', { email: 'rui@app2.pt', passwordHash: await bcrypt.hash('segredo456', 12), name: 'Rui', role: 'user' });
    84	});
    85	
    86	const cookieFrom = (res: Response) => (res.headers.get('set-cookie') || '').split(';')[0] as string;
    87	const loginApp = (appId: string, identity: string, password: string) =>
    88	  api('/api/app-sso/login', {
    89	    method: 'POST',
    90	    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId },
    91	    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
    92	  });
    93	const setPassword = (appId: string, identity: string, password: string, cookie?: string) =>
    94	  api('/api/app-sso/set-password', {
    95	    method: 'POST',
    96	    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId, ...(cookie ? { cookie } : {}) },
    97	    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
    98	  });
    99	
   100	describe('set-password (a mutating app op) is authorized server-side by the app-sso identity, not client confirmation', () => {
   101	  it('WITHOUT a valid app-sso session -> 401 not_authenticated (the server rejects the mutation on identity alone; no confirmation param can substitute)', async () => {
   102	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01'); // no cookie
   103	    expect(res.status).toBe(401);
   104	    expect(((await res.json()) as { error: string }).error).toBe('not_authenticated');
   105	    // And the mutation did NOT happen: the old password still logs in, the new one does not.
   106	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(401);
   107	    expect((await loginApp('app1', 'ana@app1.pt', 'segredo123')).status).toBe(200);
   108	  });
   109	
   110	  it('with a WRONG-APP session (an app2 session presented to app1) -> 401 (session.appId isolation; the cross-app mutation is refused)', async () => {
   111	    const app2Cookie = cookieFrom(await loginApp('app2', 'rui@app2.pt', 'segredo456'));
   112	    expect(app2Cookie).toContain('ekoa_app_sso_app2=');
   113	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01', app2Cookie);
   114	    expect(res.status).toBe(401); // findValidAppSession(token, 'app1') is null: the session is bound to app2
   115	    // The app1 row is untouched - the wrong-app session authorized nothing.
   116	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(401);
   117	    expect((await loginApp('app1', 'ana@app1.pt', 'segredo123')).status).toBe(200);
   118	  });
   119	
   120	  it('with the CORRECT same-app session (self) -> 200: the app-sso identity - and only it - authorizes the mutation', async () => {
   121	    const app1Cookie = cookieFrom(await loginApp('app1', 'ana@app1.pt', 'segredo123'));
   122	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01', app1Cookie);
   123	    expect(res.status).toBe(200);
   124	    expect(await res.json()).toEqual({ success: true });
   125	    // The server-side mutation took effect: the new password now logs in. There was no client
   126	    // confirmation in the request - the app-sso session identity is the whole boundary.
   127	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(200);
   128	  });
   129	});
   130	
   131	describe('KNOWN GAP (codex-h5 High): the GENERAL /api/app-data mutation plane authenticates NO caller', () => {
   132	  // This is a TRIPWIRE, not a proof of safety. The served-app data plane (served-data.ts) lets ANY
   133	  // caller who knows an app id POST/PUT/DELETE that app's data - `scopeFor()` checks only the
   134	  // X-Ekoa-App-Id header + the app OWNER's activation (admitOwner), never the CALLER. Phase 10's
   135	  // "destructive-action authorization asserted server-side" is therefore NOT met for this surface.
   136	  // It is PRE-EXISTING and an architecture-level operator decision (see docs/security.md + findings).
   137	  // We PIN the current state so a future fix (a caller/session check on the data-plane writes) FLIPS
   138	  // this test and forces docs/findings/this-assertion to be updated - the gap can never be quietly
   139	  // "fixed" or quietly regress unnoticed. served-app.test.ts additionally proves BEHAVIORALLY that an
   140	  // unauthenticated /api/app-data POST currently returns 201.
   141	  const servedDataSrc = readFileSync(
   142	    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/apps/served-data.ts'),
   143	    'utf8',
   144	  );
   145	
   146	  it('the data-plane write routes exist and are scoped ONLY by scopeFor (no caller auth) - CLOSING THIS FLIPS THE TRIPWIRE', () => {
   147	    expect(/r\.post\(`\$\{prefix\}\/:collection`/.test(servedDataSrc)).toBe(true);
   148	    expect(/r\.put\(`\$\{prefix\}\/:collection\/:id`/.test(servedDataSrc)).toBe(true);
   149	    expect(/r\.delete\(`\$\{prefix\}\/:collection\/:id`/.test(servedDataSrc)).toBe(true);
   150	    // The writes gate ONLY through scopeFor, which today performs NO caller-session / app-sso check.
   151	    // If session/caller auth is ever added to the data-plane writes (the fix), one of these tokens
   152	    // appears and this fails ON PURPOSE - update the KNOWN GAP (docs/security.md + findings.md) and
   153	    // rewrite this suite to assert the new server-side authorization.
   154	    expect(
   155	      /findValidAppSession|requireAppSession|ekoa_app_sso/i.test(servedDataSrc),
   156	      'served-data.ts now references an app-sso session on the data plane - the KNOWN GAP may be closed; update docs/findings + this tripwire',
   157	    ).toBe(false);
   158	  });
   159	});
   160	
   161	describe('the visitor-acting Microsoft Graph proxy is gated by the app-sso session too', () => {
   162	  it('WITHOUT a session -> 401 not_authenticated (a mutating /m365/* forward never runs unauthenticated)', async () => {
   163	    const res = await api('/api/app-sso/m365/v1.0/me', { method: 'POST', headers: { 'x-ekoa-app-id': 'app1' } });
   164	    expect(res.status).toBe(401);
   165	    expect(((await res.json()) as { error: string }).error).toBe('not_authenticated');
   166	  });
   167	
   168	  it('with a WRONG-APP session -> 401 (a session bound to app2 cannot act on app1)', async () => {
   169	    const app2Cookie = cookieFrom(await loginApp('app2', 'rui@app2.pt', 'segredo456'));
   170	    const res = await api('/api/app-sso/m365/v1.0/me', {

exec
/bin/zsh -lc "nl -ba docs/security.md | sed -n '130,190p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   130	where any authenticated user could drive an agent against ANY artifact by id. Credential planes are mutually
   131	non-interchangeable: platform session JWT (24 h / 30 d rememberMe), bridge token (600 s,
   132	`aud: ekoa-bridge`), app-SSO session (8 h HttpOnly cookie), gateway key (static, constant-compare).
   133	Deactivation is write-through (immediate) and bumps the token epoch, invalidating outstanding JWTs.
   134	
   135	**Served-app admission planes.** The per-app `/api/app-data` plane is unauthenticated app-global
   136	storage scoped only by `X-Ekoa-App-Id` (carried verbatim for byte-compatibility) - it must never hold
   137	confidential or per-user-private data. Anything private lives on a server-authenticated plane: the
   138	shared namespace (`/api/app-shared`, resolved owner + same-origin guard + `sharedData` opt-in) or
   139	behind the platform JWT / app-SSO session. This open posture is a documented decision, not an
   140	oversight.
   141	
   142	**Security-block assertion layer (H5).** The access-control invariants above are held by committed,
   143	re-runnable gates so they cannot silently regress:
   144	- *Capability matrix + gate wiring* (`api/tests/auth/capabilities.test.ts`): the full role x
   145	  capability grid (grants AND denials; a null/undefined/unknown-role actor holds nothing, fail
   146	  closed), plus a wiring inventory that ties every capability to the route `can(actor, '...')` call
   147	  site that enforces it - so a matrix that stays green while a route loses its gate fails the suite.
   148	  Behavior is driven end-to-end by `jobs-capability`/`artifacts-capability`.
   149	- *Grep gates* (`api/tests/security/grep-gates.test.ts`): a committed tree scan (mirroring
   150	  `gate:chokepoint`'s style, self-proving via an in-suite non-tautology test) that fails if the
   151	  retired `PERMISSIVE-STUB`/`PERMISSIVE_STUB` marker reappears in `api/src`/`shared/src`, or if a
   152	  quoted `builder` ROLE literal appears anywhere in `api/src`/`shared/src`/`web{app,components,stores}`
   153	  outside a small commented allowlist (the legacy-JWT shim, the migration query, and the web
   154	  SESSION-KIND `builder` - a session kind, not a role).
   155	- *Cross-org assistant-retrieval isolation* (`api/tests/security/assistant-cross-org-isolation.test.ts`):
   156	  over the real FTS grounding seam, the served-app assistant (`runAppAssistant`, which grounds under
   157	  the server-resolved `owner.orgId`) retrieves + cites ONLY the owner org's knowledge and can never
   158	  reach another org's - the org-B token never even enters an org-A app's prompt. Live evidence is
   159	  folded into the operator journey drivers + `fees-knowledge.e2e.mjs`.
   160	- *Destructive-action authorization, server-side* (`api/tests/security/destructive-action-authz.test.ts`):
   161	  the PRIVILEGED served-app end-user ops that carry an identity ARE authorized SERVER-SIDE by the
   162	  per-app SSO identity, not by any client confirmation (the Phase 4 confirm dialog is UX). The
   163	  canonical case - `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data) - is
   164	  rejected 401 WITHOUT a valid app-sso session and with a WRONG-APP session (`session.appId`
   165	  isolation via `findValidAppSession`), and proceeds only for the correct same-app session; the
   166	  visitor-acting `/api/app-sso/m365/*` proxy is gated the same way.
   167	
   168	  **KNOWN GAP (HIGH, pre-existing, requires an operator decision) - unauthenticated served-app data
   169	  mutations.** The GENERAL `/api/app-data/:collection` plane that a C3 submit/delete/write lands on
   170	  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
   171	  `X-Ekoa-App-Id` + the resolved app OWNER's activation (`admitOwner`), then scopes to that app's
   172	  data partition. So ANY caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data
   173	  across tenants - the "authorization dimension" Phase 10 requires for a destructive action is NOT
   174	  met for the primary served-app mutation surface. Two compounding facts: (1) the collection-rule
   175	  `access: { write: 'session' | 'server' }` level is DECLARED in the manifest schema but NOT enforced
   176	  by `served-data.ts` (the write mode is decorative); (2) the app-sso session cookie is
   177	  `Path=/api/app-sso`, so it is not even transmitted to `/api/app-data`, i.e. there is no session to
   178	  check at that path today. This is PRE-EXISTING (the C3/D-era served-app data plane; the operator-run
   179	  did not introduce it) and sits on a DIFFERENT axis from the platform role/capability layer H1-H4
   180	  close (which IS complete and correct). The proper fix - enforce the declared write mode and make an
   181	  app-sso session verifiable at the data path (cookie-path widening or a session token) - is an
   182	  architecture change to the served-app data plane spanning the ~200-app estate, and is an operator
   183	  decision, not a bolt-on to this assertion slice. H5 ASSERTS the current state honestly
   184	  (`destructive-action-authz.test.ts` pins the unauthenticated write as a KNOWN-GAP TRIPWIRE so a
   185	  future fix flips the test) and flags it as the top landing item; it does NOT claim the plane is safe
   186	  and does NOT silently redesign it. Tracked: `docs/findings.md`
   187	  `served-app-data-unauthenticated-writes`.
   188	
   189	**Frame headers (current state).** The api plane sets `X-Frame-Options: DENY` / `frame-ancestors
   190	'none'`. The served-app plane sets `frame-ancestors 'self'` + `SAMEORIGIN`. The `/apps` embed

exec
/bin/zsh -lc 'cd api && npx vitest run tests/security tests/auth/capabilities.test.ts' in /Users/ggomes/dev/ekoa-code
 exited 1 in 480ms:
failed to load config from /Users/ggomes/dev/ekoa-code/api/vitest.config.ts

⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
Error: EPERM: operation not permitted, open '/Users/ggomes/dev/ekoa-code/api/node_modules/.vite-temp/vitest.config.ts.timestamp-1783988534780-13523800d4c82.mjs'
    at async open (node:internal/fs/promises:639:25)
    at async Object.writeFile (node:internal/fs/promises:1216:14)
    at async loadConfigFromBundledFile (file:///Users/ggomes/dev/ekoa-code/node_modules/vite/dist/node/chunks/node.js:35731:3)
    at async bundleAndLoadConfigFile (file:///Users/ggomes/dev/ekoa-code/node_modules/vite/dist/node/chunks/node.js:35595:17)
    at async loadConfigFromFile (file:///Users/ggomes/dev/ekoa-code/node_modules/vite/dist/node/chunks/node.js:35554:42)
    at async resolveConfig (file:///Users/ggomes/dev/ekoa-code/node_modules/vite/dist/node/chunks/node.js:35170:22)
    at async _createServer (file:///Users/ggomes/dev/ekoa-code/node_modules/vite/dist/node/chunks/node.js:25332:65)
    at async createViteServer (file:///Users/ggomes/dev/ekoa-code/node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:8835:17)
    at async createVitest (file:///Users/ggomes/dev/ekoa-code/node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:14221:18)
    at async prepareVitest (file:///Users/ggomes/dev/ekoa-code/node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:14588:14) {
  errno: -1,
  code: 'EPERM',
  syscall: 'open',
  path: '/Users/ggomes/dev/ekoa-code/api/node_modules/.vite-temp/vitest.config.ts.timestamp-1783988534780-13523800d4c82.mjs'
}




codex
- STILL-OPEN - HIGH: the repo now contains the right substance for an accepted flag-not-fix posture, and that posture is defensible here because this is a pre-existing served-app data-plane architecture gap on a different axis from H1-H4, but it is not handled fully honestly end-to-end yet. `docs/security.md` correctly adds the KNOWN HIGH GAP at [docs/security.md](/Users/ggomes/dev/ekoa-code/docs/security.md:168) and `docs/findings.md` correctly carries the HIGH ledger entry at [docs/findings.md](/Users/ggomes/dev/ekoa-code/docs/findings.md:54), and the tripwire section is correctly present at [destructive-action-authz.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/destructive-action-authz.test.ts:131). But contradictory “documented decision / not an oversight” language still remains in [docs/security.md](/Users/ggomes/dev/ekoa-code/docs/security.md:135) and the test header still says `DOCUMENTED BOUNDARY` in [destructive-action-authz.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/destructive-action-authz.test.ts:15), which still partially documents-away the gap.

- STILL-OPEN - MEDIUM: the whoami-specific weakness is fixed; the wiring row now requires the route to call `detectAppEditor` and bind `admin` to that result in [capabilities.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/auth/capabilities.test.ts:126), and the live route does exactly that in [app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:255). But the “authoritative behavioral suite” inventory is still not fully concrete or honestly asserted: the `canUseChat` row names a vague `tests/contract/jobs-capability.test.ts + chat suites` string at [capabilities.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/auth/capabilities.test.ts:101), and the existence check only validates the first path token at [capabilities.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/auth/capabilities.test.ts:138), so the unnamed “chat suites” are not asserted and the checked file is not the chat-route authz suite.

- CLOSED - LOW: the grep gate now scans all live web source roots in the test itself at [grep-gates.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/grep-gates.test.ts:117), including `web/hooks`, `web/lib`, `web/locales`, and `web/types` at [grep-gates.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/grep-gates.test.ts:122). I did not find a new runtime/security defect beyond the stale contradictory wording and the still-weak `canUseChat` behavioral-suite pointer above.

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
165,006
- STILL-OPEN - HIGH: the repo now contains the right substance for an accepted flag-not-fix posture, and that posture is defensible here because this is a pre-existing served-app data-plane architecture gap on a different axis from H1-H4, but it is not handled fully honestly end-to-end yet. `docs/security.md` correctly adds the KNOWN HIGH GAP at [docs/security.md](/Users/ggomes/dev/ekoa-code/docs/security.md:168) and `docs/findings.md` correctly carries the HIGH ledger entry at [docs/findings.md](/Users/ggomes/dev/ekoa-code/docs/findings.md:54), and the tripwire section is correctly present at [destructive-action-authz.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/destructive-action-authz.test.ts:131). But contradictory “documented decision / not an oversight” language still remains in [docs/security.md](/Users/ggomes/dev/ekoa-code/docs/security.md:135) and the test header still says `DOCUMENTED BOUNDARY` in [destructive-action-authz.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/destructive-action-authz.test.ts:15), which still partially documents-away the gap.

- STILL-OPEN - MEDIUM: the whoami-specific weakness is fixed; the wiring row now requires the route to call `detectAppEditor` and bind `admin` to that result in [capabilities.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/auth/capabilities.test.ts:126), and the live route does exactly that in [app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:255). But the “authoritative behavioral suite” inventory is still not fully concrete or honestly asserted: the `canUseChat` row names a vague `tests/contract/jobs-capability.test.ts + chat suites` string at [capabilities.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/auth/capabilities.test.ts:101), and the existence check only validates the first path token at [capabilities.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/auth/capabilities.test.ts:138), so the unnamed “chat suites” are not asserted and the checked file is not the chat-route authz suite.

- CLOSED - LOW: the grep gate now scans all live web source roots in the test itself at [grep-gates.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/grep-gates.test.ts:117), including `web/hooks`, `web/lib`, `web/locales`, and `web/types` at [grep-gates.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/grep-gates.test.ts:122). I did not find a new runtime/security defect beyond the stale contradictory wording and the still-weak `canUseChat` behavioral-suite pointer above.

VERDICT: NEEDS-WORK
