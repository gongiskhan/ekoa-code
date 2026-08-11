/**
 * Artifact-type classifier (operator-run C1; inverted MODEL-FIRST post-incident) - the scoping
 * gate that decides what KIND of artifact a build request produces, and therefore which internal
 * base scaffolds it and whether the operator assistant surface exists at all (only `app`).
 *
 * INCIDENT (2026-08-08): a request for "um site que fale da aplicação de cobranças do ekoa" (a
 * WEBSITE) built a slide deck. Root cause chain: the deterministic regex table ran FIRST and (a)
 * had no site/website/página web signal at all, and (b) fired `presentation` on bare
 * "apresentação" - which in Portuguese also means "showcase/introduce", not just "slide deck" -
 * before the request ever reached the model. Fix: MODEL FIRST on every non-empty request, given a
 * labelled type table + worked examples + explicit disambiguation rules (site-is-never-slides,
 * manage-vs-produce), returning `{type, reason}` - the reason is logged so a future misroute is
 * self-diagnosing instead of leaving no trace. The regex table survives ONLY as the offline/
 * failure fallback (model call throws, or returns something unparseable/invalid), fixed for both
 * incident bugs. ANY failure - model or fallback - still lands on `app`, the platform default.
 * Never throws.
 *
 * NO permission logic lives here (the security block wires the same output into its gate later;
 * sequencing rule).
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
 * (NEAR_BEFORE / NEAR_AFTER below). Unanchored it deliberately falls through (to the model
 * on the primary path; to `app` on the fallback path, whose prompt/table both answer `app`
 * when in doubt) - this matters because this type decides whether the operator assistant
 * surface exists at all (see the module header), so a false `document` silently strips that
 * surface from an app build. Pinned in tests/apps/artifact-type.test.ts by a misroute guard
 * carrying the real CRM/kanban/inventário/tickets/morada phrasings - do NOT unanchor any of
 * these.
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

/**
 * OFFLINE/FAILURE FALLBACK ONLY - consulted when the model call throws or returns something
 * unparseable/invalid (see `classifyArtifactType`). The word lists are PT-PT-first (the product
 * surface) with EN fallbacks. Checked in order; the EARLIEST match position in the string wins
 * (ties broken by table order) - see `fallbackClassify`.
 *
 * Both incident bugs fixed here:
 *   1. `landing` now matches site/website/página web (previously matched NOTHING - the incident's
 *      "um site que fale da aplicação de cobranças" fell straight through to no-signal → whatever
 *      the (then regex-first) pipeline guessed).
 *   2. `presentation` now requires a real DECK anchor (slides/deck/diapositivos/"apresentação de
 *      slides") instead of firing on bare "apresenta[çc][ãa]o" - which in Portuguese also means
 *      "showcase/introduce" ("site de apresentação da empresa" is a WEBSITE, not slides).
 *
 * Deliberate behaviour change from this fix: "Uma apresentação sobre o novo regime fiscal" no
 * longer deterministically matches `presentation` in the FALLBACK table (it has no deck anchor -
 * bare "apresentação" is exactly the ambiguous case above). On the PRIMARY (model) path this
 * phrase still classifies as `presentation` - worked example in CLASSIFY_SYSTEM below, since
 * "apresentação sobre X" in PT-PT business register overwhelmingly means "make/give slides for
 * X". Only the rare offline/model-failure path now answers the safer `app` default for this
 * phrasing instead of guessing - consistent with "in doubt → app".
 */
const SIGNALS: Array<{ type: ArtifactType; rx: RegExp }> = [
  { type: 'presentation', rx: /\b(slides?|diapositivos?|decks?|pitch ?deck|apresenta[çc][ãa]o de slides)\b/i },
  { type: 'landing', rx: /\b(landing|websites?|sites?|p[áa]gina web|p[áa]gina de (marketing|captura|vendas)|site promocional|one[- ]?pager|static (page|site)|p[áa]gina est[áa]tica|site est[áa]tico)\b/i },
  { type: 'report', rx: /\b(relat[óo]rio|report)\b/i },
  { type: 'document', rx: new RegExp(`\\b(documento|contrato|parecer|minuta|carta|of[íi]cio|acordo|procura[çc][ãa]o|peti[çc][ãa]o|requerimento|flyer|folheto|impress[ãa]o|imprim[íi]vel|word|pdf|${DOC_REVIEW_SIGNALS})\\b`, 'i') },
  { type: 'app', rx: /\b(app|aplica[çc][ãa]o|gestor|gest[ãa]o|dashboard|painel|calculadora|formul[áa]rio|lista de|tracker|crm|kanban|agenda)\b/i },
];

/**
 * Model-first classification prompt (incident fix): a labelled five-type table, explicit
 * disambiguation rules (site-is-never-slides; manage-vs-produce), and worked examples including
 * the exact incident phrasing. The model returns BOTH a type and a `reason` - the reason is
 * logged by the caller so a future misroute leaves a trace instead of none. Structurally mirrors
 * ekoa-dev's SELECT_BASE_TEMPLATE_SYSTEM (cortex/src/services/orchestrator.ts) and the
 * base-selector SKILL.md worked-examples table, adapted to this repo's five-type model
 * (shared/src/artifact-type.ts: app|document|report|presentation|landing).
 */
const CLASSIFY_SYSTEM = `Classifica um pedido de construção no tipo de artefacto correto. Responde APENAS com um objeto JSON - nada de markdown, nada de comentário: {"type": "<um dos cinco>", "reason": "<uma frase curta em português a explicar a escolha>"}.

Tipos (enumeração fechada, nunca inventes outro):
  app          - aplicação interativa (dados, formulários, dashboards, CRMs, gestores de processos, calculadoras). PREDEFINIÇÃO em caso de dúvida genuína.
  document     - o entregável É um único documento para descarregar em Word/PDF (contrato, parecer, minuta, carta, proposta), OU a revisão/redline de um documento Word/PDF existente que o utilizador anexou.
  report       - um relatório (relatório mensal, relatório de atividade, relatório de honorários).
  presentation - um DECK DE SLIDES para apresentar/projetar (pitch deck, apresentação de slides, diapositivos).
  landing      - uma PÁGINA WEB de marketing/institucional de uma só página: site, website, página web, landing page, página de vendas ou captura, one-pager.

Regras de desambiguação (nesta ordem):
1. GUARDIÃO SITE/WEBSITE: um pedido de "site", "website" ou "página web" é SEMPRE landing, nunca presentation - mesmo que o pedido use a palavra "apresentação" ("um site de apresentação da empresa" = landing: aqui "apresentação" significa mostrar/exibir a empresa, não um deck de slides).
2. presentation só quando o pedido pede explicitamente slides, deck, diapositivos, ou "apresentação" no sentido de apresentação DE SLIDES (uma apresentação para uma reunião, um pitch, algo para "projetar" ou "passar slide a slide"). Fora desse sentido, "apresentação" não decide sozinho.
3. GERIR vs PRODUZIR: uma app para GERIR, armazenar ou acompanhar documentos/contratos/processos (uma "CRM de contratos", "gestor de processos", "app para gerir os contratos do escritório") é app, NUNCA document - document é só quando o entregável É um único documento.
4. Vocabulário de revisão ("registo de alterações", "track changes", "redline", "marcas de revisão") só conta como document quando está ANCORADO a um documento/Word/anexo concreto na mesma frase - sozinho é uma funcionalidade de app (um histórico/log), não um documento.
5. Em caso de dúvida genuína → app.

Exemplos:
| Pedido | Tipo | Porquê |
|---|---|---|
| "um site que fale da aplicação de cobranças do ekoa" | landing | pede um SITE institucional - regra 1 |
| "site de apresentação da empresa" | landing | é um SITE; "apresentação" = mostrar a empresa, não slides - regra 1 |
| "quero uma apresentação sobre o novo regime fiscal" | presentation | "apresentação sobre X" no registo de negócio PT-PT = preparar slides - regra 2 |
| "faz-me um pitch deck para a ronda seed" | presentation | deck explícito |
| "gestor de contratos com alertas de prazo" | app | GERE contratos, não é um documento - regra 3 |
| "quero uma app para gerir os contratos do escritório" | app | gerir, não produzir - regra 3 |
| "revê este contrato em anexo com registo de alterações" | document | revisão ancorada a um documento/anexo concreto |
| "quero registo de alterações no meu CRM" | app | "registo de alterações" aqui é um histórico de app, não um documento - regra 4 |
| "landing page para a clínica" | landing | landing page explícita |
| "relatório mensal de honorários" | report | relatório |

Responde SÓ com o JSON.`;

export interface ClassifyDeps {
  /** Injected for tests; defaults to the chokepoint one-shot. */
  oneShot?: (prompt: string, billeeUserId: string) => Promise<string>;
}

export interface ClassifyOpts {
  /** Attachment filenames (DO #4): a .docx/.pdf dropped in for review is one of the strongest
   *  document-base signals there is, and it is not in the description text (which may be just
   *  "revê isto"). Fed to the model as a plain line; never influences the fallback regex table
   *  directly (kept deterministic there). */
  attachments?: string[];
}

/** The classifier's verdict, WITH the reason so callers can log/persist it (incident fix: a
 *  misroute used to leave no trace at all). */
export interface ClassifyResult {
  type: ArtifactType;
  reason: string;
}

async function defaultOneShot(prompt: string, billeeUserId: string): Promise<string> {
  const res = await runOneShot(
    { prompt, decision: decideForTier('FAST'), systemPrompt: CLASSIFY_SYSTEM },
    { kind: 'classifier', agentType: 'select-base-template', billeeUserId },
  );
  return res.text;
}

/** Tolerant JSON parse (strips ``` fences the model sometimes wraps output in) + type
 *  validation. Returns null on anything unusable - the caller falls back to the regex table. */
function parseClassifyJson(raw: string): ClassifyResult | null {
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```\s*$/g, '').trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const parsedType = ArtifactType.safeParse((obj as Record<string, unknown>).type);
  if (!parsedType.success) return null;
  const rawReason = (obj as Record<string, unknown>).reason;
  const reason = typeof rawReason === 'string' && rawReason.trim() ? rawReason.trim().slice(0, 300) : 'model classification (no reason given)';
  return { type: parsedType.data, reason };
}

/** Deterministic OFFLINE/FAILURE fallback (see the SIGNALS doc comment above). EARLIEST match
 *  position in the string wins, not table order - ties fall back to table order. */
function fallbackClassify(description: string): ClassifyResult {
  let best: { type: ArtifactType; index: number } | null = null;
  for (const s of SIGNALS) {
    const m = s.rx.exec(description);
    if (m && (best === null || m.index < best.index)) {
      best = { type: s.type, index: m.index };
    }
  }
  if (best) return { type: best.type, reason: `offline fallback: matched deterministic "${best.type}" signal` };
  return { type: 'app', reason: 'offline fallback: no deterministic signal matched - platform default' };
}

/**
 * Classify a build description. MODEL FIRST on every non-empty request (FAST tier one-shot,
 * labelled type table + worked examples, returns `{type, reason}` - logged here so a misroute is
 * self-diagnosing). The deterministic regex table is consulted ONLY when the model call throws,
 * or returns something unparseable/invalid. Never throws; any failure ultimately lands on `app`.
 */
export async function classifyArtifactType(
  description: string,
  billeeUserId: string,
  deps: ClassifyDeps = {},
  opts: ClassifyOpts = {},
): Promise<ClassifyResult> {
  if (!description.trim()) return { type: 'app', reason: 'empty request - platform default' }; // codex C1
  try {
    const attachmentLine = opts.attachments && opts.attachments.length > 0
      ? `\n\nAnexos: ${opts.attachments.join(', ')}`
      : '';
    const raw = await (deps.oneShot ?? defaultOneShot)(`${description}${attachmentLine}`, billeeUserId);
    const parsed = parseClassifyJson(raw);
    if (parsed) {
      console.log(`[artifact-type] model classified "${description.slice(0, 60)}" -> ${parsed.type} (${parsed.reason})`);
      return parsed;
    }
    console.warn(`[artifact-type] classifier returned unparseable "${raw.slice(0, 80)}"; falling back to signals`);
  } catch (err) {
    console.warn('[artifact-type] classifier one-shot failed (non-fatal); falling back to signals:', err instanceof Error ? err.message : err);
  }
  const fallback = fallbackClassify(description);
  console.log(`[artifact-type] fallback classified "${description.slice(0, 60)}" -> ${fallback.type} (${fallback.reason})`);
  return fallback;
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
