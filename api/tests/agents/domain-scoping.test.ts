import { describe, it, expect } from 'vitest';
import {
  detectDomainHeavy,
  knowledgeScopingNarration,
  knowledgeIndexedNarration,
} from '../../src/agents/domain-scoping.js';

/**
 * F1 knowledge-during-build: the deterministic domain-heavy detector + its operator-facing
 * narration. No model call, no egress - a pure lexical classifier. The detector decides whether a
 * first build NARRATES a knowledge request; the copy builders produce the PT-PT formal, brand-
 * neutral, emoji-free / em-dash-free narration streamed on the build's plan_step channel.
 */

// Emoji + pictographic ranges (enough to catch an accidental UI emoji per the global rule).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const EM_DASH_RE = /[\u2014\u2013]/; // em dash / en dash - the copy must use a plain hyphen only

describe('detectDomainHeavy (deterministic, PT + EN)', () => {
  it('fires on domain-heavy PT requests and names the matched domain(s)', () => {
    const legal = detectDomainHeavy('Aplicação para gerir peças de um processo judicial e prazos de recurso');
    expect(legal.domainHeavy).toBe(true);
    expect(legal.domains).toContain('juridico');

    const fees = detectDomainHeavy('Uma aplicação para calcular as taxas e custas de um processo');
    expect(fees.domainHeavy).toBe(true);
    // "taxas"/"custas" are financial; "processo" alone is NOT legal (only "processo judicial" is)
    expect(fees.domains).toContain('financeiro');

    const health = detectDomainHeavy('Prontuário clínico para o registo de pacientes e diagnósticos');
    expect(health.domainHeavy).toBe(true);
    expect(health.domains).toContain('saude');

    const insurance = detectDomainHeavy('Gestão de apólices de seguro e participação de sinistros');
    expect(insurance.domainHeavy).toBe(true);
    expect(insurance.domains).toContain('seguros');
  });

  it('fires on domain-heavy EN requests', () => {
    expect(detectDomainHeavy('An app to calculate court fees for a lawsuit').domainHeavy).toBe(true);
    expect(detectDomainHeavy('An app to calculate court fees for a lawsuit').domains).toEqual(
      expect.arrayContaining(['juridico', 'financeiro']),
    );
    expect(detectDomainHeavy('A tool to manage insurance claims and underwriting').domains).toContain('seguros');
    expect(detectDomainHeavy('Invoicing and VAT accounting workspace').domains).toContain('financeiro');
    expect(detectDomainHeavy('A GDPR compliance register for the organisation').domains).toContain('conformidade');
  });

  it('stays silent on generic apps (PT + EN), avoiding substring false positives', () => {
    for (const generic of [
      'build a crm',
      'build a dashboard for sales',
      'cria uma lista de tarefas',
      'loja online de t-shirts',
      'build a syntax highlighter', // must NOT fire on "syntax" (contains "tax")
      'a taxonomy browser for animals', // must NOT fire on "taxonomy"
      'personal budget tracker', // "budget" is deliberately not a keyword
      'um blog pessoal com comentários',
    ]) {
      const r = detectDomainHeavy(generic);
      expect(r.domainHeavy, `"${generic}" must not be domain-heavy`).toBe(false);
      expect(r.domains).toEqual([]);
    }
  });

  it('is accent-insensitive and tolerant of empty input', () => {
    expect(detectDomainHeavy('APOLICE de SEGURO').domainHeavy).toBe(true);
    expect(detectDomainHeavy('').domainHeavy).toBe(false);
  });
});

describe('knowledgeScopingNarration (PT-PT, formal, brand-neutral)', () => {
  it('names the area, points at the org knowledge area, and stays within the copy rules', () => {
    const msg = knowledgeScopingNarration(['financeiro']);
    expect(msg).toContain('financeira');
    expect(msg).toContain('área de conhecimento da organização');
    expect(msg).toContain('Pode carregar'); // formal register (voce), not tuteio
    expect(msg).not.toContain('podes'); // no tuteio
    expect(msg).not.toMatch(EMOJI_RE);
    expect(msg).not.toMatch(EM_DASH_RE);
    expect(msg.toLowerCase()).not.toContain('ekoa'); // brand-neutral
  });

  it('lists multiple domains with a PT conjunction', () => {
    const msg = knowledgeScopingNarration(['juridico', 'financeiro']);
    expect(msg).toContain('jurídica e financeira');
    expect(msg).not.toMatch(EMOJI_RE);
    expect(msg).not.toMatch(EM_DASH_RE);
  });
});

describe('knowledgeIndexedNarration (PT-PT confirmation)', () => {
  it('agrees in number for one vs many documents and stays within the copy rules', () => {
    const one = knowledgeIndexedNarration(1);
    expect(one).toContain('Foi indexado 1 documento');
    expect(one).toContain('já está disponível');

    const many = knowledgeIndexedNarration(3);
    expect(many).toContain('Foram indexados 3 documentos');
    expect(many).toContain('já estão disponíveis');

    for (const msg of [one, many]) {
      expect(msg).toContain('área de conhecimento da organização');
      expect(msg).not.toMatch(EMOJI_RE);
      expect(msg).not.toMatch(EM_DASH_RE);
      expect(msg.toLowerCase()).not.toContain('ekoa');
    }
  });
});
