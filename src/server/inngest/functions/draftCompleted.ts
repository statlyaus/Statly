import { primeLeagueMatchupSlates } from '@/lib/leagueMatchupPrewarm';
import {
  getComputedLeagueRound,
  getComputedLeagueSeasonState,
  ensureLeagueSeasonMaterialized,
} from '@/lib/leagueSeason';
import { logger } from '@/lib/logger';
import {
  DRAFT_COMPLETED_EVENT,
  DRAFT_REPAIR_EVENT,
  inngest,
  type DraftCompletedEventData,
  type DraftRepairEventData,
} from '@/lib/inngest/client';

export async function processDraftFollowUpWorkflow(
  input: DraftCompletedEventData | DraftRepairEventData
) {
  const materialized = await ensureLeagueSeasonMaterialized({
    leagueId: input.leagueId,
    season: input.season,
  });
  const state = await getComputedLeagueSeasonState({
    leagueId: input.leagueId,
    season: input.season,
  });
  const round = getComputedLeagueRound({ state });
  const prewarm =
    typeof round === 'number'
      ? await primeLeagueMatchupSlates({
          season: input.season,
          round,
          status:
            state.scheduleWeeks.find((week) => week.current)?.status ??
            state.scheduleWeeks.find((week) => week.aflRound === round)?.status ??
            'scheduled',
        })
      : null;

  logger.info('Processed draft follow-up workflow', {
    draftId: input.draftId,
    leagueId: input.leagueId,
    season: input.season,
    round,
    bootstrapped: materialized.bootstrapped,
    reason: materialized.reason,
    prewarm,
  });

  return {
    leagueId: input.leagueId,
    season: input.season,
    round,
    bootstrapped: materialized.bootstrapped,
    reason: materialized.reason,
    prewarm,
  };
}

export const draftCompletedFunction = inngest.createFunction(
  { id: 'draft-completed-follow-up', triggers: [{ event: DRAFT_COMPLETED_EVENT }] },
  async ({ event, step }) => {
    return step.run('process-draft-completed-follow-up', async () =>
      processDraftFollowUpWorkflow(event.data as DraftCompletedEventData)
    );
  }
);

export const draftRepairFunction = inngest.createFunction(
  { id: 'draft-repair-follow-up', triggers: [{ event: DRAFT_REPAIR_EVENT }] },
  async ({ event, step }) => {
    return step.run('process-draft-repair-follow-up', async () =>
      processDraftFollowUpWorkflow(event.data as DraftRepairEventData)
    );
  }
);
