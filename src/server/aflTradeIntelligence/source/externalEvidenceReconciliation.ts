import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  parseAflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION,
  aflTradeExternalReconciliationSourceAuthoritySchema,
  type AflTradeExternalReconciliationSourceAuthority,
} from './externalReconciliationSourceAuthorityContracts';

export const AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION =
  'afl-trade-external-identity-resolution/v1' as const;
export const AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION =
  'afl-trade-external-reconciliation/v1' as const;

type Provider = AflTradeExternalEvidenceContent['provider'];
type Claim = AflTradeExternalEvidenceContent['claim'];
type RecordedEntity = Extract<Claim, { kind: 'transaction_party' }>['club'];
type Evidence = AflTradeExternalEvidenceBatch['content']['evidence'][number];

const providerSchema = z.enum([
  'statly_local_fixture',
  'draftguru',
  'footywire',
  'official_afl',
  'fitzroy_official_afl_player_details',
]);
const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid UTC instant.');
const recordedEntitySchema = z
  .object({
    nativeId: z.string().trim().min(1).max(240).nullable(),
    recordedName: z.string().trim().min(1).max(500),
  })
  .strict();

const identityResolutionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION),
    provider: providerSchema,
    entityKind: z.enum(['club', 'player']),
    sourceIdentity: recordedEntitySchema,
    canonicalId: z.string().trim().min(1).max(240),
    reviewDecisionId: aflTradeContentAddressedIdSchema('review-decision'),
    reviewDecisionSha256: aflTradeSha256Schema,
    decidedAt: instantSchema,
    status: z.literal('current_approved'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reviewDecisionId !== `review-decision:${value.reviewDecisionSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['reviewDecisionId'],
        message: 'Review decision ID must bind its exact digest.',
      });
    }
  });

export type AflTradeExternalIdentityResolutionContent = z.infer<
  typeof identityResolutionContentSchema
>;

const identityResolutionSchema = z
  .object({
    resolutionId: aflTradeContentAddressedIdSchema('external-identity-resolution'),
    content: identityResolutionContentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeContentAddressIssue(
      'external-identity-resolution',
      value.resolutionId,
      value.content,
      context,
      ['resolutionId']
    );
  });

export type AflTradeExternalIdentityResolution = z.infer<typeof identityResolutionSchema>;

export function parseAflTradeExternalIdentityResolution(
  input: unknown
): AflTradeExternalIdentityResolution {
  return identityResolutionSchema.parse(input);
}

export function createAflTradeExternalIdentityResolution(
  content: AflTradeExternalIdentityResolutionContent
): AflTradeExternalIdentityResolution {
  const parsed = identityResolutionContentSchema.parse(content);
  return identityResolutionSchema.parse({
    resolutionId: createAflTradeContentAddress('external-identity-resolution', parsed),
    content: parsed,
  });
}

type ReconciliationStatus = 'single_source' | 'corroborated' | 'disputed' | 'unresolved';

interface ReconciliationIssue {
  code:
    | 'identity_unresolved'
    | 'identity_resolution_conflict'
    | 'selection_conflict'
    | 'pick_identity_conflict'
    | 'transaction_incomplete'
    | 'lineage_unresolved';
  severity: 'blocking';
  subjectKey: string;
  detail: string;
  evidenceIds: string[];
}

interface CanonicalTransaction {
  transactionId: string;
  providerEventId: string;
  seasonYear: number;
  occurredOn: string | null;
  transactionType: 'trade' | 'free_agency' | 'other';
  title: string | null;
  parties: string[];
  transferIds: string[];
  status: ReconciliationStatus;
  evidenceIds: string[];
}

type CanonicalTransferAsset =
  | {
      kind: 'player';
      playerId: string | null;
      recordedName: string;
    }
  | {
      kind: 'pick_entitlement';
      pickId: string;
      draftYear: number;
      draftType: string;
      nominalRound: number | null;
      nominalPick: number | null;
      originalClubId: string | null;
      recordedLabel: string | null;
    };

interface CanonicalTransfer {
  transferId: string;
  transactionId: string;
  fromClubId: string | null;
  toClubId: string | null;
  asset: CanonicalTransferAsset;
  status: ReconciliationStatus;
  evidenceIds: string[];
}

interface CanonicalDraftSelection {
  selectionId: string;
  draftYear: number;
  draftType: string;
  selectionNumber: number;
  roundNumber: number | null;
  pickId: string;
  playerId: string | null;
  clubId: string | null;
  status: ReconciliationStatus;
  supportingProviders: Provider[];
  evidenceIds: string[];
}

interface CanonicalPickCustody {
  custodyId: string;
  pickId: string;
  observedAt: string;
  draftYear: number;
  draftType: string;
  roundNumber: number | null;
  recordedPickNumber: number | null;
  originalClubId: string | null;
  currentClubId: string | null;
  status: ReconciliationStatus;
  evidenceIds: string[];
}

interface CanonicalPickLineage {
  lineageId: string;
  pickId: string;
  transferId: string;
  selectionId: string;
  status: ReconciliationStatus;
  evidenceIds: string[];
}

export interface AflTradeExternalReconciliationContent {
  schemaVersion:
    | typeof AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION
    | typeof AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION;
  environment: 'test_fixture' | 'non_production' | 'production';
  competition: string;
  anchorSeasonYear: number;
  sourceBatchIds: string[];
  sourceAuthority?: AflTradeExternalReconciliationSourceAuthority;
  identityResolutionIds: string[];
  transactions: CanonicalTransaction[];
  transfers: CanonicalTransfer[];
  draftSelections: CanonicalDraftSelection[];
  pickCustody: CanonicalPickCustody[];
  pickLineage: CanonicalPickLineage[];
  issues: ReconciliationIssue[];
  reconciledAt: string;
  publicationEligible: false;
}

export interface AflTradeExternalReconciliationCandidate {
  candidateId: string;
  content: AflTradeExternalReconciliationContent;
}

function identityKey(
  provider: Provider,
  entityKind: 'club' | 'player',
  sourceIdentity: RecordedEntity
): string {
  return `${provider}|${entityKind}|${sourceIdentity.nativeId ?? ''}|${sourceIdentity.recordedName}`;
}

function statusFromEvidence(providerCount: number): ReconciliationStatus {
  return providerCount >= 2 ? 'corroborated' : 'single_source';
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function pickKey(
  year: number,
  draftType: string,
  pick: number | null,
  round: number | null
): string {
  return `${year}|${draftType}|${pick ?? 'unknown'}|${round ?? 'unknown'}`;
}

function pickId(
  year: number,
  draftType: string,
  pick: number | null,
  round: number | null
): string {
  return createAflTradeContentAddress('draft-pick', {
    draftYear: year,
    draftType,
    nominalPick: pick,
    nominalRound: round,
  });
}

type DirectedTransferClaim = Extract<Claim, { kind: 'directed_transfer' }>;
type DirectedTransferEvidence = Evidence & { content: { claim: DirectedTransferClaim } };
type TransactionEvidence = Evidence & {
  content: { claim: Extract<Claim, { kind: 'transaction' }> };
};
type IdentityResolver = (
  provider: Provider,
  entityKind: 'club' | 'player',
  sourceIdentity: RecordedEntity,
  subjectKey: string,
  evidenceId: string
) => string | null;

function isUsableCustody(custody: CanonicalPickCustody): boolean {
  return custody.status === 'single_source' || custody.status === 'corroborated';
}

function playerTransferAsset(input: {
  row: DirectedTransferEvidence;
  claim: DirectedTransferClaim;
  resolve: IdentityResolver;
}): CanonicalTransferAsset {
  if (input.claim.asset.kind !== 'player') {
    throw new TypeError('Player transfer asset resolution received the wrong asset kind.');
  }
  return {
    kind: 'player',
    playerId: input.resolve(
      input.row.content.provider,
      'player',
      input.claim.asset.player,
      `transfer:${input.claim.nativeTransferId}:player`,
      input.row.evidenceId
    ),
    recordedName: input.claim.asset.player.recordedName,
  };
}

function futurePickTransferAsset(input: {
  row: DirectedTransferEvidence;
  claim: DirectedTransferClaim;
  resolve: IdentityResolver;
  pickCustody: readonly CanonicalPickCustody[];
  toClubId: string | null;
}): CanonicalTransferAsset {
  if (input.claim.asset.kind !== 'future_pick') {
    throw new TypeError('Future-pick transfer resolution received the wrong asset kind.');
  }
  const futurePick = input.claim.asset;
  const originalClubId = input.resolve(
    input.row.content.provider,
    'club',
    futurePick.originalClub,
    `transfer:${input.claim.nativeTransferId}:original-club`,
    input.row.evidenceId
  );
  const custodyMatches = input.pickCustody.filter(
    (custody) =>
      isUsableCustody(custody) &&
      custody.draftYear === futurePick.draftYear &&
      custody.draftType === futurePick.draftType &&
      custody.roundNumber === futurePick.roundNumber &&
      custody.originalClubId === originalClubId &&
      custody.currentClubId === input.toClubId
  );
  return {
    kind: 'pick_entitlement',
    pickId:
      custodyMatches.length === 1
        ? custodyMatches[0].pickId
        : pickId(futurePick.draftYear, futurePick.draftType, null, futurePick.roundNumber),
    draftYear: futurePick.draftYear,
    draftType: futurePick.draftType,
    nominalRound: futurePick.roundNumber,
    nominalPick: null,
    originalClubId,
    recordedLabel: null,
  };
}

function latestPriorCustody(
  pickCustody: readonly CanonicalPickCustody[],
  custody: CanonicalPickCustody
): CanonicalPickCustody | undefined {
  return pickCustody
    .filter(
      (prior) =>
        isUsableCustody(prior) &&
        prior.pickId === custody.pickId &&
        prior.observedAt < custody.observedAt
    )
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
}

function matchesCurrentPickCustody(input: {
  custody: CanonicalPickCustody;
  pickCustody: readonly CanonicalPickCustody[];
  currentPick: Extract<DirectedTransferClaim['asset'], { kind: 'current_pick' }>;
  eventClaim: Extract<Claim, { kind: 'transaction' }> | null;
  occurredOn: string | null;
  fromClubId: string | null;
  toClubId: string | null;
}): boolean {
  const { custody, currentPick } = input;
  if (
    !input.eventClaim ||
    !isUsableCustody(custody) ||
    custody.draftYear !== currentPick.draftYear ||
    custody.draftType !== currentPick.draftType ||
    custody.currentClubId !== input.toClubId ||
    (input.occurredOn !== null && custody.observedAt.slice(0, 10) < input.occurredOn) ||
    (currentPick.recordedRoundNumber !== undefined &&
      custody.roundNumber !== null &&
      custody.roundNumber !== currentPick.recordedRoundNumber)
  ) {
    return false;
  }
  const priorCustody = latestPriorCustody(input.pickCustody, custody);
  return priorCustody
    ? priorCustody.currentClubId === input.fromClubId &&
        (input.occurredOn === null || priorCustody.observedAt.slice(0, 10) <= input.occurredOn)
    : custody.originalClubId === input.fromClubId;
}

function currentPickTransferAsset(input: {
  claim: DirectedTransferClaim;
  transactionClaimsByNativeEventId: ReadonlyMap<string, readonly TransactionEvidence[]>;
  pickCustody: readonly CanonicalPickCustody[];
  fromClubId: string | null;
  toClubId: string | null;
}): CanonicalTransferAsset {
  if (input.claim.asset.kind !== 'current_pick') {
    throw new TypeError('Current-pick transfer resolution received the wrong asset kind.');
  }
  const currentPick = input.claim.asset;
  const eventClaims = input.transactionClaimsByNativeEventId.get(input.claim.nativeEventId) ?? [];
  const eventClaim = eventClaims.length === 1 ? eventClaims[0].content.claim : null;
  const occurredOn = eventClaim?.occurredOn ?? null;
  const custodyMatches = input.pickCustody.filter((custody) =>
    matchesCurrentPickCustody({
      custody,
      pickCustody: input.pickCustody,
      currentPick,
      eventClaim,
      occurredOn,
      fromClubId: input.fromClubId,
      toClubId: input.toClubId,
    })
  );
  const exactCustody = custodyMatches.length === 1 ? custodyMatches[0] : null;
  return {
    kind: 'pick_entitlement',
    pickId: exactCustody
      ? exactCustody.pickId
      : pickId(
          currentPick.draftYear,
          currentPick.draftType,
          currentPick.recordedPickNumber,
          currentPick.recordedRoundNumber ?? null
        ),
    draftYear: currentPick.draftYear,
    draftType: currentPick.draftType,
    nominalRound: currentPick.recordedRoundNumber ?? null,
    nominalPick: currentPick.recordedPickNumber,
    originalClubId: exactCustody?.originalClubId ?? null,
    recordedLabel: currentPick.recordedLabel ?? null,
  };
}

function reconcileDirectedTransfer(input: {
  row: DirectedTransferEvidence;
  resolve: IdentityResolver;
  pickCustody: readonly CanonicalPickCustody[];
  transactionClaimsByNativeEventId: ReadonlyMap<string, readonly TransactionEvidence[]>;
}): CanonicalTransfer {
  const claim = input.row.content.claim;
  const transactionId = createAflTradeContentAddress('external-transaction', {
    provider: input.row.content.provider,
    nativeEventId: claim.nativeEventId,
  });
  const fromClubId = input.resolve(
    input.row.content.provider,
    'club',
    claim.fromClub,
    `transfer:${claim.nativeTransferId}:from`,
    input.row.evidenceId
  );
  const toClubId = input.resolve(
    input.row.content.provider,
    'club',
    claim.toClub,
    `transfer:${claim.nativeTransferId}:to`,
    input.row.evidenceId
  );
  const asset =
    claim.asset.kind === 'player'
      ? playerTransferAsset({ row: input.row, claim, resolve: input.resolve })
      : claim.asset.kind === 'future_pick'
        ? futurePickTransferAsset({
            row: input.row,
            claim,
            resolve: input.resolve,
            pickCustody: input.pickCustody,
            toClubId,
          })
        : currentPickTransferAsset({
            claim,
            transactionClaimsByNativeEventId: input.transactionClaimsByNativeEventId,
            pickCustody: input.pickCustody,
            fromClubId,
            toClubId,
          });
  const custodyResolved =
    asset.kind !== 'pick_entitlement' ||
    input.pickCustody.some(
      (custody) => custody.pickId === asset.pickId && isUsableCustody(custody)
    );
  const status: ReconciliationStatus =
    !fromClubId || !toClubId || (asset.kind === 'player' && !asset.playerId) || !custodyResolved
      ? 'unresolved'
      : 'single_source';
  return {
    transferId: createAflTradeContentAddress('external-transfer', {
      transactionId,
      nativeTransferId: claim.nativeTransferId,
    }),
    transactionId,
    fromClubId,
    toClubId,
    asset,
    status,
    evidenceIds: [input.row.evidenceId],
  };
}

export function reconcileAflTradeExternalEvidence(input: {
  environment: 'test_fixture' | 'non_production' | 'production';
  competition: string;
  anchorSeasonYear: number;
  sourceBatches: readonly unknown[];
  identityResolutions: readonly unknown[];
  sourceAuthority?: unknown;
  reconciledAt: string;
}): AflTradeExternalReconciliationCandidate {
  const environment = z
    .enum(['test_fixture', 'non_production', 'production'])
    .parse(input.environment);
  const competition = z.string().trim().min(1).max(40).parse(input.competition);
  const anchorSeasonYear = z.number().int().min(1897).max(2200).parse(input.anchorSeasonYear);
  const reconciledAt = instantSchema.parse(input.reconciledAt);
  const sourceBatches = input.sourceBatches.map(parseAflTradeExternalEvidenceBatch);
  if (
    environment !== 'test_fixture' &&
    sourceBatches.some(({ content }) => content.provider === 'statly_local_fixture')
  ) {
    throw new TypeError('Local fixture evidence can be reconciled only in test_fixture.');
  }
  const sourceBatchIds = sourceBatches.map((batch) => batch.batchId).sort();
  const sourceAuthority =
    input.sourceAuthority === undefined
      ? undefined
      : aflTradeExternalReconciliationSourceAuthoritySchema.parse(input.sourceAuthority);
  if (
    sourceAuthority !== undefined &&
    sourceAuthority.candidateSourceBatchSetSha256 !== sha256AflTradeCanonicalJson(sourceBatchIds)
  ) {
    throw new TypeError('Reconciliation source authority does not bind the exact source batches.');
  }
  if (
    sourceAuthority?.kind === 'historical_plan_completion' &&
    Date.parse(sourceAuthority.completedAt) > Date.parse(reconciledAt)
  ) {
    throw new TypeError('Historical capture completion must precede reconciliation.');
  }
  const identityResolutions = input.identityResolutions.map((value) =>
    identityResolutionSchema.parse(value)
  );
  if (
    environment !== 'test_fixture' &&
    identityResolutions.some(({ content }) => content.provider === 'statly_local_fixture')
  ) {
    throw new TypeError('Local fixture identities can be reconciled only in test_fixture.');
  }
  const evidence = sourceBatches.flatMap((batch) => batch.content.evidence);
  const issues: ReconciliationIssue[] = [];

  const resolutionIndex = new Map<string, AflTradeExternalIdentityResolution>();
  identityResolutions.forEach((resolution) => {
    const key = identityKey(
      resolution.content.provider,
      resolution.content.entityKind,
      resolution.content.sourceIdentity
    );
    const existing = resolutionIndex.get(key);
    if (existing && existing.content.canonicalId !== resolution.content.canonicalId) {
      issues.push({
        code: 'identity_resolution_conflict',
        severity: 'blocking',
        subjectKey: key,
        detail: 'Two current reviewed resolutions map the same provider identity differently.',
        evidenceIds: [],
      });
      resolutionIndex.delete(key);
      return;
    }
    resolutionIndex.set(key, resolution);
  });

  const resolve = (
    provider: Provider,
    entityKind: 'club' | 'player',
    sourceIdentity: RecordedEntity,
    subjectKey: string,
    evidenceId: string
  ): string | null => {
    const found = resolutionIndex.get(identityKey(provider, entityKind, sourceIdentity));
    if (found) return found.content.canonicalId;
    issues.push({
      code: 'identity_unresolved',
      severity: 'blocking',
      subjectKey,
      detail: `No current reviewed ${entityKind} resolution exists for ${provider} identity ${sourceIdentity.recordedName}.`,
      evidenceIds: [evidenceId],
    });
    return null;
  };

  const transactionClaims = evidence.filter(
    (row): row is Evidence & { content: { claim: Extract<Claim, { kind: 'transaction' }> } } =>
      (row.content.provider === 'draftguru' || row.content.provider === 'statly_local_fixture') &&
      row.content.claim.kind === 'transaction'
  );
  const parties = evidence.filter(
    (
      row
    ): row is Evidence & { content: { claim: Extract<Claim, { kind: 'transaction_party' }> } } =>
      (row.content.provider === 'draftguru' || row.content.provider === 'statly_local_fixture') &&
      row.content.claim.kind === 'transaction_party'
  );
  const directedTransfers = evidence.filter(
    (
      row
    ): row is Evidence & { content: { claim: Extract<Claim, { kind: 'directed_transfer' }> } } =>
      (row.content.provider === 'draftguru' || row.content.provider === 'statly_local_fixture') &&
      row.content.claim.kind === 'directed_transfer'
  );
  const transactionClaimsByNativeEventId = new Map<string, typeof transactionClaims>();
  for (const transaction of transactionClaims) {
    const values =
      transactionClaimsByNativeEventId.get(transaction.content.claim.nativeEventId) ?? [];
    values.push(transaction);
    transactionClaimsByNativeEventId.set(transaction.content.claim.nativeEventId, values);
  }

  const custodyClaims = evidence.filter(
    (row): row is Evidence & { content: { claim: Extract<Claim, { kind: 'pick_custody' }> } } =>
      row.content.claim.kind === 'pick_custody'
  );
  const pickCustody: CanonicalPickCustody[] = custodyClaims.map((row) => {
    const claim = row.content.claim;
    const currentClubId = resolve(
      row.content.provider,
      'club',
      claim.currentClub,
      `custody:${row.evidenceId}:current`,
      row.evidenceId
    );
    const originalClubId = claim.originalClub
      ? resolve(
          row.content.provider,
          'club',
          claim.originalClub,
          `custody:${row.evidenceId}:original`,
          row.evidenceId
        )
      : null;
    const custodyId = createAflTradeContentAddress('external-pick-custody', {
      evidenceId: row.evidenceId,
    });
    return {
      custodyId,
      pickId:
        originalClubId === null
          ? createAflTradeContentAddress('draft-pick', { unresolvedCustodyId: custodyId })
          : createAflTradeContentAddress('draft-pick', {
              draftYear: claim.draftYear,
              draftType: claim.draftType,
              roundNumber: claim.roundNumber,
              originalClubId,
            }),
      observedAt: claim.observedAt,
      draftYear: claim.draftYear,
      draftType: claim.draftType,
      roundNumber: claim.roundNumber,
      recordedPickNumber: claim.recordedPickNumber,
      originalClubId,
      currentClubId,
      status: currentClubId && originalClubId ? 'single_source' : 'unresolved',
      evidenceIds: [row.evidenceId],
    };
  });
  const custodyIdentityGroups = new Map<string, CanonicalPickCustody[]>();
  pickCustody.forEach((custody) => {
    const key = `${custody.pickId}|${custody.observedAt}`;
    const group = custodyIdentityGroups.get(key) ?? [];
    group.push(custody);
    custodyIdentityGroups.set(key, group);
  });
  custodyIdentityGroups.forEach((group, key) => {
    const observedSlots = new Set(
      group.map(
        (custody) =>
          `${custody.recordedPickNumber ?? 'unknown'}|${custody.currentClubId ?? 'unknown'}`
      )
    );
    if (observedSlots.size <= 1) return;
    group.forEach((custody) => {
      custody.status = 'disputed';
    });
    issues.push({
      code: 'pick_identity_conflict',
      severity: 'blocking',
      subjectKey: `pick-custody:${key}`,
      detail:
        'Multiple custody slots collapse to one inferred pick identity at the same observation time.',
      evidenceIds: group.flatMap(({ evidenceIds }) => evidenceIds),
    });
  });
  const transfers: CanonicalTransfer[] = directedTransfers.map((row) =>
    reconcileDirectedTransfer({
      row,
      resolve,
      pickCustody,
      transactionClaimsByNativeEventId,
    })
  );

  const transactions: CanonicalTransaction[] = transactionClaims.map((row) => {
    const claim = row.content.claim;
    const transactionId = createAflTradeContentAddress('external-transaction', {
      provider: row.content.provider,
      nativeEventId: claim.nativeEventId,
    });
    const eventParties = parties.filter(
      (party) =>
        party.content.provider === row.content.provider &&
        party.content.claim.nativeEventId === claim.nativeEventId
    );
    const partyIds = eventParties.map((party) =>
      resolve(
        row.content.provider,
        'club',
        party.content.claim.club,
        `transaction:${claim.nativeEventId}:party:${party.content.claim.nativePartyId}`,
        party.evidenceId
      )
    );
    const eventTransfers = transfers.filter((transfer) => transfer.transactionId === transactionId);
    if (partyIds.filter(Boolean).length < 2 || eventTransfers.length === 0) {
      issues.push({
        code: 'transaction_incomplete',
        severity: 'blocking',
        subjectKey: `transaction:${claim.nativeEventId}`,
        detail: 'A transaction needs at least two resolved parties and one directed transfer.',
        evidenceIds: [row.evidenceId, ...eventParties.map((party) => party.evidenceId)],
      });
    }
    const complete =
      partyIds.every((partyId) => partyId !== null) &&
      partyIds.length >= 2 &&
      eventTransfers.length > 0 &&
      eventTransfers.every((transfer) => transfer.status !== 'unresolved');
    return {
      transactionId,
      providerEventId: claim.nativeEventId,
      seasonYear: claim.seasonYear,
      occurredOn: claim.occurredOn,
      transactionType: claim.transactionType,
      title: claim.title,
      parties: sortedUnique(partyIds.filter((partyId): partyId is string => partyId !== null)),
      transferIds: eventTransfers.map((transfer) => transfer.transferId).sort(),
      status: complete ? 'single_source' : 'unresolved',
      evidenceIds: [row.evidenceId, ...eventParties.map((party) => party.evidenceId)].sort(),
    };
  });

  const selectionClaims = evidence.filter(
    (row): row is Evidence & { content: { claim: Extract<Claim, { kind: 'draft_selection' }> } } =>
      row.content.claim.kind === 'draft_selection'
  );
  const detailClaims = evidence.filter(
    (
      row
    ): row is Evidence & { content: { claim: Extract<Claim, { kind: 'player_draft_detail' }> } } =>
      row.content.claim.kind === 'player_draft_detail'
  );
  const groupedSelections = new Map<string, typeof selectionClaims>();
  selectionClaims.forEach((row) => {
    const claim = row.content.claim;
    const key = pickKey(claim.draftYear, claim.draftType, claim.selectionNumber, claim.roundNumber);
    const group = groupedSelections.get(key) ?? [];
    group.push(row);
    groupedSelections.set(key, group);
  });

  const draftSelections: CanonicalDraftSelection[] = [...groupedSelections.values()]
    .map((rows) => {
      const first = rows[0].content.claim;
      const resolvedRows = rows.map((row) => ({
        row,
        playerId: resolve(
          row.content.provider,
          'player',
          row.content.claim.player,
          `selection:${first.draftYear}:${first.draftType}:${first.selectionNumber}:player`,
          row.evidenceId
        ),
        clubId: resolve(
          row.content.provider,
          'club',
          row.content.claim.selectedByClub,
          `selection:${first.draftYear}:${first.draftType}:${first.selectionNumber}:club`,
          row.evidenceId
        ),
      }));
      const resolvedPairs = sortedUnique(
        resolvedRows
          .filter((value) => value.playerId && value.clubId)
          .map((value) => `${value.playerId}|${value.clubId}`)
      );
      let status: ReconciliationStatus;
      let playerId: string | null = null;
      let clubId: string | null = null;
      if (resolvedRows.some((value) => !value.playerId || !value.clubId)) {
        status = 'unresolved';
      } else if (resolvedPairs.length > 1) {
        status = 'disputed';
        issues.push({
          code: 'selection_conflict',
          severity: 'blocking',
          subjectKey: `selection:${first.draftYear}:${first.draftType}:${first.selectionNumber}`,
          detail: 'Reviewed provider claims disagree on the selected player or club.',
          evidenceIds: rows.map((row) => row.evidenceId).sort(),
        });
      } else {
        [playerId, clubId] = resolvedPairs[0].split('|');
        status = statusFromEvidence(new Set(rows.map((row) => row.content.provider)).size);
      }

      const detailSupport = detailClaims.filter((detail) => {
        const claim = detail.content.claim;
        if (
          claim.draftYear !== first.draftYear ||
          claim.draftType !== first.draftType ||
          claim.draftPosition !== first.selectionNumber ||
          !playerId
        ) {
          return false;
        }
        return (
          resolve(
            detail.content.provider,
            'player',
            claim.player,
            `selection:${first.draftYear}:${first.draftType}:${first.selectionNumber}:detail`,
            detail.evidenceId
          ) === playerId
        );
      });
      const supportingProviders = sortedUnique([
        ...rows.map((row) => row.content.provider),
        ...detailSupport.map((row) => row.content.provider),
      ]) as Provider[];
      if (status === 'single_source' && supportingProviders.length >= 2) status = 'corroborated';
      const matchingCustody = pickCustody.filter(
        (custody) =>
          isUsableCustody(custody) &&
          custody.draftYear === first.draftYear &&
          custody.draftType === first.draftType &&
          custody.recordedPickNumber === first.selectionNumber &&
          custody.currentClubId === clubId
      );
      const selectionPickId =
        matchingCustody.length === 1
          ? matchingCustody[0].pickId
          : pickId(first.draftYear, first.draftType, first.selectionNumber, first.roundNumber);
      if (matchingCustody.length !== 1 && status !== 'disputed') status = 'unresolved';
      return {
        selectionId: createAflTradeContentAddress('external-draft-selection', {
          draftYear: first.draftYear,
          draftType: first.draftType,
          selectionNumber: first.selectionNumber,
        }),
        draftYear: first.draftYear,
        draftType: first.draftType,
        selectionNumber: first.selectionNumber,
        roundNumber: first.roundNumber,
        pickId: selectionPickId,
        playerId,
        clubId,
        status,
        supportingProviders,
        evidenceIds: [...rows, ...detailSupport].map((row) => row.evidenceId).sort(),
      };
    })
    .sort(
      (left, right) =>
        left.draftYear - right.draftYear ||
        left.draftType.localeCompare(right.draftType) ||
        left.selectionNumber - right.selectionNumber
    );

  const pickLineage: CanonicalPickLineage[] = [];
  transfers.forEach((transfer) => {
    if (transfer.asset.kind !== 'pick_entitlement') return;
    if (transfer.status === 'unresolved' || transfer.status === 'disputed') {
      issues.push({
        code: 'lineage_unresolved',
        severity: 'blocking',
        subjectKey: `lineage:${transfer.transferId}`,
        detail: 'The transferred pick entitlement is not uniquely resolved to stable custody.',
        evidenceIds: transfer.evidenceIds,
      });
      return;
    }
    const transferredPick = transfer.asset;
    const matchingSelections = draftSelections.filter(
      (value) => value.pickId === transferredPick.pickId
    );
    if (matchingSelections.length !== 1) {
      if (matchingSelections.length === 0 && transferredPick.draftYear > anchorSeasonYear) {
        return;
      }
      issues.push({
        code: 'lineage_unresolved',
        severity: 'blocking',
        subjectKey: `lineage:${transfer.transferId}`,
        detail:
          matchingSelections.length === 0
            ? 'No final draft selection claim resolves this transferred pick entitlement.'
            : 'More than one final draft selection resolves this transferred pick entitlement.',
        evidenceIds: transfer.evidenceIds,
      });
      return;
    }
    const selection = matchingSelections[0];
    if (selection.status === 'unresolved' || selection.status === 'disputed') {
      issues.push({
        code: 'lineage_unresolved',
        severity: 'blocking',
        subjectKey: `lineage:${transfer.transferId}`,
        detail: 'The final draft selection is not uniquely resolved.',
        evidenceIds: sortedUnique([...transfer.evidenceIds, ...selection.evidenceIds]),
      });
      return;
    }
    pickLineage.push({
      lineageId: createAflTradeContentAddress('external-pick-lineage', {
        transferId: transfer.transferId,
        selectionId: selection.selectionId,
      }),
      pickId: transferredPick.pickId,
      transferId: transfer.transferId,
      selectionId: selection.selectionId,
      status: selection.status,
      evidenceIds: sortedUnique([...transfer.evidenceIds, ...selection.evidenceIds]),
    });
  });

  const content: AflTradeExternalReconciliationContent = {
    schemaVersion:
      sourceAuthority === undefined
        ? AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION
        : AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION,
    environment,
    competition,
    anchorSeasonYear,
    sourceBatchIds,
    ...(sourceAuthority === undefined ? {} : { sourceAuthority }),
    identityResolutionIds: identityResolutions.map((value) => value.resolutionId).sort(),
    transactions: transactions.sort((left, right) =>
      left.transactionId.localeCompare(right.transactionId)
    ),
    transfers: transfers.sort((left, right) => left.transferId.localeCompare(right.transferId)),
    draftSelections,
    pickCustody: pickCustody.sort((left, right) => left.custodyId.localeCompare(right.custodyId)),
    pickLineage: pickLineage.sort((left, right) => left.lineageId.localeCompare(right.lineageId)),
    issues: issues
      .map((issue) => ({ ...issue, evidenceIds: sortedUnique(issue.evidenceIds) }))
      .sort(
        (left, right) =>
          left.subjectKey.localeCompare(right.subjectKey) || left.code.localeCompare(right.code)
      ),
    reconciledAt,
    publicationEligible: false,
  };
  return {
    candidateId: createAflTradeContentAddress('external-reconciliation', content),
    content,
  };
}
