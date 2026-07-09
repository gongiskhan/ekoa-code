# F25 disposition — host / operator context in a tenant chat reply

**Run:** 20260708-203034-41fe4774 (batch-1, slice 7 `f25-disposition`) · **Written:** 2026-07-10
**Verdict:** **mechanism reproduced deterministically + hardened + tested; live end-to-end reproduce
DEFERRED (blocked on a dedicated model credential).** Severity was framed "high ONLY IF reproduced
against prod posture"; the isolation fix ships as defense-in-depth regardless, so the residual risk
is closed whether or not the original live symptom was a prod leak or a local-harness artefact.

## What was observed (the original finding)

A tenant chat reply (org MemCo, user m-u1) surfaced the OPERATOR's host context — the local path
`~/dev/ekoa-code` and an operator Claude Code auto-memory ("Ekoa rebuild") — neither belonging to the
tenant. Captured on the LOCAL credentialed harness (operator OAuth token + a local Agent SDK
subprocess with the host filesystem in reach). Evidence: `docs/release/evidence/J4-memory/context-bleed.json`.

## The mechanism — reproduced deterministically (LLM-free)

The brief's Step 0 asks to reproduce against prod posture (subprocess at the chokepoint, no operator
`~/.claude` on the host, isolated HOME/cwd) before claiming a prod leak. A **live** reproduce needs a
real model turn, which this host cannot run: batch-1 decoupled boot-b from the operator's Claude Code
account (RUN_LOG DECISION 2026-07-09), and the dedicated Cortex credential
(`~/.config/ekoa/claude-credentials.json`) is not yet provisioned. So the live turn is **deferred**, not
claimed either way.

The load-bearing *mechanism*, however, is fully deterministic and is pinned by committed tests
(`api/tests/llm/subprocess-isolation.test.ts`), asserting the spawn contract the chokepoint hands the
transport — independent of what any model echoes back:

- `build` / `verify` runs pass `cwd` + `homeDir` (the project sandbox) and are isolated.
- `chat`, `brand-research`, and classifier `one-shot` runs passed **neither**, so the spawned Agent
  SDK subprocess inherited:
  - `process.cwd()` = the API server's repo checkout (`~/dev/ekoa-code`). The Agent SDK reports its
    working directory to the model — this alone explains the leaked path.
  - `HOME` = the operator home, which is what puts `~/.claude` (and any operator auto-memory) in reach.

`settingSources: []` (client.ts sdkOptions) and the chat knowledge-only tool allow-list are the primary
gates and remain in force; they are why the obvious file-read / profile-load vectors were already
blocked. The inherited **cwd/HOME** was the open channel underneath them, and it required no tool.

## The fix (shipped — defense-in-depth, committed 0dc4293)

`api/src/llm/client.ts` — every `runAgent` / `runOneShot` spawn that does not pin `cwd`/`homeDir` now
gets an EMPTY per-run sandbox (`mkdtemp`): `cwd = sandbox`, `HOME = sandbox`, removed when the run ends.
An explicit caller value (build/verify) is never overridden.

`api/src/llm/credentials.ts` `buildSubprocessEnv` — HOME alone was insufficient on TWO axes:

Path axis — the inherited env carries the server's working-directory path on several channels. The
scrub is value-based against the server cwd AND the npm-declared root:
- `PWD` / `OLDPWD` / `INIT_CWD` dropped/re-pointed at the sandbox;
- all `npm_*` dropped (`npm_config_local_prefix` is the repo ROOT — an ancestor of cwd, which a
  cwd-substring check would miss — and `npm_package_name` is literally the checkout's directory name);
- `PATH` segments under the server root filtered out (PATH is kept, not dropped, so the spawn still works).

Memory/identity axis (the operator AUTO-MEMORY half of the original leak, not just the path) — a
sandboxed HOME does not stop an inherited `XDG_*_HOME` from redirecting config/state/memory reads
OUTSIDE HOME, nor does it strip the operator's Claude Code SESSION identity. So the clone loop now
also drops every inherited `CLAUDE_*` (the operator session context: `CLAUDE_CODE_SESSION_ID`,
`CLAUDE_EFFORT`, entrypoint, ...) and every `XDG_*_HOME`. The few `CLAUDE_*` the chokepoint needs
(the credential, `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`, the stream-close timeout) are re-set
explicitly AFTER the loop, so dropping the inherited ones is safe. This closes the load-bearing
unknown the brief named — how an operator auto-memory reached the model despite `settingSources:[]`.

FIXED-13 intact: no new base URL, the chokepoint stays the sole transport, and the tool allow-list is
unchanged (chat tools were NOT widened).

## Tests (regression-test-first, verified by EXIT CODE)

`api/tests/llm/subprocess-isolation.test.ts`:
- runAgent with no cwd/homeDir → an isolated sandbox, not the repo checkout; HOME ≠ operator home.
- runOneShot isolated identically (brand-research + classifier one-shots).
- an explicit cwd/homeDir (build) is respected — isolation never overrides the caller.
- per-run: two runs get different dirs; the serialized spawn contract contains no `ekoa-code` path and
  no `"$HOME"` value.
- (robustness, found here) a failing SDK stream no longer produces an UNHANDLED rejection — every
  consumer drains `events` before awaiting `result`, so a stream error left `result` orphaned; the
  chokepoint pre-handles it. This is what made the F4 brand-research contract suite exit vitest non-zero.

## What remains owed (honest)

- **Live end-to-end reproduce** against the credentialed prod posture (an empty-KB tenant turn returning
  no host path/operator memory) — blocked on `~/.config/ekoa/claude-credentials.json`; runs at S7's boot
  or whenever the operator provisions the dedicated account. This would upgrade the disposition from
  "mechanism proven + hardened" to "live-confirmed".
- **Cross-model Codex review** (this is a significance-labelled egress/isolation surface; the F25 brief
  names an adversarial Codex pass) — `codex` is not logged in on this host; recorded degraded, never faked.

The fix does not depend on either: the inherited-path vector is removed deterministically today.

## Diagram (FIXED-12)

`spec/diagrams/04-agent-job.excalidraw` carries the subprocess-isolation panel (per-run sandbox,
cwd/HOME = sandbox for unpinned runs, the env-path scrub).
