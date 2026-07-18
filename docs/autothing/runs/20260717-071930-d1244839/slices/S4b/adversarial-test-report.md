RESULT: pass

# S4b independent functional test - `/settings/api-keys` (per-user gateway API keys)

Fresh-context functional test. I did not read the implementation diff or the committed
test spec. Every selector below was discovered from the **live DOM** (I dumped `[data-testid]`,
inputs, buttons and row `outerHTML` from the running app before writing any assertion), and
every acceptance point was observed against the running stack.

- **Probe (reproducible):** `docs/autothing/runs/20260717-071930-d1244839/slices/S4b/adversarial-probe.mjs`
- **Run:** `cd /Users/ggomes/dev/ekoa-code && node docs/autothing/runs/20260717-071930-d1244839/slices/S4b/adversarial-probe.mjs`
- **Result:** 35/35 checks pass, exit 0, 0 console errors. Ran **4 consecutive times** - deterministic, mints a fresh uniquely-labelled key each run.
- Nothing was written under `web/e2e/` (census gate untouched).

## Verdict per acceptance point

| # | Acceptance | Observed | Verdict |
|---|---|---|---|
| 1 | Authenticated user reaches `/settings/api-keys`; sidebar entry "Chaves de API"; mint form | Sidebar `a[href="/settings/api-keys"]` with `title="Chaves de API"`; probe **clicks the sidebar entry** (not a direct goto) and lands on the page; `gateway-key-label-input` (placeholder `ex.: portátil do trabalho`) + `Criar chave` button | PASS |
| 2 | Show-once panel: full secret `ekoa_gk_`, copy button, not-shown-again warning, config snippet | Secret len 51, prefix `ekoa_gk_`; `Copiar chave` button; warning "Esta chave não volta a ser mostrada. Copie-a e guarde-a num local seguro."; snippet `ANTHROPIC_BASE_URL=http://localhost:4111/api/v1/llm` + `ANTHROPIC_AUTH_TOKEN=<exact minted secret>` (string-compared against the secret, not pattern-matched) | PASS |
| 3 | Row: label, `ekoa_gk_...`+last-4 hint, created date, Active | `probe-key-…` / `ekoa_gk_...xU6c` (asserted **equal** to `ekoa_gk_...` + `secret.slice(-4)`) / `7/17/2026` / `Ativa`; full secret asserted **absent** from the row | PASS |
| 4 | After reload secret is gone entirely (incl. page source), row remains | Panel gone; secret absent from visible text, from the **rendered DOM** (`page.content()`), and from the **raw page source** (`fetch` of the route HTML, 21729 bytes); row + hint still present | PASS |
| 5 | Revoke requires inline confirm; then status Revoked and revoke control disappears | Clicking `Revogar` does **not** revoke - it swaps in an inline confirm ("Revogar esta chave? As ferramentas que a usam deixam de funcionar de imediato.") with confirm+`Cancelar`; status stays `Ativa` and **the API still returns 200** while the confirm is pending; after confirming → `Revogada`, and both revoke and confirm controls are gone; survives reload | PASS |
| 6 | API enforces it: 200 before revoke, 401 after | Before: `HTTP 200 {"input_tokens":8}`. After: `HTTP 401 {"type":"error","error":{"type":"authentication_error",...}}` | PASS |
| 7 | Zero console errors | 0 console errors and 0 page errors across login → mint → copy → reload → revoke → reload, on every run | PASS |

## Extra probes I ran beyond the stated acceptance

- **Copy button really copies.** Granted clipboard permissions and read it back: `clipboard === secret` exactly. The button is not decorative.
- **Cancel path.** `Cancelar` aborts the revocation cleanly - back to `Ativa` + `Revogar`, key still accepted by the API (200). The confirm is a real gate in both directions, not a one-way animation.
- **API-level secret-leak check.** The UI hiding the secret would be worthless if the API handed it back. `GET /api/v1/gateway-keys` (admin JWT) returns only `{id, label, secretHint:"xU6c", createdAt, revokedAt, lastUsedAt}` - the last-4 only. A regex for full-secret-shaped strings (`ekoa_gk_[A-Za-z0-9_-]{20,}`) over the whole response body: **no matches**. `id` is a 64-hex (sha256-shaped) lookup handle, not the secret. So AC3's "NEVER the full secret" holds at the API, not just cosmetically in the DOM.
- **Bogus key rejected.** `Authorization: Bearer ekoa_gk_bogusbogusbogus` → 401, so the 401-after-revoke is not an artifact of some blanket rejection of the prefix.
- **`lastUsedAt` tracks real use.** The row's "Última utilização" flipped from "Nunca usada" to a date after my `count_tokens` call - the gateway is genuinely metering the key.

## Environment finding (not an S4b defect, but it gates AC6)

The stack as handed to me had **no upstream model credential**: `/health` reported
`claudeAuth:{"ok":false,"configured":false}`. In that state the ACTIVE key's `count_tokens`
answers **503** `{"type":"error","error":{"type":"credential_error"}}`, not 200 - so AC6's
"must answer 200" is unreachable until the credential is provisioned. I provisioned it with
the repo's documented per-boot step and re-tested:

```
node scripts/dev-credential.mjs --no-browser --provision
# → claudeAuth={"ok":true,"configured":true,"mode":"oauth"}
```

after which the active key returns `HTTP 200 {"input_tokens":8}`.

Worth noting as a **positive** observation about the implementation: unprovisioned, the
active key still got a **503 credential_error**, distinctly *not* a 401. Auth had already
succeeded and only the upstream call failed. The gateway does not collapse an infrastructure
failure into an authentication failure, so the 401-after-revoke is genuinely revocation and
not noise. Anyone re-running this probe must provision the credential first, or AC6a fails
for environmental reasons.

## Probe robustness note

My first draft of the probe was flaky on **login** (not on the feature): `fill()` can land
before React hydrates, the input event is dropped, and the `Entrar` button stays `disabled`
forever. Run 1 passed, run 2 timed out at the login click. I fixed it in my harness by
re-filling until the submit button actually enables. This is a generic Next.js hydration
race in my driver, it is **not** an S4b defect and no acceptance point depends on it - but
it is the reason the probe has a retry loop around login rather than a bare `fill`+`click`.

## Probe output (final run, exit 0)

```
PASS  AC1.sidebar-entry-exists :: href=/settings/api-keys count=1
PASS  AC1.sidebar-entry-labelled-Chaves-de-API :: title="Chaves de API"
PASS  AC1.sidebar-click-lands-on-page :: http://localhost:3000/settings/api-keys
PASS  AC1.mint-form-input-visible :: ex.: portátil do trabalho
PASS  AC1.mint-form-button-visible :: Criar chave
PASS  AC2.panel-visible
PASS  AC2.secret-prefix-ekoa_gk_ :: secret.len=51 prefix=ekoa_gk_
PASS  AC2.copy-button-present :: Copiar chave
PASS  AC2.copy-button-copies-exact-secret :: clipboard === secret
PASS  AC2.explicit-not-shown-again-warning :: "Esta chave não volta a ser mostrada. Copie-a e guarde-a num local seguro."
PASS  AC2.config-has-ANTHROPIC_BASE_URL :: "ANTHROPIC_BASE_URL=http://localhost:4111/api/v1/llm"
PASS  AC2.config-has-ANTHROPIC_AUTH_TOKEN-exact-secret :: token line matches minted secret: true
PASS  AC3.row-has-label :: "probe-key-mrou0ux6"
PASS  AC3.row-hint-is-truncated-last4 :: got="ekoa_gk_...xU6c" expected="ekoa_gk_...xU6c"
PASS  AC3.row-NEVER-shows-full-secret :: full secret absent from row
PASS  AC3.row-has-created-date :: "7/17/2026"
PASS  AC3.row-status-active :: "Ativa"
PASS  AC6a.active-key-count_tokens-200 :: HTTP 200 body={"input_tokens":8}
PASS  AC6a.active-key-returns-input_tokens :: input_tokens=8
PASS  AC4.panel-gone-after-reload
PASS  AC4.secret-absent-from-visible-text
PASS  AC4.secret-absent-from-rendered-DOM
PASS  AC4.secret-absent-from-page-source :: raw source 21729 bytes
PASS  AC4.row-still-present-after-reload
PASS  AC4.hint-still-shown-after-reload
PASS  AC5.inline-confirm-appears
PASS  AC5.cancel-affordance-present
PASS  AC5.still-active-before-confirming :: status still Ativa while confirm pending
PASS  AC5.api-still-accepts-before-confirm :: HTTP 200
PASS  AC5.cancel-aborts-revocation :: cancel returns to Ativa + Revogar button
PASS  AC5.status-flips-to-revoked
PASS  AC5.revoke-control-disappears :: no revoke/confirm control on the revoked row
PASS  AC6b.revoked-key-count_tokens-401 :: HTTP 401 body={"type":"error","error":{"type":"authentication_error","message":"Invalid or missing API key / JWT"}}
PASS  AC5.revoked-persists-after-reload
PASS  AC7.zero-console-errors :: none

================ SUMMARY ================
label under test : probe-key-mrou0ux6
checks           : 35
failed           : 0
console errors   : 0
RESULT: pass
```

## Residue

The probe leaves one revoked, uniquely-labelled key per run in the list (revoked keys are
never deleted by design). Runs from this session are labelled `probe-key-*`; they are inert
(401) and harmless, but they do accumulate in the table.
