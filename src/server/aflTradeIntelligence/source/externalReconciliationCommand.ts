import { z } from 'zod';

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
  const persisted = await dependencies.repository.persistCandidate({
    candidate,
    identityResolutions: input.identityResolutions,
  });
  if (persisted.candidateId !== candidate.candidateId) {
    throw new TypeError('Persisted reconciliation identity does not match the built candidate.');
  }
  return { ...persisted, publicationEligible: false };
}
