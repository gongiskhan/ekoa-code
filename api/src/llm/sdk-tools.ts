/**
 * In-process MCP tool layer (ch05 §5.4.4). The tool VOCABULARY is policy owned by `agents/`
 * (tools.ts names them; §5.4.4 table); the INSTANTIATION lives here because mounting an
 * in-process MCP server on the SDK subprocess requires the Agent SDK, and only `api/src/llm/`
 * may import `@anthropic-ai/*` (FIXED-3/13, ch02 §2.9).
 *
 * `agents/` declares each tool as a plain spec — name, description, a zod/v4 raw shape, and an
 * async handler returning text. This file turns the specs into one SDK MCP server per run and
 * translates the spec's plain §5.4.4 names into the SDK's `mcp__<server>__<name>` wire names
 * for the allowlist, so the policy table keeps the spec-canonical names.
 *
 * The schemas MUST be zod/v4 (`zod/v4` subpath of the workspace zod): the SDK's bundled MCP
 * server detects schemas by the v4 `_zod` marker and serializes them with the v4 toJSONSchema —
 * a zod v3 schema would register without an input schema. The `shared/` contract stays on v3;
 * this is a chokepoint-internal concern.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

/** The one in-process MCP server name every ekoa tool mounts under. */
export const SDK_TOOL_SERVER = 'ekoa';

/** A plain in-process tool declaration `agents/` hands the chokepoint (ch05 §5.4.4). */
export interface SdkToolSpec {
  /** Spec-canonical tool name (e.g. `knowledge_search`) — translated to the MCP wire name here. */
  name: string;
  description: string;
  /** zod/v4 raw shape (see file header) — kept structurally typed so callers don't import SDK types. */
  inputSchema: Record<string, unknown>;
  /** Returns the tool result text; a throw surfaces as an is_error tool result, never a crash. */
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/** The MCP wire name of a spec-canonical tool name. */
export function mcpToolName(name: string): string {
  return `mcp__${SDK_TOOL_SERVER}__${name}`;
}

/**
 * Translate spec-canonical names in an allowlist to their MCP wire names where a mounted spec
 * matches; every other entry (built-ins like Read/Bash) passes through untouched.
 */
export function translateAllowedTools(
  allowed: string[] | undefined,
  specs: SdkToolSpec[] | undefined,
): string[] | undefined {
  if (!allowed?.length || !specs?.length) return allowed;
  const mounted = new Set(specs.map((s) => s.name));
  return allowed.map((t) => (mounted.has(t) ? mcpToolName(t) : t));
}

/** The MCP tool-result shape a wrapped handler resolves to (index signature per CallToolResult). */
export interface WrappedToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Wrap a spec handler as an MCP tool handler: text on success; a throw becomes an is_error
 *  tool result, never a run crash (§5.4.4 — tools degrade honestly). */
export function wrapHandler(spec: SdkToolSpec): (args: Record<string, unknown>) => Promise<WrappedToolResult> {
  return async (args) => {
    try {
      const text = await spec.handler(args);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'tool failed';
      return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
  };
}

/** Build the `mcpServers` option for an SDK spawn from the run's tool specs, or undefined. */
export function buildMcpServers(specs: SdkToolSpec[] | undefined): Record<string, unknown> | undefined {
  if (!specs?.length) return undefined;
  return {
    [SDK_TOOL_SERVER]: createSdkMcpServer({
      name: SDK_TOOL_SERVER,
      version: '1.0.0',
      tools: specs.map((s) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tool(s.name, s.description, s.inputSchema as any, wrapHandler(s)),
      ),
    }),
  };
}
