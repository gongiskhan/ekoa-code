# Citius acceptance loop - LIVE results (dev-madrid, 2026-09-01)

The four legs `evidence/citius/runbook.md` promises, all observed live against the committed
fixture for the first time on any machine. Every number below is from the run records and the
recipe row, not estimated.

## The ceremony (runbook step 3)

Establish from `/cofre?origin=127.0.0.1&siteUrl=http://127.0.0.1:45190` opened a REAL Chrome
window at the FIXTURE address (the rebuilt daemon's siteUrl fix); login cedula `12345` /
`demo123`; "Concluir e capturar" -> `Sessão capturada e enviada para o cofre`, item bound to
`127.0.0.1`, `boundEgress residential` on this machine's own pairing, checked out by every
subsequent run (the 975fba2a egress half plus this session's gate fix).

## Leg 1 - LEARN

`consultar_notificacoes` halted `needs_credentials` at the wall; after the ceremony the parked run
resumed and completed; the K3 background learn-armed re-execution drove all 8 authored steps
through the authenticated portal (vision), captured 4 exchanges, compiled 2 injectable calls, and
stored **recipe v1** on a materialised `recipe-overlay` carrier row (D-RECIPE-OVERLAY - the org
runs the SHIPPED package and has no definition row of its own).

    urlTemplate : http://127.0.0.1:45190/api/notificacoes?pagina=1
    headerNames : accept-language, referer, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, user-agent
    (names ONLY - the header-names-only rule held on the wire)
    learnedRunMs: 130694

## Leg 2 - REPLAY, zero model calls

    success: true
    replay : { replayed: true, recipeVersion: 1, durationMs: 50950 }
    stats  : { replayCount: 1, learnedRunMs: 130694, lastReplayMs: 50950 }

2.6x faster than the learning pass, no vision, no model. (The 51s includes the browser lease
cold-start; see leg 4 for the warm number.)

## Leg 3 - DRIFT

Fixture restarted with `EKOA_FIXTURE_BREAK=1` (private API moved `/api` -> `/api/v2`; its sessions
persisted, so the break moved exactly one variable). The replay's expectation failed:

    replay : { replayed: false }   <- fell back to the authored run
    run    : 8 step(s) completed (65s) - the answer still arrived

## Leg 4 - SELF-HEAL

The drift routed the fresh compile through the SUPERSEDE:

    version    : 2
    supersedes : { version: 1, reason: "replayed call 1 answered 404" }
    urlTemplate: http://127.0.0.1:45190/api/v2/notificacoes?pagina=1   <- re-learned the moved endpoint

And the healed recipe replays:

    replay : { replayed: true, recipeVersion: 2, durationMs: 634 }

**131 seconds of vision on first contact; 634 milliseconds deterministic after the heal.**

## The surface

The action detail page shows the **Receita v2** badge (`05-receita-v2-badge.png`).

## What it took (the defects between the Mac's handoff and this page)

Committed this session, each with its regression test: the configValues seam drop, the
no-destination navigate guard (the fixer-relocation entry), the listener blocked-cadence merge,
the StrictMode canvas token burn, resume losing {{config.*}}, the credential gate reading authored
steps, config-published values being secret-registered (the redactor ate every captured URL), and
D-RECIPE-OVERLAY itself. See docs/findings.md 2026-09-01 sections and docs/decisions.md
D-RECIPE-OVERLAY.

## The inbox rail (runbook section 5, first half) - ARMED live

The `notificacao.recebida` listener's first poll hit the pre-ceremony wall and PARKED (the blocked
cadence - one attempt, then 15 minutes of silence, exactly as `210c331` promises). Its second poll,
15 minutes later, went through the captured session:

    [listener-supervisor] cursor did not advance - the provider returned no "highWater" yet;
                          the listener is armed and will deliver everything it sees from now on
    listener_state: { cursor: { initializedAt: "2026-09-01T20:04:04Z" }, failures: 0 }

The 5 pre-existing notifications were correctly NOT backfilled (the no-backfill boundary pinned at
initialization). The remaining observation - a NEW notification flowing through the queue into
`legal-citius`/`onNotificacaoCitius` triage - needs a notification to arrive after arming plus the
next poll cycle; that dispatch path stays proven by the deterministic suites (the S9 reference
schedule and the artifact handler tests).

## Documents in conversation (runbook section 5, second half) - the tool flow works, the names gap is real

Chat, asked "Que documentos tem o processo 1234/26.0T8LSB no Citius?", reached for
`call_integration_action` -> `citius.listar_documentos_processo` unprompted (the K5 catalog tools
doing their job) and the 9-step automation COMPLETED against the authenticated portal. But the
names never reached the chat window: a browser-only vision run records no structured step output,
so `extractActionRunOutput` answers null and the agent could only promise a follow-up. The
structured answer arrives exactly when the action learns its recipe (an injected-call replay
carries the response body - the notificacoes action already answers this way). Same class as the
S9 ladder notes on `extractActionRunOutput`'s api_call/ekoa_action-only semantics.
