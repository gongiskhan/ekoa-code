import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexDoc, closeIndex } from '../../src/knowledge/index-store.js';
import { buildGroundingBlock, isLegalContext } from '../../src/knowledge/grounding.js';
import { SHARED_ORG_ID } from '../../src/knowledge/paths.js';

/**
 * Grounding block tests (ch08 §8.4 slot 5, ch05 §5.5.2): cited-or-silent, the deterministic
 * legal-context build gate, and org partitioning of the slot-5 consumer.
 */
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-ground-'));
  process.env.EKOA_DATA_DIR = dir;
});
afterEach(async () => {
  closeIndex();
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

function seed(orgId: string) {
  indexDoc({ orgId, collection: 'legal-spine', docId: 'd1', title: 'Prazos de recurso', body: 'o prazo de recurso é de 30 dias', createdAt: '2026-01-01T00:00:00.000Z' });
}

describe('legal-context detector (deterministic, no model call)', () => {
  it('matches PT and EN legal keywords, ignores non-legal prose', () => {
    expect(isLegalContext('qual é o prazo de recurso no processo?')).toBe(true);
    expect(isLegalContext('what is the court deadline for this lawsuit')).toBe(true);
    expect(isLegalContext('faz uma app de gestão de receitas de cozinha')).toBe(false);
    // accent-insensitive: "acórdão" matches via folded "acordao"
    expect(isLegalContext('preciso do acórdão')).toBe(true);
  });
});

describe('cited-or-silent (both branches)', () => {
  it('chat: returns a cited block when the org partition has a relevant doc', () => {
    seed('orgA');
    const { block, hits } = buildGroundingBlock({ orgId: 'orgA', query: 'qual o prazo de recurso', kind: 'chat' });
    expect(hits).toHaveLength(1);
    expect(block).toContain('legal-spine / Prazos de recurso (doc d1)');
    expect(block).toMatch(/CONHECIMENTO/);
  });

  it('chat: stays silent (empty string) when nothing is relevant', () => {
    seed('orgA');
    const { block, hits } = buildGroundingBlock({ orgId: 'orgA', query: 'receitas de bolo de chocolate', kind: 'chat' });
    expect(block).toBe('');
    expect(hits).toHaveLength(0);
  });

  it('chat: stays silent when the org partition is empty (no hallucinated filler)', () => {
    const { block } = buildGroundingBlock({ orgId: 'orgEmpty', query: 'prazo de recurso', kind: 'chat' });
    expect(block).toBe('');
  });
});

describe('build gating (legal-context only)', () => {
  it('build: legal request with a relevant doc → cited block', () => {
    seed('orgA');
    const { block } = buildGroundingBlock({ orgId: 'orgA', query: 'app para gerir prazos de recurso no processo', kind: 'build' });
    expect(block).toContain('doc d1');
  });

  it('build: non-legal request → silent even when docs exist', () => {
    seed('orgA');
    const { block, hits } = buildGroundingBlock({ orgId: 'orgA', query: 'app de gestão de receitas', kind: 'build' });
    expect(block).toBe('');
    expect(hits).toHaveLength(0);
  });
});

describe('org partition', () => {
  it('the slot-5 builder for orgB never surfaces orgA knowledge', () => {
    seed('orgA');
    const { block } = buildGroundingBlock({ orgId: 'orgB', query: 'prazo de recurso', kind: 'chat' });
    expect(block).toBe('');
  });
});

describe('shared corpus grounding', () => {
  it('a normal org chat surfaces shared-corpus hits it does not own', () => {
    indexDoc({ orgId: SHARED_ORG_ID, collection: 'legal-spine', docId: 'shared-1', title: 'Prazo comum de recurso', body: 'o prazo comum de recurso é de 30 dias', createdAt: '2026-01-01T00:00:00.000Z' });
    const { block, hits } = buildGroundingBlock({ orgId: 'orgSemNada', query: 'qual o prazo de recurso', kind: 'chat' });
    expect(hits.map((h) => h.docId)).toContain('shared-1');
    expect(hits.find((h) => h.docId === 'shared-1')!.scope).toBe('shared');
    expect(block).toContain('legal-spine / Prazo comum de recurso (doc shared-1)');
  });
});
