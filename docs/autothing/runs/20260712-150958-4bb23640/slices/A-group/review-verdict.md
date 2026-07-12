# A-group review verdict (fresh-context)

VERDICT: approve

Reviewer: fresh-context, no implementer context. Repo `/Users/ggomes/dev/ekoa-code`, branch `operator-run`, commit 97f66d6. Reviewed A1–A5 (analysis/01..04 + memos/{registry,tour-format,base-set}) against FLOW_PLAN per-slice acceptance (lines 45–49) and BRIEF Phase 1 tracks 1–4 + Phase 2.

**Method:** read all five deliverables + FLOW_PLAN + BRIEF; spot-checked 12+ load-bearing citations against source (2+ per analysis) and re-derived the A4 token arithmetic. **Every spot-checked citation was exactly correct — zero wrong citations found.** All findings below are minor and non-blocking.

---

## A1 — analysis/01-automations-actions.md

VERDICT: approve

Answers all of BRIEF track 1: (a) what automations can invoke today — closed 9-value step vocabulary across two execution planes; (b) does an "ekoa action" primitive exist — YES, characterised precisely as a server-side data-plane interpreter; (c) **can automations drive apps already** — the brief's key question, answered with the load-bearing distinction that automations drive app DATA (via `ekoa_action`) but NOT app UI in-page (Q3); (d) extend-vs-rebuild evidence table (Q4); (e) confirms/kills the prior lean — CONFIRMED on foundation, refined on migration timing (no forced migration; planes are disjoint).

Spot-checks (both correct):
- `types.ts:159-168` StepType = closed 9-member union (`browser|verify|integration|sub_automation|navigate|wait|local_command|api_call|ekoa_action`) — verified verbatim.
- `server.ts:402` `listEkoaActions: async () => []` (honest-empty discovery seam) — verified verbatim.
- Bonus: "automation/ never calls `logActivity`" (Q5) — independently grep-confirmed (no match in `api/src/automation/`); `logActivity` defined at `activity.ts:21` as claimed.

No material omission. The extend-vs-rebuild verdict and the audit-path finding (registry actions are NEW `logActivity` usage, not an automation extension) both follow from cited evidence.

## A2 — analysis/02-demos-tutorials.md

VERDICT: approve

Answers BRIEF track 2 and the FLOW_PLAN A2 acceptance in full: demo-spec v1 capabilities (6 step types), bridge command surface (postMessage protocol, origin pinning), player state machine (`tour-machine.ts`), `../ekoa-dev` delta (§6: byte-identical 1:1 port, nothing richer dropped), and reuse verdict + gaps (§5: registry-ID targets, multiple-tours-per-app, in-app same-document player as the one genuinely net-new component).

Spot-checks (both correct):
- 28 shipped `legal-*.json` tours — verified by `ls` (doc honestly corrects the brief's "~30" to the actual 28).
- `demo-registry.ts:123-128` strictObject with `version: z.literal(1)` at :125 — verified verbatim.
- Bonus: bridge injected at `injected-context.ts:260` (`<script src="/__ekoa/demo-bridge.js">`) — verified verbatim.

Schema-extensibility analysis (optional `tourId`/`kind`, stays on version 1, 28 specs remain valid) is sound. The two incidental drift findings (duplicated `api/assets/demos` vs `ekoa-data/demos` catalog; latent `placement` field) are correctly flagged for the operator.

## A3 — analysis/03-knowledge-hooks.md

VERDICT: approve

Answers BRIEF track 3 and the A3 acceptance: (a) can indexing run mid-build — YES, `ingestDocument(input.actor, {...}, input.deps)`, a legal tier-5→tier-3 call, immediately searchable, no rebuild/optimize, no new hook; (b) retrieval + citation shape — `buildGroundingBlock` I/O and the `[n] collection / title (doc <docId>)` citation format; (c) gaps needing a new hook — cleanly separated: F1 needs a new hook ONLY if the UX is "upload a file inside the build-chat turn" (a run-scoped upload transport); D1 is a new route (contract exists, no implementation).

Spot-checks (both correct):
- `service.ts:172` `ingestDocument(actor, input, deps)` writing vault + `index.indexDoc` — verified verbatim (matches the stated signature/behaviour).
- `shared/src/app-assistant.ts:22-30` contract (`POST /api/app-assistant`, `header-scoped`, request `{message, history?}`, response `{reply}`) exists — verified verbatim; and the "no route implements it" claim independently grep-confirmed (NO MATCH for `app-assistant|assistantChat` in `api/src/`).

Owner-org resolution chain for D1 (app-id header → resolveApp → ownerUserId → orgId, never caller-supplied) is correctly derived and load-bearing. The cross-org isolation test inventory (§5) is accurate scoping for F1/D1 obligations.

## A4 — analysis/04-internal-templates.md

VERDICT: approve

Answers BRIEF track 4 and the A4 acceptance in full, including the two items the brief made non-negotiable:

- **MEASURED token-tax baseline — present and arithmetic foots.** Per-build standing instruction = 13,232 chars ≈ 3,780 est. tokens (SKILL.md 12,331 + BUILD_SYSTEM_PROMPT 901); structural = ~9,434 chars ≈ ~2,700 tokens; judgment = ~3,798 ≈ ~1,080. Re-derived: 12,331+901 = 13,232 (exact); structural section rows sum to **exactly 9,434**; 9,434/3.5 = 2,695 ≈ 2,700; 13,232/3.5 = 3,780 — all internally consistent. The method (chars/3.5) is the brief-fixed rate, and the doc honestly flags it runs slightly high vs a real tokenizer. This is a genuine measurement, not an assertion — the B4 bar is well-defined.
- **Where the internal-bases decision was dropped — established.** Bases arrived assets-only in commit `f75d2d5` (G6); the loader (`../ekoa-dev/cortex/src/services/base-loader.ts` + orchestrator `selectBaseTemplate` + `base-selector` skill) was never ported; the reception seams (`templateScaffoldFiles`/`skipStarterFiles`/`templateId`/`extends`) sit unconnected on the new side.

Spot-checks (both correct):
- `templateScaffoldFiles` occurs ONLY in `scaffold.ts` — grep-confirmed (dead seam, fed by nobody).
- `api/assets/bases/` = exactly 5 bases + `CSS_VARS_CONTRACT.md` — verified by `ls`; and `git log --all -- '*base-loader*'` is **empty** (base loader never existed in this repo) — verified.
- Bonus: SKILL.md = 12,722 bytes on disk — verified verbatim (matches the doc's stated on-disk figure; 12,331 after frontmatter strip).

Minor findings (non-blocking):
1. BRIEF track 4 literally asks whether the bases decision "enter[ed] the ekoa-code **spec**" (the retired build spec, git tag `archive/pre-docs-cleanup-2026-07`). A4 answers the repo/asset archaeology and infers the spec did contemplate bases from the presence of the reception seams, but does not explicitly grep the archived spec doc. Substantively answered via the seam evidence; a literal spec-doc check is absent.
2. The per-section table's judgment rows foot to 3,784, vs the stated judgment subtotal of 3,798 (a 14-char / 0.1% gap absorbed by the two `~`-estimated splits — Design half and BUILD_SYSTEM_PROMPT split — and inter-section whitespace). Headline totals are internally exact; the section table just doesn't foot to the penny. The `~` flags make this honest, not a defect.

## A5 — memos/{registry, tour-format, base-set}.md

VERDICT: approve

All three memos present, each with recommendation + evidence pointer + "flagged for operator review in the landing packet." Recommendations follow from the analyses with no unsupported leaps (checked: reuse figures ~70%/~80%, 17 ops, 383-token docx section, "automations write nothing to global audit" all trace faithfully to A1/A2/A4).

- **registry.md** — satisfies BOTH explicit A5 mandatory contents: (a) states the manifest-level unification — "unify … at the per-app MANIFEST level" and "C2 defines the UI-action manifest as a shared/ zod schema AND a section of the per-app operate manifest"; (b) states the automations-migration path as documented-not-executed — "Automations migration = a documented path (populate the idle `listEkoaActions` seam), not executed now." Recommendation (new client-plane registry, engine untouched) follows directly from A1's plane-disjointness evidence.
- **tour-format.md** — reuse-wholesale + one net-new same-document player; extensions (optional `tourId`, build-time generation sharing the registry-ID namespace) and drift hazards carried faithfully from A2. Consistent with RUN_SPEC assumption 2.
- **base-set.md** — port loader → `document` first, `app` second, `presentation`/`landing` unwired for v1, `app-integration-heavy` as near-free follow-on. Consistent with BRIEF Phase 2 track 3 ("lightest viable … presentation/landing only if token-tax justifies") and grounded in A4's measured baseline + archaeology. COPIED structure / SERVED-BY-REFERENCE tokens correctly restated.

No memo overstates its analysis. No missing memo.

---

## Overall

All five slices approve. The deliverables answer the brief's questions (not merely describe code), are meticulously evidence-cited (every one of 12+ spot-checked citations was correct — an unusually clean citation record), the A4 token baseline is genuinely measured with arithmetic that foots at the headline level, and the registry memo hits both of its explicitly-mandated contents. The only findings are two minor A4 completeness/precision notes, neither blocking.
