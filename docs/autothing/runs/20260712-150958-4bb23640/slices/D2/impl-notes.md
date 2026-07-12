# Slice D2 — operator assistant PANEL in the app base

The in-app assistant panel that mounts into every `app`-base app. It speaks only the
D1 endpoint (`POST /api/app-assistant`) and the C3 same-document runtime
(`window.__ekoaActions.execute`); it adds no backend and reimplements none of the
runtime's driving UI. PT-PT throughout, brand-neutral via the CSS-var contract, no
emoji (SVG icons only).

## Files (the 4 reserved scaffold paths + the skill + the test + these notes)

1. `api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx` —
   the panel component (React, CDN-bundled per app). Collapsible side panel + a
   launcher ("Assistente"); a first-open message stating the three capabilities with
   PT-PT example prompts; a message list + composer; the Operar/Mostrar/Ensinar mode
   toggle; the fetch to `/api/app-assistant` (with `X-Ekoa-App-Id`), the "Fontes"
   citation list, and the per-action `window.__ekoaActions.execute` dispatch with the
   subtle "A executar..." state.
2. `api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.css` —
   panel + launcher styling. Every colour/space/size/radius/shadow is a `var(--…, fallback)`
   off the served design-token contract (verified every var name against
   `api/src/services/design-tokens.ts`; only defined tokens are referenced). Respects
   `prefers-reduced-motion`; responsive (full-width < 480px). z-index sits BELOW the
   runtime's driving badge/confirm card so the driving UI always shows above the panel.
3. `api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js` — mounts
   `<AssistantPanel/>` into `#ekoa-assistant-root` as a SEPARATE React root. Guards:
   node-present, mount-once, and — the load-bearing one — it WAITS for the node (see
   "Mount timing" below).
4. `api/assets/bases/app/scaffold/frontend/src/index.jsx` — minimally edited: imports
   and calls `mountAssistant()` AFTER `root.render(<App/>)`. The `<App/>` render is
   untouched.
5. `api/assets/bases/app/skills/using-the-assistant-panel.md` — terse base skill: the
   panel is platform-shipped and mounts automatically; do NOT build your own chat UI
   or remove the mount; make it useful by declaring good `ui_actions` (cross-refs
   `declaring-ui-actions.md`). Mirrors the sibling base skills' tone.
6. `api/tests/apps/assistant-panel.test.ts` — committed source-level assertions
   (13 tests): the file exists; the three-capability PT-PT first-open copy; the three
   mode labels + do/show/teach ids; the `/api/app-assistant` fetch with `X-Ekoa-App-Id`
   read from `window.__EKOA_APP_ID`; the `window.__ekoaActions.execute` dispatch for
   `data.actions`; the "Fontes" citations; the calm error string + missing-runtime
   guard; no-autofocus; NO emoji (`\p{Extended_Pictographic}`) in panel + css; index.jsx
   calls `mountAssistant` after the App render; and mount.js's node-guard, once-guard,
   and bounded async-retry.

## Mount timing (a real bug found + fixed)

`#ekoa-assistant-root` is rendered BY `App` (App.jsx), and React 18's
`createRoot().render()` commits the initial tree ASYNCHRONOUSLY — so the node is NOT
in the DOM the instant `index.jsx` calls `mountAssistant()`. A naive
`getElementById(...) ?? return` no-ops and the panel would NEVER mount. Verified
empirically in jsdom with the real React: sync-after-render → node absent;
after a frame → present. `mount.js` therefore polls a bounded number of animation
frames (`MAX_FRAMES = 60`, ~1s) until the node appears, then mounts once; past the cap
it gives up quietly (standalone preview / non-app shell). Also verified the nested
root survives an `App` re-render (the mount node stays permanently empty in App's JSX,
so React never reconciles the panel away).

## D1 action-shape gap (RESOLVED with slice-d1)

The C3 runtime `execute(action)` needs a FULL manifest `AppAction` (it reads
`action.kind` — `invalid-action` without it — plus target/route/destructive/labelPt +
a VALUES object on `params`). D1's original `AssistantAction` was `{ toolName, input }`
only, and the app's action manifest is NOT exposed client-side (checked
injected-context.ts + serving.ts) and D2 may add no backend/injection — so from
`{ toolName, input }` alone the panel could not construct kind/target/route, and nothing
would drive (breaking the D3 live loop).

Coordinated with slice-d1, who additively enriched the contract: `AssistantAction` now
carries `action: AppAction.optional()` (the resolved manifest action), attached in
`extractActions` from the tool map. The panel's `toRuntimeAction()` drives it directly —
`execute({ ...a.action, params: a.input })` — with a best-effort `{ id-from-toolName,
params }` fallback when `action` is absent (which the runtime then rejects cleanly, no
crash). Verified against the landed D1 shape; the functional test exercises the enriched
path end-to-end (dispatched action carries `kind:'setField'` and the value on `params`).

## Design decisions

- **Mode inference vs pin.** The panel sends `mode` ONLY when the visitor explicitly
  pins one on the toggle (click again to unpin). By default it OMITS `mode` so the
  server infers do/show/teach from the phrasing, and reflects the echoed `response.mode`
  back onto the toggle. (If it always sent the toggle value, the server would never
  infer — that would defeat the documented behavior and D3's three-mode exercise.)
- **Non-blocking / focus.** Collapsed by default (a launcher), so no network on mount.
  Never autofocuses on mount; focuses the composer only on an explicit open / example
  click. The composer is disabled while a turn is in flight, so panel keystrokes can't
  accidentally trip the runtime's pause-on-user-input (clicking IN THE APP still pauses,
  as intended).
- **Runtime UI untouched.** The panel only calls `execute()` and shows an "A executar..."
  line; the badge, highlight, destructive confirm and pause are all the runtime's.
- **Error posture.** A non-2xx or a thrown fetch renders the calm PT-PT
  "O assistente está indisponível de momento." as an assistant turn (tagged so it is
  excluded from the history sent on the next turn); a missing runtime marks the action
  "indisponível". Never a crash.
- **Context.** Sends `context.route` (from `window.__ekoaApp.route`/`currentRoute`, else
  location) and a rolling buffer (≤8) of recent action results as `context.actionResults`.

## Validation

- `npx vitest run tests/apps/assistant-panel.test.ts --root api` → 13/13.
- `npx vitest run tests/apps/base-loader.test.ts --root api` → 12/12 (the app base still
  builds through the REAL scaffold→esbuild pipeline; the served bundle carries the mount).
- api `tsc --noEmit` (src + test) exit 0; eslint clean on the test file. The `.jsx/.js/.css`
  assets are eslint-ignored (`api/assets/**`), same exemption as the C3 runtime asset.
- OFFLINE per-app bundle (materialize scaffold→frontend/src + wiring→frontend/src/lib,
  esbuild `jsx:'automatic'`, react/react-dom external): **0 errors, 0 warnings**;
  `bundle.js` ≈ 25.1 KB, `bundle.css` ≈ 12.7 KB (shell + panel); panel + mount present.
- Extra proofs (jsdom + real React, not committed — the JSX is a CDN-bundled browser
  asset outside the vitest stack): (a) the launcher actually MOUNTS after React's async
  initial render; (b) a 20-check functional drive — open → type → send → renders reply +
  "Fontes" + reflected mode; omits mode when unpinned; sends `X-Ekoa-App-Id` + context.route;
  dispatches exactly one action carrying the manifest `kind` + value; shows the result
  line; calm error on 402; missing-runtime → "indisponível", panel alive.

## Handoffs

- **D3** owns the scripted three-mode + pause + cited-answer live gate. The D1
  action-shape enrichment it depends on has landed (see above), so the operate loop can
  close: assistant proposes → panel `execute()`s the enriched action → runtime drives.
- **G2** owns the panel lazy-load perf budget. The panel does no network on mount and
  ships collapsed; G2 can add the load-delta assertion.
- **Diagram note:** D2 adds no new backend plane or data shape (pure client consumer of
  the D1 endpoint + C3 runtime, both already in the diagrams; D1 flagged the
  `POST /api/app-assistant` node for the lead). No new diagram change identified from
  D2 — lead to confirm.
