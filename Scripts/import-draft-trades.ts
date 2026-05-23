#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';

import '../src/lib/loadEnv';
import {
  DRAFT_IMPORT_META,
  DRAFT_TRADE_COLLECTIONS,
  type DraftTradeAssetDoc,
  type DraftClubTradeRefDoc,
  type DraftClubDoc,
  type DraftMetaCurrentVersionDoc,
  type DraftMetaAggregatesDoc,
  type DraftTradeDoc,
  type DraftTradeImportRunDoc,
  type DraftTradePartyDoc,
} from '../src/lib/draftTrades/contracts';
import {
  buildDraftAssetBaseId,
  buildDraftAssetIdWithHash,
  buildDraftPartyId,
} from '../src/lib/draftTrades/ids';

const MAX_BATCH_OPS = 450;
const MAX_ERROR_LOGS = 50;
const MAX_DATASET_ID_LENGTH = 64;
const DATASET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const PRESERVED_META_DOC_IDS = new Set<string>([
  DRAFT_IMPORT_META.importRunsDocId,
  'currentVersion',
]);

function initFirestore() {
  if (!getApps().length) {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    if (b64) {
      const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
        project_id?: string;
        projectId?: string;
        client_email?: string;
        clientEmail?: string;
        private_key?: string;
        privateKey?: string;
      };
      initializeApp({
        credential: cert({
          projectId: parsed.project_id ?? parsed.projectId,
          clientEmail: parsed.client_email ?? parsed.clientEmail,
          privateKey: String(parsed.private_key ?? parsed.privateKey ?? '').replace(/\\n/g, '\n'),
        }),
        projectId:
          parsed.project_id ??
          parsed.projectId ??
          process.env.FIREBASE_PROJECT_ID ??
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    } else {
      initializeApp({
        credential: applicationDefault(),
        projectId:
          process.env.GOOGLE_CLOUD_PROJECT ??
          process.env.GCLOUD_PROJECT ??
          process.env.FIREBASE_PROJECT_ID ??
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    }
  }
  return getFirestore();
}

type CsvRow = Record<string, string>;

type TradesCsvRow = {
  trade_id: string;
  year: string;
  seq_in_year: string;
  title: string;
  source_title: string;
  source_row: string;
  source_sha1: string;
};

type PartiesCsvRow = {
  trade_id: string;
  year: string;
  club_slug: string;
  club_name: string;
  row_order: string;
  assets_raw: string;
  expected: string;
  actual: string;
};

type AssetsCsvRow = {
  trade_id: string;
  year: string;
  club_slug: string;
  club_name: string;
  asset_index: string;
  asset_type: string;
  asset_text: string;
  player_name: string;
  pick_code: string;
  pick_number_given: string;
  pick_year: string;
  pick_round: string;
  pick_original_club: string;
  pick_number_actual: string;
  drafted_player: string;
  games: string;
  note: string;
};

type ImportInputPaths = {
  tradesPath: string;
  partiesPath: string;
  assetsPath: string;
};

type ParsedArgs = ImportInputPaths & {
  dryRun: boolean;
  datasetId: string;
  activate: boolean;
};

type DraftCollectionNames = {
  trades: string;
  clubs: string;
  meta: string;
};

type ImportTarget = {
  requestedDatasetId: string;
  targetDatasetId: string;
  collections: DraftCollectionNames;
  activate: boolean;
};

type TradeAggregate = {
  clubSlugs: Set<string>;
  clubNames: Set<string>;
  partyCount: number;
  assetCount: number;
  hasPlayers: boolean;
  hasPicks: boolean;
  hasFuturePicks: boolean;
  receivesByClub: Map<
    string,
    {
      clubSlug: string;
      clubName: string;
      assetCount: number;
      playerCount: number;
      pickCount: number;
      futurePickCount: number;
    }
  >;
};

type ClubAggregate = {
  clubSlug: string;
  clubName: string;
  tradeIds: Set<string>;
  partyCount: number;
  assetCount: number;
  firstYear: number | null;
  lastYear: number | null;
  tradeRefs: Map<string, DraftClubTradeRefDoc>;
};

type PlannedPartyDoc = {
  tradeId: string;
  partyId: string;
  doc: DraftTradePartyDoc;
};

type PlannedAssetDoc = {
  tradeId: string;
  assetId: string;
  doc: DraftTradeAssetDoc;
};

type PlannedClubTradeRefDoc = {
  clubSlug: string;
  tradeId: string;
  doc: DraftClubTradeRefDoc;
};

type DraftTradeImportPlan = {
  tradeDocs: DraftTradeDoc[];
  partyDocs: PlannedPartyDoc[];
  assetDocs: PlannedAssetDoc[];
  clubDocs: DraftClubDoc[];
  clubTradeRefDocs: PlannedClubTradeRefDoc[];
  aggregatesDoc: DraftMetaAggregatesDoc;
  pointerDoc: DraftMetaCurrentVersionDoc | null;
};

function printUsage(): void {
  console.log(`
Usage:
  tsx Scripts/import-draft-trades.ts [--dry-run] [--dataset=ID] [--activate] [--no-activate] [--trades=PATH] [--parties=PATH] [--assets=PATH]

Defaults:
  --trades=$HOME/Downloads/statly_trades.csv
  --parties=$HOME/Downloads/statly_trade_parties.csv
  --assets=$HOME/Downloads/statly_trade_assets.csv
  --dataset=live
  --activate defaults to true only for --dataset=live
`);
}

function normalizeDatasetId(value: string): string {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    throw new Error('dataset id cannot be empty');
  }
  if (normalized.length > MAX_DATASET_ID_LENGTH || !DATASET_ID_PATTERN.test(normalized)) {
    throw new Error(
      `dataset id must be ${MAX_DATASET_ID_LENGTH} characters or fewer and match ${DATASET_ID_PATTERN.source}`
    );
  }
  return normalized;
}

function parseArgs(argv: string[]): ParsedArgs {
  const home = process.env.HOME ?? '';
  const defaultDir = path.join(home, 'Downloads');
  let activateRequested = false;
  let noActivateRequested = false;
  const parsed: ParsedArgs = {
    dryRun: false,
    activate: false,
    datasetId: 'live',
    tradesPath: path.join(defaultDir, 'statly_trades.csv'),
    partiesPath: path.join(defaultDir, 'statly_trade_parties.csv'),
    assetsPath: path.join(defaultDir, 'statly_trade_assets.csv'),
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--activate') {
      activateRequested = true;
      continue;
    }
    if (arg === '--no-activate') {
      noActivateRequested = true;
      continue;
    }
    if (arg.startsWith('--dataset=')) {
      parsed.datasetId = normalizeDatasetId(arg.slice('--dataset='.length));
      continue;
    }
    if (arg.startsWith('--trades=')) {
      parsed.tradesPath = arg.slice('--trades='.length);
      continue;
    }
    if (arg.startsWith('--parties=')) {
      parsed.partiesPath = arg.slice('--parties='.length);
      continue;
    }
    if (arg.startsWith('--assets=')) {
      parsed.assetsPath = arg.slice('--assets='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.datasetId = normalizeDatasetId(parsed.datasetId);
  if (activateRequested && noActivateRequested) {
    throw new Error('--activate and --no-activate cannot be used together');
  }
  parsed.activate = activateRequested || (!noActivateRequested && parsed.datasetId === 'live');

  return parsed;
}

function getDatasetCollections(datasetId: string): DraftCollectionNames {
  const normalized = normalizeText(datasetId).toLowerCase();
  if (!normalized || normalized === 'live') {
    return {
      trades: DRAFT_TRADE_COLLECTIONS.trades,
      clubs: DRAFT_TRADE_COLLECTIONS.clubs,
      meta: DRAFT_TRADE_COLLECTIONS.meta,
    };
  }
  return {
    trades: `${DRAFT_TRADE_COLLECTIONS.trades}_${normalized}`,
    clubs: `${DRAFT_TRADE_COLLECTIONS.clubs}_${normalized}`,
    meta: `${DRAFT_TRADE_COLLECTIONS.meta}_${normalized}`,
  };
}

function createRunSeed(): string {
  const startedAt = Date.now();
  const entropy = createHash('sha1')
    .update(`${startedAt}:${process.pid}:${Math.random()}`)
    .digest('hex')
    .slice(0, 8);
  return `${startedAt}-${entropy}`;
}

function resolveImportTarget(args: ParsedArgs, runSeed: string): ImportTarget {
  if (!args.dryRun && args.datasetId === 'live' && !args.activate) {
    throw new Error('--dataset=live is a publish alias and cannot be used with --no-activate');
  }

  const targetDatasetId = args.activate ? `${args.datasetId}-${runSeed}` : args.datasetId;
  return {
    requestedDatasetId: args.datasetId,
    targetDatasetId,
    collections: getDatasetCollections(targetDatasetId),
    activate: args.activate,
  };
}

function sameCollections(a: DraftCollectionNames, b: DraftCollectionNames): boolean {
  return a.trades === b.trades && a.clubs === b.clubs && a.meta === b.meta;
}

function parseCsv(content: string): CsvRow[] {
  const rows: string[][] = [];
  let currentCell = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = i + 1 < content.length ? content[i + 1] : '';

    if (ch === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      currentRow.push(currentCell);
      currentCell = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentCell += ch;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((values) => {
    const out: CsvRow = {};
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i];
      if (!header) continue;
      out[header] = values[i] ?? '';
    }
    return out;
  });
}

function normalizeText(value: string): string {
  return value.trim();
}

function textOrNull(value: string): string | null {
  const v = normalizeText(value);
  return v.length > 0 ? v : null;
}

function parseRequiredInt(value: string, field: string): number {
  const n = Number.parseInt(normalizeText(value), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid integer for ${field}: "${value}"`);
  }
  return n;
}

function parseNullableNumber(value: string): number | null {
  const cleaned = normalizeText(value);
  if (cleaned.length === 0) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseNullableInt(value: string): number | null {
  const cleaned = normalizeText(value);
  if (cleaned.length === 0) return null;
  const n = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

function ensureTradeAgg(map: Map<string, TradeAggregate>, tradeId: string): TradeAggregate {
  const normalizedTradeId = normalizeText(tradeId);
  const existing = map.get(normalizedTradeId);
  if (existing) return existing;
  const created: TradeAggregate = {
    clubSlugs: new Set<string>(),
    clubNames: new Set<string>(),
    partyCount: 0,
    assetCount: 0,
    hasPlayers: false,
    hasPicks: false,
    hasFuturePicks: false,
    receivesByClub: new Map(),
  };
  map.set(normalizedTradeId, created);
  return created;
}

function csvRowsAs<T extends CsvRow>(rows: CsvRow[]): T[] {
  return rows as T[];
}

function ensureClubAgg(
  map: Map<string, ClubAggregate>,
  clubSlug: string,
  clubName: string
): ClubAggregate {
  const existing = map.get(clubSlug);
  if (existing) {
    if (!existing.clubName && clubName) {
      existing.clubName = clubName;
    }
    return existing;
  }

  const created: ClubAggregate = {
    clubSlug,
    clubName,
    tradeIds: new Set<string>(),
    partyCount: 0,
    assetCount: 0,
    firstYear: null,
    lastYear: null,
    tradeRefs: new Map<string, DraftClubTradeRefDoc>(),
  };
  map.set(clubSlug, created);
  return created;
}

function updateClubYearRange(club: ClubAggregate, year: number): void {
  if (!Number.isFinite(year)) return;
  if (club.firstYear == null || year < club.firstYear) {
    club.firstYear = year;
  }
  if (club.lastYear == null || year > club.lastYear) {
    club.lastYear = year;
  }
}

async function recursiveDelete(
  adminDb: Firestore,
  ref: CollectionReference | DocumentReference
): Promise<void> {
  await adminDb.recursiveDelete(ref);
}

async function purgeManagedDataset(
  adminDb: Firestore,
  collections: DraftCollectionNames
): Promise<void> {
  console.log('[draft-trades] purging managed target dataset', { collections });
  await Promise.all([
    recursiveDelete(adminDb, adminDb.collection(collections.trades)),
    recursiveDelete(adminDb, adminDb.collection(collections.clubs)),
  ]);

  const metaRefs = await adminDb.collection(collections.meta).listDocuments();
  await Promise.all(
    metaRefs
      .filter((ref) => !PRESERVED_META_DOC_IDS.has(ref.id))
      .map((ref) => recursiveDelete(adminDb, ref))
  );
}

async function assertTargetIsNotActive(
  adminDb: Firestore,
  collections: DraftCollectionNames
): Promise<void> {
  const pointerSnap = await adminDb
    .collection(DRAFT_TRADE_COLLECTIONS.meta)
    .doc('currentVersion')
    .get();

  if (!pointerSnap.exists) return;
  const data = pointerSnap.data() as { collections?: Partial<DraftCollectionNames> } | undefined;
  const activeCollections = data?.collections;
  if (
    activeCollections?.trades &&
    activeCollections?.clubs &&
    activeCollections?.meta &&
    sameCollections(collections, activeCollections as DraftCollectionNames)
  ) {
    throw new Error('Refusing to purge or write the currently active draft-trade dataset');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runSeed = createRunSeed();
  const runId = runSeed;
  const target = resolveImportTarget(args, runSeed);
  const adminDb = initFirestore();
  console.log('[draft-trades] starting import', {
    dryRun: args.dryRun,
    requestedDatasetId: target.requestedDatasetId,
    targetDatasetId: target.targetDatasetId,
    activate: target.activate,
    collections: target.collections,
    tradesPath: args.tradesPath,
    partiesPath: args.partiesPath,
    assetsPath: args.assetsPath,
  });

  const runRef = adminDb
    .collection(target.collections.meta)
    .doc(DRAFT_IMPORT_META.importRunsDocId)
    .collection(DRAFT_IMPORT_META.runsSubcollection)
    .doc(runId);

  if (!args.dryRun && !target.activate) {
    await assertTargetIsNotActive(adminDb, target.collections);
  }

  const draftRunDoc: DraftTradeImportRunDoc = {
    runId,
    status: 'running',
    schemaVersion: DRAFT_IMPORT_META.schemaVersion,
    source: {
      tradesPath: args.tradesPath,
      partiesPath: args.partiesPath,
      assetsPath: args.assetsPath,
      tradesSha1: null,
      partiesSha1: null,
      assetsSha1: null,
      combinedSha1: null,
    },
    counts: {
      trades: 0,
      parties: 0,
      assets: 0,
      clubs: 0,
      writeOps: 0,
      batches: 0,
    },
    errors: [],
    startedAt: FieldValue.serverTimestamp(),
  };

  if (!args.dryRun) {
    await runRef.set(draftRunDoc, { merge: true });
  }

  let source = draftRunDoc.source;
  let writeOps = 0;
  let batches = 0;
  let tradeWrites = 0;
  let partyWrites = 0;
  let assetWrites = 0;
  let clubWrites = 0;
  const errors: string[] = [];

  let batch = adminDb.batch();
  let opsInBatch = 0;

  async function flushBatch(): Promise<void> {
    if (opsInBatch === 0) return;
    if (!args.dryRun) {
      await batch.commit();
    }
    writeOps += opsInBatch;
    batches += 1;
    batch = adminDb.batch();
    opsInBatch = 0;
  }

  async function queueSet(ref: DocumentReference, data: object): Promise<void> {
    batch.set(ref, data);
    opsInBatch += 1;
    if (opsInBatch >= MAX_BATCH_OPS) {
      await flushBatch();
    }
  }

  try {
    const [tradesRaw, partiesRaw, assetsRaw] = await Promise.all([
      readFile(args.tradesPath, 'utf8'),
      readFile(args.partiesPath, 'utf8'),
      readFile(args.assetsPath, 'utf8'),
    ]);

    const tradesSha1 = sha1(tradesRaw);
    const partiesSha1 = sha1(partiesRaw);
    const assetsSha1 = sha1(assetsRaw);
    const combinedSha1 = sha1(`${tradesSha1}:${partiesSha1}:${assetsSha1}`);
    source = {
      tradesPath: args.tradesPath,
      partiesPath: args.partiesPath,
      assetsPath: args.assetsPath,
      tradesSha1,
      partiesSha1,
      assetsSha1,
      combinedSha1,
    };

    const tradesRows = csvRowsAs<TradesCsvRow>(parseCsv(tradesRaw));
    const partiesRows = csvRowsAs<PartiesCsvRow>(parseCsv(partiesRaw));
    const assetsRows = csvRowsAs<AssetsCsvRow>(parseCsv(assetsRaw));

    const tradeById = new Map<string, TradesCsvRow>();
    for (const row of tradesRows) {
      const tradeId = normalizeText(row.trade_id);
      tradeById.set(tradeId, row);
    }

    const tradeAggs = new Map<string, TradeAggregate>();
    const clubAggs = new Map<string, ClubAggregate>();
    for (const row of partiesRows) {
      const tradeId = normalizeText(row.trade_id);
      const trade = tradeById.get(tradeId);
      if (!trade) {
        throw new Error(`Party row references missing trade_id during aggregate build: ${tradeId}`);
      }
      const agg = ensureTradeAgg(tradeAggs, tradeId);
      agg.partyCount += 1;
      const clubSlug = normalizeText(row.club_slug);
      const clubName = normalizeText(row.club_name);
      const year = parseRequiredInt(row.year, 'parties.year');
      agg.clubSlugs.add(clubSlug);
      agg.clubNames.add(clubName);

      const clubAgg = ensureClubAgg(clubAggs, clubSlug, clubName);
      clubAgg.partyCount += 1;
      clubAgg.tradeIds.add(tradeId);
      updateClubYearRange(clubAgg, year);
      clubAgg.tradeRefs.set(tradeId, {
        tradeId,
        year,
        seqInYear: parseRequiredInt(trade.seq_in_year, 'trades.seq_in_year'),
        title: normalizeText(trade.title),
        clubSlug,
        clubName,
        assetsRaw: normalizeText(row.assets_raw),
        expected: parseNullableNumber(row.expected),
        actual: parseNullableNumber(row.actual),
        importVersion: DRAFT_IMPORT_META.schemaVersion,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    for (const row of assetsRows) {
      const tradeId = normalizeText(row.trade_id);
      if (!tradeById.has(tradeId)) {
        throw new Error(`Asset row references missing trade_id during aggregate build: ${tradeId}`);
      }
      const agg = ensureTradeAgg(tradeAggs, tradeId);
      agg.assetCount += 1;
      const rawAssetType = normalizeText(row.asset_type).toLowerCase();
      if (rawAssetType === 'player') {
        agg.hasPlayers = true;
      }
      if (rawAssetType === 'pick' || rawAssetType === 'future_pick') {
        agg.hasPicks = true;
      }
      if (rawAssetType === 'future_pick') {
        agg.hasFuturePicks = true;
      }
      const clubSlug = normalizeText(row.club_slug);
      const clubName = normalizeText(row.club_name);
      const receiveSummary = agg.receivesByClub.get(clubSlug) ?? {
        clubSlug,
        clubName,
        assetCount: 0,
        playerCount: 0,
        pickCount: 0,
        futurePickCount: 0,
      };
      receiveSummary.assetCount += 1;
      if (rawAssetType === 'player') receiveSummary.playerCount += 1;
      if (rawAssetType === 'pick') receiveSummary.pickCount += 1;
      if (rawAssetType === 'future_pick') receiveSummary.futurePickCount += 1;
      agg.receivesByClub.set(clubSlug, receiveSummary);
      const year = parseRequiredInt(row.year, 'assets.year');
      const clubAgg = ensureClubAgg(clubAggs, clubSlug, clubName);
      clubAgg.assetCount += 1;
      clubAgg.tradeIds.add(tradeId);
      updateClubYearRange(clubAgg, year);
    }

    const tradeDocs: DraftTradeDoc[] = tradesRows.map((row) => {
      const tradeId = normalizeText(row.trade_id);
      const agg = tradeAggs.get(tradeId);
      return {
        tradeId,
        year: parseRequiredInt(row.year, 'trades.year'),
        seqInYear: parseRequiredInt(row.seq_in_year, 'trades.seq_in_year'),
        title: normalizeText(row.title),
        source: {
          title: normalizeText(row.source_title),
          row: parseRequiredInt(row.source_row, 'trades.source_row'),
          sha1: normalizeText(row.source_sha1),
        },
        clubSlugs: agg ? Array.from(agg.clubSlugs).sort() : [],
        clubNames: agg ? Array.from(agg.clubNames).sort() : [],
        partyCount: agg?.partyCount ?? 0,
        assetCount: agg?.assetCount ?? 0,
        hasPlayers: agg?.hasPlayers ?? false,
        hasPicks: agg?.hasPicks ?? false,
        hasFuturePicks: agg?.hasFuturePicks ?? false,
        receivesByClub: agg
          ? Array.from(agg.receivesByClub.values()).sort((a, b) =>
              a.clubName.localeCompare(b.clubName)
            )
          : [],
        importVersion: DRAFT_IMPORT_META.schemaVersion,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
    });

    const partyDocs: PlannedPartyDoc[] = partiesRows.map((row) => {
      const tradeId = normalizeText(row.trade_id);
      const trade = tradeById.get(tradeId);
      if (!trade) {
        throw new Error(`Party row references missing trade_id: ${tradeId}`);
      }
      const rowOrder = parseRequiredInt(row.row_order, 'parties.row_order');
      const clubSlug = normalizeText(row.club_slug);
      return {
        tradeId,
        partyId: buildDraftPartyId(rowOrder, clubSlug),
        doc: {
          tradeId,
          year: parseRequiredInt(row.year, 'parties.year'),
          seqInYear: parseRequiredInt(trade.seq_in_year, 'trades.seq_in_year'),
          tradeTitle: normalizeText(trade.title),
          clubSlug,
          clubName: normalizeText(row.club_name),
          rowOrder,
          assetsRaw: normalizeText(row.assets_raw),
          expected: parseNullableNumber(row.expected),
          actual: parseNullableNumber(row.actual),
          importVersion: DRAFT_IMPORT_META.schemaVersion,
          updatedAt: FieldValue.serverTimestamp(),
        },
      };
    });

    const seenAssetIds = new Set<string>();
    const assetDocs: PlannedAssetDoc[] = assetsRows.map((row) => {
      const tradeId = normalizeText(row.trade_id);
      if (!tradeById.has(tradeId)) {
        throw new Error(`Asset row references missing trade_id: ${tradeId}`);
      }
      const clubSlug = normalizeText(row.club_slug);
      const assetIndex = parseRequiredInt(row.asset_index, 'assets.asset_index');
      const baseAssetId = buildDraftAssetBaseId(clubSlug, assetIndex);
      const scopeKey = `${tradeId}/${baseAssetId}`;

      let assetId = baseAssetId;
      if (seenAssetIds.has(scopeKey)) {
        assetId = buildDraftAssetIdWithHash(clubSlug, assetIndex, row.asset_text);
      }
      seenAssetIds.add(`${tradeId}/${assetId}`);

      const assetTypeRaw = normalizeText(row.asset_type).toLowerCase();
      const assetType: DraftTradeAssetDoc['assetType'] =
        assetTypeRaw === 'player' || assetTypeRaw === 'pick' || assetTypeRaw === 'future_pick'
          ? assetTypeRaw
          : 'unknown';

      return {
        tradeId,
        assetId,
        doc: {
          tradeId,
          year: parseRequiredInt(row.year, 'assets.year'),
          clubSlug,
          clubName: normalizeText(row.club_name),
          assetIndex,
          assetType,
          assetText: normalizeText(row.asset_text),
          playerName: textOrNull(row.player_name),
          pick: {
            code: textOrNull(row.pick_code),
            numberGiven: parseNullableInt(row.pick_number_given),
            year: parseNullableInt(row.pick_year),
            round: parseNullableInt(row.pick_round),
            originalClub: textOrNull(row.pick_original_club),
            numberActual: parseNullableInt(row.pick_number_actual),
          },
          draftedPlayer: textOrNull(row.drafted_player),
          games: parseNullableNumber(row.games),
          note: textOrNull(row.note),
          importVersion: DRAFT_IMPORT_META.schemaVersion,
          updatedAt: FieldValue.serverTimestamp(),
        },
      };
    });

    const clubDocs: DraftClubDoc[] = [];
    const clubTradeRefDocs: PlannedClubTradeRefDoc[] = [];
    for (const club of clubAggs.values()) {
      clubDocs.push({
        clubSlug: club.clubSlug,
        clubName: club.clubName,
        tradeCount: club.tradeIds.size,
        partyCount: club.partyCount,
        assetCount: club.assetCount,
        firstYear: club.firstYear,
        lastYear: club.lastYear,
        importVersion: DRAFT_IMPORT_META.schemaVersion,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      for (const tradeRefDoc of club.tradeRefs.values()) {
        clubTradeRefDocs.push({
          clubSlug: club.clubSlug,
          tradeId: tradeRefDoc.tradeId,
          doc: tradeRefDoc,
        });
      }
    }

    const tradeYears = Array.from(
      new Set(tradesRows.map((row) => parseRequiredInt(row.year, 'trades.year')))
    ).sort((a, b) => b - a);
    const plan: DraftTradeImportPlan = {
      tradeDocs,
      partyDocs,
      assetDocs,
      clubDocs,
      clubTradeRefDocs,
      aggregatesDoc: {
        tradeYears,
        importVersion: DRAFT_IMPORT_META.schemaVersion,
        updatedAt: FieldValue.serverTimestamp(),
      },
      pointerDoc:
        target.activate && !args.dryRun
          ? {
              datasetId: target.targetDatasetId,
              collections: {
                trades: target.collections.trades,
                clubs: target.collections.clubs,
                meta: target.collections.meta,
              },
              importVersion: DRAFT_IMPORT_META.schemaVersion,
              activatedAt: FieldValue.serverTimestamp(),
            }
          : null,
    };

    if (!args.dryRun) {
      await assertTargetIsNotActive(adminDb, target.collections);
      await purgeManagedDataset(adminDb, target.collections);
    }

    for (const tradeDoc of plan.tradeDocs) {
      await queueSet(adminDb.collection(target.collections.trades).doc(tradeDoc.tradeId), tradeDoc);
      tradeWrites += 1;
    }

    for (const planned of plan.partyDocs) {
      const partyRef = adminDb
        .collection(target.collections.trades)
        .doc(planned.tradeId)
        .collection('parties')
        .doc(planned.partyId);
      await queueSet(partyRef, planned.doc);
      partyWrites += 1;
    }

    for (const planned of plan.assetDocs) {
      const assetRef = adminDb
        .collection(target.collections.trades)
        .doc(planned.tradeId)
        .collection('assets')
        .doc(planned.assetId);
      await queueSet(assetRef, planned.doc);
      assetWrites += 1;
    }

    for (const clubDoc of plan.clubDocs) {
      await queueSet(adminDb.collection(target.collections.clubs).doc(clubDoc.clubSlug), clubDoc);
      clubWrites += 1;
    }

    for (const planned of plan.clubTradeRefDocs) {
      const tradeRef = adminDb
        .collection(target.collections.clubs)
        .doc(planned.clubSlug)
        .collection('tradeRefs')
        .doc(planned.tradeId);
      await queueSet(tradeRef, planned.doc);
    }

    await queueSet(adminDb.collection(target.collections.meta).doc('aggregates'), plan.aggregatesDoc);
    await flushBatch();

    if (plan.pointerDoc) {
      await queueSet(adminDb.collection(DRAFT_TRADE_COLLECTIONS.meta).doc('currentVersion'), plan.pointerDoc);
      await flushBatch();
    }

    const successUpdate: Partial<DraftTradeImportRunDoc> = {
      status: 'success',
      source,
      counts: {
        trades: tradeWrites,
        parties: partyWrites,
        assets: assetWrites,
        clubs: clubWrites,
        writeOps,
        batches,
      },
      errors,
      finishedAt: FieldValue.serverTimestamp(),
    };
    if (!args.dryRun) {
      await runRef.set(successUpdate, { merge: true });
    }

    console.log('[draft-trades] import complete', {
      runId,
      dryRun: args.dryRun,
      trades: tradeWrites,
      parties: partyWrites,
      assets: assetWrites,
      clubs: clubWrites,
      writeOps,
      batches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    const failureUpdate: Partial<DraftTradeImportRunDoc> = {
      status: 'failed',
      source,
      counts: {
        trades: tradeWrites,
        parties: partyWrites,
        assets: assetWrites,
        clubs: clubWrites,
        writeOps,
        batches,
      },
      errors: errors.slice(0, MAX_ERROR_LOGS),
      finishedAt: FieldValue.serverTimestamp(),
    };
    if (!args.dryRun) {
      await runRef.set(failureUpdate, { merge: true });
    }
    throw error;
  }
}

main().catch((error) => {
  console.error('[draft-trades] fatal import error', error);
  process.exit(1);
});
