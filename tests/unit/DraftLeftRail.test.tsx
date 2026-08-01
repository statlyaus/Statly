import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import DraftLeftRail, { type DraftLeftRailRosterSlot } from '@/components/draft/DraftLeftRail';

const rosterSlots: DraftLeftRailRosterSlot[] = [
  {
    id: 'slot-1',
    label: 'Bench 1',
    position: 'MID',
    player: {
      id: 'player-1',
      name: 'Caleb Daniel',
      club: 'North Melbourne',
      position: 'DEF',
    },
  },
  {
    id: 'slot-2',
    label: 'Bench 2',
    position: 'FWD',
  },
];

function renderRail({
  draftStatus,
  storageKey = 'draft-left-rail-test',
}: {
  draftStatus: string;
  storageKey?: string;
}) {
  return render(
    <DraftLeftRail
      draftStatus={draftStatus}
      storageKey={storageKey}
      rosterSlots={rosterSlots}
      queueCount={2}
      watchlistCount={3}
      queuePanel={<div>Queue panel content</div>}
      watchlistPanel={<div>Watchlist panel content</div>}
    />
  );
}

describe('DraftLeftRail', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('defaults to the queue before the draft starts', () => {
    renderRail({ draftStatus: 'SCHEDULED' });

    expect(screen.getByRole('tab', { name: /queue 2/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Queue panel content')).toBeInTheDocument();
    expect(screen.queryByText('Caleb Daniel')).not.toBeInTheDocument();
  });

  it('defaults to the roster once the draft is live', () => {
    renderRail({ draftStatus: 'LIVE' });

    expect(screen.getByRole('tab', { name: /roster/i })).toHaveAttribute('aria-selected', 'true');
    const filledSlot = screen.getByText('Caleb Daniel').closest('li');
    const emptySlot = screen.getByText('Empty slot').closest('li');
    if (!filledSlot || !emptySlot) throw new Error('Expected filled and empty roster slots');

    expect(filledSlot).toHaveAttribute('data-roster-state', 'filled');
    expect(filledSlot).toHaveClass('bg-[color:var(--draft-broadcast-roster-filled)]');
    expect(within(filledSlot).getByText('Bench 1')).toBeInTheDocument();
    expect(within(filledSlot).getByText('Caleb Daniel')).toBeInTheDocument();
    expect(emptySlot).toHaveAttribute('data-roster-state', 'empty');
    expect(emptySlot).toHaveClass('bg-background');
    expect(emptySlot).toHaveClass('border-dashed');
    expect(within(emptySlot).getByText('Bench 2')).toBeInTheDocument();
    expect(within(emptySlot).getByText('Empty slot')).toBeInTheDocument();
    expect(screen.queryByText('Queue panel content')).not.toBeInTheDocument();
  });

  it('persists a manual watchlist choice and uses it on subsequent renders', async () => {
    const user = userEvent.setup();
    const storageKey = 'draft-left-rail-persisted-choice';
    const firstRender = renderRail({ draftStatus: 'LIVE', storageKey });

    await user.click(screen.getByRole('tab', { name: /watchlist 3/i }));

    expect(window.sessionStorage.getItem(storageKey)).toBe('watchlist');
    expect(screen.getByText('Watchlist panel content')).toBeInTheDocument();

    firstRender.unmount();
    renderRail({ draftStatus: 'SCHEDULED', storageKey });

    expect(screen.getByRole('tab', { name: /watchlist 3/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('Watchlist panel content')).toBeInTheDocument();
    expect(screen.queryByText('Queue panel content')).not.toBeInTheDocument();
  });

  it('keeps non-roster panels inside a scrollable panel body', () => {
    renderRail({ draftStatus: 'SCHEDULED' });

    const queuePanel = screen.getByRole('tabpanel', { name: /queue 2/i });

    expect(queuePanel).toHaveClass('overflow-hidden');
    expect(screen.getByText('Queue panel content').parentElement).toHaveClass('overflow-y-auto');
  });

  it('supports roving keyboard navigation between rail tabs', async () => {
    const user = userEvent.setup();
    renderRail({ draftStatus: 'LIVE' });

    const rosterTab = screen.getByRole('tab', { name: /roster/i });
    const queueTab = screen.getByRole('tab', { name: /queue 2/i });
    const watchlistTab = screen.getByRole('tab', { name: /watchlist 3/i });

    rosterTab.focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => expect(queueTab).toHaveFocus());
    expect(queueTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Queue panel content')).toBeInTheDocument();

    await user.keyboard('{End}');

    await waitFor(() => expect(watchlistTab).toHaveFocus());
    expect(watchlistTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Watchlist panel content')).toBeInTheDocument();

    await user.keyboard('{Home}');

    await waitFor(() => expect(rosterTab).toHaveFocus());
    expect(rosterTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Caleb Daniel')).toBeInTheDocument();
  });
});
