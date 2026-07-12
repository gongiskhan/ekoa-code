# D2 fresh-context review — operator assistant panel + D1 action enrichment

Reviewer: fresh-context (no implementer notes consumed for the verdict; formed own view from the repo).
Scope: commits `15b230e` (panel in the app base + D1 action enrichment) and `34e4b86` (live e2e driver).
Branch: `operator-run`. No files committed by this review.

## Method / own evidence

All commands run by me, from the repo:

| Check | Command | Result |
|---|---|---|
| Unit/contract tests | `npx vitest run tests/apps/assistant-panel.test.ts tests/apps/app-assistant.test.ts tests/contract/app-assistant.contract.test.ts tests/apps/base-loader.test.ts --root api` | **50 passed** (panel 13, app-assistant 14, contract 11, base-loader 12); 0 failures |
| Lint | `npx eslint api/src/apps/app-assistant.ts shared/src/app-assistant.ts api/tests/apps/assistant-panel.test.ts` | **exit 0**, clean |
| Chokepoint gate | `npm run gate:chokepoint --silent` | **clean** (no `@anthropic-ai/` or `api.anthropic.com` outside `api/src/llm/`) |
| Emoji grep | `grep -nP '\p{Extended_Pictographic}'` over panel/css/mount/index.jsx/skill/e2e | **no emoji** in any of the six new files |
| XSS grep | `grep -rnE 'dangerouslySetInnerHTML\|innerHTML\|insertAdjacentHTML\|outerHTML'` over the panel dir | **none found** |

I did not re-run the live browser gate (`assistant-panel.e2e.mjs`) — it needs the credentialed boot-b stack. I audited its source, its allowlist against `injected-context.ts`, and the three committed screenshots instead.

## Acceptance criteria — all met

- **Mounts at `#ekoa-assistant-root`** via a separate React root, waiting for React-18's async initial commit (bounded `requestAnimationFrame` poll, `MAX_FRAMES=60`), once-guarded by a DOM-node flag, quiet no-op past the cap. `index.jsx` calls `mountAssistant()` after `root.render(<App/>)` without touching the App render. (`mount.js`, `index.jsx`)
- **First-open three-capability PT-PT message + example prompts** — present and correct register. (`AssistantPanel.jsx:333-345`)
- **Operar/Mostrar/Ensinar toggle with pin-or-infer** — `mode` sent ONLY when the visitor pins it (`pinnedMode`); otherwise omitted so the server infers, and `response.mode` is echoed back onto the toggle. Verified live in screenshot 3 (server inferred "Mostrar"/show and the toggle reflects it). (`AssistantPanel.jsx:135-136, 236, 245, 313-328`)
- **POST `/api/app-assistant` with `X-Ekoa-App-Id`** read from `window.__EKOA_APP_ID`. (`AssistantPanel.jsx:225-239`)
- **"Fontes" citations** rendered from `response.citations`. (`AssistantPanel.jsx:352-365`)
- **Actions dispatched only via `window.__ekoaActions.execute`** — the panel never reimplements driving/confirm/pause; it only calls `execute()` and shows a subtle "A executar..." line. Runtime absent ⇒ marks the run "indisponível", never crashes. (`AssistantPanel.jsx:172-201`)
- **Non-blocking** — collapsed by default (`useState(true)`), no network on mount, never autofocuses on render (focus only on explicit open/example click). (`AssistantPanel.jsx:130, 269-282`)
- **Calm PT-PT error posture** — non-2xx or thrown fetch renders `O assistente está indisponível de momento.` as an error-tagged turn, excluded from future history. (`AssistantPanel.jsx:48, 240-261`)
- **Brand-neutral via CSS-var contract with fallbacks** — every colour/space/size/radius/shadow is `var(--token, fallback)`. (`AssistantPanel.css`)
- **No emoji / no permission-auth logic / no new capability** — confirmed (see findings). The absence of capability gating is by design (later security block); I did not flag it.

## Specific-risk findings (the eight the lead asked)

1. **XSS via the model reply — CLEAN (not a blocker).** No `dangerouslySetInnerHTML` / `innerHTML` anywhere in the panel dir. The reply is rendered as a React text child `{m.content}` (`AssistantPanel.jsx:350`) and citations as escaped children (`:358-360`) — both HTML-escaped by React. No raw-HTML sink exists.

2. **D1 action enrichment is server-authoritative — CLEAN.** The attached `action` comes from `toolsByName.get(toolName)` (`app-assistant.ts:221, 231`), a map built from `input.actionManifest` (`:252`). The route sources that manifest from the artifact's own data bag persisted at activation, resolved via the `X-Ekoa-App-Id` header and zod-validated (`app-assistant-route.ts:106-111`) — never from the request body. `orgId` is the resolved owner's, never caller-supplied (`:100-102`). The model text controls only `toolName` (must hit a real manifest tool, else dropped — `app-assistant.ts:223`) and `input` VALUES. On the client, `toRuntimeAction` returns `{ ...a.action, params: values }` (`AssistantPanel.jsx:75-85`): the spread lands `kind/target/route/destructive` from the server action FIRST, then `params: values` overrides only params — a model `input` key cannot forge `kind`/`target`. **No request field can steer the attached AppAction.**

3. **Contract back-compat — CLEAN.** `AssistantAction.action` is `.optional()` and every new `AssistantChatResponse` field is optional (`shared/src/app-assistant.ts:71, 78-82`). The contract suite proves the base `{ reply }` / `{ message }` shapes still validate and that a malformed embedded `action` (navigate without route) is rejected (`app-assistant.contract.test.ts:32-33, 46-62`). Old clients unaffected.

4. **mount.js — CLEAN.** Bounded retry (`frames >= MAX_FRAMES` ⇒ return), single mount (`node.__ekoaAssistantMounted` flag), quiet give-up with no spin or leak when the node never appears. (`mount.js:38-52`)

5. **History — error turns excluded (CONFIRMED); NOT length-bounded (FINDING F1).** `history` filters to user/assistant roles with `!m.error` (`AssistantPanel.jsx:209-211`), so the calm error turns are excluded as claimed. But there is no cap: every turn re-sends the ENTIRE prior conversation, and `AssistantChatRequest.history` has no `.max()` in the schema either. See F1.

6. **Driver console allowlist — CLEAN, verified against source.** The two platform signatures match exactly: `whoami` GETs `/api/app-sso/me` and treats 401 as the anonymous state (`injected-context.ts:109-114`), and the health beacon POSTs `/api/app-health` keepalive (`injected-context.ts:244`). Both `benign()` rules require URL end-match AND status match (`assistant-panel.e2e.mjs:92, 96`) — strict; any other console error fails the gate. There is a THIRD benign branch (favicon, `:88`), but it is universally-benign browser auto-request noise (not app code), disclosed in the driver header, and cannot mask an app defect — so the "exactly two platform signatures" claim holds for app-originated errors. `/api/app-assistant` is NOT allowlisted, and the driver independently asserts its status is 200 (`:175`), so an assistant failure fails the gate.

7. **Test honesty — HONEST.** The source-level assertions genuinely pin the claimed behaviors (three example prompts, do/show/teach ids, POST + `X-Ekoa-App-Id` + `window.__EKOA_APP_ID`, `window.__ekoaActions.execute` on `data.actions`, "Fontes", the calm error string + runtime guard, no-autofocus, no-emoji, and the mount/index wiring incl. the ordering assertion `indexOf(mountAssistant()) > indexOf(root.render(<App/>))`). The D1 tests pin the enrichment concretely (`action: actionById('criar-cliente')`, unknown-tool dropped, non-object input ⇒ `{}`). The e2e driver proves the three jsdom-unprovable properties (real mount, real 200 turn distinguished from the error string, zero non-benign console errors) against a freshly-built app-base app. No test asserts a tautology or a mock it authored.

8. **PT-PT quality — good, two minor consistency nits (F2, F3).** All D2-authored strings are correct formal-register PT-PT (`Dê-me`, `Mostre-me`, `Adicione`, `Escreva a sua mensagem`, `Experimente`). Two low-severity inconsistencies below.

## Numbered findings (none blocking)

**F1 — unbounded conversation history sent per turn (low-medium).** `AssistantPanel.jsx:209-211` sends the full prior conversation on every turn, and `AssistantChatRequest.history` (`shared/src/app-assistant.ts:41`) has no max. Over a long anonymous session this grows the payload and the per-turn token cost (billed to the owner) linearly, i.e. ~O(n²) total over a session. The owner's allowance gate (`app-assistant-route.ts:124`) caps the blast radius, so this is a cost/robustness nit rather than a security hole. Suggest a client-side `.slice(-N)` window (e.g. last ~20 turns) and/or a `.max()` on the schema. Non-blocking.

**F2 — "Mostrar" vs "Apresentar" for the same capability (low).** The toggle labels the show mode **Mostrar** (`AssistantPanel.jsx:36`), but the intro lead and the example card call it **Apresentar** (`:43`, `:335`). Same capability, two verbs on one screen. Pick one for a polished lawyer-facing product. Non-blocking.

**F3 — example-card order differs from toggle order (low).** Example cards render show→teach→do (Apresentar/Ensinar/Operar, `:42-46`) while the toggle renders do→show→teach (`:34-38`). Harmless but visually inconsistent. Non-blocking.

**F4 — "Fontes" can contradict the reply (medium; inherited from D1, surfaced by D2's rendering).** Citations are ALL grounding hits (`app-assistant.ts:257-261`), not the sources the model actually cited. Screenshot 3 shows the assistant saying "os excertos de conhecimento fornecidos são sobre jurisprudência e não se aplicam ... pelo que **não os usei na resposta**" while the panel still lists **five** "Fontes" jurisprudência acórdãos. For a lawyer-facing "cite-your-source" product this undermines trust. D2 renders the contract faithfully, so this is not a D2 code defect — but it is clearly visible in D2's live evidence and the run should track it (candidate: emit citations only for hits the reply actually referenced, or suppress "Fontes" when the model states it grounded on nothing). Non-blocking for D2.

**F5 — operate-loop action dispatch is not in the committed live gate (low; deferred by plan).** The committed e2e (`assistant-panel.e2e.mjs`) proves mount + first-open + a show-mode turn + zero console errors, but drives NO action through `window.__ekoaActions.execute`. The enriched-action dispatch is covered only by source-level assertions and the uncommitted jsdom drive described in `impl-notes.md`. `impl-notes.md` explicitly hands the scripted three-mode + pause + operate loop to D3, so this matches the plan — noted so the run does not lose track of it. Non-blocking.

**F6 — hardcoded teal fallbacks vs the recent "kill fake teal defaults" work (low).** The CSS var fallbacks use teal `#0F766E` for `--color-primary` etc. (`AssistantPanel.css:29-32`). These are graceful-degradation fallbacks (only used if the served design-tokens contract is unreachable), so they do not override a real brand — defensible. Flagging only so the lead can reconcile with the `48aac4c` "site-true colors / kill fake teal defaults" stance; if the platform prefers fail-loud over a neutral fallback here, that is a conscious call. Non-blocking.

## Design audit

Viewed all three committed screenshots (`live-01-launcher.png`, `live-02-panel-open.png`, `live-03-reply.png`).

**Overall: professional, calm, restrained — meets the legal-software bar.** Consistent spacing off the token scale, clear type hierarchy, no emoji, brand-neutral surfaces, correct PT-PT on screen.

- **live-01 (launcher):** unobtrusive teal pill bottom-right with a chat glyph + "Assistente", sitting below the app content. Correctly non-blocking; nothing steals attention. Good.
- **live-02 (panel open):** clean right-side drawer. Header "Assistente" + close X; three-segment mode toggle with **Operar** active (filled teal, good affordance); the PT-PT first-open lead reads naturally; three example cards with a muted kind label + prompt; composer "Escreva a sua mensagem..." with a teal send button. Solid hierarchy and rhythm. Nits: the F2 (Mostrar vs Apresentar) and F3 (card order vs toggle order) inconsistencies are both visible here.
- **live-03 (reply):** assistant reply in a calm grey bubble; the toggle now shows **Mostrar** active — live proof the server-inferred mode echoes back onto the toggle. The "Fontes" card is well-styled (muted collection + darker title). Two visible issues: (a) **F4** — the reply says it did NOT use the jurisprudência excerpts, yet five "Fontes" are listed (contradiction, medium); (b) the model reply mixes register — "**Queres** que **te** ajude" (informal *tu*) against the panel's formal *você* strings. That register drift is non-deterministic model output governed by the D1 system prompt (`app-assistant.ts:buildSystemPrompt` does not pin a formal register), not a D2 panel string — low severity, but for a lawyer-facing product the system prompt should pin PT-PT formal register.

Not D2 and out of scope, noted for the lead only: the sample app's header title is truncated ("...com nome e tele") and its "Adicionar cliente" button reads low-contrast/disabled — both are the generated sample app, not the panel.

No panel visual defect rises above low/medium; none blocks.

## Conclusion

All acceptance criteria are met and independently evidenced. The security-critical surfaces are clean: no XSS sink, the enriched action is fully server-authoritative and unforgeable from any request field, the contract evolves additively with proven back-compat, the mount is bounded/idempotent, and the live driver's console gate is strict and honestly scoped. The findings are polish/robustness items (F1 history bound, F2/F3 copy consistency, F4 citation contradiction inherited from D1, F5 deferred operate-loop coverage, F6 teal fallbacks); none is a correctness or security blocker for this slice.

VERDICT: approve
