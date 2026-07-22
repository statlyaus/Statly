import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TradeTeamDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeRosterWorkspace } from './TradeRosterWorkspace';

vi.mock('next/image', () => ({
  default: ({
    alt = '',
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

const viewerTeam: TradeTeamDto = {
  memberId: 'robbo-rockers',
  teamName: 'Robbo Rockers',
  teamLogoUrl: null,
  isViewer: true,
  players: [
    {
      id: 'robbo-mid',
      name: 'Riley Rocker',
      club: 'Richmond',
      position: 'MID',
    },
  ],
};

const partnerTeam: TradeTeamDto = {
  memberId: 'afl-legends',
  teamName: 'AFL Legends',
  teamLogoUrl: null,
  isViewer: false,
  players: [
    {
      id: 'legend-fwd',
      name: 'Alex Legend',
      club: 'Adelaide Crows',
      position: 'FWD',
    },
    {
      id: 'legend-def',
      name: 'Casey Legend',
      club: 'Carlton',
      position: 'DEF',
    },
  ],
};

const playerStats: LeaguePlayerStatDatasetDto = {
  context: {
    basis: 'PER_GAME',
    period: 'SEASON',
    season: 2026,
    availableSeasons: [2026],
    dataThrough: null,
  },
  columns: [],
  playersById: {},
};

const defaultProps = {
  viewerTeam,
  partnerTeam,
  playerStats,
  sendingPlayerIds: ['robbo-mid'],
  receivingPlayerIds: ['legend-fwd', 'legend-def'],
  activeRoster: 'sending' as const,
  disabled: false,
  onToggleSendingPlayer: vi.fn(),
  onToggleReceivingPlayer: vi.fn(),
  onActiveRosterChange: vi.fn(),
};

describe('TradeRosterWorkspace', () => {
  it('renders symmetric roster headings and accessible responsive controls', () => {
    render(<TradeRosterWorkspace {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Robbo Rockers sends' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AFL Legends sends' })).toBeInTheDocument();
    expect(screen.queryByText(/You (?:send|receive)/i)).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Choose roster' })).toHaveClass('lg:hidden');

    const sendButton = screen.getByRole('button', {
      name: 'Send Robbo Rockers, 1 selected',
    });
    const receiveButton = screen.getByRole('button', {
      name: 'Receive AFL Legends, 2 selected',
    });

    expect(sendButton).toHaveAttribute('type', 'button');
    expect(sendButton).toHaveAttribute('aria-pressed', 'true');
    expect(sendButton).toHaveClass('h-11', 'bg-[color:var(--trade-selection)]');
    expect(sendButton.className).not.toContain('var(--trade-selection,var(');
    expect(receiveButton).toHaveAttribute('type', 'button');
    expect(receiveButton).toHaveAttribute('aria-pressed', 'false');
    expect(receiveButton).toHaveClass('h-11');
    expect(sendButton.parentElement).toHaveClass('lg:hidden');

    const sendingPanelId = sendButton.getAttribute('aria-controls');
    const receivingPanelId = receiveButton.getAttribute('aria-controls');
    expect(sendingPanelId).toBeTruthy();
    expect(receivingPanelId).toBeTruthy();
    expect(sendingPanelId).not.toBe(receivingPanelId);

    const sendingPanel = document.getElementById(sendingPanelId!);
    const receivingPanel = document.getElementById(receivingPanelId!);
    expect(sendingPanel).toHaveClass('min-w-0', 'block');
    expect(sendingPanel).not.toHaveClass('hidden');
    expect(receivingPanel).toHaveClass('min-w-0', 'hidden', 'lg:block');
    expect(sendingPanel).not.toHaveAttribute('aria-hidden');
    expect(receivingPanel).not.toHaveAttribute('aria-hidden');
    expect(sendingPanel?.parentElement).toHaveClass('min-w-0', 'lg:grid-cols-2');
  });

  it('switches the controlled active roster without changing controlled selections', async () => {
    const user = userEvent.setup();
    const onActiveRosterChange = vi.fn();

    function Harness(): React.JSX.Element {
      const [activeRoster, setActiveRoster] = useState<'sending' | 'receiving'>('sending');

      return (
        <TradeRosterWorkspace
          {...defaultProps}
          activeRoster={activeRoster}
          onActiveRosterChange={(roster) => {
            onActiveRosterChange(roster);
            setActiveRoster(roster);
          }}
        />
      );
    }

    render(<Harness />);

    const receiveButton = screen.getByRole('button', {
      name: 'Receive AFL Legends, 2 selected',
    });
    await user.click(receiveButton);

    expect(onActiveRosterChange).toHaveBeenCalledTimes(1);
    expect(onActiveRosterChange).toHaveBeenCalledWith('receiving');
    expect(screen.getByRole('button', { name: 'Send Robbo Rockers, 1 selected' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(receiveButton).toHaveAttribute('aria-pressed', 'true');

    const sendingPanel = document.getElementById(
      screen
        .getByRole('button', { name: 'Send Robbo Rockers, 1 selected' })
        .getAttribute('aria-controls')!
    );
    const receivingPanel = document.getElementById(receiveButton.getAttribute('aria-controls')!);
    expect(sendingPanel).toHaveClass('hidden', 'lg:block');
    expect(receivingPanel).toHaveClass('block');
    expect(receivingPanel).not.toHaveClass('hidden');

    expect(screen.getByRole('checkbox', { name: /Riley Rocker/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Alex Legend/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Casey Legend/ })).toBeChecked();
    expect(defaultProps.onToggleSendingPlayer).not.toHaveBeenCalled();
    expect(defaultProps.onToggleReceivingPlayer).not.toHaveBeenCalled();
  });

  it('routes each roster toggle to the correct controlled callback', async () => {
    const user = userEvent.setup();
    const onToggleSendingPlayer = vi.fn();
    const onToggleReceivingPlayer = vi.fn();

    render(
      <TradeRosterWorkspace
        {...defaultProps}
        sendingPlayerIds={[]}
        receivingPlayerIds={[]}
        onToggleSendingPlayer={onToggleSendingPlayer}
        onToggleReceivingPlayer={onToggleReceivingPlayer}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: /Riley Rocker/ }));
    await user.click(screen.getByRole('checkbox', { name: /Alex Legend/ }));

    expect(onToggleSendingPlayer).toHaveBeenCalledTimes(1);
    expect(onToggleSendingPlayer).toHaveBeenCalledWith('robbo-mid');
    expect(onToggleReceivingPlayer).toHaveBeenCalledTimes(1);
    expect(onToggleReceivingPlayer).toHaveBeenCalledWith('legend-fwd');
  });

  it('forwards disabled state to both roster tables', () => {
    render(<TradeRosterWorkspace {...defaultProps} disabled />);

    expect(screen.getByRole('searchbox', { name: 'Search Robbo Rockers roster' })).toBeDisabled();
    expect(screen.getByRole('searchbox', { name: 'Search AFL Legends roster' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Riley Rocker/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Alex Legend/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Casey Legend/ })).toBeDisabled();

    const legendTable = screen
      .getByRole('heading', { name: 'AFL Legends sends' })
      .closest('section');
    expect(legendTable).not.toBeNull();
    expect(within(legendTable!).getAllByRole('checkbox')).toHaveLength(2);
  });
});
