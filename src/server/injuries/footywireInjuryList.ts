import { load } from 'cheerio';

import { FOOTYWIRE_INJURY_LIST_URL } from './injuryListConstants';

/**
 * Reads the Footywire AFL injury list.
 *
 * The page has one table per club, headed by a `td.tbtitle` cell such as "Brisbane Lions (5
 * Players)", then one `tr.darkcolor` or `tr.lightcolor` row per player: a link to the player page
 * (its slug is Footywire's player key), the injury, and the estimated return. The parser fails
 * closed: any row it cannot read in full, or a club whose row count disagrees with its header,
 * rejects the whole page rather than storing a partial list.
 */

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type InjuryReturnStatus =
  'TEST' | 'TBC' | 'SEASON' | 'PROTOCOLS' | 'WEEKS' | 'DAYS' | 'UNKNOWN';

export interface ReturnTimeframe {
  status: InjuryReturnStatus;
  etaWeeksMin: number | null;
  etaWeeksMax: number | null;
  etaDaysMin: number | null;
  etaDaysMax: number | null;
}

export interface ParsedInjuryRow extends ReturnTimeframe {
  /** Club label as Footywire shows it, e.g. "Brisbane Lions". */
  clubName: string;
  /** Footywire player slug from the row link, e.g. "pp-brisbane-lions--jack-payne". */
  sourceKey: string;
  playerName: string;
  injuryRaw: string;
  returnRaw: string;
}

export class FootywireInjuryListParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FootywireInjuryListParseError';
  }
}

function timeframe(
  status: InjuryReturnStatus,
  eta: Partial<Omit<ReturnTimeframe, 'status'>> = {}
): ReturnTimeframe {
  return {
    status,
    etaWeeksMin: eta.etaWeeksMin ?? null,
    etaWeeksMax: eta.etaWeeksMax ?? null,
    etaDaysMin: eta.etaDaysMin ?? null,
    etaDaysMax: eta.etaDaysMax ?? null,
  };
}

/**
 * Normalizes Footywire's "Returning" text. Same rules and precedence as the legacy
 * `/api/ingest-injuries` parser, so stored statuses keep their meaning.
 */
export function normalizeReturnTimeframe(returnRaw: string): ReturnTimeframe {
  const normalized = (returnRaw ?? '').toLowerCase().trim();
  if (!normalized) return timeframe('UNKNOWN');

  if (normalized === 'test') return timeframe('TEST');
  if (normalized === 'tbc' || normalized === 'to be confirmed') return timeframe('TBC');
  if (normalized.includes('season')) return timeframe('SEASON');
  if (normalized.includes('protocol') || normalized.includes('concussion')) {
    return timeframe('PROTOCOLS');
  }

  const weekRange = normalized.match(/(\d+)\s*-\s*(\d+)\s*weeks?/);
  if (weekRange) {
    return timeframe('WEEKS', {
      etaWeeksMin: Number.parseInt(weekRange[1], 10),
      etaWeeksMax: Number.parseInt(weekRange[2], 10),
    });
  }
  const weeksPlus = normalized.match(/(\d+)\+\s*weeks?/);
  if (weeksPlus) {
    return timeframe('WEEKS', { etaWeeksMin: Number.parseInt(weeksPlus[1], 10) });
  }
  const weeks = normalized.match(/(\d+)\s*weeks?/);
  if (weeks) {
    const value = Number.parseInt(weeks[1], 10);
    return timeframe('WEEKS', { etaWeeksMin: Math.max(1, value), etaWeeksMax: value });
  }

  const dayRange = normalized.match(/(\d+)\s*-\s*(\d+)\s*days?/);
  if (dayRange) {
    return timeframe('DAYS', {
      etaDaysMin: Number.parseInt(dayRange[1], 10),
      etaDaysMax: Number.parseInt(dayRange[2], 10),
    });
  }
  const daysPlus = normalized.match(/(\d+)\+\s*days?/);
  if (daysPlus) {
    return timeframe('DAYS', { etaDaysMin: Number.parseInt(daysPlus[1], 10) });
  }
  const days = normalized.match(/(\d+)\s*days?/);
  if (days) {
    const value = Number.parseInt(days[1], 10);
    return timeframe('DAYS', { etaDaysMin: Math.max(1, value), etaDaysMax: value });
  }

  return timeframe('UNKNOWN');
}

// JavaScript \s includes the non-breaking spaces Footywire pads its cells with.
function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const CLUB_TITLE = /^(.+?)\s*\((\d+)\s+Players?\)$/i;
const PLAYER_HREF = /^\/afl\/footy\/(pp-[^/?#\s]+--[^/?#\s]+)$/;

export function parseFootywireInjuryList(html: string): ParsedInjuryRow[] {
  const $ = load(html);
  const titles = $('td.tbtitle').toArray();
  if (titles.length === 0) {
    throw new FootywireInjuryListParseError('No club tables found on the Footywire injury list');
  }

  const rows: ParsedInjuryRow[] = [];
  const seenKeys = new Set<string>();
  for (const title of titles) {
    const titleText = cleanText($(title).text());
    const titleMatch = titleText.match(CLUB_TITLE);
    if (!titleMatch) {
      throw new FootywireInjuryListParseError(`Unrecognised club header "${titleText}"`);
    }
    const clubName = titleMatch[1];
    const declared = Number.parseInt(titleMatch[2], 10);

    const playerRows = $(title).closest('table').find('tr.darkcolor, tr.lightcolor').toArray();
    if (playerRows.length !== declared) {
      throw new FootywireInjuryListParseError(
        `${clubName} declares ${declared} players but has ${playerRows.length} rows`
      );
    }

    for (const playerRow of playerRows) {
      const cells = $(playerRow).children('td').toArray();
      if (cells.length !== 3) {
        throw new FootywireInjuryListParseError(
          `${clubName} row has ${cells.length} cells, expected 3`
        );
      }
      const link = $(cells[0]).find('a').first();
      const href = (link.attr('href') ?? '').trim();
      const sourceKey = href.match(PLAYER_HREF)?.[1];
      const playerName = cleanText(link.text());
      const injuryRaw = cleanText($(cells[1]).text());
      const returnRaw = cleanText($(cells[2]).text());
      if (!sourceKey || !playerName || !injuryRaw || !returnRaw) {
        throw new FootywireInjuryListParseError(
          `${clubName} row is incomplete: ${JSON.stringify({ href, playerName, injuryRaw, returnRaw })}`
        );
      }
      // The slug is the row's identity in the content hash; a repeat means the page is not what
      // we think it is.
      if (seenKeys.has(sourceKey)) {
        throw new FootywireInjuryListParseError(`Player ${sourceKey} is listed twice`);
      }
      seenKeys.add(sourceKey);

      rows.push({
        clubName,
        sourceKey,
        playerName,
        injuryRaw,
        returnRaw,
        ...normalizeReturnTimeframe(returnRaw),
      });
    }
  }
  // Every club header reading "(0 Players)" is not a real list: even the off-season page names
  // someone, so an empty one more likely means the page changed than that everyone is fit.
  if (rows.length === 0) {
    throw new FootywireInjuryListParseError(
      'The Footywire injury list has club tables but no rows'
    );
  }
  return rows;
}

/** Fetches the injury list HTML. Throws on a network failure, timeout or non-2xx response. */
export async function fetchFootywireInjuryList(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(FOOTYWIRE_INJURY_LIST_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Footywire injury list returned HTTP ${response.status}`);
  }
  return response.text();
}
