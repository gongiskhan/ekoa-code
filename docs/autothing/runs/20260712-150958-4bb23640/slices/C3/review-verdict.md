VERDICT: approve

Fresh-context review of slice C3 (commits 14f45e5 + aec0181): the in-page action
runtime, its serve/inject wiring, the shell nav hook, the base skill, and the
committed source/route tests. Reviewed with my own evidence (diffs read, the three
named test files run to green by me, runtime source spot-checked, wiring confirmed
additive). Every C3 acceptance criterion that is buildable in this slice is met; the
visible sample-app round-trip is correctly deferred to C5's Playwright gate, as the
slice scope states. No blocking findings.

## Findings

None blocking. Three non-blocking observations, recorded for completeness (no action
required for C3):

1. api/assets/action-runtime-client.js:422-438 — `select` kind: when an execute
   carries neither `value` nor `index`, the runtime still fires input+change and
   reports `status:'done'` without having changed the selection. Benign (a no-op
   select is harmless and validation still runs), but a caller could read `done` as
   "value applied". Not a C3 acceptance concern.

2. Task framing nuance (not a code defect): the task says "served-app proves
   byte-compat injection." served-app.test.ts:385 proves the *demo-bridge* tag is
   still injected (a genuine no-regression / additive-injection proof), but the
   action-runtime tag injection is actually proven in
   action-runtime.test.ts:62-68. Both are green; the injection coverage exists, just
   split across the two files. Called out so the evidence trail is accurate.

3. api/assets/action-runtime-client.js:515-523 — when `document.referrer` is absent
   the first `actions.init` is accepted and its origin pinned unconditionally. This
   is a faithful copy of the demo-bridge discipline (verified against
   demo-bridge-client.js:357-363) and is documented in the file header, so it is
   in-scope and intentional, not a regression.

## EVIDENCE

### 1. Diffs read (my own `git show`)
- 14f45e5 (feat): +action-runtime-client.js (556 lines), +declaring-ui-actions.md
  skill, App.jsx +15 (nav hook), injected-context.ts +1 line (script tag),
  serving.ts +20 (read-at-boot + GET route), action-runtime.test.ts (127 lines),
  impl-notes + one diagram. 986 insertions / 1 deletion.
- aec0181 (fix): single line — adds `fireEvent(sel, 'input')` before the existing
  `change` on the `select` kind (React parity, a Codex finding). Verified it is
  exactly `+ fireEvent(sel, 'input');` at line 435.

### 2. Tests run BY ME (not trusting reported exit codes)
`npx vitest run tests/apps/action-runtime.test.ts tests/contract/served-app.test.ts
tests/apps/base-loader.test.ts --root api`
→ **Test Files 3 passed (3), Tests 42 passed (42)**, 34.83s.
- action-runtime.test.ts: serve+inject wiring (route serves JS + CORS `*`;
  injectAppContext stamps BOTH demo-bridge and action-runtime tags before `</head>`)
  and the source contract (envelope, confirm-pending, isTrusted pause, native-setter
  input/change, PT-PT confirm card, origin pinning, no-emoji).
- served-app.test.ts: byte-compat data plane + injected-HTML "must contain" list
  still passes (demo-bridge tag still present at :385) → injection change did not
  regress the served-app contract.
- base-loader.test.ts:163 "templateId app scaffolds the shell … and the real builder
  bundles it" runs real esbuild over the scaffold including the modified App.jsx →
  the shell nav hook did not break the build.

### 3. Runtime source spot-check (api/assets/action-runtime-client.js)
- native-setter dispatch on setField AND select: `setNativeValue` uses
  `Object.getOwnPropertyDescriptor(proto,'value').set` (:121-129); setField fires
  input then change (:400-401); select fires input then change (:435-436, the
  aec0181 fix). CONFIRMED for both.
- real click for toggle: `clickEl.click()` on a resolved input/button/role element
  (:406-419). CONFIRMED (a genuine DOM click, so the app's own handler runs).
- origin pinning: non-init messages rejected unless `e.origin === hostOrigin`
  (:530); init pins from first valid message matching referrer origin (:515-523);
  every reply posts with explicit `targetOrigin = hostOrigin` and early-returns if
  unpinned (`post`, :65-72) — never `'*'`. Mirrors demo-bridge-client.js:357-373
  verbatim in structure. CONFIRMED.
- pause-on-isTrusted-input: `onUserInput` ignores synthetic events
  (`e.isTrusted !== true` → return, :498) so the runtime's own dispatched
  input/change never self-cancel, and ignores its own UI via
  `t.closest('[data-ekoa-actions-ui]')` (:501); the confirm/badge/highlight roots all
  carry that attribute (:172, :204, :232). Real pointerdown/keydown during a
  queue → `cancelAllForUserInput` with `detail:'user-input'` (:480-507). CONFIRMED.
- destructive confirm-before-dispatch: `startItem` renders the confirm card and
  returns BEFORE any `perform()`; only `onConfirm` calls `perform` (:335-352); posts
  `confirm-pending` in the interim. CONFIRMED (no dispatch precedes confirmation).
- no emoji: `grep -nP '\p{Extended_Pictographic}'` over the runtime and all six C3
  files → no match; the committed test also asserts this (:123-126). CONFIRMED.

### 4. Wiring is additive (both routes served, both tags injected)
- injected-context.ts:257-261 — the action-runtime `<script>` is APPENDED after the
  demo-bridge tag; demo-bridge tag untouched.
- serving.ts:263-273 (read-at-boot with unavailable-fallback) + :425-431 (GET
  /__ekoa/action-runtime.js: JS content-type, CORS `*`, 5-min cache) — same posture
  as the demo bridge, added alongside it; the demo-bridge route still present and
  green (action-runtime.test.ts "demo bridge still serves alongside it").

### 5. No permission/authorization logic; PT-PT strings
- `grep -niE 'token|authoriz|permission|role|verifyToken|jwt|session'` over the
  runtime → only DOM `role="switch"/"checkbox"` selector strings (:411-413), i.e.
  ARIA roles, not authz. No token/role/session gating anywhere in the runtime. The
  served route is public byte-serving (like demo-bridge), no auth. The destructive
  confirm is documented as UX-only, real authority server-side (file header
  :12-15, skill "What NOT to do"). CONFIRMED.
- PT-PT user strings: "Assistente a executar..." (:206), "Confirmar ação: " (:246),
  "Cancelar" (:254), "Confirmar" (:262). All correct PT-PT. CONFIRMED.

### Acceptance mapping (FLOW_PLAN C3)
- runtime executes manifest actions through the app's OWN state dispatch (human-
  equivalent events, validation always applies) → MET (native setter + bubbling
  input/change; real click).
- visible highlight → MET (spotlight ring + driving badge, motion-safe).
- destructive → client confirmation → MET (PT-PT card before dispatch).
- postMessage origin-pinned (demo-bridge pattern) → MET (verified against the demo
  bridge).
- a sample-app action executes visibly → correctly DEFERRED to C5's Playwright gate;
  the buildable C3 portion (runtime + serve/inject + base skill + committed
  source/route tests) is complete and green.
