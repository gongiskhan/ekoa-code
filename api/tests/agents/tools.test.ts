import { describe, it, expect } from 'vitest';
import { toolPolicyFor, KNOWLEDGE_TOOLS, CODING_PRESET, DELEGATION_TOOL, DOCX_TOOLS } from '../../src/agents/tools.js';

/** Tool policy per run class (ch05 §5.4.4, acceptance criterion 5; §5.4.8 delegation). */
describe('toolPolicyFor (§5.4.4)', () => {
  it('a chat run allows EXACTLY the two knowledge tools + delegate_to_local — never Bash/Write/Edit', () => {
    const p = toolPolicyFor('chat');
    expect(p.allowedTools).toEqual([...KNOWLEDGE_TOOLS, DELEGATION_TOOL]);
    for (const banned of ['Bash', 'Write', 'Edit']) expect(p.allowedTools).not.toContain(banned);
  });

  it('a build run includes the coding preset + knowledge tools + delegate_to_local (§5.4.8) + the docx tools', () => {
    const p = toolPolicyFor('build');
    for (const t of CODING_PRESET) expect(p.allowedTools).toContain(t);
    for (const t of KNOWLEDGE_TOOLS) expect(p.allowedTools).toContain(t);
    expect(p.allowedTools).toContain(DELEGATION_TOOL);
    // 2C-S5: the three ekoa-docx tools are artifact-bound, so they ride the BUILD row only.
    for (const t of DOCX_TOOLS) expect(p.allowedTools).toContain(t);
    // The config default (MAX_TURNS_BUILD, config.ts) — raised from 100 to 500 for real builds.
    expect(p.maxTurns).toBe(500);
  });

  it('a text+attachments run allows only Read/Glob/Grep', () => {
    expect(toolPolicyFor('text-attachments').allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('pure-text and brand-research are tool-less', () => {
    expect(toolPolicyFor('pure-text').disallowedTools).toEqual(['*']);
    expect(toolPolicyFor('brand-research').disallowedTools).toEqual(['*']);
  });
});
