import type { ImgHTMLAttributes } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import PickFeed from '@/components/PickFeed';

vi.mock('next/image', () => ({
  default: ({ alt, src, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

const participants = [
  {
    slot: 1,
    member: {
      id: 'member-1',
      userId: 'user-1',
      displayName: 'Alpha FC',
      email: 'alpha@example.com',
    },
  },
  {
    slot: 2,
    member: {
      id: 'member-2',
      userId: 'user-2',
      displayName: 'Beta FC',
      email: 'beta@example.com',
    },
  },
  {
    slot: 3,
    member: {
      id: 'member-3',
      userId: 'user-3',
      displayName: 'Gamma FC',
      email: 'gamma@example.com',
    },
  },
];

const picks = [
  {
    id: 'pick-1',
    overall: 1,
    round: 1,
    slot: 1,
    player: {
      id: 'player-1',
      name: 'Marcus Bontempelli',
      position: 'MID',
      club: 'Western Bulldogs',
    },
    member: {
      id: 'member-1',
      displayName: 'Alpha FC',
    },
    auto: false,
    madeAt: '2026-06-07T00:00:00.000Z',
  },
  {
    id: 'pick-2',
    overall: 2,
    round: 1,
    slot: 2,
    player: {
      id: 'player-2',
      name: 'Nick Daicos',
      position: 'MID',
      club: 'Collingwood',
    },
    member: {
      id: 'member-2',
      displayName: 'Beta FC',
    },
    auto: false,
    madeAt: '2026-06-07T00:05:00.000Z',
  },
  {
    id: 'pick-3',
    overall: 3,
    round: 1,
    slot: 3,
    player: {
      id: 'player-3',
      name: 'Errol Gulden',
      position: 'MID',
      club: 'Sydney',
    },
    member: {
      id: 'member-3',
      displayName: 'Gamma FC',
    },
    auto: true,
    madeAt: '2026-06-07T00:10:00.000Z',
  },
];

const defaultProps = {
  picks,
  participants,
  userMemberId: 'member-2',
  watchlistPlayerIds: ['player-3'],
};

describe('PickFeed', () => {
  it('renders club logo next to picked player names', () => {
    render(<PickFeed {...defaultProps} />);

    const feed = screen.getByLabelText('Pick feed');
    const latestPick = within(feed)
      .getByText('Errol Gulden')
      .closest<HTMLElement>('[data-pick-state]');

    expect(latestPick).not.toBeNull();
    expect(latestPick).toHaveTextContent('Slot 3');
    expect(latestPick).toHaveTextContent('Pick 3');
    expect(latestPick).not.toHaveTextContent('View context');
    expect(screen.getByAltText('Sydney logo')).toHaveAttribute('src', '/logos/Sydney.svg');
    expect(screen.queryByText('View context')).not.toBeInTheDocument();
  });

  it('filters to my picks', () => {
    render(<PickFeed {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /mine/i }));

    expect(screen.getByText('Nick Daicos')).toBeInTheDocument();
    const mineCard = screen.getByText('Nick Daicos').closest<HTMLElement>('[data-pick-state]');
    if (!mineCard) throw new Error('Expected the user pick card');
    expect(mineCard).toHaveAttribute('data-pick-state', 'mine');
    expect(within(mineCard).getByText('Mine').querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    expect(screen.queryByText('Marcus Bontempelli')).not.toBeInTheDocument();
    expect(screen.queryByText('Errol Gulden')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 3 total picks')).toBeInTheDocument();
  });

  it('filters to watchlist picks', () => {
    render(<PickFeed {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /watchlist/i }));

    expect(screen.getByText('Errol Gulden')).toBeInTheDocument();
    const watchlistCard = screen
      .getByText('Errol Gulden')
      .closest<HTMLElement>('[data-pick-state]');
    if (!watchlistCard) throw new Error('Expected the watchlist pick card');
    expect(watchlistCard).toHaveAttribute('data-pick-state', 'watchlist');
    expect(watchlistCard).toHaveClass('border-[color:var(--draft-broadcast-watchlist-border)]');
    expect(watchlistCard).toHaveClass('bg-[color:var(--draft-broadcast-watchlist-hit)]');
    expect(within(watchlistCard).getByText('Watchlist').querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    expect(screen.queryByText('Marcus Bontempelli')).not.toBeInTheDocument();
    expect(screen.queryByText('Nick Daicos')).not.toBeInTheDocument();
    expect(screen.getAllByText('Watchlist')).toHaveLength(2);
  });

  it('toggles auto-scroll state with an accessible switch', async () => {
    const user = userEvent.setup();
    render(<PickFeed {...defaultProps} />);

    const toggle = screen.getByRole('switch', { name: 'Auto-scroll on new picks' });

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Auto-scroll on new picks')).toBeInTheDocument();
    expect(screen.queryByText('Live rail')).not.toBeInTheDocument();

    toggle.focus();
    await user.keyboard(' ');

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Manual scroll mode')).not.toBeInTheDocument();
  });

  it('fills its parent column while keeping picks in the scrollable body', () => {
    render(<PickFeed {...defaultProps} className="h-full" contentId="desktop-pick-feed" />);

    const feed = screen.getByLabelText('Pick feed');
    const content = document.getElementById('desktop-pick-feed');

    expect(feed).toHaveClass('flex');
    expect(feed).toHaveClass('h-full');
    expect(feed).toHaveClass('min-h-0');
    expect(feed).toHaveClass('flex-col');
    expect(content).toHaveClass('min-h-0');
    expect(content).toHaveClass('flex-1');
    expect(content).toHaveClass('overflow-y-auto');
    expect(content).not.toHaveClass('max-h-[calc(100vh-220px)]');
  });
});
