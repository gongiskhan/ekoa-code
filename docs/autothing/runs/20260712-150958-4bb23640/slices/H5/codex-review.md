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
session id: 019f5dea-143e-7411-bb84-c5e72ba07887
--------
user
Adversarial SECURITY review in /Users/ggomes/dev/ekoa-code of commit 3ad6fb3 (git show 3ad6fb3): slice H5 of a security block - the ASSERTION layer (BRIEF Phase 10). It adds tests + a grep gate + committed e2e journey drivers (no production auth code; only a comment fix + a run-driver role fix + a findings entry). The DEFECT CLASS here is weak/tautological assertions or a MISSED Phase-10 assertion. Scrutinize: (1) grep gate api/tests/security/grep-gates.test.ts - does it ACTUALLY fail on a real orphan 'builder' ROLE literal or a resurrected PERMISSIVE-STUB marker, or is it a tautology/too-broad-allowlist/partial-dir-scan? does it scan api/src+shared/src+web? (2) capability matrix + wiring api/tests/auth/capabilities.test.ts - 12-cell grid fail-closed on unknown role; does the 'wiring inventory' catch a route silently losing its can() gate or just re-assert the matrix? (3) cross-org assistant isolation api/tests/security/assistant-cross-org-isolation.test.ts - genuinely proves org A's assistant cannot retrieve org B knowledge over the REAL grounding seam + real FTS (not a trivial mock), owner-org (not visitor) the partition key? (4) destructive-action authz api/tests/security/destructive-action-authz.test.ts - asserts the SERVER rejects a mutating op without/with-wrong app-sso session; SCRUTINIZE the documented finding that the general /api/app-data plane is app-id-scoped NOT app-sso-gated - is that a real gap being waved away or genuinely safe (does app-id scoping alone prevent cross-tenant data writes)? (5) journey drivers edit-journey.e2e.mjs + request-changes-journey.e2e.mjs - assert admin opt-in->patch->approve/rollback, user CANNOT reach edit, file->admin-sees->convert; budget-capped; no green-by-default? (6) any MISSED Phase-10 assertion (capability matrix / no-orphan-builder / no-permissive-stub / edit journey / user-cannot-edit / destructive server authz / cross-org knowledge isolation / request-changes journey)? (7) the flagged observations correctly OUT of the H block? Read slices/H5/impl-notes.md. You may run read-only cmds incl. vitest tests/security tests/auth + try to break the grep gate. Concise: a bullet per finding classified High/Medium/Low with file:line, then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `3ad6fb3` as an adversarial assertion-layer pass. I’m checking the repo context files first, then the H5 notes and the touched tests to see whether these assertions actually prove the intended properties or just restate assumptions.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'git show --stat --oneline --name-only 3ad6fb3' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-lrlV7Tkh' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-F8LNj3by' (errno=Operation not permitted)
3ad6fb3 feat(operator-run/h5): SECURITY assertion layer - capability matrix + gate-wiring inventory, self-proving grep gates (no PERMISSIVE-STUB marker / no orphan builder ROLE literal survives), cross-org assistant-retrieval isolation (deterministic over the real grounding seam), destructive-action authz asserted server-side (app-sso), + committed live journey drivers (edit + request-changes). Lead fixes folded: assistant-billing.e2e.mjs invalid role builder->user (H1 rename miss); stale capabilities.ts comment; ledgered the unenforced collection-rule write-mode (data-plane, outside H). No production auth code touched
api/tests/SUITE_LEDGER.json
api/tests/auth/capabilities.test.ts
api/tests/e2e/assistant-billing.e2e.mjs
api/tests/e2e/edit-journey.e2e.mjs
api/tests/e2e/request-changes-journey.e2e.mjs
api/tests/security/assistant-cross-org-isolation.test.ts
api/tests/security/destructive-action-authz.test.ts
api/tests/security/grep-gates.test.ts
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/worker-status.txt
docs/findings.md
docs/security.md
shared/src/capabilities.ts

exec
/bin/zsh -lc "pwd && ls -la && test -d .codegraph && echo CODEGRAPH_PRESENT || echo CODEGRAPH_ABSENT && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'AGENTS.md' -g 'slices/H5/impl-notes.md'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
/Users/ggomes/dev/ekoa-code
total 1280
drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 14 00:57 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 14 00:56 .git
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
-rw-r--r--@   1 ggomes  staff    1000 Jul 13 15:43 .gitignore
-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
-rw-r--r--@   1 ggomes  staff    2351 Jul 13 16:54 Dockerfile.api
-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
-rw-r--r--@   1 ggomes  staff   51665 Jul 14 00:08 RUN_LOG.md
drwxr-xr-x@  18 ggomes  staff     576 Jul 13 15:42 api
-rw-r--r--@   1 ggomes  staff       5 Jul  6 22:50 backend.port
drwxr-xr-x@   6 ggomes  staff     192 Jul  8 10:26 deploy
drwxr-xr-x@  17 ggomes  staff     544 Jul 14 00:43 docs
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
CODEGRAPH_PRESENT

codex
The repo is CodeGraph-indexed, so I’m using that path first for the auth and security surfaces. I also need the H5 implementation notes because part of your ask is whether the recorded exclusions are actually outside this slice or just being deferred.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
# H5 impl-notes - SECURITY: the ASSERTION layer (capability matrix, grep gates, isolation, journeys)

Status: DONE-GREEN. H5 asserts what H1-H4 built; it adds NO new capability/permission/auth logic (no
`api/src` production file touched). All five deliverables built + green in the FULL api vitest lane
(**180 files, 1627 passed, 1 skipped** - was 177/1601/1 at H4: +3 test files, +26 tests). Two
non-blocking OBSERVATIONS surfaced for the lead (below) - neither is a hole in H1-H4's platform authz.

## Deliverable 1 - Capability matrix + gate-wiring assertion

`api/tests/auth/capabilities.test.ts` (EXTENDED, reserved path):
- The full 3x4 grid + null/undefined -> nothing already existed (H1). ADDED: an **unknown/stale role
  -> nothing (fail closed)** cell - a signature-valid actor carrying a dead role value (`builder`
  bypassing the shim, `root`, `''`) is refused every capability (pins the `?? false` defensive branch).
- ADDED a `describe('capability gate wiring (H5)...')` block: a WIRING INVENTORY that ties every
  capability to the route `can(actor, '...')` call site enforcing it (data-driven `it.each`), reading
  the route source so a matrix that stays green while a route silently loses its gate FAILS. Covers:
  jobs.ts (canBuildApps first-build / canEditApps follow-up), chat.ts (canUseChat), artifacts.ts
  (canCreateArtifacts create / canEditApps denyAppEdit / canBuildApps import+fork - incl. the
  `forkCap` ternary indirection), app-assistant-route.ts (canEditApps whoami/isAppEditor). Plus a pin
  that the two admin-only capabilities (a user is denied canBuildApps+canEditApps) each have an
  enforcing gate. CROSS-REFERENCES (does NOT duplicate) `jobs-capability.test.ts` +
  `artifacts-capability.test.ts`, which drive the behavior end-to-end.

## Deliverable 2 - Grep gates (committed test, self-proving non-tautology)

`api/tests/security/grep-gates.test.ts` (NEW, reserved path). Chosen a committed vitest gate over a
scripts/ hook: it runs in the FULL vitest lane the operator runs, is self-contained, and can prove
its own non-tautology in-suite. Two tree scans:
- **No permissive stub:** `PERMISSIVE-STUB`/`PERMISSIVE_STUB` marker appears nowhere in api/src +
  shared/src (H1 removed it; asserted it stays gone).
- **No orphan `builder` role ref:** a quoted `'builder'`/`"builder"` ROLE literal in api/src +
  shared/src + web/{app,components,stores} must be in the commented allowlist: `api/src/auth/jwt.ts`
  (legacy-JWT shim), `api/src/auth/users-service.ts` (migrateBuilderRole query + comments),
  `web/stores/orchestration.ts` (SESSION-KIND `builder`, NOT a user role). The org-setting KEY
  `allowBuilderAutomations` is naturally excluded (the quoted-literal matcher never matches an
  unquoted identifier substring - asserted by the matcher self-test). A NEW orphan literal in any
  other file FAILS.
- **Non-tautology proven two ways:** (a) an in-suite self-test drives the pure matcher + allowlist
  logic against PLANTED violations (a real `'builder'` literal / stub marker IS detected; feature
  identifiers `integrationBuilder`/`builderSessionId`/`allowBuilderAutomations`/`"Builder"` label are
  NOT; a non-allowlisted file IS flagged) - durable, not a one-off; (b) VERIFIED by planting
  `export const x = 'builder'; // PERMISSIVE-STUB` in a temp `api/src/__h5_grep_probe__.ts`: BOTH
  gates failed, probe removed, gates green again.

## Deliverable 3 - Cross-org knowledge isolation extended to ASSISTANT RETRIEVAL

`api/tests/security/assistant-cross-org-isolation.test.ts` (NEW, reserved path). DETERMINISTIC
integration over the REAL grounding seam (no LLM): seed org A + org B partitions in a real FTS index
with distinctive per-org tokens (bodies share no query content word, so the only FTS-matchable token
is the org's own), wire the REAL `buildGroundingBlock` as `runAppAssistant`'s `deps.ground`, and
assert:
- an org-A app's assistant retrieves + cites org A's fact and NEVER org B's (org B's token never
  even enters the systemPrompt the model would see);
- an org-B app asking for org A's fact retrieves NOTHING (isolation, not just non-citation);
- symmetric for B; and the OWNER org - never a visitor-planted `context.orgId` - decides the
  partition (a steered attacker-org partition is never consulted).
This is the committed GATE. Live evidence is folded into the journey drivers + the existing
`fees-knowledge.e2e.mjs` (owner-org CITED), so no separate live driver was added for #3 (decision).

## Deliverable 4 - Destructive-action authorization asserted SERVER-SIDE

`api/tests/security/destructive-action-authz.test.ts` (NEW, reserved path). Asserts the app-sso
IDENTITY plane (`api/src/integrations/app-sso.ts`) gates a mutating served-app op server-side,
independent of any client confirmation:
- `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data row) -> **401 WITHOUT a
  valid app-sso session**; **401 with a WRONG-APP session** (an app2 cookie presented to app1 -
  `findValidAppSession(token, app1)` is null by `session.appId` isolation); **200 only for the
  correct same-app session** (the app-sso identity, and only it, authorizes the mutation - there is
  no confirmation param). Each path also asserts the app1 row was/was-not actually mutated.
- the visitor-acting `/api/app-sso/m365/*` proxy is gated the same way (401 without / with a wrong-app
  session).

### Destructive-action-authz FINDING (documented boundary, not a hole)
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

exec
/bin/zsh -lc 'codegraph explore "capabilities auth matrix grep gates assistant cross org isolation destructive action authz"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "find .. -name PRD.md -o -name PLANING.md -o -name TASKS.md | sed 's#"'^#/#'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 415ms:
## Exploration: capabilities auth matrix grep gates assistant cross org isolation destructive action authz

Found 129 symbols across 32 files.

### Blast radius — what depends on these (update/verify before editing)

- `act` (api/src/automation/browser-session.ts:130) — 4 callers in `api/src/automation/engine.ts`; tests: `web/__tests__/use-bridge-presence.test.ts`

### Relationships

**references:**
- CAPABILITIES → Role
- JwtClaims → Role
- UsersState → Role
- signToken → JwtClaims
- verifyToken → JwtClaims
- can → JwtClaims
- logoutSelf → JwtClaims
- logoutOther → JwtClaims
- isAppEditor → JwtClaims
- UsersState → AuthUser
- ... and 105 more

**calls:**
- act → ensurePage
- act → executePlaywrightAction
- act → capture
- act → dispatch
- flush → act
- executeStep → act
- executeStep → executeBrowserStep
- callPlatformIntegration → keyToProvider
- connectGoogle → deps
- getValidPlatformTokens → refreshAndPersist
- ... and 104 more

**implements:**
- DaemonBrowserSession → BrowserSession
- LocalBrowserSession → BrowserSession

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/integrations/platform-oauth.ts — PlatformProvider(references), calls(calls), references(references), OAuthDeps(references), PlatformHttp(references), PlatformOAuthEnv(references), PlatformProvider(type_alias), PLATFORM_PROVIDERS(constant), OAuthTokens(interface), PlatformOAuthEnv(type_alias), +13 more

```typescript
32	// Types
33	// ============================================================================
34	
35	export type PlatformProvider = 'google' | 'microsoft';
36	export const PLATFORM_PROVIDERS: readonly PlatformProvider[] = ['google', 'microsoft'];
37	
38	/** The stored (encrypted) token bundle. */
39	export interface OAuthTokens {
40	  access_token: string;
41	  refresh_token: string;
42	  token_type: string;
43	  expires_at: string; // ISO
44	  scope: string;
45	  email?: string;
46	  provider: PlatformProvider;
47	}
48	
49	/** Per-provider client credentials + redirect base. Injected (default reads env) so tests never
50	 *  need real client secrets and never touch a live provider. */
51	export interface OAuthProviderConfig {
52	  clientId: string;
53	  clientSecret: string;
54	  /** Origin the redirect URI is built against, e.g. `https://app.ekoa.pt`. */
55	  redirectBaseUrl: string;
56	  /** Microsoft only: tenant segment of the authorize/token endpoints (default `common`). */
57	  tenantId?: string;
58	}
59	export type PlatformOAuthEnv = Record<PlatformProvider, OAuthProviderConfig>;
60	
61	/** Injectable HTTP seam. Production default = the SSRF-guarded fetcher. */
62	export type PlatformHttp = (
63	  url: string,
64	  opts?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
65	) => Promise<Response>;
66	
67	const defaultHttp: PlatformHttp = (url, opts = {}) => guardedFetch(url, { timeoutMs: 30_000, ...opts });
68	
69	export interface OAuthDeps {
70	  now: () => number;
71	  genId: () => string;
72	  http?: PlatformHttp;
73	  env?: PlatformOAuthEnv;
74	}
75	
76	/** Read provider client credentials from env (mirrors config.ts env-helper convention; the
77	 *  definitions registry reads EKOA_INTEGRATIONS_DIR the same way). Overridable via OAuthDeps.env

... (gap) ...

93	  };
94	}
95	
96	function envOf(deps: OAuthDeps): PlatformOAuthEnv {
97	  return deps.env ?? loadPlatformOAuthEnv();
98	}
99	function httpOf(deps: OAuthDeps): PlatformHttp {
100	  return deps.http ?? defaultHttp;
101	}
102	
103	/** How long a pending OAuth `state` is valid (connect → callback). */
104	const STATE_TTL_MS = 10 * 60 * 1000;
105	
106	function isProvider(v: unknown): v is PlatformProvider {
107	  return v === 'google' || v === 'microsoft';
108	}
109	function assertProvider(v: unknown): PlatformProvider {
110	  if (!isProvider(v)) throw new Error(`invalid provider: ${String(v)}`);
111	  return v;
112	}
113	
114	function redirectUri(cfg: OAuthProviderConfig, provider: PlatformProvider): string {
115	  return `${cfg.redirectBaseUrl.replace(/\/+$/, '')}/api/v1/oauth/${provider}/callback`;
116	}
117	
118	// ============================================================================
119	// Provider protocol — Google

... (gap) ...

521	}
522	
523	/** Disconnect a provider (org-admin). Idempotent — clears credentials + state. */
524	export async function disconnectPlatform(actor: ActivityActor, providerRaw: string, deps: OAuthDeps): Promise<void> {
525	  const provider = assertProvider(providerRaw);
526	  const id = rowId(actor.orgId, provider);
527	  const existing = (await integrationConfigs.get(id)) as IntegrationConfigDoc | null;
528	  if (existing && existing.orgId === actor.orgId) {
529	    await integrationConfigs.update(id, (cur) => ({
530	      ...cur,
531	      credentialsCiphertext: undefined,
532	      email: undefined,
533	      enabled: false,
534	      needsReauth: false,
535	      oauthState: undefined,
536	      oauthStateExpiresAt: undefined,
537	    }));
538	    await logActivity(actor, 'platform-integrations', 'disconnect', deps, { provider });
539	  }
540	}
541	
542	/** All providers with their connection state for the actor's org (any org member). */
543	export async function listPlatform(actor: Actor): Promise<Array<{ provider: PlatformProvider; connected: boolean; email?: string }>> {
544	  const out: Array<{ provider: PlatformProvider; connected: boolean; email?: string }> = [];
545	  for (const provider of PLATFORM_PROVIDERS) {
546	    const row = await getOrgRow(actor.orgId, provider);
547	    if (!row || !row.credentialsCiphertext || row.needsReauth) {
548	      out.push({ provider, connected: false });
549	      continue;
550	    }
551	    let email: string | undefined = row.email || undefined;
552	    if (!email) {
553	      try {
554	        email = (JSON.parse(decrypt(row.credentialsCiphertext)) as OAuthTokens).email || undefined;
555	      } catch {
556	        out.push({ provider, connected: false });
557	        continue;
558	      }
559	    }
560	    out.push({ provider, connected: true, email });
561	  }
562	  return out;
563	}
564	
565	// ============================================================================
566	// Callback page (server-rendered; postMessage to the opener — ch03 §3.8.15)
```

#### shared/src/app-assistant.ts — AssistantAction(type_alias)

```typescript
1	/** Served-app assistant endpoint contract (ch03 §3.9.1; operator-run D1).
2	 *
3	 * EVOLVED ADDITIVELY (D1): the base request stayed `{ message, history? }` and the base
4	 * response stayed `{ reply }` (both back-compatible — every new field is optional), so an old
5	 * caller keeps working and `reply` is always present. D1 layers the served-app assistant's
6	 * three capabilities on top:
7	 *   - `mode` ('do' | 'show' | 'teach') — the assistant OPERATES the app (do), gives an overview
8	 *     (show), or teaches/tutorials (teach). The client may pin it; otherwise the server infers it
9	 *     from the message and echoes the inferred value back.
10	 *   - request `context` — the panel's current screen state (route + prior action results) so the
11	 *     assistant grounds its answer in what the visitor is looking at.
12	 *   - response `citations` — the knowledge excerpts the reply drew on (cite-your-source), one per
13	 *     grounding hit, addressed by (collection, docId) — the pair `knowledge_read` takes.
14	 *   - response `actions` — the app-actions the assistant wants the in-page runtime (C3) to
15	 *     execute. The server proposes; it never dispatches. Each names a manifest tool + its input.
16	 */
17	import { z } from 'zod';
18	import type { DomainDescriptorMap } from './descriptor.js';
19	import { AppAction } from './action-manifest.js';
20	
21	export const AssistantChatMessage = z.object({
22	  role: z.enum(['user', 'assistant']),
23	  content: z.string(),
24	});
25	export type AssistantChatMessage = z.infer<typeof AssistantChatMessage>;
26	
27	/** The assistant's operating mode: operate the app / give an overview / teach. */
28	export const AssistantChatMode = z.enum(['do', 'show', 'teach']);
29	export type AssistantChatMode = z.infer<typeof AssistantChatMode>;
30	
31	/** The panel's current screen state, forwarded so the assistant grounds in what the visitor sees.
32	 *  `actionResults` are opaque outputs of previously-dispatched app-actions (client-shaped). */
33	export const AssistantChatContext = z.object({
34	  route: z.string().optional(),
35	  actionResults: z.array(z.unknown()).optional(),
36	});
37	export type AssistantChatContext = z.infer<typeof AssistantChatContext>;
38	
39	export const AssistantChatRequest = z.object({
40	  message: z.string(),
41	  history: z.array(AssistantChatMessage).optional(),
42	  /** The panel's current screen state (D1). */
43	  context: AssistantChatContext.optional(),
44	  /** Pin the mode; when absent the server infers it and echoes it back on the response (D1). */
45	  mode: AssistantChatMode.optional(),
46	});
47	export type AssistantChatRequest = z.infer<typeof AssistantChatRequest>;
48	
49	/** One knowledge citation the reply drew on — addressed by (collection, docId), title for display. */
50	export const AssistantCitation = z.object({
51	  collection: z.string(),
52	  docId: z.string(),
53	  title: z.string(),
54	});
55	export type AssistantCitation = z.infer<typeof AssistantCitation>;
56	
57	/** One app-action the assistant asks the in-page runtime (C3) to execute. `toolName` is a
58	 *  manifest tool name (`app_action__<id>`); `input` is the tool's validated arguments (VALUES).
59	 *
60	 *  `action` is the SERVER-RESOLVED manifest AppAction (kind/target/route/tourId/labelPt/destructive/
61	 *  params-definitions). D1 attaches it because the C3 same-document runtime's `perform()` needs a
62	 *  full AppAction (it fails `invalid-action` without `action.kind`) and the served page is NOT
63	 *  injected with the manifest — so the client cannot resolve `toolName → AppAction` on its own. The
64	 *  client dispatches `execute({ ...action, params: input })` (input overrides the definition-shaped
65	 *  params with VALUES at execute time). Keeping the executable shape server-authoritative (from the
66	 *  app's own activation-time manifest) means neither the model nor the anonymous visitor can forge a
67	 *  kind/target. Optional for back-compat; D1 always populates it for a validated toolName. */
68	export const AssistantAction = z.object({
69	  toolName: z.string(),
70	  input: z.record(z.unknown()),
71	  action: AppAction.optional(),
72	});
73	export type AssistantAction = z.infer<typeof AssistantAction>;
74	
75	export const AssistantChatResponse = z.object({
76	  reply: z.string(),
77	  /** Knowledge excerpts the reply cited (D1; cite-your-source). Absent when nothing was grounded. */
78	  citations: z.array(AssistantCitation).optional(),
79	  /** App-actions the assistant wants the client runtime to execute (D1). Absent when none. */
80	  actions: z.array(AssistantAction).optional(),
81	  /** The mode the assistant operated in — the client's pin, or the server's inference (D1). */
82	  mode: AssistantChatMode.optional(),
83	});
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
111	    auth: 'header-scoped',
112	    response: AppAssistantWhoamiResponse,
113	  },
114	} as const satisfies DomainDescriptorMap;
```

#### shared/src/capabilities.ts — Capability(constant)

```typescript
1	/**
2	 * Capability vocabulary for the platform permission seam (operator-run S0).
3	 * NAMES ONLY — no role mapping here (this is the shared contract vocabulary).
4	 * The real role→capability mapping and every authorization decision live in
5	 * `api/src/auth/capabilities.ts` (the `can()` matrix) since the operator-run
6	 * security block (H1); the former permissive stub is gone (H5 grep-gates that
7	 * the retired stub marker never resurfaces anywhere in the tree).
8	 */
9	import { z } from 'zod';
10	
11	export const Capability = z.enum([
12	  'canBuildApps',
13	  'canEditApps',
14	  'canCreateArtifacts',
15	  'canUseChat',
16	]);
17	export type Capability = z.infer<typeof Capability>;
```

#### shared/src/action-manifest.ts — AppAction(type_alias)

```typescript
1	/**
2	 * Per-app UI ACTION MANIFEST (operator-run C2) — the operate contract of a
3	 * generated app: the typed vocabulary of UI commands the app's operator
4	 * assistant (and the test harness) may drive, declared at build time as the
5	 * `ui_actions` section of the app's MANIFEST.md, side by side with the
6	 * data-plane `capabilities` (manifest-level unification, memos/registry.md).
7	 *
8	 * Actions dispatch through the app's OWN state layer in-page — the same events
9	 * a human interaction produces — so validation and business logic always apply.
10	 * `destructive: true` demands a client-side confirmation step before dispatch
11	 * (a UX affordance; server-side authorisation is asserted in the security
12	 * block, never here). `target` names the element's registry id — the SAME
13	 * namespace as `data-demo-target`, which is what keeps generated-tour
14	 * selectors stable across rebuilds.
15	 */
16	import { z } from 'zod';
17	
18	/** Typed parameter of an app action. `option` values must name one of `options`. */
19	export const AppActionParam = z.object({
20	  name: z.string().min(1),
21	  type: z.enum(['string', 'number', 'boolean', 'option']),
22	  required: z.boolean().default(false),
23	  /** For type 'option': the closed value set the UI offers. */
24	  options: z.array(z.string().min(1)).optional(),
25	  /** PT-PT label shown in confirmation/summary surfaces. */
26	  labelPt: z.string().min(1).optional(),
27	}).superRefine((p, ctx) => {
28	  if (p.type === 'option' && (!p.options || p.options.length === 0)) {
29	    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `param "${p.name}": type 'option' requires non-empty options` });
30	  }
31	});
32	export type AppActionParam = z.infer<typeof AppActionParam>;
33	
34	export const APP_ACTION_KINDS = [
35	  'navigate',
36	  'setField',
37	  'toggle',
38	  'select',
39	  'highlight',
40	  'startTour',
41	  'custom',
42	] as const;
43	
44	export const AppAction = z.object({
45	  /** Stable kebab identifier, unique within the app (`registry id`). */
46	  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'action id must be kebab-case'),
47	  kind: z.enum(APP_ACTION_KINDS),
48	  /** PT-PT human label (lawyer-facing surfaces render this). */
49	  labelPt: z.string().min(1),
50	  /** What the action does — consumed as the assistant tool description. */
51	  description: z.string().min(1),
52	  /** Element registry id the action operates on (data-demo-target namespace).
53	   *  Required for element-scoped kinds; navigate/startTour/custom may omit it. */
54	  target: z.string().min(1).optional(),
55	  /** Route for kind 'navigate' (app-relative, e.g. "/clientes"). */
56	  route: z.string().min(1).optional(),
57	  /** Tour id for kind 'startTour'. */
58	  tourId: z.string().min(1).optional(),
59	  params: z.array(AppActionParam).default([]),
60	  /** Destructive actions (submit/delete/send) get a client-side confirmation
61	   *  step before dispatch. UX affordance only — not an authorisation boundary. */
62	  destructive: z.boolean().default(false),
63	}).superRefine((a, ctx) => {
64	  if (a.kind === 'navigate' && !a.route) {
65	    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${a.id}": kind 'navigate' requires route` });
66	  }
67	  if (a.kind === 'startTour' && !a.tourId) {
68	    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${a.id}": kind 'startTour' requires tourId` });
69	  }
70	  if ((a.kind === 'setField' || a.kind === 'toggle' || a.kind === 'select' || a.kind === 'highlight') && !a.target) {
71	    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${a.id}": kind '${a.kind}' requires target` });
72	  }
73	});
74	export type AppAction = z.infer<typeof AppAction>;
75	
76	export const AppActionManifest = z.object({
77	  version: z.literal(1),
78	  actions: z.array(AppAction).max(200).superRefine((actions, ctx) => {
79	    const seen = new Set<string>();
80	    for (const a of actions) {
81	      if (seen.has(a.id)) {
82	        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate action id "${a.id}"` });
83	      }
84	      seen.add(a.id);
85	    }
86	  }),
87	});
88	export type AppActionManifest = z.infer<typeof AppActionManifest>;
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I have the H5 author notes; now I’m checking whether the tests actually enforce those claims. The main risk here is assertion theater: a test that passes while the underlying gate or seam could still be bypassed.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "git show 3ad6fb3:api/tests/auth/capabilities.test.ts | nl -ba | sed -n '1,320p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:api/tests/security/assistant-cross-org-isolation.test.ts | nl -ba | sed -n '1,320p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:api/tests/security/grep-gates.test.ts | nl -ba | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-JlM7lmYw' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-BiT9VS7M' (errno=Operation not permitted)
     1	/**
     2	 * H5 cross-org knowledge isolation - extended to ASSISTANT RETRIEVAL (BRIEF Phase 10 deliverable 3).
     3	 *
     4	 * The served-app assistant (`POST /api/app-assistant`, app-assistant-route.ts) is header-scoped and
     5	 * visitor-blind: it grounds ONLY under `input.owner.orgId`, the org resolved SERVER-SIDE from the
     6	 * artifact owner (never anything the anonymous visitor supplies). This proves the ISOLATION property
     7	 * of that grounding DETERMINISTICALLY, over the REAL knowledge grounding seam (buildGroundingBlock)
     8	 * with a REAL FTS partition - no LLM turn:
     9	 *
    10	 *   - Seed org A's partition with a distinctive fact and org B's partition with a DIFFERENT
    11	 *     distinctive fact (each token unique + nonsense so an FTS match can only come from that org's
    12	 *     own row; nothing is seeded into the `_shared` corpus, so there is no shared leak either).
    13	 *   - Drive the assistant (runAppAssistant, the pure logic app-assistant-route.ts binds) for an app
    14	 *     OWNED BY ORG A: it can retrieve + cite org A's fact and CANNOT retrieve/cite org B's - the
    15	 *     org-B token never even enters the systemPrompt the model would see. And symmetrically for B.
    16	 *   - A visitor cannot steer the org: a foreign orgId planted in the panel context is ignored;
    17	 *     grounding stays pinned to the owner org.
    18	 *
    19	 * The live end-to-end evidence (a served app's assistant citing a doc that entered its owner org) is
    20	 * folded into the operator-run journey drivers + fees-knowledge.e2e.mjs (owner-org CITED). This is
    21	 * the committed GATE: retrieval isolation, deterministic, over the real index.
    22	 */
    23	import { describe, it, expect, beforeEach, afterEach } from 'vitest';
    24	import { mkdtemp, rm } from 'node:fs/promises';
    25	import { tmpdir } from 'node:os';
    26	import { join } from 'node:path';
    27	import { indexDoc, closeIndex } from '../../src/knowledge/index-store.js';
    28	import { buildGroundingBlock } from '../../src/knowledge/grounding.js';
    29	import { runAppAssistant, type AppAssistantDeps } from '../../src/apps/app-assistant.js';
    30	import type { RouterDecision } from '../../src/llm/index.js';
    31	
    32	// Two orgs, two distinctive nonsense tokens. Each fact lives ONLY in its own org's partition, so an
    33	// FTS hit on a token proves the retrieval reached exactly that partition. The tokens carry no digits
    34	// (a clean single FTS token) and never collide.
    35	const ORG_A = 'org-alfa';
    36	const ORG_B = 'org-beta';
    37	const TOKEN_A = 'zephyrquartz';
    38	const TOKEN_B = 'vermilliononyx';
    39	// Bodies deliberately share NO content word with the query below ("codigo interno organizacao"):
    40	// the ONLY FTS-matchable token in each is its distinctive per-org token, so a hit proves the search
    41	// reached exactly that org's partition (a shared common word would let each org match its OWN doc,
    42	// which is correct grounding but muddies the "reached NOTHING" isolation assertions).
    43	const DOC_A = { docId: 'kb-a', collection: 'circulares', title: 'Segredo Alfa', body: `a palavra de acesso alfa e ${TOKEN_A}` };
    44	const DOC_B = { docId: 'kb-b', collection: 'circulares', title: 'Segredo Beta', body: `a palavra de acesso beta e ${TOKEN_B}` };
    45	
    46	const DECISION: RouterDecision = { tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 };
    47	
    48	interface Captured { systemPrompt?: string }
    49	
    50	/** Deps that ground with the REAL org-partitioned builder and capture the systemPrompt the model
    51	 *  would see (so we can assert the FOREIGN org's fact never entered the prompt at all). The one-shot
    52	 *  is canned - this gate never issues a model call. */
    53	function realGroundingDeps(captured: Captured): AppAssistantDeps {
    54	  return {
    55	    oneShot: async (opts) => {
    56	      captured.systemPrompt = opts.systemPrompt ?? '';
    57	      return { text: 'ok', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
    58	    },
    59	    ground: buildGroundingBlock, // the REAL org-partitioned grounding seam
    60	    decide: () => DECISION,
    61	  };
    62	}
    63	
    64	/** Run the assistant for an app owned by `orgId`, asking about `token`. Returns the citation docIds
    65	 *  and the captured systemPrompt. */
    66	async function ask(orgId: string, token: string) {
    67	  const captured: Captured = {};
    68	  const res = await runAppAssistant(
    69	    {
    70	      message: `Qual e o codigo interno ${token} da organizacao?`,
    71	      // A visitor trying to steer the org via panel context MUST be ignored (org comes from owner).
    72	      context: { route: '/x', actionResults: [{ orgId: 'attacker-org' }] },
    73	      owner: { userId: `owner-${orgId}`, orgId },
    74	      artifactId: `app-${orgId}`,
    75	      actionManifest: null,
    76	    },
    77	    realGroundingDeps(captured),
    78	  );
    79	  return { docIds: res.citations.map((c) => c.docId), systemPrompt: captured.systemPrompt ?? '' };
    80	}
    81	
    82	let dir: string;
    83	beforeEach(async () => {
    84	  dir = await mkdtemp(join(tmpdir(), 'ekoa-xorg-'));
    85	  process.env.EKOA_DATA_DIR = dir;
    86	  indexDoc({ orgId: ORG_A, ...DOC_A, createdAt: '2026-01-01T00:00:00.000Z' });
    87	  indexDoc({ orgId: ORG_B, ...DOC_B, createdAt: '2026-01-01T00:00:00.000Z' });
    88	});
    89	afterEach(async () => {
    90	  closeIndex();
    91	  delete process.env.EKOA_DATA_DIR;
    92	  await rm(dir, { recursive: true, force: true });
    93	});
    94	
    95	describe('served-app assistant retrieval is org-partitioned to the OWNER org (H5 cross-org isolation)', () => {
    96	  it("an org-A app's assistant retrieves + cites org A's fact and NEVER org B's", async () => {
    97	    const a = await ask(ORG_A, TOKEN_A);
    98	    expect(a.docIds).toContain('kb-a'); // org A's own fact is retrievable
    99	    expect(a.docIds).not.toContain('kb-b'); // org B's fact is not
   100	    expect(a.systemPrompt).toContain(TOKEN_A); // org A's fact reached the assistant prompt
   101	    expect(a.systemPrompt).not.toContain(TOKEN_B); // org B's token never entered the prompt
   102	  });
   103	
   104	  it("an org-B app's assistant asking for org A's fact retrieves NOTHING (isolation, not just non-citation)", async () => {
   105	    const b = await ask(ORG_B, TOKEN_A); // org-B-owned app, org-A's distinctive token
   106	    expect(b.docIds).not.toContain('kb-a'); // org A's fact is structurally unreachable from org B
   107	    expect(b.docIds).not.toContain('kb-b'); // and org B has no doc matching org A's token
   108	    expect(b.systemPrompt).not.toContain(TOKEN_A);
   109	  });
   110	
   111	  it('is symmetric - an org-B app cites org B, an org-A app asking org B\'s token gets nothing', async () => {
   112	    const b = await ask(ORG_B, TOKEN_B);
   113	    expect(b.docIds).toContain('kb-b');
   114	    expect(b.docIds).not.toContain('kb-a');
   115	    expect(b.systemPrompt).toContain(TOKEN_B);
   116	
   117	    const a = await ask(ORG_A, TOKEN_B);
   118	    expect(a.docIds).not.toContain('kb-b');
   119	    expect(a.systemPrompt).not.toContain(TOKEN_B);
   120	  });
   121	
   122	  it('the owner org, not the visitor context, decides the partition (steering is ignored)', async () => {
   123	    // The context above plants orgId:'attacker-org'; if grounding honoured it, an org-B app asking
   124	    // for org A's token could never even try org A - but more importantly, seeding an attacker org
   125	    // with org A's token must NOT leak. Seed attacker-org with org A's token and confirm the org-A
   126	    // app still only sees its OWN row, and the org-B app sees neither.
   127	    indexDoc({ orgId: 'attacker-org', docId: 'kb-x', collection: 'circulares', title: 'X', body: `codigo ${TOKEN_A}`, createdAt: '2026-01-01T00:00:00.000Z' });
   128	    const a = await ask(ORG_A, TOKEN_A);
   129	    expect(a.docIds).toContain('kb-a');
   130	    expect(a.docIds).not.toContain('kb-x'); // the steered attacker-org partition is never consulted
   131	    const b = await ask(ORG_B, TOKEN_A);
   132	    expect(b.docIds).not.toContain('kb-x');
   133	    expect(b.docIds).not.toContain('kb-a');
   134	  });
   135	});

 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-mdm0lP0m' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-1SmyQLJL' (errno=Operation not permitted)
     1	/**
     2	 * The real capability matrix (operator-run H1). REPLACES the S0 permissive-stub test: `can()` now
     3	 * enforces the brief §9a role→capability grid, not a blanket `true`. The H5 security assertions
     4	 * grep the source (api/src/auth/capabilities.ts) for the retired stub marker and fail if it
     5	 * survives; this suite pins the behavior that replaced it.
     6	 */
     7	import { describe, it, expect } from 'vitest';
     8	import { readFileSync } from 'node:fs';
     9	import { fileURLToPath } from 'node:url';
    10	import { dirname, resolve } from 'node:path';
    11	import { Capability } from '@ekoa/shared';
    12	import { can } from '../../src/auth/capabilities.js';
    13	
    14	const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/auth
    15	const API_SRC = resolve(HERE, '../../src'); // <root>/api/src
    16	const readSrc = (rel: string) => readFileSync(resolve(API_SRC, rel), 'utf8');
    17	
    18	// The authoritative grid. Every (role x capability) cell is asserted below - both the grants and
    19	// the denials - so a future edit to the matrix cannot silently widen a role.
    20	const EXPECTED: Record<'super-admin' | 'org-admin' | 'user', Record<Capability, boolean>> = {
    21	  'super-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
    22	  'org-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
    23	  user: { canBuildApps: false, canEditApps: false, canCreateArtifacts: true, canUseChat: true },
    24	};
    25	
    26	describe('can() capability matrix (H1)', () => {
    27	  it('every role x capability cell matches the brief grid (all 12 cells)', () => {
    28	    for (const role of Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>) {
    29	      for (const capability of Capability.options) {
    30	        expect(can({ role }, capability), `${role} / ${capability}`).toBe(EXPECTED[role][capability]);
    31	      }
    32	    }
    33	  });
    34	
    35	  it('a user holds exactly canUseChat + canCreateArtifacts - never the app build/edit capabilities', () => {
    36	    expect(can({ role: 'user' }, 'canUseChat')).toBe(true);
    37	    expect(can({ role: 'user' }, 'canCreateArtifacts')).toBe(true);
    38	    expect(can({ role: 'user' }, 'canBuildApps')).toBe(false);
    39	    expect(can({ role: 'user' }, 'canEditApps')).toBe(false);
    40	  });
    41	
    42	  it('admins (org-admin + super-admin) hold every capability', () => {
    43	    for (const role of ['org-admin', 'super-admin'] as const) {
    44	      for (const capability of Capability.options) {
    45	        expect(can({ role }, capability), `${role} / ${capability}`).toBe(true);
    46	      }
    47	    }
    48	  });
    49	
    50	  it('a null/undefined actor holds NOTHING (fail closed)', () => {
    51	    for (const capability of Capability.options) {
    52	      expect(can(null, capability), `null / ${capability}`).toBe(false);
    53	      expect(can(undefined, capability), `undefined / ${capability}`).toBe(false);
    54	    }
    55	  });
    56	
    57	  it('an unknown/stale role holds NOTHING (fail closed) - a signature-valid token carrying a dead role value grants nothing', () => {
    58	    // The `?? false` defensive branch in can(): a role not in the CAPABILITIES map (the retired
    59	    // `builder` value that somehow bypassed the verifyToken shim, or any garbage) is refused every
    60	    // capability. This is the security posture the H1 map §7 called out - capability must never
    61	    // default to "more" for an unrecognised role.
    62	    for (const capability of Capability.options) {
    63	      expect(can({ role: 'builder' as never }, capability), `stale-builder / ${capability}`).toBe(false);
    64	      expect(can({ role: 'root' as never }, capability), `garbage-root / ${capability}`).toBe(false);
    65	      expect(can({ role: '' as never }, capability), `empty-role / ${capability}`).toBe(false);
    66	    }
    67	  });
    68	
    69	  it('the capability vocabulary is the brief-designed set (unchanged by H1)', () => {
    70	    expect(Capability.options).toEqual(['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat']);
    71	  });
    72	});
    73	
    74	/**
    75	 * H5 gate-wiring assertion - the matrix ABOVE is the pure decision; this block proves each cell is
    76	 * actually ENFORCED at the routes that mint/mutate the gated resource, so the matrix cannot drift
    77	 * away from its enforcement points. It ties every capability to at least one wired `can(actor, '…')`
    78	 * call site, cross-referencing (NOT duplicating) the two integration suites that drive the behavior
    79	 * end-to-end over the real routers:
    80	 *   - api/tests/contract/jobs-capability.test.ts - POST /jobs first-build (canBuildApps) + follow-up
    81	 *     (canEditApps + writability/IDOR); a `user` refused, an org-admin proceeds, executor never
    82	 *     called on a refusal.
    83	 *   - api/tests/contract/artifacts-capability.test.ts - the in-place app-edit vectors (canEditApps
    84	 *     via denyAppEdit), import + fork-of-app (canBuildApps), and a `user` keeping non-app
    85	 *     create/fork (canCreateArtifacts).
    86	 * Here we assert the WIRING inventory (the source has the gate) so a future edit that silently drops
    87	 * a gate - leaving the matrix green but the route ungated - fails this suite.
    88	 */
    89	describe('capability gate wiring (H5) - the matrix is enforced at the routes', () => {
    90	  // capability -> the source file that must carry an enforcing `can(actor, '<capability>')` gate,
    91	  // with the vector it guards. A capability may be enforced in more than one file (e.g. canEditApps
    92	  // gates both the follow-up build and every in-place app-edit vector); each row is checked.
    93	  const WIRING: Array<{ capability: Capability; file: string; vector: string }> = [
    94	    { capability: 'canBuildApps', file: 'routes/jobs.ts', vector: 'first build (POST /jobs, no artifactId)' },
    95	    { capability: 'canEditApps', file: 'routes/jobs.ts', vector: 'follow-up build (POST /jobs, artifactId)' },
    96	    { capability: 'canUseChat', file: 'routes/chat.ts', vector: 'chat run (POST /chat/runs)' },
    97	    { capability: 'canCreateArtifacts', file: 'routes/artifacts.ts', vector: 'artifact create (POST /artifacts)' },
    98	    { capability: 'canEditApps', file: 'routes/artifacts.ts', vector: 'in-place app-edit vectors (denyAppEdit)' },
    99	    { capability: 'canBuildApps', file: 'routes/artifacts.ts', vector: 'import + fork-of-app' },
   100	    { capability: 'canEditApps', file: 'apps/app-assistant-route.ts', vector: 'served-app admin detection (whoami / isAppEditor)' },
   101	  ];
   102	
   103	  it.each(WIRING)('$capability is wired at $file - $vector', ({ capability, file }) => {
   104	    const src = readSrc(file);
   105	    // A real gate is a `can(` call whose argument list carries the capability literal. The fork
   106	    // vector passes the capability through a `forkCap` variable, but the literal is defined
   107	    // adjacent on the same statement, so the file-scoped literal-near-can() assertion still holds.
   108	    expect(src.includes('can('), `${file} must call can()`).toBe(true);
   109	    expect(src.includes(`'${capability}'`), `${file} must reference the ${capability} capability literal`).toBe(true);
   110	    // Tie them together: a `can(...)` call referencing this capability literal (allowing the
   111	    // forkCap indirection in artifacts.ts, where the literal sits on the ternary feeding can()).
   112	    const wiredDirectly = new RegExp(`can\\([^;]*'${capability}'`).test(src);
   113	    const wiredViaForkCap =
   114	      file === 'routes/artifacts.ts' && /forkCap\s*=\s*isAppArtifact[^;]*'canBuildApps'[^;]*'canCreateArtifacts'/.test(src) && /can\([^;]*forkCap/.test(src);
   115	    expect(wiredDirectly || wiredViaForkCap, `${file}: no can(actor, '${capability}') gate found`).toBe(true);
   116	  });
   117	
   118	  it('the two admin-only capabilities (a user is denied) are each enforced by a wired gate', () => {
   119	    // The matrix denies a `user` canBuildApps + canEditApps; both MUST have at least one enforcing
   120	    // gate, else the denial is unenforceable. (canUseChat + canCreateArtifacts are user-held; their
   121	    // gates refuse only a null/no-capability actor.)
   122	    for (const cap of ['canBuildApps', 'canEditApps'] as const) {
   123	      const enforced = WIRING.some((w) => w.capability === cap);
   124	      expect(enforced, `${cap} (admin-only) must be enforced somewhere`).toBe(true);
   125	      expect(can({ role: 'user' }, cap), `matrix: a user is denied ${cap}`).toBe(false);
   126	    }
   127	  });
   128	});

 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-J12Uo4cP' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-HMnO44L3' (errno=Operation not permitted)
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
   117	  it('every quoted `builder` role literal in api/src + shared/src + web{app,components,stores} is in the sanctioned allowlist', () => {
   118	    const hits = scanTree(
   119	      ['api/src', 'shared/src', 'web/app', 'web/components', 'web/stores'],
   120	      BUILDER_RE,
   121	    );
   122	    const orphans = hits.filter((h) => !BUILDER_ALLOWLIST.has(h.file));
   123	    expect(
   124	      orphans,
   125	      `NEW orphan \`builder\` role ref (not in the sanctioned allowlist):\n${orphans
   126	        .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
   127	        .join('\n')}\nIf this is a legitimate survivor, add it to BUILDER_ALLOWLIST with a comment; otherwise rename it to 'user'.`,
   128	    ).toEqual([]);
   129	    // Sanity: the allowlisted files ARE actually present in the tree (a stale allowlist entry that
   130	    // no longer matches anything is dead weight the gate should surface).
   131	    for (const allowed of BUILDER_ALLOWLIST) {
   132	      const stillHasLiteral = hits.some((h) => h.file === allowed);
   133	      expect(stillHasLiteral, `allowlist entry ${allowed} no longer carries a builder literal - prune it`).toBe(true);
   134	    }
   135	  });
   136	});
   137	
   138	/**
   139	 * NON-TAUTOLOGY PROOF (in-suite, durable): the pure matcher + allowlist logic detect planted
   140	 * violations and reject the exact identifiers they must NOT match. If someone weakens the regex into
   141	 * a no-op, THESE fail - so the two tree scans above can never silently become vacuous.
   142	 */
   143	describe('grep gate matchers are not vacuous (H5 self-test)', () => {
   144	  it('the builder-role matcher catches a planted role literal and ignores feature identifiers', () => {
   145	    // Planted violations - MUST match.
   146	    expect(matchingLines("const role = 'builder';", BUILDER_RE)).toEqual([1]);
   147	    expect(matchingLines('body.role = "builder"', BUILDER_RE)).toEqual([1]);
   148	    expect(matchingLines("Role = z.enum(['super-admin','org-admin','builder'])", BUILDER_RE)).toEqual([1]);
   149	    // Legitimate non-role uses - MUST NOT match (the precision the gate depends on).
   150	    expect(matchingLines('import { integrationBuilder } from "./x";', BUILDER_RE)).toEqual([]);
   151	    expect(matchingLines('const builderSessionId = newId();', BUILDER_RE)).toEqual([]);
   152	    expect(matchingLines('orgSettings.allowBuilderAutomations === true', BUILDER_RE)).toEqual([]);
   153	    expect(matchingLines('detectSiteBuilder(url)', BUILDER_RE)).toEqual([]);
   154	    expect(matchingLines('title: "Builder"', BUILDER_RE)).toEqual([]); // capitalised UI label, not a role value
   155	  });
   156	
   157	  it('the permissive-stub matcher catches both marker spellings', () => {
   158	    expect(matchingLines('return true; // PERMISSIVE-STUB', STUB_RE)).toEqual([1]);
   159	    expect(matchingLines('/* PERMISSIVE_STUB */', STUB_RE)).toEqual([1]);
   160	    expect(matchingLines('// a permissive stub over these names', STUB_RE)).toEqual([]); // prose, not the marker
   161	  });
   162	
   163	  it('the allowlist is not a blanket pass - a NEW orphan ref in a non-allowlisted file is flagged', () => {
   164	    const synthetic: Hit[] = [
   165	      { file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" },
   166	      { file: 'api/src/auth/jwt.ts', line: 61, text: "role 'builder'" }, // allowlisted survivor
   167	    ];
   168	    const orphans = synthetic.filter((h) => !BUILDER_ALLOWLIST.has(h.file));
   169	    expect(orphans).toEqual([{ file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" }]);
   170	  });
   171	});

exec
/bin/zsh -lc "git show 3ad6fb3:api/tests/security/destructive-action-authz.test.ts | nl -ba | sed -n '1,320p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-44hCA3FT' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-faOHW5It' (errno=Operation not permitted)
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
    28	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
    29	import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
    30	import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
    31	import { __resetConfigForTests, loadConfig } from '../../src/config.js';
    32	import { CollectionsEngine, appScope } from '../../src/data/collections-engine.js';
    33	import { appSsoRouter } from '../../src/integrations/app-sso.js';
    34	import type { ResolvedAppScope } from '../../src/integrations/app-scope.js';
    35	
    36	let mem: MongoMemoryServer;
    37	let server: Server;
    38	let port: number;
    39	let seq = 0;
    40	const deps = { now: () => Date.now(), genId: () => `id_${seq++}` };
    41	
    42	// Two apps, two owners, two disjoint per-app SSO namespaces. A session minted for app2 must NEVER
    43	// authorize a mutation against app1.
    44	const APPS: Record<string, ResolvedAppScope> = {
    45	  app1: { appId: 'app1', ownerUserId: 'owner1', isServed: true, m365Proxy: true },
    46	  app2: { appId: 'app2', ownerUserId: 'owner2', isServed: true, m365Proxy: true },
    47	};
    48	const resolveAppScope = async (idOrSlug: string): Promise<ResolvedAppScope | null> => APPS[idOrSlug] ?? null;
    49	
    50	const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);
    51	
    52	beforeAll(async () => {
    53	  process.env.ENCRYPTION_KEY = 'k';
    54	  process.env.JWT_SECRET = 's';
    55	  __resetConfigForTests();
    56	  loadConfig();
    57	  mem = await createMem();
    58	  await connectMongo(mem.getUri(), 'ekoa_destructive_authz');
    59	  const app = express();
    60	  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope, crossSite: false }));
    61	  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    62	  port = (server.address() as { port: number }).port;
    63	}, 60_000);
    64	
    65	afterAll(async () => {
    66	  server.close();
    67	  await closeMongo();
    68	  await mem.stop();
    69	});
    70	
    71	beforeEach(async () => {
    72	  __resetActivationForTests();
    73	  setActivation('owner1', { active: true, billingLocked: false });
    74	  setActivation('owner2', { active: true, billingLocked: false });
    75	  await getDb().collection('app_data').deleteMany({});
    76	  await getDb().collection('app_sessions').deleteMany({});
    77	  // Seed one end-user into each app's own user collection (the password-auth surface).
    78	  const engine = new CollectionsEngine(deps);
    79	  await engine.create(appScope('app1'), 'utilizadores', { email: 'ana@app1.pt', passwordHash: await bcrypt.hash('segredo123', 12), name: 'Ana', role: 'user' });
    80	  await engine.create(appScope('app2'), 'utilizadores', { email: 'rui@app2.pt', passwordHash: await bcrypt.hash('segredo456', 12), name: 'Rui', role: 'user' });
    81	});
    82	
    83	const cookieFrom = (res: Response) => (res.headers.get('set-cookie') || '').split(';')[0] as string;
    84	const loginApp = (appId: string, identity: string, password: string) =>
    85	  api('/api/app-sso/login', {
    86	    method: 'POST',
    87	    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId },
    88	    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
    89	  });
    90	const setPassword = (appId: string, identity: string, password: string, cookie?: string) =>
    91	  api('/api/app-sso/set-password', {
    92	    method: 'POST',
    93	    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId, ...(cookie ? { cookie } : {}) },
    94	    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
    95	  });
    96	
    97	describe('set-password (a mutating app op) is authorized server-side by the app-sso identity, not client confirmation', () => {
    98	  it('WITHOUT a valid app-sso session -> 401 not_authenticated (the server rejects the mutation on identity alone; no confirmation param can substitute)', async () => {
    99	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01'); // no cookie
   100	    expect(res.status).toBe(401);
   101	    expect(((await res.json()) as { error: string }).error).toBe('not_authenticated');
   102	    // And the mutation did NOT happen: the old password still logs in, the new one does not.
   103	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(401);
   104	    expect((await loginApp('app1', 'ana@app1.pt', 'segredo123')).status).toBe(200);
   105	  });
   106	
   107	  it('with a WRONG-APP session (an app2 session presented to app1) -> 401 (session.appId isolation; the cross-app mutation is refused)', async () => {
   108	    const app2Cookie = cookieFrom(await loginApp('app2', 'rui@app2.pt', 'segredo456'));
   109	    expect(app2Cookie).toContain('ekoa_app_sso_app2=');
   110	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01', app2Cookie);
   111	    expect(res.status).toBe(401); // findValidAppSession(token, 'app1') is null: the session is bound to app2
   112	    // The app1 row is untouched - the wrong-app session authorized nothing.
   113	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(401);
   114	    expect((await loginApp('app1', 'ana@app1.pt', 'segredo123')).status).toBe(200);
   115	  });
   116	
   117	  it('with the CORRECT same-app session (self) -> 200: the app-sso identity - and only it - authorizes the mutation', async () => {
   118	    const app1Cookie = cookieFrom(await loginApp('app1', 'ana@app1.pt', 'segredo123'));
   119	    const res = await setPassword('app1', 'ana@app1.pt', 'novapass01', app1Cookie);
   120	    expect(res.status).toBe(200);
   121	    expect(await res.json()).toEqual({ success: true });
   122	    // The server-side mutation took effect: the new password now logs in. There was no client
   123	    // confirmation in the request - the app-sso session identity is the whole boundary.
   124	    expect((await loginApp('app1', 'ana@app1.pt', 'novapass01')).status).toBe(200);
   125	  });
   126	});
   127	
   128	describe('the visitor-acting Microsoft Graph proxy is gated by the app-sso session too', () => {
   129	  it('WITHOUT a session -> 401 not_authenticated (a mutating /m365/* forward never runs unauthenticated)', async () => {
   130	    const res = await api('/api/app-sso/m365/v1.0/me', { method: 'POST', headers: { 'x-ekoa-app-id': 'app1' } });
   131	    expect(res.status).toBe(401);
   132	    expect(((await res.json()) as { error: string }).error).toBe('not_authenticated');
   133	  });
   134	
   135	  it('with a WRONG-APP session -> 401 (a session bound to app2 cannot act on app1)', async () => {
   136	    const app2Cookie = cookieFrom(await loginApp('app2', 'rui@app2.pt', 'segredo456'));
   137	    const res = await api('/api/app-sso/m365/v1.0/me', {
   138	      method: 'POST',
   139	      headers: { 'x-ekoa-app-id': 'app1', cookie: app2Cookie },
   140	    });
   141	    expect(res.status).toBe(401);
   142	  });
   143	});

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "git show 3ad6fb3:api/tests/e2e/request-changes-journey.e2e.mjs | nl -ba | sed -n '1,360p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:api/tests/e2e/edit-journey.e2e.mjs | nl -ba | sed -n '1,360p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-OSg5bhQD' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-VR21dXzB' (errno=Operation not permitted)
     1	#!/usr/bin/env node
     2	/**
     3	 * REQUEST-CHANGES JOURNEY live gate - committed, re-runnable end-to-end driver (operator-run H,
     4	 * security block H4/H1). Authored by H5; the OPERATOR runs it. This is the LIVE proof of the H4
     5	 * request-changes queue journey:
     6	 *
     7	 *   a user files a change request from INSIDE a served app (with route + screen context) -> it lands
     8	 *   in the app OWNER org's queue (never another org's) -> an org-admin SEES it with that context ->
     9	 *   converting it STARTS an H1-gated edit-mode patch run and links the resulting jobId.
    10	 *
    11	 * It also folds in H4's LIVE CROSS-ORG proof: a user in ANOTHER org filing about the same app gets a
    12	 * uniform 404 and injects NOTHING into the owner org's queue (no cross-org write, no admin notify).
    13	 *
    14	 * WHAT IT ASSERTS (server-side, mostly non-LLM - file + queue read + convert are cheap):
    15	 *   1. FILE (in-org). A role:'user' in the app owner's org POSTs /api/v1/change-requests with
    16	 *      X-Ekoa-App-Id + {text, route, screenState}. Server stamps orgId = the OWNER org (not the
    17	 *      caller body), status 'open', requesterUserId from the JWT, and echoes the route/screen context.
    18	 *   2. CROSS-ORG ISOLATION. A role:'user' in a DIFFERENT org filing about the SAME app -> 404, and
    19	 *      the request never appears in the owner org's queue (loadReadable gate; no injection oracle).
    20	 *   3. ORG-ADMIN SEES IT WITH CONTEXT. GET /api/v1/change-requests?status=open surfaces the in-org
    21	 *      request with its text + route + screenState + requesterName; the cross-org attempt is absent.
    22	 *   4. CONVERT STARTS A PATCH RUN. The admin POSTs an H1-gated follow-up build (POST /jobs
    23	 *      {artifactId}) -> jobId, then POST /:id/convert {jobId} flips the row to 'converted' + records
    24	 *      the jobId. Per the brief, convert is asserted at the API level WITHOUT awaiting the full build
    25	 *      (the patch run is STARTED, then cancelled) - the row flip + jobId link is the assertion.
    26	 *
    27	 * BUDGET (hard-capped): ONE real SETUP build (an org-shared, owner-owned app to file about; skipped
    28	 * if REQCHG_APP_ID names one) + ONE follow-up build STARTED and immediately CANCELLED for the convert
    29	 * (never awaited). Set REQCHG_APP_ID=<artifactId> (an admin-owned app that will be made org-shared)
    30	 * to skip the setup build.
    31	 *
    32	 * NOTE (org scoping): this driver reads the queue as the seeded super-admin (which the H4 gate admits
    33	 * exactly as an org-admin, requireRole('org-admin','super-admin')). The org-admin-own-org-only
    34	 * scoping is proven deterministically in api/tests/routes/change-requests.test.ts; here the live
    35	 * proof is the FILE -> owner-org stamp -> SEE-with-context -> CONVERT round-trip + the cross-org 404.
    36	 *
    37	 * TRANSIENT TOLERANCE + single-shot build create mirror fees-knowledge.e2e.mjs. NO PRODUCTION CODE
    38	 * CHANGE. Run: node tests/e2e/request-changes-journey.e2e.mjs
    39	 */
    40	import { readFileSync } from 'node:fs';
    41	import { join, dirname } from 'node:path';
    42	import { fileURLToPath } from 'node:url';
    43	
    44	const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    45	const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
    46	const BASE = `http://localhost:${PORT}`;
    47	const ADMIN = { username: 'admin', password: 'tmp12345' };
    48	
    49	const BUILD_TIMEOUT_MS = 20 * 60_000;
    50	const MAX_POLL_TRANSIENTS = 30;
    51	
    52	const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase();
    53	const SETUP_DESC = 'Uma aplicacao simples de registo de clientes com nome e email.';
    54	const REQ_TEXT = `Por favor adicione um campo de telefone ao formulario de cliente (${RUN}).`;
    55	const REQ_ROUTE = '/clientes/novo';
    56	const REQ_SCREEN = 'formulario de novo cliente aberto, campos nome+email visiveis';
    57	const REQCHG_APP_ID = process.env.REQCHG_APP_ID || null;
    58	
    59	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    60	class E2EFailure extends Error {}
    61	function fail(msg) { throw new E2EFailure(`E2E FAIL: ${msg}`); }
    62	function ok(msg) { console.log(`PASS ${msg}`); }
    63	function assert(cond, msg) { if (!cond) fail(msg); }
    64	
    65	async function safeJson(url, init) {
    66	  try {
    67	    const r = await fetch(url, init);
    68	    const text = await r.text();
    69	    let json = null;
    70	    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    71	    return { ok: r.ok && json !== null, status: r.status, json, text };
    72	  } catch (e) {
    73	    return { ok: false, status: 0, json: null, text: String(e && e.message ? e.message : e) };
    74	  }
    75	}
    76	
    77	async function login(creds) {
    78	  for (let i = 0; i < 10; i++) {
    79	    const res = await safeJson(`${BASE}/api/v1/auth/login`, {
    80	      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
    81	    });
    82	    if (res.ok && res.json.token) return res.json.token;
    83	    await sleep(500);
    84	  }
    85	  fail(`login failed for ${creds.username} after retries`);
    86	}
    87	
    88	async function me(token) {
    89	  const res = await safeJson(`${BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    90	  assert(res.ok && res.json && res.json.orgId, `GET /auth/me failed (status ${res.status})`);
    91	  return res.json;
    92	}
    93	
    94	/** Create a role:'user' account (super-admin only). orgId optional (absent -> a fresh org). Returns
    95	 *  { id, token, username }. */
    96	async function makeUser(adminToken, orgId) {
    97	  const creds = { username: `rc-${orgId ? 'in' : 'out'}-${RUN}`.toLowerCase(), password: 'userpass12345' };
    98	  const res = await safeJson(`${BASE}/api/v1/users`, {
    99	    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
   100	    body: JSON.stringify({ username: creds.username, password: creds.password, role: 'user', ...(orgId ? { orgId } : {}) }),
   101	  });
   102	  assert(res.ok && res.json && res.json.id, `create user failed (status ${res.status}): ${res.text.slice(0, 200)}`);
   103	  const token = await login(creds);
   104	  return { id: res.json.id, token, username: creds.username };
   105	}
   106	
   107	async function startBuild(token, description, artifactId) {
   108	  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
   109	  await safeJson(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
   110	  let sessionId = null;
   111	  for (let i = 0; i < 10 && !sessionId; i++) {
   112	    const s = await safeJson(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: `reqchg-${RUN}` }) });
   113	    if (s.ok && s.json.id) sessionId = s.json.id; else await sleep(500);
   114	  }
   115	  assert(sessionId, 'could not create a session after retries');
   116	  const body = { kind: 'build', sessionId, language: 'pt', description, ...(artifactId ? { artifactId } : { templateId: 'app' }) };
   117	  const created = await safeJson(`${BASE}/api/v1/jobs`, { method: 'POST', headers: H, body: JSON.stringify(body) });
   118	  assert(created.ok && created.json.job && created.json.job.id, `job not created (status ${created.status}): ${created.text.slice(0, 200)}`);
   119	  return created.json.job.id;
   120	}
   121	
   122	async function awaitBuild(token, jobId) {
   123	  const H = { Authorization: `Bearer ${token}` };
   124	  const deadline = Date.now() + BUILD_TIMEOUT_MS;
   125	  let transients = 0;
   126	  for (;;) {
   127	    if (Date.now() > deadline) fail(`build ${jobId} did not finish in ${BUILD_TIMEOUT_MS / 60_000}min`);
   128	    await sleep(6000);
   129	    const res = await safeJson(`${BASE}/api/v1/jobs/${jobId}`, { headers: H });
   130	    if (!res.ok) {
   131	      if (res.json && res.status >= 400 && res.status < 500) fail(`build poll: deterministic API error ${res.status}: ${res.text.slice(0, 200)}`);
   132	      if (++transients > MAX_POLL_TRANSIENTS) fail(`build poll: ${transients} consecutive transients (last ${res.status})`);
   133	      await sleep(1000);
   134	      continue;
   135	    }
   136	    transients = 0;
   137	    const job = res.json;
   138	    if (job.status === 'completed') { assert(job.artifactId, `completed build ${jobId} has no artifactId`); return job.artifactId; }
   139	    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
   140	    if (job.status === 'cancelled') fail(`setup build ${jobId} was cancelled`);
   141	  }
   142	}
   143	
   144	const fileRequest = (token, appId, extra = {}) =>
   145	  safeJson(`${BASE}/api/v1/change-requests`, {
   146	    method: 'POST',
   147	    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Ekoa-App-Id': appId },
   148	    body: JSON.stringify({ text: REQ_TEXT, route: REQ_ROUTE, screenState: REQ_SCREEN, ...extra }),
   149	  });
   150	
   151	async function main() {
   152	  const adminToken = await login(ADMIN);
   153	  const admin = await me(adminToken);
   154	  ok(`admin login (org ${admin.orgId})`);
   155	
   156	  // --- Setup: an org-shared, admin-owned app to file about ----------------------------------------
   157	  let appId = REQCHG_APP_ID;
   158	  if (appId) {
   159	    ok(`reusing REQCHG_APP_ID=${appId} (no setup build)`);
   160	  } else {
   161	    const setupJob = await startBuild(adminToken, SETUP_DESC);
   162	    appId = await awaitBuild(adminToken, setupJob);
   163	    ok(`setup build completed -> app ${appId}`);
   164	  }
   165	  // Make it org-shared so a same-org user can READ (loadReadable) it and file about it.
   166	  const patch = await safeJson(`${BASE}/api/v1/artifacts/${encodeURIComponent(appId)}`, {
   167	    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
   168	    body: JSON.stringify({ visibility: 'org' }),
   169	  });
   170	  assert(patch.ok, `could not make app org-shared (status ${patch.status}): ${patch.text.slice(0, 200)}`);
   171	  ok('app set to org-shared (visibility: org)');
   172	
   173	  // --- Two users: one in the app owner's org, one in a different org -------------------------------
   174	  const inOrgUser = await makeUser(adminToken, admin.orgId);
   175	  const otherOrgUser = await makeUser(adminToken, null); // fresh org
   176	  ok(`created in-org user ${inOrgUser.username} + cross-org user ${otherOrgUser.username}`);
   177	
   178	  // --- 1. FILE from inside the app (in-org user) --------------------------------------------------
   179	  const filed = await fileRequest(inOrgUser.token, appId);
   180	  assert(filed.status === 200 && filed.json && filed.json.id, `file failed (status ${filed.status}): ${filed.text.slice(0, 200)}`);
   181	  const reqId = filed.json.id;
   182	  assert(filed.json.orgId === admin.orgId, `request stamped org ${filed.json.orgId}, expected owner org ${admin.orgId}`);
   183	  assert(filed.json.status === 'open', `filed request status ${filed.json.status}, expected 'open'`);
   184	  assert(filed.json.requesterUserId === inOrgUser.id, `requesterUserId ${filed.json.requesterUserId} != ${inOrgUser.id}`);
   185	  assert(filed.json.route === REQ_ROUTE && filed.json.screenState === REQ_SCREEN, 'route/screenState context not echoed on the filed request');
   186	  ok(`FILE: request ${reqId} filed into owner org ${admin.orgId} with route/screen context`);
   187	
   188	  // --- 2. CROSS-ORG ISOLATION (H4 live proof) -----------------------------------------------------
   189	  const crossOrg = await fileRequest(otherOrgUser.token, appId, { text: `INJECTION ATTEMPT ${RUN}` });
   190	  assert(crossOrg.status === 404, `cross-org file must be 404 (no injection), got ${crossOrg.status}: ${crossOrg.text.slice(0, 160)}`);
   191	  ok('CROSS-ORG: a different-org user filing about the app -> 404 (no injection)');
   192	
   193	  // --- 3. ORG-ADMIN SEES IT WITH CONTEXT ----------------------------------------------------------
   194	  const queue = await safeJson(`${BASE}/api/v1/change-requests?status=open`, { headers: { Authorization: `Bearer ${adminToken}` } });
   195	  assert(queue.ok && queue.json && Array.isArray(queue.json.items), `queue read failed (status ${queue.status}): ${queue.text.slice(0, 160)}`);
   196	  const seen = queue.json.items.find((c) => c.id === reqId);
   197	  assert(seen, `the filed request ${reqId} is not visible in the org-admin queue`);
   198	  assert(seen.text === REQ_TEXT && seen.route === REQ_ROUTE && seen.screenState === REQ_SCREEN, 'the queue row lost its text/route/screen context');
   199	  assert(typeof seen.requesterName === 'string' && seen.requesterName.length > 0, 'the queue row has no requesterName context');
   200	  // The cross-org injection attempt must NOT be anywhere in the queue.
   201	  const injected = queue.json.items.find((c) => c.requesterUserId === otherOrgUser.id);
   202	  assert(!injected, `cross-org injection LEAKED into the queue: ${JSON.stringify(injected)}`);
   203	  ok('SEE: org-admin sees the request with full context; the cross-org attempt is absent');
   204	
   205	  // --- 4. CONVERT starts an H1-gated patch run (asserted at the API level; build not awaited) ------
   206	  const convertJob = await startBuild(adminToken, REQ_TEXT, appId); // H1-gated follow-up build (admin: canEditApps + loadWritable ok)
   207	  ok(`CONVERT: admin started the patch-run follow-up build ${convertJob} (H1-gated)`);
   208	  const converted = await safeJson(`${BASE}/api/v1/change-requests/${encodeURIComponent(reqId)}/convert`, {
   209	    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
   210	    body: JSON.stringify({ jobId: convertJob }),
   211	  });
   212	  assert(converted.ok && converted.json, `convert failed (status ${converted.status}): ${converted.text.slice(0, 200)}`);
   213	  assert(converted.json.status === 'converted', `converted request status ${converted.json.status}, expected 'converted'`);
   214	  assert(converted.json.jobId === convertJob, `converted request jobId ${converted.json.jobId} != ${convertJob}`);
   215	  ok(`CONVERT: request ${reqId} -> 'converted' linked to patch-run job ${convertJob}`);
   216	  // Budget hygiene: cancel the started patch run (the convert is asserted at the API level - we do
   217	  // NOT await the full build). Best-effort; a cancel blip does not affect the assertions above.
   218	  await safeJson(`${BASE}/api/v1/jobs/${encodeURIComponent(convertJob)}/cancel`, {
   219	    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: '{}',
   220	  });
   221	  console.log(`  cancelled the started patch-run build ${convertJob} (budget hygiene; best-effort)`);
   222	
   223	  console.log('REQUEST-CHANGES JOURNEY LIVE GATE: PASS');
   224	}
   225	
   226	main().catch((e) => {
   227	  console.error(e instanceof E2EFailure ? e.message : `E2E FAIL: ${e && e.stack ? e.stack : String(e)}`);
   228	  process.exit(1);
   229	});

 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-GmlK4lgu' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Pzb4jd8u' (errno=Operation not permitted)
     1	#!/usr/bin/env node
     2	/**
     3	 * EDIT-MODE JOURNEY live gate - committed, re-runnable end-to-end driver (operator-run H, security
     4	 * block H3/H2/H1). Authored by H5; the OPERATOR runs it (it burns real builds). This is the LIVE
     5	 * proof of the served-app admin EDIT-MODE journey the security block built:
     6	 *
     7	 *   detect (H2 whoami true) -> explicit opt-in (client-side, never auto) -> edit request -> patch run
     8	 *   (an H1-gated follow-up build) -> preview/diff (versions) -> approve (keep the new head) ->
     9	 *   rollback restores (forward-restore to the pre-run head) ; AND a plain user-role session is proven
    10	 *   UNABLE to reach edit (whoami false + POST /jobs follow-up refused).
    11	 *
    12	 * WHAT IT ASSERTS (all server-observable - the client confirmation/opt-in is UX, not the boundary):
    13	 *   1. DETECT. GET /api/app-assistant/whoami on the admin's own app, with the admin platform Bearer,
    14	 *      returns { admin: true } (H2: can(canEditApps) AND loadWritable ok). Detect-then-ask: this is a
    15	 *      HINT; nothing is auto-enabled - the opt-in below is a separate, explicit, client-only step.
    16	 *   2. PATCH RUN. The admin issues an edit as a FOLLOW-UP build: POST /api/v1/jobs { artifactId,
    17	 *      description } with the admin Bearer. H1 re-gates it server-side (canEditApps + loadWritable);
    18	 *      it completes and produces a NEW git head (the preview/diff point).
    19	 *   3. PREVIEW + APPROVE. GET /versions shows the new head != the pre-run head; approve keeps it (the
    20	 *      build already activated it - no server call).
    21	 *   4. ROLLBACK restores. POST /versions/:preRunSha/restore is a one-click FORWARD restore (H3): it
    22	 *      returns 200 and advances HEAD to a new [restored] commit whose tree is the pre-run head - the
    23	 *      revert is real and auditable (HEAD never moves backward).
    24	 *   5. USER CANNOT EDIT. A freshly-created role:'user' session gets { admin: false } from whoami on
    25	 *      the SAME app, and its POST /jobs follow-up is refused 403 (canEditApps) - the panel never
    26	 *      offers, and the server never permits, an edit to a non-admin.
    27	 *
    28	 * BUDGET (hard-capped): up to 2 real builds - one SETUP build to have an admin-owned app to edit
    29	 * (skipped if EDIT_APP_ID names an existing admin-owned, admin-writable app), plus one PATCH-RUN
    30	 * build - and one rollback restore. Set EDIT_APP_ID=<artifactId> to reuse an existing app and spend
    31	 * only the patch-run build.
    32	 *
    33	 * TRANSIENT TOLERANCE mirrors fees-knowledge.e2e.mjs: safeJson never throws on a non-JSON body (the
    34	 * dev proxy can answer a text/plain 502 mid-build); the build poll tolerates bounded transient blips
    35	 * but fails loud on a deterministic 4xx; the build-CREATE POST is single-shot (a retry could spawn a
    36	 * second build). NO PRODUCTION CODE CHANGE - black-box over the running dev stack (backend.port).
    37	 * Run: node tests/e2e/edit-journey.e2e.mjs
    38	 */
    39	import { readFileSync } from 'node:fs';
    40	import { join, dirname } from 'node:path';
    41	import { fileURLToPath } from 'node:url';
    42	
    43	const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    44	const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
    45	const BASE = `http://localhost:${PORT}`;
    46	const ADMIN = { username: 'admin', password: 'tmp12345' };
    47	
    48	const BUILD_TIMEOUT_MS = 20 * 60_000; // a cold-stack build can take ~12min (see fees-knowledge)
    49	const MAX_POLL_TRANSIENTS = 30;
    50	const MAX_BUILDS = 2; // setup + patch-run (hard cap)
    51	
    52	// A unique per-run suffix so a created user + app never collide across reruns on the shared stack.
    53	const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase();
    54	const SETUP_DESC = 'Uma aplicacao simples de lista de tarefas com um titulo e itens.';
    55	const EDIT_DESC = 'Adiciona um botao para marcar todas as tarefas como concluidas.';
    56	const EDIT_APP_ID = process.env.EDIT_APP_ID || null;
    57	
    58	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    59	class E2EFailure extends Error {}
    60	function fail(msg) { throw new E2EFailure(`E2E FAIL: ${msg}`); }
    61	function ok(msg) { console.log(`PASS ${msg}`); }
    62	function assert(cond, msg) { if (!cond) fail(msg); }
    63	
    64	let buildsSpent = 0;
    65	
    66	/** Fetch + parse JSON WITHOUT throwing (transient-tolerant): { ok, status, json, text }. */
    67	async function safeJson(url, init) {
    68	  try {
    69	    const r = await fetch(url, init);
    70	    const text = await r.text();
    71	    let json = null;
    72	    try { json = JSON.parse(text); } catch { /* non-JSON: proxy error text, HTML, empty */ }
    73	    return { ok: r.ok && json !== null, status: r.status, json, text };
    74	  } catch (e) {
    75	    return { ok: false, status: 0, json: null, text: String(e && e.message ? e.message : e) };
    76	  }
    77	}
    78	
    79	async function login(creds) {
    80	  for (let i = 0; i < 10; i++) {
    81	    const res = await safeJson(`${BASE}/api/v1/auth/login`, {
    82	      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
    83	    });
    84	    if (res.ok && res.json.token) return res.json.token;
    85	    await sleep(500);
    86	  }
    87	  fail(`login failed for ${creds.username} after retries`);
    88	}
    89	
    90	async function me(token) {
    91	  const res = await safeJson(`${BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    92	  assert(res.ok && res.json && res.json.orgId, `GET /auth/me failed (status ${res.status})`);
    93	  return res.json;
    94	}
    95	
    96	/** whoami for a served app, with an OPTIONAL platform Bearer. Returns the parsed { admin } (or fails
    97	 *  loud on a non-200 - a 400/404 means the app id is malformed/unknown, not a detection result). */
    98	async function whoami(appId, token) {
    99	  const headers = { 'X-Ekoa-App-Id': appId, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
   100	  const res = await safeJson(`${BASE}/api/app-assistant/whoami`, { headers });
   101	  assert(res.status === 200 && res.json && typeof res.json.admin === 'boolean', `whoami(${appId}) not 200{admin} (status ${res.status}): ${res.text.slice(0, 160)}`);
   102	  return res.json.admin;
   103	}
   104	
   105	/** Start a build (first build if no artifactId, else a follow-up patch run). Returns the job id.
   106	 *  SINGLE-SHOT create (never retried - a retry could spawn a second build). Counts against MAX_BUILDS. */
   107	async function startBuild(token, description, artifactId) {
   108	  if (buildsSpent >= MAX_BUILDS) fail(`build budget (${MAX_BUILDS}) exhausted before "${description.slice(0, 40)}"`);
   109	  buildsSpent += 1;
   110	  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
   111	  // Verify OFF (nondeterministic + orthogonal - same pattern as the F2/G1 drivers). Best-effort.
   112	  await safeJson(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
   113	  let sessionId = null;
   114	  for (let i = 0; i < 10 && !sessionId; i++) {
   115	    const s = await safeJson(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: `edit-journey-${RUN}` }) });
   116	    if (s.ok && s.json.id) sessionId = s.json.id; else await sleep(500);
   117	  }
   118	  assert(sessionId, 'could not create a session after retries');
   119	  const body = { kind: 'build', sessionId, language: 'pt', description, ...(artifactId ? { artifactId } : { templateId: 'app' }) };
   120	  const created = await safeJson(`${BASE}/api/v1/jobs`, { method: 'POST', headers: H, body: JSON.stringify(body) });
   121	  assert(created.ok && created.json.job && created.json.job.id, `job not created (status ${created.status}): ${created.text.slice(0, 200)}`);
   122	  return created.json.job.id;
   123	}
   124	
   125	/** Poll GET /jobs/:id until terminal, tolerating bounded transient blips. Returns the artifactId. */
   126	async function awaitBuild(token, jobId) {
   127	  const H = { Authorization: `Bearer ${token}` };
   128	  const deadline = Date.now() + BUILD_TIMEOUT_MS;
   129	  let transients = 0;
   130	  for (;;) {
   131	    if (Date.now() > deadline) fail(`build ${jobId} did not finish in ${BUILD_TIMEOUT_MS / 60_000}min`);
   132	    await sleep(6000);
   133	    const res = await safeJson(`${BASE}/api/v1/jobs/${jobId}`, { headers: H });
   134	    if (!res.ok) {
   135	      if (res.json && res.status >= 400 && res.status < 500) fail(`build poll: deterministic API error ${res.status} (not a transient): ${res.text.slice(0, 200)}`);
   136	      if (++transients > MAX_POLL_TRANSIENTS) fail(`build poll: ${transients} consecutive transient responses (last ${res.status})`);
   137	      await sleep(1000);
   138	      continue;
   139	    }
   140	    transients = 0;
   141	    const job = res.json;
   142	    if (job.status === 'completed') { assert(job.artifactId, `completed build ${jobId} has no artifactId`); return job.artifactId; }
   143	    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
   144	    if (job.status === 'cancelled') fail(`build ${jobId} was cancelled`);
   145	  }
   146	}
   147	
   148	/** GET /versions -> the items array (newest first; items[0].sha = HEAD). */
   149	async function versions(token, appId) {
   150	  const res = await safeJson(`${BASE}/api/v1/artifacts/${encodeURIComponent(appId)}/versions`, { headers: { Authorization: `Bearer ${token}` } });
   151	  assert(res.ok && res.json && Array.isArray(res.json.items), `GET /versions failed (status ${res.status}): ${res.text.slice(0, 160)}`);
   152	  return res.json.items;
   153	}
   154	
   155	async function main() {
   156	  // --- Admin identity + an admin-owned app to edit -------------------------------------------------
   157	  const adminToken = await login(ADMIN);
   158	  ok('admin login');
   159	
   160	  let appId = EDIT_APP_ID;
   161	  if (appId) {
   162	    ok(`reusing EDIT_APP_ID=${appId} (no setup build)`);
   163	  } else {
   164	    const setupJob = await startBuild(adminToken, SETUP_DESC);
   165	    appId = await awaitBuild(adminToken, setupJob);
   166	    ok(`setup build completed -> app ${appId}`);
   167	  }
   168	
   169	  // --- 1. DETECT (H2 whoami) + explicit opt-in (client-only) --------------------------------------
   170	  assert((await whoami(appId, adminToken)) === true, `admin whoami on own app must be true (canEditApps + loadWritable ok)`);
   171	  ok('DETECT: admin whoami -> { admin: true }');
   172	  // Explicit opt-in is a CLIENT-ONLY step (the panel edit-mode switch). Detect-then-ask is binding:
   173	  // whoami:true auto-enables nothing; the human toggles the switch. No server call - logged for the record.
   174	  console.log('  opt-in: explicit client-side editMode switch (detect-then-ask; no server call)');
   175	
   176	  // --- 2. PATCH RUN (H1-gated follow-up build) + 3. PREVIEW ----------------------------------------
   177	  const preRun = await versions(adminToken, appId);
   178	  const preRunSha = preRun[0] && preRun[0].sha;
   179	  assert(preRunSha, 'no pre-run HEAD sha from /versions');
   180	  const editJob = await startBuild(adminToken, EDIT_DESC, appId); // follow-up: H1 re-gates server-side
   181	  const editArtifact = await awaitBuild(adminToken, editJob);
   182	  assert(editArtifact === appId, `follow-up build returned a different artifact (${editArtifact} != ${appId})`);
   183	  const afterEdit = await versions(adminToken, appId);
   184	  const newHeadSha = afterEdit[0] && afterEdit[0].sha;
   185	  assert(newHeadSha && newHeadSha !== preRunSha, `patch run did not advance HEAD (pre ${preRunSha}, post ${newHeadSha})`);
   186	  ok(`PATCH RUN: follow-up build completed; HEAD advanced ${preRunSha.slice(0, 8)} -> ${newHeadSha.slice(0, 8)}`);
   187	  // 3. APPROVE keeps the new head - the build already activated it; there is NO server call to approve.
   188	  ok('PREVIEW + APPROVE: new head is live (approve is a no-op - the build already activated it)');
   189	
   190	  // --- 4. ROLLBACK restores (H3 forward-restore to the pre-run head) ------------------------------
   191	  const restore = await safeJson(`${BASE}/api/v1/artifacts/${encodeURIComponent(appId)}/versions/${encodeURIComponent(preRunSha)}/restore`, {
   192	    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: '{}',
   193	  });
   194	  assert(restore.ok, `rollback restore failed (status ${restore.status}): ${restore.text.slice(0, 200)}`);
   195	  const afterRollback = await versions(adminToken, appId);
   196	  const restoredHead = afterRollback[0] && afterRollback[0].sha;
   197	  // Forward-restore: HEAD advances to a NEW [restored] commit (never moves backward), whose tree is
   198	  // the pre-run head. So the head changed again AND the history grew - the revert is real + auditable.
   199	  assert(restoredHead && restoredHead !== newHeadSha, `rollback did not advance HEAD past the edit (still ${newHeadSha.slice(0, 8)})`);
   200	  assert(afterRollback.length >= afterEdit.length, `rollback did not add a restore commit (history did not grow)`);
   201	  ok(`ROLLBACK: forward-restore to pre-run head created a new head ${restoredHead.slice(0, 8)} (revert is live + auditable)`);
   202	
   203	  // --- 5. A user-role session CANNOT reach edit ---------------------------------------------------
   204	  const userCreds = { username: `edit-user-${RUN}`.toLowerCase(), password: 'userpass12345' };
   205	  const createUser = await safeJson(`${BASE}/api/v1/users`, {
   206	    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
   207	    body: JSON.stringify({ username: userCreds.username, password: userCreds.password, role: 'user' }),
   208	  });
   209	  assert(createUser.ok, `could not create the role:'user' account (status ${createUser.status}): ${createUser.text.slice(0, 200)}`);
   210	  const userToken = await login(userCreds);
   211	  ok(`created + logged in a role:'user' account (${userCreds.username})`);
   212	
   213	  assert((await whoami(appId, userToken)) === false, `user whoami on the admin app must be false (no canEditApps)`);
   214	  ok('USER CANNOT EDIT: user whoami -> { admin: false }');
   215	
   216	  const userFollowUp = await safeJson(`${BASE}/api/v1/jobs`, {
   217	    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
   218	    body: JSON.stringify({ kind: 'build', sessionId: `u-${RUN}`, language: 'pt', description: EDIT_DESC, artifactId: appId }),
   219	  });
   220	  assert(userFollowUp.status === 403 || userFollowUp.status === 404, `user follow-up build must be refused 403/404, got ${userFollowUp.status}: ${userFollowUp.text.slice(0, 160)}`);
   221	  if (userFollowUp.status === 403) {
   222	    const cap = userFollowUp.json && userFollowUp.json.error && userFollowUp.json.error.details && userFollowUp.json.error.details.capability;
   223	    assert(cap === 'canEditApps', `user follow-up 403 should carry details.capability='canEditApps', got ${JSON.stringify(cap)}`);
   224	  }
   225	  ok(`USER CANNOT EDIT: POST /jobs follow-up refused ${userFollowUp.status} (capability gate, before any ownership probe)`);
   226	
   227	  console.log('EDIT-MODE JOURNEY LIVE GATE: PASS');
   228	}
   229	
   230	main().catch((e) => {
   231	  console.error(e instanceof E2EFailure ? e.message : `E2E FAIL: ${e && e.stack ? e.stack : String(e)}`);
   232	  process.exit(1);
   233	});

exec
/bin/zsh -lc "git show 3ad6fb3:shared/src/capabilities.ts | nl -ba | sed -n '1,120p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-oXfSf61V' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-pVubxQSu' (errno=Operation not permitted)
     1	/**
     2	 * Capability vocabulary for the platform permission seam (operator-run S0).
     3	 * NAMES ONLY — no role mapping here (this is the shared contract vocabulary).
     4	 * The real role→capability mapping and every authorization decision live in
     5	 * `api/src/auth/capabilities.ts` (the `can()` matrix) since the operator-run
     6	 * security block (H1); the former permissive stub is gone (H5 grep-gates that
     7	 * the retired stub marker never resurfaces anywhere in the tree).
     8	 */
     9	import { z } from 'zod';
    10	
    11	export const Capability = z.enum([
    12	  'canBuildApps',
    13	  'canEditApps',
    14	  'canCreateArtifacts',
    15	  'canUseChat',
    16	]);
    17	export type Capability = z.infer<typeof Capability>;

exec
/bin/zsh -lc "git show 3ad6fb3:docs/findings.md | nl -ba | sed -n '1,240p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-wVT419q6' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-F14ugayk' (errno=Operation not permitted)
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
    54	### Gateway / egress
    55	
    56	- **`gateway-502-masks-401`** - CLOSED (local-bridge consumer run s7, 2026-07-11, merged from the
    57	  parallel session): typed `CredentialError` -> 503 `credential_error` (non-retryable), rate-cap ->
    58	  429, transient stays 502; `/health claudeAuth.lastProviderError` carries class+timestamp only;
    59	  gateway metadata is an allowlist (`user_id` only), killing the sibling mask.
    60	- **`health-bridgeConnections-mismatch`** (small, merged from the parallel session's recon). `/health
    61	  bridgeConnections` reports `sseManager.connectionCount` (SSE clients), not the bridge registry's
    62	  daemon-socket count the field name promises. One-line fix in server.ts /health + a health contract
    63	  assertion.
    64	- **`e2e-estate-no-committed-env`** (open, structural; merged - extends `e2e-estate-baseline-13`
    65	  below). 49 of 213 due specs red when the WHOLE ledger estate runs against the run-driver stack
    66	  (the served-app compat `/api/v1/action` suites 404 at every commit; demo tours exceed the 30s
    67	  timeout on dev-next latency). Needs a committed full-stack e2e harness + a compat-suite triage.
    68	- **`gateway-apikey-checkAllowance`** (medium, security). The gateway `apikey` principal skips
    69	  `checkAllowance` and bills the platform admin account - an exfil surface reachable from a build
    70	  subprocess. Operator decision owed on the sanctioned posture.
    71	- **F8** (judgment, minor). Provider/credential error surfaces are not user-grade: chat can stream an
    72	  English spec citation, the adapter can leak raw provider JSON, and build failure is a generic PT
    73	  sentence with no cause. Needs one error-mapping layer at the streaming sink (PT message + machine
    74	  code, detail in logs).
    75	
    76	### Product bugs
    77	
    78	- **`restoreVersion-featured-500`** (medium). `restoreVersion` on a *featured* artifact still 500s.
    79	  (The broader versions-500 - never-built artifacts and the featured list - was fixed 2026-07-11; this
    80	  case remains.)
    81	- **`web-sourceinput-divergence`** (medium). A web/`shared` `SourceInput` divergence makes a seed-
    82	  template knowledge source 400 from the UI.
    83	- **`login-double-session`** (minor, dev-only). The login landing double-creates sessions (React
    84	  StrictMode double-mount of the eager empty-session create); dev-DB orphan-row noise, and the /chat
    85	  landing intermittently GETs a just-created session id that 404s (the e2e trackers carry a scoped
    86	  exclusion for exactly that 404 pattern - remove it when this closes). The write should be
    87	  idempotent/effect-guarded.
    88	- **`chat-sse-discovery`** (deferred, batch-2). S1 adversarial-tester discovery set: chat-SSE late-
    89	  subscriber gap, run hangs on upstream auth failure, temp-session 404 persist.
    90	- **`web-tests-untypechecked`** (low, batch-2). Web `__tests__` are excluded from tsc, so web test
    91	  files are never typechecked.
    92	- **`e2e-estate-baseline-13`** (medium, per-spec debt). The first honest full-stack estate run
    93	  (2026-07-11, 187/200 green after this run's fixes) leaves 13 red ported specs, ALL pre-existing
    94	  product/UI gaps (none touch this run's diffs): (a) the documented band2 legacy group still built
    95	  around the retired `/api/v1/action` + old stubs - artifact-backend-panel, artifacts-apps-section,
    96	  update-from-bundle, vertical-profile, onboarding x3 (REST migration owed; see
    97	  docs/e2e-harness-remediation-brief.md); (b) integrations UI gaps - pages-manage expects a search
    98	  input the migrated page lost, integrations-sections' Webhooks tab renders no webhook rows,
    99	  integrations-pipedream master-toggle default/persistence semantics differ; (c) legal-content
   100	  gaps - legal-rcbe journey, legal-shared-drift (six scaffolds vs canonical layer), simuladores-
   101	  trabalho exact CT figures. Each is closed by building the missing surface or by an explicit
   102	  retire decision - never by editing the ported spec.
   103	
   104	- **`branding-tab-stale-after-research`** (minor, UI freshness). Right after a brand research
   105	  completes, the Marca tab can render the PREVIOUS palette (local component state seeded at page
   106	  load) while `org.branding` already holds the new one - a fresh reload shows the correct values.
   107	  Observed live 2026-07-11 during the walkthrough recording (post-research tab showed `#1A2D5A`,
   108	  persisted+reload truth was `#1C2B4A`). Likely the local-state sync effect on
   109	  `settings/branding/page.tsx` not re-seeding after `fetchCompany()`. Close with a deterministic
   110	  test that researches (fake transport), switches to the Marca tab and asserts the fresh hex.
   111	
   112	- **`collection-rule-access-unenforced`** (medium, data-plane; H5 assertion-layer surfaced). A
   113	  collection rule's `access:{write:'session'|'server'}` is DECLARED in the app manifest schema but
   114	  NOT enforced by served-data.ts - all app-data writes are app-id-scoped (owner-activation
   115	  admission), so the per-collection write mode is decorative. Pre-existing C3/data-plane concern,
   116	  OUTSIDE the H security block (which gates the PLATFORM authz; the served-data plane is a separate,
   117	  documented app-id-scoped design). Close by enforcing the declared write mode in served-data.ts OR
   118	  by removing the unenforced field from the manifest schema. Flagged by H5's destructive-action-authz
   119	  assertion (the privileged app-sso ops ARE gated + asserted; this is the general data plane).
   120	
   121	### Operator-blocked / external
   122	
   123	- **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
   124	  on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
   125	  (`docs/operations-runbook.md`).
   126	- **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
   127	  commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
   128	  is already at `af8b556`).
   129	
   130	## Recently fixed - 2026-07-13 preview probe CORS duplicate header (operator)
   131	
   132	- **`F-2026-07-13-proxy-duplicate-acao`** (operator-reported, 2026-07-13) - in dev, the preview
   133	  probe's `HEAD /apps/<slug>/` from the dashboard origin failed CORS on EVERY request:
   134	  `The 'Access-Control-Allow-Origin' header contains multiple values '*, http://localhost:3000'`
   135	  (`net::ERR_FAILED` despite a 200), so `probePreviewDocument` classified every served app as
   136	  `transient` and the panel's probe-gated first render churned through its retry budget. Root
   137	  cause: both dev CORS proxies (`.claude/skills/run-ekoa-code/driver.mjs` and its verbatim copy in
   138	  `api/tests/journeys/boot-b.mjs`) merged response headers with
   139	  `{ ...proxyRes.headers, ...corsHeaders(req) }` - Node lowercases upstream header names while
   140	  `corsHeaders()` uses mixed case, so on planes where the api sets its OWN CORS header
   141	  (`/apps/*` and design tokens send `Access-Control-Allow-Origin: *` - `serving.ts`,
   142	  `design-tokens.ts`) the spread kept BOTH keys and the wire carried two ACAO values, which
   143	  browsers reject outright. Dev-only (prod is same-origin, no proxy). Fixed in both files:
   144	  upstream-wins per-header merge (`mergeResponseHeaders`) - the proxy only injects the CORS
   145	  headers upstream did not already set, so `/apps/*` answers a single `ACAO: *` exactly as
   146	  `web/lib/preview-probe.ts` documents, and `/api/*` keeps the reflected-origin set. Verified
   147	  live through a restarted boot-b stack: `/apps/legal-agenda-reservas/` ACAO count 1 (`*`),
   148	  `/health` reflected origin single-valued, OPTIONS preflight unchanged.
   149	
   150	## Recently fixed - 2026-07-12 preview "proxy error" (operator)
   151	
   152	- **`F-2026-07-12-preview-502`** (operator-reported, 2026-07-12) - during a build, the side-panel
   153	  preview iframe displayed a raw `proxy error` body and stayed there (screenshot: 502 on the
   154	  `/apps/<id>/?token=` document request while adjacent `/api/v1/billing/usage` calls returned 200).
   155	  Two stacked defects:
   156	  1. **Dev-harness proxy transient** (root cause of THIS 502): the run-ekoa-code driver's CORS
   157	     reverse proxy (`.claude/skills/run-ekoa-code/driver.mjs`) forwarded upstream requests over the
   158	     Node 20 global agent (keep-alive pooled, server closes idles at its default 5s
   159	     `keepAliveTimeout`) and answered ANY pre-response upstream socket error with a bare 502
   160	     `proxy error` - silently (no log), so the exact errno of the operator's occurrence (2 of 265
   161	     requests) is unrecoverable. Fixed: fresh upstream connection per request
   162	     (`http.Agent({ keepAlive: false })` - loopback, sub-ms), one replay for bodyless idempotent
   163	     methods (GET/HEAD) failing before a response, upstream errors logged with method/path/errno,
   164	     and a mid-stream failure destroys the response instead of appending garbage. Forensics note:
   165	     the classic close-vs-reuse race would NOT reproduce in 365 timed attempts against Node 20
   166	     (agent honors the server's Keep-Alive hint), so the residual trigger class is broader than
   167	     that race - the fix covers the class, and the new logging captures any recurrence.
   168	  2. **Preview panel could not recover** (product gap, any 5xx source incl. a prod edge blip): an
   169	     iframe NEVER fires its error event for an HTTP error response - it renders the error body and
   170	     fires `load` - so `side-panel.tsx`'s retry machinery never engaged and the raw body stuck
   171	     until a manual refresh. Fixed: `web/lib/preview-probe.ts` classifies the document plane via a
   172	     HEAD probe (`ok` 2xx / `transient` network+5xx / `hard` other); the panel now gates the first
   173	     iframe render on the probe (polls at the existing 500ms/30s bounds), re-probes on every iframe
   174	     `load`, routes `transient` into the existing bounded retry, restores the retry budget on a
   175	     verified-ok load, and renders `hard` pages (410 revoked) as-is. Manual refresh polling unified
   176	     on the same classification (and now probes the tokened URL the iframe actually loads).
   177	  Accepted residual: a blip that hits ONLY the iframe's GET while the adjacent HEAD probes pass is
   178	  undetectable cross-origin without a new parent<->iframe liveness protocol on the byte-compat
   179	  injection plane (the demo bridge stays dormant until `demo.init` by design) - disproportionate;
   180	  revisit only if it recurs behind the fixed proxy/edge. Tests:
   181	  `web/__tests__/lib/preview-probe.test.ts` (classification),
   182	  `web/__tests__/components/side-panel-preview-recovery.test.tsx` (wiring: probe-gated first
   183	  render, 410 renders as-is, on-load transient -> retry -> recovery); both fail against the
   184	  pre-fix behavior. Live-verified 2026-07-12: stack restarted on the fixed driver, real-UI login,
   185	  /artifacts + served `legal-nucleo` render through the proxy, 16/16 doc-plane requests across
   186	  5s keep-alive boundaries clean.
   187	
   188	## Recently fixed - 2026-07-12 brand research colors (operator round 3)
   189	
   190	- **`brand-colors-fake-teal`** (operator-reported, 2026-07-12) - research on
   191	  mariliasantoscabral.webnode.pt showed primary `#0d9488` (teal-600, the OLD platform default) on a
   192	  navy/white site with no teal anywhere. Root-cause forensics (live DB + job records + a live
   193	  extraction probe) proved the teal never existed in the pipeline, the model output, or the org
   194	  record: it was the branding page's HARDCODED display fallbacks (`#0d9488`/`#1e293b`) rendered
   195	  whenever `org.branding` lacked colors - indistinguishable from a research result, and
   196	  `handleSaveBranding` would persist them verbatim on Guardar. Fixed: unset colors are `null` state
   197	  end-to-end (explicit "Não definida" swatch/placeholder, neutral preview placeholders), Save OMITS
   198	  unset colors, and the exact pair appears nowhere. Tests: `web/e2e/branding-colors.spec.ts`.
   199	- **`brand-research-silent-no-color`** (same run) - the research flow structurally could not produce
   200	  a color for this site yet reported success: the grounded snapshot contained ONLY grayscale hexes,
   201	  the model complied, `sanitizeBrandColors` nulled them, the patch dropped the nulls, and the job
   202	  completed `brandingApplied:true` with no signal (the old cortex NO_PRIMARY_COLOR fail-loud guard
   203	  was never ported - color-filter.ts's own comment referenced a "no usable primary guard" that did
   204	  not exist). Fixed as partial-apply-with-warning: the job result + complete event + `jobView` carry
   205	  `colorsApplied` and `warnings: [NO_PRIMARY_COLOR]`; the web shows an amber "defina-as manualmente"
   206	  banner/toast instead of green success. Tests: `api/tests/contract/branding.test.ts` (fail-loud
   207	  monochrome case), shared `Job` schema extended.
   208	- **`brand-colors-image-only-blind`** (same run, the actual extraction gap) - the firm's navy lives
   209	  ONLY as pixels in the hero JPEG; the rendered walker samples computed styles, so `paintedHexes`
   210	  came back empty, the Webnode builder scrub then intersected the CSS candidates against that empty
   211	  set and wiped all 8, leaving the model four grayscale hexes. Fixed with a screenshot-PIXEL
   212	  quantization fallback in `rendered-candidates.ts` (fires only when nothing non-neutral paints;
   213	  in-page canvas quantization of the Playwright screenshot - a data: image, so no cross-origin
   214	  taint), surfaced as an explicitly low-confidence "Cores amostradas dos píxeis" prompt section with
   215	  a neutral-ban rule, deliberately exempt from the brandFit floor (the desaturated navy ~0.26 is the
   216	  point). Live-verified against the real site: research now persists primary `#374559` (the actual
   217	  hero navy) and no neutrals. Tests: `api/tests/services/branding/rendered-candidates.test.ts`
   218	  (`screenshotClustersToCandidates`), `snapshot.test.ts` (pixel section + rules).
   219	- **`brand-colors-no-membership-guard`** (found during the fix, latent in old cortex too) - the
   220	  "every returned hex must appear literally in a candidate list" rule was prompt-only; a
   221	  hallucinated saturated color would have merged unchecked. Fixed: `collectAllowedHexes` gathers the
   222	  snapshot evidence and the apply-step NULLS any returned color outside it (grounded path only).
   223	  Tests: `api/tests/contract/branding.test.ts` (out-of-snapshot teal dropped),
   224	  `snapshot.test.ts` (`collectAllowedHexes`).
   225	- **`sanitize-accent-gap`** (same run) - `sanitizeBrandColors` never checked `accentColor`, so gray
   226	  `#9d9d9d` persisted as the org accent; and the promotion swap PARKED the demoted gray in the
   227	  accent slot. Fixed: a grayscale accent is nulled last (no slot ever persists a neutral). Tests:
   228	  `api/tests/services/branding/color-filter.test.ts`.
   229	- **`branding-save-wholesale-wipe`** (found during the fix) - `saveBrandingHandler` passed the
   230	  client's 4-field branding object straight to `updateOrg`, which replaces top-level keys wholesale:
   231	  every dashboard Guardar silently WIPED `designSystem`/`visualVibe`/researched fields. Fixed: the
   232	  handler merges onto existing branding (same semantics as the research apply-step). Test:
   233	  `api/tests/contract/branding.test.ts` (save-merge case).
   234	- **`accent-picker-secondary-binding`** (same run) - the "Cor de Destaque" picker was bound to
   235	  `secondaryColor`, so the persisted `accentColor` was never displayed and Save wrote the fallback
   236	  slate into `secondaryColor` under an accent label. Fixed: the accent picker binds `accentColor`.
   237	  Test: `web/e2e/branding-colors.spec.ts` (accent stays unset when only primary is saved).
   238	- **`branding-page-stale-until-reload`** (operator-reported, 2026-07-12 follow-up: "had to refresh
   239	  to see the changes on the brand area") - the branding page re-syncs its local editor state only
   240	  when the `${company.id}_${company.updatedAt}` fingerprint changes, but `orgView` never returned

codex
I’ve read the assertion files themselves. Next I’m tracing them back to the production seams they claim to cover: the route gating points, the assistant grounding path, and the served-app data/app-sso split.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph explore "can routes jobs chat artifacts app assistant whoami runAppAssistant buildGroundingBlock served-data app-sso set-password findValidAppSession"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:docs/security.md | nl -ba | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-2bZe1IF4' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-7l1WcnsC' (errno=Operation not permitted)
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
   161	  a mutating served-app op that is meant to be end-user-gated is authorized SERVER-SIDE by the
   162	  per-app SSO identity, not by any client confirmation (the Phase 4 confirm dialog is UX). The
   163	  canonical case - `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data) - is
   164	  rejected 401 WITHOUT a valid app-sso session and with a WRONG-APP session (`session.appId`
   165	  isolation via `findValidAppSession`), and proceeds only for the correct same-app session; the
   166	  visitor-acting `/api/app-sso/m365/*` proxy is gated the same way. **Finding (documented boundary,
   167	  not a hole):** the GENERAL `/api/app-data` plane a C3 submit/delete lands on is deliberately
   168	  app-id-SCOPED (see *Served-app admission planes* above) - its per-app server boundary is
   169	  `X-Ekoa-App-Id` scope + owner-activation admission, NOT an app-sso session; the app-sso IDENTITY
   170	  plane gates the PRIVILEGED end-user ops. A related pre-existing OBSERVATION outside the H-block's
   171	  scope: the collection-rule `access: { read, write: 'session' | 'server' }` level is DECLARED in the
   172	  manifest schema but not enforced by `served-data.ts` (writes are app-id-scoped regardless) - flagged
   173	  for the C3/data-plane owner, not fixed by H5 (H5 asserts, it adds no auth code).
   174	
   175	**Frame headers (current state).** The api plane sets `X-Frame-Options: DENY` / `frame-ancestors
   176	'none'`. The served-app plane sets `frame-ancestors 'self'` + `SAMEORIGIN`. The `/apps` embed
   177	allowlist (so the cross-origin dashboard can iframe a served artifact) is **PENDING** - tracked as an
   178	open security task in `docs/findings.md`.
   179	
   180	## Incident response
   181	
   182	Solo-operator posture: the founder is incident commander. Detection sources, in order: **Registo**
   183	(append-only, single write path - agent actions, privileged data access, auth/admin ops), the
   184	anonymisation audit (hash-chained, metadata-only), the chokepoint meter (anomalous-burn / spend-cap
   185	trips), and boot-gate failures. Severity: S1 confirmed cross-org exposure / key compromise / PII
   186	egress past the anonymisation boundary; S2 single-org/user exposure or auth bypass without confirmed
   187	exploitation; S3 vulnerability without exposure. Containment (first hour): scope from Registo; cut
   188	access narrowly (deactivate account -> bump token epoch -> revoke bridge pairings -> rotate the
   189	secret in Secret Manager -> last resort stop the service); preserve the append-only evidence before
   190	any remediation. GDPR: personal-data breach to the supervisory authority within 72 h of awareness
   191	unless no risk; record the decision either way. Post-incident: write it up in `docs/decisions.md`,
   192	and every accepted root cause ships a deterministic guard in the same fix.
   193	
   194	## Secure development
   195	
   196	All change lands through the gated process (spec-first history preserved in git; see
   197	`docs/governance.md`). Structural enforcement is the lint + CI wall above. Input/output: boundary
   198	validation via the shared zod contract on every request (the contract is simultaneously input schema
   199	and injection defence); non-2xx bodies validate against the error envelope; no secrets/keys/org data
   200	in system prompts. CI security gates run on every lane: gitleaks (secrets), Semgrep (SAST),
   201	`npm audit` severity, the boundary/chokepoint grep gates, plus the named security suites - cross-org
   202	adversarial, in-org sharing, rate-limit/spend-cap, anonymisation payload-capture, and the bridge
   203	S1-S6 scenarios. The determinism ratchet: every accepted review or incident finding ships a
   204	deterministic guard (test, lint rule, Semgrep pattern, grep gate) in the same fix, so reviews trend
   205	toward judgment-only and regressions are machine-caught. Secrets live in a managed store only (GCP
   206	Secret Manager in prod; a bootstrap-generated key in dev); rotation is documented per secret.

 succeeded in 801ms:
## Flow (call path among the symbols you queried)

1. App (api/assets/bases/app/scaffold/frontend/src/App.jsx:53)
   ↓ calls
2. getCurrentUser (api/assets/bases/app/wiring/auth.ts:30)
   ↓ calls
3. whoami (api/assets/bases/app/wiring/protocol-client.ts:111)

> Full source for these symbols is below — the call flow among them, followed by their bodies.
## Exploration: can routes jobs chat artifacts app assistant whoami runAppAssistant buildGroundingBlock served-data app-sso set-password findValidAppSession

Found 202 symbols across 103 files.

### Blast radius — what depends on these (update/verify before editing)

- `AppAssistantDeps` (api/src/apps/app-assistant.ts:57) — 8 callers in `api/src/apps/app-assistant-route.ts`, `api/src/apps/app-assistant.ts`; tests: `api/tests/apps/app-assistant.test.ts`, `api/tests/security/assistant-cross-org-isolation.test.ts`
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
- ... and 65 more

**calls:**
- runAppAssistant → inferMode
- runAppAssistant → map
- runAppAssistant → renderPrompt
- runAppAssistant → extractActions
- appAssistantRouter → runAppAssistant
- ask → runAppAssistant
- runAppAssistant → assistantToolsFromManifest
- appAssistantRouter → resolveAssistantApp
- resolveMemoryInjection → map
- memoriesRouter → map
- ... and 237 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

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

#### api/src/knowledge/grounding.ts — GroundingInput(interface), GroundingResult(interface), buildGroundingBlock(function)

```typescript
1	/**
2	 * The slot-5 grounding block (ch08 §8.4, ch05 §5.5.2 item 2): the "cited-or-silent" knowledge
3	 * block that `agents/` injects into an agent's system prompt. It is a DYNAMIC, code-built block
4	 * (never content) consuming ONLY the caller's org partition of the lexical index.
5	 *
6	 * Two rules the spec fixes here:
7	 *  - Cited-or-silent: return top-k relevant snippets, each carrying a citation
8	 *    (collection / title / docId), or the empty string when nothing is relevant — never
9	 *    hallucinated filler.
10	 *  - Build gating: chat runs always get grounding; BUILD runs get it only when the deterministic,
11	 *    keyword-based legal-context detector matches the request (no model call).
12	 *
13	 * This module imports the lexical index only. It has NO path to llm/ (CLAUDE.md, FIXED-3).
14	 */
15	import { search, type SearchHit } from './index-store.js';
16	
17	/** PT/EN legal-context keywords. Deterministic, lowercased, accent-insensitive substring match. */
18	const LEGAL_KEYWORDS = [
19	  // PT
20	  'processo', 'prazo', 'tribunal', 'acordao', 'citacao', 'peticao', 'contrato', 'clausula',
21	  'recurso', 'sentenca', 'jurisprudencia', 'advogado', 'juridic', 'juiz', 'partes', 'audiencia',
22	  'penhora', 'execucao', 'citius', 'dgsi', 'codigo civil', 'codigo penal', 'legisla', 'decreto',
23	  'portaria', 'escritura', 'notario', 'litigio', 'peticao inicial', 'contestacao', 'diligencia',
24	  // EN
25	  'lawsuit', 'legal', 'court', 'lawyer', 'attorney', 'contract', 'clause', 'litigation',
26	  'plaintiff', 'defendant', 'statute', 'jurisdiction', 'deadline', 'hearing', 'judgment',
27	];
28	
29	/** Fold to a lowercase, accent-stripped form for keyword matching (independent of FTS folding). */
30	function fold(s: string): string {
31	  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
32	}
33	
34	/** Deterministic legal-context detector (ch05 §5.5.2, ch08 §8.4 build row). No model call. */
35	export function isLegalContext(query: string): boolean {
36	  const f = fold(query);
37	  return LEGAL_KEYWORDS.some((k) => f.includes(k));
38	}
39	
40	export interface GroundingInput {
41	  orgId: string;
42	  query: string;
43	  kind: 'chat' | 'build';
44	  /** top-k snippets (default 5). */
45	  limit?: number;
46	}
47	
48	export interface GroundingResult {
49	  block: string;
50	  hits: SearchHit[];
51	}
52	
53	/** Format the cited block. Each hit renders a numbered citation line + its snippet. */
54	function formatBlock(hits: SearchHit[]): string {
55	  const lines = ['CONHECIMENTO (excertos com fonte citada; use apenas o que for relevante):'];
56	  hits.forEach((h, i) => {
57	    lines.push(`[${i + 1}] ${h.collection} / ${h.title} (doc ${h.docId})`);
58	    if (h.snippet.trim()) lines.push(h.snippet.trim());
59	  });
60	  return lines.join('\n');
61	}
62	
63	/** Build the grounding block. Returns '' (silent) when the run is a non-legal build, or when
64	 *  nothing in the org partition is relevant. */
65	export function buildGroundingBlock(input: GroundingInput): GroundingResult {
66	  if (input.kind === 'build' && !isLegalContext(input.query)) return { block: '', hits: [] };
67	  const hits = search(input.orgId, input.query, input.limit ?? 5);
68	  if (hits.length === 0) return { block: '', hits: [] };
69	  return { block: formatBlock(hits), hits };
70	}
```

#### api/src/integrations/app-sso-sessions.ts — findValidAppSession(function)

```typescript
1	/**
2	 * End-user SSO sessions + pending-auth records for served artifacts (ch03 §3.9;
3	 * ported from cortex/src/persistence/app-sessions.ts). These are the identity layer
4	 * for `/apps/{id}/` visitors (an ERP login flow), NOT the dashboard's own JWT sessions
5	 * and NOT the workspace integration token. Each record is scoped to ONE artifact by
6	 * `appId`; isolation is enforced server-side by `session.appId === <canonical id>`,
7	 * never by cookie path.
8	 *
9	 * Storage carryover: the old monolith used JSON stores; here both live in Firestore via
10	 * the generic `Store<T>` (ch04 §4.3.3), matching the rest of the new data layer. The
11	 * pending-auth single-use guarantee is `Store.consume` (findOneAndDelete - atomic), so
12	 * two concurrent /callback requests carrying the same state can never both observe the
13	 * record (the second gets null) - the no-replay property is local, not merely reliant
14	 * on Azure's one-time authorization-code enforcement.
15	 */
16	import { Store, type Doc } from '../data/store.js';
17	
18	/** A logged-in end-user of a served artifact (the cookie value is the `_id`). */
19	export interface AppSessionDoc extends Doc {
20	  /** High-entropy opaque token; the value held in the HttpOnly cookie. */
21	  _id: string;
22	  /** Canonical artifact id this session is valid for (never the slug). */
23	  appId: string;
24	  email: string;
25	  name?: string;
26	  /** Microsoft object id (stable per-user identifier across the tenant). */
27	  oid?: string;
28	  /** Tenant id (`9188040d-…` = personal/MSA). */
29	  tid?: string;
30	  createdAt: string;
31	  /** ISO expiry; the session is invalid once now > expiresAt. */
32	  expiresAt: string;
33	  /** Encrypted JSON `{ access_token, refresh_token }` for acting AS this user on Graph.
34	   *  Present only when the visitor granted delegated Mail.Send/Calendars scopes. The
35	   *  served app never sees it - the /api/app-sso/m365 proxy injects it. */
36	  graphTokensEnc?: string;
37	  /** ISO expiry of the graph access token (cleartext, for cheap refresh checks). */
38	  graphTokenExpiresAt?: string;
39	  /** For PASSWORD sessions only: the user collection + identity field this session
40	   *  authenticated against at login. set-password authorization binds to THESE
41	   *  server-established values, never to request-supplied ones. Absent for SSO. */
42	  authCollection?: string;
43	  authIdentityField?: string;
44	}
45	
46	/**
47	 * An in-flight authorization-code roundtrip. Created at /start, consumed once at
48	 * /callback. `_id === state` so the callback looks it up by the `state` Microsoft
49	 * returns, in O(1). Holds the nonce + PKCE verifier the authorize request committed to.
50	 */
51	export interface PendingAppAuthDoc extends Doc {
52	  /** Equals `state`. */
53	  _id: string;
54	  appId: string;
55	  nonce: string;
56	  pkceVerifier: string;
57	  /** Absolute, validated `/apps/…` path to redirect to after sign-in. */
58	  returnUrl: string;
59	  /** The exact redirect_uri sent to Azure (must be replayed at token exchange). */
60	  redirectUri: string;
61	  createdAt: string;
62	  expiresAt: string;
63	}
64	
65	export const appSessions = new Store<AppSessionDoc>('app_sessions');
66	export const pendingAppAuth = new Store<PendingAppAuthDoc>('app_sso_pending');
67	
68	/** Session lifetime: 8h. Pending-auth lifetime: 10min (one login roundtrip). */
69	export const APP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
70	export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
71	
72	/**
73	 * Look up a still-valid session by its cookie token, scoped to one app. Returns null
74	 * for missing/expired/wrong-app - callers surface 401 without disclosing which. Expired
75	 * rows are swept opportunistically.
76	 */
77	export async function findValidAppSession(sessionToken: string, appId: string): Promise<AppSessionDoc | null> {
78	  if (!sessionToken || !appId) return null;
79	  const found = await appSessions.get(sessionToken);
80	  if (!found) return null;
81	  if (found.appId !== appId) return null;
82	  if (Date.parse(found.expiresAt) <= Date.now()) {
83	    await appSessions.delete(sessionToken).catch(() => {});
84	    return null;
85	  }
86	  return found;
87	}
88	
89	/**
90	 * Look up and CONSUME a pending-auth by state. ATOMIC single-use via findOneAndDelete,
91	 * so a replayed state can never be observed twice. Returns null when missing or expired.
92	 */
93	export async function consumePendingAppAuth(state: string): Promise<PendingAppAuthDoc | null> {
94	  if (!state) return null;
95	  const found = await pendingAppAuth.consume(state);
96	  if (!found) return null;
97	  if (Date.parse(found.expiresAt) <= Date.now()) return null;
98	  return found;
99	}
100	
101	/** Drop every expired session and pending-auth row. Safe to call on a timer. */
102	export async function sweepExpiredAppSso(): Promise<{ sessions: number; pending: number }> {
103	  const now = Date.now();
104	  const sessions = await appSessions.deleteMany({ expiresAt: { $lte: new Date(now).toISOString() } });
105	  const pending = await pendingAppAuth.deleteMany({ expiresAt: { $lte: new Date(now).toISOString() } });
106	  return { sessions, pending };
107	}
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

#### api/src/auth/capabilities.ts — can(function)

```typescript
1	/**
2	 * The platform capability layer (operator-run H1 security block). The single permission seam:
3	 * every capability decision in the api goes through `can()`. A PURE role→capability map — it
4	 * carries NO org/resource context by design (resource + tenancy checks stay separate:
5	 * `loadWritable`/`loadReadable` in apps/app-paths.ts, the org scoping in the users/registo
6	 * services). Wiring `can()` into a route does not replace an ownership check; the two compose.
7	 *
8	 * Matrix (brief §9a):
9	 *   super-admin → all four capabilities.
10	 *   org-admin   → all four capabilities.
11	 *   user        → canUseChat + canCreateArtifacts ONLY (chat + non-app artifacts; a plain user
12	 *                 cannot build or change apps — canBuildApps/canEditApps are admin-only).
13	 *   null/undefined actor → NOTHING (fail closed: an absent actor has no capabilities, so a caller
14	 *                 that forgets to resolve the actor is denied rather than silently allowed).
15	 *
16	 * This REPLACES the pre-security-block permissive stub (whose grep-marker the H5 security
17	 * assertions fail on): every decision here is a real capability grant, never a blanket allow.
18	 */
19	import type { Capability, Role } from '@ekoa/shared';
20	import type { JwtClaims } from './jwt.js';
21	
22	/** The role→capability grid. `Record<Role, …>` so a new Role value is a compile error until it is
23	 *  given an explicit capability set here (fail-closed by construction — no role defaults to more). */
24	const CAPABILITIES: Record<Role, ReadonlyArray<Capability>> = {
25	  'super-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
26	  'org-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
27	  user: ['canCreateArtifacts', 'canUseChat'],
28	};
29	
30	/** Does `actor` hold `capability`? Pure role lookup. A null/undefined actor holds nothing, and an
31	 *  unrecognised role (e.g. a stale value a signature-valid token might still carry) also holds
32	 *  nothing — both fail closed. Resource/tenancy authorization is a SEPARATE, composed check. */
33	export function can(
34	  actor: Pick<JwtClaims, 'role'> | null | undefined,
35	  capability: Capability,
36	): boolean {
37	  if (!actor) return false;
38	  const granted = CAPABILITIES[actor.role] as ReadonlyArray<Capability> | undefined;
39	  return granted?.includes(capability) ?? false;
40	}
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

#### shared/src/app-assistant.ts — AssistantChatMode(type_alias)

```typescript
26	
27	/** The assistant's operating mode: operate the app / give an overview / teach. */
28	export const AssistantChatMode = z.enum(['do', 'show', 'teach']);
29	export type AssistantChatMode = z.infer<typeof AssistantChatMode>;
30	
31	/** The panel's current screen state, forwarded so the assistant grounds in what the visitor sees.
32	 *  `actionResults` are opaque outputs of previously-dispatched app-actions (client-shaped). */
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

 succeeded in 30789ms:
/../pnmui-mon/TASKS.md

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "git show 3ad6fb3:api/src/routes/artifacts.ts | nl -ba | sed -n '1,320p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:api/src/routes/jobs.ts | nl -ba | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:api/src/routes/chat.ts | nl -ba | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:api/src/apps/app-assistant-route.ts | nl -ba | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 233ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-OFpQ0Nv2' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-TkRztBWN' (errno=Operation not permitted)
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

 succeeded in 245ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-XFflwpB1' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-OZ2FZ771' (errno=Operation not permitted)
     1	/**
     2	 * Artifacts router (ch03 §3.8.9-3.8.11). CRUD via the apps artifacts-service, plus
     3	 * the artifact FAMILY: fork / export / import / bundle-update / featured-update /
     4	 * featured toggle / files / versions / backups / backend / download / pdf. Single
     5	 * list shape `{ items, featured }` (landmine 7). Thin: validate, call one apps/
     6	 * module, shape the response (CONV-2 error envelope throughout).
     7	 */
     8	import { Router, type Response } from 'express';
     9	import {
    10	  ArtifactPatch,
    11	  ImportArtifactRequest,
    12	  BundleUpdateRequest,
    13	  SetFeaturedRequest,
    14	  ReadFileQuery,
    15	  WriteFileRequest,
    16	  BackupPointRef,
    17	  BackendSetEnabledRequest,
    18	  BackendSampleRunRequest,
    19	  PaginationQuery,
    20	} from '@ekoa/shared';
    21	import { z } from 'zod';
    22	import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
    23	import { can } from '../auth/capabilities.js';
    24	import { loadConfig } from '../config.js';
    25	import {
    26	  listArtifacts, createArtifact, getVisibleArtifact, patchArtifact, deleteArtifact,
    27	  artifactView, stripReservedDataKeys, type ArtifactDoc,
    28	} from '../apps/artifacts-service.js';
    29	import { actorOf, notFound, sendError, parseBody } from './helpers.js';
    30	import type { SnapshotAudit } from '../services/commit-guard.js';
    31	import { SecretCommitError } from '../services/commit-guard.js';
    32	import type { AppDataDeps } from '../apps/app-data-access.js';
    33	import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag, isAppArtifact } from '../apps/app-paths.js';
    34	import { forkArtifact } from '../apps/artifact-fork.js';
    35	import { exportArtifact, importArtifact, updateArtifactFromBundle, ManifestIdMismatchError } from '../apps/artifact-bundle.js';
    36	import { applyFeaturedUpdate, ignoreFeaturedUpdate } from '../apps/artifact-featured-update.js';
    37	import { listVersions, restoreAndRebuild } from '../apps/versions.js';
    38	import { listArtifactFiles, readArtifactFile, writeArtifactFile, FilePathError } from '../apps/artifact-files.js';
    39	import { AppDataBackups } from '../apps/backups.js';
    40	import {
    41	  getArtifactBackendRuntime, readDeclaredBackend, type BackendLogEntry, type InvocationRecord,
    42	} from '../apps/backend-runtime/index.js';
    43	import { renderArtifactPdf, isSafePdfBasename } from '../apps/pdf.js';
    44	import { collectAppFiles, streamFiles, safeZipName } from '../services/app-archive.js';
    45	
    46	const CreateArtifact = z.object({ name: z.string(), visibility: z.enum(['private', 'org']).optional() });
    47	const ForkBody = z.object({ name: z.string().optional() });
    48	
    49	export function artifactsRouter(deps: { now: () => number; genId: () => string }): Router {
    50	  const r = Router();
    51	  r.use(requireAuth);
    52	
    53	  const auditOf = (req: AuthedRequest): SnapshotAudit => ({
    54	    actor: { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId },
    55	    deps: { now: deps.now, genId: deps.genId },
    56	  });
    57	  const appDeps: AppDataDeps = { now: deps.now, genId: deps.genId };
    58	
    59	  /** Load an artifact the actor may read; write 404 + return null otherwise. */
    60	  async function readable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
    61	    const art = await loadReadable(actorOf(req), req.params.id as string);
    62	    if (!art) { notFound(res); return null; }
    63	    return art;
    64	  }
    65	  /** Load an artifact the actor may write; write 404/403 + return null otherwise. */
    66	  async function writable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
    67	    const { verdict, art } = await loadWritable(actorOf(req), req.params.id as string);
    68	    if (verdict === 'notfound') { notFound(res); return null; }
    69	    if (verdict === 'forbidden') { sendError(res, 'FORBIDDEN', 'Sem permissão.'); return null; }
    70	    return art!;
    71	  }
    72	
    73	  /**
    74	   * H1 HIGH-2 app-edit capability gate. `writable()`/ownership passes for an artifact the actor
    75	   * OWNS — but a plain `user` OWNS the apps they created, so ownership alone lets them change app
    76	   * CODE (bundle-update, file write, version restore, backend toggle/sample-run, app-data
    77	   * snapshot/restore). An in-place edit of a BUILT app additionally requires `canEditApps`
    78	   * (admin-only). NON-app artifacts stay user-manageable (the check is app-type-aware). Returns
    79	   * true (and writes the FORBIDDEN + details.capability refusal) when the edit is denied.
    80	   */
    81	  function denyAppEdit(req: AuthedRequest, res: Response, art: ArtifactDoc): boolean {
    82	    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
    83	      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
    84	      return true;
    85	    }
    86	    return false;
    87	  }
    88	
    89	  // ---- base CRUD (ch03 §3.8.9) ----
    90	  r.get('/', async (req: AuthedRequest, res: Response) => {
    91	    const { items, featured } = await listArtifacts(actorOf(req));
    92	    res.json({ items: items.map(artifactView), featured: featured.map(artifactView) });
    93	  });
    94	
    95	  r.post('/', async (req: AuthedRequest, res: Response) => {
    96	    const body = parseBody(res, CreateArtifact, req.body) as { name: string; visibility?: 'private' | 'org' } | undefined;
    97	    if (!body) return;
    98	    // H1 capability gate: creating an artifact requires canCreateArtifacts (held by user +
    99	    // org-admin + super-admin — this is the base "artifacts area" capability, distinct from the
   100	    // app build/edit capabilities). Refusal is the FORBIDDEN envelope + details.capability.
   101	    if (!can(actorOf(req), 'canCreateArtifacts')) {
   102	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: 'canCreateArtifacts' });
   103	    }
   104	    res.status(201).json(artifactView(await createArtifact(actorOf(req), body, deps)));
   105	  });
   106	
   107	  // ---- import must precede GET/:id-style matches (distinct verb+path) ----
   108	  r.post('/import', async (req: AuthedRequest, res: Response) => {
   109	    const body = parseBody(res, ImportArtifactRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle } | undefined;
   110	    if (!body) return;
   111	    // H1 HIGH-2: a bundle is always an app export; importing it CREATES and BUILDS a new app →
   112	    // canBuildApps (a plain user cannot import an app the same way they cannot first-build one).
   113	    if (!can(actorOf(req), 'canBuildApps')) {
   114	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
   115	    }
   116	    const created = await importArtifact(body.bundle, actorOf(req), deps);
   117	    res.status(201).json(artifactView(created));
   118	  });
   119	
   120	  r.get('/:id', async (req: AuthedRequest, res: Response) => {
   121	    const a = await getVisibleArtifact(actorOf(req), req.params.id as string);
   122	    if (!a) return notFound(res);
   123	    res.json(artifactView(a));
   124	  });
   125	
   126	  r.patch('/:id', async (req: AuthedRequest, res: Response) => {
   127	    const body = parseBody(res, ArtifactPatch, req.body) as Record<string, unknown> | undefined;
   128	    if (!body) return;
   129	    // Strip server-owned reserved keys (e.g. `projectDir`) from any client `data` at the boundary
   130	    // before they reach the store — a client must never influence the build sandbox path (ch09).
   131	    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
   132	      body.data = stripReservedDataKeys(body.data as Record<string, unknown>);
   133	    }
   134	    const result = await patchArtifact(actorOf(req), req.params.id as string, body);
   135	    if (result.verdict === 'notfound') return notFound(res);
   136	    if (result.verdict === 'forbidden') {
   137	      if (typeof body.slug === 'string') return sendError(res, 'SLUG_TAKEN', 'Slug já em uso.');
   138	      return sendError(res, 'FORBIDDEN', 'Sem permissão.');
   139	    }
   140	    res.json(artifactView(result.artifact!));
   141	  });
   142	
   143	  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
   144	    const id = req.params.id as string;
   145	    // Revoke the backend BEFORE removing the row so no queued/in-flight invoke can
   146	    // run against a deleted artifact (C05-20 post-DELETE refusal, B19).
   147	    await getArtifactBackendRuntime().revoke(id);
   148	    const verdict = await deleteArtifact(actorOf(req), id);
   149	    if (verdict === 'notfound') return notFound(res);
   150	    if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
   151	    res.json({ ok: true });
   152	  });
   153	
   154	  // ---- fork / featured toggle ----
   155	  r.post('/:id/fork', async (req: AuthedRequest, res: Response) => {
   156	    const src = await readable(req, res);
   157	    if (!src) return;
   158	    // H1 HIGH-2: forking an APP builds a new one → canBuildApps; forking a NON-app artifact is a
   159	    // plain create → canCreateArtifacts (kept for users). App-type-aware so users still fork the
   160	    // artifacts they may create, but cannot mint apps.
   161	    const forkCap = isAppArtifact(src) ? 'canBuildApps' as const : 'canCreateArtifacts' as const;
   162	    if (!can(actorOf(req), forkCap)) {
   163	      return sendError(res, 'FORBIDDEN', forkCap === 'canBuildApps'
   164	        ? 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.'
   165	        : 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: forkCap });
   166	    }
   167	    const body = parseBody(res, ForkBody, req.body ?? {}) as { name?: string } | undefined;
   168	    if (!body) return;
   169	    const { artifact } = await forkArtifact(src._id, actorOf(req), deps, body.name);
   170	    res.status(201).json({ id: artifact._id, slug: artifact.slug });
   171	  });
   172	
   173	  r.put('/:id/featured', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
   174	    const body = parseBody(res, SetFeaturedRequest, req.body) as { featured: boolean; featuredRank?: number } | undefined;
   175	    if (!body) return;
   176	    const existing = await getArtifactById(req.params.id as string);
   177	    if (!existing) return notFound(res);
   178	    const updated = await setFeaturedFlag(req.params.id as string, body.featured, body.featuredRank);
   179	    res.json(artifactView(updated!));
   180	  });
   181	
   182	  // ---- bundle export / import / update-in-place ----
   183	  r.get('/:id/export', async (req: AuthedRequest, res: Response) => {
   184	    const art = await readable(req, res);
   185	    if (!art) return;
   186	    res.json(await exportArtifact(art));
   187	  });
   188	
   189	  r.post('/:id/bundle-update', async (req: AuthedRequest, res: Response) => {
   190	    const art = await writable(req, res);
   191	    if (!art) return;
   192	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: in-place app edit → canEditApps
   193	    const body = parseBody(res, BundleUpdateRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle; force?: boolean } | undefined;
   194	    if (!body) return;
   195	    try {
   196	      const result = await updateArtifactFromBundle(
   197	        art, body.bundle,
   198	        { force: body.force, authorName: req.user!.username, audit: auditOf(req), appDeps },
   199	        deps,
   200	      );
   201	      res.json({ artifact: artifactView(result.artifact), safetyNetSnapshotId: result.safetyNetSnapshotId, preUpdateVersionId: result.preUpdateVersionId });
   202	    } catch (err) {
   203	      if (err instanceof ManifestIdMismatchError) return sendError(res, 'MANIFEST_ID_MISMATCH', 'O pacote não corresponde a esta app. Confirme para atualizar mesmo assim.');
   204	      throw err;
   205	    }
   206	  });
   207	
   208	  r.post('/:id/featured-update/apply', async (req: AuthedRequest, res: Response) => {
   209	    const art = await writable(req, res);
   210	    if (!art) return;
   211	    await applyFeaturedUpdate(art._id, { authorName: req.user!.username, audit: auditOf(req), appDeps });
   212	    res.json({ ok: true });
   213	  });
   214	
   215	  r.post('/:id/featured-update/ignore', async (req: AuthedRequest, res: Response) => {
   216	    const art = await writable(req, res);
   217	    if (!art) return;
   218	    await ignoreFeaturedUpdate(art._id);
   219	    res.json({ ok: true });
   220	  });
   221	
   222	  // ---- versions ----
   223	  r.get('/:id/versions', async (req: AuthedRequest, res: Response) => {
   224	    const art = await readable(req, res);
   225	    if (!art) return;
   226	    const q = PaginationQuery.safeParse(req.query);
   227	    const limit = q.success && q.data.limit ? q.data.limit : 100;
   228	    res.json({ items: await listVersions(projectDirFor(art), limit) });
   229	  });
   230	
   231	  r.post('/:id/versions/:sha/restore', async (req: AuthedRequest, res: Response) => {
   232	    const art = await writable(req, res);
   233	    if (!art) return;
   234	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: restoring app code → canEditApps
   235	    const authorName = req.user!.username;
   236	    const result = await restoreAndRebuild(
   237	      art._id,
   238	      { projectDir: projectDirFor(art), sha: req.params.sha as string, authorName, authorEmail: `${authorName}@ekoa.local` },
   239	      art.name,
   240	    );
   241	    res.json({ newHeadSha: result.newHeadSha });
   242	  });
   243	
   244	  // ---- files (project-relative, confined server-side; P-15) ----
   245	  r.get('/:id/files', async (req: AuthedRequest, res: Response) => {
   246	    const art = await readable(req, res);
   247	    if (!art) return;
   248	    const projectDir = projectDirFor(art);
   249	    res.json({ files: await listArtifactFiles(projectDir), projectDir });
   250	  });
   251	
   252	  r.get('/:id/file', async (req: AuthedRequest, res: Response) => {
   253	    const art = await readable(req, res);
   254	    if (!art) return;
   255	    const q = ReadFileQuery.safeParse(req.query);
   256	    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
   257	    try {
   258	      res.json({ content: await readArtifactFile(projectDirFor(art), q.data.path) });
   259	    } catch (err) {
   260	      if (err instanceof FilePathError) return notFound(res);
   261	      throw err;
   262	    }
   263	  });
   264	
   265	  r.put('/:id/file', async (req: AuthedRequest, res: Response) => {
   266	    const art = await writable(req, res);
   267	    if (!art) return;
   268	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: writing app source → canEditApps
   269	    const body = parseBody(res, WriteFileRequest, req.body) as { path: string; content: string } | undefined;
   270	    if (!body) return;
   271	    try {
   272	      const result = await writeArtifactFile(projectDirFor(art), body.path, body.content, req.user!.username, auditOf(req), { appId: art._id, appName: art.name });
   273	      res.json({ path: result.path, size: result.size, committed: result.committed, ...(result.warning ? { warning: result.warning } : {}) });
   274	    } catch (err) {
   275	      if (err instanceof FilePathError) return sendError(res, 'VALIDATION_FAILED', 'Caminho inválido.');
   276	      throw err;
   277	    }
   278	  });
   279	
   280	  // ---- download (zip; 422 on a planted credential) ----
   281	  r.get('/:id/download', async (req: AuthedRequest, res: Response) => {
   282	    const art = await readable(req, res);
   283	    if (!art) return;
   284	    const projectDir = projectDirFor(art);
   285	    let files;
   286	    try {
   287	      files = await collectAppFiles(projectDir); // secret-scan BEFORE any bytes go out
   288	    } catch (err) {
   289	      if (err instanceof SecretCommitError) {
   290	        return sendError(res, 'SECRET_GUARD_BLOCKED', 'Descarregamento bloqueado: a app contém uma credencial que tem de ser removida.');
   291	      }
   292	      throw err;
   293	    }
   294	    res.setHeader('Content-Type', 'application/zip');
   295	    res.setHeader('Content-Disposition', `attachment; filename="${safeZipName(art.slug || art.name || 'app')}.zip"`);
   296	    res.setHeader('Cache-Control', 'no-store');
   297	    try {
   298	      await streamFiles(files, res);
   299	    } catch {
   300	      if (!res.headersSent) res.status(500).end();
   301	      else res.destroy();
   302	    }
   303	  });
   304	
   305	  // ---- pdf (id charset-guarded; it becomes the output basename) ----
   306	  r.get('/:id/pdf', async (req: AuthedRequest, res: Response) => {
   307	    const id = req.params.id as string;
   308	    if (!isSafePdfBasename(id)) return sendError(res, 'VALIDATION_FAILED', 'Identificador inválido.');
   309	    const art = await readable(req, res);
   310	    if (!art) return;
   311	    // Render against the api's OWN loopback origin, NEVER the client-controlled Host header (Codex
   312	    // checkpoint): a spoofed Host would point the server-side render browser at an attacker origin
   313	    // (SSRF + attacker-controlled PDF content). The served-app plane is on this same process.
   314	    const origin = process.env.RENDER_ORIGIN ?? `http://127.0.0.1:${loadConfig().port}`;
   315	    try {
   316	      const result = await renderArtifactPdf({ url: `${origin}/apps/${id}/` }, id);
   317	      res.redirect(302, result.url);
   318	    } catch (err) {
   319	      // Chromium unavailable / render failure - degrade explicitly (ch07 §7.12).
   320	      sendError(res, 'UPSTREAM_UNAVAILABLE', `Não foi possível gerar o PDF: ${err instanceof Error ? err.message : String(err)}`);

 succeeded in 281ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-HkZuhNY5' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-9qcV66Tw' (errno=Operation not permitted)
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

 succeeded in 339ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-gD8TSRif' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-OsAQHXeT' (errno=Operation not permitted)
     1	/**
     2	 * Chat runs router (ch03 §3.8.7, §3.6.1). Thin: validate, call `agents/`, shape the response.
     3	 * Creation registers the run synchronously and returns 202 with the server-minted id (§5.2 steps
     4	 * 1-2); results arrive on the SSE stream. The events endpoint authenticates via ?token= (CONV-1)
     5	 * and attaches to `events/`. Routes never touch `data/` (ch02 §2.7) — persistence is `agents/`.
     6	 */
     7	import { Router, type Request, type Response } from 'express';
     8	import { ChatRunCreateRequest } from '@ekoa/shared';
     9	import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
    10	import { can } from '../auth/capabilities.js';
    11	import { sseManager } from '../events/sse-manager.js';
    12	import { createChatRun, executeChatRun, getRun, cancelRun } from '../agents/index.js';
    13	import { chatRunView } from '../agents/registry.js';
    14	import { actorOf, notFound, parseBody, sendError } from './helpers.js';
    15	
    16	export function chatRouter(deps: { now: () => number; genId: () => string }): Router {
    17	  const r = Router();
    18	
    19	  // SSE stream (?token= auth) — mounted before requireAuth (EventSource cannot set headers).
    20	  r.get('/runs/:id/events', (req: Request, res: Response) => {
    21	    const auth = verifySseToken(req.query.token as string | undefined);
    22	    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
    23	    const id = req.params.id as string;
    24	    const entry = getRun(id);
    25	    if (entry && entry.ownerUserId !== auth.claims.sub) {
    26	      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } });
    27	    }
    28	    const lastEventId = req.header('last-event-id');
    29	    sseManager.attach(res, auth.claims.sub, 'chat', id, lastEventId ? Number(lastEventId) : undefined);
    30	  });
    31	
    32	  r.use(requireAuth);
    33	
    34	  r.post('/runs', (req: AuthedRequest, res: Response) => {
    35	    const body = parseBody(res, ChatRunCreateRequest, req.body);
    36	    if (!body) return;
    37	    const actor = actorOf(req);
    38	    // H1 capability gate: chat requires canUseChat. Every role holds it today, so this never
    39	    // refuses now — wired so the matrix is enforced, not merely implied (a future role without
    40	    // canUseChat is denied here, with the machine-readable FORBIDDEN + details.capability shape).
    41	    if (!can(actor, 'canUseChat')) {
    42	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para usar o assistente; pode pedir ao administrador da organização.', { capability: 'canUseChat' });
    43	    }
    44	    const input = {
    45	      actor,
    46	      username: req.user!.username,
    47	      sessionId: body.sessionId,
    48	      message: body.message,
    49	      language: body.language,
    50	      ...(body.attachments ? { attachments: body.attachments } : {}),
    51	      ...(body.references ? { references: body.references } : {}),
    52	      deps,
    53	    };
    54	    const { runId } = createChatRun(input);
    55	    res.status(202).json({ runId });
    56	    void executeChatRun(runId, input);
    57	  });
    58	
    59	  r.get('/runs/:id', (req: AuthedRequest, res: Response) => {
    60	    const entry = getRun(req.params.id as string);
    61	    const actor = actorOf(req);
    62	    // Ephemeral: a pre-crash / unknown run is a clean 404 (§5.2.1, acceptance criterion 2).
    63	    if (!entry || (entry.ownerUserId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
    64	    res.json(chatRunView(entry));
    65	  });
    66	
    67	  r.post('/runs/:id/cancel', (req: AuthedRequest, res: Response) => {
    68	    res.json(cancelRun(req.params.id as string, actorOf(req)));
    69	  });
    70	
    71	  return r;
    72	}

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "git show 3ad6fb3:api/src/apps/app-assistant-route.ts | nl -ba | sed -n '260,360p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-jXTNKok9' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-bhlFbq5O' (errno=Operation not permitted)
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

exec
/bin/zsh -lc "git show 3ad6fb3:api/src/apps/served-data.ts | nl -ba | sed -n '1,280p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-PavL9WBP' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-QOgA5YvF' (errno=Operation not permitted)
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

exec
/bin/zsh -lc "git show 3ad6fb3:api/src/integrations/app-sso.ts | nl -ba | sed -n '1,320p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-u2n7hhiL' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-C1HKouUE' (errno=Operation not permitted)
     1	/**
     2	 * End-user SSO for served artifacts (ch03 §3.9, FIXED-9). Two credential paths mint the
     3	 * SAME per-app HttpOnly session cookie so a served app can offer Microsoft SSO AND
     4	 * app-declared username/password sign-in, with whoami()/signOut() working identically:
     5	 *
     6	 *   - Microsoft OIDC authorization-code + PKCE (`/microsoft/start` + `/callback`): logs an
     7	 *     `/apps/{id}/` visitor in as THEMSELVES (an ERP login), entirely separate from the
     8	 *     workspace integration token. Server-mediated code flow with PKCE + nonce; identity
     9	 *     lands in the per-app cookie. The app JS never sees the token - identity comes only
    10	 *     from GET /me; the visitor's delegated Graph token (if granted) is proxied through
    11	 *     ALL /m365/* and never exposed.
    12	 *   - App-declared password auth (`/login` + `/set-password`): the app names its own user
    13	 *     collection + identity field, so this stays domain-agnostic; the bcrypt hash lives on
    14	 *     the app's own app-data row (`passwordHash`) and is never returned.
    15	 *
    16	 * Ported from cortex/src/services/app-sso.ts + the /api/app-sso routes in cortex/src/
    17	 * server.ts. Carried security properties (invisible-behaviors §1.8): atomic single-use
    18	 * state consumption, timing-safe-ish password compare (always-run bcrypt, dummy hash on
    19	 * miss), session-bound auth collection for the set-password privilege check, per-app
    20	 * cookie isolation by NAME + server-side appId check (never by path). Amendment 2: the
    21	 * data-bearing routes (login/set-password/m365) consult the artifact OWNER's activation.
    22	 *
    23	 * Egress note: id_token validation verifies RS256 against Microsoft's per-tenant JWKS
    24	 * using node:crypto (the repo carries no `jose`); see validateIdToken.
    25	 */
    26	import { Router, json as expressJson, raw as expressRaw, type Request, type Response } from 'express';
    27	import { createHash, randomBytes, createPublicKey, createVerify } from 'node:crypto';
    28	import bcrypt from 'bcryptjs';
    29	import { CollectionsEngine, appScope, collectionName } from '../data/collections-engine.js';
    30	import { encrypt, decrypt } from '../data/crypto.js';
    31	import { checkOwnerActivation, type ResolveAppScope } from './app-scope.js';
    32	import {
    33	  appSessions,
    34	  pendingAppAuth,
    35	  findValidAppSession,
    36	  consumePendingAppAuth,
    37	  APP_SESSION_TTL_MS,
    38	  PENDING_AUTH_TTL_MS,
    39	  type AppSessionDoc,
    40	} from './app-sso-sessions.js';
    41	
    42	// ---------------------------------------------------------------------------
    43	// Microsoft SSO config (env; config.ts does not yet carry platformIntegrations)
    44	// ---------------------------------------------------------------------------
    45	
    46	function ssoClientId(): string { return process.env.MICROSOFT_SSO_CLIENT_ID || ''; }
    47	function ssoClientSecret(): string { return process.env.MICROSOFT_SSO_CLIENT_SECRET || ''; }
    48	function ssoTenantId(): string { return process.env.MICROSOFT_SSO_TENANT_ID || ''; }
    49	function ssoRedirectUriEnv(): string { return process.env.MICROSOFT_SSO_REDIRECT_URI || ''; }
    50	
    51	export function isSsoConfigured(): boolean {
    52	  return Boolean(ssoClientId() && ssoClientSecret());
    53	}
    54	
    55	/** Personal/consumer Microsoft accounts (outlook.com/live.com) resolve here. */
    56	export const MSA_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
    57	
    58	// Identity + delegated Graph scopes so a served artifact can act AS the signed-in user;
    59	// offline_access yields a refresh token so those actions survive the ~1h access-token life.
    60	const SSO_SCOPES = 'openid profile email offline_access Mail.Send Calendars.ReadWrite';
    61	
    62	function authority(): string {
    63	  return `https://login.microsoftonline.com/${ssoTenantId() || 'common'}`;
    64	}
    65	
    66	// ---------------------------------------------------------------------------
    67	// PKCE + tokens (pure/testable except the external fetches)
    68	// ---------------------------------------------------------------------------
    69	
    70	export interface Pkce { verifier: string; challenge: string }
    71	
    72	/** RFC 7636 PKCE pair: base64url verifier, S256 challenge. */
    73	export function generatePkce(): Pkce {
    74	  const verifier = randomBytes(32).toString('base64url');
    75	  const challenge = createHash('sha256').update(verifier).digest('base64url');
    76	  return { verifier, challenge };
    77	}
    78	
    79	/** Opaque high-entropy token (state, nonce, session id). */
    80	export function randomToken(bytes = 32): string {
    81	  return randomBytes(bytes).toString('base64url');
    82	}
    83	
    84	export interface AuthorizeParams { state: string; nonce: string; codeChallenge: string; redirectUri: string }
    85	
    86	export function buildAuthorizeUrl(p: AuthorizeParams): string {
    87	  const params = new URLSearchParams({
    88	    client_id: ssoClientId(),
    89	    response_type: 'code',
    90	    redirect_uri: p.redirectUri,
    91	    response_mode: 'query',
    92	    scope: SSO_SCOPES,
    93	    state: p.state,
    94	    nonce: p.nonce,
    95	    code_challenge: p.codeChallenge,
    96	    code_challenge_method: 'S256',
    97	    prompt: 'select_account',
    98	  });
    99	  return `${authority()}/oauth2/v2.0/authorize?${params.toString()}`;
   100	}
   101	
   102	export interface ExchangeResult { idToken: string; accessToken: string; refreshToken: string; expiresIn: number }
   103	
   104	export async function exchangeCode(opts: { code: string; codeVerifier: string; redirectUri: string }): Promise<ExchangeResult> {
   105	  const body = new URLSearchParams({
   106	    client_id: ssoClientId(),
   107	    client_secret: ssoClientSecret(),
   108	    grant_type: 'authorization_code',
   109	    code: opts.code,
   110	    redirect_uri: opts.redirectUri,
   111	    code_verifier: opts.codeVerifier,
   112	    scope: SSO_SCOPES,
   113	  });
   114	  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
   115	    method: 'POST',
   116	    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
   117	    body: body.toString(),
   118	  });
   119	  if (!res.ok) throw new Error(`SSO token exchange failed (${res.status}): ${await res.text()}`);
   120	  const data = (await res.json()) as { id_token?: string; access_token?: string; refresh_token?: string; expires_in?: number };
   121	  if (!data.id_token) throw new Error('SSO token exchange returned no id_token');
   122	  return { idToken: data.id_token, accessToken: data.access_token || '', refreshToken: data.refresh_token || '', expiresIn: data.expires_in || 3600 };
   123	}
   124	
   125	export interface RefreshResult { accessToken: string; refreshToken: string; expiresIn: number }
   126	
   127	export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
   128	  const body = new URLSearchParams({
   129	    client_id: ssoClientId(),
   130	    client_secret: ssoClientSecret(),
   131	    grant_type: 'refresh_token',
   132	    refresh_token: refreshToken,
   133	    scope: SSO_SCOPES,
   134	  });
   135	  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
   136	    method: 'POST',
   137	    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
   138	    body: body.toString(),
   139	  });
   140	  if (!res.ok) throw new Error(`SSO token refresh failed (${res.status}): ${await res.text()}`);
   141	  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
   142	  if (!data.access_token) throw new Error('SSO token refresh returned no access_token');
   143	  return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn: data.expires_in || 3600 };
   144	}
   145	
   146	// ---------------------------------------------------------------------------
   147	// id_token validation (the security boundary) — RS256 via node:crypto + per-tenant JWKS
   148	// ---------------------------------------------------------------------------
   149	
   150	export interface SsoIdentity { email: string; name?: string; oid?: string; tid?: string; preferredUsername?: string }
   151	
   152	const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
   153	
   154	interface Jwk { kid?: string; kty?: string; n?: string; e?: string; use?: string; [k: string]: unknown }
   155	const jwksByTenant = new Map<string, { at: number; keys: Jwk[] }>();
   156	const JWKS_TTL_MS = 60 * 60 * 1000;
   157	
   158	async function jwksForTenant(tid: string): Promise<Jwk[]> {
   159	  const cached = jwksByTenant.get(tid);
   160	  if (cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
   161	  const res = await fetch(`https://login.microsoftonline.com/${tid}/discovery/v2.0/keys`);
   162	  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status}) for tenant ${tid}`);
   163	  const json = (await res.json()) as { keys?: Jwk[] };
   164	  const keys = json.keys ?? [];
   165	  jwksByTenant.set(tid, { at: Date.now(), keys });
   166	  return keys;
   167	}
   168	
   169	function b64urlJson(seg: string): Record<string, unknown> {
   170	  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as Record<string, unknown>;
   171	}
   172	
   173	/**
   174	 * Cryptographically validate a Microsoft id_token and return the caller's identity. Pins:
   175	 * signature (per-tenant JWKS, RS256), audience (our SSO client id), nonce. Validates issuer
   176	 * dynamically as `https://login.microsoftonline.com/{tid}/v2.0` against the token's own
   177	 * tenant (required for a `common`-audience app). Throws on any failure.
   178	 */
   179	export async function validateIdToken(idToken: string, expectedNonce: string): Promise<SsoIdentity> {
   180	  const parts = idToken.split('.');
   181	  if (parts.length !== 3) throw new Error('id_token is not a well-formed JWT');
   182	  const [h, p, s] = parts as [string, string, string];
   183	
   184	  let header: Record<string, unknown>;
   185	  let payload: Record<string, unknown>;
   186	  try {
   187	    header = b64urlJson(h);
   188	    payload = b64urlJson(p);
   189	  } catch {
   190	    throw new Error('id_token is not a well-formed JWT');
   191	  }
   192	
   193	  const unsafeTid = payload.tid;
   194	  if (typeof unsafeTid !== 'string' || !GUID_RE.test(unsafeTid)) {
   195	    throw new Error('id_token has a missing or malformed tenant id (tid)');
   196	  }
   197	  if (header.alg !== 'RS256') throw new Error('id_token alg is not RS256');
   198	
   199	  const keys = await jwksForTenant(unsafeTid);
   200	  const jwk = keys.find((k) => k.kid === header.kid && (k.kty === 'RSA' || k.kty === undefined));
   201	  const n = jwk?.n;
   202	  const e = jwk?.e;
   203	  if (!n || !e) throw new Error('id_token signing key not found in tenant JWKS');
   204	
   205	  let verified: boolean;
   206	  try {
   207	    const pub = createPublicKey({ key: { kty: 'RSA', n, e }, format: 'jwk' });
   208	    const v = createVerify('RSA-SHA256');
   209	    v.update(`${h}.${p}`);
   210	    v.end();
   211	    verified = v.verify(pub, Buffer.from(s, 'base64url'));
   212	  } catch (err) {
   213	    throw new Error(`id_token signature validation failed: ${err instanceof Error ? err.message : String(err)}`);
   214	  }
   215	  if (!verified) throw new Error('id_token signature did not verify');
   216	
   217	  if (payload.aud !== ssoClientId()) throw new Error('id_token audience mismatch');
   218	  const expectedIssuer = `https://login.microsoftonline.com/${unsafeTid}/v2.0`;
   219	  if (payload.iss !== expectedIssuer) throw new Error('id_token issuer does not match its tenant');
   220	
   221	  const nowSec = Math.floor(Date.now() / 1000);
   222	  const skew = 60;
   223	  if (typeof payload.exp === 'number' && payload.exp + skew < nowSec) throw new Error('id_token expired');
   224	  if (typeof payload.nbf === 'number' && payload.nbf - skew > nowSec) throw new Error('id_token not yet valid');
   225	  if (!payload.nonce || payload.nonce !== expectedNonce) throw new Error('id_token nonce mismatch (possible replay)');
   226	
   227	  const claims = payload as { email?: string; name?: string; oid?: string; tid?: string; preferred_username?: string };
   228	  const email = claims.email || claims.preferred_username || '';
   229	  if (!email) throw new Error('id_token carried no email or preferred_username claim');
   230	  return { email, name: claims.name, oid: claims.oid, tid: claims.tid || unsafeTid, preferredUsername: claims.preferred_username };
   231	}
   232	
   233	// ---------------------------------------------------------------------------
   234	// Cookies + safe-appId (pure)
   235	// ---------------------------------------------------------------------------
   236	
   237	export const APP_SSO_COOKIE_PREFIX = 'ekoa_app_sso_';
   238	export const APP_SSO_CALLBACK_PATH = '/api/app-sso/microsoft/callback';
   239	
   240	const SAFE_APP_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
   241	export function isSafeAppId(appId: unknown): appId is string {
   242	  return typeof appId === 'string' && SAFE_APP_ID_RE.test(appId);
   243	}
   244	
   245	/** Per-app session cookie name. Isolation is by NAME + a server-side appId check, never
   246	 *  by cookie path. Throws on an unsafe appId so a crafted id can never reach a cookie name. */
   247	export function appSsoCookieName(appId: string): string {
   248	  if (!isSafeAppId(appId)) throw new Error(`Refusing to build an SSO cookie name for an unsafe appId: ${String(appId).slice(0, 40)}`);
   249	  return APP_SSO_COOKIE_PREFIX + appId;
   250	}
   251	
   252	/** The post-login return target must be an absolute path inside /apps/ on this same origin
   253	 *  (open-redirect guard for the `return` query param). */
   254	export function isSafeReturnPath(pth: unknown): pth is string {
   255	  return (
   256	    typeof pth === 'string' &&
   257	    pth.length > 0 &&
   258	    pth.length < 2048 &&
   259	    pth.startsWith('/apps/') &&
   260	    !pth.startsWith('//') &&
   261	    !pth.includes('\\') &&
   262	    !pth.includes('://') &&
   263	    // eslint-disable-next-line no-control-regex
   264	    !/[\x00-\x1f]/.test(pth)
   265	  );
   266	}
   267	
   268	/** Set-Cookie for the per-app session. Path scoped to the SSO endpoints; isolation is by
   269	 *  name + server-side appId check. crossSite true emits CHIPS (SameSite=None; Secure;
   270	 *  Partitioned) for the cross-site dashboard iframe; false emits SameSite=Lax. maxAgeMs 0
   271	 *  clears the cookie. */
   272	export function buildSessionCookie(name: string, value: string, maxAgeMs: number, opts: { crossSite: boolean }): string {
   273	  const base = `${name}=${value}; Path=/api/app-sso; HttpOnly; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
   274	  return opts.crossSite ? `${base}; Secure; SameSite=None; Partitioned` : `${base}; SameSite=Lax`;
   275	}
   276	
   277	function readNamedCookie(req: Request, name: string): string | undefined {
   278	  const cookieHeader = (req.headers.cookie || '') as string;
   279	  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   280	  return new RegExp('(?:^|;\\s*)' + escaped + '=([^;]+)').exec(cookieHeader)?.[1];
   281	}
   282	
   283	function requestOrigin(req: Request): string {
   284	  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol;
   285	  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.get('host') || '';
   286	  return `${proto}://${host}`;
   287	}
   288	
   289	function ssoRedirectUri(req: Request): string {
   290	  return ssoRedirectUriEnv() || `${requestOrigin(req)}${APP_SSO_CALLBACK_PATH}`;
   291	}
   292	
   293	function escapeHtmlBasic(s: string): string {
   294	  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
   295	}
   296	function ssoErrorPage(message: string): string {
   297	  return (
   298	    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in failed</title></head>' +
   299	    '<body style="font-family:system-ui;text-align:center;padding:3rem;color:#525252;">' +
   300	    '<h2>Sign-in failed</h2><p>' + escapeHtmlBasic(message) + '</p>' +
   301	    '<p style="font-size:13px;color:#a3a3a3;">You can close this window and try again.</p></body></html>'
   302	  );
   303	}
   304	function ssoAdminConsentPage(tenant?: string): string {
   305	  const tenantLine = tenant ? '<p style="font-size:13px;color:#a3a3a3;">Tenant: ' + escapeHtmlBasic(tenant) + '</p>' : '';
   306	  return (
   307	    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consentimento concedido</title></head>' +
   308	    '<body style="font-family:system-ui;text-align:center;padding:3rem;color:#525252;">' +
   309	    '<h2>Consentimento concedido</h2>' +
   310	    '<p>A aplicação Ekoa foi autorizada na sua organização. Os utilizadores já podem iniciar sessão com as suas contas Microsoft 365.</p>' +
   311	    tenantLine + '<p style="font-size:13px;color:#a3a3a3;">Pode fechar esta janela.</p></body></html>'
   312	  );
   313	}
   314	
   315	// ---------------------------------------------------------------------------
   316	// App-declared password auth helpers (ported)
   317	// ---------------------------------------------------------------------------
   318	
   319	const APP_AUTH_PRIVILEGED_ROLES = ['master', 'coordenador'];
   320	const BCRYPT_COST = 12;

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "git show 3ad6fb3:api/src/knowledge/index-store.ts | nl -ba | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:api/src/integrations/app-sso.ts | nl -ba | sed -n '320,620p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-w0KNL2Cl' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-hEG69jni' (errno=Operation not permitted)
     1	/**
     2	 * The lexical index (ch04 §4.4.1): SQLite FTS5 over the same markdown corpus the vault owns.
     3	 * It is DERIVED DATA — regenerable from the filesystem, never migrated — but persisted across
     4	 * restarts to avoid the multi-minute backfill (§6.2).
     5	 *
     6	 * Design points fixed by the spec:
     7	 *  - Accent-folded matching: the `unicode61 remove_diacritics 2` tokenizer folds diacritics on
     8	 *    BOTH sides, so a query for "acoes" finds "ações" (and vice-versa) with no app-side folding.
     9	 *  - BM25 relevance with a title weight, then a collection-authority multiplier (a firm's
    10	 *    authoritative collections — its legal spine — outrank incidental matches on a tie).
    11	 *  - Org partition on EVERY row and EVERY query: `orgId` is stored on each row and every search
    12	 *    filters by it, so a cross-org search is structurally impossible (proven by test).
    13	 *  - Write/delete hooks (called by the service) and a startup backfill / admin reindex.
    14	 *
    15	 * better-sqlite3 is a native, synchronous driver. This module is the ONLY importer of it. If the
    16	 * native build is unavailable on a host, the spec's sanctioned fallback (a ripgrep-style scan
    17	 * over the same files) would sit behind this same interface — on this build the native path is
    18	 * live (RUN_LOG decision).
    19	 */
    20	import Database from 'better-sqlite3';
    21	import { mkdir } from 'node:fs/promises';
    22	import { dirname } from 'node:path';
    23	import { existsSync, mkdirSync } from 'node:fs';
    24	import { indexDbPath, SHARED_ORG_ID } from './paths.js';
    25	
    26	export interface IndexRow {
    27	  orgId: string;
    28	  collection: string;
    29	  docId: string;
    30	  title: string;
    31	  body: string;
    32	  createdAt?: string;
    33	  sourceUrl?: string;
    34	  sourceType?: string;
    35	  language?: string;
    36	}
    37	
    38	export interface SearchHit {
    39	  docId: string;
    40	  collection: string;
    41	  title: string;
    42	  sourceUrl?: string;
    43	  snippet: string;
    44	  score: number;
    45	  /** Which partition the hit came from: the caller's own vault, or the shared corpus. The row's
    46	   *  orgId itself never surfaces on a hit (a caller must not learn the shared id or its own). */
    47	  scope: 'org' | 'shared';
    48	}
    49	
    50	/** Collection-authority weight: a firm's authoritative legal collections outrank incidental
    51	 *  matches on an otherwise-equal BM25 score. Deterministic, keyword-based, default 1.0. */
    52	export function collectionAuthority(collection: string): number {
    53	  const c = collection.toLowerCase();
    54	  if (c.includes('spine') || c.includes('espinha')) return 1.5;
    55	  if (c.includes('legal') || c.includes('shared') || c.includes('jurisprud')) return 1.25;
    56	  return 1.0;
    57	}
    58	
    59	// Portuguese + English stopwords: dropped from the MATCH query so grounding never triggers on
    60	// grammatical filler ("de", "the"). Small and deterministic.
    61	const STOPWORDS = new Set([
    62	  'de', 'a', 'o', 'e', 'do', 'da', 'em', 'um', 'uma', 'os', 'as', 'no', 'na', 'por', 'para', 'com',
    63	  'que', 'se', 'dos', 'das', 'ao', 'aos', 'pela', 'pelo', 'sua', 'seu', 'ou',
    64	  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'for', 'on', 'with', 'as', 'at', 'by',
    65	]);
    66	
    67	/** Turn free text into a safe FTS5 MATCH expression: fold to tokens, drop stopwords/short tokens,
    68	 *  quote each (so punctuation can never inject FTS operators), OR-join for recall. Returns null
    69	 *  when nothing meaningful remains (→ the caller stays silent). */
    70	export function toMatchQuery(text: string): string | null {
    71	  const tokens = text
    72	    .toLowerCase()
    73	    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    74	    .split(/\s+/)
    75	    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
    76	  if (tokens.length === 0) return null;
    77	  // de-dup preserving order
    78	  const seen = new Set<string>();
    79	  const uniq = tokens.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
    80	  return uniq.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    81	}
    82	
    83	let db: Database.Database | undefined;
    84	let openPath: string | undefined;
    85	
    86	function connect(): Database.Database {
    87	  const want = indexDbPath();
    88	  if (db && openPath === want) return db;
    89	  if (db) {
    90	    db.close();
    91	    db = undefined;
    92	  }
    93	  if (!existsSync(dirname(want))) mkdirSync(dirname(want), { recursive: true });
    94	  const d = new Database(want);
    95	  d.pragma('journal_mode = WAL');
    96	  // WAL-safe durability trade: NORMAL fsyncs at checkpoints, not every commit — the bulk import of
    97	  // a large corpus is otherwise fsync-bound, and the index is derived data (a lost tail rebuilds).
    98	  d.pragma('synchronous = NORMAL');
    99	  d.exec(
   100	    `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
   101	       orgId UNINDEXED, collection UNINDEXED, docId UNINDEXED,
   102	       title, body,
   103	       createdAt UNINDEXED, sourceUrl UNINDEXED, sourceType UNINDEXED, language UNINDEXED,
   104	       tokenize = 'unicode61 remove_diacritics 2'
   105	     );`,
   106	  );
   107	  // Doc-identity → fts rowid side map (same regenerable db). The FTS5 columns are all UNINDEXED, so
   108	  // a DELETE keyed on (orgId, collection, docId) is a full table scan — O(table) per write, which
   109	  // does not scale to a 500k-row shared corpus. The map turns every write/delete into a point
   110	  // lookup + `DELETE ... WHERE rowid = ?`. It is derived data: rebuilt from one fts scan whenever
   111	  // it drifts from the fts table (below), never migrated.
   112	  d.exec(
   113	    `CREATE TABLE IF NOT EXISTS knowledge_doc_map (
   114	       orgId TEXT NOT NULL, collection TEXT NOT NULL, docId TEXT NOT NULL,
   115	       ftsRowid INTEGER NOT NULL,
   116	       PRIMARY KEY (orgId, collection, docId)
   117	     ) WITHOUT ROWID;`,
   118	  );
   119	  db = d;
   120	  openPath = want;
   121	  healDocMap(d);
   122	  return d;
   123	}
   124	
   125	/** Self-heal the doc-map on open: if its row count differs from the fts table (a pre-map index, a
   126	 *  crash between the two writes, or any drift), rebuild it from one fts scan. Derived data — no
   127	 *  migration. Runs once per connection open; a fresh db has both counts 0 and is a no-op. */
   128	function healDocMap(d: Database.Database): void {
   129	  const ftsCount = (d.prepare('SELECT COUNT(*) AS n FROM knowledge_fts').get() as { n: number }).n;
   130	  const mapCount = (d.prepare('SELECT COUNT(*) AS n FROM knowledge_doc_map').get() as { n: number }).n;
   131	  if (ftsCount === mapCount) return;
   132	  const rows = d.prepare('SELECT rowid, orgId, collection, docId FROM knowledge_fts').all() as {
   133	    rowid: number; orgId: string; collection: string; docId: string;
   134	  }[];
   135	  const ins = d.prepare('INSERT OR REPLACE INTO knowledge_doc_map(orgId, collection, docId, ftsRowid) VALUES (?, ?, ?, ?)');
   136	  const tx = d.transaction(() => {
   137	    d.exec('DELETE FROM knowledge_doc_map');
   138	    for (const r of rows) ins.run(r.orgId, r.collection, r.docId, r.rowid);
   139	  });
   140	  tx();
   141	}
   142	
   143	/** Insert-or-replace one document's row (the write hook). A single-row {@link bulkIndexDocs}, so
   144	 *  the replace-by-map semantics are identical to a batched import. */
   145	export function indexDoc(row: IndexRow): void {
   146	  bulkIndexDocs([row]);
   147	}
   148	
   149	/**
   150	 * Bulk insert-or-replace (the importer's write path): ONE transaction for the whole batch, with
   151	 * map-based replace semantics — re-indexing a docId that already exists deletes its old fts row by
   152	 * rowid and re-inserts, so a re-bulk of the same doc replaces it with no duplicate rows. Prepared
   153	 * statements are hoisted out of the loop. A single {@link indexDoc} routes through here too.
   154	 */
   155	export function bulkIndexDocs(rows: IndexRow[]): void {
   156	  if (rows.length === 0) return;
   157	  const d = connect();
   158	  const findRowid = d.prepare('SELECT ftsRowid FROM knowledge_doc_map WHERE orgId = ? AND collection = ? AND docId = ?');
   159	  const delFts = d.prepare('DELETE FROM knowledge_fts WHERE rowid = ?');
   160	  const insFts = d.prepare(
   161	    `INSERT INTO knowledge_fts(orgId, collection, docId, title, body, createdAt, sourceUrl, sourceType, language)
   162	     VALUES (@orgId, @collection, @docId, @title, @body, @createdAt, @sourceUrl, @sourceType, @language)`,
   163	  );
   164	  const upsertMap = d.prepare(
   165	    `INSERT INTO knowledge_doc_map(orgId, collection, docId, ftsRowid) VALUES (?, ?, ?, ?)
   166	     ON CONFLICT(orgId, collection, docId) DO UPDATE SET ftsRowid = excluded.ftsRowid`,
   167	  );
   168	  const tx = d.transaction((batch: IndexRow[]) => {
   169	    for (const r of batch) {
   170	      const existing = findRowid.get(r.orgId, r.collection, r.docId) as { ftsRowid: number } | undefined;
   171	      if (existing) delFts.run(existing.ftsRowid);
   172	      const info = insFts.run({
   173	        orgId: r.orgId,
   174	        collection: r.collection,
   175	        docId: r.docId,
   176	        title: r.title,
   177	        body: r.body,
   178	        createdAt: r.createdAt ?? '',
   179	        sourceUrl: r.sourceUrl ?? '',
   180	        sourceType: r.sourceType ?? '',
   181	        language: r.language ?? '',
   182	      });
   183	      upsertMap.run(r.orgId, r.collection, r.docId, info.lastInsertRowid);
   184	    }
   185	  });
   186	  tx(rows);
   187	}
   188	
   189	/** FTS5 optimize: merge the b-tree segments into one for query-time speed after a bulk import.
   190	 *  Off the hot path — the importer calls it once at the end of an execute run. */
   191	export function optimizeIndex(): void {
   192	  connect().prepare(`INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')`).run();
   193	}
   194	
   195	/** Remove one document's row (the delete hook): map lookup → point delete by rowid. */
   196	export function removeDoc(orgId: string, collection: string, docId: string): void {
   197	  const d = connect();
   198	  const tx = d.transaction(() => {
   199	    const existing = d.prepare('SELECT ftsRowid FROM knowledge_doc_map WHERE orgId = ? AND collection = ? AND docId = ?').get(orgId, collection, docId) as { ftsRowid: number } | undefined;
   200	    if (!existing) return;
   201	    d.prepare('DELETE FROM knowledge_fts WHERE rowid = ?').run(existing.ftsRowid);
   202	    d.prepare('DELETE FROM knowledge_doc_map WHERE orgId = ? AND collection = ? AND docId = ?').run(orgId, collection, docId);
   203	  });
   204	  tx();
   205	}
   206	
   207	/** Drop every row for an org (used before an org reindex). Deletes the fts rows by rowid via the
   208	 *  map, then the org's map rows — so only the target partition is touched. */
   209	export function clearOrg(orgId: string): void {
   210	  const d = connect();
   211	  const tx = d.transaction(() => {
   212	    const rows = d.prepare('SELECT ftsRowid FROM knowledge_doc_map WHERE orgId = ?').all(orgId) as { ftsRowid: number }[];
   213	    const delFts = d.prepare('DELETE FROM knowledge_fts WHERE rowid = ?');
   214	    for (const r of rows) delFts.run(r.ftsRowid);
   215	    d.prepare('DELETE FROM knowledge_doc_map WHERE orgId = ?').run(orgId);
   216	  });
   217	  tx();
   218	}
   219	
   220	interface RawHit {
   221	  orgId: string;
   222	  docId: string;
   223	  collection: string;
   224	  title: string;
   225	  sourceUrl: string;
   226	  snip: string;
   227	  score: number;
   228	}
   229	
   230	/**
   231	 * Dual-scope lexical search: accent-folded BM25 (title-weighted) re-ranked by collection authority.
   232	 * A search consults the caller's OWN partition AND the reserved shared corpus (`_shared`), and
   233	 * NOTHING else — a cross-org search remains structurally impossible. When the caller IS the shared
   234	 * partition the two ids collapse to one (no duplicate scope). Each hit carries `scope` derived from
   235	 * its row's orgId; the orgId itself never surfaces.
   236	 */
   237	export function search(orgId: string, query: string, limit = 5): SearchHit[] {
   238	  const match = toMatchQuery(query);
   239	  if (!match) return [];
   240	  const d = connect();
   241	  // The caller's partition + the shared corpus. `IN (?, ?)` with equal ids when the caller is the
   242	  // shared partition collapses to a single-partition scan with no duplicate rows.
   243	  const shared = orgId === SHARED_ORG_ID ? orgId : SHARED_ORG_ID;
   244	  // Over-fetch so the authority re-rank has candidates, then trim to `limit`.
   245	  const rows = d
   246	    .prepare(
   247	      // bm25 weights are positional over EVERY column (incl. UNINDEXED): only title (col 3) and
   248	      // body (col 4) carry weight; title is up-weighted so a title hit outranks a body-only hit.
   249	      // Adding orgId to the SELECT does not shift the weights — bm25 is keyed on table columns.
   250	      `SELECT orgId, docId, collection, title, sourceUrl,
   251	              snippet(knowledge_fts, -1, '', '', ' … ', 12) AS snip,
   252	              bm25(knowledge_fts, 0.0, 0.0, 0.0, 10.0, 1.0, 0.0, 0.0, 0.0, 0.0) AS score
   253	       FROM knowledge_fts
   254	       WHERE knowledge_fts MATCH ? AND orgId IN (?, ?)
   255	       ORDER BY score
   256	       LIMIT ?`,
   257	    )
   258	    .all(match, orgId, shared, Math.max(limit * 4, limit)) as RawHit[];
   259	  // bm25 is smaller-is-better (negative); relevance = -score, then scale by authority.
   260	  const ranked = rows

 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-g5YAXqJC' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-aL3HnqUD' (errno=Operation not permitted)
   320	const BCRYPT_COST = 12;
   321	let _dummyHash: Promise<string> | null = null;
   322	function appAuthDummyHash(): Promise<string> {
   323	  if (!_dummyHash) _dummyHash = bcrypt.hash('ekoa-app-auth-no-such-user', BCRYPT_COST);
   324	  return _dummyHash;
   325	}
   326	
   327	interface AppAuthRequest { collection: string; identityField: string; identity: string; password: string }
   328	function readAppAuthBody(req: Request): AppAuthRequest | null {
   329	  const b = (req.body || {}) as Record<string, unknown>;
   330	  const collection = typeof b.collection === 'string' ? b.collection : '';
   331	  const identityField = typeof b.identityField === 'string' ? b.identityField : '';
   332	  const identity = typeof b.identity === 'string' ? b.identity.trim() : '';
   333	  const password = typeof b.password === 'string' ? b.password : '';
   334	  if (!collectionName.safeParse(collection).success) return null;
   335	  if (!/^[A-Za-z0-9_]{1,40}$/.test(identityField)) return null;
   336	  if (!identity || !password) return null;
   337	  return { collection, identityField, identity, password };
   338	}
   339	
   340	// ---------------------------------------------------------------------------
   341	// Router
   342	// ---------------------------------------------------------------------------
   343	
   344	export interface AppSsoDeps {
   345	  now: () => number;
   346	  genId: () => string;
   347	  /** Injected by server.ts (see app-scope.ts) so integrations/ never imports apps/. */
   348	  resolveAppScope: ResolveAppScope;
   349	  /** Cross-site (CHIPS) cookie attributes. Defaults to NODE_ENV === 'production'. */
   350	  crossSite?: boolean;
   351	}
   352	
   353	export function appSsoRouter(deps: AppSsoDeps): Router {
   354	  const r = Router();
   355	  const engine = new CollectionsEngine({ now: deps.now, genId: deps.genId });
   356	  const crossSite = deps.crossSite ?? process.env.NODE_ENV === 'production';
   357	  const setCookie = (name: string, value: string, maxAgeMs: number) => buildSessionCookie(name, value, maxAgeMs, { crossSite });
   358	
   359	  /** Resolve the header to a canonical, cookie-safe app id, or null. */
   360	  async function resolveCanonical(req: Request): Promise<{ appId: string; ownerUserId: string } | null> {
   361	    const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
   362	    if (!headerId) return null;
   363	    const app = await deps.resolveAppScope(headerId);
   364	    if (!app || !isSafeAppId(app.appId)) return null;
   365	    return { appId: app.appId, ownerUserId: app.ownerUserId };
   366	  }
   367	
   368	  /** Find a user row in the app's own app-data collection by identity field. */
   369	  async function findUser(appId: string, collection: string, identityField: string, identity: string): Promise<Record<string, unknown> | null> {
   370	    const rows = await engine.list(appScope(appId), collection);
   371	    const want = identity.trim().toLowerCase();
   372	    return rows.find((row) => String(row[identityField] ?? '').trim().toLowerCase() === want) ?? null;
   373	  }
   374	
   375	  // --- Username/password sign-in → mints the per-app session cookie -------------------
   376	  r.post('/login', expressJson({ limit: '256kb' }), async (req, res) => {
   377	    res.setHeader('Cache-Control', 'no-store');
   378	    const scope = await resolveCanonical(req);
   379	    if (!scope) { res.status(400).json({ success: false, error: 'missing_or_invalid_app_id' }); return; }
   380	    const gate = checkOwnerActivation(scope.ownerUserId);
   381	    if (!gate.ok) { res.status(gate.status).json(gate.body); return; }
   382	    const body = readAppAuthBody(req);
   383	    if (!body) { res.status(400).json({ success: false, error: 'invalid_request' }); return; }
   384	    try {
   385	      const row = await findUser(scope.appId, body.collection, body.identityField, body.identity);
   386	      const storedHash = row && typeof row.passwordHash === 'string' ? (row.passwordHash as string) : '';
   387	      // Always run a bcrypt compare (real or dummy) to blunt user-enumeration timing.
   388	      const valid = await bcrypt.compare(body.password, storedHash || (await appAuthDummyHash())).catch(() => false);
   389	      if (!row || !storedHash || !valid) { res.status(401).json({ success: false, error: 'invalid_credentials' }); return; }
   390	      const now = deps.now();
   391	      const session: AppSessionDoc = {
   392	        _id: randomToken(),
   393	        appId: scope.appId,
   394	        email: body.identity,
   395	        name: typeof row.name === 'string' ? (row.name as string) : undefined,
   396	        createdAt: new Date(now).toISOString(),
   397	        expiresAt: new Date(now + APP_SESSION_TTL_MS).toISOString(),
   398	        // Bind authorization to the collection we actually verified against.
   399	        authCollection: body.collection,
   400	        authIdentityField: body.identityField,
   401	      };
   402	      await appSessions.insert(session);
   403	      res.setHeader('Set-Cookie', setCookie(appSsoCookieName(scope.appId), session._id, APP_SESSION_TTL_MS));
   404	      res.json({ success: true, data: { email: session.email, name: session.name || null } });
   405	    } catch (err) {
   406	      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
   407	    }
   408	  });
   409	
   410	  // --- Set/reset a user's password (self, or privileged caller in own collection) -----
   411	  r.post('/set-password', expressJson({ limit: '256kb' }), async (req, res) => {
   412	    res.setHeader('Cache-Control', 'no-store');
   413	    const scope = await resolveCanonical(req);
   414	    if (!scope) { res.status(400).json({ success: false, error: 'missing_or_invalid_app_id' }); return; }
   415	    const gate = checkOwnerActivation(scope.ownerUserId);
   416	    if (!gate.ok) { res.status(gate.status).json(gate.body); return; }
   417	    const body = readAppAuthBody(req);
   418	    if (!body) { res.status(400).json({ success: false, error: 'invalid_request' }); return; }
   419	    const token = readNamedCookie(req, appSsoCookieName(scope.appId));
   420	    const session = token ? await findValidAppSession(token, scope.appId) : null;
   421	    if (!session) { res.status(401).json({ success: false, error: 'not_authenticated' }); return; }
   422	    try {
   423	      const sameEmail = body.identity.trim().toLowerCase() === String(session.email).trim().toLowerCase();
   424	      // "Self" = the EXACT authenticated principal (for password sessions: same collection +
   425	      // identity field the session logged in against), not merely a matching email string.
   426	      const isSelf = sameEmail && (!session.authCollection
   427	        || (body.collection === session.authCollection && body.identityField === session.authIdentityField));
   428	      if (!isSelf) {
   429	        // Authorize against the collection this session authenticated against at login
   430	        // (server-established) — NEVER the request's collection.
   431	        const callerColl = session.authCollection || body.collection;
   432	        const callerField = session.authIdentityField || body.identityField;
   433	        const caller = await findUser(scope.appId, callerColl, callerField, session.email);
   434	        const callerRole = caller && typeof caller.role === 'string' ? (caller.role as string) : '';
   435	        if (!APP_AUTH_PRIVILEGED_ROLES.includes(callerRole)) { res.status(403).json({ success: false, error: 'forbidden' }); return; }
   436	        if (session.authCollection && body.collection !== session.authCollection) {
   437	          res.status(403).json({ success: false, error: 'forbidden_collection' }); return;
   438	        }
   439	      }
   440	      const target = await findUser(scope.appId, body.collection, body.identityField, body.identity);
   441	      if (!target || typeof target.id !== 'string') { res.status(404).json({ success: false, error: 'user_not_found' }); return; }
   442	      const hash = await bcrypt.hash(body.password, BCRYPT_COST);
   443	      await engine.upsert(appScope(scope.appId), body.collection, target.id as string, { passwordHash: hash });
   444	      res.json({ success: true });
   445	    } catch (err) {
   446	      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
   447	    }
   448	  });
   449	
   450	  // --- who am I? (per-app cookie; 401 when signed out; identity when signed in) -------
   451	  r.get('/me', async (req, res) => {
   452	    res.setHeader('Cache-Control', 'no-store');
   453	    const scope = await resolveCanonical(req);
   454	    const token = scope ? readNamedCookie(req, appSsoCookieName(scope.appId)) : undefined;
   455	    const session = scope && token ? await findValidAppSession(token, scope.appId) : null;
   456	    if (!session) { res.status(401).json({ success: false, error: 'not_authenticated' }); return; }
   457	    res.json({
   458	      success: true,
   459	      data: {
   460	        email: session.email,
   461	        name: session.name || null,
   462	        oid: session.oid || null,
   463	        tid: session.tid || null,
   464	        canSendMail: Boolean(session.graphTokensEnc),
   465	      },
   466	    });
   467	  });
   468	
   469	  // --- sign out — delete the session + clear the per-app cookie -----------------------
   470	  r.post('/logout', async (req, res) => {
   471	    res.setHeader('Cache-Control', 'no-store');
   472	    const scope = await resolveCanonical(req);
   473	    if (scope) {
   474	      const cookieName = appSsoCookieName(scope.appId);
   475	      const token = readNamedCookie(req, cookieName);
   476	      if (token) await appSessions.delete(token).catch(() => {});
   477	      res.setHeader('Set-Cookie', setCookie(cookieName, '', 0));
   478	    }
   479	    res.json({ success: true });
   480	  });
   481	
   482	  // --- Microsoft OIDC: begin sign-in --------------------------------------------------
   483	  r.get('/microsoft/start', async (req, res) => {
   484	    if (!isSsoConfigured()) {
   485	      res.status(503).type('text/html').send(ssoErrorPage('Microsoft sign-in is not configured for this platform.'));
   486	      return;
   487	    }
   488	    const rawAppId = (req.query.appId as string | undefined) || '';
   489	    if (!rawAppId) { res.status(400).type('text/html').send(ssoErrorPage('Missing appId.')); return; }
   490	    const app = await deps.resolveAppScope(rawAppId);
   491	    if (!app || !isSafeAppId(app.appId)) { res.status(400).type('text/html').send(ssoErrorPage('Invalid appId.')); return; }
   492	
   493	    const returnUrl = isSafeReturnPath(req.query.return) ? (req.query.return as string) : `/apps/${encodeURIComponent(rawAppId)}/`;
   494	    const state = randomToken();
   495	    const nonce = randomToken();
   496	    const pkce = generatePkce();
   497	    const redirectUri = ssoRedirectUri(req);
   498	    const now = deps.now();
   499	    await pendingAppAuth.insert({
   500	      _id: state,
   501	      appId: app.appId,
   502	      nonce,
   503	      pkceVerifier: pkce.verifier,
   504	      returnUrl,
   505	      redirectUri,
   506	      createdAt: new Date(now).toISOString(),
   507	      expiresAt: new Date(now + PENDING_AUTH_TTL_MS).toISOString(),
   508	    });
   509	    res.redirect(302, buildAuthorizeUrl({ state, nonce, codeChallenge: pkce.challenge, redirectUri }));
   510	  });
   511	
   512	  // --- Microsoft OIDC: callback (single-use state, id_token validation, session) ------
   513	  r.get('/microsoft/callback', async (req, res) => {
   514	    const code = req.query.code as string | undefined;
   515	    const state = req.query.state as string | undefined;
   516	    const aadError = (req.query.error_description as string | undefined) || (req.query.error as string | undefined);
   517	
   518	    const adminConsent = req.query.admin_consent as string | undefined;
   519	    if (adminConsent && adminConsent.toLowerCase() === 'true' && !code) {
   520	      res.status(200).type('text/html').send(ssoAdminConsentPage(req.query.tenant as string | undefined));
   521	      return;
   522	    }
   523	    if (aadError && !code) { res.status(400).type('text/html').send(ssoErrorPage('Microsoft returned an error during sign-in.')); return; }
   524	    if (!code || !state) { res.status(400).type('text/html').send(ssoErrorPage('Missing authorization code or state.')); return; }
   525	
   526	    // Single-use lookup by state (consumed on read → no replay).
   527	    const pending = await consumePendingAppAuth(state);
   528	    if (!pending) {
   529	      res.status(400).type('text/html').send(ssoErrorPage('Your sign-in session expired or was already used. Please try again.'));
   530	      return;
   531	    }
   532	    try {
   533	      const tokens = await exchangeCode({ code, codeVerifier: pending.pkceVerifier, redirectUri: pending.redirectUri });
   534	      const identity = await validateIdToken(tokens.idToken, pending.nonce);
   535	      const now = deps.now();
   536	      const session: AppSessionDoc = {
   537	        _id: randomToken(),
   538	        appId: pending.appId,
   539	        email: identity.email,
   540	        name: identity.name,
   541	        oid: identity.oid,
   542	        tid: identity.tid,
   543	        createdAt: new Date(now).toISOString(),
   544	        expiresAt: new Date(now + APP_SESSION_TTL_MS).toISOString(),
   545	      };
   546	      if (tokens.accessToken) {
   547	        try {
   548	          session.graphTokensEnc = encrypt(JSON.stringify({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken }));
   549	          session.graphTokenExpiresAt = new Date(now + tokens.expiresIn * 1000).toISOString();
   550	        } catch (e) {
   551	          console.warn('[app-sso] could not persist graph token:', e instanceof Error ? e.message : e);
   552	        }
   553	      }
   554	      await appSessions.insert(session);
   555	      res.setHeader('Set-Cookie', setCookie(appSsoCookieName(pending.appId), session._id, APP_SESSION_TTL_MS));
   556	      res.redirect(302, pending.returnUrl);
   557	    } catch (err) {
   558	      console.error('[app-sso] callback failed:', err instanceof Error ? err.message : err);
   559	      res.status(500).type('text/html').send(ssoErrorPage('Could not complete sign-in. Please try again.'));
   560	    }
   561	  });
   562	
   563	  // --- Visitor Microsoft Graph proxy (acts AS the signed-in visitor) ------------------
   564	  r.all(/^\/m365\/(.+)$/, expressRaw({ type: '*/*', limit: '30mb' }), async (req, res) => {
   565	    res.setHeader('Cache-Control', 'no-store');
   566	    const scope = await resolveCanonical(req);
   567	    if (!scope) { res.status(401).json({ error: 'not_authenticated' }); return; }
   568	    const gate = checkOwnerActivation(scope.ownerUserId);
   569	    if (!gate.ok) { res.status(gate.status).json(gate.body); return; }
   570	    const token = readNamedCookie(req, appSsoCookieName(scope.appId));
   571	    const session = token ? await findValidAppSession(token, scope.appId) : null;
   572	    if (!session) { res.status(401).json({ error: 'not_authenticated' }); return; }
   573	
   574	    const accessToken = await getSessionGraphAccessToken(session);
   575	    if (!accessToken) { res.status(403).json({ error: 'graph_not_authorized', message: 'Sign in again to grant email/calendar access.' }); return; }
   576	
   577	    const graphPath = (req.params as Record<string, string>)[0] ?? '';
   578	    try {
   579	      await proxyToGraph(req, res, graphPath, accessToken);
   580	    } catch (err) {
   581	      console.error(`[app-sso-m365] ${req.method} ${graphPath} failed:`, err instanceof Error ? err.message : err);
   582	      res.status(502).json({ error: `Microsoft Graph proxy error: ${err instanceof Error ? err.message : String(err)}` });
   583	    }
   584	  });
   585	
   586	  return r;
   587	}
   588	
   589	/**
   590	 * Decrypt and return a valid Graph access token for a session, refreshing + re-persisting
   591	 * when within 60s of expiry. Null when the session carries no graph token or the refresh
   592	 * failed (revoked/expired) — the app must then re-consent.
   593	 */
   594	async function getSessionGraphAccessToken(session: AppSessionDoc): Promise<string | null> {
   595	  if (!session.graphTokensEnc) return null;
   596	  let parsed: { access_token?: string; refresh_token?: string };
   597	  try {
   598	    parsed = JSON.parse(decrypt(session.graphTokensEnc));
   599	  } catch {
   600	    return null;
   601	  }
   602	  const exp = session.graphTokenExpiresAt ? Date.parse(session.graphTokenExpiresAt) : 0;
   603	  if (parsed.access_token && exp && Date.now() < exp - 60_000) return parsed.access_token;
   604	  if (!parsed.refresh_token) return parsed.access_token || null;
   605	  try {
   606	    const refreshed = await refreshAccessToken(parsed.refresh_token);
   607	    await appSessions.update(session._id, (cur) => ({
   608	      ...cur,
   609	      graphTokensEnc: encrypt(JSON.stringify({ access_token: refreshed.accessToken, refresh_token: refreshed.refreshToken })),
   610	      graphTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
   611	    }));
   612	    return refreshed.accessToken;
   613	  } catch (err) {
   614	    console.warn('[app-sso-m365] graph token refresh failed:', err instanceof Error ? err.message : err);
   615	    return null;
   616	  }
   617	}
   618	
   619	/** Forward a request verbatim to Microsoft Graph with the given bearer, mirroring the
   620	 *  upstream status + content-type. Raw bodies pass through; a pre-parsed JSON body (when

exec
/bin/zsh -lc "git show 3ad6fb3:api/src/apps/app-assistant.ts | nl -ba | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-b66qzVKA' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Jq0dyHy6' (errno=Operation not permitted)
     1	/**
     2	 * Served-app assistant — pure logic (operator-run D1).
     3	 *
     4	 * The brain behind `POST /api/app-assistant`: given a visitor's message, the resolved artifact
     5	 * OWNER, and the app's declared action manifest, it produces the assistant's reply, the knowledge
     6	 * citations it drew on, the app-actions it wants the in-page runtime (C3) to execute, and the mode
     7	 * it operated in. It is HTTP-free and model-transport-free: the chokepoint one-shot, the knowledge
     8	 * grounding builder, and the routing decision are all INJECTED (`AppAssistantDeps`), so it unit-
     9	 * tests with a canned model and no live egress. The route (app-assistant-route.ts) binds the real
    10	 * deps — `runOneShot` / `buildGroundingBlock` / `decideForTask` — behind the llm/ + knowledge/
    11	 * public entries, so the assistant's only model egress stays the llm/ chokepoint (FIXED-3).
    12	 *
    13	 * Load-bearing invariants:
    14	 *  - The org is ALWAYS the resolved owner's org (`input.owner.orgId`) — never anything the
    15	 *    anonymous visitor supplied. Grounding is org-partitioned by that org; the caller cannot steer
    16	 *    it (the served-app "orgId from the resolved subject, not from arguments" rule).
    17	 *  - Billing is `assistant-chat` (a UserWorkAgentType) billed to the artifact OWNER + artifactId —
    18	 *    never the anonymous visitor.
    19	 *  - The assistant PROPOSES actions; it never executes them. Requested actions are validated
    20	 *    against the manifest's tool names and unknown ones are dropped, so the endpoint can only ever
    21	 *    ask the client to run an action the app actually declared.
    22	 *  - No permission / auth-decision logic here (the security block gates capability later; admission
    23	 *    = owner activation, enforced at the route).
    24	 */
    25	import type {
    26	  AppAction,
    27	  AppActionManifest,
    28	  AssistantChatMessage,
    29	  AssistantChatMode,
    30	  AssistantCitation,
    31	  AssistantAction,
    32	} from '@ekoa/shared';
    33	import { assistantToolsFromManifest, type AssistantToolDef } from './assistant-tools.js';
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
    81	  // 'como ' is the PT-PT how-to signal (covers "como funciona", "como criar", "como usar", …); a
    82	  // trailing space keeps it from matching inside unrelated words.
    83	  'tutorial', 'ensina', 'ensinar', 'explica', 'explicar', 'como ',
    84	  'passo a passo', 'aprender', 'guia de', 'ensino',
    85	];
    86	/** Show-mode cues (folded): the visitor wants an overview / to be shown around. */
    87	const SHOW_KEYWORDS = [
    88	  'mostre', 'mostra', 'mostrar', 'visao geral', 'vista geral', 'panorama', 'apresenta',
    89	  'apresentar', 'resumo geral', 'o que faz esta', 'o que e que esta',
    90	];
    91	
    92	/**
    93	 * Deterministic PT-PT mode classifier (no model call). Teach cues win over show cues (a "mostra-me
    94	 * como criar" is a walkthrough, not an overview); everything else — including bare imperative task
    95	 * verbs ("cria", "adiciona", "envia") — defaults to 'do', the operate mode.
    96	 */
    97	export function inferMode(message: string): AssistantChatMode {
    98	  const f = fold(message);
    99	  if (TEACH_KEYWORDS.some((k) => f.includes(k))) return 'teach';
   100	  if (SHOW_KEYWORDS.some((k) => f.includes(k))) return 'show';
   101	  return 'do';
   102	}
   103	
   104	const MODE_INSTRUCTION: Record<AssistantChatMode, string> = {
   105	  do: 'O utilizador quer executar uma tarefa. Quando fizer sentido, pede à aplicação para executar as ações necessárias (ver o protocolo de ações abaixo) e confirma em prosa o que foi feito.',
   106	  show: 'O utilizador quer uma visão geral. Descreve o que a aplicação faz e o que está visível no ecrã atual, sem executar ações destrutivas.',
   107	  teach: 'O utilizador quer aprender. Explica passo a passo, como um tutorial, sem executar ações em nome do utilizador a menos que ele peça explicitamente.',
   108	};
   109	
   110	/** One readable line per available action for the system prompt (name, description, destructive
   111	 *  marker, and its parameters with PT-PT labels). */
   112	function describeTool(tool: AssistantToolDef): string {
   113	  const params = tool.action.params
   114	    .map((p) => `${p.name}${p.required ? ' (obrigatório)' : ''}${p.labelPt ? ` — ${p.labelPt}` : ''}`)
   115	    .join(', ');
   116	  const parts = [`- ${tool.name}: ${tool.description}`];
   117	  if (tool.destructive) parts.push('[AÇÃO DESTRUTIVA — a aplicação pede confirmação antes de executar]');
   118	  if (params) parts.push(`Parâmetros: ${params}.`);
   119	  return parts.join(' ');
   120	}
   121	
   122	/** Build the assistant system prompt: the three capabilities, the active mode, PT-PT + cite-your-
   123	 *  source discipline, the callable app-actions, the structured-actions protocol, and the current
   124	 *  screen context. The grounding block (already formatted) rides at the end. */
   125	function buildSystemPrompt(
   126	  mode: AssistantChatMode,
   127	  tools: AssistantToolDef[],
   128	  groundingBlock: string,
   129	  context: AppAssistantInput['context'],
   130	): string {
   131	  const sections: string[] = [];
   132	
   133	  sections.push(
   134	    'És o assistente desta aplicação, ao serviço do utilizador que a está a usar. Tens três capacidades:\n' +
   135	      '1. OPERAR a aplicação pelo utilizador — executar tarefas através das ações disponíveis (modo "do").\n' +
   136	      '2. APRESENTAR — dar uma visão geral do que a aplicação faz e do ecrã atual (modo "show").\n' +
   137	      '3. ENSINAR — explicar passo a passo como usar a aplicação, como um tutorial (modo "teach").',
   138	  );
   139	
   140	  sections.push(`Estás no modo "${mode}". ${MODE_INSTRUCTION[mode]}`);
   141	
   142	  sections.push(
   143	    'Responde SEMPRE em português de Portugal (PT-PT), de forma clara e objetiva, em registo ' +
   144	      'formal (trata o utilizador por você; nunca uses tuteio como "queres" ou "podes").',
   145	  );
   146	
   147	  sections.push(
   148	    'CONHECIMENTO: usa apenas os excertos fornecidos no bloco CONHECIMENTO abaixo (quando existir) e ' +
   149	      'cita a fonte que usaste. Nunca inventes factos nem fontes. Se não houver conhecimento relevante, ' +
   150	      'responde apenas com o que sabes sobre a própria aplicação, sem citar.',
   151	  );
   152	
   153	  if (tools.length > 0) {
   154	    sections.push(
   155	      'AÇÕES DA APLICAÇÃO — podes pedir à aplicação para executar estas ações em nome do utilizador:\n' +
   156	        tools.map(describeTool).join('\n') +
   157	        '\n\nPara pedir a execução de uma ou mais ações, inclui na tua resposta UM bloco delimitado ' +
   158	        'exatamente assim:\n```ekoa-actions\n[{"toolName":"<nome-da-ação>","input":{ ... }}]\n```\n' +
   159	        'O bloco tem de ser um array JSON válido e usar APENAS os nomes de ações listados acima. A ' +
   160	        'aplicação é que executa as ações — tu nunca as executas diretamente. Escreve sempre também ' +
   161	        'uma resposta em prosa para o utilizador (o bloco é removido antes de lhe ser mostrado).',
   162	    );
   163	  } else {
   164	    sections.push(
   165	      'Esta aplicação não declara ações operáveis: podes apresentar e ensinar, mas não podes operar a ' +
   166	        'aplicação pelo utilizador.',
   167	    );
   168	  }
   169	
   170	  if (context?.route) {
   171	    sections.push(`O utilizador está atualmente na rota "${context.route}" da aplicação.`);
   172	  }
   173	  if (context?.actionResults && context.actionResults.length > 0) {
   174	    sections.push('Existem resultados de ações anteriores no contexto desta sessão.');
   175	  }
   176	
   177	  if (groundingBlock.trim()) sections.push(groundingBlock.trim());
   178	
   179	  return sections.join('\n\n');
   180	}
   181	
   182	/** Render the conversation history + current message into the single one-shot prompt string. */
   183	function renderPrompt(history: AssistantChatMessage[] | undefined, message: string): string {
   184	  if (!history || history.length === 0) return message;
   185	  const transcript = history
   186	    .map((t) => `<turn role="${t.role}">\n${t.content}\n</turn>`)
   187	    .join('\n');
   188	  return `<conversation>\n${transcript}\n</conversation>\n\n${message}`;
   189	}
   190	
   191	/** A fresh matcher each call (the /g flag is stateful — never share the literal across calls). */
   192	function actionsFence(): RegExp {
   193	  return /```ekoa-actions[^\n]*\n([\s\S]*?)```/g;
   194	}
   195	
   196	/**
   197	 * Pull every `ekoa-actions` fenced block out of the model reply: parse each as a JSON array of
   198	 * `{ toolName, input }`, keep only actions whose toolName is a REAL manifest tool (unknown names
   199	 * dropped — the endpoint can only ask the client to run a declared action), attach the SERVER's
   200	 * copy of that action's manifest AppAction (so the C3 runtime can execute without the manifest,
   201	 * which is not injected into the served page), and strip the blocks from the user-facing prose. A
   202	 * malformed block is skipped (still stripped) — never surfaced raw.
   203	 */
   204	export function extractActions(
   205	  reply: string,
   206	  toolsByName: ReadonlyMap<string, AppAction>,
   207	): { text: string; actions: AssistantAction[] } {
   208	  const actions: AssistantAction[] = [];
   209	  const scan = actionsFence();
   210	  let m: RegExpExecArray | null;
   211	  while ((m = scan.exec(reply)) !== null) {
   212	    let parsed: unknown;
   213	    try {
   214	      parsed = JSON.parse((m[1] ?? '').trim());
   215	    } catch {
   216	      continue; // malformed block — drop it (it is stripped from the prose below regardless)
   217	    }
   218	    if (!Array.isArray(parsed)) continue;
   219	    for (const item of parsed) {
   220	      if (!item || typeof item !== 'object') continue;
   221	      const toolName = (item as { toolName?: unknown }).toolName;
   222	      if (typeof toolName !== 'string') continue;
   223	      const action = toolsByName.get(toolName);
   224	      if (!action) continue; // unknown tool -> drop (the app never declared it)
   225	      const rawInput = (item as { input?: unknown }).input;
   226	      const input =
   227	        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
   228	          ? (rawInput as Record<string, unknown>)
   229	          : {};
   230	      // The fenced path honours the SAME param contract the SDK tool schema enforces
   231	      // (`additionalProperties: false` in assistant-tools): keep ONLY the params the
   232	      // manifest declares for this action. Undeclared keys from the model are dropped,
   233	      // never forwarded to the runtime — for `custom` actions they would otherwise
   234	      // reach app code verbatim.
   235	      const declared = new Set(action.params.map((p) => p.name));
   236	      const filtered: Record<string, unknown> = {};
   237	      for (const [key, value] of Object.entries(input)) {
   238	        if (declared.has(key)) filtered[key] = value;
   239	      }
   240	      // Attach the server-authoritative manifest action; the client dispatches
   241	      // `execute({ ...action, params: input })` (values override the param definitions).
   242	      actions.push({ toolName, input: filtered, action });
   243	    }
   244	  }
   245	  const text = reply.replace(actionsFence(), '').trim();
   246	  return { text, actions };
   247	}
   248	
   249	/**
   250	 * Run the served-app assistant for one turn. Grounds under the OWNER's org, calls the model once
   251	 * through the injected chokepoint one-shot billed to the owner, and returns the prose reply (with
   252	 * any actions block stripped), the inferred/pinned mode, the knowledge citations, and the validated
   253	 * app-actions the client runtime should execute.
   254	 */
   255	export async function runAppAssistant(
   256	  input: AppAssistantInput,
   257	  deps: AppAssistantDeps,
   258	): Promise<AppAssistantResult> {
   259	  const mode: AssistantChatMode = input.mode ?? inferMode(input.message);
   260	  const tools = assistantToolsFromManifest(input.actionManifest);

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "git show 3ad6fb3:api/src/apps/app-assistant.ts | nl -ba | sed -n '260,360p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "git show 3ad6fb3:api/tests/contract/jobs-capability.test.ts | nl -ba | sed -n '1,280p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-QNWsWFRV' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-7zCC8HbC' (errno=Operation not permitted)
   260	  const tools = assistantToolsFromManifest(input.actionManifest);
   261	  // toolName -> the manifest AppAction. The value validates + names the tool AND carries the
   262	  // server-authoritative executable shape that D1 attaches to each proposed action.
   263	  const toolsByName = new Map(tools.map((t) => [t.name, t.action] as const));
   264	
   265	  // Grounding ALWAYS under the resolved owner's org (never a caller-supplied org); kind:'chat'
   266	  // grounds unconditionally and is cited-or-silent.
   267	  const grounding = deps.ground({ orgId: input.owner.orgId, query: input.message, kind: 'chat' });
   268	  const citations: AssistantCitation[] = grounding.hits.map((h) => ({
   269	    collection: h.collection,
   270	    docId: h.docId,
   271	    title: h.title,
   272	  }));
   273	
   274	  const systemPrompt = buildSystemPrompt(mode, tools, grounding.block, input.context);
   275	  const prompt = renderPrompt(input.history, input.message);
   276	  const decision = deps.decide(input.message);
   277	
   278	  // assistant-chat is a UserWorkAgentType — billed to the ARTIFACT OWNER + artifactId, never the
   279	  // anonymous visitor.
   280	  const attribution: LlmAttribution = {
   281	    kind: 'user_work',
   282	    agentType: 'assistant-chat',
   283	    billeeUserId: input.owner.userId,
   284	    artifactId: input.artifactId,
   285	  };
   286	
   287	  const res = await deps.oneShot({ prompt, systemPrompt, decision }, attribution);
   288	  const { text, actions } = extractActions(res.text, toolsByName);
   289	
   290	  return { reply: text, mode, citations, actions };
   291	}

 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-UjS3Ao1i' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-dra0swZk' (errno=Operation not permitted)
     1	/**
     2	 * H1 build-authorization gate + the follow-up-build IDOR fix (map §5.1), exercised through the
     3	 * REAL jobs router over mongo-mem. The build EXECUTOR is mocked (`handleBuildCreate`) so no real
     4	 * build runs: the gate lives entirely in the route BEFORE the executor, so a refusal means the
     5	 * executor was never called, and a proceed means it was called with the expected args.
     6	 *
     7	 * Matrix under test:
     8	 *  - first build: a `user` (no canBuildApps) is refused 403; an org-admin proceeds.
     9	 *  - follow-up (artifactId): requires canEditApps AND writability. A `user` is refused on the
    10	 *    capability (before any ownership probe — no existence leak). An org-admin who is not the owner
    11	 *    of a PRIVATE target gets a uniform 404 (the IDOR is closed, and the LOW oracle fix collapses
    12	 *    the 'forbidden' verdict to notfound so private-app existence never leaks to a canEditApps
    13	 *    holder). A cross-org target is 404 too. An org-shared same-org target — and the actor's OWN
    14	 *    app — proceed.
    15	 */
    16	import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
    17	import express from 'express';
    18	import type { Server } from 'node:http';
    19	import { ErrorEnvelope } from '@ekoa/shared';
    20	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
    21	import { connectMongo, closeMongo } from '../../src/data/mongo.js';
    22	import { users, artifacts } from '../../src/data/stores.js';
    23	import { setActivation } from '../../src/data/activation.js';
    24	import { login } from '../../src/auth/service.js';
    25	import { hashPassword } from '../../src/auth/password.js';
    26	import { __resetConfigForTests, loadConfig } from '../../src/config.js';
    27	
    28	// Mock the build executor entry. The route's capability/ownership gate runs BEFORE this is called,
    29	// so its call-count is the ground truth for "was the request authorized".
    30	const { handleBuildCreateMock } = vi.hoisted(() => ({ handleBuildCreateMock: vi.fn() }));
    31	vi.mock('../../src/agents/index.js', async (importActual) => {
    32	  const actual = await importActual<typeof import('../../src/agents/index.js')>();
    33	  return { ...actual, handleBuildCreate: handleBuildCreateMock };
    34	});
    35	
    36	// Imported after the mock is declared (vi.mock is hoisted above imports by vitest).
    37	import { jobsRouter } from '../../src/routes/jobs.js';
    38	
    39	let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
    40	const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
    41	const api = (p: string, t: string, init: RequestInit = {}) =>
    42	  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
    43	
    44	async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user', orgId: string) {
    45	  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
    46	  setActivation(id, { active: true, billingLocked: false });
    47	}
    48	const tokenFor = async (id: string) => (await login(id, 'pw123456', false, deps)).token;
    49	const build = (extra: Record<string, unknown> = {}) => JSON.stringify({ kind: 'build', description: 'change it', sessionId: 's1', language: 'pt', ...extra });
    50	
    51	beforeAll(async () => {
    52	  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
    53	  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_jobs_capability');
    54	  await mkUser('userA', 'user', 'orgA');       // plain member, owns the artifacts below
    55	  await mkUser('adminA', 'org-admin', 'orgA');  // same-org admin (has canEditApps)
    56	  await mkUser('adminB', 'org-admin', 'orgB');  // other-org admin
    57	  // userA's apps in orgA: one private, one org-shared. adminA owns a private app of its own.
    58	  await artifacts.insert({ _id: 'artA-priv', userId: 'userA', orgId: 'orgA', visibility: 'private', name: 'A priv' } as never);
    59	  await artifacts.insert({ _id: 'artA-shared', userId: 'userA', orgId: 'orgA', visibility: 'org', name: 'A shared' } as never);
    60	  await artifacts.insert({ _id: 'artAdminA-priv', userId: 'adminA', orgId: 'orgA', visibility: 'private', name: 'adminA priv' } as never);
    61	  const app = express(); app.use(express.json()); app.use('/api/v1/jobs', jobsRouter(deps));
    62	  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    63	  port = (server.address() as { port: number }).port;
    64	}, 60_000);
    65	afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
    66	
    67	beforeEach(() => {
    68	  handleBuildCreateMock.mockReset();
    69	  handleBuildCreateMock.mockResolvedValue({ status: 'created', job: { id: 'jX', status: 'running', createdAt: 'x' }, fire: () => {} });
    70	});
    71	
    72	describe('POST /jobs — first-build capability gate (canBuildApps)', () => {
    73	  it('a user (no canBuildApps) is refused 403 FORBIDDEN + details.capability, executor never called', async () => {
    74	    const res = await api('/api/v1/jobs', await tokenFor('userA'), { method: 'POST', body: build() });
    75	    expect(res.status).toBe(403);
    76	    const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
    77	    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    78	    expect(body.error.code).toBe('FORBIDDEN');
    79	    expect(body.error.details?.capability).toBe('canBuildApps');
    80	    expect(handleBuildCreateMock).not.toHaveBeenCalled();
    81	  });
    82	
    83	  it('an org-admin proceeds → 202, executor called with no artifactId', async () => {
    84	    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build() });
    85	    expect(res.status).toBe(202);
    86	    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
    87	    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBeUndefined();
    88	  });
    89	});
    90	
    91	describe('POST /jobs — follow-up build gate (canEditApps + writability, IDOR fix)', () => {
    92	  it('a user (no canEditApps) is refused on the capability BEFORE any ownership probe → 403 canEditApps', async () => {
    93	    const res = await api('/api/v1/jobs', await tokenFor('userA'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
    94	    expect(res.status).toBe(403);
    95	    const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
    96	    expect(body.error.code).toBe('FORBIDDEN');
    97	    expect(body.error.details?.capability).toBe('canEditApps');
    98	    expect(handleBuildCreateMock).not.toHaveBeenCalled();
    99	  });
   100	
   101	  it("an org-admin targeting ANOTHER user's PRIVATE app in-org is a uniform 404 (IDOR closed + LOW oracle fix: forbidden collapses to notfound so existence never leaks), executor never called", async () => {
   102	    // The actor HAS canEditApps (org-admin), so the capability gate passes; the writability check
   103	    // returns 'forbidden' (another user's private artifact). The follow-up gate collapses that to
   104	    // the SAME 404 as missing/cross-org, so a canEditApps holder cannot probe private-app existence.
   105	    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artA-priv' }) });
   106	    expect(res.status).toBe(404);
   107	    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
   108	    expect(handleBuildCreateMock).not.toHaveBeenCalled();
   109	  });
   110	
   111	  it('a cross-org target is a uniform 404, executor never called', async () => {
   112	    const res = await api('/api/v1/jobs', await tokenFor('adminB'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
   113	    expect(res.status).toBe(404);
   114	    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
   115	    expect(handleBuildCreateMock).not.toHaveBeenCalled();
   116	  });
   117	
   118	  it('an org-admin editing an ORG-SHARED same-org app proceeds → 202, executor called with the artifactId', async () => {
   119	    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
   120	    expect(res.status).toBe(202);
   121	    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
   122	    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBe('artA-shared');
   123	  });
   124	
   125	  it('an org-admin editing its OWN private app proceeds → 202 (own always)', async () => {
   126	    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artAdminA-priv' }) });
   127	    expect(res.status).toBe(202);
   128	    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
   129	    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBe('artAdminA-priv');
   130	  });
   131	});

exec
/bin/zsh -lc "git show 3ad6fb3:api/tests/contract/artifacts-capability.test.ts | nl -ba | sed -n '1,340p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-g5sGoVdH' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-45bIcFRW' (errno=Operation not permitted)
     1	/**
     2	 * H1 HIGH-2 — the OTHER app build/edit vectors are capability-gated (app-type-aware), exercised
     3	 * through the REAL artifacts router over mongo-mem. The heavy service calls (import/fork/
     4	 * bundle-update) are mocked so no real build runs: the gate lives in the route AFTER the ownership
     5	 * check but BEFORE the service, so a refusal means the service was never reached, and a proceed
     6	 * means it was.
     7	 *
     8	 * The gap this closes: a plain `user` OWNS the artifacts they create, so `writable()` passes and —
     9	 * pre-fix — they could change app CODE without ever touching POST /jobs (bundle-update, PUT file,
    10	 * version restore, backend toggle/sample-run, app-data snapshot/restore) or mint apps (import,
    11	 * fork-of-app). The gate is app-type-aware: NON-app artifacts a user may still manage.
    12	 *
    13	 * Matrix:
    14	 *  - a `user` who OWNS an APP is refused 403 canEditApps on every in-place app-edit vector, and
    15	 *    403 canBuildApps on import / fork-of-app (the service is never called).
    16	 *  - an org-admin proceeds (service mocked → 2xx).
    17	 *  - a `user` forking a NON-app artifact they own is NOT refused (canCreateArtifacts preserved).
    18	 */
    19	import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
    20	import express from 'express';
    21	import type { Server } from 'node:http';
    22	import { ErrorEnvelope } from '@ekoa/shared';
    23	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
    24	import { connectMongo, closeMongo } from '../../src/data/mongo.js';
    25	import { users, artifacts } from '../../src/data/stores.js';
    26	import { setActivation } from '../../src/data/activation.js';
    27	import { login } from '../../src/auth/service.js';
    28	import { hashPassword } from '../../src/auth/password.js';
    29	import { __resetConfigForTests, loadConfig } from '../../src/config.js';
    30	
    31	// Mock ONLY the two heavy services a 2xx path actually reaches (the gate short-circuits the 403
    32	// paths before any service). Factory-only mocks so the real modules' esbuild/git machinery never
    33	// loads. `artifactView` is applied to the import/update results, so they carry the view fields.
    34	const { importMock, updateMock, forkMock } = vi.hoisted(() => ({
    35	  importMock: vi.fn(),
    36	  updateMock: vi.fn(),
    37	  forkMock: vi.fn(),
    38	}));
    39	vi.mock('../../src/apps/artifact-bundle.js', () => ({
    40	  exportArtifact: vi.fn(async () => ({ manifestId: 'x', files: [] })),
    41	  importArtifact: importMock,
    42	  updateArtifactFromBundle: updateMock,
    43	  ManifestIdMismatchError: class extends Error {},
    44	}));
    45	vi.mock('../../src/apps/artifact-fork.js', () => ({ forkArtifact: forkMock }));
    46	
    47	// Imported after the mocks are declared (vi.mock is hoisted above imports by vitest).
    48	import { artifactsRouter } from '../../src/routes/artifacts.js';
    49	
    50	let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
    51	const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
    52	const api = (p: string, t: string, init: RequestInit = {}) =>
    53	  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
    54	
    55	async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user', orgId: string) {
    56	  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
    57	  setActivation(id, { active: true, billingLocked: false });
    58	}
    59	const tokenFor = async (id: string) => (await login(id, 'pw123456', false, deps)).token;
    60	
    61	beforeAll(async () => {
    62	  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
    63	  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_artifacts_capability');
    64	  await mkUser('userA', 'user', 'orgA');      // plain member — owns the artifacts below
    65	  await mkUser('adminA', 'org-admin', 'orgA'); // same-org admin — has canBuildApps + canEditApps
    66	  // An APP (built code sandbox: data.projectDir present) owned by userA, and one owned by adminA.
    67	  // A NON-app artifact (bare record, no projectDir) owned by userA. isAppArtifact reads the data
    68	  // bag only — no on-disk dir is needed because every service touching disk is mocked.
    69	  await artifacts.insert({ _id: 'app-userA', userId: 'userA', orgId: 'orgA', visibility: 'private', name: 'App U', status: 'active', data: { projectDir: '/sbx/user-userA/app-userA' } } as never);
    70	  await artifacts.insert({ _id: 'app-adminA', userId: 'adminA', orgId: 'orgA', visibility: 'private', name: 'App A', status: 'active', data: { projectDir: '/sbx/user-adminA/app-adminA' } } as never);
    71	  await artifacts.insert({ _id: 'plain-userA', userId: 'userA', orgId: 'orgA', visibility: 'private', name: 'Plain U', status: 'draft', data: {} } as never);
    72	  const app = express(); app.use(express.json()); app.use('/api/v1/artifacts', artifactsRouter(deps));
    73	  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    74	  port = (server.address() as { port: number }).port;
    75	}, 60_000);
    76	afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
    77	
    78	beforeEach(() => {
    79	  importMock.mockReset().mockResolvedValue({ _id: 'imported1', name: 'Imported', slug: 'imported1', userId: 'adminA', orgId: 'orgA', visibility: 'private', status: 'active' });
    80	  updateMock.mockReset().mockImplementation(async (art: { _id: string; name: string }) => ({ artifact: { _id: art._id, name: art.name, slug: 'app', userId: 'adminA', orgId: 'orgA', visibility: 'private', status: 'active' }, safetyNetSnapshotId: 'snap1', preUpdateVersionId: 'v1' }));
    81	  forkMock.mockReset().mockResolvedValue({ artifact: { _id: 'fork1', slug: 'fork-1' } });
    82	});
    83	
    84	/** Assert a response is a 403 FORBIDDEN envelope carrying the expected capability. */
    85	async function expect403(res: Response, capability: string): Promise<void> {
    86	  expect(res.status).toBe(403);
    87	  const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
    88	  expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    89	  expect(body.error.code).toBe('FORBIDDEN');
    90	  expect(body.error.details?.capability).toBe(capability);
    91	}
    92	
    93	describe('HIGH-2 — in-place app-edit vectors require canEditApps (a user owning the app is refused)', () => {
    94	  const bundleBody = JSON.stringify({ bundle: { manifestId: 'app-userA', files: [{ path: 'index.html', content: '<html>x</html>' }] } });
    95	  const editVectors: Array<{ name: string; path: string; method: string; body?: string }> = [
    96	    { name: 'bundle-update', path: '/app-userA/bundle-update', method: 'POST', body: bundleBody },
    97	    { name: 'PUT file', path: '/app-userA/file', method: 'PUT', body: JSON.stringify({ path: 'notes.txt', content: 'x' }) },
    98	    { name: 'version restore', path: '/app-userA/versions/deadbeef/restore', method: 'POST' },
    99	    { name: 'backend enabled', path: '/app-userA/backend/enabled', method: 'PUT', body: JSON.stringify({ enabled: false }) },
   100	    { name: 'backend sample-run', path: '/app-userA/backend/sample-run', method: 'POST', body: JSON.stringify({ entrypoint: 'onEvent', input: {} }) },
   101	    { name: 'backups snapshot', path: '/app-userA/backups', method: 'POST' },
   102	    { name: 'backups restore', path: '/app-userA/backups/restore', method: 'POST', body: JSON.stringify({ pointId: 'p1', source: 'local', at: 'now' }) },
   103	  ];
   104	
   105	  for (const v of editVectors) {
   106	    it(`${v.name}: a user who OWNS the app is refused 403 canEditApps`, async () => {
   107	      const res = await api(`/api/v1/artifacts${v.path}`, await tokenFor('userA'), { method: v.method, ...(v.body ? { body: v.body } : {}) });
   108	      await expect403(res, 'canEditApps');
   109	    });
   110	  }
   111	
   112	  it('bundle-update: an org-admin proceeds → 200 (service reached)', async () => {
   113	    const res = await api('/api/v1/artifacts/app-adminA/bundle-update', await tokenFor('adminA'), {
   114	      method: 'POST', body: JSON.stringify({ bundle: { manifestId: 'app-adminA' } }),
   115	    });
   116	    expect(res.status).toBe(200);
   117	    expect(updateMock).toHaveBeenCalledTimes(1);
   118	  });
   119	});
   120	
   121	describe('HIGH-2 — create-and-build vectors require canBuildApps', () => {
   122	  it('import: a user is refused 403 canBuildApps, importArtifact never called', async () => {
   123	    const res = await api('/api/v1/artifacts/import', await tokenFor('userA'), { method: 'POST', body: JSON.stringify({ bundle: { manifestId: 'anything' } }) });
   124	    await expect403(res, 'canBuildApps');
   125	    expect(importMock).not.toHaveBeenCalled();
   126	  });
   127	
   128	  it('import: an org-admin proceeds → 201 (importArtifact reached)', async () => {
   129	    const res = await api('/api/v1/artifacts/import', await tokenFor('adminA'), { method: 'POST', body: JSON.stringify({ bundle: { manifestId: 'anything' } }) });
   130	    expect(res.status).toBe(201);
   131	    expect(importMock).toHaveBeenCalledTimes(1);
   132	  });
   133	
   134	  it('fork of an APP: a user is refused 403 canBuildApps, forkArtifact never called', async () => {
   135	    const res = await api('/api/v1/artifacts/app-userA/fork', await tokenFor('userA'), { method: 'POST', body: JSON.stringify({ name: 'copy' }) });
   136	    await expect403(res, 'canBuildApps');
   137	    expect(forkMock).not.toHaveBeenCalled();
   138	  });
   139	});
   140	
   141	describe('HIGH-2 — non-app artifact management stays with the user (canCreateArtifacts preserved)', () => {
   142	  it('fork of a NON-app artifact the user owns is NOT refused → 201 (forkArtifact reached)', async () => {
   143	    const res = await api('/api/v1/artifacts/plain-userA/fork', await tokenFor('userA'), { method: 'POST', body: JSON.stringify({ name: 'copy' }) });
   144	    expect(res.status).toBe(201);
   145	    expect(forkMock).toHaveBeenCalledTimes(1);
   146	  });
   147	});

codex
The remaining review is about coverage edges: whether the grep gate’s scope/allowlist misses live locations, and whether the “wiring” test would still pass after a meaningful gate regression. I’m enumerating real `'builder'` and stub-marker hits across the tree instead of relying on the test’s own narrative.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n --hidden --glob '"'!node_modules'"' \"['\\\"]builder['\\\"]|PERMISSIVE[-_]STUB\" api/src shared/src web" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/auth/users-service.ts:91: * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
api/src/auth/users-service.ts:95:  const legacy = await users.find({ role: 'builder' });
api/src/auth/jwt.ts:61:  // role 'builder', which is no longer a valid Role. Normalise it HERE — the single verify
api/src/auth/jwt.ts:67:  if ((decoded.role as string) === 'builder') decoded.role = 'user';
web/stores/orchestration.ts:53:  /** Session kind persisted server-side (default 'builder'). 'onboarding'

exec
/bin/zsh -lc 'cd api && npx vitest run tests/security/grep-gates.test.ts tests/auth/capabilities.test.ts tests/security/assistant-cross-org-isolation.test.ts tests/security/destructive-action-authz.test.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "find /Users/ggomes/dev -name PRD.md -o -name PLANING.md -o -name TASKS.md | sed -n '1,120p'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 616ms:
failed to load config from /Users/ggomes/dev/ekoa-code/api/vitest.config.ts

⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
Error: EPERM: operation not permitted, open '/Users/ggomes/dev/ekoa-code/api/node_modules/.vite-temp/vitest.config.ts.timestamp-1783987135643-a81c3365f982f.mjs'
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
  path: '/Users/ggomes/dev/ekoa-code/api/node_modules/.vite-temp/vitest.config.ts.timestamp-1783987135643-a81c3365f982f.mjs'
}




codex
The test code itself looks runnable in principle, but this environment is read-only so `vitest` cannot create its temp config bundle under `api/node_modules/.vite-temp`; I can still validate by source inspection and direct tree queries, but not by executing the suites here.
 exited 130 in 11657ms:
codex
- High: [api/tests/security/destructive-action-authz.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/destructive-action-authz.test.ts:15) proves only the app-SSO side channel (`/api/app-sso/set-password` and `/m365/*`), then explicitly scopes away the real served-app mutation plane. But [api/src/apps/served-data.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/served-data.ts:174) still allows unauthenticated `POST`, `PUT`, and `DELETE` on `/api/app-data/*` keyed only by attacker-supplied `X-Ekoa-App-Id`; [docs/security.md](/Users/ggomes/dev/ekoa-code/docs/security.md:166) calls that “documented”, but app-id scoping alone does not prevent cross-tenant writes to any known app slug/id. This is a real gap and a missed Phase-10 destructive-authz assertion, not a safe dismissal.

- Medium: [api/tests/auth/capabilities.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/auth/capabilities.test.ts:103) is only a file-level string check for `can(` plus a capability literal, so it can stay green after a route silently loses its live gate. The clearest false-positive path is [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:96): the inventory row is satisfied by the helper `isAppEditor()` containing `canEditApps`, even if `GET /app-assistant/whoami` at [app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:255) stopped calling `detectAppEditor()` and returned a constant. That means the “wiring inventory” does not really prove the route is still wired.

- Low: [api/tests/security/grep-gates.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/grep-gates.test.ts:117) does not scan all of `web`; it only scans `web/app`, `web/components`, and `web/stores`. A resurrected quoted `'builder'` role literal under other live web code such as `web/lib` or `web/hooks` would evade the gate, so it does not meet the claimed `api/src + shared/src + web` coverage.

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
126,531
- High: [api/tests/security/destructive-action-authz.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/destructive-action-authz.test.ts:15) proves only the app-SSO side channel (`/api/app-sso/set-password` and `/m365/*`), then explicitly scopes away the real served-app mutation plane. But [api/src/apps/served-data.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/served-data.ts:174) still allows unauthenticated `POST`, `PUT`, and `DELETE` on `/api/app-data/*` keyed only by attacker-supplied `X-Ekoa-App-Id`; [docs/security.md](/Users/ggomes/dev/ekoa-code/docs/security.md:166) calls that “documented”, but app-id scoping alone does not prevent cross-tenant writes to any known app slug/id. This is a real gap and a missed Phase-10 destructive-authz assertion, not a safe dismissal.

- Medium: [api/tests/auth/capabilities.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/auth/capabilities.test.ts:103) is only a file-level string check for `can(` plus a capability literal, so it can stay green after a route silently loses its live gate. The clearest false-positive path is [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:96): the inventory row is satisfied by the helper `isAppEditor()` containing `canEditApps`, even if `GET /app-assistant/whoami` at [app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:255) stopped calling `detectAppEditor()` and returned a constant. That means the “wiring inventory” does not really prove the route is still wired.

- Low: [api/tests/security/grep-gates.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/security/grep-gates.test.ts:117) does not scan all of `web`; it only scans `web/app`, `web/components`, and `web/stores`. A resurrected quoted `'builder'` role literal under other live web code such as `web/lib` or `web/hooks` would evade the gate, so it does not meet the claimed `api/src + shared/src + web` coverage.

VERDICT: NEEDS-WORK
