import { z } from 'zod';

import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  parseAflTradePromotionBackedFactualCandidate,
  type AflTradePromotionBackedFactualCandidate,
} from './promotionBackedFactualReleaseContracts';

export const AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_SCHEMA_VERSION =
  'afl-draft-trade-public-archive/v1' as const;
export const AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_RECORD_SCHEMA_VERSION =
  'afl-draft-trade-public-archive-record/v1' as const;
export const AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_AUTHORITY_BOUNDARY =
  'sealed_public_factual_rows_require_registry_activation_no_valuation_grade_or_fantasy_ownership' as const;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const dateSchema = z.iso.date();
const boundedIdSchema = z.string().trim().min(1).max(1_000);
const seasonSchema = z.number().int().min(1897).max(2200);

const clubSchema = z
  .object({
    clubId: boundedIdSchema,
    name: z.string().trim().min(1).max(200),
    abbreviation: z.string().trim().min(1).max(20).nullable(),
  })
  .strict();
const playerSchema = z
  .object({
    playerId: boundedIdSchema,
    displayName: z.string().trim().min(1).max(200),
  })
  .strict();
const pickSchema = z
  .object({
    pickId: boundedIdSchema,
    draftSeasonYear: seasonSchema,
    draftKind: z.string().trim().min(1).max(80),
    nominalRound: z.number().int().positive().nullable(),
    nominalPick: z.number().int().positive().nullable(),
    originalClub: clubSchema.nullable(),
  })
  .strict();

const transactionRecordSchema = z
  .object({
    recordKind: z.literal('transaction'),
    recordId: boundedIdSchema,
    eventId: boundedIdSchema,
    eventVersionId: boundedIdSchema,
    seasonYear: seasonSchema,
    occurredOn: dateSchema,
    officialName: z.string().trim().min(1).max(1_000),
    transactionType: z.string().trim().min(1).max(80),
    parties: z
      .array(
        z
          .object({
            club: clubSchema,
            role: z.string().trim().min(1).max(80),
            ordinal: z.number().int().positive(),
          })
          .strict()
      )
      .min(2)
      .max(30),
  })
  .strict()
  .superRefine((record, context) => {
    const clubIds = record.parties.map(({ club }) => club.clubId);
    if (
      record.recordId !== record.eventVersionId ||
      new Set(clubIds).size !== clubIds.length ||
      record.parties.some(({ ordinal }, index) => ordinal !== index + 1)
    ) {
      context.addIssue({ code: 'custom', message: 'Transaction parties or identity are invalid.' });
    }
  });

const draftEventRecordSchema = z
  .object({
    recordKind: z.literal('draft_event'),
    recordId: boundedIdSchema,
    eventId: boundedIdSchema,
    eventVersionId: boundedIdSchema,
    seasonYear: seasonSchema,
    occurredOn: dateSchema,
    officialName: z.string().trim().min(1).max(1_000),
    draftKind: z.enum([
      'national_draft',
      'preseason_draft',
      'rookie_draft',
      'midseason_draft',
      'supplemental_selection',
    ]),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.recordId !== record.eventVersionId) {
      context.addIssue({ code: 'custom', message: 'Draft event identity is invalid.' });
    }
  });

const assetKindSchema = z.enum([
  'player',
  'current_pick',
  'future_pick',
  'cash',
  'list_right',
  'other',
]);
const assetRecordBase = z
  .object({
    recordId: boundedIdSchema,
    assetVersionId: boundedIdSchema,
    eventVersionId: boundedIdSchema,
    assetKey: z.string().trim().min(1).max(500),
    assetKind: assetKindSchema,
    rawDescription: z.string().trim().min(1).max(2_000),
    player: playerSchema.nullable(),
    pick: pickSchema.nullable(),
  })
  .strict();

function validateAssetShape(
  record: z.infer<typeof assetRecordBase> & {
    fromClub: z.infer<typeof clubSchema>;
    toClub: z.infer<typeof clubSchema>;
  },
  context: z.RefinementCtx
): void {
  const isPlayer = record.assetKind === 'player';
  const isPick = record.assetKind === 'current_pick' || record.assetKind === 'future_pick';
  if (
    record.recordId !== record.assetVersionId ||
    (record.player !== null) !== isPlayer ||
    (record.pick !== null) !== isPick ||
    record.fromClub.clubId === record.toClub.clubId
  ) {
    context.addIssue({ code: 'custom', message: 'Directed asset shape is invalid.' });
  }
}

const transferRecordSchema = assetRecordBase
  .extend({ recordKind: z.literal('transfer'), fromClub: clubSchema, toClub: clubSchema })
  .strict()
  .superRefine(validateAssetShape);
const draftPlayerAssetRecordSchema = assetRecordBase
  .extend({
    recordKind: z.literal('draft_player_asset'),
    assetKind: z.literal('player'),
    player: playerSchema,
    pick: z.null(),
    club: clubSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.recordId !== record.assetVersionId) {
      context.addIssue({ code: 'custom', message: 'Draft player asset identity is invalid.' });
    }
  });

const draftSelectionRecordSchema = z
  .object({
    recordKind: z.literal('draft_selection'),
    recordId: boundedIdSchema,
    selectionId: boundedIdSchema,
    eventVersionId: boundedIdSchema,
    selectionNumber: z.number().int().positive(),
    pickId: boundedIdSchema.nullable(),
    player: playerSchema,
    club: clubSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.recordId !== record.selectionId) {
      context.addIssue({ code: 'custom', message: 'Draft selection identity is invalid.' });
    }
  });

const pickCustodyRecordSchema = z
  .object({
    recordKind: z.literal('pick_custody'),
    recordId: boundedIdSchema,
    custodyObservationId: boundedIdSchema,
    pickId: boundedIdSchema,
    observedAt: instantSchema,
    draftSeasonYear: seasonSchema,
    draftKind: z.string().trim().min(1).max(80),
    recordedRound: z.number().int().positive().nullable(),
    recordedPick: z.number().int().positive().nullable(),
    originalClub: clubSchema,
    currentClub: clubSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.recordId !== record.custodyObservationId) {
      context.addIssue({ code: 'custom', message: 'Pick custody identity is invalid.' });
    }
  });

const pickRealizationRecordSchema = z
  .object({
    recordKind: z.literal('pick_realization'),
    recordId: boundedIdSchema,
    realizationId: boundedIdSchema,
    pickId: boundedIdSchema,
    transferAssetVersionId: boundedIdSchema,
    draftSelectionId: boundedIdSchema,
    relationKind: z.literal('exercised_as'),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.recordId !== record.realizationId) {
      context.addIssue({ code: 'custom', message: 'Pick realization identity is invalid.' });
    }
  });

export const aflTradePromotionBackedPublicArchiveRecordInputSchema = z.discriminatedUnion(
  'recordKind',
  [
    transactionRecordSchema,
    transferRecordSchema,
    draftEventRecordSchema,
    draftSelectionRecordSchema,
    draftPlayerAssetRecordSchema,
    pickCustodyRecordSchema,
    pickRealizationRecordSchema,
  ]
);
export type AflTradePromotionBackedPublicArchiveRecordInput = z.infer<
  typeof aflTradePromotionBackedPublicArchiveRecordInputSchema
>;

export const aflTradePromotionBackedPublicArchiveRecordSchema = z
  .object({
    ordinal: z.number().int().positive().max(1_000_000),
    canonicalRecordSha256: aflTradeSha256Schema,
    recordSha256: aflTradeSha256Schema,
    record: aflTradePromotionBackedPublicArchiveRecordInputSchema,
  })
  .strict()
  .superRefine((row, context) => {
    const expected = sha256AflTradeCanonicalJson({
      schemaVersion: AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_RECORD_SCHEMA_VERSION,
      recordKind: row.record.recordKind,
      canonicalRecordSha256: row.canonicalRecordSha256,
      record: row.record,
    });
    if (row.recordSha256 !== expected) {
      context.addIssue({ code: 'custom', message: 'Public archive record digest mismatch.' });
    }
  });

const recordCountsSchema = z
  .object({
    transaction: z.number().int().nonnegative(),
    transfer: z.number().int().nonnegative(),
    draft_event: z.number().int().nonnegative(),
    draft_selection: z.number().int().nonnegative(),
    draft_player_asset: z.number().int().nonnegative(),
    pick_custody: z.number().int().nonnegative(),
    pick_realization: z.number().int().nonnegative(),
  })
  .strict();

function emptyCounts(): z.infer<typeof recordCountsSchema> {
  return {
    transaction: 0,
    transfer: 0,
    draft_event: 0,
    draft_selection: 0,
    draft_player_asset: 0,
    pick_custody: 0,
    pick_realization: 0,
  };
}

function rowKey(record: AflTradePromotionBackedPublicArchiveRecordInput): string {
  return `${record.recordKind}\0${record.recordId}`;
}

function validateRecordClosure(
  records: readonly AflTradePromotionBackedPublicArchiveRecordInput[],
  context: z.RefinementCtx
): void {
  const transactions = new Map(
    records
      .filter(
        (record): record is z.infer<typeof transactionRecordSchema> =>
          transactionRecordSchema.safeParse(record).success
      )
      .map((record) => [record.eventVersionId, record])
  );
  const draftEvents = new Map(
    records
      .filter(
        (record): record is z.infer<typeof draftEventRecordSchema> =>
          draftEventRecordSchema.safeParse(record).success
      )
      .map((record) => [record.eventVersionId, record])
  );
  const transfers = new Map(
    records
      .filter(
        (record): record is z.infer<typeof transferRecordSchema> =>
          transferRecordSchema.safeParse(record).success
      )
      .map((record) => [record.assetVersionId, record])
  );
  const selections = new Map(
    records
      .filter(
        (record): record is z.infer<typeof draftSelectionRecordSchema> =>
          draftSelectionRecordSchema.safeParse(record).success
      )
      .map((record) => [record.selectionId, record])
  );

  for (const record of records) {
    if (record.recordKind === 'transfer') {
      const transaction = transactions.get(record.eventVersionId);
      const partyIds = new Set(transaction?.parties.map(({ club }) => club.clubId) ?? []);
      if (
        transaction === undefined ||
        !partyIds.has(record.fromClub.clubId) ||
        !partyIds.has(record.toClub.clubId)
      ) {
        context.addIssue({ code: 'custom', message: 'Transfer has no exact transaction parties.' });
      }
    } else if (record.recordKind === 'draft_player_asset') {
      const matchingSelection = [...selections.values()].find(
        (selection) =>
          selection.eventVersionId === record.eventVersionId &&
          selection.player.playerId === record.player.playerId &&
          selection.club.clubId === record.club.clubId
      );
      if (!draftEvents.has(record.eventVersionId) || !matchingSelection) {
        context.addIssue({
          code: 'custom',
          message: 'Draft player asset has no exact draft event and selection.',
        });
      }
    } else if (record.recordKind === 'draft_selection') {
      if (!draftEvents.has(record.eventVersionId)) {
        context.addIssue({ code: 'custom', message: 'Draft selection has no draft event.' });
      }
    } else if (record.recordKind === 'pick_realization') {
      const transfer = transfers.get(record.transferAssetVersionId);
      const selection = selections.get(record.draftSelectionId);
      if (transfer?.pick?.pickId !== record.pickId || selection?.pickId !== record.pickId) {
        context.addIssue({ code: 'custom', message: 'Pick realization endpoints do not close.' });
      }
    }
  }
}

const archiveContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    scopeKey: boundedIdSchema,
    competition: z.string().trim().min(1).max(40),
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    createdAt: instantSchema,
    effectiveThrough: instantSchema,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    recordCount: z.number().int().positive().max(1_000_000),
    recordCounts: recordCountsSchema,
    recordSetSha256: aflTradeSha256Schema,
    records: z.array(aflTradePromotionBackedPublicArchiveRecordSchema).min(1).max(1_000_000),
  })
  .strict()
  .superRefine((archive, context) => {
    const keys = archive.records.map(({ record }) => rowKey(record));
    const counts = emptyCounts();
    archive.records.forEach(({ record }) => counts[record.recordKind]++);
    const canonicalMembers = archive.records.map(({ ordinal, canonicalRecordSha256, record }) => ({
      ordinal,
      recordKind: record.recordKind,
      canonicalRecordId: record.recordId,
      canonicalRecordSha256,
    }));
    if (
      archive.validThroughSeason < archive.validFromSeason ||
      Date.parse(archive.effectiveThrough) > Date.parse(archive.createdAt) ||
      new Set(keys).size !== keys.length ||
      keys.some((key, index) => index > 0 && keys[index - 1]! > key) ||
      archive.records.some(({ ordinal }, index) => ordinal !== index + 1) ||
      archive.recordCount !== archive.records.length ||
      sha256AflTradeCanonicalJson(counts) !== sha256AflTradeCanonicalJson(archive.recordCounts) ||
      archive.canonicalMemberSetSha256 !== sha256AflTradeCanonicalJson(canonicalMembers) ||
      archive.recordSetSha256 !== sha256AflTradeCanonicalJson(archive.records)
    ) {
      context.addIssue({ code: 'custom', message: 'Public archive set closure is invalid.' });
    }
    validateRecordClosure(
      archive.records.map(({ record }) => record),
      context
    );
  });

export const aflTradePromotionBackedPublicArchiveSchema = z
  .object({
    archiveId: aflTradeContentAddressedIdSchema('public-factual-archive'),
    content: archiveContentSchema,
  })
  .strict()
  .superRefine((archive, context) => {
    addAflTradeContentAddressIssue(
      'public-factual-archive',
      archive.archiveId,
      archive.content,
      context,
      ['archiveId']
    );
  });

export type AflTradePromotionBackedPublicArchive = z.infer<
  typeof aflTradePromotionBackedPublicArchiveSchema
>;

export function createAflTradePromotionBackedPublicArchive(input: {
  candidate: AflTradePromotionBackedFactualCandidate;
  createdAt: string;
  records: readonly AflTradePromotionBackedPublicArchiveRecordInput[];
}): AflTradePromotionBackedPublicArchive {
  const candidate = parseAflTradePromotionBackedFactualCandidate(input.candidate);
  const release = candidate.content.targetReleaseManifest;
  if (Date.parse(input.createdAt) < Date.parse(candidate.content.createdAt)) {
    throw new TypeError('Public archive cannot predate its finalized factual candidate.');
  }
  const parsedRecords = z
    .array(aflTradePromotionBackedPublicArchiveRecordInputSchema)
    .min(1)
    .max(1_000_000)
    .parse(input.records)
    .sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
  const candidateMembers = release.content.canonicalMembers;
  const candidateMemberByKey = new Map(
    candidateMembers.map((member) => [`${member.recordKind}\0${member.canonicalRecordId}`, member])
  );
  const recordKeys = parsedRecords.map(rowKey);
  const candidateKeys = candidateMembers.map(
    ({ recordKind, canonicalRecordId }) => `${recordKind}\0${canonicalRecordId}`
  );
  if (
    recordKeys.length !== candidateKeys.length ||
    recordKeys.some((key, index) => key !== candidateKeys[index])
  ) {
    throw new TypeError('Public archive rows must exactly cover the canonical candidate members.');
  }
  const records = parsedRecords.map((record, index) => {
    const member = candidateMemberByKey.get(rowKey(record));
    if (!member) throw new TypeError('Public archive canonical member lookup failed.');
    return {
      ordinal: index + 1,
      canonicalRecordSha256: member.canonicalRecordSha256,
      recordSha256: sha256AflTradeCanonicalJson({
        schemaVersion: AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_RECORD_SCHEMA_VERSION,
        recordKind: record.recordKind,
        canonicalRecordSha256: member.canonicalRecordSha256,
        record,
      }),
      record,
    };
  });
  const publicCanonicalMembers = records.map(({ ordinal, canonicalRecordSha256, record }) => ({
    ordinal,
    recordKind: record.recordKind,
    canonicalRecordId: record.recordId,
    canonicalRecordSha256,
  }));
  if (
    sha256AflTradeCanonicalJson(publicCanonicalMembers) !==
    candidate.content.canonicalMemberSetSha256
  ) {
    throw new TypeError('Public archive canonical membership digest does not match its candidate.');
  }
  const counts = emptyCounts();
  parsedRecords.forEach(({ recordKind }) => counts[recordKind]++);
  const content = archiveContentSchema.parse({
    schemaVersion: AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_PROMOTION_BACKED_PUBLIC_ARCHIVE_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: release.content.environment,
    scopeKey: release.content.scopeKey,
    competition: release.content.competition,
    validFromSeason: release.content.validFromSeason,
    validThroughSeason: release.content.validThroughSeason,
    createdAt: input.createdAt,
    effectiveThrough: release.content.effectiveThrough,
    releaseId: release.releaseId,
    factualCandidateId: candidate.candidateId,
    corpusId: candidate.content.corpusId,
    sourceMemberSetSha256: candidate.content.sourceMemberSetSha256,
    canonicalMemberSetSha256: candidate.content.canonicalMemberSetSha256,
    recordCount: records.length,
    recordCounts: counts,
    recordSetSha256: sha256AflTradeCanonicalJson(records),
    records,
  });
  return aflTradePromotionBackedPublicArchiveSchema.parse({
    archiveId: createAflTradeContentAddress('public-factual-archive', content),
    content,
  });
}

export function parseAflTradePromotionBackedPublicArchive(
  input: unknown
): AflTradePromotionBackedPublicArchive {
  return aflTradePromotionBackedPublicArchiveSchema.parse(input);
}
