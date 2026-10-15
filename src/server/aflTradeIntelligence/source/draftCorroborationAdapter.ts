import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import {
  decodedScalarToSourceText,
  parseAflTradeFitzRoyDecodedTable,
  type AflTradeDecodedScalar,
  type AflTradeFitzRoyDecodedTable,
} from './fitzRoyObservationContracts';

type SourceCapture = AflTradeExternalEvidenceContent['capture'];

export interface DraftCorroborationIssue {
  code:
    | 'invalid_page'
    | 'invalid_order_row'
    | 'unsupported_order_annotation'
    | 'missing_player_detail'
    | 'partial_draft_detail'
    | 'unsupported_draft_type';
  sourceKey: string;
  detail: string;
}

export interface DraftCorroborationResult {
  evidence: AflTradeExternalEvidenceEnvelope[];
  issues: DraftCorroborationIssue[];
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertOfficialArticleUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Official AFL source URL is invalid.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.afl.com.au' ||
    !/^\/news\/\d+\/[a-z0-9-]+(?:\/amp)?$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError('Official AFL source URL is outside the approved news-article path.');
  }
}

function paragraphLines($: CheerioAPI, paragraph: Cheerio<AnyNode>): string[] {
  const copy = paragraph.clone();
  copy.find('br').replaceWith('\n');
  return copy.text().split('\n').map(normalizeText).filter(Boolean);
}

export function parseOfficialAflIndicativeDraftOrder(
  html: string,
  input: { capture: SourceCapture; draftYear: number; observedAt: string }
): DraftCorroborationResult {
  assertOfficialArticleUrl(input.capture.sourceUrl);
  if (!Number.isInteger(input.draftYear) || input.draftYear < 1897 || input.draftYear > 2200) {
    throw new TypeError('draftYear must be an AFL-era year.');
  }
  const $ = load(html);
  const heading = $('strong')
    .filter((_index, element) => /INDICATIVE (?:AFL )?DRAFT ORDER/i.test($(element).text()))
    .first();
  const headingText = normalizeText(heading.text());
  const headingYear = /\b(\d{4})\b/.exec(headingText)?.[1] ?? null;
  if (heading.length !== 1 || headingYear !== String(input.draftYear)) {
    return {
      evidence: [],
      issues: [
        {
          code: 'invalid_page',
          sourceKey: String(input.draftYear),
          detail: 'Order heading is absent or does not identify the authorized draft year.',
        },
      ],
    };
  }
  const evidence: AflTradeExternalEvidenceEnvelope[] = [];
  const issues: DraftCorroborationIssue[] = [];
  let paragraph = heading.parent().next('p');
  while (paragraph.length === 1) {
    const lines = paragraphLines($, paragraph);
    const orderLines = lines.filter((line) => /^\d+\.\s*/.test(line));
    if (orderLines.length === 0) break;
    orderLines.forEach((line) => {
      const match = /^(\d+)\.\s*(.+)$/.exec(line);
      if (!match) return;
      const pick = Number(match[1]);
      const recorded = normalizeText(match[2]);
      const annotationMatch = /^(.+?)\s*\((.+)\)$/.exec(recorded);
      const currentClubName = normalizeText(annotationMatch?.[1] ?? recorded);
      const annotation = annotationMatch ? normalizeText(annotationMatch[2]) : null;
      const viaMatch = annotation ? /^via\s+(.+)$/i.exec(annotation) : null;
      const sourceKey = `${input.draftYear}:national:${pick}`;
      if (!Number.isInteger(pick) || pick <= 0 || !currentClubName) {
        issues.push({
          code: 'invalid_order_row',
          sourceKey,
          detail: 'Pick or current club is invalid.',
        });
        return;
      }
      if (annotation && !viaMatch) {
        issues.push({
          code: 'unsupported_order_annotation',
          sourceKey,
          detail: `Order annotation was retained only as an issue: ${annotation}`,
        });
      }
      evidence.push(
        createAflTradeExternalEvidenceEnvelope({
          schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
          provider: 'official_afl',
          capture: input.capture,
          sourceRow: { ordinal: evidence.length + 1, sourceKey },
          claim: {
            kind: 'pick_custody',
            observedAt: input.observedAt,
            draftYear: input.draftYear,
            draftType: 'national',
            roundNumber: null,
            recordedPickNumber: pick,
            originalClub:
              annotation === null
                ? { nativeId: null, recordedName: currentClubName }
                : viaMatch
                  ? { nativeId: null, recordedName: normalizeText(viaMatch[1]) }
                  : null,
            currentClub: { nativeId: null, recordedName: currentClubName },
          },
          publicationEligible: false,
        })
      );
    });
    paragraph = paragraph.next('p');
  }
  return evidence.length > 0
    ? { evidence, issues }
    : {
        evidence,
        issues: [
          ...issues,
          {
            code: 'invalid_page',
            sourceKey: String(input.draftYear),
            detail: 'Order rows absent.',
          },
        ],
      };
}

/**
 * Parser for the reviewed pre-draft order tables (issue 853); v1 above reads the 2026 paragraph form.
 * v4 also reads the 2025 live page: a round heading may sit in a single table cell, the traded block
 * may be titled "FUTURE SELECTIONS TRADED", the stated pick-swap as-of date must be the observation
 * date, and the per-club pick lists must agree with the table. On the 2019-2024 pages it emits what
 * v3 emitted. v3: a special pick's missing original club is a claim fact, not a parse issue, and a
 * club name may follow an article ("received from the Western Bulldogs").
 */
export const OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION = 'official-afl-draft-order-parser/v4';

/**
 * Parser for the 2026 live order page (issue 789), from which v4 reads nothing: each round heading
 * is an `<h4>ROUND <n></h4>` just before its table, the club lists are headed "EVERY CLUB'S PICKS",
 * and the page states its date only as "Updated: <Month> <day>, <year>". The 2019-2025 pages stay
 * on v4; the reviewed scope names each page's parser.
 */
export const OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5 = 'official-afl-draft-order-parser/v5';

export type OfficialAflDraftOrderTableParserVersion =
  | typeof OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION
  | typeof OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5;

export function isOfficialAflDraftOrderTableParserVersion(
  version: string
): version is OfficialAflDraftOrderTableParserVersion {
  return (
    version === OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION ||
    version === OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5
  );
}

// Longest first, so "North Melbourne" never reads as "Melbourne". Names are recorded as written.
const CLUB_NAMES = [
  'Greater Western Sydney',
  'Western Bulldogs',
  'North Melbourne',
  'Brisbane Lions',
  'Port Adelaide',
  'GWS Giants',
  'Collingwood',
  'Gold Coast',
  'West Coast',
  'Fremantle',
  'St Kilda',
  'Adelaide',
  'Brisbane',
  'Essendon',
  'Hawthorn',
  'Melbourne',
  'Richmond',
  'Carlton',
  'Geelong',
  'Sydney',
  'GWS',
];
const CLUB_PATTERN = CLUB_NAMES.map((name) => name.replace(/ /g, '\\s+')).join('|');
// The 2025 club lists and order table name two clubs differently ("GWS", "Greater Western Sydney").
const CLUB_ALIASES: Record<string, string> = {
  'Greater Western Sydney': 'GWS',
  'GWS Giants': 'GWS',
  'Brisbane Lions': 'Brisbane',
};
const sameClub = (left: string, right: string) =>
  (CLUB_ALIASES[left] ?? left) === (CLUB_ALIASES[right] ?? right);
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ROUND_NUMBERS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
};
// A compensation, assistance, concession or priority pick has no ladder slot of an original club,
// so naming one would collide with that club's own pick in the round. Its claim says so by carrying
// no original club; that is a fact of the page, not a parse issue.
const SPECIAL_ORIGIN = /compensation|assistance package|concession|priority pick/i;

/**
 * The club after the last `prefix` in the note. `undefined` means the prefix is absent; `null`
 * means the last one names something other than a recorded club (an abbreviation, say), which must
 * never fall back to an earlier club in the chain.
 */
function lastClub(annotation: string, prefix: string): string | null | undefined {
  const occurrences = [...annotation.matchAll(new RegExp(`\\b${prefix}\\s+`, 'g'))];
  const last = occurrences.at(-1);
  if (!last) return undefined;
  const club = new RegExp(`^(?:the\\s+)?(${CLUB_PATTERN})\\b`, 'i').exec(
    annotation.slice(last.index + last[0].length)
  );
  return club ? normalizeText(club[1]!) : null;
}

/**
 * The original club of a slot from its order annotation: none means the holder's own pick; an
 * explicit "tied to"/"held by" club wins; otherwise the last club a chain received it from is the
 * earliest holder the page records. Special picks and unreadable notes keep no original club.
 */
function originalClubFromAnnotation(
  holder: string,
  annotation: string | null
): { originalClub: string | null; issue: DraftCorroborationIssue['code'] | null } {
  if (annotation === null) return { originalClub: holder, issue: null };
  if (SPECIAL_ORIGIN.test(annotation)) return { originalClub: null, issue: null };
  const explicit = lastClub(annotation, '(?:tied\\s+to|held\\s+by)');
  const club = explicit === undefined ? lastClub(annotation, 'from') : explicit;
  return club
    ? { originalClub: club, issue: null }
    : { originalClub: null, issue: 'unsupported_order_annotation' };
}

/**
 * The slot holders of the 2025 page's "YOUR CLUB'S PICKS" lists (`Club: 16, 48, ...`, one line per
 * club; v5 also reads 2026's "EVERY CLUB'S PICKS"): `undefined` when the page has no such heading,
 * `null` when the lists are not exactly 18 recorded clubs whose slots never repeat.
 */
function clubPickLists($: CheerioAPI, v5: boolean): Map<number, string> | null | undefined {
  const title = v5 ? /^(?:YOUR|EVERY) CLUB['’]S PICKS$/i : /^YOUR CLUB['’]S PICKS$/i;
  const headings = $('h1, h2, h3, h4, h5, h6').filter((_index, element) =>
    title.test(normalizeText($(element).text()))
  );
  if (headings.length === 0) return undefined;
  if (headings.length > 1) return null;
  const lines = paragraphLines($, headings.next('p'));
  const listed = new Map<number, string>();
  const clubs = new Set<string>();
  const line = new RegExp(`^(${CLUB_PATTERN}):\\s*(\\d{1,3}(?:\\s*,\\s*\\d{1,3})*)$`);
  for (const text of lines) {
    const match = line.exec(text);
    if (!match) return null;
    const club = normalizeText(match[1]!);
    clubs.add(CLUB_ALIASES[club] ?? club);
    for (const pick of match[2]!.split(',').map(Number)) {
      if (listed.has(pick)) return null;
      listed.set(pick, club);
    }
  }
  return lines.length === 18 && clubs.size === 18 ? listed : null;
}

/**
 * Reads a reviewed Official AFL pre-draft order (2019-2024 articles, the two approved archive
 * snapshots of the live order page, and the 2025 one): every `ROUND <n>` table row is one slot's
 * holder, round and original club as of `observedAt`. The page must name the next year's (or
 * "future") traded selections, the slots must run 1..N without a gap, a stated pick-swap as-of date
 * must be `observedAt`'s date, and the club pick lists, when present, must name every slot's holder;
 * otherwise nothing is emitted.
 */
export function parseOfficialAflDraftOrderTable(
  html: string,
  input: { capture: SourceCapture; draftYear: number; observedAt: string }
): DraftCorroborationResult {
  return parseOrderTable(html, input, false);
}

/**
 * v5, the 2026 live page: v4's rules, plus a round heading may be the `h1`-`h6` element just before
 * its table, the club lists may be headed "EVERY CLUB'S PICKS", and the page must state its date
 * ("Updated: October 14, 2026" or the pick-swap as-of line), every stated date being `observedAt`'s
 * date; otherwise nothing is emitted.
 */
export function parseOfficialAflDraftOrderTableV5(
  html: string,
  input: { capture: SourceCapture; draftYear: number; observedAt: string }
): DraftCorroborationResult {
  return parseOrderTable(html, input, true);
}

/** The table parser a reviewed pre-draft order capture names. */
export function officialAflDraftOrderTableParser(
  version: OfficialAflDraftOrderTableParserVersion
): typeof parseOfficialAflDraftOrderTable {
  return version === OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5
    ? parseOfficialAflDraftOrderTableV5
    : parseOfficialAflDraftOrderTable;
}

function parseOrderTable(
  html: string,
  input: { capture: SourceCapture; draftYear: number; observedAt: string },
  v5: boolean
): DraftCorroborationResult {
  if (!Number.isInteger(input.draftYear) || input.draftYear < 1897 || input.draftYear > 2200) {
    throw new TypeError('draftYear must be an AFL-era year.');
  }
  const $ = load(html);
  const invalid = (detail: string): DraftCorroborationResult => ({
    evidence: [],
    issues: [{ code: 'invalid_page', sourceKey: String(input.draftYear), detail }],
  });
  const nextYearTraded = new RegExp(
    `^(?:${input.draftYear + 1}\\s+DRAFT|FUTURE)\\s+SELECTIONS TRADED\\b`,
    'i'
  );
  const headings = $('th, h1, h2, h3, h4, h5, h6').filter((_index, element) =>
    nextYearTraded.test(normalizeText($(element).text()))
  );
  if (headings.length === 0) {
    return invalid('The page does not list the next year’s traded selections for this draft.');
  }
  // 2025: "As at conclusion of pick swaps window on November 7." The order is observed on that day.
  const statedAsOf = $('p')
    .toArray()
    .map((element) =>
      /^As at conclusion of pick swaps window on ([A-Za-z]+) (\d{1,2})\.?$/i.exec(
        normalizeText($(element).text())
      )
    )
    .filter((match) => match !== null)
    .map(([, month, day]) => {
      const index = MONTHS.findIndex((name) => name.toLowerCase() === month!.toLowerCase());
      return index < 0
        ? null
        : `${input.draftYear}-${String(index + 1).padStart(2, '0')}-${day!.padStart(2, '0')}`;
    });
  if (statedAsOf.some((date) => date !== input.observedAt.slice(0, 10))) {
    return invalid('The page states a pick-swap as-of date other than the observation date.');
  }
  if (v5) {
    // 2026: "Updated: October 14, 2026". A live page must state the date of the order it shows.
    const updated = $('p')
      .toArray()
      .map((element) =>
        /^Updated:\s*([A-Za-z]+) (\d{1,2}), (\d{4})$/i.exec(normalizeText($(element).text()))
      )
      .filter((match) => match !== null)
      .map(([, month, day, year]) => {
        const index = MONTHS.findIndex((name) => name.toLowerCase() === month!.toLowerCase());
        return index < 0
          ? null
          : `${year}-${String(index + 1).padStart(2, '0')}-${day!.padStart(2, '0')}`;
      });
    if (statedAsOf.length + updated.length === 0) {
      return invalid('The page states no date for the order it shows.');
    }
    if (updated.some((date) => date !== input.observedAt.slice(0, 10))) {
      return invalid('The page states an updated date other than the observation date.');
    }
  }
  const slots: Array<{ pick: number; round: number; holder: string; annotation: string | null }> =
    [];
  const rowIssues: DraftCorroborationIssue[] = [];
  $('table').each((_tableIndex, table) => {
    // 2026 (v5): the round heading is the heading element just before the table, outside it.
    const before = v5 ? $(table).prev('h1, h2, h3, h4, h5, h6') : null;
    const outside = before ? /^ROUND\s+([A-Z]+)$/i.exec(normalizeText(before.text())) : null;
    let round: number | null = outside ? (ROUND_NUMBERS[outside[1]!.toUpperCase()] ?? null) : null;
    $(table)
      .find('tr')
      .each((_rowIndex, row) => {
        const headers = $(row).children('th');
        const cells = $(row).children('td');
        // 2025 puts the round heading in a single `td`; a single `td` that is not one is skipped.
        const single = headers.length === 1 ? headers : headers.length === 0 ? cells : null;
        if (single?.length === 1) {
          const heading = /^ROUND\s+([A-Z]+)$/i.exec(normalizeText(single.text()));
          if (heading || headers.length === 1) {
            round = heading ? (ROUND_NUMBERS[heading[1]!.toUpperCase()] ?? null) : null;
          }
          return;
        }
        if (round === null || cells.length !== 2) return;
        const first = normalizeText(cells.eq(0).text());
        const second = normalizeText(cells.eq(1).text());
        const numbered = /^(\d{1,3})\.\s*(.+)$/.exec(second);
        const [pickText, recorded] = /^\d{1,3}$/.test(first)
          ? [first, second]
          : numbered
            ? [numbered[1]!, numbered[2]!]
            : [null, null];
        if (pickText === null || recorded === null) return;
        const open = recorded.indexOf('(');
        const close = recorded.lastIndexOf(')');
        const holder = normalizeText(open < 0 ? recorded : recorded.slice(0, open)).replace(
          /\*$/,
          ''
        );
        const annotation =
          open < 0 || close < open
            ? null
            : normalizeText(recorded.slice(open + 1, close).replace(/\*/g, ''));
        if (!new RegExp(`^(?:${CLUB_PATTERN})$`).test(holder)) {
          rowIssues.push({
            code: 'invalid_order_row',
            sourceKey: `${input.draftYear}:national:${pickText}`,
            detail: `Slot holder is not a recorded club name: ${holder}`,
          });
          return;
        }
        slots.push({ pick: Number(pickText), round, holder, annotation: annotation || null });
      });
  });
  if (rowIssues.length > 0) return { evidence: [], issues: rowIssues };
  const picks = slots.map(({ pick }) => pick);
  if (slots.length === 0 || picks.some((pick, index) => pick !== index + 1)) {
    return invalid('Order slots are absent or do not run from 1 without a gap.');
  }
  const listed = clubPickLists($, v5);
  if (
    listed === null ||
    (listed !== undefined &&
      (listed.size !== slots.length ||
        slots.some(({ pick, holder }) => !sameClub(listed.get(pick) ?? '', holder))))
  ) {
    return invalid('The club pick lists do not name exactly the order table’s slot holders.');
  }
  const issues: DraftCorroborationIssue[] = [];
  const evidence = slots.map(({ pick, round, holder, annotation }, index) => {
    const sourceKey = `${input.draftYear}:national:${pick}`;
    const origin = originalClubFromAnnotation(holder, annotation);
    if (origin.issue) {
      issues.push({ code: origin.issue, sourceKey, detail: `Order annotation: ${annotation}` });
    }
    return createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'official_afl',
      capture: input.capture,
      sourceRow: { ordinal: index + 1, sourceKey },
      claim: {
        kind: 'pick_custody',
        observedAt: input.observedAt,
        draftYear: input.draftYear,
        draftType: 'national',
        roundNumber: round,
        recordedPickNumber: pick,
        originalClub:
          origin.originalClub === null
            ? null
            : { nativeId: null, recordedName: origin.originalClub },
        currentClub: { nativeId: null, recordedName: holder },
      },
      publicationEligible: false,
    });
  });
  return { evidence, issues };
}

function fieldIndex(table: AflTradeFitzRoyDecodedTable, name: string): number {
  return table.fields.findIndex((field) => field.name === name);
}

function sourceValue(
  table: AflTradeFitzRoyDecodedTable,
  row: readonly AflTradeDecodedScalar[],
  name: string
): string | null {
  const index = fieldIndex(table, name);
  return index < 0 ? null : decodedScalarToSourceText(row[index]!);
}

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function draftType(
  value: string | null
): AflTradeExternalEvidenceContent['claim'] extends infer _T
  ? 'national' | 'rookie' | 'pre_season' | 'mid_season' | null
  : never {
  const key = value?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  return (
    (
      {
        nationaldraft: 'national',
        national: 'national',
        rookiedraft: 'rookie',
        rookie: 'rookie',
        preseasondraft: 'pre_season',
        preseason: 'pre_season',
        midseasondraft: 'mid_season',
        midseason: 'mid_season',
      } as const
    )[key] ?? null
  );
}

export function normalizeFitzRoyOfficialAflPlayerDetails(
  input: unknown,
  options: { capture: SourceCapture }
): DraftCorroborationResult {
  const table = parseAflTradeFitzRoyDecodedTable(input);
  if (table.capabilityId !== 'official-afl-player-details') {
    throw new TypeError('Only official AFL player-detail captures can enter this adapter.');
  }
  if (options.capture.contentSha256 !== table.sourceRdsSha256) {
    throw new TypeError('Player-detail evidence capture must bind the exact decoded RDS digest.');
  }
  const evidence: AflTradeExternalEvidenceEnvelope[] = [];
  const issues: DraftCorroborationIssue[] = [];
  table.rows.forEach((row, index) => {
    const sourceKey = `row:${index + 1}`;
    const firstName = sourceValue(table, row, 'firstName');
    const surname = sourceValue(table, row, 'surname');
    const recordedName = normalizeText([firstName, surname].filter(Boolean).join(' '));
    const squadClubName = normalizeText(sourceValue(table, row, 'team') ?? '');
    const squadSeason = positiveInteger(sourceValue(table, row, 'season'));
    const nativeId = sourceValue(table, row, 'providerId') ?? sourceValue(table, row, 'id');
    if (!recordedName || !squadClubName || squadSeason === null || nativeId === null) {
      issues.push({
        code: 'missing_player_detail',
        sourceKey,
        detail: 'Player identity, squad club, or squad season is unavailable.',
      });
      return;
    }
    const recordedDraftYear = positiveInteger(sourceValue(table, row, 'draftYear'));
    const recordedDraftType = draftType(sourceValue(table, row, 'draftType'));
    const recordedDraftPosition = positiveInteger(sourceValue(table, row, 'draftPosition'));
    const populated = [recordedDraftYear, recordedDraftType, recordedDraftPosition].filter(
      (value) => value !== null
    ).length;
    const complete = populated === 3;
    if (populated !== 0 && !complete) {
      issues.push({
        code: 'partial_draft_detail',
        sourceKey,
        detail: 'Draft year, pathway and position were not all present.',
      });
    }
    if (sourceValue(table, row, 'draftType') !== null && recordedDraftType === null) {
      issues.push({
        code: 'unsupported_draft_type',
        sourceKey,
        detail: 'The recorded draft type is not mapped to a supported pathway.',
      });
    }
    evidence.push(
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'fitzroy_official_afl_player_details',
        capture: options.capture,
        sourceRow: { ordinal: evidence.length + 1, sourceKey },
        claim: {
          kind: 'player_draft_detail',
          player: { nativeId, recordedName },
          squadSeason,
          squadClub: { nativeId: null, recordedName: squadClubName },
          draftYear: complete ? recordedDraftYear : null,
          draftType: complete ? recordedDraftType : null,
          draftPosition: complete ? recordedDraftPosition : null,
          recruitedFrom: sourceValue(table, row, 'recruitedFrom'),
        },
        publicationEligible: false,
      })
    );
  });
  return { evidence, issues };
}
