import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  readGitHubConfig,
  buildGitHubProvider,
  GitHubAppProvider,
  DevTokenProvider,
} from '../../src/services/github/provider.js';
import { backupAppRepo } from '../../src/services/github/backup.js';
import type { GitRunner } from '../../src/services/github/git-remote.js';

/**
 * GitHub provider (spec/07 §7.9): auth-mode selection (App RS256 JWT vs dev PAT),
 * production-guard on the dev token, and the push toggle. No network is touched -
 * push is gated OFF and short-circuits before any git/remote call.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const APP_ENV: NodeJS.ProcessEnv = {
  GITHUB_APP_ID: '123456',
  GITHUB_APP_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  GITHUB_APP_INSTALLATION_ID: '789',
  GITHUB_ORG: 'ekoa-apps',
  GITHUB_OWNER_TYPE: 'org',
};

const DEV_ENV: NodeJS.ProcessEnv = {
  GITHUB_DEV_TOKEN: 'ghp_devtoken_fake',
  GITHUB_OWNER: 'gongiskhan',
  GITHUB_OWNER_TYPE: 'user',
};

describe('github provider auth-mode selection', () => {
  it('selects the App provider when App config is present and mints a valid RS256 JWT', async () => {
    const provider = buildGitHubProvider(readGitHubConfig(APP_ENV));
    expect(provider?.kind).toBe('app');
    expect(provider?.owner).toBe('ekoa-apps');

    const app = provider as GitHubAppProvider;
    const token = app.mintJwt();
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;
    expect(decoded.iss).toBe('123456');

    // getToken exchanges the JWT for an installation token via an injected fetch.
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ token: 'inst-token', expires_at: new Date(Date.now() + 3600_000).toISOString() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const withFetch = new GitHubAppProvider('123456', privateKey, '789', 'ekoa-apps', fetchImpl);
    expect(await withFetch.getToken()).toBe('inst-token');
  });

  it('selects the dev-token provider outside production and returns the PAT', async () => {
    const provider = buildGitHubProvider(readGitHubConfig(DEV_ENV));
    expect(provider?.kind).toBe('dev');
    expect(provider).toBeInstanceOf(DevTokenProvider);
    expect(await provider!.getToken()).toBe('ghp_devtoken_fake');
  });

  it('refuses the dev token in a production-like environment (App only)', () => {
    const provider = buildGitHubProvider(readGitHubConfig({ ...DEV_ENV, NODE_ENV: 'production' }));
    expect(provider).toBeNull();
  });

  it('returns null when GitHub is not configured at all', () => {
    expect(buildGitHubProvider(readGitHubConfig({}))).toBeNull();
  });
});

describe('github backup push gating', () => {
  it('is a no-op with no network/git call when push is disabled', async () => {
    const prevPush = process.env.GITHUB_PUSH_ENABLED;
    delete process.env.GITHUB_PUSH_ENABLED; // default OFF

    // A runner that fails the test if the push path is ever reached.
    const run: GitRunner = async () => {
      throw new Error('git runner must not be called when push is disabled');
    };

    const result = await backupAppRepo('/tmp/does-not-matter', { run, appId: 'app1' });
    expect(result).toEqual({ pushed: false, reason: 'push-disabled' });

    if (prevPush === undefined) delete process.env.GITHUB_PUSH_ENABLED;
    else process.env.GITHUB_PUSH_ENABLED = prevPush;
  });
});
