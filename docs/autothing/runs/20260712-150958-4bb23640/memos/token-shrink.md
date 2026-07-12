# B4 measured instruction shrink (structure -> bases)

## What moved

Three TYPE-SPECIFIC structural sections were removed from the always-on coding-agent
instruction (`api/content/coding-agent/SKILL.md`) because each is now carried by the internal
base its artifact type selects (C1 makes EVERY build select a base):

| Section removed from SKILL.md | Chars | Now carried by |
|---|---:|---|
| Sessão de utilizador final (SSO) | 886 | app base `skills/using-auth.md` (whoami/signIn/oid-not-email/standalone) |
| Integrações a partir da app | 674 | app base `skills/using-integrations.md` (integration.call, graphFetch, load_context, external_dependencies) |
| Documentos descarregáveis (Word/PDF) | 1337 | document base: `scaffold/` ships the working docx/PDF toolbar + `instructions/base-conventions.md` (edit documentData.js, never rebuild the toolbar) |
| (replaced by) a 6-line pointer to the base | +550 | — |

## Measured result

- SKILL.md body (frontmatter-stripped): **12,331 -> 9,984 chars** = **2,347 chars removed** ≈ **671 est. tokens** (chars/3.5, the A4-fixed rate).
- This is the **always-on** shrink: every build's system prompt drops ~671 est. tokens of structural instruction it no longer needs generically. A document build no longer carries SSO+integrations text (~446 tokens) it never uses; an app build no longer carries docx text (~382 tokens) it never uses — each type now pays only for its own base's structure.

## Against the A4 baseline

A4 measured ~2,700 est. tokens of STRUCTURAL instruction per build (the migration target). B4 migrates ~671 of those tokens (the three cleanly-type-specific, fully-base-covered sections) out of the always-on prompt. The remaining structural sections (canonical structure 160, output rules 390, data API 397, MANIFEST.md capabilities 693) are CROSS-TYPE (every app-type may use them) and stay in the always-on prompt for now — moving them requires each base to carry them, which is a larger follow-on the operator can sequence after reviewing this measured first cut.

## Honesty note

The shrink is MEASURED (char counts before/after), not asserted. The migration is a true move, not a delete: every removed API surface is now present in the base its type selects — SSO core AND the password flow (`passwordSignIn`/`setUserPassword`) in app `using-auth.md`; integration core AND the `load_context` / `integration-<key>` knowledge convention in app `using-integrations.md`; the docx toolbar/`exportPdf` format+landscape/`docx` import/`cloudFiles` + the "never deliver without working download buttons" rule in document conventions + the shipped scaffold. (The password-flow and `load_context` migrations were completed in a follow-on fix commit after both the codex slice review and the fresh review independently caught that the first B4 commit deleted them from SKILL.md without yet adding them to the bases — a genuine lossy-delete, now closed.) A base-load failure falls back to generic starters with the slimmer prompt — an accepted rare-path degradation (the base loader fails loud on a selected-but-broken base; only a genuinely missing base directory degrades). Verified live: an app build and a document build both still build + serve after the slimming (J3-style).
