import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '../valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';
import type { createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture } from '../valuation/postgresCurrentValuationCohortPreparation';
import { PostgresAflTradePrivateValuationTradeEvidence } from '../valuation/postgresPrivateValuationTradeEvidence';
import { createPostgresAflTradeRetainedValuationInputBundleConstructor } from '../valuation/retainedValuationInputBundleConstruction';

type ConstructionEvidenceLoader = Parameters<
  typeof createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture
>[0]['loadConstructionEvidence'];

const dispatchSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    scopeKey: z.literal('afl-men:2025-trades'),
    claim: z
      .object({
        claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
        leaseToken: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
  })
  .strict();

/** Compose retained, claim-authenticated parents; derive no forecasts or scientific authority. */
export function createLocalAflTradePrivateValuationConstructionEvidence(options: {
  readonly dispatch: z.input<typeof dispatchSchema>;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly specificationArtifact: AflTradeArtifactRef;
}): ConstructionEvidenceLoader {
  const dispatch = dispatchSchema.parse(options.dispatch);
  const specificationArtifact = aflTradeArtifactRefSchema.parse(options.specificationArtifact);
  return async (input) => {
    if (
      input.requestId !== dispatch.requestId ||
      input.modelEvidence.scopeKey !== dispatch.scopeKey
    ) {
      throw new TypeError('Construction evidence does not match its configured dispatch.');
    }
    const client: AflOutcomeSqlClient = {
      query: input.transaction.query.bind(input.transaction),
      transaction: async (work) => work(input.transaction),
    };
    const evidence = await new PostgresAflTradePrivateValuationTradeEvidence(client).load({
      requestId: input.requestId,
      claim: dispatch.claim,
    });
    const binding = evidence.binding;
    if ('schemaVersion' in binding) {
      throw new TypeError(
        'Historical cohort binding requires the dedicated postseason construction adapter.'
      );
    }
    const factual = input.modelEvidence.privateFactualAuthority;
    if (
      binding.factualOutputId !== input.factualOutputId ||
      binding.cohortReleaseId !== input.factualReleaseId ||
      binding.cohortScopeKey !== dispatch.scopeKey ||
      binding.privateFactualCandidateId !== factual.candidateId ||
      binding.privateFactualRevision !== factual.revision ||
      binding.factualOperationId !== input.modelEvidence.factualOperationId ||
      factual.valuationScopeKey !== dispatch.scopeKey
    ) {
      throw new TypeError('Construction evidence differs from its exact factual ancestry.');
    }
    const constructBundle = createPostgresAflTradeRetainedValuationInputBundleConstructor({
      client,
      artifactRepository: options.artifactRepository,
      maximumArtifactBytes: options.maximumArtifactBytes,
    });
    const bundle = await constructBundle({
      modelEvidenceOperationId: input.modelEvidence.operationId,
      scopeKey: dispatch.scopeKey,
      specificationArtifact,
    });
    const release = evidence.releaseManifest;
    const factualReleaseArtifact = createAflTradeCanonicalJsonArtifactRef(
      release,
      release.content.createdAt
    );
    const releaseMembershipArtifact = createAflTradeCanonicalJsonArtifactRef(
      release.content.canonicalMembers,
      release.content.createdAt
    );
    const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
      client,
      artifactRepository: options.artifactRepository,
      maximumArtifactBytes: options.maximumArtifactBytes,
    });
    for (const [reference, value] of [
      [factualReleaseArtifact, release],
      [releaseMembershipArtifact, release.content.canonicalMembers],
      [bundle.valuationInputBundleArtifact, bundle.valuationInputBundle],
    ] as const) {
      await staging.retainArtifact({
        reference,
        bytes: new TextEncoder().encode(canonicalizeAflTradeJson(value)),
      });
    }
    return {
      factualReleaseArtifact,
      releaseMembershipArtifact,
      releaseTradeIds: evidence.binding.cohortTradeIds,
      valuationInputBundleId: bundle.valuationInputBundleId,
      valuationInputBundleArtifact: bundle.valuationInputBundleArtifact,
      valuationInputBundle: bundle.valuationInputBundle,
    };
  };
}
