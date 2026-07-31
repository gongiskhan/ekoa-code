# LANDING — Cortex Capability Contract convergence (run 20260730-201019-672a8f14)

Start your review here. 28 commits in `ekoa-code`, 15 in `~/dev/garrison`, all prefixed
`[capability-contract]`, all on `main`.

## What now exists

Capabilities are implemented once in Cortex and reachable by an ordinary user-keyed client:

- **Memory (`api/src/memvault/`)** — per-user markdown notes with **physical** isolation: one directory
  and one FTS index file per user, a single path-resolution point, and an isolation suite that attacks it.
- **Automations** — idempotent run creation (the client key returns the same `runId`), a bounded logs
  endpoint, and key admission. The status code is the replay signal: 202 fresh, 200 replay.
- **Knowledge** — search and read over REST, org-scoped from the authenticated actor only.
- **The contract itself** — `docs/openapi/cortex.v1.json`, generated from the `shared/` descriptor maps
  and filtered to exactly the key-accepting surface, so the document is definitionally equal to what a key
  can reach. A drift gate proves it, in both directions.
- **The client** — `clients/cortex-cli`, types generated from that document, one generic wrapper, no
  per-capability HTTP path anywhere.
- **Garrison** — a fitting that installs the CLI, a memory backend switch that defaults to local, a
  skill-first automations view, and the import/shadow/comparator machinery with a dated review.

## Gate summary

| Slice | What | Rounds | Outcome |
|---|---|---|---|
| A0 | Convergence audit + citation gate | 3 | passed |
| E1 | user-or-key admission + per-key caps | 2 | passed |
| G2 | Capture spool + drain | 2 | passed |
| E2 | memvault jail, store, isolation suite | 3 | passed |
| E3 | memvault FTS search + export | 3 | passed |
| E4 | Automations idempotency + logs | 3 | passed |
| E5 | Knowledge REST search/read | 2 | passed |
| E6 | OpenAPI spec + drift gate | 3 | passed |
| VIS | Private-visibility enforcement | 1 | passed (unplanned — found by the independent test pass) |
| G5 | cortex-automations view fitting | 1 | passed |
| G6 | Capability-contract docs, both repos | 3 | passed |
| G4 | Import, shadow, dated comparator | 4 | passed |
| E7 | cortex CLI + generated client | 4 | passed |
| G1 | cortex-client fitting | 4 | passed |
| G3 | basic-memory backend switch | 3 | passed |

Run-level: deliberate-red **passed**; independent test pass **passed**; mutation — see below;
**security review passed with two HIGH blockers found and fixed** (below). All 15 slices closed.

## NEEDS HUMAN EYES

1. **A credential exposure occurred during review, in a sandbox.** The `cortex-client` fitting clones a
   configurable repo and builds it, and the runner hands hook scripts the composition's **materialised
   vault**. A reviewer's fixture `postinstall` ran, wrote outside the clone, and read back every
   `*_API_KEY`/`*_TOKEN` in scope — **including its own live session token**, which it shredded. Nothing
   left the machine (a `/tmp` fixture, not a real remote). Now narrowed with `--ignore-scripts` and stated
   honestly rather than implied away — but **configuring `repo_url` still grants that repository code
   execution with your vault present**, because its declared `build` runs by design. Read that
   `for_consumers` section before pointing it anywhere.
2. **Codex was unavailable for the whole run**, then disabled by you. Cross-model decorrelation is
   genuinely absent. Every other decorrelation held (per-slice fresh-context review, the run-level
   independent test pass, the built-in security review).
3. **The run-level security review found two HIGH blockers, both proven live, both now fixed.**
   (a) A standing consent approval was bound to a caller-supplied command shape rather than the one the
   run was awaiting, so a key could bank an approval the user was never shown — the inverse of the hole
   the code's own docstring says it closed. (b) The operator-configurable `vault_dir` and
   `memory_dir` were interpolated unquoted into the hook command written to
   `~/.claude/settings.json`, which is executed as a shell command on every session end and
   pre-compact — a shell injection on a recurring trigger. Both have regression tests verified to fail on
   revert. **Five MEDIUM findings remain open and are listed in the run log**, the sharpest being that the
   CLI redacts only the failure half (a 200 body echoing the key prints verbatim) and that the same key
   also authenticates the LLM gateway, which the published spec does not mention.
4. **The 14-day shadow review falls due 2026-08-14**, recorded in `garrison:docs/DECISIONS.md`. Its three
   outcomes are named there. The comparator now fails loudly once that date passes, including when the
   CLI is absent.
5. **Six deferred contract defects** are in `docs/findings.md` (OPEN), not just in commit messages —
   including `contentMd`'s character bound against a byte parser limit, and the drift gate's inability to
   see a dirty-but-freshly-built `shared/dist`.

## Assumptions I made on your behalf

Full ledger in `RUN_SPEC.md`. The load-bearing ones:

- **`~/dev/garrison` is the consumer repo** (the brief said `agent-garrison`, which is a stale prototype).
  **You confirmed this mid-run.**
- **No API-key scopes in v1** — ownership is authorization, matching the shipped gateway-key model.
  Additive later.
- **No outbound completion webhook** — polling, SSE and the new logs endpoint cover the first consumer.
- **The entity-gate plan was never built anywhere**, so the audit *is* the supersession record; there was
  no document to stub and no code to remove.
- **Voice: the "partly converted" state is on the Ekoa side** (`api/src/voice/` is an as-built relay with
  stub providers, blocked on vendor credentials); the garrison fitting was never converted. Investigation
  only, as instructed.

## Deviations

- **A red baseline survived three slices.** `shared/`'s own suite went red when E1/E2 landed and I did not
  catch it, because my per-slice wall ran only the workspace each slice edited. The next implementer found
  it. Repaired in `94a0437`; the lesson is in the friction log.
- **I published a spec generated from a contaminated build.** I ran the drift gate against my working tree,
  saw exit 0, and treated that as proof — but the generator reads a gitignored build output that a
  concurrent slice had rebuilt from *its* uncommitted source. Corrected, and every generated artifact
  since has been verified from a pristine checkout.
- **I approved a reviewer-rejected judgment call.** I accepted that key-driven browse routes needed no
  audit; the reviewer measured what that costs (a leaked key harvesting every document title org-wide,
  unattributed) and was right.
- **Two allowlist widenings**, both requested by implementers, both verified against the code before
  granting: a registry entry without which a fitting installs inert, and one view root without which an
  operator's edit is silently discarded.

## Mutation gate

Not a mutation-testing tool run. What was done instead, and what it does and does not cover:

**Every fix in this run was revert-proofed** — the change was reverted and the covering test observed to
fail, with the failure text recorded. That is targeted mutation at the semantic level rather than the
syntactic level, and in several cases it caught tests that passed for the wrong reason: an eviction test
that passed against the pre-fix code until both layers were reverted, a jail test whose non-tautology was
proven by reverting a single anchor line, and a documentation test that passes in both states **by design**
(labelled as such rather than counted as proof).

**Not covered:** untouched pre-existing code paths were not mutated. A tool run over `api/src/memvault/`
and `api/src/auth/` would be the honest next step, and is recommended rather than claimed.

## The deliberate-red proof produced a real result

Injecting an uncovered endpoint made `schema-coverage` fail exactly as designed — and made
`mount-coverage` **pass**, empirically confirming the limitation a review had forced me to document
earlier: it proves a router is mounted, not that a specific sub-route exists. The documentation correction
was not pedantry; the gate behaves exactly as the corrected text says.

## Friction log

11 entries in `docs/autothing/friction-log.md`, each naming where this skill's own instructions were
ambiguous or wasteful — including reading exit codes through a pipe (which masked a real failure), walls
that ran one workspace in a monorepo, and verifying a generated artifact from a dirty tree.
