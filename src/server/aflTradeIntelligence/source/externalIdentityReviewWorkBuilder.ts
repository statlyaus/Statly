import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import {
  parseAflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';
import {
  createAflTradeExternalIdentityReviewPackage,
  createAflTradeExternalIdentityReviewWorkItem,
  createAflTradeExternalIdentitySubject,
  type AflTradeExternalIdentityReviewPackage,
  type AflTradeExternalIdentitySubject,
} from './externalIdentityReviewContracts';
import {
  aflTradeExternalReconciliationSourceAuthoritySchema,
  type AflTradeHistoricalCompletionReconciliationAuthority,
} from './externalReconciliationSourceAuthorityContracts';

type Provider = AflTradeExternalEvidenceContent['provider'];
type Claim = AflTradeExternalEvidenceContent['claim'];
type RecordedEntity = Extract<Claim, { kind: 'transaction_party' }>['club'];
type EntityKind = 'club' | 'player';

interface IdentityObservation {
  evidenceId: string;
  batchId: string;
  sourceIdentity: RecordedEntity;
  seasonYear: number;
  capturedAt: string;
}

interface SubjectGroup {
  subject: AflTradeExternalIdentitySubject;
  observations: Map<string, IdentityObservation>;
}

export class AflTradeExternalIdentityReviewWorkError extends Error {
  constructor(
    readonly code: 'SOURCE_MEMBERSHIP_MISMATCH' | 'SOURCE_SCOPE_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalIdentityReviewWorkError';
  }
}

function eventKey(provider: Provider, nativeEventId: string): string {
  return `${provider}\0${nativeEventId}`;
}

function observationKey(observation: IdentityObservation): string {
  return [
    observation.evidenceId,
    observation.sourceIdentity.nativeId ?? '',
    observation.sourceIdentity.recordedName,
    String(observation.seasonYear),
  ].join('\0');
}

function requireTransactionSeason(
  eventSeasons: ReadonlyMap<string, number>,
  provider: Provider,
  nativeEventId: string
): number {
  const seasonYear = eventSeasons.get(eventKey(provider, nativeEventId));
  if (seasonYear === undefined) {
    throw new AflTradeExternalIdentityReviewWorkError(
      'SOURCE_SCOPE_MISMATCH',
      `External identity review requires an explicit transaction season for ${nativeEventId}.`
    );
  }
  return seasonYear;
}

function collectEventSeasons(sourceBatches: readonly AflTradeExternalEvidenceBatch[]) {
  const eventSeasons = new Map<string, number>();
  sourceBatches.forEach((batch) => {
    batch.content.evidence.forEach((evidence) => {
      const claim = evidence.content.claim;
      if (claim.kind !== 'transaction') return;
      const key = eventKey(evidence.content.provider, claim.nativeEventId);
      const existing = eventSeasons.get(key);
      if (existing !== undefined && existing !== claim.seasonYear) {
        throw new AflTradeExternalIdentityReviewWorkError(
          'SOURCE_SCOPE_MISMATCH',
          `Transaction ${claim.nativeEventId} has conflicting source seasons.`
        );
      }
      eventSeasons.set(key, claim.seasonYear);
    });
  });
  return eventSeasons;
}

function subjectFor(input: {
  environment: 'test_fixture' | 'non_production' | 'production';
  competition: string;
  provider: Provider;
  entityKind: EntityKind;
  sourceIdentity: RecordedEntity;
  seasonYear: number;
}): AflTradeExternalIdentitySubject {
  return createAflTradeExternalIdentitySubject({
    environment: input.environment,
    competition: input.competition,
    provider: input.provider,
    entityKind: input.entityKind,
    identityScope:
      input.sourceIdentity.nativeId === null
        ? {
            kind: 'exact_recorded_name',
            recordedName: input.sourceIdentity.recordedName,
            seasonYear: input.seasonYear,
          }
        : { kind: 'provider_native_id', nativeId: input.sourceIdentity.nativeId },
  });
}

function addObservation(
  groups: Map<string, SubjectGroup>,
  input: {
    environment: 'test_fixture' | 'non_production' | 'production';
    competition: string;
    provider: Provider;
    entityKind: EntityKind;
    sourceIdentity: RecordedEntity;
    seasonYear: number;
    evidenceId: string;
    batchId: string;
    capturedAt: string;
  }
): void {
  const subject = subjectFor(input);
  const group = groups.get(subject.subjectId) ?? {
    subject,
    observations: new Map<string, IdentityObservation>(),
  };
  const observation = {
    evidenceId: input.evidenceId,
    batchId: input.batchId,
    sourceIdentity: input.sourceIdentity,
    seasonYear: input.seasonYear,
    capturedAt: input.capturedAt,
  };
  group.observations.set(observationKey(observation), observation);
  groups.set(subject.subjectId, group);
}

function addClaimIdentities(
  groups: Map<string, SubjectGroup>,
  eventSeasons: ReadonlyMap<string, number>,
  scope: { environment: 'test_fixture' | 'non_production' | 'production'; competition: string },
  batchId: string,
  evidence: AflTradeExternalEvidenceBatch['content']['evidence'][number]
): void {
  const provider = evidence.content.provider;
  const claim = evidence.content.claim;
  const base = {
    ...scope,
    provider,
    evidenceId: evidence.evidenceId,
    batchId,
    capturedAt: evidence.content.capture.capturedAt,
  };
  const add = (entityKind: EntityKind, sourceIdentity: RecordedEntity, seasonYear: number) =>
    addObservation(groups, { ...base, entityKind, sourceIdentity, seasonYear });

  if (claim.kind === 'transaction_party') {
    add('club', claim.club, requireTransactionSeason(eventSeasons, provider, claim.nativeEventId));
    return;
  }
  if (claim.kind === 'directed_transfer') {
    const seasonYear = requireTransactionSeason(eventSeasons, provider, claim.nativeEventId);
    add('club', claim.fromClub, seasonYear);
    add('club', claim.toClub, seasonYear);
    if (claim.asset.kind === 'player') add('player', claim.asset.player, seasonYear);
    if (claim.asset.kind === 'future_pick') add('club', claim.asset.originalClub, seasonYear);
    return;
  }
  if (claim.kind === 'draft_selection') {
    add('player', claim.player, claim.draftYear);
    add('club', claim.selectedByClub, claim.draftYear);
    return;
  }
  if (claim.kind === 'pick_custody') {
    if (claim.originalClub !== null) add('club', claim.originalClub, claim.draftYear);
    add('club', claim.currentClub, claim.draftYear);
    return;
  }
  if (claim.kind === 'player_draft_detail') {
    add('player', claim.player, claim.squadSeason);
    add('club', claim.squadClub, claim.squadSeason);
  }
}

function parseHistoricalAuthority(
  input: unknown
): AflTradeHistoricalCompletionReconciliationAuthority {
  const authority = aflTradeExternalReconciliationSourceAuthoritySchema.parse(input);
  if (authority.kind !== 'historical_plan_completion') {
    throw new AflTradeExternalIdentityReviewWorkError(
      'SOURCE_MEMBERSHIP_MISMATCH',
      'External identity review work requires one historical capture completion.'
    );
  }
  return authority;
}

export function buildAflTradeExternalIdentityReviewPackage(input: {
  environment: 'test_fixture' | 'non_production' | 'production';
  competition: string;
  sourceAuthority: unknown;
  sourceBatches: readonly unknown[];
}): AflTradeExternalIdentityReviewPackage {
  const sourceAuthority = parseHistoricalAuthority(input.sourceAuthority);
  const sourceBatches = input.sourceBatches.map(parseAflTradeExternalEvidenceBatch);
  const sourceBatchIds = sourceBatches.map(({ batchId }) => batchId).sort();
  if (
    new Set(sourceBatchIds).size !== sourceBatchIds.length ||
    sourceAuthority.candidateSourceBatchSetSha256 !== sha256AflTradeCanonicalJson(sourceBatchIds)
  ) {
    throw new AflTradeExternalIdentityReviewWorkError(
      'SOURCE_MEMBERSHIP_MISMATCH',
      'Historical completion does not bind the exact identity-review source batches.'
    );
  }
  if (
    sourceBatches.some((batch) =>
      batch.content.evidence.some(
        (evidence) =>
          Date.parse(evidence.content.capture.capturedAt) > Date.parse(sourceAuthority.completedAt)
      )
    )
  ) {
    throw new AflTradeExternalIdentityReviewWorkError(
      'SOURCE_SCOPE_MISMATCH',
      'Identity evidence cannot postdate its historical completion.'
    );
  }

  const eventSeasons = collectEventSeasons(sourceBatches);
  const groups = new Map<string, SubjectGroup>();
  sourceBatches.forEach((batch) => {
    batch.content.evidence.forEach((evidence) =>
      addClaimIdentities(
        groups,
        eventSeasons,
        { environment: input.environment, competition: input.competition },
        batch.batchId,
        evidence
      )
    );
  });
  if (groups.size === 0) {
    throw new AflTradeExternalIdentityReviewWorkError(
      'SOURCE_SCOPE_MISMATCH',
      'Historical source evidence contains no reviewable club or player identity.'
    );
  }
  const items = [...groups.values()].map(({ subject, observations }) =>
    createAflTradeExternalIdentityReviewWorkItem({
      subject,
      observations: [...observations.values()],
    })
  );
  return createAflTradeExternalIdentityReviewPackage({
    completionId: sourceAuthority.completionId,
    completionSha256: sourceAuthority.completionSha256,
    environment: input.environment,
    competition: input.competition,
    completedAt: sourceAuthority.completedAt,
    items,
  });
}
