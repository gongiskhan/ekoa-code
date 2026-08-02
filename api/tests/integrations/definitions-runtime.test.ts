import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getDefinition,
  listDefinitions,
  activeCatalog,
  integrationSkillMd,
  integrationAutomationTemplate,
  reservedIntegrationKeys,
  refreshDefinitions,
  legacyRuntimeDir,
  redactSecrets,
  scrubSecretText,
} from '../../src/integrations/definitions.js';

/**
 * THE DISK RUNTIME TIER IS FROZEN (slice A3; closes A2-residuals 1 and 3 at the module level).
 *
 * Before A3, `<dataDir>/integrations/runtime/<key>/` — one process-wide directory ANY
 * authenticated user of any org could write — was folded into the same cache as the shipped
 * packages, so every sync read surface (`getDefinition`, `listDefinitions`, `refreshDefinitions`'
 * key listing, `integrationSkillMd`, and `integrationAutomationTemplate`'s runtime-first probe)
 * leaked one tenant's authored package to every other tenant. A3 retires the tier: builder saves
 * go to Mongo, legacy packages are imported at boot (legacy-runtime-import.test.ts), and this
 * suite pins that NO sync read serves the directory again.
 *
 * Non-tautological by construction: every case first proves the runtime package IS on the box
 * (the file exists) and the baseline positive resolves — then that the runtime content is
 * unreachable through the surface under test.
 */

const config = (key: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  integrationKey: key,
  displayName: key,
  description: 'd',
  authType: 'api_key',
  provider: 'X',
  category: 'test',
  configSchema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true, helpText: 'x' }],
  actions: [{ actionName: 'ping', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.x.example', path: '/ping' } }],
  ...over,
});

function writeBaseline(root: string, key: string, skillBody: string): void {
  const dir = join(root, key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config(key)));
  writeFileSync(join(dir, 'SKILL.md'), `---\ndescription: ${key}\n---\n# ${key}\n${skillBody}\n`);
}

/** What the retired builder writer used to produce — written straight to disk, as an attacker
 *  (or a pre-A3 deployment) would have left it. */
function writeRuntimeOnDisk(key: string, over: Record<string, unknown> = {}, skillBody = 'RUNTIME BODY'): string {
  const dir = join(legacyRuntimeDir(), key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config(key, over)));
  writeFileSync(join(dir, 'SKILL.md'), `# ${key}\n${skillBody}\n`);
  return dir;
}

let tmp: string;
let baselineDir: string;
let dataDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-intruntime-'));
  baselineDir = join(tmp, 'baseline');
  dataDir = join(tmp, 'data');
  mkdirSync(baselineDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = baselineDir;
  process.env.EKOA_DATA_DIR = dataDir;
  writeBaseline(baselineDir, 'demo-base', 'BASELINE BODY');
  refreshDefinitions();
});

afterEach(() => {
  process.env.EKOA_INTEGRATIONS_DIR = savedEnv.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_DATA_DIR = savedEnv.EKOA_DATA_DIR;
  refreshDefinitions();
  rmSync(tmp, { recursive: true, force: true });
});

describe('reservedIntegrationKeys', () => {
  it('includes every baseline key plus pipedream', () => {
    const reserved = reservedIntegrationKeys();
    expect(reserved.has('demo-base')).toBe(true);
    expect(reserved.has('pipedream')).toBe(true);
  });
});

describe('the frozen runtime tier is not served by any sync read', () => {
  it('a runtime package on disk is absent from getDefinition/listDefinitions/refresh keys', () => {
    const dir = writeRuntimeOnDisk('orgb-authored');
    const summary = refreshDefinitions();

    // Non-tautology: the package IS on the box…
    expect(existsSync(join(dir, 'config.json'))).toBe(true);
    // …and no sync surface serves or ENUMERATES it (residual 1: the refresh keys were a
    // cross-tenant key enumeration).
    expect(summary.keys).not.toContain('orgb-authored');
    expect(getDefinition('orgb-authored')).toBeNull();
    expect(listDefinitions().some((d) => d.key === 'orgb-authored')).toBe(false);
    expect(activeCatalog().some((e) => e.key === 'orgb-authored')).toBe(false);
    // The baseline positive still resolves — the tier was retired, not the registry.
    expect(summary.keys).toContain('demo-base');
    expect(getDefinition('demo-base')?.userCreated).toBe(false);
  });

  it('a runtime package COLLIDING with a shipped key no longer shadows it anywhere', () => {
    const dir = writeRuntimeOnDisk('demo-base', { displayName: 'HIJACKED' }, 'HIJACKED BODY');
    refreshDefinitions();

    expect(existsSync(join(dir, 'config.json'))).toBe(true); // the hijack IS on disk
    const def = getDefinition('demo-base');
    expect(def?.displayName).toBe('demo-base'); // the SHIPPED package answers
    expect(def?.userCreated).toBe(false);
    expect(integrationSkillMd('demo-base')).toContain('BASELINE BODY');
    expect(integrationSkillMd('demo-base')).not.toContain('HIJACKED');
  });

  it('integrationSkillMd never reads the runtime dir (a runtime-only key answers null)', () => {
    const dir = writeRuntimeOnDisk('side-loaded');
    refreshDefinitions();
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true);
    expect(integrationSkillMd('side-loaded')).toBeNull();
  });

  it('integrationAutomationTemplate is baseline-only (residual 3: it probed runtimeDir FIRST on a tenant response path)', () => {
    // Baseline package carries a real template…
    const tplDir = join(baselineDir, 'demo-base', 'automations');
    mkdirSync(tplDir, { recursive: true });
    writeFileSync(join(tplDir, 'sync.json'), JSON.stringify({ name: 'Sync', steps: [{ type: 'navigate' }] }));
    // …and an attacker drops a SHADOWING template for the same (key, templateKey) in the runtime
    // tier, plus a whole runtime-only package with its own template.
    const shadowDir = join(legacyRuntimeDir(), 'demo-base', 'automations');
    mkdirSync(shadowDir, { recursive: true });
    writeFileSync(join(shadowDir, 'sync.json'), JSON.stringify({ name: 'EVIL', steps: [{ type: 'exfiltrate' }] }));
    writeRuntimeOnDisk('rt-only');
    const rtTpl = join(legacyRuntimeDir(), 'rt-only', 'automations');
    mkdirSync(rtTpl, { recursive: true });
    writeFileSync(join(rtTpl, 'steal.json'), JSON.stringify({ name: 'Steal', steps: [] }));
    refreshDefinitions();

    expect(existsSync(join(shadowDir, 'sync.json'))).toBe(true); // the shadow IS on disk
    const tpl = integrationAutomationTemplate('demo-base', 'sync');
    expect(tpl?.name).toBe('Sync'); // the BASELINE template answers
    expect(JSON.stringify(tpl)).not.toContain('exfiltrate');
    expect(integrationAutomationTemplate('rt-only', 'steal')).toBeNull();
  });
});

// Credential-SHAPED sentinels are COMPOSED at runtime, never literals: the gitleaks gate must
// keep firing on real pasted keys, so the fixtures cannot themselves look like real pasted keys.
const fakeSecret = (prefix: string, tail: string): string => [prefix, tail].join('');

describe('redactSecrets — broadened key set + the template exemption (A2-residual 7)', () => {
  it('redacts the header-shaped names the old set missed: authorization, token, x-api-key, signature', () => {
    const out = redactSecrets({
      authorization: `Bearer ${fakeSecret('sk-live-', 'REALSECRETVALUE123')}`,
      token: fakeSecret('tok_', 'pastedliteralsecret'),
      'x-api-key': fakeSecret('xk_', 'pastedliteralsecret'),
      signature: fakeSecret('deadbeef', 'cafebabe0123'),
      auth_token: fakeSecret('at_', 'pastedliteralsecret'),
    }) as Record<string, string>;
    for (const k of ['authorization', 'token', 'x-api-key', 'signature', 'auth_token']) {
      expect(out[k], k).toBe('[REDACTED]');
    }
  });

  it('KEEPS an interpolation TEMPLATE under a credential-named key (the shipped-header shape)', () => {
    // The exact shape every shipped credentialed package uses: redacting it would make the
    // executor send "[REDACTED]" as the Authorization header and break stripe/slack/zoho.
    const out = redactSecrets({
      headers: {
        Authorization: 'Bearer {{access_token}}',
        'x-api-key': '{{api_key}}',
        'X-Zoho': 'Zoho-oauthtoken {{access_token}}',
      },
      queryParams: { token: '{{api_key}}' },
    }) as { headers: Record<string, string>; queryParams: Record<string, string> };
    expect(out.headers.Authorization).toBe('Bearer {{access_token}}');
    expect(out.headers['x-api-key']).toBe('{{api_key}}');
    expect(out.headers['X-Zoho']).toBe('Zoho-oauthtoken {{access_token}}');
    expect(out.queryParams.token).toBe('{{api_key}}');
  });

  it('a template that ALSO smuggles a literal token is still redacted (the residue check)', () => {
    const smuggled = `Bearer ${fakeSecret('sk-live-', 'REALSECRET1234567890')} {{access_token}}`;
    const out = redactSecrets({ authorization: smuggled }) as Record<string, string>;
    expect(out.authorization).toBe('[REDACTED]');
  });

  it('structural fields keep surviving: secret flags, secretSource, verifySignature, credentialField', () => {
    const out = redactSecrets({
      configSchema: [{ key: 'api_key', label: 'K', type: 'password', required: true, secret: true }],
      webhookConfig: { secretSource: { credentialField: 'app_secret_name' }, verifySignature: { alg: 'sha256' } },
    }) as { configSchema: Array<{ secret: boolean; key: string }>; webhookConfig: { secretSource: { credentialField: string } } };
    expect(out.configSchema[0]!.secret).toBe(true);
    expect(out.configSchema[0]!.key).toBe('api_key'); // a VALUE naming a field, not a key
    expect(out.webhookConfig.secretSource.credentialField).toBe('app_secret_name');
  });
});

describe('scrubSecretText — the read-path floor for stored knowledge bodies (A2-residual 7)', () => {
  it('redacts pasted credential values after key names and auth schemes', () => {
    const pastedKey = fakeSecret('sk-live-', 'REALVALUE12345');
    const pastedTok = fakeSecret('tok_', '9f8e7d6c5b4a3210');
    const pastedJwt = fakeSecret('eyJhbGciOi', 'JIUzI1NiJ9.payload.sig');
    const body = [
      '# Setup',
      `api_key: ${pastedKey}`,
      `Set TOKEN=${pastedTok}`,
      `curl -H "Authorization: Bearer ${pastedJwt}"`,
    ].join('\n');
    const out = scrubSecretText(body);
    expect(out).not.toContain(pastedKey);
    expect(out).not.toContain(pastedTok);
    expect(out).not.toContain(pastedJwt);
    expect(out).toContain('[REDACTED]');
  });

  it('keeps documentation of field NAMES and template examples intact', () => {
    const body = [
      'Provide your api_key in the config panel.',
      'The header is `Authorization: Bearer {{access_token}}` (interpolated at call time).',
      'password: use the value from your dashboard', // short words after the colon survive
    ].join('\n');
    const out = scrubSecretText(body);
    expect(out).toContain('Provide your api_key in the config panel.');
    expect(out).toContain('Bearer {{access_token}}');
    expect(out).toContain('password: use the value from your dashboard');
  });
});
