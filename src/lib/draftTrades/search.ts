import 'server-only';

import { searchDraftTradeArchive, type DraftTradeListItem } from './read';

export interface DraftTradeSearchResult {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  clubNames: string[];
  clubSlugs: string[];
}

function toSearchResult(trade: DraftTradeListItem): DraftTradeSearchResult {
  return {
    tradeId: trade.tradeId,
    year: trade.year,
    seqInYear: trade.seqInYear,
    title: trade.title,
    clubNames: trade.clubNames,
    clubSlugs: trade.clubSlugs,
  };
}

export async function searchDraftTrades(
  query: string,
  limit = 50
): Promise<DraftTradeSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) return [];
  const boundedLimit = Math.max(1, Math.min(limit, 200));
  return (await searchDraftTradeArchive(normalizedQuery, boundedLimit)).map(toSearchResult);
}
