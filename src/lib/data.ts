// src/lib/data.ts
import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Player } from '@/types';

let _cache: Player[] | null = null;

type AnyObj = Record<string, unknown>;

const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const normalizeKey = (k: string) => {
  // basic normalize: lower, remove spaces/%/dots, camel-ish
  const cleaned = k
    .toLowerCase()
    .replace(/[%().]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // map common stat labels -> camelCase your UI expects
  const map: Record<string, string> = {
    'inside 50s': 'inside50s',
    'goal assists': 'goalAssists',
    'time on ground': 'timeOnGroundPct',
    'time on ground pct': 'timeOnGroundPct',
    disposals: 'disposals',
    kicks: 'kicks',
    handballs: 'handballs',
    marks: 'marks',
    tackles: 'tackles',
    goals: 'goals',
    hitouts: 'hitouts',
    clearances: 'clearances',
    clangers: 'clangers',
    'contested possessions': 'contestedPossessions',
    'uncontested possessions': 'uncontestedPossessions',
    'frees for': 'freesFor',
    'frees against': 'freesAgainst',
    'one percenters': 'onePercenters',
  };
  if (map[cleaned]) return map[cleaned];

  // generic camel-ish fallback
  return cleaned.replace(/\s+([a-z0-9])/g, (_, c) => c.toUpperCase());
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

async function loadAllPlayers(): Promise<Player[]> {
  if (_cache) return _cache;

  const filePath = path.join(process.cwd(), 'player_stats_2025.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const rows = JSON.parse(raw) as AnyObj[];

  // 1) normalize keys on every row so stats line up with UI labels
  const norm = rows.map(normalizeKeys);

  // 2) group by (name, team) and keep the "latest" (by season then round if present)
  const byKey = new Map<string, AnyObj>();
  for (const r of norm) {
    const name = (pick<string>(r, ['name', 'playerName', 'player']) ?? 'Unknown').toString();
    const team = (pick<string>(r, ['team', 'club']) ?? 'N/A').toString();
    const key = `${toSlug(name)}|${toSlug(team)}`;

    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, r);
      continue;
    }
    const aS = Number(pick<string>(r, ['season'], '0'));
    const aR = Number(pick<string>(r, ['round', 'roundNumber'], '0'));
    const bS = Number(pick<string>(cur, ['season'], '0'));
    const bR = Number(pick<string>(cur, ['round', 'roundNumber'], '0'));
    const newer = aS > bS || (aS === bS && aR > bR);
    if (newer) byKey.set(key, r);
  }

  // 3) build unique Player objects
  const players: Player[] = Array.from(byKey.values()).map((r) => {
    const name = (pick<string>(r, ['name', 'playerName', 'player'], 'Unknown') as string).toString();
    const team = (pick<string>(r, ['team', 'club'], 'N/A') as string).toString();
    const position = (pick<string>(r, ['position', 'pos'], '') as string).toString();

    // Prefer real id if present; else slug(name-team)
    const rawId =
      pick<string>(r, ['id', 'player_id', 'playerId', 'aflId']) ??
      `${toSlug(name)}-${toSlug(team)}`;
    const id = rawId.toString();

    // pass through stats (already normalized)
    return { id, name, team, position, ...(r as AnyObj) } as Player;
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

  // allow old links: slug(name) fallback
  const byName = all.find((p) => toSlug(p.name) === id);
  return byName ?? null;
}

export async function getPlayerIds(): Promise<{ id: string }[]> {
  const all = await loadAllPlayers();
  return all.map((p) => ({ id: p.id }));
}