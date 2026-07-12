# Ekoa Apps Get an Operator — feature run brief (LEDGER, v0.2)

Status: **LEDGER — not final.** Accumulates the scope of the post-hardening feature run(s). Written suggestively: exploration tasks + decision criteria; structural implementation decisions belong to Claude Code's planning session. Sections marked OPEN are pending.

**Change log v0.1 → v0.2:** all security-related work resequenced into a contiguous block at the END of the run (Phases 9–10). Rationale below. Phase 2 STOP gate converted to decide-and-document for fully unattended operation.

**Precondition:** the Cortex foolproof run (batch-2 harness + batch-3 tail) is DONE. Every phase lands against the permanent journey suite; the build journey (J3) probe is the safety net for anything touching the build pipeline.

Repo: `ekoa-code`. Fully unattended multi-day run via autothing. Standard mechanics assumed: RUN_LOG UTC discipline, ownership lock + heartbeats, preflight doctor, per-slice checkpoint commit + tag, landing packet, meter-aware graceful landing, merge to main only after operator diff review.

---

## MODEL-TIER SEQUENCING RULE (read first)

The run executes on Fable until security-related content triggers a persistent switch to Opus. To preserve Fable quality for the bulk of the run:

- **ALL security-related work is batched at the end** (Phases 9–10): roles/permissions, identity/session handoff, edit-mode gating, request-changes queue, isolation assertions, and the Codex adversarial review.
- **Phases 1–8 must not touch security topics.** No auth code, no permission logic, no session handling, no security design discussion in planning or RUN_LOG for those phases. Where early code needs a permission decision, it calls a single `can(capability)` chokepoint seam whose real implementation lands in Phase 9. The seam is a plain function stub on the run branch — acceptable only because nothing merges to main before the full run lands and the operator reviews.
- Side benefit, intentional: the Opus segment aligns exactly with the code where the most conservative model is desirable anyway, and Codex review covers one contiguous security block in a single pass.

---

## The product being built (context for the planning session)

Every Ekoa-built **app** ships with a dedicated assistant — not the general Ekoa chat, but an operator bound to that specific app. It serves three purposes, and says so on first open:

1. **Automate the app** — "add this client and set their fee tier" → the assistant drives the UI itself: navigates, fills fields, flips toggles, visibly, through JavaScript (not browser automation).
2. **Teach the app** — "show me a tutorial" / "how do I do X?" → guided tours with highlights and narration; the user can take over at any moment.
3. **Answer the domain** — the assistant knows the subject matter the app serves (e.g., how this firm calculates fees), grounded in indexed client documents, citing sources.

A fourth capability, gated to admins (built in the security block): **change the app** — edit requests become scoped patch-profile runs in Cortex with preview/approve/rollback. Users get a **request changes** path instead.

Roles context (implemented in Phase 9, designed here for reference): the builder persona is dead. **Super-admin** (platform), **org-admin** (build + edit apps), **user** (chat, non-app artifacts, full artifacts area; cannot build or change apps).

Commercially: every end user becomes a token consumer; tours are free (canned), LLM turns are metered. Non-app artifacts do NOT get the operator; a lightweight explainer variant is OPEN, out of v1.

---

## Phase 1 — Exploration (read-only; deliverable: one markdown analysis per track)

Prior attempts exist. Do not design on assumptions — dig first:

1. **Automations layer:** what can the automations area invoke today? Does an "ekoa action" primitive exist? Can automations drive apps already? Decision criteria: extend the existing primitive into the action registry vs build the registry and migrate automations onto it. Prior lean: registry as foundation, automations migrate — confirm or kill.
2. **Demos/tutorials:** what survives from earlier demo/tutorial attempts — step schemas, highlight/spotlight mechanics, anything reusable as the tour format?
3. **Knowledge area hooks:** can indexing be triggered mid-build-run, or does it need a new hook? What's the org-scoped retrieval path an assistant would use?
4. **Internal templates archaeology:** where does the build pipeline get its scaffold post-hardening; where is artifact structure encoded in agent instructions; measure the structural-instruction token tax per build (the baseline Phase 3 must beat); did the smarter-builder internal-bases decision enter the ekoa-code spec, and where was it dropped?

(Identity/session exploration deliberately EXCLUDED here — it is security content and lives in Phase 9.)

## Phase 2 — Decision memos (decide-and-document; no mid-run stop)

One memo per track, each with recommendation + evidence, committed to the run docs and flagged in the landing packet for operator review. Decision criteria are pre-loaded above; the planning agent decides and documents rather than halting. Key decisions to land:

- Registry: extend vs rebuild; automations migration path.
- Tour format: reuse vs new declarative schema.
- Base template set: lightest viable (prior: `app` + `document` for v1; `presentation`/`landing` only if the token-tax measurement justifies).

## Phase 3 — Internal templates: structure as content

Bases carry invariants; instructions carry judgment. A base is a directory of files, agent-selected, dropped in a conventional location — same philosophy as skills/recipes, no new machinery.

- Base registry (directory convention + loader); agent base-selection in the scoping/build flow.
- The **app base** is the strategic one: it is where the action-registry runtime, assistant panel mount, protocol client, design-token link, and error boundaries live. Building it here is what makes Phases 4–5 ship *inside every future app for free*.
- Migration: move structural boilerplate out of instructions into bases; delete migrated instruction content (measured shrink vs the Phase 1 baseline, not asserted).
- **Manifest check:** every base ships a manifest; per-build verification asserts manifest files were replaced/extended by generation. Permanently closes the F16/F28 failure class.
- Structure is **copied** (no inheritance propagation — prior decision stands); design tokens stay **served by reference** (already per-org).
- **Gate:** J3 probe passes with a base-built app; verifier fails a deliberately untouched-base build; instruction-token reduction recorded in the landing packet.

## Phase 4 — Classifier + action registry (operate manifest)

- **Classifier:** the scoping skill gains an artifact-type gate — app vs presentation/report/document. Only apps get the operator. (The same classifier output will feed the Phase 9 permission gate; do not wire permissions here.)
- **Action registry:** a typed manifest of commands emitted at build time — `navigate(route)`, `setField(id, value)`, `toggle(id)`, `select(id, option)`, `highlight(selector)`, `startTour(tourId)`, plus app-specific actions the generator registers per component. Actions dispatch through the app's own state layer — the same events a human interaction produces — so validation and business logic always apply and the assistant can never reach states a user couldn't.
- Thin client-side runtime (ships in the app base) executes calls; Cortex-side assistant receives the manifest as tool definitions.
- Destructive actions (submit/delete/send) carry a manifest flag and a client-side confirmation step (UX concern; the authorisation dimension is asserted in Phase 10). Every action logs to the global audit view.
- **Test-harness dual use:** expose the registry to the tester agent so journey probes for built apps can drive the real action layer. One investment, two uses.
- **Gate:** a generated sample app's registry round-trips — Cortex issues actions, UI visibly executes, audit rows land; a destructive action prompts confirmation.

## Phase 5 — The assistant panel (operate / teach / answer)

- Side-panel UI inside every generated app (mounts from the app base). Non-blocking by construction: actions flow through normal state dispatch; visible cursor/glow while the assistant drives; **any user input immediately pauses it** — never fight the user for a field.
- First-open message states the three capabilities with example prompts ("Mostre-me um tutorial", "Dê-me uma visão geral da aplicação", app-specific examples generated at build time). PT-PT copy rules apply to all lawyer-facing strings.
- Three request modes: **do it for me** (assistant executes), **show me** (assistant drives with highlights + narration), **teach me** (user drives, assistant coaches). Mode inferred from phrasing, switchable.
- Domain answers cite their source (knowledge area entries) — every answer explained, consistent with the trust layer.
- **Gate:** scripted conversation against a sample app exercises all three modes; pause-on-user-input asserted; a domain question returns a cited answer from indexed content.

## Phase 6 — Tours (zero-token teach path)

- Declarative tour scripts (route, selector via registry, text per step) **generated at build time** for each app: at minimum "overview" and one per main journey.
- Playback is client-side, zero tokens. The LLM engages only for ad-hoc questions and freeform automation.
- Reuse whatever Phase 1 track 2 salvaged from the earlier tutorial work.
- **Gate:** overview tour plays end-to-end on a generated app with highlights matching real elements after a rebuild (selector stability via registry IDs, not DOM paths).

## Phase 7 — Knowledge-during-build

- When the scoping agent detects a domain-heavy app, it asks where the knowledge should come from, requests document uploads, indexes them into the org's knowledge area, and **narrates that it is doing so** during the build.
- The app's assistant retrieves from that org-scoped knowledge; answers cite entries. Client sign-off on the indexed set becomes part of the Studio delivery ritual (process note, not code).
- **Gate:** build a sample fees app with seeded docs; assistant answers a fees question with a citation into the seeded content. (Cross-org isolation assertion deferred to Phase 10 — security content.)

## Phase 8 — Metering + polish

- Every assistant LLM turn metered and attributed (extends the existing billing ledger; billing-truth probe extended to assistant turns). Tour playback and registry-only actions: free.
- Panel performance budget: the assistant must not degrade app responsiveness (lazy-load the panel, no blocking work on the app main thread) — assert with a simple perf check in the app base.
- **Gate:** billing arithmetic probe green including assistant usage; sample app perf delta within budget with panel mounted.

---

## SECURITY BLOCK — Phases 9–10 (expect the Fable→Opus switch here; do not start earlier)

## Phase 9 — Roles, identity, edit mode, request changes

**9a. Roles refactor: builders → users.**
- Capability layer, not scattered role-string checks: `canBuildApps`, `canEditApps`, `canCreateArtifacts`, `canUseChat`, … mapped from role; every gate checks a capability. This is where the `can()` seam from Phases 1–8 gets its real implementation. A future middle tier is a mapping change, not a refactor.
- Firestore migration mapping existing builder records → user (OPEN: any current builders who become admins?).
- Classifier-as-permission-gate wiring: a user's chat request to build an app is refused and converts into a pre-drafted build request routed to the org-admin — never a dead end.
- Sweep: spec chapters, docs, UI labels. Mark superseded spec sections per mark-never-delete; spec-status annex records the role-model change. PT-PT terms: `Administrador` / `Utilizador`.

**9b. Identity/session (exploration + decide-and-document + implement).**
- Explore: how apps are served relative to Cortex (shared parent domain? arbitrary?), existing session mechanism, viable handoffs (shared cookie / postMessage check / signed token on open-from-Ekoa / magic-link fallback).
- Decide per topology and document; **detect-then-ask stands regardless** — never silently grant edit powers on a shared machine. Reuse Cortex identity; no per-app login systems.

**9c. Edit mode (admins only).**
- **Not a second brain.** Edit requests become **scoped patch-profile runs in Cortex** — same gate discipline, git hygiene, tester sign-off as any patch. The assistant is a front-end to the existing build capability.
- Flow: admin asks → assistant confirms intent → patch run produces preview/diff → admin approves → deploys → one-click rollback. Explicit visible mode switch in the panel after detection + opt-in.
- **Admin discovery:** for detected admins, the assistant proactively teaches that the app is changeable, with concrete suggestions ("podia adicionar aqui um botão de exportação"). First-class onboarding — the conversion moment from app user to token-spending builder.

**9d. Request changes (users).**
- Button in the assistant panel; captures current route + screen state from the registry so requests arrive contextualised ("user was on the fees form, asked for an export button").
- Requests land in an org-admin queue; the refused-app-build path from 9a feeds the same queue. Each request is one click from becoming a patch run — the queue is quietly a token-revenue pipeline.

## Phase 10 — Security assertions + adversarial review

- Capability matrix test: role × capability grid asserted; grep proves no orphan `builder` references outside migrations/history; no remaining permissive `can()` stubs anywhere.
- End-to-end edit journey: admin detected → explicit opt-in → edit request → patch run → diff → approve → live → rollback restores. A user-role session asserted unable to reach any edit tool.
- Destructive-action authorisation asserted server-side (client confirmation from Phase 4 is UX, not the boundary).
- Cross-org knowledge isolation probe extended to assistant retrieval.
- Request-changes journey: user files from inside an app → admin sees it with context → converting pre-fills an edit-mode intent.
- **Codex adversarial review over the whole security block in one pass** — roles, identity handoff, edit gating, queue.
- Journey suite fully green.

---

## Ordering & meter strategy

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → **9 → 10 (security, last)**. If the meter runs short: 1–4 is the spine that must land; 5–8 next; 9–10 must land **together or not at all** — never leave the security block half-implemented (a partial permission layer is worse than the stubbed seam). Tags per slice throughout; a partial landing still leaves a coherent, permission-stubbed platform on the branch, unmerged.

## Non-goals (do NOT pull forward)

- Cortex Gateway module (parked, `cortex-gateway-brief.md`).
- Explainer variant for non-app artifacts (noted, out of v1).
- User-facing template resurrection — artifact-only primitive with fork-on-open stands.
- Scheduling/recurring automation surfaces in any lawyer-facing copy.
- Real browser automation (Playwright) for the assistant — registry-first; a hard blocker is a memo for the operator, not a unilateral pivot.
- Per-app login systems — identity is Cortex identity, full stop.
- Any security design, code, or discussion before Phase 9.

## Open items (the ledger)

- OPEN: one build run vs sequenced feature runs (if split, the security block is its own final run).
- OPEN: current builder records — who becomes admin in the migration?
- OPEN: static request-changes affordance outside the panel.
- OPEN: assistant model/effort tier per mode (domain Q&A vs action planning) — cost/quality trade for metered turns.
- OPEN: pricing shape for metered assistant usage (per-turn pass-through vs bundled) — commercial decision, not run scope.
- OPEN: explainer variant for documents/reports — later.
