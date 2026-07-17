/**
 * Context assembly (ch05 §5.5). `agents/` assembles the full context for every run from four
 * sources: the content loader (ch08 `assembleAgentContext`, an injected seam), then the five
 * grounding layers composed in order on top of the loader output (§5.5.2). The chokepoint takes
 * a single system prompt + prompt, so the assembled sections are joined into the system prompt
 * and the structured conversation history is conveyed as a delimited transcript block (never
 * inlined-and-clipped: full history, no truncation of pasted material — §5.5.2 item 5).
 */
import type { Actor } from '@ekoa/shared';
import { messages as messagesStore, sessions as sessionsStore, type SessionSheetDoc } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import { listSessionSheets } from '../data/session-sheets.js';
import { resolveMemoryInjectionDetailed } from '../memory/resolver.js';
import { assembleAgentContext, knowledgeGrounding, integrationPrefetch, catalog } from './seams.js';
import { looksLikeProviderError } from './markers.js';

export interface AssembledContext {
  systemPrompt: string;
  contextDir: string;
  contentVersion: string;
  /** Ordered structured history turns (provider-error turns filtered, tail-window deduped). */
  history: Array<{ role: string; content: string }>;
  /** How many memories layer 1 injected - persisted as assistant-message provenance (B1). */
  memoriesUsed: number;
}

interface AssembleInput {
  actor: Actor;
  agentKind: 'coding' | 'chat' | 'automation';
  /** The user's message / build request — drives memory overlap + knowledge grounding + prefetch. */
  query: string;
  sessionId?: string;
  /** chat runs opt into layer 3 (live integration pre-fetch). */
  isChat: boolean;
  /** builds ground knowledge only when the legal-context detector matches (§5.5.2 layer 2). */
  groundKnowledge: boolean;
  optOutMemory?: boolean;
  now: () => number;
}

const TAIL_DEDUP_WINDOW = 3;

/**
 * The latest-revision-canonical rule (Part B decision B.B / locked decision 7): in model-bound
 * history, a turn that spawned a sheet is represented by that sheet's LATEST revision. The
 * substitution happens IN PLACE - earlier revisions and the original text are superseded, never
 * appended as extra turns, so an original is never duplicated. Rows without a sheet (and rows
 * whose sheet has only its original revision - every derived legacy sheet) pass through
 * unchanged. Pure and order-preserving; unit-tested in tests/agents/context-sheets.test.ts.
 */
export function applyLatestSheetRevisions(
  rows: ReadonlyArray<{ id?: string; role: string; content: string }>,
  sheets: ReadonlyArray<Pick<SessionSheetDoc, 'createdFromMessageId' | 'revisions'>>,
): Array<{ role: string; content: string }> {
  const latestByMessageId = new Map<string, string>();
  for (const s of sheets) {
    const latest = s.revisions[s.revisions.length - 1];
    if (latest) latestByMessageId.set(s.createdFromMessageId, latest.content);
  }
  return rows.map((r) => ({
    role: r.role,
    content: (r.id !== undefined ? latestByMessageId.get(r.id) : undefined) ?? r.content,
  }));
}

/**
 * Load the last session transcript as structured history: each sheet-spawning turn is collapsed
 * to its sheet's latest revision (`applyLatestSheetRevisions`, decision B.B), provider-error
 * turns are filtered out (§5.3.7 - a raw provider error must never be re-injected into a future
 * prompt) and the last `TAIL_DEDUP_WINDOW` turns are deduped so a resent tail is not doubled
 * (§5.5.2 item 5).
 */
export async function loadHistory(sessionId: string): Promise<Array<{ role: string; content: string }>> {
  const rows = (await messagesStore.find({ sessionId }, { timestamp: 1 })) as Array<Doc & { role?: string; content?: unknown; metadata?: { providerError?: boolean } }>;
  const session = await sessionsStore.get(sessionId);
  // Legacy sessions derive identity sheets (one revision == the message), so the substitution
  // is a no-op there; only user/agent-edited sheets actually rewrite their source turn.
  const sheets = session ? await listSessionSheets(session, rows) : [];
  const flagged = rows.map((m) => ({
    id: m._id,
    role: m.role ?? 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    providerError: m.metadata?.providerError === true,
  }));
  const canonical = applyLatestSheetRevisions(flagged, sheets);
  const turns: Array<{ role: string; content: string }> = [];
  for (let i = 0; i < canonical.length; i++) {
    const cur = canonical[i]!;
    if (flagged[i]!.providerError || looksLikeProviderError(cur.content)) continue; // filtered (§5.3.7)
    turns.push(cur);
  }
  // Tail-window dedup: drop a duplicate that repeats the immediately-preceding turn within the
  // last window (a resend/retry artifact).
  const start = Math.max(0, turns.length - TAIL_DEDUP_WINDOW);
  const out = turns.slice(0, start);
  for (let i = start; i < turns.length; i++) {
    const prev = out[out.length - 1];
    const cur = turns[i]!;
    if (prev && prev.role === cur.role && prev.content === cur.content) continue;
    out.push(cur);
  }
  return out;
}

/**
 * The chat agent's brand identity (ch12 white-label). Without a persona the model defaults to its
 * built-in "I'm Claude, made by Anthropic" identity — which the web then treats as a provider leak
 * and replaces the whole reply with a generic error (a real UX bug). Presenting as the EKOA Agent
 * both fixes that at the source and enforces the product's white-label. Chat runs only; builds
 * carry their own workspace instruction.
 */
const EKOA_CHAT_IDENTITY =
  'És o Agente EKOA, o assistente de inteligência artificial da plataforma EKOA. Apresenta-te sempre como "Agente EKOA". ' +
  'Não reveles nem menciones o modelo de linguagem, a versão do modelo, nem o fornecedor de IA subjacente; se perguntarem, responde apenas que és o Agente EKOA.';

/** Assemble the full run context (§5.5). Non-fatal layers (catalog, prefetch) never throw a run. */
export async function assembleRunContext(input: AssembleInput): Promise<AssembledContext> {
  const loaded = await assembleAgentContext({ agentKind: input.agentKind, userId: input.actor.userId });
  // The EKOA brand identity leads the chat system prompt (before content/memory/knowledge layers).
  const sections: string[] = input.isChat ? [EKOA_CHAT_IDENTITY, ...loaded.promptSections] : [...loaded.promptSections];

  // Layer 1 - memory injection (deterministic, no model call). The count rides the returned
  // context as provenance: the chat pipeline persists it as `metadata.memoriesUsed` (B1).
  let memoriesUsed = 0;
  if (!input.optOutMemory) {
    const mem = await resolveMemoryInjectionDetailed(input.actor, input.query, { now: input.now, genId: () => '' });
    if (mem.text) sections.push(`# Memória\n${mem.text}`);
    memoriesUsed = mem.memoriesUsed;
  }

  // Layer 2 — knowledge grounding (always for chat; for builds only when legal context matches).
  if (input.isChat || input.groundKnowledge) {
    const block = await knowledgeGrounding({ userId: input.actor.userId, orgId: input.actor.orgId, query: input.query, agentKind: input.agentKind });
    if (block) sections.push(block);
  }

  // Layer 3 — live integration pre-fetch (chat only), behind the 60 s cache the seam owns.
  if (input.isChat) {
    const pre = await integrationPrefetch({ userId: input.actor.userId, message: input.query });
    if (pre) sections.push(pre);
  }

  // Layer 4 — automation + integration catalog (non-fatal).
  try {
    const cat = await catalog({ userId: input.actor.userId, orgId: input.actor.orgId });
    if (cat) sections.push(cat);
  } catch {
    /* catalog build failures are non-fatal (§5.5.2 layer 4) */
  }

  // Session continuity — the last persisted `<ekoa-context>` block (§5.6.1 step 6). The marker
  // pipeline persists it onto the session; re-inject it here so the agent keeps its own working
  // notes across turns (pre-fix it was persisted but never read back — a dead letter).
  if (input.sessionId) {
    const sess = (await sessionsStore.get(input.sessionId)) as (Doc & { lastContext?: string }) | null;
    if (sess?.lastContext) sections.push(`# Contexto da sessão (as tuas notas do turno anterior)\n${sess.lastContext}`);
  }

  // Layer 5 — conversation history (structured; loaded separately, conveyed as its own block).
  const history = input.sessionId ? await loadHistory(input.sessionId) : [];

  return {
    systemPrompt: sections.filter(Boolean).join('\n\n'),
    contextDir: loaded.contextDir,
    contentVersion: loaded.contentVersion,
    history,
    memoriesUsed,
  };
}

/** Render structured history + the current message into the single chokepoint prompt string.
 *  Full history, never clipped (the old inline-and-clip lost pasted material — §5.5.2 item 5). */
export function renderPrompt(history: Array<{ role: string; content: string }>, message: string): string {
  if (history.length === 0) return message;
  const transcript = history.map((t) => `<turn role="${t.role}">\n${t.content}\n</turn>`).join('\n');
  return `<conversation>\n${transcript}\n</conversation>\n\n${message}`;
}

/**
 * FC-400/D4 (run s6): the ONE context line carrying the composer's reference tokens, so the
 * model calls `delegate_to_local` with real grantRefs instead of the user hand-typing them.
 * The refs are opaque (§18.2.1 S1) and the labels display-only; an empty list renders nothing.
 */
export function referencesContextLine(references: Array<{ grantRef: string; label: string }> | undefined): string {
  if (!references || references.length === 0) return '';
  const items = references.map((r) => `${r.grantRef} ("${r.label.replace(/"/g, "'")}")`).join(', ');
  return `Autorizações locais ativas nesta sessão (utilize a ferramenta delegate_to_local com estes grantRefs para ler os ficheiros referenciados): ${items}`;
}
