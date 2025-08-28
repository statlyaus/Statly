export class PlayerNameParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayerNameParseError';
  }
}

function titleCaseFromSlug(slug: string): string {
  const cleaned = String(slug || '').trim().replace(/[^a-z0-9_\s-]/gi, '');
  if (!cleaned) return '';
  return cleaned
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Supports known ID formats observed in the ETL:
// 1) `${season}-R${round}-${teamAbbr}-${oppAbbr}_ply_${slug}` → extract `${slug}`
// 2) `${playerKey}_${season}_${round}` → extract `${playerKey}`
// 3) Legacy: `${playerKey}_20xx_*` → extract `${playerKey}`
export function parsePlayerNameFromDocId(docId: string): string {
  const id = String(docId || '').trim();
  if (!id) {
    throw new PlayerNameParseError('Empty document id');
  }

  // Pattern 1: ..._ply_<slug>
  const plyMatch = id.match(/^.+_ply_([a-z0-9_]+)$/i);
  if (plyMatch && plyMatch[1]) {
    return titleCaseFromSlug(plyMatch[1]);
  }

  // Pattern 2: <playerKey>_<season>_<round>
  const simpleMatch = id.match(/^([a-z0-9_]+)_(20\d{2})_([1-9]\d?)$/i);
  if (simpleMatch && simpleMatch[1]) {
    return titleCaseFromSlug(simpleMatch[1]);
  }

  // Pattern 3: legacy like <playerKey>_20xx_...
  const legacyMatch = id.match(/^([a-z0-9_]+)_20\d{2}_.+$/i);
  if (legacyMatch && legacyMatch[1]) {
    return titleCaseFromSlug(legacyMatch[1]);
  }

  throw new PlayerNameParseError(`Unrecognized player_match_stats id format: ${id}`);
}

export function getCanonicalPlayerName(record: unknown, docId: string): string {
  const name = (record as { player_name?: unknown } | null)?.player_name;
  if (typeof name === 'string' && name.trim().length > 0) {
    return name.trim();
  }
  return parsePlayerNameFromDocId(docId);
}


