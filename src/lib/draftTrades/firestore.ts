import 'server-only';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

import {
  DRAFT_TRADE_COLLECTIONS,
  type DraftClubListItem,
  type DraftClubTradeRefRow,
} from './contracts';
import {
  DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD,
  DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD,
} from './scalePolicy';

export interface DraftTradeListItem {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  clubSlugs: string[];
  clubNames: string[];
  partyCount: number;
  assetCount: number;
  hasPlayers: boolean;
  hasPicks: boolean;
  hasFuturePicks: boolean;
  receivesByClub: Array<{
    clubSlug: string;
    clubName: string;
    assetCount: number;
    playerCount: number;
    pickCount: number;
    futurePickCount: number;
  }>;
}

export interface DraftTradePartyItem {
  id: string;
  tradeId: string;
  year: number;
  seqInYear: number;
  tradeTitle: string;
  clubSlug: string;
  clubName: string;
  rowOrder: number;
  assetsRaw: string;
  expected: number | null;
  actual: number | null;
}

export interface DraftTradeAssetItem {
  id: string;
  tradeId: string;
  year: number;
  clubSlug: string;
  clubName: string;
  assetIndex: number;
  assetType: 'player' | 'pick' | 'future_pick' | 'unknown';
  assetText: string;
  playerName: string | null;
  pick: {
    code: string | null;
    numberGiven: number | null;
    year: number | null;
    round: number | null;
    originalClub: string | null;
    numberActual: number | null;
  };
  draftedPlayer: string | null;
  games: number | null;
  note: string | null;
}

export interface DraftTradeDetail {
  trade: DraftTradeListItem;
  parties: DraftTradePartyItem[];
  assets: DraftTradeAssetItem[];
}

/** @deprecated Use `DraftClubTradeRefRow` from `./contracts` (client-safe). */
export type DraftClubTradeRefItem = DraftClubTradeRefRow;

export type { DraftClubListItem };

type DraftCollectionNames = {
  trades: string;
  clubs: string;
  meta: string;
};

let cachedCollections: DraftCollectionNames | null = null;
let cachedCollectionsAt = 0;
const COLLECTION_CACHE_TTL_MS = 60_000;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function asReceivesByClub(value: unknown): DraftTradeListItem['receivesByClub'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      return {
        clubSlug: asString(record.clubSlug),
        clubName: asString(record.clubName),
        assetCount: asNumber(record.assetCount),
        playerCount: asNumber(record.playerCount),
        pickCount: asNumber(record.pickCount),
        futurePickCount: asNumber(record.futurePickCount),
      };
    })
    .filter(
      (item): item is DraftTradeListItem['receivesByClub'][number] =>
        item != null && item.clubSlug.length > 0
    );
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function defaultCollections(): DraftCollectionNames {
  return {
    trades: DRAFT_TRADE_COLLECTIONS.trades,
    clubs: DRAFT_TRADE_COLLECTIONS.clubs,
    meta: DRAFT_TRADE_COLLECTIONS.meta,
  };
}

async function resolveDraftCollections(): Promise<DraftCollectionNames> {
  const now = Date.now();
  if (cachedCollections && now - cachedCollectionsAt < COLLECTION_CACHE_TTL_MS) {
    return cachedCollections;
  }

  try {
    const pointerSnap = await adminDb
      .collection(DRAFT_TRADE_COLLECTIONS.meta)
      .doc('currentVersion')
      .get();
    if (pointerSnap.exists) {
      const data = pointerSnap.data() as Record<string, unknown>;
      const collections = data.collections as
        | { trades?: unknown; clubs?: unknown; meta?: unknown }
        | undefined;
      if (
        collections &&
        typeof collections.trades === 'string' &&
        typeof collections.clubs === 'string' &&
        typeof collections.meta === 'string'
      ) {
        cachedCollections = {
          trades: collections.trades,
          clubs: collections.clubs,
          meta: collections.meta,
        };
        cachedCollectionsAt = now;
        return cachedCollections;
      }
    }
  } catch {
    // Safe fallback below.
  }

  cachedCollections = defaultCollections();
  cachedCollectionsAt = now;
  return cachedCollections;
}

function mapTrade(id: string, data: Record<string, unknown>): DraftTradeListItem {
  return {
    tradeId: asString(data.tradeId) || id,
    year: asNumber(data.year),
    seqInYear: asNumber(data.seqInYear),
    title: asString(data.title),
    clubSlugs: asStringArray(data.clubSlugs),
    clubNames: asStringArray(data.clubNames),
    partyCount: asNumber(data.partyCount),
    assetCount: asNumber(data.assetCount),
    hasPlayers: asBoolean(data.hasPlayers),
    hasPicks: asBoolean(data.hasPicks),
    hasFuturePicks: asBoolean(data.hasFuturePicks),
    receivesByClub: asReceivesByClub(data.receivesByClub),
  };
}

function mapParty(id: string, data: Record<string, unknown>): DraftTradePartyItem {
  return {
    id,
    tradeId: asString(data.tradeId),
    year: asNumber(data.year),
    seqInYear: asNumber(data.seqInYear),
    tradeTitle: asString(data.tradeTitle),
    clubSlug: asString(data.clubSlug),
    clubName: asString(data.clubName),
    rowOrder: asNumber(data.rowOrder),
    assetsRaw: asString(data.assetsRaw),
    expected: asNumberOrNull(data.expected),
    actual: asNumberOrNull(data.actual),
  };
}

function mapAsset(id: string, data: Record<string, unknown>): DraftTradeAssetItem {
  const pick = (data.pick ?? {}) as Record<string, unknown>;
  const rawType = asString(data.assetType);
  const assetType: DraftTradeAssetItem['assetType'] =
    rawType === 'player' || rawType === 'pick' || rawType === 'future_pick' ? rawType : 'unknown';

  return {
    id,
    tradeId: asString(data.tradeId),
    year: asNumber(data.year),
    clubSlug: asString(data.clubSlug),
    clubName: asString(data.clubName),
    assetIndex: asNumber(data.assetIndex),
    assetType,
    assetText: asString(data.assetText),
    playerName: asStringOrNull(data.playerName),
    pick: {
      code: asStringOrNull(pick.code),
      numberGiven: asNumberOrNull(pick.numberGiven),
      year: asNumberOrNull(pick.year),
      round: asNumberOrNull(pick.round),
      originalClub: asStringOrNull(pick.originalClub),
      numberActual: asNumberOrNull(pick.numberActual),
    },
    draftedPlayer: asStringOrNull(data.draftedPlayer),
    games: asNumberOrNull(data.games),
    note: asStringOrNull(data.note),
  };
}

function mapClubTradeRef(data: Record<string, unknown>): DraftClubTradeRefRow {
  return {
    tradeId: asString(data.tradeId),
    year: asNumber(data.year),
    seqInYear: asNumber(data.seqInYear),
    title: asString(data.title),
    clubSlug: asString(data.clubSlug),
    clubName: asString(data.clubName),
    assetsRaw: asString(data.assetsRaw),
    expected: asNumberOrNull(data.expected),
    actual: asNumberOrNull(data.actual),
  };
}

export async function listDraftTradesByYear(
  year: number,
  options?: {
    clubSlug?: string;
    type?: 'player' | 'pick' | 'future_pick';
    q?: string;
  }
): Promise<DraftTradeListItem[]> {
  const collections = await resolveDraftCollections();
  const snap = await adminDb.collection(collections.trades).where('year', '==', year).get();

  const mapped = snap.docs
    .map((doc) => mapTrade(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => {
      if (a.seqInYear !== b.seqInYear) return a.seqInYear - b.seqInYear;
      return a.tradeId.localeCompare(b.tradeId);
    });
  const byClub = options?.clubSlug
    ? mapped.filter((trade) => trade.clubSlugs.includes(options.clubSlug as string))
    : mapped;

  const byType = options?.type
    ? byClub.filter((trade) => {
        if (options.type === 'player') return trade.hasPlayers;
        if (options.type === 'future_pick') return trade.hasFuturePicks;
        return trade.hasPicks;
      })
    : byClub;

  const q = options?.q?.trim().toLowerCase();
  if (!q) return byType;
  return byType.filter(
    (trade) =>
      trade.title.toLowerCase().includes(q) ||
      trade.clubNames.some((name) => name.toLowerCase().includes(q))
  );
}

export async function listDraftTradeYears(): Promise<number[]> {
  const collections = await resolveDraftCollections();
  const aggregatesSnap = await adminDb.collection(collections.meta).doc('aggregates').get();
  if (aggregatesSnap.exists) {
    const data = aggregatesSnap.data() as Record<string, unknown>;
    const numericYears = asNumberArray(data.tradeYears)
      .map((v) => Math.trunc(v))
      .filter((v) => v > 0);
    if (numericYears.length > 0) {
      return Array.from(new Set(numericYears)).sort((a, b) => b - a);
    }
  }

  const latestYear = await getLatestDraftTradeYear();
  if (!latestYear) return [];
  const years: number[] = [];
  for (let y = latestYear; y >= 1980; y -= 1) {
    years.push(y);
  }
  return years;
}

export async function getLatestDraftTradeYear(): Promise<number | null> {
  const collections = await resolveDraftCollections();
  const snap = await adminDb.collection(collections.trades).orderBy('year', 'desc').limit(1).get();

  if (snap.empty) return null;
  const data = snap.docs[0].data() as Record<string, unknown>;
  const year = asNumber(data.year);
  return year > 0 ? year : null;
}

export async function getDraftTradeById(tradeId: string): Promise<DraftTradeDetail | null> {
  const collections = await resolveDraftCollections();
  const tradeRef = adminDb.collection(collections.trades).doc(tradeId);
  const tradeSnap = await tradeRef.get();
  if (!tradeSnap.exists) return null;

  const [partiesSnap, assetsSnap] = await Promise.all([
    tradeRef.collection('parties').orderBy('rowOrder', 'asc').get(),
    tradeRef.collection('assets').orderBy('assetIndex', 'asc').get(),
  ]);

  const parties = partiesSnap.docs.map((doc) =>
    mapParty(doc.id, doc.data() as Record<string, unknown>)
  );
  const assets = assetsSnap.docs
    .map((doc) => mapAsset(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => {
      if (a.clubSlug === b.clubSlug) return a.assetIndex - b.assetIndex;
      return a.clubSlug.localeCompare(b.clubSlug);
    });

  return {
    trade: mapTrade(tradeSnap.id, tradeSnap.data() as Record<string, unknown>),
    parties,
    assets,
  };
}

export async function listDraftTradeRefsByClub(clubSlug: string): Promise<DraftClubTradeRefRow[]> {
  const collections = await resolveDraftCollections();
  const snap = await adminDb
    .collection(collections.clubs)
    .doc(clubSlug)
    .collection('tradeRefs')
    .get();

  const refs = snap.docs.map((doc) => mapClubTradeRef(doc.data() as Record<string, unknown>));
  refs.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return a.seqInYear - b.seqInYear;
  });

  const n = refs.length;
  if (n >= DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD) {
    logger.error('Draft club tradeRefs exceed critical threshold — add pagination or SQL mirror', {
      clubSlug,
      refCount: n,
      warnThreshold: DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD,
      criticalThreshold: DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD,
    });
  } else if (n >= DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD) {
    logger.warn('Draft club tradeRefs exceed warn threshold — review scale before next import', {
      clubSlug,
      refCount: n,
      warnThreshold: DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD,
    });
  }

  return refs;
}

export async function listDraftClubs(): Promise<DraftClubListItem[]> {
  const collections = await resolveDraftCollections();
  const snap = await adminDb.collection(collections.clubs).orderBy('clubName', 'asc').get();
  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      clubSlug: asString(data.clubSlug) || doc.id,
      clubName: asString(data.clubName),
      tradeCount: asNumber(data.tradeCount),
      partyCount: asNumber(data.partyCount),
      assetCount: asNumber(data.assetCount),
      firstYear: asNumberOrNull(data.firstYear),
      lastYear: asNumberOrNull(data.lastYear),
    };
  });
}
