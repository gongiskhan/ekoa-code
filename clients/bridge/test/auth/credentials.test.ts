import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BridgeConfig,
  CredentialsError,
  configPath,
  isExpired,
  loadConfig,
  saveConfig,
} from '../../src/auth/index.js';

/**
 * The on-disk credential store: config.json under EKOA_BRIDGE_HOME. Every home is a fresh mkdtemp
 * under the OS temp root (never a real user path). All token/user values are synthetic.
 */
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ekoa-cred-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function sampleConfig(over: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    cortexBaseUrl: 'https://cortex.example',
    pairingId: 'p-test-abc123',
    credentials: {
      access: 'header.payload.sig',
      refresh: 'header.payload.sig',
      expires: 2_000_000_000_000,
      user: { id: 'u1', username: 'ana', role: 'user' },
    },
    ...over,
  };
}

describe('credential store — round trip and file mode', () => {
  it('saveConfig writes config.json mode 0600 (owner read/write only)', () => {
    saveConfig(home, sampleConfig());
    const mode = statSync(configPath(home)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('a config survives save -> load byte-for-field identical', () => {
    const config = sampleConfig();
    saveConfig(home, config);
    expect(loadConfig(home)).toEqual(config);
  });

  it('re-saving an existing config keeps mode 0600', () => {
    saveConfig(home, sampleConfig());
    saveConfig(home, sampleConfig({ pairingId: 'p-test-second' }));
    expect(statSync(configPath(home)).mode & 0o777).toBe(0o600);
    expect(loadConfig(home)?.pairingId).toBe('p-test-second');
  });

  it('optional org/signingSecret round-trip, and a credential-less (mid-pair) config is valid', () => {
    const config: BridgeConfig = {
      cortexBaseUrl: 'https://cortex.example',
      pairingId: 'p-test',
      org: 'org-1',
      signingSecret: 's3cr3t-not-real',
    };
    saveConfig(home, config);
    expect(loadConfig(home)).toEqual(config);
  });
});

describe('credential store — absence vs corruption', () => {
  it('loadConfig returns null when no config exists (unpaired daemon)', () => {
    expect(loadConfig(home)).toBeNull();
  });

  it('loadConfig throws CredentialsError on non-JSON content', () => {
    writeFileSync(configPath(home), 'this is not json', 'utf-8');
    expect(() => loadConfig(home)).toThrow(CredentialsError);
  });

  it('loadConfig throws CredentialsError on schema-invalid content (not silently "unpaired")', () => {
    writeFileSync(configPath(home), JSON.stringify({ cortexBaseUrl: 42 }), 'utf-8');
    expect(() => loadConfig(home)).toThrow(CredentialsError);
  });
});

describe('isExpired — skew semantics', () => {
  const cred = { access: 't', expires: 1000 } as const;

  it('is not expired strictly before the (skewed) edge', () => {
    expect(isExpired(cred, 0, 999)).toBe(false);
    expect(isExpired(cred, 60, 939)).toBe(false);
  });

  it('is expired at or after the (skewed) edge', () => {
    expect(isExpired(cred, 0, 1000)).toBe(true);
    expect(isExpired(cred, 60, 940)).toBe(true); // skew pulls the edge 60ms earlier
  });

  it('a far-future credential is not expired under the default 60s skew', () => {
    expect(isExpired({ access: 't', expires: Date.now() + 3_600_000 })).toBe(false);
  });
});
