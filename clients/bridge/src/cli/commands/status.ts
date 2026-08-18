/**
 * cli/commands/status.ts — `status`: report pairing presence, credential expiry, and whether the
 * daemon is running. Read-only and non-interactive; exits 0 whether paired or not (a missing config
 * is a normal "not paired" state, not an error). A corrupt config is the one error path.
 */
import { CredentialsError, isExpired, loadConfig } from '../../auth/index.js';
import { pt } from '../../i18n/pt.js';
import { EXIT, type CliContext } from '../context.js';
import { isProcessAlive, readDaemonPid } from '../pidfile.js';

export function status(_args: string[], ctx: CliContext): Promise<number> {
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
    ctx.io.out(pt.statusNotPaired);
    return Promise.resolve(EXIT.OK);
  }

  ctx.io.out(pt.statusPairing(config.pairingId, config.cortexBaseUrl));

  const cred = config.credentials;
  if (!cred) {
    ctx.io.out(pt.statusCredNone);
  } else {
    const whenIso = new Date(cred.expires).toISOString();
    // Report actual expiry (skew 0) — status is a factual snapshot, not a refresh decision.
    ctx.io.out(isExpired(cred, 0, ctx.now()) ? pt.statusCredExpired(whenIso) : pt.statusCredValid(whenIso));
  }

  const pid = readDaemonPid(ctx.home);
  ctx.io.out(pid && isProcessAlive(pid) ? pt.statusServeRunning(pid) : pt.statusServeStopped);
  return Promise.resolve(EXIT.OK);
}
