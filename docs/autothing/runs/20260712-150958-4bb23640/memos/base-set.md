# Decision memo — Base template set for v1 (Phase-2, track 3 + track 4 archaeology)

**Decision: port the base loader (the piece the rebuild dropped), then wire `document` FIRST, `app` (new base, derived from `app-auth-persistent`) SECOND. `presentation`/`landing` stay authored-but-unwired for v1; `app-integration-heavy` is a near-free follow-on once `app` lands (declared thin variant). Structure is COPIED into the sandbox (no inheritance propagation); design tokens stay SERVED BY REFERENCE.**

Flagged for operator review in the landing packet. Evidence: `analysis/04-internal-templates.md` (measured baseline + archaeology; all claims cited to file:line there).

## The archaeology verdict (track 4)

- The five bases arrived fully authored in one WIP port commit (f75d2d5, G6) — content only. The consuming system was NEVER ported: `../ekoa-dev/cortex/src/services/base-loader.ts` (loadBase, closed enum matching the 5 bases, resolveTokens, mergeWithFeaturedArtifact) + the orchestrator's `selectBaseTemplate` step + the `base-selector` skill all exist only in the old repo.
- The new pipeline kept the reception seams unconnected: `templateScaffoldFiles`/`skipStarterFiles` on `scaffoldApp` (fed by nobody), `templateId` threaded route→build→prepareFirstBuild then silently discarded, the artifact `extends` field validated but never loaded.
- B1 therefore RECONNECTS a proven design rather than inventing one; the old loader is the reference implementation.

## The measured baseline (B4's bar)

Every build (first AND follow-up) pays ~13,232 chars ≈ ~3,780 est. tokens of standing instruction; ~9,434 chars ≈ **~2,700 est. tokens is STRUCTURAL** (71%) and is the migration target. Biggest chunks: MANIFEST.md conventions (~693), data API (~397), output rules (~390), document/docx (~383), SSO (~254), integrations (~193). A document build today pays for SSO/app wiring it never uses and vice versa.

## Why document first, app second

- `document` is the ONLY base with a real verbatim-copy `scaffold/` that already matches the `templateScaffoldFiles` seam shape — lowest-risk first wire, immediate deletion of the 383-token docx section from the always-on prompt.
- `app` is the default artifact type and the biggest tax sink, but needs real work: the `app-auth-persistent` scaffold is aspirational prose (files described but never written by any scaffolder), plus the two net-new runtime surfaces the brief demands (action-registry mount + assistant-panel mount — the latter currently FORBIDDEN by `app-auth-persistent` conventions rule 8, which the `app` base reverses) plus a hardened typed protocol client.
- Wire `app` = ~80% reuse of `app-auth-persistent` + the two mounts (B2), and it is what makes Phases 4–5 ship inside every future app for free.

## Bound-in obligations

- Reconcile the CSS-var drift during the `app` wire: base wiring references `--spacing-*`/`--typography-*` names that neither `CSS_VARS_CONTRACT.md` nor the live `design-tokens.ts` emitter defines (silent fallbacks today); also note the emitter omits `--space-*`/`--text-2xl/3xl` from the contract.
- Every wired base ships a manifest; B3's per-build verification asserts base files were replaced/extended by generation (closes the F16/F28 class).
- B4's shrink is MEASURED against the ~2,700-token structural baseline, not asserted.
