import { describe, it, expect } from 'vitest';
import { parseIntegrationOutput, validateConfig, tryFixJson } from '../../src/agents/integration-builder-parser.js';

/**
 * Integration-builder parser (ch03 §3.8.14) — the ported cortex failure cases plus the new
 * key-shape + reserved-key rules. Pure function, no I/O; the reserved set is injected.
 */

const SKILL = '```skill-md\n---\nname: acme-crm\ndescription: Acme CRM\n---\n# Acme CRM\nA doc.\n```';

const validConfig = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  integrationKey: 'acme-crm',
  displayName: 'Acme CRM',
  description: 'Read and create contacts.',
  authType: 'api_key',
  provider: 'Acme',
  category: 'crm',
  configSchema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true, helpText: 'From the dashboard.' }],
  credentialGuide: '1. Open the dashboard.\n2. Create a key.',
  actions: [
    {
      actionName: 'list_contacts',
      description: 'List contacts.',
      mutates: false,
      argsSchema: { type: 'object', properties: {}, required: [] },
      returnSchema: { type: 'object' },
      httpConfig: { method: 'GET', baseUrl: 'https://api.acme.example', path: '/v1/contacts', headers: { Authorization: 'Bearer {{api_key}}' } },
    },
  ],
  ...over,
});

const withBlocks = (configJson: string): string => `Some prose.\n\n${SKILL}\n\n\`\`\`config-json\n${configJson}\n\`\`\``;

describe('parseIntegrationOutput', () => {
  it('returns nothing (still conversing) when there is no skill-md block', () => {
    const r = parseIntegrationOutput('Just chatting, no blocks yet.');
    expect(r.pkg).toBeNull();
    expect(r.skillMd).toBeNull();
    expect(r.errors).toEqual([]);
  });

  it('reports a hard error when the skill-md block has no matching config-json block', () => {
    const r = parseIntegrationOutput(`prose\n\n${SKILL}`);
    expect(r.pkg).toBeNull();
    expect(r.skillMd).toContain('Acme CRM');
    expect(r.errors).toContain('Missing config-json code block');
  });

  it('parses a complete, valid package with no errors', () => {
    const r = parseIntegrationOutput(withBlocks(JSON.stringify(validConfig())));
    expect(r.errors).toEqual([]);
    expect(r.pkg?.integrationKey).toBe('acme-crm');
    expect(r.skillMd).toContain('# Acme CRM');
  });

  it('repairs trailing commas and comments before parsing (JSON repair)', () => {
    const dirty = `{
  "integrationKey": "acme-crm", // the key
  "displayName": "Acme CRM",
  "description": "d",
  "authType": "api_key",
  "provider": "Acme",
  "category": "crm",
  /* credentials */
  "configSchema": [
    { "key": "api_key", "label": "API Key", "type": "password", "required": true, "secret": true, "helpText": "x" },
  ],
  "credentialGuide": "1. step",
  "actions": [
    { "actionName": "list", "description": "d", "mutates": false, "argsSchema": {}, "returnSchema": {}, "httpConfig": { "method": "GET", "baseUrl": "https://api.acme.example", "path": "/v1" } },
  ],
}`;
    const r = parseIntegrationOutput(withBlocks(dirty));
    expect(r.errors).toEqual([]);
    expect(r.pkg?.integrationKey).toBe('acme-crm');
  });

  it('flags an empty configSchema', () => {
    const r = parseIntegrationOutput(withBlocks(JSON.stringify(validConfig({ configSchema: [] }))));
    expect(r.errors.some((e) => /configSchema is empty/.test(e))).toBe(true);
  });

  it('flags a missing credentialGuide (unless authType none)', () => {
    const cfg = validConfig();
    delete (cfg as Record<string, unknown>).credentialGuide;
    const r = parseIntegrationOutput(withBlocks(JSON.stringify(cfg)));
    expect(r.errors.some((e) => /credentialGuide/.test(e))).toBe(true);
  });

  it('autofixes an invalid field type (secret -> password) and still reports it', () => {
    const cfg = validConfig({
      configSchema: [{ key: 'token', label: 'Token', type: 'apikey', required: true, secret: true, helpText: 'x' }],
    });
    const r = parseIntegrationOutput(withBlocks(JSON.stringify(cfg)));
    expect(r.errors.some((e) => /invalid type "apikey"/.test(e))).toBe(true);
    expect(r.pkg?.configSchema?.[0]?.type).toBe('password'); // normalized in the returned package
  });

  it('rejects a config-json that is not parseable even after repair', () => {
    const r = parseIntegrationOutput(withBlocks('{ this is not json at all '));
    expect(r.pkg).toBeNull();
    expect(r.errors[0]).toMatch(/Invalid config JSON/);
  });

  it('drops a proxyContract field the model may emit (not part of the shape)', () => {
    const cfg = validConfig({ proxyContract: { executeEndpoint: '/x', requiredInputs: [] } });
    const r = parseIntegrationOutput(withBlocks(JSON.stringify(cfg)));
    expect(r.errors).toEqual([]);
    expect((r.pkg as unknown as Record<string, unknown>).proxyContract).toBeUndefined();
  });
});

describe('validateConfig — key shape + reserved keys', () => {
  it('rejects a badly-shaped integration key', () => {
    const errors = validateConfig(validConfig({ integrationKey: 'A' }) as never);
    expect(errors.some((e) => /Invalid integrationKey/.test(e))).toBe(true);
  });

  it('rejects a reserved key (a shipped integration) for a NEW package', () => {
    const errors = validateConfig(validConfig({ integrationKey: 'slack' }) as never, { reservedKeys: new Set(['slack', 'pipedream']) });
    expect(errors.some((e) => /reserved/.test(e))).toBe(true);
  });

  it('allows the reserved key when the session is editing that very key (loadedKey)', () => {
    const errors = validateConfig(validConfig({ integrationKey: 'slack' }) as never, { reservedKeys: new Set(['slack', 'pipedream']), loadedKey: 'slack' });
    expect(errors.some((e) => /reserved/.test(e))).toBe(false);
  });

  it('flags an action missing its httpConfig', () => {
    const errors = validateConfig(validConfig({ actions: [{ actionName: 'x', description: 'd', mutates: false }] }) as never);
    expect(errors.some((e) => /missing httpConfig/.test(e))).toBe(true);
  });
});

describe('tryFixJson', () => {
  it('escapes raw newlines inside string values', () => {
    const fixed = tryFixJson('{"a":"line1\nline2"}');
    expect(JSON.parse(fixed)).toEqual({ a: 'line1\nline2' });
  });

  it('leaves a // that lives inside a string (a URL) intact', () => {
    const fixed = tryFixJson('{"url":"https://api.example.com/v1"}');
    expect(JSON.parse(fixed)).toEqual({ url: 'https://api.example.com/v1' });
  });
});
