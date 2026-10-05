import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_ASSET_DISPOSITION_KINDS,
  AFL_TRADE_ASSET_TYPES,
  AFL_TRADE_CORRECTION_RELATION_KINDS,
  AFL_TRADE_LINEAGE_EDGE_KINDS,
} from '../domain/lineageTypes';
import { validateAflTradeLineageGraph } from '../domain/lineageValidation';
import type { PostgresPrivateValuationPickLineageResult } from './postgresPrivateValuationPickLineage';
import { privateGovernedPickEvidenceAdmissionSchema } from './privateGovernedPickEvidence';
import {
  privateGovernedPlayerEvidenceAdmissionSchema,
  type PrivateGovernedPlayerEvidenceAdmission,
} from './privateGovernedPlayerEvidence';

export const PRIVATE_GOVERNED_PICK_EVIDENCE_SCHEMA_VERSION_V3 =
  'private-governed-pick-evidence/v3' as const;

const idSchema = z.string().trim().min(1).max(500);
const instantSchema = z.iso.datetime({ offset: true });

const lineageGraphSchema = z
  .object({
    assets: z.array(
      z
        .object({
          assetId: idSchema,
          assetType: z.enum(AFL_TRADE_ASSET_TYPES),
          effectiveFrom: instantSchema,
          knownFrom: instantSchema,
          knownTo: instantSchema.nullable(),
          evidenceId: idSchema,
        })
        .strict()
    ),
    custodySpells: z.array(
      z
        .object({
          custodySpellId: idSchema,
          assetId: idSchema,
          aflClubId: idSchema,
          effectiveFrom: instantSchema,
          effectiveTo: instantSchema.nullable(),
          knownFrom: instantSchema,
          knownTo: instantSchema.nullable(),
          evidenceId: idSchema,
        })
        .strict()
    ),
    edges: z.array(
      z
        .object({
          edgeId: idSchema,
          kind: z.enum(AFL_TRADE_LINEAGE_EDGE_KINDS),
          sourceAssetId: idSchema,
          targetAssetId: idSchema,
          effectiveAt: instantSchema,
          knownFrom: instantSchema,
          knownTo: instantSchema.nullable(),
          evidenceId: idSchema,
          ruleVersion: idSchema,
        })
        .strict()
    ),
    dispositions: z.array(
      z
        .object({
          dispositionId: idSchema,
          kind: z.enum(AFL_TRADE_ASSET_DISPOSITION_KINDS),
          assetId: idSchema,
          effectiveAt: instantSchema,
          knownFrom: instantSchema,
          knownTo: instantSchema.nullable(),
          evidenceId: idSchema,
          reasonCode: idSchema,
        })
        .strict()
    ),
    corrections: z.array(
      z
        .object({
          correctionId: idSchema,
          kind: z.enum(AFL_TRADE_CORRECTION_RELATION_KINDS),
          supersededRecordId: idSchema,
          replacementRecordId: idSchema,
          knownAt: instantSchema,
          evidenceId: idSchema,
        })
        .strict()
    ),
  })
  .strict();

const pickFrontierSchema = z
  .object({
    assetId: idSchema,
    assetType: z.enum(['current_pick_entitlement', 'future_pick_entitlement']),
    identity: z.object({ kind: z.literal('pick'), pickId: idSchema }).strict(),
    acquisitionClubId: idSchema,
    sourceTransferAssetVersionId: idSchema,
  })
  .strict();
const playerFrontierSchema = z
  .object({
    assetId: idSchema,
    assetType: z.literal('player'),
    identity: z
      .object({
        kind: z.literal('player'),
        playerId: idSchema,
        acquisitionSpellVersionId: aflTradeContentAddressedIdSchema(
          'acquisition-spell-version'
        ),
      })
      .strict(),
    acquisitionClubId: idSchema,
    sourceTransferAssetVersionId: idSchema,
  })
  .strict();
const frontierAssetSchema = z.union([pickFrontierSchema, playerFrontierSchema]);

const frontierEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('unrealized_pick_entitlement'),
      frontierAssetId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('exhaustive_player_horizons'),
      frontierAssetId: idSchema,
      admissionId: aflTradeContentAddressedIdSchema('private-governed-player-evidence'),
      admissionArtifact: aflTradeArtifactRefSchema,
    })
    .strict(),
]);

const realizationAtCutoffSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('unrealized'),
      reason: z.literal('draft_selection_not_yet_recorded'),
    })
    .strict(),
  z
    .object({
      state: z.literal('selected'),
      attribution: z.enum([
        'credited_current_frontier',
        'superseded_by_later_exchange',
      ]),
      realizationId: idSchema,
      transferAssetVersionId: idSchema,
      pickId: idSchema,
      draftSelectionId: idSchema,
      recordedAt: instantSchema,
      evidenceId: idSchema,
      selection: z
        .object({
          selectionId: idSchema,
          pickId: idSchema,
          playerId: idSchema,
          clubId: idSchema,
          eventDate: instantSchema,
          recordedAt: instantSchema,
          evidenceId: idSchema,
        })
        .strict(),
      selectedPlayer: playerFrontierSchema,
      selectedPlayerEvidence: z
        .object({
          admissionId: aflTradeContentAddressedIdSchema(
            'private-governed-player-evidence'
          ),
          admissionArtifact: aflTradeArtifactRefSchema,
        })
        .strict(),
    })
    .strict(),
]);

const contentSchema = z
  .object({
    schemaVersion: z.literal(PRIVATE_GOVERNED_PICK_EVIDENCE_SCHEMA_VERSION_V3),
    environment: z.literal('non_production'),
    authority: z.literal('canonical_custody_aware_conserved_frontier_and_factual_outcomes'),
    confirmedResultArtifact: aflTradeArtifactRefSchema,
    assetId: idSchema,
    transferAssetVersionId: idSchema,
    receivingClubId: idSchema,
    draftYear: z.number().int().min(1897).max(2200),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    tradeKnowledgeCutoffAt: instantSchema,
    knowledgeCutoffAt: instantSchema,
    lineageReadbackArtifact: aflTradeArtifactRefSchema,
    lineageGraph: lineageGraphSchema,
    lineageGraphArtifact: aflTradeArtifactRefSchema,
    frontierAssets: z.array(frontierAssetSchema).min(1).max(10_000),
    frontierEvidence: z.array(frontierEvidenceSchema).min(1).max(10_000),
    realizationAtCutoff: realizationAtCutoffSchema,
    atTradeValueAuthority: z.literal('governed_pick_model_required'),
    remainingValueAuthority: z.literal('governed_pick_model_required'),
    evidenceRefs: z.array(aflTradeArtifactRefSchema).min(3).max(100_000),
    admittedAt: instantSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Exact private local non-production pick facts and conserved-frontier evidence only; no missing value is zero, scores require governed model runs, and publication is prohibited.'
    ),
  })
  .strict();

export const privateGovernedPickEvidenceAdmissionV3Schema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema('private-governed-pick-evidence'),
    content: contentSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    addAflTradeContentAddressIssue(
      'private-governed-pick-evidence',
      admission.admissionId,
      admission.content,
      context,
      ['admissionId']
    );
  });

export type PrivateGovernedPickEvidenceAdmissionV3 = z.infer<
  typeof privateGovernedPickEvidenceAdmissionV3Schema
>;
export const privateGovernedPickEvidenceAdmissionAnySchema = z.union([
  privateGovernedPickEvidenceAdmissionSchema,
  privateGovernedPickEvidenceAdmissionV3Schema,
]);
export type PrivateGovernedPickEvidenceAdmissionAny = z.infer<
  typeof privateGovernedPickEvidenceAdmissionAnySchema
>;
type ReadyLineage = Extract<PostgresPrivateValuationPickLineageResult, { state: 'ready' }>;
type PlayerFrontier = Extract<
  ReadyLineage['materialization']['frontierAssets'][number],
  { assetType: 'player' }
>;

export type PrivateGovernedPickEvidenceV3Result =
  | {
      state: 'ready';
      admission: PrivateGovernedPickEvidenceAdmissionV3;
      artifacts: readonly {
        role:
          | 'lineage_readback'
          | 'lineage_graph'
          | 'frontier_player_evidence'
          | 'selected_player_evidence';
        reference: AflTradeArtifactRef;
        document: unknown;
      }[];
    }
  | {
      state: 'unavailable';
      assetId: string;
      reasons: readonly (
        | 'lineage_scope_mismatch'
        | 'lineage_graph_invalid'
        | 'pick_realization_ambiguous'
        | 'selected_player_evidence_missing'
        | 'selected_player_evidence_mismatch'
        | 'frontier_player_spell_missing'
        | 'frontier_player_evidence_missing'
        | 'frontier_player_evidence_mismatch'
      )[];
    };

function canonicalRefs(references: readonly AflTradeArtifactRef[]): AflTradeArtifactRef[] {
  return [...new Map(references.map((reference) => [reference.artifactId, reference])).values()].sort(
    (left, right) => left.artifactId.localeCompare(right.artifactId)
  );
}

export function derivePrivateGovernedPickEvidenceV3(input: {
  confirmedResultArtifact: AflTradeArtifactRef;
  asset: {
    assetId: string;
    transferAssetVersionId: string;
    receivingClubId: string;
    factualReleaseId: string;
    tradeKnowledgeCutoffAt: string;
    knowledgeCutoffAt: string;
  };
  lineage: ReadyLineage;
  frontierPlayerEvidence: readonly {
    frontierAssetId: string;
    admission: PrivateGovernedPlayerEvidenceAdmission;
  }[];
  realizedSelectedPlayerEvidence: PrivateGovernedPlayerEvidenceAdmission | null;
  admittedAt: string;
}): PrivateGovernedPickEvidenceV3Result {
  const rootTransfer = input.lineage.facts.transfers.find(
    ({ assetVersionId }) => assetVersionId === input.asset.transferAssetVersionId
  );
  if (
    input.lineage.membership.releaseId !== input.asset.factualReleaseId ||
    input.lineage.membership.rootAssetVersionId !== input.asset.transferAssetVersionId ||
    input.lineage.materialization.rootAssetId !== input.asset.assetId ||
    rootTransfer?.toClubId !== input.asset.receivingClubId ||
    rootTransfer.draftYear === null ||
    Date.parse(input.asset.tradeKnowledgeCutoffAt) > Date.parse(input.asset.knowledgeCutoffAt) ||
    Date.parse(input.asset.knowledgeCutoffAt) > Date.parse(input.admittedAt)
  ) {
    return { state: 'unavailable', assetId: input.asset.assetId, reasons: ['lineage_scope_mismatch'] };
  }
  if (!validateAflTradeLineageGraph(input.lineage.materialization.graph).valid) {
    return { state: 'unavailable', assetId: input.asset.assetId, reasons: ['lineage_graph_invalid'] };
  }
  const assetRealizations = input.lineage.facts.realizations.filter(
    (realization) =>
      realization.transferAssetVersionId === input.asset.transferAssetVersionId
  );
  if (assetRealizations.length > 1) {
    return {
      state: 'unavailable',
      assetId: input.asset.assetId,
      reasons: ['pick_realization_ambiguous'],
    };
  }
  const realizationAtCutoff = input.lineage.materialization.realizationAtCutoff;
  if (
    (assetRealizations.length === 0 && realizationAtCutoff.state !== 'unrealized') ||
    (assetRealizations.length === 1 &&
      (realizationAtCutoff.state !== 'selected' ||
        realizationAtCutoff.realizationId !== assetRealizations[0]!.realizationId))
  ) {
    return {
      state: 'unavailable',
      assetId: input.asset.assetId,
      reasons: ['lineage_scope_mismatch'],
    };
  }

  const playerFrontiers = input.lineage.materialization.frontierAssets.filter(
    (asset): asset is PlayerFrontier => asset.assetType === 'player'
  );
  if (playerFrontiers.some(({ identity }) => identity.acquisitionSpellVersionId === null)) {
    return {
      state: 'unavailable',
      assetId: input.asset.assetId,
      reasons: ['frontier_player_spell_missing'],
    };
  }
  if (input.frontierPlayerEvidence.length !== playerFrontiers.length) {
    return {
      state: 'unavailable',
      assetId: input.asset.assetId,
      reasons: ['frontier_player_evidence_missing'],
    };
  }
  if (
    realizationAtCutoff.state === 'selected' &&
    input.realizedSelectedPlayerEvidence === null
  ) {
    return {
      state: 'unavailable',
      assetId: input.asset.assetId,
      reasons: ['selected_player_evidence_missing'],
    };
  }
  if (
    realizationAtCutoff.state === 'unrealized' &&
    input.realizedSelectedPlayerEvidence !== null
  ) {
    return {
      state: 'unavailable',
      assetId: input.asset.assetId,
      reasons: ['selected_player_evidence_mismatch'],
    };
  }

  const artifacts: Array<{
    role:
      | 'lineage_readback'
      | 'lineage_graph'
      | 'frontier_player_evidence'
      | 'selected_player_evidence';
    reference: AflTradeArtifactRef;
    document: unknown;
  }> = [];
  const playerEvidenceRefs: AflTradeArtifactRef[] = [];
  if (input.lineage.evidence.source !== 'postgres_json') {
    throw new TypeError('Governed pick evidence requires an exact PostgreSQL lineage readback.');
  }
  const lineageReadbackArtifact = createAflTradeCanonicalJsonArtifactRef(
    input.lineage.evidence.document,
    input.lineage.evidence.createdAt
  );
  const lineageGraphArtifact = createAflTradeCanonicalJsonArtifactRef(
    input.lineage.materialization.graph,
    input.admittedAt
  );
  artifacts.push(
    { role: 'lineage_readback', reference: lineageReadbackArtifact, document: input.lineage.evidence.document },
    { role: 'lineage_graph', reference: lineageGraphArtifact, document: input.lineage.materialization.graph }
  );

  const playerEvidenceByAsset = new Map(
    input.frontierPlayerEvidence.map((evidence) => [evidence.frontierAssetId, evidence])
  );
  const frontierEvidence = input.lineage.materialization.frontierAssets.map((frontier) => {
    if (frontier.identity.kind === 'pick') {
      return { kind: 'unrealized_pick_entitlement' as const, frontierAssetId: frontier.assetId };
    }
    const evidence = playerEvidenceByAsset.get(frontier.assetId);
    if (evidence === undefined) {
      throw new TypeError('Frontier player evidence disappeared after completeness validation.');
    }
    const admission = privateGovernedPlayerEvidenceAdmissionSchema.parse(evidence.admission);
    if (
      admission.content.assetId !== frontier.assetId ||
      admission.content.canonicalPlayerId !== frontier.identity.playerId ||
      admission.content.acquisitionSpellVersionId !==
        frontier.identity.acquisitionSpellVersionId ||
      admission.content.receivingClubId !== frontier.acquisitionClubId ||
      admission.content.knowledgeCutoffAt !== input.asset.knowledgeCutoffAt
    ) {
      return null;
    }
    const admissionArtifact = createAflTradeCanonicalJsonArtifactRef(
      admission,
      admission.content.admittedAt
    );
    playerEvidenceRefs.push(...admission.content.evidenceRefs);
    artifacts.push({
      role: 'frontier_player_evidence',
      reference: admissionArtifact,
      document: admission,
    });
    return {
      kind: 'exhaustive_player_horizons' as const,
      frontierAssetId: frontier.assetId,
      admissionId: admission.admissionId,
      admissionArtifact,
    };
  });
  if (frontierEvidence.some((evidence) => evidence === null)) {
    return {
      state: 'unavailable',
      assetId: input.asset.assetId,
      reasons: ['frontier_player_evidence_mismatch'],
    };
  }

  let retainedRealization: z.input<typeof realizationAtCutoffSchema>;
  if (realizationAtCutoff.state === 'unrealized') {
    retainedRealization = realizationAtCutoff;
  } else {
    const admission = privateGovernedPlayerEvidenceAdmissionSchema.parse(
      input.realizedSelectedPlayerEvidence
    );
    const player = realizationAtCutoff.selectedPlayer;
    if (
      admission.content.assetId !== player.assetId ||
      admission.content.canonicalPlayerId !== player.identity.playerId ||
      admission.content.acquisitionSpellVersionId !==
        player.identity.acquisitionSpellVersionId ||
      admission.content.receivingClubId !== player.acquisitionClubId ||
      admission.content.knowledgeCutoffAt !== input.asset.knowledgeCutoffAt ||
      Date.parse(admission.content.admittedAt) > Date.parse(input.admittedAt) ||
      !doAflTradeArtifactRefsExactlyMatch(
        admission.content.confirmedResultArtifact,
        input.confirmedResultArtifact
      )
    ) {
      return {
        state: 'unavailable',
        assetId: input.asset.assetId,
        reasons: ['selected_player_evidence_mismatch'],
      };
    }
    const admissionArtifact = createAflTradeCanonicalJsonArtifactRef(
      admission,
      admission.content.admittedAt
    );
    playerEvidenceRefs.push(...admission.content.evidenceRefs);
    if (!artifacts.some(({ reference }) => reference.artifactId === admissionArtifact.artifactId)) {
      artifacts.push({
        role: 'selected_player_evidence',
        reference: admissionArtifact,
        document: admission,
      });
    }
    retainedRealization = {
      ...realizationAtCutoff,
      selectedPlayerEvidence: {
        admissionId: admission.admissionId,
        admissionArtifact,
      },
    };
  }

  const evidenceRefs = canonicalRefs([
    input.confirmedResultArtifact,
    lineageReadbackArtifact,
    lineageGraphArtifact,
    ...playerEvidenceRefs,
    ...artifacts
      .filter(
        ({ role }) =>
          role === 'frontier_player_evidence' || role === 'selected_player_evidence'
      )
      .map(({ reference }) => reference),
  ]);
  const content = contentSchema.parse({
    schemaVersion: PRIVATE_GOVERNED_PICK_EVIDENCE_SCHEMA_VERSION_V3,
    environment: 'non_production',
    authority: 'canonical_custody_aware_conserved_frontier_and_factual_outcomes',
    confirmedResultArtifact: input.confirmedResultArtifact,
    ...input.asset,
    draftYear: rootTransfer.draftYear,
    lineageReadbackArtifact,
    lineageGraph: input.lineage.materialization.graph,
    lineageGraphArtifact,
    frontierAssets: input.lineage.materialization.frontierAssets,
    frontierEvidence,
    realizationAtCutoff: retainedRealization,
    atTradeValueAuthority: 'governed_pick_model_required',
    remainingValueAuthority: 'governed_pick_model_required',
    evidenceRefs,
    admittedAt: input.admittedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Exact private local non-production pick facts and conserved-frontier evidence only; no missing value is zero, scores require governed model runs, and publication is prohibited.',
  });
  return {
    state: 'ready',
    admission: privateGovernedPickEvidenceAdmissionV3Schema.parse({
      admissionId: createAflTradeContentAddress('private-governed-pick-evidence', content),
      content,
    }),
    artifacts,
  };
}
