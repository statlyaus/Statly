/**
 * Rotation Watch: who starts, who lost minutes and which coaches shuffle their lineups, from box
 * scores alone. Ports the sheet's Rotation Watch (Apps Script `LineupLog.gs`: `buildRotationWatch_`,
 * `llWhyOut_`, `llAlerts_`) without its coach career traits and churn probabilities, which came from
 * a hand-built dataset. "Last 5" and "last 10" are the team's last games, not calendar days. Pure
 * and isomorphic.
 */

import type { EasternDate } from './fantasyWeeks';

export type RotationDnpReason =
  'COACH_DECISION' | 'INJURY' | 'REST' | 'SUSPENDED' | 'PERSONAL' | 'OTHER';

/** One player's line in one game, as stored (every listed player, dressed or not). */
export interface RotationGameRow {
  gameId: string;
  gameDate: EasternDate;
  teamCode: string;
  playerId: string;
  starter: boolean;
  played: boolean;
  dnpReason: RotationDnpReason | null;
  secondsPlayed: number;
  /** The box line the two warning flags read. */
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  freeThrowsAttempted: number;
  plusMinus: number;
}

/** Why a starter was not in the next game's five. */
export type WhyOut = 'not dressed' | 'bench' | 'DNP-CD' | 'rested' | 'suspended' | 'injured';

export interface StartingFiveChange {
  gameDate: EasternDate;
  into: string[];
  out: { playerId: string; why: WhyOut }[];
}

export interface RotationTeam {
  teamCode: string;
  gamesPlayed: number;
  /** Distinct starting fives (games with exactly five starters). */
  uniqueFives: number;
  uniqueFivesLast10: number;
  /** Games whose starters differ from the team's previous game. */
  fiveChanges: number;
  lastChange: StartingFiveChange | null;
  coachDnpsPerGameLast10: number;
  /** Players with 10 or more minutes, per game, over the last 10. */
  tenMinutePlayersPerGameLast10: number;
}

export type LastGameStatus =
  'STARTED' | 'BENCH' | 'DNP_CD' | 'REST' | 'SUSPENDED' | 'OUT' | 'NOT_DRESSED';

export const LAST_GAME_LABELS: Record<LastGameStatus, string> = {
  STARTED: 'Started',
  BENCH: 'Bench',
  DNP_CD: 'DNP-CD',
  REST: 'Rest',
  SUSPENDED: 'Suspended',
  OUT: 'Out (injury)',
  NOT_DRESSED: 'Not dressed',
};

export type RotationRole = 'Starter' | 'Spot starter' | 'Bench' | 'DNP';

export type AlertLevel = 'RED' | 'AMBER' | 'GREEN';

export interface RotationAlert {
  level: AlertLevel;
  /** Up to two items, most important first, e.g. "DNP-CD 2 Nov · DNP risk ↑". */
  text: string;
  /** The first item's symbol and short label, e.g. "▼ DNP-CD" or "▲ New starter". */
  marker: string;
  /** A bigger role and why, for the free-agent radar. */
  roleUp: 'EARNED' | 'INJURY_COVER' | 'MINUTES_UP' | null;
}

export interface RotationPlayer {
  playerId: string;
  /** His team now: the team of his latest box-score row. */
  teamCode: string;
  /** The numbers below count his games for that team only. */
  gamesPlayed: number;
  gamesStarted: number;
  startsLast5: number;
  /** Team games in the last-5 window (fewer early in the season). */
  teamGamesLast5: number;
  lastGame: LastGameStatus;
  /** The team's latest game. */
  lastGameDate: EasternDate;
  coachDnpsLast10: number;
  lastCoachDnpOn: EasternDate | null;
  /** His latest move into or out of the starting five within the last 10 team games. */
  fiveChange: {
    direction: 'INTO' | 'OUT_OF';
    gameDate: EasternDate;
    why: WhyOut | null;
  } | null;
  minutesPerGame: number;
  role: RotationRole;
  summary: string;
  alert: RotationAlert | null;
}

/** What the alerts need to know about a player beyond his box scores. */
export interface RotationPlayerInfo {
  name: string;
  /** Listed position, to pair a new starter with the absent starter he covers for. */
  position: string | null;
  /** Expected return from the injury report. */
  returnOn: EasternDate | null;
}

export interface RotationResult {
  teams: RotationTeam[];
  players: RotationPlayer[];
}

interface TeamGame {
  gameId: string;
  gameDate: EasternDate;
  starters: string[];
  box: Map<string, RotationGameRow>;
}

const TEN_MINUTES = 600;

function whyOut(row: RotationGameRow | undefined): WhyOut {
  if (!row) return 'not dressed';
  if (row.played) return 'bench';
  switch (row.dnpReason) {
    case 'COACH_DECISION':
      return 'DNP-CD';
    case 'REST':
      return 'rested';
    case 'SUSPENDED':
      return 'suspended';
    default:
      return 'injured';
  }
}

function lastGameStatus(row: RotationGameRow | undefined): LastGameStatus {
  if (!row) return 'NOT_DRESSED';
  if (row.starter) return 'STARTED';
  if (row.played) return 'BENCH';
  switch (row.dnpReason) {
    case 'COACH_DECISION':
      return 'DNP_CD';
    case 'REST':
      return 'REST';
    case 'SUSPENDED':
      return 'SUSPENDED';
    default:
      return 'OUT';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2 Nov". */
export function shortDate(date: EasternDate): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

const isCoachDnp = (row: RotationGameRow | undefined) =>
  !!row && !row.played && row.dnpReason === 'COACH_DECISION';

function uniqueFives(games: TeamGame[]): number {
  const fives = games.filter((game) => game.starters.length === 5);
  return new Set(fives.map((game) => [...game.starters].sort().join('|'))).size;
}

/** Each team's games in order (date, then game id), from its rows. */
function teamGames(rows: readonly RotationGameRow[]): Map<string, TeamGame[]> {
  const byTeam = new Map<string, Map<string, TeamGame>>();
  for (const row of rows) {
    const games = byTeam.get(row.teamCode) ?? new Map<string, TeamGame>();
    byTeam.set(row.teamCode, games);
    const game = games.get(row.gameId) ?? {
      gameId: row.gameId,
      gameDate: row.gameDate,
      starters: [],
      box: new Map(),
    };
    games.set(row.gameId, game);
    game.box.set(row.playerId, row);
    if (row.starter) game.starters.push(row.playerId);
  }
  return new Map(
    [...byTeam].map(([teamCode, games]) => [
      teamCode,
      [...games.values()].sort(
        (a, b) => a.gameDate.localeCompare(b.gameDate) || a.gameId.localeCompare(b.gameId)
      ),
    ])
  );
}

type Change = StartingFiveChange & { index: number };

/** Every game whose starters differ from the previous game's, with its index in `games`. */
function fiveChanges(games: TeamGame[]): Change[] {
  return games.flatMap((game, index) => {
    if (index === 0) return [];
    const previous = games[index - 1].starters;
    const into = game.starters.filter((playerId) => !previous.includes(playerId));
    const out = previous.filter((playerId) => !game.starters.includes(playerId));
    if (into.length === 0 && out.length === 0) return [];
    return [
      {
        index,
        gameDate: game.gameDate,
        into,
        out: out.map((playerId) => ({ playerId, why: whyOut(game.box.get(playerId)) })),
      },
    ];
  });
}

function buildTeam(teamCode: string, games: TeamGame[], changes: Change[]): RotationTeam {
  const last10 = games.slice(-10);
  const lastChange = changes.at(-1);
  let coachDnps = 0;
  let tenMinutePlayers = 0;
  for (const game of last10) {
    for (const row of game.box.values()) {
      if (isCoachDnp(row)) coachDnps += 1;
      if (row.played && row.secondsPlayed >= TEN_MINUTES) tenMinutePlayers += 1;
    }
  }
  return {
    teamCode,
    gamesPlayed: games.length,
    uniqueFives: uniqueFives(games),
    uniqueFivesLast10: uniqueFives(last10),
    fiveChanges: changes.length,
    lastChange: lastChange
      ? { gameDate: lastChange.gameDate, into: lastChange.into, out: lastChange.out }
      : null,
    coachDnpsPerGameLast10: coachDnps / Math.max(last10.length, 1),
    tenMinutePlayersPerGameLast10: tenMinutePlayers / Math.max(last10.length, 1),
  };
}

const minutes = (row: RotationGameRow) => row.secondsPlayed / 60;
const total = (rows: RotationGameRow[], value: (row: RotationGameRow) => number) =>
  rows.reduce((sum, row) => sum + value(row), 0);

/** "Walker" from "Will Walker Jr.". */
function surname(name: string): string {
  return (
    name
      .replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '')
      .trim()
      .split(' ')
      .at(-1) ?? name
  );
}

/**
 * The sheet's `llAlerts_`: up to two items, in priority order: coach DNP, benched, new starter,
 * the two warning flags, minutes swing. Level is the highest of all items.
 */
function buildAlert(
  playerId: string,
  games: TeamGame[],
  changes: Change[],
  startsLast5: number,
  /** His games with minutes, for every team, in date order. */
  ownGames: RotationGameRow[],
  info: ReadonlyMap<string, RotationPlayerInfo>
): RotationAlert | null {
  const LEVELS = [null, 'GREEN', 'AMBER', 'RED'] as const;
  const items: { text: string; level: 1 | 2 | 3; marker: string }[] = [];
  const add = (text: string, level: 1 | 2 | 3, marker: string) =>
    items.push({ text, level, marker });
  let roleUp: RotationAlert['roleUp'] = null;
  const n = games.length;
  const rowIn = (game: TeamGame) => game.box.get(playerId);
  const startedLast = !!rowIn(games[n - 1])?.starter;

  // 1. A coach DNP in the last two team games, for a rotation player (12+ minutes over the last 10).
  const played10 = games.slice(-10).flatMap((game) => {
    const row = rowIn(game);
    return row?.played ? [row] : [];
  });
  const minutes10 = played10.length ? total(played10, minutes) / played10.length : 0;
  const coachDnp = games
    .slice(-2)
    .filter((game) => isCoachDnp(rowIn(game)))
    .at(-1);
  if (coachDnp && minutes10 >= 12) add(`DNP-CD ${shortDate(coachDnp.gameDate)}`, 3, '▼ DNP-CD');

  // 2. Benched: an established starter (4 of the 5 games before) sent to the bench in the last 3.
  const recent = changes.filter((change) => change.index >= n - 3);
  const out = recent
    .filter((change) =>
      change.out.some(
        (left) => left.playerId === playerId && (left.why === 'bench' || left.why === 'DNP-CD')
      )
    )
    .at(-1);
  const established =
    !!out &&
    games.slice(Math.max(0, out.index - 5), out.index).filter((game) => rowIn(game)?.starter)
      .length >= 4;
  if (out && established && !startedLast && !coachDnp) {
    add(`Benched ${shortDate(out.gameDate)}`, 3, '▼ Benched');
  }

  // 3. Into the five in the last 3 and still there; not a starter back from an absence.
  const into = recent.filter((change) => change.into.includes(playerId)).at(-1);
  if (into && startedLast) {
    let previous: { row: RotationGameRow; index: number } | null = null;
    for (let index = into.index - 1; index >= 0 && !previous; index -= 1) {
      const row = rowIn(games[index]);
      if (row?.played) previous = { row, index };
    }
    const returning = !!previous && previous.row.starter && previous.index < into.index - 1;
    if (!returning) {
      // Pair the new starters with starters who are out (not benched), same position first.
      const gone = into.out
        .filter(
          (left) =>
            left.why !== 'bench' &&
            left.why !== 'DNP-CD' &&
            !games[n - 1].box.get(left.playerId)?.starter
        )
        .map((left) => left.playerId);
      const used = new Set<string>();
      let coverFor: string | null = null;
      for (const newStarter of into.into) {
        const position = info.get(newStarter)?.position;
        const free = gone.filter((candidate) => !used.has(candidate));
        const match =
          free.find((candidate) => position && info.get(candidate)?.position === position) ??
          free[0];
        if (!match) continue;
        used.add(match);
        if (newStarter === playerId) coverFor = match;
      }
      if (coverFor) {
        const back = info.get(coverFor)?.returnOn;
        add(
          `Starting for ${surname(info.get(coverFor)?.name ?? coverFor)}${back ? ` (back ${shortDate(back)})` : ''}`,
          1,
          '▲ Starter (cover)'
        );
        roleUp = 'INJURY_COVER';
      } else {
        add(`New starter ${shortDate(into.gameDate)}`, 1, '▲ New starter');
        roleUp = 'EARNED';
      }
    }
  }

  // 4. The sheet's two validated warning flags, from his last 10 and last 5 games with minutes.
  const last10 = ownGames.slice(-10);
  const last5 = ownGames.slice(-5);
  if (last10.length >= 5) {
    const minutesTotal = total(last10, minutes);
    const freeThrowsPer36 = (total(last10, (row) => row.freeThrowsAttempted) / minutesTotal) * 36;
    const attempts5 = total(last5, (row) => row.fieldGoalsAttempted);
    const effective5 = attempts5
      ? (total(last5, (row) => row.fieldGoalsMade) +
          0.5 * total(last5, (row) => row.threePointersMade)) /
        attempts5
      : 1;
    const plusMinusPer48 = (total(last10, (row) => row.plusMinus) / minutesTotal) * 48;
    const attempts10 = total(last10, (row) => row.fieldGoalsAttempted);
    const fieldGoal10 = attempts10 ? total(last10, (row) => row.fieldGoalsMade) / attempts10 : 1;
    if (startsLast5 >= 4 && freeThrowsPer36 <= 2.45 && effective5 <= 0.509 && !out) {
      add('Bench risk ↑', 2, '⚠ Bench risk');
    }
    if (
      startsLast5 <= 2 &&
      !startedLast &&
      minutesTotal / last10.length >= 12 &&
      plusMinusPer48 <= -5.4 &&
      fieldGoal10 <= 0.425 &&
      !coachDnp
    ) {
      add('DNP risk ↑', 2, '⚠ DNP risk');
    }
  }

  // 5. Minutes swing: median of his last 3 games for this team against his average for it.
  const played = games.flatMap((game) => {
    const row = rowIn(game);
    return row?.played ? [row] : [];
  });
  if (played.length >= 6) {
    const average = total(played, minutes) / played.length;
    const median = played
      .slice(-3)
      .map(minutes)
      .sort((a, b) => a - b)[1];
    const swing = median - average;
    const shortText = `Min ${Math.round(median)} (avg ${Math.round(average)})`;
    const text = `Min ${Math.round(median)} last 3 (avg ${Math.round(average)})`;
    if (swing >= 5 && average < 30 && !into) {
      add(text, 1, `▲ ${shortText}`);
      roleUp ??= 'MINUTES_UP';
    } else if (swing <= (played.length <= 12 ? -10 : -7) && average >= 15 && !out && !coachDnp) {
      add(text, 2, `▼ ${shortText}`);
    }
  }

  if (items.length === 0) return null;
  return {
    level: LEVELS[Math.max(...items.map((item) => item.level))]!,
    text: items
      .slice(0, 2)
      .map((item) => item.text)
      .join(' · '),
    marker: items[0].marker,
    roleUp,
  };
}

function buildPlayer(
  playerId: string,
  teamCode: string,
  games: TeamGame[],
  changes: Change[],
  fivesLast10: number,
  ownGames: RotationGameRow[],
  info: ReadonlyMap<string, RotationPlayerInfo>
): RotationPlayer {
  const rows = games.map((game) => game.box.get(playerId));
  const played = rows.filter((row) => row?.played);
  const last5 = rows.slice(-5);
  const last10 = games.slice(-10);
  const coachDnps = last10.filter((game) => isCoachDnp(game.box.get(playerId)));
  const startsLast5 = last5.filter((row) => row?.starter).length;
  const lastGame = lastGameStatus(rows.at(-1));
  const change = changes
    .filter(
      (candidate) =>
        candidate.index >= games.length - 10 &&
        (candidate.into.includes(playerId) ||
          candidate.out.some((out) => out.playerId === playerId))
    )
    .at(-1);
  const fiveChange = change
    ? change.into.includes(playerId)
      ? { direction: 'INTO' as const, gameDate: change.gameDate, why: null }
      : {
          direction: 'OUT_OF' as const,
          gameDate: change.gameDate,
          why: whyOut(games[change.index].box.get(playerId)),
        }
    : null;
  const role: RotationRole =
    startsLast5 >= 4
      ? 'Starter'
      : startsLast5 >= 1
        ? 'Spot starter'
        : played.length
          ? 'Bench'
          : 'DNP';
  const seconds = played.reduce((sum, row) => sum + (row?.secondsPlayed ?? 0), 0);

  const summary = [
    lastGame === 'STARTED' || lastGame === 'BENCH'
      ? null
      : `Last game: ${LAST_GAME_LABELS[lastGame]}`,
    `${role} (started ${startsLast5} of ${last5.length})`,
    coachDnps.length ? `DNP-CD ${coachDnps.length} in last 10` : null,
    fiveChange
      ? fiveChange.direction === 'INTO'
        ? `Into starting five ${shortDate(fiveChange.gameDate)}`
        : `Out of starting five ${shortDate(fiveChange.gameDate)} (${fiveChange.why})`
      : null,
    `team used ${fivesLast10} starting ${fivesLast10 === 1 ? 'five' : 'fives'} in last 10`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    playerId,
    teamCode,
    gamesPlayed: played.length,
    gamesStarted: rows.filter((row) => row?.starter).length,
    startsLast5,
    teamGamesLast5: last5.length,
    lastGame,
    lastGameDate: games[games.length - 1].gameDate,
    coachDnpsLast10: coachDnps.length,
    lastCoachDnpOn: coachDnps.at(-1)?.gameDate ?? null,
    fiveChange,
    minutesPerGame: played.length ? seconds / 60 / played.length : 0,
    role,
    summary,
    alert: buildAlert(playerId, games, changes, startsLast5, ownGames, info),
  };
}

/** The team of each player's latest row: where he plays now. */
function currentTeams(rows: readonly RotationGameRow[]): Map<string, string> {
  const latest = new Map<string, RotationGameRow>();
  for (const row of rows) {
    const seen = latest.get(row.playerId);
    if (
      !seen ||
      row.gameDate > seen.gameDate ||
      (row.gameDate === seen.gameDate && row.gameId > seen.gameId)
    ) {
      latest.set(row.playerId, row);
    }
  }
  return new Map([...latest].map(([playerId, row]) => [playerId, row.teamCode]));
}

export function buildRotation(
  rows: readonly RotationGameRow[],
  info: ReadonlyMap<string, RotationPlayerInfo> = new Map()
): RotationResult {
  const gamesByTeam = teamGames(rows);
  const ownGames = new Map<string, RotationGameRow[]>();
  for (const row of rows) {
    if (!row.played || row.secondsPlayed <= 0) continue;
    const list = ownGames.get(row.playerId) ?? [];
    ownGames.set(row.playerId, list);
    list.push(row);
  }
  for (const list of ownGames.values()) {
    list.sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.gameId.localeCompare(b.gameId));
  }
  const teamCodes = [...gamesByTeam.keys()].sort();
  const changesByTeam = new Map(
    teamCodes.map((teamCode) => [teamCode, fiveChanges(gamesByTeam.get(teamCode)!)])
  );
  const teams = teamCodes.map((teamCode) =>
    buildTeam(teamCode, gamesByTeam.get(teamCode)!, changesByTeam.get(teamCode)!)
  );
  const fivesLast10 = new Map(teams.map((team) => [team.teamCode, team.uniqueFivesLast10]));

  const players = [...currentTeams(rows)]
    .sort(([a, teamA], [b, teamB]) => teamA.localeCompare(teamB) || a.localeCompare(b))
    .map(([playerId, teamCode]) =>
      buildPlayer(
        playerId,
        teamCode,
        gamesByTeam.get(teamCode)!,
        changesByTeam.get(teamCode)!,
        fivesLast10.get(teamCode)!,
        ownGames.get(playerId) ?? [],
        info
      )
    );
  return { teams, players };
}
