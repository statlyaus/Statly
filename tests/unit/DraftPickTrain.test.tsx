import type { ImgHTMLAttributes } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DraftPickTrain from '@/components/draft/DraftPickTrain';
import {
  toDraftPickTrainState,
  type DraftPickTrainState,
} from '@/lib/mappers/draftUiMappers';
import type { DraftParticipant, DraftPick, DraftState } from '@/types/draft';

vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

const trainState: DraftPickTrainState = {
  currentPick: 2,
  totalPicks: 12,
  round: 1,
  direction: 'FORWARD',
  slots: [
    {
      overall: 1,
      round: 1,
      slot: 1,
      status: 'completed',
      isUserPick: false,
      teamName: 'North Melbourne',
      displayName: 'North Melbourne',
      player: {
        id: 'player-1',
        name: 'Caleb Daniel',
        position: 'DEF',
        club: 'North Melbourne',
      },
    },
    {
      overall: 2,
      round: 1,
      slot: 2,
      status: 'current',
      isUserPick: false,
      teamName: 'Beta FC',
      displayName: 'Beta',
    },
    {
      overall: 3,
      round: 1,
      slot: 3,
      status: 'upcoming',
      isUserPick: false,
      teamName: 'Gamma FC',
      displayName: 'Gamma',
    },
    {
      overall: 4,
      round: 1,
      slot: 4,
      status: 'upcoming',
      isUserPick: true,
      teamName: 'Delta FC',
      displayName: 'Delta',
    },
  ],
};

describe('DraftPickTrain', () => {
  it("renders completed, current, upcoming, and user's next pick states", () => {
    render(<DraftPickTrain state={trainState} timeLeft={90} />);

    expect(screen.getByRole('region', { name: 'Draft pick train' })).toBeInTheDocument();
    expect(screen.getByText('Caleb Daniel')).toBeInTheDocument();
    expect(screen.getByText('On the clock')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('Your next pick')).toBeInTheDocument();
    expect(screen.getByText('North Melbourne')).toBeInTheDocument();
  });
});

describe('toDraftPickTrainState', () => {
  it('maps snake order, pick statuses, and user-next insertion across a round boundary', () => {
    const participants = [
      {
        id: 'member-1',
        userId: 'user-1',
        displayName: 'Alpha',
        teamName: 'Alpha FC',
        draftOrder: 1,
      },
      {
        id: 'member-2',
        userId: 'user-2',
        displayName: 'Beta',
        teamName: 'Beta FC',
        draftOrder: 2,
      },
      {
        id: 'member-3',
        userId: 'user-3',
        displayName: 'Gamma',
        teamName: 'Gamma FC',
        draftOrder: 3,
      },
      {
        id: 'member-4',
        userId: 'user-4',
        displayName: 'Delta',
        teamName: 'Delta FC',
        draftOrder: 4,
      },
      {
        id: 'member-5',
        userId: 'user-5',
        displayName: 'Epsilon',
        teamName: 'Epsilon FC',
        draftOrder: 5,
      },
      {
        id: 'member-6',
        userId: 'user-6',
        displayName: 'Zeta',
        teamName: 'Zeta FC',
        draftOrder: 6,
      },
    ] as DraftParticipant[];
    const draft = {
      id: 'draft-1',
      currentPick: 7,
      totalPicks: 18,
      round: 2,
      direction: 'REVERSE',
      status: 'LIVE',
    } as DraftState;
    const picks = [
      {
        id: 'pick-6',
        overall: 6,
        round: 1,
        slot: 6,
        auto: false,
        madeAt: new Date('2026-06-07T00:00:00.000Z'),
        player: {
          id: 'player-6',
          name: 'Completed Player',
          position: 'MID',
          club: 'Collingwood',
        },
        member: {
          id: 'member-6',
          displayName: 'Zeta',
          teamName: 'Zeta FC',
        },
      },
    ] as DraftPick[];

    const state = toDraftPickTrainState({
      draft,
      participants,
      picks,
      yourSlot: 1,
    });

    expect(state.slots.map((slot) => slot.overall)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(state.slots.map((slot) => slot.slot)).toEqual([6, 6, 5, 4, 3, 2, 1]);
    expect(state.slots.map((slot) => slot.status)).toEqual([
      'completed',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(state.slots[0].player?.name).toBe('Completed Player');
    expect(state.slots[1]).toMatchObject({
      overall: 7,
      round: 2,
      slot: 6,
      displayName: 'Zeta',
      teamName: 'Zeta FC',
      isUserPick: false,
    });
    expect(state.slots[6]).toMatchObject({
      overall: 12,
      round: 2,
      slot: 1,
      isUserPick: true,
      displayName: 'Alpha',
      teamName: 'Alpha FC',
    });
  });
});
