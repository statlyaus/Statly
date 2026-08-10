import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';

export const AFL_TRADE_HPN_PAV_METHOD_SCHEMA_VERSION = 'afl-trade-hpn-pav-method/v1' as const;
export const AFL_TRADE_HPN_PAV_SEASON_SCHEMA_VERSION =
  'afl-trade-hpn-pav-season-calculation/v1' as const;

const instantSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const countSchema = z.number().int().nonnegative().max(100_000);
const finiteSchema = z.number().finite();
const sourceRowIdSchema = publicIdSchema;

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isExactUniqueOrdinalOrder(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function addExactUniqueOrdinalOrderIssue(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string
): void {
  if (!isExactUniqueOrdinalOrder(values)) {
    context.addIssue({
      code: 'custom',
      path,
      message: `${label} must be unique and ordered by Unicode code point.`,
    });
  }
}

const methodContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_PAV_METHOD_SCHEMA_VERSION),
    sourceArtifact: aflTradeArtifactRefSchema,
    sourceUrl: z.literal('https://www.hpnfooty.com/?p=21810'),
    capturedAt: instantSchema,
    valueUnit: z.literal('season_pav'),
    supportedEra: z.object({ fromSeason: z.literal(1998), throughSeason: z.null() }).strict(),
    componentPool: z.object({ pavPerTeamPerComponent: z.literal(100) }).strict(),
    teamStrength: z
      .object({
        offence: z.literal('(points_for/inside_50s_for)/league_points_per_inside_50'),
        midfield: z.literal('inside_50s_for/inside_50s_against'),
        defence: z.literal('2-((points_against/inside_50s_against)/league_points_per_inside_50)'),
        normalization: z.literal('each_component_sums_to_100_times_team_count'),
      })
      .strict(),
    playerScores: z
      .object({
        offence: z.literal(
          'total_points+0.25*hit_outs+3*goal_assists+inside_50s+marks_inside_50+free_kick_differential'
        ),
        midfield: z.literal(
          '15*inside_50s+20*clearances+3*tackles+1.5*hit_outs+free_kick_differential'
        ),
        defence: z.literal(
          '20*rebound_50s+12*one_percenters+marks-4*marks_inside_50+2*free_kick_differential-(2/3)*hit_outs'
        ),
        allocation: z.literal('team_component_pav_times_player_score_share'),
      })
      .strict(),
    attribution: z.literal(
      'HPN Player Approximate Value method, reimplemented from published formulae'
    ),
    limitations: z.literal(
      'Supported from 1998 only; an attributed approximation, not Champion Data ratings or a player projection.'
    ),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((method, context) => {
    if (method.sourceArtifact.mediaType !== 'text/html') {
      context.addIssue({
        code: 'custom',
        path: ['sourceArtifact', 'mediaType'],
        message: 'The HPN method source must retain the exact HTML publication bytes.',
      });
    }
    if (method.sourceArtifact.createdAt !== method.capturedAt) {
      context.addIssue({
        code: 'custom',
        path: ['sourceArtifact', 'createdAt'],
        message: 'HPN method artifact creation must equal its authenticated capture time.',
      });
    }
  });

export const aflTradeHpnPavMethodSchema = z
  .object({
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    content: methodContentSchema,
  })
  .strict()
  .superRefine((method, context) => {
    addAflTradeContentAddressIssue('hpn-pav-method', method.methodId, method.content, context, [
      'methodId',
    ]);
  });

const playerStatLineBaseSchema = z
  .object({
    playerId: publicIdSchema,
    totalPoints: countSchema,
    hitOuts: countSchema,
    goalAssists: countSchema,
    inside50s: countSchema,
    marks: countSchema,
    marksInside50: countSchema,
    freeKicksFor: countSchema,
    freeKicksAgainst: countSchema,
    rebound50s: countSchema,
    onePercenters: countSchema,
    clearances: countSchema,
    tackles: countSchema,
    sourceRowIds: z.array(sourceRowIdSchema).min(1).max(100),
  })
  .strict();

const playerStatLineSchema = playerStatLineBaseSchema.superRefine((line, context) => {
  addExactUniqueOrdinalOrderIssue(
    line.sourceRowIds,
    context,
    ['sourceRowIds'],
    'Player source-row identifiers'
  );
});

const teamInputSchema = z
  .object({
    teamId: publicIdSchema,
    pointsFor: countSchema.positive(),
    pointsAgainst: countSchema.positive(),
    inside50sFor: countSchema.positive(),
    inside50sAgainst: countSchema.positive(),
    players: z.array(playerStatLineSchema).min(1).max(100),
  })
  .strict();

const sourceSnapshotSchema = z
  .object({
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    sourceSnapshotSha256: aflTradeSha256Schema,
    sourceArtifact: aflTradeArtifactRefSchema,
    rowMembershipArtifact: aflTradeArtifactRefSchema,
    captureId: publicIdSchema,
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    seasonYear: z.number().int().min(1998).max(2200),
    capturedAt: instantSchema,
    finalizedAt: instantSchema,
    sourceRowIds: z.array(sourceRowIdSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.sourceSnapshotId !== `source-snapshot:${snapshot.sourceSnapshotSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSnapshotId'],
        message: 'Source snapshot identity must match its exact digest.',
      });
    }
    if (snapshot.sourceArtifact.createdAt !== snapshot.capturedAt) {
      context.addIssue({
        code: 'custom',
        path: ['sourceArtifact', 'createdAt'],
        message: 'Source artifact creation must equal the authenticated capture time.',
      });
    }
    if (Date.parse(snapshot.capturedAt) > Date.parse(snapshot.finalizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['finalizedAt'],
        message: 'Source normalization cannot finalize before capture.',
      });
    }
    const rowMembership = {
      schemaVersion: 'afl-trade-hpn-pav-source-row-membership/v1',
      sourceSnapshotId: snapshot.sourceSnapshotId,
      sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
      sourceArtifactId: snapshot.sourceArtifact.artifactId,
      captureId: snapshot.captureId,
      normalizationRunId: snapshot.normalizationRunId,
      seasonYear: snapshot.seasonYear,
      capturedAt: snapshot.capturedAt,
      finalizedAt: snapshot.finalizedAt,
      sourceRowIds: snapshot.sourceRowIds,
    } as const;
    if (
      snapshot.rowMembershipArtifact.createdAt !== snapshot.finalizedAt ||
      !doesAflTradeArtifactRefMatchCanonicalJson(snapshot.rowMembershipArtifact, rowMembership)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rowMembershipArtifact'],
        message:
          'The row-membership artifact must content-address the exact finalized normalization rows.',
      });
    }
    addExactUniqueOrdinalOrderIssue(
      snapshot.sourceRowIds,
      context,
      ['sourceRowIds'],
      'Snapshot source-row identifiers'
    );
  });

const calculationInputSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    effectiveThrough: instantSchema,
    calculatedAt: instantSchema,
    method: aflTradeHpnPavMethodSchema,
    sourceSnapshots: z.array(sourceSnapshotSchema).min(1).max(100),
    resultSourceRowIds: z.array(sourceRowIdSchema).min(1).max(100_000),
    teams: z.array(teamInputSchema).min(2).max(30),
  })
  .strict()
  .superRefine((input, context) => {
    if (Date.parse(input.effectiveThrough) > Date.parse(input.calculatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['calculatedAt'],
        message: 'PAV cannot be calculated before its evidence cutoff.',
      });
    }
    if (Date.parse(input.method.content.capturedAt) > Date.parse(input.calculatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['method', 'content', 'capturedAt'],
        message: 'The retained HPN method must exist before the calculation.',
      });
    }
    addExactUniqueOrdinalOrderIssue(
      input.resultSourceRowIds,
      context,
      ['resultSourceRowIds'],
      'Result source-row identifiers'
    );
    const snapshotIds = input.sourceSnapshots
      .map(({ sourceSnapshotId }) => sourceSnapshotId)
      .sort(ordinalCompare);
    addExactUniqueOrdinalOrderIssue(
      snapshotIds,
      context,
      ['sourceSnapshots'],
      'Source snapshot identifiers'
    );
    for (const [index, snapshot] of input.sourceSnapshots.entries()) {
      if (snapshot.seasonYear !== input.seasonYear) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshots', index, 'seasonYear'],
          message: 'Every source snapshot must match the calculated season.',
        });
      }
      if (
        Date.parse(snapshot.finalizedAt) > Date.parse(input.calculatedAt) ||
        Date.parse(snapshot.capturedAt) > Date.parse(input.effectiveThrough)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshots', index],
          message:
            'Source evidence must be captured by the cutoff and finalized before calculation.',
        });
      }
    }
    const teamIds = input.teams.map(({ teamId }) => teamId);
    const playerIds = input.teams.flatMap(({ players }) => players.map(({ playerId }) => playerId));
    if (new Set(teamIds).size !== teamIds.length || new Set(playerIds).size !== playerIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['teams'],
        message: 'Each team and player must occur exactly once in a season calculation.',
      });
    }
    const total = (field: 'pointsFor' | 'pointsAgainst' | 'inside50sFor' | 'inside50sAgainst') =>
      input.teams.reduce((sum, team) => sum + team[field], 0);
    if (
      total('pointsFor') !== total('pointsAgainst') ||
      total('inside50sFor') !== total('inside50sAgainst')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['teams'],
        message: 'League points and inside 50 totals must conserve across for and against records.',
      });
    }
    const snapshotRows = input.sourceSnapshots
      .flatMap(({ sourceRowIds }) => sourceRowIds)
      .sort(ordinalCompare);
    const calculationRows = [
      ...input.resultSourceRowIds,
      ...input.teams.flatMap(({ players }) => players.flatMap(({ sourceRowIds }) => sourceRowIds)),
    ].sort(ordinalCompare);
    if (
      !isExactUniqueOrdinalOrder(snapshotRows) ||
      !isExactUniqueOrdinalOrder(calculationRows) ||
      snapshotRows.length !== calculationRows.length ||
      snapshotRows.some((rowId, index) => rowId !== calculationRows[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSnapshots'],
        message:
          'Every finalized source row must be consumed exactly once by the season calculation.',
      });
    }
  });

const teamResultSchema = z
  .object({
    teamId: publicIdSchema,
    source: teamInputSchema.omit({ players: true }),
    rawStrength: z.object({ offence: finiteSchema, midfield: finiteSchema, defence: finiteSchema }),
    offensivePav: finiteSchema,
    midfieldPav: finiteSchema,
    defensivePav: finiteSchema,
    totalPav: finiteSchema,
  })
  .strict();

const playerResultSchema = z
  .object({
    playerId: publicIdSchema,
    teamId: publicIdSchema,
    source: playerStatLineBaseSchema.omit({ playerId: true }),
    offensiveScore: finiteSchema,
    midfieldScore: finiteSchema,
    defensiveScore: finiteSchema,
    offensivePav: finiteSchema,
    midfieldPav: finiteSchema,
    defensivePav: finiteSchema,
    totalPav: finiteSchema,
  })
  .strict();

const calculationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_PAV_SEASON_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      'derived_private_candidate_requires_authenticated_custody_persistence'
    ),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    effectiveThrough: instantSchema,
    calculatedAt: instantSchema,
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    valueUnit: z.literal('season_pav'),
    sourceSnapshots: z.array(sourceSnapshotSchema).min(1).max(100),
    resultSourceRowIds: z.array(sourceRowIdSchema).min(1).max(100_000),
    league: z
      .object({
        teamCount: z.number().int().min(2).max(30),
        leaguePointsPerInside50: finiteSchema.positive(),
        componentPools: z.object({
          offensivePav: finiteSchema.positive(),
          midfieldPav: finiteSchema.positive(),
          defensivePav: finiteSchema.positive(),
        }),
        totalPav: finiteSchema.positive(),
      })
      .strict(),
    teams: z.array(teamResultSchema).min(2).max(30),
    players: z.array(playerResultSchema).min(2).max(2_000),
  })
  .strict();

export const aflTradeHpnPavSeasonCalculationSchema = z
  .object({
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    content: calculationContentSchema,
  })
  .strict()
  .superRefine((calculation, context) => {
    addAflTradeContentAddressIssue(
      'hpn-pav-season',
      calculation.calculationId,
      calculation.content,
      context,
      ['calculationId']
    );
  });

export type AflTradeHpnPavMethod = z.infer<typeof aflTradeHpnPavMethodSchema>;
export type AflTradeHpnPavSeasonCalculation = z.infer<typeof aflTradeHpnPavSeasonCalculationSchema>;
export type CalculateAflTradeHpnPavSeasonInput = z.input<typeof calculationInputSchema>;

export function createAflTradeHpnPavMethod(input: {
  sourceArtifact: AflTradeArtifactRef;
  sourceBytes: Uint8Array;
  capturedAt: string;
}): AflTradeHpnPavMethod {
  if (!doesAflTradeArtifactRefMatchBytes(input.sourceArtifact, input.sourceBytes, 'text/html')) {
    throw new TypeError(
      'The retained HPN method artifact does not match the supplied source bytes.'
    );
  }
  const content = methodContentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_PAV_METHOD_SCHEMA_VERSION,
    sourceArtifact: input.sourceArtifact,
    capturedAt: input.capturedAt,
    sourceUrl: 'https://www.hpnfooty.com/?p=21810',
    valueUnit: 'season_pav',
    supportedEra: { fromSeason: 1998, throughSeason: null },
    componentPool: { pavPerTeamPerComponent: 100 },
    teamStrength: {
      offence: '(points_for/inside_50s_for)/league_points_per_inside_50',
      midfield: 'inside_50s_for/inside_50s_against',
      defence: '2-((points_against/inside_50s_against)/league_points_per_inside_50)',
      normalization: 'each_component_sums_to_100_times_team_count',
    },
    playerScores: {
      offence:
        'total_points+0.25*hit_outs+3*goal_assists+inside_50s+marks_inside_50+free_kick_differential',
      midfield: '15*inside_50s+20*clearances+3*tackles+1.5*hit_outs+free_kick_differential',
      defence:
        '20*rebound_50s+12*one_percenters+marks-4*marks_inside_50+2*free_kick_differential-(2/3)*hit_outs',
      allocation: 'team_component_pav_times_player_score_share',
    },
    attribution: 'HPN Player Approximate Value method, reimplemented from published formulae',
    limitations:
      'Supported from 1998 only; an attributed approximation, not Champion Data ratings or a player projection.',
    publicationEligible: false,
  });
  return aflTradeHpnPavMethodSchema.parse({
    methodId: createAflTradeContentAddress('hpn-pav-method', content),
    content,
  });
}

function normalized(value: number): number {
  const result = Number(value.toFixed(12));
  if (!Number.isFinite(result))
    throw new RangeError('PAV calculation produced a non-finite value.');
  return result;
}

function playerScores(player: z.infer<typeof playerStatLineSchema>) {
  const freeKickDifferential = player.freeKicksFor - player.freeKicksAgainst;
  return {
    offence:
      player.totalPoints +
      0.25 * player.hitOuts +
      3 * player.goalAssists +
      player.inside50s +
      player.marksInside50 +
      freeKickDifferential,
    midfield:
      15 * player.inside50s +
      20 * player.clearances +
      3 * player.tackles +
      1.5 * player.hitOuts +
      freeKickDifferential,
    defence:
      20 * player.rebound50s +
      12 * player.onePercenters +
      player.marks -
      4 * player.marksInside50 +
      2 * freeKickDifferential -
      (2 / 3) * player.hitOuts,
  };
}

export function calculateAflTradeHpnPavSeason(
  unparsedInput: CalculateAflTradeHpnPavSeasonInput
): AflTradeHpnPavSeasonCalculation {
  const input = calculationInputSchema.parse(unparsedInput);
  const teams = [...input.teams].sort((left, right) => ordinalCompare(left.teamId, right.teamId));
  const leaguePoints = teams.reduce((sum, team) => sum + team.pointsFor, 0);
  const leagueInside50s = teams.reduce((sum, team) => sum + team.inside50sFor, 0);
  const leaguePointsPerInside50 = leaguePoints / leagueInside50s;
  const rawTeams = teams.map((team) => ({
    team,
    offence: team.pointsFor / team.inside50sFor / leaguePointsPerInside50,
    midfield: team.inside50sFor / team.inside50sAgainst,
    defence: 2 - team.pointsAgainst / team.inside50sAgainst / leaguePointsPerInside50,
  }));
  const pool = teams.length * 100;
  const rawTotals = {
    offence: rawTeams.reduce((sum, team) => sum + team.offence, 0),
    midfield: rawTeams.reduce((sum, team) => sum + team.midfield, 0),
    defence: rawTeams.reduce((sum, team) => sum + team.defence, 0),
  };
  if (Object.values(rawTotals).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('League PAV component strength denominators must be positive.');
  }

  const playerResults: Array<z.infer<typeof playerResultSchema>> = [];
  const teamResults = rawTeams.map(({ team, ...strength }) => {
    const scored = [...team.players]
      .sort((left, right) => ordinalCompare(left.playerId, right.playerId))
      .map((source) => ({ source, scores: playerScores(source) }));
    const scoreTotals = {
      offence: scored.reduce((sum, player) => sum + player.scores.offence, 0),
      midfield: scored.reduce((sum, player) => sum + player.scores.midfield, 0),
      defence: scored.reduce((sum, player) => sum + player.scores.defence, 0),
    };
    for (const [component, total] of Object.entries(scoreTotals)) {
      if (!Number.isFinite(total) || total <= 0) {
        throw new RangeError(`Team ${component} score denominator must be positive.`);
      }
    }
    const componentPav = {
      offence: (pool * strength.offence) / rawTotals.offence,
      midfield: (pool * strength.midfield) / rawTotals.midfield,
      defence: (pool * strength.defence) / rawTotals.defence,
    };
    for (const { source, scores } of scored) {
      const offensivePav = normalized(
        componentPav.offence * (scores.offence / scoreTotals.offence)
      );
      const midfieldPav = normalized(
        componentPav.midfield * (scores.midfield / scoreTotals.midfield)
      );
      const defensivePav = normalized(
        componentPav.defence * (scores.defence / scoreTotals.defence)
      );
      const { playerId, ...sourceStats } = source;
      playerResults.push({
        playerId,
        teamId: team.teamId,
        source: sourceStats,
        offensiveScore: normalized(scores.offence),
        midfieldScore: normalized(scores.midfield),
        defensiveScore: normalized(scores.defence),
        offensivePav,
        midfieldPav,
        defensivePav,
        totalPav: normalized(offensivePav + midfieldPav + defensivePav),
      });
    }
    const { players: _players, ...teamSource } = team;
    const offensivePav = normalized(componentPav.offence);
    const midfieldPav = normalized(componentPav.midfield);
    const defensivePav = normalized(componentPav.defence);
    return {
      teamId: team.teamId,
      source: teamSource,
      rawStrength: {
        offence: normalized(strength.offence),
        midfield: normalized(strength.midfield),
        defence: normalized(strength.defence),
      },
      offensivePav,
      midfieldPav,
      defensivePav,
      totalPav: normalized(offensivePav + midfieldPav + defensivePav),
    };
  });
  const sourceSnapshots = [...input.sourceSnapshots].sort((left, right) =>
    ordinalCompare(left.sourceSnapshotId, right.sourceSnapshotId)
  );
  const content = calculationContentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_PAV_SEASON_SCHEMA_VERSION,
    authorityBoundary: 'derived_private_candidate_requires_authenticated_custody_persistence',
    publicationEligible: false,
    environment: input.environment,
    competition: input.competition,
    seasonYear: input.seasonYear,
    effectiveThrough: input.effectiveThrough,
    calculatedAt: input.calculatedAt,
    methodId: input.method.methodId,
    valueUnit: 'season_pav',
    sourceSnapshots,
    resultSourceRowIds: input.resultSourceRowIds,
    league: {
      teamCount: teams.length,
      leaguePointsPerInside50: normalized(leaguePointsPerInside50),
      componentPools: { offensivePav: pool, midfieldPav: pool, defensivePav: pool },
      totalPav: pool * 3,
    },
    teams: teamResults,
    players: playerResults,
  });
  return aflTradeHpnPavSeasonCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}
