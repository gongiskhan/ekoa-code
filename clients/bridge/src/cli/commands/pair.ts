/**
 * cli/commands/pair.ts — `pair --url <cortex> [--pairing-id <id>]`.
 *
 * Runs device login against the Cortex, then writes the credential store (0600). The pairing id
 * defaults to a sanitised hostname plus a random suffix so a machine paired twice gets distinct ids
 * (a revoked pairing id can never reconnect — ekoa-bridge-wire). Existing org/signingSecret, if a
 * prior config held them, are carried forward across a re-pair.
 */
import { hostname } from 'node:os';
import {
  DeviceLoginError,
  configPath,
  ensureHome,
  loadConfig,
  runDeviceLogin,
  saveConfig,
  CredentialsError,
  type BridgeConfig,
} from '../../auth/index.js';
import { pt } from '../../i18n/pt.js';
import { EXIT, flagStr, parseFlags, type CliContext } from '../context.js';

function defaultPairingId(ctx: CliContext): string {
  const host = hostname().toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 40) || 'bridge';
  return `${host}-${ctx.randomSuffix()}`;
}

export async function pair(args: string[], ctx: CliContext): Promise<number> {
  const { flags } = parseFlags(args);
  const url = flagStr(flags, 'url');
  if (!url) {
    ctx.io.err(pt.pairUsage);
    ctx.io.err(pt.pairUrlRequired);
    return EXIT.USAGE;
  }

  const home = ensureHome(ctx.home);
  let existing: BridgeConfig | null = null;
  try {
    existing = loadConfig(home);
  } catch (err) {
    // A corrupt prior config must not block re-pairing; note it and overwrite.
    if (err instanceof CredentialsError) ctx.io.err(`${pt.errPrefix} ${err.message}`);
    else throw err;
  }
  const pairingId = flagStr(flags, 'pairing-id') ?? defaultPairingId(ctx);

  let credentials;
  try {
    credentials = await runDeviceLogin({
      cortexBaseUrl: url,
      fetchImpl: ctx.fetchImpl,
      now: ctx.now,
      sleep: ctx.sleep,
      onPrompt: (userCode, verificationUrl) => {
        ctx.io.out(pt.pairPrompt(userCode, verificationUrl));
        ctx.io.out(pt.pairWaiting);
      },
    });
  } catch (err) {
    if (err instanceof DeviceLoginError) {
      ctx.io.err(`${pt.errPrefix} ${err.message}`);
      return EXIT.ERROR;
    }
    throw err;
  }

  const config: BridgeConfig = {
    cortexBaseUrl: url,
    pairingId,
    ...(existing?.org ? { org: existing.org } : {}),
    ...(existing?.signingSecret ? { signingSecret: existing.signingSecret } : {}),
    credentials,
  };
  saveConfig(home, config);

  ctx.io.out(pt.pairSuccess(credentials.user?.username));
  ctx.io.out(pt.pairStored(configPath(home)));
  return EXIT.OK;
}
