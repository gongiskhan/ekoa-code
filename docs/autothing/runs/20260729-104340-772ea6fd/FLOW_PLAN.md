# FLOW_PLAN — offices + users into settings tabs
**runId:** 20260729-104340-772ea6fd  
**profile:** feature  
**turnCap:** 300  
**brief:** Move /orgs and /users pages under /settings with a responsive tab bar (mobile: select dropdown, desktop: horizontal tabs)

## Context

The settings area already exists at `/settings/layout.tsx` with two tabs:
- "Plataforma" (`/settings/platform`) — all users
- "Pedidos" (`/settings/pedidos`) — adminOnly

The `Tabs` component at `web/components/ui/tabs.tsx` handles desktop tab rendering.
The settings layout already does role-based tab filtering (adminOnly) via `isAdmin`.

## Goal

Add "Escritórios" (offices, super-admin only) and "Utilizadores" (users, org-admin + super-admin) as settings tabs.  
Responsive: on mobile (< sm) the tab bar becomes a `<select>` dropdown.  
Update nav to point `/orgs` → `/settings/offices` and `/users` → `/settings/users`.

## Assumptions

- The mobile breakpoint for the select is `sm` (640px), consistent with the rest of the UI.
- The `<select>` on mobile uses native styling but gets a minimal border + bg to match the surface.
- Old URLs `/orgs` and `/users` redirect to the new settings routes (same pattern as `/pedidos`).
- The "Utilizadores" tab label uses PT-PT consistent with the rest of the app.
- superAdminOnly tabs are hidden from org-admin users (only super-admin sees them).

## Slice table

| id | title | kind | files | acceptance |
|----|-------|------|-------|------------|
| S1 | settings-pages-and-tabs | ui | `web/app/(dashboard)/settings/layout.tsx`, `web/app/(dashboard)/settings/offices/page.tsx` (new), `web/app/(dashboard)/settings/users/page.tsx` (new) | `/settings/offices` renders orgs content for super-admin; `/settings/users` renders users content for admin; settings layout shows responsive tab bar with all 4 tabs (role-filtered); mobile shows `<select>`, desktop shows `<Tabs>` |
| S2 | nav-cleanup | ui | `web/lib/navigation.ts`, `web/app/(dashboard)/orgs/page.tsx`, `web/app/(dashboard)/users/page.tsx` | Nav items for Escritórios and Utilizadores point to the new settings routes; old `/orgs` and `/users` URLs redirect correctly; settings nav item lights up when on any `/settings/*` route |

## Verification

- `pnpm typecheck` exits 0
- `pnpm lint` exits 0
- Navigate to `/settings/platform` — tabs show Plataforma, Pedidos (admin), Escritórios (super-admin), Utilizadores (admin+)
- Navigate to `/settings/offices` — tab bar active on Escritórios, office management content renders
- Navigate to `/settings/users` — tab bar active on Utilizadores, user management content renders
- Resize to < 640px — tab bar replaced by `<select>` dropdown
- Navigate to `/orgs` — redirects to `/settings/offices`
- Navigate to `/users` — redirects to `/settings/users`
- Sidebar nav items for Escritórios and Utilizadores link to new settings routes

## Critical files

- `web/app/(dashboard)/settings/layout.tsx` — add tabs + responsive select
- `web/app/(dashboard)/orgs/page.tsx` — existing page to copy + convert to redirect
- `web/app/(dashboard)/users/page.tsx` — existing page to copy + convert to redirect
- `web/lib/navigation.ts` — update nav hrefs
- `web/components/ui/tabs.tsx` — read-only reference for TabItem shape
