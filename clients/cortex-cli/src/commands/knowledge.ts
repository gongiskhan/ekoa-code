/**
 * `cortex knowledge ...` - the org knowledge vault, READ ONLY over a key: search, read one
 * document, browse collections and documents. Ingestion is deliberately not on the key-reachable
 * surface, so there is no write subcommand to write.
 */
import { intOption, noExtraPositionals, parseArgs, positional, valueOrPositional, type ParsedArgs } from '../args.js';
import { UsageError } from '../errors.js';
import type { CommandGroup, Ctx } from '../context.js';
import { pad, printJson } from '../output.js';

const USAGE = `cortex knowledge <command>

  search       full-text search over the org vault + the shared corpus
                 cortex knowledge search <query> [--collection <c>] [--limit <n>]
  read         read one document
                 cortex knowledge read <collection> <docId>
  collections  list the collections available to the caller
  documents    list document metadata  [--collection <c>] [--limit <n>] [--offset <n>]

Every command accepts --json. Each hit and document says scope: "org" or "shared".`;

async function search(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const query = valueOrPositional(args, 'query', 0, 'query');
  const collection = args.values.get('collection');
  const limit = intOption(args, 'limit', 1, 50);
  const res = await ctx.client.call('knowledge.searchKnowledge', {
    body: {
      query,
      ...(collection === undefined ? {} : { collection }),
      ...(limit === undefined ? {} : { limit }),
    },
  });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'knowledge search', status: res.status, data: res.data });
    return;
  }
  if (res.data.hits.length === 0) {
    ctx.io.out('no matches');
    return;
  }
  for (const hit of res.data.hits) {
    ctx.io.out(`${hit.collection}/${hit.docId}  [${hit.scope}]  ${hit.title ?? ''}`.trimEnd());
    if (hit.snippet) ctx.io.out(`    ${hit.snippet.replace(/\s+/g, ' ').trim()}`);
  }
}

async function read(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 2);
  const collection = args.values.get('collection') ?? positional(args, 0, 'collection');
  const docId = args.values.get('doc-id') ?? positional(args, args.values.has('collection') ? 0 : 1, 'docId');
  const res = await ctx.client.call('knowledge.readKnowledgeDoc', { path: { collection, docId } });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'knowledge read', status: res.status, data: res.data });
    return;
  }
  const doc = res.data;
  ctx.io.out(`# ${doc.title}`);
  ctx.io.out(`${doc.collection}/${doc.id}  [${doc.scope}]`);
  ctx.io.out('');
  ctx.io.out(doc.contentMd);
}

async function collections(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 0);
  const res = await ctx.client.call('knowledge.listCollections', {});
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'knowledge collections', status: res.status, data: res.data });
    return;
  }
  if (res.data.items.length === 0) {
    ctx.io.out('no collections');
    return;
  }
  for (const name of res.data.items) ctx.io.out(name);
}

async function documents(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 0);
  const collection = args.values.get('collection');
  const limit = intOption(args, 'limit', 1, 500);
  const offset = intOption(args, 'offset', 0, Number.MAX_SAFE_INTEGER);
  const res = await ctx.client.call('knowledge.listDocuments', {
    query: {
      ...(collection === undefined ? {} : { collection }),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    },
  });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'knowledge documents', status: res.status, data: res.data });
    return;
  }
  if (res.data.items.length === 0) {
    ctx.io.out('no documents');
    return;
  }
  const width = Math.max(...res.data.items.map((d) => `${d.collection}/${d.id}`.length));
  for (const doc of res.data.items) ctx.io.out(`${pad(`${doc.collection}/${doc.id}`, width)}  ${doc.title}`);
  ctx.io.out(`-- ${res.data.items.length} of ${res.data.total}`);
}

export const knowledgeCommand: CommandGroup = {
  name: 'knowledge',
  summary: 'org knowledge vault (read only): search, read, collections, documents',
  usage: USAGE,
  async run(ctx, argv) {
    const [sub, ...rest] = argv;
    switch (sub) {
      case 'search':
        return search(ctx, parseArgs(rest, { values: ['query', 'collection', 'limit'] }));
      case 'read':
        return read(ctx, parseArgs(rest, { values: ['collection', 'doc-id'] }));
      case 'collections':
        return collections(ctx, parseArgs(rest, {}));
      case 'documents':
        return documents(ctx, parseArgs(rest, { values: ['collection', 'limit', 'offset'] }));
      default:
        throw new UsageError(sub === undefined ? 'knowledge needs a command' : `unknown command "knowledge ${sub}"`);
    }
  },
};
