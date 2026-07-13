# H3 review verdict - served-app EDIT MODE (admins only), commit 28a6e12

Fresh-context adversarial SECURITY + UX review. I re-ran the gates myself (did not trust
reported exit codes) and traced the server-side authority the front-end leans on.

## Independently verified (not trusting the impl notes)
- `cd api && npx vitest run tests/apps/edit-mode.test.ts tests/apps/assistant-panel.test.ts` -> 2 files, **40 passed**.
- `npx tsc -p tsconfig.json` -> 0; `npx tsc -p tsconfig.test.json` -> 0; `npx eslint` the two .ts test files -> 0.
- `node assets/panel-runtime/build.mjs` -> built (240389 bytes).
- grep for en/em dash across edit-mode.js + AssistantPanel.jsx + .css -> none. Emoji -> none (tests pin it).
- Diagram `04-agent-job.excalidraw` -> exactly one added text element (`h3_edit_mode`), valid JSON.

## The security core - VERIFIED SOUND (rebuttals)

**1. Detect-then-ask is binding.** Exactly ONE `setEditMode(true)` in the panel, inside
`openEditMode` (`AssistantPanel.jsx:585-589`), wired only to explicit click handlers - the
switch (`:775`, `onClick={editMode ? closeEditMode : openEditMode}`) and the discovery CTA
(`:795`). `editMode` starts `false` (`:279`). The whoami DETECTION effect (`:321-356`) touches
`setAdmin` only - it references neither `setEditMode` nor `openEditMode`. No effect/auto-trigger
enters edit mode. Being an admin only SHOWS the switch. Correct.

**2. The client gate is cosmetic; the SERVER re-gates - confirmed against H1, not asserted.**
- `POST /api/v1/jobs` with `artifactId` requires `can(actor,'canEditApps')` AND
  `loadWritable(actor, artifactId).verdict === 'ok'`, else a **uniform 404**
  (`api/src/routes/jobs.ts:44-64`, H1 commits e2c165e + 49dc5f6). The 404 collapse is deliberate
  (no existence oracle).
- `POST /api/v1/artifacts/:id/versions/:sha/restore` is `writable()`-gated AND
  `denyAppEdit` (canEditApps) gated (`api/src/routes/artifacts.ts:231-234`).
- A non-admin who force-enables the UI in devtools drives NOTHING privileged: with a plain-user
  or cross-org token the jobs POST returns FORBIDDEN/404 and the restore is refused; `runEditPatch`
  maps that to `{outcome:'degraded'}` and a calm note. A cross-origin/sandboxed visitor cannot read
  `ekoa_token` at all (whoami then returns `admin:false`, so no switch). The property holds because
  H1 is real - I read the gate, it is there.

**3. Token handling is defensive.** `readPlatformToken` is try/catch -> `null`
(`:85-93`). The token is sent ONLY to same-origin `/api/v1/*` as a `Bearer` header, and as `?token=`
on the same-origin SSE URL (`jobEventsUrl`, the established CONV-1 pattern - EventSource can't set
headers). Never logged, never sent cross-origin. No new leak surface over H2.

**4. SSE parsing cannot crash or be trivially wedged.** `parseSseBuffer` splits on `\n\n`, keeps the
trailing incomplete frame as `rest`, skips a garbled frame in try/catch - never throws (unit-proven,
incl. split-across-chunks). `streamJobEvents` resolves on the terminal `complete`/`error` and
soft-closes on stream end. Sha/progress strings render as React text children (escaped) - no XSS.

**5. Visitor-blindness preserved.** `confirmEdit` references neither `ENDPOINT` nor
`/api/app-assistant` (pinned + read). The `POST /api/app-assistant` path in `send()` is
byte-unchanged. Edit mode uses only the `/api/v1/*` plane.

**6. Rollback targets the PRE-run head (happy path).** `runEditPatch` reads versions BEFORE the
POST /jobs (order asserted), `preRunSha = items[0].sha` at that read; `rollbackEdit` passes
`editPreview.preRunSha` to `rollbackToVersion` (`:678,:685`). The preview shows both shas before the
admin acts. Correct.

## Findings

### Medium - the 'running' phase has no timeout / no abort / no cancel, and a late run-result can flip the phase after the admin left it
`confirmEdit` calls `runEditPatch` with **no `signal`** (`AssistantPanel.jsx:638-647`), so
`streamJobEvents` awaits `reader.read()` with no client-side timeout. The sibling visitor path in the
SAME FILE deliberately guards exactly this hang class with `FETCH_TIMEOUT_MS` + `AbortController`
(`:53-55,:492-493`, added for codex-d2). The running phase renders only a spinner - no Cancel button.
Worse, toggling the switch off mid-run (`closeEditMode`) does NOT abort the in-flight `runEditPatch`;
when it later resolves it still calls `setEditPreview(...)` + `setEditPhase('preview')`. Scenario:
start an edit -> toggle edit off mid-run -> toggle edit back on -> the old run resolves -> the panel
shows a `preview` with STALE shas and a `Reverter` that would forward-restore to a stale `preRunSha`.
It is recoverable (own app, server-gated, shas shown, versions retained) and contrived, so not a
security hole - but it is a real robustness/correctness gap the established pattern already solves.
Recommend: thread an `AbortController` tied to editMode-off/unmount into `runEditPatch`, and/or a
run-generation guard that ignores a resolve after the switch was toggled off; add a Cancel affordance
in the running phase. Non-blocking for the security slice, worth a fast-follow.

### Low - degrade-message mapping is misleading in edge cases
`confirmEdit`/`rollbackEdit` use `degradeMessage(token ? 0 : 401)` when a precondition other than the
token is missing (`:631,:680`). If `preRunSha` is undefined (a truly fresh repo with no commits) the
preview still offers `Reverter` (`newHeadSha !== undefined preRunSha` is true, `:858`); clicking it
hits `!sha` and shows a generic "try again later" rather than "nothing to revert to". And a
missing-token branch says "A sua sessão expirou" when the real cause is no readable token. Both are
near-unreachable in the real switch flow (built apps always have commits; a no-token viewer never
sees the switch), so low. Consider a distinct "no previous version to restore" line.

### Low - the switch's accessible name is only its on/off state
`role="switch"` + `aria-checked` are correct, but the button's accessible name resolves to the
visible "Ativado"/"Desativado" span; the adjacent "Modo de edição" label
(`ekoa-assistant-adminbar-label`) is not associated. A screen-reader user hears "off, switch" without
the "edit mode" context. Add `aria-label="Modo de edição"` or `aria-labelledby` linking the label.

### Low - pre-run head TOCTOU (narrow)
The pre-run head is read before the build. The one-follow-up-per-artifact guard blocks a concurrent
follow-up BUILD, but NOT a concurrent dashboard file-save / bundle-update / restore on the same app in
the window between the versions read and the build start. If HEAD moves there, `preRunSha` is not the
true build parent and a later rollback could discard the intervening commit. Requires the same admin
editing one app from two surfaces at once - narrow; note only.

### Low - the panel->rollback sha wiring is correct but not test-pinned
`edit-mode.test.ts` proves `runEditPatch` derives `preRunSha` pre-run and that `rollbackToVersion`
sends whatever sha it is given; `assistant-panel.test.ts` only checks `rollbackToVersion` appears near
`rollbackEdit`. Nothing pins that `rollbackEdit` passes `editPreview.preRunSha` (not `newHeadSha`).
The source is correct; a one-line assertion would lock it.

## Verdict rationale
Every acceptance criterion of the slice - detect-then-ask binding, server-authoritative gating
(client gate cosmetic), visitor-blindness, defensive token/SSE handling, pre-run rollback target,
graceful 401/403/404 degradation, a visually distinct admin-only edit zone, PT-PT/no-emoji/no-dash -
is met and independently verified. The findings are quality/robustness/UX improvements, none a
security defect; the Medium is a fast-follow the sibling path already shows the shape of.

VERDICT: APPROVE
