/**
 * Served-app assistant — pure logic (operator-run D1).
 *
 * The brain behind `POST /api/app-assistant`: given a visitor's message, the resolved artifact
 * OWNER, and the app's declared action manifest, it produces the assistant's reply, the knowledge
 * citations it drew on, the app-actions it wants the in-page runtime (C3) to execute, and the mode
 * it operated in. It is HTTP-free and model-transport-free: the chokepoint one-shot, the knowledge
 * grounding builder, and the routing decision are all INJECTED (`AppAssistantDeps`), so it unit-
 * tests with a canned model and no live egress. The route (app-assistant-route.ts) binds the real
 * deps — `runOneShot` / `buildGroundingBlock` / `decideForTask` — behind the llm/ + knowledge/
 * public entries, so the assistant's only model egress stays the llm/ chokepoint (FIXED-3).
 *
 * Load-bearing invariants:
 *  - The org is ALWAYS the resolved owner's org (`input.owner.orgId`) — never anything the
 *    anonymous visitor supplied. Grounding is org-partitioned by that org; the caller cannot steer
 *    it (the served-app "orgId from the resolved subject, not from arguments" rule).
 *  - Billing is `assistant-chat` (a UserWorkAgentType) billed to the artifact OWNER + artifactId —
 *    never the anonymous visitor.
 *  - The assistant PROPOSES actions; it never executes them. Requested actions are validated
 *    against the manifest's tool names and unknown ones are dropped, so the endpoint can only ever
 *    ask the client to run an action the app actually declared.
 *  - No permission / auth-decision logic here (the security block gates capability later; admission
 *    = owner activation, enforced at the route).
 */
import type {
  AppAction,
  AppActionManifest,
  AssistantChatMessage,
  AssistantChatMode,
  AssistantCitation,
  AssistantAction,
} from '@ekoa/shared';
import { assistantToolsFromManifest, type AssistantToolDef } from './assistant-tools.js';
import type { OneShotOptions, OneShotResult, LlmAttribution, RouterDecision } from '../llm/index.js';
import type { GroundingInput, GroundingResult } from '../knowledge/index.js';

export interface AppAssistantOwner {
  /** The artifact owner — who the assistant runs as and who is billed. */
  userId: string;
  /** The owner's org — the ONLY org the assistant ever grounds under (server-resolved). */
  orgId: string;
}

export interface AppAssistantInput {
  message: string;
  history?: AssistantChatMessage[];
  /** Client-pinned mode; when absent it is inferred from the message and echoed back. */
  mode?: AssistantChatMode;
  /** The panel's current screen state (route + prior action results). Never carries an org. */
  context?: { route?: string; actionResults?: unknown[] };
  owner: AppAssistantOwner;
  artifactId: string;
  /** The app's validated UI action manifest, or null for an app with no operate surface. */
  actionManifest: AppActionManifest | null;
}

export interface AppAssistantDeps {
  /** The chokepoint one-shot (llm/ `runOneShot` in prod) — the assistant's ONLY model egress. */
  oneShot: (opts: OneShotOptions, attribution: LlmAttribution) => Promise<OneShotResult>;
  /** The org-partitioned knowledge grounding builder (`buildGroundingBlock` in prod). Pure. */
  ground: (input: GroundingInput) => GroundingResult;
  /** The routing decision for a message (`decideForTask` floored at WORKHORSE in prod). */
  decide: (message: string) => RouterDecision;
}

export interface AppAssistantResult {
  reply: string;
  mode: AssistantChatMode;
  citations: AssistantCitation[];
  actions: AssistantAction[];
}

/** Fold to a lowercase, accent-stripped form for keyword matching (matches grounding.ts's fold so
 *  PT-PT accents never hide a keyword). */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Teach-mode cues (folded, accent-insensitive): the visitor wants to be taught / walked through. */
const TEACH_KEYWORDS = [
  // 'como ' is the PT-PT how-to signal (covers "como funciona", "como criar", "como usar", …); a
  // trailing space keeps it from matching inside unrelated words.
  'tutorial', 'ensina', 'ensinar', 'explica', 'explicar', 'como ',
  'passo a passo', 'aprender', 'guia de', 'ensino',
];
/** Show-mode cues (folded): the visitor wants an overview / to be shown around. */
const SHOW_KEYWORDS = [
  'mostre', 'mostra', 'mostrar', 'visao geral', 'vista geral', 'panorama', 'apresenta',
  'apresentar', 'resumo geral', 'o que faz esta', 'o que e que esta',
];

/**
 * Deterministic PT-PT mode classifier (no model call). Teach cues win over show cues (a "mostra-me
 * como criar" is a walkthrough, not an overview); everything else — including bare imperative task
 * verbs ("cria", "adiciona", "envia") — defaults to 'do', the operate mode.
 */
export function inferMode(message: string): AssistantChatMode {
  const f = fold(message);
  if (TEACH_KEYWORDS.some((k) => f.includes(k))) return 'teach';
  if (SHOW_KEYWORDS.some((k) => f.includes(k))) return 'show';
  return 'do';
}

const MODE_INSTRUCTION: Record<AssistantChatMode, string> = {
  do: 'O utilizador quer executar uma tarefa. Quando fizer sentido, pede à aplicação para executar as ações necessárias (ver o protocolo de ações abaixo) e confirma em prosa o que foi feito.',
  show: 'O utilizador quer uma visão geral. Descreve o que a aplicação faz e o que está visível no ecrã atual, sem executar ações destrutivas.',
  teach: 'O utilizador quer aprender. Explica passo a passo, como um tutorial, sem executar ações em nome do utilizador a menos que ele peça explicitamente.',
};

/** One readable line per available action for the system prompt (name, description, destructive
 *  marker, and its parameters with PT-PT labels). */
function describeTool(tool: AssistantToolDef): string {
  const params = tool.action.params
    .map((p) => `${p.name}${p.required ? ' (obrigatório)' : ''}${p.labelPt ? ` — ${p.labelPt}` : ''}`)
    .join(', ');
  const parts = [`- ${tool.name}: ${tool.description}`];
  if (tool.destructive) parts.push('[AÇÃO DESTRUTIVA — a aplicação pede confirmação antes de executar]');
  if (params) parts.push(`Parâmetros: ${params}.`);
  return parts.join(' ');
}

/** Build the assistant system prompt: the three capabilities, the active mode, PT-PT + cite-your-
 *  source discipline, the callable app-actions, the structured-actions protocol, and the current
 *  screen context. The grounding block (already formatted) rides at the end. */
function buildSystemPrompt(
  mode: AssistantChatMode,
  tools: AssistantToolDef[],
  groundingBlock: string,
  context: AppAssistantInput['context'],
): string {
  const sections: string[] = [];

  sections.push(
    'És o assistente desta aplicação, ao serviço do utilizador que a está a usar. Tens três capacidades:\n' +
      '1. OPERAR a aplicação pelo utilizador — executar tarefas através das ações disponíveis (modo "do").\n' +
      '2. APRESENTAR — dar uma visão geral do que a aplicação faz e do ecrã atual (modo "show").\n' +
      '3. ENSINAR — explicar passo a passo como usar a aplicação, como um tutorial (modo "teach").',
  );

  sections.push(`Estás no modo "${mode}". ${MODE_INSTRUCTION[mode]}`);

  sections.push(
    'Responde SEMPRE em português de Portugal (PT-PT), de forma clara e objetiva.',
  );

  sections.push(
    'CONHECIMENTO: usa apenas os excertos fornecidos no bloco CONHECIMENTO abaixo (quando existir) e ' +
      'cita a fonte que usaste. Nunca inventes factos nem fontes. Se não houver conhecimento relevante, ' +
      'responde apenas com o que sabes sobre a própria aplicação, sem citar.',
  );

  if (tools.length > 0) {
    sections.push(
      'AÇÕES DA APLICAÇÃO — podes pedir à aplicação para executar estas ações em nome do utilizador:\n' +
        tools.map(describeTool).join('\n') +
        '\n\nPara pedir a execução de uma ou mais ações, inclui na tua resposta UM bloco delimitado ' +
        'exatamente assim:\n```ekoa-actions\n[{"toolName":"<nome-da-ação>","input":{ ... }}]\n```\n' +
        'O bloco tem de ser um array JSON válido e usar APENAS os nomes de ações listados acima. A ' +
        'aplicação é que executa as ações — tu nunca as executas diretamente. Escreve sempre também ' +
        'uma resposta em prosa para o utilizador (o bloco é removido antes de lhe ser mostrado).',
    );
  } else {
    sections.push(
      'Esta aplicação não declara ações operáveis: podes apresentar e ensinar, mas não podes operar a ' +
        'aplicação pelo utilizador.',
    );
  }

  if (context?.route) {
    sections.push(`O utilizador está atualmente na rota "${context.route}" da aplicação.`);
  }
  if (context?.actionResults && context.actionResults.length > 0) {
    sections.push('Existem resultados de ações anteriores no contexto desta sessão.');
  }

  if (groundingBlock.trim()) sections.push(groundingBlock.trim());

  return sections.join('\n\n');
}

/** Render the conversation history + current message into the single one-shot prompt string. */
function renderPrompt(history: AssistantChatMessage[] | undefined, message: string): string {
  if (!history || history.length === 0) return message;
  const transcript = history
    .map((t) => `<turn role="${t.role}">\n${t.content}\n</turn>`)
    .join('\n');
  return `<conversation>\n${transcript}\n</conversation>\n\n${message}`;
}

/** A fresh matcher each call (the /g flag is stateful — never share the literal across calls). */
function actionsFence(): RegExp {
  return /```ekoa-actions[^\n]*\n([\s\S]*?)```/g;
}

/**
 * Pull every `ekoa-actions` fenced block out of the model reply: parse each as a JSON array of
 * `{ toolName, input }`, keep only actions whose toolName is a REAL manifest tool (unknown names
 * dropped — the endpoint can only ask the client to run a declared action), attach the SERVER's
 * copy of that action's manifest AppAction (so the C3 runtime can execute without the manifest,
 * which is not injected into the served page), and strip the blocks from the user-facing prose. A
 * malformed block is skipped (still stripped) — never surfaced raw.
 */
export function extractActions(
  reply: string,
  toolsByName: ReadonlyMap<string, AppAction>,
): { text: string; actions: AssistantAction[] } {
  const actions: AssistantAction[] = [];
  const scan = actionsFence();
  let m: RegExpExecArray | null;
  while ((m = scan.exec(reply)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse((m[1] ?? '').trim());
    } catch {
      continue; // malformed block — drop it (it is stripped from the prose below regardless)
    }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const toolName = (item as { toolName?: unknown }).toolName;
      if (typeof toolName !== 'string') continue;
      const action = toolsByName.get(toolName);
      if (!action) continue; // unknown tool -> drop (the app never declared it)
      const rawInput = (item as { input?: unknown }).input;
      const input =
        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : {};
      // The fenced path honours the SAME param contract the SDK tool schema enforces
      // (`additionalProperties: false` in assistant-tools): keep ONLY the params the
      // manifest declares for this action. Undeclared keys from the model are dropped,
      // never forwarded to the runtime — for `custom` actions they would otherwise
      // reach app code verbatim.
      const declared = new Set(action.params.map((p) => p.name));
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (declared.has(key)) filtered[key] = value;
      }
      // Attach the server-authoritative manifest action; the client dispatches
      // `execute({ ...action, params: input })` (values override the param definitions).
      actions.push({ toolName, input: filtered, action });
    }
  }
  const text = reply.replace(actionsFence(), '').trim();
  return { text, actions };
}

/**
 * Run the served-app assistant for one turn. Grounds under the OWNER's org, calls the model once
 * through the injected chokepoint one-shot billed to the owner, and returns the prose reply (with
 * any actions block stripped), the inferred/pinned mode, the knowledge citations, and the validated
 * app-actions the client runtime should execute.
 */
export async function runAppAssistant(
  input: AppAssistantInput,
  deps: AppAssistantDeps,
): Promise<AppAssistantResult> {
  const mode: AssistantChatMode = input.mode ?? inferMode(input.message);
  const tools = assistantToolsFromManifest(input.actionManifest);
  // toolName -> the manifest AppAction. The value validates + names the tool AND carries the
  // server-authoritative executable shape that D1 attaches to each proposed action.
  const toolsByName = new Map(tools.map((t) => [t.name, t.action] as const));

  // Grounding ALWAYS under the resolved owner's org (never a caller-supplied org); kind:'chat'
  // grounds unconditionally and is cited-or-silent.
  const grounding = deps.ground({ orgId: input.owner.orgId, query: input.message, kind: 'chat' });
  const citations: AssistantCitation[] = grounding.hits.map((h) => ({
    collection: h.collection,
    docId: h.docId,
    title: h.title,
  }));

  const systemPrompt = buildSystemPrompt(mode, tools, grounding.block, input.context);
  const prompt = renderPrompt(input.history, input.message);
  const decision = deps.decide(input.message);

  // assistant-chat is a UserWorkAgentType — billed to the ARTIFACT OWNER + artifactId, never the
  // anonymous visitor.
  const attribution: LlmAttribution = {
    kind: 'user_work',
    agentType: 'assistant-chat',
    billeeUserId: input.owner.userId,
    artifactId: input.artifactId,
  };

  const res = await deps.oneShot({ prompt, systemPrompt, decision }, attribution);
  const { text, actions } = extractActions(res.text, toolsByName);

  return { reply: text, mode, citations, actions };
}
