# LANDING — autothing run 20260706-182515-9080f2cb (rc-1)

The rebuilt Ekoa/Cortex platform (api/ + web/ + shared/) built to `spec/` chapters 01-18, gated
by chapter 14's 18 phases (G-P..G13). This is the operator's post-run audit packet. Terminal
state: **completed-with-blockers** (a pre-existing e2e-baseline blocker, below — never a faked pass).

## Gates (18/18 tagged)

G-P, G0, G1, G2, G3, G4, G5, G6, G7, G7A, G7B, G8, G8A, G9, G10, G11, **G12**, **G13** → **rc-1**.
Every gate: full CI lane + security gates green, Claude + cross-model Codex review, a RUN_LOG
GATE entry, a checkpoint commit + tag. This session (664639ec, Fable 5) resumed at G12 (~60%)
and completed G12 + G13.

## What this session did

- **G12 final security phase.** 5 cross-model Codex scopes (bridge, anonymisation, whole-repo
  authz, migration-tooling, shared/) → **20 real findings fixed + regression-tested, 6 rebutted
  in writing**. Claude Code built-in full-repo security review → 2 medium (security-headers
  baseline D1/FIXED-14 added; per-app served-data plane accepted as byte-compat + documented).
  3 docs/security/ one-pagers (E5). Tag gate-12.
- **G13 terminal gate.** Diagram census + 12-entry deviation annex; both container images build
  (api + web, verified with `docker build`); deploy topology descriptors + validate + cutover
  dry-run (P-02/P-26); CI deploy lane workflow. Tag rc-1.

## Blockers (the completed-with-blockers cause)

**Pre-existing e2e:server baseline debt — NOT introduced by this session's work.** A fresh
`npm run e2e:server` (the first since the gate-9 tag; G10/G11 ran ci:lane only) is not
reproducibly green on committed content:
- **band1_zero_change** (13 web-dashboard specs) need a running Next dashboard on :3000 that the
  api-only `e2e-with-server.mjs` harness never starts. Prior "127/127" relied on the operator's
  local garrison web running separately.
- **band2 specs** (artifacts-apps-section, artifact-backend-panel, update-from-bundle,
  vertical-profile) still POST to the **FIXED-2-retired `/api/v1/action`** → HTML 404.
- **4 erp-* drivers** need the out-of-catalog **brasilsalomão** ERP fork (committed
  erp-imobiliario uses an accessCode gate, not app-sso email login) → **retargeted G9→CUTOVER**.

Fixed this session: demos.spec provisioning (`ensureDemosSpine` mirrors api/assets/demos). The
G12 security-headers change is **exonerated** — the Núcleo client-side seed succeeded through the
served-app CSP; the web dashboard boots clean under the dashboard CSP. Full forensics in the two
2026-07-08 Phase-12 RUN_LOG DEVIATIONs.

## Needs human eyes

1. **e2e-baseline repair (recommended, dedicated effort):** make `e2e-with-server.mjs` full-stack
   (start the web dashboard — a prototype this session confirmed it boots clean under the CSP);
   REST-migrate the 4 band2 specs off `/api/v1/action`; reconstitute (or formally retire) the
   brasilsalomão ERP fork. This is G6-G9-era work deliberately not redone here.
2. **Diagram .png re-export:** no headless Excalidraw renderer is available; the `.excalidraw`
   sources are authoritative and current. No source edit was owed this run (see the census), so
   the .png set is current — noted for the periodic-audit cadence.
3. **Deploy is dry-run only.** Both images build and the cutover plan is well-formed, but NO
   cutover / production deploy was performed. The old ekoa-deploy pipeline is untouched. Staging,
   parity rounds, and the upstream swap are ch10's founder-gated procedure, outside this run.
4. **Owner actions (spec ch09/ch10):** MFA on admin surfaces (A5), EU region pin (C1), least-priv
   service accounts + dev/prod separation (D5), the vendor register (E4), the EU AI Act check (E6).

## Deviations / decisions
12 DEVIATION entries (enumerated in `docs/diagram-census-and-deviation-annex.md`), the run's
DECISION/AMBIGUITY entries, and the RESUME entry (this session's stale-lock takeover from
edcc57e1; Fable 5 → Fable 5) are in RUN_LOG.md. Friction observations in
`docs/autothing/friction-log.md`. No model-fallback events this session.

## Audit surface
`RUN_LOG.md` (append-only), git `gate-*` + `rc-1` tags, `docs/autothing/runs/20260706-182515-9080f2cb/`
(evidence-index.json, the codex-checkpoint-*.json verdicts + triage docs, this LANDING).
