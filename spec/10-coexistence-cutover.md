# 10. Coexistence and cutover

This chapter defines how the old Cortex keeps serving production while the new service is built, how every family of stored data moves (or deliberately does not move) to the new stack, how billing correctness is proven before any traffic switches, and the objective criteria under which the switch happens - plus the rollback path if it goes wrong. Ground truth is reference/data-inventory.md section 10 (migration implications) and reference/test-audit.md section 7 (the surviving safety net). Chapter 04 owns the target data shapes; this chapter owns the procedure. Nothing here modifies the old stack: it remains deployable and untouched until the cutover criteria are met and the rollback window has expired.

## 10.1 Coexistence topology during the build

The build phase runs two fully independent stacks. The old stack is the current ekoa-dev repository (cortex backend + ekoa frontend) deployed through the external ekoa-deploy repository; it continues to serve production at `app.ekoa.io` / `api.ekoa.io` (reference/operations-inventory.md section 0.1) for the entire build. The new stack is the greenfield repository (FIXED-1) with its own `api/`, `web/`, and `shared/` (chapter 02).

| Plane | Old stack (untouched) | New stack (during build) |
|---|---|---|
| Code | ekoa-dev repo + ekoa-deploy repo | new repo; old code is reference material only (FIXED-1) |
| Domain data | JsonStore/SQLite files under the production data volume (reference/data-inventory.md section 5) | own Firestore database (P-05, chapter 04); tests run `mongodb-memory-server`, dev runs a local `mongod` container |
| App data | production Firestore database `ekoa-app-data` (Mongo-compat; subject to Q-02) | a separate Firestore database (or local `mongod`) in dev; NEVER the production database |
| Data directory | production volume (`~/.ekoa/...` layout) | own configured data directory (chapter 04 section 4.4 single-dir rule); never shares the old volume |
| Control plane | Supabase: existing installation row in `standalone_credentials` | same Supabase project, a NEW installation row under a new `EKOA_INSTALLATION_ID` |
| Serving | `app.ekoa.io` / `api.ekoa.io` | dev ports locally; a staging hostname pair (for example `next-app.` / `next-api.`) behind the same reverse proxy for pre-cutover verification |

Rules, all FIXED by consequence of FIXED-1 and FIXED-8:

1. **No shared mutable state during the build.** The two stacks never read or write the same file, volume, database, or Supabase row. The one shared external system is Supabase, and the sharing is safe by construction: OAuth token custody is one row per installation (reference/data-inventory.md section 4.2), so a distinct `EKOA_INSTALLATION_ID` for the new stack means the rotation mutex and watchdog of each stack operate on disjoint rows. The `companies` license row is shared read-only (each installation patches only its own `last_seen_at`).
2. **The new stack never points at production app-data before cutover.** Pre-cutover verification against the real Firestore database happens exactly once, read-path-plus-parity-suite, as a named gate (section 10.5, criterion 6), against a dedicated verification database user.
3. **The old stack receives no rebuild-motivated changes.** Bug fixes to production continue under the old repo's normal process; any such fix that touches behavior the spec pins must be reflected into the spec (FIXED-12 discipline applies to spec diagrams; the RUN_LOG discipline of chapter 14 applies to the divergence note).

### 10.1.1 What the old stack contributes to the build (read-only)

Coexistence is not just isolation; the old stack is the rebuild's oracle in three read-only roles:

- **Behavioral oracle.** Where the spec pins carried behavior (the served-app plane, the engine semantics of chapter 04 section 4.2.8, the OAuth rotation rules of chapter 04 section 4.5), disputed readings are settled by observing the old stack, never by patching it.
- **Rehearsal data source.** Copies of the production data volume and database exports feed the migration rehearsals (section 10.3 item 6) and the ledger-replay parity check (section 10.4). Copies only - rule 1 stands.
- **Parity counterpart.** The scripted billing workload (P-25 part B) runs against the old stack once per parity round, during a normal maintenance-quiet period, using a dedicated test user so its ledger events are excludable from real billing.

### 10.1.2 The safety net during coexistence

The day-one executable safety net for the new stack is the ported test estate, not new tests (reference/test-audit.md section 7): roughly 96% of the frontend Playwright suite survives (55 of 57 specs - 13 unchanged, 5 with a one-function seeding-helper swap, 37 served-app legal specs unchanged if the served-app contract stays byte-compatible), 17 of 18 frontend unit files, and about 71% of the 206 backend vitest files port with their modules. The wire layer starts at zero executable coverage; porting the node driver client and its 14 driver scripts to the new REST surface is therefore an early build task (reference/test-audit.md section 2.6), and chapter 13 sequences it. During coexistence both estates run: the old stack's suite keeps guarding production as-is; the ported estate gates the new stack's build phases (chapter 14).

### 10.1.3 Timeline at a glance

| Phase | Old stack | New stack | Exit gate |
|---|---|---|---|
| Build | serves production, untouched | developed against own data; staged behind `next-*` hostnames | chapter 14 phase gates |
| Verification | serves production; hosts one scripted parity round | criteria 1-5 green on staging; migration rehearsal executed | section 10.5 criteria 1-9 |
| Freeze + switch | maintenance mode, then idle | receives production volumes, database pointer, and traffic | step 8 smoke green + criterion 10 sign-off |
| Rollback window (30 days) | stopped but deployable; frozen state retained | serves production | 30 days stable operation |
| Close | retired from deploy config; repos archived (FIXED-1) | sole production stack | Supabase dead-table cleanup done (P-08) |

## 10.2 Data migration sketch, per store family

Consolidated from reference/data-inventory.md section 10 and chapter 04 section 4.8. "Import script" always means a one-shot, idempotent, dry-run-capable script in the new repo (section 10.3) that reads the old store read-only and writes the chapter 04 target using existing ids as deterministic `_id`s (row 11's prose half writes the chapter 08 content store instead, which is content-addressed - idempotence holds by hashing rather than by `_id`).

| # | Family | Source (old stack) | Method | Target | Verification |
|---|---|---|---|---|---|
| 1 | App-data (user-app records) | production Firestore db, same cluster | **stays in place** - no migration. The new collections engine keeps the same physical collection, document shape, and scoping (chapter 04 section 4.2.2); at cutover the new stack's connection string points at the existing database. Conditional on Q-02 (section 10.9) | unchanged | engine parity suite green against the production database pre-cutover (chapter 04 section 4.2.8 item 8) |
| 2 | Domain stores (users, sessions, messages, artifacts, memories, billing ledger, automations, triggers, integration configs, settings, teams, activity, jobs, app-sessions, adobe-agreements, knowledge registries) | JsonStore JSON files and per-file directories (reference/data-inventory.md section 5) | export + import scripts, one per store, per the chapter 04 section 4.3.1 collection map | Firestore collections (P-05) | per-store record counts equal; canonical-JSON checksum diff (section 10.3) |
| 3 | Ciphertext fields (integration credentials, trigger HMAC secrets, captured browser sessions, Graph tokens) | inside the stores of row 2 | moved verbatim; `ENCRYPTION_KEY` carried to the new stack; no re-encryption pass (chapter 04 section 4.7) | same fields in target collections | decrypt-sample check: import script decrypts N sampled ciphertexts with the carried key and fails loudly on any failure |
| 4 | Blobs (app-file bytes, automation step screenshots, artifact screenshots/PDFs, brand-asset cache, knowledge raw uploads, snapshot dumps) | filesystem trees on the production volume (reference/data-inventory.md section 10.3) | copy onto the new data volume; path-bearing fields (`blobRefs`, `storedPath`, `screenshotPath`) rewritten to storage-relative keys during import (P-07) | new data directory | file counts + total bytes per tree equal; sampled content hash |
| 5 | Knowledge vault + FTS index | ~8 GB markdown corpus + ~6 GB derived SQLite index (reference/data-inventory.md section 5.2, 6.2) | **volume reattach**, not migrated: the vault directory is re-mounted (or copied once) into the new stack. The FTS index is derived data - it rides along if present, else the startup backfill rebuilds it (~9 minutes, acceptable) | new stack's knowledge directory | document count equals vault file count; one known-answer search returns the expected doc |
| 6 | Sandboxes, per-artifact git, browser profiles | `~/.ekoa/sandboxes/user-*/` (reference/data-inventory.md section 7.3) | copied with git histories intact (rsync-style, preserving mtimes). The `integration-skills/` subtrees inside sandboxes ride the copy as inert files, but their authoritative disposition is row 11 - nothing in the new stack reads them in place (the old discovery loaders do not carry; chapter 08 section 8.6) | new data volume | per-sandbox `git fsck` clean; directory counts equal |
| 7 | Event queue | SQLite `triggers.db` (reference/data-inventory.md section 6.1) | **starts fresh** - drained to zero before the freeze; the file is not copied | new empty queue | queue depth 0 at freeze; dead-letter rows exported to the RUN_LOG for the record |
| 8 | Supabase control plane | 3 live tables (reference/data-inventory.md section 4.2) | **untouched at cutover** (P-08). The new stack's installation row is created during the build (section 10.1); at cutover the old installation row is simply no longer refreshed | unchanged | new installation row shows healthy rotation for 7 consecutive days pre-cutover |
| 9 | One-shot migration sentinels and legacy in-place migrations | sentinel files and boot-time rewrite passes in the old stack | **not carried** - the importers operate on already-migrated data, so their effects are baked in; the fresh store starts clean (chapter 04 section 4.8 item 3) | none | grep gate: no sentinel-file logic exists in the new repo |
| 10 | Slug reservations | in-memory index rebuilt at boot today (reference/data-inventory.md section 9) | seeded from imported artifacts into the `slugs` collection; historical duplicates resolved deterministically by suffixing, each resolution logged (chapter 04 section 4.8 item 9) | `slugs` collection | every artifact's slug has exactly one reservation doc |
| 11 | Runtime-authored integration definitions (agent prose + structured config) | `<dataDir>/integration-skills/<key>/` (global runtime overlay - reference/data-inventory.md section 7.1) and `sandboxes/user-<id>/integration-skills/<key>/` (per-user - section 7.3), plus any key in the running old-stack container's `ekoa-data/integrations/` that diverges from the repo-versioned baseline (production saves land in the container's writable layer and survive only until redeploy - reference/data-inventory.md section 8), exported from the live container before the freeze | **split import** per chapter 08 section 8.6 rows 3-4: the structured parts (`config.json` field paths and actions, builder `history.json`, provisioned `automations/*.json` templates) become typed data owned by the integrations module (chapter 02 section 2.6); the prose (`SKILL.md`) is imported through the content loader's `importPackage` (chapter 08 section 8.3.2) into the durable runtime content store, preserving per-user ownership and the runtime-shadows-baseline precedence (chapter 08 rule 8.3.2 item 2) | integrations store + `<dataDir>/content/runtime/` (chapter 08 section 8.3.1) | per source key exactly one runtime package plus its typed data; the loader's `listPackages()` census equals the source key census; one known integration's composed agent context contains its package (chapter 08 section 8.3.2) |
| 12 | Bridge pairings (daemon<->Cortex pairing registry) | no persisted old-stack store - the old daemon connection registry was in-memory only (reference/data-inventory.md section 9); the persisted, tenant-scoped, revocable pairing registry is built this run (chapter 18 section 18.3) | **re-pair, not migrated.** The safe default at cutover is revoke-all: existing daemon pairings are dropped and the founder re-pairs the single install against the new stack (a single-founder install today, so re-pairing is cheaper and cleaner than importing). The daemon is re-pointed at the new stack's provider endpoint by a daemon-side configuration change, coordinated at the switch; the daemon code changes themselves belong to the later ekoa-local run (chapter 18 section 18.1), not this cutover | new empty pairing registry; the founder's single install re-pairs and one delegation round trip is green post-switch (step 8) |

Explicit non-migrations are listed in section 10.8.

**Import order** (referenced by step 5 of the procedure in section 10.6): ownership references must exist before the stores that point at them are imported and verified.

1. `users` (everything else references user ids), then `teams` and `settings` (global singletons and per-user overrides).
2. `sessions`, then `messages` and `session_contexts` (parent-before-child).
3. `artifacts`, then `slugs` seeding (row 10), then artifact-adjacent stores (`integration_configs`, `app_sessions`, `adobe_agreements`), then the integration-definition split import (row 11): typed data lands beside `integration_configs`, prose goes through the content loader's import API; it depends on nothing later in this list.
4. `memories`, `automations`, then `automation_runs` and `triggers`.
5. Ledgers last, largest first: `token_events`, `billing_accounts`, `activity_logs`, `jobs`, knowledge registries.
6. Blob-tree copies (row 4) run in parallel with 1-5; path-field rewriting happens inside each owning store's importer, so a store's verification only passes after its blob tree is in place.

### 10.2.1 Anonymisation layer go-live posture

The anonymisation layer (chapter 17) is greenfield, built during the run, not migrated - there is no old-stack anonymisation state to move (the old `memory/anonymizer.ts` was dead code, chapter 11). What cutover governs is which of its detection layers must be live at the switch and how its claims are constrained:

- **Detectors (a) structured-ID recognizers and (b) per-tenant deny-list are live at cutover** - unconditional. They must not depend on the NER service being up (chapter 17 section 17.4).
- **Detector (c) PT-PT NER goes live per its verified state at cutover.** If the run ships (c) at reduced scope behind the interface (the v2 brief's cut-line 3), that is acceptable ONLY if the claims text in docs and UI is trimmed to match what is actually enforced.
- **Claims never run ahead of enforcement.** Every product string bounded by the chapter 17 claims discipline (the v2 brief A1/A6 claimable and forbidden lists, carried verbatim into chapter 17) ships only after the mechanism it describes passes its build gate (chapter 14). This is the v2 cut-line rule 3, carried: never claim ahead of enforcement. The pre-switch checklist (section 10.6) evidences the enforced-vs-claimed match.

## 10.3 Migration tooling requirements

The import scripts are deliverables of the implementation run (chapter 14 sequences them), not throwaway operator work:

1. **Read-only on sources.** No script writes to, moves, or deletes anything on the old stack's volume or databases. Rollback safety depends on this.
2. **Idempotent.** Deterministic `_id`s mean a re-run upserts identical documents; a partially failed run is fixed by re-running, never by hand-editing.
3. **Dry-run by default** (the pattern the existing provisioning and export scripts already follow - reference/data-inventory.md section 3.6): `--execute` is required to write; dry-run prints the full plan and counts.
4. **Verification built in.** Each script ends by re-reading its target and printing `source count / imported count / checksum match` per store. Checksums are computed over a canonical JSON projection (sorted keys, ciphertexts and rewritten path fields excluded from source-side hashing since they are transformed by design). Stores above 10k records (token events, activity, messages) verify counts exactly and checksum a deterministic 1% sample.
5. **Journaled.** Every run appends to the RUN_LOG (chapter 14 discipline): timestamps, counts, every slug-collision resolution, every decrypt-sample result, every anomaly.
6. **Rehearsed.** The full migration must run end to end against a copy of production data at least once before the freeze (criterion 7, section 10.5), and the rehearsal must complete inside the 60-minute window budget defined in section 10.6.

## 10.4 Billing parity - RESOLVED (P-25)

Cutover requires proof that the new metering (chapter 06) bills the same work the same way the old stack does. True live-traffic mirroring is the wrong tool here: replaying an agent prompt produces different token counts run to run, doubles Anthropic spend, and duplicates side effects (builds, webhooks, files). Billing parity is proven instead by two complementary checks, both committed as re-runnable artifacts:

- **Part A - deterministic ledger replay (tolerance: zero).** Export the old stack's token-event ledger for a full closed billing period. Feed the raw events through the new billing module's pure computation path (tier weights, cache-read discount, metered-token arithmetic, per-user period aggregation - chapter 06). The recomputed per-user totals must equal the old stack's stored aggregates exactly. This proves the accounting math with no model calls at all.
- **Part B - scripted parity workload (structural exactness, banded totals).** A fixed suite of representative billable operations runs once against each stack in the same week. Exact assertions: each operation produces exactly one ledger event per model call, with correct attribution class (`user_work | platform | classifier`, FIXED-3), correct tier weight, and no unattributed calls (the new stack must additionally show zero `platform`-attributed calls in these flows, per the chapter 06 call-site fates). Banded assertion: total metered `user_work` tokens per operation class within plus/minus 25% of the old stack's - the band exists only to catch gross wiring errors (double-billing, missed metering); model nondeterminism makes a tighter band meaningless, and the exact structural checks are the real gate.

  Workload composition (fixed prompts, committed with the harness):

  | Operation class | Count | What it exercises |
  |---|---|---|
  | Chat turns (simple question + knowledge-grounded legal question) | 10 | classifier attribution + `user_work` chat metering + cache-read discount |
  | Build jobs (one small artifact from a fixed prompt, one follow-up edit) | 4 | the expensive-tier `user_work` path, job-scoped metering, duplicate-build guard |
  | Automation runs (one cached replay, one vision-resolving run) | 4 | vision-call attribution and the cache path producing zero model calls |
  | Integration-builder sessions | 2 | the remaining agent surface's metering |
  | Gateway calls via ekoa-local | 4 | wire-tier gateway metering (chapter 06) |
- Rejected alternative: shadow-mirror live production traffic to the new stack and compare ledgers - rejected for double model cost, duplicated side effects requiring a full side-effect quarantine layer that would itself need verification, and nondeterministic outputs still forcing a tolerance band: all cost, no additional assurance over A+B.
- **Launch deliverable (blocking).** The implementation run must build the replay harness and the scripted workload as committed, re-runnable artifacts (chapter 13 names them), because criterion 5 in section 10.5 is not checkable without them.

Resolved: ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 10.5 Cutover criteria

The switch happens when ALL of the following are true. Each is objective and checkable without judgment calls; together they are the gate.

| # | Criterion | Checked by |
|---|---|---|
| 1 | **Full frontend e2e suite green against the new stack**, including the 37 served-app legal specs passing unchanged at the helper level (the served-app contract preserved byte-compatibly - reference/test-audit.md sections 2.4, 7) and the 5 fixture-swapped specs (section 2.2). Target: 55 of 57 current Playwright specs pass (2 retire by design) | CI run against staging |
| 2 | **API contract tests green**: every endpoint in chapter 03 validates request and response against its `shared/` zod schema; route census equals the chapter 03 map (chapter 03 section 3.12) | CI |
| 3 | **Ported module suites green**: the successors of the ~146 carryover vitest files and the rewritten endpoint contract tests (reference/test-audit.md sections 5.2, 5.3) | CI |
| 4 | **Wire suite green**: the ported node driver client and the 14 driver scripts, rewritten against the new REST surface (reference/test-audit.md section 2.6), pass against staging | CI against staging |
| 5 | **Billing parity per P-25**: ledger replay exact; scripted workload structurally exact with totals inside the band | replay harness + workload reports |
| 6 | **Production app-data verification**: Q-02 answered (the literal production backend value confirmed in ekoa-deploy), and the engine parity suite has passed once against the production Firestore database. Q-02 is dispositioned as a cutover-checklist ops action - confirmed as answered at cutover, not at run start (chapter 16 Q-02 resolution line) | manual verification + one gated CI job |
| 7 | **Migration rehearsal complete**: full dry-run-then-execute rehearsal on a production data copy, zero errors, all counts and checksums matching (section 10.3), total execute time within the 60-minute window budget | rehearsal RUN_LOG |
| 8 | **Control plane healthy**: the new installation row shows successful OAuth rotation (including at least one watchdog-observed proactive refresh) for 7 consecutive days | Supabase row history + health surface |
| 9 | **Q-03 dispositioned**: PITR restore points either verified GA-and-driver-supported or the backups UI demonstrably does not advertise them (chapter 04 section 4.9). Q-03 is dispositioned as a cutover-checklist item - answered at cutover, not at run start (chapter 16 Q-03 resolution line) | manual verification |
| 10 | **Founder sign-off recorded**, covering the criteria evidence above and the scheduled maintenance window | signed note in the RUN_LOG |

Criteria 1-5 are re-run and must be green within the 7 days preceding the switch.

## 10.6 The switch: mechanics and procedure

**Reverse-proxy upstream swap - RESOLVED (P-26).** Both stacks sit behind the existing reverse proxy (the current production topology already terminates `app.` and `api.` there - reference/operations-inventory.md section 0.1). Cutover is an upstream swap: `api.ekoa.io` upstream moves from the old cortex container to the new `api/` container, `app.ekoa.io` from the old frontend to the new `web/` container. Rollback is the same swap reversed, effective in seconds. Rejected alternative: a DNS record change to new hosts - simpler if the new stack lives on a different machine, but rollback is TTL-bound and client-cached. The deploy mechanism is pure ops, identical in outcome under either mechanism; the implementation run assumes the reverse-proxy upstream swap. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

**External URL continuity (hard requirements, either mechanism):**

- `POST/GET /hooks/:triggerId` must keep its exact origin and path: trigger ids are baked into external provider configurations, and the id doubles as the URL segment (reference/data-inventory.md section 5.1 triggers; chapter 03 section 3.11 landmine 3). Trigger ids migrate verbatim as `_id`s (section 10.2 row 2).
- `/apps/:slug/` links shared with end users keep working: slugs migrate verbatim; the served-app plane is byte-compatible (chapter 03 section 3.9).
- OAuth redirect URIs registered in the Google, Microsoft, and Adobe consoles point at api-origin callback paths. If chapter 03's callback paths differ from the old ones, updating the provider consoles is a listed pre-switch step; otherwise paths are preserved. Either way this appears on the cutover checklist explicitly - a silently broken redirect URI is a full login outage for platform integrations.

**Pre-switch checklist (all items done before T minus 1 hour, evidenced in the RUN_LOG):**

- criteria 1-5 re-run green within the last 7 days; criteria 6-9 dispositioned;
- baseline content packages final and ingested: every chapter 08 section 8.6 row fated "carries as content" (agent behavior packages, onboarding catalogs, base design prose, versioned integration prose, the old system-prompt texts) is authored as a baseline package under `api/content/` in the new repo (chapter 08 delegates this import step here); **Q-09 is RESOLVED (import** `ekoa-data/legal-shared/` and `ekoa-data/legal-spine/` **as on-demand knowledge packages, task-scoped to legal builds** - chapter 08 section 8.6 row 16, chapter 16 Q-09), so the baseline package set is final, and the content loader's boot ingest plus one composed context per agent verified green on staging;
- OAuth redirect URIs verified or updated in the Google, Microsoft, and Adobe consoles (above);
- rollback rehearsal done on staging (section 10.10 item 5);
- the new stack's production configuration reviewed against chapter 04 boot requirements (`ENCRYPTION_KEY` present and carried, Supabase config present, app-data connection string prepared but not yet pointing at production);
- maintenance page and proxy upstream definitions for both directions of the swap prepared and syntax-checked;
- the nightly GCS DR export (reference/data-inventory.md section 3.6) has a fresh successful run, as the independent last-resort copy;
- **served-app M365 sweep (Q-10)** complete: every served app that calls `/api/m365/*` without the `X-Ekoa-App-Id` header is inventoried and its breakage sized before the gated proxy (which now requires and verifies the header - slug-resolved, charset-checked, app exists and is served - plus a per-app manifest opt-in flag; chapter 03, chapter 09) is switched on. Q-10 is RESOLVED (gate the proxy; chapter 16 Q-10); this sweep is its named cutover action;
- **anonymisation claims match enforcement (section 10.2.1)**: for every product string bounded by the chapter 17 claims discipline, the mechanism it describes has passed its build gate (chapter 14); any claim without live enforcement is trimmed before the switch - never claimed ahead of enforcement;
- **bridge re-pair coordinated (section 10.2 row 12)**: the revoke-all-then-re-pair default is scheduled with the founder and the daemon's provider-endpoint configuration change is staged, so the single install re-pairs against the new stack at the switch;
- **vendor register complete (owner action, security addendum E.4; chapter 09)**: Anthropic (DPA plus zero-data-retention configuration for the API), GCP, Codex/OpenAI, Tailscale, and Slack recorded with GDPR Art. 28 processor terms verified for each;
- **EU AI Act Annex III assessment documented (owner action, security addendum E.6; chapter 09)**: whether any Ekoa Legal feature falls under Annex III (administration of justice) is assessed and recorded, with deployer transparency duties noted.

**Procedure (window budget: 60 minutes, rehearsed per criterion 7):**

1. T minus 7 days: staging green on criteria 1-5; announce the window.
2. T minus 1 hour: stop accepting new agent jobs and automation runs on the old stack; in-flight jobs drain (wall-clock ceiling is 40 minutes today) or are cancelled at T.
3. T: maintenance mode at the proxy - both origins serve 503 with a PT-PT maintenance page ("Em manutenção programada. Voltamos dentro de minutos."). Webhook providers receiving 503 retry later by their own policies; deliveries acked before T were 200-acked and will not be retried, so the fresh queue (section 10.2 row 7) causes no double-processing.
4. Drain the event queue to zero; export dead-letter rows to the RUN_LOG.
5. Run the import scripts in dependency order (users before owned stores); run verification; any count or checksum mismatch aborts the window (section 10.7).
6. Re-mount the knowledge volume and copied trees (blobs, sandboxes) into the new containers; point the new stack's app-data connection string at the production Firestore database.
7. Swap proxy upstreams to the new containers.
8. Smoke: `GET /health` OK; UI login; one chat turn completes; one legal served app loads and writes a record through the engine; one signed webhook round-trip lands in the queue and is delivered to its target.
9. Lift maintenance mode. Cutover complete; the rollback window opens.

## 10.7 Rollback plan

The old stack remains fully deployable until the criteria are met AND for a 30-day rollback window after the switch. Nothing in sections 10.2-10.6 mutates old-stack state (importers are read-only on sources; volumes are copied, and the knowledge volume re-mount is reversible).

| Scenario | Action | Data consequence |
|---|---|---|
| Verification mismatch or window overrun during the procedure (before step 7) | abort: lift maintenance on the old stack | none - old stack state untouched |
| Smoke failure at step 8 | reverse the upstream swap inside the same window | none - no user traffic reached the new stack |
| Regression discovered within the 30-day window | reverse the swap; re-mount knowledge volume to old containers | app-data intact; domain-store divergence handled per below |
| After 30 days | no automated rollback; forward fixes only | window closed (see end of section) |

- **Abort before step 7** (verification mismatch, overrun of the window budget): swap nothing, lift maintenance mode on the old stack, and the system is exactly as it was. Cost: one missed window.
- **Rollback after the switch, within 30 days:** reverse the proxy swap; re-mount the knowledge volume to the old containers. Data consequences, stated honestly:
  - **App-data survives rollback intact.** Both stacks operate the same production Firestore database with the same document shapes and scoping (section 10.2 row 1), so records written by the new stack remain readable by the old one. This is the deliberate payoff of keeping the engine byte-compatible.
  - **Domain-store writes diverge.** The old stack resumes from its JsonStore state frozen at T. Anything written to the new stack's Firestore domain collections after T (new sessions, memories, ledger events, automations) does not flow back automatically; on rollback it is exported by the same tooling in reverse (Firestore to JSON dumps) and preserved for manual reconciliation. The rollback decision therefore weighs elapsed time: rolling back on day 1 loses little; on day 29 it is a founder-level tradeoff.
  - **Billing continuity:** the new stack's post-T ledger export is authoritative for the divergence period; old-stack aggregates are corrected manually from it if a billing period closes during the window.
- **After 30 days of stable operation** the rollback window closes: old-stack containers are retired from the deploy configuration (the repos remain archived reference material per FIXED-1), the old installation row in Supabase is deactivated, and the 9 dead Supabase tables are dropped in the control-plane cleanup (P-08; reference/data-inventory.md Conflicts C7).

## 10.8 Explicitly NOT migrated

Consolidated register; each row cites its evidence. The implementation run must not write importers for any of these.

| Item | Reason | Citation |
|---|---|---|
| Projects store (`projects/user-*/...`) | vestigial - zero consumers outside its own persistence module | reference/data-inventory.md section 5.1 projects; chapter 04 section 4.3.1 DROP row |
| Dead stores with zero code references: `templates.json`, `governance.json`, `deployments.json`, `template-skills/`, `template-previews/`, `template-screenshots/`, the old agent-content manifest file (`~/.ekoa/.claude/skills/manifest.json`) | nothing reads them at HEAD | reference/data-inventory.md Conflicts C2 |
| Legacy content-layer per-app data files under the old data dir (except `company.json`, which migrates) | the layer that wrote them does not exist in the rebuild (FIXED-4) | reference/data-inventory.md section 7.1; chapter 04 section 4.3.1 |
| Legacy user-authored app definitions under `~/.ekoa/apps/` and their compiled write-backs | artifacts of the removed runtime-interpreted layer (FIXED-4) | reference/data-inventory.md section 7.4 |
| The 9 dead Supabase tables (abandoned control-plane billing/pool schema) | never touched by serving code; dropped post-cutover, not carried | reference/data-inventory.md section 4.3, Conflicts C7 |
| One-shot migration sentinel files | effects baked into migrated data; fresh store starts clean | chapter 04 section 4.8 item 3 |
| `<dataDir>/uploads/` base directory | holds only the `.write-test` health-probe file; real chat uploads are staged in per-user sandboxes (section 10.2 row 6) and the dev-only probe endpoint is dropped in favor of boot-time upload-directory validation (chapter 03 Appendix A) | reference/data-inventory.md section 7.1 uploads row |
| Event queue rows (`triggers.db`) | drained pre-freeze; queue starts fresh | section 10.2 row 7; reference/data-inventory.md section 6.1 |
| Knowledge FTS index (if inconvenient to carry) | derived data; the backfill rebuilds it in ~9 minutes | reference/data-inventory.md section 6.2 |
| Featured-build dists and template-preview build output | regenerable build cache, rebuilt by the new pipeline | reference/data-inventory.md section 10.3 |
| The `gcs` restore-point stub | enum-only stub, never implemented; dropped from v1 | reference/data-inventory.md Conflicts C10; chapter 04 section 4.2.7 |
| All explicitly in-memory state (traces ring buffer, SSE replay buffers, device-login codes, app registry, daemon connection registry) | the rebuild must not invent persistence for these | reference/data-inventory.md section 9 |

## 10.9 Cutover-class resolutions this chapter executes

No new open questions are raised here. Three questions are resolved as cutover-class - their decision is fixed (chapter 16), and the answer is produced or applied on this chapter's checklist, not at run start:

- **Q-02** (resolved, cutover-class) - the literal production `EKOA_APP_DATA_BACKEND` value lives in ekoa-deploy and was unverifiable from this machine (reference/data-inventory.md Conflicts C1). Confirmed as a cutover-checklist ops action, answered at cutover, not at run start (chapter 16 Q-02); criterion 6 makes producing that answer a hard gate. If production turns out to run the filesystem driver, section 10.2 row 1 becomes a real import (filesystem app-data through the engine, tooling already specified for dev in chapter 04 section 4.8 item 1) and the window budget must be re-rehearsed before the freeze.
- **Q-03** (resolved, cutover-class) - PITR maturity on the Mongo-compat surface, confirmed as a cutover-checklist item (chapter 16 Q-03). Criterion 9 requires it dispositioned before the backups UI can promise time-travel restore (chapter 04 section 4.9).
- **Q-09** (RESOLVED - import) - `ekoa-data/legal-shared/` and `ekoa-data/legal-spine/` are imported as on-demand knowledge packages, task-scoped to legal builds (chapter 08 section 8.6 row 16; chapter 16 Q-09). The baseline content-package step on the pre-switch checklist (section 10.6) executes that import; the chapter 08 loader supports it without code change.

## 10.10 Acceptance criteria for this chapter

1. Every store family in reference/data-inventory.md sections 5, 6, and 7 appears in section 10.2 or section 10.8 exactly once (auditable by cross-reading against the chapter 04 section 4.3.1 map, which this chapter must not contradict).
2. Every cutover criterion in section 10.5 names the artifact or run that checks it; none requires human judgment beyond the final sign-off row.
3. The import scripts, the ledger-replay harness, and the scripted parity workload exist in the new repo as committed, re-runnable, dry-run-capable tools (sections 10.3, 10.4), and the rehearsal RUN_LOG exists before the freeze.
4. P-25 and P-26 are RESOLVED (sections 10.4, 10.6): each states its normative decision, a rejected-alternative note, and a resolution attribution.
5. The rollback path in section 10.7 is exercised once in rehearsal (proxy swap reversed on staging, old stack answering again) before the real window.
6. The external URL continuity list in section 10.6 (webhook ingress, app slugs, OAuth redirect URIs) appears verbatim on the executed cutover checklist in the RUN_LOG.
7. The amendment additions are present and evidenced: the bridge-pairings row (section 10.2 row 12), the anonymisation go-live posture (section 10.2.1), and the pre-switch checklist items for the Q-10 served-app sweep, anonymisation-claims-match-enforcement, bridge re-pair, vendor register, and EU AI Act assessment (section 10.6).

*End of chapter 10.*

Amendment record: amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md) - P-25/P-26 resolved; bridge-pairings migration row, anonymisation go-live posture, and the Q-10/anonymisation-claims/bridge-re-pair/vendor-register/EU-AI-Act checklist items added; Q-02/Q-03 cited as cutover-class resolutions and Q-09 recorded as resolved-import.
