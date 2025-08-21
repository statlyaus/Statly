// Round-robin schedule generation using Circle Method (Berger tables)

/**
 * Generates a complete round-robin schedule using the Circle Method.
 * Handles both even and odd number of teams with proper bye management.
 * 
 * @param N - Number of teams
 * @returns Array of rounds, each round contains [home, away] pairs
 */
export function generateRoundRobin(N: number): number[][][] {
  // Returns rounds; each round is list of [home, away] pairs using team IDs 1..N
  const teams = Array.from({ length: N }, (_, i) => i + 1);
  const isOdd = N % 2 === 1;
  const paddedTeams = isOdd ? [...teams, 0] : teams; // 0 = BYE
  const M = paddedTeams.length;

  const half = M / 2;
  const rounds: number[][][] = [];

  let arr = [...paddedTeams];
  for (let r = 0; r < M - 1; r++) {
    const pairs: number[][] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[M - 1 - i];
      if (a !== 0 && b !== 0) {
        // Alternate home/away by round to balance
        pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
      // If a or b is 0, that's a bye (skip)
    }
    rounds.push(pairs);
    // Rotate everything but keep index 0 fixed
    arr = [arr[0], ...arr.slice(-1), ...arr.slice(1, -1)];
  }
  return rounds;
}

/**
 * Builds a complete regular season schedule with proper round-robin and filler rounds.
 * 
 * @param N - Number of teams
 * @param targetWeeks - Target number of regular season weeks
 * @param matchupsPerOpponent - 1 for single round-robin, 2 for double
 * @returns Array of weeks with matchups
 */
export function buildRegularSeasonSchedule(
  N: number,
  targetWeeks: number,
  matchupsPerOpponent: 1 | 2
): number[][][] {
  const srr = generateRoundRobin(N);        // N-1 rounds (if N is even; odd handled internally)
  let weeks: number[][][] = [...srr];

  if (matchupsPerOpponent === 2) {
    const mirror = srr.map(round => round.map(([h, a]) => [a, h]));
    weeks = weeks.concat(mirror);
  }

  // Trim or fill to targetWeeks
  if (weeks.length > targetWeeks) {
    return weeks.slice(0, targetWeeks);
  } else if (weeks.length < targetWeeks) {
    const need = targetWeeks - weeks.length;
    // Simple, balanced filler: cycle through early rounds and flip home/away
    const fillers: number[][][] = [];
    for (let i = 0; i < need; i++) {
      const base = srr[i % srr.length].map(([h, a]) => [a, h]);
      fillers.push(base);
    }
    return weeks.concat(fillers);
  }
  return weeks;
}

/**
 * Calculates the theoretical rounds needed for complete round-robin schedules.
 */
export function calculateRoundRobinRequirements(N: number) {
  const singleRoundRobin = N - 1;
  const doubleRoundRobin = 2 * (N - 1);
  const matchesPerRound = Math.floor(N / 2);
  const hasWeeklyByes = N % 2 === 1;

  return {
    singleRoundRobin,
    doubleRoundRobin,
    matchesPerRound,
    hasWeeklyByes,
  };
}

/**
 * Validates if a schedule is feasible given constraints.
 */
export function validateScheduleFeasibility(
  N: number,
  seasonWeeks: number,
  playoffWeeks: number,
  matchupsPerOpponent: 1 | 2
): {
  feasible: boolean;
  type: 'complete' | 'partial' | 'overflow';
  availableRegularWeeks: number;
  warnings: string[];
} {
  const availableRegularWeeks = seasonWeeks - playoffWeeks;
  const requirements = calculateRoundRobinRequirements(N);
  const warnings: string[] = [];
  
  const targetRounds = matchupsPerOpponent === 1 
    ? requirements.singleRoundRobin 
    : requirements.doubleRoundRobin;

  if (availableRegularWeeks < requirements.singleRoundRobin) {
    warnings.push(`Insufficient weeks for complete single round-robin (need ${requirements.singleRoundRobin}, have ${availableRegularWeeks})`);
    return {
      feasible: false,
      type: 'partial',
      availableRegularWeeks,
      warnings
    };
  }

  if (matchupsPerOpponent === 2 && availableRegularWeeks < requirements.doubleRoundRobin) {
    warnings.push(`Insufficient weeks for complete double round-robin (need ${requirements.doubleRoundRobin}, have ${availableRegularWeeks})`);
    return {
      feasible: true,
      type: 'partial',
      availableRegularWeeks,
      warnings
    };
  }

  if (availableRegularWeeks > targetRounds) {
    const extra = availableRegularWeeks - targetRounds;
    warnings.push(`${extra} extra weeks will be filled with balanced rematches`);
    return {
      feasible: true,
      type: 'overflow',
      availableRegularWeeks,
      warnings
    };
  }

  return {
    feasible: true,
    type: 'complete',
    availableRegularWeeks,
    warnings
  };
}
