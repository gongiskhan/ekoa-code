import { describe, it, expect } from 'vitest';
import { cardinalEn, cardinalPt, normalizeNumbersEn, normalizeNumbersPt } from '../../src/voice/text/speakable.js';

/**
 * C3 (mega-run 20260717-190134): speakable number normalization for the C5 TTS text pipeline.
 * PT-PT forms are binding (BRIEF §5: "dezasseis", never pt-BR "dezesseis"); long-scale 10^9 is
 * "mil milhões". Pure string transforms, zero mocks. Moved verbatim from web/__tests__/voice/
 * with the module's C5 relocation to api/src/voice/text/ (see the module header + decisions.md).
 */

describe('cardinalPt (PT-PT words)', () => {
  it('speaks the PT-PT teens, never the pt-BR forms', () => {
    expect(cardinalPt(14)).toBe('catorze');
    expect(cardinalPt(16)).toBe('dezasseis');
    expect(cardinalPt(17)).toBe('dezassete');
    expect(cardinalPt(19)).toBe('dezanove');
  });

  it('handles zero, tens and hundreds with the "e" connector', () => {
    expect(cardinalPt(0)).toBe('zero');
    expect(cardinalPt(21)).toBe('vinte e um');
    expect(cardinalPt(100)).toBe('cem');
    expect(cardinalPt(101)).toBe('cento e um');
    expect(cardinalPt(345)).toBe('trezentos e quarenta e cinco');
  });

  it('applies the thousand connector rule: "e" only before a small or round-hundred tail', () => {
    expect(cardinalPt(1000)).toBe('mil');
    expect(cardinalPt(1026)).toBe('mil e vinte e seis');
    expect(cardinalPt(1500)).toBe('mil e quinhentos');
    expect(cardinalPt(1234)).toBe('mil duzentos e trinta e quatro');
    expect(cardinalPt(2026)).toBe('dois mil e vinte e seis');
    expect(cardinalPt(1999)).toBe('mil novecentos e noventa e nove');
  });

  it('speaks millions and the PT-PT long-scale "mil milhões"', () => {
    expect(cardinalPt(1_000_000)).toBe('um milhão');
    expect(cardinalPt(2_000_000)).toBe('dois milhões');
    expect(cardinalPt(1_200_000)).toBe('um milhão e duzentos mil');
    expect(cardinalPt(1_000_000_000)).toBe('mil milhões');
    expect(cardinalPt(2_000_000_000)).toBe('dois mil milhões');
  });

  it('supports feminine agreement (hours, pages)', () => {
    expect(cardinalPt(1, { feminine: true })).toBe('uma');
    expect(cardinalPt(2, { feminine: true })).toBe('duas');
    expect(cardinalPt(21, { feminine: true })).toBe('vinte e uma');
    expect(cardinalPt(200, { feminine: true })).toBe('duzentas');
  });

  it('speaks negatives and refuses out-of-range values', () => {
    expect(cardinalPt(-16)).toBe('menos dezasseis');
    expect(cardinalPt(1e12)).toBeNull();
    expect(cardinalPt(3.5)).toBeNull();
  });
});

describe('cardinalEn', () => {
  it('speaks units, tens and hundreds with the spoken "and"', () => {
    expect(cardinalEn(16)).toBe('sixteen');
    expect(cardinalEn(42)).toBe('forty-two');
    expect(cardinalEn(123)).toBe('one hundred and twenty-three');
  });

  it('speaks thousands and millions', () => {
    expect(cardinalEn(1234)).toBe('one thousand two hundred and thirty-four');
    expect(cardinalEn(1005)).toBe('one thousand and five');
    expect(cardinalEn(2_000_000)).toBe('two million');
  });

  it('speaks negatives and refuses out-of-range values', () => {
    expect(cardinalEn(-7)).toBe('minus seven');
    expect(cardinalEn(1e12)).toBeNull();
  });
});

describe('normalizeNumbersPt', () => {
  it('speaks plain integers: the BRIEF example', () => {
    expect(normalizeNumbersPt('O prazo termina no dia 16')).toBe('O prazo termina no dia dezasseis');
  });

  it('speaks currency: the BRIEF example €1.234,50', () => {
    expect(normalizeNumbersPt('custa €1.234,50')).toBe(
      'custa mil duzentos e trinta e quatro euros e cinquenta cêntimos',
    );
  });

  it('handles currency singulars, trailing symbols and cents-only amounts', () => {
    expect(normalizeNumbersPt('€1')).toBe('um euro');
    expect(normalizeNumbersPt('2,50 €')).toBe('dois euros e cinquenta cêntimos');
    expect(normalizeNumbersPt('€0,05')).toBe('cinco cêntimos');
    expect(normalizeNumbersPt('€0,00')).toBe('zero euros');
    expect(normalizeNumbersPt('$20')).toBe('vinte dólares');
  });

  it('round millions take "de": um milhão de euros', () => {
    expect(normalizeNumbersPt('€1.000.000')).toBe('um milhão de euros');
    expect(normalizeNumbersPt('€2.000.000')).toBe('dois milhões de euros');
  });

  it('speaks numeric dates in both dd/mm/yyyy and ISO forms', () => {
    expect(normalizeNumbersPt('audiência a 16/07/2026')).toBe(
      'audiência a dezasseis de julho de dois mil e vinte e seis',
    );
    expect(normalizeNumbersPt('entregue em 2026-07-16')).toBe(
      'entregue em dezasseis de julho de dois mil e vinte e seis',
    );
    expect(normalizeNumbersPt('a 1/03/1999')).toBe('a um de março de mil novecentos e noventa e nove');
  });

  it('leaves impossible dates as digits', () => {
    expect(normalizeNumbersPt('ref 99/99/2026')).toContain('99/99/');
  });

  it('speaks clock times with feminine hours', () => {
    expect(normalizeNumbersPt('às 16h30')).toBe('às dezasseis horas e trinta');
    expect(normalizeNumbersPt('à 1h')).toBe('à uma hora');
    expect(normalizeNumbersPt('às 2h')).toBe('às duas horas');
    expect(normalizeNumbersPt('às 16:30')).toBe('às dezasseis horas e trinta');
    expect(normalizeNumbersPt('às 21h05')).toBe('às vinte e uma horas e cinco');
  });

  it('speaks percentages and decimals', () => {
    expect(normalizeNumbersPt('juros de 15%')).toBe('juros de quinze por cento');
    expect(normalizeNumbersPt('taxa de 3,5%')).toBe('taxa de três vírgula cinco por cento');
    expect(normalizeNumbersPt('cerca de 3,05')).toBe('cerca de três vírgula zero cinco');
  });

  it('speaks grouped integers and reads long id-like runs digit by digit', () => {
    expect(normalizeNumbersPt('são 1.234 processos')).toBe('são mil duzentos e trinta e quatro processos');
    expect(normalizeNumbersPt('NIF 512345678')).toBe('NIF cinco um dois três quatro cinco seis sete oito');
  });

  it('leaves version-like dotted chains untouched', () => {
    expect(normalizeNumbersPt('versão 1.2.3')).toBe('versão 1.2.3');
  });

  it('is a no-op on digit-free text', () => {
    const text = 'Sem números aqui, só prosa.';
    expect(normalizeNumbersPt(text)).toBe(text);
  });

  it('leaves ordinal markers as digits (C3 review)', () => {
    expect(normalizeNumbersPt('ver 1.º artigo')).toBe('ver 1.º artigo');
    expect(normalizeNumbersPt('a 2ª secção')).toBe('a 2ª secção');
  });

  it('leaves signed numbers as digits rather than emit a stray menos (C3 review)', () => {
    expect(normalizeNumbersPt('saldo -16 euros')).toBe('saldo -16 euros');
    expect(normalizeNumbersPt('queda de -16%')).toBe('queda de -16%');
    expect(normalizeNumbersPt('saldo -16 €')).toBe('saldo -16 €');
    // Positive currency/percent still convert.
    expect(normalizeNumbersPt('subida de 16%')).toContain('dezasseis por cento');
  });

  it('leaves a hyphen-ranged pair as digits, not half-converted (C3 review)', () => {
    expect(normalizeNumbersPt('artigos 16-20')).toBe('artigos 16-20');
  });
});

describe('normalizeNumbersEn', () => {
  it('speaks plain integers', () => {
    expect(normalizeNumbersEn('the deadline is day 16')).toBe('the deadline is day sixteen');
  });

  it('speaks currency with cents', () => {
    expect(normalizeNumbersEn('costs $1,234.50')).toBe(
      'costs one thousand two hundred and thirty-four dollars and fifty cents',
    );
    expect(normalizeNumbersEn('€1')).toBe('one euro');
    expect(normalizeNumbersEn('$0.05')).toBe('five cents');
  });

  it('speaks dates with ordinal days and spoken years', () => {
    expect(normalizeNumbersEn('due 2026-07-16')).toBe('due July sixteenth, twenty twenty-six');
    expect(normalizeNumbersEn('filed 7/1/1999')).toBe('filed July first, nineteen ninety-nine');
    expect(normalizeNumbersEn('signed 3/22/2005')).toBe('signed March twenty-second, two thousand and five');
  });

  it('speaks clock times', () => {
    expect(normalizeNumbersEn('at 16:30')).toBe('at sixteen thirty');
    expect(normalizeNumbersEn('at 16:05')).toBe('at sixteen oh five');
    expect(normalizeNumbersEn("at 16:00")).toBe("at sixteen o'clock");
  });

  it('speaks percentages and reads decimals digit by digit', () => {
    expect(normalizeNumbersEn('a 15% fee')).toBe('a fifteen percent fee');
    expect(normalizeNumbersEn('pi is 3.14')).toBe('pi is three point one four');
  });

  it('reads long id-like runs digit by digit and leaves version chains alone', () => {
    expect(normalizeNumbersEn('case 1234567')).toBe('case one two three four five six seven');
    expect(normalizeNumbersEn('node 22.14.0')).toBe('node 22.14.0');
  });
});
