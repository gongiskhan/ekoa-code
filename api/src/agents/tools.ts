/**
 * SDK invocation POLICY per run class (ch05 §5.4.4). The MECHANICS of issuing the call live in
 * `llm/` (the chokepoint owns the SDK; ch02 forbids `agents/` from importing it); this file is
 * the policy half — which run class gets which tools and turn ceiling. The tables are carried
 * verbatim from reference/invisible-behaviors.md §7.3.
 */
import { loadAgentsConfig } from '../config.js';

/** The two in-process knowledge MCP tools — the ONLY tools a chat run may use (§5.4.4). */
export const KNOWLEDGE_TOOLS = ['knowledge_search', 'knowledge_read'] as const;

/** The full coding preset a build run gets (permission bypass, cwd = projectDir). */
export const CODING_PRESET = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Agent'] as const;

/** The context-loading tool the coding agent uses to pull agent-context content at runtime. */
export const CONTEXT_LOADING_TOOL = 'load_context';

/** Read-only file tools for a text run that carries attachments (§5.4.4). */
export const ATTACHMENT_TOOLS = ['Read', 'Glob', 'Grep'] as const;

export type RunToolClass = 'chat' | 'build' | 'text-attachments' | 'pure-text' | 'brand-research';

export interface ToolPolicy {
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns: number;
}

/**
 * Resolve the tool policy for a run class. Chat is locked to exactly the two knowledge tools —
 * never Bash/Write/Edit (§5.4.4, acceptance criterion 5). Builds get the coding preset plus the
 * knowledge tools. Brand research is deliberately tool-less so a prompt-injected page cannot
 * launder server config back as "the brand" (§5.6.4).
 */
export function toolPolicyFor(runClass: RunToolClass): ToolPolicy {
  const cfg = loadAgentsConfig();
  switch (runClass) {
    case 'chat':
      return { allowedTools: [...KNOWLEDGE_TOOLS], maxTurns: cfg.maxTurnsText };
    case 'build':
      return { allowedTools: [...CODING_PRESET, CONTEXT_LOADING_TOOL, ...KNOWLEDGE_TOOLS], maxTurns: cfg.maxTurnsBuild };
    case 'text-attachments':
      return { allowedTools: [...ATTACHMENT_TOOLS], maxTurns: cfg.maxTurnsText };
    case 'pure-text':
      return { disallowedTools: ['*'], maxTurns: cfg.maxTurnsText };
    case 'brand-research':
      // Tool-less: no Bash/Read (§5.6.4).
      return { disallowedTools: ['*'], maxTurns: cfg.maxTurnsText };
  }
}
