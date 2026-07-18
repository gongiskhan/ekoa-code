/**
 * SV-FERIAS - golden gate for the vacation engine (Código do Trabalho português).
 * Deterministic, no retrieval, explicit dates (the engine has no internal clock:
 * `ano` and `feriados` are arguments). Every expected figure is carried verbatim
 * and was computed from the canonical engine itself, then frozen here.
 *
 * Legal basis under test:
 *  - art. 239.º n.º 1: admission year, 2 working days per COMPLETE month, cap 20.
 *  - art. 238.º n.º 1: following years, 22 working days.
 *
 * The engine is the versioned content tree at api/assets/legal-engines, loaded
 * here exactly as the platform service + the served-app scaffold load it. A
 * separate assertion pins the served-app scaffold copy byte-identical to the
 * canonical, so this gate covers what actually ships.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Direito = { dias: number; regra: string; ano: number; dataAdmissao: string; passos: string[] };
type Saldo = { gozados: number; saldo: number; direito: number; ano: number; passos: string[] };

let F: {
  direitoFerias: (input: unknown) => Direito;
  saldoFerias: (input: unknown) => Saldo;
  diasUteisEntre: (inicio: string, fim: string, feriados?: string[]) => number;
  expandirFeriadosFixos: (ano: number) => string[];
  FERIADOS_NACIONAIS_FIXOS: string[];
  parseData: (s: string) => Date;
  iso: (d: Date) => string;
};

const asset = (name: string) => new URL(`../../assets/legal-engines/${name}`, import.meta.url);
const scaffold = new URL(
  '../../assets/featured-artifacts/legal-recursos/scaffold/frontend/src/engine/ferias.mjs',
  import.meta.url,
);

beforeAll(async () => {
  F = (await import(asset('ferias.mjs').href)) as typeof F;
});

describe('served-app scaffold copy is byte-identical to the canonical engine', () => {
  it('legal-recursos/.../engine/ferias.mjs === assets/legal-engines/ferias.mjs', () => {
    const canonical = readFileSync(fileURLToPath(asset('ferias.mjs')), 'utf-8');
    const shipped = readFileSync(fileURLToPath(scaffold), 'utf-8');
    expect(shipped).toBe(canonical);
  });
});

describe('direitoFerias - ano da admissão (art. 239.º n.º 1)', () => {
  it('admissão a meio do mês: só contam os meses completos seguintes (9 x 2 = 18)', () => {
    const r = F.direitoFerias({ dataAdmissao: '2026-03-15', ano: 2026 });
    expect(r.dias).toBe(18);
    expect(r.regra).toBe('art. 239.º n.º 1');
    expect(r.passos.join('\n')).toContain('9 x 2 = 18');
    expect(r.passos.join('\n')).toContain('após 6 meses');
  });

  it('admissão a 1 de Janeiro: 12 meses completos = 24, mas o limite legal do ano é 20', () => {
    const r = F.direitoFerias({ dataAdmissao: '2026-01-01', ano: 2026 });
    expect(r.dias).toBe(20);
    expect(r.regra).toBe('art. 239.º n.º 1');
    expect(r.passos.join('\n')).toMatch(/Limite legal de 20 dias/);
  });

  it('admissão tardia (Outubro): só Novembro e Dezembro contam = 4', () => {
    const r = F.direitoFerias({ dataAdmissao: '2026-10-15', ano: 2026 });
    expect(r.dias).toBe(4);
    expect(r.regra).toBe('art. 239.º n.º 1');
  });
});

describe('direitoFerias - anos seguintes (art. 238.º n.º 1) e anos anteriores', () => {
  it('ano posterior ao da admissão: direito anual completo de 22 dias úteis', () => {
    const r = F.direitoFerias({ dataAdmissao: '2020-03-15', ano: 2026 });
    expect(r.dias).toBe(22);
    expect(r.regra).toBe('art. 238.º n.º 1');
  });

  it('ano anterior à admissão: sem direito (0), o contrato ainda não vigorava', () => {
    const r = F.direitoFerias({ dataAdmissao: '2027-01-10', ano: 2026 });
    expect(r.dias).toBe(0);
    expect(r.regra).toBe('sem direito (anterior à admissão)');
  });
});

describe('diasUteisEntre - contagem de dias úteis com exclusão de feriados', () => {
  it('semana útil completa (2.ª a 6.ª) = 5', () => {
    expect(F.diasUteisEntre('2026-07-06', '2026-07-10')).toBe(5);
  });

  it('duas semanas (salta o fim-de-semana) = 10', () => {
    expect(F.diasUteisEntre('2026-07-06', '2026-07-17')).toBe(10);
  });

  it('um feriado dado dentro do intervalo é excluído (5 -> 4)', () => {
    expect(F.diasUteisEntre('2026-06-08', '2026-06-12')).toBe(5);
    expect(F.diasUteisEntre('2026-06-08', '2026-06-12', ['2026-06-10'])).toBe(4);
  });

  it('intervalo invertido conta 0', () => {
    expect(F.diasUteisEntre('2026-07-10', '2026-07-06')).toBe(0);
  });
});

describe('saldoFerias - desconto de férias aprovadas, aparadas ao ano', () => {
  it('direito 22, uma semana aprovada (5 úteis) -> gozados 5, saldo 17', () => {
    const r = F.saldoFerias({
      direito: 22,
      ano: 2026,
      ausenciasAprovadas: [{ tipo: 'ferias', estado: 'aprovada', dataInicio: '2026-07-06', dataFim: '2026-07-10' }],
    });
    expect(r.gozados).toBe(5);
    expect(r.saldo).toBe(17);
    expect(r.passos.join('\n')).toContain('22 - 5 = 17');
  });

  it('ignora ausências pedidas e baixas: só férias aprovadas descontam', () => {
    const r = F.saldoFerias({
      direito: 22,
      ano: 2026,
      ausenciasAprovadas: [
        { tipo: 'ferias', estado: 'pedida', dataInicio: '2026-07-06', dataFim: '2026-07-10' },
        { tipo: 'baixa', estado: 'aprovada', dataInicio: '2026-07-06', dataFim: '2026-07-10' },
      ],
    });
    expect(r.gozados).toBe(0);
    expect(r.saldo).toBe(22);
  });
});

describe('feriados nacionais fixos + rejeição LOUD de input inválido', () => {
  it('exporta os 10 feriados nacionais de data fixa, começando em Ano Novo', () => {
    expect(F.FERIADOS_NACIONAIS_FIXOS).toHaveLength(10);
    expect(F.expandirFeriadosFixos(2026)[0]).toBe('2026-01-01');
    expect(F.expandirFeriadosFixos(2026)).toContain('2026-12-25');
  });

  it('data de calendário impossível é recusada (round-trip)', () => {
    expect(() => F.parseData('2026-02-31')).toThrow(/impossível/i);
  });

  it('ano fora do intervalo razoável é recusado', () => {
    expect(() => F.direitoFerias({ dataAdmissao: '2026-01-01', ano: 1500 })).toThrow(/intervalo razoável/i);
  });

  it('direito negativo em saldoFerias é recusado', () => {
    expect(() => F.saldoFerias({ direito: -1, ano: 2026, ausenciasAprovadas: [] })).toThrow(/direito inválido/i);
  });
});
