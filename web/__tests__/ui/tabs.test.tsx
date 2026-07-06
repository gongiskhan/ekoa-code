import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, type TabItem } from '@/components/ui/tabs';

const items: TabItem[] = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta', count: 3 },
  { key: 'c', label: 'Gamma' },
];

describe('Tabs', () => {
  it('marks the active tab as selected', () => {
    render(<Tabs items={items} value="b" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /Beta/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders a count badge when provided', () => {
    render(<Tabs items={items} value="a" onChange={() => {}} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls onChange with the tab key on click', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="a" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: /Gamma/ }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('supports the pills variant', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="a" onChange={onChange} variant="pills" />);
    await userEvent.click(screen.getByRole('tab', { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('uses roving tabIndex (active tab 0, others -1)', () => {
    render(<Tabs items={items} value="b" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Alpha/ })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: /Beta/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /Gamma/ })).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection right with ArrowRight', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="a" onChange={onChange} />);
    screen.getByRole('tab', { name: /Alpha/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('wraps backwards from the first tab with ArrowLeft', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="a" onChange={onChange} />);
    screen.getByRole('tab', { name: /Alpha/ }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('c');
  });

  it('jumps to first/last with Home and End', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="b" onChange={onChange} />);
    const beta = screen.getByRole('tab', { name: /Beta/ });
    beta.focus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('c');
    // Focus followed to Gamma; jump back to the first tab.
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('a');
  });
});
