import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { LeagueTradeDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeOfferAssets } from './TradeOfferAssets';
import { TradeOfferStatus } from './TradeOfferStatus';

const players: LeagueTradeDto['currentOffer']['players'] = [
  {
    id: 'player-1',
    name: 'Alex Alpha',
    club: 'Adelaide Crows',
    position: 'MID',
    fromMemberId: 'member-1',
    toMemberId: 'member-2',
  },
];

const playerStats: LeaguePlayerStatDatasetDto = {
  context: {
    basis: 'PER_GAME',
    period: 'SEASON',
    season: 2026,
    availableSeasons: [2026],
    dataThrough: null,
  },
  columns: [
    {
      key: 'kicks',
      label: 'Kicks',
      shortLabel: 'K',
      format: 'number',
      direction: 'HIGH_WINS',
    },
  ],
  playersById: {
    'player-1': { gamesPlayed: 12, values: { kicks: 20 } },
  },
};

describe('persisted trade offer presentation', () => {
  it('makes the named horizontal stats region keyboard focusable', async () => {
    const user = userEvent.setup();
    render(
      <TradeOfferAssets
        heading="You send"
        teamName="Alpha FC"
        players={players}
        playerStats={playerStats}
      />
    );

    const scrollRegion = screen.getByRole('region', {
      name: 'Alpha FC player averages, horizontally scrollable',
    });
    expect(scrollRegion).toHaveAttribute('tabindex', '0');
    expect(scrollRegion).toHaveClass(
      'focus-visible:ring-[3px]',
      'focus-visible:ring-inset',
      'focus-visible:ring-[color:var(--trade-focus)]'
    );

    await user.tab();
    expect(scrollRegion).toHaveFocus();
  });

  it('uses one neutral brand package treatment for outgoing and incoming assets', () => {
    render(
      <>
        <TradeOfferAssets
          heading="You send"
          teamName="Alpha FC"
          players={players}
          playerStats={playerStats}
        />
        <TradeOfferAssets
          heading="You receive"
          teamName="Beta FC"
          players={players}
          playerStats={playerStats}
        />
      </>
    );

    const outgoing = screen.getByRole('region', {
      name: 'You send package from Alpha FC',
    });
    const incoming = screen.getByRole('region', {
      name: 'You receive package from Beta FC',
    });

    for (const packageRegion of [outgoing, incoming]) {
      expect(packageRegion).toHaveClass('border-t-[color:var(--trade-brand)]');
      expect(packageRegion.className).not.toMatch(/trade-(?:offer-direction|send|receive)/);
      expect(packageRegion.firstElementChild).toHaveClass('bg-[color:var(--trade-surface-subtle)]');
    }
    expect(within(outgoing).getByRole('heading', { name: 'You send' })).toHaveClass('text-base');
    expect(within(incoming).getByRole('heading', { name: 'You receive' })).toHaveClass('text-base');
    expect(within(outgoing).getByText('20.0')).toHaveClass('text-sm');
    expect(within(outgoing).getByRole('row', { name: /Alex Alpha/ }).className).not.toContain(
      'hover:'
    );
  });

  it.each([
    ['PENDING', 'Awaiting response'],
    ['ACCEPTED_PENDING_REVIEW', 'Accepted · review pending'],
    ['FAILED', 'Failed'],
  ] as const)('%s uses the direct warning surface', (status, labelText) => {
    render(<TradeOfferStatus status={status} />);

    const label = screen.getByText(labelText);
    expect(label).toHaveClass(
      'bg-[color:var(--trade-warning-soft)]',
      'text-[color:var(--trade-warning)]'
    );
    expect(label.className).not.toMatch(/trade-(?:send|receive|positive|negative)/);
  });
});
