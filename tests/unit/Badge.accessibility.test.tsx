import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Badge, { StatusBadge } from '@/components/ui/Badge';

describe('Badge accessibility', () => {
  it('gives button and link badges a visible keyboard focus treatment', async () => {
    const user = userEvent.setup();

    render(
      <>
        <Badge onClick={() => undefined}>Open details</Badge>
        <Badge href="/players">Browse players</Badge>
      </>
    );

    const buttonBadge = screen.getByRole('button', { name: 'Open details' });
    const linkBadge = screen.getByRole('link', { name: 'Browse players' });

    expect(buttonBadge).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring');
    expect(linkBadge).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring');

    await user.tab();
    expect(buttonBadge).toHaveFocus();

    await user.tab();
    expect(linkBadge).toHaveFocus();
  });

  it('uses badge content or an explicit override to label remove controls', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();

    const { rerender } = render(
      <Badge removable onRemove={onRemove}>
        Midfielder
      </Badge>
    );

    const removeButton = screen.getByRole('button', { name: 'Remove Midfielder' });
    expect(removeButton).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring');

    await user.click(removeButton);
    expect(onRemove).toHaveBeenCalledOnce();

    rerender(
      <Badge removable removeLabel="Remove selected role">
        <strong>Forward</strong>
      </Badge>
    );

    expect(screen.getByRole('button', { name: 'Remove selected role' })).toBeInTheDocument();
  });

  it('exposes dot-only status text without exposing the decorative dot', () => {
    const { container } = render(<StatusBadge status="away" />);

    expect(screen.getByText('Away')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
