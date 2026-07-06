# 07. App pipeline

This chapter specifies the user-app pipeline of the new service: how artifact source becomes a served static app. It covers esbuild bundling, the app registry, the complete list of bundle triggers, static serving with slug resolution, the byte-compatible served-app context injection (`window.__ekoa`), the shareability gate, deterministic slugs, version snapshots with the secret guard and GitHub mirror, fork and bundle flows, screenshots and health scanning, artifact PDF export, featured artifacts, and the preview lifecycle. Everything here lives in the `apps/` module (chapter 02, section 2.6) with its HTTP surface extracted to router files under `routes/` (reference/carryover-audit.md B4); the wire shapes are fixed in chapter 03 (sections 3.8.9 and 3.9) and the data behind `/api/app-data` in chapter 04. There is no dedicated app-pipeline diagram in the `spec/diagrams/` set; this pipeline is rendered across two existing diagrams - the `apps/` module (esbuild + serving) and its boundaries in `spec/diagrams/02-module-map`, and the artifact request path in `spec/diagrams/03-request-crud`. Under FIXED-12, any change to this pipeline's structure or flow updates whichever of those two diagrams renders the affected part, in the same unit of work; if a future change makes the pipeline's internal flow (triggers, registry, injection, snapshot/mirror) load-bearing enough to need its own diagram, that diagram is added to the set as part of that change.

## 7.1 Stance

- **Port-as-is scope (FIXED, per the carryover verdict).** The bundling core - builder, manifest schema, scaffold - carries over verbatim; it is fully conventional code with zero coupling to the retired machinery (reference/carryover-audit.md A3). The static-serving and injection blocks are extracted from the old monolith into routers, logic unchanged (reference/carryover-audit.md B4).
- **No dev servers, ever.** User apps are esbuild output served as static files. No per-app processes, no port allocation, no process spawning (reference/invisible-behaviors.md section 8.7). "Preview" means the built app itself.
- **No model calls anywhere in this pipeline (FIXED-3).** The one historical model call - slug generation - becomes deterministic code (section 7.8; reference/llm-usage-map.md row 25, fate `becomes-code`).
- **No per-app server code generation by the platform (FIXED-5).** App data runs on the collections engine (chapter 04). The one place user-authored server-side code exists - the optional artifact backend bundle - is a distinct, pinned feature executed in a worker runtime (section 7.2.4; reference/carryover-audit.md B19), not platform codegen.
- **The served-app contract is byte-compatible (FIXED-9).** The 37-spec legal Playwright suite and every featured app drive the surfaces in this chapter directly, with no frontend and no JWT (reference/test-audit.md section 2.4). Sections 7.5 to 7.7 are therefore compatibility contracts, not designs.

### 7.1.1 Carryover map

Every component of this pipeline traces to an audited verdict; the implementation run ports against this table, never against the old repository at large:

| Component | Verdict | Reference |
|---|---|---|
| Builder (esbuild core, CDN plugin, watch, bundle validation) | port-as-is | carryover-audit A3, `app-builder.ts` row |
| Manifest schema and validation | port-as-is | A3, `app-manifest.ts` row |
| Scaffold plus its starter-templates data directory | port-as-is (bring the data directory along) | A3, `app-scaffold.ts` row |
| App registry | adapt: keep registry, chokidar watch, dist metadata; drop the dead per-app content maps | B2 |
| Static serving, context injection, `/build/:slug`, download | extract from the old monolith into routers, logic unchanged | B4 |
| App-files and cloud-files routers | port-as-is; the structural template every extracted router follows | A3, `routes/app-files.ts` and `routes/app-cloud-files.ts` rows |
| Slug module | adapt: deterministic generation only, keep index and collision logic | llm-usage-map row 25; carryover-audit B3 |
| Git and GitHub pipeline (provider, repos, backup, fork, remote, commit functions) | port-as-is; strip the retired wrapper shell around the commit functions | B18 |
| Per-repo lock | port-as-is (zero imports) | services sweep, `repo-lock` row |
| Commit secret guard and archive guard | port-as-is | A7; services sweep, `app-archive` row |
| Screenshot capture | port-as-is | A10 |
| Artifact PDF, featured prebuilder | adapt alongside the registry | B15 |
| Fork, bundle, featured-update, artifact-files services | adapt (re-point at ported stores and builder) | services sweep, `artifact-fork` / `artifact-bundle` / `featured-update` / `artifact-files` rows |
| Health scanner | adapt (follows the registry) | services sweep, `app-health-scanner` row |
| Share lookup (inside the gate) | adapt | services sweep, `share-lookup` row |
| Artifact-backend worker runtime family | adapt: two seams swapped (model capability to `llm/`, notify to an injected callback) | B19; chapter 02 section 2.8 |

## 7.2 Bundling pipeline

### 7.2.1 Build entry

`build(appId, projectDir)` runs the frontend build and, when the manifest declares one, the backend build; backend compile errors are merged so a broken backend fails the whole build loudly (reference/invisible-behaviors.md section 8.1). The manifest schema and validation port unchanged (reference/carryover-audit.md A3, `app-manifest.ts` row). An invalid manifest is tolerated with defaults (`entryPoint: frontend/src/index.jsx`, `outputDir: dist/`).

### 7.2.2 Frontend build

Carried exactly (reference/invisible-behaviors.md section 8.1):

- **Plain-HTML fast path**: a root-level `index.html` (never created by the scaffold) means static output - files are copied to `dist/`, no esbuild runs.
- **JSX path**: esbuild with the shared options below, then `dist/index.html` is generated from the scaffold template with a conditional `bundle.css` link. The generated HTML also carries the `/api/design-tokens.css` stylesheet link before the bundle - a product contract with its own test gate (chapter 03, section 3.8.23). The org whose tokens are served is resolved **server-side from the app's slug** (Amendment 2): the endpoint serves that org's brand tokens when brand research exists for the org, and the **platform default design system** otherwise - a deliberate neutral palette, a system font stack, and no logo, so the header falls back to the org display name and never the vendor's brand. The URL and byte-contract are unchanged, so the 37 legal e2e specs do not move (chapter 04 owns the org record; founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).
- **Failure never 404s**: a missing entry point or a failed build writes an error HTML page with a 5-second auto-reload into `dist/`, so the preview iframe self-heals when the next build succeeds.
- **Shared esbuild options** (carried verbatim): IIFE format, platform browser, target es2020, `jsx: 'automatic'`, entry names `bundle`, `minify: false`, `sourcemap: true`, `metafile: true`, `define NODE_ENV="development"`; loaders for js/jsx/tsx/ts/css/images/fonts. React resolves from the API service's own `node_modules` via `nodePaths` - sandboxes never run `npm install`.
- **CDN resolver plugin** (carried verbatim): intercepts `https://` imports; CSS `@import url()` stays external; known packages resolve locally first; anything else is fetched from esm.sh at build time (15 s timeout, in-memory cache) and **bundled, never marked external** - IIFE plus external emits `require()`, which breaks browsers. Nested esm.sh relative imports resolve back to esm.sh; fetch failures compile to inert stub modules so one dead import cannot fail the build.

### 7.2.3 Bundle validation

`validateBundle(distDir)` reads the first 20 bytes of `dist/bundle.js` and requires the IIFE prefix (`(() => {`). It guards the final-build retry loop (section 7.4, trigger 3) against the agent producing ESM output (reference/invisible-behaviors.md section 8.1).

### 7.2.4 Backend bundle (artifact backends)

When the manifest declares a backend, esbuild produces `dist-backend/backend.mjs` (platform node, format esm, target node20). The artifact-backend worker runtime imports that bundle at invoke time; the capability handle the backend code uses is injected at runtime and never imported at build time (reference/invisible-behaviors.md section 8.1; reference/carryover-audit.md B19). The worker runtime, its capability RPC, revoke tombstone, and drain semantics port with their two seams swapped per B19; its lifecycle API is chapter 03 section 3.8.11.

### 7.2.5 Watch mode

Carried exactly (reference/invisible-behaviors.md section 8.1): watching an app disposes any prior esbuild context first; plain-HTML apps skip watching; the watch context's rebuild hook regenerates `dist/index.html`, **clears the artifact's stale health verdict** (section 7.11), and fires the caller's rebuild callback, which emits `preview_reload` on the build job's event stream (chapter 03, section 3.6.2 - the event is in the typed contract and the migrated client consumes it, fixing the dead-on-wire registration bug recorded in reference/operations-inventory.md C5.2). `unwatch` disposes one context; all contexts dispose on shutdown (section 7.16). After any successful build or rebuild, the artifact's persisted `health` field is cleared so the next in-page probe re-evaluates.

### 7.2.6 Per-build verification (Amendment 2)

Per-build verification is a pipeline stage that drives the just-served app through automated tests before the build is presented as done. It is **default ON**, governed by the user's per-user `build.verifyBuilds` setting (the first-ever-build ask-once dialog, the banner shown while testing, and the settings toggle are chapter 12; the answer to that dialog is stored as this setting). The stage runs **playwright-cli against the served app** (section 7.5) at **medium depth**, and is **incremental**: the artifact's first build gets a full acceptance pass, while every follow-up build runs scoped tests of the change plus a smoke pass. The verifying agent **fixes forward within the build's slice retry budget** (chapter 05); if it cannot make the tests pass inside that budget, the build **completes anyway with the honest visible note** - the same carried "completed with a visible note" mechanism a failed final build uses (section 7.4 trigger 3). Verification tokens are attributed **`user_work`** with agentType `build-verify`, billed to the build's user (chapter 06), so the zero-platform-calls posture stands untouched. The run-lifecycle placement of this stage is chapter 05 section 5.6.2: verification runs **after** the final bundle and its version snapshot, so any fix-forward edits re-enter the bundle path - re-bundled under the same 2-attempt IIFE validation (section 7.2.3) - and are then captured by a **post-verification version snapshot taken through the same per-repo lock** (section 7.9), leaving the shipped version inclusive of the fixes. A verification the agent cannot fix within the slice retry budget keeps the pre-verification snapshot and the build completes with the honest visible note. Live test-run streaming and click visualization are parked, post-launch (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

## 7.3 Scaffold and registry

**Scaffold** (`scaffoldApp`, port-as-is - reference/carryover-audit.md A3): creates `frontend/src`, writes `manifest.json` if absent, writes either the artifact's scaffold files (path-safety: absolute paths and `..` rejected; always overwrites) or the generic starter files (skip-if-exists), then best-effort git init plus an `Initial scaffold` commit so the first agent iteration has a parent commit (reference/invisible-behaviors.md section 8.2). Idempotent. The legacy per-app content directories the old scaffold also created are **not** carried - the registry's per-app content maps are dead weight in the new architecture and are dropped per the B2 verdict (reference/carryover-audit.md B2); agent-facing content is chapter 08's concern and never lives inside user app trees.

**Registry** (adapted per B2): an in-memory map of registered apps with `distDir`, `projectDir`, `userId`, and manifest. `register` is idempotent (unregisters first) and starts a chokidar watcher over `manifest.json` and the dist directory with a 100 ms per-file debounce; dist changes notify registered listeners. Boot scans `user-*/` project directories under the sandbox root and registers **only projects with a valid `manifest.json`**. Unregister keeps static files on disk (reference/invisible-behaviors.md section 8.3).

## 7.4 What triggers a bundle (complete list, carried)

The complete trigger list carries from production (reference/invisible-behaviors.md section 8.4). No other code path may invoke the builder.

| # | Trigger | Behavior carried |
|---|---|---|
| 1 | First-build kickoff, before the agent starts | Initial build plus watch; a failure here is non-fatal (the agent will fix the code) |
| 2 | Agent edits during a build job | esbuild watch context rebuild, HTML regeneration, `preview_reload` on the job stream |
| 3 | Final build after the agent completes | Watcher stopped first (concurrent esbuild operations share one service process; interleaved responses crash it), `dist/` wiped, up to 2 attempts each validated by the IIFE check (7.2.3) |
| 4 | Featured-artifact boot prebuild | Post-listen, fire-and-forget (section 7.13) |
| 5 | Lazy heal of a `/apps` request | GitHub hydrate plus rebuild when the working copy is missing (sections 7.5 and 7.9) |
| 6 | Dev-serve register route | Build, register, watch; **disabled in production-like environments** - carried as a dev-only route |
| 7 | The build action exposed to the coding agent | Validates the project directory is inside the sandbox root before building (chapter 05 owns the agent tool surface) |

Artifact fork and bundle import/update flows (section 7.10) rebuild the new or updated working copy through the same builder entry points; they are reuses of trigger-3-style final builds, not separate trigger classes.

## 7.5 Static serving and slug resolution

Extracted from the old monolith into router files, logic unchanged (reference/carryover-audit.md B4; the extraction template is the already-router-shaped app-files module, A3). All `/apps/*` responses carry `Access-Control-Allow-Origin: *`. The request pipeline for `GET /apps/:idOrSlug/*` is carried in exactly this order (reference/invisible-behaviors.md section 8.5):

1. **301 trailing-slash redirect** for bare `/apps/<id>`.
2. **Canonical id resolution**: slug lookup first, raw id fallback. App data is always keyed by the canonical artifact id, so slug edits never orphan data (chapter 04, section 4.2).
3. **Shareability gate on document requests only** (section 7.7).
4. **Dist resolution** via the registry, with slug fallback and a dist-existence check.
5. **Lazy heal**: a persisted artifact whose project directory sits under the sandbox root or the featured-builds mirror but is missing on disk attempts GitHub lazy hydration (section 7.9) plus a rebuild; the app registers only when `dist/index.html` exists.
6. **No dist yet**: the "Building..." response - an **uncacheable** 503 plain-text for asset-extension requests, an uncacheable auto-refreshing (3 s) HTML page for navigations. This asymmetry is load-bearing: a cached 200 HTML body under an asset URL would later execute as JavaScript and permanently brick the app.
7. **HTML**: `index.html` served through the context injector (section 7.6) with no-cache headers; a dist without `index.html` (mid-build window) gets the building placeholder.
8. **Assets**: cached static middleware per dist directory. Cache discipline carried verbatim: HTML no-cache; hashed js/css one year immutable; non-hashed `bundle.js`/`bundle.css` no-cache (hot reload); everything else 1 hour. A static miss on an asset path returns JSON 404 (never HTML-as-JS); a navigation miss falls back SPA-style to the injected `index.html`.

The cache-header discipline, IIFE validation, and never-cacheable building placeholder each encode a "permanently bricked app" bug class and are acceptance-tested, not optional (reference/invisible-behaviors.md section 8, closing note).

## 7.6 Context injection (byte-compatible)

**FIXED (FIXED-9; reference/test-audit.md section 2.4):** every served HTML document is stamped with the same context the old service injects, byte-compatible in behavior - same globals, same helper names, same header scoping, same cookie semantics. The backing routes are fixed in chapter 03 section 3.9; the collections engine behind them in chapter 04. The injected surface, enumerated (reference/operations-inventory.md section 24; reference/invisible-behaviors.md section 8.5):

| Injected item | Members / behavior | Backing surface |
|---|---|---|
| `window.__EKOA_APP_ID` | The canonical artifact id (never the slug) | - |
| `window.__ekoa.fetch` | Raw per-user app-data fetch wrapper; adds `X-Ekoa-App-Id` | `/api/app-data/*` |
| `window.__ekoa.list/get/create/update/delete` | Per-user collection CRUD conveniences | `/api/app-data/:collection[/:id]` |
| `window.__ekoa.shared.{list,get,create,update,delete}` | Owner-scoped shared collections (the legal-suite spine) | `/api/app-shared/:collection[/:id]` |
| `window.__ekoa.uploadFile` / `deleteFile` | Per-app file upload/delete; raw bytes plus metadata headers | `/api/app-files` |
| `window.__ekoa.signIn` / `whoami` / `signOut` | End-user Microsoft SSO and session identity | `/api/app-sso/microsoft/*`, `/api/app-sso/me`, `/api/app-sso/logout` |
| `window.__ekoa.passwordSignIn` / `setUserPassword` | End-user password auth inside served apps | `/api/app-sso/login`, `/api/app-sso/set-password` |
| `window.__ekoa.graphFetch` | Microsoft Graph proxy acting as the signed-in visitor | `/api/app-sso/m365/*` |
| `window.__ekoa.exportPdf` | POSTs the app's serialized DOM for server-side PDF rendering | `/api/app-pdf` (section 7.12) |
| `window.__ekoa.cloudFiles.{status,upload,list,download}` | Workspace Google Drive / OneDrive files; credential never reaches the page | `/api/app-cloud-files/*` (section 7.14) |
| In-page health probe | Captures the first uncaught error, unhandled rejection, or empty DOM; reports once to `/api/app-health` after ~3 s settle (10 s max) with a keepalive fetch | section 7.11 |
| Demo bridge | `<script src="/__ekoa/demo-bridge.js">` for the guided-tour postMessage machine | `/api/demos*` (chapter 03, section 3.8.23) |
| `<base href="/apps/<id>/">` | Deep SPA routes reload their own bundle instead of a 404 | - |

Tokens are deliberately absent from the injected context: apps authenticate to the data plane by header scoping and (for end-user SSO) per-app HttpOnly cookies, never by holding a platform JWT (chapter 09).

## 7.7 Shareability gate and share links

**Gate** (carried exactly - reference/invisible-behaviors.md section 8.5): applied to document requests only, never to assets - browsers do not propagate `?token=` on sub-resource fetches, so gating assets would blank the iframe. A revoked share returns a 410 page in PT-PT unless the requester is the owner; the requester token is resolved in the order Authorization header, `ekoa_token` cookie, `?token=` query.

**Q-05 - RESOLVED (pointer; register of record chapter 16):** non-shareable app previews keep `?token=` in the URL (cross-origin dev iframes cannot share cookies), paired with a log-redaction middleware that strips the token from access logs. This chapter's requester-token resolution order (Authorization header, `ekoa_token` cookie, `?token=` query) is therefore normative and unchanged (reference/frontend-cleanup-audit.md FC-068, FC-024). Rejected alternative: move non-shareable previews to same-origin cookies. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

**`GET /build/:slug` share links** (carried exactly): per-request shareability lookup; unknown slug 404, revoked 410; unauthenticated visitors redirect to the frontend `/login?next=` and resume after login; authenticated visitors get a **fresh fork per click** (section 7.10) plus a redirect to `/chat?continue=<newArtifactId>` (reference/invisible-behaviors.md section 8.5; reference/operations-inventory.md section 23).

## 7.8 Slugs: deterministic generation only

**FIXED (FIXED-3; reference/llm-usage-map.md row 25 and its fate entry):** slug generation ships as deterministic code only. The old Haiku call is not carried - the committed deterministic fallback already produces working slugs on every model failure, and the model only improved aesthetics.

- **Generation**: derive 2-4 lowercase hyphenated words from the artifact name; strip brand and platform stop-words; resolve collisions with `-2` through `-99` suffixes, then a base36 timestamp (the carried fallback plus collision logic - reference/invisible-behaviors.md section 8.5).
- **Call sites**: first builds, forks, bundle imports, and the `/build/:slug` fork flow - the same set as today (reference/llm-usage-map.md row 25 call-site list).
- **Index**: an in-memory slug-to-id map loaded from persisted artifacts at boot; O(1) lookups; new slugs indexed on assignment.
- **Stability**: follow-up builds preserve the existing slug - regenerating would rename the app because the user asked for a change (reference/invisible-behaviors.md section 7.2, final-build step 4).
- **Editing**: `PATCH /api/v1/artifacts/:id` validates and persists slug changes, `409 SLUG_TAKEN` on collision (chapter 03, section 3.8.9). Because serving resolves slugs to canonical ids (7.5 step 2), edits never orphan app data.

## 7.9 Versions: git snapshot, secret guard, GitHub mirror

Git is the system of record for artifact source; the pipeline carries per B18 (reference/carryover-audit.md B18) with these behaviors fixed:

- **One lock per repo.** A per-project mutex serializes the agent-stop auto-commit, the user file-save commit, version restore, and the GitHub push - one lock shared by commit and push paths, because two separate mutexes would not be mutually exclusive (reference/invisible-behaviors.md section 7.6, git-writes row; carryover services sweep, `repo-lock` row).
- **Auto version snapshot on build completion.** Every completed build commits the working tree; a broken final build is committed tagged `[build-failed]` - users may revert **from** a broken version (reference/invisible-behaviors.md section 7.2, final-build step 3).
- **Secret guard on every commit (FIXED-8).** The commit guard (port-as-is, reference/carryover-audit.md A7) scans the diff; a detected credential blocks the snapshot loudly, writing a `commit-blocked` activity row with the findings through the single audit write path (FIXED-8; reference/invisible-behaviors.md section 10.2). The same guard gates code egress: the artifact zip download returns `422 SECRET_GUARD_BLOCKED` (chapter 03, sections 3.8.9 and 3.3; chapter 09 owns the invariant).
- **GitHub mirror.** After a successful snapshot, a fire-and-forget safe-wrapped backup pushes to the artifact's GitHub repo, gated by the push-enabled config toggle (reference/invisible-behaviors.md section 7.2 step 3). The provider abstraction (GitHub App RS256 JWT, PAT dev path) ports as-is (B18, `provider.ts` row).
- **Lazy hydration.** When a served artifact's working copy is missing from disk (fresh volume, pruned sandbox), the serving path clones it back from the mirror and rebuilds before registering (7.5 step 5).
- **Commit-on-save.** `PUT /artifacts/:id/file` commits the saved file under the repo lock (chapter 03, section 3.8.9).
- **Versions API.** `GET /artifacts/:id/versions` lists commits (sha, message, author, timestamp, `buildFailed`, `isRestore`); `POST /artifacts/:id/versions/:sha/restore` restores under the repo lock and returns the new head sha; clients reload the preview afterwards (chapter 03, section 3.8.9; reference/operations-inventory.md section 8).

## 7.10 Fork, bundle export/import, and update-in-place

These flows create or replace an artifact's working copy and then re-enter the pipeline through a trigger-3-style rebuild plus registration (7.4). Wire shapes are chapter 03 section 3.8.9; the pipeline behaviors fixed here trace to reference/operations-inventory.md section 8 and the carryover services sweep (`artifact-fork`, `artifact-bundle`, `featured-update`, `app-archive` rows).

- **Fork** (`POST /artifacts/:id/fork`): copies the source working copy into a new project directory owned by the caller, creates a new artifact record, generates a fresh deterministic slug (7.8), rebuilds, and registers. The GitHub-side repo fork rides the same provider abstraction as the mirror (B18). Forks are how featured "Usar" cards and `/build/:slug` share links hand a user their own copy (7.7); the popup-blocker-safe navigation stays client-side (chapter 03, section 3.8.9).
- **Export** (`GET /artifacts/:id/export`): serializes the artifact - manifest id, source files, metadata - into a portable bundle. Zip packing and parsing are client-side today and stay there; the API sends and receives the parsed bundle JSON (reference/operations-inventory.md section 8, `import-instance` row).
- **Import** (`POST /artifacts/import`): creates a new artifact from a bundle - working copy written, deterministic slug generated, rebuilt, registered.
- **Update-in-place** (`POST /artifacts/:id/bundle-update`): replaces an existing artifact's source from a bundle. Safety-nets first, carried: the server takes an app-data snapshot and a pre-update version snapshot **before** touching the tree and returns both ids (`safetyNetSnapshotId`, `preUpdateVersionId`). A bundle whose manifest id does not match the target is refused `409 MANIFEST_ID_MISMATCH` unless the request carries `force: true` - the client drives an explicit confirm dialog off that status (chapter 03, sections 3.8.9 and 3.3).
- **No side doors.** All of these route their git writes through the version pipeline of 7.9 (repo lock, secret guard) and their rebuilds through the builder entry of 7.2.

## 7.11 Screenshots and app health

**Screenshots** (port-as-is - reference/carryover-audit.md A10): one shared headless Chromium from the browser pool with a concurrent-launch guard and process-exit cleanup; captures `/apps/<id>/` at 1280x800, network-idle plus 800 ms settle, 30 s timeout; every call overwrites (no debounce); PNGs stored under the data directory and served publicly at `/artifact-screenshots/` with CORS and cache headers (chapter 03, section 3.8.23). Fired fire-and-forget after every completed build and from the featured prebuilder (reference/invisible-behaviors.md section 8.6).

**App health** (carried - reference/invisible-behaviors.md section 6):

- The injected in-page probe (7.6) reports `healthy | broken` with a reason to `POST /api/app-health`, identified by `X-Ekoa-App-Id` (slug-resolved). Unknown ids are dropped silently; **featured artifacts are skipped** - one viewer's flaky load must not flip a global badge; a 60 s in-memory same-status dedupe absorbs probe storms; the verdict persists on the artifact record.
- A post-boot health scan headless-loads every unchecked non-featured artifact (concurrency 4, 8 s navigation timeout, 4 s probe settle) so the injected probe populates verdicts; the scanner itself never writes - only the probe does. Skippable via a config toggle.
- Any successful build or rebuild clears the stored verdict so the next probe re-evaluates (7.2.5).

## 7.12 Artifact PDF export

Carried as a whole pipeline (reference/invisible-behaviors.md section 8.8):

- **Routes**: `GET /api/v1/artifacts/:id/pdf` renders the built artifact to PDF and 302-redirects to the served file - the id is charset-guarded because it becomes the output basename; `POST /api/app-pdf` is the app-facing export behind `window.__ekoa.exportPdf`, scoped by `X-Ekoa-App-Id` (7.6).
- **Rendering**: the shared headless Chromium pool with an injected vetted print-reset stylesheet that fixes screen-first pagination bugs (atomic cards and table rows split mid-element) **without touching the source HTML**, and deliberately imposes no page margins (full-bleed covers must survive). Hardened: page JavaScript disabled, private-network subresources blocked.
- **Persistence and serving**: PDFs written under the data directory and served statically at `/artifact-pdfs` with CORS and 1 h cache. This is a retention-less growth store today; its retention policy is decided with the rest in chapter 04 (RESOLVED (P-09)).

## 7.13 Featured artifacts

Featured artifacts are the versioned starting-point apps seeded from the repository's featured-artifacts content. Four carried mechanisms (reference/invisible-behaviors.md sections 5.1, 7.2, and 8.4; reference/operations-inventory.md section 8):

**Seeding (boot, sequential migrations phase).** `seedFeaturedArtifacts` creates or refreshes an artifact record per versioned featured directory and sweeps orphans whose source directory disappeared. Idempotent every boot. Artifacts with declared backends get their project directory patched onto the seeded record with a fresh-read-then-write to shrink the shallow-merge clobber window - a documented, accepted race (reference/invisible-behaviors.md section 8.4).

**Prebuild (post-listen, fire-and-forget).** So `/apps/<id>/` and screenshots work without a first visitor:

- Freshness check: skip when `dist/index.html` is at least as new as the newest source file.
- **Bare-import pre-check**: an unresolvable bare import crashes the esbuild service process from a socket callback - uncatchable, kills the whole API process - so such scaffolds are detected and skipped cleanly. This check is mandatory in the port.
- Customized featured artifacts build from the user's **working copy**; the scaffold is never force-copied over user edits.
- Scaffolds are mirrored to a featured-builds directory under the data dir so build output stays out of the versioned tree.
- **Registration happens even on build failure** - the error HTML (7.2.2) serves instead of the "Building..." placeholder.
- Screenshots fire-and-forget, self-healing only when the prior PNG is missing.

**Working-copy materialization (first edit).** A featured artifact the user has not yet edited has no working copy of its own - it serves from the featured-builds mirror. The user's first confirmed modification materializes a persistent working copy (idempotent - re-running is a no-op) and repoints the artifact's project directory at it; a materialization failure aborts the build job with a PT-PT error (reference/invisible-behaviors.md section 7.2; chapter 05 owns the job-side sequencing and delegates these mechanics here). From then on the artifact builds from the user's working copy, per the prebuild rule above.

**Update by consent.** When a versioned featured source changes, users who forked and customized it are never silently overwritten:

- `POST /artifacts/:id/featured-update/apply` applies the new source **after** the server safety-nets the user: an automatic app-data snapshot plus a pre-update version snapshot first; a no-op success for non-customized copies (chapter 03, section 3.8.9; reference/operations-inventory.md section 8, `update-featured-from-source` row).
- `POST /artifacts/:id/featured-update/ignore` dismisses the update badge and keeps the user's version.
- `PUT /artifacts/:id/featured` (admin) toggles featured status and rank.

## 7.14 Adjacent served-app planes (do not amputate)

The serving pipeline is only part of what a served app reaches. The reference audit closes its pipeline section with an explicit warning: a rebuild that only reimplements `/apps` serving amputates PDF export, cloud files, the workspace Graph proxy, and the whole legal-suite service layer (reference/invisible-behaviors.md section 8, closing note). The wire surface for all of these is fixed byte-compatibly in chapter 03 section 3.9; the rows below pin the behaviors that ride this chapter's primitives (slug resolution, `X-Ekoa-App-Id` scoping) and name the owning module so nothing falls between chapters:

| Plane | Behavior carried | Owner |
|---|---|---|
| Cloud files (`window.__ekoa.cloudFiles`) | Provider quirks absorbed server-side so generated apps never carry them: Google Drive multipart upload under 5 MB vs resumable session above; Graph simple PUT under 4 MB vs upload session; Google-native Docs/Sheets/Slides cannot be fetched raw and are exported to their Office equivalents on download. The workspace credential is injected server-side with refresh handled in core; it never reaches the page (reference/invisible-behaviors.md section 8.9) | `integrations/` (chapter 02); routes per chapter 03 section 3.9 |
| Workspace Graph proxy `/api/m365/*` | Acts as the **workspace's** Microsoft connection: caller-chosen Graph path forwarded verbatim, raw bodies byte-exact, upstream failures 502. Distinct from `/api/app-sso/m365/*`, which acts as the signed-in visitor. **Access gate (RESOLVED (Q-10), normative):** the proxy requires and verifies `X-Ekoa-App-Id` (slug-resolved through this chapter's index, charset-checked, the app must exist and be served) plus a per-app manifest opt-in flag; a caller failing the gate is refused. The sweep of which existing served apps call the proxy without the header is a named cutover checklist item (chapter 10), sized before the gate flips on (reference/invisible-behaviors.md section 8.9) | `integrations/`; access gate owned by chapter 09 section 9.4; token handling chapter 09 |
| Legal-suite services (`/api/legal/*`, `/api/legal-research`, `/api/tracking/consulta`, `/api/citius/consulta`, `/api/signature/send`) | Gate carried: `X-Ekoa-App-Id`, slug-resolved through this chapter's index, charset-checked, per-endpoint app allowlist with a 403 PT-PT refusal; sliding-window rate limits returning 429 "Tente novamente dentro de um minuto"; a blocked caller's hit is not recorded, so it cannot extend its own cooldown (reference/invisible-behaviors.md section 8.10) | `legal/` (chapter 02); access gate owned by chapter 09 section 9.4 |

## 7.15 Preview lifecycle (no dev servers)

The complete lifecycle, carried (reference/invisible-behaviors.md section 8.7):

```
scaffold -> initial build -> register -> watch
  -> agent edits -> rebuild -> preview_reload (job event stream)
  -> final build (watcher stopped, dist wiped, 2 attempts, IIFE-validated)
  -> artifact active + slug + screenshot
  -> served at /apps/{slug|id}/ with injected context
```

- Watchers are per-app, replaced on re-watch, all disposed on shutdown.
- Follow-up build jobs re-arm the watcher and re-register the app before the run pipeline starts.
- Preview readiness is client-side polling: the web client HEAD-polls the app URL until it returns 200 (reference/operations-inventory.md section 23) - no push channel exists or is added for readiness (FIXED-2 scope; chapter 03, section 3.6).
- There is no dev-server mode: the only "live" behavior is esbuild watch rebuilding static output plus the `preview_reload` event.

## 7.16 Boot and shutdown obligations

The composition root (chapter 02, `server.ts`) wires this module's boot steps in the carried order (reference/invisible-behaviors.md section 5.1):

| Phase | Step |
|---|---|
| Parallel boot block | registry scan of the sandbox root; slug index load |
| Sequential migrations | featured-artifact seeding plus orphan sweep |
| Post-listen, fire-and-forget | featured prebuild (7.13); app health scan (7.11) |
| Shutdown | dispose all esbuild watch contexts; stop the registry watchers (in-flight builds are abandoned; the error-page and building-placeholder rules make this safe) |

## 7.17 Acceptance criteria (checkable without a human)

1. The ported 37-spec legal suite passes against the new service with changes confined to its helpers, not its assertions (reference/test-audit.md section 2.4) - this single criterion covers serving, injection, and the data plane end to end.
2. Every trigger in the 7.4 table has a test that causes it and observes a resulting `dist/` change; a code census finds no builder invocation outside those triggers plus the 7.10 flows.
3. A request for a missing asset under `/apps/:id/` returns JSON 404 with no-cache semantics; a navigation to a missing path returns the injected `index.html`; a not-yet-built app returns 503 (asset) or auto-refreshing HTML (navigation), both uncacheable - each asserted by contract test.
4. `dist/bundle.js` of every completed build starts with the IIFE prefix; a deliberately ESM-emitting fixture fails the final build after 2 attempts and the artifact records the failure.
5. Injected HTML for a fixture app contains every member of the 7.6 table (globals, helper names, demo-bridge script, base href), verified by string assertion against a served response.
6. A slug is generated for a new artifact with no model call recorded in the LLM chokepoint's attribution log (FIXED-3); a collision fixture produces `-2` suffixing; a follow-up build leaves the slug unchanged.
7. A commit containing a planted credential is blocked, produces a `commit-blocked` activity row through the single audit write path, and the zip download of the same tree returns 422 (FIXED-8).
8. A featured scaffold with an unresolvable bare import is skipped by the prebuilder and the process stays alive; a customized featured artifact receives `featured-update/apply` only after a snapshot pair (app data + version) exists.
9. Deleting the working copy of a mirrored artifact and requesting `/apps/:id/` heals it: hydration, rebuild, and a 200 HTML response.
10. The health probe of a deliberately broken fixture app flips its record to `broken`; a subsequent successful rebuild clears the verdict; a featured artifact's probe report is ignored.
11. Forking a fixture artifact yields a new artifact id with a distinct slug, its own working copy, and a 200 served response at the new slug; the source artifact's tree is byte-identical before and after.
12. `bundle-update` with a mismatched manifest id returns `409 MANIFEST_ID_MISMATCH` and leaves the target tree untouched; the same call with `force: true` succeeds and its response carries a resolvable snapshot pair (the app-data snapshot exists; the pre-update version appears in the versions list).
13. `GET /api/v1/artifacts/:id/pdf` on a built fixture returns a 302 to a served PDF; `POST /api/app-pdf` without an `X-Ekoa-App-Id` header is refused.
14. Two consecutive follow-up edits of a featured artifact materialize the working copy exactly once; the second build reuses the same project directory.
15. A request to `/api/m365/*` without a valid `X-Ekoa-App-Id`, or from an app whose manifest lacks the opt-in flag, is refused; a request carrying a served app's header with the flag set is forwarded (RESOLVED (Q-10); the gate is owned by chapter 09 section 9.4).
16. Per-build verification (7.2.6) is observable and honest: an artifact's first build runs a full acceptance pass while a follow-up build runs scoped-plus-smoke; a verification the agent cannot fix within the slice retry budget still completes the build and records the honest visible note; the verification's token rows are attributed `user_work` `build-verify`; and a user whose `build.verifyBuilds` setting is off gets no verification stage (the toggle is honored).
17. `/api/design-tokens.css` resolves the org server-side from the requested app's slug: an app of org A never receives org B's tokens, and an app whose org has no brand research receives the platform default design system (neutral palette, system font stack, no logo) - the URL and byte-contract unchanged (7.2.2).

Cross-references: diagrams `spec/diagrams/02-module-map` and `spec/diagrams/03-request-crud` (the two diagrams that render this pipeline; FIXED-12 per the chapter opening); chapter 02 (`apps/` module boundaries and injected seams), chapter 03 (artifact endpoints 3.8.9-3.8.11, served-app plane 3.9, statics 3.8.23), chapter 04 (collections engine, blob and retention decisions P-07/P-09), chapter 05 (build job lifecycle that invokes triggers 1-3 and the materialization sequencing), chapter 09 (secret guard, path confinement, token handling, served-app access gates 9.4), chapter 10 (served-app m365-proxy sweep cutover item), chapter 16 (Q-05 resolution).

*Amendment record: amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md).*

*Amended again 2026-07-06 per the consolidated-ledger amendment (Amendment 2, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md): added the per-build verification pipeline stage (section 7.2.6 - default ON via the user's `build.verifyBuilds` setting, incremental playwright-cli at medium depth, fix-forward within the slice retry budget with a re-bundle and a post-verification snapshot through the repo lock since verification follows the final snapshot (ch05 §5.6.2), honest visible note on failure to fix, `user_work` `build-verify` attribution) with acceptance criterion 16; specified server-side org resolution of `/api/design-tokens.css` from the app's slug (the org's brand tokens when research exists, the platform default design system otherwise; URL and byte-contract unchanged) with acceptance criterion 17.*
