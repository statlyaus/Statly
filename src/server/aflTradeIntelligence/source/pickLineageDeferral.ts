/**
 * Reviewed pick-side issue deferral (statlyaus/Statly#869, "Mechanism for the scope decision").
 *
 * A reconciliation candidate may carry an approved owner decision (subject type `reconciliation_scope`,
 * naming the completion) under which issues whose subject is pick-side are recorded as `deferred`
 * instead of `blocking`: the pick-lineage codes, and an unresolved identity whose subject is a draft
 * selection, a provider-stated pick outcome or the original club a pick transfer names (the club whose
 * entitlement is traded, which Draftguru labels by concession names the owner has rejected as club
 * identities). Player-transfer and transaction-party issues stay blocking. These functions are pure:
 * they classify issues and derive, from candidate content alone, which records a promotion of a
 * deferred candidate writes and which it leaves for later reviewed lineage. A draft the candidate
 * carries that is already current canonical with the candidate's own players (`promotedDrafts`,
 * resolved at preparation and checked by the database) is left to that promotion rather than written
 * again under a session-less root. A draft that is current canonical except that an identity repair
 * re-targeted some of its draftees (`resyncedSelectionIds`, #853) is not written whole either: only
 * the changed slots are re-promoted, as one scoped later version of each session they sit in.
 * So is a transaction already current canonical with the candidate's own pick ids and players, and a
 * custody observation already canonical with the candidate's facts (`promotedCustodyIds`, #853).
 */

export const AFL_TRADE_PICK_SIDE_ISSUE_CODES = [
  'lineage_unresolved',
  'pick_outcome_unresolved',
  'pick_identity_conflict',
] as const;

/**
 * Subject-key prefixes of `identity_unresolved` issues that are pick-side. `board-pick:` is a
 * Footyinfo draft-board club (issue 853): a board pick is read only as pick-side evidence.
 */
export const AFL_TRADE_PICK_SIDE_IDENTITY_SUBJECT_PREFIXES = [
  'selection:',
  'pick-outcome:',
  'board-pick:',
] as const;

/**
 * The one transfer-subject role that is pick-side: `transfer:<nativeTransferId>:original-club`, the
 * club whose future pick is traded (`resolveFutureOriginalClub`). A pick transfer whose original
 * club is unresolved gets an unresolvable pick id and an unresolved status, so its lineage issue is
 * deferred too and the pick gets no custody observation. The `:from`, `:to` and `:player` roles are
 * the exchange itself and stay blocking.
 */
export const AFL_TRADE_PICK_SIDE_TRANSFER_SUBJECT_ROLE = ':original-club';

export interface AflTradeReconciliationIssueLike {
  readonly code: string;
  readonly severity: string;
  readonly subjectKey: string;
}

/** A draft (`draftYear`, `draftType`) a deferred candidate leaves to its existing current promotion. */
export interface AflTradePromotedDraft {
  readonly draftYear: number;
  readonly draftType: string;
}

export interface AflTradePickLineageDeferral {
  readonly decisionId: string;
  /**
   * Drafts whose every candidate selection is already a current canonical selection of a finalized
   * promotion (the session-keyed draft promotions): a deferred-lineage promotion writes nothing of
   * them, so no second draft root, selection or player asset is created. Since migration 0278 every
   * one of those selections must also name the candidate's own player. Present only when non-empty.
   */
  readonly promotedDrafts?: AflTradePromotedDraft[];
  /**
   * Candidate selections whose source selection is current canonical under another player: an
   * identity repair re-targeted the draftee (#853, migration 0278). Every other candidate selection
   * in the same draft is current canonical with its own player, and the draft is not in
   * `promotedDrafts`. The promotion writes nothing else of such a draft: it re-promotes only these
   * slots, as one superseding version of each session root they sit in that carries only them
   * (additive under migration 0256, so every other draftee's dependents stay current). Sorted unique
   * candidate selection ids, present only when non-empty.
   */
  readonly resyncedSelectionIds?: string[];
  /**
   * Transactions whose trade event is already current canonical under the same stable key from a
   * finalized promotion, with every one of their transfers a promoted asset on that current version,
   * every pick transfer's pick id that asset's pick id and every player transfer's player that
   * asset's player: a deferred-lineage promotion writes nothing of them (no trade version, asset,
   * custody or realization). A transaction whose pick ids or players changed (#853) is not listed,
   * so its promotion writes a superseding version. Sorted unique transaction ids, present only when
   * non-empty.
   */
  readonly promotedTransactions?: string[];
  /**
   * Custody observations whose status is not usable (`unresolved` or `disputed`): pick-side, left
   * unwritten by a deferred-lineage promotion. Sorted unique custody ids, present only when non-empty.
   */
  readonly deferredCustodyIds?: string[];
  /**
   * Usable candidate custody rows recording an observation already canonical under a finalized
   * promotion with the same facts (#853), matched by pick, observation time and holder rather than
   * custody id: writing one would collide with the canonical row. Left unwritten. Sorted unique
   * candidate custody ids, present only when non-empty.
   */
  readonly promotedCustodyIds?: string[];
}

/**
 * A current canonical trade event as the repository reads it at preparation: the source transfer ids
 * promoted as assets on its current version, the pick id of each of those assets that names one, the
 * player id of each that names one (migration 0277), and whether that version came from a promotion
 * of reviewed pick lineage (a candidate carrying a reviewed correction or reviewed scope), whose pick
 * ids a reviewer settled and reconciliation does not override.
 */
export interface AflTradeCurrentCanonicalTransaction {
  readonly transactionId: string;
  readonly transferIds: readonly string[];
  readonly transferPickIds: readonly { readonly transferId: string; readonly pickId: string }[];
  readonly transferPlayerIds: readonly { readonly transferId: string; readonly playerId: string }[];
  readonly reviewedLineage: boolean;
}

/**
 * A current canonical draft selection as the repository reads it at preparation
 * (`outcome_current_canonical_draft_selection_players`, migration 0278): the source selection id of
 * a finalized promotion's selection that is approved and current under asset-scoped supersession
 * (0256, 0266), with its selection number and player.
 */
export interface AflTradeCurrentCanonicalDraftSelection {
  readonly selectionId: string;
  readonly selectionNumber: number;
  readonly playerId: string;
}

/**
 * A custody observation canonical under a finalized promotion, as the repository reads it at
 * preparation (`outcome_current_canonical_pick_custody`). `observedAt` is a UTC millisecond instant,
 * or null when the observation carries a partial `observedDate`.
 */
export interface AflTradeCurrentCanonicalPickCustody {
  readonly custodyId: string;
  readonly pickId: string;
  readonly observedAt: string | null;
  readonly observedDate: Readonly<Record<string, string | number>> | null;
  readonly draftSeasonYear: number;
  readonly draftKind: string;
  readonly recordedRound: number | null;
  readonly recordedPick: number | null;
  readonly originalClubId: string | null;
  readonly currentClubId: string;
  readonly predecessorCustodyId: string | null;
}

/**
 * Whether an issue's subject is pick-side. `lineage:` and `pick-custody:` subjects carry the lineage
 * codes; `selection:` and `pick-outcome:` identity subjects are a draft selection's player or club and
 * a stated outcome's receiving club or player; a `transfer:…:original-club` identity subject is the
 * club whose pick is traded. Every other `transfer:` role, `custody:`, `draft-session:` and
 * transaction subjects are not pick-side and stay blocking.
 */
export function isAflTradePickSideReconciliationIssue(issue: {
  readonly code: string;
  readonly subjectKey: string;
}): boolean {
  if ((AFL_TRADE_PICK_SIDE_ISSUE_CODES as readonly string[]).includes(issue.code)) return true;
  if (issue.code !== 'identity_unresolved') return false;
  return (
    AFL_TRADE_PICK_SIDE_IDENTITY_SUBJECT_PREFIXES.some((prefix) =>
      issue.subjectKey.startsWith(prefix)
    ) ||
    (issue.subjectKey.startsWith('transfer:') &&
      issue.subjectKey.endsWith(AFL_TRADE_PICK_SIDE_TRANSFER_SUBJECT_ROLE))
  );
}

export function draftCoverageKey(draftYear: number, draftType: string): string {
  return `${draftYear}|${draftType}`;
}

interface DeferralContentLike {
  readonly transactions: readonly {
    readonly transactionId: string;
    readonly transferIds: readonly string[];
  }[];
  readonly transfers: readonly {
    readonly transferId: string;
    readonly transactionId: string;
    readonly asset: { readonly kind: string; readonly pickId?: string };
  }[];
  readonly draftSelections: readonly {
    readonly selectionId: string;
    readonly draftYear: number;
    readonly draftType: string;
    readonly pickId: string;
  }[];
  readonly pickCustody: readonly {
    readonly custodyId: string;
    readonly pickId: string;
    readonly status: string;
  }[];
  readonly pickLineage: readonly {
    readonly lineageId: string;
    readonly pickId: string;
    readonly transferId: string;
    readonly selectionId: string | null;
  }[];
  readonly issues: readonly AflTradeReconciliationIssueLike[];
  readonly pickLineageDeferral?: AflTradePickLineageDeferral;
}

export interface AflTradePickLineageDeferralScope {
  readonly deferral: AflTradePickLineageDeferral | null;
  readonly deferredIssueCount: number;
  readonly blockingIssueCount: number;
  /** Pick transfers whose lineage issue is deferred (`lineage:<transferId>` subjects). */
  readonly deferredTransferIds: ReadonlySet<string>;
  /** Picks that get no custody observation and no realization: deferred transfers' picks and conflicting custody picks. */
  readonly deferredPickIds: ReadonlySet<string>;
  /** Drafts (`draftYear|draftType`) holding a selection whose identity is deferred; promoted by nobody from this candidate. */
  readonly deferredDraftKeys: ReadonlySet<string>;
  /** Drafts (`draftYear|draftType`) already current canonical through an earlier promotion; left to it. */
  readonly promotedDraftKeys: ReadonlySet<string>;
  /** Selections whose draftee an identity repair re-targeted; only these slots are re-promoted (#853). */
  readonly resyncedSelectionIds: ReadonlySet<string>;
  /** Drafts (`draftYear|draftType`) holding a re-synced selection; nothing else of them is written. */
  readonly resyncedDraftKeys: ReadonlySet<string>;
  /** Transactions already current canonical through an earlier promotion; left to it. */
  readonly promotedTransactionIds: ReadonlySet<string>;
  /** Custody observations without a usable status, deferred rather than written. */
  readonly deferredCustodyIds: ReadonlySet<string>;
  /** Custody observations already canonical with the candidate's facts; left to that promotion. */
  readonly promotedCustodyIds: ReadonlySet<string>;
}

/**
 * Derives the deferral scope from candidate content. Without a deferral every set is empty, so callers
 * that filter by it behave exactly as before.
 */
export function aflTradePickLineageDeferralScope(
  content: DeferralContentLike
): AflTradePickLineageDeferralScope {
  const deferredIssues = content.issues.filter((issue) => issue.severity === 'deferred');
  const resyncedSelectionIds = new Set(content.pickLineageDeferral?.resyncedSelectionIds ?? []);
  const blockingIssueCount = content.issues.length - deferredIssues.length;
  const deferredTransferIds = new Set<string>();
  const deferredPickIds = new Set<string>();
  const deferredDraftKeys = new Set<string>();
  const pickIdByTransfer = new Map(
    content.transfers.flatMap((transfer) =>
      transfer.asset.kind === 'pick_entitlement' && transfer.asset.pickId !== undefined
        ? [[transfer.transferId, transfer.asset.pickId] as const]
        : []
    )
  );
  for (const issue of deferredIssues) {
    if (issue.subjectKey.startsWith('lineage:')) {
      const transferId = issue.subjectKey.slice('lineage:'.length);
      deferredTransferIds.add(transferId);
      const pickId = pickIdByTransfer.get(transferId);
      if (pickId !== undefined) deferredPickIds.add(pickId);
    } else if (issue.subjectKey.startsWith('pick-custody:')) {
      // `pick-custody:<pickId>|<observedAt>`; a content-addressed pick id never contains `|`.
      const rest = issue.subjectKey.slice('pick-custody:'.length);
      const separator = rest.indexOf('|');
      deferredPickIds.add(separator < 0 ? rest : rest.slice(0, separator));
    } else if (issue.code === 'identity_unresolved' && issue.subjectKey.startsWith('selection:')) {
      // `selection:<draftYear>:<draftType>:<selectionNumber>:<role>`; draft types carry no `:`.
      const [, draftYear, draftType] = issue.subjectKey.split(':');
      if (draftYear !== undefined && draftType !== undefined) {
        deferredDraftKeys.add(draftCoverageKey(Number(draftYear), draftType));
      }
    }
  }
  return {
    deferral: content.pickLineageDeferral ?? null,
    deferredIssueCount: deferredIssues.length,
    blockingIssueCount,
    deferredTransferIds,
    deferredPickIds,
    deferredDraftKeys,
    promotedDraftKeys: new Set(
      (content.pickLineageDeferral?.promotedDrafts ?? []).map(({ draftYear, draftType }) =>
        draftCoverageKey(draftYear, draftType)
      )
    ),
    resyncedSelectionIds,
    resyncedDraftKeys: new Set(
      content.draftSelections
        .filter(({ selectionId }) => resyncedSelectionIds.has(selectionId))
        .map(({ draftYear, draftType }) => draftCoverageKey(draftYear, draftType))
    ),
    promotedTransactionIds: new Set(content.pickLineageDeferral?.promotedTransactions ?? []),
    deferredCustodyIds: new Set(content.pickLineageDeferral?.deferredCustodyIds ?? []),
    promotedCustodyIds: new Set(content.pickLineageDeferral?.promotedCustodyIds ?? []),
  };
}

/** A custody observation the promotion can write: single-source or corroborated. */
export function isAflTradeUsableCustodyStatus(status: string): boolean {
  return status === 'single_source' || status === 'corroborated';
}

/** Custody ids a deferred candidate records as deferred: every row without a usable status, sorted. */
export function aflTradeDeferredCustodyIds(
  pickCustody: readonly { readonly custodyId: string; readonly status: string }[]
): string[] {
  return [
    ...new Set(
      pickCustody
        .filter(({ status }) => !isAflTradeUsableCustodyStatus(status))
        .map(({ custodyId }) => custodyId)
    ),
  ].sort();
}

export interface AflTradePromotionWriteScope<Content extends DeferralContentLike> {
  readonly deferral: AflTradePickLineageDeferralScope;
  /** Transactions this promotion writes as trade events: none already current canonical. */
  readonly transactions: Content['transactions'];
  /** Directed transfers this promotion writes as assets: none of an already-promoted transaction. */
  readonly transfers: Content['transfers'];
  /**
   * Draft selections in drafts this promotion writes whole (none of a deferred, already-promoted or
   * re-synced draft).
   */
  readonly draftSelections: Content['draftSelections'];
  /**
   * Selections re-promoted alone because an identity repair re-targeted their draftee (#853): each
   * is written into one scoped later version of the session it is current in, never a whole draft.
   */
  readonly resyncedSelections: Content['draftSelections'];
  /** Custody observations this promotion writes (none for a deferred pick, none already canonical). */
  readonly pickCustody: Content['pickCustody'];
  /** `exercised_as` realizations this promotion writes (none for a deferred pick or a deferred or already-promoted draft). */
  readonly pickLineage: Content['pickLineage'];
  /** Drafts left to their existing current promotion. */
  readonly promotedDraftCount: number;
  /** Selections re-promoted alone under a changed player (`resyncedSelections.length`). */
  readonly resyncedSelectionCount: number;
  /** Transactions left to their existing current promotion. */
  readonly promotedTransactionCount: number;
  /** Custody observations without a usable status, left unwritten under the deferral. */
  readonly deferredCustodyCount: number;
  /** Custody observations already canonical with the candidate's facts, left unwritten. */
  readonly promotedCustodyCount: number;
  /**
   * Resolved lineages whose selection sits in an already-promoted or re-synced draft, or whose
   * transfer belongs
   * to an already-promoted transaction. Their realization is not written: the existing selection
   * row keys its pick by draft slot while this candidate keys it by custody, and a skipped transfer
   * has no asset of this promotion to bind. Reviewed lineage binds them.
   */
  readonly skippedRealizationCount: number;
}

/**
 * The records a canonical promotion of this candidate writes. Transactions and every directed asset
 * are always written; the pick side is reduced by the deferral scope. Without a deferral the result is
 * the content unchanged.
 */
export function aflTradePromotionWriteScope<Content extends DeferralContentLike>(
  content: Content
): AflTradePromotionWriteScope<Content> {
  const deferral = aflTradePickLineageDeferralScope(content);
  if (deferral.deferredIssueCount === 0) {
    return {
      deferral,
      transactions: content.transactions,
      transfers: content.transfers,
      draftSelections: content.draftSelections,
      resyncedSelections: content.draftSelections.filter(() => false) as Content['draftSelections'],
      pickCustody: content.pickCustody,
      pickLineage: content.pickLineage,
      promotedDraftCount: 0,
      resyncedSelectionCount: 0,
      promotedTransactionCount: 0,
      deferredCustodyCount: 0,
      promotedCustodyCount: 0,
      skippedRealizationCount: 0,
    };
  }
  const skippedTransfer = (transfer: { readonly transactionId: string }) =>
    deferral.promotedTransactionIds.has(transfer.transactionId);
  const skippedTransferIds = new Set(
    content.transfers.filter(skippedTransfer).map(({ transferId }) => transferId)
  );
  const selectionIdsIn = (keys: ReadonlySet<string>) =>
    new Set(
      content.draftSelections
        .filter((selection) => keys.has(draftCoverageKey(selection.draftYear, selection.draftType)))
        .map(({ selectionId }) => selectionId)
    );
  const deferredSelectionIds = selectionIdsIn(deferral.deferredDraftKeys);
  // A re-synced draft is left like an already-promoted one, apart from its re-synced slots.
  const promotedSelectionIds = selectionIdsIn(
    new Set([...deferral.promotedDraftKeys, ...deferral.resyncedDraftKeys])
  );
  const deferredLineage = (lineage: Content['pickLineage'][number]) =>
    deferral.deferredPickIds.has(lineage.pickId) ||
    deferral.deferredTransferIds.has(lineage.transferId) ||
    (lineage.selectionId !== null && deferredSelectionIds.has(lineage.selectionId));
  const skippedLineage = (lineage: Content['pickLineage'][number]) =>
    !deferredLineage(lineage) &&
    ((lineage.selectionId !== null && promotedSelectionIds.has(lineage.selectionId)) ||
      skippedTransferIds.has(lineage.transferId));
  return {
    deferral,
    transactions: content.transactions.filter(
      ({ transactionId }) => !deferral.promotedTransactionIds.has(transactionId)
    ) as Content['transactions'],
    transfers: content.transfers.filter(
      (transfer) => !skippedTransfer(transfer)
    ) as Content['transfers'],
    draftSelections: content.draftSelections.filter(
      ({ selectionId }) =>
        !deferredSelectionIds.has(selectionId) && !promotedSelectionIds.has(selectionId)
    ) as Content['draftSelections'],
    resyncedSelections: content.draftSelections.filter(({ selectionId }) =>
      deferral.resyncedSelectionIds.has(selectionId)
    ) as Content['draftSelections'],
    pickCustody: content.pickCustody.filter(
      ({ pickId, custodyId }) =>
        !deferral.deferredPickIds.has(pickId) &&
        !deferral.deferredCustodyIds.has(custodyId) &&
        !deferral.promotedCustodyIds.has(custodyId)
    ) as Content['pickCustody'],
    pickLineage: content.pickLineage.filter(
      (lineage) => !deferredLineage(lineage) && !skippedLineage(lineage)
    ) as Content['pickLineage'],
    promotedDraftCount: deferral.promotedDraftKeys.size,
    resyncedSelectionCount: deferral.resyncedSelectionIds.size,
    promotedTransactionCount: deferral.promotedTransactionIds.size,
    deferredCustodyCount: deferral.deferredCustodyIds.size,
    promotedCustodyCount: deferral.promotedCustodyIds.size,
    skippedRealizationCount: content.pickLineage.filter(skippedLineage).length,
  };
}

/**
 * Transactions a deferred candidate leaves to an existing promotion: the transaction's trade event
 * is current canonical and every one of the candidate's transfers in it is a promoted asset on that
 * current version whose pick id, for a pick transfer, is the candidate's own and whose player, for a
 * player transfer, is the candidate's own (`current`, resolved by the repository at preparation). A
 * special transfer compares nothing more. A transaction whose pick ids changed since it was promoted,
 * or whose player an identity repair re-targeted (#853), is not listed, so a promotion of the
 * candidate writes a superseding version with the new ids. Transfer ids are keyed by the provider's
 * native ids, never by the resolved pick or player, so the ids alone cannot show either change. A
 * version from reviewed pick lineage is exempt from both comparisons: rewriting it from the
 * candidate would replace the pick ids a reviewer settled (migrations 0274 and 0277 check the same
 * rule). Sorted unique ids; empty when nothing qualifies.
 */
export function aflTradePromotedTransactions(
  transactions: readonly {
    readonly transactionId: string;
    readonly transferIds: readonly string[];
  }[],
  transfers: readonly {
    readonly transferId: string;
    readonly asset: {
      readonly kind: string;
      readonly pickId?: string;
      readonly playerId?: string | null;
    };
  }[],
  current: readonly AflTradeCurrentCanonicalTransaction[]
): string[] {
  const promotedById = new Map(
    current.map((entry) => [
      entry.transactionId,
      {
        reviewedLineage: entry.reviewedLineage,
        transferIds: new Set(entry.transferIds),
        pickIdByTransfer: new Map(
          entry.transferPickIds.map(({ transferId, pickId }) => [transferId, pickId] as const)
        ),
        playerIdByTransfer: new Map(
          entry.transferPlayerIds.map(({ transferId, playerId }) => [transferId, playerId] as const)
        ),
      },
    ])
  );
  const transferById = new Map(transfers.map((transfer) => [transfer.transferId, transfer]));
  return [
    ...new Set(
      transactions
        .filter(({ transactionId, transferIds }) => {
          const promoted = promotedById.get(transactionId);
          return (
            promoted !== undefined &&
            transferIds.every((transferId) => {
              const transfer = transferById.get(transferId);
              if (transfer === undefined || !promoted.transferIds.has(transferId)) return false;
              if (promoted.reviewedLineage) return true;
              if (transfer.asset.kind === 'pick_entitlement') {
                return (
                  transfer.asset.pickId !== undefined &&
                  transfer.asset.pickId === promoted.pickIdByTransfer.get(transferId)
                );
              }
              if (transfer.asset.kind === 'player') {
                return (
                  typeof transfer.asset.playerId === 'string' &&
                  transfer.asset.playerId === promoted.playerIdByTransfer.get(transferId)
                );
              }
              return true;
            })
          );
        })
        .map(({ transactionId }) => transactionId)
    ),
  ].sort();
}

const CANONICAL_DRAFT_KIND_BY_TYPE = new Map([
  ['national', 'national_draft'],
  ['national_draft', 'national_draft'],
  ['preseason', 'preseason_draft'],
  ['pre_season', 'preseason_draft'],
  ['preseason_draft', 'preseason_draft'],
  ['rookie', 'rookie_draft'],
  ['rookie_draft', 'rookie_draft'],
  ['midseason', 'midseason_draft'],
  ['mid_season', 'midseason_draft'],
  ['midseason_draft', 'midseason_draft'],
  ['mini_draft', 'supplemental_selection'],
  ['supplemental_selection', 'supplemental_selection'],
]);

/**
 * The canonical draft kind a candidate draft type is promoted as (the promoter's mapping, and
 * `outcome_external_draft_type_kind` in migration 0274); null when there is none.
 */
export function aflTradeCanonicalDraftKind(draftType: string): string | null {
  return (
    CANONICAL_DRAFT_KIND_BY_TYPE.get(
      draftType
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    ) ?? null
  );
}

/**
 * The observation time as a comparable key: an instant as its UTC millisecond form, a partial date
 * by its precision and value. Null when the value is neither.
 */
function custodyObservationTimeKey(observedAt: unknown): string | null {
  if (typeof observedAt === 'string') {
    const instant = Date.parse(observedAt);
    return Number.isNaN(instant) ? null : `at:${new Date(instant).toISOString()}`;
  }
  if (typeof observedAt !== 'object' || observedAt === null) return null;
  const date = observedAt as Readonly<Record<string, unknown>>;
  return `date:${JSON.stringify(
    Object.keys(date)
      .sort()
      .map((key) => [key, date[key]])
  )}`;
}

/** The observation a custody row records: pick, observation time and holder. */
function custodyObservationKey(
  pickId: string,
  observedAt: unknown,
  currentClubId: string | null
): string | null {
  const time = custodyObservationTimeKey(observedAt);
  return time === null || currentClubId === null
    ? null
    : JSON.stringify([pickId, time, currentClubId]);
}

/**
 * Custody a deferred candidate leaves to an existing promotion: usable candidate custody rows that
 * record an observation already canonical under a finalized promotion (`current`, resolved by the
 * repository at preparation; migration 0274 checks the same rule). The observation is matched by
 * pick, observation time and holder, which for an instant is the canonical unique key
 * (`outcome_pick_custody_observation_key`), not by custody id: a custody id addresses its evidence,
 * and a re-captured page gives the same observation new evidence. The matched row must then state
 * the same draft, recorded round and pick and original club, and neither row may name a predecessor
 * (a candidate predecessor names a candidate custody id, a canonical one a canonical id, so they
 * cannot be compared). Writing a listed row would collide with the canonical one; a row whose facts
 * differ is not listed and still refuses. Sorted unique candidate custody ids; empty when nothing
 * qualifies.
 */
export function aflTradePromotedCustodyIds(
  pickCustody: readonly {
    readonly custodyId: string;
    readonly pickId: string;
    readonly observedAt: unknown;
    readonly predecessorCustodyId?: string | null;
    readonly draftYear: number;
    readonly draftType: string;
    readonly roundNumber: number | null;
    readonly recordedPickNumber: number | null;
    readonly originalClubId: string | null;
    readonly currentClubId: string | null;
    readonly status: string;
  }[],
  current: readonly AflTradeCurrentCanonicalPickCustody[]
): string[] {
  const currentByObservation = new Map<string, AflTradeCurrentCanonicalPickCustody[]>();
  for (const stored of current) {
    const key = custodyObservationKey(
      stored.pickId,
      stored.observedAt ?? stored.observedDate,
      stored.currentClubId
    );
    if (key === null) continue;
    currentByObservation.set(key, [...(currentByObservation.get(key) ?? []), stored]);
  }
  return [
    ...new Set(
      pickCustody
        .filter((custody) => {
          if (
            !isAflTradeUsableCustodyStatus(custody.status) ||
            (custody.predecessorCustodyId ?? null) !== null
          ) {
            return false;
          }
          const key = custodyObservationKey(
            custody.pickId,
            custody.observedAt,
            custody.currentClubId
          );
          const draftKind = aflTradeCanonicalDraftKind(custody.draftType);
          return (key === null ? [] : (currentByObservation.get(key) ?? [])).some(
            (stored) =>
              stored.predecessorCustodyId === null &&
              stored.draftSeasonYear === custody.draftYear &&
              stored.draftKind === draftKind &&
              stored.recordedRound === custody.roundNumber &&
              stored.recordedPick === custody.recordedPickNumber &&
              stored.originalClubId === custody.originalClubId
          );
        })
        .map(({ custodyId }) => custodyId)
    ),
  ].sort();
}

/**
 * How a deferred candidate treats drafts that are already current canonical (`current`, resolved by
 * the repository at preparation; migration 0278 checks the same rules):
 *
 * - `promotedDrafts`: every candidate selection in the draft is current canonical and names the
 *   candidate's own player. The promotion writes nothing of it. A selection without a player (its
 *   identity is an unresolved pick-side issue, so the draft is deferred anyway) compares its id
 *   alone, as before migration 0278.
 * - `resyncedSelectionIds`: every candidate selection in the draft is current canonical, but an
 *   identity repair re-targeted some draftees (#853): a later revision of the same external identity
 *   subject names another canonical player, such as the AFL Tables twin of a Draftguru-created
 *   player. Source selection ids are keyed by draft slot, never by player, so only the player shows
 *   the repair. The promotion re-promotes exactly those slots, as one scoped later version of each
 *   session they are current in; every other selection of the draft must still name its own player.
 *
 * A re-sync repairs the player alone: it keeps the promoted row's pick id and club, so a changed
 * selection may be `unresolved` on the pick side (its pick custody not uniquely resolved) but needs
 * its club and must not be disputed. A draft holding a selection with no current canonical row is
 * neither: the promotion writes it as before. A changed selection that is current more
 * than once (under two roots) cannot be re-promoted into one session, so preparation refuses rather
 * than guess. Drafts sorted by year then type, selection ids sorted; both empty when nothing
 * qualifies.
 */
export function aflTradePromotedDraftState(
  draftSelections: readonly {
    readonly selectionId: string;
    readonly draftYear: number;
    readonly draftType: string;
    readonly selectionNumber: number;
    readonly playerId: string | null;
    readonly clubId: string | null;
    readonly status: string;
  }[],
  current: readonly AflTradeCurrentCanonicalDraftSelection[]
): { promotedDrafts: AflTradePromotedDraft[]; resyncedSelectionIds: string[] } {
  const currentBySelection = new Map<string, AflTradeCurrentCanonicalDraftSelection[]>();
  for (const row of current) {
    currentBySelection.set(row.selectionId, [
      ...(currentBySelection.get(row.selectionId) ?? []),
      row,
    ]);
  }
  const byDraft = new Map<
    string,
    { draft: AflTradePromotedDraft; selections: (typeof draftSelections)[number][] }
  >();
  for (const selection of draftSelections) {
    const key = draftCoverageKey(selection.draftYear, selection.draftType);
    const entry = byDraft.get(key) ?? {
      draft: { draftYear: selection.draftYear, draftType: selection.draftType },
      selections: [],
    };
    entry.selections.push(selection);
    byDraft.set(key, entry);
  }
  const promotedDrafts: AflTradePromotedDraft[] = [];
  const resyncedSelectionIds: string[] = [];
  for (const { draft, selections } of byDraft.values()) {
    if (selections.some(({ selectionId }) => !currentBySelection.has(selectionId))) continue;
    const changed = selections.filter(
      ({ selectionId, playerId }) =>
        playerId !== null &&
        !(currentBySelection.get(selectionId) ?? []).some((row) => row.playerId === playerId)
    );
    if (changed.length === 0) {
      promotedDrafts.push(draft);
      continue;
    }
    for (const selection of changed) {
      const rows = currentBySelection.get(selection.selectionId) ?? [];
      if (rows.length !== 1 || rows[0]!.selectionNumber !== selection.selectionNumber) {
        throw new TypeError(
          `Draft ${draft.draftYear} ${draft.draftType} selection ${selection.selectionNumber} changed player but is current canonical ${rows.length} times or under another number; it cannot be re-promoted into one session.`
        );
      }
      // A re-sync repairs the player alone and keeps the promoted pick id (migration 0279), so a
      // selection unresolved only on the pick side qualifies; one with no club or in dispute does not.
      if (selection.clubId === null || selection.status === 'disputed') {
        throw new TypeError(
          `Draft ${draft.draftYear} ${draft.draftType} selection ${selection.selectionNumber} changed player but its club is unresolved or its providers disagree; it cannot be re-promoted.`
        );
      }
      resyncedSelectionIds.push(selection.selectionId);
    }
  }
  return {
    promotedDrafts: promotedDrafts.sort(
      (left, right) =>
        left.draftYear - right.draftYear || left.draftType.localeCompare(right.draftType)
    ),
    resyncedSelectionIds: [...new Set(resyncedSelectionIds)].sort(),
  };
}
