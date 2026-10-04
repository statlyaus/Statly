/**
 * Finals chances: simulate the rest of the regular season many times and count how often each
 * team finishes inside the finals places. Pure and seeded, so the same data always gives the same
 * numbers (server render, client and tests agree).
 */

export interface FinalsOddsGameResult {
  round: number;
  phase: 'REGULAR' | 'FINALS';
  status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'BYE';
  opponentId: string | null;
  result: 'W' | 'L' | 'D' | null;
  categoriesFor: number;
  categoriesAgainst: number;
}

export interface FinalsOddsTeamInput {
  memberId: string;
  wins: number;
  draws: number;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  results: readonly FinalsOddsGameResult[];
}

export type FinalsStatus = 'CLINCHED' | 'OUT' | null;

export interface FinalsOdds {
  /** Share of simulations that finish in the finals places, 0–1. */
  chance: number;
  /** Mathematically certain either way, regardless of results still to come. */
  status: FinalsStatus;
  /** Regular-season games still to finish, the live one included. */
  gamesLeft: number;
  /** Final wins (draws as half): average and the middle 80% of simulations. */
  projectedWins: number;
  winsLow: number;
  winsHigh: number;
  /** Final ladder position: the middle 80% of simulations. */
  finishHigh: number;
  finishLow: number;
}

interface Game {
  home: number;
  away: number;
  /** Chance the home side wins. */
  homeChance: number;
}

/** Categories of evidence a team's rate is pulled toward 50% by, early in a season. */
const PRIOR_CATEGORIES = 20;
/** How far a live category lead moves the odds of that game, per category, in log-odds. */
const LIVE_LEAD_WEIGHT = 0.35;

export const FINALS_SIMULATIONS = 5000;

function strength(team: FinalsOddsTeamInput): number {
  const won = team.categoryWins + team.categoryDraws / 2;
  const played = team.categoryWins + team.categoryLosses + team.categoryDraws;
  return (won + PRIOR_CATEGORIES / 2) / (played + PRIOR_CATEGORIES);
}

/** Log5: the chance a beats b given each side's rate against an average opponent. */
function headToHead(a: number, b: number): number {
  const numerator = a * (1 - b);
  const denominator = numerator + b * (1 - a);
  return denominator > 0 ? numerator / denominator : 0.5;
}

function withLiveLead(chance: number, lead: number): number {
  const clamped = Math.min(Math.max(chance, 0.01), 0.99);
  const logit = Math.log(clamped / (1 - clamped)) + LIVE_LEAD_WEIGHT * lead;
  return 1 / (1 + Math.exp(-logit));
}

/** mulberry32: small, fast, seeded. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(counts: readonly number[], total: number, share: number): number {
  let seen = 0;
  for (let index = 0; index < counts.length; index += 1) {
    seen += counts[index];
    if (seen >= total * share) return index;
  }
  return counts.length - 1;
}

/** The regular-season games still to finish, each listed once. */
function remainingGames(teams: readonly FinalsOddsTeamInput[]): Game[] {
  const index = new Map(teams.map((team, position) => [team.memberId, position]));
  const games: Game[] = [];
  const seen = new Set<string>();
  teams.forEach((team, home) => {
    for (const result of team.results) {
      if (result.phase !== 'REGULAR' || result.result !== null || !result.opponentId) continue;
      if (result.status !== 'SCHEDULED' && result.status !== 'LIVE') continue;
      const away = index.get(result.opponentId);
      if (away === undefined) continue;
      const key = `${result.round}:${Math.min(home, away)}:${Math.max(home, away)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const base = headToHead(strength(team), strength(teams[away]));
      games.push({
        home,
        away,
        homeChance:
          result.status === 'LIVE'
            ? withLiveLead(base, result.categoriesFor - result.categoriesAgainst)
            : base,
      });
    }
  });
  return games;
}

/**
 * Clinched when too few teams can still reach this team's current wins; out when enough teams
 * are already beyond anything this team can reach. Ties count against the team, so both are safe.
 */
function certainty(
  points: readonly number[],
  gamesLeft: readonly number[],
  team: number,
  finalsTeams: number
): FinalsStatus {
  let canCatch = 0;
  let alreadyBeyond = 0;
  points.forEach((value, other) => {
    if (other === team) return;
    if (value + gamesLeft[other] >= points[team]) canCatch += 1;
    if (value > points[team] + gamesLeft[team]) alreadyBeyond += 1;
  });
  if (canCatch < finalsTeams) return 'CLINCHED';
  if (alreadyBeyond >= finalsTeams) return 'OUT';
  return null;
}

/**
 * Simulates the remaining games. Teams arrive in ladder order; ties on wins fall to category
 * difference, then at random.
 */
export function simulateFinalsOdds({
  teams,
  finalsTeams,
  simulations = FINALS_SIMULATIONS,
  seed = 20260927,
}: {
  teams: readonly FinalsOddsTeamInput[];
  finalsTeams: number;
  simulations?: number;
  seed?: number;
}): Map<string, FinalsOdds> {
  const odds = new Map<string, FinalsOdds>();
  if (finalsTeams <= 0 || teams.length === 0) return odds;

  const games = remainingGames(teams);
  const points = teams.map((team) => team.wins + team.draws / 2);
  const categoryDiff = teams.map((team) => team.categoryWins - team.categoryLosses);
  const gamesLeft = teams.map(() => 0);
  for (const game of games) {
    gamesLeft[game.home] += 1;
    gamesLeft[game.away] += 1;
  }

  const runs = games.length === 0 ? 1 : simulations;
  const next = random(seed);
  const made = teams.map(() => 0);
  const winsTotal = teams.map(() => 0);
  // Final wins are counted in half-win steps.
  const winCounts = teams.map((_, team) =>
    Array.from({ length: gamesLeft[team] * 2 + 1 }, () => 0)
  );
  const finishCounts = teams.map(() => Array.from({ length: teams.length }, () => 0));
  const order = teams.map((_, team) => team);
  const final = [...points];
  const tieBreak = teams.map(() => 0);

  for (let run = 0; run < runs; run += 1) {
    for (let team = 0; team < teams.length; team += 1) {
      final[team] = points[team];
      // With nothing left to play the ladder order stands.
      tieBreak[team] = games.length > 0 ? next() : teams.length - team;
    }
    for (const game of games) {
      if (next() < game.homeChance) final[game.home] += 1;
      else final[game.away] += 1;
    }
    order.sort(
      (left, right) =>
        final[right] - final[left] ||
        categoryDiff[right] - categoryDiff[left] ||
        tieBreak[right] - tieBreak[left]
    );
    order.forEach((team, position) => {
      if (position < finalsTeams) made[team] += 1;
      finishCounts[team][position] += 1;
    });
    for (let team = 0; team < teams.length; team += 1) {
      winsTotal[team] += final[team];
      winCounts[team][Math.round((final[team] - points[team]) * 2)] += 1;
    }
  }

  teams.forEach((team, index) => {
    const status = certainty(points, gamesLeft, index, finalsTeams);
    const low = percentile(winCounts[index], runs, 0.1) / 2 + points[index];
    const high = percentile(winCounts[index], runs, 0.9) / 2 + points[index];
    odds.set(team.memberId, {
      chance: status === 'CLINCHED' ? 1 : status === 'OUT' ? 0 : made[index] / runs,
      status,
      gamesLeft: gamesLeft[index],
      projectedWins: winsTotal[index] / runs,
      winsLow: low,
      winsHigh: high,
      finishHigh: percentile(finishCounts[index], runs, 0.1) + 1,
      finishLow: percentile(finishCounts[index], runs, 0.9) + 1,
    });
  });
  return odds;
}
