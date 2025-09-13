// Main scheduling service that orchestrates regular season and playoff generation

import {
  buildPlayoffs,
  expandPlayoffRounds,
  calculatePlayoffRequirements,
  generateRoundNames,
  buildConsolationBracket,
} from './playoffs';
import { buildRegularSeasonSchedule, validateScheduleFeasibility } from './roundRobin';

import type { LeagueSettings, ScheduleResult, Match, WeeklySchedule } from './types';

/**
 * Generates a complete league schedule including regular season and playoffs.
 */
export function generateCompleteSchedule(settings: LeagueSettings): ScheduleResult {
  // Calculate playoff weeks first
  const playoffWeeks = settings.playoffs?.enabled
    ? calculatePlayoffRequirements(settings.playoffs.teams, settings.playoffs.legLengthWeeks)
        .totalWeeks
    : 0;

  // Validate the schedule is feasible
  const feasibility = validateScheduleFeasibility(
    settings.numTeams,
    settings.seasonWeeks,
    playoffWeeks,
    settings.matchupsPerOpponent
  );

  if (!feasibility.feasible) {
    return {
      success: false,
      error: `Schedule not feasible: ${feasibility.warnings.join(', ')}`,
      regularSeason: [],
      playoffs: [],
      consolation: [],
      summary: {
        totalWeeks: 0,
        regularSeasonWeeks: 0,
        playoffWeeks: 0,
        totalMatches: 0,
      },
    };
  }

  try {
    // Generate regular season schedule (raw format)
    const regularSeasonRaw = buildRegularSeasonSchedule(
      settings.numTeams,
      feasibility.availableRegularWeeks,
      settings.matchupsPerOpponent
    );

    // Convert to WeeklySchedule format
    const regularSeason: WeeklySchedule[] = regularSeasonRaw.map((weekMatches, weekIndex) => ({
      week: weekIndex + 1,
      matches: weekMatches.map((match, matchIndex) => ({
        id: `regular-w${weekIndex + 1}-m${matchIndex + 1}`,
        week: weekIndex + 1,
        homeTeam: match[0],
        awayTeam: match[1],
        isPlayoff: false,
        isByeWeek: false,
      })),
      isPlayoff: false,
    }));

    // Generate playoff brackets if enabled
    let playoffs: WeeklySchedule[] = [];
    let consolation: WeeklySchedule[] = [];

    if (settings.playoffs?.enabled && settings.playoffs.teams > 0) {
      const { teams: playoffTeams, legLengthWeeks } = settings.playoffs;

      // Build main playoff bracket
      const playoffRounds = buildPlayoffs(playoffTeams, settings.playoffs.reseedEachRound);
      const expandedRounds = expandPlayoffRounds(playoffRounds, legLengthWeeks);
      const roundNames = generateRoundNames(playoffRounds.length);

      // Convert playoff rounds to weekly schedule format
      playoffs = expandedRounds.map((round, weekIndex) => {
        const actualRoundIndex = Math.floor(weekIndex / legLengthWeeks);
        const legWeek = (weekIndex % legLengthWeeks) + 1;
        const roundName = roundNames[actualRoundIndex];
        const weekName = legLengthWeeks > 1 ? `${roundName} (Week ${legWeek})` : roundName;

        const matches: Match[] = round.map((matchup, matchIndex) => ({
          id: `playoff-w${weekIndex + 1}-m${matchIndex + 1}`,
          week: regularSeason.length + weekIndex + 1,
          homeTeam: matchup.homeSeed ?? 0,
          awayTeam: matchup.awaySeed ?? 0,
          round: weekName,
          isPlayoff: true,
          isByeWeek: !matchup.homeSeed || !matchup.awaySeed,
        }));

        return {
          week: regularSeason.length + weekIndex + 1,
          matches,
          roundName: weekName,
          isPlayoff: true,
        };
      });

      // Generate consolation bracket if there are non-playoff teams
      if (settings.numTeams > playoffTeams) {
        const consolationRounds = buildConsolationBracket(
          settings.numTeams,
          playoffTeams,
          settings.playoffs.reseedEachRound
        );
        const expandedConsolation = expandPlayoffRounds(consolationRounds, legLengthWeeks);

        consolation = expandedConsolation.map((round, weekIndex) => {
          const actualRoundIndex = Math.floor(weekIndex / legLengthWeeks);
          const legWeek = (weekIndex % legLengthWeeks) + 1;
          const roundName = `Consolation Round ${actualRoundIndex + 1}`;
          const weekName = legLengthWeeks > 1 ? `${roundName} (Week ${legWeek})` : roundName;

          const matches: Match[] = round.map((matchup, matchIndex) => ({
            id: `consolation-w${weekIndex + 1}-m${matchIndex + 1}`,
            week: regularSeason.length + weekIndex + 1,
            homeTeam: (matchup.homeSeed ?? 0) + playoffTeams,
            awayTeam: (matchup.awaySeed ?? 0) + playoffTeams,
            round: weekName,
            isPlayoff: true,
            isConsolation: true,
            isByeWeek: !matchup.homeSeed || !matchup.awaySeed,
          }));

          return {
            week: regularSeason.length + weekIndex + 1,
            matches,
            roundName: weekName,
            isPlayoff: true,
            isConsolation: true,
          };
        });
      }
    }

    // Calculate total matches
    const totalMatches =
      regularSeason.reduce((total, week) => total + week.matches.length, 0) +
      playoffs.reduce((total, week) => total + week.matches.length, 0) +
      consolation.reduce((total, week) => total + week.matches.length, 0);

    return {
      success: true,
      regularSeason,
      playoffs,
      consolation,
      summary: {
        totalWeeks: regularSeason.length + playoffs.length,
        regularSeasonWeeks: regularSeason.length,
        playoffWeeks: playoffs.length,
        totalMatches,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      regularSeason: [],
      playoffs: [],
      consolation: [],
      summary: {
        totalWeeks: 0,
        regularSeasonWeeks: 0,
        playoffWeeks: 0,
        totalMatches: 0,
      },
    };
  }
}

/**
 * Validates league settings and provides helpful feedback.
 */
export function validateLeagueSettings(settings: LeagueSettings): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basic validation
  if (settings.numTeams < 2) {
    errors.push('League must have at least 2 teams');
  }

  if (settings.seasonWeeks < 1) {
    errors.push('Season must have at least 1 week');
  }

  if (settings.matchupsPerOpponent < 1) {
    errors.push('Must play each opponent at least once');
  }

  // Playoff validation
  if (settings.playoffs?.enabled && settings.playoffs.teams > 0) {
    const { teams: playoffTeams, legLengthWeeks } = settings.playoffs;

    if (playoffTeams > settings.numTeams) {
      errors.push('Cannot have more playoff teams than total teams');
    }

    if (playoffTeams < 2) {
      errors.push('Playoffs must include at least 2 teams');
    }

    if (legLengthWeeks < 1) {
      errors.push('Playoff leg length must be at least 1 week');
    }

    // Check if playoffs fit in available weeks
    const playoffRequiredWeeks = settings.playoffs?.enabled
      ? calculatePlayoffRequirements(settings.playoffs.teams, settings.playoffs.legLengthWeeks)
          .totalWeeks
      : 0;

    const regularSeasonFeasibility = validateScheduleFeasibility(
      settings.numTeams,
      settings.seasonWeeks,
      playoffRequiredWeeks,
      settings.matchupsPerOpponent
    );

    if (regularSeasonFeasibility.feasible) {
      const totalRequiredWeeks = settings.seasonWeeks; // Total available weeks

      if (totalRequiredWeeks > settings.seasonWeeks) {
        errors.push(
          `Season too short: need ${totalRequiredWeeks} weeks but only ${settings.seasonWeeks} available`
        );
      }
    }

    // Warnings for suboptimal configurations
    if (playoffTeams === settings.numTeams) {
      warnings.push(
        'All teams make playoffs - consider reducing playoff teams for more competitive regular season'
      );
    }

    if (playoffTeams > settings.numTeams / 2) {
      warnings.push(
        'More than half the teams make playoffs - consider reducing for better competitive balance'
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Preview schedule requirements without generating full schedule.
 */
export function previewScheduleRequirements(settings: LeagueSettings) {
  const playoffRequiredWeeks = settings.playoffs?.enabled
    ? calculatePlayoffRequirements(settings.playoffs.teams, settings.playoffs.legLengthWeeks)
        .totalWeeks
    : 0;

  const regularSeasonFeasibility = validateScheduleFeasibility(
    settings.numTeams,
    settings.seasonWeeks,
    playoffRequiredWeeks,
    settings.matchupsPerOpponent
  );

  let playoffRequirements = null;

  if (settings.playoffs?.enabled) {
    playoffRequirements = calculatePlayoffRequirements(
      settings.playoffs.teams,
      settings.playoffs.legLengthWeeks
    );
  }

  const totalWeeks =
    regularSeasonFeasibility.availableRegularWeeks + (playoffRequirements?.totalWeeks ?? 0);

  return {
    regularSeason: regularSeasonFeasibility,
    playoffs: playoffRequirements,
    totalWeeks,
    fitsInSeason: totalWeeks <= settings.seasonWeeks,
    weeksRemaining: settings.seasonWeeks - totalWeeks,
  };
}

/**
 * Common league format presets for easy setup.
 */
export const LEAGUE_PRESETS = {
  CLASSIC_8_TEAM: {
    name: '8-Team Classic',
    settings: {
      numTeams: 8,
      seasonWeeks: 16,
      matchupsPerOpponent: 2,
      playoffs: {
        enabled: true,
        teams: 4,
        legLengthWeeks: 1,
        reseedEachRound: false,
        includeConsolation: false,
      },
    },
  },
  LARGE_12_TEAM: {
    name: '12-Team League',
    settings: {
      numTeams: 12,
      seasonWeeks: 20,
      matchupsPerOpponent: 1,
      playoffs: {
        enabled: true,
        teams: 6,
        legLengthWeeks: 1,
        reseedEachRound: true,
        includeConsolation: true,
      },
    },
  },
  CHAMPIONSHIP_SERIES: {
    name: 'Championship Series (Two-Week Finals)',
    settings: {
      numTeams: 10,
      seasonWeeks: 18,
      matchupsPerOpponent: 1,
      playoffs: {
        enabled: true,
        teams: 8,
        legLengthWeeks: 2,
        reseedEachRound: false,
        includeConsolation: false,
      },
    },
  },
} as const;
