/**
 * `cortex` - the command-line client for the public Cortex Capability API.
 *
 * Configuration is env-only, by design: CORTEX_BASE_URL and CORTEX_API_KEY. Nothing is embedded,
 * nothing is defaulted - no key, no origin. A missing one is a usage failure naming the variable,
 * so a fitting or an agent session cannot silently talk to the wrong deployment or ship a key in
 * this repo.
 */
import { readFileSync } from 'node:fs';
import { UsageError } from './args.js';
import { CortexApiError, CortexClient, CortexNetworkError, CortexTimeoutError } from './client.js';
import { WatchTimeout, automationsCommand } from './commands/automations.js';
import { knowledgeCommand } from './commands/knowledge.js';
import { memoryCommand } from './commands/memory.js';
import type { CommandGroup } from './context.js';
import { EXIT_API_ERROR, EXIT_OK, EXIT_USAGE, printJsonError, processIo, type Io } from './output.js';

const GROUPS: readonly CommandGroup[] = [memoryCommand, knowledgeCommand, automationsCommand];

let cachedVersion: string | undefined;

/** The package version, used for the trace-only `X-Client` header. */
export function version(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    cachedVersion = pkg.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function helpText(): string {
  const lines = [
    'cortex <group> <command> [options]',
    '',
    'Groups:',
    ...GROUPS.map((g) => `  ${g.name.padEnd(12)}${g.summary}`),
    '',
    'Global options:',
    '  --json        print exactly one JSON document on stdout (nothing else)',
    '  --help, -h    this help, or a group\'s help',
    '',
    'Configuration (environment only):',
    '  CORTEX_BASE_URL   the Cortex deployment origin, e.g. https://cortex.example.com',
    '  CORTEX_API_KEY    a user-scoped gateway key (ekoa_gk_...), minted from a platform session',
    '',
    'Exit codes: 0 ok, 1 api error (refusal, timeout, network), 2 usage.',
  ];
  return lines.join('\n');
}

export interface MainOptions {
  io?: Io;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

/** Runs one invocation and RETURNS its exit code; it never calls process.exit itself. */
export async function main(argv: readonly string[], opts: MainOptions = {}): Promise<number> {
  const io = opts.io ?? processIo;
  const env = opts.env ?? process.env;
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  const wantsHelp = rest.includes('--help') || rest.includes('-h');
  const [groupName, ...groupArgv] = rest.filter((a) => a !== '--help' && a !== '-h');

  if (groupName === undefined) {
    if (wantsHelp) {
      io.out(helpText());
      return EXIT_OK;
    }
    // Help on STDERR: a bare invocation is a usage failure, and stdout stays parseable.
    if (json) printJsonError(io, 'cortex', { code: 'USAGE', message: 'no group given; see cortex --help' });
    else io.err(helpText());
    return EXIT_USAGE;
  }
  if (groupName === 'help') {
    io.out(helpText());
    return EXIT_OK;
  }
  if (groupName === '--version' || groupName === 'version') {
    io.out(json ? JSON.stringify({ ok: true, command: 'version', version: version() }, null, 2) : version());
    return EXIT_OK;
  }

  const group = GROUPS.find((g) => g.name === groupName);
  if (!group) {
    if (json) printJsonError(io, groupName, { code: 'USAGE', message: `unknown group "${groupName}"` });
    else {
      io.err(`unknown group "${groupName}"`);
      io.err(helpText());
    }
    return EXIT_USAGE;
  }
  if (wantsHelp) {
    io.out(group.usage);
    return EXIT_OK;
  }

  const command = `${group.name} ${groupArgv[0] ?? ''}`.trim();
  try {
    const client = new CortexClient({
      baseUrl: requiredEnv(env, 'CORTEX_BASE_URL'),
      apiKey: requiredEnv(env, 'CORTEX_API_KEY'),
      clientTag: `cortex-cli/${version()}`,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    await group.run({ client, json, io }, groupArgv);
    return EXIT_OK;
  } catch (error) {
    return report(io, json, command, error, group);
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new UsageError(`${name} is not set (configuration is environment-only; see cortex --help)`);
  }
  return value.trim();
}

/** One place where every failure becomes an exit code + a message on stderr. */
function report(io: Io, json: boolean, command: string, error: unknown, group: CommandGroup): number {
  if (error instanceof UsageError) {
    if (json) printJsonError(io, command, { code: error.code, message: error.message });
    else {
      io.err(`error: ${error.message}`);
      io.err('');
      io.err(group.usage);
    }
    return EXIT_USAGE;
  }
  if (error instanceof CortexApiError) {
    if (json) {
      printJsonError(io, command, {
        code: error.code,
        message: error.message,
        status: error.status,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    } else {
      io.err(`error: ${error.code} (HTTP ${error.status}): ${error.message}`);
    }
    return EXIT_API_ERROR;
  }
  if (error instanceof CortexTimeoutError || error instanceof CortexNetworkError || error instanceof WatchTimeout) {
    if (json) printJsonError(io, command, { code: error.code, message: error.message });
    else io.err(`error: ${error.code}: ${error.message}`);
    return EXIT_API_ERROR;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (json) printJsonError(io, command, { code: 'UNEXPECTED', message });
  else io.err(`error: ${message}`);
  return EXIT_API_ERROR;
}
