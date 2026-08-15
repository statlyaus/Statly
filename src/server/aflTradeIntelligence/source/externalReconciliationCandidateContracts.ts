import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from './externalEvidenceReconciliation';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION,
  aflTradeExternalReconciliationSourceAuthoritySchema,
} from './externalReconciliationSourceAuthorityContracts';

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
      z
        .object({
          kind: z.literal('player'),
          playerId: z.string().trim().min(1).max(240).nullable(),
          recordedName: z.string().trim().min(1).max(500),
        })
        .strict(),
      z
        .object({
          kind: z.literal('pick_entitlement'),
          pickId: aflTradeContentAddressedIdSchema('draft-pick'),
          draftYear: z.number().int().min(1897).max(2200),
          draftType: z.string().trim().min(1).max(80),
          nominalRound: z.number().int().positive().nullable(),
          nominalPick: z.number().int().positive().nullable(),
          originalClubId: z.string().trim().min(1).max(240).nullable(),
          recordedLabel: z.string().trim().min(1).max(500).nullable(),
        })
        .strict(),
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
    observedAt: instantSchema,
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
    selectionId: aflTradeContentAddressedIdSchema('external-draft-selection'),
    status: statusSchema,
    evidenceIds: evidenceIdsSchema,
  })
  .strict();

const issueSchema = z
  .object({
    code: z.enum([
      'identity_unresolved',
      'identity_resolution_conflict',
      'selection_conflict',
      'pick_identity_conflict',
      'transaction_incomplete',
      'lineage_unresolved',
    ]),
    severity: z.literal('blocking'),
    subjectKey: z.string().trim().min(1).max(1_000),
    detail: z.string().trim().min(1).max(4_000),
    evidenceIds: z.array(evidenceIdSchema),
  })
  .strict();

const contentSchema = z
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
    identityResolutionIds: sortedUniqueIdsSchema.pipe(
      z.array(aflTradeContentAddressedIdSchema('external-identity-resolution'))
    ),
    transactions: z.array(transactionSchema),
    transfers: z.array(transferSchema),
    draftSelections: z.array(selectionSchema),
    pickCustody: z.array(custodySchema),
    pickLineage: z.array(lineageSchema),
    issues: z.array(issueSchema),
    reconciledAt: instantSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((content, context) => {
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
    const transactionIds = new Set(content.transactions.map(({ transactionId }) => transactionId));
    const transferIds = new Set(content.transfers.map(({ transferId }) => transferId));
    const selectionIds = new Set(content.draftSelections.map(({ selectionId }) => selectionId));
    const duplicate = (values: readonly string[]) => new Set(values).size !== values.length;
    const collections = [
      ['transactions', [...transactionIds]],
      ['transfers', [...transferIds]],
      ['draftSelections', [...selectionIds]],
      ['pickCustody', content.pickCustody.map(({ custodyId }) => custodyId)],
      ['pickLineage', content.pickLineage.map(({ lineageId }) => lineageId)],
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
    content.pickLineage.forEach((lineage, index) => {
      const transfer = content.transfers.find(
        ({ transferId }) => transferId === lineage.transferId
      );
      const selection = content.draftSelections.find(
        ({ selectionId }) => selectionId === lineage.selectionId
      );
      const usable = (status: z.infer<typeof statusSchema>) =>
        status === 'single_source' || status === 'corroborated';
      const hasUsableCustody = content.pickCustody.some(
        (custody) => custody.pickId === lineage.pickId && usable(custody.status)
      );
      if (!transfer || transfer.asset.kind !== 'pick_entitlement' || !selection) {
        context.addIssue({
          code: 'custom',
          path: ['pickLineage', index],
          message: 'Lineage must reference a pick transfer and draft selection in this candidate.',
        });
      } else if (lineage.pickId !== transfer.asset.pickId || lineage.pickId !== selection.pickId) {
        context.addIssue({
          code: 'custom',
          path: ['pickLineage', index, 'pickId'],
          message: 'Lineage pick identity must match both transfer and selection.',
        });
      } else if (
        !usable(lineage.status) ||
        !usable(transfer.status) ||
        !usable(selection.status) ||
        !hasUsableCustody
      ) {
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

export function createAflTradeExternalReconciliationCandidate(
  content: z.input<typeof contentSchema>
): AflTradeExternalReconciliationCandidateRecord {
  const parsed = contentSchema.parse(content);
  return aflTradeExternalReconciliationCandidateSchema.parse({
    candidateId: createAflTradeContentAddress('external-reconciliation', parsed),
    content: parsed,
  });
}
