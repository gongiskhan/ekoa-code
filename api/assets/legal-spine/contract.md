# Legal Edition — Spine Contract v1

The **single versioned contract** every pack app honours. The pack apps (Núcleo,
Prazos, Caixa Citius, Honorários, Contratos, Dossiê) are separate artifacts that
all read/write these collections in the **account-shared** namespace
(`window.__ekoa.shared.*` / `ekoa.appData.shared.*`, opt-in `manifest.sharedData:true`,
scoped to the owner). Because the apps are built independently, schema drift
between them silently corrupts shared data — so this contract is copied into each
app's scaffold from `ekoa-data/legal-spine/` and is the source of truth.

## Collections (all SHARED) + foreign keys

```
clientes (root)
  └─ processos.clienteId → clientes.id
       ├─ prazos.processoId        → processos.id
       ├─ documentos.processoId    → processos.id
       ├─ eventos.processoId       → processos.id   (timeline)
       ├─ lancamentos.processoId   → processos.id   (honorários; pré-faturas only)
       └─ tarefas.processoId       → processos.id   (optional FK; standalone tasks allowed)
```

Field shapes are documented in `spine.mjs` (the store is schemaless; `*` = required).
**Portugal conventions** — `nif` (não CPF), `tribunal`/`comarca`, `numeroProcesso`,
`area`, `estado`. Strings PT-PT, no emoji.

## Seeding rule
Only the **Núcleo** seeds the spine — `useSharedCollection(name, { seed, seedOnEmpty: true })`,
once, when empty. Satellites pass `{ seedOnEmpty: false }` and never seed; they read
what the Núcleo wrote (or show empty until it has). The canonical seed is
`seed-data.json` (FK-coherent, validated by `validateSeed`).

## Shared vs app-local
The seven collections above are the SHARED spine. An app's own UI state / drafts
(e.g. a Citius reconciliation note, a Contratos draft buffer) stay in that app's
**private** per-app data (`window.__ekoa.*`, default isolation), never in the spine.

## Files
- `spine.mjs` — `SPINE_COLLECTIONS`, `SPINE_FKS`, `SHARED_COLLECTIONS`, `shouldSeed`, `validateSeed` (pure; testable).
- `use-shared-collection.js` — the React data hook over `window.__ekoa.shared`.
- `seed-data.json` — the canonical PT-PT demo seed (Núcleo only).

Versioning: additive changes (new optional fields) are backward-compatible. A
breaking change is a new `spine-v2` + a migration; never silently change a field's
meaning while v1 apps still read it.
