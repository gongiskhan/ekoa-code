import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renders neutral tone by default', () => {
    render(<Badge>Neutral</Badge>);
    const el = screen.getByText('Neutral');
    expect(el.className).toContain('bg-neutral-100');
    expect(el.className).toContain('text-xs');
  });

  it('renders each tone with its palette', () => {
    const cases: Array<[Parameters<typeof Badge>[0]['tone'], string]> = [
      ['brand', 'text-teal-700'],
      ['success', 'text-green-700'],
      ['warning', 'text-amber-700'],
      ['danger', 'text-red-600'],
      ['info', 'text-teal-700'],
    ];
    for (const [tone, expected] of cases) {
      const { unmount } = render(<Badge tone={tone}>{tone}</Badge>);
      expect(screen.getByText(String(tone)).className).toContain(expected);
      unmount();
    }
  });

  it('renders a dot when dot is set', () => {
    const { container } = render(<Badge dot>With dot</Badge>);
    expect(container.querySelector('.bg-current')).not.toBeNull();
  });
});
