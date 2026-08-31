# Citius / eTribunal - evidence

What was proven on 2026-08-31, and precisely where the proof stops.

| file | what it shows |
|---|---|
| `fixture-portal.mjs` | the Portal dos Mandatários stand-in the rail is developed against (see its own header for why a fixture, and what it assumes about the real portal's shape) |
| `runbook.md` | the acceptance loop, including the two steps that need a human |
| `proof.mjs` | the driver behind `proof-01-resolution.txt`; re-runnable |
| `proof-01-resolution.txt` | connect -> the ceremony address resolves to the tenant's configured portal -> provisioning materialises 6 automations -> the action starts a REAL RUN -> the trigger is a polled listener |
| `proof-02-chat.txt` | the conversational half: chat discovers the package, reaches for the document action, and surfaces the rail's refusal instead of inventing a document list |
| `proof-03-listener.txt` | the listener supervisor picking the trigger up and polling it, failing loudly with the real reason and backing off |

## What is proven

- A binding that names a package TEMPLATE resolves to the org's own provisioned automation. Before
  this, every automation-backed action on every shipped package answered `unknown_automation`.
- The portal ADDRESS is the tenant's, and one field moves both halves: the ceremony opens there and
  the automations navigate there. They cannot disagree, which matters because a captured session is
  bound to the origin its ceremony opened.
- A trigger for a package listener is created as a POLLED LISTENER and the supervisor runs it. It
  used to be created as a webhook nothing polls and no endpoint calls - connected-looking and dead.
- Chat reaches the right action by itself. Nothing was wired for this; the chat run class already
  carries `list_integration_actions` + `call_integration_action`.

## Where the proof stops, exactly

Every leg above ends at the same honest refusal:

    no machine is paired to your account, and this step runs only on one -
    pair a machine, then establish this session from it

Nothing has yet returned a real notification or a real document, from the fixture OR from the real
portal, because that needs a paired machine with a human at it. The learn -> replay -> drift ->
self-heal legs, the inbox write, and the list-then-fetch conversation are all UNPROVEN against data.
`runbook.md` steps 1 and 3 are the two human steps that unblock them.

Do not read the proofs above as "Citius works". Read them as "everything up to the login wall
works, and the login wall is now the only thing in the way" - which is exactly what the cornerstone
runbook said before its own ceremony, and the last time that sentence was written it hid four
defects that only a real session could reveal.
