# RUN_SPEC — Integrations, unified (run 20260801-171149-672a8f14)

Profile: **build** (21 slices, ~120 sizing points). Spec-first (Part 10.1). Derived from the
completed discovery gate `docs/INTEGRATIONS_UNIFICATION_AUDIT.md` and the adopted brief
(`docs/decisions.md` 2026-08-01). FLOW_PLAN.md derives its slice table from this spec.

## What / why (one paragraph)

Automations stop being a separate concept. One entity — **Integration** — exposes **Actions**,
each with a backing type (`api-call | bash-cli | browser-steps`; `mcp-call` deferred). A single
public, versioned, user-or-key Cortex capability executes an action and, on a miss, authors-verifies-
persists a new one (self-extension) behind locked guardrails. The unified model formalises seams
that already run in production (`IntegrationAction`, `runAutomationForAction`, the executor
taxonomy) rather than rebuilding engines. Three prerequisite slices close real defects the audit
surfaced (cross-tenant definition visibility, a v1/v2 credential-crypto split, non-org-scoped
provisioner ids). The first proof is a read-only **Caixa Citius notifications sync** whose
goal-verification bar is completeness (every new notification since the watermark captured, none
silently missed), proven end-to-end against a mock WebForms server — metadata only, never opening
documents.

## Acceptance criteria

1. User-created integration definitions are tenant-scoped and **private by default**; no tenant can
   see another tenant's private definition (isolation suite of the memvault class). Closes finding
   `runtime-integration-packages-are-global`.
2. The `credentialsCiphertext` v1/v2 crypto split is ended: one envelope scheme, readers fall back
   to v1, rotation never downgrades; the latent zoho-config-unreadable bug is fixed with a
   regression test.
3. Integration credentials for user-defined configs are Cofre items (WS-C shadow → compare, with a
   journaled review date for cutover); an integration→Cofre-item join exists and an authored action
   cannot name a secret or origin outside the integration's granted scope.
4. `provisionIntegrationAutomations` uses org-scoped ids; two orgs provisioning the same package
   both get their copy, tenant-invisible to each other (regression test). Closes finding
   `integration-provision-id-not-org-scoped`.
5. An Action carries an explicit `backingType`; api-call and bash-cli (one-step local_command) and
   browser-steps (materialised per-org automation) all execute through one dispatch; existing
   integrations keep working (Rule 7 additive).
6. `mutates: true` actions are an execution gate: a write requires human confirmation before first
   run AND before an authored one persists as executable; reads auto-run. Reuses the consent
   pattern (durable org+user+action approvals), not the bridge write-approval store.
7. A public user-or-key capability surface exists: get/execute-action/achieve/lessons + super-admin
   global toggle, all landed per the capability checklist (descriptor + COVERED + mount-coverage +
   OpenAPI/client regen). `achieve` = execute-or-author with the locked guardrails; authored actions
   on a global integration land in the acting tenant's own copy (copy-on-author fork).
8. Sharing: visibility `private|org|global`; only super-admin flips `global`; publishing scrubs the
   definition + lessons (deterministic floor + one chokepoint model pass) into a frozen snapshot
   other orgs read.
9. The integration-builder and automation planner share one authoring core (`integration-agent.ts`);
   the builder dashboard route keeps its wire shape.
10. Caixa Citius read-only sync: typist wired into pre-run session establishment; a login recipe for
    `citius.tribunaisnet.mj.pt`; an inbox connector isolating all live-shape risk in one module;
    per-action sync state; a run-level completeness verification (watermark + seen-set +
    overlapping-window reconciliation) that surfaces an explicit **INCOMPLETE** outcome distinct from
    failure; proven against a mock server including an INCOMPLETE simulation. **Metadata only** —
    structurally (no document-fetch function) and behaviourally (a zero-document-hit security test).
11. Every gate green per build profile: typecheck/lint/build, the security wall, committed
    re-runnable tests, per-slice adversarial review + independent test, codex slice review on
    boundary slices, walkthrough evidence on ui slices, diagrams updated for structural slices, the
    suite ledger consistent.

## Non-goals (this run)

- `mcp-call` backing type and network-capture discovery (deferred; enum stays open for additive).
- Full migration of platform-OAuth / pipedream reserved credential rows into Cofre (they keep their
  own rotation machinery; only the v1/v2 split is fixed for them).
- Opening / fetching Caixa Citius notification **documents** (operator-locked to metadata; a future
  `abrir_documento` action, `mutates:true`, behind the write rail, after a lawyer's decision).
- Backfill + removal of the credential-ciphertext fallback (next run, at the journaled review date).
- Promoting the Citius sync onto the user-or-key capability surface (lands via the core execute
  endpoint; the proof ships behind dashboard-auth `routes/sync.ts` + a flag).
- Any change to `api/src/llm/**` (anonymisation internals held by another session) or the egress
  chokepoint.

## Assumptions ledger (decided autonomously; chosen answer / alternative)

1. **Definition doc shape** — one Mongo doc per integration, `actions[]` inline. *Alt:* a separate
   actions collection. *Why:* actions have no independent lifecycle (saved/scrubbed/forked together);
   "first-class Action" lives at the API-path level, not the storage level.
2. **Baseline packages** — stay on disk as a global read-only tier, never seeded into Mongo. *Alt:*
   seed baseline into Mongo. *Why:* baseline is deploy-versioned with code; seeding creates a second
   source of truth deploys can't refresh.
3. **Legacy runtime packages** — imported at boot as `visibility:'global'`, `origin:'legacy-runtime'`
   (their exact effective visibility today), disk runtime tier then frozen. *Alt:* import as private.
   *Why:* preserves current availability on staging with zero regression; private-by-default applies
   to NEW definitions; closing the legacy leak is a reviewed super-admin action, not a silent break.
4. **WS-C scope** — user-defined configs migrate to Cofre items (Rule-10 shadow, review date
   2026-08-15); platform-oauth/pipedream reserved rows keep their store but move off flat v1. *Alt:*
   full WS-C for all rows this run. *Why:* the guardrail targets the authored/user-defined surface;
   dragging managed OAuth into item/grant semantics is a run of its own; the crypto split ends
   unconditionally regardless.
5. **Auto-grant** — connecting an integration auto-issues one `until_locked` grant scoped to the
   integration-minted item only; lock = revoke. *Alt:* per-run interactive grants. *Why:* listeners
   poll with no user present; typing credentials at connect IS the consent ceremony; journaled so the
   default-deny posture isn't silently weakened, with a test that a manually-minted item never
   auto-grants.
6. **browser-steps execution** — canonical steps inline on the doc, executed via materialised
   per-org automations with org-scoped ids. *Alt:* refactor the engine to run in-memory step arrays.
   *Why:* `runOrRehearse` requires a persisted Automation and the whole run/consent/SSE/self-heal
   plane is welded to it; the provisioner pattern already exists.
7. **Write gate** — the consent pattern (`approved_integration_actions`, org+user+action, 90-day
   TTL, run-scoped "once"), enforced in `executeUserIntegrationAction`, mapped onto the engine's
   `awaiting_consent` pause. *Alt:* the bridge write-approval store. *Why:* write-approval is
   process-local/single-use/pairing-bound (built for the daemon file ceremony); the integration gate
   needs durable approvals, exactly consent.ts's tested shape.
8. **Completeness verification location** — a sync-service wrapper (`events/verified-sync.ts`), not
   an engine hook or a step. *Alt:* engine post-run hook. *Why:* completeness spans two enumeration
   passes + durable cross-run state and must cover the HTTP rail that never enters the engine; a step
   would sit inside the self-heal loop, which must not be able to "fix" the thing that distrusts the
   enumeration.
9. **Inbox transport** — hybrid: typist browser login for establishment, typed HTTP-with-session
   (cookie-jar replay) for enumeration; tolerates GET-addressable and `__doPostBack` paging. *Alt:*
   browser-steps/vision for the whole sync. *Why:* metadata-only is structurally provable in a typed
   module with no document-fetch function; two-pass reconciliation is cheap in HTTP and deterministic
   in tests; no `llm/` involvement.
10. **INCOMPLETE surfacing** — a parallel `SyncRunReport` outcome (`complete|incomplete|failed`) in
    `shared/src/sync.ts`, never a new `RunStatus`. *Alt:* add `incomplete` to RunStatus. *Why:*
    RunStatus is a lifecycle enum consumed everywhere and the HTTP rail has no RunRecord; a run can
    finish `completed` while the report says `incomplete` — precisely the distinction being made
    visible.
11. **Live-shape risk** — the authenticated inbox HTML is unobserved; fixtures are synthetic, marked
    speculative, all shape knowledge confined to `citius-mandatarios.ts` + one recipes.json entry;
    the parser returns honest `indisponível` on unrecognised shape, never a false empty. *Alt:* block
    the run pending a real account. *Why:* the proof is the verification machinery, provable against
    fixtures; the connector ships behind a flag until a first-real-account spike (pinned in the module
    docblock).
12. **Turn cap** — `max(300, 80×21) = 1680` (a runaway brake, not a schedule).
13. **deliberate-red + mutation** — ON (run ≥ 3 slices).

## Coordination

Another session holds `api/src/llm/anonymise/**`, `api/tests/apps/document-source.test.ts`,
`api/tests/integrations/platform-poll.test.ts`, `docs/known-flakes.md` (digest 2026-07-30). This run
touches none of those: it extends the platform-poll *contract* in a new module (`verified-sync.ts`)
rather than editing `platform-poll.ts`, and never enters `llm/`. Slice-level file reservations +
digest checks apply before each slice.
