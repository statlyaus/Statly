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
