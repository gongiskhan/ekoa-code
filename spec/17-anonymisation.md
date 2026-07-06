# 17. Anonymisation layer

This chapter fixes the layer that stands between the LLM chokepoint and Anthropic and guarantees that no detected sensitive value crosses that boundary in cleartext. It specifies the request pipeline, the detectors, the deterministic per-session tokenization and its in-memory vault, the metadata-only audit, the location-agnostic service interface, the synthetic-only test data and payload-capture harness, and the claims ceiling every string in the product must stay under. Ground truth for design intent is the Ekoa Local v2 brief (docs/, sections A1, A3, A6 decisions D1-D6, A7.4); provenance for building it in this run is the amendment brief (docs/ekoa-code-spec-amendment-brief.md, Part 3). The layer lives inside the one module that owns the Anthropic client (FIXED-13); chapter 06 keeps attribution and metering, this chapter keeps anonymisation. The visual companions are diagram 06 (the pipeline stages within the chokepoint) and diagram 10 (`10-privacy-boundaries`: the two trust boundaries and what crosses each and in what form). FIXED-12 binds: a structural change to this flow updates both diagrams in the same unit of work.

Amendment record: this chapter is new, added 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md).

## 17.1 Purpose, provenance, and placement

**What changed, and why it is FIXED.** The founder's original FIXED-8 carried "anonymisation chokepoint on egress (Presidio integration point) preserved" - a seam, an interface point, nothing built behind it. The amendment (docs/ekoa-code-spec-amendment-brief.md, Part 3) replaces that clause. FIXED-8 as amended reads: **anonymisation layer built in this run as part of the egress module (chapter 17)**. The seam becomes a mechanism. This chapter is the specification of that mechanism.

**The privacy premise (v2 A1, load-bearing).** Two trust boundaries exist and every line of design, code comment, UI string, and doc must keep them distinct (diagram 10):

- **Boundary 1 - the user's machine to Cortex.** File excerpts read by the local loop cross this boundary in cleartext, transiently, inside completion requests, because Cortex must see cleartext to detect. Nothing crosses it at rest.
- **Boundary 2 - Cortex to Anthropic.** Everything crossing this boundary passes the anonymisation layer specified here. Detected sensitive spans cross only as tokens.

This layer is the enforcement of Boundary 2. Its supporting invariants, carried verbatim from v2 A1: **I3** - a single egress chokepoint that every model-bound payload passes before Anthropic, no bypass path, enforced structurally not by convention; **I5** - the token-to-value map (the vault) never leaves Cortex and is never included in any payload to Anthropic; **I6** - only the claims of section 17.9 are made anywhere.

**Placement decision: an own chapter, not a chapter 06 extension.** The amendment left the placement to this run's judgement (Part 3, "Add a chapter or a major chapter 06 extension - session's choice, state it"). This spec specifies the layer as **its own chapter** because it has its own request pipeline (17.3), its own data of record (the vault, 17.5), its own audit surface (17.6), its own test harness (17.8), and its own claims surface (17.9) - none of which chapter 06 owns. Chapter 06 keeps what it always owned: attribution, metering, and the bill. FIXED-13 makes the two concerns **one module**; this spec keeps them **two chapters**. The reader who wants to know who pays reads chapter 06; the reader who wants to know what crosses Boundary 2 reads this one; both describe the same `api/src/llm/` code.

**Not to be confused with two neighbours in the same egress path.** (a) The provider-leak error-sanitiser (chapter 09 Invariant 2; reference/carryover-audit.md A7) scrubs the strings "Anthropic"/"Claude"/provider-auth text out of messages travelling **Cortex to user** - it protects a brand secret on the response path and encodes a production incident. This anonymisation layer scrubs **client PII out of requests travelling Cortex to Anthropic**. Opposite directions, different data, both carried. (b) The old `memory/anonymizer.ts` (53 lines, regex PII strip, zero production call sites; reference/carryover-audit.md A7; reference/invisible-behaviors.md conflict 15) is dead code and a drop candidate - it is not the seed of this layer and shares none of its design. There was never a Presidio integration in the old source (verified zero grep hits; reference/carryover-audit.md A7); this chapter builds the layer from the v2 brief, not from carried code.

## 17.2 The egress module: one module, three concerns (FIXED-13)

**FIXED-13 (new register entry).** One egress module, three concerns. The LLM chokepoint (`api/src/llm/`) is simultaneously: attribution + metering (chapter 06), the anonymisation pipeline (this chapter), and provider routing config (provider base URL, region, zero-retention posture as configuration, never hardcoded). Nothing else may import or instantiate the Anthropic client - lint/dependency-enforced; subprocess paths (Agent SDK spawns) are pointed at the chokepoint via base URL/env so their traffic funnels through it.

**Why anonymisation must live inside the module, not beside it.** I3 requires that no model-bound payload can reach Anthropic without traversing the anonymisation step. FIXED-3 already guarantees there is exactly one such path - model at the edges only, one chokepoint, every Anthropic call through it - so the only way to make anonymisation structural rather than conventional is to place the step on that single code path that owns the transport. The pipeline of 17.3 is therefore a submodule of the chokepoint (for example `llm/anonymize/`), invoked by `llm/client.ts` after the caller's payload is assembled and before any Anthropic request is issued, and again on every response and streamed delta before the caller sees it. A caller cannot skip it because a caller cannot reach the transport (chapter 06 section 6.2: `llm/client.ts` is the only file that touches Anthropic transports).

**Structural enforcement (restated from chapter 02 section 2.9 and chapter 06 section 6.10, extended here).** The import ban (`no-restricted-imports` on `@anthropic-ai/*` outside `api/src/llm/**`) and the grep gate (CI fails on `api.anthropic.com` or `@anthropic-ai/` outside `api/src/llm/`) already guarantee that every SDK client and every raw fetch is inside the module. This chapter adds one consequence: because those gates prove the transport is inside `llm/`, and `llm/client.ts` invokes the anonymisation stage on every entry point, the property "every model-bound payload is anonymised" is enforced by the same two gates plus a unit test that asserts each chokepoint entry point (section 6.2.1: `runAgent`, `runOneShot`, `completeFast`, `proxyGatewayMessages`) routes its outbound payload through `anonymize` before the transport call.

**The Anthropic-callsite inventory (build deliverable, in docs).** Structural enforcement is only true once every existing route to Anthropic is accounted for. The run produces, as a documented deliverable, an inventory of every callsite that can reach Anthropic: each SDK client construction, each raw `fetch` to `anthropic.com`, and each subprocess spawn that carries provider env (the Agent SDK / Claude Code spawns). Each row records its **routing decision**: either it is called through the chokepoint (in-process paths), or it is pointed at the chokepoint via base URL / env so its traffic funnels through it (subprocess paths - the SDK subprocess env builder of chapter 09 Invariant 4 injects the managed token and the chokepoint base URL). The inventory and the per-callsite decision are the acceptance artefact for I3 (v2 A3.1).

**Origins covered.** The layer sits at the point every origin already converges on, so it covers all of them uniformly:

- **Web-UI chat** - user and tenant data in prompts and message history.
- **Integration-sourced content** - SharePoint, Drive, database rows entering agent context.
- **Bridge provider requests** - the local Pi loop (including the TUI) calling Cortex-as-provider over the bridge; these carry the file excerpts of Boundary 1 and are the reason the layer exists at all (chapter 18).
- **Internal / platform AI calls** - covered by the same stage for completeness, but **the launch posture has none at runtime**: chapter 06 section 6.4.3 eliminates all six platform-attributed call sites, and the runtime platform-call counter reads zero at launch. The stage covers this origin so that any future platform call added later cannot bypass it; it is not a live origin at cutover.

The full 27-site accounting is chapter 06 section 6.4; this chapter does not restate it, it consumes it.

## 17.3 Pipeline per request

For every request the chokepoint is about to send to Anthropic, and for every response and streamed delta it receives, the pipeline runs the following steps. They are faithful to v2 A3.2; the numbered contract is normative.

1. **Collect** all model-bound text in the outbound request: system-prompt segments that contain user or tenant data, the message-history delta (new turn only, see 17.5), tool definitions if they embed data, tool results re-entering from the previous turn, and attached or extracted document text.
2. **Detect** sensitive spans (17.4) on the **delta only** - never on the already-tokenized prefix (17.5 explains why this preserves prompt caching).
3. **Tokenize** - replace each detected span with a deterministic, format-preserving token, and record the value-to-token mapping in the session vault (17.5).
4. **Forward** the tokenized request to Anthropic, tagged with the per-request correlation id (17.6).
5. **De-tokenize the response** before returning it to the caller, and this **includes `tool_use` blocks**: token values that appear inside tool-call arguments must be restored to their cleartext, or the local loop will grep and edit for placeholders that do not exist on disk. `tool_use` blocks are buffered whole before de-tokenization (pragmatic, correct, low-latency in practice). Tool **results** are not de-tokenized here; they re-enter at step 1 on the next request and are re-tokenized like any other new content.
6. **Stream** - text deltas are de-tokenized incrementally, buffering only the minimum needed to reassemble a placeholder that straddles a chunk boundary; `tool_use` blocks are buffered whole (per step 5). A user Stop during a streamed, partially de-tokenized response propagates as a typed abort and never resolves into a synthesised completion (CONV-5; chapter 06 section 6.2.1).

**Fail-closed.** The pipeline never forwards a payload it could not process through the mandatory detectors. If the structured-ID and deny-list detectors (17.4 (a) and (b)) are unavailable, the request is **refused, not forwarded un-tokenized**, and the refusal surfaces through the chapter 03 error envelope (CONV-2). The NER head (17.4 (c)) is the sole exception: it is best-effort and (a)+(b) must not depend on it, so an NER outage degrades recall but does not fail the request - the reduced coverage is recorded in the audit metadata (17.6) and, at cutover, the claims text must match the enforced coverage (17.9; chapter 10).

## 17.4 Detection layers

Detection is layered, recall-biased, and has no human in the loop (v2 A3.3). All three layers sit behind the one service interface of 17.7, so callers never see which fired.

**(a) PT structured-ID recognizers - regex + checksum, near-certain.** NIF / NIPC (check digit), NISS, número de utente, Cartão de Cidadão, IBAN PT, and CITIUS / processo references. Each is a regex followed by the class's checksum or format validation, so precision is near-certain: a value that passes the check digit is treated as a real identifier.

**(b) Per-tenant deny-list - certain-catch regardless of NER.** The firm's client, matter, and party names, loaded as tenant configuration (17.7). Matched literally, so a known party is caught whether or not the NER head recognises it as a name. The deny-list is itself **secret-material** - it is a list of the firm's clients and matters - and is treated as such (v2 A6 decision D3): **encrypted at rest with a tenant-scoped key, access-logged, and enumerated in the custody map**. It is never sent to Anthropic; it is an input to detection only.

**(c) PT-PT NER - recall-biased, behind the same interface.** A named-entity recognition head for European Portuguese (Albertina-based, or the best available suitably-licensed PT-PT model), with its threshold tuned to **over-tokenize: when unsure, redact**. A false positive tokenizes a non-sensitive word, which costs nothing - the model reasons over a plausible fake and the caller sees the original restored on the way back. A false negative leaks real PII across Boundary 2, which is the one failure this layer exists to prevent, so the threshold is deliberately biased toward recall.

**Serving decision for the unsupervised run (NORMATIVE).** The NER head is served **in-process, on CPU, via ONNX**, using the best available suitably-licensed PT-PT model. This is normative for this run: it is what the layer ships with at cutover. Two constraints bind it. First, **layers (a) and (b) MUST NOT depend on (c) being up** - the structured recognizers and the deny-list run without the NER service and fail closed on their own if unavailable (17.3), while the NER head degrades gracefully. Second, the latency target - **added p95 ≤ ~300 ms per request** - is a **post-cutover tuning criterion, not a build gate**: the layer ships correct first, and the serving choice (in-process ONNX versus an external GPU service) is tuned against the target afterward without changing the interface. The GPU option and the legal-domain fine-tune are later tasks.

**Presidio.** Presidio is an acceptable orchestration vehicle for (a)+(b)+(c), or the implementation may be bespoke. The choice is hidden behind the service interface (17.7) and is not a spec commitment either way (v2 A3.3): the interface must not expose it.

## 17.5 Tokenization and the vault

**Deterministic, format-preserving, per session.** Each detected span is replaced by a token that preserves its format - a fake-but-plausible NIF where a NIF was, a deterministic fake person-name where a name was - so the model reasons over well-formed input. Determinism is **per session**: the same cleartext value maps to the same token for every request of that session, which is what makes prompt caching survive (below) and what lets a value tokenized in a hosted turn stay consistent when it re-crosses the chokepoint inside a delegated local turn (chapter 18).

**The checksum-collision rule.** Structured-ID fakes are **never generated with valid check digits**. A fake NIF with a valid check digit may, by construction, be a real person's NIF - minting one would fabricate a live identifier. The token therefore uses a **plausible format with a deliberately invalid checksum** (or a reserved/test range where one exists). The model does not validate check digits, so plausibility is fully preserved while collision with a real identifier is structurally impossible. This rule is normative and is asserted by the test-data generator (17.8).

**The vault: per-session, in-memory, TTL, never persisted (v2 A6 decision D1).** The value-to-token map is held in memory, per session, with a TTL, and is **never written to disk**. It is cleared on session end. This is the trust anchor of I5 and, equally, a re-identification key: a map that could turn tokens back into client identities is exactly what a production order would seek, so after session end it **must not exist** - a key that does not exist cannot be produced (v2 A6 D1 rationale; the custody argument is chapter 12's and chapter 18's to carry to the client).

**Keyed by propagated session identity.** The vault is keyed by the **hosted conversation id**, which propagates through delegation into the local loop's bridge provider requests (chapter 18). One vault therefore serves both the hosted turns and the delegated local turns of the same conversation - **one vault per conversation across both faces** - so tokens stay consistent when a local summary re-enters hosted context and later re-crosses Boundary 2. The vault never crosses either boundary (diagram 10).

**Vault lifetime criterion.** Persistence is decided (never - D1); what the run must satisfy is the lifetime criterion: **intra-session determinism must survive expected Cortex process lifetimes without writing the vault to disk**. If that forces a bound, the acceptable bound is session length - a session that outlives its vault re-tokenizes from scratch on the next turn (a cache boundary, below), never a disk write.

**Prompt caching preserved.** Caching survives for two reasons together: tokenization is deterministic per session, and detection runs on the message delta only (17.3 step 2). The already-tokenized prefix is never re-processed, so the tokenized prefix is **byte-identical across turns** and the provider cache hits. **Model switches are cache boundaries** - a new model means a new cached prefix, expected and correct. This is why the delta-only rule of step 2 is load-bearing and not merely an optimisation: re-detecting the whole history each turn would perturb the prefix and destroy caching.

## 17.6 Audit

**Metadata only, never bodies, never the vault (v2 A6 decision D2).** Every tokenization event writes one audit record carrying **detection metadata only**: the entity classes detected, their counts, the per-request correlation id, and a hash of the payload. It records **no payload bodies and never the vault**. The reason is exact and supersedes the companion design doc where it earlier said tokenized payloads are recorded: a tokenized payload still contains all **undetected** content in cleartext, so accumulating tokenized bodies at rest would quietly recreate the at-rest copy the whole architecture removes. Payloads are not the audit; their metadata is.

**Async, hash-chained, tamper-evident.** The write is asynchronous (off the request's latency path) and the records form a hash chain, so any excision or reordering is detectable. This adopts the security addendum's "cheap PROPOSED" hash-chaining option (security addendum, docs/security-addendum.md, E.1) directly, rather than registering it separately - chapter 09 states this adoption.

**Folds into the Registo single write path (FIXED-8).** The audit is not a parallel log. It writes through the one activity/audit write function (chapter 09 Invariant 3; chapter 04 `activity_logs`) as an anonymisation category, so the single-writer, Registo-ready guarantee covers it too. Registo doubling as the compliance evidence engine (security addendum E.1) therefore includes the masking record with no second mechanism.

**Payload capture for debugging is tenant-opt-in with a short TTL.** Because a captured body is cleartext-bearing, debug capture is off by default, enabled only per tenant, and expires on a short TTL. This is distinct from the test-mode payload capture of 17.8, which runs against synthetic data only.

**Correlation id.** The correlation id is **minted per provider request, here, at the chokepoint**, and propagated through delegation into the local loop so the daemon's egress ledger rows and these hosted audit records join on it (v2 I4; chapter 18 section S6). It is the join key of the trust chip (chapter 12) and the second half of the compliance story: the local ledger says what left the machine, the hosted audit says what was masked before the provider, and the correlation id stitches the two. Denials (fail-closed refusals, 17.3) are audited as well.

## 17.7 Service interface and the Garrison line

**The interface (stable, location-agnostic).** The layer is a standalone service with two entry points:

```ts
anonymize(payload: ModelBoundPayload, tenantConfig: TenantRuleset)
  : { tokenizedPayload: ModelBoundPayload; vaultHandle: VaultHandle };

deanonymize(output: ModelOutput, vaultHandle: VaultHandle)
  : ModelOutput;   // cleartext restored, including tool_use argument blocks;
                   // a streaming variant restores text deltas with straddle buffering (17.3 step 6)
```

Callers never depend on detector internals or on where the service runs. `tenantConfig` carries the loaded ruleset and deny-list; `vaultHandle` is an opaque reference to the in-memory session vault (17.5) and is never serialised into any payload.

**Location-agnostic by design (v2 A3.6, A6 decision D6).** The interface is written so the same service can later run at the edge (on the client or bridge) without a call-site change. This run builds the **hosted** deployment only; the edge tier remains a later premium option. The interface is made ready for it; **nothing is built for the edge now**. Provider routing is first-class configuration on the same module - base URL, region, zero-retention posture - so EU-region processing and a zero-retention posture are adopted by config, never by code change (FIXED-13; D6; chapter 06 owns the provider-routing config surface).

**Core versus composition (the Garrison line, FIXED-7).** The **mechanism** - the chokepoint placement, the pipeline, the vault, the audit, and this interface - is Ekoa core. The **PT-PT ruleset, the legal entity rules, and the per-tenant deny-lists** are a loaded ruleset and per-tenant configuration, not core. Portugal-legal specifics never bend the core (chapter 08's Garrison boundary): the structured-ID recognizers and the deny-list load as configuration exactly as the legal knowledge packages load as task-scoped content (chapter 08 slot 8, Q-09). A second jurisdiction's rules would be another loaded ruleset against the unchanged mechanism.

## 17.8 Test data and the payload-capture harness

**Synthetic-only test data.** Tests use synthetic values exclusively: **checksum-INVALID plausible fakes** for every structured-ID class (NIF/NISS/IBAN/processo/utente/CC), fabricated party names for the deny-list, and fabricated person names for the NER path. **Never real client data.** The checksum-invalid rule is doubly load-bearing here: a valid fake NIF in a fixture may be a real person's NIF (17.5), so the generator that produces test values is held to the same collision rule as the tokenizer.

**The payload-capture harness (build deliverable).** In test mode the chokepoint captures **every outbound Anthropic request body** before it leaves the process. The standing assertion, run across **all** scenarios: every planted synthetic value - a planted NIF, a deny-listed party name, an NER-detected name - appears **tokenized, never in cleartext, in every captured request**, including bridge and TUI traffic. This is the payload-capture assertion of v2 Phase 5 promoted to a committed harness. It runs against real model calls for the hosted scenarios and against the fake-daemon harness (chapter 18 section 18.7) for the bridge and TUI scenarios, so the "including TUI sessions" clause of the v2 gate is covered without a live daemon.

**The gate that consumes it.** Chapter 14's build sequence places an **Anonymisation layer phase** after the chokepoint core and before agent execution, and that phase's objective gate is exactly this payload-capture assertion: a planted synthetic NIF and a deny-listed party name in a chat turn produce a captured outbound payload containing tokens only, while the user-visible response is cleartext and a `tool_use` round trip acts on the real value. The same phase gates the streaming-straddle test, the prompt-cache byte-identical-prefix test, the vault-never-persisted check, and the audit-metadata-only check (chapter 14).

## 17.9 Claims discipline

The v2 brief A1 claims list is the **ceiling of truth for every string in the product** - docs, in-app UI, settings copy, onboarding, the future custody-map PDF, and any marketing input (v2 A1 invariant I6; A7.1). No surface may say more than the claimable text below or anything on the forbidden list; if a surface needs to say something not licensed here, the fix is to extend A1 with founder sign-off, never to phrase around it in a component. The following two blocks are quoted **verbatim** from the v2 brief A1 as that ceiling.

**Claimable - EN (engineering truth), verbatim:**

> "Files never leave the machine as files: no upload, no copy stored outside it; the agent works on them in place. Only the excerpts the agent actually reads transit, transiently, inside model requests, and every read is logged locally. No detected sensitive data reaches the model provider in cleartext: structured identifiers and the firm's known parties with certainty, other entities at high automated recall. Cortex processes cleartext momentarily to perform detection (processor role; DPA required)."

**Claimable - PT-PT (client-facing basis; formal register, no em-dashes), verbatim:**

> "Os ficheiros nunca saem da sua máquina: não há upload nem cópia guardada fora dela; o agente trabalha sobre eles no próprio local. Apenas os excertos que o agente lê transitam, de forma transitória e auditável, dentro dos pedidos ao modelo. Nenhum dado sensível detetado chega ao fornecedor de IA em claro: identificadores estruturados (NIF, NISS, IBAN, referências de processo) e as partes conhecidas do escritório com certeza; restantes entidades com cobertura automática elevada."

**Forbidden claims (verbatim from v2 A1; em-dashes rendered as " - ", accents and wording unchanged) - none of these strings, or any paraphrase that means the same, may appear anywhere:**

- "Sensitive data never reaches the AI/LLM" (unqualified).
- "Your data never leaves your machine" (excerpts do, transiently; under default deployment they reach Cortex in cleartext).
- "Masked before leaving your machine" (true only under the future edge deployment; never claim it for the hosted chokepoint).
- "Ekoa never sees your data."
- "The protections of arts. 75.º/76.º EOA and 177.º/180.º CPP apply to hosted data" (they are anchored to the lawyer's physical sphere; claim only that the ARCHIVE preserves their factual premise - see A6).
- "Ekoa is immune to production orders" (EU e-evidence or third-country; never claim immunity - claim minimal producible holdings, privilege-flagging, and notification instead).
- Any placement of Ekoa as "on-premises/local" in the CCBE deployment taxonomy (the reasoning layer is SaaS; the honest self-placement is defined in A6).

**The ship-gate rule (mirror of v2 A7.4).** Copy that describes a mechanism **ships only after that mechanism's tests pass**. If a string says "every read is logged" the ledger must be passing its scenario first; if it says a class of entity is masked "with certainty", the detector for that class must be green in the payload-capture harness (17.8). This is the same discipline as chapter 10's cut-line rule: **never ship claims ahead of enforcement**. Chapter 12 carries the UI-side statement of this rule for the in-app trust surfaces (trust chip, settings "Privacidade e ponte local"); chapter 14 carries it as a gate; chapter 10 checks at cutover that the enabled claims text matches the coverage actually enforced (detectors (a)+(b) live at cutover; the NER (c) coverage per its verified state).

## 17.10 PROPOSED P-27 - executor-face run-record retention (deferrable)

**PROPOSED P-27 (owner: this chapter; register of record: chapter 15).** Content-bearing executor-face run-record fields - file reads and command output captured inside automation runs - land in hosted run records by design, because visibility is the executor face's purpose (v2 A5). For file-heavy automations that turns run records into an at-rest copy of file content, which is exactly the quiet holding the privacy premise removes for the chat path.

- **Recommendation:** pass those content-bearing fields **through the detector at persist time**, reusing this anonymisation service. It keeps run records from becoming the quiet at-rest copy that violates the spirit of I1 for file-heavy automations, and reuses a mechanism already built rather than inventing a retention scheme.
- **Alternative:** mark the content fields **ephemeral with a short TTL** instead of detecting them, accepting that they exist in cleartext for the TTL window.
- **Deferrable; safe default = recommendation** (detector-at-persist). The criterion either option must satisfy (v2 A5): **run records must not become the quiet at-rest copy** that undermines I1.

Register arithmetic: P-27 is minted by this amendment (2026-07-06) and is the only pending entry in the register; it is deferrable and, if unmarked at launch, resolves by default to the recommendation. Chapter 15 carries the entry and the summary line.

## 17.11 Acceptance criteria (checkable without a human)

- **Structural enforcement present.** The import ban and grep gate of chapter 06 section 6.10 are in the scaffold, and a unit test asserts every chokepoint entry point (section 6.2.1) routes its outbound payload through `anonymize` before the transport call - so "every model-bound payload is anonymised" is machine-checked, not asserted in prose.
- **Callsite inventory complete.** The Anthropic-callsite inventory (17.2) exists as a documented deliverable, and every row carries a routing decision (through the chokepoint, or pointed at it via base URL/env); no callsite is unaccounted for.
- **Pipeline tests present and green.** Including: a `tool_use` round trip (model asks a tool to act on a masked value; the tool acts on the real value locally); a streaming placeholder straddling a chunk boundary de-tokenizes correctly; a multi-turn session shows a byte-identical tokenized prefix and an observed cache hit.
- **Vault never persisted.** A check asserts no code path writes the vault to disk, and that the vault is cleared at session end (17.5; D1).
- **Audit metadata only.** A check asserts audit records carry entity classes, counts, correlation id, and payload hash - and never payload bodies and never the vault (17.6; D2) - and that they write through the single Registo audit path (chapter 09 Invariant 3).
- **Payload-capture assertion green.** In test mode, every planted synthetic value appears tokenized, never cleartext, in every captured outbound Anthropic request across all scenarios including bridge/TUI (17.8; the chapter 14 anonymisation-phase gate).
- **Claims ceiling holds.** A grep over product copy (docs, `web/` strings, settings and onboarding copy) finds none of the forbidden strings of 17.9, and no claims-bearing string is enabled ahead of its mechanism's passing test (the A7.4 ship-gate; chapter 12 / chapter 14).
- **P-27 presented and registered.** The proposal appears in 17.10 with recommendation, alternative, and deferrable flag, and has a matching register entry in chapter 15.

Cross-references: chapter 02 (module placement, import boundaries, lint), chapter 06 (the chokepoint entry points, attribution and metering, the 27-site callsite table, provider-routing config, the section 6.10 gates - FIXED-13 makes this chapter and chapter 06 one module), chapter 04 (`activity_logs` single write path, `token_events`), chapter 08 (the Garrison line, PT ruleset and deny-lists as tenant configuration, legal packages at slot 8, Q-09), chapter 09 (Invariant 2 the provider-leak error-sanitiser as the complementary egress control, Invariant 3 the Registo single audit write path, FIXED-14 security baseline, the E.1 hash-chain adoption), chapter 10 (anonymisation go-live posture, claims-match-enforcement at cutover), chapter 12 (the in-app trust chip and settings copy that carry the claims of 17.9), chapter 14 (the anonymisation-layer build phase and its payload-capture gate), chapter 15 (P-27 register of record), chapter 18 (delegation, the bridge, session-identity propagation, correlation-id join S6, the fake-daemon harness that runs the payload-capture assertions for bridge/TUI traffic).
