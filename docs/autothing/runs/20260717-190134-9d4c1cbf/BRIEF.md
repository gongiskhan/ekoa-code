# Ekoa Mega Run — Layout · Voice · App Operator · Cofre (unified brief, v1)

> Canonical run input for autothing run `20260717-190134-9d4c1cbf`, persisted verbatim from the invocation (the brief was not on disk). Two-file rule: the second canonical input `ekoa-mega-run-security-block.md` is opened only when Part F begins. It was NOT found on disk at run start — operator action required before Part F.

Status: **supersedes** the four standalone briefs (unified chat layout; voice v1 draft; operator ledger v0.2; cofre brief) as run input. Where this document differs from them, this document wins. Exception: the cofre brief's transparency doctrine (§9 there) remains authoritative for post-run page work, which is not run scope.

Repo: `ekoa-code`. Fully unattended multi-day run via autothing. Written suggestively: exploration tasks and decision criteria; structural implementation decisions belong to the planning session.

---

## 0. Run mechanics and model policy (read first)

Standard mechanics assumed: RUN_LOG UTC discipline, ownership lock + heartbeats, preflight doctor, per-slice checkpoint commit + tag, landing packet, meter-aware graceful landing, merge to main only after operator diff review.

**MODEL POLICY.** The run executes on Fable and must stay on Fable for as long as possible:

- The orchestrator and **every spawned subagent** pin the model **explicitly** at spawn time. Never rely on inherited defaults. Preflight verifies the spawn configuration honors the pin.
- Security-related content triggers a persistent switch to Opus. Therefore **Parts A–D contain no security code, no security design discussion, no auth/permission/crypto vocabulary** in planning, code, comments, or RUN_LOG. Where early code needs a permission decision, it calls the single `can(capability)` chokepoint seam (plain stub on the run branch; real implementation lands in Part F).
- **TWO-FILE RULE.** Canonical run inputs are exactly two files: this one and `ekoa-mega-run-security-block.md`. The second file is opened **only when Part F begins**. Parts A–E must not read it, and must not read the superseded standalone briefs. The expected model switch happens inside Part F and is acceptable there — by design it coincides with the code where the most conservative model is desirable, and the Codex adversarial pass covers one contiguous block.

**Synthetic data only.** At no point does the run handle real user credentials, real client documents (beyond deliberately seeded samples), or production data.

---

## 1. Preconditions (preflight; fail with a human-action list, never improvise provisioning)

- The Cortex foolproof/hardening run has landed: permanent journey suite present and green; J3 build-journey probe available.
- Env keys / service-account access present in Cortex: Deepgram (STT + Aura-2 en TTS); **Google Cloud TTS** (pt-PT/pt-BR prior); ElevenLabs (fallback candidate, optional — its absence is recorded, not a preflight failure); OpenRouter.
- The security file carries its own additional preflight, checked only when Part F opens.

## 2. Operator items outside the run (Parts A–E related)

Not agent scope; listed for the operator:

- Verify the STT vendor's data-processing terms and model-improvement opt-out before any lawyer-facing voice rollout (flag, not blocker).
- Final voice pick **by ear** from the bake-off artifacts in the landing packet; provider swap is config-only.
- **Reconcile the `legal-assinatura` PRD with the final block's signature policy before the follow-up run.** The PRD already covers CMD/SCAP with the professional Advogado attribute and notes Portaria 350-A/2025 (qualified signatures required on peças processuais, plus a cryptographic-hash requirement from 1 January 2027). Confirm the two documents agree on where the human ceremony sits; if they diverge, the final block's policy wins and the PRD is amended.
- Further operator items live in the security file's preamble.

---

## 3. Part A — Unified exploration and decision memos

Read-only first; one markdown analysis per track. Prior attempts exist — dig, don't assume.

1. **Automations layer**: what can the automations area invoke today? Does an "ekoa action" primitive exist? Can automations drive apps already? Include a **browser-context topology inventory**: where do automations' Playwright/browser contexts actually run today (hosted path? local path?), reported as plumbing topology only.
2. **Demos/tutorials salvage**: step schemas, highlight/spotlight mechanics, anything reusable as the tour format.
3. **Knowledge area hooks**: can indexing be triggered mid-build-run, or does it need a new hook? What is the org-scoped retrieval path an assistant would use?
4. **Internal templates archaeology**: where the build pipeline gets its scaffold post-hardening; where artifact structure is encoded in agent instructions; **measure the structural-instruction token tax per build** (the baseline Part D must beat); where the smarter-builder internal-bases decision was dropped.
5. **Integrations → automations routing**: do integrations invoke browser automation today, and through which path? Where would a single shared consumption seam sit? Report plumbing only.
6. **Chat page inventory**: current SidePanel shape (`sessionJobs`/`sessionPreviews` keying), welcome/example cards, AnimatePresence width morphs — inputs to the Part B structural decisions.
7. **Voice reuse verification**: confirm presence and shape of `agent-garrison` `fittings/seed/deepgram-voice`, `web-channel-default/ui/voice-machine.ts` and `voice-capture.ts`, and the `feat/local-voice-jarvis` artifacts (iOS kit, `graceWindowMs`, confirmation gate, standby, `speakable-numbers-pt`).
8. **Portal connector audit (read-only; Citius first)**: the existing Citius integration is reported as working but suspected incomplete. Inventory what it actually does today: which portal surfaces it touches, what it retrieves vs. submits, how it gets in (public area? session? something else — report the *shape* only, not a mechanism design), how results are normalized and where they land, and what breaks when it breaks. Repeat briefly for any other portal-touching code found (Portal das Finanças, registos, RCBE, DGSI, DRE). **Decides:** for each connector, rebuild vs. extend in the follow-up run; which parts are public-tier and can move into Part E now; whether the current normalization shape can serve as the Part E record shape or should be replaced. **Deliverable:** one markdown table — connector, surfaces touched, retrieve/submit, public vs. signed-in, normalization shape, verdict (extend / rebuild / promote to Part E). Read-only: no live portal calls with real credentials, no changes to existing connectors in this track.

**Decision memos (decide-and-document; no mid-run stop).** One memo per decision, recommendation + evidence, committed to run docs and flagged in the landing packet:

- Registry: extend the existing primitive vs build the registry and migrate automations onto it. Prior lean: registry as foundation, automations migrate — confirm or kill.
- Tour format: reuse salvage vs new declarative schema.
- Base template set: lightest viable (prior: `app` + `document` for v1; others only if the token-tax measurement justifies).
- Part B structural decisions A–F (criteria in §4).
- Part C voice decisions (defaults pre-loaded in §5; deviate only with evidence).
- Audit-event shape: voice turns and app actions land in the same activity-log substrate — one event vocabulary, decided once here, extended per part.
- Meter forecast: if the full run clearly cannot fit, the memo proposes the split point (the natural one: Part F becomes its own run).

---

## 4. Part B — Unified chat layout: summary cards + sheet panel

The `/chat` page currently has two layouts: full-width transcript in chat mode, and a ~380px chat rail + SidePanel in build/integrate modes. This part unifies the page on the second grammar for all modes: the transcript rail holds the conversational envelope (user messages + assistant summary cards), the right panel holds the deliverables. In chat mode the deliverable is the reply itself, rendered as a "sheet." Everything below ships together, including reply editing.

**Locked decisions (not open for re-litigation):**

1. **One layout, all modes.** Rail left, panel right. Mode changes swap panel content, never restructure the page. The AnimatePresence width morph goes away.
2. **Panel always present once the conversation has content.** Only exception: blank conversation — full-width welcome/composer, panel enters on the first reply. `sessionHasPreview` stops being the presence condition.
3. **Every assistant reply renders as a summary card left and a full sheet right.** No inline-vs-panel threshold. Consistency over click-saving.
4. **Sheets pile in the panel** as a scrollable feed, newest at the bottom, auto-follow on new content.
5. **The sheet is the unit of work, not the unit of message.** A follow-up either revises an existing sheet in place (new revision, scroll-to + brief highlight, no new sheet) or creates a new sheet. Multiple transcript cards can point at one sheet.
6. **Editing target is visible, not inferred silently.** When a sheet is the active target, the composer shows a dismissible chip (PT-PT: `A editar: <título da sheet>`). Sent messages default to revising the chip's sheet; dismissing forces a new sheet. Intent sets/clears the chip automatically; the user can always override.
7. **Latest revision is canonical context.** History sent to the model uses each sheet's latest revision; originals retained (revision history), never sent as duplicates.
8. **Summary generation never touches the main agent prompt.** A separate Haiku call after run completion delivers its own SSE event. While streaming, the card shows a truncated first-line placeholder.
9. **Mobile unchanged**: rail + FAB overlay; the sheet feed becomes the overlay content.
10. **Short replies are not decorated with filler.** Subtle "desk" surface; sheets with defined edges; typography scales with length (short = display, medium = article, long = dense document). Consistent sheet footer: provenance (`memoriesUsed`/`traceId` exist on message metadata), actions (edit, copiar, promover), 2–3 suggested follow-ups. **Delta for this run:** the footer action list is extensible — Part C adds `ouvir` (read aloud).

**Open structural decisions — resolve in planning; criteria over choice:**

- **A. Panel host shape.** Must host at least: sheet feed, preview, files, output, versions. Options range from a discriminated-union `panelContent` in the orchestration store to a small registry of panel views. Criteria: sheet feed and build views coexist in one session without per-mode special-casing; adding a future content type touches one place; no new Zustand store if extending the orchestration store suffices. Lowest tier that meets those.
- **B. Sheet ↔ message data model.** Sheets need identity, title, ordered revisions, back-references from messages. New collection in cortex persistence vs derived structures over the session message log with sheet/revision metadata. Criteria: revisions survive reload; the canonical-context rule is one clear, testable function in prompt assembly; near-zero migration (old sessions may render one sheet per assistant message, no backfill).
- **C. Revision storage.** Reuse VersionsPanel/artifact versioning only if it genuinely reduces code; do not force sheets through artifact-instance machinery for symmetry. A plain revision array on the sheet record is acceptable.
- **D. Continue-vs-new classification.** Extend `classifyLocalFallback`/conversation-types, or a dedicated cheap heuristic (imperative edit verbs + no new subject → keep chip; explicit new-topic markers → clear), Haiku tier only if the local heuristic proves insufficient. Criteria: chip state set before or as the message sends; wrong defaults tolerable because the chip is visible and overridable — do not gold-plate.
- **E. Summary event contract.** Suggested SSE event `reply_summary` `{sheetId, revisionId, title, summary}`; Haiku call as a post-run hook near memory auto-extraction. Criteria: card degrades gracefully on summary failure (keeps first line); revision-turn summaries describe the change (e.g. `Revisão 3 · tom mais formal`) — pass the diff or edit instruction to Haiku, not the whole reply.
- **F. Blank-conversation transition.** Panel enters on first send vs first streamed token. Criteria: no layout jump while typing; welcome/example cards relocate somewhere sensible, not duplicated.

**Scope.** Frontend: layout unification, panel host, sheet feed with desk/sheet rendering and length-scaled typography, summary cards (streaming placeholder → final; revision cards focus their sheet), composer chip with auto set/clear + dismiss, in-place sheet editing producing revisions with revision navigation, auto-follow + scroll-to-highlight, i18n both locales (PT-PT conventions: o seu/a sua, ecrã, por omissão; sem travessões), settings only where genuinely warranted. Backend: sheet/revision persistence per B/C; canonical-context assembly as a single well-named unit-tested function; `reply_summary` hook + SSE; edit endpoints recording who/when/what (activity-log surfacing out of scope here).

**Out of scope:** Registo UI, promover flows beyond a stub action, automations/channels rendering changes, any Ekoa OS concepts.

**Proof:** one session exercising plain Q&A (short + long), a message-drafting flow with three successive edits landing on one sheet with three revisions, chip dismiss creating a new sheet, a build-mode turn in the same session showing panel coexistence, reload restoring everything, mobile FAB overlay with the sheet feed. Unit tests on canonical-context assembly. Summary-failure path verified.

---

## 5. Part C — Voice (depends on Part B; do not start before B lands)

**Product stance.** Voice is a **modality on the unified chat page**, not a separate experience. The full chat stays visible; no condensed voice screen. The agent behind voice is the same Ekoa agent with full thinking, tools, and long-running tasks — replies are not shortened, reasoning is not reduced. Voice replies are ordinary replies: summary card + sheet as in Part B; the spoken stream is an additional output path. Output shaping only: no tables/code/images/markdown in what gets spoken (agent behavior + sanitizer before TTS).

Two modes:

| Mode | Capture | Send | Read aloud |
|---|---|---|---|
| **Manual** | Tap mic start/stop | Explicit | Only on demand — `ouvir` action in the sheet footer |
| **Talking** | Tap once, hands-free loop | Silence endpointing auto-sends | Always, streamed; barge-in supported |

Languages: pt-PT, pt-BR, en. Auto-detect spoken language; reply in it. One fixed voice per language. Non-goals: wake word, speech-to-speech models, user voice selection, per-user acoustic training, Web Speech API (banned), voice on the marketing site.

**Reuse (verified in Part A):** garrison deepgram-voice fitting → Cortex voice relay module (`/stt`, `/tts`, WS `/stream` with `utterance_end_ms`, WS `/tts-stream` with `clear` for barge-in, per-stage latency JSON logging; no separate daemon in hosted multi-tenant). `voice-machine.ts` pure reducer (rename modes to talking/manual; keep reducer/effects split). `voice-capture.ts` AudioWorklet capture (getUserMedia → AudioContext → pcm-downsample worklet → 16 kHz linear16 → WS; secure-context gating with clear messaging; replaces any MediaRecorder path). Jarvis branch: iOS kit, adaptive endpointing, confirmation gate, standby, `speakable-numbers-pt`. The local Whisper model is NOT taken. Dropped: all local-model/GPU paths, wake word.

**Architecture.** Browser (mic → worklet → PCM; Silero VAD via vad-web WASM; level meter; state machine) → WS `/api/voice/stream` → Cortex voice relay → Deepgram STT; agent reply text via normal SSE (pipeline unchanged); audio frames back via WS `/api/voice/tts-stream` → per-language TTS provider. API keys live only in Cortex. Multi-tenant: every session attributed to org + user; STT minutes and TTS characters metered per org. Activity log: a voice turn logs like any agent action, `source: voice`, final transcript; raw audio is transient — relayed, transcribed, discarded, never persisted. Transcripts persist as normal chat messages under the three-posture persistence policy. No GPU anywhere; the only scaling dimension is concurrent WebSockets.

**STT.** Deepgram Nova-3 multilingual (`language=multi`): Portuguese + English with code-switching in one stream, per-turn language identification for the reply voice. Per-user vocabulary: a per-user correction dictionary in Firestore (built when a user edits a transcript before sending), injected per request via keyterm boosting; requests are stateless — nothing one user says can influence another's transcription, by construction; no fine-tuning, no per-user cost. Verify at build time: keyterm language coverage for Portuguese on Nova-3; if English-only, the dictionary applies to `en` turns and Portuguese waits for Deepgram. Upgrade seam (not v1): Deepgram Flux end-of-turn probability slots into the endpointing input. Benchmark fallback only: GPT-Realtime-Whisper (~2× price, no needed feature).

**Endpointing (decided): adaptive grace window** — `graceWindowMs(eot, {minMs: 1500, maxMs: 6000})`. Finished-sounding sentence sends after 1.5 s; mid-thought pause waits up to 6 s; unknown uses the midpoint. eot source v1: Deepgram `utterance_end` + interim punctuation heuristic. Escape hatch: on-screen "send now" tap while listening — never make the user wait for a timer.

**Noise/distance/whisper — layered:** (1) getUserMedia constraints: `echoCancellation: true` (first defense against TTS triggering the mic), `noiseSuppression: true`, `autoGainControl: false` on mobile (AGC ramps gain during pauses and amplifies background), **on** for desktop (decided). (2) Silero VAD gate (vad-web ≥0.0.30): threshold tuned low enough for whisper; minimum-speech-frames rejects short distant bursts. (3) Confirmation gate (generalized barge-in pattern): speech-start opens a candidate, confirmed after ~300 ms sustained, short burst cancels; used for barge-in during TTS and for arming capture in noise. (4) Nova-3 does final discrimination. Honest limits, do not oversell: loud speech 1–2 m away will transcribe; café noise and voices ~10 m mostly will not. Speaker enrollment/diarization is later, out of v1.

**TTS.** Aura-2 has no Portuguese, so Portuguese needs a second provider behind the same interface:

| Language | Candidates | Notes |
|---|---|---|
| en | Deepgram Aura-2 (already in the fitting) | lowest integration cost, streaming + `clear` built |
| pt-PT | **Google Cloud TTS pt-PT** (prior), ElevenLabs multilingual (quality ceiling), Azure Neural (documented fallback only) | Google is the prior: already on GCP (bazinga-491610), one billing surface, one IAM model, no new vendor; same price band as Azure |
| pt-BR | Google Cloud TTS pt-BR | same provider as pt-PT to keep one integration |

**Vendor policy (decided): prefer Google services wherever a Google option exists and is comparable.** Rationale: Ekoa already runs on GCP; consolidating avoids a new vendor relationship, a second billing surface, and a second IAM model, and it aligns with the KMS work in the final block. **Azure is avoided.** This policy applies beyond TTS — any future vendor choice in this run defaults to the Google option unless a documented criterion rules it out.

**Bake-off (decided handling for unattended run):** render 3 real Ekoa-style replies (numbers/dates/currency; long; short confirmation) per candidate; the run makes a **provisional pick by measurable criteria** — time-to-first-audio, number-rendering correctness (verify by STT round-trip on the rendered samples), cost — prior: **Google Cloud TTS**. Escalation rule: if Google fails a measurable criterion, the run records the failure and falls back to **ElevenLabs** (quality ceiling, no vendor-consolidation conflict); Azure enters only if both fail, and only as a documented memo for the operator, never as a silent pick. Final pick is by operator ear from the landing-packet artifacts — naturalness is not measurable in an unattended run and is explicitly deferred; `tts_provider` is config behind the `/tts` + `/tts-stream` contract, so swapping never touches the client. Text pipeline before synthesis: sanitizer (strip markdown/code/tables, belt-and-braces) → `normalizeNumbersPt` / en equivalent (PT-PT forms like "dezasseis") → sentence chunking for streaming playback. Voice context to the agent: when a voice session is active, append a small system note — replies will be read aloud; natural spoken prose; if the answer includes visual artifacts, say what was produced. Does NOT shorten replies or reduce thinking. Long agent runs (decided): brief opening status line, then standby silence until the reply — no periodic narration.

**Mobile/iOS checklist (field-tested; all mandatory):** audio unlock synchronously inside the tap handler before any `await`; `ctx.resume()` defensively on every state change; never hardcode sample rate (iOS locks AudioContext to 48 kHz; worklet downsamples to 16 kHz); TTS playback via decoded AudioBufferSourceNode per sentence (MediaElementSource plays silent on mobile Safari); well-formed WAV headers (iOS Safari strict); AGC off on mobile; secure context messaging kept; screen lock/backgrounding kills the mic → reflect state honestly, **manual** one-tap resume on return (decided); **standby** instead of teardown while the agent works — mic+VAD alive but dormant, instant wake, and barge-in during processing captures a **pending note** appended to the running turn ("e verifica também o prazo X").

**Barge-in (decided): ship it in v1 talking mode** — built and tested in garrison.

**Cost/metering (decided):** v1 ships **ungated** streaming (capture open = billed, ≈ $0.46/h talking) behind full metering; VAD-gated frames (≈ $0.08–0.12/h) is v1.1 — gating interacts with endpointing and is the easiest place to introduce clipped-first-words bugs; do not build it now. TTS ≈ $0.01–0.02 per typical reply; manual mode costs almost nothing. Metering: `voice_stt_ms` and `voice_tts_chars` per org per session as **separate counters** (decided; no token conversion). **Shared surface:** these counters and Part D's assistant-turn metering extend the same billing ledger — one coherent schema, ideally one migration; planning decides shape (criterion: no duplicate ledger concepts).

**pt-PT vs pt-BR (decided): locale-only** resolution v1 (org/user locale default); no transcript heuristic.

**Validation:** port the reducer unit tests (Node, zero mocks — keep it that way). Device matrix: iPhone Safari, Android Chrome, desktop Chrome/Safari. Scenario matrix: quiet room, café, street with wind, whisper, second person at 2 m, second person at 8–10 m. Language matrix: pt-PT, pt-BR, en, one code-switching turn. Long-run: talking mode through a 2-minute agent task with standby + pending note; 10-minute inactivity timeout. Latency instrumentation kept and dashboarded: audio_in → first_interim → utterance_end → agent_first_token → tts_first_audio.

---

## 6. Part D — App operator (former operator phases 3–8; exploration/memos already in Part A)

**The product:** every Ekoa-built app ships with a dedicated assistant — an operator bound to that app, stating its three capabilities on first open: **automate the app** (drives the UI itself through JavaScript, visibly — not browser automation), **teach the app** (guided tours with highlights and narration; user can take over anytime), **answer the domain** (grounded in indexed client documents, citing sources). A fourth capability (change the app) is gated and built in Part F; users get a request-changes path there. Commercially: every end user becomes a token consumer; tours are free (canned), LLM turns are metered. Non-app artifacts do not get the operator.

**D1 — Internal templates: structure as content.** Bases carry invariants; instructions carry judgment. A base is a directory of files, agent-selected, dropped in a conventional location — same philosophy as skills/recipes, no new machinery. Base registry (directory convention + loader); agent base-selection in scoping/build. The **app base** is the strategic one: action-registry runtime, assistant panel mount, protocol client, design-token link, error boundaries live there — building it here makes D2–D3 ship inside every future app for free. Migration: move structural boilerplate out of instructions into bases; delete migrated instruction content (**measured** shrink vs the Part A baseline, not asserted). Every base ships a manifest; per-build verification asserts manifest files were replaced/extended by generation (permanently closes the F16/F28 failure class). Structure is **copied** (no inheritance propagation — prior decision stands); design tokens stay served by reference. **Gate:** J3 probe passes with a base-built app; verifier fails a deliberately untouched-base build; instruction-token reduction recorded in the landing packet.

**D2 — Classifier + action registry.** Classifier: the scoping skill gains an artifact-type gate — app vs presentation/report/document; only apps get the operator. (The classifier output will later feed a gate in Part F; do not wire it here — `can()` seam.) Action registry: a typed manifest emitted at build time — `navigate(route)`, `setField(id, value)`, `toggle(id)`, `select(id, option)`, `highlight(selector)`, `startTour(tourId)`, plus app-specific actions the generator registers per component. Actions dispatch through the app's own state layer — the same events a human interaction produces — so validation and business logic always apply and the assistant can never reach states a user couldn't. Thin client runtime ships in the app base; the Cortex-side assistant receives the manifest as tool definitions. Destructive actions (submit/delete/send) carry a manifest flag and a client-side confirmation step (UX concern here; the other dimension is asserted in Part F). Every action logs to the global activity view. **Test-harness dual use:** expose the registry to the tester agent so journey probes for built apps drive the real action layer. **Gate:** a generated sample app's registry round-trips — Cortex issues actions, UI visibly executes, activity rows land; a destructive action prompts confirmation.

**D3 — The assistant panel (operate / teach / answer).** Side panel inside every generated app (mounts from the app base). Non-blocking by construction: actions flow through normal state dispatch; visible cursor/glow while the assistant drives; **any user input immediately pauses it** — never fight the user for a field. First-open message states the three capabilities with example prompts ("Mostre-me um tutorial", "Dê-me uma visão geral da aplicação", app-specific examples generated at build time). PT-PT copy rules on all lawyer-facing strings. Three request modes: **do it for me** / **show me** (drives with highlights + narration) / **teach me** (user drives, assistant coaches); mode inferred from phrasing, switchable. Domain answers cite their source (knowledge entries) — every answer explained, consistent with the trust layer. **Gate:** scripted conversation exercises all three modes; pause-on-user-input asserted; a domain question returns a cited answer from indexed content.

**D4 — Tours (zero-token teach path).** Declarative tour scripts (route, selector via registry IDs, text per step) **generated at build time**: at minimum "overview" plus one per main journey. Playback client-side, zero tokens; the LLM engages only for ad-hoc questions and freeform automation. Reuse Part A track-2 salvage. **Gate:** overview tour plays end-to-end on a generated app with highlights matching real elements after a rebuild (selector stability via registry IDs, not DOM paths).

**D5 — Knowledge-during-build.** When the scoping agent detects a domain-heavy app, it asks where the knowledge should come from, requests uploads, indexes into the org's knowledge area, and **narrates that it is doing so** during the build. The app's assistant retrieves from that org-scoped knowledge; answers cite entries. Client sign-off on the indexed set becomes part of the Studio delivery ritual (process note, not code). **Gate:** build a sample fees app with seeded docs; the assistant answers a fees question with a citation into the seeded content. (Isolation assertions live in Part F.)

**D6 — Metering + polish.** Every assistant LLM turn metered and attributed (extends the same billing ledger as Part C's counters; billing-truth probe extended to assistant turns). Tour playback and registry-only actions: free. Panel performance budget: lazy-load the panel, no blocking work on the app main thread; assert with a simple perf check in the app base. **Gate:** billing arithmetic probe green including assistant usage; sample app perf delta within budget with the panel mounted.

**Non-goals (do not pull forward):** Cortex Gateway module (parked). Explainer variant for non-app artifacts. User-facing template resurrection (artifact-only primitive with fork-on-open stands). Scheduling/recurring surfaces in lawyer-facing copy. Real browser automation for the assistant — registry-first; a hard blocker is a memo for the operator, not a unilateral pivot. Per-app login systems.

---

## 7. Cross-cutting rules (all parts)

- PT-PT conventions in all user-facing strings (o seu/a sua, ecrã, por omissão, sem travessões); i18n both locales.
- Lowest viable tier everywhere. No plugin systems, no generic abstractions ahead of need, no speculative settings, no new global state containers if extending the orchestration store suffices. A sheet is markdown with metadata until proven otherwise; typography scaling is breakpoints and CSS, not a layout engine; the continue-vs-new heuristic starts local and dumb.
- One activity-log event vocabulary across voice turns and app actions (Part A memo), extended per part.
- Journey suite green at every checkpoint; J3 probe after anything touching the build pipeline.

## 8. Part E — Portal connectors, open-data tier

Several high-value legal data sources require **no sign-in at all** — retrieval is public or by a client-supplied access code — so they are pure data-plane work, safe for this run's model policy and independent of Parts B–D. They give the dossiê model its first external feeds, turning the external-system badges from the BSM workflow analysis into live data.

Scope (anything that requires signing in is out of this part by definition):

1. **Certidão permanente comercial** — retrieval by access code; parse into a structured company record plus the document itself, attached to the dossiê.
2. **Certidão predial permanente** — retrieval by access code; structured property record.
3. **Certidões do registo civil** — retrieval by access code where available.
4. **Publicações de insolvência (Citius, área pública)** — polling watcher; watch NIFs/names per dossiê; emit a dossiê event on match ("nova publicação para a contraparte X").
5. **DGSI / DRE** — verify existing paths still hold post-hardening; no new build unless broken; DGSI citations remain verified-only, never invented.

Shape rules: one normalized portal-document record (source, type, subject identifiers, retrieved-at, file ref) and one portal-event record for watcher hits — lowest viable tier; the later signed-in connectors **extend** these shapes, they do not redesign them. Access codes are client-supplied dossiê data — ordinary fields, not secrets.

**Gate:** one dossiê receives a comercial certidão by code and one watcher event end-to-end, both rendering in the dossiê; PT-PT strings throughout.

**Run 2 note:** the signed-in portal connectors (Citius rebuild, Portal das Finanças, BNI, RCBE, IRN services, and the rest of the prioritized map) are a **separate follow-up brief** after Part F lands and merges — they depend on it, and they need attended validation against real portals, which conflicts with this run's synthetic-only rule.

## 9. Part F — final block (separate file)

Open `ekoa-mega-run-security-block.md` only after Parts A–E land (or after the meter decision to stop). It contains its own preflight, sub-blocks F0–F5, an ordering rule, and its own proof gates. The expected model switch happens there.

## 10. Ordering and meter strategy

**A → B → C → D → E → F.** B is the spine after A; C requires B; planning may reorder C, D, and E with a documented rationale, but B always precedes C, and A's track-8 audit always precedes E (it decides E's record shape and what gets promoted into E). **E is the meter shock absorber**: it depends on nothing downstream and nothing depends on it within this run, so it is the safest part to drop whole if the forecast tightens — dropping it costs a follow-up brief, not a rework. Slices atomic and tagged throughout; a partial landing leaves a coherent branch. Merge posture for the operator's review: B, C, and E are merge-safe standalone; D without Part F leaves `can()` stubs — likely hold on the branch until the block lands (operator decides). Part F sub-blocks follow the rule stated in that file: never start a sub-block the meter cannot finish; if the block cannot start at all, it becomes the next run in its entirety.

This is the largest run attempted; the two-file structure and part atomicity exist precisely so any landing point is coherent. If Part A's meter forecast says the whole scope cannot fit, the forecast memo proposes the split.

## 11. Landing packet additions

Decision memos; **portal connector audit table (track 8) with per-connector verdicts**; instruction-token reduction delta; TTS bake-off artifacts + provisional pick + round-trip numbers + any escalation record; first latency-dashboard numbers; per-part gate evidence; merge recommendation per part; Part F additions per its file (if reached).

## 12. Open items ledger (merged; not run blockers)

- One run vs split fallback (Part A forecast memo decides the proposal; operator decides the reality).
- Static request-changes affordance outside the assistant panel.
- Assistant model/effort tier per mode (domain Q&A vs action planning) — prefer the cheapest tier that holds quality; cost/quality memo material for a later pass.
- Pricing shape for metered assistant usage (pass-through vs bundled) — commercial, not run scope.
- Explainer variant for documents/reports — later.
- Voice: Flux endpointing upgrade seam; VAD-gated streaming (v1.1); speaker enrollment/diarization (later).
- Sheet `promover` flows beyond stub — later.
- Cofre UI polish debt, if any, flagged for a later Fable pass (see security file).
- **Follow-up brief: signed-in portal connectors** (Citius rebuild-or-extend per track 8, Portal das Finanças, RCBE, BNI, IRN services, AIMA/SEF and the rest of the field-derived external-system map). Blocked on the final block landing and merging; requires attended validation against real portals, which this run's synthetic-only rule forbids. Track 8's audit table is that brief's primary input.
