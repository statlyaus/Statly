import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORIES,
  projectAflOutcomesDevelopmentWorkbookAcquisitions,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookAcquisitionProjection';
import { AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER } from '@/server/aflTradeIntelligence/source/draftTradeWorkbookEvaluation';
import { normalizeAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookStructure';

const workbookTypes = [
  'National',
  'Rookie',
  'Mid-Season',
  'Pre-Season',
  'Mini-Draft',
  'Trade',
  'Free Agency',
  'Pre-Draft',
  'Post-Draft',
  'Training Squad Selection',
] as const;

function fixtureWorkbook(acquisitionTypes: readonly string[] = workbookTypes) {
  return normalizeAflOutcomesDevelopmentWorkbook({
    sourceArtifact: createAflTradeByteArtifactRef(
      new TextEncoder().encode('acquisition projection fixture'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '2026-08-07T00:00:00.000Z'
    ),
    originalFilename: 'fixture.xlsx',
    sheets: [
      {
        sheet: 'AFL VFL Trades',
        data: [
          ['Full All-Time List of VFL/AFL Trades', null],
          [2025, null],
          ['2025 Trade for Fixture Player', null],
          ['Carlton', 'Fixture Player (1 game)'],
          ['Essendon', '#1 (Drafted Player - 0 games)'],
        ],
      },
      {
        sheet: '2025',
        data: [
          [...AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER],
          ...acquisitionTypes.map((acquisitionType, index) => [
            `2025_${String(index + 1).padStart(4, '0')}`,
            2025,
            index + 1,
            acquisitionType,
            index + 1,
            index % 2 === 0 ? 'Carlton' : 'Essendon',
            acquisitionType === 'Free Agency' ? 'FA (Unrestricted)' : null,
            `Fixture Player ${index + 1}`,
            20,
            188,
            85,
            'Original Club',
            'B',
            index === 0 ? '12 (4)' : 12,
            3,
            2,
            1,
            null,
          ]),
        ],
      },
    ],
  });
}

describe('AFL outcomes development workbook acquisition projection', () => {
  it('retains every supported acquisition mechanism without grouping drift', () => {
    const projection = projectAflOutcomesDevelopmentWorkbookAcquisitions(fixtureWorkbook());

    expect(projection.items).toHaveLength(10);
    expect(Object.keys(projection.categoryCounts)).toEqual([
      ...AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORIES,
    ]);
    expect(Object.values(projection.categoryCounts)).toEqual(Array(10).fill(1));
    expect(projection.items.find(({ category }) => category === 'mid_season_draft')).toMatchObject({
      acquisitionType: 'Mid-Season',
      playerName: 'Fixture Player 3',
    });
    expect(projection.items.find(({ category }) => category === 'free_agency')).toMatchObject({
      acquisitionType: 'Free Agency',
      signing: 'FA (Unrestricted)',
    });
    expect(projection.items[0]).toMatchObject({
      games: '12 (4)',
      goals: '3',
    });
  });

  it('fails closed when the workbook introduces an ungoverned acquisition type', () => {
    expect(() =>
      projectAflOutcomesDevelopmentWorkbookAcquisitions(
        fixtureWorkbook(['National', 'Supplemental Mystery Draft'])
      )
    ).toThrow(/unsupported acquisition type/i);
  });
});
