import { z } from 'zod';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import { bindReviewedPickLineage, reviewedPickLineageSchema } from './reviewedPickLineage';

const prefix = 'reviewed-pick-lineage-registration';
const contentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-reviewed-pick-lineage-registration/v1'),
    candidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    records: z.array(reviewedPickLineageSchema).min(1).max(10_000),
    proposedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((content, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message });
    content.records.forEach((record, index) => {
      if (record.candidateId !== content.candidateId)
        fail('Every registration record must bind the same candidate.');
      if (index > 0 && content.records[index - 1].transferId >= record.transferId)
        fail('Registration transfers must be unique and canonically sorted.');
      if (record.endpoint.kind === 'selected' || record.endpoint.kind === 'rookie_elevation') {
        const endpoint = record.endpoint;
        if (
          endpoint.playerId === null ||
          endpoint.exercisingClubId === null ||
          endpoint.draftYear === null ||
          endpoint.draftType === null ||
          endpoint.livePick === null
        )
          fail('Player endpoints require complete identity and draft coordinates.');
      }
    });
  });

export const reviewedPickLineageRegistrationSchema = z
  .object({
    registrationId: aflTradeContentAddressedIdSchema(prefix),
    content: contentSchema,
  })
  .strict()
  .superRefine((registration, context) => {
    addAflTradeContentAddressIssue(
      prefix,
      registration.registrationId,
      registration.content,
      context,
      ['registrationId']
    );
  });

/** Immutable approval subject only. Current authority and source custody require database checks. */
export function createReviewedPickLineageRegistration(input: {
  candidate: unknown;
  records: readonly unknown[];
  proposedAt: string;
}) {
  const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
  const bound = bindReviewedPickLineage(candidate, input.records);
  const content = contentSchema.parse({
    schemaVersion: 'afl-trade-reviewed-pick-lineage-registration/v1',
    candidateId: candidate.candidateId,
    environment: candidate.content.environment,
    records: [...bound.records].sort((a, b) =>
      a.transferId < b.transferId ? -1 : a.transferId > b.transferId ? 1 : 0
    ),
    proposedAt: input.proposedAt,
    publicationEligible: false,
  });
  return reviewedPickLineageRegistrationSchema.parse({
    registrationId: createAflTradeContentAddress(prefix, content),
    content,
  });
}

/** A retained approval must bind this exact payload; this helper does not issue an approval. */
export function reviewedPickLineageApprovalEvidence(input: unknown) {
  const registration = reviewedPickLineageRegistrationSchema.parse(input);
  return {
    schemaVersion: 'afl-trade-reviewed-pick-lineage-approval/v1' as const,
    registrationId: registration.registrationId,
    candidateId: registration.content.candidateId,
    environment: registration.content.environment,
    publicationEligible: false as const,
  };
}
