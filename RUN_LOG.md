# RUN_LOG

Append-only journal (chapter 14 section 14.2.3 discipline). The implementation run initializes its own entries at gate G-P; the entries below precede the run - they record the Amendment 2 spec-patch session, which chapter 14 and chapter 16 cite.

---

## 2026-07-06 - Amendment 2 (consolidated ledger) spec-patch session

**Type:** AMENDMENT (documents and diagrams only; no implementation). **Input:** the founder's consolidated-ledger brief, saved verbatim at `docs/ekoa-code-spec-amendment-2-consolidated-ledger.md`. All decisions founder-resolved 2026-07-06; applied with chapter 15 section 15.1 mechanics.

### FACT - Q-02 factual half closed: production app-data backend value

**Recorded value: `fs` (filesystem), as deployed by the committed ekoa-deploy pipeline.** Read-only verification of `/Users/ggomes/Projects/ekoa-deploy` and `/Users/bazinga/dev/ekoa-dev/cortex`, 2026-07-06:

- The switch is env `EKOA_APP_DATA_BACKEND` (old cortex `src/persistence/app-data.ts:69-81`): default `'fs'`; `'mongo'` additionally requires `EKOA_APP_DATA_MONGO_URI` or the process throws.
- The cortex container's `env_passthrough` (`ekoa-deploy/services/cortex/deploy.json:14`) forwards only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EKOA_INSTALLATION_ID`, `EKOA_LICENSE_KEY` - neither app-data variable reaches the container.
- The baked `cortex/.env` in the build context sets neither variable (verified).
- Corroboration: the persistent volume mount `/opt/ekoa/cortex-data:/root/.ekoa` (`deploy.json:15`) is exactly where the filesystem backend writes (`~/.ekoa/data/app-data/...`).
- The old docs' prod=mongo claim (`ekoa-dev/docs/decisions.md:37,44`; reference/data-inventory.md Conflicts C1) reflects a hand-set `cortex/.env` on some host that the committed pipeline does not reproduce. A hand-set override on the live container therefore remains possible outside source control.

**Consequence applied to the spec:** chapter 10 section 10.2 row 1 now defaults to the real app-data import branch (filesystem app-data imported through the engine by the run-delivered one-shot script), with the no-migration connection-string repoint kept as the cheaper branch if the live container proves hand-set to mongo. A live-container re-confirmation stays on the chapter 10 cutover checklist (criterion 6 as re-worded). Also verified: no fs-to-mongo importer exists in the old code (the two `app-data-migration.ts` modules are fs-to-fs) - the import script remains a run deliverable; `mongodb-memory-server` is a devDependency (5 test files) and the `mongodb` driver a prod dependency - both stay.

### FACT - License server exploration (amendment Part 1.4)

No separate license-server app exists in ekoa-dev (no directory, package, or service; the "control plane / admin portal" wording in `supabase/migrations/001_license_system.sql` is an abandoned design - dead schema). License logic lives entirely inside old cortex: a fatal boot gate (`startup.ts`: Supabase env check + license check - `companies` row by `EKOA_LICENSE_KEY` must be active; `installations` row by `EKOA_INSTALLATION_ID` must exist, belong to that company, be active; fire-and-forget heartbeat), a tier feature map computed and never enforced, and two registry tools no handler dispatches. The frontend consumes no license surface (`/activate` is RFC-8628 device login, unrelated). `standalone_credentials` is Claude OAuth custody, not license data. **Consequence applied:** nothing folds into `api/` beyond the activation model (chapter 09 section 9.7.1) and the central credential custody (chapter 04 section 4.5 as rewritten); the license plane retires with the old stack; tiers and the tier feature map are dropped as a concept.

### FACT - ekoa-deploy shape extraction (amendment Part 7.20; secret NAMES only, no values copied)

Python/uv machine-manager + hand-run service deployer (no CI): lanes `services/{cortex, ekoa-app, site, stt, tts}` (no `speech`/`ekoa-core` lanes exist; `site`/`stt`/`tts` are out of ekoa-code scope), deployed by tar+scp+`docker build`+`docker run` over SSH/Tailscale to GCP VMs registered in `machines/machines.json` (cortex :4111, ekoa-app :3000 on `ekoa-app-europe-west4-a`). No reverse proxy exists inside the repo: TLS + host routing for `api.ekoa.io`/the app host live at the existing external edge (Cloudflare; `NEXT_PUBLIC_API_URL=https://api.ekoa.io` baked into the app image). Secrets: gitignored `.env` forwarded per-service as `docker run -e` (names recorded in the exploration report; values never read). **Consequence applied:** chapter 10 states the edge reality honestly under P-26 (the upstream swap executes at the existing external edge; decision unchanged); the new stack's deploy artifacts (Dockerfiles for `api/` and `web/`, deploy scripts, CI deploy lane) are chapter 14 terminal-phase deliverables, with secrets in Secret Manager per FIXED-14 (the `.env` posture is not carried); ekoa-deploy keeps deploying old Cortex until cutover, then retires (chapter 10 retirement row).

### DECISION - session-level choices within the amendment's mandate (each recorded per section 15.1; none minted as a register entry)

1. **Diagram choice (Part 8):** a new `12-org-tenancy` diagram is ADDED (orgs/users schema, org-scoped vs user-scoped split, the three admission planes consulting the activation cache) rather than overloading diagram 05 - the org model is a new structural dimension and reads better standalone. Diagrams 01/04/05/06 updated; 09-qa-pipeline inspected and updated only if touched (the per-build verification is a product feature, not the repo QA pipeline).
2. **Org REST naming:** the `/api/v1/company` resource becomes `/api/v1/org` (caller's org) plus `/api/v1/orgs` (super-admin management), per the brief's "schema/API name: org"; the PT-PT display label stays "Escritório"; the client re-points in chapter 12.
3. **Role vocabulary:** exactly `super-admin` / `org-admin` / `builder`; JWT claims carry `orgId` (replacing `companyId`). Existing `admin`-class endpoints map to `org-admin` where the resource is org-scoped (brief Part 4.9) and `super-admin` where platform-wide.
4. **Amendment attribution tags:** the two new billable call classes are `memory-extract` (P-12 re-resolved; FAST tier) and `build-verify` (Part 6; WORKHORSE floor, fix-forward edits may classify higher) - marked as Amendment 2 additions beside the carried 27-site census in chapter 06.
5. **Supabase acceptance-grep interpretation:** "no Supabase reference outside chapter 10's migration/retirement rows" is applied to live/normative prose; the chapter 15/16 register entries keep their original resolution text as history (section 15.1 mechanics append, never rewrite), and chapter 11's glossary carries the retirement mapping.
6. **Per-user toggles surface:** `build.verifyBuilds` and `memory.autoExtract` ride the existing per-user settings store (`user_settings`), surfaced via the merged `GET /settings` view and a new `PATCH /settings/me` endpoint.

### GATE - session acceptance

The amendment brief's acceptance greps (Part 8) were run after the patch and pass: `teams` appears only in the chapter 11 glossary row, register/appendix history, and deletion-context prose (no live domain surface); `tenant` in live/normative prose resolves to `org` everywhere including chapters 17 and 18 (the only surviving `tenant` occurrences are SPEC.md's FIXED-14 verbatim founder wording, register-rationale history, and amendment-record change descriptions); `visibility` (`private | org`) is present in the shared memory and artifact schemas; `ACCOUNT_DISABLED`/`BILLING_LOCKED` are in the chapter 03 section 3.3 error table with PT-PT copy that matches every consumer verbatim; no Supabase reference survives outside chapter 10's migration/retirement rows, the chapter 15/16 register history, and the chapter 11 glossary; `getAppDataBackend`/`EKOA_APP_DATA_BACKEND`/the filesystem backend appear only in not-carried statements; the SPEC.md status line reads "AMENDED 2026-07-06 (twice)"; every FIXED amendment carries its inline amended note; zero em-dash characters anywhere; zero literal `PROPOSED P-<digit>` markers spec-wide.

Cross-reference integrity verified directly (the fanned-out adversarial verification workflow aborted on Fable-5 credit exhaustion mid-run and produced no findings; a targeted main-loop pass on Opus 4.8 replaced it): every new section anchor cited by a sibling chapter exists with matching content - 3.8.24 (Registo), 9.7.1 (activation gates), 9.7.2 (persistence postures), 7.2.6 (per-build verification), 10.6.1 (deploy artifacts), 12.9 / FC-500..FC-509, 14.7 (cut lines), 14.8 (owner-actions annex), 4.5 (control plane, P-08 re-resolved). The three admission planes are described identically in chapters 03, 09, 13, and 18. Register arithmetic after this session: 27 P entries, all resolved (P-27 resolved by this amendment; P-08 and P-12 re-resolved); zero pending; gate G-P stamps nothing; Q-01-Q-10 all carry filled Resolution lines; Q-02's factual half closed above. Diagrams: 01/04/05/06 edited, 03/08/10/11 swept for tenancy/retirement, new 12-org-tenancy added, 09-qa-pipeline correctly untouched; every changed and new PNG re-exported at house scale and visually verified.

**Working tree left uncommitted** for founder review of the diff (no commit made this session; the amendment is documents and diagrams only).

---

## Implementation run — initialized 2026-07-06T17:45:00Z (Phase P)

**Run id:** autothing 20260706-182515-9080f2cb. **Input:** `spec/` complete (SPEC.md + chapters 01-18 + reference/ + diagrams/), Amendment 2 applied, register zero-pending. **Mechanics:** chapter 14 §14.2 verbatim — gate template, checkpoint commits `checkpoint: G<N> <phase-name>` + tag `gate-<N>`, this journal (append-only, entries GATE/DECISION/AMBIGUITY/DEVIATION/ABORT, ISO-8601 UTC + phase), abort semantics §14.2.4. Build plan: `docs/autothing/runs/20260706-182515-9080f2cb/FLOW_PLAN.md`; repo `PLAN.md` (traceability table) is the G-P deliverable, in progress.

### DECISION — 2026-07-06T17:45:00Z — Phase P — phase ordering adopted as recommended

Options: (a) adopt chapter 14 §14.4 ordering as written; (b) reorder within §14.3 constraints. Choice: (a) — no constraint pressure found; the recommended order already satisfies all nine §14.3 constraints. Slices map 1:1 to the eighteen phases. Justification recorded in PLAN.md per §14.6 criterion 6.

### DECISION — 2026-07-06T17:45:00Z — Phase P — verification tooling for the run

The chapter 13 §13.7 dual review at every gate is executed as: Claude Code built-in code review (the "Opus review" role) then an adversarial `codex exec` review (cross-vendor; serialized run-wide; "Logged in using ChatGPT" verified 2026-07-06). Both verdicts recorded per GATE entry. CI security gates tooling installed for G0: gitleaks 8.30.1, semgrep 1.168.0 (brew, 2026-07-06). Reason: the spec names the review mechanics but not the executor CLI; conventional practice fills the detail (§14.1 precedence 4).

### AMBIGUITY — 2026-07-06T17:55:00Z — Phase P — progressive (multi-gate) acceptance criteria

**Passages:** ch09 acceptance 17 + ch13 §13.11.15 ("deactivation immediate on all three admission planes") and ch09 acceptance 6 + ch13 §13.11.12 + ch17 §17.11 bullets 1-6 ("payload-capture tokens-only across all origins including bridge/TUI"). **Reading admitted:** these could be read as requiring a single gate where the whole thing is green, or as first-landing at the gate the phase-gate text names with later re-exercise. **Chosen reading (precedence 2, spec phase-gate text is binding):** first-landing at the gate chapter 14's phase-gate text binds the primary assertion to — activation → G2 (write-through test) / G3 (admission test); payload-capture → G7A (C14-07 "G7A asserts the payload-capture tokens-only test"). The later admission planes (served-app G6, bridge G8A/C18-07) and the bridge/TUI payload-capture origin (G8A/C13-13, re-exercise per §18.7.4) are independently covered by their own criteria. Documented in PLAN.md "Progressive (multi-gate) criteria". No census change (each criterion counted once). Surfaced by the G-P adversarial Codex review (below).

### GATE — 2026-07-06T18:00:00Z — Phase P — G-P PASSED

- **Green condition (§14.4 Phase P):** PLAN.md contains the traceability table assigning every enumerated acceptance criterion of ch02-14+17+18 to exactly one phase. Census: 224 enumerated criteria (C02:7 C03:14 C04:20 C05:34 C06:18 C07:32 C08:9 C09:21 C10:11 C12:17 C13:18 C14:8 C17:8 C18:7) == 224 phase-table assignments (mechanically verified). Sizes sum to 100 (§14.5, verified). Every blocking P-nn (9) and Q-nn (2 run-start) verified resolved; register zero-pending; gate G-P stamps nothing.
- **Artifacts:** `PLAN.md`, `RUN_LOG.md` (initialized this phase), `api/tests/SUITE_LEDGER.json` (skeleton: every ported artifact → target gate), `docs/autothing/runs/20260706-182515-9080f2cb/FLOW_PLAN.md`. Foundation: `.claude/skills/ekoa-architecture|testing|governance`, `docs/decisions.md` (CLAUDE.md deferred to G0 as spec deliverable).
- **CI lane (gate item 2):** N/A at G-P — planning phase produces no code; the CI lane is a G0 deliverable. Not falsely asserted green.
- **Review verdicts (gate item 3):**
  - Claude review (code-review role): census verified mechanically (224=224), size sum 100, §14.3 nine constraints each preserved by the recommended order, no FIXED decision contradicted. APPROVE.
  - Adversarial Codex review (`codex exec --sandbox read-only`, serialized; "Logged in using ChatGPT"): 2 findings, both traceability nuances on progressive criteria (activation three-plane assignment at G2; payload-capture all-origins at G7A) — neither a §14.3 or FIXED contradiction; the phase ORDER is correct. Resolved by the "Progressive (multi-gate) criteria" section + the AMBIGUITY entry above (first-landing assignment is the spec's own phase-gate-text reading; later planes/origins covered by C18-07/C13-13/G12). Re-affirmed: no red blocker. APPROVE (post-resolution).
- **Ledger (gate item 4):** SUITE_LEDGER.json skeleton created; ratchet not yet active (no green artifacts). No regression possible.
- **Diagrams (gate item 5):** no structural change (planning phase; diagrams untouched).
- **Checkpoint (gate item 6):** commit `checkpoint: G-P planning` + tag `gate-P`.
