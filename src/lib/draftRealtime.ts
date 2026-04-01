import { calculateSnakeTurn } from '@/server/draft/domain/draftRules';
import {
  draftProjectionService,
  type LegacyDraftUpdate,
} from '@/server/draft/services/DraftProjectionService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

export type { LegacyDraftUpdate };

export function calculateSnakeLogic(currentPick: number, teamCount: number) {
  const participants = Array.from({ length: Math.max(teamCount, 1) }, (_, index) => ({
    memberId: `slot-${index + 1}`,
    userId: `slot-${index + 1}`,
    slot: index + 1,
    displayName: `Slot ${index + 1}`,
    role: 'MANAGER',
  }));

  const turn = calculateSnakeTurn(currentPick, participants);
  return {
    round: turn.round,
    direction: turn.direction,
    slot: turn.slot,
  };
}

export async function buildAuthoritativeDraftState(draftId: string) {
  return draftProjectionService.buildAuthoritativeDraftState(draftId);
}

export async function buildLegacyDraftUpdate(draftId: string): Promise<LegacyDraftUpdate | null> {
  return draftProjectionService.buildLegacyDraftUpdate(draftId);
}

export async function emitAuthoritativeDraftState(draftId: string) {
  return draftRealtimePublisher.publishDraftState(draftId);
}

export async function emitAuthoritativeDraftEvent(
  draftId: string,
  event: 'draft:pick-made' | 'draft:auto-pick' | 'draft:paused' | 'draft:resumed' | 'draft:completed',
  payload?: Parameters<typeof draftRealtimePublisher.publishDraftEvent>[2]
) {
  return draftRealtimePublisher.publishDraftEvent(draftId, event, payload);
}
