import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import WaiverFAABSystem from '@/components/waivers/WaiverFAABSystem';

vi.mock('@/lib/timezone', () => ({
  formatInTimezone: (value: Date | string) => new Date(value).toISOString(),
  getBrowserTimeZone: () => 'Australia/Melbourne',
}));

describe('WaiverFAABSystem table view', () => {
  it('shows free agents in a draft-style table with league category averages and row claim actions', async () => {
    const user = userEvent.setup();

    render(
      <WaiverFAABSystem
        availablePlayers={[
          {
            id: 'player-1',
            name: 'Darcy Cameron',
            team: 'COL',
            position: 'RUC',
            ownership: 0,
            statlyZScore: 6.85,
            stats: {
              goals: 0.2,
              tackles: 4.8,
              inside50s: 1.1,
            },
          },
        ]}
        rosterDropOptions={[
          { id: 'owned-1', name: 'Nick Daicos', team: 'COL', position: 'MID' },
        ]}
        selectedCategories={['goals', 'tackles', 'inside50s']}
        userClaims={[]}
        currentBalance={75}
        pendingBids={0}
        totalBudget={100}
        userTeamName="Statly Testers"
      />
    );

    expect(screen.getByRole('heading', { name: 'Waivers Overview' })).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Available waiver players' });
    expect(within(table).getByRole('columnheader', { name: 'Player' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Profile' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'League Stats' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Goals' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Tackles' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Inside 50s' })).toBeInTheDocument();
    expect(within(table).getByText('Darcy Cameron')).toBeInTheDocument();
    expect(within(table).getByText('6.85')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Claim Darcy Cameron' }));

    expect(within(table).getByLabelText('FAAB bid')).toBeInTheDocument();
    expect(within(table).getByLabelText('Drop player')).toBeInTheDocument();
    expect(
      within(table).getByRole('button', { name: 'Submit claim for Darcy Cameron' })
    ).toBeInTheDocument();
  });
});
