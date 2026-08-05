import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';

const UINT52_RANGE = 2 ** 52;
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const AFL_TRADE_DETERMINISTIC_SAMPLING_STREAMS = [
  'model_bootstrap',
  'outcome_distribution',
  'draft_class_shared_effect',
  'future_ladder_landing',
  'productive_delay',
  'monte_carlo_diagnostic',
] as const;

export const AFL_TRADE_UNCERTAINTY_COMPONENTS = [
  'model_estimation',
  'outcome_distribution',
  'draft_class_shared_effect',
  'future_ladder_landing',
  'monte_carlo_error',
] as const;

export const aflTradeDeterministicSampleCoordinateSchema = z
  .object({
    algorithmVersion: z.literal('counter_sha256_rejection_v1'),
    seed: publicIdSchema,
    stream: z.enum(AFL_TRADE_DETERMINISTIC_SAMPLING_STREAMS),
    streamKey: publicIdSchema,
    counters: z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).min(1).max(8),
  })
  .strict();

const bootstrapStratumSchema = z
  .object({
    stratumId: publicIdSchema,
    draftClassIds: z.array(publicIdSchema).min(1).max(500),
  })
  .strict();

export const aflTradeClusterBootstrapProtocolContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-cluster-bootstrap-protocol/v1'),
    algorithmVersion: z.literal('counter_sha256_rejection_v1'),
    seed: publicIdSchema,
    replicateCount: z.number().int().positive().max(100_000),
    resamplingUnit: z.literal('whole_draft_class'),
    preserveClusterCountWithinStratum: z.literal(true),
    stratificationPolicy: z.literal('declared_pre_prediction_strata'),
    targetUncertainty: z.literal('model_estimation'),
    separatelyReportedUncertaintyComponents: z.tuple([
      z.literal('model_estimation'),
      z.literal('outcome_distribution'),
      z.literal('draft_class_shared_effect'),
      z.literal('future_ladder_landing'),
      z.literal('monte_carlo_error'),
    ]),
    strata: z.array(bootstrapStratumSchema).min(1).max(100),
    limitation: z.literal(
      'Bootstrap replicates estimate model uncertainty only and are not outcome, shared-effect, landing, or Monte Carlo uncertainty.'
    ),
  })
  .strict()
  .superRefine((protocol, context) => {
    const stratumIds = protocol.strata.map(({ stratumId }) => stratumId);
    const clusterIds = protocol.strata.flatMap(({ draftClassIds }) => draftClassIds);
    const strataSorted = [...protocol.strata].sort((left, right) =>
      left.stratumId.localeCompare(right.stratumId)
    );
    if (
      new Set(stratumIds).size !== stratumIds.length ||
      new Set(clusterIds).size !== clusterIds.length ||
      protocol.strata.some(
        (stratum, index) =>
          stratum.stratumId !== strataSorted[index].stratumId ||
          new Set(stratum.draftClassIds).size !== stratum.draftClassIds.length ||
          stratum.draftClassIds.some(
            (clusterId, clusterIndex) =>
              clusterId !== [...stratum.draftClassIds].sort()[clusterIndex]
          )
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['strata'],
        message: 'Bootstrap strata and globally unique draft classes must use canonical ordering.',
      });
    }
  });

export const aflTradeClusterBootstrapProtocolSchema = z
  .object({
    bootstrapProtocolId: aflTradeContentAddressedIdSchema('cluster-bootstrap-protocol'),
    content: aflTradeClusterBootstrapProtocolContentSchema,
  })
  .strict()
  .superRefine((protocol, context) => {
    addAflTradeContentAddressIssue(
      'cluster-bootstrap-protocol',
      protocol.bootstrapProtocolId,
      protocol.content,
      context,
      ['bootstrapProtocolId']
    );
  });

const sampledBootstrapStratumSchema = z
  .object({
    stratumId: publicIdSchema,
    sourceDraftClassCount: z.number().int().positive().max(500),
    sampledDraftClassIds: z.array(publicIdSchema).min(1).max(500),
  })
  .strict()
  .superRefine((stratum, context) => {
    if (stratum.sampledDraftClassIds.length !== stratum.sourceDraftClassCount) {
      context.addIssue({
        code: 'custom',
        path: ['sampledDraftClassIds'],
        message: 'Each bootstrap stratum must preserve its source draft-class count.',
      });
    }
  });

export const aflTradeClusterBootstrapReplicateContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-cluster-bootstrap-replicate/v1'),
    bootstrapProtocolId: aflTradeContentAddressedIdSchema('cluster-bootstrap-protocol'),
    replicateIndex: z.number().int().nonnegative().max(99_999),
    algorithmVersion: z.literal('counter_sha256_rejection_v1'),
    resamplingUnit: z.literal('whole_draft_class'),
    targetUncertainty: z.literal('model_estimation'),
    sampledStrata: z.array(sampledBootstrapStratumSchema).min(1).max(100),
  })
  .strict()
  .superRefine((replicate, context) => {
    const stratumIds = replicate.sampledStrata.map(({ stratumId }) => stratumId);
    if (
      new Set(stratumIds).size !== stratumIds.length ||
      replicate.sampledStrata.some(
        (stratum, index) =>
          stratum.stratumId !==
          [...replicate.sampledStrata].sort((left, right) =>
            left.stratumId.localeCompare(right.stratumId)
          )[index].stratumId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sampledStrata'],
        message: 'Sampled bootstrap strata must be unique and canonically ordered.',
      });
    }
  });

export const aflTradeClusterBootstrapReplicateSchema = z
  .object({
    bootstrapReplicateId: aflTradeContentAddressedIdSchema('cluster-bootstrap-replicate'),
    content: aflTradeClusterBootstrapReplicateContentSchema,
  })
  .strict()
  .superRefine((replicate, context) => {
    addAflTradeContentAddressIssue(
      'cluster-bootstrap-replicate',
      replicate.bootstrapReplicateId,
      replicate.content,
      context,
      ['bootstrapReplicateId']
    );
  });

export type AflTradeDeterministicSampleCoordinate = z.infer<
  typeof aflTradeDeterministicSampleCoordinateSchema
>;
export type AflTradeClusterBootstrapProtocolContent = z.infer<
  typeof aflTradeClusterBootstrapProtocolContentSchema
>;
export type AflTradeClusterBootstrapProtocol = z.infer<
  typeof aflTradeClusterBootstrapProtocolSchema
>;
export type AflTradeClusterBootstrapReplicate = z.infer<
  typeof aflTradeClusterBootstrapReplicateSchema
>;

function uint52AtAttempt(
  coordinate: AflTradeDeterministicSampleCoordinate,
  rejectionAttempt: number
): number {
  const digest = sha256AflTradeCanonicalJson({
    ...coordinate,
    rejectionAttempt,
  });
  return Number.parseInt(digest.slice(0, 13), 16);
}

export function sampleAflTradeDeterministicUnitInterval(
  unparsedCoordinate: AflTradeDeterministicSampleCoordinate
): number {
  const coordinate = aflTradeDeterministicSampleCoordinateSchema.parse(unparsedCoordinate);
  return uint52AtAttempt(coordinate, 0) / UINT52_RANGE;
}

export function sampleAflTradeDeterministicBoundedIndex(
  unparsedCoordinate: AflTradeDeterministicSampleCoordinate,
  exclusiveUpperBound: number
): number {
  const coordinate = aflTradeDeterministicSampleCoordinateSchema.parse(unparsedCoordinate);
  if (
    !Number.isSafeInteger(exclusiveUpperBound) ||
    exclusiveUpperBound <= 0 ||
    exclusiveUpperBound > UINT52_RANGE
  ) {
    throw new RangeError('The deterministic bounded sampler requires a positive uint52 bound.');
  }
  const rejectionLimit = Math.floor(UINT52_RANGE / exclusiveUpperBound) * exclusiveUpperBound;
  for (let rejectionAttempt = 0; rejectionAttempt < 1_000_000; rejectionAttempt += 1) {
    const sampledInteger = uint52AtAttempt(coordinate, rejectionAttempt);
    if (sampledInteger < rejectionLimit) return sampledInteger % exclusiveUpperBound;
  }
  throw new Error('The deterministic bounded sampler exceeded its rejection safety limit.');
}

export function sampleAflTradeDeterministicWeightedIndex(
  unparsedCoordinate: AflTradeDeterministicSampleCoordinate,
  unparsedWeights: readonly number[]
): number {
  const coordinate = aflTradeDeterministicSampleCoordinateSchema.parse(unparsedCoordinate);
  if (
    unparsedWeights.length === 0 ||
    unparsedWeights.some((weight) => !Number.isFinite(weight) || weight < 0)
  ) {
    throw new RangeError('Deterministic weighted sampling requires finite non-negative weights.');
  }
  const totalWeight = unparsedWeights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new RangeError('Deterministic weighted sampling requires positive finite total weight.');
  }
  const threshold = sampleAflTradeDeterministicUnitInterval(coordinate) * totalWeight;
  let cumulativeWeight = 0;
  for (const [index, weight] of unparsedWeights.entries()) {
    cumulativeWeight += weight;
    if (threshold < cumulativeWeight) return index;
  }
  return unparsedWeights.length - 1;
}

export function createAflTradeClusterBootstrapProtocol(
  unparsedContent: AflTradeClusterBootstrapProtocolContent
): AflTradeClusterBootstrapProtocol {
  const parsed = aflTradeClusterBootstrapProtocolContentSchema.parse({
    ...unparsedContent,
    strata: [...unparsedContent.strata]
      .map((stratum) => ({
        ...stratum,
        draftClassIds: [...stratum.draftClassIds].sort(),
      }))
      .sort((left, right) => left.stratumId.localeCompare(right.stratumId)),
  });
  return aflTradeClusterBootstrapProtocolSchema.parse({
    bootstrapProtocolId: createAflTradeContentAddress('cluster-bootstrap-protocol', parsed),
    content: parsed,
  });
}

export function createAflTradeClusterBootstrapReplicate(
  unparsedProtocol: AflTradeClusterBootstrapProtocol,
  replicateIndex: number
): AflTradeClusterBootstrapReplicate {
  const protocol = aflTradeClusterBootstrapProtocolSchema.parse(unparsedProtocol);
  if (
    !Number.isInteger(replicateIndex) ||
    replicateIndex < 0 ||
    replicateIndex >= protocol.content.replicateCount
  ) {
    throw new RangeError('Bootstrap replicate index must be inside the protocol replicate range.');
  }
  const sampledStrata = protocol.content.strata.map((stratum, stratumIndex) => ({
    stratumId: stratum.stratumId,
    sourceDraftClassCount: stratum.draftClassIds.length,
    sampledDraftClassIds: Array.from({ length: stratum.draftClassIds.length }, (_, drawIndex) => {
      const sampledIndex = sampleAflTradeDeterministicBoundedIndex(
        {
          algorithmVersion: protocol.content.algorithmVersion,
          seed: protocol.content.seed,
          stream: 'model_bootstrap',
          streamKey: protocol.bootstrapProtocolId,
          counters: [replicateIndex, stratumIndex, drawIndex],
        },
        stratum.draftClassIds.length
      );
      return stratum.draftClassIds[sampledIndex];
    }),
  }));
  const content = aflTradeClusterBootstrapReplicateContentSchema.parse({
    schemaVersion: 'afl-trade-cluster-bootstrap-replicate/v1',
    bootstrapProtocolId: protocol.bootstrapProtocolId,
    replicateIndex,
    algorithmVersion: protocol.content.algorithmVersion,
    resamplingUnit: protocol.content.resamplingUnit,
    targetUncertainty: protocol.content.targetUncertainty,
    sampledStrata,
  });
  return aflTradeClusterBootstrapReplicateSchema.parse({
    bootstrapReplicateId: createAflTradeContentAddress('cluster-bootstrap-replicate', content),
    content,
  });
}
