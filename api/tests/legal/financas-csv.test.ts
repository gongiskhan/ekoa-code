/**
 * S3-money - golden pins for the conta-corrente CSV export of the Finanças app
 * (run 20260717-202309-d797918a). The helper is pure text (no rede, no DOM in
 * extratoCsv), so the export is pinned byte-for-byte: UTF-8 BOM, ';' separator,
 * decimal comma, CRLF, credits signed '-', and the honest disclaimer that the
 * file is NOT a certified accounting extract - certified accounting lives in
 * the firm's certified invoicing/accounting software (REGRA_EMISSAO).
 */
import { describe, it, expect, beforeAll } from 'vitest';

type Csv = {
  CSV_DISCLAIMER: string;
  csvCampo: (v: unknown) => string;
  eurCsv: (v: unknown) => string;
  extratoCsv: (input?: {
    clienteNome?: string; processoNumero?: string; geradoEm?: string;
    extrato?: Array<Record<string, unknown>>;
  }) => string;
};

let C: Csv;

beforeAll(async () => {
  const url = new URL(
    '../../assets/featured-artifacts/legal-financas/scaffold/frontend/src/pages/financas-csv.js',
    import.meta.url,
  );
  C = (await import(url.href)) as Csv;
});

describe('financas-csv - extrato de conta corrente em CSV honesto', () => {
  it('golden: extrato do cliente seed (débito 885,60 + crédito 500,00) byte a byte', () => {
    const texto = C.extratoCsv({
      clienteNome: 'Sociedade Alfa, Lda.',
      processoNumero: '',
      geradoEm: '2026-07-17',
      extrato: [
        { data: '2026-06-02', tipo: 'debito', origem: 'despesa', origemLabel: 'Despesa', notas: 'Taxa de justiça', valor: 885.6, saldoCorrente: 885.6 },
        { data: '2026-06-20', tipo: 'credito', origem: 'pagamento', origemLabel: 'Pagamento', notas: 'Provisão recebida do cliente', valor: 500, saldoCorrente: 385.6 },
      ],
    });
    expect(texto).toBe(
      '\uFEFF' +
      '# Extrato de conta corrente - Sociedade Alfa, Lda.\r\n' +
      '# Documento de conferência gerado pela app Finanças (Ekoa) - não é extrato contabilístico certificado.\r\n' +
      '# Gerado em 2026-07-17\r\n' +
      'Data;Tipo;Origem;Descrição;Valor (EUR);Saldo corrente (EUR)\r\n' +
      '2026-06-02;Débito;Despesa;Taxa de justiça;885,60;885,60\r\n' +
      '2026-06-20;Crédito;Pagamento;Provisão recebida do cliente;-500,00;385,60\r\n',
    );
    expect(texto.startsWith('\uFEFF')).toBe(true);
  });

  it('o disclaimer aparece SEMPRE, mesmo num extrato vazio', () => {
    const texto = C.extratoCsv({ clienteNome: 'X', extrato: [] });
    expect(texto).toContain(C.CSV_DISCLAIMER);
    expect(C.CSV_DISCLAIMER).toBe(
      'Documento de conferência gerado pela app Finanças (Ekoa) - não é extrato contabilístico certificado.',
    );
    expect(C.CSV_DISCLAIMER).toMatch(/não é extrato contabilístico certificado/);
  });

  it('vista por processo: o número do processo entra no cabeçalho', () => {
    const texto = C.extratoCsv({ clienteNome: 'Sociedade Alfa, Lda.', processoNumero: '789/26.5T8PRT', extrato: [] });
    expect(texto).toContain('# Extrato de conta corrente - Sociedade Alfa, Lda. - processo 789/26.5T8PRT\r\n');
  });

  it('csvCampo escapa separadores, aspas e quebras de linha (nunca parte a coluna)', () => {
    expect(C.csvCampo('simples')).toBe('simples');
    expect(C.csvCampo('com; separador')).toBe('"com; separador"');
    expect(C.csvCampo('diz "aspas"')).toBe('"diz ""aspas"""');
    expect(C.csvCampo('linha\nquebrada')).toBe('"linha\nquebrada"');
    expect(C.csvCampo(null)).toBe('');
  });

  it('eurCsv: vírgula decimal, duas casas, e 0,00 para valores não numéricos', () => {
    expect(C.eurCsv(385.6)).toBe('385,60');
    expect(C.eurCsv(885.6)).toBe('885,60');
    expect(C.eurCsv(0)).toBe('0,00');
    expect(C.eurCsv('abc')).toBe('0,00');
    expect(C.eurCsv(undefined)).toBe('0,00');
  });
});
