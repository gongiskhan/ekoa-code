# Decision memo — Action registry: extend vs rebuild (Phase-2, track 1)

**Decision: build the UI action registry as a NEW client-plane component, unify with the existing data-plane capability system at the per-app MANIFEST level, and leave the automation engine + `platform-primitives.ts` untouched this run. Automations migration = a documented path (populate the idle `listEkoaActions` discovery seam so both planes share one catalog), not executed now.**

Flagged for operator review in the landing packet. Evidence: `analysis/01-automations-actions.md` (all claims cited to file:line there).

## Why not extend `platform-primitives.ts` into the UI registry

1. Different execution plane: the primitive interpreter is server-side, in-process, explicitly "no LLM, no vision, no browser" (`platform-primitives.ts:1-10`); UI actions must execute inside the served app through its state layer. Forcing one interpreter across both couples tier-5 server code to the served-app client plane.
2. The op union (17 ops: store/integration/data/file/flow) has no UI semantics; adding client ops the server cannot execute breaks the union's contract.
3. The trace/output contract (`EkoaActionTraceEntry`, `StepOutput.kind='ekoa_action'`) is populated synchronously as the server walks a recipe — meaningless for client-dispatched UI actions.

## Why unify at the MANIFEST level

1. `MANIFEST.md` already carries `data_model` + `external_dependencies` + `capabilities` side-by-side (`manifest-parser.ts:64-74`); a UI-actions section is an additive sibling section of the same per-app file.
2. `ArtifactManifestCapability` is already the right declaration shape (named, described, typed inputs); a UI command differs only in which runtime executes it.
3. The catalog/discovery surface already models a unified entry (`EkoaActionCatalogEntry`, `call_ekoa_action` tools) and its `listEkoaActions` seam is wired to an honest EMPTY (`server.ts:402`) — the registry emitter can populate it, giving one catalog for both planes with zero engine change.

## Consequences bound into the plan

- C2 defines the UI-action manifest as a shared/ zod schema AND a section of the per-app operate manifest; the build emits it.
- Registry actions audit through `logActivity` with a new activity kind (automations today write NOTHING to the global audit — `analysis/01` §5; the run ledger `automation_runs` stays as-is).
- The prior lean ("registry as foundation, automations migrate") is CONFIRMED on foundation and REFINED on timing: no forced migration exists because the planes are disjoint; coexistence under one manifest is stable indefinitely.
- MANIFEST.md has no generator today (agent-instructed only; absence is a runtime failure) — B3's manifest verification and C2's emission close that gap for the operate sections.
