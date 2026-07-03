const ALLOWED_DATA_URL_PREFIXES = [
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/webp;base64,',
] as const;

const INVALID_TEAM_SYMBOL_MESSAGE =
  'Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL';

export const MAX_TEAM_SYMBOL_DATA_URL_LENGTH = 120_000;
export const DEFAULT_TEAM_SYMBOL_POSITION = 50;

export function normalizeTeamSymbolUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value !== 'string') {
    throw new Error(INVALID_TEAM_SYMBOL_MESSAGE);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:')) {
    if (!ALLOWED_DATA_URL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
      throw new Error(INVALID_TEAM_SYMBOL_MESSAGE);
    }

    if (trimmed.length > MAX_TEAM_SYMBOL_DATA_URL_LENGTH) {
      throw new Error('Uploaded team symbol is too large');
    }

    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(INVALID_TEAM_SYMBOL_MESSAGE);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(INVALID_TEAM_SYMBOL_MESSAGE);
  }

  return parsed.toString();
}

export function normalizeTeamSymbolPosition(
  value: unknown,
  fallback = DEFAULT_TEAM_SYMBOL_POSITION
): number {
  if (value === null || value === undefined || value === '') return fallback;

  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;

  return Math.max(0, Math.min(100, Math.round(parsed)));
}
