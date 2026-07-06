/**
 * Work-law calculators — correctness gate. Asserts the exact Código do Trabalho
 * figures each simulator encodes. Ported from cortex/tests/legal/simuladores.test.ts
 * (ch13 legal-engine golden-figure suite); only the import path is adapted — the
 * expected figures are carried verbatim.
 */
import { describe, it, expect } from 'vitest';
import {
  FERIAS_DIAS_ANO_COMPLETO,
  feriasAnoAdmissao,
  simularFerias,
  faltasFalecimento,
  compensacaoCessacao,
  subsidiosProporcionais,
  avisoPrevioDenuncia,
  trabalhoSuplementar,
  SIMULADORES,
} from '../../src/legal/simuladores.js';

describe('férias (art. 238-239)', () => {
  it('regra geral = 22 dias úteis', () => {
    expect(FERIAS_DIAS_ANO_COMPLETO).toBe(22);
  });
  it('ano de admissão: 2 dias úteis por mês, até 20', () => {
    expect(feriasAnoAdmissao(0)).toBe(0);
    expect(feriasAnoAdmissao(5)).toBe(10);
    expect(feriasAnoAdmissao(10)).toBe(20); // capped at 20
    expect(feriasAnoAdmissao(12)).toBe(20);
  });
  it('simularFerias from a start date', () => {
    const r = simularFerias('2026-10-01'); // October -> 3 months that year
    expect(r.diasAnoAdmissao).toBe(6);
    expect(r.diasAnoSeguinte).toBe(22);
    expect(r.legalRef).toContain('238');
  });
});

describe('faltas por falecimento (art. 251)', () => {
  it('encodes the kinship-degree day counts', () => {
    expect(faltasFalecimento('descendente').dias).toBe(20);
    expect(faltasFalecimento('conjuge').dias).toBe(5);
    expect(faltasFalecimento('ascendente_afim_1grau').dias).toBe(5);
    expect(faltasFalecimento('parente_2grau').dias).toBe(2);
    expect(faltasFalecimento('descendente').legalRef).toContain('251');
  });
});

describe('compensação por cessação (art. 366)', () => {
  it('12 dias de retribuição por ano (base mensal / 30 × 12 × anos)', () => {
    const r = compensacaoCessacao({ retribuicaoBaseMensal: 1000, antiguidadeAnos: 5 });
    expect(r.compensacao).toBe(2000); // (1000/30)*12*5
    expect(r.diasPorAno).toBe(12);
  });
  it('adds diuturnidades to the monthly reference', () => {
    const r = compensacaoCessacao({ retribuicaoBaseMensal: 1000, diuturnidades: 100, antiguidadeAnos: 1 });
    expect(r.compensacao).toBe(440); // (1100/30)*12
  });
  it('caps the monthly reference at 20 × RMMG', () => {
    const r = compensacaoCessacao({ retribuicaoBaseMensal: 100000, antiguidadeAnos: 1, rmmg: 870 });
    expect(r.baseMensalConsiderada).toBe(17400); // 20 * 870
    expect(r.compensacao).toBe(6960); // (17400/30)*12
  });
});

describe('subsídios proporcionais (art. 263-264)', () => {
  it('half a year worked -> half a month each', () => {
    const r = subsidiosProporcionais({ retribuicaoMensal: 1000, mesesTrabalhadosNoAno: 6 });
    expect(r.subsidioFerias).toBe(500);
    expect(r.subsidioNatal).toBe(500);
    expect(r.proporcao).toBe(0.5);
  });
  it('a full year -> a full month each', () => {
    const r = subsidiosProporcionais({ retribuicaoMensal: 1000, mesesTrabalhadosNoAno: 12 });
    expect(r.subsidioNatal).toBe(1000);
  });
});

describe('aviso prévio de denúncia (art. 400)', () => {
  it('30 dias < 2 anos, 60 dias >= 2 anos', () => {
    expect(avisoPrevioDenuncia(1).dias).toBe(30);
    expect(avisoPrevioDenuncia(2).dias).toBe(60);
    expect(avisoPrevioDenuncia(5).dias).toBe(60);
  });
});

describe('trabalho suplementar (art. 268)', () => {
  it('dia útil: +25% 1ª hora, +37,5% seguintes', () => {
    const r = trabalhoSuplementar({ retribuicaoHoraria: 10, horasPrimeiraDiaUtil: 1, horasSeguintesDiaUtil: 2 });
    expect(r.total).toBe(40); // 10*1.25 + 2*10*1.375
  });
  it('dia de descanso/feriado: +50%', () => {
    const r = trabalhoSuplementar({ retribuicaoHoraria: 10, horasDescansoOuFeriado: 8 });
    expect(r.total).toBe(120); // 8*10*1.5
  });
});

describe('robustness — malformed inputs return sane values, not NaN/negative', () => {
  it('feriasAnoAdmissao: NaN/negative -> 0', () => {
    expect(feriasAnoAdmissao(Number.NaN)).toBe(0);
    expect(feriasAnoAdmissao(-5)).toBe(0);
  });
  it('simularFerias is timezone-stable for an ISO date string', () => {
    expect(simularFerias('2026-03-15').diasAnoAdmissao).toBe(20);
    expect(simularFerias('not-a-date').diasAnoAdmissao).toBe(0);
  });
  it('compensacaoCessacao: NaN base -> 0; non-positive rmmg falls back to the default', () => {
    expect(compensacaoCessacao({ retribuicaoBaseMensal: Number.NaN, antiguidadeAnos: 3 }).compensacao).toBe(0);
    const r = compensacaoCessacao({ retribuicaoBaseMensal: 100000, antiguidadeAnos: 1, rmmg: -1 });
    expect(r.baseMensalConsiderada).toBe(17400); // default RMMG 870, not a 0 cap
  });
  it('subsidiosProporcionais: NaN months -> 0; subsidio === mensal × exact proporcao', () => {
    expect(subsidiosProporcionais({ retribuicaoMensal: 1000, mesesTrabalhadosNoAno: Number.NaN }).subsidioFerias).toBe(0);
    const r = subsidiosProporcionais({ retribuicaoMensal: 1000, mesesTrabalhadosNoAno: 1 });
    expect(Math.round(1000 * r.proporcao * 100) / 100).toBe(r.subsidioFerias); // internally consistent
  });
  it('trabalhoSuplementar: negative hours -> 0', () => {
    expect(trabalhoSuplementar({ retribuicaoHoraria: 10, horasPrimeiraDiaUtil: -3 }).total).toBe(0);
  });
});

describe('catalogue', () => {
  it('lists the six simulators with legal refs', () => {
    expect(SIMULADORES).toHaveLength(6);
    expect(SIMULADORES.map((s) => s.id)).toContain('ferias');
    expect(SIMULADORES.every((s) => s.legalRef.includes('art.'))).toBe(true);
  });
});
