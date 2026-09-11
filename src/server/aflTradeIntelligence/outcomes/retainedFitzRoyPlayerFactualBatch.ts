import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import { sha256AflTradeCanonicalJson as digest } from '../artifacts/contentAddress';
import type { AflTradeProviderDecodedRowCandidate } from '../source/fitzRoyObservationNormalizer';
import {
  AFL_TRADE_APPEARANCE_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
  AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
  AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
  createAflTradeProviderAppearanceCandidate,
  createAflTradeSourceFact,
  createAflTradeSourceFactBatch,
  parseAflTradeFactualPlayerResolution,
  parseAflTradeFactualClubResolution,
  type AflTradeSourceFactBatch,
  type AflTradeSourceFactBatchContent,
  type AflTradeSourceFactContent,
} from './factualObservationContracts';

type MatchFact = Extract<AflTradeSourceFactContent, { factKind: 'match_universe' }>;
type AppearanceFact = Extract<AflTradeSourceFactContent, { factKind: 'player_appearance' }>;
type GoalsFact = Extract<AflTradeSourceFactContent, { factKind: 'player_match_metric' }>;
type Accounting = AflTradeSourceFactBatchContent['rowAccounting'][number];
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

export interface AflTradeRetainedFitzRoyPlayerFactBatchInput {
  source: BatchSource;
  completionPolicy: MatchFact['completionPolicy'];
  goalsDefinition?: GoalsFact['definition'];
  createdAt: string;
  rows: readonly {
    row: AflTradeProviderDecodedRowCandidate;
    goalsCandidateSha256?: string;
    match: MatchFact['match'];
    player: AppearanceFact['player'];
    representedClub: AppearanceFact['representedClub'];
    issues: Pick<
      Accounting,
      'issueSet' | 'issueIds' | 'blockingIssueIds' | 'blockingIssueClosures'
    >;
    effectiveAt: string;
    matchSourceFields: readonly string[];
    completion: Extract<MatchFact['completion'], { state: 'quarantined' }>;
    appearance:
      | { state: 'no_appearance_fact' }
      | {
          state: 'observed';
          sourceFields: readonly string[];
          derivationPolicy: AppearanceFact['appearanceCandidate']['content']['derivationPolicy'];
        };
  }[];
}

/** Pure structural assembly. Explicit choices are not policy approval or current authority.
 * No-appearance rows remain accounted for; this does not issue nonparticipant decisions.
 */
export function createAflTradeRetainedFitzRoyPlayerFactBatch(
  input: AflTradeRetainedFitzRoyPlayerFactBatchInput
): AflTradeSourceFactBatch {
  const { source } = input;
  const footy = source.provider === 'footywire' && source.capabilityId === 'footywire-player-stats';
  const tables =
    source.provider === 'afl_tables' && source.capabilityId === 'afl-tables-player-stats';
  if (!footy && !tables) {
    throw new Error('Retained player assembly requires exact Tables or Footy player stats.');
  }
  if (footy) {
    const definition = input.goalsDefinition;
    if (
      !definition ||
      !/^[a-f0-9]{64}$/.test(definition.sha256) ||
      definition.id !== `metric-definition:${definition.sha256}`
    ) {
      throw new Error('Footy goals require an explicit exact immutable metric definition.');
    }
  } else if (input.goalsDefinition !== undefined) {
    throw new Error('Tables appearance-only assembly does not accept a goals definition.');
  }
  const assembled = input.rows.map(
    ({
      row,
      goalsCandidateSha256,
      match,
      player: playerReceipt,
      representedClub: clubReceipt,
      issues,
      effectiveAt,
      matchSourceFields,
      completion,
      appearance,
    }) => {
      const player = parseAflTradeFactualPlayerResolution(playerReceipt);
      const representedClub = parseAflTradeFactualClubResolution(clubReceipt);
      const identity = row.identityCandidate;
      const candidate = row.matchCandidate;
      if (
        !identity ||
        !candidate ||
        identity.provider !== source.provider ||
        candidate.provider !== source.provider ||
        identity.candidateId !== player.identityCandidateId ||
        candidate.candidateId !== match.matchCandidateId ||
        row.competition !== source.competition ||
        row.seasonYear !== source.seasonYear ||
        (tables && row.metricCandidates.length !== 0) ||
        row.achievementCandidate !== null ||
        row.semanticNaturalKeySha256 === null
      ) {
        throw new Error(
          'Retained player row requires exact player/match candidates; Tables requires no metric candidates.'
        );
      }
      // Authenticate even omitted appearances: never hide malformed metric evidence in that branch.
      let goalsAvailability: GoalsFact['availability'] | null = null;
      if (footy) {
        const metric = row.metricCandidates[0];
        if (
          row.metricCandidates.length !== 1 ||
          !metric ||
          goalsCandidateSha256 !== digest(metric) ||
          metric.metricCode !== 'goals' ||
          metric.definitionVersion !== 'goals/v1' ||
          metric.unit !== 'goals' ||
          metric.sourceField !== 'G' ||
          Reflect.get(metric, 'zeroSemantics') !== 'measured_zero' ||
          (Reflect.get(metric, 'sourceRepresentation') !== undefined &&
            Reflect.get(metric, 'sourceRepresentation') !== 'numeric')
        ) {
          throw new Error('Footy requires the exact retained G/goals/v1 metric candidate.');
        }
        const raw = row.typedPayload.G;
        if (raw?.kind === 'missing') {
          if (
            metric.availability !== 'missing' ||
            metric.numericValue !== null ||
            metric.missingReason !== 'provider_value_missing'
          ) {
            throw new Error('Missing raw G must retain its missing metric candidate.');
          }
          goalsAvailability = {
            state: 'missing',
            numericValue: null,
            reasonCode: 'provider_value_missing',
          };
        } else if (raw?.kind === 'integer' || raw?.kind === 'finite_number') {
          // Same lexical forms as the retained decoded scalar contract, before numeric conversion.
          const lexical =
            raw.kind === 'integer' ? /^-?\d+$/ : /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
          if (typeof raw.value !== 'string' || !lexical.test(raw.value)) {
            throw new Error('Footy G must retain a valid decoded numeric representation.');
          }
          const numeric = Number(raw.value);
          if (
            !Number.isSafeInteger(numeric) ||
            numeric < 0 ||
            metric.availability !== 'exact' ||
            metric.numericValue !== String(numeric) ||
            metric.missingReason !== null
          ) {
            throw new Error(
              'Measured raw G must exactly match its retained nonnegative integer candidate.'
            );
          }
          goalsAvailability = {
            state: 'measured',
            numericValue: metric.numericValue,
            reasonCode: null,
          };
        } else {
          throw new Error(
            'Footy G is missing or a measured numeric scalar; no coercion or zero filling.'
          );
        }
      } else if (goalsCandidateSha256 !== undefined) {
        throw new Error(
          'Tables appearance-only assembly does not accept a goals candidate digest.'
        );
      }
      if (
        representedClub.occurrence.source !== 'player_affiliation' ||
        representedClub.occurrence.identityCandidateId !== identity.candidateId ||
        ![match.homeClub.clubId, match.awayClub.clubId].includes(representedClub.clubId)
      ) {
        throw new Error(
          'Player affiliation must bind this exact candidate and a resolved match side.'
        );
      }
      if (
        !completion ||
        completion.state !== 'quarantined' ||
        completion.providerStatus !== candidate.providerStatus
      ) {
        throw new Error(
          'Player rows require explicit quarantine preserving the retained provider status.'
        );
      }
      if (!appearance || !['observed', 'no_appearance_fact'].includes(appearance.state)) {
        throw new Error('Every row requires an explicit appearance choice.');
      }
      const fields = [
        ...matchSourceFields,
        ...(appearance.state === 'observed' ? appearance.sourceFields : []),
      ];
      if (fields.some((field) => !Object.hasOwn(row.typedPayload, field))) {
        throw new Error('Consumed factual fields must exist in the retained row.');
      }
      const rowSource = {
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
          identity: digest(identity),
          match: digest(candidate),
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
      };
      const base = {
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
      };
      const facts = [
        createAflTradeSourceFact({
          ...base,
          source: {
            ...rowSource,
            candidateDigests: { ...rowSource.candidateDigests, identity: null },
            consumedSourceFields: matchSourceFields,
          },
          factKind: 'match_universe',
          matchCandidateId: candidate.candidateId,
          match,
          completionPolicy: input.completionPolicy,
          completion,
        }),
      ];
      if (appearance.state === 'observed') {
        const appearanceCandidate = createAflTradeProviderAppearanceCandidate({
          schemaVersion: AFL_TRADE_APPEARANCE_CANDIDATE_SCHEMA_VERSION,
          environment: source.environment,
          provider: source.provider,
          capabilityId: source.capabilityId,
          competition: source.competition,
          seasonYear: source.seasonYear,
          captureId: source.captureId,
          normalizationRunId: source.normalizationRunId,
          normalizationFinalization: source.normalizationFinalization,
          normalizationFinalizedAt: source.normalizationFinalizedAt,
          stagingSha256: source.stagingSha256,
          providerDecodedRowId: row.providerDecodedRowId,
          sourceRowNumber: row.sourceRowNumber,
          sourceRowSha256: row.sourceRowSha256,
          semanticNaturalKeySha256: row.semanticNaturalKeySha256,
          fieldMapSha256: source.fieldMapSha256,
          identityCandidateId: identity.candidateId,
          identityCandidateSha256: digest(identity),
          matchCandidateId: candidate.candidateId,
          matchCandidateSha256: digest(candidate),
          appearanceState: 'observed',
          sourceFields: appearance.sourceFields,
          derivationPolicy: appearance.derivationPolicy,
        });
        const appearanceFact = createAflTradeSourceFact({
          ...base,
          factKind: 'player_appearance',
          player,
          representedClub,
          match,
          appearanceCandidate,
          appearanceState: 'observed',
          source: {
            ...rowSource,
            candidateDigests: {
              ...rowSource.candidateDigests,
              appearance: appearanceCandidate.candidateSha256,
            },
            consumedSourceFields: appearance.sourceFields,
          },
        });
        facts.push(appearanceFact);
        if (footy) {
          if (!goalsAvailability || !input.goalsDefinition || !goalsCandidateSha256) {
            throw new Error('Validated Footy goals inputs are required.');
          }
          facts.push(
            createAflTradeSourceFact({
              ...base,
              factKind: 'player_match_metric',
              player,
              representedClub,
              match,
              appearanceFactId: appearanceFact.factId,
              metricCode: 'goals',
              definitionVersion: 'goals/v1',
              definition: input.goalsDefinition,
              unit: 'goals',
              availability: goalsAvailability,
              source: {
                ...rowSource,
                candidateDigests: { ...rowSource.candidateDigests, metric: goalsCandidateSha256 },
                consumedSourceFields: ['G'],
              },
            })
          );
        }
      }
      return {
        facts,
        accounting: {
          providerDecodedRowId: row.providerDecodedRowId,
          sourceRowSha256: row.sourceRowSha256,
          disposition: 'normalized' as const,
          factIds: facts.map((f) => f.factId).sort(),
          ...issues,
          reasonCode: null,
        },
      };
    }
  );
  const facts = assembled
    .flatMap((row) => row.facts)
    .sort((a, b) => (a.factId < b.factId ? -1 : a.factId > b.factId ? 1 : 0));
  return createAflTradeSourceFactBatch({
    ...source,
    schemaVersion: AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    createdAt: input.createdAt,
    facts,
    rowAccounting: assembled
      .map((row) => row.accounting)
      .sort((a, b) =>
        a.providerDecodedRowId < b.providerDecodedRowId
          ? -1
          : a.providerDecodedRowId > b.providerDecodedRowId
            ? 1
            : 0
      ),
    counts: {
      matchUniverse: assembled.length,
      playerAppearances: facts.filter((f) => f.content.factKind === 'player_appearance').length,
      playerMatchMetrics: facts.filter((f) => f.content.factKind === 'player_match_metric').length,
      playerSeasonMetrics: 0,
      playerAchievements: 0,
      normalizedRows: assembled.length,
      nonNormalizedRows: 0,
    },
  });
}
