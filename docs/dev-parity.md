# ekoa-dev parity ledger

`../ekoa-dev` (old Cortex, deployed at api.ekoa.io) keeps evolving while this repo is the
rebuild. Every upstream commit gets exactly one disposition here:

- **PORTED** - the functionality exists in ekoa-code (name the file or ref).
- **NOT-NEEDED** - it does not apply to the rebuild (state why).
- **OPEN** - functionality to bring here. An OPEN row is a live work item: it must end
  PORTED or NOT-NEEDED, never silently dropped (same discipline as `findings.md`).

`npm run parity:audit` fetches `../ekoa-dev`, lists upstream commits newer than the recorded
SHA below, prints row scaffolds, and exits non-zero while any commit is undispositioned.
Process: `.claude/skills/ekoa-dev-parity/SKILL.md`. Reference-access rules (read-only, never
copy secret values, runtime-truth validation before porting content): `docs/governance.md`.

**GitHub is not the source of truth for ekoa-dev.** On 2026-08-06 the audit reported "ledger
current" while four commits sat on the operator's other machine, committed and unpushed - the
whole served-app email plane among them. The audit therefore also fetches configured PEER
checkouts and reports commits they hold that `origin/main` does not. Peers are declared in the
marker below (or `EKOA_DEV_PEERS`), so the configuration travels with the repo rather than
living in one shell profile; an unreachable peer is a warning, never a pass.

<!-- parity-peers: madrid=ssh://dev-madrid/home/ggomes/dev/ekoa-dev -->

Last audited upstream commit: `9e6b96794b7b98dc1429b8ea6dc3e38388e5cf33` (2026-08-03, audited 2026-08-06)
Last audited peer commit (`madrid`): `c4f7f2c6` (2026-08-06, audited 2026-08-06) - UNPUSHED upstream.

## Dispositions

Audited range: `8214def2..9e6b9679` (the 23 commits on `origin/main` past the July merge base).

| upstream | date | subject | disposition |
|---|---|---|---|
| `613da39c` | 2026-07-10 | Zoho Sign v1 integration | PORTED - superseded upstream by `b5e1f414`; final form in `api/src/integrations/zoho-sign.ts` |
| `27aa0f0a` | 2026-07-11 | root README | NOT-NEEDED - upstream repo housekeeping |
| `b5e1f414` | 2026-07-20 | Zoho Sign rebuild merge + webhook-driven proposal advance | PORTED (`api/src/integrations/zoho-sign.ts`, `sign-agreements.ts`) EXCEPT the Zoho OAuth-popup connect - see `e620e740` row |
| `fff10809` | 2026-07-22 | email signed PDF to signers | PORTED - superseded upstream by `cfb3c8fb`/`2e301631`; final gated form present |
| `5aca300e` | 2026-07-22 | Word track-changes on .docx | PORTED (`api/src/services/docx-redline.ts`, `api/src/apps/document-source.ts`, `docs/word-track-changes.md`) |
| `6e95f0a9` | 2026-07-22 | durable server-side proposal advance on Zoho webhook | PORTED (`api/src/integrations/sign-agreements.ts`) |
| `9603c388` | 2026-07-22 | deploy gotchas docs | NOT-NEEDED - ekoa-dev/ekoa-deploy operational notes |
| `b4e5d869` | 2026-07-22 | deploy note correction | NOT-NEEDED - same |
| `cfb3c8fb` | 2026-07-23 | drop send_completed_document | PORTED - final gated form present |
| `2e301631` | 2026-07-23 | post-sign redirect_pages + gated signed-PDF email | PORTED (`api/src/integrations/zoho-sign.ts` redirect_pages + gate) |
| `9237711b` | 2026-07-23 | fragment-free post-sign return bounce | PORTED (`api/src/integrations/zoho-sign.ts` `GET /api/zoho-sign/return`) |
| `c79cd6a2` | 2026-07-24 | docx comment resolution + thread review | PORTED (`api/src/services/docx-comments.ts`) |
| `d8da6efd` | 2026-07-24 | route document work to the document base | PORTED (`api/src/agents/guided-build.ts`) |
| `5df604de` | 2026-07-24 | dev client base-URL rewrite over Tailscale/LAN | NOT-NEEDED - ekoa-code's dev harness terminates this at the `scripts/dev.mjs` CORS proxy |
| `8bff3f55` | 2026-07-27 | gate the workspace Graph proxy | PORTED - stronger design in `api/src/integrations/m365-proxy.ts` (app-id gate + manifest opt-in + owner activation). Auditing it found BOTH halves dead: the manifest flag was stripped by `validateManifest` and the token seam was a permanent not-connected stub. Both fixed this run - see `findings.md` `m365proxy-manifest-flag-stripped` and `workspace-graph-token-was-a-permanent-not-connected-stub` |
| `78e7421d` | 2026-07-27 | browser-level attacker-origin proof for `/api/m365/*` | OPEN - port the test class (real foreign origin + Chromium CORS) to the e2e suite |
| `ca446cb0` | 2026-07-29 | credential saves must merge, not replace the stored bundle | PORTED 2026-08-05 - `mergeCredentialValues` + `CLEAR_CREDENTIAL` in `api/src/integrations/service.ts`, suite `api/tests/integrations/credential-merge.test.ts`. Went further than upstream: the shadow and the non-secret projection are computed from the merged bundle too, an undecryptable blob refuses the write, and the dashboard's save became an UPSERT (`upsertConfig`) because here it posted `POST /configs` every time and forked a duplicate row |
| `e620e740` | 2026-07-29 | Zoho connect is OAuth-only for customers | PORTED 2026-08-06 - `api/src/integrations/zoho-oauth.ts` + the config package flipped to `authType: "oauth2"` with `client_id`/`client_secret` dropped from the customer-facing form (the two fields Chrome mistook for a login form and autofilled). Also ported the upstream commit the audit missed, `09a29bb7`, which is where the popup flow actually landed |
| `d8e4538e` | 2026-07-29 | OAuth connect clears pasted client credentials | PORTED 2026-08-06 - the callback clears `client_id`/`client_secret`/`grant_code` with `CLEAR_CREDENTIAL`. Ported WITH the test upstream never wrote: it has no coverage of the callback route at all, which is how this regression reached a customer |
| `323b81ae` | 2026-07-30 | chat attachment intake (zip expansion, office sidecars, composer drag/paste) | OPEN - chat feature, not required by the served-app plane; includes a folder-staging path-traversal fix worth reviewing against `api/src` upload paths |
| `3c8e3b3d` | 2026-07-30 | never commit `.backups/` | NOT-NEEDED - ekoa-code backups live on the app-data plane (`api/src/apps/backups.ts`), not a repo directory |
| `cc9eb6cb` | 2026-07-30 | show a pending chat row immediately on send | OPEN - verify against the rebuilt (Atrium) chat page; close or port |
| `9e6b9679` | 2026-08-03 | merge: drop local duplicate Zoho webhook advance | NOT-NEEDED - merge housekeeping; content covered by rows above |

## Peer dispositions (`madrid`) - work that never reached GitHub

Audited range: `9e6b9679..c4f7f2c6`, the four commits the operator made on `dev-madrid` on
2026-08-06 and did not push. They are invisible to `origin/main`, and therefore to production;
the peer audit above is what surfaces them.

| upstream | date | subject | disposition |
|---|---|---|---|
| `1d4eaf64` | 2026-08-06 | email delivery via Integrações + document extraction for served apps | PORTED 2026-08-06 - three pieces. (a) `capabilities` on `IntegrationAction` (`integrations/definitions.ts`) + `email-send` on the m365/google senders, so apps discover a sender by CLASSIFICATION and never by action name. (b) The email plane `integrations/app-email.ts` (`GET /integrations`, `POST /send`) - suites `integrations/app-email.test.ts` + `contract/app-email.test.ts`. (c) Document extraction `apps/app-vision.ts` + `apps/app-vision-route.ts` - suites `apps/app-vision.test.ts` + `contract/app-vision.test.ts`. **Diverges from upstream on purpose:** upstream dispatches with a synthesised admin actor and NO write gate, so a served page could send mail as the workspace unconditionally. Here the send goes through `callPlatformIntegration` with the OWNER as `actingUserId`, so the C2 consent gate binds and an unapproved send is refused with `awaiting_consent` and zero provider traffic. Also swapped `officeparser` for `pdfjs-dist` directly: v7 of it bundles tesseract.js, which fetches trained data at runtime - a second egress path this repo will not have |
| `fd209f70` | 2026-08-06 | provider email drafts + inbox notice + in-app assistant endpoint | PORTED 2026-08-06 (drafts) / NOT-NEEDED (assistant). Drafts: m365 `create_draft`/`send_draft`/`get_profile` and google `create_draft_simple`/`send_draft`/`get_profile` with `email-draft` / `email-draft-send` capabilities, plus `/draft`, `/draft/send`, `/inbox`. Both providers' drafts WRITE to the mailbox, so both are gated; `get_profile` is a read and joins the allowlist (`security/platform-write-gate.test.ts` pins the new mutating set). The in-app assistant is NOT-NEEDED: ekoa-code's `apps/app-assistant-route.ts` is the same endpoint, already further along (grounding + citations + action manifest + the H2 whoami detection) |
| `38365623` | 2026-08-06 | Cobranças featured artifact | PORTED 2026-08-06 - `api/assets/featured-artifacts/cobrancas/` (48 files, rank 30, v1.1.0). ADDITIVE, not a replacement: upstream keeps `legal-cobrancas` (rank 60) alongside it and so do we. Verified as runtime truth, not assumed: it seeds (42 featured, up from 41), builds, serves at `/apps/cobrancas/`, renders its full nav, auto-seeds its default profiles, reads the shared legal spine, and drives the newly-ported plane for real (`200 GET /api/app-email/integrations` returning the three capability-discovered senders) with ZERO console errors. TWO content defects fixed on the way in: (a) its `dados-omissao.test.mjs` resolved `seed-data.json` one directory too shallow, so the test ERRORED rather than asserting - it had never run, upstream included; fixed, and the invariant it guards (auto-seed and fork-seed are the same content) does hold. (b) its Definições page told the user "a plataforma não aplica qualquer confirmação adicional aos envios" - true of the old platform, FALSE here, where a send is a write behind the consent gate. Rewritten to state both approvals. This is the `governance.md` runtime-truth rule doing its job: ported content makes claims about a platform it was not written for |
| `c4f7f2c6` | 2026-08-06 | continuing a featured app edits it IN PLACE, never forks | PORTED 2026-08-06 (the real half) - `web/components/chat/chat-stripes.tsx` no longer forks, and `web/lib/featured-fork.ts` is deleted; regression suite `web/__tests__/components/chat-stripes-featured.test.tsx` pins the NEGATIVE assertion (fork is never called). NOTE: upstream's commit MESSAGE describes three changes but the commit contains only the file deletion - the other two are still uncommitted in dev-madrid's working tree. The `useAgentExecution` half is NOT-NEEDED here: ekoa-code already keys a follow-up on the artifact id alone and never sends a client-side project dir (the server resolves it), so the bug it fixes cannot occur |

### Open work this ledger opened

| item | disposition |
|---|---|
| The docx link/cloud ingest still holds the not-connected workspace stub - a build's tool call carries an appId but no owner down to `agents/seams.ts fetchFromCloud`, so it cannot name whose workspace to spend | OPEN - thread the run's owner through the seam, then wire it to `workspaceCredentials.accessToken` like the other two planes |
| ~~`zoho-sign/config.json` still `authType: "api_key"`~~ | CLOSED 2026-08-06 by the `e620e740` port |

### Standing gaps predating this ledger

| upstream | subject | disposition |
|---|---|---|
| `4f0e7ae7`+`4c05aa7f`+local `bd5ac057` | PWA platform (`services/pwa.ts`: `/apps/:ref/{manifest.webmanifest,pwa-icon-*.png,sw.js}`, brand-versioned icon URLs) | OPEN - being ported this run to `api/src/apps/pwa.ts` |
| - | local-only ekoa-dev commit `bd5ac057` (rebased from `31f94f9c`) is unpushed; also preserved on `backup/local-pwa-icon-31f94f9c` | operator decision pending: push or fold |
