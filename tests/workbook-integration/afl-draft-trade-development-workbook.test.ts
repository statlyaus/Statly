import { beforeAll, describe, expect, it } from 'vitest';

import { evaluateAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookEvaluation';
import { loadAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import type { AflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookStructure';

const workbookPath = process.env.AFL_OUTCOMES_DEV_WORKBOOK_PATH;
const expectedSha256 = process.env.AFL_OUTCOMES_DEV_WORKBOOK_SHA256;
if (!workbookPath || !expectedSha256) {
  throw new Error(
    'AFL_OUTCOMES_DEV_WORKBOOK_PATH and AFL_OUTCOMES_DEV_WORKBOOK_SHA256 are required for the opt-in workbook integration suite.'
  );
}

let workbook: AflOutcomesDevelopmentWorkbook;

beforeAll(async () => {
  workbook = await loadAflOutcomesDevelopmentWorkbook({
    workbookPath,
    expectedSha256,
    runtimeEnvironment: 'development',
  });
});

describe('AFL Draft and Trade development workbook', () => {
  it('loads the exact pinned external workbook into consistent annual staging rows', () => {
    expect(workbook.sourceArtifact.contentSha256).toBe(expectedSha256.toLowerCase());
    expect(workbook.report.annualSheetCount).toBeGreaterThan(0);
    expect(workbook.report.totalRows).toBeGreaterThan(0);
    expect(workbook.report.annualSheets).toEqual(
      [...workbook.report.annualSheets].sort((left, right) => left.year - right.year)
    );
    expect(
      workbook.report.annualSheets.reduce((total, sheet) => total + sheet.rowCount, 0)
    ).toBe(workbook.report.totalRows);
    expect(new Set(workbook.report.annualSheets.map(({ year }) => year)).size).toBe(
      workbook.report.annualSheetCount
    );
  });

  it('rejects workbook bytes that do not match the pinned digest', async () => {
    await expect(
      loadAflOutcomesDevelopmentWorkbook({
        workbookPath,
        expectedSha256: '0'.repeat(64),
        runtimeEnvironment: 'development',
      })
    ).rejects.toMatchObject({
      code: 'DIGEST_MISMATCH',
    });
  });

  it('exercises known normalization exceptions without granting publication authority', () => {
    const evaluation = evaluateAflOutcomesDevelopmentWorkbook(workbook);
    expect(workbook.report.anomalyCounts.compositeGamesRows).toBeGreaterThan(0);
    expect(workbook.report.anomalyCounts.labelledPickRows).toBeGreaterThan(0);
    expect(workbook.report.anomalyCounts.missingWeightRows).toBeGreaterThan(0);
    expect(workbook.report.anomalyCounts.awardRows).toBeGreaterThan(0);
    expect(evaluation.totalRecords).toBe(workbook.report.totalRows);
    expect(evaluation.blockedRightsRecords).toBe(evaluation.totalRecords);
    expect(evaluation.publicationEligibleRecords).toBe(0);
    expect(evaluation.metricAvailability.games.partial).toBe(
      workbook.report.anomalyCounts.compositeGamesRows +
        workbook.report.anomalyCounts.unresolvedGamesRows
    );
    expect(evaluation.unresolvedAchievementCount).toBe(evaluation.achievementCount);
    for (const availability of Object.values(evaluation.metricAvailability)) {
      expect(availability.exact + availability.partial + availability.unavailable).toBe(
        evaluation.totalRecords
      );
    }
  });
});
