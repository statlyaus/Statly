const UNKNOWN_PLAYER_ID = 'unknown_player';

function encodeCodePoints(value: string): string {
  return Array.from(value)
    .map((character) => character.codePointAt(0)?.toString(36))
    .filter(Boolean)
    .join('_');
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

  return `${UNKNOWN_PLAYER_ID}_${encodeCodePoints(raw)}`;
}
