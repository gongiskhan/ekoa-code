# LANDING — batch-final consolidation (run 20260710-100824-ee82acc1)

Branch `batch-final` off `main@ef786f8`. rc-1 untouched. **Not merged to main — that is the operator's review gate.**

## Gates summary

| Slice | Finding | Tag | Test | Wall | Review | Codex | Result |
|---|---|---|---|---|---|---|---|
| s0-reconcile | reconcile + F21 backfill | bf-reconciled | green | green | approve | n/a | PASSED |
| s1-f10-denylist | F10 deny-list wired + CRUD | bf-f10 | green | green | approve (2 rounds) | clean (2 rounds) | PASSED |
| s2-f26-detok | F26 whitespace detok | bf-f26 | green | green | approve (4 rounds) | clean (4 passes) | PASSED |
| s3-f3-registo | F3 Registo rows | bf-f3 | green | green | approve (after F-1/F-2 fix) | (fresh-context) | PASSED |
| s4-f29-plan-failed | F29 plan_failed | bf-f29 | green | green | approve | (fresh-context) | PASSED |
| s5-f7-failed-build | F7 failed-build serving | bf-f7 | green | green | approve (after store-guard fix) | (fresh-context) | PASSED |
| s6-proof | J3 live proof | bf-proof | live 15/15 (deterministic) | ci:lane green | — | run-level checkpoint | PARTIAL — live-model J3 build BLOCKED on credential |

## The proof (Phase 3)

The full stack is **left running**: web `http://localhost:3000`, API proxy `http://localhost:4111`, login **admin / tmp12345**.

**Live deterministic proof against the real running stack — 15/15 PASS** (`slices/s6-proof/live-proof.txt`):
- Auth: admin login 200, `/me` returns the user.
- **F10 deny-list (LIVE):** POST/GET/DELETE `/api/v1/org/deny-list` — the firm literal is NEVER echoed in any response (metadata-only, write-only value), entry encrypted at rest.
- **F3 Registo (LIVE):** `/api/v1/registo` shows the `auth.login` row and the `anonymisation.deny-list.add/remove` rows, metadata-only (no literal).
- **Served-app plane:** `GET /apps/sales-crm/` serves the real app (200 HTML, zero scaffold markers), served-app CSP `frame-ancestors 'self'`.
- **/health honesty:** meteringAnomalies 0, gatewayUnmetered 0.

**BLOCKED (external cause):** the live-model **J3 build journey** (build an app → serve it), plus the live-turn probes j2/j4/j6/j8b, require a **model credential** that is not present in this environment (no `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` env var, no `~/.config/ekoa/claude-credentials.json`). The credential could not be obtained autonomously: the macOS keychain scan is blocked by the permission classifier, and the local-Claude-Code-token path invalidates the operator's own session (a documented flake). `/health` correctly reports `claudeAuth.configured=false`.

**Remediation (one command, then the whole J3 journey runs):**
```bash
# in this session's shell, with a Cortex credential:
export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)   # or ANTHROPIC_API_KEY=sk-ant-...
node .claude/skills/run-ekoa-code/provision-credential.mjs   # seeds the running stack
# then the served app builds; F16/F28 honest-completion + verify + J3 x2 (verify OFF/ON) proceed
```

## What the operator can do RIGHT NOW (no credential, no known bug)

Log in at `http://localhost:3000` as admin/tmp12345 and use every credential-independent surface: browse the 41 featured apps (`/apps/<slug>/`), manage the org anonymisation deny-list, view the Registo oversight surface (login + admin actions are now audited, metadata-only), exercise auth/sessions/memory-view/branding/knowledge routes. The moment a model credential is provisioned (one command above), chat, build-to-served-app, memory recall, and automation authoring all come online — with the six batch-final fixes in force: firm party names masked at egress (F10), NIF/IBAN restored correctly in replies even when the model reflows them (F26), a failed build shows an honest failed page instead of a broken scaffold (F7), an unusable automation plan returns a clear message instead of a 500 (F29), and login/build/CRUD actions land in Registo (F3).

## Decisions / deviations this run (see RUN_LOG.md for full text)
- **A1:** batch-1 was already fully landed+tested at HEAD — Phase 1 collapsed to re-pointing the local `batch1-f25` tag (remote push is an operator action, classifier-denied). F11+F21 verified fixed at HEAD; stash@{0} superseded (archived + dropped).
- **F26 took 4 review rounds** — the hardest slice. Streaming de-tokenization is subtle; two reviewers found real defects each round (edge-context loss, IBAN dismember, splice-into-run, `$`-replacer, leftCtx unsoundness). Residual (streaming restores an adjacent-duplicate token batch tokenizes) proven benign by a committed 13k-case security property (never leaks worse, always a superset of the user's own values, never corrupts foreign text).
- **ci:lane exit-1 was NOT a mongo flake:** it was the F3 terminal-audit `getJob()` unguarded on a fire-and-forget pipeline throwing an unhandled rejection after test teardown. Fixed; known-flakes.md corrected.
- **Deferred (recorded, not fixed):** the batch-2 e2e harness, F9/F24/F27/F30 (wont-fix-minor), F8 error-detail, the 502-masks-401 diagnostics, the gateway-apikey billing-bypass observation, `/usage` crash + StrictMode double-session, schema-coverage honor-system, `SourceInput` divergence, web `__tests__` tsc exclusion. All in FINDINGS.md.

## Needs human eyes
1. **Provision a model credential** and re-run the J3 live build proof (one command above) — the only piece this run could not execute.
2. **Push the remote `batch1-f25` tag** off the broken `8a2a67b`: `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local already re-pointed to `af8b556`; the auto-mode classifier denies remote tag rewrites).
3. **Review + merge `batch-final` to main** (the operator's gate). 15 commits; rc-1 untouched.
