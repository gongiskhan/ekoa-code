
## Stale ~/.ekoa/claude-auth.json snapshot fails live turns silently (2026-07-12, operator-run B1)
Provisioning the dev stack from the LEGACY ~/.ekoa/claude-auth.json (old cortex auth store) passes
/health claudeAuth.ok=true but live turns hang then die ADAPTER_ERROR — the snapshot rotates with the
operator's live Claude session (same class as the 2026-07-09 boot-b flake). NOT a code defect.
Remedy: use the DEDICATED account path — node api/tests/journeys/boot-b.mjs up (reads
$EKOA_CLAUDE_CREDENTIALS / ~/.config/ekoa/claude-credentials.json) instead of driver.mjs up +
provision-credential.mjs with a scavenged token.
