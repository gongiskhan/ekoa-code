/**
 * SV-CALC — golden gate for the source-cited calculation engines (juros de mora
 * per troço + taxa de justiça RCP). Integer-cent arithmetic; every value cites its
 * base legal. Ported from cortex/tests/legal/calculos.test.ts (ch13 legal-engine
 * golden-figure suite). The engines + rate table are the versioned content tree,
 * now in-repo at api/assets/legal-engines (loaded here exactly as the platform
 * service + the served-app scaffold load them). Every expected cent-exact figure is
 * carried verbatim (26178, 29918, 20000, 51000, …).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Troco = { inicio: string; fim: string; dias: number; taxa: number | null; aviso: string; juros: number; jurosCentavos: number; semestre: string; nota?: string };
type Juros = {
  moeda: string; tipo: string; capital: number; dataVencimento: string; dataFim: string;
  diasTotais: number; trocos: Troco[]; totalJuros: number; totalJurosCentavos: number;
  total: number; incompleto: boolean; showWork: { passos: string[] };
};
type Custas = {
  moeda: string; valorAcao: number; tabela: string; ano: number; uc: number; ucBase: string;
  ucNota: string | null; escalao: { de: number; ate: number | null; label: string; ucBase: number; acrescimoUc: number; nota: string };
  ucCount: number; valor: number; valorCentavos: number; citacao: string; nota: string; showWork: { passos: string[] };
};

let J: { computeJuros: (input: unknown) => Juros };
let C: { computeCustas: (input: unknown) => Custas };
let TABELA: { uc: unknown[] };

const asset = (name: string) => new URL(`../../assets/legal-engines/${name}`, import.meta.url);

beforeAll(async () => {
  J = (await import(asset('juros.mjs').href)) as { computeJuros: (input: unknown) => Juros };
  C = (await import(asset('custas.mjs').href)) as { computeCustas: (input: unknown) => Custas };
  TABELA = JSON.parse(readFileSync(fileURLToPath(asset('tabelas-taxas.json')), 'utf-8'));
});

describe('computeJuros - juros comerciais por troços, um Aviso por semestre', () => {
  it('(a) €10.000 de 2023-04-01 a 2023-09-30 cruza 2023-S1 (10,5%) e 2023-S2 (12,0%)', () => {
    const r = J.computeJuros({ valor: 10000, dataVencimento: '2023-04-01', dataFim: '2023-09-30', tipo: 'comercial', tabela: TABELA });
    expect(r.trocos).toHaveLength(2);
    expect(r.incompleto).toBe(false);
    expect(r.diasTotais).toBe(182);

    const [t1, t2] = r.trocos;
    // Troço 1: 2023-S1, 91 dias @ 10,5% -> round(1_000_000c × 10.5 × 91 / 36500) = 26178c.
    expect(t1).toMatchObject({ inicio: '2023-04-01', fim: '2023-07-01', dias: 91, taxa: 10.5, aviso: 'Aviso n.º 1261/2023, DGTF', jurosCentavos: 26178, juros: 261.78 });
    // Troço 2: 2023-S2, 91 dias @ 12,0% -> round(1_000_000c × 12 × 91 / 36500) = 29918c.
    expect(t2).toMatchObject({ inicio: '2023-07-01', fim: '2023-09-30', dias: 91, taxa: 12, aviso: 'Aviso n.º 20214/2023, DGTF', jurosCentavos: 29918, juros: 299.18 });

    expect(r.totalJurosCentavos).toBe(26178 + 29918);
    expect(r.totalJuros).toBe(560.96);
    expect(r.total).toBe(560.96);
    const memoria = r.showWork.passos.join('\n');
    expect(memoria).toContain('Aviso n.º 1261/2023, DGTF');
    expect(memoria).toContain('Aviso n.º 20214/2023, DGTF');
    expect(memoria).toMatch(/Código Comercial/);
  });

  it('capitalCentavos e valor são equivalentes (mesmos cêntimos)', () => {
    const porEuros = J.computeJuros({ valor: 10000, dataVencimento: '2023-04-01', dataFim: '2023-09-30', tipo: 'comercial', tabela: TABELA });
    const porCentavos = J.computeJuros({ capitalCentavos: 1_000_000, dataVencimento: '2023-04-01', dataFim: '2023-09-30', tipo: 'comercial', tabela: TABELA });
    expect(porCentavos.totalJurosCentavos).toBe(porEuros.totalJurosCentavos);
  });
});

describe('computeJuros - juros civis 4% num único troço', () => {
  it('(b) €5.000 durante 2024 (ano bissexto, 365 dias em contagem meio-aberta) -> €200,00 a 4%', () => {
    const r = J.computeJuros({ valor: 5000, dataVencimento: '2024-01-01', dataFim: '2024-12-31', tipo: 'civil', tabela: TABELA });
    expect(r.trocos).toHaveLength(1);
    expect(r.tipo).toBe('civil');
    const [t] = r.trocos;
    expect(t!.taxa).toBe(4);
    expect(t!.dias).toBe(365);
    // round(500_000c × 4 × 365 / 36500) = 20000c.
    expect(t!.jurosCentavos).toBe(20000);
    expect(r.totalJuros).toBe(200);
    expect(t!.aviso).toMatch(/291\/2003/);
    expect(r.showWork.passos.join('\n')).toMatch(/559\.º do Código Civil/);
  });
});

describe('computeCustas - taxa de justiça RCP, UC versionada', () => {
  it('(c) acção de €30.000, Tabela I-A, UC 2026 = 102,00 -> 5 UC = €510,00', () => {
    const r = C.computeCustas({ valorAcao: 30000, tabela: 'I-A', uc: TABELA.uc, ano: 2026 });
    expect(r.ucCount).toBe(5);
    expect(r.uc).toBe(102);
    expect(r.ano).toBe(2026);
    expect(r.valorCentavos).toBe(51000);
    expect(r.valor).toBe(510);
    expect(r.tabela).toBe('I-A');
    expect(r.escalao).toMatchObject({ de: 24000, ate: 30000, nota: 'confirmar' });
    expect(r.citacao).toMatch(/art\. 6\.º.*Tabela I.*34\/2008/i);
    expect(r.nota).toBe('confirmar');
  });

  it('escalão aberto (+€275.000) acresce 3 UC por cada €25.000 ou fracção', () => {
    // €300.000 = €275.000 + €25.000 -> base 24 UC + 3 UC = 27 UC.
    const r = C.computeCustas({ valorAcao: 300000, tabela: 'I-A', uc: TABELA.uc, ano: 2026 });
    expect(r.escalao.ate).toBeNull();
    expect(r.escalao.acrescimoUc).toBe(3);
    expect(r.ucCount).toBe(27);
    expect(r.valor).toBe(27 * 102);
  });
});

describe('invariantes de cêntimo inteiro + rejeição de input inválido (LOUD)', () => {
  it('data final anterior ao vencimento é recusada', () => {
    expect(() => J.computeJuros({ valor: 100, dataVencimento: '2024-06-01', dataFim: '2024-01-01', tipo: 'civil', tabela: TABELA })).toThrow(/não pode ser anterior/i);
  });
  it('capital em falta é recusado', () => {
    expect(() => J.computeJuros({ dataVencimento: '2024-01-01', dataFim: '2024-12-31', tipo: 'civil', tabela: TABELA })).toThrow(/capital em falta/i);
  });
  it('tipo de juro inválido é recusado', () => {
    expect(() => J.computeJuros({ valor: 100, dataVencimento: '2024-01-01', dataFim: '2024-12-31', tipo: 'fiscal', tabela: TABELA })).toThrow(/tipo de juro inválido/i);
  });
  it('tabela em falta é recusada', () => {
    expect(() => J.computeJuros({ valor: 100, dataVencimento: '2024-01-01', dataFim: '2024-12-31', tipo: 'civil' })).toThrow(/tabela de taxas em falta/i);
  });
  it('capital sub-cêntimo (via valor) é recusado', () => {
    expect(() => J.computeJuros({ valor: 100.005, dataVencimento: '2024-01-01', dataFim: '2024-12-31', tipo: 'civil', tabela: TABELA })).toThrow(/2 casas decimais/i);
  });
  it('capitalCentavos não-inteiro é recusado', () => {
    expect(() => J.computeJuros({ capitalCentavos: 100.5, dataVencimento: '2024-01-01', dataFim: '2024-12-31', tipo: 'civil', tabela: TABELA })).toThrow(/inteiro em cêntimos/i);
  });
  it('data de calendário impossível é recusada', () => {
    expect(() => J.computeJuros({ valor: 100, dataVencimento: '2023-02-30', dataFim: '2023-12-31', tipo: 'comercial', tabela: TABELA })).toThrow(/data de calendário válida/i);
  });
  it('custas: tabela inválida é recusada', () => {
    expect(() => C.computeCustas({ valorAcao: 1000, tabela: 'I-Z', uc: TABELA.uc, ano: 2026 })).toThrow(/Tabela inválida/i);
  });
  it('custas: valor da acção negativo é recusado', () => {
    expect(() => C.computeCustas({ valorAcao: -1, tabela: 'I-A', uc: TABELA.uc, ano: 2026 })).toThrow(/não pode ser negativo/i);
  });
  it('custas: sem UC para o ano é recusado', () => {
    expect(() => C.computeCustas({ valorAcao: 1000, tabela: 'I-A', uc: [], ano: 2026 })).toThrow(/UC em falta/i);
  });
});
