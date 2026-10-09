import { OFFICIAL_AFL_2010_REPORT } from './officialAflDraft2010PdfFacts';
import { reviewedOfficialAflMiniDraft2011EffectiveYear } from './officialAflMiniDraft2011SessionFacts';
import type { SpecialDraftEntitlement } from './specialDraftEntitlement';
import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  isDraftguruNationalYearAccessParserVersion,
  parseAflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION,
  aflTradeExternalReconciliationSourceAuthoritySchema,
  type AflTradeExternalReconciliationSourceAuthority,
} from './externalReconciliationSourceAuthorityContracts';
import {
  resolveCombinedDraftSessionEvidence,
  type CombinedDraftSessionFact,
} from './combinedDraftSessionEvidence';

/** Project source facts without resolving boundary identities or changing retained attribution. */
function projectCombinedSessionSourceFact(
  claim: Claim,
  source: Pick<CombinedDraftSessionFact, 'evidenceId' | 'captureId' | 'artifactId' | 'documentId'>
): CombinedDraftSessionFact | undefined {
  if (claim.kind === 'draft_session_date') {
    return {
      ...source,
      kind: 'completed_session_date',
      sessionOrdinal: claim.sessionOrdinal,
      eventDate: claim.eventDate,
    };
  }
  if (claim.kind === 'draft_session_completion') {
    return {
      ...source,
      kind: 'completed_session',
      sessionOrdinal: claim.sessionOrdinal,
    };
  }
  if (claim.kind === 'draft_completed_list_total')
    return { ...source, ...claim, kind: 'completed_draft_list_total' };
  if (claim.kind === 'draft_rookie_list_additions' || claim.kind === 'draft_rookie_promotion_slots')
    return { ...source, ...claim };
  if (claim.kind === 'draft_completed_total') {
    return { ...source, kind: 'completed_draft_total', selectionCount: claim.selectionCount };
  }
  if (claim.kind === 'draft_completed_inventory') {
    return {
      ...source,
      kind: 'completed_draft_inventory',
      selectionNumbers: claim.selectionNumbers,
    };
  }
  if (claim.kind === 'draft_completed_membership_roster') {
    return {
      ...source,
      kind: 'completed_draft_membership_roster',
      draftYear: claim.draftYear,
      draftType: claim.draftType,
      members: claim.members,
    };
  }
  if (claim.kind === 'draft_completed_member_number') {
    return {
      ...source,
      kind: 'completed_draft_member_number',
      draftYear: claim.draftYear,
      draftType: claim.draftType,
      recordedName: claim.recordedName,
      selectionNumber: claim.selectionNumber,
    };
  }
  if (claim.kind === 'draft_completed_member_exclusion') {
    return {
      ...source,
      kind: 'completed_draft_member_exclusion',
      draftYear: claim.draftYear,
      draftType: claim.draftType,
      recordedName: claim.recordedName,
      reason: claim.reason,
    };
  }
  return undefined;
}

export const AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION =
  'afl-trade-external-identity-resolution/v1' as const;
export const AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION =
  'afl-trade-external-reconciliation/v1' as const;

type Provider = AflTradeExternalEvidenceContent['provider'];
type Claim = AflTradeExternalEvidenceContent['claim'];
type RecordedEntity = Extract<Claim, { kind: 'transaction_party' }>['club'];
type Evidence = AflTradeExternalEvidenceBatch['content']['evidence'][number];

const reviewedCombinedDraftArticleIds = new Set([
  '114795',
  '45435',
  '469544',
  '53184',
  '39763',
  '99499',
  '140672',
  '98796',
  '142762',
  '83698',
  '46107',
  '157359',
  '49872',
  '149290',
  '78408',
  '39972',
  '117263',
  '452467',
  '149034',
  '68212',
  '162070',
  '156041',
  '56745',
  '87166',
  '453360',
  '38163',
  '506746',
  '75034',
  '453197',
  '469214',
  '453694',
]);

export function combinedDraftDocumentId(
  provider: Provider,
  sourceUrl: string,
  environment: 'test_fixture' | 'non_production' | 'production'
): string {
  if (provider === 'official_afl') {
    if (
      sourceUrl === OFFICIAL_AFL_2010_REPORT.url ||
      sourceUrl === 'https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are'
    )
      return sourceUrl;
    // Exact club URLs retain host-qualified identity, matching SQL's URL fallback.
    if (reviewedOfficialAflMiniDraft2011EffectiveYear(sourceUrl) !== null) return sourceUrl;
    try {
      const parsed = new URL(sourceUrl);
      const articleId = /^\/news\/(\d+)(?:\/|$)/.exec(parsed.pathname)?.[1];
      if (
        parsed.hostname === 'www.afl.com.au' &&
        articleId &&
        (environment === 'test_fixture' || reviewedCombinedDraftArticleIds.has(articleId))
      ) {
        return `official_afl:news:${articleId}`;
      }
    } catch {
      // Schema validation reports malformed source URLs before reconciliation.
    }
    throw new TypeError('Combined draft proof requires a reviewed Official AFL article identity.');
  }
  if (provider === 'statly_local_fixture' && environment === 'test_fixture') {
    return `statly_local_fixture:url:${sourceUrl}`;
  }
  throw new TypeError('Combined draft proof source cannot establish an authenticated document.');
}

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
    | 'lineage_unresolved'
    | 'pick_outcome_unresolved';
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
  | SpecialDraftEntitlement
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

/**
 * The provider's stated outcome for one received pick. It is single-source evidence kept apart from
 * governed lineage, which needs a proven custody chain: a `selected` outcome names the selection by
 * the stated player and the receiving club, never by pick number. `pending` is a pick whose draft
 * lies after the candidate's anchor season.
 */
interface CanonicalPickOutcome {
  outcomeId: string;
  transferId: string;
  disposition: 'selected' | 'traded_on' | 'not_used';
  outcomeStatus: 'stated' | 'pending' | 'unresolved';
  selectionId: string | null;
  playerId: string | null;
  /**
   * For a stated "not used" national pick whose draft is held: whether the receiving club took an
   * academy or father-son nominated player in that draft, as the Draftguru national-year page (v2)
   * records each selection's access. A nominated player is reached through a matched bid, which is how
   * a received pick can be spent without the club using it. A fact about the draft, not a valuation.
   */
  nominationBasis?:
    'club_took_nominated_player' | 'club_took_no_nominated_player' | 'no_access_evidence';
  receivingClubNominatedSelections?: number;
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
  pickOutcomes?: CanonicalPickOutcome[];
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

function resolveFutureOriginalClub(
  row: DirectedTransferEvidence,
  resolve: IdentityResolver
): string | null {
  const claim = row.content.claim;
  if (claim.asset.kind !== 'future_pick') return null;
  return resolve(
    row.content.provider,
    'club',
    claim.asset.originalClub,
    `transfer:${claim.nativeTransferId}:original-club`,
    row.evidenceId
  );
}

function futurePickTransferAsset(input: {
  row: DirectedTransferEvidence;
  claim: DirectedTransferClaim;
  originalClubId: string | null;
  pickCustody: readonly CanonicalPickCustody[];
  toClubId: string | null;
}): CanonicalTransferAsset {
  if (input.claim.asset.kind !== 'future_pick') {
    throw new TypeError('Future-pick transfer resolution received the wrong asset kind.');
  }
  const futurePick = input.claim.asset;
  const { originalClubId } = input;
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
        : createAflTradeContentAddress(
            'draft-pick',
            originalClubId === null
              ? { unresolvedTransferEvidenceId: input.row.evidenceId }
              : {
                  draftYear: futurePick.draftYear,
                  draftType: futurePick.draftType,
                  roundNumber: futurePick.roundNumber,
                  originalClubId,
                }
          ),
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

/** One directed transfer with its clubs resolved once, so a second lookup never repeats an issue. */
interface ResolvedDirectedTransfer {
  row: DirectedTransferEvidence;
  fromClubId: string | null;
  toClubId: string | null;
  /** Resolved only for a future pick; a current pick's original club comes from custody. */
  futureOriginalClubId: string | null;
}

function slotKey(draftYear: number, draftType: string, pick: number): string {
  return `${draftYear}|${draftType}|${pick}`;
}

/**
 * What the candidate's own transfers say about a numbered slot, used when the only custody
 * observation is a single pre-draft order. `holdings` records every club a transfer delivered the
 * slot to, as the slot number or as the future pick that became it; `components` groups the clubs
 * that traded the slot number among themselves, so a club two trades from the order's holder still
 * counts as holding that slot.
 */
interface SlotTransferIndex {
  holdings: ReadonlySet<string>;
  components: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

function futureHoldingKey(
  draftYear: number,
  draftType: string,
  roundNumber: number | null,
  originalClubId: string,
  clubId: string
): string {
  return `future|${draftYear}|${draftType}|${roundNumber ?? 'unknown'}|${originalClubId}|${clubId}`;
}

function indexSlotTransfers(transfers: readonly ResolvedDirectedTransfer[]): SlotTransferIndex {
  const holdings = new Set<string>();
  const neighbours = new Map<string, Map<string, Set<string>>>();
  for (const { row, fromClubId, toClubId, futureOriginalClubId } of transfers) {
    const asset = row.content.claim.asset;
    if (fromClubId === null || toClubId === null) continue;
    if (asset.kind === 'future_pick') {
      if (futureOriginalClubId !== null) {
        holdings.add(
          futureHoldingKey(
            asset.draftYear,
            asset.draftType,
            asset.roundNumber,
            futureOriginalClubId,
            toClubId
          )
        );
      }
      continue;
    }
    if (asset.kind !== 'current_pick' || asset.recordedPickNumber === null) continue;
    const key = slotKey(asset.draftYear, asset.draftType, asset.recordedPickNumber);
    holdings.add(`${key}|${toClubId}`);
    const graph = neighbours.get(key) ?? new Map<string, Set<string>>();
    (graph.get(fromClubId) ?? graph.set(fromClubId, new Set()).get(fromClubId)!).add(toClubId);
    (graph.get(toClubId) ?? graph.set(toClubId, new Set()).get(toClubId)!).add(fromClubId);
    neighbours.set(key, graph);
  }
  const components = new Map<string, Map<string, number>>();
  neighbours.forEach((graph, key) => {
    const labels = new Map<string, number>();
    let next = 0;
    graph.forEach((_adjacent, start) => {
      if (labels.has(start)) return;
      const label = next++;
      const queue = [start];
      labels.set(start, label);
      while (queue.length > 0) {
        const club = queue.shift()!;
        graph.get(club)?.forEach((adjacent) => {
          if (labels.has(adjacent)) return;
          labels.set(adjacent, label);
          queue.push(adjacent);
        });
      }
    });
    components.set(key, labels);
  });
  return { holdings, components };
}

interface CurrentPickCustodyMatchInput {
  custody: CanonicalPickCustody;
  pickCustody: readonly CanonicalPickCustody[];
  slotTransfers: SlotTransferIndex;
  currentPick: Extract<DirectedTransferClaim['asset'], { kind: 'current_pick' }>;
  eventClaim: Extract<Claim, { kind: 'transaction' }> | null;
  occurredOn: string | null;
  fromClubId: string;
  toClubId: string;
}

/** The slot and transfer describe the same draft, pick number and round, observed no earlier than the trade. */
function custodyDescribesCurrentPick(input: CurrentPickCustodyMatchInput): boolean {
  const { custody, currentPick } = input;
  return (
    input.eventClaim !== null &&
    isUsableCustody(custody) &&
    custody.draftYear === currentPick.draftYear &&
    custody.draftType === currentPick.draftType &&
    (input.occurredOn === null || custody.observedAt.slice(0, 10) >= input.occurredOn) &&
    (currentPick.recordedRoundNumber === undefined ||
      custody.roundNumber === null ||
      custody.roundNumber === currentPick.recordedRoundNumber)
  );
}

/**
 * A single order observation cannot show the slot's earlier holders. The candidate's own transfers
 * can: the sender must be the original club or have been delivered this slot (by number, or as the
 * future pick that became it), and the receiver must be the order's holder or have traded the slot
 * number with it. Only the slot's latest observation is read this way. Nothing else is inferred.
 */
function slotTransfersCorroborate(input: CurrentPickCustodyMatchInput): boolean {
  const { custody, currentPick } = input;
  if (
    custody.recordedPickNumber === null ||
    custody.originalClubId === null ||
    custody.currentClubId === null ||
    currentPick.recordedPickNumber !== custody.recordedPickNumber
  ) {
    return false;
  }
  const superseded = input.pickCustody.some(
    (later) =>
      isUsableCustody(later) &&
      later.pickId === custody.pickId &&
      later.observedAt > custody.observedAt
  );
  if (superseded) return false;
  const key = slotKey(custody.draftYear, custody.draftType, custody.recordedPickNumber);
  const senderHeld =
    custody.originalClubId === input.fromClubId ||
    input.slotTransfers.holdings.has(`${key}|${input.fromClubId}`) ||
    input.slotTransfers.holdings.has(
      futureHoldingKey(
        custody.draftYear,
        custody.draftType,
        custody.roundNumber,
        custody.originalClubId,
        input.fromClubId
      )
    );
  if (!senderHeld) return false;
  if (custody.currentClubId === input.toClubId) return true;
  const labels = input.slotTransfers.components.get(key);
  const holderLabel = labels?.get(custody.currentClubId);
  return holderLabel !== undefined && labels?.get(input.toClubId) === holderLabel;
}

function matchesCurrentPickCustody(input: CurrentPickCustodyMatchInput): boolean {
  if (!custodyDescribesCurrentPick(input)) return false;
  const { custody } = input;
  const priorCustody = latestPriorCustody(input.pickCustody, custody);
  if (priorCustody) {
    return (
      custody.currentClubId === input.toClubId &&
      priorCustody.currentClubId === input.fromClubId &&
      (input.occurredOn === null || priorCustody.observedAt.slice(0, 10) <= input.occurredOn)
    );
  }
  return (
    (custody.currentClubId === input.toClubId && custody.originalClubId === input.fromClubId) ||
    slotTransfersCorroborate(input)
  );
}

function currentPickTransferAsset(input: {
  claim: DirectedTransferClaim;
  transactionClaimsByNativeEventId: ReadonlyMap<string, readonly TransactionEvidence[]>;
  pickCustody: readonly CanonicalPickCustody[];
  slotTransfers: SlotTransferIndex;
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
  const { fromClubId, toClubId } = input;
  const custodyMatches =
    fromClubId === null || toClubId === null
      ? []
      : input.pickCustody.filter((custody) =>
          matchesCurrentPickCustody({
            custody,
            pickCustody: input.pickCustody,
            slotTransfers: input.slotTransfers,
            currentPick,
            eventClaim,
            occurredOn,
            fromClubId,
            toClubId,
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

function resolveDirectedTransfer(
  row: DirectedTransferEvidence,
  resolve: IdentityResolver
): ResolvedDirectedTransfer {
  const claim = row.content.claim;
  const club = (sourceIdentity: RecordedEntity, side: 'from' | 'to') =>
    resolve(
      row.content.provider,
      'club',
      sourceIdentity,
      `transfer:${claim.nativeTransferId}:${side}`,
      row.evidenceId
    );
  return {
    row,
    fromClubId: club(claim.fromClub, 'from'),
    toClubId: club(claim.toClub, 'to'),
    futureOriginalClubId: resolveFutureOriginalClub(row, resolve),
  };
}

function reconcileDirectedTransfer(input: {
  transfer: ResolvedDirectedTransfer;
  resolve: IdentityResolver;
  pickCustody: readonly CanonicalPickCustody[];
  slotTransfers: SlotTransferIndex;
  transactionClaimsByNativeEventId: ReadonlyMap<string, readonly TransactionEvidence[]>;
}): CanonicalTransfer {
  const { row, fromClubId, toClubId } = input.transfer;
  const claim = row.content.claim;
  const transactionId = createAflTradeContentAddress('external-transaction', {
    provider: row.content.provider,
    nativeEventId: claim.nativeEventId,
  });
  const asset =
    claim.asset.kind === 'special_pick'
      ? claim.asset
      : claim.asset.kind === 'player'
        ? playerTransferAsset({ row, claim, resolve: input.resolve })
        : claim.asset.kind === 'future_pick'
          ? futurePickTransferAsset({
              row,
              claim,
              originalClubId: input.transfer.futureOriginalClubId,
              pickCustody: input.pickCustody,
              toClubId,
            })
          : currentPickTransferAsset({
              claim,
              transactionClaimsByNativeEventId: input.transactionClaimsByNativeEventId,
              pickCustody: input.pickCustody,
              slotTransfers: input.slotTransfers,
              fromClubId,
              toClubId,
            });
  const custodyResolved =
    asset.kind !== 'special_pick' &&
    (asset.kind !== 'pick_entitlement' ||
      input.pickCustody.some(
        (custody) => custody.pickId === asset.pickId && isUsableCustody(custody)
      ));
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
    evidenceIds: [row.evidenceId],
  };
}

type PickDispositionEvidence = Evidence & {
  content: { claim: Extract<Claim, { kind: 'pick_disposition' }> };
};

type NominationFacts = Pick<
  CanonicalPickOutcome,
  'nominationBasis' | 'receivingClubNominatedSelections'
>;

type NominatedSelectionCount = { count: number; evidenceIds: string[] };

/**
 * Counts a club's selections in one draft that a Draftguru national-year page read at parser v2
 * states were reached through academy or father-son access, with the evidence it read. Returns null
 * unless the draft's membership is proven independently of that page: the reviewed official AFL
 * completed-session claims must list selections 1 to N with no gap, the candidate's selections in
 * the draft must be exactly those numbers, and each must carry exactly one stated category. A
 * partial or disputed year page therefore proves nothing about a club whose rows it omits.
 */
function createNominatedSelectionCounter(
  evidence: readonly Evidence[],
  draftSelections: readonly CanonicalDraftSelection[]
): (draftYear: number, draftType: string, clubId: string) => NominatedSelectionCount | null {
  const accessByEvidence = new Map<string, 'open' | 'academy' | 'father_son'>();
  const sessionNumbers = new Map<string, Set<number>>();
  const sessionEvidence = new Set<string>();
  for (const row of evidence) {
    const claim = row.content.claim;
    if (row.content.provider === 'official_afl' && claim.kind === 'draft_session') {
      const key = `${claim.draftYear}|${claim.draftType}`;
      const numbers = sessionNumbers.get(key) ?? new Set<number>();
      claim.selectionNumbers.forEach((number) => numbers.add(number));
      sessionNumbers.set(key, numbers);
      sessionEvidence.add(row.evidenceId);
      continue;
    }
    if (
      row.content.provider === 'draftguru' &&
      isDraftguruNationalYearAccessParserVersion(row.content.capture.parserVersion) &&
      claim.kind === 'draft_selection' &&
      claim.accessCategory !== undefined
    ) {
      accessByEvidence.set(row.evidenceId, claim.accessCategory);
    }
  }
  const accessOf = (selection: CanonicalDraftSelection) => {
    const categories = new Set(
      selection.evidenceIds.flatMap((id) => accessByEvidence.get(id) ?? [])
    );
    return categories.size === 1 ? [...categories][0]! : null;
  };
  const membershipProven = (draftYear: number, draftType: string, inDraft: number[]) => {
    const official = [...(sessionNumbers.get(`${draftYear}|${draftType}`) ?? [])].sort(
      (left, right) => left - right
    );
    return (
      official.length > 0 &&
      official.every((number, index) => number === index + 1) &&
      inDraft.length === official.length &&
      inDraft.every((number, index) => number === official[index])
    );
  };
  return (draftYear, draftType, clubId) => {
    const inDraft = draftSelections
      .filter((selection) => selection.draftYear === draftYear && selection.draftType === draftType)
      .sort((left, right) => left.selectionNumber - right.selectionNumber);
    if (
      !membershipProven(
        draftYear,
        draftType,
        inDraft.map(({ selectionNumber }) => selectionNumber)
      ) ||
      inDraft.some((selection) => accessOf(selection) === null)
    ) {
      return null;
    }
    const clubs = inDraft.filter((selection) => selection.clubId === clubId);
    return {
      count: clubs.filter((selection) => accessOf(selection) !== 'open').length,
      evidenceIds: sortedUnique(
        clubs.flatMap(({ evidenceIds }) =>
          evidenceIds.filter((id) => accessByEvidence.has(id) || sessionEvidence.has(id))
        )
      ),
    };
  };
}

/**
 * A "not used" pick in a draft after the anchor season is pending. Otherwise it is stated, and a
 * national pick also records whether the receiving club took a nominated player in that draft: the
 * only sourceable fact about a pick spent matching a bid or passed. Without complete access
 * evidence the count is left unknown.
 */
function classifyNotUsedPick(
  asset: { draftYear: number; draftType: string },
  anchorSeasonYear: number,
  countNominated: () => NominatedSelectionCount | null
): {
  status: CanonicalPickOutcome['outcomeStatus'];
  nomination: NominationFacts;
  evidenceIds: string[];
} {
  if (asset.draftYear > anchorSeasonYear) {
    return { status: 'pending', nomination: {}, evidenceIds: [] };
  }
  if (asset.draftType !== 'national') return { status: 'stated', nomination: {}, evidenceIds: [] };
  const counted = countNominated();
  if (counted === null) {
    return {
      status: 'stated',
      nomination: { nominationBasis: 'no_access_evidence' },
      evidenceIds: [],
    };
  }
  return {
    status: 'stated',
    nomination: {
      nominationBasis:
        counted.count > 0 ? 'club_took_nominated_player' : 'club_took_no_nominated_player',
      receivingClubNominatedSelections: counted.count,
    },
    evidenceIds: counted.evidenceIds,
  };
}

/**
 * Binds each `pick_disposition` claim to its directed transfer and, for a selected pick, to the one
 * selection of the stated player by the receiving club in the pick's draft year. The disposition's
 * evidence id joins its transfer's evidence, so the candidate's child tables conserve it.
 */
function reconcilePickDispositions(input: {
  evidence: readonly Evidence[];
  transfers: CanonicalTransfer[];
  draftSelections: readonly CanonicalDraftSelection[];
  anchorSeasonYear: number;
  resolve: IdentityResolver;
  issues: ReconciliationIssue[];
}): CanonicalPickOutcome[] {
  const dispositions = input.evidence.filter(
    (row): row is PickDispositionEvidence =>
      (row.content.provider === 'draftguru' || row.content.provider === 'statly_local_fixture') &&
      row.content.claim.kind === 'pick_disposition'
  );
  const transfersById = new Map(input.transfers.map((transfer) => [transfer.transferId, transfer]));
  const nominatedSelections = createNominatedSelectionCounter(
    input.evidence,
    input.draftSelections
  );
  const outcomes: CanonicalPickOutcome[] = [];
  for (const row of dispositions) {
    const claim = row.content.claim;
    const transferId = createAflTradeContentAddress('external-transfer', {
      transactionId: createAflTradeContentAddress('external-transaction', {
        provider: row.content.provider,
        nativeEventId: claim.nativeEventId,
      }),
      nativeTransferId: claim.nativeTransferId,
    });
    const transfer = transfersById.get(transferId);
    const unresolved = (detail: string, evidenceIds: readonly string[] = [row.evidenceId]) =>
      input.issues.push({
        code: 'pick_outcome_unresolved',
        severity: 'blocking',
        subjectKey: `pick-outcome:${claim.nativeEventId}:${claim.nativeTransferId}`,
        detail,
        evidenceIds: sortedUnique(evidenceIds),
      });
    if (!transfer || transfer.asset.kind !== 'pick_entitlement') {
      unresolved('The stated pick outcome has no matching pick transfer in this candidate.');
      continue;
    }
    transfer.evidenceIds = sortedUnique([...transfer.evidenceIds, row.evidenceId]);
    const asset = transfer.asset;
    const receivingClubId = input.resolve(
      row.content.provider,
      'club',
      claim.receivingClub,
      `pick-outcome:${claim.nativeTransferId}:receiving-club`,
      row.evidenceId
    );
    const record = (
      outcomeStatus: CanonicalPickOutcome['outcomeStatus'],
      selection: CanonicalDraftSelection | null,
      playerId: string | null,
      nomination: NominationFacts = {},
      supportingEvidenceIds: readonly string[] = []
    ) =>
      outcomes.push({
        outcomeId: createAflTradeContentAddress('external-pick-outcome', {
          transferId,
          evidenceId: row.evidenceId,
        }),
        transferId,
        disposition: claim.disposition,
        outcomeStatus,
        selectionId: selection?.selectionId ?? null,
        playerId,
        ...nomination,
        evidenceIds: sortedUnique([
          row.evidenceId,
          ...(selection?.evidenceIds ?? []),
          ...supportingEvidenceIds,
        ]),
      });
    if (receivingClubId === null || receivingClubId !== transfer.toClubId) {
      unresolved('The stated receiving club does not resolve to the transfer’s receiving club.', [
        row.evidenceId,
        ...transfer.evidenceIds,
      ]);
      record('unresolved', null, null);
      continue;
    }
    if (claim.disposition === 'traded_on') {
      record('stated', null, null);
      continue;
    }
    if (claim.disposition === 'not_used') {
      const outcome = classifyNotUsedPick(asset, input.anchorSeasonYear, () =>
        nominatedSelections(asset.draftYear, asset.draftType, receivingClubId)
      );
      record(outcome.status, null, null, outcome.nomination, outcome.evidenceIds);
      continue;
    }
    const playerId = claim.player
      ? input.resolve(
          row.content.provider,
          'player',
          claim.player,
          `pick-outcome:${claim.nativeTransferId}:player`,
          row.evidenceId
        )
      : null;
    const matches = input.draftSelections.filter(
      (selection) =>
        playerId !== null &&
        selection.playerId === playerId &&
        selection.clubId === receivingClubId &&
        selection.draftYear === asset.draftYear &&
        selection.draftType === asset.draftType &&
        // The slot's own custody may be unresolved; the outcome needs only player, club and draft,
        // which a disputed selection does not settle.
        selection.status !== 'disputed'
    );
    if (matches.length !== 1) {
      unresolved(
        matches.length === 0
          ? 'No undisputed selection of the stated player by the receiving club in the pick’s draft.'
          : 'More than one selection of the stated player by the receiving club in the pick’s draft.',
        [row.evidenceId, ...matches.flatMap(({ evidenceIds }) => evidenceIds)]
      );
      record('unresolved', null, playerId);
      continue;
    }
    record('stated', matches[0]!, playerId);
  }
  return outcomes.sort((left, right) => left.outcomeId.localeCompare(right.outcomeId));
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
  const resolvedTransfers = directedTransfers.map((row) => resolveDirectedTransfer(row, resolve));
  const slotTransfers = indexSlotTransfers(resolvedTransfers);
  const transfers: CanonicalTransfer[] = resolvedTransfers.map((transfer) =>
    reconcileDirectedTransfer({
      transfer,
      resolve,
      pickCustody,
      slotTransfers,
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
  const sessionClaims = evidence.filter(
    (row): row is Evidence & { content: { claim: Extract<Claim, { kind: 'draft_session' }> } } =>
      row.content.claim.kind === 'draft_session'
  );
  for (const session of sessionClaims) {
    const claim = session.content.claim;
    if (
      claim.selectionNumbers.some(
        (number) =>
          !selectionClaims.some(
            ({ content }) =>
              content.claim.draftYear === claim.draftYear &&
              content.claim.draftType === claim.draftType &&
              content.claim.selectionNumber === number
          )
      )
    ) {
      issues.push({
        code: 'selection_conflict',
        severity: 'blocking',
        subjectKey: `draft-session:${claim.draftYear}:${claim.draftType}:${claim.sessionOrdinal}`,
        detail: 'Draft session evidence names a selection absent from the reviewed source set.',
        evidenceIds: [session.evidenceId],
      });
    }
  }
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
      const sessionSupport = sessionClaims.filter(
        ({ content }) =>
          content.claim.draftYear === first.draftYear &&
          content.claim.draftType === first.draftType &&
          content.claim.selectionNumbers.includes(first.selectionNumber)
      );
      if (
        new Set(
          sessionSupport.map(
            ({ content }) => `${content.claim.sessionOrdinal}|${content.claim.eventDate}`
          )
        ).size > 1
      ) {
        status = 'disputed';
        issues.push({
          code: 'selection_conflict',
          severity: 'blocking',
          subjectKey: `selection:${first.draftYear}:${first.draftType}:${first.selectionNumber}`,
          detail: 'Retained source claims disagree on the selection session or date.',
          evidenceIds: sessionSupport.map(({ evidenceId }) => evidenceId).sort(),
        });
      }
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
      // A completed selection is evidence of recruitment, not of the pick's prior owner.
      // Keep its slot identity when a dated session is retained and no custody claim
      // exists for that slot. Conflicting or incomplete custody remains unresolved.
      const datedSelectionWithoutCustody =
        new Set(
          sessionSupport.map(
            ({ content }) => `${content.claim.sessionOrdinal}|${content.claim.eventDate}`
          )
        ).size === 1 &&
        !pickCustody.some(
          (custody) =>
            custody.draftYear === first.draftYear &&
            custody.draftType === first.draftType &&
            custody.recordedPickNumber === first.selectionNumber
        );
      if (matchingCustody.length !== 1 && !datedSelectionWithoutCustody && status !== 'disputed')
        status = 'unresolved';
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
        evidenceIds: [...rows, ...detailSupport, ...sessionSupport]
          .map((row) => row.evidenceId)
          .sort(),
      };
    })
    .sort(
      (left, right) =>
        left.draftYear - right.draftYear ||
        left.draftType.localeCompare(right.draftType) ||
        left.selectionNumber - right.selectionNumber
    );

  const partialSessionClaims = evidence.filter(({ content }) =>
    [
      'draft_session_date',
      'draft_session_completion',
      'draft_session_boundary',
      'draft_session_member_identity',
      'draft_completed_total',
      'draft_completed_list_total',
      'draft_rookie_list_additions',
      'draft_rookie_promotion_slots',
      'draft_completed_inventory',
      'draft_completed_membership_roster',
      'draft_completed_member_number',
      'draft_completed_member_exclusion',
    ].includes(content.claim.kind)
  );
  const partialSessionKeys = sortedUnique(
    partialSessionClaims.map(({ content }) => {
      const claim = content.claim as Extract<
        Claim,
        {
          kind:
            | 'draft_session_date'
            | 'draft_session_completion'
            | 'draft_session_boundary'
            | 'draft_session_member_identity'
            | 'draft_completed_total'
            | 'draft_completed_list_total'
            | 'draft_rookie_list_additions'
            | 'draft_rookie_promotion_slots'
            | 'draft_completed_inventory'
            | 'draft_completed_membership_roster'
            | 'draft_completed_member_number'
            | 'draft_completed_member_exclusion';
        }
      >;
      return `${claim.draftYear}|${claim.draftType}`;
    })
  );
  for (const key of partialSessionKeys) {
    const [yearText, draftType] = key.split('|');
    const draftYear = Number(yearText);
    const scoped = partialSessionClaims.filter(({ content }) => {
      const claim = content.claim as Extract<
        Claim,
        {
          kind:
            | 'draft_session_date'
            | 'draft_session_completion'
            | 'draft_session_boundary'
            | 'draft_session_member_identity'
            | 'draft_completed_total'
            | 'draft_completed_list_total'
            | 'draft_rookie_list_additions'
            | 'draft_rookie_promotion_slots'
            | 'draft_completed_inventory'
            | 'draft_completed_membership_roster'
            | 'draft_completed_member_number'
            | 'draft_completed_member_exclusion';
        }
      >;
      return claim.draftYear === draftYear && claim.draftType === draftType;
    });
    try {
      const facts: CombinedDraftSessionFact[] = scoped.map((row) => {
        const claim = row.content.claim;
        const source = {
          evidenceId: row.evidenceId,
          captureId: row.content.capture.captureId,
          artifactId: row.content.capture.artifactId,
          documentId: combinedDraftDocumentId(
            row.content.provider,
            row.content.capture.sourceUrl,
            input.environment
          ),
        };
        const sourceFact = projectCombinedSessionSourceFact(claim, source);
        if (sourceFact) return sourceFact;
        if (
          claim.kind !== 'draft_session_boundary' &&
          claim.kind !== 'draft_session_member_identity'
        ) {
          throw new TypeError('Unexpected combined draft-session evidence kind.');
        }
        const playerId = resolve(
          row.content.provider,
          'player',
          claim.player,
          `draft-session:${claim.draftYear}:${claim.draftType}:${claim.sessionOrdinal}:${claim.kind === 'draft_session_boundary' ? claim.boundary : 'member'}:player`,
          row.evidenceId
        );
        const clubId = resolve(
          row.content.provider,
          'club',
          claim.selectedByClub,
          `draft-session:${claim.draftYear}:${claim.draftType}:${claim.sessionOrdinal}:${claim.kind === 'draft_session_boundary' ? claim.boundary : 'member'}:club`,
          row.evidenceId
        );
        if (claim.kind === 'draft_session_member_identity')
          return {
            ...source,
            kind: 'session_member_identity',
            sessionOrdinal: claim.sessionOrdinal,
            selectionNumber: claim.selectionNumber,
            playerId: playerId ?? '',
            clubId: clubId ?? '',
          };
        return {
          ...source,
          kind: 'session_boundary',
          sessionOrdinal: claim.sessionOrdinal,
          boundary: claim.boundary,
          selectionNumber: claim.selectionNumber,
          playerId: playerId ?? '',
          clubId: clubId ?? '',
        };
      });
      const sessions = resolveCombinedDraftSessionEvidence({
        draftYear,
        draftType: draftType!,
        officialName: `${draftYear} AFL Draft`,
        selections: draftSelections
          .filter(
            (selection) => selection.draftYear === draftYear && selection.draftType === draftType
          )
          .map((selection) => ({
            selectionId: selection.selectionId,
            selectionNumber: selection.selectionNumber,
            playerId: selection.playerId ?? '',
            clubId: selection.clubId ?? '',
          })),
        facts,
      });
      for (const session of sessions) {
        for (const selection of draftSelections.filter(({ selectionId }) =>
          session.selectionIds.includes(selectionId)
        )) {
          selection.evidenceIds = sortedUnique([...selection.evidenceIds, ...session.evidenceIds]);
          const hasCustody = pickCustody.some(
            (custody) =>
              custody.draftYear === selection.draftYear &&
              custody.draftType === selection.draftType &&
              custody.recordedPickNumber === selection.selectionNumber
          );
          if (
            selection.status === 'unresolved' &&
            selection.playerId !== null &&
            selection.clubId !== null &&
            !hasCustody
          ) {
            selection.status =
              selection.supportingProviders.length > 1 ? 'corroborated' : 'single_source';
          }
        }
      }
    } catch (error) {
      issues.push({
        code: 'selection_conflict',
        severity: 'blocking',
        subjectKey: `combined-draft-session:${key}`,
        detail:
          error instanceof Error ? error.message : 'Combined draft-session evidence is invalid.',
        evidenceIds: scoped.map(({ evidenceId }) => evidenceId).sort(),
      });
    }
  }

  const pickLineage: CanonicalPickLineage[] = [];
  transfers.forEach((transfer) => {
    if (transfer.asset.kind === 'special_pick') {
      issues.push({
        code: 'lineage_unresolved',
        severity: 'blocking',
        subjectKey: `lineage:${transfer.transferId}`,
        detail:
          'Special entitlement requires independently resolved award, activation and custody evidence.',
        evidenceIds: transfer.evidenceIds,
      });
      return;
    }
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

  const pickOutcomes = reconcilePickDispositions({
    evidence,
    transfers,
    draftSelections,
    anchorSeasonYear,
    resolve,
    issues,
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
    // Only candidates with dispositions carry the key, so earlier candidate ids are unchanged.
    ...(pickOutcomes.length === 0 ? {} : { pickOutcomes }),
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
