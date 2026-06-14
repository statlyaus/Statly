import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DraftAnalytics from '@/components/draft/DraftAnalytics';
import type { DraftParticipant, DraftPick, DraftState } from '@/types/draft';

describe('DraftAnalytics', () => {
  it('counts participant picks by member id when pick payloads do not include user ids', () => {
    const draft = {
      id: 'draft-1',
      status: 'COMPLETED',
      currentPick: 3,
      totalPicks: 2,
      round: 1,
      direction: 'FORWARD',
      settings: {
        totalRounds: 1,
      },
    } as DraftState;
    const participants = [
      {
        id: 'member-1',
        userId: 'statly-dev-tester',
        displayName: 'Robbo Rockers',
        teamName: 'Robbo Rockers',
        draftOrder: 1,
        isOnline: false,
      },
      {
        id: 'member-2',
        userId: 'bot-1',
        displayName: 'AFL Legends',
        teamName: 'AFL Legends',
        draftOrder: 2,
        isOnline: false,
      },
    ] as DraftParticipant[];
    const picks = [
      {
        id: 'pick-1',
        overall: 1,
        round: 1,
        slot: 1,
        auto: false,
        madeAt: new Date('2026-06-13T10:00:00.000Z'),
        player: {
          id: 'player-1',
          name: 'Player One',
          position: 'MID',
          club: 'Sydney',
        },
        member: {
          id: 'member-1',
          displayName: 'Robbo Rockers',
          teamName: 'Robbo Rockers',
        },
      },
      {
        id: 'pick-2',
        overall: 2,
        round: 1,
        slot: 2,
        auto: true,
        madeAt: new Date('2026-06-13T10:01:00.000Z'),
        player: {
          id: 'player-2',
          name: 'Player Two',
          position: 'DEF',
          club: 'Collingwood',
        },
        member: {
          id: 'member-2',
          displayName: 'AFL Legends',
          teamName: 'AFL Legends',
        },
      },
    ] as DraftPick[];

    render(<DraftAnalytics draft={draft} picks={picks} participants={participants} />);

    const robboRow = screen.getByRole('row', { name: /robbo rockers/i });
    const legendsRow = screen.getByRole('row', { name: /afl legends/i });

    expect(within(robboRow).getAllByRole('cell')[1]).toHaveTextContent('1');
    expect(within(legendsRow).getAllByRole('cell')[1]).toHaveTextContent('1');
  });
});
