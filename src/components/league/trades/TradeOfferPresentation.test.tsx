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
    expect(within(packageRegion).getByRole('listitem')).toHaveTextContent(
      'Alex AlphaAdelaide Crows · MID12 GPsample size'
    );
    expect(
      screen.queryByRole('region', { name: /player averages, horizontally scrollable/ })
    ).not.toBeInTheDocument();
  });

  it('distinguishes outgoing and incoming packages with semantic trade tokens', () => {
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

    expect(outgoing).toHaveStyle('border-top-color: var(--trade-send)');
    expect(incoming).toHaveStyle('border-top-color: var(--trade-receive)');
    expect(outgoing.firstElementChild).toHaveStyle('background-color: var(--trade-send-soft)');
    expect(incoming.firstElementChild).toHaveStyle('background-color: var(--trade-receive-soft)');
    expect(within(outgoing).getByRole('heading', { name: 'You send' })).toHaveStyle(
      'color: var(--trade-send)'
    );
    expect(within(incoming).getByRole('heading', { name: 'You receive' })).toHaveStyle(
      'color: var(--trade-receive)'
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
