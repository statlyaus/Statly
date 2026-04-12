type SupportedPosition = 'DEF' | 'MID' | 'FWD' | 'RUC';

type PlayerSeedAggregate = {
  games: number;
  goals: number;
  marks: number;
  tackles: number;
  hitouts: number;
  clearances: number;
  inside50s: number;
  rebound50s: number;
  intercepts: number;
  contestedMarks: number;
  disposals: number;
};

type RawSeedRow = Record<string, unknown>;

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function normalizeAflPosition(value: unknown): SupportedPosition | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();

  if (!normalized) return null;
  if (
    normalized === 'DEF' ||
    normalized === 'MID' ||
    normalized === 'FWD' ||
    normalized === 'RUC'
  ) {
    return normalized;
  }

  if (normalized.includes('BACK') || normalized.includes('DEF')) return 'DEF';
  if (normalized.includes('FWD') || normalized.includes('FORWARD')) return 'FWD';
  if (normalized.includes('RUC')) return 'RUC';
  if (normalized.includes('MID') || normalized.includes('WING') || normalized.includes('CENTRE')) {
    return 'MID';
  }

  return null;
}

export function aggregatePlayerSeedStats(rows: RawSeedRow[]): PlayerSeedAggregate {
  const aggregate: PlayerSeedAggregate = {
    games: 0,
    goals: 0,
    marks: 0,
    tackles: 0,
    hitouts: 0,
    clearances: 0,
    inside50s: 0,
    rebound50s: 0,
    intercepts: 0,
    contestedMarks: 0,
    disposals: 0,
  };

  for (const row of rows) {
    aggregate.games += 1;
    aggregate.goals += parseNumber(row.G ?? row.goals);
    aggregate.marks += parseNumber(row.M ?? row.marks);
    aggregate.tackles += parseNumber(row.T ?? row.tackles);
    aggregate.hitouts += parseNumber(row.HO ?? row.hitouts);
    aggregate.clearances += parseNumber(row.CL ?? row.clearances);
    aggregate.inside50s += parseNumber(row.I50 ?? row.inside50s);
    aggregate.rebound50s += parseNumber(row.R50 ?? row.rebound50s);
    aggregate.intercepts += parseNumber(row.ITC ?? row.intercepts);
    aggregate.contestedMarks += parseNumber(row.CM ?? row.contestedMarks);
    aggregate.disposals += parseNumber(row.D ?? row.disposals);
  }

  return aggregate;
}

export function inferPositionFromSeedStats(
  aggregate: PlayerSeedAggregate
): SupportedPosition | null {
  if (aggregate.games <= 0) return null;

  const perGame = {
    goals: aggregate.goals / aggregate.games,
    marks: aggregate.marks / aggregate.games,
    tackles: aggregate.tackles / aggregate.games,
    hitouts: aggregate.hitouts / aggregate.games,
    clearances: aggregate.clearances / aggregate.games,
    inside50s: aggregate.inside50s / aggregate.games,
    rebound50s: aggregate.rebound50s / aggregate.games,
    intercepts: aggregate.intercepts / aggregate.games,
    contestedMarks: aggregate.contestedMarks / aggregate.games,
    disposals: aggregate.disposals / aggregate.games,
  };

  if (
    perGame.hitouts >= 18 ||
    aggregate.hitouts >= 250 ||
    (perGame.hitouts >= 15 && perGame.disposals <= 11)
  ) {
    return 'RUC';
  }

  if (perGame.goals >= 1.2 && perGame.inside50s >= 2) {
    return 'FWD';
  }

  const defenderScore =
    perGame.intercepts * 2.6 +
    perGame.rebound50s * 2.2 +
    perGame.marks * 0.45 -
    perGame.goals * 0.8;
  const midfielderScore =
    perGame.disposals * 0.62 +
    perGame.clearances * 2.3 +
    perGame.tackles * 0.85 +
    perGame.inside50s * 0.55;
  const forwardScore =
    perGame.goals * 3.3 +
    perGame.inside50s * 0.9 +
    perGame.contestedMarks * 1.7 +
    perGame.marks * 0.25 -
    perGame.rebound50s * 0.4;

  if (forwardScore >= midfielderScore && forwardScore >= defenderScore && perGame.goals >= 0.8) {
    return 'FWD';
  }

  if (
    defenderScore >= midfielderScore &&
    defenderScore >= forwardScore &&
    (perGame.intercepts >= 3 || perGame.rebound50s >= 2.5)
  ) {
    return 'DEF';
  }

  if (midfielderScore > 0) {
    return 'MID';
  }

  return null;
}
