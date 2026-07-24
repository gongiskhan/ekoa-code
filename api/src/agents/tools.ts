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

/** The §5.4.8 local-bridge delegation tool (ch18 §18.2) — exposed to the hosted chat and build
 *  run classes; derived output only, honest offline, never an upload. */
export const DELEGATION_TOOL = 'delegate_to_local';

/** Read-only file tools for a text run that carries attachments (§5.4.4). */
export const ATTACHMENT_TOOLS = ['Read', 'Glob', 'Grep'] as const;

/**
 * The three ekoa-docx tools (2C-S5, ch07 document base v2): read the CriticMarkup projection of
 * a Word document, link a source .docx to the artifact, and apply an atomic native-track-changes
 * batch to it. BUILD RUNS ONLY - they are artifact-bound (appId = the artifact being built), so
 * a hosted chat turn has nothing for them to operate on. The read-only `docx_read` subset for
 * chat-with-attachments is DESCOPED (docs/decisions.md 2026-07-25): ekoa-code's text-attachments
 * run class mounts no in-process tools and has no attachment-path plumbing today.
 */
export const DOCX_TOOLS = ['docx_read', 'docx_source_set', 'docx_apply_edits'] as const;

export type RunToolClass = 'chat' | 'build' | 'text-attachments' | 'pure-text' | 'brand-research' | 'integration-builder';

export interface ToolPolicy {
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns: number;
}

/**
 * Resolve the tool policy for a run class. Chat is locked to the two knowledge tools plus the
 * §5.4.8 local-bridge delegation tool — never Bash/Write/Edit on the hosted machine (§5.4.4,
 * acceptance criterion 5; delegation runs on the USER's machine inside their grants, ch18).
 * Builds get the coding preset plus the knowledge + delegation + docx tools. Brand research is
 * deliberately tool-less so a prompt-injected page cannot launder server config back as "the
 * brand" (§5.6.4).
 */
export function toolPolicyFor(runClass: RunToolClass): ToolPolicy {
  const cfg = loadAgentsConfig();
  switch (runClass) {
    case 'chat':
      return { allowedTools: [...KNOWLEDGE_TOOLS, DELEGATION_TOOL], maxTurns: cfg.maxTurnsText };
    case 'build':
      return {
        allowedTools: [...CODING_PRESET, CONTEXT_LOADING_TOOL, ...KNOWLEDGE_TOOLS, DELEGATION_TOOL, ...DOCX_TOOLS],
        maxTurns: cfg.maxTurnsBuild,
      };
    case 'text-attachments':
      return { allowedTools: [...ATTACHMENT_TOOLS], maxTurns: cfg.maxTurnsText };
    case 'pure-text':
      return { disallowedTools: ['*'], maxTurns: cfg.maxTurnsText };
    case 'brand-research':
      // Tool-less: no Bash/Read (§5.6.4).
      return { disallowedTools: ['*'], maxTurns: cfg.maxTurnsText };
    case 'integration-builder':
      // Tool-less one-shot: the builder emits its two fenced blocks from a single WORKHORSE turn
      // with no filesystem/network reach (§3.8.14) — a prompt-injected service page cannot make it
      // read the server or call out. Same posture as brand-research.
      return { disallowedTools: ['*'], maxTurns: cfg.maxTurnsText };
  }
}
