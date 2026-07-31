/**
 * `cortex memory ...` - the memvault capability (per-user note vault, six operations).
 *
 * Every call goes through `client.call(<operationId>, slots)`. There is no HTTP in this file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { intOption, noExtraPositionals, parseArgs, valueOrPositional, type ParsedArgs } from '../args.js';
import { RuntimeFailure, UsageError } from '../errors.js';
import type { CommandGroup, Ctx } from '../context.js';
import { pad, printJson, shortTime } from '../output.js';

const TITLE_MAX = 300;

const USAGE = `cortex memory <command>

  write    write (or overwrite) one note
             --permalink <key>     the note's stable address; also the DEDUPE key - writing the
                                   same permalink twice overwrites, it never duplicates
             --file <path>         read the note body from a file
             --content <markdown>  read the note body from the argument
             --stdin               read the note body from stdin
             --title <title>       defaults to the body's first "# heading", else the file name,
                                   else the last permalink segment
             --folder <folder>     folder for a server-derived permalink
             --tag <tag>           repeatable
             --type <type>         note type (default: note)
  read     read one note            cortex memory read <permalink>
  list     list note metadata       [--folder <f>] [--limit <n>] [--cursor <c>]
  search   full-text search         cortex memory search <query> [--limit <n>]
  export   export the vault as tar  --out <path>|-
  delete   delete one note          cortex memory delete <permalink>

Every command accepts --json.`;

async function write(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 0);
  const sources = ['file', 'content'].filter((f) => args.values.has(f)).length + (args.booleans.has('stdin') ? 1 : 0);
  if (sources === 0) throw new UsageError('memory write needs one of --file, --content or --stdin');
  if (sources > 1) throw new UsageError('memory write takes exactly one of --file, --content or --stdin');

  const file = args.values.get('file');
  let contentMd: string;
  if (file !== undefined) {
    try {
      contentMd = readFileSync(file, 'utf8');
    } catch (cause) {
      throw new UsageError(`cannot read --file ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  } else if (args.booleans.has('stdin')) {
    try {
      contentMd = readFileSync(0, 'utf8');
    } catch (cause) {
      // A terminal with nothing piped in raises EAGAIN; that is a usage mistake, not a note.
      throw new UsageError(`cannot read stdin: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  } else {
    contentMd = args.values.get('content') as string;
  }

  const permalink = args.values.get('permalink');
  const title = args.values.get('title') ?? deriveTitle(contentMd, file, permalink);
  const tags = args.multi.get('tag');
  const folder = args.values.get('folder');
  const type = args.values.get('type');

  const res = await ctx.client.call('memvault.writeNote', {
    body: {
      title,
      contentMd,
      ...(permalink === undefined ? {} : { permalink }),
      ...(folder === undefined ? {} : { folder }),
      ...(tags === undefined ? {} : { tags }),
      ...(type === undefined ? {} : { type }),
    },
  });

  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'memory write', status: res.status, data: res.data });
    return;
  }
  ctx.io.out(`wrote ${res.data.permalink} (${res.data.title}), modified ${shortTime(res.data.modified)}`);
}

/**
 * A title is REQUIRED by the contract but not by every caller: a spool drain writes a captured file
 * with only `--file` and `--permalink`. Derive one rather than refuse, in this order: the body's
 * first markdown heading, the file's name, the permalink's last segment.
 */
function deriveTitle(contentMd: string, file: string | undefined, permalink: string | undefined): string {
  const heading = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/m.exec(contentMd)?.[1];
  const candidate =
    heading ??
    (file === undefined ? undefined : basename(file).replace(/\.[^.]+$/, '')) ??
    permalink?.split('/').pop() ??
    'note';
  const title = candidate.trim().slice(0, TITLE_MAX);
  return title === '' ? 'note' : title;
}

async function read(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const permalink = valueOrPositional(args, 'permalink', 0, 'permalink');
  const res = await ctx.client.call('memvault.readNote', { query: { permalink } });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'memory read', status: res.status, data: res.data });
    return;
  }
  const note = res.data;
  ctx.io.out(`# ${note.title}`);
  ctx.io.out(`permalink: ${note.permalink}   type: ${note.type}   modified: ${shortTime(note.modified)}`);
  if (note.tags.length > 0) ctx.io.out(`tags: ${note.tags.join(', ')}`);
  ctx.io.out('');
  ctx.io.out(note.contentMd);
}

async function list(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 0);
  const folder = args.values.get('folder');
  const cursor = args.values.get('cursor');
  const limit = intOption(args, 'limit', 1, 500);
  const res = await ctx.client.call('memvault.listNotes', {
    query: {
      ...(folder === undefined ? {} : { folder }),
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
    },
  });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'memory list', status: res.status, data: res.data });
    return;
  }
  if (res.data.items.length === 0) {
    ctx.io.out('no notes');
    return;
  }
  const width = Math.max(...res.data.items.map((i) => i.permalink.length));
  for (const item of res.data.items) {
    ctx.io.out(`${pad(item.permalink, width)}  ${shortTime(item.modified)}  ${item.title}`);
  }
  if (res.data.nextCursor) ctx.io.out(`-- more: --cursor ${res.data.nextCursor}`);
}

async function search(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const query = valueOrPositional(args, 'query', 0, 'query');
  const limit = intOption(args, 'limit', 1, 100);
  const res = await ctx.client.call('memvault.searchNotes', {
    body: { query, ...(limit === undefined ? {} : { limit }) },
  });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'memory search', status: res.status, data: res.data });
    return;
  }
  if (res.data.hits.length === 0) {
    ctx.io.out('no matches');
    return;
  }
  for (const hit of res.data.hits) {
    ctx.io.out(`${hit.permalink}  ${hit.title}`);
    if (hit.snippet) ctx.io.out(`    ${hit.snippet.replace(/\s+/g, ' ').trim()}`);
  }
}

async function exportVault(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 0);
  const out = args.values.get('out');

  // EVERY usage refusal is decided HERE, before the request. Exit 2 promises "nothing was sent",
  // and an export is not a free call: the server builds the whole vault, audits it, and spends the
  // key's rate window. A pure argv contradiction must never cost that.
  if (out === undefined) throw new UsageError('memory export needs --out <path> (or --out - for stdout)');
  if (out === '-' && ctx.json) {
    throw new UsageError('--out - streams raw tar bytes and cannot be combined with --json');
  }
  if (out !== '-' && !existsSync(dirname(resolve(out)))) {
    throw new UsageError(`cannot write --out ${out}: the directory does not exist`);
  }

  const res = await ctx.client.call('memvault.exportVault', {});
  const bytes = res.data;

  if (out === '-') {
    ctx.io.outBytes(bytes);
    return;
  }
  try {
    writeFileSync(out, bytes);
  } catch (cause) {
    // The export HAPPENED - it was served, audited and metered - and only the local write failed.
    // Calling that a usage error would claim nothing was sent, which is a lie about the server's
    // state, so it is an ordinary runtime failure: exit 1.
    throw new RuntimeFailure(
      'WRITE_FAILED',
      `the vault was exported (${bytes.length} bytes) but could not be written to ${out}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'memory export', status: res.status, out, bytes: bytes.length });
    return;
  }
  ctx.io.out(`exported ${bytes.length} bytes of application/x-tar to ${out}`);
}

async function remove(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const permalink = valueOrPositional(args, 'permalink', 0, 'permalink');
  const res = await ctx.client.call('memvault.deleteNote', { query: { permalink } });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'memory delete', status: res.status, data: res.data });
    return;
  }
  ctx.io.out(`deleted ${permalink}`);
}

export const memoryCommand: CommandGroup = {
  name: 'memory',
  summary: 'per-user note vault: write, read, list, search, export, delete',
  usage: USAGE,
  async run(ctx, argv) {
    const [sub, ...rest] = argv;
    switch (sub) {
      case 'write':
        return write(ctx, parseArgs(rest, { booleans: ['stdin'], values: ['permalink', 'title', 'folder', 'type', 'file', 'content'], multi: ['tag'] }));
      case 'read':
        return read(ctx, parseArgs(rest, { values: ['permalink'] }));
      case 'list':
        return list(ctx, parseArgs(rest, { values: ['folder', 'limit', 'cursor'] }));
      case 'search':
        return search(ctx, parseArgs(rest, { values: ['query', 'limit'] }));
      case 'export':
        return exportVault(ctx, parseArgs(rest, { values: ['out'] }));
      case 'delete':
        return remove(ctx, parseArgs(rest, { values: ['permalink'] }));
      default:
        throw new UsageError(sub === undefined ? 'memory needs a command' : `unknown command "memory ${sub}"`);
    }
  },
};
