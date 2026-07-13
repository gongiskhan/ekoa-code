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
