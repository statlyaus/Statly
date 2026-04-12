export function buildCanonicalPlayerId(name: string): string {
  const normalized = String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return normalized || 'unknown_player';
}

function toSlug(value: string): string {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildLegacyPlayerSlug(name: string, team?: string): string {
  const nameSlug = toSlug(name);
  const teamSlug = toSlug(team ?? '');
  return teamSlug ? `${nameSlug}-${teamSlug}` : nameSlug;
}
