# autothing run 20260717-202309-d797918a - report summary

Project: ekoa-code. Brief: test all the legal apps (artifacts) thoroughly and make them
genuinely useful for Portuguese lawyers - capabilities, UX, integrations.

Verdict: **completed-with-blockers** - all 8 slices passed every enabled gate
(gatesConfig all-true, none disabled); the sole downgrade from `passed` is the external
codex-checkpoint blocker below.

## What landed (8 slices, commits 3ca5827..bb42dbf + closing 5c13a1a)

- **S0 smoke-foundation** - 29-app smoke suite, /artifacts Invalid-Date fix, canonical
  legal-shared layer + scripts/sync-legal-shared.mjs (made the ported drift spec green).
- **S1 spine-productivity** - nucleo, agenda, agenda-reservas, kanban, tempos.
- **S2 court-deadlines** - prazos ferias judiciais/ICS/memoria de calculo, citius
  colar-split + triagem, apoio judiciario pack PDF, insolvencias lifecycle.
- **S3 money** - juros 2026 (Avisos citados), taxa de justica RCP, pre-faturas,
  conta-corrente CSV, cobrancas cartas + aging, injuncoes DL 269/98.
- **S4 drafting** - .docx com estilos reais, procuracao forense, precedentes, modelos
  deep-link, AcroForm autofill.
- **S5 records** - dossier PDF completo, manifesto de assinatura deterministico,
  transcricao keyboard-first, correio CTT honesto.
- **S6 compliance** - KYC mod-11 + radar de conservacao 7 anos (Lei 83/2017), RCBE
  beneficiarios + declaracao PDF (Lei 89/2017), conflitos art. 99 EOA, ferias CT goldens.
- **S7 knowledge-portal** - pesquisa fundamentada com fontes verificadas (anti-fabricacao),
  jurimetria com fonte DGPJ citada, portal do cliente com partilha explicita.

## Gates

- Per slice: test PASS, same-model review clean/resolved, fresh-context adversarial
  review approve (or needs-work with landed resolution: S4, S6), independent adversarial
  test pass (findings fixed forward: S5, S6), design audit clean, walkthrough video
  self-verified - **videos 8/8** (direct playwright-core recordVideo, honest substitute,
  frame-extraction vision verification, errors [] on every recording).
- Global: typecheck 0, lint 0 (247 pre-existing warnings), build 0 (isolated dist),
  verifyApp pass.
- Full-lane e2e (`npm run e2e`, live stack): **305/327 passed**. Every red (11 failed +
  10 did-not-run siblings) maps 1:1 to the pre-existing documented estate debt
  `findings.md e2e-estate-baseline-13` (band2 retired /api/v1/action protocol,
  3 integrations UI gaps, simuladores app source outside the repo) - none touch this
  run's diffs. This run **closed 2 of those 13**: legal-shared-drift (S0) and the
  legal-rcbe journey (S6). Drivers all green; web vitest 172/172.

## Blockers

1. **codex-checkpoint BLOCKED (external).** The cross-model security checkpoint could
   not run: the codex CLI OAuth refresh token is revoked ("refresh token was already
   used"), no OPENAI_API_KEY fallback, and re-auth is interactive-only. Remediation:
   `codex logout && codex login`, then re-run `autothing-codex-checkpoint` standalone
   against this run. Recorded in docs/decisions.md (2026-07-18) and
   evidence-index.json codexCheckpoint.status=blocked.
2. **e2e estate debt (pre-existing, unchanged scope).** The remaining 11 documented
   reds stay owed per docs/e2e-harness-remediation-brief.md; notes B/C in that brief
   need a director decision before the band2 migration can complete.

## Evidence

Run dir: docs/autothing/runs/20260717-202309-d797918a/ (FLOW_PLAN, per-slice
gate-status, evidence-index, walkthrough videos under slices/*/video/).
