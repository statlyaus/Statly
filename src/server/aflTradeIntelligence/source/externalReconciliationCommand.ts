import { resolveSpecialEntitlementCustody } from './resolveSpecialEntitlementCustody';
import { z } from 'zod';

import { reviewSpecialEntitlementReconciliation } from './specialEntitlementReconciliationReview';

import { reconcileAflTradeExternalEvidence } from './externalEvidenceReconciliation';
import type {
  PersistAflTradeExternalReconciliationInput,
  PersistedAflTradeExternalReconciliation,
} from './postgresExternalReconciliationRepository';

const commandSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.string().trim().min(1).max(40),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    reconciledAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid reconciliation instant.'),
    sourceBatches: z.array(z.unknown()).min(1).max(100_000),
    identityResolutions: z.array(z.unknown()).max(100_000),
    specialEntitlementLinks: z.array(z.unknown()).max(10_000).optional(),
    specialEntitlementAwardBindings: z.array(z.unknown()).min(1).max(10_000).optional(),
  })
  .strict();

export interface AflTradeExternalReconciliationCommandRepository {
  persistCandidate(
    input: PersistAflTradeExternalReconciliationInput
  ): Promise<PersistedAflTradeExternalReconciliation>;
}

export interface BuildAflTradeExternalReconciliationDependencies {
  repository: AflTradeExternalReconciliationCommandRepository;
}

export interface BuildAflTradeExternalReconciliationResult extends PersistedAflTradeExternalReconciliation {
  publicationEligible: false;
  sourceCandidateId?: string;
  specialEntitlementReview?: ReturnType<typeof reviewSpecialEntitlementReconciliation>;
}

/**
 * Builds one immutable reconciliation candidate from reviewed evidence and persists it atomically.
 * This command intentionally stops before factual promotion or publication: blocking identity,
 * selection, custody, and lineage issues remain visible in the finalized private candidate.
 */
export async function buildAndPersistAflTradeExternalReconciliation(
  unparsedInput: unknown,
  dependencies: BuildAflTradeExternalReconciliationDependencies
): Promise<BuildAflTradeExternalReconciliationResult> {
  const input = commandSchema.parse(unparsedInput);
  const candidate = reconcileAflTradeExternalEvidence(input);
  const specialEntitlementReview =
    input.specialEntitlementLinks === undefined
      ? undefined
      : reviewSpecialEntitlementReconciliation({
          candidate,
          sourceBatches: input.sourceBatches,
          links: input.specialEntitlementLinks,
        });
  const resolved =
    input.specialEntitlementAwardBindings === undefined
      ? undefined
      : resolveSpecialEntitlementCustody({
          candidate,
          bindings: input.specialEntitlementAwardBindings,
          reconciledAt: input.reconciledAt,
        });
  const persisted = await dependencies.repository.persistCandidate({
    candidate,
    identityResolutions: input.identityResolutions,
  });
  if (persisted.candidateId !== candidate.candidateId) {
    throw new TypeError('Persisted reconciliation identity does not match the built candidate.');
  }
  const resolvedResult = resolved
    ? await dependencies.repository.persistCandidate({
        candidate: resolved,
        identityResolutions: input.identityResolutions,
      })
    : undefined;
  if (resolvedResult && resolvedResult.candidateId !== resolved?.candidateId) {
    throw new TypeError('Persisted resolved custody identity differs from the reviewed bindings.');
  }
  return {
    ...(resolvedResult ?? persisted),
    ...(resolved ? { sourceCandidateId: candidate.candidateId } : {}),
    publicationEligible: false,
    ...(specialEntitlementReview === undefined ? {} : { specialEntitlementReview }),
  };
}
