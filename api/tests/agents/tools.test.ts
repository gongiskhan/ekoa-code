import { describe, it, expect } from 'vitest';
import { toolPolicyFor, KNOWLEDGE_TOOLS, CODING_PRESET, DELEGATION_TOOL, DOCX_TOOLS, CATALOG_TOOLS } from '../../src/agents/tools.js';

/** Tool policy per run class (ch05 §5.4.4, acceptance criterion 5; §5.4.8 delegation). */
describe('toolPolicyFor (§5.4.4)', () => {
  it('a chat run allows EXACTLY knowledge + delegate_to_local + the six catalog tools - never Bash/Write/Edit', () => {
    const p = toolPolicyFor('chat');
    expect(p.allowedTools).toEqual([...KNOWLEDGE_TOOLS, DELEGATION_TOOL, ...CATALOG_TOOLS]);
    for (const banned of ['Bash', 'Write', 'Edit']) expect(p.allowedTools).not.toContain(banned);
  });

  it('the catalog tools ride the CHAT row only - not builds, attachments or brand research (K5)', () => {
    for (const runClass of ['build', 'text-attachments', 'pure-text', 'brand-research', 'integration-builder'] as const) {
      for (const t of CATALOG_TOOLS) expect(toolPolicyFor(runClass).allowedTools ?? []).not.toContain(t);
    }
  });

  it('a build run includes the coding preset + knowledge tools + delegate_to_local (§5.4.8) + the docx tools', () => {
    const p = toolPolicyFor('build');
    for (const t of CODING_PRESET) expect(p.allowedTools).toContain(t);
    for (const t of KNOWLEDGE_TOOLS) expect(p.allowedTools).toContain(t);
    expect(p.allowedTools).toContain(DELEGATION_TOOL);
    // 2C-S5: the three ekoa-docx tools are artifact-bound, so they ride the BUILD row only.
    for (const t of DOCX_TOOLS) expect(p.allowedTools).toContain(t);
    // The config default (MAX_TURNS_BUILD, config.ts): 100 -> 500 for real builds, then 500 -> 250
    // (2026-08-10) once a live build was measured hitting 142 turns and exhausting its context
    // window - a run needing more than this has lost the plot, and the window gives out first.
    expect(p.maxTurns).toBe(250);
    // No `Agent`: a build subagent re-pays the whole context per spawn (see CODING_PRESET).
    expect(p.allowedTools).not.toContain('Agent');
  });

  it('a text+attachments run allows only Read/Glob/Grep', () => {
    expect(toolPolicyFor('text-attachments').allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('pure-text and brand-research are tool-less', () => {
    expect(toolPolicyFor('pure-text').disallowedTools).toEqual(['*']);
    expect(toolPolicyFor('brand-research').disallowedTools).toEqual(['*']);
  });
});
