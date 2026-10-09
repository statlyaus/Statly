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
    | 'special_pick_origin'
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

/** Parser for the reviewed pre-draft order tables (issue 853); v1 above reads the 2026 paragraph form. */
export const OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION = 'official-afl-draft-order-parser/v2';

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
// so naming one would collide with that club's own pick in the round.
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
  const club = new RegExp(`^(${CLUB_PATTERN})\\b`).exec(
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
  if (SPECIAL_ORIGIN.test(annotation)) return { originalClub: null, issue: 'special_pick_origin' };
  const explicit = lastClub(annotation, '(?:tied\\s+to|held\\s+by)');
  const club = explicit === undefined ? lastClub(annotation, 'from') : explicit;
  return club
    ? { originalClub: club, issue: null }
    : { originalClub: null, issue: 'unsupported_order_annotation' };
}

/**
 * Reads a reviewed Official AFL pre-draft order (2019-2024 articles and the two approved archive
 * snapshots of the live order page): every `ROUND <n>` table row is one slot's holder, round and
 * original club as of `observedAt`. The page must name the next year's traded selections, and the
 * slots must run 1..N without a gap; otherwise nothing is emitted.
 */
export function parseOfficialAflDraftOrderTable(
  html: string,
  input: { capture: SourceCapture; draftYear: number; observedAt: string }
): DraftCorroborationResult {
  if (!Number.isInteger(input.draftYear) || input.draftYear < 1897 || input.draftYear > 2200) {
    throw new TypeError('draftYear must be an AFL-era year.');
  }
  const $ = load(html);
  const invalid = (detail: string): DraftCorroborationResult => ({
    evidence: [],
    issues: [{ code: 'invalid_page', sourceKey: String(input.draftYear), detail }],
  });
  const nextYearTraded = new RegExp(`^${input.draftYear + 1}\\s+DRAFT SELECTIONS TRADED\\b`, 'i');
  const headings = $('th, h1, h2, h3, h4, h5, h6').filter((_index, element) =>
    nextYearTraded.test(normalizeText($(element).text()))
  );
  if (headings.length === 0) {
    return invalid('The page does not list the next year’s traded selections for this draft.');
  }
  const slots: Array<{ pick: number; round: number; holder: string; annotation: string | null }> =
    [];
  const rowIssues: DraftCorroborationIssue[] = [];
  $('table').each((_tableIndex, table) => {
    let round: number | null = null;
    $(table)
      .find('tr')
      .each((_rowIndex, row) => {
        const headers = $(row).children('th');
        if (headers.length === 1) {
          const heading = /^ROUND\s+([A-Z]+)$/i.exec(normalizeText(headers.text()));
          round = heading ? (ROUND_NUMBERS[heading[1]!.toUpperCase()] ?? null) : null;
          return;
        }
        const cells = $(row).children('td');
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
