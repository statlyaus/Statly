import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeProviderDecodedRowCandidate } from '../source/fitzRoyObservationNormalizer';
import {
  AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
  AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
  AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
  createAflTradeSourceFact,
  createAflTradeSourceFactBatch,
  type AflTradeSourceFactBatch,
  type AflTradeSourceFactBatchContent,
  type AflTradeSourceFactContent,
} from './factualObservationContracts';

type MatchFact = Extract<AflTradeSourceFactContent, { factKind: 'match_universe' }>;
type RowAccounting = AflTradeSourceFactBatchContent['rowAccounting'][number];
type BatchSource = Omit<
  AflTradeSourceFactBatchContent,
  | 'schemaVersion'
  | 'publicAssetBoundary'
  | 'authorityBoundary'
  | 'publicationEligible'
  | 'createdAt'
  | 'facts'
  | 'rowAccounting'
  | 'counts'
>;

export interface AflTradeRetainedFitzRoyResultsFactBatchInput {
  /** Exact finalized normalization header, including expected full row/issue digests. */
  source: BatchSource;
  completionPolicy: MatchFact['completionPolicy'];
  createdAt: string;
  rows: readonly {
    row: AflTradeProviderDecodedRowCandidate;
    match: MatchFact['match'];
    issues: Pick<
      RowAccounting,
      'issueSet' | 'issueIds' | 'blockingIssueIds' | 'blockingIssueClosures'
    >;
    effectiveAt: string;
    consumedSourceFields: readonly string[];
    /** Explicit evidence under the supplied policy, never inferred from staged status. */
    completion: MatchFact['completion'];
  }[];
}

/**
 * Structural assembly of retained results evidence, not source authorization,
 * resolution currentness, policy approval, or reconciliation. Those remain the
 * persistence owners' responsibility. Raw decoded values are never rewritten;
 * canonical effective dates and completion outcomes must be supplied explicitly.
 */
export function createAflTradeRetainedFitzRoyResultsFactBatch(
  input: AflTradeRetainedFitzRoyResultsFactBatchInput
): AflTradeSourceFactBatch {
  const { source } = input;
  if (source.provider !== 'afl_tables' || source.capabilityId !== 'afl-tables-results') {
    throw new Error('Retained results assembly requires the exact AFL Tables results capability.');
  }
  const assembled = input.rows.map(
    ({ row, match, issues, effectiveAt, consumedSourceFields, completion }) => {
      const candidate = row.matchCandidate;
      if (
        !candidate ||
        candidate.provider !== source.provider ||
        candidate.candidateId !== match.matchCandidateId ||
        row.competition !== source.competition ||
        row.seasonYear !== source.seasonYear ||
        row.identityCandidate !== null ||
        row.metricCandidates.length !== 0 ||
        row.achievementCandidate !== null ||
        row.appearanceCandidate ||
        row.semanticNaturalKeySha256 === null
      ) {
        throw new Error(
          'Each retained results row requires its exact match candidate and results-only source scope.'
        );
      }
      if (!completion || completion.providerStatus !== candidate.providerStatus) {
        throw new Error(
          'Explicit completion evidence must preserve the retained provider status, including null.'
        );
      }
      if (consumedSourceFields.some((field) => !Object.hasOwn(row.typedPayload, field))) {
        throw new Error('Consumed factual fields must exist in the exact retained decoded row.');
      }
      const fact = createAflTradeSourceFact({
        schemaVersion: AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
        publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
        authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
        publicationEligible: false,
        environment: source.environment,
        provider: source.provider,
        capabilityId: source.capabilityId,
        competition: source.competition,
        seasonYear: source.seasonYear,
        fieldMapSha256: source.fieldMapSha256,
        effectiveAt,
        recordedAt: input.createdAt,
        source: {
          captureId: source.captureId,
          normalizationRunId: source.normalizationRunId,
          normalizationFinalization: source.normalizationFinalization,
          normalizationFinalizedAt: source.normalizationFinalizedAt,
          stagingSha256: source.stagingSha256,
          providerDecodedRowId: row.providerDecodedRowId,
          sourceRowNumber: row.sourceRowNumber,
          sourceRowSha256: row.sourceRowSha256,
          semanticNaturalKeySha256: row.semanticNaturalKeySha256,
          candidateDigests: {
            identity: null,
            match: sha256AflTradeCanonicalJson(candidate),
            metric: null,
            achievement: null,
            appearance: null,
          },
          rowStatus: row.rowStatus,
          issueSet: issues.issueSet,
          blockingIssueCount: issues.blockingIssueIds.length,
          openBlockingIssueCount:
            issues.blockingIssueIds.length - issues.blockingIssueClosures.length,
          blockingIssueClosures: issues.blockingIssueClosures,
          consumedSourceFields,
        },
        factKind: 'match_universe',
        matchCandidateId: candidate.candidateId,
        match,
        completionPolicy: input.completionPolicy,
        completion,
      });
      const accounting: RowAccounting = {
        providerDecodedRowId: row.providerDecodedRowId,
        sourceRowSha256: row.sourceRowSha256,
        disposition: 'normalized',
        factIds: [fact.factId],
        ...issues,
        reasonCode: null,
      };
      return { fact, accounting };
    }
  );
  return createAflTradeSourceFactBatch({
    ...source,
    schemaVersion: AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    createdAt: input.createdAt,
    facts: assembled
      .map(({ fact }) => fact)
      .sort((a, b) => (a.factId < b.factId ? -1 : a.factId > b.factId ? 1 : 0)),
    rowAccounting: assembled
      .map(({ accounting }) => accounting)
      .sort((a, b) =>
        a.providerDecodedRowId < b.providerDecodedRowId
          ? -1
          : a.providerDecodedRowId > b.providerDecodedRowId
            ? 1
            : 0
      ),
    counts: {
      matchUniverse: assembled.length,
      playerAppearances: 0,
      playerMatchMetrics: 0,
      playerSeasonMetrics: 0,
      playerAchievements: 0,
      normalizedRows: assembled.length,
      nonNormalizedRows: 0,
    },
  });
}
