import { DraftDirection, DraftStatus } from '@prisma/client';

import type {
  DraftAggregate,
  DraftParticipantSnapshot,
  DraftTurn,
  DraftTypeValue,
} from './draftTypes';

function calculateLinearTurn(currentPick: number, participants: DraftParticipantSnapshot[]): DraftTurn {
  const teamCount = participants.length;
  if (teamCount === 0) {
    throw new Error('Draft has no participants');
  }

  const round = Math.ceil(currentPick / teamCount);
  const slot = ((currentPick - 1) % teamCount) + 1;
  const participant = participants.find((item) => item.slot === slot);
  if (!participant) {
    throw new Error(`Draft order is missing slot ${slot}`);
  }

  return {
    round,
    slot,
    direction: DraftDirection.FORWARD,
    participant,
  };
}

export function calculateSnakeTurn(currentPick: number, participants: DraftParticipantSnapshot[]): DraftTurn {
  const teamCount = participants.length;
  if (teamCount === 0) {
    throw new Error('Draft has no participants');
  }

  const round = Math.ceil(currentPick / teamCount);
  const direction = round % 2 === 1 ? DraftDirection.FORWARD : DraftDirection.REVERSE;
  const slot =
    direction === DraftDirection.FORWARD
      ? ((currentPick - 1) % teamCount) + 1
      : teamCount - ((currentPick - 1) % teamCount);

  const participant = participants.find((item) => item.slot === slot);
  if (!participant) {
    throw new Error(`Draft order is missing slot ${slot}`);
  }

  return {
    round,
    slot,
    direction,
    participant,
  };
}

export function calculateDraftTurn(
  draftType: DraftTypeValue,
  currentPick: number,
  participants: DraftParticipantSnapshot[]
): DraftTurn {
  if (draftType === 'LINEAR') {
    return calculateLinearTurn(currentPick, participants);
  }

  return calculateSnakeTurn(currentPick, participants);
}

export function getRosterPickLimit(draft: DraftAggregate): number {
  return draft.settings.rosterSize + draft.settings.benchSize;
}

export function getExpectedTotalPicks(draft: DraftAggregate): number {
  return draft.participants.length * getRosterPickLimit(draft);
}

export function assertDraftIsLive(draft: DraftAggregate): void {
  if (draft.status !== DraftStatus.LIVE) {
    throw new Error('bad_request:Draft is not active');
  }
}

export function assertAutoPickIsAllowed(draft: DraftAggregate): void {
  if (!draft.settings.allowAutoPick) {
    throw new Error('bad_request:Auto-pick is not allowed');
  }
}

export function assertCurrentPickIsOpen(draft: DraftAggregate): void {
  const expectedTotalPicks = getExpectedTotalPicks(draft);
  if (draft.currentPick > expectedTotalPicks) {
    throw new Error('bad_request:Draft is already complete');
  }
}

export function assertActorTurn(draft: DraftAggregate, memberId: string): DraftTurn {
  const turn = calculateDraftTurn(draft.settings.draftType, draft.currentPick, draft.participants);
  if (turn.participant.memberId !== memberId) {
    throw new Error('bad_request:Not your turn to pick');
  }
  return turn;
}

export function buildNextDraftState(draft: DraftAggregate) {
  const nextPick = draft.currentPick + 1;
  const expectedTotalPicks = getExpectedTotalPicks(draft);
  const isComplete = nextPick > expectedTotalPicks;

  if (isComplete) {
    return {
      nextPick,
      isComplete: true,
      nextStatus: DraftStatus.COMPLETED,
      nextRound: draft.round,
      nextDirection: draft.direction,
    } as const;
  }

  const nextTurn = calculateDraftTurn(draft.settings.draftType, nextPick, draft.participants);
  return {
    nextPick,
    isComplete: false,
    nextStatus: DraftStatus.LIVE,
    nextRound: nextTurn.round,
    nextDirection: nextTurn.direction,
  } as const;
}
