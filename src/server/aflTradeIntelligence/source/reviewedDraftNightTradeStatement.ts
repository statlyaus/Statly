import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import {
  REVIEWED_DRAFT_NIGHT_TRADES_PROVIDER,
  reviewedDraftNightTradeStatement,
  type ReviewedDraftNightTradeSeason,
} from './reviewedDraftNightTradeSourceScope';

/**
 * A reviewer-compiled statement of one season's draft-night pick trades (statlyaus/Statly#886):
 * every trade two clubs made during that season's national draft, each pick as its slot number in
 * that draft, each deal citing the one retained article (an AFL or club page, stored as raw-source
 * evidence) that states it. The statement is a human assertion, not a scrape; the parser turns it
 * into the claims a Draftguru trade page yields so reconciliation and the realized grader read the
 * deals as ordinary transactions.
 */
export const REVIEWED_DRAFT_NIGHT_TRADES_SCHEMA_VERSION = 'statly-reviewed-draft-night-trades/v1';
export const REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION =
  'statly-reviewed-draft-night-trades-parser/v1';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), 'Invalid date.');
const clubSchema = z.string().trim().min(1).max(120);
const slotSchema = z.number().int().positive().max(1_000);

/**
 * A pick of the season's national draft, by its slot in the season's final pre-draft order (the
 * numbering the order custody records). A slot moves on draft night as bids land, so the number the
 * article states, when it differs, is kept as `statedAs` for review; it is never emitted.
 */
const slotAssetSchema = z
  .object({
    kind: z.literal('slot'),
    slot: slotSchema,
    statedAs: slotSchema.optional(),
  })
  .strict();

/** A later season's pick, exactly as a Draftguru trade page states one: its draft, round and club. */
const futurePickAssetSchema = z
  .object({
    kind: z.literal('future_pick'),
    draftYear: z.number().int().min(1897).max(2200),
    roundNumber: z.number().int().positive().max(10),
    originalClub: clubSchema,
  })
  .strict();

const assetSchema = z.discriminatedUnion('kind', [slotAssetSchema, futurePickAssetSchema]);

const sideSchema = z
  .object({
    club: clubSchema,
    /** What this club gave in the deal. */
    gives: z.array(assetSchema).min(1).max(20),
  })
  .strict();

const dealSchema = z
  .object({
    occurredOn: dateSchema,
    sides: z.tuple([sideSchema, sideSchema]),
    /** The retained article stating the deal, as stored through `outcomes:artifacts:store-evidence`. */
    evidenceArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    evidenceUrl: z.string().url().max(2_048).startsWith('https://'),
  })
  .strict();

export const reviewedDraftNightTradeStatementSchema = z
  .object({
    schemaVersion: z.literal(REVIEWED_DRAFT_NIGHT_TRADES_SCHEMA_VERSION),
    season: z.number().int().min(1897).max(2200),
    draftType: z.literal('national'),
    deals: z.array(dealSchema).min(1).max(200),
  })
  .strict();

export type ReviewedDraftNightTradeStatement = z.infer<
  typeof reviewedDraftNightTradeStatementSchema
>;

export interface ReviewedDraftNightTradeIssue {
  code:
    | 'invalid_statement'
    | 'unregistered_statement'
    | 'season_mismatch'
    | 'date_not_draft_night'
    | 'slot_out_of_range'
    | 'no_slot'
    | 'future_pick_not_future'
    | 'pick_on_both_sides'
    | 'duplicate_pick'
    | 'same_club_both_sides'
    | 'duplicate_deal';
  sourceKey: string;
  detail: string;
}

export interface ReviewedDraftNightTradeResult {
  evidence: AflTradeExternalEvidenceEnvelope[];
  issues: ReviewedDraftNightTradeIssue[];
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type Deal = ReviewedDraftNightTradeStatement['deals'][number];
type Asset = Deal['sides'][number]['gives'][number];

/** The asset key a Draftguru trade page uses for the same pick, so both providers key it alike. */
function fingerprint(season: number, asset: Asset): string {
  return asset.kind === 'slot'
    ? `pick:${season}:national:${asset.slot}`
    : `future-pick:${asset.draftYear}:national:${asset.roundNumber}:${slug(asset.originalClub)}`;
}

/** Sides ordered by club and assets by key, so one deal has one identity however it was written. */
function canonicalSides(season: number, deal: Deal) {
  return deal.sides
    .map(({ club, gives }) => ({
      club,
      gives: gives
        .map((asset) => ({ asset, key: fingerprint(season, asset) }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    }))
    .sort((left, right) => slug(left.club).localeCompare(slug(right.club)));
}

/**
 * The deal's native event id: its night, clubs and assets, so a reordered file keeps every id. It
 * never starts with a year as a Draftguru trade id does, so the two providers' events cannot share a
 * key.
 */
export function reviewedDraftNightDealEventId(season: number, deal: Deal): string {
  const sides = canonicalSides(season, deal).map(
    ({ club, gives }) =>
      `${slug(club)}-${gives
        .map(({ asset }) =>
          asset.kind === 'slot'
            ? String(asset.slot)
            : `${asset.draftYear}r${asset.roundNumber}-${slug(asset.originalClub)}`
        )
        .join('-')}`
  );
  return `draft-night-${season}-${deal.occurredOn}-${sides.join('--')}`;
}

function dealIssues(
  deal: Deal,
  index: number,
  scope: ReviewedDraftNightTradeSeason
): ReviewedDraftNightTradeIssue[] {
  const sourceKey = `deal-${index + 1}`;
  const issues: ReviewedDraftNightTradeIssue[] = [];
  if (!scope.draftNights.includes(deal.occurredOn)) {
    issues.push({
      code: 'date_not_draft_night',
      sourceKey,
      detail: `${deal.occurredOn} is not a ${scope.season} national draft night (${scope.draftNights.join(', ')}).`,
    });
  }
  const [first, second] = deal.sides;
  if (slug(first.club) === slug(second.club)) {
    issues.push({
      code: 'same_club_both_sides',
      sourceKey,
      detail: `${first.club} cannot trade with itself.`,
    });
  }
  const assets = [...first.gives, ...second.gives];
  if (!assets.some(({ kind }) => kind === 'slot')) {
    issues.push({
      code: 'no_slot',
      sourceKey,
      detail: `The deal moves no pick of the ${scope.season} national draft.`,
    });
  }
  for (const asset of assets) {
    if (asset.kind === 'slot' && asset.slot > scope.selectionCount) {
      issues.push({
        code: 'slot_out_of_range',
        sourceKey,
        detail: `Pick ${asset.slot} is outside 1 to ${scope.selectionCount} of the ${scope.season} national draft.`,
      });
    }
    if (asset.kind === 'future_pick' && asset.draftYear <= scope.season) {
      issues.push({
        code: 'future_pick_not_future',
        sourceKey,
        detail: `A ${asset.draftYear} pick is not a future pick of ${scope.season}.`,
      });
    }
  }
  const keysOf = (gives: readonly Asset[]) =>
    gives.map((asset) => fingerprint(scope.season, asset));
  const [firstKeys, secondKeys] = [keysOf(first.gives), keysOf(second.gives)];
  for (const key of new Set([...firstKeys, ...secondKeys])) {
    if (firstKeys.includes(key) && secondKeys.includes(key)) {
      issues.push({
        code: 'pick_on_both_sides',
        sourceKey,
        detail: `${key} is both given and received in one deal.`,
      });
    } else if ([...firstKeys, ...secondKeys].filter((value) => value === key).length > 1) {
      issues.push({
        code: 'duplicate_pick',
        sourceKey,
        detail: `${key} is listed twice on one side.`,
      });
    }
  }
  return issues;
}

/**
 * Reads one reviewed statement into Draftguru-shaped claims: per deal one `transaction` dated to its
 * draft night, two `transaction_party` rows and one `directed_transfer` per pick, a slot as a
 * `current_pick` keyed `pick:<season>:national:<slot>` and a later season's pick as a `future_pick`
 * keyed `future-pick:<year>:national:<round>:<club>`, exactly as a Draftguru trade page keys them.
 * The statement must be the registered one for the capture's source URL, and nothing is emitted when
 * any deal is refused: no evidence, a draft night the season did not have, a slot outside 1..N, a
 * pick on both sides, a deal with no slot of the draft, or a duplicate deal.
 */
export function parseReviewedDraftNightTrades(
  text: string,
  input: { capture: AflTradeExternalEvidenceContent['capture']; season: number }
): ReviewedDraftNightTradeResult {
  const registered = reviewedDraftNightTradeStatement(input.capture.sourceUrl);
  if (
    registered === null ||
    registered.season !== input.season ||
    registered.sha256 !== input.capture.contentSha256 ||
    input.capture.parserVersion !== REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION
  ) {
    return {
      evidence: [],
      issues: [
        {
          code: 'unregistered_statement',
          sourceKey: `reviewed-draft-night-trades:${input.season}`,
          detail: 'The capture is not the registered reviewed statement of this season and parser.',
        },
      ],
    };
  }
  return readReviewedDraftNightTrades(text, { ...input, registered });
}

/** Reads a statement against its registered season facts; exported for the refusal tests. */
export function readReviewedDraftNightTrades(
  text: string,
  input: {
    capture: AflTradeExternalEvidenceContent['capture'];
    season: number;
    registered: ReviewedDraftNightTradeSeason;
  }
): ReviewedDraftNightTradeResult {
  const { registered } = input;
  const sourceKey = `reviewed-draft-night-trades:${input.season}`;
  const refuse = (issues: ReviewedDraftNightTradeIssue[]): ReviewedDraftNightTradeResult => ({
    evidence: [],
    issues,
  });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return refuse([{ code: 'invalid_statement', sourceKey, detail: 'The statement is not JSON.' }]);
  }
  const parsed = reviewedDraftNightTradeStatementSchema.safeParse(json);
  if (!parsed.success) {
    return refuse([
      {
        code: 'invalid_statement',
        sourceKey,
        detail: parsed.error.issues
          .map(({ path, message }) => `${path.join('.') || '(root)'}: ${message}`)
          .join('; ')
          .slice(0, 2_000),
      },
    ]);
  }
  const statement = parsed.data;
  if (statement.season !== input.season) {
    return refuse([
      {
        code: 'season_mismatch',
        sourceKey,
        detail: `The statement is for ${statement.season}, not ${input.season}.`,
      },
    ]);
  }
  const issues = statement.deals.flatMap((deal, index) => dealIssues(deal, index, registered));
  const eventIds = statement.deals.map((deal) => reviewedDraftNightDealEventId(input.season, deal));
  eventIds.forEach((eventId, index) => {
    if (eventIds.indexOf(eventId) !== index) {
      issues.push({
        code: 'duplicate_deal',
        sourceKey: `deal-${index + 1}`,
        detail: `Deal ${index + 1} repeats deal ${eventIds.indexOf(eventId) + 1}.`,
      });
    }
  });
  if (issues.length > 0) return refuse(issues);

  let ordinal = 1;
  const evidence: AflTradeExternalEvidenceEnvelope[] = [];
  const create = (rowKey: string, claim: AflTradeExternalEvidenceContent['claim']) =>
    evidence.push(
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: REVIEWED_DRAFT_NIGHT_TRADES_PROVIDER,
        capture: input.capture,
        sourceRow: { ordinal: ordinal++, sourceKey: rowKey },
        claim,
        publicationEligible: false,
      })
    );
  statement.deals.forEach((deal, index) => {
    const eventId = eventIds[index]!;
    const sides = canonicalSides(input.season, deal);
    create(eventId, {
      kind: 'transaction',
      nativeEventId: eventId,
      seasonYear: input.season,
      occurredOn: deal.occurredOn,
      transactionType: 'trade',
      title: null,
    });
    for (const { club } of sides) {
      create(`${eventId}:party:${slug(club)}`, {
        kind: 'transaction_party',
        nativeEventId: eventId,
        nativePartyId: slug(club),
        club: { nativeId: null, recordedName: club },
      });
    }
    const transfers = sides
      .flatMap((side, sideIndex) =>
        side.gives.map(({ asset, key }) => ({
          asset,
          key,
          from: side.club,
          to: sides[1 - sideIndex]!.club,
        }))
      )
      .sort((left, right) => left.key.localeCompare(right.key));
    for (const { asset, key, from, to } of transfers) {
      create(`${eventId}:transfer:${key}`, {
        kind: 'directed_transfer',
        nativeEventId: eventId,
        nativeTransferId: key,
        fromClub: { nativeId: null, recordedName: from },
        toClub: { nativeId: null, recordedName: to },
        asset:
          asset.kind === 'slot'
            ? {
                kind: 'current_pick',
                draftYear: input.season,
                draftType: 'national',
                recordedPickNumber: asset.slot,
              }
            : {
                kind: 'future_pick',
                draftYear: asset.draftYear,
                draftType: 'national',
                roundNumber: asset.roundNumber,
                originalClub: { nativeId: null, recordedName: asset.originalClub },
              },
      });
    }
  });
  return { evidence, issues: [] };
}
