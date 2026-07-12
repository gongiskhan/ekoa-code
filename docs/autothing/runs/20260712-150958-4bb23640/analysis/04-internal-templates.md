# A4 — Internal-templates archaeology + structural-instruction token-tax baseline

**Slice:** A4 (Phase-1 track 4). **Repo:** `/Users/ggomes/dev/ekoa-code` @ branch `operator-run`.
**Read-only pass.** All paths absolute; all counts measured (token estimates = `chars / 3.5`, the rate the brief fixed — note PT/EN prose runs closer to ~4 chars/token, so these estimates run slightly HIGH vs a real tokenizer).

**Headline numbers (the B4 baseline):**
- Every build injects **~13,232 chars ≈ 3,780 est. tokens** of standing instruction into the agent system prompt (`SKILL.md` body 12,331 + `BUILD_SYSTEM_PROMPT` 901).
- Of that, **~9,400 chars ≈ ~2,700 est. tokens is STRUCTURAL** (canonical layout, `manifest.json`/`MANIFEST.md` shapes, data-API wiring, integration/SSO/document wiring, the CSS-var contract, entrypoint steering) — i.e. describes an artifact's *structure* and could migrate to a selected base / scaffolded files.
- The remaining **~3,800 chars ≈ ~1,080 est. tokens is JUDGMENT** (behaviour contract, scope discipline, legal-grounding policy, no-mock-data, no-external-AI, build validation) — must stay in the base behaviour prompt regardless of base.
- **This ~2,700-token structural figure is what slice B4's measured shrink is judged against.** The reduction path is not "delete prose" but "move per-type structural prose into the base that owns it, and encode invariants as scaffolded files instead of instructions" — so a document build stops paying for SSO wiring text, an app build stops paying for docx-toolbar text, etc.

---

## 1. Where the build pipeline gets its scaffold (post-hardening)

### 1.1 The live path — one generic scaffold, no template selection

Every first build scaffolds the SAME four generic starter files. The path:

- `api/src/agents/build.ts:305` — `executeBuildJob` calls `mech.prepareFirstBuild({ userId, sessionId, description, language, ...(templateId?) })`.
- `api/src/apps/build-mechanics.ts:122` — `prepareFirstBuild` calls **`await scaffoldApp({ appId: artifactId, name, projectDir, description: input.description })`**. Note what it passes: `appId`, `name`, `projectDir`, `description`. It passes **neither `templateId`, nor `templateScaffoldFiles`, nor `skipStarterFiles`.**
- `api/src/apps/scaffold.ts:150` — `scaffoldApp`:
  - Creates `frontend/src/` (`SUBDIRS`, `scaffold.ts:34-36`).
  - Writes `manifest.json` via `createDefaultManifest` (`scaffold.ts:159-169`).
  - Because `templateScaffoldFiles` is undefined and `skipStarterFiles` is falsy, it falls to the **generic starters branch** (`scaffold.ts:184-192`), copying `STARTER_FILES` (`scaffold.ts:53-57`) from `api/assets/scaffold-templates/`:
    - `frontend/src/index.jsx` ← `index.jsx`
    - `frontend/src/App.jsx` ← `App.jsx`
    - `frontend/src/index.css` ← `index.css`
  - Seeds a per-artifact git repo (`seedGit`, `scaffold.ts:101-115`) whose root commit `"Initial scaffold"` is later the baseline of the honest-completion gate (`build-mechanics.ts:262`, `assertProgress`).

`api/assets/scaffold-templates/` (4 files, 4,700 bytes total): `App.jsx` (1,889 — the animated "Let's build something…" placeholder, source of the `SCAFFOLD_MARKERS` in `build-mechanics.ts:37`), `index.jsx` (175), `index.css` (2,307), `index.html` (329). These are **written to disk**, not injected into the prompt.

### 1.2 The HTML template (`HTML_TEMPLATE_PATH`) — build output, not scaffold

`api/src/apps/builder.ts:64` — `HTML_TEMPLATE_PATH = …/assets/scaffold-templates/index.html`. It is NOT written by `scaffoldApp`; the builder reads it at **bundle time** (`builder.ts:67-82`, `loadHtmlTemplate` + `generateIndexHtml`) and substitutes `{{APP_NAME}}` and `{{CSS_LINK}}`. The template hard-links `/api/design-tokens.css` and `./bundle.js` (`index.html:7,11`). So the design-token link is a **structural invariant guaranteed by the builder**, not by any base — relevant to §5's gap analysis.

### 1.3 The `templateScaffoldFiles` seam — dead, fed by nobody (verified)

`grep -rn "templateScaffoldFiles" api/src` returns matches **only inside `scaffold.ts`**:
- `scaffold.ts:138` — the optional field declaration on `ScaffoldOptions`.
- `scaffold.ts:151` — destructure.
- `scaffold.ts:172-183` — the branch that writes them (with a `startsWith('/')` / `includes('..')` path-safety guard; always overwrites).

There is exactly one production caller of `scaffoldApp` (`build-mechanics.ts:122`) and it never supplies the field. `skipStarterFiles` is likewise never supplied by any caller. **Conclusion: `templateScaffoldFiles` and `skipStarterFiles` are pre-wired reception points for a base/template feed that was never connected.** They are the exact seam a `document`/`app`-base loader would drive to write a pre-built shell (the old `base-loader.ts` populated precisely this shape — see §4).

### 1.4 `templateId` is threaded end-to-end then dropped at the scaffold

`templateId` is carried through the whole request path but consumed by nobody:
- `api/src/routes/jobs.ts:45` → `api/src/agents/build.ts:64,126,305` → `api/src/agents/seams.ts:276` (`FirstBuildPrep` seam) → `api/src/apps/build-mechanics.ts:96` (input type).
- `prepareFirstBuild` accepts `templateId?` in its signature (`build-mechanics.ts:96`) but never reads it — the `scaffoldApp` call at line 122 ignores it. **So the API can already ask for a template; the pipeline silently discards the ask.** This is the second dangling half of the same dropped feature.

---

## 2. Where artifact structure is encoded in agent INSTRUCTIONS

### 2.1 The injection path (what is in the system prompt every build)

`api/src/agents/build.ts:343-359` assembles the build system prompt:

```
systemPrompt = [...contentSections, groundingBlock, BUILD_SYSTEM_PROMPT].filter(Boolean).join('\n\n')
```

- **`contentSections`** (`build.ts:346`) = `(await assembleAgentContext({ agentKind: 'coding', userId })).promptSections`.
  - `assembleAgentContext` (`api/src/content/loader.ts:332-339`) reads the **eager `.md` files** of every content package tagged `agents: ['coding']`, frontmatter-stripped (`loader.ts:106-112`).
  - The only such package is `api/content/coding-agent/` (`content.json`: `agents:["coding"]`, `mode:"eager"`, `files:["SKILL.md"]`). **So `contentSections` = `SKILL.md` body, on EVERY build** (first build AND follow-up — `executeBuildJob` calls it unconditionally; failure is non-fatal but it does not normally fail).
- **`groundingBlock`** (`build.ts:347`) = `knowledgeGrounding(...)`. **CONDITIONAL** — self-gates to legal-context builds only (§5.5.2 layer 2). This is *knowledge* (dynamic, retrieved), NOT structural instruction; excluded from the tax below.
- **`BUILD_SYSTEM_PROMPT`** (`build.ts:229-239`) = a 9-line inline block, hardcoded, **EVERY build**.

`api/src/agents/context.ts` (`assembleRunContext`) is the CHAT/automation assembler (5 grounding layers, memory, catalog, history). **Builds do NOT go through `assembleRunContext`** — `build.ts` calls `assembleAgentContext` + `knowledgeGrounding` directly. So `context.ts`'s extra layers (memory, catalog, prefetch, `EKOA_CHAT_IDENTITY`) are NOT part of the per-build structural tax. The one build-relevant helper there, `referencesContextLine` (`context.ts:141`), is a single dynamic line and not structural template text.

### 2.2 `SKILL.md` — structural vs judgment (`api/content/coding-agent/SKILL.md`, 12,722 bytes on disk; 12,331 chars after frontmatter strip)

Classifying each H2 section (line ranges in `SKILL.md`):

| Section (line range) | Class | Why |
|---|---|---|
| Preamble / identity (L4-9) | JUDGMENT | white-label identity, "your product is the app" |
| Contrato de comportamento (L11-20) | JUDGMENT | propose/confirm, scope-first — behaviour |
| Ambiente de trabalho (L22-25) | JUDGMENT | sandbox/scope discipline |
| **Estrutura canónica do projeto (L27-51)** | **STRUCTURAL** | canonical tree + minimal `manifest.json` shape |
| **Regras de saída (L53-71)** | **STRUCTURAL** | JSX-only, no package.json/dev-server, platform bundles, storage-API-only, CDN imports — output contract |
| **Dados `window.__ekoa` (L73-98)** | **STRUCTURAL** | the data-API wiring table + shared/fetch/files |
| **MANIFEST.md capabilities (L100-151)** | **STRUCTURAL** | capability manifest shape + primitive vocabulary + example |
| **Integrações a partir da app (L153-162)** | **STRUCTURAL** | integration call paths + `load_context` wiring |
| **Documentos descarregáveis Word/PDF (L164-181)** | **STRUCTURAL** (document-type) | docx/PDF export API + toolbar structure |
| **Sessão SSO (L183-196)** | **STRUCTURAL** (auth-type) | `signIn/whoami/passwordSignIn` API + authz-by-oid |
| Fundamentação legal (L198-213) | JUDGMENT (policy) | legal-grounding discipline / cite-or-silent |
| Sem dados fictícios (L215-219) | JUDGMENT | no mock data |
| Sem fornecedores de IA externos (L221-224) | JUDGMENT (security) | no external AI SDKs |
| **Design (L226-232)** | MIXED | design judgment + the `/api/design-tokens.css` CSS-var contract (structural half) |
| Validação do build (L234-237) | JUDGMENT | self-check discipline |

### 2.3 `BUILD_SYSTEM_PROMPT` — mixed (build.ts:229-239, 901 chars)

Lines 1-5 (entrypoint steering: served bundle = `frontend/src/index.jsx`→`App.jsx`, never a top-level `*.html`, don't hand-edit `dist/`) are **STRUCTURAL** — they duplicate the "Estrutura canónica" + "Regras de saída" facts a base already owns. Lines 6-8 (final-message white-label) are **JUDGMENT**. The comment at `build.ts:222-228` confirms this is the F16 anti-orphan-HTML steer; the honest-completion gate (`build-mechanics.ts:256-310`) is the system's deterministic catch behind it.

---

## 3. Token tax — MEASURED (the B4 baseline)

Centerpiece. Every row is injected into the build system prompt on **every build** (first and follow-up) unless marked. `groundingBlock` is excluded (conditional knowledge, not structural template).

| Source file | Block | Chars | Est. tokens (÷3.5) | Class | Migratable to a base? |
|---|---|---:|---:|---|---|
| `coding-agent/SKILL.md` | Preamble / identity | 341 | 97 | judgment | No (universal behaviour) |
| `coding-agent/SKILL.md` | Contrato de comportamento | 741 | 212 | judgment | No |
| `coding-agent/SKILL.md` | Ambiente de trabalho | 212 | 61 | judgment | No |
| `coding-agent/SKILL.md` | **Estrutura canónica do projeto** | 561 | 160 | structural | **Yes** — scaffold already creates it; prose is redundant with the tree |
| `coding-agent/SKILL.md` | **Regras de saída** | 1,366 | 390 | structural | **Yes → universal base** (platform-wide invariants) |
| `coding-agent/SKILL.md` | **Dados `window.__ekoa`** | 1,391 | 397 | structural | **Yes → app base** (persistence wiring skill) |
| `coding-agent/SKILL.md` | **MANIFEST.md capabilities** | 2,425 | 693 | structural | **Partial** — universal to app bases; the primitive vocabulary could be an on-demand `load_context` file, not eager |
| `coding-agent/SKILL.md` | **Integrações a partir da app** | 676 | 193 | structural | **Yes → integration base** |
| `coding-agent/SKILL.md` | **Documentos descarregáveis** | 1,339 | 383 | structural | **Yes → document base** (only relevant to document builds) |
| `coding-agent/SKILL.md` | **Sessão SSO** | 888 | 254 | structural | **Yes → app-auth base** |
| `coding-agent/SKILL.md` | Fundamentação legal | 1,135 | 324 | judgment (policy) | No (or on-demand for legal builds) |
| `coding-agent/SKILL.md` | Sem dados fictícios | 291 | 83 | judgment | No |
| `coding-agent/SKILL.md` | Sem fornecedores de IA externos | 270 | 77 | judgment | No (security floor) |
| `coding-agent/SKILL.md` | Design (token-contract half) | ~228 | ~65 | structural | **Yes → base layout skill** |
| `coding-agent/SKILL.md` | Design (judgment half) | ~227 | ~65 | judgment | No |
| `coding-agent/SKILL.md` | Validação do build | 226 | 65 | judgment | No |
| `agents/build.ts` | `BUILD_SYSTEM_PROMPT` L1-5 (entrypoint steer) | ~560 | ~160 | structural | **Yes → base** (redundant with canonical tree) |
| `agents/build.ts` | `BUILD_SYSTEM_PROMPT` L6-8 (white-label) | ~341 | ~97 | judgment | No |
| `agents/build.ts` | `groundingBlock` (knowledgeGrounding) | — | — | — | *Excluded: conditional, legal-context only (`build.ts:347`), dynamic knowledge not template* |

**Totals (sent EVERY build):**

| Bucket | Chars | Est. tokens |
|---|---:|---:|
| `SKILL.md` body (frontmatter-stripped) | 12,331 | ~3,523 |
| `BUILD_SYSTEM_PROMPT` | 901 | ~257 |
| **Total per-build standing instruction** | **13,232** | **~3,780** |
| — of which **STRUCTURAL** (migration candidates) | ~9,434 | **~2,700** |
| — of which JUDGMENT (stays) | ~3,798 | ~1,080 |

**B4 baseline = ~2,700 est. tokens of structural instruction per build** (≈ 71% of the standing prompt). The most clearly per-type / migratable slices inside that: MANIFEST.md (693), output rules (390), data API (397), document (383), SSO (254), integrations (193). A `document` build today carries 254 tokens of SSO wiring + ~590 of app data/integration wiring it will never use; an `app` build carries 383 tokens of docx-toolbar prose it will never use. That mutual waste is B4's target.

**Precision note on "every build":** `assembleAgentContext` and `BUILD_SYSTEM_PROMPT` fire on both first builds AND follow-ups (the assembly block at `build.ts:343-359` is unconditional; the comment at `build.ts:340-342` confirms it was added precisely because pre-fix builds sent ONLY the inline prompt and the whole `coding-agent` package was dead weight). So follow-ups pay the identical structural tax.

---

## 4. The dropped internal-bases decision

### 4.1 The bases exist, fully authored, and NOTHING in `api/src` reads them (verified)

`api/assets/bases/` holds 5 bases + a shared contract, all authored (`manifest.json`, `tokens.json`, `instructions/`, `skills/`, `wiring/`, `recipes/`, `layouts/`, `scaffold/`, `CSS_VARS_CONTRACT.md`). Grep for any reader (`base-?selector|baseId|loadBase|base-loader|scaffoldFiles|startingPoint`) across `api/src` finds:
- `api/src/apps/manifest.ts:169,230` — validates/persists an artifact's optional `extends` string field; **never loads a base from it**. The comment `manifest.ts:62` even points at the OLD path `ekoa-data/bases/`.
- `api/src/apps/featured-seeder.ts:170` — `typeId: manifest.extends ?? 'app-auth-persistent'` — uses the base id only as a **display type-label** on a featured artifact, no loading.
- `api/src/services/design-tokens.ts:125` — emits `/* Locked contract: ekoa-data/bases/CSS_VARS_CONTRACT.md */` as a **comment string** in generated CSS. It re-implements the var vocabulary itself (`renderCss`, `design-tokens.ts:121-131`); it does not read the contract file.

**No loader, no base-selector, no reader of any base's `manifest.json`/`tokens.json`/`instructions/`/`wiring/`/`scaffold/` exists in `api/src`.** The bases are orphaned assets. `git log --all -- '*base-loader*'` in ekoa-code is **empty — a base loader NEVER existed in this repo.**

### 4.2 Where the decision ENTERED this repo — one porting commit, assets only

All bases arrived in a single WIP commit:

```
f75d2d5  2026-07-06 23:29:36 +0100
wip(G6): port versioned content trees - integration definitions, legal engines, legal spine, base app types
```

This is the only commit touching `api/assets/bases` (`git log --all --oneline -- api/assets/bases`) and the commit that ADDED `CSS_VARS_CONTRACT.md` (`git log --all --diff-filter=A`). It ported the **content trees** ("base app types") but no consuming code. The `wip(G6)` tag places it in the G6 app-pipeline port; the bases came along as data and the loader was left behind.

### 4.3 Where it was DROPPED — the loader lived in the old codebase and was not ported

The old codebase `../ekoa-dev/cortex` had a **complete, wired base system**:
- `../ekoa-dev/cortex/src/services/base-loader.ts` — `loadBase(id)` reading `ekoa-data/bases/{id}/` and returning `{ skills, instructions, recipes, layouts, wiringFiles, scaffoldFiles, tokens }`. It defines the **exact closed enum that matches the 5 ported bases** (`base-loader.ts:18-31`): `app-auth-persistent | landing | presentation | app-integration-heavy | document`, with `DEFAULT_BASE_ID = 'app-auth-persistent'` (`base-loader.ts:33`). Its docstring (`base-loader.ts:59-66`) states the intent verbatim: *"what makes a base a real internal template: the shell is pre-built and pixel-tested; the coding agent fills in content instead of regenerating UI from prose instructions."* — i.e. exactly the token-tax problem §3 measures.
- `resolveTokens` (`base-loader.ts:129`): `base.tokens → company branding → featured tokens`.
- `mergeWithFeaturedArtifact` (`base-loader.ts:153`): base wiring + featured scaffold, the `scaffoldFiles` feed for `scaffoldApp`.
- Consumers in ekoa-dev (`grep base-loader ../ekoa-dev/cortex/src`): `orchestrator.ts` (`selectBaseTemplate`, "picks one of four bases", `orchestrator.ts:343,422`), `execute-handler.ts:421-429` (calls `selectBaseTemplate`), `design-tokens-css.ts`, `starting-points-prompt.ts`, `artifact-bundle.ts`, `legal-calculos.ts`.
- The selector was a skill: `../ekoa-dev/ekoa-data/plugins/skills/base-selector` (plus `starting-points-prompt.ts` and its tests). `execute-handler.ts:1310` comment: *"Wizard removed; orchestrator's base-selector + starting-points-prompt now [do the selection]."*

**So the decision to have internal bases as real templates entered in the old `cortex` (base-loader + orchestrator base-selector + starting-points), and was dropped in the rebuild:** the rebuild ported the base *content* (commit f75d2d5) but not `base-loader.ts`, the `selectBaseTemplate` orchestrator step, or the `base-selector` skill. The reception seams on the new side (`templateScaffoldFiles`, `skipStarterFiles`, the `templateId` thread, the `extends` field) are the stubs left where the loader used to plug in. The old codebase composed bases through a full orchestrator; the rebuild's app pipeline (build-mechanics → scaffold) has a single generic-scaffold path with the base hooks present but unconnected.

---

## 5. Inventory of the existing bases (+ the missing `app` base)

`api/assets/bases/` — 5 bases, one shared contract.

- **`CSS_VARS_CONTRACT.md`** (4,322 B). The locked CSS-variable vocabulary (`--color-*`, `--font-*`, `--text-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--logo-*`) served at runtime by `GET /api/design-tokens.css`, every var with a mandatory fallback. **State: authoritative but partly stale.** It documents a `cortex/…` provenance (L107-110) and the `ekoa-data/bases/` path. The live emitter `api/src/services/design-tokens.ts` emits most of this set BUT **omits the `--space-*` scale and `--text-2xl/3xl`** (verified: grep of emitted vars) — apps get those only via the in-app fallbacks. This is the "design-token link" invariant an `app` base must respect.

- **`app-auth-persistent/`** (richest; 15 files). **Invariants it carries:** a pre-built left-nav multi-page shell (`layouts/left-nav-shell.md`, `skills/layout-and-design.md`), auth wiring (`wiring/auth-wiring/auth.ts` — `getAppId`/`getCurrentUser` via `/api/v1/action` `ekoa.auth`), per-app persistence wiring (`wiring/persistence-wiring/jsonStore.ts` — typed `list/get/create/update/remove` over `/api/app-data/{collection}`, PUT-merge), the integration client (`wiring/integration-helper/integrations.ts` — `callIntegration<T>()` with the `needs_integration` shape) and its boundary component (`IntegrationNeededBoundary.jsx`), recipes for `error-boundary`/`empty-state`/`integration-needed`, `tokens.json`, and 4 how-to skills. `base-conventions.md` enumerates a "What's already done" scaffold (index.jsx/App.jsx/lib/tokens.json/manifest with `extends`). **State: authored, self-consistent, but NEVER LOADED, and its scaffold is aspirational** — the conventions describe files (`frontend/src/lib/integrations.ts`, `App.jsx` shell) that no scaffolder writes; only the 4 generic starters (§1.1) actually land. **Token-name drift:** the wiring/recipes reference `var(--spacing-md/lg)` and `var(--typography-h3-size)` which are NOT in `CSS_VARS_CONTRACT.md` and NOT emitted by `design-tokens.ts` (they fall through to fallbacks) — evidence the base was authored against an earlier token vocabulary and never reconciled.

- **`app-integration-heavy/`** (3 files: `manifest.json`, `tokens.json`, `instructions/base-conventions.md`). A declared **variant of `app-auth-persistent`** for integration-central flows (email triage, calendar, file processing). Carries invariants as prose only — integration-first UI, two-pane pattern, idempotent mutations, JsonStore for app-state-not-integration-cache. **State: thinnest of the app bases; no wiring/skills of its own, inherits `app-auth-persistent` by reference.** Loads nothing.

- **`document/`** (6 files, the ONLY base with a real `scaffold/`). **Invariants:** a print-tested Word/PDF document shell — `scaffold/frontend/src/App.jsx` (10,941 B: docx builder mirroring on-screen blocks 1:1, PDF export via `window.__ekoa.exportPdf`, cloud-save buttons, Documento/Notas tabs), `index.css` (6,028 B: screen+print, `@page` A4), `documentData.js` (the block model: heading/clause/paragraph/list/pagebreak/signatures — normally the ONLY file edited), `index.jsx`. `base-conventions.md` codifies "the shell is already built, put content in documentData.js", full-document revisions, notes-never-in-export. **State: the most complete, genuinely-a-template base — a verbatim-copy scaffold exactly matching the `templateScaffoldFiles`/`scaffoldFiles` seam shape.** Loads nothing; its 1,339-char equivalent lives redundantly in `SKILL.md`'s "Documentos descarregáveis" section (§3), paid by every build.

- **`landing/`** (5 files). Single-page marketing site (hero→features→proof→CTA→footer). **Invariants:** no auth, no app-data, SEO/performance-first, semantic HTML, more expressive `tokens.json`, `skills/landing-craft.md`. **State: authored, not loaded.**

- **`presentation/`** (3 files: manifest/tokens/conventions). Slide deck, one slide per component, keyboard nav (←/→/F), dark-by-default via inverted brand-neutral pair, sparse content. **Invariants** are prose-only; no wiring/scaffold. **State: thin, not loaded.**

### 5.1 The missing `app` base — what it needs beyond `app-auth-persistent`

The brief lists the `app` base's requirements: action-registry runtime mount, assistant-panel mount, protocol client, design-token link, error boundaries. Against `app-auth-persistent`:

| `app`-base requirement | Already in `app-auth-persistent`? | Gap |
|---|---|---|
| **Protocol client** | Partial — `integrations.ts` and `auth.ts` already POST the `/api/v1/action` `{app,intent,params}` envelope and parse `action_result`/`action_error`. | Needs promoting to a **first-class typed protocol client** (generic `action(app,intent,params)` over the shared/ envelope), not two ad-hoc call sites. |
| **Design-token link** | Yes — guaranteed by the builder's `index.html` template (§1.2) + `layout-and-design.md` conventions. | Reconcile the base's drifted `--spacing-*`/`--typography-*` names to the emitted contract (§5 drift). |
| **Error boundaries** | Yes — `recipes/error-boundary.json` + `IntegrationNeededBoundary.jsx`, required by `base-conventions.md` rule 5. | Ship as a real scaffolded component, not a recipe the agent must hand-build. |
| **Action-registry runtime mount** | **No.** `callIntegration` reaches server actions but there is no in-app registry the app mounts/exposes. | New: a runtime mount surfacing the app's own MANIFEST.md capabilities as callable actions. |
| **Assistant-panel mount** | **No** — and `app-auth-persistent/base-conventions.md` rule 8 explicitly FORBIDS an in-app side panel ("Never invent a new chat mode, side panel, or wizard"). | New: a sanctioned assistant-panel mount point; requires reversing that convention rule for the `app` base. |

So `app` ≈ `app-auth-persistent` (shell + auth + persistence + integration client + token link + error boundaries already present) **plus two genuinely new runtime surfaces (action-registry mount, assistant-panel mount) and a hardened protocol client**, minus the "no side panel" prohibition. The shell/wiring foundation is ~80% reusable from `app-auth-persistent`; the delta is the two mounts.

---

## Memo input — base-set recommendation (RUN_SPEC assumption 3)

**RUN_SPEC assumption 3 (wire `app` + `document` first) is CONFIRMED by the evidence, with one refinement.**

1. **`document` is the lowest-risk, highest-yield first wire.** It is the ONLY base with a real, verbatim-copy `scaffold/` (§5) that already matches the live but-unused `templateScaffoldFiles`/`skipStarterFiles` seam (§1.3). Wiring it is: select base → feed `scaffoldFiles` into `scaffoldApp` → drop the 1,339-char "Documentos descarregáveis" section from the always-on prompt. It converts the single clearest chunk of redundant per-type structural tax (383 tokens paid on every non-document build) into a base-scoped shell, and the shell is already print-tested. Do this one first.

2. **`app` is the correct second, because it is the default and the biggest tax sink**, but it is MORE work than `document`: its `app-auth-persistent` scaffold is currently aspirational prose (the described `frontend/src/lib/*` files are not written by any scaffolder — §5), and the `app` base additionally needs two net-new runtime mounts (§5.1). Wiring `app` is what lets the bulk of §3's structural tax (data API 397 + SSO 254 + integrations 193 + output rules 390 + canonical tree 160 + MANIFEST 693) move out of the eager per-build prompt into base skills / scaffolded wiring — the largest slice of the ~2,700-token B4 baseline.

3. **Prerequisite for either: port a loader.** Both wires need the piece the rebuild dropped — a `base-loader` + a selection step feeding `templateId`/`extends` into `prepareFirstBuild` (which currently discards `templateId`, §1.4). The old `../ekoa-dev/cortex/src/services/base-loader.ts` is a ready reference (closed enum already matches the 5 ported bases, `resolveTokens` + `mergeWithFeaturedArtifact` map onto the new `scaffoldApp` seams). B4 does not need to invent the model; it needs to reconnect it and delete the now-duplicated `SKILL.md` sections, then MEASURE the shrink against the ~2,700-token structural baseline above.

4. **Refinement to the assumption:** wire `document` + `app` first as stated, but treat `app-integration-heavy` as a near-free follow-on (it is a declared thin variant of `app`, §5) and reconcile the `CSS_VARS_CONTRACT` token-name drift (§5) as part of the `app` wire so the base's `--spacing-*`/`--typography-*` references stop silently falling to fallbacks.

---

*Gaps / not covered (per constraints): no auth/session/permission exploration performed. Token estimates use the brief's `chars/3.5` and run slightly high vs a real tokenizer. The `~228/~227` split of the SKILL.md "Design" section and the `~560/~341` split of `BUILD_SYSTEM_PROMPT` are estimates by line content, not exact section boundaries (the sections are not H2-delimited within themselves); all other counts are exact measured values.*
