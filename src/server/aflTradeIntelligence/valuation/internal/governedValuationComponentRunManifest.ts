import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';

const SCHEMA_VERSION = 'governed-valuation-component-run/v1' as const;
const LIMITATION =
  'Authenticated non-production component-run candidate only; Gate 3 approval, grades, production use, and publication remain prohibited.' as const;
const instantSchema = z.iso.datetime({ offset: true });

const nativeExecutionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('admitted_player_model_run'),
      executionId: aflTradeContentAddressedIdSchema('model-run'),
      artifact: aflTradeArtifactRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('pick_pav_model_execution'),
      executionId: aflTradeContentAddressedIdSchema('pick-pav-model-execution'),
      artifact: aflTradeArtifactRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('governed_pick_pav_model_execution'),
      executionId: aflTradeContentAddressedIdSchema('pick-pav-model-execution'),
      artifact: aflTradeArtifactRefSchema,
    })
    .strict(),
]);

export const governedValuationComponentRunManifestContentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    environment: z.literal('non_production'),
    role: z.enum([
      'player_contribution_and_availability',
      'draft_pick_and_future_pick_distribution',
    ]),
    nativeExecution: nativeExecutionSchema,
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    protocolArtifact: aflTradeArtifactRefSchema,
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetArtifact: aflTradeArtifactRefSchema,
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    datasetAdmissionArtifact: aflTradeArtifactRefSchema,
    datasetAdmissionGateLedgerRevision: z.number().int().positive(),
    registeredAt: instantSchema,
    approvalState: z.literal('gate_3_review_required'),
    publicationEligible: z.literal(false),
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((manifest, context) => {
    const roleMatchesNativeExecution =
      manifest.role === 'player_contribution_and_availability'
        ? manifest.nativeExecution.kind === 'admitted_player_model_run'
        : manifest.nativeExecution.kind === 'pick_pav_model_execution' ||
          manifest.nativeExecution.kind === 'governed_pick_pav_model_execution';
    if (!roleMatchesNativeExecution) {
      context.addIssue({
        code: 'custom',
        path: ['nativeExecution'],
        message: 'Component role and native execution kind must agree.',
      });
    }

    const artifacts = [
      manifest.nativeExecution.artifact,
      manifest.protocolArtifact,
      manifest.datasetArtifact,
      manifest.datasetAdmissionArtifact,
    ];
    if (new Set(artifacts.map(({ artifactId }) => artifactId)).size !== artifacts.length) {
      context.addIssue({
        code: 'custom',
        path: ['nativeExecution'],
        message: 'Component-run evidence requires distinct retained artifacts.',
      });
    }
    if (
      artifacts.some(({ createdAt }) => Date.parse(createdAt) > Date.parse(manifest.registeredAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['registeredAt'],
        message: 'Every component-run evidence artifact must exist before registration.',
      });
    }
  });

export const governedValuationComponentRunManifestSchema = z
  .object({
    runId: aflTradeContentAddressedIdSchema('model-run'),
    content: governedValuationComponentRunManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('model-run', manifest.runId, manifest.content, context, [
      'runId',
    ]);
  });

export type GovernedValuationComponentRunManifest = z.infer<
  typeof governedValuationComponentRunManifestSchema
>;

export function createGovernedValuationComponentRunManifest(
  input: Omit<
    z.input<typeof governedValuationComponentRunManifestContentSchema>,
    'schemaVersion' | 'approvalState' | 'publicationEligible' | 'limitation'
  >
): GovernedValuationComponentRunManifest {
  const content = governedValuationComponentRunManifestContentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    ...input,
    approvalState: 'gate_3_review_required',
    publicationEligible: false,
    limitation: LIMITATION,
  });
  return governedValuationComponentRunManifestSchema.parse({
    runId: createAflTradeContentAddress('model-run', content),
    content,
  });
}

export function authenticateGovernedValuationComponentRunManifest(
  input: unknown
): GovernedValuationComponentRunManifest {
  return governedValuationComponentRunManifestSchema.parse(input);
}
