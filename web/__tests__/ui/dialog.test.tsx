import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '@/components/ui/dialog';

describe('Dialog', () => {
  it('renders title, description and children when open', () => {
    render(
      <Dialog open onClose={() => {}} title="My Dialog" description="Some detail">
        <p>Body content</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('My Dialog')).toBeInTheDocument();
    expect(screen.getByText('Some detail')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Hidden">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Esc test">
        <p>Body</p>
      </Dialog>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the overlay is clicked', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Overlay test">
        <p>Body</p>
      </Dialog>,
    );
    const overlay = document.querySelector('[aria-hidden="true"].absolute');
    expect(overlay).not.toBeNull();
    await userEvent.click(overlay as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders footer content', () => {
    render(
      <Dialog open onClose={() => {}} title="Footer" footer={<button>Done</button>}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
