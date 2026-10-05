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
import { aflTradePickPavObservationSchema } from '../modeling/pickOutcomeContracts';

export const PRIVATE_GOVERNED_PICK_EVIDENCE_SCHEMA_VERSION =
  'private-governed-pick-evidence/v1' as const;
export const PRIVATE_GOVERNED_PICK_EVIDENCE_SCHEMA_VERSION_V2 =
  'private-governed-pick-evidence/v2' as const;

const publicIdSchema = z.string().trim().min(1).max(300);
const instantSchema = z.iso.datetime({ offset: true });
const evidenceRefsSchema = z.array(aflTradeArtifactRefSchema).min(1).max(1_000);
const LIMITATION =
  'Exact private local non-production pick lineage and realized selected-player evidence only; at-trade and remaining values require separately governed models and publication is prohibited.' as const;

export const privateGovernedPickEvidenceBlockerSchema = z.enum([
  'pick_lineage_artifact_mismatch',
  'pick_lineage_not_contiguous',
  'pick_custody_artifact_mismatch',
  'pick_custody_not_contiguous',
  'pick_custody_at_trade_mismatch',
  'pick_selection_custody_mismatch',
  'pick_realization_artifact_mismatch',
  'pick_realization_mismatch',
  'draft_selection_observation_artifact_mismatch',
  'draft_selection_mismatch',
  'selected_player_contribution_unavailable',
  'selected_player_acquisition_spell_mismatch',
  'selected_player_current_horizon_missing',
  'pick_evidence_parent_after_cutoff',
]);

const lineageEdgeSchema = z
  .object({
    edgeId: aflTradeContentAddressedIdSchema('pick-lineage-edge'),
    parentPickId: publicIdSchema,
    childPickId: publicIdSchema,
    relationKind: publicIdSchema,
    sequence: z.number().int().positive().max(1_000),
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict();
const lineageSchema = z
  .object({
    rootPickId: publicIdSchema,
    finalPickId: publicIdSchema,
    edges: z.array(lineageEdgeSchema).max(1_000),
  })
  .strict();
const custodySpellSchema = z
  .object({
    custodyId: aflTradeContentAddressedIdSchema('pick-custody-spell'),
    pickId: publicIdSchema,
    clubId: publicIdSchema,
    effectiveFrom: instantSchema,
    effectiveThrough: instantSchema.nullable(),
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((spell, context) => {
    if (
      spell.effectiveThrough !== null &&
      Date.parse(spell.effectiveThrough) <= Date.parse(spell.effectiveFrom)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveThrough'],
        message: 'Pick custody uses a non-empty half-open effective-time interval.',
      });
    }
  });
const custodySchema = z
  .object({ spells: z.array(custodySpellSchema).min(1).max(10_000) })
  .strict();
const realizationSchema = z
  .object({
    realizationId: aflTradeContentAddressedIdSchema('pick-realization'),
    transferAssetVersionId: publicIdSchema,
    pickId: publicIdSchema,
    draftSelectionId: aflTradeContentAddressedIdSchema('draft-selection'),
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict();
const assetSchema = z
  .object({
    assetId: publicIdSchema,
    rootPickId: publicIdSchema,
    transferAssetVersionId: publicIdSchema,
    receivingClubId: publicIdSchema,
    draftYear: z.number().int().min(1897).max(2200),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    tradeKnowledgeCutoffAt: instantSchema,
    knowledgeCutoffAt: instantSchema,
  })
  .strict();
const inputSchema = z
  .object({
    confirmedResultArtifact: aflTradeArtifactRefSchema,
    asset: assetSchema,
    lineage: lineageSchema,
    lineageArtifact: aflTradeArtifactRefSchema,
    custody: custodySchema,
    custodyArtifact: aflTradeArtifactRefSchema,
    realization: realizationSchema,
    realizationArtifact: aflTradeArtifactRefSchema,
    observation: aflTradePickPavObservationSchema,
    observationArtifact: aflTradeArtifactRefSchema,
    admittedAt: instantSchema,
  })
  .strict();

const finalSelectionSchema = z
  .object({
    selectionId: aflTradeContentAddressedIdSchema('draft-selection'),
    pickId: publicIdSchema,
    draftYear: z.number().int().min(1897).max(2200),
    eventDate: z.iso.date(),
    actualSelectionNumber: z.number().int().positive().max(500),
    selectedPlayerId: publicIdSchema,
    selectingClubId: publicIdSchema,
    selectedPlayerAcquisitionSpellVersionIds: z
      .array(aflTradeContentAddressedIdSchema('acquisition-spell-version'))
      .min(1)
      .max(15),
  })
  .strict();

const matureContributionSchema = z
  .object({
    state: z.literal('mature_observed'),
    contribution: z.number().finite(),
    gamesPlayed: z.number().int().nonnegative(),
    category: z.enum([
      'no_afl_game',
      'short_career',
      'replacement_level',
      'regular_contributor',
      'high_quality',
      'elite',
    ]),
    calculationIds: z.array(aflTradeContentAddressedIdSchema('hpn-pav-season')).min(1).max(15),
  })
  .strict();
const censoredContributionSchema = z
  .object({
    state: z.literal('right_censored'),
    contributionObservedToDate: z.number().finite(),
    gamesObservedToDate: z.number().int().nonnegative(),
    censoredAt: instantSchema,
    calculationIds: z.array(aflTradeContentAddressedIdSchema('hpn-pav-season')).min(1).max(15),
  })
  .strict();

const selectedPlayerHorizonShape = {
  season: z.number().int().min(1998).max(2200),
  calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
  calculationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
  playerId: publicIdSchema,
  clubId: publicIdSchema,
  sourceRowIds: z.array(publicIdSchema).min(1).max(1_000),
  gamesPlayed: z.number().int().positive().max(30),
  totalPav: z.number().finite(),
  effectiveThrough: instantSchema,
};
const completedSelectedPlayerHorizonSchema = z
  .object({
    kind: z.literal('completed_season'),
    coverage: z.literal('complete'),
    ...selectedPlayerHorizonShape,
  })
  .strict();
const currentSelectedPlayerHorizonSchema = z
  .object({
    kind: z.literal('current_season'),
    coverage: z.literal('right_censored'),
    ...selectedPlayerHorizonShape,
  })
  .strict();
const selectedPlayerHorizonSchema = z.discriminatedUnion('kind', [
  completedSelectedPlayerHorizonSchema,
  currentSelectedPlayerHorizonSchema,
]);

const admissionContentV2Schema = z
  .object({
    schemaVersion: z.literal(PRIVATE_GOVERNED_PICK_EVIDENCE_SCHEMA_VERSION_V2),
    environment: z.literal('non_production'),
    authority: z.literal('canonical_pick_lineage_realization_and_released_pav_observation'),
    confirmedResultArtifact: aflTradeArtifactRefSchema,
    assetId: publicIdSchema,
    rootPickId: publicIdSchema,
    transferAssetVersionId: publicIdSchema,
    receivingClubId: publicIdSchema,
    draftYear: z.number().int().min(1897).max(2200),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    tradeKnowledgeCutoffAt: instantSchema,
    knowledgeCutoffAt: instantSchema,
    lineage: lineageSchema,
    lineageArtifact: aflTradeArtifactRefSchema,
    custody: custodySchema,
    custodyArtifact: aflTradeArtifactRefSchema,
    realization: realizationSchema,
    realizationArtifact: aflTradeArtifactRefSchema,
    observationId: aflTradeContentAddressedIdSchema('pick-pav-observation'),
    observationArtifact: aflTradeArtifactRefSchema,
    finalSelection: finalSelectionSchema,
    realizedContribution: z.discriminatedUnion('state', [
      matureContributionSchema,
      censoredContributionSchema,
    ]),
    selectedPlayerHorizons: z.array(selectedPlayerHorizonSchema).min(1).max(15),
    atTradeValueAuthority: z.literal('governed_pick_model_required'),
    remainingValueAuthority: z.literal('governed_pick_model_required'),
    evidenceRefs: evidenceRefsSchema,
    admittedAt: instantSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(LIMITATION),
  })
  .strict();

const admissionContentV1Schema = admissionContentV2Schema
  .omit({ custody: true, custodyArtifact: true })
  .extend({ schemaVersion: z.literal(PRIVATE_GOVERNED_PICK_EVIDENCE_SCHEMA_VERSION) })
  .strict();

function addAdmissionContentAddressIssue(
  admission: { admissionId: string; content: unknown },
  context: z.RefinementCtx
): void {
  addAflTradeContentAddressIssue(
    'private-governed-pick-evidence',
    admission.admissionId,
    admission.content,
    context,
    ['admissionId']
  );
}

export const privateGovernedPickEvidenceAdmissionV1Schema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema('private-governed-pick-evidence'),
    content: admissionContentV1Schema,
  })
  .strict()
  .superRefine(addAdmissionContentAddressIssue);

export const privateGovernedPickEvidenceAdmissionV2Schema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema('private-governed-pick-evidence'),
    content: admissionContentV2Schema,
  })
  .strict()
  .superRefine(addAdmissionContentAddressIssue);

export const privateGovernedPickEvidenceAdmissionSchema = z.union([
  privateGovernedPickEvidenceAdmissionV1Schema,
  privateGovernedPickEvidenceAdmissionV2Schema,
]);

export type PrivateGovernedPickEvidenceAdmission = z.infer<
  typeof privateGovernedPickEvidenceAdmissionSchema
>;
export type PrivateGovernedPickEvidenceResult =
  | { readonly state: 'ready'; readonly admission: PrivateGovernedPickEvidenceAdmission }
  | {
      readonly state: 'unavailable';
      readonly assetId: string;
      readonly reasons: readonly z.infer<typeof privateGovernedPickEvidenceBlockerSchema>[];
      readonly evidenceRefs: readonly AflTradeArtifactRef[];
    };

function uniqueEvidence(references: readonly AflTradeArtifactRef[]): AflTradeArtifactRef[] {
  return [...new Map(references.map((reference) => [reference.artifactId, reference])).values()].sort(
    (left, right) => left.artifactId.localeCompare(right.artifactId)
  );
}

function unavailable(
  input: z.infer<typeof inputSchema>,
  reasons: readonly z.infer<typeof privateGovernedPickEvidenceBlockerSchema>[],
  evidenceRefs: readonly AflTradeArtifactRef[]
): PrivateGovernedPickEvidenceResult {
  return {
    state: 'unavailable',
    assetId: input.asset.assetId,
    reasons: privateGovernedPickEvidenceBlockerSchema.options.filter((reason) =>
      reasons.includes(reason)
    ),
    evidenceRefs: uniqueEvidence(evidenceRefs),
  };
}

function custodyAt(
  custody: z.infer<typeof custodySchema>,
  pickId: string,
  instant: string
): readonly z.infer<typeof custodySpellSchema>[] {
  const at = Date.parse(instant);
  return custody.spells.filter(
    (spell) =>
      spell.pickId === pickId &&
      Date.parse(spell.effectiveFrom) <= at &&
      (spell.effectiveThrough === null || at < Date.parse(spell.effectiveThrough))
  );
}

function custodyIsContiguous(
  custody: z.infer<typeof custodySchema>,
  lineage: z.infer<typeof lineageSchema>
): boolean {
  const lineagePickIds = new Set([
    lineage.rootPickId,
    lineage.finalPickId,
    ...lineage.edges.flatMap(({ parentPickId, childPickId }) => [parentPickId, childPickId]),
  ]);
  if (
    new Set(custody.spells.map(({ custodyId }) => custodyId)).size !== custody.spells.length ||
    custody.spells.some(({ pickId }) => !lineagePickIds.has(pickId)) ||
    [...lineagePickIds].some(
      (pickId) => !custody.spells.some((spell) => spell.pickId === pickId)
    )
  ) {
    return false;
  }
  for (const pickId of lineagePickIds) {
    const spells = custody.spells
      .filter((spell) => spell.pickId === pickId)
      .sort((left, right) => Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom));
    if (
      spells.some(
        (spell, index) =>
          index > 0 && spells[index - 1]!.effectiveThrough !== spell.effectiveFrom
      )
    ) {
      return false;
    }
  }
  return true;
}

export function admitPrivateGovernedPickEvidence(
  candidate: unknown
): PrivateGovernedPickEvidenceResult {
  const input = inputSchema.parse(candidate);
  const evidenceRefs = uniqueEvidence([
    input.confirmedResultArtifact,
    input.lineageArtifact,
    ...input.lineage.edges.map(({ evidenceRef }) => evidenceRef),
    input.custodyArtifact,
    ...input.custody.spells.map(({ evidenceRef }) => evidenceRef),
    input.realizationArtifact,
    input.realization.evidenceRef,
    input.observationArtifact,
  ]);
  const reasons: z.infer<typeof privateGovernedPickEvidenceBlockerSchema>[] = [];
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.lineageArtifact, input.lineage)) {
    reasons.push('pick_lineage_artifact_mismatch');
  }
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.custodyArtifact, input.custody)) {
    reasons.push('pick_custody_artifact_mismatch');
  }
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.realizationArtifact, input.realization)) {
    reasons.push('pick_realization_artifact_mismatch');
  }
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.observationArtifact, input.observation)) {
    reasons.push('draft_selection_observation_artifact_mismatch');
  }

  let cursor = input.lineage.rootPickId;
  const visited = new Set([cursor]);
  const orderedEdges = [...input.lineage.edges].sort((left, right) => left.sequence - right.sequence);
  const lineageInvalid =
    input.lineage.rootPickId !== input.asset.rootPickId ||
    orderedEdges.some((edge, index) => {
      const invalid =
        edge.sequence !== index + 1 ||
        edge.parentPickId !== cursor ||
        visited.has(edge.childPickId);
      cursor = edge.childPickId;
      visited.add(cursor);
      return invalid;
    }) ||
    cursor !== input.lineage.finalPickId ||
    input.lineage.finalPickId !== input.observation.selection.pickId;
  if (lineageInvalid) reasons.push('pick_lineage_not_contiguous');
  if (!lineageInvalid && !custodyIsContiguous(input.custody, input.lineage)) {
    reasons.push('pick_custody_not_contiguous');
  }

  const tradeCustody = custodyAt(
    input.custody,
    input.lineage.rootPickId,
    input.asset.tradeKnowledgeCutoffAt
  );
  if (
    tradeCustody.length !== 1 ||
    tradeCustody[0]!.clubId !== input.asset.receivingClubId
  ) {
    reasons.push('pick_custody_at_trade_mismatch');
  }

  if (
    input.realization.transferAssetVersionId !== input.asset.transferAssetVersionId ||
    input.realization.pickId !== input.lineage.finalPickId ||
    input.realization.draftSelectionId !== input.observation.selection.selectionId
  ) {
    reasons.push('pick_realization_mismatch');
  }
  const selection = input.observation.selection;
  const selectionCustody = custodyAt(
    input.custody,
    input.lineage.finalPickId,
    `${selection.eventDate}T00:00:00.000Z`
  );
  if (selectionCustody.length !== 1 || selectionCustody[0]!.clubId !== selection.clubId) {
    reasons.push('pick_selection_custody_mismatch');
  }
  if (
    selection.releaseId !== input.asset.factualReleaseId ||
    selection.draftYear !== input.asset.draftYear ||
    Date.parse(selection.recordedAt) <= Date.parse(input.asset.tradeKnowledgeCutoffAt) ||
    Date.parse(selection.recordedAt) > Date.parse(input.asset.knowledgeCutoffAt)
  ) {
    reasons.push('draft_selection_mismatch');
  }
  if (input.observation.outcome.state === 'unavailable') {
    reasons.push('selected_player_contribution_unavailable');
  }
  const spellVersionIds = [
    ...new Set(input.observation.playerValues.map(({ spellVersionId }) => spellVersionId)),
  ].sort();
  if (
    input.observation.playerValues.length === 0 ||
    input.observation.playerValues.some(
      ({ playerId }) => playerId !== selection.playerId
    )
  ) {
    reasons.push('selected_player_acquisition_spell_mismatch');
  }
  const observationYear = new Date(input.observation.outcomeObservedAt).getUTCFullYear();
  if (
    input.observation.outcome.state === 'right_censored' &&
    !input.observation.playerValues.some(({ seasonYear }) => seasonYear === observationYear)
  ) {
    reasons.push('selected_player_current_horizon_missing');
  }
  if (
    [
      input.confirmedResultArtifact,
      input.lineageArtifact,
      input.custodyArtifact,
      input.realizationArtifact,
      input.observationArtifact,
      ...input.lineage.edges.map(({ evidenceRef }) => evidenceRef),
      ...input.custody.spells.map(({ evidenceRef }) => evidenceRef),
      input.realization.evidenceRef,
    ].some(({ createdAt }) => Date.parse(createdAt) > Date.parse(input.admittedAt)) ||
    Date.parse(input.observation.outcomeObservedAt) > Date.parse(input.admittedAt)
  ) {
    reasons.push('pick_evidence_parent_after_cutoff');
  }
  if (reasons.length > 0 || input.observation.outcome.state === 'unavailable') {
    return unavailable(input, reasons, evidenceRefs);
  }

  const realizedContribution =
    input.observation.outcome.state === 'mature_observed'
      ? {
          state: 'mature_observed' as const,
          contribution: input.observation.outcome.contribution,
          gamesPlayed: input.observation.outcome.gamesPlayed,
          category: input.observation.outcome.category,
          calculationIds: input.observation.calculationIds,
        }
      : {
          state: 'right_censored' as const,
          contributionObservedToDate: input.observation.outcome.contributionObservedToDate,
          gamesObservedToDate: input.observation.outcome.gamesObservedToDate,
          censoredAt: input.observation.outcome.censoredAt,
          calculationIds: input.observation.calculationIds,
        };
  const selectedPlayerHorizons = [...input.observation.playerValues]
    .sort(
      (left, right) =>
        left.seasonYear - right.seasonYear ||
        left.calculationId.localeCompare(right.calculationId)
    )
    .map((value) => {
      const retained = {
        season: value.seasonYear,
        calculationId: value.calculationId,
        calculationSha256: value.calculationSha256,
        spellVersionId: value.spellVersionId,
        playerId: value.playerId,
        clubId: value.clubId,
        sourceRowIds: value.sourceRowIds,
        gamesPlayed: value.gamesPlayed,
        totalPav: value.totalPav,
        effectiveThrough: input.observation.outcomeObservedAt,
      };
      return input.observation.outcome.state === 'right_censored' &&
        value.seasonYear === observationYear
        ? {
            ...retained,
            kind: 'current_season' as const,
            coverage: 'right_censored' as const,
          }
        : {
            ...retained,
            kind: 'completed_season' as const,
            coverage: 'complete' as const,
          };
    });
  const content = admissionContentV2Schema.parse({
    schemaVersion: PRIVATE_GOVERNED_PICK_EVIDENCE_SCHEMA_VERSION_V2,
    environment: 'non_production',
    authority: 'canonical_pick_lineage_realization_and_released_pav_observation',
    confirmedResultArtifact: input.confirmedResultArtifact,
    ...input.asset,
    lineage: input.lineage,
    lineageArtifact: input.lineageArtifact,
    custody: input.custody,
    custodyArtifact: input.custodyArtifact,
    realization: input.realization,
    realizationArtifact: input.realizationArtifact,
    observationId: input.observation.observationId,
    observationArtifact: input.observationArtifact,
    finalSelection: {
      selectionId: selection.selectionId,
      pickId: selection.pickId,
      draftYear: selection.draftYear,
      eventDate: selection.eventDate,
      actualSelectionNumber: selection.actualSelectionNumber,
      selectedPlayerId: selection.playerId,
      selectingClubId: selection.clubId,
      selectedPlayerAcquisitionSpellVersionIds: spellVersionIds,
    },
    realizedContribution,
    selectedPlayerHorizons,
    atTradeValueAuthority: 'governed_pick_model_required',
    remainingValueAuthority: 'governed_pick_model_required',
    evidenceRefs,
    admittedAt: input.admittedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation: LIMITATION,
  });
  return {
    state: 'ready',
    admission: privateGovernedPickEvidenceAdmissionV2Schema.parse({
      admissionId: createAflTradeContentAddress('private-governed-pick-evidence', content),
      content,
    }),
  };
}
