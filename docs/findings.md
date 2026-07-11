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

### Gateway / egress

- **`gateway-502-masks-401`** (medium). A terminal credential rejection is reported to the client as a
  retryable `502` by the `gateway.ts` catch-all, producing a retry storm; `/health` reports the truth.
  Deferred to a `llm/` chokepoint slice.
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
- **`apps-embed-frame-headers`** (medium, security). The dashboard cannot iframe a served artifact
  because the served-app plane sets `frame-ancestors 'self'`/`SAMEORIGIN` and the dashboard is a
  different origin; the `/apps` embed allowlist is not built. Scheduled as the deferred security task
  of this run. Tracked: `docs/security.md`.
- **`web-sourceinput-divergence`** (medium). A web/`shared` `SourceInput` divergence makes a seed-
  template knowledge source 400 from the UI.
- **`login-double-session`** (minor, dev-only). The login landing double-creates sessions (React
  StrictMode double-mount of the eager empty-session create); dev-DB orphan-row noise. The write should
  be idempotent/effect-guarded.
- **`chat-sse-discovery`** (deferred, batch-2). S1 adversarial-tester discovery set: chat-SSE late-
  subscriber gap, run hangs on upstream auth failure, temp-session 404 persist.
- **`web-tests-untypechecked`** (low, batch-2). Web `__tests__` are excluded from tsc, so web test
  files are never typechecked.

### Operator-blocked / external

- **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
  on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
  (`docs/operations-runbook.md`).
- **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
  commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
  is already at `af8b556`).

## Recently fixed - 2026-07-11 stabilization run

- **`registo-targetIds`** - `registoEntry.targetIds` emitted the metadata object where the schema
  wants `array(Id)`, failing `RegistoListResponse` validation; now derives ids from id-keyed metadata.
  Verified live.
- **`/users` + `/usage` crashes** - undefined `.toLocaleString()`; `adminListUsage` now left-joins
  users and emits the full gauge surface, `fmtTokens` on totals.
- **integrations page crash** - the session stub now answers `sessionConnect` + `actions`
  (`SessionCaptureStatus` carries both).
- **artifact versions 500** - `readVersions` graceful dual-jail for never-built artifacts and the
  featured list. (Featured-artifact `restoreVersion` remains open - see `restoreVersion-featured-500`.)
- **`knowledge.listUploads`** `_id`->`id`; **`ekoaLocal.llmModels`** `{data}` envelope; **servedApp**
  `appDataList`/`appSharedList` envelope - contract fold-ins.
- **artifact thumbnails** - previously unimplemented; now end-to-end (build-mechanics screenshot seam,
  `/artifact-screenshots` static mount, `Artifact.screenshotUrl`, dev CSP `img-src`).
- **automations planner failures** - TRUE ROOT CAUSE: the SDK option was `customSystemPrompt`, ignored
  by Agent SDK 0.2.118 (the option is `systemPrompt`), so EVERY system prompt was silently dropped on
  the live path - the planner never saw the required JSON shape. Fixed, plus `runOneShot` `maxTurns`
  1->3 for thinking-heavy EXPERT one-shots, plus a distinct `plan_unavailable` wire status for egress
  outages (never "reformule o objetivo" for a dead transport).
- **brand research not persisting** - the agent now emits a structured `BrandResearchResult` that is
  merge-written onto `org.branding`.
- **gateway always-FAST clamp** - amended: a request whose model matches one of the three configured
  tier models now runs AND meters at that tier (EXPERT ~20x FAST cost - deliberate); other models keep
  the FAST clamp. This un-starved the strict-JSON EXPERT planner and thinking-heavy builds.
- **`<ekoa-context>` reinjection** - the persisted context block was never re-injected on the next
  turn; now re-injected (`agents/context.ts`).
- **thinking channel** (2026-07-10) - intermediate commentary self-identifying as the engine briefly
  flashed unredacted; now a first-class `thinking_chunk` channel, server-side branding-redacted, and
  `result.text` is answer-only (which also fixed the persisted-answer contamination).

## Previously fixed - rc-1 release hardening + batch-final (2026-07-08..10)

All fixed-verified with committed tests: **F1** (auth lifecycle - refresh/logout/password/device +
jti revoke), **F2** (credential provisioning + live turn), **F3** (Registo CRUD/login/build write
coverage, metadata-only, org-scoped), **F4** (branding research + `PUT /branding` alias), **F5**
(UI-called endpoints mounted + mount-coverage drift gate), **F6** (terminal JSON-envelope 404),
**F7** (honest failed-build serving state + `Job.error`), **F10** (per-org deny-list resolver wired +
org-admin CRUD + live masking proof), **F11** (session rename `name`/`title` + `createdAt`/`updatedAt`),
**F13** (stale `credentials.ts` header), **F16/F28** (build served the untouched scaffold and verify
passed it - `BUILD_UNFULFILLED`/`VERIFY_FAILED` terminals + live J3 re-proof), **F20** (chat result
truncation - persisted == concatenated chunks), **F21** (memory recall injection wired + backfilled
test), **F22** (`memoryView` omitted `orgId`/`tags` - `/memory` rendered 0 cards), **F23** (7 console
errors on `/memory`), **F25** (host-context bleed - mechanism reproduced, hardened, accepted residual
documented), **F26** (de-anon round-trip broken by model whitespace reformatting - format-tolerant
detokenizer + 13k-case security property), **F29** (automation plan-from-goal 500 -> structured
`plan_failed` 200). **F19** was a verified billing PASS (no fix).

## Accepted / by-design / won't-fix

- **collections-engine access rules defined-not-enforced** (tracked `docs/decisions.md` 2026-07-07).
  The per-collection `access`/`declaredOnly`/field/size rules are defined in
  `data/collections-engine.ts` but not threaded end-to-end: no producer (app manifest) declares
  `collections`, so the plane runs at the safe default (schemaless, 256 KiB, app-scope). Not
  exploitable. Close both halves together when a producer lands: wire the manifest's `collections`
  block onto `artifact.collections` AND thread the resolved rule into the engine + gate `access`
  levels in `served-data.ts`.
- **served-app per-app data plane open posture** (by-design). `/api/app-data` is unauthenticated app-
  global storage scoped only by `X-Ekoa-App-Id`, carried verbatim for byte-compatibility; private data
  belongs on the server-authenticated shared/JWT/SSO planes. Documented in `docs/security.md`.
- **subprocess PATH home-path residual** (by-design). The agent subprocess inherits the operator's
  home on `PATH`; accepted residual from the F25 hardening (disposition doc committed).
- **`sweepOrphans` boot-recovery gap** (accepted). Boot-time crash recovery flips orphaned jobs to
  `failed{ORPHANED}` without a Registo row; guaranteed-once holds on the normal live path.
- **F9** (won't-fix-minor). Trigger disable (410) is unreachable over the API (delete-only lifecycle).
- **F24** (won't-fix-minor). Extraction can persist a markdown-only junk memory (`**`).
- **F27** (won't-fix-minor). `GET /registo?type=anonymisation` returns 0 rows - filter-granularity
  confusion (the qualified query returns all rows); not a missing row.
- **F30** (won't-fix-minor). Builds do not emit a `memory-extract` billing row (build post-run
  extraction differs from the chat path).
