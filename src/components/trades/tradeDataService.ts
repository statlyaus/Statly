import type { TradeDetails, TradeSummary } from '@/components/trades/tradeApi';
import { getTrade, listTrades } from '@/components/trades/tradeApi';
import type { RosterPlayer } from '@/components/trades/tradeUiTypes';
import { fetchApi } from '@/lib/api';

export type LeagueMember = {
  id: string;
  userId: string;
  teamName: string;
};

export function createRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function isHttp404Error(err: unknown): boolean {
  return err instanceof Error && /HTTP\s*404/i.test(err.message);
}

export function normalizeMembers(payload: unknown): LeagueMember[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = payload as Record<string, unknown>;
  const data = raw.data ?? raw;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const member = item as Record<string, unknown>;
      const id = String(member.id ?? '');
      const userId = String(member.userId ?? '');
      const teamName = String(member.teamName ?? '');
      if (!id || !userId || !teamName) return null;
      return { id, userId, teamName };
    })
    .filter((item): item is LeagueMember => Boolean(item));
}

export function normalizeRosterPlayers(payload: unknown): RosterPlayer[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = payload as Record<string, unknown>;
  const data = raw.data ?? raw;
  const roster = (data as Record<string, unknown>)?.roster;
  const players = (roster as Record<string, unknown>)?.players;
  if (!Array.isArray(players)) return [];
  const normalized: RosterPlayer[] = [];
  for (const player of players) {
    if (!player || typeof player !== 'object') continue;
    const row = player as Record<string, unknown>;
    const id = String(row.id ?? '');
    if (!id) continue;
    const name = row.name ? String(row.name) : id;
    const position = row.position ? String(row.position) : undefined;
    const team = row.team ? String(row.team) : undefined;
    const stats =
      row.stats && typeof row.stats === 'object'
        ? (row.stats as Record<string, unknown>)
        : undefined;
    normalized.push({ id, name, position, team, stats });
  }
  return normalized;
}

export async function fetchLeagueMembers(leagueId: string): Promise<LeagueMember[]> {
  const response = await fetchApi(`leagues/${leagueId}/members`);
  return normalizeMembers(response);
}

export async function fetchLeagueRoster(leagueId: string, userId: string): Promise<RosterPlayer[]> {
  const response = await fetchApi(`leagues/${leagueId}/roster/${userId}`);
  return normalizeRosterPlayers(response);
}

export async function fetchLeagueTrades(leagueId: string): Promise<TradeSummary[]> {
  return listTrades(leagueId);
}

export async function fetchTradeDetails(tradeId: string): Promise<TradeDetails | null> {
  return getTrade(tradeId);
}

export async function submitTradeRequest(params: {
  requestId: string;
  leagueId: string;
  recipientUserId: string;
  parentTradeId: string | null;
  items: Array<{ fromUserId: string; toUserId: string; playerId: string }>;
}): Promise<string | undefined> {
  const response = await fetchApi('trades', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return (response as { data?: { tradeId?: string } })?.data?.tradeId;
}
