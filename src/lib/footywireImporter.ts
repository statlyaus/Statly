import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { parse as parseDate } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { adminDb } from '@/lib/firebaseAdmin';
import { determineFootywireFixtureStatus, type LiveScoreboardMatch } from '@/lib/footywireLive';
import { logger } from '@/lib/logger';
import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import { getTeamAbbreviation, normalizeTeamName } from '@/lib/teamLogos';

const FOOTYWIRE_BASE_URL = 'https://www.footywire.com/afl/footy/';
const FOOTYWIRE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: 'https://www.footywire.com/',
};
const MELBOURNE_TIMEZONE = 'Australia/Melbourne';

type FixtureRow = {
  season: number;
  roundNumber: number;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  attendance?: number;
  dateText: string;
  startTimeUtc?: string;
  footywireMid?: string;
  resultText?: string;
  status: 'scheduled' | 'in_progress' | 'final';
};

type ParsedPlayerStat = {
  id: string;
  player_uid: string;
  playerId: string;
  player_id: string;
  player_name: string;
  team: string;
  opposition: string;
  position?: string;
  season: number;
  round_number: number;
  match_uid: string;
  match_id: string;
  match_date?: string;
  venue: string;
  source: 'footywire';
  data_source: 'footywire';
  provider_ids: {
    footywire_match_mid: string;
    footywire_player_href?: string;
  };
  last_seen_at: string;
  updated_at: string;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  goals: number;
  behinds: number;
  tackles: number;
  hitouts: number;
  goal_assists: number;
  inside_50s: number;
  clearances: number;
  clangers: number;
  rebound_50s: number;
  frees_for: number;
  frees_against: number;
  fantasy_points: number;
  supercoach: number;
  stats: {
    kicks: number;
    handballs: number;
    disposals: number;
    marks: number;
    goals: number;
    behinds: number;
    tackles: number;
    hitouts: number;
    goal_assists: number;
    inside_50s: number;
    clearances: number;
    clangers: number;
    rebound_50s: number;
    frees_for: number;
    frees_against: number;
    metres_gained: number;
    aflFantasy: number;
    supercoach: number;
  };
  metres_gained: number;
};

type ParsedPlayerDoc = {
  id: string;
  name: string;
  full_name: string;
  team: string;
  current_team: string;
  position?: string;
  positions: string[];
  provider_ids: {
    footywire_player_href?: string;
  };
  updated_at: string;
};

type ParsedMatchDoc = {
  id: string;
  match_uid: string;
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  venue: string;
  attendance?: number;
  start_time_utc?: string;
  status: 'scheduled' | 'in_progress' | 'final';
  home_score?: number;
  away_score?: number;
  home_score_breakdown?: string;
  away_score_breakdown?: string;
  current_quarter?: number;
  live_clock_text?: string;
  result?: string;
  source: 'footywire';
  provider_ids: {
    footywire_match_mid?: string;
  };
  last_seen_at: string;
  updated_at: string;
};

type ParsedMatchImport = {
  match: ParsedMatchDoc;
  players: ParsedPlayerDoc[];
  playerStats: ParsedPlayerStat[];
};

type PlayerMeta = {
  id: string;
  name: string;
  team?: string;
  position?: string;
};

type BatchOperation =
  | {
      kind: 'set';
      ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
      data: Record<string, unknown>;
    }
  | {
      kind: 'delete';
      ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
    };

export type FootywireImportResult = {
  season: number;
  rounds: number[];
  dryRun: boolean;
  fixtureRows: number;
  importedMatches: number;
  importedPlayers: number;
  importedPlayerStats: number;
  scheduledMatches: number;
  skippedMatches: number;
  matches: Array<{
    matchUid: string;
    roundNumber: number;
    status: 'scheduled' | 'in_progress' | 'final';
    footywireMid?: string;
    playerStats: number;
  }>;
};

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^0-9-]/g, '');
  if (!digits) return undefined;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function resolveTeamNameFromLink(href: string | undefined, fallbackText: string): string {
  if (href) {
    const slug = href
      .replace(/^.*th-/, '')
      .replace(/[?#].*$/, '')
      .replace(/-/g, ' ');
    const normalizedFromHref = normalizeTeamName(slug);
    if (normalizedFromHref) return normalizedFromHref;
  }

  return normalizeTeamName(fallbackText);
}

function parseFixtureDate(dateText: string, season: number): string | undefined {
  const cleaned = cleanText(dateText).replace(/(\d+)(st|nd|rd|th)/gi, '$1');
  try {
    const local = parseDate(`${cleaned} ${season}`, 'EEE d MMM h:mma yyyy', new Date());
    return fromZonedTime(local, MELBOURNE_TIMEZONE).toISOString();
  } catch {
    return undefined;
  }
}

function parseDetailedDate(dateText: string): string | undefined {
  const cleaned = cleanText(dateText)
    .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    .replace(/\bAEDT\b|\bAEST\b/gi, '')
    .trim();
  try {
    const local = parseDate(cleaned, 'EEEE, d MMMM yyyy, h:mm a', new Date());
    return fromZonedTime(local, MELBOURNE_TIMEZONE).toISOString();
  } catch {
    return undefined;
  }
}

function buildMatchUid(
  season: number,
  roundNumber: number,
  homeTeam: string,
  awayTeam: string
): string {
  return `${season}-R${roundNumber}-${getTeamAbbreviation(homeTeam)}-${getTeamAbbreviation(awayTeam)}`;
}

function buildLiveMatchKey(
  season: number,
  roundNumber: number,
  homeTeam: string,
  awayTeam: string
): string {
  return `${season}|${roundNumber}|${getTeamAbbreviation(normalizeTeamName(homeTeam))}|${getTeamAbbreviation(normalizeTeamName(awayTeam))}`;
}

async function fetchFootywireHtml(path: string): Promise<string> {
  const url = path.startsWith('http') ? path : new URL(path, FOOTYWIRE_BASE_URL).toString();
  const response = await axios.get<string>(url, {
    headers: FOOTYWIRE_HEADERS,
    responseType: 'text',
    timeout: 30000,
  });
  return response.data;
}

function parseScoreboardFromPage(
  $: cheerio.CheerioAPI,
  row: FixtureRow
): {
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  homeScoreBreakdown?: string;
  awayScoreBreakdown?: string;
  currentQuarter?: number;
  liveClockText?: string;
  venue: string;
  attendance?: number;
  startTimeUtc?: string;
} {
  const parseLiveProgress = (
    value: string
  ): { currentQuarter?: number; liveClockText?: string } => {
    const text = cleanText(value);
    const quarterMatch = text.match(/\b([1-4])(?:st|nd|rd|th)\s+Quarter\b/i);
    const currentQuarter = quarterMatch ? Number.parseInt(quarterMatch[1], 10) : undefined;
    const liveClockText =
      text.match(/\b([0-9]{1,2}:[0-9]{2})\b/)?.[1] ??
      text.match(/\b([0-9]{1,2}(?:\.[0-9]+)?)\s*(?:min|mins|minute|minutes)\b/i)?.[1];

    return {
      currentQuarter: Number.isFinite(currentQuarter) ? currentQuarter : undefined,
      liveClockText,
    };
  };

  const liveScoreTable = $('table')
    .filter((_, element) => {
      const table = $(element);
      const hasScoreHeader = table
        .find('td,th')
        .toArray()
        .some((cell) => cleanText($(cell).text()) === 'Score');
      const nestedHasScoreHeader = table
        .find('table')
        .toArray()
        .some((nested) =>
          $(nested)
            .find('td,th')
            .toArray()
            .some((cell) => cleanText($(cell).text()) === 'Score')
        );
      return hasScoreHeader && !nestedHasScoreHeader;
    })
    .first();
  if (liveScoreTable.length > 0) {
    const liveTitle = cleanText(
      $('td.tbtitle, th.tbtitle')
        .filter((_, element) => {
          const text = cleanText($(element).text());
          return /quarter/i.test(text) && /score/i.test(text);
        })
        .first()
        .text()
    );
    const liveProgress = parseLiveProgress(liveTitle);
    const teamRows = liveScoreTable
      .find('tr')
      .filter((_, element) => $(element).find('a[href^="th-"]').length > 0);
    const homeCells = teamRows.eq(0).children('td,th');
    const awayCells = teamRows.eq(1).children('td,th');
    const resolveBreakdown = (cells: cheerio.Cheerio<any>): string | undefined => {
      const values = cells
        .toArray()
        .slice(1, -1)
        .map((cell) => cleanText($(cell).text()))
        .filter((value) => /^\d+\.\d+$/.test(value));
      return values.length > 0 ? values[values.length - 1] : undefined;
    };
    return {
      homeTeam: normalizeTeamName(cleanText(homeCells.eq(0).text()) || row.homeTeam),
      awayTeam: normalizeTeamName(cleanText(awayCells.eq(0).text()) || row.awayTeam),
      homeScore: parseInteger(cleanText(homeCells.last().text())),
      awayScore: parseInteger(cleanText(awayCells.last().text())),
      homeScoreBreakdown: resolveBreakdown(homeCells),
      awayScoreBreakdown: resolveBreakdown(awayCells),
      currentQuarter: liveProgress.currentQuarter,
      liveClockText: liveProgress.liveClockText,
      venue: row.venue,
      attendance: row.attendance,
      startTimeUtc: row.startTimeUtc,
    };
  }

  const metaLine = cleanText(
    $('td.lnorm')
      .filter((_, element) => cleanText($(element).text()).includes('Attendance:'))
      .first()
      .text()
  );
  const dateLine = cleanText(
    $('td.lnorm')
      .filter((_, element) => /\d{4}/.test(cleanText($(element).text())))
      .first()
      .text()
  );
  const scoreRows = $('#matchscoretable tr');
  const homeCells = scoreRows.eq(1).children('td,th');
  const awayCells = scoreRows.eq(2).children('td,th');
  const resolveBreakdown = (cells: cheerio.Cheerio<any>): string | undefined => {
    const values = cells
      .toArray()
      .slice(1, -1)
      .map((cell) => cleanText($(cell).text()))
      .filter((value) => /^\d+\.\d+$/.test(value));
    return values.length > 0 ? values[values.length - 1] : undefined;
  };
  return {
    homeTeam: normalizeTeamName(cleanText(homeCells.eq(0).text()) || row.homeTeam),
    awayTeam: normalizeTeamName(cleanText(awayCells.eq(0).text()) || row.awayTeam),
    homeScore: parseInteger(cleanText(homeCells.last().text())),
    awayScore: parseInteger(cleanText(awayCells.last().text())),
    homeScoreBreakdown: resolveBreakdown(homeCells),
    awayScoreBreakdown: resolveBreakdown(awayCells),
    venue: metaLine.split(',')[1] ? cleanText(metaLine.split(',')[1]) : row.venue,
    attendance: parseInteger(metaLine.match(/Attendance:\s*([\d,]+)/)?.[1]) ?? row.attendance,
    startTimeUtc: parseDetailedDate(dateLine) ?? row.startTimeUtc,
  };
}

function extractStatsTables(
  $: cheerio.CheerioAPI
): Array<{ teamName: string; table: cheerio.Cheerio<any> }> {
  const titleCells = $('td.innertbtitle, td.tbtitle')
    .filter((_, element) => /statistics/i.test(cleanText($(element).text())))
    .toArray();

  const pairs: Array<{ teamName: string; table: cheerio.Cheerio<any> }> = [];
  for (const titleCell of titleCells) {
    const heading = cleanText($(titleCell).text())
      .replace(/\s+match\s+statistics.*$/i, '')
      .replace(/\s+statistics.*$/i, '')
      .trim();
    const teamName = normalizeTeamName(heading);
    if (!teamName) continue;

    const parentTable = $(titleCell).closest('table');
    const statsTable = parentTable
      .find('table')
      .filter((_, element) => $(element).find('tr').length > 1)
      .first();
    if (!statsTable.length) continue;

    pairs.push({ teamName, table: statsTable });
  }

  return pairs;
}

type FootywireNumericStatField =
  | 'kicks'
  | 'handballs'
  | 'disposals'
  | 'marks'
  | 'goals'
  | 'behinds'
  | 'tackles'
  | 'hitouts'
  | 'goal_assists'
  | 'inside_50s'
  | 'clearances'
  | 'clangers'
  | 'rebound_50s'
  | 'frees_for'
  | 'frees_against'
  | 'metres_gained'
  | 'aflFantasy'
  | 'supercoach';

type ParsedFootywireStatRow = {
  playerCellIndex: number;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  goals: number;
  behinds: number;
  tackles: number;
  hitouts: number;
  goal_assists: number;
  inside_50s: number;
  clearances: number;
  clangers: number;
  rebound_50s: number;
  frees_for: number;
  frees_against: number;
  metres_gained: number;
  aflFantasy: number;
  supercoach: number;
};

type FootywireStatColumnLayout = {
  playerCellIndex: number;
  columnIndexByField: Partial<Record<FootywireNumericStatField, number>>;
};

/** Normalised header label (Footywire uses short codes: K, MG, AF, …). */
function normalizeFootywireStatHeader(text: string): string {
  return cleanText(text)
    .replace(/\u00a0/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

const FOOTYWIRE_HEADER_TO_FIELD: Record<string, FootywireNumericStatField> = {
  K: 'kicks',
  HB: 'handballs',
  D: 'disposals',
  M: 'marks',
  G: 'goals',
  B: 'behinds',
  T: 'tackles',
  HO: 'hitouts',
  GA: 'goal_assists',
  I50: 'inside_50s',
  CL: 'clearances',
  CG: 'clangers',
  R50: 'rebound_50s',
  FF: 'frees_for',
  FA: 'frees_against',
  AF: 'aflFantasy',
  SC: 'supercoach',
  MG: 'metres_gained',
  MGL: 'metres_gained',
  MGAIN: 'metres_gained',
  METRES: 'metres_gained',
  METRESGAINED: 'metres_gained',
};

/** Footywire uses `title="Kicks"` etc. on header spans; abbreviations alone may be ambiguous. */
const FOOTYWIRE_TITLE_TO_FIELD: Record<string, FootywireNumericStatField> = {
  KICKS: 'kicks',
  HANDBALLS: 'handballs',
  DISPOSALS: 'disposals',
  MARKS: 'marks',
  GOALS: 'goals',
  BEHINDS: 'behinds',
  TACKLES: 'tackles',
  HITOUTS: 'hitouts',
  GOALASSISTS: 'goal_assists',
  INSIDE50S: 'inside_50s',
  CLEARANCES: 'clearances',
  CLANGERS: 'clangers',
  REBOUND50S: 'rebound_50s',
  FREESFOR: 'frees_for',
  FREESAGAINST: 'frees_against',
  AFLFANTASY: 'aflFantasy',
  SUPERCOACH: 'supercoach',
  METRESGAINED: 'metres_gained',
  METRES: 'metres_gained',
  MG: 'metres_gained',
};

/** Unambiguous visible abbreviations — checked before span titles so "MG" is never misread via a bad tooltip. */
const FOOTYWIRE_VISIBLE_ABBREV_TO_FIELD: Record<string, FootywireNumericStatField> = {
  MG: 'metres_gained',
  MGL: 'metres_gained',
  MGAIN: 'metres_gained',
  METRES: 'metres_gained',
  METRESGAINED: 'metres_gained',
  HB: 'handballs',
  HO: 'hitouts',
  GA: 'goal_assists',
  I50: 'inside_50s',
  CL: 'clearances',
  CG: 'clangers',
  R50: 'rebound_50s',
  FF: 'frees_for',
  FA: 'frees_against',
  AF: 'aflFantasy',
  SC: 'supercoach',
};

function normalizeFootywireTitle(title: string): string {
  return title
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function fieldFromFootywireHeaderCell(
  $: cheerio.CheerioAPI,
  cell: cheerio.Cheerio<any>
): FootywireNumericStatField | null {
  const raw = cleanText(cell.text());
  const label = normalizeFootywireStatHeader(raw);
  if (label && FOOTYWIRE_VISIBLE_ABBREV_TO_FIELD[label]) {
    return FOOTYWIRE_VISIBLE_ABBREV_TO_FIELD[label];
  }

  const titleRaw = cell.find('span[title]').first().attr('title')?.trim();
  if (titleRaw) {
    const t = normalizeFootywireTitle(titleRaw);
    const mapped = FOOTYWIRE_TITLE_TO_FIELD[t];
    if (mapped) return mapped;
    if (t.includes('METRE')) return 'metres_gained';
  }

  return label ? (FOOTYWIRE_HEADER_TO_FIELD[label] ?? null) : null;
}

function rowContainsFootywirePlayerLink($: cheerio.CheerioAPI, row: unknown): boolean {
  return $(row as Element)
    .find('a')
    .toArray()
    .some((anchor) => isValidPlayerLink($(anchor).attr('href')));
}

function parseFootywireStatHeaderLayout(
  $: cheerio.CheerioAPI,
  headerRow: unknown
): FootywireStatColumnLayout | null {
  const cells = $(headerRow as Element).children('td, th');
  if (cells.length < 8) return null;

  const columnIndexByField: Partial<Record<FootywireNumericStatField, number>> = {};
  let playerCellIndex = -1;

  for (let i = 0; i < cells.length; i++) {
    const cell = $(cells.eq(i));
    const raw = cleanText(cell.text());
    const label = normalizeFootywireStatHeader(raw);
    if (!label && !cell.find('span[title]').length) continue;

    if (label === 'NO' || label === 'NO.') continue;

    const titleHint = cell.find('span[title]').first().attr('title')?.trim().toLowerCase();
    if (label === 'PLAYER' || raw.toLowerCase().includes('player') || titleHint === 'player') {
      playerCellIndex = i;
      continue;
    }

    const field = fieldFromFootywireHeaderCell($, cell);
    if (field) {
      columnIndexByField[field] = i;
    }
  }

  if (playerCellIndex < 0) {
    playerCellIndex = cells.length >= 19 ? 1 : 0;
  }

  if (columnIndexByField.kicks === undefined || columnIndexByField.handballs === undefined) {
    return null;
  }

  return { playerCellIndex, columnIndexByField };
}

function parseFootywireStatRowWithLayout(
  statCells: cheerio.Cheerio<any>,
  layout: FootywireStatColumnLayout
): ParsedFootywireStatRow {
  const idx = layout.columnIndexByField;
  const pick = (field: FootywireNumericStatField): number => {
    const i = idx[field];
    if (i === undefined) return 0;
    return parseInteger(statCells.eq(i).text()) ?? 0;
  };

  return {
    playerCellIndex: layout.playerCellIndex,
    kicks: pick('kicks'),
    handballs: pick('handballs'),
    disposals: pick('disposals'),
    marks: pick('marks'),
    goals: pick('goals'),
    behinds: pick('behinds'),
    tackles: pick('tackles'),
    hitouts: pick('hitouts'),
    goal_assists: pick('goal_assists'),
    inside_50s: pick('inside_50s'),
    clearances: pick('clearances'),
    clangers: pick('clangers'),
    rebound_50s: pick('rebound_50s'),
    frees_for: pick('frees_for'),
    frees_against: pick('frees_against'),
    metres_gained: pick('metres_gained'),
    aflFantasy: pick('aflFantasy'),
    supercoach: pick('supercoach'),
  };
}

function parseStatCells(statCells: cheerio.Cheerio<any>): ParsedFootywireStatRow | null {
  if (statCells.length >= 19) {
    const href0 = statCells.eq(0).find('a').first().attr('href');
    const playerInFirstCell = typeof href0 === 'string' && /^pp-/.test(href0);

    if (playerInFirstCell) {
      return {
        playerCellIndex: 0,
        kicks: parseInteger(statCells.eq(1).text()) ?? 0,
        handballs: parseInteger(statCells.eq(2).text()) ?? 0,
        disposals: parseInteger(statCells.eq(3).text()) ?? 0,
        marks: parseInteger(statCells.eq(4).text()) ?? 0,
        goals: parseInteger(statCells.eq(5).text()) ?? 0,
        behinds: parseInteger(statCells.eq(6).text()) ?? 0,
        tackles: parseInteger(statCells.eq(7).text()) ?? 0,
        hitouts: parseInteger(statCells.eq(8).text()) ?? 0,
        goal_assists: parseInteger(statCells.eq(9).text()) ?? 0,
        inside_50s: parseInteger(statCells.eq(10).text()) ?? 0,
        clearances: parseInteger(statCells.eq(11).text()) ?? 0,
        clangers: parseInteger(statCells.eq(12).text()) ?? 0,
        rebound_50s: parseInteger(statCells.eq(13).text()) ?? 0,
        metres_gained: parseInteger(statCells.eq(14).text()) ?? 0,
        frees_for: parseInteger(statCells.eq(15).text()) ?? 0,
        frees_against: parseInteger(statCells.eq(16).text()) ?? 0,
        aflFantasy: parseInteger(statCells.eq(17).text()) ?? 0,
        supercoach: parseInteger(statCells.eq(18).text()) ?? 0,
      };
    }

    return {
      playerCellIndex: 1,
      kicks: parseInteger(statCells.eq(2).text()) ?? 0,
      handballs: parseInteger(statCells.eq(3).text()) ?? 0,
      disposals: parseInteger(statCells.eq(4).text()) ?? 0,
      marks: parseInteger(statCells.eq(5).text()) ?? 0,
      goals: parseInteger(statCells.eq(6).text()) ?? 0,
      behinds: parseInteger(statCells.eq(7).text()) ?? 0,
      tackles: parseInteger(statCells.eq(8).text()) ?? 0,
      hitouts: parseInteger(statCells.eq(9).text()) ?? 0,
      goal_assists: parseInteger(statCells.eq(10).text()) ?? 0,
      inside_50s: parseInteger(statCells.eq(11).text()) ?? 0,
      frees_for: parseInteger(statCells.eq(12).text()) ?? 0,
      frees_against: parseInteger(statCells.eq(13).text()) ?? 0,
      clearances: parseInteger(statCells.eq(14).text()) ?? 0,
      clangers: parseInteger(statCells.eq(15).text()) ?? 0,
      rebound_50s: parseInteger(statCells.eq(16).text()) ?? 0,
      aflFantasy: parseInteger(statCells.eq(17).text()) ?? 0,
      supercoach: parseInteger(statCells.eq(18).text()) ?? 0,
      metres_gained: 0,
    };
  }

  if (statCells.length >= 18) {
    return {
      playerCellIndex: 0,
      kicks: parseInteger(statCells.eq(1).text()) ?? 0,
      handballs: parseInteger(statCells.eq(2).text()) ?? 0,
      disposals: parseInteger(statCells.eq(3).text()) ?? 0,
      marks: parseInteger(statCells.eq(4).text()) ?? 0,
      goals: parseInteger(statCells.eq(5).text()) ?? 0,
      behinds: parseInteger(statCells.eq(6).text()) ?? 0,
      tackles: parseInteger(statCells.eq(7).text()) ?? 0,
      hitouts: parseInteger(statCells.eq(8).text()) ?? 0,
      goal_assists: parseInteger(statCells.eq(9).text()) ?? 0,
      inside_50s: parseInteger(statCells.eq(10).text()) ?? 0,
      clearances: parseInteger(statCells.eq(11).text()) ?? 0,
      clangers: parseInteger(statCells.eq(12).text()) ?? 0,
      rebound_50s: parseInteger(statCells.eq(13).text()) ?? 0,
      frees_for: parseInteger(statCells.eq(14).text()) ?? 0,
      frees_against: parseInteger(statCells.eq(15).text()) ?? 0,
      aflFantasy: parseInteger(statCells.eq(16).text()) ?? 0,
      supercoach: parseInteger(statCells.eq(17).text()) ?? 0,
      metres_gained: 0,
    };
  }

  return null;
}

export function parseFootywireMatchHtml(
  html: string,
  row: FixtureRow,
  playerMetaIndex: Map<string, PlayerMeta>,
  importedAtIso: string
): ParsedMatchImport {
  if (!row.footywireMid) {
    return buildScheduledMatch(row, importedAtIso);
  }

  const $ = cheerio.load(html);
  const scoreboard = parseScoreboardFromPage($, row);
  const homeTeam = scoreboard.homeTeam;
  const awayTeam = scoreboard.awayTeam;
  const matchUid = buildMatchUid(row.season, row.roundNumber, homeTeam, awayTeam);
  const footywireMatchMid = row.footywireMid;

  const players = new Map<string, ParsedPlayerDoc>();
  const playerStats: ParsedPlayerStat[] = [];

  try {
    for (const { teamName, table } of extractStatsTables($)) {
      const opposition = teamName === homeTeam ? awayTeam : homeTeam;
      const tableRows = table.find('tr').toArray();
      if (tableRows.length === 0) continue;

      const headerLayout =
        !rowContainsFootywirePlayerLink($, tableRows[0]) && tableRows.length > 1
          ? parseFootywireStatHeaderLayout($, tableRows[0])
          : null;
      const statBodyRows =
        headerLayout !== null && tableRows.length > 1 ? tableRows.slice(1) : tableRows;

      for (const statRow of statBodyRows) {
        const statCells = $(statRow).children('td, th');
        const parsedStatCells = headerLayout
          ? parseFootywireStatRowWithLayout(statCells, headerLayout)
          : parseStatCells(statCells);
        if (!parsedStatCells) continue;

        const playerLink = $(statCells.eq(parsedStatCells.playerCellIndex)).find('a').first();
        const playerHref = playerLink.attr('href') || undefined;
        const hrefName = derivePlayerNameFromHref(playerHref);
        const playerName = cleanText(
          playerLink.attr('title') ||
            hrefName ||
            playerLink.text() ||
            statCells.eq(parsedStatCells.playerCellIndex).text()
        );
        if (!isValidPlayerLink(playerHref) || !playerName || playerName === 'Player') continue;

        const playerMeta =
          playerMetaIndex.get(buildPlayerMetaKey(playerName, teamName)) ??
          playerMetaIndex.get(buildPlayerMetaKey(playerName, undefined));
        const providerPlayerUid =
          typeof playerHref === 'string' && playerHref.trim().length > 0
            ? playerHref.trim()
            : `ply_${slugify(playerName)}`;
        const canonicalPlayerId =
          typeof playerMeta?.id === 'string' &&
          playerMeta.id.trim().length > 0 &&
          !playerMeta.id.startsWith('ply_')
            ? playerMeta.id.trim()
            : buildCanonicalPlayerId(playerMeta?.name || playerName);
        const playerDocId = `${matchUid}_ply_${slugify(playerName)}`;
        const position =
          typeof playerMeta?.position === 'string' && playerMeta.position.trim().length > 0
            ? playerMeta.position
            : undefined;

        const stat = {
          kicks: parsedStatCells.kicks,
          handballs: parsedStatCells.handballs,
          disposals: parsedStatCells.disposals,
          marks: parsedStatCells.marks,
          goals: parsedStatCells.goals,
          behinds: parsedStatCells.behinds,
          tackles: parsedStatCells.tackles,
          hitouts: parsedStatCells.hitouts,
          goal_assists: parsedStatCells.goal_assists,
          inside_50s: parsedStatCells.inside_50s,
          frees_for: parsedStatCells.frees_for,
          frees_against: parsedStatCells.frees_against,
          clearances: parsedStatCells.clearances,
          clangers: parsedStatCells.clangers,
          rebound_50s: parsedStatCells.rebound_50s,
          aflFantasy: parsedStatCells.aflFantasy,
          supercoach: parsedStatCells.supercoach,
          metres_gained: parsedStatCells.metres_gained,
        };

        players.set(canonicalPlayerId, {
          id: canonicalPlayerId,
          name: playerMeta?.name || playerName,
          full_name: playerMeta?.name || playerName,
          team: teamName,
          current_team: teamName,
          position,
          positions: position ? [position] : [],
          provider_ids: { footywire_player_href: playerHref },
          updated_at: importedAtIso,
        });

        playerStats.push({
          id: playerDocId,
          player_uid: providerPlayerUid,
          playerId: canonicalPlayerId,
          player_id: canonicalPlayerId,
          player_name: playerMeta?.name || playerName,
          team: teamName,
          opposition,
          position,
          season: row.season,
          round_number: row.roundNumber,
          match_uid: matchUid,
          match_id: matchUid,
          match_date: scoreboard.startTimeUtc,
          venue: scoreboard.venue,
          source: 'footywire',
          data_source: 'footywire',
          provider_ids: {
            footywire_match_mid: footywireMatchMid,
            footywire_player_href: playerHref,
          },
          last_seen_at: importedAtIso,
          updated_at: importedAtIso,
          kicks: stat.kicks,
          handballs: stat.handballs,
          disposals: stat.disposals,
          marks: stat.marks,
          goals: stat.goals,
          behinds: stat.behinds,
          tackles: stat.tackles,
          hitouts: stat.hitouts,
          goal_assists: stat.goal_assists,
          inside_50s: stat.inside_50s,
          clearances: stat.clearances,
          clangers: stat.clangers,
          rebound_50s: stat.rebound_50s,
          frees_for: stat.frees_for,
          frees_against: stat.frees_against,
          fantasy_points: stat.aflFantasy,
          supercoach: stat.supercoach,
          metres_gained: stat.metres_gained,
          stats: stat,
        });
      }
    }
  } catch (statsError) {
    logger.warn('Footywire player stats parse failed; keeping scoreboard fields only', {
      error: statsError instanceof Error ? statsError.message : String(statsError),
      footywireMid: footywireMatchMid,
      season: row.season,
      round: row.roundNumber,
    });
  }

  return {
    match: {
      id: matchUid,
      match_uid: matchUid,
      season: row.season,
      round_number: row.roundNumber,
      home_team: homeTeam,
      away_team: awayTeam,
      venue: scoreboard.venue,
      attendance: scoreboard.attendance,
      start_time_utc: scoreboard.startTimeUtc,
      status: row.status,
      home_score: scoreboard.homeScore,
      away_score: scoreboard.awayScore,
      home_score_breakdown: scoreboard.homeScoreBreakdown,
      away_score_breakdown: scoreboard.awayScoreBreakdown,
      current_quarter: scoreboard.currentQuarter,
      live_clock_text: scoreboard.liveClockText,
      result:
        typeof scoreboard.homeScore === 'number' && typeof scoreboard.awayScore === 'number'
          ? `${scoreboard.homeScore}-${scoreboard.awayScore}`
          : row.resultText,
      source: 'footywire',
      provider_ids: {
        footywire_match_mid: footywireMatchMid,
      },
      last_seen_at: importedAtIso,
      updated_at: importedAtIso,
    },
    players: Array.from(players.values()),
    playerStats,
  };
}

function buildPlayerMetaKey(name: string, team?: string): string {
  return `${slugify(name)}|${slugify(team ?? '')}`;
}

async function resolveLocalPlayerStatsSnapshot(): Promise<string | null> {
  const cwd = process.cwd();
  const preferred = path.join(cwd, `player_stats_${getDefaultAflSeason()}.json`);
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    // Fall back to latest available season snapshot.
  }

  const entries = await fs.readdir(cwd);
  const candidates = entries
    .map((entry) => {
      const match = entry.match(/^player_stats_(20\d{2})\.json$/);
      if (!match) return null;
      return { season: Number(match[1]), filePath: path.join(cwd, entry) };
    })
    .filter((entry): entry is { season: number; filePath: string } => entry !== null)
    .sort((a, b) => b.season - a.season);

  return candidates[0]?.filePath ?? null;
}

async function buildPlayerMetaIndex(): Promise<Map<string, PlayerMeta>> {
  const filePath = await resolveLocalPlayerStatsSnapshot();
  const index = new Map<string, PlayerMeta>();
  if (!filePath) return index;

  const raw = await fs.readFile(filePath, 'utf8');
  const rows = JSON.parse(raw) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const name = cleanText(String(row.name ?? row.playerName ?? row.player ?? ''));
    const team = cleanText(String(row.team ?? row.club ?? ''));
    if (!name) continue;
    const id = cleanText(
      String(row.id ?? row.player_id ?? row.playerId ?? row.aflId ?? `ply_${slugify(name)}`)
    );
    const position = cleanText(String(row.position ?? row.pos ?? '')) || undefined;
    const meta = { id, name, team: team || undefined, position };
    index.set(buildPlayerMetaKey(name, team), meta);
    index.set(buildPlayerMetaKey(name), meta);
  }
  return index;
}

function isValidPlayerLink(href: string | undefined): href is string {
  return typeof href === 'string' && /^pp-/.test(href);
}

function toTitleCaseWord(value: string): string {
  if (!value) return value;
  if (value.length === 1) return value.toUpperCase();
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function derivePlayerNameFromHref(playerHref: string | undefined): string | undefined {
  if (!isValidPlayerLink(playerHref)) return undefined;

  const parts = playerHref.split('--');
  const slug = parts[parts.length - 1]?.split('?')[0] ?? '';
  if (!slug) return undefined;

  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => (part === 'o' ? "O'" : toTitleCaseWord(part)))
    .join(' ')
    .replace(/\bO'\s+/g, "O'");
}

export function parseFixtureRows(
  html: string,
  season: number,
  rounds: Set<number>,
  liveMatches: ReadonlyArray<LiveScoreboardMatch>
): FixtureRow[] {
  const $ = cheerio.load(html);
  const fixtureRows: FixtureRow[] = [];
  let currentRound: number | null = null;
  const liveMatchMids = new Set(
    liveMatches
      .map((match) => match.footywireMid)
      .filter((value): value is string => Boolean(value))
  );
  const liveMatchByKey = new Map(
    liveMatches.map((match) => [
      buildLiveMatchKey(match.season, match.roundNumber, match.homeTeam, match.awayTeam),
      match,
    ])
  );

  $('tr').each((_, element) => {
    const row = $(element);
    const roundAnchor = row.find('a[name^="round_"]').first();
    if (roundAnchor.length > 0) {
      currentRound = parseInteger(roundAnchor.attr('name')?.replace('round_', '')) ?? null;
      return;
    }

    if (currentRound === null || !rounds.has(currentRound)) return;

    const cells = row.children('td,th');
    if (cells.length < 5) return;

    const teamLinks = $(cells[1]).find('a');
    if (teamLinks.length < 2) return;

    const homeTeam = resolveTeamNameFromLink(
      teamLinks.eq(0).attr('href'),
      cleanText(teamLinks.eq(0).text())
    );
    const awayTeam = resolveTeamNameFromLink(
      teamLinks.eq(1).attr('href'),
      cleanText(teamLinks.eq(1).text())
    );
    const dateText = cleanText($(cells[0]).text());
    const venue = cleanText($(cells[2]).text());

    if (!homeTeam || !awayTeam || !dateText || !venue) return;

    const resultLink = $(cells[4]).find('a[href*="ft_match_statistics?mid="]').first();
    const liveMatch = liveMatchByKey.get(
      buildLiveMatchKey(season, currentRound, homeTeam, awayTeam)
    );
    const footywireMid =
      resultLink.attr('href')?.match(/mid=(\d+)/)?.[1] ?? liveMatch?.footywireMid;
    const resultText = cleanText(resultLink.text()) || undefined;
    const attendance = parseInteger(cleanText($(cells[3]).text()));
    const status =
      liveMatch?.status === 'in_progress'
        ? 'in_progress'
        : determineFootywireFixtureStatus({
            footywireMid,
            resultText,
            liveMatchMids,
          });

    fixtureRows.push({
      season,
      roundNumber: currentRound,
      homeTeam,
      awayTeam,
      venue,
      attendance,
      dateText,
      startTimeUtc: parseFixtureDate(dateText, season),
      footywireMid,
      resultText,
      status,
    });
  });

  return fixtureRows;
}

function buildLiveScoreboardFallbackMatchImport(
  row: FixtureRow,
  live: LiveScoreboardMatch | undefined,
  importedAtIso: string
): ParsedMatchImport | null {
  if (!row.footywireMid) return null;
  if (row.status !== 'in_progress' && row.status !== 'final') return null;
  if (typeof live?.homeScore !== 'number' || typeof live?.awayScore !== 'number') return null;

  const homeTeam = normalizeTeamName(row.homeTeam);
  const awayTeam = normalizeTeamName(row.awayTeam);
  const matchUid = buildMatchUid(row.season, row.roundNumber, row.homeTeam, row.awayTeam);

  return {
    match: {
      id: matchUid,
      match_uid: matchUid,
      season: row.season,
      round_number: row.roundNumber,
      home_team: homeTeam,
      away_team: awayTeam,
      venue: row.venue,
      attendance: row.attendance,
      start_time_utc: row.startTimeUtc,
      status: row.status,
      home_score: live.homeScore,
      away_score: live.awayScore,
      result: `${live.homeScore}-${live.awayScore}`,
      source: 'footywire',
      provider_ids: {
        footywire_match_mid: row.footywireMid,
      },
      last_seen_at: importedAtIso,
      updated_at: importedAtIso,
    },
    players: [],
    playerStats: [],
  };
}

function buildScheduledMatch(row: FixtureRow, importedAtIso: string): ParsedMatchImport {
  const matchUid = buildMatchUid(row.season, row.roundNumber, row.homeTeam, row.awayTeam);
  return {
    match: {
      id: matchUid,
      match_uid: matchUid,
      season: row.season,
      round_number: row.roundNumber,
      home_team: row.homeTeam,
      away_team: row.awayTeam,
      venue: row.venue,
      attendance: row.attendance,
      start_time_utc: row.startTimeUtc,
      status: 'scheduled',
      source: 'footywire',
      provider_ids: {},
      last_seen_at: importedAtIso,
      updated_at: importedAtIso,
    },
    players: [],
    playerStats: [],
  };
}

async function parseCompletedMatch(
  row: FixtureRow,
  playerMetaIndex: Map<string, PlayerMeta>,
  importedAtIso: string
): Promise<ParsedMatchImport> {
  if (!row.footywireMid) {
    return buildScheduledMatch(row, importedAtIso);
  }
  const path =
    row.status === 'in_progress'
      ? `live_stats?mid=${row.footywireMid}`
      : `ft_match_statistics?mid=${row.footywireMid}`;
  const html = await fetchFootywireHtml(path);
  return parseFootywireMatchHtml(html, row, playerMetaIndex, importedAtIso);
}

async function writeImport(parsedMatches: ParsedMatchImport[], importedAt: Date): Promise<void> {
  const matchRefs = parsedMatches.map((item) => adminDb.collection('matches').doc(item.match.id));
  const playerRefs = Array.from(
    new Map(
      parsedMatches.flatMap((item) =>
        item.players.map((player) => [player.id, adminDb.collection('players').doc(player.id)])
      )
    ).values()
  );
  const statRefs = parsedMatches.flatMap((item) =>
    item.playerStats.map((stat) => adminDb.collection('player_match_stats').doc(stat.id))
  );

  const allRefs = [...matchRefs, ...playerRefs, ...statRefs];
  const existingDocs = allRefs.length > 0 ? await adminDb.getAll(...allRefs) : [];
  const existingIds = new Set(existingDocs.filter((doc) => doc.exists).map((doc) => doc.ref.path));

  const createdAt = importedAt.toISOString();
  const operations: BatchOperation[] = [];

  for (const item of parsedMatches) {
    const ref = adminDb.collection('matches').doc(item.match.id);
    const payload = existingIds.has(ref.path)
      ? item.match
      : { ...item.match, created_at: createdAt };
    operations.push({ kind: 'set', ref, data: stripUndefined(payload) as Record<string, unknown> });
  }

  for (const player of Array.from(
    new Map(
      parsedMatches.flatMap((item) => item.players.map((entry) => [entry.id, entry]))
    ).values()
  )) {
    const ref = adminDb.collection('players').doc(player.id);
    const payload = existingIds.has(ref.path) ? player : { ...player, created_at: createdAt };
    operations.push({ kind: 'set', ref, data: stripUndefined(payload) as Record<string, unknown> });
  }

  for (const stat of parsedMatches.flatMap((item) => item.playerStats)) {
    const ref = adminDb.collection('player_match_stats').doc(stat.id);
    const payload = existingIds.has(ref.path) ? stat : { ...stat, created_at: createdAt };
    operations.push({ kind: 'set', ref, data: stripUndefined(payload) as Record<string, unknown> });
  }

  for (const item of parsedMatches.filter((entry) => entry.match.status === 'final')) {
    const incomingStatIds = new Set(item.playerStats.map((stat) => stat.id));
    const existingStats = await adminDb
      .collection('player_match_stats')
      .where('match_uid', '==', item.match.id)
      .get();

    for (const doc of existingStats.docs) {
      if (!incomingStatIds.has(doc.id)) {
        operations.push({ kind: 'delete', ref: doc.ref });
      }
    }
  }

  const maxBatchSize = 450;
  for (let index = 0; index < operations.length; index += maxBatchSize) {
    const batch = adminDb.batch();
    const chunk = operations.slice(index, index + maxBatchSize);
    for (const operation of chunk) {
      if (operation.kind === 'set') {
        batch.set(operation.ref, operation.data, { merge: true });
      } else {
        batch.delete(operation.ref);
      }
    }
    await batch.commit();
  }
}

export async function importFootywireRounds(options: {
  season: number;
  rounds: number[];
  dryRun?: boolean;
  liveMatches?: LiveScoreboardMatch[];
}): Promise<FootywireImportResult> {
  const rounds = Array.from(
    new Set(
      options.rounds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
    )
  ).sort((a, b) => a - b);
  if (rounds.length === 0) {
    throw new Error('At least one round is required');
  }

  const importedAt = new Date();
  const importedAtIso = importedAt.toISOString();
  const fixtureHtml = await fetchFootywireHtml(`ft_match_list?year=${options.season}`);
  const fixtureRows = parseFixtureRows(
    fixtureHtml,
    options.season,
    new Set(rounds),
    options.liveMatches ?? []
  );
  const playerMetaIndex = await buildPlayerMetaIndex();

  const liveByFootywireMid = new Map(
    (options.liveMatches ?? [])
      .filter((match): match is LiveScoreboardMatch & { footywireMid: string } =>
        Boolean(match.footywireMid)
      )
      .map((match) => [match.footywireMid, match])
  );

  const parsedMatches: ParsedMatchImport[] = [];
  let skippedMatches = 0;

  for (const row of fixtureRows) {
    try {
      if ((row.status === 'final' || row.status === 'in_progress') && row.footywireMid) {
        parsedMatches.push(await parseCompletedMatch(row, playerMetaIndex, importedAtIso));
      } else {
        parsedMatches.push(buildScheduledMatch(row, importedAtIso));
      }
    } catch (error) {
      const live = row.footywireMid ? liveByFootywireMid.get(row.footywireMid) : undefined;
      const fallback = buildLiveScoreboardFallbackMatchImport(row, live, importedAtIso);
      if (fallback) {
        parsedMatches.push(fallback);
        logger.warn('Footywire round import used live scoreboard totals after match page failure', {
          season: options.season,
          round: row.roundNumber,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          footywireMid: row.footywireMid,
        });
      } else {
        skippedMatches += 1;
        logger.error('Footywire round import failed for match', error, {
          season: options.season,
          round: row.roundNumber,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          footywireMid: row.footywireMid,
        });
      }
    }
  }

  if (!options.dryRun) {
    await writeImport(parsedMatches, importedAt);
  }

  return {
    season: options.season,
    rounds,
    dryRun: Boolean(options.dryRun),
    fixtureRows: fixtureRows.length,
    importedMatches: parsedMatches.length,
    importedPlayers: new Set(
      parsedMatches.flatMap((item) => item.players.map((player) => player.id))
    ).size,
    importedPlayerStats: parsedMatches.reduce((sum, item) => sum + item.playerStats.length, 0),
    scheduledMatches: parsedMatches.filter((item) => item.match.status === 'scheduled').length,
    skippedMatches,
    matches: parsedMatches.map((item) => ({
      matchUid: item.match.id,
      roundNumber: item.match.round_number,
      status: item.match.status,
      footywireMid: item.match.provider_ids.footywire_match_mid,
      playerStats: item.playerStats.length,
    })),
  };
}
