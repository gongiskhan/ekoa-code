/**
 * Knowledge-during-build scoping (F1). A DETERMINISTIC, no-model-call detector the first-build
 * scoping phase runs over the build request to decide whether the app looks domain-heavy - i.e.
 * it leans on specialised, org-held knowledge (legal rules, fee/tax schedules, clinical protocols,
 * insurance policies, regulatory obligations, property terms). When it fires, the build NARRATES
 * a knowledge request in the job stream (upload reference documents to the org knowledge area) and,
 * when the request carried scoping-provided documents, ingests them into the org knowledge area for
 * that run (agents/build.ts). The build never blocks on or fails for knowledge scoping.
 *
 * This detector is intentionally SEPARATE from knowledge/grounding.ts `isLegalContext`: that one
 * gates whether a build proactively GROUNDS the legal spine; this one gates whether the build
 * NARRATES a knowledge request across several domains. Keeping them decoupled avoids agents/
 * reaching into knowledge/ for a keyword list and lets each evolve on its own concern. No model
 * call, no egress - a pure lexical classifier (CLAUDE.md FIXED-4: platform logic is design-time TS).
 */

/** Fold to a lowercase, accent-stripped form for keyword matching (mirrors grounding.ts `fold`). */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Word tokens of the folded text (letters + digits), used for stem/exact matching. */
function tokens(folded: string): string[] {
  return folded.match(/[a-z0-9]+/g) ?? [];
}

/**
 * A keyword matches when:
 *  - multi-word phrase  -> substring of the folded text ("processo judicial");
 *  - short token (<= 3) -> an EXACT token match ("iva", "vat", "kyc") - never a substring, so
 *    "vat" does not fire on "vatican" and "fee" does not fire on "feed";
 *  - stem (>= 4)        -> a token that equals or STARTS WITH it ("taxa" -> "taxas",
 *    "apolice" -> "apolices"), so Portuguese plurals/inflections match without a stemmer.
 * The stem rule is deliberately prefix-only (not substring) so "tax"-like fragments never fire on
 * unrelated words; bare "tax" is not a keyword for exactly that reason (see FINANCEIRO below).
 */
function matchesKeyword(folded: string, toks: string[], kw: string): boolean {
  if (kw.includes(' ')) return folded.includes(kw);
  if (kw.length <= 3) return toks.includes(kw);
  return toks.some((t) => t === kw || t.startsWith(kw));
}

/** A knowledge domain: an internal key, its PT-PT label for narration, and its PT+EN keyword set. */
interface KnowledgeDomain {
  key: string;
  /** PT-PT label used in the operator-facing narration (formal register, brand-neutral). */
  label: string;
  keywords: string[];
}

/**
 * The domain keyword sets (PT + EN, accent-insensitive). Curated to fire on apps that clearly lean
 * on specialised org knowledge and to stay silent on generic apps (CRM, dashboards, to-do lists,
 * shops, blogs). Deliberately conservative: terms that also occur in generic apps are left out
 * (e.g. "orcamento"/"budget", bare "payment", bare "policy", bare "tax") to avoid false positives.
 */
const DOMAINS: KnowledgeDomain[] = [
  {
    key: 'juridico',
    label: 'jurídica',
    keywords: [
      // PT
      'tribunal', 'acordao', 'jurisprudencia', 'advogado', 'advocacia', 'juridic', 'peticao',
      'penhora', 'sentenca', 'citacao', 'clausula', 'contrato', 'litigio', 'processo judicial',
      'diligencia', 'contestacao', 'escritura', 'notario',
      // EN
      'lawsuit', 'litigation', 'court', 'attorney', 'plaintiff', 'defendant', 'statute',
      'jurisdiction', 'case law', 'legal case',
    ],
  },
  {
    key: 'financeiro',
    label: 'financeira',
    keywords: [
      // PT - fees/tax/accounting (NOT "orcamento"/budget, which is common in generic apps)
      'taxa', 'taxas', 'custas', 'honorarios', 'juros', 'imposto', 'iva', 'fatura', 'faturacao',
      'contabil', 'contabilidade', 'tesouraria', 'tarifario', 'fiscal',
      // EN - "tax" is omitted on purpose ("syntax"/"taxonomy"); the specific forms below are safe
      'fee', 'fees', 'invoice', 'invoicing', 'vat', 'accounting', 'tariff', 'levy',
    ],
  },
  {
    key: 'saude',
    label: 'clínica',
    keywords: [
      // PT ('medic' stem covers medica/medicos/medicina/medicamento/medical; 'consultas' is the
      // safe plural - bare 'consulta' would prefix-fire on EN "consultant")
      'clinic', 'clinico', 'paciente', 'doente', 'diagnostico', 'prescricao', 'medic',
      'sintoma', 'terapeutica', 'hospital', 'consultas', 'enfermeir', 'enfermagem',
      // EN ('doctors' not bare 'doctor', which would prefix-fire on "doctorate")
      'patient', 'clinical', 'diagnosis', 'prescription', 'dosage', 'healthcare', 'doctors',
    ],
  },
  {
    key: 'seguros',
    label: 'seguros',
    keywords: [
      // PT
      'seguro', 'apolice', 'sinistro', 'resseguro', 'segurado',
      // EN
      'insurance', 'underwriting', 'actuarial', 'insurance claim', 'insurance policy',
    ],
  },
  {
    key: 'conformidade',
    label: 'de conformidade regulamentar',
    keywords: [
      // PT
      'rgpd', 'conformidade', 'regulament', 'branqueamento de capitais',
      // EN
      'gdpr', 'compliance', 'regulatory', 'statutory', 'hipaa', 'kyc', 'aml',
    ],
  },
  {
    key: 'imobiliario',
    label: 'imobiliária',
    keywords: [
      // PT
      'imovel', 'imoveis', 'arrendamento', 'senhorio', 'inquilino', 'imobiliaria', 'hipoteca',
      // EN
      'real estate', 'property lease', 'landlord', 'tenant', 'mortgage',
    ],
  },
];

export interface DomainScopingResult {
  domainHeavy: boolean;
  /** The internal keys of the matched domains, in DOMAINS order (stable). */
  domains: string[];
}

/**
 * Detect whether a build request looks domain-heavy. Deterministic (no model call): it folds the
 * text, tokenises it, and matches the curated per-domain keyword sets. Returns every matched
 * domain key so the narration can name the area(s).
 */
export function detectDomainHeavy(text: string): DomainScopingResult {
  const folded = fold(text ?? '');
  const toks = tokens(folded);
  const domains = DOMAINS.filter((d) => d.keywords.some((kw) => matchesKeyword(folded, toks, kw))).map((d) => d.key);
  return { domainHeavy: domains.length > 0, domains };
}

/** PT-PT label list for the matched domain keys ("jurídica e financeira"). Unknown keys ignored. */
function domainLabels(domainKeys: string[]): string {
  const labels = domainKeys
    .map((k) => DOMAINS.find((d) => d.key === k)?.label)
    .filter((l): l is string => Boolean(l));
  if (labels.length === 0) return 'especializada';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
}

/**
 * The operator-facing knowledge request narrated in the build stream when the app looks
 * domain-heavy. PT-PT, formal register (voce - "pode carregar", never tuteio), brand-neutral,
 * no emoji, no em-dash. Tells the operator WHERE the domain knowledge lives (the org knowledge
 * area) and that documents added there are used in this build. The build does not block on it.
 */
export function knowledgeScopingNarration(domainKeys: string[]): string {
  const area = domainLabels(domainKeys);
  return (
    `Esta aplicação parece assentar em conhecimento especializado (área ${area}). ` +
    'Pode carregar documentos de referência para a área de conhecimento da organização; ' +
    'assim que estiverem disponíveis, são tidos em conta nesta construção.'
  );
}

/**
 * Confirmation narrated after scoping-provided documents are indexed into the org knowledge area
 * during the build. Same register/constraints as {@link knowledgeScopingNarration}.
 */
export function knowledgeIndexedNarration(count: number): string {
  const verb = count === 1 ? 'Foi indexado' : 'Foram indexados';
  const noun = count === 1 ? 'documento' : 'documentos';
  const avail = count === 1 ? 'já está disponível' : 'já estão disponíveis';
  return `${verb} ${count} ${noun} na área de conhecimento da organização; ${avail} para esta construção.`;
}
