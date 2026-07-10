- 2026-07-07T10:35:08Z [e2e] web/e2e/legal-insolvencias.spec.ts "rateio 1200" conta_corrente assertion failed once on a back-to-back e2e:server re-run (2nd run of the same 07:03 dist; 1st and 3rd runs green 127/127). Suspected intra-run ordering/state nondeterminism in the rateio flow, not code. Watch; if it recurs, pin the seeded credores state before the rateio assertion.
- 2026-07-07T18:38:04Z [e2e] legal served-app journey specs (legal-suite-journey step 9 legal-financas "despesa not created"; legal-transcricao excerto-bloco toContainText 5000ms) flake under heavy machine load at the tail of the 127-spec suite. Non-deterministic: two consecutive full runs each failed a DIFFERENT legal spec/assertion; the web e2e suite is unchanged since gate-7b (green 127/127 there). Environmental (session load), not a G8 regression. Watch; if it recurs on a quiescent machine, raise the tight per-assertion timeouts on the tail legal specs or shard the legal journey.
- 2026-07-08T09:50:18Z: api vitest suite hung on a mongo-memory-server test (worker 0% CPU, mongod up but blocked) when ci:lane ran concurrently with a colima docker VM under heavy load. NOT a code regression (identical suite passed in the prior ci:lane). Remediation: don't run ci:lane concurrently with docker image builds/colima; stop colima before the final lane.

## boot-b seeded OAuth token rotated externally mid-test (2026-07-09, resume host)
The operator's live Claude Code session refreshes `~/.claude/.credentials.json` periodically (and on
`/login`); boot-b deliberately seeds a NO-REFRESH snapshot of the access token into mem-mongo. When
the file rotates after boot, the seeded token is invalidated upstream: chat turns fail with provider
401 -> gateway `forward failed: OAuth refresh not configured` -> client 502. NOT a code defect.
Remedy: re-run `node docs/release/probes/boot-b.mjs up` (re-seeds the current token) and re-drive the
turn promptly; avoid long-lived boot-b stacks for live-turn evidence while a Claude session is active.

## RESOLVED (2026-07-09): boot-b now uses a DEDICATED Cortex account, never the local Claude Code login
Root cause of the token-rotation flake above: boot-b seeded the LOCAL Claude Code account's OAuth
access token and the gateway then used it live from a second client, which invalidated the
operator's Claude Code session (repeated forced /login mid-run). boot-b now resolves its credential
from `$EKOA_CLAUDE_CREDENTIALS` or `~/.config/ekoa/claude-credentials.json` (a dedicated account:
`claude setup-token` output or an API key) and REFUSES to boot without it; the legacy local-token
path is behind an explicit `EKOA_USE_LOCAL_CLAUDE_CREDS=1` with loud warnings. Provisioning notes
live at the top of docs/release/probes/boot-b.mjs.

## CORRECTED (2026-07-10, batch-final): the "ci:lane exit 1 with all tests passing" was NOT a mongo flake
The repeated 'api vitest exits 1 though every test passed' during batch-final was the F3 terminal-build
audit: an unguarded getJob() in build.ts's finally, on the fire-and-forget executeBuildJob, threw an
unhandled rejection when an in-flight job completed after a contract test closed mongo. Fixed (try/catch
+ test-teardown drain) in the s3 review-round. If ci:lane exits 1 with all-green again, first check for
NEW unguarded async in a fire-and-forget pipeline before assuming mongo-memory-server teardown.
