# rc-1 Release Hardening - Run Summary

Date: 2026-07-08. Fable-led verification-and-curation run at the `rc-1` tag (main = rc-1 + one
tooling commit). This run fixed no product code; it verified the product over real HTTP, classified
findings, and produced the as-built documentation layer. All product code was verified at clean rc-1
(the one uncommitted change on the tree at start - a sessions-contract fix - was stashed as
`stash@{0}` and logged as finding F11, so verification ran on true rc-1).

## Method

Two full-stack boots against the real product (in-memory Mongo, real UI login):
- **Boot A (uncredentialed rc-1):** the honest fresh-boot state. 6 probe scripts + a 167-endpoint
  contract-vs-mounted sweep.
- **Boot B (credentialed):** a purpose-built harness (`docs/release/probes/boot-b.mjs`) seeds the
  model credential from the operator's Keychain (oauth, no-refresh, never logged) into the ephemeral
  mongo before boot, and runs the LLM chokepoint direct-to-provider. Real chat, real builds, real
  automation. 4 journey probes + director-verified evidence from disk and the live ledger.

Director (Fable) spent turns on judgment - probe design, evidence evaluation, finding classification,
the J3 and J9 self-verification, curation. Opus subagents executed probes, drafted docs, and traced
code. Everything committed as produced.

## Journeys: verdicts

| # | Journey | Verdict |
|---|---------|---------|
| J1 | Auth lifecycle | PARTIAL FAIL - login/me/deactivation planes correct + fail-closed; refresh/logout/password/device all unimplemented (F1); logout does not revoke. |
| J2 | Chat with grounding | PASS on grounding (both seeded org-private facts returned via knowledge tools); bug: truncated + persisted result (F20). |
| J3 | Build to served app | FAIL (priority journey) - builds report completed but serve the untouched scaffold; real app orphaned (F16); verify-ON passed the scaffold and billed for it (F28). |
| J4 | Memory loop | FAIL - extraction + isolation work; recall into the next session fails (F21); /memory UI renders 0 cards on a schema violation (F22) with console errors (F23); caveated host-context bleed (F25). |
| J5 | Org isolation | PASS end to end - cross-org 404s exact; design-tokens neutral default + per-org overlay both correct; Registo org-scoped. |
| J6 | Anonymisation round trip | PARTIAL - privacy HELD (tokens-only egress proven), but the user-visible de-anon reply is broken by model whitespace (F26); deny-list unwired (F10). |
| J7 | Brand research | FAIL - `POST /branding/research` unimplemented (F4). |
| J8 | Automation + webhooks | PASS admission plane (HMAC/dedup byte-exact); automation-plan ran + billed; webhook-run terminal state not captured (harness-gap). |
| J9 | Billing truth | PASS - ledger reconciles to the token (37387 metered, sum-per-user == sum-per-agentType), no orphan/empty-billee rows, anomalies=0. |

Passed: J5, J9 (clean); J2, J8 (pass with a noted bug/gap). Failed or partial: J1, J3, J4, J6, J7.

## Findings: 25, classified (F1-F28; F15/F17/F18 folded)

17 bug, 3 judgment, 3 docs-gap, 1 harness-gap, 1 verified-pass. 9 high-severity.

High-severity, ranked by operator impact:
1. **F16 + F28** - build serves the scaffold not the built app, and per-build verify passes it (the
   priority journey's core promise + its safety net both fail).
2. **F2** - no model-credential provisioning surface; default gateway topology 401s even credentialed.
3. **F1** - auth lifecycle past login/me unimplemented; logout does not revoke.
4. **F20** - chat result truncated AND the truncated text is persisted as history (data corruption).
5. **F21, F22, F26, F25** - memory recall fails; memory UI dead on a schema violation; anon reply
   shows the token not the value; host-context bleed (high IF reproduced against prod).

Also structural: **F5** - 31 of 167 contract-declared endpoints unmounted, incl. 4 whole domains
(uploads, app-assistant, integration-builder, ekoa-local); **F6** - no JSON-envelope 404; **F3** -
Registo works but no CRUD mutation is audit-logged.

Verified SOUND (not findings): tenant isolation everywhere probed; tokens-only anonymisation egress
(32 audit rows + 9/9 chokepoint spec); billing arithmetic; webhook admission plane; fail-closed
deactivation at every plane. The generated app CODE is correct - the build system serves the wrong file.

## Deliverables (all under `docs/`)

- `release/FINDINGS.md` - the 25 findings + per-journey verdicts + positive verifications.
- `release/patch-briefs/` - 17 ready-to-run patch-profile briefs (one per bug).
- `release/e2e-harness-remediation-brief.md` - the spec to close the e2e baseline debt.
- `release/probes/` + `release/evidence/` - the re-runnable probe kit + captured evidence.
- `README.md` (doc map), `as-built-architecture.md`, `operations-runbook.md`, `spec-status-annex.md`.

## Patch briefs ready to run (ordered by priority)

1. F16 (build-serves-scaffold) + F28 (verify-passes-scaffold) - the priority journey.
2. F2 (model-credential provisioning + gateway-key).
3. F1 (auth lifecycle + logout revocation).
4. F20 (chat result truncation + persisted-history corruption).
5. F22 (memoryView schema violation) + F21 (memory recall) + F23 (memory UI console errors).
6. F26 (de-anon whitespace round-trip).
7. F25 (host-context bleed - reproduce-or-dismiss first).
8. F5 (unmounted endpoints triage) + F6 (JSON 404 + disabled-message).
9. F3 (audit-log CRUD mutations), F4 (branding research), F7 (failed-build shell), F9 (trigger
   disable), F10 (deny-list resolver), F11 (apply the stashed sessions fix).

## Open threads for the operator

- `stash@{0}` holds the sessions-contract fix + its untracked contract test (recover the test from
  `stash@{0}^3`); F11 brief covers applying it.
- worker-b-build did not report J8b's webhook-run terminal state or the J1 served-plane deactivation
  check - noted as harness-gaps; both underlying paths are otherwise evidenced.
- The `/config` safeguard switch was set to `false` for this supervised run per the mission brief;
  restore it to `true`.
