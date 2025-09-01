import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WatchlistPlayerAlert } from '../WatchlistPlayerAlert';

describe('WatchlistPlayerAlert', () => {
  const alert = { id: '1', name: 'Test Player', position: 'MID', club: 'AAA' };

  it('renders and dismisses an alert', () => {
    const handleDismiss = vi.fn();
    render(
      <WatchlistPlayerAlert
        alerts={[alert]}
        onDismiss={handleDismiss}
        onDismissAll={vi.fn()}
      />
    );

    expect(screen.getByText('Watchlist Player Drafted!')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss alert'));
    expect(handleDismiss).toHaveBeenCalledWith('1');
  });

  it('shows dismiss all when multiple alerts present', () => {
    const handleDismissAll = vi.fn();
    render(
      <WatchlistPlayerAlert
        alerts={[alert, { ...alert, id: '2' }]}
        onDismiss={vi.fn()}
        onDismissAll={handleDismissAll}
      />
    );

    expect(
      screen.getByText('2 watchlist players drafted')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss all alerts'));
    expect(handleDismissAll).toHaveBeenCalled();
  });
});
