// src/lib/scheduling.ts
// -----------------------------------------------------------------------------
// Single-file scheduling helper for Statly
// Exports the exact API your UI consumes:
//   - generateCompleteSchedule(settings)
//   - validateLeagueSettings(settings)
//   - LEAGUE_PRESETS
//   - type LeagueSettings
//   - type ScheduleResult
//
// NOTE: WeekMatch now uses nullable team IDs (number | null) to explicitly
// represent bye weeks instead of using 0 as a sentinel value. This makes the
// API more clear for consumers who need to detect and handle byes.
// -----------------------------------------------------------------------------

export type LeagueSettings = {
  numTeams: number; // N
  seasonWeeks: number; // total usable weeks (AFL rounds you want to use)
  matchupsPerOpponent: 1 | 2; // single or double round-robin target
  playoffs?: {
    enabled: boolean;
    teams: number; // F (e.g., 4, 6, 8, 10…)
    legLengthWeeks: number; // 1 (single week) or 2 (two-week aggregate)
    reseedEachRound: boolean;
    includeConsolation: boolean; // (not scheduled here; reserved for future)
  };
};

export type WeekMatch = {
  homeTeam: number | null; // null indicates a bye (no team assigned)
  awayTeam: number | null; // null indicates a bye (no team assigned)
};
export type WeekBlock = {
  week: number;
  phase: 'regular' | 'playoffs';
  matches: WeekMatch[];
  roundName?: string;
};

export type ScheduleSummary = {
  regularSeasonWeeks: number;
  playoffWeeks: number;
  totalMatches: number;
};

export type ScheduleResult =
  | {
      success: true;
      regularSeason: WeekBlock[];
      playoffs: WeekBlock[];
      summary: ScheduleSummary;
    }
  | {
      success: false;
      error: string;
    };

// Validation constants
const MIN_TEAMS = 4;
const MAX_TEAMS = 20;
const MIN_SEASON_WEEKS = 6;
const MAX_SEASON_WEEKS = 30;
const MIN_LEG_LENGTH = 1;
const MAX_LEG_LENGTH = 3;

// --------------------------------- PRESETS -----------------------------------

export const LEAGUE_PRESETS = {
  CLASSIC_8_TEAM: {
    label: 'Classic 8',
    settings: {
      numTeams: 8,
      seasonWeeks: 18,
      matchupsPerOpponent: 2,
      playoffs: {
        enabled: true,
        teams: 4,
        legLengthWeeks: 1,
        reseedEachRound: false,
        includeConsolation: false,
      },
    } as LeagueSettings,
  },
  CLASSIC_10_TEAM: {
    label: 'Classic 10',
    settings: {
      numTeams: 10,
      seasonWeeks: 20,
      matchupsPerOpponent: 2,
      playoffs: {
        enabled: true,
        teams: 6,
        legLengthWeeks: 1,
        reseedEachRound: true,
        includeConsolation: false,
      },
    } as LeagueSettings,
  },
  CLASSIC_12_TEAM: {
    label: 'Classic 12',
    settings: {
      numTeams: 12,
      seasonWeeks: 22,
      matchupsPerOpponent: 2,
      playoffs: {
        enabled: true,
        teams: 6,
        legLengthWeeks: 1,
        reseedEachRound: true,
        includeConsolation: false,
      },
    } as LeagueSettings,
  },
} as const;

// ------------------------------- VALIDATION ----------------------------------

export function validateLeagueSettings(s: LeagueSettings): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Number.isInteger(s.numTeams) || s.numTeams < MIN_TEAMS || s.numTeams > MAX_TEAMS) {
    errors.push(`numTeams must be an integer between ${MIN_TEAMS} and ${MAX_TEAMS}.`);
  }
  if (
    !Number.isInteger(s.seasonWeeks) ||
    s.seasonWeeks < MIN_SEASON_WEEKS ||
    s.seasonWeeks > MAX_SEASON_WEEKS
  ) {
    errors.push(
      `seasonWeeks must be a reasonable AFL span (${MIN_SEASON_WEEKS}–${MAX_SEASON_WEEKS}).`
    );
  }
  if (!(s.matchupsPerOpponent === 1 || s.matchupsPerOpponent === 2)) {
    errors.push('matchupsPerOpponent must be 1 or 2.');
  }
  if (s.playoffs?.enabled) {
    const F = s.playoffs.teams;
    if (!Number.isInteger(F) || F < 2 || F > s.numTeams) {
      errors.push('playoffs.teams must be between 2 and numTeams.');
    }
    if (s.playoffs.legLengthWeeks < MIN_LEG_LENGTH || s.playoffs.legLengthWeeks > MAX_LEG_LENGTH) {
      errors.push(`playoffs.legLengthWeeks must be ${MIN_LEG_LENGTH}–${MAX_LEG_LENGTH}.`);
    }
  }
  return { isValid: errors.length === 0, errors };
}

// ------------------------------ CORE HELPERS ---------------------------------

const nextPow2 = (x: number) => 1 << Math.ceil(Math.log2(Math.max(1, x)));
const pow2Rounds = (p: number) => Math.log2(p) | 0;

// Circle method (Berger tables) with odd/even handling
function generateRoundRobinPairs(N: number): number[][][] {
  // Returns: rounds => pairs => [home, away], using team IDs 1..N
  const teams = Array.from({ length: N }, (_, i) => i + 1);
  const isOdd = N % 2 === 1;
  const padded = isOdd ? [...teams, 0] : teams; // 0 = bye
  const M = padded.length;
  const half = M / 2;

  const rounds: number[][][] = [];
  let arr = [...padded];

  for (let r = 0; r < M - 1; r++) {
    const pairs: number[][] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[M - 1 - i];
      if (a !== 0 && b !== 0) {
        // Alternate home/away to balance across rounds
        pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
      // if either is 0 → bye (skip)
    }
    rounds.push(pairs);
    // rotate (fix index 0)
    arr = [arr[0], ...arr.slice(-1), ...arr.slice(1, -1)];
  }
  return rounds;
}

function buildRegularSeason(
  N: number,
  targetWeeks: number,
  matchupsPerOpponent: 1 | 2
): WeekBlock[] {
  const srr = generateRoundRobinPairs(N); // size ~ N-1 (or N if odd, byes removed)
  let rounds = [...srr];
  if (matchupsPerOpponent === 2) {
    const mirror = srr.map((wk) => wk.map(([h, a]) => [a, h]));
    rounds = rounds.concat(mirror);
  }

  // Trim or fill to target
  if (rounds.length > targetWeeks) {
    rounds = rounds.slice(0, targetWeeks);
  } else if (rounds.length < targetWeeks) {
    const need = targetWeeks - rounds.length;
    const fillers: number[][][] = [];
    for (let i = 0; i < need; i++) {
      const base = srr[i % srr.length].map(([h, a]) => [a, h]); // reverse home/away for variety
      fillers.push(base);
    }
    rounds = rounds.concat(fillers);
  }

  // Map to WeekBlock[]
  return rounds.map((pairs, idx) => ({
    week: idx + 1,
    phase: 'regular' as const,
    matches: pairs.map(([homeTeam, awayTeam]) => ({ homeTeam, awayTeam })),
  }));
}

// Build playoffs as single-elimination with next-power-of-two bracket and byes.
// We schedule a “skeleton” bracket (seed vs seed) and leave scoring/advancement to game logic.
type SeedMatch = { homeSeed: number | null; awaySeed: number | null };
type PlayoffRound = SeedMatch[];

function canonicalOrderForPow2(p: number): number[] {
  // Returns 1-based slot order to place seeds 1..p in a balanced bracket.
  // Recursive split/flip pattern.
  if (p <= 1) return [1];
  if (p === 2) return [1, 2];
  const half = p / 2;
  const top = canonicalOrderForPow2(half);
  const bot = canonicalOrderForPow2(half).map((s) => s + half);
  const out: number[] = [];
  for (let i = 0; i < half; i++) out.push(top[i], bot[half - 1 - i]);
  return out;
}

function buildPlayoffSkeleton(F: number, reseed: boolean): PlayoffRound[] {
  const P = nextPow2(F);
  const slots: (number | null)[] = Array(P).fill(null);
  const order = canonicalOrderForPow2(P);
  for (let i = 0; i < F; i++) {
    const slotIdx = order[i] - 1;
    slots[slotIdx] = i + 1; // seeds 1..F
  }

  const rounds: PlayoffRound[] = [];
  let current = [...slots];
  while (current.length >= 2) {
    const round: PlayoffRound = [];
    for (let i = 0; i < current.length; i += 2) {
      round.push({ homeSeed: current[i], awaySeed: current[i + 1] });
    }
    rounds.push(round);

    // Predict winners by lower seed (for shaping only); handle byes
    let winners: (number | null)[] = round.map((m) => {
      if (m.homeSeed && !m.awaySeed) return m.homeSeed;
      if (!m.homeSeed && m.awaySeed) return m.awaySeed;
      if (m.homeSeed && m.awaySeed) return Math.min(m.homeSeed, m.awaySeed);
      return null;
    });

    if (reseed) {
      const live = winners.filter((w): w is number => w !== null).sort((a, b) => a - b);
      if (live.length <= 1) {
        winners = [...live];
      } else {
        const nextBracketSize = nextPow2(live.length);
        const orderNext = canonicalOrderForPow2(nextBracketSize);
        const reseeded: (number | null)[] = Array(nextBracketSize).fill(null);
        for (let i = 0; i < live.length; i++) {
          reseeded[orderNext[i] - 1] = live[i];
        }
        winners = reseeded;
      }
    }

    current = winners;
  }

  return rounds;
}

function expandRounds(rounds: PlayoffRound[], legLengthWeeks: number): PlayoffRound[] {
  if (legLengthWeeks <= 1) return rounds;
  const out: PlayoffRound[] = [];
  for (const r of rounds) for (let i = 0; i < legLengthWeeks; i++) out.push(structuredClone(r));
  return out;
}

function playoffRoundName(roundIndex: number, totalPow2: number): string {
  const roundsTotal = pow2Rounds(totalPow2);
  const idxFromEnd = roundsTotal - roundIndex;
  if (idxFromEnd === 1) return 'Grand Final';
  if (idxFromEnd === 2) return 'Semi Finals';
  if (idxFromEnd === 3) return 'Quarter Finals';
  return 'Finals';
}

// ---------------------------- PUBLIC GENERATOR -------------------------------

export function generateCompleteSchedule(settings: LeagueSettings): ScheduleResult {
  const v = validateLeagueSettings(settings);
  if (!v.isValid) return { success: false, error: v.errors.join(' ') };

  const N = settings.numTeams;
  const playoffsEnabled = settings.playoffs?.enabled ?? false;

  // Compute playoff week budget
  const F = playoffsEnabled ? settings.playoffs!.teams : 0;
  const P = playoffsEnabled ? nextPow2(F) : 0;
  const playoffRoundsCount = playoffsEnabled ? pow2Rounds(P) : 0;
  const legLen = playoffsEnabled ? Math.max(1, settings.playoffs!.legLengthWeeks) : 0;
  const playoffWeeks = playoffsEnabled ? playoffRoundsCount * legLen : 0;

  const regularSeasonWeeks = Math.max(0, settings.seasonWeeks - playoffWeeks);

  // Build regular season
  const regular = buildRegularSeason(N, regularSeasonWeeks, settings.matchupsPerOpponent);

  // Build playoffs (optional)
  let playoffBlocks: WeekBlock[] = [];
  if (playoffsEnabled) {
    const skeleton = buildPlayoffSkeleton(F, !!settings.playoffs?.reseedEachRound);
    const expanded = expandRounds(skeleton, legLen);
    // Map to WeekBlock with seed-based placeholder matches (teams map externally by seed)
    // For display in the demo we’ll just show Seed X vs Seed Y as team numbers.
    playoffBlocks = expanded.map((round, idx) => {
      const matches: WeekMatch[] = round.map((m) => {
        // Preserve null values for bye weeks - UI can detect and handle appropriately
        const homeTeam = m.homeSeed;
        const awayTeam = m.awaySeed;
        return { homeTeam, awayTeam };
      });
      return {
        week: regularSeasonWeeks + idx + 1,
        phase: 'playoffs' as const,
        matches,
        roundName: playoffRoundName(idx, P),
      };
    });
  }

  // Summary
  const totalMatches =
    regular.reduce((acc, w) => acc + w.matches.length, 0) +
    playoffBlocks.reduce((acc, w) => acc + w.matches.length, 0);

  return {
    success: true,
    regularSeason: regular,
    playoffs: playoffBlocks,
    summary: {
      regularSeasonWeeks,
      playoffWeeks,
      totalMatches,
    },
  };
}
