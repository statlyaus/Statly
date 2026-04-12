import {
  getComputedLeagueRound,
  getComputedLeagueSeasonState,
  loadMaterializedMatchupsForRound,
  loadMaterializedSeasonSnapshots,
  selectComputedLeagueRoundMatchups,
} from '@/lib/leagueSeason';

export type LeagueRoundMatchupDocument = {
  id: string;
  leagueId?: string;
  participants: string[];
  homeUserId?: string;
  awayUserId?: string;
  current?: boolean;
  aflRound?: number | string | null;
  roundLabel?: string;
  status?: 'scheduled' | 'in_progress' | 'final' | string;
};

type ResolveLeagueRoundMatchupsInput = {
  leagueId: string;
  season: number;
  requestedRound: number | null;
};

type BuildLeagueMatchupContextInput = {
  authUserId: string;
  selectedMatchupId: string | null;
  round: number | null;
  roundMatchups: LeagueRoundMatchupDocument[];
};

export async function resolveLeagueRoundMatchups(input: ResolveLeagueRoundMatchupsInput): Promise<{
  round: number | null;
  roundMatchups: LeagueRoundMatchupDocument[];
}> {
  const materialized = await loadMaterializedSeasonSnapshots({
    leagueId: input.leagueId,
    season: input.season,
  });
  const round =
    input.requestedRound ??
    materialized.scheduleWeeks.find((week) => week.current)?.aflRound ??
    materialized.scheduleWeeks.find((week) => week.status === 'in_progress')?.aflRound ??
    materialized.scheduleWeeks.find((week) => week.aflRound != null)?.aflRound ??
    null;
  if (round == null) {
    const state = await getComputedLeagueSeasonState({
      leagueId: input.leagueId,
      season: input.season,
    });
    const fallbackRound = getComputedLeagueRound({
      state,
      requestedRound: input.requestedRound,
    });
    if (fallbackRound == null) {
      return { round: null, roundMatchups: [] };
    }

    return {
      round: fallbackRound,
      roundMatchups: selectComputedLeagueRoundMatchups({
        state,
        round: fallbackRound,
      }).map((matchup) => ({
        id: matchup.id,
        leagueId: 'leagueId' in matchup ? matchup.leagueId : undefined,
        participants: matchup.participants,
        homeUserId: matchup.homeUserId,
        awayUserId: matchup.awayUserId,
        current: matchup.current,
        aflRound: matchup.aflRound,
        roundLabel: matchup.roundLabel,
        status: 'status' in matchup ? matchup.status : undefined,
      })),
    };
  }

  const materializedRoundMatchups = await loadMaterializedMatchupsForRound({
    leagueId: input.leagueId,
    season: input.season,
    round,
  });
  if (materializedRoundMatchups.length > 0) {
    return {
      round,
      roundMatchups: materializedRoundMatchups.map((matchup) => ({
        id: matchup.id,
        leagueId: matchup.leagueId,
        participants: matchup.participants,
        homeUserId: matchup.homeUserId,
        awayUserId: matchup.awayUserId,
        current: matchup.current,
        aflRound: matchup.aflRound,
        roundLabel: matchup.roundLabel,
        status: matchup.status,
      })),
    };
  }

  const state = await getComputedLeagueSeasonState({
    leagueId: input.leagueId,
    season: input.season,
  });
  return {
    round,
    roundMatchups: selectComputedLeagueRoundMatchups({
      state,
      round,
    }).map((matchup) => ({
      id: matchup.id,
      leagueId: 'leagueId' in matchup ? matchup.leagueId : undefined,
      participants: matchup.participants,
      homeUserId: matchup.homeUserId,
      awayUserId: matchup.awayUserId,
      current: matchup.current,
      aflRound: matchup.aflRound,
      roundLabel: matchup.roundLabel,
      status: 'status' in matchup ? matchup.status : undefined,
    })),
  };
}

export function buildLeagueMatchupContext(input: BuildLeagueMatchupContextInput) {
  if (input.round == null || input.roundMatchups.length === 0) {
    return null;
  }

  const myCurrentMatchup = input.roundMatchups.find((matchup) =>
    matchup.participants.includes(input.authUserId)
  );
  if (!myCurrentMatchup) {
    return null;
  }

  const selectedMatchup =
    (input.selectedMatchupId
      ? input.roundMatchups.find((matchup) => matchup.id === input.selectedMatchupId)
      : undefined) ?? myCurrentMatchup;

  return {
    selectedMatchup,
    myCurrentMatchup,
    round: input.round,
  };
}
