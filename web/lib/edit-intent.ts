/**
 * Continue-vs-new classification (Part B bound decision B.D, run 20260717-190134): a LOCAL,
 * deliberately dumb heuristic - imperative edit verbs (PT/EN) near the start of the message
 * with no new-subject marker keep/set the composer chip on the most recent sheet; explicit
 * new-topic markers clear it. Pure and synchronous so the chip state is set BEFORE/AS the
 * message sends (zero latency). Wrong defaults are tolerable BY DESIGN: the chip is visible
 * and overridable (locked decision 6) - do not gold-plate this into a model call.
 */

export type EditIntent = 'edit' | 'new' | 'neutral';

/** Explicit new-subject markers (PT/EN): the user is changing topic - clear the chip. */
const NEW_TOPIC = new RegExp(
  '\\b(' +
    [
      'novo tema',
      'novo assunto',
      'nova pergunta',
      'nova quest[aã]o',
      'outra coisa',
      'outro assunto',
      'outra pergunta',
      'outro tema',
      'muda(?:ndo|mos)? de (?:assunto|tema)',
      'esquece (?:isso|o anterior|a folha)',
      'nova folha',
      'novo documento',
      'new topic',
      'new subject',
      'new question',
      'different topic',
      'something else',
      'unrelated',
      'forget (?:that|it|the previous)',
      'new sheet',
      'new document',
      'start over',
    ].join('|') +
    ')\\b',
  'i',
);

/** Imperative edit verbs (PT/EN), matched near the start of the message. The PT forms cover
 *  the imperative/present 2nd-3rd person ("muda", "torna", "reescreve") plus enclitic
 *  pronouns ("torna-o", "encurta-a") via the \\b boundary. */
const EDIT_VERBS = [
  // PT
  'muda',
  'altera',
  'torna',
  'ajusta',
  'corrige',
  'encurta',
  'alonga',
  'resume',
  'reescreve',
  'reformula',
  'refaz',
  'traduz',
  'simplifica',
  'expande',
  'desenvolve',
  'melhora',
  'remove',
  'retira',
  'tira',
  'acrescenta',
  'adiciona',
  'substitui',
  'troca',
  'formata',
  'reduz',
  'amplia',
  'clarifica',
  'rev[eê]',
  // EN ("make it ..." not bare "make": "make a dashboard" is a NEW request, "make it
  // shorter" is an edit)
  'change',
  'edit',
  'make (?:it|this|that|the)',
  'rewrite',
  'rephrase',
  'reword',
  'shorten',
  'lengthen',
  'summari[sz]e',
  'expand',
  'fix',
  'adjust',
  'translate',
  'simplify',
  'improve',
  'remove',
  'add',
  'replace',
  'swap',
  'tweak',
  'revise',
  'update',
  'polish',
  'trim',
  'condense',
];

/** Leading fillers tolerated before the verb ("e agora torna...", "ok, encurta..."). */
const LEAD_IN = '(?:(?:e|ok|sim|ent[aã]o|agora|por favor|please|now|and|também|tambem)[,\\s]+){0,3}';

const EDIT_START = new RegExp(`^${LEAD_IN}(?:${EDIT_VERBS.join('|')})\\b`, 'i');

/**
 * Classify one outgoing message. 'edit' -> keep/set the chip on the most recent sheet;
 * 'new' -> clear the chip; 'neutral' -> leave the chip exactly as it is (manual state wins).
 */
export function classifyEditIntent(message: string): EditIntent {
  const text = message.trim();
  if (!text) return 'neutral';
  if (NEW_TOPIC.test(text)) return 'new';
  if (EDIT_START.test(text)) return 'edit';
  return 'neutral';
}
