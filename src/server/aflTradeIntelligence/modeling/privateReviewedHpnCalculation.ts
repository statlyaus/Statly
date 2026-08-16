import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { doesAflTradeArtifactRefMatchCanonicalJson } from '../artifacts/artifactReference';
import { calculateAflTradeHpnPavCore, type AflTradeHpnPavCorePlayer } from './hpnPavCore';
import {
  aflTradeHpnReviewedSeasonMembershipSchema,
  aflTradeHpnReviewedSeasonUniverseSchema,
  type AflTradeHpnReviewedSeasonMember,
} from './hpnReviewedSeasonUniverse';

export const AFL_TRADE_PRIVATE_REVIEWED_HPN_METHOD_SCHEMA_VERSION =
  'afl-trade-private-reviewed-hpn-method/v1' as const;
export const AFL_TRADE_PRIVATE_REVIEWED_HPN_CALCULATION_SCHEMA_VERSION =
  'afl-trade-private-reviewed-hpn-calculation/v1' as const;

const instant = z.iso.datetime({ offset: true });
const publicId = z.string().trim().min(1).max(300);
const count = z.number().int().nonnegative().max(1_000_000_000);
const finite = z.number().finite();
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const methodContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_REVIEWED_HPN_METHOD_SCHEMA_VERSION),
    implementation: z.literal('hpnPavCore/v1'),
    valueUnit: z.literal('season_pav'),
    componentPool: z.object({ pavPerTeamPerComponent: z.literal(100) }).strict(),
    teamStrength: z
      .object({
        offence: z.literal('(points_for/inside_50s_for)/league_points_per_inside_50'),
        midfield: z.literal('inside_50s_for/inside_50s_against'),
        defence: z.literal(
          '2-((points_against/inside_50s_against)/league_points_per_inside_50)'
        ),
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
    provenanceState: z.literal('repository_implemented_formula_not_source_recaptured'),
    limitation: z.literal(
      'The calculation uses the repository HPN formula implementation over exact reviewed local data; the original published method bytes were not recaptured or independently revalidated in this rehearsal.'
    ),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
  })
  .strict();

export const aflTradePrivateReviewedHpnMethodSchema = z
  .object({
    methodId: aflTradeContentAddressedIdSchema('private-reviewed-hpn-method'),
    content: methodContentSchema,
  })
  .strict()
  .superRefine((method, context) => {
    addAflTradeContentAddressIssue(
      'private-reviewed-hpn-method',
      method.methodId,
      method.content,
      context,
      ['methodId']
    );
  });

const sourceStatsSchema = z
  .object({
    totalPoints: count,
    hitOuts: count,
    goalAssists: count,
    inside50s: count,
    marks: count,
    marksInside50: count,
    freeKicksFor: count,
    freeKicksAgainst: count,
    rebound50s: count,
    onePercenters: count,
    clearances: count,
    tackles: count,
  })
  .strict();

const allocationIdentitySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('resolved'),
      canonicalPlayerId: publicId,
      identityDecisionIds: z.array(publicId).min(1).max(100),
    })
    .strict(),
  z
    .object({
      state: z.literal('quarantined'),
      reason: z.literal('missing_source_identity'),
      recordedName: z.string().trim().min(1).max(240).nullable(),
    })
    .strict(),
]);

const allocationSchema = z
  .object({
    allocationId: aflTradeContentAddressedIdSchema('private-hpn-allocation'),
    clubId: publicId,
    identity: allocationIdentitySchema,
    gamesPlayed: count,
    sourceRowIds: z.array(publicId).min(1).max(10_000),
    source: sourceStatsSchema,
    offensiveScore: finite,
    midfieldScore: finite,
    defensiveScore: finite,
    offensivePav: finite,
    midfieldPav: finite,
    defensivePav: finite,
    totalPav: finite,
  })
  .strict();

const teamSchema = z
  .object({
    teamId: publicId,
    source: z
      .object({
        teamId: publicId,
        pointsFor: count,
        pointsAgainst: count,
        inside50sFor: count,
        inside50sAgainst: count,
      })
      .strict(),
    rawStrength: z
      .object({ offence: finite, midfield: finite, defence: finite })
      .strict(),
    offensivePav: finite,
    midfieldPav: finite,
    defensivePav: finite,
    totalPav: finite,
  })
  .strict();

const calculationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_REVIEWED_HPN_CALCULATION_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      'private_reviewed_local_calculation_no_release_model_run_or_publication_authority'
    ),
    environment: z.literal('non_production'),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    reviewedSeasonId: aflTradeContentAddressedIdSchema('hpn-reviewed-season'),
    membershipId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-membership'),
    methodId: aflTradeContentAddressedIdSchema('private-reviewed-hpn-method'),
    calculatedAt: instant,
    valueUnit: z.literal('season_pav'),
    league: z
      .object({
        teamCount: z.number().int().min(2).max(30),
        leaguePointsPerInside50: finite.positive(),
        componentPools: z
          .object({ offensivePav: finite, midfieldPav: finite, defensivePav: finite })
          .strict(),
        totalPav: finite.positive(),
      })
      .strict(),
    teams: z.array(teamSchema).min(2).max(30),
    allocations: z.array(allocationSchema).min(2).max(2_000),
    counts: z
      .object({
        sourceRows: count,
        resolvedAllocations: count,
        quarantinedAllocations: count,
      })
      .strict(),
    methodLimitation: z.literal(
      'The original published method bytes were not recaptured or independently revalidated in this rehearsal.'
    ),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
  })
  .strict();

export const aflTradePrivateReviewedHpnCalculationSchema = z
  .object({
    calculationId: aflTradeContentAddressedIdSchema('private-reviewed-hpn-calculation'),
    content: calculationContentSchema,
  })
  .strict()
  .superRefine((calculation, context) => {
    addAflTradeContentAddressIssue(
      'private-reviewed-hpn-calculation',
      calculation.calculationId,
      calculation.content,
      context,
      ['calculationId']
    );
  });

export type AflTradePrivateReviewedHpnMethod = z.infer<
  typeof aflTradePrivateReviewedHpnMethodSchema
>;
export type AflTradePrivateReviewedHpnCalculation = z.infer<
  typeof aflTradePrivateReviewedHpnCalculationSchema
>;

interface AllocationAccumulator {
  allocationId: string;
  clubId: string;
  identity: z.infer<typeof allocationIdentitySchema>;
  matches: Set<string>;
  stats: AflTradeHpnPavCorePlayer;
}

export function createAflTradePrivateReviewedHpnMethod(): AflTradePrivateReviewedHpnMethod {
  const content = methodContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_REVIEWED_HPN_METHOD_SCHEMA_VERSION,
    implementation: 'hpnPavCore/v1',
    valueUnit: 'season_pav',
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
    provenanceState: 'repository_implemented_formula_not_source_recaptured',
    limitation:
      'The calculation uses the repository HPN formula implementation over exact reviewed local data; the original published method bytes were not recaptured or independently revalidated in this rehearsal.',
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
  });
  return aflTradePrivateReviewedHpnMethodSchema.parse({
    methodId: createAflTradeContentAddress('private-reviewed-hpn-method', content),
    content,
  });
}

function addRow(
  previous: AllocationAccumulator | undefined,
  allocationId: string,
  identity: z.infer<typeof allocationIdentitySchema>,
  row: AflTradeHpnReviewedSeasonMember
): AllocationAccumulator {
  const prior = previous?.stats;
  const stats = Object.fromEntries(
    Object.entries(row.stats).map(([field, value]) => [
      field,
      (prior?.[field as keyof typeof row.stats] as number | undefined ?? 0) + value,
    ])
  ) as Omit<AflTradeHpnPavCorePlayer, 'spellVersionId' | 'playerId' | 'sourceRowIds'>;
  return {
    allocationId,
    clubId: row.playingForClubId,
    identity,
    matches: new Set([...(previous?.matches ?? []), row.matchId]),
    stats: {
      spellVersionId: allocationId,
      playerId:
        identity.state === 'resolved' ? identity.canonicalPlayerId : allocationId,
      sourceRowIds: [...(prior?.sourceRowIds ?? []), row.providerDecodedRowId].sort(compare),
      ...stats,
    },
  };
}

export function calculateAflTradePrivateReviewedHpnSeason(input: Readonly<{
  reviewedSeason: unknown;
  membership: unknown;
  method: unknown;
  calculatedAt: string;
}>): AflTradePrivateReviewedHpnCalculation {
  const reviewed = aflTradeHpnReviewedSeasonUniverseSchema.parse(input.reviewedSeason);
  const membership = aflTradeHpnReviewedSeasonMembershipSchema.parse(input.membership);
  const method = aflTradePrivateReviewedHpnMethodSchema.parse(input.method);
  const calculatedAt = instant.parse(input.calculatedAt);
  if (
    reviewed.content.membershipId !== membership.membershipId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(reviewed.content.membershipArtifact, membership)
  ) {
    throw new TypeError('Private HPN calculation requires the exact reviewed membership.');
  }
  if (Date.parse(calculatedAt) < Date.parse(reviewed.content.reviewedAt)) {
    throw new TypeError('A private HPN calculation cannot occur before review.');
  }

  const teamValues = new Map<
    string,
    { pointsFor: number; pointsAgainst: number; inside50sFor: number; inside50sAgainst: number }
  >();
  const ensureTeam = (teamId: string) => {
    const existing = teamValues.get(teamId) ?? {
      pointsFor: 0,
      pointsAgainst: 0,
      inside50sFor: 0,
      inside50sAgainst: 0,
    };
    teamValues.set(teamId, existing);
    return existing;
  };
  const matches = new Map<string, AflTradeHpnReviewedSeasonMember>();
  const matchInside50s = new Map<string, Map<string, number>>();
  const allocations = new Map<string, AllocationAccumulator>();
  for (const row of membership.content.rows) {
    matches.set(row.matchId, matches.get(row.matchId) ?? row);
    const byClub = matchInside50s.get(row.matchId) ?? new Map<string, number>();
    byClub.set(row.playingForClubId, (byClub.get(row.playingForClubId) ?? 0) + row.stats.inside50s);
    matchInside50s.set(row.matchId, byClub);
    const team = ensureTeam(row.playingForClubId);
    team.inside50sFor += row.stats.inside50s;
    const identityKey =
      row.playerIdentity.state === 'resolved'
        ? { state: 'resolved' as const, playerId: row.playerIdentity.canonicalPlayerId }
        : { state: 'quarantined' as const, rowId: row.providerDecodedRowId };
    const allocationId = createAflTradeContentAddress('private-hpn-allocation', {
      seasonYear: reviewed.content.seasonYear,
      clubId: row.playingForClubId,
      identityKey,
    });
    const previous = allocations.get(allocationId);
    const identity =
      row.playerIdentity.state === 'resolved'
        ? {
            state: 'resolved' as const,
            canonicalPlayerId: row.playerIdentity.canonicalPlayerId,
            identityDecisionIds: [
              ...new Set([
                ...(previous?.identity.state === 'resolved'
                  ? previous.identity.identityDecisionIds
                  : []),
                row.playerIdentity.identityDecisionId,
              ]),
            ].sort(compare),
          }
        : {
            state: 'quarantined' as const,
            reason: 'missing_source_identity' as const,
            recordedName: row.playerIdentity.recordedName,
          };
    allocations.set(allocationId, addRow(previous, allocationId, identity, row));
  }
  for (const match of matches.values()) {
    const home = ensureTeam(match.homeClubId);
    const away = ensureTeam(match.awayClubId);
    home.pointsFor += match.homePoints;
    home.pointsAgainst += match.awayPoints;
    away.pointsFor += match.awayPoints;
    away.pointsAgainst += match.homePoints;
    const byClub = matchInside50s.get(match.matchId);
    const homeInside50s = byClub?.get(match.homeClubId);
    const awayInside50s = byClub?.get(match.awayClubId);
    if (homeInside50s === undefined || awayInside50s === undefined) {
      throw new TypeError(`Reviewed match ${match.matchId} lacks two-sided inside-50 evidence.`);
    }
    home.inside50sAgainst += awayInside50s;
    away.inside50sAgainst += homeInside50s;
  }
  const core = calculateAflTradeHpnPavCore(
    [...teamValues.entries()].map(([teamId, values]) => ({
      teamId,
      ...values,
      players: [...allocations.values()]
        .filter(({ clubId }) => clubId === teamId)
        .map(({ stats }) => stats),
    }))
  );
  const byId = new Map([...allocations.values()].map((value) => [value.allocationId, value]));
  const calculatedAllocations = core.players.map((player) => {
    const retained = byId.get(player.spellVersionId);
    if (!retained) throw new TypeError('HPN core returned an unknown allocation.');
    return allocationSchema.parse({
      allocationId: retained.allocationId,
      clubId: retained.clubId,
      identity: retained.identity,
      gamesPlayed: retained.matches.size,
      sourceRowIds: player.source.sourceRowIds,
      source: {
        totalPoints: player.source.totalPoints,
        hitOuts: player.source.hitOuts,
        goalAssists: player.source.goalAssists,
        inside50s: player.source.inside50s,
        marks: player.source.marks,
        marksInside50: player.source.marksInside50,
        freeKicksFor: player.source.freeKicksFor,
        freeKicksAgainst: player.source.freeKicksAgainst,
        rebound50s: player.source.rebound50s,
        onePercenters: player.source.onePercenters,
        clearances: player.source.clearances,
        tackles: player.source.tackles,
      },
      offensiveScore: player.offensiveScore,
      midfieldScore: player.midfieldScore,
      defensiveScore: player.defensiveScore,
      offensivePav: player.offensivePav,
      midfieldPav: player.midfieldPav,
      defensivePav: player.defensivePav,
      totalPav: player.totalPav,
    });
  });
  const content = calculationContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_REVIEWED_HPN_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_reviewed_local_calculation_no_release_model_run_or_publication_authority',
    environment: 'non_production',
    competition: 'AFLM',
    seasonYear: reviewed.content.seasonYear,
    reviewedSeasonId: reviewed.reviewedSeasonId,
    membershipId: membership.membershipId,
    methodId: method.methodId,
    calculatedAt,
    valueUnit: 'season_pav',
    league: core.league,
    teams: core.teams,
    allocations: calculatedAllocations,
    counts: {
      sourceRows: membership.content.rows.length,
      resolvedAllocations: calculatedAllocations.filter(({ identity }) => identity.state === 'resolved').length,
      quarantinedAllocations: calculatedAllocations.filter(({ identity }) => identity.state === 'quarantined').length,
    },
    methodLimitation:
      'The original published method bytes were not recaptured or independently revalidated in this rehearsal.',
    publicationEligible: false,
    publicationProhibited: true,
  });
  return aflTradePrivateReviewedHpnCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('private-reviewed-hpn-calculation', content),
    content,
  });
}
