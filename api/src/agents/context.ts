/**
 * Context assembly (ch05 §5.5). `agents/` assembles the full context for every run from four
 * sources: the content loader (ch08 `assembleAgentContext`, an injected seam), then the five
 * grounding layers composed in order on top of the loader output (§5.5.2). The chokepoint takes
 * a single system prompt + prompt, so the assembled sections are joined into the system prompt
 * and the structured conversation history is conveyed as a delimited transcript block (never
 * inlined-and-clipped: full history, no truncation of pasted material — §5.5.2 item 5).
 */
import type { Actor } from '@ekoa/shared';
import { messages as messagesStore } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import { resolveMemoryInjection } from '../memory/resolver.js';
import { assembleAgentContext, knowledgeGrounding, integrationPrefetch, catalog } from './seams.js';
import { looksLikeProviderError } from './markers.js';

export interface AssembledContext {
  systemPrompt: string;
  contextDir: string;
  contentVersion: string;
  /** Ordered structured history turns (provider-error turns filtered, tail-window deduped). */
  history: Array<{ role: string; content: string }>;
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
 * Load the last session transcript as structured history: provider-error turns are filtered out
 * (§5.3.7 — a raw provider error must never be re-injected into a future prompt) and the last
 * `TAIL_DEDUP_WINDOW` turns are deduped so a resent tail is not doubled (§5.5.2 item 5).
 */
export async function loadHistory(sessionId: string): Promise<Array<{ role: string; content: string }>> {
  const rows = (await messagesStore.find({ sessionId }, { timestamp: 1 })) as Array<Doc & { role?: string; content?: unknown; metadata?: { providerError?: boolean } }>;
  const turns: Array<{ role: string; content: string }> = [];
  for (const m of rows) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    if (m.metadata?.providerError || looksLikeProviderError(content)) continue; // filtered (§5.3.7)
    turns.push({ role: m.role ?? 'user', content });
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

/** Assemble the full run context (§5.5). Non-fatal layers (catalog, prefetch) never throw a run. */
export async function assembleRunContext(input: AssembleInput): Promise<AssembledContext> {
  const loaded = await assembleAgentContext({ agentKind: input.agentKind, userId: input.actor.userId });
  const sections: string[] = [...loaded.promptSections];

  // Layer 1 — memory injection (deterministic, no model call).
  if (!input.optOutMemory) {
    const mem = await resolveMemoryInjection(input.actor, input.query, { now: input.now, genId: () => '' });
    if (mem) sections.push(`# Memória\n${mem}`);
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

  // Layer 5 — conversation history (structured; loaded separately, conveyed as its own block).
  const history = input.sessionId ? await loadHistory(input.sessionId) : [];

  return {
    systemPrompt: sections.filter(Boolean).join('\n\n'),
    contextDir: loaded.contextDir,
    contentVersion: loaded.contentVersion,
    history,
  };
}

/** Render structured history + the current message into the single chokepoint prompt string.
 *  Full history, never clipped (the old inline-and-clip lost pasted material — §5.5.2 item 5). */
export function renderPrompt(history: Array<{ role: string; content: string }>, message: string): string {
  if (history.length === 0) return message;
  const transcript = history.map((t) => `<turn role="${t.role}">\n${t.content}\n</turn>`).join('\n');
  return `<conversation>\n${transcript}\n</conversation>\n\n${message}`;
}
