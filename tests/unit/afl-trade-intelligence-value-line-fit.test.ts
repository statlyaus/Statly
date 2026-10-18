import { describe, expect, it } from 'vitest';

import {
  buildAflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGames,
  type AflTradePlayerSeasonGamesRows,
} from '@/server/aflTradeIntelligence/modeling/playerSeasonGames';
import { buildAflTradeValueLineDraftees } from '@/server/aflTradeIntelligence/modeling/postgresValueLineDraftees';
import {
  aflTradeValueLinePickCurve,
  backtestAflTradeValueLine,
} from '@/server/aflTradeIntelligence/modeling/valueLineBacktest';
import {
  aflTradeValueLineBand,
  aflTradeValueLinePickValue,
  aflTradeValueLinePoint,
  aflTradeValueLineStint,
  fitAflTradeValueLine,
  indexAflTradeValueLineRows,
  type AflTradeValueLineDraftee,
} from '@/server/aflTradeIntelligence/modeling/valueLineFit';

const methodId = `hpn-pav-method:${'b'.repeat(64)}`;
const SEASONS = Array.from({ length: 16 }, (_, index) => 2011 + index);

interface Season {
  season: number;
  playerId: string;
  clubId: string;
  games: number;
  pav: number;
}

function model(seasons: readonly Season[], read = SEASONS): AflTradePlayerSeasonGames {
  const rows: AflTradePlayerSeasonGamesRows = {
    heads: read.map((season) => ({
      season_year: season,
      calculation_id: `hpn-pav-season:${season}`,
      status: 'finalized',
      finalized_at: '2026-10-01T00:00:00.000Z',
    })),
    players: seasons.map((row) => ({
      season_year: row.season,
      spell_version_id: `spell:${row.playerId}-${row.clubId}-${row.season}`,
      player_id: row.playerId,
      team_id: row.clubId,
      games_played: row.games,
      total_pav: row.pav,
    })),
    appearances: seasons.map((row) => ({
      season_year: row.season,
      player_id: row.playerId,
      club_id: row.clubId,
      matches: row.games,
    })),
  };
  return buildAflTradePlayerSeasonGames({ methodId, seasons: read }, rows);
}

const draftee = (
  draftYear: number,
  selectionNumber: number,
  playerId = `p${draftYear}-${selectionNumber}`,
  clubId = 'club:a'
): AflTradeValueLineDraftee => ({
  selectionId: `selection:${draftYear}-${selectionNumber}`,
  draftYear,
  selectionNumber,
  clubId,
  playerId,
});

/**
 * A synthetic league: classes 2011-2020 of 60 picks. A drafted player plays at his club from the
 * season after the draft for a slot-dependent number of seasons, then leaves the league. His PAV per
 * game is his own constant rate (persistent) or the slot rate plus alternating noise.
 */
function league(kind: 'persistent' | 'noise') {
  const draftees: AflTradeValueLineDraftee[] = [];
  const seasons: Season[] = [];
  for (let year = 2011; year <= 2020; year++)
    for (let slot = 1; slot <= 60; slot++) {
      const pick = draftee(year, slot);
      draftees.push(pick);
      const length = 2 + ((slot * 7 + year) % 9) + (slot <= 10 ? 3 : 0);
      const slotRate = 0.7 - 0.05 * Math.log(slot);
      const own = slotRate + (((slot * 13 + year) % 7) - 3) * 0.05;
      for (let tenure = 1; tenure <= length; tenure++) {
        const season = year + tenure;
        if (season > 2026) break;
        const games = 8 + ((slot + tenure) % 12);
        const rate = kind === 'persistent' ? own : slotRate + (tenure % 2 === 0 ? 0.2 : -0.2);
        seasons.push({
          season,
          playerId: pick.playerId,
          clubId: 'club:a',
          games,
          pav: games * rate,
        });
      }
    }
  return { model: model(seasons), draftees };
}

describe('value-line stints', () => {
  const at = (rows: Season[], pick: AflTradeValueLineDraftee, asOf: number) => {
    const m = model(rows);
    return aflTradeValueLineStint(m, indexAflTradeValueLineRows(m), pick, asOf);
  };
  const pick = draftee(2015, 12, 'p1');
  const row = (season: number, games: number, clubId = 'club:a'): Season => ({
    season,
    playerId: 'p1',
    clubId,
    games,
    pav: games * 0.5,
  });

  it('bands draft slots as the spec reports them', () => {
    expect([1, 10, 11, 30, 31, 97].map(aflTradeValueLineBand)).toEqual([
      '1-10',
      '1-10',
      '11-30',
      '11-30',
      '31+',
      '31+',
    ]);
    expect(() => aflTradeValueLineBand(0)).toThrow(RangeError);
  });

  it('ends a stint at a move, counting the move season he also played here', () => {
    const stint = at([row(2016, 10), row(2017, 5), row(2017, 3, 'club:b')], pick, 2026);
    expect(stint).toMatchObject({ tenure: 2, ended: true });
    expect(stint.seasons.map(({ games }) => games)).toEqual([10, 5]);
  });

  it('reads two full seasons without a game as the end, and a running stint as censored', () => {
    expect(at([row(2016, 10), row(2018, 4)], pick, 2026)).toMatchObject({
      tenure: 5,
      ended: true,
    });
    expect(at([row(2016, 10), row(2018, 4)], pick, 2020)).toMatchObject({
      tenure: 5,
      ended: false,
    });
    // A draftee who never plays is at the club for two seasons.
    expect(at([], pick, 2026)).toMatchObject({ tenure: 2, ended: true });
  });

  it('reads no season after the checkpoint', () => {
    const later = [row(2016, 10), row(2017, 12), row(2018, 14, 'club:b')];
    expect(at(later, pick, 2017)).toMatchObject({ tenure: 2, ended: false });
    expect(at(later, pick, 2015)).toMatchObject({ tenure: 0, ended: false, seasons: [] });
  });
});

describe('value-line fit', () => {
  it('values a pick at the draft exactly as its value line at checkpoint 0', () => {
    const { model: m, draftees } = league('persistent');
    const fit = fitAflTradeValueLine({ model: m, draftees, asOfSeason: 2026 });
    const index = indexAflTradeValueLineRows(m);
    for (const slot of [1, 7, 25, 60]) {
      const stint = aflTradeValueLineStint(m, index, draftee(2026 - 0, slot), 2026);
      expect(aflTradeValueLinePoint(fit, stint).value).toBeCloseTo(
        aflTradeValueLinePickValue(fit, slot),
        9
      );
    }
    const curve = aflTradeValueLinePickCurve(fit, 100);
    expect(curve[0]!.firstStintPav).toBeGreaterThan(curve[59]!.firstStintPav);
    expect(curve[99]!.dpvcV3).toBeNull();
    expect(fit.window).toEqual({
      draftYears: { from: 2011, through: 2020 },
      seasons: { from: 2012, through: 2026 },
      draftees: 600,
    });
    for (const band of fit.bands) {
      expect(band.tenures[0]!.survival).toBe(1);
      const survival = band.tenures.map((t) => t.survival);
      expect(survival).toEqual([...survival].sort((a, b) => b - a));
    }
  });

  it('fits k at 0 when a player keeps his own rate, and large when his form is noise', () => {
    const persistent = league('persistent');
    expect(fitAflTradeValueLine({ ...persistent, asOfSeason: 2026 }).credibility).toMatchObject({
      k: 0,
      onBoundary: true,
    });
    const noise = fitAflTradeValueLine({ ...league('noise'), asOfSeason: 2026 }).credibility;
    // Noise around the slot rate: the prior is the better predictor, so k runs to the grid's end.
    expect(noise).toMatchObject({ k: 2000, onBoundary: true });
  });

  it('uses no season after asOfSeason', () => {
    const { model: m, draftees } = league('persistent');
    const before = fitAflTradeValueLine({ model: m, draftees, asOfSeason: 2020 });
    const changed = model(
      m.rows
        .map((row) => ({ ...row, pav: row.season > 2020 ? row.pav * 3 : row.pav }))
        .map(({ season, playerId, clubId, games, pav }) => ({
          season,
          playerId,
          clubId,
          games,
          pav,
        }))
    );
    expect(fitAflTradeValueLine({ model: changed, draftees, asOfSeason: 2020 })).toEqual(before);
  });

  it('back-tests held-out classes at the draft, year 1 and year 3, beside DPVC v3.0', () => {
    const { model: m, draftees } = league('persistent');
    const backtest = backtestAflTradeValueLine({
      model: m,
      draftees,
      trainingDraftYears: { from: 2011, through: 2016 },
      heldOutDraftYears: [2017, 2018],
      actualThroughSeason: 2026,
    });
    expect(backtest.fits.map(({ draftYear, checkpoint }) => [draftYear, checkpoint])).toEqual([
      [2017, 0],
      [2017, 1],
      [2017, 3],
      [2018, 0],
      [2018, 1],
      [2018, 3],
    ]);
    expect(backtest.fits.every(({ fit }) => fit.window.draftYears.through === 2016)).toBe(true);
    const all = backtest.model.find((row) => row.checkpoint === 0 && row.range === 'all')!;
    expect(all.summary.selections).toBe(120);
    expect(backtest.dpvc.find((row) => row.range === 'all')!.summary.selections).toBe(120);
    expect(() =>
      backtestAflTradeValueLine({
        model: m,
        draftees,
        trainingDraftYears: { from: 2011, through: 2017 },
        heldOutDraftYears: [2017],
        actualThroughSeason: 2026,
      })
    ).toThrow(/held-out class may not also be a training class/);
  });

  it('refuses a season with no finalized calculation inside a stint', () => {
    const m = model(
      [{ season: 2016, playerId: 'p1', clubId: 'club:a', games: 5, pav: 2 }],
      SEASONS
    );
    const gap = {
      ...m,
      seasons: m.seasons.map((s) =>
        s.season === 2017 ? { ...s, availability: 'no_head' as const } : s
      ),
    };
    expect(() =>
      aflTradeValueLineStint(gap, indexAflTradeValueLineRows(gap), draftee(2015, 3, 'p1'), 2020)
    ).toThrow(/no finalized calculation/);
  });
});

describe('value-line draftees', () => {
  const row = (selection: string, year: number, number: number, player: string | null) => ({
    selection_id: selection,
    selection_number: number,
    player_id: player,
    club_id: 'club:a',
    draft_year: year,
  });

  it('maps current canonical selections in draft and slot order', () => {
    expect(
      buildAflTradeValueLineDraftees([2020], [row('s2', 2020, 2, 'p2'), row('s1', 2020, 1, 'p1')])
    ).toEqual([
      { selectionId: 's1', draftYear: 2020, selectionNumber: 1, clubId: 'club:a', playerId: 'p1' },
      { selectionId: 's2', draftYear: 2020, selectionNumber: 2, clubId: 'club:a', playerId: 'p2' },
    ]);
  });

  it('refuses a selection with no player, a duplicate, and a draft with no selection', () => {
    expect(() => buildAflTradeValueLineDraftees([2020], [row('s1', 2020, 1, null)])).toThrow(
      /names no player/
    );
    expect(() =>
      buildAflTradeValueLineDraftees([2020], [row('s1', 2020, 1, 'p1'), row('s2', 2020, 2, 'p1')])
    ).toThrow(/read twice/);
    expect(() =>
      buildAflTradeValueLineDraftees([2020], [row('s1', 2020, 1, 'p1'), row('s2', 2020, 1, 'p2')])
    ).toThrow(/read twice/);
    expect(() => buildAflTradeValueLineDraftees([2020, 2021], [row('s1', 2020, 1, 'p1')])).toThrow(
      /2021 national draft/
    );
  });
});
