// src/lib/data.ts
import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Player } from '@/types';

// Simple in-memory cache for the JSON between requests in dev
let _cache: Player[] | null = null;

type AnyObj = Record<string, unknown>;

// Safely pluck a value from multiple candidate keys
const pick = <T = string>(obj: AnyObj, keys: string[], fallback?: T): T | undefined => {
  for (const k of keys) {
    if (obj[k] != null) return obj[k] as T;
  }
  return fallback;
};

async function loadAllPlayers(): Promise<Player[]> {
  if (_cache) return _cache;

  const filePath = path.join(process.cwd(), 'player_stats_2025.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const rows = JSON.parse(raw) as AnyObj[]; // assume array of records

  // Map loose source fields -> our Player shape
  const players: Player[] = rows.map((r) => {
    const id =
      (pick<string>(r, ['id', 'player_id', 'playerId', 'Player.Id']) ??
        pick<string>(r, ['name', 'player_name', 'Player', 'Player.Name'], '')
          ?.toString()
          .toLowerCase()
          .replace(/\s+/g, '-')) as string;

    const name = (pick<string>(r, ['name', 'player_name', 'Player', 'Player.Name'], 'Unknown') as string).toString();
    const team = (pick<string>(r, ['team', 'Team', 'club', 'Club'], 'N/A') as string).toString();
    const position = (pick<string>(r, ['position', 'Position', 'pos'], '') as string).toString();

    // copy the rest so stats still show up (disposals, kicks, etc)
    const rest = { ...r };

    return { id, name, team, position, ...(rest as Omit<Player, 'id' | 'name' | 'team' | 'position'>) } as Player;
  });

  // Sort by name for nicer UI
  players.sort((a, b) => a.name.localeCompare(b.name));
  _cache = players;
  return players;
}

export async function getPlayers(): Promise<Player[]> {
  return loadAllPlayers();
}

export async function getPlayer(id: string): Promise<Player | null> {
  const all = await loadAllPlayers();
  // try id match first; fall back to slug-from-name match
  const byId = all.find((p) => p.id === id);
  if (byId) return byId;

  const slug = id.toLowerCase();
  return (
    all.find((p) => p.name.toLowerCase().replace(/\s+/g, '-') === slug) ?? null
  );
}

export async function getPlayerIds(): Promise<{ id: string }[]> {
  const all = await loadAllPlayers();
  return all.map((p) => ({ id: p.id }));
}