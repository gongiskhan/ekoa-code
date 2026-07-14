#!/usr/bin/env node
// Off-camera evidence fetcher for walkthrough evidence panels. Reads the admin token from
// .walkthrough/auth.json (gitignored) so no secret ever appears in a storyboard command.
//   node api-evidence.mjs versions <appId> [limit]   -> GET /api/v1/artifacts/:id/versions
//   node api-evidence.mjs pedidos <status>           -> GET /api/v1/change-requests?status=...
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH = JSON.parse(readFileSync(join(HERE, '..', 'auth.json'), 'utf8'));
const token = AUTH.origins.flatMap((o) => o.localStorage ?? []).find((e) => e.name === 'ekoa_token')?.value;
if (!token) { console.error('no ekoa_token in .walkthrough/auth.json'); process.exit(1); }
const BASE = 'http://localhost:4111';
const H = { Authorization: `Bearer ${token}` };

const [mode, a, b] = process.argv.slice(2);
let url;
if (mode === 'versions') url = `${BASE}/api/v1/artifacts/${encodeURIComponent(a)}/versions`;
else if (mode === 'pedidos') url = `${BASE}/api/v1/change-requests?status=${encodeURIComponent(a ?? 'converted')}`;
else { console.error('usage: api-evidence.mjs versions <appId> [limit] | pedidos <status>'); process.exit(2); }

const res = await fetch(url, { headers: H });
const json = await res.json();
if (mode === 'versions' && b) json.items = (json.items ?? []).slice(0, Number(b));
console.log(JSON.stringify(json, null, 2));
