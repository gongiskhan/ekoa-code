/**
 * S3-money - pins for the ADDITIVE cobranças engine functions (run
 * 20260717-202309-d797918a): cartaInterpelacao (deterministic interpelação
 * letter) and proximaAcaoBucket (aging escalation ruler). Honesty rules pinned:
 *  - without a calculos result the letter NEVER carries a rate or an interest
 *    figure - it defers liquidation to payment date under arts. 805/806 CC;
 *  - with a calculos result every troço's Aviso is cited in the fundamentação;
 *  - the payment deadline counts from RECEPTION; prazoEstimado is only an
 *    internal estimate (hoje + prazo).
 * Additivity: computeAging/reconcileCobranca behavior is untouched (the frozen
 * legal-cobrancas.spec.ts re-verifies them e2e); a light aging pin stands here.
 */
import { describe, it, expect, beforeAll } from 'vitest';

type Carta = {
  texto: string; citas: string[]; prazoDias: number;
  prazoEstimado: string | null; totalComJuros: number | null;
};
type Engine = {
  cartaInterpelacao: (input?: Record<string, unknown>) => Carta;
  proximaAcaoBucket: (bucket: string) => { id: string; label: string; detalhe: string; cita: string | null } | null;
  computeAging: (cobrancas: unknown[], hoje?: Date) => Record<string, { count: number; total: number }>;
};

let E: Engine;

beforeAll(async () => {
  E = (await import(new URL('../../assets/legal-engines/cobrancas.mjs', import.meta.url).href)) as Engine;
});

describe('cartaInterpelacao - determinística e honesta', () => {
  const base = {
    devedorNome: 'Sociedade Alfa, Lda.',
    descricao: 'Fatura FT 2026/18 - honorários laboral',
    valor: 1230.5,
    dataVencimento: '2026-06-25',
    hoje: '2026-07-17',
    prazoDias: 10,
  };

  it('sem juros: NUNCA inventa taxa nem total - remete para os arts. 805.º/806.º CC', () => {
    const c = E.cartaInterpelacao(base);
    expect(c.texto).toContain('INTERPELAÇÃO PARA CUMPRIMENTO');
    expect(c.texto).toContain('1230,50 EUR');
    expect(c.texto).toContain('vencida em 25-06-2026');
    expect(c.texto).toContain('artigos 805.º e 806.º do Código Civil');
    expect(c.texto).toContain('a liquidar à data do pagamento');
    expect(c.texto).toContain('prazo de 10 dias a contar da receção');
    expect(c.texto).toContain('Decreto-Lei n.º 269/98');
    // Nenhuma percentagem: sem fonte, não há taxa.
    expect(c.texto).not.toMatch(/%/);
    expect(c.totalComJuros).toBeNull();
    expect(c.prazoEstimado).toBe('2026-07-27');
    // Sem remetente fornecido, a assinatura fica por preencher - não se finge.
    expect(c.texto).toContain('(identificação e assinatura do remetente)');
    expect(c.citas.some((x) => /805\.º/.test(x))).toBe(true);
    expect(c.citas.some((x) => /269\/98/.test(x))).toBe(true);
  });

  it('com juros do serviço de cálculos: total exato e TODOS os Avisos citados', () => {
    const c = E.cartaInterpelacao({
      ...base,
      valor: 10000,
      dataVencimento: '2025-01-01',
      credorNome: 'Cliente Credor, SA',
      remetenteNome: 'Dra. Marília',
      juros: {
        totalJuros: 1613.51,
        dataFim: '2026-07-17',
        trocos: [
          { aviso: 'Aviso n.º 1278/2025/2, DGTF', taxa: 11.15, inicio: '2025-01-01', fim: '2025-07-01' },
          { aviso: 'Aviso n.º 16792/2025/2, ETF', taxa: 10.15, inicio: '2025-07-01', fim: '2026-01-01' },
          { aviso: 'Aviso n.º 822/2026/2, ETF', taxa: 10.15, inicio: '2026-01-01', fim: '2026-07-01' },
          { aviso: 'Aviso n.º 16623/2026/2, ETF', taxa: 10.4, inicio: '2026-07-01', fim: '2026-07-17' },
        ],
      },
    });
    expect(c.totalComJuros).toBe(11613.51);
    expect(c.texto).toContain('somam 1613,51 EUR');
    expect(c.texto).toContain('11613,51 EUR');
    expect(c.texto).toContain('artigo 102.º do Código Comercial');
    expect(c.texto).toContain('Decreto-Lei n.º 62/2013');
    expect(c.texto).toContain('Na qualidade de mandatário(a) de Cliente Credor, SA');
    expect(c.texto).toContain('Dra. Marília');
    for (const aviso of ['1278/2025/2', '16792/2025/2', '822/2026/2', '16623/2026/2']) {
      expect(c.citas.join('\n')).toContain(aviso);
    }
  });

  it('é pura: os mesmos argumentos produzem exatamente o mesmo texto', () => {
    const a = E.cartaInterpelacao(base);
    const b = E.cartaInterpelacao(base);
    expect(a.texto).toBe(b.texto);
    expect(a.citas).toEqual(b.citas);
  });

  it('prazo inválido degrada para os 10 dias por omissão', () => {
    expect(E.cartaInterpelacao({ ...base, prazoDias: -3 }).prazoDias).toBe(10);
    expect(E.cartaInterpelacao({ ...base, prazoDias: 'x' }).prazoDias).toBe(10);
    expect(E.cartaInterpelacao({ ...base, prazoDias: 30 }).prazoDias).toBe(30);
  });
});

describe('proximaAcaoBucket - régua de escalada por escalão', () => {
  it('0-30 lembrete, 31-60 interpelação (805.º CC), 61+ injunção (DL 269/98)', () => {
    expect(E.proximaAcaoBucket('0-30')).toMatchObject({ id: 'lembrete' });
    expect(E.proximaAcaoBucket('31-60')).toMatchObject({ id: 'interpelacao', cita: 'Art. 805.º, n.º 1, do Código Civil' });
    expect(E.proximaAcaoBucket('61+')).toMatchObject({ id: 'injuncao', cita: 'DL n.º 269/98, de 1 de setembro' });
    expect(E.proximaAcaoBucket('outro')).toBeNull();
  });
});

describe('aditividade - o comportamento existente não mudou', () => {
  it('computeAging continua a agrupar como dantes', () => {
    const hoje = new Date(2026, 6, 17);
    const aging = E.computeAging([
      { estado: 'pendente', dataVencimento: '2026-06-25', valor: 100 }, // 22 dias -> 0-30
      { estado: 'pendente', dataVencimento: '2026-06-02', valor: 50 }, // 45 dias -> 31-60
      { estado: 'paga', dataVencimento: '2026-01-01', valor: 999 }, // excluída
    ], hoje);
    expect(aging).toEqual({
      '0-30': { count: 1, total: 100 },
      '31-60': { count: 1, total: 50 },
      '61+': { count: 0, total: 0 },
    });
  });
});
