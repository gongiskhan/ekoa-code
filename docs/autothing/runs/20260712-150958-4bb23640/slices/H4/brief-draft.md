# H4 delegation brief - DRAFT (finalize after H3 lands; it references H3's edit-mode entry)

Slice H4 (mixed, size 5, dep H1; conceptually feeds H3's edit mode). Request-changes queue for
USERS + the refused-build feed. GREENFIELD (map §6: no existing queue) - built on the Store<T> +
notifications-SSE + registo-org-admin-read patterns. Spec: BRIEF.md Phase 9d.

## WHAT H4 BUILDS
1. **Shared contract + store.** `ChangeRequest` (id, appId, orgId, requesterUserId, requesterName,
   route, screenState?, text, status: 'open'|'converted'|'dismissed', createdAt). New
   `changeRequests = new Store<ChangeRequestDoc>('change_requests')` (stores.ts). Additive shared
   schemas + a descriptor map + contract tests.
2. **File a request (user, from inside an app).** A panel "Pedir alteracao" button shown to
   NON-admins (admin===false from H2, i.e. the users who can't edit) - captures the current route
   + screen state from the C3 registry/currentRoute (already in the panel) so the request arrives
   contextualised. POST it to a platform route scoped to the served app (X-Ekoa-App-Id resolves the
   app + owner org; the requester is the authenticated platform user IF a token is present, else the
   request is anonymous-visitor-tagged - decide + document; likely require a logged-in platform user
   to file, since the queue is org-internal). Lands status:'open' in the owner org's queue + fires a
   notifications-SSE event to the org's admins.
3. **The refused-build feed (from H1).** H1's build/edit refusals carry the FORBIDDEN envelope +
   details.capability (the machine hook). When a user's chat build request is refused (canBuildApps)
   or an edit is refused, the client converts it into a pre-drafted ChangeRequest to the org-admin -
   never a dead end (BRIEF 9a). Wire this: the refused-build path (agents/chat markers or the client)
   drafts a ChangeRequest with the original description. Coordinate with the chat plane; keep it a
   thin addition (the refusal already carries the capability + the description).
4. **Org-admin queue.** GET /api/change-requests - org-admin reads own org, super-admin across orgs
   (mirror registo.ts's requireRole('org-admin','super-admin') + org scoping). A web dashboard
   surface (web/app/(dashboard)/... - like registo) listing open requests with their route/context.
   Each request is ONE CLICK from becoming a patch run: "converter" pre-fills an H3 edit-mode intent
   (the artifactId + the request text) and marks the ChangeRequest converted. (If H3's edit entry is
   a panel flow, the convert action deep-links to the app in edit mode with the text prefilled, OR
   starts the patch run directly from the dashboard via POST /jobs - decide with H3's shape.)

## CONSTRAINTS
No new capability logic (H1 owns gating; filing a request needs NO special capability - any user
may ask; the org-admin queue read is org-admin-gated). PT-PT, no emoji, no em/en-dash. The
served-app POST /api/app-assistant plane stays visitor-blind (the request-file route is its own
thin endpoint or the platform API). Every non-2xx is the shared error envelope. New endpoint =>
new contract test same slice.

## TESTS
Contract (ChangeRequest CRUD shapes + the queue read + the refused-build draft), integration
(user files -> lands in the owner-org queue; org-admin reads own org only; cross-org isolation:
an org-admin never sees another org's requests; convert -> status flips + an edit intent is
produced), panel (the request button shows for admin===false, captures route/screen). Live probe
(lead): file a request via curl, read it as the org-admin, convert it.

## RESERVED PATHS (reserve at delegation)
shared/src/*.ts (new change-request contract + index), api/src/data/stores.ts, a new
api/src/routes/change-requests.ts (+ server.ts mount), api/src/apps/app-assistant-route.ts or a new
thin file-request route, api/assets/panel-runtime/src/AssistantPanel.jsx (the request button),
web/app/(dashboard)/... (the queue view) + web locales, api/tests/contract/**,
api/tests/**/change-request*.test.ts, docs/diagrams/**, slices/H4/**.

FINALIZATION CHECKLIST (lead, at delegation): read H3 impl-notes -> confirm the edit-mode entry
shape so "convert" targets it exactly (deep-link vs direct POST /jobs); confirm whether filing
requires a logged-in platform user or allows anonymous-visitor (recommend: require login - the queue
is org-internal, and an anonymous served-app visitor has no platform identity); confirm the web
dashboard nav slot for the queue.

## Web nav slot (lead pre-check, confirmed)
web/components/sidebar.tsx already gates items with `adminOnly` (line 96: `hasHydrated && isAdmin`,
where `isAdmin = super-admin || org-admin`). The H4 queue is a NEW `adminOnly` sidebar item pointing
at a new dashboard page (e.g. `/pedidos` or `/change-requests`), mirroring the registo page
(web/app/(dashboard)/registo/page.tsx over GET /api/v1/registo). The queue read reuses the exact
org-admin/super-admin scoping registo.ts uses. Locales: add the nav label + page copy to
web/locales/{pt,en}.ts (PT-PT primary).
