VERDICT: approve

Fresh-context adversarial review of commit `b4c669b` ("feat(gateway): S2 model family mapping") against the S2 acceptance and the RUN_SPEC/BRIEF excerpts. Re-derived from the diff and my own evidence; no access to the implementer's session.

## Evidence

All commands run by me against the post-change working tree at `/Users/ggomes/dev/ekoa-code`.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS (shared + api + web, clean) |
| Named suites | `npx vitest run tests/llm/{family-mapping,gateway,gateway-stream,gateway-payload-allowlist,client,completefast-transport}.test.ts` | **6 files / 52 tests passed** |
| Full LLM suite | `npx vitest run tests/llm/` | **18 files / 168 tests passed** |
| Lint | `npm run lint` | **0 errors** (217 pre-existing warnings, none in the diff's files) |
| Chokepoint gate | `npm run gate:chokepoint` | `clean (no @anthropic-ai/ or api.anthropic.com outside api/src/llm/)` |
| Diagram integrity | `npx vitest run tests/docs/diagram-integrity.test.ts` | **13/13 passed** |
| Diagram 06 JSON | `python3 -c "import json; json.load(...)"` | Valid JSON, 60 elements, `s2-family-map-note` present |
| Diagram 06 text integrity | python check on element `s2-family-map-note` | `rawText == originalText == text` -> **True**; all 3 rawText-bearing elements consistent |

### Acceptance criteria verified line by line

| Criterion | Verified at | Verdict |
|---|---|---|
| `matchFamilyTier` exported, opus->EXPERT / sonnet->WORKHORSE / haiku->FAST | `client.ts:1026-1033` | MET |
| Case-insensitive; tolerant of `claude-` prefix, generation infix, dated suffix, `[1m]` | probe below + `family-mapping.test.ts` (12 ids) | MET |
| Resolution order: exact -> family -> FAST clamp | `client.ts:1100-1102` (`matchConfiguredTier(...) ?? matchFamilyTier(...)`, `?? 'FAST'`) | MET |
| **Strip condition keys on the COMBINED resolution, not the exact match alone** | `client.ts:1136` -> `if (resolvedTier === null)` (was `matchedTier === null`) | MET - this is the criterion most likely to be got wrong; it is correct |
| Wire model is always the CONFIGURED tier model, `[1m]` stripped | `client.ts` payload: `model: decision.model.replace(/\[1m\]$/, '')` | MET |
| Metering bills the resolved wire tier | `client.ts:1218` `meter(attribution, wireTier, decision.model, usage)`; `decideForTier(wireTier)` pairs model+weight from ONE config entry (`router.ts:179-182`), so weight/model cannot desync by construction | MET |
| `/models` lists all three tier models | `gateway.ts:246-250`; test asserts 3 rows + all three ids | MET (matches RUN_SPEC A11) |
| Tests: unit matrix + gateway integration + alien clamp + /models 3 rows | `family-mapping.test.ts`; `gateway.test.ts:104` (wire `claude-sonnet-5`, thinking forwarded, `metered: 24` = round(0.1*240) WORKHORSE); `gateway-payload-allowlist.test.ts:251` (alien -> FAST clamp + thinking/output_config stripped + `fast-clamp` logged + tier FAST) | MET |
| Diagram 06 s2 note | `docs/diagrams/06-llm-chokepoint-billing.excalidraw` | MET |

### Firewall compliance (spec: "does not touch client.ts transport internals")

`git show b4c669b -- api/src/llm/client.ts | grep "defaultTransport\|ChokepointTransport\|__setTransportForTests"` -> **empty**. The diff touches only `matchFamilyTier` (new) and the tier-resolution/strip glue inside `proxyGatewayMessages`. Sanctioned scope only. Metering remains single-writer (`meter` is the one call site, untouched).

### My own adversarial probe of `matchFamilyTier`

Compiled probe against the real exported function (temporary spec, removed after run):

```
"corpus-model"                 -> null        (safe: "corpus" does NOT contain "opus")
"my-corpus-embedder"           -> null
"text-corpus-v2"               -> null
"claude-opus-4-8[1M]"          -> EXPERT      (uppercase marker still resolves)
"claude-sonnet-4-5[1m]-x"      -> WORKHORSE   (marker not at end, still resolves)
"sonnet-distilled-from-opus"   -> EXPERT      (opus-first ordering, documented + deterministic)
"opus" / "OPUS"                -> EXPERT
"Sonnet-Latest"                -> WORKHORSE
"octopus-v1"                   -> EXPERT      <-- false positive, see Finding 1
"llama-3-haiku-clone"          -> FAST
"gpt-4o"                       -> null
""                             -> null        (-> FAST clamp + strip, legacy preserved)
inputs where the [1m] strip changes the opus outcome: []   <-- see Finding 2
```

### Interaction analysis I ran down and cleared

- **Configured tier models now also family-match.** FAST `claude-haiku-4-5-20251001` family-matches FAST; EXPERT `claude-opus-4-8[1m]` family-matches EXPERT. Exact match runs first and returns the same tier, so nothing changes. No behavior delta.
- **Env-override cross-family collision** (`LLM_MODEL_FAST=claude-sonnet-cheap`, the scenario named in the review brief). Exact-first ordering resolves it correctly: a request for `claude-sonnet-cheap` hits `matchConfiguredTier` -> FAST (the operator's explicit binding wins, correct); a request for `claude-sonnet-5` falls through to family -> WORKHORSE (correct). The precedence is the right way round; an operator's explicit model binding is never overridden by the family heuristic.
- **Non-string / absent `model`.** `typeof reqBody.model === 'string' ? ... : ''` (unchanged), `''` -> null -> FAST clamp + strip. Legacy preserved and pinned by `gateway.test.ts:94` and the allowlist suite's no-model case.
- **`/models` third row breaking a consumer.** Searched the whole repo: the only consumers are `shared/src/ekoa-local.ts` (schema + endpoint descriptor) and `gateway.test.ts`. `LlmModelsResponse = z.object({ data: z.array(LlmModel) }).passthrough()` is order-agnostic and unbounded, so an additive row is schema-safe. No web/ or TUI/bridge consumer exists in this repo (no index-based access like `data[1]` anywhere). No breakage.
- **A second tier-resolution site drifting out of sync.** No `count_tokens`/`countTokens` endpoint exists in `api/src/` or `shared/src/` (the BRIEF's ancillary-surface note anticipated one). `matchFamilyTier`/`matchConfiguredTier`/`wireTier` have exactly one resolution site (`client.ts:1100-1103`). No sync hazard.
- **Tier self-selection / cost escalation.** A gateway client naming an opus-ish model now bills at EXPERT weight 0.4 vs the old FAST 0.02 (20x). This is **spec-sanctioned and pre-existing**, not an S2 regression: the rc-1 amendment already routed an exact `claude-opus-4-8[1m]` request to EXPERT over this gateway, and the spec DECIDES "opus* -> EXPERT". S2 widens the aperture from one exact id to the family, which is precisely the intent. `admitOrThrow` is a per-user spend/rate cap, tier-independent and unchanged. Not a finding.

## Findings

No material, evidence-backed finding violates the acceptance or spec. The three items below are **non-blocking observations** recorded for the ledger; none blocks the slice.

**1. (Low, non-blocking, not grounded in this repo) `octopus`-class substring false positive routes to EXPERT at 20x billing weight.**
- Violated criterion: none. The acceptance mandates family matching "tolerant of `claude-` prefixes, generation infixes, dated suffixes", which forces a `contains` mechanism rather than a prefix/word-boundary one; substring is the sanctioned implementation of the DECIDED "opus* -> EXPERT".
- Evidence: my probe -> `matchFamilyTier('octopus-v1') === 'EXPERT'` (the literal string "octopus" contains "opus"). Consequence if ever hit: silent EXPERT billing (weight 0.4) instead of the historical FAST clamp (0.02) - a 20x cost move in the unsafe direction, plus reasoning params forwarded rather than stripped.
- Why non-blocking: per the verdict rules, this is not grounded in this repo's code or config. No model id containing `octopus` appears in `api/src/config.ts`, any env default, or any test. It is an inherent, accepted cost of the mechanism the spec chose. I checked the nearest plausible real collision, `corpus`, and it is **safe** ("corpus" does not contain "opus"). Worth a word-boundary tightening only if an org-custom model id ever collides.

**2. (Low, non-blocking, cosmetic) The `[1m]` strip inside `matchFamilyTier` is dead code.**
- Violated criterion: none - the function IS `[1m]`-tolerant as required.
- Evidence: `client.ts:1027` does `requestedModel.replace(/\[1m\]$/, '').toLowerCase()`, but the result feeds only `.includes('opus'|'sonnet'|'haiku')`. Removing the suffix `[1m]` can never change a substring test for a token that shares no character with `[1m]` and cannot span the boundary (the token would have to contain `[`). Proven empirically: probe line `inputs where the [1m] strip changes the opus outcome: []`, and `claude-opus-4-8[1M]` (uppercase marker, which the case-sensitive regex does NOT strip) still resolves to EXPERT.
- Why non-blocking: a no-op, zero behavioral risk. The only cost is that the doc comment implies the strip provides `[1m]` tolerance when substring matching provides it for free - mildly misleading to the next reader.

**3. (Low, non-blocking, pre-existing) `/models` EXPERT row still advertises `route: 'sdk'`, contradicting the adjacent new comment.**
- Violated criterion: none contractual - `note`/`route` are free-text fields under a `.passthrough()` schema, and the acceptance only requires the WORKHORSE row be added (RUN_SPEC A11), which it is.
- Evidence: `gateway.ts:243-250`. The new comment asserts "family mapping makes every tier reachable through this gateway, not only the FAST wire tier", while the EXPERT row it sits above still reads `route: 'sdk', note: 'SDK-only strong tier'`. Post-S2 an opus-family request demonstrably rides the gateway wire (`decision.model` -> `claude-opus-4-8` after the `[1m]` strip), so "SDK-only" is inaccurate.
- Why non-blocking: the staleness is **pre-existing**, not introduced here - the rc-1 amendment already routed exact-opus over this gateway, so the `sdk` label was already stale before S2. S2 only makes the stale path the common one. Flagged because the slice is framed as an "honesty fix"; tightening the note would complete that framing.

## Summary

The riskiest part of this change - moving the reasoning-param strip condition from `matchedTier === null` to `resolvedTier === null` so params travel on a family match - is implemented correctly and pinned from both directions: `gateway.test.ts:104` proves thinking is forwarded on a family-matched dated sonnet with the wire model rewritten to `claude-sonnet-5` and metering at the WORKHORSE weight (24 = round(0.1*240)), and `gateway-payload-allowlist.test.ts:251` proves an alien id still clamps to FAST with both params stripped. Exact-before-family precedence correctly protects operator env overrides. The firewall holds (no transport internals touched), the chokepoint gate is clean, metering stays single-writer with weight and model sourced from one config entry, and diagram 06 carries a valid, integrity-clean s2 note. Typecheck, lint, and 168/168 LLM tests are green on my own runs.

Approve.
