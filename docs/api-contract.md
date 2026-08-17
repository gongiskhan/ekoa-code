# API contract

How the `shared/` contract binds the API and the web client, the wire conventions every endpoint
obeys, and the CI gates that keep declared and mounted surfaces in sync.

## `shared/` is the single contract

`shared/src/` holds zod schemas + inferred types + one **endpoint descriptor map** per domain
(`authEndpoints`, `artifactsEndpoints`, ...). `ALL_ENDPOINTS` (33 domains at 2026-08-17) aggregates them and
`allEndpointsFlat()` yields `{ domain, name, method, path, ... }` for every endpoint. Both consumers
use this contract: the api contract tests validate real responses against the schemas, and the web
client is generated from the descriptor maps. A new endpoint means a new descriptor + a new contract
test in the same PR. Test stubs for API responses must themselves validate against the `shared/`
schemas.

## Error envelope (CONV-2)

Every non-2xx response carries `{ error: { code, message, details? } }`. `code` is a stable
UPPER_SNAKE machine string; `message` is user-safe and PT-PT where the surface is PT; `details` is
optional structured context (e.g. zod issues). Every error message passes the egress
sanitisation chokepoint before leaving the process. A terminal JSON-envelope 404 handler sits after
all routers, so an unmounted `/api/v1/*` path returns `404 NOT_FOUND` in the envelope, never Express
HTML. Common codes: `VALIDATION_FAILED` (400), `UNAUTHENTICATED`/`TOKEN_EXPIRED` (401),
`BILLING_BLOCKED`/`BILLING_LOCKED` (402), `FORBIDDEN`/`ACCOUNT_DISABLED` (403), `NOT_FOUND` (404,
also on cross-org ownership mismatch - uniform not-found), `TRIGGER_DISABLED` (410),
`SECRET_GUARD_BLOCKED` (422), `RATE_LIMITED` (429), `INTERNAL` (500), `UPSTREAM_*` (502/503).

## Auth tiers (CONV-1)

`Authorization: Bearer <JWT>` on every `/api/v1` endpoint except the exemptions. JWT claim set is
`{ sub, role, scope, orgId, username }`; three roles: `super-admin`, `org-admin`, `builder`
(the default `user` member).

| Class | Applies to |
|---|---|
| `public` | `POST /auth/login`, `POST /auth/device[/poll]`, `GET /health`, `/api/demos*`, static assets |
| `user` | default for all `/api/v1` resources; data access org+user-scoped in `data/` |
| `super-admin` / `org-admin` | marked per endpoint; role re-resolved from the store, never trusting stale claims |
| `token-query` | the four SSE endpoints - `?token=<JWT>` because EventSource cannot set headers |
| `HMAC` | `POST/GET /hooks/:triggerId` - provider signature; disabled-check after signature |
| `header-scoped` | served-app data plane - `X-Ekoa-App-Id` and/or per-app SSO cookie; no platform JWT |
| `app-id-gated` | `/api/m365/*` workspace Graph proxy - verified `X-Ekoa-App-Id` + per-app manifest opt-in |

Every authenticated request additionally passes the revocation-set check then the activation check:
a deactivated account fails `403 ACCOUNT_DISABLED`, a billing-locked account `402 BILLING_LOCKED`, on
every authenticated surface.

## The four SSE streams (CONV-4)

Exactly four SSE endpoints; everything else is request-response or client polling. All authenticate
via `?token=`. Streams: `GET /api/v1/chat/runs/:id/events`, `GET /api/v1/jobs/:id/events`
(build + brand-research), `GET /api/v1/automations/runs/:id/events`, and
`GET /api/v1/notifications/events` (per-user push). Frames are `event:`/`data:`/monotonic `id:`;
clients resume with `Last-Event-ID` from a bounded ring buffer (200 events, swept after 300 s idle);
each stream opens with `ready`, and the client re-syncs via `GET /:id` after reconnect. Closing an
SSE stream never stops a run - cancel is always the explicit `POST /:id/cancel`. The chat stream
carries a `thinking_chunk` channel (working commentary, white-label-redacted server-side); it is
still one of the four streams. A separate TUI-only compatibility channel `GET /api/v1/events` serves
agent-face traffic and does not count against the four (it is not a web-client stream). The LLM
gateway's `stream: true` Messages responses (see "LLM gateway" below) are Anthropic-wire SSE for
external clients, header-authenticated, and likewise do not count.

## Served-app byte-compat plane (§3.9)

Paths outside `/api/v1`, preserved byte-compatibly from legacy Cortex (same paths, headers, cookie
names, response shapes) because the legal Playwright suite and every built app drive them with no
JWT. Key surfaces: per-app CRUD `GET/POST/PUT/DELETE /api/app-data/:collection[/:id]`
(`X-Ekoa-App-Id`-scoped, app-global, `{success,data}` envelopes); owner-shared
`/api/app-shared/:collection[/:id]` (server-side owner-scope, `usr.`-prefixed ids rejected from
clients); app files/PDF/cloud-files; end-user SSO `/api/app-sso/*` (per-app HttpOnly cookie, 8 h);
the `/api/m365/*` workspace Graph proxy (app-id-gated); the integration proxy
`/api/integration/:key/*` (optional-JWT); and static serving `GET /apps/:idOrSlug/`. The one
redesigned route is `POST /api/app-assistant` (`AssistantChatRequest -> AssistantChatResponse`,
synchronous, billed to the artifact owner). This plane consults the artifact owner's activation, so a
deactivated owner's apps refuse service with the CONV-2 envelope.

Two additive quiet-probe routes (2026-07-14) exist because mount-time probes must never log non-2xx
console noise (the browser logs every non-2xx regardless of JS handling): `GET /api/app-sso/session`
answers 200 in BOTH states (`AppSsoSessionResponse` - the `/me` identity payload, or `data: null`
signed out; `/me` itself keeps its byte-compat 401) and `GET /api/demos/:appId/availability` answers
200 `{ available }` (`DemoAvailabilityResponse`; the spec route `/api/demos/:appId` keeps its loud
404 for a genuinely absent tour). Both are carried in `shared/src/served-app.ts` and covered by
contract tests.

## LLM gateway (Claude-Code-compatible clients)

`/api/v1/llm` is the Anthropic-Messages-compatible gateway sub-app (descriptors in
`shared/src/ekoa-local.ts`). `POST /messages` and `POST /v1/messages` accept a stock Anthropic
client (`ANTHROPIC_BASE_URL=<host>/api/v1/llm`); auth is the injected JWT verifier or the static
platform key. The upstream transport is BUFFERED - anonymisation operates on the complete body and
outranks streaming.

**Streamed requests (heartbeat-and-replay, 2026-07-17).** A `stream: true` request gets its SSE
`200` committed immediately AFTER auth and the allowance gate - a bad credential stays a clean HTTP
401 and a billing block a clean 402, never SSE. From commitment: `event: ping` frames
(`{"type": "ping"}`, the provider's own shape, ignored by stock clients) every 15 s while the
buffered upstream call runs, then the verbatim detokenized upstream SSE body replayed in one raw
write. Failures after commitment arrive as ONE in-stream `event: error` frame in the provider error
shape: an upstream non-2xx JSON body is re-emitted as-is, a gateway rate-cap trip is
`rate_limit_error`, a terminal credential failure is `api_error`. Caveat: provider response headers
(e.g. `request-id`) are NOT forwarded on the streamed path - they arrive only after the 200 is
committed; the non-streamed path forwards them unchanged (hop-by-hop + `content-encoding`
stripped). This is deliberately NOT one of the four CONV-4 web-client SSE streams: no `?token=`
auth, no `Last-Event-ID` ring, no `ready` frame - it is the Anthropic wire shape for external
clients.

**count_tokens (2026-07-17).** `POST /v1/messages/count_tokens` (and the `/messages/count_tokens`
alias) forwards through the chokepoint with the full anonymisation posture and the same tier
resolution as messages (the count is honest for the model that will actually run). Auth-gated like
messages, but NEVER billed, NEVER rate-capped, and the allowance gate is skipped - it is free
upstream, produces no usage, and Claude Code polls it continuously for context management
(descriptors `ekoaLocal.llmCountTokens` / `llmCountTokensAlias`, schema `LlmCountTokensResponse`).

**Body limits and parse errors.** `/api/v1/llm` bodies are parsed by the gateway's OWN 50 MB
parser, not the global 1 MB one (stock clients routinely send >1 MB bodies); gateway body-parse
failures answer in the ANTHROPIC error shape (`{type:'error', error:{type:'invalid_request_error'}}`,
413/400), never the CONV-2 envelope - the one declared exception to the CONV-2 rule, scoped to this
Anthropic-wire surface. Every other route keeps the 1 MB limit + CONV-2 envelope.

**Ancillary-surface inventory (stock Claude Code, live-observed 2026-07-17, S6, by inspecting the
api request log during a real `claude -p` run).** A stock `claude` CLI pointed at the gateway with a
per-user key calls exactly two endpoints: `POST /v1/messages` (streamed and non-streamed) and
`POST /v1/messages/count_tokens` (continuously, for context management). It does NOT consume
`GET /models` and does NOT call `/classify` (that is the local loop's own surface). This is a live
observation (the S6 driver exercises count_tokens itself over HTTP; it does not commit the CLI's
own request set), re-derivable by capturing the api request log across a `claude` run. No header-gated beta feature was needed - the body-level `betas` field
sufficed, so client HTTP-header pass-through was NOT built (brief §3 criterion resolved: not
needed). In-stream error rendering (brief §3, verified live): a stock `@anthropic-ai/sdk` client
surfaces a post-commitment in-stream `error` event as a TERMINAL `APIError` with `status: undefined`
- it is NOT retried the way a pre-commitment HTTP 429 is (documented as the accepted cost of
heartbeat-and-replay in `docs/decisions.md`). Session vaults: Claude Code sends no conversation id,
so its anonymisation vault is keyed by the gateway key id (S7) for stable tokens across its agentic
tool loop. KNOWN LIMITATION (`findings.md gateway-anon-tooluse-fidelity`): a deny-list literal in a
filesystem PATH does not yet reliably detokenize in `tool_use` args across the loop - deny-list orgs
doing filesystem work through Claude Code are affected; the empty-ruleset default posture is a
proven true no-op.

## The public OpenAPI document (`docs/openapi/cortex.v1.json`)

The capability surface Cortex exposes to outside clients is published as an OpenAPI 3.1 document,
**generated** from the descriptor maps by `api/scripts/generate-openapi.mjs`
(`npm run openapi:generate`). It is committed, and it is never hand-edited.

**What is in it - one rule, no allowlist.** An endpoint belongs in the document IFF its descriptor
carries `auth: 'user-or-key'`. That makes the spec *definitionally equal* to the key-accepting
surface (Capability Contract rule 4) rather than a second inventory that can drift from it: flip a
descriptor to `user-or-key` and it appears, flip it back and it disappears. Everything that needs a
platform session (`user`, `org-admin`, `super-admin`, `token-query`, `hmac`, ...) is absent by
construction. At 2026-07-31 that is 27 operations over 22 paths in three domains - `memvault`,
`automations`, `knowledge` - plus the 54 schema components reachable from them. Those counts are a
snapshot, not a gate: additive growth is silent (see the versioning rule below), so the committed
document is the census, not this paragraph.

**Everything it says comes from a descriptor field.** The generator holds no per-endpoint
knowledge; where a fact about an endpoint could not be read from `shared/`, the fix was to add the
field, not to hardcode the fact. `EndpointDescriptor` therefore carries, besides
`request`/`response`/`query`:

| field | what it makes documentable |
|---|---|
| `params` | the zod for the express `:params`. Path segments get their real type (`KnowledgeSegment`, not "a string"), **and** the endpoint gets its `400` - `knowledge.readKnowledgeDoc` validates its segments and rejects a bad one. |
| `successStatus` | the success status when it is not 200; an ARRAY when the status itself carries information. `automations.create` is `201`; `automations.createRun` is `[202, 200]`, where 202 started a run and 200 is an idempotent replay of the same runId and the status is the ONLY signal telling them apart. |
| `mediaType` | the response media type for a non-JSON body. Mandatory with `kind: 'binary'` - the generator refuses to guess, because guessing produced `application/octet-stream` for a route that sends `application/x-tar`. |

**What it contains per endpoint.** Path + method; path parameters typed from `params` where it is
declared and as `{type: string, minLength: 1}` where it is not (the honest limit: without a `params`
schema the contract states nothing about the segment, and a route that validates its params without
declaring them is a contract gap, not a generator gap); query parameters exploded from the `query`
object schema with a `required` flag each; the `request` schema as an `application/json` body; the
`response` schema under every declared success status, with an `x-ekoa-success-statuses` extension
preserving declared order when there is more than one. Failure responses are derived, never listed
per endpoint: `401 402 403 404 429 500` always (they are platform-wide invariants), `400` iff the
descriptor declares `request`, `query` **or** `params`, and `413` iff it declares `request` - one
global `express.json({limit:'1mb'})` covers every route here, and 413 is reachable from a
spec-valid body because schema `maxLength` counts CHARACTERS while the limit counts BYTES. Every
failure references the one reusable `ErrorEnvelope` component. Auth is a single bearer
`securityScheme` (the `ekoa_gk_` gateway key; its description records that a platform JWT is
accepted too). `x-ekoa-*` extensions carry `domain`, `endpoint`, `auth`, `kind`,
`success-statuses`, `timeout-ms`.

**Conversion.** zod v3 has no `toJSONSchema`, so schemas go through `zod-to-json-schema` (an `api/`
devDependency - `shared/` still imports zod and nothing else) with the **`jsonSchema7`** target, not
`openApi3`. OpenAPI 3.1's dialect is JSON Schema 2020-12; the `openApi3` target emits the OpenAPI
*3.0* dialect, which renders exclusive bounds as booleans and a null branch as
`{"enum":["null"],"nullable":true}` - both wrong in 3.1, and both occur on this surface.

Three things the generator refuses to do silently, because each would publish a contract WIDER or
otherwise different from the one the code enforces:

- **A dropped refinement.** `.refine()` is invisible to the converter, which renders the inner
  schema and discards the predicate - so `KnowledgeSegment`'s refusal of `.` and `..` would vanish
  and the spec would advertise `..` as a legal path segment. Refinements are encoded from a
  FAIL-CLOSED table (`KnowledgeSegment` -> `not: {enum: [".", ".."]}`); any effect not in it throws.
- **A draft-7-only construct** (`definitions`, `dependencies`, tuple `items: []`, boolean
  `exclusiveMinimum`, `nullable`) reaching a 3.1 document.
- **A dangling `$ref`.**

**Component names are public API.** Schemas are hoisted into `#/components/schemas/*` under their
`shared/` export name, because a component name becomes a type name in the generated client.
Several exports alias one schema object (`OkResponse` is also `AgentFaceCancelResponse`; `NoteRecord`
is also `WriteNoteResponse`; `NotePermalink` is also `NoteFolder`); the shortest name wins, ties
alphabetical. That is a deterministic tie-break, **not** a way of finding the canonical name - the
third pair disproves that, since the derived alias `NoteFolder` is shorter and wins. What keeps it
safe is the gate, not the rule: adding an aliasing export can silently RENAME an existing component,
so the drift test diffs the component-name set separately and reports a disappearing name as
breaking.

**Versioning rule.** The document's `info.version` major mirrors the `/api/vN` path prefix and is
*derived from the paths*, not hand-maintained. Per Capability Contract rule 7, **additive change is
silent**: a new `user-or-key` endpoint or a new optional field regenerates the document and does NOT
move the version. A **breaking** change - a removed or renamed endpoint or field, a narrowed type, a
new required field - needs a major bump, which means a new `/api/vN` prefix, its own
`docs/openapi/cortex.vN.json`, and an explicit migration of every consumer. Regenerating is never
the whole fix for a breaking change.

## Contract-change discipline and CI gates

Four gates walk `shared/` against the code. Know exactly what each guarantees:

- **schema-coverage** (`api/tests/contract/schema-coverage.test.ts`) - every descriptor in `shared/`
  is either COVERED (a hand-maintained allowlist) or PENDING (pinned count). It fails if a descriptor
  is in neither, so adding a schema without accounting for it is an automatic build failure. **Honor-
  system caveat (do NOT treat a green gate as proof a body matches its schema):** the gate does NOT
  verify that any test actually exercises a COVERED endpoint - adding a key with zero tests passes.
  This has shipped real bugs twice (F22 `memoryView`, the sessions family); a 2026-07-10 audit found
  27 of 154 COVERED keys unexercised. A run-wide registry of actually-exercised schemas is specified
  but not implemented.
- **mount-coverage** (`mount-coverage.test.ts`) - every declared path must be MOUNTED, probed by
  envelope-vs-HTML at the router level (401 = router exists; 404 NOT_FOUND = unmounted). DESCOPED to
  shrink-only: the EXCLUDED list may only shrink. Known limit: a router mounts with `requireAuth`, so
  it proves the ROUTER exists, not a specific sub-route beneath it (per-endpoint contract tests cover
  that).
- **openapi-drift** (`api/tests/contract/openapi-drift.test.ts`) - regenerates the public OpenAPI
  document in-process and requires it to be byte-identical to the committed
  `docs/openapi/cortex.v1.json`, failing with the exact regeneration command. It additionally
  asserts, independently of the generator: set-equality between the documented operations and the
  `user-or-key` descriptors in BOTH directions (a missing capability endpoint and a leaked
  platform-session endpoint both fail); that every declared `successStatus`, `params`-driven `400`,
  body-driven `413` and `mediaType` reached the document; that `KnowledgeSegment`'s refinement
  survived and that an unregistered refinement throws; that every failure response references the
  shared error envelope; and that the committed file is a real 3.1 document (so a missing or gutted
  file cannot pass vacuously). Two failures carry a DIFFERENT remedy on purpose: a disappearing
  component NAME is reported as breaking rather than "regenerate", and a `shared/dist` older than
  `shared/src` fails first with "run `npm run build --workspace shared`" - the generator and the
  test both read the gitignored build output, so a stale build would otherwise compare the spec
  against a contract nobody is looking at. It rides the ordinary api vitest suite, so `npm test` /
  `ci:lane` already run it; no separate CI lane. **Two stated limits.** Same shape as
  schema-coverage: it proves spec-versus-descriptor agreement, NOT that a real response body matches
  its schema. And the freshness check catches a STALE build, not one built correctly from
  UNCOMMITTED source - that is a legitimate mid-work state, so the proof against it is procedural:
  regenerate and re-verify from a pristine checkout of HEAD before committing the document.
- **protocol-parity** - the migration parity suites (`api/tests/migration/`) replay legacy workloads
  and billing against the rebuilt engine to prove byte/behaviour parity on the carried surfaces.
