import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const HPN_DPVC_V3_PICK_VALUE_BENCHMARK_SCHEMA_VERSION =
  'hpn-dpvc-v3-pick-value-benchmark/v1' as const;
const FIRST_SUPPORTED_PICK = 1;
const LAST_SUPPORTED_PICK = 90;

export function hpnDpv3ValueForPick(selectionNumber: number): number {
  if (
    !Number.isInteger(selectionNumber) ||
    selectionNumber < FIRST_SUPPORTED_PICK ||
    selectionNumber > LAST_SUPPORTED_PICK
  ) {
    throw new RangeError('HPN DPVC v3 supports integer national-draft selections 1 through 90.');
  }
  return -30.36 * Math.log(selectionNumber) + 146.95;
}

const benchmarkContentSchema = z
  .object({
    schemaVersion: z.literal(HPN_DPVC_V3_PICK_VALUE_BENCHMARK_SCHEMA_VERSION),
    sourceArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    sourceContentSha256: aflTradeSha256Schema,
    sourceUrl: z.literal('https://www.hpnfooty.com/?page_id=22741'),
    capturedAt: z.string().datetime({ offset: false, precision: 3 }),
    modelName: z.literal('Draft Pick Value Calculator version 3'),
    equation: z.literal('DPVC(p) = -30.36 * ln(p) + 146.95'),
    trainingEra: z.object({ fromYear: z.literal(1993), throughYear: z.literal(2006) }).strict(),
    fatherSonSelections: z.literal('excluded'),
    supportedSelectionRange: z
      .object({ from: z.literal(FIRST_SUPPORTED_PICK), through: z.literal(LAST_SUPPORTED_PICK) })
      .strict(),
    rSquared: z.literal(0.73),
    curve: z
      .array(
        z
          .object({
            selectionNumber: z.number().int().min(FIRST_SUPPORTED_PICK).max(LAST_SUPPORTED_PICK),
            dpvcValue: z.number().finite(),
          })
          .strict()
      )
      .length(LAST_SUPPORTED_PICK),
    role: z.literal('external_historical_benchmark_not_statly_model'),
    limitations: z.literal(
      'National-draft historical reference only; not pathway-aware, era-updated, uncertainty-calibrated, or a Statly grade input by itself.'
    ),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceArtifactId !== `artifact:${value.sourceContentSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['sourceArtifactId'],
        message: 'The source artifact must bind the retained HPN source bytes.',
      });
    }
    value.curve.forEach((point, index) => {
      const expectedSelection = index + 1;
      if (
        point.selectionNumber !== expectedSelection ||
        point.dpvcValue !== hpnDpv3ValueForPick(expectedSelection)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['curve', index],
          message: 'The curve must exactly reproduce the supported DPVC v3 equation.',
        });
      }
    });
  });

const benchmarkSchema = z
  .object({
    benchmarkId: aflTradeContentAddressedIdSchema('hpn-pick-benchmark'),
    content: benchmarkContentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeContentAddressIssue(
      'hpn-pick-benchmark',
      value.benchmarkId,
      value.content,
      context,
      ['benchmarkId']
    );
  });

export type HpnDraftPickValueBenchmark = z.infer<typeof benchmarkSchema>;

export function createHpnDraftPickValueBenchmark(input: {
  sourceArtifactId: string;
  sourceContentSha256: string;
  capturedAt: string;
}): HpnDraftPickValueBenchmark {
  const content = benchmarkContentSchema.parse({
    schemaVersion: HPN_DPVC_V3_PICK_VALUE_BENCHMARK_SCHEMA_VERSION,
    ...input,
    sourceUrl: 'https://www.hpnfooty.com/?page_id=22741',
    modelName: 'Draft Pick Value Calculator version 3',
    equation: 'DPVC(p) = -30.36 * ln(p) + 146.95',
    trainingEra: { fromYear: 1993, throughYear: 2006 },
    fatherSonSelections: 'excluded',
    supportedSelectionRange: { from: FIRST_SUPPORTED_PICK, through: LAST_SUPPORTED_PICK },
    rSquared: 0.73,
    curve: Array.from({ length: LAST_SUPPORTED_PICK }, (_, index) => ({
      selectionNumber: index + 1,
      dpvcValue: hpnDpv3ValueForPick(index + 1),
    })),
    role: 'external_historical_benchmark_not_statly_model',
    limitations:
      'National-draft historical reference only; not pathway-aware, era-updated, uncertainty-calibrated, or a Statly grade input by itself.',
    publicationEligible: false,
  });
  return benchmarkSchema.parse({
    benchmarkId: createAflTradeContentAddress('hpn-pick-benchmark', content),
    content,
  });
}
