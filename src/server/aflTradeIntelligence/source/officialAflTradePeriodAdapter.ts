import { load } from 'cheerio';

import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';

export const OFFICIAL_AFL_TRADE_PERIOD_PARSER_VERSION = 'official-afl-trade-period-parser/v2';

type SourceCapture = AflTradeExternalEvidenceContent['capture'];

export interface OfficialAflTradePeriodIssue {
  code: 'invalid_page' | 'ambiguous_trade_period' | 'trade_period_outside_season';
  sourceKey: string;
  detail: string;
}

export interface OfficialAflTradePeriodResult {
  evidence: AflTradeExternalEvidenceEnvelope[];
  issues: OfficialAflTradePeriodIssue[];
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_PATTERN = MONTHS.join('|');
// "Monday, October 9", "October 9", or a same-month range "November 4-12".
const DATE_MENTION = new RegExp(
  `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:\\s*[-–]\\s*(\\d{1,2}))?(?!\\d)`,
  'gi'
);
// A paragraph about the men's AFL trade period itself, not free agency, the AFLW period, the
// selections-only session or list lodgement.
const TRADE_PERIOD = /\btrade\s+period\b/i;
const EXCLUDED =
  /sign\s+and\s+trade|free\s+agen|\baflw\b|selections?\s+only|list\s+lodg|pick\s+swap/i;
// v2 (statlyaus/Statly#869, owner-supplied pages for 2019 and 2021): a paragraph that names the
// period's "opening day" and "deadline day" (2019), or one that says the period "officially starts
// today" and concludes on a stated day (2021), where "today" is the article's own date in Melbourne.
const OPENING_AND_DEADLINE = /\bopening\s+day\b[\s\S]*\bdeadline\s+day\b/i;
const STARTS_TODAY = /\bperiod\s+officially\s+starts\s+today\b/i;
// afl.com.au renamed the non-AMP date wrapper from `article__date` to `article__byline-date`; the
// `datetime` values are unchanged. Either wrapper is read.
const ARTICLE_DATE = '.article__date > time, .article__byline-date > time';
const MELBOURNE_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const MAXIMUM_WINDOW_DAYS = 31;

function normalizeText(value: string): string {
  return value.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function isoDate(year: number, monthIndex: number, day: number): string | null {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Every month-day mention in `text`, in order, as ISO dates of `year`; a range yields both ends. */
function mentionedDates(text: string, year: number): string[] {
  const dates: string[] = [];
  for (const match of text.matchAll(DATE_MENTION)) {
    const monthIndex = MONTHS.indexOf(match[1]!.toLowerCase());
    for (const day of [match[2], match[3]]) {
      if (day === undefined) continue;
      const date = isoDate(year, monthIndex, Number(day));
      if (date !== null) dates.push(date);
    }
  }
  return dates;
}

function daysBetween(earliest: string, latest: string): number {
  return Math.round((Date.parse(latest) - Date.parse(earliest)) / 86_400_000);
}

/** The article's publication day in Melbourne, from its `<time datetime>`; null when absent. */
function articleMelbourneDay($: ReturnType<typeof load>): string | null {
  const datetime = $(ARTICLE_DATE).first().attr('datetime');
  if (datetime === undefined) return null;
  const instant = Date.parse(datetime);
  if (Number.isNaN(instant)) return null;
  return MELBOURNE_DAY.format(new Date(instant));
}

/**
 * Reads a reviewed Official AFL announcement of a season's trade-period dates
 * (statlyaus/Statly#869). One paragraph of the article body names the men's trade period with its
 * opening day and deadline day; the paragraph may state the deadline in its next sentence. v2 also
 * reads, on a page that names the trade period, a paragraph giving the period's "opening day" and
 * "deadline day" (the 2019 page), and a paragraph saying the period "officially starts today" and
 * concludes on a stated day, where today is the article's own date in Melbourne (the 2021 page).
 * The window is emitted as a `trade_period_window` claim with explicit window precision, never a day
 * for any trade. Nothing is emitted unless exactly one such window is readable and lies inside the
 * season, since an ambiguous page must be reviewed, not guessed.
 */
export function parseOfficialAflTradePeriodDates(
  html: string,
  input: { capture: SourceCapture; seasonYear: number }
): OfficialAflTradePeriodResult {
  if (!Number.isInteger(input.seasonYear) || input.seasonYear < 1897 || input.seasonYear > 2200) {
    throw new TypeError('seasonYear must be an AFL-era year.');
  }
  const sourceKey = `trade-period:${input.seasonYear}`;
  const $ = load(html);
  const body = $('.article__body').length ? $('.article__body') : $('body');
  const paragraphs = body
    .find('p, li')
    .toArray()
    .flatMap((element) => ($(element).html() ?? '').split(/<br\s*\/?\s*>/i))
    .map((fragment) => normalizeText(load(fragment).text()))
    .filter((text) => text.length > 0);
  if (paragraphs.length === 0) {
    return {
      evidence: [],
      issues: [{ code: 'invalid_page', sourceKey, detail: 'The page has no article paragraphs.' }],
    };
  }
  // A page is about the trade period when a paragraph names it, or its title or heading says
  // "trade" (the 2021 opening-day preview is titled "YOUR CLUB'S TRADE PLANS").
  const pageNamesTradePeriod =
    /\btrade\b/i.test(`${$('title').text()} ${$('h1').text()}`) ||
    paragraphs.some((paragraph) => TRADE_PERIOD.test(paragraph) && !EXCLUDED.test(paragraph));
  const windows: { earliestDate: string; latestDate: string }[] = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    const dates: string[] = [];
    const start = sentences.findIndex(
      (sentence) => TRADE_PERIOD.test(sentence) && !EXCLUDED.test(sentence)
    );
    if (start >= 0) {
      for (const sentence of sentences.slice(start)) {
        if (EXCLUDED.test(sentence)) break;
        dates.push(...mentionedDates(sentence, input.seasonYear));
        if (dates.length >= 2) break;
      }
    } else if (
      pageNamesTradePeriod &&
      OPENING_AND_DEADLINE.test(paragraph) &&
      !EXCLUDED.test(paragraph)
    ) {
      dates.push(...mentionedDates(paragraph, input.seasonYear));
    } else if (pageNamesTradePeriod) {
      const today = sentences.find(
        (sentence) => STARTS_TODAY.test(sentence) && !EXCLUDED.test(sentence)
      );
      const opening = today === undefined ? null : articleMelbourneDay($);
      if (today !== undefined && opening !== null)
        dates.push(opening, ...mentionedDates(today, input.seasonYear));
    }
    if (dates.length < 2) continue;
    const [earliestDate, latestDate] = [dates[0]!, dates[1]!];
    if (earliestDate < latestDate && daysBetween(earliestDate, latestDate) <= MAXIMUM_WINDOW_DAYS)
      windows.push({ earliestDate, latestDate });
  }
  if (windows.length !== 1) {
    return {
      evidence: [],
      issues: [
        {
          code: windows.length === 0 ? 'invalid_page' : 'ambiguous_trade_period',
          sourceKey,
          detail:
            windows.length === 0
              ? 'No paragraph states the trade period with its opening and deadline days.'
              : `The page states ${windows.length} trade-period windows.`,
        },
      ],
    };
  }
  const window = windows[0]!;
  if (Number(window.earliestDate.slice(0, 4)) !== input.seasonYear) {
    return {
      evidence: [],
      issues: [
        {
          code: 'trade_period_outside_season',
          sourceKey,
          detail: `The stated window ${window.earliestDate} to ${window.latestDate} is not in ${input.seasonYear}.`,
        },
      ],
    };
  }
  return {
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: { ordinal: 1, sourceKey },
        claim: {
          kind: 'trade_period_window',
          seasonYear: input.seasonYear,
          datePrecision: {
            precision: 'window',
            eventDate: null,
            earliestDate: window.earliestDate,
            latestDate: window.latestDate,
          },
        },
        publicationEligible: false,
      }),
    ],
    issues: [],
  };
}
