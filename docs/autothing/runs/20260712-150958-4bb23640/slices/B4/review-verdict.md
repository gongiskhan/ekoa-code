# B4 review verdict

VERDICT: needs-work

Reviewer: fresh-context (review-b4), no implementer context. Slice B4 = commit `dcdd488`.
HEAD == dcdd488 at review time (confirmed: `git rev-parse HEAD` == `git rev-parse dcdd488`).

## Summary

B4 is a genuine, well-measured migration for the **document** side and for the SSO/integrations
*core*, and the reported shrink is exactly reproducible and honest. But as **committed**, the
slice is a **lossy delete** of two real, live platform capabilities on the **app** side: the
password sign-in flow (`passwordSignIn`/`setUserPassword`) and the `load_context`
integration-knowledge convention. Both were removed from the always-on SKILL.md and are **absent
from the app base at the reviewed commit** — they exist only as **uncommitted** working-tree edits
that are not part of B4 and not in any commit. This contradicts the memo's central claim ("a true
move, not a delete… verifiably present in the base skills/scaffold"). The fix is small and already
drafted in the working tree; it must be committed for the migration to actually hold.

## Findings

### F1 (blocker) — Password sign-in flow deleted, NOT preserved in the app base at commit time

- **Constraint** (acceptance): "migrated instruction content DELETED" must be a MIGRATION, i.e.
  the destination base carries the substance. Team-lead directive: "Flag any substantive guidance
  that was DELETED but NOT preserved in a base."
- **Evidence:**
  - `git show dcdd488` removes from `api/content/coding-agent/SKILL.md` (old lines ~176-186, the
    "Sessão de utilizador final (SSO)" block): `window.__ekoa.passwordSignIn(identity, password)` /
    `setUserPassword(...)` — "o fluxo alternativo por password gerido pela plataforma".
  - `git show dcdd488:api/assets/bases/app/skills/using-auth.md | grep passwordSignIn` →
    **ABSENT**. The committed app base has no "Password sign-in" section; it documents only
    Microsoft `signIn()`.
  - These are REAL live capabilities: injected into `window.__ekoa` at
    `api/src/apps/injected-context.ts:123` (`passwordSignIn`) and `:130` (`setUserPassword`);
    contract-tested at `api/tests/contract/served-app.test.ts:380-381`; and actively used by a
    SHIPPED featured artifact (`api/assets/featured-artifacts/legal-portal/scaffold/frontend/src/portal.js:125`,
    `.../cliente/ClientePage.jsx:69`). A coding-agent asked to build a client/portal app with
    password login now has no guidance that this platform capability exists.
  - Remediation exists ONLY uncommitted: `git diff api/assets/bases/app/skills/using-auth.md` adds
    a "## Password sign-in (platform-managed alternative to Microsoft SSO)" section restoring both
    APIs. Not staged, not committed (HEAD == dcdd488). Not attributable to B4.

### F2 (blocker) — `load_context` integration-knowledge convention deleted, NOT preserved in the app base at commit time

- **Constraint:** same as F1.
- **Evidence:**
  - `git show dcdd488` removes from SKILL.md ("Integrações a partir da app" block): "carrega o
    conhecimento dela com a ferramenta `load_context` (nome `integration-<chave>`, ex.:
    `integration-slack`)".
  - `git show dcdd488:api/assets/bases/app/skills/using-integrations.md | grep load_context` →
    **ABSENT** at the reviewed commit.
  - `load_context` is a live coding-agent build tool: wired at
    `api/src/agents/build.ts:371` (`loadContextToolSpec(input.actor, 'coding')`), and is
    "the ON-DEMAND knowledge surface the agents pull through `load_context`"
    (`api/src/integrations/definitions.ts:301`). The deleted convention is the ONLY guidance
    telling the agent to load an integration's actions/args/errors before writing
    `integration.call` code. `using-integrations.md` (committed) never mentions it.
  - Remediation exists ONLY uncommitted: `git diff api/assets/bases/app/skills/using-integrations.md`
    adds a paragraph restoring the `load_context` / `integration-<key>` convention. Not committed.

### F3 (advisory) — Memo's verification method (grep-hit counts) is too coarse and its honesty note overreaches for the app side

- The memo asserts "The migration is a true move, not a delete: the removed content is verifiably
  present in the base skills/scaffold (grep-confirmed: using-auth 8 hits, using-integrations 9
  hits…)." Hit-counting on a few terms passed while two whole API surfaces were dropped. For the
  app side the "true move, not a delete" claim is materially inaccurate as committed. Once F1/F2
  are committed the claim becomes true; the memo should also explicitly name password-sign-in and
  `load_context` as migrated so the coverage is auditable rather than proxied by hit counts.

## What PASSES (verified independently)

- **Measured shrink is HONEST and exactly reproducible.** Re-derived with `wc -m` (UTF-8-aware,
  frontmatter-stripped): OLD (dcdd488^) = **12,331** chars, NEW (dcdd488) = **9,984** chars, delta
  = **2,347**. Matches the memo to the character. `2,347 / 3.5 = 670.6 ≈ 671` est. tokens — the
  arithmetic is right. (Note: a `wc -c`/byte count gives 12,561→10,182 because the Portuguese text
  has multibyte accented chars; the memo correctly uses character counts.) The internal breakdown
  is consistent: 886+674+1337 = 2,897 removed, minus the +550 pointer = 2,347 net.
- **docx migration is COMPLETE at commit time and stronger than the old prose.** The removed
  "Documentos descarregáveis" section is fully carried by the document base:
  `api/assets/bases/document/instructions/base-conventions.md` (committed) documents the Word/PDF
  toolbar, print-styled shell, real-running-text block types (never forms), full-document
  revisions, notes-excluded-from-exports, and cloud save; and the scaffold SHIPS a working docx
  builder — `api/assets/bases/document/scaffold/frontend/src/App.jsx:11` imports
  `Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak` from `docx` and
  builds it (`buildDocumentDocx`, `blockToDocxParagraphs`). A document build genuinely ships a
  working docx path; no docx guidance a document build needs was lost. The team-lead's specific
  docx concern is resolved.
- **SSO core preserved** in `using-auth.md` (committed): `getCurrentUser()`→`{email,name,oid,tid}`,
  `signIn(returnPath?)`, `signOut()`, "Authorize by `oid` (+`tid`), never by `email`", the
  visitor-vs-workspace-account distinction, and the standalone `/apps/{slug}/` SSO context.
- **Integrations core preserved** in `using-integrations.md` (committed): `integration.call`
  platform-executed capabilities, `graphFetch` visitor M365 proxy, `external_dependencies.integrations`,
  needs-integration UI state. Cloud save (Drive/OneDrive `cloudFiles`) preserved in both app and
  document bases.
- **Cross-type retention honestly disclosed.** Memo states canonical structure / output rules /
  data API / MANIFEST capabilities stay always-on; verified those sections remain in SKILL.md.
- **Fallback risk is bounded and honestly disclosed.** `classifyArtifactType` defaults to `app` on
  any classifier failure (`api/src/apps/artifact-type.ts:74,77`) → loads the `app` base (which
  carries auth+integrations). Only a genuinely missing/broken base *directory* degrades to generic
  starters (`api/src/apps/build-mechanics.ts:88-93`, "warned, never silent"), matching the memo's
  disclosed rare path. `baseForType` covers every artifact type (app→app, document/report→document,
  presentation→presentation, landing→landing); no type is left routing to a nonexistent base.
- **Live evidence adequate for "builds still work."** `slices/B4/verify-output.txt`: app build
  (extends=app, served 200) and document build (extends=document, served 200) both succeed on the
  slimmed prompt. NOTE this does not — and cannot — catch F1/F2: neither probe exercises a
  password-login app or an integration-heavy app, which is exactly where the missing guidance would
  bite. So the green live run is not evidence against the coverage gap.

## Required to flip to approve

Commit the two app-base additions that already sit unstaged in the working tree (amend into B4 or a
follow-on B4 fix commit):
1. `api/assets/bases/app/skills/using-auth.md` — the "Password sign-in" section
   (`passwordSignIn`/`setUserPassword`).
2. `api/assets/bases/app/skills/using-integrations.md` — the `load_context` / `integration-<key>`
   convention paragraph.

Once committed, the app-side migration is a true move (matching the document side), F3 resolves,
and B4 meets its acceptance bar. No other changes needed — the shrink measurement, docx coverage,
and build evidence are all sound.

## EVIDENCE (commands run)

- `git show dcdd488` / `--stat` — the diff: 3 SKILL.md sections removed + 6-line pointer added +
  `memos/token-shrink.md`.
- `git rev-parse HEAD` == `git rev-parse dcdd488` — reviewed commit is the tip; no later commit
  carries any fix.
- `git show dcdd488:<base file> | grep …` — committed base state: SSO/integrations/docx core
  PRESENT; `passwordSignIn`/`setUserPassword` and `load_context` ABSENT.
- `git diff api/assets/bases/app/skills/…` — the restorations exist only as uncommitted working-tree edits.
- `wc -m` on frontmatter-stripped `git show dcdd488^:` vs `dcdd488:` SKILL.md → 12,331 → 9,984,
  delta 2,347; `/3.5` = 671. Reproduces the memo exactly.
- `grep` in `api/src/apps/injected-context.ts` (123/130), `api/tests/contract/served-app.test.ts`
  (380/381), `api/src/agents/build.ts:371`, `api/src/integrations/definitions.ts:301`,
  `api/assets/featured-artifacts/legal-portal/**` — the two dropped APIs are real, injected,
  contract-tested, tool-wired, and shipped-in-use.
- Read `api/assets/bases/document/scaffold/frontend/src/App.jsx` (docx builder) +
  `document/instructions/base-conventions.md` — docx path genuinely shipped.
- Read `slices/B4/verify-output.txt` — app + document builds serve 200 on the slimmed prompt.
