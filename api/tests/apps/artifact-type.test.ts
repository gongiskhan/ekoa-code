import { describe, it, expect } from 'vitest';
import { classifyArtifactType, baseForType, typeForBase } from '../../src/apps/artifact-type.js';
import { BASE_IDS } from '../../src/apps/base-loader.js';
import { ArtifactType } from '@ekoa/shared';

/** operator-run C1 — deterministic signals, one-shot fallback discipline, mappings. */

describe('classifyArtifactType (C1)', () => {
  it('strong PT/EN signals classify deterministically (no model call)', async () => {
    const boom = async () => { throw new Error('one-shot must not be called for signal hits'); };
    const cases: Array<[string, ArtifactType]> = [
      ['Uma apresentação sobre o novo regime fiscal', 'presentation'],
      ['Landing page para o escritório', 'landing'],
      ['A static page', 'landing'], // deterministic: never falls through to the model in credential-less envs
      ['Uma página estática de apresentação do escritório', 'landing'],
      ['Relatório mensal de honorários', 'report'],
      ['Um contrato de prestação de serviços', 'document'],
      ['Minuta de procuração forense', 'document'],
      ['Gestor de processos com prazos', 'app'],
      ['A budget tracker with charts', 'app'],
    ];
    for (const [desc, want] of cases) {
      expect(await classifyArtifactType(desc, 'u1', { oneShot: boom }), desc).toBe(want);
    }
  });

  it('the earliest signal wins: head nouns beat later co-occurring words (codex C1)', async () => {
    const boom = async () => { throw new Error('no one-shot for signal hits'); };
    expect(await classifyArtifactType('Uma app para gerar contratos de arrendamento', 'u1', { oneShot: boom })).toBe('app');
    expect(await classifyArtifactType('Gestor de contratos com prazos', 'u1', { oneShot: boom })).toBe('app');
    expect(await classifyArtifactType('Contrato de arrendamento para o gestor', 'u1', { oneShot: boom })).toBe('document');
  });

  // 2C-S6: reviewing an EXISTING Word file is a document build (the base's source-linked
  // mode edits the real .docx with native tracked changes). Every phrase is ANCHORED to a
  // document/Word noun in the same clause — see the misroute guard below, which is the
  // whole reason the regex is shaped the way it is.
  it("Word's review vocabulary routes to document when it names the document", async () => {
    const boom = async () => { throw new Error('one-shot must not be called for signal hits'); };
    const cases = [
      'Revê o ficheiro em anexo com registo de alterações',
      'reve o anexo com registo de alteracoes', // unaccented PT is just as common
      'Aceita as alterações registadas no ficheiro que enviei',
      'Preciso de controlar alterações neste ficheiro',
      'Marcas de revisão no anexo, por favor',
      'Preciso de um redline do ficheiro em anexo',
      'Aplica track changes no ficheiro que enviei',
      'apply tracked changes to the contract',
    ];
    for (const desc of cases) {
      expect(await classifyArtifactType(desc, 'u1', { oneShot: boom }), desc).toBe('document');
    }
  });

  it('MISROUTE GUARD: an unanchored review phrase is ordinary app vocabulary, never a document', async () => {
    // NONE of these phrases is Word-only. "registo de alterações" is plain Portuguese for a
    // CHANGE LOG, and "track changes" is version-control jargon — so unbound from a
    // document noun they must NOT hit the document signal. Where an app head noun is
    // present it wins outright; where the request is genuinely ambiguous the honest outcome
    // is "no deterministic hit", i.e. the classifier one-shot IS consulted (proved by the
    // counter, which a silent document match would leave at 0 — and whose prompt already
    // answers `app` when in doubt).
    const ambiguous = [
      'Portal para registar alterações de morada dos clientes',
      'Preciso de controlo de alterações nos tickets de suporte',
      'track changes no codigo',
      'Preciso de track changes no código',
      'add track changes in the repo',
    ];
    for (const desc of ambiguous) {
      let consulted = 0;
      const oneShot = async () => { consulted += 1; return 'app'; };
      expect(await classifyArtifactType(desc, 'u1', { oneShot }), desc).toBe('app');
      expect(consulted, `${desc} must fall through, not match the document signal`).toBe(1);
    }
    // App head nouns keep winning deterministically (earliest match), never the review phrase.
    const boom = async () => { throw new Error('no one-shot for signal hits'); };
    const apps = [
      'App para gerir o registo de alterações dos processos',
      'Preciso de registo de alterações no meu CRM',
      'Quero registo de alterações por utilizador no kanban',
      'Ferramenta para registar alterações no inventário e avisar o gestor',
    ];
    for (const desc of apps) {
      expect(await classifyArtifactType(desc, 'u1', { oneShot: boom }), desc).toBe('app');
    }
  });

  it('an empty or blank description is the platform default app, no one-shot (codex C1)', async () => {
    const boom = async () => { throw new Error('must not be called'); };
    expect(await classifyArtifactType('', 'u1', { oneShot: boom })).toBe('app');
    expect(await classifyArtifactType('   \n', 'u1', { oneShot: boom })).toBe('app');
  });

  it('ambiguous requests consult the one-shot and parse a single-word verdict', async () => {
    expect(await classifyArtifactType('Algo para o escritório', 'u1', { oneShot: async () => 'presentation' })).toBe('presentation');
    expect(await classifyArtifactType('Algo para o escritório', 'u1', { oneShot: async () => '  Document.\n' })).toBe('document');
  });

  it('one-shot failure or garbage defaults to app (never throws)', async () => {
    expect(await classifyArtifactType('Algo indefinido', 'u1', { oneShot: async () => { throw new Error('no credential'); } })).toBe('app');
    expect(await classifyArtifactType('Algo indefinido', 'u1', { oneShot: async () => 'uma aplicação talvez?' })).toBe('app');
  });

  it('type<->base mappings are total and land on real bases', () => {
    for (const t of ArtifactType.options) {
      expect(BASE_IDS).toContain(baseForType(t));
    }
    for (const b of BASE_IDS) {
      expect(ArtifactType.options).toContain(typeForBase(b));
    }
    expect(baseForType('report')).toBe('document'); // reports share the print shell
  });
});
