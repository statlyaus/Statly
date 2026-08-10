import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { doesAflTradeArtifactRefMatchBytes } from '../artifacts/artifactReference';
import { calculateAflTradeHpnPavCore, type AflTradeHpnPavCorePlayer } from './hpnPavCore';
import type {
  AflTradeHpnPavInputExecutionContext,
  AflTradeHpnPavInputRepository,
} from './hpnPavInputRepository';
import { aflTradeHpnPavMethodSchema, type AflTradeHpnPavMethod } from './hpnPlayerApproximateValue';

export const AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION =
  'afl-trade-hpn-pav-season-calculation/v3' as const;

const instant = z.iso.datetime({ offset: true });
const publicId = z.string().trim().min(1).max(200);
const count = z.number().int().nonnegative();
const finite = z.number().finite();

const sourcePlayerSchema = z
  .object({
    sourceRowIds: z.array(publicId).min(1).max(10_000),
    gamesPlayed: count,
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

const calculationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership'
    ),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    effectiveThrough: instant,
    calculatedAt: instant,
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    inputSetId: aflTradeContentAddressedIdSchema('hpn-pav-input-set'),
    inputSetSha256: aflTradeSha256Schema,
    factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
    factualInputSetSha256: aflTradeSha256Schema,
    primaryProviders: z.array(publicId).min(1).max(10),
    corroboratingProviders: z.array(publicId).min(1).max(10),
    resultSourceRowIds: z.array(publicId).min(1).max(10_000),
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
    teams: z
      .array(
        z
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
            rawStrength: z.object({ offence: finite, midfield: finite, defence: finite }).strict(),
            offensivePav: finite,
            midfieldPav: finite,
            defensivePav: finite,
            totalPav: finite,
          })
          .strict()
      )
      .min(2)
      .max(30),
    players: z
      .array(
        z
          .object({
            spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
            playerId: publicId,
            teamId: publicId,
            source: sourcePlayerSchema,
            offensiveScore: finite,
            midfieldScore: finite,
            defensiveScore: finite,
            offensivePav: finite,
            midfieldPav: finite,
            defensivePav: finite,
            totalPav: finite,
          })
          .strict()
      )
      .min(2)
      .max(2_000),
  })
  .strict();

export const aflTradeFinalizedHpnPavCalculationSchema = z
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

export type AflTradeFinalizedHpnPavCalculation = z.infer<
  typeof aflTradeFinalizedHpnPavCalculationSchema
>;

export const aflTradeFinalizedHpnPavCalculationRequestSchema = z
  .object({
    inputSetId: aflTradeContentAddressedIdSchema('hpn-pav-input-set'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
  })
  .strict();

export type AflTradeFinalizedHpnPavCalculationRequest = z.infer<
  typeof aflTradeFinalizedHpnPavCalculationRequestSchema
>;

export interface AflTradeHpnPavMethodAuthority {
  loadExact(methodId: string): Promise<{
    readonly method: AflTradeHpnPavMethod;
    readonly sourceBytes: Uint8Array;
  }>;
}

interface Dependencies {
  readonly inputRepository: AflTradeHpnPavInputRepository;
  readonly methodAuthority: AflTradeHpnPavMethodAuthority;
  readonly clock: { now(): string };
}

interface TeamAccumulator {
  teamId: string;
  pointsFor: number;
  pointsAgainst: number;
  inside50sFor: number;
  inside50sAgainst: number;
  players: Map<string, AflTradeHpnPavCorePlayer>;
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function addStats(
  previous: AflTradeHpnPavCorePlayer | undefined,
  spellVersionId: string,
  playerId: string,
  rowId: string,
  stats: Omit<AflTradeHpnPavCorePlayer, 'spellVersionId' | 'playerId' | 'sourceRowIds'>
): AflTradeHpnPavCorePlayer {
  if (previous && previous.playerId !== playerId) {
    throw new TypeError('An acquisition spell cannot aggregate more than one player.');
  }
  const sourceRowIds = [...(previous?.sourceRowIds ?? []), rowId].sort(compare);
  return {
    spellVersionId,
    playerId,
    sourceRowIds,
    totalPoints: (previous?.totalPoints ?? 0) + stats.totalPoints,
    hitOuts: (previous?.hitOuts ?? 0) + stats.hitOuts,
    goalAssists: (previous?.goalAssists ?? 0) + stats.goalAssists,
    inside50s: (previous?.inside50s ?? 0) + stats.inside50s,
    marks: (previous?.marks ?? 0) + stats.marks,
    marksInside50: (previous?.marksInside50 ?? 0) + stats.marksInside50,
    freeKicksFor: (previous?.freeKicksFor ?? 0) + stats.freeKicksFor,
    freeKicksAgainst: (previous?.freeKicksAgainst ?? 0) + stats.freeKicksAgainst,
    rebound50s: (previous?.rebound50s ?? 0) + stats.rebound50s,
    onePercenters: (previous?.onePercenters ?? 0) + stats.onePercenters,
    clearances: (previous?.clearances ?? 0) + stats.clearances,
    tackles: (previous?.tackles ?? 0) + stats.tackles,
  };
}

function deriveTeams(
  inputSet: Awaited<ReturnType<AflTradeHpnPavInputRepository['loadFinalizedSeasonInputSet']>>
) {
  const teams = new Map<string, TeamAccumulator>();
  const primaryMatchesBySpell = new Map<string, Set<string>>();
  const ensure = (teamId: string) => {
    let team = teams.get(teamId);
    if (!team) {
      team = {
        teamId,
        pointsFor: 0,
        pointsAgainst: 0,
        inside50sFor: 0,
        inside50sAgainst: 0,
        players: new Map(),
      };
      teams.set(teamId, team);
    }
    return team;
  };
  const matchInside50s = new Map<string, Map<string, number>>();
  for (const row of inputSet.content.rows) {
    if (row.kind === 'completed_match_result') {
      const home = ensure(row.homeClub.canonicalId);
      const away = ensure(row.awayClub.canonicalId);
      home.pointsFor += row.homePoints;
      home.pointsAgainst += row.awayPoints;
      away.pointsFor += row.awayPoints;
      away.pointsAgainst += row.homePoints;
    } else if (row.role === 'primary') {
      const clubId = row.club.canonicalId;
      const team = ensure(clubId);
      const spellVersionId = row.acquisitionSpell.spellVersionId;
      const primaryMatches = primaryMatchesBySpell.get(spellVersionId) ?? new Set<string>();
      primaryMatches.add(row.match.canonicalId);
      primaryMatchesBySpell.set(spellVersionId, primaryMatches);
      team.players.set(
        spellVersionId,
        addStats(
          team.players.get(spellVersionId),
          spellVersionId,
          row.player.canonicalId,
          row.source.providerDecodedRowId,
          row.stats
        )
      );
      const byClub = matchInside50s.get(row.match.canonicalId) ?? new Map<string, number>();
      byClub.set(clubId, (byClub.get(clubId) ?? 0) + row.stats.inside50s);
      matchInside50s.set(row.match.canonicalId, byClub);
    }
  }
  for (const match of inputSet.content.completedMatches) {
    const byClub = matchInside50s.get(match.matchId);
    if (!byClub) throw new TypeError(`No primary player rows exist for ${match.matchId}.`);
    const homeInside50s = byClub.get(match.homeClubId);
    const awayInside50s = byClub.get(match.awayClubId);
    if (homeInside50s === undefined || awayInside50s === undefined) {
      throw new TypeError(`A match side lacks primary inside-50 evidence for ${match.matchId}.`);
    }
    const home = ensure(match.homeClubId);
    const away = ensure(match.awayClubId);
    home.inside50sFor += homeInside50s;
    home.inside50sAgainst += awayInside50s;
    away.inside50sFor += awayInside50s;
    away.inside50sAgainst += homeInside50s;
  }
  return {
    teams: [...teams.values()].map(({ players, ...team }) => ({
      ...team,
      players: [...players.values()],
    })),
    primaryMatchesBySpell,
  };
}

export function createAflTradeFinalizedHpnPavCalculationService(dependencies: Dependencies) {
  return {
    async calculate(
      input: unknown,
      execution: AflTradeHpnPavInputExecutionContext
    ): Promise<AflTradeFinalizedHpnPavCalculation> {
      const request = aflTradeFinalizedHpnPavCalculationRequestSchema.parse(input);
      const inputSet = await dependencies.inputRepository.loadFinalizedSeasonInputSet(
        request,
        execution
      );
      const retainedMethod = await dependencies.methodAuthority.loadExact(request.methodId);
      const method = aflTradeHpnPavMethodSchema.parse(retainedMethod.method);
      if (
        method.methodId !== request.methodId ||
        !doesAflTradeArtifactRefMatchBytes(
          method.content.sourceArtifact,
          retainedMethod.sourceBytes,
          'text/html'
        )
      ) {
        throw new TypeError('The exact retained HPN method bytes could not be authenticated.');
      }
      const calculatedAt = instant.parse(dependencies.clock.now());
      if (
        Date.parse(calculatedAt) < Date.parse(inputSet.content.createdAt) ||
        Date.parse(calculatedAt) < Date.parse(method.content.capturedAt)
      ) {
        throw new TypeError('HPN PAV calculation precedes its authenticated inputs.');
      }
      const derived = deriveTeams(inputSet);
      const core = calculateAflTradeHpnPavCore(derived.teams);
      const runProviders = new Map(
        inputSet.content.sourceRuns.map((run) => [run.normalizationRunId, run.provider])
      );
      const providers = (role: 'primary' | 'corroborating') =>
        [
          ...new Set(
            inputSet.content.rows
              .filter((row) => row.kind === 'player_match_stats' && row.role === role)
              .map((row) => runProviders.get(row.source.normalizationRunId))
              .filter((provider): provider is string => provider !== undefined)
          ),
        ].sort(compare);
      const content = calculationContentSchema.parse({
        schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
        authorityBoundary:
          'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership',
        publicationEligible: false,
        environment: inputSet.content.environment,
        competition: inputSet.content.competition,
        seasonYear: inputSet.content.seasonYear,
        effectiveThrough: inputSet.content.effectiveThrough,
        calculatedAt,
        methodId: method.methodId,
        inputSetId: inputSet.inputSetId,
        inputSetSha256: inputSet.inputSetId.replace('hpn-pav-input-set:', ''),
        factualRunId: inputSet.content.factualUniverse.factualRunId,
        factualInputSetSha256: inputSet.content.factualUniverse.inputSetSha256,
        primaryProviders: providers('primary'),
        corroboratingProviders: providers('corroborating'),
        resultSourceRowIds: inputSet.content.rows
          .filter((row) => row.kind === 'completed_match_result')
          .map((row) => row.source.providerDecodedRowId)
          .sort(compare),
        valueUnit: 'season_pav',
        ...core,
        players: core.players.map((player) => ({
          ...player,
          source: {
            ...player.source,
            gamesPlayed: derived.primaryMatchesBySpell.get(player.spellVersionId)?.size ?? 0,
          },
        })),
      });
      return aflTradeFinalizedHpnPavCalculationSchema.parse({
        calculationId: createAflTradeContentAddress('hpn-pav-season', content),
        content,
      });
    },
  };
}
