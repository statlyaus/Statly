import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import WaiverFAABSystem from '@/components/waivers/WaiverFAABSystem';

import { clubRecordSrText, formatClubRecord, noLosersResultLabel } from './noLosersDisplay';

describe('No Losers result labels (BR-40, NFR-8)', () => {
  it.each([
    [{ clubResult: 'WIN', margin: 12, multiplier: 1 }, 'W', 'Won by 12'],
    [{ clubResult: 'DRAW', margin: 0, multiplier: 0.5 }, 'D', 'Half: drew'],
    [{ clubResult: 'LOSS', margin: -5, multiplier: 0.5 }, 'L', 'Half: lost by 5'],
    [{ clubResult: 'LOSS', margin: -6, multiplier: 0 }, 'L', 'Zeroed: lost by 6'],
    [{ clubResult: 'ABANDONED', margin: null, multiplier: 1 }, 'A', 'Abandoned: counted'],
  ])('labels %o with a letter and words', (result, badge, text) => {
    expect(noLosersResultLabel({ status: 'COUNTED', ...result })).toMatchObject({ badge, text });
  });

  it('says a pending result counts raw for now, and never guesses', () => {
    expect(noLosersResultLabel({ status: 'RESULT_PENDING' })).toMatchObject({
      text: 'Result pending',
      srText: expect.stringContaining('raw stats count'),
    });
  });

  it('formats a club record as W-L-D with a spoken version', () => {
    const record = { wins: 1, losses: 2, draws: 0 };
    expect(formatClubRecord(record)).toBe('1-2-0');
    expect(clubRecordSrText(record)).toBe('Club record 1 win, 2 losses, 0 draws');
  });
});

describe('Free agents in a No Losers league (BR-42)', () => {
  it("shows the player's next game and club record, in words for screen readers", () => {
    render(
      <WaiverFAABSystem
        availablePlayers={[
          {
            id: 'p1',
            name: 'Free Agent',
            team: 'Geelong',
            position: 'MID',
            noLosersClub: {
              record: { wins: 8, losses: 3, draws: 1 },
              next: { aflRound: 5, opponent: 'Hawthorn', isHome: false, bye: false },
            },
          },
          { id: 'p2', name: 'Other Agent', team: 'Sydney', position: 'FWD' },
        ]}
      />
    );

    expect(screen.getAllByText('Rd 5 @ HAW · 8-3-1').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Round 5: away to Hawthorn\. Club record 8 wins, 3 losses, 1 draw/).length
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Club record/)).toHaveLength(
      screen.getAllByText(/Round 5: away to Hawthorn/).length
    );
  });
});
