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
scrub uses TWO distinct root sets (see the finding-1 regression note below for why the split is
load-bearing): `pathRoots` = the server checkout only (cwd + npm-declared root), used to filter PATH
segments; `valueRoots` = pathRoots + the operator HOME, used to drop whole non-PATH vars whose value
carries the operator home:
- `PWD` / `OLDPWD` / `INIT_CWD` dropped/re-pointed at the sandbox;
- all `npm_*` dropped (`npm_config_local_prefix` is the repo ROOT — an ancestor of cwd, which a
  cwd-substring check would miss — and `npm_package_name` is literally the checkout's directory name);
- `PATH` segments under the CHECKOUT root filtered out — NOT under HOME (node/toolchain live under
  `$HOME` on user-managed-node hosts; filtering them ENOENTs the spawn). PATH is filtered, not dropped,
  and the parent's own node bin dir (`dirname(process.execPath)`) is force-preserved so the SDK's bare
  `spawn("node")` always resolves;
- non-PATH vars carrying the operator home (NVM_DIR, BUN_INSTALL, `_`, ...) and the operator username
  (USER/LOGNAME/USERNAME) dropped — safe because they are not PATH.

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
- (finding-1 regression, real spawn) `spawnSync("node", …)` against the built env resolves and exits 7
  — a scrubbed PATH that cannot find node ENOENTs here, so this test catches the exact runtime failure
  the injected-transport tests could not. Plus: a HOME-rooted node dir survives the scrub; the repo
  checkout is still filtered; `dirname(process.execPath)` is always on the built PATH.

## Fresh-context security review (S7) — approve, findings all addressed

The slice's fresh-context reviewer (LLM-free probes, verified by exit code) returned **approve, no
blockers**, confirming the mechanism reproduction, the memory-vector closure (CLAUDE_*/XDG_*_HOME),
FIXED-13 intact, and the disposition honest. Its five LOW/INFO findings were then all closed in-slice:
1. Scrub was cwd-anchored, so the operator HOME path (in PATH, NVM_*, ...) and USER/LOGNAME/USERNAME
   still rode through. First fix anchored the scrub on the operator HOME too, dropped the username
   vars, and filtered operator-home PATH segments — **but that overreached and was itself a HIGH
   regression** (see the finding-1-regression section below): filtering `$HOME` out of PATH evicts
   the Node bin dir on user-managed-node hosts, ENOENT-ing every spawn. FINAL: HOME scrub retained
   for the NON-PATH channels (NVM_DIR/username/value-carriers), PATH filtered against the checkout
   ONLY, node dir force-preserved. Regression-tested (incl. a real spawn).
2. runOneShot/runAgent created the sandbox (and called buildSubprocessEnv) BEFORE their try, so an
   early throw (unconfigured credential, mkdtemp failure) orphaned an empty dir / hung `result`. NOW
   the sandbox lifecycle is inside the try; a throw rejects rather than hangs. Regression-tested.
3. The PATH filter used boundary-less startsWith (a sibling `/repo/ekoa-2` over-matched `/repo/ekoa`,
   and a server cwd of `/` would empty PATH and break every run). NOW: a `/`-boundary match and a
   guard discarding a root of '' or '/'. Regression-tested.
4. verify-runner pinned cwd but not homeDir, so the chokepoint allocated a second unused sandbox.
   NOW it pins homeDir too — no wasted dir.
5. discardSandbox swallowed rm failures silently. NOW it logs the failure (still fire-and-forget;
   an empty dir lingering to reboot is not a data leak).

## Finding-1 regression + re-confirm (post-verdict, both reviewers concurred — HIGH, fixed)

After the terminal verdict, both fresh-context reviewers were asked to re-confirm at the shipped HEAD
(their prior approve/clean predated the finding-fix commits). **Both independently returned the same
HIGH blocker, introduced by the finding-1 fix** (commit `9805f6c`): adding `process.env.HOME` to the
PATH-filter roots evicts the Node/tool bin dir from the subprocess PATH on any user-managed-node host
(nvm / fnm / volta / asdf / `~/.local`) — where node lives UNDER `$HOME`. The Agent SDK spawns the CLI
as the bare command `"node"` (it pins no `executable`), resolved against the scrubbed PATH, so every
model subprocess (chat / build / brand-research / one-shot / gateway classifier) fails ENOENT. On THIS
host (`node` only at `~/.nvm/.../bin`, `claude` only at `~/.local/bin`, no `/usr/bin/node`) it is
certain; a system-node container (`/usr/local/bin/node`) is unaffected. The committed suite missed it
because it uses an injected transport and never spawns a real subprocess — and the earlier PATH test
assumed node lives in `/usr/bin`.

Honest self-correction: my own first-pass "independent verification" claimed the F2-E2E turn proved the
spawn worked; that was wrong — F2-E2E (Slice 1) ran *before* `9805f6c` added `$HOME` to the roots, so it
never exercised the regression. The reviewers' direct `spawnSync` repro at HEAD was authoritative. The
re-confirm request (which I nearly skipped) is what caught it.

FIX (both reviewers' recommended direction): filter PATH against the checkout roots ONLY; keep the
aggressive `$HOME` scrub on the non-PATH channels; force-preserve `dirname(process.execPath)` in PATH.
Regression-test-first, RED confirmed before the fix: three new tests including a **real `spawnSync("node")`**
that ENOENT'd pre-fix and exits 7 post-fix (closing the injected-transport blind spot), plus a
HOME-rooted-node-survives test (RED on every host pre-fix) and a `dirname(process.execPath)`-resolvable
assertion; the old `/usr/bin`-assuming test was rewritten to the corrected contract.

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
