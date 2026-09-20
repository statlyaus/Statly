import { z } from 'zod';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflTradeRetainedSourceUseSuccessor } from './retainedSourceUseSuccessor';

const addressed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`, 'u'));
const methodOperation = z.enum([
  'model_training',
  'derived_feature_creation',
  'public_derived_output',
  'public_fact_display',
  'live_product_activation',
  'other_documented_methods',
]);
const methodUseInputSchema = z
  .object({
    methodArtifactId: addressed('artifact'),
    methodName: z.string().trim().min(1).max(200),
    operation: methodOperation,
    captureUses: z
      .array(
        z
          .object({
            captureId: addressed('source-capture'),
            rightsArtifactId: addressed('source-rights'),
            sourceFields: z.array(z.string().trim().min(1).max(200)).min(1).max(1_000),
          })
          .strict()
      )
      .min(1)
      .max(1_000),
    provenance: z.string().trim().min(1).max(2_000),
    coverageGaps: z.string().trim().min(1).max(2_000),
    uncertainty: z.string().trim().min(1).max(2_000),
  })
  .strict();

/**
 * Binds one documented method and one operation to only the captures and fields it consumes.
 * The owner-wide successor envelope cannot be used as a substitute for this child record.
 * Durable method-document custody and downstream admission are separate requirements.
 */
export function createAflTradeRetainedMethodSourceUse(
  successor: AflTradeRetainedSourceUseSuccessor,
  rawInput: unknown
) {
  const input = methodUseInputSchema.parse(rawInput);
  if (
    successor.content.state !== 'candidate_requires_durable_authentication' ||
    successor.successorId !==
      createAflTradeContentAddress('retained-source-use-successor', successor.content) ||
    !successor.content.approvedUses.includes(input.operation)
  ) {
    throw new TypeError('Method use requires an exact owner-approved successor operation.');
  }
  const captures = new Map(
    successor.content.captureBindings.map((capture) => [capture.captureId, capture])
  );
  const rights = new Map(
    successor.content.originalRights.map((proposal) => [proposal.rightsArtifactId, proposal])
  );
  const captureUses = input.captureUses
    .map((use) => ({ ...use, sourceFields: [...use.sourceFields].sort() }))
    .sort((a, b) => a.captureId.localeCompare(b.captureId));
  if (new Set(captureUses.map(({ captureId }) => captureId)).size !== captureUses.length) {
    throw new TypeError('A method cannot repeat a retained source capture.');
  }
  for (const use of captureUses) {
    const capture = captures.get(use.captureId);
    const proposal = rights.get(use.rightsArtifactId);
    const retainedFields = new Set(proposal?.fields.map(({ sourceField }) => sourceField));
    if (
      capture?.rightsArtifactId !== use.rightsArtifactId ||
      proposal === undefined ||
      new Set(use.sourceFields).size !== use.sourceFields.length ||
      use.sourceFields.some((field) => !retainedFields.has(field))
    ) {
      throw new TypeError('Method use exceeds its exact retained capture or field scope.');
    }
  }
  const content = {
    schemaVersion: 'afl-trade-retained-method-source-use/v1' as const,
    successorId: successor.successorId,
    factualReleaseId: successor.content.factualReleaseId,
    methodArtifactId: input.methodArtifactId,
    methodName: input.methodName,
    operation: input.operation,
    captureUses,
    provenance: input.provenance,
    coverageGaps: input.coverageGaps,
    uncertainty: input.uncertainty,
    rawFieldRedistributionPermitted: false as const,
    state: 'candidate_requires_method_and_source_admission' as const,
  };
  return {
    methodUseId: createAflTradeContentAddress('retained-source-method-use', content),
    content,
  };
}

export type AflTradeRetainedMethodSourceUse = ReturnType<
  typeof createAflTradeRetainedMethodSourceUse
>;

/** Fails closed if a downstream caller substitutes a method, operation or consumed field set. */
export function verifyAflTradeRetainedMethodSourceUse(
  successor: AflTradeRetainedSourceUseSuccessor,
  methodUse: AflTradeRetainedMethodSourceUse
): boolean {
  try {
    const rebuilt = createAflTradeRetainedMethodSourceUse(successor, {
      methodArtifactId: methodUse.content.methodArtifactId,
      methodName: methodUse.content.methodName,
      operation: methodUse.content.operation,
      captureUses: methodUse.content.captureUses,
      provenance: methodUse.content.provenance,
      coverageGaps: methodUse.content.coverageGaps,
      uncertainty: methodUse.content.uncertainty,
    });
    return canonicalizeAflTradeJson(rebuilt) === canonicalizeAflTradeJson(methodUse);
  } catch {
    return false;
  }
}
