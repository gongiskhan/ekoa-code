# OS Mode - Surface Contract (Run 1)

Status: DRAFT - awaiting human review (the run's single checkpoint). Implementation of
Task 2 does not begin until this document is approved.

This document is the contract for mounting existing dashboard pages as "surfaces" - the same
component rendered either by the classic shell (sidebar + route) or by the OS shell (a window,
or a full-screen surface on narrow viewports). It contains the layout audit of every current
page, the surface/manifest contract, the actions model, the window model, the structural
decisions with the criteria applied, and the accepted run-1 compromises. Batch-two page
conversions follow the checklist at the end.

Related: `docs/architecture.md` (web/ stack), `docs/decisions.md` (the decisions below get a
consolidated entry when implementation lands), `.claude/skills/ekoa-architecture` (binding
boundaries), the Run 1 brief (operator-held).

---

## 1. Layout audit

### 1.1 The shell today

- The document root is hard-locked to the viewport: `web/app/globals.css:109-114` sets
  `html, body { margin:0; padding:0; overflow:hidden; height:100dvh }`. Nothing in the app
  scrolls the body; every scroll region is an inner `overflow-y-auto` element.
- The classic shell (`web/app/(dashboard)/layout.tsx:109`) is a `flex h-dvh w-full
  overflow-hidden` row: [Sidebar | column(Header, BillingWarningBanner, `motion.main`)].
  `motion.main` (`:138-146`) is `flex flex-1 overflow-hidden` and never scrolls itself; its
  key collapses every `/chat/*` route to one key so session switches do not remount the chat
  page (`:139`).
- The standard page wrapper `PageShell` (`web/components/ui/page-shell.tsx:18-24`) is
  `flex-1 overflow-y-auto` with a centered `max-w-*` inner column. Pages that use it already
  own their scroll and are height-agnostic - they only require a height-bounded flex parent,
  which a window body provides just as well as `motion.main` does.
- Consequence for OS mode: pages do not need a viewport; they need a height-bounded flex
  container. The OS shell reproduces the same chain (its own `h-dvh` root; each window body
  is a bounded flex column). The `html/body` lock stays untouched.

### 1.2 Cross-cutting viewport escapes (shared, not per page)

| Escape | Where | Behavior | Run-1 policy |
|---|---|---|---|
| `Dialog` / `ConfirmDialog` | `web/components/ui/dialog.tsx` (createPortal to `document.body`, `fixed inset-0 z-[90]`, body scroll-lock at `:54-55`) | Modal over the whole viewport, used by ~10 pages | Accepted viewport-level (see 6.1) |
| `Toaster` | `web/components/ui/toaster.tsx:26` (`fixed bottom-6 right-6 z-[100]`, mounted at app root) | Viewport toasts | Accepted viewport-level |
| `ArtifactPreviewOverlay` | `web/components/artifacts/artifact-preview-overlay.tsx:84` (`fixed inset-0 z-50`) | Full-screen app preview | Classic only; OS mode opens a window instead (see 4) |
| Hand-rolled dropdown backdrops | e.g. artifacts sort menu `web/app/(dashboard)/artifacts/page.tsx:2235`, memory tier menu `.../memory/page.tsx:223` (`fixed inset-0` click-catchers) | Invisible full-viewport backdrop per open menu | Converted surfaces migrate these menus to the new `ActionMenu` primitive, which removes the backdrops |
| `useIsMobile` | `web/hooks/useIsMobile.ts` (`matchMedia (max-width: 767px)`) | Device-width switch, used by the dashboard layout and the chat page | Legitimate at shell level ("is this device narrow"); forbidden inside surfaces (a narrow window on a wide screen is not mobile) |
| Blocking overlays | `PauseForUserOverlay` (`fixed inset-0 z-[100]`), `BlockedAccountGuard` (`fixed inset-0 z-[60]`), both mounted in the dashboard layout | Whole-app blocking states | Accepted viewport-level in both shells (they are deliberately app-blocking); the OS layout mounts them too |

### 1.3 Per-page audit

Cost = effort to render correctly inside an arbitrary-sized window container.
Trivial = renders fine in any container today. Moderate = a bounded set of width-keyed
classes and/or shared-escape usage to convert. Hard = deep viewport coupling.

| Route | Cost | Container assumptions (evidence) |
|---|---|---|
| `/` | n/a | Server redirect to `/chat` (`app/(dashboard)/page.tsx:4`). Never a surface. |
| `/chat/[[...sessionId]]` | Hard | `useIsMobile` flips the whole topology (page.tsx:170): desktop = 3 columns (SessionsPanel `hidden md:contents` :1523, chat column `md:w-[380px] md:min-w-[320px] md:max-w-[420px]` :1745, SidePanel `hidden md:flex` :1779); mobile = viewport-fixed drawers and FABs (`fixed bottom-20 right-4` :1789; drawers `fixed inset-0 z-50` in `components/chat/mobile-*-drawer.tsx`). `file-editor-dialog.tsx:252-283` maximizes to `calc(100vw/vh - 48px)`. Interior heights are container-relative (flex-1/min-h-0), so the panels themselves dock cleanly - the page shell around them is the problem. Not converted in run 1 (see 5: extraction, not conversion). |
| `/artifacts` | Moderate | PageShell scroll (fine). Viewport-keyed grids `md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` (page.tsx:2316, 2403, 2443); logs dialog `max-h-[55vh]` (:322); sort-menu `fixed inset-0` backdrop (:2235); full-screen `ArtifactPreviewOverlay`; 5 body-portaled Dialogs. The run-1 template conversion. |
| `/automations` | Trivial | PageShell; one `sm:inline-flex` (page.tsx:77); shared Dialog only. |
| `/automations/new` | Trivial | PageShell; zero responsive prefixes. |
| `/automations/[id]` | Moderate | Rolls its own scroll but with the exact PageShell pattern (`flex-1 overflow-y-auto` :169, :207 - container-safe). `lg:grid-cols-2` editor grid (:282); shared Dialog. |
| `/integrations` | Moderate | PageShell; heaviest viewport grids `md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` (page.tsx:805, 896); shared Dialog. |
| `/knowledge` | Trivial | PageShell; zero responsive prefixes. |
| `/memory` | Moderate | PageShell; tier-menu `fixed inset-0` backdrop (page.tsx:223); `sm:grid-cols-2 lg:grid-cols-3` (:931); shared Dialog. |
| `/orgs` | Trivial | PageShell; shared Dialog only. |
| `/pedidos` | Trivial | PageShell; zero responsive prefixes. |
| `/registo` | Trivial | PageShell; zero responsive prefixes. |
| `/usage` | Trivial | PageShell; shared Dialog only. |
| `/users` | Trivial | PageShell; shared Dialog only. |
| `/settings/api-keys` | Moderate | PageShell; viewport-keyed table columns `sm:table-cell` / `md:table-cell` (page.tsx:149-151, 160-162); shared Dialog. |
| `/settings/branding` | Moderate | PageShell; `sm:flex-row sm:items-end` reflow (page.tsx:762); `lg:grid-cols-2` (:904). |
| `/settings/bridge` | n/a | Server redirect to `/settings/privacy`. |
| `/settings/devices` | Trivial | PageShell; zero responsive prefixes. |
| `/settings/platform` | Moderate | PageShell; `md:grid-cols-3` (page.tsx:241); shared Dialog. |
| `/settings/privacy` | Trivial | PageShell; tooltip width clamp `max-w-[calc(100vw-2rem)]` (`trust-chip.tsx:97`) is a guard, not a break. |

Out of scope as surfaces: `/login`, `/activate`, `/change-password` (unauthenticated,
full-viewport centered cards - they never mount inside either shell).

Reading of the table: the fleet is in better shape than the brief assumed. 10 of 18 real
pages are trivial, 7 are moderate for the same two reasons (viewport-keyed grid/table
classes, shared Dialog), and only chat is hard - and chat is handled by extraction rather
than conversion in this run. The contract below is priced accordingly: the sizing mechanism
makes the moderate pages a mechanical rename.

---

## 2. Surface contract

### 2.1 Definition

A surface is a container-agnostic component plus a manifest. The same component is mounted:

- by the classic shell: the route's `page.tsx` becomes a thin mount of the surface component
  (no behavior change - see sizing fallback in 2.3);
- by the OS shell: inside a window body (desktop) or full-screen (narrow viewports).

Contract rules for the component:

1. It fills its container (`flex-1 min-h-0` root) and owns its scroll (PageShell inside the
   surface is allowed and typical).
2. No viewport units, no `position: fixed`, no viewport-keyed responsive classes for
   width-driven layout (container variants instead - 2.3). Transient popovers via
   `ActionMenu`; modals via the shared `Dialog` (accepted viewport-level, 6.1).
3. No `useIsMobile`. If a surface ever needs JS width awareness, a ResizeObserver-based
   container-width hook will be added at that point (none needed in run 1).

### 2.2 Manifest

```ts
// web/lib/os/types.ts
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export interface SurfaceManifest {
  id: string;                                  // "artifacts" | "artifact-app"
  title: string;                               // PT-PT ("Artefactos"); instances may override
  icon: LucideIcon;                            // NAV_ITEMS precedent
  minSize: { w: number; h: number };           // px; window resize clamp
  preferredSize: { w: number; h: number };     // px; initial float size
  singleton: boolean;                          // artifacts: true; artifact-app: false (instance per artifactId)
  component: ComponentType<SurfaceProps>;
  actions: ActionDef<SurfaceActionCtx>[];      // surface-level actions (icon / window menu)
}

export interface SurfaceProps {
  instanceId: string;
  props: Record<string, unknown>;              // e.g. { artifactId } for artifact-app
  host: SurfaceHost;
}

export interface SurfaceHost {
  mode: "classic" | "os";
  openSurface(surfaceId: string, props?: Record<string, unknown>): void;
  requestClose?(): void;                       // OS windows only
}
```

Fields proposed by the brief and deliberately NOT adopted:

- `resize behavior` - every run-1 surface is freely resizable within `minSize`; a
  per-surface resize policy field serves no existing surface. Added when a surface needs it.
- `breakpoint strategy` - not per-surface configuration. It is one global contract rule
  (2.3); making it a manifest field would invite divergence with no consumer.

`SurfaceHost` is the single seam between a surface and whichever shell mounts it. It exists
so one action definition can behave host-appropriately (classic "open" = the existing
overlay/navigation; OS "open" = a window). It stays this small on purpose.

### 2.3 Sizing mechanism: CSS container queries (decision)

Prop-driven sizing was rejected: it re-implements responsive layout in JS per page, and none
of the existing Tailwind survives. Container queries are native to the stack:

- Browser matrix: there is no browserslist in `web/`; the effective floor is what Tailwind v4
  itself requires (Safari 16.4+, Chrome 111+, Firefox 128+), and every browser in that floor
  ships size container queries. No support gap exists for this app.
- CSS survival: the conversion is a variant rename, not a rewrite.

Mechanics:

1. `web/app/globals.css` `@theme` gains container sizes that mirror the viewport breakpoints
   exactly:

   ```css
   --container-bp-sm: 40rem;   /* = sm 640px  */
   --container-bp-md: 48rem;   /* = md 768px  */
   --container-bp-lg: 64rem;   /* = lg 1024px */
   --container-bp-xl: 80rem;   /* = xl 1280px */
   ```

2. Inside a surface component, width-driven `sm:/md:/lg:/xl:` prefixes are renamed to
   `@bp-sm:/@bp-md:/@bp-lg:/@bp-xl:` (e.g. the artifacts grid `md:grid-cols-2 lg:grid-cols-3
   xl:grid-cols-4` becomes `@bp-md:grid-cols-2 @bp-lg:grid-cols-3 @bp-xl:grid-cols-4`).
   Prefixes that are genuinely viewport-semantic (rare inside pages) stay.
3. The OS window body declares `@container`; the surface responds to the window's width.
4. Container resolution follows the nearest-ancestor rule, and every shell supplies the
   right container. The classic shell root (`(dashboard)/layout.tsx`, a `w-full h-dvh` div -
   viewport-wide, since body is margin-0) declares `@container`, so in classic mode
   `@bp-md:` measures the viewport width and behaves exactly like `md:` did - classic
   rendering is unchanged by construction. (A body scrollbar would be the one width
   difference between the root container and the viewport; `globals.css` locks body
   overflow to hidden, so none exists.) The OS shell root does the same, and each window
   body declares its own NEARER `@container`, so surfaces inside windows measure the
   window; full-screen narrow surfaces resolve to the shell root, i.e. the viewport.
   Important negative fact (verified against the spec): an element with no ancestor
   container never matches a size query at all - container queries do NOT fall back to the
   viewport (the small-viewport fallback in css-conditional-5 covers only `cq*` length
   units). The shell-root container is therefore mandatory, and nothing between a shell
   root and a classic surface mount may declare its own container. The artifacts conversion
   verifies parity once with a real-browser e2e resize check before batch two relies on it.

`useIsMobile` remains correct for shell-level decisions (which shell topology to render) and
is banned inside surfaces (2.1).

### 2.4 Manifest location: co-located + thin registry (decision)

Criteria: discoverability for batch two - one file must list every surface; no god-file -
manifest content (actions, sizes, component import) must not accumulate centrally.

- Manifest co-located with its component: `web/components/artifacts/artifacts.surface.ts`.
- Thin central registry `web/lib/os/registry.ts`: imports each manifest, exports the array
  and `getSurface(id)`. One import + one array line per surface - the same shape as
  `NAV_ITEMS` in `web/lib/navigation.ts`, which is the in-repo precedent for exactly this
  index-vs-content split.

### 2.5 Run-1 surfaces

- `artifacts` - the converted artifacts manager page (singleton).
- `artifact-app` - a served-app iframe window for one artifact (multi-instance, keyed by
  `props.artifactId`). Non-shareable artifacts keep the `?token=` ownership check; shareable
  ones keep the token-less public URL (existing rules, unchanged). Run-1 amendment: the
  planned `useArtifactAppSrc` dedup hook was NOT built - the surface needed only the token
  rule plus one document probe (`web/lib/preview-probe.ts`), and extracting the side panel's
  entangled build-preview poll machinery bought nothing. The side panel is untouched.

No other page is converted in this run.

---

## 3. Actions model

### 3.1 One definition, three triggers

```ts
// web/lib/os/types.ts
export interface ActionDef<Ctx> {
  id: string;
  label: string;                     // PT-PT
  icon?: LucideIcon;
  destructive?: boolean;             // styled red, sorted last
  available?: (ctx: Ctx) => boolean; // absent = always
  run: (ctx: Ctx) => void | Promise<void>;
}
```

A surface or item type declares its menu ONCE. The same filtered list is rendered by:

1. the `...` affordance - an always-visible `IconButton` on every app/artifact icon and card
   (never hover-gated; touch has no hover);
2. right-click (`onContextMenu`) on the item - desktop accelerator, both shells;
3. long-press (~500 ms pointer hold, cancelled by movement) - touch accelerator.

No trigger gets its own list. Availability predicates filter per item state and host mode.

### 3.2 The ActionMenu primitive (net-new)

`web/components/ui` has no dropdown/context-menu/popover primitive (dropdowns today are
hand-rolled with `fixed inset-0` backdrops). Run 1 adds:

- `web/components/ui/action-menu.tsx` - renders an `ActionDef[]` + ctx as a popover:
  portaled to body, positioned at the trigger's coords (context/long-press) or anchored to
  the `...` button, clamped to the viewport, closed on outside-pointerdown/Escape. Keyboard:
  trigger has `aria-haspopup="menu"`; arrow keys cycle items; Enter runs; Escape closes.
  Portaling a transient anchored popover is not a window-containment violation - it is
  visually attached to its trigger and dismissed on any outside interaction.
- `web/hooks/useLongPress.ts` - the shared long-press detector.

Converted surfaces replace their hand-rolled menus with ActionMenu (this removes the
`fixed inset-0` backdrops flagged in 1.2).

### 3.3 Artifact item actions -> existing endpoints

| Action (PT-PT label) | Command | Availability |
|---|---|---|
| Abrir | host-dependent: classic = existing preview overlay / open flow; OS = open `artifact-app` window | artifact status ready/running |
| Continuar no chat | navigate `/chat?continue=<id>` (existing flow) | always |
| Mudar o nome | name dialog -> `PATCH /api/v1/artifacts/:id` `{ name }` (existing) | always |
| Duplicar | `POST /api/v1/artifacts/:id/fork` (existing endpoint; today invoked only by the featured "Usar" flow via `web/lib/featured-fork.ts` - this is its first exposure as an artifact action) then refresh + toast | always |
| Partilhar / visibilidade | existing share/visibility controls (`PATCH` visibility, share toggle) | unchanged rules |
| Afixar na Dock / Desafixar | client-side: add/remove in active workspace `pinnedIds` | OS mode only |
| Remover do ecrã | client-side: remove from active workspace `desktopItems` | OS mode only |
| Eliminar | confirm dialog -> `DELETE /api/v1/artifacts/:id` (existing) | always; destructive |

No new API endpoints in run 1; therefore no new contract tests (the QA layer-3 rule binds on
new endpoints). Pin/desktop membership is OS-shell client state only.

Definitions live in `web/components/artifacts/artifact-actions.ts`; the classic artifacts
cards gain the same `...` menu + right-click (sanctioned by the brief's exit scenario 3 -
this and the global chat panel are the only classic-visible additions).

---

## 4. Window model

### 4.1 Window = surface instance + layout state

```ts
// web/lib/os/types.ts
export interface WindowState {
  id: string;
  surfaceId: string;
  props: Record<string, unknown>;
  title?: string;                    // instance override (e.g. artifact name)
  mode: "float" | "tile";
  rect: { x: number; y: number; w: number; h: number };  // px; float geometry, kept while tiled for un-tiling
  minimized: boolean;
}

export type TileNode =
  | { leaf: string }                                       // windowId
  | { empty: true }                                        // an unoccupied half (see below)
  | { dir: "row" | "col"; ratio: number; a: TileNode; b: TileNode };
```

Run-1 amendment (implementation finding): the tree carries an `empty` leaf so that
edge-snapping the FIRST window yields `[window | empty]` - the window takes exactly half the
region, which is the brief's gesture - and the next opposite-edge snap fills the empty slot.
Dividers render only between real windows; a tree left with no real windows collapses to null.

Per workspace: `windows: WindowState[]` (array order = z-order, last = front; tiled render
below floating) + `tiling: TileNode | null`. Rects are clamped/shifted into the desktop
bounds on restore (viewport may have changed between sessions).

### 4.2 Arrangement mechanics (custom, minimal)

Tiling via edge snapping is the load-bearing arrangement; freeform floating is secondary.
The binary split tree is the smallest model that expresses both required gestures plus
divider resize; a flat half/half model would be rework the moment a third window lands.

- Drag: pointer events + `setPointerCapture` on the title bar; CSS transform during drag;
  commit on pointerup. While any drag/resize is active, a transparent shield covers iframe
  windows (iframes swallow pointer events; without the shield, dragging over an artifact
  window wedges).
- Edge snap: pointer within ~24 px of the desktop's left/right edge shows a half-region
  preview; drop inserts the window into the tile tree as that half.
- Drop-onto-window split: while dragging over another window, the hovered quadrant picks the
  split direction (left/right = `row`, top/bottom = `col`) with a preview; drop replaces
  that leaf with a split node (ratio 0.5).
- Resize: floating windows get right/bottom/corner handles clamped to `minSize`; tiled
  regions resize by dragging the divider between them (ratio clamped 0.2-0.8).
- Focus raises to front; minimize sends to the dock (chip; click restores); closing a tiled
  leaf collapses its parent split. Window chrome: title, minimize, close, and the surface's
  `...` menu.
- Keyboard baseline: chrome buttons and menu are keyboard-reachable; Escape closes
  menus/previews. Full keyboard window management (move/resize/cycle shortcuts) is out of
  scope for run 1 and recorded here deliberately.
- Tree operations (`insertHalf`, `splitLeaf`, `removeLeaf`, `setRatio`, region computation)
  are pure functions in `web/lib/os/tiling.ts` with unit tests. Pointer handling is plain
  DOM events; dnd-kit stays for sortable lists (it does not model free window drag).

### 4.3 Workspaces + persistence (decision)

A workspace is a name + desktop/pinned item ids + the saved window layout. Nothing more (no
per-workspace scoping of skills, artifacts, or automations - explicitly out of scope).

```ts
export type DesktopItemRef =
  | { kind: "surface"; id: string }        // registry id
  | { kind: "artifact"; id: string };      // artifact id

export interface Workspace {
  id: string;
  name: string;                            // PT-PT default "Ecrã 1", "Ecrã 2", ...
  desktopItems: DesktopItemRef[];
  pinnedIds: DesktopItemRef[];             // dock pins, per workspace
  windows: WindowState[];
  tiling: TileNode | null;
}
```

Store: `web/stores/os.ts`, zustand + `persist`, key `ekoa_os`, `version: 1`, localStorage -
the established pattern (`stores/i18n.ts` simple case; `stores/orchestration.ts` versioned
partialize precedent). Persisted: `workspaces`, `activeWorkspaceId`, chat-dock prefs
(`{ collapsed, width }` per mode - see 5). Not persisted: drag-transient state, open menus,
previews. Criteria: reuse existing state patterns, no new persistence infrastructure.
Server-side cross-device layout sync (a natural `PATCH /settings/me` passthrough extension)
is deliberately deferred; localStorage matches the beta's blast radius.

Desktop membership semantics (run 1): the first OS-mode entry seeds the default workspace
with the surface icons and the user's current artifacts; artifacts created later auto-add to
the ACTIVE workspace; deleted artifacts are filtered on render; "Remover do ecrã" removes
explicitly. Workspace switcher supports create/switch/rename/delete (delete confirms;
via ActionMenu - the switcher dogfoods the actions model).

### 4.4 Narrow viewports

Shell-level `useIsMobile` decides the topology (this is the legitimate use): below 768 px
there are no windows and no chrome - open surfaces render one at a time, full-screen, with a
bottom switcher (open surfaces + dock items). Same manifests, same surfaces, same actions
(`...` + long-press). Draggable windows never exist on mobile. The tile tree is simply not
rendered in this topology; it is preserved in the store so a desktop revisit restores it.

### 4.5 Shell composition

`web/app/(os)/os/` route group (own `layout.tsx`: no sidebar/header; provides the `h-dvh`
bounded root; mounts the same app-blocking overlays as classic where applicable). Auth: the
guard in `(dashboard)/layout.tsx:56-106` is extracted to `web/hooks/useRequireAuth.ts` and
used by both layouts (no behavior change; removes divergence risk). Gate:
`NEXT_PUBLIC_OS_MODE=1` enables the sidebar doorway and the route; disabled, `/os` redirects
to `/chat`. Criteria for the env flag: matches the established `NEXT_PUBLIC_*` precedent
(vertical, bridge URLs), zero server work, per-environment control; a per-user server toggle
is deferred until the beta widens.

Shell contents: desktop background (Atrium tokens), desktop icons (surfaces + artifacts,
each with the always-visible `...`), dock (pinned items + open/minimized windows), workspace
switcher, and the docked chat panel (5). Classic sidebar gains the doorway entry "Modo OS"
with a "Beta" badge - `NavItem` is extended with `badgeLabel?` and `treatment?: "doorway"`,
rendered visually distinct (separated group, accent treatment within the teal/ink/amber
system, spring animation behind `prefers-reduced-motion`).

---

## 5. Chat: extraction, not conversion

The chat side panel's current tab system does not carry over into OS mode; chat becomes the
always-present docked panel, and the tabs become things the shell can express. The /chat
route itself stays classic in run 1 (its "hard" audit rating is absorbed by extraction).

- Headless runtime: `web/components/chat/chat-runtime.tsx` + `useChatRuntime()`. The chat
  page's controller logic moves VERBATIM: send-router (page.tsx:1246-1325), `handleChatSend`
  + run streams (:929-1189), `useAgentExecution` wiring, the four notification subscriptions
  (build_intent :753-797, chat_answer :803-827, integration_build_intent :832-852,
  integration_ready :863-895), cancel/retry/edit, one-shot `initializeBuilderSession`.
  Mounted once per shell ((dashboard) layout and (os) layout). Handlers must not navigate
  outside /chat (store update + toast instead). Side effects this buys: SSE streams survive
  page navigation; delegations arrive on any page - improvements, not behavior changes.
- The route wrapper (`chat/[[...sessionId]]/page.tsx`) keeps ALL URL coupling: URL<->store
  sync (:316-338, :465-483 - `router.replace`/`history.replaceState` fire only here),
  `?continue/?featured/?reinterview` handlers, and the existing 3-column composition. The
  `motion.main` key trick is preserved.
- Store singletons (`activeSessionId`, `isExecuting`, `sidePanelState`, `sidePanelTab`,
  `pendingAttachments`, `pendingDelegation`) stay global in run 1: there is exactly one chat
  mount at a time and windows host artifacts, not chat. `ekoa_orchestration` stays at
  version 4 - no migration. De-globalizing for multi-chat-window is batch-two work.
- Classic global panel: `web/components/chat/global-chat-dock.tsx`, a flex sibling of
  `motion.main` under the header (the layout's main area becomes a row of [page, dock]).
  Collapsed by default to a slim always-visible right-edge tab; expands to a resizable panel
  (left-edge drag handle, min 320 / max 560 px, width persisted). Hidden entirely on /chat
  (the page IS the chat) - the single-instance rule, which also removes the
  `initializeBuilderSession`/`loadSessions` double-mount race. Contents: conversation
  (ChatPanel views) + compact session picker + "Abrir na página de chat".
- OS docked panel: same runtime and views, docked right, open by default, resizable, beside
  any window arrangement. The former side-panel tabs become: Preview -> a real
  `artifact-app` WINDOW ("Abrir em janela" from the panel and from completed-build
  messages); Files + Output -> collapsible sections of the docked panel under the
  conversation (same FileTreeView/OutputPanel views bound to the active session); Versions
  -> lives with the artifact (VersionsPanel in the artifacts surface detail, where it
  already renders); the `integrate` state replaces the sections while active (same
  short-circuit the side panel does today). Nothing reachable today becomes unreachable;
  the preview - the space-hungry tab - stops being cramped by getting a window.

---

## 6. Accepted run-1 compromises and risks

### 6.1 Compromises (deliberate, documented)

1. Body-portaled `Dialog`/`ConfirmDialog`/`Toaster` stay viewport-level. They are modal or
   transient by design; per-window scoping is real rework with no run-1 payoff. Revisit only
   if multi-window modal collisions become real in batch two.
2. Store singletons stay global (5). One docked chat instance is a run-1 invariant.
3. Layout persistence is localStorage-only; no cross-device sync.
4. Keyboard window management is a baseline (menus/chrome reachable), not a feature.
5. OS-only strings ship as raw PT-PT constants in `web/lib/os/strings.ts` (NAV_ITEMS raw-label
   precedent); classic-visible strings (panel, artifact menu) go into the locale files (en/pt
   parity is enforced at compile time by the shared `Translations` type in
   `web/locales/types.ts`; `web/e2e/coherence-locale.spec.ts` asserts the PT-PT copy
   conventions). Migration of OS strings to locales happens when the beta graduates.

### 6.2 Risks (verified against the code, carried into implementation)

1. The shell-root container rule (2.3.4) is the load-bearing parity mechanism: the classic
   root container must stay viewport-wide, and no intermediate element may declare its own
   container above a classic surface mount. Verified with a real-browser resize e2e during
   the artifacts conversion, before batch two. (An earlier draft relied on un-containered
   size queries falling back to the viewport; the spec does not do that - without an
   ancestor container the styles never apply. Caught by the pre-review verification pass.)
2. Iframes swallow pointer events - the drag shield (4.2) is mandatory or exit scenario 1
   (drag beside an artifact window) wedges.
3. The chat page refactor is the riskiest diff in the run (1925-line file). Mitigation:
   move logic verbatim, land the runtime split as its own commit with zero UI change, keep
   the chat e2e suite green before any panel work starts.
4. The `(dashboard)/layout.tsx` flex change (main row gains the dock) can disturb the page
   scroll chain - locked by the classic regression spec before building on it.
5. Notification handlers moving into an always-mounted runtime must not navigate or steal
   focus from non-chat pages.
6. New e2e specs fail CI's `gate:ledger` unless registered in the suite ledger.

### 6.3 Cost surprises vs the brief

None material. The audit found the page fleet cheaper than assumed (1.3); the two systemic
costs the brief did not name explicitly are the shared `Dialog` viewport coupling (absorbed
as compromise 6.1.1) and the iframe pointer-event shield (absorbed as a window-manager
requirement). Nothing in the audit makes the contract more expensive than briefed.

---

## 7. Batch-two conversion checklist (derived from the artifacts conversion)

For each page, in order:

1. Extract the page content into `web/components/<area>/<name>-surface.tsx` fulfilling 2.1;
   the classic `page.tsx` becomes a thin mount of the same component. PageShell may stay
   inside the surface.
2. Rename width-driven `sm:/md:/lg:/xl:` classes to `@bp-*` container variants (2.3). Leave
   genuinely viewport-semantic prefixes.
3. Replace hand-rolled dropdowns (and their `fixed inset-0` backdrops) with `ActionMenu`.
4. Remove any `useIsMobile` usage from the surface (shell topology owns that decision).
5. Write the co-located manifest (`<name>.surface.ts`) and add its registry line; define
   `ActionDef`s for the surface and its item types against existing endpoints.
6. Verify classic parity (resize e2e: breakpoints fire at the same viewport widths as
   before) and window behavior at `minSize`.
7. Register any new spec in the suite ledger; update diagrams/docs if structure changed
   (FIXED-12).
