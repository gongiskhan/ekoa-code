<!-- ARCHIVE-MARK (2026-07-08, rc-1 hardening): HISTORICAL run scaffolding, kept as the audit
record - NOT edited or deleted. This is the gate G-P traceability deliverable that drove the build;
it is superseded as a status source by docs/spec-status-annex.md (as-built chapter status) and
docs/release/FINDINGS.md (the live delta list). Read those for what the rc-1 code actually does. -->

# PLAN.md — Ekoa rebuild implementation run

The chapter-14 §14.4 phase ordering, adopted as recommended (no reorder). This is the gate G-P deliverable: a traceability table assigning every acceptance criterion of chapters 02-14, 17, 18 to exactly one phase, plus the census reconciliation and the §14.3 constraint check. Chapters 01, 11, 15, 16 carry no numbered acceptance criteria (01 is the one-page overview; 11 is the glossary; 15/16 are the P/Q registers, all resolved — verified below).

## Reorder justification (§14.6 criterion 6)

No phases were split, merged, or reordered. The §14.4 recommended order already satisfies every §14.3 hard constraint:
1. G-P first; G0 (scaffold + CI + shared contract) before any code phase. ✓ (phases 1,2 below)
2. G1 (test estate port) before every gate that consumes ported tests. ✓ (phase 3, before all domain phases)
3. Module-tier order: data/+config before all; auth/+billing before domains; integrations/ before events/; events/ before agents/+automation/; llm/ before agents/+automation vision+metering. ✓ (G2 → G3/G4 → G5 → G7 → G7B/G8)
4. Served-app plane + app pipeline (G6) before the 37-spec legal suite is ledger-due. ✓
5. Web migration (G9) after the API domains it consumes are green. ✓
6. Discovery (G11) after web migration. ✓
7. Dual-model review (G12) then docs/diagrams (G13) last, in that order. ✓
8. services/ has no phase of its own (lands with first consumer); injected seams wired in server.ts in the phase that lands the producer. ✓ (handled per-slice)
9. Egress-module order: G7 (chokepoint core) → G7A (anonymisation) → G7B (agent execution) → G8A (delegation/bridge); automation (G8) independent, after G7B. ✓

## Launch-precondition verification (§14.1, gate G-P stop check)

- **P register (chapter 15):** 27 entries, ALL resolved (§15 acceptance criterion 5: zero "pending"; criterion 6: spec-wide grep for live `PROPOSED` = zero hits). Blocking census = exactly 9 (P-01, P-03, P-05, P-08, P-10, P-12, P-15, P-18, P-25), all resolved. Amendment 2 re-resolutions: P-08 (Supabase retired → Firestore `credentials`), P-12 (auto memory-extract ON, billable `user_work`), P-27 (detector-at-persist, irreversible redaction). Gate G-P stamps nothing.
- **Q register (chapter 16):** 10 entries, all `Resolution:` lines filled. Run-start blockers Q-01 (canvas media-channel carve-out) and Q-10 (m365 gate) resolved. Q-02 factual half closed (production app-data backend = `fs` as-deployed, recorded in RUN_LOG.md); Q-02/Q-03 remaining halves + Q-09 are cutover-class (chapter 10 checklist, out of run scope).
- **Result:** zero open blocking decisions. No §14.2.4 stop. Run proceeds.

## Traceability table — criterion → phase

Every criterion is assigned to the phase whose gate first fully discharges it (the "green at" gate), per §14.4 phase inputs/outputs. IDs are the stable ids enumerated from each chapter's acceptance section (compound numbered items split into independently-checkable sub-criteria).

### Phase P — G-P (planning)
- **C14-01** sizes sum to 100, every phase has objective/inputs/outputs/gate/size (mechanical vs §14.5).
- **C14-06** any reorder preserves §14.3 (this section).
- **C09-16** resolved register items (P-03, P-14, P-15, Q-05, Q-10, P-08, P-12, P-27) carry decided text normatively; ch15/16 reflect the same.

### Phase 0 — G0 (scaffold, CI, shared contract)
- **C02-01..C02-07** module inventory (19 entries), no orphan detail/index, tier table topological, P-01/P-02/P-16/P-17 resolved-in-text, three lint rules writable, FIXED-13 subprocess base-URL rule.
- **C03-02** every endpoint has named request/response schemas that exist in `shared/`.
- **C03-08** error-envelope schema present (every non-2xx validates against it).
- **C03-13** `visibility: 'private'|'org'` present in shared memory + artifact schemas.
- **C08-06** the two Garrison grep gates present in CI and bite on a seeded violation.
- **C13-08** new-repo CLAUDE.md contains the §13.10 block verbatim (+ ch02 §2.9 blocks).
- **C13-09** per-PR CI lane runs on every PR; significance labeler active; nightly lane in config.

### Phase 1 — G1 (test estate port)
- **C13-03** ported `test-client.ts` exists; all 14 node drivers run against the REST surface (SKIP-gated may skip but must execute gate logic).

### Phase 2 — G2 (data core + auth)
- **C04-01..C04-20** full data model: every store mapped/dropped, manifest zod schema, shared-scope validation, 8 engine semantics tested, engine suite vs mongodb-memory-server, no-collections-block parity, ENCRYPTION_KEY boot refusal, no default-key/no Supabase, no data-layer llm import, retention constants + sweep, revoked_tokens/deny-lists/bridge_pairings shapes+indexes, revoked_tokens sweep, no-vault-persist grep, audit metadata-only schema, deny-list ciphertext-only, orgs/credentials shapes, users required orgId+active, visibility default private, teams absent, no EKOA_APP_DATA_BACKEND.
- **C03-12** `ACCOUNT_DISABLED` (403) + `BILLING_LOCKED` (402) in §3.3 table and `shared/errors.ts`.
- **C09-02** grep gates (crypto second-cipher, default-key literal, activity-store write, provider-cred env) — chokepoint grep re-affirmed at G7/G7B.
- **C09-03** boot-refusal tests (ENCRYPTION_KEY, JWT prod guard, m365 SSO redirect URI; no Supabase/license gate).
- **C09-11** logged requests never contain a raw `token` query value.
- **C09-12** token-revocation tests (P-03): logged-out rejected, admin logout invalidates, set repopulates across restart.
- **C09-17** activation tests: deactivated → ACCOUNT_DISABLED on all three planes immediately (write-through, no TTL) + token revoke; billing-locked → BILLING_LOCKED.
- **C13-15** activation suite (mirror of C09-17, envelope-validated).

### Phase 3 — G3 (platform CRUD domains)
- **C03-10** no `teams` route in implementation.
- **C03-11** Amendment 2 routes present (GET/PATCH /org, POST/GET /orgs, PATCH /orgs/:id, GET /registo, PATCH /settings/me).
- **C03-14** no bare `admin` auth class (every cell → user/org-admin/super-admin).
- **C09-10** audit rows record userId + real username.
- **C09-18** cross-org adversarial suite (403/404 only) + in-org sharing tests (first landing; re-run every later domain gate; whole-repo at G12).
- **C09-21** Registo read-surface metadata-only, org-admin own-org / super-admin cross-org, each read access-logged.
- **C13-04** 23 rewritten rule-set files map to named contract-test files; mapping in `api/tests/contract/README.md`.
- **C13-05** schema-coverage gate demonstrably fails on a schema without a contract test (deliberate red logged, ch13 §13.11.5 — performed at this domain gate).
- **C13-11** cross-org adversarial suite first-class per-PR member (deliberate red via unscoped query, logged) + in-org sharing tests.
- **C13-18** Registo read-surface suite (metadata only across all filters).

### Phase 4 — G4 (integrations + knowledge)
- **C05-30..C05-32** integration-affinity writer: single refreshed `preference` memory (no dup), config op survives a forced write failure, zero model calls.

### Phase 5 — G5 (push infra + triggers)
- **C09-08** webhook pipeline: signature-then-disabled ordering (410/401), dedup collision, audit row every outcome incl Adobe, boot self-test.

### Phase 6 — G6 (app pipeline, served-app plane, legal)
- **C03-06** all 12 §3.11 landmines addressed with concrete tests.
- **C03-07** served-app plane passes the ported 37-spec legal suite at helper level.
- **C05-20..C05-23** artifact-backend lane: post-delete refusal, post-settle capability rejection, hung-fn timeout+fresh-worker, dry-run captures without persist.
- **C07-01..C07-26** app pipeline (37-spec suite; every trigger observed; no builder outside triggers; 404/navigation/503 serving; IIFE prefix + ESM-fail; injected HTML members; deterministic slug + collision + follow-up; secret-guard commit-block+422; featured prebuild skip; featured-update snapshot pair; lazy heal; health broken→clear; fork isolation; MANIFEST_ID_MISMATCH+force snapshot pair; pdf 302 + app-pdf header refusal; single working-copy materialization; m365 gate refuse/forward).
- **C07-31, C07-32** design-tokens org resolved server-side from slug; no-brand org gets platform default.
- **C09-07** secret-guard: planted credential blocks snapshot (commit-blocked row) + download 422.
- **C09-09** path-confinement (traversal/symlink/absolute) uniform fail incl P-15 automation file ops.
- **C09-13** m365 Graph-proxy gate (missing/opt-out header refused pre-injection; opted-in succeeds).

### Phase 7 — G7 (LLM chokepoint core + billing)
- **C06-01, C06-02, C06-05..C06-18** 27 call sites accounted, platform fates, metering formula/weights/cache/period, single metering point, ledger single-writer, billing REST surfaces, 9 conflicts dispositioned, two auth modes, 3 credential semantics tests, no rotation-mutex tests, refresh-failure surfacing, billing-block delivery per class, P-19/P-20/P-24 resolved, FIXED-13 egress order, provider-reported metering, rate/spend caps per-org/per-user at chokepoint.
- **C09-19** credential-custody tests (proactive refresh, retry-once-on-401, persistent-failure alert, correct single credential per mode).

### Phase 7A — G7A (anonymisation layer)
- **C09-06** egress controls (a error sanitizer on SSE+REST; b payload-capture harness tokens-only across all origins).
- **C09-20** three-posture log discipline (no bodies/paths/tokens; detected spans irreversibly redacted at persist).
- **C13-12** payload-capture harness wired (checksum-INVALID NIF + deny-listed name tokens-only, tool_use resolves locally; streaming-straddle; prompt-cache byte-identical prefix; synthetic-data grep).
- **C17-01..C17-06** structural anonymise-before-transport; callsite inventory; tool_use round trip + straddle + cache-hit; vault never persisted; audit metadata-only; payload-capture across all scenarios.
- **C17-08** P-27 resolved (detector-at-persist, irreversible redaction) + register match + zero live PROPOSED.

### Phase 7B — G7B (agent execution)
- **C05-01..C05-19** guards (cancel idempotency, aborted-classifier bail, 45-min reservation, dual-fire, 409 concurrent, timer vs Stop, provider-error-as-failure), P-10 orphan sweep, SDK env (5 tests), session resume, chat tool surface, streaming union parse + no delegation-marker + dropped events, delegation build marker.
- **C05-24, C05-25** no model call outside chokepoint; no runtime markdown-as-logic.
- **C05-26..C05-29** P-12 memory extract (off = zero calls; on = one FAST call; write private + Registo; terminal event not delayed).
- **C06-03, C06-04** memory-extract + build-verify named as separate billable `user_work` sites; call 23 re-fated.
- **C07-27..C07-30** per-build verification (first full / follow-up scoped+smoke; unfixed completes with honest note; user_work/build-verify rows; toggle honored).
- **C08-01..C08-05, C08-07..C08-09** content: all §8 paths fated, no REST + config-only import, four-function API, executable-file rejection, composition slots 1+8 three agents, runtime-package durability, P-21 resolved, Q-06/Q-09 resolved.
- **C13-16** memory auto-extract suite. **C13-17** per-build verification suite.

### Phase 8 — G8 (automation)
No unique numbered acceptance criteria (automation route shapes roll into C03 route census at G9; automation module suites + 4 remote-display tests + deterministic-automation spec are suite-ledger artifacts, due green here / at G9). Gate = automation contract tests + ported module suites + drivers green.

### Phase 8A — G8A (delegation + bridge)
- **C05-33, C05-34** delegation derived-output-only; 409 DAEMON_NOT_CONNECTED, uploads nothing.
- **C09-04** cross-class token tests (bridge token on REST 401; session JWT at bridge upgrade refused; app-SSO cookie nothing on /api/v1).
- **C13-13** fake-daemon adversarial suite (5 scenarios rejected+ledgered; round trip derived-output-only; correlation-id join; revoke-pairing).
- **C18-01..C18-07** harness + scenarios; S1-S6 each tested; provider-endpoint credential→pairing→org chain; derived-output-only; correlation-id join; FIXED-2 exception scoped + token-class separation; bridge activation admission (third plane).

### Phase 9 — G9 (web client migration)
- **C03-01, C03-03, C03-04, C03-05, C03-09** every operation mapped; contract tests validate all endpoints; route census == map; four SSE only; no retired transport endpoints.
- **C05** (none — agent criteria discharged at G7B).
- **C09-05** route census: every non-exempt route rejects unauthenticated requests.
- **C12-01..C12-17** all web migration criteria (legacy transport zero; every FC touchpoint replaced; cleanup fates; one token accessor; one base-URL/lang source; EventSource confined; client==contract; typed events; tests migrated; locales pruned; behavior preserved; boundary lint; local-file surfaces; claims ship-gate; canvas WS confined; Amendment 2 surfaces FC-500..509; teams removed).
- **C13-01, C13-02, C13-06** band specs green (13 unchanged / 5 helper-swap / 37 unmodified); retired-pair re-coverage; protocol-parity gate + route census four streams.
- **C17-07** claims ceiling (grep forbidden strings zero; none enabled ahead of its test).

### Phase 10 — G10 (migration + parity tooling)
- **C10-01, C10-02, C10-03, C10-04** every store family mapped; each cutover criterion names its checking artifact; import scripts + replay harness + parity workload committed & dry-run-capable; P-25/P-26 resolved.
- **C10-05, C10-06** [CUTOVER-CLASS] rollback rehearsal on staging; external-URL list on the executed checklist — tooling/list built this run; EXECUTION is founder-gated, out of run scope (logged as such).
- **C10-07** amendment additions (bridge-pairings row, anonymisation go-live posture, pre-switch checklist items).
- **C10-08, C10-09** org-creation migration + control-plane migration — dry-run/rehearsal-checkable against the committed synthetic fixture.
- **C10-10** no Supabase coexistence mechanics remain.

### Phase 11 — G11 (discovery + regression expansion)
- **C13-07** every §13.6 gap-table row has its planned artifact present or a RUN_LOG deferral.
- **C13-10** discovery/periodic-audit tooling never imports product llm/ and holds no product credentials (grep-checkable).

### Phase 12 — G12 (dual-model review + final security)
- **C09-01** all eleven invariants have ≥1 passing automated check (whole-repo umbrella census).
- **C09-14** every FIXED-14 item names enforcement home+mechanism (incl B5 rate/spend, B6 payload-capture).
- **C09-15** cert-phase deferrals introduce no build gate; §9.10 points to ch18 without restating.
- **C13-14** rate-limit/spend-cap tests + the two security-briefed review passes (Claude full-repo + adversarial Codex) with verdicts in RUN_LOG.

### Phase 13 — G13 (docs/diagrams reconciled, deploy artifacts, rc-1)
- **C10-11** deploy artifacts (api/web Dockerfiles, deploy scripts, P-02/P-26 CI deploy lane; ekoa-deploy reference-only, no secret values; Secret Manager).
- **C14-02** gate template evidenced by every phase's RUN_LOG GATE entry (five items).
- **C14-03** RUN_LOG deliberate-red census (G0 boundary + @anthropic-ai + gitleaks + Semgrep; G1 ledger; schema-coverage red; one GATE entry per gate).
- **C14-04** no DEVIATION without citation+reason; annex count == RUN_LOG DEVIATION count.
- **C14-05** abort procedure never bypassed (zero ABORT + 18 gates, or one ABORT + no later gate).
- **C14-07** amendment phases present/ordered (G7→G7A→G7B→G8A; the G7A/G8A assertions; fake-daemon at api/test/fake-daemon/; Phase 12 security passes + docs/security/ one-pagers).
- **C14-08** Amendment 2 surfaces placed (org schema G2; org/users/Registo/sharing G3; build-verify+memory-extract G7B; web surfaces G9; whole-repo suites G12; deploy G13; §14.7/§14.8 exist; total 100; no `tenant` in normative prose).

## Progressive (multi-gate) criteria — first-landing vs completion gate

A few criteria are assigned to their **first-landing** gate (where the spec's own phase-gate text binds the primary assertion) but are only **fully** green at a later gate, because the surface they cover is built across phases. This mirrors the spec's explicit "re-run at every later gate" pattern (e.g. the cross-org suite C09-18, assigned to G3 but re-run through G12). Recorded here so the single-phase table is not read as "fully green early" (per the G-P adversarial-review finding, logged in RUN_LOG):

- **C09-17 / C13-15 (activation on all three admission planes).** First-landing G2 — chapter 14 Phase 2 gate names "the activation write-through test" (plane 1, the `/api/v1` auth middleware) and Phase 3 adds "the activation-admission test" (`ACCOUNT_DISABLED`). Plane 2 (served-app, keyed on artifact owner) completes at G6; plane 3 (bridge pairing) completes at **G8A**, where it is the dedicated criterion **C18-07**. The whole-repo activation assertion is re-run in G12.
- **C09-06 / C13-12 / C17-01..C17-06 (payload-capture tokens-only across all origins).** First-landing G7A — chapter 14 C14-07 binds "G7A asserts the payload-capture tokens-only test" (hosted/chokepoint-core origin). Chapter 18 §18.7.4 states the bridge/TUI origin is **re-exercised** in the delegation/bridge phase (G8A), covered there by **C13-13 / C18** (fake-daemon payload-capture), and again at whole-repo scope in G12. The assignment names the origin the spec's gate text assigns; the bridge origin rides the G8A criteria.

No mapping change results: each criterion is still counted once at the gate the spec binds its primary assertion to, and the later-plane/later-origin dimensions are independently covered by the G8A/G12 criteria already in the table. This is an AMBIGUITY resolution (§14.1 precedence 2: the spec's phase-gate text is the binding reading).

## Census reconciliation (§14.6 criterion, G-P stop check)

Enumerated criteria (chapters with an acceptance section): C02:7, C03:14, C04:20, C05:34, C06:18, C07:32, C08:9, C09:21, C10:11, C12:17, C13:18, C14:8, C17:8, C18:7. **Total = 224.** Chapters 01, 11, 15, 16 contribute 0 (overview / glossary / resolved registers).

Table-row assignments by phase: G-P:3, G0:13, G1:1, G2:27, G3:10, G4:3, G5:1, G6:37, G7:17, G7A:10, G7B:41, G8:0, G8A:11, G9:27, G10:10, G11:2, G12:4, G13:7. **Sum = 224.** Every criterion assigned to exactly one phase; census matches. ✓

Cutover-class (built as tooling, executed post-run under founder gate): C10-05, C10-06 (and the cutover halves of Q-02/Q-03/Q-09). No cutover, production, or deploy is performed by this run.

## Suite ledger

Skeleton at `api/tests/SUITE_LEDGER.json` (this run's G-P output; populated with per-file rows at G1). Every ported artifact from `spec/reference/test-audit.md` carries a target gate: 13 band-1 + 5 band-2 Playwright specs → G9; 37 band-3 served-app specs → G6; 17 frontend unit files → G9; test-client + 14 node drivers → their surface gates (app-*/erp-*/citius/legal-research G6, ifthenpay/invoicexpress/pipedream G4, integration-automation G8, whatsapp-inbound G5→G8, onboarding G7B); 23 rule-set contract tests → their domain gates (G2-G8); 146 module tests → their module gates; 20 conditional-carryover → their subsystem gates (streaming/gateway/adapters/bridge). Ratchet enforced in CI; skips ledger-scoped with `awaiting G<N>` reasons.
