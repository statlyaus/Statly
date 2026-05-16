import { getDefaultAflSeason } from '@/lib/aflSeason';
import { bootstrapLeagueSeason } from '@/lib/leagueSeason';

import type { DevFixtureStepResult } from '../core/types';

export async function ensureFixtureSeasons(input: {
  leagueIds: string[];
  season?: number;
}): Promise<DevFixtureStepResult[]> {
  const season = input.season ?? getDefaultAflSeason();
  const steps: DevFixtureStepResult[] = [];

  for (const leagueId of input.leagueIds) {
    const result = await bootstrapLeagueSeason({ leagueId, season });
    steps.push({
      name: `season ${leagueId}`,
      status: 'updated',
      detail: `Materialized season ${season}: ${result.weekCount} weeks, ${result.matchupCount} matchups.`,
    });
  }

  return steps;
}
