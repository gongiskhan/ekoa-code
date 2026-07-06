---
name: ekoa-testing
description: How to test any change in ekoa-code — the five-layer strategy, the CI per-PR lane, contract-test mechanism, suite ledger rules, named security/privacy suite classes. Load BEFORE writing tests or claiming a gate green. Do NOT use for module layout (that is ekoa-architecture) or gate/commit mechanics (that is ekoa-governance).
---

# ekoa-testing

Normative source: `spec/13-test-review-strategy.md` (whole) + `spec/reference/test-audit.md`.

## The per-PR CI lane (every gate requires it green — ch13 §13.9)
1. Install; boundary lint; chokepoint grep gate; `ENCRYPTION_KEY` default-constant grep gate.
2. Typecheck `shared/`, `api/`, `web/`.
3. Unit/module tests: `api/` vitest, `web/` vitest.
4. Contract suite: `api/tests/contract/`, supertest against the in-process app factory over `mongodb-memory-server`; ends with the schema-coverage gate (every `shared/` schema exercised or CI fails listing them) and the protocol-parity gate; includes the deterministic security/activation classes (cross-org adversarial, in-org sharing, activation, Registo metadata-only, rate-limit/spend-cap, payload-capture vs stubbed provider, fake-daemon suites) — all LLM-free.
5. Build `web/`, build `api/`.
6. Playwright e2e against the booted stack; LLM-dependent specs skip cleanly.
7. Suite-ledger check (`api/tests/SUITE_LEDGER.json`): every skip ledger-scoped; due = green; ratchet (once green never red/skip again).
8. Significance labeler (shared/, auth/, billing/, llm/, collections engine, >300 non-test lines, ch09 enforcement points → adversarial review required).

## Binding rules
- Every endpoint: ≥1 contract test validating the response with its named `shared/` schema via `safeParse`. Every non-2xx: validated against the error envelope by the ONE common helper.
- Every SSE event parses against `shared/events.ts` unions. No `text_chunk` may contain a delegation-marker substring (including split across chunks).
- Modules travel with their tests — a module change without its tests fails review.
- E2e: real UI login per spec, `fullyParallel: false`, one worker, no protocol stubs except schema-validated ones, zero-console-errors where the old specs assert it.
- Ported specs are NEVER edited to make them pass (byte-compat failures are product defects); the 37 served-app specs run unmodified.
- Synthetic test data only: checksum-INVALID fakes (a valid fake NIF may be a real person's). Never real client data.
- Discovery/vision QA tooling never imports product `llm/` and holds no product credentials.
