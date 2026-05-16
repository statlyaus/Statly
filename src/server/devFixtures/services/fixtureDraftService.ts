import { leagueDraftProvisioningService } from '@/server/draft/services/LeagueDraftProvisioningService';

import type { DevFixtureStepResult } from '../core/types';

export async function ensureFixtureDrafts(input: {
  leagueIds: string[];
}): Promise<DevFixtureStepResult[]> {
  const steps: DevFixtureStepResult[] = [];

  for (const leagueId of input.leagueIds) {
    const result = await leagueDraftProvisioningService.syncFromLeagueSettings(leagueId);
    steps.push({
      name: `draft ${leagueId}`,
      status: result.status === 'skipped' ? 'skipped' : result.status,
      detail: result.draft
        ? `${result.status} draft ${result.draft.id} (${result.draft.status}).`
        : `Draft provisioning skipped: ${result.reason ?? 'unknown reason'}.`,
    });
  }

  return steps;
}
