import { createHash } from 'node:crypto';

import type {
  DraftClubListItem,
  DraftClubTradeRefItem,
  DraftTradeAssetItem,
  DraftTradeDetail,
  DraftTradeListItem,
  DraftTradePartyItem,
} from '@/lib/draftTrades/firestore';

import {
  AflOutcomesDevelopmentWorkbookError,
  type AflOutcomesDevelopmentWorkbook,
} from './developmentWorkbookStructure';

export interface AflOutcomesDevelopmentTradeProjection {
  years: readonly number[];
  tradesByYear: ReadonlyMap<number, readonly DraftTradeListItem[]>;
  detailsById: ReadonlyMap<string, DraftTradeDetail>;
  clubs: readonly DraftClubListItem[];
  refsByClub: ReadonlyMap<string, readonly DraftClubTradeRefItem[]>;
}

interface MutableTrade {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  parties: DraftTradePartyItem[];
  assets: DraftTradeAssetItem[];
}

const FUTURE_PICK_PATTERN = /^#(\d{4})R(\d+)\b/i;
const PICK_PATTERN = /^#(\d+)\b/;

function slugifyClub(clubName: string): string {
  return clubName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function splitAssets(assetsRaw: string): string[] {
  return assetsRaw
    .split(/\s+\+\s+/)
    .map((asset) => asset.trim())
    .filter(Boolean);
}

function extractGames(assetText: string): number | null {
  const matches = Array.from(assetText.matchAll(/(\d+)\s+games?\b/gi));
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : null;
}

function extractParenthetical(assetText: string): string | null {
  return /\(([^()]*)\)/.exec(assetText)?.[1]?.trim() ?? null;
}

function extractDraftedPlayer(assetText: string): string | null {
  const inner = extractParenthetical(assetText);
  if (!inner || inner === '-') return null;
  const withoutActualPick = inner.replace(/^#\d+\s*-\s*/, '');
  const withoutGames = withoutActualPick.replace(/\s*-\s*\d+\s+games?\b.*$/i, '').trim();
  return withoutGames && withoutGames !== '-' ? withoutGames : null;
}

function createAsset(input: {
  tradeId: string;
  year: number;
  clubName: string;
  clubSlug: string;
  assetIndex: number;
  assetText: string;
}): DraftTradeAssetItem {
  const futurePick = FUTURE_PICK_PATTERN.exec(input.assetText);
  const pick = PICK_PATTERN.exec(input.assetText);
  const assetType: DraftTradeAssetItem['assetType'] = futurePick
    ? 'future_pick'
    : pick
      ? 'pick'
      : 'player';
  const inner = extractParenthetical(input.assetText);
  const actualPick = inner ? /^#(\d+)\b/.exec(inner) : null;
  const futureOriginalClub = futurePick && inner && inner !== '-' ? inner : null;
  const playerName = assetType === 'player' ? input.assetText.split('(')[0]?.trim() || null : null;

  return {
    id: `${input.tradeId}-${input.clubSlug}-${input.assetIndex}`,
    tradeId: input.tradeId,
    year: input.year,
    clubSlug: input.clubSlug,
    clubName: input.clubName,
    assetIndex: input.assetIndex,
    assetType,
    assetText: input.assetText,
    playerName,
    pick: {
      code: futurePick?.[0]?.slice(1) ?? pick?.[0]?.slice(1) ?? null,
      numberGiven: pick ? Number(pick[1]) : null,
      year: futurePick ? Number(futurePick[1]) : null,
      round: futurePick ? Number(futurePick[2]) : null,
      originalClub: futureOriginalClub,
      numberActual: actualPick ? Number(actualPick[1]) : null,
    },
    draftedPlayer: assetType === 'pick' ? extractDraftedPlayer(input.assetText) : null,
    games: extractGames(input.assetText),
    note: null,
  };
}

function createTradeId(year: number, title: string, partyRows: readonly [string, string][]) {
  const content = JSON.stringify([year, title, partyRows]);
  const suffix = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `workbook-${year}-${suffix}`;
}

function finalizeTrade(input: {
  year: number;
  seqInYear: number;
  title: string;
  partyRows: readonly [string, string][];
}): MutableTrade {
  const tradeId = createTradeId(input.year, input.title, input.partyRows);
  const parties: DraftTradePartyItem[] = [];
  const assets: DraftTradeAssetItem[] = [];

  input.partyRows.forEach(([clubName, assetsRaw], partyIndex) => {
    const clubSlug = slugifyClub(clubName);
    parties.push({
      id: `${tradeId}-${clubSlug}-${partyIndex + 1}`,
      tradeId,
      year: input.year,
      seqInYear: input.seqInYear,
      tradeTitle: input.title,
      clubSlug,
      clubName,
      rowOrder: partyIndex + 1,
      assetsRaw,
      expected: null,
      actual: null,
    });
    splitAssets(assetsRaw).forEach((assetText) => {
      assets.push(
        createAsset({
          tradeId,
          year: input.year,
          clubName,
          clubSlug,
          assetIndex: assets.length + 1,
          assetText,
        })
      );
    });
  });

  return {
    tradeId,
    year: input.year,
    seqInYear: input.seqInYear,
    title: input.title,
    parties,
    assets,
  };
}

function toListItem(trade: MutableTrade): DraftTradeListItem {
  const receivesByClub = trade.parties.map((party) => {
    const assets = trade.assets.filter((asset) => asset.clubSlug === party.clubSlug);
    return {
      clubSlug: party.clubSlug,
      clubName: party.clubName,
      assetCount: assets.length,
      playerCount: assets.filter(({ assetType }) => assetType === 'player').length,
      pickCount: assets.filter(({ assetType }) => assetType === 'pick').length,
      futurePickCount: assets.filter(({ assetType }) => assetType === 'future_pick').length,
    };
  });
  return {
    tradeId: trade.tradeId,
    year: trade.year,
    seqInYear: trade.seqInYear,
    title: trade.title,
    clubSlugs: trade.parties.map(({ clubSlug }) => clubSlug),
    clubNames: trade.parties.map(({ clubName }) => clubName),
    partyCount: trade.parties.length,
    assetCount: trade.assets.length,
    hasPlayers: trade.assets.some(({ assetType }) => assetType === 'player'),
    hasPicks: trade.assets.some(
      ({ assetType }) => assetType === 'pick' || assetType === 'future_pick'
    ),
    hasFuturePicks: trade.assets.some(({ assetType }) => assetType === 'future_pick'),
    receivesByClub,
  };
}

function parseTrades(workbook: AflOutcomesDevelopmentWorkbook): MutableTrade[] {
  const trades: MutableTrade[] = [];
  let activeYear: number | null = null;
  let title = '';
  let partyRows: Array<[string, string]> = [];
  let seqInYear = 0;

  const finish = () => {
    if (!title || activeYear === null) return;
    trades.push(finalizeTrade({ year: activeYear, seqInYear, title, partyRows }));
    title = '';
    partyRows = [];
  };

  for (const row of workbook.tradeSheet.rows.slice(1)) {
    const [label, assets] = row.cells;
    if (/^\d{4}$/.test(label) && !assets) {
      finish();
      activeYear = Number(label);
      seqInYear = 0;
      continue;
    }
    if (!assets) {
      finish();
      title = label;
      seqInYear += 1;
      continue;
    }
    partyRows.push([label, assets]);
  }
  finish();
  return trades;
}

export function projectAflOutcomesDevelopmentWorkbookTrades(
  workbook: AflOutcomesDevelopmentWorkbook
): AflOutcomesDevelopmentTradeProjection {
  const mutableTrades = parseTrades(workbook);
  if (mutableTrades.length !== workbook.tradeSheet.tradeCount) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'INVALID_TRADE_SHEET',
      'Projected trade count does not match the validated workbook trade count.'
    );
  }

  const tradesByYear = new Map<number, DraftTradeListItem[]>();
  const detailsById = new Map<string, DraftTradeDetail>();
  const refsByClub = new Map<string, DraftClubTradeRefItem[]>();
  const clubCounters = new Map<
    string,
    DraftClubListItem & { tradeIds: Set<string>; years: number[] }
  >();

  for (const trade of mutableTrades) {
    const listItem = toListItem(trade);
    if (detailsById.has(trade.tradeId)) {
      throw new AflOutcomesDevelopmentWorkbookError(
        'INVALID_TRADE_SHEET',
        `Trade sheet produces duplicate stable id ${trade.tradeId}.`
      );
    }
    detailsById.set(trade.tradeId, {
      trade: listItem,
      parties: trade.parties,
      assets: trade.assets,
    });
    const yearTrades = tradesByYear.get(trade.year) ?? [];
    yearTrades.push(listItem);
    tradesByYear.set(trade.year, yearTrades);

    for (const party of trade.parties) {
      const refs = refsByClub.get(party.clubSlug) ?? [];
      refs.push({
        tradeId: trade.tradeId,
        year: trade.year,
        seqInYear: trade.seqInYear,
        title: trade.title,
        clubSlug: party.clubSlug,
        clubName: party.clubName,
        assetsRaw: party.assetsRaw,
        expected: null,
        actual: null,
      });
      refsByClub.set(party.clubSlug, refs);

      const club = clubCounters.get(party.clubSlug) ?? {
        clubSlug: party.clubSlug,
        clubName: party.clubName,
        tradeCount: 0,
        partyCount: 0,
        assetCount: 0,
        firstYear: null,
        lastYear: null,
        tradeIds: new Set<string>(),
        years: [],
      };
      club.tradeIds.add(trade.tradeId);
      club.partyCount += 1;
      club.assetCount += trade.assets.filter(({ clubSlug }) => clubSlug === party.clubSlug).length;
      club.years.push(trade.year);
      clubCounters.set(party.clubSlug, club);
    }
  }

  for (const trades of tradesByYear.values()) {
    trades.sort((left, right) => left.seqInYear - right.seqInYear);
  }
  for (const refs of refsByClub.values()) {
    refs.sort((left, right) => right.year - left.year || left.seqInYear - right.seqInYear);
  }

  const clubs = Array.from(clubCounters.values())
    .map(({ tradeIds, years, ...club }) => ({
      ...club,
      tradeCount: tradeIds.size,
      firstYear: Math.min(...years),
      lastYear: Math.max(...years),
    }))
    .sort((left, right) => left.clubName.localeCompare(right.clubName));

  return {
    years: Array.from(tradesByYear.keys()).sort((left, right) => right - left),
    tradesByYear,
    detailsById,
    clubs,
    refsByClub,
  };
}
