import { describe, it, expect } from 'vitest';
import { toolPolicyFor, KNOWLEDGE_TOOLS, CODING_PRESET } from '../../src/agents/tools.js';

/** Tool policy per run class (ch05 §5.4.4, acceptance criterion 5). */
describe('toolPolicyFor (§5.4.4)', () => {
  it('a chat run allows EXACTLY the two knowledge tools — never Bash/Write/Edit', () => {
    const p = toolPolicyFor('chat');
    expect(p.allowedTools).toEqual([...KNOWLEDGE_TOOLS]);
    for (const banned of ['Bash', 'Write', 'Edit']) expect(p.allowedTools).not.toContain(banned);
  });

  it('a build run includes the coding preset + knowledge tools', () => {
    const p = toolPolicyFor('build');
    for (const t of CODING_PRESET) expect(p.allowedTools).toContain(t);
    for (const t of KNOWLEDGE_TOOLS) expect(p.allowedTools).toContain(t);
    expect(p.maxTurns).toBe(100);
  });

  it('a text+attachments run allows only Read/Glob/Grep', () => {
    expect(toolPolicyFor('text-attachments').allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('pure-text and brand-research are tool-less', () => {
    expect(toolPolicyFor('pure-text').disallowedTools).toEqual(['*']);
    expect(toolPolicyFor('brand-research').disallowedTools).toEqual(['*']);
  });
});
