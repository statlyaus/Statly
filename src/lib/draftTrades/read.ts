import 'server-only';

import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';

import type {
  DraftClubListItem,
  DraftClubTradeRefItem,
  DraftTradeDetail,
  DraftTradeListItem,
} from './firestore';

export type {
  DraftClubListItem,
  DraftClubTradeRefItem,
  DraftTradeAssetItem,
  DraftTradeDetail,
  DraftTradeListItem,
  DraftTradePartyItem,
} from './firestore';

/**
 * Why the public archive is (or is not) serving records. `active` means a governed release is
 * selected; the other values come from the release selector and are never shown as "not imported".
 */
export type DraftTradeReleaseAvailability =
  'active' | 'no_active_release' | 'source_blocked' | 'gate2_blocked';

export interface DraftTradeReadRepository {
  listTradesByYear(
    year: number,
    options?: {
      clubSlug?: string;
      type?: 'player' | 'pick' | 'future_pick';
      q?: string;
    }
  ): Promise<DraftTradeListItem[]>;
  listYears(): Promise<number[]>;
  getById(tradeId: string): Promise<DraftTradeDetail | null>;
  listRefsByClub(clubSlug: string): Promise<DraftClubTradeRefItem[]>;
  listClubs(): Promise<DraftClubListItem[]>;
  searchTrades(query: string, limit: number): Promise<DraftTradeListItem[]>;
  releaseAvailability(): Promise<DraftTradeReleaseAvailability>;
}

async function resolveDraftTradeReadRepository(): Promise<DraftTradeReadRepository> {
  return (await getPublicAflTradeReadRuntime()).archiveReadRepository;
}

export async function listDraftTradesByYear(
  year: number,
  options?: {
    clubSlug?: string;
    type?: 'player' | 'pick' | 'future_pick';
    q?: string;
  }
) {
  return (await resolveDraftTradeReadRepository()).listTradesByYear(year, options);
}

export async function listDraftTradeYears() {
  return (await resolveDraftTradeReadRepository()).listYears();
}

export async function getLatestDraftTradeYear(): Promise<number | null> {
  return (await listDraftTradeYears())[0] ?? null;
}

export async function getDraftTradeById(tradeId: string) {
  return (await resolveDraftTradeReadRepository()).getById(tradeId);
}

export async function listDraftTradeRefsByClub(clubSlug: string) {
  return (await resolveDraftTradeReadRepository()).listRefsByClub(clubSlug);
}

export async function listDraftClubs() {
  return (await resolveDraftTradeReadRepository()).listClubs();
}

export async function searchDraftTradeArchive(query: string, limit: number) {
  return (await resolveDraftTradeReadRepository()).searchTrades(query, limit);
}

export async function getDraftTradeReleaseAvailability() {
  return (await resolveDraftTradeReadRepository()).releaseAvailability();
}
