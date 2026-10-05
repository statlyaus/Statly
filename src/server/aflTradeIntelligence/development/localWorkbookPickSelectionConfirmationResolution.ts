import type { DraftTradeAssetItem } from '@/lib/draftTrades/read';

import {
  createLocalWorkbookPickSelectionConfirmation,
  type LocalWorkbookPickSelectionConfirmation,
} from './localWorkbookPickSelectionConfirmation';

export interface LocalWorkbookPickSelectionIdentityCandidate {
  readonly canonicalPlayerId: string;
  readonly recordedName: string;
  readonly identityDecisionIds: readonly string[];
  readonly reviewedSeasonIds: readonly string[];
}

export type LocalWorkbookPickSelectionConfirmationResolution =
  | {
      readonly state: 'reviewable';
      readonly confirmation: LocalWorkbookPickSelectionConfirmation;
    }
  | {
      readonly state: 'unavailable';
      readonly reason:
        | 'asset_kind_not_supported'
        | 'future_pick_draft_year_not_recorded'
        | 'final_selection_not_recorded'
        | 'drafted_player_not_recorded'
        | 'selected_player_identity_unresolved'
        | 'selected_player_identity_review_required'
        | 'selected_player_identity_ambiguous';
    };

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-AU');
}

function uniqueCandidate(
  label: string,
  candidates: readonly LocalWorkbookPickSelectionIdentityCandidate[],
  confirmedCanonicalPlayerId: string | undefined
): LocalWorkbookPickSelectionIdentityCandidate | 'ambiguous' | 'review_required' | null {
  if (confirmedCanonicalPlayerId === undefined) return 'review_required';
  const target = normalized(label);
  const exact = candidates.filter(({ recordedName }) => normalized(recordedName) === target);
  const matches = (exact.length > 0 || target.includes(' ')
    ? exact
    : candidates.filter(
        ({ canonicalPlayerId, recordedName }) =>
          canonicalPlayerId === confirmedCanonicalPlayerId &&
          normalized(recordedName).split(' ').at(-1) === target
      )).filter(({ canonicalPlayerId }) => canonicalPlayerId === confirmedCanonicalPlayerId);
  const canonicalIds = [...new Set(matches.map(({ canonicalPlayerId }) => canonicalPlayerId))];
  if (canonicalIds.length === 0) return null;
  if (canonicalIds.length > 1) return 'ambiguous';
  return [...matches]
    .filter(({ canonicalPlayerId }) => canonicalPlayerId === canonicalIds[0])
    .sort(
      (left, right) =>
        right.reviewedSeasonIds.length - left.reviewedSeasonIds.length ||
        right.identityDecisionIds.length - left.identityDecisionIds.length ||
        normalized(left.recordedName).localeCompare(normalized(right.recordedName), 'en-AU')
    )[0]!;
}

export function resolveLocalWorkbookPickSelectionConfirmation(input: Readonly<{
  asset: DraftTradeAssetItem;
  workbookSha256: string;
  valuationScopeKey: string;
  evidenceBundleId: string;
  candidates: readonly LocalWorkbookPickSelectionIdentityCandidate[];
  reviewerId: string;
  rationale: string;
  reviewedAt: string;
  confirmedCanonicalPlayerId?: string;
}>): LocalWorkbookPickSelectionConfirmationResolution {
  if (input.asset.assetType !== 'pick' && input.asset.assetType !== 'future_pick') {
    return { state: 'unavailable', reason: 'asset_kind_not_supported' };
  }
  const draftYear =
    input.asset.assetType === 'future_pick' ? input.asset.pick.year : input.asset.year;
  if (draftYear === null) {
    return { state: 'unavailable', reason: 'future_pick_draft_year_not_recorded' };
  }
  if (input.asset.pick.numberActual === null) {
    return { state: 'unavailable', reason: 'final_selection_not_recorded' };
  }
  if (!input.asset.draftedPlayer?.trim()) {
    return { state: 'unavailable', reason: 'drafted_player_not_recorded' };
  }
  const identity = uniqueCandidate(
    input.asset.draftedPlayer,
    input.candidates,
    input.confirmedCanonicalPlayerId
  );
  if (identity === null) {
    return { state: 'unavailable', reason: 'selected_player_identity_unresolved' };
  }
  if (identity === 'ambiguous') {
    return { state: 'unavailable', reason: 'selected_player_identity_ambiguous' };
  }
  if (identity === 'review_required') {
    return { state: 'unavailable', reason: 'selected_player_identity_review_required' };
  }
  return {
    state: 'reviewable',
    confirmation: createLocalWorkbookPickSelectionConfirmation({
      workbookSha256: input.workbookSha256,
      valuationScopeKey: input.valuationScopeKey,
      tradeId: input.asset.tradeId,
      assetId: input.asset.id,
      assetKind: input.asset.assetType,
      sourceAssetText: input.asset.assetText,
      receivingClubName: input.asset.clubName,
      tradeYear: input.asset.year,
      draftYear,
      selectionNumber: input.asset.pick.numberActual,
      draftedPlayerName: input.asset.draftedPlayer,
      canonicalPlayerId: identity.canonicalPlayerId,
      recordedName: identity.recordedName,
      evidenceBundleId: input.evidenceBundleId,
      identityDecisionIds: [...identity.identityDecisionIds],
      reviewedSeasonIds: [...identity.reviewedSeasonIds],
      reviewerId: input.reviewerId,
      rationale: input.rationale,
      reviewedAt: input.reviewedAt,
    }),
  };
}
