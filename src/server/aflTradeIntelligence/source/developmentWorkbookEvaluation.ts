import { AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES } from '../modeling/draftTradeOutcomeContracts';
import { evaluateAflDraftTradeAnnualWorkbookRows } from './draftTradeWorkbookEvaluation';
import type { AflOutcomesDevelopmentWorkbook } from './developmentWorkbookStructure';

export const AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_ADAPTER_VERSION =
  'development-workbook-v1' as const;

export interface AflOutcomesDevelopmentWorkbookEvaluationReport {
  schemaVersion: 'afl-outcomes-development-workbook-evaluation/v1';
  sourceSha256: string;
  totalRecords: number;
  publicationEligibleRecords: number;
  blockedRightsRecords: number;
  metricAvailability: Readonly<
    Record<
      (typeof AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES)[number],
      Readonly<{ exact: number; partial: number; unavailable: number }>
    >
  >;
  achievementCount: number;
  unresolvedAchievementCount: number;
}

export function evaluateAflOutcomesDevelopmentWorkbook(
  workbook: AflOutcomesDevelopmentWorkbook
): AflOutcomesDevelopmentWorkbookEvaluationReport {
  const metricAvailability = Object.fromEntries(
    AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES.map((metricCode) => [
      metricCode,
      { exact: 0, partial: 0, unavailable: 0 },
    ])
  ) as Record<
    (typeof AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES)[number],
    { exact: number; partial: number; unavailable: number }
  >;
  let totalRecords = 0;
  let publicationEligibleRecords = 0;
  let achievementCount = 0;
  let unresolvedAchievementCount = 0;

  for (const annualSheet of workbook.annualSheets) {
    const scope = {
      competition: 'AFL' as const,
      basis: 'after_event' as const,
      clubScope: 'all_subsequent_afl_clubs' as const,
      season: null,
      effectiveFrom: `${annualSheet.sheet}-01-01T00:00:00.000Z`,
      effectiveThrough: workbook.sourceArtifact.createdAt,
    };
    const evaluations = evaluateAflDraftTradeAnnualWorkbookRows({
      header: annualSheet.header,
      source: {
        sheet: annualSheet.sheet,
        sourceArtifact: workbook.sourceArtifact,
        evidenceItemId: `evidence-item:${workbook.sourceArtifact.contentSha256}`,
        rightsReceiptId: `gate0a-evaluation:${workbook.sourceArtifact.contentSha256}`,
        rightsDisposition: 'blocked',
        adapterVersion: AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_ADAPTER_VERSION,
      },
      rows: annualSheet.rows.map((row) => ({
        rowNumber: row.rowNumber,
        cells: row.cells,
        scope,
      })),
    });

    for (const evaluation of evaluations) {
      totalRecords += 1;
      if (evaluation.publicationEligible) publicationEligibleRecords += 1;
      for (const metricCode of AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES) {
        metricAvailability[metricCode][evaluation.metrics[metricCode].recorded.availability] += 1;
      }
      achievementCount += evaluation.achievements.length;
      unresolvedAchievementCount += evaluation.achievements.filter(
        (achievement) => achievement.state === 'unresolved'
      ).length;
    }
  }

  return {
    schemaVersion: 'afl-outcomes-development-workbook-evaluation/v1',
    sourceSha256: workbook.sourceArtifact.contentSha256,
    totalRecords,
    publicationEligibleRecords,
    blockedRightsRecords: totalRecords,
    metricAvailability,
    achievementCount,
    unresolvedAchievementCount,
  };
}
