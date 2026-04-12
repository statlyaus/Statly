import { Inngest } from 'inngest';

export const DRAFT_COMPLETED_EVENT = 'statly/draft.completed' as const;
export const DRAFT_REPAIR_EVENT = 'statly/draft.repair-requested' as const;

export type DraftCompletedEventData = {
  draftId: string;
  leagueId: string;
  season: number;
  completedAt: string;
};

export type DraftRepairEventData = {
  draftId: string;
  leagueId: string;
  season: number;
  requestedAt: string;
};

export const inngest = new Inngest({
  id: 'statly',
  ...(process.env.INNGEST_EVENT_KEY
    ? {
        eventKey: process.env.INNGEST_EVENT_KEY,
      }
    : {}),
});
