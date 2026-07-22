import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TradeSelectionTray } from './TradeSelectionTray';

function renderTray(overrides: Partial<React.ComponentProps<typeof TradeSelectionTray>> = {}): {
  onClear: ReturnType<typeof vi.fn>;
  onReview: ReturnType<typeof vi.fn>;
  reviewButtonRef: React.RefObject<HTMLButtonElement | null>;
} {
  const onClear = vi.fn();
  const onReview = vi.fn();
  const reviewButtonRef = createRef<HTMLButtonElement>();

  render(
    <TradeSelectionTray
      selectedCount={0}
      selectionComplete={false}
      disabled={false}
      reviewButtonRef={reviewButtonRef}
      onClear={onClear}
      onReview={onReview}
      {...overrides}
    />
  );

  return { onClear, onReview, reviewButtonRef };
}

describe('TradeSelectionTray', () => {
  it('announces an incomplete empty selection and disables both actions', () => {
    renderTray();

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(within(status).getByText('0 players selected')).toBeInTheDocument();
    expect(within(status).getByText('Select from both teams')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);

    const clearButton = screen.getByRole('button', { name: 'Clear selected players' });
    const reviewButton = screen.getByRole('button', { name: 'Review trade' });
    expect(clearButton).toBeDisabled();
    expect(reviewButton).toBeDisabled();
    expect(clearButton).toHaveAttribute('type', 'button');
    expect(reviewButton).toHaveAttribute('type', 'button');
    expect(clearButton).toHaveClass('h-11');
    expect(reviewButton).toHaveClass('h-11');
  });

  it('enables and routes both actions for a complete two-player selection', async () => {
    const user = userEvent.setup();
    const { onClear, onReview } = renderTray({ selectedCount: 2, selectionComplete: true });

    expect(screen.getByText('2 players selected')).toBeInTheDocument();
    expect(screen.getByText('Ready to review')).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: 'Clear selected players' });
    const reviewButton = screen.getByRole('button', { name: 'Review trade' });
    expect(clearButton).toBeEnabled();
    expect(reviewButton).toBeEnabled();

    await user.click(clearButton);
    await user.click(reviewButton);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('uses singular grammar and only enables clearing for a partial selection', async () => {
    const user = userEvent.setup();
    const { onClear, onReview } = renderTray({ selectedCount: 1 });

    expect(screen.getByText('1 player selected')).toBeInTheDocument();
    expect(screen.queryByText('1 players selected')).not.toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: 'Clear selected players' });
    expect(clearButton).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Review trade' })).toBeDisabled();

    await user.click(clearButton);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onReview).not.toHaveBeenCalled();
  });

  it('updates the single live region when the selection becomes complete', () => {
    const reviewButtonRef = createRef<HTMLButtonElement>();
    const props = {
      disabled: false,
      reviewButtonRef,
      onClear: vi.fn(),
      onReview: vi.fn(),
    };
    const { rerender } = render(
      <TradeSelectionTray {...props} selectedCount={1} selectionComplete={false} />
    );

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Select from both teams');

    rerender(<TradeSelectionTray {...props} selectedCount={2} selectionComplete />);

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('2 players selected');
    expect(screen.getByRole('status')).toHaveTextContent('Ready to review');
  });

  it('disables both actions while the complete selection is busy', () => {
    renderTray({ selectedCount: 2, selectionComplete: true, disabled: true });

    expect(screen.getByRole('button', { name: 'Clear selected players' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review trade' })).toBeDisabled();
  });

  it('attaches the supplied ref to the review action', () => {
    const { reviewButtonRef } = renderTray({ selectedCount: 2, selectionComplete: true });

    expect(reviewButtonRef.current).toBe(screen.getByRole('button', { name: 'Review trade' }));
  });

  it('uses a bounded neutral layout with safe-area and responsive action sizing', () => {
    renderTray({ selectedCount: 2, selectionComplete: true });

    expect(screen.queryByText(/Trade valid/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();

    const tray = screen.getByRole('status').closest('[data-trade-selection-tray]');
    expect(tray).toHaveProperty('tagName', 'DIV');
    expect(tray).toHaveClass('shrink-0');
    expect(tray).toHaveClass('pb-[max(0.75rem,env(safe-area-inset-bottom))]');
    expect(tray).not.toHaveClass('fixed');
    expect(tray).not.toHaveClass('sticky');

    const clearButton = screen.getByRole('button', { name: 'Clear selected players' });
    const reviewButton = screen.getByRole('button', { name: 'Review trade' });
    expect(clearButton).toHaveClass('w-full', 'sm:w-auto');
    expect(reviewButton).toHaveClass('w-full', 'sm:w-auto');
  });
});
