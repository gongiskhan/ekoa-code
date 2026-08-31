# Citius / eTribunal: driving the shipped package end to end

The acceptance loop for the `citius` integration package, against the committed fixture
(`evidence/citius/fixture-portal.mjs`). Sibling of `evidence/cornerstone/runbook.md`, and it assumes
that one has been done: the Cofre, the attended ceremony and the recipe learn/replay/self-heal rail
are its machinery, not its subject.

## What this proves, and what it does not

PROVES: that a SHIPPED integration package - one whose actions, automation templates, listener and
session-connect block are repo content, not something authored in a builder - can be connected,
provisioned, authenticated once by a human, and then run; and that the second run of a read action
replays from a compiled recipe with zero model calls.

DOES NOT PROVE anything about the real portal's DOM. The fixture's pages are server-rendered shells
whose own JS fetches a private JSON API, which is the shape of the rebuilt eTribunal mandatario area
but is an ASSUMPTION (the fixture's own header says so). If the real portal turns out to be
server-rendered with no JSON underneath, the vision path still works and the recipe simply compiles
no injected calls: slower and costlier every run, not wrong.

## Why a fixture rather than the real portal

`portal.tribunais.org.pt` authenticates with an Ordem dos Advogados certificate or Chave Movel
Digital. Both are interactive and both are two-factor, so every attempt costs a human a physical
authentication and cannot be an inner loop. Driving a scraper repeatedly against a live national
court portal to debug our own code is also not a thing to do. The rail is proven here; the real
portal is met once, attended, with the rail already known to work.

## 0. The stack

```bash
npm run build --workspace shared && npm run build --workspace api
node .claude/skills/run-ekoa-code/driver.mjs up          # API :4211 (proxy :4111), web :3000
node scripts/dev-credential.mjs --provision --no-browser # model credential, EVERY boot
node evidence/citius/fixture-portal.mjs                  # the portal stand-in, :45190
```

Boot is ~100s on a large `~/.ekoa/data`. If it never answers, read the gotcha in
`.claude/skills/run-ekoa-code/SKILL.md`: a slow boot used to die as an EPIPE from the mongo driver.

## 1. Pair a machine and grant it (needs a human)

The dev Mongo is ephemeral, so a stack restart destroys the pairing RECORD even though
`~/.ekoa-bridge/config.json` still holds the device's side of it. Both halves are needed.

```bash
cd clients/bridge
node dist/cli/index.js pair --url http://localhost:4111   # device login; approve in the browser
EKOA_CEREMONY_NO_STREAM=1 node dist/cli/index.js serve
```

Then, in the dashboard, **Settings -> Devices**: grant the machine its capabilities.
**Advertising is only half.** The daemon advertises what its config allows
(`extraCapabilities: ["desktop.automation"]` is a deliberate tier-2 opt-in that exists only as a
config-file edit); Cortex intersects that with a PER-ORG GRANT which defaults to deny. A re-pair
silently drops the grant, so re-granting is part of re-pairing, not a separate rare event.

Confirm both halves: `curl -s :4211/health` must report `bridgeConnections: 1`, and
`GET /api/v1/integrations/citius/session` must report `sessionConnect.available: true`. If it says
"Nenhuma maquina ligada" the socket is missing; if it says the bridge is "demasiado antiga" the
capability is not advertised or not granted.

## 2. Connect the integration AT THE FIXTURE

The address is configuration, not a constant: `portal_url` drives both the ceremony and every
automation's `navigate` step (`{{config.portal_url}}`). They must move together - a session is bound
to the origin its ceremony opened, so a session banked at one address cannot be checked out by a run
driving another.

```bash
node evidence/citius/proof.mjs      # login, connect, read the session block, provision, run
```

Step 3 of its output must print the fixture address. If it prints `https://portal.tribunais.org.pt`
the config did not take, and going further would open a REAL court portal.

## 3. The ceremony (needs a human)

From the integration's page, start the session capture. A real Chrome window opens on the paired
machine at the fixture. Log in: **cedula `12345`, palavra-passe `demo123`**. Press
"Concluir e capturar".

## 4. The four legs

1. **Learn.** Run `consultar_notificacoes`. The authored steps drive the portal through vision; the
   run compiles a recipe from the calls the page made. Expect a "Receita v1" badge on the action,
   naming header NAMES only and no values.
2. **Replay.** Run it again. Expect zero model calls and a materially faster run.
3. **Drift.** Restart the fixture with `EKOA_FIXTURE_BREAK=1`, which moves the private API from
   `/api` to `/api/v2` and rewrites the page JS to match. It changes NOTHING else - in particular the
   fixture persists its sessions across a restart, so the break flag moves exactly one variable and
   the run meets a moved endpoint rather than a login wall.
4. **Self-heal.** Run it again. The replay's expectation fails, the run falls back to vision,
   re-learns against `/api/v2/pedidos`, and the recipe supersedes to v2 with the reason recorded.

## 5. The two halves the package exists for

- **The inbox.** The listener polls `consultar_notificacoes` and dispatches each NEW notification to
  the `legal-citius` artifact's `onNotificacaoCitius` handler, which runs the same triage engine the
  email intake runs. A notification whose stated data-limite disagrees with our own computation goes
  to review with both dates named - never resolved by picking a winner.
- **The documents, in conversation.** Ask chat for a process's documents: it calls
  `listar_documentos_processo` (enumerate only, no downloads) and shows the names. Name one and it
  calls `obter_documento`, which matches by reference first and then by name, and refuses to choose
  when the name is ambiguous.
