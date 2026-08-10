import { createHash } from 'node:crypto';

import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';

const FOOTYWIRE_ORIGIN = 'https://www.footywire.com';
const DRAFT_PATH = '/afl/footy/ft_drafts';
const MINIMUM_YEAR = 1897;
const MAXIMUM_YEAR = 2200;

export type FootywireDraftType = 'national' | 'rookie' | 'pre_season' | 'mid_season';
type SourceCapture = AflTradeExternalEvidenceContent['capture'];

const pathwayCode = {
  national: 'N',
  rookie: 'R',
  pre_season: 'P',
  mid_season: 'M',
} as const satisfies Readonly<Record<FootywireDraftType, string>>;

const draftTypeByCode = new Map<string, FootywireDraftType>(
  Object.entries(pathwayCode).map(([draftType, code]) => [code, draftType as FootywireDraftType])
);

export interface FootywireDraftCrawlPlanInput {
  fromYear: number;
  throughYear: number;
  draftTypes: readonly FootywireDraftType[];
}

export interface FootywireDraftParseIssue {
  code: 'invalid_page' | 'invalid_selection_row';
  sourceKey: string;
  detail: string;
}

export interface FootywireDraftParseResult {
  evidence: AflTradeExternalEvidenceEnvelope[];
  issues: FootywireDraftParseIssue[];
}

function assertYear(year: number, field: string): void {
  if (!Number.isInteger(year) || year < MINIMUM_YEAR || year > MAXIMUM_YEAR) {
    throw new TypeError(`${field} must be an AFL-era year between 1897 and 2200.`);
  }
}

function exactDraftUrl(value: string): { url: URL; year: number; draftType: FootywireDraftType } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Footywire draft URL is invalid.');
  }
  const queryKeys = [...url.searchParams.keys()];
  const yearText = url.searchParams.get('year');
  const code = url.searchParams.get('t');
  const draftType = code ? draftTypeByCode.get(code) : undefined;
  const year = Number(yearText);
  if (
    url.protocol !== 'https:' ||
    url.origin !== FOOTYWIRE_ORIGIN ||
    url.pathname !== DRAFT_PATH ||
    url.username ||
    url.password ||
    url.hash ||
    queryKeys.length !== 2 ||
    new Set(queryKeys).size !== 2 ||
    !queryKeys.includes('year') ||
    !queryKeys.includes('t')
  ) {
    throw new TypeError('Footywire capture URL is outside the approved bounded draft path.');
  }
  assertYear(year, 'year');
  if (yearText !== String(year) || !draftType) {
    throw new TypeError('Footywire draft pathway query is unsupported.');
  }
  return { url, year, draftType };
}

export function buildFootywireDraftCrawlPlan(input: FootywireDraftCrawlPlanInput): string[] {
  assertYear(input.fromYear, 'fromYear');
  assertYear(input.throughYear, 'throughYear');
  if (input.fromYear > input.throughYear) throw new TypeError('fromYear must precede throughYear.');
  if (input.throughYear - input.fromYear > 100) {
    throw new TypeError('A Footywire draft crawl may cover at most 101 years.');
  }
  if (input.draftTypes.length === 0 || new Set(input.draftTypes).size !== input.draftTypes.length) {
    throw new TypeError('draftTypes must be a non-empty unique pathway list.');
  }
  const urls: string[] = [];
  for (let year = input.fromYear; year <= input.throughYear; year += 1) {
    input.draftTypes.forEach((draftType) => {
      urls.push(`${FOOTYWIRE_ORIGIN}${DRAFT_PATH}?year=${year}&t=${pathwayCode[draftType]}`);
    });
  }
  return urls;
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nativeLinkId($: CheerioAPI, cell: AnyNode, prefix: 'th-' | 'pp-'): string | null {
  const href = $(cell).find('a').first().attr('href');
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, `${FOOTYWIRE_ORIGIN}${DRAFT_PATH}`);
  } catch {
    return null;
  }
  if (url.origin !== FOOTYWIRE_ORIGIN || url.search || url.hash) return null;
  const segment = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  return segment.startsWith(prefix) ? segment : null;
}

function draftRows($: CheerioAPI): AnyNode[] | null {
  for (const table of $('table').toArray()) {
    const header = $(table).find('tr').first();
    const labels = header
      .children('td')
      .toArray()
      .map((cell) => normalizeText($(cell).text()));
    if (
      labels.length === 6 &&
      labels[0] === 'Round' &&
      labels[1] === 'Pick' &&
      labels[2] === 'Drafted By' &&
      labels[3] === 'Player'
    ) {
      return $(table).find('tr.darkcolor, tr.lightcolor').toArray();
    }
  }
  return null;
}

export function parseFootywireDraftSelections(
  html: string,
  input: { capture: SourceCapture }
): FootywireDraftParseResult {
  const { year, draftType } = exactDraftUrl(input.capture.sourceUrl);
  const $ = load(html);
  const rows = draftRows($);
  if (!rows) {
    return {
      evidence: [],
      issues: [
        { code: 'invalid_page', sourceKey: `${year}:${draftType}`, detail: 'Draft table absent.' },
      ],
    };
  }
  const evidence: AflTradeExternalEvidenceEnvelope[] = [];
  const issues: FootywireDraftParseIssue[] = [];
  rows.forEach((row, index) => {
    const sourceKey = `row:${index + 1}`;
    const cells = $(row).children('td').toArray();
    const roundNumber = Number.parseInt(normalizeText($(cells[0]).text()), 10);
    const selectionNumber = Number.parseInt(normalizeText($(cells[1]).text()), 10);
    const clubName = normalizeText($(cells[2]).text());
    const playerName = normalizeText($(cells[3]).clone().find('span').remove().end().text());
    if (
      cells.length < 6 ||
      !Number.isInteger(roundNumber) ||
      roundNumber <= 0 ||
      !Number.isInteger(selectionNumber) ||
      selectionNumber <= 0 ||
      !clubName ||
      !playerName
    ) {
      issues.push({
        code: 'invalid_selection_row',
        sourceKey,
        detail: 'Round, pick, drafted club, or player is absent or invalid.',
      });
      return;
    }
    evidence.push(
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'footywire',
        capture: input.capture,
        sourceRow: {
          ordinal: evidence.length + 1,
          sourceKey: `${year}:${draftType}:${selectionNumber}`,
        },
        claim: {
          kind: 'draft_selection',
          draftYear: year,
          draftType,
          selectionNumber,
          roundNumber,
          player: { nativeId: nativeLinkId($, cells[3]!, 'pp-'), recordedName: playerName },
          selectedByClub: { nativeId: nativeLinkId($, cells[2]!, 'th-'), recordedName: clubName },
        },
        publicationEligible: false,
      })
    );
  });
  return { evidence, issues };
}

export interface FootywireDraftCaptureInput {
  url: string;
  fetchImpl: typeof fetch;
  maximumBytes: number;
  validators: { eTag: string | null; lastModified: string | null } | null;
  timeoutMs?: number;
}

export type FootywireDraftCaptureResult =
  | { status: 'not_modified'; sourceUrl: string; eTag: string | null; lastModified: string | null }
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
  if (!response.body) throw new Error('Footywire response body is absent.');
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
        throw new Error('Footywire response exceeds the configured maximum bytes.');
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

export async function captureFootywireDraftSource(
  input: FootywireDraftCaptureInput
): Promise<FootywireDraftCaptureResult> {
  const { url } = exactDraftUrl(input.url);
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
  if (response.status === 304)
    return { status: 'not_modified', sourceUrl: url.href, eTag, lastModified };
  if (response.status !== 200)
    throw new Error(`Footywire capture returned status ${response.status}.`);
  const mediaType = response.headers.get('content-type') ?? '';
  if (!/^text\/html\b/i.test(mediaType))
    throw new Error('Footywire capture returned unsupported content type.');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > input.maximumBytes) {
      throw new Error('Footywire response exceeds the configured maximum bytes.');
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
