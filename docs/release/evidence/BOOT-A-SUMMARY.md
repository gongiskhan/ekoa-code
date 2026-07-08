# BOOT-A probe summary

Live stack: api `http://localhost:4111` (proxy), web `:3000`. Seeded super-admin `admin/tmp12345`.
In-memory Mongo (state within this boot only). LLM chokepoint credential-less
(`health.claudeAuth.configured=false`) — the expected honest-degradation baseline.

All assertions print `PASS|FAIL|INFO <id> <detail>`; FAIL is evidence, not a crash. Every probe
exited 0. Evidence JSON per journey under `docs/release/evidence/<journey>/`.

Classification note: `INFO` = a recorded observation or a deliberate contract-vs-code capture, not
a defect verdict (severity is the director's call). No probe emitted a FAIL.

---

## J1-auth (`docs/release/evidence/J1-auth/j1-auth.json`)

| id | result | evidence |
|----|--------|----------|
| J1a.login | PASS | admin login 200 + token |
| J1a.me | PASS | me 200, role=super-admin |
| J1b.refresh | INFO | POST /auth/refresh -> **404 HTML** (contract declares 200; route unmounted) |
| J1c.logout | INFO | POST /auth/logout -> **404 HTML** (unmounted) |
| J1c.revocation | INFO | token STILL VALID after logout (no server-side revocation; logout isn't mounted) |
| J1d.badcred | PASS | bad login -> 401 UNAUTHENTICATED envelope |
| J1d.garbage | PASS | garbage Bearer -> 401 valid envelope |
| J1e.org | PASS | created org ProbeA |
| J1e.user | PASS | created builder pa-u1 |
| J1e.paLogin | PASS | pa-u1 login+me 200 |
| J1f.deactivate | INFO | PATCH active:false -> 200 |
| J1f.rest | PASS | disabled REST GET /sessions -> 403 ACCOUNT_DISABLED, msg contains 'bloqueada' |
| J1f.sse | PASS | disabled SSE notifications -> 403 ACCOUNT_DISABLED (msg "Não autorizado." — generic, differs from REST) |
| J1f.me | INFO | disabled /auth/me -> **403 ACCOUNT_DISABLED** (brief expected 401; activation is checked before the epoch) |
| J1g.reactivate | PASS | reactivate -> fresh login+me 200 |
| J1h.password | INFO | POST /auth/password -> **404 HTML** (unmounted) |
| J1h.device | INFO | POST /auth/device -> **404 HTML** (unmounted) |
| J1i.userpw | INFO | POST /users/:id/password -> **404 HTML** (declared super-admin; unmounted) |

## J5-isolation (`docs/release/evidence/J5-isolation/j5-isolation.json`)

| id | result | evidence |
|----|--------|----------|
| J5.setupX / setupY | PASS | both org-admins created directly via POST /users role=org-admin |
| J5.kseedX / kseedY | PASS | knowledge docs seeded per org |
| J5.klistX | PASS | IsoX lists only ["Segredo X"] |
| J5.klistY | PASS | IsoY lists only ["Segredo Y"] |
| J5.kcross | PASS | IsoY cross-org DELETE of IsoX doc -> 404 NOT_FOUND (no GET-by-id endpoint; delete used as access proxy) |
| J5.memcreate | PASS | IsoX memory created, visibility=private (default) |
| J5.memlistY | PASS | IsoY memory list excludes IsoX memory |
| J5.memgetY | PASS | IsoY GET IsoX memory by id -> 404 |
| J5.registoX | INFO | org-admin registo 200 but **0 rows**; RegistoEntry exposes no orgId field |
| J5.registoSuperY | PASS | super-admin registo?orgId=IsoY -> 200, 0 rows |
| J5.brandReal | PASS | PUT **/api/v1/org/branding** (real mount) -> 200 primaryColor #FF0044 |
| J5.brandContract | INFO | PUT **/api/v1/branding** (contract path) -> **404 HTML** (mount path differs from contract) |
| J5.tokens | PASS | design-tokens.css neutral default --color-primary=#0F766E (org color NOT leaked) |

## J8-webhooks (`docs/release/evidence/J8-webhooks/j8-webhooks.json`)

| id | result | evidence |
|----|--------|----------|
| J8.auto | PASS | automation created (super-admin passes creation gate) |
| J8.trigger | PASS | trigger created, publicUrl + secret (once) captured |
| J8.algorithm | INFO | trigger-create response has **no `algorithm` field** (brief expected one; contract has none) |
| J8a.valid | PASS | valid sig -> 200 {accepted:true} |
| J8b.replay | PASS | exact byte replay -> 200 {duplicate:true} |
| J8c.badsig | PASS | wrong sig -> 401 UNAUTHENTICATED |
| J8d.sha1prefix | PASS | correct digest under sha1= prefix -> 401 (mismatched sha-family rejected) |
| J8e.unknown | PASS | unknown trigger -> 404 NOT_FOUND |
| J8f.disable | INFO | **no REST disable endpoint** (triggers router = GET/POST/DELETE only); 410 disabled-path only in the unit test |
| J8g.run | INFO | webhook spawned 1 run, status=**completed** (no-step automation needs no model call) |

## J0-degradation (`docs/release/evidence/J0-degradation/j0-degradation.json`)

| id | result | evidence |
|----|--------|----------|
| J0a.health | PASS | claudeAuth.configured=false |
| J0b.create | PASS | chat run 202 |
| J0b.terminal | PASS | chat terminal='error' code=ADAPTER_ERROR msg="No model credential configured for this environment (ch06 §6.2)." |
| J0c.create | PASS | build job 202 created |
| J0c.terminal | INFO | build terminal='error' code=ADAPTER_ERROR msg="A construção falhou." frames=[ready,routing,error] |
| J0c.jobrecord | INFO | GET /jobs/:id -> status=**failed**, artifactId present, error field absent |
| J0c.artifact | INFO | artifact row created (name set), health=none |
| J0c.servedpage | INFO | owner (Bearer or ?token=) sees 200 **scaffold shell**; anon sees **410** "revogou a partilha" |
| J0d.usage | PASS | billing usage zero-state (tokensUsed=0, balanceUsd=0, tokenLimit=null) |
| J0d.history | INFO | billing history 200, 0 entries |
| J0e.research | INFO | POST /branding/research -> **404 HTML** (contract endpoint unimplemented) |

## J9-billing (`docs/release/evidence/J9-billing/j9-billing.json`)

| id | result | evidence |
|----|--------|----------|
| J9.adminUsage | PASS | admin usage tokensUsed=0 balanceUsd=0 tokenLimit=null overage=false |
| J9.adminHistory | INFO | 0 entries |
| J9.userUsage | PASS | probe-user usage zero-state |
| J9.userHistory | INFO | 0 entries |
| J9.metering | PASS | meteringAnomalies=0, gatewayUnmeteredCalls=0 (clean pre-call baseline) |

## J0-contract-sweep (`docs/release/evidence/J0-contract-sweep/sweep.json`)

167 declared endpoints enumerated from `shared/src/*.ts`. **135 mounted, 32 flagged.**
31 are genuinely unmounted (Express HTML 404, no route matched). 1 is a classification caveat:
`GET /api/v1/oauth/:provider/callback` returns **200 HTML** — it IS mounted (oauthCallbackRouter)
and serves an HTML callback page by design, so the HTML classifier false-flagged it.

Genuinely unmounted (declared in shared/ but no route responds):

- **auth**: `/auth/refresh`, `/auth/password`, `/auth/device`, `/auth/device/poll`, `/auth/device/approve`, `/auth/logout` (router mounts only login + me)
- **org**: `PUT /api/v1/branding`, `POST /api/v1/branding/research` (real mount is `/api/v1/org/branding`; research has no mount at all)
- **users**: `POST /api/v1/users/:id/password`
- **memories**: `POST /api/v1/memories/bulk-delete`, `POST /api/v1/memories/signals`
- **knowledge**: `PATCH /knowledge/sources/:id`, `POST|GET /knowledge/sources/:id/crawl`, `GET /knowledge/refresh-schedule`
- **sessions**: `POST /api/v1/sessions/:id/seed-featured`
- **triggers**: `GET /api/v1/automations/:id/triggers`
- **integrations**: `GET|POST /integrations/:key/session`, `POST /integrations/:key/provision-automations`
- **uploads** (whole domain unmounted): `POST /api/v1/uploads`
- **app-assistant** (whole domain unmounted): `POST /api/app-assistant`
- **integration-builder** (whole domain unmounted): `/integration-builder/chat`, `GET|PUT /integration-builder/package`, `/integration-builder/test`
- **ekoa-local** (whole domain unmounted): `/agent-face/run`, `/agent-face/cancel`, `GET /bridge/connect/:id`, `POST /bridge/debug-invoke`, `GET /api/v1/events`
