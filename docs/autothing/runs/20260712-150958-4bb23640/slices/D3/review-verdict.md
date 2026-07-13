# D3 fresh-context review — scripted three-mode + operate-loop live gate

Reviewer: fresh-context (no implementer context). Scope: commit `015777a` +
`docs/autothing/runs/20260712-150958-4bb23640/slices/D3/`. Evidence gathered independently
(git, source read, the four committed screenshots, D2 driver diff). The live driver was NOT
re-run (real model calls); every judgement below is from source + committed evidence.

## What holds (verified with my own evidence)

- **Strictly test-only.** `git diff-tree -r 015777a` = exactly four adds: `api/tests/e2e/assistant-modes.e2e.mjs`
  + `impl-notes.md` + `live-gate.md` + `live-output.txt`. No product source touched. (The 4 PNGs +
  `evidence-live.cast` are gitignored run-wide — `.gitignore:23` `**/*.cast`, `.gitignore:26`
  `docs/autothing/runs/**/*.png` — so the durable *committed* proof is the driver + text logs, not the
  binaries. This is the run convention, not a D3 defect; noted for the gate record, not a finding.)
- **Console allowlist = D2, verbatim.** `benign()` (`assistant-modes.e2e.mjs:155-169`) is byte-identical
  to `assistant-panel.e2e.mjs:84-98` — favicon 404, `/api/app-sso/me` 401 (`injected-context.ts:110`),
  `/api/app-health` 5xx (`injected-context.ts:244`) — modulo the "D3 code"/"D2 code" comment word. No drift.
- **DO is strongly pinned** (`:257-280`). It reads the *actual DOM field value*
  (`document.getElementById('d3-nome-input').value` matched `/ana/i`), a MutationObserver flag for real
  runtime UI (`[data-ekoa-actions-ui]`), the server-echoed `body.mode === 'do'` (deterministic — the
  prompt hits no `inferMode` keyword), and the "executada" run line. This is NOT a panel-text-only check.
  `live-01` confirms the field driven to "Ana" with the highlight ring. Good.
- **DESTRUCTIVE confirm-before-dispatch is sound** (`:287-304`). Sentinel reset, asserted un-run while the
  PT-PT card is up, asserted run only after `Confirmar`, waiting on `__d3DestrResult.status==='done'` (no
  sleep). `live-02` shows the card "Confirmar ação: Apagar todos os clientes", field still "Ana". No hole.
- **PAUSE-ON-USER-INPUT is strongly pinned** (`:311-336`) and is NOT sleep-based: it `waitForFunction`s
  both promises resolved, then asserts BOTH `status:'cancelled', detail:'user-input'` AND the field is
  still "Ana" (the queued setField's sentinel value `NAO-DEVE-CORRER` never landed). The field-value
  assertion is the real proof the queue did not continue. The ~8s highlight-poll window comfortably covers
  the trusted click. Solid.
- **SHOW / TEACH mode inference is deterministic** (`:342-364`): mode assertions ride the server's
  `inferMode` classifier + the reflected toggle label ("Mostrar"/"Ensinar"), never a pinned mode. Good.
- **Self-seeding / re-runnable, no D2 dependency.** `main()` logs in, builds ONE fresh app
  (`buildSampleApp`), PATCHes the manifest, seeds the KB doc, and plants its own landmark. Nothing depends
  on D2's leftover artifact. Idempotent.
- **Model budget within bounds.** Assistant turns: do (+1 retry margin), show, teach, cited = ≤5 (4 on the
  green run). One app-generation build is setup, not an assistant turn. ≤6. Fine.

## Findings

1. **[Major] The CITED PASS is materially weaker than the claim, and its own evidence shows the property
   failing in spirit.** Claim (live-gate.md / acceptance): "a CITED answer rendering 'Fontes' from org
   knowledge." The green-run evidence contradicts it:
   - `live-04-fontes.png` shows the model's actual reply is a **refusal**: *"Não posso, por isso, responder
     com fundamento a essa pergunta a partir do conhecimento disponível. Se tiver acesso a um documento
     específico sobre a política de retenção de dados/documentos, pode partilhá-lo…"* — i.e. it says it
     **cannot** answer.
   - The 5 rendered "Fontes" are unrelated `jurisprudencia` Acórdãos (`live-output.txt:12`). The seeded
     `manual-interno` "Política de Retenção de Documentos" doc — the whole point of `seedKnowledge` — **did
     NOT surface**, even though the query is a verbatim question about that policy.
   - The assertion (`assistant-modes.e2e.mjs:371`) only checks `citations.length > 0`. Per impl-notes:73-77
     grounding is *unconditional* for `kind:'chat'`, so every turn (DO/SHOW/TEACH included) already renders
     a Fontes block. The assertion is therefore trivially satisfied by ambient corpus citations and proves
     nothing about grounded retrieval of the seeded/relevant org knowledge — it would pass identically with
     an empty seed and a refusal answer, which is exactly what happened.
   - `seedKnowledge` (`:141-148`) asserts only 201-created, never that the doc is *retrievable* at query
     time; with async indexing the fresh doc plausibly wasn't queryable when the CITED turn ran. So the
     "a hit is guaranteed regardless of corpus state" determinism claim (impl-notes:87-89) is unproven —
     the gate's CITED determinism actually rests on the pre-existing corpus, not the seed.
   - **Fix:** assert the seeded doc actually grounds the answer — e.g. the seeded title appears in
     `citations`, and the reply is not the "não posso responder" refusal template — and wait for the seed
     to be retrievable before the CITED turn. As written, the CITED property is not meaningfully proven.

2. **[Major — product defect surfaced, must not pass silently] Citations rendered next to an explicit "I
   cannot answer" refusal.** `live-04` shows the panel presenting 5 legal "Fontes" (Acórdãos from Tribunal
   da Relação de Lisboa / Supremo Tribunal de Justiça) directly beneath a reply stating it has no grounding
   to answer. For a lawyer-facing product this is a trust hazard: it displays authoritative-looking sources
   that did not inform (and are irrelevant to) the answer. Unconditional grounding attaching irrelevant
   citations to a refusal is C3/D1 product behaviour, surfaced by D3's evidence. Per CLAUDE.md QA rule every
   finding is closed by a deterministic test or a written dismissal in `docs/findings.md` — this one is
   currently closed by neither. It needs a `findings.md` entry (and ideally a product fix: suppress or label
   citations when the answer is an ungrounded refusal).

3. **[Minor] TEACH "step-structured" assertion is prose-dependent and can flake or false-pass.**
   `:358` is `/\d+[.)]/.test(teachReply) || /passo/i.test(teachReply)`. The `/passo/i` arm passes if the
   model merely echoes the word "passo" with no actual steps; `live-03`'s visible reply tail is
   conversational ("Quer que eu faça uma demonstração agora…"), not numbered. The deterministic core
   (server `mode==='teach'` + toggle) is solid; only the decorative "step-structured" claim rides a loose
   regex. Tighten it (e.g. require ≥2 numbered-step markers) or drop the claim to "non-empty teach-mode reply".

4. **[Nit] `codex-review.md` is an empty (0-byte) untracked file** in the slice dir. The per-slice cross-model
   review appears unrun/unrecorded. Out of this commit's scope but relevant to the slice's gate completeness.

## Assessment

The driver is genuinely well-built: 5 of the 7 acceptance properties (DO, DESTRUCTIVE, PAUSE, SHOW-mode,
TEACH-mode) are pinned by strong, deterministic, DOM/echo-level assertions with clean supporting evidence,
the console allowlist matches D2 with no drift, and the gate is self-seeding and re-runnable. But the CITED
property — one of the seven the acceptance names — is not meaningfully proven (Finding 1): its assertion is
trivially satisfiable by unconditional grounding, and the committed green-run evidence shows a *refusal* with
*unrelated* citations while the seeded doc never surfaced. That same evidence exposes a real lawyer-facing
defect (Finding 2) that is currently closed neither by a test nor a written dismissal, which the project's QA
rule forbids. These are scoped, addressable fixes, but they must be made (or the defect explicitly dismissed
in findings.md) before the slice can be considered to prove its stated acceptance.

VERDICT: needs-work (initial — superseded by the re-verification below)

---

## Re-verification of 5153dee (+ findings.md 828050a)

Re-checked the fix commit independently: `git show 5153dee` is test-only (driver + 3 slice docs, no
product source), and I read the new assertions + the refreshed evidence (I did not re-run the driver).

- **Finding 1 (CITED) — RESOLVED.** The seed is now a distinctively-tokened doc (title/body
  `Circular Interna EKZ-7788`, `KB_TOKEN='EKZ-7788'`, `assistant-modes.e2e.mjs` new `KB_DOC`), the query
  names it verbatim, and the assertion no longer rides `citations.length>0`. It now pins BOTH that the
  SEEDED doc surfaces — `cites.some(c => c.title.includes(KB_TOKEN))` — AND that the reply is not a
  refusal (`REFUSAL` regex covers "não posso/consigo responder/ajudar", "sem conhecimento", "não
  tenho/há conhecimento/informa/acesso"), inside a 2-iteration loop that fails loud on the 2nd miss.
  Retry is bounded (≤2). The refreshed evidence is consistent: `live-output.txt:12` = `PASS CITED:
  seeded doc "EKZ-7788" surfaced in 5 citation(s); reply is a grounded answer (not a refusal)`, and
  `live-04-fontes.png` shows the grounded reply ("A Circular Interna EKZ-7788 estabelece dez anos como
  prazo de retenção… [2][3]") with the Fontes block led by three `manual-interno - Circular Interna
  EKZ-7788` citations. The seeded doc surfaces #1 and the citations now correspond to the answer.
- **Finding 2 (citations-under-a-refusal product defect) — CLOSED per the QA rule.** `docs/findings.md:504`
  (commit 828050a) records the open "served-app assistant 'Fontes' can contradict the reply" item and
  extends it with the D3 live evidence, with an owner (D3/F-slice follow-up). This is exactly the
  QA-rule remedy (a written findings.md entry, not a silent pass). The D3 test itself now also guards
  the grounded-answer direction via the non-refusal assertion.
- **Finding 3 (TEACH regex) — RESOLVED.** Now `stepMarkers = teachReply.match(/(?:^|\n)\s*(?:passo\s+)?\d+[.)]/gi)`
  with `assert(stepMarkers >= 2)`; the loose `/passo/i` escape hatch is gone and the markers are
  line-anchored, so an inline article number no longer false-passes. `live-output.txt:11` still PASSes
  (897-char step-structured reply).
- **Finding 4 (empty codex-review.md) — out of my hands;** lead reports the codex pass was stdin-stuck,
  relaunched, and will be recorded.

The five previously-strong properties (DO / DESTRUCTIVE / PAUSE / SHOW / TEACH-mode) are untouched by this
commit and remain solid; the console allowlist is unchanged and still verbatim-D2.

One new NON-BLOCKING observation (not a D3 test defect — orthogonal panel/product polish for the
F-slice follow-up): in `live-04-fontes.png` the reply renders literal markdown asterisks — "estabelece
**dez anos** como prazo" — rather than bold. The D2 panel is not rendering `**…**`. Worth a polish pass
on the panel markdown for this lawyer-facing surface, but it does not bear on the D3 gate.

Both blocking findings are resolved and the minor is fixed. The slice now proves its stated acceptance.

VERDICT: approve
