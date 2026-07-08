# F6: No JSON catch-all 404 + ACCOUNT_DISABLED message differs by plane

**Severity / class:** medium / bug

**Symptom:** Any unmounted `/api/v1/*` path returns Express default HTML, violating the QA-block
invariant that every non-2xx body validates against the shared error envelope. Separately, the
`ACCOUNT_DISABLED` message differs by plane: REST returns "A sua conta está bloqueada. Contacte o
suporte." while the SSE/streaming plane returns a generic "Não autorizado." Evidence:
`docs/release/evidence/J1-auth/j1-auth.json` (refresh/logout HTML bodies); `J0-contract-sweep/
sweep.json` `bodyKind:"html"` rows.

**Root cause:**
- No terminal envelope 404 middleware: `api/src/server.ts` ends its mount block with the `/` legal,
  serving and dev-serve routers (`server.ts:514-536`) and returns the app (`:538`) with no final
  `app.use((req,res) => envelope 404)`. Unmatched `/api/v1/*` paths fall through to Express's default
  HTML 404 (confirmed by every `bodyKind:"html"` notMounted row in the sweep).
- The SSE/streaming plane hard-codes a generic auth message instead of surfacing the real code's
  message: `api/src/routes/chat.ts:21`, `api/src/routes/jobs.ts:20`, `api/src/routes/notifications.ts:15`,
  `api/src/routes/automations.ts:73` all return `message:'Não autorizado.'` for any `!auth.ok`, whereas
  the REST middleware returns the specific disabled-account sentence
  (`api/src/auth/middleware.ts:42`, `auth/service.ts:75`).

**Fix scope:**
- Add a terminal JSON-envelope 404 handler mounted AFTER all routers in `api/src/server.ts` (scoped so
  it does not swallow the `/apps/*` SPA fallbacks or legal/serving `/` routes - key it on the API
  prefixes, or mount it just after the `/api` routers and before the `/` app-serving routers).
- Unify the disabled-account message on the streaming plane: map the auth failure `code` to the same
  envelope message the REST middleware uses (reuse one shared mapping helper rather than the literal
  `'Não autorizado.'`). NON-goals: do not change auth semantics or status codes; do not alter the
  `/apps/*` asset-vs-navigation 404 behavior in `apps/serving.ts`.

**Regression test first:** contract test `api/tests/contract/error-envelope.test.ts` (in-process
factory): (1) an unknown `/api/v1/does-not-exist` returns a body that validates against the shared error
envelope (not HTML), for GET and POST; (2) a deactivated user hitting a REST route and an SSE route
receives the SAME `ACCOUNT_DISABLED` message. Both must fail before the fix. This is the natural partner
of the F5 mount-coverage test (envelope-vs-html becomes the mounted signal).

**Acceptance:** every unmounted `/api/v1/*` path returns the shared error envelope with the correct
`code`; the disabled-account message is identical across REST and SSE; contract suite + protocol-parity
gate green; no regression in `/apps/*` serving.

**Notes:** the envelope helper is the ONE common non-2xx validator (ekoa-testing) - route the 404 through
it. No LLM/import-boundary impact. If a middleware layer is added to the request pipeline, update the
ch02/ch03 request-flow diagram (FIXED-12).
