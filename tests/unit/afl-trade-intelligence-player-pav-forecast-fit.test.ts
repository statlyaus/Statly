import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  fitPlayerPavForecast,
  restorePlayerPavForecast,
} from '@/server/aflTradeIntelligence/modeling/playerPavForecastFit';
import type { PlayerPavResearchRow } from '@/server/aflTradeIntelligence/modeling/playerPavForecastDesign';

function row(pav: number, target: number[]): PlayerPavResearchRow {
  return {
    observationId: `row:${pav}`,
    playerId: `player:${pav}`,
    partition: 'train',
    predictionSeason: 2000,
    cutoff: 0,
    labelAvailableAt: 1,
    history: [{ pav, games: 10 }],
    target,
    outcomeUnavailable: null,
    forecastUnavailable: null,
  };
}

describe('serializable PAV forecast fit', () => {
  it('restores a persistence forecast and its learned missing-history fallback without training rows', () => {
    const fitted = fitPlayerPavForecast([row(1, [2, 4, 6]), row(3, [6, 8, 10])], {
      kind: 'persistence',
      historySeasons: 1,
    });
    const restored = restorePlayerPavForecast(JSON.parse(JSON.stringify(fitted.state)));
    expect(restored.predict(row(9, []))).toEqual([9, 9, 9]);
    expect(restored.predict({ ...row(9, []), history: [null] })).toEqual([4, 4, 4]);
    expect(restored.state).toEqual(fitted.state);
  });

  it('restores shrinkage with the retained annual pooled means', () => {
    const fitted = fitPlayerPavForecast([row(1, [2, 4, 6]), row(3, [6, 8, 10])], {
      kind: 'shrinkage',
      historySeasons: 1,
      pseudoSeasons: 2,
    });
    const restored = restorePlayerPavForecast(JSON.parse(JSON.stringify(fitted.state)));
    expect(restored.predict(row(9, []))).toEqual([17 / 3, 7, 25 / 3]);
    expect(restored.predict({ ...row(9, []), history: [null] })).toEqual([4, 6, 8]);
    expect(restored.predict(row(9, []))).toEqual(fitted.predict(row(9, [])));
  });

  it('restores the ridge coefficients, scaling and imputation without refitting', () => {
    const fitted = fitPlayerPavForecast([row(1, [2, 4, 6]), row(3, [6, 8, 10])], {
      kind: 'ridge',
      historySeasons: 1,
      penalty: 2,
    });
    const restored = restorePlayerPavForecast(JSON.parse(JSON.stringify(fitted.state)));
    expect(restored.state.content).toMatchObject({
      imputationMeans: [{ pav: 2, games: 10 }],
      centers: [2, 10, 0],
      scales: [1, 1, 1],
      coefficients: [
        [1, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
      ],
      targetMeans: [4, 6, 8],
    });
    expect(restored.predict(row(5, []))).toEqual([7, 9, 11]);
    expect(restored.predict({ ...row(5, []), history: [null] })).toEqual([4, 6, 8]);
    expect(restored.predict(row(5, []))).toEqual(fitted.predict(row(5, [])));
    const detached = restored.state;
    if (detached.content.kind !== 'ridge') throw new Error('Expected ridge state.');
    detached.content.targetMeans[0] = 999;
    expect(restored.predict(row(5, []))).toEqual([7, 9, 11]);
    expect(() => restorePlayerPavForecast(detached)).toThrow();
  });

  it.each([
    [
      'wrong learned width',
      (content: Record<string, unknown>) => {
        content.centers = [1, 2, 3, 4];
      },
    ],
    [
      'nonfinite coefficient',
      (content: Record<string, unknown>) => {
        content.coefficients = [
          [Infinity, 0, 0],
          [1, 0, 0],
          [1, 0, 0],
        ];
      },
    ],
    [
      'zero scale',
      (content: Record<string, unknown>) => {
        content.scales = [0, 1, 1];
      },
    ],
    [
      'wrong history dimension',
      (content: Record<string, unknown>) => {
        content.historySeasons = 2;
      },
    ],
    [
      'unknown version',
      (content: Record<string, unknown>) => {
        content.schemaVersion = 'player-pav-forecast-fit/v2';
      },
    ],
    [
      'undeclared fields',
      (content: Record<string, unknown>) => {
        content.approved = true;
      },
    ],
  ] as const)('rejects %s even with a newly calculated content address', (_label, change) => {
    const state = fitPlayerPavForecast([row(1, [2, 4, 6]), row(3, [6, 8, 10])], {
      kind: 'ridge',
      historySeasons: 1,
      penalty: 2,
    }).state;
    change(state.content);
    expect(() =>
      restorePlayerPavForecast({
        ...state,
        fitId: createAflTradeContentAddress('player-pav-forecast-fit', state.content),
      })
    ).toThrow();
  });

  it('rejects unavailable targets and invalid histories at the numerical seam', () => {
    const candidate = { kind: 'persistence' as const, historySeasons: 1 as const };
    expect(() => fitPlayerPavForecast([], candidate)).toThrow();
    expect(() => fitPlayerPavForecast([{ ...row(1, []), target: null }], candidate)).toThrow();
    expect(() => fitPlayerPavForecast([row(1, [1, 2, 3, 4])], candidate)).toThrow();
    const fitted = fitPlayerPavForecast([row(1, [1, 2, 3])], candidate);
    expect(() => fitted.predict({ ...row(1, []), history: [] })).toThrow();
    expect(() => fitted.predict(row(Infinity, []))).toThrow();
  });
});
