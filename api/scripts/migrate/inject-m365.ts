/**
 * One-shot: decrypt the OLD-PROD microsoft workspace token bundle and inject it into the LOCAL
 * dev stack as a connected `platform-microsoft` row (envelope-encrypted with the stack's key).
 * Operator-run (the classifier blocks the agent from touching credential material):
 *
 *   cd api && EKOA_OLD_ENCRYPTION_KEY='<old-prod ENCRYPTION_KEY>' \
 *     ENCRYPTION_KEY='dev-only-encryption-key' JWT_SECRET='dev-only-jwt-secret' \
 *     MONGODB_URI='mongodb://127.0.0.1:<port>' \
 *     node --loader ts-node/esm/transpile-only scripts/migrate/inject-m365.ts <oldprod/integration-configs.json>
 *
 * The old-prod integration-configs.json path is argv[2] (or EKOA_OLDPROD_CONFIGS); the target org
 * defaults to the salomao org and is overridable via EKOA_ORG_ID. Only non-secret diagnostics print.
 */
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { envelopeEncrypt } from '../../src/data/crypto.js';

const OLD = process.argv[2] || process.env.EKOA_OLDPROD_CONFIGS || '';
if (!OLD) { console.error('usage: inject-m365.ts <path/to/oldprod/integration-configs.json>  (or set EKOA_OLDPROD_CONFIGS)'); process.exit(2); }
const ORG_ID = process.env.EKOA_ORG_ID || 'a76b7f0c-fcf4-4974-b3b7-5f8280df43a4';
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:59450';
const oldKeyRaw = (process.env.EKOA_OLD_ENCRYPTION_KEY || '').trim().replace(/^["']|["']$/g, '');
if (!oldKeyRaw) { console.error('set EKOA_OLD_ENCRYPTION_KEY'); process.exit(2); }

function key32(raw: string): Buffer { const b = Buffer.from(raw, 'utf8'); if (b.length >= 32) return b.subarray(0, 32); const p = Buffer.alloc(32); b.copy(p); return p; }
function oldDecrypt(ciphertext: string): string {
  const [ivB, tagB, enc] = ciphertext.split(':');
  const d = createDecipheriv('aes-256-gcm', key32(oldKeyRaw), Buffer.from(ivB, 'base64'));
  d.setAuthTag(Buffer.from(tagB, 'base64'));
  return d.update(enc, 'base64', 'utf8') + d.final('utf8');
}

const rows = JSON.parse(readFileSync(OLD, 'utf8')) as Array<Record<string, unknown>>;
const ms = rows.find((r) => r.platformProvider === 'microsoft' && r.enabled && r.credentials);
if (!ms) { console.error('no enabled platform-microsoft row with credentials'); process.exit(1); }

let old: Record<string, unknown>;
try { old = JSON.parse(oldDecrypt(ms.credentials as string)); }
catch (e) { console.error('DECRYPT FAILED (wrong old key?):', (e as Error).message); process.exit(1); }

const refresh_token = (old.refresh_token || old.refreshToken || (old.tokens as Record<string, unknown>)?.refresh_token) as string;
const scope = (old.scope || old.scopes || '') as string;
console.log('decrypt OK | keys:', Object.keys(old).join(','), '| refresh_token:', refresh_token ? 'present len' + refresh_token.length : 'MISSING', '| scope len:', String(scope).length);
if (!refresh_token) process.exit(1);

// Shape to ekoa-code OAuthTokens; expires_at in the past forces an immediate refresh against Microsoft.
const tokens = { access_token: (old.access_token as string) || 'stale', refresh_token, expires_at: new Date(0).toISOString(), scope: String(scope), email: (old.email as string) || '' };
const credentialsCiphertext = await envelopeEncrypt(JSON.stringify(tokens), ORG_ID);

const client = new MongoClient(MONGO);
await client.connect();
const col = client.db('ekoa').collection('integration_configs');
const _id = `platform-${ORG_ID}-microsoft`;
await col.replaceOne({ _id }, { _id, orgId: ORG_ID, ownerUserId: null, integrationKey: 'platform-microsoft', name: 'Microsoft 365', enabled: true, platformProvider: 'microsoft', credentialsCiphertext, _rev: 0 } as never, { upsert: true });
console.log('inserted platform-microsoft row _id=', _id);
await client.close();
console.log('DONE — check /api/app-cloud-files/status');
