# Secure development policy

One page (security addendum E.5; spec ch09 §9.8-B/D/E, ch13, ch14). Grows into the ISMS at certification phase (§9.9).

## Change management (E2)

All change lands through the gated build process: spec-first, append-only `RUN_LOG.md`, checkpoint commits and tags per gate, and dual-model review (fresh-context Claude review on every gate; adversarial cross-model review on security-relevant surfaces). This process is itself the auditable change-management evidence; certification cites it rather than a parallel system.

## Structural enforcement (lint + CI, ch02 §2.9)

- Import boundaries: `web/` ↔ `api/` never import each other; `shared/` imports nothing outside itself (ESLint zones, CI-fatal).
- LLM egress chokepoint: provider SDKs and endpoints are importable only inside `api/src/llm/`; a belt-and-braces grep gate catches raw references outside it. Subprocess spawns are pinned to the chokepoint via base URL, build-checked.
- Module direction: routes never touch `data/`; seams are injected only at the composition root.

## Input and output handling

- Boundary validation via the shared zod contract on every request (D2): the contract is simultaneously the input schema and the injection defence. Non-2xx bodies validate against the shared error envelope.
- All model output and user content is untrusted input (B1): nothing model-generated is interpolated into queries, shell commands, or privileged calls without validation; generated apps are static client bundles under strict CSP, no server-side eval ever (B2).
- Outbound fetches of user-supplied URLs pass the SSRF guard (invariant 8); webhooks verify HMAC, dedup, and audit (invariant 9).
- No secrets, keys, or org data in system prompts (B4).

## CI security gates (D4, run on every lane)

gitleaks (secrets), Semgrep (SAST), `npm audit` severity gate, the boundary/chokepoint grep gates, plus the named security suites: cross-org adversarial, in-org sharing, rate-limit/spend-cap at the chokepoint, anonymisation payload-capture (tokens-only egress), and the bridge S1-S6 adversarial scenarios.

## Dependencies (D3)

Lockfiles committed; automated audit and update PRs; minimal surface. Every package an agent adds is verified to exist, be maintained, and be the intended package before install (phantom/typosquat defence), noted in the gate entry.

## Secrets

Managed secret store only (GCP Secret Manager in prod; bootstrap-generated env key in dev). Mandatory-key boot gates fail closed on default or missing secrets (invariant 11); gitleaks guards the repo; rotation is documented per secret.

## The determinism ratchet

Every accepted review or incident finding ships, in the same fix, a deterministic guard (test, lint rule, Semgrep pattern, or grep gate) where the class is mechanically expressible, so reviews trend toward judgment-only and regressions are machine-caught.
