/** What every subcommand is handed: the one client, the output mode, and the streams. */
import type { CortexClient } from './client.js';
import type { Io } from './output.js';

export interface Ctx {
  client: CortexClient;
  /** `--json` was given: print exactly one JSON document and nothing else. */
  json: boolean;
  io: Io;
}

export interface CommandGroup {
  name: string;
  /** One-line summary for `cortex --help`. */
  summary: string;
  /** Full usage text for `cortex <group> --help`. */
  usage: string;
  run(ctx: Ctx, argv: readonly string[]): Promise<void>;
}
