/**
 * Jordan Dawson's real numbers for the "How Statly values trades" explainer (/afl/trades/method).
 *
 * Seasons: his PAV working for each Adelaide season, computed 2026-11-20 with `hpnPavCore.ts` from the
 * AFL Tables player-match rows in the genuine grading database (one finalized capture per season).
 * Every season total matches his trade value line exactly. Trade: his 2021 trade (Sydney to
 * Adelaide) from trade story bundle 1e9e6025 (value lines 22cd0864), the bundle the live trade pages
 * serve. The expected part reproduces traded-player value-line fit ad8045d9 exactly.
 */

export type Pool = 'off' | 'mid' | 'def';

export interface DawsonStats {
  totalPoints: number;
  hitOuts: number;
  goalAssists: number;
  inside50s: number;
  marks: number;
  marksInside50: number;
  freeKicksFor: number;
  freeKicksAgainst: number;
  rebound50s: number;
  onePercenters: number;
  clearances: number;
  tackles: number;
}

export interface DawsonSeason {
  season: number;
  clubs: number;
  leaguePointsPerInside50: number;
  adelaide: {
    pointsFor: number;
    pointsAgainst: number;
    inside50sFor: number;
    inside50sAgainst: number;
    rating: Record<Pool, number>;
    allRatings: Record<Pool, number>;
    pav: Record<Pool, number>;
  };
  dawson: {
    stats: DawsonStats;
    score: Record<Pool, number>;
    clubScore: Record<Pool, number>;
    pav: Record<Pool, number>;
    total: number;
  };
  /** His games that season. */
  games: number;
  /** Where his season total sits among players with 10 or more games that season. */
  rank: { position: number; of: number; median: number; tenth: number; top: number };
}

export const DAWSON_SEASONS: readonly DawsonSeason[] = [
  {
    season: 2022,
    clubs: 18,
    leaguePointsPerInside50: 1.586019,
    adelaide: {
      pointsFor: 1721,
      pointsAgainst: 1986,
      inside50sFor: 1109,
      inside50sAgainst: 1208,
      rating: { off: 0.978455, mid: 0.918046, def: 0.963418 },
      allRatings: { off: 17.9343, mid: 18.098251, def: 18.031674 },
      pav: { off: 98.203943, mid: 91.306251, def: 96.172524 },
    },
    dawson: {
      stats: {
        totalPoints: 66,
        hitOuts: 0,
        goalAssists: 9,
        inside50s: 81,
        marks: 146,
        marksInside50: 6,
        freeKicksFor: 11,
        freeKicksAgainst: 16,
        rebound50s: 150,
        onePercenters: 76,
        clearances: 15,
        tackles: 65,
      },
      score: { off: 175, mid: 1705, def: 4024 },
      clubScore: { off: 3746.0, mid: 39853.0, def: 31090.666667 },
      pav: { off: 4.587744, mid: 3.906285, def: 12.447409 },
      total: 20.941438,
    },
    games: 22,
    rank: { position: 13, of: 463, median: 10.227179, tenth: 18.022968, top: 26.137491 },
  },
  {
    season: 2023,
    clubs: 18,
    leaguePointsPerInside50: 1.582034,
    adelaide: {
      pointsFor: 2193,
      pointsAgainst: 1877,
      inside50sFor: 1257,
      inside50sAgainst: 1194,
      rating: { off: 1.102777, mid: 1.052764, def: 1.006325 },
      allRatings: { off: 17.95945, mid: 18.053651, def: 17.99955 },
      pav: { off: 110.526666, mid: 104.963525, def: 100.63506 },
    },
    dawson: {
      stats: {
        totalPoints: 51,
        hitOuts: 0,
        goalAssists: 20,
        inside50s: 130,
        marks: 114,
        marksInside50: 7,
        freeKicksFor: 38,
        freeKicksAgainst: 27,
        rebound50s: 52,
        onePercenters: 39,
        clearances: 88,
        tackles: 153,
      },
      score: { off: 259, mid: 4180, def: 1616 },
      clubScore: { off: 4624.25, mid: 43494.5, def: 31264.0 },
      pav: { off: 6.190497, mid: 10.087426, def: 5.20171 },
      total: 21.479633,
    },
    games: 23,
    rank: { position: 10, of: 476, median: 10.490605, tenth: 17.337712, top: 28.794261 },
  },
  {
    season: 2024,
    clubs: 18,
    leaguePointsPerInside50: 1.630071,
    adelaide: {
      pointsFor: 1906,
      pointsAgainst: 1923,
      inside50sFor: 1132,
      inside50sAgainst: 1215,
      rating: { off: 1.032927, mid: 0.931687, def: 1.029051 },
      allRatings: { off: 17.949543, mid: 18.053294, def: 18.014013 },
      pav: { off: 103.583107, mid: 92.893686, def: 102.825064 },
    },
    dawson: {
      stats: {
        totalPoints: 66,
        hitOuts: 0,
        goalAssists: 15,
        inside50s: 129,
        marks: 110,
        marksInside50: 3,
        freeKicksFor: 22,
        freeKicksAgainst: 27,
        rebound50s: 41,
        onePercenters: 27,
        clearances: 69,
        tackles: 134,
      },
      score: { off: 238, mid: 3712, def: 1232 },
      clubScore: { off: 4099.5, mid: 40379.0, def: 31405.0 },
      pav: { off: 6.013606, mid: 8.539621, def: 4.033768 },
      total: 18.586995,
    },
    games: 22,
    rank: { position: 41, of: 463, median: 10.397868, tenth: 17.903857, top: 30.288133 },
  },
  {
    season: 2025,
    clubs: 18,
    leaguePointsPerInside50: 1.632781,
    adelaide: {
      pointsFor: 2400,
      pointsAgainst: 1815,
      inside50sFor: 1335,
      inside50sAgainst: 1272,
      rating: { off: 1.101037, mid: 1.049528, def: 1.1261 },
      allRatings: { off: 17.895317, mid: 18.055744, def: 17.978093 },
      pav: { off: 110.747808, mid: 104.628809, def: 112.747254 },
    },
    dawson: {
      stats: {
        totalPoints: 128,
        hitOuts: 0,
        goalAssists: 20,
        inside50s: 156,
        marks: 117,
        marksInside50: 11,
        freeKicksFor: 37,
        freeKicksAgainst: 30,
        rebound50s: 27,
        onePercenters: 38,
        clearances: 109,
        tackles: 184,
      },
      score: { off: 362, mid: 5079, def: 1083 },
      clubScore: { off: 5131.75, mid: 45714.5, def: 33401.333333 },
      pav: { off: 7.812288, mid: 11.624533, def: 3.655701 },
      total: 23.092521,
    },
    games: 25,
    rank: { position: 14, of: 462, median: 10.722926, tenth: 18.325998, top: 27.811593 },
  },
  {
    season: 2026,
    clubs: 18,
    leaguePointsPerInside50: 1.682087,
    adelaide: {
      pointsFor: 2350,
      pointsAgainst: 2061,
      inside50sFor: 1311,
      inside50sAgainst: 1339,
      rating: { off: 1.065655, mid: 0.979089, def: 1.084941 },
      allRatings: { off: 17.869743, mid: 17.986029, def: 17.979773 },
      pav: { off: 107.342293, mid: 97.984943, def: 108.616195 },
    },
    dawson: {
      stats: {
        totalPoints: 140,
        hitOuts: 0,
        goalAssists: 15,
        inside50s: 101,
        marks: 114,
        marksInside50: 12,
        freeKicksFor: 28,
        freeKicksAgainst: 27,
        rebound50s: 58,
        onePercenters: 28,
        clearances: 91,
        tackles: 126,
      },
      score: { off: 299, mid: 3714, def: 1564 },
      clubScore: { off: 5028.0, mid: 44752.0, def: 34768.666667 },
      pav: { off: 6.383323, mid: 8.131839, def: 4.885886 },
      total: 19.401048,
    },
    games: 22,
    rank: { position: 28, of: 472, median: 10.455533, tenth: 17.236996, top: 27.170237 },
  },
];

export const DAWSON_TRADE = {
  tradeYear: 2021,
  from: 'Sydney',
  to: 'Adelaide',
  pickLabel: "a 2022 first-round pick (originally Melbourne's)",
  pickOutcome: { club: 'Hawthorn', selection: 18, player: 'Josh Weddle', projectedSlot: 14 },
  dawsonAtTrade: 68.17,
  pickAtTrade: 71.65,
  /** Dawson at Adelaide, end of each season: PAV produced so far, expected still to come, and the two added. */
  dawsonLine: [
    { season: 2022, produced: 20.94, expected: 75.47, value: 96.41 },
    { season: 2023, produced: 42.42, expected: 77.88, value: 120.31 },
    { season: 2024, produced: 61.01, expected: 74.62, value: 135.63 },
    { season: 2025, produced: 84.1, expected: 73.85, value: 157.95 },
    { season: 2026, produced: 103.5, expected: 67.0, value: 170.5 },
  ],
  /** The pick Sydney received: valued at its projected slot, then at the draft it became Weddle at Hawthorn. */
  pickLine: [
    { label: 'End of 2022', produced: 0, expected: 71.65, value: 71.65 },
    { label: '2022 draft', produced: 0, expected: 59.25, value: 59.25 },
    { label: 'End of 2023', produced: 7.73, expected: 78.68, value: 86.41 },
    { label: 'End of 2024', produced: 21.82, expected: 90.1, value: 111.92 },
    { label: 'End of 2025', produced: 32.97, expected: 84.11, value: 117.08 },
    { label: 'End of 2026', produced: 45.18, expected: 85.14, value: 130.32 },
  ],
  pickAtDraft: 59.25,
  adelaideNet2026: 40.18,
  /**
   * How his end-2026 expected PAV (67.00) is made (stage origin: his 2015 draft). Each future season
   * adds chance still at Adelaide × expected games × expected PAV a game.
   */
  expected2026: {
    typical: { games: 16.879, pavPerGame: 0.5933 },
    hisEdge: { games: 1.3599, pavPerGame: 0.231 },
    seasons: [
      { label: '2027', stillThere: 0.9174, games: 18.2386, pavPerGame: 0.8243, expected: 13.7922 },
      { label: '2028', stillThere: 0.8416, games: 18.2386, pavPerGame: 0.8243, expected: 12.6529 },
      { label: '2029', stillThere: 0.6619, games: 16.7067, pavPerGame: 0.819, expected: 9.0572 },
      { label: '2030', stillThere: 0.5206, games: 16.7067, pavPerGame: 0.819, expected: 7.1233 },
      { label: '2031', stillThere: 0.4094, games: 16.7067, pavPerGame: 0.819, expected: 5.6023 },
      { label: '2032', stillThere: 0.322, games: 16.7067, pavPerGame: 0.819, expected: 4.4061 },
    ],
    later: { label: '2033 on', expected: 14.361 },
    expectedSeasons: 4.722,
    expectedGames: 81.59,
    total: 66.9951,
  },
} as const;
