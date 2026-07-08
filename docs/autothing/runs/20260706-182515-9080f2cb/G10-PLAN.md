# G10 — Migration + parity tooling plan (ch10)

Durable roadmap for phase-10. Written at the gate-9 boundary. G10 builds the CH10 criterion-3
tooling as committed, re-runnable, dry-run-capable artifacts, tested against committed SYNTHETIC
fixtures (real production data isn't available in the build; the rehearsal-against-prod RUN_LOG is an
operator step at the actual freeze, out of the build's scope).

## Phase-10 gate acceptance (FLOW_PLAN)
- import scripts dry-run green vs a committed synthetic fixture (counts + checksums match a manifest);
- replay harness reproduces exact totals (tolerance zero);
- workload harness runs in structural-assertion mode.

## Three deliverables

### 1. Import scripts (§10.3, §10.2)
One idempotent, **read-only-on-source**, **dry-run-by-default** (`--execute` to write), **verification-
built-in** (prints `source count / imported count / checksum match` per store; checksum over a canonical
JSON projection with sorted keys, ciphertext + rewritten-path fields excluded from source-side hashing),
**journaled** (appends to RUN_LOG) script per §10.2 store family. Location: `scripts/migrate/` (or
`api/scripts/migrate/`). The §10.2 families + order:
- **2a orgs** (CREATED from the users roster: one org per user, default design system, founder=super-admin)
  → **users** (each gains a required `orgId`) → **settings**. (teams NOT imported; company.json archived.)
- **artifacts** → **slugs** seeding (row 10, dup-suffix resolution logged) → integration_configs / app_sessions /
  adobe_agreements → the **integration-definition split import** (row 11: typed data + prose via the content
  loader importPackage).
- Ledgers last, largest first: **token_events, billing_accounts, activity_logs, jobs, knowledge registries**.
  **credentials** singleton (row 8: standalone_credentials → credentials, decrypt-sample under carried
  ENCRYPTION_KEY, no installation rows) imports anytime.
- Ciphertext (row 3): moved verbatim, decrypt-sample check. Blobs (row 4): copy + path-field rewrite to
  storage-relative keys, counts+bytes+sampled-hash. Rows 5/6/7/9/12 are volume-reattach / fresh / re-pair /
  not-carried (§10.2) — not import scripts, but the tool set documents them.
- TEST: a committed synthetic source fixture (small JsonStore-shaped trees) + a manifest (per-store counts +
  checksums); the script's dry-run output matches the manifest; `--execute` into an ephemeral memory-mongo
  then re-read matches.

### 2. Ledger-replay harness — Part A (§10.4, tolerance ZERO)
Feed a synthetic old-stack token-event ledger (a full closed billing period) through the NEW billing
module's PURE computation path (api/src/billing: tracker/service/constants — tier weights, cache-read
discount, metered-token arithmetic, per-user period aggregation, ch06 §6.5.2 formula). Assert the
recomputed per-user period totals equal the fixture's stored aggregates EXACTLY. No model calls. Location:
`scripts/billing-replay/` + a committed synthetic ledger fixture + expected aggregates.

### 3. Parity-workload harness — Part B (§10.4, structural mode)
The fixed workload (committed prompts): 10 chat turns + 4 build jobs + 4 automation runs + 2
integration-builder + 4 gateway calls. In **structural-assertion mode** (the phase-10 scope — NO live
model calls; drive the metering path with stubbed/recorded model responses): assert each operation
produces exactly ONE ledger event per model call, correct attribution class (user_work|platform|classifier,
FIXED-3), correct tier weight, no unattributed calls, and ZERO platform-attributed calls in these flows.
The ±25% banded token-total check is a live-run assertion (documented; the structural checks are the gate).
Location: `scripts/parity-workload/` + committed fixtures.

## Gate G10 (ch14 template)
ci:lane 0 (the harnesses + their tests run under the api/shared suites or a dedicated test lane), the three
tools dry-run/structural-green vs their committed fixtures, dual review (Claude fresh-context + Codex
deferred to G12), ledger+ratchet, no new diagram (tooling), checkpoint + tag gate-10.

## NOT in G10 (operator / later)
The actual cutover (§10.5/§10.6 switch), rollback rehearsal (§10.7), the real prod-data rehearsal RUN_LOG,
the Dockerfiles/deploy-scripts/CI-deploy-lane (§10.6.1 — a G13 deliverable per FLOW_PLAN). §10.10 criteria
1/2/4/7/8-11 are largely spec-internal-consistency (satisfied when the spec was authored) or operator
checklist items; the BUILD gate is criterion 3 (the three tools) proven against synthetic fixtures.
