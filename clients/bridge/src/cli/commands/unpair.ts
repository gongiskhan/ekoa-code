/**
 * cli/commands/unpair.ts — `unpair`: remove the local pairing and credentials.
 *
 * Prints what will be lost (pairing id, Cortex, whether credentials are held) BEFORE deleting the
 * config file. Local-only: a revoked/removed pairing id can never reconnect, so there is no server
 * call to make. Grants and the ledger are left in place (they are not the pairing).
 */
import { rmSync } from 'node:fs';
import { CredentialsError, configPath, loadConfig } from '../../auth/index.js';
import { pt } from '../../i18n/pt.js';
import { EXIT, type CliContext } from '../context.js';

export function unpair(_args: string[], ctx: CliContext): Promise<number> {
  let config;
  try {
    config = loadConfig(ctx.home);
  } catch (err) {
    if (err instanceof CredentialsError) {
      ctx.io.err(`${pt.errPrefix} ${err.message}`);
      return Promise.resolve(EXIT.ERROR);
    }
    throw err;
  }

  if (!config) {
    ctx.io.out(pt.unpairNothing);
    return Promise.resolve(EXIT.OK);
  }

  ctx.io.out(pt.unpairWillLose(config.pairingId, config.cortexBaseUrl, !!config.credentials));
  rmSync(configPath(ctx.home), { force: true });
  ctx.io.out(pt.unpairDone);
  return Promise.resolve(EXIT.OK);
}
