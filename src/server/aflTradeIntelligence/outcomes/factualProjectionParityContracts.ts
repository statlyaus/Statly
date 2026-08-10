import { z } from 'zod';

import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeFactualReleaseCandidateSchema } from './factualReleaseCandidateContracts';
import { aflDraftTradeOutcomeFactualProjectionManifestSchema } from './outcomeReleaseContracts';

export const AFL_TRADE_FACTUAL_PROJECTION_PARITY_SCHEMA_VERSION =
  'afl-trade-factual-projection-parity/v1' as const;
export const AFL_TRADE_FACTUAL_PROJECTION_PARITY_AUTHORITY_BOUNDARY =
  'private_projection_evidence_no_activation_valuation_or_fantasy_ownership' as const;

const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Projection-parity instants must use UTC Z notation.');

export const aflTradeFactualProjectionParityContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FACTUAL_PROJECTION_PARITY_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_FACTUAL_PROJECTION_PARITY_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    checkedAt: utcInstantSchema,
    candidate: aflTradeFactualReleaseCandidateSchema,
    projection: aflDraftTradeOutcomeFactualProjectionManifestSchema,
    memberSetSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((evidence, context) => {
    const { candidate, projection } = evidence;
    const release = candidate.content.targetReleaseManifest;
    const expectedMetricDefinitionIds = release.content.metricDefinitions
      .map(({ metricDefinitionId }) => metricDefinitionId)
      .sort();
    if (
      evidence.memberSetSha256 !== candidate.content.memberSetSha256 ||
      projection.content.sourceMemberSetSha256 !== evidence.memberSetSha256 ||
      projection.content.factualCandidateId !== candidate.candidateId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['memberSetSha256'],
        message:
          'Projection derivation must start from the exact factual candidate and source root.',
      });
    }
    if (
      projection.content.releaseId !== release.releaseId ||
      projection.content.environment !== candidate.content.environment ||
      projection.content.scopeKey !== candidate.content.scopeKey ||
      projection.content.effectiveThrough !== candidate.content.effectiveThrough ||
      projection.content.archiveDatasetId !== candidate.content.archiveDataset.id ||
      projection.content.metricRegistryVersion !== candidate.content.metricRegistryVersion ||
      projection.content.metricDefinitionIds.length !== expectedMetricDefinitionIds.length ||
      projection.content.metricDefinitionIds.some(
        (definitionId, index) => definitionId !== expectedMetricDefinitionIds[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projection'],
        message: 'Projection does not exactly describe the factual release candidate.',
      });
    }
    if (
      projection.content.parityReport.checkedOutcomeRecordCount !==
        release.content.outcomeRecordCount ||
      Date.parse(projection.content.createdAt) < Date.parse(candidate.content.createdAt) ||
      Date.parse(evidence.checkedAt) < Date.parse(projection.content.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['checkedAt'],
        message: 'Projection parity counts or knowledge chronology are invalid.',
      });
    }
  });

export const aflTradeFactualProjectionParitySchema = z
  .object({
    parityId: aflTradeContentAddressedIdSchema('factual-projection-parity'),
    paritySha256: aflTradeSha256Schema,
    content: aflTradeFactualProjectionParityContentSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    addAflTradeContentAddressIssue(
      'factual-projection-parity',
      evidence.parityId,
      evidence.content,
      context,
      ['parityId']
    );
    if (evidence.parityId !== `factual-projection-parity:${evidence.paritySha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['paritySha256'],
        message: 'Projection-parity digest mismatch.',
      });
    }
  });

export type AflTradeFactualProjectionParity = z.infer<typeof aflTradeFactualProjectionParitySchema>;

export function createAflTradeFactualProjectionParity(
  content: z.input<typeof aflTradeFactualProjectionParityContentSchema>
): AflTradeFactualProjectionParity {
  const parsed = aflTradeFactualProjectionParityContentSchema.parse(content);
  const parityId = createAflTradeContentAddress('factual-projection-parity', parsed);
  return aflTradeFactualProjectionParitySchema.parse({
    parityId,
    paritySha256: parityId.slice('factual-projection-parity:'.length),
    content: parsed,
  });
}
