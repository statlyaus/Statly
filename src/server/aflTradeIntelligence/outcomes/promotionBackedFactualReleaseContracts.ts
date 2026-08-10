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
  AFL_TRADE_PROMOTION_BACKED_CORPUS_SCHEMA_VERSION,
  aflTradePromotionBackedCorpusSchema,
  type AflTradePromotionBackedCorpus,
} from '../artifacts/promotionBackedCorpusContracts';

export const AFL_TRADE_PROMOTION_BACKED_FACTUAL_RELEASE_SCHEMA_VERSION =
  'afl-draft-trade-factual-release/v3' as const;
export const AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-factual-release-candidate/v4' as const;
export const AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_AUTHORITY_BOUNDARY =
  'private_promotion_backed_candidate_requires_registry_validation_and_activation' as const;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const environmentSchema = z.enum(['test_fixture', 'non_production', 'production']);
const boundedIdSchema = z.string().trim().min(1).max(1_000);
const seasonSchema = z.number().int().min(1897).max(2200);
const promotionIdSchema = aflTradeContentAddressedIdSchema('external-canonical-promotion');
const recordKindSchema = z.enum([
  'transaction',
  'transfer',
  'draft_event',
  'draft_selection',
  'draft_player_asset',
  'pick_custody',
  'pick_realization',
]);

const sourceCaptureSchema = z
  .object({
    captureId: boundedIdSchema,
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    gateDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    recordSha256: aflTradeSha256Schema,
    recordedAt: instantSchema,
  })
  .strict();

const promotionSourceSchema = z
  .object({
    promotionId: promotionIdSchema,
    captureIds: z.array(boundedIdSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (
      new Set(mapping.captureIds).size !== mapping.captureIds.length ||
      mapping.captureIds.some(
        (captureId, index) => index > 0 && mapping.captureIds[index - 1]! > captureId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['captureIds'],
        message: 'Promotion source capture IDs must be unique and sorted.',
      });
    }
  });

const canonicalMemberInputSchema = z
  .object({
    recordKind: recordKindSchema,
    canonicalRecordId: boundedIdSchema,
    canonicalRecordSha256: aflTradeSha256Schema,
  })
  .strict();
const canonicalMemberSchema = canonicalMemberInputSchema
  .extend({ ordinal: z.number().int().positive().max(1_000_000) })
  .strict();

function canonicalMemberKey(member: z.infer<typeof canonicalMemberInputSchema>): string {
  return `${member.recordKind}\0${member.canonicalRecordId}`;
}

function emptyRecordCounts(): Record<z.infer<typeof recordKindSchema>, number> {
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

const factualReleaseContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_FACTUAL_RELEASE_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal('registry_validation_and_activation_required'),
    environment: environmentSchema,
    scopeKey: boundedIdSchema,
    competition: z.string().trim().min(1).max(40),
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    createdAt: instantSchema,
    effectiveThrough: instantSchema,
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    corpusSha256: aflTradeSha256Schema,
    corpusSchemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_CORPUS_SCHEMA_VERSION),
    sourceMemberSetSha256: aflTradeSha256Schema,
    memberCount: z.number().int().positive(),
    sourceRecordCounts: recordCountsSchema,
    canonicalMembers: z.array(canonicalMemberSchema).min(1).max(1_000_000),
    canonicalMemberCount: z.number().int().positive(),
    canonicalMemberSetSha256: aflTradeSha256Schema,
    canonicalRecordCounts: recordCountsSchema,
    sourceCaptures: z.array(sourceCaptureSchema).min(1).max(100_000),
    sourceCaptureSetSha256: aflTradeSha256Schema,
    promotionSources: z.array(promotionSourceSchema).min(1).max(100_000),
    promotionSourceSetSha256: aflTradeSha256Schema,
    factualCandidateSchemaVersion: z.literal(
      AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_SCHEMA_VERSION
    ),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.corpusId !== `corpus:${content.corpusSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['corpusSha256'],
        message: 'Corpus content address mismatch.',
      });
    }
    const captureIds = content.sourceCaptures.map(({ captureId }) => captureId);
    if (
      new Set(captureIds).size !== captureIds.length ||
      captureIds.some((captureId, index) => index > 0 && captureIds[index - 1]! > captureId) ||
      content.sourceCaptureSetSha256 !== sha256AflTradeCanonicalJson(content.sourceCaptures)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCaptures'],
        message: 'Source captures must be unique, sorted, and exactly sealed.',
      });
    }
    const canonicalKeys = content.canonicalMembers.map(canonicalMemberKey);
    if (
      new Set(canonicalKeys).size !== canonicalKeys.length ||
      canonicalKeys.some((key, index) => index > 0 && canonicalKeys[index - 1]! > key) ||
      content.canonicalMembers.some(({ ordinal }, index) => ordinal !== index + 1) ||
      content.canonicalMemberCount !== content.canonicalMembers.length ||
      content.canonicalMemberSetSha256 !== sha256AflTradeCanonicalJson(content.canonicalMembers)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalMembers'],
        message: 'Canonical members must be unique, sorted, contiguous, and exactly sealed.',
      });
    }
    const canonicalCounts = emptyRecordCounts();
    content.canonicalMembers.forEach(({ recordKind }) => canonicalCounts[recordKind]++);
    if (
      sha256AflTradeCanonicalJson(canonicalCounts) !==
      sha256AflTradeCanonicalJson(content.canonicalRecordCounts)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalRecordCounts'],
        message: 'Canonical member counts do not match the exact typed set.',
      });
    }
    const promotionIds = content.promotionSources.map(({ promotionId }) => promotionId);
    if (
      new Set(promotionIds).size !== promotionIds.length ||
      promotionIds.some(
        (promotionId, index) => index > 0 && promotionIds[index - 1]! > promotionId
      ) ||
      content.promotionSourceSetSha256 !== sha256AflTradeCanonicalJson(content.promotionSources)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['promotionSources'],
        message: 'Promotion source mappings must be unique, sorted, and exactly sealed.',
      });
    }
    const referencedCaptureIds = new Set(
      content.promotionSources.flatMap(({ captureIds: ids }) => ids)
    );
    if (
      referencedCaptureIds.size !== captureIds.length ||
      captureIds.some((captureId) => !referencedCaptureIds.has(captureId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['promotionSources'],
        message: 'Promotion ancestry must reference every sealed source capture.',
      });
    }
    if (
      content.validThroughSeason < content.validFromSeason ||
      Date.parse(content.effectiveThrough) > Date.parse(content.createdAt)
    ) {
      context.addIssue({ code: 'custom', message: 'Factual release chronology is invalid.' });
    }
    if (
      content.sourceCaptures.some(
        ({ recordedAt }) => Date.parse(recordedAt) > Date.parse(content.effectiveThrough)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCaptures'],
        message: 'A source capture cannot be known after the release cutoff.',
      });
    }
  });

export const aflTradePromotionBackedFactualReleaseSchema = z
  .object({
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    content: factualReleaseContentSchema,
  })
  .strict()
  .superRefine((release, context) => {
    addAflTradeContentAddressIssue('outcome-release', release.releaseId, release.content, context, [
      'releaseId',
    ]);
  });

const factualCandidateContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    createdAt: instantSchema,
    targetReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    targetReleaseSha256: aflTradeSha256Schema,
    targetReleaseManifest: aflTradePromotionBackedFactualReleaseSchema,
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    corpusSha256: aflTradeSha256Schema,
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    sourceCaptureSetSha256: aflTradeSha256Schema,
    promotionSourceSetSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((candidate, context) => {
    const release = candidate.targetReleaseManifest;
    if (
      candidate.targetReleaseId !== release.releaseId ||
      candidate.targetReleaseId !== `outcome-release:${candidate.targetReleaseSha256}` ||
      candidate.corpusId !== release.content.corpusId ||
      candidate.corpusSha256 !== release.content.corpusSha256 ||
      candidate.sourceMemberSetSha256 !== release.content.sourceMemberSetSha256 ||
      candidate.canonicalMemberSetSha256 !== release.content.canonicalMemberSetSha256 ||
      candidate.sourceCaptureSetSha256 !== release.content.sourceCaptureSetSha256 ||
      candidate.promotionSourceSetSha256 !== release.content.promotionSourceSetSha256 ||
      candidate.createdAt !== release.content.createdAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetReleaseManifest'],
        message: 'Private candidate must bind the exact promotion-backed factual release.',
      });
    }
  });

export const aflTradePromotionBackedFactualCandidateSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    candidateSha256: aflTradeSha256Schema,
    content: factualCandidateContentSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    addAflTradeContentAddressIssue(
      'factual-release-candidate',
      candidate.candidateId,
      candidate.content,
      context,
      ['candidateId']
    );
    if (candidate.candidateId !== `factual-release-candidate:${candidate.candidateSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['candidateSha256'],
        message: 'Candidate content address mismatch.',
      });
    }
  });

export type AflTradePromotionBackedFactualRelease = z.infer<
  typeof aflTradePromotionBackedFactualReleaseSchema
>;
export type AflTradePromotionBackedFactualCandidate = z.infer<
  typeof aflTradePromotionBackedFactualCandidateSchema
>;

export function createAflTradePromotionBackedFactualRelease(input: {
  corpus: AflTradePromotionBackedCorpus;
  scopeKey: string;
  createdAt: string;
  effectiveThrough: string;
  sourceCaptures: readonly z.input<typeof sourceCaptureSchema>[];
  promotionSources: readonly z.input<typeof promotionSourceSchema>[];
  canonicalMembers: readonly z.input<typeof canonicalMemberInputSchema>[];
}) {
  const corpus = aflTradePromotionBackedCorpusSchema.parse(input.corpus);
  const sourceCaptures = z
    .array(sourceCaptureSchema)
    .parse(input.sourceCaptures)
    .sort((left, right) => left.captureId.localeCompare(right.captureId));
  const promotionSources = z
    .array(promotionSourceSchema)
    .parse(
      input.promotionSources.map((mapping) => ({
        ...mapping,
        captureIds: [...mapping.captureIds].sort(),
      }))
    )
    .sort((left, right) => left.promotionId.localeCompare(right.promotionId));
  const canonicalMemberInputs = z
    .array(canonicalMemberInputSchema)
    .parse(input.canonicalMembers)
    .sort((left, right) => canonicalMemberKey(left).localeCompare(canonicalMemberKey(right)));
  const canonicalMembers = canonicalMemberInputs.map((member, index) => ({
    ordinal: index + 1,
    ...member,
  }));
  const expectedCanonicalKeys = [
    ...new Set(
      corpus.content.members.map(({ recordKind, canonicalRecordId }) =>
        canonicalMemberKey({ recordKind, canonicalRecordId, canonicalRecordSha256: '0'.repeat(64) })
      )
    ),
  ].sort();
  const actualCanonicalKeys = canonicalMemberInputs.map(canonicalMemberKey);
  if (
    expectedCanonicalKeys.length !== actualCanonicalKeys.length ||
    expectedCanonicalKeys.some((key, index) => actualCanonicalKeys[index] !== key)
  ) {
    throw new TypeError(
      'Canonical member set must cover every and only the corpus canonical record identity.'
    );
  }
  const expectedPromotions = corpus.content.promotions.map(({ promotionId }) => promotionId);
  if (
    expectedPromotions.length !== promotionSources.length ||
    expectedPromotions.some(
      (promotionId, index) => promotionSources[index]?.promotionId !== promotionId
    )
  ) {
    throw new TypeError(
      'Promotion source ancestry must cover every and only the corpus promotion.'
    );
  }
  if (input.effectiveThrough !== corpus.content.knowledgeCutoffAt) {
    throw new TypeError('Factual release cutoff must equal the canonical corpus knowledge cutoff.');
  }
  if (Date.parse(input.createdAt) < Date.parse(corpus.content.createdAt)) {
    throw new TypeError('Factual release chronology cannot predate its canonical corpus.');
  }
  const canonicalRecordCounts = emptyRecordCounts();
  canonicalMembers.forEach(({ recordKind }) => canonicalRecordCounts[recordKind]++);
  const content = factualReleaseContentSchema.parse({
    schemaVersion: AFL_TRADE_PROMOTION_BACKED_FACTUAL_RELEASE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: 'registry_validation_and_activation_required',
    environment: corpus.content.environment,
    scopeKey: input.scopeKey,
    competition: corpus.content.competition,
    validFromSeason: corpus.content.anchorSeasonRange.from,
    validThroughSeason: corpus.content.anchorSeasonRange.through,
    createdAt: input.createdAt,
    effectiveThrough: input.effectiveThrough,
    corpusId: corpus.corpusId,
    corpusSha256: corpus.corpusId.slice('corpus:'.length),
    corpusSchemaVersion: corpus.content.schemaVersion,
    sourceMemberSetSha256: corpus.content.memberSetSha256,
    memberCount: corpus.content.memberCount,
    sourceRecordCounts: corpus.content.recordCounts,
    canonicalMembers,
    canonicalMemberCount: canonicalMembers.length,
    canonicalMemberSetSha256: sha256AflTradeCanonicalJson(canonicalMembers),
    canonicalRecordCounts,
    sourceCaptures,
    sourceCaptureSetSha256: sha256AflTradeCanonicalJson(sourceCaptures),
    promotionSources,
    promotionSourceSetSha256: sha256AflTradeCanonicalJson(promotionSources),
    factualCandidateSchemaVersion: AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_SCHEMA_VERSION,
  });
  const release = aflTradePromotionBackedFactualReleaseSchema.parse({
    releaseId: createAflTradeContentAddress('outcome-release', content),
    content,
  });
  const candidateContent = factualCandidateContentSchema.parse({
    schemaVersion: AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    createdAt: input.createdAt,
    targetReleaseId: release.releaseId,
    targetReleaseSha256: release.releaseId.slice('outcome-release:'.length),
    targetReleaseManifest: release,
    corpusId: corpus.corpusId,
    corpusSha256: corpus.corpusId.slice('corpus:'.length),
    sourceMemberSetSha256: corpus.content.memberSetSha256,
    canonicalMemberSetSha256: content.canonicalMemberSetSha256,
    sourceCaptureSetSha256: content.sourceCaptureSetSha256,
    promotionSourceSetSha256: content.promotionSourceSetSha256,
  });
  const candidateId = createAflTradeContentAddress('factual-release-candidate', candidateContent);
  return {
    corpus,
    release,
    candidate: aflTradePromotionBackedFactualCandidateSchema.parse({
      candidateId,
      candidateSha256: candidateId.slice('factual-release-candidate:'.length),
      content: candidateContent,
    }),
  };
}

export function parseAflTradePromotionBackedFactualRelease(input: unknown) {
  return aflTradePromotionBackedFactualReleaseSchema.parse(input);
}

export function parseAflTradePromotionBackedFactualCandidate(input: unknown) {
  return aflTradePromotionBackedFactualCandidateSchema.parse(input);
}
