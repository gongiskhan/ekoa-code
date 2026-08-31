# Cornerstone live acceptance - what was proven, 2026-08-31

Machine: goncalos-macbook-pro (Apple Silicon). Stack: main + three fixes made during this run.
Fixture: evidence/cornerstone/fixture-portal.mjs on http://127.0.0.1:45180 (demo/demo123), never restarted.

## Runbook legs

| Leg | Before today | Now |
|---|---|---|
| free-text goal mints a per-site integration | live-confirmed previously | PROVEN (goal box -> /integrations/127-0-0-1-45180) |
| honest needs_credentials halt | live-confirmed previously | PROVEN |
| ceremony opens at the portal | NEVER (opened https://127.0.0.1, timed out) | PROVEN |
| human login + session capture | NEVER | PROVEN (Cofre item bound 127.0.0.1) |
| session checked out + injected into the run | NEVER | PROVEN |
| run completes past the login wall | NEVER | PROVEN (4 steps completed) |
| recipe learned, header names only | NEVER | PROVEN (v1) |
| second run replays with ZERO model calls, faster | NEVER | NOT PROVEN - see findings |
| drift detected -> supersede | NEVER | PROVEN (v2), but on a FALSE drift |

## The completed run
```json
{"success":true,"data":{"runId":"54dcc625-ddf6-4d9d-9892-72a769b46947","status":"completed","summary":"4 step(s) completed"}}
```

## The learned recipe (runbook step 3)
```json
{
    "items": [
        {
            "key": "127-0-0-1-45180",
            "actionName": "listar_os_pedidos_pendentes_em_http_127_45180_painel",
            "version": 2,
            "compiledAt": "2026-08-31T10:36:54.516Z",
            "calls": [
                "GET http://127.0.0.1:45180/api/pedidos"
            ],
            "lessons": [],
            "supersedes": {
                "version": 1,
                "reason": "replayed call 1 answered 401"
            },
            "replayCount": 0,
            "learnedRunMs": 3325
        }
    ]
}
```

v1 carried calls: ["GET http://127.0.0.1:45180/api/pedidos"] with NO header values - the runbook's
step-3 expectation met exactly. v2 supersedes v1 with reason "replayed call 1 answered 401",
which is a FALSE drift: the fixture never changed. See the OPEN finding
`a-recipe-replay-carries-no-cofre-session-so-a-401-is-misread-as-drift`.

## Fixes made to get here
1. Ceremony opened https://<host>:443 - could not reach any http/non-default-port portal (shared/api/web/bridge, + CeremonySiteUrl).
2. No bridge could advertise egress.residential without external proxy infrastructure, so a ceremony session could not be checked out on the machine that made it (new clients/bridge/src/egress/proxy.ts).
3. captureOp:'start' took the run lease with no session thunk, so a LEARNING run was always signed out (clients/bridge/src/runtime/tool-executor.ts).
