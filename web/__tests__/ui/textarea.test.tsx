import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Textarea } from '@/components/ui/textarea';

describe('Textarea', () => {
  it('renders a label bound to the field', () => {
    render(<Textarea label="Notes" />);
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('gives two textareas with the same label distinct ids', () => {
    render(
      <>
        <Textarea label="Bio" data-testid="bio-1" />
        <Textarea label="Bio" data-testid="bio-2" />
      </>,
    );
    const id1 = screen.getByTestId('bio-1').getAttribute('id');
    const id2 = screen.getByTestId('bio-2').getAttribute('id');
    expect(id1).not.toBe(id2);
  });

  it('resizes an uncontrolled textarea on input events', () => {
    render(<Textarea autoResize data-testid="ta" defaultValue="" />);
    const el = screen.getByTestId('ta') as HTMLTextAreaElement;

    // jsdom has no layout, so drive scrollHeight deterministically.
    let scroll = 20;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scroll });

    scroll = 96;
    fireEvent.input(el, { target: { value: 'line1\nline2\nline3\nline4' } });
    expect(el.style.height).toBe('96px');
  });

  it('forwards the user-supplied onInput handler', () => {
    const onInput = vi.fn();
    render(<Textarea autoResize onInput={onInput} data-testid="ta2" />);
    fireEvent.input(screen.getByTestId('ta2'), { target: { value: 'x' } });
    expect(onInput).toHaveBeenCalledTimes(1);
  });
});
