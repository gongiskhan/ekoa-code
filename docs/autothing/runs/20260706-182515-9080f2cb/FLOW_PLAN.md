# Flow Plan — Ekoa rebuild rc-1 (run 20260706-182515-9080f2cb)

Brief: build production-ready rc-1 of the rebuilt Ekoa platform (api/, web/, shared/) exactly to spec/ (SPEC.md + chapters 01-18, all normative). Chapter 14 is the build spine; its 18 phases ARE the slices below, 1:1 — FIXED decisions forbid redesign, and 14.3's hard ordering constraints are preserved unmodified (no reorder applied; the recommended order is adopted as-is, justification: no constraint pressure found). Terminal deliverable: tag `rc-1`. NO cutover, NO production, NO deploys.

## Design notes (planning decisions, logged per 14.1 precedence)

- **No alternative architecture explored.** Chapter 14 + FIXED registers mandate the design; planning validated the ordering against 14.3 and adopted it. Any contradiction discovered mid-build follows 14.2.4 abort semantics (stop at current gate, ABORT entry, branch `abort/G<N>`, report) — never improvised around.
- **Gate mapping (spec ⊃ autothing).** Each slice's Definition of Done = the chapter-14 gate template (14.2.1): (1) phase green condition, (2) full CI lane exit 0 (ch13 §13.9), (3) BOTH reviews at every gate — Claude review (autothing-review = the "Opus review") THEN adversarial Codex review (`codex exec`, serialized, red verdict blocks the gate) — verdicts recorded in RUN_LOG.md, (4) suite ledger updated + ratchet holds, (5) diagrams updated or "no structural change" noted, (6) checkpoint commit `checkpoint: G<N> <phase-name>` + tag `gate-<N>`. autothing's fresh-context adversarial review/test gates run additionally per slice. Evidence: asciinema capture of the gate suite for API-only slices (P through 8A, 10), browser walkthrough for UI slices (9, 11) and the terminal state (13).
- **RUN_LOG.md discipline** (14.2.3): append-only at repo root (already exists with pre-run Amendment 2 entries — append, never rewrite). Entry types GATE/DECISION/AMBIGUITY/DEVIATION/ABORT, ISO-8601 UTC + phase. Run entries begin at G-P.
- **Reference access** (14.1, exhaustive): ../ekoa-dev + ../ekoa-deploy read-only; (a) ekoa-dev/ekoa/ wholesale for slice 9; (b) old Cortex only via carryover-audit port-as-is/adapt rows; (c) test estate per test-audit.md; (d) ekoa-deploy shape only, never secret values; (e) design docs cited by ch17/18. Everything else: spec + spec/reference/ only.
- **Suite ledger** (14.2.5): `api/tests/SUITE_LEDGER.json` + generated table; every ported artifact → target gate; skips ledger-scoped; ratchet enforced in CI.
- **Intra-slice parallelism:** slices are strictly serial (each gate = checkpoint commit on the previous). Within slices 3/4/6, disjoint-module sub-work may fan out (disjoint-files rule; shared runtime serialized). Codex calls always serialized run-wide.
- **Deliberate-red evidence** owed: G0 (boundary-zone violation; `@anthropic-ai/*` import outside api/src/llm/; planted gitleaks secret; planted Semgrep pattern), G1 (ledger violation), one domain gate (schema-coverage red, ch13 §13.11.5) — each committed, shown failing CI, reverted, RUN_LOG'd.

## Slices

| # | Slice ID | Title | Kind | Parallel group | Status |
|---|----------|-------|------|----------------|--------|
| 1 | phase-p | G-P Planning: repo PLAN.md traceability table, RUN_LOG init, ledger skeleton | mixed | serial | passed |
| 2 | phase-0 | G0 Scaffold: npm workspaces, Express 5 skeleton, full shared/ contract, CI lane + security gates | mixed | serial | passed |
| 3 | phase-1 | G1 Test estate port: 55 Playwright + 17 unit + test-client + 14 drivers + mocks + ledger | mixed | serial | passed |
| 4 | phase-2 | G2 Data core + auth: Firestore stores, collections engine, crypto, orgs/credentials, JWT/roles/activation, boot gates | mixed | serial | passed |
| 5 | phase-3 | G3 Platform CRUD: users/org/orgs/settings/sessions/memories/uploads/billing-reads/Registo + audit path | mixed | serial | passed |
| 6 | phase-4 | G4 Integrations + knowledge: OAuth, platform caller, Pipedream, e-sign, vault/FTS5, SSRF guard | mixed | serial | passed |
| 7 | phase-5 | G5 Push infra: SSE manager, SQLite queue, webhook ingress, triggers | mixed | serial | passed |
| 8 | phase-6 | G6 App pipeline + served-app plane + legal vertical (largest; 37-spec byte-compat gate) | mixed | serial | passed |
| 9 | phase-7 | G7 LLM chokepoint core + billing metering + rate/spend caps | mixed | serial | passed |
| 10 | phase-7a | G7A Anonymisation layer: detectors, vault, streaming de-tok, audit, payload-capture harness | mixed | serial | passed |
| 11 | phase-7b | G7B Agent execution: content loader, jobs, SDK-via-chokepoint, build-verify, memory-extract | mixed | serial | passed |
| 12 | phase-8 | G8 Automation engine + canvas streaming carve-out | mixed | serial | pending |
| 13 | phase-8a | G8A Delegation + bridge + provider endpoint + fake-daemon harness (S1-S6) | mixed | serial | pending |
| 14 | phase-9 | G9 Web client migration into web/ (typed client, FC fates, Amendment 2 surfaces; full ledger due) | ui | serial | pending |
| 15 | phase-10 | G10 Migration + parity tooling: import scripts, ledger replay, parity workload | mixed | serial | pending |
| 16 | phase-11 | G11 Discovery pass + regression expansion (100% triage closure) | ui | serial | pending |
| 17 | phase-12 | G12 Dual-model whole-repo review + final security pass (F1-F4, cross-org suite, docs/security/) | mixed | serial | pending |
| 18 | phase-13 | G13 Docs/diagrams reconciled, deviation annex, Dockerfiles + CI deploy lane, tag rc-1 | mixed | serial | pending |

## Acceptance per slice (the objective gate; full text in spec/14-build-sequence.md §14.4 — binding)

- **phase-p**: PLAN.md traceability table maps every acceptance criterion of ch02-14+17+18 (self-enumerated stable ids, e.g. C06-03) to exactly one phase; census matches; all 27 P + 10 Q entries verified resolved; RUN_LOG initialized; ledger skeleton with every ported artifact assigned a gate.
- **phase-0**: CI lane exits 0 on scaffold; shared/ covers the complete ch03 map (schemas + events.ts unions + errors.ts + endpoint descriptors); api/src/ stubbed per ch02; deliberate reds all bite (boundary, chokepoint grep, gitleaks incl. pre-commit, Semgrep) and are reverted + RUN_LOG'd.
- **phase-1**: Playwright collects exactly 55 specs; driver runner exactly 14; full harness run zero failures (all ledger-scoped skips); deliberate ledger violation fails the run, RUN_LOG'd.
- **phase-2**: ledger-due suites green: persistence parity (mongodb-memory-server), 8 engine semantics, crypto/jwt/device-auth carryover, auth contract, activation write-through (+ P-03 revocation push), boot fail-closed (no ENCRYPTION_KEY = refuse; no Supabase/license gates).
- **phase-3**: contract tests green for users/org/orgs/settings(+/me toggles)/sessions/messages/memories(+visibility)/uploads/billing-reads/Registo-read; rewritten rule-set files present + green + README.md mapping rows; cross-org adversarial suite green (403/404 only, re-run every later gate); in-org sharing tests green; ACCOUNT_DISABLED admission test green; shared/ allowlist shrunk.
- **phase-4**: both domains' contract tests green; knowledge/citius/cloud-files/platform-oauth-errors/pipedream/payment carryover suites green vs committed mocks; drivers ifthenpay, invoicexpress, pipedream, citius-integration green.
- **phase-5**: triggers + notifications contract tests green; replay/keepalive stream tests green; queue carryover (atomic claim, retry, idempotency) green; whatsapp-inbound green to queue-acceptance; trigger-target discriminator green.
- **phase-6**: the 37 served-app specs green against api/ alone UNMODIFIED (byte-compat proof); artifacts/backups/backend/company-space contract green; drivers app-files-upload, app-auth, erp-*×4, legal-research green; legal golden-figure + branding token gates green.
- **phase-7**: chokepoint lint+grep green with SDK present (only api/src/llm/ imports); zero platform-attributed runtime call sites (ch06 §6.4.3/6.11); billing contract incl. hard-cap green; rate-limit + spend-cap tests green.
- **phase-7a**: payload-capture gate (planted checksum-INVALID NIF + deny-listed name → tokens-only outbound, cleartext user-visible, tool_use round trip resolves locally); streaming-straddle; prompt-cache byte-identical prefix; vault-never-persisted; audit-metadata-only.
- **phase-7b**: chokepoint grep re-green with agents (spawns via base URL/env); chat/jobs contract + SSE union parses green; orphan-sweep boot test; onboarding driver SKIP-gate logic runs; structural no-bypass assertion; fixture build runs per-build verification e2e (user_work/build-verify rows); fixture run writes private memory + Registo + user_work/memory-extract row, zero turn latency added.
- **phase-8**: automation contract + ported module suites green (engine, action runner, fingerprint, vision mocked, cross-agent); 4 remote-display tests green; drivers integration-automation + whatsapp-inbound (full) green; deterministic-automation spec committed (due G9).
- **phase-8a**: fake-daemon adversarial scenarios all green (containment/replay/expiry/cross-org/forged-pairing rejected + ledgered); delegation round trip derived-output-only; correlation-id join; revoke-pairing kill switch; bridge safety tests verbatim-green (owner isolation, tool suppression, owner-scoped cancel).
- **phase-9**: ENTIRE ledger due: 55/57 Playwright green, 17 unit green, 14 drivers green/SKIP-gated, protocol-parity gate green, shared/ allowlist EMPTY; amendment surfaces render (attach affordance, trust chip, Privacidade e ponte local, claims copy present-but-disabled); Amendment 2 surfaces render (Registo admin page + filters, users org controls, sharing toggles, build-verify banner + dialog); all strings PT-PT.
- **phase-10**: import scripts dry-run green vs committed synthetic fixture (counts+checksums match manifest); replay harness reproduces exact totals; workload harness runs in structural-assertion mode.
- **phase-11**: findings log 100% triage closure (test | fix+test | written dismissal); CI green incl. new tests; 13.6 gap-table census: artifact present or RUN_LOG deferral.
- **phase-12**: all four review verdicts approve in RUN_LOG (Opus code + Codex adversarial + Claude security + Codex security); zero unresolved findings; cross-org + in-org + rate/spend + new-surface probes (bridge auth, pairing binding, anonymisation bypass) green at whole-repo scope; 3 docs/security/ one-pagers present; CI green after last fix.
- **phase-13**: diagram census (every ch02 module + every SSE stream → ≥1 diagram, mod dates ≥ last structural change); deviation annex count == RUN_LOG DEVIATION count; both Docker images build; CI deploy lane dry-runs green (P-02/P-26, no secret values); CI green; tag rc-1.

## Global acceptance
All 18 gates green (checkpoint tags gate-P..gate-13), rc-1 tagged, ported e2e green, RUN_LOG complete with all deliberate-red evidence, zero un-logged deviations, docs/diagrams as-built. Tracked in `<runDir>/evidence-index.json → globalGate`.
