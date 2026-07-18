/**
 * S3-money - golden gate for the 2025/2026 rate-table refresh (run
 * 20260717-202309-d797918a). The canonical table (tabelas-taxas.json) was
 * verified against the Avisos published in the Diário da República (2.ª série)
 * through 2026-S2; this suite pins one cent-exact golden PER TROÇO across the
 * newly verified semesters, plus table hygiene (every commercial semester row
 * carries a real, citable Aviso - no 'confirmar' markers left).
 *
 * Verified sources (DR 2.ª série):
 *  - 2025-S1 11,15% - Aviso n.º 1278/2025/2 (DGTF)
 *  - 2025-S2 10,15% - Aviso n.º 16792/2025/2 (ETF)
 *  - 2026-S1 10,15% - Aviso n.º 822/2026/2 (ETF)
 *  - 2026-S2 10,40% - Aviso n.º 16623/2026/2 (ETF)
 *  - UC 2026 102,00 EUR - art. 242.º da Lei n.º 73-A/2025 (OE 2026)
 * Additive to SV-CALC (calculos-engines.test.ts): the 2023 goldens there stay
 * byte-identical; this file only pins the new semesters.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Troco = { inicio: string; fim: string; dias: number; taxa: number | null; aviso: string; juros: number; jurosCentavos: number; semestre?: string; nota?: string };
type Juros = {
  moeda: string; tipo: string; capital: number; dataVencimento: string; dataFim: string;
  diasTotais: number; trocos: Troco[]; totalJuros: number; totalJurosCentavos: number;
  total: number; incompleto: boolean; showWork: { passos: string[] };
};
type LinhaComercial = { semestre: string; taxa: number; aviso: string | null; vigenciaInicio: string; vigenciaFim: string; nota?: string };
type LinhaUc = { ano: number; valor: number; base?: string; nota?: string };
type Tabela = { jurosComerciais: LinhaComercial[]; uc: LinhaUc[]; jurosCivis: { taxa: number; base: string } };

let J: { computeJuros: (input: unknown) => Juros };
let TABELA: Tabela;

const asset = (name: string) => new URL(`../../assets/legal-engines/${name}`, import.meta.url);

beforeAll(async () => {
  J = (await import(asset('juros.mjs').href)) as { computeJuros: (input: unknown) => Juros };
  TABELA = JSON.parse(readFileSync(fileURLToPath(asset('tabelas-taxas.json')), 'utf-8')) as Tabela;
});

describe('computeJuros - troços verificados 2025/2026 (um Aviso citado por semestre)', () => {
  it('€10.000 de 2025-01-01 a 2026-07-17 cruza QUATRO semestres, todos citados, sem incompleto', () => {
    const r = J.computeJuros({ valor: 10000, dataVencimento: '2025-01-01', dataFim: '2026-07-17', tipo: 'comercial', tabela: TABELA });
    expect(r.incompleto).toBe(false);
    expect(r.trocos).toHaveLength(4);
    expect(r.diasTotais).toBe(562);

    const [t1, t2, t3, t4] = r.trocos;
    // 2025-S1: 181 dias @ 11,15% -> round(1_000_000c × 11.15 × 181 / 36500) = 55292c.
    expect(t1).toMatchObject({ inicio: '2025-01-01', fim: '2025-07-01', dias: 181, taxa: 11.15, aviso: 'Aviso n.º 1278/2025/2, DGTF', jurosCentavos: 55292, juros: 552.92 });
    // 2025-S2: 184 dias @ 10,15% -> 51167c.
    expect(t2).toMatchObject({ inicio: '2025-07-01', fim: '2026-01-01', dias: 184, taxa: 10.15, aviso: 'Aviso n.º 16792/2025/2, ETF', jurosCentavos: 51167, juros: 511.67 });
    // 2026-S1: 181 dias @ 10,15% -> 50333c.
    expect(t3).toMatchObject({ inicio: '2026-01-01', fim: '2026-07-01', dias: 181, taxa: 10.15, aviso: 'Aviso n.º 822/2026/2, ETF', jurosCentavos: 50333, juros: 503.33 });
    // 2026-S2: 16 dias @ 10,40% -> 4559c.
    expect(t4).toMatchObject({ inicio: '2026-07-01', fim: '2026-07-17', dias: 16, taxa: 10.4, aviso: 'Aviso n.º 16623/2026/2, ETF', jurosCentavos: 4559, juros: 45.59 });

    expect(r.totalJurosCentavos).toBe(55292 + 51167 + 50333 + 4559);
    expect(r.totalJuros).toBe(1613.51);

    // A memória cita cada Aviso aplicado.
    const memoria = r.showWork.passos.join('\n');
    for (const aviso of ['Aviso n.º 1278/2025/2, DGTF', 'Aviso n.º 16792/2025/2, ETF', 'Aviso n.º 822/2026/2, ETF', 'Aviso n.º 16623/2026/2, ETF']) {
      expect(memoria).toContain(aviso);
    }
  });

  it('2026-S2 isolado: €10.000 de 2026-07-01 a 2026-12-31 -> 183 dias @ 10,40% = 521,42 €', () => {
    const r = J.computeJuros({ valor: 10000, dataVencimento: '2026-07-01', dataFim: '2026-12-31', tipo: 'comercial', tabela: TABELA });
    expect(r.incompleto).toBe(false);
    expect(r.trocos).toHaveLength(1);
    const [t] = r.trocos;
    // round(1_000_000c × 10.4 × 183 / 36500) = 52142c.
    expect(t).toMatchObject({ dias: 183, taxa: 10.4, aviso: 'Aviso n.º 16623/2026/2, ETF', jurosCentavos: 52142, juros: 521.42 });
    expect(r.totalJurosCentavos).toBe(52142);
  });

  it('civis a 4%% seguem válidos em 2025/2026: €10.000 durante 2025 -> 400,00 € (Portaria 291/2003)', () => {
    const r = J.computeJuros({ valor: 10000, dataVencimento: '2025-01-01', dataFim: '2026-01-01', tipo: 'civil', tabela: TABELA });
    expect(r.incompleto).toBe(false);
    expect(r.trocos).toHaveLength(1);
    expect(r.trocos[0]!.taxa).toBe(4);
    // round(1_000_000c × 4 × 365 / 36500) = 40000c.
    expect(r.totalJurosCentavos).toBe(40000);
    expect(r.trocos[0]!.aviso).toMatch(/291\/2003/);
  });
});

describe('tabelas-taxas.json - higiene da série comercial verificada', () => {
  it('todos os semestres 2013-S1..2026-S2 presentes, contíguos e com Aviso real citado', () => {
    const rows = TABELA.jurosComerciais;
    expect(rows).toHaveLength(28); // 2013-S1 .. 2026-S2, sem buracos.
    const esperados: string[] = [];
    for (let ano = 2013; ano <= 2026; ano += 1) esperados.push(`${ano}-S1`, `${ano}-S2`);
    expect(rows.map((r) => r.semestre)).toEqual(esperados);

    for (const row of rows) {
      // Nenhuma linha-marcador: aviso real (formato citável), nunca 'confirmar'.
      expect(row.aviso, `aviso em falta no semestre ${row.semestre}`).toMatch(/^Aviso n\.º \d+\/\d{4}(\/\d+)?, (DGTF|ETF)$/);
      expect(row.nota ?? '', `nota-marcador no semestre ${row.semestre}`).not.toBe('confirmar');
      expect(typeof row.taxa).toBe('number');
    }
  });

  it('o semestre corrente (2026-S2) está verificado: 10,40%, Aviso n.º 16623/2026/2', () => {
    const atual = TABELA.jurosComerciais.find((r) => r.semestre === '2026-S2');
    expect(atual).toBeDefined();
    expect(atual!.taxa).toBe(10.4);
    expect(atual!.aviso).toBe('Aviso n.º 16623/2026/2, ETF');
  });

  it('UC 2024/2025/2026 = 102,00 EUR com base legal citada e sem marcador', () => {
    const porAno = new Map(TABELA.uc.map((u) => [Number(u.ano), u]));
    for (const ano of [2024, 2025, 2026]) {
      const u = porAno.get(ano);
      expect(u, `linha de UC ${ano}`).toBeDefined();
      expect(u!.valor).toBe(102.0);
      expect(u!.nota ?? '').not.toBe('confirmar');
      expect(String(u!.base ?? '').length).toBeGreaterThan(0);
    }
    expect(String(porAno.get(2025)!.base)).toMatch(/45-A\/2024/);
    expect(String(porAno.get(2026)!.base)).toMatch(/73-A\/2025/);
  });
});
