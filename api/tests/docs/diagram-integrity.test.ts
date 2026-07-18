import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Diagram data-integrity guard (determinism ratchet, S1 fresh-review finding 2, run
 * 20260717-071930-d1244839): hand-edited excalidraw JSON is first-class documentation
 * (FIXED-12), and a copied element whose `rawText` still carries the SOURCE element's text is a
 * silent self-contradiction Excalidraw renders over (it draws `text`, so the canvas looks right
 * while the data lies). Every diagram must parse, and every text element that carries a
 * `rawText` must agree with its own `originalText`.
 */
const DIAGRAMS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/diagrams');

interface TextElement {
  id: string;
  type: string;
  text?: string;
  originalText?: string;
  rawText?: string;
}

describe('docs/diagrams/*.excalidraw integrity', () => {
  const files = readdirSync(DIAGRAMS_DIR).filter((f) => f.endsWith('.excalidraw'));

  it('finds the diagram inventory', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}: valid JSON; every text element's rawText matches its originalText`, () => {
      const doc = JSON.parse(readFileSync(join(DIAGRAMS_DIR, file), 'utf8')) as { elements: TextElement[] };
      expect(Array.isArray(doc.elements)).toBe(true);
      const mismatches = doc.elements
        .filter((e) => e.type === 'text' && e.rawText !== undefined && e.rawText !== e.originalText)
        .map((e) => e.id);
      expect(mismatches, `rawText !== originalText in ${file}: ${mismatches.join(', ')}`).toEqual([]);
    });
  }
});
