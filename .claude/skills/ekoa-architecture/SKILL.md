---
name: ekoa-architecture
description: Binding architecture rules for any code change in ekoa-code (api/, web/, shared/) — module map, import boundaries, the LLM egress chokepoint, injected seams, diagram invariant. Load BEFORE writing or moving any file. Do NOT use for test strategy (that is ekoa-testing) or run mechanics/gates (that is ekoa-governance).
---

# ekoa-architecture

The spec is normative; this skill is a router. Code is truth for the OLD system only; for THIS repo the spec wins until rc-1.

## Non-negotiables (lint/CI-enforced; violating any = the change is wrong)
1. **Import boundaries (FIXED-1):** `web/` imports `shared/` only, never `api/`. `api/` never imports `web/`. `shared/` imports nothing but zod. ESLint `import/no-restricted-paths` zones + CI.
2. **One egress module (FIXED-3/8/13):** ONLY `api/src/llm/` may import `@anthropic-ai/*` or reference `api.anthropic.com`. Grep gate in CI. Agent SDK subprocesses are pointed at the chokepoint via `ANTHROPIC_BASE_URL` — never given provider URLs. Every call tagged `user_work | platform | classifier`.
3. **Module tiers (ch02 §2.7):** imports point strictly down the tier table. Nothing imports `routes/` or `server.ts`. `routes/` never imports `data/` directly. Nothing below tier 5 imports `agents/`/`automation/`/`apps/` — lower tiers use the four injected seams wired ONLY in `server.ts` (ch02 §2.8).
4. **Diagrams (FIXED-12):** a structural change without its `spec/diagrams/*.excalidraw` update in the same unit of work is INCOMPLETE.
5. **No model calls in platform paths (FIXED-4):** business logic is TypeScript authored at design time; no runtime markdown interpretation.
6. **Garrison (FIXED-7):** never import Garrison code, never call it as a service — CI greps for `garrison` in sources/manifests.

## Where things live
- Module inventory + responsibilities + exhaustive "may import" lists: `spec/02-module-map.md` §2.6-2.7 (19 entries: server.ts, config.ts + 17 dirs).
- Endpoint map: `spec/03-api-design.md` §3.8-3.10. Error envelope: CONV-2. Exactly 4 SSE streams: CONV-4.
- Data model / collections engine / crypto: `spec/04-data-model.md`. Single audit write path = `data/` `logActivity` only.
- Security invariant enforcement homes: `spec/09-security-invariants.md`.
- Stack: Express 5 + zod middleware (P-01), npm workspaces (P-17), Firestore via `mongodb` driver (P-05), Node 20 + TypeScript.
