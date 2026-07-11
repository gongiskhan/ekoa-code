---
name: ekoa-testing
description: How to test any change in ekoa-code — the five-layer strategy, the CI per-PR lane, contract-test mechanism, suite ledger rules, named security/privacy suite classes. Load BEFORE writing tests or claiming a change verified. Do NOT use for module layout (that is ekoa-architecture) or governance/journaling (that is ekoa-governance).
---

# ekoa-testing

Normative source: `docs/testing.md` (the five-layer QA process + the estate map).

## The per-PR CI lane (every change requires it green)
1. Install; boundary lint; chokepoint grep gate; `ENCRYPTION_KEY` default-constant grep gate.
2. Typecheck `shared/`, `api/`, `web/`.
3. Unit/module tests: `api/` vitest, `web/` vitest.
4. Contract suite: `api/tests/contract/`, supertest against the in-process app factory over `mongodb-memory-server`; ends with the schema-coverage gate (endpoint-keyed COVERED/PENDING accounting — a hand-maintained CLAIM, see the honor-system caveat in `docs/testing.md`), the mount-coverage gate (DESCOPED shrink-only) and the protocol-parity gate; includes the deterministic security/activation classes (cross-org adversarial, in-org sharing, activation, Registo metadata-only, rate-limit/spend-cap, payload-capture vs stubbed provider, fake-daemon suites) — all LLM-free.
5. Build `web/`, build `api/`.
6. Playwright e2e against the booted stack; LLM-dependent specs skip cleanly.
7. Suite-ledger check (`api/tests/SUITE_LEDGER.json` via `scripts/suite-ledger-run.mjs`): strict count census (specs, drivers, frontend unit files) in both directions; every skip ledger-scoped; due = green; ratchet (once green never red/skip again). A NEW spec/unit file MUST be registered in the ledger in the same change.
8. Significance labeler (shared/, auth/, billing/, llm/, collections engine, >300 non-test lines, security enforcement points → adversarial cross-model review required).

## Binding rules
- Every endpoint: ≥1 contract test validating the response with its named `shared/` schema via `safeParse`. Every non-2xx: validated against the error envelope by the ONE common helper. New endpoint = contract test in the same PR.
- Every SSE event parses against `shared/events.ts` unions. No `text_chunk` may contain a delegation-marker substring (including split across chunks).
- Modules travel with their tests — a module change without its tests fails review.
- E2e: real UI login, `fullyParallel: false`, one worker, no protocol stubs except schema-validated ones, zero console errors on dashboard pages (track 4xx by URL — see `docs/testing.md` for the next-dev asset-noise pattern). Playwright stubs against the cross-origin api MUST carry CORS headers (fulfilled responses still pass browser CORS).
- Ported specs are NEVER edited to make them pass (byte-compat failures are product defects); the 37 served-app specs run unmodified.
- Synthetic test data only: checksum-INVALID fakes (a valid fake NIF may be a real person's). Never real client data.
- Discovery/vision QA tooling never imports product `llm/` and holds no product credentials.

## Live verification (running the real thing)
The dev api serves `api/dist`: after api changes, `npm run build --workspace api`, restart the stack (`.claude/skills/run-ekoa-code/driver.mjs up`), then RE-PROVISION the model credential (`provision-credential.mjs` — the dev Mongo is ephemeral). The journey probe kit lives in `api/tests/journeys/` (node scripts against a live stack).
