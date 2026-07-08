# Spec status annex - state of the spec at rc-1

This annex MARKS each spec chapter with an as-built status; it never DELETES or edits a chapter. The
spec under `spec/` stays the normative design record - where spec and code disagree the spec still
states the intended design, and a status here only records how far the rc-1 build has reached it.
The live, per-defect delta list is `docs/release/FINDINGS.md` (F1-F27); this annex points at those
rows, it does not restate or supersede them.

Status vocabulary: `as-built-verified` (implementation matches, named evidence exists) `.`
`as-built-with-findings` (built + verified, open FINDINGS rows against it - F-numbers named) `.`
`partially-built` (material declared surface unimplemented) `.` `historical` (run/process chapter,
work done, kept as the audit record) `.` `deferred` (explicitly out of rc-1). The `?` judgement calls
in the first draft are now resolved (director-stamped).

Evidence keys: gate entries `G-P..G13` in `RUN_LOG.md`; findings `F1-F27` + Boot-A/Boot-B journey
verdicts in `docs/release/FINDINGS.md`; the contract sweep in `docs/release/evidence/BOOT-A-SUMMARY.md`
(167 declared / 135 mounted / 31 unmounted); the diagram reconciliation in
`docs/diagram-census-and-deviation-annex.md`.

| Chapter | Title | Status | Justification (1 line) |
|---|---|---|---|
| SPEC.md | Specification entry + FIXED register | historical | All 27 P-nn and every run-blocking Q closed by Amendment 2; register read zero-pending at the G-P launch gate; remains the normative index, not a build target. |
| 01 | System overview | as-built-verified | One-page product overview; the described service boots credential-less at rc-1 (BOOT-A) and every module it names was gated across G0-G13. |
| 02 | Module map | as-built-verified | 17 module dirs scaffolded at G0; all 17 rendered in the G13 diagram census (diagram-census-and-deviation-annex). |
| 03 | API design | partially-built | F5: 31 of 167 declared endpoints unmounted incl. 4 whole domains (uploads / app-assistant / integration-builder / ekoa-local); plus F1 auth lifecycle, F4 branding path, F6 no JSON-envelope 404, F11 session fields. |
| 04 | Data model | as-built-with-findings | Collections engine + crypto + activation gated G2-G3, knowledge vault G7B; open F2 (no credential provisioning surface), F3 (Registo works but CRUD mutations are not audit-logged - claim narrowed from "dead" after Boot-B), F13 (stale module header). |
| 05 | Agent execution | partially-built | Chat / build / automation run classes gated G7B + G8, but F5 leaves app-assistant + integration-builder run classes unmounted, F9 makes trigger-disable unreachable, and F20 (chat result truncated + persisted) / F21 (memory recall miss) are runtime defects on the mounted classes. |
| 06 | LLM chokepoint + billing | as-built-with-findings | Chokepoint + metering + rate/spend caps gated G7; Boot-B confirmed metering is CLEAN (build/build-verify/memory-extract/chat all attributed, anomalies=0 - see J9). Open F2 (default gateway topology cannot complete a turn - key unprovisioned), F20 (result-truncation bug at client.ts), F8 (raw provider errors leak to users), F13. |
| 07 | App pipeline | as-built-with-findings | esbuild / serving / injection gated G6 + build mechanics G7B; open F16 (build reports completed but serves the untouched scaffold - real work orphaned; the priority journey's headline defect), F7 (failed build serves a broken 200 shell), F5 (uploads domain unmounted, so chat attachments cannot work). |
| 08 | Content and the Garrison boundary | as-built-verified | Content loader gated G7B; the Garrison boundary is held by the FIXED-7 grep gate (G0) and re-confirmed clean at the G7B Codex checkpoint. |
| 09 | Security invariants | as-built-with-findings | 11 invariants enforced and re-checked by cross-model Codex passes (G7B / G8 / G12); open F10 (invariant-2 anonymisation deny-list unwired), F1 (logout has no server-side revocation), F6 (disabled-account message differs by plane), F25 (host-context bleed - high IF reproduced against prod sandbox; not confirmed). Positive: tenant isolation held everywhere probed (J5), tokens-only egress proven (J6). |
| 10 | Coexistence and cutover | deferred | Migration + parity tooling built and gated G10, but the traffic switch is founder-gated and out of rc-1; the erp-fork CUTOVER deferral is recorded in RUN_LOG. |
| 11 | Glossary | as-built-verified | Reference chapter with no runtime surface; the new vocabulary is grep-enforced repo-wide (CONV-6, chokepoint + garrison greps). (Director: `historical` was equally defensible; kept `as-built-verified` since the vocabulary is actively enforced, not merely recorded.) |
| 12 | Web client migration | as-built-with-findings | web/ migrated and gated G9; open F22 (the /memory page renders 0 cards on a shared-schema violation) + F23 (7 console errors on /memory, QA bar is zero), plus the band1 web-dashboard e2e specs still red as documented baseline debt (RUN_LOG). (Director: promoted from the draft's `as-built-verified?` now that Boot-B gave the web layer real F-numbers.) |
| 13 | Test and review strategy | as-built-with-findings | Five-layer QA process is live across every gate; but the chapter's own bar - a green e2e baseline every PR - is currently untrue (the committed e2e:server carries band1/band2/erp debt), owned by `docs/release/e2e-harness-remediation-brief.md`. Contract-coverage gaps also surfaced (F22 memory shape, F14 served-plane auth). (Director stamp: the chapter fails its own standard, so with-findings, not verified.) |
| 14 | Build sequence | historical | The run-mechanics chapter; its 18 phases executed G-P..G13 and the RUN_LOG gate journal is the standing audit record. |
| 15 | Open proposals | historical | All 27 P-nn resolved by Amendment 2; the register read zero-pending at the G-P launch gate. |
| 16 | Open questions | historical | Register closed to zero-blocking at G-P; Q-02 / Q-03 remain cutover-class on the ch10 checklist. |
| 17 | Anonymisation layer | as-built-with-findings | Full ch17 pipeline gated G7A and wired into all four chokepoint entries; Boot-B PROVED tokens-only egress (32 audit rows + 9/9 chokepoint spec). Open F26 (user-visible de-anon round-trip broken by model whitespace reformatting - privacy held, reply wrong), F10 (per-org deny-list resolver never wired, NER inert so free-text names go cleartext), F27 (audit filter granularity). |
| 18 | Local file access and the bridge | partially-built | Delegation + bridge + provider + S1-S6 gated G8A via the fake-daemon harness, but F5 leaves the whole ekoa-local HTTP domain (agent-face, bridge/connect, /api/v1/events) unmounted. (Director: a gated core whose HTTP entry points do not respond is partially-built, not with-findings - the surface is missing, not defective.) |
| diagrams/ | Excalidraw diagram set | as-built-verified | G13 census: every ch02 module and all four sanctioned SSE streams map to >=1 current diagram; run deviations reconciled in diagram-census-and-deviation-annex. |
