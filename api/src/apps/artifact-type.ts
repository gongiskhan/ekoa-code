/**
 * Artifact-type classifier (operator-run C1) — the scoping gate that decides
 * what KIND of artifact a build request produces, and therefore which internal
 * base scaffolds it and whether the operator assistant surface exists at all
 * (only `app`). Deterministic-first: strong PT/EN keyword signals classify for
 * free; only genuinely ambiguous requests spend a FAST one-shot through the
 * llm/ chokepoint (attribution kind `classifier` / `select-base-template`,
 * billed to the requesting user — the pre-provisioned ClassifierAgentType).
 * ANY model failure falls back to `app`, the platform default. Never throws.
 *
 * NO permission logic lives here (the security block wires the same output
 * into its gate later; sequencing rule).
 */
import { ArtifactType } from '@ekoa/shared';
import { runOneShot, decideForTier } from '../llm/index.js';
import type { BaseId } from './base-loader.js';

/**
 * Word's review vocabulary (document base v2, 2C-S6): a request to REVIEW an existing
 * .docx lands on the document base, whose source-linked mode edits the real file with
 * native tracked changes instead of re-authoring it.
 *
 * EVERY phrase here is ANCHORED - none of them counts on its own. NOT ONE of these is
 * Word-only vocabulary:
 *   - "registo/controlo de alterações", "registar/controlar alterações" and "alterações
 *     registadas" are ordinary Portuguese for a CHANGE LOG - "registo de alterações no
 *     meu CRM" and "registar alterações no inventário" are app features, not documents;
 *   - "track changes" is equally version-control jargon ("track changes no código");
 *   - even "marcas de revisão" / "redline" read as app vocabulary in the wrong sentence.
 * So a phrase only fires when a document/Word noun sits NEAR it in the same clause
 * (NEAR_BEFORE / NEAR_AFTER below). Unanchored it deliberately falls through to the
 * classifier one-shot, whose prompt already answers `app` when in doubt - which matters
 * because this type decides whether the operator assistant surface exists at all (see the
 * module header), so a false `document` silently strips that surface from an app build.
 * Pinned in tests/apps/artifact-type.test.ts by a misroute guard carrying the real
 * CRM/kanban/inventário/tickets/morada phrasings - do NOT unanchor any of these.
 */
const DOC_NOUN =
  '(?:documento|contrato|minuta|acordo|parecer|peti[çc][ãa]o|requerimento|of[íi]cio|carta|anexo|ficheiro|word|docx|document|contract)';

/** Same-clause proximity: within 40 characters and never across sentence punctuation. */
const NEAR_BEFORE = `(?<=${DOC_NOUN}\\b[^.;:!?]{0,40})`;
const NEAR_AFTER = `(?=[^.;:!?]{0,40}${DOC_NOUN}\\b)`;

const REVIEW_PHRASES = [
  '(?:registo|controlo) de altera[çc][õo]es',
  '(?:registar|controlar) altera[çc][õo]es',
  'altera[çc][õo]es registadas',
  'marcas de revis[ãa]o',
  'redlines?',
  'track(?:ed)? changes',
];

/** Each phrase twice: once with the document noun before it, once with it after. */
const DOC_REVIEW_SIGNALS = REVIEW_PHRASES
  .map((phrase) => `${NEAR_BEFORE}${phrase}|${phrase}${NEAR_AFTER}`)
  .join('|');

/** Strong deterministic signals, checked in order (first hit wins). The word
 *  lists are PT-PT-first (the product surface) with EN fallbacks. */
const SIGNALS: Array<{ type: ArtifactType; rx: RegExp }> = [
  { type: 'presentation', rx: /\b(apresenta[çc][ãa]o|slides?|diapositivo|deck|pitch)\b/i },
  { type: 'landing', rx: /\b(landing|p[áa]gina de (marketing|captura|vendas)|site promocional|one[- ]?pager|static (page|site)|p[áa]gina est[áa]tica|site est[áa]tico)\b/i },
  { type: 'report', rx: /\b(relat[óo]rio|report)\b/i },
  { type: 'document', rx: new RegExp(`\\b(documento|contrato|parecer|minuta|carta|of[íi]cio|acordo|procura[çc][ãa]o|peti[çc][ãa]o|requerimento|flyer|folheto|impress[ãa]o|imprim[íi]vel|word|pdf|${DOC_REVIEW_SIGNALS})\\b`, 'i') },
  { type: 'app', rx: /\b(app|aplica[çc][ãa]o|gestor|gest[ãa]o|dashboard|painel|calculadora|formul[áa]rio|lista de|tracker|crm|kanban|agenda)\b/i },
];

const CLASSIFY_SYSTEM = [
  'Classifica o pedido de construção num único tipo de artefacto.',
  'Responde com EXATAMENTE uma palavra de: app, document, report, presentation, landing.',
  'app = aplicação interativa (dados, formulários, páginas); document = documento imprimível',
  '(contrato, parecer, carta); report = relatório; presentation = slides; landing = página de marketing.',
  'Em caso de dúvida responde: app.',
].join('\n');

export interface ClassifyDeps {
  /** Injected for tests; defaults to the chokepoint one-shot. */
  oneShot?: (prompt: string, billeeUserId: string) => Promise<string>;
}

async function defaultOneShot(prompt: string, billeeUserId: string): Promise<string> {
  const res = await runOneShot(
    { prompt, decision: decideForTier('FAST'), systemPrompt: CLASSIFY_SYSTEM },
    { kind: 'classifier', agentType: 'select-base-template', billeeUserId },
  );
  return res.text;
}

/** Classify a build description. Deterministic signals first; ambiguous →
 *  FAST classifier one-shot; any failure → 'app'. Never throws. */
export async function classifyArtifactType(
  description: string,
  billeeUserId: string,
  deps: ClassifyDeps = {},
): Promise<ArtifactType> {
  if (!description.trim()) return 'app'; // nothing to classify — the platform default (codex C1)
  // EARLIEST match wins, not table order: PT head nouns come first ("app para
  // gerar contratos" is an app about contracts; "contrato de arrendamento" is a
  // document). Ties (same index) fall back to table order (codex C1 finding).
  let best: { type: ArtifactType; index: number } | null = null;
  for (const s of SIGNALS) {
    const m = s.rx.exec(description);
    if (m && (best === null || m.index < best.index)) {
      best = { type: s.type, index: m.index };
    }
  }
  if (best) return best.type;
  try {
    const raw = (await (deps.oneShot ?? defaultOneShot)(description, billeeUserId)).trim().toLowerCase();
    const word = raw.split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? '';
    const parsed = ArtifactType.safeParse(word);
    if (parsed.success) return parsed.data;
    console.warn(`[artifact-type] classifier returned unparseable "${raw.slice(0, 40)}"; defaulting to app`);
    return 'app';
  } catch (err) {
    console.warn('[artifact-type] classifier one-shot failed (non-fatal); defaulting to app:', err instanceof Error ? err.message : err);
    return 'app';
  }
}

/** The internal base each artifact type scaffolds from. `report` shares the
 *  print-shaped document shell. */
export function baseForType(type: ArtifactType): BaseId {
  switch (type) {
    case 'app': return 'app';
    case 'document': return 'document';
    case 'report': return 'document';
    case 'presentation': return 'presentation';
    case 'landing': return 'landing';
  }
}

/** The artifact type an EXPLICIT base selection implies (templateId path). */
export function typeForBase(baseId: BaseId): ArtifactType {
  switch (baseId) {
    case 'app': return 'app';
    case 'app-auth-persistent': return 'app';
    case 'app-integration-heavy': return 'app';
    case 'document': return 'document';
    case 'presentation': return 'presentation';
    case 'landing': return 'landing';
  }
}
