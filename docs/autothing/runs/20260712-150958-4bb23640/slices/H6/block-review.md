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
storage scoped only by `X-Ekoa-App-Id` (carried verbatim for byte-compatibility). Anything private
is meant to live on a server-authenticated plane: the shared namespace (`/api/app-shared`, resolved
owner + same-origin guard + `sharedData` opt-in) or behind the platform JWT / app-SSO session.
**This open posture is a KNOWN HIGH GAP, not a safe boundary** - any caller who knows an app id can
write/delete that app's `/api/app-data`, and the collection write-mode that was supposed to restrict
this is unenforced. It is pre-existing and requires an operator decision - see the KNOWN GAP under
the assertion layer below and `docs/findings.md` `served-app-data-unauthenticated-writes`.

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
  the PRIVILEGED served-app end-user ops that carry an identity ARE authorized SERVER-SIDE by the
  per-app SSO identity, not by any client confirmation (the Phase 4 confirm dialog is UX). The
  canonical case - `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data) - is
  rejected 401 WITHOUT a valid app-sso session and with a WRONG-APP session (`session.appId`
  isolation via `findValidAppSession`), and proceeds only for the correct same-app session; the
  visitor-acting `/api/app-sso/m365/*` proxy is gated the same way.

  **KNOWN GAP (HIGH, pre-existing, requires an operator decision) - unauthenticated served-app data
  mutations.** The GENERAL `/api/app-data/:collection` plane that a C3 submit/delete/write lands on
  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
  `X-Ekoa-App-Id` + the resolved app OWNER's activation (`admitOwner`), then scopes to that app's
  data partition. So ANY caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data
  across tenants - the "authorization dimension" Phase 10 requires for a destructive action is NOT
  met for the primary served-app mutation surface. Two compounding facts: (1) the collection-rule
  `access: { write: 'session' | 'server' }` level is DECLARED in the manifest schema but NOT enforced
  by `served-data.ts` (the write mode is decorative); (2) the app-sso session cookie is
  `Path=/api/app-sso`, so it is not even transmitted to `/api/app-data`, i.e. there is no session to
  check at that path today. This is PRE-EXISTING (the C3/D-era served-app data plane; the operator-run
  did not introduce it) and sits on a DIFFERENT axis from the platform role/capability layer H1-H4
  close (which IS complete and correct). The proper fix - enforce the declared write mode and make an
  app-sso session verifiable at the data path (cookie-path widening or a session token) - is an
  architecture change to the served-app data plane spanning the ~200-app estate, and is an operator
  decision, not a bolt-on to this assertion slice. H5 ASSERTS the current state honestly
  (`destructive-action-authz.test.ts` pins the unauthenticated write as a KNOWN-GAP TRIPWIRE so a
  future fix flips the test) and flags it as the top landing item; it does NOT claim the plane is safe
  and does NOT silently redesign it. Tracked: `docs/findings.md`
  `served-app-data-unauthenticated-writes`.

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
\n--- docs/findings.md ---
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

- **`served-app-data-unauthenticated-writes`** (HIGH, pre-existing, operator decision - surfaced by
  H5's destructive-action-authz assertion). The served-app data plane `/api/app-data/:collection`
  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
  `X-Ekoa-App-Id` header + the app OWNER's activation, then scopes to that app's partition. So ANY
  caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data ACROSS TENANTS (a private
  org app's data can be tampered/deleted by an outsider who learns its id). Two compounding facts:
  (1) the manifest collection-rule `access:{ write:'session'|'server' }` is DECLARED but NOT enforced
  by served-data.ts (the write mode is decorative); (2) the app-sso session cookie is
  `Path=/api/app-sso`, so it is not even sent to `/api/app-data` - there is no session to check at
  that path today. NOT introduced by the operator-run (C3/D-era served-app data plane); on a
  DIFFERENT axis from the platform role/capability layer H1-H4 close (which is complete). Phase 10's
  "destructive-action authorization asserted server-side" is NOT met for this surface. FIX (an
  operator architecture decision, a dedicated post-H slice): enforce the declared collection write
  mode and make an app-sso session verifiable at the data path (widen the app-sso cookie path or mint
  a session token the data plane checks); `write:'server'` collections should reject ALL client
  mutations. Pinned as a TRIPWIRE in `api/tests/security/destructive-action-authz.test.ts` (a fix
  flips the test) + behaviorally green today in `api/tests/contract/served-app.test.ts`. Tracked in
  `docs/security.md`.

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
  `The 'Access-Control-Allow-Origin' header contains multiple values '*, http://localhost:3000'`
  (`net::ERR_FAILED` despite a 200), so `probePreviewDocument` classified every served app as
  `transient` and the panel's probe-gated first render churned through its retry budget. Root
  cause: both dev CORS proxies (`.claude/skills/run-ekoa-code/driver.mjs` and its verbatim copy in
  `api/tests/journeys/boot-b.mjs`) merged response headers with
  `{ ...proxyRes.headers, ...corsHeaders(req) }` - Node lowercases upstream header names while
  `corsHeaders()` uses mixed case, so on planes where the api sets its OWN CORS header
  (`/apps/*` and design tokens send `Access-Control-Allow-Origin: *` - `serving.ts`,
  `design-tokens.ts`) the spread kept BOTH keys and the wire carried two ACAO values, which
  browsers reject outright. Dev-only (prod is same-origin, no proxy). Fixed in both files:
  upstream-wins per-header merge (`mergeResponseHeaders`) - the proxy only injects the CORS
  headers upstream did not already set, so `/apps/*` answers a single `ACAO: *` exactly as
  `web/lib/preview-probe.ts` documents, and `/api/*` keeps the reflected-origin set. Verified
  live through a restarted boot-b stack: `/apps/legal-agenda-reservas/` ACAO count 1 (`*`),
  `/health` reflected origin single-valued, OPTIONS preflight unchanged.

## Recently fixed - 2026-07-12 preview "proxy error" (operator)

- **`F-2026-07-12-preview-502`** (operator-reported, 2026-07-12) - during a build, the side-panel
  preview iframe displayed a raw `proxy error` body and stayed there (screenshot: 502 on the
  `/apps/<id>/?token=` document request while adjacent `/api/v1/billing/usage` calls returned 200).
  Two stacked defects:
  1. **Dev-harness proxy transient** (root cause of THIS 502): the run-ekoa-code driver's CORS
     reverse proxy (`.claude/skills/run-ekoa-code/driver.mjs`) forwarded upstream requests over the
     Node 20 global agent (keep-alive pooled, server closes idles at its default 5s
     `keepAliveTimeout`) and answered ANY pre-response upstream socket error with a bare 502
     `proxy error` - silently (no log), so the exact errno of the operator's occurrence (2 of 265
     requests) is unrecoverable. Fixed: fresh upstream connection per request
     (`http.Agent({ keepAlive: false })` - loopback, sub-ms), one replay for bodyless idempotent
     methods (GET/HEAD) failing before a response, upstream errors logged with method/path/errno,
     and a mid-stream failure destroys the response instead of appending garbage. Forensics note:
     the classic close-vs-reuse race would NOT reproduce in 365 timed attempts against Node 20
     (agent honors the server's Keep-Alive hint), so the residual trigger class is broader than
     that race - the fix covers the class, and the new logging captures any recurrence.
  2. **Preview panel could not recover** (product gap, any 5xx source incl. a prod edge blip): an
     iframe NEVER fires its error event for an HTTP error response - it renders the error body and
     fires `load` - so `side-panel.tsx`'s retry machinery never engaged and the raw body stuck
     until a manual refresh. Fixed: `web/lib/preview-probe.ts` classifies the document plane via a
     HEAD probe (`ok` 2xx / `transient` network+5xx / `hard` other); the panel now gates the first
     iframe render on the probe (polls at the existing 500ms/30s bounds), re-probes on every iframe
     `load`, routes `transient` into the existing bounded retry, restores the retry budget on a
     verified-ok load, and renders `hard` pages (410 revoked) as-is. Manual refresh polling unified
     on the same classification (and now probes the tokened URL the iframe actually loads).
  Accepted residual: a blip that hits ONLY the iframe's GET while the adjacent HEAD probes pass is
  undetectable cross-origin without a new parent<->iframe liveness protocol on the byte-compat
  injection plane (the demo bridge stays dormant until `demo.init` by design) - disproportionate;
  revisit only if it recurs behind the fixed proxy/edge. Tests:
  `web/__tests__/lib/preview-probe.test.ts` (classification),
  `web/__tests__/components/side-panel-preview-recovery.test.tsx` (wiring: probe-gated first
  render, 410 renders as-is, on-load transient -> retry -> recovery); both fail against the
  pre-fix behavior. Live-verified 2026-07-12: stack restarted on the fixed driver, real-UI login,
  /artifacts + served `legal-nucleo` render through the proxy, 16/16 doc-plane requests across
  5s keep-alive boundaries clean.

## Recently fixed - 2026-07-12 brand research colors (operator round 3)

- **`brand-colors-fake-teal`** (operator-reported, 2026-07-12) - research on
  mariliasantoscabral.webnode.pt showed primary `#0d9488` (teal-600, the OLD platform default) on a
  navy/white site with no teal anywhere. Root-cause forensics (live DB + job records + a live
  extraction probe) proved the teal never existed in the pipeline, the model output, or the org
  record: it was the branding page's HARDCODED display fallbacks (`#0d9488`/`#1e293b`) rendered
  whenever `org.branding` lacked colors - indistinguishable from a research result, and
  `handleSaveBranding` would persist them verbatim on Guardar. Fixed: unset colors are `null` state
  end-to-end (explicit "Não definida" swatch/placeholder, neutral preview placeholders), Save OMITS
  unset colors, and the exact pair appears nowhere. Tests: `web/e2e/branding-colors.spec.ts`.
- **`brand-research-silent-no-color`** (same run) - the research flow structurally could not produce
  a color for this site yet reported success: the grounded snapshot contained ONLY grayscale hexes,
  the model complied, `sanitizeBrandColors` nulled them, the patch dropped the nulls, and the job
  completed `brandingApplied:true` with no signal (the old cortex NO_PRIMARY_COLOR fail-loud guard
  was never ported - color-filter.ts's own comment referenced a "no usable primary guard" that did
  not exist). Fixed as partial-apply-with-warning: the job result + complete event + `jobView` carry
  `colorsApplied` and `warnings: [NO_PRIMARY_COLOR]`; the web shows an amber "defina-as manualmente"
  banner/toast instead of green success. Tests: `api/tests/contract/branding.test.ts` (fail-loud
  monochrome case), shared `Job` schema extended.
- **`brand-colors-image-only-blind`** (same run, the actual extraction gap) - the firm's navy lives
  ONLY as pixels in the hero JPEG; the rendered walker samples computed styles, so `paintedHexes`
  came back empty, the Webnode builder scrub then intersected the CSS candidates against that empty
  set and wiped all 8, leaving the model four grayscale hexes. Fixed with a screenshot-PIXEL
  quantization fallback in `rendered-candidates.ts` (fires only when nothing non-neutral paints;
  in-page canvas quantization of the Playwright screenshot - a data: image, so no cross-origin
  taint), surfaced as an explicitly low-confidence "Cores amostradas dos píxeis" prompt section with
  a neutral-ban rule, deliberately exempt from the brandFit floor (the desaturated navy ~0.26 is the
  point). Live-verified against the real site: research now persists primary `#374559` (the actual
  hero navy) and no neutrals. Tests: `api/tests/services/branding/rendered-candidates.test.ts`
  (`screenshotClustersToCandidates`), `snapshot.test.ts` (pixel section + rules).
- **`brand-colors-no-membership-guard`** (found during the fix, latent in old cortex too) - the
  "every returned hex must appear literally in a candidate list" rule was prompt-only; a
  hallucinated saturated color would have merged unchecked. Fixed: `collectAllowedHexes` gathers the
  snapshot evidence and the apply-step NULLS any returned color outside it (grounded path only).
  Tests: `api/tests/contract/branding.test.ts` (out-of-snapshot teal dropped),
  `snapshot.test.ts` (`collectAllowedHexes`).
- **`sanitize-accent-gap`** (same run) - `sanitizeBrandColors` never checked `accentColor`, so gray
  `#9d9d9d` persisted as the org accent; and the promotion swap PARKED the demoted gray in the
  accent slot. Fixed: a grayscale accent is nulled last (no slot ever persists a neutral). Tests:
  `api/tests/services/branding/color-filter.test.ts`.
- **`branding-save-wholesale-wipe`** (found during the fix) - `saveBrandingHandler` passed the
  client's 4-field branding object straight to `updateOrg`, which replaces top-level keys wholesale:
  every dashboard Guardar silently WIPED `designSystem`/`visualVibe`/researched fields. Fixed: the
  handler merges onto existing branding (same semantics as the research apply-step). Test:
  `api/tests/contract/branding.test.ts` (save-merge case).
- **`accent-picker-secondary-binding`** (same run) - the "Cor de Destaque" picker was bound to
  `secondaryColor`, so the persisted `accentColor` was never displayed and Save wrote the fallback
  slate into `secondaryColor` under an accent label. Fixed: the accent picker binds `accentColor`.
  Test: `web/e2e/branding-colors.spec.ts` (accent stays unset when only primary is saved).
- **`branding-page-stale-until-reload`** (operator-reported, 2026-07-12 follow-up: "had to refresh
  to see the changes on the brand area") - the branding page re-syncs its local editor state only
  when the `${company.id}_${company.updatedAt}` fingerprint changes, but `orgView` never returned
  `updatedAt` and nothing stamped it, so the fingerprint NEVER changed after mount: the

exec
/bin/zsh -lc "find slices -maxdepth 2 -name 'impl-notes.md' -print | sort | while read f; do printf '%s\\n' \"--- "'$f ---"; sed -n '"'1,240p' \""'$f"; printf '"'\\n'; done" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
find: slices: No such file or directory

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "codegraph explore 'verifyToken capabilities canBuildApps canEditApps canUseChat canCreateArtifacts jobs follow-up loadWritable whoami detectAppEditor change requests convert app assistant grounding org isolation tokenEpoch billingLocked'" in /Users/ggomes/dev/ekoa-code
 succeeded in 768ms:
## Exploration: verifyToken capabilities canBuildApps canEditApps canUseChat canCreateArtifacts jobs follow-up loadWritable whoami detectAppEditor change requests convert app assistant grounding org isolation tokenEpoch billingLocked

Found 87 symbols across 39 files.

### Blast radius — what depends on these (update/verify before editing)

- `detectAppEditor` (api/src/apps/app-assistant-route.ts:110) — 1 caller in `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `Capability` (shared/src/capabilities.ts:11) — 2 callers; tests: `api/tests/auth/capabilities.test.ts`

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
- ... and 44 more

**calls:**
- detectAppEditor → verifySseToken
- detectAppEditor → loadWritable
- detectAppEditor → isAppEditor
- appAssistantRouter → detectAppEditor
- automationsRouter → Router
- chatRouter → Router
- jobsRouter → Router
- appAssistantRouter → Router
- automationsRouter → verifySseToken
- chatRouter → verifySseToken
- ... and 59 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/app-assistant-route.ts — sendError(calls), resolveAssistantApp(calls), isAppEditor(function), JwtClaims(references), can(calls), detectAppEditor(function), verifySseToken(calls), loadWritable(calls), isAppEditor(calls), AssistantAdmission(interface), +16 more

```typescript
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
111	    }
112	    await get().fetchRequests();
113	  },
114	
115	  dismiss: async (id) => {
116	    if (get().actingId) return;
117	    set({ actingId: id, error: null });
118	    const response = await tryCall(() => api.changeRequests.dismiss({ id }));
119	    set({ actingId: null });
120	    if (!response.ok) {
121	      set({ error: response.error.message || 'Não foi possível dispensar o pedido.' });
122	      return;
123	    }
124	    await get().fetchRequests();
125	  },
126	
127	  fileFromRefusal: async ({ text, appId, route }) => {
128	    const response = await tryCall(() =>
129	      api.changeRequests.file({ text, ...(appId ? { appId } : {}), ...(route ? { route } : {}) }),
130	    );
131	    return response.ok;
132	  },
133	
134	  clearError: () => set({ error: null }),
135	}));
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

#### api/src/auth/jwt.ts — JwtClaims(interface), signToken(function), verifyToken(function)

```typescript
1	/**
2	 * JWT sign/verify (ch03 §3.2, CONV-1). Single mint point. Claim set is
3	 * `{ sub, role, scope, orgId, username }` (Amendment 2 — orgId replaces companyId).
4	 */
5	import { randomUUID } from 'node:crypto';
6	import jwt from 'jsonwebtoken';
7	import { loadConfig } from '../config.js';
8	import type { Role } from '@ekoa/shared';
9	
10	export interface JwtClaims {
11	  sub: string;
12	  role: Role;
13	  scope: string;
14	  orgId: string;
15	  username: string;
16	  /** ALWAYS present on a minted token — the revocation key (P-03). A token lacking a jti
17	   *  cannot be revoked and is treated as invalid by the middleware. */
18	  jti: string;
19	  exp?: number;
20	  iat?: number;
21	}
22	
23	/** Mint a token. A `jti` is ALWAYS set (generated if the caller omits it) so every token
24	 *  is revocable (P-03) — a token without a jti is a revocation bypass and is forbidden.
25	 *
26	 *  `iat` may be pinned by the caller (jsonwebtoken honours an explicit `iat` and derives `exp`
27	 *  from it). A fresh session minted right after a token-epoch bump MUST carry `iat >= epoch`,
28	 *  or the middleware's `iat < tokenEpoch` check rejects it: JWT `iat` has one-second
29	 *  granularity, so a re-login in the same second as a password change would otherwise 401
30	 *  (ch09 §9.6). Only the mint-after-credential-check sites pin it. */
31	export function signToken(
32	  claims: Omit<JwtClaims, 'exp' | 'jti'> & { jti?: string; iat?: number },
33	  rememberMe = false,
34	): { token: string; expiresIn: number; jti: string } {
35	  const expiresIn = rememberMe ? 30 * 24 * 3600 : 24 * 3600; // 30d / 24h (ch03 §3.2)
36	  const jti = claims.jti ?? randomUUID();
37	  const token = jwt.sign({ ...claims, jti }, loadConfig().jwtSecret, { expiresIn });
38	  return { token, expiresIn, jti };
39	}
40	
41	/** Verify a token. jsonwebtoken rejects alg:none and tampered signatures by default;
42	 *  we additionally require HS256 explicitly so an attacker cannot downgrade the alg.
43	 *
44	 *  Token-class separation (ch18 §18.3.6, ch09 §9.2): the platform verifier positively REJECTS
45	 *  bridge tokens. Platform JWTs and bridge tokens are two classes over ONE secret, never
46	 *  interchangeable — a bridge token carries `aud: ekoa-bridge` and a `pairingId`/`connectionId`
47	 *  claim, none of which a minted platform token ever has, so any token bearing them is a bridge
48	 *  token presented on the wrong plane and is refused. This is an anti-replay/anti-misconfiguration
49	 *  defence: a stolen bridge token cannot call the platform API. (The bridge verifier rejects
50	 *  platform tokens symmetrically — bridge/token.ts readBridgeToken.) */
51	export function verifyToken(token: string): JwtClaims {
52	  const decoded = jwt.verify(token, loadConfig().jwtSecret, { algorithms: ['HS256'] }) as JwtClaims & {
53	    aud?: unknown;
54	    pairingId?: unknown;
55	    connectionId?: unknown;
56	  };
57	  if (decoded.aud === 'ekoa-bridge' || decoded.pairingId !== undefined || decoded.connectionId !== undefined) {
58	    throw new Error('bridge token presented on the platform verifier (token-class separation, ch18 §18.3.6)');
59	  }
60	  // Legacy-window shim (H1 role rename `builder` → `user`). A JWT minted before the rename carries
61	  // role 'builder', which is no longer a valid Role. Normalise it HERE — the single verify
62	  // chokepoint every admission path (requireAuth, verifySseToken, and every ?token= consumer)
63	  // funnels through — so no downstream role/capability check ever sees the dead value. The boot
64	  // migration bumps each migrated user's token epoch, so such tokens are rejected at the admission
65	  // plane once the epoch lands and the user re-logs in; this shim only covers the window between
66	  // boot and that next login. Remove once the fleet has rotated its tokens.
67	  if ((decoded.role as string) === 'builder') decoded.role = 'user';
68	  return decoded as JwtClaims;
69	}
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The repo doesn’t have a top-level `slices/` directory, so I’m locating the H1-H5 notes by filename rather than path assumption. After that I’ll drill into the exact route and service implementations behind the block’s junction points.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files | rg 'impl-notes\\.md"'$|H[1-5]'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C5/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/B2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review-2.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/gate-status.json
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/decision-memo.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/review-verdict.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/live-probe.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/worker-status.txt
docs/autothing/runs/20260712-150958-4bb23640/slices/F2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/brief.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/request-changes-journey-output.txt
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/edit-journey-output.txt
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/brief.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/worker-status.txt
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/codex-review-3.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/review-verdict.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/codex-review-2.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H5/gate-status.json
docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/brief.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/worker-status.txt
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-fix-brief.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/review-verdict.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/live-probe.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review-2.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/gate-status.json
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/exploration-auth-surface.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/brief.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/worker-status.txt
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/review-verdict.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/codex-review-2.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/gate-status.json
docs/autothing/runs/20260712-150958-4bb23640/slices/D2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/brief.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/worker-status.txt
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-3.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/review-verdict.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/codex-review-2.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/gate-status.json
docs/autothing/runs/20260712-150958-4bb23640/slices/H4/brief-draft.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C3/impl-notes.md

exec
/bin/zsh -lc 'codegraph node api/src/routes/jobs.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/routes/change-requests.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/auth/service.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 236ms:
**api/src/routes/jobs.ts** — 99 lines, 1 symbol · used by 2 files: api/tests/contract/jobs-capability.test.ts, api/src/server.ts

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
99	

 succeeded in 233ms:
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

 succeeded in 196ms:
**api/src/auth/service.ts** — 229 lines, 14 symbols · used by 3 files: api/src/auth/users-service.ts, api/tests/auth/role-migration.test.ts, api/src/server.ts

1	/**
2	 * Auth domain services (ch03 §3.8.1/§3.8.2, ch09 §9.7.1). Login, refresh, admin seeding,
3	 * and the deactivation write-through (the single operation that sets active=false, updates
4	 * the activation map, and revokes the user's tokens — ch09 §9.7.1).
5	 */
6	import { users, orgs, type UserDoc } from '../data/stores.js';
7	import { setActivation, getActivation, bumpTokenEpoch } from '../data/activation.js';
8	import { hashPassword, verifyPassword } from './password.js';
9	import { signToken, type JwtClaims } from './jwt.js';
10	import { revoke } from './revocation.js';
11	import { logActivity } from '../data/activity.js';
12	
13	export interface Deps {
14	  now: () => number;
15	  genId: () => string;
16	}
17	
18	export interface AuthUserView {
19	  id: string;
20	  username: string;
21	  role: UserDoc['role'];
22	  orgId: string;
23	  active: boolean;
24	  passwordChangeRequired?: boolean;
25	}
26	
27	function view(u: UserDoc): AuthUserView {
28	  return {
29	    id: u._id,
30	    username: u.username,
31	    role: u.role,
32	    orgId: u.orgId,
33	    active: u.active,
34	    passwordChangeRequired: u.passwordChangeRequired,
35	  };
36	}
37	
38	export class AuthError extends Error {
39	  constructor(public code: string, public status: number, message: string) {
40	    super(message);
41	  }
42	}
43	
44	/**
45	 * The `iat` a freshly-minted session must carry (ch09 §9.6). Epoch bumps invalidate every token
46	 * with `iat < tokenEpoch`; because JWT `iat` has ONE-SECOND granularity, a login in the same
47	 * second as a bump (password change, admin reset, admin logout) would be born invalid. Pinning a
48	 * fresh mint to `max(now, epoch)` keeps every PRE-bump token dead while letting the user in
49	 * immediately. Only sites that mint after a credential/approval check may use it.
50	 */
51	export function mintIat(userId: string): number {
52	  const nowSec = Math.floor(Date.now() / 1000);
53	  return Math.max(nowSec, getActivation(userId)?.tokenEpoch ?? 0);
54	}
55	
56	/**
57	 * Bump the token epoch in BOTH planes as one operation (H1 durability): the in-memory activation
58	 * map (the fast admission path every request consults — bumped first, so the effect is immediate)
59	 * AND the user row (so the epoch survives a restart). Without the row write the epoch reloads as 0
60	 * at boot and EVERY revocation — role change, password change/reset, admin logout, deactivation,
61	 * the builder→user migration — silently un-revokes its outstanding tokens after the process
62	 * restarts. Callers that already touch the row in their own `users.update` fold `tokenEpoch` into
63	 * that write instead of calling this; this helper is for the standalone bumps (e.g. admin logout).
64	 */
65	export async function bumpTokenEpochDurable(userId: string, epochSec: number): Promise<void> {
66	  bumpTokenEpoch(userId, epochSec);
67	  await users.update(userId, (u) => ({ ...u, tokenEpoch: epochSec }));
68	}
69	
70	/** First-boot super-admin seeding: creates the founder's org + super-admin account if absent. */
71	export async function seedAdmin(username: string, password: string, deps: Deps): Promise<void> {
72	  const existing = await users.find({ role: 'super-admin' });
73	  if (existing.length > 0) return;
74	  const orgId = deps.genId();
75	  await orgs.insert({ _id: orgId, name: 'Founder', displayName: 'Founder', createdAt: new Date(deps.now()).toISOString() });
76	  const userId = deps.genId();
77	  await users.insert({
78	    _id: userId,
79	    username,
80	    passwordHash: await hashPassword(password),
81	    role: 'super-admin',
82	    orgId,
83	    active: true,
84	    passwordChangeRequired: true,
85	  });
86	  setActivation(userId, { active: true, billingLocked: false });
87	}
88	
89	export async function login(username: string, password: string, rememberMe: boolean, deps: Deps): Promise<{ token: string; user: AuthUserView; passwordChangeRequired: boolean; expiresIn: number }> {
90	  const matches = await users.find({ username });
91	  const u = matches[0];
92	  if (!u || !(await verifyPassword(password, u.passwordHash))) {
93	    throw new AuthError('UNAUTHENTICATED', 401, 'Credenciais inválidas.');
94	  }
95	  // Deactivated accounts cannot mint a token (ACCOUNT_DISABLED). Check the AUTHORITATIVE
96	  // store field (login holds the row — no cache-miss window) and sync the write-through
97	  // map so the middleware is consistent. A billing lock does NOT block login — the account
98	  // authenticates and is refused per-request at the admission plane (middleware) with
99	  // BILLING_LOCKED (ch09 §9.7.1); that lock is preserved in the map from its cached value.
100	  const cached = getActivation(u._id);
101	  // Sync the write-through map from the AUTHORITATIVE row (login holds it — no cache-miss window).
102	  // Prefer the durable column values (H1: persisted `billingLocked`/`tokenEpoch`) so a lock and a
103	  // revocation survive a restart even on a cold cache; fall back to the cached map value, then the
104	  // default. The epoch carried here also feeds mintIat below (a pre-bump token stays dead).
105	  setActivation(u._id, {
106	    active: u.active,
107	    billingLocked: u.billingLocked ?? cached?.billingLocked ?? false,
108	    tokenEpoch: u.tokenEpoch ?? cached?.tokenEpoch ?? 0,
109	  });
110	  if (!u.active) throw new AuthError('ACCOUNT_DISABLED', 403, 'A sua conta está bloqueada. Contacte o suporte.');
111	  const { token, expiresIn } = signToken(
112	    { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}`, iat: mintIat(u._id) },
113	    rememberMe,
114	  );
115	  // Registo (F3): a login is an org-visible activity — metadata-only, never the password. The
116	  // single audit write path (FIXED-8); best-effort so a bookkeeping write never fails a login.
117	  await logActivity({ userId: u._id, username: u.username, orgId: u.orgId }, 'auth', 'login', deps, { rememberMe }).catch(() => undefined);
118	  return { token, user: view(u), passwordChangeRequired: !!u.passwordChangeRequired, expiresIn };
119	}
120	
121	/**
122	 * Logout (F1, ch03 §3.8.1). Self: revoke the caller's jti (the middleware checks isRevoked on
123	 * every request, so the token dies immediately). Admin variant: super-admin anywhere, org-admin
124	 * scoped to its own org — the target's outstanding jtis are unknown (no per-user jti index), so
125	 * the target's token EPOCH is bumped, invalidating every outstanding token at once (same
126	 * mechanism as deactivation, ch09 §9.6). Cross-org for an org-admin reads as 'not-found' — no
127	 * user enumeration across orgs.
128	 */
129	export async function logoutSelf(claims: JwtClaims, deps: Deps): Promise<void> {
130	  await revoke(claims.jti, claims.sub, claims.exp ?? Math.floor(deps.now() / 1000) + 24 * 3600, deps.now());
131	}
132	
133	export async function logoutOther(
134	  caller: Pick<JwtClaims, 'role' | 'orgId'>,
135	  targetUserId: string,
136	): Promise<'ok' | 'forbidden' | 'not-found'> {
137	  if (caller.role !== 'super-admin' && caller.role !== 'org-admin') return 'forbidden';
138	  const target = await users.get(targetUserId);
139	  if (!target) return 'not-found';
140	  if (caller.role === 'org-admin' && target.orgId !== caller.orgId) return 'not-found';
141	  // Epoch shares the JWT iat clock (real seconds), strictly after any token minted this second
142	  // (the setUserActive rule): every outstanding token for the target dies at once. DURABLE (H1) —
143	  // an admin logout that reset to 0 on the next boot would re-admit the very tokens it revoked.
144	  await bumpTokenEpochDurable(targetUserId, Math.floor(Date.now() / 1000) + 1);
145	  return 'ok';
146	}
147	
148	/**
149	 * Self password change (F1, ch03 §3.8.1): verify the CURRENT password, hash + store the new
150	 * one, and clear `passwordChangeRequired` (the forced-change flow's exit). Wrong current
151	 * password is an AuthError 401 — never a silent overwrite.
152	 */
153	export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
154	  const u = await users.get(userId);
155	  if (!u) throw new AuthError('UNAUTHENTICATED', 401, 'Sessão expirada. Inicie sessão novamente.');
156	  if (!(await verifyPassword(currentPassword, u.passwordHash))) {
157	    throw new AuthError('UNAUTHENTICATED', 401, 'A palavra-passe atual está incorreta.');
158	  }
159	  const passwordHash = await hashPassword(newPassword);
160	  const epochSec = Math.floor(Date.now() / 1000) + 1;
161	  // Changing a password invalidates EVERY token minted under the old one — including the caller's
162	  // (they re-login). A password change is the standard response to a suspected compromise; leaving
163	  // a stolen token admissible would defeat it. Epoch bump, not a new token scheme (F1 non-goal).
164	  // The epoch is persisted in the SAME store write as the new hash (H1 durability) and mirrored to
165	  // the in-memory map, so a restart cannot re-admit a token minted under the old password.
166	  await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: false, tokenEpoch: epochSec }));
167	  bumpTokenEpoch(userId, epochSec);
168	}
169	
170	/**
171	 * Admin password reset (F1, shared users.resetPassword): super-admin sets a new password and
172	 * FORCES a change on next login (`passwordChangeRequired: true`). Returns false when the user
173	 * does not exist (the router 404s).
174	 */
175	export async function resetPassword(userId: string, newPassword: string): Promise<boolean> {
176	  const passwordHash = await hashPassword(newPassword);
177	  const epochSec = Math.floor(Date.now() / 1000) + 1;
178	  // An admin reset is the offboarding / compromised-account lever: the target's outstanding
179	  // tokens must die with the old password, not linger to their JWT expiry — and the revocation
180	  // must survive a restart (H1), so the epoch is persisted in this SAME store write and mirrored
181	  // to the in-memory map below.
182	  const updated = await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: true, tokenEpoch: epochSec }));
183	  if (!updated) return false;
184	  bumpTokenEpoch(userId, epochSec);
185	  return true;
186	}
187	
188	/**
189	 * Deactivate a user (ch09 §9.7.1): one operation that (1) sets active=false in the store,
190	 * (2) updates the write-through activation map synchronously, (3) revokes the user's tokens.
191	 * `jtisToRevoke` are the user's outstanding token ids known to the caller/session registry.
192	 */
193	export async function setUserActive(
194	  userId: string,
195	  active: boolean,
196	  jtisToRevoke: Array<{ jti: string; expiresAtSec: number }>,
197	  deps: Deps,
198	): Promise<AuthUserView | null> {
199	  const cur = getActivation(userId);
200	  // MAP FIRST, synchronously (ch09 §9.7.1: the toggle updates the map synchronously so the
201	  // effect is immediate) — this closes the TOCTOU window where a concurrent login between
202	  // the store write and the cache update could mint a token off the stale cache. On
203	  // deactivation the token epoch is bumped so EVERY outstanding token is invalidated at once
204	  // (no per-user jti index needed); any explicitly-known jtis are additionally revoked.
205	  // The token epoch shares the JWT `iat` clock (real seconds), strictly after any token
206	  // minted this second, so every outstanding token is invalidated. deps.now drives stored
207	  // record timestamps; the epoch must track real time to align with jsonwebtoken's iat.
208	  const epochSec = Math.floor(Date.now() / 1000) + 1;
209	  // A deactivation bumps the epoch (invalidating every outstanding token); a re-activation keeps
210	  // the prior epoch. Both the epoch and the billing lock are persisted to the row in the SAME
211	  // operation as `active` (H1 durability), so a deactivation's revocation is not un-done on restart
212	  // and a billing lock is not reset to false at boot.
213	  const newEpoch = active ? cur?.tokenEpoch ?? 0 : epochSec;
214	  const billingLocked = cur?.billingLocked ?? false;
215	  setActivation(userId, { active, billingLocked, tokenEpoch: newEpoch });
216	  if (!active) {
217	    for (const t of jtisToRevoke) await revoke(t.jti, userId, t.expiresAtSec, deps.now());
218	  }
219	  const updated = await users.update(userId, (u) => ({ ...u, active, tokenEpoch: newEpoch, billingLocked }));
220	  if (!updated) {
221	    // The user vanished — restore the prior cache entry if we had one to avoid a phantom state.
222	    if (cur) setActivation(userId, cur);
223	    return null;
224	  }
225	  return view(updated);
226	}
227	
228	export { view as authUserView };
229	

codex
I’ve confirmed the main route surfaces. Now I’m reading the H1-H5 notes and the underlying auth/path helpers to check whether the slice claims still line up at the actual enforcement seams.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'for h in H1 H2 H3 H4 H5; do f="docs/autothing/runs/20260712-150958-4bb23640/slices/$h/impl-notes.md"; echo "--- $h ---"; sed -n '"'1,240p' \""'$f"; echo; done' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
--- H1 ---
# H1 impl-notes — SECURITY: roles capability layer, builder->user migration, permission-gated builds

Status: DONE-GREEN. All lead design decisions implemented as written (no relitigation).

## What I built

### (a) Role rename `builder` -> `user`
- `shared/src/common.ts`: `Role = z.enum(['super-admin','org-admin','user'])` (the sanctioned value rename).
- `api/src/data/stores.ts`: `UserDoc.role` literal type `... | 'user'`.
- UI + locales: web users page toggle values/badges (`'org-admin' | 'user'`), locale KEY `roleBuilder` -> `roleUser` (PT `Utilizador`, EN `User`), plus `web/locales/types.ts` (the Translation shape), `web/stores/users.ts` + `web/stores/billing.ts` role type unions.
- The web `pages.builder.*` namespace (the app-BUILDING workspace: `title: 'Builder'`, `whatToBuild`, ...) is a FEATURE area, not the role label - left untouched (out of scope per decision 7 "NO other web behavior change").

### (b) Real `can()` capability matrix — `api/src/auth/capabilities.ts`
Replaced the PERMISSIVE-STUB body + header. Pure role->capability map (`Record<Role, Capability[]>`):
- `super-admin`, `org-admin`: all four (`canBuildApps`, `canEditApps`, `canCreateArtifacts`, `canUseChat`).
- `user`: `canUseChat` + `canCreateArtifacts` only.
- **null/undefined actor: NOTHING (fail closed)** — decided + documented (see "Null-actor semantics" below).
- Unknown/stale role also fails closed (defensive `?? false`, so a signature-valid token carrying a dead role value grants nothing). Vocabulary in `shared/src/capabilities.ts` unchanged (not touched).

### (c) Two legacy-compat layers
- **Boot migration** `migrateBuilderRole()` (`api/src/auth/users-service.ts`), wired into `bootState()` (`api/src/server.ts`) right AFTER `loadActivation` (so the epoch bump lands in the freshly-loaded in-memory activation map). Idempotent: rewrites every `role:'builder'` row to `'user'` and bumps its token epoch (reusing the role-change revocation path), returns the count (0 once migrated). No migration framework used (matches the repo's idempotent-boot-step convention).
- **Verify-boundary shim** in `verifyToken()` (`api/src/auth/jwt.ts`): a JWT still carrying `role:'builder'` is normalised to `'user'` before it is returned. **Placement note (minor deviation from the brief's literal wording):** the brief said "requireAuth/verifySseToken map...". Both of those call `verifyToken` as their first step, and so do every `?token=` consumer (build-link, m365, serving routers). Putting the shim in the single verify chokepoint covers all of them with one line and guarantees "before any check" for the two named admission paths too. Documented inline as the legacy-window shim.

### (d) Four capability gates wired (per-route `can()`, NOT a descriptor-middleware refactor)
- `api/src/routes/jobs.ts` `POST /`:
  - first build (no `artifactId`): `can(actor,'canBuildApps')` else 403.
  - follow-up (`artifactId`): `can(actor,'canEditApps')` FIRST (capability refusal never leaks target existence), THEN `loadWritable(actor, artifactId)` (own always; org-shared in-org ok; other-user private -> 403; missing/cross-org -> 404). **This closes the follow-up-build IDOR (map §5.1)** — gated BEFORE any job is created or agent spawned.
- `api/src/routes/chat.ts` `POST /runs`: `can(actor,'canUseChat')`.
- `api/src/routes/artifacts.ts` `POST /`: `can(actor,'canCreateArtifacts')`.

**Why route-level, not inside `handleBuildCreate`:** `handleBuildCreate` has exactly one caller (`jobs.ts:39` — verified by grep), and `routes/` already imports `apps/app-paths` (`loadWritable`) + `auth/` (artifacts.ts precedent), so the route is the correct tier. `agents/build.ts` reaches `apps/` only through injected seams; importing `loadWritable` there would break the seam convention. Route-level gating also keeps the agents-layer tests (which call `handleBuildCreate`/`executeBuildJob` directly) and automation-internal build paths unaffected by the gate. `api/src/agents/build.ts` and `api/src/apps/app-paths.ts` were therefore NOT modified.

### (e) Refusal contract
Shared FORBIDDEN envelope + `details.capability` (+ PT-PT message, no emoji, no em/en-dash) on every capability refusal. Object-ownership denials (the IDOR 403 and the 404) carry NO `details.capability` — they are resource denials, not capability refusals. `shared/src/errors.ts` NOT touched: `ErrorEnvelope.details` is already `z.record(JsonValue)`, and `{ capability: '<name>' }` is plain JSON, so the addition is purely additive and validates.

### (f) Default role on create
`createUser` (`api/src/auth/users-service.ts`) role param is now optional and defaults to `'user'`. The HTTP contract (`CreateUserRequest.role`) is left REQUIRED (unchanged - additive-only); the service default protects direct programmatic callers. Interpreted decision 6 literally ("users-service createUser default role becomes 'user'").

### (g) Tests
- `api/tests/auth/capabilities.test.ts` (NEW, replaces the deleted `capabilities-stub.test.ts`): all 12 role×capability cells + null/undefined -> nothing + vocabulary pin.
- `api/tests/auth/role-migration.test.ts` (NEW): migration idempotence on mongo-mem (builder row -> user once, epoch bumped once, second run = 0, no re-bump) + verifyToken legacy-role normalization (builder->user; user/org-admin untouched).
- `api/tests/contract/jobs.test.ts` (EXTENDED): a `user` first-build -> 403 FORBIDDEN envelope + `details.capability='canBuildApps'`.
- `api/tests/contract/jobs-capability.test.ts` (NEW, integration, mongo-mem, real jobsRouter, `handleBuildCreate` mocked = "mock the executor"): first-build user 403 / org-admin 202; follow-up IDOR — user 403 (canEditApps, before ownership), org-admin vs other-user private in-org 403 (ownership, no capability field), cross-org 404, org-shared same-org 202, own-private 202. Refusals assert the executor was never called.

### (h) Docs + diagram
- `docs/security.md`: updated the access-control section — role rename, a capability matrix table, the four gates, the refusal contract, and a dedicated "Follow-up-build ownership (IDOR fix, H1)" paragraph.
- Diagrams (FIXED-12): I checked `10-privacy-boundaries` first — it names only `org-admin`, not the role model or the build gate, so it is NOT the affected diagram. The two affected diagrams:
  - `docs/diagrams/12-org-tenancy.excalidraw` (the ROLE/tenancy model): renamed `builder`->`user` in the users store + roles legend, and rewrote the per-role capability lines to encode the new matrix (`org-admin` gains "app build/edit"; `user` = "chat + own/org-shared artifacts; NOT app build/edit (H1)").
  - `docs/diagrams/04-agent-job.excalidraw` (the build/job flow): added an "H1 build authz gate" note at the `POST /jobs` entry describing the canBuildApps / canEditApps+loadWritable gates and the IDOR closure. (Its existing `builder`/`capability`/`follow-up` strings are unrelated — builder-CHROME scrub, pv1 CAPABILITY token, knowledge-scoping follow-up — so no rename there.)
  Both files re-validated as parseable JSON; diffs are minimal (12: 8 lines; 04: +1 element).

## Null-actor semantics (decided + documented)
A `null`/`undefined` actor holds NO capability — `can()` returns `false` for everything (fail closed). Rationale: an absent actor means the caller failed to resolve identity; granting anything would be a fail-open bug. In practice every wired gate runs after `requireAuth`, so `actor` is always present at the call sites; the null branch is the defensive contract the matrix test pins.

## Every suite the rename broke + the fix
The enum rename makes `'builder'` unassignable to `Role`/`UserDoc['role']`, breaking the TEST typecheck everywhere a test seeded it, AND the new `canBuildApps` gate 403s any `builder`(->`user`) actor that built through the route. Fixes:
1. **`api/tests/contract/jobs.test.ts`** — `u1` POSTs real builds expecting 202; a `user` now 403s. Fix: `u1` seeded as `org-admin` (can build); `u2` (SSE-only cross-user) -> `user`.
2. **`api/tests/contract/registo.test.ts`** — `bldA` (builder) POSTs builds to produce `build.created` audit rows; a `user` 403s before any job/audit exists. Fix: `bldA` seeded as `org-admin` (commented: building now needs canBuildApps).
3. **`api/tests/agents/build.test.ts`** — actor `role:'builder'` -> `'user'`. NO behavior change: these call `handleBuildCreate`/`executeBuildJob` DIRECTLY, bypassing the route gate.
4. **~50 other `api/tests/**` files** — pure literal `'builder'`->`'user'` sweep (role seeds/actors/union annotations). No behavior change: they either don't hit the gated build route, or use chat/artifact-create (both retained by `user`), or call agents/services directly. Excluded from the sweep: `artifact-type.contract.test.ts:13` (`'builder'` there is a BAD artifact-TYPE value, not a role) and the deleted stub test.
5. **`shared/src/contract.test.ts`** — asserts an AuthUser with `role:'builder'` validates; -> `'user'`.
6. **web** — `web/__tests__/components/users-page.test.tsx` + `usage-page.test.tsx` seeds -> `user`; page/store/locale type unions renamed. Web unit lane green (167 tests), users-page/usage-page green.

## Reserved-path compliance (git status)
All changes are within the brief's reserved paths EXCEPT the following, each REQUIRED by the sanctioned enum-value rename sweep ("sweep EVERY consumer") and listed explicitly:
- `api/src/data/stores.ts` — `UserDoc.role` literal type carries `'builder'`.
- `api/src/integrations/prefetch.ts`, `api/src/automation/engine.ts` — synthetic internal actors constructed with `role:'builder'` (visibility/scoping queries).
- `api/src/automation/service.ts` — the one real behaviour branch `actor.role === 'builder'` (`canCreateAutomation`); the persisted org-setting key `allowBuilderAutomations` keeps its wire name (data compat), only the role value changed.
- `shared/src/contract.test.ts` — AuthUser validation test.
- `web/locales/types.ts`, `web/stores/users.ts`, `web/stores/billing.ts` — role type unions the web typecheck requires.
- Test files outside `api/tests/{auth,contract}/**` + `api/tests/agents/build.test.ts` (e.g. `api/tests/agents/_setup.ts`, `agents/chat-*.test.ts`, `agents/registry.test.ts`, `apps/*`, `automation/*`, `auth/activation-auth.test.ts`, `bridge/token.test.ts`, `data/crypto-jwt.test.ts`, `events/*`, `integrations/*`, `knowledge/*`, `memory/*`) — all had `role:'builder'` literals that break the test typecheck under the rename.
- `web/next-env.d.ts` — shows as Modified but was ALREADY modified at session start (pre-existing, not my change).

NOT touched (deliberately): `shared/src/capabilities.ts` (vocabulary unchanged), `shared/src/{auth,jobs,errors}.ts` (no contract shape change - additive `details.capability` rides the existing envelope), `api/src/routes/users.ts` (default handled in the service), `api/src/agents/build.ts` + `api/src/apps/app-paths.ts` (route-level gating; loadWritable reused as-is). Served-app plane (`app-assistant-route`, `app-sso`) untouched.

## Verify commands + results (all green)
- `cd api && npx tsc --noEmit -p tsconfig.json` -> clean.
- `cd api && npx tsc --noEmit -p tsconfig.test.json` -> clean.
- `npx eslint` on all touched src + new tests -> 0 problems. `npx eslint api/tests` -> 0 errors (7 pre-existing unused-var WARNINGS in untouched `llm/`+`fake-daemon/` files).
- `cd api && npx vitest run tests/` -> **172 files, 1506 passed, 1 skipped** (full api lane; the rename broke nothing not listed above).
- `npm run gate:chokepoint` -> clean.
- `cd web && npx tsc --noEmit` -> clean; `npx vitest run` -> **30 files, 167 passed**; web lint touched files -> 0 errors (1 pre-existing react-hooks WARNING in `SetLimitDialog`, untouched by H1).
- `shared` rebuilt (`npm run build --workspace shared`) so `@ekoa/shared` d.ts reflects the enum (api resolves shared via `dist`).

## Known pre-existing (out of H1 scope)
- `web/app/(dashboard)/users/page.tsx:328` react-hooks/set-state-in-effect WARNING in `SetLimitDialog` (reset-on-open pattern) — predates H1, untouched; fixing it is a UI refactor outside the security block. Noted, not addressed.

## Codex-fix round

Loop-back on the Codex review of e2c165e (2 High + 1 Medium + 1 Low, all real). Built ON TOP of
e2c165e in the working tree (no commits). All four closed; full api vitest lane green
(**173 files, 1522 passed, 1 skipped** — was 172/1506/1 at e2c165e: +1 file, +16 tests). tsc
src+test clean, eslint 0 on every touched file, `gate:chokepoint` clean. No web file touched, so
no web typecheck run. 14 files changed, all inside the H-block reservation.

### HIGH-1 — durable `tokenEpoch` + `billingLocked` (revocation survives restart)
Root cause: `loadActivation` reloaded only `{active}`, so `tokenEpoch`/`billingLocked` defaulted to
`0`/`false` at every boot — every revocation and the billing lock silently un-did on restart.
- `api/src/data/stores.ts` `UserDoc` (:19-28) — added `tokenEpoch?: number` and `billingLocked?: boolean` (durable columns).
- `api/src/server.ts` `bootState` (:679) — `loadActivation` now maps `{ userId, active, billingLocked, tokenEpoch }` from every row (the loader already accepted both optionals).
- `api/src/auth/service.ts`:
  - New `bumpTokenEpochDurable(userId, epochSec)` — bumps the in-memory map AND writes `tokenEpoch` to the row in one op. Used by `logoutOther` (the one standalone bump). Exported (the durable-revocation test seeds through it).
  - `login` — syncs the map from the AUTHORITATIVE row, preferring the durable `u.billingLocked`/`u.tokenEpoch` (falls back to cache, then default), so a lock/revocation is restored even on a cold cache; the reloaded epoch feeds `mintIat`.
  - `changePassword`, `resetPassword`, `setUserActive` — fold `tokenEpoch` (and, for `setUserActive`, `billingLocked`) into their EXISTING `users.update` write (the "same operation" the brief calls for), keeping the in-memory bump as the fast path.
- `api/src/auth/users-service.ts` — `patchUser` (role change) and `migrateBuilderRole` fold `tokenEpoch` into their existing role `users.update`.
- Note: no code path sets `billingLocked = true` today (grep-confirmed — it is read-only in every plane), so the billing-lock work is the persistence plumbing + boot reload that makes a future/persisted lock survive restart (closes the carried LANDING "bootState loads activation without billingLocked" item). `createUser`/`seedAdmin` insert without the columns (absent = default), consistent with the loader's defaulting.
- **Proof** — `api/tests/auth/role-migration.test.ts`: the migration test now also asserts the ROW carries the bumped epoch (durability, not just the map); new `describe('durable revocation survives restart (H1 boot path)')` seeds a durable epoch, `simulateRestart()` (clears the map + re-runs `loadActivation` from the store exactly as `bootState` does), and asserts the epoch survived (an old-iat token still rejected, a fresh one admitted); same for a persisted `billingLocked=true`; plus a legacy-row-without-columns clean-default case.

### HIGH-2 — gate the OTHER app build/edit vectors (app-type-aware)
A `user` OWNS the artifacts they create, so `writable()` passed and they could change app code
without touching `POST /jobs`.
- `api/src/apps/app-paths.ts` — new `isAppArtifact(art)` (:67-): a BUILT app is signalled primarily by a recorded `data.projectDir` (only pipeline-built artifacts have one; a bare `POST /artifacts` record does not), secondarily by `data.artifactType === 'app'`. Non-app artifacts match neither and stay user-manageable.
- `api/src/routes/artifacts.ts` — a local `denyAppEdit(req,res,art)` helper (FORBIDDEN + `details.capability:'canEditApps'` when `isAppArtifact` and no `canEditApps`) wired AFTER `writable()`/`readable()` (ownership still applies first) on: `bundle-update`, `PUT /file`, `versions/:sha/restore`, `backend/enabled`, `backend/sample-run`, `backups` (snapshot), `backups/restore`. `POST /import` → `canBuildApps` (a bundle is always an app export). `POST /:id/fork` → app-type-aware: `canBuildApps` for an app, `canCreateArtifacts` for a non-app (users keep it). Read routes + `DELETE` left as-is (per brief; not over-gated for H5).
- **Scope decision:** gated EXACTLY the brief's vector list. `featured-update/apply|ignore` are NOT in that list and are left ungated (documented here rather than silently widening scope — revisit if H5 wants them).
- **Proof** — new `api/tests/contract/artifacts-capability.test.ts` (mongo-mem, real `artifactsRouter`; only the two heavy services a 2xx path reaches — `importArtifact`/`updateArtifactFromBundle`/`forkArtifact` — are factory-mocked so no real build): a `user` owning an APP gets 403 `canEditApps` on all seven in-place vectors and 403 `canBuildApps` on import/fork-of-app (service never called); an org-admin proceeds (service reached); a `user` forking a NON-app artifact they own is NOT refused (201, `canCreateArtifacts` preserved). No census/ledger bump needed — the suite-ledger runner censuses only Playwright specs / node drivers / web unit files, explicitly NOT `api/tests/contract/**` (scripts/suite-ledger-run.mjs:185-190).

### MEDIUM — follow-up TOCTOU (re-validate writability at execution)
`resolveFollowUp` re-fetched the artifact by id with no ownership check, so an owner could flip
`org→private` between the create-time gate and execution and the queued job still edited it.
- **Seam decision (boundary preserved):** `agents/build.ts` reaches `apps/` only through the injected mechanics seam (ch02 §2.7, confirmed by ekoa-architecture) — it must not import `loadWritable`. Added `revalidateWritable(actor, artifactId): Promise<'ok'|'notfound'|'forbidden'>` to the `BuildMechanics` seam (`api/src/agents/seams.ts`, interface + noop default returns `'ok'`), implemented in `api/src/apps/build-mechanics.ts` (delegates to `loadWritable`). The verdict union is inlined in the seam (no `apps/` type import into `agents/`).
- `api/src/agents/build.ts` — the follow-up execute branch calls `mech.revalidateWritable(input.actor, artifactId)` IMMEDIATELY before `resolveFollowUp`; a non-`ok` verdict is a distinct terminal `failed { EDIT_FORBIDDEN, "Já não tem permissão para alterar esta aplicação." }` (job error `code` is a free `z.string()` in shared/jobs — additive, validates). resolveFollowUp is never reached, so the agent is not resumed.
- **Proof** — `api/tests/agents/build.test.ts`: new test with `revalidateWritable → 'forbidden'` and a `resolveFollowUp` spy — asserts the job ends `failed`/`EDIT_FORBIDDEN` and the spy count is 0. `fakeMechanics` gained `revalidateWritable → 'ok'` so the existing follow-up-execute tests still proceed.

### LOW — existence oracle in the follow-up 403/404 split
- `api/src/routes/jobs.ts` — in the follow-up gate, collapsed `loadWritable` `'forbidden'` into the SAME 404 as missing/cross-org (`if (verdict !== 'ok') return notFound(res)`). This is LOCAL to the build gate; the artifact routes keep their 403/404 distinction (they may legitimately differ). **This overrides the H1 brief's 403/404 split for the follow-up path** — security over the brief's convenience.
- **Proof** — `api/tests/contract/jobs-capability.test.ts`: the org-admin-vs-other-user-private case now expects **404** (was 403), asserting the ErrorEnvelope and that the executor was never called; header comment updated.

--- H2 ---
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

--- H3 ---
# H3 impl-notes - served-app EDIT MODE (admins only): patch-run preview / approve / rollback

Slice H3 of the atomic security block. Built on H1 (the real `can()` + `loadWritable` follow-up-build
gate) and H2 (`GET /api/app-assistant/whoami` detection + the panel's `admin` state). DONE-GREEN.

## What was built - a thin FRONT-END over existing, H1-gated machinery (not a second brain)

An admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a "patch run") over the app's own git repo -
the exact path the dashboard uses. H3 adds the panel UI + the network controller; it adds NO new
capability/permission logic and NO new build/edit endpoint. The server is the authority.

### 1. New controller module - `api/assets/panel-runtime/src/edit-mode.js` (new, reserved)
A plain-JS, `fetch`-injectable controller (no React), so the network flow is unit-provable against a
fake fetch. Every call targets the PLATFORM `/api/v1/*` API with the admin's platform Bearer - a
SEPARATE plane from the visitor-blind `POST /api/app-assistant` (which still never reads the caller JWT).
- `startEditJob` -> `POST /api/v1/jobs { kind:'build', description, sessionId, language:'pt', artifactId }`
  with `Authorization: Bearer <admin JWT>`. This is a follow-up build; H1 re-gates it server-side
  (`can(canEditApps)` AND `loadWritable`, uniform 404). `sessionId` is a fresh client correlation id
  (`newEditSessionId`) - a follow-up reserves nothing, it only tags the job.
- `readVersions` -> `GET /api/v1/artifacts/:id/versions` (newest-first; `items[0].sha` = HEAD).
- `rollbackToVersion` -> `POST /api/v1/artifacts/:id/versions/:sha/restore` (forward-restore; one click).
- `streamJobEvents` -> reads `GET /api/v1/jobs/:id/events?token=` with fetch + a ReadableStream reader
  and `parseSseBuffer` (frame-by-frame SSE parsing; a frame split across chunk boundaries is buffered,
  a garbled frame skipped - never a throw). Resolves on the terminal `complete`/`error` JobEvent.
- `runEditPatch` orchestrates: capture the pre-run head BEFORE the build (the rollback target / diff
  point) -> start the follow-up build -> stream `plan_step` narration to `onProgress` -> read the new
  head for the preview. Returns a discriminated outcome: `ready | answered | failed | degraded`.
- `degradeMessage(status)` maps 401/403/404/other to distinct calm PT-PT lines. `progressLine(ev)`
  narrates `plan_step`. `EDIT_COPY` holds the shared PT-PT strings (the confirm wording etc.).

### 2. Panel wiring - `api/assets/panel-runtime/src/AssistantPanel.jsx` + `.css` (reserved)
- **Opt-in switch** (`.ekoa-assistant-adminbar` / `.ekoa-assistant-editswitch`): a VISIBLE, accessible
  (`role="switch" aria-checked`) toggle, rendered ONLY when `admin === true`, OFF by default
  (`editMode` starts `false`). A distinct control from the visitor OPERAR/MOSTRAR/ENSINAR toggle.
- **Edit affordance** (`.ekoa-assistant-edit`, `data-edit-phase`): a dedicated, visually distinct
  section (left accent bar + tinted surface + "Modo de edição (administrador)" header) shown only when
  `admin && editMode`. Its phase machine: `compose` (type the request) -> `confirm` (the PT-PT intent
  confirmation "Vou preparar esta alteração como uma revisão. Confirma?") -> `running` (live
  `plan_step` narration) -> `preview` (shows new head + pre-run head, APPROVE vs REVERTER) -> `note`
  (a terminal calm message). APPROVE keeps the new head (the build already activated it - no call);
  REVERTER is one click to `rollbackToVersion(preRunSha)`.
- **Admin discovery** (`.ekoa-assistant-discovery`): a discreet, dismissible banner shown ONCE to a
  detected admin who has not opted in and not dismissed it (`admin && !editMode && !discoveryDismissed`),
  with a concrete PT-PT suggestion ("Pode pedir alterações a esta aplicação - por exemplo, adicionar um
  campo ou um botão."). Its CTA is the SAME explicit opt-in click; it never auto-enables edit.

## Detect-then-ask enforcement (BINDING)

Detection NEVER enables edit. `editMode` starts `false` and the only `setEditMode(true)` in the panel
is inside `openEditMode`, wired exclusively to explicit click handlers (the switch + the discovery CTA).
The H2 whoami DETECTION effect touches only `setAdmin` - it references neither `setEditMode` nor
`openEditMode` (pinned by a test that slices the effect). Being an admin SHOWS the switch; it does not
enter edit mode. `admin` is still set exactly once and read only to gate the affordance.

## Graceful degradation

Every mid-flow platform call is fail-soft: `runEditPatch`/`rollbackToVersion` return `{ ok:false, status }`
/ `{ outcome:'degraded', status }` on any 401/403/404/network error (token expired, lost writability,
app gone), and the panel renders `degradeMessage(status)` in the calm `note` phase - never a crash. A
missing app id / unreadable token (cross-origin, sandboxed iframe) degrades the same way rather than
firing a doomed call. An in-build classifier `answered` (no job created) and a build `error` event each
land on their own calm note.

## Visitor-blindness preserved (separate planes)

Edit mode uses ONLY the platform `/api/v1/*` API with the admin JWT. The served-app `POST
/api/app-assistant` plane is byte-for-byte untouched and stays visitor-blind - a test slices `confirmEdit`
and asserts it references neither `ENDPOINT` nor `/api/app-assistant`. Edits are never routed through the
visitor assistant endpoint.

## Contracts / server

NONE added. H3 reuses the existing jobs + versions/restore endpoints (all already in `shared/`), so
`shared/src/app-assistant.ts` was NOT touched and no new contract test was needed. No new
build/edit/capability logic (H1 owns gating). No queue (that is H4).

## Diagram updated (FIXED-12)

`docs/diagrams/04-agent-job.excalidraw` - added one free-standing note (`h3_edit_mode`, emerald
`#047857`, monospace, x=72 y=332) directly below the existing H1 build-authz-gate note. WHY 04 and not
03: an H3 edit request IS a follow-up build, which lives on the agent-job lifecycle diagram (04 already
documents `POST /api/v1/jobs`, the follow-up path, and the H1 `canEditApps`/`loadWritable` gate). The
note states the H3 admin plane: detect (H2 whoami) -> opt-in switch (never auto) -> confirm -> POST
/jobs {artifactId} + admin JWT = the SAME follow-up build (H1 re-gates) -> stream SSE -> preview via
versions -> APPROVE keeps head | ROLLBACK = restore (pre-run head); and that it is a SEPARATE plane from
the visitor-blind POST /api/app-assistant. Round-trip verified: the diagram diff is +32 lines (exactly
the one element), 0 deletions, no overlap with existing elements, valid JSON.

## Reserved-path compliance

All changes are within the H3 reserved set:
- `api/assets/panel-runtime/src/AssistantPanel.jsx`, `AssistantPanel.css`, `edit-mode.js` (new module)
- `api/tests/apps/assistant-panel.test.ts` (extended), `api/tests/apps/edit-mode.test.ts` (new)
- `docs/diagrams/04-agent-job.excalidraw`
- `slices/H3/**`
`shared/src/app-assistant.ts` was NOT touched (no thin read needed). No commits, no stack ops, no real
builds. Note: the root ESLint config ignores `api/assets/**` and `**/*.js`, so the panel JSX + the new
`.js` module are linted by esbuild's `build.mjs` compile (their real gate), not eslint; only the `.ts`
test files are eslint-checked.

## Tests

- **Behavioural** (`api/tests/apps/edit-mode.test.ts`, 16 tests): the controller is imported at runtime
  by file URL (it is a compiled-by-esbuild asset, outside the tsc program) and driven with a fake fetch:
  POST /jobs body carries `kind:'build'` + `artifactId` + `description` + `Bearer`; the pre-run head is
  read BEFORE the POST (order asserted); `plan_step` narration surfaces; a 403/404 on /jobs and a 403 on
  the versions read each degrade (no /jobs issued in the latter); an error event -> failed; answered ->
  answered; rollback POSTs the restore endpoint with the Bearer; a 404 on restore degrades; SSE frames
  parse (comments/non-data ignored, partial + split frames reassembled); no emoji in the source.
- **Source-contract** (`api/tests/apps/assistant-panel.test.ts`, +6 tests, +1 H2 fix): the switch is
  admin-gated and starts OFF; the affordance is revealed only by `admin && editMode`; detect-then-ask is
  binding (one `setEditMode(true)`, in `openEditMode`, wired to clicks; the detection effect touches
  neither); the discovery banner is once/dismissible and never auto-enables; the flow uses the /api/v1/*
  plane (imports from `./edit-mode`, `runEditPatch`/`rollbackToVersion`) and `confirmEdit` never
  references the visitor endpoint; graceful degradation via `degradeMessage` + the `note` phase. The one
  H2 test that pinned "no `setEditMode` yet" (deferred-to-H3) was updated to assert, instead, that the
  DETECTION effect never enables edit mode (its intent survives H3).

The heavy end-to-end (a REAL patch run editing a real app + rollback) is the LEAD's live probe - NOT run
here; no e2e driver added. The flow is correct + unit-proven.

## Verification (all green, locally)

- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0
- `npx tsc --noEmit -p tsconfig.test.json` -> 0
- `npx eslint api/tests/apps/edit-mode.test.ts api/tests/apps/assistant-panel.test.ts` -> 0 errors
  (panel `.jsx`/`.js` assets are config-ignored - esbuild compile is their gate)
- `npx vitest run tests/apps tests/contract` -> 57 files, 559 tests, all pass
- `node assets/panel-runtime/build.mjs` -> built (panel compiles, 240389 bytes)
- repo root `npm run gate:chokepoint` -> clean (nothing outside api/src/llm touches the provider)

## Codex-fix round (2026-07-13) - 2 Mediums closed (commit 28a6e12 review)

Codex review of H3 returned NEEDS-WORK with 2 real Mediums; a fresh review APPROVED. Both fixed in
the working tree (edit-mode.js + AssistantPanel.jsx + tests) - no commit; the lead runs the gate.

- **M1 (SSE early-close false "no change"): CLOSED.** Before, `runEditPatch` treated the SSE stream
  outcome as terminal: a proxy/network blip that closed the stream BEFORE the `complete` event read
  as done, one versions read showed the head unchanged, and the panel said "no change" - while the
  follow-up build could complete moments later and activate a real new head (a deployed edit the
  admin was told did not happen). FIX: the SSE is now streamed for LIVE PROGRESS ONLY and is NOT
  terminal. After the stream ends (or drops), the new `pollJobUntilTerminal` polls
  `GET /api/v1/jobs/:id` until the JOB RECORD reaches a terminal status - transient-tolerant exactly
  like the fees-knowledge e2e build poll (`safeJson` never throws; a deterministic 4xx degrades on
  its status; a 5xx / non-JSON / network blip is tolerated up to a bounded count; the deadline yields
  `pending`). Only a CONFIRMED `completed` reads the new head for the preview (never a mid-build
  snapshot); `failed`/`cancelled` -> the calm failure note; the deadline -> a new `pending` outcome
  the panel shows as "A revisão ainda está em curso..." (never a false ready/no-change). Terminal
  statuses mirror `api/src/agents/jobs.ts` (`completed` success; `failed`/`cancelled` failure).
  TESTS: an SSE that closes with NO terminal frame polls running->completed and previews the head the
  build produced AFTER the blip (post-run versions read strictly after the job poll); a never-terminal
  job at the deadline returns `pending` and does NOT read a post-run head; `pollJobUntilTerminal`
  tolerates a 502/non-JSON blip then completes, degrades on a deterministic 401, and treats
  `cancelled` as terminal failure.

- **M2 (stale rollback sha wipes concurrent changes): CLOSED.** Before, Reverter forward-restored to
  `preRunSha` with no guard that HEAD was still the head THIS edit produced; if another admin / a
  dashboard action / a later restore moved HEAD between preview and the click, restoring to
  `preRunSha` silently wiped that newer unrelated change. FIX: the preview now captures the new head
  this edit produced (`editPreview.newHeadSha`, the confirmed-completed head), and the Reverter click
  goes through the new `guardedRollback`, which RE-READS `GET /versions` and requires
  `items[0].sha === expectedHeadSha` (the edit's head) AND that `preRunSha` still exists in history
  before restoring. If HEAD advanced (or the target is gone) it REFUSES with no restore call, and the
  panel shows the calm PT-PT "A aplicação foi alterada entretanto; atualize a pré-visualização." The
  Reverter button is also only rendered when a `preRunSha` exists (never restore to undefined).
  TESTS: a rollback where HEAD still == the edit's new head fires restore to `preRunSha`; a rollback
  where HEAD advanced is REFUSED (`reason:'head-advanced'`, no restore call); a missing pre-run
  target is REFUSED (`reason:'target-missing'`); a refused versions re-read degrades. Panel pins:
  `guardedRollback({... expectedHeadSha ...})`, the `head-advanced` branch + `EDIT_COPY.headAdvanced`,
  and the `preRunSha`-guarded Reverter.

The detect-then-ask + visitor-blindness pins are intact (the visitor-endpoint slice check on
`confirmEdit` still passes; the switch/discovery opt-in tests unchanged). No new endpoints; `shared/`
still untouched (M1 reuses `GET /jobs/:id`, M2 reuses `GET /versions` + restore).

VERIFY (all green): `tsc -p tsconfig.json` 0; `tsc -p tsconfig.test.json` 0; eslint touched .ts 0
errors; `vitest run tests/apps` -> 20 files, 253 tests pass (edit-mode.test.ts now 25, +9 for M1/M2;
assistant-panel.test.ts H3 block +2 M1/M2 pins); `node assets/panel-runtime/build.mjs` compiles
(242378 bytes); `npm run gate:chokepoint` clean.

--- H4 ---
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

## Codex-fix round (HIGH - cross-org queue INJECTION)

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

--- H5 ---
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

## Codex-fix round (2026-07-14) - lead-applied

Codex H5 review returned NEEDS-WORK (1 High + 1 Medium + 1 Low). The fresh review APPROVED. All three
addressed:

- **HIGH - the destructive-action-authz assertion documented-away a REAL gap.** Codex is right: the
  general `/api/app-data` mutation plane authenticates NO caller (`scopeFor()` = X-Ekoa-App-Id +
  owner-activation only), so anyone knowing an app id can write/delete that app's data cross-tenant;
  app-id scoping alone is NOT authorization. The worker framed this as "documented boundary, not a
  hole" - that framing was WRONG. RE-DISPOSED HONESTLY (not silently fixed, not falsely dismissed):
  (1) docs/security.md now states it plainly as a KNOWN HIGH GAP with the precise threat + the two
  compounding facts (collection write-mode unenforced; app-sso cookie not even sent to /api/app-data);
  (2) a HIGH `served-app-data-unauthenticated-writes` entry in docs/findings.md; (3) a TRIPWIRE in
  destructive-action-authz.test.ts pinning the current unauthenticated-write state (a future fix flips
  it), with served-app.test.ts as the behavioral proof it currently 201s. RATIONALE for flag-not-fix:
  this is PRE-EXISTING (C3/D-era served-app data plane) on a DIFFERENT axis from the platform
  role/capability layer H1-H4 close (which IS complete); the proper fix (enforce the declared write
  mode + make an app-sso session verifiable at the data path - cookie-path widening / session token)
  is an architecture change across the ~200-app estate and an operator decision, not a bolt-on to the
  assertion slice. It is now the TOP landing item, honestly surfaced - exactly what the assertion
  layer is FOR (H5 finds gaps; the lead flags them for the operator).
- **MEDIUM - weak wiring inventory.** The file-level `can(` + literal check stayed green if a route
  silently lost its live gate (codex's example: whoami returning a constant while isAppEditor still
  carries the literal). Fixed: (a) the whoami row now REQUIRES the route to actually call
  `detectAppEditor(` and that `admin: await detectAppEditor(...)` is the response (a constant drops
  those tokens); (b) each inventory row now names its AUTHORITATIVE behavioral suite and a new test
  asserts those suites EXIST - the inventory is explicitly a structural smoke, the behavioral suites
  (jobs-capability / artifacts-capability / the whoami matrix) are the real proof that would fail on
  a broken gate.
- **LOW - grep gate web coverage.** The orphan-`builder` scan covered only web/{app,components,stores};
  web/lib, web/hooks, web/types, web/locales were unscanned (no live miss today - verified - but a
  future orphan would evade). Fixed: the scan now covers ALL live web source roots.

30/30 in tests/security + tests/auth/capabilities after the fix (grep gate re-proven non-tautological
- it even caught a literal PERMISSIVE-STUB token in a doc comment I wrote, forcing a reword). No
production auth code touched (the High is flagged, not fixed - an operator decision).


exec
/bin/zsh -lc "codegraph explore 'requireAuth verifySseToken loadReadable loadWritable can actorOf app path readable writable role migration token epoch billing locked activation store bootstrap users service'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/apps/app-paths.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/auth/middleware.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 131ms:
**api/src/apps/app-paths.ts** — 142 lines, 13 symbols · used by 6 files: api/src/routes/artifacts.ts, api/src/apps/build-mechanics.ts, api/src/server.ts, api/src/routes/change-requests.ts, api/src/routes/jobs.ts, api/src/apps/app-assistant-route.ts

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
142	

 succeeded in 135ms:
**api/src/auth/middleware.ts** — 84 lines, 5 symbols · used by 19 files: api/src/routes/auth.ts, api/src/routes/memories.ts, api/src/routes/users.ts, api/src/routes/sessions.ts, api/src/routes/automations.ts, api/src/routes/branding.ts, api/src/routes/bridge.ts, api/src/routes/credentials.ts, +11 more

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
84	

 succeeded in 623ms:
## Exploration: requireAuth verifySseToken loadReadable loadWritable can actorOf app path readable writable role migration token epoch billing locked activation store bootstrap users service

Found 225 symbols across 81 files.

### Blast radius — what depends on these (update/verify before editing)

- `verifySseToken` (api/src/auth/middleware.ts:59) — 8 callers in `api/src/routes/automations.ts`, `api/src/routes/chat.ts`, `api/src/routes/jobs.ts`, `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `DesignTokensCss` (api/src/services/design-tokens.ts:133) — 1 caller in `api/src/services/design-tokens.ts`; ⚠️ no covering tests found
- `DesignTokensDeps` (api/src/services/design-tokens.ts:72) — 2 callers in `api/src/services/design-tokens.ts`; ⚠️ no covering tests found
- `BridgeTokenClaims` (api/src/bridge/token.ts:20) — 3 callers in `api/src/bridge/index.ts`, `api/src/bridge/token.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- verifySseToken → isRevoked
- verifySseToken → getActivation
- automationsRouter → verifySseToken
- chatRouter → verifySseToken
- generateDesignTokensCss → tokensToVars
- generateDesignTokensCss → renderCss
- generateDesignTokensCss → update
- designTokensHandler → generateDesignTokensCss
- defaultResolvePairingByCredential → readBridgeToken
- attachBridgeServer → verifyBridgeToken
- ... and 313 more

**references:**
- generateDesignTokensCss → DesignTokensCss
- DesignTokensDeps → OrgBrand
- generateDesignTokensCss → DesignTokensDeps
- designTokensHandler → DesignTokensDeps
- tokensToVars → OrgBrand
- defaultResolveOrgBrand → OrgBrand
- brandFor → OrgBrand
- readBridgeToken → BridgeTokenClaims
- verifyBridgeToken → BridgeTokenClaims
- defaultResolvePairingByCredential → ResolvedPairing
- ... and 61 more

**instantiates:**
- readBridgeToken → BridgeAuthError

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/routes/artifacts.ts — imports(imports), calls(calls), sendError(calls), readable(calls), actorOf(calls), parseBody(calls), writable(calls), notFound(calls), references(references), instantiates(instantiates), +32 more

```typescript
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
321	    }
322	  });
323	
324	  // ---- app-data backups (ch03 §3.8.10) ----
325	  r.get('/:id/backups', async (req: AuthedRequest, res: Response) => {
326	    const art = await readable(req, res);
327	    if (!art) return;
328	    res.json(new AppDataBackups(appDeps).status(art._id));
329	  });
330	
331	  r.post('/:id/backups', async (req: AuthedRequest, res: Response) => {
332	    const art = await writable(req, res);
333	    if (!art) return;
334	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
335	    res.json(await new AppDataBackups(appDeps).saveSnapshot(art._id, 'manual'));
336	  });
337	
338	  r.get('/:id/backups/export', async (req: AuthedRequest, res: Response) => {
339	    const art = await readable(req, res);
340	    if (!art) return;
341	    res.json(await new AppDataBackups(appDeps).exportAll(art._id));
342	  });
343	
344	  r.post('/:id/backups/preview', async (req: AuthedRequest, res: Response) => {
345	    const art = await readable(req, res);
346	    if (!art) return;
347	    const body = parseBody(res, BackupPointRef, req.body) as { pointId: string; source: string; at: string } | undefined;
348	    if (!body) return;
349	    try {
350	      res.json(await new AppDataBackups(appDeps).previewAsOf(art._id, body));
351	    } catch (err) {
352	      return sendError(res, 'NOT_FOUND', err instanceof Error ? err.message : 'Ponto de restauro não encontrado.');
353	    }
354	  });
355	
356	  r.post('/:id/backups/restore', async (req: AuthedRequest, res: Response) => {
357	    const art = await writable(req, res);
358	    if (!art) return;
359	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
360	    const body = parseBody(res, BackupPointRef, req.body) as { pointId: string; source: string; at: string } | undefined;
361	    if (!body) return;
362	    res.json(await new AppDataBackups(appDeps).restoreTo(art._id, body));
363	  });
364	
365	  // ---- artifact backend (ch03 §3.8.11) ----
366	  r.get('/:id/backend', async (req: AuthedRequest, res: Response) => {
367	    const art = await readable(req, res);
368	    if (!art) return;
369	    const declared = await readDeclaredBackend(art);
370	    const status = getArtifactBackendRuntime().getStatus(art._id);
371	    res.json({ hasBackend: !!declared, status: status.state, declared: declared ?? null, runtime: status });
372	  });
373	
374	  r.get('/:id/backend/logs', async (req: AuthedRequest, res: Response) => {
375	    const art = await readable(req, res);
376	    if (!art) return;
377	    const q = PaginationQuery.safeParse(req.query);
378	    const limit = q.success && q.data.limit ? q.data.limit : 100;
379	    res.json({ items: getArtifactBackendRuntime().getRecentLogs(art._id, limit).map(logView) });
380	  });
381	
382	  r.get('/:id/backend/invocations', async (req: AuthedRequest, res: Response) => {
383	    const art = await readable(req, res);
384	    if (!art) return;
385	    const q = PaginationQuery.safeParse(req.query);
386	    const limit = q.success && q.data.limit ? q.data.limit : 20;
387	    res.json({ items: getArtifactBackendRuntime().getInvocations(art._id, limit).map(invocationView) });
388	  });
389	
390	  r.put('/:id/backend/enabled', async (req: AuthedRequest, res: Response) => {
391	    const art = await writable(req, res);
392	    if (!art) return;
393	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: a backend exists only on an app → canEditApps
394	    const body = parseBody(res, BackendSetEnabledRequest, req.body) as { enabled: boolean } | undefined;
395	    if (!body) return;
396	    getArtifactBackendRuntime().setEnabled(art._id, body.enabled);
397	    res.json({ enabled: body.enabled });
398	  });
399	
400	  r.post('/:id/backend/sample-run', async (req: AuthedRequest, res: Response) => {
401	    const art = await writable(req, res);
402	    if (!art) return;
403	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: invoking an app's backend → canEditApps
404	    const body = parseBody(res, BackendSampleRunRequest, req.body) as { entrypoint: string; input: unknown } | undefined;
405	    if (!body) return;
406	    const declared = await readDeclaredBackend(art);
407	    const entrypoint = (body.entrypoint || declared?.handlers?.[0] || '').trim();
408	    if (!entrypoint) return sendError(res, 'VALIDATION_FAILED', 'É necessário um entrypoint (nenhum handler declarado).');
409	    const result = await getArtifactBackendRuntime().invoke(art._id, entrypoint, body.input, { dryRun: true, invokedBy: 'sample' });
410	    res.json({ result, ...(result.dryRunEffects ? { dryRunEffects: result.dryRunEffects } : {}) });
411	  });
412	
413	  return r;
414	}
415	
416	function logView(l: BackendLogEntry) {
417	  return { at: l.at, level: l.level, message: l.msg, ...(l.meta ? { meta: l.meta } : {}) };
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I have the core enforcement helpers now. Next I’m checking for alternate entry points and stale role handling: every caller of the build path, every `can*` use, and any remaining `builder` assumptions that could diverge across slices.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"handleBuildCreate\\(|can\\(actor|can\\(["'^'"\\n]*'can(BuildApps|EditApps|UseChat|CreateArtifacts)'|role\\s*===\\s*'builder'|role:\\s*'builder'|'builder'\" api/src shared/src web api/tests | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/tests/journeys/j3-build.mjs:112:  const u1Id = await mkUser('bc-u1', 'builder');
api/tests/journeys/j1-auth.mjs:61:  const userCreate = await api('POST', '/api/v1/users', { token, body: { username: uname, password: 'pw123456', role: 'builder', orgId: orgAId } });
api/tests/journeys/j9-baseline.mjs:20:  const user = await api('POST', '/api/v1/users', { token: admin, body: { username: uname, password: 'pw123456', role: 'builder', orgId } });
api/tests/journeys/j4-memory.mjs:34:    const u = await api('POST', '/api/v1/users', { token: adminToken, body: { username, password: 'pw123456', role: 'builder', orgId } });
api/tests/journeys/j6-anonymisation.mjs:36:  const { orgId, userId, token, username } = await createOrgUser(adminToken, { orgName: 'AnonZ', orgDisplay: 'AnonZ', username: 'az-u1', role: 'builder' });
api/tests/journeys/_chat.mjs:37:export async function createOrgUser(adminToken, { orgName, orgDisplay, username, password = 'pw123456', role = 'builder' }) {
api/tests/journeys/j5-isolation.mjs:23:    const b = await api('POST', '/api/v1/users', { token: adminToken, body: { username: userName + '-b', password: 'pw123456', role: 'builder', orgId } });
api/tests/journeys/j2-grounding.mjs:22:    orgName: 'GroundCo', orgDisplay: 'GroundCo', username: 'gc-u1', role: 'builder',
api/tests/apps/app-assistant.test.ts:247: * (codex-h2): H1's `can('canEditApps')` capability gate AND the artifact-writability verdict
api/src/agents/build.ts:90:export async function handleBuildCreate(input: BuildCreateInput): Promise<BuildCreateResult> {
api/src/routes/jobs.ts:51:      if (!can(actor, 'canEditApps')) {
api/src/routes/jobs.ts:61:    } else if (!can(actor, 'canBuildApps')) {
api/src/routes/jobs.ts:65:    const result = await handleBuildCreate({
api/src/auth/users-service.ts:91: * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
api/src/auth/users-service.ts:95:  const legacy = await users.find({ role: 'builder' });
api/src/routes/chat.ts:41:    if (!can(actor, 'canUseChat')) {
api/src/auth/jwt.ts:61:  // role 'builder', which is no longer a valid Role. Normalise it HERE — the single verify
api/src/auth/jwt.ts:67:  if ((decoded.role as string) === 'builder') decoded.role = 'user';
api/src/routes/artifacts.ts:82:    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
api/src/routes/artifacts.ts:101:    if (!can(actorOf(req), 'canCreateArtifacts')) {
api/src/routes/artifacts.ts:113:    if (!can(actorOf(req), 'canBuildApps')) {
api/src/routes/artifacts.ts:162:    if (!can(actorOf(req), forkCap)) {
api/src/apps/app-assistant-route.ts:97:  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
api/tests/auth/role-migration.test.ts:6: *   2. the verify-boundary normalization shim (verifyToken): a JWT still carrying role 'builder'
api/tests/auth/role-migration.test.ts:53:    // Seed a LEGACY row: role 'builder' is no longer in the Role type, so the doc is cast to
api/tests/auth/role-migration.test.ts:55:    await users.insert({ _id: 'legacy1', username: 'legacy1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'orgA', active: true } as never);
api/tests/auth/role-migration.test.ts:73:    // Second run: nothing carries 'builder' now → no rows migrated, no further epoch bump.
api/tests/auth/role-migration.test.ts:87:  it("normalises a legacy 'builder' JWT role to 'user' before any check", () => {
api/tests/auth/role-migration.test.ts:88:    // A token minted before the rename literally carries role 'builder'. jwt.sign it raw (signToken
api/tests/auth/role-migration.test.ts:91:      { sub: 'u1', role: 'builder', scope: 'user', orgId: 'o1', username: 'ana', jti: 'j1' },
api/tests/agents/build.test.ts:65:    const res = await handleBuildCreate({ actor, username: 'u1', sessionId: 's1', description: 'change it', language: 'pt', artifactId: 'artBusy', deps: deps() });
api/tests/agents/build.test.ts:72:    const first = await handleBuildCreate({ actor, username: 'u1', sessionId: 'sessDup', description: 'build a crm', language: 'pt', deps: d });
api/tests/agents/build.test.ts:75:    const second = await handleBuildCreate({ actor, username: 'u1', sessionId: 'sessDup', description: 'build a crm', language: 'pt', deps: d });
api/tests/agents/build.test.ts:83:    const res = await handleBuildCreate({ actor, username: 'u1', sessionId: 's9', description: 'tweak', language: 'pt', artifactId: 'artA', deps: deps() });
api/tests/auth/capabilities.test.ts:37:    expect(can({ role: 'user' }, 'canUseChat')).toBe(true);
api/tests/auth/capabilities.test.ts:38:    expect(can({ role: 'user' }, 'canCreateArtifacts')).toBe(true);
api/tests/auth/capabilities.test.ts:39:    expect(can({ role: 'user' }, 'canBuildApps')).toBe(false);
api/tests/auth/capabilities.test.ts:40:    expect(can({ role: 'user' }, 'canEditApps')).toBe(false);
api/tests/auth/capabilities.test.ts:64:      expect(can({ role: 'builder' as never }, capability), `stale-builder / ${capability}`).toBe(false);
api/tests/auth/capabilities.test.ts:78: * away from its enforcement points. It ties every capability to at least one wired `can(actor, '…')`
api/tests/auth/capabilities.test.ts:91:  // capability -> the source file that must carry an enforcing `can(actor, '<capability>')` gate,
api/tests/auth/capabilities.test.ts:124:    expect(wiredDirectly || wiredViaForkCap, `${file}: no can(actor, '${capability}') gate found`).toBe(true);
api/tests/security/grep-gates.test.ts:11: *      `'builder'` / `"builder"` ROLE literal may survive ONLY in the small sanctioned allowlist
api/tests/security/grep-gates.test.ts:13: *      `builder` - a session kind, NOT a user role). A `'builder'` literal ANYWHERE else in api/src,
api/tests/security/grep-gates.test.ts:17: * violations in the same file, so the gate is provably not vacuous (a real `'builder'` / stub marker
api/tests/security/grep-gates.test.ts:96:  // 'builder'; verifyToken maps it to 'user' at the single verify chokepoint (+ its doc comment).
api/tests/security/grep-gates.test.ts:98:  // migrateBuilderRole: the idempotent boot migration query `users.find({ role: 'builder' })` that
api/tests/security/grep-gates.test.ts:101:  // web SESSION-KIND 'builder' - the app-building SESSION kind persisted server-side, NOT a user
api/tests/security/grep-gates.test.ts:149:    expect(matchingLines("const role = 'builder';", BUILDER_RE)).toEqual([1]);
api/tests/security/grep-gates.test.ts:151:    expect(matchingLines("Role = z.enum(['super-admin','org-admin','builder'])", BUILDER_RE)).toEqual([1]);
api/tests/security/grep-gates.test.ts:168:      { file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" },
api/tests/security/grep-gates.test.ts:169:      { file: 'api/src/auth/jwt.ts', line: 61, text: "role 'builder'" }, // allowlisted survivor
api/tests/security/grep-gates.test.ts:172:    expect(orphans).toEqual([{ file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" }]);
web/stores/orchestration.ts:53:  /** Session kind persisted server-side (default 'builder'). 'onboarding'
api/tests/contract/artifact-type.contract.test.ts:13:    for (const bad of ['App', 'apps', 'site', '', 'builder']) {

exec
/bin/zsh -lc 'for f in docs/autothing/runs/20260712-150958-4bb23640/slices/H5/edit-journey-output.txt docs/autothing/runs/20260712-150958-4bb23640/slices/H5/request-changes-journey-output.txt; do echo "--- $f ---"; sed -n '"'1,240p' \""'$f"; echo; done' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
--- docs/autothing/runs/20260712-150958-4bb23640/slices/H5/edit-journey-output.txt ---
PASS admin login
PASS setup build completed -> app 81ff6dd3-c39b-4955-aeae-78ddd9612ce9
PASS DETECT: admin whoami -> { admin: true }
  opt-in: explicit client-side editMode switch (detect-then-ask; no server call)
PASS PATCH RUN: follow-up build completed; HEAD advanced 4ffba5a7 -> 1ddbdf04
PASS PREVIEW + APPROVE: new head is live (approve is a no-op - the build already activated it)
PASS ROLLBACK: forward-restore to pre-run head created a new head c5ca3c11 (revert is live + auditable)
PASS created + logged in a role:'user' account (edit-user-mrjvxts63s6)
PASS USER CANNOT EDIT: user whoami -> { admin: false }
PASS USER CANNOT EDIT: POST /jobs follow-up refused 403 (capability gate, before any ownership probe)
EDIT-MODE JOURNEY LIVE GATE: PASS

--- docs/autothing/runs/20260712-150958-4bb23640/slices/H5/request-changes-journey-output.txt ---
PASS admin login (org b5aa59e5-1607-470b-8042-b47ece558df6)
PASS setup build completed -> app b4557381-438b-44ae-a662-b0e87c833a98
PASS app set to org-shared (visibility: org)
PASS created in-org user rc-in-mrjvvd477hd + cross-org user rc-out-mrjvvd477hd
PASS FILE: request 8bb1bf02-1cd3-4e71-8893-bda720b14c30 filed into owner org b5aa59e5-1607-470b-8042-b47ece558df6 with route/screen context
PASS CROSS-ORG: a different-org user filing about the app -> 404 (no injection)
PASS SEE: org-admin sees the request with full context; the cross-org attempt is absent
PASS CONVERT: admin started the patch-run follow-up build e0dc2b63-b838-4f5d-9aab-f295f38db495 (H1-gated)
PASS CONVERT: request 8bb1bf02-1cd3-4e71-8893-bda720b14c30 -> 'converted' linked to patch-run job e0dc2b63-b838-4f5d-9aab-f295f38db495
  cancelled the started patch-run build e0dc2b63-b838-4f5d-9aab-f295f38db495 (budget hygiene; best-effort)
REQUEST-CHANGES JOURNEY LIVE GATE: PASS


exec
/bin/zsh -lc "codegraph explore 'edit-mode panel whoami jobs create convert request changes guardedRollback GET /jobs/:id admin JWT assistant panel runtime detectAppEditor convertChangeRequest fileChangeRequest'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/services/change-requests.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 180ms:
**api/src/services/change-requests.ts** — 131 lines, 7 symbols · used by 1 file: api/src/routes/change-requests.ts

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
131	

 succeeded in 541ms:
## Exploration: edit-mode panel whoami jobs create convert request changes guardedRollback GET /jobs/:id admin JWT assistant panel runtime detectAppEditor convertChangeRequest fileChangeRequest

Found 124 symbols across 56 files.

### Blast radius — what depends on these (update/verify before editing)

- `fileChangeRequest` (api/src/services/change-requests.ts:46) — 2 callers in `api/src/routes/change-requests.ts`; ⚠️ no covering tests found
- `RuntimeUnavailable` (api/assets/bases/app/wiring/protocol-client.ts:87) — 1 caller in `api/assets/bases/app/wiring/protocol-client.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- fileChangeRequest → now
- requireRuntime → getRuntime
- signIn → requireRuntime
- signOut → requireRuntime
- graphFetch → requireRuntime
- exportPdf → requireRuntime
- status → requireRuntime
- upload → requireRuntime
- list → requireRuntime
- download → requireRuntime
- ... and 129 more

**references:**
- AssistantRequest → AssistantAdmission
- AssistantAdmission → AppActionManifest
- UiActionsResult → AppActionManifest
- assistantToolsFromManifest → AppActionManifest
- manifest → AppActionManifest
- AppAssistantInput → AppActionManifest
- manifest → AppActionManifest
- requireRuntime → EkoaRuntime
- exportPdf → PdfExportOptions
- exportPdf → PdfExportResult
- ... and 12 more

**instantiates:**
- requireRuntime → RuntimeUnavailable

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/assets/bases/app/wiring/protocol-client.ts — RuntimeUnavailable(class), constructor(method), requireRuntime(function), getRuntime(function), signIn(function), signOut(function), graphFetch(function), exportPdf(function), status(function), upload(function), +9 more

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

#### api/src/apps/app-assistant-route.ts — calls(calls), detectAppEditor(function), AssistantAdmission(interface), AppActionManifest(references), AssistantRequest(interface), AssistantAdmission(references)

```typescript
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
```

#### api/src/services/change-requests.ts — fileChangeRequest(function), changeRequestView(function), Deps(interface), convertChangeRequest(function)

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

#### api/assets/panel-runtime/src/edit-mode.js — calls(calls), guardedRollback(function)

```javascript
232	 *   - { ok:false, reason:'target-missing'}- the pre-run target sha is no longer in the history
233	 *   - { ok:false, status }                - a mid-flow refusal reading versions / restoring
234	 */
235	export async function guardedRollback({ fetchImpl, appId, token, preRunSha, expectedHeadSha }) {
236	  const cur = await readVersions({ fetchImpl, appId, token });
237	  if (!cur.ok) return { ok: false, status: cur.status };
238	  // HEAD must still be the exact head this edit produced - else a concurrent change moved it.
239	  if (cur.head !== expectedHeadSha) return { ok: false, reason: 'head-advanced' };
240	  // The pre-run target must still exist (hardening: never restore to a sha the history dropped).
241	  const hasTarget = Array.isArray(cur.items) && cur.items.some((v) => v && v.sha === preRunSha);
242	  if (!hasTarget) return { ok: false, reason: 'target-missing' };
243	  return rollbackToVersion({ fetchImpl, appId, token, sha: preRunSha });
244	}
245	
246	/**
247	 * Consume the job SSE stream with fetch, forwarding each JobEvent to `onEvent`, and
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


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The live journey outputs are coherent so far: the detection, follow-up build, request filing, and convert flows all exercised the expected gates. I’m now checking the remaining seams that could still drift at block level: boot-time activation loading, the builder migration, and the assistant’s owner-org grounding path.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph node api/src/auth/users-service.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "codegraph explore 'runAppAssistant buildGroundingBlock owner org context.orgId resolved owner orgId app assistant cross org isolation'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/server.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/auth/capabilities.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 156ms:
**api/src/auth/users-service.ts** — 106 lines, 6 symbols · used by 2 files: api/tests/auth/role-migration.test.ts, api/src/server.ts

1	/**
2	 * Users-management service (ch03 §3.8.2). Owns the `users`/`orgs` store access for the
3	 * users router — routes/ never touches data/ directly (ch02 §2.7). super-admin is
4	 * platform-wide; org-admin is confined to its own org.
5	 */
6	import type { Actor } from '@ekoa/shared';
7	import { users, orgs, type UserDoc } from '../data/stores.js';
8	import { setActivation, bumpTokenEpoch, clearActivation } from '../data/activation.js';
9	import { hashPassword } from './password.js';
10	import { setUserActive, authUserView, type AuthUserView, type Deps } from './service.js';
11	
12	export type { AuthUserView };
13	
14	export async function listUsers(actor: Actor): Promise<AuthUserView[]> {
15	  const rows = actor.role === 'super-admin' ? await users.find({}) : await users.find({ orgId: actor.orgId });
16	  return rows.map(authUserView);
17	}
18	
19	export async function createUser(
20	  input: { username: string; password: string; role?: UserDoc['role']; orgId?: string },
21	  deps: Deps,
22	): Promise<{ ok: true; user: AuthUserView } | { ok: false; reason: 'taken' }> {
23	  let orgId = input.orgId;
24	  if (!orgId) {
25	    orgId = deps.genId();
26	    await orgs.insert({ _id: orgId, name: input.username, createdAt: new Date(deps.now()).toISOString() });
27	  }
28	  const id = deps.genId();
29	  const inserted = await users.insert({
30	    _id: id,
31	    username: input.username,
32	    passwordHash: await hashPassword(input.password),
33	    // H1: `user` is the base non-admin role and the default when a caller omits one (the HTTP
34	    // contract still requires `role` via CreateUserRequest; this default protects direct callers).
35	    role: input.role ?? 'user',
36	    orgId,
37	    active: true,
38	    passwordChangeRequired: true,
39	  });
40	  if (!inserted) return { ok: false, reason: 'taken' };
41	  setActivation(id, { active: true, billingLocked: false });
42	  return { ok: true, user: authUserView((await users.get(id)) as UserDoc) };
43	}
44	
45	export async function getUser(id: string): Promise<UserDoc | null> {
46	  return users.get(id);
47	}
48	
49	export async function patchUser(
50	  actor: Actor,
51	  target: UserDoc,
52	  patch: { role?: UserDoc['role']; active?: boolean },
53	  deps: Deps,
54	): Promise<AuthUserView> {
55	  if (patch.role && patch.role !== target.role) {
56	    // A role change invalidates the user's outstanding tokens: bump the token epoch (real
57	    // JWT-iat clock, strictly after any token minted this second) so a demoted admin cannot
58	    // keep using a stale privileged JWT (ch09 §9.6). The user re-logs in with the new role.
59	    // The epoch is persisted in the SAME store write as the role and mirrored to the in-memory
60	    // map (H1 durability) — without the row write a restart would re-admit the demoted admin's
61	    // old org-admin JWT.
62	    const epochSec = Math.floor(Date.now() / 1000) + 1;
63	    await users.update(target._id, (u) => ({ ...u, role: patch.role as UserDoc['role'], tokenEpoch: epochSec }));
64	    bumpTokenEpoch(target._id, epochSec);
65	  }
66	  if (patch.active !== undefined) await setUserActive(target._id, patch.active, [], deps);
67	  return authUserView((await users.get(target._id)) as UserDoc);
68	}
69	
70	/**
71	 * Delete a user AND drop their activation entry in the same operation (ch09 §9.7.1 write-through).
72	 * Without the clear, `getActivation` keeps returning the stale `{active:true}` row, so a deleted
73	 * account's outstanding tokens stay admissible to their JWT expiry — and with `/auth/refresh`
74	 * mounted (F1) an attacker holding one could re-sign it indefinitely: an unbounded session for a
75	 * deleted account. Clearing the entry makes every admission plane fail closed immediately.
76	 */
77	export async function deleteUser(id: string): Promise<boolean> {
78	  const ok = await users.delete(id);
79	  if (ok) clearActivation(id);
80	  return ok;
81	}
82	
83	/**
84	 * H1 role rename `builder` → `user`: an idempotent boot-step migration (the repo has no migration
85	 * framework — schema/data evolution rides idempotent steps in `bootState`, ch09 §9.7). Every user
86	 * row still carrying the retired `builder` role is rewritten to `user` and its token epoch bumped,
87	 * reusing the exact role-change revocation path (`patchUser`): a bumped epoch invalidates every
88	 * outstanding legacy JWT (its `iat < epoch`), forcing a re-login that mints a `user` token. Runs
89	 * AFTER `loadActivation` so the epoch bump lands in the freshly-loaded in-memory map. Idempotent:
90	 * once no row carries `builder`, the query matches nothing and nothing is bumped. Returns the count
91	 * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
92	 * no longer in the Role type, so it is a string filter (the store's `find` takes `Record<string,
93	 * unknown>`); the update writes the current `user` value. */
94	export async function migrateBuilderRole(): Promise<number> {
95	  const legacy = await users.find({ role: 'builder' });
96	  const epochSec = Math.floor(Date.now() / 1000) + 1;
97	  for (const u of legacy) {
98	    // Persist the rewritten role AND the bumped epoch in one store write (H1 durability): the
99	    // legacy-JWT invalidation must survive restart, or a re-boot after the migration would re-admit
100	    // outstanding `builder` tokens (their iat < epoch is only enforced while the epoch is loaded).
101	    await users.update(u._id, (doc) => ({ ...doc, role: 'user', tokenEpoch: epochSec }));
102	    bumpTokenEpoch(u._id, epochSec);
103	  }
104	  return legacy.length;
105	}
106	

 succeeded in 151ms:
**api/src/server.ts** — 771 lines, 54 symbols · used by 2 files: api/tests/contract/change-requests.test.ts, api/tests/routes/change-requests.test.ts

1	/**
2	 * server.ts — the composition root (ch02 §2.6). Builds the Express app, mounts routers,
3	 * wires the injected seams (ch02 §2.8), and runs boot. The only file allowed to import
4	 * everything. This is the G0 skeleton: config boot gate + /health; domain routers mount
5	 * as their phases land.
6	 *
7	 * Carried boot behaviors (ch02 §2.6):
8	 *  - fail-closed config validation (ch09 §9.7): missing ENCRYPTION_KEY / JWT_SECRET refuses boot.
9	 *  - process-level exception posture: uncaughtException/unhandledRejection log and continue.
10	 */
11	import { randomUUID } from 'node:crypto';
12	import { readFile } from 'node:fs/promises';
13	import { mkdirSync } from 'node:fs';
14	import { pathToFileURL } from 'node:url';
15	import express, { type Express, type NextFunction, type Request, type Response } from 'express';
16	import { loadConfig, type Config } from './config.js';
17	import { securityHeaders } from './security-headers.js';
18	import { connectMongo } from './data/mongo.js';
19	import { users } from './data/stores.js';
20	import { CollectionsEngine, sharedScope } from './data/collections-engine.js';
21	import { loadActivation } from './data/activation.js';
22	import { loadRevocations } from './auth/revocation.js';
23	import { seedAdmin } from './auth/service.js';
24	import { migrateBuilderRole } from './auth/users-service.js';
25	import { sendError } from './routes/helpers.js';
26	import { authRouter } from './routes/auth.js';
27	import { usersRouter } from './routes/users.js';
28	import { orgRouter, orgsRouter } from './routes/org.js';
29	import { brandingRouter } from './routes/branding.js';
30	import { settingsRouter } from './routes/settings.js';
31	import { sessionsRouter } from './routes/sessions.js';
32	import { memoriesRouter } from './routes/memories.js';
33	import { registoRouter } from './routes/registo.js';
34	import { changeRequestsRouter } from './routes/change-requests.js';
35	import { billingRouter } from './routes/billing.js';
36	import { credentialsRouter } from './routes/credentials.js';
37	import { llmHealth, registerGateway, loadCredential, setRulesetResolver } from './llm/index.js';
38	import { setUsageNotifier } from './billing/index.js';
39	import { integrationsRouter } from './routes/integrations.js';
40	import { integrationBuilderRouter } from './routes/integration-builder.js';
41	import { knowledgeRouter } from './routes/knowledge.js';
42	import { triggersRouter } from './routes/triggers.js';
43	import { hooksRouter } from './routes/hooks.js';
44	import { notificationsRouter } from './routes/notifications.js';
45	import { sseManager } from './events/sse-manager.js';
46	import { startDelivery, stopDelivery } from './events/delivery.js';
47	import { attachCanvasServer } from './streaming/index.js';
48	import { attachBridgeServer, bufferLedgerRow, delegateToLocal, rowsForSession } from './bridge/index.js';
49	import { maskedCountsForCorrelations } from './services/platform-crud.js';
50	import { bridgeTokenRouter } from './routes/bridge.js';
51	import { servedDataRouter } from './apps/served-data.js';
52	import { appAssistantRouter } from './apps/app-assistant-route.js';
53	import { devServeRouter } from './apps/dev-serve.js';
54	import { servingRouter } from './apps/serving.js';
55	import { appRegistry } from './apps/app-registry.js';
56	import { appBuilder } from './apps/builder.js';
57	import { loadSlugIndex } from './apps/slug-index.js';
58	import { seedFeaturedArtifacts } from './apps/featured-seeder.js';
59	import { buildAndRegisterFeaturedArtifacts } from './apps/featured-builder.js';
60	import { resolveApp } from './apps/registry.js';
61	import { appFilesRouter } from './apps/app-files.js';
62	import { buildLinkRouter } from './apps/build-link.js';
63	import { appSsoRouter } from './integrations/app-sso.js';
64	import { m365ProxyRouter } from './integrations/m365-proxy.js';
65	import { appCloudFilesRouter } from './integrations/app-cloud-files.js';
66	import { adobeSignRouter } from './integrations/adobe-sign.js';
67	import type { ResolveAppScope } from './integrations/app-scope.js';
68	import { legalRouter } from './legal/router.js';
69	import { designTokensHandler } from './services/design-tokens.js';
70	import { getArtifactScreenshotDir } from './services/artifact-screenshot.js';
71	import { appPdfRouter, getArtifactPdfDir } from './apps/pdf.js';
72	import { getBrandAssetsDir } from './services/branding/index.js';
73	import { companySpaceRouter } from './routes/company-space.js';
74	import { verifyToken } from './auth/jwt.js';
75	import { artifactsRouter } from './routes/artifacts.js';
76	// G7B — agent execution (ch05 + ch08): chat/job routers, the injected agent seams, and the
77	// boot obligations (content ingest, knowledge backfill, orphan sweep).
78	import { chatRouter } from './routes/chat.js';
79	import { jobsRouter } from './routes/jobs.js';
80	import {
81	  setAssembleAgentContext,
82	  setKnowledgeGrounding,
83	  setIngestBuildKnowledge,
84	  setKnowledgeToolSearch,
85	  setKnowledgeToolRead,
86	  setLoadContextContent,
87	  setDelegateToLocal,
88	  setLocalActivitySources,
89	  setVerifyRunner,
90	  setBuildMechanics,
91	  setIntegrationPrefetch,
92	  setCatalog,
93	  sweepOrphans,
94	} from './agents/index.js';
95	import { assembleAgentContext, bootContentLoader, composeContext, configureContentLoader } from './content/index.js';
96	import { backfillKnowledgeIndex, buildGroundingBlock, ingestDocument, searchKnowledgeIndex, readDocWithShared } from './knowledge/index.js';
97	// G8 — automation engine + integrations execution layer + delivery targets + canvas.
98	import { automationsRouter } from './routes/automations.js';
99	import { platformIntegrationsRouter, oauthCallbackRouter } from './routes/platform-integrations.js';
100	import { pipedreamRouter } from './routes/pipedream.js';
101	import {
102	  setRunEventEmitterFactory,
103	  setIntegrationActionExecutor,
104	  setPlatformIntegrationCaller,
105	  setIntegrationCredentialLoader,
106	  setScopedMemoryResolver,
107	  setAppDataStore,
108	  setArtifactResolver,
109	  setCatalogSources,
110	  setLocalBrowserContextProvider,
111	  setAutomationContentSections,
112	  startRunForTrigger,
113	  runAutomationForAction,
114	  buildAutomationCatalog,
115	  formatCatalogForPrompt,
116	  automationStepEventPayload,
117	  automationRunsRoot,
118	  type RunEventEmitter,
119	} from './automation/index.js';
120	import {
121	  executeUserIntegrationAction,
122	  callPlatformIntegration,
123	  findConfigForOwner,
124	  integrationPrefetch,
125	  integrationSkillMd,
126	  listDefinitions,
127	  getDefinition,
128	} from './integrations/index.js';
129	import { invokeArtifactBackend } from './apps/backend-runtime/index.js';
130	import { getArtifactById, projectDirFor } from './apps/app-paths.js';
131	import { listVisibleMemories } from './memory/index.js';
132	import { getSharedBrowser } from './services/browser-pool.js';
133	import { setDeliveryTargets } from './events/delivery.js';
134	import { decrypt } from './data/crypto.js';
135	import { verifyRunner } from './apps/verify-runner.js';
136	import { createBuildMechanics } from './apps/build-mechanics.js';
137	import { logActivity } from './data/activity.js';
138	import { denyListRulesetFieldsFor } from './services/deny-list.js';
139	
140	export interface RuntimeDeps {
141	  now: () => number;
142	  genId: () => string;
143	}
144	
145	/**
146	 * Adapt the automation engine's RunEventEmitter callback seam onto the AutomationRunEvent wire
147	 * union (§3.6.3) on the 'automation' SSE stream. Every payload matches shared/events.ts; the
148	 * engine itself never imports events/ (ch02 §2.8 — the seam the old engine already had, B7).
149	 */
150	function makeRunSseEmitter(runId: string): RunEventEmitter {
151	  const emit = (type: string, data: object): void => {
152	    try {
153	      sseManager.emit('automation', runId, type, data);
154	    } catch (err) {
155	      console.warn('[automation-sse] emit failed:', err instanceof Error ? err.message : err);
156	    }
157	  };
158	  return {
159	    // Forward the StepRecord enrichment (screenshot URL, tier, one-line error, output, duration) so
160	    // the run UI renders a step's outcome without a follow-up fetch. Mapping lives in automation/
161	    // (unit-tested) — this stays a thin emit.
162	    stepUpdate: (record, id) => emit('step', automationStepEventPayload(record, id)),
163	    runComplete: (_id, _durationMs, summary) => emit('complete', { summary }),
164	    runError: (_id, error) => emit('error', { code: 'AUTOMATION_FAILED', message: error }),
165	    runPaused: (_id, _reason, service) => emit('paused', { service }),
166	    runPatch: (_id, info) => emit('patch', { patch: { ...info } }),
167	    runPauseForUser: (_id, info) => emit('pause_for_user', {
168	      stepIndex: info.stepIndex,
169	      reasoning: info.reasoning,
170	      userInstructions: info.userInstructions,
171	      ...(info.failureMessage ? { failureMessage: info.failureMessage } : {}),
172	      ...(info.screenshotUrl ? { screenshotUrl: info.screenshotUrl } : {}),
173	    }),
174	    runResumed: () => emit('resumed', {}),
175	    runStreamingAvailable: (_id, info) => emit('streaming_available', { token: info.token, wsUrl: info.wsUrl, viewport: info.viewport }),
176	    runAwaitingConsent: (_id, info) => emit('awaiting_consent', { stepIndex: info.stepIndex, shape: info.shape, argv: info.argv, description: info.description }),
177	    runAwaitingDaemon: (_id, info) => emit('awaiting_daemon', { stepIndex: info.stepIndex, capability: info.capability, reason: info.reason }),
178	    runOutputChunk: (_id, info) => emit('step_output_chunk', { stepIndex: info.stepIndex, stream: info.stream, chunk: info.chunk }),
179	  };
180	}
181	
182	const defaultDeps: RuntimeDeps = { now: () => Date.now(), genId: () => randomUUID() };
183	
184	/** The usage push (§6.7): a bare `usage_updated` poke on the billee's notifications channel,
185	 *  fired once per ledger write (ch03 §3.6.4). Best-effort — a push failure NEVER fails the
186	 *  metering/turn (fire-and-forget with error log; the tracker also guards the call). */
187	export function usageUpdatedNotifier(userId: string): void {
188	  if (!userId) return;
189	  try {
190	    sseManager.emit('notifications', userId, 'usage_updated', {});
191	  } catch (err) {
192	    console.warn('[billing] usage_updated push failed:', err instanceof Error ? err.message : err);
193	  }
194	}
195	
196	export function buildApp(config: Config, deps: RuntimeDeps = defaultDeps): Express {
197	  const app = express();
198	  app.set('env', config.nodeEnv);
199	  app.disable('x-powered-by');
200	
201	  // Security-headers baseline (ch09 §9.8 D1, FIXED-14) — before any route so every response
202	  // (JSON API + served-app plane) inherits nosniff/HSTS/referrer + a surface-appropriate CSP
203	  // and frame policy. A served-app handler may override before emit.
204	  app.use(securityHeaders);
205	
206	  // Usage push seam (§6.7, ch02 §2.8 seam 1): billing/ never imports events/, so the composition
207	  // root injects the notifier that pushes `usage_updated` on the billee's notifications channel.
208	  setUsageNotifier(usageUpdatedNotifier);
209	
210	  // G7B — agent-execution seams (ch02 §2.8, ch05 §5.5/§5.6.2). agents/ codes against typed seams;
211	  // the composition root binds the real collaborators (structural binding is where the shapes are
212	  // checked). server.ts is the only file that may reach across these seams.
213	  setAssembleAgentContext(assembleAgentContext); // content loader (ch08 §8.3.2, ch05 §5.5.1)
214	  // The automation planner's eager content sections ride the same loader (automation/ may not
215	  // import content/ — this seam is its one route to the composed package).
216	  setAutomationContentSections(async (userId) => (await assembleAgentContext({ agentKind: 'automation', userId })).promptSections);
217	  // Knowledge grounding (ch08 §8.4 slot 5): buildGroundingBlock already applies the chat-always /
218	  // build-only-legal rule internally, so the adapter only maps agentKind → its chat|build kind.
219	  setKnowledgeGrounding(async ({ orgId, query, agentKind }) =>
220	    buildGroundingBlock({ orgId, query, kind: agentKind === 'chat' ? 'chat' : 'build' }).block,
221	  );
222	  // F1 knowledge-during-build: the mid-build ingest seam. The orgId rides the run's actor (org
223	  // partitioning is structural, not a request argument); ingestDocument refuses the reserved
224	  // _shared partition and indexes the doc immediately, so a scoping-provided doc is searchable to
225	  // the same run's knowledge tools. sourceType marks it build-originated.
226	  setIngestBuildKnowledge(async (actor, doc, deps) =>
227	    ingestDocument(
228	      actor,
229	      {
230	        collection: doc.collection,
231	        title: doc.title,
232	        text: doc.text,
233	        sourceType: doc.sourceType ?? 'build-scoping',
234	        ...(doc.language ? { language: doc.language } : {}),
235	      },
236	      deps,
237	    ),
238	  );
239	  setVerifyRunner(verifyRunner); // per-build verification (ch07 §7.2.6)
240	  setBuildMechanics(createBuildMechanics(deps)); // the G6 build pipeline (ch07 §7.2-§7.4)
241	  // Anonymisation ruleset resolver (ch17 §17.7; F10): every egress request resolves the org's
242	  // ruleset through this seam — the store-backed loader hands the anonymiser the org's
243	  // deny-list as org-scoped ciphertext, so decryption stays on the pipeline's access-logged
244	  // path. Without this wiring every org ran the default EMPTY deny-list.
245	  setRulesetResolver(async (orgId) => ({ orgId, ...(await denyListRulesetFieldsFor(orgId)) }));
246	  // The §5.4.4 in-process knowledge tools: org partitioning rides the seam signature — the
247	  // orgId reaches these from the run's actor, never from tool arguments (agents/sdk-tools.ts).
248	  setKnowledgeToolSearch(async ({ orgId, query, limit }) =>
249	    searchKnowledgeIndex(orgId, query, limit).map((h) => ({
250	      docId: h.docId,
251	      collection: h.collection,
252	      title: h.title,
253	      sourceUrl: h.sourceUrl ?? '',
254	      snip: h.snippet,
255	    })),
256	  );
257	  setKnowledgeToolRead(async ({ orgId, collection, docId }) => {
258	    const doc = await readDocWithShared(orgId, collection, docId);
259	    return doc ? { title: doc.fm.title, sourceUrl: doc.fm.sourceUrl ?? '', body: doc.body } : null;
260	  });
261	  // The build-run `load_context` tool (§5.4.4): a named on-demand file from the user's composed
262	  // context. The name matches against the loader's OWN returned file list (never a joined path),
263	  // so the tool argument cannot traverse; frontmatter strips like the eager prompt sections.
264	  setLoadContextContent(async ({ userId, agentKind, name }) => {
265	    const stripFrontmatter = (raw: string): string => {
266	      if (!raw.startsWith('---')) return raw;
267	      const end = raw.indexOf('\n---', 3);
268	      if (end === -1) return raw;
269	      const after = raw.indexOf('\n', end + 1);
270	      return after === -1 ? '' : raw.slice(after + 1).replace(/^\n+/, '');
271	    };
272	    const composed = await composeContext(userId, agentKind);
273	    const file = composed.onDemandFiles.find((f) => {
274	      const base = f.replace(/\\/g, '/').split('/').pop() ?? '';
275	      return base === name || base.replace(/\.[^.]+$/, '') === name;
276	    });
277	    if (file) return stripFrontmatter(await readFile(file, 'utf8'));
278	    // Fallback: `integration-<key>` resolves to the integration package's knowledge SKILL.md
279	    // when the caller's org has that integration configured (on-demand — zero eager tokens).
280	    // The key is validated against the definitions registry before any filesystem read.
281	    const m = /^integration-([a-z0-9][a-z0-9-]*)$/.exec(name);
282	    if (m) {
283	      const key = m[1]!;
284	      const user = (await users.get(userId)) as { orgId?: string } | null;
285	      const cfg = user?.orgId ? await findConfigForOwner(user.orgId, userId, key) : null;
286	      if (cfg && (cfg as { enabled?: boolean }).enabled !== false) {
287	        const raw = integrationSkillMd(key);
288	        if (raw) return stripFrontmatter(raw);
289	      }
290	    }
291	    return null;
292	  });
293	  // ch05 §5.4.8 / ch18 §18.2 — the hosted delegate_to_local tool: chat/build runs delegate local
294	  // file work to the user's paired daemon over the bridge. org + pairing resolve from the live
295	  // registry inside the bridge tool (never from tool arguments); the result is derived output
296	  // only, and offline is an honest `unreachable` (never an upload).
297	  setDelegateToLocal((actor, req) => delegateToLocal(actor, req));
298	  // FC-402 (run s5, D3) — the trust chip's two joins: buffered daemon ledger rows (bytes/files)
299	  // and the anon-audit mask counts by correlation id (§17.6). Both reads, no persistence.
300	  setLocalActivitySources({
301	    ledgerRows: (session, correlationIds) => rowsForSession(session, correlationIds),
302	    maskedCounts: (orgId, correlationIds) => maskedCountsForCorrelations(orgId, correlationIds),
303	  });
304	  // G8 — the §5.5.2 chat grounding seams land: live integration pre-fetch (layer 3) and the
305	  // cross-agent automation/integration catalog (layer 4).
306	  setIntegrationPrefetch(integrationPrefetch);
307	  setCatalog(async ({ userId, orgId }) => {
308	    void orgId; // catalog visibility is user-keyed; org scoping rides the underlying stores
309	    try {
310	      const catalog = await buildAutomationCatalog(userId, false);
311	      return formatCatalogForPrompt(catalog);
312	    } catch {
313	      return ''; // catalog failures are non-fatal (§5.5.2 layer 4)
314	    }
315	  });
316	
317	  // G8 — automation engine seams (ch02 §2.8; automation/ may not import events/, apps/ or the
318	  // composition surfaces directly, so the root binds every collaborator).
319	  // 1. Run events → the automation SSE stream (§3.6.3): the emitter factory adapts the engine's
320	  //    callback seam onto the AutomationRunEvent wire union, replayable via Last-Event-ID.
321	  setRunEventEmitterFactory((runId) => makeRunSseEmitter(runId));
322	  // 2. Integration action execution (user-defined skills; §5.6.7 integration steps).
323	  setIntegrationActionExecutor(async (call) => {
324	    const owner = (await users.get(call.ownerUserId)) as { orgId?: string } | null;
325	    const r = await executeUserIntegrationAction(
326	      {
327	        orgId: owner?.orgId ?? '',
328	        ownerUserId: call.ownerUserId,
329	        integrationKey: call.integrationKey,
330	        actionName: call.actionName,
331	        args: call.args,
332	      },
333	      {
334	        // integração-por-automação (carried B25): an automationBinding action runs the bound
335	        // automation under the verified owner; integrations/ never imports automation/ (tiers).
336	        runAutomationBackedAction: async (b) => {
337	          const out = await runAutomationForAction({
338	            binding: b.binding as { automationId: string; argMap?: Record<string, string>; passCredentials?: boolean },
339	            args: b.args,
340	            credentialFields: b.credentialFields,
341	            orgId: b.orgId,
342	            ownerUserId: b.ownerUserId,
343	          });
344	          return { success: out.success, ...(out.code ? { code: out.code } : {}), ...(out.error ? { error: out.error } : {}), ...(out.data !== undefined ? { data: out.data } : {}) };
345	        },
346	      },
347	    );
348	    return { success: r.success, data: r.data, error: r.error, details: r.code };
349	  });
350	  // 3. Platform integrations (Google/Microsoft) behind automation + listener steps.
351	  setPlatformIntegrationCaller(async (call, pactor) => {
352	    const owner = (await users.get(pactor.userId)) as { orgId?: string } | null;
353	    const r = await callPlatformIntegration(
354	      { orgId: owner?.orgId ?? '', integrationKey: call.integrationKey, actionName: call.actionName, args: call.args },
355	      { now: deps.now, genId: deps.genId },
356	    );
357	    return { success: r.success, data: r.data, error: r.error };
358	  });
359	  // 4. Decrypted credential fields for api_call auth injection (encrypted at rest, ch09).
360	  setIntegrationCredentialLoader(async (integrationKey, ownerUserId) => {
361	    const owner = (await users.get(ownerUserId)) as { orgId?: string } | null;
362	    if (!owner?.orgId) return null;
363	    const cfg = await findConfigForOwner(owner.orgId, ownerUserId, integrationKey);
364	    if (!cfg?.credentialsCiphertext) return null;
365	    try {
366	      const values = JSON.parse(decrypt(cfg.credentialsCiphertext)) as Record<string, unknown>;
367	      return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
368	    } catch {
369	      return null;
370	    }
371	  });
372	  // 5. Automation-scoped memory snippets for vision prompts (correction memories, §11.6).
373	  setScopedMemoryResolver(async (q) => {
374	    const all = await listVisibleMemories({ userId: q.ownerUserId, orgId: q.orgId, role: 'user' });
375	    const tag = `automation:${q.automationId}`;
376	    return all
377	      .filter((m) => (m.tags ?? []).includes(tag) && typeof m.content === 'string')
378	      .slice(0, q.maxMemories)
379	      .map((m) => m.content as string);
380	  });
381	  // 6. App-data collections behind ekoa_action steps (the served-app shared plane, G6).
382	  const automationAppData = new CollectionsEngine(deps);
383	  const appScopeOf = async (artifactId: string) => {
384	    const art = await getArtifactById(artifactId);
385	    return sharedScope(artifactId, (art?.userId as string | undefined) ?? '');
386	  };
387	  setAppDataStore({
388	    list: async (a, c) => automationAppData.list(await appScopeOf(a), c),
389	    get: async (a, c, id) => automationAppData.get(await appScopeOf(a), c, id),
390	    create: async (a, c, data) => (await automationAppData.create(await appScopeOf(a), c, data)) as { id: string } & Record<string, unknown>,
391	    update: async (a, c, id, patch) => automationAppData.upsert(await appScopeOf(a), c, id, patch),
392	    delete: async (a, c, id) => automationAppData.delete(await appScopeOf(a), c, id),
393	  });
394	  // 7. Artifact resolution for ekoa_action target apps (slug or id → project dir, jailed), ORG-
395	  //    SCOPED to the run: a cross-org artifact is refused, so an ekoa_action step can never resolve
396	  //    and execute another org's capability against its app-data (Codex G8).
397	  setArtifactResolver(async (slugOrId, requesterOrgId) => {
398	    const resolved = await resolveApp(slugOrId);
399	    if (!resolved || !resolved.artifactBacked) return null;
400	    const art = await getArtifactById(resolved.appId);
401	    if (!art || art.orgId !== requesterOrgId) return null;
402	    return { artifactId: resolved.appId, projectDir: projectDirFor(art) };
403	  });
404	  // 8. Catalog sources: integration definitions feed skills; connected platform accounts and
405	  //    artifact (ekoa_action) capabilities keep honest empties this gate — the seam carries no
406	  //    org context for accounts and no MANIFEST-capability surface exists yet (G9 note).
407	  setCatalogSources({
408	    getVisibleSkills: () =>
409	      listDefinitions().map((d) => ({
410	        integrationKey: d.integrationKey,
411	        actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
412	      })),
413	    getSkill: (integrationKey) => {
414	      const d = getDefinition(integrationKey);
415	      return d
416	        ? {
417	            integrationKey: d.integrationKey,
418	            actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
419	          }
420	        : undefined;
421	    },
422	    getConnectedPlatformAccounts: async () => [],
423	    listEkoaActions: async () => [],
424	  });
425	  // 9. The in-process local browser for browser-step automations (services/ shared pool).
426	  setLocalBrowserContextProvider(async () => {
427	    const browser = await getSharedBrowser();
428	    return browser.newContext();
429	  });
430	  // (setDaemonConnectionResolver stays on its honest default — the bridge lands at G8A.)
431	
432	  // G8 — trigger delivery targets (ch02 §2.8: injected callbacks, never upward imports).
433	  setDeliveryTargets({
434	    startAutomationRun: async (automationId, event) => {
435	      const outcome = await startRunForTrigger({
436	        automationId,
437	        // Server-trusted owner from the trigger record, NEVER the inbound payload (§5.6.7).
438	        ownerUserId: event.trigger.ownerUserId,
439	        orgId: event.trigger.orgId,
440	        triggeredBy: 'webhook',
441	        event: {
442	          triggerId: event.trigger._id,
443	          integrationKey: event.trigger.integrationKey,
444	          eventName: event.trigger.eventName,
445	          receivedAt: new Date(deps.now()).toISOString(),
446	          payload: event.payload,
447	          rawHeaders: {},
448	        },
449	      });
450	      if (outcome.outcome === 'completed') return { ok: true };
451	      return { ok: false, reason: `run ended ${outcome.outcome}`, ...(outcome.permanent ? { permanent: true } : {}) };
452	    },
453	    invokeArtifactBackend: async (artifactId, entrypoint, event) => {
454	      // Delivery-side cross-org guard (Codex G8, defense-in-depth alongside the trigger-creation
455	      // check): the runtime resolves the artifact by raw id, so verify HERE that the target belongs
456	      // to the trigger owner's org before invoking. A foreign/unknown artifact is a permanent
457	      // failure — never executed, never retried.
458	      const art = await getArtifactById(artifactId);
459	      if (!art || art.orgId !== event.trigger.orgId) {
460	        return { ok: false, reason: 'artifact not in the trigger owner org', permanent: true };
461	      }
462	      try {
463	        const result = await invokeArtifactBackend(artifactId, entrypoint, {
464	          event: event.payload,
465	          trigger: { id: event.trigger._id, eventName: event.trigger.eventName },
466	        });
467	        return result.ok ? { ok: true } : { ok: false, reason: result.error ?? 'backend handler reported failure' };
468	      } catch (err) {
469	        return { ok: false, reason: err instanceof Error ? err.message : 'backend invoke failed' };
470	      }
471	    },
472	  });
473	
474	  // content/ audit write path (FIXED-8, ch08): the loader reaches data/ logActivity ONLY through
475	  // this injected seam, wired BEFORE boot ingest. Fire-and-forget — an audit hiccup never blocks
476	  // content IO.
477	  configureContentLoader({
478	    audit: ({ type, metadata }) => {
479	      void logActivity({ userId: 'system', username: 'system', orgId: '' }, 'execute', type, deps, metadata).catch(() => undefined);
480	    },
481	  });
482	
483	  // Webhook ingress mounts FIRST with its own raw-body parser, BELOW/BEFORE the JSON parser,
484	  // so the HMAC verifier sees unmodified bytes (ch09 invariant 9 step 6).
485	  app.use('/hooks', hooksRouter(deps));
486	
487	  // Injected app-scope seam (ch02 §2.7): integrations/ never imports apps/, so the
488	  // composition root builds the header->canonical-app resolver from apps/ internals.
489	  // Byte-compat: the served-app planes are key-value by app id (the old plane never
490	  // required the app to exist), so a charset-valid id ALWAYS resolves to a scope; an
491	  // artifact/registry hit fills the owner + served facts, an unregistered dev id gets
492	  // an empty owner (its owner-activation admission then has no subject - see
493	  // checkOwnerActivation). The Q-10 workspace m365 proxy gates on `isServed` +
494	  // `m365Proxy` separately, so an unregistered id can never reach the workspace token.
495	  const APP_ID_CHARSET = /^[a-zA-Z0-9._-]{1,100}$/;
496	  const resolveAppScope: ResolveAppScope = async (idOrSlug) => {
497	    if (!APP_ID_CHARSET.test(idOrSlug) || idOrSlug.startsWith('usr.')) return null;
498	    const appRow = await resolveApp(idOrSlug);
499	    const appId = appRow?.appId ?? idOrSlug;
500	    const reg = appRegistry.getApp(appId);
501	    return {
502	      appId,
503	      ownerUserId: appRow?.artifactBacked ? appRow.ownerUserId : '',
504	      isServed: !!reg,
505	      m365Proxy: (reg?.manifest as { m365Proxy?: boolean } | null)?.m365Proxy === true,
506	    };
507	  };
508	  // Workspace-credential seams (ch06/G8 territory): until the platform-integrations
509	  // credential store lands, the workspace planes surface the honest not-connected state.
510	  const workspaceNotConnected = (what: string) => async (): Promise<never> => {
511	    throw Object.assign(new Error(`${what} is not connected`), { code: 'not_connected' });
512	  };
513	
514	  // Raw-body served-app planes mount BEFORE the global JSON parser: their proxied/
515	  // uploaded bytes must arrive unconsumed (each carries its own per-route parsers).
516	  app.use('/api/m365', m365ProxyRouter({ resolveAppScope, getWorkspaceGraphToken: workspaceNotConnected('Microsoft workspace integration'), verifyToken }));
517	  app.use('/api/app-cloud-files', appCloudFilesRouter({
518	    resolveAppScope,
519	    getStatus: async () => ({ google: { connected: false, needsReauth: false }, microsoft: { connected: false, needsReauth: false } }),
520	    getAccessToken: workspaceNotConnected('Workspace cloud storage'),
521	  }));
522	  app.use('/api/app-files', appFilesRouter());
523	  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope }));
524	
525	  app.use(express.json({ limit: '1mb' }));
526	  // Body-parser failures (malformed JSON, over-limit payloads) must speak the CONV-2 envelope:
527	  // without this, Express's default handler returns an HTML page with the full stack trace and
528	  // absolute server paths — pre-auth, on every JSON route (2026-07-09 adversarial-test finding;
529	  // guarded by tests/contract/malformed-json.test.ts).
530	  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
531	    const e = err as { type?: string; status?: number } | null;
532	    if (e?.type === 'entity.too.large') { sendError(res, 'PAYLOAD_TOO_LARGE', 'Corpo do pedido demasiado grande.'); return; }
533	    if (e && typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
534	      sendError(res, 'VALIDATION_FAILED', 'Corpo do pedido inválido.');
535	      return;
536	    }
537	    next(err);
538	  });
539	
540	  // Public health surface (ch03 §3.8.23) — field shape carried; external watchdogs depend on it.
541	  // G7: the LLM-chokepoint slice (claudeAuth field carried verbatim as the watchdog contract,
542	  // §6.2.4; plus the metering-anomaly + gateway-unmetered counters, §6.3 rule 3 / §6.5.4).
543	  app.get('/health', (_req: Request, res: Response) => {
544	    const llm = llmHealth();
545	    res.json({
546	      ok: true,
547	      claudeAuth: llm.claudeAuth,
548	      meteringAnomalies: llm.meteringAnomalies,
549	      gatewayUnmeteredCalls: llm.gatewayUnmeteredCalls,
550	      clockSkewSec: 0,
551	      bridgeConnections: sseManager.connectionCount,
552	      pendingEvents: 0,
553	    });
554	  });
555	
556	  // Domain routers (mounted as their build phases land — G2 auth onward).
557	  app.use('/api/v1/auth', authRouter(deps));
558	  // G3 — platform CRUD domains.
559	  app.use('/api/v1/users', usersRouter(deps));
560	  app.use('/api/v1/org', orgRouter(deps));
561	  // F4: the contract branding paths (PUT /api/v1/branding + POST /api/v1/branding/research).
562	  app.use('/api/v1/branding', brandingRouter(deps));
563	  app.use('/api/v1/orgs', orgsRouter(deps));
564	  app.use('/api/v1/settings', settingsRouter(deps));
565	  app.use('/api/v1/sessions', sessionsRouter(deps));
566	  app.use('/api/v1/memories', memoriesRouter(deps));
567	  app.use('/api/v1/registo', registoRouter(deps));
568	  app.use('/api/v1/change-requests', changeRequestsRouter(deps));
569	  app.use('/api/v1/billing', billingRouter(deps));
570	  // F2 — model-credential provisioning (super-admin, write-only, audit-logged; ch06 §6.2).
571	  app.use('/api/v1/credentials', credentialsRouter(deps));
572	  // G7B — agent execution: chat runs + build/brand-research jobs (ch03 §3.8.7-8). The router
573	  // internal paths determine the surface: /api/v1/chat/runs, /api/v1/jobs.
574	  app.use('/api/v1/chat', chatRouter(deps));
575	  app.use('/api/v1/jobs', jobsRouter(deps));
576	  // G7 — the ekoa-local LLM gateway sub-app (ch03 §3.10; metering inside the chokepoint,
577	  // §6.5.4). Mounted at /api/v1/llm; the owner-bypass token verifier is injected (llm/ needs
578	  // no auth/ import — the gateway takes it as a dep). Bills wire-tier FAST per proxied call.
579	  registerGateway(app, { verifyToken });
580	  // G4 — integrations + knowledge.
581	  app.use('/api/v1/integrations', integrationsRouter(deps));
582	  // ch03 §3.8.14 — the AI integration builder (chat/load/save/test).
583	  app.use('/api/v1/integration-builder', integrationBuilderRouter(deps));
584	  app.use('/api/v1/knowledge', knowledgeRouter(deps));
585	  // G5 — push infrastructure + triggers.
586	  app.use('/api/v1/triggers', triggersRouter(deps));
587	  app.use('/api/v1/notifications', notificationsRouter());
588	  // G8 — automations (§3.8.18) + the platform-integration execution layer (§3.8.15/16).
589	  app.use('/api/v1/automations', automationsRouter());
590	  app.use('/api/v1/platform-integrations', platformIntegrationsRouter(deps));
591	  // The OAuth callback path is kept VERBATIM (§3.8.15): it is a registered redirect URI.
592	  app.use('/api/v1/oauth', oauthCallbackRouter(deps));
593	  app.use('/api/v1/pipedream', pipedreamRouter(deps));
594	  // G8A — the bridge token mint (ch18 §18.3.2, §3.10); the WS connect + provider endpoint are on
595	  // the bridge WS server attached at boot, not REST.
596	  app.use('/api/v1/bridge', bridgeTokenRouter());
597	  // G6 — artifacts (platform) + the byte-compatible served-app plane (outside /api/v1).
598	  app.use('/api/v1/artifacts', artifactsRouter(deps));
599	  app.use('/api/v1/company-space', companySpaceRouter(deps));
600	
601	  // F6: terminal JSON-404 for the platform API. Every non-2xx body must validate against the
602	  // shared error envelope (QA block); an unmounted /api/v1/* path previously fell through to
603	  // Express's default HTML 404, so clients that parse JSON got HTML. SCOPED TO /api/v1 on
604	  // purpose: the served-app data plane (/api/app-data, /api/app-shared), /api/design-tokens.css,
605	  // /api/m365 and the /apps/* SPA fallbacks own their own not-found behavior. It sits AFTER every
606	  // /api/v1 router, so a mounted route still answers (a 401 stays a 401, never a 404).
607	  app.use('/api/v1', (_req: Request, res: Response) => {
608	    sendError(res, 'NOT_FOUND', 'Não encontrado.');
609	  });
610	
611	  app.use('/api', servedDataRouter(deps));
612	  // Served-app assistant (operator-run D1): POST /api/app-assistant, header-scoped, runs under the
613	  // resolved artifact owner's org + billing through the llm/ chokepoint.
614	  app.use('/api', appAssistantRouter());
615	  // Legal vertical services + e-signature (full paths carried inside the routers).
616	  // The owner-spine seams read/write the app owner's SHARED collections (usr.<owner>)
617	  // through the collections engine - the same spine the app itself drives via
618	  // window.__ekoa.shared. legal/ may import data/, but the SCOPE derivation lives at
619	  // the composition root so the resolver stays the one injected seam.
620	  const legalEngine = new CollectionsEngine(deps);
621	  const spineScope = (a: { appId: string; ownerUserId: string }) => sharedScope(a.appId, a.ownerUserId);
622	  app.use('/', legalRouter({
623	    resolveApp: resolveAppScope,
624	    transcricao: {
625	      getRow: (a, coll, id) => legalEngine.get(spineScope(a), coll, id),
626	      updateRow: async (a, coll, id, patch) => { await legalEngine.upsert(spineScope(a), coll, id, patch); },
627	    },
628	    calculos: {
629	      getOverlay: (a) => legalEngine.list(spineScope(a), 'tabelas_taxas_overlay').catch(() => []),
630	      alarmeStore: {
631	        list: (scope, coll) => legalEngine.list({ scopeKey: scope, appId: scope }, coll),
632	        create: (scope, coll, data) => legalEngine.create({ scopeKey: scope, appId: scope }, coll, data),
633	      },
634	    },
635	  }));
636	  app.use('/', adobeSignRouter({ resolveApp: resolveAppScope }));
637	  app.get('/api/design-tokens.css', designTokensHandler());
638	  // Served-app document export (ch07 §7.12): window.__ekoa.exportPdf POSTs the serialized DOM
639	  // here; the rendered PDF is served from /artifact-pdfs below. Was never mounted in the port -
640	  // every in-app "Descarregar PDF" 404'd (caught live by the per-build verifier, 2026-07-11).
641	  app.use('/', appPdfRouter());
642	  mkdirSync(getArtifactPdfDir(), { recursive: true });
643	  app.use('/artifact-pdfs', express.static(getArtifactPdfDir(), { fallthrough: false }));
644	  // Artifact thumbnails (ch07 §7.11): PNGs captured post-build, served publicly. The dir is
645	  // pre-created so a fresh data dir serves clean 404s instead of an ENOENT from static().
646	  mkdirSync(getArtifactScreenshotDir(), { recursive: true });
647	  app.use('/artifact-screenshots', express.static(getArtifactScreenshotDir(), { fallthrough: false }));
648	  // Per-step automation screenshots (ch12): PNGs written per run at <dataDir>/automation-runs/
649	  // <automationId>/<runId>/step-N.png, served publicly as capability URLs (the unguessable

(lines 1–649 of 771 — pass `offset`/`limit` for another range, or `codegraph_node <symbol>` for one symbol in full)

 succeeded in 150ms:
**api/src/auth/capabilities.ts** — 41 lines, 2 symbols · used by 4 files: api/src/routes/artifacts.ts, api/src/routes/jobs.ts, api/src/apps/app-assistant-route.ts, api/tests/auth/capabilities.test.ts

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
41	

 succeeded in 502ms:
## Exploration: runAppAssistant buildGroundingBlock owner org context.orgId resolved owner orgId app assistant cross org isolation

Found 214 symbols across 106 files.

### Blast radius — what depends on these (update/verify before editing)

- `AppAssistantOwner` (api/src/apps/app-assistant.ts:37) — 1 caller in `api/src/apps/app-assistant.ts`; ⚠️ no covering tests found
- `ResolvedApp` (api/src/apps/registry.ts:11) — 5 callers in `api/src/apps/served-data.ts`, `api/src/apps/app-assistant-route.ts`, `api/src/apps/registry.ts`; ⚠️ no covering tests found
- `ResolvedAppScope` (api/src/integrations/app-scope.ts:17) — 7 callers in `api/src/integrations/app-scope.ts`; tests: `api/tests/contract/app-sso.test.ts`, `api/tests/security/destructive-action-authz.test.ts`
- `ResolvedLegalApp` (api/src/legal/access-gate.ts:68) — 7 callers in `api/src/legal/index.ts`, `api/src/legal/router.ts`, `api/src/legal/access-gate.ts`; tests: `api/tests/contract/legal-plane.test.ts`

### Relationships

**references:**
- AppAssistantInput → AppAssistantOwner
- AppAssistantInput → AppActionManifest
- buildSystemPrompt → AppAssistantInput
- runAppAssistant → AppAssistantInput
- UiActionsResult → AppActionManifest
- assistantToolsFromManifest → AppActionManifest
- manifest → AppActionManifest
- AssistantAdmission → AppActionManifest
- manifest → AppActionManifest
- buildSystemPrompt → AssistantToolDef
- ... and 91 more

**calls:**
- runAppAssistant → inferMode
- runAppAssistant → map
- runAppAssistant → renderPrompt
- runAppAssistant → extractActions
- appAssistantRouter → runAppAssistant
- ask → runAppAssistant
- resolveApp → getApp
- admitApp → resolveApp
- appFilesRouter → resolveApp
- requireLegalSuiteApp → status
- ... and 277 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/app-assistant.ts — LlmAttribution(references), references(references), calls(calls), map(calls), AppAssistantOwner(interface), AppAssistantInput(interface), AppAssistantOwner(references), AppActionManifest(references), AppAssistantDeps(interface), OneShotOptions(references), +14 more

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

... (gap) ...

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
292	
```

#### api/src/knowledge/grounding.ts — buildGroundingBlock(function), GroundingInput(interface), GroundingResult(interface)

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

#### shared/src/app-assistant.ts — AssistantChatContext(type_alias)

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


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I’ve verified the assistant grounds strictly on the resolved owner org. I’m pulling the boot sequence next, because the only remaining block-level concern there would be a restart or migration path that reopens a stale session after the route-level gates are otherwise correct.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"loadActivation\\(|migrateBuilderRole\\(|billingLocked|tokenEpoch|bootState|loadRevocations\" api/src/server.ts api/src/data/activation.ts api/src/data/stores.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/data/activation.ts:11:  billingLocked: boolean;
api/src/data/activation.ts:15:  tokenEpoch: number;
api/src/data/activation.ts:21:export function loadActivation(entries: Array<{ userId: string; active: boolean; billingLocked?: boolean; tokenEpoch?: number }>): void {
api/src/data/activation.ts:23:  for (const e of entries) map.set(e.userId, { active: e.active, billingLocked: e.billingLocked ?? false, tokenEpoch: e.tokenEpoch ?? 0 });
api/src/data/activation.ts:36:  const cur = map.get(userId) ?? { active: true, billingLocked: false, tokenEpoch: 0 };
api/src/data/activation.ts:37:  map.set(userId, { ...cur, tokenEpoch: epochSec });
api/src/data/activation.ts:41: *  `tokenEpoch` is preserved from the existing entry unless explicitly provided. */
api/src/data/activation.ts:42:export function setActivation(userId: string, state: { active: boolean; billingLocked: boolean; tokenEpoch?: number }): void {
api/src/data/activation.ts:44:  map.set(userId, { active: state.active, billingLocked: state.billingLocked, tokenEpoch: state.tokenEpoch ?? prev?.tokenEpoch ?? 0 });
api/src/data/stores.ts:22:  tokenEpoch?: number;
api/src/data/stores.ts:26:  billingLocked?: boolean;
api/src/server.ts:22:import { loadRevocations } from './auth/revocation.js';
api/src/server.ts:678:export async function bootState(deps: RuntimeDeps = defaultDeps): Promise<void> {
api/src/server.ts:681:  // Reload the FULL admission state per user, not just `active` (H1): the durable `tokenEpoch` and
api/src/server.ts:682:  // `billingLocked` columns must survive restart, or every revocation and every billing lock resets
api/src/server.ts:685:  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active, billingLocked: u.billingLocked, tokenEpoch: u.tokenEpoch })));
api/src/server.ts:688:  const migratedRoles = await migrateBuilderRole();
api/src/server.ts:690:  await loadRevocations(Math.floor(deps.now() / 1000));
api/src/server.ts:728:  bootState()

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph node api/src/data/activation.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/routes/chat.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph node api/src/agents/build.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 121ms:
**api/src/data/activation.ts** — 61 lines, 8 symbols · used by 135 files: api/src/memory/resolver.ts, api/src/routes/memories.ts, api/src/routes/sessions.ts, api/scripts/migrate/knowledge/importer.ts, api/src/agents/integration-builder.ts, api/src/agents/sdk-tools.ts, api/src/apps/builder.ts, api/src/apps/verify-runner.ts, +127 more

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
61	

 succeeded in 151ms:
**api/src/routes/chat.ts** — 73 lines, 1 symbol · used by 2 files: api/tests/contract/chat.test.ts, api/src/server.ts

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
73	

 succeeded in 124ms:
**api/src/agents/build.ts** — 634 lines, 14 symbols · used by 2 files: api/tests/agents/build.test.ts, api/src/routes/jobs.ts

1	/**
2	 * Build jobs (ch05 §5.6.2). The §5.2 pipeline plus build specifics: follow-up detection and the
3	 * in-build classifier (under the abort rules of §5.3.2), the first-build reservation (§5.3.3) and
4	 * the one-follow-up-per-artifact 409 (§5.3.5), routing floored at the expert tier, the inactivity
5	 * + wall-clock timers (§5.3.6), session resume via sdkSessionId persisted-only-when-changed
6	 * (§5.4.5), the completion sequence (§5.6.2 steps 1-8) including the per-build verification stage
7	 * (step 5, ch07 §7.2.6), the provider-error reroute (§5.3.7), the dual-fire guard (§5.3.4), and
8	 * the P-10 persistence + in-process zombie net.
9	 */
10	import type { Actor } from '@ekoa/shared';
11	import { loadAgentsConfig } from '../config.js';
12	import { checkAllowance } from '../billing/index.js';
13	import { BILLING_PAGE_URL } from '../billing/constants.js';
14	import { runAgent, decideForTask, LlmAbortedError } from '../llm/index.js';
15	import { runPostRunExtraction } from '../memory/index.js';
16	import { userSettings } from '../data/stores.js';
17	import {
18	  registerRun,
19	  getRun,
20	  removeRun,
21	  finalizeOnce,
22	  hasLiveJobForArtifact,
23	  reserveFirstBuild,
24	  bindReservation,
25	  releaseReservation,
26	} from './registry.js';
27	import { JobStreamSink, emitIntegrationBuildIntent, emitChatAnswer } from './streaming.js';
28	import { MarkerProcessor, scanProviderError } from './markers.js';
29	import { StreamingIdentityRedactor } from './branding.js';
30	import { toolPolicyFor } from './tools.js';
31	import { knowledgeToolSpecs, loadContextToolSpec, delegateToolSpec } from './sdk-tools.js';
32	import { classifyInBuildIntent } from './guided-build.js';
33	import {
34	  persistJob,
35	  patchJob,
36	  getJob,
37	  jobView,
38	  nonTerminalJobForArtifact,
39	  resetArtifactToDraft,
40	  type JobRecord,
41	} from './jobs.js';
42	import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, ingestBuildKnowledge, verifyRunner } from './seams.js';
43	import { detectDomainHeavy, knowledgeScopingNarration, knowledgeIndexedNarration, knowledgeNotIndexedNarration } from './domain-scoping.js';
44	import { logActivity } from '../data/activity.js';
45	
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
81	  | { status: 'answered'; reason: string }
82	  | { status: 'conflict' };
83	
84	/**
85	 * Handle `POST /jobs` (build) up to the response (§5.6.2). First builds reserve synchronously and
86	 * respond `created`; follow-ups run the in-build classifier and may respond `answered` with no
87	 * job. A concurrent follow-up on the same artifact is `conflict` → the route returns 409
88	 * DUPLICATE_BUILD.
89	 */
90	export async function handleBuildCreate(input: BuildCreateInput): Promise<BuildCreateResult> {
91	  return input.artifactId ? handleFollowUp(input, input.artifactId) : handleFirstBuild(input);
92	}
93	
94	// --- First build -------------------------------------------------------------------------
95	
96	async function handleFirstBuild(input: BuildCreateInput): Promise<BuildCreateResult> {
97	  // Reserve synchronously BEFORE any async work (§5.3.3). A live reservation binds the second
98	  // POST to the running job and returns it (the build_intent broadcast reaches every open tab).
99	  const reservation = reserveFirstBuild(input.sessionId, input.deps.now());
100	  if (!reservation.ok) {
101	    // Bound to the existing job — return it as `created` pointing at the running job.
102	    const existingId = reservation.jobId;
103	    return {
104	      status: 'created',
105	      job: { id: existingId, status: 'running', createdAt: new Date(input.deps.now()).toISOString() },
106	      fire: () => {},
107	    };
108	  }
109	
110	  const jobId = input.deps.genId();
111	  bindReservation(input.sessionId, jobId);
112	  const abort = new AbortController();
113	  registerRun({
114	    id: jobId,
115	    ownerUserId: input.actor.userId,
116	    orgId: input.actor.orgId,
117	    kind: 'build',
118	    abort,
119	    startedAt: input.deps.now(),
120	    sessionId: input.sessionId,
121	  });
122	
123	  const record: JobRecord = {
124	    _id: jobId,
125	    kind: 'build',
126	    status: 'created',
127	    userId: input.actor.userId,
128	    sessionId: input.sessionId,
129	    request: {
130	      description: input.description,
131	      language: input.language,
132	      ...(input.templateId ? { templateId: input.templateId } : {}),
133	      ...(input.integrationKeys ? { integrationKeys: input.integrationKeys } : {}),
134	      ...(input.fieldValues ? { fieldValues: input.fieldValues } : {}),
135	      ...(input.configValues ? { configValues: input.configValues } : {}),
136	    },
137	    createdAt: new Date(input.deps.now()).toISOString(),
138	  };
139	  // Persist BEFORE responding so `GET /jobs/:id` finds the record as soon as the 202 returns
140	  // ("respond early once the record exists", §5.2 step 2).
141	  await persistJob(record);
142	  auditBuild(input, 'created', { jobId }); // Registo (F3)
143	
144	  return {
145	    status: 'created',
146	    job: jobView(record),
147	    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: true }),
148	  };
149	}
150	
151	// --- Follow-up ---------------------------------------------------------------------------
152	
153	async function handleFollowUp(input: BuildCreateInput, artifactId: string): Promise<BuildCreateResult> {
154	  // One follow-up build per artifact (§5.3.5): reject a concurrent build targeting the same
155	  // artifact — two would resume the same SDK transcript and corrupt it.
156	  if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
157	    return { status: 'conflict' };
158	  }
159	
160	  const jobId = input.deps.genId();
161	  const abort = new AbortController();
162	  registerRun({
163	    id: jobId,
164	    ownerUserId: input.actor.userId,
165	    orgId: input.actor.orgId,
166	    kind: 'build',
167	    abort,
168	    startedAt: input.deps.now(),
169	    artifactId,
170	    sessionId: input.sessionId,
171	  });
172	
173	  // In-build message classifier BEFORE any build work, under the abort rules of §5.3.2.
174	  let intent: Awaited<ReturnType<typeof classifyInBuildIntent>>;
175	  try {
176	    intent = await classifyInBuildIntent(input.description, input.actor.userId, abort.signal);
177	  } catch (err) {
178	    removeRun(jobId);
179	    if (err instanceof LlmAbortedError) {
180	      // Abort NEVER falls through to a build (§5.3.2): zero jobs created, zero side effects.
181	      return { status: 'answered', reason: 'Execução cancelada.' };
182	    }
183	    // Non-abort classifier failure is non-fatal and defaults to proceeding (§5.6.2) — handled by
184	    // classifyInBuildIntent's own fallback, so reaching here is an unexpected error: answer safely.
185	    return { status: 'answered', reason: 'Não foi possível processar o pedido.' };
186	  }
187	
188	  if (intent === 'integration-build') {
189	    emitIntegrationBuildIntent(input.actor.userId, { sessionId: input.sessionId });
190	    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'Vou ligar essa integração primeiro.' });
191	    removeRun(jobId);
192	    return { status: 'answered', reason: 'integration-build' };
193	  }
194	  if (intent === 'question') {
195	    // In-build answer flow (cheap tier), delivered as chat_answer; no job (§5.6.2).
196	    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'A aplicação está a ser construída; posso ajudar com isso.' });
197	    removeRun(jobId);
198	    return { status: 'answered', reason: 'question' };
199	  }
200	
201	  // modification → proceed with the build. projectDir resolved server-side from the artifact.
202	  const record: JobRecord = {
203	    _id: jobId,
204	    kind: 'build',
205	    status: 'created',
206	    userId: input.actor.userId,
207	    sessionId: input.sessionId,
208	    artifactId,
209	    request: { description: input.description, language: input.language },
210	    createdAt: new Date(input.deps.now()).toISOString(),
211	  };
212	  await persistJob(record);
213	  auditBuild(input, 'created', { jobId, artifactId }); // Registo (F3)
214	  return {
215	    status: 'created',
216	    job: jobView(record),
217	    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
218	  };
219	}
220	
221	// --- Execution ---------------------------------------------------------------------------
222	
223	interface ExecOpts {
224	  firstBuild: boolean;
225	  artifactId?: string;
226	}
227	
228	/**
229	 * F16 steering: the build agent's system prompt names the served entrypoint and forbids the
230	 * orphan-HTML failure mode (the app compiled and served is ALWAYS the manifest entrypoint —
231	 * `frontend/src/index.jsx` importing `App.jsx`; a standalone top-level HTML file is never
232	 * served). The honest-completion gate below is the SYSTEM's catch for when the model errs
233	 * anyway — this prompt just makes the miss rare.
234	 */
235	/** Hard cap on scoping-provided knowledge docs ingested per first build. The contract
236	 *  (JobCreateRequest.knowledgeDocs) enforces the same cap + per-doc size at the boundary;
237	 *  this re-cap protects direct programmatic callers of handleBuildCreate. */
238	const MAX_KNOWLEDGE_DOCS = 20;
239	
240	const BUILD_SYSTEM_PROMPT = [
241	  'You are building a web app inside an Ekoa app workspace.',
242	  'The served application is compiled from the manifest entrypoint: frontend/src/index.jsx, which renders frontend/src/App.jsx.',
243	  'Make ALL user-visible changes by editing frontend/src/App.jsx (and files it imports under frontend/src/).',
244	  'NEVER write a standalone top-level *.html file as the deliverable - top-level HTML files are not served; only the compiled entrypoint bundle is.',
245	  'Do not edit dist/ by hand - it is build output, regenerated from frontend/src/.',
246	  // White-label (ch12; operator report 2026-07-11: the final summary named `window.__ekoa.exportPdf`).
247	  'Your FINAL message is read by a non-technical end user. Write it in the language of their request.',
248	  'In that final message NEVER mention internal platform APIs (window.__ekoa or any of its members), file paths, bundlers, manifests, libraries, or any implementation machinery.',
249	  'Describe what the app DOES in product terms ("um botão que descarrega o documento em PDF"), never HOW it is wired.',
250	].join('\n');
251	
252	/**
253	 * Run the build job through the chokepoint and drive the completion sequence (§5.6.2). Terminal
254	 * state is owned by the finalize path (dual-fire guarded). The in-process zombie net lives in the
255	 * `finally`: a run left non-terminal is flipped to `failed { PIPELINE_STUCK }` and the artifact
256	 * reset to draft (§5.2.1).
257	 */
258	export async function executeBuildJob(jobId: string, input: BuildCreateInput, abort: AbortController, opts: ExecOpts): Promise<void> {
259	  const entry = getRun(jobId);
260	  const sink = new JobStreamSink(jobId);
261	  const start = input.deps.now();
262	  const cfg = loadAgentsConfig();
263	  const mech = getBuildMechanics();
264	
265	  let artifactId = opts.artifactId ?? '';
266	  let projectDir = '';
267	  let slug = '';
268	  let appUrl = '';
269	  let resumeSessionId: string | undefined;
270	  let terminalReached = false;
271	
272	  const finishError = async (code: string): Promise<void> => {
273	    if (finalizeOnce(jobId)) {
274	      sink.error(code, 'A construção falhou.');
275	      await patchJob(jobId, { status: 'failed', error: { code, message: 'A construção falhou.' }, endedAt: new Date(input.deps.now()).toISOString() });
276	      if (artifactId) await resetArtifactToDraft(artifactId); // artifact stays draft on error (§5.6.2)
277	    }
278	    terminalReached = true;
279	  };
280	
281	  // Inactivity + wall-clock timers (§5.3.6). Inactivity resets on every stream/tool/plan
282	  // callback; wall clock is absolute. On a timeout: if abort is already set (cancel owns terminal
283	  // state) stay quiet; otherwise route through the finalized-guarded error path.
284	  let inactivityTimer: NodeJS.Timeout;
285	  const resetInactivity = (): void => {
286	    clearTimeout(inactivityTimer);
287	    inactivityTimer = setTimeout(onTimeout, cfg.buildInactivityTimeoutMs);
288	  };
289	  const wallClock = setTimeout(onTimeout, cfg.buildWallClockMs);
290	  function onTimeout(): void {
291	    if (abort.signal.aborted) return; // cancel owns the terminal state
292	    if (entry) entry.timedOut = true;
293	    abort.abort();
294	  }
295	  resetInactivity();
296	
297	  try {
298	    await patchJob(jobId, { status: 'running', startedAt: new Date(input.deps.now()).toISOString() });
299	
300	    // Billing gate (§5.2 step 3).
301	    const allow = await checkAllowance(input.actor.userId);
302	    if (abort.signal.aborted) { await settleAborted(); return; }
303	    if (!allow.ok) {
304	      clearTimers();
305	      if (finalizeOnce(jobId)) {
306	        const url = allow.billingUrl ?? BILLING_PAGE_URL;
307	        sink.error('BILLING_BLOCKED', `${allow.message ?? 'Faturação bloqueada.'} ${url}`);
308	        await patchJob(jobId, { status: 'failed', error: { code: 'BILLING_BLOCKED', message: allow.message ?? 'Faturação bloqueada.' }, endedAt: new Date(input.deps.now()).toISOString() });
309	      }
310	      terminalReached = true;
311	      return;
312	    }
313	
314	    // First-build vs follow-up resolution.
315	    let basePromptSections: string[] = [];
316	    if (opts.firstBuild) {
317	      const prep = await mech.prepareFirstBuild({ userId: input.actor.userId, sessionId: input.sessionId, description: input.description, language: input.language, ...(input.templateId ? { templateId: input.templateId } : {}) });
318	      artifactId = prep.artifactId;
319	      projectDir = prep.projectDir;
320	      slug = prep.slug;
321	      appUrl = prep.appUrl;
322	      basePromptSections = prep.basePromptSections ?? [];
323	      if (entry) entry.artifactId = artifactId;
324	      await patchJob(jobId, { artifactId });
325	    } else {
326	      // TOCTOU close (H1 MEDIUM): the create-time writability gate on POST /jobs can be stale by the
327	      // time this queued follow-up runs — the owner may have flipped the artifact org→private, or
328	      // deleted it, between check and execution. Re-validate writability at USE time (through the
329	      // mechanics seam — agents/ reaches apps/ only via the seam, ch02 §2.7) and FAIL the job rather
330	      // than resume a code-writing agent against an artifact the actor may no longer write.
331	      const writeVerdict = await mech.revalidateWritable(input.actor, artifactId);
332	      if (writeVerdict !== 'ok') {
333	        clearTimers();
334	        if (finalizeOnce(jobId)) {
335	          const message = 'Já não tem permissão para alterar esta aplicação.';
336	          sink.error('EDIT_FORBIDDEN', message);
337	          await patchJob(jobId, { status: 'failed', error: { code: 'EDIT_FORBIDDEN', message }, endedAt: new Date(input.deps.now()).toISOString() });
338	        }
339	        terminalReached = true;
340	        return;
341	      }
342	      const resolved = await mech.resolveFollowUp(artifactId);
343	      if (!resolved) { clearTimers(); await finishError('ADAPTER_ERROR'); return; }
344	      projectDir = resolved.projectDir;
345	      resumeSessionId = resolved.resumeSessionId;
346	      slug = resolved.slug;
347	      appUrl = resolved.appUrl;
348	      basePromptSections = resolved.basePromptSections ?? [];
349	    }
350	    if (abort.signal.aborted) { await settleAborted(); return; }
351	
352	    // Live build surface: the scaffold (or the existing app, on a follow-up) is served ALREADY —
353	    // tell the client where, so the preview iframe + real file tree show from second zero, and
354	    // wire the watcher so every incremental rebuild reloads the preview as the agent writes.
355	    if (artifactId && appUrl) {
356	      sink.artifact({ artifactId, appUrl, ...(slug ? { slug } : {}) });
357	      if (projectDir) await mech.watchRebuilds({ artifactId, projectDir, onRebuild: () => sink.previewReload() });
358	    }
359	
360	    // Routing floored at the expert tier (§5.2 step 5); emit the routing event.
361	    const decision = decideForTask(input.description, undefined, 'EXPERT');
362	    sink.routing(decision.tier, opts.firstBuild ? 'first build' : 'follow-up build');
363	    await patchJob(jobId, { routing: { tier: decision.tier, reason: opts.firstBuild ? 'first build' : 'follow-up build' } });
364	
365	    // F1 knowledge-during-build (§5.5.2 knowledge area). The first-build scoping phase runs a
366	    // DETERMINISTIC domain-heavy detector (no model call, no egress) over the request. A
367	    // domain-heavy app NARRATES a knowledge request on the build stream (upload reference
368	    // documents to the org knowledge area) and, when the request carried scoping-provided
369	    // documents, ingests them into the org knowledge area for THIS run - org-scoped by the run's
370	    // actor, refused for the reserved _shared partition, and immediately searchable to the
371	    // knowledge tools mounted below. The ingest IS awaited before the run starts - deliberately,
372	    // so the docs are searchable to this same run - but it is bounded (doc count/size capped at
373	    // the contract, count re-capped here) and non-fatal per doc: one bad document neither fails
374	    // the build nor blocks the remaining documents.
375	    if (opts.firstBuild) {
376	      try {
377	        const scope = detectDomainHeavy(input.description);
378	        if (scope.domainHeavy) {
379	          sink.planStep('knowledge-scope', knowledgeScopingNarration(scope.domains));
380	          const docs = (input.knowledgeDocs ?? []).slice(0, MAX_KNOWLEDGE_DOCS);
381	          let indexed = 0;
382	          for (const doc of docs) {
383	            try {
384	              const { id } = await ingestBuildKnowledge(
385	                input.actor,
386	                { collection: doc.collection || 'uploads', title: doc.title, text: doc.text, sourceType: 'build-scoping' },
387	                input.deps,
388	              );
389	              if (id) indexed++;
390	            } catch (err) {
391	              console.warn(`[build] knowledge doc "${doc.title}" not ingested (non-fatal):`, err instanceof Error ? err.message : err);
392	            }
393	          }
394	          // Honest confirmation: partial ingests name the shortfall; an all-failed ingest is
395	          // narrated too (review-f1 Low: it used to be silent), never pretending success.
396	          if (indexed > 0) sink.planStep('knowledge-indexed', knowledgeIndexedNarration(indexed, docs.length));
397	          else if (docs.length > 0) sink.planStep('knowledge-indexed', knowledgeNotIndexedNarration(docs.length));
398	        }
399	      } catch (err) {
400	        console.warn('[build] knowledge scoping failed (non-fatal):', err instanceof Error ? err.message : err);
401	      }
402	    }
403	
404	    const policy = toolPolicyFor('build');
405	    const liveMarkers = new MarkerProcessor();
406	    let capturedSessionId: string | undefined;
407	
408	    // The coding kind's content sections lead the build system prompt (before this run's F16
409	    // entrypoint steering) — pre-fix, builds sent ONLY the 6-line inline prompt and the whole
410	    // coding-agent content package was dead weight. The grounding block self-gates (legal-context
411	    // builds only, §5.5.2 layer 2); both layers are non-fatal.
412	    let contentSections: string[] = [];
413	    let groundingBlock = '';
414	    try {
415	      contentSections = (await assembleAgentContext({ agentKind: 'coding', userId: input.actor.userId })).promptSections;
416	      groundingBlock = await knowledgeGrounding({ userId: input.actor.userId, orgId: input.actor.orgId, query: input.description, agentKind: 'coding' });
417	    } catch (err) {
418	      console.warn('[build] content/grounding assembly failed (non-fatal):', err instanceof Error ? err.message : err);
419	    }
420	
421	    const handle = runAgent(
422	      {
423	        prompt: input.description,
424	        // F16: pin the agent to the served entrypoint. Nothing else names it (settingSources is
425	        // empty, §5.4.2), so without this the agent may write a standalone HTML file that is
426	        // never served while the scaffold keeps being compiled. Flows through runAgent's
427	        // anonymise path like every prompt (client.ts systemPrompt handling).
428	        // Base conventions (operator-run B1) sit between the universal coding sections and
429	        // the grounding block: universal judgment first, then the selected base's structural
430	        // invariants, then dynamic knowledge, then the F16 entrypoint steer.
431	        systemPrompt: [...contentSections, ...basePromptSections, groundingBlock, BUILD_SYSTEM_PROMPT].filter(Boolean).join('\n\n'),
432	        decision,
433	        allowedTools: policy.allowedTools,
434	        maxTurns: policy.maxTurns,
435	        // Builds mount the knowledge tools + the context-loading tool + the §5.4.8 local-bridge
436	        // delegation tool as in-process MCP (§5.4.4; ch18 §18.2).
437	        sdkTools: [...knowledgeToolSpecs(input.actor), loadContextToolSpec(input.actor, 'coding'), delegateToolSpec(input.actor, input.sessionId)],
438	        cwd: projectDir || undefined,
439	        homeDir: projectDir || undefined, // build runs set HOME = projectDir (§5.4.1)
440	        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
441	        signal: abort.signal,
442	        callbacks: {
443	          onToolEvent: (e) => { resetInactivity(); sink.toolEvent(e); },
444	          onSessionId: (sid) => { capturedSessionId = sid; },
445	          onPlanNotification: () => resetInactivity(),
446	        },
447	      },
448	      { kind: 'user_work', agentType: 'build', billeeUserId: input.actor.userId, sessionId: input.sessionId, runId: jobId, artifactId },
449	    );
450	
451	    // Two channels, mirroring chat.ts (§5.6.1): the ANSWER stream (`text`) and the working
452	    // commentary (`thinking` — intermediate-turn narration + thinking blocks, where the engine
453	    // happily self-identifies). Pre-fix, build funneled BOTH into text_chunk, so the user's
454	    // transcript filled with mid-word fragments of internal narration rendered as regular
455	    // messages (operator report 2026-07-11). Each channel gets its own marker filter; the
456	    // thinking channel is additionally engine-identity-redacted (branding.ts).
457	    const thinkingMarkers = new MarkerProcessor();
458	    const thinkingRedactor = new StreamingIdentityRedactor();
459	    const emitThinking = (piece: string): void => {
460	      if (piece) sink.thinking(piece);
461	    };
462	    let streamedAny = false; // ANSWER chunks only: thinking must not mask a provider-error-as-result
463	    for await (const ev of handle.events) {
464	      resetInactivity();
465	      if (ev.type === 'thinking') {
466	        emitThinking(thinkingRedactor.push(thinkingMarkers.push(ev.text)));
467	        continue;
468	      }
469	      streamedAny = true;
470	      const clean = liveMarkers.push(ev.text);
471	      if (clean) sink.text(clean);
472	    }
473	    const thinkingTail = thinkingMarkers.end();
474	    emitThinking(thinkingRedactor.push(thinkingTail.text) + thinkingRedactor.end());
475	    const tail = liveMarkers.end();
476	    if (tail.text) sink.text(tail.text);
477	    const result = await handle.result;
478	    clearTimers();
479	
480	    if (result.aborted) { await settleAborted(); return; }
481	
482	    // §5.6.2 completion sequence, step 1: provider-error-as-result reroute (§5.3.7). Scanned only
483	    // on the nothing-streamed fallback shape — same reasoning as chat.ts (F20 made result.text the
484	    // full accumulation; legitimate build narration can mention error terms).
485	    if (!streamedAny && scanProviderError(result.text)) { await finishError('ADAPTER_ERROR'); return; }
486	
487	    // Session resume (§5.4.5): persist sdkSessionId ONLY when it differs from what we resumed with.
488	    if (capturedSessionId && capturedSessionId !== resumeSessionId) {
489	      await mech.persistSdkSessionId(artifactId, capturedSessionId);
490	    }
491	
492	    // Step 2: final bundle. Step 3: version snapshot (broken builds snapshotted with a failure tag).
493	    const bundle = await mech.finalizeBundle({ artifactId, projectDir });
494	    await mech.snapshot({ artifactId, projectDir, broken: !bundle.ok });
495	
496	    // Step 4: slug — preserved on follow-ups, generated on first builds (already resolved in prep).
497	
498	    // Step 5a (F16): honest-completion gate. Deterministic evidence the work reached the SERVED
499	    // surface — an untouched entrypoint subtree / scaffold-fingerprinted dist means the user's
500	    // app was never built (the classic miss: the real app written to an orphan top-level HTML
501	    // that is never served). A gate hit is a DISTINCT non-success terminal: it surfaces to the
502	    // user and the job fails — never a clean `completed` over a scaffold. Runs before the model
503	    // verification (step 5) so a scaffold build is never billed a verification pass.
504	    const progress = await mech.assertProgress({ artifactId, projectDir });
505	    if (!progress.clean) {
506	      if (finalizeOnce(jobId)) {
507	        const detail = progress.reasons.join('; ');
508	        const message = `A construção não chegou à aplicação servida (a página continua o modelo inicial). ${detail}`.trim();
509	        sink.error('BUILD_UNFULFILLED', message);
510	        await patchJob(jobId, { status: 'failed', error: { code: 'BUILD_UNFULFILLED', message }, endedAt: new Date(input.deps.now()).toISOString() });
511	      }
512	      terminalReached = true;
513	      return;
514	    }
515	
516	    // Step 5: per-build verification (default ON per user's build.verifyBuilds). Full acceptance
517	    // pass on a first build; scoped tests + smoke on a follow-up. The runner receives the user's
518	    // REQUEST and asserts request-fulfilment (F28), not mere rendering. Verdict semantics:
519	    //   - ran+passed  → clean, no note.
520	    //   - ran+FAILED  → GATES completion (F28): a distinct non-success terminal that surfaces to
521	    //     the user — never a silent `completed` with a note (that was verification theater: the
522	    //     gate that exists to catch a served scaffold passed it and billed for the pass).
523	    //   - not-run (e.g. credential-skip) → honest note-only, never a failure (§5.6.2 step 5).
524	    let verifyNote: string | undefined;
525	    const verifyEnabled = (await userSettings.get(input.actor.userId))?.build?.verifyBuilds ?? true;
526	    if (verifyEnabled) {
527	      sink.planStep('verifying', 'A testar a aplicação...');
528	      // The verify stage streams its narration through the thinking channel — it used to be a
529	      // silent multi-minute void (operator report 2026-07-11). Its own filter chain: raw runner
530	      // text → marker filter → engine-identity redaction. Verify is bounded by its own wall
531	      // clock inside the runner (verifyWallClockMs), not the build timers (cleared above).
532	      const verifyMarkers = new MarkerProcessor();
533	      const verifyRedactor = new StreamingIdentityRedactor();
534	      const verdict = await verifyRunner({
535	        artifactId,
536	        projectDir,
537	        appUrl,
538	        userId: input.actor.userId,
539	        depth: opts.firstBuild ? 'full' : 'scoped',
540	        request: input.description,
541	        onProgress: (text) => {
542	          const clean = verifyRedactor.push(verifyMarkers.push(text));
543	          if (clean) sink.thinking(clean);
544	        },
545	      });
546	      if (verdict.ran && !verdict.passed) {
547	        if (finalizeOnce(jobId)) {
548	          const message = `A verificação da aplicação falhou. ${verdict.note ?? ''}`.trim();
549	          sink.error('VERIFY_FAILED', message);
550	          await patchJob(jobId, { status: 'failed', error: { code: 'VERIFY_FAILED', message }, endedAt: new Date(input.deps.now()).toISOString() });
551	        }
552	        terminalReached = true;
553	        return;
554	      }
555	      if (!verdict.ran && verdict.note) verifyNote = verdict.note;
556	    }
557	
558	    // Step 6: complete event. Notes (bundle error / honest verify not-run) are APPENDED to the
559	    // agent's user-facing summary, never a replacement for it — pre-fix, any note clobbered the
560	    // whole summary, so the user's "done" message was just "verification did not run: ..."
561	    // (operator report 2026-07-11).
562	    const notes = [bundle.ok ? '' : (bundle.error ?? 'A compilação final falhou.'), verifyNote ?? ''].filter(Boolean).join(' ');
563	    const completionText = [result.text, notes].filter(Boolean).join('\n\n') || notes;
564	    if (finalizeOnce(jobId)) {
565	      sink.complete({ result: completionText, artifactId, slug, appUrl }, input.deps.now() - start);
566	      await patchJob(jobId, { status: 'completed', result: { text: completionText, slug, appUrl }, endedAt: new Date(input.deps.now()).toISOString() });
567	    }
568	    terminalReached = true;
569	
570	    // Step 7: artifact → active with a MERGE onto its data bag (§5.6.2 step 7).
571	    // projectDir lets activation capture the app's declared UI action manifest (C2).
572	    await mech.activateArtifact({ artifactId, slug, appUrl, ...(projectDir ? { projectDir } : {}) });
573	    // Step 8: fire-and-forget screenshot + post-run memory extraction OFF the terminal event.
574	    mech.screenshot(artifactId);
575	    void runPostRunExtraction({ userId: input.actor.userId, username: input.username, orgId: input.actor.orgId, sessionId: input.sessionId, runId: jobId, transcript: `${input.description}\n\n${result.text}`, deps: input.deps }).catch(() => undefined);
576	  } catch (err) {
577	    clearTimers();
578	    await finishError('ADAPTER_ERROR');
579	    void err;
580	  } finally {
581	    clearTimers();
582	    // In-process zombie net (§5.2.1): a run somehow still non-terminal after the pipeline exits is
583	    // flipped to failed { PIPELINE_STUCK } and its artifact reset to draft.
584	    if (!terminalReached && finalizeOnce(jobId)) {
585	      sink.error('PIPELINE_STUCK', 'A construção terminou num estado inconsistente.');
586	      await patchJob(jobId, { status: 'failed', error: { code: 'PIPELINE_STUCK', message: 'Pipeline stuck.' }, endedAt: new Date(input.deps.now()).toISOString() });
587	      if (artifactId) await resetArtifactToDraft(artifactId);
588	    }
589	    if (input.sessionId) releaseReservation(input.sessionId, jobId); // guarded by job id (§5.3.3)
590	    removeRun(jobId);
591	    // Registo (F3): ONE terminal row per build, from the record's final status (guaranteed-once
592	    // here — every terminal transition has already patched the store). Metadata is ids/codes only.
593	    // Best-effort: a store read that fails (e.g. the DB went away as the process exits) must NOT
594	    // become an unhandled rejection on this fire-and-forget pipeline — swallow it like the audit
595	    // write itself (a missed bookkeeping row never fails a build).
596	    try {
597	      const finalJob = await getJob(jobId);
598	      const st = finalJob?.status;
599	      if (st === 'completed') auditBuild(input, 'completed', { jobId, ...(artifactId ? { artifactId } : {}) });
600	      else if (st === 'failed') auditBuild(input, 'failed', { jobId, code: finalJob?.error?.code ?? 'UNKNOWN' });
601	      else if (st === 'cancelled') auditBuild(input, 'cancelled', { jobId });
602	    } catch {
603	      /* terminal-audit read failed (shutdown/db hiccup) — best-effort, never fails the build */
604	    }
605	  }
606	
607	  function clearTimers(): void {
608	    clearTimeout(inactivityTimer);
609	    clearTimeout(wallClock);
610	  }
611	
612	  // Cancelled/plain-abort terminal: set the cancelled status (cancel set it BEFORE the abort, so
613	  // the terminal transition here is the cancelled one; a plain abort stays quiet).
614	  async function bail(): Promise<void> {
615	    clearTimers();
616	    if (entry?.cancelled && finalizeOnce(jobId)) {
617	      await patchJob(jobId, { status: 'cancelled', endedAt: new Date(input.deps.now()).toISOString() });
618	    }
619	    terminalReached = true;
620	  }
621	
622	  // Abort resolution (§5.3.6): a timeout surfaces a terminal ERROR wherever the abort lands —
623	  // including the early checkpoints before the stream — while a user Stop stays silent (cancel
624	  // owns the terminal state). Found by the G7B fresh-context review: bail() alone is
625	  // timeout-blind, so a timeout during checkAllowance/prepare was misreported as a cancel.
626	  async function settleAborted(): Promise<void> {
627	    clearTimers();
628	    if (entry?.timedOut && !entry.cancelled) await finishError('TIMEOUT');
629	    else await bail();
630	  }
631	}
632	
633	export { getJob };
634	

codex
I’ve found one real policy drift and one queue/edit coherence gap. I’m pulling the exact panel-side lines now so the final report can tie each issue to the full H2-H4 interaction, not just the server helpers.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,260p' api/assets/panel-runtime/src/AssistantPanel.jsx" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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
// H3 EDIT MODE (admins only): the network side of the admin patch-run flow, factored out
// so it is unit-provable against a fake fetch. It targets the PLATFORM /api/v1/* API with
// the admin's platform Bearer - a SEPARATE plane from the visitor-blind POST
// /api/app-assistant. Every action it calls is H1-gated server-side; this panel only SHOWS
// the affordance when detection said admin, and only after the admin OPTS IN (detect-then-ask).
import { runEditPatch, guardedRollback, degradeMessage, progressLine, EDIT_COPY } from './edit-mode';
// H4 CHANGE REQUESTS (non-admins): a viewer who cannot edit this app can file a change request
// into the app OWNER's org-admin queue (a SEPARATE thin platform endpoint; the visitor-blind
// POST /api/app-assistant plane is untouched). Filing requires a logged-in platform user.
import { fileChangeRequest, REQUEST_COPY } from './change-request';
import './AssistantPanel.css';

const ENDPOINT = '/api/app-assistant';
// H2 admin DETECTION (detect-then-ask). A cheap, non-LLM GET that answers ONLY "is the current
// viewer an admin of this app's owner org?". It NEVER issues an assistant turn (the zero-token
// invariant holds) and its result NEVER auto-enables anything - it only lights a discreet
// indicator. The edit-mode switch + its opt-in UX are H3; this panel does not build them.
const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
// The platform session token key web/lib/api/token.ts uses. Read best-effort for detection only:
// a served app on the SAME origin as the dashboard can read it; a CROSS-origin / sandboxed iframe
// (the dev preview) throws on access, so detection simply falls back to "not admin".
const TOKEN_STORAGE_KEY = 'ekoa_token';
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

/** Best-effort read of the platform session token for admin DETECTION only (H2). Same-origin
 *  served pages can read the dashboard's localStorage; a cross-origin or sandboxed iframe throws
 *  a SecurityError on `localStorage` access - swallow it to null so detection just degrades to
 *  "not admin" (no affordance) instead of crashing the panel. Reads nothing else and stores
 *  nothing - the token is attached to the one whoami GET and never kept. */
function readPlatformToken() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const t = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return typeof t === 'string' && t ? t : null;
  } catch {
    return null;
  }
}

/** A short display sha for the edit-mode preview (7 chars, like git). Undefined -> a dash. */
function shortSha(sha) {
  return typeof sha === 'string' && sha ? sha.slice(0, 7) : '-';
}

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

/** Best-effort short screen-context descriptor for a filed change request (H4): the shell may
 *  expose a `screenState` string on window.__ekoaApp; otherwise fall back to the document title so
 *  the org-admin has a hint of WHERE the request came from. Bounded; undefined when nothing known.
 *  Never throws (a cross-origin access is swallowed). Org-internal - never egressed to a model. */
function captureScreenState() {
  if (typeof window === 'undefined') return undefined;
  try {
    const app = window.__ekoaApp;
    if (app && typeof app.screenState === 'string' && app.screenState) return app.screenState.slice(0, 8000);
    const title = typeof document !== 'undefined' && document.title ? String(document.title) : '';
    return title ? title.slice(0, 8000) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Map a proposed action to the manifest form window.__ekoaActions.execute expects
 * (kind/target/route/destructive/labelPt + a VALUES object on params). D1 sends
 * `{ toolName, input }`; when the response is enriched with the resolved manifest
 * `action` we drive it directly, otherwise we forward what we have (the runtime
 * reports a clean failure for an action it cannot resolve - never a crash).
 */
function toRuntimeAction(a) {
  const values = (a && (a.input || a.params)) || {};
  if (a && a.action && typeof a.action === 'object') {
    return { ...a.action, params: values };
  }
  const id =
    a && typeof a.toolName === 'string'
      ? a.toolName.replace(/^app_action__/, '').replace(/_/g, '-')
      : undefined;
  return { id, toolName: a && a.toolName, params: values };
}

/** A short PT-PT status line for one action run. */
function runLabel(status) {
  switch (status) {
    case 'running':
      return 'A executar...';
    case 'done':
      return 'Ação executada.';
    case 'cancelled':
      return 'Ação cancelada.';
    case 'unavailable':
      return 'Ação indisponível nesta pré-visualização.';
    default:
      return 'Não foi possível executar a ação.';
  }
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

/** PT-PT status line for a non-stepping tour phase (playing/awaiting show the copy). */
function tourStatusText(status) {
  switch (status) {
    case 'loading':
      return 'A carregar o tutorial...';
    case 'awaiting':
      return 'Aguardando a sua ação na aplicação...';
    case 'done':
      return 'Tutorial concluído.';
    case 'error':
      return 'Não foi possível carregar o tutorial guiado.';
    default:
      return '';
  }
}

/**
 * The tour block rendered in the panel while a same-document tour plays. The
 * on-page highlight/tooltip is drawn by the C3 runtime (window.__ekoaActions
 * spotlight); this block carries the step counter, the narration, and the
 * Seguinte / Sair controls. It exposes data-tour-status + data-tour-step-index for
 * the deterministic live gate. No emoji; brand-neutral via the panel CSS vars.
 */
function TourView({ tour, onNext, onClose }) {
  const { status, stepIndex, total, copy, imageUrl, imageBlocked, injectedPrompt } = tour;
  const stepping = status === 'playing' || status === 'awaiting';
  const stepNo = total > 0 ? Math.min(stepIndex + 1, total) : 0;
  const statusLine = tourStatusText(status);
  return (
    <section
      className="ekoa-assistant-tour"
      data-tour-status={status}
      data-tour-step-index={stepIndex}
      aria-label="Tutorial guiado"
    >
      <div className="ekoa-assistant-tour-head">
        <span className="ekoa-assistant-tour-title">Tutorial guiado</span>
        {stepping && total > 0 ? (
          <span className="ekoa-assistant-tour-progress">{`Passo ${stepNo} de ${total}`}</span>
        ) : null}
      </div>

      {copy ? (
        <div className="ekoa-assistant-tour-copy">
          {copy.titlePt ? <div className="ekoa-assistant-tour-copy-title">{copy.titlePt}</div> : null}
          {copy.bodyPt ? <div className="ekoa-assistant-tour-copy-body">{copy.bodyPt}</div> : null}
        </div>
      ) : null}

      {injectedPrompt ? (
        <div className="ekoa-assistant-tour-note">
          Sugestão colocada na caixa de mensagem, para rever antes de enviar.
        </div>
      ) : null}

      {imageUrl ? <img className="ekoa-assistant-tour-image" src={imageUrl} alt="" /> : null}

      {imageBlocked ? (
        <div className="ekoa-assistant-tour-note">Imagem ignorada (caminho não permitido).</div>
      ) : null}

      {statusLine ? <div className="ekoa-assistant-tour-status">{statusLine}</div> : null}

      <div className="ekoa-assistant-tour-controls">
        {stepping ? (
          <button type="button" className="ekoa-assistant-tour-next" onClick={onNext}>
            Seguinte
          </button>

hook: PreToolUse
exec
/bin/zsh -lc "rg -n \"admin|editMode|whoami|convert\\(|Pedir alteração|canEditApps|BILLING_LOCKED|needs-login\" api/assets/panel-runtime/src/AssistantPanel.jsx api/assets/panel-runtime/src/edit-mode.js web/app/'(dashboard)'/pedidos/page.tsx web/stores/change-requests.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
web/stores/change-requests.ts:4: * Change-requests store (operator-run H4). The org-admin queue read + the two admin actions
web/stores/change-requests.ts:7: * `GET /api/v1/change-requests`: an org-admin sees its OWN org, a super-admin may pass `orgId`
web/stores/change-requests.ts:9: * edit mode does — a follow-up build via `POST /api/v1/jobs` (H1-gated: the org-admin has
web/stores/change-requests.ts:10: * canEditApps + loadWritable on an org app) — then marks the request converted with the job id.
web/stores/change-requests.ts:24:  /** super-admin cross-org filter ('' = all orgs). */
web/stores/change-requests.ts:84:    //    one is a first build. Both are re-gated server-side (canBuildApps/canEditApps).
web/stores/change-requests.ts:100:      // request open and tell the admin to reformulate.
web/stores/change-requests.ts:107:    const converted = await tryCall(() => api.changeRequests.convert({ id: request.id, jobId }));
web/app/(dashboard)/pedidos/page.tsx:4: * Pedidos (change-requests queue) admin page (operator-run H4).
web/app/(dashboard)/pedidos/page.tsx:6: * The org-admin's queue over `GET /api/v1/change-requests`: change requests users filed from
web/app/(dashboard)/pedidos/page.tsx:7: * inside a served app (or from a refused build). An org-admin sees its OWN org; a super-admin
web/app/(dashboard)/pedidos/page.tsx:13: * Admin-gated (org-admin + super-admin); reachable from the sidebar.
web/app/(dashboard)/pedidos/page.tsx:22:import { AdminGate } from "@/components/admin-gate";
web/app/(dashboard)/pedidos/page.tsx:55:  const isSuperAdmin = role === "super-admin";
web/app/(dashboard)/pedidos/page.tsx:82:  // Live queue: a filed request pushes a `change_request` notification to this admin's channel;
web/app/(dashboard)/pedidos/page.tsx:217:                              onClick={() => convert(req.id)}
api/assets/panel-runtime/src/edit-mode.js:2: * Operator Assistant Panel - EDIT MODE controller (operator-run H3; admins only).
api/assets/panel-runtime/src/edit-mode.js:5: * NOT a second brain: an admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a
api/assets/panel-runtime/src/edit-mode.js:10: * targets the PLATFORM /api/v1/* API with the admin's platform Bearer - a SEPARATE plane
api/assets/panel-runtime/src/edit-mode.js:16: *     gated server-side by can(canEditApps) AND loadWritable(actor, artifactId) (H1).
api/assets/panel-runtime/src/edit-mode.js:17: *     A non-admin (no token / plain user / cross-org) is refused there with a uniform
api/assets/panel-runtime/src/edit-mode.js:23: *     head (one-click rollback). writable()-gated + canEditApps (H1).
api/assets/panel-runtime/src/edit-mode.js:25: *     job's own owner-scoped stream (?token= = the same admin token that created it).
api/assets/panel-runtime/src/edit-mode.js:54: *  signal - not the SSE, which a proxy/network blip can close early). auth:'user' (admin Bearer). */
api/assets/panel-runtime/src/edit-mode.js:74:  // build). NOT a failure and NOT a false "no change": tell the admin it is still running.
api/assets/panel-runtime/src/edit-mode.js:76:  // The head moved between the preview and the Reverter click (another admin / a dashboard action /
api/assets/panel-runtime/src/edit-mode.js:82: *  401 = the admin's session expired; 403 = writability was lost (no longer an editor);
api/assets/panel-runtime/src/edit-mode.js:127: * with the admin Bearer. Returns a discriminated result:
api/assets/panel-runtime/src/edit-mode.js:225: * click (another admin, a dashboard action, a later restore). So before restoring: RE-READ the
api/assets/panel-runtime/src/AssistantPanel.jsx:33:// H3 EDIT MODE (admins only): the network side of the admin patch-run flow, factored out
api/assets/panel-runtime/src/AssistantPanel.jsx:35:// the admin's platform Bearer - a SEPARATE plane from the visitor-blind POST
api/assets/panel-runtime/src/AssistantPanel.jsx:37:// the affordance when detection said admin, and only after the admin OPTS IN (detect-then-ask).
api/assets/panel-runtime/src/AssistantPanel.jsx:39:// H4 CHANGE REQUESTS (non-admins): a viewer who cannot edit this app can file a change request
api/assets/panel-runtime/src/AssistantPanel.jsx:40:// into the app OWNER's org-admin queue (a SEPARATE thin platform endpoint; the visitor-blind
api/assets/panel-runtime/src/AssistantPanel.jsx:46:// H2 admin DETECTION (detect-then-ask). A cheap, non-LLM GET that answers ONLY "is the current
api/assets/panel-runtime/src/AssistantPanel.jsx:47:// viewer an admin of this app's owner org?". It NEVER issues an assistant turn (the zero-token
api/assets/panel-runtime/src/AssistantPanel.jsx:50:const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
api/assets/panel-runtime/src/AssistantPanel.jsx:53:// (the dev preview) throws on access, so detection simply falls back to "not admin".
api/assets/panel-runtime/src/AssistantPanel.jsx:84:/** Best-effort read of the platform session token for admin DETECTION only (H2). Same-origin
api/assets/panel-runtime/src/AssistantPanel.jsx:87: *  "not admin" (no affordance) instead of crashing the panel. Reads nothing else and stores
api/assets/panel-runtime/src/AssistantPanel.jsx:88: *  nothing - the token is attached to the one whoami GET and never kept. */
api/assets/panel-runtime/src/AssistantPanel.jsx:118: *  the org-admin has a hint of WHERE the request came from. Bounded; undefined when nothing known.
api/assets/panel-runtime/src/AssistantPanel.jsx:289:  // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
api/assets/panel-runtime/src/AssistantPanel.jsx:293:  const [admin, setAdmin] = useState(false);
api/assets/panel-runtime/src/AssistantPanel.jsx:295:  // H3 EDIT MODE (admins only) - detect-then-ask is BINDING. `editMode` is the OPT-IN switch:
api/assets/panel-runtime/src/AssistantPanel.jsx:296:  // it starts OFF and is flipped ONLY by an explicit admin click (the switch, or the discovery
api/assets/panel-runtime/src/AssistantPanel.jsx:297:  // banner's CTA). Detection (setAdmin above) NEVER touches it - being an admin shows the switch,
api/assets/panel-runtime/src/AssistantPanel.jsx:298:  // it does not enter edit mode. The rest is the edit flow's UI state, inert until editMode is on.
api/assets/panel-runtime/src/AssistantPanel.jsx:299:  const [editMode, setEditMode] = useState(false);
api/assets/panel-runtime/src/AssistantPanel.jsx:303:  const [editDraft, setEditDraft] = useState(''); // the admin's edit request text
api/assets/panel-runtime/src/AssistantPanel.jsx:308:  // Admin discovery (proactive teaching, shown ONCE, dismissible). Suppressed after the admin
api/assets/panel-runtime/src/AssistantPanel.jsx:312:  // H4 CHANGE REQUEST (non-admins only): the "Pedir alteração" flow. idle (a discreet button) ->
api/assets/panel-runtime/src/AssistantPanel.jsx:313:  // compose (type the request) -> note (a calm terminal message: filed / needs-login / failed).
api/assets/panel-runtime/src/AssistantPanel.jsx:314:  // Shown ONLY when admin === false; an admin uses edit mode instead. Filing requires a logged-in
api/assets/panel-runtime/src/AssistantPanel.jsx:327:  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)
api/assets/panel-runtime/src/AssistantPanel.jsx:344:  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
api/assets/panel-runtime/src/AssistantPanel.jsx:345:  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
api/assets/panel-runtime/src/AssistantPanel.jsx:355:    if (!id || whoamiDoneRef.current) return;
api/assets/panel-runtime/src/AssistantPanel.jsx:356:    whoamiDoneRef.current = true;
api/assets/panel-runtime/src/AssistantPanel.jsx:368:            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
api/assets/panel-runtime/src/AssistantPanel.jsx:372:        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
api/assets/panel-runtime/src/AssistantPanel.jsx:374:        setAdmin(!!(data && data.admin === true));
api/assets/panel-runtime/src/AssistantPanel.jsx:376:        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
api/assets/panel-runtime/src/AssistantPanel.jsx:606:  // ---- H3 edit mode (admins only) -----------------------------------------
api/assets/panel-runtime/src/AssistantPanel.jsx:608:  // authority (can(canEditApps) + loadWritable on every call); the panel only decides
api/assets/panel-runtime/src/AssistantPanel.jsx:609:  // whether to SHOW the affordance (admin) and drives the confirmed flow. Every mid-flow
api/assets/panel-runtime/src/AssistantPanel.jsx:612:  /** Turn edit mode ON. An EXPLICIT admin action (switch or discovery CTA) - the only way
api/assets/panel-runtime/src/AssistantPanel.jsx:634:  /** compose -> confirm: the panel asks the admin to confirm the intent before any build. */
api/assets/panel-runtime/src/AssistantPanel.jsx:689:      // failure and NOT a false "no change" (M1): tell the admin it is still running.
api/assets/panel-runtime/src/AssistantPanel.jsx:742:  // ---- H4 change request (non-admins only) --------------------------------
api/assets/panel-runtime/src/AssistantPanel.jsx:743:  // A viewer who cannot edit this app (admin === false) can file a change request to the app
api/assets/panel-runtime/src/AssistantPanel.jsx:744:  // OWNER's org-admin queue. A THIN wire over POST /api/v1/change-requests - a SEPARATE plane
api/assets/panel-runtime/src/AssistantPanel.jsx:748:  /** Open the compose box (an explicit non-admin click). */
api/assets/panel-runtime/src/AssistantPanel.jsx:785:    else if (result.outcome === 'needs-login') setRequestMessage(REQUEST_COPY.needsLogin);
api/assets/panel-runtime/src/AssistantPanel.jsx:807:          {/* H2 detect-then-ask: a DISCREET, non-intrusive indicator that an admin capability
api/assets/panel-runtime/src/AssistantPanel.jsx:811:          {admin ? (
api/assets/panel-runtime/src/AssistantPanel.jsx:813:              className="ekoa-assistant-admin-badge"
api/assets/panel-runtime/src/AssistantPanel.jsx:814:              data-admin="true"
api/assets/panel-runtime/src/AssistantPanel.jsx:815:              title="Tem permissões de administrador nesta aplicação."
api/assets/panel-runtime/src/AssistantPanel.jsx:855:      {/* H3 admin bar - the OPT-IN edit-mode switch. Shown ONLY when detection said admin
api/assets/panel-runtime/src/AssistantPanel.jsx:857:          distinct control from the visitor mode toggle above, so an admin always knows they
api/assets/panel-runtime/src/AssistantPanel.jsx:859:      {admin ? (
api/assets/panel-runtime/src/AssistantPanel.jsx:860:        <div className="ekoa-assistant-adminbar">
api/assets/panel-runtime/src/AssistantPanel.jsx:861:          <span className="ekoa-assistant-adminbar-label">Modo de edição</span>
api/assets/panel-runtime/src/AssistantPanel.jsx:865:            aria-checked={editMode}
api/assets/panel-runtime/src/AssistantPanel.jsx:867:            data-on={editMode ? 'true' : 'false'}
api/assets/panel-runtime/src/AssistantPanel.jsx:868:            onClick={editMode ? closeEditMode : openEditMode}
api/assets/panel-runtime/src/AssistantPanel.jsx:873:            <span className="ekoa-assistant-editswitch-state">{editMode ? 'Ativado' : 'Desativado'}</span>
api/assets/panel-runtime/src/AssistantPanel.jsx:878:      {/* H3 admin discovery (proactive teaching): surfaced ONCE, discreetly, dismissibly, to a
api/assets/panel-runtime/src/AssistantPanel.jsx:879:          detected admin who has not yet opted in. It suggests the app is changeable and offers
api/assets/panel-runtime/src/AssistantPanel.jsx:881:      {admin && !editMode && !discoveryDismissed ? (
api/assets/panel-runtime/src/AssistantPanel.jsx:898:      {/* H3 edit affordance - a dedicated, visually distinct section (only when editMode is on).
api/assets/panel-runtime/src/AssistantPanel.jsx:900:      {admin && editMode ? (
api/assets/panel-runtime/src/AssistantPanel.jsx:901:        <section className="ekoa-assistant-edit" data-edit-phase={editPhase} aria-label="Modo de edição (administrador)">
api/assets/panel-runtime/src/AssistantPanel.jsx:904:            <span className="ekoa-assistant-edit-hint">Alterações à aplicação (administrador)</span>
api/assets/panel-runtime/src/AssistantPanel.jsx:1009:      {/* H4 change request (non-admins): a discreet "Pedir alteração" affordance for a viewer who
api/assets/panel-runtime/src/AssistantPanel.jsx:1011:          files to the owner's org-admin queue (requires a logged-in platform user; a 401 / no token
api/assets/panel-runtime/src/AssistantPanel.jsx:1012:          shows the calm "inicie sessão" note). Distinct from the admin edit switch (admin only). */}
api/assets/panel-runtime/src/AssistantPanel.jsx:1013:      {!admin ? (
api/assets/panel-runtime/src/AssistantPanel.jsx:1014:        <section className="ekoa-assistant-request" data-request-phase={requestPhase} aria-label="Pedir alteração">

hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,260p' web/app/'(dashboard)'/pedidos/page.tsx" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
"use client";

/**
 * Pedidos (change-requests queue) admin page (operator-run H4).
 *
 * The org-admin's queue over `GET /api/v1/change-requests`: change requests users filed from
 * inside a served app (or from a refused build). An org-admin sees its OWN org; a super-admin
 * gets an org filter (`?orgId=`) across orgs - the EXACT registo scoping. "Converter" starts a
 * patch run (an H1-gated follow-up build) and marks the request converted; "Dispensar" declines
 * it. A live `change_request` notification refetches the queue so a new request appears without a
 * reload. PT-PT strings.
 *
 * Admin-gated (org-admin + super-admin); reachable from the sidebar.
 */

import { useEffect } from "react";
import { Inbox, AlertTriangle } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useOrgsStore } from "@/stores/orgs";
import { useChangeRequestsStore } from "@/stores/change-requests";
import { openNotificationsStream } from "@/lib/api";
import { AdminGate } from "@/components/admin-gate";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import type { ChangeRequestStatus } from "@ekoa/shared";

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-PT");
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<ChangeRequestStatus, string> = {
  open: "Aberto",
  converted: "Convertido",
  dismissed: "Dispensado",
};
const STATUS_TONE: Record<ChangeRequestStatus, BadgeTone> = {
  open: "warning",
  converted: "success",
  dismissed: "neutral",
};

export default function PedidosPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isSuperAdmin = role === "super-admin";

  const requests = useChangeRequestsStore((s) => s.requests);
  const total = useChangeRequestsStore((s) => s.total);
  const statusFilter = useChangeRequestsStore((s) => s.statusFilter);
  const orgId = useChangeRequestsStore((s) => s.orgId);
  const isLoading = useChangeRequestsStore((s) => s.isLoading);
  const actingId = useChangeRequestsStore((s) => s.actingId);
  const error = useChangeRequestsStore((s) => s.error);
  const fetchRequests = useChangeRequestsStore((s) => s.fetchRequests);
  const setStatusFilter = useChangeRequestsStore((s) => s.setStatusFilter);
  const setOrgId = useChangeRequestsStore((s) => s.setOrgId);
  const convert = useChangeRequestsStore((s) => s.convert);
  const dismiss = useChangeRequestsStore((s) => s.dismiss);
  const clearError = useChangeRequestsStore((s) => s.clearError);

  const orgs = useOrgsStore((s) => s.orgs);
  const fetchOrgs = useOrgsStore((s) => s.fetchOrgs);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    if (isSuperAdmin) fetchOrgs();
  }, [isSuperAdmin, fetchOrgs]);

  // Live queue: a filed request pushes a `change_request` notification to this admin's channel;
  // refetch so it appears without a reload (mirrors the header's usage/branding subscriptions).
  useEffect(() => {
    const stream = openNotificationsStream();
    const off = stream.on("change_request", () => {
      void useChangeRequestsStore.getState().fetchRequests();
    });
    return () => {
      off();
      stream.close();
    };
  }, []);

  const orgNameById = new Map(orgs.map((o) => [o.id, o.displayName ?? o.name]));

  return (
    <AdminGate allowOrgAdmin>
      <PageShell width="wide" testId="pedidos-page">
        <PageHeader
          icon={Inbox}
          title="Pedidos"
          description="Pedidos de alteração enviados pelos utilizadores a partir das aplicações. Converta um pedido numa revisão ou dispense-o."
        />

        {error && (
          <Card className="flex items-center justify-between border-red-200 bg-red-50">
            <div className="flex items-center space-x-2 text-red-600">
              <AlertTriangle size={16} aria-hidden />
              <span className="text-sm">{error}</span>
            </div>
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={() => {
                clearError();
                fetchRequests();
              }}
            >
              Tentar novamente
            </Button>
          </Card>
        )}

        {/* Filters */}
        <Card padding="sm">
          <div className="flex flex-wrap items-end gap-3">
            {isSuperAdmin && (
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">Escritório</label>
                <Select
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  wrapperClassName="w-auto"
                  className="py-1.5"
                  data-testid="pedidos-filter-org"
                >
                  <option value="">Todos os escritórios</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.displayName ?? org.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Estado</label>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ChangeRequestStatus | "")}
                wrapperClassName="w-auto"
                className="py-1.5"
                data-testid="pedidos-filter-status"
              >
                <option value="open">Abertos</option>
                <option value="converted">Convertidos</option>
                <option value="dismissed">Dispensados</option>
                <option value="">Todos</option>
              </Select>
            </div>
          </div>
        </Card>

        {/* Table */}
        {isLoading && requests.length === 0 ? (
          <LoadingState label="A carregar pedidos..." />
        ) : requests.length === 0 ? (
          <EmptyState icon={Inbox} title="Sem pedidos de alteração." />
        ) : (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold tracking-wider text-neutral-400">PEDIDOS</h2>
              <span className="text-xs text-neutral-500">{total} pedidos</span>
            </div>
            <div className="overflow-x-auto">
              <Table data-testid="pedidos-table">
                <THead>
                  <TR>
                    <TH>Utilizador</TH>
                    <TH>Pedido</TH>
                    <TH>Aplicação</TH>
                    {isSuperAdmin && <TH>Escritório</TH>}
                    <TH>Data e hora</TH>
                    <TH>Estado</TH>
                    <TH>Ações</TH>
                  </TR>
                </THead>
                <TBody>
                  {requests.map((req) => (
                    <TR key={req.id} hover>
                      <TD className="text-sm font-medium text-neutral-800">{req.requesterName}</TD>
                      <TD className="max-w-md text-sm text-neutral-700">
                        <span className="line-clamp-3 whitespace-pre-wrap">{req.text}</span>
                        {req.route ? (
                          <span className="mt-1 block text-xs text-neutral-400">{req.route}</span>
                        ) : null}
                      </TD>
                      <TD className="text-xs text-neutral-500">{req.appId ?? "-"}</TD>
                      {isSuperAdmin && (
                        <TD className="text-xs text-neutral-500">
                          {orgNameById.get(req.orgId) ?? req.orgId}
                        </TD>
                      )}
                      <TD className="text-xs text-neutral-500">{formatTimestamp(req.createdAt)}</TD>
                      <TD>
                        <Badge tone={STATUS_TONE[req.status]}>{STATUS_LABEL[req.status]}</Badge>
                      </TD>
                      <TD>
                        {req.status === "open" ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={actingId === req.id}
                              onClick={() => convert(req.id)}
                            >
                              Converter
                            </Button>
                            <Button
                              variant="danger-ghost"
                              size="sm"
                              disabled={actingId === req.id}
                              onClick={() => dismiss(req.id)}
                            >
                              Dispensar
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-400">-</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
        )}
      </PageShell>
    </AdminGate>
  );
}

codex
I’ve got the client-side trust points too. I’m grabbing exact numbered ranges for the two drifts so the findings can be tied to the end-to-end path without hand-waving.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/auth/middleware.ts | sed -n '20,80p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

exec
/bin/zsh -lc "nl -ba api/src/apps/app-assistant-route.ts | sed -n '100,130p'; printf '\\n---\\n'; nl -ba api/src/apps/app-assistant-route.ts | sed -n '236,275p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

---
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

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '340,380p'; printf '\\n---\\n'; nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '807,870p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   340	    if (defaultOpen && textareaRef.current) textareaRef.current.focus();
   341	    // Mount-only: the handoff intent is fixed at mount time.
   342	  }, [defaultOpen]);
   343	
   344	  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
   345	  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
   346	  // cross-origin/sandboxed iframe throws) and attaches it as an OPTIONAL Bearer alongside the
   347	  // X-Ekoa-App-Id header the POST path already sends. This is a cheap non-LLM GET - it does NOT
   348	  // count as an assistant turn (zero-token invariant). The result only lights the discreet
   349	  // indicator; it NEVER auto-enables anything and issues no privileged call (edit mode is H3).
   350	  useEffect(() => {
   351	    const id = appId();
   352	    // No app id (standalone preview) or already detected once -> nothing to do. Empty deps make
   353	    // this a mount-only effect; the ref keeps detection to exactly ONE request per mounted panel
   354	    // even if the effect is ever re-entered. The panel-runtime entry mounts WITHOUT StrictMode.
   355	    if (!id || whoamiDoneRef.current) return;
   356	    whoamiDoneRef.current = true;
   357	
   358	    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
   359	    const token = readPlatformToken();
   360	    void (async () => {
   361	      try {
   362	        const res = await fetch(WHOAMI_ENDPOINT, {
   363	          method: 'GET',
   364	          ...(controller ? { signal: controller.signal } : {}),
   365	          headers: {
   366	            'X-Ekoa-App-Id': id,
   367	            // OPTIONAL: sent only when a same-origin token was readable. Absent -> the server
   368	            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
   369	            ...(token ? { Authorization: `Bearer ${token}` } : {}),
   370	          },
   371	        });
   372	        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
   373	        const data = await res.json();
   374	        setAdmin(!!(data && data.admin === true));
   375	      } catch {
   376	        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
   377	      }
   378	    })();
   379	
   380	    return () => {

---
   807	          {/* H2 detect-then-ask: a DISCREET, non-intrusive indicator that an admin capability
   808	              exists. It does NOTHING - no click handler, no mode change, no privileged call. The
   809	              opt-in edit-mode switch is H3. Styled inline (brand-neutral via the panel CSS vars)
   810	              so it inherits the app's theme without a bespoke stylesheet rule. */}
   811	          {admin ? (
   812	            <span
   813	              className="ekoa-assistant-admin-badge"
   814	              data-admin="true"
   815	              title="Tem permissões de administrador nesta aplicação."
   816	              style={{
   817	                fontSize: 'var(--text-sm, 0.8125rem)',
   818	                fontWeight: 600,
   819	                color: 'var(--color-text-muted, #475569)',
   820	                border: '1px solid var(--color-border, #E2E8F0)',
   821	                borderRadius: 'var(--radius-sm, 0.375rem)',
   822	                padding: '0.05rem 0.4rem',
   823	                lineHeight: 1.4,
   824	                letterSpacing: '0.02em',
   825	                whiteSpace: 'nowrap',
   826	              }}
   827	            >
   828	              Administrador
   829	            </span>
   830	          ) : null}
   831	        </span>
   832	        <button type="button" className="ekoa-assistant-close" onClick={collapsePanel} aria-label="Fechar o assistente">
   833	          <CloseIcon />
   834	        </button>
   835	      </header>
   836	
   837	      <div className="ekoa-assistant-modes" role="group" aria-label="Modo do assistente">
   838	        {MODES.map((m) => (
   839	          <button
   840	            key={m.id}
   841	            type="button"
   842	            className="ekoa-assistant-mode"
   843	            aria-pressed={mode === m.id}
   844	            onClick={() => {
   845	              // Pin the picked mode (click the pinned one again to unpin, back to inference).
   846	              setPinnedMode((prev) => (prev === m.id ? null : m.id));
   847	              setMode(m.id);
   848	            }}
   849	          >
   850	            {m.label}
   851	          </button>
   852	        ))}
   853	      </div>
   854	
   855	      {/* H3 admin bar - the OPT-IN edit-mode switch. Shown ONLY when detection said admin
   856	          (detect-then-ask); OFF by default; flipped only by this explicit click. It is a
   857	          distinct control from the visitor mode toggle above, so an admin always knows they
   858	          are entering a different plane (editing the app, not chatting as a visitor). */}
   859	      {admin ? (
   860	        <div className="ekoa-assistant-adminbar">
   861	          <span className="ekoa-assistant-adminbar-label">Modo de edição</span>
   862	          <button
   863	            type="button"
   864	            role="switch"
   865	            aria-checked={editMode}
   866	            className="ekoa-assistant-editswitch"
   867	            data-on={editMode ? 'true' : 'false'}
   868	            onClick={editMode ? closeEditMode : openEditMode}
   869	          >
   870	            <span className="ekoa-assistant-editswitch-track" aria-hidden="true">

exec
/bin/zsh -lc "nl -ba api/src/routes/change-requests.ts | sed -n '35,66p'; printf '\\n---\\n'; nl -ba api/src/services/change-requests.ts | sed -n '46,80p'; printf '\\n---\\n'; nl -ba web/stores/change-requests.ts | sed -n '78,112p'; printf '\\n---\\n'; nl -ba api/src/routes/jobs.ts | sed -n '41,64p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

---
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
   111	    }
   112	    await get().fetchRequests();

---
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

codex
**Findings**
- Medium: H2/H3 admin detection does not mirror the H1 edit gate once `billingLocked` is set, so a locked admin can still be shown as `admin:true` and get the H3 edit affordance, but the actual patch run is then refused by `/api/v1/jobs`. `requireAuth` enforces `billingLocked` at [api/src/auth/middleware.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/middleware.ts:22) and [api/src/auth/middleware.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/middleware.ts:52), but `verifySseToken` does not at [api/src/auth/middleware.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/middleware.ts:59). H2 detection relies on that helper at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:110) and returns the result from `whoami` at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:255). The panel trusts that boolean to show the admin badge/edit switch at [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:344) and [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:855). Concrete cross-slice scenario: org-admin logs in, account is later billing-locked, `GET /api/app-assistant/whoami` still returns `admin:true`, H3 offers edit mode, then H1 blocks the follow-up `POST /api/v1/jobs` with `BILLING_LOCKED`.
- Low: H4’s queue/convert flow is wider than H1’s writable-edit policy for same-org private apps, so it creates a false “Converter” path that can never succeed. Filing allows any readable served app, including the requester’s own private app, at [api/src/routes/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:46) and [api/src/routes/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:57); the request is then stamped into the owner org queue at [api/src/services/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:54). The dashboard always turns any `request.appId` into a follow-up build at [web/stores/change-requests.ts](/Users/ggomes/dev/ekoa-code/web/stores/change-requests.ts:82), but H1 correctly 404s org-admin conversion on another user’s private app via `loadWritable` at [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:44) and [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:59). Concrete cross-slice scenario: user files from their own private app, org-admin sees it in `/pedidos`, clicks “Converter”, and gets a server refusal every time.

**Verified coherent**
- No H3 or H4 path bypasses H1. Both edit mode and request-convert ultimately drive the same gated `POST /api/v1/jobs` path, so I did not find a build/edit authorization bypass.
- H2 `whoami` is otherwise aligned with H1 on role/org/writability and remains fail-closed/oracle-free for bad tokens and cross-org app ids.
- The `builder` -> `user` migration/shim is coherent on the reviewed production paths: rows are migrated at boot, epochs are bumped durably, and legacy JWT normalization happens at the single `verifyToken` chokepoint.
- Revocation durability itself looks coherent: boot reloads `active`/`billingLocked`/`tokenEpoch`, and role/password/deactivation flows persist the epoch/lock before or alongside cache updates.
- Cross-org isolation across assistant grounding, request filing, queue read/convert/dismiss, and follow-up edit gating is consistent in the reviewed code.
- The H5 live journey outputs are coherent for the supported paths they exercise: admin edit journey passes end to end, and request-changes passes for an org-shared app with a cross-org filing blocked.

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
165,196
**Findings**
- Medium: H2/H3 admin detection does not mirror the H1 edit gate once `billingLocked` is set, so a locked admin can still be shown as `admin:true` and get the H3 edit affordance, but the actual patch run is then refused by `/api/v1/jobs`. `requireAuth` enforces `billingLocked` at [api/src/auth/middleware.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/middleware.ts:22) and [api/src/auth/middleware.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/middleware.ts:52), but `verifySseToken` does not at [api/src/auth/middleware.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/middleware.ts:59). H2 detection relies on that helper at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:110) and returns the result from `whoami` at [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:255). The panel trusts that boolean to show the admin badge/edit switch at [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:344) and [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:855). Concrete cross-slice scenario: org-admin logs in, account is later billing-locked, `GET /api/app-assistant/whoami` still returns `admin:true`, H3 offers edit mode, then H1 blocks the follow-up `POST /api/v1/jobs` with `BILLING_LOCKED`.
- Low: H4’s queue/convert flow is wider than H1’s writable-edit policy for same-org private apps, so it creates a false “Converter” path that can never succeed. Filing allows any readable served app, including the requester’s own private app, at [api/src/routes/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:46) and [api/src/routes/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/change-requests.ts:57); the request is then stamped into the owner org queue at [api/src/services/change-requests.ts](/Users/ggomes/dev/ekoa-code/api/src/services/change-requests.ts:54). The dashboard always turns any `request.appId` into a follow-up build at [web/stores/change-requests.ts](/Users/ggomes/dev/ekoa-code/web/stores/change-requests.ts:82), but H1 correctly 404s org-admin conversion on another user’s private app via `loadWritable` at [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:44) and [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:59). Concrete cross-slice scenario: user files from their own private app, org-admin sees it in `/pedidos`, clicks “Converter”, and gets a server refusal every time.

**Verified coherent**
- No H3 or H4 path bypasses H1. Both edit mode and request-convert ultimately drive the same gated `POST /api/v1/jobs` path, so I did not find a build/edit authorization bypass.
- H2 `whoami` is otherwise aligned with H1 on role/org/writability and remains fail-closed/oracle-free for bad tokens and cross-org app ids.
- The `builder` -> `user` migration/shim is coherent on the reviewed production paths: rows are migrated at boot, epochs are bumped durably, and legacy JWT normalization happens at the single `verifyToken` chokepoint.
- Revocation durability itself looks coherent: boot reloads `active`/`billingLocked`/`tokenEpoch`, and role/password/deactivation flows persist the epoch/lock before or alongside cache updates.
- Cross-org isolation across assistant grounding, request filing, queue read/convert/dismiss, and follow-up edit gating is consistent in the reviewed code.
- The H5 live journey outputs are coherent for the supported paths they exercise: admin edit journey passes end to end, and request-changes passes for an org-shared app with a cross-org filing blocked.

VERDICT: NEEDS-WORK
