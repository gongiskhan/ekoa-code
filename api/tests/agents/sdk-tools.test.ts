import { describe, it, expect, afterEach } from 'vitest';
import { knowledgeToolSpecs, loadContextToolSpec, delegateToolSpec } from '../../src/agents/sdk-tools.js';
import { KNOWLEDGE_TOOLS, CONTEXT_LOADING_TOOL, DELEGATION_TOOL } from '../../src/agents/tools.js';
import {
  setKnowledgeToolSearch,
  setKnowledgeToolRead,
  setLoadContextContent,
  setDelegateToLocal,
  __resetAgentSeamsForTests,
  type DelegationToolActor,
  type DelegationToolRequest,
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

describe('delegateToolSpec (§5.4.8 local-bridge delegation tool)', () => {
  const okResult = {
    status: 'ok' as const,
    answer: 'resumo derivado',
    citations: [{ path: 'contrato.txt', range: '0-209' }],
    ledgerRefs: ['default:0'],
    telemetry: { egressBytes: 209, maskedCounts: {} },
  };

  it('binds userId + sessionId from the run actor — injected identity arguments never win', async () => {
    const seen: Array<{ actor: DelegationToolActor; req: DelegationToolRequest }> = [];
    setDelegateToLocal(async (actor, req) => {
      seen.push({ actor, req });
      return okResult;
    });
    const spec = delegateToolSpec(actor, 'sess-1');
    expect(spec.name).toBe(DELEGATION_TOOL);
    const text = await spec.handler({
      task: '{"v":1,"steps":[]}',
      grantRefs: ['g-1'],
      userId: 'attacker', // injected args must not re-address the delegation
      sessionId: 'other-session',
    });
    expect(seen[0]!.actor).toEqual({ userId: 'u1', sessionId: 'sess-1' });
    expect(seen[0]!.req.grantRefs).toEqual(['g-1']);
    expect(seen[0]!.req.budget).toEqual({ egressBytes: 262_144, modelSpend: { userId: 'u1' } });
    expect(text).toContain('resumo derivado');
    expect(text).toContain('contrato.txt (0-209)');
  });

  it('honest offline default: with no root wiring the result is unreachable — never an upload', async () => {
    const spec = delegateToolSpec(actor, 'sess-1');
    const text = await spec.handler({ task: '{"v":1,"steps":[]}', grantRefs: ['g-1'] });
    expect(text).toContain('unreachable');
  });

  it('denied and cap_reached surface as honest statuses, and an explicit egressBytes rides the budget', async () => {
    const budgets: number[] = [];
    setDelegateToLocal(async (_actor, req) => {
      budgets.push(req.budget.egressBytes);
      return { status: 'cap_reached' as const, citations: [], ledgerRefs: [], telemetry: { egressBytes: 10, maskedCounts: {} } };
    });
    const spec = delegateToolSpec(actor, 'sess-1');
    expect(await spec.handler({ task: '{"v":1}', grantRefs: ['g-1'], egressBytes: 1024 })).toContain('cap_reached');
    expect(budgets).toEqual([1024]);
    setDelegateToLocal(async () => ({ status: 'denied' as const, citations: [], ledgerRefs: [], telemetry: { egressBytes: 0, maskedCounts: {} } }));
    expect(await spec.handler({ task: '{"v":1}', grantRefs: ['g-1'] })).toContain('denied');
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
