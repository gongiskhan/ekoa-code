/**
 * Local template inference — keyword scoring against template metadata.
 *
 * Runs synchronously in the frontend as an immediate pre-selection before
 * the async Haiku inference completes, and as a fallback when Haiku returns null.
 *
 * Scoring: term overlap between message tokens and template search corpus
 * (name, namePt, description, descriptionPt, keywords, outputKind), with
 * type-signal bonuses for unambiguous intent words (e.g. "bot" → agent_app).
 */

import type { TemplateData as Template } from '@/types/template';

// ============================================================================
// Constants
// ============================================================================

const PT_EN_STOPWORDS = new Set([
  'a', 'e', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos',
  'em', 'na', 'no', 'nas', 'nos', 'um', 'uma', 'uns', 'umas',
  'para', 'por', 'com', 'que', 'se', 'me', 'te', 'nos', 'lhe',
  'ao', 'aos', 'à', 'às', 'meu', 'minha', 'meus', 'minhas',
  'sobre', 'ser', 'ter', 'fazer', 'quero', 'queria', 'preciso',
  'the', 'a', 'an', 'of', 'in', 'to', 'for', 'and', 'or', 'is',
  'my', 'me', 'i', 'want', 'need', 'make', 'build', 'create',
]);

// Signal words that strongly indicate agent_app type
const AGENT_SIGNALS = new Set([
  'bot', 'bots', 'assistente', 'assistentes', 'agente', 'agentes',
  'chat', 'chatbot', 'chatbots', 'conversar', 'conversa', 'falar',
  'perguntar', 'responder', 'ia', 'ai', 'assistant', 'agent',
  'inteligencia', 'artificial',
]);

// Signal words that strongly indicate dashboard/analytics type
const DASHBOARD_SIGNALS = new Set([
  'dashboard', 'metrica', 'metricas', 'analitica', 'analytics',
  'grafico', 'graficos', 'kpi', 'kpis', 'relatorio', 'indicador',
  'monitoramento', 'monitoring',
]);

// Signal words that strongly indicate landing_page type
const LANDING_SIGNALS = new Set([
  'landing', 'marketing', 'promocional', 'showcase', 'portfolio',
  'empresa', 'corporativo', 'institucional',
]);

const TYPE_SIGNALS: Record<string, Set<string>> = {
  agent_app: AGENT_SIGNALS,
  web_app: DASHBOARD_SIGNALS,
  landing_page: LANDING_SIGNALS,
};

const TYPE_SIGNAL_BONUS = 3;

// ============================================================================
// Core logic
// ============================================================================

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toTokenSet(normalizedText: string): Set<string> {
  return new Set(
    normalizedText
      .split(/\W+/)
      .filter((w) => w.length > 2 && !PT_EN_STOPWORDS.has(w)),
  );
}

function buildCorpus(t: Template): string {
  return [t.name, t.namePt, t.description, t.descriptionPt, ...(t.keywords ?? []), t.outputKind]
    .filter(Boolean)
    .join(' ');
}

/**
 * Infer the best-matching template for a user message using local keyword scoring.
 * Returns the template ID with the highest score, or null if no confident match.
 */
export function inferTemplateLocally(message: string, templates: Template[]): string | null {
  if (!message || templates.length === 0) return null;

  const msgNorm = normalize(message);
  const msgTokens = toTokenSet(msgNorm);

  let bestId: string | null = null;
  let bestScore = 0;

  for (const t of templates) {
    if (!t.enabled) continue;

    const corpusNorm = normalize(buildCorpus(t));
    const corpusTokens = toTokenSet(corpusNorm);

    let score = 0;
    for (const token of msgTokens) {
      if (corpusTokens.has(token)) score++;
    }

    const signals = TYPE_SIGNALS[t.outputKind];
    if (signals) {
      for (const sig of signals) {
        if (msgNorm.includes(sig)) score += TYPE_SIGNAL_BONUS;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = t.id;
    }
  }

  return bestId;
}
