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
import {
  aflTradeDeferredCustodyIds,
  aflTradePromotedCustodyIds,
  aflTradePromotedDrafts,
  aflTradePromotedTransactions,
  isAflTradePickSideReconciliationIssue,
  type AflTradeCurrentCanonicalPickCustody,
  type AflTradeCurrentCanonicalTransaction,
  type AflTradePickLineageDeferral,
} from './pickLineageDeferral';

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
  'footyinfo',
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
  /** `deferred` only under a reviewed pick-side deferral (`pickLineageDeferral`), never on a player-side subject. */
  severity: 'blocking' | 'deferred';
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
    | 'club_took_nominated_player'
    | 'club_took_no_nominated_player'
    | 'no_access_evidence'
    | 'board_pick_passed_or_removed';
  receivingClubNominatedSelections?: number;
  /**
   * With `board_pick_passed_or_removed` only: the Footyinfo board pick that states this pick was
   * passed or removed at the draft. A board lists a pick spent matching a bid as points, never as a
   * board pick, so a passed or removed pick was not consumed by a nominee.
   */
  boardPickId?: string;
  evidenceIds: string[];
}

/**
 * One pick a Footyinfo national draft board states (`draft_board_pick`, issues 853 and 789): the
 * holder at the draft, the round, the number when selected, and the printed route resolved club by
 * club (original club first, holder last; empty when the board prints none). `routeClubIds` and
 * `clubId` are null when a club has no reviewed resolution. Every board row is one record, so the
 * candidate conserves it whether or not reconciliation reads it.
 */
interface CanonicalDraftBoardPick {
  boardPickId: string;
  draftYear: number;
  draftType: string;
  roundNumber: number | null;
  recordedPickNumber: number | null;
  status: 'selected' | 'passed' | 'removed';
  clubId: string | null;
  routeClubIds: string[] | null;
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
  /** Present only when a Footyinfo board was reconciled, so earlier candidate ids are unchanged. */
  draftBoardPicks?: CanonicalDraftBoardPick[];
  /**
   * The approved `reconciliation_scope` decision under which pick-side issues are `deferred`. Present
   * only when at least one issue was deferred, so a candidate without deferral keeps its id.
   */
  pickLineageDeferral?: AflTradePickLineageDeferral;
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
  const entitlementId =
    originalClubId === null
      ? null
      : createAflTradeContentAddress('draft-pick', {
          draftYear: futurePick.draftYear,
          draftType: futurePick.draftType,
          roundNumber: futurePick.roundNumber,
          originalClubId,
        });
  // Two picks of one club in one round collapse to one entitlement id, which the custody rows record
  // as disputed. Neither pick can be told from the other by its round and original club, so each
  // transfer of it is its own pick until reviewed evidence says which (pick-identity rule 7).
  const disputed = input.pickCustody.some(
    (custody) => custody.pickId === entitlementId && custody.status === 'disputed'
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
      entitlementId === null
        ? createAflTradeContentAddress('draft-pick', {
            unresolvedTransferEvidenceId: input.row.evidenceId,
          })
        : disputed
          ? createAflTradeContentAddress('draft-pick', {
              draftYear: futurePick.draftYear,
              draftType: futurePick.draftType,
              roundNumber: futurePick.roundNumber,
              originalClubId,
              disputedTransferEvidenceId: input.row.evidenceId,
            })
          : custodyMatches.length === 1
            ? custodyMatches[0].pickId
            : entitlementId,
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
 * counts as holding that slot. `numberedPairs` counts the numbered current-pick transfers from one
 * club to another in a draft, and `custodyPairs` the usable custody rows with one original club and
 * holder in a draft, so a differently numbered slot is joined only when both sides are unique.
 */
interface SlotTransferIndex {
  holdings: ReadonlySet<string>;
  components: ReadonlyMap<string, ReadonlyMap<string, number>>;
  numberedPairs: ReadonlyMap<string, number>;
  custodyPairs: ReadonlyMap<string, number>;
}

function clubPairKey(
  draftYear: number,
  draftType: string,
  firstClubId: string,
  secondClubId: string
): string {
  return `${draftYear}|${draftType}|${firstClubId}|${secondClubId}`;
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

function indexSlotTransfers(
  transfers: readonly ResolvedDirectedTransfer[],
  pickCustody: readonly CanonicalPickCustody[]
): SlotTransferIndex {
  const holdings = new Set<string>();
  const neighbours = new Map<string, Map<string, Set<string>>>();
  const numberedPairs = new Map<string, number>();
  const custodyPairs = new Map<string, number>();
  for (const custody of pickCustody) {
    if (
      !isUsableCustody(custody) ||
      custody.originalClubId === null ||
      custody.currentClubId === null
    ) {
      continue;
    }
    const pair = clubPairKey(
      custody.draftYear,
      custody.draftType,
      custody.originalClubId,
      custody.currentClubId
    );
    custodyPairs.set(pair, (custodyPairs.get(pair) ?? 0) + 1);
  }
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
    const pair = clubPairKey(asset.draftYear, asset.draftType, fromClubId, toClubId);
    numberedPairs.set(pair, (numberedPairs.get(pair) ?? 0) + 1);
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
  return { holdings, components, numberedPairs, custodyPairs };
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

/**
 * A pick can shift slot before draft night (#519), so a differently numbered slot still joins when
 * the transfer is the candidate's only numbered transfer from the sender to the receiver in that
 * draft and the slot is the only usable custody row with that original club and holder.
 */
function uniqueShiftedSlot(input: CurrentPickCustodyMatchInput): boolean {
  const { custody, currentPick } = input;
  if (
    custody.recordedPickNumber === null ||
    currentPick.recordedPickNumber === null ||
    custody.originalClubId === null ||
    custody.currentClubId === null
  ) {
    return false;
  }
  const { numberedPairs, custodyPairs } = input.slotTransfers;
  return (
    numberedPairs.get(
      clubPairKey(currentPick.draftYear, currentPick.draftType, input.fromClubId, input.toClubId)
    ) === 1 &&
    custodyPairs.get(
      clubPairKey(
        custody.draftYear,
        custody.draftType,
        custody.originalClubId,
        custody.currentClubId
      )
    ) === 1
  );
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
    (custody.currentClubId === input.toClubId &&
      custody.originalClubId === input.fromClubId &&
      ((custody.recordedPickNumber !== null &&
        input.currentPick.recordedPickNumber === custody.recordedPickNumber) ||
        uniqueShiftedSlot(input))) ||
    slotTransfersCorroborate(input)
  );
}

function currentPickCustodyMatches(input: {
  transfer: ResolvedDirectedTransfer;
  transactionClaimsByNativeEventId: ReadonlyMap<string, readonly TransactionEvidence[]>;
  pickCustody: readonly CanonicalPickCustody[];
  slotTransfers: SlotTransferIndex;
}): CanonicalPickCustody[] {
  const { row, fromClubId, toClubId } = input.transfer;
  const claim = row.content.claim;
  if (claim.asset.kind !== 'current_pick' || fromClubId === null || toClubId === null) return [];
  const currentPick = claim.asset;
  const eventClaims = input.transactionClaimsByNativeEventId.get(claim.nativeEventId) ?? [];
  const eventClaim = eventClaims.length === 1 ? eventClaims[0].content.claim : null;
  const occurredOn = eventClaim?.occurredOn ?? null;
  return input.pickCustody.filter((custody) =>
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
}

function currentPickNumberKey(
  currentPick: Extract<DirectedTransferClaim['asset'], { kind: 'current_pick' }>
): string {
  return pickId(
    currentPick.draftYear,
    currentPick.draftType,
    currentPick.recordedPickNumber,
    currentPick.recordedRoundNumber ?? null
  );
}

/**
 * The pick id of a numbered transfer no custody observation resolves: its number, scoped to the
 * transfer's own evidence row. A number names a slot only as one page then stood, so two transfers
 * (or a transfer and a selection) sharing a number are not thereby one pick (pick-identity rule 6);
 * only custody, a stated eventual selection or reviewed lineage joins them.
 */
function currentPickNumberOnlyId(
  currentPick: Extract<DirectedTransferClaim['asset'], { kind: 'current_pick' }>,
  transferEvidenceId: string
): string {
  return createAflTradeContentAddress('draft-pick', {
    draftYear: currentPick.draftYear,
    draftType: currentPick.draftType,
    nominalPick: currentPick.recordedPickNumber,
    nominalRound: currentPick.recordedRoundNumber ?? null,
    transferEvidenceId,
  });
}

/**
 * Re-keys numbered pick transfers per slot chain when the join reads a single custody observation
 * (a pre-draft order). A chain is the transfers that shared one number key before the join and
 * whose clubs traded that number among themselves (one `components` group). If the chain's matches
 * name exactly one custody pick, every transfer in the chain takes it; if any transfer matches two
 * custody records or the chain would map to two custody picks, the whole chain stays on its number
 * key. Splitting a chain would orphan the grader's traded-on link between its hops. A custody pick
 * observed more than once is a sequence that proves or refuses each hop on its own (a premature or
 * interrupted observation stays unresolved), so its chains keep the per-transfer rule.
 */
function joinSlotChains(input: {
  transfers: readonly ResolvedDirectedTransfer[];
  transactionClaimsByNativeEventId: ReadonlyMap<string, readonly TransactionEvidence[]>;
  pickCustody: readonly CanonicalPickCustody[];
  slotTransfers: SlotTransferIndex;
}): ReadonlyMap<ResolvedDirectedTransfer, CanonicalPickCustody | null> {
  const chains = new Map<string, ResolvedDirectedTransfer[]>();
  input.transfers.forEach((transfer, index) => {
    const asset = transfer.row.content.claim.asset;
    if (asset.kind !== 'current_pick') return;
    const numberKey = currentPickNumberKey(asset);
    const labels =
      asset.recordedPickNumber === null
        ? undefined
        : input.slotTransfers.components.get(
            slotKey(asset.draftYear, asset.draftType, asset.recordedPickNumber)
          );
    const fromLabel = transfer.fromClubId === null ? undefined : labels?.get(transfer.fromClubId);
    const toLabel = transfer.toClubId === null ? undefined : labels?.get(transfer.toClubId);
    const chainKey =
      fromLabel !== undefined && fromLabel === toLabel
        ? `${numberKey}|chain|${fromLabel}`
        : `${numberKey}|alone|${index}`;
    (chains.get(chainKey) ?? chains.set(chainKey, []).get(chainKey)!).push(transfer);
  });
  const observations = new Map<string, number>();
  input.pickCustody.forEach((custody) => {
    if (isUsableCustody(custody)) {
      observations.set(custody.pickId, (observations.get(custody.pickId) ?? 0) + 1);
    }
  });
  const decided = new Map<ResolvedDirectedTransfer, CanonicalPickCustody | null>();
  chains.forEach((members) => {
    const matches = members.map((transfer) => currentPickCustodyMatches({ ...input, transfer }));
    const readsOrder = matches.some((found) =>
      found.some((custody) => observations.get(custody.pickId) === 1)
    );
    if (!readsOrder) {
      members.forEach((transfer, index) => {
        decided.set(transfer, matches[index].length === 1 ? matches[index][0] : null);
      });
      return;
    }
    const matched = matches.flatMap((found) => (found.length === 1 ? found : []));
    const unique =
      matches.every((found) => found.length <= 1) &&
      new Set(matched.map((custody) => custody.pickId)).size === 1;
    members.forEach((transfer, index) => {
      decided.set(transfer, unique ? (matches[index][0] ?? null) : null);
    });
  });
  return decided;
}

function currentPickTransferAsset(input: {
  row: DirectedTransferEvidence;
  claim: DirectedTransferClaim;
  exactCustody: CanonicalPickCustody | null;
}): CanonicalTransferAsset {
  if (input.claim.asset.kind !== 'current_pick') {
    throw new TypeError('Current-pick transfer resolution received the wrong asset kind.');
  }
  const currentPick = input.claim.asset;
  const { exactCustody } = input;
  return {
    kind: 'pick_entitlement',
    pickId: exactCustody
      ? exactCustody.pickId
      : currentPickNumberOnlyId(currentPick, input.row.evidenceId),
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

/**
 * Records `pick_identity_conflict` under a `pick-custody:<pick id>` subject (pick-identity rule 7):
 * the evidence cannot say which pick a transfer is, so the pick is deferred, never chosen. One issue
 * per subject; a later conflict on the same pick adds its evidence to it.
 */
function recordPickIdentityConflict(
  issues: ReconciliationIssue[],
  pickId: string,
  detail: string,
  evidenceIds: readonly string[]
): void {
  const subjectKey = `pick-custody:${pickId}`;
  const existing = issues.find(
    (issue) => issue.code === 'pick_identity_conflict' && issue.subjectKey === subjectKey
  );
  if (existing) {
    existing.evidenceIds = sortedUnique([...existing.evidenceIds, ...evidenceIds]);
    if (!existing.detail.includes(detail)) existing.detail = `${existing.detail} ${detail}`;
    return;
  }
  issues.push({
    code: 'pick_identity_conflict',
    severity: 'blocking',
    subjectKey,
    detail,
    evidenceIds: sortedUnique(evidenceIds),
  });
}

/** What Draftguru states a pick transfer's pick became: a drafted player, or not used. */
interface PickStatement {
  /** `player:<canonical id>`, `player-native:<Draftguru id>` when the player has no review, or `not_used`. */
  key: string;
  /** The Draftguru player id, for reading the player's Footyinfo route. */
  native: string | null;
}

/**
 * Every Draftguru statement of what a pick transfer's pick became, keyed by
 * `nativeEventId|nativeTransferId`: the giving side's eventual selection (`pick_eventual_selection`)
 * and the receiving side's disposition (`pick_disposition`, selected or not used; traded on says
 * nothing about the pick's end). A player is keyed by its reviewed canonical id, else by its
 * Draftguru id. Statements for one transfer that disagree state nothing. The same statements the
 * candidate's outcomes record, so a guard that reads them sees every player rule 3 counts.
 */
function pickStatements(
  evidence: readonly Evidence[],
  lookup: IdentityLookup
): ReadonlyMap<string, PickStatement> {
  const stated = new Map<string, PickStatement | null>();
  const playerKey = (player: RecordedEntity | undefined): PickStatement | null => {
    if (!player) return null;
    const canonical = lookup('draftguru', 'player', player);
    if (canonical !== null) return { key: `player:${canonical}`, native: player.nativeId ?? null };
    return player.nativeId
      ? { key: `player-native:${player.nativeId}`, native: player.nativeId }
      : null;
  };
  for (const row of evidence) {
    const claim = row.content.claim;
    if (row.content.provider !== 'draftguru') continue;
    let value: PickStatement | null | undefined;
    if (claim.kind === 'pick_eventual_selection') {
      value =
        claim.outcome === 'not_used' ? { key: 'not_used', native: null } : playerKey(claim.player);
    } else if (claim.kind === 'pick_disposition' && claim.disposition !== 'traded_on') {
      value =
        claim.disposition === 'not_used'
          ? { key: 'not_used', native: null }
          : playerKey(claim.player);
    } else {
      continue;
    }
    const key = `${claim.nativeEventId}|${claim.nativeTransferId}`;
    const previous = stated.get(key);
    stated.set(
      key,
      previous === undefined
        ? value
        : previous === null || value === null || previous.key !== value.key
          ? null
          : { key: previous.key, native: previous.native ?? value.native }
    );
  }
  return new Map(
    [...stated].filter((entry): entry is [string, PickStatement] => entry[1] !== null)
  );
}

/**
 * How strongly a transfer's own evidence ties it to its custody pick: `stated` when it is a future
 * pick whose own round and original club form the entitlement, `exact` when its sender, receiver and
 * number are the slot's original club, holder and number, or a repeated observation of the slot
 * proves the hop; otherwise `number`, a slot joined by number alone (slotTransfersCorroborate,
 * uniqueShiftedSlot) that may have been numbered at another time.
 */
type CustodyAnchor = 'stated' | 'exact' | 'number';
const CUSTODY_ANCHOR_RANK: Record<CustodyAnchor, number> = { stated: 2, exact: 1, number: 0 };

function custodyAnchor(
  transfer: ResolvedDirectedTransfer,
  custody: CanonicalPickCustody | null,
  pickCustody: readonly CanonicalPickCustody[]
): CustodyAnchor {
  const asset = transfer.row.content.claim.asset;
  if (asset.kind === 'future_pick') return 'stated';
  if (asset.kind !== 'current_pick' || custody === null) return 'number';
  if (latestPriorCustody(pickCustody, custody)) return 'exact';
  return custody.originalClubId === transfer.fromClubId &&
    custody.currentClubId === transfer.toClubId &&
    custody.recordedPickNumber !== null &&
    custody.recordedPickNumber === asset.recordedPickNumber
    ? 'exact'
    : 'number';
}

/**
 * Pick-identity rule 3 at its source: one custody pick is one pick, so the eventual-selection
 * statements of its transfers name one outcome. A number join is the weakest tie to a pick: the slot
 * joins compare a transfer's number with an order observed at another time, and bids renumber picks
 * on draft night. Two steps, in order:
 *
 * 1. A drafted player's pick is the custody pick its statement is tied to by a stated or exact tie
 *    (its home), when exactly one is. Its transfers number-joined to any other custody pick leave
 *    that pick: their own statement says they are the home pick, not this one. Likewise where the
 *    Footyinfo board routes the player's pick from an original club other than the custody pick's
 *    (`createEventualSelectionRouteFinder`; the board prints the original club first).
 * 2. On each custody pick the remaining statements are compared by their strongest tie. When one is
 *    strictly the strongest, every transfer stating anything else leaves the pick; a stated or exact
 *    tie that leaves is recorded as a conflict. Otherwise the evidence cannot decide: every transfer
 *    with a statement leaves the pick and a conflict is recorded.
 *
 * A transfer that leaves a pick takes an id of its own, so only the eventual-selection join, which
 * reads the same statements, can join it to another transfer again.
 */
function refuseContradictedNumberJoins(input: {
  resolvedTransfers: readonly ResolvedDirectedTransfer[];
  transfers: CanonicalTransfer[];
  slotChainCustody: ReadonlyMap<ResolvedDirectedTransfer, CanonicalPickCustody | null>;
  pickCustody: readonly CanonicalPickCustody[];
  statements: ReadonlyMap<string, PickStatement>;
  issues: ReconciliationIssue[];
  routeOf: (
    draftYear: number,
    draftType: string,
    playerNativeId: string
  ) => EventualSelectionRoute | null;
}): void {
  const usable = new Set(input.pickCustody.filter(isUsableCustody).map(({ pickId }) => pickId));
  const originalOf = new Map(
    input.pickCustody
      .filter(isUsableCustody)
      .map((custody) => [custody.pickId, custody.originalClubId] as const)
  );
  interface Tie {
    index: number;
    pickId: string;
    statement: string;
    native: string | null;
    anchor: CustodyAnchor;
  }
  const ties: Tie[] = [];
  input.transfers.forEach((transfer, index) => {
    if (transfer.asset.kind !== 'pick_entitlement' || !usable.has(transfer.asset.pickId)) return;
    const resolved = input.resolvedTransfers[index]!;
    const claim = resolved.row.content.claim;
    const statement = input.statements.get(`${claim.nativeEventId}|${claim.nativeTransferId}`);
    if (statement === undefined) return;
    ties.push({
      index,
      pickId: transfer.asset.pickId,
      statement: statement.key,
      native: statement.native,
      anchor: custodyAnchor(
        resolved,
        input.slotChainCustody.get(resolved) ?? null,
        input.pickCustody
      ),
    });
  });
  // A transfer that leaves takes an id of its own: its number, or for a future pick its stated
  // entitlement scoped to the transfer, as a disputed entitlement's transfers are.
  const leave = (tie: Tie) => {
    const transfer = input.transfers[tie.index]!;
    const resolved = input.resolvedTransfers[tie.index]!;
    const claim = resolved.row.content.claim;
    if (transfer.asset.kind !== 'pick_entitlement') return;
    if (claim.asset.kind === 'current_pick') {
      transfer.asset = {
        ...transfer.asset,
        pickId: currentPickNumberOnlyId(claim.asset, resolved.row.evidenceId),
        originalClubId: null,
      };
    } else if (claim.asset.kind === 'future_pick') {
      transfer.asset = {
        ...transfer.asset,
        pickId: createAflTradeContentAddress('draft-pick', {
          draftYear: claim.asset.draftYear,
          draftType: claim.asset.draftType,
          roundNumber: claim.asset.roundNumber,
          originalClubId: transfer.asset.originalClubId,
          disputedTransferEvidenceId: resolved.row.evidenceId,
        }),
      };
    } else {
      return;
    }
    transfer.status = 'unresolved';
  };
  const conflict = (pickId: string, tied: readonly Tie[]) =>
    recordPickIdentityConflict(
      input.issues,
      pickId,
      'Transfers on one custody pick state different eventual selections.',
      tied.flatMap(({ index }) => input.transfers[index]!.evidenceIds)
    );
  // 1. Each drafted player's home pick, from its stated or exact ties alone.
  const home = new Map<string, string>();
  const strongPicks = new Map<string, Set<string>>();
  for (const tie of ties) {
    if (tie.statement === 'not_used' || tie.anchor === 'number') continue;
    const picks = strongPicks.get(tie.statement) ?? new Set<string>();
    picks.add(tie.pickId);
    strongPicks.set(tie.statement, picks);
  }
  strongPicks.forEach((picks, statement) => {
    if (picks.size === 1) home.set(statement, [...picks][0]!);
  });
  const routedElsewhere = (tie: Tie) => {
    const asset = input.transfers[tie.index]!.asset;
    if (asset.kind !== 'pick_entitlement') return false;
    if (tie.native === null) return false;
    const route = input.routeOf(asset.draftYear, asset.draftType, tie.native);
    return route !== null && route.routeClubIds[0] !== originalOf.get(tie.pickId);
  };
  const remaining = ties.filter((tie) => {
    const pick = home.get(tie.statement);
    if (tie.anchor !== 'number') return true;
    if ((pick === undefined || pick === tie.pickId) && !routedElsewhere(tie)) return true;
    leave(tie);
    return false;
  });
  // 2. What remains on each custody pick.
  const onPick = new Map<string, Tie[]>();
  for (const tie of remaining) {
    (onPick.get(tie.pickId) ?? onPick.set(tie.pickId, []).get(tie.pickId)!).push(tie);
  }
  onPick.forEach((tied, pickId) => {
    const strength = new Map<string, number>();
    for (const { statement, anchor } of tied) {
      strength.set(statement, Math.max(strength.get(statement) ?? -1, CUSTODY_ANCHOR_RANK[anchor]));
    }
    if (strength.size <= 1) return;
    const best = Math.max(...strength.values());
    const leaders = [...strength].filter(([, rank]) => rank === best);
    const keep = leaders.length === 1 ? leaders[0]![0] : null;
    // A stated or exact tie that contradicts the kept statement leaves too: one pick holds one
    // outcome, and only the evidence-decided statement keeps it. Undecided, nothing keeps it.
    if (
      keep === null ||
      tied.some(({ statement, anchor }) => statement !== keep && anchor !== 'number')
    )
      conflict(pickId, tied);
    for (const tie of tied) if (tie.statement !== keep) leave(tie);
  });
}

function reconcileDirectedTransfer(input: {
  transfer: ResolvedDirectedTransfer;
  resolve: IdentityResolver;
  pickCustody: readonly CanonicalPickCustody[];
  slotChainCustody: ReadonlyMap<ResolvedDirectedTransfer, CanonicalPickCustody | null>;
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
              row,
              claim,
              exactCustody: input.slotChainCustody.get(input.transfer) ?? null,
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

/**
 * One pick traded on several Draftguru pages is numbered as each page stood: before the draft by the
 * pre-draft order, on draft night by the live order that bids shifted. The giving side of every pick
 * row names the player eventually selected with it (`pick_eventual_selection`, parser v3), so a
 * draft's Draftguru pick transfers naming one player's native id are one pick (statlyaus/Statly#886).
 * A group is admitted only when its transfers walk the pick from club to club in exactly one order
 * (`eventualSelectionPath`): a pick swapped back on draft night is admitted, while a group that
 * branches or merges (a matched bid that consumed several picks for one player), a closed loop, or
 * an ambiguous order is left as the slot rules made it. In an admitted group every member takes the one custody pick any member reached, else a
 * player-keyed pick id. When the path reaches two custody picks, it takes the one reached first if
 * the pre-draft order shows it delivered before the conflict (`earliestCustodyBeforeConflict`);
 * otherwise every member is unresolved with a lineage issue naming both. Without eventual-selection
 * claims nothing changes.
 */
type IdentityLookup = (
  provider: Provider,
  entityKind: 'club' | 'player',
  sourceIdentity: RecordedEntity
) => string | null;

type DraftBoardPickEvidence = Evidence & {
  content: { claim: Extract<Claim, { kind: 'draft_board_pick' }> };
};

/**
 * One record per Footyinfo `draft_board_pick` row, its holder and route resolved club by club. A
 * club with no reviewed resolution leaves the record unusable and is reported once, as one pick-side
 * `board-pick:` identity issue citing every row that names it.
 */
function reconcileDraftBoardPicks(input: {
  evidence: readonly Evidence[];
  lookup: IdentityLookup;
  issues: ReconciliationIssue[];
}): { records: CanonicalDraftBoardPick[]; rows: ReadonlyMap<string, DraftBoardPickEvidence> } {
  const unresolved = new Map<string, { club: RecordedEntity; evidenceIds: string[] }>();
  const rows = new Map<string, DraftBoardPickEvidence>();
  const records = input.evidence
    .filter(
      (row): row is DraftBoardPickEvidence =>
        row.content.provider === 'footyinfo' && row.content.claim.kind === 'draft_board_pick'
    )
    .map((row) => {
      const claim = row.content.claim;
      const clubOf = (club: RecordedEntity) => {
        const clubId = input.lookup('footyinfo', 'club', club);
        if (clubId === null) {
          const key = identityKey('footyinfo', 'club', club);
          const entry = unresolved.get(key) ?? { club, evidenceIds: [] };
          entry.evidenceIds.push(row.evidenceId);
          unresolved.set(key, entry);
        }
        return clubId;
      };
      const clubId = clubOf(claim.club);
      const route = claim.route.map(clubOf);
      const boardPickId = createAflTradeContentAddress('external-draft-board-pick', {
        evidenceId: row.evidenceId,
      });
      rows.set(boardPickId, row);
      return {
        boardPickId,
        draftYear: claim.draftYear,
        draftType: claim.draftType,
        roundNumber: claim.roundNumber,
        recordedPickNumber: claim.recordedPickNumber,
        status: claim.status,
        clubId,
        routeClubIds: route.every((club): club is string => club !== null) ? route : null,
        evidenceIds: [row.evidenceId],
      };
    });
  unresolved.forEach(({ club, evidenceIds }) =>
    input.issues.push({
      code: 'identity_unresolved',
      severity: 'blocking',
      subjectKey: `board-pick:club:${club.nativeId ?? club.recordedName}`,
      detail: `No current reviewed club resolution exists for footyinfo identity ${club.recordedName}.`,
      evidenceIds: sortedUnique(evidenceIds),
    })
  );
  return {
    records: records.sort((left, right) => left.boardPickId.localeCompare(right.boardPickId)),
    rows,
  };
}

/**
 * The index of the route club that `from` hands the pick to, when the route has that hop exactly
 * once; otherwise -1. A route that passes the same pair twice names neither occurrence.
 */
function uniqueRouteHop(route: readonly string[], from: string | null, to: string | null): number {
  const hops = route.flatMap((club, index) =>
    index > 0 && route[index - 1] === from && club === to ? [index] : []
  );
  return hops.length === 1 ? hops[0]! : -1;
}

/** The Footyinfo route of the pick a Draftguru player was selected with, and the rows that state it. */
interface EventualSelectionRoute {
  routeClubIds: readonly string[];
  evidenceIds: readonly string[];
}

/**
 * Finds the board route of the pick Draftguru says a player was eventually selected with. The
 * player's own Draftguru selection rows in that draft must name one selection number and one club;
 * the board must list exactly one selected pick with that number, held by that club, with a fully
 * resolved route; and the board's player must resolve to the same canonical player as Draftguru's.
 * The number only joins two statements about one named player's selection; nothing is inferred
 * from a pick number alone.
 */
function createEventualSelectionRouteFinder(input: {
  evidence: readonly Evidence[];
  boardPicks: readonly CanonicalDraftBoardPick[];
  boardRows: ReadonlyMap<string, DraftBoardPickEvidence>;
  lookup: IdentityLookup;
}): (
  draftYear: number,
  draftType: string,
  playerNativeId: string
) => EventualSelectionRoute | null {
  const selectionRows = input.evidence.filter(
    (row): row is Evidence & { content: { claim: Extract<Claim, { kind: 'draft_selection' }> } } =>
      row.content.provider === 'draftguru' && row.content.claim.kind === 'draft_selection'
  );
  return (draftYear, draftType, playerNativeId) => {
    const rows = selectionRows.filter(
      ({ content: { claim } }) =>
        claim.draftYear === draftYear &&
        claim.draftType === draftType &&
        claim.player.nativeId === playerNativeId
    );
    const numbers = new Set(rows.map(({ content }) => content.claim.selectionNumber));
    const players = new Set(
      rows.map(({ content }) => input.lookup('draftguru', 'player', content.claim.player))
    );
    const clubs = new Set(
      rows.map(({ content }) => input.lookup('draftguru', 'club', content.claim.selectedByClub))
    );
    if (numbers.size !== 1 || players.size !== 1 || clubs.size !== 1) return null;
    const [playerId] = players;
    const [clubId] = clubs;
    const [selectionNumber] = numbers;
    if (!playerId || !clubId) return null;
    const boards = input.boardPicks.filter(
      (board) =>
        board.status === 'selected' &&
        board.draftYear === draftYear &&
        board.draftType === draftType &&
        board.recordedPickNumber === selectionNumber
    );
    if (boards.length !== 1) return null;
    const board = boards[0]!;
    const boardPlayer = input.boardRows.get(board.boardPickId)!.content.claim.player;
    if (
      board.clubId !== clubId ||
      board.routeClubIds === null ||
      board.routeClubIds.length < 2 ||
      !boardPlayer ||
      input.lookup('footyinfo', 'player', boardPlayer) !== playerId
    )
      return null;
    return { routeClubIds: board.routeClubIds, evidenceIds: board.evidenceIds };
  };
}

/**
 * The group members the board route names, in route order: each member whose sender and receiver
 * are one hop of the route, where no other member and no other hop of the route has that pair.
 * Members of another pick (a matched bid that consumed several) are left out, never re-keyed. At
 * least two members must chain, and consecutive members must keep time order; otherwise null.
 */
function routedEventualSelectionPath(
  members: readonly number[],
  transfers: readonly CanonicalTransfer[],
  route: readonly string[],
  inOrder: (earlier: number, later: number) => boolean
): number[] | null {
  const byHop = new Map<number, number[]>();
  for (const index of members) {
    const hop = uniqueRouteHop(route, transfers[index]!.fromClubId, transfers[index]!.toClubId);
    if (hop > 0) byHop.set(hop, [...(byHop.get(hop) ?? []), index]);
  }
  const path = [...byHop]
    .filter(([, indices]) => indices.length === 1)
    .sort(([left], [right]) => left - right)
    .map(([, indices]) => indices[0]!);
  if (path.length < 2 || path.some((index, at) => at > 0 && !inOrder(path[at - 1]!, index)))
    return null;
  return path;
}

/** Whether every member's hop is a hop of the route, in route order. */
function routeNamesPath(
  path: readonly number[],
  transfers: readonly CanonicalTransfer[],
  route: readonly string[]
): boolean {
  let previous = 0;
  return path.every((index) => {
    const hop = uniqueRouteHop(route, transfers[index]!.fromClubId, transfers[index]!.toClubId);
    if (hop <= previous) return false;
    previous = hop;
    return true;
  });
}

/**
 * Pick-identity rule 5: where a Footyinfo board routes a selected pick (every route club resolved,
 * at least two clubs), the selection the candidate holds for that number and club is the same pick,
 * so every transfer on the selection's pick id must be one hop of the route. A transfer that is not
 * contradicts the route; the evidence does not say which side is wrong, so the pick is recorded as a
 * conflict (rule 7) and deferred. A selection only Footyinfo states is not checked against its own
 * route, nor a transfer whose clubs are unresolved.
 */
function recordBoardRouteConflicts(input: {
  boardPicks: readonly CanonicalDraftBoardPick[];
  draftSelections: readonly CanonicalDraftSelection[];
  transfers: readonly CanonicalTransfer[];
  issues: ReconciliationIssue[];
}): void {
  const transfersByPick = new Map<string, CanonicalTransfer[]>();
  for (const transfer of input.transfers) {
    if (transfer.asset.kind !== 'pick_entitlement') continue;
    const key = transfer.asset.pickId;
    (transfersByPick.get(key) ?? transfersByPick.set(key, []).get(key)!).push(transfer);
  }
  for (const board of input.boardPicks) {
    const route = board.routeClubIds;
    if (board.status !== 'selected' || route === null || route.length < 2) continue;
    const selection = input.draftSelections.find(
      (candidate) =>
        candidate.draftYear === board.draftYear &&
        candidate.draftType === board.draftType &&
        candidate.selectionNumber === board.recordedPickNumber
    );
    if (
      selection === undefined ||
      selection.clubId === null ||
      selection.clubId !== board.clubId ||
      selection.supportingProviders.every((provider) => provider === 'footyinfo')
    )
      continue;
    const offRoute = (transfersByPick.get(selection.pickId) ?? []).filter(
      ({ fromClubId, toClubId }) =>
        fromClubId !== null &&
        toClubId !== null &&
        !route.some((club, at) => at > 0 && route[at - 1] === fromClubId && club === toClubId)
    );
    if (offRoute.length === 0) continue;
    recordPickIdentityConflict(
      input.issues,
      selection.pickId,
      'A transfer on a selected pick is not a hop of the Footyinfo route for that pick.',
      [...board.evidenceIds, ...offRoute.flatMap(({ evidenceIds }) => evidenceIds)]
    );
  }
}

/**
 * Pick-identity rule 1 for one transaction's transfers of one pick id: the exchange moves the pick
 * at most once from any resolved club and at most once into any resolved club, and its numbered
 * transfers carry one number. Unresolved clubs are not compared.
 */
function violatesPickIdentityExchange(transfers: readonly CanonicalTransfer[]): boolean {
  const repeated = (clubs: readonly (string | null)[]) => {
    const resolved = clubs.filter((club): club is string => club !== null);
    return resolved.length > new Set(resolved).size;
  };
  const numbers = new Set(
    transfers.flatMap(({ asset }) =>
      asset.kind === 'pick_entitlement' && asset.nominalPick !== null ? [asset.nominalPick] : []
    )
  );
  return (
    repeated(transfers.map(({ fromClubId }) => fromClubId)) ||
    repeated(transfers.map(({ toClubId }) => toClubId)) ||
    numbers.size > 1
  );
}

function joinEventualSelections(input: {
  statements: ReadonlyMap<string, PickStatement>;
  evidence: readonly Evidence[];
  resolvedTransfers: readonly ResolvedDirectedTransfer[];
  transfers: CanonicalTransfer[];
  transactionClaimsByNativeEventId: ReadonlyMap<string, readonly TransactionEvidence[]>;
  pickCustody: readonly CanonicalPickCustody[];
  issues: ReconciliationIssue[];
  /** The Footyinfo board route of the pick a Draftguru player was selected with, when one is staged. */
  routeOf: (
    draftYear: number,
    draftType: string,
    playerNativeId: string
  ) => EventualSelectionRoute | null;
}): void {
  const eventualPlayers = new Map<string, string | null>();
  // Every staged row must be conserved by a record or an issue: each statement is cited on the
  // directed transfer it names, admitted to a group or not, as a pick disposition is cited by its
  // outcome; a statement naming no transfer of its page is an issue.
  const eventualRows = new Map<string, string[]>();
  for (const row of input.evidence) {
    const claim = row.content.claim;
    if (row.content.provider !== 'draftguru' || claim.kind !== 'pick_eventual_selection') continue;
    const key = `${claim.nativeEventId}|${claim.nativeTransferId}`;
    (eventualRows.get(key) ?? eventualRows.set(key, []).get(key)!).push(row.evidenceId);
    const player = claim.outcome === 'selected' ? (claim.player?.nativeId ?? null) : null;
    // Two statements for one transfer that disagree name no player.
    eventualPlayers.set(
      key,
      eventualPlayers.has(key) && eventualPlayers.get(key) !== player ? null : player
    );
  }
  if (eventualPlayers.size === 0) return;
  const groups = new Map<string, number[]>();
  input.resolvedTransfers.forEach(({ row }, index) => {
    const claim = row.content.claim;
    const transfer = input.transfers[index]!;
    if (row.content.provider !== 'draftguru' || claim.kind !== 'directed_transfer') return;
    const transferKey = `${claim.nativeEventId}|${claim.nativeTransferId}`;
    const cited = eventualRows.get(transferKey);
    if (cited !== undefined) {
      transfer.evidenceIds = sortedUnique([...transfer.evidenceIds, ...cited]);
      eventualRows.delete(transferKey);
    }
    const asset = transfer.asset;
    if (
      asset.kind !== 'pick_entitlement' ||
      (claim.asset.kind !== 'current_pick' && claim.asset.kind !== 'future_pick')
    )
      return;
    const player = eventualPlayers.get(transferKey);
    if (!player) return;
    const key = `${asset.draftYear}|${asset.draftType}|${player}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(index);
  });
  eventualRows.forEach((evidenceIds, key) => {
    const [nativeEventId, nativeTransferId] = key.split('|');
    input.issues.push({
      code: 'pick_outcome_unresolved',
      severity: 'blocking',
      subjectKey: `pick-outcome:${nativeEventId}:${nativeTransferId}`,
      detail: 'A Draftguru eventual-selection statement names no directed transfer of its page.',
      evidenceIds: sortedUnique(evidenceIds),
    });
  });
  const usableCustody = new Map(
    input.pickCustody.filter(isUsableCustody).map((custody) => [custody.pickId, custody] as const)
  );
  const transactionOf = (index: number) => {
    const claims =
      input.transactionClaimsByNativeEventId.get(
        input.resolvedTransfers[index]!.row.content.claim.nativeEventId
      ) ?? [];
    return claims.length === 1 ? claims[0]!.content.claim : null;
  };
  const inOrder = transfersInOrder(transactionOf);
  groups.forEach((members, key) => {
    const [draftYear, draftType, player] = key.split('|');
    // The board route is read only where the Draftguru walk alone cannot settle the pick: a group it
    // refuses (a loop, a merge, two orders) or one that reaches two custody picks.
    let route: EventualSelectionRoute | null | undefined;
    const routeOf = () =>
      route === undefined ? (route = input.routeOf(Number(draftYear), draftType!, player!)) : route;
    let routed = false;
    let path = eventualSelectionPath(members, input.transfers, inOrder);
    if (path === null) {
      const stated = routeOf();
      path =
        stated &&
        routedEventualSelectionPath(members, input.transfers, stated.routeClubIds, inOrder);
      if (path === null) return;
      routed = true;
    }
    const reachedAt = path.map((index) => {
      const asset = input.transfers[index]!.asset;
      return asset.kind === 'pick_entitlement' && usableCustody.has(asset.pickId)
        ? asset.pickId
        : null;
    });
    const custodyPickIds = sortedUnique(reachedAt.filter((id): id is string => id !== null));
    let earliest = earliestCustodyBeforeConflict(path, reachedAt, input.transfers, usableCustody);
    if (custodyPickIds.length > 1 && earliest === null) {
      const stated = routeOf();
      earliest =
        stated && routeNamesPath(path, input.transfers, stated.routeClubIds)
          ? routeOriginalCustody(custodyPickIds, usableCustody, stated.routeClubIds)
          : null;
      if (earliest !== null) routed = true;
    }
    if (custodyPickIds.length > 1 && earliest === null) {
      path.forEach((index) => {
        input.transfers[index]!.status = 'unresolved';
      });
      input.issues.push({
        code: 'lineage_unresolved',
        severity: 'blocking',
        subjectKey: `eventual-selection:${key}`,
        detail: `Draftguru transfers naming one eventually selected player reach two custody picks: ${custodyPickIds.join(', ')}.`,
        evidenceIds: sortedUnique(path.flatMap((index) => input.transfers[index]!.evidenceIds)),
      });
      return;
    }
    const custody =
      custodyPickIds.length === 1
        ? usableCustody.get(custodyPickIds[0]!)!
        : custodyPickIds.length > 1
          ? usableCustody.get(earliest!)!
          : null;
    const pickId =
      custody?.pickId ??
      createAflTradeContentAddress('draft-pick', {
        draftYear: Number(draftYear),
        draftType,
        eventualSelection: { provider: 'draftguru', playerNativeId: player },
      });
    const refused = (detail: string, pickIds: readonly string[]) => {
      for (const id of sortedUnique(pickIds)) {
        recordPickIdentityConflict(
          input.issues,
          id,
          detail,
          path.flatMap((index) => input.transfers[index]!.evidenceIds)
        );
      }
    };
    // Rule 2: a future pick states its round and original club; a current pick states neither, so its
    // original club is only what a custody join gave it and follows the pick the walk settles on.
    const statedEntitlements = sortedUnique(
      path.flatMap((index) => {
        const { row, futureOriginalClubId } = input.resolvedTransfers[index]!;
        const asset = row.content.claim.asset;
        return asset.kind === 'future_pick' && futureOriginalClubId !== null
          ? [`${asset.roundNumber ?? 'unknown'}|${futureOriginalClubId}`]
          : [];
      })
    );
    const settledEntitlement =
      custody === null ? null : `${custody.roundNumber ?? 'unknown'}|${custody.originalClubId}`;
    if (
      statedEntitlements.length > 1 ||
      (settledEntitlement !== null &&
        statedEntitlements.some((stated) => stated !== settledEntitlement))
    ) {
      refused(
        'Draftguru transfers naming one eventually selected player state different entitlements.',
        [
          pickId,
          ...path.flatMap((index) => {
            const asset = input.transfers[index]!.asset;
            return asset.kind === 'pick_entitlement' &&
              input.resolvedTransfers[index]!.row.content.claim.asset.kind === 'future_pick'
              ? [asset.pickId]
              : [];
          }),
        ]
      );
      return;
    }
    const originalClubId =
      custody?.originalClubId ??
      (statedEntitlements.length === 1 ? statedEntitlements[0]!.split('|')[1]! : null);
    // Rules 1 and 3: the walk may not put this pick twice into one transaction's exchange, nor join a
    // pick whose other transfers state another eventual selection.
    const onPath = new Set(path);
    const onPick = input.transfers.flatMap((transfer, index) =>
      transfer.asset.kind === 'pick_entitlement' &&
      (onPath.has(index) || transfer.asset.pickId === pickId)
        ? [index]
        : []
    );
    const statementOf = (index: number) => {
      const claim = input.resolvedTransfers[index]!.row.content.claim;
      return input.statements.get(`${claim.nativeEventId}|${claim.nativeTransferId}`);
    };
    const groupStatements = sortedUnique(path.flatMap((index) => statementOf(index)?.key ?? []));
    const groupStatement = groupStatements.length === 1 ? groupStatements[0] : undefined;
    const otherStatements = onPick.filter(
      (index) =>
        !onPath.has(index) &&
        statementOf(index) !== undefined &&
        statementOf(index)!.key !== groupStatement
    );
    const exchangeTwice = [
      ...new Set(onPick.map((index) => input.transfers[index]!.transactionId)),
    ].some((transactionId) =>
      violatesPickIdentityExchange(
        onPick
          .map((index) => input.transfers[index]!)
          .filter((transfer) => transfer.transactionId === transactionId)
      )
    );
    if (otherStatements.length > 0 || exchangeTwice) {
      refused(
        otherStatements.length > 0
          ? 'Draftguru transfers naming one eventually selected player reach a pick other transfers state was used otherwise.'
          : 'Draftguru transfers naming one eventually selected player would move one pick twice in one exchange.',
        [pickId]
      );
      return;
    }
    path.forEach((index) => {
      const transfer = input.transfers[index]!;
      if (transfer.asset.kind !== 'pick_entitlement') return;
      transfer.asset = {
        ...transfer.asset,
        pickId,
        originalClubId,
      };
      if (custody && transfer.fromClubId && transfer.toClubId) transfer.status = 'single_source';
      // The board row that ordered the walk or chose its custody pick is cited on every hop it keyed.
      if (routed)
        transfer.evidenceIds = sortedUnique([...transfer.evidenceIds, ...route!.evidenceIds]);
    });
  });
}

/**
 * Of the custody picks a walk reaches, the one whose original club is the first club of the board
 * route (which prints the original club first), when exactly one is; otherwise null.
 */
function routeOriginalCustody(
  custodyPickIds: readonly string[],
  usableCustody: ReadonlyMap<string, CanonicalPickCustody>,
  route: readonly string[]
): string | null {
  const named = custodyPickIds.filter(
    (pickId) => usableCustody.get(pickId)!.originalClubId === route[0]
  );
  return named.length === 1 ? named[0]! : null;
}

/**
 * Whether transfer `later` cannot precede transfer `earlier`: both trades are known, seasons never
 * go backwards, and stated days never go backwards where both trades state one.
 */
function transfersInOrder(
  transactionOf: (index: number) => Extract<Claim, { kind: 'transaction' }> | null
): (earlier: number, later: number) => boolean {
  return (earlier, later) => {
    const [before, after] = [transactionOf(earlier), transactionOf(later)];
    if (before === null || after === null || after.seasonYear < before.seasonYear) return false;
    return (
      after.seasonYear > before.seasonYear ||
      before.occurredOn === null ||
      after.occurredOn === null ||
      after.occurredOn >= before.occurredOn
    );
  };
}

/**
 * When a path reaches two custody picks, the slot rules have joined a later transfer, numbered by
 * the live draft-night order, to another entitlement whose pre-draft slot has that number. The pick
 * the path reached first is the pick when the pre-draft order (observed before draft night) names
 * as its holder a club the path delivered it to before any member reached another custody pick:
 * those transfers preceded the order, so the conflicting one came after it. Otherwise (the holder
 * received it only in or after the conflicting transfer, so both joins rest on pre-draft numbering)
 * there is no choice to make and this returns null.
 */
function earliestCustodyBeforeConflict(
  path: readonly number[],
  reachedAt: readonly (string | null)[],
  transfers: readonly CanonicalTransfer[],
  usableCustody: ReadonlyMap<string, CanonicalPickCustody>
): string | null {
  const firstAt = reachedAt.findIndex((pickId) => pickId !== null);
  if (firstAt < 0) return null;
  const earliest = reachedAt[firstAt]!;
  const conflictAt = reachedAt.findIndex((pickId) => pickId !== null && pickId !== earliest);
  if (conflictAt < 0) return earliest;
  const holder = usableCustody.get(earliest)!.currentClubId;
  return path
    .slice(0, conflictAt)
    .some((index) => holder !== null && transfers[index]!.toClubId === holder)
    ? earliest
    : null;
}

/** The most transfers of one pick the path search will order; a longer group is left as it is. */
const MAXIMUM_EVENTUAL_SELECTION_PATH = 12;

/**
 * The group's transfers in the one order that walks the pick from club to club, or null. Each step's
 * sender must be the previous step's receiver, every transfer is used once, and seasons (and stated
 * days, where both trades have one) never go backwards. A club may hold the pick more than once (a
 * pick swapped back on draft night), but the walk must have one start and one end and exactly one
 * such order: a group that branches or merges (a matched bid that consumed several picks for one
 * player), a closed loop (no start), or one with two possible orders is refused.
 */
function eventualSelectionPath(
  members: readonly number[],
  transfers: readonly CanonicalTransfer[],
  inOrder: (earlier: number, later: number) => boolean
): number[] | null {
  const edges = members.map((index) => ({ index, ...transfers[index]! }));
  if (
    edges.length > MAXIMUM_EVENTUAL_SELECTION_PATH ||
    edges.some(({ fromClubId, toClubId }) => fromClubId === null || toClubId === null)
  )
    return null;
  const balance = new Map<string, number>();
  for (const { fromClubId, toClubId } of edges) {
    balance.set(fromClubId!, (balance.get(fromClubId!) ?? 0) + 1);
    balance.set(toClubId!, (balance.get(toClubId!) ?? 0) - 1);
  }
  const starts = [...balance].filter(([, value]) => value === 1).map(([club]) => club);
  const ends = [...balance].filter(([, value]) => value === -1);
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    [...balance.values()].some((value) => Math.abs(value) > 1)
  )
    return null;
  const walks: number[][] = [];
  const used = new Set<number>();
  const walk: number[] = [];
  const extend = (club: string) => {
    if (walks.length > 1) return;
    if (walk.length === edges.length) {
      walks.push([...walk]);
      return;
    }
    for (const edge of edges) {
      if (used.has(edge.index) || edge.fromClubId !== club) continue;
      if (walk.length > 0 && !inOrder(walk.at(-1)!, edge.index)) continue;
      used.add(edge.index);
      walk.push(edge.index);
      extend(edge.toClubId!);
      walk.pop();
      used.delete(edge.index);
    }
  };
  extend(starts[0]!);
  return walks.length === 1 ? walks[0]! : null;
}

type PickDispositionEvidence = Evidence & {
  content: { claim: Extract<Claim, { kind: 'pick_disposition' }> };
};

type NominationFacts = Pick<
  CanonicalPickOutcome,
  'nominationBasis' | 'receivingClubNominatedSelections' | 'boardPickId'
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
 * The Footyinfo board pick that settles a stated "not used" pick with no access evidence: the one
 * board pick in the pick's draft and round held by the receiving club whose route hands it from the
 * sending club to the receiving club once (and starts at the pick's original club, when the
 * transfer names one). It counts only when that pick was passed or removed. Nothing is matched by
 * pick number.
 */
function notUsedBoardPick(
  boardPicks: readonly CanonicalDraftBoardPick[],
  asset: Extract<CanonicalTransferAsset, { kind: 'pick_entitlement' }>,
  fromClubId: string | null,
  receivingClubId: string
): CanonicalDraftBoardPick | null {
  if (asset.nominalRound === null || fromClubId === null) return null;
  const matches = boardPicks.filter(
    (board) =>
      board.draftYear === asset.draftYear &&
      board.draftType === asset.draftType &&
      board.roundNumber === asset.nominalRound &&
      board.clubId === receivingClubId &&
      board.routeClubIds !== null &&
      uniqueRouteHop(board.routeClubIds, fromClubId, receivingClubId) > 0 &&
      (asset.originalClubId === null || board.routeClubIds[0] === asset.originalClubId)
  );
  return matches.length === 1 && matches[0]!.status !== 'selected' ? matches[0]! : null;
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
  boardPicks: readonly CanonicalDraftBoardPick[];
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
      const board =
        outcome.nomination.nominationBasis === 'no_access_evidence'
          ? notUsedBoardPick(input.boardPicks, asset, transfer.fromClubId, receivingClubId)
          : null;
      if (board !== null) {
        record(
          outcome.status,
          null,
          null,
          { nominationBasis: 'board_pick_passed_or_removed', boardPickId: board.boardPickId },
          board.evidenceIds
        );
        continue;
      }
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
  /**
   * An approved owner `reconciliation_scope` decision (statlyaus/Statly#869). With it, pick-side issues
   * are recorded `deferred`; player-side issues stay `blocking`. Without it, output is unchanged.
   */
  pickLineageDeferral?: Pick<AflTradePickLineageDeferral, 'decisionId'>;
  /**
   * Source selection ids that are already current canonical selections of finalized promotions, as
   * the repository resolved them at preparation. Only with the deferral: a draft whose every
   * candidate selection is in this set is recorded as already promoted and left unwritten.
   */
  promotedDraftSelectionIds?: readonly string[];
  /**
   * Transactions that are already current canonical, each with the transfer ids promoted as assets
   * on its current trade version and the pick id of each such asset that names one, as the
   * repository resolved them at preparation. Only with the deferral: a candidate transaction whose
   * every transfer is in its entry, every pick transfer under the same pick id, is recorded as
   * already promoted and left unwritten.
   */
  promotedTransactions?: readonly AflTradeCurrentCanonicalTransaction[];
  /**
   * Custody observations already canonical under finalized promotions, with their facts, as the
   * repository resolved them at preparation. Only with the deferral: a usable candidate custody row
   * whose id and facts match one is recorded as already promoted and left unwritten (#853).
   */
  promotedCustody?: readonly AflTradeCurrentCanonicalPickCustody[];
}): AflTradeExternalReconciliationCandidate {
  const environment = z
    .enum(['test_fixture', 'non_production', 'production'])
    .parse(input.environment);
  const pickLineageDeferral =
    input.pickLineageDeferral === undefined
      ? undefined
      : z
          .object({ decisionId: aflTradeContentAddressedIdSchema('review-decision') })
          .strict()
          .parse(input.pickLineageDeferral);
  const promotedDraftSelectionIds = new Set(
    z.array(z.string().min(1)).optional().parse(input.promotedDraftSelectionIds) ?? []
  );
  if (promotedDraftSelectionIds.size > 0 && pickLineageDeferral === undefined) {
    throw new TypeError('Already-promoted drafts are recorded only under a pick-side deferral.');
  }
  const currentTransactions =
    z
      .array(
        z
          .object({
            transactionId: z.string().min(1),
            transferIds: z.array(z.string().min(1)),
            // Required: without each promoted asset's pick id a re-keyed transaction would be
            // listed and its corrected pick ids never written (#853).
            transferPickIds: z.array(
              z.object({ transferId: z.string().min(1), pickId: z.string().min(1) }).strict()
            ),
          })
          .strict()
      )
      .optional()
      .parse(input.promotedTransactions) ?? [];
  if (currentTransactions.length > 0 && pickLineageDeferral === undefined) {
    throw new TypeError(
      'Already-promoted transactions are recorded only under a pick-side deferral.'
    );
  }
  const currentCustody =
    z
      .array(
        z
          .object({
            custodyId: z.string().min(1),
            pickId: z.string().min(1),
            observedAt: z.string().min(1).nullable(),
            observedDate: z.record(z.string(), z.union([z.string(), z.number()])).nullable(),
            draftSeasonYear: z.number().int(),
            draftKind: z.string().min(1),
            recordedRound: z.number().int().nullable(),
            recordedPick: z.number().int().nullable(),
            originalClubId: z.string().min(1).nullable(),
            currentClubId: z.string().min(1),
            predecessorCustodyId: z.string().min(1).nullable(),
          })
          .strict()
      )
      .optional()
      .parse(input.promotedCustody) ?? [];
  if (currentCustody.length > 0 && pickLineageDeferral === undefined) {
    throw new TypeError('Already-promoted custody is recorded only under a pick-side deferral.');
  }
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

  const lookup: IdentityLookup = (provider, entityKind, sourceIdentity) =>
    resolutionIndex.get(identityKey(provider, entityKind, sourceIdentity))?.content.canonicalId ??
    null;
  const draftBoard = reconcileDraftBoardPicks({ evidence, lookup, issues });

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
  const slotChainCustody = joinSlotChains({
    transfers: resolvedTransfers,
    transactionClaimsByNativeEventId,
    pickCustody,
    slotTransfers: indexSlotTransfers(resolvedTransfers, pickCustody),
  });
  const transfers: CanonicalTransfer[] = resolvedTransfers.map((transfer) =>
    reconcileDirectedTransfer({ transfer, resolve, pickCustody, slotChainCustody })
  );
  const statements = pickStatements(evidence, lookup);
  const routeOf = createEventualSelectionRouteFinder({
    evidence,
    boardPicks: draftBoard.records,
    boardRows: draftBoard.rows,
    lookup,
  });
  refuseContradictedNumberJoins({
    resolvedTransfers,
    transfers,
    slotChainCustody,
    pickCustody,
    statements,
    issues,
    routeOf,
  });
  joinEventualSelections({
    statements,
    evidence,
    resolvedTransfers,
    transfers,
    transactionClaimsByNativeEventId,
    pickCustody,
    issues,
    routeOf,
  });

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
    // Under the reviewed pick-side deferral a pick transfer whose clubs resolve is unresolved only
    // for its custody, which is the pick's lineage, not the transaction's: the exchange itself is
    // complete. Without the deferral the rule is unchanged.
    const deferrablePickTransfer = (transfer: CanonicalTransfer) =>
      pickLineageDeferral !== undefined &&
      transfer.asset.kind === 'pick_entitlement' &&
      transfer.fromClubId !== null &&
      transfer.toClubId !== null;
    const complete =
      partyIds.every((partyId) => partyId !== null) &&
      partyIds.length >= 2 &&
      eventTransfers.length > 0 &&
      eventTransfers.every(
        (transfer) => transfer.status !== 'unresolved' || deferrablePickTransfer(transfer)
      );
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
    // One selection per year, draft type and selection number, the same fields as its selectionId.
    // Providers differ on the round (Draftguru's year page writes none, a Footyinfo board writes one),
    // so the round must not split one pick into two selections with one id (issue 853).
    const key = `${claim.draftYear}|${claim.draftType}|${claim.selectionNumber}`;
    const group = groupedSelections.get(key) ?? [];
    group.push(row);
    groupedSelections.set(key, group);
  });

  // Every statement the transfers on a pick id make about what it became.
  const statementsOnPick = new Map<string, Set<string>>();
  // The pick each Draftguru-selected player was drafted with, by the statements on its transfers
  // (pick-identity rule 4): the one pick id every transfer stating the player shares.
  const statedSelectionPicks = new Map<string, CanonicalTransfer[]>();
  transfers.forEach((transfer, index) => {
    if (transfer.asset.kind !== 'pick_entitlement') return;
    const claim = resolvedTransfers[index]!.row.content.claim;
    const statement = statements.get(`${claim.nativeEventId}|${claim.nativeTransferId}`);
    if (statement === undefined) return;
    const set = statementsOnPick.get(transfer.asset.pickId) ?? new Set<string>();
    set.add(statement.key);
    statementsOnPick.set(transfer.asset.pickId, set);
    if (statement.key === 'not_used') return;
    const key = `${transfer.asset.draftYear}|${transfer.asset.draftType}|${statement.key}`;
    (statedSelectionPicks.get(key) ?? statedSelectionPicks.set(key, []).get(key)!).push(transfer);
  });
  // A Draftguru selection's player, keyed as the transfer statements key it.
  const selectionStatementOf = (rows: readonly Evidence[]): string | null => {
    const keys = sortedUnique(
      rows.flatMap(({ content }) => {
        if (content.provider !== 'draftguru' || content.claim.kind !== 'draft_selection') return [];
        const canonical = lookup('draftguru', 'player', content.claim.player);
        if (canonical !== null) return [`player:${canonical}`];
        return content.claim.player.nativeId
          ? [`player-native:${content.claim.player.nativeId}`]
          : [];
      })
    );
    return keys.length === 1 ? keys[0]! : null;
  };
  const statedPickBySelection = new Map(
    [...groupedSelections].map(([key, rows]) => {
      const first = rows[0]!.content.claim;
      const draftguru = rows.filter(({ content }) => content.provider === 'draftguru');
      const clubs = sortedUnique(
        draftguru.flatMap(({ content }) => {
          const club = lookup('draftguru', 'club', content.claim.selectedByClub);
          return club === null ? [] : [club];
        })
      );
      const statement = selectionStatementOf(draftguru);
      const stated =
        statement === null
          ? []
          : (statedSelectionPicks.get(`${first.draftYear}|${first.draftType}|${statement}`) ?? []);
      const picks = sortedUnique(
        stated.flatMap(({ asset }) => (asset.kind === 'pick_entitlement' ? [asset.pickId] : []))
      );
      // The pick must be stated for this player alone, and reach the selecting club.
      const statedPick =
        clubs.length === 1 &&
        picks.length === 1 &&
        stated.some(({ toClubId }) => toClubId === clubs[0]) &&
        [...(statementsOnPick.get(picks[0]!) ?? [])].every((other) => other === statement)
          ? picks[0]!
          : null;
      return [key, statedPick] as const;
    })
  );
  const statedPicks = new Set(
    [...statedPickBySelection.values()].filter((value): value is string => value !== null)
  );

  const draftSelections: CanonicalDraftSelection[] = [...groupedSelections]
    .map(([selectionKey, rows]) => {
      const first = rows[0].content.claim;
      // The round comes from a non-Footyinfo row when there is one, so a Footyinfo board never
      // changes the round, or the fallback pick id built from it, of a selection another provider
      // states. A Footyinfo-only selection keeps the board's round.
      const roundNumber = (rows.find(({ content }) => content.provider !== 'footyinfo') ?? rows[0])
        .content.claim.roundNumber;
      // A Footyinfo row only corroborates another provider's selection (issue 853): when its player
      // or club has no reviewed resolution it is cited but not counted, so it can neither unresolve
      // nor null the selection the other provider states. Alone, it resolves like any provider.
      const corroborationOnly = rows.some(({ content }) => content.provider !== 'footyinfo');
      const counted = rows.filter(
        ({ content }) =>
          !corroborationOnly ||
          content.provider !== 'footyinfo' ||
          (lookup('footyinfo', 'player', content.claim.player) !== null &&
            lookup('footyinfo', 'club', content.claim.selectedByClub) !== null)
      );
      const resolvedRows = counted.map((row) => ({
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
        status = statusFromEvidence(new Set(counted.map((row) => row.content.provider)).size);
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
        ...counted.map((row) => row.content.provider),
        ...detailSupport.map((row) => row.content.provider),
      ]) as Provider[];
      if (status === 'single_source' && supportingProviders.length >= 2) status = 'corroborated';
      // A selection is the pick its own player's transfers state they were used on. Only otherwise is it
      // the order slot with its number and holder, and never a slot another selection's transfers
      // claim, whose transfers state another player, or whose original club the board's route for
      // this player contradicts: the order was observed before draft-night bids renumbered picks.
      const statedPick = statedPickBySelection.get(selectionKey) ?? null;
      const selectionStatement = selectionStatementOf(
        rows.filter(({ content }) => content.provider === 'draftguru')
      );
      const draftguruNative = rows.find(
        ({ content }) => content.provider === 'draftguru' && content.claim.player.nativeId
      )?.content.claim.player.nativeId;
      const route =
        draftguruNative === undefined || draftguruNative === null
          ? null
          : routeOf(first.draftYear, first.draftType, draftguruNative);
      const slotCustody = pickCustody.filter(
        (custody) =>
          isUsableCustody(custody) &&
          custody.draftYear === first.draftYear &&
          custody.draftType === first.draftType &&
          custody.recordedPickNumber === first.selectionNumber &&
          custody.currentClubId === clubId
      );
      const matchingCustody =
        statedPick !== null
          ? pickCustody.filter(
              (custody) => isUsableCustody(custody) && custody.pickId === statedPick
            )
          : slotCustody.filter(
              (custody) =>
                !statedPicks.has(custody.pickId) &&
                [...(statementsOnPick.get(custody.pickId) ?? [])].every(
                  (statement) => statement === selectionStatement
                ) &&
                (route === null || route.routeClubIds[0] === custody.originalClubId)
            );
      const custodyResolved =
        statedPick !== null ? matchingCustody.length > 0 : matchingCustody.length === 1;
      const selectionPickId =
        statedPick ??
        (matchingCustody.length === 1
          ? matchingCustody[0].pickId
          : pickId(first.draftYear, first.draftType, first.selectionNumber, roundNumber));
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
      if (!custodyResolved && !datedSelectionWithoutCustody && status !== 'disputed')
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
        roundNumber,
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
  // Rule 4: one selection per pick. Two selections joined to one pick (two observations of one slot
  // under different numbers) cannot both be it, and nothing says which: both keep their number key.
  const selectionsByPick = new Map<string, CanonicalDraftSelection[]>();
  for (const selection of draftSelections) {
    const group = selectionsByPick.get(selection.pickId) ?? [];
    group.push(selection);
    selectionsByPick.set(selection.pickId, group);
  }
  selectionsByPick.forEach((group) => {
    if (group.length < 2) return;
    for (const selection of group) {
      selection.pickId = pickId(
        selection.draftYear,
        selection.draftType,
        selection.selectionNumber,
        selection.roundNumber
      );
      if (selection.status !== 'disputed') selection.status = 'unresolved';
    }
  });

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

  recordBoardRouteConflicts({
    boardPicks: draftBoard.records,
    draftSelections,
    transfers,
    issues,
  });
  // A pick whose identity is in conflict has no lineage until reviewed evidence settles it.
  const conflictedPicks = new Set(
    issues
      .filter(
        ({ code, subjectKey }) =>
          code === 'pick_identity_conflict' && subjectKey.startsWith('pick-custody:')
      )
      .map(({ subjectKey }) => subjectKey.slice('pick-custody:'.length).split('|')[0]!)
  );
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
    if (conflictedPicks.has(transferredPick.pickId)) {
      issues.push({
        code: 'lineage_unresolved',
        severity: 'blocking',
        subjectKey: `lineage:${transfer.transferId}`,
        detail: 'The transferred pick’s identity is in conflict.',
        evidenceIds: transfer.evidenceIds,
      });
      return;
    }
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
    boardPicks: draftBoard.records,
    resolve,
    issues,
  });

  if (pickLineageDeferral !== undefined && sourceAuthority?.kind !== 'historical_plan_completion') {
    throw new TypeError(
      'A pick-side deferral decision names a historical completion; it needs completion authority.'
    );
  }
  // Under the reviewed deferral, pick-side issues are kept but marked deferred; nothing is removed.
  const severed = issues.map((issue) =>
    pickLineageDeferral !== undefined && isAflTradePickSideReconciliationIssue(issue)
      ? { ...issue, severity: 'deferred' as const }
      : issue
  );
  const deferredIssueCount = severed.filter(({ severity }) => severity === 'deferred').length;
  const promotedDrafts = aflTradePromotedDrafts(draftSelections, promotedDraftSelectionIds);
  const promotedTransactions = aflTradePromotedTransactions(
    transactions,
    transfers,
    currentTransactions
  );
  // Custody without a usable status is pick-side: recorded as deferred and left unwritten.
  const deferredCustodyIds = aflTradeDeferredCustodyIds(pickCustody);
  // Custody already canonical with the same facts is left to its promotion (#853).
  const promotedCustodyIds = aflTradePromotedCustodyIds(pickCustody, currentCustody);
  const recordedDeferral =
    pickLineageDeferral === undefined
      ? undefined
      : {
          ...pickLineageDeferral,
          ...(promotedDrafts.length === 0 ? {} : { promotedDrafts }),
          ...(promotedTransactions.length === 0 ? {} : { promotedTransactions }),
          ...(deferredCustodyIds.length === 0 ? {} : { deferredCustodyIds }),
          ...(promotedCustodyIds.length === 0 ? {} : { promotedCustodyIds }),
        };

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
    ...(draftBoard.records.length === 0 ? {} : { draftBoardPicks: draftBoard.records }),
    // Only a candidate that actually deferred something carries the decision, so a candidate prepared
    // with the option but no pick-side issue is byte-identical to one prepared without it.
    ...(deferredIssueCount === 0 || recordedDeferral === undefined
      ? {}
      : { pickLineageDeferral: recordedDeferral }),
    issues: severed
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
