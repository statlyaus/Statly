import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LivePickHeader from './LivePickHeader';

function liveDraftData() {
  return {
    id: 'draft-1',
    currentPick: 1,
    totalPicks: 24,
    round: 1,
    direction: 'FORWARD',
    status: 'LIVE',
    pickDeadlineAt: '2026-05-20T04:38:31.461Z',
    participants: [
      {
        slot: 1,
        member: {
          id: 'member-1',
          userId: 'user-1',
          displayName: 'Statly Dev Tester',
          email: 'tester@statly.dev',
        },
      },
      {
        slot: 2,
        member: {
          id: 'member-2',
          userId: 'user-2',
          displayName: 'Fixture Bot',
          email: 'bot@statly.dev',
        },
      },
    ],
    picks: [],
  };
}

describe('LivePickHeader', () => {
  it('renders the pick deadline with deterministic 24-hour draft timezone formatting', () => {
    render(
      <LivePickHeader
        draftData={liveDraftData()}
        isYourTurn
        onClockMemberId="member-1"
        timePerPick={120}
        yourSlot={1}
      />
    );

    expect(document.body).toHaveTextContent('Deadline 14:38:31');
  });
});
