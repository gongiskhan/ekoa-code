/**
 * SV-KYC-CHECKSUM - golden gate for the Portuguese fiscal-number check-digit
 * validation added to the KYC engine (NIF de pessoa singular / NIPC de pessoa
 * coletiva). Deterministic mod-11: weights 9..2 over the first 8 digits, check
 * digit = 0 if the remainder < 2, else 11 - remainder. The first digit encodes
 * the titular's nature (1/2/3 singular; 5/6/7/8/9 coletiva).
 *
 * ALL numbers here are SYNTHETIC. The "valid" ones are the smallest sequences
 * that satisfy the check digit for a given first digit (e.g. 100000002); they do
 * NOT correspond to any real taxpayer. The "invalid" ones are labelled synthetic
 * and the validator MUST reject them - the fixtures used by the served app carry
 * check-digit-invalid numbers by design, so nothing ever fakes a passing NIF.
 *
 * Engine loaded from the versioned content tree at api/assets/legal-engines,
 * exactly as the platform + the served-app scaffold load it. A separate assertion
 * pins the scaffold copy byte-identical to the canonical.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Resultado = { valido: boolean; digitos: string; motivo: string };

let K: {
  validaNumeroFiscal: (valor: unknown) => Resultado;
  validaNif: (valor: unknown) => Resultado;
  validaNipc: (valor: unknown) => Resultado;
};

const asset = (name: string) => new URL(`../../assets/legal-engines/${name}`, import.meta.url);
const scaffold = new URL(
  '../../assets/featured-artifacts/legal-kyc/scaffold/frontend/src/engine/kyc.mjs',
  import.meta.url,
);

beforeAll(async () => {
  K = (await import(asset('kyc.mjs').href)) as typeof K;
});

describe('served-app scaffold copy is byte-identical to the canonical engine', () => {
  it('legal-kyc/.../engine/kyc.mjs === assets/legal-engines/kyc.mjs', () => {
    const canonical = readFileSync(fileURLToPath(asset('kyc.mjs')), 'utf-8');
    const shipped = readFileSync(fileURLToPath(scaffold), 'utf-8');
    expect(shipped).toBe(canonical);
  });
});

describe('validaNumeroFiscal - dígito de controlo mod-11', () => {
  it('aceita um número com check-digit correto (synthetic válido)', () => {
    expect(K.validaNumeroFiscal('100000002')).toMatchObject({ valido: true, digitos: '100000002', motivo: '' });
  });

  it('normaliza prefixo PT, espaços e pontos antes de validar', () => {
    const r = K.validaNif('PT 100.000.002');
    expect(r.valido).toBe(true);
    expect(r.digitos).toBe('100000002');
  });

  it('rejeita um check-digit errado e diz o esperado vs o obtido', () => {
    const r = K.validaNumeroFiscal('100000003'); // synthetic: check-digit deveria ser 2
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain('esperado 2');
    expect(r.motivo).toContain('obtido 3');
  });

  it('rejeita comprimento diferente de 9 dígitos', () => {
    expect(K.validaNumeroFiscal('12345678')).toMatchObject({ valido: false });
    expect(K.validaNumeroFiscal('12345678').motivo).toContain('9 dígitos');
  });

  it('rejeita primeiro dígito 0 ou 4 (nenhuma natureza de titular)', () => {
    expect(K.validaNumeroFiscal('000000000').motivo).toContain('Primeiro dígito inválido');
    expect(K.validaNumeroFiscal('400000000').motivo).toContain('Primeiro dígito inválido');
  });

  it('rejeita entrada vazia', () => {
    expect(K.validaNumeroFiscal('')).toMatchObject({ valido: false, digitos: '' });
  });
});

describe('validaNif - pessoa singular (1/2/3)', () => {
  it('aceita NIF singular válido (começa por 1, 2 ou 3)', () => {
    expect(K.validaNif('100000002').valido).toBe(true);
    expect(K.validaNif('200000004').valido).toBe(true);
  });

  it('recusa um número de pessoa coletiva como NIF singular (natureza errada)', () => {
    const r = K.validaNif('500000000'); // check-digit válido, mas coletiva
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain('começa por 1, 2 ou 3');
  });

  it('SÍNTETICO inválido: NIF singular com check-digit errado é recusado', () => {
    const r = K.validaNif('100000003');
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain('Dígito de controlo inválido');
  });
});

describe('validaNipc - pessoa coletiva (5/6/7/8/9)', () => {
  it('aceita NIPC coletiva válido (começa por 5..9)', () => {
    expect(K.validaNipc('500000000').valido).toBe(true);
    expect(K.validaNipc('900000007').valido).toBe(true);
  });

  it('recusa um número de pessoa singular como NIPC (natureza errada)', () => {
    const r = K.validaNipc('100000002'); // check-digit válido, mas singular
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain('começa por 5, 6, 7, 8 ou 9');
  });

  it('SÍNTETICO inválido: NIPC coletiva com check-digit errado é recusado', () => {
    const r = K.validaNipc('500000001');
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain('Dígito de controlo inválido');
  });
});
