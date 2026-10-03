import { getTeamName } from '@/lib/teamLogos';

/**
 * Maps Footywire club-list positions onto Statly players.
 *
 * Footywire (via fitzRoy `fetch_player_details(source = "footywire")`) lists a primary and an
 * optional secondary position per player: Defender, Midfield, Ruck or Forward. Statly stores
 * them on `Player.position` as `DEF`, `MID`, `RUC`, `FWD`, or a dual value such as `DEF/MID`.
 */

export type LineupPosition = 'DEF' | 'MID' | 'RUC' | 'FWD';

export interface FootywirePositionRow {
  team: string;
  first_name?: string | null;
  surname?: string | null;
  position_1?: string | null;
  position_2?: string | null;
}

export interface PositionPlayer {
  id: string;
  name: string;
  club: string;
  position: string;
}

export interface PositionUpdate {
  playerId: string;
  name: string;
  club: string;
  from: string;
  to: string;
}

export interface PositionSyncPlan {
  updates: PositionUpdate[];
  unchanged: number;
  /** Footywire rows with no Statly player. */
  unmatched: Array<{ name: string; team: string }>;
  /** Footywire rows that matched more than one Statly player. */
  ambiguous: Array<{ name: string; team: string; playerIds: string[] }>;
  /** Footywire rows without a usable position. */
  withoutPosition: Array<{ name: string; team: string }>;
}

const FOOTYWIRE_POSITIONS: Record<string, LineupPosition> = {
  defender: 'DEF',
  defence: 'DEF',
  midfield: 'MID',
  midfielder: 'MID',
  ruck: 'RUC',
  forward: 'FWD',
};

const POSITION_ORDER: LineupPosition[] = ['DEF', 'MID', 'RUC', 'FWD'];

export function mapFootywirePosition(value: string | null | undefined): LineupPosition | null {
  if (!value) return null;
  return FOOTYWIRE_POSITIONS[value.trim().toLowerCase()] ?? null;
}

/** Combines primary and secondary positions, primary first, without duplicates. */
export function combineFootywirePositions(
  primary: string | null | undefined,
  secondary: string | null | undefined
): string | null {
  const positions: LineupPosition[] = [];
  for (const value of [primary, secondary]) {
    const mapped = mapFootywirePosition(value);
    if (mapped && !positions.includes(mapped)) positions.push(mapped);
  }
  return positions.length ? positions.join('/') : null;
}

/** Positions a stored value makes a player eligible for (e.g. `DEF/MID` → DEF, MID). */
export function parseLineupPositions(value: string | null | undefined): LineupPosition[] {
  if (!value) return [];
  const aliases: Record<string, LineupPosition> = {
    DEFENDER: 'DEF',
    MIDFIELDER: 'MID',
    MIDFIELD: 'MID',
    RUCK: 'RUC',
    FORWARD: 'FWD',
  };
  const parts = value
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
    .map((part) => aliases[part] ?? part);
  return POSITION_ORDER.filter((position) => parts.includes(position));
}

export function normalizePlayerName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function normalizeClub(value: string): string {
  return getTeamName(value.trim()).toLowerCase();
}

/**
 * Statly's player feed shortens double-barrelled surnames ("Will H-Elliott" for Will
 * Hoskin-Elliott). Both forms reduce to the same key: first name, surname initial, last part.
 */
function abbreviatedStatlyKey(name: string): string | null {
  const match = name.trim().match(/^(.+)\s([A-Za-z])-([A-Za-z' ]+)$/);
  return match ? normalizePlayerName(`${match[1]} ${match[2]} ${match[3]}`) : null;
}

function abbreviatedFootywireKey(firstName: string, surname: string): string | null {
  if (!surname.includes('-')) return null;
  const last = surname.split('-').pop() ?? '';
  return normalizePlayerName(`${firstName} ${surname.trim()[0]} ${last}`);
}

function rowName(row: FootywirePositionRow): string {
  return [row.first_name, row.surname]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Plans position updates: match each Footywire row to a Statly player by name and club, falling
 * back to name alone when exactly one player has that name.
 */
export function planPositionSync(
  rows: readonly FootywirePositionRow[],
  players: readonly PositionPlayer[]
): PositionSyncPlan {
  const byNameAndClub = new Map<string, PositionPlayer[]>();
  const byName = new Map<string, PositionPlayer[]>();
  for (const player of players) {
    const club = normalizeClub(player.club);
    const names = new Set([normalizePlayerName(player.name), abbreviatedStatlyKey(player.name)]);
    for (const name of names) {
      if (!name) continue;
      const key = `${name}|${club}`;
      byNameAndClub.set(key, [...(byNameAndClub.get(key) ?? []), player]);
      byName.set(name, [...(byName.get(name) ?? []), player]);
    }
  }

  const plan: PositionSyncPlan = {
    updates: [],
    unchanged: 0,
    unmatched: [],
    ambiguous: [],
    withoutPosition: [],
  };
  const planned = new Set<string>();

  for (const row of rows) {
    const name = rowName(row);
    if (!name) continue;
    const position = combineFootywirePositions(row.position_1, row.position_2);
    if (!position) {
      plan.withoutPosition.push({ name, team: row.team });
      continue;
    }
    const club = normalizeClub(row.team);
    const keys = [
      normalizePlayerName(name),
      abbreviatedFootywireKey(row.first_name ?? '', row.surname ?? ''),
    ].filter((key): key is string => Boolean(key));
    let candidates: PositionPlayer[] = [];
    for (const lookup of [
      (key: string) => byNameAndClub.get(`${key}|${club}`),
      (key: string) => byName.get(key),
    ]) {
      for (const key of keys) {
        candidates = lookup(key) ?? [];
        if (candidates.length > 0) break;
      }
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) {
      plan.unmatched.push({ name, team: row.team });
      continue;
    }
    if (candidates.length > 1) {
      plan.ambiguous.push({
        name,
        team: row.team,
        playerIds: candidates.map((candidate) => candidate.id),
      });
      continue;
    }
    const [player] = candidates;
    if (planned.has(player.id)) continue;
    planned.add(player.id);
    if (player.position === position) {
      plan.unchanged += 1;
      continue;
    }
    plan.updates.push({
      playerId: player.id,
      name: player.name,
      club: player.club,
      from: player.position,
      to: position,
    });
  }

  return plan;
}

export function parseFootywirePositionNdjson(text: string): FootywirePositionRow[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as FootywirePositionRow;
      } catch {
        throw new Error(`Line ${index + 1} is not valid JSON.`);
      }
    })
    .filter((row) => typeof row?.team === 'string');
}
