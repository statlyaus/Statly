import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';

export const AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION = 'afl-trade-external-evidence/v1' as const;
export const AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION =
  'afl-trade-external-evidence-batch/v1' as const;

const boundedText = z.string().trim().min(1).max(500);
const nullableBoundedText = boundedText.nullable();
const yearSchema = z.number().int().min(1897).max(2200);
const positiveOrdinalSchema = z.number().int().positive().max(100_000);
const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid UTC instant.');
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), 'Invalid date.');
const draftTypeSchema = z.enum([
  'national',
  'rookie',
  'pre_season',
  'mid_season',
  'mini_draft',
  'other',
]);
const providerSchema = z.enum([
  'statly_local_fixture',
  'draftguru',
  'footywire',
  'official_afl',
  'fitzroy_official_afl_player_details',
]);

const sourceUrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .superRefine((value, context) => {
    if (value.startsWith('fixture://statly/')) return;
    if (value.startsWith('fitzroy://')) return;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return;
    } catch {
      // Report the stable domain error below.
    }
    context.addIssue({
      code: 'custom',
      message: 'Source URL must use HTTPS or the internal fitzroy scheme.',
    });
  });

const sourceCaptureSchema = z
  .object({
    captureId: aflTradeContentAddressedIdSchema('source-capture'),
    artifactId: aflTradeContentAddressedIdSchema('artifact'),
    contentSha256: aflTradeSha256Schema,
    mediaType: z.string().trim().min(1).max(160),
    sourceUrl: sourceUrlSchema,
    capturedAt: instantSchema,
    effectiveAt: instantSchema,
    parserVersion: z.string().trim().min(1).max(160),
    fieldManifestSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((capture, context) => {
    if (capture.artifactId !== `artifact:${capture.contentSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['artifactId'],
        message: 'Artifact ID must bind the exact captured content digest.',
      });
    }
    if (Date.parse(capture.effectiveAt) > Date.parse(capture.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveAt'],
        message: 'Source effective time cannot be after capture time.',
      });
    }
  });

const sourceRowSchema = z
  .object({
    ordinal: positiveOrdinalSchema,
    sourceKey: z.string().trim().min(1).max(500),
  })
  .strict();

const recordedEntitySchema = z
  .object({
    nativeId: z.string().trim().min(1).max(240).nullable(),
    recordedName: boundedText,
  })
  .strict();

const transactionClaimSchema = z
  .object({
    kind: z.literal('transaction'),
    nativeEventId: boundedText,
    seasonYear: yearSchema,
    occurredOn: dateSchema.nullable(),
    transactionType: z.enum(['trade', 'free_agency', 'other']),
    title: nullableBoundedText,
  })
  .strict();

const tradeDetailLinkClaimSchema = z
  .object({
    kind: z.literal('trade_detail_link'),
    nativeEventId: boundedText,
    anchorSeasonYear: yearSchema,
    sourceUrl: sourceUrlSchema,
  })
  .strict()
  .superRefine((claim, context) => {
    const url = new URL(claim.sourceUrl);
    const match = /^\/trades\/(\d{4}-[a-z0-9][a-z0-9_'%-]*)$/.exec(url.pathname);
    if (
      url.origin !== 'https://www.draftguru.com.au' ||
      url.search ||
      url.hash ||
      match?.[1] !== claim.nativeEventId ||
      !claim.nativeEventId.startsWith(`${claim.anchorSeasonYear}-`)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Trade-detail discovery evidence must bind one exact Draftguru URL and season.',
      });
    }
  });

const transactionPartyClaimSchema = z
  .object({
    kind: z.literal('transaction_party'),
    nativeEventId: boundedText,
    nativePartyId: boundedText,
    club: recordedEntitySchema,
  })
  .strict();

const currentPickAssetSchema = z
  .object({
    kind: z.literal('current_pick'),
    draftYear: yearSchema,
    draftType: draftTypeSchema,
    recordedPickNumber: positiveOrdinalSchema.nullable().default(null),
    recordedRoundNumber: positiveOrdinalSchema.nullable().optional(),
    recordedLabel: nullableBoundedText.optional(),
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.recordedPickNumber === null && !asset.recordedLabel) {
      context.addIssue({
        code: 'custom',
        message: 'A current-pick claim needs a recorded number or source label.',
      });
    }
  });

const futurePickAssetSchema = z
  .object({
    kind: z.literal('future_pick'),
    draftYear: yearSchema,
    draftType: draftTypeSchema,
    roundNumber: positiveOrdinalSchema,
    originalClub: recordedEntitySchema,
  })
  .strict();

const playerAssetSchema = z
  .object({
    kind: z.literal('player'),
    player: recordedEntitySchema,
  })
  .strict();

const directedTransferClaimSchema = z
  .object({
    kind: z.literal('directed_transfer'),
    nativeEventId: boundedText,
    nativeTransferId: boundedText,
    fromClub: recordedEntitySchema,
    toClub: recordedEntitySchema,
    asset: z.discriminatedUnion('kind', [
      playerAssetSchema,
      currentPickAssetSchema,
      futurePickAssetSchema,
    ]),
  })
  .strict()
  .superRefine((claim, context) => {
    const sameNativeId =
      claim.fromClub.nativeId !== null && claim.fromClub.nativeId === claim.toClub.nativeId;
    const sameRecordedName =
      claim.fromClub.nativeId === null &&
      claim.toClub.nativeId === null &&
      claim.fromClub.recordedName.localeCompare(claim.toClub.recordedName, undefined, {
        sensitivity: 'base',
      }) === 0;
    if (sameNativeId || sameRecordedName) {
      context.addIssue({
        code: 'custom',
        path: ['toClub'],
        message: 'Directed transfer sides must be distinct.',
      });
    }
  });

const draftSelectionClaimSchema = z
  .object({
    kind: z.literal('draft_selection'),
    draftYear: yearSchema,
    draftType: draftTypeSchema,
    selectionNumber: positiveOrdinalSchema,
    roundNumber: positiveOrdinalSchema.nullable(),
    player: recordedEntitySchema,
    selectedByClub: recordedEntitySchema,
  })
  .strict();

const pickCustodyClaimSchema = z
  .object({
    kind: z.literal('pick_custody'),
    observedAt: instantSchema,
    draftYear: yearSchema,
    draftType: draftTypeSchema,
    roundNumber: positiveOrdinalSchema.nullable(),
    recordedPickNumber: positiveOrdinalSchema.nullable(),
    originalClub: recordedEntitySchema.nullable(),
    currentClub: recordedEntitySchema,
  })
  .strict();

const playerDraftDetailClaimSchema = z
  .object({
    kind: z.literal('player_draft_detail'),
    player: recordedEntitySchema,
    squadSeason: yearSchema,
    squadClub: recordedEntitySchema,
    draftYear: yearSchema.nullable(),
    draftType: draftTypeSchema.nullable(),
    draftPosition: positiveOrdinalSchema.nullable(),
    recruitedFrom: nullableBoundedText,
  })
  .strict()
  .superRefine((claim, context) => {
    const draftFields = [claim.draftYear, claim.draftType, claim.draftPosition];
    const populated = draftFields.filter((value) => value !== null).length;
    if (populated !== 0 && populated !== draftFields.length) {
      context.addIssue({
        code: 'custom',
        message: 'Draft year, type and position must be present together or all unavailable.',
      });
    }
  });

const claimSchema = z.discriminatedUnion('kind', [
  tradeDetailLinkClaimSchema,
  transactionClaimSchema,
  transactionPartyClaimSchema,
  directedTransferClaimSchema,
  draftSelectionClaimSchema,
  pickCustodyClaimSchema,
  playerDraftDetailClaimSchema,
]);

const allowedKindsByProvider = {
  statly_local_fixture: new Set([
    'transaction',
    'transaction_party',
    'directed_transfer',
    'draft_selection',
    'pick_custody',
  ]),
  draftguru: new Set([
    'trade_detail_link',
    'transaction',
    'transaction_party',
    'directed_transfer',
    'draft_selection',
  ]),
  footywire: new Set(['draft_selection']),
  official_afl: new Set(['pick_custody']),
  fitzroy_official_afl_player_details: new Set(['player_draft_detail']),
} as const;

const evidenceContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION),
    provider: providerSchema,
    capture: sourceCaptureSchema,
    sourceRow: sourceRowSchema,
    claim: claimSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((content, context) => {
    const usesLocalFixtureScheme = content.capture.sourceUrl.startsWith('fixture://statly/');
    if ((content.provider === 'statly_local_fixture') !== usesLocalFixtureScheme) {
      context.addIssue({
        code: 'custom',
        path: ['capture', 'sourceUrl'],
        message:
          'The statly_local_fixture provider and fixture://statly/ source scheme must be used together.',
      });
    }
    if (!allowedKindsByProvider[content.provider].has(content.claim.kind)) {
      context.addIssue({
        code: 'custom',
        path: ['claim', 'kind'],
        message: `Claim kind is not permitted for provider ${content.provider}.`,
      });
    }
  });

export type AflTradeExternalEvidenceContent = z.infer<typeof evidenceContentSchema>;

const evidenceEnvelopeSchema = z
  .object({
    evidenceId: aflTradeContentAddressedIdSchema('external-evidence'),
    content: evidenceContentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeContentAddressIssue('external-evidence', value.evidenceId, value.content, context, [
      'evidenceId',
    ]);
  });

export type AflTradeExternalEvidenceEnvelope = z.infer<typeof evidenceEnvelopeSchema>;

export function parseAflTradeExternalEvidenceEnvelope(
  input: unknown
): AflTradeExternalEvidenceEnvelope {
  return evidenceEnvelopeSchema.parse(input);
}

export function createAflTradeExternalEvidenceEnvelope(
  content: AflTradeExternalEvidenceContent
): AflTradeExternalEvidenceEnvelope {
  const parsedContent = evidenceContentSchema.parse(content);
  return evidenceEnvelopeSchema.parse({
    evidenceId: createAflTradeContentAddress('external-evidence', parsedContent),
    content: parsedContent,
  });
}

const batchContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION),
    provider: providerSchema,
    captureId: aflTradeContentAddressedIdSchema('source-capture'),
    evidence: z.array(evidenceEnvelopeSchema).min(1).max(100_000),
    rowCount: z.number().int().positive(),
    rowSetSha256: aflTradeSha256Schema,
    finalizedAt: instantSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((batch, context) => {
    const evidenceIds = new Set<string>();
    const sourceKeys = new Set<string>();
    let priorOrdinal = 0;
    batch.evidence.forEach((evidence, index) => {
      if (evidence.content.provider !== batch.provider) {
        context.addIssue({
          code: 'custom',
          path: ['evidence', index, 'content', 'provider'],
          message: 'Batch provider must match every evidence row.',
        });
      }
      if (evidence.content.capture.captureId !== batch.captureId) {
        context.addIssue({
          code: 'custom',
          path: ['evidence', index, 'content', 'capture', 'captureId'],
          message: 'Batch capture must match every evidence row.',
        });
      }
      if (evidence.content.sourceRow.ordinal <= priorOrdinal) {
        context.addIssue({
          code: 'custom',
          path: ['evidence', index, 'content', 'sourceRow', 'ordinal'],
          message: 'Evidence rows must be ordered by strictly increasing source ordinal.',
        });
      }
      priorOrdinal = evidence.content.sourceRow.ordinal;
      if (evidenceIds.has(evidence.evidenceId)) {
        context.addIssue({
          code: 'custom',
          path: ['evidence', index],
          message: 'Duplicate evidence ID.',
        });
      }
      evidenceIds.add(evidence.evidenceId);
      if (sourceKeys.has(evidence.content.sourceRow.sourceKey)) {
        context.addIssue({
          code: 'custom',
          path: ['evidence', index, 'content', 'sourceRow', 'sourceKey'],
          message: 'Duplicate source row key.',
        });
      }
      sourceKeys.add(evidence.content.sourceRow.sourceKey);
      if (Date.parse(evidence.content.capture.capturedAt) > Date.parse(batch.finalizedAt)) {
        context.addIssue({
          code: 'custom',
          path: ['finalizedAt'],
          message: 'Batch cannot finalize before its captured evidence.',
        });
      }
    });
    if (batch.rowCount !== batch.evidence.length) {
      context.addIssue({
        code: 'custom',
        path: ['rowCount'],
        message: 'Batch row count must account for every evidence row.',
      });
    }
    const expectedRoot = sha256AflTradeCanonicalJson(
      batch.evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        ordinal: evidence.content.sourceRow.ordinal,
        sourceKey: evidence.content.sourceRow.sourceKey,
      }))
    );
    if (batch.rowSetSha256 !== expectedRoot) {
      context.addIssue({
        code: 'custom',
        path: ['rowSetSha256'],
        message: 'Batch row-set digest must bind the complete ordered evidence set.',
      });
    }
  });

export type AflTradeExternalEvidenceBatchContent = z.infer<typeof batchContentSchema>;

const batchEnvelopeSchema = z
  .object({
    batchId: aflTradeContentAddressedIdSchema('external-evidence-batch'),
    content: batchContentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeContentAddressIssue(
      'external-evidence-batch',
      value.batchId,
      value.content,
      context,
      ['batchId']
    );
  });

export type AflTradeExternalEvidenceBatch = z.infer<typeof batchEnvelopeSchema>;

export function parseAflTradeExternalEvidenceBatch(input: unknown): AflTradeExternalEvidenceBatch {
  return batchEnvelopeSchema.parse(input);
}

type CreateBatchInput = Omit<AflTradeExternalEvidenceBatchContent, 'rowCount' | 'rowSetSha256'>;

export function createAflTradeExternalEvidenceBatch(
  input: CreateBatchInput
): AflTradeExternalEvidenceBatch {
  const rowSetSha256 = sha256AflTradeCanonicalJson(
    input.evidence.map((evidence) => ({
      evidenceId: evidence.evidenceId,
      ordinal: evidence.content.sourceRow.ordinal,
      sourceKey: evidence.content.sourceRow.sourceKey,
    }))
  );
  const content = batchContentSchema.parse({
    ...input,
    rowCount: input.evidence.length,
    rowSetSha256,
  });
  return batchEnvelopeSchema.parse({
    batchId: createAflTradeContentAddress('external-evidence-batch', content),
    content,
  });
}
