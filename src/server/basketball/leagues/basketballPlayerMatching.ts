/**
 * Pure name handling for fantasy basketball rosters: normalising NBA player names, stripping the
 * clutter Yahoo and ESPN add when a roster is copied, and proposing candidate players for a name.
 *
 * Matching only PROPOSES players. Nothing here writes, and nothing calling it may save a match: the
 * user reviews every proposal and confirms player ids, which is the reviewed identity operation.
 */

export interface MatchablePlayer {
  id: string;
  fullName: string;
  lastName: string | null;
  active: boolean;
}

export type PasteMatchStatus = 'matched' | 'suggested' | 'ambiguous' | 'none';

export interface NameMatch<P extends MatchablePlayer> {
  name: string;
  status: PasteMatchStatus;
  candidates: P[];
}

export const MAX_AMBIGUOUS_CANDIDATES = 5;

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
// Letters NFD does not split into a base letter and a mark.
const UNDECOMPOSED_LETTERS: Record<string, string> = {
  đ: 'd',
  ł: 'l',
  ø: 'o',
  æ: 'ae',
  ß: 'ss',
  ı: 'i',
};

/** Lowercase, accents and punctuation removed, hyphens as spaces, trailing Jr/Sr/II/III/IV dropped. */
export function normalisePlayerName(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đłøæßı]/g, (letter) => UNDECOMPOSED_LETTERS[letter] ?? letter)
    .replace(/[-_/]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

const SLOT_LABELS = new Set([
  'PG',
  'SG',
  'G',
  'SF',
  'PF',
  'F',
  'C',
  'UTIL',
  'Util',
  'BN',
  'BE',
  'Bench',
  'IL',
  'IL+',
  'IR',
]);
const POSITION_LIST = /^(PG|SG|G|SF|PF|F|C)([,/](PG|SG|G|SF|PF|F|C))*$/;
const STATUS_TAGS = new Set([
  'O',
  'OUT',
  'INJ',
  'DTD',
  'GTD',
  'Q',
  'D',
  'P',
  'NA',
  'SUSP',
  'OFS',
  'IR',
  'IL',
]);
// Standard codes plus the spellings Yahoo (Title case: Ind, Phi, Bkn) and ESPN (GS, NY, SA, UTAH) use.
const TEAM_CODES = new Set(
  [
    'ATL',
    'BOS',
    'BKN',
    'BRK',
    'CHA',
    'CHO',
    'CHI',
    'CLE',
    'DAL',
    'DEN',
    'DET',
    'GSW',
    'GS',
    'HOU',
    'IND',
    'LAC',
    'LAL',
    'MEM',
    'MIA',
    'MIL',
    'MIN',
    'NOP',
    'NO',
    'NOR',
    'NYK',
    'NY',
    'OKC',
    'ORL',
    'PHI',
    'PHX',
    'PHO',
    'POR',
    'SAC',
    'SAS',
    'SA',
    'TOR',
    'UTA',
    'UTAH',
    'WAS',
    'WSH',
  ].map((code) => code.toLowerCase())
);
const SEPARATORS = new Set(['-', '–', '—', '|', '•']);
const JERSEY_NUMBER = /^#?\d{1,2}$/;

function bare(token: string): string {
  return token.replace(/^[([]+|[)\],;]+$/g, '');
}

function isLeadingClutter(token: string): boolean {
  return (
    SLOT_LABELS.has(token) ||
    POSITION_LIST.test(token) ||
    SEPARATORS.has(token) ||
    JERSEY_NUMBER.test(token)
  );
}

function isTrailingClutter(token: string): boolean {
  const value = bare(token);
  return isLeadingClutter(value) || STATUS_TAGS.has(value) || TEAM_CODES.has(value.toLowerCase());
}

function cleanCell(cell: string): string {
  const tokens = cell.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && isLeadingClutter(tokens[0])) tokens.shift();
  while (tokens.length > 1 && isTrailingClutter(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 1 && isTrailingClutter(tokens[0])) return '';
  return tokens.join(' ');
}

const hasTwoWords = (text: string) =>
  text.split(' ').filter((token) => /\p{L}/u.test(token)).length >= 2;

/**
 * The player name in one pasted roster line, or '' when the line holds no name. Only strips slot
 * labels, jersey numbers, positions, team codes and status tags from the ends of the name, never from
 * its middle. A tab-separated row (a copied table row) yields its first cell that reads as a name.
 */
export function cleanPastedLine(line: string): string {
  const cells = line.split('\t').map(cleanCell).filter(Boolean);
  return cells.find(hasTwoWords) ?? cells[0] ?? '';
}

function byActiveThenName<P extends MatchablePlayer>(players: P[]): P[] {
  const active = players.filter((player) => player.active);
  return (active.length > 0 ? active : players).sort((left, right) =>
    normalisePlayerName(left.fullName).localeCompare(normalisePlayerName(right.fullName))
  );
}

function initialKey(normalisedFirstAndRest: string, normalisedLast?: string): string | null {
  const tokens = normalisedFirstAndRest.split(' ');
  const last = normalisedLast ?? tokens.slice(1).join(' ');
  return tokens.length > 1 && last ? `${tokens[0][0]} ${last}` : null;
}

function toMatch<P extends MatchablePlayer>(
  name: string,
  pool: P[],
  single: 'matched' | 'suggested'
): NameMatch<P> {
  const ranked = byActiveThenName(pool);
  return ranked.length === 1
    ? { name, status: single, candidates: ranked }
    : { name, status: 'ambiguous', candidates: ranked.slice(0, MAX_AMBIGUOUS_CANDIDATES) };
}

/**
 * Exact normalised full name (an active player wins over inactive namesakes) → `matched`; else a
 * unique first initial + surname → `suggested`; several → `ambiguous`; nothing → `none`.
 */
export function matchPlayerNames<P extends MatchablePlayer>(
  names: readonly string[],
  players: readonly P[]
): NameMatch<P>[] {
  const byFullName = new Map<string, P[]>();
  const byInitial = new Map<string, P[]>();
  for (const player of players) {
    const full = normalisePlayerName(player.fullName);
    byFullName.set(full, [...(byFullName.get(full) ?? []), player]);
    const key = initialKey(
      full,
      player.lastName ? normalisePlayerName(player.lastName) : undefined
    );
    if (key) byInitial.set(key, [...(byInitial.get(key) ?? []), player]);
  }

  return names.map((name) => {
    const normalised = normalisePlayerName(name);
    const exact = byFullName.get(normalised);
    if (exact) return toMatch(name, exact, 'matched');
    const key = initialKey(normalised);
    const loose = key ? byInitial.get(key) : undefined;
    if (loose) return toMatch(name, loose, 'suggested');
    return { name, status: 'none', candidates: [] };
  });
}

/**
 * Accent-insensitive player search: exact name first, then names starting with the query, then names
 * with a word starting with it, then any other name containing it; ties by name.
 */
export function searchPlayersByName<P extends MatchablePlayer>(
  query: string,
  players: readonly P[],
  limit: number
): P[] {
  const needle = normalisePlayerName(query);
  if (needle.length < 2) return [];

  const rank = (name: string): number | null => {
    if (name === needle) return 0;
    if (name.startsWith(needle)) return 1;
    if (name.includes(` ${needle}`)) return 2;
    if (name.includes(needle)) return 3;
    return null;
  };

  return players
    .map((player) => {
      const name = normalisePlayerName(player.fullName);
      return { player, name, rank: rank(name) };
    })
    .filter((entry): entry is { player: P; name: string; rank: number } => entry.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map((entry) => entry.player);
}
