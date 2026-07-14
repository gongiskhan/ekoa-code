# H5 adversarial security review - the ASSERTION layer (BRIEF Phase 10)

Reviewer: fresh-context adversarial security reviewer (no prior stake). Commit `3ad6fb3`.
Method: read the full diff + brief + impl-notes + H1-H4 wiring; read the PRODUCTION code each
assertion depends on (app-assistant.ts, grounding.ts, index-store.ts, app-sso.ts,
app-sso-sessions.ts, served-data.ts, collections-engine.ts, the four gated routes); ran
`vitest run tests/security tests/auth` (52 passed), `tsc -p tsconfig.test.json` (0); and tried to
BREAK the grep gate by planting real + evasion violations.

Bottom line: the assertions genuinely prove what H1-H4 built. Every attack I tried against the
assertions either fails safely or lands as a Low. No High/Medium defect in H5. All eight Phase-10
assertions are present and none is tautological. The one genuinely security-relevant gap the block
touches (an app-declarable `access.write` that does nothing) is accurately verified, correctly
scoped OUT of the platform-authz H-block, and ledgered `medium` with a concrete close plan - it is
not being waved away.

## What I verified SOUND (rebuttals to the obvious attacks)

**1. Grep gates are NOT a tautology - I broke them and they caught it.** Planted
`export const role = 'builder'; // PERMISSIVE-STUB` in a non-allowlisted `api/src/__h5_probe__.ts`:
BOTH gates failed (orphan-builder + permissive-stub), naming the file+line; removed it, both green
again. The matcher (`matchingLines`) is the SAME exported function the tree scans use, and the
in-suite self-test drives it against planted violations AND the exact identifiers it must not match
(`integrationBuilder`, `builderSessionId`, `allowBuilderAutomations`, `"Builder"` label). It scans
`api/src` + `shared/src` (stub) and `api/src` + `shared/src` + `web/{app,components,stores}`
(builder). I independently confirmed the only `'builder'` literals in those trees are the three
allowlisted survivors (`jwt.ts` shim, `users-service.ts` migrateBuilderRole, `orchestration.ts`
session-kind) - no hidden orphan. The `allowBuilderAutomations` org-setting KEY is correctly not
matched (unquoted identifier). The allowlist is file-level but each entry is a real legacy-handling
file, and a stale-entry sanity check prunes dead allowlist rows.

**2. Cross-org assistant isolation is REAL, over the real seam, and non-trivial.** `runAppAssistant`
(app-assistant.ts:267) grounds strictly under `input.owner.orgId` and never reads any org from the
visitor `context` - so the "steering ignored" property is structural, not defended. The test wires
the REAL `buildGroundingBlock` + a REAL better-sqlite3 FTS partition. The load-bearing assertion is
non-trivial: `search()` (index-store.ts:254) filters `orgId IN (callerOrg, _shared)`, so when org B
asks for org A's distinctive token, a *global* FTS search WOULD return org A's `kb-a` (it contains
that token) - the partition filter is the only reason it does not, and the test asserts
`not.toContain('kb-a')`. The 4th case seeds an `attacker-org` row that MATCHES the query token and
proves the org-A app still never retrieves it. `_shared` is intentionally left empty so there is no
shared-corpus confound. This genuinely proves partition isolation, not "the other org's doc happened
not to match."

**3. Capability matrix is complete + fail-closed; the wiring inventory reads real source.** The
12-cell grid + the H5-added unknown/stale-role cell (`'builder'`/`'root'`/`''` -> nothing) pin the
`?? false` branch. The wiring `it.each` reads actual `api/src/routes/*` source; I confirmed every
mapped gate exists (`jobs.ts:51/61`, `chat.ts:41`, `artifacts.ts:82/101/113/162`,
`app-assistant-route.ts:97`), so DELETING a gate breaks the regex and fails the suite - not a
re-assert of the matrix. Its one weakness (a textual grep would pass if a gate's RESULT were
ignored) is covered by the cross-referenced `jobs-capability`/`artifacts-capability` suites, which I
confirmed are BEHAVIORAL: real `jobsRouter` on a live express server, `403 + executor never called`
for a user, `202 + executor called` for org-admin, plus IDOR/cross-org uniform-404s.

**4. Destructive-action authz is proven server-side over the real router.** Real `appSsoRouter` +
real mongo-mem: `set-password` (writes a bcrypt hash to the app's data row) is `401` without a
session and with a wrong-app session, `200` only same-app, and each path re-verifies the row
was/was-not actually mutated with NO confirmation param in the request. The m365 proxy is gated the
same way. The property "a mutating served-app op is authorized by the app-sso identity, not client
confirmation" is genuinely established.

**5. The "general app-data plane is app-id-scoped, not app-sso-gated" finding is ACCURATE and safe
under its stated invariant.** I read `served-data.ts`: the `/api/app-data/*` per-app plane has NO
platform JWT and NO app-sso session - admission is `X-Ekoa-App-Id` charset scope + the owner's
activation gate (`admitOwner`, fail-closed on a missing activation record). App-id scoping does NOT
prevent a cross-namespace write (any anonymous caller can address any app's namespace), but that is
not an escalation: every app's data plane is *already* anonymous-writable by design, so re-pointing
the header grants nothing you didn't already have. The safety rests entirely on the documented
invariant "this plane must never hold confidential / per-user-private data," with the privileged ops
(password, per-user Graph tokens) living on the session-gated app-sso plane. H5 asserting the app-sso
boundary and DOCUMENTING the app-data reality (rather than fabricating an app-sso test on a plane
that has none) is exactly what the brief asked for when a premise doesn't hold.

**6. Phase-10 completeness: all eight present, none skipped.** capability matrix (D1); no-orphan
builder grep (D2); no-permissive-stub grep (D2); edit journey (D5); user-cannot-edit (D5);
destructive-action server authz (D4 - correctly re-targeted to the real app-sso boundary + finding);
cross-org knowledge isolation (D3); request-changes journey (D5).

## Findings (all LOW - none blocks the block)

**L1 - grep BUILDER_RE misses backtick literals (verified evasion).** `/['"]builder['"]/` matches
single/double quotes only. I planted `export const r = \`builder\`;` in a non-allowlisted file: it
slipped past the gate silently. Narrow (a `Role` z.enum member must be a string literal; role
comparisons are conventionally quoted) and fully mitigated by the fail-closed matrix cell (a
resurrected `builder` role grants nothing). Suggest widening the class to include backticks.

**L2 - file-level allowlist.** A NEW `'builder'` literal added *inside* an already-allowlisted file
(`jwt.ts`, `users-service.ts`, `orchestration.ts`) is not caught. Those are precisely the legacy
files, so low risk; line/context allowlisting would be tighter.

**L3 - destructive-action wrong-app case tests cookie-NAME scoping, not the `findValidAppSession`
appId binding it claims.** The app2 cookie is presented under app2's NAME, so
`readNamedCookie(req, 'ekoa_app_sso_app1')` returns undefined and `findValidAppSession(token,'app1')`
is never reached - the 401 comes from cookie-name isolation. The security PROPERTY (a different-app
session can't mutate app1, row untouched) is genuinely proven; the inline comment just overstates
which layer trips. A defense-in-depth variant should also present app2's token UNDER app1's cookie
name to exercise the `found.appId !== appId` check directly (cookie names are attacker-controllable).
`findValidAppSession` (app-sso-sessions.ts:81) does contain that check - it is simply not
independently exercised.

**L4 - committed impl-notes stale vs the final commit.** impl-notes.md states "NO
api/src/shared/src/web production file touched" and lists observations (1)/(3) as "not touched," but
the same commit folds in `shared/src/capabilities.ts` (comment-only) + `assistant-billing.e2e.mjs`
fixes (lead folded them post-notes; disclosed in the commit message). Comment-only, no logic/auth
impact - but the impl-notes now contradicts its own commit.

**L5 - journey-driver nits.** (a) `edit-journey` user-cannot-edit accepts `403 || 404`; only the 403
path pins `details.capability='canEditApps'`, so a 404 would pass without confirming the capability
gate specifically. (b) `request-changes-journey.startBuild` lacks the `MAX_BUILDS` hard cap that
`edit-journey` enforces (relies on being called exactly twice). (c) request-changes "org-admin sees
it" is read as the seeded super-admin; org-admin-own-org scoping is delegated to the deterministic
`change-requests.test.ts` (documented in the driver header). None affects a green run's validity -
the assertions throw + `exit(1)` on failure (no green-by-default).

## On the two flagged observations

Both are correctly OUT of the H block. The collection-rule `access:{read,write:'session'|'server'}`
is genuinely unenforced - I confirmed `accessLevel` (collections-engine.ts:39-47) is parsed into the
manifest schema and NOTHING in `api/src` consults it on a write; every served-data write is
app-id-scoped. That is a real medium data-plane latent gap (an app author's declared write control
does nothing), it is ledgered `medium` in `findings.md` with a concrete close plan, and it is the
correct downstream owner's concern, not the platform-authz H-block. H5 (an assert-only slice) rightly
did not fix it. Not waved away.

VERDICT: APPROVE
