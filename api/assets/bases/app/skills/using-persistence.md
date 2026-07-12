---
name: using-persistence
description: How to read and write app data via the Ekoa JsonStore per-app per-collection
---

# Using Persistence

This base ships persistence wiring at `frontend/src/lib/jsonStore.ts`. Each app has its own private JsonStore reachable at `/api/app-data/{collection}`. The agent never touches the filesystem directly - use the API.

## API surface

**Preferred:** the shipped `jsonStore.ts` helpers (or the injected `window.__ekoa`
equivalents) add the `X-Ekoa-App-Id` header, use the correct HTTP verbs, and unwrap
the `{ success, data }` envelope, so you get the raw record(s) back:

```js
import { list, get, create, update, remove } from './lib/jsonStore';

const items   = await list(collection);            // -> array (already unwrapped)
const item    = await get(collection, id);         // -> record | null
const created = await create(collection, fields);  // -> record (with id/createdAt/updatedAt)
const updated = await update(collection, id, patch);// -> record (shallow merge, PUT)
await remove(collection, id);                       // -> void
```

Every item gets an auto-`id` (UUID) plus `createdAt`/`updatedAt` ISO timestamps. Don't generate ids client-side. Updates are **PUT** (shallow-merge), not PATCH.

## Conventions

- One collection per logical noun (`todos`, `contacts`, `deals`, `notes`), kebab-case plurals.
- Keep documents flat - no nesting deeper than 2 levels. JsonStore is a JSON file, not Postgres.
- Cap document size to ~10 KB. Large blobs go through file storage, not app-data.

## What NOT to do

- Do not use `localStorage`/`sessionStorage` for primary data. The user expects their data on every device; only the JsonStore guarantees that.
- Do not stringify entire arrays into one document. One row = one document.
- Do not assume POST idempotency. Create returns `id`; persist that in your UI state.
