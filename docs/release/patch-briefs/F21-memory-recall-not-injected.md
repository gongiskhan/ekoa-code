# F21: memory recall failed in session B - but the injection code path is correct (confirm first)

**Severity / class:** high [CAVEATED] / bug-or-model-behavior - REPRODUCE before fixing

**Symptom:** A fact stored as an `extracted` memory in session A ("Empresa": "Padaria Central", private,
tier active) is NOT surfaced when session B asks "Como se chama a minha empresa?" - the reply is "Não
encontrei informação sobre o nome da tua empresa na base de conhecimento". Evidence:
`docs/release/evidence/J4-memory/j4-memory.json` (`extracted` docs; `turnB` reply) and
`j4-ui-rootcause.json`. NOTE the same reply surfaced HOST operator context (`~/dev/ekoa-code`, "Ekoa
rebuild") - this finding is entangled with F25 (host-context bleed).

**Root cause - NOT confirmed as an injection bug; the code path is correct for this case (verified):**
- `agents/chat.ts` :119 calls `assembleRunContext` WITHOUT `optOutMemory`, so `agents/context.ts` :72-75
  runs memory injection and pushes `# Memória\n<block>` into the system prompt (:140 `systemPrompt:
  assembled.systemPrompt`). Injection IS wired for chat.
- `memory/resolver.ts` `resolveMemoryInjection` :69-105: `listVisibleMemories` returns own+org rows
  (`data/scoped.ts` :51-54; the extracted memory has `orgId = actor.orgId` from `extraction.ts` :119 and
  `userId = m-u1`, so it is visible). Scoring :78-88: query terms {como,chama,minha,empresa} vs memory terms
  {empresa,padaria,central} -> overlap on "empresa" = 1 > 0 -> the memory IS selected and rendered as
  "- Empresa: Padaria Central" (:103). "Padaria Central" carries no structured-ID/PII so anonymisation
  passes it through untouched.
So on a static read the fact SHOULD be injected. The reported "resolveMemoryInjection / assembleRunContext
scoring bug" is therefore NOT reproduced in code. Two live hypotheses remain: (1) F25 - the chat subprocess
had host tools/cwd and the model consulted host context instead of the injected block (see
`patch-briefs/F25`); (2) timing - extraction is fire-and-forget (`void scheduleExtraction`, chat.ts :205),
so if session B assembled context before the async persist landed, the list was empty at inject time.

**Reproduce-or-narrow FIRST:** unit-test `assembleRunContext` in process: insert an extracted memory for
user U (content shares a term with query Q), call `assembleRunContext({actor:U, query:Q, isChat:true})`,
assert `systemPrompt` contains "Padaria Central". If it PASSES (expected), injection works - reclassify F21
as a consequence of F25 + a memory-vs-model-priority judgment, and the fix moves there. Only if it FAILS is
there a resolver/timing bug to fix here.

**Fix scope (conditional on repro):** if injection proves empty at run time -> the break is timing:
make chat await (or gate) extraction visibility, or re-resolve memory just-in-time - `agents/chat.ts` +
`memory/extraction.ts`. If injection proves present-but-ignored -> the fix is F25 (subprocess isolation) plus
optionally making the injected memory authoritative in the chat system prompt (instruct the agent to prefer
`# Memória` over tools for user-identity questions). NON-goals: do not weaken tenant/user visibility scoping
in `data/scoped.ts`; do not infer sharedness (extraction stays `visibility:private`).

**Regression test first:** the reproduce test above becomes the committed regression
(`api/tests/memory/` or `api/tests/agents/`): stored extracted memory sharing a query term is present in the
assembled system prompt. Plus, if F25-driven, an e2e recall assertion in the memory journey once isolation
lands. Must be deterministic and LLM-free at the assembly layer.

**Acceptance:** a stored memory sharing a query term is provably in the assembled context for the next
session (unit), and the end-to-end recall answer names the fact once F25 isolation holds; cross-user
isolation (J4 isoGet 404) still holds.

**Notes:** `memory/` and `agents/context.ts` sit behind the injected content seam - keep `data/` access in
`memory/`, not in `agents/`. Flag in the final report: this is the finding most likely to be model-behavior
+ F25, not a standalone injection code bug. Ties to [[F25-host-context-bleed]] and F24 (junk `**` memory).
