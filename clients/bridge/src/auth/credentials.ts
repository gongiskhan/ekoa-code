/**
 * auth/credentials.ts — the on-disk credential store: `config.json` under EKOA_BRIDGE_HOME.
 *
 * Provenance: the load/store/expiry shape is a port of the archived Bun-era
 * `ekoa-local/src/auth/device-login.ts` (loadCredential/storeCredential/isExpired), rewritten for the
 * Ekoa Bridge config shape and Node. The file is written 0600 (owner read/write only) and the mode is
 * re-asserted on every save because Node applies the create-time `mode` only when the file is new.
 *
 * Shape (architecture.md "Auth/pairing"; FLOW_PLAN §Credential store):
 *   { cortexBaseUrl, pairingId, org?, signingSecret?, credentials?: { access, refresh?, expires, user } }
 * `expires` is an absolute epoch-ms instant (not a TTL). Nothing here is hosted-persisted.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Absolute expiry, in epoch milliseconds, applied with a skew so we refresh before the real edge. */
const DEFAULT_EXPIRY_SKEW_MS = 60_000;

/** The identity the platform token carries (mirrors ekoa-code's AuthUserView; kept loose). */
export const StoredUser = z
  .object({ id: z.string(), username: z.string(), role: z.string() })
  .passthrough();
export type StoredUser = z.infer<typeof StoredUser>;

/** The platform credential minted by device login (the durable primary credential). */
export const PlatformCredentials = z.object({
  access: z.string(),
  refresh: z.string().optional(),
  /** Absolute expiry, epoch ms. */
  expires: z.number(),
  user: StoredUser.optional(),
});
export type PlatformCredentials = z.infer<typeof PlatformCredentials>;

export const BridgeConfig = z.object({
  cortexBaseUrl: z.string(),
  pairingId: z.string(),
  org: z.string().optional(),
  signingSecret: z.string().optional(),
  credentials: PlatformCredentials.optional(),
  /** Fixed port for the loopback browser surface (C1); absent → DEFAULT_SURFACE_PORT. */
  surfacePort: z.number().int().positive().optional(),
  /** Browser origins the loopback surface reflects in CORS (C2); absent → the dev defaults. */
  surfaceOrigins: z.array(z.string()).optional(),
  /**
   * Capabilities this machine advertises BEYOND the ones it can always do (I-1). Advertisement is a
   * self-assertion that authorises nothing — Cortex intersects it with a per-org grant (I-3, default
   * deny) — but it is still the operator's statement about the machine, so the surfaces that are
   * exfiltration-capable or unvalidated are opt-in here rather than claimed by default.
   */
  extraCapabilities: z.array(z.string()).optional(),
  /** Tailnet address offered for residential egress. Absent = this machine offers no egress. */
  egressEndpoint: z.string().optional(),
  /**
   * SERVE THE RESIDENTIAL EGRESS FROM THIS DAEMON instead of naming someone else's proxy.
   *
   * `egressEndpoint` above assumes the operator already runs a proxy on this machine and can write
   * down its address. Almost nobody does, so almost no bridge advertised `egress.residential` - and
   * a machine that offers no egress cannot check out the sessions its OWN ceremonies captured
   * (`egress/proxy.ts` names the live defect). Setting this starts a forward proxy in the daemon and
   * uses its address as the endpoint.
   *
   * OPT-IN, like `local.bash` and `desktop.automation`, and for the same reason: a forward proxy is
   * an exfiltration surface. `true` binds loopback on a FIXED port (8792), which is all a Cortex on
   * this machine needs - fixed because an `egress.residential` grant names the endpoint it
   * authorises and Cortex matches it by equality, so a moving address voids the grant on every
   * restart. An object names the port and, only if the operator says so, a non-loopback
   * host - a routable bind is an open relay for whoever can reach it, so it is never defaulted.
   * An explicit `egressEndpoint` wins: someone who named an address meant it.
   */
  egressProxy: z
    .union([z.boolean(), z.object({ port: z.number().int().min(0).max(65535).optional(), host: z.string().optional() })])
    .optional(),
  /** Human-readable machine name shown in the Ekoa machine list; absent → the OS hostname. */
  machineName: z.string().optional(),
});
export type BridgeConfig = z.infer<typeof BridgeConfig>;

/** A corrupt or schema-invalid `config.json`. Kept distinct from "no config at all" (which is null). */
export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialsError';
  }
}

/** Absolute path of the config file inside a given home directory. */
export function configPath(home: string): string {
  return join(home, 'config.json');
}

/**
 * Load the config from `home`. Returns null when the file does not exist (an unpaired daemon), and
 * throws CredentialsError when the file exists but is unreadable, non-JSON, or fails the schema —
 * corruption must be surfaced, never silently treated as "unpaired".
 */
export function loadConfig(home: string): BridgeConfig | null {
  let raw: string;
  try {
    raw = readFileSync(configPath(home), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new CredentialsError(`config.json ilegível: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CredentialsError('config.json não é JSON válido.');
  }
  const result = BridgeConfig.safeParse(parsed);
  if (!result.success) throw new CredentialsError('config.json tem um formato inválido.');
  return result.data;
}

/** Persist the config to `home`, 0600. The mode is re-asserted so an existing file is tightened. */
export function saveConfig(home: string, config: BridgeConfig): void {
  const path = configPath(home);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** True when the credential is expired or within `skewMs` of expiring (refresh-before-edge). */
export function isExpired(
  cred: PlatformCredentials,
  skewMs: number = DEFAULT_EXPIRY_SKEW_MS,
  now: number = Date.now(),
): boolean {
  return cred.expires <= now + skewMs;
}
