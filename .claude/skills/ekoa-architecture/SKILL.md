---
name: ekoa-architecture
description: Binding architecture rules for any code change in ekoa-code (api/, web/, shared/) — module map, import boundaries, the LLM egress chokepoint, injected seams, diagram invariant. Load BEFORE writing or moving any file. Do NOT use for test strategy (that is ekoa-testing) or governance/journaling (that is ekoa-governance).
---

# ekoa-architecture

Canonical architecture doc: `docs/architecture.md`. Code + docs/ are truth; the retired build
spec lives only in git history (tag `archive/pre-docs-cleanup-2026-07`).

## Non-negotiables (lint/CI-enforced; violating any = the change is wrong)
1. **Import boundaries (FIXED-1):** `web/` imports `shared/` only, never `api/`. `api/` never imports `web/`. `shared/` imports nothing but zod. ESLint `import/no-restricted-paths` zones + CI.
2. **One egress module (FIXED-3/8/13):** ONLY `api/src/llm/` may import `@anthropic-ai/*` or reference `api.anthropic.com`. Grep gate in CI. Agent SDK subprocesses are pointed at the chokepoint via `ANTHROPIC_BASE_URL` — never given provider URLs. Every call tagged `user_work | platform | classifier`.
3. **Module tiers:** imports point strictly down the tier table (`docs/architecture.md`). Nothing imports `routes/` or `server.ts`. `routes/` never imports `data/` directly. Lower tiers reach `agents/`/`automation/`/`apps/` only through the injected seams wired ONLY in `server.ts` (honest defaults; the composition root binds the real collaborators).
4. **Diagrams (FIXED-12):** a structural change without its `docs/diagrams/*.excalidraw` update in the same unit of work is INCOMPLETE.
5. **No model calls in platform paths (FIXED-4):** business logic is TypeScript authored at design time; no runtime markdown interpretation. Agent instruction prose lives in content packages (`api/content/`) or TS prompt constants — never executable content.
6. **Garrison (FIXED-7):** never import Garrison code, never call it as a service — CI greps for `garrison` in sources/manifests.

## Where things live
- Module inventory, tier table, seams, agent kinds (coding/chat/automation/integration-builder), knowledge subsystem (org vault + `_shared` legal corpus), apps pipeline, billing tiers: `docs/architecture.md`.
- Contract conventions (error envelope, auth tiers, SSE streams, served-app byte-compat plane): `docs/api-contract.md`.
- Security invariants (path jails, SSRF, credential custody, anonymisation, tool-less agents): `docs/security.md`.
- Stack: Express 5 + zod middleware, npm workspaces, Firestore via `mongodb` driver, Node 20 + TypeScript, Next.js dashboard.
