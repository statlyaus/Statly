// src/lib/data.ts
import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Player } from '@/types';

type AnyObj = Record<string, unknown>;

let _cache: Player[] | null = null;

const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const normalizeKey = (k: string) => {
  const cleaned = k.toLowerCase().replace(/\s+/g, ' ').trim();

  const map: Record<string, string> = {
    // identity / context
    player: 'name',
    team: 'team',
    club: 'team',
    opposition: 'opposition',
    season: 'season',
    round: 'round',
    'round number': 'round',
    match_id: 'matchId',
    venue: 'venue',
    date: 'date',
    status: 'status',

    // UI core stats
    k: 'kicks',
    hb: 'handballs',
    m: 'marks',
    t: 'tackles',
    g: 'goals',
    ho: 'hitouts',
    cl: 'clearances',
    i50: 'inside50s',
    'inside 50s': 'inside50s',
    r50: 'rebound50s',
    'rebound 50s': 'rebound50s',
    ga: 'goalAssists',
    'goal assists': 'goalAssists',
    tog: 'timeOnGroundPct',
    'time on ground': 'timeOnGroundPct',
    'time on ground %': 'timeOnGroundPct',
    'time on ground pct': 'timeOnGroundPct',
    cp: 'contestedPossessions',
    'contested possessions': 'contestedPossessions',
    up: 'uncontestedPossessions',
    'uncontested possessions': 'uncontestedPossessions',
    ff: 'freesFor',
    'frees for': 'freesFor',
    fa: 'freesAgainst',
    'frees against': 'freesAgainst',
    'one.percenters': 'onePercenters',
    'one percenters': 'onePercenters',
    d: 'disposals',
    disposals: 'disposals',

    // extras (all of them)
    de: 'disposalEfficiency',
    ed: 'effectiveDisposals',
    bo: 'bounces',
    cm: 'contestedMarks',
    mi5: 'marksInside50',
    af: 'aflFantasy',
    sc: 'supercoach',
    ccl: 'centreClearances',
    scl: 'stoppageClearances',
    si: 'scoreInvolvements',
    mg: 'metresGained',
    to: 'turnovers',
    itc: 'intercepts',
    t5: 'tacklesInside50',
    cg: 'corridorGains',
  };

  if (map[cleaned]) return map[cleaned];

  // fallback: strip punctuation then camelCase spaces
  const generic = cleaned
    .replace(/[%.()]/g, '')
    .replace(/\s+([a-z0-9])/g, (_, c) => c.toUpperCase());
  return generic;
};

const normalizeKeys = (row: AnyObj): AnyObj => {
  const out: AnyObj = {};
  for (const [k, v] of Object.entries(row)) {
    out[normalizeKey(k)] = v;
  }
  return out;
};

const pick = <T = string>(obj: AnyObj, keys: string[], fb?: T): T | undefined => {
  for (const k of keys) if (obj[k] != null) return obj[k] as T;
  return fb;
};

// which keys should be exposed under player.stats as well
const STAT_KEYS = [
  'kicks', 'handballs', 'marks', 'tackles', 'goals', 'hitouts', 'clearances',
  'inside50s', 'rebound50s', 'clangers', 'contestedPossessions', 'uncontestedPossessions',
  'freesFor', 'freesAgainst', 'onePercenters', 'goalAssists', 'timeOnGroundPct',
  'disposalEfficiency', 'turnovers', 'intercepts', 'metresGained', 'contestedMarks',
  'effectiveDisposals', 'scoreInvolvements', 'bounces', 'centreClearances',
  'stoppageClearances', 'marksInside50', 'aflFantasy', 'supercoach', 'corridorGains',
];

// Map of short summary keys -> normalised field names
const SUMMARY_FIELDS: Record<string, string> = {
  MG: 'metresGained',
  CP: 'contestedPossessions',
  UP: 'uncontestedPossessions',
  DE: 'disposalEfficiency',
  ED: 'effectiveDisposals',
  CL: 'clangers',
  CCL: 'centreClearances',
  SCL: 'stoppageClearances',
  SI: 'scoreInvolvements',
  T5: 'tacklesInside50',
  MI5: 'marksInside50',
  ITC: 'intercepts',
  BO: 'bounces',
  GA: 'goalAssists',
  TOG: 'timeOnGroundPct',
};

async function loadAllPlayers(): Promise<Player[]> {
  if (_cache) return _cache;

  const filePath = path.join(process.cwd(), 'player_stats_2025.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const rows = JSON.parse(raw) as AnyObj[];

  // normalize keys per row
  const norm = rows.map(normalizeKeys);

  // group by (name, team) to gather all rows for each player
  const grouped = new Map<string, AnyObj[]>();
  for (const r of norm) {
    const name = (pick<string>(r, ['name', 'playerName', 'player']) ?? 'Unknown').toString();
    const team = (pick<string>(r, ['team', 'club']) ?? 'N/A').toString();
    const key = `${toSlug(name)}|${toSlug(team)}`;
    const arr = grouped.get(key);
    if (arr) arr.push(r); else grouped.set(key, [r]);
  }

  // build Player objects with unique ids + nested stats
  const players: Player[] = Array.from(grouped.values()).map((rows) => {
    // determine latest row by season/round
    let latest = rows[0];
    for (const r of rows.slice(1)) {
      const aS = Number(pick<string>(r, ['season'], '0'));
      const aR = Number(pick<string>(r, ['round', 'roundNumber'], '0'));
      const bS = Number(pick<string>(latest, ['season'], '0'));
      const bR = Number(pick<string>(latest, ['round', 'roundNumber'], '0'));
      const newer = aS > bS || (aS === bS && aR > bR);
      if (newer) latest = r;
    }

    const name = (pick<string>(latest, ['name', 'playerName', 'player'], 'Unknown') as string).toString();
    const team = (pick<string>(latest, ['team', 'club'], 'N/A') as string).toString();
    const position = (pick<string>(latest, ['position', 'pos'], '') as string).toString();

    const rawId =
      pick<string>(latest, ['id', 'player_id', 'playerId', 'aflId']) ??
      `${toSlug(name)}-${toSlug(team)}`;
    const id = rawId.toString();

    const stats: Record<string, unknown> = {};
    for (const key of STAT_KEYS) {
      if (key in latest) stats[key] = (latest as AnyObj)[key];
    }

    // compute games and summary
    const games = rows.length;
    const summary: Record<string, number> = {};
    for (const r of rows) {
      for (const [abbr, key] of Object.entries(SUMMARY_FIELDS)) {
        const val = Number((r as AnyObj)[key]);
        if (Number.isFinite(val)) summary[abbr] = (summary[abbr] ?? 0) + val;
      }
    }

    const injury = pick<string>(latest, ['injury']);

    return { id, name, team, position, games, injury, summary, ...(latest as AnyObj), stats } as Player;
  });

  players.sort((a, b) => a.name.localeCompare(b.name));
  _cache = players;
  return players;
}

export async function getPlayers(): Promise<Player[]> {
  return loadAllPlayers();
}

export async function getPlayer(id: string): Promise<Player | null> {
  const all = await loadAllPlayers();
  const exact = all.find((p) => p.id === id);
  if (exact) return exact;

  const byName = all.find((p) => toSlug(p.name) === id);
  return byName ?? null;
}

export async function getPlayerIds(): Promise<{ id: string }[]> {
  const all = await loadAllPlayers();
  return all.map((p) => ({ id: p.id }));
}