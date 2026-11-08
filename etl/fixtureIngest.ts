/**
 * AFL fixture ingest: turns the rows `fetch_fw_fixture.R` reads from Footywire through fitzRoy into
 * the Firestore `matches` documents that lineup locks, competition timing, live scoring and the
 * stats processor's live gate read. Pure: no Firebase here, so it is tested without credentials.
 *
 * Every rule fails closed. A row with an unknown club, venue or start time, or a completed-match
 * count the fixture cannot explain, rejects the whole batch before anything is written.
 */

export type FixtureSourceRow = {
  season: number;
  season_game: number;
  round_label: string;
  home_team: string;
  away_team: string;
  venue: string;
  /** Venue-local wall clock, `YYYY-MM-DD HH:MM[:SS]`. fitzRoy labels it UTC; it is not. */
  local_start: string;
  /** How many of the season's games Footywire has posted match stats for. */
  completed_match_count: number;
};

export type FixtureMatchStatus = 'scheduled' | 'in_progress' | 'final';

export type FixtureMatch = {
  match_uid: string;
  season: number;
  round_number: number;
  round: number;
  home_team: string;
  away_team: string;
  venue: string;
  start_time_utc: string;
  status: FixtureMatchStatus;
  confirmed_bye_teams: string[];
  data_source: 'footywire_fitzroy';
};

const CLUBS: Record<string, { name: string; abbr: string }> = {
  Adelaide: { name: 'Adelaide', abbr: 'ADE' },
  'Brisbane Lions': { name: 'Brisbane Lions', abbr: 'BRL' },
  Carlton: { name: 'Carlton', abbr: 'CAR' },
  Collingwood: { name: 'Collingwood', abbr: 'COL' },
  Essendon: { name: 'Essendon', abbr: 'ESS' },
  Fremantle: { name: 'Fremantle', abbr: 'FRE' },
  Geelong: { name: 'Geelong', abbr: 'GEE' },
  'Gold Coast': { name: 'Gold Coast', abbr: 'GCS' },
  GWS: { name: 'GWS', abbr: 'GWS' },
  Hawthorn: { name: 'Hawthorn', abbr: 'HAW' },
  Melbourne: { name: 'Melbourne', abbr: 'MEL' },
  'North Melbourne': { name: 'North Melbourne', abbr: 'NTH' },
  'Port Adelaide': { name: 'Port Adelaide', abbr: 'PTA' },
  Richmond: { name: 'Richmond', abbr: 'RIC' },
  'St Kilda': { name: 'St Kilda', abbr: 'STK' },
  Sydney: { name: 'Sydney', abbr: 'SYD' },
  'West Coast': { name: 'West Coast', abbr: 'WCE' },
  'Western Bulldogs': { name: 'Western Bulldogs', abbr: 'WBD' },
  // Footywire's fixture still calls the Bulldogs Footscray.
  Footscray: { name: 'Western Bulldogs', abbr: 'WBD' },
};

const ALL_CLUB_NAMES = [...new Set(Object.values(CLUBS).map((club) => club.name))].sort();

// Footywire venue names, as its fixture prints them, to the venue's time zone.
const VENUE_TIME_ZONES: Record<string, string> = {
  'Adelaide Oval': 'Australia/Adelaide',
  'Barossa Park': 'Australia/Adelaide',
  'Norwood Oval': 'Australia/Adelaide',
  Carrara: 'Australia/Brisbane',
  Gabba: 'Australia/Brisbane',
  "Cazaly's Stadium": 'Australia/Brisbane',
  'Riverway Stadium': 'Australia/Brisbane',
  Docklands: 'Australia/Melbourne',
  'Eureka Stadium': 'Australia/Melbourne',
  'Kardinia Park': 'Australia/Melbourne',
  'M.C.G.': 'Australia/Melbourne',
  'Mars Stadium': 'Australia/Melbourne',
  'Hands Oval': 'Australia/Perth',
  'Perth Stadium': 'Australia/Perth',
  Subiaco: 'Australia/Perth',
  'Manuka Oval': 'Australia/Sydney',
  'S.C.G.': 'Australia/Sydney',
  'Stadium Australia': 'Australia/Sydney',
  'Sydney Showground': 'Australia/Sydney',
  'Marrara Oval': 'Australia/Darwin',
  'TIO Stadium': 'Australia/Darwin',
  'Traeger Park': 'Australia/Darwin',
  'Bellerive Oval': 'Australia/Hobart',
  'Ninja Stadium': 'Australia/Hobart',
  'York Park': 'Australia/Hobart',
  'UTAS Stadium': 'Australia/Hobart',
};

function club(name: string) {
  const found = CLUBS[String(name ?? '').trim()];
  if (!found) throw new Error(`Unknown Footywire club "${name}"`);
  return found;
}

function roundNumber(label: string): number | null {
  const match = /^Round (\d+)$/.exec(String(label ?? '').trim());
  return match ? Number(match[1]) : null;
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((part) => [part.type, part.value])
  );
  const wallMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return wallMs - utcMs;
}

function venueLocalToUtc(localStart: string, venue: string): Date {
  const timeZone = VENUE_TIME_ZONES[String(venue ?? '').trim()];
  if (!timeZone) throw new Error(`Unknown Footywire venue "${venue}"`);

  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(localStart ?? '').trim()
  );
  if (!match) throw new Error(`Unreadable Footywire start time "${localStart}"`);
  const [, year, month, day, hour, minute, second = '0'] = match;
  const wallMs = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);

  let utcMs = wallMs - zoneOffsetMs(wallMs, timeZone);
  utcMs = wallMs - zoneOffsetMs(utcMs, timeZone);
  return new Date(utcMs);
}

export function buildFixtureMatches(
  rows: readonly FixtureSourceRow[],
  now: Date,
  options: { round?: number } = {}
): FixtureMatch[] {
  if (rows.length === 0) throw new Error('Footywire returned no fixture rows');

  const season = Number(rows[0].season);
  const completedCount = Number(rows[0].completed_match_count);
  if (!Number.isInteger(season)) throw new Error(`Unreadable fixture season "${rows[0].season}"`);
  if (!Number.isInteger(completedCount) || completedCount < 0) {
    throw new Error(`Unreadable completed-match count "${rows[0].completed_match_count}"`);
  }

  const placed = rows.map((row) => {
    if (Number(row.season) !== season) throw new Error('Fixture rows span more than one season');
    if (Number(row.completed_match_count) !== completedCount) {
      throw new Error('Fixture rows disagree on the completed-match count');
    }
    if (!Number.isInteger(Number(row.season_game))) {
      throw new Error(`Unreadable season game "${row.season_game}"`);
    }
    return {
      seasonGame: Number(row.season_game),
      round: roundNumber(row.round_label),
      home: club(row.home_team),
      away: club(row.away_team),
      venue: String(row.venue).trim(),
      startsAt: venueLocalToUtc(row.local_start, row.venue),
    };
  });

  // Footywire posts match stats in fixture order, so the first `completedCount` games of the
  // season (finals included) are the completed ones. A count the clock cannot explain is refused.
  const bySeasonGame = [...placed].sort((a, b) => a.seasonGame - b.seasonGame);
  const started = placed.filter((game) => game.startsAt.getTime() <= now.getTime()).length;
  if (completedCount > started) {
    throw new Error(
      `Footywire reports ${completedCount} completed matches but the fixture has ${started} started`
    );
  }
  const completed = new Set(bySeasonGame.slice(0, completedCount));
  for (const game of completed) {
    if (game.startsAt.getTime() > now.getTime()) {
      throw new Error(`Footywire reports season game ${game.seasonGame} complete before its start`);
    }
  }

  const clubsByRound = new Map<number, Set<string>>();
  for (const game of placed) {
    if (game.round === null) continue;
    const clubs = clubsByRound.get(game.round) ?? new Set<string>();
    clubs.add(game.home.name).add(game.away.name);
    clubsByRound.set(game.round, clubs);
  }

  const seen = new Set<string>();
  const matches = placed.flatMap((game): FixtureMatch[] => {
    if (game.round === null) return [];
    if (options.round !== undefined && game.round !== options.round) return [];

    const matchUid = `${season}-R${game.round}-${game.home.abbr}-${game.away.abbr}`;
    if (seen.has(matchUid)) throw new Error(`Duplicate fixture match ${matchUid}`);
    seen.add(matchUid);

    const playing = clubsByRound.get(game.round)!;
    return [
      {
        match_uid: matchUid,
        season,
        round_number: game.round,
        round: game.round,
        home_team: game.home.name,
        away_team: game.away.name,
        venue: game.venue,
        start_time_utc: game.startsAt.toISOString(),
        status: completed.has(game)
          ? 'final'
          : game.startsAt.getTime() <= now.getTime()
            ? 'in_progress'
            : 'scheduled',
        confirmed_bye_teams: ALL_CLUB_NAMES.filter((name) => !playing.has(name)),
        data_source: 'footywire_fitzroy',
      },
    ];
  });

  if (options.round !== undefined && matches.length === 0) {
    throw new Error(`Footywire returned no fixture rows for round ${options.round}`);
  }
  return matches;
}

const COMPARED_FIELDS: (keyof FixtureMatch)[] = [
  'season',
  'round_number',
  'round',
  'home_team',
  'away_team',
  'venue',
  'start_time_utc',
  'status',
  'confirmed_bye_teams',
  'data_source',
];

export function changedFixtureMatches(
  matches: readonly FixtureMatch[],
  stored: ReadonlyMap<string, Record<string, unknown>>
): FixtureMatch[] {
  return matches.filter((match) => {
    const existing = stored.get(match.match_uid);
    if (!existing) return true;
    return COMPARED_FIELDS.some(
      (field) => JSON.stringify(existing[field]) !== JSON.stringify(match[field])
    );
  });
}

export async function ingestFixtureRows(
  rows: readonly FixtureSourceRow[],
  deps: {
    now: Date;
    round?: number;
    readStored: (season: number) => Promise<Map<string, Record<string, unknown>>>;
    write: (matches: FixtureMatch[]) => Promise<void>;
  }
): Promise<{ matches: number; written: number }> {
  const matches = buildFixtureMatches(rows, deps.now, { round: deps.round });
  const changed = changedFixtureMatches(matches, await deps.readStored(matches[0].season));
  if (changed.length > 0) await deps.write(changed);
  return { matches: matches.length, written: changed.length };
}

/**
 * The fixture match two clubs play in, whichever of them is listed first. The stats feed lists each
 * player's own club first, so an away club's rows name the game AWAY-HOME; the fixture's HOME-AWAY
 * match is the one id both clubs' stats must carry.
 */
export function findFixtureMatch<T extends Pick<FixtureMatch, 'home_team' | 'away_team'>>(
  matches: readonly T[],
  teamAbbr: string,
  oppAbbr: string
): T | undefined {
  const clubs = [teamAbbr, oppAbbr].sort().join('|');
  return matches.find(
    (match) => [club(match.home_team).abbr, club(match.away_team).abbr].sort().join('|') === clubs
  );
}

/**
 * Whether the stats processor may store a game's stats. Footywire posts match stats after full time,
 * when the fixture marks the game final, so live and final games are stored. A game that has not
 * started, or whose status is unknown or missing, is skipped. Backfill stores historical games
 * whatever their stored status.
 */
export function shouldStoreMatchStats(status: unknown, backfill: boolean): boolean {
  return backfill || status === 'in_progress' || status === 'final';
}

/** How long after the first bounce a final game keeps the live stats window open. */
export const FINAL_STATS_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Whether liveGuard should run the stats pipeline: a game is in progress, or a game that started in
 * the last FINAL_STATS_WINDOW_MS is final. Without the second case the last game of a window turns
 * final (its stats just posted) with nothing left in progress, and its stats are never fetched.
 */
export function statsWindowOpen(
  matches: readonly Pick<FixtureMatch, 'status' | 'start_time_utc'>[],
  now: Date
): boolean {
  return matches.some((match) => {
    if (match.status === 'in_progress') return true;
    const startedAgo = now.getTime() - Date.parse(match.start_time_utc);
    return match.status === 'final' && startedAgo >= 0 && startedAgo <= FINAL_STATS_WINDOW_MS;
  });
}
