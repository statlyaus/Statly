import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeValuationInputBundleSchema } from '../artifacts/valuationInputBundle';
import {
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION,
  aflTradePreparedValuationInputEntrySchema,
  createAflTradePreparedValuationInputSet,
  type AflTradePreparedValuationInputSet,
  type AflTradePreparedValuationInputSetContent,
} from './preparedValuationInputSet';
import type { AflTradeCurrentPreparedValuationInputHead } from './postgresPreparedValuationInputSetStore';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);

export const aflTradeCurrentValuationCohortPreparationRequestSchema = z
  .object({
    operationId: aflTradeContentAddressedIdSchema(
      'valuation-cohort-preparation-operation'
    ),
    scopeKey: publicIdSchema,
  })
  .strict();

export const aflTradeCurrentValuationCohortConstructionContextSchema = z
  .object({
    operationId: aflTradeContentAddressedIdSchema(
      'valuation-cohort-preparation-operation'
    ),
    scopeKey: publicIdSchema,
    factualReleaseScopeKey: publicIdSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualReleaseRevision: z.number().int().positive(),
    factualReleaseArtifact: aflTradeArtifactRefSchema,
    releaseMembershipArtifact: aflTradeArtifactRefSchema,
    releaseTradeIds: z.array(publicIdSchema).min(1).max(10_000),
    sourceQualificationReportId: aflTradeContentAddressedIdSchema(
      'valuation-source-qualification'
    ),
    sourceQualificationReportArtifact: aflTradeArtifactRefSchema,
    sourceQualificationEvidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(1_000),
    modelQualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
    modelQualificationWorkId: aflTradeContentAddressedIdSchema('model-qualification-work'),
    modelQualificationRevision: z.number().int().positive(),
    playerRunId: aflTradeContentAddressedIdSchema('model-run'),
    pickRunId: aflTradeContentAddressedIdSchema('model-run'),
    expectedPreparedInputRevision: z.number().int().nonnegative(),
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    valuationInputBundleArtifact: aflTradeArtifactRefSchema,
    capturedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((context, refinement) => {
    const tradeIds = context.releaseTradeIds;
    if (
      new Set(tradeIds).size !== tradeIds.length ||
      tradeIds.some((tradeId, index) => index > 0 && tradeIds[index - 1]! > tradeId)
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['releaseTradeIds'],
        message: 'Current cohort release trades must be unique and canonically ordered.',
      });
    }
    const capturedAt = Date.parse(context.capturedAt);
    const parents = [
      context.factualReleaseArtifact,
      context.releaseMembershipArtifact,
      context.sourceQualificationReportArtifact,
      ...context.sourceQualificationEvidenceRefs,
      context.valuationInputBundleArtifact,
    ];
    if (parents.some(({ createdAt }) => Date.parse(createdAt) > capturedAt)) {
      refinement.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: 'Current cohort authority cannot predate retained construction evidence.',
      });
    }
  });

export const aflTradePersistedCurrentValuationCohortConstructionContextSchema =
  aflTradeCurrentValuationCohortConstructionContextSchema
    .safeExtend({ valuationInputBundle: aflTradeValuationInputBundleSchema })
    .superRefine((context, refinement) => {
      if (
        context.valuationInputBundle.valuationInputBundleId !==
          context.valuationInputBundleId ||
        context.valuationInputBundle.content.scopeKey !== context.scopeKey ||
        context.valuationInputBundle.content.components[0]?.runId !== context.playerRunId ||
        context.valuationInputBundle.content.components[1]?.runId !== context.pickRunId
      ) {
        refinement.addIssue({
          code: 'custom',
          path: ['valuationInputBundle'],
          message: 'Retained cohort valuation bundle must bind the exact scope and model runs.',
        });
      }
    });

export type AflTradeCurrentValuationCohortPreparationRequest = z.infer<
  typeof aflTradeCurrentValuationCohortPreparationRequestSchema
>;

export function createAflTradeCurrentValuationCohortPreparationOperationId(input: {
  readonly scopeKey: string;
  readonly factualReleaseId: string;
  readonly factualReleaseRevision: number;
  readonly modelQualificationId: string;
  readonly modelQualificationWorkId: string;
  readonly modelQualificationRevision: number;
  readonly expectedPreparedInputRevision: number;
}): string {
  return createAflTradeContentAddress('valuation-cohort-preparation-operation', input);
}
export type AflTradeCurrentValuationCohortConstructionContext = z.infer<
  typeof aflTradeCurrentValuationCohortConstructionContextSchema
>;
type AflTradePreparedValuationInputEntryV3 = Extract<
  AflTradePreparedValuationInputSetContent,
  { readonly schemaVersion: typeof AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION }
>['entries'][number];

export type AflTradeCurrentValuationCohortPreparationResult =
  | Readonly<{
      state: 'advanced' | 'already_current';
      preparedInputSet: AflTradePreparedValuationInputSet;
      head: AflTradeCurrentPreparedValuationInputHead;
    }>
  | Readonly<{
      state: 'stale_authority';
      reason: string;
    }>;

interface AflTradeCurrentValuationCohortPreparationDependencies {
  readonly maximumConcurrency?: number;
  readonly captureCurrent: (
    request: AflTradeCurrentValuationCohortPreparationRequest
  ) => Promise<AflTradeCurrentValuationCohortConstructionContext>;
  readonly prepareTrade: (input: {
    readonly context: AflTradeCurrentValuationCohortConstructionContext;
    readonly tradeId: string;
  }) => Promise<AflTradePreparedValuationInputEntryV3>;
  readonly commitIfCurrent: (input: {
    readonly context: AflTradeCurrentValuationCohortConstructionContext;
    readonly preparedInputSet: AflTradePreparedValuationInputSet;
  }) => Promise<AflTradeCurrentValuationCohortPreparationResult>;
}

export interface AflTradeCurrentValuationCohortCoordinator {
  prepare(
    request: AflTradeCurrentValuationCohortPreparationRequest
  ): Promise<AflTradeCurrentValuationCohortPreparationResult>;
}

export class AflTradeCurrentValuationTradeUnavailableError extends Error {}

export function createAflTradeCurrentValuationCohortCoordinator(
  dependencies: AflTradeCurrentValuationCohortPreparationDependencies
): AflTradeCurrentValuationCohortCoordinator {
  const maximumConcurrency = dependencies.maximumConcurrency ?? 8;
  if (
    !Number.isSafeInteger(maximumConcurrency) ||
    maximumConcurrency < 1 ||
    maximumConcurrency > 32
  ) {
    throw new TypeError('Current cohort preparation concurrency must be between 1 and 32.');
  }
  return {
    async prepare(unparsedRequest) {
      const request = aflTradeCurrentValuationCohortPreparationRequestSchema.parse(
        unparsedRequest
      );
      const context = aflTradeCurrentValuationCohortConstructionContextSchema.parse(
        await dependencies.captureCurrent(request)
      );
      if (context.operationId !== request.operationId || context.scopeKey !== request.scopeKey) {
        throw new TypeError('Current cohort capture escaped its requested operation or scope.');
      }
      const entries = new Array<AflTradePreparedValuationInputEntryV3>(
        context.releaseTradeIds.length
      );
      let nextIndex = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(maximumConcurrency, context.releaseTradeIds.length) },
          async () => {
            while (nextIndex < context.releaseTradeIds.length) {
              const index = nextIndex;
              nextIndex += 1;
              const tradeId = context.releaseTradeIds[index]!;
              let entry: AflTradePreparedValuationInputEntryV3;
              try {
                entry = aflTradePreparedValuationInputEntrySchema.parse(
                  await dependencies.prepareTrade({ context, tradeId })
                ) as AflTradePreparedValuationInputEntryV3;
              } catch (error) {
                if (!(error instanceof AflTradeCurrentValuationTradeUnavailableError)) {
                  throw error;
                }
                entry = aflTradePreparedValuationInputEntrySchema.parse({
                  tradeId,
                  state: 'blocked',
                  blockers: [
                    {
                      code: 'component_output_unavailable',
                      subject: { kind: 'trade', id: tradeId },
                      evidenceRefs: [context.valuationInputBundleArtifact],
                    },
                  ],
                }) as AflTradePreparedValuationInputEntryV3;
              }
              if (entry.tradeId !== tradeId) {
                throw new TypeError(
                  'Current cohort trade preparation escaped its factual member.'
                );
              }
              entries[index] = entry;
            }
          }
        )
      );
      const readyCount = entries.filter(({ state }) => state === 'ready').length;
      const entryEvidence = entries.flatMap((entry) =>
        entry.state === 'ready'
          ? [entry.materializationManifestArtifact]
          : entry.blockers.flatMap(({ evidenceRefs }) => evidenceRefs)
      );
      const preparedAt = [
        context.factualReleaseArtifact,
        context.releaseMembershipArtifact,
        context.sourceQualificationReportArtifact,
        ...context.sourceQualificationEvidenceRefs,
        context.valuationInputBundleArtifact,
        ...entryEvidence,
      ].reduce(
        (latest, { createdAt }) =>
          Date.parse(createdAt) > Date.parse(latest) ? createdAt : latest,
        context.factualReleaseArtifact.createdAt
      );
      const preparedInputSet = createAflTradePreparedValuationInputSet({
        schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION,
        environment: 'non_production',
        scopeKey: context.scopeKey,
        factualReleaseScopeKey: context.factualReleaseScopeKey,
        factualReleaseId: context.factualReleaseId,
        factualReleaseArtifact: context.factualReleaseArtifact,
        releaseMembershipArtifact: context.releaseMembershipArtifact,
        preparationAuthority: 'authenticated_calculation_evidence_snapshot',
        qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
        qualificationReportId: context.sourceQualificationReportId,
        qualificationReportArtifact: context.sourceQualificationReportArtifact,
        sourceQualificationEvidenceRefs: context.sourceQualificationEvidenceRefs,
        valuationInputBundleId: context.valuationInputBundleId,
        valuationInputBundleArtifact: context.valuationInputBundleArtifact,
        releaseTradeIds: context.releaseTradeIds,
        entries,
        tradeCount: entries.length,
        readyCount,
        blockedCount: entries.length - readyCount,
        preparedAt,
        publicationEligible: false,
        limitation:
          'Private preparation evidence only; not a valuation result, publication approval, or activation authority.',
      });
      return dependencies.commitIfCurrent({ context, preparedInputSet });
    },
  };
}
