import type { DraftClubTradeRefRow } from '@/lib/draftTrades/contracts';

export function normalizeDraftClubSearchQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowSearchBlob(ref: DraftClubTradeRefRow): string {
  return [
    ref.title,
    ref.assetsRaw,
    String(ref.year),
    String(ref.seqInYear),
    ref.tradeId,
    ref.clubName,
    ref.clubSlug,
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Client-side filter for club trade history. Tokens are ANDed (all must appear).
 * Suitable while ref counts stay in the low thousands; for global / typo-tolerant search,
 * use a dedicated index (see `scalePolicy.ts`).
 */
export function filterClubTradeRefs(
  refs: DraftClubTradeRefRow[],
  q: string
): DraftClubTradeRefRow[] {
  const normalized = normalizeDraftClubSearchQuery(q);
  if (!normalized) return refs;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return refs;

  return refs.filter((ref) => {
    const hay = rowSearchBlob(ref);
    return tokens.every((t) => hay.includes(t));
  });
}
