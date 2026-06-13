export type DraftRoomStatus =
  | 'SCHEDULED'
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'LIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | string;

export type DraftRoomParticipant = {
  id?: string;
  userId?: string;
  displayName?: string;
  teamName?: string;
  draftOrder?: number;
  slot?: number;
  member?: {
    id?: string;
    userId?: string;
    displayName?: string;
    teamName?: string;
  };
};

export type DraftRoomPick = {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player?: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
  member?: {
    id: string;
    displayName: string;
    teamName?: string;
  };
  auto?: boolean;
  madeAt?: Date | string;
};

export type DraftRoomSequenceSlot = {
  overall: number;
  round: number;
  slot: number;
  status: 'completed' | 'current' | 'upcoming';
  isUserPick: boolean;
  displayName: string;
  teamName?: string;
  picksUntil: number;
  estimatedSecondsUntil: number;
  player?: NonNullable<DraftRoomPick['player']>;
};

export type DraftRoomSequence = {
  phase: DraftRoomStatus;
  current: DraftRoomSequenceSlot | null;
  nextUserPick: DraftRoomSequenceSlot | null;
  slots: DraftRoomSequenceSlot[];
};

export type DraftRoomTimerState = {
  remainingSeconds: number;
  percentRemaining: number;
  tone: 'neutral' | 'healthy' | 'warning' | 'urgent' | 'complete';
  label: string;
  isRunning: boolean;
};

function toSlot(participant: DraftRoomParticipant): number {
  return Number(participant.slot ?? participant.draftOrder ?? 0);
}

export function getSlotForOverallPick(overall: number, teamCount: number): number {
  if (overall <= 0 || teamCount <= 0) return 0;

  const round = Math.ceil(overall / teamCount);
  const pickIndex = (overall - 1) % teamCount;

  return round % 2 === 1 ? pickIndex + 1 : teamCount - pickIndex;
}

export function buildDraftRoomSequence(input: {
  currentPick: number;
  totalPicks: number;
  participants: DraftRoomParticipant[];
  picks: DraftRoomPick[];
  yourSlot?: number;
  status?: DraftRoomStatus;
  timePerPick?: number;
  windowBefore?: number;
  windowAfter?: number;
}): DraftRoomSequence {
  const teamCount = input.participants.length;
  const totalPicks = Math.max(0, Math.floor(input.totalPicks));
  const currentPick = Math.max(1, Math.floor(input.currentPick || 1));
  const timePerPick = Math.max(1, Math.floor(input.timePerPick ?? 120));
  const phase = input.status ?? 'LIVE';
  const participantsBySlot = new Map(
    input.participants.map((participant) => [toSlot(participant), participant])
  );
  const picksByOverall = new Map(input.picks.map((pick) => [Number(pick.overall), pick]));
  const isComplete = phase === 'COMPLETED' || currentPick > totalPicks;
  const safeCurrent = isComplete ? totalPicks : Math.min(currentPick, Math.max(totalPicks, 1));
  const pickWindow = new Set<number>();
  const start = Math.max(1, safeCurrent - (input.windowBefore ?? 1));
  const end = Math.min(totalPicks, safeCurrent + (input.windowAfter ?? 4));

  for (let overall = start; overall <= end; overall += 1) {
    pickWindow.add(overall);
  }

  if (input.yourSlot && teamCount > 0 && !isComplete) {
    for (let overall = safeCurrent; overall <= totalPicks; overall += 1) {
      if (getSlotForOverallPick(overall, teamCount) === input.yourSlot) {
        pickWindow.add(overall);
        break;
      }
    }
  }

  const slots = [...pickWindow].sort((a, b) => a - b).map((overall) => {
    const slot = getSlotForOverallPick(overall, teamCount);
    const participant = participantsBySlot.get(slot);
    const pick = picksByOverall.get(overall);
    const status: DraftRoomSequenceSlot['status'] =
      overall === safeCurrent && !isComplete
        ? 'current'
        : overall < safeCurrent || Boolean(pick)
          ? 'completed'
          : 'upcoming';
    const member = participant?.member;

    return {
      overall,
      round: teamCount > 0 ? Math.ceil(overall / teamCount) : 1,
      slot,
      status,
      isUserPick: slot === input.yourSlot,
      displayName: member?.displayName ?? participant?.displayName ?? `Team ${slot}`,
      teamName: member?.teamName ?? participant?.teamName,
      picksUntil: Math.max(0, overall - safeCurrent),
      estimatedSecondsUntil: Math.max(0, overall - safeCurrent) * timePerPick,
      player: pick?.player,
    };
  });

  return {
    phase,
    current: isComplete ? null : (slots.find((slot) => slot.status === 'current') ?? null),
    nextUserPick: input.yourSlot
      ? (slots.find((slot) => slot.isUserPick && slot.overall >= safeCurrent) ?? null)
      : null,
    slots,
  };
}

export function getDraftRoomTimerState(input: {
  status: DraftRoomStatus;
  timePerPick: number;
  pickDeadlineAt?: string | Date | null;
  nowMs?: number;
}): DraftRoomTimerState {
  const timePerPick = Math.max(1, Math.floor(input.timePerPick));

  if (input.status === 'COMPLETED') {
    return {
      remainingSeconds: 0,
      percentRemaining: 0,
      tone: 'complete',
      label: 'Complete',
      isRunning: false,
    };
  }

  if (input.status === 'PAUSED') {
    return {
      remainingSeconds: timePerPick,
      percentRemaining: 100,
      tone: 'neutral',
      label: 'Paused',
      isRunning: false,
    };
  }

  if (input.status !== 'LIVE') {
    return {
      remainingSeconds: timePerPick,
      percentRemaining: 100,
      tone: 'neutral',
      label: 'Waiting',
      isRunning: false,
    };
  }

  const deadlineMs = input.pickDeadlineAt ? new Date(input.pickDeadlineAt).getTime() : Number.NaN;
  const remainingSeconds = Number.isFinite(deadlineMs)
    ? Math.max(0, Math.ceil((deadlineMs - (input.nowMs ?? Date.now())) / 1000))
    : timePerPick;
  const percentRemaining = Math.max(
    0,
    Math.min(100, Math.round((remainingSeconds / timePerPick) * 100))
  );

  if (remainingSeconds <= 15) {
    return {
      remainingSeconds,
      percentRemaining,
      tone: 'urgent',
      label: 'Urgent',
      isRunning: true,
    };
  }

  if (remainingSeconds <= 60) {
    return {
      remainingSeconds,
      percentRemaining,
      tone: 'warning',
      label: 'Short clock',
      isRunning: true,
    };
  }

  return {
    remainingSeconds,
    percentRemaining,
    tone: 'healthy',
    label: 'On pace',
    isRunning: true,
  };
}
