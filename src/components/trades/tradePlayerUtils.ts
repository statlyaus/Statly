import type { RosterPlayer } from '@/components/trades/tradeUiTypes';

export function displayPlayerName(p?: RosterPlayer) {
  if (!p) return 'Unknown';
  if (p.name && p.name.trim().toLowerCase() !== 'player') return p.name;
  return p.id ? String(p.id) : 'Unknown';
}

export function formatPlayerMeta(p?: RosterPlayer) {
  if (!p) return '';
  return [p.position, p.team].filter(Boolean).join(' · ');
}

export function formatPlayerDisplay(p?: RosterPlayer) {
  if (!p) return 'Unknown player';
  const name = displayPlayerName(p);
  const meta = formatPlayerMeta(p);
  return meta ? `${name} (${meta})` : name;
}

export function resolvePlayerMeta(
  playerId: string,
  fromUserId: string,
  cache: Record<string, RosterPlayer[]>
): RosterPlayer | undefined {
  const roster = cache[fromUserId];
  if (!roster) return undefined;
  return roster.find((p) => p.id === playerId);
}
