
## Stale ~/.ekoa/claude-auth.json snapshot fails live turns silently (2026-07-12, operator-run B1)
Provisioning the dev stack from the LEGACY ~/.ekoa/claude-auth.json (old cortex auth store) passes
/health claudeAuth.ok=true but live turns hang then die ADAPTER_ERROR — the snapshot rotates with the
operator's live Claude session (same class as the 2026-07-09 boot-b flake). NOT a code defect.
Remedy: use the DEDICATED account path — node api/tests/journeys/boot-b.mjs up (reads
$EKOA_CLAUDE_CREDENTIALS / ~/.config/ekoa/claude-credentials.json) instead of driver.mjs up +
provision-credential.mjs with a scavenged token.

## build-failure.test.ts "TypeError: fetch failed" under machine load (2026-07-17, run 20260717 S7)
All 5 tests in api/tests/contract/build-failure.test.ts failed with a bare `TypeError: fetch failed`
(no assertion error) during the S7 full-lane run while the dev stack + walkthrough recorder + concurrent
test mongods loaded the machine. Re-ran the file in ISOLATION immediately after: 5/5 green in 3.6s.
NOT a code defect (S7 touches only the llm vault-key derivation). Class: connection-level flake when a
listen(0) test server races other listeners under heavy concurrent load. Remedy if recurrent: quiet the
machine (stop the dev stack) before the full lane, or bump the file's boot wait.

## Lane-concurrency vitest connection flakes recurred (2026-07-17, run 20260717-190134 A0)
Full ci:lane (api+web vitest concurrent, session under load): 9 tests / 1 file failed with the
connection-class signature; same file estate re-run in isolation on a quiet machine: 190/190 green.
File identity not captured (lane output truncated by a tail pipe - avoid piping the lane; capture to
a log file). Remedy stands: quiet machine for full-lane runs, or re-run the failing file in isolation.
