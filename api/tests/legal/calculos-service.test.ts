/**
 * SV-CALC — legal-calculos platform service + tabelas crawler. Ported from
 * cortex/tests/services/legal-calculos.test.ts (ch13 legal-engine golden-figure
 * suite). Adapted harness: the module now lives in legal/, the engines are
 * design-time TS (so computeJuros/computeCustas are synchronous), and the DRE
 * aviso fixture is inlined; every expected figure is carried verbatim.
 */
import { describe, it, expect } from 'vitest';
import {
  mergeTabela,
  computeJuros,
  computeCustas,
  verificarAtualizacaoTaxas,
  emitirAlarmeTabelas,
  loadCanonicalTabela,
  type TabelaTaxas,
  type AlarmeStore,
} from '../../src/legal/calculos.js';
import { parseAvisoEtf, refreshTabelasTaxas } from '../../src/legal/tabelas-taxas.js';

// The DRE Aviso ETF fixture (carried from cortex/tests/fixtures/tabelas-taxas/aviso-etf-2024-s1.html).
const AVISO_FIXTURE = `<!doctype html>
<html lang="pt">
  <head><meta charset="utf-8"><title>Aviso n.º 1274/2024 - DRE</title></head>
  <body>
    <main>
      <h1>Aviso n.º 1274/2024, de 12 de janeiro</h1>
      <p class="orgao">Finanças - Direção-Geral do Tesouro e Finanças</p>
      <div class="texto">
        <p>
          Nos termos do n.º 1 do artigo 27.º do Decreto-Lei n.º 62/2013, de 10 de maio,
          faz-se público que a taxa supletiva de juros moratórios relativamente a créditos
          de que sejam titulares empresas comerciais, singulares ou coletivas, nos termos
          do § 3.º do artigo 102.º do Código Comercial, em vigor no 1.º semestre de 2024,
          é de 12,5 %.
        </p>
      </div>
    </main>
  </body>
</html>`;

// Tabela mínima controlada para o alarme (relógio injectado).
const TABELA_ALARME: TabelaTaxas = {
  alarme: { diaLimiteConfirmacao: 15 },
  jurosCivis: { taxa: 4, base: 'Portaria n.º 291/2003' },
  uc: [{ ano: 2026, valor: 102 }],
  jurosComerciais: [
    { semestre: '2026-S1', taxa: 10.15, aviso: 'Aviso 2026-S1', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-06-30' },
    { semestre: '2026-S2', taxa: 10.25, aviso: 'Aviso 2026-S2', vigenciaInicio: '2026-07-01', vigenciaFim: '2026-12-31', nota: 'confirmar' },
  ],
};

describe('mergeTabela - overlay ganha por semestre/ano', () => {
  it('sobrepõe a linha comercial do mesmo semestre e acrescenta a UC nova', () => {
    const canonical = loadCanonicalTabela();
    const overlay = [
      { tipo: 'juros_comerciais', semestre: '2026-S1', taxa: 9.99, aviso: 'Aviso n.º 999/2026, DGTF', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-06-30' },
      { tipo: 'uc', ano: 2027, valor: 105, base: 'OE 2027' },
      { tipo: 'juros_civis', taxa: 4 },
      { tipo: 'retencao_irs', taxa: 23 },
    ];
    const merged = mergeTabela(canonical, overlay);
    const s1 = merged.jurosComerciais!.find((r) => r.semestre === '2026-S1');
    expect(s1?.taxa).toBe(9.99);
    expect(s1?.aviso).toBe('Aviso n.º 999/2026, DGTF');
    expect(merged.uc!.find((r) => r.ano === 2027)?.valor).toBe(105);
    expect(merged.jurosComerciais!.find((r) => r.semestre === '2026-S2')).toBeTruthy();
  });

  it('overlay ausente/malformado degrada para a canónica', () => {
    const canonical = loadCanonicalTabela();
    const merged = mergeTabela(canonical, undefined as unknown as []);
    expect(merged.jurosComerciais!.length).toBe(canonical.jurosComerciais!.length);
  });
});

describe('computeJuros / computeCustas - via serviço (motores canónicos)', () => {
  it('juros comerciais cruzando semestres devolvem troços citados', async () => {
    const tabela = loadCanonicalTabela();
    const r = (await computeJuros({ valor: 10000, dataVencimento: '2023-04-01', dataFim: '2023-09-30', tipoJuro: 'comercial' }, tabela)) as { trocos: unknown[]; total: number };
    expect(r.trocos.length).toBe(2);
    expect(r.total).toBe(560.96);
  });

  it('taxa de justiça €30k I-A 2026 = €510,00', async () => {
    const tabela = loadCanonicalTabela();
    const r = (await computeCustas({ valorAcao: 30000, tabela: 'I-A', ano: 2026 }, tabela)) as { valor: number; ucCount: number };
    expect(r.valor).toBe(510);
    expect(r.ucCount).toBe(5);
  });
});

describe('verificarAtualizacaoTaxas - alarme §3.3 (relógio injectado)', () => {
  it('semestre corrente SEM linha, depois do dia 15 -> alarme', () => {
    const now = new Date(Date.UTC(2027, 2, 1)); // 2027-03-01 -> 2027-S1, sem linha
    const res = verificarAtualizacaoTaxas(now, TABELA_ALARME);
    expect(res.alarme).toBe(true);
    expect(res.semestre).toBe('2027-S1');
    expect(res.motivo).toBe('em-falta');
  });

  it('período de graça (dia < 15 do 1.º mês) NÃO dispara, mesmo sem linha', () => {
    const now = new Date(Date.UTC(2027, 0, 10)); // 2027-01-10, dia 10 < 15
    const res = verificarAtualizacaoTaxas(now, TABELA_ALARME);
    expect(res.alarme).toBe(false);
    expect(res.motivo).toBe('graca');
  });

  it('semestre confirmado (sem nota) NÃO dispara', () => {
    const now = new Date(Date.UTC(2026, 2, 1)); // 2026-03-01 -> 2026-S1 (sem nota)
    const res = verificarAtualizacaoTaxas(now, TABELA_ALARME);
    expect(res.alarme).toBe(false);
    expect(res.motivo).toBe('ok');
  });

  it('semestre com nota "confirmar", passado o dia 15 -> alarme', () => {
    const now = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01 -> 2026-S2 (nota confirmar)
    const res = verificarAtualizacaoTaxas(now, TABELA_ALARME);
    expect(res.alarme).toBe(true);
    expect(res.motivo).toBe('por-confirmar');
  });

  it('graça vence sobre a nota "confirmar" no arranque do semestre', () => {
    const now = new Date(Date.UTC(2026, 6, 10)); // 2026-07-10, dia 10 < 15 do S2
    const res = verificarAtualizacaoTaxas(now, TABELA_ALARME);
    expect(res.alarme).toBe(false);
    expect(res.motivo).toBe('graca');
  });
});

describe('emitirAlarmeTabelas - notificação deduplicada, best-effort', () => {
  function fakeStore(seed: Array<Record<string, unknown>> = []): { store: AlarmeStore; created: Array<Record<string, unknown>> } {
    const rows = [...seed];
    const created: Array<Record<string, unknown>> = [];
    const store: AlarmeStore = {
      async list() {
        return rows;
      },
      async create(_scope, _collection, data) {
        created.push(data);
        rows.push(data);
        return { id: `n${created.length}`, ...data };
      },
    };
    return { store, created };
  }

  it('cria a notificação quando o alarme dispara e ainda não existe', async () => {
    const { store, created } = fakeStore();
    const now = new Date(Date.UTC(2027, 2, 1));
    const res = await emitirAlarmeTabelas('usr.abc', now, { store, tabela: TABELA_ALARME });
    expect(res.alarme).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ tipo: 'tabelas', semestre: '2027-S1', lida: false });
  });

  it('NÃO duplica se já existe notificação não lida do mesmo semestre', async () => {
    const { store, created } = fakeStore([{ tipo: 'tabelas', semestre: '2027-S1', lida: false }]);
    const now = new Date(Date.UTC(2027, 2, 1));
    await emitirAlarmeTabelas('usr.abc', now, { store, tabela: TABELA_ALARME });
    expect(created).toHaveLength(0);
  });

  it('não cria nada quando não há alarme', async () => {
    const { store, created } = fakeStore();
    const now = new Date(Date.UTC(2026, 2, 1)); // 2026-S1 ok
    const res = await emitirAlarmeTabelas('usr.abc', now, { store, tabela: TABELA_ALARME });
    expect(res.alarme).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('nunca lança se o store falhar', async () => {
    const store: AlarmeStore = {
      async list() {
        throw new Error('boom');
      },
      async create() {
        throw new Error('boom');
      },
    };
    const now = new Date(Date.UTC(2027, 2, 1));
    await expect(emitirAlarmeTabelas('usr.abc', now, { store, tabela: TABELA_ALARME })).resolves.toMatchObject({ alarme: true });
  });
});

describe('crawler de tabelas - parseAvisoEtf + refreshTabelasTaxas (fixture)', () => {
  it('extrai Aviso + taxa + semestre do HTML do DRE', () => {
    const row = parseAvisoEtf(AVISO_FIXTURE);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      tipo: 'juros_comerciais',
      semestre: '2024-S1',
      taxa: 12.5,
      aviso: 'Aviso n.º 1274/2024, DGTF',
      vigenciaInicio: '2024-01-01',
      vigenciaFim: '2024-06-30',
    });
  });

  it('recusa (null) um documento que não seja um Aviso ETF', () => {
    expect(parseAvisoEtf('<html><body><p>Página qualquer sem aviso.</p></body></html>')).toBeNull();
    expect(parseAvisoEtf('<p>Aviso n.º 1/2024 sobre outra matéria, 10 % de desconto.</p>')).toBeNull();
  });

  it('refreshTabelasTaxas com fixture (html directo) devolve a linha e persiste via writeOverlay', async () => {
    const persisted: unknown[] = [];
    const res = await refreshTabelasTaxas({ html: AVISO_FIXTURE, writeOverlay: async (row) => { persisted.push(row); } });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.semestre).toBe('2024-S1');
    expect(persisted).toHaveLength(1);
  });

  it('refreshTabelasTaxas com fetch injectado', async () => {
    const res = await refreshTabelasTaxas({
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => AVISO_FIXTURE }),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.taxa).toBe(12.5);
  });

  it('sem fetch nem html: honesto (ok:false), sem inventar', async () => {
    const res = await refreshTabelasTaxas({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/pós-checkpoint|fixture/i);
  });
});
