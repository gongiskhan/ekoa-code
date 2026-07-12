VERDICT: approve

# C1 — artifact-type classifier (fresh-context review)

Commits reviewed: a179a75, 0137e54 (branch operator-run).
Reviewer gathered its own evidence: read both diffs (artifact-type.ts, build-mechanics.ts,
shared/artifact-type.ts, the unit + contract + integration tests), ran the tests, and eslinted
the changed source.

## Acceptance — met

- **Scoping emits an artifact type.** `shared/src/artifact-type.ts` exports a CLOSED zod enum
  `app|document|report|presentation|landing`; `apps/artifact-type.ts::classifyArtifactType`
  returns it. Deterministic PT/EN signal table first; a FAST chokepoint one-shot only on
  ambiguity; `app` default on any failure.
- **Only `app` artifacts get operator wiring; persisted type is what downstream reads.**
  `build-mechanics.ts` persists `artifactType` on `artifact.data` (the `data: { ..., artifactType }`
  line at prepareFirstBuild's insert) with the comment "downstream slices read this, never
  re-classify". No permission/operator-surface branching lives in C1 — sequencing rule honored.
- **Classifier output persisted.** Verified in code AND by the persistence tests:
  `base-loader.test.ts` "no templateId classifies…" asserts `art.data.artifactType === 'app'`, and
  "a document-shaped request classifies…" asserts `art.data.artifactType === 'document'`.
- **Contract test.** `tests/contract/artifact-type.contract.test.ts` asserts the exact five-type
  closed vocabulary against `@ekoa/shared` and rejects out-of-vocabulary values.

## Constraints — all satisfied

- **Never throws.** `classifyArtifactType` (artifact-type.ts:51): empty/blank → `app` (:56);
  signal match → deterministic; ambiguous → one-shot wrapped in try/catch returning `app` on
  throw OR unparseable output (:68-78). Test "one-shot failure or garbage defaults to app (never
  throws)" covers both.
- **One-shot through the llm/ public entry with classifier attribution.** Imports `runOneShot,
  decideForTier` from `../llm/index.js` (the sanctioned chokepoint entry — egress-clean, not
  `@anthropic-ai`); attribution `{ kind: 'classifier', agentType: 'select-base-template',
  billeeUserId }`, billed to the requesting user (:41-47).
- **NO permission logic.** Confirmed in both artifact-type.ts and shared/artifact-type.ts headers;
  the security block wires the same output into its gate later.
- **Explicit templateId path unchanged / wins.** `baseFor` (build-mechanics.ts): an explicit
  `isBaseId(templateId)` calls `loadBase(templateId)` directly and derives the type via
  `typeForBase` — a known-but-broken base still fails LOUD (loadBase throws); an unknown id warns
  and falls through to classification (unchanged honest-fallback semantics, now landing on `app`).
- **Earliest-match ordering defensible.** Not table order: the loop keeps the signal with the
  smallest `m.index` (:60-67), ties fall back to table order. The codex-found trap
  "app para gerar contratos" → `app` is spot-checked green in artifact-type.test.ts:27
  ("Uma app para gerar contratos de arrendamento" → app; "Contrato … para o gestor" → document).

## EVIDENCE

- `npx vitest run tests/apps/base-loader.test.ts tests/apps/artifact-type.test.ts
  tests/contract/artifact-type.contract.test.ts --root api` → **20 passed** (6 C1 unit + 2 C1
  contract + the 3 updated C1 integration cases inside the 12 base-loader tests all green).
- `baseForType`/`typeForBase` totality proven by "type<->base mappings are total and land on real
  bases" — iterates `ArtifactType.options` and `BASE_IDS` both directions; `report → document`
  (shared print shell) asserted.
- `eslint api/src/apps/artifact-type.ts api/src/apps/build-mechanics.ts shared/src/artifact-type.ts
  shared/src/index.ts` → exit 0.
