# Salomao ERP dev-seed fixture (NOT committed)

`salomao-bundle.json` here is the CONVERTED legal-case-manager-3 bundle - source files plus
the customer's real app-data - which must never enter git (real client data; the synthetic-
data testing rule applies to committed fixtures). `scripts/dev-seed.mjs` re-imports it on
every dev boot (ephemeral Mongo) with `preserveId`, so the persisted blob dir under
`<dataDir>/app-data/<id>/files/` and every embedded `/api/app-files/<id>/` URL keep working,
and re-arms the `email.received` mailbox listener.

Build it (full context: docs/operations-runbook.md, "Salomao ERP cutover"):

    node api/scripts/migrate/convert-dev-bundle.mjs <envelope.json> \
      --data <appdata-dump.json> --slug legal-case-manager-3 \
      --id <prod-canonical-id> --m365-proxy \
      --out scripts/seed/erp/salomao-bundle.json

File blobs travel separately: api/scripts/migrate/migrate-app-files.mjs.
