// Playoff bracket generation with flexible sizing and reseeding

import type { PlayoffRound } from './types';

/**
 * Calculates the next power of 2 for bracket sizing
 */
const nextPow2 = (x: number) => 1 << Math.ceil(Math.log2(x));

/**
 * Generates canonical bracket seeding order for balanced tournament brackets
 */
function generateCanonicalOrder(p: number): number[] {
  if (p === 2) return [1, 2];
  const half = p / 2;
  const top = generateCanonicalOrder(half).map((s) => s);
  const bot = generateCanonicalOrder(half).map((s) => s + half);

  const out: number[] = [];
  for (let i = 0; i < half; i++) {
    out.push(top[i], bot[half - 1 - i]);
  }
  return out;
}

/**
 * Builds a complete playoff bracket with proper seeding and bye distribution.
 *
 * @param F - Number of playoff teams
 * @param reseedEachRound - Whether to reseed survivors each round
 * @returns Array of playoff rounds with matchups
 */
export function buildPlayoffs(F: number, reseedEachRound: boolean): PlayoffRound[] {
  const P = nextPow2(F);
  const seeds = Array.from({ length: F }, (_, i) => i + 1); // 1..F

  // Build initial slots 1..P with nulls for byes
  const slots: (number | null)[] = Array(P).fill(null);
  const canonicalOrder = generateCanonicalOrder(P);

  // Place actual seeds 1..F into the first F canonical slots; rest remain null (byes)
  for (let i = 0; i < F; i++) {
    const slotIndex = canonicalOrder[i] - 1;
    slots[slotIndex] = seeds[i];
  }

  // Build rounds until champion
  const rounds: PlayoffRound[] = [];
  let current = slots.map((s) => s);

  while (current.length >= 2) {
    const round: PlayoffRound = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      round.push({ homeSeed: a, awaySeed: b });
    }
    rounds.push(round);

    // Advance winners (use lower seed number as expected winner for bracket structure)
    let winners: (number | null)[] = round.map((m) => {
      if (m.homeSeed && !m.awaySeed) return m.homeSeed; // bye advancement
      if (!m.homeSeed && m.awaySeed) return m.awaySeed; // bye advancement
      if (m.homeSeed && m.awaySeed) return Math.min(m.homeSeed, m.awaySeed); // expected winner
      return null;
    });

    if (reseedEachRound) {
      // Reseed: sort winners by ascending seed, then redistribute into balanced slots
      const live = winners.filter((w): w is number => w !== null).sort((a, b) => a - b);
      const orderNext = generateCanonicalOrder(winners.length);
      const reseeded: (number | null)[] = Array(winners.length).fill(null);

      for (let i = 0; i < live.length; i++) {
        reseeded[orderNext[i] - 1] = live[i];
      }
      winners = reseeded;
    }

    current = winners;
  }

  return rounds;
}

/**
 * Expands playoff rounds for multi-week legs (e.g., two-week aggregate matches).
 */
export function expandPlayoffRounds(
  rounds: PlayoffRound[],
  legLengthWeeks: number
): PlayoffRound[] {
  if (legLengthWeeks <= 1) return rounds;

  const out: PlayoffRound[] = [];
  for (const r of rounds) {
    for (let i = 0; i < legLengthWeeks; i++) {
      out.push(structuredClone(r));
    }
  }
  return out;
}

/**
 * Calculates playoff requirements and validates feasibility.
 */
export function calculatePlayoffRequirements(F: number, legLengthWeeks: number) {
  const P = nextPow2(F);
  const byes = P - F;
  const rounds = Math.log2(P);
  const totalWeeks = rounds * legLengthWeeks;

  return {
    bracketSize: P,
    byes,
    rounds,
    totalWeeks,
    topSeedsWithByes: Array.from({ length: byes }, (_, i) => i + 1),
  };
}

/**
 * Generates round names for display purposes.
 */
export function generateRoundNames(numRounds: number): string[] {
  const names: string[] = [];

  if (numRounds === 1) return ['Final'];
  if (numRounds === 2) return ['Semi-Finals', 'Grand Final'];
  if (numRounds === 3) return ['Quarter-Finals', 'Semi-Finals', 'Grand Final'];
  if (numRounds === 4) return ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Grand Final'];

  // For larger tournaments
  for (let i = 0; i < numRounds - 2; i++) {
    names.push(`Round ${i + 1}`);
  }
  names.push('Semi-Finals', 'Grand Final');

  return names;
}

/**
 * Builds a consolation bracket for non-qualifying teams.
 */
export function buildConsolationBracket(
  totalTeams: number,
  playoffTeams: number,
  reseedEachRound: boolean
): PlayoffRound[] {
  const consolationTeams = totalTeams - playoffTeams;
  if (consolationTeams < 2) return [];

  // Use seeds starting from playoff teams + 1 for consolation
  return buildPlayoffs(consolationTeams, reseedEachRound);
}

/**
 * Common playoff format configurations for easy setup.
 */
export const PLAYOFF_FORMATS = {
  TOP_4: { teams: 4, description: 'Top 4 - Semi-Finals & Grand Final' },
  TOP_6: {
    teams: 6,
    description: 'Top 6 - Byes to top 2, Quarter-Finals, Semi-Finals & Grand Final',
  },
  TOP_8: { teams: 8, description: 'Top 8 - Quarter-Finals, Semi-Finals & Grand Final' },
  TOP_10: { teams: 10, description: 'Top 10 - Byes to top 6, then standard bracket' },
  TOP_12: { teams: 12, description: 'Top 12 - Byes to top 4, then standard bracket' },
} as const;
