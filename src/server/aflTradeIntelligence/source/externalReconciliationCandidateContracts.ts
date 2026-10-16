import { reviewedSessionCorrectionSchema } from './reviewedSessionCorrectionContracts';
import { pickTerminalOutcomeSchema } from './pickTerminalOutcome';
import { pickCustodyDateSchema } from './pickCustodyDate';
import {
  canonicalPickEntitlementSchema,
  resolvedSpecialEntitlementSchema,
} from './resolvedSpecialEntitlement';
import { specialDraftEntitlementSchema } from './specialDraftEntitlement';
import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
  isAflTradeDraftPending,
} from './externalEvidenceReconciliation';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION,
  aflTradeExternalReconciliationSourceAuthoritySchema,
} from './externalReconciliationSourceAuthorityContracts';
import {
  aflTradeIssuelessDeferralKept,
  aflTradeNumberOnlyPickIds,
  isAflTradePickSideReconciliationIssue,
  isAflTradeUsableCustodyStatus,
} from './pickLineageDeferral';
import { createAflTradePickOnwardTransfers } from './pickOnwardTransfer';

const instantSchema = z.iso.datetime({ offset: true });
const statusSchema = z.enum(['single_source', 'corroborated', 'disputed', 'unresolved']);
const evidenceIdSchema = aflTradeContentAddressedIdSchema('external-evidence');
const sortedUniqueIdsSchema = z
  .array(z.string().trim().min(1).max(240))
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'IDs must be unique.' });
    }
    if (values.some((value, index) => index > 0 && values[index - 1].localeCompare(value) > 0)) {
      context.addIssue({ code: 'custom', message: 'IDs must be canonically sorted.' });
    }
  });
const evidenceIdsSchema = sortedUniqueIdsSchema.pipe(z.array(evidenceIdSchema).min(1));

const transactionSchema = z
  .object({
    transactionId: aflTradeContentAddressedIdSchema('external-transaction'),
    providerEventId: z.string().trim().min(1).max(500),
    seasonYear: z.number().int().min(1897).max(2200),
    occurredOn: z.iso.date().nullable(),
    transactionType: z.enum(['trade', 'free_agency', 'other']),
    title: z.string().trim().min(1).max(1_000).nullable(),
    parties: sortedUniqueIdsSchema,
    transferIds: sortedUniqueIdsSchema.pipe(
      z.array(aflTradeContentAddressedIdSchema('external-transfer'))
    ),
    status: statusSchema,
    evidenceIds: evidenceIdsSchema,
  })
  .strict();

const transferSchema = z
  .object({
    transferId: aflTradeContentAddressedIdSchema('external-transfer'),
    transactionId: aflTradeContentAddressedIdSchema('external-transaction'),
    fromClubId: z.string().trim().min(1).max(240).nullable(),
    toClubId: z.string().trim().min(1).max(240).nullable(),
    asset: z.discriminatedUnion('kind', [
      specialDraftEntitlementSchema,
      resolvedSpecialEntitlementSchema,
      z
        .object({
          kind: z.literal('player'),
          playerId: z.string().trim().min(1).max(240).nullable(),
          recordedName: z.string().trim().min(1).max(500),
        })
        .strict(),
      canonicalPickEntitlementSchema,
    ]),
    status: statusSchema,
    evidenceIds: evidenceIdsSchema,
  })
  .strict();

const selectionSchema = z
  .object({
    selectionId: aflTradeContentAddressedIdSchema('external-draft-selection'),
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.string().trim().min(1).max(80),
    selectionNumber: z.number().int().positive(),
    roundNumber: z.number().int().positive().nullable(),
    pickId: aflTradeContentAddressedIdSchema('draft-pick'),
    playerId: z.string().trim().min(1).max(240).nullable(),
    clubId: z.string().trim().min(1).max(240).nullable(),
    status: statusSchema,
    supportingProviders: z
      .array(
        z.enum([
          'statly_local_fixture',
          'draftguru',
          'footywire',
          'official_afl',
          'fitzroy_official_afl_player_details',
          'footyinfo',
        ])
      )
      .min(1),
    evidenceIds: evidenceIdsSchema,
  })
  .strict();

const custodySchema = z
  .object({
    custodyId: aflTradeContentAddressedIdSchema('external-pick-custody'),
    pickId: aflTradeContentAddressedIdSchema('draft-pick'),
    observedAt: pickCustodyDateSchema,
    predecessorCustodyId: aflTradeContentAddressedIdSchema('external-pick-custody')
      .nullable()
      .optional(),
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.string().trim().min(1).max(80),
    roundNumber: z.number().int().positive().nullable(),
    recordedPickNumber: z.number().int().positive().nullable(),
    originalClubId: z.string().trim().min(1).max(240).nullable(),
    currentClubId: z.string().trim().min(1).max(240).nullable(),
    status: statusSchema,
    evidenceIds: evidenceIdsSchema,
  })
  .strict();

const lineageSchema = z
  .object({
    lineageId: aflTradeContentAddressedIdSchema('external-pick-lineage'),
    pickId: aflTradeContentAddressedIdSchema('draft-pick'),
    transferId: aflTradeContentAddressedIdSchema('external-transfer'),
    selectionId: aflTradeContentAddressedIdSchema('external-draft-selection').nullable(),
    terminalOutcome: pickTerminalOutcomeSchema.optional(),
    status: statusSchema,
    evidenceIds: evidenceIdsSchema,
  })
  .strict()
  .refine(
    (record) => (record.selectionId === null) === (record.terminalOutcome !== undefined),
    'Non-player outcomes require no selection; selected outcomes require a selection.'
  );

/** A provider-stated received-pick outcome; single-source and separate from governed lineage. */
const pickOutcomeSchema = z
  .object({
    outcomeId: aflTradeContentAddressedIdSchema('external-pick-outcome'),
    transferId: aflTradeContentAddressedIdSchema('external-transfer'),
    disposition: z.enum(['selected', 'traded_on', 'not_used']),
    outcomeStatus: z.enum(['stated', 'pending', 'unresolved']),
    selectionId: aflTradeContentAddressedIdSchema('external-draft-selection').nullable(),
    playerId: z.string().trim().min(1).max(240).nullable(),
    nominationBasis: z
      .enum([
        'club_took_nominated_player',
        'club_took_no_nominated_player',
        'no_access_evidence',
        'board_pick_passed_or_removed',
      ])
      .optional(),
    receivingClubNominatedSelections: z.number().int().nonnegative().max(90).optional(),
    /** The Footyinfo board pick stating the pick was passed or removed (issue 853). */
    boardPickId: aflTradeContentAddressedIdSchema('external-draft-board-pick').optional(),
    /**
     * A reviewed Footyinfo board, not an official session, proved the draft's membership behind a
     * count (owner decision 2026-10-14, issue 789). Absent when an official session proved it.
     */
    draftProvenBy: z.literal('footyinfo').optional(),
    /**
     * Issue 789 (2026-10-16): the board picks recording a receiving-club selection Draftguru marks
     * open as that club's matched bid, each counted as a nominee.
     */
    matchedBidBoardPickIds: sortedUniqueIdsSchema
      .pipe(z.array(aflTradeContentAddressedIdSchema('external-draft-board-pick')).min(1).max(90))
      .optional(),
    /**
     * Issue 789: Draftguru stated this hop "not used", but the candidate holds the receiving club's
     * onward transfer of the same pick in a later trade, so the outcome is traded on.
     */
    statedDisposition: z.literal('not_used').optional(),
    evidenceIds: evidenceIdsSchema,
  })
  .strict()
  .refine((record) => {
    const { nominationBasis: basis, receivingClubNominatedSelections: count } = record;
    if ((basis === 'board_pick_passed_or_removed') !== (record.boardPickId !== undefined))
      return false;
    // Only a count rests on a proven membership; a board pick or unknown access is no count.
    if (
      record.draftProvenBy !== undefined &&
      basis !== 'club_took_nominated_player' &&
      basis !== 'club_took_no_nominated_player'
    )
      return false;
    // A board-recorded matched bid is a counted nominee, so it only ever raises a positive count.
    const matchedBids = record.matchedBidBoardPickIds?.length ?? 0;
    if (
      matchedBids > 0 &&
      (basis !== 'club_took_nominated_player' || count === undefined || count < matchedBids)
    )
      return false;
    if (basis === undefined) return count === undefined;
    if (record.disposition !== 'not_used' || record.outcomeStatus !== 'stated') return false;
    // Without complete access evidence the count is unknown, never zero; a board pick is no count.
    if (basis === 'no_access_evidence' || basis === 'board_pick_passed_or_removed')
      return count === undefined;
    if (basis === 'club_took_nominated_player') return count !== undefined && count > 0;
    return count === 0;
  }, 'A nomination basis belongs only to a stated not-used pick, and its count must match it.')
  .refine(
    (record) =>
      record.selectionId === null ||
      (record.disposition === 'selected' && record.outcomeStatus === 'stated'),
    'Only a stated selected outcome names a selection.'
  )
  .refine(
    (record) => record.outcomeStatus !== 'pending' || record.disposition === 'not_used',
    'Only a not-used pick can be pending.'
  )
  .refine(
    (record) =>
      record.statedDisposition === undefined ||
      (record.disposition === 'traded_on' && record.outcomeStatus === 'stated'),
    'Only a stated traded-on outcome overrides a stated not-used pick.'
  );

/** One Footyinfo draft-board pick as reconciled (issues 853 and 789); see the reconciliation. */
const draftBoardPickSchema = z
  .object({
    boardPickId: aflTradeContentAddressedIdSchema('external-draft-board-pick'),
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.string().trim().min(1).max(80),
    roundNumber: z.number().int().positive().nullable(),
    recordedPickNumber: z.number().int().positive().nullable(),
    status: z.enum(['selected', 'passed', 'removed']),
    clubId: z.string().trim().min(1).max(240).nullable(),
    routeClubIds: z.array(z.string().trim().min(1).max(240)).max(16).nullable(),
    /** Issue 789: the basis of the bid the holder matched, when the board states a matched bid. */
    matchedBidBasis: z.enum(['father_son', 'academy', 'next_generation_academy']).optional(),
    evidenceIds: evidenceIdsSchema,
  })
  .strict()
  .refine(
    (record) => (record.status === 'selected') === (record.recordedPickNumber !== null),
    'A board pick has a number exactly when it was selected.'
  );

const issueSchema = z
  .object({
    code: z.enum([
      'identity_unresolved',
      'identity_resolution_conflict',
      'selection_conflict',
      'pick_identity_conflict',
      'transaction_incomplete',
      'lineage_unresolved',
      'pick_outcome_unresolved',
    ]),
    severity: z.enum(['blocking', 'deferred']),
    subjectKey: z.string().trim().min(1).max(1_000),
    detail: z.string().trim().min(1).max(4_000),
    evidenceIds: z.array(evidenceIdSchema),
  })
  .strict();

const contentFieldsSchema = z
  .object({
    schemaVersion: z.union([
      z.literal(AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION),
      z.literal(AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION),
    ]),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.string().trim().min(1).max(40),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    sourceBatchIds: sortedUniqueIdsSchema.pipe(
      z.array(aflTradeContentAddressedIdSchema('external-evidence-batch')).min(1)
    ),
    sourceAuthority: aflTradeExternalReconciliationSourceAuthoritySchema.optional(),
    reviewedScope: z
      .object({
        sourceCandidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
        registrationId: aflTradeContentAddressedIdSchema('reviewed-pick-lineage-registration'),
        deferredEvidenceIds: sortedUniqueIdsSchema.pipe(z.array(evidenceIdSchema)),
      })
      .strict()
      .optional(),
    reviewedCorrection: z
      .object({
        schemaVersion: z.literal('afl-trade-reviewed-ordinary-correction/v1'),
        scopeCandidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
        registrationId: aflTradeContentAddressedIdSchema('reviewed-pick-lineage-registration'),
        correctionGraphId: aflTradeContentAddressedIdSchema('reviewed-lineage-correction-graph'),
        bindings: z.array(
          z
            .object({
              transferId: aflTradeContentAddressedIdSchema('external-transfer'),
              lineageId: aflTradeContentAddressedIdSchema('external-pick-lineage'),
              custodyIds: z.array(aflTradeContentAddressedIdSchema('external-pick-custody')).min(1),
            })
            .strict()
        ),
      })
      .strict()
      .optional(),
    reviewedSpecialCorrection: z
      .object({
        schemaVersion: z.literal('afl-trade-reviewed-special-correction/v1'),
        parentCandidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
        registrationId: aflTradeContentAddressedIdSchema('reviewed-pick-lineage-registration'),
        correctionGraphId: aflTradeContentAddressedIdSchema('reviewed-lineage-correction-graph'),
        bindings: z
          .array(
            z
              .object({
                transferId: aflTradeContentAddressedIdSchema('external-transfer'),
                entitlementId: aflTradeContentAddressedIdSchema('special-draft-entitlement'),
                awardApprovalDecisionId: z.string().min(1),
                predecessorTransferId:
                  aflTradeContentAddressedIdSchema('external-transfer').nullable(),
              })
              .strict()
          )
          .min(1),
      })
      .strict()
      .optional(),
    reviewedRookieCorrection: z
      .object({
        schemaVersion: z.literal('afl-trade-reviewed-rookie-correction/v1'),
        parentCandidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
        registrationId: aflTradeContentAddressedIdSchema('reviewed-pick-lineage-registration'),
        correctionGraphId: aflTradeContentAddressedIdSchema('reviewed-lineage-correction-graph'),
        bindings: z
          .array(
            z
              .object({
                transferId: aflTradeContentAddressedIdSchema('external-transfer'),
                lineageId: aflTradeContentAddressedIdSchema('external-pick-lineage'),
                custodyIds: z
                  .array(aflTradeContentAddressedIdSchema('external-pick-custody'))
                  .min(1),
              })
              .strict()
          )
          .min(1),
      })
      .strict()
      .optional(),
    reviewedSessionCorrection: reviewedSessionCorrectionSchema.optional(),
    reviewedStatusCorrection: z
      .object({
        schemaVersion: z.literal('afl-trade-reviewed-status-correction/v1'),
        parentCandidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
        transactionIds: sortedUniqueIdsSchema.pipe(
          z.array(aflTradeContentAddressedIdSchema('external-transaction'))
        ),
        selectionIds: sortedUniqueIdsSchema.pipe(
          z.array(aflTradeContentAddressedIdSchema('external-draft-selection'))
        ),
      })
      .strict()
      .optional(),
    identityResolutionIds: sortedUniqueIdsSchema.pipe(
      z.array(aflTradeContentAddressedIdSchema('external-identity-resolution'))
    ),
    transactions: z.array(transactionSchema),
    transfers: z.array(transferSchema),
    draftSelections: z.array(selectionSchema),
    pickCustody: z.array(custodySchema),
    pickLineage: z.array(lineageSchema),
    pickOutcomes: z.array(pickOutcomeSchema).min(1).optional(),
    /** Present only when a Footyinfo board was reconciled, so earlier candidate ids are unchanged. */
    draftBoardPicks: z.array(draftBoardPickSchema).min(1).optional(),
    /**
     * The approved owner `reconciliation_scope` decision under which pick-side issues are `deferred`
     * (statlyaus/Statly#869). Present exactly when the candidate holds a deferred issue.
     */
    pickLineageDeferral: z
      .object({
        decisionId: aflTradeContentAddressedIdSchema('review-decision'),
        /**
         * Drafts whose every candidate selection is already a current canonical selection of a
         * finalized promotion; the promotion writes nothing of them. Present only when non-empty,
         * sorted by year then type, each naming a draft the candidate holds a selection in.
         */
        promotedDrafts: z
          .array(
            z
              .object({
                draftYear: z.number().int().min(1897).max(2200),
                draftType: z.string().trim().min(1).max(80),
              })
              .strict()
          )
          .min(1)
          .max(100)
          .optional(),
        /**
         * Selections current canonical under another player because an identity repair
         * re-targeted the draftee (#853, migration 0278): the promotion re-promotes only these
         * slots, one scoped later version per session root, repairing the player alone (0279).
         * Sorted unique, each an undisputed candidate selection with a player and club outside every
         * already-promoted draft, present only when non-empty.
         */
        resyncedSelectionIds: sortedUniqueIdsSchema
          .pipe(
            z.array(aflTradeContentAddressedIdSchema('external-draft-selection')).min(1).max(10_000)
          )
          .optional(),
        /**
         * Selections whose current canonical row carries the slot's number-only pick id while the
         * candidate names a pick with usable custody (#853, migration 0284): re-promoted with the
         * re-synced slots under the candidate's pick. Sorted unique, each a `single_source` or
         * `corroborated` candidate selection with a player and club outside every already-promoted
         * draft, whose pick has a usable custody row and is not its number-only address; present
         * only when non-empty.
         */
        rekeyedSelectionIds: sortedUniqueIdsSchema
          .pipe(
            z.array(aflTradeContentAddressedIdSchema('external-draft-selection')).min(1).max(10_000)
          )
          .optional(),
        /**
         * Transactions whose trade event is already current canonical with every transfer a
         * promoted asset on it; the promotion writes nothing of them. Sorted unique, each a
         * candidate transaction, present only when non-empty.
         */
        promotedTransactions: sortedUniqueIdsSchema
          .pipe(
            z.array(aflTradeContentAddressedIdSchema('external-transaction')).min(1).max(10_000)
          )
          .optional(),
        /**
         * Custody observations without a usable status (`unresolved`, `disputed`): pick-side,
         * left unwritten. Sorted unique, each a candidate custody row, present only when non-empty.
         */
        deferredCustodyIds: sortedUniqueIdsSchema
          .pipe(
            z.array(aflTradeContentAddressedIdSchema('external-pick-custody')).min(1).max(100_000)
          )
          .optional(),
        /**
         * Usable custody observations already canonical under a finalized promotion with the
         * candidate's facts (#853): left unwritten. Sorted unique, each a usable candidate custody
         * row, present only when non-empty.
         */
        promotedCustodyIds: sortedUniqueIdsSchema
          .pipe(
            z.array(aflTradeContentAddressedIdSchema('external-pick-custody')).min(1).max(100_000)
          )
          .optional(),
      })
      .strict()
      .optional(),
    issues: z.array(issueSchema),
    reconciledAt: instantSchema,
    publicationEligible: z.literal(false),
  })
  .strict();

type CandidateContent = z.infer<typeof contentFieldsSchema>;

function validatePickLineageDeferral(content: CandidateContent, context: z.RefinementCtx) {
  const deferred = content.issues.filter(({ severity }) => severity === 'deferred');
  if (deferred.length > 0 && content.pickLineageDeferral === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['pickLineageDeferral'],
      message: 'A deferred issue requires the approved reconciliation-scope decision.',
    });
  }
  // Under the decision the reconciler defers every pick-side issue, so a decision that deferred none
  // (#853) has none blocking either. Before migration 0282 no candidate carried such a decision.
  if (
    deferred.length === 0 &&
    content.pickLineageDeferral !== undefined &&
    content.issues.some(
      (issue) => issue.severity === 'blocking' && isAflTradePickSideReconciliationIssue(issue)
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['pickLineageDeferral'],
      message: 'Under the deferral decision every pick-side issue is deferred.',
    });
  }
  // With nothing deferred the decision is carried only for what it lists, and never over a draft
  // the promotion would write whole (#853, `aflTradeIssuelessDeferralKept`).
  if (
    deferred.length === 0 &&
    content.pickLineageDeferral !== undefined &&
    !aflTradeIssuelessDeferralKept(content.pickLineageDeferral, content.draftSelections)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['pickLineageDeferral'],
      message:
        'A deferral decision with no deferred issue is carried only by a candidate that lists already-promoted or re-synced records and writes no draft whole.',
    });
  }
  if (
    content.pickLineageDeferral !== undefined &&
    content.sourceAuthority?.kind !== 'historical_plan_completion'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['pickLineageDeferral'],
      message:
        'A deferral decision names a historical completion; the candidate needs its authority.',
    });
  }
  const promotedDrafts = content.pickLineageDeferral?.promotedDrafts ?? [];
  promotedDrafts.forEach((draft, index) => {
    const previous = promotedDrafts[index - 1];
    if (
      previous !== undefined &&
      (previous.draftYear > draft.draftYear ||
        (previous.draftYear === draft.draftYear &&
          previous.draftType.localeCompare(draft.draftType) >= 0))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineageDeferral', 'promotedDrafts', index],
        message: 'Already-promoted drafts must be unique and sorted by year then type.',
      });
    }
    if (
      !content.draftSelections.some(
        ({ draftYear, draftType }) => draftYear === draft.draftYear && draftType === draft.draftType
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineageDeferral', 'promotedDrafts', index],
        message: 'An already-promoted draft must be one the candidate holds a selection in.',
      });
    }
  });
  (content.pickLineageDeferral?.resyncedSelectionIds ?? []).forEach((selectionId, index) => {
    const selection = content.draftSelections.find((value) => value.selectionId === selectionId);
    if (
      selection === undefined ||
      selection.playerId === null ||
      selection.clubId === null ||
      selection.status === 'disputed' ||
      promotedDrafts.some(
        ({ draftYear, draftType }) =>
          draftYear === selection.draftYear && draftType === selection.draftType
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineageDeferral', 'resyncedSelectionIds', index],
        message:
          'A re-synced selection must be an undisputed candidate selection with a player and club, outside every already-promoted draft.',
      });
    }
  });
  const rekeyedPickIds = (content.pickLineageDeferral?.rekeyedSelectionIds ?? []).map(
    (selectionId) =>
      content.draftSelections.find((value) => value.selectionId === selectionId)?.pickId
  );
  (content.pickLineageDeferral?.rekeyedSelectionIds ?? []).forEach((selectionId, index) => {
    // Two re-keyed slots never take one pick (pick-identity rule 4).
    if (
      rekeyedPickIds[index] !== undefined &&
      rekeyedPickIds.indexOf(rekeyedPickIds[index]) !== index
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineageDeferral', 'rekeyedSelectionIds', index],
        message: 'Two re-keyed selections cannot take the same pick.',
      });
    }
    const selection = content.draftSelections.find((value) => value.selectionId === selectionId);
    if (
      selection === undefined ||
      selection.playerId === null ||
      selection.clubId === null ||
      !isAflTradeUsableCustodyStatus(selection.status) ||
      aflTradeNumberOnlyPickIds(selection).includes(selection.pickId) ||
      !content.pickCustody.some(
        (custody) =>
          custody.pickId === selection.pickId && isAflTradeUsableCustodyStatus(custody.status)
      ) ||
      promotedDrafts.some(
        ({ draftYear, draftType }) =>
          draftYear === selection.draftYear && draftType === selection.draftType
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineageDeferral', 'rekeyedSelectionIds', index],
        message:
          'A re-keyed selection must be a usable candidate selection with a player and club whose pick has usable custody and is not a number-only address, outside every already-promoted draft.',
      });
    }
  });
  (content.pickLineageDeferral?.deferredCustodyIds ?? []).forEach((custodyId, index) => {
    const row = content.pickCustody.find((custody) => custody.custodyId === custodyId);
    if (row === undefined || isAflTradeUsableCustodyStatus(row.status)) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineageDeferral', 'deferredCustodyIds', index],
        message: 'Deferred custody must be a candidate custody row without a usable status.',
      });
    }
  });
  (content.pickLineageDeferral?.promotedCustodyIds ?? []).forEach((custodyId, index) => {
    const row = content.pickCustody.find((custody) => custody.custodyId === custodyId);
    if (row === undefined || !isAflTradeUsableCustodyStatus(row.status)) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineageDeferral', 'promotedCustodyIds', index],
        message: 'Already-promoted custody must be a usable candidate custody row.',
      });
    }
  });
  (content.pickLineageDeferral?.promotedTransactions ?? []).forEach((transactionId, index) => {
    if (!content.transactions.some((transaction) => transaction.transactionId === transactionId)) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineageDeferral', 'promotedTransactions', index],
        message: 'An already-promoted transaction must be one the candidate holds.',
      });
    }
  });
  content.issues.forEach((issue, index) => {
    if (issue.severity === 'deferred' && !isAflTradePickSideReconciliationIssue(issue)) {
      context.addIssue({
        code: 'custom',
        path: ['issues', index, 'severity'],
        message: 'Only a pick-side issue can be deferred; player-side issues stay blocking.',
      });
    }
  });
}

function validateSessionCorrectionMarker(content: CandidateContent, context: z.RefinementCtx) {
  if (content.reviewedSessionCorrection) {
    const marker = content.reviewedSessionCorrection;
    if (
      !content.reviewedScope ||
      content.environment === 'production' ||
      !content.sourceAuthority ||
      !('completionId' in content.sourceAuthority) ||
      content.sourceAuthority.completionId !== marker.sourceCompletionId ||
      marker.projections.some((proof) => {
        const group = proof.inventorySessions[0]!;
        const selected = content.draftSelections
          .filter((s) => s.draftYear === group.draftYear && s.draftType === group.draftType)
          .map((s) => s.selectionId)
          .sort();
        return JSON.stringify(selected) !== JSON.stringify(proof.selectedSelectionIds);
      })
    )
      context.addIssue({
        code: 'custom',
        path: ['reviewedSessionCorrection'],
        message:
          'Session correction must bind its private scope, source completion and exact candidate selections.',
      });
  }
}

function validateRookieCorrectionMarker(content: CandidateContent, context: z.RefinementCtx) {
  if (
    content.reviewedRookieCorrection &&
    (!content.reviewedCorrection ||
      content.environment === 'production' ||
      content.reviewedRookieCorrection.registrationId !==
        content.reviewedCorrection.registrationId ||
      content.reviewedRookieCorrection.correctionGraphId !==
        content.reviewedCorrection.correctionGraphId)
  )
    context.addIssue({
      code: 'custom',
      path: ['reviewedRookieCorrection'],
      message:
        'Rookie corrections require the same private reviewed registration and correction graph.',
    });
}

function validateSpecialCorrectionMarker(content: CandidateContent, context: z.RefinementCtx) {
  if (
    content.reviewedSpecialCorrection &&
    (!content.reviewedCorrection ||
      content.reviewedSpecialCorrection.registrationId !==
        content.reviewedCorrection.registrationId ||
      content.reviewedSpecialCorrection.correctionGraphId !==
        content.reviewedCorrection.correctionGraphId ||
      content.environment === 'production' ||
      content.sourceAuthority?.kind !== 'historical_plan_completion')
  )
    context.addIssue({
      code: 'custom',
      path: ['reviewedSpecialCorrection'],
      message:
        'Special corrections require their private ordinary parent registration and historical source authority.',
    });
}

function validateOrdinaryCorrectionMarker(content: CandidateContent, context: z.RefinementCtx) {
  if (
    content.reviewedCorrection &&
    (!content.reviewedScope ||
      content.reviewedCorrection.registrationId !== content.reviewedScope.registrationId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reviewedCorrection'],
      message: 'Reviewed corrections require their matching registered admission scope.',
    });
  }
}

function validateCandidateSourceAuthority(content: CandidateContent, context: z.RefinementCtx) {
  if (
    content.environment !== 'test_fixture' &&
    content.draftSelections.some(({ supportingProviders }) =>
      supportingProviders.includes('statly_local_fixture')
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['draftSelections'],
      message: 'Local fixture provider support is valid only in test_fixture candidates.',
    });
  }
  if (content.schemaVersion === AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION) {
    if (!content.sourceAuthority) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAuthority'],
        message: 'Version 2 candidates require an exact reconciliation source authority.',
      });
    } else if (
      content.sourceAuthority.candidateSourceBatchSetSha256 !==
      sha256AflTradeCanonicalJson(content.sourceBatchIds)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAuthority', 'candidateSourceBatchSetSha256'],
        message: 'Source authority must bind the exact canonical candidate batch set.',
      });
    }
  } else if (content.sourceAuthority !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['sourceAuthority'],
      message: 'Legacy candidates cannot claim version 2 source authority.',
    });
  }
  if (
    content.sourceAuthority?.kind === 'historical_plan_completion' &&
    Date.parse(content.sourceAuthority.completedAt) > Date.parse(content.reconciledAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reconciledAt'],
      message: 'Historical capture completion must precede reconciliation.',
    });
  }
}

function validateRookieTerminalCustody(
  content: CandidateContent,
  lineage: CandidateContent['pickLineage'][number],
  index: number,
  context: z.RefinementCtx
) {
  const usable = (status: z.infer<typeof statusSchema>) =>
    status === 'single_source' || status === 'corroborated';
  if (lineage.terminalOutcome?.kind === 'rookie_elevation') {
    const endpoint = lineage.terminalOutcome;
    const history = content.pickCustody.filter((custody) => custody.pickId === lineage.pickId);
    const predecessors = new Set(history.map((custody) => custody.predecessorCustodyId));
    const terminalCustody = history.filter((custody) => !predecessors.has(custody.custodyId));
    if (
      terminalCustody.length !== 1 ||
      terminalCustody[0].currentClubId !== endpoint.exercisingClubId ||
      !usable(terminalCustody[0].status)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineage', index, 'terminalOutcome'],
        message: 'Rookie elevation requires one usable terminal custody holder matching its club.',
      });
    }
  }
}

function hasUnusableLineageEvidence(
  lineage: CandidateContent['pickLineage'][number],
  transfer: CandidateContent['transfers'][number],
  selection: CandidateContent['draftSelections'][number] | undefined,
  hasUsableCustody: boolean
) {
  const usable = (status: z.infer<typeof statusSchema>) =>
    status === 'single_source' || status === 'corroborated';
  return (
    !usable(lineage.status) ||
    !usable(transfer.status) ||
    (selection !== undefined && !usable(selection.status)) ||
    !hasUsableCustody
  );
}

const contentSchema = contentFieldsSchema.superRefine((content, context) => {
  validateSessionCorrectionMarker(content, context);
  validateRookieCorrectionMarker(content, context);
  validateSpecialCorrectionMarker(content, context);
  validateOrdinaryCorrectionMarker(content, context);
  validateCandidateSourceAuthority(content, context);
  validatePickLineageDeferral(content, context);
  const transactionIds = new Set(content.transactions.map(({ transactionId }) => transactionId));
  const transferIds = new Set(content.transfers.map(({ transferId }) => transferId));
  const duplicate = (values: readonly string[]) => new Set(values).size !== values.length;
  const collections = [
    ['transactions', content.transactions.map(({ transactionId }) => transactionId)],
    ['transfers', content.transfers.map(({ transferId }) => transferId)],
    ['draftSelections', content.draftSelections.map(({ selectionId }) => selectionId)],
    ['pickCustody', content.pickCustody.map(({ custodyId }) => custodyId)],
    ['pickLineage', content.pickLineage.map(({ lineageId }) => lineageId)],
    ['pickOutcomes', (content.pickOutcomes ?? []).map(({ outcomeId }) => outcomeId)],
    ['draftBoardPicks', (content.draftBoardPicks ?? []).map(({ boardPickId }) => boardPickId)],
  ] as const;
  const relevantSeasonYears = new Set([
    ...content.transactions.map(({ seasonYear }) => seasonYear),
    ...content.transfers.flatMap(({ asset }) =>
      asset.kind === 'pick_entitlement' ? [asset.draftYear] : []
    ),
    ...content.draftSelections.map(({ draftYear }) => draftYear),
    ...content.pickCustody.map(({ draftYear }) => draftYear),
  ]);
  if (!relevantSeasonYears.has(content.anchorSeasonYear)) {
    context.addIssue({
      code: 'custom',
      path: ['anchorSeasonYear'],
      message: 'Candidate anchor season must be represented by its factual records.',
    });
  }
  collections.forEach(([path, values]) => {
    if (duplicate(values))
      context.addIssue({ code: 'custom', path: [path], message: 'IDs must be unique.' });
  });
  content.transfers.forEach((transfer, index) => {
    if (!transactionIds.has(transfer.transactionId)) {
      context.addIssue({
        code: 'custom',
        path: ['transfers', index, 'transactionId'],
        message: 'Transfer must reference a candidate transaction.',
      });
    }
  });
  content.transactions.forEach((transaction, index) => {
    const ownedTransferIds = content.transfers
      .filter(({ transactionId }) => transactionId === transaction.transactionId)
      .map(({ transferId }) => transferId)
      .sort();
    const incomplete = transaction.parties.length < 2 || transaction.transferIds.length === 0;
    if (
      transaction.transferIds.some((transferId) => !transferIds.has(transferId)) ||
      JSON.stringify(transaction.transferIds) !== JSON.stringify(ownedTransferIds)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transactions', index, 'transferIds'],
        message: 'Transaction transfer membership must equal its exact owned transfer set.',
      });
    }
    if (
      incomplete &&
      (transaction.status !== 'unresolved' ||
        !content.issues.some(
          (issue) =>
            issue.code === 'transaction_incomplete' &&
            issue.subjectKey === `transaction:${transaction.providerEventId}`
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transactions', index],
        message: 'Incomplete transactions must remain unresolved with an exact blocking issue.',
      });
    }
  });
  // The rule the reconciler applies to a stated not-used pick its club traded on (issue 789).
  const onwardTransfersOf = createAflTradePickOnwardTransfers(
    new Map(
      content.transactions
        .filter(({ transactionType }) => transactionType === 'trade')
        .map((transaction) => [transaction.transactionId, transaction])
    ),
    content.transfers
  );
  (content.pickOutcomes ?? []).forEach((outcome, index) => {
    const transfer = content.transfers.find(({ transferId }) => transferId === outcome.transferId);
    if (
      outcome.statedDisposition !== undefined &&
      (!transfer || onwardTransfersOf(transfer).length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickOutcomes', index, 'statedDisposition'],
        message:
          'A stated not-used pick is traded on only when its club gave the same pick away in a later trade.',
      });
    }
    const selection = content.draftSelections.find(
      ({ selectionId }) => selectionId === outcome.selectionId
    );
    const selectedPlayerMatches =
      outcome.selectionId === null ||
      (selection !== undefined &&
        transfer?.asset.kind === 'pick_entitlement' &&
        selection.draftYear === transfer.asset.draftYear &&
        selection.draftType === transfer.asset.draftType &&
        selection.clubId === transfer.toClubId &&
        selection.playerId !== null &&
        selection.playerId === outcome.playerId);
    // A nomination basis may also cite the receiving club's selections in the pick's draft: the
    // year-page rows its count was read from.
    const asset = transfer?.asset.kind === 'pick_entitlement' ? transfer.asset : null;
    const nominationEvidenceIds =
      outcome.nominationBasis !== undefined && transfer && asset
        ? content.draftSelections
            .filter(
              (candidate) =>
                candidate.draftYear === asset.draftYear &&
                candidate.draftType === asset.draftType &&
                candidate.clubId === transfer.toClubId
            )
            .flatMap(({ evidenceIds }) => evidenceIds)
        : [];
    // A board basis cites the one board pick that states this pick passed or removed: held by the
    // receiving club in the pick's draft and round, its route handing it over from the sender.
    const board =
      outcome.boardPickId === undefined
        ? undefined
        : (content.draftBoardPicks ?? []).find(
            ({ boardPickId }) => boardPickId === outcome.boardPickId
          );
    // A board-recorded nominee cites a selected matched-bid board pick the receiving club held in the
    // pick's draft (issue 789).
    const matchedBids = (outcome.matchedBidBoardPickIds ?? []).map((id) =>
      (content.draftBoardPicks ?? []).find(({ boardPickId }) => boardPickId === id)
    );
    const matchedBidsMatch = matchedBids.every(
      (matched) =>
        matched !== undefined &&
        asset !== null &&
        matched.matchedBidBasis !== undefined &&
        matched.status === 'selected' &&
        matched.draftYear === asset.draftYear &&
        matched.draftType === asset.draftType &&
        matched.clubId === transfer?.toClubId
    );
    const route = board?.routeClubIds ?? [];
    const boardMatches =
      outcome.boardPickId === undefined ||
      (board !== undefined &&
        asset !== null &&
        board.status !== 'selected' &&
        board.draftYear === asset.draftYear &&
        board.draftType === asset.draftType &&
        board.roundNumber === asset.nominalRound &&
        board.clubId === transfer?.toClubId &&
        route.some(
          (club, at) =>
            at > 0 && route[at - 1] === transfer.fromClubId && club === transfer.toClubId
        ));
    const citable = new Set([
      ...(transfer?.evidenceIds ?? []),
      ...(selection?.evidenceIds ?? []),
      ...nominationEvidenceIds,
      ...(board?.evidenceIds ?? []),
      ...matchedBids.flatMap((matched) => matched?.evidenceIds ?? []),
    ]);
    if (
      !transfer ||
      !asset ||
      !outcome.evidenceIds.every((evidenceId) => citable.has(evidenceId)) ||
      !selectedPlayerMatches ||
      !boardMatches ||
      !matchedBidsMatch
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickOutcomes', index],
        message:
          'A pick outcome must bind a pick transfer, and a selected outcome the receiving club’s selection of the stated player.',
      });
    }
    // Pending is decided by the evidence: only a pick whose draft the candidate holds no selection
    // or board pick in, at or after its anchor season, may wait on that draft.
    if (
      outcome.outcomeStatus === 'pending' &&
      (!asset || !isAflTradeDraftPending(content, content.anchorSeasonYear, asset))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickOutcomes', index, 'outcomeStatus'],
        message: 'A pending pick outcome needs a draft the candidate holds no selection in.',
      });
    }
    if (
      outcome.outcomeStatus === 'unresolved' &&
      !content.issues.some(
        ({ code, evidenceIds }) =>
          code === 'pick_outcome_unresolved' &&
          outcome.evidenceIds.some((evidenceId) => evidenceIds.includes(evidenceId))
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickOutcomes', index, 'outcomeStatus'],
        message: 'An unresolved pick outcome requires its blocking issue.',
      });
    }
  });
  content.pickLineage.forEach((lineage, index) => {
    const transfer = content.transfers.find(({ transferId }) => transferId === lineage.transferId);
    const selection = content.draftSelections.find(
      ({ selectionId }) => selectionId === lineage.selectionId
    );
    const usable = (status: z.infer<typeof statusSchema>) =>
      status === 'single_source' || status === 'corroborated';
    const hasUsableCustody = content.pickCustody.some(
      (custody) => custody.pickId === lineage.pickId && usable(custody.status)
    );
    validateRookieTerminalCustody(content, lineage, index, context);
    if (
      !transfer ||
      transfer.asset.kind !== 'pick_entitlement' ||
      (!selection && !lineage.terminalOutcome)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineage', index],
        message: 'Lineage must reference a pick transfer and draft selection in this candidate.',
      });
    } else if (
      lineage.pickId !== transfer.asset.pickId ||
      (selection !== undefined && lineage.pickId !== selection.pickId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineage', index, 'pickId'],
        message: 'Lineage pick identity must match both transfer and selection.',
      });
    } else if (
      lineage.terminalOutcome &&
      lineage.terminalOutcome.kind !== 'incorporated_into_later_package' &&
      (lineage.terminalOutcome.draftYear !== transfer.asset.draftYear ||
        lineage.terminalOutcome.draftType !== transfer.asset.draftType)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineage', index],
        message: 'Terminal outcome must match the transferred pick draft.',
      });
    } else if (hasUnusableLineageEvidence(lineage, transfer, selection, hasUsableCustody)) {
      context.addIssue({
        code: 'custom',
        path: ['pickLineage', index, 'status'],
        message: 'Lineage requires usable transfer, selection, and custody evidence.',
      });
    }
  });
});

export const aflTradeExternalReconciliationCandidateSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
    content: contentSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    addAflTradeContentAddressIssue(
      'external-reconciliation',
      candidate.candidateId,
      candidate.content,
      context,
      ['candidateId']
    );
  });

export type AflTradeExternalReconciliationCandidateRecord = z.infer<
  typeof aflTradeExternalReconciliationCandidateSchema
>;

export function parseAflTradeExternalReconciliationCandidate(
  input: unknown
): AflTradeExternalReconciliationCandidateRecord {
  return aflTradeExternalReconciliationCandidateSchema.parse(input);
}

/**
 * The stated pick outcomes a derived candidate can keep: those whose transfer is still a pick
 * transfer in it, whose named selection, if any, it still holds, and, for a stated not-used pick
 * kept as traded on (issue 789), whose club's onward transfer it still holds. Returns no key when
 * none remain, so the derived candidate's id matches one built without dispositions.
 */
export function retainAflTradePickOutcomes(
  pickOutcomes: CandidateContent['pickOutcomes'],
  kept: Pick<CandidateContent, 'transactions' | 'transfers' | 'draftSelections'>
): Pick<CandidateContent, 'pickOutcomes'> {
  const pickTransfers = new Map(
    kept.transfers
      .filter(({ asset }) => asset.kind === 'pick_entitlement')
      .map((transfer) => [transfer.transferId, transfer])
  );
  const selections = new Set(kept.draftSelections.map(({ selectionId }) => selectionId));
  const onwardTransfersOf = createAflTradePickOnwardTransfers(
    new Map(
      kept.transactions
        .filter(({ transactionType }) => transactionType === 'trade')
        .map((transaction) => [transaction.transactionId, transaction])
    ),
    kept.transfers
  );
  const retained = (pickOutcomes ?? []).filter((outcome) => {
    const transfer = pickTransfers.get(outcome.transferId);
    return (
      transfer !== undefined &&
      (outcome.selectionId === null || selections.has(outcome.selectionId)) &&
      (outcome.statedDisposition === undefined || onwardTransfersOf(transfer).length > 0)
    );
  });
  return retained.length === 0 ? {} : { pickOutcomes: retained };
}

export function createAflTradeExternalReconciliationCandidate(
  content: z.input<typeof contentSchema>
): AflTradeExternalReconciliationCandidateRecord {
  const parsed = contentSchema.parse(content);
  return aflTradeExternalReconciliationCandidateSchema.parse({
    candidateId: createAflTradeContentAddress('external-reconciliation', parsed),
    content: parsed,
  });
}
