import { createHash } from 'node:crypto';

import { load } from 'cheerio';
import { z } from 'zod';

import type { AflTradeExternalPageCapture } from './externalDraftTradeIngestion';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import { reviewedFootyinfoDraftBoardSeason } from './footyinfoDraftBoardSourceScope';

export const FOOTYINFO_DRAFT_BOARD_PARSER_VERSION = 'footyinfo-draft-board-parser/v1';

type SourceCapture = AflTradeExternalEvidenceContent['capture'];
type Claim = AflTradeExternalEvidenceContent['claim'];
type BoardPickClaim = Extract<Claim, { kind: 'draft_board_pick' }>;

export interface FootyinfoDraftBoardIssue {
  code: 'invalid_page';
  sourceKey: string;
  detail: string;
}

export interface FootyinfoDraftBoardResult {
  evidence: AflTradeExternalEvidenceEnvelope[];
  issues: FootyinfoDraftBoardIssue[];
}

class LiteralError extends Error {}

/**
 * Reads one serialized value of the board's embedded router state: objects, arrays, strings,
 * numbers, `!0`/`!1`, `null` and `void 0`, each optionally introduced by a `$R[n]=` slot assignment.
 * A bare `$R[n]` back-reference resolves only to a slot this same read has already completed (the
 * live 2019 board writes `selected:$R[24]` for a period listed earlier in `periods`). A forward,
 * unknown or still-open (cyclic) reference, a reassigned slot, a function or a constructor is
 * refused, so nothing is evaluated.
 */
export function readFootyinfoSerializedLiteral(
  text: string,
  start: number
): { value: unknown; end: number } {
  let index = start;
  let depth = 0;
  const slots = new Map<number, unknown>();
  const fail = (what: string): never => {
    throw new LiteralError(`${what} at offset ${index}`);
  };
  const expect = (token: string) => {
    if (!text.startsWith(token, index)) fail(`Expected ${token}`);
    index += token.length;
  };
  const readString = (): string => {
    expect('"');
    let out = '';
    while (index < text.length) {
      const char = text[index]!;
      if (char === '"') {
        index += 1;
        return out;
      }
      if (char !== '\\') {
        out += char;
        index += 1;
        continue;
      }
      const escaped = text[index + 1];
      const simple: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        "'": "'",
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      if (escaped !== undefined && Object.hasOwn(simple, escaped)) {
        out += simple[escaped];
        index += 2;
      } else if (escaped === 'x' && /^[0-9a-fA-F]{2}$/.test(text.slice(index + 2, index + 4))) {
        out += String.fromCharCode(parseInt(text.slice(index + 2, index + 4), 16));
        index += 4;
      } else if (escaped === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))) {
        out += String.fromCharCode(parseInt(text.slice(index + 2, index + 6), 16));
        index += 6;
      } else {
        fail('Unsupported string escape');
      }
    }
    return fail('Unterminated string');
  };
  const readValue = (): unknown => {
    depth += 1;
    if (depth > 64) fail('Nesting too deep');
    const slot = /^\$R\[(\d{1,7})\]/.exec(text.slice(index, index + 12));
    let assigns: number | null = null;
    if (slot) {
      const slotNumber = Number(slot[1]);
      index += slot[0].length;
      if (text[index] !== '=') {
        if (!slots.has(slotNumber)) fail('Unsupported back-reference');
        depth -= 1;
        return slots.get(slotNumber);
      }
      if (slots.has(slotNumber)) fail(`Slot ${slotNumber} reassigned`);
      assigns = slotNumber;
      index += 1;
    }
    let value: unknown;
    const char = text[index];
    if (char === '{') {
      index += 1;
      const object: Record<string, unknown> = {};
      while (text[index] !== '}') {
        let key: string;
        if (text[index] === '"') {
          key = readString();
        } else {
          key =
            /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index, index + 80))?.[0] ??
            fail('Expected a key');
          index += key.length;
        }
        if (Object.hasOwn(object, key)) fail(`Duplicate key ${key}`);
        expect(':');
        object[key] = readValue();
        if (text[index] === ',') index += 1;
        else if (text[index] !== '}') fail('Expected , or }');
      }
      index += 1;
      value = object;
    } else if (char === '[') {
      index += 1;
      const array: unknown[] = [];
      while (text[index] !== ']') {
        array.push(readValue());
        if (text[index] === ',') index += 1;
        else if (text[index] !== ']') fail('Expected , or ]');
      }
      index += 1;
      value = array;
    } else if (char === '"') {
      value = readString();
    } else if (text.startsWith('!0', index) || text.startsWith('!1', index)) {
      value = text[index + 1] === '0';
      index += 2;
    } else if (text.startsWith('null', index)) {
      value = null;
      index += 4;
    } else if (text.startsWith('void 0', index)) {
      value = undefined;
      index += 6;
    } else {
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/.exec(
        text.slice(index, index + 40)
      );
      if (!number) fail('Unsupported value');
      value = Number(number![0]);
      index += number![0].length;
    }
    if (assigns !== null) slots.set(assigns, value);
    depth -= 1;
    return value;
  };
  const value = readValue();
  return { value, end: index };
}

const team = z.object({ name: z.string().min(1), abbrev: z.string().regex(/^[A-Z]{2,4}$/) });
const hopKinds = new Set(['trade', 'pick_swap', 'live_pick_swap']);
const pickSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive().optional(),
  round: z.number().int().positive().optional(),
  period: z.object({ year: z.number().int(), type: z.string() }),
  team,
  player: z
    .object({ known_as: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/) })
    .optional(),
  status: z.object({ id: z.string() }),
  origin: z.object({ id: z.string() }),
  points: z.number().int().optional(),
  note: z.string().optional(),
  // A bid without a bidding team is an academy or father-son selection no rival club bid on;
  // the board prints no matched bid for it.
  bid: z.object({ team: team.optional(), match_reason: z.string() }).optional(),
  lineage: z
    .array(
      z.object({ type: z.object({ id: z.string() }), from: team.optional(), to: team.optional() })
    )
    .optional(),
});
const loaderSchema = z.object({
  year: z.number().int(),
  selected: z.object({
    key: z.literal('national_draft'),
    year: z.number().int(),
    type: z.object({ id: z.literal('national_draft') }),
  }),
  content: z.object({ kind: z.literal('picks'), picks: z.array(z.unknown()) }),
});

const STATUS = { picked: 'selected', passed: 'passed', removed: 'removed' } as const;
// What the board prints before the route for each pick origin; points purchases only with a bid.
const ORIGIN_LABEL: Readonly<Record<string, BoardPickClaim['routeLabel'] | undefined>> = {
  standard: null,
  free_agency_compensation: 'compensation',
  special_assistance: 'special_assistance',
  points_remainder: 'leftover_points',
};
const ROUTE_LABEL_TEXT = {
  matched_bid: 'Matched bid',
  compensation: 'Compensation',
  special_assistance: 'Special assistance',
  leftover_points: 'Leftover points',
} as const;
const BID_BASIS = {
  father_son: 'father_son',
  academy_club: 'academy',
  academy_nga: 'next_generation_academy',
} as const;
const HEADERS = ['Pick', 'Club', 'Player', 'Rtg', 'Age', 'Ht', 'From', 'Route', 'Pts', 'Note'];

function normalize(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function club(value: z.infer<typeof team>) {
  return { nativeId: value.abbrev, recordedName: value.name };
}

/**
 * Reads a reviewed Footyinfo national draft board (`/draft/<year>`) as the board shows it with
 * passed and removed picks included. The picks come from the board data the page embeds; every
 * selection must also appear in the page's rendered table with the same number, club, player,
 * route, points and note, or nothing is emitted. Each selected, passed or removed pick is one
 * `draft_board_pick`; each selection is also a `draft_selection`. Picks the board lists as points
 * used to match a bid are not board rows and are not emitted.
 */
export function parseFootyinfoDraftBoard(
  html: string,
  input: { capture: SourceCapture; draftYear: number }
): FootyinfoDraftBoardResult {
  if (reviewedFootyinfoDraftBoardSeason(input.capture.sourceUrl) !== input.draftYear) {
    throw new TypeError('Footyinfo board URL is not the reviewed page of this draft year.');
  }
  const invalid = (detail: string): FootyinfoDraftBoardResult => ({
    evidence: [],
    issues: [{ code: 'invalid_page', sourceKey: String(input.draftYear), detail }],
  });
  const $ = load(html);
  const router = $('script')
    .toArray()
    .map((element) => $(element).text())
    .filter((text) => text.startsWith('$_TSR.router='));
  if (router.length !== 1) return invalid('The page has no single embedded router state.');
  const script = router[0]!;
  const loaders = [...script.matchAll(/,l:(?=(?:\$R\[\d{1,7}\]=)?\{year:\d{4},)/g)];
  if (loaders.length !== 1) return invalid('The router state has no single draft-board loader.');
  let loader: z.infer<typeof loaderSchema>;
  try {
    const read = readFootyinfoSerializedLiteral(script, loaders[0]!.index! + 3);
    const parsed = loaderSchema.safeParse(read.value);
    if (!parsed.success) return invalid('The draft-board loader does not have the reviewed shape.');
    loader = parsed.data;
  } catch (error) {
    if (error instanceof LiteralError) return invalid(`Unreadable board data: ${error.message}`);
    throw error;
  }
  if (loader.year !== input.draftYear || loader.selected.year !== input.draftYear) {
    return invalid('The board is not this year’s national draft.');
  }
  const picks: z.infer<typeof pickSchema>[] = [];
  for (const raw of loader.content.picks) {
    const parsed = pickSchema.safeParse(raw);
    if (!parsed.success) return invalid('A board pick does not have the reviewed shape.');
    if (parsed.data.period.year !== input.draftYear || parsed.data.period.type !== 'national_draft')
      return invalid(`Board pick ${parsed.data.id} is not in this year’s national draft.`);
    picks.push(parsed.data);
  }

  // The rendered table: one row per selection, keyed by pick number.
  const headerRows = $('table thead tr, table tr')
    .toArray()
    .filter((row) => $(row).children('th').length === HEADERS.length);
  const headerTexts = headerRows.map((row) =>
    $(row)
      .children('th')
      .toArray()
      .map((cell) => normalize($(cell).text()).replace(/[^A-Za-z]/g, ''))
  );
  if (
    headerTexts.length === 0 ||
    headerTexts.some((texts) => texts.some((text, index) => text !== HEADERS[index]))
  ) {
    return invalid('The board table does not have the reviewed columns.');
  }
  const tableRows = new Map<number, ReturnType<typeof $>>();
  for (const row of $('table tbody tr').toArray()) {
    const cells = $(row).children('td');
    if (cells.length === 0) continue;
    const pickText = normalize(cells.eq(0).text());
    if (
      cells.length !== HEADERS.length ||
      !/^\d{1,3}$/.test(pickText) ||
      tableRows.has(Number(pickText))
    )
      return invalid(`Unexpected board table row: ${pickText}`);
    tableRows.set(Number(pickText), cells);
  }

  const claims: Array<{ sourceKey: string; claim: Claim }> = [];
  const selected = new Set<number>();
  for (const pick of picks) {
    if (pick.status.id === 'points_used') continue;
    const sourceKey = `${input.draftYear}:national:pick:${pick.id}`;
    const status = Object.hasOwn(STATUS, pick.status.id)
      ? STATUS[pick.status.id as keyof typeof STATUS]
      : null;
    if (status === null)
      return invalid(`Board pick ${pick.id} has unreviewed status ${pick.status.id}.`);
    const originLabel = Object.hasOwn(ORIGIN_LABEL, pick.origin.id)
      ? ORIGIN_LABEL[pick.origin.id]
      : undefined;
    if (pick.bid !== undefined && !Object.hasOwn(BID_BASIS, pick.bid.match_reason)) {
      return invalid(`Board pick ${pick.id} has an unreviewed origin or bid basis.`);
    }
    const bid =
      pick.bid?.team === undefined
        ? undefined
        : { team: pick.bid.team, reason: pick.bid.match_reason };
    const basis = bid === undefined ? undefined : BID_BASIS[bid.reason as keyof typeof BID_BASIS];
    if (bid === undefined && originLabel === undefined) {
      return invalid(`Board pick ${pick.id} has an unreviewed origin or bid basis.`);
    }
    const routeLabel = bid !== undefined ? 'matched_bid' : originLabel!;
    const allHops = (pick.lineage ?? []).filter(({ type }) => hopKinds.has(type.id));
    if (allHops.some((hop) => hop.from === undefined || hop.to === undefined)) {
      return invalid(`Board pick ${pick.id} has a route hop without both clubs.`);
    }
    // Continuity and the holder are checked over every hop, a same-club hop included, so a
    // misplaced one still refuses.
    if (
      allHops.some(
        (hop, index) => index > 0 && hop.from!.abbrev !== allHops[index - 1]!.to!.abbrev
      ) ||
      (allHops.length > 0 && allHops.at(-1)!.to!.abbrev !== pick.team.abbrev)
    ) {
      return invalid(`Board pick ${pick.id} has a route that does not end with its holder.`);
    }
    // The board draws no route step for a hop that leaves the pick with the same club (the live
    // 2021 board's Fremantle concession pick #21, "Will Brodie to Fremantle", is FRE → FRE).
    const hops = allHops.filter(({ from, to }) => from!.abbrev !== to!.abbrev);
    const chain = hops.length === 0 ? [] : [hops[0]!.from!, ...hops.map(({ to }) => to!)];
    // The board prints a leftover-points pick's label without its route, and a matched bid instead
    // of one.
    const route = routeLabel === 'leftover_points' || routeLabel === 'matched_bid' ? [] : chain;
    if (status === 'selected') {
      if (pick.number === undefined || pick.player === undefined) {
        return invalid(`Selected board pick ${pick.id} has no number or player.`);
      }
      const cells = tableRows.get(pick.number);
      const routeSpans =
        cells === undefined
          ? []
          : cells
              .eq(7)
              .find('span > span')
              .toArray()
              .map((span) => normalize($(span).text()));
      const expectedSpans = [
        ...(routeLabel === null ? [] : [ROUTE_LABEL_TEXT[routeLabel]]),
        ...(route.length === 0 ? [] : [route.map(({ abbrev }) => abbrev).join(' → ')]),
      ];
      const routeMatches =
        bid !== undefined
          ? routeSpans.length === 2 &&
            routeSpans[0] === ROUTE_LABEL_TEXT.matched_bid &&
            routeSpans[1]!.startsWith(`${bid.team.abbrev} bid · `)
          : routeSpans.length === expectedSpans.length &&
            routeSpans.every((text, index) => text === expectedSpans[index]);
      if (
        cells === undefined ||
        selected.has(pick.number) ||
        normalize(cells.eq(1).text()) !== pick.team.abbrev ||
        normalize(cells.eq(2).text()) !== pick.player.known_as ||
        cells.eq(2).find(`a[href="/player/${pick.player.slug}"]`).length !== 1 ||
        !routeMatches ||
        normalize(cells.eq(8).text()) !== (pick.points === undefined ? '–' : String(pick.points)) ||
        normalize(cells.eq(9).text()) !== (pick.note ?? '')
      ) {
        return invalid(`Selection ${pick.number} differs between the board data and its table.`);
      }
      selected.add(pick.number);
    } else if (pick.number !== undefined || pick.player !== undefined) {
      return invalid(`Board pick ${pick.id} is ${status} but names a number or player.`);
    }
    const player =
      pick.player === undefined
        ? undefined
        : { nativeId: pick.player.slug, recordedName: pick.player.known_as };
    claims.push({
      sourceKey,
      claim: {
        kind: 'draft_board_pick',
        draftYear: input.draftYear,
        draftType: 'national',
        roundNumber: pick.round ?? null,
        recordedPickNumber: pick.number ?? null,
        status,
        club: club(pick.team),
        ...(player === undefined ? {} : { player }),
        route: route.map(club),
        routeLabel,
        bid: bid === undefined ? null : { club: club(bid.team), basis: basis! },
        points: pick.points ?? null,
        note: pick.note === undefined ? null : normalize(pick.note) || null,
      },
    });
    if (player !== undefined) {
      claims.push({
        sourceKey: `${sourceKey}:selection`,
        claim: {
          kind: 'draft_selection',
          draftYear: input.draftYear,
          draftType: 'national',
          selectionNumber: pick.number!,
          roundNumber: pick.round ?? null,
          player,
          selectedByClub: club(pick.team),
        },
      });
    }
  }
  if (selected.size !== tableRows.size || selected.size === 0) {
    return invalid('The board table and the board data do not list the same selections.');
  }
  try {
    return {
      evidence: claims.map(({ sourceKey, claim }, index) =>
        createAflTradeExternalEvidenceEnvelope({
          schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
          provider: 'footyinfo',
          capture: input.capture,
          sourceRow: { ordinal: index + 1, sourceKey },
          claim,
          publicationEligible: false,
        })
      ),
      issues: [],
    };
  } catch (error) {
    if (error instanceof z.ZodError) return invalid(`A board claim is invalid: ${error.message}`);
    throw error;
  }
}

async function readBounded(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Footyinfo response body is absent.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel('bounded source limit exceeded');
        throw new Error('Footyinfo response exceeds the configured byte limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

/**
 * Fetches one exact reviewed board page: no redirect, HTML only, bounded. Any other status,
 * including a 403 or 429 or a bot challenge, fails the capture; nothing retries around it.
 */
export async function captureFootyinfoDraftBoard(input: {
  url: string;
  validators: { eTag: string | null; lastModified: string | null } | null;
  maximumBytes: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<AflTradeExternalPageCapture> {
  if (reviewedFootyinfoDraftBoardSeason(input.url) === null) {
    throw new TypeError('Footyinfo capture URL is not a reviewed draft board.');
  }
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes <= 0) {
    throw new TypeError('maximumBytes must be a positive safe integer.');
  }
  const headers = new Headers({ Accept: 'text/html,application/xhtml+xml' });
  if (input.validators?.eTag) headers.set('If-None-Match', input.validators.eTag);
  if (input.validators?.lastModified)
    headers.set('If-Modified-Since', input.validators.lastModified);
  const response = await input.fetchImpl(input.url, {
    method: 'GET',
    redirect: 'error',
    headers,
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  const eTag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  if (response.status === 304)
    return { status: 'not_modified', sourceUrl: input.url, eTag, lastModified };
  if (response.status !== 200) throw new Error(`Footyinfo capture returned ${response.status}.`);
  const mediaType = response.headers.get('content-type') ?? '';
  if (!/^text\/html\b/i.test(mediaType))
    throw new Error('Footyinfo capture returned unsupported content type.');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > input.maximumBytes)
    throw new Error('Footyinfo response exceeds the configured byte limit.');
  const bytes = await readBounded(response, input.maximumBytes);
  return {
    status: 'captured',
    sourceUrl: input.url,
    bytes,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    mediaType,
    eTag,
    lastModified,
  };
}
