import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, IconButton, buttonClasses } from '@/components/ui/button';
import { Plus } from 'lucide-react';

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('applies variant + size classes via buttonClasses', () => {
    expect(buttonClasses('primary', 'md')).toContain('bg-teal-600');
    expect(buttonClasses('danger', 'sm')).toContain('bg-red-600');
    expect(buttonClasses('danger', 'sm')).toContain('text-xs');
    expect(buttonClasses('ghost', 'md')).toContain('text-neutral-600');
  });

  it('renders the primary variant class on the element', () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toContain('bg-teal-600');
  });

  it('loading disables the button, shows the spinner, and hides the icon', () => {
    render(
      <Button loading icon={Plus}>
        Loading
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Loading' });
    expect(button).toBeDisabled();
    expect(button.querySelector('.animate-spin')).not.toBeNull();
    expect(button.querySelector('.lucide-plus')).toBeNull();
  });

  it('fires onClick when enabled and not when loading', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Click</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Click' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} loading>
        Click
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Click' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('IconButton requires an aria-label', () => {
    render(<IconButton icon={Plus} label="Add item" />);
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument();
  });

  it('passes data-testid through to the root', () => {
    render(<Button data-testid="my-btn">X</Button>);
    expect(screen.getByTestId('my-btn')).toBeInTheDocument();
  });
});
