- 2026-07-07T10:35:08Z [e2e] web/e2e/legal-insolvencias.spec.ts "rateio 1200" conta_corrente assertion failed once on a back-to-back e2e:server re-run (2nd run of the same 07:03 dist; 1st and 3rd runs green 127/127). Suspected intra-run ordering/state nondeterminism in the rateio flow, not code. Watch; if it recurs, pin the seeded credores state before the rateio assertion.
- 2026-07-07T18:38:04Z [e2e] legal served-app journey specs (legal-suite-journey step 9 legal-financas "despesa not created"; legal-transcricao excerto-bloco toContainText 5000ms) flake under heavy machine load at the tail of the 127-spec suite. Non-deterministic: two consecutive full runs each failed a DIFFERENT legal spec/assertion; the web e2e suite is unchanged since gate-7b (green 127/127 there). Environmental (session load), not a G8 regression. Watch; if it recurs on a quiescent machine, raise the tight per-assertion timeouts on the tail legal specs or shard the legal journey.
- 2026-07-08T09:50:18Z: api vitest suite hung on a mongo-memory-server test (worker 0% CPU, mongod up but blocked) when ci:lane ran concurrently with a colima docker VM under heavy load. NOT a code regression (identical suite passed in the prior ci:lane). Remediation: don't run ci:lane concurrently with docker image builds/colima; stop colima before the final lane.

## boot-b seeded OAuth token rotated externally mid-test (2026-07-09, resume host)
The operator's live Claude Code session refreshes `~/.claude/.credentials.json` periodically (and on
`/login`); boot-b deliberately seeds a NO-REFRESH snapshot of the access token into mem-mongo. When
the file rotates after boot, the seeded token is invalidated upstream: chat turns fail with provider
401 -> gateway `forward failed: OAuth refresh not configured` -> client 502. NOT a code defect.
Remedy: re-run `node api/tests/journeys/boot-b.mjs up` (re-seeds the current token) and re-drive the
turn promptly; avoid long-lived boot-b stacks for live-turn evidence while a Claude session is active.

## RESOLVED (2026-07-09): boot-b now uses a DEDICATED Cortex account, never the local Claude Code login
Root cause of the token-rotation flake above: boot-b seeded the LOCAL Claude Code account's OAuth
access token and the gateway then used it live from a second client, which invalidated the
operator's Claude Code session (repeated forced /login mid-run). boot-b now resolves its credential
from `$EKOA_CLAUDE_CREDENTIALS` or `~/.config/ekoa/claude-credentials.json` (a dedicated account:
`claude setup-token` output or an API key) and REFUSES to boot without it; the legacy local-token
path is behind an explicit `EKOA_USE_LOCAL_CLAUDE_CREDS=1` with loud warnings. Provisioning notes
live at the top of api/tests/journeys/boot-b.mjs.

## CORRECTED (2026-07-10, batch-final): the "ci:lane exit 1 with all tests passing" was NOT a mongo flake
The repeated 'api vitest exits 1 though every test passed' during batch-final was the F3 terminal-build
audit: an unguarded getJob() in build.ts's finally, on the fire-and-forget executeBuildJob, threw an
unhandled rejection when an in-flight job completed after a contract test closed mongo. Fixed (try/catch
+ test-teardown drain) in the s3 review-round. If ci:lane exits 1 with all-green again, first check for
NEW unguarded async in a fire-and-forget pipeline before assuming mongo-memory-server teardown.

## Stale ~/.ekoa/claude-auth.json snapshot fails live turns silently (2026-07-12, operator-run B1)
Provisioning the dev stack from the LEGACY ~/.ekoa/claude-auth.json (old cortex auth store) passes
/health claudeAuth.ok=true but live turns hang then die ADAPTER_ERROR — the snapshot rotates with the
operator's live Claude session (same class as the 2026-07-09 boot-b flake). NOT a code defect.
Remedy: use the DEDICATED account path — node api/tests/journeys/boot-b.mjs up (reads
$EKOA_CLAUDE_CREDENTIALS / ~/.config/ekoa/claude-credentials.json) instead of driver.mjs up +
provision-credential.mjs with a scavenged token.

## coherence-locale: header EN flip fails only in large multi-spec batches (RESOLVED 2026-07-18)
Root-caused the same day (was NOT a flake and was unrelated to language): the failing
assertion was the zero-console-error gate catching a 404 DELETE /api/v1/sessions/<id>. The
chat runtime (OS-mode run 1) initializes on every shell mount, so the surplus-empty-session
sweep ran on every page load; a fast navigation re-listed a session whose fire-and-forget
delete from the previous mount was still in flight, and the re-delete 404d in the console.
Deterministic repro: chat-thinking then coherence-locale. Fixed in orchestration.ts by
tracking swept session ids per tab (sessionStorage) so an id is only ever deleted once.

## RESOLVED (2026-07-27): `verify-runner.test.ts` "expires and rejects tampering" — NOT a flake, a cross-file env clobber
Root-caused the same day rather than logged as environmental. `tests/security/canvas-token-class.test.ts`
(added by the Cofre F-1 work) set `process.env.JWT_SECRET = 's'` UNCONDITIONALLY in `beforeAll`.
Vitest workers share `process.env` across test FILES, so that assignment could change the signing
secret out from under `verify-runner.test.ts` between its `mintPreviewToken` and
`verifyPreviewToken` — which straddle a `__resetConfigForTests()` — making a valid token verify as
tampered. Intermittent because it depended on file scheduling. Fixed by using `??=` there: the
suite does not care WHICH secret is in play, only that it is stable. NOTE the wider hazard: several
older contract tests also assign these vars unconditionally, so the same class of interference is
latent elsewhere. Prefer `??=` in any new test that touches `JWT_SECRET` / `ENCRYPTION_KEY`.
## api vitest: one unreproduced failure on the post-rebase run (2026-07-29, Cofre J-2..J-7 push)

A single api test failed on the first full run after rebasing the Cofre J-work onto origin/main
(252 files, 1 failed / 2616 passed). It did NOT reproduce: three subsequent full-suite runs were
252/252 green, and five back-to-back runs of the two timing-sensitive new suites
(`bridge-replay`, `bridge-audit`) were 21/21 each. The failing test name was not captured before the
re-run, so this is logged as an unattributed one-off rather than guessed at.

**Structural hazard closed in the same change, because it is the shape this repo has been bitten by
before.** J-6 writes bridge Registo rows FIRE-AND-FORGET from `delegation.ts` (a delegation must not
fail because a bookkeeping row could not be written). The CORRECTED 2026-07-10 entry above records
that a previous "every test passed but the lane exited 1" was exactly that: an unguarded write in a
fire-and-forget pipeline landing after a test closed mongo. Two aggravating factors here — several
suites assert on `activityLogs` contents, and `write-approval.test.ts` drives `delegateToLocal`
with no mongo at all, so its audit writes reject and are swallowed.

`bridge/audit.ts` now TRACKS in-flight writes and exports `drainBridgeAudit()`, called in the
teardown of both suites that fire them. Production never drains; teardown does. If an api-suite
flake recurs, check for a NEW untracked async write before assuming mongo-memory-server teardown —
same advice as the 2026-07-10 entry, now with a drain helper to hang it on.
