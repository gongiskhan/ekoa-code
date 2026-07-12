VERDICT: approve

# B2 — the api/assets/bases/app internal base (fresh-context review)

Commits reviewed: 576e641, a034ca1, 9e92757 (branch operator-run).
Reviewer gathered its own evidence: read all three diffs + the shipped base files, ran the
tests, grepped the base for retired surfaces, checked the CSS-var contract, eslint + egress grep,
and read the live-gate SSE log directly.

## Acceptance — met

- **New `api/assets/bases/app/` with the operator mounts.** Present. The shipped shell
  `scaffold/frontend/src/App.jsx` renders top bar + PAGES-registry nav inside a root
  `<ErrorBoundary>`, with the EMPTY `<div id="ekoa-assistant-root">` mount and the
  `data-demo-target` landmarks (`app-shell`/`app-topbar`/`app-nav`/`app-content`/`assistant-root`).
- **Protocol client.** `wiring/protocol-client.ts` is a first-class typed client over the
  INJECTED `window.__ekoa` runtime (whoami/signIn/signOut/graphFetch/exportPdf/cloudFiles).
- **Design-token link served by reference.** `scaffold/frontend/src/index.css` is written entirely
  against the CSS-variable contract with fallbacks; brand arrives at runtime via
  `/api/design-tokens.css` (per base-conventions.md §16), not inlined.
- **Error boundaries.** Shipped `wiring/ErrorBoundary.jsx` (root + per page) and
  `wiring/IntegrationNeededBoundary.jsx` for the `needs_integration` state.
- **MANIFEST/conventions.** `instructions/base-conventions.md` + `skills/` (using-auth,
  using-integrations, using-persistence, layout-and-design) reconcile to the shipped code.
- **Builds and serves + J3-with-base green.** See EVIDENCE.

## Constraints — all satisfied

- **No retired surfaces in the base.** `grep -rniE 'api/v1/action|callIntegration|/api/v1/'
  api/assets/bases/app/` → NONE. a034ca1 removed the donor's OLD `POST /api/v1/action` envelope
  (the live-gate finding) and rewired to the injected runtime.
- **Wiring degrade contract.** `protocol-client.ts:111` `whoami()` resolves `null` with no
  runtime (non-throwing); action wrappers throw the typed `RuntimeUnavailable` (:87);
  `wiring/auth.ts:30` `getCurrentUser()` is non-throwing and returns null when logged-out OR
  runtime-absent. Matches the anonymous-degrade model.
- **Assistant mount is a placeholder only.** `App.jsx:98-104` ships the mount EMPTY with an
  explicit "no panel implementation, no chat UI" comment; base-conventions §35 + the
  "SUPERSEDES the no-side-panel rule" section (§43-45) forbid building any chat UI.
- **CSS vars in `api/assets/bases/CSS_VARS_CONTRACT.md`.** File present (4322 B). index.css uses
  exactly the contract families (`--space-*`, `--text-*`, `--color-*`, `--radius-*`); the donor's
  `--spacing-*`/`--typography-*` drift is gone (grep for those names → none).
- **No emoji.** Base tree clean.
- **Prose coherence.** base-conventions.md, using-integrations.md, manifest.json all describe
  "visitor identity (anonymous by default — whoami() may be null)" and "platform-executed
  integration capabilities (never a client-side integration call)"; the only in-app integration
  is the visitor's own M365 via `graphFetch`. Coherent with the anonymous-degrade model.

## EVIDENCE

- `npx vitest run tests/apps/base-loader.test.ts tests/apps/artifact-type.test.ts
  tests/contract/artifact-type.contract.test.ts --root api` → **20 passed** (12 base-loader +
  6 artifact-type + 2 contract; the task's "12+6" plus the contract file's 2). The committed
  real-builder integration proof "templateId app scaffolds the shell, wires lib/, and the real
  builder bundles it" passes (scaffold → esbuild bundle, assistant mount survives).
- `eslint` on the changed api/src + shared files → exit 0. Egress grep over the changed set:
  no `@anthropic-ai/`/`api.anthropic.com` outside `api/src/llm/`.
- **Live-gate job 6f7d2edd-b4a9-4cec-b15a-ae2a2a837659** (/tmp/b2-job4.txt) on a live credentialed
  stack: read /tmp/b2-sse.log directly. The slice verifier drove the real UI and at line 219 emitted
  `PASS - A lista de tarefas funciona bem: é possível adicionar, marcar como concluída, filtrar
  (Todas/Pendentes/Concluídas) e apaga[r]` — add/complete/filter/delete all exercised, only benign
  401/404 console noise. Prior attempts corroborate the code was stable: 262d3a52
  (/tmp/b2-job-id.txt) void = stale dist; dc19dd76 VERIFY_FAILED on identical code (verifier
  nondeterminism). Judgement: evidence satisfies "builds and serves + J3-with-base green".

## Observations (not findings — no action required)

- The `complete` event's `result` text in /tmp/b2-sse.log ends with the GENERATION agent's own
  note "a verificação excedeu o tempo limite e não foi concluída". That is the generation agent's
  inline self-check, a DIFFERENT step from the slice verifier, which completed and PASSed
  (line 219). A future reader skimming only the log tail could misread the timeout note as a slice
  failure; it is not. The committed real-builder integration test independently proves
  scaffold → bundle, so the live-gate PASS is corroborated, not sole.
