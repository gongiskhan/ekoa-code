# F25: host / operator context surfaced in a tenant chat reply - REPRODUCE against prod posture before fixing

**Severity / class:** high [CAVEATED - IF reproduced] / bug (multi-tenant isolation). NOT yet a confirmed
prod leak - this is a local-harness observation.

**Symptom:** A tenant chat reply (org MemCo, user m-u1) surfaced the OPERATOR's host context: the local path
`~/dev/ekoa-code` and the operator's Claude Code auto-memory ("Ekoa rebuild"), neither belonging to the
tenant. Evidence: `docs/release/evidence/J4-memory/context-bleed.json` (full reply + caveat). Observed on
the LOCAL credentialed harness (operator OAuth token + local Agent SDK subprocess with host filesystem in
reach). If it reproduces against the intended production chokepoint/sandbox, it is cross-host/tenant data
exposure.

**STEP 0 - REPRODUCE-OR-DISMISS (this brief is confirm-first; do NOT overclaim a prod leak):** stand up the
INTENDED production posture - subprocess pointed at the chokepoint via `ANTHROPIC_BASE_URL`, no operator
`~/.claude` on the host, isolated HOME/cwd - and run the same J4 turn ("Como se chama a minha empresa?")
for a tenant whose KB/memory is empty. If NO host path/profile appears, DISMISS IN WRITING (local-harness
artefact: operator home + repo cwd) and downgrade. If host context still appears, proceed to the fix.

**Root cause candidates (verified against code):** the static posture already blocks the obvious vectors,
which is why this must be reproduced, not assumed:
- `api/src/llm/credentials.ts` `buildSubprocessEnv` :265-282 scrubs provider env and drops `CLAUDECODE`,
  but sets `HOME` ONLY when `opts.homeDir` is passed (:279). Chat runs pass no `homeDir` and no `cwd`
  (`agents/chat.ts` :139-154), so the subprocess inherits the API server's HOME (operator home) and
  `process.cwd()` = `~/dev/ekoa-code`. That inherited cwd alone explains the `~/dev/ekoa-code` string (the
  SDK tells the model its working directory).
- `api/src/llm/client.ts` `sdkOptions` :320 sets `settingSources: []` (no user/project/local settings, so
  `~/.claude` and repo `CLAUDE.md` should NOT load) and chat `allowedTools` is knowledge-only
  (`agents/tools.ts` :39, `KNOWLEDGE_TOOLS`) - so file reads and profile/memory loading are, on paper,
  blocked. The load-bearing UNKNOWN is how "Ekoa rebuild" (an operator auto-memory) reached the model
  despite this - reproduce to learn whether the SDK still injects host memory/cwd context or the model
  inferred it from the cwd name.

**Fix scope (IF reproduced):** give hosted chat + automation subprocesses the same isolation build runs get -
an isolated `HOME` and `cwd` pointed at an empty per-run sandbox dir (extend `buildSubprocessEnv`/the
`agents/*` run options so chat/automation pass `homeDir` + `cwd`, not just build), and confirm
`settingSources: []` + the knowledge-only allow-list actually gate the subprocess in prod. Files:
`api/src/llm/credentials.ts`, `api/src/agents/chat.ts` (+ automation run site), `api/src/llm/client.ts`
sdkOptions. NON-goals: do not widen chat tools; do not inject any host memory into tenant runs; keep the
egress chokepoint the sole transport (no new base URL).

**Regression test first:** unit test `api/tests/llm/credentials.test.ts` - `buildSubprocessEnv` for a chat/
automation run sets `HOME` to the sandbox (not the inherited home) and does not leak an operator path;
assert the scrub list holds. Plus an `api/tests/agents/` assertion that chat/automation run options carry an
isolated `cwd`/`homeDir`. A deterministic isolation-class contract test (fake transport) asserting no host
path can enter a tenant prompt. All LLM-free.

**Acceptance:** with the prod posture, a tenant chat for an empty-KB user returns no host path or operator
memory; subprocess HOME/cwd are a per-run sandbox; allow-list + `settingSources:[]` verified; the
reproduce probe is green or the finding is dismissed in writing with evidence.

**Notes:** this is the LLM egress + subprocess-sandbox surface (significance-labelled -> adversarial + Codex
security review). Frame severity as high-ONLY-IF-reproduced. If the subprocess env/cwd contract changes,
update the ch05 §5.4.1 subprocess-env diagram (FIXED-12). Ties to [[F21-memory-recall-not-injected]] (same
turn; the tenant's own memory was not recalled while host context was).
