const UNKNOWN_PLAYER_ID = 'unknown_player';

function buildStableHash(value: string): string {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }

  return hash.toString(36);
}

export function buildCanonicalPlayerId(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const normalized = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized) {
    return normalized;
  }

  if (!raw) {
    return UNKNOWN_PLAYER_ID;
  }

  return `${UNKNOWN_PLAYER_ID}_${buildStableHash(raw)}`;
}
