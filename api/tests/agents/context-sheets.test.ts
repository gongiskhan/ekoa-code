import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { sessions, messages } from '../../src/data/stores.js';
import { listSessionSheets, appendSheetRevision, renameSheet, derivedSheetId } from '../../src/data/session-sheets.js';
import { applyLatestSheetRevisions, loadHistory } from '../../src/agents/context.js';

/**
 * Sheet canonical-context (mega-run B1, decision B.B / locked decision 7). Two halves:
 *  - `applyLatestSheetRevisions` (pure): a turn that spawned a sheet is represented by the
 *    sheet's LATEST revision, substituted IN PLACE - never appended, so an original is never
 *    duplicated in model-bound history.
 *  - the store read path (`listSessionSheets`) + `loadHistory` wiring: a LEGACY session (no
 *    `sheets` field) derives one identity sheet per assistant message at read time, so its
 *    history is unchanged; a user edit materialises the sheet and rewrites its source turn.
 */
let mem: MongoMemoryServer;
let tick = 0;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + (tick += 1000), genId: () => `gen_${seq++}` };

const t = (n: number) => new Date(1_700_000_000_000 + n * 60_000).toISOString();

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_context_sheets');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  await sessions.deleteMany({});
  await messages.deleteMany({});
});

const seedSession = (id: string) =>
  sessions.insert({ _id: id, userId: 'u1', title: 't', status: 'active', messageCount: 0, createdAt: t(0), updatedAt: t(0) });
const seedMessage = (id: string, sessionId: string, role: string, content: string, n: number) =>
  messages.insert({ _id: id, sessionId, role, content, timestamp: t(n) });

describe('applyLatestSheetRevisions (pure - the latest-revision-canonical rule)', () => {
  it('a multi-revision sheet: ONLY the latest revision represents the turn, substituted in place', () => {
    const rows = [
      { id: 'm1', role: 'user', content: 'faz um contrato' },
      { id: 'm2', role: 'assistant', content: 'v1 do contrato' },
      { id: 'm3', role: 'user', content: 'obrigado' },
    ];
    const sheets = [
      {
        createdFromMessageId: 'm2',
        revisions: [
          { revisionId: 'r1', content: 'v1 do contrato', createdAt: t(1), editSource: 'agent' as const },
          { revisionId: 'r2', content: 'v2 com clausula nova', createdAt: t(2), editSource: 'user' as const },
          { revisionId: 'r3', content: 'v3 final', createdAt: t(3), editSource: 'user' as const },
        ],
      },
    ];
    const out = applyLatestSheetRevisions(rows, sheets);
    expect(out).toEqual([
      { role: 'user', content: 'faz um contrato' },
      { role: 'assistant', content: 'v3 final' },
      { role: 'user', content: 'obrigado' },
    ]);
    // Never duplicated: no earlier revision (nor the original) survives anywhere.
    const all = out.map((x) => x.content).join('\n');
    expect(all).not.toContain('v1 do contrato');
    expect(all).not.toContain('v2 com clausula nova');
  });

  it('a multi-sheet session: each sheet substitutes independently; unrelated turns pass through', () => {
    const rows = [
      { id: 'm1', role: 'assistant', content: 'folha A original' },
      { id: 'm2', role: 'user', content: 'edita a A' },
      { id: 'm3', role: 'assistant', content: 'folha B original' },
    ];
    const sheets = [
      {
        createdFromMessageId: 'm1',
        revisions: [
          { revisionId: 'a1', content: 'folha A original', createdAt: t(1), editSource: 'agent' as const },
          { revisionId: 'a2', content: 'folha A revista', createdAt: t(2), editSource: 'user' as const },
        ],
      },
      {
        createdFromMessageId: 'm3',
        revisions: [{ revisionId: 'b1', content: 'folha B original', createdAt: t(3), editSource: 'agent' as const }],
      },
    ];
    expect(applyLatestSheetRevisions(rows, sheets)).toEqual([
      { role: 'assistant', content: 'folha A revista' },
      { role: 'user', content: 'edita a A' },
      { role: 'assistant', content: 'folha B original' },
    ]);
  });

  it('empty inputs: no rows -> []; no sheets -> identity', () => {
    expect(applyLatestSheetRevisions([], [])).toEqual([]);
    const rows = [{ id: 'm1', role: 'user', content: 'olá' }];
    expect(applyLatestSheetRevisions(rows, [])).toEqual([{ role: 'user', content: 'olá' }]);
  });
});

describe('store read path: listSessionSheets (decision B.B - derived views, no backfill)', () => {
  it('a legacy session (no sheets field) derives one sheet per assistant message, in order', async () => {
    await seedSession('s1');
    await seedMessage('m1', 's1', 'user', 'pergunta', 1);
    await seedMessage('m2', 's1', 'assistant', '# Contrato\ncorpo', 2);
    await seedMessage('m3', 's1', 'assistant', 'Segunda resposta', 3);
    const sheets = await listSessionSheets((await sessions.get('s1'))!);
    expect(sheets.map((s) => s.sheetId)).toEqual([derivedSheetId('m2'), derivedSheetId('m3')]);
    expect(sheets[0]).toMatchObject({
      title: 'Contrato',
      createdFromMessageId: 'm2',
      revisions: [{ content: '# Contrato\ncorpo', editSource: 'agent', createdAt: t(2) }],
    });
  });

  it('a materialised sheet is canonical at its transcript position; siblings stay derived', async () => {
    await seedSession('s1');
    await seedMessage('m1', 's1', 'assistant', 'primeira folha', 1);
    await seedMessage('m2', 's1', 'assistant', 'segunda folha', 2);
    const updated = await appendSheetRevision(
      's1',
      derivedSheetId('m1'),
      { content: 'primeira folha revista', instruction: 'muda o tom', editedBy: 'u1', editSource: 'user' },
      deps,
    );
    expect(updated).not.toBeNull();
    expect(updated!.revisions).toHaveLength(2);
    expect(updated!.revisions[1]).toMatchObject({ content: 'primeira folha revista', editSource: 'user', editedBy: 'u1', instruction: 'muda o tom' });
    // Persisted as a SUBDOCUMENT on the session record (no new collection).
    const doc = (await sessions.get('s1'))!;
    expect(doc.sheets).toHaveLength(1);
    expect(doc.sheets![0]!.sheetId).toBe(derivedSheetId('m1'));
    // Read path merges: canonical for m1, still-derived for m2, transcript order kept.
    const sheets = await listSessionSheets(doc);
    expect(sheets.map((s) => s.sheetId)).toEqual([derivedSheetId('m1'), derivedSheetId('m2')]);
    expect(sheets[0]!.revisions).toHaveLength(2);
    expect(sheets[1]!.revisions).toHaveLength(1);
  });

  it('renameSheet materialises a derived sheet so the rename persists', async () => {
    await seedSession('s1');
    await seedMessage('m1', 's1', 'assistant', 'conteudo', 1);
    const renamed = await renameSheet('s1', derivedSheetId('m1'), 'Novo título', deps);
    expect(renamed!.title).toBe('Novo título');
    const again = await listSessionSheets((await sessions.get('s1'))!);
    expect(again[0]!.title).toBe('Novo título');
    // An unknown sheet id is a null (uniform not-found upstream).
    expect(await renameSheet('s1', 'sheet-nope', 'x', deps)).toBeNull();
  });
});

describe('loadHistory wiring (the ONE history-assembly point applies the canonical rule)', () => {
  it('legacy session (derived sheets): history is exactly the original transcript', async () => {
    await seedSession('s1');
    await seedMessage('m1', 's1', 'user', 'pergunta', 1);
    await seedMessage('m2', 's1', 'assistant', 'resposta original', 2);
    expect(await loadHistory('s1')).toEqual([
      { role: 'user', content: 'pergunta' },
      { role: 'assistant', content: 'resposta original' },
    ]);
  });

  it('a user-edited sheet rewrites its source turn to the LATEST revision, never duplicating the original', async () => {
    await seedSession('s1');
    await seedMessage('m1', 's1', 'user', 'faz a minuta', 1);
    await seedMessage('m2', 's1', 'assistant', 'minuta original', 2);
    await seedMessage('m3', 's1', 'user', 'muda a data', 3);
    await appendSheetRevision('s1', derivedSheetId('m2'), { content: 'minuta com data nova', editedBy: 'u1', editSource: 'user' }, deps);
    const history = await loadHistory('s1');
    expect(history).toEqual([
      { role: 'user', content: 'faz a minuta' },
      { role: 'assistant', content: 'minuta com data nova' },
      { role: 'user', content: 'muda a data' },
    ]);
    expect(history.map((h) => h.content)).not.toContain('minuta original');
  });

  it('empty session: no messages -> empty history', async () => {
    await seedSession('s1');
    expect(await loadHistory('s1')).toEqual([]);
  });
});
