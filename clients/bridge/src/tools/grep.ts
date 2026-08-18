/**
 * tools/grep.ts — the `grep` tool, backed by the bundled @vscode/ripgrep binary (§18.5 fixed
 * vocabulary; output-capped).
 *
 * SECURITY: this is the one tool that runs an external binary, so it is hardened against argument
 * injection two ways: (1) a pattern that begins with `-` is refused outright (denied + ledgered),
 * and (2) the pattern and the search directory are passed AFTER a `--` end-of-options marker so
 * neither can be reinterpreted as a ripgrep flag. The search directory is the RESOLVED real grant
 * root from the containment resolver — never caller-supplied text — and ripgrep does not follow
 * symlinks by default, so a match can never escape the grant.
 *
 * BOUNDS: the child runs with a 30s timeout and a 1MB stdout cap (`maxBuffer`); overflowing the cap
 * kills the child, and whatever bounded output was captured is still parsed (a torn trailing JSON
 * line is skipped), so a pathological tree yields a bounded result instead of an OOM. Parsing also
 * stops at `maxMatches`, and each match line is truncated to `maxLineLength`. Ledgered like the other
 * derived-content tools: one egress row (`tool='grep'`) whose `bytesOut` is the serialized
 * result-array length, capped like any emission.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rgPath } from '@vscode/ripgrep';
import { relativeToRealRoot } from '../containment/index.js';
import { emit, resolveInGrant, denyAndThrow, type ToolContext } from './types.js';

const execFileP = promisify(execFile);

/** Hard stdout ceiling for the ripgrep child: overflow kills it, we parse the bounded capture. */
const OUTPUT_CAP_BYTES = 1024 * 1024;
const TIMEOUT_MS = 30_000;

export interface GrepOptions {
  maxMatches?: number;
  maxLineLength?: number;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface GrepResult {
  matches: GrepMatch[];
}

export async function grep(
  ctx: ToolContext,
  grantRef: string,
  pattern: string,
  opts: GrepOptions = {},
): Promise<GrepResult> {
  const maxMatches = opts.maxMatches ?? 200;
  const maxLineLength = opts.maxLineLength ?? 500;

  // Argument-injection guard: a leading '-' would let the pattern masquerade as a ripgrep option.
  if (pattern.startsWith('-')) {
    denyAndThrow(ctx, 'grep pattern rejected: leading dash', 'S1', 'grep');
  }

  const { grant, real, ledgerPath } = resolveInGrant(ctx, grantRef, '.', 'grep');

  // `--` ends options: everything after is positional (PATTERN then PATH), so neither can be a flag.
  const args = ['--json', '--no-messages', '--', pattern, real];
  let stdout: string;
  try {
    const res = await execFileP(rgPath, args, { timeout: TIMEOUT_MS, maxBuffer: OUTPUT_CAP_BYTES });
    stdout = res.stdout;
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string | Buffer };
    // ripgrep's exit codes: 0 = matches, 1 = NO matches (a normal empty result), 2 = a usage/regex
    // ERROR (e.g. an unbalanced-paren pattern). Conflating 2 with 1 would report "no occurrences" as
    // authoritative when the search never ran — so exit 2 is a real failure: deny + ledger (S1),
    // never a silent empty success (the review's grep finding).
    if (e.code === 2) {
      denyAndThrow(ctx, 'grep pattern error', 'S1', 'grep');
    }
    // Otherwise (exit 1 no-matches, or a `maxBuffer`/`timeout` kill that still attaches the bounded
    // capture) parse whatever bounded stdout we have — a pathological tree yields a bounded result.
    stdout = e.stdout === undefined ? '' : typeof e.stdout === 'string' ? e.stdout : e.stdout.toString('utf8');
  }

  const matches: GrepMatch[] = [];
  for (const line of stdout.split('\n')) {
    if (matches.length >= maxMatches) break;
    if (line.length === 0) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // a torn trailing line from the maxBuffer cut — skip it
    }
    const m = asRipgrepMatch(obj);
    if (!m) continue;
    matches.push({
      path: relativeToRealRoot(grant.root, m.absPath),
      line: m.lineNumber,
      text: m.text.replace(/\r?\n$/, '').slice(0, maxLineLength),
    });
  }

  const payload = Buffer.from(JSON.stringify(matches), 'utf8');
  emit(ctx, 'grep', ledgerPath, `0-${payload.length}`, payload);
  return { matches };
}

/** A parsed ripgrep `--json` `match` record (absolute path, 1-based line, raw matched line). */
interface RgMatch {
  absPath: string;
  lineNumber: number;
  text: string;
}

function asRipgrepMatch(obj: unknown): RgMatch | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const o = obj as Record<string, unknown>;
  if (o.type !== 'match') return undefined;
  const data = o.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  const absPath = textField(data.path);
  const text = textField(data.lines);
  const lineNumber = data.line_number;
  if (absPath === undefined || text === undefined || typeof lineNumber !== 'number') return undefined;
  return { absPath, lineNumber, text };
}

/** ripgrep encodes a path/line as `{text: string}` (utf8) or `{bytes: base64}`; we take `.text`. */
function textField(field: unknown): string | undefined {
  if (typeof field !== 'object' || field === null) return undefined;
  const t = (field as Record<string, unknown>).text;
  return typeof t === 'string' ? t : undefined;
}
