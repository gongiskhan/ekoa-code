import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getDefinition,
  integrationSkillMd,
  reservedIntegrationKeys,
  writeRuntimePackage,
  refreshDefinitions,
} from '../../src/integrations/definitions.js';

/**
 * The integration DEFINITIONS runtime tier (ch03 §3.8.14): user-created packages the builder saves
 * under `<dataDir>/integrations/runtime/<key>/`, shadowing baseline on key collision and flagged
 * `userCreated`. Unit-level: point EKOA_INTEGRATIONS_DIR (baseline) + EKOA_DATA_DIR (runtime root)
 * at temp fixtures and drive the registry functions directly.
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

describe('writeRuntimePackage', () => {
  it('persists a new runtime package that resolves with userCreated + its SKILL.md', () => {
    writeRuntimePackage('my-crm', config('my-crm'), '---\ndescription: my-crm\n---\n# My CRM\nRUNTIME DOC\n');
    const def = getDefinition('my-crm');
    expect(def).not.toBeNull();
    expect(def?.userCreated).toBe(true);
    expect(integrationSkillMd('my-crm')).toContain('RUNTIME DOC');
  });

  it('runtime shadows a baseline package of the same key (runtime wins)', () => {
    // Before: baseline demo-base is not userCreated.
    expect(getDefinition('demo-base')?.userCreated).toBe(false);
    expect(integrationSkillMd('demo-base')).toContain('BASELINE BODY');

    writeRuntimePackage('demo-base', config('demo-base', { displayName: 'Overridden' }), '---\ndescription: demo-base\n---\n# demo-base\nRUNTIME OVERRIDE\n');

    const def = getDefinition('demo-base');
    expect(def?.userCreated).toBe(true); // runtime shadows baseline
    expect(def?.displayName).toBe('Overridden');
    expect(integrationSkillMd('demo-base')).toContain('RUNTIME OVERRIDE');
    expect(integrationSkillMd('demo-base')).not.toContain('BASELINE BODY');
  });

  it('rejects a badly-shaped key at write time', () => {
    expect(() => writeRuntimePackage('BadKey', config('BadKey'), 'x')).toThrow(/invalid integration key/i);
  });

  it('refresh picks up a runtime package written directly to disk', () => {
    expect(getDefinition('side-loaded')).toBeNull();
    const dir = join(dataDir, 'integrations', 'runtime', 'side-loaded');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config('side-loaded')));
    writeFileSync(join(dir, 'SKILL.md'), '---\ndescription: side-loaded\n---\n# side\n');
    const summary = refreshDefinitions();
    expect(summary.keys).toContain('side-loaded');
    expect(getDefinition('side-loaded')?.userCreated).toBe(true);
  });
});

describe('integrationSkillMd', () => {
  it('returns null for an unknown key', () => {
    expect(integrationSkillMd('does-not-exist')).toBeNull();
  });
});
