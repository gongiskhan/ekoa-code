import { describe, it, expect } from 'vitest';
import { brandPromptSection } from '../../src/apps/brand-prompt.js';

/**
 * The FIRST-BUILD brand prompt section (ch05 §5.6.2). Serve-time design tokens can only recolour
 * what the agent chose to paint, so the build agent has to be told which brand the app is for -
 * before it invents a header with no brand mark and a light canvas for a dark-brand org.
 */
describe('brandPromptSection', () => {
  const full = {
    primaryColor: '#7C3AED',
    secondaryColor: '#1E293B',
    accentColor: '#F59E0B',
    fonts: ['Inter', 'Lora'],
    toneOfVoice: 'Sóbrio e direto',
    instructions: 'Muito espaço branco, sem ilustrações.',
    logo: '/brand-assets/acme-mark.png',
    visualVibe: { mood: 'editorial e calmo', bullets: ['tipografia grande', 'contraste alto'] },
    designSystem: { palette: [{ hex: '#080C14', count: 30, confidence: 'high', sources: ['css'] }] },
  };

  it('states the brand the app is for, with the fields research actually produced', () => {
    const section = brandPromptSection(full)!;
    expect(section).toContain('MARCA DA ORGANIZAÇÃO');
    expect(section).toContain('#7C3AED');
    expect(section).toContain('#1E293B');
    expect(section).toContain('#F59E0B');
    expect(section).toContain('Inter, Lora');
    expect(section).toContain('Sóbrio e direto');
    expect(section).toContain('Muito espaço branco');
    expect(section).toContain('editorial e calmo');
    expect(section).toContain('tipografia grande');
    // The token contract, so the agent reads live values instead of freezing this snapshot.
    expect(section).toContain('/api/design-tokens.css');
    expect(section).toContain('--logo-url');
    // Compact enough to sit alongside the base conventions in the system prompt.
    expect(section.split('\n').length).toBeLessThan(40);
  });

  it('points the agent at the real logo through the token contract and forbids inventing one', () => {
    const section = brandPromptSection(full)!;
    expect(section).toContain('var(--logo-url)');
    expect(section).toContain('NUNCA inventes');
  });

  it('says nothing about a logo the org does not have', () => {
    const { logo, ...noLogo } = full;
    expect(logo).toBeTruthy();
    const section = brandPromptSection(noLogo)!;
    expect(section).not.toContain('Logótipo');
    expect(section).not.toContain('NUNCA inventes');
  });

  it('names the dark canvas the org design system carries, and always states the rule', () => {
    const section = brandPromptSection(full)!;
    expect(section).toContain('#080C14');
    expect(section).toContain('ESCURA');
    expect(section).toContain('o estilo claro por');
  });

  it('carries the dark-brand rule but no canvas claim when the palette names none', () => {
    const { designSystem, ...noDesignSystem } = full;
    expect(designSystem).toBeTruthy();
    const section = brandPromptSection(noDesignSystem)!;
    expect(section).not.toContain('Fundo da marca');
    expect(section).toContain('a aplicação é construída escura');
  });

  it('truncates unbounded free text instead of spending the prompt budget on it', () => {
    const section = brandPromptSection({ primaryColor: '#7C3AED', instructions: 'a'.repeat(5000) })!;
    expect(section).toContain('...');
    expect(section.length).toBeLessThan(2000);
  });

  it('returns nothing for an org with no brand', () => {
    expect(brandPromptSection(null)).toBeNull();
    expect(brandPromptSection({})).toBeNull();
    // Present but empty of anything the agent could act on: a section of blank labels would only
    // invite the agent to fill them in itself.
    expect(brandPromptSection({ websiteUrl: 'https://acme.pt' })).toBeNull();
  });
});
