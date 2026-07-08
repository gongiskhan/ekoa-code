# Build#2 verification-theater (director-verified on disk)

Boot B, credentialed, EKOA_LLM_DIRECT=1. Artifact `5f41baa8-...` (build#1 verify OFF, build#2 verify ON,
follow-up on the same project). ProjectDir:
`~/.ekoa/sandboxes/user-32c2e8cf-.../5f41baa8-0d2e-4fbc-9606-afa2cba92d8d`.

## What build#2 (verifyBuilds=true) reported
- SSE `complete` after 315s; verification banner `plan_step {status:verifying, "A testar a aplicação..."}` present.
- `build-verify` billed 8155 tokens (own row, J3.billing.buildVerify PASS).
- No `verifyNote` appended to `complete.result` -> verification PASSED.

## What is actually on disk (git log: 3493259 scaffold -> 1c6da6b Build#1 -> e5634ce Build#2)
| File | mtime (UTC) | content |
|------|-------------|---------|
| `frontend/src/App.jsx` (manifest entrypoint -> dist) | 18:28:35 = build#1 time | UNTOUCHED by build#2; still scaffold (scaffold x9, "change" x1). |
| `pessoa.html` (orphaned standalone, never served) | 18:33:49 = build#2 | build#2 edited THIS: contador x3, "Citações mostradas" x2 - the requested counter went here. |
| `dist/bundle.js` (the SERVED bundle) | 18:33:54 = build#2 rebuild | compiled from scaffold App.jsx: scaffold x9, "being created" x1, "change" x98; ZERO Pessoa/contador. |

## Verdict
Build#2 rebuilt `dist/` but from the untouched scaffold `App.jsx`, so the SERVED app remained the Ekoa
scaffold placeholder. The model again wrote real work into the orphaned `pessoa.html`. Per-build
verification (the safety net that exists to catch exactly this) drove the served scaffold and PASSED,
and the user was billed `build-verify` for that pass. Verification gives FALSE assurance: it did not
detect that the served application does not fulfil the request and is a placeholder.

This is distinct from F16 (build reports completed but serves scaffold). F16 is the build defect; this
is the verification defect - the gate that should have failed the build passed it.
