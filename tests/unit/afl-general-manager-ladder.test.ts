import { describe, expect, it } from 'vitest';

import { AFL_GENERAL_MANAGER_TENURES } from '@/components/aflGeneralManagers/generalManagers';
import {
  generalManagerLadder,
  generalManagersAt,
} from '@/components/aflGeneralManagers/generalManagerLadder';
import type { AflGeneralManagerTenure } from '@/components/aflGeneralManagers/generalManagers';
import type { AflTradeStorySampleSummary } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * The general managers ladder: each club's side of each trade goes to the club's head of football in
 * that trade period, at the net the trade pages show.
 */

const trade = (
  tradeId: string,
  year: number,
  clubs: [string, number][],
  projected = false
): AflTradeStorySampleSummary => ({
  tradeId,
  year,
  clubNames: clubs.map(([name]) => name),
  clubIds: clubs.map(([name]) => `club:${name}`),
  results: clubs.map(([clubName, net]) => ({
    clubId: `club:${clubName}`,
    clubName,
    net,
    provisional: false,
    projected,
    received: [],
  })),
});

const tenure = (
  club: string,
  person: string,
  start: string,
  end: string | null,
  confirmed = true
): AflGeneralManagerTenure => ({
  club,
  person,
  title: 'GM Football',
  start,
  end,
  confirmed,
  sources: [],
});

describe('generalManagersAt', () => {
  const tenures = [
    tenure('Geelong', 'Outgoing', '2015-01', '2024-10'),
    tenure('Geelong', 'Incoming', '2024-10', null),
    tenure('Carlton', 'Joint A', '2020-01', null),
    tenure('Carlton', 'Joint B', '2022-01', null),
    tenure('Essendon', 'Before', '2015-01', '2020-10'),
    tenure('Essendon', 'After', '2020-12', null),
  ];

  it('keeps the outgoing holder when one leaves and one starts in the trade month', () => {
    expect(generalManagersAt(tenures, 'Geelong', 2024).map(({ person }) => person)).toEqual([
      'Outgoing',
    ]);
    expect(generalManagersAt(tenures, 'Geelong', 2025).map(({ person }) => person)).toEqual([
      'Incoming',
    ]);
  });

  it('returns both people when two hold the role at once', () => {
    expect(generalManagersAt(tenures, 'Carlton', 2023).map(({ person }) => person)).toEqual([
      'Joint A',
      'Joint B',
    ]);
  });

  it('reads 2020 at November, when that trade period ran, and finds nobody in a vacancy', () => {
    expect(generalManagersAt(tenures, 'Essendon', 2020)).toEqual([]);
    expect(
      generalManagersAt([tenure('Essendon', 'Late', '2020-11', null)], 'Essendon', 2020)
    ).toHaveLength(1);
    expect(
      generalManagersAt([tenure('Essendon', 'Late', '2019-11', null)], 'Essendon', 2019)
    ).toEqual([]);
  });
});

describe('generalManagerLadder', () => {
  const tenures = [
    tenure('Geelong', 'Gee', '2018-01', null),
    tenure('GWS', 'Giant', '2018-01', null, false),
    tenure('Carlton', 'Joint A', '2018-01', null),
    tenure('Carlton', 'Joint B', '2018-01', null),
  ];

  it('sums each club side at its net, splits a shared role, leaves projections out, and ranks by total', () => {
    const ladder = generalManagerLadder(
      [
        trade('t1', 2023, [
          ['Geelong', 40],
          ['GWS', -40],
        ]),
        trade('t2', 2024, [
          ['Geelong', -10],
          ['Carlton', 10],
        ]),
        trade(
          't3',
          2025,
          [
            ['GWS', 6],
            ['Carlton', -6],
          ],
          true
        ),
      ],
      tenures
    );
    expect(ladder.rows).toEqual([
      expect.objectContaining({
        person: 'Gee',
        club: 'Geelong',
        deals: 2,
        net: 30,
        perDeal: 15,
        firstYear: 2023,
        lastYear: 2024,
      }),
      expect.objectContaining({ person: 'Joint A', club: 'Carlton', deals: 1, net: 5, perDeal: 5 }),
      expect.objectContaining({ person: 'Joint B', club: 'Carlton', deals: 1, net: 5 }),
      expect.objectContaining({
        person: 'Giant',
        club: 'GWS',
        deals: 1,
        net: -40,
        unconfirmed: true,
      }),
    ]);
    expect(ladder.rows.reduce((sum, row) => sum + row.net, 0)).toBeCloseTo(0, 9);
    expect(ladder.uncredited).toBe(0);
    expect(ladder.projected).toBe(2);
  });

  it('counts sides with nobody in the role apart, and skips stories without results', () => {
    const ladder = generalManagerLadder(
      [
        trade('t1', 2023, [
          ['Geelong', 5],
          ['Richmond', -5],
        ]),
        { tradeId: 't2', year: 2023, clubNames: [], clubIds: [] },
      ],
      tenures
    );
    expect(ladder.rows.map(({ person }) => person)).toEqual(['Gee']);
    expect(ladder.uncredited).toBe(1);
  });
});

describe('AFL_GENERAL_MANAGER_TENURES', () => {
  it('uses whole months, ends after it starts, and cites a source for every row', () => {
    for (const row of AFL_GENERAL_MANAGER_TENURES) {
      expect(row.start).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/u);
      if (row.end !== null) {
        expect(row.end).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/u);
        expect(row.end >= row.start).toBe(true);
      }
      expect(row.sources.length).toBeGreaterThan(0);
    }
  });

  it('names one person in the role for every club in every trade period, except Essendon 2020 and Port Adelaide 2025', () => {
    const clubs = [...new Set(AFL_GENERAL_MANAGER_TENURES.map(({ club }) => club))];
    expect(clubs).toHaveLength(18);
    const gaps: string[] = [];
    for (const club of clubs)
      for (let year = 2019; year <= 2026; year++)
        if (generalManagersAt(AFL_GENERAL_MANAGER_TENURES, club, year).length === 0)
          gaps.push(`${club} ${year}`);
    expect(gaps).toEqual(['Essendon 2020', 'Port Adelaide 2025']);
  });
});
