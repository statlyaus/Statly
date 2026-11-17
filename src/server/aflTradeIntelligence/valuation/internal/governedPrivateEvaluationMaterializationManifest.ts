import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import { governedPrivateEvaluationSelectorSchema } from './governedPrivateEvaluationWorkspaceContracts';

const LIMITATION =
  'Private materialization inputs only; not model, grade, activation, production, or publication authority.' as const;
const instantSchema = z.iso.datetime({ offset: true });

const pickBenchmarkSchema = z
  .object({
    benchmarkId: aflTradeContentAddressedIdSchema('pick-pav-benchmark'),
    artifact: aflTradeArtifactRefSchema,
  })
  .strict();

const playerObservationSchema = z
  .object({
    observationId: aflTradeContentAddressedIdSchema('player-pav-observation'),
    artifact: aflTradeArtifactRefSchema,
  })
  .strict();

export const governedPrivateEvaluationMaterializationManifestContentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-materialization-manifest/v1'),
    environment: z.literal('non_production'),
    selector: governedPrivateEvaluationSelectorSchema,
    calculationInputPackageId: aflTradeContentAddressedIdSchema(
      'valuation-calculation-input'
    ),
    calculationInputArtifact: aflTradeArtifactRefSchema,
    inputTraceId: aflTradeContentAddressedIdSchema('private-evaluation-input-trace'),
    inputTraceArtifact: aflTradeArtifactRefSchema,
    explanationPolicyId: aflTradeContentAddressedIdSchema(
      'private-evaluation-explanation-policy'
    ),
    explanationPolicyArtifact: aflTradeArtifactRefSchema,
    lineageGraphId: aflTradeContentAddressedIdSchema('lineage-graph'),
    lineageGraphArtifact: aflTradeArtifactRefSchema,
    pickBenchmarks: z.array(pickBenchmarkSchema).max(100),
    playerObservations: z.array(playerObservationSchema).max(100),
    createdAt: instantSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const [path, ids] of [
      ['pickBenchmarks', manifest.pickBenchmarks.map(({ benchmarkId }) => benchmarkId)],
      [
        'playerObservations',
        manifest.playerObservations.map(({ observationId }) => observationId),
      ],
    ] as const) {
      const canonical = [...ids].sort();
      if (new Set(ids).size !== ids.length || !exactJson(ids, canonical)) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: 'Materialization evidence must be unique and canonically ordered.',
        });
      }
    }
    const artifacts = [
      manifest.calculationInputArtifact,
      manifest.inputTraceArtifact,
      manifest.explanationPolicyArtifact,
      manifest.lineageGraphArtifact,
      ...manifest.pickBenchmarks.map(({ artifact }) => artifact),
      ...manifest.playerObservations.map(({ artifact }) => artifact),
    ];
    if (new Set(artifacts.map(({ artifactId }) => artifactId)).size !== artifacts.length) {
      context.addIssue({
        code: 'custom',
        path: ['calculationInputArtifact'],
        message: 'Materialization manifest parents require distinct retained bytes.',
      });
    }
    if (artifacts.some(({ createdAt }) => Date.parse(createdAt) > Date.parse(manifest.createdAt))) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Every materialization parent must exist before the manifest is created.',
      });
    }
  });

export const governedPrivateEvaluationMaterializationManifestSchema = z
  .object({
    manifestId: aflTradeContentAddressedIdSchema(
      'private-evaluation-materialization-manifest'
    ),
    content: governedPrivateEvaluationMaterializationManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-materialization-manifest',
      manifest.manifestId,
      manifest.content,
      context,
      ['manifestId']
    );
  });

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

export type GovernedPrivateEvaluationMaterializationManifest = z.infer<
  typeof governedPrivateEvaluationMaterializationManifestSchema
>;

export function createGovernedPrivateEvaluationMaterializationManifest(
  input: z.input<typeof governedPrivateEvaluationMaterializationManifestContentSchema>
): GovernedPrivateEvaluationMaterializationManifest {
  const content = governedPrivateEvaluationMaterializationManifestContentSchema.parse(input);
  return governedPrivateEvaluationMaterializationManifestSchema.parse({
    manifestId: createAflTradeContentAddress(
      'private-evaluation-materialization-manifest',
      content
    ),
    content,
  });
}
