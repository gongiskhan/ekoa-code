/**
 * ThinkingBlock behavior: live auto-expanded, auto-collapse when the answer starts (live flips
 * false), manual toggle always wins, and the render-time provider-identity net — an engine name
 * in the text must NEVER reach the DOM, whatever the server sent (replayed pre-fix events).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThinkingBlock } from '@/components/chat/thinking-block';

const LEAK = /claude|anthropic|sonnet/i;

describe('ThinkingBlock', () => {
  it('renders expanded while live, with the shimmering thinking label', () => {
    render(<ThinkingBlock text="a analisar a pergunta…" live />);
    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toMatch(/A pensar|Thinking/);
    expect(screen.getByText('a analisar a pergunta…')).toBeTruthy();
  });

  it('auto-collapses into a duration row when live flips false, and a click re-expands', () => {
    const { rerender } = render(<ThinkingBlock text="raciocínio completo" live />);
    rerender(<ThinkingBlock text="raciocínio completo" live={false} />);
    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toMatch(/Pensou durante \d+s|Thought for \d+s/);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('a manual collapse during live wins over the automatic expansion', () => {
    render(<ThinkingBlock text="ainda a pensar" live />);
    const toggle = screen.getByRole('button');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the persisted variant collapsed by default, labelled with the stored duration', () => {
    render(<ThinkingBlock text="raciocínio persistido" durationMs={12_000} />);
    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toMatch(/12s/);
  });

  it('never lets an engine identity reach the DOM (render-time net over replayed events)', () => {
    const { container } = render(
      <ThinkingBlock text="Eu sou o Claude Sonnet, um modelo da Anthropic." live />,
    );
    expect(container.textContent).not.toMatch(LEAK);
    expect(container.textContent).toContain('Agente EKOA');
  });

  it('renders nothing for empty or whitespace-only text', () => {
    const { container } = render(<ThinkingBlock text="   " live />);
    expect(container.textContent).toBe('');
  });
});
