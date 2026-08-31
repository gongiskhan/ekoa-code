/**
 * cli/commands/pair.ts — `pair --url <cortex> [--pairing-id <id>]`.
 *
 * Runs device login against the Cortex, then writes the credential store (0600). The pairing id
 * defaults to a sanitised hostname plus a random suffix so a machine paired twice gets distinct ids
 * (a revoked pairing id can never reconnect - ekoa-bridge-wire).
 *
 * WHAT SURVIVES A RE-PAIR, and why the list is what it is. Everything in the config that is a
 * DECISION THE OPERATOR MADE ABOUT THIS MACHINE is carried forward; only the identity half
 * (pairing id, credentials, base URL) is replaced. That used to be `org` and `signingSecret` only,
 * which silently discarded the two settings that are hardest to notice missing and most expensive
 * to lose (found 2026-08-31 re-pairing after an ephemeral-Mongo wipe):
 *
 *   - `extraCapabilities`. A tier-2 capability like `desktop.automation` exists ONLY as a
 *     config-file edit, deliberately: it is not something a UI can switch on. Dropping it means the
 *     daemon silently stops advertising the capability, so Cortex has nothing to grant and every
 *     attended flow refuses with "a Ponte Ekoa ligada e demasiado antiga" - a message about the
 *     wrong thing entirely, pointing at a version rather than at an opt-in that was erased.
 *   - `egressProxy`. Without it the daemon serves no residential endpoint, so it advertises no
 *     `egress.residential`, so `checkoutSession` refuses to release the session THIS MACHINE just
 *     captured (docs/findings.md `a-ceremony-session-is-unusable-on-the-machine-that-established-it`).
 *     A re-pair therefore re-opened a HIGH finding that had already been fixed.
 *
 * Neither is a credential and neither is tied to the pairing id, so there is nothing about a new
 * pairing that makes the old answer wrong. The per-org capability GRANT is a separate thing that a
 * re-pair genuinely does invalidate - it is keyed on the pairing id, which has changed - and that
 * one has to be re-granted in Settings -> Devices.
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
    // Operator decisions about THIS MACHINE survive; see the header for what each costs when it
    // does not. Carried by presence, not by truthiness: `egressProxy: false` is an answer.
    ...(existing?.extraCapabilities ? { extraCapabilities: existing.extraCapabilities } : {}),
    ...(existing?.egressProxy !== undefined ? { egressProxy: existing.egressProxy } : {}),
    credentials,
  };
  saveConfig(home, config);

  ctx.io.out(pt.pairSuccess(credentials.user?.username));
  ctx.io.out(pt.pairStored(configPath(home)));
  return EXIT.OK;
}
