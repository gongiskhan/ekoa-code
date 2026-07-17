VERDICT: approve

Fresh-context adversarial review of commit `4f55327` (S4b, gateway-keys settings UI), re-reviewed after fix commit `7544456`. Scope: the commits' files only. Evidence gathered independently; the stack was not booted and the Playwright spec was not executed (per brief).

> **Status:** the original verdict below was `needs-work` on findings 1-4. Findings 1, 2 and 3 are **verified closed** in `7544456` - see [## Re-review](#re-review) at the end, which also records what remains open (non-blocking). The original review is preserved unedited for the record.

## Evidence

### Gates (run from repo root, this working tree)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** - shared, api, web all clean, no output |
| Lint | `npm run lint` | **PASS** - `0 errors`, 217 warnings (10 + 217 across the two lanes), **all pre-existing**; zero findings in any file added by this commit |
| Web unit | `npm test --workspace web` | **PASS** - 31 files, 172/172 tests |
| Ledger census | `npm run gate:ledger \| grep census` | **PASS** - specs 67/67, drivers 23/23, frontend unit 31/31 |

`gateway-keys` is present in `api/tests/SUITE_LEDGER.json` at `/playwright/band4_gap_plan/specs[6]` - the claimed band4 row exists and the census reconciles.

### Mechanical verifications (all clean)

- **Locale key parity** - extracted the `pages_gatewayKeys` block from `types.ts`/`pt.ts`/`en.ts` by brace-matching and diffed the key sets: **26 / 26 / 26, exact three-way match**. No runtime-breaking gap in either language. Keys: `title, subtitle, mintLabel, mintPlaceholder, mintButton, minting, showOnceTitle, showOnceWarning, copyKey, copied, dismiss, configTitle, configHint, listTitle, listEmpty, colLabel, colKey, colCreated, colLastUsed, colStatus, statusActive, statusRevoked, neverUsed, revoke, revokeConfirm, cancel`. The `useTranslation` spread in `stores/i18n.ts:77` is wired.
- **Spec selectors** - cross-checked all 12 `getByTestId` calls in `web/e2e/gateway-keys.spec.ts` against the page's `data-testid` attributes: **12/12 resolve**. The spec compiles under `tsc --noEmit` (web typecheck covers `e2e/`).
- **Primitive prop forwarding** - `Card` (`...rest` onto `Comp`), `Input` (`...rest` onto `<input>`, so `maxLength={64}` and `data-testid` both land), `Button` (`...rest` onto `<button>`; `danger-ghost` variant and `loading`/`icon` props exist), `PageShell` (`testId` prop). Every selector the spec relies on will actually render.
- **No emoji** - scanned the three new source files against the emoji/dingbat/arrow ranges: **none**. Standing rule respected.
- **Secret hygiene** - `stores/gateway-keys.ts` uses bare `create()` with **no `persist` middleware**; no `localStorage`/`sessionStorage` reference; no `console.*` in the page or the store; `web/lib/api/core.ts`/`index.ts`/`errors.ts` contain no response-body logging. The secret never reaches storage or logs. On dismiss, `clearMinted()` nulls `mintedKey`, unmounting the `<code>` and `<pre>` - it does not linger in the DOM. On reload the store is reconstructed empty. **Clean.**
- **Config snippet correctness** - `resolveUrl('/api/v1/llm')` -> `resolveBaseUrl()`. Dev (env=`http://localhost:4111`): keeps the port, adopts the browser hostname -> correct over localhost and over LAN/Tailscale. Prod distinct origin (`https://api.ekoa.io`): verbatim -> correct. Same-origin Caddy: browser branch returns `${protocol}//${hostname}` -> correct. Snippet shape matches acceptance exactly (`ANTHROPIC_BASE_URL=<origin>/api/v1/llm`, `ANTHROPIC_AUTH_TOKEN=<key>`).
- **Server contract alignment** - `secretHint: secret.slice(-4)` (`gateway-keys-service.ts:62`) matches the page's `ekoa_gk_...{secretHint}` render and the spec's `secret.slice(-4)` assertion. `listGatewayKeys` sorts newest-first; the store's optimistic prepend matches that order. The optimistic row `{id, label, secretHint, createdAt}` is a valid `GatewayKeySummary` (`revokedAt`/`lastUsedAt` optional) and renders Active + "Never used" correctly.
- **No AdminGate is correct** - `routes/gateway-keys.ts` is `auth: 'user'`, stamps the owner from the verified JWT, and answers uniform 404 on a foreign id. Server-scoped as the acceptance states.
- **Nav entry** - bottom group, `KeyRound`, `activePrefix: "/settings/api-keys"`. The hardcoded PT label `"Chaves de API"` is the **documented** pattern (`navigation.ts:31-34`: raw PT-PT label for net-new surfaces with no sidebar i18n key), consistent with Registo/Pedidos/Escritórios/Privacidade. Longest-prefix resolution in `activeNavHref` means it wins over `/settings`. Not a finding.

### Hypotheses I investigated and DROPPED as ungroundable

- **SSR throw via `resolveUrl` at render top-level (page.tsx:32).** `resolveBaseUrl()` throws on the server branch when `NEXT_PUBLIC_API_URL` is empty, and this page is the first unconditional render-time caller. **Dropped:** `next.config.ts:57` inlines `NEXT_PUBLIC_API_URL: resolveApiUrl()`, and `resolveApiUrl()` (lines 15-30) always returns a non-empty string or throws at build time. The empty-string branch is unreachable in any build that exists. No exposure.
- **Hydration mismatch from `gatewayBase`.** `gatewayBase` is computed every render but only *rendered* inside `{mintedKey && ...}`, which is null on first paint. Nothing mismatched lands in the SSR HTML.
- **Revoke double-click double-fires / corrupts state.** `revokeGatewayKey` (`gateway-keys-service.ts:96-104`) is **explicitly idempotent** (`if (!doc.revokedAt)` guard, returns `true` either way). A double-fire is harmless.
- **Optimistic revoke lies if the API fails.** It does not - the store applies `revokedAt` **only inside `if (response.ok)`**; a failure sets `error` and leaves the badge Active. Correctly non-optimistic.
- **Em dashes in `en.ts`/`pt.ts`.** Lines 1055/1076 and 1056/1077 contain them, but they are **pre-existing** and outside this commit's hunks (which touch ~692-720). Not attributable.
- **Key `id` = sha256(secret) exposed in the DOM/URL.** Preimage-resistant over 256 bits of entropy; not invertible, not exploitable. Also S4a scope, not this commit.

## Findings

### 1. [MATERIAL - blocker] Bare `navigator.clipboard.writeText` on the show-once secret: no try/catch, no fallback, bypasses the repo's own `copyToClipboard` helper

`web/app/(dashboard)/settings/api-keys/page.tsx:42-47`

```js
async function copyKey() {
  if (!mintedKey) return;
  await navigator.clipboard.writeText(mintedKey.key);   // <- unguarded
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
}
```

invoked at line 92 as `onClick={() => void copyKey()}`.

**This is the only bare clipboard call in `web/`.** Every other call site either imports the existing helper `copyToClipboard` from `@/lib/clipboard` (5 files: `chat/[[...sessionId]]/page.tsx:1870`, `artifacts/page.tsx:862,1776,1786`, `integration-dialog.tsx:808`, `output-panel.tsx:514`) or wraps the raw call in try/catch (`WebhooksSection.tsx:37-44`, `bridge-install-section.tsx:39-46`, `chat-panel.tsx:946`, `DemoOverlay.tsx:54`). `web/lib/clipboard.ts` exists **precisely for this**: it feature-detects `navigator.clipboard?.writeText`, try/catches it, and falls back to a `document.execCommand('copy')` textarea path that works where the Clipboard API does not.

**Failure scenario.** The Clipboard API is gated on secure contexts, so `navigator.clipboard` is `undefined` over plain `http://` on a non-loopback host. `web/lib/api/base-url.ts:10-12,34-39` explicitly designs for exactly that access path ("the app reached over a LAN/Tailscale address"), and this project routinely serves over Tailscale. A user on `http://100.x.x.x:3000/settings/api-keys` clicks **Copiar chave**:
1. `navigator.clipboard.writeText` throws `TypeError` synchronously inside the async fn -> rejected promise -> `void` discards it -> **unhandled promise rejection logged to the console as an error**. (The repo's standing rule is zero console errors on dashboard-touching specs; this spec asserts it but never clicks Copy, so it does not catch this.)
2. `setCopied(true)` never runs -> the button never flips to "Copiada" -> **the user gets no signal at all that the copy failed**.
3. The user clicks **"Já guardei a chave"** (dismiss) -> `clearMinted()` -> the secret is gone from state and DOM, and is **unrecoverable by design** (`GatewayKeyMintResponse` is the only time the plaintext ever exists; `gateway-keys-service.ts:4-8` stores only the sha256). They must mint a replacement and revoke the orphan.

The same silent-failure path opens on a `NotAllowedError` (document not focused / permission denied) even on HTTPS.

Severity is driven by the asymmetry: this is the **one irreversible moment in the whole flow**, and it is the only unguarded action in it. Mitigation is that the secret stays on screen for manual selection - but the user has no reason to select it manually, because a failed copy is indistinguishable from a successful one.

**Fix:** use the existing helper and surface the failure.
```js
import { copyToClipboard } from '@/lib/clipboard';
// ...
async function copyKey() {
  if (!mintedKey) return;
  if (await copyToClipboard(mintedKey.key)) {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } else {
    // surface a failure the user can act on (the secret is still on screen)
  }
}
```
This needs a `pages_gatewayKeys.copyFailed` string in all three locale files to keep the parity that is currently clean.

### 2. [Minor] Em dash introduced in `web/e2e/gateway-keys.spec.ts:4` - violates the standing repo rule

```
 * Per-user gateway API keys page (S4b, run 20260717-071930-d1244839) — REAL end-to-end, no
```

The rule is plain dash only. This is the **only** em dash this commit adds (the store and page docstrings correctly use `-`; the `en.ts`/`pt.ts` occurrences are pre-existing). Mechanical one-character fix.

### 3. [Minor-moderate] Show-once panel has no live-region role - deviates from the devices-page pattern the acceptance cites

`page.tsx:83` renders the show-once `Card` with no `role`/`aria-live`. The error `<p>` at line 76 correctly carries `role="alert"`, so the omission is inconsistent even within the file.

The acceptance names the devices page as the pattern, and `settings/devices/page.tsx:107-115` renders its outcome with **`role="status"`**. A screen-reader user who activates "Criar chave" gets **no announcement** that the secret - the one thing they must act on before it is gone forever - has appeared; focus stays on the mint button while the panel renders below. The "Copiada" transition is likewise unannounced.

**Fix:** `role="status"` on the show-once Card (matching the cited pattern), and an `aria-live` region or `aria-label` swap for the copy outcome.

### 4. [Minor-moderate] The committed spec does not pin three acceptance clauses whose testids exist

Mechanical cross-check of page testids vs spec assertions - defined but **never exercised**: `gateway-key-copy`, `gateway-key-dismiss`, `gateway-key-revoke-cancel` (plus `gateway-key-error`, `gateway-key-empty`).

Two of these are explicit acceptance language:
- *"inline revoke confirm (**two-step, cancellable**)"* - the cancel path has **zero** coverage. A regression that makes Cancelar fire the revoke would ship green.
- *"a copy button"* - unexercised, which is also why finding 1 survives CI.

The dismiss path is what makes the "held only until dismissed" claim true, and it too is unasserted.

The spec's **core** assertions do correctly pin the headline acceptance: `toHaveCount(0)` on the panel plus `expect(await page.content()).not.toContain(secret)` after reload genuinely proves show-once, the row-survives check is real, and the badge flip is asserted through the live API. That part is good work. The gap is the three secondary clauses.

### Non-blocking observations (no action required)

- `mintedKey` survives client-side route changes (module-scoped Zustand, no unmount cleanup), so navigating away and back re-shows the panel until dismissed. This matches the acceptance verbatim ("mintedKey held only until dismissed") and clears on reload, so I am **not** raising it as a finding - but it is worth knowing the "exactly once" guarantee is about non-retrievability, not about a single view.
- `clearError` is exported by the store and never consumed by the page (mirrors the `users.ts` pattern; harmless).
- During a mint from an empty list, `isLoading && keys.length === 0` briefly renders the list body as `null`, so the "no keys yet" copy flickers out. Cosmetic.
- A revoke failure renders its error in the mint Card at the top of the page, far from the row that failed. Cosmetic.

---

**Verdict rationale:** finding 1 is material, evidence-backed, and cheap to fix - an unguarded failure on the single irreversible step of the flow, in the one place in the codebase that ignores a purpose-built helper that 9 other call sites use. Findings 2-4 are individually minor but should land in the same fix. Everything else the brief asked me to attack - secret lifetime in state/DOM/storage/logs, snippet correctness in dev vs prod, locale parity, optimistic-revoke honesty, double-fire, nav/i18n wiring, testid resolution, and the reload-hides-secret + badge-flip assertions - came back **clean and verified**.

---

## Re-review

Re-review of fix commit `7544456` against the three claimed closures. Evidence re-gathered from scratch on the current working tree; claims in the handoff were **not** taken at face value.

### Gates (re-run)

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** - shared, api, web clean |
| `npm run lint` | **PASS** - `0 errors` (10 + 217 warnings, all pre-existing); **zero findings in any S4b file** |
| `npm test --workspace web` | **PASS** - 31 files, 172/172 |

### Finding 1 (blocker: bare clipboard) - CLOSED, verified

- `page.tsx:11` imports `copyToClipboard` from `@/lib/clipboard`; `page.tsx:50` is `const ok = await copyToClipboard(mintedKey.key);`. A regex scan for a real `navigator.clipboard.writeText` **call** returns nothing - the only remaining `navigator.clipboard` string in the file is the explanatory comment at line 47. The guarded helper (feature-detect -> try/catch -> `execCommand` textarea fallback) is now on the path, so the LAN/Tailscale http case degrades to the fallback instead of throwing.
- The silent-failure half is closed too, which is the part that actually mattered: `setCopyState(ok ? 'copied' : 'failed')` consumes the helper's boolean, and `page.tsx:110-114` renders `{copyState === 'failed' && <p role="alert" data-testid="gateway-key-copy-failed">{t.copyFailed}</p>}` **while the secret is still on screen**. The unhandled rejection is gone (the helper never throws; it returns `false`), and the user now gets an actionable signal before dismissing an unrecoverable secret.
- The new `copyFailed` copy is correct PT-PT and gives the right instruction rather than just reporting failure: *"Não foi possível copiar automaticamente. Selecione a chave acima e copie-a manualmente."* No em dash.

### Finding 2 (em dash) - CLOSED, verified

Swept all four S4b source files: **0 em dashes** in `page.tsx`, `gateway-keys.spec.ts`, `stores/gateway-keys.ts`, `lib/navigation.ts`. The spec docstring now reads `- REAL end-to-end`.

### Finding 3 (live region) - CLOSED, verified

`page.tsx:97` - the show-once `Card` carries `role="status"`, matching `settings/devices/page.tsx:107-115` (the pattern the acceptance cites). `Card` forwards it correctly: `CardProps extends React.HTMLAttributes<HTMLElement>` and spreads `...rest` onto the element, so `role` lands on the rendered div (and typecheck accepts it). The copy outcome additionally gets `role="alert"` on the failure path.

### Locale parity (re-checked mechanically)

Re-ran the brace-matching key extraction: **27 / 27 / 27, exact three-way match**, `copyFailed` present in `types.ts`, `pt.ts` and `en.ts`. Parity held across the fix.

### Codex's parallel finding (revoke in-flight guard) - functionally closed, with a dead prop

The guard is real and works: `submitRevoke` short-circuits on `if (revokingId) return;` (`page.tsx:56`), and both row buttons carry `disabled={revokingId !== null}`, so no second revoke can be dispatched while one is pending. Combined with the server's already-idempotent `revokeGatewayKey`, this surface is sound.

One inaccuracy in the handoff's description, for the record: the buttons **disable but never spin**. `submitRevoke` calls `setConfirmingId(null)` *before* `setRevokingId(id)`; React batches both into one re-render, so that render has `confirmingId === null` and the ternary at `page.tsx:162` swaps the confirm button out for the plain (disabled) revoke button. The confirm button's `loading={revokingId === k.id}` prop therefore **never renders a spinner** - it is dead code. Harmless (the in-flight feedback is the disabled state), but the prop should be dropped or the two `setState` calls reordered if a spinner was actually wanted.

### Still open (non-blocking, carried forward)

- **Original finding 4 was not addressed.** The spec is unchanged apart from the docstring: still **1 test, 12 testids asserted**. Unexercised: `gateway-key-copy`, `gateway-key-copy-failed`, `gateway-key-dismiss`, `gateway-key-revoke-cancel`, `gateway-key-error`, `gateway-key-empty`. Two are explicit acceptance clauses (*"a copy button"*, *"two-step, **cancellable**"*). Worth naming plainly: **the fix for the blocker finding has no committed regression test** - `gateway-key-copy-failed` is new code with zero coverage, and `CLAUDE.md` QA layer 3 says findings are closed by a deterministic test or a written dismissal, never silently. The failure path is deterministically testable (`page.addInitScript` to strip `navigator.clipboard` and stub `document.execCommand` to return false, then assert the alert renders and the secret is still visible). This did not block approval because it was never the material finding - but it should be closed by a test or an explicit dismissal in `docs/findings.md`.
- **`copyState` is not reset when a new key is minted** (nothing in `submitMint` or `clearMinted` touches it; `page.tsx:34-42`). After a failed copy, `copyState` stays `'failed'` with no timeout, so minting a *second* key renders the copyFailed alert on the fresh panel before the user has clicked Copy. The message stays truthful for that user (a non-secure context does not change between mints), so this is cosmetic. The mirror case - `'copied'` surviving a dismiss+mint within its 2s timeout, making the new panel claim "Copiada" for an uncopied key - is the more misleading one but is effectively unreachable, since minting requires typing a fresh label. One line fixes both: `setCopyState('idle')` in `submitMint` (or on dismiss).

### Verdict

**approve.** All three findings I raised as blockers-or-alongside are genuinely closed, verified independently rather than on report: the material one (finding 1) is closed on both halves that mattered - the unguarded call is gone *and* the failure is now visible while the secret is still recoverable. Gates are green, locale parity held at 27/27/27, and no regression was introduced by the fix. The items left open are a coverage gap and a cosmetic state-reset nit, neither material; both are recorded above so they can be closed deliberately rather than forgotten.
