# Amendment 2 - Diff summary for founder review

Documents-and-diagrams-only patch applied 2026-07-06. Working tree is **uncommitted** so you can read the diff before it lands. Source of every decision: `docs/ekoa-code-spec-amendment-2-consolidated-ledger.md` (your brief, saved verbatim). Session journal + the three exploration facts: `RUN_LOG.md`.

**Scale:** 35 files changed, +1038 / -478. All 18 spec chapters + SPEC.md touched; 8 diagrams edited + 1 new; RUN_LOG + this summary + the brief are new.

---

## What changed, by your eight parts

### Part 1 - Credentials, providers, Supabase retirement
- **FIXED-8 amended:** the "managed OAuth only" clause becomes centrally-managed credentials (encrypted, never per-user, never `~/.claude`) with **two auth modes as per-environment config** - subscription OAuth and Anthropic API key. Inline amended note in SPEC.md; restated consistently in ch02, ch05 §5.4.1, ch06 §6.2, ch09 invariant 4.
- **Credential machinery simplified:** the multi-subscription rollover model is gone (no pools, rotation mutex, persist-first, peer adoption, keep-row-on-401, 20-minute recovery watchdog, per-installation rows). What remains: one credential per environment, proactive refresh, refresh-and-retry-once on 401, alert on persistent failure. `llm/oauth.ts` -> `llm/credentials.ts`.
- **P-08 re-resolved: Supabase retired entirely.** The three live tables fold into Firestore - a new `credentials` singleton (encrypted via the one crypto module), `companies` superseded by the org model, `installations`/license folded into activation. ch04 §4.5 rewritten (original Resolved line kept, Re-resolved appended); ch09 §9.7 boot gates re-pointed; ch10 gains credential-migration + retirement rows; ch11 glossary row.
- **License server:** exploration confirmed **none exists** - license logic was a boot gate inside old Cortex against Supabase. It retires with the old stack; nothing folds into `api/` beyond the activation model. Tiers and the tier feature map are dropped as a concept.

### Part 2 - Persistence & privacy posture
- **Three-posture policy** now normative (ch09 §9.7.2, ch17): egress tokenizes everything model-bound (explicitly including resolver-re-injected memories); at-rest knowledge is cleartext protected by org+user scoping, encrypted, in the custody map, erasable; logs and run records omit or **irreversibly redact** (no message bodies, no delegation file paths, no tokens).
- **P-27 resolved** (no longer pending): detector-at-persist with **irreversible redaction** of detected spans - never session tokens (the vault is ephemeral; tokens at rest would be permanent noise). ch17 §17.10 flipped `PROPOSED` -> `RESOLVED`; register arithmetic now reads 27 resolved / zero pending / zero live PROPOSED markers.
- **P-12 re-resolved: auto-extract returns, ON by default,** correctly attributed. Async post-run (never adds turn latency), Haiku-class, batched per run, tagged `user_work` (`memory-extract`), hosted runs only, delegated work mined only from derived output (I2 preserved), always writes `private`, per-user toggle default ON, every write gets a Registo entry + UI affordance. ch06 call 23 re-fated; the zero-platform-calls posture stands untouched.

### Part 3 - Activation model (replaces licensing)
- Two independent facts gate access: `users.active` (admin-controlled) + the billing allowance. **No tiers.** Three admission planes (`/api/v1` JWT middleware, served-app plane keyed on the artifact owner, bridge pairing) consult a cached activation state - in-memory map with **write-through invalidation** (deactivation is effective immediately, TTL is a safety net only). Deactivation also pushes the user's tokens into the P-03 revocation set in the same write.
- Two new CONV-2 codes: `ACCOUNT_DISABLED` (403, "A sua conta está bloqueada. Contacte o suporte.") and `BILLING_LOCKED` (402, "A sua conta tem um problema de faturação. Contacte o suporte."). ch09 §9.7.1; ch03 §3.3. Payment-provider webhook noted as future, nothing built.

### Part 4 - The org model (tenant, finally defined)
- **`orgs` collection**; every user carries required `orgId` + `active`; a standalone user auto-creates an org as its admin. Schema/API name **`org`**, PT-PT display label **"Escritório"**. `tenant` swept to `org` spec-wide including ch17 deny-lists and ch18 delegation bindings (`{org, user, session, pairing, ...}`).
- **Org-scoped:** branding + research, org settings, the knowledge base (vault + index org-partitioned), integration credentials (incl. the M365 workspace token), deny-lists, org-shared memories/artifacts, automations/triggers/runs (denormalized `orgId`), the Registo read surface. **User-scoped** (unchanged): sessions, messages, private memories/artifacts, sandboxes, pairings, per-user metering. The collections engine gains **no** org dimension - `design-tokens.css` resolves the org server-side from the app slug, so the 37 legal e2e specs don't move.
- **Roles:** super-admin / org-admin / builder; JWT claims `{sub, role, scope, orgId, username}`. `/api/v1/company` -> `/api/v1/org` (+ super-admin `/api/v1/orgs`).
- **Sharing (ownership x visibility):** `visibility: private | org` on memories and artifacts. Private = owner-only, invisible even to org admins (existence in Registo metadata, never content). Org-shared artifacts are visible AND editable by org members (safe: git snapshots + restore + Registo). The adversarial cross-tenant suite becomes the **cross-org suite**, plus two in-org tests (private-memory read -> 404, private-artifact edit -> 403).
- **Default design system** ships in-product (neutral palette, system fonts, no logo, header falls back to org name; never the vendor brand). Migration: one org per user, all on the default, no brand carry, company singleton archived, founder seeded super-admin.
- **Teams deleted end to end** - endpoints, pages, stores, tests, collection, migration rows; glossary row added.

### Part 5 - Registo read surface + new UI
- `GET /api/v1/registo` (ch03 §3.8.24): org-admin sees own org, super-admin across orgs; filters user/action-type/date; **metadata + artifacts, never chat bodies**. ch12 §12.9 (FC-500..FC-509) scopes all the net-new UI: Registo admin page, users-page org controls + activate/deactivate + role toggle, sharing toggles, the verification banner + settings toggle, the first-build ask-once dialog. All PT-PT.

### Part 6 - Per-build verification
- Default ON (`build.verifyBuilds`): playwright-cli, medium depth, **incremental** (full acceptance on first build, scoped + smoke on follow-ups). Fix-forward within the slice retry budget; a failure completes the build with the honest visible note. Tokens `user_work` (`build-verify`). Asked **once** on the first-ever build; banner while testing; live streaming parked. ch07 §7.2.6 (with the re-bundle + post-verification snapshot detail), ch05 §5.6.2, ch14 Phase 7B gate.

### Part 7 - Data backend, references, deployment
- **Q-02 factual half CLOSED - and the answer flips the default.** Verified in ekoa-deploy: the committed pipeline runs the **filesystem** app-data backend (the env var is unset, defaulting to `fs`; the `/opt/ekoa/cortex-data` volume corroborates it). The old "prod = Firestore" claim was a hand-set `.env` the pipeline doesn't reproduce. So ch10 §10.2 row 1 now **defaults to a real app-data import** (fs -> engine), with the connection-string repoint kept as the cheaper branch if a live-container re-check proves it hand-set to mongo. Re-confirmation stays on the cutover checklist.
- **Single backend:** the `getAppDataBackend()` switch and filesystem backend are not carried; Firestore Mongo-compat only. `mongodb-memory-server` stays for dev/tests (stated explicitly so it isn't over-deleted).
- **Reference-access rule** (ch14 §14.1): the exhaustive (a)-(e) list of what the run may read from `ekoa-dev`/`ekoa-deploy`.
- **Deployment folds in:** ch14 Phase 13 + ch10 §10.6.1 add Dockerfiles (`api/`, `web/`), deploy scripts, and a CI deploy lane (P-02 two-container + P-26 upstream swap). Verified reality: no in-repo proxy - TLS/routing is an external edge (Cloudflare, now added to the vendor register). Secrets go to Secret Manager (FIXED-14); ekoa-deploy is reference-only, obsolete lanes (site/stt/tts) ignored; old pipeline retires post-cutover.

### Part 8 - Ripples, diagrams, acceptance
- **Diagrams:** 01/05/06 updated for Supabase retirement + credentials + org tenancy; 04 gains the post-build-verify step; **new 12-org-tenancy** added; 03/08/10/11 swept for tenant->org + P-08; 09-qa-pipeline correctly untouched. All PNGs re-exported and visually verified.
- **Chapter 14:** org/activation work placed with the cross-org gate; final security phase gains the in-org sharing tests; §14.7 cut lines + §14.8 owner-actions annex added.
- **Cut lines** (if the run stalls): org-admin user management -> super-admin-only; sharing toggles hidden (enforcement stays); Registo filters shrink. Never cut: `orgId`, org scoping of branding/knowledge/integrations/deny-lists, cross-org isolation tests, activation gates.
- **Owner-actions annex** (recorded, not built): e-Evidence PT contact-point before 18 Aug 2026; Anthropic EU-region/zero-retention verification; payment webhook; Brasil Salomão manual re-setup; usage credits before launch.
- **Acceptance greps:** all pass (see RUN_LOG gate line).

---

## Things I want you to look at
1. **Q-02 flipped to `fs`** - the biggest factual change. It converts cutover from "app-data stays in place" to "app-data is imported during the freeze" as the default path. Worth a look at ch10 §10.2 row 1 and criterion 6.
2. **Auto-create-org on standalone user** (Part 4.8) - confirm the semantics read right in ch03 §3.8.2 / ch04 §4.3.1.
3. **automations/triggers/runs got a denormalized `orgId`** (my call, approved during the session) so the org-admin/Registo query surface reads directly instead of joining through users. ch04 §4.3.1/§4.3.2.
4. **`/api/v1/company-space` kept its path** (not renamed to org-space) - renaming a live wire path with client callers is beyond the amendment's mandate. If you want it renamed, that's a separate call.
5. **No commit made** - the tree is staged for your review. Say the word and I'll commit (on a branch, per your convention).
