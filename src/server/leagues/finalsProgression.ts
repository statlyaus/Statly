export type FinalsTeamCount = 4 | 6 | 8;

export type FinalsBracketKey =
  | 'SF_1_V_4'
  | 'SF_2_V_3'
  | 'EF_3_V_6'
  | 'EF_4_V_5'
  | 'SF_1_V_EF_4_V_5'
  | 'SF_2_V_EF_3_V_6'
  | 'QF_1_V_4'
  | 'QF_2_V_3'
  | 'EF_5_V_8'
  | 'EF_6_V_7'
  | 'SF_LOSER_QF_1_V_4_V_WINNER_EF_6_V_7'
  | 'SF_LOSER_QF_2_V_3_V_WINNER_EF_5_V_8'
  | 'PF_WINNER_QF_1_V_4_V_WINNER_SF_2'
  | 'PF_WINNER_QF_2_V_3_V_WINNER_SF_1'
  | 'GF';

export interface FinalsParticipantAssignment {
  bracketKey: FinalsBracketKey;
  homeMemberId: string;
  awayMemberId: string;
}

export interface FinalizedFinalsMatchup extends FinalsParticipantAssignment {
  homeCategoryWins: number;
  awayCategoryWins: number;
}

export interface SeedFinalsBracketInput {
  finalsTeams: FinalsTeamCount;
  orderedRegularSeasonMemberIds: readonly string[];
}

export interface AdvanceFinalsBracketInput extends SeedFinalsBracketInput {
  finalizedOutcomes: readonly FinalizedFinalsMatchup[];
}

type ParticipantSource =
  | { type: 'SEED'; seed: number }
  | { type: 'WINNER'; bracketKey: FinalsBracketKey }
  | { type: 'LOSER'; bracketKey: FinalsBracketKey };

interface BracketDefinition {
  bracketKey: FinalsBracketKey;
  home: ParticipantSource;
  away: ParticipantSource;
}

interface ResolvedOutcome {
  winnerMemberId: string;
  loserMemberId: string;
}

const seed = (value: number): ParticipantSource => ({ type: 'SEED', seed: value });
const winner = (bracketKey: FinalsBracketKey): ParticipantSource => ({
  type: 'WINNER',
  bracketKey,
});
const loser = (bracketKey: FinalsBracketKey): ParticipantSource => ({
  type: 'LOSER',
  bracketKey,
});

const BRACKETS: Record<FinalsTeamCount, readonly BracketDefinition[]> = {
  4: [
    { bracketKey: 'SF_1_V_4', home: seed(1), away: seed(4) },
    { bracketKey: 'SF_2_V_3', home: seed(2), away: seed(3) },
    {
      bracketKey: 'GF',
      home: winner('SF_1_V_4'),
      away: winner('SF_2_V_3'),
    },
  ],
  6: [
    { bracketKey: 'EF_3_V_6', home: seed(3), away: seed(6) },
    { bracketKey: 'EF_4_V_5', home: seed(4), away: seed(5) },
    {
      bracketKey: 'SF_1_V_EF_4_V_5',
      home: seed(1),
      away: winner('EF_4_V_5'),
    },
    {
      bracketKey: 'SF_2_V_EF_3_V_6',
      home: seed(2),
      away: winner('EF_3_V_6'),
    },
    {
      bracketKey: 'GF',
      home: winner('SF_1_V_EF_4_V_5'),
      away: winner('SF_2_V_EF_3_V_6'),
    },
  ],
  8: [
    { bracketKey: 'QF_1_V_4', home: seed(1), away: seed(4) },
    { bracketKey: 'QF_2_V_3', home: seed(2), away: seed(3) },
    { bracketKey: 'EF_5_V_8', home: seed(5), away: seed(8) },
    { bracketKey: 'EF_6_V_7', home: seed(6), away: seed(7) },
    {
      bracketKey: 'SF_LOSER_QF_1_V_4_V_WINNER_EF_6_V_7',
      home: loser('QF_1_V_4'),
      away: winner('EF_6_V_7'),
    },
    {
      bracketKey: 'SF_LOSER_QF_2_V_3_V_WINNER_EF_5_V_8',
      home: loser('QF_2_V_3'),
      away: winner('EF_5_V_8'),
    },
    {
      bracketKey: 'PF_WINNER_QF_1_V_4_V_WINNER_SF_2',
      home: winner('QF_1_V_4'),
      away: winner('SF_LOSER_QF_2_V_3_V_WINNER_EF_5_V_8'),
    },
    {
      bracketKey: 'PF_WINNER_QF_2_V_3_V_WINNER_SF_1',
      home: winner('QF_2_V_3'),
      away: winner('SF_LOSER_QF_1_V_4_V_WINNER_EF_6_V_7'),
    },
    {
      bracketKey: 'GF',
      home: winner('PF_WINNER_QF_1_V_4_V_WINNER_SF_2'),
      away: winner('PF_WINNER_QF_2_V_3_V_WINNER_SF_1'),
    },
  ],
};

function validateSeeds(
  finalsTeams: FinalsTeamCount,
  orderedRegularSeasonMemberIds: readonly string[]
): ReadonlyMap<string, number> {
  if (!BRACKETS[finalsTeams]) {
    throw new Error(`Unsupported finals team count: ${String(finalsTeams)}`);
  }
  if (orderedRegularSeasonMemberIds.length !== finalsTeams) {
    throw new Error(`Expected exactly ${finalsTeams} ordered regular-season seeds`);
  }

  const seedByMemberId = new Map<string, number>();
  orderedRegularSeasonMemberIds.forEach((memberId, index) => {
    if (!memberId.trim()) {
      throw new Error(`Regular-season seed ${index + 1} must have a member ID`);
    }
    if (seedByMemberId.has(memberId)) {
      throw new Error(`Duplicate regular-season seed member: ${memberId}`);
    }
    seedByMemberId.set(memberId, index + 1);
  });

  return seedByMemberId;
}

function validateCategoryWins(outcome: FinalizedFinalsMatchup): void {
  for (const [label, value] of [
    ['homeCategoryWins', outcome.homeCategoryWins],
    ['awayCategoryWins', outcome.awayCategoryWins],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${outcome.bracketKey} ${label} must be a non-negative integer`);
    }
  }
}

function resolveParticipant(
  source: ParticipantSource,
  orderedRegularSeasonMemberIds: readonly string[],
  resolvedOutcomes: ReadonlyMap<FinalsBracketKey, ResolvedOutcome>
): string | null {
  if (source.type === 'SEED') {
    return orderedRegularSeasonMemberIds[source.seed - 1] ?? null;
  }

  const outcome = resolvedOutcomes.get(source.bracketKey);
  if (!outcome) return null;
  return source.type === 'WINNER' ? outcome.winnerMemberId : outcome.loserMemberId;
}

function resolveOutcome(
  outcome: FinalizedFinalsMatchup,
  seedByMemberId: ReadonlyMap<string, number>
): ResolvedOutcome {
  validateCategoryWins(outcome);

  const homeSeed = seedByMemberId.get(outcome.homeMemberId);
  const awaySeed = seedByMemberId.get(outcome.awayMemberId);
  if (!homeSeed || !awaySeed) {
    throw new Error(`${outcome.bracketKey} contains a member outside the finals seeds`);
  }

  const homeAdvances =
    outcome.homeCategoryWins > outcome.awayCategoryWins ||
    (outcome.homeCategoryWins === outcome.awayCategoryWins && homeSeed < awaySeed);

  return homeAdvances
    ? { winnerMemberId: outcome.homeMemberId, loserMemberId: outcome.awayMemberId }
    : { winnerMemberId: outcome.awayMemberId, loserMemberId: outcome.homeMemberId };
}

export function seedFinalsBracket({
  finalsTeams,
  orderedRegularSeasonMemberIds,
}: SeedFinalsBracketInput): FinalsParticipantAssignment[] {
  return advanceFinalsBracket({
    finalsTeams,
    orderedRegularSeasonMemberIds,
    finalizedOutcomes: [],
  });
}

export function advanceFinalsBracket({
  finalsTeams,
  orderedRegularSeasonMemberIds,
  finalizedOutcomes,
}: AdvanceFinalsBracketInput): FinalsParticipantAssignment[] {
  const seedByMemberId = validateSeeds(finalsTeams, orderedRegularSeasonMemberIds);
  const definitions = BRACKETS[finalsTeams];
  const outcomesByKey = new Map<FinalsBracketKey, FinalizedFinalsMatchup>();

  for (const outcome of finalizedOutcomes) {
    if (!definitions.some((definition) => definition.bracketKey === outcome.bracketKey)) {
      throw new Error(
        `${outcome.bracketKey} is not part of the ${finalsTeams}-team finals bracket`
      );
    }
    if (outcomesByKey.has(outcome.bracketKey)) {
      throw new Error(`Duplicate finalized outcome for ${outcome.bracketKey}`);
    }
    outcomesByKey.set(outcome.bracketKey, outcome);
  }

  const resolvedOutcomes = new Map<FinalsBracketKey, ResolvedOutcome>();
  const pendingAssignments: FinalsParticipantAssignment[] = [];

  for (const definition of definitions) {
    const homeMemberId = resolveParticipant(
      definition.home,
      orderedRegularSeasonMemberIds,
      resolvedOutcomes
    );
    const awayMemberId = resolveParticipant(
      definition.away,
      orderedRegularSeasonMemberIds,
      resolvedOutcomes
    );
    const finalizedOutcome = outcomesByKey.get(definition.bracketKey);

    if (!homeMemberId || !awayMemberId) {
      if (finalizedOutcome) {
        throw new Error(
          `${definition.bracketKey} cannot be finalized before its prerequisite matchups`
        );
      }
      continue;
    }

    if (!finalizedOutcome) {
      pendingAssignments.push({
        bracketKey: definition.bracketKey,
        homeMemberId,
        awayMemberId,
      });
      continue;
    }

    if (
      finalizedOutcome.homeMemberId !== homeMemberId ||
      finalizedOutcome.awayMemberId !== awayMemberId
    ) {
      throw new Error(`${definition.bracketKey} participants do not match the bracket assignment`);
    }

    resolvedOutcomes.set(definition.bracketKey, resolveOutcome(finalizedOutcome, seedByMemberId));
  }

  return pendingAssignments;
}
