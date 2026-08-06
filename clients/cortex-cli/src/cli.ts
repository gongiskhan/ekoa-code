/**
 * `cortex` - the command-line client for the public Cortex Capability API.
 *
 * Configuration is env-only, by design: CORTEX_BASE_URL and CORTEX_API_KEY. Nothing is embedded,
 * nothing is defaulted - no key, no origin. A missing one is a usage failure naming the variable,
 * so a fitting or an agent session cannot silently talk to the wrong deployment or ship a key in
 * this repo.
 */
import { readFileSync } from 'node:fs';
import { CortexApiError, CortexClient, CortexNetworkError, CortexTimeoutError } from './client.js';
import { automationsCommand } from './commands/automations.js';
import { integrationsCommand } from './commands/integrations.js';
import { knowledgeCommand } from './commands/knowledge.js';
import { memoryCommand } from './commands/memory.js';
import type { CommandGroup } from './context.js';
import { RuntimeFailure, UsageError } from './errors.js';
import { EXIT_API_ERROR, EXIT_OK, EXIT_USAGE, printJson, printJsonError, processIo, type Io } from './output.js';
import { makeRedactor, redactValue } from './redact.js';

const GROUPS: readonly CommandGroup[] = [memoryCommand, knowledgeCommand, automationsCommand, integrationsCommand];

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
    // Wide enough for the longest group name plus a gap: at padEnd(12) "integrations" ran straight
    // into its own summary.
    ...GROUPS.map((g) => `  ${g.name.padEnd(14)}${g.summary}`),
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

  // Global flags are recognised anywhere - EXCEPT after `--`. Everything from the end-of-options
  // marker onwards belongs to the command as data (`cortex memory search -- -h` searches for the
  // literal "-h"), so it is sliced off before the scan and handed through untouched; stripping a
  // flag out of it would answer a different question under a success code.
  const cut = argv.indexOf('--');
  const head = cut === -1 ? [...argv] : argv.slice(0, cut);
  const tail = cut === -1 ? [] : argv.slice(cut);

  const json = head.includes('--json');
  const wantsHelp = head.includes('--help') || head.includes('-h');
  const [groupName, ...groupArgv] = [
    ...head.filter((a) => a !== '--json' && a !== '--help' && a !== '-h'),
    ...tail,
  ];

  /** Help is OUTPUT, so under --json it must be a JSON document like everything else on stdout. */
  const emitHelp = (command: string, text: string): number => {
    if (json) printJson(io, { ok: true, command, help: text });
    else io.out(text);
    return EXIT_OK;
  };

  if (groupName === undefined) {
    if (wantsHelp) return emitHelp('help', helpText());
    // A bare invocation is a usage failure: help goes to stderr so stdout stays parseable.
    if (json) printJsonError(io, 'cortex', { code: 'USAGE', message: 'no group given; see cortex --help' });
    else io.err(helpText());
    return EXIT_USAGE;
  }
  if (groupName === 'help') return emitHelp('help', helpText());
  if (groupName === '--version' || groupName === 'version') {
    if (json) printJson(io, { ok: true, command: 'version', version: version() });
    else io.out(version());
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
  if (wantsHelp) return emitHelp(`${group.name} help`, group.usage);

  const command = `${group.name} ${groupArgv[0] ?? ''}`.trim();
  // The LAST line of defence for the credential: everything this invocation prints on failure goes
  // through report(), so the scrubber is built here, from the configured key, and applied to every
  // message regardless of which layer raised it (client.ts scrubs its own too - two independent
  // passes, because one missed message is one leaked key).
  // Trimmed, to match the value actually sent: requiredEnv trims before use, so an
  // untrimmed pattern would never match the key on the wire.
  const redact = makeRedactor(env.CORTEX_API_KEY?.trim());
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
    return report(io, json, command, error, group, redact);
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new UsageError(`${name} is not set (configuration is environment-only; see cortex --help)`);
  }
  return value.trim();
}

/** One place where every failure becomes an exit code + a scrubbed message on stderr. */
function report(
  io: Io,
  json: boolean,
  command: string,
  error: unknown,
  group: CommandGroup,
  redact: (text: string) => string,
): number {
  if (error instanceof UsageError) {
    if (json) printJsonError(io, command, { code: error.code, message: redact(error.message) });
    else {
      io.err(`error: ${redact(error.message)}`);
      io.err('');
      io.err(group.usage);
    }
    return EXIT_USAGE;
  }
  if (error instanceof CortexApiError) {
    if (json) {
      printJsonError(io, command, {
        code: error.code,
        message: redact(error.message),
        status: error.status,
        ...(error.details === undefined ? {} : { details: redactValue(redact, error.details) }),
      });
    } else {
      io.err(`error: ${error.code} (HTTP ${error.status}): ${redact(error.message)}`);
    }
    return EXIT_API_ERROR;
  }
  if (error instanceof CortexTimeoutError || error instanceof CortexNetworkError || error instanceof RuntimeFailure) {
    // A RuntimeFailure may carry the server document that explains it (`integrations execute`
    // reads its failure out of an HTTP 200 body). It rides in `details`, exactly as an api
    // refusal's does, because stdout is empty on the failure path and there is nowhere else.
    const details = error instanceof RuntimeFailure ? error.details : undefined;
    if (json) {
      printJsonError(io, command, {
        code: error.code,
        message: redact(error.message),
        ...(details === undefined ? {} : { details: redactValue(redact, details) }),
      });
    } else io.err(`error: ${error.code}: ${redact(error.message)}`);
    return EXIT_API_ERROR;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (json) printJsonError(io, command, { code: 'UNEXPECTED', message: redact(message) });
  else io.err(`error: ${redact(message)}`);
  return EXIT_API_ERROR;
}
