export const AFL_TRADE_ASSET_TYPES = [
  'player',
  'current_pick_entitlement',
  'future_pick_entitlement',
  'draft_selection',
  'package',
  'unresolved',
  'unsupported_consideration',
] as const;

export const AFL_TRADE_LINEAGE_EDGE_KINDS = [
  'future_right_resolved_to_pick',
  'pick_renumbered_to_pick',
  'pick_exercised_at_selection',
  'selection_created_player',
  'asset_traded_for_asset',
  'asset_traded_for_package',
  'package_contains_asset',
  'player_exit_returned_asset',
] as const;

export const AFL_TRADE_ASSET_DISPOSITION_KINDS = ['asset_voided', 'asset_expired'] as const;

export const AFL_TRADE_CORRECTION_RELATION_KINDS = [
  'identity_corrected_to',
  'evidence_supersedes',
] as const;

export type AflTradeAssetType = (typeof AFL_TRADE_ASSET_TYPES)[number];
export type AflTradeLineageEdgeKind = (typeof AFL_TRADE_LINEAGE_EDGE_KINDS)[number];
export type AflTradeAssetDispositionKind = (typeof AFL_TRADE_ASSET_DISPOSITION_KINDS)[number];
export type AflTradeCorrectionRelationKind = (typeof AFL_TRADE_CORRECTION_RELATION_KINDS)[number];

export interface AflTradeAsset {
  assetId: string;
  assetType: AflTradeAssetType;
  effectiveFrom: string;
  knownFrom: string;
  knownTo: string | null;
  evidenceId: string;
}

/**
 * Real AFL club custody only. Public archive records deliberately have no Statly user, league,
 * membership, fantasy season, or roster owner.
 */
export interface AflTradeAssetCustodySpell {
  custodySpellId: string;
  assetId: string;
  aflClubId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  knownFrom: string;
  knownTo: string | null;
  evidenceId: string;
}

/**
 * A value transformation. AFL club movement preserves identity and is represented by custody;
 * lineage edges exist only when one value-bearing asset produces a different successor asset.
 */
export interface AflTradeLineageEdge {
  edgeId: string;
  kind: AflTradeLineageEdgeKind;
  sourceAssetId: string;
  targetAssetId: string;
  effectiveAt: string;
  knownFrom: string;
  knownTo: string | null;
  evidenceId: string;
  ruleVersion: string;
}

/** A unary terminal event that removes an asset without inventing a successor. */
export interface AflTradeAssetDisposition {
  dispositionId: string;
  kind: AflTradeAssetDispositionKind;
  assetId: string;
  effectiveAt: string;
  knownFrom: string;
  knownTo: string | null;
  evidenceId: string;
  reasonCode: string;
}

/** Knowledge-only provenance. Correction relations are never traversed as value lineage. */
export interface AflTradeCorrectionRelation {
  correctionId: string;
  kind: AflTradeCorrectionRelationKind;
  supersededRecordId: string;
  replacementRecordId: string;
  knownAt: string;
  evidenceId: string;
}

export type AflTradeLineageIssueCode =
  | 'duplicate_asset'
  | 'duplicate_custody_spell'
  | 'duplicate_edge'
  | 'duplicate_disposition'
  | 'duplicate_correction'
  | 'missing_asset'
  | 'self_edge'
  | 'invalid_edge_types'
  | 'invalid_time'
  | 'invalid_knowledge_interval'
  | 'edge_before_asset'
  | 'disposition_before_asset'
  | 'invalid_custody_interval'
  | 'overlapping_custody'
  | 'conflicting_successors'
  | 'conflicting_disposition'
  | 'terminal_asset_has_successor'
  | 'empty_package'
  | 'self_correction'
  | 'cycle';

export interface AflTradeLineageIssue {
  code: AflTradeLineageIssueCode;
  message: string;
  subjectId: string;
}

export interface AflTradeLineageGraph {
  assets: readonly AflTradeAsset[];
  custodySpells: readonly AflTradeAssetCustodySpell[];
  edges: readonly AflTradeLineageEdge[];
  dispositions: readonly AflTradeAssetDisposition[];
  corrections: readonly AflTradeCorrectionRelation[];
}

export interface AflTradeLineageValidation {
  valid: boolean;
  issues: AflTradeLineageIssue[];
}

export type AflTradeAttributionIssueCode =
  | 'duplicate_root'
  | 'duplicate_credit'
  | 'duplicate_exclusion'
  | 'unknown_root'
  | 'unknown_credit'
  | 'unknown_exclusion'
  | 'root_not_visible'
  | 'asset_both_credited_and_excluded'
  | 'non_value_bearing_credit'
  | 'ancestor_double_counted'
  | 'missing_frontier_asset'
  | 'unexpected_frontier_asset';

export interface AflTradeAttributionIssue {
  code: AflTradeAttributionIssueCode;
  message: string;
  assetId: string;
}

export interface AflTradeTemporalCutoff {
  effectiveAsOf: string;
  knowledgeCutoffAt: string;
}

export interface AflTradeAttributionRequest extends AflTradeTemporalCutoff {
  rootAssetIds: readonly string[];
  creditedAssetIds: readonly string[];
  excludedAssetIds?: readonly string[];
}

export interface AflTradeAttributionValidation {
  valid: boolean;
  expectedFrontierAssetIds: string[];
  issues: AflTradeAttributionIssue[];
}

const valueBearingAssetTypes = new Set<AflTradeAssetType>([
  'player',
  'current_pick_entitlement',
  'future_pick_entitlement',
]);

export function isAflTradeValueBearingAssetType(assetType: AflTradeAssetType): boolean {
  return valueBearingAssetTypes.has(assetType);
}
