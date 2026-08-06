---
name: cortex-cli
description: Reach Cortex capabilities (the per-user note vault, the org knowledge vault, automations, the connected integrations) from a shell or an agent session over the public Capability API, using a user-scoped gateway key. Use when you need to persist or recall a note across sessions, search the org's legal/knowledge corpus, start and follow an automation run, or make a connected service act. Do NOT use for platform administration (users, billing, keys) or for approving an integration's write action - none of that is on the key-reachable surface.
---

# cortex

One binary over the public Cortex Capability API. Every subcommand is a call to an operation in
`docs/openapi/cortex.v1.json`; the typed client is generated from that document, so what the CLI
can do IS the published contract, never more.

## Before anything

```bash
export CORTEX_BASE_URL=https://cortex.example.com   # your deployment origin
export CORTEX_API_KEY=ekoa_gk_...                   # a user-scoped gateway key
cortex --help
```

Configuration is environment-only. There is no config file, no `--key` flag, and nothing is
defaulted - the CLI cannot guess an origin or a credential, so it can never quietly talk to the
wrong deployment. **The CLI cannot mint a key**: minting requires a platform session and is
deliberately absent from the key-reachable surface. You are handed a key; you never bootstrap one.

Every call carries that key as `Authorization: Bearer`. The key identifies exactly one user, and
tenancy is enforced server-side against that identity - there is no org/user flag to pass, and
passing someone else's id is not a thing the API models.

## Exit codes and output

| code | meaning |
|---|---|
| 0 | the call succeeded |
| 1 | the work did not complete: Cortex refused it (401/402/403/404/429/500), the request timed out or could not connect, a `watch` gave up (`WATCH_TIMEOUT`), an export arrived but could not be written (`WRITE_FAILED`), or an integration action answered HTTP 200 saying it did not work (see `integrations`) |
| 2 | you got the invocation wrong, or a required env var is missing - **nothing was sent** |

Exit 2 means exactly that: **no request was made**. Every argv and configuration refusal is decided
before the first byte goes out, so a mistyped invocation never costs a call, an audit row or a slot
in the key's rate window.

`--json` works on every command and prints **exactly one** JSON document on stdout:

```json
{ "ok": true, "command": "memory write", "status": 200, "data": { "...": "the API response, verbatim" } }
```

On failure stdout stays EMPTY and the error document goes to stderr:

```json
{ "ok": false, "command": "memory read", "error": { "code": "NOT_FOUND", "message": "...", "status": 404 } }
```

So `cortex ... --json > out.json` is always either a valid success document or an empty file. Help
is a document too (`cortex --help --json` -> `{ "ok": true, "command": "help", "help": "..." }`), so
nothing a `--json` invocation writes to stdout is ever unparseable.

Two more argv facts worth knowing:

- `--` ends option parsing. A search term that looks like a flag is data after it:
  `cortex memory search -- --json` searches for the literal string `--json`.
- Piping is safe. `cortex memory export --out - | tar -tf -` and `... --json | head` end quietly
  when the reader closes early - no stack trace, no stray exit code.

No FAILURE message prints your key: an error body or a transport complaint that quotes it is
redacted before it reaches stderr. Two limits, stated rather than implied: a SUCCESS body that
echoes the key is printed verbatim on stdout (only reachable from a hostile or mistyped
CORTEX_BASE_URL, which is the same threat model the redaction exists for), and a key reflected
in a different encoding - base64, \u-escaped - is not matched by value. Within those limits a CLI
FAILURE is safe to paste into a log, a transcript or an issue.

## memory - the per-user note vault

Notes are markdown with a `permalink` (`folder/slug`, lowercase, `/`-separated). **The permalink is
the identity of the note**: writing the same permalink again OVERWRITES it, it never duplicates.
That makes `write` safe to retry, and makes the permalink the natural dedupe key for anything that
drains a queue of captured files.

```bash
# capture a file as a note (the canonical drain invocation - nothing else is required)
cortex memory write --file /tmp/capture-2026-07-31.md --permalink capture/2026-07-31 --json

# write from a pipe, with tags
git log -1 --format=%B | cortex memory write --stdin --permalink decisions/last-commit --tag decisao

# recall
cortex memory read capture/2026-07-31
cortex memory list --folder capture --limit 20
cortex memory search "prazo de recurso" --limit 5

# take the whole vault with you (application/x-tar; markdown only, no derived index)
cortex memory export --out ~/vault.tar
cortex memory export --out - | tar -tf -

cortex memory delete capture/2026-07-31
```

`--title` is optional: it is derived from the body's first markdown heading, else the file name,
else the last permalink segment. Give `--title` when the note deserves a better one.

## knowledge - the org vault, read only

Search and read the org's corpus plus the shared legal corpus. There is no write subcommand
because ingestion is not on the key-reachable surface: a key can read knowledge, never plant it.

```bash
cortex knowledge search "prazo de recurso" --limit 5 --json
cortex knowledge collections
cortex knowledge documents --collection jurisprudencia --limit 20
cortex knowledge read jurisprudencia <docId>
```

Each hit and document carries `scope: "org" | "shared"` - your org's own material versus the
shared corpus. A collection and a document id are each ONE path segment; `/` is not representable.

## automations - start a run and follow it

```bash
cortex automations list
cortex automations show <automationId>

# start a run; --idempotency-key makes the start at-most-once
cortex automations run <automationId> --input cliente=ACME --idempotency-key nightly-2026-07-31 --json

cortex automations status <runId>
cortex automations logs <runId>
cortex automations watch <runId> --interval-ms 2000 --timeout-ms 300000
```

**The replay distinction matters.** `run` answers **HTTP 202 for a fresh run** and **HTTP 200 when
an idempotency key replayed one that already exists**; the status is the ONLY signal telling them
apart, and the body (`{ "runId": ... }`) is identical. `--json` surfaces it as `"created"` /
`"replayed"`:

```bash
created=$(cortex automations run "$id" --idempotency-key "$k" --json | jq -r .created)
# true  -> this invocation started the run
# false -> the run already existed; nothing new was started
```

Retrying a failed network call with the SAME `--idempotency-key` is therefore safe: at most one run
exists per (automation, owner, key).

**`watch` polls.** The run event stream is a platform-session endpoint and is deliberately not part
of the public surface, so a key holder observes a run by polling `status` - which is exactly what
`watch` does, stopping when the run reaches `completed`/`failed`/`cancelled` (`"terminal": true`) or
parks on a human gate such as `awaiting_consent` (`"blocked": true`). Watch exits 0 whenever the
poll concluded: **read the run's own `status` to learn whether the work succeeded**. If the run has
not settled within `--timeout-ms`, watch exits 1 with `WATCH_TIMEOUT`.

## integrations - make a connected service act

```bash
cortex integrations list
cortex integrations show slack          # connected? and every action, with its write gate

# run ONE named action
cortex integrations execute slack list_channels --json
cortex integrations execute slack send_message --arg channel=#geral --arg text="olá" --json

# or state a goal and let Cortex pick (or write) the action
cortex integrations achieve slack --goal "diz olá no #geral" --json
```

`--arg k=v` repeats and every value is a **string**: `--arg limit=10` sends `"10"`. Anything that is
not a string - a number, a boolean, a nested object - goes through `--args-json '{"limit":10}'`,
and the two are mutually exclusive. Same split as `automations run`'s `--input` / `--inputs-json`.

**TRAP 1: a failed action is an HTTP 200.** `execute` answers **200** carrying
`{"success": false, "code": "not_connected", ...}` whenever the call was addressed and permitted and
then did not work - the integration is not connected, the credential is locked, the remote answered
500. That is deliberate (a remote failure is an answer *about the remote system*, not a failure of
Cortex), and it means **the HTTP status alone never tells you whether the action ran**. This CLI
reads `success` for you: a false one is exit 1 with the error document on stderr, carrying the
executor's own `code` and the whole body under `details`. So `if cortex integrations execute ...`
means what it looks like it means - but a client hand-rolling HTTP against this endpoint must check
the body, not the status.

```json
{ "ok": false, "command": "integrations execute",
  "error": { "code": "not_connected", "message": "slack/list_channels failed: ...",
             "details": { "success": false, "code": "not_connected", "error": "..." } } }
```

**TRAP 2: a mutating action needs a human, and this CLI cannot be that human.** An action that
writes and has no live approval is refused with **403** and `details.code = "awaiting_consent"`,
plus `details.consentRequest` naming the real destination:

```json
{ "integrationKey": "slack", "actionName": "send_message",
  "description": "Publica uma mensagem num canal",
  "target": "POST https://slack.com/api/chat.postMessage",
  "shape": "sha256:..." }
```

The descriptor is printed intact (human mode) and travels intact in `error.details` (`--json`),
because `target` is the thing a person has to read before answering. **The approval endpoint is not
reachable with a key**: `POST /api/v1/integrations/:key/actions/:actionName/approval` is auth
`user` and deliberately sits off the key-reachable surface, exactly so an agent refused at the gate
cannot approve the shape it was just handed. **A person must approve the action in the Ekoa UI**;
retrying, re-wording the goal, or calling `achieve` instead will meet the same gate.

`achieve` has three outcomes and only one of them is exit 0:

| outcome | what happened | exit |
|---|---|---|
| `executed` | an existing trusted action ran; `result` is the ordinary execute body, so trap 1 applies to it | 0, or 1 if `result.success` is false |
| `authored` | nothing fitted, so an action was **written** as provisional. It has NOT run and cannot until a person promotes it | 1 |
| `refused` | addressed, admitted, then declined, with a machine-readable `code` (`ambiguous_goal`, `verification_failed`, ...) | 1 |

A run that reaches a gate is an answer, not a crash - but it is not the goal happening, so it does
not exit 0.

## Patterns worth copying

Drain a spool directory, deleting only what was really accepted:

```bash
for f in "$SPOOL"/*.md; do
  key="capture/$(basename "$f" .md)"
  if cortex memory write --file "$f" --permalink "$key" --json > /dev/null; then
    rm -f "$f"        # exit 0 means Cortex has it; the permalink makes a retry harmless
  fi
done
```

Act through an integration and branch on WHY it did not work - the two cases mean opposite things,
and neither is a reason to retry the same call:

```bash
if ! out=$(cortex integrations execute slack send_message --arg text="olá" --json 2>&1); then
  case "$(printf '%s' "$out" | jq -r '.error.details.code // .error.code')" in
    awaiting_consent)
      # A person must approve this in the Ekoa UI. Retrying will meet the same gate.
      printf 'needs approval: %s\n' "$(printf '%s' "$out" | jq -r '.error.details.consentRequest.target')" ;;
    not_connected)
      printf 'slack is not connected for this user\n' ;;
    *)
      printf '%s\n' "$out" ;;
  esac
fi
```

Recall before you ask a model to redo work:

```bash
cortex memory search "$topic" --limit 5 --json | jq -r '.data.hits[] | "\(.permalink)\t\(.title)"'
```

Start a run and act on the outcome:

```bash
runId=$(cortex automations run "$id" --idempotency-key "$key" --json | jq -r .data.runId)
cortex automations watch "$runId" --json | jq -r .data.status   # completed | failed | cancelled
cortex automations logs "$runId"
```

## What this CLI will never do

- Mint, list or revoke keys; touch users, orgs or billing (platform session only).
- Ingest knowledge documents (read only over a key).
- Stream run events (session-only endpoint - poll instead).
- Approve an integration's write action, or promote an authored one to trusted. Both endpoints are
  auth `user` and off the key-reachable surface, on purpose: a gate that grants its own exemption
  is not a gate. A person answers them in the Ekoa UI.
- Connect an integration or store its credentials (platform session only) - a key can only use one
  that is already connected.
- Branch on who is calling: `X-Client: cortex-cli/<version>` is a trace tag the server records in
  the audit trail and never acts on.

## For maintainers

The client under `src/generated/` is generated from `docs/openapi/cortex.v1.json` and committed.
Never hand-edit it:

```bash
npm run generate --workspace @ekoa/cortex-cli      # regenerate after the spec moves
npm run gate:client-drift                          # CI gate: committed client == spec
npm run build --workspace @ekoa/cortex-cli         # dist/ + the bin/ shim
npm run test --workspace @ekoa/cortex-cli          # unit + e2e against the real routers
```

Adding a subcommand means calling another operation id through `src/client.ts`. Writing HTTP by
hand anywhere in this package is a review failure: there is one wrapper, and it is generic.
