// Maps the AFL fixture the ETL writes to Firestore `matches` (etl/fixtureIngest.ts) into the DTO
// the round matches page and `/api/matches` serve.

import type { ETLMatch } from '@/lib/etlIntegration';

export interface RoundMatchDTO {
  id: string;
  matchDate: string | null;
  homeTeam: string;
  awayTeam: string;
  // The fixture carries no scores yet; these stay null until a score source exists.
  scoreHome: number | null;
  scoreAway: number | null;
  round: number;
  status: ETLMatch['status'];
}

/** A round's fixture matches as DTOs, earliest start first. */
export function mapRoundFixture(matches: readonly ETLMatch[]): RoundMatchDTO[] {
  return [...matches]
    .sort((a, b) => a.start_time_utc.localeCompare(b.start_time_utc))
    .map((match) => ({
      id: match.match_uid,
      matchDate: match.start_time_utc || null,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      scoreHome: null,
      scoreAway: null,
      round: match.round_number,
      status: match.status,
    }));
}

/** An AFL round number from a request: Opening Round 0 onwards, finals included. */
export function parseFixtureRound(value: string | null | undefined): number | null {
  return value && /^\d+$/.test(value.trim()) ? Number(value) : null;
}

/** A fixture season from a request; when none is given, this year's season in Melbourne. */
export function parseFixtureSeason(value: string | null | undefined, now: Date): number | null {
  if (value === null || value === undefined || value === '') {
    return Number(
      new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric' }).format(
        now
      )
    );
  }
  return /^\d{4}$/.test(value.trim()) ? Number(value) : null;
}
