import { describe, it, expect } from 'vitest';
import {
  detectDomainHeavy,
  knowledgeScopingNarration,
  knowledgeIndexedNarration,
  knowledgeNotIndexedNarration,
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

  it('fires on health apps in PT and EN (codex F1 finding 3 repros)', () => {
    expect(detectDomainHeavy('Aplicação médica para médicos e hospitais').domains).toContain('saude');
    expect(detectDomainHeavy('Medical scheduling app for doctors and hospitals').domains).toContain('saude');
    expect(detectDomainHeavy('Marcação de consultas de enfermagem').domains).toContain('saude');
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
      'crm for a consultant team', // must NOT fire saude via "consultas" prefix
      'doctorate thesis tracker', // must NOT fire saude via "doctors"
      // review-f1 finding 1 repros (empirically confirmed false positives, fixed in the follow-up)
      'multi-tenant admin dashboard', // must NOT fire imobiliario via "tenant"
      'tennis court booking app', // must NOT fire juridico via token "court"
      'a courtesy reminder app', // must NOT fire juridico via "court" prefix
      'página de login seguro para a equipa', // must NOT fire seguros via adjective "seguro"
      'pagamento seguro na loja online', // same - "seguro" as adjective
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

  it('keeps recall after the precision follow-up (tightened terms still fire on real domain apps)', () => {
    expect(detectDomainHeavy('court case management for the firm').domains).toContain('juridico');
    expect(detectDomainHeavy('gestão de obrigações fiscais da empresa').domains).toContain('financeiro'); // 'fiscais' plural (review-f1 Low)
    expect(detectDomainHeavy('portal for landlords to manage tenants and leases').domains).toContain('imobiliario');
    expect(detectDomainHeavy('gestão de seguros e apólices').domains).toContain('seguros');
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

  it('reads grammatically for the seguros domain ("área de seguros", review-f1 Low)', () => {
    expect(knowledgeScopingNarration(['seguros'])).toContain('área de seguros');
    expect(knowledgeScopingNarration(['seguros'])).not.toContain('área seguros');
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

  it('appends an honest shortfall on a partial ingest and keeps the base sentence intact', () => {
    const partial = knowledgeIndexedNarration(2, 3);
    expect(partial).toContain('Foram indexados 2 documentos'); // base unchanged (F2 gate asserts on it)
    expect(partial).toContain('Não foi possível indexar 1 documento.');
    expect(knowledgeIndexedNarration(1, 4)).toContain('Não foi possível indexar 3 documentos.');
    // full success with attempted supplied: NO shortfall sentence
    expect(knowledgeIndexedNarration(2, 2)).not.toContain('Não foi possível');
    expect(partial).not.toMatch(EMOJI_RE);
    expect(partial).not.toMatch(EM_DASH_RE);
  });
});

describe('knowledgeNotIndexedNarration (all-failed ingest, review-f1 Low)', () => {
  it('narrates the all-failed case honestly, in number, within the copy rules', () => {
    const one = knowledgeNotIndexedNarration(1);
    expect(one).toContain('Não foi possível indexar o documento fornecido');
    expect(one).toContain('prossegue sem ele');

    const many = knowledgeNotIndexedNarration(3);
    expect(many).toContain('Não foi possível indexar os 3 documentos fornecidos');
    expect(many).toContain('prossegue sem eles');

    for (const msg of [one, many]) {
      expect(msg).not.toMatch(EMOJI_RE);
      expect(msg).not.toMatch(EM_DASH_RE);
      expect(msg.toLowerCase()).not.toContain('ekoa');
    }
  });
});
