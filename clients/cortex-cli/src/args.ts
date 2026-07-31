/**
 * A small, strict argv parser. Strict on purpose: this CLI is driven by agents and scripts, and a
 * silently-ignored misspelt flag is a wrong result that looks like a right one. An unknown flag,
 * a missing value or a repeated single-valued flag is a USAGE failure (exit 2).
 */

import { UsageError } from './errors.js';

export interface FlagSpec {
  /** Flags that take no value. */
  booleans?: readonly string[];
  /** Flags that take exactly one value. */
  values?: readonly string[];
  /** Flags that may be repeated, collecting their values in order. */
  multi?: readonly string[];
}

export interface ParsedArgs {
  positionals: string[];
  booleans: Set<string>;
  values: Map<string, string>;
  multi: Map<string, string[]>;
}

export function parseArgs(argv: readonly string[], spec: FlagSpec): ParsedArgs {
  const booleans = new Set(spec.booleans ?? []);
  const values = new Set(spec.values ?? []);
  const multi = new Set(spec.multi ?? []);

  const out: ParsedArgs = { positionals: [], booleans: new Set(), values: new Map(), multi: new Map() };
  let onlyPositionals = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (onlyPositionals || token === '-' || !token.startsWith('-')) {
      out.positionals.push(token);
      continue;
    }
    if (token === '--') {
      onlyPositionals = true;
      continue;
    }
    if (token === '-h') {
      out.booleans.add('help');
      continue;
    }
    if (!token.startsWith('--')) throw new UsageError(`unknown option "${token}" (only long options are supported)`);

    const eq = token.indexOf('=');
    const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).trim();
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

    if (booleans.has(name)) {
      if (inlineValue !== undefined) throw new UsageError(`--${name} is a flag and takes no value`);
      out.booleans.add(name);
      continue;
    }
    if (!values.has(name) && !multi.has(name)) throw new UsageError(`unknown option "--${name}"`);

    let value = inlineValue;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next.length > 2)) {
        throw new UsageError(`--${name} needs a value`);
      }
      value = next;
      i += 1;
    }
    if (multi.has(name)) {
      const list = out.multi.get(name) ?? [];
      list.push(value);
      out.multi.set(name, list);
    } else {
      if (out.values.has(name)) throw new UsageError(`--${name} may only be given once`);
      out.values.set(name, value);
    }
  }
  return out;
}

/** A required positional, by index, with the name used in the error message. */
export function positional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positionals[index];
  if (value === undefined || value === '') throw new UsageError(`missing <${name}>`);
  return value;
}

/** A `--flag` value or a positional fallback, whichever the caller used. */
export function valueOrPositional(args: ParsedArgs, flag: string, index: number, name: string): string {
  const flagged = args.values.get(flag);
  if (flagged !== undefined && flagged !== '') return flagged;
  return positional(args, index, name);
}

/** Parse an integer option, refusing anything that is not a whole number in range. */
export function intOption(args: ParsedArgs, name: string, min: number, max: number): number | undefined {
  const raw = args.values.get(name);
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw)) throw new UsageError(`--${name} must be an integer, got "${raw}"`);
  const value = Number(raw);
  if (value < min || value > max) throw new UsageError(`--${name} must be between ${min} and ${max}, got ${value}`);
  return value;
}

/** Refuse extra positionals so a typo'd subcommand cannot be swallowed as data. */
export function noExtraPositionals(args: ParsedArgs, allowed: number): void {
  if (args.positionals.length > allowed) {
    throw new UsageError(`unexpected argument "${args.positionals[allowed]}"`);
  }
}
