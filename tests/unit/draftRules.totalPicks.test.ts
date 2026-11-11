import { DraftDirection, DraftStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { assertCurrentPickIsOpen, buildNextDraftState } from '@/server/draft/domain/draftRules';
import type { DraftAggregate } from '@/server/draft/domain/draftTypes';

// Two teams with 13 + 4 roster spots would ask for 34 picks; a short player pool stores 20.
function cappedDraft(currentPick: number): DraftAggregate {
  return {
    id: 'draft-1',
    leagueId: 'league-1',
    status: DraftStatus.LIVE,
    currentPick,
    totalPicks: 20,
    round: 10,
    direction: DraftDirection.FORWARD,
    startedAt: null,
    completedAt: null,
    pickStartedAt: null,
    pickDeadlineAt: null,
    pausedRemainingSeconds: null,
    clockDurationSeconds: 120,
    schedulingVersion: 0,
    eventSequence: 0,
    participants: [
      { memberId: 'm1', userId: 'u1', slot: 1, displayName: 'One', role: 'MANAGER' },
      { memberId: 'm2', userId: 'u2', slot: 2, displayName: 'Two', role: 'MANAGER' },
    ],
    settings: {
      rosterSize: 13,
      benchSize: 4,
      pickSeconds: 120,
      allowAutoPick: true,
      selectedCategories: [],
      draftType: 'SNAKE',
    },
    picks: [],
  } as DraftAggregate;
}

describe('draft completion follows the stored totalPicks', () => {
  it('completes the draft on the last stored pick, as the pick timers do', () => {
    expect(buildNextDraftState(cappedDraft(20))).toMatchObject({
      isComplete: true,
      nextStatus: DraftStatus.COMPLETED,
    });
  });

  it('refuses a pick past the stored total', () => {
    expect(() => assertCurrentPickIsOpen(cappedDraft(21))).toThrow('Draft is already complete');
  });
});
