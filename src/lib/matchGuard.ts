export type MatchLike = {
  id?: string;
  match_uid?: string;
  matchUid?: string;
  match_id?: string;
  data_source?: string;
  season?: unknown;
  round_number?: unknown;
};

export function isRealMatch(doc: MatchLike): boolean {
  const id = String(doc.id ?? doc.matchUid ?? doc.match_uid ?? doc.match_id ?? '');
  if (id.startsWith('match_')) return false;
  if (doc.data_source === 'mock') return false;

  const seasonOk =
    typeof doc.season === 'number' ||
    (typeof doc.season === 'string' && doc.season.trim() !== '');
  const roundOk =
    typeof doc.round_number === 'number' ||
    (typeof doc.round_number === 'string' && doc.round_number.trim() !== '');
  return seasonOk && roundOk;
}
