import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import WaiverFAABSystem from '@/components/waivers/WaiverFAABSystem';

// Perth has no daylight saving, so 09:30 UTC is 5:30 pm AWST in any test runner zone.
const INSTANT = new Date('2026-10-03T09:30:00.000Z');

describe('WaiverFAABSystem times', () => {
  it('shows claim and activity times in the league timezone, labelled', () => {
    render(
      <WaiverFAABSystem
        timeZone="Australia/Perth"
        userClaims={[
          {
            id: 'claim-1',
            playerId: 'player-1',
            playerName: 'Darcy Cameron',
            playerPosition: 'RUC',
            playerTeam: 'COL',
            action: 'add',
            bidAmount: 5,
            priority: 1,
            status: 'pending',
            submittedAt: INSTANT,
            userId: 'user-1',
            userName: 'You',
          },
        ]}
        activityItems={[
          {
            id: 'activity-1',
            leagueId: 'league-1',
            type: 'waiver-successful',
            timestamp: INSTANT,
            teamName: 'Statly Testers',
            playerName: 'Darcy Cameron',
          },
        ]}
      />
    );

    expect(screen.getByText(/^Submitted Sat,? 3 Oct,? 5:30\spm AWST$/)).toBeInTheDocument();
    expect(screen.getByText(/^Sat,? 3 Oct,? 5:30\spm AWST$/)).toBeInTheDocument();
  });
});
