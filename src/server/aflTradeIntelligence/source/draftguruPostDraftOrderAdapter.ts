import { load, type Cheerio } from 'cheerio';
import { isTag, isText, type AnyNode } from 'domhandler';

import type { DraftguruParseIssue, DraftguruTradeParseResult } from './draftguruSourceAdapter';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  DRAFTGURU_POST_DRAFT_ORDER_PARSER_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

type SourceCapture = AflTradeExternalEvidenceContent['capture'];
type OrderClaim = Extract<AflTradeExternalEvidenceContent['claim'], { kind: 'draft_order_pick' }>;
type Entity = OrderClaim['club'];

const DRAFTGURU_ORIGIN = 'https://www.draftguru.com.au';

/** The seasons whose post-draft order page is reviewed (owner approval 4 of the 2026 intake). */
export const DRAFTGURU_POST_DRAFT_ORDER_SEASONS: readonly number[] = [2026];

/** The one reviewed post-draft order page of a season. */
export function draftguruPostDraftOrderUrl(season: number): string {
  return `${DRAFTGURU_ORIGIN}/years/${season}/provisional-draft-order/post-draft`;
}

/**
 * The eighteen clubs as the order page names them: the abbreviation its origin text writes
 * (`Haw R1 pick`, `To Ess in`), and the club cell's Draftguru id and text, which is how the national
 * year page names the same club (`GWS` in the cell, `greater-western-sydney` in its link). A club
 * written any other way refuses the page.
 */
const CLUBS: readonly { abbreviation: string; nativeId: string; recordedName: string }[] = [
  { abbreviation: 'Adel', nativeId: 'adelaide', recordedName: 'Adelaide' },
  { abbreviation: 'Bris', nativeId: 'brisbane', recordedName: 'Brisbane' },
  { abbreviation: 'Carl', nativeId: 'carlton', recordedName: 'Carlton' },
  { abbreviation: 'Coll', nativeId: 'collingwood', recordedName: 'Collingwood' },
  { abbreviation: 'Ess', nativeId: 'essendon', recordedName: 'Essendon' },
  { abbreviation: 'Freo', nativeId: 'fremantle', recordedName: 'Fremantle' },
  { abbreviation: 'Geel', nativeId: 'geelong', recordedName: 'Geelong' },
  { abbreviation: 'GC', nativeId: 'gold-coast', recordedName: 'Gold Coast' },
  { abbreviation: 'GWS', nativeId: 'greater-western-sydney', recordedName: 'GWS' },
  { abbreviation: 'Haw', nativeId: 'hawthorn', recordedName: 'Hawthorn' },
  { abbreviation: 'Melb', nativeId: 'melbourne', recordedName: 'Melbourne' },
  { abbreviation: 'NM', nativeId: 'north-melbourne', recordedName: 'North Melbourne' },
  { abbreviation: 'Port', nativeId: 'port-adelaide', recordedName: 'Port Adelaide' },
  { abbreviation: 'Rich', nativeId: 'richmond', recordedName: 'Richmond' },
  { abbreviation: 'StK', nativeId: 'st-kilda', recordedName: 'St Kilda' },
  { abbreviation: 'Syd', nativeId: 'sydney', recordedName: 'Sydney' },
  { abbreviation: 'WC', nativeId: 'west-coast', recordedName: 'West Coast' },
  { abbreviation: 'WB', nativeId: 'western-bulldogs', recordedName: 'Western Bulldogs' },
];

const byAbbreviation = new Map(CLUBS.map((club) => [club.abbreviation, club]));
const byName = new Map(CLUBS.map((club) => [club.recordedName, club]));

const entity = (club: { nativeId: string; recordedName: string }): Entity => ({
  nativeId: club.nativeId,
  recordedName: club.recordedName,
});

const BASIS: Readonly<Record<string, 'father_son' | 'academy' | 'next_generation_academy'>> = {
  'Father-Son': 'father_son',
  Academy: 'academy',
  'Next Generation Academy': 'next_generation_academy',
};

const ORDINAL_SUFFIX = /^([1-9]\d*)(?:st|nd|rd|th)$/;

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The exact Draftguru path of a link, or null for any other origin, query or fragment. */
function draftguruPath(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, DRAFTGURU_ORIGIN);
    if (url.origin !== DRAFTGURU_ORIGIN || url.username || url.password || url.search || url.hash)
      return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/** A link's id under `prefix`, as the trade and year parsers derive it from the URL path. */
function pathId(href: string | undefined, prefix: string): string | null {
  const path = draftguruPath(href);
  if (path === null || !path.startsWith(prefix)) return null;
  const value = path.slice(prefix.length).replace(/^\/+|\/+$/g, '');
  return value || null;
}

/** One `|`-separated part of an origin cell: its text with each link written `<a>`, and its links. */
interface Segment {
  template: string;
  links: { href: string | undefined; text: string }[];
}

function textOf(node: AnyNode): string {
  if (isText(node)) return node.data;
  return isTag(node) ? node.children.map(textOf).join('') : '';
}

/** Splits an origin cell at each `<span> | </span>` separator, at any depth. */
function segmentsOf(cell: Cheerio<AnyNode>): Segment[] {
  const segments: Segment[] = [];
  let parts: string[] = [];
  let links: Segment['links'] = [];
  const close = () => {
    segments.push({ template: normalizeText(parts.join('')), links });
    parts = [];
    links = [];
  };
  const walk = (nodes: readonly AnyNode[]) => {
    for (const node of nodes) {
      if (isText(node)) parts.push(node.data);
      if (!isTag(node)) continue;
      if (node.name === 'span' && normalizeText(textOf(node)) === '|') close();
      else if (node.name === 'a') {
        links.push({ href: node.attribs.href, text: normalizeText(textOf(node)) });
        parts.push('<a>');
      } else walk(node.children);
    }
  };
  walk(cell.contents().get());
  close();
  return segments;
}

function player(link: Segment['links'][number] | undefined): Entity | null {
  if (!link || !link.text) return null;
  const nativeId = pathId(link.href, '/players/');
  return nativeId === null ? null : { nativeId, recordedName: link.text };
}

type ParsedSegment =
  | { part: 'origin'; origin: NonNullable<OrderClaim['origin']> }
  | { part: 'hop'; hop: OrderClaim['hops'][number] }
  | { part: 'bid_not_matched'; club: Entity }
  | { part: 'outcome'; outcome: OrderClaim['outcome'] };

type SegmentLink = Segment['links'][number] | undefined;

/**
 * One reviewed segment form: undefined when the segment is not that form, null when it is but
 * names something unreviewed (refusing the segment), else the parsed part.
 */
type SegmentReader = (
  template: string,
  link: SegmentLink,
  linkCount: number
) => ParsedSegment | null | undefined;

const readEntitlement: SegmentReader = (template, _link, linkCount) => {
  const match = /^([A-Za-z]+) R([1-9]\d*) pick \(([^)]+)\)$/.exec(template);
  if (!match || linkCount !== 0) return undefined;
  const club = byAbbreviation.get(match[1]!);
  const rank = ORDINAL_SUFFIX.exec(match[3]!);
  if (!club || !rank) return null;
  return {
    part: 'origin',
    origin: {
      kind: 'entitlement',
      club: entity(club),
      roundNumber: Number(match[2]),
      rank: Number(rank[1]),
    },
  };
};

const readFreeAgencyCompensation: SegmentReader = (template, link) =>
  /^Band [1-5] Free Agency Comp for <a>$/.test(template) && player(link)
    ? {
        part: 'origin',
        origin: { kind: 'compensation', label: template.replace('<a>', link!.text) },
      }
    : undefined;

const readBiddingCompensation: SegmentReader = (template, _link, linkCount) =>
  template === 'Bidding compensation awarded after night one' && linkCount === 0
    ? { part: 'origin', origin: { kind: 'compensation', label: template } }
    : undefined;

const readBidMatched: SegmentReader = (template, link) => {
  const match =
    /^([A-Za-z]+) bid for <a> matched \((Father-Son|Academy|Next Generation Academy)\) using picks ([1-9]\d*(?:, [1-9]\d*)*)$/.exec(
      template
    );
  if (!match) return undefined;
  const club = byAbbreviation.get(match[1]!);
  const nominee = player(link);
  if (!club || !nominee) return null;
  return {
    part: 'origin',
    origin: {
      kind: 'bid_matched',
      bidClub: entity(club),
      basis: BASIS[match[2]!]!,
      nominee,
      usingPicks: match[3]!.split(', ').map(Number),
    },
  };
};

const readLeftoverPoints: SegmentReader = (template, link) => {
  const match = /^Created for ([A-Za-z]+) from leftover points after matching bid for <a>$/.exec(
    template
  );
  if (!match) return undefined;
  const club = byAbbreviation.get(match[1]!);
  const nominee = player(link);
  if (!club || !nominee) return null;
  return { part: 'origin', origin: { kind: 'leftover_points', club: entity(club), nominee } };
};

const readHop: SegmentReader = (template, link) => {
  const match = /^To ([A-Za-z]+) in <a>$/.exec(template);
  if (!match) return undefined;
  const club = byAbbreviation.get(match[1]!);
  // The trade id is the link's path after /trades/, as the trade index derives it.
  const nativeEventId = pathId(link?.href, '/trades/');
  if (!club || nativeEventId === null || !/^\d{4}-[^/]+$/.test(nativeEventId)) return null;
  return { part: 'hop', hop: { toClub: entity(club), nativeEventId } };
};

const readBidNotMatched: SegmentReader = (template, _link, linkCount) => {
  const match = /^Bid not matched by ([A-Za-z ]+)$/.exec(template);
  if (!match || linkCount !== 0) return undefined;
  const club = byName.get(match[1]!);
  return club ? { part: 'bid_not_matched', club: entity(club) } : null;
};

const readSelected: SegmentReader = (template, link) => {
  if (template !== 'Picked <a>') return undefined;
  const selected = player(link);
  return selected ? { part: 'outcome', outcome: { kind: 'selected', player: selected } } : null;
};

const readBidSpent: SegmentReader = (template, link) => {
  const match = /^Used to match bid for <a> as pick ([1-9]\d*)$/.exec(template);
  if (!match) return undefined;
  const nominee = player(link);
  return nominee
    ? { part: 'outcome', outcome: { kind: 'bid_spent', nominee, asPick: Number(match[1]) } }
    : null;
};

const readRemoved: SegmentReader = (template, _link, linkCount) => {
  const match = /^Removed - ([a-z][a-z ]*[a-z])$/.exec(template);
  return match && linkCount === 0
    ? { part: 'outcome', outcome: { kind: 'removed', note: match[1]! } }
    : undefined;
};

/** The reviewed forms, in the order they are tried. */
const SEGMENT_READERS: readonly SegmentReader[] = [
  readEntitlement,
  readFreeAgencyCompensation,
  readBiddingCompensation,
  readBidMatched,
  readLeftoverPoints,
  readHop,
  readBidNotMatched,
  readSelected,
  readBidSpent,
  readRemoved,
];

/** Reads one segment against the reviewed forms only; anything else is null. */
function parseSegment(segment: Segment): ParsedSegment | null {
  const { template, links } = segment;
  if (links.length > 1) return null;
  for (const read of SEGMENT_READERS) {
    const parsed = read(template, links[0], links.length);
    if (parsed !== undefined) return parsed;
  }
  return null;
}

/**
 * The row's parts in the reviewed order: at most one origin, first; then the trade hops; at most one
 * declined bid anywhere before the outcome; and exactly one outcome, last.
 */
function assembleRow(
  parts: readonly ParsedSegment[]
): Pick<OrderClaim, 'origin' | 'hops' | 'bidNotMatchedBy' | 'outcome'> | null {
  const outcome = parts.at(-1);
  if (outcome?.part !== 'outcome') return null;
  let origin: OrderClaim['origin'] = null;
  let bidNotMatchedBy: Entity | null = null;
  const hops: OrderClaim['hops'] = [];
  for (const [index, part] of parts.slice(0, -1).entries()) {
    if (part.part === 'origin' && index === 0) origin = part.origin;
    else if (part.part === 'hop' && bidNotMatchedBy === null) hops.push(part.hop);
    else if (part.part === 'bid_not_matched' && bidNotMatchedBy === null)
      bidNotMatchedBy = part.club;
    else return null;
  }
  return { origin, hops, bidNotMatchedBy, outcome: outcome.outcome };
}

/**
 * Reads Draftguru's post-draft national order (`draftguru-post-draft-order/v1`): one
 * `draft_order_pick` per row of the one "Full Draft Order" table, keyed
 * `<season>:national:order:<row>`. Only the round, pick, club and origin cells are read; points and
 * games are not. Any row outside the reviewed forms, an unknown club, a holder its chain does not
 * reach, or a season other than a reviewed one refuses the whole page: no evidence, with issues.
 */
export function parseDraftguruPostDraftOrder(
  html: string,
  input: { capture: SourceCapture; draftYear: number }
): DraftguruTradeParseResult {
  const refuse = (issues: DraftguruParseIssue[]): DraftguruTradeParseResult => ({
    evidence: [],
    issues,
  });
  if (
    input.capture.parserVersion !== DRAFTGURU_POST_DRAFT_ORDER_PARSER_VERSION ||
    !DRAFTGURU_POST_DRAFT_ORDER_SEASONS.includes(input.draftYear) ||
    input.capture.sourceUrl !== draftguruPostDraftOrderUrl(input.draftYear)
  ) {
    return refuse([
      {
        code: 'invalid_page',
        sourceKey: 'order-table',
        detail: `Parser ${DRAFTGURU_POST_DRAFT_ORDER_PARSER_VERSION} reads only the reviewed post-draft order page of ${DRAFTGURU_POST_DRAFT_ORDER_SEASONS.join(', ')}.`,
      },
    ]);
  }
  const $ = load(html);
  const tables = $('table.general.provisional-draft-order');
  const headings = tables
    .find('thead th')
    .map((_index, th) => normalizeText($(th).text()))
    .get()
    .slice(0, 4);
  if (tables.length !== 1 || headings.join('|') !== 'Round|Pick|Club|Origin') {
    return refuse([
      {
        code: 'invalid_page',
        sourceKey: 'order-table',
        detail: 'Expected exactly one Full Draft Order table headed Round, Pick, Club, Origin.',
      },
    ]);
  }
  const claims: { sourceKey: string; claim: OrderClaim }[] = [];
  const issues: DraftguruParseIssue[] = [];
  tables
    .find('tr')
    .filter((_index, row) => $(row).children('td').length > 0)
    .each((index, row) => {
      const sourceKey = `${input.draftYear}:national:order:${index + 1}`;
      const unsupported = (detail: string) =>
        issues.push({ code: 'unsupported_row', sourceKey, detail });
      const cells = $(row).children('td');
      const roundText = normalizeText(cells.eq(0).text());
      const pickText = normalizeText(cells.filter('.pick').text());
      const clubCell = cells.filter('.club');
      const originCell = cells.filter('.origin');
      const clubLink = clubCell.find('a');
      const club = CLUBS.find(
        ({ nativeId, recordedName }) =>
          nativeId === pathId(clubLink.attr('href'), '/clubs/') &&
          recordedName === normalizeText(clubCell.text())
      );
      if (
        !/^[1-9]\d*$/.test(roundText) ||
        !/^(?:[1-9]\d*)?$/.test(pickText) ||
        clubCell.length !== 1 ||
        clubLink.length !== 1 ||
        originCell.length !== 1 ||
        club === undefined
      ) {
        unsupported(`Unreviewed round, pick or club cell: ${normalizeText($(row).text())}`);
        return;
      }
      const parts = segmentsOf(originCell).map(parseSegment);
      const assembled = parts.every((part) => part !== null) ? assembleRow(parts) : null;
      if (assembled === null) {
        unsupported(`Unreviewed origin: ${normalizeText(originCell.text())}`);
        return;
      }
      const claim = {
        kind: 'draft_order_pick' as const,
        draftYear: input.draftYear,
        draftType: 'national' as const,
        roundNumber: Number(roundText),
        pickNumber: pickText === '' ? null : Number(pickText),
        club: entity(club),
        ...assembled,
      };
      const chain = [
        claim.origin?.kind === 'entitlement' || claim.origin?.kind === 'leftover_points'
          ? claim.origin.club.nativeId
          : null,
        ...claim.hops.map(({ toClub }) => toClub.nativeId),
      ];
      const holder = chain.filter((id) => id !== null).at(-1);
      if (
        (claim.outcome.kind === 'selected') !== (claim.pickNumber !== null) ||
        chain.some((id, at) => at > 0 && id === chain[at - 1]) ||
        (holder !== undefined && holder !== club.nativeId)
      ) {
        unsupported(
          'A numbered row must be a selection, each hop must move the pick on, and the chain must reach the holder.'
        );
        return;
      }
      claims.push({ sourceKey, claim });
    });
  if (issues.length > 0) return refuse(issues);
  if (claims.length === 0) {
    return refuse([
      { code: 'invalid_page', sourceKey: 'order-table', detail: 'The order table has no rows.' },
    ]);
  }
  return {
    evidence: claims.map(({ sourceKey, claim }, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'draftguru',
        capture: input.capture,
        sourceRow: { ordinal: index + 1, sourceKey },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
