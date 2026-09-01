# Leg B - the self-extension demo: mint -> guardrails -> trust -> deterministic re-use

Target: `s10-evidence`, a PRIVATE definition created by `admin` through the builder's own save path
(`PUT /api/v1/integration-builder/package`). `authType: "none"`, one hand-written read action
(`listar_utilizadores` -> `GET https://jsonplaceholder.typicode.com/users`). A baseline package like
`citius` cannot be authored into (`baseline_package` refusal), which is why the demo needs a
user-created row.

Caller for both achieve calls: a **gateway key**, minted at `POST /api/v1/gateway-keys`
(`00-gateway-key-minted.json`, secret redacted - it is returned exactly once and was never written
to disk), sent as `Authorization: Bearer ekoa_gk_…` with `x-client: s10-evidence-run`.

## 1. MINT - `01-achieve-authored.json`

Goal: *"listar as publicacoes (posts) de demonstracao com titulo e corpo"* - nothing existing fits.

```json
{ "outcome": "authored", "actionName": "listar_publicacoes", "state": "provisional",
  "forked": false, "requiresApproval": true,
  "verification": { "passed": true, "checks": [ shape, action_name, backing, transport,
                    origin, placeholders, no_pasted_secret, render ] },
  "ladder": [ { "rung": "reuse", "verdict": "skipped",
                "detail": "no existing action fits this goal, so one was written" },
              { "rung": "mint", "verdict": "taken",
                "detail": "wrote \"listar_publicacoes\" as provisional" } ] }
```

The persisted row (`02-definition-after-mint.json`) carries the whole authoring provenance:
`authoring.state: "provisional"`, `authoredBy`, `authoredAt`, the verbatim `goal`,
`declaredMutates: false`, `shape: "b4d7e2618e33ee3ff9471ea619cf2001"`, and the 8-check verification.
**The stored action is `mutates: true` even though the draft declared `false`** - a provisional
action is stored gated, so it cannot run until a person has looked at it.

## 2. THE GUARDRAILS, each one exercised rather than described

| Attempt | Answer | File |
| --- | --- | --- |
| Trust with a shape that is not the one shown | `VALIDATION_FAILED` - *"A ação mudou desde que foi apresentada. Reveja e confirme de novo."* | `03-trust-refused-wrong-shape.json` |
| Trust with the RIGHT shape, before any run | `VALIDATION_FAILED` - *"Esta ação ainda não foi executada com sucesso. Execute-a uma vez e confirme depois - a confirmação passa a assentar nessa execução."* | (same call, first attempt) |
| Run it while provisional | HTTP 403 `awaiting_consent`, with a `consentRequest` naming integration, action, description, `target: "GET https://jsonplaceholder.typicode.com/posts"` and `shape` | `04-execute-refused-awaiting-consent.json` |

That middle row is **S1 giving graduation teeth**: promotion is no longer a shape check, it rests on
a validated run, and the refusal says so in the user's own language.

## 3. THE HUMAN STEP - approved in the real UI

`B03-consent-dialog.png`: the write-consent dialog reached from the integration card
(*Minhas Integrações -> S10 Evidence (demo) -> Mostrar mais -> Autorizar*). It shows the
integration, the action, its description, **the exact request that will go out**, and the two
decisions with their own plain-language meanings ("permanente vale 90 dias", "única … é consumida
nessa execução"). Nothing in it says the word "Automação" - the D4 reword holds.

"Autorizar sempre" clicked -> `decision: "always"`, `expiresAt: "2026-11-21T02:18:29.367Z"`.

## 4. THE VALIDATED RUN, THEN TRUST

`05-validated-run.json` - a real 200 with 100 rows. Then trust with the shape the caller was shown:

```json
{ "ok": true, "actionName": "listar_publicacoes", "state": "trusted", "mutates": false }
```

`mutates: false` is the draft's own declaration taking effect: the person has now taken
responsibility, so the action stops being gated and becomes an auto-running read.
`B04-trusted-after.png` shows the badge flip to **Confirmada**, the consent chip to **Apenas
leitura**, "Executar agora" enabled, and the S1 evidence panel rendering the request sent plus the
truncated 200 response.

## 5. DETERMINISTIC RE-USE - `07-achieve-deterministic-reuse.json`

The byte-identical goal, the same gateway key:

```json
{ "outcome": "executed", "actionName": "listar_publicacoes",
  "result": { "success": true, "status": 200, /* 100 rows */ },
  "ladder": [ { "rung": "parametrize", "verdict": "skipped",
                "detail": "the caller supplied every argument the action declares" },
              { "rung": "compose", "verdict": "skipped",
                "detail": "the goal asks for nothing the action is not already named for" },
              { "rung": "reuse", "verdict": "taken" } ] }
```

### PROVEN

- The whole loop runs end to end on a live stack: **mint -> gate -> human consent -> validated run
  -> trust -> deterministic re-use**, and the second run of the same sentence mints nothing. The
  ladder's `mint` rung is absent from the second answer entirely; `reuse` is `taken`.
- A **gateway key can author but cannot bless its own work**: `achieve` is `user-or-key`, `trust` is
  `user`-only. Both halves were exercised with the key in hand.
- Every refusal in step 2 is a *different* refusal with its own message - shape drift, missing
  validated run, missing consent are three separate gates, not one.
- The authored action's target never left the origin the definition declares: the `origin` check is
  one of the 8, and the authored `baseUrl` is the definition's own.

### NOT PROVEN / gaps found

- **There is no UI for `trust`.** `trustAction` has zero callers anywhere in `web/` (checked across
  `web/app`, `web/components`, `web/stores`, `web/lib`). The detail page renders the
  *Escrita pelo assistente* / *Confirmada* badges but offers no control to move between them, so
  the graduation step of the self-extension loop can only be completed with a direct API call. The
  trust in this leg was therefore done over the API. Recorded in `docs/findings.md`.
- The *"Autorizar na página de integrações"* link on the detail page lands on `/integrations`
  **on the platform tab**, not on the user's own integration and not on the consent dialog - for a
  user-created integration the user must then find the "Minhas Integrações" tab and expand the card
  themselves. Recorded in `docs/findings.md` as a MINOR.
