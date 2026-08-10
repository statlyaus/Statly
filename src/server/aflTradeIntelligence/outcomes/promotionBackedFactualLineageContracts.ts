import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { aflTradePromotionBackedCorpusSchema } from '../artifacts/promotionBackedCorpusContracts';
import {
  aflTradePromotionBackedFactualCandidateSchema,
  aflTradePromotionBackedFactualReleaseSchema,
} from './promotionBackedFactualReleaseContracts';

export const AFL_TRADE_PROMOTION_BACKED_FACTUAL_LINEAGE_SCHEMA_VERSION =
  'afl-trade-corpus-factual-lineage/v2' as const;
export const AFL_TRADE_PROMOTION_BACKED_FACTUAL_LINEAGE_AUTHORITY_BOUNDARY =
  'private_exact_corpus_candidate_lineage_requires_current_gate_2_decision' as const;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const boundedIdSchema = z.string().trim().min(1).max(1_000);
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
const canonicalMemberSchema = z
  .object({
    ordinal: z.number().int().positive().max(1_000_000),
    recordKind: z.enum([
      'transaction',
      'transfer',
      'draft_event',
      'draft_selection',
      'draft_player_asset',
      'pick_custody',
      'pick_realization',
    ]),
    canonicalRecordId: boundedIdSchema,
    canonicalRecordSha256: aflTradeSha256Schema,
  })
  .strict();

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_FACTUAL_LINEAGE_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PROMOTION_BACKED_FACTUAL_LINEAGE_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    scopeKey: boundedIdSchema,
    competition: z.string().trim().min(1).max(40),
    validFromSeason: z.number().int().min(1897).max(2200),
    validThroughSeason: z.number().int().min(1897).max(2200),
    createdAt: instantSchema,
    effectiveThrough: instantSchema,
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    corpusSha256: aflTradeSha256Schema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualReleaseSha256: aflTradeSha256Schema,
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    factualCandidateSha256: aflTradeSha256Schema,
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    sourceCaptureSetSha256: aflTradeSha256Schema,
    sourceCaptures: z.array(sourceCaptureSchema).min(1).max(100_000),
    canonicalMembers: z.array(canonicalMemberSchema).min(1).max(1_000_000),
  })
  .strict()
  .superRefine((lineage, context) => {
    if (
      lineage.corpusId !== `corpus:${lineage.corpusSha256}` ||
      lineage.factualReleaseId !== `outcome-release:${lineage.factualReleaseSha256}` ||
      lineage.factualCandidateId !== `factual-release-candidate:${lineage.factualCandidateSha256}`
    ) {
      context.addIssue({ code: 'custom', message: 'Lineage parent content address mismatch.' });
    }
    const captureIds = lineage.sourceCaptures.map(({ captureId }) => captureId);
    if (
      new Set(captureIds).size !== captureIds.length ||
      captureIds.some((captureId, index) => index > 0 && captureIds[index - 1]! > captureId) ||
      lineage.sourceCaptureSetSha256 !== sha256AflTradeCanonicalJson(lineage.sourceCaptures)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCaptures'],
        message: 'Lineage source captures must be unique, sorted, and exactly sealed.',
      });
    }
    const memberKeys = lineage.canonicalMembers.map(
      ({ recordKind, canonicalRecordId }) => `${recordKind}\0${canonicalRecordId}`
    );
    if (
      new Set(memberKeys).size !== memberKeys.length ||
      memberKeys.some((key, index) => index > 0 && memberKeys[index - 1]! > key) ||
      lineage.canonicalMembers.some(({ ordinal }, index) => ordinal !== index + 1) ||
      lineage.canonicalMemberSetSha256 !== sha256AflTradeCanonicalJson(lineage.canonicalMembers)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalMembers'],
        message:
          'Lineage canonical members must be unique, sorted, contiguous, and exactly sealed.',
      });
    }
    if (
      lineage.validThroughSeason < lineage.validFromSeason ||
      Date.parse(lineage.effectiveThrough) > Date.parse(lineage.createdAt)
    ) {
      context.addIssue({ code: 'custom', message: 'Lineage chronology is invalid.' });
    }
  });

export const aflTradePromotionBackedFactualLineageSchema = z
  .object({
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    content: contentSchema,
  })
  .strict()
  .superRefine((lineage, context) => {
    addAflTradeContentAddressIssue(
      'corpus-factual-lineage',
      lineage.lineageId,
      lineage.content,
      context,
      ['lineageId']
    );
  });

export type AflTradePromotionBackedFactualLineage = z.infer<
  typeof aflTradePromotionBackedFactualLineageSchema
>;

export function createAflTradePromotionBackedFactualLineage(input: {
  corpus: unknown;
  release: unknown;
  candidate: unknown;
  createdAt: string;
}): AflTradePromotionBackedFactualLineage {
  const corpus = aflTradePromotionBackedCorpusSchema.parse(input.corpus);
  const release = aflTradePromotionBackedFactualReleaseSchema.parse(input.release);
  const candidate = aflTradePromotionBackedFactualCandidateSchema.parse(input.candidate);
  if (
    release.content.corpusId !== corpus.corpusId ||
    release.content.corpusSha256 !== corpus.corpusId.split(':')[1] ||
    release.content.sourceMemberSetSha256 !== corpus.content.memberSetSha256 ||
    candidate.content.targetReleaseId !== release.releaseId ||
    candidate.content.targetReleaseManifest.releaseId !== release.releaseId ||
    candidate.content.corpusId !== corpus.corpusId ||
    candidate.content.sourceMemberSetSha256 !== release.content.sourceMemberSetSha256 ||
    candidate.content.canonicalMemberSetSha256 !== release.content.canonicalMemberSetSha256
  ) {
    throw new TypeError('Corpus, factual release, and private candidate ancestry do not match.');
  }
  if (Date.parse(input.createdAt) < Date.parse(candidate.content.createdAt)) {
    throw new TypeError('Factual lineage chronology cannot predate candidate finalization.');
  }
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_PROMOTION_BACKED_FACTUAL_LINEAGE_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PROMOTION_BACKED_FACTUAL_LINEAGE_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: release.content.environment,
    scopeKey: release.content.scopeKey,
    competition: release.content.competition,
    validFromSeason: release.content.validFromSeason,
    validThroughSeason: release.content.validThroughSeason,
    createdAt: input.createdAt,
    effectiveThrough: release.content.effectiveThrough,
    corpusId: corpus.corpusId,
    corpusSha256: corpus.corpusId.split(':')[1],
    factualReleaseId: release.releaseId,
    factualReleaseSha256: release.releaseId.split(':')[1],
    factualCandidateId: candidate.candidateId,
    factualCandidateSha256: candidate.candidateSha256,
    sourceMemberSetSha256: release.content.sourceMemberSetSha256,
    canonicalMemberSetSha256: release.content.canonicalMemberSetSha256,
    sourceCaptureSetSha256: release.content.sourceCaptureSetSha256,
    sourceCaptures: release.content.sourceCaptures,
    canonicalMembers: release.content.canonicalMembers,
  });
  return aflTradePromotionBackedFactualLineageSchema.parse({
    lineageId: createAflTradeContentAddress('corpus-factual-lineage', content),
    content,
  });
}

export function parseAflTradePromotionBackedFactualLineage(
  input: unknown
): AflTradePromotionBackedFactualLineage {
  return aflTradePromotionBackedFactualLineageSchema.parse(input);
}
