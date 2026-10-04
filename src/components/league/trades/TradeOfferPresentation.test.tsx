import { render, screen, within } from '@testing-library/react';
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
  it('presents a compact package summary without a second horizontal stats table', () => {
    render(
      <TradeOfferAssets
        heading="You send"
        teamName="Alpha FC"
        players={players}
        playerStats={playerStats}
      />
    );

    const packageRegion = screen.getByRole('region', {
      name: 'You send package from Alpha FC',
    });
    const item = within(packageRegion).getByRole('listitem');
    expect(item).toHaveTextContent('Alex Alpha');
    expect(item).toHaveTextContent('MID · ADL');
    // The stat the player stands out in, per game.
    expect(item.textContent).toMatch(/20(\.0)?Kicks/);
    expect(
      screen.queryByRole('region', { name: /player averages, horizontally scrollable/ })
    ).not.toBeInTheDocument();
  });

  it('distinguishes outgoing and incoming packages by label, not colour', () => {
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

    expect(within(outgoing).getByRole('heading', { name: 'You send' })).toHaveClass(
      'text-[color:var(--trade-text)]'
    );
    expect(within(incoming).getByRole('heading', { name: 'You receive' })).toHaveClass(
      'text-[color:var(--trade-text)]'
    );
    expect(outgoing.outerHTML).not.toMatch(/trade-(?:send|receive)/);
    expect(incoming.outerHTML).not.toMatch(/trade-(?:send|receive)/);
  });

  it.each([
    ['PENDING', 'Pending'],
    ['ACCEPTED_PENDING_REVIEW', 'Accepted · in review'],
    ['FAILED', 'Failed'],
  ] as const)('%s shows a plain label with a status dot', (status, labelText) => {
    render(<TradeOfferStatus status={status} />);

    const label = screen.getByText(labelText);
    expect(label).toHaveClass('text-[color:var(--trade-text)]');
    const dot = label.querySelector('[aria-hidden="true"]');
    expect(dot).toHaveClass(
      status === 'FAILED' ? 'bg-[color:var(--trade-negative)]' : 'bg-[color:var(--trade-warning)]'
    );
  });
});
