# Leg D - the promotion dry-run: what the snapshot carries, and what it structurally cannot

Origin definition: `s10-evidence` (private, `userCreated: true`), id
`de6fd53866ab48119e4ef11b96f6010b2fbf0a5b161057d63cfc433ba0bd25d1`, owned by `admin`.

## Built through real product paths only

| Step | Path used | File |
| --- | --- | --- |
| Create the definition | `PUT /api/v1/integration-builder/package` (the builder's own save) | - |
| Produce an evidence row | `POST /api/v1/integrations/s10-evidence/actions/listar_utilizadores/execute` (a real 200 from jsonplaceholder.typicode.com) | `03-origin-evidence.json` |
| Attach a feedback note | `PUT /api/v1/integrations/s10-evidence/actions/listar_utilizadores/feedback` (S3, auth `user`) | `01-feedback-written.json`, `04-origin-feedback.json` |
| Mint a second, provisional action | `POST .../achieve` under a gateway key (leg B) | `05-origin-definition.json` |
| The dry run | `POST /api/v1/integrations/definitions/:id/publish-preview` (S6, auth `user`) | `02-publish-preview.json` |

## The diff that is the point

**The ORIGIN row carries, right now:**

- an evidence row for `listar_utilizadores`: `backingType: "api-call"`, `shape`
  `ffab87ad45971e9f8a11c9941eb7d403`, `validatedAt: "2026-08-23T01:38:01.130Z"`, the redacted
  request summary (`GET https://jsonplaceholder.typicode.com/users` + headers) and an 8 KB-capped
  verbatim response sample containing **real third-party account content** (names, emails, phone
  numbers, addresses of the demo users);
- a feedback note by this user: *"Nota do autor (S10): a lista vem sem paginacao - confirmar sempre o
  total antes de assumir que estao todos os utilizadores."*;
- on the authored action, `authoring.authoredBy` (the author's user id) and `authoring.goal` (the
  natural-language goal the author typed).

**The SNAPSHOT the preview would publish carries NONE of it.** Walking every key of
`02-publish-preview.json -> snapshot`:

```
ALL KEYS: 0..7, Accept, actionName, actions, argsSchema, authType, authoredAt, authoring,
          backingType, baseUrl, bodyTemplate, category, checks, config, configSchema,
          declaredMutates, description, displayName, headers, httpConfig, integrationKey,
          method, mutates, name, ok, passed, path, properties, provider, queryParams,
          required, returnSchema, shape, skillMd, state, transport, type, verification,
          verifiedAt, version

evidence          absent      authoredBy        absent
feedback          absent      goal              absent
lastRun           absent      note              absent
runId             absent      stepRef           absent
validatedAt       absent      lessons           absent
```

No response sample, no `Leanne`, no email, no note text.

### PROVEN

- **D5 structural exclusion, observed on the wire.** Evidence and feedback live in tenant-scoped
  collections that no publish path reads, so promotion carries none of them by construction - not by
  a filter that could be forgotten. The preview is the same pure function the publish applies, so
  what is captured here is what would ship.
- **The author's identity and their typed goal do not travel** either: `authoring.authoredBy` and
  `authoring.goal` are on the origin row and absent from the snapshot.
- **The redaction report is explicit rather than silent.** `redactions` names path, rule, source and
  removed length; `modelPass: { status: "applied", spansApplied: 0 }` records that the model pass ran
  and found nothing beyond the floor, which is a different fact from "the model pass did not run".

### PARTIALLY PROVEN / caveats

- Credential scrubbing was **not** exercised meaningfully: this definition is `authType: "none"` with
  an empty `configSchema`, so there were no credential-named fields for the floor to redact. The one
  redaction that fired is the finding below.
- Only the PREVIEW was run. `publishDefinition` (super-admin) was deliberately not called - this is a
  dry run, and publishing would have put a row into every org on the stack.

### DEFECT FOUND (recorded in docs/findings.md)

The one redaction the floor applied is a **false positive that changes behavior**:

```json
{ "path": "config.actions[1].authoring.shape", "rule": "literal-secret-token",
  "source": "floor", "removedChars": 32 }
```

`authoring.shape` is a 32-char md5 content fingerprint of the action's own binding, not a secret.
`LONG_HEX_RE` in `applyPublishFloor` cannot tell it from a leaked token, so the published snapshot
carries `shape: "[REDACTED]"`. `authored-action.ts` decides an action's effective state with
`record.shape === actionShape(integrationKey, action)`, so in a receiving org the comparison can
never hold and a **published TRUSTED authored action reads as `provisional` and needs re-approval**.
It fails CLOSED (no action is over-trusted by this), which is why it is minor rather than serious -
but it silently un-does graduation across a publish, and the publisher is told only "32 characters
removed from a field named shape".
