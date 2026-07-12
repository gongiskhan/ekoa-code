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

/** Strong deterministic signals, checked in order (first hit wins). The word
 *  lists are PT-PT-first (the product surface) with EN fallbacks. */
const SIGNALS: Array<{ type: ArtifactType; rx: RegExp }> = [
  { type: 'presentation', rx: /\b(apresenta[çc][ãa]o|slides?|diapositivo|deck|pitch)\b/i },
  { type: 'landing', rx: /\b(landing|p[áa]gina de (marketing|captura|vendas)|site promocional|one[- ]?pager)\b/i },
  { type: 'report', rx: /\b(relat[óo]rio|report)\b/i },
  { type: 'document', rx: /\b(documento|contrato|parecer|minuta|carta|of[íi]cio|acordo|procura[çc][ãa]o|peti[çc][ãa]o|requerimento|flyer|folheto|impress[ãa]o|imprim[íi]vel|word|pdf)\b/i },
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
  for (const s of SIGNALS) {
    if (s.rx.test(description)) return s.type;
  }
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
