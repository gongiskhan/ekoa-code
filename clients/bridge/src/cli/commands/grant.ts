/**
 * cli/commands/grant.ts — `grant add --path <dir> [--session <id>]`: authorise a directory.
 *
 * With no --path, opens the native macOS folder picker (osascript; never on CI / off macOS). The
 * chosen (or given) path is made absolute and confirmed to be a directory, then stored in grants.json
 * as { grantRef, root, session, createdAt }. This only RECORDS the grant; task-time path containment
 * is re-validated by src/containment at use, so absolutising the root here is not the single resolver.
 */
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { addGrant, ensureHome, type StoredGrant } from '../../auth/index.js';
import { pt } from '../../i18n/pt.js';
import { EXIT, flagStr, parseFlags, type CliContext } from '../context.js';

export async function grant(args: string[], ctx: CliContext): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== 'add') {
    ctx.io.err(pt.grantUsage);
    return EXIT.USAGE;
  }

  const { flags } = parseFlags(rest);
  let root = flagStr(flags, 'path');
  if (!root) {
    const picked = await ctx.pickFolder(pt.grantPickPrompt);
    if (!picked.ok) {
      if (picked.reason === 'unavailable') {
        ctx.io.err(pt.grantNoPath);
        return EXIT.USAGE;
      }
      ctx.io.err(pt.grantPickerCancelled);
      return EXIT.ERROR;
    }
    root = picked.path;
  }

  const abs = resolve(root);
  let isDir: boolean;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    ctx.io.err(`${pt.errPrefix} ${pt.grantNotADir(abs)}`);
    return EXIT.ERROR;
  }

  const home = ensureHome(ctx.home);
  const record: StoredGrant = {
    grantRef: `g-${ctx.randomSuffix()}`,
    root: abs,
    session: flagStr(flags, 'session') ?? 'default',
    createdAt: new Date(ctx.now()).toISOString(),
  };
  addGrant(home, record);

  ctx.io.out(pt.grantAdded(record.grantRef, record.root, record.session));
  return EXIT.OK;
}
