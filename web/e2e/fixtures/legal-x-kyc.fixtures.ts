/**
 * Synthetic fiscal-number fixtures for the legal-x-kyc spec.
 *
 * ALL numbers here are SYNTHETIC and do NOT identify any real taxpayer. The
 * "valid" ones are the smallest sequences that satisfy the Portuguese mod-11
 * check digit for a given first digit (100000002 -> singular; 500000000 ->
 * coletiva); the "invalid" ones carry a deliberately WRONG check digit so the
 * KYC validator must REJECT them - the spec asserts the rejection, never a fake
 * pass. The check digit was computed from the canonical engine
 * (api/assets/legal-engines/kyc.mjs) and frozen here.
 *
 *   mod-11: weights 9..2 over the first 8 digits; sum % 11; check digit = 0 if
 *   remainder < 2, else 11 - remainder. First digit: 1/2/3 singular, 5/6/7/8/9
 *   coletiva.
 */

/** Singular (NIF), check digit correct -> validaNif deve aceitar. */
export const NIF_SINGULAR_VALIDO = '100000002';

/** Singular (NIF), check digit ERRADO (2 -> 3) -> validaNif deve rejeitar. */
export const NIF_SINGULAR_INVALIDO = '100000003';

/** Coletiva (NIPC), check digit correto -> validaNipc deve aceitar. */
export const NIPC_COLETIVA_VALIDO = '500000000';

/** Coletiva (NIPC), check digit ERRADO (0 -> 1) -> validaNipc deve rejeitar. */
export const NIPC_COLETIVA_INVALIDO = '500000001';

/**
 * NIF/NIPC de natureza trocada: check digit válido, mas primeiro dígito da
 * classe errada. Um NIF singular (1/2/3) NÃO é um NIPC coletivo válido e vice-versa.
 */
export const NATUREZA_TROCADA = {
  singularUsadoComoNipc: NIF_SINGULAR_VALIDO, // 1... -> validaNipc rejeita
  coletivaUsadaComoNif: NIPC_COLETIVA_VALIDO, // 5... -> validaNif rejeita
} as const;
