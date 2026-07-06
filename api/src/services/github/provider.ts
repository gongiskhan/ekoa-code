/**
 * GitHub auth provider — the THIN boundary between the platform and GitHub
 * (spec/07-app-pipeline.md §7.9; provider abstraction ports as-is, B18).
 *
 * Everything downstream (repo create, push, clone, template-generate) needs only
 * two things: which `owner` (org/user) repos live under, and a short-lived
 * `getToken()` usable for both the REST API and git-over-https. Keeping the
 * interface this small means the dev path and the prod path share all repo logic.
 *
 * Two implementations, selected by environment:
 *  - GitHubAppProvider (PROD): signs an RS256 App JWT with the App private key and
 *    exchanges it for a per-installation token (cached ~55m). App, never a PAT,
 *    never client-side.
 *  - DevTokenProvider (DEV): uses a developer PAT from the env so the whole
 *    pipeline can be exercised against real GitHub without registering the App.
 *    NOT for production - refused in production-like environments.
 *
 * KNOWN LIMITATION: registering the GitHub App is a human-in-browser step, so the
 * prod token-exchange is covered by unit tests with a generated keypair + a mocked
 * token endpoint, NOT exercised against real GitHub by the build agent.
 */

import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';

export interface GitHubProvider {
  readonly kind: 'app' | 'dev';
  /** GitHub owner (org or user login) that app repos are created under. */
  readonly owner: string;
  /** A short-lived token valid for REST + git over https. */
  getToken(): Promise<string>;
}

export type OwnerType = 'org' | 'user';

export interface GitHubConfig {
  appId: string;
  privateKey: string;
  privateKeyPath: string;
  installationId: string;
  owner: string;
  /** 'org' (prod organization) or 'user' (dev personal account). */
  ownerType: OwnerType;
  devToken: string;
  pushEnabled: boolean;
  repoPrefix: string;
  /** Looks like a real deployment. */
  productionLike: boolean;
}

/** Read GitHub config from the environment. Read at call time so it stays testable. */
export function readGitHubConfig(env: NodeJS.ProcessEnv = process.env): GitHubConfig {
  const installationId = env.GITHUB_APP_INSTALLATION_ID || '';
  const marker = env.EKOA_INSTALLATION_ID || 'standalone-dev';
  return {
    appId: env.GITHUB_APP_ID || '',
    privateKey: env.GITHUB_APP_PRIVATE_KEY || '',
    privateKeyPath: env.GITHUB_APP_PRIVATE_KEY_PATH || '',
    installationId,
    owner: env.GITHUB_ORG || env.GITHUB_OWNER || '',
    ownerType: env.GITHUB_OWNER_TYPE === 'user' ? 'user' : 'org',
    devToken: env.GITHUB_DEV_TOKEN || '',
    pushEnabled: env.GITHUB_PUSH_ENABLED === 'true',
    repoPrefix: env.GITHUB_REPO_PREFIX || 'app-',
    // Production-likeness derived from more than NODE_ENV (unset on the deploy path).
    productionLike: env.NODE_ENV === 'production' || (marker !== '' && marker !== 'standalone-dev'),
  };
}

function resolvePrivateKey(cfg: GitHubConfig): string {
  if (cfg.privateKeyPath) return readFileSync(cfg.privateKeyPath, 'utf-8');
  // env vars can't hold real newlines; accept the common `\n`-escaped form.
  return (cfg.privateKey || '').replace(/\\n/g, '\n');
}

const GITHUB_API = 'https://api.github.com';

export class GitHubAppProvider implements GitHubProvider {
  readonly kind = 'app' as const;
  private cached?: { token: string; expMs: number };

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
    private readonly installationId: string,
    readonly owner: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Sign the App JWT (RS256). GitHub caps App JWT lifetime at 10 minutes; we use 9
   * and backdate `iat` 60s to tolerate clock skew.
   */
  mintJwt(nowSec: number = Math.floor(Date.now() / 1000)): string {
    return jwt.sign(
      { iat: nowSec - 60, exp: nowSec + 9 * 60, iss: this.appId },
      this.privateKey,
      { algorithm: 'RS256' },
    );
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    // Refresh 5 minutes before expiry.
    if (this.cached && this.cached.expMs - 5 * 60 * 1000 > now) return this.cached.token;

    const res = await this.fetchImpl(
      `${GITHUB_API}/app/installations/${this.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.mintJwt()}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub App token exchange failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    this.cached = { token: data.token, expMs: new Date(data.expires_at).getTime() };
    return data.token;
  }
}

export class DevTokenProvider implements GitHubProvider {
  readonly kind = 'dev' as const;
  constructor(readonly owner: string, private readonly token: string) {}
  async getToken(): Promise<string> {
    return this.token;
  }
}

/** Build the provider for the given config, or null when GitHub isn't configured. */
export function buildGitHubProvider(cfg: GitHubConfig = readGitHubConfig()): GitHubProvider | null {
  if (cfg.appId && (cfg.privateKey || cfg.privateKeyPath) && cfg.installationId && cfg.owner) {
    return new GitHubAppProvider(cfg.appId, resolvePrivateKey(cfg), cfg.installationId, cfg.owner);
  }
  if (cfg.devToken && cfg.owner) {
    // The dev token is a personal PAT — never allow it in production (App only).
    // Fail closed: disable GitHub rather than push real apps with a personal token.
    if (cfg.productionLike) {
      console.warn(
        '[github] refusing GITHUB_DEV_TOKEN in a production-like environment — ' +
          'configure the GitHub App (GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID) instead. GitHub disabled.',
      );
      return null;
    }
    return new DevTokenProvider(cfg.owner, cfg.devToken);
  }
  return null;
}

let cached: GitHubProvider | null | undefined;

/** Cached singleton provider (null when GitHub is not configured). */
export function getGitHubProvider(): GitHubProvider | null {
  if (cached === undefined) cached = buildGitHubProvider();
  return cached;
}

/** Test seam — clear the cached provider so a new env takes effect. */
export function resetGitHubProviderCache(): void {
  cached = undefined;
}

/** Whether GitHub integration is configured at all. */
export function isGitHubConfigured(): boolean {
  return getGitHubProvider() !== null;
}

/** Whether pushing app repos to GitHub is enabled (default OFF for safety). */
export function isPushEnabled(): boolean {
  return readGitHubConfig().pushEnabled && isGitHubConfigured();
}
