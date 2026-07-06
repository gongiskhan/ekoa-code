import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '@/components/ui/input';
import { Mail } from 'lucide-react';

describe('Input', () => {
  it('renders a label bound to the field', () => {
    render(<Input label="Email" placeholder="you@example.com" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows the error message and marks the field invalid', () => {
    render(<Input label="Email" error="Required" />);
    const field = screen.getByLabelText('Email');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.className).toContain('border-red-300');
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('shows a hint only when there is no error', () => {
    const { rerender } = render(<Input label="Name" hint="Your full name" />);
    expect(screen.getByText('Your full name')).toBeInTheDocument();
    rerender(<Input label="Name" hint="Your full name" error="Bad" />);
    expect(screen.queryByText('Your full name')).not.toBeInTheDocument();
    expect(screen.getByText('Bad')).toBeInTheDocument();
  });

  it('adds left padding when a leftIcon is provided', () => {
    render(<Input label="Email" leftIcon={Mail} />);
    expect(screen.getByLabelText('Email').className).toContain('pl-9');
  });

  it('passes data-testid through to the input element', () => {
    render(<Input data-testid="email-input" />);
    expect(screen.getByTestId('email-input').tagName).toBe('INPUT');
  });

  it('gives two inputs with the same label distinct ids', () => {
    render(
      <>
        <Input label="City" data-testid="city-1" />
        <Input label="City" data-testid="city-2" />
      </>,
    );
    const id1 = screen.getByTestId('city-1').getAttribute('id');
    const id2 = screen.getByTestId('city-2').getAttribute('id');
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    // Each label resolves to its own field (would throw if ids collided).
    expect(screen.getByTestId('city-1')).toBe(screen.getAllByLabelText('City')[0]);
    expect(screen.getByTestId('city-2')).toBe(screen.getAllByLabelText('City')[1]);
  });

  it('honors an explicit id over the generated one', () => {
    render(<Input label="Custom" id="my-id" data-testid="custom" />);
    expect(screen.getByTestId('custom').getAttribute('id')).toBe('my-id');
  });
});
