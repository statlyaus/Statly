import { createHash } from 'node:crypto';
import { getTeamName } from '@/lib/teamLogos';
import { normalizePlayerName } from '@/server/players/footywirePositions';
import type { ParsedInjuryRow } from './footywireInjuryList';

/**
 * Links injury list rows to Statly players.
 *
 * Injuries are facts about AFL players, not about any league or season, so nothing here carries
 * league or season scope. Identity is exact: normalized name AND club must both agree with exactly
 * one player. Unlike `planPositionSync` there is deliberately no name-only fallback: an injury
 * attached to the wrong player benches a healthy one, so an unsure row stays unmatched.
 */

export type InjuryListMatchStatus = 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';

export interface InjuryListPlayer {
  id: string;
  name: string;
  club: string;
}

export interface MatchedInjuryRow extends ParsedInjuryRow {
  playerId: string | null;
  matchStatus: InjuryListMatchStatus;
}

function normalizeClub(value: string): string {
  return getTeamName(value.trim()).toLowerCase();
}

function identityKey(name: string, club: string): string {
  return `${normalizePlayerName(name)}|${normalizeClub(club)}`;
}

export function matchInjuryRowsToPlayers(
  rows: readonly ParsedInjuryRow[],
  players: readonly InjuryListPlayer[]
): MatchedInjuryRow[] {
  const byKey = new Map<string, string[]>();
  for (const player of players) {
    const key = identityKey(player.name, player.club);
    const ids = byKey.get(key) ?? [];
    ids.push(player.id);
    byKey.set(key, ids);
  }

  return rows.map((row) => {
    const candidates = byKey.get(identityKey(row.playerName, row.clubName)) ?? [];
    if (candidates.length === 1) {
      return { ...row, playerId: candidates[0], matchStatus: 'MATCHED' };
    }
    return {
      ...row,
      playerId: null,
      matchStatus: candidates.length === 0 ? 'UNMATCHED' : 'AMBIGUOUS',
    };
  });
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Hash of the parsed list, independent of row order and of player matching, so a re-fetch of the
 * same list hashes the same even after the player table changes. Only parsed fields are included,
 * in a fixed order; the raw HTML is not hashed because page chrome changes on every load.
 */
export function contentSha256(rows: readonly ParsedInjuryRow[]): string {
  const canonical = rows
    .map((row) => ({
      clubName: row.clubName,
      sourceKey: row.sourceKey,
      playerName: row.playerName,
      injuryRaw: row.injuryRaw,
      returnRaw: row.returnRaw,
      status: row.status,
      etaWeeksMin: row.etaWeeksMin,
      etaWeeksMax: row.etaWeeksMax,
      etaDaysMin: row.etaDaysMin,
      etaDaysMax: row.etaDaysMax,
    }))
    .sort((a, b) => compareText(a.clubName, b.clubName) || compareText(a.sourceKey, b.sourceKey));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
