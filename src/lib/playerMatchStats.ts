export type {
  PlayerDirectory,
  PlayerDirectoryEntry,
  PlayerIdentityResolver,
} from '@shared/player-identity/playerMatchStats';
export {
  buildNameVariants,
  createPlayerDirectory,
  createPlayerIdentityResolver,
  normalizeLookupPart,
  normalizeTeamLookup,
  readCanonicalMatchKey,
  readCanonicalPlayerId,
  resolveCanonicalPlayerId,
  resolveCanonicalPlayerIdFromRecord,
  resolvePlayerDirectoryEntry,
} from '@shared/player-identity/playerMatchStats';
