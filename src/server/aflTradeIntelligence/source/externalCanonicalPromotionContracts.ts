import {
  draftSessionDateWindowSchema,
  draftSessionDatePrecisionSchema,
  draftSessionDefinitelyPrecedes,
} from './draftSessionDatePrecision';
import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import {
  parseAflTradeExternalReconciliationCandidate,
  type AflTradeExternalReconciliationCandidateRecord,
} from './externalReconciliationCandidateContracts';
import { aflTradePromotionWriteScope } from './pickLineageDeferral';

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

/**
 * A promoted session re-sync (statlyaus/Statly#853, migration 0278): the slots of one current draft
 * session root whose draftee an identity repair re-targeted, re-promoted as one later version of
 * that root. Only a deferred-lineage (v1 or v4) proposal carries it. The version it supersedes and
 * the session metadata it repeats are read from canonical state when the proposal is derived, so
 * the reviewer approves exactly which version is superseded; the promoter refuses if that version is
 * no longer current or its metadata differs. It carries only the candidate's re-synced selections.
 */
export const AFL_TRADE_PROMOTED_SESSION_RESYNC_KIND = 'promoted_session_resync' as const;

const promotedSessionResyncCoverageSchema = z
  .object({
    kind: z.literal(AFL_TRADE_PROMOTED_SESSION_RESYNC_KIND),
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.string().trim().min(1).max(80),
    supersedesVersionId: z.string().trim().min(1).max(200),
    eventDate: z.iso.date().nullable(),
    datePrecision: draftSessionDatePrecisionSchema.optional(),
    officialName: z.string().trim().min(1).max(1_000),
    expectedSelectionCount: z.number().int().positive().max(500),
    selectionIds: sortedUniqueSelectionIdsSchema,
    status: z.literal('complete'),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (coverage.expectedSelectionCount !== coverage.selectionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['expectedSelectionCount'],
        message: 'A session re-sync count must equal its exact selection membership.',
      });
    }
  });

export type AflTradePromotedSessionResyncCoverage = z.infer<
  typeof promotedSessionResyncCoverageSchema
>;

/** Whether a draft-event coverage entry is a promoted session re-sync rather than a draft write. */
export function isAflTradePromotedSessionResyncCoverage(
  coverage: object
): coverage is AflTradePromotedSessionResyncCoverage {
  return (
    'kind' in coverage &&
    (coverage as { kind?: unknown }).kind === AFL_TRADE_PROMOTED_SESSION_RESYNC_KIND
  );
}

/**
 * One re-synced candidate selection as canonical state places it: the current version of the
 * session root its one current canonical selection row sits on, with that version's metadata.
 */
export interface AflTradePromotedSessionResync {
  readonly selectionId: string;
  readonly supersedesVersionId: string;
  readonly eventDate: string | null;
  readonly datePrecision: unknown;
  readonly officialName: string;
}

/**
 * A reviewed transaction date: the source day repeated exactly, or `occurredOn: null` for a
 * transaction the source does not date. A null day may carry the season's reviewed trade-period
 * window as `datePrecision`; the window is explicit precision, never a substituted day.
 */
const reviewedTransactionDateFields = z
  .object({
    transactionId: transactionIdSchema,
    occurredOn: z.iso.date().nullable(),
    datePrecision: draftSessionDateWindowSchema.optional(),
  })
  .strict();

function requireWindowOnlyWithoutDay(
  value: { occurredOn: string | null; datePrecision?: unknown },
  context: z.RefinementCtx
) {
  if (value.datePrecision !== undefined && value.occurredOn !== null) {
    context.addIssue({
      code: 'custom',
      path: ['datePrecision'],
      message: 'A trade-period window applies only to a transaction with no source day.',
    });
  }
}

const reviewedTransactionDateSchema = reviewedTransactionDateFields.superRefine(
  requireWindowOnlyWithoutDay
);

const transactionDateCoverageFields = reviewedTransactionDateFields.safeExtend({
  seasonYear: z.number().int().min(1897).max(2200),
});
const transactionDateCoverageSchema = transactionDateCoverageFields.superRefine(
  requireWindowOnlyWithoutDay
);

const proposalBaseSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION),
    candidateId: candidateIdSchema,
    candidateSha256: aflTradeSha256Schema,
    environment: environmentSchema,
    competition: z.string().trim().min(1).max(40),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    // A deferred-lineage proposal may also re-sync promoted sessions (#853); every session-keyed
    // schema version below replaces this list with its own session coverage.
    draftEventCoverage: z
      .array(z.union([draftEventCoverageSchema, promotedSessionResyncCoverageSchema]))
      .max(100),
    transactionDateCoverage: z
      .array(
        transactionDateCoverageFields.safeExtend({
          occurredOn: z.iso.date(),
          datePrecision: z.never().optional(),
        })
      )
      .max(10_000),
    proposedAt: instantSchema,
    publicationEligible: z.literal(false),
  })
  .strict();

const draftSessionCoverageSchema = draftEventCoverageSchema.safeExtend({
  sessionOrdinal: z.number().int().min(1).max(100),
  evidenceIds: z
    .array(aflTradeContentAddressedIdSchema('external-evidence'))
    .min(1)
    .max(500)
    .refine(
      (ids) => ids.every((id, index) => index === 0 || ids[index - 1]! < id),
      'Session evidence must be unique and sorted.'
    ),
});

const combinedDraftSessionCoverageSchema = draftSessionCoverageSchema.safeExtend({
  proofKind: z.literal('combined_session_facts'),
});

const reviewedDraftSessionCoverageSchema = draftSessionCoverageSchema.safeExtend({
  proofKind: z.enum(['direct_session_claim', 'combined_session_facts']),
});

const windowDraftSessionCoverageSchema = z
  .object({
    ...reviewedDraftSessionCoverageSchema.shape,
    eventDate: z.iso.date().nullable(),
    datePrecision: draftSessionDateWindowSchema.optional(),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      coverage.expectedSelectionCount !== coverage.selectionIds.length ||
      (coverage.eventDate === null ? !coverage.datePrecision : coverage.datePrecision !== undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Window coverage must preserve exact membership and explicit date precision.',
      });
  });

const proposalFieldsSchema = z.union([
  proposalBaseSchema,
  proposalBaseSchema.extend({
    schemaVersion: z.literal('afl-trade-external-canonical-promotion-proposal/v7'),
    draftEventCoverage: z.array(windowDraftSessionCoverageSchema).max(100),
    transactionDateCoverage: z.array(transactionDateCoverageSchema).max(10_000),
  }),
  proposalBaseSchema.extend({
    schemaVersion: z.literal('afl-trade-external-canonical-promotion-proposal/v6'),
    draftEventCoverage: z.array(reviewedDraftSessionCoverageSchema).max(100),
    transactionDateCoverage: z.array(transactionDateCoverageSchema).max(10_000),
  }),
  proposalBaseSchema.extend({
    schemaVersion: z.literal('afl-trade-external-canonical-promotion-proposal/v5'),
    draftEventCoverage: z.array(reviewedDraftSessionCoverageSchema).max(100),
    transactionDateCoverage: z.array(transactionDateCoverageSchema).max(10_000),
  }),
  proposalBaseSchema.extend({
    schemaVersion: z.literal('afl-trade-external-canonical-promotion-proposal/v4'),
    transactionDateCoverage: z.array(transactionDateCoverageSchema).max(10_000),
  }),
  proposalBaseSchema.extend({
    schemaVersion: z.literal('afl-trade-external-canonical-promotion-proposal/v2'),
    draftEventCoverage: z.array(draftSessionCoverageSchema).max(100),
  }),
  proposalBaseSchema.extend({
    schemaVersion: z.literal('afl-trade-external-canonical-promotion-proposal/v3'),
    draftEventCoverage: z.array(combinedDraftSessionCoverageSchema).max(100),
  }),
]);

type ProposalContent = z.infer<typeof proposalFieldsSchema>;

function invalidDatedSession(
  session: { sessionOrdinal: number; eventDate: string; draftYear: number; selectionIds: string[] },
  prior: { ordinal: number; date: string } | undefined,
  proposal: ProposalContent,
  seenSelections: Set<string>
) {
  return (
    (proposal.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v6'
      ? session.sessionOrdinal <= (prior?.ordinal ?? 0)
      : session.sessionOrdinal !== (prior?.ordinal ?? 0) + 1) ||
    (prior && session.eventDate < prior.date) ||
    Number(session.eventDate.slice(0, 4)) !== session.draftYear ||
    session.eventDate > proposal.proposedAt.slice(0, 10) ||
    session.selectionIds.length === 0 ||
    session.selectionIds.some((id) => seenSelections.has(id))
  );
}

type WindowSession = Extract<
  ProposalContent,
  { schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v7' }
>['draftEventCoverage'][number];
function invalidWindowPrecision(
  session: WindowSession,
  prior: WindowSession | undefined,
  proposedAt: string
) {
  const precision = draftSessionDatePrecisionSchema.safeParse(
    session.eventDate === null
      ? session.datePrecision
      : { precision: 'day', eventDate: session.eventDate }
  );
  let invalid = !precision.success;
  if (precision.success) {
    const first =
      precision.data.precision === 'day' ? precision.data.eventDate : precision.data.earliestDate;
    const last =
      precision.data.precision === 'day' ? precision.data.eventDate : precision.data.latestDate;
    invalid ||= Number(first.slice(0, 4)) !== session.draftYear || last > proposedAt.slice(0, 10);
    if (prior) {
      const priorPrecision = draftSessionDatePrecisionSchema.safeParse(
        prior.eventDate === null
          ? prior.datePrecision
          : { precision: 'day', eventDate: prior.eventDate }
      );
      invalid ||=
        !priorPrecision.success ||
        !draftSessionDefinitelyPrecedes(priorPrecision.data!, precision.data);
    }
  }
  return invalid;
}

function validateDatedSessionCoverage(proposal: ProposalContent, context: z.RefinementCtx) {
  if (
    proposal.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v2' ||
    proposal.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v3' ||
    proposal.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v5' ||
    proposal.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v6'
  ) {
    const seenSelections = new Set<string>();
    const previous = new Map<string, { ordinal: number; date: string }>();
    for (const session of proposal.draftEventCoverage) {
      const key = `${session.draftYear}|${session.draftType}`;
      const prior = previous.get(key);
      if (invalidDatedSession(session, prior, proposal, seenSelections)) {
        context.addIssue({
          code: 'custom',
          path: ['draftEventCoverage'],
          message:
            'Draft sessions require chronological gap-free ordinals and disjoint dated selections.',
        });
      }
      previous.set(key, { ordinal: session.sessionOrdinal, date: session.eventDate });
      session.selectionIds.forEach((id) => seenSelections.add(id));
    }
  }
}

function validateConsistentProofKind(proposal: ProposalContent, context: z.RefinementCtx) {
  if (
    proposal.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v5' ||
    proposal.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v6'
  ) {
    const proofByDraft = new Map<string, string>();
    for (const session of proposal.draftEventCoverage) {
      const key = `${session.draftYear}|${session.draftType}`;
      const prior = proofByDraft.get(key);
      if (prior !== undefined && prior !== session.proofKind) {
        context.addIssue({
          code: 'custom',
          path: ['draftEventCoverage'],
          message: 'Each draft must use one consistent session proof kind.',
        });
      }
      proofByDraft.set(key, session.proofKind);
    }
  }
}

function validateWindowSessionCoverage(proposal: ProposalContent, context: z.RefinementCtx) {
  if (proposal.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v7') {
    const previous = new Map<string, (typeof proposal.draftEventCoverage)[number]>();
    const seen = new Set<string>();
    let hasWindow = false;
    for (const session of proposal.draftEventCoverage) {
      const key = `${session.draftYear}|${session.draftType}`;
      const prior = previous.get(key);
      let invalid = invalidWindowPrecision(session, prior, proposal.proposedAt);
      invalid ||=
        session.sessionOrdinal <= (prior?.sessionOrdinal ?? 0) ||
        (!!prior && prior.proofKind !== session.proofKind) ||
        !session.selectionIds.length ||
        session.selectionIds.some((id) => seen.has(id));
      if (invalid)
        context.addIssue({
          code: 'custom',
          message:
            'Window sessions require valid ordered date bounds, consistent proof kind and disjoint selections.',
        });
      hasWindow ||= session.datePrecision !== undefined;
      previous.set(key, session);
      session.selectionIds.forEach((id) => seen.add(id));
    }
    if (!hasWindow)
      context.addIssue({
        code: 'custom',
        message: 'Promotion v7 requires an explicit session window.',
      });
  }
}

const proposalContentSchema = proposalFieldsSchema.superRefine((proposal, context) => {
  if (proposal.candidateId !== `external-reconciliation:${proposal.candidateSha256}`) {
    context.addIssue({
      code: 'custom',
      path: ['candidateSha256'],
      message: 'Candidate digest must equal the candidate content address.',
    });
  }
  const keys = proposal.draftEventCoverage.map((coverage) =>
    isAflTradePromotedSessionResyncCoverage(coverage)
      ? `${coverage.draftYear}|${coverage.draftType}|resync|${coverage.supersedesVersionId}`
      : `${coverage.draftYear}|${coverage.draftType}${'sessionOrdinal' in coverage ? `|${String(coverage.sessionOrdinal).padStart(3, '0')}` : ''}`
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
  validateDatedSessionCoverage(proposal, context);
  validateConsistentProofKind(proposal, context);
  validateWindowSessionCoverage(proposal, context);
  const transactionIds = proposal.transactionDateCoverage.map(({ transactionId }) => transactionId);
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
  proposal.transactionDateCoverage.forEach(({ occurredOn, seasonYear, datePrecision }, index) => {
    if (occurredOn === null) {
      if (seasonYear > Number(proposedOn.slice(0, 4))) {
        context.addIssue({
          code: 'custom',
          path: ['transactionDateCoverage', index],
          message: 'Transaction occurrence year cannot postdate the promotion proposal.',
        });
      }
      if (
        datePrecision !== undefined &&
        (Number(datePrecision.earliestDate.slice(0, 4)) !== seasonYear ||
          datePrecision.latestDate > proposedOn)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['transactionDateCoverage', index, 'datePrecision'],
          message:
            'A trade-period window must lie within its transaction season and not postdate the proposal.',
        });
      }
      return;
    }
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

/** Recorded on the receipt of a promotion whose candidate deferred pick-side issues (#869). */
const requestPickLineageDeferralSchema = z
  .object({
    decisionId: reviewDecisionIdSchema,
    deferredIssueCount: z.number().int().positive(),
    /** Drafts left to their existing current promotion; present only when any. */
    promotedDraftCount: z.number().int().positive().optional(),
    /** Selections re-promoted alone under a re-targeted draftee (#853); present only when any. */
    resyncedSelectionCount: z.number().int().positive().optional(),
    /** Resolved lineages into those drafts whose realization is not written; present only when any. */
    skippedRealizationCount: z.number().int().positive().optional(),
    /** Custody observations without a usable status, left unwritten; present only when any. */
    deferredCustodyCount: z.number().int().positive().optional(),
    /** Custody observations already canonical with the candidate's facts, left unwritten (#853). */
    promotedCustodyCount: z.number().int().positive().optional(),
    /** Transactions left to their existing current promotion; present only when any, with their ids. */
    promotedTransactionCount: z.number().int().positive().optional(),
    promotedTransactionIds: z
      .array(aflTradeContentAddressedIdSchema('external-transaction'))
      .min(1)
      .max(10_000)
      .optional(),
    /**
     * Picks the promotion would have defined that already exist as canonical picks with different
     * facts and no reviewed lineage registration: referenced unchanged, no facts written. Present
     * only when any, with their ids.
     */
    retainedPickDefinitionCount: z.number().int().positive().optional(),
    retainedPickDefinitionIds: z
      .array(aflTradeContentAddressedIdSchema('draft-pick'))
      .min(1)
      .max(100_000)
      .optional(),
    /**
     * Picks the written transfers number differently, defined from their one usable custody
     * observation; each asset keeps its trade-time number. Present only when any, with their ids.
     */
    custodyDefinedPickCount: z.number().int().positive().optional(),
    custodyDefinedPickIds: z
      .array(aflTradeContentAddressedIdSchema('draft-pick'))
      .min(1)
      .max(100_000)
      .optional(),
  })
  .superRefine((deferral, context) => {
    for (const [count, ids, label] of [
      [deferral.promotedTransactionCount, deferral.promotedTransactionIds, 'Promoted transaction'],
      [
        deferral.retainedPickDefinitionCount,
        deferral.retainedPickDefinitionIds,
        'Retained pick definition',
      ],
      [deferral.custodyDefinedPickCount, deferral.custodyDefinedPickIds, 'Custody-defined pick'],
    ] as const) {
      const listed = ids ?? [];
      if (
        (count ?? 0) !== listed.length ||
        listed.some((id, index) => index > 0 && listed[index - 1]!.localeCompare(id) >= 0)
      ) {
        context.addIssue({
          code: 'custom',
          message: `${label} ids must be sorted, unique and counted exactly.`,
        });
      }
    }
  })
  .strict();

export type AflTradePromotionPickLineageDeferralReceipt = z.infer<
  typeof requestPickLineageDeferralSchema
>;

const requestContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_REQUEST_SCHEMA_VERSION),
    candidateId: candidateIdSchema,
    proposalId: proposalIdSchema,
    approvalDecisionId: reviewDecisionIdSchema,
    // Present only on a deferred-lineage promotion, so every earlier receipt keeps its content address.
    pickLineageDeferral: requestPickLineageDeferralSchema.optional(),
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
  /**
   * Selections the promotion writes: none of a draft holding a deferred selection, and only the
   * re-synced slots of a draft whose draftee an identity repair re-targeted.
   */
  readonly draftSelectionCount: number;
  /** Custody observations the promotion writes: none for a deferred pick. */
  readonly pickCustodyCount: number;
  /** `exercised_as` realizations the promotion writes: none for a deferred pick or draft. */
  readonly pickRealizationCount: number;
  /** The reviewed deferral the promotion operates under, or null for an issue-free candidate. */
  readonly pickLineageDeferral: AflTradePromotionPickLineageDeferralReceipt | null;
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

function deriveTransactionDateCoverage(
  candidate: AflTradeExternalReconciliationCandidateRecord,
  transactionDates: readonly z.input<typeof reviewedTransactionDateSchema>[] | undefined
) {
  const suppliedTransactionDates = z
    .array(reviewedTransactionDateSchema)
    .max(10_000)
    .parse(transactionDates ?? []);
  const suppliedDateByTransaction = new Map(
    suppliedTransactionDates.map((value) => [value.transactionId, value])
  );
  if (suppliedDateByTransaction.size !== suppliedTransactionDates.length) {
    throw new TypeError('Reviewed transaction-date keys must be unique.');
  }
  // A transaction left to its earlier promotion (#869) is not written, so it needs no reviewed date.
  const transactionDateCoverage = aflTradePromotionWriteScope(candidate.content)
    .transactions.map((transaction) => {
      const supplied = suppliedDateByTransaction.get(transaction.transactionId);
      if (
        transaction.occurredOn !== null &&
        supplied !== undefined &&
        (supplied.occurredOn !== transaction.occurredOn || supplied.datePrecision !== undefined)
      ) {
        throw new TypeError('Reviewed transaction date conflicts with exact source evidence.');
      }
      const occurredOn = transaction.occurredOn ?? supplied?.occurredOn;
      if (occurredOn === undefined) {
        throw new TypeError('Every promoted transaction requires one reviewed transaction date.');
      }
      return {
        transactionId: transaction.transactionId,
        seasonYear: transaction.seasonYear,
        occurredOn,
        ...(occurredOn === null && supplied?.datePrecision !== undefined
          ? { datePrecision: supplied.datePrecision }
          : {}),
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

  return transactionDateCoverage;
}

/**
 * The re-sync coverage of a deferred candidate's re-synced selections (#853): one entry per current
 * session version, carrying that version's metadata and exactly the candidate selections whose one
 * current canonical row sits on its root. `resyncs` is read from canonical state when the proposal
 * is derived; every re-synced selection needs exactly one, and none other is accepted.
 */
export function aflTradePromotedSessionResyncCoverage(
  content: AflTradeExternalReconciliationCandidateRecord['content'],
  resyncs: readonly AflTradePromotedSessionResync[]
): AflTradePromotedSessionResyncCoverage[] {
  const resynced = aflTradePromotionWriteScope(content).resyncedSelections;
  const selectionById = new Map(resynced.map((selection) => [selection.selectionId, selection]));
  const resyncById = new Map<string, AflTradePromotedSessionResync>();
  for (const resync of resyncs) {
    if (!selectionById.has(resync.selectionId) || resyncById.has(resync.selectionId)) {
      throw new TypeError(
        'Each promoted session re-sync must name one re-synced candidate selection exactly once.'
      );
    }
    resyncById.set(resync.selectionId, resync);
  }
  if (resyncById.size !== selectionById.size) {
    throw new TypeError(
      'Every re-synced candidate selection needs the current session version it sits on.'
    );
  }
  const byVersion = new Map<string, AflTradePromotedSessionResyncCoverage>();
  for (const selection of resynced) {
    const resync = resyncById.get(selection.selectionId)!;
    const datePrecision =
      resync.datePrecision === null || resync.datePrecision === undefined
        ? undefined
        : draftSessionDatePrecisionSchema.parse(resync.datePrecision);
    const entry = byVersion.get(resync.supersedesVersionId) ?? {
      kind: AFL_TRADE_PROMOTED_SESSION_RESYNC_KIND,
      draftYear: selection.draftYear,
      draftType: selection.draftType,
      supersedesVersionId: resync.supersedesVersionId,
      eventDate: resync.eventDate,
      ...(datePrecision === undefined ? {} : { datePrecision }),
      officialName: resync.officialName,
      expectedSelectionCount: 0,
      selectionIds: [],
      status: 'complete' as const,
    };
    if (
      entry.draftYear !== selection.draftYear ||
      entry.draftType !== selection.draftType ||
      entry.eventDate !== resync.eventDate ||
      entry.officialName !== resync.officialName ||
      canonicalizeAflTradeJson(entry.datePrecision ?? null) !==
        canonicalizeAflTradeJson(datePrecision ?? null)
    ) {
      throw new TypeError(
        'One session version must give its re-synced slots one draft and metadata.'
      );
    }
    entry.selectionIds = [...entry.selectionIds, selection.selectionId].sort();
    entry.expectedSelectionCount = entry.selectionIds.length;
    byVersion.set(resync.supersedesVersionId, entry);
  }
  return [...byVersion.values()]
    .map((entry) => promotedSessionResyncCoverageSchema.parse(entry))
    .sort((left, right) => draftCoverageSortKey(left).localeCompare(draftCoverageSortKey(right)));
}

function draftCoverageSortKey(coverage: { draftYear: number; draftType: string }): string {
  return isAflTradePromotedSessionResyncCoverage(coverage)
    ? `${coverage.draftYear}|${coverage.draftType}|resync|${coverage.supersedesVersionId}`
    : `${coverage.draftYear}|${coverage.draftType}`;
}

export function deriveAflTradeExternalCanonicalPromotionProposal(input: {
  candidate: unknown;
  proposedAt: string;
  draftEvents: readonly z.input<typeof draftEventMetadataSchema>[];
  transactionDates?: readonly z.input<typeof reviewedTransactionDateSchema>[];
  /**
   * Where each re-synced selection is current (#853), read from canonical state. Required exactly
   * when the candidate records re-synced selections; never supplied by a reviewer.
   */
  promotedSessionResyncs?: readonly AflTradePromotedSessionResync[];
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
  // Under a reviewed deferral (#869) a draft holding a deferred selection, or one that is already
  // current canonical, is not promoted, so the reviewer supplies metadata only for the drafts this
  // candidate writes.
  for (const selection of aflTradePromotionWriteScope(candidate.content).draftSelections) {
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

  const transactionDateCoverage = deriveTransactionDateCoverage(candidate, input.transactionDates);
  const resyncCoverage = aflTradePromotedSessionResyncCoverage(
    candidate.content,
    input.promotedSessionResyncs ?? []
  );

  const proposal = createAflTradeExternalCanonicalPromotionProposal(
    proposalContentSchema.parse({
      schemaVersion: transactionDateCoverage.some(({ occurredOn }) => occurredOn === null)
        ? 'afl-trade-external-canonical-promotion-proposal/v4'
        : AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION,
      candidateId: candidate.candidateId,
      candidateSha256: candidate.candidateId.split(':')[1] ?? '',
      environment: candidate.content.environment,
      competition: candidate.content.competition,
      anchorSeasonYear: candidate.content.anchorSeasonYear,
      draftEventCoverage: [
        ...expectedKeys.map((key) => {
          const event = eventByKey.get(key);
          const selectionIds = selectionIdsByKey.get(key);
          if (!event || !selectionIds)
            throw new TypeError('Draft-event coverage derivation failed.');
          return {
            ...event,
            expectedSelectionCount: selectionIds.length,
            selectionIds,
            status: 'complete' as const,
          };
        }),
        ...resyncCoverage,
      ].sort((left, right) =>
        draftCoverageSortKey(left).localeCompare(draftCoverageSortKey(right))
      ),
      transactionDateCoverage,
      proposedAt,
      publicationEligible: false,
    })
  );
  authenticateAflTradeExternalCanonicalPromotionProposal({ candidate, proposal });
  return proposal;
}

interface DraftSessionProposalInput {
  candidate: unknown;
  proposedAt: string;
  draftSessions: readonly {
    draftYear: number;
    draftType: string;
    sessionOrdinal: number;
    eventDate: string;
    officialName: string;
    selectionIds: readonly string[];
    evidenceIds: readonly string[];
    proofKind: 'direct_session_claim' | 'combined_session_facts';
  }[];
  transactionDates?: readonly z.input<typeof reviewedTransactionDateSchema>[];
}

export function deriveDraftSessionCanonicalPromotionProposal(
  input: DraftSessionProposalInput
): AflTradeExternalCanonicalPromotionProposal {
  return deriveSessionProposal(input, false);
}

/** Uses persisted projection membership; authentication still requires complete usable candidate facts. */
export function deriveReviewedSessionCanonicalPromotionProposal(
  input: Omit<DraftSessionProposalInput, 'draftSessions'>
): AflTradeExternalCanonicalPromotionProposal {
  const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
  if (
    candidate.content.reviewedSessionCorrection?.projections.some(
      (p) => p.schemaVersion === 'afl-trade-combined-draft-session-projection/v2'
    )
  )
    return deriveReviewedWindowSessionProposal(input);
  return deriveSessionProposal(
    { ...input, draftSessions: reviewedProjectedSessions(candidate.content) },
    false,
    true
  );
}

function reviewedWindowProjectedSessions(content: PromotionCandidateContent) {
  const marker = content.reviewedSessionCorrection;
  if (!marker || content.environment === 'production')
    throw new TypeError('Window promotion requires its private reviewed correction.');
  return marker.projections.flatMap((projection) =>
    projection.selectedSessions.map((session) => ({
      ...session,
      proofKind:
        projection.schemaVersion === 'afl-trade-reported-draft-session-projection/v1'
          ? ('direct_session_claim' as const)
          : ('combined_session_facts' as const),
    }))
  );
}

function deriveReviewedWindowSessionProposal(
  input: Omit<DraftSessionProposalInput, 'draftSessions'>
): AflTradeExternalCanonicalPromotionProposal {
  const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
  const proposal = createAflTradeExternalCanonicalPromotionProposal({
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v7',
    candidateId: candidate.candidateId,
    candidateSha256: candidate.candidateId.split(':')[1]!,
    environment: candidate.content.environment,
    competition: candidate.content.competition,
    anchorSeasonYear: candidate.content.anchorSeasonYear,
    proposedAt: instantSchema.parse(input.proposedAt),
    publicationEligible: false,
    transactionDateCoverage: deriveTransactionDateCoverage(candidate, input.transactionDates),
    draftEventCoverage: reviewedWindowProjectedSessions(candidate.content).map((session) => ({
      ...session,
      expectedSelectionCount: session.selectionIds.length,
      status: 'complete' as const,
    })),
  });
  authenticateAflTradeExternalCanonicalPromotionProposal({ candidate, proposal });
  return proposal;
}

function reviewedProjectedSessions(content: PromotionCandidateContent) {
  const marker = content.reviewedSessionCorrection;
  if (!marker || content.environment === 'production')
    throw new TypeError('Subset promotion requires its private reviewed session correction.');
  return marker.projections.flatMap((projection) => {
    if (projection.schemaVersion === 'afl-trade-combined-draft-session-projection/v2')
      throw new TypeError(
        'Window session promotion requires versioned storage and lifecycle authentication.'
      );
    return projection.selectedSessions.map((session) => ({
      ...session,
      proofKind:
        projection.schemaVersion === 'afl-trade-combined-draft-session-projection/v1'
          ? ('combined_session_facts' as const)
          : ('direct_session_claim' as const),
    }));
  });
}

export function deriveCombinedDraftSessionCanonicalPromotionProposal(
  input: Omit<DraftSessionProposalInput, 'draftSessions'> & {
    draftSessions: readonly Omit<DraftSessionProposalInput['draftSessions'][number], 'proofKind'>[];
  }
): AflTradeExternalCanonicalPromotionProposal {
  return deriveSessionProposal(
    {
      ...input,
      draftSessions: input.draftSessions.map((session) => ({
        ...session,
        proofKind: 'combined_session_facts',
      })),
    },
    true
  );
}

function deriveSessionProposal(
  input: DraftSessionProposalInput,
  legacyCombined: boolean,
  reviewedSubset = false
): AflTradeExternalCanonicalPromotionProposal {
  const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
  const eventMetadata = new Map<string, z.input<typeof draftEventMetadataSchema>>();
  for (const session of input.draftSessions) {
    const key = coverageKey(session.draftYear, session.draftType);
    const event = {
      draftYear: session.draftYear,
      draftType: session.draftType,
      eventDate: session.eventDate,
      officialName: session.officialName,
    };
    const existing = eventMetadata.get(key);
    if (existing && existing.officialName !== event.officialName) {
      throw new TypeError('Combined draft sessions must use one exact official draft name.');
    }
    eventMetadata.set(key, existing ?? event);
  }
  const base = deriveAflTradeExternalCanonicalPromotionProposal({
    candidate,
    proposedAt: input.proposedAt,
    draftEvents: [...eventMetadata.values()],
    transactionDates: input.transactionDates,
  });
  const proposal = createAflTradeExternalCanonicalPromotionProposal(
    proposalContentSchema.parse({
      ...base.content,
      schemaVersion: reviewedSubset
        ? 'afl-trade-external-canonical-promotion-proposal/v6'
        : legacyCombined &&
            base.content.schemaVersion !== 'afl-trade-external-canonical-promotion-proposal/v4'
          ? 'afl-trade-external-canonical-promotion-proposal/v3'
          : 'afl-trade-external-canonical-promotion-proposal/v5',
      draftEventCoverage: input.draftSessions
        .map((session) => ({
          ...session,
          selectionIds: [...session.selectionIds].sort(),
          evidenceIds: [...session.evidenceIds].sort(),
          expectedSelectionCount: session.selectionIds.length,
          status: 'complete' as const,
        }))
        .sort((left, right) =>
          `${left.draftYear}|${left.draftType}|${String(left.sessionOrdinal).padStart(3, '0')}`.localeCompare(
            `${right.draftYear}|${right.draftType}|${String(right.sessionOrdinal).padStart(3, '0')}`
          )
        ),
    })
  );
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

type PromotionCandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];
type ParsedPromotionProposal = ReturnType<typeof parseAflTradeExternalCanonicalPromotionProposal>;

function assertPromotionCandidateScope(
  candidate: AflTradeExternalReconciliationCandidateRecord,
  proposal: ParsedPromotionProposal
): void {
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
  // Only a transfer the promotion writes needs its special entitlement resolved: a transaction left
  // to its earlier promotion (#869) is written as nothing.
  if (
    aflTradePromotionWriteScope(content).transfers.some(
      ({ asset }) => asset.kind === 'special_pick'
    )
  ) {
    throw new TypeError('Special entitlement must be resolved before canonical promotion.');
  }
  // Deferred pick-side issues (#869) stay on the candidate; only a blocking issue refuses promotion.
  if (content.issues.some(({ severity }) => severity === 'blocking')) {
    throw new TypeError('A candidate with a blocking issue cannot be promoted.');
  }
}

/**
 * Every record the promotion writes needs a usable status and complete identities. Under a reviewed
 * deferral the pick side it does not write is exempt: a deferred pick transfer is still written as a
 * directed asset (its clubs must resolve), but its unresolved status, the custody of a deferred pick
 * and the selections of a deferred draft are left for later reviewed lineage.
 */
function assertPromotionFactIdentities(content: PromotionCandidateContent): void {
  const scope = aflTradePromotionWriteScope(content);
  const deferredTransfers = scope.deferral.deferredTransferIds;
  const records = [
    ...scope.transactions,
    ...scope.transfers.filter(({ transferId }) => !deferredTransfers.has(transferId)),
    ...scope.draftSelections,
    ...scope.pickCustody,
    ...scope.pickLineage,
  ];
  if (records.some(({ status }) => !usable(status))) {
    throw new TypeError('Every promoted factual record must have a usable reconciliation status.');
  }
  if (
    scope.transactions.some(
      ({ parties, transferIds, title, transactionType }) =>
        title === null ||
        transactionType === 'other' ||
        parties.length < 2 ||
        transferIds.length === 0
    ) ||
    scope.transfers.some(
      ({ fromClubId, toClubId, asset }) =>
        fromClubId === null ||
        toClubId === null ||
        (asset.kind === 'player' && asset.playerId === null)
    ) ||
    scope.draftSelections.some(({ playerId, clubId }) => playerId === null || clubId === null) ||
    scope.pickCustody.some(({ currentClubId }) => currentClubId === null)
  ) {
    throw new TypeError('Promoted facts require complete reviewed canonical identities and dates.');
  }
}

function reviewedDraftCoverage(
  content: PromotionCandidateContent,
  proposal: ParsedPromotionProposal
): Map<string, string[]> {
  const expectedCoverage = new Map<string, string[]>();
  for (const coverage of proposal.content.draftEventCoverage) {
    // A session re-sync writes no draft; assertPromotionResyncCoverage checks it.
    if (isAflTradePromotedSessionResyncCoverage(coverage)) continue;
    const key = coverageKey(coverage.draftYear, coverage.draftType);
    expectedCoverage.set(
      key,
      [...(expectedCoverage.get(key) ?? []), ...coverage.selectionIds].sort()
    );
    if (
      'evidenceIds' in coverage &&
      coverage.selectionIds.some((id) => {
        const selection = content.draftSelections.find((value) => value.selectionId === id);
        return (
          !selection ||
          !coverage.evidenceIds.every((evidenceId) => selection.evidenceIds.includes(evidenceId))
        );
      })
    )
      throw new TypeError(
        'Each draft session requires retained date evidence for its exact selections.'
      );
  }
  return expectedCoverage;
}

function assertPromotionTransactionDates(
  content: PromotionCandidateContent,
  proposal: ParsedPromotionProposal
): void {
  const transactionDateById = new Map(
    proposal.content.transactionDateCoverage.map(({ transactionId, seasonYear, occurredOn }) => [
      transactionId,
      { seasonYear, occurredOn },
    ])
  );
  const written = aflTradePromotionWriteScope(content).transactions;
  if (
    transactionDateById.size !== written.length ||
    written.some(({ transactionId, seasonYear, occurredOn }) => {
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
}

function assertPromotionDraftCoverage(
  content: PromotionCandidateContent,
  expectedCoverage: ReadonlyMap<string, string[]>
): void {
  const actualCoverage = new Map<string, string[]>();
  // A draft holding a deferred selection is not promoted by this candidate, so coverage omits it.
  aflTradePromotionWriteScope(content).draftSelections.forEach((selection) => {
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
}

/**
 * The session re-syncs of a proposal cover exactly the candidate's re-synced selections (#853), each
 * once, each in an entry of its own draft. Whether each entry's version is still current, and on the
 * right root, is canonical state: the promoter checks it when it writes.
 */
function assertPromotionResyncCoverage(
  content: PromotionCandidateContent,
  proposal: ParsedPromotionProposal
): void {
  const resynced = new Map(
    aflTradePromotionWriteScope(content).resyncedSelections.map((selection) => [
      selection.selectionId,
      selection,
    ])
  );
  const covered = new Set<string>();
  for (const coverage of proposal.content.draftEventCoverage) {
    if (!isAflTradePromotedSessionResyncCoverage(coverage)) continue;
    for (const selectionId of coverage.selectionIds) {
      const selection = resynced.get(selectionId);
      if (
        selection === undefined ||
        covered.has(selectionId) ||
        selection.draftYear !== coverage.draftYear ||
        selection.draftType !== coverage.draftType
      ) {
        throw new TypeError(
          'Promoted session re-syncs must cover exactly the candidate re-synced selections, each once.'
        );
      }
      covered.add(selectionId);
    }
  }
  if (covered.size !== resynced.size) {
    throw new TypeError(
      'Promoted session re-syncs must cover exactly the candidate re-synced selections, each once.'
    );
  }
}

export function authenticateAflTradeExternalCanonicalPromotionProposal(input: {
  candidate: unknown;
  proposal: unknown;
}): AuthenticatedAflTradeExternalCanonicalPromotion {
  const candidate: AflTradeExternalReconciliationCandidateRecord =
    parseAflTradeExternalReconciliationCandidate(input.candidate);
  const proposal = parseAflTradeExternalCanonicalPromotionProposal(input.proposal);
  const content = candidate.content;

  if (proposal.content.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v7') {
    const expected = reviewedWindowProjectedSessions(content).map((session) => ({
      ...session,
      expectedSelectionCount: session.selectionIds.length,
      status: 'complete' as const,
    }));
    if (
      canonicalizeAflTradeJson(expected) !==
      canonicalizeAflTradeJson(proposal.content.draftEventCoverage)
    )
      throw new TypeError('Window promotion must exactly match its reviewed session projection.');
  }
  if (proposal.content.schemaVersion === 'afl-trade-external-canonical-promotion-proposal/v6') {
    const expected = reviewedProjectedSessions(content).map((session) => ({
      ...session,
      expectedSelectionCount: session.selectionIds.length,
      status: 'complete' as const,
    }));
    if (
      canonicalizeAflTradeJson(expected) !==
      canonicalizeAflTradeJson(proposal.content.draftEventCoverage)
    )
      throw new TypeError('Subset promotion must exactly match its reviewed session projection.');
  }
  assertPromotionCandidateScope(candidate, proposal);
  assertPromotionFactIdentities(content);
  const expectedCoverage = reviewedDraftCoverage(content, proposal);
  assertPromotionTransactionDates(content, proposal);
  assertPromotionDraftCoverage(content, expectedCoverage);
  assertPromotionResyncCoverage(content, proposal);
  const scope = aflTradePromotionWriteScope(content);
  if (
    scope.deferral.deferredIssueCount > 0 &&
    proposal.content.schemaVersion !==
      AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_PROPOSAL_SCHEMA_VERSION &&
    proposal.content.schemaVersion !== 'afl-trade-external-canonical-promotion-proposal/v4'
  ) {
    throw new TypeError(
      'A deferred-lineage candidate promotes through the metadata-only (v1/v4) proposal.'
    );
  }

  return {
    candidateId: candidate.candidateId,
    proposalId: proposal.proposalId,
    transactionCount: scope.transactions.length,
    transferCount: scope.transfers.length,
    draftSelectionCount: scope.draftSelections.length + scope.resyncedSelections.length,
    pickCustodyCount: scope.pickCustody.length,
    pickRealizationCount: scope.pickLineage.length,
    pickLineageDeferral:
      scope.deferral.deferral === null
        ? null
        : {
            decisionId: scope.deferral.deferral.decisionId,
            deferredIssueCount: scope.deferral.deferredIssueCount,
            // Present only when non-zero, so every earlier receipt keeps its content address.
            ...(scope.promotedDraftCount === 0
              ? {}
              : { promotedDraftCount: scope.promotedDraftCount }),
            ...(scope.resyncedSelectionCount === 0
              ? {}
              : { resyncedSelectionCount: scope.resyncedSelectionCount }),
            ...(scope.skippedRealizationCount === 0
              ? {}
              : { skippedRealizationCount: scope.skippedRealizationCount }),
            ...(scope.promotedTransactionCount === 0
              ? {}
              : {
                  promotedTransactionCount: scope.promotedTransactionCount,
                  promotedTransactionIds: [...scope.deferral.promotedTransactionIds].sort(),
                }),
            ...(scope.deferredCustodyCount === 0
              ? {}
              : { deferredCustodyCount: scope.deferredCustodyCount }),
            ...(scope.promotedCustodyCount === 0
              ? {}
              : { promotedCustodyCount: scope.promotedCustodyCount }),
          },
  };
}
