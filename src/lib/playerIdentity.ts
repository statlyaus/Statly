const UNKNOWN_PLAYER_ID = 'unknown_player';

export function buildCanonicalPlayerId(value: string | null | undefined): string {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || UNKNOWN_PLAYER_ID;
}
