import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import {
  parseAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from './externalEvidenceReconciliation';
import { buildAflTradeExternalIdentityReviewPackage } from './externalIdentityReviewWorkBuilder';
import { parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import type { AflTradeHistoricalCompletionReconciliationAuthority } from './externalReconciliationSourceAuthorityContracts';
import type {
  PersistAflTradeExternalReconciliationInput,
  PersistedAflTradeExternalReconciliation,
} from './postgresExternalReconciliationRepository';

const inputSchema = z
  .object({
    completionId: aflTradeContentAddressedIdSchema('external-historical-capture-completion'),
  })
  .strict();

export interface AflTradeHistoricalReconciliationSource {
  load(completionId: string): Promise<{
    environment: 'test_fixture' | 'non_production' | 'production';
    competition: string;
    anchorSeasonYear: number;
    sourceAuthority: AflTradeHistoricalCompletionReconciliationAuthority;
    sourceBatches: readonly unknown[];
  }>;
}

export interface AflTradeHistoricalReconciliationCandidateRepository {
  persistCandidate(
    input: PersistAflTradeExternalReconciliationInput
  ): Promise<PersistedAflTradeExternalReconciliation>;
}

export interface AflTradeHistoricalIdentityReviewRepository {
  loadCurrentResolutions(reviewPackage: unknown): Promise<readonly unknown[]>;
}

export interface PrepareAflTradeHistoricalReconciliationDependencies {
  source: AflTradeHistoricalReconciliationSource;
  identityReviewRepository: AflTradeHistoricalIdentityReviewRepository;
  candidateRepository: AflTradeHistoricalReconciliationCandidateRepository;
}

export interface PreparedAflTradeHistoricalReconciliation extends PersistedAflTradeExternalReconciliation {
  completionId: string;
  requiresReview: boolean;
  promotionEligible: false;
  publicationEligible: false;
}

export async function prepareAflTradeHistoricalReconciliation(
  unparsedInput: unknown,
  dependencies: PrepareAflTradeHistoricalReconciliationDependencies
): Promise<PreparedAflTradeHistoricalReconciliation> {
  const input = inputSchema.parse(unparsedInput);
  const source = await dependencies.source.load(input.completionId);
  if (source.sourceAuthority.completionId !== input.completionId) {
    throw new TypeError('Loaded historical source does not match the requested completion.');
  }
  const reviewPackage = buildAflTradeExternalIdentityReviewPackage({
    environment: source.environment,
    competition: source.competition,
    sourceAuthority: source.sourceAuthority,
    sourceBatches: source.sourceBatches,
  });
  const identityResolutions = (
    await dependencies.identityReviewRepository.loadCurrentResolutions(reviewPackage)
  )
    .map(parseAflTradeExternalIdentityResolution)
    .sort((left, right) => left.resolutionId.localeCompare(right.resolutionId));
  const reconciledAt = identityResolutions.reduce(
    (latest, resolution) =>
      Date.parse(resolution.content.decidedAt) > Date.parse(latest)
        ? resolution.content.decidedAt
        : latest,
    source.sourceAuthority.completedAt
  );
  const candidate = parseAflTradeExternalReconciliationCandidate(
    reconcileAflTradeExternalEvidence({
      environment: source.environment,
      competition: source.competition,
      anchorSeasonYear: source.anchorSeasonYear,
      sourceBatches: source.sourceBatches,
      identityResolutions,
      sourceAuthority: source.sourceAuthority,
      reconciledAt,
    })
  );
  const persisted = await dependencies.candidateRepository.persistCandidate({
    candidate,
    identityResolutions,
  });
  if (persisted.candidateId !== candidate.candidateId) {
    throw new TypeError('Persisted reconciliation does not match the prepared candidate.');
  }
  return {
    ...persisted,
    completionId: input.completionId,
    requiresReview: candidate.content.issues.length > 0,
    promotionEligible: false,
    publicationEligible: false,
  };
}
