# Slice C3 — In-Page Action Runtime — impl notes

The thin client that executes a generated app's declared `ui_actions` inside the
served app, plus its serve/inject wiring, the base skill that makes real builds
emit manifests, and a committed test. Follows the demo-bridge precedent exactly:
plain browser IIFE, byte-served at `/__ekoa/...`, injected into every document,
origin-pinned from the first init that matches `document.referrer`.

## Files (the 5 reserved paths + these notes)

1. **`api/assets/action-runtime-client.js`** (new) — the runtime IIFE. Sibling to
   `demo-bridge-client.js`, same style (ES5-ish `var`/function-expressions, no
   build step, no imports, `'use strict'`, install-once guard
   `window.__ekoaActionRuntimeInstalled`). No-op until an `actions.init` arrives.
2. **`api/src/apps/serving.ts`** (edited) — read-once-at-boot `actionRuntimeSource`
   with the same unavailable-fallback as `demoBridgeSource`, and
   `GET /__ekoa/action-runtime.js` next to the demo-bridge route (identical
   headers: `application/javascript; charset=utf-8`, `ACAO: *`, `max-age=300`).
3. **`api/src/apps/injected-context.ts`** (edited) — appended
   `<script src="/__ekoa/action-runtime.js"></script>` right after the demo-bridge
   tag, before `</head>`. Purely additive; the byte-compat `toContain` assertions
   in `served-app.test.ts` still hold (verified: 19/19).
4. **`api/assets/bases/app/skills/declaring-ui-actions.md`** (new) — terse base
   skill teaching the coding agent to DECLARE `ui_actions` in `MANIFEST.md`
   frontmatter (bare-list shape, the `data-demo-target` namespace sharing, the two
   optional runtime hooks). Mirrors the tone/length of the sibling base skills.
   This is what makes real builds emit manifests (C2 captures them at activation).
5. **`api/tests/apps/action-runtime.test.ts`** (new) — committed re-runnable
   assertions (11 tests, all pass).

## Protocol implemented

Envelope `{ __ekoaActions: 1, type, ... }`.

- Host→app: `actions.init {hostOrigin}`, `actions.execute {id, action}`,
  `actions.cancel {id}`.
- App→host: `actions.ready {targets}`,
  `actions.result {id, status:'done'|'failed'|'cancelled'|'confirm-pending', detail?}`,
  `actions.error {id, reason}`, `actions.tour-request {id, tourId}`.

Origin pinning copies the demo bridge in spirit: pin `hostOrigin` from the FIRST
`actions.init` whose `e.origin` matches `refererOrigin()` (accept + pin when the
referrer is absent); every later message must match the pinned origin; every reply
is posted with the explicit `targetOrigin`.

## Execution semantics (all through user-EQUIVALENT events, so app validation runs)

- **navigate** — `window.__ekoaApp.navigate(route)` first; else hash routes →
  `location.hash`, path routes → `history.pushState` + a dispatched `popstate`.
- **setField** — `[data-demo-target]` → inner input/textarea/select, value set via
  the NATIVE setter (`Object.getOwnPropertyDescriptor(proto,'value').set.call`) then
  bubbling `input`+`change` (React sees the change). Value from `params.valor|value`.
- **toggle** — real `.click()` on the checkbox/switch/button.
- **select** — native-setter value (`params.value`) or option `index`, then `change`.
- **highlight** — spotlight ring mirrored from demo-bridge `drawOverlay` minus the
  tooltip; auto-clears after ~2.5s or on the next action.
- **startTour** — emits `actions.tour-request {tourId}` only (the tour player lands
  in E2); reports `done`.
- **custom** — `window.__ekoaApp.actions[action.id](params)`; absent →
  `actions.error reason:'unregistered-custom-action'`.
- **destructive** (`action.destructive===true`) — a PT-PT confirmation card (fixed
  overlay, `--color-*` fallbacks, no emoji): "Confirmar ação: <labelPt>" with
  buttons "Confirmar"/"Cancelar" (`data-demo-target="ekoa-confirm-acao"` /
  `"ekoa-cancelar-acao"`). Posts `actions.result {status:'confirm-pending'}` when
  shown; on confirm executes + reports `done`; on cancel reports `cancelled`.
- **driving indicator** — a fixed "Assistente a executar..." badge (brand-var
  fallbacks) shown while performing + the target pulse ring.
- **pause-on-user-input** — a capture-phase `pointerdown`/`keydown` listener; a real
  (`isTrusted`) event anywhere during a queued/executing sequence cancels the queue
  and the waiting active item, each reported `cancelled {detail:'user-input'}`.
  Events on the runtime's OWN UI (`[data-ekoa-actions-ui]`) are ignored, so the
  confirm buttons don't self-cancel. The runtime's synthetic events are
  `isTrusted:false`, so driving never trips its own pause.

Multiple executes queue; a single serial `activeItem` drains the queue. Each item's
`teardown()` removes its transient UI/timers so cancel/finish never leaks overlays.

## Design decisions

- **error vs result-failed split** — `actions.error` for structural/pre-run
  failures (`target-not-found`, `unregistered-custom-action`, `invalid-action`),
  mirroring `demo.error`; `actions.result {status:'failed', detail}` for an action
  that ran but whose effect failed (`no-field`, `no-select`, `navigate-failed`).
- **`action.params` at execute time is a VALUE object**, distinct from the
  manifest's param DEFINITION array. `paramsObject()` reads it defensively (returns
  `{}` if an array/absent), so a stray manifest-shaped payload never throws.
- **No security/permission logic.** The destructive confirmation is UX only;
  authorization is a later block (documented in the skill and in code comments).
- **Runtimes stay separate files.** No import of `demo-bridge-client.js`; shared
  conventions (findTarget, referrer pinning, overlay drawing) are re-expressed, not
  imported, per the task.

## Validation run

- `npx vitest run tests/apps/action-runtime.test.ts --root api` → 11/11 pass.
- `npx vitest run tests/contract/served-app.test.ts` → 19/19 (injection byte-compat
  intact).
- `npm run typecheck` (api) → clean.
- `eslint` on the 3 touched TS files → clean. The `.js` asset is not linted
  (`api/assets/**` + `**/*.js` are eslint-ignored — same exemption as
  `demo-bridge-client.js`).
- `npm run gate:chokepoint` → clean.

## Test strategy note

The two committed layers are (a) the real `servingRouter` mounted on a bare Express
app (no mongo needed — `/__ekoa/*` are pure byte-serves) asserting the route serves
JS and that `injectAppContext()` stamps BOTH script tags; and (b) source-level
invariants of the runtime IIFE (envelope, `isTrusted` pause hook, native-setter
dispatch, confirmation-card strings + reserved ids, origin pinning, no emoji via
`\p{Extended_Pictographic}`). The full behavioural round-trip — a host driving a
sample app action VISIBLY, with a real DOM — lands in C5's Playwright round-trip
gate (noted in the test header).

## Handoffs

- **C5** owns the Playwright e2e that drives a real served app end-to-end through
  this runtime (host → `actions.execute` → visible highlight → app state change).
- **E2** owns the tour player that consumes `actions.tour-request`.
- Generated apps opt into `navigate`/`custom` by exposing
  `window.__ekoaApp.navigate` / `window.__ekoaApp.actions[<id>]` (documented in the
  new base skill). The shipped shell base was NOT modified (outside the reserved
  scope); adding the `__ekoaApp.navigate` hook to the base shell is a separate,
  optional follow-up.

Not committed (per instructions).
