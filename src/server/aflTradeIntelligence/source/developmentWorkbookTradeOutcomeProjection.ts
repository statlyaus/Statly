import type { DraftTradeAssetItem } from '@/lib/draftTrades/firestore';

import type {
  AflOutcomesDevelopmentAcquisitionCategory,
  AflOutcomesDevelopmentAcquisitionItem,
  AflOutcomesDevelopmentAcquisitionProjection,
} from './developmentWorkbookAcquisitionProjection';
import type { AflOutcomesDevelopmentWorkbook } from './developmentWorkbookStructure';
import type { AflOutcomesDevelopmentTradeProjection } from './developmentWorkbookTradeProjection';

export const AFL_OUTCOMES_DEVELOPMENT_TRADE_GRADE_SCHEMA_VERSION =
  'afl-outcomes-development-trade-grade/v1' as const;

export const AFL_OUTCOMES_DEVELOPMENT_GRADE_VALUES = [
  'A+',
  'A',
  'B+',
  'B',
  'C+',
  'C',
  'D',
] as const;

export type AflOutcomesDevelopmentGrade =
  (typeof AFL_OUTCOMES_DEVELOPMENT_GRADE_VALUES)[number];

export type AflOutcomesDevelopmentTradeGradeReason =
  | 'future_pick_unresolved'
  | 'draft_selection_not_recorded'
  | 'no_acquisition_match'
  | 'ambiguous_acquisition_match'
  | 'grade_not_recorded'
  | 'grade_not_recognized';

export type AflOutcomesDevelopmentTradeGradeMatchMethod =
  | 'receiving_club_trade_player'
  | 'receiving_club_draft_selection';

export interface AflOutcomesDevelopmentTradeGradeOutcome {
  eventId: string;
  acquisitionCategory: AflOutcomesDevelopmentAcquisitionCategory;
  acquisitionType: string;
  playerName: string;
  grade: AflOutcomesDevelopmentGrade | null;
  games: string | null;
  goals: string | null;
  coachesVotes: string | null;
  brownlowVotes: string | null;
  awards: string | null;
}

export interface AflOutcomesDevelopmentTradeGradeAsset {
  assetId: string;
  clubSlug: string;
  clubName: string;
  assetType: DraftTradeAssetItem['assetType'];
  assetText: string;
  status: 'graded' | 'matched_without_grade' | 'unresolved';
  matchMethod: AflOutcomesDevelopmentTradeGradeMatchMethod | null;
  reasonCode: AflOutcomesDevelopmentTradeGradeReason | null;
  outcome: AflOutcomesDevelopmentTradeGradeOutcome | null;
}

export interface AflOutcomesDevelopmentTradeGradeEvidence {
  schemaVersion: typeof AFL_OUTCOMES_DEVELOPMENT_TRADE_GRADE_SCHEMA_VERSION;
  tradeId: string;
  status: 'complete' | 'partial' | 'unavailable';
  source: Readonly<{
    originalFilename: string;
    sha256: string;
    observedAt: string;
  }>;
  coverage: Readonly<{
    totalAssets: number;
    matchedAssets: number;
    gradedAssets: number;
    unresolvedAssets: number;
    matchedWithoutGradeAssets: number;
  }>;
  assets: readonly AflOutcomesDevelopmentTradeGradeAsset[];
}

const DRAFT_ACQUISITION_CATEGORIES = new Set<AflOutcomesDevelopmentAcquisitionCategory>([
  'national_draft',
  'rookie_draft',
  'mid_season_draft',
  'pre_season_draft',
  'mini_draft',
]);

function normalizeIdentityText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesRecordedName(canonicalName: string, recordedName: string): boolean {
  const canonical = normalizeIdentityText(canonicalName);
  const recorded = normalizeIdentityText(recordedName);
  return Boolean(canonical && recorded && (canonical === recorded || canonical.endsWith(` ${recorded}`)));
}

function exactInteger(value: string | null): number | null {
  const normalized = value?.trim() ?? '';
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function isRecognizedGrade(value: string | null): value is AflOutcomesDevelopmentGrade {
  return AFL_OUTCOMES_DEVELOPMENT_GRADE_VALUES.some((grade) => grade === value);
}

function matchesReceivingClub(
  asset: DraftTradeAssetItem,
  acquisition: AflOutcomesDevelopmentAcquisitionItem
): boolean {
  return normalizeIdentityText(asset.clubName) === normalizeIdentityText(acquisition.clubName);
}

function matchPlayerAcquisition(
  asset: DraftTradeAssetItem,
  acquisitions: readonly AflOutcomesDevelopmentAcquisitionItem[]
): readonly AflOutcomesDevelopmentAcquisitionItem[] {
  if (!asset.playerName) return [];
  return acquisitions.filter(
    (acquisition) =>
      acquisition.year === asset.year &&
      acquisition.category === 'trade' &&
      matchesReceivingClub(asset, acquisition) &&
      matchesRecordedName(acquisition.playerName, asset.playerName as string)
  );
}

function matchDraftSelection(
  asset: DraftTradeAssetItem,
  acquisitions: readonly AflOutcomesDevelopmentAcquisitionItem[]
): readonly AflOutcomesDevelopmentAcquisitionItem[] {
  if (!asset.draftedPlayer) return [];
  const selectionNumber = asset.pick.numberActual ?? asset.pick.numberGiven;
  if (selectionNumber === null) return [];

  return acquisitions.filter((acquisition) => {
    if (
      acquisition.year !== asset.year ||
      !DRAFT_ACQUISITION_CATEGORIES.has(acquisition.category) ||
      !matchesReceivingClub(asset, acquisition) ||
      !matchesRecordedName(acquisition.playerName, asset.draftedPlayer as string)
    ) {
      return false;
    }
    return (
      acquisition.draftNumber === selectionNumber || exactInteger(acquisition.pick) === selectionNumber
    );
  });
}

function unresolvedAsset(
  asset: DraftTradeAssetItem,
  reasonCode: AflOutcomesDevelopmentTradeGradeReason
): AflOutcomesDevelopmentTradeGradeAsset {
  return {
    assetId: asset.id,
    clubSlug: asset.clubSlug,
    clubName: asset.clubName,
    assetType: asset.assetType,
    assetText: asset.assetText,
    status: 'unresolved',
    matchMethod: null,
    reasonCode,
    outcome: null,
  };
}

function projectMatchedAsset(
  asset: DraftTradeAssetItem,
  acquisition: AflOutcomesDevelopmentAcquisitionItem,
  matchMethod: AflOutcomesDevelopmentTradeGradeMatchMethod
): AflOutcomesDevelopmentTradeGradeAsset {
  const grade = isRecognizedGrade(acquisition.grade) ? acquisition.grade : null;
  const reasonCode = acquisition.grade === null
    ? 'grade_not_recorded'
    : grade === null
      ? 'grade_not_recognized'
      : null;

  return {
    assetId: asset.id,
    clubSlug: asset.clubSlug,
    clubName: asset.clubName,
    assetType: asset.assetType,
    assetText: asset.assetText,
    status: grade === null ? 'matched_without_grade' : 'graded',
    matchMethod,
    reasonCode,
    outcome: {
      eventId: acquisition.eventId,
      acquisitionCategory: acquisition.category,
      acquisitionType: acquisition.acquisitionType,
      playerName: acquisition.playerName,
      grade,
      games: acquisition.games,
      goals: acquisition.goals,
      coachesVotes: acquisition.coachesVotes,
      brownlowVotes: acquisition.brownlowVotes,
      awards: acquisition.awards,
    },
  };
}

function projectAsset(
  asset: DraftTradeAssetItem,
  acquisitions: readonly AflOutcomesDevelopmentAcquisitionItem[]
): AflOutcomesDevelopmentTradeGradeAsset {
  if (asset.assetType === 'future_pick') {
    return unresolvedAsset(asset, 'future_pick_unresolved');
  }
  if (asset.assetType === 'pick' && !asset.draftedPlayer) {
    return unresolvedAsset(asset, 'draft_selection_not_recorded');
  }

  const matchMethod: AflOutcomesDevelopmentTradeGradeMatchMethod =
    asset.assetType === 'player'
      ? 'receiving_club_trade_player'
      : 'receiving_club_draft_selection';
  const candidates = asset.assetType === 'player'
    ? matchPlayerAcquisition(asset, acquisitions)
    : matchDraftSelection(asset, acquisitions);

  if (candidates.length !== 1) {
    return unresolvedAsset(
      asset,
      candidates.length === 0 ? 'no_acquisition_match' : 'ambiguous_acquisition_match'
    );
  }
  return projectMatchedAsset(asset, candidates[0]!, matchMethod);
}

export function projectAflOutcomesDevelopmentWorkbookTradeGrades(
  workbook: AflOutcomesDevelopmentWorkbook,
  trades: AflOutcomesDevelopmentTradeProjection,
  acquisitions: AflOutcomesDevelopmentAcquisitionProjection
): ReadonlyMap<string, AflOutcomesDevelopmentTradeGradeEvidence> {
  const byTradeId = new Map<string, AflOutcomesDevelopmentTradeGradeEvidence>();

  for (const [tradeId, detail] of trades.detailsById) {
    const assets = detail.assets.map((asset) => projectAsset(asset, acquisitions.items));
    const matchedAssets = assets.filter(({ outcome }) => outcome !== null).length;
    const gradedAssets = assets.filter(({ status }) => status === 'graded').length;
    const matchedWithoutGradeAssets = assets.filter(
      ({ status }) => status === 'matched_without_grade'
    ).length;
    const unresolvedAssets = assets.filter(({ status }) => status === 'unresolved').length;

    byTradeId.set(tradeId, {
      schemaVersion: AFL_OUTCOMES_DEVELOPMENT_TRADE_GRADE_SCHEMA_VERSION,
      tradeId,
      status:
        gradedAssets === assets.length
          ? 'complete'
          : gradedAssets > 0
            ? 'partial'
            : 'unavailable',
      source: {
        originalFilename: workbook.report.source.originalFilename,
        sha256: workbook.report.source.sha256,
        observedAt: workbook.report.source.observedAt,
      },
      coverage: {
        totalAssets: assets.length,
        matchedAssets,
        gradedAssets,
        unresolvedAssets,
        matchedWithoutGradeAssets,
      },
      assets,
    });
  }

  return byTradeId;
}
