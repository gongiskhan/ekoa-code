import { describe, it, expect, afterEach } from 'vitest';
import { knowledgeToolSpecs, loadContextToolSpec } from '../../src/agents/sdk-tools.js';
import { KNOWLEDGE_TOOLS, CONTEXT_LOADING_TOOL } from '../../src/agents/tools.js';
import {
  setKnowledgeToolSearch,
  setKnowledgeToolRead,
  setLoadContextContent,
  __resetAgentSeamsForTests,
} from '../../src/agents/seams.js';

/**
 * In-process MCP tool declarations (ch05 §5.4.4). The critical property: the org/user identity
 * binds from the run's ACTOR at spec-build time — tool arguments can never address another org
 * (ch04 §4.4.1 partitioning; ch09). G7B post-gate fix for the unimplemented-§5.4.4-tools finding.
 */

const actor = { userId: 'u1', orgId: 'org-A' };

afterEach(() => __resetAgentSeamsForTests());

describe('knowledgeToolSpecs (§5.4.4 chat tools)', () => {
  it('declares exactly the two §5.4.4 knowledge tools, in policy order', () => {
    expect(knowledgeToolSpecs(actor).map((s) => s.name)).toEqual([...KNOWLEDGE_TOOLS]);
  });

  it('knowledge_search is org-locked to the actor — an orgId-shaped argument is ignored', async () => {
    const seen: string[] = [];
    setKnowledgeToolSearch(async ({ orgId }) => {
      seen.push(orgId);
      return [];
    });
    const [search] = knowledgeToolSpecs(actor);
    await search!.handler({ query: 'contrato', orgId: 'org-B' }); // injected arg must not win
    expect(seen).toEqual(['org-A']);
  });

  it('knowledge_search formats cited hits and reports an honest empty', async () => {
    setKnowledgeToolSearch(async () => [
      { docId: 'd1', collection: 'contratos', title: 'Minuta NDA', sourceUrl: 'https://x', snip: 'cláusula…' },
    ]);
    const [search] = knowledgeToolSpecs(actor);
    const text = await search!.handler({ query: 'nda' });
    expect(text).toContain('[contratos/d1] Minuta NDA');
    expect(text).toContain('cláusula…');
    setKnowledgeToolSearch(async () => []);
    expect(await search!.handler({ query: 'nada' })).toBe('Sem resultados na base de conhecimento.');
  });

  it('knowledge_read is org-locked and honest on a missing document', async () => {
    const seen: Array<{ orgId: string; collection: string; docId: string }> = [];
    setKnowledgeToolRead(async (input) => {
      seen.push(input);
      return input.docId === 'd1' ? { title: 'Minuta NDA', sourceUrl: '', body: 'corpo' } : null;
    });
    const read = knowledgeToolSpecs(actor)[1]!;
    expect(await read.handler({ collection: 'contratos', docId: 'd1' })).toContain('corpo');
    expect(await read.handler({ collection: 'contratos', docId: 'ghost' })).toBe('Documento não encontrado.');
    expect(seen.every((s) => s.orgId === 'org-A')).toBe(true);
  });
});

describe('loadContextToolSpec (§5.4.4 build row)', () => {
  it('declares the context-loading tool bound to the actor userId', async () => {
    const seen: Array<{ userId: string; name: string; agentKind: string }> = [];
    setLoadContextContent(async (input) => {
      seen.push(input);
      return input.name === 'legal-spine' ? 'conteúdo legal' : null;
    });
    const spec = loadContextToolSpec(actor, 'coding');
    expect(spec.name).toBe(CONTEXT_LOADING_TOOL);
    expect(await spec.handler({ name: 'legal-spine' })).toBe('conteúdo legal');
    expect(await spec.handler({ name: 'ghost' })).toBe('Conteúdo não encontrado.');
    expect(seen.every((s) => s.userId === 'u1' && s.agentKind === 'coding')).toBe(true);
  });
});
