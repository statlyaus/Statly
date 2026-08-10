import { z } from 'zod';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeArtifactReadbackReceiptSchema,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';
import {
  aflTradePickPavModelExecutionSchema,
  type AflTradePickPavModelExecution,
} from './pickPavModelExecution';

export const AFL_TRADE_PICK_PAV_MODEL_CUSTODY_SCHEMA_VERSION =
  'afl-trade-pick-pav-model-custody/v1' as const;

const custodyContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PICK_PAV_MODEL_CUSTODY_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      'private_verified_model_execution_custody_not_gate_3_approval_grade_or_publication'
    ),
    publicationEligible: z.literal(false),
    executionId: z.string().regex(/^pick-pav-model-execution:[a-f0-9]{64}$/),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    repositoryAssurance: z.enum(['fixture_memory', 'durable_object_storage']),
    artifactClass: z.literal('derived_private'),
    custodyProfileId: z
      .string()
      .regex(/^artifact-custody-profile:[a-f0-9]{64}$/)
      .nullable(),
    executionArtifact: aflTradeArtifactRefSchema,
    executionReadback: aflTradeArtifactReadbackReceiptSchema,
    readbackReceiptArtifact: aflTradeArtifactRefSchema,
    readbackReceiptArtifactVerified: z.literal(true),
    retainedAt: z.iso.datetime({ offset: true }),
    status: z.literal('retained_verified'),
  })
  .strict()
  .superRefine((custody, context) => {
    if (
      custody.executionArtifact.artifactId !==
        custody.executionReadback.content.artifact.artifactId ||
      custody.executionArtifact.contentSha256 !==
        custody.executionReadback.content.artifact.contentSha256 ||
      custody.repositoryAssurance !== custody.executionReadback.content.repositoryAssurance ||
      custody.artifactClass !== custody.executionReadback.content.artifactClass ||
      custody.custodyProfileId !== custody.executionReadback.content.custodyProfileId ||
      custody.environment !== custody.executionReadback.content.custodyEnvironment ||
      Date.parse(custody.retainedAt) < Date.parse(custody.executionReadback.content.verifiedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['executionReadback'],
        message: 'Custody must bind the exact retained execution and readback evidence.',
      });
    }
  });

export const aflTradePickPavModelCustodyReceiptSchema = z
  .object({
    custodyReceiptId: z.string().regex(/^pick-pav-model-custody:[a-f0-9]{64}$/),
    content: custodyContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-model-custody',
      receipt.custodyReceiptId,
      receipt.content,
      context,
      ['custodyReceiptId']
    );
  });

export type AflTradePickPavModelCustodyReceipt = z.infer<
  typeof aflTradePickPavModelCustodyReceiptSchema
>;

function requireCustodyPolicy(
  execution: AflTradePickPavModelExecution,
  repository: AflTradeImmutableArtifactRepository
) {
  if (repository.artifactClass !== 'derived_private') {
    throw new TypeError('Pick-model executions require derived-private artifact custody.');
  }
  if (repository.assurance === 'fixture_memory') {
    if (execution.content.environment !== 'test_fixture' || repository.custodyProfile !== null) {
      throw new TypeError('Fixture custody is restricted to test-fixture model evidence.');
    }
    return;
  }
  const profile = repository.custodyProfile;
  if (
    profile === null ||
    profile.content.environment !== execution.content.environment ||
    profile.content.artifactClass !== 'derived_private'
  ) {
    throw new TypeError('Durable custody profile does not match the model execution environment.');
  }
}

async function requireExactStoredBytes(
  repository: AflTradeImmutableArtifactRepository,
  reference: z.infer<typeof aflTradeArtifactRefSchema>,
  expectedBytes: Uint8Array,
  maximumBytes: number
) {
  const stored = await repository.loadExact(reference, maximumBytes);
  if (
    stored === null ||
    !doesAflTradeArtifactRefMatchBytes(
      stored.reference,
      stored.bytes,
      AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE
    ) ||
    canonicalizeAflTradeJson(JSON.parse(new TextDecoder().decode(stored.bytes))) !==
      new TextDecoder().decode(expectedBytes)
  ) {
    throw new TypeError('Immutable custody readback did not match the expected canonical bytes.');
  }
}

export async function retainAflTradePickPavModelExecution(input: {
  execution: unknown;
  repository: AflTradeImmutableArtifactRepository;
  clock: { now(): Promise<string> };
  maximumBytes: number;
}): Promise<AflTradePickPavModelCustodyReceipt> {
  const execution = aflTradePickPavModelExecutionSchema.parse(input.execution);
  requireCustodyPolicy(execution, input.repository);
  if (!Number.isInteger(input.maximumBytes) || input.maximumBytes <= 0) {
    throw new TypeError('Model execution custody requires a positive byte bound.');
  }

  const executionBytes = new TextEncoder().encode(canonicalizeAflTradeJson(execution));
  const executionArtifact = createAflTradeCanonicalJsonArtifactRef(
    execution,
    execution.content.completedAt
  );
  if (executionArtifact.byteLength > input.maximumBytes) {
    throw new TypeError('The model execution exceeds the configured custody byte bound.');
  }
  await input.repository.putIfAbsent(executionArtifact, executionBytes);
  await requireExactStoredBytes(
    input.repository,
    executionArtifact,
    executionBytes,
    input.maximumBytes
  );
  const executionVerifiedAt = await input.clock.now();
  const readbackContent = {
    schemaVersion: 'afl-trade-artifact-readback/v4' as const,
    artifact: executionArtifact,
    repositoryAssurance: input.repository.assurance,
    artifactClass: input.repository.artifactClass,
    custodyProfileId: input.repository.custodyProfile?.profileId ?? null,
    custodyProfile: input.repository.custodyProfile,
    custodyEnvironment: input.repository.custodyProfile?.content.environment ?? 'test_fixture',
    verifiedAt: executionVerifiedAt,
    verification: 'exact_reference_and_sha256_bytes' as const,
    status: 'passed' as const,
  };
  const executionReadback = aflTradeArtifactReadbackReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('artifact-readback', readbackContent),
    content: readbackContent,
  });

  const readbackBytes = new TextEncoder().encode(canonicalizeAflTradeJson(executionReadback));
  const readbackReceiptArtifact = createAflTradeCanonicalJsonArtifactRef(
    executionReadback,
    executionVerifiedAt
  );
  if (readbackReceiptArtifact.byteLength > input.maximumBytes) {
    throw new TypeError('The model readback receipt exceeds the configured custody byte bound.');
  }
  await input.repository.putIfAbsent(readbackReceiptArtifact, readbackBytes);
  await requireExactStoredBytes(
    input.repository,
    readbackReceiptArtifact,
    readbackBytes,
    input.maximumBytes
  );
  const retainedAt = await input.clock.now();

  const content = custodyContentSchema.parse({
    schemaVersion: AFL_TRADE_PICK_PAV_MODEL_CUSTODY_SCHEMA_VERSION,
    authorityBoundary:
      'private_verified_model_execution_custody_not_gate_3_approval_grade_or_publication',
    publicationEligible: false,
    executionId: execution.executionId,
    environment: execution.content.environment,
    repositoryAssurance: input.repository.assurance,
    artifactClass: input.repository.artifactClass,
    custodyProfileId: input.repository.custodyProfile?.profileId ?? null,
    executionArtifact,
    executionReadback,
    readbackReceiptArtifact,
    readbackReceiptArtifactVerified: true,
    retainedAt,
    status: 'retained_verified',
  });
  return aflTradePickPavModelCustodyReceiptSchema.parse({
    custodyReceiptId: createAflTradeContentAddress('pick-pav-model-custody', content),
    content,
  });
}
