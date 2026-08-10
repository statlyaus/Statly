import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { evaluateAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookEvaluation';
import { projectAflOutcomesDevelopmentWorkbookAcquisitions } from '@/server/aflTradeIntelligence/source/developmentWorkbookAcquisitionProjection';
import { loadAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import type { AflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookStructure';
import { projectAflOutcomesDevelopmentWorkbookTradeGrades } from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeOutcomeProjection';
import { projectAflOutcomesDevelopmentWorkbookTrades } from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';
import { parseAflTradeWorkbookForStaging } from '@/server/aflTradeIntelligence/source/workbookStagingParser';
import type { AflTradeWorkbookStagingPackage } from '@/server/aflTradeIntelligence/source/workbookImportContracts';

const workbookPath = process.env.AFL_OUTCOMES_DEV_WORKBOOK_PATH;
const expectedSha256 = process.env.AFL_OUTCOMES_DEV_WORKBOOK_SHA256;
if (!workbookPath || !expectedSha256) {
  throw new Error(
    'AFL_OUTCOMES_DEV_WORKBOOK_PATH and AFL_OUTCOMES_DEV_WORKBOOK_SHA256 are required for the opt-in workbook integration suite.'
  );
}

let workbook: AflOutcomesDevelopmentWorkbook;
let staging: AflTradeWorkbookStagingPackage;

beforeAll(async () => {
  workbook = await loadAflOutcomesDevelopmentWorkbook({
    workbookPath,
    expectedSha256,
    runtimeEnvironment: 'development',
  });
  staging = await parseAflTradeWorkbookForStaging({
    bytes: await readFile(workbookPath),
    sourceArtifact: workbook.sourceArtifact,
    originalFilename: workbook.report.source.originalFilename,
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
    expect(workbook.report.annualSheets.reduce((total, sheet) => total + sheet.rowCount, 0)).toBe(
      workbook.report.totalRows
    );
    expect(new Set(workbook.report.annualSheets.map(({ year }) => year)).size).toBe(
      workbook.report.annualSheetCount
    );
  });

  it('projects the dedicated transaction sheet into the complete development archive', () => {
    const projection = projectAflOutcomesDevelopmentWorkbookTrades(workbook);
    expect(workbook.report.tradeSheet).toEqual({
      tradeCount: 975,
      partyCount: 1987,
      years: Array.from({ length: 38 }, (_, index) => 1988 + index),
    });
    expect(projection.years).toEqual(Array.from({ length: 38 }, (_, index) => 2025 - index));
    expect(projection.detailsById.size).toBe(975);
    expect(projection.clubs.map(({ clubName }) => clubName)).toEqual(
      expect.arrayContaining(['Carlton', 'Fitzroy', 'GWS', 'Western Bulldogs'])
    );
    expect(projection.tradesByYear.get(2025)).not.toHaveLength(0);
    expect(
      Array.from(projection.detailsById.values()).some(({ assets }) =>
        assets.some(({ assetType }) => assetType === 'future_pick')
      )
    ).toBe(true);
  });

  it('reconciles every annual row to its exact acquisition mechanism', () => {
    const projection = projectAflOutcomesDevelopmentWorkbookAcquisitions(workbook);
    expect(projection.items).toHaveLength(4139);
    expect(projection.categoryCounts).toEqual({
      national_draft: 1813,
      rookie_draft: 1019,
      mid_season_draft: 102,
      pre_season_draft: 103,
      mini_draft: 4,
      trade: 642,
      free_agency: 138,
      pre_draft: 129,
      post_draft: 188,
      training_squad_selection: 1,
    });
    expect(
      Object.values(projection.categoryCounts).reduce((total, count) => total + count, 0)
    ).toBe(workbook.report.totalRows);
  });

  it('links only uniquely supported acquisition grades to trade assets', () => {
    const trades = projectAflOutcomesDevelopmentWorkbookTrades(workbook);
    const acquisitions = projectAflOutcomesDevelopmentWorkbookAcquisitions(workbook);
    const tradeGrades = projectAflOutcomesDevelopmentWorkbookTradeGrades(
      workbook,
      trades,
      acquisitions
    );
    const evidence = Array.from(tradeGrades.values());

    expect(tradeGrades.size).toBe(975);
    expect(evidence.reduce((total, trade) => total + trade.coverage.gradedAssets, 0)).toBe(1344);
    expect(evidence.reduce((total, trade) => total + trade.coverage.matchedAssets, 0)).toBe(1344);
    expect(
      evidence.reduce((total, trade) => total + trade.coverage.matchedWithoutGradeAssets, 0)
    ).toBe(0);
    expect(evidence.some(({ status }) => status === 'partial')).toBe(true);
    expect(evidence.some(({ status }) => status === 'unavailable')).toBe(true);
    expect(
      evidence.flatMap(({ assets }) => assets).filter(({ status }) => status === 'graded')
    ).toHaveLength(1344);
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

  it('builds the exact immutable year-partitioned staging package', () => {
    expect(staging.sourceArtifact).toEqual(workbook.sourceArtifact);
    expect(staging.publicationEligible).toBe(false);
    expect(staging.partitions).toHaveLength(64);
    expect(staging.counts).toEqual({
      sheets: 29,
      physicalRows: 7250,
      physicalCells: 71674,
      hyperlinks: 1055,
      annualSheets: 26,
      annualAcquisitions: 4139,
      tradeTransactions: 975,
      tradeParties: 1987,
      supplementaryRows: 84,
      quarantinedRows: 0,
      blockingIssues: 0,
      reviewIssues: 9901,
      acquisitionMechanisms: {
        national_draft: 1813,
        rookie_draft: 1019,
        midseason_draft: 102,
        preseason_draft: 103,
        mini_draft: 4,
        trade: 642,
        free_agency: 138,
        pre_draft: 129,
        post_draft: 188,
        training_squad: 1,
      },
    });
    const tradePartitions = staging.partitions.filter(
      ({ importKind }) => importKind === 'workbook_trade_ledger'
    );
    expect(tradePartitions).toHaveLength(38);
    expect(tradePartitions.every(({ rows }) => rows[0]?.recordKind === 'trade_ledger_title')).toBe(
      true
    );
    expect(staging.rawAuthority).toBe('immutable_xlsx_artifact');
    expect(staging.interpretedCellSemantics).toBe('cooked_observable_values');
    expect(staging.rawEvidence.sheets.map(({ sheet }) => sheet)).toEqual(
      staging.sheetInventory.map(({ sheet }) => sheet)
    );
    expect(
      staging.rawEvidence.sheets
        .flatMap(({ hyperlinks }) => hyperlinks)
        .some(({ target }) => target?.includes('draftguru.com.au'))
    ).toBe(true);

    const partyCountsByTransaction = new Map<string, number>();
    for (const row of staging.rows) {
      if (row.recordKind !== 'trade_party' || row.sourceGroupId === null) continue;
      partyCountsByTransaction.set(
        row.sourceGroupId,
        (partyCountsByTransaction.get(row.sourceGroupId) ?? 0) + 1
      );
    }
    expect([...partyCountsByTransaction.values()].filter((count) => count === 2)).toHaveLength(944);
    expect([...partyCountsByTransaction.values()].filter((count) => count === 3)).toHaveLength(25);
    expect([...partyCountsByTransaction.values()].filter((count) => count === 4)).toHaveLength(6);
  });
});
