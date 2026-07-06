# Cortex Rebuild - Specification

This is the entry point of the specification for the ground-up rebuild of Cortex (the Ekoa backend) as a conventional Node.js + TypeScript REST service, and for the migration of the existing frontend against it. It is written to be the **sole input** to one unsupervised autonomous implementation run: no decision is left open - everything is either FIXED (final, non-negotiable) or sits in the PROPOSED / Open-questions registers awaiting founder resolution before launch.

**Status: AMENDED 2026-07-06 - founder resolutions applied.** The founder review of 2026-07-06 resolved all 26 original PROPOSED items and all run-start-blocking Open questions, and extended the build scope with the anonymisation layer (chapter 17) and the Cortex side of local file access (chapter 18), per the amendment brief (`docs/ekoa-code-spec-amendment-brief.md`). Launch gate restated: zero unresolved run-start-blocking items in chapters 15 and 16 (satisfied); deferrable items resolve to their recorded defaults at gate G-P (currently only P-27, minted by the amendment); the two cutover-class questions (Q-02, Q-03) resolve on the chapter 10 checklist, not before run start.

## Why we are rebuilding (summary)

1. The old architecture's organizing thesis - business logic authored as content and interpreted at runtime (chapter 11) - failed on its own terms: the system pays model cost and latency to constrain a model into doing state-machine work, and nondeterministic error-masking is anti-audit for the legal vertical.
2. Billing attribution is impossible today: platform-overhead tokens and user-work tokens flow through the same stream.
3. Comprehension is governance: the founder works exclusively through agent teams; architecture, specs, and tests are the only control surfaces, and the current architecture does not fit in one head.
4. Accumulated drift: docs, tests, and code disagree. Everywhere in this spec: **code is truth, docs are hints** - the `spec/reference/` documents were extracted from code and record every contradiction found.

## How to read

- **Founder, first pass:** chapter 01 (one page), diagrams 01-11 in order (they are a standalone visual explanation), then chapters 15 and 16 (your review surface).
- **Founder, full pass:** chapters in order. Each is self-contained with citations.
- **Implementation run:** the whole of `spec/` plus `spec/reference/`. Never re-explore old Cortex source; the reference docs are the extraction of record. One sanctioned exception: the surviving test estate enumerated by `reference/test-audit.md` is copied from the old repositories as reference material (FIXED-1; chapter 14 section 14.1). Design provenance for the 2026-07-06 amendment (chapters 17 and 18): the Ekoa Local v2 consolidated brief and the security addendum in `docs/` - their load-bearing content is folded into the chapters; the docs remain citations, not required reading for the run.

## Table of contents

| Chapter | File | One line |
|---|---|---|
| 01 | [01-system-overview.md](01-system-overview.md) | The system in one page |
| 02 | [02-module-map.md](02-module-map.md) | Repo layout, modules, import boundaries |
| 03 | [03-api-design.md](03-api-design.md) | Resources, verbs, auth, errors, the four SSE streams |
| 04 | [04-data-model.md](04-data-model.md) | Firestore layout, tenancy, the collections engine |
| 05 | [05-agent-execution.md](05-agent-execution.md) | Job lifecycle, Agent SDK, streaming |
| 06 | [06-llm-chokepoint-billing.md](06-llm-chokepoint-billing.md) | The chokepoint, attribution, metering, the bill |
| 07 | [07-app-pipeline.md](07-app-pipeline.md) | Generation, esbuild, static serving, previews |
| 08 | [08-content-and-garrison.md](08-content-and-garrison.md) | Agent-context content; the Garrison boundary |
| 09 | [09-security-invariants.md](09-security-invariants.md) | Every carried invariant and where it is enforced |
| 10 | [10-coexistence-cutover.md](10-coexistence-cutover.md) | Old serves while new is built; migration; cutover gate |
| 11 | [11-glossary.md](11-glossary.md) | Old vocabulary -> new (appears nowhere else) |
| 12 | [12-web-client-migration.md](12-web-client-migration.md) | ekoa/ -> web/: typed client, replacement map, every FC item fated |
| 13 | [13-test-review-strategy.md](13-test-review-strategy.md) | Baseline e2e port, vision discovery, deterministic regression, dual-model review |
| 14 | [14-build-sequence.md](14-build-sequence.md) | Phased one-shot run: gates, checkpoint commits, RUN_LOG, abort semantics |
| 15 | [15-open-proposals.md](15-open-proposals.md) | Every PROPOSED decision - founder review surface |
| 16 | [16-open-questions.md](16-open-questions.md) | Genuine unknowns - all resolved before launch |
| 17 | [17-anonymisation.md](17-anonymisation.md) | The anonymisation layer: pipeline, detectors, vault, audit, claims ceiling |
| 18 | [18-local-bridge.md](18-local-bridge.md) | Local file access, Cortex side: delegation, bridge, provider endpoint, S1-S6 |

Diagrams: [spec/diagrams/](diagrams/) - `01-system-context` through `11-delegation-security`, each as `.excalidraw` source + `.png` export. **The spec text is authoritative: when spec and diagram disagree, the diagram is redrawn, never the reverse.**

Reference (ground truth extracted from code at commit 3882aa6): [spec/reference/](reference/) - operations-inventory, invisible-behaviors, data-inventory, llm-usage-map, carryover-audit, test-audit, frontend-cleanup-audit.

## The FIXED decision register

These were made deliberately by the founder. They are final. Chapters cite them as FIXED-n; the implementation run aborts rather than violating one (chapter 14).

The entries below preserve the founder's original vocabulary. Where that vocabulary uses the old architecture's terms (a generic dispatch endpoint, recipes, instructions, skill files), those terms are defined in chapter 11 and - per CONV-6 below - appear nowhere else in this spec outside this register and that glossary.

- **FIXED-1 - New repository, greenfield.** One conventional Node.js + TypeScript REST service. No monorepo tooling, no core/runtime split. The repo hosts `api/` and `web/` as sibling apps plus `shared/` containing only the API contract (zod schemas as the single source of runtime validation and static types). Boundaries: web imports shared only, never api; api never imports web - lint-enforced and stated in the repo CLAUDE.md. Old Cortex and the current frontend are reference material only. ekoa-local remains its own project; Cortex commanding local tools through it is unchanged and out of scope. *(P-16 resolved 2026-07-06: the repository is named `ekoa-code`, created as a sibling folder of `ekoa-dev`. Amendment note: the Cortex-side contract for commanding local tools - delegation, bridge channel, provider endpoint - is now specified in chapter 18; the daemon itself remains out of scope.)*
- **FIXED-2 - Protocol.** Resource-oriented REST, request-response by default. SSE only where a genuine stream exists (agent job progress/events). No WebSockets between frontend and Cortex as API transport; one scoped exception exists for the live browser canvas media channel (frames down, input events up, short-TTL token, never JSON API payloads). No generic dispatch endpoint, no event-bus-as-protocol. *(Amended 2026-07-06: the media-channel exception is the founder's Q-01 resolution; chapter 03 section 3.7 scopes it. The daemon bridge WebSocket of chapter 18 is daemon-to-Cortex transport, not frontend-to-Cortex, and sits outside this rule by construction.)*
- **FIXED-3 - Model at the edges only.** Exactly one LLM chokepoint module; every Anthropic call goes through it, tagged at the call site: `user_work | platform | classifier`. Attribution recorded and metered from day one. No LLM calls in runtime platform paths. The intent/tier classifier stays, on the cheapest suitable tier. User work executes through the Claude Agent SDK - the product and the billable surface.
- **FIXED-4 - LLM authors at design time; code executes at runtime.** No runtime interpretation of markdown instructions by a model. Existing recipes/instructions are source material to translate into typed code.
- **FIXED-5 - Collections engine over Firestore for user-app data.** Apps declare collections in a manifest (schema, validation, access rules, tenant scoping); one generic deterministic data API executes all of them. No per-app server code generation, no per-app processes.
- **FIXED-6 - Content is agent-facing only.** Skills/instruction files exist solely to assemble agent contexts. Consumption: per-user composition directories + a shared content-addressed cache (APM distribution). A context loader, not a framework.
- **FIXED-7 - Garrison boundary.** Fittings that are agent content are consumed as content. Anything the platform must do deterministically is reimplemented in TypeScript inside the new Cortex with the fitting as reference spec. Never import Garrison code. Never call Garrison as a service.
- **FIXED-8 - Invariants carried unchanged.** No Anthropic SDK outside the chokepoint; anonymisation layer built in this run as part of the egress module (chapter 17) *(amended 2026-07-06; the original entry read "anonymisation chokepoint on egress (Presidio integration point) preserved" - the founder promoted the seam to build scope)*; activity/audit logging through a single write path (Registo-ready); managed OAuth credentials only - no raw API keys, no `~/.claude` fallback; tenant scoping on every data access; single multi-tenant process.
- **FIXED-9 - The UI is the functional contract, not the wire contract.** Every operation the current frontend performs must be supported by the new API; endpoint shapes should change. The frontend is migrated into `web/`, not rebuilt: typed REST client replaces the protocol layer, dead code is cleaned, no visual redesign.
- **FIXED-10 - Client-agnostic API.** A second client (e.g. a future OS shell) could consume it later; no frontend-specific coupling.
- **FIXED-11 - Out of scope.** Downloadable app runtime, OS/ambient layer, feature-flag infrastructure, WebSockets, non-Anthropic providers, local models. *(Interpretation recorded 2026-07-06 with Q-08: the non-Anthropic-provider exclusion targets LLM providers, not STT; whisperx-self-hosted remains the segredo-profissional posture for transcription when provisioned. The WebSockets exclusion is qualified by FIXED-2 as amended and does not cover the daemon bridge channel of chapter 18.)*
- **FIXED-12 - Diagrams are first-class, permanently.** Any change that alters structure, flow, or data shape updates the affected diagrams in the same unit of work; a structural change without its diagram update is incomplete. This invariant lands in the new repo CLAUDE.md from day one.
- **FIXED-13 - One egress module, three concerns.** *(Added 2026-07-06.)* The LLM chokepoint (`api/src/llm/`) is simultaneously: attribution + metering (chapter 06), the anonymisation pipeline (chapter 17), and provider routing config (provider base URL, region, zero-retention posture as configuration, never hardcoded). Nothing else may import or instantiate the Anthropic client - lint/dependency-enforced; subprocess paths (Agent SDK spawns) are pointed at the chokepoint via base URL/env so their traffic funnels through it.
- **FIXED-14 - Security baseline.** *(Added 2026-07-06 from the security addendum, `docs/security-addendum.md`.)* Authorization is code, never the model; deny-by-default authorization middleware with object-level checks on every resource fetch; tenant scoping structural via a repository layer that cannot express an unscoped query; agent runs execute in the user's security context with per-context tool allowlists; all model output and user content treated as untrusted input; served apps sandboxed (static client bundles, strict CSP, no server-side eval); prompt-injection posture (consequential agent actions confirmed or policy-allowlisted, always audited); no secrets or tenant data in system prompts; per-tenant and per-user rate limits and spend caps at the chokepoint; EU region pinning; secrets in a managed secret store only; per-tenant erasure workflow including derived data; tested backup restore; security headers, CSRF and CORS baseline; dependency policy including verification of every agent-added package; least-privilege service accounts with separated dev/prod projects; Registo as the compliance evidence engine. Chapter 09 states where each item is enforced and by which mechanism; certification-phase items are recorded there as explicitly deferred.

## The CONV register - spec-level conventions

Beyond the founder's FIXED decisions, this spec fixes a small set of cross-chapter design conventions. Chapters cite them as CONV-n. They bind the implementation run exactly like the FIXED decisions; the difference is provenance - the FIXED list is the founder's, while these were set while authoring this spec (each derives from a FIXED decision or from the reference docs), and founder approval of this document ratifies them. Each convention is specified in full by its owning chapter; the entries here are the citation anchors, not the full text.

- **CONV-1 - Auth model.** `Authorization: Bearer <JWT>` on every `/api/v1` endpoint, with a closed exemption list (login, device login start/poll, health, public demo/asset routes, the served-app data plane, webhook ingress). The four SSE streams authenticate via `?token=` because EventSource cannot set request headers. Owner: chapter 03 section 3.2; JWT-in-URL bounds in chapter 09 section 9.5.
- **CONV-2 - Error envelope.** Every non-2xx response carries `{ error: { code, message, details? } }` with a correct HTTP status; `code` is stable UPPER_SNAKE, `message` is user-safe and PT-aware. Owner: chapter 03 section 3.3.
- **CONV-3 - Async job pattern.** `POST` creates the run and returns its id; `GET /:id` reads state; `GET /:id/events` streams typed progress over SSE; `POST /:id/cancel` aborts server-side. Closing the stream never stops the run. Owner: chapter 03 section 3.5; lifecycle detail in chapter 05 section 5.2.
- **CONV-4 - Exactly four SSE streams.** Chat run, build/brand-research job, automation run, and the per-user notifications channel; everything else is request-response or client-side polling. Applies FIXED-2. Owner: chapter 03 section 3.6.
- **CONV-5 - Abort propagates as abort.** A user Stop surfaces as a typed abort error and never falls through to a deterministic fallback, a heuristic action, or an empty-string result. Owners: chapter 05 section 5.3.2; chapter 06 section 6.2.1.
- **CONV-6 - Vocabulary.** The spec, and the new repo's documentation after it, use plain conventional vocabulary. The old architecture's terms appear only in chapter 11's glossary and, verbatim, in the FIXED register above. Owner: chapter 11.

## Acceptance criteria for this spec

1. The founder can read SPEC.md (and chapters) end-to-end and explain the system afterward without help.
2. Every operation in `reference/operations-inventory.md` maps to an element of chapter 03 (or its explicit dropped-list).
3. Every behavior in `reference/invisible-behaviors.md` is either specced or explicitly dropped with a stated reason.
4. Every platform-classified LLM call in `reference/llm-usage-map.md` has an explicit fate (chapter 06).
5. FIXED vs PROPOSED is unambiguous on every decision, and every FIXED marker traces to a FIXED-n or CONV-n entry in this file (or to the owning chapter section that specifies it).
6. Diagrams 01-11 are each consistent with the spec text and, read in order, work as a standalone explanation.
7. Every item in `reference/frontend-cleanup-audit.md` has a stated fate in chapter 12.
8. Chapter 14 includes per-phase objective gates, checkpoint commits, the RUN_LOG requirement, and abort semantics.
9. *(Amendment, 2026-07-06.)* Every founder resolution from the amendment brief is recorded per chapter 15 section 15.1 mechanics; chapters 17 and 18 are self-contained (the v2 brief's load-bearing content is folded in, including the A1 claims lists verbatim in chapter 17 section 17.9); the security addendum's FIXED items each name an enforcement home in chapter 09, its RUN items appear as chapter 14 gates, and its CERT-PHASE items are recorded as deferred.

## After founder approval

The approved spec - zero unresolved run-start-blocking items (deferrable defaults stamp at gate G-P; Q-02/Q-03 resolve on the chapter 10 cutover checklist) - becomes the sole input to one autonomous implementation run in the new repository, **`ekoa-code`**, created as a sibling folder of `ekoa-dev` (orchestrator + subagents, phase-gated per chapter 14, unsupervised until completion): the API, the web client migration, the anonymisation layer, the bridge and fake-daemon harness, the test suites, the documentation, and the diagrams in a single pass. The landing review is the RUN_LOG, the checkpoint history, and the test results.
