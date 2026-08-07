import 'server-only';

import {
  getDevelopmentWorkbookDraftTradeReadRepository,
  type DraftTradeReadRepository,
} from './developmentWorkbook';
import {
  getDraftTradeById as getFirestoreDraftTradeById,
  listDraftClubs as listFirestoreDraftClubs,
  listDraftTradeRefsByClub as listFirestoreDraftTradeRefsByClub,
  listDraftTradesByYear as listFirestoreDraftTradesByYear,
  listDraftTradeYears as listFirestoreDraftTradeYears,
} from './firestore';

export type {
  DraftClubListItem,
  DraftClubTradeRefItem,
  DraftTradeAssetItem,
  DraftTradeDetail,
  DraftTradeListItem,
  DraftTradePartyItem,
} from './firestore';

const firestoreRepository: DraftTradeReadRepository = {
  listTradesByYear: listFirestoreDraftTradesByYear,
  listYears: listFirestoreDraftTradeYears,
  getById: getFirestoreDraftTradeById,
  listRefsByClub: listFirestoreDraftTradeRefsByClub,
  listClubs: listFirestoreDraftClubs,
};

async function resolveDraftTradeReadRepository(): Promise<DraftTradeReadRepository> {
  return (await getDevelopmentWorkbookDraftTradeReadRepository()) ?? firestoreRepository;
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
