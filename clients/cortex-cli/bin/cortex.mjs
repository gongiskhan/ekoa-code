#!/usr/bin/env node
/**
 * The `cortex` entry point. A thin shim on purpose: it resolves the built CLI, arms the pipe
 * guard, runs one invocation, and sets the exit code. Everything else lives in src/ (and
 * therefore in dist/).
 *
 * Build before use: `npm run build --workspace @ekoa/cortex-cli`.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/cli.js', import.meta.url);
if (!existsSync(fileURLToPath(dist))) {
  process.stderr.write(`cortex: not built (${fileURLToPath(dist)} missing).\nRun: npm run build --workspace @ekoa/cortex-cli\n`);
  process.exit(2);
}

const { main } = await import(dist.href);
const { installPipeGuard } = await import(new URL('../dist/output.js', import.meta.url).href);

// A reader that closes early (`| head`, `| tar -tf -`) must not produce a Node stack trace.
installPipeGuard();

// Exit CODE, not process.exit(): a hard exit can truncate a large --json or tar write on a pipe.
process.exitCode = await main(process.argv.slice(2));
