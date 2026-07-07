/**
 * Conversation Types and Local Intent Classification
 *
 * Types and local keyword-based fallback for intent classification.
 * Used by the chat page to route conversations to the correct mode.
 */

// ============================================
// TYPES
// ============================================

export type ConversationMode = 'chat' | 'build' | 'integrate' | 'branding' | 'configure';

export interface IntentClassification {
  intent: ConversationMode;
  confidence: number;
  questions: InterviewQuestion[];
  routingContext: {
    summary: string;
    sidePanel: 'build' | 'integrate' | 'branding' | 'none';
  };
}

export interface InterviewQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'multiselect' | 'checkbox';
  options: string[] | null;
}

export interface InterviewAnswer {
  questionId: string;
  label: string;
  value: string | string[] | boolean;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ============================================
// LOCAL FALLBACK (signal-based scoring)
// ============================================

// --- Build intent detection ---
// Two-list scoring: creation/desire verbs (A) + app-type nouns (B).
// A+B → 0.95 confidence, B-only → 0.85, A-only → 0.6 (not enough to switch).
// Negative signals suppress false positives ("quero saber o que é um bot" → chat).

const BUILD_VERBS = [
  // English
  'build', 'create', 'make', 'want', 'need', "i'd like", 'i would like',
  'develop', 'set up', 'put together',
  // Portuguese (PT-PT) — includes colloquial / informal
  'quero', 'preciso', 'criar', 'construir', 'fazer', 'montar', 'desenvolver',
  'faz-me', 'faz me', 'cria-me', 'cria me', 'dá-me', 'da-me',
  'precisava', 'gostava de', 'queria',
  'pa meter', 'pôr no', 'para o meu', 'meter no',
];

const BUILD_NOUNS = [
  // English
  'app', 'application', 'website', 'site', 'dashboard', 'landing page',
  'page', 'tool', 'assistant', 'bot', 'chatbot', 'portal', 'system',
  'platform', 'interface', 'widget', 'form',
  // Portuguese (PT-PT) — includes common misspellings
  'aplicação', 'aplicacao', 'assistente', 'sítio', 'sitio', 'saite',
  'página', 'pagina', 'painel', 'ferramenta', 'sistema', 'plataforma',
  'formulário', 'formulario',
];

const BUILD_NEGATIVE = [
  // English — information-seeking qualifiers
  'what is', 'what are', 'explain', 'how does', 'how do', 'tell me about',
  'define', 'meaning of', 'difference between',
  // Portuguese (PT-PT)
  'o que é', 'o que são', 'explica', 'como funciona', 'como é que',
  'quero saber', 'diz-me o que', 'o que significa',
];

function scoreBuildIntent(text: string): number {
  const hasNegative = BUILD_NEGATIVE.some((neg) => text.includes(neg));
  if (hasNegative) return 0;

  const hasVerb = BUILD_VERBS.some((v) => text.includes(v));
  const hasNoun = BUILD_NOUNS.some((n) => text.includes(n));

  if (hasVerb && hasNoun) return 0.95;
  if (hasNoun) return 0.85;
  if (hasVerb) return 0.6;
  return 0;
}

// --- Other intent patterns (integrate, branding) ---

const OTHER_PATTERNS: Array<{
  intent: ConversationMode;
  keywords: string[];
  confidence: number;
  sidePanel: IntentClassification['routingContext']['sidePanel'];
}> = [
  {
    intent: 'integrate',
    keywords: [
      // English
      'integrate', 'connect', 'integration', 'api', 'webhook', 'sync',
      // Portuguese (PT-PT)
      'integrar', 'ligar', 'integração',
    ],
    confidence: 0.85,
    sidePanel: 'integrate',
  },
  {
    intent: 'branding',
    keywords: [
      // English
      'brand', 'logo', 'branding', 'identity', 'color palette', 'typography', 'visual identity',
      // Portuguese (PT-PT)
      'marca', 'logótipo', 'identidade', 'cores', 'tipografia',
    ],
    confidence: 0.8,
    sidePanel: 'branding',
  },
];

export function classifyLocalFallback(messages: ChatMessageInput[]): IntentClassification {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const text = (lastUserMsg?.content || '').toLowerCase();

  // 1. Signal-based build scoring (two-list approach)
  const buildScore = scoreBuildIntent(text);
  if (buildScore >= 0.85) {
    return {
      intent: 'build',
      confidence: buildScore,
      questions: [],
      routingContext: {
        summary: 'Build intent detected via signal scoring.',
        sidePanel: 'build',
      },
    };
  }

  // 2. Keyword matching for other intents (integrate, branding)
  for (const pattern of OTHER_PATTERNS) {
    const match = pattern.keywords.some((kw) => text.includes(kw));
    if (match) {
      return {
        intent: pattern.intent,
        confidence: pattern.confidence,
        questions: [],
        routingContext: {
          summary: `Local fallback detected ${pattern.intent} intent.`,
          sidePanel: pattern.sidePanel,
        },
      };
    }
  }

  return {
    intent: 'chat',
    confidence: 0.5,
    questions: [],
    routingContext: {
      summary: 'General conversation, no specific intent detected.',
      sidePanel: 'none',
    },
  };
}
