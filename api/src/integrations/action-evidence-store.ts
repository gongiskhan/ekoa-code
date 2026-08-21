/**
 * integrations/action-evidence-store.ts - the ONE LIVE PROOF that an action actually ran (slice S1).
 *
 * ── WHAT THIS IS, AND WHY IT IS NOT `integration_captured_calls` ──────────────────────────────
 *
 * P2.0 already built a collection for evidence, and this is deliberately not it. The two answer
 * different questions and have opposite lifecycles:
 *
 *   `integration_captured_calls`   - the RAW network trace of a discovery pass. Hundreds of rows
 *                                    per pass, append-only, keyed by (…, captureId, seq), MACHINE
 *                                    facing: it exists so `automation/recipe.ts` can distil a
 *                                    replayable recipe out of it, and `discardCapture` throws the
 *                                    whole pile away the moment the recipe is compiled. Nobody
 *                                    reads it after that; nothing renders it.
 *
 *   `integration_action_evidence`  - THIS. Exactly ONE row per (org, integration, action), shaped
 *                                    for a HUMAN reader, superseded wholesale by each validated run.
 *                                    It is the answer to "what did this action do the last time it
 *                                    worked", which is the question the detail page will ask and the
 *                                    question a promotion to `trusted` now has to be able to answer.
 *
 * ── AND ON THIS BRANCH NOBODY READS IT. SAID HERE, WHERE THE CLAIM IS MADE (round nine) ───────
 *
 * "Human facing" is a statement about the SHAPE of this row, not about a surface that exists. The
 * caveat was recorded in two places - `listForIntegration`'s docblock and `EVIDENCE_RETENTION_DAYS`'s
 * - and in NEITHER of the places the claim is actually made, which is how it kept reading as a
 * description of the running product. The facts on this branch:
 *
 *   - `listForIntegration` has NO production caller. The detail page that would call it is S2/S3 and
 *     lives on a different branch.
 *   - `getEvidence` DOES have one, and it is a MACHINE read: `trustAuthoredAction` fetches the row
 *     and hands it straight to `promoteToTrusted`, which compares `outcome` and `shape` and returns a
 *     verdict. No byte of `evidence` reaches a response.
 *   - the person granting `trusted` sends `POST …/actions/:name/trust` with a `shape` STRING they
 *     echo back. They are shown the action, not the sample of it.
 *
 * So the excerpt caps, the truncation flags and the step pointers below are built for a reader who
 * has not mounted yet. That is a deliberate order - a durable row is easier to shape right before it
 * is rendered than after - but until the page lands, every "what a person sees" sentence in this file
 * describes an intended surface. Delete these paragraphs when it mounts.
 *
 * Both collections exist because "the trace a compiler consumes" and "the sample a person is shown"
 * are not the same artefact: the first is unbounded, transient and discarded on success, the second
 * is bounded, durable and only ever replaced. Collapsing them would mean either keeping hundreds of
 * raw rows alive forever to render one sample, or deleting the sample the moment a recipe compiled.
 *
 * ── WHY THIS IS A COLLECTION AND NOT A FIELD ON THE DEFINITION ────────────────────────────────
 *
 * Two independent reasons, and either alone is decisive:
 *
 *   1. IT WOULD RIDE `publishedSnapshot` INTO OTHER ORGS. `definition-store.ts` copies the
 *      definition document when an integration is promoted. An evidence sample is one tenant's
 *      real request and one tenant's real response body - client names, processo numbers, invoice
 *      totals. On the definition it is inside the published bytes by construction, and the only
 *      thing standing between it and every other org would be a scrubber remembering to strip it.
 *      In its own collection there is nothing to remember: no publish path reads this module. That
 *      structural exclusion IS the sanitisation (CONVERGENCE_PLAN D5).
 *   2. IT WOULD RACE THE 16MB DOCUMENT LIMIT, and be re-serialised on every compare-and-swap of a
 *      document every reader of every action already touches - the Trap T2 argument
 *      `captured-calls-store.ts` makes at length, which applies here unchanged.
 *
 * ── WHAT MAY BE STORED ────────────────────────────────────────────────────────────────────────
 *
 * NO NEW REDACTION MACHINERY EXISTS IN THIS FILE, and that is the safety argument rather than an
 * economy. The api-call sample is the executor's OWN `requestSummary` - the object it already
 * builds on every call through `redactSecretsDeep` + `redactHeaders` + `redactUrl`, and already
 * persists verbatim on the failure path - plus a response body through the same `redactSecretsDeep`
 * and the same `truncateForDisplay` cap the failure path uses. If the redaction on this row were
 * ever wrong, the failure path would have been leaking the identical bytes since C2.
 *
 * The last gate is `captured-calls-store.ts`'s, for the same reason it has one: the whole document
 * is re-checked against the run's live registry after it is assembled, so a field a later slice
 * adds and forgets to filter cannot carry a secret out. A row that fails is NOT WRITTEN - evidence
 * is worth less than a credential.
 *
 * ── TENANCY (Capability Contract rule 5): ORG **AND OWNER**, BECAUSE THE SAMPLE IS THE OWNER'S ───
 *
 * The first cut of this module keyed a row on (orgId, integrationKey, actionName) and argued only
 * that a sample must not cross ORGS. That argument was right and incomplete, and the gap was
 * measurable: `findConfigForOwner` resolves a credential per (orgId, ownerUserId), and
 * `action-consent.ts`'s `idFor` keys an approval on (orgId, scope.userId, …). So WITHIN one org, an
 * org-visible definition run by two users is two different people's third-party accounts, and the
 * evidence is one tenant's real request and real response body - client names, processo numbers,
 * invoice totals - belonging to whichever of them ran it.
 *
 * With an org-only key that had two live consequences, both reproduced before this was changed:
 *   - the PEER'S RUN DESTROYED THE OWNER'S SAMPLE, because both wrote the same `_id`, and the org
 *     row then held the peer's private data where the owner's had been;
 *   - `trustAuthoredAction` reads this collection, so user A could promote an action to `trusted` -
 *     and therefore auto-runnable by `achieve` - on the strength of a run user B made against B's
 *     OWN third-party account.
 *
 * The screenshot POINTER was never the hole (the plane re-checks org + owner on every byte); the
 * EXCERPT copied into the row beside it was. The key is therefore the credential's key and the
 * consent's key: (orgId, ownerUserId, integrationKey, actionName). Both terms are in the
 * deterministic `_id`, both are stored on the row, both are terms of every query filter and both are
 * re-checked on every fetched document. Suite:
 * `api/tests/security/action-evidence-isolation.test.ts`.
 *
 * The ONE cross-tenant reader left in this module is `pinnedRunIdsForRetention`, and it is not a
 * tenancy hole: see its own docblock. It is reachable from the retention sweeper alone (at boot and
 * on the `RETENTION_SWEEP_INTERVAL_MS` rail) and returns run IDENTIFIERS ONLY. Round three had a
 * SECOND one - `listOwnerRefsForKey`, which handed a write-time
 * reconciler every tenant's rows for a key - and it is deleted rather than narrowed: a listing that
 * crosses tenants is what made a cross-tenant DELETE expressible in the first place.
 *
 * ── THE REMOVAL RULE: NOTHING SYNCHRONOUS DECIDES THAT A ROW IS OVER ──────────────────────────
 *
 * `recipe-lifecycle.ts` states the invariant this collection inherits: NOTHING DURABLE OUTLIVES THE
 * THING IT IS EVIDENCE FOR. An evidence row is durable and PINS its run's screenshots out of the
 * 7-day sweep for as long as it lives, so a row whose action nobody can reach any more converts a
 * bounded retention into an unbounded one. FOUR CONSECUTIVE ROUNDS tried to close that by asking
 * "is this action gone?" and acting on the answer, and produced FIVE defects:
 *
 *   round two   a diff of action sets scoped to `input.orgId`, the org that WROTE the definition.
 *               Rows are keyed by the org that RAN the action, which the `global` tier makes a
 *               different org, so every consumer's rows were ORPHANED - collected by nothing.
 *   round three the same collector widened ACROSS TENANTS via `getForActor` per row owner. It
 *               DELETED ACROSS AN ORG BOUNDARY twice over: it read the LIVE row while a consumer
 *               resolves the FROZEN `publishedSnapshot`, and it asked as the RUNNER while an
 *               org-shared credential resolves as the CUSTODIAN.
 *   round four  the reader's own path (`action-executor.ts`) plus a seam scoped to the writing org,
 *               both asking the ONE production resolution. Still two defects: an executor refusal
 *               deleted on TRANSIENT unreachability (a blip, a rotation, a half-applied write), and
 *               an `org -> private` flip deleted every peer's sample even when it was reverted a
 *               minute later. A boot-time sweep run with NO PINS on a failed pin read was the same
 *               error in the screenshot tree.
 *
 * THE CAUSE IS NOT THE SCOPE, THE ACTOR, OR THE VANTAGE. It is that "is this gone?" was answered
 * SYNCHRONOUSLY, at one instant, from one vantage, while the row it governs is durable. Every one of
 * those answers was defensible at the moment it was taken and wrong about the row's lifetime. So the
 * question is no longer asked, and no cleverer reachability check replaces it. THREE DURABLE SIGNALS
 * END A ROW, and nothing else does:
 *
 *   1. TIME. `sweepExpiredEvidence` ends every row not re-validated inside `EVIDENCE_RETENTION_DAYS`,
 *      orphan or not, and no vantage has to be right about anything. It runs at boot AND every
 *      `RETENTION_SWEEP_INTERVAL_MS` on `server.ts`'s retention rail - the trigger it did NOT have
 *      until round nine, when the only caller chain in the estate ended at `bootState`.
 *   2. THE OWNER. `discardEvidence`, reachable at
 *      `DELETE /api/v1/integrations/:key/actions/:actionName/evidence`. A person asking for their
 *      own data to go is a durable statement, not a guess. `discardEvidenceForDisconnectedConfig`
 *      is the same signal one step out: `deleteConfig` durably removed the credential whose account
 *      the sample holds, and the person who connected it is the one who removed it.
 *   3. A NEWER SAMPLE. `recordEvidence` supersedes wholesale by construction - the `_id` IS the
 *      tuple - so a validated run replaces the previous row and releases its pin in one write.
 *
 * A DEFINITION EDIT, A TIER FLIP, A RE-PUBLISH AND A FAILED RESOLVE RECORD NOTHING AND DELETE
 * NOTHING. That is a deliberate trade, journaled as one in docs/decisions.md: an orphaned row is a
 * BOUNDED retention and privacy gap - at most `EVIDENCE_RETENTION_DAYS` plus one sweep interval, and
 * closable at any moment by the owner - while a wrongly-deleted row is unrecoverable tenant data.
 * (Read "bounded" as a claim about the TRIGGER as much as the number: until round nine there was no
 * timer and no TTL index behind it, and the bound was really "until somebody deploys".) The costs
 * are not comparable, and four rounds of evidence say the guess is not reliable enough to spend the second
 * one. THE RESIDUAL WINDOW IS REAL AND IS RECORDED AS OPEN in docs/findings.md; it is not closed
 * here, and this header does not imply that it is.
 *
 * THE SCREENSHOT TREE still has no subject-erasure path of its own (`screenshot-plane.ts`); that
 * remains an open gap in docs/findings.md too.
 */
import { createHash } from 'node:crypto';
import { Store, type Doc } from '../data/store.js';
import { integrationActionEvidence } from '../data/stores.js';
import { secretRegistryFromValues, type SecretRegistry } from '../security/redaction.js';

/**
 * Per-excerpt cap, and the SINGLE SOURCE of the executor's `MAX_BODY_DISPLAY_BYTES` - the ceiling its
 * failure path applies to a response body. `action-executor.ts` now binds its constant to this one
 * (`const MAX_BODY_DISPLAY_BYTES = MAX_EVIDENCE_EXCERPT_CHARS`), so the success sample and the
 * failure dump cannot drift into showing a person two different amounts of the same body.
 *
 * THIS DOCBLOCK USED TO CLAIM THAT AND THE CODE DID NOT DO IT (round nine): "stated once here" sat
 * above two independent `8_000` literals in two files, and mutating either one alone left the whole
 * estate green. The tie is real now, and the claim is pinned behaviourally rather than by this
 * sentence - see `the failure dump and the success sample cut the same body at the same point` in
 * `api/tests/integrations/action-evidence-capture.test.ts`.
 */
export const MAX_EVIDENCE_EXCERPT_CHARS = 8_000;

/** How many step rows one automation-backed evidence row may pin. A trace is evidence, not an
 *  archive; a 400-step run teaches nothing the first 50 steps do not, and the row must stay far
 *  clear of the document limit however long a run gets. */
export const MAX_EVIDENCE_STEPS = 50;

/**
 * Names ONE owner's evidence for one action. Every read and write states it in full - there is no
 * ambient "current tenant" and no ambient "current user" in this module.
 *
 * `ownerUserId` is the same identity `findConfigForOwner` resolves the credential under, so the
 * sample is keyed by whose third-party account actually produced it. See the module header.
 */
export interface ActionEvidenceKey {
  orgId: string;
  ownerUserId: string;
  integrationKey: string;
  actionName: string;
}

// THE THREE "WHOSE ROWS" SHAPES ARE GONE (round five): `ActionEvidenceOwner` and the two that
// extended it, `ActionEvidenceOwnerRef` (what a write-time reconciler listed) and
// `OwnerEvidenceScope` (what a reader-side collector deleted through). Both collectors are deleted -
// see the removal rule in the header - and the types go with them rather than being left as vocabulary
// for the next attempt: keeping a shape that addresses "every row of this owner" keeps that deletion
// expressible without keeping anything that needs it. `ActionEvidenceKey` addresses exactly one row,
// and `DisconnectedConfigScope` below is the one remaining shape that reaches more, scoped to the
// credential that was durably removed.

/**
 * The scope of the credential-disconnection erasure (`deleteConfig`).
 *
 * A DISCRIMINATED `owner`, NOT AN OPTIONAL `ownerUserId`, because the two cases are genuinely
 * different and an optional term is one a caller can forget: a config row stamped with a custodian
 * (`ownerUserId`) is that one person's credential, while a legacy org-shared row carries none and is
 * the fallback `findConfigForOwner` hands to every member of the org that has no row of their own.
 *
 * `everyOwnerExcept` IS THAT SECOND ARM, AND ITS SHAPE IS THE ROUND-FOUR CORRECTION. It used to read
 * `'every-owner-in-org'`, which erased the samples of peers the deleted row was not serving:
 * `findConfigForOwner` returns `rows.find(c => c.ownerUserId === owner)` BEFORE it falls back to the
 * shared row, so a member holding a config of their own is not resolving the shared one, and erasing
 * their sample was one member's disconnect destroying another member's data. The scope the caller
 * passes is therefore "every owner for whom `findConfigForOwner` WOULD resolve this row AT THE MOMENT
 * OF THE DISCONNECT" - every owner in the org except those holding a config of their own.
 *
 * ── AND THAT IS A STATEMENT ABOUT NOW, NOT ABOUT WHOSE ACCOUNT THE SAMPLE HOLDS (round eight) ──
 *
 * The previous revision of this note claimed the stronger thing - "a member holding their own config
 * for the key never resolved the deleted one, and their sample is a sample of a credential they still
 * have" - and ORDERING makes that false. Member M runs the action while the org-shared credential is
 * the only one there is, so M's row holds the SHARED account's request and response. M later connects
 * a credential of their own. An admin then disconnects the shared one: M is now in
 * `everyOwnerExcept`, M's row is spared, and a sample of the DISCONNECTED account outlives the
 * disconnection. Nothing on this rail re-reads whose account a stored sample actually came from -
 * the row records `ownerUserId`, `backingType` and `shape`, never which credential produced it - so
 * no exclusion list computed at the instant of the delete can be right about a durable row's past.
 *
 * IT IS THE RETAINING DIRECTION AND IT IS BOUNDED, which is why it is recorded rather than fixed
 * here: the alternative (erase every owner in the org) is the round-four defect, which destroyed the
 * samples of credentials people still hold. The surviving row is closable by its owner at any moment
 * (`discardEvidence`, `DELETE …/evidence`) and goes on its own inside `EVIDENCE_RETENTION_DAYS` plus
 * one `RETENTION_SWEEP_INTERVAL_MS`.
 * OPEN in docs/findings.md as `evidence-of-a-shared-credential-survives-its-disconnection`.
 */
export type DisconnectedConfigScope = {
  orgId: string;
  integrationKey: string;
  owner: { userId: string } | { everyOwnerExcept: readonly string[] };
};

/**
 * How long a validated run stays evidence. The RETENTION BOUND that makes an orphaned row a bounded
 * gap rather than an unbounded one, and the reason "fail towards retaining" is an acceptable posture
 * at all: a row not re-validated within this window goes at the next sweep whether or not anything
 * ever noticed its action stopped resolving.
 *
 * ── AND "THE NEXT SWEEP" IS A REAL EVENT NOW, WHICH IT WAS NOT (round nine) ───────────────────
 *
 * The sentence above used to read "goes at the next BOOT", and every document that quoted this
 * constant turned that into "at most 90 days". It was not: `sweepExpiredEvidence` had exactly one
 * caller chain in the estate - `sweepScreenshotsSparingPinnedEvidence` -> `bootState` -> `boot()` -
 * with no interval and no Mongo TTL index anywhere in the repo, while the deployment
 * (`deploy/staging/docker-compose.yml`, `restart: unless-stopped`) is built to stay up. An api
 * container running six months without a deploy held every row for six months, and every
 * automation-backed row held its screenshot pin for six months with it. Round six then enforced this
 * CONSTANT (90 -> 89 and 90 -> 91 both redden) and not the TRIGGER, so the estate was green over a
 * bound that could not fire.
 *
 * `startRetentionSweepRail` in `server.ts` is the trigger: an unref'd `RETENTION_SWEEP_INTERVAL_MS`
 * interval armed by `bootState`, pinned by a TICK rather than by a constant
 * (`api/tests/automation/composition-root-screenshot-pins.test.ts`). THE HONEST BOUND IS THEREFORE
 * "`EVIDENCE_RETENTION_DAYS` PLUS AT MOST ONE `RETENTION_SWEEP_INTERVAL_MS`", and it is written that
 * way wherever it is claimed rather than rounded down to the number below.
 *
 * 90 DAYS, AND THE NUMBER IS A TRADE RATHER THAN A ROUND FIGURE. Shorter than the screenshot sweep's
 * 7 days is wrong (an automation row's pointers would outlive nothing, but the graduation
 * prerequisite would evaporate between a run and the human who confirms it); much longer stops
 * bounding anything.
 *
 * ── WHAT ACTUALLY REFRESHES `validatedAt`, AND WHAT DOES NOT (round eight) ────────────────────
 *
 * This paragraph used to read "every successful run rewrites `validatedAt`, so an integration in real
 * use never ages out - only one nobody has run for a quarter of a year". THAT IS FALSE FOR EXACTLY
 * THE PATH THIS PLATFORM IS BUILT AROUND. A `browser-steps` READ action is `storable`
 * (`automation/service.ts`: `named && !mutating`), so its FIRST run compiles a recipe and every later
 * run REPLAYS - the answer carries a `replay-<uuid>` id, there is by construction no `automationRuns`
 * document behind it, `collectRunEvidence` therefore answers null, and the executor records nothing.
 * An action run successfully every single day for ninety days keeps the stamp of its FIRST run, is
 * deleted at the next sweep after that, and releases its screenshot pin on the way out.
 *
 * The paths that DO refresh are the ones where a run really happens: every `api-call` action; a
 * mutating automation-backed action (never `storable`, so it never replays); and an automation-backed
 * read whose passes have compiled nothing yet.
 *
 * WHAT WOULD HAVE TO CHANGE for the retired sentence to become true: the replay leg would have to
 * RE-STAMP the row. It can never re-collect one - there is no run to collect, which is precisely what
 * `collectRunEvidence`'s null means - so this has to be a second, separate operation on this store
 * ("the sample I already hold is still current"), bumping `validatedAt` and leaving `evidence`
 * untouched, called from the replay leg with the same (org, owner, key, action) tuple. It is NOT
 * written here: on this branch the row has no production reader at all (the detail page is S2/S3) and
 * authored actions are api-call-backed only (`authored-action.ts` refuses an `automationBinding`), so
 * every promotion-relevant success does still record. It lands the moment either mounts. OPEN in
 * docs/findings.md as `evidence-of-a-replaying-action-ages-out-while-the-action-is-in-daily-use`.
 *
 * CHANGING THIS NUMBER IS A TRIPWIRE ON PURPOSE. Round five made TTL the SOLE automatic collector,
 * which turned this constant from a backstop into the thing every "bounded gap" argument in
 * docs/decisions.md, docs/findings.md, docs/architecture.md and this file's own header rests on -
 * and until round six nothing enforced it: 90 -> 1 left the whole estate green while deleting every
 * tenant's evidence a day after their last run and releasing each automation-backed row's screenshot
 * pin in the same sweep. `sweepExpiredEvidence - the retention bound` in
 * `api/tests/integrations/action-evidence.test.ts` now restates 90 as a LITERAL and straddles the
 * cutoff by half a day either side, so any integer change here reddens it. If you are shortening the
 * window deliberately, change that literal in the same commit and say why in docs/decisions.md; if
 * you did not mean to change it, the red case is the point.
 */
export const EVIDENCE_RETENTION_DAYS = 90;

/** The api-call sample: the executor's own redacted request summary plus a capped response body. */
export interface ApiCallEvidence {
  kind: 'api-call';
  /** `truncated` is the REQUEST body's own flag. It exists for the same reason the response's does:
   *  the module promises truncation is recorded and never silent, and an oversized request body is
   *  stored with the "… [truncated, N more bytes]" marker sliced off by the cap below. */
  request: { method: string; url: string; headers: Record<string, string>; body?: string; truncated?: boolean };
  response: { status: number; body?: string; bodyIsJson?: boolean; truncated?: boolean };
}

/**
 * ONE step of an automation-backed run, as evidence POINTS at it.
 *
 * `screenshotUrl` is the path the authenticated screenshot plane already serves
 * (`GET /automation-screenshots/:automationId/:runId/:file`), so a reader still has to present a
 * token and still has to pass that plane's org+owner check to see a single byte. Copying the PNG
 * into this row would have created a second copy of an authenticated portal session under a
 * different access rule; a pointer inherits the rule that already exists.
 */
export interface RunStepEvidence {
  stepIndex: number;
  stepType?: string;
  /**
   * The step's own outcome (`StepRecord.status` - 'succeeded' | 'failed' | …).
   *
   * NAMED `status` BECAUSE THAT IS WHAT IT HOLDS. The first cut called this field `title` and
   * populated it from `step.status`, which is not a title of anything: `StepRecord` has no title,
   * so every step of every automation-backed sample would have rendered as "succeeded".
   */
  status?: string;
  /** Pointer into the authenticated screenshot plane. Never bytes. */
  screenshotUrl?: string;
  /** Capped, redacted excerpt of the step's own output (a `local_command`'s stdout/stderr). */
  excerpt?: string;
  truncated?: boolean;
}

/** The browser-steps / bash-cli sample: pointers into a run the engine already recorded. */
export interface AutomationEvidence {
  kind: 'automation';
  /** The run these pointers address. Also the retention PIN - see `pinnedRunIdsForRetention`. */
  runId: string;
  status?: string;
  steps: RunStepEvidence[];
  /**
   * True when the RUN had more steps than were kept, so `steps` is a PREFIX of the trace.
   *
   * IT IS CARRIED IN, NOT DERIVED HERE, and that is the round-seven correction rather than a
   * stylistic note. `capEvidence` below can only compare the length of what it was HANDED against
   * `MAX_EVIDENCE_STEPS`, and the production writer - `automation/action-evidence.ts`'s
   * `collectRunEvidence`, through `action-executor.ts` - has already sliced to exactly that number.
   * So the length test never fired on the only path production takes, and a 50-step prefix of a
   * 200-step run was stored byte-for-byte as a complete 50-step run: no flag, no count, nothing a
   * reader could notice.
   *
   * WHY IT MATTERS, STATED FOR WHAT THIS BRANCH ACTUALLY HAS. The row is durable for
   * `EVIDENCE_RETENTION_DAYS` plus one sweep interval, and it is the record the graduation gate
   * reads before an action becomes auto-runnable by `achieve`. The previous revision called it "the
   * human's basis for granting `trusted`", and NO HUMAN READS IT HERE: `trustAuthoredAction`'s fetch
   * feeds `promoteToTrusted`, which looks at `outcome` and `shape` only, and the person promoting
   * echoes back a shape string - the steps never reach a surface, because the page that would render
   * them is S2/S3. The flag is therefore correctness FOR THE READER WHO IS COMING (see the module
   * header), not a fix to something a person is currently being misled by.
   *
   * The end-to-end pin is `the EVIDENCE seams (slice S1)` in
   * `api/tests/automation/composition-root-action-seam.test.ts`, which drives a run longer than the
   * cap through the real collector, the real executor and this real store.
   */
  truncated?: boolean;
}

export type ActionEvidence = ApiCallEvidence | AutomationEvidence;

/**
 * THE ROW'S OWN VERDICT ON THE RUN IT HOLDS.
 *
 * NOT `AutomationEvidence.status` (the engine's `RunStatus`) and not `ApiCallEvidence.response.status`
 * (an HTTP code). Those are the raw facts; this is the one question every reader of this collection
 * actually asks - "is this a sample of the action WORKING?" - answered once, in the same vocabulary,
 * whichever kind the row is.
 */
export type ActionEvidenceOutcome = 'succeeded' | 'failed';

export interface ActionEvidenceDoc extends Doc, ActionEvidenceKey {
  /** `api-call` | `browser-steps` | `bash-cli` - how the action ran when it produced this. */
  backingType: string;
  /**
   * The action SHAPE (`action-consent.ts`'s `actionShape`) this run actually exercised.
   *
   * Stamped so the graduation prerequisite can be bound to BYTES rather than to a name: an action
   * that was authored, run once, then re-authored into something else must not graduate on the old
   * run's evidence. `promoteToTrusted` refuses evidence whose shape does not match, and refuses
   * evidence carrying no shape at all.
   */
  shape?: string;
  /** When the validated run happened. THE graduation prerequisite reads this. */
  validatedAt: string;
  /**
   * DID THIS RUN SUCCEED - DERIVED FROM THE SAMPLE, NEVER ASSERTED BY THE CALLER (round eight).
   *
   * WHY IT EXISTS. `promoteToTrusted` - the one producer of `state: 'trusted'`, which is what makes
   * an action auto-runnable by `achieve` - read PRESENCE plus `shape` and nothing else. So the whole
   * graduation gate rested on a WRITE-SITE INVARIANT: one line in `action-executor.ts`
   * (`if (!automationResult.success) return null;`) being the only thing that stopped a FAILED
   * automation run from being recorded as the last validated run. Delete that line and the failed
   * run's trace supersedes the last successful sample at the same deterministic `_id`, with a fresh
   * `validatedAt` - and the gate would have promoted on it, because nothing it read carried a success
   * signal. A gate must not depend on a guard living in the thing it is gating.
   *
   * DERIVED AND NOT CARRIED, for the same reason. A term the executor passed in would restate the
   * write site's own belief, so a write site that recorded a failure would label it `succeeded` and
   * the gate would be exactly as dependent as before. `outcomeOf` reads the bytes that were actually
   * stored, so the label cannot disagree with the sample it labels.
   *
   * THE `failed` VALUE IS UNREACHABLE FROM PRODUCTION TODAY, AND THAT IS THE POINT rather than dead
   * code: both write sites refuse to record a failure (the executor line above, and `executeHttpAction`
   * only capturing inside its 2xx branch), and those refusals are pinned in their own right
   * (`tests/integrations/action-evidence-capture.test.ts`). This term is what the gate reads if either
   * refusal is ever lost, and it is reachable through `recordEvidence`, which is a production API of
   * this store.
   */
  outcome: ActionEvidenceOutcome;
  evidence: ActionEvidence;
}

export type ActionEvidenceErrorCode = 'UNSAFE' | 'INVALID';

export class ActionEvidenceStoreError extends Error {
  constructor(public readonly code: ActionEvidenceErrorCode, message: string) {
    super(message);
    this.name = 'ActionEvidenceStoreError';
  }
}

/**
 * The deterministic `_id`, JSON-encoded so the encoding is injective for any strings (the argument
 * `capturedCallIdFor` and `definitionIdFor` both make; a `::` join is not injective when any term
 * may contain the separator).
 *
 * There is no run id, no timestamp and no sequence in it, and that is the whole design: the id IS
 * the (org, integration, action) tuple, so a `put` of a new validated run REPLACES the previous
 * row rather than accumulating beside it. One live evidence row per action, by construction -
 * nothing has to remember to delete the old one.
 */
export function actionEvidenceIdFor(key: ActionEvidenceKey): string {
  return createHash('sha256')
    .update(JSON.stringify([key.orgId, key.ownerUserId, key.integrationKey, key.actionName]))
    .digest('hex');
}

/** What a caller offers. `secrets` is the run's live registry; when present, a row that still
 *  contains a live value after redaction is REFUSED rather than written. */
export interface RecordEvidenceInput {
  backingType: string;
  /** The action shape this run exercised - see `ActionEvidenceDoc.shape`. */
  shape?: string;
  evidence: ActionEvidence;
  secrets?: SecretRegistry;
}

export class ActionEvidenceStore {
  private readonly store: Store<ActionEvidenceDoc>;

  constructor(
    store: Store<Doc> = integrationActionEvidence,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = store as unknown as Store<ActionEvidenceDoc>;
  }

  /**
   * Record the evidence of a VALIDATED run, superseding whatever was there.
   *
   * `put` and not `insert`: superseding IS the operation. A retried record of the same run writes
   * the same bytes to the same id, so this is idempotent without a claim protocol.
   */
  async recordEvidence(key: ActionEvidenceKey, input: RecordEvidenceInput): Promise<ActionEvidenceDoc> {
    assertKey(key);
    // Capped FIRST, and the verdict derived from what is actually stored rather than from what was
    // offered. Neither cap can change the two fields `outcomeOf` reads, so the two orders agree
    // today; deriving from the stored bytes is what keeps them agreeing if a later cap ever touches
    // one - see `ActionEvidenceDoc.outcome`.
    const evidence = capEvidence(input.evidence);
    const doc: ActionEvidenceDoc = {
      _id: actionEvidenceIdFor(key),
      orgId: key.orgId,
      ownerUserId: key.ownerUserId,
      integrationKey: key.integrationKey,
      actionName: key.actionName,
      backingType: input.backingType,
      ...(input.shape !== undefined ? { shape: input.shape } : {}),
      validatedAt: this.now().toISOString(),
      outcome: outcomeOf(evidence),
      evidence,
    };
    // THE LAST GATE, over the WHOLE document rather than the fields a redaction pass knew about.
    // `captured-calls-store.ts` makes the argument; it holds identically here.
    assertNoLiveSecret(doc, input.secrets);
    return this.store.put(doc);
  }

  /** The one live evidence row for one owner's use of one action, or null. */
  async getEvidence(key: ActionEvidenceKey): Promise<ActionEvidenceDoc | null> {
    if (!isTenantScoped(key)) return null;
    const doc = await this.store.get(actionEvidenceIdFor(key));
    // The id already binds the row to the tenant AND the owner; this re-check covers a document
    // whose stored `orgId`/`ownerUserId` disagrees with the id it lives under, and it fails closed.
    // Both terms are checked because both are in the id: a row carrying NO `ownerUserId` at all must
    // not be handed to whichever member of the org asks for it first.
    //
    // WHERE SUCH A ROW COMES FROM, STATED HONESTLY (round eight): NOT from a migration. This
    // collection has never shipped - the org-only key was an earlier round of this same unmerged
    // branch, so no deployment holds a pre-owner row and nothing migrated anything. `recordEvidence`
    // refuses to write the shape (`assertKey`), so it can only arrive by hand, by a partial restore,
    // or from a future writer. That is exactly when a fail-closed re-check is worth having and
    // exactly when nobody is watching, which is why it is pinned rather than trusted.
    if (!doc) return null;
    return doc.orgId === key.orgId && doc.ownerUserId === key.ownerUserId ? doc : null;
  }

  /**
   * Every evidence row ONE OWNER holds for one integration.
   *
   * IT HAS NO PRODUCTION CALLER YET, AND THAT IS SAID HERE RATHER THAN LEFT TO BE DISCOVERED. This
   * docblock read "the detail page's read", which describes a page that is slice S2/S3 and lives on
   * a different branch; on THIS branch every caller is a test. So the tenancy legs below are pinned
   * SURFACE, not a covered production path. The isolation suite attacks the method directly, which
   * is deliberate - a Rule 5 store's list read is attacked before it is exposed, not after - but
   * nothing routes to it, so a change here is not additionally caught by any end-to-end case. Delete
   * this paragraph when the detail page mounts.
   *
   * THE POST-FILTER IS REDUNDANT BY CONSTRUCTION, and is recorded as such rather than left to look
   * load-bearing. An exact-match query on `orgId`/`ownerUserId` cannot return a document whose
   * stored values differ, so the two terms enforce the same predicate on the same fields and each
   * MASKS the other under mutation: removing either alone leaves the isolation suite green, and
   * only removing BOTH turns it red (measured). It is kept because `CapturedCallsStore.listCapture`
   * keeps its own for the same belt-and-braces reason, and because a later change to the query
   * shape (a projection, an `$in`, a re-sort) would otherwise silently remove the only tenancy term.
   *
   * CONTRAST `getEvidence`, WHERE THE RE-CHECK IS NOT REDUNDANT: that lookup is by deterministic
   * `_id` and never consults the stored fields at all, so a hand-written or restored row whose
   * stored org/owner disagrees with the id it lives under WOULD be returned without it. That mutant
   * dies.
   */
  async listForIntegration(orgId: string, ownerUserId: string, integrationKey: string): Promise<ActionEvidenceDoc[]> {
    if (orgId === '' || ownerUserId === '' || integrationKey === '') return [];
    const rows = await this.store.find({ orgId, ownerUserId, integrationKey }, { actionName: 1 });
    return rows.filter((row) => row.orgId === orgId && row.ownerUserId === ownerUserId);
  }

  /**
   * THE OWNER'S ERASURE CONTROL - drop ONE owner's evidence for ONE action, because they asked.
   *
   * The one removal an actor performs, and the only removal primitive addressed by name. Its
   * production caller is `DELETE /api/v1/integrations/:key/actions/:actionName/evidence`, which
   * builds the key from the VERIFIED actor - so a request cannot name a colleague's row.
   *
   * ITS OWN `isTenantScoped` CHECK IS BELT-AND-BRACES, AND IS RECORDED AS SUCH RATHER THAN LEFT TO
   * LOOK LOAD-BEARING. `getEvidence` below applies the same predicate first, so the two mask each
   * other under mutation exactly as `listForIntegration`'s two tenancy terms do: removing this one
   * ALONE leaves the isolation suite green (measured), and only removing both turns the discard leg
   * red. Kept because a later change to how this method finds its row - a direct `_id` delete, say -
   * would otherwise silently remove the only guard there is.
   */
  async discardEvidence(key: ActionEvidenceKey): Promise<boolean> {
    if (!isTenantScoped(key)) return false;
    const doc = await this.getEvidence(key);
    if (!doc) return false;
    return this.store.delete(doc._id);
  }

  /**
   * Drop the samples a DISCONNECTED credential produced.
   *
   * Scoped to the config that went. `orgId` and `integrationKey` are exact-match terms in BOTH arms,
   * so nothing outside the tenant whose config was deleted is reachable; the arms differ only in
   * WHICH members of that tenant were connected THROUGH the deleted row - see
   * `DisconnectedConfigScope` for why the shared-config arm is an exclusion list and not "everyone".
   * Answers how many rows went.
   */
  async discardEvidenceForDisconnectedConfig(scope: DisconnectedConfigScope): Promise<number> {
    if (scope.orgId === '' || scope.integrationKey === '') return 0;
    if ('userId' in scope.owner && scope.owner.userId === '') return 0;
    return this.store.deleteMany({
      orgId: scope.orgId,
      integrationKey: scope.integrationKey,
      ...('userId' in scope.owner
        ? { ownerUserId: scope.owner.userId }
        // `$nin` also matches a row carrying NO `ownerUserId` at all - a shape `recordEvidence`
        // refuses to write, so it can only have been hand-written or restored. That is the right
        // side to err on here: such a row names an account inside this org for this integration and
        // can never be superseded, since no writer produces that shape.
        : { ownerUserId: { $nin: [...scope.owner.everyOwnerExcept] } }),
    });
  }

  // THERE IS NO OWNER-REF LISTING ANY MORE. `listOwnerRefsInOrg` existed to feed the write-time
  // reconciler and went with it (round five); its predecessor `listOwnerRefsForKey` crossed tenants
  // and went in round four. Nothing in this codebase enumerates who holds a row: the three signals
  // that end a row all address exactly one row, or age out rows by a stamp without reading them.

  /**
   * THE RETENTION SWEEP - every row not re-validated inside the window goes, orphan or not.
   *
   * THIS IS THE COLLECTOR NOW, not a backstop behind one. Round five removed every synchronous
   * collector, so TIME is what ends a row nobody re-validated: a decision no vantage has to be right
   * about, taken about a window rather than about an instant, on data whose lifetime is exactly the
   * thing being measured. A row whose action stopped resolving for a reader who never runs it again
   * ages out here, releasing its screenshot pin with it.
   *
   * IT IS ALSO THE ONLY BOUND UNDER `discardEvidenceOfDisconnectedConfig`, whose catch-all returns 0
   * and warns: a credential-disconnect erasure that fails leaves rows behind that nothing retries,
   * and this is what eventually takes them. That backstop was as un-triggered as the bound itself
   * until round nine - see below.
   *
   * IT HAS A TRIGGER, AND THE TRIGGER IS NOT A DEPLOY (round nine). Its one caller chain used to end
   * at `bootState`, with no interval and no Mongo TTL index behind it, so every "at most 90 days"
   * claim in this repo was really "at most 90 days after the next restart" in a deployment built not
   * to restart. `server.ts`'s `startRetentionSweepRail` re-enters
   * `sweepScreenshotsSparingPinnedEvidence` every `RETENTION_SWEEP_INTERVAL_MS`, so the bound this
   * method enforces is `EVIDENCE_RETENTION_DAYS` plus at most one tick.
   *
   * CROSS-TENANT BY NECESSITY AND NOT A TENANCY HOLE, for the reason `pinnedRunIdsForRetention` is
   * not one: retention belongs to no tenant, this runs on a boot/timer job that has no actor and
   * cannot be reached by a request, and it returns a COUNT - it never reads, projects or hands back
   * a row.
   *
   * ONE `deleteMany` AND NO MATERIALISATION: `validatedAt` is an ISO-8601 stamp, which orders
   * lexicographically, so the cutoff is a plain string comparison in the query rather than a scan of
   * documents that hold hundreds of KB each.
   */
  async sweepExpiredEvidence(opts: { now: number; retentionDays?: number }): Promise<number> {
    const days = opts.retentionDays ?? EVIDENCE_RETENTION_DAYS;
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(opts.now - days * 24 * 60 * 60 * 1000).toISOString();
    return this.store.deleteMany({ validatedAt: { $lt: cutoff } });
  }

  /**
   * THE RETENTION PINS - every run id any tenant's live evidence points at.
   *
   * CROSS-TENANT BY NECESSITY, AND NOT A TENANCY HOLE. `sweepExpiredScreenshots` walks a FILESYSTEM
   * tree that has no org in it (`<root>/<automationId>/<runId>`), on a boot/timer job that belongs to
   * no tenant. Asking "which runs must this sweep spare" cannot be scoped to an org, because the
   * sweep is not scoped to an org.
   *
   * What crosses the boundary is therefore held to identifiers ONLY: a set of run id strings, with
   * no org, no action, no integration key and no sample attached. A caller learns that some run is
   * pinned, never whose it is or what it did. The one production caller is the retention sweeper
   * (`server.ts`, at boot and on its rail), which does not have an actor and cannot be reached by a
   * request.
   *
   * ── THE READ IS BOUNDED, WHICH IS A DIFFERENT CLAIM FROM "THE PIN COUNT IS BOUNDED" ──────────
   *
   * The paragraph above bounds the ANSWER: one pin per live row, released on every supersede. It
   * says nothing about the READ, and the first cut's `find({})` walked whole documents - rows that
   * hold a capped request plus a capped response sample (hundreds of KB) and accumulate as
   * orgs x owners x integrations x actions with no TTL. At 10k rows that is a multi-gigabyte
   * materialisation to build a set of short strings, AT BOOT. The `.catch` on the one caller cannot
   * degrade it either: an OOM abort is not a rejection, so the real failure mode was a boot crash
   * loop rather than the documented "degrades to pin nothing".
   *
   * So the query names the only two fields this needs, and pre-filters to the only `kind` that can
   * contribute one. WHICH OF THE TWO `kind` TESTS IS LOAD-BEARING IS RECORDED RATHER THAN IMPLIED,
   * because they are not the pair they look like: the QUERY term is the one that narrows (dropping
   * it reddens the bounded-read case, measured), while the loop's `ev.kind === 'automation'` is a
   * TYPE DISCRIMINATION - deleting it does not compile, and casting it away instead SURVIVES,
   * because an api-call row carries no `runId` for the loop to read. It is kept for the reason
   * `listForIntegration` keeps its redundant pair: a later change to the query shape must not
   * silently be the removal of the only rule there is.
   */
  async pinnedRunIdsForRetention(): Promise<Set<string>> {
    const rows = await this.store.find(
      { 'evidence.kind': 'automation' },
      undefined,
      { projection: { 'evidence.kind': 1, 'evidence.runId': 1 } },
    );
    const pins = new Set<string>();
    for (const row of rows) {
      const ev = row.evidence;
      if (ev && ev.kind === 'automation' && typeof ev.runId === 'string' && ev.runId !== '') pins.add(ev.runId);
    }
    return pins;
  }
}

function isTenantScoped(key: ActionEvidenceKey): boolean {
  return key.orgId !== '' && key.ownerUserId !== '' && key.integrationKey !== '' && key.actionName !== '';
}

function assertKey(key: ActionEvidenceKey): void {
  if (!isTenantScoped(key)) {
    throw new ActionEvidenceStoreError('INVALID', 'evidence must name an org, an owner, an integration and an action');
  }
}

/** Bound what was offered. Callers already cap what they build; this is the module's own ceiling,
 *  so a caller that forgets cannot grow the document past what the collection promises. */
function capEvidence(evidence: ActionEvidence): ActionEvidence {
  if (evidence.kind === 'api-call') {
    const body = capText(evidence.response.body);
    // THE REQUEST BODY'S FLAG IS KEPT, not discarded. The first cut called `capText` on it and threw
    // the `truncated` half away, so an oversized request body was cut SILENTLY - and cut in the one
    // place it is least visible, because the executor's own `truncateForDisplay` appends a
    // "… [truncated, N more bytes]" marker at the END, which this cap then slices off.
    const requestBody = capText(evidence.request.body);
    return {
      kind: 'api-call',
      request: {
        method: evidence.request.method,
        url: evidence.request.url,
        headers: evidence.request.headers,
        ...(requestBody.text !== undefined ? { body: requestBody.text } : {}),
        ...(requestBody.truncated || evidence.request.truncated ? { truncated: true } : {}),
      },
      response: {
        status: evidence.response.status,
        ...(body.text !== undefined ? { body: body.text } : {}),
        ...(evidence.response.bodyIsJson !== undefined ? { bodyIsJson: evidence.response.bodyIsJson } : {}),
        ...(body.truncated || evidence.response.truncated ? { truncated: true } : {}),
      },
    };
  }
  const steps = evidence.steps.slice(0, MAX_EVIDENCE_STEPS).map((step) => {
    const excerpt = capText(step.excerpt);
    return {
      ...step,
      ...(excerpt.text !== undefined ? { excerpt: excerpt.text } : {}),
      // `|| step.truncated` HERE IS AN EQUIVALENT MUTANT, and it is recorded as one so a future round
      // does not mistake it for the carrier the way the RUN-LEVEL disjunct below was mistaken for six
      // rounds. `...step` has already spread the incoming `truncated` through, so deleting this half
      // changes no stored byte for any input: the flag arrives on the step and leaves on the step. It
      // is kept only so the two `truncated` computations in this function read the same way; nothing
      // depends on it, and no test can kill it. (The RUN-level flag is a different story - it is
      // computed rather than spread, and its production carrier is `evidence.truncated`.)
      ...(excerpt.truncated || step.truncated ? { truncated: true } : {}),
    };
  });
  return {
    kind: 'automation',
    runId: evidence.runId,
    ...(evidence.status !== undefined ? { status: evidence.status } : {}),
    steps,
    // TWO DISJUNCTS, AND ONLY THE SECOND ONE IS ON THE PRODUCTION PATH. `evidence.truncated` is the
    // flag the collector set at the moment it did the cutting, forwarded across the executor seam;
    // it is the only thing that can be true of a row this product writes, because the collector
    // slices to `MAX_STEPS` (== `MAX_EVIDENCE_STEPS`) before this ever sees the steps, making the
    // length comparison exactly-equal and therefore false. The length test is kept as the module's
    // OWN ceiling - the guarantee a future caller that forgets to cap cannot silently break - and is
    // recorded as unreachable-from-production rather than left looking like the mechanism.
    ...(evidence.steps.length > MAX_EVIDENCE_STEPS || evidence.truncated ? { truncated: true } : {}),
  };
}

/**
 * THE ROW'S VERDICT, read off the sample itself.
 *
 * `api-call`: the 2xx window, which is exactly the `Response.ok` predicate `executeHttpAction`
 * branches on - the same reading, applied to the number that was stored rather than to a live
 * `Response` this module never sees.
 *
 * `automation`: `RunStatus`'s ONE success member is `completed` (`automation/types.ts`); `failed`,
 * `cancelled` and every `awaiting_*` / `needs_credentials` halt are not a run that worked.
 * `automation/service.ts` writes the same reading as `status === 'completed' || status === 'succeeded'`
 * - its second disjunct is unreachable, because `RunAutomationResult.status` is `RunStatus` and
 * `succeeded` is not a member of it - so the two cannot actually disagree. A row whose `status` is
 * ABSENT is `failed` here, and that is the fail-closed direction on purpose: "we cannot tell how this
 * run ended" must not be answered with "it worked".
 */
function outcomeOf(evidence: ActionEvidence): ActionEvidenceOutcome {
  if (evidence.kind === 'api-call') {
    return evidence.response.status >= 200 && evidence.response.status < 300 ? 'succeeded' : 'failed';
  }
  return evidence.status === 'completed' ? 'succeeded' : 'failed';
}

function capText(raw: string | undefined): { text?: string; truncated: boolean } {
  if (raw === undefined) return { truncated: false };
  if (raw.length <= MAX_EVIDENCE_EXCERPT_CHARS) return { text: raw, truncated: false };
  return { text: raw.slice(0, MAX_EVIDENCE_EXCERPT_CHARS), truncated: true };
}

/** Prove no registered value survives anywhere in the document. Cheap (one serialisation of an
 *  already-bounded document) and it is what makes the redaction claim testable rather than believed. */
function assertNoLiveSecret(doc: ActionEvidenceDoc, secrets?: SecretRegistry): void {
  if (!secrets) return;
  const serialised = JSON.stringify(doc);
  if (secrets.redact(serialised) !== serialised) {
    throw new ActionEvidenceStoreError('UNSAFE', 'action evidence still contained a live credential value after redaction');
  }
}

/** Build the registry the last gate checks against, from the values a run actually resolved. Here
 *  so a caller holding a `string[]` of secret values does not have to import the redaction module
 *  to get the guarantee. */
export function evidenceSecretsFromValues(values: Iterable<unknown>): SecretRegistry {
  return secretRegistryFromValues(values);
}

/** The process-wide store over the real `integration_action_evidence` collection. */
export const actionEvidenceStore = new ActionEvidenceStore();

/**
 * THE CREDENTIAL-DISCONNECTION ERASURE - the samples a credential produced go when the credential
 * does.
 *
 * ITS OWN FUNCTION BECAUSE IT ANSWERS A DIFFERENT QUESTION FROM EVERY OTHER REMOVAL HERE. The
 * others ask "can this reader still REACH the action", and a disconnected credential does not change
 * that answer: the definition still resolves. What changed is that the third-party account whose
 * request and response the sample holds is no longer connected, and the person who connected it has
 * just asked for it to go.
 *
 * BEST EFFORT AND LOUD: `deleteConfig` has already removed the credential by the time this runs, and
 * an undeletable config would be a worse failure than a reported leftover.
 *
 * AND "BEST EFFORT" NEEDS SOMETHING BEHIND IT, WHICH IT DID NOT HAVE (round nine). Nothing retries
 * this: the catch below answers 0, logs, and the caller moves on. The only thing that ever reaches
 * those leftover rows again is the retention sweep - which, until `startRetentionSweepRail` existed,
 * ran solely at `bootState`. So a disconnect erasure that hit a Mongo blip left one person's real
 * third-party request and response behind with no bounded backstop at all, in a container built to
 * stay up. The backstop is now `EVIDENCE_RETENTION_DAYS` plus at most one `RETENTION_SWEEP_INTERVAL_MS`,
 * which is long but is a bound. Shortening it means retrying here, and that is a durable-queue
 * question rather than a `try`/`catch` one.
 */
export async function discardEvidenceOfDisconnectedConfig(
  scope: DisconnectedConfigScope,
  deps: { discardEvidenceForDisconnectedConfig?: (scope: DisconnectedConfigScope) => Promise<number> } = {},
): Promise<number> {
  const discard = deps.discardEvidenceForDisconnectedConfig
    ?? ((s: DisconnectedConfigScope) => actionEvidenceStore.discardEvidenceForDisconnectedConfig(s));
  try {
    return await discard(scope);
  } catch (err) {
    console.warn(
      `[integrations] the evidence of '${scope.integrationKey}' in org ${scope.orgId} outlived the `
        + `credential that produced it: ${messageOf(err)}`,
    );
    return 0;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
