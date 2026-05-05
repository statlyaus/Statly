import { buildCanonicalPlayerId } from './playerIdentity';
import { normalizeTeamName } from './teamNames';

export type PlayerDirectoryEntry = {
  id: string;
  name: string;
  normalizedName: string;
  normalizedTeam: string;
  position?: string;
};

export type PlayerDirectory = {
  byName: Map<string, PlayerDirectoryEntry>;
  byNameAndTeam: Map<string, PlayerDirectoryEntry>;
  ambiguousNames: Set<string>;
};

export type PlayerIdentityResolver = {
  directory: PlayerDirectory;
  canonicalIds: Set<string>;
};

const FIRST_NAME_VARIANTS: Record<string, string[]> = {
  alex: ['alexander'],
  brad: ['bradley'],
  cam: ['cameron'],
  harry: ['harrison'],
  josh: ['joshua'],
  lachie: ['lachlan'],
  matt: ['matthew'],
  mitch: ['mitchell'],
  nic: ['nicholas'],
  nick: ['nicholas'],
  ollie: ['oliver'],
  oliver: ['ollie'],
  sam: ['samuel'],
  tim: ['timothy'],
  tom: ['thomas'],
  zac: ['zach'],
  zach: ['zachary'],
};

const FULL_NAME_ALIASES: Record<string, string[]> = {
  'brad close': ['bradley close'],
  'harry himmelberg': ['harrison himmelberg'],
  'mitch knevitt': ['mitchell knevitt'],
  'connor o sullivan': ['connor osullivan'],
  'connor osullivan': ['connor o sullivan'],
  'massimo d ambrosio': ['massimo dambrosio'],
  'massimo dambrosio': ['massimo d ambrosio'],
  'nick holman': ['nicholas holman'],
  'oliver dempsey': ['ollie dempsey'],
  'robert hansen jr': ['robert hansen'],
  'sam collins': ['samuel collins'],
  'tom liberatore': ['thomas liberatore'],
  'zac williams': ['zachary williams'],
};

function normalizeNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.'-]/g, ' ')
    .replace(/\b(jr|sr)\b/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildSurnameInitialVariant(parts: string[]): string | null {
  if (parts.length < 3) return null;

  const [firstName, ...surnameParts] = parts;
  const terminalSurname = surnameParts.at(-1);
  const leadingSurnameParts = surnameParts.slice(0, -1).filter(Boolean);

  if (!firstName || !terminalSurname || leadingSurnameParts.length === 0) {
    return null;
  }

  const initials = leadingSurnameParts.map((part) => part[0]).filter(Boolean);
  if (initials.length === 0) return null;

  return [firstName, ...initials, terminalSurname].join(' ').trim();
}

export function normalizeLookupPart(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function normalizeTeamLookup(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const teamAlias =
    raw.toLowerCase() === 'greater western sydney'
      ? 'GWS'
      : raw.toLowerCase() === 'brisbane lions'
        ? 'Brisbane'
        : raw;
  const normalizedTeam = normalizeTeamName(teamAlias);
  return normalizeLookupPart(normalizedTeam || raw);
}

export function buildNameVariants(name: string): string[] {
  const normalized = normalizeNamePart(name);
  if (!normalized) return [];

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];

  const variants = new Set<string>([normalized]);
  const firstName = parts[0];
  const rest = parts.slice(1).join(' ');
  const surnameInitialVariant = buildSurnameInitialVariant(parts);

  if (surnameInitialVariant) {
    variants.add(surnameInitialVariant);
  }

  for (const variant of FIRST_NAME_VARIANTS[firstName] ?? []) {
    variants.add([variant, rest].filter(Boolean).join(' ').trim());
    if (surnameInitialVariant) {
      const [, ...surnameInitialParts] = surnameInitialVariant.split(/\s+/);
      variants.add([variant, ...surnameInitialParts].join(' ').trim());
    }
  }

  for (const [shortName, expandedNames] of Object.entries(FIRST_NAME_VARIANTS)) {
    if (expandedNames.includes(firstName)) {
      variants.add([shortName, rest].filter(Boolean).join(' ').trim());
      if (surnameInitialVariant) {
        const [, ...surnameInitialParts] = surnameInitialVariant.split(/\s+/);
        variants.add([shortName, ...surnameInitialParts].join(' ').trim());
      }
    }
  }

  for (const fullNameVariant of FULL_NAME_ALIASES[normalized] ?? []) {
    variants.add(fullNameVariant);
  }

  return Array.from(variants);
}

function registerPlayerEntry(directory: PlayerDirectory, entry: PlayerDirectoryEntry): void {
  const nameVariants = buildNameVariants(entry.name);

  for (const normalizedName of nameVariants) {
    if (entry.normalizedTeam) {
      directory.byNameAndTeam.set(`${normalizedName}|${entry.normalizedTeam}`, {
        ...entry,
        normalizedName,
      });
    }

    if (directory.ambiguousNames.has(normalizedName)) continue;
    if (!directory.byName.has(normalizedName)) {
      directory.byName.set(normalizedName, {
        ...entry,
        normalizedName,
      });
      continue;
    }

    const existing = directory.byName.get(normalizedName);
    if (existing?.id === entry.id) continue;

    directory.byName.delete(normalizedName);
    directory.ambiguousNames.add(normalizedName);
  }
}

export function createPlayerDirectory(
  players: Array<{
    id: string;
    name: string;
    team?: string | null | undefined;
    club?: string | null | undefined;
    position?: string | null | undefined;
  }>
): PlayerDirectory {
  const directory: PlayerDirectory = {
    byName: new Map(),
    byNameAndTeam: new Map(),
    ambiguousNames: new Set(),
  };

  for (const player of players) {
    const name = String(player.name ?? '').trim();
    if (!name) continue;

    registerPlayerEntry(directory, {
      id: String(player.id),
      name,
      normalizedName: normalizeLookupPart(name),
      normalizedTeam: normalizeTeamLookup(player.team ?? player.club),
      position:
        typeof player.position === 'string' && player.position.trim().length > 0
          ? player.position.trim()
          : undefined,
    });
  }

  return directory;
}

export function resolvePlayerDirectoryEntry(
  directory: PlayerDirectory,
  playerName: string,
  team?: string | null | undefined
): PlayerDirectoryEntry | null {
  const normalizedTeam = normalizeTeamLookup(team);
  for (const normalizedName of buildNameVariants(playerName)) {
    const exactTeamMatch = normalizedTeam
      ? directory.byNameAndTeam.get(`${normalizedName}|${normalizedTeam}`)
      : undefined;
    if (exactTeamMatch?.id) return exactTeamMatch;

    const byName = directory.byName.get(normalizedName);
    if (byName?.id) return byName;
  }

  return null;
}

export function resolveCanonicalPlayerId(
  directory: PlayerDirectory,
  playerName: string,
  team?: string | null | undefined
): string {
  return (
    resolvePlayerDirectoryEntry(directory, playerName, team)?.id ??
    buildCanonicalPlayerId(playerName)
  );
}

function readStringCandidate(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readProviderStylePlayerId(value: string | null): string | null {
  if (!value || !value.startsWith('ply_')) return null;
  const candidate = value.slice(4).trim();
  return candidate || null;
}

function readPlayerName(data: Record<string, unknown>): string | null {
  return (
    readStringCandidate(data.player_name) ??
    readStringCandidate(data.playerName) ??
    readStringCandidate(data.name)
  );
}

function readPlayerTeam(data: Record<string, unknown>): string | null {
  return (
    readStringCandidate(data.team) ??
    readStringCandidate(data.club) ??
    readStringCandidate(data.player_team)
  );
}

export function createPlayerIdentityResolver(
  players: Array<{
    id: string;
    name: string;
    team?: string | null | undefined;
    club?: string | null | undefined;
    position?: string | null | undefined;
  }>
): PlayerIdentityResolver {
  return {
    directory: createPlayerDirectory(players),
    canonicalIds: new Set(players.map((player) => String(player.id))),
  };
}

export function resolveCanonicalPlayerIdFromRecord(
  data: Record<string, unknown>,
  resolver: PlayerIdentityResolver
): string | null {
  const canonicalId = readCanonicalPlayerId(data);
  if (canonicalId && resolver.canonicalIds.has(canonicalId)) {
    return canonicalId;
  }

  const providerCandidates = [
    readProviderStylePlayerId(canonicalId),
    readProviderStylePlayerId(readStringCandidate(data.player_uid)),
    readProviderStylePlayerId(readStringCandidate(data.playerUid)),
  ];
  for (const candidate of providerCandidates) {
    if (candidate && resolver.canonicalIds.has(candidate)) {
      return candidate;
    }
  }

  const playerName = readPlayerName(data);
  if (!playerName) return null;

  const directoryEntry = resolvePlayerDirectoryEntry(
    resolver.directory,
    playerName,
    readPlayerTeam(data)
  );
  if (directoryEntry?.id) {
    return directoryEntry.id;
  }

  const slugFallback = buildCanonicalPlayerId(playerName);
  return resolver.canonicalIds.has(slugFallback) ? slugFallback : null;
}

export function readCanonicalPlayerId(data: Record<string, unknown>): string | null {
  const playerId =
    typeof data.playerId === 'string'
      ? data.playerId.trim()
      : typeof data.player_id === 'string'
        ? data.player_id.trim()
        : '';
  return playerId || null;
}

export function readCanonicalMatchKey(data: Record<string, unknown>): string {
  const matchId = String(
    data.match_id ?? data.matchId ?? data.match_uid ?? data.matchUid ?? ''
  ).trim();
  if (matchId) return matchId;
  const season = String(data.season ?? data.year ?? '').trim();
  const round = String(data.round_number ?? data.round ?? data.match_round ?? '').trim();
  const date = String(data.match_date ?? data.date ?? '').trim();
  const home = String(data.match_home_team ?? data.home_team ?? data.team ?? '')
    .trim()
    .toLowerCase();
  const away = String(data.match_away_team ?? data.away_team ?? data.opponent ?? '')
    .trim()
    .toLowerCase();
  return `${season}|${round}|${date}|${home}|${away}`;
}
