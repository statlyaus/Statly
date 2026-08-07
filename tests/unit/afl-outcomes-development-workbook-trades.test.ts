import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER } from '@/server/aflTradeIntelligence/source/draftTradeWorkbookEvaluation';
import { normalizeAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookStructure';
import { projectAflOutcomesDevelopmentWorkbookTrades } from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';

const sourceArtifact = createAflTradeByteArtifactRef(
  new TextEncoder().encode('trade projection fixture'),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '2026-08-07T00:00:00.000Z'
);

function fixtureWorkbook() {
  return normalizeAflOutcomesDevelopmentWorkbook({
    sourceArtifact,
    originalFilename: 'fixture.xlsx',
    sheets: [
      {
        sheet: 'AFL VFL Trades',
        data: [
          ['Full\u00a0All-Time\u00a0List\u00a0of\u00a0VFL/AFL\u00a0Trades', null],
          [2020, null],
          ['2020 Trade for Glenn Hawker', null],
          ['Carlton', 'Hawker (27 games)'],
          ['Essendon', '#12 (Fox - 21 games) + #2021R2 (Carlton) (-)'],
          [2021, null],
          ['2021 Carlton and GWS Trade for Draft Picks', null],
          ['Carlton', '#18 (#20 - Drafted Player - 3 games)'],
          ['GWS', '#2022R3 (Carlton) (-)'],
        ],
      },
      {
        sheet: '2020',
        data: [
          [...AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER],
          [
            '2020_0001',
            2020,
            null,
            'Trade',
            null,
            'Carlton',
            null,
            'Glenn Hawker',
            27,
            180,
            null,
            'Original Club',
            'B',
            27,
            0,
            0,
            0,
            null,
          ],
        ],
      },
    ],
  });
}

describe('AFL outcomes development workbook trade projection', () => {
  it('projects stable list, detail, asset, club, and year read models', () => {
    const projection = projectAflOutcomesDevelopmentWorkbookTrades(fixtureWorkbook());

    expect(projection.years).toEqual([2021, 2020]);
    expect(projection.tradesByYear.get(2020)).toHaveLength(1);
    expect(projection.tradesByYear.get(2021)?.[0]).toMatchObject({
      clubSlugs: ['carlton', 'gws'],
      hasPlayers: false,
      hasPicks: true,
      hasFuturePicks: true,
      partyCount: 2,
      assetCount: 2,
    });

    const trade = projection.tradesByYear.get(2020)?.[0];
    expect(trade?.tradeId).toMatch(/^workbook-2020-[a-f0-9]{16}$/);
    const detail = trade ? projection.detailsById.get(trade.tradeId) : null;
    expect(detail?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetType: 'player',
          playerName: 'Hawker',
          games: 27,
        }),
        expect.objectContaining({
          assetType: 'pick',
          draftedPlayer: 'Fox',
          games: 21,
          pick: expect.objectContaining({ numberGiven: 12 }),
        }),
        expect.objectContaining({
          assetType: 'future_pick',
          games: null,
          pick: expect.objectContaining({ year: 2021, round: 2, originalClub: 'Carlton' }),
        }),
      ])
    );
    expect(projection.clubs.find(({ clubSlug }) => clubSlug === 'carlton')).toMatchObject({
      tradeCount: 2,
      firstYear: 2020,
      lastYear: 2021,
    });
    expect(projection.refsByClub.get('carlton')?.map(({ year }) => year)).toEqual([2021, 2020]);
  });

  it('rejects duplicate content-derived trade identities', () => {
    const workbook = fixtureWorkbook();
    const firstTradeRows = workbook.tradeSheet.rows.slice(6, 9);
    const duplicate = {
      ...workbook,
      tradeSheet: {
        ...workbook.tradeSheet,
        rows: [...workbook.tradeSheet.rows, ...firstTradeRows],
        tradeCount: workbook.tradeSheet.tradeCount + 1,
        partyCount: workbook.tradeSheet.partyCount + 2,
      },
    };
    expect(() => projectAflOutcomesDevelopmentWorkbookTrades(duplicate)).toThrow(
      /duplicate stable id/i
    );
  });
});
