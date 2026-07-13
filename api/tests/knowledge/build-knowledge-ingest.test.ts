import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import type { Actor } from '@ekoa/shared';
import { ingestDocument, listDocuments, KnowledgeError } from '../../src/knowledge/service.js';
import { search, closeIndex } from '../../src/knowledge/index-store.js';
import { SHARED_ORG_ID } from '../../src/knowledge/paths.js';
import {
  ingestBuildKnowledge,
  setIngestBuildKnowledge,
  __resetAgentSeamsForTests,
} from '../../src/agents/seams.js';

/**
 * F1 knowledge-during-build: the mid-build ingest seam (agents/seams.ts `ingestBuildKnowledge`),
 * wired exactly as the composition root wires it (server.ts) - forwarding to the knowledge
 * service's `ingestDocument` with a `build-scoping` sourceType default. Proves the load-bearing
 * invariants at the seam: the doc lands in the RUN ACTOR's org partition, is searchable
 * IMMEDIATELY (no rebuild/optimize), never crosses into another org, and the reserved `_shared`
 * partition is refused (the service's assertNotSharedActor - no new permission logic here).
 */
let mem: MongoMemoryServer;
let dir: string;
let n = 0;
const deps = { now: () => 1_700_000_000_000 + n, genId: () => `d${n++}` };
const actor = (orgId: string): Actor => ({ userId: `u-${orgId}`, orgId, role: 'builder' });

// The production binding (server.ts): forward to ingestDocument, default sourceType 'build-scoping'.
const bindLikeServer = (): void =>
  setIngestBuildKnowledge(async (a, doc, d) =>
    ingestDocument(
      a,
      {
        collection: doc.collection,
        title: doc.title,
        text: doc.text,
        sourceType: doc.sourceType ?? 'build-scoping',
        ...(doc.language ? { language: doc.language } : {}),
      },
      d,
    ),
  );

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_build_knowledge_ingest');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-build-ingest-'));
  process.env.EKOA_DATA_DIR = dir;
  bindLikeServer();
});
afterEach(async () => {
  __resetAgentSeamsForTests();
  closeIndex();
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('ingestBuildKnowledge seam (mid-build ingest)', () => {
  it('ingests into the run actor org and the doc is IMMEDIATELY searchable', async () => {
    const { id } = await ingestBuildKnowledge(
      actor('orgA'),
      { collection: 'uploads', title: 'Tabela de custas 2026', text: 'taxa de justiça e custas do processo' },
      deps,
    );
    expect(id).toBeTruthy();
    // searchable in the same call - no reindex/backfill/optimize between ingest and search
    expect(search('orgA', 'custas', 5).map((h) => h.docId)).toContain(id);
    // sourceType marks it build-originated (default at the binding)
    const listed = await listDocuments(actor('orgA'), {});
    expect(listed.items.find((d) => d.id === id)?.sourceType).toBe('build-scoping');
  });

  it('is org-scoped: a second org never sees the doc (partition holds)', async () => {
    const { id } = await ingestBuildKnowledge(
      actor('orgA'),
      { collection: 'uploads', title: 'Só orgA', text: 'penhora de bens do executado' },
      deps,
    );
    expect(search('orgA', 'penhora', 5).map((h) => h.docId)).toContain(id);
    expect(search('orgB', 'penhora', 5)).toHaveLength(0); // orgB partition is empty
  });

  it('refuses the reserved _shared partition (FORBIDDEN 403 via the service guard)', async () => {
    await expect(
      ingestBuildKnowledge(actor(SHARED_ORG_ID), { collection: 'c', title: 'T', text: 'x' }, deps),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(
      ingestBuildKnowledge(actor(SHARED_ORG_ID), { collection: 'c', title: 'T', text: 'x' }, deps),
    ).rejects.toBeInstanceOf(KnowledgeError);
  });

  it('honest default (unwired root): ingests nothing and returns an empty id', async () => {
    __resetAgentSeamsForTests(); // drop the server-like binding
    const { id } = await ingestBuildKnowledge(
      actor('orgA'),
      { collection: 'uploads', title: 'T', text: 'prazo de recurso' },
      deps,
    );
    expect(id).toBe('');
    expect(search('orgA', 'prazo', 5)).toHaveLength(0); // nothing persisted
  });
});
