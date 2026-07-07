import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';
import {
  SDK_TOOL_SERVER,
  mcpToolName,
  translateAllowedTools,
  buildMcpServers,
  wrapHandler,
  type SdkToolSpec,
} from '../../src/llm/sdk-tools.js';

/**
 * In-process MCP tool layer (ch05 §5.4.4). The chokepoint instantiates plain specs as an SDK
 * MCP server and translates spec-canonical names to mcp__ wire names — G7B post-gate fix for
 * the review finding that the §5.4.4 tools were allowlisted but unimplemented.
 */

const spec = (over: Partial<SdkToolSpec> = {}): SdkToolSpec => ({
  name: 'knowledge_search',
  description: 'search',
  inputSchema: { query: z.string() },
  handler: async () => 'ok',
  ...over,
});

describe('mcp tool naming + allowlist translation (§5.4.4)', () => {
  it('wire name is mcp__<server>__<name>', () => {
    expect(mcpToolName('knowledge_search')).toBe(`mcp__${SDK_TOOL_SERVER}__knowledge_search`);
  });

  it('translates ONLY mounted spec names; built-ins pass through untouched', () => {
    const specs = [spec(), spec({ name: 'knowledge_read' })];
    const out = translateAllowedTools(['knowledge_search', 'knowledge_read', 'Read', 'Bash'], specs);
    expect(out).toEqual([
      `mcp__${SDK_TOOL_SERVER}__knowledge_search`,
      `mcp__${SDK_TOOL_SERVER}__knowledge_read`,
      'Read',
      'Bash',
    ]);
  });

  it('is a no-op without specs or without an allowlist', () => {
    expect(translateAllowedTools(['knowledge_search'], undefined)).toEqual(['knowledge_search']);
    expect(translateAllowedTools(['knowledge_search'], [])).toEqual(['knowledge_search']);
    expect(translateAllowedTools(undefined, [spec()])).toBeUndefined();
  });
});

describe('buildMcpServers', () => {
  it('mounts one in-process sdk server named ekoa carrying the specs', () => {
    const servers = buildMcpServers([spec()]) as Record<string, { type: string; name: string; instance: unknown }>;
    expect(servers).toBeTruthy();
    expect(Object.keys(servers)).toEqual([SDK_TOOL_SERVER]);
    expect(servers[SDK_TOOL_SERVER]!.type).toBe('sdk');
    expect(servers[SDK_TOOL_SERVER]!.name).toBe(SDK_TOOL_SERVER);
    expect(servers[SDK_TOOL_SERVER]!.instance).toBeTruthy();
  });

  it('returns undefined when a run mounts no tools', () => {
    expect(buildMcpServers(undefined)).toBeUndefined();
    expect(buildMcpServers([])).toBeUndefined();
  });
});

describe('wrapHandler — tools degrade honestly (§5.4.4)', () => {
  it('returns the handler text as a text content block', async () => {
    const res = await wrapHandler(spec({ handler: async () => 'resultado' }))({});
    expect(res).toEqual({ content: [{ type: 'text', text: 'resultado' }] });
  });

  it('a thrown handler error becomes an is_error tool result, never a crash', async () => {
    const res = await wrapHandler(spec({ handler: async () => { throw new Error('vault offline'); } }))({});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe('vault offline');
  });
});
