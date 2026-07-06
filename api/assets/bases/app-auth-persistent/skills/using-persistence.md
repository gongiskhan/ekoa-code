---
name: using-persistence
description: How to read and write app data via the Ekoa JsonStore per-app per-collection
---

# Using Persistence

This base ships persistence wiring. Each app has its own private JsonStore at `~/.ekoa/sandboxes/user-{userId}/app-data/{appId}/{collection}.json`. The agent never touches that filesystem directly — use the API.

## API surface

**Preferred:** use the injected `window.__ekoa` helpers — they add the
`X-Ekoa-App-Id` header, use the correct HTTP verbs, and unwrap the response
envelope for you, so you get the raw record(s) back:

```js
const items   = await window.__ekoa.list(collection);            // -> array (already unwrapped)
const item    = await window.__ekoa.get(collection, id);         // -> record | null
const created = await window.__ekoa.create(collection, fields);  // -> record (with id/createdAt/updatedAt)
const updated = await window.__ekoa.update(collection, id, patch);// -> record (shallow merge)
const ok      = await window.__ekoa.delete(collection, id);      // -> boolean
```

**Raw REST** (only if you need a verb the helpers don't cover). Note: every
response is wrapped as `{ "success": true, "data": ... }` — you must read
`json.data`. Updates use **PUT** (shallow-merge), not PATCH:

```js
// List
const { data: items } = await window.__ekoa.fetch(`/api/app-data/${collection}`).then(r => r.json());

// Create
const { data: created } = await window.__ekoa.fetch(`/api/app-data/${collection}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...fields }),
}).then(r => r.json());

// Update (partial merge) — PUT, not PATCH
const { data: updated } = await window.__ekoa.fetch(`/api/app-data/${collection}/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...patch }),
}).then(r => r.json());

// Delete
await window.__ekoa.fetch(`/api/app-data/${collection}/${id}`, { method: 'DELETE' });
```

Every item gets an auto-`id` (UUID) plus `createdAt` and `updatedAt` ISO timestamps. Don't generate ids client-side.

## Seed data

If this artifact ships with `seed-data.json` (featured artifacts can), it is auto-loaded into the app's JsonStore on first run. Treat that as the empty-state content; user actions then accumulate on top.

## Conventions

- One collection per logical noun (`todos`, `contacts`, `deals`, `notes`).
- Keep documents flat — no nested objects deeper than 2 levels. JsonStore is a JSON file, not Postgres.
- Cap document size to ~10 KB. Large blobs go through file storage integration, not app-data.

## What to NOT do

- Do not use `localStorage` or `sessionStorage` for primary data. The user expects their data on every device they log in from; only Ekoa's JsonStore guarantees that.
- Do not stringify entire arrays into one document. One row = one document.
- Do not assume idempotency of POST. Create returns `id`; persist that in your UI state.
