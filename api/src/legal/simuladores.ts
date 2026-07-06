/**
 * Deterministic Portuguese work-law calculators — "Simuladores de Trabalho".
 *
 * PURE functions (no I/O, no deps) so they can be unit-tested here AND bundled
 * verbatim into the "Simuladores de Trabalho" artifact. Every result carries its
 * `legalRef` (the Código do Trabalho article) so the UI can cite the legal basis,
 * and a `nota` where a figure depends on annually-set values (RMMG) or a recent
 * reform. These mirror the ACT (Autoridade para as Condições do Trabalho)
 * simulators; the rules are the Código do Trabalho (CT).
 *
 * IMPORTANT: figures reflect the CT in force at authoring; a collective agreement
 * (IRCT/CCT) may set more favourable terms. The artifact surfaces these refs so a
 * lawyer can verify against the firm's knowledge base before relying on a value.
 *
 * Carried port-as-is from cortex/src/legal/simuladores.ts (carryover-audit A11):
 * zero imports, pure — the golden figures are locked by tests/legal/simuladores.
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
/** Sanitize a numeric input to a finite, non-negative number (default on NaN/∞). */
function nn(n: unknown, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : fallback;
}
/**
 * Month-of-start (0-11), timezone-stable: an ISO `YYYY-MM-DD` string is read from
 * the literal month (not parsed to a Date, which would shift across timezones);
 * anything else uses the local Date month. null for an unparseable value.
 */
function mesDeInicio(dataInicio: Date | string): number | null {
  if (typeof dataInicio === 'string') {
    const m = dataInicio.match(/^(\d{4})-(\d{2})/);
    if (m) return clamp(Number(m[2]) - 1, 0, 11);
  }
  const d = new Date(dataInicio);
  return Number.isNaN(d.getTime()) ? null : d.getMonth();
}

// ---------------------------------------------------------------------------
// 1) Férias — Código do Trabalho, art. 237.º a 239.º
// ---------------------------------------------------------------------------

/** Regra geral: 22 dias úteis de férias por ano civil (art. 238.º/1). */
export const FERIAS_DIAS_ANO_COMPLETO = 22;

/**
 * Férias no ANO DE ADMISSÃO (art. 239.º/1): 2 dias úteis por cada mês de duração
 * do contrato (no ano de admissão), até ao máximo de 20 dias úteis.
 */
export function feriasAnoAdmissao(mesesDuracaoNoAnoAdmissao: number): number {
  const meses = Math.floor(nn(mesesDuracaoNoAnoAdmissao));
  return Math.min(2 * meses, 20);
}

export interface SimFeriasResult {
  diasAnoAdmissao: number;
  diasAnoSeguinte: number;
  legalRef: string;
  nota: string;
}

/** Simulador de férias a partir da data de início do contrato. */
export function simularFerias(dataInicioContrato: Date | string): SimFeriasResult {
  // Meses de duração do contrato no ano de admissão (o mês de início conta),
  // de forma estável a fusos horários (ver mesDeInicio).
  const mes = mesDeInicio(dataInicioContrato);
  const mesesNoAno = mes === null ? 0 : 12 - mes;
  return {
    diasAnoAdmissao: feriasAnoAdmissao(mesesNoAno),
    diasAnoSeguinte: FERIAS_DIAS_ANO_COMPLETO,
    legalRef: 'Código do Trabalho, art. 238.º e 239.º',
    nota: 'No ano de admissão, as férias só podem ser gozadas após 60 dias completos de execução do contrato (art. 239.º/1).',
  };
}

// ---------------------------------------------------------------------------
// 2) Faltas por falecimento de familiar — art. 251.º (redação da Lei 13/2023)
// ---------------------------------------------------------------------------

export type GrauFalecimento = 'descendente' | 'conjuge' | 'ascendente_afim_1grau' | 'parente_2grau';

export interface SimFalecimentoResult {
  dias: number;
  legalRef: string;
  nota: string;
}

/**
 * Dias de falta justificada (consecutivos) por falecimento, art. 251.º:
 *  - descendente (filho/enteado): 20 dias;
 *  - cônjuge não separado / parente ou afim no 1.º grau da linha reta que não
 *    seja descendente (pais, sogros): 5 dias;
 *  - outro parente/afim no 2.º grau (avós, netos, irmãos, cunhados): 2 dias.
 */
export function faltasFalecimento(grau: GrauFalecimento): SimFalecimentoResult {
  const dias = grau === 'descendente' ? 20 : grau === 'parente_2grau' ? 2 : 5;
  return {
    dias,
    legalRef: 'Código do Trabalho, art. 251.º (redação da Lei n.º 13/2023)',
    nota: 'Dias consecutivos. A morte de descendente confere 20 dias (Agenda do Trabalho Digno).',
  };
}

// ---------------------------------------------------------------------------
// 3) Compensação por cessação do contrato — art. 366.º
// ---------------------------------------------------------------------------

export interface SimCompensacaoResult {
  compensacao: number;
  diasPorAno: number;
  baseMensalConsiderada: number;
  legalRef: string;
  nota: string;
}

/**
 * Compensação por cessação (regime atual, art. 366.º): 12 dias de (retribuição
 * base + diuturnidades) por cada ano completo de antiguidade, com proporção nas
 * frações de ano. O valor de referência mensal (retribuição base + diuturnidades)
 * está limitado a 20 × RMMG (art. 366.º/2). Um dia = base mensal / 30.
 */
export function compensacaoCessacao(opts: {
  retribuicaoBaseMensal: number;
  diuturnidades?: number;
  antiguidadeAnos: number;
  rmmg?: number;
}): SimCompensacaoResult {
  const diut = nn(opts.diuturnidades);
  // RMMG must be a positive value — a missing / non-positive input falls back to
  // the indicative default rather than collapsing the cap to 0.
  const rmmg = typeof opts.rmmg === 'number' && Number.isFinite(opts.rmmg) && opts.rmmg > 0 ? opts.rmmg : 870;
  const baseMensal = Math.min(nn(opts.retribuicaoBaseMensal) + diut, 20 * rmmg);
  const anos = nn(opts.antiguidadeAnos);
  const compensacao = (baseMensal / 30) * 12 * anos;
  return {
    compensacao: round2(compensacao),
    diasPorAno: 12,
    baseMensalConsiderada: round2(baseMensal),
    legalRef: 'Código do Trabalho, art. 366.º',
    nota: 'Regime atual (12 dias/ano; base mensal limitada a 20 × RMMG). Contratos anteriores a 01/10/2013 podem ter regimes transitórios distintos. RMMG parametrizável (predefinição indicativa).',
  };
}

// ---------------------------------------------------------------------------
// 4) Subsídios proporcionais (férias e Natal) — art. 263.º e 264.º
// ---------------------------------------------------------------------------

export interface SimSubsidiosResult {
  subsidioFerias: number;
  subsidioNatal: number;
  proporcao: number;
  legalRef: string;
  nota: string;
}

/**
 * Subsídio de férias (art. 264.º) e subsídio de Natal (art. 263.º), ambos iguais
 * a um mês de retribuição, proporcionais ao tempo de serviço prestado no ano
 * (admissão/cessação): retribuição mensal × meses trabalhados / 12.
 */
export function subsidiosProporcionais(opts: {
  retribuicaoMensal: number;
  mesesTrabalhadosNoAno: number;
}): SimSubsidiosResult {
  const meses = Number.isFinite(opts.mesesTrabalhadosNoAno) ? clamp(opts.mesesTrabalhadosNoAno, 0, 12) : 0;
  const proporcao = meses / 12;
  const valor = round2(nn(opts.retribuicaoMensal) * proporcao);
  return {
    subsidioFerias: valor,
    subsidioNatal: valor,
    // exact proportion (NOT rounded) so subsidio === mensal × proporcao holds
    proporcao,
    legalRef: 'Código do Trabalho, art. 263.º (Natal) e 264.º (férias)',
    nota: 'Proporcionais ao tempo de serviço no ano civil; um ano completo corresponde a um mês de retribuição cada.',
  };
}

// ---------------------------------------------------------------------------
// 5) Aviso prévio de denúncia pelo trabalhador — art. 400.º
// ---------------------------------------------------------------------------

export interface SimAvisoPrevioResult {
  dias: number;
  legalRef: string;
  nota: string;
}

/**
 * Aviso prévio de denúncia do contrato sem termo pelo trabalhador (art. 400.º/1):
 * 30 dias se a antiguidade for inferior a 2 anos; 60 dias se for igual ou superior.
 */
export function avisoPrevioDenuncia(antiguidadeAnos: number): SimAvisoPrevioResult {
  return {
    dias: antiguidadeAnos < 2 ? 30 : 60,
    legalRef: 'Código do Trabalho, art. 400.º',
    nota: 'Denúncia pelo trabalhador de contrato por tempo indeterminado. O IRCT aplicável pode prever prazos diferentes.',
  };
}

// ---------------------------------------------------------------------------
// 6) Trabalho suplementar — art. 268.º
// ---------------------------------------------------------------------------

export interface SimTrabalhoSuplementarResult {
  total: number;
  legalRef: string;
  nota: string;
}

/**
 * Pagamento de trabalho suplementar (regime supletivo, art. 268.º/1):
 *  - dia útil: 1.ª hora ou fração +25%; horas/frações seguintes +37,5%;
 *  - dia de descanso (semanal/complementar) ou feriado: +50%.
 * Devolve o VALOR TOTAL a pagar pelas horas indicadas (retribuição horária ×
 * fator de cada bloco).
 */
export function trabalhoSuplementar(opts: {
  retribuicaoHoraria: number;
  horasPrimeiraDiaUtil?: number;
  horasSeguintesDiaUtil?: number;
  horasDescansoOuFeriado?: number;
}): SimTrabalhoSuplementarResult {
  const rh = nn(opts.retribuicaoHoraria);
  const total =
    nn(opts.horasPrimeiraDiaUtil) * rh * 1.25 +
    nn(opts.horasSeguintesDiaUtil) * rh * 1.375 +
    nn(opts.horasDescansoOuFeriado) * rh * 1.5;
  return {
    total: round2(total),
    legalRef: 'Código do Trabalho, art. 268.º',
    nota: 'Valores supletivos do Código do Trabalho; um IRCT/CCT pode fixar acréscimos diferentes.',
  };
}

/** The simulator catalogue (id → label + legal ref), for the artifact UI. */
export const SIMULADORES = [
  { id: 'ferias', label: 'Férias', legalRef: 'art. 238.º e 239.º' },
  { id: 'faltas-falecimento', label: 'Faltas por falecimento de familiar', legalRef: 'art. 251.º' },
  { id: 'compensacao', label: 'Compensação por cessação do contrato', legalRef: 'art. 366.º' },
  { id: 'subsidios', label: 'Subsídios de férias e de Natal (proporcionais)', legalRef: 'art. 263.º e 264.º' },
  { id: 'aviso-previo', label: 'Aviso prévio de denúncia', legalRef: 'art. 400.º' },
  { id: 'trabalho-suplementar', label: 'Trabalho suplementar', legalRef: 'art. 268.º' },
] as const;
