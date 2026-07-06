# Legal Edition — shared engines

Deterministic, **zero-retrieval** pure-function libraries used by the pack apps'
artifact-backends. One canonical source here; each app's `scaffold/backend/`
imports the file it needs, and esbuild bundles it into that app's
`dist-backend/backend.mjs` (no cross-app RPC, single source of truth).

Each engine **computes only** (no I/O). The artifact-backend handler runs the
engine, then writes results into the shared spine via `ekoa.appData.shared.*`.

| File | Engine | Built in slice | Used by |
|------|--------|----------------|---------|
| `prazo.mjs` | CPC deadline engine (dias úteis vs corridos, suspensão em férias judiciais, art. 139.º multa, shows-its-work, parallel-run) | S1-prazos | Prazos, Caixa Citius |
| `citius-parser.mjs` | Conservative Citius notification parser (processo/ato/data; unparseable → needs-review, never a guess) | S2-citius | Caixa Citius |
| `honorarios.mjs` | Retenção-na-fonte + IVA calc (shows-its-work) → **pré-fatura only** | S6-honorarios | Honorários |

All engines are deterministic and have committed golden-value unit tests. No
network, no LLM, no clock surprises (dates passed in explicitly).
