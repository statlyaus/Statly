import { buildCanonicalPlayerId } from '@/lib/playerIdentity';

export interface WaiverIdentityPlayer {
  id: string;
  name: string;
  club: string | null;
  position?: string | null;
}

export interface WaiverPlayerIdentityGroup<T extends WaiverIdentityPlayer> {
  key: string;
  representative: T;
  aliases: T[];
}

export function buildWaiverPlayerIdentityKey(
  player: Pick<WaiverIdentityPlayer, 'name' | 'club'>
): string {
  return `${buildCanonicalPlayerId(player.name)}|${buildCanonicalPlayerId(player.club)}`;
}

export function groupWaiverPlayersByIdentity<T extends WaiverIdentityPlayer>(
  players: readonly T[]
): WaiverPlayerIdentityGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const player of players) {
    const key = buildWaiverPlayerIdentityKey(player);
    const aliases = groups.get(key);
    if (aliases) aliases.push(player);
    else groups.set(key, [player]);
  }

  return [...groups.entries()]
    .map(([key, aliases]) => {
      const sortedAliases = [...aliases].sort(compareWaiverPlayerRepresentatives);
      return {
        key,
        representative: sortedAliases[0],
        aliases: sortedAliases,
      };
    })
    .sort((left, right) => left.representative.id.localeCompare(right.representative.id));
}

export function normalizeAvailableWaiverPlayers<T extends WaiverIdentityPlayer>(
  players: readonly T[],
  unavailablePlayerIds: ReadonlySet<string>
): T[] {
  return groupWaiverPlayersByIdentity(players)
    .filter((group) => group.aliases.every((player) => !unavailablePlayerIds.has(player.id)))
    .map((group) => group.representative);
}

export function findWaiverPlayerAliasIds<T extends WaiverIdentityPlayer>(
  players: readonly T[],
  requestedPlayerId: string
): string[] {
  const group = groupWaiverPlayersByIdentity(players).find((candidate) =>
    candidate.aliases.some((player) => player.id === requestedPlayerId)
  );

  return group?.aliases.map((player) => player.id) ?? [];
}

function compareWaiverPlayerRepresentatives<T extends WaiverIdentityPlayer>(left: T, right: T) {
  const canonicalId = buildCanonicalPlayerId(left.name);
  const leftCanonical = left.id === canonicalId;
  const rightCanonical = right.id === canonicalId;
  if (leftCanonical !== rightCanonical) return leftCanonical ? -1 : 1;

  const leftHasPosition = Boolean(left.position?.trim());
  const rightHasPosition = Boolean(right.position?.trim());
  if (leftHasPosition !== rightHasPosition) return leftHasPosition ? -1 : 1;

  return left.id.localeCompare(right.id);
}
