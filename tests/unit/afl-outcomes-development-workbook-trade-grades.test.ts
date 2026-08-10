import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { projectAflOutcomesDevelopmentWorkbookAcquisitions } from '@/server/aflTradeIntelligence/source/developmentWorkbookAcquisitionProjection';
import { normalizeAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookStructure';
import { projectAflOutcomesDevelopmentWorkbookTradeGrades } from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeOutcomeProjection';
import { projectAflOutcomesDevelopmentWorkbookTrades } from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';
import { AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER } from '@/server/aflTradeIntelligence/source/draftTradeWorkbookEvaluation';

const sourceArtifact = createAflTradeByteArtifactRef(
  new TextEncoder().encode('trade grade fixture'),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '2026-08-07T00:00:00.000Z'
);

function annualRow(input: {
  documentId: string;
  draftType: string;
  draftNumber?: number | null;
  club: string;
  player: string;
  grade: string | null;
  games: string | number;
  goals?: string | number;
}) {
  return [
    input.documentId,
    2024,
    null,
    input.draftType,
    input.draftNumber ?? null,
    input.club,
    null,
    input.player,
    24,
    188,
    86,
    'Original Club',
    input.grade,
    input.games,
    input.goals ?? 0,
    0,
    0,
    null,
  ];
}

function fixtureWorkbook() {
  return normalizeAflOutcomesDevelopmentWorkbook({
    sourceArtifact,
    originalFilename: 'fixture.xlsx',
    sheets: [
      {
        sheet: 'AFL VFL Trades',
        data: [
          ['Full All-Time List of VFL/AFL Trades', null],
          [2024, null],
          ['2024 Trade for Glenn Hawker', null],
          ['Carlton', 'Hawker (27 games) + #2025R2 (Essendon) (-)'],
          ['Essendon', '#10 (#12 - Fox - 21 games)'],
          ['2024 GWS and Sydney Trade for Draft Picks', null],
          ['GWS', '#20 (Smith - 1 games)'],
          ['Sydney', '#30 (-)'],
        ],
      },
      {
        sheet: '2024',
        data: [
          [...AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER],
          annualRow({
            documentId: '2024_0001',
            draftType: 'Trade',
            club: 'Carlton',
            player: 'Glenn Hawker',
            grade: 'B',
            games: 27,
            goals: 4,
          }),
          annualRow({
            documentId: '2024_0002',
            draftType: 'National',
            draftNumber: 12,
            club: 'Essendon',
            player: 'Jamie Fox',
            grade: 'A',
            games: 21,
          }),
          annualRow({
            documentId: '2024_0003',
            draftType: 'National',
            draftNumber: 20,
            club: 'GWS',
            player: 'Jordan Smith',
            grade: 'C+',
            games: 1,
          }),
          annualRow({
            documentId: '2024_0004',
            draftType: 'Rookie',
            draftNumber: 20,
            club: 'GWS',
            player: 'Taylor Smith',
            grade: null,
            games: 0,
          }),
        ],
      },
    ],
  });
}

describe('development workbook trade outcome grades', () => {
  it('links unique receiving-club acquisitions and keeps unresolved lineage explicit', () => {
    const workbook = fixtureWorkbook();
    const trades = projectAflOutcomesDevelopmentWorkbookTrades(workbook);
    const acquisitions = projectAflOutcomesDevelopmentWorkbookAcquisitions(workbook);
    const grades = projectAflOutcomesDevelopmentWorkbookTradeGrades(
      workbook,
      trades,
      acquisitions
    );
    const trade = trades.tradesByYear.get(2024)?.[0];
    const evidence = trade ? grades.get(trade.tradeId) : null;

    expect(evidence).toMatchObject({
      status: 'partial',
      source: { originalFilename: 'fixture.xlsx' },
      coverage: {
        totalAssets: 3,
        matchedAssets: 2,
        gradedAssets: 2,
        unresolvedAssets: 1,
        matchedWithoutGradeAssets: 0,
      },
    });
    expect(evidence?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetType: 'player',
          status: 'graded',
          matchMethod: 'receiving_club_trade_player',
          outcome: expect.objectContaining({ playerName: 'Glenn Hawker', grade: 'B', games: '27' }),
        }),
        expect.objectContaining({
          assetType: 'pick',
          status: 'graded',
          matchMethod: 'receiving_club_draft_selection',
          outcome: expect.objectContaining({ playerName: 'Jamie Fox', grade: 'A' }),
        }),
        expect.objectContaining({
          assetType: 'future_pick',
          status: 'unresolved',
          reasonCode: 'future_pick_unresolved',
        }),
      ])
    );
  });

  it('does not auto-select an ambiguous same-club acquisition or invent a pick grade', () => {
    const workbook = fixtureWorkbook();
    const trades = projectAflOutcomesDevelopmentWorkbookTrades(workbook);
    const acquisitions = projectAflOutcomesDevelopmentWorkbookAcquisitions(workbook);
    const grades = projectAflOutcomesDevelopmentWorkbookTradeGrades(
      workbook,
      trades,
      acquisitions
    );
    const trade = trades.tradesByYear.get(2024)?.[1];
    const evidence = trade ? grades.get(trade.tradeId) : null;

    expect(evidence).toMatchObject({
      status: 'unavailable',
      coverage: { totalAssets: 2, gradedAssets: 0, unresolvedAssets: 2 },
    });
    expect(evidence?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonCode: 'ambiguous_acquisition_match' }),
        expect.objectContaining({ reasonCode: 'draft_selection_not_recorded' }),
      ])
    );
  });
});
