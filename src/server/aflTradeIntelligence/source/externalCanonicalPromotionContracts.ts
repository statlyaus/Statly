import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  parseAflTradeExternalReconciliationCandidate,
  type AflTradeExternalReconciliationCandidateRecord,
} from './externalReconciliationCandidateContracts';

export const AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION =
  'afl-trade-external-canonical-promotion-proposal/v1' as const;
export const AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_REQUEST_SCHEMA_VERSION =
  'afl-trade-external-canonical-promotion-request/v1' as const;

const instantSchema = z.iso.datetime({ offset: true });
const environmentSchema = z.enum(['test_fixture', 'non_production', 'production']);
const candidateIdSchema = aflTradeContentAddressedIdSchema('external-reconciliation');
const proposalIdSchema = aflTradeContentAddressedIdSchema('external-canonical-promotion-proposal');
const promotionIdSchema = aflTradeContentAddressedIdSchema('external-canonical-promotion');
const reviewDecisionIdSchema = aflTradeContentAddressedIdSchema('review-decision');
const reviewerAuthorityEvidenceIdSchema = aflTradeContentAddressedIdSchema(
  'reviewer-authority-evidence'
);
const selectionIdSchema = aflTradeContentAddressedIdSchema('external-draft-selection');
const transactionIdSchema = aflTradeContentAddressedIdSchema('external-transaction');

const draftEventMetadataSchema = z
  .object({
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.string().trim().min(1).max(80),
    eventDate: z.iso.date(),
    officialName: z.string().trim().min(1).max(1_000),
  })
  .strict();

const sortedUniqueSelectionIdsSchema = z
  .array(selectionIdSchema)
  .max(500)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'Selection IDs must be unique.' });
    }
    if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
      context.addIssue({ code: 'custom', message: 'Selection IDs must be canonically sorted.' });
    }
  });

const draftEventCoverageSchema = z
  .object({
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.string().trim().min(1).max(80),
    eventDate: z.iso.date(),
    officialName: z.string().trim().min(1).max(1_000),
    expectedSelectionCount: z.number().int().nonnegative().max(500),
    selectionIds: sortedUniqueSelectionIdsSchema,
    status: z.literal('complete'),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (coverage.expectedSelectionCount !== coverage.selectionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['expectedSelectionCount'],
        message: 'Draft-event coverage count must equal its exact selection membership.',
      });
    }
  });

const reviewedTransactionDateSchema = z
  .object({
    transactionId: transactionIdSchema,
    occurredOn: z.iso.date(),
  })
  .strict();

const transactionDateCoverageSchema = reviewedTransactionDateSchema
  .extend({
    seasonYear: z.number().int().min(1897).max(2200),
  })
  .strict();

const proposalContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION),
    candidateId: candidateIdSchema,
    candidateSha256: aflTradeSha256Schema,
    environment: environmentSchema,
    competition: z.string().trim().min(1).max(40),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    draftEventCoverage: z.array(draftEventCoverageSchema).max(100),
    transactionDateCoverage: z.array(transactionDateCoverageSchema).max(10_000),
    proposedAt: instantSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.candidateId !== `external-reconciliation:${proposal.candidateSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['candidateSha256'],
        message: 'Candidate digest must equal the candidate content address.',
      });
    }
    const keys = proposal.draftEventCoverage.map(
      ({ draftYear, draftType }) => `${draftYear}|${draftType}`
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: 'custom',
        path: ['draftEventCoverage'],
        message: 'Each draft event may have exactly one coverage commitment.',
      });
    }
    if (keys.some((key, index) => index > 0 && keys[index - 1] > key)) {
      context.addIssue({
        code: 'custom',
        path: ['draftEventCoverage'],
        message: 'Draft-event coverage must be canonically sorted.',
      });
    }
    const transactionIds = proposal.transactionDateCoverage.map(
      ({ transactionId }) => transactionId
    );
    if (new Set(transactionIds).size !== transactionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['transactionDateCoverage'],
        message: 'Each transaction may have exactly one reviewed occurrence date.',
      });
    }
    if (
      transactionIds.some(
        (transactionId, index) => index > 0 && transactionIds[index - 1] > transactionId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transactionDateCoverage'],
        message: 'Transaction-date coverage must be canonically sorted.',
      });
    }
    const proposedOn = new Date(proposal.proposedAt).toLocaleDateString('en-CA', {
      timeZone: 'Australia/Melbourne',
    });
    proposal.transactionDateCoverage.forEach(({ occurredOn, seasonYear }, index) => {
      if (Number(occurredOn.slice(0, 4)) !== seasonYear) {
        context.addIssue({
          code: 'custom',
          path: ['transactionDateCoverage', index, 'occurredOn'],
          message: 'Transaction occurrence date must fall within its exact transaction season.',
        });
      }
      if (occurredOn > proposedOn) {
        context.addIssue({
          code: 'custom',
          path: ['transactionDateCoverage', index, 'occurredOn'],
          message: 'Transaction occurrence date cannot postdate the promotion proposal.',
        });
      }
    });
  });

export const aflTradeExternalCanonicalPromotionProposalSchema = z
  .object({
    proposalId: proposalIdSchema,
    content: proposalContentSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    addAflTradeContentAddressIssue(
      'external-canonical-promotion-proposal',
      proposal.proposalId,
      proposal.content,
      context,
      ['proposalId']
    );
  });

export type AflTradeExternalCanonicalPromotionProposal = z.infer<
  typeof aflTradeExternalCanonicalPromotionProposalSchema
>;

export const aflTradeExternalCanonicalPromotionApprovalEvidenceSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-external-canonical-promotion-approval/v1'),
    proposalId: proposalIdSchema,
    proposalSha256: aflTradeSha256Schema,
    proposal: aflTradeExternalCanonicalPromotionProposalSchema,
    authorityEvidenceId: reviewerAuthorityEvidenceIdSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.proposalId !== evidence.proposal.proposalId ||
      evidence.proposalId !== `external-canonical-promotion-proposal:${evidence.proposalSha256}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['proposalId'],
        message: 'Approval evidence must pin the exact promotion proposal.',
      });
    }
  });

export type AflTradeExternalCanonicalPromotionApprovalEvidence = z.infer<
  typeof aflTradeExternalCanonicalPromotionApprovalEvidenceSchema
>;

const requestContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_REQUEST_SCHEMA_VERSION),
    candidateId: candidateIdSchema,
    proposalId: proposalIdSchema,
    approvalDecisionId: reviewDecisionIdSchema,
  })
  .strict();

export const aflTradeExternalCanonicalPromotionRequestSchema = z
  .object({
    promotionId: promotionIdSchema,
    content: requestContentSchema,
  })
  .strict()
  .superRefine((request, context) => {
    addAflTradeContentAddressIssue(
      'external-canonical-promotion',
      request.promotionId,
      request.content,
      context,
      ['promotionId']
    );
  });

export type AflTradeExternalCanonicalPromotionRequest = z.infer<
  typeof aflTradeExternalCanonicalPromotionRequestSchema
>;

export interface AuthenticatedAflTradeExternalCanonicalPromotion {
  readonly candidateId: string;
  readonly proposalId: string;
  readonly transactionCount: number;
  readonly transferCount: number;
  readonly draftSelectionCount: number;
  readonly pickCustodyCount: number;
  readonly pickRealizationCount: number;
}

function usable(status: string): boolean {
  return status === 'single_source' || status === 'corroborated';
}

function coverageKey(draftYear: number, draftType: string): string {
  return `${draftYear}|${draftType}`;
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createAflTradeExternalCanonicalPromotionProposal(
  content: z.input<typeof proposalContentSchema>
): AflTradeExternalCanonicalPromotionProposal {
  const parsed = proposalContentSchema.parse(content);
  return aflTradeExternalCanonicalPromotionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('external-canonical-promotion-proposal', parsed),
    content: parsed,
  });
}

export function deriveAflTradeExternalCanonicalPromotionProposal(input: {
  candidate: unknown;
  proposedAt: string;
  draftEvents: readonly z.input<typeof draftEventMetadataSchema>[];
  transactionDates?: readonly z.input<typeof reviewedTransactionDateSchema>[];
}): AflTradeExternalCanonicalPromotionProposal {
  const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
  const proposedAt = instantSchema.parse(input.proposedAt);
  const draftEvents = z.array(draftEventMetadataSchema).max(100).parse(input.draftEvents);
  const eventByKey = new Map<string, z.infer<typeof draftEventMetadataSchema>>();
  for (const event of draftEvents) {
    const key = coverageKey(event.draftYear, event.draftType);
    if (eventByKey.has(key)) {
      throw new TypeError('Draft-event metadata keys must be unique.');
    }
    eventByKey.set(key, event);
  }

  const selectionIdsByKey = new Map<string, string[]>();
  for (const selection of candidate.content.draftSelections) {
    const key = coverageKey(selection.draftYear, selection.draftType);
    const selectionIds = selectionIdsByKey.get(key) ?? [];
    selectionIds.push(selection.selectionId);
    selectionIdsByKey.set(key, selectionIds);
  }
  selectionIdsByKey.forEach((selectionIds) => selectionIds.sort());
  const expectedKeys = [...selectionIdsByKey.keys()].sort();
  const suppliedKeys = [...eventByKey.keys()].sort();
  if (!exactStringSet(expectedKeys, suppliedKeys)) {
    throw new TypeError(
      'Draft-event metadata must exactly match the candidate draft-event selection set.'
    );
  }

  const suppliedTransactionDates = z
    .array(reviewedTransactionDateSchema)
    .max(10_000)
    .parse(input.transactionDates ?? []);
  const suppliedDateByTransaction = new Map(
    suppliedTransactionDates.map((value) => [value.transactionId, value.occurredOn])
  );
  if (suppliedDateByTransaction.size !== suppliedTransactionDates.length) {
    throw new TypeError('Reviewed transaction-date keys must be unique.');
  }
  const transactionDateCoverage = candidate.content.transactions
    .map((transaction) => {
      const supplied = suppliedDateByTransaction.get(transaction.transactionId);
      if (transaction.occurredOn !== null && supplied && supplied !== transaction.occurredOn) {
        throw new TypeError('Reviewed transaction date conflicts with exact source evidence.');
      }
      const occurredOn = transaction.occurredOn ?? supplied;
      if (!occurredOn) {
        throw new TypeError('Every promoted transaction requires one reviewed transaction date.');
      }
      return {
        transactionId: transaction.transactionId,
        seasonYear: transaction.seasonYear,
        occurredOn,
      };
    })
    .sort((left, right) => left.transactionId.localeCompare(right.transactionId));
  if (
    suppliedDateByTransaction.size > 0 &&
    !exactStringSet(
      transactionDateCoverage.map(({ transactionId }) => transactionId),
      [...suppliedDateByTransaction.keys()].sort()
    )
  ) {
    throw new TypeError('Reviewed transaction dates must exactly cover candidate transactions.');
  }

  const proposal = createAflTradeExternalCanonicalPromotionProposal({
    schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    candidateSha256: candidate.candidateId.split(':')[1] ?? '',
    environment: candidate.content.environment,
    competition: candidate.content.competition,
    anchorSeasonYear: candidate.content.anchorSeasonYear,
    draftEventCoverage: expectedKeys.map((key) => {
      const event = eventByKey.get(key);
      const selectionIds = selectionIdsByKey.get(key);
      if (!event || !selectionIds) throw new TypeError('Draft-event coverage derivation failed.');
      return {
        ...event,
        expectedSelectionCount: selectionIds.length,
        selectionIds,
        status: 'complete' as const,
      };
    }),
    transactionDateCoverage,
    proposedAt,
    publicationEligible: false,
  });
  authenticateAflTradeExternalCanonicalPromotionProposal({ candidate, proposal });
  return proposal;
}

export function parseAflTradeExternalCanonicalPromotionProposal(
  input: unknown
): AflTradeExternalCanonicalPromotionProposal {
  return aflTradeExternalCanonicalPromotionProposalSchema.parse(input);
}

export function createAflTradeExternalCanonicalPromotionRequest(
  content: Omit<z.input<typeof requestContentSchema>, 'schemaVersion'>
): AflTradeExternalCanonicalPromotionRequest {
  const parsed = requestContentSchema.parse({
    schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_REQUEST_SCHEMA_VERSION,
    ...content,
  });
  return aflTradeExternalCanonicalPromotionRequestSchema.parse({
    promotionId: createAflTradeContentAddress('external-canonical-promotion', parsed),
    content: parsed,
  });
}

export function parseAflTradeExternalCanonicalPromotionRequest(
  input: unknown
): AflTradeExternalCanonicalPromotionRequest {
  return aflTradeExternalCanonicalPromotionRequestSchema.parse(input);
}

export function authenticateAflTradeExternalCanonicalPromotionProposal(input: {
  candidate: unknown;
  proposal: unknown;
}): AuthenticatedAflTradeExternalCanonicalPromotion {
  const candidate: AflTradeExternalReconciliationCandidateRecord =
    parseAflTradeExternalReconciliationCandidate(input.candidate);
  const proposal = parseAflTradeExternalCanonicalPromotionProposal(input.proposal);
  const content = candidate.content;

  if (
    proposal.content.candidateId !== candidate.candidateId ||
    proposal.content.candidateSha256 !== candidate.candidateId.split(':')[1] ||
    proposal.content.environment !== content.environment ||
    proposal.content.competition !== content.competition ||
    proposal.content.anchorSeasonYear !== content.anchorSeasonYear
  ) {
    throw new TypeError('Promotion proposal does not match the exact candidate scope.');
  }
  if (Date.parse(proposal.content.proposedAt) < Date.parse(content.reconciledAt)) {
    throw new TypeError('Promotion proposal cannot predate candidate reconciliation.');
  }
  if (content.issues.length !== 0) {
    throw new TypeError('A candidate with a blocking issue cannot be promoted.');
  }
  const records = [
    ...content.transactions,
    ...content.transfers,
    ...content.draftSelections,
    ...content.pickCustody,
    ...content.pickLineage,
  ];
  if (records.some(({ status }) => !usable(status))) {
    throw new TypeError('Every promoted factual record must have a usable reconciliation status.');
  }
  if (
    content.transactions.some(
      ({ parties, transferIds, title, transactionType }) =>
        title === null ||
        transactionType === 'other' ||
        parties.length < 2 ||
        transferIds.length === 0
    ) ||
    content.transfers.some(
      ({ fromClubId, toClubId, asset }) =>
        fromClubId === null ||
        toClubId === null ||
        (asset.kind === 'player' && asset.playerId === null)
    ) ||
    content.draftSelections.some(({ playerId, clubId }) => playerId === null || clubId === null) ||
    content.pickCustody.some(
      ({ originalClubId, currentClubId }) => originalClubId === null || currentClubId === null
    )
  ) {
    throw new TypeError('Promoted facts require complete reviewed canonical identities and dates.');
  }

  const expectedCoverage = new Map(
    proposal.content.draftEventCoverage.map((coverage) => [
      coverageKey(coverage.draftYear, coverage.draftType),
      coverage.selectionIds,
    ])
  );
  const transactionDateById = new Map(
    proposal.content.transactionDateCoverage.map(({ transactionId, seasonYear, occurredOn }) => [
      transactionId,
      { seasonYear, occurredOn },
    ])
  );
  if (
    transactionDateById.size !== content.transactions.length ||
    content.transactions.some(({ transactionId, seasonYear, occurredOn }) => {
      const coverage = transactionDateById.get(transactionId);
      return (
        coverage === undefined ||
        coverage.seasonYear !== seasonYear ||
        (occurredOn !== null && coverage.occurredOn !== occurredOn)
      );
    })
  ) {
    throw new TypeError('Promotion proposal transaction dates must exactly cover the candidate.');
  }
  const actualCoverage = new Map<string, string[]>();
  content.draftSelections.forEach((selection) => {
    const key = coverageKey(selection.draftYear, selection.draftType);
    const values = actualCoverage.get(key) ?? [];
    values.push(selection.selectionId);
    actualCoverage.set(key, values);
  });
  actualCoverage.forEach((selectionIds) => selectionIds.sort());
  if (
    expectedCoverage.size !== actualCoverage.size ||
    [...actualCoverage].some(
      ([key, selectionIds]) =>
        !expectedCoverage.has(key) || !exactStringSet(expectedCoverage.get(key) ?? [], selectionIds)
    )
  ) {
    throw new TypeError(
      'Draft-event coverage must equal the exact candidate selection set for every promoted draft.'
    );
  }

  return {
    candidateId: candidate.candidateId,
    proposalId: proposal.proposalId,
    transactionCount: content.transactions.length,
    transferCount: content.transfers.length,
    draftSelectionCount: content.draftSelections.length,
    pickCustodyCount: content.pickCustody.length,
    pickRealizationCount: content.pickLineage.length,
  };
}
