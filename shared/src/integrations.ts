/** Integrations domain contract (ch03 §3.8.13): definitions, active catalog, configs, session capture. */
import { z } from 'zod';
import { IsoTimestamp, itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const IntegrationDefinition = z
  .object({
    key: z.string(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    icon: z.string().optional(),
    authType: z.string().optional(),
    userCreated: z.boolean().optional(),
    actions: z.array(z.record(z.unknown())).optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type IntegrationDefinition = z.infer<typeof IntegrationDefinition>;

export const ActiveIntegration = z
  .object({
    key: z.string(),
    displayName: z.string().optional(),
    actions: z.array(z.record(z.unknown())).optional(),
    webhookEvents: z.array(z.record(z.unknown())).optional(),
    listenerEvents: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();
export type ActiveIntegration = z.infer<typeof ActiveIntegration>;

export const IntegrationConfigSummary = z
  .object({
    integrationKey: z.string(),
    enabled: z.boolean().optional(),
    displayName: z.string().optional(),
    configuredFields: z.array(z.string()).optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type IntegrationConfigSummary = z.infer<typeof IntegrationConfigSummary>;

/** Capture STATUS metadata only (ch05 session-connect). The captured Playwright storageState /
 *  cookies are SECRET, consumed in-memory by the automation engine (§5.6.7, invariant I2), and
 *  MUST NEVER be serialized to a client - so this nested shape is bounded to status metadata, not
 *  an open record that could carry the storageState. */
export const SessionSnapshot = z.object({
  status: z.enum(['none', 'waiting_login', 'captured', 'failed']),
  capturedAt: z.string().nullable().optional(),
  message: z.string().optional(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;

/** One per-action row of a session status: automation-binding STATUS metadata only (never
 *  session secrets — same bound as SessionSnapshot above). Not exported: exercised through
 *  SessionCaptureStatus by the contract suite. */
const SessionActionRow = z
  .object({
    actionName: z.string(),
    description: z.string().optional(),
    mutates: z.boolean().optional(),
    automationTemplate: z.string().nullable().optional(),
    automationId: z.string().nullable().optional(),
    automationName: z.string().nullable().optional(),
    provisioned: z.boolean().optional(),
  })
  .passthrough();

/** Capture-capability metadata for the dashboard's session-connect panel: whether this
 *  environment can run a capture at all, and the operator-facing message when it cannot. */
const SessionConnectInfo = z.object({
  supported: z.boolean(),
  available: z.boolean(),
  loginUrl: z.string().optional(),
  message: z.string().optional(),
});

export const SessionCaptureStatus = z
  .object({
    integrationKey: z.string().optional(),
    status: z.string(),
    sessionConnect: SessionConnectInfo.optional(),
    session: SessionSnapshot.optional(),
    actions: z.array(SessionActionRow).optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type SessionCaptureStatus = z.infer<typeof SessionCaptureStatus>;

export const IntegrationDefinitionListResponse = itemsResponse(IntegrationDefinition);
export type IntegrationDefinitionListResponse = z.infer<typeof IntegrationDefinitionListResponse>;

export const ActiveIntegrationListResponse = itemsResponse(ActiveIntegration);
export type ActiveIntegrationListResponse = z.infer<typeof ActiveIntegrationListResponse>;

export const IntegrationConfigListResponse = itemsResponse(IntegrationConfigSummary);
export type IntegrationConfigListResponse = z.infer<typeof IntegrationConfigListResponse>;

export const CreateConfigRequest = z.object({
  integrationKey: z.string(),
  configValues: z.record(z.unknown()),
});
export type CreateConfigRequest = z.infer<typeof CreateConfigRequest>;

export const UpdateConfigRequest = z.object({
  enabled: z.boolean().optional(),
  configValues: z.record(z.unknown()).optional(),
});
export type UpdateConfigRequest = z.infer<typeof UpdateConfigRequest>;

export const RefreshRegistryResponse = z.object({
  count: z.number().int().nonnegative(),
  keys: z.array(z.string()),
});
export type RefreshRegistryResponse = z.infer<typeof RefreshRegistryResponse>;

export const ConnectSessionResponse = z.object({
  started: z.boolean(),
  // Status metadata only (see SessionSnapshot) - never the captured storageState.
  session: z.object({
    status: z.enum(['waiting_login', 'failed']),
    message: z.string().optional(),
  }),
});
export type ConnectSessionResponse = z.infer<typeof ConnectSessionResponse>;

/** What the browser needs to open the Zoho consent popup. `state` is echoed for the caller's own
 *  correlation only - the server matches it against the row it stamped, never against this copy. */
export const ZohoOAuthConnectResponse = z.object({
  authUrl: z.string(),
  state: z.string(),
});
export type ZohoOAuthConnectResponse = z.infer<typeof ZohoOAuthConnectResponse>;

export const ProvisionAutomationsResponse = z.object({
  provisioned: z.boolean(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  actions: z.array(z.record(z.unknown())),
});
export type ProvisionAutomationsResponse = z.infer<typeof ProvisionAutomationsResponse>;

/* --- Definition sharing (slice E1) ---------------------------------------------------------- */

/**
 * The visibility a TENANT may set on its own integration definition. Deliberately a TWO-value
 * enum: `global` is the cross-org tier and a super-admin review gate, so the wire contract of the
 * tenant route cannot even EXPRESS "publish to every org" — a `{"visibility":"global"}` body is a
 * 400 at the schema, before any handler or store gate is consulted. The only route to `global` is
 * the separate super-admin toggle below.
 *
 * Declared here rather than reusing `common.ts`'s `Visibility` so the exclusion is local and
 * load-bearing: this contract must not widen because some other domain's sharing model gains a
 * tier.
 */
export const TenantDefinitionVisibility = z.enum(['private', 'org']);
export type TenantDefinitionVisibility = z.infer<typeof TenantDefinitionVisibility>;

/** The full three-tier visibility a definition can REPORT (the read side does include `global`). */
export const DefinitionVisibility = z.enum(['private', 'org', 'global']);
export type DefinitionVisibility = z.infer<typeof DefinitionVisibility>;

export const SetDefinitionVisibilityRequest = z.object({ visibility: TenantDefinitionVisibility });
export type SetDefinitionVisibilityRequest = z.infer<typeof SetDefinitionVisibilityRequest>;

export const SetDefinitionGlobalRequest = z.object({ global: z.boolean() });
export type SetDefinitionGlobalRequest = z.infer<typeof SetDefinitionGlobalRequest>;

/**
 * Both sharing writes answer the same echo: the house `ok` flag plus the visibility now stored.
 * The definition VIEW is deliberately NOT the response — the read projection drops the storage
 * envelope (`_id`, `orgId`, `userId`, `visibility`) on purpose, so it cannot report the one field
 * these routes change.
 */
export const DefinitionVisibilityResponse = z.object({
  ok: z.literal(true),
  visibility: DefinitionVisibility,
});
export type DefinitionVisibilityResponse = z.infer<typeof DefinitionVisibilityResponse>;

/* --- The PUBLISH DOORS (slice S6) ------------------------------------------------------------ */

/**
 * The ceiling on a publish-request note, in the units `String.length` and zod's `.max()` both count.
 *
 * Small on purpose. The note is one sentence of context for a platform reviewer ("this replaces the
 * old CRM package, the endpoints moved"), NOT a second lessons body - and unlike lessons it travels
 * OUT OF THE TENANT to a super-admin who is not a member of the org, so every character of it is a
 * character the author has to have meant to send.
 */
export const PUBLISH_REQUEST_NOTE_MAX_CHARS = 1_000;

/**
 * SUBMIT FOR REVIEW: the tenant asking the platform to publish its definition cross-org.
 *
 * `auth: 'user'` on both the submit and the withdraw, and the note is the only field: nothing here
 * names an org, a user or a definition other than the `:id` in the path, which the store resolves
 * under the verified actor.
 */
export const RequestDefinitionPublishRequest = z.object({
  note: z.string().max(PUBLISH_REQUEST_NOTE_MAX_CHARS).optional(),
});
export type RequestDefinitionPublishRequest = z.infer<typeof RequestDefinitionPublishRequest>;

/**
 * A live submission, as the AUTHORING ORG sees its own.
 *
 * `requestedBy` is a user id of the reader's own org here - the tenant routes only ever answer with
 * their own row. The cross-org REVIEW QUEUE below carries the same field deliberately: a reviewer
 * publishing another org's package to every tenant must be able to see who asked for it.
 */
export const IntegrationPublishRequest = z.object({
  requestedBy: z.string(),
  requestedAt: IsoTimestamp,
  /** Scrubbed by the route that mints it, and length-capped by the store that writes it. */
  note: z.string().optional(),
});
export type IntegrationPublishRequest = z.infer<typeof IntegrationPublishRequest>;

/** The echo both tenant routes answer with: `null` after a withdraw, the stamp after a submit. */
export const DefinitionPublishRequestResponse = z.object({
  ok: z.literal(true),
  publishRequest: IntegrationPublishRequest.nullable(),
});
export type DefinitionPublishRequestResponse = z.infer<typeof DefinitionPublishRequestResponse>;

/**
 * ONE row of the platform REVIEW QUEUE - a WHITELIST projection, emphatically not the document.
 *
 * The queue is the one surface where a super-admin who is NOT a member of the authoring org reads
 * something of that org's, so what it may carry is decided here rather than by a spread. It carries
 * ADDRESSING and PROVENANCE only: enough to find the row, know which org asked and decide whether to
 * open it. The BODIES are absent - no `skillMd`, no `lessons`, no `configSchema`, no action bodies -
 * and a reviewer reads those through `previewPublish`.
 *
 * THE ABSENCE OF BODIES IS NOT THE ABSENCE OF CONTENT, which this shape learned the hard way. `key`
 * and `displayName` ARE package fields: `packageConfigFromDoc` puts both in the published config and
 * `applyPublishFloor` walks both, so an integration named `CRM sk_live_…` published as
 * `CRM [REDACTED]` while this projection carried the literal key to another org's super-admin. The
 * route now builds every content field here off the publish FLOOR's output
 * (`api/src/routes/integrations.ts`, `publishQueueEntry`), so a field added to this schema later is
 * scrubbed because of WHERE the route reads it from rather than because someone remembered.
 *
 * WHAT IS CARRIED RAW, DELIBERATELY, IS IDENTITY: `orgId` and `requestedBy`. That is the queue's
 * reason to exist, and it is the one thing the PUBLISHED artifact withholds - the two surfaces
 * differ there on purpose and in opposite directions (publication is anonymous and permanent,
 * review is attributed and revocable).
 */
export const IntegrationPublishQueueEntry = z.object({
  /** The definition `_id` - what `previewPublish` and `publishDefinition` take in their path. */
  id: z.string(),
  /**
   * Floor-scrubbed, like `displayName`: both are package fields, and this crosses an org boundary.
   *
   * A `key` READING `[REDACTED]` IS A REFUSAL COMING, not cosmetics (S6 review round five). The
   * stored key is restored RAW on the cross-org read (`publishedViewOf` - a snapshot may not rename
   * the row it describes), so it is the one package field a snapshot cannot clean, and a key the
   * floor redacts would reach every consuming org verbatim. `publishDefinition` refuses such a row
   * outright, so what the reviewer sees here and what approving would do now agree: before this, the
   * queue showed `[REDACTED]` while the catalog of every other org showed the literal.
   */
  key: z.string(),
  displayName: z.string().optional(),
  /** The asking tenant. The point of the queue, and the reason it is super-admin only. */
  orgId: z.string(),
  /** How many actions the package declares. A size signal, never the actions themselves. */
  actionCount: z.number().int().nonnegative(),
  /**
   * True when THIS ROW already has a stored snapshot: publishing it supersedes that one wholesale
   * and stamps its provenance into `supersedes`.
   *
   * IT IS A FACT ABOUT THE ROW, AND IT IS NOT A FACT ABOUT THE KEY - which is exactly the confusion
   * `keyHeldBy` below exists to end (S6 review round five). It was tempting to re-derive this per
   * KEY instead; that was rejected, because the row-lineage meaning is the true and useful one (it is
   * what `supersedes` will record, and an un-published row awaiting re-review genuinely does have a
   * reviewed artifact to replace), and a per-key redefinition would have destroyed that signal to
   * carry a different one. The reviewer gets BOTH, separately, rather than one of them wearing the
   * other's name.
   */
  republish: z.boolean(),
  /**
   * The orgId of a DIFFERENT tenant that already holds this key at the `global` tier. Present only
   * on a collision, and its presence means APPROVING WILL BE REFUSED (`key-taken`, 409).
   *
   * Without it the reviewer was shown a clean row for a write no consumer could ever read:
   * `getForActor` resolves one global row per key, oldest first across all orgs, so a second org's
   * publication is written, stamped, reported 200 - and shadowed permanently by the incumbent. Both
   * signals above were correct about the row and silent about that.
   *
   * IDENTITY IS CARRIED HERE AND NOWHERE ELSE. This surface is attributed by design (see `orgId`
   * above), and the reviewer is the one person who can resolve a collision - they can demote the
   * incumbent. `previewPublish`, which an author reads, gets a bare boolean instead, because a
   * published package is anonymous by construction and must not become a way to learn who published
   * what.
   */
  keyHeldBy: z.string().optional(),
  requestedBy: z.string(),
  requestedAt: IsoTimestamp,
  /** Floor-scrubbed AGAIN on the way out - a different property from the submit route's scrub. That
   *  one keeps a credential out of the DATABASE; this keeps it out of ANOTHER ORG, whatever wrote
   *  the row (`requestPublish` stores the string it is given). */
  note: z.string().optional(),
});
export type IntegrationPublishQueueEntry = z.infer<typeof IntegrationPublishQueueEntry>;

export const IntegrationPublishQueueResponse = itemsResponse(IntegrationPublishQueueEntry);
export type IntegrationPublishQueueResponse = z.infer<typeof IntegrationPublishQueueResponse>;

/**
 * How the ONE chokepoint model pass went - the SECOND net over free text, after the deterministic
 * floor. `failed` (the model was asked and did not answer) is deliberately distinct from `skipped`
 * (a caller asked for floor-only): collapsing them would hide an outage behind a policy choice.
 *
 * A `failed` pass is NOT a failed publish. The floor is the control and is never conditional on a
 * model, so the artifact publishes with the degradation recorded on it - unless the caller asked for
 * the stricter posture with `requireModelPass`, in which case the publish refuses instead.
 */
export const IntegrationPublishModelPass = z.object({
  status: z.enum(['applied', 'skipped', 'failed']),
  reason: z.string().optional(),
  spansApplied: z.number().int().nonnegative().optional(),
});
export type IntegrationPublishModelPass = z.infer<typeof IntegrationPublishModelPass>;

/**
 * ONE redaction the scrub performed: WHERE and HOW MUCH, never WHAT.
 *
 * The removed text is deliberately absent from the wire shape - this response is served to a
 * platform super-admin previewing another org's row, and echoing the removed bytes back would make
 * the preview a brand-new way to read exactly the credential material the scrub just took out. The
 * author sees WHERE by reading `snapshot`, which shows `[REDACTED]` at that path.
 */
export const IntegrationPublishRedaction = z.object({
  path: z.string(),
  rule: z.enum(['credential-named-field', 'literal-secret-token', 'credential-line-literal', 'model-flagged']),
  source: z.enum(['floor', 'model']),
  removedChars: z.number().int().nonnegative(),
});
export type IntegrationPublishRedaction = z.infer<typeof IntegrationPublishRedaction>;

/**
 * The DRY RUN: exactly what a foreign org would read if this were published now.
 *
 * `snapshot` is byte-identical to what the write would store - preview and publish share one scrub
 * and neither adds anything to the content but the timestamp stamp. `config` is typed as an open
 * record because it is the canonical `IntegrationPackageConfig`, whose action shape is an open
 * superset the api owns; the CONTRACT here is that the preview and the write agree, and the shape
 * of what they agree on is the package shape.
 */
export const PublishPreviewResponse = z.object({
  ok: z.literal(true),
  snapshot: z.object({
    config: z.record(z.unknown()),
    skillMd: z.string(),
    lessons: z.string().optional(),
  }),
  redactions: z.array(IntegrationPublishRedaction),
  modelPass: IntegrationPublishModelPass,
  /** The stamp of the snapshot this publish would replace. Absent ⇒ this is a first publication.
   *  THIS ROW's lineage; it says nothing about who holds the key - see the flag below. */
  supersedes: z.object({ scrubbedAt: IsoTimestamp, scrubbedBy: z.string() }).optional(),
  /**
   * Present (and always `true`) when ANOTHER org already holds this key at the `global` tier - in
   * which case `snapshot` above is NOT "what a foreign org would read", because no foreign org would
   * read anything of this row, and the publish will be refused with 409.
   *
   * A BARE FLAG, never the holder's orgId: an author may read this response, and a published package
   * is anonymous by construction (`publishableAuthoringOf` drops the author, and a fork does not
   * record its source org). Knowing the key is taken is what an author needs in order to rename it;
   * knowing WHO took it is the reviewer's business, and it is carried on the review queue instead.
   */
  keyHeldByAnotherOrg: z.literal(true).optional(),
});
export type PublishPreviewResponse = z.infer<typeof PublishPreviewResponse>;

/**
 * `requireModelPass` is the STRICTER posture, opt-in per call: refuse the publish when the second
 * net did not run, instead of publishing the floor result with the degradation recorded on it. The
 * default (absent ⇒ false) is the standing decision journaled 2026-08-03, restated on the wire so a
 * reviewer can take the stricter one without a redeploy.
 */
export const PublishDefinitionRequest = z.object({
  requireModelPass: z.boolean().optional(),
});
export type PublishDefinitionRequest = z.infer<typeof PublishDefinitionRequest>;

/**
 * The publication receipt. `visibility` is read off the PERSISTED document, never off the request,
 * so the response can only ever report the state that really landed.
 *
 * `supersedes` present ⇒ this publish REPLACED a live snapshot wholesale (there is exactly one
 * snapshot field per definition, so re-publish is total replacement, and this is the lineage of what
 * it replaced). Tenant copies are unaffected: a consuming org that extended the package forked its
 * own row at that moment and reads its own.
 */
export const PublishDefinitionResponse = z.object({
  ok: z.literal(true),
  visibility: DefinitionVisibility,
  scrubbedAt: IsoTimestamp,
  redactionCount: z.number().int().nonnegative(),
  modelPass: IntegrationPublishModelPass,
  supersedes: z.object({ scrubbedAt: IsoTimestamp, scrubbedBy: z.string() }).optional(),
});
export type PublishDefinitionResponse = z.infer<typeof PublishDefinitionResponse>;

/* --- The write gate (slice C2) --------------------------------------------------------------- */

/**
 * A human's answer to "may this action write on my behalf".
 *
 *   `once`   — this run only. Single-use and short-lived: the next execution CLAIMS it (atomically
 *              deleting it), so it can never authorise a second write.
 *   `always` — a standing approval, 90 days, revocable.
 *
 * There is deliberately no `never`: refusing is simply not approving, and a persisted "no" would be
 * a second thing to expire, revoke and reason about for no behavioural gain.
 */
export const IntegrationActionApprovalDecision = z.enum(['once', 'always']);
export type IntegrationActionApprovalDecision = z.infer<typeof IntegrationActionApprovalDecision>;

/**
 * The per-action approval row the dashboard renders. `shape` is the fingerprint of the action's
 * executable content (method + URL + templates, or the bound automation): it is what an approval is
 * keyed on, so re-authoring an action does not inherit the approval given to the old one — and it
 * is what the client must echo back when the user confirms, so an approval can only ever be banked
 * for the shape the human was actually shown.
 */
export const IntegrationActionApproval = z.object({
  actionName: z.string(),
  description: z.string(),
  /** Human-readable statement of what runs, e.g. `POST https://slack.com/api/chat.postMessage`. */
  target: z.string(),
  shape: z.string(),
  /** Whether this action is gated at all. Fail-closed: anything but a literal `mutates:false`. */
  requiresConsent: z.boolean(),
  /** The live decision covering THIS shape, or null when the action still needs an answer. */
  decision: IntegrationActionApprovalDecision.nullable(),
  expiresAt: IsoTimestamp.nullable(),
});
export type IntegrationActionApproval = z.infer<typeof IntegrationActionApproval>;

export const IntegrationActionApprovalListResponse = itemsResponse(IntegrationActionApproval);
export type IntegrationActionApprovalListResponse = z.infer<typeof IntegrationActionApprovalListResponse>;

/**
 * `shape` is REQUIRED, and it is the anti-TOCTOU half of this endpoint: the server refuses an
 * approval whose shape no longer matches the stored action. Same reasoning as the automations
 * domain's `ConsentRequest` carrying the command shape — without it a caller could bank an approval
 * for a shape the user never saw, which is the inverse of consent.
 */
export const ApproveIntegrationActionRequest = z.object({
  decision: IntegrationActionApprovalDecision,
  shape: z.string(),
});
export type ApproveIntegrationActionRequest = z.infer<typeof ApproveIntegrationActionRequest>;

export const ApproveIntegrationActionResponse = z.object({
  ok: z.literal(true),
  decision: IntegrationActionApprovalDecision,
  expiresAt: IsoTimestamp,
});
export type ApproveIntegrationActionResponse = z.infer<typeof ApproveIntegrationActionResponse>;

export const RevokeIntegrationActionApprovalResponse = z.object({
  ok: z.literal(true),
  /** How many approval rows were removed — every decision and every past shape (see the route). */
  revoked: z.number().int().nonnegative(),
});
export type RevokeIntegrationActionApprovalResponse = z.infer<typeof RevokeIntegrationActionApprovalResponse>;

/* --- LEARNED REPLAY RECIPES (slice P2) ------------------------------------------------------- */

/**
 * ONE action's compiled recipe, as its OWNER sees it - a summary, deliberately not the document.
 *
 * WHY THIS SURFACE EXISTS AT ALL. A recipe is learned by the machine, from one pass, with no human
 * in the loop, and it then answers that action on every later run. Three of its failure modes clear
 * themselves because the replay visibly REFUSES (the write gate, the two coverage refusals) - but a
 * recipe that keeps answering `ok` and answers WRONGLY has no such exit: `putRecipe` refuses to
 * overwrite by design, a supersede needs a drift that cannot fire while the calls keep returning
 * 200 with an unchanged shape, and nothing expires it. Without a control the owner can neither see
 * such a recipe nor remove it. So: this read, and the delete below.
 *
 * WHAT IS AND IS NOT ON IT. `calls` is `METHOD urlTemplate` per replayed call, in the recipe's own
 * order - enough to recognise a recipe that learned the wrong endpoint, which is the whole point.
 * There are no header names, no body templates and no `capturedCallsRef`: the first two are the
 * shape of a request the owner did not author, and the third is a pointer into raw evidence with its
 * own lifecycle. A recipe carries no VALUES at all (`recipe-store.assertCarriesNoValues` refuses one
 * that does, at the write), so nothing here can be a credential.
 */
export const IntegrationActionRecipeSummary = z.object({
  key: z.string(),
  actionName: z.string(),
  /** Monotonic, store-owned. `> 1` means this recipe replaced an earlier one - see `supersedes`. */
  version: z.number().int().positive(),
  compiledAt: IsoTimestamp,
  /** `GET https://portal.example/api/cases?ref={{input.ref}}`, one per replayed call, in order. */
  calls: z.array(z.string()),
  /**
   * Index into `calls` of the one whose body becomes this action's ANSWER. ABSENT means the run it
   * was learned from answered nothing structured, so the replay answers nothing either - which is
   * every browser-only automation, and is the honest reproduction rather than a gap.
   */
  answersWithCallIndex: z.number().int().nonnegative().optional(),
  lessons: z.array(z.string()),
  /** One-hop lineage: which version this replaced and why (a drift the self-heal acted on). */
  supersedes: z.object({ version: z.number().int().positive(), reason: z.string() }).optional(),
});
export type IntegrationActionRecipeSummary = z.infer<typeof IntegrationActionRecipeSummary>;

export const IntegrationRecipeListResponse = itemsResponse(IntegrationActionRecipeSummary);
export type IntegrationRecipeListResponse = z.infer<typeof IntegrationRecipeListResponse>;

/**
 * IDEMPOTENT BY CONTRACT. Clearing an action that has no recipe is `ok` with no `version`, never a
 * 404: the caller asked for a state ("this action has not learned anything") and that state holds.
 * `evidenceDiscarded` counts the raw captured calls that went with it - a recipe is the only index
 * back into that collection, so the two are removed together or the evidence is orphaned forever.
 */
export const ForgetIntegrationRecipeResponse = z.object({
  ok: z.literal(true),
  /** The version that was dropped. Absent ⇒ there was nothing to clear. */
  version: z.number().int().positive().optional(),
  evidenceDiscarded: z.number().int().nonnegative(),
});
export type ForgetIntegrationRecipeResponse = z.infer<typeof ForgetIntegrationRecipeResponse>;

/* --- Per-integration LESSONS (slice C3) ------------------------------------------------------ */

/**
 * The ceiling on a lessons body, in the units `String.length` and zod's `.max()` both count.
 * ONE constant: the wire refusal, the api seam's own check and the dashboard's character counter
 * all read it, because a limit that lives in two places eventually disagrees — and the surface
 * that disagreed would be the one that silently truncates somebody's notes.
 *
 * 20k characters (~5k tokens) is generous for accumulated prose and bounded enough that an
 * integration's lessons cannot quietly become the dominant cost of every run that loads it.
 */
export const INTEGRATION_LESSONS_MAX_CHARS = 20_000;

/**
 * What an integration's lessons look like to a caller.
 *
 * `editable` is the honest statement of WHICH view was served. Lessons are free text a human
 * writes AND text that reaches a model prompt, so the api keeps two views: the BYTE-EXACT one for
 * the principals who may save the definition (otherwise an edit cycle round-trips a redaction into
 * stored documentation — A3 review F3), and the SCRUBBED one for everyone else (A2 review F7). A
 * client must not offer an edit over a `false`: the write would be refused.
 *
 * `updatedAt` is the optimistic-concurrency token, echoed back on a write.
 */
export const IntegrationLessonsView = z.object({
  key: z.string(),
  lessons: z.string(),
  editable: z.boolean(),
  updatedAt: IsoTimestamp,
});
export type IntegrationLessonsView = z.infer<typeof IntegrationLessonsView>;

/**
 * `lessons` is bounded AT THE SCHEMA, so an over-length body is a 400 before any handler runs and
 * the refusal cannot be forgotten by a second caller. Nothing anywhere trims: a truncated note is
 * worse than a rejected one, because the author believes it was recorded.
 *
 * `expectedUpdatedAt` is OPTIONAL and its absence means something specific — "overwrite whatever
 * is stored". Present, it is the row revision the editor loaded, and a mismatch is refused with
 * the current text rather than clobbered.
 */
export const SetIntegrationLessonsRequest = z.object({
  lessons: z.string().max(INTEGRATION_LESSONS_MAX_CHARS),
  expectedUpdatedAt: IsoTimestamp.optional(),
});
export type SetIntegrationLessonsRequest = z.infer<typeof SetIntegrationLessonsRequest>;

/* --- The PUBLIC capability surface (slice D1) ------------------------------------------------ */

/**
 * Path params of the two capability routes. Declared so two facts are CONTRACTUAL rather than
 * only implemented: a segment has a shape, and a malformed one is a 400 rather than a 404
 * (descriptor.ts `params`). Deliberately permissive — a grammar stricter than the store's own
 * would turn a legitimately-named authored integration into a 400 it can never recover from —
 * but BOUNDED, because these segments are echoed into audit metadata.
 */
export const IntegrationKeyParams = z.object({ key: z.string().min(1).max(120) });
export type IntegrationKeyParams = z.infer<typeof IntegrationKeyParams>;

export const IntegrationActionParams = z.object({
  key: z.string().min(1).max(120),
  actionName: z.string().min(1).max(120),
});
export type IntegrationActionParams = z.infer<typeof IntegrationActionParams>;

/**
 * What a capability client needs to know about ONE action in order to call it — the facts the
 * definition's own `actions[]` record cannot carry because they are derived, per-caller, or both.
 *
 * WHY THIS IS A SIBLING OF THE DEFINITION AND NOT A SECOND COPY OF IT. The definition (with its
 * `httpConfig`, `argsSchema`, `returnSchema`) rides on `integration` below, projected by the ONE
 * registry projection every other read uses. Nothing here re-states it. What is here is:
 *   - `backingType`/`transport` — HOW it runs, resolved once by the executor's own resolver
 *     (`resolveBackingType`), never re-derived by a client from the action's shape;
 *   - `target` — WHERE it writes, in the words the consent dialog shows a human;
 *   - `shape` — the approval fingerprint, so a client that hits the write gate can hand the user
 *     the exact token `POST …/approval` demands (that route is `auth: 'user'` — see below);
 *   - `requiresApproval` — the FAIL-CLOSED reading of `mutates` (only a literal `false` is a read),
 *     which is the executor's rule and not something a client should re-implement off the raw field;
 *   - `approved` — whether a live approval of the CALLER's own already covers this exact shape.
 *
 * `approved` is ADVISORY and says so: the gate is re-evaluated inside the executor at call time (a
 * `once` approval is CLAIMED there, atomically), so `true` here is "no prompt is pending as of this
 * read", never a promise that the next execute will run.
 */
export const IntegrationCapabilityAction = z.object({
  actionName: z.string(),
  description: z.string(),
  /** `api-call | bash-cli | browser-steps`, or `invalid` for a package that contradicts itself. */
  backingType: z.string(),
  /** Wire protocol the action needs; `http` unless the package declares otherwise. */
  transport: z.string(),
  /** Human-readable destination, e.g. `POST https://slack.com/api/chat.postMessage`. */
  target: z.string(),
  /** Fingerprint of the action's executable content — the token an approval is keyed on. */
  shape: z.string(),
  requiresApproval: z.boolean(),
  /** Advisory (see above): a live approval of the caller's covers this exact shape right now. */
  approved: z.boolean(),
  /**
   * WHO WROTE THIS ACTION (slice D3), because a caller deciding whether to invoke something should
   * know whether a person ever looked at it.
   *
   *   `none`        — a human did: a shipped package, a builder save, a legacy import. Behaves
   *                   exactly as it always has (Rule 7).
   *   `provisional` — the platform authored it through `achieve` and nobody has confirmed it. It
   *                   is stored as a WRITE whatever it claimed, so `requiresApproval` is true for
   *                   it even if it only reads, and `achieve` refuses to run it.
   *   `trusted`     — a person who may write the definition promoted it (`POST …/trust`).
   *
   * Additive and optional so every existing client keeps parsing (Rule 7); a client that does not
   * read it is not misled by it, because the gate is `requiresApproval` either way.
   */
  authoringState: z.enum(['none', 'provisional', 'trusted']).optional(),
});
export type IntegrationCapabilityAction = z.infer<typeof IntegrationCapabilityAction>;

/**
 * The capability view of one integration: the definition exactly as the list emits it, plus the
 * per-action execution metadata and whether this caller can actually reach a credential.
 *
 * `integration` is the SAME `IntegrationDefinition` projection `GET /api/v1/integrations` returns —
 * one projection, not a second one that could drift from it (Rule 1). That projection is where the
 * tenancy rules live: it drops the storage envelope, reveals `id`/`visibility` only for a row of
 * the caller's OWN org, and runs the secret-redaction pass on both tiers, so a cross-org `global`
 * row never tells the reader which org authored it.
 */
export const IntegrationCapability = z.object({
  integration: IntegrationDefinition,
  /**
   * Can an execute reach a credential today? Mirrors the executor's own two checks exactly
   * (`not_connected` / `disabled`): a config that exists and is enabled, or an integration whose
   * `authType` is `none` and needs no config at all.
   */
  connected: z.boolean(),
  actions: z.array(IntegrationCapabilityAction),
});
export type IntegrationCapability = z.infer<typeof IntegrationCapability>;

/**
 * Execute request. `args` and NOTHING ELSE — there is deliberately no field naming an org, a user,
 * an owner or a credential. Tenancy comes from the verified principal and only from it (Rule 5),
 * and because zod strips unknown keys a body that invents `orgId` is silently inert rather than
 * influential. The same reasoning as the knowledge/memvault capability requests.
 */
export const ExecuteIntegrationActionRequest = z.object({
  args: z.record(z.unknown()).optional(),
});
export type ExecuteIntegrationActionRequest = z.infer<typeof ExecuteIntegrationActionRequest>;

/**
 * Execute response — the OUTCOME of a call that was addressed correctly and permitted.
 *
 * THE SPLIT, stated because a client's error handling depends on it:
 *   - the request could not be ADDRESSED (unknown/invisible integration or action) -> 404 envelope;
 *   - the request was not PERMITTED (a `mutates` action with no live human approval) -> 403
 *     envelope carrying `details.code = 'awaiting_consent'` and `details.consentRequest`;
 *   - anything else -> 200 and THIS body, including a failed outcome. A remote 500, a locked
 *     credential, a disabled integration and a transport timeout are results of the routed call,
 *     not failures of Cortex, and they are exactly what the other three rails (automation step,
 *     listener tick, agent tool) already receive as a result object. One vocabulary, four rails.
 *
 * `data` is the action's own result (the upstream body, or the automation's output), already
 * deep-redacted of the caller's credential values by the executor. The executor's request/response
 * DUMP is deliberately absent: it is an operator-facing diagnostic, not part of a public contract.
 */
export const ExecuteIntegrationActionResponse = z.object({
  success: z.boolean(),
  /** Upstream HTTP status, for an `api-call` action that reached the remote. */
  status: z.number().int().optional(),
  data: z.unknown().optional(),
  /** Machine-readable outcome token when `success` is false (the executor's own vocabulary). */
  code: z.string().optional(),
  /** Human-readable failure message, credential-redacted. */
  error: z.string().optional(),
});
export type ExecuteIntegrationActionResponse = z.infer<typeof ExecuteIntegrationActionResponse>;

/**
 * What a human must be shown to answer the write gate. Rides inside the 403's `details` rather
 * than in a 2xx body: nothing executed, so there is no result to carry it. Declared here so a
 * client (and the contract suite) can type the refusal instead of reading loose strings.
 */
export const IntegrationActionConsentRequest = z.object({
  integrationKey: z.string(),
  actionName: z.string(),
  description: z.string(),
  target: z.string(),
  shape: z.string(),
});
export type IntegrationActionConsentRequest = z.infer<typeof IntegrationActionConsentRequest>;

/* --- `achieve`: EXECUTE-OR-AUTHOR (slice D3) -------------------------------------------------- */

/**
 * A goal, in the caller's own words, scoped to ONE integration.
 *
 * WHY THE SCOPE IS AN INTEGRATION AND NOT THE WHOLE CATALOG: everything that makes this capability
 * safe is a property of one integration — whose credential is spent, which hosts that credential is
 * bound to, whose definition governs it, which tenant's copy an authored action lands in. A
 * catalog-wide `achieve` would have to pick the integration BEFORE any of those questions has an
 * answer, and the picking would be the least constrained part of the call.
 *
 * `args` are the arguments for the action that ends up running. They are passed through to the
 * executor unchanged and, like every other capability request, name no org, user or owner.
 */
export const AchieveIntegrationGoalRequest = z.object({
  goal: z.string().min(1).max(2000),
  args: z.record(z.unknown()).optional(),
});
export type AchieveIntegrationGoalRequest = z.infer<typeof AchieveIntegrationGoalRequest>;

/** One deterministic guardrail an authored action was judged against. `detail` describes the SHAPE
 *  problem (a host, a template variable, a name), never any content of the caller's credentials. */
export const AuthoredActionCheck = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string().optional(),
});
export type AuthoredActionCheck = z.infer<typeof AuthoredActionCheck>;

/**
 * The frozen verdict of the whole guardrail suite. Returned because a caller being handed a NEW
 * action deserves to see what was actually checked before it was stored — and because "which
 * checks did this pass, and when" is a property of the artifact, not of the request.
 */
export const AuthoredActionVerification = z.object({
  verifiedAt: IsoTimestamp,
  passed: z.boolean(),
  checks: z.array(AuthoredActionCheck),
});
export type AuthoredActionVerification = z.infer<typeof AuthoredActionVerification>;

/**
 * THE REUSE LADDER, as a value on the wire.
 *
 * `achieve` answers on one of four rungs - reuse an action as it stands, PARAMETRIZE it (fill
 * arguments it declares that the caller left out), COMPOSE (run a read and narrow its rows against
 * one of the caller's own collections), or MINT a new action. A client reading only `outcome`
 * cannot tell which rung answered, nor what the ones above it decided, and "why did it not
 * parametrize" is the first question anybody asks of a rung that quietly did not fire.
 *
 * `skipped` and `refused` are DIFFERENT and the difference is the Rule-7 promise: a skipped rung
 * did not apply (nothing was missing, no seam is wired, the model was unreachable, the goal asked
 * for nothing extra) and the call behaved exactly as it did before the ladder existed. A refused
 * rung ran, got an answer, and the deterministic suite rejected it.
 */
export const AchieveRung = z.enum(['reuse', 'parametrize', 'compose', 'mint']);
export type AchieveRung = z.infer<typeof AchieveRung>;

export const AchieveLadderStep = z.object({
  rung: AchieveRung,
  verdict: z.enum(['taken', 'skipped', 'refused']),
  detail: z.string().optional(),
});
export type AchieveLadderStep = z.infer<typeof AchieveLadderStep>;

/**
 * WHAT A COMPOSED ANSWER WAS BUILT FROM, in full, because a caller handed a narrowed list is owed
 * the narrowing. Names and counts only: which collection, which field compared how, how many rows
 * each side contributed. No row and no compared VALUE from anybody's data travels here - the value
 * is the model's, but the rows it selected are the tenant's.
 */
export const AchieveComposition = z.object({
  collection: z.string(),
  where: z.object({
    field: z.string(),
    op: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'starts_with', 'ends_with']),
    value: z.unknown(),
  }),
  join: z.object({ resultField: z.string(), collectionField: z.string() }),
  /** Rows the ACTION returned. */
  scanned: z.number(),
  /** Collection rows that satisfied the predicate. */
  matchedCollectionRows: z.number(),
  /** Action rows that survived the join - may exceed `items.length` when `truncated`. */
  matched: z.number(),
  truncated: z.boolean(),
});
export type AchieveComposition = z.infer<typeof AchieveComposition>;

/**
 * What `achieve` did. FOUR outcomes, and the split matters to a client's control flow:
 *
 *   `executed` — an existing TRUSTED action satisfied the goal and was run through the same gated
 *                executor every other rail uses. `result` is the ordinary execute body, including a
 *                failed one (a remote 500 is an answer about the remote system).
 *   `composed` - a trusted READ was run and its rows narrowed against one of the caller's own
 *                collections. NOTHING WAS MINTED and nothing was written: `items` is a subset of
 *                what the action itself returned, and `composition` says exactly how it was
 *                narrowed. Only ever reachable for an action whose `mutates` is a literal `false`.
 *   `authored` — nothing satisfied it, so one action was written, VERIFIED and persisted as
 *                PROVISIONAL. It has NOT run and cannot run yet: `requiresApproval` is always true
 *                for it, and a person must promote it (`POST …/trust`) before `achieve` will pick
 *                it. `forked` says the action landed in a fresh COPY of a globally-published
 *                integration, in the caller's own tenant.
 *   `refused`   — the call was addressed and admitted and then declined, with a machine-readable
 *                `code`. Distinct from a 404 (not addressable) and from a 403 write-gate refusal
 *                (which is the same `awaiting_consent` envelope the execute endpoint returns, so a
 *                client handles the gate in ONE place rather than two).
 *
 * RULE 7: `composed` and the four optional fields below are ADDITIVE. Every field an older client
 * reads is produced exactly as it was, on exactly the outcomes it was produced on before.
 */
export const AchieveIntegrationGoalResponse = z.object({
  outcome: z.enum(['executed', 'composed', 'authored', 'refused']),
  /** The action that ran, or the action that was written. Absent on a refusal. */
  actionName: z.string().optional(),
  /** `executed` only — the same body `POST …/execute` returns. */
  result: ExecuteIntegrationActionResponse.optional(),
  /** `authored` only. Always `provisional`: this endpoint cannot mint a trusted action. */
  state: z.literal('provisional').optional(),
  forked: z.boolean().optional(),
  verification: AuthoredActionVerification.optional(),
  requiresApproval: z.literal(true).optional(),
  /** `refused` only — the machine-readable reason and its human-readable statement. */
  code: z.string().optional(),
  message: z.string().optional(),
  /** `verification_failed` — the guardrails that were not met, in words a caller can act on. */
  violations: z.array(z.string()).optional(),
  /** `ambiguous_goal` / `provisional_match` - the actions the goal could have meant. */
  candidates: z.array(z.string()).optional(),
  /** `composed` only - the rows that survived the narrowing, capped. */
  items: z.array(z.record(z.unknown())).optional(),
  /** `composed` only - how they were narrowed. */
  composition: AchieveComposition.optional(),
  /** Which rung answered, and what the ones above it decided. Present on every outcome the ladder
   *  reached; absent on the refusals that happen before a rung is entered at all. */
  ladder: z.array(AchieveLadderStep).optional(),
  /** `executed` / `composed` - the argument NAMES a model supplied because the caller left them
   *  out. Names only: the values are in the request that was sent, and this is not a second copy
   *  of them. */
  filledArgs: z.array(z.string()).optional(),
});
export type AchieveIntegrationGoalResponse = z.infer<typeof AchieveIntegrationGoalResponse>;

/**
 * `shape` is REQUIRED for the same reason `ApproveIntegrationActionRequest` requires it: the human
 * confirms the action they were SHOWN. If it was re-authored between the render and the click, the
 * answer is about a different action and the promotion is refused.
 */
export const TrustAuthoredActionRequest = z.object({ shape: z.string() });
export type TrustAuthoredActionRequest = z.infer<typeof TrustAuthoredActionRequest>;

export const TrustAuthoredActionResponse = z.object({
  ok: z.literal(true),
  actionName: z.string(),
  state: z.literal('trusted'),
  /** The action's `mutates` NOW — the value the draft declared, which promotion is what enables.
   *  A `true` here means the action still meets the write gate on every run; a `false` means it is
   *  a read and will auto-run, which is precisely what the person just took responsibility for. */
  mutates: z.boolean(),
});
export type TrustAuthoredActionResponse = z.infer<typeof TrustAuthoredActionResponse>;

/**
 * THE OWNER'S ERASURE CONTROL over their own action evidence (slice S1).
 *
 * IDEMPOTENT BY CONTRACT, on `ForgetIntegrationRecipeResponse`'s reading: erasing a sample that is
 * not there answers `ok` with `discarded: false`, never a 404. The caller asked for a STATE — "this
 * action holds no sample of my third-party account" — and that state holds either way. A 404 would
 * additionally be an existence oracle over whether a colleague has ever run the action.
 */
export const DiscardActionEvidenceResponse = z.object({
  ok: z.literal(true),
  /** True when a row was actually removed; false means there was nothing of the CALLER'S to remove. */
  discarded: z.boolean(),
});
export type DiscardActionEvidenceResponse = z.infer<typeof DiscardActionEvidenceResponse>;

export const integrationsEndpoints = {
  /**
   * The definition list — the CAPABILITY DISCOVERY endpoint since D1.
   *
   * THE FLIP: `user` -> `user-or-key`. Additive in the strict sense (Rule 7): the body is the same
   * `{ items: IntegrationDefinition[] }` the dashboard has always read, produced by the same
   * tenant-scoped `listDefinitionsFor(actor)` under the same actor. A platform JWT reaches it
   * byte-identically (`requireUserOrApiKey` delegates to `requireAuth` untouched); what changed is
   * that a per-user gateway key now reaches it too, so an outside client can DISCOVER which
   * integrations its user has before calling `getIntegration`/`executeAction` below.
   *
   * Flipping an auth class adds no descriptor, so the schema-coverage pin is untouched by it — but
   * it DOES publish this endpoint into `docs/openapi/cortex.v1.json`, which is the whole point:
   * the spec is definitionally the key-reachable surface.
   */
  list: {
    method: 'GET',
    path: '/api/v1/integrations',
    auth: 'user-or-key',
    response: IntegrationDefinitionListResponse,
  },
  listActive: {
    method: 'GET',
    path: '/api/v1/integrations/active',
    auth: 'user',
    response: ActiveIntegrationListResponse,
  },
  listConfigs: {
    method: 'GET',
    path: '/api/v1/integrations/configs',
    auth: 'user',
    response: IntegrationConfigListResponse,
  },
  createConfig: {
    method: 'POST',
    path: '/api/v1/integrations/configs',
    auth: 'user',
    request: CreateConfigRequest,
    response: IntegrationConfigSummary,
    // CONNECT-OR-RE-SAVE: this is the dashboard's single save action, so it upserts - 201 when it
    // connects the integration, 200 when it updates the config that already exists (merging into
    // the stored credentials). Both were previously undeclared; the 201 was already being sent.
    successStatus: [201, 200],
  },
  updateConfig: {
    method: 'PATCH',
    path: '/api/v1/integrations/configs/:integrationKey',
    auth: 'user',
    request: UpdateConfigRequest,
    response: IntegrationConfigSummary,
  },
  deleteSkill: {
    method: 'DELETE',
    path: '/api/v1/integrations/:key',
    auth: 'user',
    response: OkResponse,
  },
  refresh: {
    method: 'POST',
    path: '/api/v1/integrations/refresh',
    auth: 'org-admin',
    response: RefreshRegistryResponse,
  },
  sessionStatus: {
    method: 'GET',
    path: '/api/v1/integrations/:key/session',
    auth: 'user',
    response: SessionCaptureStatus,
  },
  connectSession: {
    method: 'POST',
    path: '/api/v1/integrations/:key/session',
    auth: 'user',
    response: ConnectSessionResponse,
  },
  /**
   * Start the Zoho Sign OAuth popup connect. Org-admin: completing it re-points the whole
   * workspace's e-signature at the platform's OAuth client. The browser opens `authUrl`; the
   * callback (`GET /api/v1/oauth/zoho/callback`, a public provider redirect, not a client call)
   * writes the grant and postMessages the result back to the opener.
   */
  zohoOAuthConnect: {
    method: 'POST',
    path: '/api/v1/integrations/zoho-sign/oauth/connect',
    auth: 'org-admin',
    response: ZohoOAuthConnectResponse,
  },
  provisionAutomations: {
    method: 'POST',
    path: '/api/v1/integrations/:key/provision-automations',
    auth: 'user',
    response: ProvisionAutomationsResponse,
  },
  /**
   * The TENANT sharing surface: an owner (or their org-admin) flips their own definition between
   * `private` and `org`. `auth: 'user'` and NOT `user-or-key` on purpose — an agent holding a
   * gateway key must never be able to re-gate a tenant's sharing on the tenant's behalf.
   */
  setVisibility: {
    method: 'PATCH',
    path: '/api/v1/integrations/definitions/:id/visibility',
    auth: 'user',
    request: SetDefinitionVisibilityRequest,
    response: DefinitionVisibilityResponse,
  },
  /**
   * The cross-org `global` tier — the human review gate. `auth: 'super-admin'` matches the route's
   * `requireRole('super-admin')` mount and the `artifacts.setFeatured` precedent (the other
   * super-admin-only publish toggle). Not `user-or-key`: a key-bearing agent can never publish a
   * definition to every org.
   *
   * `{global:true}` IS `publishDefinition` (2026-08-20, S6 review MAJOR-2), not a tier flag. It was a
   * bare `setVisibility(..., 'global')`, which moved a row across the org boundary while writing NO
   * `publishedSnapshot` - so consuming orgs read the author's LIVE row through the read-time floor,
   * with no chokepoint model pass, nothing frozen and no `scrubbedAt`/`scrubbedBy`/`scrubVersion`
   * provenance. It now runs the same scrub-and-snapshot write as `publishDefinition` below, so ONE
   * path crosses the boundary and it always leaves an artifact. Callers see no change in the REQUEST
   * or the RESPONSE - this descriptor is byte-identical, which is why the change is additive under
   * Rule 7 - but the call now costs a chokepoint model pass and writes a snapshot.
   *
   * IT IS STILL IDEMPOTENT (S6 review round four). On a row that is already `global` AND already
   * holds a snapshot, `{global:true}` changes nothing and answers the tier: this door is a toggle,
   * and a retry must not replace a reviewed artifact in every org with an unreviewed re-scrub. A
   * deliberate re-publish is `publishDefinition`, whose response IS the snapshot stamp. A `global`
   * row with no snapshot is still published here, because that is the state the fold exists to end.
   *
   * `{global:false}` is unchanged: the un-publish, landing on `org`, writing no snapshot.
   */
  setGlobal: {
    method: 'POST',
    path: '/api/v1/integrations/definitions/:id/global',
    auth: 'super-admin',
    request: SetDefinitionGlobalRequest,
    response: DefinitionVisibilityResponse,
  },
  /* --- The PUBLISH DOORS (slice S6) --------------------------------------------------------- */

  /**
   * THE FIVE DOORS ONTO THE PUBLISH MECHANISM, and why NOT ONE OF THEM IS `user-or-key`.
   *
   * `setGlobal` above states the rule this family inherits: a key-bearing agent must never publish
   * a definition to every org. That covers the two super-admin doors trivially. It covers the three
   * `user` ones for the reason C2's consent descriptors and C3's lessons are `user`:
   *
   *  - `requestPublish` writes free text (`note`) that a platform reviewer then reads while deciding
   *    to promote a package to every tenant. An agent that could write it could argue for its own
   *    promotion in the reviewer's own words;
   *  - `withdrawPublish` closes the review window, and the record that the org ever asked. That is
   *    the tenant's own decision, taken by a person;
   *  - `previewPublish` renders the tenant's row through the scrub. It reveals strictly less than
   *    the raw row its admission set can already read - but its admission set is JWT principals,
   *    and a gateway key is not one of them.
   *
   * Narrow is the reversible direction: widening an auth class later is additive (Rule 7).
   *
   * ADMISSION IS TWO LAYERS AND THEY ARE NOT THE SAME. The `auth` class here is what the ROUTE
   * mounts; the row-level gate is the store's (`canWriteDefinition` for submit/withdraw/preview,
   * `visibilityWriteVerdict` for the publish) and this contract adds no authority over it. In
   * particular `previewPublish` is `user` while its module gate admits an owner, their org-admin, or
   * a super-admin who can SEE the row - which, for a non-member super-admin, is true only while the
   * org's submission stands. That is the E2 review window, and it is the whole reason the queue is
   * reachable at all.
   */
  requestPublish: {
    method: 'POST',
    path: '/api/v1/integrations/definitions/:id/publish-request',
    auth: 'user',
    request: RequestDefinitionPublishRequest,
    response: DefinitionPublishRequestResponse,
  },
  withdrawPublish: {
    method: 'DELETE',
    path: '/api/v1/integrations/definitions/:id/publish-request',
    auth: 'user',
    response: DefinitionPublishRequestResponse,
  },
  /**
   * THE REVIEW QUEUE - every `org` row whose tenant has asked to publish it, across every org.
   *
   * A LITERAL PATH THAT MUST OUTRANK `:id`. It shares the `/definitions` prefix with the four
   * `/:id/...` routes, so the router registers it FIRST; see the ordering note at the top of
   * `api/src/routes/integrations.ts`.
   *
   * Its entries are a whitelist projection with no content on them (`IntegrationPublishQueueEntry`).
   */
  listPublishRequests: {
    method: 'GET',
    path: '/api/v1/integrations/definitions/publish-requests',
    auth: 'super-admin',
    response: IntegrationPublishQueueResponse,
  },
  /**
   * THE DRY RUN. A POST rather than a GET although it stores nothing: it runs the chokepoint model
   * pass, which is a billed egress call. An endpoint a cache or a link-prefetch may replay for free
   * must not be one that spends the caller's credits.
   */
  previewPublish: {
    method: 'POST',
    path: '/api/v1/integrations/definitions/:id/publish-preview',
    auth: 'user',
    response: PublishPreviewResponse,
  },
  /**
   * THE PUBLISH. Scrub the live row into a frozen snapshot and move it to the cross-org `global`
   * tier, in ONE gated store write. `auth: 'super-admin'`, matching the route's `requireRole` mount
   * and the `setGlobal` precedent it sits beside.
   *
   * SUPERSEDE IS THE NORMAL CASE, not an error: a definition has exactly one snapshot field, so
   * publishing a key that already has a live snapshot REPLACES it wholesale and stamps the replaced
   * one's provenance into `supersedes`.
   */
  publishDefinition: {
    method: 'POST',
    path: '/api/v1/integrations/definitions/:id/publish',
    auth: 'super-admin',
    request: PublishDefinitionRequest,
    response: PublishDefinitionResponse,
  },

  /**
   * The write gate's READ side: every action of an integration with its target, its shape and the
   * live approval (if any). `auth: 'user'` — see the note on the write below.
   */
  listActionApprovals: {
    method: 'GET',
    path: '/api/v1/integrations/:key/action-approvals',
    auth: 'user',
    response: IntegrationActionApprovalListResponse,
  },
  /**
   * Approve a mutating action.
   *
   * `auth: 'user'` and emphatically NOT `user-or-key`. The whole point of the gate is that a WRITE
   * needs a HUMAN (RUN_SPEC criterion 6), and a gateway key is an agent. If this were
   * `user-or-key`, an agent refused at the execution gate could call this endpoint with the very
   * shape it was just handed and then retry — a gate that grants its own exemption is not a gate.
   * Precedent in this same domain: `setVisibility` is `user` for the same reason.
   */
  approveAction: {
    method: 'POST',
    path: '/api/v1/integrations/:key/actions/:actionName/approval',
    auth: 'user',
    request: ApproveIntegrationActionRequest,
    response: ApproveIntegrationActionResponse,
  },
  /** Revoke every approval this user holds for this action — both decisions, every past shape. */
  revokeActionApproval: {
    method: 'DELETE',
    path: '/api/v1/integrations/:key/actions/:actionName/approval',
    auth: 'user',
    response: RevokeIntegrationActionApprovalResponse,
  },

  /* --- Per-integration LESSONS (slice C3) ---------------------------------------------------- */

  /**
   * Read / replace the operational knowledge an integration has accumulated.
   *
   * `auth: 'user'` on BOTH, and this is a DEVIATION from RUN_SPEC criterion 7's literal wording
   * (which lists `lessons` on the user-or-key capability surface), journaled in docs/decisions.md:
   *  - the READ an agent needs is not this endpoint. Lessons reach a model through the server-side
   *    `load_context` seam, already scrubbed. A key-reachable GET would add a way to pull a
   *    tenant's free text out over an API key without adding any capability the agent lacks.
   *  - the WRITE is free text that lands in the caller's OWN FUTURE PROMPTS. A key-bearing agent
   *    writing it is injecting its own context — what Rule 8 forbids the provider from doing — and
   *    is the same self-exemption C2 refused when it made all three consent descriptors `user`.
   * Narrow is the reversible direction: widening an auth class later is additive (Rule 7).
   */
  getLessons: {
    method: 'GET',
    path: '/api/v1/integrations/:key/lessons',
    auth: 'user',
    params: IntegrationKeyParams,
    response: IntegrationLessonsView,
  },
  setLessons: {
    method: 'PATCH',
    path: '/api/v1/integrations/:key/lessons',
    auth: 'user',
    params: IntegrationKeyParams,
    request: SetIntegrationLessonsRequest,
    response: IntegrationLessonsView,
  },

  /* --- LEARNED REPLAY RECIPES (slice P2) ---------------------------------------------------- */

  /**
   * WHAT THIS TENANT'S ACTIONS HAVE LEARNED, and the control that un-learns one.
   *
   * `auth: 'user'` on BOTH, and NOT `user-or-key`, for the reason `approveAction` and `setLessons`
   * are `user`: a recipe is learned FOR a user by the machine, and the delete is the human's veto
   * over what the machine decided. A key-bearing agent that could clear a recipe could also make
   * the next call expensive again on every action it touches; a key-bearing agent that could read
   * one could enumerate a tenant's private portal endpoints over an API. Neither adds a capability
   * an agent lacks - `executeAction` runs the action either way - and narrow is the reversible
   * direction (widening an auth class later is additive, Rule 7).
   *
   * THE LIST IS TENANT-WIDE and not per-integration: the question an owner has is "what has been
   * learned for me", and an action they cannot name is exactly the one they need to find. Scoped by
   * the actor's own org AND re-filtered by the definition read predicate, so a peer's private
   * definition never appears (`recipe-store.listRecipesForActor`).
   */
  listRecipes: {
    method: 'GET',
    path: '/api/v1/integrations/recipes',
    auth: 'user',
    response: IntegrationRecipeListResponse,
  },
  /**
   * FORGET one action's recipe: it stops replaying and runs its authored steps, exactly as it did
   * before it ever learned. IDEMPOTENT - clearing an action with no recipe is `ok`, not a 404.
   *
   * The raw evidence goes with it. That pairing is `integrations/recipe-lifecycle.ts`'s and is
   * shared with the run loop's own refusal path, so the two removal paths cannot disagree.
   */
  forgetRecipe: {
    method: 'DELETE',
    path: '/api/v1/integrations/:key/actions/:actionName/recipe',
    auth: 'user',
    params: IntegrationActionParams,
    response: ForgetIntegrationRecipeResponse,
  },

  /* --- The PUBLIC capability surface (slice D1) ---------------------------------------------- */

  /**
   * GET one integration as a CAPABILITY: the definition plus how each of its actions runs, where
   * it writes, and whether it needs (or already has) a human approval.
   *
   * `auth: 'user-or-key'` — a per-user gateway key reaches it, and every call still identifies a
   * user (Rule 4). The row is resolved UNDER THAT USER through the tenant-scoped registry, so a
   * key that names an integration its user cannot see gets the same 404 as one that names an
   * integration that does not exist: no existence oracle, and no consumer-specific branch anywhere
   * on the path (Rule 3).
   */
  getIntegration: {
    method: 'GET',
    path: '/api/v1/integrations/:key',
    auth: 'user-or-key',
    params: IntegrationKeyParams,
    response: IntegrationCapability,
  },

  /**
   * EXECUTE one action of one integration under the calling user's own credentials.
   *
   * THE WRITE GATE IS INHERITED, NOT RE-IMPLEMENTED. This route calls
   * `executeUserIntegrationAction`, which is where C2 put `checkActionConsent` precisely so that
   * every rail — this one, the automation `integration` step, the listener tick, the agent tool —
   * meets the same gate instead of four callers each remembering to ask. A `mutates` action with
   * no live approval therefore answers 403 with `details.code = 'awaiting_consent'` and the
   * descriptor the human must be shown, and NOTHING has left the process: the gate sits before the
   * credential is even loaded.
   *
   * AND THE KEY CANNOT ANSWER ITS OWN PROMPT. `approveAction` above is `auth: 'user'`, deliberately
   * not `user-or-key`: an agent refused here would otherwise POST the very shape it was just handed
   * and retry, and a gate that grants its own exemption is not a gate.
   */
  executeAction: {
    method: 'POST',
    path: '/api/v1/integrations/:key/actions/:actionName/execute',
    auth: 'user-or-key',
    params: IntegrationActionParams,
    request: ExecuteIntegrationActionRequest,
    response: ExecuteIntegrationActionResponse,
    /** An action may legitimately call a slow remote; the executor's own ceiling is 30s. */
    timeoutMs: 60_000,
  },

  /* --- `achieve` (slice D3) ------------------------------------------------------------------ */

  /**
   * EXECUTE-OR-AUTHOR: state a goal. If an action already satisfies it, it runs; if none does, one
   * is authored, verified and persisted as PROVISIONAL.
   *
   * `auth: 'user-or-key'` — this is the capability an outside agent actually wants, and every call
   * still identifies a user (Rule 4). Everything that could be dangerous about handing an agent a
   * code-writing endpoint is closed on the SERVER side rather than by withholding the endpoint:
   *
   *   - THE WRITE GATE IS INHERITED. The execute arm goes through `executeUserIntegrationAction`,
   *     so an unapproved `mutates` action answers the SAME 403 + `awaiting_consent` envelope as
   *     `executeAction` above, with nothing sent and no credential read.
   *   - AN AUTHORED ACTION IS STORED AS A WRITE whatever it claimed about itself, so it meets that
   *     gate on every rail, and `achieve` refuses to run a provisional action at all. The platform
   *     cannot author an action and then run it.
   *   - AND THE KEY CANNOT PROMOTE IT: `trustAction` below is `auth: 'user'`. An agent refused at
   *     the gate cannot hand itself the state that un-gates it — the same rule as `approveAction`.
   *
   * The timeout matches `executeAction`'s and covers the drafting turn as well, since either arm
   * may be the one that runs.
   */
  achieve: {
    method: 'POST',
    path: '/api/v1/integrations/:key/achieve',
    auth: 'user-or-key',
    params: IntegrationKeyParams,
    request: AchieveIntegrationGoalRequest,
    response: AchieveIntegrationGoalResponse,
    timeoutMs: 60_000,
  },

  /**
   * PROMOTE an authored action from provisional to trusted — the human half of `achieve`.
   *
   * `auth: 'user'` and emphatically NOT `user-or-key`, for exactly the reason C2 gave for the three
   * consent descriptors and C3 gave for lessons: `achieve` is key-reachable, so if this were too, a
   * key-bearing agent could author an action and then bless its own work in the next request. A
   * gate that grants its own exemption is not a gate. Widening an auth class later is additive
   * under Rule 7; narrowing one is not, so narrow is the reversible direction.
   */
  trustAction: {
    method: 'POST',
    path: '/api/v1/integrations/:key/actions/:actionName/trust',
    auth: 'user',
    params: IntegrationActionParams,
    request: TrustAuthoredActionRequest,
    response: TrustAuthoredActionResponse,
  },

  /* --- Action EVIDENCE erasure (slice S1) ---------------------------------------------------- */

  /**
   * ERASE the sample of the caller's own third-party account that this action's last validated run
   * left behind.
   *
   * WHY IT HAS TO EXIST. An evidence row holds one person's real request and real response body -
   * client names, processo numbers, invoice totals - and, for an automation-backed action, PINS that
   * run's screenshots out of the 7-day retention sweep for as long as the row lives.
   *
   * THIS IS THE ONLY ERASURE THE PERSON THEMSELVES CONTROLS. The other three ways a row goes are
   * somebody else's operation, or nobody's. It is superseded by the NEXT validated run of the same
   * action - which needs the action to still work and to be run again. It is erased when the
   * CREDENTIAL is disconnected - which costs the whole integration. And, failing both, it is
   * collected by TIME: the retention sweep ends every row not re-validated inside
   * `EVIDENCE_RETENTION_DAYS` (90), and that sweep is the ONLY automatic collector there is.
   *
   * THAT SWEEP RUNS AT BOOT AND ON A TIMER, and this line said "the BOOT retention sweep" because
   * until round nine boot was the only trigger it had - no interval, no Mongo TTL index, in a
   * container deployed to stay up, so "at most 90 days" really meant "at most 90 days after the next
   * deploy". `server.ts`'s `startRetentionSweepRail` re-runs it every `RETENTION_SWEEP_INTERVAL_MS`.
   * The bound a caller can rely on is therefore 90 days plus at most one tick - still long, and still
   * the reason this endpoint exists.
   *
   * NOTHING WATCHES FOR AN ACTION THAT STOPPED RESOLVING AND DELETES ITS SAMPLE ON THAT BASIS, and
   * this descriptor said it did until round six - a whole round after the mechanism was gone. The
   * server did have such a collector; asking "is this action still reachable?" at one instant, about
   * a row whose lifetime is durable, deleted live tenant data across four rounds of correction, so
   * it was REMOVED rather than refined (docs/decisions.md; the removal rule in
   * `integrations/action-evidence-store.ts`).
   *
   * So without this endpoint a person who simply does not want the sample kept must either
   * disconnect the integration or wait out a quarter of a year. Erasure of your own data is not a
   * side effect of another operation, and it is not something you wait for.
   *
   * `auth: 'user'` AND NOT `user-or-key`, the reading `approveAction`, `setLessons` and `trustAction`
   * all take in this domain: a destructive control over a person's own data is the person's, and a
   * gateway-key agent must not be able to destroy the very evidence a promotion to `trusted` rests
   * on. Widening an auth class later is additive under Rule 7; narrowing one is not.
   *
   * TENANCY IS THE STORE'S AND IT IS NOT A FILTER THE HANDLER APPLIES: the row is addressed by the
   * deterministic `_id` over (orgId, ownerUserId, integrationKey, actionName), built from the
   * VERIFIED actor, so a colleague's sample of the same action is a different document that this
   * request cannot name.
   */
  discardActionEvidence: {
    method: 'DELETE',
    path: '/api/v1/integrations/:key/actions/:actionName/evidence',
    auth: 'user',
    params: IntegrationActionParams,
    response: DiscardActionEvidenceResponse,
  },
} as const satisfies DomainDescriptorMap;
