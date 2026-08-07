import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { assertAflOutcomesDevelopmentWorkbookRuntime } from '@/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER } from '@/server/aflTradeIntelligence/source/draftTradeWorkbookEvaluation';
import {
  AflOutcomesDevelopmentWorkbookError,
  normalizeAflOutcomesDevelopmentWorkbook,
  type AflOutcomesDevelopmentWorkbookCell,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookStructure';

const sourceArtifact = createAflTradeByteArtifactRef(
  new TextEncoder().encode('development workbook fixture'),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '2026-08-07T00:00:00.000Z'
);

function annualRow(
  documentId: string,
  overrides: Partial<
    Record<(typeof AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER)[number], string | number>
  > = {}
): AflOutcomesDevelopmentWorkbookCell[] {
  const values: Record<
    (typeof AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER)[number],
    AflOutcomesDevelopmentWorkbookCell
  > = {
    document_id: documentId,
    year: 2020,
    pick: null,
    draft_type: 'National',
    draft_number: 1,
    club: 'Fixture Club',
    signing: null,
    player: 'Fixture Player',
    age: 18,
    height_cm: 188,
    weight_kg: null,
    original_club: 'Fixture Original Club',
    grade: 'B',
    games: 10,
    goals: 2,
    coaches_votes: 1,
    brownlow_votes: 0,
    awards: null,
    ...overrides,
  };
  return AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER.map((field) => values[field]);
}

const validTradeSheet: AflOutcomesDevelopmentWorkbookCell[][] = [
  ['Full All-Time List of VFL/AFL Trades', null],
  [2020, null],
  ['2020 Trade for Fixture Player', null],
  ['Fixture Club', 'Fixture Player (10 games)'],
  ['Other Club', '#1 (Drafted Player - 0 games)'],
];

function normalize(
  rows: AflOutcomesDevelopmentWorkbookCell[][],
  tradeRows: AflOutcomesDevelopmentWorkbookCell[][] = validTradeSheet
) {
  return normalizeAflOutcomesDevelopmentWorkbook({
    sheets: [
      { sheet: 'Notes', data: [['ignored']] },
      { sheet: 'AFL VFL Trades', data: tradeRows },
      {
        sheet: '2020',
        data: [[...AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER], ...rows],
      },
    ],
    sourceArtifact,
    originalFilename: 'fixture.xlsx',
  });
}

function expectWorkbookError(operation: () => unknown, code: string) {
  try {
    operation();
    throw new Error('Expected the development workbook operation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(AflOutcomesDevelopmentWorkbookError);
    expect(error).toMatchObject({ code });
  }
}

describe('AFL outcomes development workbook boundary', () => {
  it('normalizes typed XLSX cells and reports exceptions without raw-row output', () => {
    const workbook = normalize([
      annualRow('2020_0001'),
      annualRow('2020_0002', {
        pick: 'Priority (Fixture Club)',
        games: '13 (7)',
        awards: 'AA: 2020',
      }),
    ]);

    expect(workbook.annualSheets[0].rows[0].cells).toHaveLength(18);
    expect(workbook.annualSheets[0].rows[0].cells[1]).toBe('2020');
    expect(workbook.report).toMatchObject({
      annualSheetCount: 1,
      ignoredSheetCount: 1,
      totalRows: 2,
      tradeSheet: {
        tradeCount: 1,
        partyCount: 2,
        years: [2020],
      },
      anomalyCounts: {
        compositeGamesRows: 1,
        unresolvedGamesRows: 0,
        blankPickRows: 1,
        labelledPickRows: 1,
        missingWeightRows: 2,
        awardRows: 1,
      },
    });
    expect(JSON.stringify(workbook.report)).not.toContain('Fixture Player');
  });

  it('fails closed on production use and malformed annual structure', () => {
    expectWorkbookError(
      () => assertAflOutcomesDevelopmentWorkbookRuntime('production'),
      'PRODUCTION_DISABLED'
    );
    const duplicated = annualRow('2020_0001');
    expectWorkbookError(() => normalize([duplicated, duplicated]), 'DUPLICATE_DOCUMENT_ID');
    expectWorkbookError(() => normalize([annualRow('2021_0001')]), 'YEAR_MISMATCH');
    expectWorkbookError(
      () => normalize([[...annualRow('2020_0001'), 'unexpected']]),
      'EXTRA_ANNUAL_COLUMNS'
    );
    expectWorkbookError(
      () => normalize([annualRow('2020_0001')], validTradeSheet.slice(0, -1)),
      'INVALID_TRADE_SHEET'
    );
  });
});
