import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeFinalizedHpnPavCalculationSchema } from '../modeling/hpnPavCalculationService';

export const PRIVATE_GOVERNED_PLAYER_EVIDENCE_SCHEMA_VERSION =
  'private-governed-player-evidence/v1' as const;
export const PRIVATE_GOVERNED_PLAYER_EVIDENCE_SCHEMA_VERSION_V2 =
  'private-governed-player-evidence/v2' as const;

const instantSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z.string().trim().min(1).max(300);
const countSchema = z.number().int().nonnegative();
const finiteSchema = z.number().finite();
const EPSILON = 1e-9;
const LIMITATION =
  'Exact private local non-production player evidence only; missing seasons remain unavailable and no model, grade, publication, or production authority is granted.' as const;

export const privateGovernedPlayerEvidenceBlockerSchema = z.enum([
  'hpn_required_horizon_missing',
  'hpn_season_calculation_missing',
  'hpn_season_calculation_not_nonproduction',
  'hpn_season_calculation_artifact_mismatch',
  'hpn_season_method_mismatch',
  'hpn_season_horizon_invalid',
  'hpn_player_spell_allocation_missing',
  'hpn_player_source_rows_incomplete',
  'hpn_player_component_mismatch',
  'hpn_calculation_parent_after_cutoff',
]);

const sourceStatsSchema = z
  .object({
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
  })
  .strict();

const componentsSchema = z
  .object({
    offensiveScore: finiteSchema,
    midfieldScore: finiteSchema,
    defensiveScore: finiteSchema,
    offensivePav: finiteSchema,
    midfieldPav: finiteSchema,
    defensivePav: finiteSchema,
    totalPav: finiteSchema,
  })
  .strict()
  .superRefine((components, context) => {
    if (
      Math.abs(
        components.totalPav -
          components.offensivePav -
          components.midfieldPav -
          components.defensivePav
      ) > EPSILON
    ) {
      context.addIssue({
        code: 'custom',
        path: ['totalPav'],
        message: 'Player total PAV must equal its exact offensive, midfield, and defensive PAV.',
      });
    }
  });

const horizonShape = {
  season: z.number().int().min(1998).max(2200),
  gamesPlayed: countSchema,
  effectiveThrough: instantSchema,
  calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
  calculationArtifact: aflTradeArtifactRefSchema,
  coverageEvidenceRef: aflTradeArtifactRefSchema,
  inputSetId: aflTradeContentAddressedIdSchema('hpn-pav-input-set'),
  factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
  sourceRowIds: z.array(publicIdSchema).min(1).max(10_000),
  source: sourceStatsSchema,
  components: componentsSchema,
};

const completedHorizonSchema = z
  .object({
    kind: z.literal('completed_season'),
    coverage: z.literal('complete'),
    ...horizonShape,
  })
  .strict();
const currentHorizonSchema = z
  .object({
    kind: z.literal('current_season'),
    coverage: z.enum(['complete', 'right_censored']),
    ...horizonShape,
  })
  .strict();
const admittedHorizonSchema = z.discriminatedUnion('kind', [
  completedHorizonSchema,
  currentHorizonSchema,
]);

const admissionContentV2Schema = z
  .object({
    schemaVersion: z.literal(PRIVATE_GOVERNED_PLAYER_EVIDENCE_SCHEMA_VERSION_V2),
    environment: z.literal('non_production'),
    authority: z.literal('exact_finalized_hpn_season_calculations'),
    confirmedResultArtifact: aflTradeArtifactRefSchema,
    assetId: publicIdSchema,
    canonicalPlayerId: publicIdSchema,
    receivingClubId: publicIdSchema,
    acquisitionSpellVersionId: aflTradeContentAddressedIdSchema(
      'acquisition-spell-version'
    ),
    acquisitionSpellStartDate: z.iso.date(),
    acquisitionSpellEndDate: z.iso.date().nullable(),
    tradeYear: z.number().int().min(1897).max(2200),
    knowledgeCutoffAt: instantSchema,
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    valueUnitId: z.literal('season_pav'),
    horizons: z.array(admittedHorizonSchema).min(1).max(100),
    evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(1_000),
    admittedAt: instantSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(LIMITATION),
  })
  .strict();

const admissionContentV1Schema = admissionContentV2Schema
  .omit({ acquisitionSpellStartDate: true, acquisitionSpellEndDate: true })
  .extend({ schemaVersion: z.literal(PRIVATE_GOVERNED_PLAYER_EVIDENCE_SCHEMA_VERSION) })
  .strict();

function addAdmissionContentAddressIssue(
  admission: { admissionId: string; content: unknown },
  context: z.RefinementCtx
): void {
  addAflTradeContentAddressIssue(
    'private-governed-player-evidence',
    admission.admissionId,
    admission.content,
    context,
    ['admissionId']
  );
}

export const privateGovernedPlayerEvidenceAdmissionV1Schema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema('private-governed-player-evidence'),
    content: admissionContentV1Schema,
  })
  .strict()
  .superRefine(addAdmissionContentAddressIssue);

export const privateGovernedPlayerEvidenceAdmissionV2Schema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema('private-governed-player-evidence'),
    content: admissionContentV2Schema,
  })
  .strict()
  .superRefine(addAdmissionContentAddressIssue);

export const privateGovernedPlayerEvidenceAdmissionSchema = z.union([
  privateGovernedPlayerEvidenceAdmissionV1Schema,
  privateGovernedPlayerEvidenceAdmissionV2Schema,
]);

const assetSchema = z
  .object({
    assetId: publicIdSchema,
    canonicalPlayerId: publicIdSchema,
    receivingClubId: publicIdSchema,
    acquisitionSpellVersionId: aflTradeContentAddressedIdSchema(
      'acquisition-spell-version'
    ),
    acquisitionSpellStartDate: z.iso.date(),
    acquisitionSpellEndDate: z.iso.date().nullable(),
    tradeYear: z.number().int().min(1897).max(2200),
    knowledgeCutoffAt: instantSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    if (
      asset.acquisitionSpellStartDate.slice(0, 4) < String(asset.tradeYear) ||
      (asset.acquisitionSpellEndDate !== null &&
        asset.acquisitionSpellEndDate < asset.acquisitionSpellStartDate)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acquisitionSpellStartDate'],
        message: 'The acquisition spell must begin no earlier than the trade and remain ordered.',
      });
    }
  });

export type PrivateGovernedPlayerEvidenceAssetScope = z.infer<typeof assetSchema>;

const expectedHorizonSchema = z
  .object({
    kind: z.enum(['completed_season', 'current_season']),
    season: z.number().int().min(1998).max(2200),
    coverage: z.enum(['complete', 'right_censored']),
    coverageEvidenceRef: aflTradeArtifactRefSchema,
    calculation: aflTradeFinalizedHpnPavCalculationSchema.nullable(),
    calculationArtifact: aflTradeArtifactRefSchema.nullable(),
  })
  .strict();

const inputSchema = z
  .object({
    confirmedResultArtifact: aflTradeArtifactRefSchema,
    asset: assetSchema,
    expectedHorizons: z.array(expectedHorizonSchema).min(1).max(100),
    admittedAt: instantSchema,
  })
  .strict();

export type PrivateGovernedPlayerEvidenceAdmission = z.infer<
  typeof privateGovernedPlayerEvidenceAdmissionSchema
>;
export type PrivateGovernedPlayerEvidenceResult =
  | { readonly state: 'ready'; readonly admission: PrivateGovernedPlayerEvidenceAdmission }
  | {
      readonly state: 'unavailable';
      readonly assetId: string;
      readonly reasons: readonly z.infer<typeof privateGovernedPlayerEvidenceBlockerSchema>[];
      readonly evidenceRefs: readonly AflTradeArtifactRef[];
    };

function uniqueEvidence(references: readonly AflTradeArtifactRef[]): AflTradeArtifactRef[] {
  return [...new Map(references.map((reference) => [reference.artifactId, reference])).values()].sort(
    (left, right) => left.artifactId.localeCompare(right.artifactId)
  );
}

function unavailable(
  assetId: string,
  reasons: readonly z.infer<typeof privateGovernedPlayerEvidenceBlockerSchema>[],
  evidenceRefs: readonly AflTradeArtifactRef[]
): PrivateGovernedPlayerEvidenceResult {
  return {
    state: 'unavailable',
    assetId,
    reasons: privateGovernedPlayerEvidenceBlockerSchema.options.filter((reason) =>
      reasons.includes(reason)
    ),
    evidenceRefs: uniqueEvidence(evidenceRefs),
  };
}

export function derivePrivateGovernedPlayerRequiredHorizons(
  unparsedAsset: PrivateGovernedPlayerEvidenceAssetScope
): readonly {
  kind: 'completed_season' | 'current_season';
  season: number;
}[] {
  const asset = assetSchema.parse(unparsedAsset);
  const cutoffYear = new Date(asset.knowledgeCutoffAt).getUTCFullYear();
  const spellStartYear = Number(asset.acquisitionSpellStartDate.slice(0, 4));
  const firstSeason = Math.max(asset.tradeYear + 1, spellStartYear);
  const spellEndYear =
    asset.acquisitionSpellEndDate === null
      ? cutoffYear
      : Number(asset.acquisitionSpellEndDate.slice(0, 4));
  const finalSeason = Math.min(cutoffYear, spellEndYear);
  if (finalSeason < firstSeason) return [];
  return Array.from({ length: finalSeason - firstSeason + 1 }, (_, offset) => {
    const season = firstSeason + offset;
    return {
      season,
      kind: season === cutoffYear ? 'current_season' : 'completed_season',
    } as const;
  });
}

export function admitPrivateGovernedPlayerEvidence(
  candidate: unknown
): PrivateGovernedPlayerEvidenceResult {
  const input = inputSchema.parse(candidate);
  const evidenceRefs: AflTradeArtifactRef[] = [input.confirmedResultArtifact];
  const reasons: z.infer<typeof privateGovernedPlayerEvidenceBlockerSchema>[] = [];
  const horizonSeasons = input.expectedHorizons.map(({ season }) => season);
  const required = derivePrivateGovernedPlayerRequiredHorizons(input.asset);
  const actualHorizonKeys = input.expectedHorizons.map(({ kind, season }) => `${kind}:${season}`);
  const requiredHorizonKeys = required.map(({ kind, season }) => `${kind}:${season}`);
  if (
    actualHorizonKeys.length !== requiredHorizonKeys.length ||
    actualHorizonKeys.some((key, index) => key !== requiredHorizonKeys[index])
  ) {
    reasons.push('hpn_required_horizon_missing');
  }
  const currentIndices = input.expectedHorizons
    .map(({ kind }, index) => (kind === 'current_season' ? index : -1))
    .filter((index) => index >= 0);
  const cutoffYear = new Date(input.asset.knowledgeCutoffAt).getUTCFullYear();
  if (
    new Set(horizonSeasons).size !== horizonSeasons.length ||
    horizonSeasons.some(
      (season, index) =>
        (index > 0 && horizonSeasons[index - 1]! > season) ||
        season <= input.asset.tradeYear ||
        season > cutoffYear
    ) ||
    currentIndices.length > 1 ||
    (currentIndices.length === 1 && currentIndices[0] !== input.expectedHorizons.length - 1) ||
    input.expectedHorizons.some(
      ({ kind, coverage }) => kind === 'completed_season' && coverage !== 'complete'
    )
  ) {
    reasons.push('hpn_season_horizon_invalid');
  }

  const retainedHorizons: z.input<typeof admittedHorizonSchema>[] = [];
  let methodId: string | null = null;
  for (const horizon of input.expectedHorizons) {
    evidenceRefs.push(horizon.coverageEvidenceRef);
    if (horizon.calculation === null || horizon.calculationArtifact === null) {
      reasons.push('hpn_season_calculation_missing');
      continue;
    }
    const calculation = horizon.calculation;
    evidenceRefs.push(horizon.calculationArtifact);
    if (!doesAflTradeArtifactRefMatchCanonicalJson(horizon.calculationArtifact, calculation)) {
      reasons.push('hpn_season_calculation_artifact_mismatch');
    }
    if (calculation.content.environment !== 'non_production') {
      reasons.push('hpn_season_calculation_not_nonproduction');
    }
    if (methodId !== null && methodId !== calculation.content.methodId) {
      reasons.push('hpn_season_method_mismatch');
    }
    methodId ??= calculation.content.methodId;
    if (
      calculation.content.seasonYear !== horizon.season ||
      Date.parse(calculation.content.effectiveThrough) >
        Date.parse(input.asset.knowledgeCutoffAt)
    ) {
      reasons.push('hpn_season_horizon_invalid');
    }
    if (
      Date.parse(calculation.content.calculatedAt) > Date.parse(input.admittedAt) ||
      Date.parse(horizon.calculationArtifact.createdAt) > Date.parse(input.admittedAt) ||
      Date.parse(horizon.coverageEvidenceRef.createdAt) > Date.parse(input.admittedAt)
    ) {
      reasons.push('hpn_calculation_parent_after_cutoff');
    }
    const allocations = calculation.content.players.filter(
      (player) =>
        player.playerId === input.asset.canonicalPlayerId &&
        player.teamId === input.asset.receivingClubId &&
        player.spellVersionId === input.asset.acquisitionSpellVersionId
    );
    if (allocations.length !== 1) {
      reasons.push('hpn_player_spell_allocation_missing');
      continue;
    }
    const allocation = allocations[0]!;
    if (allocation.source.sourceRowIds.length !== allocation.source.gamesPlayed) {
      reasons.push('hpn_player_source_rows_incomplete');
    }
    if (
      Math.abs(
        allocation.totalPav -
          allocation.offensivePav -
          allocation.midfieldPav -
          allocation.defensivePav
      ) > EPSILON
    ) {
      reasons.push('hpn_player_component_mismatch');
    }
    const retainedHorizon = {
      season: horizon.season,
      gamesPlayed: allocation.source.gamesPlayed,
      effectiveThrough: calculation.content.effectiveThrough,
      calculationId: calculation.calculationId,
      calculationArtifact: horizon.calculationArtifact,
      coverageEvidenceRef: horizon.coverageEvidenceRef,
      inputSetId: calculation.content.inputSetId,
      factualRunId: calculation.content.factualRunId,
      sourceRowIds: allocation.source.sourceRowIds,
      source: {
        totalPoints: allocation.source.totalPoints,
        hitOuts: allocation.source.hitOuts,
        goalAssists: allocation.source.goalAssists,
        inside50s: allocation.source.inside50s,
        marks: allocation.source.marks,
        marksInside50: allocation.source.marksInside50,
        freeKicksFor: allocation.source.freeKicksFor,
        freeKicksAgainst: allocation.source.freeKicksAgainst,
        rebound50s: allocation.source.rebound50s,
        onePercenters: allocation.source.onePercenters,
        clearances: allocation.source.clearances,
        tackles: allocation.source.tackles,
      },
      components: {
        offensiveScore: allocation.offensiveScore,
        midfieldScore: allocation.midfieldScore,
        defensiveScore: allocation.defensiveScore,
        offensivePav: allocation.offensivePav,
        midfieldPav: allocation.midfieldPav,
        defensivePav: allocation.defensivePav,
        totalPav: allocation.totalPav,
      },
    };
    retainedHorizons.push(
      horizon.kind === 'completed_season'
        ? { ...retainedHorizon, kind: 'completed_season', coverage: 'complete' }
        : {
            ...retainedHorizon,
            kind: 'current_season',
            coverage: horizon.coverage,
          }
    );
  }

  if (reasons.length > 0 || methodId === null) {
    return unavailable(
      input.asset.assetId,
      methodId === null && reasons.length === 0
        ? ['hpn_season_calculation_missing']
        : reasons,
      evidenceRefs
    );
  }

  const content = admissionContentV2Schema.parse({
    schemaVersion: PRIVATE_GOVERNED_PLAYER_EVIDENCE_SCHEMA_VERSION_V2,
    environment: 'non_production',
    authority: 'exact_finalized_hpn_season_calculations',
    confirmedResultArtifact: input.confirmedResultArtifact,
    ...input.asset,
    methodId,
    valueUnitId: 'season_pav',
    horizons: retainedHorizons,
    evidenceRefs: uniqueEvidence(evidenceRefs),
    admittedAt: input.admittedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation: LIMITATION,
  });
  return {
    state: 'ready',
    admission: privateGovernedPlayerEvidenceAdmissionV2Schema.parse({
      admissionId: createAflTradeContentAddress('private-governed-player-evidence', content),
      content,
    }),
  };
}
