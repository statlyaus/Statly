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
 * carries that is already current canonical (`promotedDrafts`, resolved at preparation and checked
 * by the database) is left to that promotion rather than written again under a session-less root.
 */

export const AFL_TRADE_PICK_SIDE_ISSUE_CODES = [
  'lineage_unresolved',
  'pick_outcome_unresolved',
  'pick_identity_conflict',
] as const;

/** Subject-key prefixes of `identity_unresolved` issues that are pick-side. */
export const AFL_TRADE_PICK_SIDE_IDENTITY_SUBJECT_PREFIXES = [
  'selection:',
  'pick-outcome:',
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
   * them, so no second draft root, selection or player asset is created. Present only when non-empty.
   */
  readonly promotedDrafts?: AflTradePromotedDraft[];
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
  readonly transfers: readonly {
    readonly transferId: string;
    readonly asset: { readonly kind: string; readonly pickId?: string };
  }[];
  readonly draftSelections: readonly {
    readonly selectionId: string;
    readonly draftYear: number;
    readonly draftType: string;
    readonly pickId: string;
  }[];
  readonly pickCustody: readonly { readonly custodyId: string; readonly pickId: string }[];
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
}

/**
 * Derives the deferral scope from candidate content. Without a deferral every set is empty, so callers
 * that filter by it behave exactly as before.
 */
export function aflTradePickLineageDeferralScope(
  content: DeferralContentLike
): AflTradePickLineageDeferralScope {
  const deferredIssues = content.issues.filter((issue) => issue.severity === 'deferred');
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
  };
}

export interface AflTradePromotionWriteScope<Content extends DeferralContentLike> {
  readonly deferral: AflTradePickLineageDeferralScope;
  /** Draft selections in drafts this promotion writes (none of a deferred or already-promoted draft). */
  readonly draftSelections: Content['draftSelections'];
  /** Custody observations this promotion writes (none for a deferred pick). */
  readonly pickCustody: Content['pickCustody'];
  /** `exercised_as` realizations this promotion writes (none for a deferred pick or a deferred or already-promoted draft). */
  readonly pickLineage: Content['pickLineage'];
  /** Drafts left to their existing current promotion. */
  readonly promotedDraftCount: number;
  /**
   * Resolved lineages whose selection sits in an already-promoted draft. Their realization is not
   * written: the existing selection row keys its pick by draft slot while this candidate keys it by
   * custody, so the realization validator's pick identity would not hold. Reviewed lineage binds them.
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
      draftSelections: content.draftSelections,
      pickCustody: content.pickCustody,
      pickLineage: content.pickLineage,
      promotedDraftCount: 0,
      skippedRealizationCount: 0,
    };
  }
  const selectionIdsIn = (keys: ReadonlySet<string>) =>
    new Set(
      content.draftSelections
        .filter((selection) => keys.has(draftCoverageKey(selection.draftYear, selection.draftType)))
        .map(({ selectionId }) => selectionId)
    );
  const deferredSelectionIds = selectionIdsIn(deferral.deferredDraftKeys);
  const promotedSelectionIds = selectionIdsIn(deferral.promotedDraftKeys);
  const deferredLineage = (lineage: Content['pickLineage'][number]) =>
    deferral.deferredPickIds.has(lineage.pickId) ||
    deferral.deferredTransferIds.has(lineage.transferId) ||
    (lineage.selectionId !== null && deferredSelectionIds.has(lineage.selectionId));
  const skippedLineage = (lineage: Content['pickLineage'][number]) =>
    !deferredLineage(lineage) &&
    lineage.selectionId !== null &&
    promotedSelectionIds.has(lineage.selectionId);
  return {
    deferral,
    draftSelections: content.draftSelections.filter(
      ({ selectionId }) =>
        !deferredSelectionIds.has(selectionId) && !promotedSelectionIds.has(selectionId)
    ) as Content['draftSelections'],
    pickCustody: content.pickCustody.filter(
      ({ pickId }) => !deferral.deferredPickIds.has(pickId)
    ) as Content['pickCustody'],
    pickLineage: content.pickLineage.filter(
      (lineage) => !deferredLineage(lineage) && !skippedLineage(lineage)
    ) as Content['pickLineage'],
    promotedDraftCount: deferral.promotedDraftKeys.size,
    skippedRealizationCount: content.pickLineage.filter(skippedLineage).length,
  };
}

/**
 * Drafts a deferred candidate leaves to an existing promotion: every one of its selections in the
 * draft is already a current canonical selection (`promotedSelectionIds`, resolved by the repository
 * at preparation). Sorted by year then type; empty when nothing qualifies.
 */
export function aflTradePromotedDrafts(
  draftSelections: readonly {
    readonly selectionId: string;
    readonly draftYear: number;
    readonly draftType: string;
  }[],
  promotedSelectionIds: ReadonlySet<string>
): AflTradePromotedDraft[] {
  const byDraft = new Map<string, { draft: AflTradePromotedDraft; promoted: boolean }>();
  for (const selection of draftSelections) {
    const key = draftCoverageKey(selection.draftYear, selection.draftType);
    const entry = byDraft.get(key) ?? {
      draft: { draftYear: selection.draftYear, draftType: selection.draftType },
      promoted: true,
    };
    entry.promoted &&= promotedSelectionIds.has(selection.selectionId);
    byDraft.set(key, entry);
  }
  return [...byDraft.values()]
    .filter(({ promoted }) => promoted)
    .map(({ draft }) => draft)
    .sort(
      (left, right) =>
        left.draftYear - right.draftYear || left.draftType.localeCompare(right.draftType)
    );
}
