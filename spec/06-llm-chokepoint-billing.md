# 06. LLM chokepoint and billing

This chapter fixes the one module through which every Anthropic byte in the service flows (FIXED-3; the same module is now the three-concern egress module of FIXED-13), the attribution contract that tags every model call at its call site, the metering pipeline that turns raw token counts into ledger events, and the arithmetic that turns ledger events into a user's bill. The anonymisation pipeline that runs inside this module before every forward, and the de-tokenisation on every response, are specified in chapter 17; this chapter owns the attribution + metering concern and the provider-routing configuration posture (section 6.1). Ground truth is reference/llm-usage-map.md (normative: the 27-site table, the attribution scheme, the per-call fates, the metering points, the OAuth asymmetry) plus reference/invisible-behaviors.md sections 2 and 12.7. Module placement and import rules follow chapter 02; the billing REST surface follows chapter 03 section 3.8.21; the ledger and account stores follow chapter 04 section 4.3.1. The visual companion is diagram 06 in `spec/diagrams/` (FIXED-12: any change to this flow updates that diagram in the same unit of work).

## 6.1 Design stance

- **Model at the edges only (FIXED-3).** Exactly one module, `api/src/llm/`, talks to Anthropic. Every call is tagged `user_work | platform | classifier` at the call site, recorded and metered from day one. No model calls exist in runtime platform paths: routing, request handling, lifecycle, and CRUD are deterministic code.
- **One egress module, three concerns (FIXED-13).** The chokepoint is not only this chapter's billing boundary. FIXED-13 fixes it verbatim: "One egress module, three concerns. The LLM chokepoint (`api/src/llm/`) is simultaneously: attribution + metering (chapter 06), the anonymisation pipeline (chapter 17), and provider routing config (provider base URL, region, zero-retention posture as configuration, never hardcoded). Nothing else may import or instantiate the Anthropic client - lint/dependency-enforced; subprocess paths (Agent SDK spawns) are pointed at the chokepoint via base URL/env so their traffic funnels through it." This chapter owns the first concern, attribution and metering; chapter 17 owns the anonymisation pipeline that runs inside the same module; provider routing (base URL, EU region, zero-retention posture) is configuration read from `config.ts`, never hardcoded (the Ekoa Local v2 brief, docs/, A6-D6). The pipeline order at the egress is fixed: attribution tag (section 6.3) -> billing allowance gate and metering hooks (this chapter) -> anonymise the model-bound payload (chapter 17 section 17.3) -> forward to Anthropic -> de-tokenise the response -> meter on the provider-reported usage. Metering counts the provider-reported token usage of the tokenized payload; tokenization is format-preserving, so the counts are equivalent and no billing arithmetic changes.
- **LLM authors at design time; code executes at runtime (FIXED-4).** The old backend's runtime markdown-to-JSON domain layer and its model calls do not exist in the rebuild; models write TypeScript during development, committed to the repo, and that code runs.
- **User work through the Claude Agent SDK is the product and the billable surface (FIXED-3).** The 14 user_work call sites carry over intact; the 6 classifier sites stay on the cheapest tier with deterministic fallbacks; all 6 platform sites receive their fates (section 6.4) and none survives as a runtime model call.
- **One metering point.** The chokepoint meters every call it makes; nothing else in the service writes LLM ledger events. No double-billing is possible because there is no second writer; no unbilled model call is possible because there is no second caller (reference/llm-usage-map.md §8; the unbilled visual-vibe class is eliminated, conflict 10).

## 6.2 Module design: `api/src/llm/`

Placement, imports, and lint enforcement per chapter 02 (sections 2.6 and 2.9): `llm/` may import `billing/`, `data/`, `config.ts`; nothing outside `llm/` may import `@anthropic-ai/*` or issue requests to `api.anthropic.com`.

**One module, three concerns (FIXED-13).** The files below are the attribution and metering surface this chapter owns. The same module also hosts the anonymisation pipeline (chapter 17: detection, per-session tokenization, vault, audit) - those files live inside `llm/` and are specified in chapter 17, not re-listed here - and reads provider routing (base URL, EU region, zero-retention posture) from `config.ts` as configuration, never hardcoded (the Ekoa Local v2 brief, docs/, A6-D6). Every chokepoint entry point (section 6.2.1) therefore threads each request through anonymise-before-forward and de-tokenise-after-return (chapter 17 section 17.3), between the attribution tag and the single metering call.

Internal layout:

| File | Responsibility |
|---|---|
| `llm/client.ts` | The chokepoint entry points (below): Agent SDK streaming runs, SDK one-shot calls, direct Messages REST calls, and the gateway pass-through. Owns the single metering call after every completed request. |
| `llm/attribution.ts` | The `LlmAttribution` discriminated union (section 6.3), the agent-type tag vocabulary, and the runtime assertion that fires on any `platform`-attributed call (zero legitimate call sites at launch). |
| `llm/router.ts` | Deterministic tier selection: complexity hints, tier floors, file-count and keyword scoring, default FAST. No model call - this is pure code, ported from the old zero-import tier classifier (reference/carryover-audit.md A11, `llm-router.ts` row). The dead `escalate()` export and the never-passed `previousFailures` input are not carried (reference/llm-usage-map.md conflict 6). |
| `llm/credentials.ts` | Central model-credential custody: the `credentials` Firestore singleton read/written through `data/` (AES-encrypted via the one crypto module; ch04 §4.5), holding one credential per environment plus `mode: 'oauth' \| 'api-key'` (FIXED-8 *(amended 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md): credentials are centrally managed, encrypted at rest, never per-user ad hoc, never a `~/.claude` fallback; the chokepoint supports two auth modes as per-environment configuration - subscription OAuth (current) and Anthropic API key (production/customer path))*). Simplified semantics (§6.2.4): one credential per environment; proactive refresh before expiry (oauth mode); refresh-and-retry-once on 401; alert on persistent failure. **Deleted** from the old design: credential pools, multi-subscription rollover, rotation mutex/persist-first/peer-adoption/keep-row-on-401, health scoring, selection logic, per-installation rows, and the 20-minute watchdog machinery (reduced to the alert). Builds the SDK subprocess env per mode: always scrub inherited provider env, then inject the configured mode's credential (oauth -> `CLAUDE_CODE_OAUTH_TOKEN`, api-key -> `ANTHROPIC_API_KEY`) from central custody and set `ANTHROPIC_BASE_URL` to the chokepoint (ch05 §5.4.1; FIXED-13 unchanged); no raw per-user key. Permanent-refresh-failure surfacing per section 6.2.4. |
| `llm/gateway.ts` | The ekoa-local gateway sub-app (routes per chapter 03 section 3.10), ported per reference/carryover-audit.md B12, with its metering moved inside the chokepoint (section 6.5.4). |

### 6.2.1 Chokepoint entry points

Every entry point takes `attribution` as a **required positional parameter** (section 6.3). There is no overload without it and no default value.

```ts
// llm/client.ts - the only file in the service that touches Anthropic transports
runAgent(opts: AgentRunOptions, attribution: LlmAttribution): AgentRunHandle;
  // Claude Agent SDK query(): streaming, all tiers, tools, session resume.
  // Used by every streaming user_work site (chat, build, brand research, ...).

runOneShot(opts: OneShotOptions, attribution: LlmAttribution): Promise<OneShotResult>;
  // Claude Agent SDK, non-streaming, no tools, optional image attachments.
  // Replaces the old callSimpleLlm; used by automation planning/vision (strong
  // tiers) and by FAST classifier sites that need image input.

completeFast(opts: MessagesOptions, attribution: LlmAttribution): Promise<MessagesResult>;
  // Direct Messages REST on the environment's central credential (OAuth token
  // in oauth mode, API key in api-key mode). FAST tier ONLY - the
  // options type does not admit a tier parameter (section 6.2.2). One
  // forced-token-refresh retry on 401, carried (reference/llm-usage-map.md §2, T2).

proxyGatewayMessages(req, res, principal): Promise<void>;
  // Metered pass-through for the ekoa-local gateway (section 6.5.4).
```

**Abort semantics are fixed by construction.** `runOneShot` and `completeFast` reject with a typed `LlmAbortedError` on user abort; they never resolve with an empty string. The old `callSimpleLlm` returned `''` on abort, which forced every classifier caller to re-check abort or a user Stop would fall through to a deterministic-fallback "modification" that launched a build (reference/llm-usage-map.md conflict 11). In the rebuild the deterministic fallbacks of section 6.4.2 trigger on failure and timeout, **never** on abort - abort propagates as abort. This enforces the abort invariant CONV-5 (chapter 05 section 5.3.2) at the chokepoint rather than by caller discipline.

**No default model.** Every entry requires a `RouterDecision` (or a tier for one-shots) from `llm/router.ts`. The old service had a latent no-decision fallback that defaulted to Opus (`config.external.model`; reference/llm-usage-map.md conflict 13). The rebuild does not inherit it: a missing decision is a compile error, not an expensive default.

### 6.2.2 Transports and the OAuth asymmetry

| Transport | Entry | Models reachable | Why |
|---|---|---|---|
| Claude Agent SDK subprocess | `runAgent`, `runOneShot` | All tiers (FAST/WORKHORSE/EXPERT) | The SDK subprocess is the only strong-model path on the managed OAuth account class |
| Direct Messages REST | `completeFast` | FAST only (typed) | Direct REST on managed OAuth returns 400 for Sonnet/Opus in oauth mode (verified live; reference/llm-usage-map.md §2 and conflict 7); typed FAST-only in both modes (§6.2.2 prose) |
| Gateway pass-through | `proxyGatewayMessages` | Clamped to FAST wire tier | Same REST constraint; heavy TUI work escalates to the agent-face SDK run instead (reference/llm-usage-map.md §5, site 7 note) |

This asymmetry is a **load-bearing environmental constraint of subscription-OAuth mode**, not a design choice (reference/llm-usage-map.md §2). It is why vision and planning route strong-tier one-shots through the SDK, why the gateway clamps its wire tier, and why the TUI turn classifier uses direct REST (the SDK subprocess costs 3.2-8.3 s per call, over its 3.5 s budget - reference/llm-usage-map.md §6). In **api-key mode** (FIXED-8 as amended, §6.2) direct REST reaches all tiers, so the asymmetry does not apply; the chokepoint nonetheless keeps its conservative typing in **both** modes - `completeFast` cannot express a tier above FAST - so the routing design holds unchanged whichever mode an environment runs, and no caller has to branch on mode. Any future change that replaces the Agent SDK must re-solve strong-model access before touching this table.

**Subprocess and bridge traffic funnel through the same chokepoint (FIXED-13).** The Agent SDK runs in a subprocess, so its Anthropic traffic cannot be caught by an in-process import ban alone: the subprocess is pointed at the chokepoint via base URL/env (the per-mode env injection built in `llm/credentials.ts` above), so every SDK subprocess call traverses the identical anonymisation and metering path as an in-process REST call - no subprocess request reaches Anthropic un-anonymised or unmetered. The ekoa-local bridge provider endpoint (chapter 18 section 18.4) is one more caller class of this same chokepoint: an Anthropic-compatible completions endpoint whose requests carry the propagated session identity (so they share the conversation's anonymisation vault, chapter 17 section 17.5), authenticate with pairing-bound credentials, and are attributed `user_work` and metered here like any other billable call.

### 6.2.3 Tiers and models

Three tiers (FIXED-3: the tier classifier stays; the cheapest suitable tier serves classification). The old REASONING_LIGHT tier is retired with its only caller (section 6.4.3, site 22).

| Tier | Model (config value, snapshot at spec time) | sdkEffort | Billing weight (config, default) |
|---|---|---|---|
| FAST | `claude-haiku-4-5-20251001` | low | 0.02 |
| WORKHORSE | `claude-sonnet-4-6` | medium | 0.1 |
| EXPERT | `claude-opus-4-8[1m]` | high | 0.4 |

Model ids and weights live in `config.ts`, env-overridable, exactly as today (reference/llm-usage-map.md §3; reference/invisible-behaviors.md 12.7). No model id appears anywhere outside `llm/` and `config.ts`.

**Recorded and not carried: thinking budgets.** The old tier configs declared per-tier `thinking.budgetTokens` that were never serialized onto any wire request; only the SDK `effort` parameter ever went out (reference/llm-usage-map.md conflict 5). The rebuild does not carry the fiction: tier configs carry `effort` only. If extended thinking is ever wanted it is a new, deliberate feature with its own metering entry, not a resurrected dead field.

### 6.2.4 Permanent refresh failure: observability carried, client broadcast dropped

The credential custody is simplified (FIXED-8 as amended; §6.2, Amendment 2 Part 1.2): in oauth mode the credential is proactively refreshed before expiry, and on a 401 the run forces one refresh and retries once (ch05 §5.4.2). Persistent refresh failure **latches the alert exactly once**. The old multi-step scheduler ladder and its 20-minute watchdog machinery reduce to that single latched alert; what the latch feeds is decided explicitly here:

- **Carried.** The latch records `lastRefreshError` in the auth status and flips `GET /health` `claudeAuth.ok` to false; the `claudeAuth` field shape is carried verbatim as the external-watchdog contract (chapter 03 section 3.8.23; reference/invisible-behaviors.md section 2.6). Any run in flight during the outage surfaces the failure on its own stream: the SDK auth-retry path forces one refresh and, on exhaustion, emits a real terminal error, never a fake completion (reference/invisible-behaviors.md section 2.7).
- **Dropped, recorded.** The old boot-registered hook additionally broadcast an `auth_error` SSE event to every connected client, intended as a re-auth prompt (reference/invisible-behaviors.md section 2.6). The rebuild does not carry the broadcast. Reason: it is dead on the wire today - `auth_error` is not among the event types the current client registers, so no client handler has ever fired for it (reference/frontend-cleanup-audit.md FC-007 lists the full registered set; `auth_error` is absent) and there is no user-visible behavior for FIXED-9 to preserve; the prompt it intended is not actionable by end users anyway, because re-authenticating the managed platform token is an operator action, not a user one (FIXED-8). The operational alerting contract lives entirely on `/health` `claudeAuth` plus the external watchdog, both carried. The notifications channel therefore stays at the five events of chapter 03 section 3.6.4 (P-04). If a platform-wide re-auth banner is ever wanted, it is an additive sixth event on that channel - a deliberate P-04 scope change, not a carry.

## 6.3 The attribution contract

Attribution is a compile-time-required parameter on every chokepoint entry (reference/llm-usage-map.md §1 is the normative scheme; FIXED-3 requires it recorded and metered from day one).

```ts
// llm/attribution.ts
type LlmAttribution =
  | { kind: 'user_work';
      agentType: UserWorkAgentType;          // closed union, section 6.4.1
      billeeUserId: string;                  // REQUIRED: who pays
      artifactId?: string;                   // set for artifact-owner billing
      sessionId?: string; runId?: string }   // ledger correlation
  | { kind: 'classifier';
      agentType: ClassifierAgentType;        // closed union, section 6.4.2
      billeeUserId: string }                 // the requesting user pays (carried)
  | { kind: 'platform';
      agentType: string;
      justification: string };               // required prose; see below
```

Rules:

1. **`user_work` requires a billee.** The type makes an unbilled user_work call inexpressible. Artifact-mediated calls (assistant chat for a served app, an artifact backend's model capability) bill the **artifact owner** and stamp `artifactId` (carried: reference/llm-usage-map.md §5, sites 3 and 14).
2. **`classifier` bills the requesting user** at FAST weight, exactly as today (the classifier calls ride user requests; reference/llm-usage-map.md §6, §8 point 4).
3. **`platform` has zero legitimate runtime call sites at launch.** All six platform-attributed calls are eliminated per section 6.4.3. The enum member exists so design-time tooling and any future addition must still declare itself; `llm/attribution.ts` asserts on every platform-attributed call at runtime (structured error log plus a metering-anomaly counter surfaced on `/health`). A platform call appearing in production telemetry is a defect, not a cost line. Platform-attributed usage that does somehow occur is ledgered against the platform admin account, never silently dropped (carried posture: reference/invisible-behaviors.md 12.7, "platform-overhead calls with no user bill to the cached super-admin id").
4. **`agentType` is the billing breakdown dimension.** `GET /billing/breakdown` (chapter 03 section 3.8.21) is a group-by over ledger events' `agentType`; the tag vocabulary in section 6.4 is therefore part of the reporting contract, not just telemetry.

## 6.4 Normative disposition table

Every model call site of the old service, restated with its destination in the new design. This table is the acceptance checklist for FIXED-3/FIXED-4 compliance: the implementation run must account for all 27 rows (reference/llm-usage-map.md §4 is the source; nothing here may be silently dropped or silently kept). Two Amendment 2 rows (A1 `memory-extract`, A2 `build-verify`) are appended to the user_work table (section 6.4.1) as new billable sites and are accounted **separately** from that 27-row census, not folded into it.

### 6.4.1 user_work - 14 carried sites plus 2 amendment additions

| # | agentType tag | What it is | Tier | New home (module per ch02) | Carried notes |
|---|---|---|---|---|---|
| 1 | `chat` | Unified chat turn | WORKHORSE floor, EXPERT when classified | `agents/` chat run pipeline | Memory injection, always-on knowledge grounding in chat, knowledge tools restricted to the two knowledge MCP tools, never Bash/Write (reference/llm-usage-map.md §5) |
| 2 | `build` | App build / follow-up build | EXPERT (floor) | `agents/` build job | Full tool preset; session persist/resume; 40 min wall clock, 5 min inactivity; knowledge grounding only in legal build context |
| 3 | `assistant-chat` | End-user chat with a built app | Heuristic FAST/WORKHORSE/EXPERT | `agents/`, invoked from the served-app plane | Deterministic greeting/knowledge pre-classifier in front of the call stays code; bills the artifact owner |
| 4 | `integration-builder` | AI integration-builder chat | WORKHORSE | `agents/` job started by the `integrations/` builder routes | The dead `isCodeGen:true` flag is not carried (reference/llm-usage-map.md conflict 9) |
| 5 | `brand-research` | Brand-research synthesis agent | WORKHORSE | `agents/` job started by branding routes | Deliberately tool-less (prompt-injection containment, carried); may receive the 1-3 brand screenshots as attachments, absorbing the dropped visual-vibe signal (site 26) at zero extra calls |
| 6 | `agent-face` | Strong-model TUI agent, daemon-RPC tools | EXPERT (hint 'high' pins it; the inert WORKHORSE floor comment is not carried, conflict 8) | `agents/` (execution) via `llm/` runAgent; daemon tools via `bridge/` | Self-metering removed - the chokepoint meters it (section 6.5.5) |
| 7 | `pi-fast-loop` | Gateway proxy for the ekoa-local fast loop | FAST (wire-clamped) | `llm/gateway.ts` | Billed at wire tier (section 6.5.4) |
| 8 | `automation-plan` | Goal to step-list planning | EXPERT, effort max | `automation/` planner via `runOneShot` | Corrective-retry budget carried; closed-vocabulary output validation carried |
| 9 | `automation-rehearse` | Rehearsal failure to plan patch | EXPERT, effort max, image | `automation/` via `runOneShot` | Budget-capped per run, carried |
| 10 | `vision-resolve` | Screenshot to deterministic browser action | EXPERT, effort max, image | `automation/` vision via `runOneShot` | Action cache keyed `(automationId, stepId, pageFingerprint)` is the standing design-time mechanism: full-cache-hit runs consume zero tokens (reference/llm-usage-map.md §5) |
| 11 | `vision-verify` | Screenshot to outcome assertion | EXPERT, effort max, image | `automation/` vision via `runOneShot` | Assertion cache, same mechanism |
| 12 | `answer-about-build` | User question about the current build | FAST | `agents/` in-build answer flow | |
| 13 | `answer-about-ekoa` | Platform question mid-build | FAST | `agents/` in-build answer flow | The hardcoded platform-capability system prompt must be kept in sync or answers lie (reference/llm-usage-map.md §5) - stated in the new repo CLAUDE.md |
| 14 | `artifact-backend:<entrypoint>` | Model capability for artifact backends | FAST (explicit, not defaulted) | `apps/` worker runtime via `runOneShot` | Worker cannot choose billee or tier (carried); bills the artifact owner with `artifactId` stamped |
| A1 | `memory-extract` | Post-run memory extraction *(Amendment 2 addition, not part of the 27-site census)* | FAST | `memory/` extraction pipeline, invoked post-run by `agents/` via `runOneShot` | **P-12 re-resolved** (ch05 §5.8): asynchronous post-run, batched **per run** (one call per run, never per turn), never adds turn latency; billee = the run's user; hosted runs only; always writes `visibility: 'private'`; per-user toggle `memory.autoExtract` default ON. Re-enters the disposition map at §6.4.3 call 23 (re-fated) |
| A2 | `build-verify` | Per-build verification agent *(Amendment 2 addition, not part of the 27-site census)* | WORKHORSE floor (fix-forward edits may classify EXPERT) | `apps/`/`agents/` verification stage via the chokepoint | **Part 6**: default ON per `build.verifyBuilds`; playwright-cli, medium depth, incremental (full acceptance on first build, scoped + smoke on follow-ups); fixes forward within the slice retry budget, honest visible note on unfixed failure; billee = the build's user (ch05 §5.6.2; ch07 pipeline; ch12 banner) |

### 6.4.2 classifier - 6 sites, all stay (FIXED), each FAST with a deterministic fallback

The fallbacks are committed code, so a model outage degrades accuracy but never blocks (reference/llm-usage-map.md §6). Fallbacks fire on failure or timeout, never on abort (section 6.2.1).

The `agentType` tags in these tables are carried verbatim from the normative map as ledger identifiers - they are part of the billing-breakdown reporting contract (section 6.3, rule 4) and must not be renamed without a ledger migration.

| # | agentType tag | Decision | New home | Deterministic fallback (carried) |
|---|---|---|---|---|
| 15 | `detect-build-intent` | Is this message a build request | `agents/` gathering pipeline | Keyword verbs/nouns scorer |
| 16 | `detect-integration-needs` | Which integration categories are implied | `agents/` gathering pipeline | Keyword-to-category map; model output filtered to the closed enum |
| 17 | `select-base-template` | Pick the starting scaffold | `agents/` gathering pipeline | Keyword-to-base map; validated against the closed base-id set. Fired only while no base is chosen; the two detection calls (15, 16) run in parallel, base-select sequentially after (reference/llm-usage-map.md §6, §9) |
| 18 | `classify-in-build-intent` | Follow-up message: modify, question, or new build | `agents/` follow-up pipeline | Heuristic classifier. **Abort invariant**: a user Stop must never reach this fallback (section 6.2.1; reference/llm-usage-map.md conflict 11) |
| 19 | `classify-tui-turn` | TUI turn tier + escalation | `llm/gateway.ts` classify endpoint via `completeFast` | Keyword scorer; hard 3.5 s budget; any failure (HTTP, budget, enum-invalid output) falls back automatically; a keyword-only config mode restores the pure deterministic path; the endpoint never 500s (reference/invisible-behaviors.md 2.8) |
| 20 | `vision-classify-human-action` | Stuck automation page: CAPTCHA / MFA / login | `automation/` via `runOneShot` (image) | Regex layer runs first and catches most cases; the model is the tail-catcher only |

### 6.4.3 platform - 6 sites, each with its fate executed (FIXED; none survives as a platform-attributed runtime model call - call 23 re-enters re-attributed as user_work, section 6.4.1 row A1)

| # | Old call | Fate (reference/llm-usage-map.md §7) | Destination in the new design |
|---|---|---|---|
| 21 | Startup compile of markdown domain-logic files into JSON operation tables | moves-to-design-time | **Nothing to port.** The layer it compiled for does not exist in the rebuild: user-app data runs on the collections engine and platform domains are typed routes written at design time (FIXED-4, FIXED-5). The surviving principle is general: models author code and artifacts during development, committed to the repo; runtime only executes. |
| 22 | Model-improvised answer for an unmatched domain operation | dropped | Unknown routes are a plain 404; invalid bodies are a zod 422 with the chapter 03 error envelope. A model improvising a prose answer to a failed CRUD operation was a correctness hazard, not a feature. Dropping it also retires the REASONING_LIGHT tier (its only caller). |
| 23 | Post-turn memory auto-extraction | returns 2026-07-06 (Amendment 2) as billable `user_work` | **Re-fated - P-12 re-resolved (ch05 §5.8).** Ships ON: asynchronous post-run, batched per run, per-user toggle `memory.autoExtract` default ON, attributed `user_work` `memory-extract` (§6.4.1 row A1) billed to the run's user. The zero-platform-calls posture (§6.1; §6.3 rule 3) stands **untouched** - the call re-enters as user work with a billee, never as ambient platform overhead. Its prior fate (dropped from the baseline as an unbilled ~1-FAST-call-per-turn tax) is superseded. |
| 24 | Memory consolidation merge | becomes-code | Deterministic near-duplicate merging (string similarity within tag groups) in `memory/`, behind the same manual admin action. Grouping was already deterministic; accepted quality loss on subtle merges. This module makes zero model calls (chapter 02, `memory/` entry). |
| 25 | URL slug generation | becomes-code | The committed deterministic slug fallback plus collision resolution becomes the only path, in `apps/` (chapter 07). The model only ever improved aesthetics. |
| 26 | Visual-vibe screenshot analysis | dropped | It was unbilled, router-bypassing, and non-fatal by design (conflict 10) - the deterministic brand extractors already carry the exact colors and fonts. If the subjective signal is wanted, the screenshots attach to the brand-research agent session (site 5): zero extra calls, properly billed user_work. |

Site 27 (the build-time OAuth/tool validation harness) is a dev tool, never a serving path, and is not carried into the service (reference/llm-usage-map.md §4, row 27).

**Acceptance criterion (FIXED-3/FIXED-4):** at launch, a grep of `api/src/` outside `llm/` finds zero Anthropic imports and zero `api.anthropic.com` strings (section 6.10), and the runtime platform-call counter (section 6.3, rule 3) reads zero across the cutover shadow-traffic window (chapter 10).

## 6.5 Metering pipeline

### 6.5.1 The single metering point

`llm/client.ts` meters every call it completes: after the SDK stream finishes (or aborts with reported usage), after a REST response, after the gateway response body is parsed. It computes metered tokens and hands one event to `billing/` (the tracker; reference/carryover-audit.md B6). Consequences, all FIXED by construction:

- **No double-billing.** Callers cannot meter because callers cannot reach the transport. The old code's "callers must not double-bill" discipline (reference/llm-usage-map.md §8, point 1) becomes structural.
- **No unbilled model calls.** Every entry point requires attribution with a billee (or the asserting platform arm); the ledger write is in the same function that made the call.
- **The ledger has one writer.** Chapter 04 fixes `token_events` as "written only by the chokepoint metering path"; this section is that path.

### 6.5.2 The metering formula (normative)

For a call at tier `t` with weight `w(t)` (section 6.2.3) and raw provider counts:

```
metered = round( w(t) * (input_tokens + output_tokens + cache_creation_input_tokens)
               + w(t) * CACHE_READ_FACTOR * cache_read_input_tokens )
```

`CACHE_READ_FACTOR = 0.25` (config, default carried from the old constants; reference/invisible-behaviors.md 12.7; reference/llm-usage-map.md §8). Weights and factor are env-overridable but changing them mid-period changes bills - the ledger event snapshots `tierWeight` at write time so historical events re-total identically forever.

Worked example: one build turn on EXPERT reports input 200,000, output 30,000, cache reads 800,000. Metered = 0.4 x 230,000 + 0.4 x 0.25 x 800,000 = 92,000 + 80,000 = **172,000 metered tokens**.

**Recorded and not carried: the default-weight bucket.** The old tracker applied a WORKHORSE-weight default to records lacking tier info (reference/llm-usage-map.md conflict 12). In the rebuild tier is a required field of the metering call, so the default bucket is unrepresentable and is deleted. Likewise the old tracker's stale header claiming character-based estimation (reference/carryover-audit.md conflict 5) describes nothing: real provider token counts are the only input.

### 6.5.3 Ledger event shape

One document per call in `token_events` (chapter 04 section 4.3.1; the fields below extend that row additively):

```
{ _id, billeeUserId, attributionKind: 'user_work'|'classifier'|'platform',
  agentType, artifactId?, sessionId?, runId?,
  model, tier, tierWeight,
  raw: { input, output, cacheCreate, cacheRead },
  metered, timestamp }
```

Retention per chapter 04 P-09: raw events 13 months, monthly per-user rollups forever.

### 6.5.4 Gateway wire-tier billing

The gateway (`llm/gateway.ts`, routes per chapter 03 section 3.10) bills at the **wire** tier - FAST, because that is what actually crosses the wire - regardless of what the router would have classified the request as (carried; reference/llm-usage-map.md §8, point 3). Usage is parsed from both streamed and non-streamed response bodies. The carried parse-or-skip rule stays contract: an unparseable body skips billing for that call (reference/invisible-behaviors.md 2.8) - but the rebuild makes the skip observable: a `gateway_unmetered_call` counter increments and is exposed on `/health`, so silent metering drift is detectable instead of invisible. The billee is the JWT principal; gateway-key principals bill the platform admin account (carried).

### 6.5.5 Agent-face metering folds in

The old agent-face loop deliberately bypassed the adapter's meter and self-metered (reference/llm-usage-map.md §8, point 2). In the rebuild agent-face runs execute through `runAgent` like every other SDK run, so the chokepoint meters them - there is no second meter to maintain. Cancelled runs: see RESOLVED (P-19) (section 6.9).

### 6.5.6 Non-model metering rides the same ledger, not the chokepoint

Two metered surfaces consume no Anthropic tokens and therefore do not pass through `llm/`: STT transcription (billed per started audio minute at a flat configured rate, engine-tagged; the interface + mock engine + metering ship - Q-08 RESOLVED, chapter 16) and the Pipedream layer's metered external calls (reference/invisible-behaviors.md 12.7). The FIXED-11 non-Anthropic-provider exclusion is interpreted narrowly and normatively: it targets LLM providers, not speech-to-text; a self-hosted whisperx engine remains the segredo-profissional posture when provisioned (Q-08 resolution, chapter 16). Both write events through `billing/`'s public recording API into the same ledger and the same period arithmetic - one ledger, one bill - but they are not LLM events and the chokepoint rule does not apply to them. `services/` and `integrations/` may import `billing/` for exactly this (chapter 02, section 2.6).

### 6.5.7 No provisional in-flight ticks

The old adapter emitted a debounced cosmetic `usage_progress` push from streaming deltas; the end-of-call record was always the truth (reference/invisible-behaviors.md 12.7). Chapter 03 P-04 drops the cosmetic event from the wire, so the chokepoint emits nothing mid-call. The single `usage_updated` push fires per ledger write (section 6.8).

## 6.6 Bill computation

The billing domain (`billing/`: constants, tracker, ledger access, allowance middleware; reference/carryover-audit.md B6) is token-denominated: the internal currency is **metered tokens** (section 6.5.2). The REST surface is chapter 03 section 3.8.21; the stores are chapter 04's `token_events` and `billing_accounts`. Per-user metering and allowance are **unchanged by the org model** (Amendment 2 Part 4): metering, the ledger, and the allowance gate stay per user; an org-level billing rollup is a later Registo read view, not a billing rework.

### 6.6.1 Per-user account state

`billing_accounts` (one document per user, chapter 04): `monthlyBaseTokensUsed`, `creditBalanceUsd`, `overageEnabled`, `currentPeriodStart`, plus the admin-set `tokenLimit` (null = platform default). Updates are CAS with bounded retry - gate reads must never double-apply (chapter 04 section 4.3.1).

### 6.6.2 The arithmetic (normative)

For user `u` in the current period:

```
used(u)      = monthlyBaseTokensUsed             // accumulated by the tracker per ledger event
base(u)      = tokenLimit(u) ?? platformDefaultBase   // admin override per user
remaining(u) = max(0, base(u) - used(u))
creditTokens(u) = floor(creditBalanceUsd(u) * CREDIT_TOKENS_PER_USD)
effectiveTotal(u) = base(u) + (overagePermitted(u) ? creditTokens(u) : 0)

overagePermitted(u) = overageEnabled(u) AND globalOverageEnabled AND NOT HARD_LIMIT
```

- **Monthly base.** Every user gets `base(u)` metered tokens per period. `PERIOD_DAYS = 30`; the period reset is **lazy**: any record or allowance read that observes `now - currentPeriodStart >= 30 days` zeroes the meter and advances the period start - no timer (carried; reference/invisible-behaviors.md 12.7).
- **Credits.** `POST /billing/credits { amountUsd }` increments `creditBalanceUsd`; `CREDIT_TOKENS_PER_USD` is a config constant carried from the old billing constants. When `used > base` and overage is permitted, each further metered token deducts credit at that rate, applied by the tracker at ledger-write time.
- **Overage.** Three switches gate spending past base: the user's `overageEnabled` (`PUT /billing/overage`), the admin global kill-switch (`PUT /billing/admin/overage`, read from settings), and the hard-limit launch flag (P-20, section 6.9). All three must permit.
- **Admin limits.** `PUT /billing/admin/limits/:userId { tokenLimit | null }` sets or clears the per-user base; `POST /billing/admin/usage/:userId/reset` zeroes the meter; `GET /billing/admin/usage` lists per-user rows (reference/operations-inventory.md §20).
- **What a user's bill is.** `Sum(metered)` over the user's ledger events in the period, where user_work events dominate by construction (classifier events are FAST-weighted noise; platform events are zero at launch). `GET /billing/usage` returns the derived view - used, base, remaining, effectiveTotal, percentage, credit balance and tokens, overage flags, period dates, gauge color and warning flag - shape and thresholds carried from the current surface (reference/operations-inventory.md §20). `GET /billing/breakdown` groups the same events by `agentType`.
- **Parity check.** This arithmetic must reproduce the old service's totals on identical inputs: billing parity on shadow traffic is a cutover criterion (chapter 10). The formula, weights, and factor above are the contract for that check.

### 6.6.3 Billing gate placement: pre-run at every user_work entry (carried semantics; coverage widening RESOLVED (P-24))

The allowance gate (`billing/` middleware plus a callable check for non-route entries) runs **before** the model call is admitted, at run creation. The **activation checks precede the allowance gate** at every entry (Amendment 2 activation model): a deactivated account fails `ACCOUNT_DISABLED` (403) and an account-level billing lock fails `BILLING_LOCKED` (402) - the CONV-2 error codes (chapter 03 section 3.3) - before allowance is consulted, and the three admission planes that consult the cached activation state are owned by chapter 09. The two Amendment 2 `user_work` additions ride their run's admission and add no separate gate row: `build-verify` runs inside an already-admitted build (§6.4.1 row A2), and `memory-extract` runs post-run against a run that was already admitted (row A1).

| Entry | Gate point |
|---|---|
| Chat turn | `POST /chat/runs` (carried - the old pre-turn gate) |
| Build job / follow-up | `POST /jobs` (carried) |
| Integration-builder chat | builder chat route (new coverage) |
| Brand research | `POST /branding/research` (new coverage) |
| Automation run | run start, including trigger-initiated runs under the trigger owner's identity (new coverage) |
| Agent-face run | `POST /api/v1/agent-face/run` (new coverage) |
| Assistant chat (served app) | served-app plane entry; checks the artifact owner's allowance |
| Artifact-backend model capability | per capability invocation; checks the artifact owner's allowance |
| Gateway messages | per proxied call; checks the JWT principal's allowance |

**Coverage widening - RESOLVED (P-24; register of record: chapter 15).** The gate covers every entry in the table above. The old service gated only chat turns and build jobs (reference/invisible-behaviors.md 12.7), which left the most expensive calls in the system (EXPERT effort-max vision and planning) ungated - and an allowance system that skips its most expensive entries is not an allowance system, so the widened coverage is normative. The gate is admission, not accounting: metering and the chapter 10 parity check are unaffected by the widening either way. Rejected alternative: gate only chat turns and build jobs at cutover for a marginally simpler parity comparison, widening afterwards - not taken, because it carries the ungated-cost exposure through the cutover window. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

**Gate semantics carried (not part of P-24):** the check is pre-run only. A run admitted under its allowance may finish even if it crosses the limit mid-run; the overrun is billed normally. There is no mid-run kill - killing a build halfway produces a broken artifact and a bill, the worst of both (carried; reference/invisible-behaviors.md 12.7).

**Block delivery depends on the entry's wire shape**, consistent with the chapter 05 section 5.2 creation pipeline (which responds `202` at step 2, before the gate at step 3):

- **Asynchronous run-creating entries** - chat turns (`POST /chat/runs`), build and brand-research jobs (`POST /jobs`, `POST /branding/research`), automation runs (including trigger-initiated runs, which have no waiting HTTP caller at all), and agent-face runs: the creating POST has already returned `202` with the run id when the gate runs. A block surfaces as the terminal `error` event on that run's stream with code `BILLING_BLOCKED`, and the run is marked `failed` (chapter 05 section 5.2, step 3; carried semantics, reference/invisible-behaviors.md sections 7.1 and 7.2). The POST never returns 402.
- **Synchronous request-response entries** - assistant chat on the served-app plane (result in the HTTP response, no stream - reference/invisible-behaviors.md section 7.2), the integration-builder chat route (chapter 03 section 3.8.14), and gateway messages: the blocked request returns the chapter 03 error envelope with code `BILLING_BLOCKED` and HTTP status 402. The artifact-backend model capability is the same class but has no HTTP client: the block rejects the worker's capability call with the same typed `BILLING_BLOCKED` error, which the artifact backend observes like any other capability failure.

Whatever the delivery, the payload is identical: `message` is the localized PT-PT user message the current UI expects (e.g. "Limite de utilização atingido. Fale com o administrador ou aguarde o início do próximo período.") and `details.billingUrl` carries the billing page URL (chapter 05 section 5.2, step 3). This structured pair replaces the old in-band `[billing_blocked:<url>]` marker (reference/invisible-behaviors.md sections 7.1 and 7.2).

### 6.6.4 Rate limits and spend caps at the chokepoint (security control)

Distinct from the allowance gate of section 6.6.3 (which enforces a period budget at admission), the chokepoint also enforces per-org and per-user **rate limits and spend caps** as a security control against unbounded consumption, with alerts on anomalous burn (security addendum, docs/security-addendum.md, B.5). These are nearly free to add here because attribution tagging (section 6.3) already carries the billee and org on every call, so the limiter counters group over data the chokepoint is already writing. The enforcement home and mechanism belong to chapter 09 under the security baseline (FIXED-14); this section records that the chokepoint is where the LLM-facing rate limits and spend caps live, and the chapter 13 final-phase suite exercises them (rate-limit and spend-cap tests at the chokepoint).

## 6.7 Usage push events

After each ledger write, the tracker fires the injected usage notifier (chapter 02, section 2.8, seam 1 - `billing/` never imports `events/`), which pushes `usage_updated` on the per-user notifications channel (chapter 03, section 3.6.4; RESOLVED (P-13) keeps it there, with polling `GET /billing/usage` as the rejected alternative). The event is a bare poke - `{ }` - and the client refetches; no balance data rides the push. The push must never fail the turn (carried: fire-and-forget with error log; reference/invisible-behaviors.md 12.9).

## 6.8 Conflicts recorded (from reference/llm-usage-map.md), with dispositions

| Conflict | Disposition in this design |
|---|---|
| 5 - thinking budgets dead on the wire | Not carried; effort-only tier configs (section 6.2.3) |
| 6 - `escalate()` dead export, `previousFailures` never passed | Not carried (section 6.2) |
| 8 - agent-face floor comment wrong (always EXPERT) | Carried as what it is: EXPERT pinned, comment deleted (section 6.4.1, site 6) |
| 9 - integration-builder dead `isCodeGen` flag | Not carried (site 4) |
| 10 - visual-vibe unbilled and router-bypassing | Eliminated (site 26); the class is made unrepresentable (section 6.3) |
| 11 - abort returns `''`, Stop can fall through to heuristic | Fixed at the chokepoint: typed abort rejection; fallbacks never fire on abort (section 6.2.1) |
| 12 - default billing weight vs FAST-defaulting one-shots | Default bucket deleted; tier required (section 6.5.2) |
| 13 - latent Opus default model | Deleted; decision required per call (section 6.2.1) |
| Tracker stale estimation header (carryover-audit conflict 5) | Nothing to carry; provider counts are the only input (section 6.5.2) |

## 6.9 Resolved register for this chapter

**RESOLVED (P-19) - billing of cancelled runs.** One uniform rule holds at the single metering point: every call bills the usage the provider actually reported up to the abort; if nothing was reported, nothing is billed. This is normative because tokens were consumed, and a special-case skip would re-create a second metering policy inside the fold-in of section 6.5.5. The old service left cancelled agent-face runs deliberately unbilled while other cancelled SDK runs billed whatever the adapter recorded (reference/llm-usage-map.md §8, points 2 and 5); the rebuild does not carry that split. Rejected alternative: carry the agent-face skip as a special case for exact behavioral parity - not taken; the delta only appears on cancelled runs and the chapter 10 parity check whitelists this known difference. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

**RESOLVED (P-20) - hard-limit launch posture.** The hard-limit flag ships as config, default **on** at launch (no accidental spend during cutover); the founder flips it off when paid overage goes live, at which point credits and overage switches become functional exactly as section 6.6.2 specifies. Rejected alternative: default off from day one so purchased credits work immediately - not taken, in favour of exact behavior parity through cutover; this is one config default with no structural impact, reversible at any time. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

**RESOLVED (P-24) - billing gate coverage widening.** Folded in place at section 6.6.3; chapter 15 is the register of record.

## 6.10 Lint and CI enforcement

Restated from chapter 02 section 2.9 (rule 2) so it lands in the scaffold, plus the additions this chapter owns:

1. **Import ban.** ESLint `no-restricted-imports` bans `@anthropic-ai/*` (including `@anthropic-ai/claude-agent-sdk`) across `api/src/**`, with a single override for `api/src/llm/**`.
2. **Grep gate.** CI fails if `api.anthropic.com` or `@anthropic-ai/` appears in any file outside `api/src/llm/` - catches raw `fetch` calls the import rule cannot see (the old visual-vibe class).
3. **Attribution required.** No chokepoint entry has an attribution default; TypeScript enforces presence, and a unit test asserts every exported entry of `llm/client.ts` rejects a call constructed without attribution (guards against a future optional-parameter regression).
4. **Platform-call alarm.** The runtime assertion of section 6.3 rule 3 plus its `/health` counter; the chapter 13 test suite includes a test that a platform-attributed call increments the counter and logs.
5. **CLAUDE.md.** The new repo's agent guidance states rules 1-2 and the single-metering-point rule from day one (FIXED-1, chapter 02).

## 6.11 Acceptance criteria for this chapter

- Every one of the 27 call sites in reference/llm-usage-map.md §4 appears in section 6.4 with attribution, tier, and destination; each of the 6 platform sites carries its executed fate. (Checkable: 14 + 6 + 6 + 1 rows.) The 27-row accounting stays intact for the old map; the two Amendment 2 additions - `memory-extract` (row A1) and `build-verify` (row A2) - are named and accounted **separately** as new billable `user_work` sites, not folded into the census. Platform call 23 is re-fated in section 6.4.3 from "dropped from the baseline" to "returns as billable `user_work` (`memory-extract`)", asynchronous post-run with a billee, so the zero-platform-calls posture is preserved.
- The metering formula, weights, cache factor, period length, and reset rule are stated with values, sufficient to implement without reading old code.
- Exactly one metering point is specified; the ledger's single-writer rule matches chapter 04 section 4.3.1 verbatim.
- Every billing REST surface from reference/operations-inventory.md §20 is covered by section 6.6 against the chapter 03 endpoint map.
- The dead-thinking-budgets conflict and the eight other recorded conflicts each carry an explicit disposition (section 6.8); none is silently carried or silently dropped.
- The simplified credential custody is testable per sections 6.2 and 6.2.4: the two auth modes are per-environment configuration (an environment in oauth mode injects `CLAUDE_CODE_OAUTH_TOKEN`, one in api-key mode injects `ANTHROPIC_API_KEY`, both from the `credentials` singleton, both scrubbing inherited provider env and setting the chokepoint base URL - ch05 §5.4.1). The semantics owed are exactly three tests: proactive-refresh-before-expiry, refresh-and-retry-once on 401, and a persistent-failure alert that latches `lastRefreshError` and flips `/health` `claudeAuth.ok` to false. No rotation-mutex / persist-first / peer-adoption / watchdog race tests are owed - that machinery is deleted. The permanent-refresh-failure surfacing decision stays explicit (section 6.2.4): `/health` observability and in-run error surfacing carried; the `auth_error` client broadcast dropped with a recorded, reference-cited reason.
- Billing-block delivery is stated per entry class (section 6.6.3) and is consistent with the chapter 05 section 5.2 pipeline: no entry both returns `202` and returns `402`.
- P-19, P-20, and P-24 are each folded as RESOLVED, with the decided rule normative, a recorded rejected alternative, and the standard resolution attribution (sections 6.6.3 and 6.9).
- The FIXED-13 pipeline order at the egress (attribution tag -> allowance gate and metering hooks -> anonymise per chapter 17 section 17.3 -> forward -> de-tokenise -> meter on provider-reported usage) is stated (sections 6.1, 6.2), and the note that metering counts the provider-reported usage of the tokenized payload (format-preserving, counts equivalent) is explicit; the anonymisation mechanism's own acceptance lives in chapter 17.
- Rate limits and spend caps are stated as enforced at the chokepoint, per-org and per-user, made cheap by attribution tagging, with the enforcement home cross-referenced to chapter 09 (FIXED-14; section 6.6.4).

Cross-references: chapter 02 (module placement, seams, lint), chapter 03 (billing endpoints 3.8.21, gateway and agent-face surfaces 3.10, P-04/P-13), chapter 04 (`token_events`, `billing_accounts`, P-09 retention), chapter 05 (job lifecycle the gate hooks into, abort semantics, RESOLVED (P-12) memory scope), chapter 07 (deterministic slugs), chapter 09 (credential custody, activation admission planes, security baseline FIXED-14: chokepoint rate limits and spend caps), chapter 10 (billing parity cutover criterion), chapter 17 (the anonymisation pipeline that runs inside this module, FIXED-13), chapter 18 (the bridge provider endpoint as a chokepoint caller class, section 18.4), chapter 16 (Q-08 resolution: STT interface + mock + metering ship).

*Amendment record: amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md).*

**Amended again 2026-07-06** per the consolidated-ledger amendment (Amendment 2, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md): `llm/oauth.ts` became `llm/credentials.ts` - central `credentials` Firestore singleton with two per-environment auth modes (subscription OAuth / Anthropic API key, FIXED-8 amended) and simplified semantics (one credential per environment, proactive refresh, refresh-and-retry-once on 401, alert on persistent failure), the rotation/pool/watchdog machinery deleted (§6.2, §6.2.4); the direct-REST FAST-only asymmetry scoped to oauth mode with the conservative `completeFast` typing kept for both modes (§6.2.2); two Amendment 2 `user_work` additions - `memory-extract` (row A1) and `build-verify` (row A2) - added and named separately from the 27-site census (§6.4.1, §6.11), with platform call 23 re-fated from dropped to returning as billable `user_work` (§6.4.3); the activation checks (`ACCOUNT_DISABLED`/`BILLING_LOCKED`) noted as preceding the allowance gate and the org model noted as leaving per-user metering unchanged (§6.6, §6.6.3); and `tenant` swept to `org` in the rate-limit/spend-cap prose (§6.6.4, §6.11).
