import type { DraftClockPayload } from '@/services/realtime/draftStateWire';
import { getDraftPickCoordinate, type DraftOrderType } from '@/lib/draftOrder';

export type DraftRoomStatus =
  'SCHEDULED' | 'LOBBY' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | string;

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
  phase: 'LIVE' | 'PAUSED' | 'FINALIZING' | 'SYNCING' | 'COMPLETED' | 'WAITING';
  remainingSeconds: number;
  percentRemaining: number;
  tone: 'neutral' | 'healthy' | 'warning' | 'urgent' | 'complete';
  label: string;
  isRunning: boolean;
};

function toSlot(participant: DraftRoomParticipant): number {
  return Number(participant.slot ?? participant.draftOrder ?? 0);
}

export function getSlotForOverallPick(
  overall: number,
  teamCount: number,
  draftType: DraftOrderType = 'SNAKE'
): number {
  if (
    !Number.isInteger(overall) ||
    !Number.isInteger(teamCount) ||
    overall <= 0 ||
    teamCount <= 0
  ) {
    return 0;
  }

  return getDraftPickCoordinate(draftType, overall, teamCount).slot;
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
  draftType?: DraftOrderType;
}): DraftRoomSequence {
  const teamCount = input.participants.length;
  const totalPicks = Math.max(0, Math.floor(input.totalPicks));
  const currentPick = Math.max(1, Math.floor(input.currentPick || 1));
  const timePerPick = Math.max(1, Math.floor(input.timePerPick ?? 120));
  const phase = input.status ?? 'LIVE';
  const draftType = input.draftType ?? 'SNAKE';
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

  const validYourSlot =
    Number.isInteger(input.yourSlot) &&
    Number(input.yourSlot) >= 1 &&
    Number(input.yourSlot) <= teamCount
      ? Number(input.yourSlot)
      : null;

  const buildSlot = (overall: number): DraftRoomSequenceSlot => {
    const slot = getSlotForOverallPick(overall, teamCount, draftType);
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
      isUserPick: slot === validYourSlot,
      displayName: member?.displayName ?? participant?.displayName ?? `Team ${slot}`,
      teamName: member?.teamName ?? participant?.teamName,
      picksUntil: Math.max(0, overall - safeCurrent),
      estimatedSecondsUntil: Math.max(0, overall - safeCurrent) * timePerPick,
      player: pick?.player,
    };
  };

  const slots = [...pickWindow].sort((a, b) => a - b).map(buildSlot);
  let nextUserPick: DraftRoomSequenceSlot | null = null;

  if (validYourSlot !== null && !isComplete) {
    for (let overall = safeCurrent; overall <= totalPicks; overall += 1) {
      if (getSlotForOverallPick(overall, teamCount, draftType) === validYourSlot) {
        nextUserPick = slots.find((slot) => slot.overall === overall) ?? buildSlot(overall);
        break;
      }
    }
  }

  return {
    phase,
    current: isComplete ? null : (slots.find((slot) => slot.status === 'current') ?? null),
    nextUserPick,
    slots,
  };
}

export function getDraftRoomTimerState(input: {
  status: DraftRoomStatus;
  timePerPick: number;
  pickDeadlineAt?: string | Date | null;
  pausedRemainingSeconds?: number | null;
  clock?: DraftClockPayload | null;
  clockReceivedAt?: number;
  nowMs?: number;
}): DraftRoomTimerState {
  const status = input.clock?.status ?? input.status;
  const timePerPick = Math.max(1, Math.floor(input.clock?.durationSeconds ?? input.timePerPick));

  if (status === 'COMPLETED') {
    return {
      phase: 'COMPLETED',
      remainingSeconds: 0,
      percentRemaining: 0,
      tone: 'complete',
      label: 'Complete',
      isRunning: false,
    };
  }

  if (status === 'PAUSED') {
    const remainingSeconds =
      input.clock?.status === 'PAUSED'
        ? input.clock.remainingSeconds
        : input.pausedRemainingSeconds;
    if (remainingSeconds === null || remainingSeconds === undefined) {
      return {
        phase: 'SYNCING',
        remainingSeconds: 0,
        percentRemaining: 0,
        tone: 'neutral',
        label: 'Syncing clock',
        isRunning: false,
      };
    }
    const safeRemainingSeconds = Math.max(0, Math.floor(remainingSeconds));
    return {
      phase: 'PAUSED',
      remainingSeconds: safeRemainingSeconds,
      percentRemaining: Math.max(
        0,
        Math.min(100, Math.round((safeRemainingSeconds / timePerPick) * 100))
      ),
      tone: 'neutral',
      label: 'Paused',
      isRunning: false,
    };
  }

  if (status === 'FINALIZING') {
    return {
      phase: 'FINALIZING',
      remainingSeconds: 0,
      percentRemaining: 0,
      tone: 'urgent',
      label: 'Finalizing pick',
      isRunning: false,
    };
  }

  if (status === 'SYNCING') {
    return {
      phase: 'SYNCING',
      remainingSeconds: 0,
      percentRemaining: 0,
      tone: 'neutral',
      label: 'Syncing clock',
      isRunning: false,
    };
  }

  if (status !== 'LIVE') {
    return {
      phase: 'WAITING',
      remainingSeconds: timePerPick,
      percentRemaining: 100,
      tone: 'neutral',
      label: 'Waiting',
      isRunning: false,
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const deadlineValue =
    input.clock?.status === 'LIVE' ? input.clock.deadlineAt : input.pickDeadlineAt;
  const deadlineMs = deadlineValue ? new Date(deadlineValue).getTime() : Number.NaN;
  if (!Number.isFinite(deadlineMs)) {
    return {
      phase: 'SYNCING',
      remainingSeconds: 0,
      percentRemaining: 0,
      tone: 'neutral',
      label: 'Syncing clock',
      isRunning: false,
    };
  }

  const serverNowMs =
    input.clock?.status === 'LIVE' ? new Date(input.clock.serverNow).getTime() : Number.NaN;
  const remainingMs =
    Number.isFinite(serverNowMs) && input.clockReceivedAt !== undefined
      ? deadlineMs - serverNowMs - Math.max(0, nowMs - input.clockReceivedAt)
      : deadlineMs - nowMs;
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const percentRemaining = Math.max(
    0,
    Math.min(100, Math.round((remainingSeconds / timePerPick) * 100))
  );

  if (remainingSeconds === 0) {
    return {
      phase: 'FINALIZING',
      remainingSeconds,
      percentRemaining,
      tone: 'urgent',
      label: 'Finalizing pick',
      isRunning: false,
    };
  }

  if (remainingSeconds <= 15) {
    return {
      phase: 'LIVE',
      remainingSeconds,
      percentRemaining,
      tone: 'urgent',
      label: 'Urgent',
      isRunning: true,
    };
  }

  if (remainingSeconds <= 60) {
    return {
      phase: 'LIVE',
      remainingSeconds,
      percentRemaining,
      tone: 'warning',
      label: 'Short clock',
      isRunning: true,
    };
  }

  return {
    phase: 'LIVE',
    remainingSeconds,
    percentRemaining,
    tone: 'healthy',
    label: 'On pace',
    isRunning: true,
  };
}
