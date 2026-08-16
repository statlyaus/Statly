import { z } from 'zod';

import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import {
  createAflTradeHpnFieldMapCandidate,
  type AflTradeHpnSemanticBindingCandidate,
} from '../modeling/hpnFieldMapCandidate';
import { listAflTradeHpnRequiredSemanticFields } from '../modeling/hpnCalculationEligibility';

const decodeMapIdentitySchema = z
  .object({
    capabilityId: z.string().trim().min(1),
    sourceSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .passthrough();

const directFields = {
  afl_tables: {
    player: 'ID',
    match: 'url',
    club: 'Team',
    hitOuts: 'Hit.Outs',
    goalAssists: 'Goal.Assists',
    inside50s: 'Inside.50s',
    marks: 'Marks',
    marksInside50: 'Marks.Inside.50',
    freeKicksFor: 'Frees.For',
    freeKicksAgainst: 'Frees.Against',
    rebound50s: 'Rebounds',
    onePercenters: 'One.Percenters',
    clearances: 'Clearances',
    tackles: 'Tackles',
  },
  official_afl: {
    player: 'player.player.player.playerId',
    match: 'providerId',
    club: 'teamId',
    hitOuts: 'hitouts',
    goalAssists: 'goalAssists',
    inside50s: 'inside50s',
    marks: 'marks',
    marksInside50: 'marksInside50',
    freeKicksFor: 'freesFor',
    freeKicksAgainst: 'freesAgainst',
    rebound50s: 'rebound50s',
    onePercenters: 'onePercenters',
    clearances: 'clearances.totalClearances',
    tackles: 'tackles',
  },
} as const;

const scoringFields = {
  afl_tables: { goals: 'Goals', behinds: 'Behinds' },
  official_afl: { goals: 'goals', behinds: 'behinds' },
} as const;

export function createLocalAflTradeHpnPlayerFieldMapCandidate(input: {
  readonly provider: keyof typeof directFields;
  readonly seasonYear: number;
  readonly providerDecodeMap: unknown;
  readonly providerDecodeMapArtifact: AflTradeArtifactRef;
  readonly createdAt: string;
}) {
  const decodeMap = decodeMapIdentitySchema.parse(input.providerDecodeMap);
  const expectedCapability =
    input.provider === 'afl_tables'
      ? 'afl-tables-player-stats'
      : 'official-afl-player-stats';
  if (decodeMap.capabilityId !== expectedCapability) {
    throw new TypeError('The retained provider decode map has the wrong HPN capability.');
  }
  const providerFields = directFields[input.provider];
  const semanticBindings = listAflTradeHpnRequiredSemanticFields(
    'player_match_stats'
  ).map<AflTradeHpnSemanticBindingCandidate>((semanticField) => ({
    semanticField,
    mapping:
      semanticField === 'totalPoints'
        ? {
            kind: 'goals_plus_behinds',
            goals: scoringFields[input.provider].goals,
            behinds: scoringFields[input.provider].behinds,
          }
        : {
            kind: 'direct',
            sourceField:
              providerFields[semanticField as keyof typeof providerFields],
          },
  }));
  return createAflTradeHpnFieldMapCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    provider: input.provider,
    capabilityId: expectedCapability,
    sourceSchemaSha256: decodeMap.sourceSchemaSha256,
    inputKind: 'player_match_stats',
    validFromSeason: input.seasonYear,
    validThroughSeason: input.seasonYear,
    providerDecodeMap: input.providerDecodeMap,
    providerDecodeMapArtifact: input.providerDecodeMapArtifact,
    semanticBindings,
    createdAt: input.createdAt,
  });
}
