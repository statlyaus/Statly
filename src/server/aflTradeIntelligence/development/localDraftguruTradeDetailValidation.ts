import { createHash } from 'node:crypto';

import {
  parseDraftguruTradeDetail,
  type DraftguruTradeParseResult,
} from '../source/draftguruSourceAdapter';

/** One `detail-cache.json` entry: a captured trade-detail response and the hash that identifies it. */
export interface DraftguruTradeDetailCacheEntry {
  readonly url: string;
  readonly sha256: string;
  readonly bodyFile: string;
  readonly recordedAt: string;
  readonly authority: string;
  readonly factsValidated: boolean;
}

export interface DraftguruTradeDetailValidationOutcome {
  readonly eventId: string;
  readonly bodyShaMatches: boolean;
  readonly parsed: DraftguruTradeParseResult | null;
  readonly issues: readonly { code: string; detail: string }[];
  readonly parties: readonly string[];
  readonly assetKinds: readonly string[];
  readonly transfers: readonly {
    readonly nativeTransferId: string;
    readonly fromClub: string;
    readonly toClub: string;
    readonly assetSignature: string;
  }[];
  /** Whether the captured page states an exact calendar date anywhere. */
  readonly statesExplicitDate: boolean;
}

const DATE_PATTERN = /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/u;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Recursively key-sorted JSON, so two equal assets always serialise identically. */
export function canonicalAssetJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item as Record<string, unknown>)
            .sort()
            .map((key) => [key, (item as Record<string, unknown>)[key]])
        )
      : item
  );
}

export function draftguruEventIdFromUrl(url: string): string | null {
  return /\/trades\/([^/]+)$/u.exec(new URL(url).pathname)?.[1] ?? null;
}

type DirectedTransferClaim = Readonly<{
  kind: 'directed_transfer';
  nativeTransferId: string;
  fromClub: Readonly<{ recordedName: string }>;
  toClub: Readonly<{ recordedName: string }>;
  asset: unknown;
}>;

type TransactionPartyClaim = Readonly<{
  kind: 'transaction_party';
  club: { recordedName: string };
}>;

function isDirectedTransfer(claim: unknown): claim is DirectedTransferClaim {
  const candidate = claim as Partial<DirectedTransferClaim> | null;
  return (
    candidate?.kind === 'directed_transfer' &&
    typeof candidate.nativeTransferId === 'string' &&
    typeof candidate.fromClub?.recordedName === 'string' &&
    typeof candidate.toClub?.recordedName === 'string' &&
    candidate.asset !== undefined
  );
}

function isTransactionParty(claim: unknown): claim is TransactionPartyClaim {
  const candidate = claim as Partial<TransactionPartyClaim> | null;
  return (
    candidate?.kind === 'transaction_party' && typeof candidate.club?.recordedName === 'string'
  );
}

/**
 * Validates one captured Draftguru trade-detail body against the parser the pipeline itself uses.
 *
 * The capture is public inspection evidence, and the parser reports `occurredOn: null` for every
 * trade because the source records only a season. This validation therefore reports whether a date
 * exists rather than inventing one: `effectiveAt` is passed as a parser argument only, and is derived
 * from the season so the call is deterministic.
 */
export function validateDraftguruTradeDetail(input: {
  readonly entry: DraftguruTradeDetailCacheEntry;
  readonly html: string;
}): DraftguruTradeDetailValidationOutcome | null {
  const eventId = draftguruEventIdFromUrl(input.entry.url);
  if (eventId === null) return null;
  const seasonYear = Number.parseInt(eventId.slice(0, 4), 10);
  if (!Number.isInteger(seasonYear) || seasonYear < 1988 || seasonYear > 2200) return null;
  const nominalSeasonInstant = `${seasonYear}-10-01T00:00:00.000Z`;
  const parsed = parseDraftguruTradeDetail(input.html, {
    capture: {
      captureId: `source-capture:${input.entry.sha256}`,
      artifactId: `artifact:${input.entry.sha256}`,
      contentSha256: input.entry.sha256,
      mediaType: 'text/html; charset=utf-8',
      sourceUrl: input.entry.url,
      // The cache records microseconds with an offset; the capture contract requires milliseconds in Z.
      capturedAt: new Date(input.entry.recordedAt).toISOString(),
      effectiveAt: nominalSeasonInstant,
      parserVersion: 'draftguru-trade-parser/v1',
      fieldManifestSha256: sha256('statly-draftguru-detail-validation'),
    },
    draftYear: seasonYear,
    effectiveAt: nominalSeasonInstant,
  });

  const parties: string[] = [];
  const assetKinds: string[] = [];
  const transfers: DraftguruTradeDetailValidationOutcome['transfers'][number][] = [];
  for (const row of parsed.evidence) {
    const claim: unknown = row.content.claim;
    if (isTransactionParty(claim) && !parties.includes(claim.club.recordedName)) {
      parties.push(claim.club.recordedName);
      continue;
    }
    if (!isDirectedTransfer(claim)) continue;
    assetKinds.push((claim.asset as { kind: string }).kind);
    transfers.push({
      nativeTransferId: claim.nativeTransferId,
      fromClub: claim.fromClub.recordedName,
      toClub: claim.toClub.recordedName,
      assetSignature: canonicalAssetJson(claim.asset),
    });
  }

  return {
    eventId,
    bodyShaMatches: sha256(input.html) === input.entry.sha256,
    parsed,
    issues: parsed.issues.map((issue) => ({ code: issue.code, detail: issue.detail })),
    parties,
    assetKinds,
    transfers,
    statesExplicitDate: DATE_PATTERN.test(input.html),
  };
}

/**
 * The trace expresses `player`, `current_pick_entitlement` and `future_pick_entitlement`, so any other
 * source asset kind cannot be carried into a constructed trade without widening that vocabulary.
 */
export const DRAFTGURU_TO_TRACE_ASSET_KINDS: Readonly<Record<string, string | null>> = {
  player: 'player',
  current_pick: 'current_pick_entitlement',
  future_pick: 'future_pick_entitlement',
  special_pick: null,
};

/** A kind is expressible only when the map names a trace kind for it; an unlisted kind is not. */
export function isTraceExpressibleAssetKind(kind: string): boolean {
  return (
    Object.hasOwn(DRAFTGURU_TO_TRACE_ASSET_KINDS, kind) &&
    DRAFTGURU_TO_TRACE_ASSET_KINDS[kind] !== null
  );
}

export interface DraftguruTradeDetailValidationSummary {
  readonly entries: number;
  /** Entries with no outcome: not one trade-detail page, an out-of-range season, or an unread body. */
  readonly skippedEntries: number;
  readonly hashMismatches: number;
  readonly parsedWithoutIssues: number;
  readonly issues: Readonly<Record<string, number>>;
  readonly assetKinds: Readonly<Record<string, number>>;
  readonly unexpressibleAssetKindCount: number;
  readonly transferCount: number;
  readonly partyDistribution: string;
  readonly duplicateTransferIds: readonly string[];
  readonly withinEventDuplicates: readonly string[];
  readonly crossEventDuplicateGroups: readonly (readonly string[])[];
  readonly tradesWithExplicitDate: readonly string[];
}

function countBy<T>(values: readonly T[], keyOf: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Keeps a repeated id (a parse defect) apart from a repeated movement under distinct ids (a
 * constructible duplicate), and returns the trade's movement signatures for cross-trade grouping.
 */
function withinEventDuplicates(outcome: DraftguruTradeDetailValidationOutcome) {
  const ids = new Set<string>();
  const signatures = new Set<string>();
  const duplicateIds: string[] = [];
  const duplicateMovements: string[] = [];
  const allSignatures: string[] = [];
  for (const transfer of outcome.transfers) {
    if (ids.has(transfer.nativeTransferId)) {
      duplicateIds.push(`${outcome.eventId}:${transfer.nativeTransferId}`);
    }
    ids.add(transfer.nativeTransferId);
    const signature = `${transfer.fromClub}|${transfer.toClub}|${transfer.assetSignature}`;
    if (signatures.has(signature)) duplicateMovements.push(`${outcome.eventId}:${signature}`);
    signatures.add(signature);
    allSignatures.push(signature);
  }
  return { duplicateIds, duplicateMovements, signatures: allSignatures };
}

/** Groups trades whose movement sets are identical regardless of order; only groups of two or more. */
function crossEventDuplicateGroups(
  signaturesByEvent: readonly { eventId: string; signatures: readonly string[] }[]
): string[][] {
  const eventsBySet = new Map<string, string[]>();
  for (const { eventId, signatures } of signaturesByEvent) {
    if (signatures.length === 0) continue;
    const key = JSON.stringify([...signatures].sort());
    eventsBySet.set(key, [...(eventsBySet.get(key) ?? []), eventId]);
  }
  return [...eventsBySet.values()]
    .filter((eventIds) => eventIds.length > 1)
    .map((eventIds) => [...eventIds].sort());
}

/** Includes trades with no recovered party as `0:n`, so a failed party parse cannot hide. */
function partyDistribution(outcomes: readonly DraftguruTradeDetailValidationOutcome[]): string {
  return Object.entries(countBy(outcomes, (outcome) => String(outcome.parties.length)))
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([partyCount, trades]) => `${partyCount}:${trades}`)
    .join(' ');
}

/** Aggregates per-body outcomes. Pure, so the measurements can be asserted without the capture. */
export function summariseDraftguruTradeDetailValidation(
  outcomes: readonly (DraftguruTradeDetailValidationOutcome | null)[]
): DraftguruTradeDetailValidationSummary {
  const present = outcomes.filter((outcome) => outcome !== null);
  const assetKinds = present.flatMap((outcome) => outcome.assetKinds);
  const duplicates = present.map((outcome) => ({
    eventId: outcome.eventId,
    ...withinEventDuplicates(outcome),
  }));

  return {
    entries: present.length,
    skippedEntries: outcomes.length - present.length,
    hashMismatches: present.filter((outcome) => !outcome.bodyShaMatches).length,
    parsedWithoutIssues: present.filter((outcome) => outcome.issues.length === 0).length,
    issues: countBy(
      present.flatMap((outcome) => outcome.issues),
      (issue) => issue.code
    ),
    assetKinds: countBy(assetKinds, (kind) => kind),
    unexpressibleAssetKindCount: assetKinds.filter((kind) => !isTraceExpressibleAssetKind(kind))
      .length,
    transferCount: present.reduce((total, outcome) => total + outcome.transfers.length, 0),
    partyDistribution: partyDistribution(present),
    duplicateTransferIds: duplicates.flatMap(({ duplicateIds }) => duplicateIds),
    withinEventDuplicates: duplicates.flatMap(({ duplicateMovements }) => duplicateMovements),
    crossEventDuplicateGroups: crossEventDuplicateGroups(duplicates),
    tradesWithExplicitDate: present
      .filter((outcome) => outcome.statesExplicitDate)
      .map((outcome) => outcome.eventId),
  };
}
