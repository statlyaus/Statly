import { createHash } from 'node:crypto';

import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';

const DRAFTGURU_ORIGIN = 'https://www.draftguru.com.au';
const MINIMUM_YEAR = 1988;
const MAXIMUM_YEAR = 2200;

type SourceCapture = AflTradeExternalEvidenceContent['capture'];

export interface DraftguruCrawlRange {
  fromYear: number;
  throughYear: number;
}

export interface DraftguruParseIssue {
  code:
    'invalid_page' | 'unsupported_asset' | 'unsupported_row' | 'unpaired_asset' | 'ambiguous_asset';
  sourceKey: string;
  detail: string;
}

export interface DraftguruTradeParseResult {
  evidence: AflTradeExternalEvidenceEnvelope[];
  issues: DraftguruParseIssue[];
}

function assertYear(year: number, field: string): void {
  if (!Number.isInteger(year) || year < MINIMUM_YEAR || year > MAXIMUM_YEAR) {
    throw new TypeError(`${field} must be an AFL trade-era year between 1988 and 2200.`);
  }
}

function assertRange(range: DraftguruCrawlRange): void {
  assertYear(range.fromYear, 'fromYear');
  assertYear(range.throughYear, 'throughYear');
  if (range.fromYear > range.throughYear) {
    throw new TypeError('fromYear must not be after throughYear.');
  }
  if (range.throughYear - range.fromYear > 100) {
    throw new TypeError('A Draftguru crawl plan may cover at most 101 years.');
  }
}

export function buildDraftguruCrawlPlan(range: DraftguruCrawlRange): string[] {
  assertRange(range);
  const urls = [`${DRAFTGURU_ORIGIN}/trades`];
  for (let year = range.fromYear; year <= range.throughYear; year += 1) {
    urls.push(`${DRAFTGURU_ORIGIN}/trades/year/${year}`, `${DRAFTGURU_ORIGIN}/years/${year}`);
  }
  return urls;
}

function exactDraftguruUrl(href: string): URL | null {
  try {
    const url = new URL(href, DRAFTGURU_ORIGIN);
    if (url.origin !== DRAFTGURU_ORIGIN || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function parseDraftguruTradeIndex(html: string, range: DraftguruCrawlRange): string[] {
  assertRange(range);
  const $ = load(html);
  const targets = new Set<string>();
  $('a[href]').each((_index, element) => {
    const url = exactDraftguruUrl($(element).attr('href') ?? '');
    if (!url) return;
    const match = /^\/trades\/(\d{4})-[^/]+$/.exec(url.pathname);
    if (!match) return;
    const year = Number(match[1]);
    if (year >= range.fromYear && year <= range.throughYear) targets.add(url.href);
  });
  return [...targets].sort((left, right) => left.localeCompare(right));
}

export function parseDraftguruTradeIndexEvidence(
  html: string,
  input: DraftguruCrawlRange & { capture: SourceCapture }
): DraftguruTradeParseResult {
  const urls = parseDraftguruTradeIndex(html, input);
  if (urls.length === 0) {
    return {
      evidence: [],
      issues: [
        {
          code: 'invalid_page',
          sourceKey: 'trade-index',
          detail: 'The captured Draftguru index contained no in-scope trade detail links.',
        },
      ],
    };
  }
  return {
    evidence: urls.map((sourceUrl, index) => {
      const nativeEventId = new URL(sourceUrl).pathname.slice('/trades/'.length);
      return createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'draftguru',
        capture: input.capture,
        sourceRow: { ordinal: index + 1, sourceKey: `trade-link:${nativeEventId}` },
        claim: {
          kind: 'trade_detail_link',
          nativeEventId,
          anchorSeasonYear: Number(nativeEventId.slice(0, 4)),
          sourceUrl,
        },
        publicationEligible: false,
      });
    }),
    issues: [],
  };
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceNativeId(href: string | undefined, prefix: string): string | null {
  if (!href) return null;
  const url = exactDraftguruUrl(href);
  if (!url || !url.pathname.startsWith(prefix)) return null;
  const value = url.pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '');
  return value || null;
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function expandCells($: CheerioAPI, row: AnyNode): Array<Cheerio<AnyNode> | null> {
  const cells: Array<Cheerio<AnyNode> | null> = [];
  $(row)
    .children('td')
    .each((_index, cell) => {
      const wrapped = $(cell);
      const span = Number.parseInt(wrapped.attr('colspan') ?? '1', 10);
      cells.push(wrapped);
      for (let offset = 1; offset < (Number.isFinite(span) ? span : 1); offset += 1)
        cells.push(null);
    });
  while (cells.length < 10) cells.push(null);
  return cells.slice(0, 10);
}

type ParsedAsset =
  | { kind: 'current_pick'; draftYear: number; draftType: 'national'; recordedPickNumber: number }
  | {
      kind: 'future_pick';
      draftYear: number;
      draftType: 'national';
      roundNumber: number;
      originalClub: { nativeId: null; recordedName: string };
    }
  | { kind: 'player'; player: { nativeId: string | null; recordedName: string } };

interface AssetOccurrence {
  fingerprint: string;
  clubName: string;
  direction: 'gave' | 'got';
  asset: ParsedAsset;
  sourceKey: string;
}

function parseSideAsset(
  $: CheerioAPI,
  cells: Array<Cheerio<AnyNode> | null>,
  start: number,
  draftYear: number
): { fingerprint: string; asset: ParsedAsset } | null {
  const side = cells
    .slice(start, start + 5)
    .filter((cell): cell is Cheerio<AnyNode> => cell !== null);
  const actualPick = side.find(
    (cell) => cell.hasClass('actual-asset') && cell.hasClass('pick-name')
  );
  if (actualPick) {
    const match = /^Pick\s+(\d+)$/i.exec(normalizeText(actualPick.text()));
    if (!match) return null;
    const number = Number(match[1]);
    return {
      fingerprint: `pick:${draftYear}:national:${number}`,
      asset: {
        kind: 'current_pick',
        draftYear,
        draftType: 'national',
        recordedPickNumber: number,
      },
    };
  }
  const actualFuturePick = side.find(
    (cell) => cell.hasClass('actual-asset') && cell.hasClass('future-pick-name')
  );
  if (actualFuturePick) {
    const match = /^(\d{4})R(\d+)\s+\(([^)]+)\)/i.exec(normalizeText(actualFuturePick.text()));
    if (!match) return null;
    const year = Number(match[1]);
    const round = Number(match[2]);
    const originalClubName = normalizeText(match[3]);
    if (
      !Number.isInteger(year) ||
      year <= draftYear ||
      year > MAXIMUM_YEAR ||
      !Number.isInteger(round) ||
      round <= 0 ||
      !originalClubName
    ) {
      return null;
    }
    return {
      fingerprint: `future-pick:${year}:national:${round}:${slug(originalClubName)}`,
      asset: {
        kind: 'future_pick',
        draftYear: year,
        draftType: 'national',
        roundNumber: round,
        originalClub: { nativeId: null, recordedName: originalClubName },
      },
    };
  }
  const actualPlayer = side.find(
    (cell) => cell.hasClass('actual-asset') && cell.hasClass('player-name')
  );
  if (actualPlayer) {
    const recordedName = normalizeText(actualPlayer.text());
    if (!recordedName) return null;
    const nativeId = sourceNativeId(actualPlayer.find('a').attr('href'), '/players/');
    return {
      fingerprint: `player:${nativeId ?? slug(recordedName)}`,
      asset: { kind: 'player', player: { nativeId, recordedName } },
    };
  }
  return null;
}

function eventIdFromCapture(capture: SourceCapture): string {
  const url = exactDraftguruUrl(capture.sourceUrl);
  const match = url && /^\/trades\/([^/]+)$/.exec(url.pathname);
  if (!match)
    throw new TypeError('Draftguru trade capture URL must identify one trade detail page.');
  return match[1];
}

export function parseDraftguruTradeDetail(
  html: string,
  input: { capture: SourceCapture; draftYear: number; effectiveAt: string }
): DraftguruTradeParseResult {
  assertYear(input.draftYear, 'draftYear');
  const $ = load(html);
  const eventId = eventIdFromCapture(input.capture);
  const title = normalizeText($('h2.heading').first().text());
  const table = $('table.individual-trade').first();
  if (!title || table.length !== 1) {
    return {
      evidence: [],
      issues: [{ code: 'invalid_page', sourceKey: eventId, detail: 'Trade heading/table absent.' }],
    };
  }

  const partyNames: string[] = [];
  const occurrences: AssetOccurrence[] = [];
  const issues: DraftguruParseIssue[] = [];
  let currentClub: string | null = null;
  table.find('tr').each((rowIndex, row) => {
    const wrapped = $(row);
    if (wrapped.hasClass('club-header')) {
      currentClub = normalizeText(wrapped.text());
      if (currentClub && !partyNames.includes(currentClub)) partyNames.push(currentClub);
      return;
    }
    if (!currentClub || !wrapped.hasClass('movement')) return;
    const cells = expandCells($, row);
    const gave = parseSideAsset($, cells, 0, input.draftYear);
    const got = parseSideAsset($, cells, 5, input.draftYear);
    const reportUnsupportedSide = (start: number, direction: 'gave' | 'got'): void => {
      if (start === 0 ? gave : got) return;
      const actualAsset = cells
        .slice(start, start + 5)
        .filter((cell): cell is Cheerio<AnyNode> => cell !== null)
        .find((cell) => cell.hasClass('actual-asset'));
      if (!actualAsset) return;
      issues.push({
        code: 'unsupported_asset',
        sourceKey: `${eventId}:row-${rowIndex + 1}:${direction}`,
        detail: `Unsupported or malformed asset: ${normalizeText(actualAsset.text())}`,
      });
    };
    reportUnsupportedSide(0, 'gave');
    reportUnsupportedSide(5, 'got');
    if (gave) {
      occurrences.push({
        ...gave,
        clubName: currentClub,
        direction: 'gave',
        sourceKey: `${eventId}:row-${rowIndex + 1}:gave`,
      });
    }
    if (got) {
      occurrences.push({
        ...got,
        clubName: currentClub,
        direction: 'got',
        sourceKey: `${eventId}:row-${rowIndex + 1}:got`,
      });
    }
  });

  let ordinal = 1;
  const evidence: AflTradeExternalEvidenceEnvelope[] = [];
  const create = (
    sourceKey: string,
    claim: AflTradeExternalEvidenceContent['claim']
  ): AflTradeExternalEvidenceEnvelope =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'draftguru',
      capture: input.capture,
      sourceRow: { ordinal: ordinal++, sourceKey },
      claim,
      publicationEligible: false,
    });

  evidence.push(
    create(eventId, {
      kind: 'transaction',
      nativeEventId: eventId,
      seasonYear: input.draftYear,
      occurredOn: null,
      transactionType: 'trade',
      title,
    })
  );
  partyNames.forEach((clubName) => {
    evidence.push(
      create(`${eventId}:party:${slug(clubName)}`, {
        kind: 'transaction_party',
        nativeEventId: eventId,
        nativePartyId: slug(clubName),
        club: { nativeId: null, recordedName: clubName },
      })
    );
  });

  const occurrencesByFingerprint = new Map<string, AssetOccurrence[]>();
  occurrences.forEach((occurrence) => {
    const values = occurrencesByFingerprint.get(occurrence.fingerprint) ?? [];
    values.push(occurrence);
    occurrencesByFingerprint.set(occurrence.fingerprint, values);
  });
  [...occurrencesByFingerprint.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([fingerprint, values]) => {
      const givers = values.filter((value) => value.direction === 'gave');
      const receivers = values.filter((value) => value.direction === 'got');
      if (givers.length !== 1 || receivers.length !== 1) {
        issues.push({
          code: values.length === 1 ? 'unpaired_asset' : 'ambiguous_asset',
          sourceKey: fingerprint,
          detail: `Expected one giving and one receiving side; found ${givers.length}/${receivers.length}.`,
        });
        return;
      }
      const giver = givers[0];
      const receiver = receivers[0];
      evidence.push(
        create(`${eventId}:transfer:${fingerprint}`, {
          kind: 'directed_transfer',
          nativeEventId: eventId,
          nativeTransferId: fingerprint,
          fromClub: { nativeId: null, recordedName: giver.clubName },
          toClub: { nativeId: null, recordedName: receiver.clubName },
          asset: giver.asset,
        })
      );
    });

  return { evidence, issues };
}

const draftTypeByLabel: Readonly<
  Record<string, AflTradeExternalEvidenceContent['claim'] extends infer _T ? string : never>
> = {
  National: 'national',
  Rookie: 'rookie',
  'Pre-Season': 'pre_season',
  'Mid-Season': 'mid_season',
  'Mini-Draft': 'mini_draft',
};

export function parseDraftguruYearSelections(
  html: string,
  input: { capture: SourceCapture; draftYear: number }
): DraftguruTradeParseResult {
  assertYear(input.draftYear, 'draftYear');
  const $ = load(html);
  const rows: AflTradeExternalEvidenceEnvelope[] = [];
  const issues: DraftguruParseIssue[] = [];
  $('table.big-pick-movements tbody tr').each((rowIndex, row) => {
    const wrapped = $(row);
    const draftLabel = normalizeText(wrapped.find('td.draft').text());
    const draftType = draftTypeByLabel[draftLabel] as
      'national' | 'rookie' | 'pre_season' | 'mid_season' | 'mini_draft' | undefined;
    const selectionNumber = Number.parseInt(normalizeText(wrapped.find('td.number').text()), 10);
    const playerCell = wrapped.find('td.player').first();
    const clubCell = wrapped.find('td.club').first();
    const playerName = normalizeText(playerCell.text());
    const clubName = normalizeText(clubCell.text());
    if (
      !draftType ||
      !Number.isInteger(selectionNumber) ||
      selectionNumber <= 0 ||
      !playerName ||
      !clubName
    ) {
      issues.push({
        code: 'unsupported_row',
        sourceKey: `year-row:${rowIndex + 1}`,
        detail: `Unsupported or incomplete draft row: ${normalizeText(wrapped.text())}`,
      });
      return;
    }
    rows.push(
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'draftguru',
        capture: input.capture,
        sourceRow: {
          ordinal: rows.length + 1,
          sourceKey: `${input.draftYear}:${draftType}:${selectionNumber}`,
        },
        claim: {
          kind: 'draft_selection',
          draftYear: input.draftYear,
          draftType,
          selectionNumber,
          roundNumber: null,
          player: {
            nativeId: sourceNativeId(playerCell.find('a').attr('href'), '/players/'),
            recordedName: playerName,
          },
          selectedByClub: {
            nativeId: sourceNativeId(clubCell.find('a').attr('href'), '/clubs/'),
            recordedName: clubName,
          },
        },
        publicationEligible: false,
      })
    );
  });
  return { evidence: rows, issues };
}

export interface DraftguruCaptureInput {
  url: string;
  fetchImpl: typeof fetch;
  maximumBytes: number;
  validators: { eTag: string | null; lastModified: string | null } | null;
  timeoutMs?: number;
}

export type DraftguruCaptureResult =
  | {
      status: 'not_modified';
      sourceUrl: string;
      eTag: string | null;
      lastModified: string | null;
    }
  | {
      status: 'captured';
      sourceUrl: string;
      bytes: Uint8Array;
      contentSha256: string;
      mediaType: string;
      eTag: string | null;
      lastModified: string | null;
    };

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Draftguru response body is absent.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel('maximum response size exceeded');
        throw new Error('Draftguru response exceeds the configured maximum bytes.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

export async function captureDraftguruSource(
  input: DraftguruCaptureInput
): Promise<DraftguruCaptureResult> {
  const url = exactDraftguruUrl(input.url);
  if (!url || !/^\/(?:trades(?:\/.*)?|years\/\d{4})$/.test(url.pathname)) {
    throw new TypeError('Draftguru capture URL is outside the approved bounded paths.');
  }
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes <= 0) {
    throw new TypeError('maximumBytes must be a positive safe integer.');
  }
  const headers = new Headers({ Accept: 'text/html,application/xhtml+xml' });
  if (input.validators?.eTag) headers.set('If-None-Match', input.validators.eTag);
  if (input.validators?.lastModified)
    headers.set('If-Modified-Since', input.validators.lastModified);
  const response = await input.fetchImpl(url.href, {
    method: 'GET',
    redirect: 'error',
    headers,
    signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
  });
  const eTag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  if (response.status === 304) {
    return { status: 'not_modified', sourceUrl: url.href, eTag, lastModified };
  }
  if (response.status !== 200) {
    throw new Error(`Draftguru capture returned unexpected status ${response.status}.`);
  }
  const mediaType = response.headers.get('content-type') ?? '';
  if (!/^text\/html\b/i.test(mediaType)) {
    throw new Error('Draftguru capture returned an unsupported content type.');
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > input.maximumBytes) {
      throw new Error('Draftguru response exceeds the configured maximum bytes.');
    }
  }
  const bytes = await readBoundedBody(response, input.maximumBytes);
  return {
    status: 'captured',
    sourceUrl: url.href,
    bytes,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    mediaType,
    eTag,
    lastModified,
  };
}
