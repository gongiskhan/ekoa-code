import { describe, it, expect } from 'vitest';
import { classifyEditIntent } from '@/lib/edit-intent';

/**
 * B.D continue-vs-new heuristic (mega-run B5). Pure classification only: imperative edit
 * verbs (PT/EN) near the start -> 'edit'; explicit new-topic markers -> 'new' (they WIN over
 * an edit verb, e.g. "muda de assunto"); everything else -> 'neutral' (the chip's current
 * state - manual or auto - stands). Wrong defaults are tolerable by design (locked 6): the
 * chip is visible and overridable, so this suite pins the shape of the rule, not an
 * exhaustive phrasebook.
 */
describe('classifyEditIntent (B.D local heuristic)', () => {
  it('imperative edit verbs near the start (PT) -> edit', () => {
    expect(classifyEditIntent('Torna o tom mais formal')).toBe('edit');
    expect(classifyEditIntent('encurta-o para dois parágrafos')).toBe('edit');
    expect(classifyEditIntent('e agora, reescreve a conclusão')).toBe('edit');
    expect(classifyEditIntent('Acrescenta um exemplo prático')).toBe('edit');
    expect(classifyEditIntent('corrige a data da audiência')).toBe('edit');
  });

  it('imperative edit verbs near the start (EN) -> edit', () => {
    expect(classifyEditIntent('make it shorter')).toBe('edit');
    expect(classifyEditIntent('please rewrite the last paragraph')).toBe('edit');
    expect(classifyEditIntent('ok, add a closing sentence')).toBe('edit');
  });

  it('explicit new-topic markers -> new, even alongside an edit verb', () => {
    expect(classifyEditIntent('muda de assunto: fala-me de prazos')).toBe('new');
    expect(classifyEditIntent('Outra pergunta: o que é uma injunção?')).toBe('new');
    expect(classifyEditIntent('esquece isso, novo tema')).toBe('new');
    expect(classifyEditIntent('new topic: draft an email')).toBe('new');
    expect(classifyEditIntent('quero uma nova folha para isto')).toBe('new');
  });

  it('plain questions and requests -> neutral (chip state untouched)', () => {
    expect(classifyEditIntent('Qual é o prazo de contestação?')).toBe('neutral');
    expect(classifyEditIntent('faz um resumo do contrato')).toBe('neutral');
    expect(classifyEditIntent('make a landing page for my firm')).toBe('neutral');
    expect(classifyEditIntent('')).toBe('neutral');
    expect(classifyEditIntent('   ')).toBe('neutral');
  });

  it('an edit verb mid-sentence does not trigger (near-start rule)', () => {
    expect(classifyEditIntent('o contrato diz que o senhorio altera a renda')).toBe('neutral');
  });

  it('the sheet follow-up pill texts (infinitives) are neutral - the pill sets the chip EXPLICITLY, never through this heuristic', () => {
    // Pins the interplay with the sheet-feed footer pills: their PT infinitive forms
    // ("Tornar", "Desenvolver", ...) deliberately do not match the imperative rule, so the
    // chip they show comes from the pill's own setEditTarget (locked 6's manual SET), and the
    // send path attaches reviseSheetId only from that visible chip state.
    expect(classifyEditIntent('Desenvolver este tema em mais detalhe')).toBe('neutral');
    expect(classifyEditIntent('Dar um exemplo prático')).toBe('neutral');
    expect(classifyEditIntent('Tornar a resposta mais concisa')).toBe('neutral');
    expect(classifyEditIntent('Resumir os pontos principais')).toBe('neutral');
    expect(classifyEditIntent('Simplificar a linguagem')).toBe('neutral');
    expect(classifyEditIntent('Tornar o tom mais formal')).toBe('neutral');
  });
});
