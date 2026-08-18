#!/usr/bin/env node
/**
 * cli/index.ts — argv dispatch for the Ekoa Bridge CLI. No CLI framework: plain process.argv, one
 * command per top-level verb, exit codes 0 ok / 1 error / 2 usage. `main()` takes an injectable
 * context so every command is unit-testable without touching the real process; the run guard at the
 * bottom wires the real process only when this file is executed directly (not when imported by tests).
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pt } from '../i18n/pt.js';
import { defaultContext, EXIT, type CliContext } from './context.js';
import { pair } from './commands/pair.js';
import { status } from './commands/status.js';
import { serve } from './commands/serve.js';
import { unpair } from './commands/unpair.js';
import { grant } from './commands/grant.js';
import { autostart } from './commands/autostart.js';

export async function main(argv: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const ctx: CliContext = { ...defaultContext(overrides.env ?? process.env), ...overrides };
  const [command, ...rest] = argv;

  switch (command) {
    case 'pair':
      return pair(rest, ctx);
    case 'status':
      return status(rest, ctx);
    case 'serve':
      return serve(rest, ctx);
    case 'unpair':
      return unpair(rest, ctx);
    case 'grant':
      return grant(rest, ctx);
    case 'autostart':
      return autostart(rest, ctx);
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      ctx.io.out(pt.cliUsage);
      return EXIT.OK;
    default:
      ctx.io.err(pt.unknownCommand(command));
      ctx.io.out(pt.cliUsage);
      return EXIT.USAGE;
  }
}

/**
 * Run guard: execute only when invoked as the entry script, not when imported by a test.
 * `import.meta.url` is this module's realpath, but `process.argv[1]` is whatever launched us —
 * for a globally-installed bin (`npm i -g`) that is npm's SYMLINK (`<prefix>/bin/ekoa-bridge`),
 * whose path differs from the realpath. A naive URL compare is therefore false for every global
 * install and the CLI silently no-ops.
 *
 * We compare inode IDENTITY (dev+ino) via `statSync`, which follows the symlink — so the global
 * bin symlink and the module resolve to the same inode. This is symlink-safe WITHOUT `realpath`
 * (reserved for src/containment/resolver.ts by the S1 single-resolver rule) and is also robust to
 * the macOS `/var` -> `/private/var` symlink that a realpath string-compare would get wrong.
 */
export function isCliEntrypoint(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  try {
    const launched = statSync(argv1);
    const self = statSync(fileURLToPath(moduleUrl));
    return launched.dev === self.dev && launched.ino === self.ino;
  } catch {
    return false;
  }
}

if (isCliEntrypoint(process.argv[1], import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
